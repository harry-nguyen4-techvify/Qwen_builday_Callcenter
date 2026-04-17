import { useEffect, useState } from 'react'
import type { TranscriptMessage } from '../types'

interface UseTranscriptHistoryResult {
  history: TranscriptMessage[]
  loading: boolean
  error: string | null
}

interface TurnDto {
  turn_index: number
  role: 'agent' | 'customer' | 'system'
  text: string
  timestamp: string
  translation: string | null
  is_translated: boolean
}

export function useTranscriptHistory(callId: string, enabled = true): UseTranscriptHistoryResult {
  const [history, setHistory] = useState<TranscriptMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !callId) return
    let aborted = false
    const controller = new AbortController()

    const fetchHistory = async () => {
      setLoading(true)
      setError(null)
      try {
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
        const res = await fetch(`${baseUrl}/api/calls/${callId}/transcript`, {
          signal: controller.signal,
        })
        if (res.status === 404) {
          if (!aborted) setHistory([])
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: { turns?: TurnDto[]; history?: TurnDto[] } = await res.json()
        if (aborted) return
        const turns: TurnDto[] = data.turns ?? data.history ?? []
        const messages: TranscriptMessage[] = turns.map((t) => ({
          id: `hist-${t.turn_index}-${t.role}`,
          role: t.role,
          text: t.text,
          timestamp: new Date(t.timestamp).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          isFinal: true,
          turnIndex: t.turn_index,
          translation: t.translation ?? undefined,
          isTranslated: t.is_translated,
          isLive: false,
        }))
        setHistory(messages)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        if (!aborted) setError((e as Error).message)
      } finally {
        if (!aborted) setLoading(false)
      }
    }

    fetchHistory()

    return () => {
      aborted = true
      controller.abort()
    }
  }, [callId, enabled])

  return { history, loading, error }
}
