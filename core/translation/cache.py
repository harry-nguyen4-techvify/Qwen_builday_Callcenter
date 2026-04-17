"""
Turn-level translation cache with TTL support.

Caches full turn text (not phrases) with 1-hour TTL.
Uses in-memory LRU cache - no Redis needed.
"""

from __future__ import annotations

import time
import logging
from typing import NamedTuple

logger = logging.getLogger(__name__)


class CacheEntry(NamedTuple):
    """Cached translation with expiration timestamp."""
    translation: str
    expires_at: float


class TranslationCache:
    """
    LRU cache for translation results with TTL support.

    Cache key is (text, source_lang, target_lang) tuple.
    Entries expire after TTL seconds (default 1 hour).
    """

    def __init__(self, maxsize: int = 1000, ttl_seconds: float = 3600.0):
        """
        Initialize the cache.

        Args:
            maxsize: Maximum number of cached entries.
            ttl_seconds: Time-to-live for entries in seconds (default 1 hour).
        """
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._cache: dict[tuple[str, str, str], CacheEntry] = {}
        self._order: list[tuple[str, str, str]] = []  # LRU tracking
        self._hits = 0
        self._misses = 0

    def _make_key(self, text: str, source: str, target: str) -> tuple[str, str, str]:
        """Create normalized cache key."""
        # Normalize: strip whitespace, lowercase for consistent matching
        return (text.strip().lower(), source.lower(), target.lower())

    def get(self, text: str, source: str, target: str) -> str | None:
        """
        Get cached translation.

        Args:
            text: Original text (full turn).
            source: Source language code.
            target: Target language code.

        Returns:
            Cached translation or None if not found/expired.
        """
        key = self._make_key(text, source, target)
        entry = self._cache.get(key)

        if entry is None:
            self._misses += 1
            return None

        # Check TTL
        if time.time() > entry.expires_at:
            # Entry expired, remove it
            self._remove(key)
            self._misses += 1
            logger.debug("Cache entry expired for: %s...", text[:30])
            return None

        # Move to end of LRU order (most recently used)
        if key in self._order:
            self._order.remove(key)
            self._order.append(key)

        self._hits += 1
        logger.debug("Cache hit for: %s...", text[:30])
        return entry.translation

    def set(self, text: str, source: str, target: str, translation: str) -> None:
        """
        Cache a translation result.

        Args:
            text: Original text (full turn).
            source: Source language code.
            target: Target language code.
            translation: Translated text.
        """
        key = self._make_key(text, source, target)

        # If already cached, update and move to end
        if key in self._cache:
            self._order.remove(key)
        elif len(self._cache) >= self._maxsize:
            # Evict oldest entry (LRU)
            self._evict_oldest()

        # Add new entry
        expires_at = time.time() + self._ttl
        self._cache[key] = CacheEntry(translation=translation, expires_at=expires_at)
        self._order.append(key)

        logger.debug("Cached translation for: %s...", text[:30])

    def _remove(self, key: tuple[str, str, str]) -> None:
        """Remove a specific entry."""
        self._cache.pop(key, None)
        if key in self._order:
            self._order.remove(key)

    def _evict_oldest(self) -> None:
        """Evict the least recently used entry."""
        if self._order:
            oldest_key = self._order.pop(0)
            self._cache.pop(oldest_key, None)
            logger.debug("Evicted oldest cache entry")

    def clear(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()
        self._order.clear()
        logger.info("Translation cache cleared")

    def cleanup_expired(self) -> int:
        """
        Remove all expired entries.

        Returns:
            Number of entries removed.
        """
        now = time.time()
        expired_keys = [
            key for key, entry in self._cache.items()
            if now > entry.expires_at
        ]

        for key in expired_keys:
            self._remove(key)

        if expired_keys:
            logger.info("Cleaned up %d expired cache entries", len(expired_keys))

        return len(expired_keys)

    @property
    def stats(self) -> dict[str, int | float]:
        """Get cache statistics."""
        total = self._hits + self._misses
        hit_rate = (self._hits / total * 100) if total > 0 else 0.0
        return {
            "size": len(self._cache),
            "maxsize": self._maxsize,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate_percent": round(hit_rate, 2),
        }

    def __len__(self) -> int:
        return len(self._cache)


# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------

_translation_cache: TranslationCache | None = None


def get_cache() -> TranslationCache:
    """Get or create the global translation cache singleton."""
    global _translation_cache
    if _translation_cache is None:
        _translation_cache = TranslationCache()
    return _translation_cache


def reset_cache() -> None:
    """Reset the global cache (useful for testing)."""
    global _translation_cache
    if _translation_cache is not None:
        _translation_cache.clear()
    _translation_cache = None
