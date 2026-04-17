import { useState, useEffect, useCallback, useRef } from 'react'
import type { TranscriptMessage, TranscriptEvent } from '../types'

interface UseTranscriptStreamOptions {
  callId: string
  enabled?: boolean
}

interface UseTranscriptStreamResult {
  messages: TranscriptMessage[]
  connected: boolean
  error: string | null
  disconnect: () => void
  reconnect: () => void
}

/**
 * Hook to connect to SSE transcript stream for a live call.
 * Handles interim vs final messages, auto-reconnection via EventSource.
 */
export function useTranscriptStream({
  callId,
  enabled = true,
}: UseTranscriptStreamOptions): UseTranscriptStreamResult {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    if (!enabled || !callId) return

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const url = `${baseUrl}/api/calls/${callId}/transcript/stream`

    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => {
      setConnected(true)
      setError(null)
    }

    // Listen for transcript events
    es.addEventListener('transcript', (event) => {
      try {
        const data: TranscriptEvent = JSON.parse(event.data)

        const msg: TranscriptMessage = {
          id: `${data.turn_index}-${data.is_final ? 'final' : 'interim'}-${Date.now()}`,
          role: data.role,
          text: data.text,
          timestamp: new Date(data.timestamp).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          isFinal: data.is_final,
          turnIndex: data.turn_index,
          translation: data.translation,
          isTranslated: data.is_translated ?? (data.translation != null),
          isLive: !data.is_final,
        }

        setMessages((prev) => {
          // If this is a final message, remove any interim for the same turn
          if (msg.isFinal) {
            const filtered = prev.filter(
              (m) => m.turnIndex !== msg.turnIndex || m.isFinal
            )
            return [...filtered, msg]
          } else {
            // Update existing interim or add new one
            const existingIdx = prev.findIndex(
              (m) => m.turnIndex === msg.turnIndex && !m.isFinal
            )
            if (existingIdx >= 0) {
              const updated = [...prev]
              updated[existingIdx] = msg
              return updated
            }
            return [...prev, msg]
          }
        })
      } catch (e) {
        console.error('Failed to parse transcript event:', e)
      }
    })

    // Heartbeat events - just for keep-alive, no action needed
    es.addEventListener('heartbeat', () => {
      // Connection is alive
    })

    es.onerror = () => {
      setConnected(false)
      setError('Connection lost. Reconnecting...')
      // EventSource auto-reconnects by default
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [callId, enabled])

  useEffect(() => {
    const cleanup = connect()
    return () => cleanup?.()
  }, [connect])

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    setConnected(false)
  }, [])

  const reconnect = useCallback(() => {
    disconnect()
    // Small delay before reconnecting
    setTimeout(() => {
      connect()
    }, 100)
  }, [disconnect, connect])

  return {
    messages,
    connected,
    error,
    disconnect,
    reconnect,
  }
}
