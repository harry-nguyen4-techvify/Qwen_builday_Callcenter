import { useState, useEffect, useRef } from 'react'
import {
  initiateSimulatorCall,
  endCall,
  answerCall,
  listCalls,
} from '../api'
import { useLiveKitRoom } from '../hooks/useLiveKitRoom'
import type { Call, CallEvent } from '../types'

type CallState = 'idle' | 'incoming' | 'connecting' | 'in_call' | 'ending'

interface IncomingCall {
  id: string
  phoneNumber: string
  flowName: string
}

export default function PhoneSimulator() {
  const [state, setState] = useState<CallState>('idle')
  const [incoming, setIncoming] = useState<IncomingCall | null>(null)
  const [callId, setCallId] = useState<string | null>(null)
  const [dbCallId, setDbCallId] = useState<string | null>(null)
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null)
  const [liveKitUrl, setLiveKitUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [isMutedLocal, setIsMutedLocal] = useState(false)
  const [speakerOn, setSpeakerOn] = useState(false)
  const [callerDisplay, setCallerDisplay] = useState('Shinhan Bank')
  const [currentTime, setCurrentTime] = useState(new Date())

  const stateRef = useRef<CallState>('idle')
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const { connected, isMuted, toggleMute, disconnect } = useLiveKitRoom({
    callId: callId || '',
    enabled: state === 'in_call' && !!callId,
    token: liveKitToken || undefined,
    url: liveKitUrl || undefined,
  })

  const wasConnectedRef = useRef(false)
  useEffect(() => {
    if (connected) {
      wasConnectedRef.current = true
      return
    }
    if (wasConnectedRef.current && state === 'in_call') {
      wasConnectedRef.current = false
      resetCallState()
    }
  }, [connected, state])

  useEffect(() => {
    if (state !== 'in_call') return
    const interval = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(interval)
  }, [state])

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    const es = new EventSource(`${baseUrl}/api/calls/stream`)

    const onIncoming = (ev: MessageEvent) => {
      try {
        const data: CallEvent = JSON.parse(ev.data)
        const call = data.call
        if (!call) return
        if (stateRef.current !== 'idle') return
        if (call.direction !== 'outbound') return
        if (call.status !== 'ringing') return
        setIncoming({
          id: call.id,
          phoneNumber: call.caller_number || 'Unknown',
          flowName: call.flow_name || call.flow_id || 'Unknown flow',
        })
        setState('incoming')
      } catch { /* ignore */ }
    }

    const onEnded = (ev: MessageEvent) => {
      try {
        const data: CallEvent = JSON.parse(ev.data)
        if (stateRef.current === 'incoming' && data.call_id === incomingIdRef.current) {
          setIncoming(null)
          setState('idle')
        }
      } catch { /* ignore */ }
    }

    es.addEventListener('incoming-call', onIncoming)
    es.addEventListener('call-started', onIncoming)
    es.addEventListener('call-ended', onEnded)

    return () => es.close()
  }, [])

  const incomingIdRef = useRef<string | null>(null)
  useEffect(() => {
    incomingIdRef.current = incoming?.id ?? null
  }, [incoming])

  useEffect(() => {
    let cancelled = false
    listCalls({ limit: 20 })
      .then((res) => {
        if (cancelled) return
        const ringing = res.calls.find(
          (c: Call) => c.status === 'ringing' && c.direction === 'outbound'
        )
        if (ringing && stateRef.current === 'idle') {
          setIncoming({
            id: ringing.id,
            phoneNumber: ringing.caller_number || 'Unknown',
            flowName: ringing.flow_name || ringing.flow_id || 'Unknown flow',
          })
          setState('incoming')
        }
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const resetCallState = () => {
    setCallId(null)
    setDbCallId(null)
    setLiveKitToken(null)
    setLiveKitUrl(null)
    setDuration(0)
    setState('idle')
    setIncoming(null)
    setCallerDisplay('Shinhan Bank')
    setIsMutedLocal(false)
    setSpeakerOn(false)
  }

  const handleCall = async () => {
    setState('connecting')
    try {
      const data = await initiateSimulatorCall()
      setCallId(data.call_id)
      setDbCallId(data.db_id)
      setLiveKitToken(data.token)
      setLiveKitUrl(data.url)
      setState('in_call')
    } catch (e) {
      setState('idle')
      console.error('Failed to connect:', e)
    }
  }

  const handleAnswer = async () => {
    if (!incoming) return
    const current = incoming
    setState('connecting')
    setCallerDisplay(current.phoneNumber)
    try {
      const data = await answerCall(current.id)
      setCallId(data.room_name)
      setDbCallId(current.id)
      setLiveKitToken(data.token)
      setLiveKitUrl(data.url)
      setIncoming(null)
      setState('in_call')
    } catch (e) {
      console.error('Failed to answer call:', e)
      setState('incoming')
    }
  }

  const handleDecline = async () => {
    if (!incoming) return
    const id = incoming.id
    setIncoming(null)
    setState('idle')
    try {
      await endCall(id, { disposition: 'dropped' })
    } catch (e) {
      console.error('Failed to decline call:', e)
    }
  }

  const handleEndCall = async () => {
    setState('ending')
    disconnect()
    if (dbCallId) {
      try {
        await endCall(dbCallId, { disposition: 'completed' })
      } catch (e) {
        console.error('Failed to end call on server:', e)
      }
    }
    resetCallState()
  }

  const handleToggleMute = () => {
    toggleMute()
    setIsMutedLocal(!isMutedLocal)
  }

  const toggleSpeaker = () => setSpeakerOn((p) => !p)

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).replace(' ', '')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      {/* Phone Device */}
      <div className="relative">
        {/* Side Buttons - Left */}
        <div className="absolute -left-[3px] top-[120px] w-[3px] h-[30px] bg-[#2a2a2c] rounded-l-sm" />
        <div className="absolute -left-[3px] top-[170px] w-[3px] h-[55px] bg-[#2a2a2c] rounded-l-sm" />
        <div className="absolute -left-[3px] top-[235px] w-[3px] h-[55px] bg-[#2a2a2c] rounded-l-sm" />

        {/* Side Button - Right (Power) */}
        <div className="absolute -right-[3px] top-[180px] w-[3px] h-[80px] bg-[#2a2a2c] rounded-r-sm" />

        {/* Phone Frame */}
        <div
          className="relative bg-[#1a1a1c] rounded-[55px] p-[12px] shadow-2xl"
          style={{
            boxShadow: `
              0 0 0 1px rgba(255,255,255,0.1),
              0 25px 50px -12px rgba(0,0,0,0.8),
              inset 0 1px 0 rgba(255,255,255,0.05)
            `
          }}
        >
          {/* Screen */}
          <div
            className="relative w-[375px] h-[812px] bg-black rounded-[45px] overflow-hidden"
            style={{
              boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.8)'
            }}
          >
            {/* Dynamic Island */}
            <div className="absolute top-[12px] left-1/2 -translate-x-1/2 z-50">
              <div
                className={`bg-black rounded-[25px] flex items-center justify-center transition-all duration-500 ${
                  state === 'in_call'
                    ? 'w-[180px] h-[37px]'
                    : 'w-[126px] h-[37px]'
                }`}
              >
                {state === 'in_call' && (
                  <div className="flex items-center gap-2 px-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-green-500 text-xs font-semibold">
                      {formatDuration(duration)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Status Bar */}
            <div className="absolute top-0 left-0 right-0 z-40 px-8 pt-[16px] flex justify-between items-center">
              <span className="text-white text-[15px] font-semibold tracking-tight">
                {formatTime(currentTime)}
              </span>
              <div className="flex items-center gap-[5px]">
                {/* Signal */}
                <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
                  <rect x="0" y="7" width="3" height="5" rx="0.5" fill="white"/>
                  <rect x="5" y="5" width="3" height="7" rx="0.5" fill="white"/>
                  <rect x="10" y="2" width="3" height="10" rx="0.5" fill="white"/>
                  <rect x="15" y="0" width="3" height="12" rx="0.5" fill="white"/>
                </svg>
                {/* WiFi */}
                <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
                  <path d="M8.5 2.5C11.5 2.5 14 4 15.5 6L14 7.5C13 6 11 5 8.5 5C6 5 4 6 3 7.5L1.5 6C3 4 5.5 2.5 8.5 2.5Z" fill="white"/>
                  <path d="M8.5 6C10.5 6 12 7 13 8.5L11 10C10.5 9 9.5 8.5 8.5 8.5C7.5 8.5 6.5 9 6 10L4 8.5C5 7 6.5 6 8.5 6Z" fill="white"/>
                  <circle cx="8.5" cy="11" r="1.5" fill="white"/>
                </svg>
                {/* Battery */}
                <div className="flex items-center gap-[2px]">
                  <div className="w-[25px] h-[12px] border border-white/40 rounded-[3px] p-[2px]">
                    <div className="w-full h-full bg-white rounded-[1px]" />
                  </div>
                  <div className="w-[2px] h-[5px] bg-white/40 rounded-r-sm" />
                </div>
              </div>
            </div>

            {/* Screen Content */}
            <div className="absolute inset-0 pt-[60px]">
              {/* IDLE STATE - Lock Screen Style */}
              {state === 'idle' && (
                <div
                  className="h-full flex flex-col items-center justify-between pb-8 px-6"
                  style={{
                    background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
                  }}
                >
                  <div className="flex-1 flex flex-col items-center justify-center">
                    <div className="text-white/60 text-sm font-medium mb-2">
                      {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </div>
                    <div className="text-white text-[80px] font-extralight tracking-tight leading-none">
                      {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </div>
                  </div>

                  <div className="w-full space-y-4">
                    <p className="text-white/50 text-center text-sm">
                      Tap to call Shinhan Bank AI
                    </p>
                    <button
                      onClick={handleCall}
                      className="w-full h-14 rounded-2xl bg-green-500 hover:bg-green-600 flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-lg shadow-green-500/30"
                    >
                      <PhoneIcon className="w-6 h-6 text-white" />
                      <span className="text-white font-semibold text-lg">Call Agent</span>
                    </button>
                  </div>

                  {/* Home Indicator */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                    <div className="w-[134px] h-[5px] bg-white/30 rounded-full" />
                  </div>
                </div>
              )}

              {/* INCOMING STATE - iOS Style Incoming Call */}
              {state === 'incoming' && incoming && (
                <div
                  className="h-full flex flex-col items-center pb-12 px-6 relative overflow-hidden"
                  style={{
                    background: 'linear-gradient(180deg, #1e3a5f 0%, #0d2137 100%)'
                  }}
                >
                  {/* Animated rings */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="absolute w-[200px] h-[200px] rounded-full border border-white/10 animate-ping" style={{ animationDuration: '2s' }} />
                    <div className="absolute w-[280px] h-[280px] rounded-full border border-white/5 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.5s' }} />
                  </div>

                  <div className="flex-1 flex flex-col items-center justify-center relative z-10">
                    {/* Contact Photo */}
                    <div className="relative mb-6">
                      <div className="w-28 h-28 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-xl">
                        <BankIcon className="w-14 h-14 text-white" />
                      </div>
                      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-green-500 rounded-full">
                        <span className="text-white text-xs font-semibold">Incoming call</span>
                      </div>
                    </div>

                    <h2 className="text-white text-3xl font-semibold mb-2">{incoming.phoneNumber}</h2>
                    <p className="text-white/70 text-base">{incoming.flowName}</p>
                  </div>

                  {/* Action Buttons */}
                  <div className="w-full flex justify-around items-center relative z-10">
                    {/* Decline */}
                    <div className="flex flex-col items-center gap-2">
                      <button
                        onClick={handleDecline}
                        className="w-[70px] h-[70px] rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-red-500/40"
                      >
                        <PhoneIcon className="w-8 h-8 text-white rotate-[135deg]" />
                      </button>
                      <span className="text-white/70 text-sm">Decline</span>
                    </div>

                    {/* Accept */}
                    <div className="flex flex-col items-center gap-2">
                      <button
                        onClick={handleAnswer}
                        className="w-[70px] h-[70px] rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-green-500/40 animate-pulse"
                      >
                        <PhoneIcon className="w-8 h-8 text-white" />
                      </button>
                      <span className="text-white/70 text-sm">Accept</span>
                    </div>
                  </div>

                  {/* Home Indicator */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                    <div className="w-[134px] h-[5px] bg-white/30 rounded-full" />
                  </div>
                </div>
              )}

              {/* CONNECTING STATE */}
              {state === 'connecting' && (
                <div
                  className="h-full flex flex-col items-center justify-center px-6"
                  style={{
                    background: 'linear-gradient(180deg, #1e3a5f 0%, #0d2137 100%)'
                  }}
                >
                  <div className="relative mb-8">
                    <div className="w-28 h-28 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
                      <BankIcon className="w-14 h-14 text-white" />
                    </div>
                    <div className="absolute inset-0 rounded-full border-4 border-white/20 border-t-white animate-spin" />
                  </div>
                  <h2 className="text-white text-2xl font-semibold mb-2">{callerDisplay}</h2>
                  <p className="text-white/60">Connecting...</p>

                  {/* Home Indicator */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                    <div className="w-[134px] h-[5px] bg-white/30 rounded-full" />
                  </div>
                </div>
              )}

              {/* IN CALL STATE - iOS Style */}
              {(state === 'in_call' || state === 'ending') && (
                <div
                  className="h-full flex flex-col px-6 pb-8"
                  style={{
                    background: 'linear-gradient(180deg, #2d2d2d 0%, #1a1a1a 100%)'
                  }}
                >
                  {/* Caller Info */}
                  <div className="flex-1 flex flex-col items-center pt-16">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center mb-4 shadow-lg">
                      <BankIcon className="w-12 h-12 text-white" />
                    </div>
                    <h2 className="text-white text-2xl font-semibold mb-1">{callerDisplay}</h2>
                    <p className="text-white/60 text-lg">{formatDuration(duration)}</p>

                    {/* Connection Status */}
                    <div className="mt-4 flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-white/80 text-sm">AI is processing</span>
                    </div>
                  </div>

                  {/* Call Controls Grid */}
                  <div className="space-y-6 mb-8">
                    <div className="grid grid-cols-3 gap-4">
                      <CallControlButton
                        icon={<MuteIcon />}
                        label="Mute"
                        active={isMuted || isMutedLocal}
                        onClick={handleToggleMute}
                      />
                      <CallControlButton
                        icon={<KeypadIcon />}
                        label="Keypad"
                        disabled
                      />
                      <CallControlButton
                        icon={<SpeakerIcon />}
                        label="Speaker"
                        active={speakerOn}
                        onClick={toggleSpeaker}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <CallControlButton
                        icon={<AddCallIcon />}
                        label="Add"
                        disabled
                      />
                      <CallControlButton
                        icon={<VideoIcon />}
                        label="Video"
                        disabled
                      />
                      <CallControlButton
                        icon={<ContactsIcon />}
                        label="Contacts"
                        disabled
                      />
                    </div>
                  </div>

                  {/* End Call Button */}
                  <div className="flex justify-center">
                    <button
                      onClick={handleEndCall}
                      disabled={state === 'ending'}
                      className={`w-[70px] h-[70px] rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-red-500/40 ${
                        state === 'ending' ? 'opacity-60' : ''
                      }`}
                    >
                      <PhoneIcon className="w-8 h-8 text-white rotate-[135deg]" />
                    </button>
                  </div>

                  {/* Home Indicator */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
                    <div className="w-[134px] h-[5px] bg-white/30 rounded-full" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CallControlButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-2 py-4 rounded-2xl transition-all cursor-pointer ${
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : ''
      }`}
    >
      <div className={`w-[65px] h-[65px] rounded-full flex items-center justify-center transition-all ${
        active
          ? 'bg-white text-black'
          : 'bg-white/20 text-white hover:bg-white/30'
      }`}>
        {icon}
      </div>
      <span className="text-white/80 text-xs">{label}</span>
    </button>
  )
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
    </svg>
  )
}

function BankIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 10h3v7H4v-7zm6.5 0h3v7h-3v-7zM2 19h20v3H2v-3zm15-9h3v7h-3v-7zm-5-9L2 6v2h20V6L12 1z"/>
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
    </svg>
  )
}

function KeypadIcon() {
  return (
    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 19a2 2 0 110 4 2 2 0 010-4zm-5-5a2 2 0 110 4 2 2 0 010-4zm5 0a2 2 0 110 4 2 2 0 010-4zm5 0a2 2 0 110 4 2 2 0 010-4zM7 9a2 2 0 110 4 2 2 0 010-4zm5 0a2 2 0 110 4 2 2 0 010-4zm5 0a2 2 0 110 4 2 2 0 010-4zM7 4a2 2 0 110 4 2 2 0 010-4zm5 0a2 2 0 110 4 2 2 0 010-4zm5 0a2 2 0 110 4 2 2 0 010-4z"/>
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
  )
}

function AddCallIcon() {
  return (
    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57a1.02 1.02 0 00-1.02.24l-2.2 2.2a15.045 15.045 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.36 11.36 0 018.5 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.5c0-.55-.45-1-1-1zM21 6h-3V3h-2v3h-3v2h3v3h2V8h3z"/>
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
    </svg>
  )
}

function ContactsIcon() {
  return (
    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 0H4v2h16V0zM4 24h16v-2H4v2zM20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 2.75c1.24 0 2.25 1.01 2.25 2.25s-1.01 2.25-2.25 2.25S9.75 10.24 9.75 9 10.76 6.75 12 6.75zM17 17H7v-1.5c0-1.67 3.33-2.5 5-2.5s5 .83 5 2.5V17z"/>
    </svg>
  )
}
