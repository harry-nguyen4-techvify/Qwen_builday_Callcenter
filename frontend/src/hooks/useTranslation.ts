import { useState, useCallback } from 'react'

interface UseTranslationOptions {
  callId: string
  defaultEnabled?: boolean
  defaultSource?: string
  defaultTarget?: string
}

interface UseTranslationResult {
  enabled: boolean
  loading: boolean
  source: string
  target: string
  toggle: () => Promise<void>
  setSource: (lang: string) => void
  setTarget: (lang: string) => void
}

/**
 * Hook to manage translation toggle for a live call.
 * Calls backend API to enable/disable real-time translation.
 */
export function useTranslation({
  callId,
  defaultEnabled = false,
  defaultSource = 'vi',
  defaultTarget = 'en',
}: UseTranslationOptions): UseTranslationResult {
  const [enabled, setEnabled] = useState(defaultEnabled)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState(defaultSource)
  const [target, setTarget] = useState(defaultTarget)

  const toggle = useCallback(async () => {
    if (!callId) return

    setLoading(true)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      const newEnabled = !enabled

      const response = await fetch(`${baseUrl}/api/calls/${callId}/translation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: newEnabled,
          source,
          target,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to toggle translation')
      }

      setEnabled(newEnabled)
    } catch (e) {
      console.error('Translation toggle error:', e)
    } finally {
      setLoading(false)
    }
  }, [callId, enabled, source, target])

  return {
    enabled,
    loading,
    source,
    target,
    toggle,
    setSource,
    setTarget,
  }
}
