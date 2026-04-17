import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { useTranscriptHistory } from '../hooks/useTranscriptHistory'
import { useMessageTranslations } from '../hooks/useMessageTranslations'
import { parseServerTime } from '../utils/time'
import type { TranscriptMessage } from '../types'

interface CallData {
  id: string
  caller_number: string
  callee_number: string
  status: string
  flow_id: string | null
  flow_name: string | null
  queued_at: string
  answered_at: string | null
  ended_at: string | null
  metadata: Record<string, unknown> | null
}

export default function CallTranscriptPage() {
  const { callId } = useParams<{ callId: string }>()
  const navigate = useNavigate()

  const [call, setCall] = useState<CallData | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const [callLoading, setCallLoading] = useState(true)
  const [translationEnabled, setTranslationEnabled] = useState(false)

  useEffect(() => {
    if (!callId) return
    const fetchCall = async () => {
      setCallLoading(true)
      try {
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
        const res = await fetch(`${baseUrl}/api/calls/${callId}`)
        if (!res.ok) throw new Error(res.status === 404 ? 'Call not found' : `HTTP ${res.status}`)
        const data = await res.json()
        setCall(data.call)
      } catch (e) {
        setCallError((e as Error).message)
      } finally {
        setCallLoading(false)
      }
    }
    fetchCall()
  }, [callId])

  const { history, loading: historyLoading, error: historyError } = useTranscriptHistory(
    callId || '',
    !!callId,
  )

  const displayedMessages = useMessageTranslations(history, translationEnabled)

  if (callLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (callError || !call) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Icon name="error" className="text-6xl text-error/30" />
          <h2 className="text-2xl font-bold text-navy">{callError || 'Call Not Found'}</h2>
          <button
            onClick={() => navigate('/calls')}
            className="text-primary font-bold hover:underline"
          >
            Back to Calls
          </button>
        </div>
      </div>
    )
  }

  const customerName =
    (call.metadata?.customer_name as string) || call.caller_number || 'Unknown'
  const endedAtMs = parseServerTime(call.ended_at)
  const startedAtMs = parseServerTime(call.answered_at ?? call.queued_at)
  const durationSec = endedAtMs && startedAtMs
    ? Math.floor((endedAtMs - startedAtMs) / 1000)
    : 0

  const statusColor =
    call.status === 'completed'
      ? 'bg-success/15 text-success'
      : call.status === 'escalated'
        ? 'bg-warning/15 text-warning'
        : 'bg-error/15 text-error'

  return (
    <div className="h-full flex flex-col">
      <header className="bg-surface flex justify-between items-center px-8 h-16 border-b border-outline-variant/10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/calls')}
            className="p-2 -ml-2 hover:bg-surface-container rounded-lg transition-colors"
          >
            <Icon name="arrow_back" size={20} />
          </button>
          <h1 className="font-bold text-lg text-navy">Call Transcript</h1>
          <span className="text-on-surface-variant">
            Customer:{' '}
            <strong className="text-on-surface">{customerName}</strong>
          </span>
          <span className="text-on-surface-variant text-sm">
            {Math.floor(durationSec / 60)}m {durationSec % 60}s
          </span>
          <span
            className={`px-2 py-0.5 text-xs font-bold rounded-full uppercase ${statusColor}`}
          >
            {call.status}
          </span>
        </div>
        <button
          onClick={() => setTranslationEnabled((v) => !v)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            translationEnabled
              ? 'bg-primary/10 text-primary'
              : 'hover:bg-surface-container text-on-surface-variant'
          }`}
        >
          <Icon name="translate" size={16} />
          Translate
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto bg-surface-container-lowest rounded-xl shadow-ambient p-6 space-y-4">
          {historyLoading && (
            <div className="text-center text-on-surface-variant">Loading transcript...</div>
          )}
          {historyError && (
            <div className="text-center text-error">Error: {historyError}</div>
          )}
          {!historyLoading && !historyError && displayedMessages.length === 0 && (
            <div className="text-center text-on-surface-variant py-12">
              <Icon name="speaker_notes_off" className="text-4xl opacity-30 mb-2" />
              <p>No transcript available for this call.</p>
            </div>
          )}
          {displayedMessages.map((msg) => (
            <TranscriptRow key={msg.id} msg={msg} showTranslation={translationEnabled} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TranscriptRow({
  msg,
  showTranslation,
}: {
  msg: TranscriptMessage
  showTranslation: boolean
}) {
  const isAgent = msg.role === 'agent'
  const isSystem = msg.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="px-4 py-2 bg-surface-container rounded-full">
          <span className="text-[11px] text-on-surface-variant font-mono">
            {msg.text} — {msg.timestamp}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col ${isAgent ? 'items-start' : 'items-end self-end'} max-w-[85%] ${isAgent ? '' : 'ml-auto'}`}>
      <div className={`flex items-center gap-2 mb-1 px-1 ${isAgent ? '' : 'flex-row-reverse'}`}>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider font-label ${
            isAgent ? 'text-primary' : 'text-on-surface-variant'
          }`}
        >
          {isAgent ? 'AI Agent' : 'Customer'}
        </span>
        <span className="text-[10px] text-on-surface-variant font-medium font-label">
          {msg.timestamp}
        </span>
      </div>
      <div
        className={`p-4 rounded-2xl shadow-sm border ${
          isAgent
            ? 'bg-primary/10 text-on-surface border-primary/5 rounded-tl-none'
            : 'bg-surface-container-high text-on-surface border-outline-variant/10 rounded-tr-none'
        }`}
      >
        <p className="text-[15px] leading-relaxed">{msg.text}</p>
        {showTranslation && msg.translation && (
          <p
            className={`text-[13px] text-on-surface-variant mt-2 pt-2 border-t italic ${
              isAgent ? 'border-primary/10' : 'border-outline-variant/20'
            }`}
          >
            {msg.translation}
          </p>
        )}
      </div>
    </div>
  )
}
