import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { endCall } from '../api'
import { useLiveKitRoom } from '../hooks/useLiveKitRoom'
import { useTranscriptHistory } from '../hooks/useTranscriptHistory'
import { useTranslation } from '../hooks/useTranslation'
import { useMessageTranslations } from '../hooks/useMessageTranslations'
import { useFormState } from '../hooks/useFormState'
import { useCallEscalation } from '../hooks/useCallEscalation'
import { parseServerTime } from '../utils/time'
import type { TranscriptMessage } from '../types'

interface CallData {
  id: string
  direction: string
  caller_number: string
  callee_number: string
  status: string
  disposition: string | null
  flow_id: string | null
  flow_name: string | null
  livekit_room: string | null
  queued_at: string
  answered_at: string | null
  ended_at: string | null
  metadata: Record<string, unknown> | null
}

/* ── Mock data grid fields (kept for data entry panel) ── */
interface DataField {
  icon: string
  label: string
  value: string | null
  isFilling?: boolean
  isError?: boolean
  type?: 'text' | 'badge' | 'progress' | 'waiting'
  badgeColor?: string
  progress?: number
  progressLabel?: string
}

function getFieldIcon(fieldType: string): string {
  const iconMap: Record<string, string> = {
    text: 'text_fields',
    phone: 'phone',
    email: 'email',
    date: 'calendar_today',
    number: 'pin',
    id_number: 'badge',
    currency: 'payments',
    select: 'list',
    boolean: 'toggle_on',
    pattern: 'pattern',
  }
  return iconMap[fieldType] || 'input'
}

