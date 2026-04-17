import { useState, useEffect, useRef } from 'react'
import Icon from '../components/Icon'
import { initiateSimulatorCallV2, endCall } from '../api'
import { useLiveKitRoom } from '../hooks/useLiveKitRoom'

type CallState = 'idle' | 'connecting' | 'in_call' | 'ending'

/**
 * Phone Simulator V2 — "Báo mất thẻ" scenario.
 *
 * Same UX as /phone but dispatches the `report_lost_card` flow and labels the
 * UI for the lost-card use case.
 */
export default function PhoneV2() {
  const [state, setState] = useState<CallState>('idle')
  const [callId, setCallId] = useState<string | null>(null)
  const [dbCallId, setDbCallId] = useState<string | null>(null)
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null)
  const [liveKitUrl, setLiveKitUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [speakerOn, setSpeakerOn] = useState(false)

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
      setCallId(null)
      setDbCallId(null)
      setLiveKitToken(null)
      setLiveKitUrl(null)
      setDuration(0)
      setState('idle')
    }
  }, [connected, state])

  useEffect(() => {
    if (state !== 'in_call') return
    const interval = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(interval)
  }, [state])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const handleCall = async () => {
    setState('connecting')
    try {
      const data = await initiateSimulatorCallV2()
      setCallId(data.call_id)
      setDbCallId(data.db_id)
      setLiveKitToken(data.token)
      setLiveKitUrl(data.url)
      setState('in_call')
    } catch (e) {
      setState('idle')
      console.error('Failed to connect V2:', e)
      alert('Khong the ket noi. Vui long thu lai.')
    }
  }

  const handleEndCall = async () => {
    setState('ending')
    disconnect()
    if (dbCallId) {
      try {
        await endCall(dbCallId, { disposition: 'completed' })
      } catch (e) {
        console.error('Failed to end v2 call:', e)
      }
    }
    setCallId(null)
    setDbCallId(null)
    setLiveKitToken(null)
    setLiveKitUrl(null)
    setDuration(0)
    setState('idle')
  }

  const toggleSpeaker = () => setSpeakerOn((prev) => !prev)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
        {/* Status Bar */}
        <div className="flex items-center justify-between px-6 py-3 bg-gray-50">
          <span className="text-xs font-medium text-gray-600">
            {new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <div className="flex items-center gap-1">
            <Icon name="signal_cellular_alt" size={14} className="text-gray-600" />
            <Icon name="wifi" size={14} className="text-gray-600" />
            <Icon name="battery_full" size={14} className="text-gray-600" />
          </div>
        </div>

        <div className="px-6 py-8 flex flex-col items-center min-h-[500px]">
          {/* Scenario Banner */}
          <div className="mb-4 px-3 py-1 rounded-full bg-error/10 text-error text-xs font-semibold uppercase tracking-wide">
            Kich ban: Bao mat the
          </div>

          <div className="relative mb-4">
            <div className="w-24 h-24 rounded-full bg-error/10 flex items-center justify-center">
              <Icon name="credit_card_off" size={48} className="text-error" />
            </div>
            {state === 'in_call' && connected && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-success flex items-center justify-center">
                <Icon name="call" size={14} className="text-white" />
              </div>
            )}
          </div>

          <h2 className="text-xl font-bold text-navy mb-1">Shinhan Card Services</h2>

          {state === 'idle' && (
            <p className="text-sm text-on-surface-variant mb-8 text-center">
              San sang tiep nhan yeu cau khoa the.
              <br />
              Chuan bi CCCD, ho ten, 4 so cuoi the.
            </p>
          )}
          {state === 'connecting' && (
            <p className="text-sm text-warning mb-8">Dang ket noi...</p>
          )}
          {state === 'in_call' && (
            <>
              <p className="text-sm text-success mb-2">Dang trong cuoc goi...</p>
              <span className="text-3xl font-mono font-bold text-on-surface mb-4">
                {formatDuration(duration)}
              </span>
            </>
          )}

          {state === 'idle' && (
            <div className="flex-1 flex items-center justify-center">
              <button
                onClick={handleCall}
                className="w-20 h-20 rounded-full bg-success hover:bg-success/90 flex items-center justify-center shadow-lg shadow-success/30 transition-all active:scale-95"
              >
                <Icon name="call" size={36} className="text-white" />
              </button>
            </div>
          )}

          {state === 'connecting' && (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          )}

          {(state === 'in_call' || state === 'ending') && (
            <div className="flex-1 flex flex-col justify-between w-full">
              <div className="bg-surface-container-low rounded-2xl p-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-sm text-on-surface-variant">
                    AI dang xac minh danh tinh...
                  </span>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div className="grid grid-cols-3 gap-4">
                  <ControlButton
                    icon={isMuted ? 'mic_off' : 'mic'}
                    label="Tat tieng"
                    active={isMuted}
                    onClick={toggleMute}
                  />
                  <ControlButton icon="dialpad" label="Ban phim" disabled />
                  <ControlButton
                    icon={speakerOn ? 'volume_up' : 'volume_down'}
                    label="Loa ngoai"
                    active={speakerOn}
                    onClick={toggleSpeaker}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <ControlButton icon="add_call" label="Them cuoc goi" disabled />
                  <ControlButton icon="videocam" label="Video" disabled />
                  <ControlButton icon="contacts" label="Danh ba" disabled />
                </div>
              </div>

              <button
                onClick={handleEndCall}
                disabled={state === 'ending'}
                className={`w-full py-4 rounded-2xl bg-error hover:bg-error/90 text-white font-bold text-lg transition-all active:scale-[0.98] shadow-lg shadow-error/30 ${
                  state === 'ending' ? 'opacity-60 cursor-wait' : ''
                }`}
              >
                {state === 'ending' ? 'DANG KET THUC...' : 'KET THUC'}
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-center pb-4">
          <div className="w-32 h-1 rounded-full bg-gray-300" />
        </div>
      </div>
    </div>
  )
}

function ControlButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-2 py-4 rounded-2xl transition-all ${
        disabled
          ? 'bg-surface-container-high text-outline cursor-not-allowed opacity-50'
          : active
          ? 'bg-primary/20 text-primary'
          : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
      }`}
    >
      <Icon name={icon} size={24} />
      <span className="text-xs">{label}</span>
    </button>
  )
}
