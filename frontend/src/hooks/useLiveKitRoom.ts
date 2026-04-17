import { useState, useEffect, useCallback, useRef } from 'react'
import { Room, RoomEvent, Track, RemoteTrack, LocalTrackPublication } from 'livekit-client'
import type { TranscriptMessage } from '../types'

interface UseLiveKitRoomOptions {
  callId: string
  enabled?: boolean
  /** External token - if provided, skips fetching from API */
  token?: string
  /** External URL - required if token is provided */
  url?: string
  /** Callback when transcript received */
  onTranscript?: (msg: TranscriptMessage) => void
  /** Pre-fetched history turns to seed the transcript list on mount */
  initialTranscripts?: TranscriptMessage[]
}

interface UseLiveKitRoomResult {
  room: Room | null
  connected: boolean
  error: string | null
  /** Local microphone muted (other participants can't hear you) */
  isMicMuted: boolean
  toggleMicMute: () => void
  /** Remote audio muted (you can't hear other participants) */
  isAudioMuted: boolean
  toggleAudioMute: () => void
  /** @deprecated Use isMicMuted and toggleMicMute instead */
  isMuted: boolean
  /** @deprecated Use toggleMicMute instead */
  toggleMute: () => void
  disconnect: () => void
  /** Transcripts received from LiveKit room */
  transcripts: TranscriptMessage[]
}

/**
 * Hook to connect to a LiveKit room for audio playback.
 * Fetches token from backend and manages audio track subscriptions.
 */