export default function LiveCallConsole() {
  const { callId } = useParams<{ callId: string }>()
  const navigate = useNavigate()
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Fetch call data from API
  const [call, setCall] = useState<CallData | null>(null)
  const [callLoading, setCallLoading] = useState(true)
  const [callError, setCallError] = useState<string | null>(null)

  useEffect(() => {
    if (!callId) return

    const fetchCall = async () => {
      setCallLoading(true)
      setCallError(null)
      try {
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
        const res = await fetch(`${baseUrl}/api/calls/${callId}`)
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Call not found' : 'Failed to fetch call')
        }
        const data = await res.json()
        setCall(data.call)
      } catch (e) {
        setCallError(e instanceof Error ? e.message : 'Failed to fetch call')
      } finally {
        setCallLoading(false)
      }
    }

    fetchCall()
  }, [callId])

  // Check if call is still active (not ended)
  const isCallActive = call?.status === 'in_progress'

  // Fetch persisted transcript history so F5 mid-call restores prior turns
  const { history: transcriptHistory } = useTranscriptHistory(callId || '', !!callId)

  // Real-time connections - only enable for active calls
  // Transcripts now come directly from LiveKit room (not SSE)
  const {
    connected: audioConnected,
    isAudioMuted,
    toggleAudioMute,
    disconnect: disconnectAudio,
    error: audioError,
    transcripts: messages,  // Transcripts from LiveKit room
  } = useLiveKitRoom({
    callId: callId || '',
    enabled: !!callId && isCallActive,
    initialTranscripts: transcriptHistory,
  })

  // Transcript connection status = audio connection (same source now)
  const transcriptConnected = audioConnected
  const transcriptError = audioError

  const {
    enabled: translationEnabled,
    toggle: toggleTranslation,
    loading: translationLoading,
  } = useTranslation({
    callId: callId || '',
  })

  // Client-side translation: enrich final messages with .translation when enabled
  const displayedMessages = useMessageTranslations(messages, translationEnabled)

  const {
    fields: formFields,
    confirmed: formConfirmed,
    completed: formCompleted,
    connected: formConnected,
    error: formError,
  } = useFormState(callId || '', isCallActive)

  // Escalation + card-lock state — subscribe to global call stream + seed from
  // call.metadata so mid-call F5 still shows the correct state.
  const escalation = useCallEscalation(callId || '')
  const escalationRequested =
    escalation.escalationRequested ||
    Boolean(call?.metadata && (call.metadata as Record<string, unknown>).escalation_requested)
  const cardLocked =
    escalation.cardLocked ||
    Boolean(call?.metadata && (call.metadata as Record<string, unknown>).card_locked)

  // End call state and handler
  const [endingCall, setEndingCall] = useState(false)

  const handleEndCall = async () => {
    if (!callId || endingCall) return

    setEndingCall(true)

    // Disconnect from LiveKit first
    disconnectAudio()

    try {
      await endCall(callId, { disposition: 'completed' })
      // Refresh call data to show ended state
      setCall((prev) => prev ? { ...prev, status: 'completed' } : null)
    } catch (e) {
      console.error('Failed to end call:', e)
      alert('Failed to end call. Please try again.')
    } finally {
      setEndingCall(false)
    }
  }

  // Detect remote LiveKit disconnect (e.g. PhoneSimulator ended call from another tab)
  const wasAudioConnectedRef = useRef(false)
  useEffect(() => {
    if (audioConnected) {
      wasAudioConnectedRef.current = true
      return
    }
    if (wasAudioConnectedRef.current && isCallActive && callId) {
      // Remote end — pull fresh call data to flip to ended view
      wasAudioConnectedRef.current = false
      const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      fetch(`${baseUrl}/api/calls/${callId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.call) setCall(data.call)
        })
        .catch(() => {})
    }
  }, [audioConnected, isCallActive, callId])

  // Call duration timer — derived from call timestamp so it survives F5
  const startTime = useMemo(() => {
    const ts = call?.answered_at ?? call?.queued_at
    return ts ? parseServerTime(ts) : Date.now()
  }, [call?.answered_at, call?.queued_at])

  const [duration, setDuration] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startTime) / 1000))
  )

  useEffect(() => {
    const tick = () => setDuration(Math.max(0, Math.floor((Date.now() - startTime) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startTime])

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  // Auto-scroll to latest message
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Loading state
  if (callLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-on-surface-variant">Loading call...</p>
        </div>
      </div>
    )
  }

  // Error or not found state
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

  // Derive customer name from call data
  const customerName = call.metadata?.customer_name as string || call.caller_number || 'Unknown'

  // Call has ended - show summary instead of live view
  if (!isCallActive) {
    const endedAtMs = parseServerTime(call.ended_at)
    const startedAtMs = parseServerTime(call.answered_at ?? call.queued_at)
    const durationSec = endedAtMs && startedAtMs
      ? Math.floor((endedAtMs - startedAtMs) / 1000)
      : 0

    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-surface-container-lowest rounded-2xl shadow-ambient p-8 text-center space-y-6">
          <div className="w-20 h-20 mx-auto rounded-full bg-surface-container flex items-center justify-center">
            <Icon
              name={call.status === 'completed' ? 'check_circle' : call.status === 'escalated' ? 'support_agent' : 'error'}
              size={40}
              className={call.status === 'completed' ? 'text-success' : call.status === 'escalated' ? 'text-warning' : 'text-error'}
            />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-navy mb-2">Call Ended</h2>
            <p className="text-on-surface-variant">
              This call has {call.status === 'completed' ? 'completed successfully' : call.status === 'escalated' ? 'been escalated' : 'ended'}
            </p>
          </div>

          <div className="bg-surface-container rounded-xl p-4 space-y-3 text-left">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Customer</span>
              <span className="font-medium text-on-surface">{customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Flow</span>
              <span className="font-medium text-on-surface">{call.flow_name || call.flow_id || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Duration</span>
              <span className="font-medium text-on-surface">
                {Math.floor(durationSec / 60)}m {durationSec % 60}s
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Status</span>
              <span className={`px-2 py-0.5 text-xs font-bold rounded-full uppercase ${
                call.status === 'completed' ? 'bg-success/15 text-success' :
                call.status === 'escalated' ? 'bg-warning/15 text-warning' :
                'bg-error/15 text-error'
              }`}>
                {call.status}
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => navigate('/calls')}
              className="flex-1 px-4 py-3 rounded-xl bg-surface-container text-on-surface font-medium hover:bg-surface-container-high transition-colors"
            >
              Back to Calls
            </button>
            <button
              onClick={() => navigate(`/calls/${callId}/transcript`)}
              className="flex-1 px-4 py-3 rounded-xl bg-primary text-white font-medium hover:brightness-110 transition-all"
            >
              View Transcript
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* ── Top App Bar ── */}
      <header className="bg-surface flex justify-between items-center w-full px-8 h-16 text-sm border-b border-outline-variant/10 relative z-40 flex-shrink-0">
        <div className="flex items-center gap-6">
          {/* Back button */}
          <button
            onClick={() => navigate('/calls')}
            className="p-2 -ml-2 hover:bg-surface-container rounded-lg transition-colors"
          >
            <Icon name="arrow_back" size={20} />
          </button>
          <div className="flex items-center gap-3">
            {/* Pulsing red dot */}
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-error" />
            </div>
            <span className="font-bold text-lg text-navy">Call in Progress</span>
          </div>
          <div className="h-6 w-px bg-outline-variant/30" />
          <div className="flex items-center gap-4">
            <span className="font-label text-lg font-bold tracking-tighter text-primary">
              {formatDuration(duration)}
            </span>
            <span className="text-on-surface-variant">
              Customer: <strong className="text-on-surface">{customerName}</strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Connection status indicators */}
          <div className="flex gap-2">
            <span
              className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${
                audioConnected
                  ? 'bg-success/15 text-success'
                  : 'bg-error/15 text-error'
              }`}
            >
              Audio: {audioConnected ? 'Live' : audioError ? 'Error' : 'Connecting...'}
            </span>
            <span
              className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${
                transcriptConnected
                  ? 'bg-success/15 text-success'
                  : 'bg-error/15 text-error'
              }`}
            >
              STT: {transcriptConnected ? 'Live' : transcriptError ? 'Reconnecting...' : 'Connecting...'}
            </span>
          </div>

          {/* Audio controls */}
          <div className="flex items-center gap-1 bg-surface-container rounded-full px-3 py-1.5">
            <button
              className="p-1.5 hover:bg-white rounded-full transition-colors"
              onClick={toggleAudioMute}
              title={isAudioMuted ? 'Unmute' : 'Mute'}
            >
              <Icon name={isAudioMuted ? 'volume_off' : 'volume_up'} size={20} />
            </button>
            <button className="p-1.5 hover:bg-white rounded-full transition-colors">
              <Icon name="settings" size={20} />
            </button>
          </div>

          {/* Translation toggle */}
          <button
            onClick={toggleTranslation}
            disabled={translationLoading}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5 ${
              translationEnabled
                ? 'bg-primary text-white'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            } ${translationLoading ? 'opacity-60 cursor-wait' : ''}`}
            title={translationEnabled ? 'Disable translation' : 'Enable translation (VI -> EN)'}
          >
            <Icon name="translate" size={16} />
            {translationLoading ? 'Translating...' : translationEnabled ? 'EN' : 'Translate'}
          </button>

          <button className="px-5 py-2 rounded-md bg-surface-container-high text-on-surface font-semibold hover:bg-surface-container-highest transition-colors active:scale-95 duration-150">
            Transfer
          </button>
          <button
            onClick={handleEndCall}
            disabled={endingCall}
            className={`px-5 py-2 rounded-md bg-error text-white font-bold hover:brightness-110 shadow-lg shadow-error/20 active:scale-95 duration-150 ${
              endingCall ? 'opacity-60 cursor-wait' : ''
            }`}
          >
            {endingCall ? 'Ending...' : 'End Call'}
          </button>
        </div>
      </header>

      {/* ── Main Content: Split View ── */}
      <div className="flex-1 flex overflow-hidden p-6 gap-6">
        {/* Left Panel (60%): Real-time Transcript */}
        <section className="w-3/5 flex flex-col gap-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-2xl font-bold text-navy tracking-tight font-headline">
              Real-time Transcript
            </h2>
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded-full font-label">
                LIVE TRANSCRIBING
              </span>
              {translationEnabled && (
                <span className="px-3 py-1 bg-secondary/10 text-secondary text-xs font-bold rounded-full font-label">
                  TRANSLATING VI -&gt; EN
                </span>
              )}
              <span className="px-3 py-1 bg-success/10 text-success text-xs font-bold rounded-full font-label">
                {messages.length} MESSAGES
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-surface-container-lowest rounded-xl shadow-ambient p-6 transcript-scroll flex flex-col gap-6">
            {displayedMessages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-on-surface-variant">
                <div className="text-center space-y-2">
                  <Icon name="mic" className="text-4xl text-primary/30" />
                  <p className="text-sm">Waiting for transcript...</p>
                </div>
              </div>
            ) : (
              displayedMessages.map((msg) =>
                msg.role === 'agent' ? (
                  <AgentBubble
                    key={msg.id}
                    msg={msg}
                    showTranslation={translationEnabled}
                  />
                ) : msg.role === 'system' ? (
                  <SystemMessage key={msg.id} msg={msg} />
                ) : (
                  <CustomerBubble
                    key={msg.id}
                    msg={msg}
                    showTranslation={translationEnabled}
                  />
                )
              )
            )}
            <div ref={transcriptEndRef} />
          </div>
        </section>

        {/* Right Panel (40%): Live Data Entry */}
        <section className={`w-2/5 flex flex-col gap-4 ${
          escalationRequested ? 'escalation-pulse rounded-xl p-1' : ''
        }`}>
          <div className="flex items-center justify-between px-2">
            <h2 className="text-2xl font-bold text-navy tracking-tight font-headline">
              Live Data Entry
            </h2>
            <div className="flex gap-2 items-center">
              <Icon
                name={formConnected ? "sync" : "sync_disabled"}
                fill
                className={formConnected ? "text-primary-container" : "text-error"}
                size={18}
              />
              <span className={`text-xs font-medium uppercase font-label ${formConnected ? "text-primary-container" : "text-error"}`}>
                {formConnected ? "Real-time AI Syncing..." : formError || "Connecting..."}
              </span>
            </div>
          </div>

          {escalationRequested && (
            <div className="bg-error/10 border-2 border-error rounded-xl p-4 flex items-start gap-3 animate-pulse-slow">
              <Icon name="support_agent" className="text-error flex-shrink-0" size={24} />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-error uppercase tracking-wide mb-1">
                  Escalation Requested
                </h4>
                <p className="text-xs text-on-surface-variant mb-3">
                  {escalation.escalationReason || 'Agent requested human operator. Hold music is playing.'}
                </p>
                <button
                  onClick={() => {
                    if (!callId) return
                    window.open(
                      `/operator-join/${callId}`,
                      'operator-join',
                      'width=480,height=600'
                    )
                  }}
                  className="px-4 py-2 rounded-lg bg-error text-white text-sm font-bold hover:brightness-110 active:scale-95 transition-all"
                >
                  <Icon name="call" size={16} className="mr-1.5" />
                  Join as Human
                </button>
              </div>
            </div>
          )}

          {cardLocked && (
            <div className="bg-success/10 border border-success/30 rounded-xl px-4 py-3 flex items-center gap-2">
              <Icon name="lock" className="text-success" size={20} />
              <span className="text-sm font-bold text-success uppercase tracking-wide">
                Card Locked
              </span>
            </div>
          )}

          {/* Data Grid */}
          <div className="flex-1 bg-surface-container-lowest rounded-xl shadow-ambient overflow-hidden flex flex-col">
            {/* Grid Header */}
            <div className="grid grid-cols-2 bg-surface-container-low">
              <div className="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-widest font-label border-r border-outline-variant/10">
                Data Field
              </div>
              <div className="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-widest font-label">
                Active Value
              </div>
            </div>

            {/* Grid Body */}
            <div className="flex-1 overflow-y-auto">
              {formFields.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-on-surface-variant p-8">
                  <div className="text-center space-y-2">
                    <Icon name="hourglass_empty" className="text-4xl text-primary/30" />
                    <p className="text-sm">Waiting for form data...</p>
                  </div>
                </div>
              ) : (
                formFields.map((f) => (
                  <DataRow
                    key={f.id}
                    field={{
                      icon: getFieldIcon(f.field_type),
                      label: f.label,
                      value: f.value,
                      type: f.value === null ? 'waiting' : 'text',
                      isError: f.attempts > 0 && !f.validated,
                      isFilling: f.value !== null && !f.validated,
                    }}
                  />
                ))
              )}
            </div>

            {/* Grid Footer */}
            <div className="p-4 bg-surface-container-low flex justify-between items-center">
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
                    Core Ledger
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
                    Stream Active
                  </span>
                </div>
                {formConfirmed && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-success" />
                    <span className="text-[10px] font-bold text-success uppercase font-label">
                      Confirmed
                    </span>
                  </div>
                )}
                {formCompleted && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                    <span className="text-[10px] font-bold text-primary uppercase font-label">
                      Submitted
                    </span>
                  </div>
                )}
              </div>
              <button className="text-primary text-xs font-bold hover:underline">
                Manual Overwrite
              </button>
            </div>
          </div>

          {/* AI Recommendation Widget */}
          <div className="p-4 bg-white rounded-xl shadow-ambient border-l-4 border-primary-container flex gap-4 items-start">
            <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
              <Icon name="lightbulb" fill className="text-primary" />
            </div>
            <div>
              <h5 className="text-sm font-bold text-on-surface mb-1">AI Recommendation</h5>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                The customer's tone indicates low urgency but high frustration. Offer immediate
                provisional credit to maintain loyalty score.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

