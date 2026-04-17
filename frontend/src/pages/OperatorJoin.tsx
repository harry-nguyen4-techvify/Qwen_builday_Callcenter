import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { getHumanOperatorToken } from '../api'
import { useLiveKitRoom } from '../hooks/useLiveKitRoom'

/**
 * Standalone page for a human operator to join an escalated call.
 *
 * Fetches a token with identity prefix `human-agent-…` via
 * GET /api/calls/:callId/human-token, then joins the LiveKit room.
 * Once joined, the agent-side `participant_connected` listener auto-stops
 * the hold music.
 */
export default function OperatorJoin() {
  const { callId } = useParams<{ callId: string }>()
  const [token, setToken] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [identity, setIdentity] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!callId) return
    let alive = true
    ;(async () => {
      try {
        const res = await getHumanOperatorToken(callId)
        if (!alive) return
        setToken(res.token)
        setUrl(res.url)
        setIdentity(res.identity)
      } catch (e: unknown) {
        if (!alive) return
        setError(
          (e as { response?: { data?: { detail?: string } }; message?: string })
            ?.response?.data?.detail ||
            (e as { message?: string })?.message ||
            'Failed to fetch operator token'
        )
      }
    })()
    return () => {
      alive = false
    }
  }, [callId])

  const { connected, isMuted, toggleMute, disconnect } = useLiveKitRoom({
    callId: callId || '',
    enabled: !!callId && !!token && !!url,
    token: token ?? undefined,
    url: url ?? undefined,
  })

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 text-center space-y-4">
          <Icon name="error" className="text-6xl text-error/60" />
          <h2 className="text-xl font-bold text-navy">Cannot join call</h2>
          <p className="text-sm text-on-surface-variant">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-8 flex flex-col items-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Icon
              name={connected ? 'support_agent' : 'hourglass_top'}
              size={40}
              className={connected ? 'text-primary' : 'text-on-surface-variant'}
            />
          </div>
          <h2 className="text-xl font-bold text-navy mb-1">Human Operator</h2>
          <p className="text-sm text-on-surface-variant mb-6 text-center">
            Call <span className="font-mono">{callId}</span>
          </p>

          <div className="w-full space-y-3 mb-6">
            <StatusRow
              label="Token"
              value={token ? 'Issued' : 'Fetching...'}
              success={!!token}
            />
            <StatusRow
              label="Identity"
              value={identity || 'Pending...'}
              success={!!identity}
            />
            <StatusRow
              label="Room"
              value={connected ? 'Connected (hold music stopping)' : 'Joining...'}
              success={connected}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 w-full">
            <button
              onClick={toggleMute}
              disabled={!connected}
              className={`py-3 rounded-xl font-bold text-sm transition-all ${
                isMuted
                  ? 'bg-error/15 text-error hover:bg-error/25'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              } ${!connected ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Icon name={isMuted ? 'mic_off' : 'mic'} size={18} className="mr-1.5" />
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={() => {
                disconnect()
                window.close()
              }}
              className="py-3 rounded-xl bg-error text-white font-bold text-sm hover:brightness-110 transition-all"
            >
              Leave
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusRow({
  label,
  value,
  success,
}: {
  label: string
  value: string
  success: boolean
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-surface-container-low rounded-lg">
      <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
        {label}
      </span>
      <span
        className={`text-sm font-mono ${success ? 'text-success' : 'text-on-surface-variant'}`}
      >
        {value}
      </span>
    </div>
  )
}