export function useLiveKitRoom({
  callId,
  enabled = true,
  token: externalToken,
  url: externalUrl,
  onTranscript,
  initialTranscripts,
}: UseLiveKitRoomOptions): UseLiveKitRoomResult {
  const [room, setRoom] = useState<Room | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isAudioMuted, setIsAudioMuted] = useState(false)
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>(initialTranscripts ?? [])
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const turnIndexRef = useRef(
    initialTranscripts && initialTranscripts.length > 0
      ? Math.max(...initialTranscripts.map((m) => m.turnIndex)) + 1
      : 0
  )

  // Re-seed transcript state when history arrives (async fetch may complete after mount)
  useEffect(() => {
    if (!initialTranscripts || initialTranscripts.length === 0) return
    setTranscripts((prev) => {
      if (prev.length === 0) return initialTranscripts
      // Merge: prepend history turns not already present
      const existingKeys = new Set(prev.map((m) => `${m.turnIndex}:${m.role}:${m.isFinal ? 'f' : 'i'}`))
      const additions = initialTranscripts.filter(
        (m) => !existingKeys.has(`${m.turnIndex}:${m.role}:f`)
      )
      if (additions.length === 0) return prev
      return [...additions, ...prev]
    })
    const maxTurn = Math.max(...initialTranscripts.map((m) => m.turnIndex))
    if (turnIndexRef.current <= maxTurn) {
      turnIndexRef.current = maxTurn + 1
    }
  }, [initialTranscripts])

  const connect = useCallback(async () => {
    if (!enabled || !callId) return

    let token: string
    let url: string

    try {
      // Use external token if provided, otherwise fetch from API
      if (externalToken && externalUrl) {
        token = externalToken
        url = externalUrl
      } else {
        const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
        const tokenRes = await fetch(`${baseUrl}/api/calls/${callId}/token`)
        if (!tokenRes.ok) {
          if (tokenRes.status === 410) {
            // Room has ended - this is expected for completed calls
            const data = await tokenRes.json().catch(() => ({}))
            throw new Error(data.detail || 'Call has ended. Room no longer available.')
          }
          if (tokenRes.status === 404) {
            throw new Error('Call not found')
          }
          throw new Error('Failed to fetch LiveKit token')
        }
        const data = await tokenRes.json()
        token = data.token
        url = data.url
      }

      console.log('[LiveKit] Connecting to', url, 'with token for call', callId)

      const newRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      })

      newRoom.on(RoomEvent.Connected, () => {
        console.log('[LiveKit] Connected to room')
        setConnected(true)
        setError(null)
      })

      newRoom.on(RoomEvent.Disconnected, (reason) => {
        console.log('[LiveKit] Disconnected:', reason)
        setConnected(false)
      })

      newRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          // Attach audio element to play the track
          const audioEl = track.attach() as HTMLAudioElement
          const trackId = track.sid ?? track.source ?? String(Date.now())
          audioEl.id = `audio-${trackId}`
          document.body.appendChild(audioEl)
          audioElementsRef.current.set(trackId, audioEl)
        }
      })

      newRoom.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const trackId = track.sid ?? track.source ?? String(Date.now())
          const audioEl = audioElementsRef.current.get(trackId)
          if (audioEl) {
            audioEl.remove()
            audioElementsRef.current.delete(trackId)
          }
        }
      })

      await newRoom.connect(url, token)

      // Subscribe to transcription events from LiveKit room
      try {
        newRoom.registerTextStreamHandler('lk.transcription', async (reader, participantInfo) => {
          const info = reader.info
          const text = await reader.readAll()

          // Determine role from participant identity
          const isAgent = participantInfo.identity.startsWith('agent-')
          const role = isAgent ? 'agent' : 'customer'

          // Check if final transcript
          const isFinal = info.attributes?.['lk.transcription_final'] === 'true'

          const msg: TranscriptMessage = {
            id: `${info.id}-${Date.now()}`,
            role,
            text,
            timestamp: new Date().toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            isFinal,
            turnIndex: turnIndexRef.current,
            isLive: !isFinal,
          }

          if (isFinal) {
            turnIndexRef.current++
          }

          console.log('[LiveKit Transcript]', role, isFinal ? 'FINAL' : 'INTERIM', text)

          setTranscripts((prev) => {
            if (isFinal) {
              // Dedupe: skip if an identical final turn already exists (e.g. from history)
              const dupeKey = `${msg.turnIndex}:${msg.role}:f`
              const alreadyFinal = prev.some(
                (m) => `${m.turnIndex}:${m.role}:${m.isFinal ? 'f' : 'i'}` === dupeKey
              )
              if (alreadyFinal) return prev
              // Remove interim for same turn, add final
              const filtered = prev.filter(
                (m) => m.turnIndex !== msg.turnIndex || m.isFinal
              )
              return [...filtered, msg]
            } else {
              // Update existing interim or add new
              const existingIdx = prev.findIndex(
                (m) => m.turnIndex === msg.turnIndex && !m.isFinal
              )
              if (existingIdx >= 0) {
                const updated = [...prev]
                updated[existingIdx] = msg
                return updated
              }
              return [...prev, msg]
            }
          })

          onTranscript?.(msg)
        })
        console.log('[LiveKit] Registered transcription handler')
      } catch (transcriptErr) {
        console.warn('Could not register transcription handler:', transcriptErr)
      }

      // Enable local microphone if token allows publishing (phone simulator)
      // This also triggers the agent dispatch since participant is now in the room
      try {
        await newRoom.localParticipant.setMicrophoneEnabled(true)
        console.log('Microphone enabled')
      } catch (micErr) {
        console.warn('Could not enable microphone:', micErr)
      }

      setRoom(newRoom)
    } catch (e) {
      const errMessage = e instanceof Error ? e.message : 'Failed to connect to LiveKit'
      setError(errMessage)
      console.error('LiveKit connection error:', e)
    }
  }, [callId, enabled, externalToken, externalUrl, onTranscript])

  useEffect(() => {
    connect()

    return () => {
      // Cleanup audio elements
      audioElementsRef.current.forEach((el) => el.remove())
      audioElementsRef.current.clear()
      room?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect])

  const toggleMicMute = useCallback(async () => {
    if (!room) return

    const newMuted = !isMicMuted
    try {
      // Mute/unmute the local microphone track
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone) as LocalTrackPublication | undefined
      if (micPub?.track) {
        if (newMuted) {
          await micPub.mute()
        } else {
          await micPub.unmute()
        }
      }
      setIsMicMuted(newMuted)
    } catch (e) {
      console.error('Failed to toggle mic mute:', e)
    }
  }, [room, isMicMuted])

  const toggleAudioMute = useCallback(() => {
    // Mute/unmute all remote audio elements (what you hear)
    const newMuted = !isAudioMuted
    audioElementsRef.current.forEach((audioEl) => {
      audioEl.muted = newMuted
    })
    setIsAudioMuted(newMuted)
  }, [isAudioMuted])

  // Backwards compatibility alias
  const toggleMute = toggleMicMute
  const isMuted = isMicMuted

  const disconnect = useCallback(() => {
    audioElementsRef.current.forEach((el) => el.remove())
    audioElementsRef.current.clear()
    room?.disconnect()
    setRoom(null)
    setConnected(false)
  }, [room])

  return {
    room,
    connected,
    error,
    isMicMuted,
    toggleMicMute,
    isAudioMuted,
    toggleAudioMute,
    // Backwards compatibility
    isMuted,
    toggleMute,
    disconnect,
    transcripts,
  }
}
