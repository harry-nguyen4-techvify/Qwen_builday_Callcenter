import { useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptMessage } from '../types'

const API = import.meta.env.VITE_API_URL ?? ''

/**
 * Client-side translation: for each FINAL transcript message that is NOT yet translated,
 * call /api/translate and cache results. Uses isTranslated flag as primary check.
 * Toggle OFF hides translations but keeps cache — toggling back ON is instant.
 */
export function useMessageTranslations(
  messages: TranscriptMessage[],
  enabled: boolean,
  source = 'vi',
  target = 'en',
): TranscriptMessage[] {
  const cacheRef = useRef<Map<string, string>>(new Map())
  const pendingRef = useRef<Set<string>>(new Set())
  const [, forceUpdate] = useState(0)

  const keyOf = (m: TranscriptMessage) => `${m.turnIndex}::${m.role}::${(m.text ?? '').trim()}`

  useEffect(() => {
    if (!enabled) return
    const abort = new AbortController()

    // Only translate messages that are final, have text, and are NOT yet translated
    const toFetch = messages.filter(
      (m) =>
        m.isFinal &&
        m.text &&
        m.text.trim().length > 0 &&
        !m.isTranslated &&
        !m.translation &&
        !cacheRef.current.has(keyOf(m)) &&
        !pendingRef.current.has(keyOf(m)),
    )

    toFetch.forEach(async (m) => {
      const k = keyOf(m)
      pendingRef.current.add(k)
      try {
        const res = await fetch(`${API}/api/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: m.text.trim(), source_lang: source, target_lang: target }),
          signal: abort.signal,
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          console.error('[translate] HTTP', res.status, body)
          return
        }
        const data: { translated?: string } = await res.json()
        const translated = data.translated ?? null
        if (translated && translated !== m.text.trim()) {
          cacheRef.current.set(k, translated)
          forceUpdate((n) => n + 1)
        } else {
          console.warn('[translate] backend returned same text (likely misconfigured DASHSCOPE_API_KEY):', {
            text: m.text.trim(),
            translated,
          })
          // '__SAME__' sentinel — don't re-request but don't display anything
          cacheRef.current.set(k, '__SAME__')
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.warn('[useMessageTranslations] translate failed:', e)
        }
      } finally {
        pendingRef.current.delete(k)
      }
    })

    return () => abort.abort()
  }, [messages, enabled, source, target])

  return useMemo(() => {
    if (!enabled) return messages
    return messages.map((m) => {
      if (!m.isFinal) return m
      const cached = cacheRef.current.get(keyOf(m))
      if (cached && cached.length > 0 && cached !== '__SAME__') {
        return { ...m, translation: cached }
      }
      return m
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, enabled])
}
