import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import OutboundCallModal from '../components/OutboundCallModal'
import BatchCallModal from '../components/BatchCallModal'
import { useCallsStream } from '../hooks/useCallsStream'
import type { Call } from '../types'

// Normalize timestamp to UTC (API returns without Z suffix)
function toUTC(ts: string | null | undefined): string | undefined {
  if (!ts) return undefined
  // If already has timezone info, return as-is
  if (ts.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(ts)) return ts
  // Append Z to treat as UTC
  return ts + 'Z'
}

// Map backend Call to UI display format
function mapCallToDisplay(call: Call) {
  const status = call.status === 'in_progress' ? 'ongoing'
    : call.status === 'ringing' ? 'ongoing'
    : call.status === 'completed' ? 'completed'
    : call.status === 'escalated' ? 'escalated'
    : 'completed'

  return {
    id: call.id,
    customerId: call.id,
    customerName: call.customer_name || call.caller_number || 'Unknown',
    status,
    flowId: call.flow_id || '',
    flowName: call.flow_name || call.flow_id || 'Unknown Flow',
    startTime: toUTC(call.answered_at) || toUTC(call.queued_at),
    endTime: toUTC(call.ended_at),
    duration: call.duration_seconds || 0,
    outcome: call.disposition as 'completed' | 'escalated' | 'dropped' | undefined,
    escalationRequested: Boolean(call.escalation_requested),
    cardLocked: Boolean(call.card_locked),
  }
}

type DisplayCall = ReturnType<typeof mapCallToDisplay>