/* ── Sub-components ── */

interface BubbleProps {
  msg: TranscriptMessage
  showTranslation?: boolean
}

function AgentBubble({ msg, showTranslation = false }: BubbleProps) {
  return (
    <div className="flex flex-col items-start max-w-[85%]">
      <div className="flex items-center gap-2 mb-1 px-1">
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider font-label">
          AI Agent
        </span>
        <span className="text-[10px] text-on-surface-variant font-medium font-label">
          {msg.timestamp}
        </span>
        {msg.isLive && (
          <span className="text-[10px] text-primary font-medium font-label animate-pulse">
            Speaking...
          </span>
        )}
      </div>
      <div
        className={`bg-primary/10 text-on-surface p-4 rounded-2xl rounded-tl-none shadow-sm border border-primary/5 relative ${
          msg.isLive ? 'ring-2 ring-primary/30' : ''
        }`}
      >
        {msg.isLive ? (
          <>
            <p className="text-[15px] leading-relaxed italic text-primary">"{msg.text}"</p>
            <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
          </>
        ) : (
          <p className="text-[15px] leading-relaxed">{msg.text}</p>
        )}

        {/* Translation */}
        {showTranslation && msg.translation && (
          <p className="text-[13px] text-on-surface-variant mt-2 pt-2 border-t border-primary/10 italic">
            {msg.translation}
          </p>
        )}
      </div>
    </div>
  )
}

