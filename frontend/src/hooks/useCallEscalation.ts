import { useEffect, useRef, useState } from 'react'
import type { CallEvent } from '../types'

interface UseCallEscalationResult {
  escalationRequested: boolean
  escalationReason: string | null
  cardLocked: boolean
}

/**
 * Per-call hook that listens to the global /api/calls/stream SSE and extracts
 * escalation + card-lock events for a single callId. Used by LiveCallConsole
 * to drive the "Join as human" button + lock badge.
 */
export function useCallEscalation(callId: string | undefined | null): UseCallEscalationResult {
  const [escalationRequested, setEscalationRequested] = useState(false)
  const [escalationReason, setEscalationReason] = useState<string | null>(null)
  const [cardLocked, setCardLocked] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!callId) return

    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const es = new EventSource(`${baseUrl}/api/calls/stream`)
    esRef.current = es

    const matches = (data: CallEvent) => {
      // The agent may send events keyed by either DB UUID or room name; accept both.
      return data.call_id === callId
    }

    es.addEventListener('call-escalation-requested', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        if (!matches(data)) return
        setEscalationRequested(true)
        setEscalationReason(data.reason ?? null)
      } catch (e) {
        console.error('Failed to parse call-escalation-requested:', e)
      }
    })

    es.addEventListener('call-escalation-cleared', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        if (!matches(data)) return
        setEscalationRequested(false)
      } catch (e) {
        console.error('Failed to parse call-escalation-cleared:', e)
      }
    })

    es.addEventListener('call-card-locked', (event) => {
      try {
        const data: CallEvent = JSON.parse(event.data)
        if (!matches(data)) return
        setCardLocked(true)
      } catch (e) {
        console.error('Failed to parse call-card-locked:', e)
      }
    })

    return () => {
      es.close()
      esRef.current = null
    }
  }, [callId])

  return { escalationRequested, escalationReason, cardLocked }
}
