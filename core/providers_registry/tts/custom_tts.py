"""
pai_eas_tts.py — LiveKit Agents TTS plugin for Alibaba Cloud PAI-EAS OmniVoice

Calls PAI-EAS deployed OmniVoice endpoint, receives raw int16 PCM stream,
and plays directly to LiveKit without intermediate decoding.

Requirements:
    pip install aiohttp livekit-agents python-dotenv

Usage:
    from custom_tts import PaiEasTTS

    tts_plugin = PaiEasTTS(
        voice_id="shinhan_voice",
        language="vi",
        instruct="female,Very Low Pitch",
        num_step_first=8,
        num_step=16,
    )
    session = AgentSession(tts=tts_plugin, ...)

Reset first-sentence flag when agent starts a new response:

    @session.on("agent_state_changed")
    def _on_state_changed(ev):
        if ev.new_state == "thinking":
            tts_plugin.reset_turn()

Streaming endpoint (POST /stream_api):
  Request  JSON: { text, language, num_step, instruct?, voice_id?, ref_audio?, ref_text? }
  Response      : StreamingResponse, media_type="audio/pcm",
                  raw int16 PCM at 24 kHz mono, chunked into 4 KB pieces.
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

# ── Constants ────────────────────────────────────────────────────────────────

DEFAULT_PAI_EAS_TTS_URL = ""  # Set via PAI_EAS_TTS_URL env var
DEFAULT_REF_TEXT = ""

logger = logging.getLogger("pai-eas-tts")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_ref_audio(path: str | None) -> str | None:
    """Load voice clone audio file, encode to base64 for PAI-EAS upload."""
    resolved = path or os.getenv("PAI_EAS_TTS_REF_AUDIO_PATH", "clone.mp3")
    if os.path.isfile(resolved):
        with open(resolved, "rb") as f:
            data = f.read()
        logger.info("Loaded voice clone ref audio from %s", resolved)
        return base64.b64encode(data).decode()
    logger.warning("Ref audio not found at %s, using default voice", resolved)
    return None


# ── Main Plugin ──────────────────────────────────────────────────────────────

class PaiEasTTS(tts.TTS):
    """
    LiveKit TTS plugin calling Alibaba Cloud PAI-EAS deployed OmniVoice endpoint.

    Supports two modes:
    - First sentence in turn (first-in-turn): uses num_step_first (fewer steps -> faster)
    - Subsequent sentences:                   uses full num_step (higher quality)

    Call reset_turn() when agent starts thinking to re-enable first-in-turn mode.

    Args:
        url:             Base PAI-EAS endpoint URL (defaults to env PAI_EAS_TTS_URL).
        stream_url:      Specific /stream_api URL (defaults to env PAI_EAS_TTS_STREAM_URL, fallback to url).
        language:        Language code ("vi", "en", ...).
        num_step:        Diffusion steps for regular sentences (higher quality).
        num_step_first:  Diffusion steps for first sentence (fewer -> lower latency).
        instruct:        Voice control string (e.g., "female,Very Low Pitch").
        voice_id:        Preset voice ID on server.
        ref_audio_path:  Path to reference audio file for voice cloning.
        ref_text:        Transcript of ref_audio (used with ref_audio).
        sample_rate:     Output sample rate (default 24,000 Hz).
        num_channels:    Number of channels (default 1 — mono).
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
        self._url = url or os.getenv("PAI_EAS_TTS_URL", DEFAULT_PAI_EAS_TTS_URL)
        self._stream_url = (
            stream_url
            or os.getenv("PAI_EAS_TTS_STREAM_URL")
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
        """Reset first-sentence flag. Call at the start of each agent response turn."""
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
    ) -> "PaiEasChunkedStream":
        if self._first_in_turn:
            num_step = self._num_step_first
            self._first_in_turn = False
        else:
            num_step = self._num_step
        # Normalize numbers → Vietnamese words for TTS, original text unchanged
        spoken_text = normalize_for_tts(text)
        return PaiEasChunkedStream(
            tts=self,
            input_text=spoken_text,
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
            num_step=num_step,
        )


class PaiEasChunkedStream(tts.ChunkedStream):
    """Streams raw int16 PCM chunks from PAI-EAS /stream_api."""

    def __init__(
        self,
        *,
        tts: "PaiEasTTS",
        input_text: str,
        conn_options: APIConnectOptions,
        num_step: int,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._num_step = num_step

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:  # type: ignore[override]
        tts_inst: PaiEasTTS = self._tts  # type: ignore[assignment]

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
