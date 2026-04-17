import { useState, useEffect, useCallback, useRef } from 'react'
import type { Call, CallEvent } from '../types'
import { listCalls } from '../api'

interface UseCallsStreamResult {
  calls: Call[]
  connected: boolean
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Hook to connect to SSE call stream for real-time updates.
 *
 * - Fetches initial data via REST API
 * - Subscribes to SSE for real-time updates
 * - Merges events into local state
 * - Handles reconnection automatically
 */
export function useCallsStream(): UseCallsStreamResult {
  const [calls, setCalls] = useState<Call[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Fetch initial data
  const fetchCalls = useCallback(async () => {
    setLoading(true)
    try {
      const response = await listCalls({ limit: 100 })
      setCalls(response.calls)
      setError(null)
    } catch (err) {
      setError('Failed to fetch calls')
      console.error('Failed to fetch calls:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Connect to SSE
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const url = `${baseUrl}/api/calls/stream`

    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onopen = () => {
      setConnected(true)
      setError(null)
    }

    // Handle call-started
    es.addEventListener('call-started', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        const newCall = data.call
        if (newCall) {
          setCalls((prev) => {
            // Check if already exists (avoid duplicates)
            if (prev.some((c) => c.id === data.call_id)) {
              return prev
            }
            // Add to beginning (newest first)
            return [newCall, ...prev]
          })
        }
      } catch (e) {
        console.error('Failed to parse call-started event:', e)
      }
    })

    // Handle call-updated
    es.addEventListener('call-updated', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        setCalls((prev) =>
          prev.map((c) =>
            c.id === data.call_id
              ? { ...c, ...data.call }
              : c
          )
        )
      } catch (e) {
        console.error('Failed to parse call-updated event:', e)
      }
    })

    // Handle escalation state changes — flip card flag in-place
    es.addEventListener('call-escalation-requested', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        setCalls((prev) =>
          prev.map((c) =>
            c.id === data.call_id ? { ...c, escalation_requested: true } : c
          )
        )
      } catch (e) {
        console.error('Failed to parse call-escalation-requested event:', e)
      }
    })

    es.addEventListener('call-escalation-cleared', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        setCalls((prev) =>
          prev.map((c) =>
            c.id === data.call_id ? { ...c, escalation_requested: false } : c
          )
        )
      } catch (e) {
        console.error('Failed to parse call-escalation-cleared event:', e)
      }
    })

    es.addEventListener('call-card-locked', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        setCalls((prev) =>
          prev.map((c) =>
            c.id === data.call_id ? { ...c, card_locked: true } : c
          )
        )
      } catch (e) {
        console.error('Failed to parse call-card-locked event:', e)
      }
    })

    // Handle call-ended
    es.addEventListener('call-ended', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        setCalls((prev) =>
          prev.map((c) =>
            c.id === data.call_id
              ? {
                  ...c,
                  status: 'completed' as const,
                  ended_at: data.ended_at || new Date().toISOString(),
                }
              : c
          )
        )
      } catch (e) {
        console.error('Failed to parse call-ended event:', e)
      }
    })

    // Heartbeat - just for keep-alive
    es.addEventListener('heartbeat', () => {
      // Connection is alive
    })

    es.onerror = () => {
      setConnected(false)
      // EventSource auto-reconnects silently
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [])

  // Initial fetch + SSE connect
  useEffect(() => {
    fetchCalls()
    const cleanup = connect()
    return () => cleanup?.()
  }, [fetchCalls, connect])

  // Manual refresh
  const refresh = useCallback(async () => {
    await fetchCalls()
  }, [fetchCalls])

  return {
    calls,
    connected,
    error,
    loading,
    refresh,
  }
}
