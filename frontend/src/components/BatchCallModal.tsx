import { useEffect, useState, useCallback } from 'react'
import Icon from './Icon'
import { listFlows } from '../api'
import type { Call } from '../types'

interface BatchCallModalProps {
  onClose: () => void
  onBatchCreated: (calls: Call[]) => void
}

function generateMockCallId(): string {
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseCSV(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const phones: string[] = []

  for (const line of lines) {
    // Handle comma-separated or single column
    const parts = line.split(',')
    for (const part of parts) {
      const trimmed = part.trim().replace(/['"]/g, '')
      // Basic phone validation - allow digits, spaces, +, -, ()
      if (trimmed && /^[\d\s+\-()]+$/.test(trimmed) && trimmed.replace(/\D/g, '').length >= 8) {
        phones.push(trimmed)
      }
    }
  }

  return [...new Set(phones)] // Remove duplicates
}

export default function BatchCallModal({ onClose, onBatchCreated }: BatchCallModalProps) {
  const [flows, setFlows] = useState<string[]>([])
  const [loadingFlows, setLoadingFlows] = useState(true)
  const [flowId, setFlowId] = useState('')
  const [phoneNumbers, setPhoneNumbers] = useState<string[]>([])
  const [rawText, setRawText] = useState('')
  const [step, setStep] = useState<'upload' | 'preview' | 'confirm'>('upload')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

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

  const handleFileChange = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setRawText(text)
      const parsed = parseCSV(text)
      if (parsed.length === 0) {
        setError('No valid phone numbers found in file')
        return
      }
      setPhoneNumbers(parsed)
      setStep('preview')
      setError(null)
    }
    reader.onerror = () => setError('Failed to read file')
    reader.readAsText(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
      handleFileChange(file)
    } else {
      setError('Please upload a CSV or TXT file')
    }
  }, [handleFileChange])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileChange(file)
  }

  const handleTextParse = () => {
    const parsed = parseCSV(rawText)
    if (parsed.length === 0) {
      setError('No valid phone numbers found')
      return
    }
    setPhoneNumbers(parsed)
    setStep('preview')
    setError(null)
  }

  const removePhone = (index: number) => {
    setPhoneNumbers((prev) => prev.filter((_, i) => i !== index))
  }

  const handleConfirm = () => {
    if (!flowId) {
      setError('Please select a flow')
      return
    }
    if (phoneNumbers.length === 0) {
      setError('No phone numbers to call')
      return
    }

    const now = new Date().toISOString()
    const mockCalls: Call[] = phoneNumbers.map((phone) => ({
      id: generateMockCallId(),
      caller_number: phone,
      customer_name: phone,
      status: 'ringing' as const,
      disposition: null,
      direction: 'outbound' as const,
      flow_id: flowId,
      flow_name: flowId,
      queued_at: now,
      answered_at: null,
      ended_at: null,
      duration_seconds: null,
      livekit_room: `mock-room-${Date.now()}`,
      escalation_requested: false,
      card_locked: false,
    }))

    onBatchCreated(mockCalls)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-lowest rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-navy font-headline flex items-center gap-2">
            <Icon name="group_add" className="text-primary" />
            Batch Outbound Calls
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-container transition-colors"
            aria-label="Close"
          >
            <Icon name="close" className="text-on-surface-variant" size={20} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-4 text-xs">
          <span className={`px-2 py-1 rounded ${step === 'upload' ? 'bg-primary text-white' : 'bg-surface-container text-on-surface-variant'}`}>
            1. Upload
          </span>
          <Icon name="chevron_right" size={14} className="text-on-surface-variant" />
          <span className={`px-2 py-1 rounded ${step === 'preview' ? 'bg-primary text-white' : 'bg-surface-container text-on-surface-variant'}`}>
            2. Preview
          </span>
          <Icon name="chevron_right" size={14} className="text-on-surface-variant" />
          <span className={`px-2 py-1 rounded ${step === 'confirm' ? 'bg-primary text-white' : 'bg-surface-container text-on-surface-variant'}`}>
            3. Confirm
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {step === 'upload' && (
            <div className="space-y-4">
              {/* Flow selection */}
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">
                  Select Flow
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
                  >
                    {flows.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* File drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  dragOver ? 'border-primary bg-primary/5' : 'border-outline-variant'
                }`}
              >
                <Icon name="upload_file" size={48} className="text-on-surface-variant mx-auto mb-3" />
                <p className="text-sm text-on-surface mb-2">
                  Drag & drop a CSV file here, or click to browse
                </p>
                <p className="text-xs text-on-surface-variant mb-4">
                  One phone number per line, or comma-separated
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold cursor-pointer hover:bg-primary/90 transition-colors">
                  <Icon name="folder_open" size={16} />
                  Browse Files
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleInputChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Or paste text */}
              <div className="relative">
                <div className="absolute inset-x-0 top-0 flex items-center justify-center">
                  <span className="bg-surface-container-lowest px-3 text-xs text-on-surface-variant -mt-2">
                    or paste numbers
                  </span>
                </div>
                <div className="border-t border-outline-variant" />
              </div>

              <div>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="0912345678&#10;0987654321&#10;+84 123 456 789"
                  rows={4}
                  className="w-full px-3 py-2 bg-surface-container rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                />
                <button
                  onClick={handleTextParse}
                  disabled={!rawText.trim()}
                  className="mt-2 px-4 py-2 bg-surface-container text-on-surface rounded-lg text-sm font-medium hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Parse Numbers
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-on-surface-variant">
                  Found <strong className="text-on-surface">{phoneNumbers.length}</strong> phone numbers
                </span>
                <button
                  onClick={() => setStep('upload')}
                  className="text-sm text-primary hover:underline"
                >
                  Re-upload
                </button>
              </div>

              <div className="bg-surface-container rounded-lg p-3 max-h-60 overflow-y-auto">
                <div className="space-y-1">
                  {phoneNumbers.map((phone, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-surface-container-lowest group"
                    >
                      <span className="text-sm font-mono">{phone}</span>
                      <button
                        onClick={() => removePhone(idx)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 transition-all"
                        title="Remove"
                      >
                        <Icon name="close" size={14} className="text-error" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-warning/10 rounded-lg p-3 flex items-start gap-2">
                <Icon name="info" size={18} className="text-warning mt-0.5" />
                <p className="text-xs text-warning">
                  These calls are <strong>mock only</strong> — they won't actually dial.
                  Data will be lost on page reload.
                </p>
              </div>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-surface-container rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Icon name="phone_forwarded" className="text-primary" size={20} />
                  </div>
                  <div>
                    <div className="font-bold text-on-surface">{phoneNumbers.length} Outbound Calls</div>
                    <div className="text-xs text-on-surface-variant">Flow: {flowId}</div>
                  </div>
                </div>
                <div className="border-t border-outline-variant pt-3 mt-3">
                  <div className="text-xs text-on-surface-variant mb-2">Phone numbers:</div>
                  <div className="flex flex-wrap gap-1">
                    {phoneNumbers.slice(0, 5).map((p, i) => (
                      <span key={i} className="px-2 py-0.5 bg-surface-container-lowest rounded text-xs font-mono">
                        {p}
                      </span>
                    ))}
                    {phoneNumbers.length > 5 && (
                      <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-bold">
                        +{phoneNumbers.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/10 rounded-lg text-sm text-error mt-4">
            <Icon name="error" size={16} />
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 justify-end pt-4 mt-4 border-t border-outline-variant">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            Cancel
          </button>

          {step === 'preview' && (
            <button
              onClick={() => setStep('confirm')}
              disabled={phoneNumbers.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
              <Icon name="arrow_forward" size={16} />
            </button>
          )}

          {step === 'confirm' && (
            <>
              <button
                onClick={() => setStep('preview')}
                className="px-4 py-2 rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-success text-white hover:bg-success/90 transition-colors flex items-center gap-2"
              >
                <Icon name="call" size={16} />
                Create {phoneNumbers.length} Calls
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