/* ── Live Duration Hook ── */
function useLiveDuration(startTime: string | undefined): string {
  const [duration, setDuration] = useState('00:00')

  useEffect(() => {
    if (!startTime) return

    const startMs = new Date(startTime).getTime()
    if (isNaN(startMs)) return

    const update = () => {
      const diff = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
      const min = Math.floor(diff / 60)
      const sec = diff % 60
      setDuration(`${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [startTime])

  return duration
}

/* ── Format duration helper ── */
function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${min}m ${sec}s`
}

/* ── Format date helper ── */
function formatDate(isoString: string | undefined): string {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/* ── Relative time helper ── */
function getRelativeTime(startTime: string | undefined): string {
  if (!startTime) return 'Just now'
  const startMs = new Date(startTime).getTime()
  if (isNaN(startMs)) return 'Just now'
  const diff = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
  const min = Math.floor(diff / 60)
  if (min < 1) return 'Just now'
  if (min === 1) return '1 min ago'
  return `${min} min ago`
}

/* ── Status Badge Styles ── */
const STATUS_BADGE_STYLES: Record<string, string> = {
  completed: 'bg-success/15 text-success',
  escalated: 'bg-error/15 text-error',
  dropped: 'bg-warning/15 text-warning',
}

/* ── CallCard Component ── */
function CallCard({ call, isOngoing }: { call: DisplayCall; isOngoing: boolean }) {
  const navigate = useNavigate()
  const liveDuration = useLiveDuration(call.startTime)

  return (
    <div
      onClick={() => navigate(`/calls/${call.id}`)}
      className={`bg-surface-container-lowest rounded-xl shadow-ambient p-5 cursor-pointer hover:shadow-lg hover:bg-primary/5 transition-all duration-200 group ${
        call.escalationRequested ? 'escalation-pulse' : ''
      }`}
    >
      {call.escalationRequested && (
        <div className="flex items-center gap-2 mb-3 px-2 py-1 bg-error/10 rounded-md">
          <Icon name="support_agent" size={14} className="text-error" />
          <span className="text-[10px] font-bold text-error uppercase tracking-wider">
            Escalation Requested — Human Needed
          </span>
        </div>
      )}
      {/* Header Row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {isOngoing ? (
            /* Pulsing red dot for ongoing */
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-error" />
            </div>
          ) : (
            /* Icon for history */
            <Icon
              name={call.outcome === 'completed' ? 'check_circle' : 'warning'}
              fill
              className={call.outcome === 'completed' ? 'text-success' : 'text-error'}
              size={18}
            />
          )}
          <span className="font-bold text-on-surface group-hover:text-primary transition-colors">
            {call.customerName}
          </span>
          {call.cardLocked && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-success/10 text-success text-[10px] font-bold rounded-full">
              <Icon name="lock" size={10} /> Locked
            </span>
          )}
        </div>

        {/* Duration / Status Badge */}
        {isOngoing ? (
          <span className="font-label text-lg font-bold tracking-tighter text-primary">
            {liveDuration}
          </span>
        ) : (
          <span
            className={`px-3 py-1 font-bold text-[10px] rounded-full uppercase tracking-tighter ${
              STATUS_BADGE_STYLES[call.outcome || 'completed']
            }`}
          >
            {call.outcome}
          </span>
        )}
      </div>

      {/* Flow Name */}
      <div className="text-sm text-on-surface-variant mb-2">{call.flowName}</div>

      {/* Footer Row */}
      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        {isOngoing ? (
          <span>Started {getRelativeTime(call.startTime)}</span>
        ) : (
          <>
            <span>{formatDate(call.startTime)}</span>
            <span className="font-label font-medium">{formatDuration(call.duration)}</span>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Empty State Component ── */
function EmptyState({ type }: { type: 'ongoing' | 'history' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
        <Icon
          name={type === 'ongoing' ? 'phone_disabled' : 'history'}
          className="text-on-surface-variant"
          size={32}
        />
      </div>
      <h3 className="text-lg font-bold text-on-surface mb-2 font-headline">
        {type === 'ongoing' ? 'No Active Calls' : 'No Call History'}
      </h3>
      <p className="text-sm text-on-surface-variant max-w-sm">
        {type === 'ongoing'
          ? 'There are no ongoing calls at the moment. New calls will appear here.'
          : 'No completed or escalated calls found. Call history will be shown here.'}
      </p>
    </div>
  )
}

/* ── Main CallsPage Component ── */
export default function CallsPage() {
  const [activeTab, setActiveTab] = useState<'ongoing' | 'history'>('ongoing')
  const [showOutboundModal, setShowOutboundModal] = useState(false)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [mockCalls, setMockCalls] = useState<Call[]>([])
  const { calls, error, loading, refresh } = useCallsStream()

  // Handler for batch call creation
  const handleBatchCreated = useCallback((newCalls: Call[]) => {
    setMockCalls((prev) => [...newCalls, ...prev])
  }, [])

  // Merge real calls with mock calls
  const allCalls = [...mockCalls, ...calls]

  // Map and filter calls
  const displayCalls = allCalls.map(mapCallToDisplay)
  const ongoingCalls = displayCalls.filter((c) => c.status === 'ongoing')
  const historyCalls = displayCalls.filter((c) => c.status !== 'ongoing')

  const displayedCalls = activeTab === 'ongoing' ? ongoingCalls : historyCalls

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-navy tracking-tight font-headline">Calls</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Monitor active calls and review history
          </p>
        </div>

        {/* Stats badges + Connection status */}
        <div className="flex items-center gap-4">
          {/* Batch Call button */}
          <button
            onClick={() => setShowBatchModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-surface-container text-on-surface rounded-lg text-sm font-bold hover:bg-primary/10 transition-colors"
          >
            <Icon name="group_add" size={18} />
            Batch Call
          </button>

          {/* New Call button */}
          <button
            onClick={() => setShowOutboundModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Icon name="add_call" size={18} />
            New Call
          </button>

          <div className="flex items-center gap-2 px-4 py-2 bg-error/10 rounded-lg">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-error" />
            </div>
            <span className="text-sm font-bold text-error">{ongoingCalls.length} Active</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-container rounded-lg">
            <Icon name="history" size={16} className="text-on-surface-variant" />
            <span className="text-sm font-medium text-on-surface-variant">
              {historyCalls.length} Total
            </span>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-error/10 rounded-lg border border-error/20">
          <Icon name="error" className="text-error" size={20} />
          <span className="text-sm text-error">{error}</span>
          <button
            onClick={refresh}
            className="ml-auto text-sm font-medium text-error hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('ongoing')}
          className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${
            activeTab === 'ongoing'
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface-variant hover:bg-primary/5'
          }`}
        >
          <div className="flex items-center gap-2">
            {activeTab === 'ongoing' && (
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </div>
            )}
            Ongoing ({ongoingCalls.length})
          </div>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${
            activeTab === 'history'
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface-variant hover:bg-primary/5'
          }`}
        >
          History ({historyCalls.length})
        </button>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
          <p className="text-sm text-on-surface-variant">Loading calls...</p>
        </div>
      ) : displayedCalls.length === 0 ? (
        <EmptyState type={activeTab} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedCalls.map((call) => (
            <CallCard key={call.id} call={call} isOngoing={activeTab === 'ongoing'} />
          ))}
        </div>
      )}

      {/* Outbound call modal */}
      {showOutboundModal && (
        <OutboundCallModal
          onClose={() => setShowOutboundModal(false)}
          onCreated={() => refresh()}
        />
      )}

      {/* Batch call modal */}
      {showBatchModal && (
        <BatchCallModal
          onClose={() => setShowBatchModal(false)}
          onBatchCreated={handleBatchCreated}
        />
      )}
    </div>
  )
}
