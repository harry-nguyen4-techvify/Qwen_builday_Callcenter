"""
Qwen Flash Translation Service.

Uses qwen-mt-flash model via OpenAI-compatible API for real-time
transcript translation. Supports streaming and caching.

Environment variables:
    DASHSCOPE_API_KEY: API key for Alibaba Cloud DashScope
    QWEN_TRANSLATE_MODEL: Model name (default: qwen-mt-flash)
    QWEN_TRANSLATE_BASE_URL: API base URL (default: dashscope.aliyuncs.com)
"""

from __future__ import annotations

import os
import logging
import asyncio
from typing import AsyncIterator

from openai import AsyncOpenAI, APIError, RateLimitError, APITimeoutError

from core.translation.cache import get_cache, TranslationCache

logger = logging.getLogger(__name__)

# Language code mapping for display names
LANGUAGE_NAMES = {
    "vi": "Vietnamese",
    "en": "English",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "ru": "Russian",
    "th": "Thai",
}


class QwenTranslator:
    """
    Qwen MT Flash translator with streaming and caching support.

    Uses OpenAI-compatible API provided by Alibaba Cloud DashScope.
    Optimized for real-time transcript translation with <500ms latency.
    """

    DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    DEFAULT_MODEL = "qwen-mt-flash"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 10.0,
        max_retries: int = 2,
    ):
        """
        Initialize the translator.

        Args:
            api_key: DashScope API key (default from DASHSCOPE_API_KEY env).
            base_url: API base URL (default from QWEN_TRANSLATE_BASE_URL env).
            model: Model name (default from QWEN_TRANSLATE_MODEL env).
            timeout: Request timeout in seconds.
            max_retries: Max retries on transient errors.
        """
        self.api_key = api_key or os.environ.get("DASHSCOPE_API_KEY", "")
        self.base_url = base_url or os.environ.get(
            "QWEN_TRANSLATE_BASE_URL",
            self.DEFAULT_BASE_URL
        )
        self.model = model or os.environ.get(
            "QWEN_TRANSLATE_MODEL",
            self.DEFAULT_MODEL
        )
        self.timeout = timeout
        self.max_retries = max_retries

        self._client: AsyncOpenAI | None = None
        self._cache: TranslationCache = get_cache()

        # Rate limit tracking (100 req/min)
        self._request_count = 0
        self._rate_limit_reset: float = 0.0

    def _get_client(self) -> AsyncOpenAI:
        """Get or create the async OpenAI client."""
        if self._client is None:
            if not self.api_key:
                raise ValueError(
                    "DASHSCOPE_API_KEY not set. Please set the environment variable."
                )
            self._client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_retries=self.max_retries,
            )
        return self._client

    def _build_system_prompt(self, source: str, target: str) -> str:
        """Build the system prompt for translation."""
        source_name = LANGUAGE_NAMES.get(source, source)
        target_name = LANGUAGE_NAMES.get(target, target)
        return (
            f"You are a professional translator. Translate the following text "
            f"from {source_name} to {target_name}. "
            f"Output ONLY the translation, nothing else. "
            f"Preserve the original meaning and tone."
        )

    async def translate(
        self,
        text: str,
        source: str = "vi",
        target: str = "en",
        use_cache: bool = True,
    ) -> str:
        """
        Translate text synchronously (non-streaming).

        Args:
            text: Text to translate (full turn).
            source: Source language code (default: Vietnamese).
            target: Target language code (default: English).
            use_cache: Whether to use cache (default: True).

        Returns:
            Translated text. Returns original text on error (graceful degradation).
        """
        if not text or not text.strip():
            return ""

        text = text.strip()

        # Check cache first
        if use_cache:
            cached = self._cache.get(text, source, target)
            if cached is not None:
                return cached

        if not self.api_key:
            logger.error(
                "Translation requested but DASHSCOPE_API_KEY is not set — returning original text"
            )
            return text

        try:
            client = self._get_client()

            response = await client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": text}],
                extra_body={
                    "translation_options": {
                        "source_lang": LANGUAGE_NAMES.get(source, source),
                        "target_lang": LANGUAGE_NAMES.get(target, target),
                    }
                },
            )

            translation = response.choices[0].message.content
            if translation:
                translation = translation.strip()

                # Cache the result
                if use_cache and translation:
                    self._cache.set(text, source, target, translation)

                logger.debug(
                    "Translated (%s->%s): %s... -> %s...",
                    source, target, text[:30], translation[:30]
                )
                return translation

            return text  # Fallback to original

        except RateLimitError as e:
            logger.warning("Rate limit hit: %s", e)
            # Could implement backoff here
            return text

        except APITimeoutError as e:
            logger.warning("Translation timeout: %s", e)
            return text

        except APIError as e:
            logger.error("Translation API error: %s", e)
            return text

        except Exception as e:
            logger.error(
                "Unexpected translation error: %s: %s", type(e).__name__, e, exc_info=True
            )
            return text

    async def translate_streaming(
        self,
        text: str,
        source: str = "vi",
        target: str = "en",
    ) -> AsyncIterator[str]:
        """
        Translate text with streaming output.

        Yields translation chunks as they arrive. Useful for long texts
        where you want to show progress to the user.

        Args:
            text: Text to translate.
            source: Source language code.
            target: Target language code.

        Yields:
            Translation text chunks.
        """
        if not text or not text.strip():
            return

        text = text.strip()
        full_translation = ""

        try:
            client = self._get_client()

            stream = await client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": text}],
                extra_body={
                    "translation_options": {
                        "source_lang": LANGUAGE_NAMES.get(source, source),
                        "target_lang": LANGUAGE_NAMES.get(target, target),
                    }
                },
                stream=True,
            )

            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    full_translation += content
                    yield content

            # Cache the complete translation
            if full_translation:
                self._cache.set(text, source, target, full_translation)

        except RateLimitError as e:
            logger.warning("Rate limit hit during streaming: %s", e)
            # Yield original text as fallback
            yield text

        except APITimeoutError as e:
            logger.warning("Streaming translation timeout: %s", e)
            yield text

        except APIError as e:
            logger.error("Streaming translation API error: %s", e)
            yield text

        except Exception as e:
            logger.error("Unexpected streaming error: %s", e)
            yield text

    async def translate_batch(
        self,
        texts: list[str],
        source: str = "vi",
        target: str = "en",
        use_cache: bool = True,
    ) -> list[str]:
        """
        Translate multiple texts concurrently.

        Args:
            texts: List of texts to translate.
            source: Source language code.
            target: Target language code.
            use_cache: Whether to use cache.

        Returns:
            List of translated texts in same order.
        """
        if not texts:
            return []

        tasks = [
            self.translate(text, source, target, use_cache)
            for text in texts
        ]

        return await asyncio.gather(*tasks)

    @property
    def cache_stats(self) -> dict:
        """Get cache statistics."""
        return self._cache.stats

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client is not None:
            await self._client.close()
            self._client = None


# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------

_translator: QwenTranslator | None = None


def get_translator() -> QwenTranslator:
    """Get or create the global translator singleton."""
    global _translator
    if _translator is None:
        _translator = QwenTranslator()
    return _translator


async def shutdown_translator() -> None:
    """Shutdown the global translator (cleanup)."""
    global _translator
    if _translator is not None:
        await _translator.close()
        _translator = None
