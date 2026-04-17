"""
gipformer_stt.py — LiveKit Agents STT plugin cho Gipformer

Load model sherpa-onnx trực tiếp, không qua server trung gian.
VAD do LiveKit xử lý (streaming=False → framework tự wrap VAD,
gọi _recognize_impl với đúng một utterance đã segment sẵn).

Yêu cầu:
    pip install sherpa-onnx huggingface_hub numpy livekit-agents

Dùng:
    from gipformer_stt import GipformerSTT

    session = AgentSession(stt=GipformerSTT(), ...)

Override stt_node nếu cần post-process transcript:

    class MyAgent(Agent):
        async def stt_node(self, audio, model_settings):
            async for event in Agent.default.stt_node(self, audio, model_settings):
                yield event
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import numpy as np
import sherpa_onnx
from huggingface_hub import hf_hub_download

from livekit import rtc
from livekit.agents import stt
from livekit.agents.stt import SpeechData, SpeechEvent, SpeechEventType, STTCapabilities
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)
from livekit.agents.utils import AudioBuffer

# ── Hằng số ───────────────────────────────────────────────────────────────────

REPO_ID     = "g-group-ai-lab/gipformer-65M-rnnt"
SAMPLE_RATE = 16_000
FEATURE_DIM = 80

# Đường dẫn mặc định tới thư mục model, tương đối với vị trí file này
_DEFAULT_MODEL_DIR = Path(__file__).parent / "gipformer"


# ── Cấu hình ──────────────────────────────────────────────────────────────────

@dataclass
class GipformerOptions:
    model_dir:       Path   = _DEFAULT_MODEL_DIR
    quantize:        str    = "fp32"          # "int8" | "fp32"
    num_threads:     int    = 4
    decoding_method: str    = "modified_beam_search"
    language:        str    = "vi"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _onnx_name(part: str, quantize: str) -> str:
    suffix = ".int8.onnx" if quantize == "int8" else ".onnx"
    return f"{part}-epoch-35-avg-6{suffix}"


def _download_model(opts: GipformerOptions) -> None:
    """Download các file ONNX + tokens.txt từ HuggingFace nếu chưa có."""
    opts.model_dir.mkdir(parents=True, exist_ok=True)
    needed = [
        _onnx_name("encoder", opts.quantize),
        _onnx_name("decoder", opts.quantize),
        _onnx_name("joiner",  opts.quantize),
        "tokens.txt",
    ]
    for fname in needed:
        dest = opts.model_dir / fname
        if not dest.exists():
            print(f"[GipformerSTT] downloading {fname} ...")
            hf_hub_download(
                repo_id=REPO_ID,
                filename=fname,
                local_dir=str(opts.model_dir),
                local_dir_use_symlinks=False,
            )


def _load_recognizer(opts: GipformerOptions) -> sherpa_onnx.OfflineRecognizer:
    _download_model(opts)
    d = opts.model_dir
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(d / _onnx_name("encoder", opts.quantize)),
        decoder=str(d / _onnx_name("decoder", opts.quantize)),
        joiner=str(d / _onnx_name("joiner",  opts.quantize)),
        tokens=str(d / "tokens.txt"),
        num_threads=opts.num_threads,
        sample_rate=SAMPLE_RATE,
        feature_dim=FEATURE_DIM,
        decoding_method=opts.decoding_method,
        provider="cpu",
    )


def _buffer_to_float32(buffer: AudioBuffer) -> np.ndarray:
    """Gộp AudioBuffer thành mảng float32 mono 16 kHz."""
    frames: list[rtc.AudioFrame] = buffer if isinstance(buffer, list) else [buffer]
    chunks: list[np.ndarray] = []

    for frame in frames:
        samples = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32) / 32768.0

        # mix down to mono
        if frame.num_channels > 1:
            samples = samples.reshape(-1, frame.num_channels).mean(axis=1)

        # resample nếu cần
        if frame.sample_rate != SAMPLE_RATE:
            ratio   = SAMPLE_RATE / frame.sample_rate
            new_len = int(len(samples) * ratio)
            indices = np.linspace(0, len(samples) - 1, new_len)
            samples = np.interp(indices, np.arange(len(samples)), samples).astype(np.float32)

        chunks.append(samples)

    return np.concatenate(chunks) if chunks else np.array([], dtype=np.float32)


def _infer(recognizer: sherpa_onnx.OfflineRecognizer, samples: np.ndarray) -> str:
    """Chạy inference sherpa-onnx, trả về text."""
    stream = recognizer.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    recognizer.decode_stream(stream)
    return stream.result.text.strip()


# ── Plugin chính ──────────────────────────────────────────────────────────────

class GipformerSTT(stt.STT):
    """
    LiveKit Agents STT plugin cho Gipformer Vietnamese ASR.

    streaming=False → LiveKit tự wrap VAD, chỉ gọi _recognize_impl
    khi đã có một utterance hoàn chỉnh.  Không cần VAD thủ công,
    không cần server trung gian — inference trực tiếp trong process.

    Args:
        model_dir:       Thư mục lưu model ONNX (tự download nếu thiếu).
        quantize:        "int8" hoặc "fp32" (mặc định fp32).
        num_threads:     Số CPU threads cho ONNX runtime (mặc định 4).
        decoding_method: "modified_beam_search" | "greedy_search".
        language:        Tag ngôn ngữ BCP-47 gắn vào SpeechData (mặc định "vi").
    """

    def __init__(
        self,
        *,
        model_dir:       Path | str = _DEFAULT_MODEL_DIR,
        quantize:        str = "fp32",
        num_threads:     int = 4,
        decoding_method: str = "modified_beam_search",
        language:        str = "vi",
    ) -> None:
        super().__init__(
            capabilities=STTCapabilities(
                streaming=False,       # LiveKit wrap VAD, gọi _recognize_impl
                interim_results=False,
            )
        )
        self._opts = GipformerOptions(
            model_dir=Path(model_dir),
            quantize=quantize,
            num_threads=num_threads,
            decoding_method=decoding_method,
            language=language,
        )
        # Load model một lần, giữ trong memory suốt vòng đời agent
        self._recognizer = _load_recognizer(self._opts)

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> SpeechEvent:
        """
        Nhận một AudioBuffer (utterance hoàn chỉnh đã được LiveKit VAD cắt),
        chạy inference sherpa-onnx trong executor (không block event loop),
        trả về SpeechEvent FINAL_TRANSCRIPT.
        """
        lang     = language if language is not NOT_GIVEN else self._opts.language
        samples  = _buffer_to_float32(buffer)
        duration = len(samples) / SAMPLE_RATE

        loop = asyncio.get_running_loop()
        text = await loop.run_in_executor(
            None,                          # default ThreadPoolExecutor
            _infer,
            self._recognizer,
            samples,
        )

        return SpeechEvent(
            type=SpeechEventType.FINAL_TRANSCRIPT,
            request_id=str(uuid.uuid4()),
            alternatives=[
                SpeechData(
                    text=text,
                    language=str(lang),
                    start_time=0.0,
                    end_time=duration,
                    confidence=1.0,
                )
            ],
        )
