"""
gtts_tts.py — LiveKit Agents TTS plugin using gTTS (Google Text-to-Speech)

Temporary replacement for ModalTTS using Google's free TTS service.
No API key needed. Higher latency than streaming solutions since
gTTS generates the full audio before returning.

Requirements:
    pip install gTTS av livekit-agents

Usage:
    from core.providers_registry.tts.gtts_tts import GoogleTTS

    tts_plugin = GoogleTTS(language="vi")
    session = AgentSession(tts=tts_plugin, ...)
"""

from __future__ import annotations

import asyncio
import io
import logging
from concurrent.futures import ThreadPoolExecutor

import av
from gtts import gTTS as _gTTS

from livekit.agents import (
    APIConnectOptions,
    DEFAULT_API_CONNECT_OPTIONS,
    tts,
    utils,
)
from core.providers_registry.tts.tts_normalizer import normalize_for_tts

logger = logging.getLogger("gtts-tts")

_executor = ThreadPoolExecutor(max_workers=2)


def _synthesize_sync(text: str, language: str, target_rate: int = 24_000) -> bytes:
    """Run gTTS synchronously and return raw int16 PCM bytes at target_rate mono."""
    mp3_buf = io.BytesIO()
    tts_obj = _gTTS(text=text, lang=language)
    tts_obj.write_to_fp(mp3_buf)
    mp3_buf.seek(0)

    # Decode MP3 -> raw PCM int16 @ target_rate mono via PyAV
    pcm_frames: list[bytes] = []
    container = av.open(mp3_buf, format="mp3")
    resampler = av.AudioResampler(format="s16", layout="mono", rate=target_rate)
    for frame in container.decode(audio=0):
        for resampled in resampler.resample(frame):
            pcm_frames.append(bytes(resampled.planes[0]))
    container.close()

    return b"".join(pcm_frames)


class GoogleTTS(tts.TTS):
    """
    LiveKit TTS plugin wrapping gTTS (Google Text-to-Speech).

    Args:
        language:     Language code ("vi", "en", ...).
        sample_rate:  Output sample rate (default 24 000 Hz to match ModalTTS).
        num_channels: Number of audio channels (default 1 — mono).
    """

    def __init__(
        self,
        *,
        language: str = "vi",
        sample_rate: int = 48_000,
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
        self._language = language

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions | None = None,
    ) -> "GoogleTTSChunkedStream":
        # Normalize numbers → Vietnamese words for TTS, original text unchanged
        spoken_text = normalize_for_tts(text)
        return GoogleTTSChunkedStream(
            tts=self,
            input_text=spoken_text,
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
        )


class GoogleTTSChunkedStream(tts.ChunkedStream):
    """Generates audio via gTTS, decodes MP3 to PCM, emits in 4 KB chunks."""

    def __init__(
        self,
        *,
        tts: "GoogleTTS",
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        tts_inst: GoogleTTS = self._tts  # type: ignore[assignment]

        pcm_data = await asyncio.get_running_loop().run_in_executor(
            _executor,
            _synthesize_sync,
            self.input_text,
            tts_inst._language,
            tts_inst.sample_rate,
        )

        output_emitter.initialize(
            request_id=utils.shortuuid(),
            sample_rate=tts_inst.sample_rate,
            num_channels=tts_inst.num_channels,
            mime_type="audio/pcm",
        )

        chunk_size = 4096
        for i in range(0, len(pcm_data), chunk_size):
            output_emitter.push(pcm_data[i : i + chunk_size])
