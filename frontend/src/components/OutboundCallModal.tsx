import { useEffect, useState } from 'react'
import Icon from './Icon'
import { listFlows, createOutboundCall } from '../api'

interface OutboundCallModalProps {
  onClose: () => void
  onCreated?: (callId: string, phoneNumber: string) => void
}

export default function OutboundCallModal({ onClose, onCreated }: OutboundCallModalProps) {
  const [flows, setFlows] = useState<string[]>([])
  const [loadingFlows, setLoadingFlows] = useState(true)
  const [flowId, setFlowId] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listFlows()
      .then((list) => {
        if (cancelled) return
        setFlows(list)
        if (list.length > 0) setFlowId(list[0])
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load flows')
      })
      .finally(() => {
        if (!cancelled) setLoadingFlows(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedPhone = phoneNumber.trim()
    if (!trimmedPhone) {
      setError('Phone number is required')
      return
    }
    if (!flowId) {
      setError('Please select a flow')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await createOutboundCall({ flow_id: flowId, phone_number: trimmedPhone })
      onCreated?.(res.id, res.phone_number)
      onClose()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string }
      setError(e.response?.data?.detail || e.message || 'Failed to create call')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-lowest rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-navy font-headline flex items-center gap-2">
            <Icon name="phone_forwarded" className="text-primary" />
            New Outbound Call
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-container transition-colors"
            aria-label="Close"
          >
            <Icon name="close" className="text-on-surface-variant" size={20} />
          </button>
        </div>

        <p className="text-sm text-on-surface-variant mb-4">
          Pick a flow, enter a phone number. The simulator phone (/phone) will ring.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1">
              Flow
            </label>
            {loadingFlows ? (
              <div className="h-10 bg-surface-container animate-pulse rounded-lg" />
            ) : flows.length === 0 ? (
              <div className="text-sm text-error">No flows available</div>
            ) : (
              <select
                value={flowId}
                onChange={(e) => setFlowId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-container rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={submitting}
              >
                {flows.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="e.g. +84 912 345 678"
              className="w-full px-3 py-2 bg-surface-container rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={submitting}
              autoFocus
            />
            <p className="text-xs text-on-surface-variant mt-1">
              This will be shown as the call ID / caller name.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-error/10 rounded-lg text-sm text-error">
              <Icon name="error" size={16} />
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || loadingFlows || flows.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Calling...
                </>
              ) : (
                <>
                  <Icon name="call" size={16} />
                  Call
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
