"""
modal_tts.py — LiveKit Agents TTS plugin cho Modal OmniVoice

Gọi Modal-deployed OmniVoice endpoint, nhận raw int16 PCM stream,
phát thẳng sang LiveKit không cần bước decode trung gian.

Yêu cầu:
    pip install aiohttp livekit-agents python-dotenv

Dùng:
    from modal_tts import ModalTTS

    tts_plugin = ModalTTS(
        voice_id="shinhan_voice",
        language="vi",
        instruct="female,Very Low Pitch",
        num_step_first=8,
        num_step=16,
    )
    session = AgentSession(tts=tts_plugin, ...)

Reset first-sentence flag khi agent bắt đầu trả lời mới:

    @session.on("agent_state_changed")
    def _on_state_changed(ev):
        if ev.new_state == "thinking":
            tts_plugin.reset_turn()

Streaming endpoint (POST /stream_api):
  Request  JSON: { text, language, num_step, instruct?, voice_id?, ref_audio?, ref_text? }
  Response      : StreamingResponse, media_type="audio/pcm",
                  raw int16 PCM tại 24 kHz mono, chia thành chunk 4 KB.
"""

from __future__ import annotations

import base64
import logging
import os

import aiohttp

from livekit.agents import (
    APIConnectOptions,
    DEFAULT_API_CONNECT_OPTIONS,
    tts,
    utils,
)
from core.providers_registry.tts.tts_normalizer import normalize_for_tts

# ── Hằng số ───────────────────────────────────────────────────────────────────

DEFAULT_MODAL_TTS_URL = (
    "https://nguyentatchien0122--omnivoice-omnivoiceservice-api.modal.run"
)
DEFAULT_REF_TEXT = ""

logger = logging.getLogger("modal-tts")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_ref_audio(path: str | None) -> str | None:
    """Đọc file âm thanh clone voice, encode base64 để gửi lên Modal."""
    resolved = path or os.getenv("MODAL_TTS_REF_AUDIO_PATH", "clone.mp3")
    if os.path.isfile(resolved):
        with open(resolved, "rb") as f:
            data = f.read()
        logger.info("Loaded voice clone ref audio from %s", resolved)
        return base64.b64encode(data).decode()
    logger.warning("Ref audio not found at %s, using default voice", resolved)
    return None


# ── Plugin chính ──────────────────────────────────────────────────────────────

class ModalTTS(tts.TTS):
    """
    LiveKit TTS plugin gọi Modal-deployed OmniVoice endpoint.

    Hỗ trợ hai chế độ:
    - Câu đầu trong lượt (first-in-turn): dùng num_step_first (ít bước → nhanh)
    - Các câu tiếp theo:                  dùng num_step đầy đủ  (chất lượng cao)

    Gọi reset_turn() khi agent bắt đầu suy nghĩ để kích hoạt lại first-in-turn.

    Args:
        url:             URL gốc của Modal endpoint (mặc định env MODAL_TTS_URL).
        stream_url:      URL /stream_api cụ thể (mặc định env MODAL_TTS_STREAM_URL, fallback url).
        language:        Mã ngôn ngữ ("vi", "en", …).
        num_step:        Số diffusion step cho các câu thường (chất lượng cao hơn).
        num_step_first:  Số diffusion step cho câu đầu (ít hơn → latency thấp hơn).
        instruct:        Chuỗi điều khiển giọng (vd: "female,Very Low Pitch").
        voice_id:        ID giọng đọc định sẵn trên server.
        ref_audio_path:  Đường dẫn file âm thanh mẫu để clone giọng.
        ref_text:        Transcript của ref_audio (dùng kèm ref_audio).
        sample_rate:     Sample rate đầu ra (mặc định 24 000 Hz).
        num_channels:    Số kênh (mặc định 1 — mono).
    """

    def __init__(
        self,
        *,
        url: str | None = None,
        stream_url: str | None = None,
        language: str = "vi",
        num_step: int = 32,
        num_step_first: int = 5,
        instruct: str | None = None,
        ref_audio_path: str | None = None,
        voice_id: str | None = None,
        ref_text: str = DEFAULT_REF_TEXT,
        sample_rate: int = 24_000,
        num_channels: int = 1,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(
                streaming=False,
                aligned_transcript=False,
            ),
            sample_rate=sample_rate,
            num_channels=num_channels,
        )
        self._url = url or os.getenv("MODAL_TTS_URL", DEFAULT_MODAL_TTS_URL)
        self._stream_url = (
            stream_url
            or os.getenv("MODAL_TTS_STREAM_URL")
            or self._url
        )
        self._language = language
        self._num_step = num_step
        self._num_step_first = num_step_first
        self._first_in_turn: bool = True
        self._voice_id = voice_id
        self._instruct = instruct
        self._ref_text = ref_text
        self._ref_audio_b64: str | None = _load_ref_audio(ref_audio_path)
        self._http_session: aiohttp.ClientSession | None = None

    def reset_turn(self) -> None:
        """Reset first-sentence flag. Gọi đầu mỗi lượt phản hồi của agent."""
        self._first_in_turn = True

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._http_session is None or self._http_session.closed:
            connector = aiohttp.TCPConnector(limit=4, keepalive_timeout=60)
            self._http_session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=120),
                connector=connector,
            )
        return self._http_session

    async def aclose(self) -> None:
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()
        await super().aclose()

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions | None = None,
    ) -> "ModalChunkedStream":
        if self._first_in_turn:
            num_step = self._num_step_first
            self._first_in_turn = False
        else:
            num_step = self._num_step
        # Normalize numbers → Vietnamese words for TTS, original text unchanged
        spoken_text = normalize_for_tts(text)
        return ModalChunkedStream(
            tts=self,
            input_text=spoken_text,
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
            num_step=num_step,
        )


class ModalChunkedStream(tts.ChunkedStream):
    """Streams raw int16 PCM chunks từ Modal /stream_api."""

    def __init__(
        self,
        *,
        tts: "ModalTTS",
        input_text: str,
        conn_options: APIConnectOptions,
        num_step: int,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._num_step = num_step

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:  # type: ignore[override]
        tts_inst: ModalTTS = self._tts  # type: ignore[assignment]

        payload: dict = {
            "text": self.input_text,
            "language": tts_inst._language,
            "num_step": self._num_step,
        }
        if tts_inst._instruct:
            payload["instruct"] = tts_inst._instruct
        if tts_inst._voice_id:
            payload["voice_id"] = tts_inst._voice_id
        if tts_inst._ref_audio_b64:
            payload["ref_audio"] = tts_inst._ref_audio_b64
            payload["ref_text"] = tts_inst._ref_text

        http = await tts_inst._get_session()
        async with http.post(tts_inst._stream_url, json=payload) as resp:
            resp.raise_for_status()
            output_emitter.initialize(
                request_id=utils.shortuuid(),
                sample_rate=tts_inst.sample_rate,
                num_channels=tts_inst.num_channels,
                mime_type="audio/pcm",
            )
            async for chunk in resp.content.iter_chunked(4096):
                if chunk:
                    output_emitter.push(chunk)
