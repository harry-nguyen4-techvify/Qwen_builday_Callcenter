import { useState, useEffect, useRef } from 'react'
import type { FormFieldState, FormFieldInfo } from '../types'

interface UseFormStateResult {
  fields: FormFieldState[]
  confirmed: boolean
  completed: boolean
  connected: boolean
  error: string | null
}

export function useFormState(callId: string, enabled: boolean): UseFormStateResult {
  const [fields, setFields] = useState<FormFieldState[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!callId || !enabled) {
      return
    }

    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const es = new EventSource(`${baseUrl}/api/calls/${callId}/form/stream`)
    eventSourceRef.current = es

    es.onopen = () => {
      setConnected(true)
      setError(null)
    }

    es.addEventListener('form-init', (event) => {
      const data = JSON.parse(event.data)
      if (data.fields) {
        setFields(data.fields.map((f: FormFieldInfo) => ({
          ...f,
          value: null,
          validated: false,
          attempts: 0,
        })))
      }
    })

    es.addEventListener('field-update', (event) => {
      const data = JSON.parse(event.data)
      setFields(prev => {
        const existing = prev.find(f => f.id === data.field_id)
        if (existing) {
          return prev.map(f =>
            f.id === data.field_id
              ? { ...f, value: data.value, validated: data.validated, attempts: data.attempts }
              : f
          )
        }
        // Computed/pseudo field — append to the grid so it displays under the
        // actual collect fields (e.g. is_true_credential after check_credential).
        return [
          ...prev,
          {
            id: data.field_id,
            label: data.field_id,
            field_type: 'boolean',
            value: data.value,
            validated: data.validated,
            attempts: data.attempts ?? 0,
          } as FormFieldState,
        ]
      })
    })

    es.addEventListener('form-confirmed', () => {
      setConfirmed(true)
    })

    es.addEventListener('form-completed', () => {
      setCompleted(true)
    })

    es.addEventListener('heartbeat', () => {
      // Keep-alive, nothing to do
    })

    es.onerror = () => {
      setConnected(false)
      setError('Connection lost')
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [callId, enabled])

  return { fields, confirmed, completed, connected, error }
}