function CustomerBubble({ msg, showTranslation = false }: BubbleProps) {
  return (
    <div className="flex flex-col items-end self-end max-w-[85%]">
      <div className="flex items-center gap-2 mb-1 px-1">
        {msg.isLive && (
          <span className="text-[10px] text-secondary font-medium font-label animate-pulse">
            Speaking...
          </span>
        )}
        <span className="text-[10px] text-on-surface-variant font-medium font-label">
          {msg.timestamp}
        </span>
        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider font-label">
          Customer
        </span>
      </div>
      <div
        className={`bg-surface-container-high text-on-surface p-4 rounded-2xl rounded-tr-none shadow-sm border border-outline-variant/10 ${
          msg.isLive ? 'ring-2 ring-secondary/30' : ''
        }`}
      >
        {msg.isLive ? (
          <p className="text-[15px] leading-relaxed italic text-secondary">{msg.text}</p>
        ) : (
          <p className="text-[15px] leading-relaxed">{msg.text}</p>
        )}

        {/* Translation */}
        {showTranslation && msg.translation && (
          <p className="text-[13px] text-on-surface-variant mt-2 pt-2 border-t border-outline-variant/20 italic">
            {msg.translation}
          </p>
        )}
      </div>
    </div>
  )
}

function SystemMessage({ msg }: { msg: TranscriptMessage }) {
  return (
    <div className="flex justify-center">
      <div className="px-4 py-2 bg-surface-container rounded-full">
        <span className="text-[11px] text-on-surface-variant font-mono">
          {msg.text}
        </span>
      </div>
    </div>
  )
}

