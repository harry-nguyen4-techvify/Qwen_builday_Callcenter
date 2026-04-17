"""
Configure your LLM, STT, and TTS providers here.

Example with OpenAI-compatible providers:
    from livekit.plugins.openai import LLM, STT, TTS
    def make_llm(): return LLM(model="gpt-4o-mini")

Example with mixed providers:
    from livekit.plugins.openai import LLM
    from livekit.plugins.deepgram import STT
    from livekit.plugins.azure import TTS

    def make_llm(): return LLM(model="gpt-4o-mini")
    def make_stt(): return STT()
    def make_tts(): return TTS(voice="vi-VN-NamMinhNeural")

User fills in these functions with their chosen LiveKit plugin
(e.g. livekit-plugins-openai, livekit-plugins-deepgram, livekit-plugins-azure, etc.)
"""


import os

from livekit.plugins.openai import LLM
from core.providers_registry.stt.gipformer_stt import GipformerSTT
from core.providers_registry.tts.custom_tts import ModalTTS  # original
from core.providers_registry.tts.gtts_tts import GoogleTTS  # temporary


def make_llm():
    return LLM(
        model=os.environ["FLOW_DESIGNER_MODEL"],
        base_url=os.environ["FLOW_DESIGNER_BASE_URL"],
        api_key=os.environ["FLOW_DESIGNER_API_KEY"],
    )


def make_stt():
    return GipformerSTT()


def make_tts():
    # --- Original ModalTTS (uncomment to restore) ---
    return ModalTTS(
        url="https://nguyentatchien0122--omnivoice-omnivoiceservice-api.modal.run",
        stream_url="https://nguyentatchien0122--omnivoice-omnivoiceservice-stream-api.modal.run",
        voice_id="shinhan_voice",
        language="vi",
        instruct="female,Very Low Pitch",
        num_step_first=16,
        num_step=32,
    )
    # --- Temporary gTTS ---
    # return GoogleTTS(language="vi")