function DataRow({ field }: { field: DataField }) {
  const isHighlighted = field.isFilling
  const isErrorRow = field.isError

  const rowBg = isErrorRow
    ? 'bg-error/5'
    : isHighlighted
    ? 'bg-primary/5'
    : 'hover:bg-primary/5 transition-colors'

  return (
    <div className={`grid grid-cols-2 border-b border-outline-variant/10 ${rowBg}`}>
      {/* Label cell */}
      <div className="px-6 py-5 flex items-center gap-3 border-r border-outline-variant/10">
        <Icon
          name={field.icon}
          className={
            isErrorRow
              ? 'text-error'
              : isHighlighted
              ? 'text-primary'
              : 'text-primary/60'
          }
        />
        <span
          className={`text-sm ${
            isErrorRow
              ? 'font-bold text-error'
              : isHighlighted
              ? 'font-bold text-primary'
              : 'font-medium text-on-surface'
          }`}
        >
          {field.label}
        </span>
      </div>

      {/* Value cell */}
      <div className="px-6 py-5 relative">
        {isHighlighted && (
          <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
        )}

        {field.type === 'progress' && field.progress != null ? (
          <div className="flex items-center gap-4">
            <div className="flex-1 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
              <div
                className="h-full bg-success"
                style={{ width: `${field.progress}%` }}
              />
            </div>
            <span className="font-label text-xs font-bold text-success">
              {field.progressLabel}
            </span>
          </div>
        ) : field.type === 'badge' ? (
          <span
            className={`px-3 py-1 font-bold text-[10px] rounded-full uppercase tracking-tighter ${
              field.badgeColor === 'warning'
                ? 'bg-warning/15 text-warning'
                : field.badgeColor === 'success'
                ? 'bg-success/15 text-success'
                : 'bg-primary/15 text-primary'
            }`}
          >
            {field.value}
          </span>
        ) : field.type === 'waiting' ? (
          <span className="font-label text-sm text-on-surface-variant italic">
            Waiting for end...
          </span>
        ) : isErrorRow ? (
          <span className="text-xs text-error/80 italic font-medium">
            {field.value}
          </span>
        ) : (
          <span className={`font-label text-sm font-bold ${isHighlighted ? 'text-primary' : 'text-on-surface'}`}>
            {field.value}
            {isHighlighted && (
              <span className="ml-2 inline-flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            )}
          </span>
        )}
      </div>
    </div>
  )
}
