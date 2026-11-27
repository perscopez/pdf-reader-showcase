'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Mic, Pause, Play, Square, Tag, Trash2 } from 'lucide-react'
import { useI18n } from './I18nProvider'
import type { AudioNoteMarker, AudioNoteSession, LocalAudioNoteDraft } from '@/lib/audioNotes'
import {
  AUDIO_NOTE_MAX_BYTES,
  audioNoteStreamUrl,
  createLocalAudioDraftId,
  deleteLocalAudioDraft,
  getLocalAudioDraft,
  isAllowedAudioMime,
  listLocalAudioDrafts,
  normalizeAudioMime,
  normalizeAudioTitle,
  saveLocalAudioDraft,
} from '@/lib/audioNotes'
import type { THEME_STYLES } from './ReaderUI'

type ThemeStyle = (typeof THEME_STYLES)[keyof typeof THEME_STYLES]

export interface AudioNoteRecorderHandle {
  attachAnnotationMarker: (annotationId: number, sessionId: number | string, timestampMs: number, page: number) => Promise<void>
}

interface AudioNoteRecorderProps {
  bookId: number
  page: number
  isEncrypted: boolean
  open: boolean
  themeStyle: ThemeStyle
  onClose: () => void
  onGoToPage: (page: number) => void
  onOpenAnnotation: (annotationId: number) => void
  onOpenNoteAtMarker: (sessionId: number | string, timestampMs: number, page: number) => void
  onActiveChange?: (value: { sessionId: number | string; timestampMs: number } | null) => void
}

interface ActiveRecording {
  id: number | string
  draftId: string
  title: string
  page: number
  mimeType: string
  markers: AudioNoteMarker[]
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function recordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(mime)) return normalizeAudioMime(mime)
  }
  return ''
}

const AudioNoteRecorder = forwardRef<AudioNoteRecorderHandle, AudioNoteRecorderProps>(function AudioNoteRecorder({
  bookId,
  page,
  isEncrypted,
  open,
  themeStyle,
  onClose,
  onGoToPage,
  onOpenAnnotation,
  onOpenNoteAtMarker,
  onActiveChange,
}, ref) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [active, setActive] = useState<ActiveRecording | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [status, setStatus] = useState<'idle' | 'recording' | 'paused' | 'uploading' | 'unsupported' | 'permission-denied'>('idle')
  const [error, setError] = useState('')
  const [localOnly, setLocalOnly] = useState(isEncrypted)
  const [sessions, setSessions] = useState<AudioNoteSession[]>([])
  const [drafts, setDrafts] = useState<LocalAudioNoteDraft[]>([])
  const [replay, setReplay] = useState<{ id: number | string; url: string; markers: AudioNoteMarker[]; page: number } | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const activeRef = useRef<ActiveRecording | null>(null)
  const elapsedMsRef = useRef(0)
  const segmentStartedAtRef = useRef(0)
  const elapsedBeforeSegmentRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const audioRefs = useRef(new Map<string, HTMLAudioElement>())
  const replayUrlRef = useRef<string | null>(null)

  const setActiveRecording = (value: ActiveRecording | null) => {
    activeRef.current = value
    setActive(value)
    onActiveChange?.(value ? { sessionId: value.id, timestampMs: elapsedMsRef.current } : null)
  }

  const currentElapsed = () => status === 'recording'
    ? elapsedBeforeSegmentRef.current + Math.max(0, Date.now() - segmentStartedAtRef.current)
    : elapsedMsRef.current

  const persistDraft = (draft?: Partial<LocalAudioNoteDraft>) => {
    const current = activeRef.current
    if (!current) return
    const value: LocalAudioNoteDraft = {
      id: current.draftId,
      bookId,
      title: current.title,
      page: current.page,
      durationMs: elapsedMsRef.current,
      mimeType: current.mimeType,
      updatedAt: new Date().toISOString(),
      markers: current.markers,
      ...draft,
      blob: new Blob(chunksRef.current, { type: current.mimeType }),
    }
    void saveLocalAudioDraft(value).catch(() => {})
  }

  useEffect(() => {
    let cancelled = false
    void listLocalAudioDrafts(bookId).then(value => { if (!cancelled) setDrafts(value) }).catch(() => {})
    return () => { cancelled = true }
  }, [bookId])

  useEffect(() => {
    if (!open || isEncrypted) return
    void fetch(`/api/audio-notes?book_id=${bookId}`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error('audio sessions unavailable')))
      .then(value => { if (Array.isArray(value)) setSessions(value as AudioNoteSession[]) })
      .catch(() => {})
  }, [bookId, isEncrypted, open])

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach(track => track.stop())
    if (replayUrlRef.current) URL.revokeObjectURL(replayUrlRef.current)
  }, [])

  useEffect(() => {
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      if (!activeRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeExit)
    return () => window.removeEventListener('beforeunload', warnBeforeExit)
  }, [])

  useImperativeHandle(ref, () => ({
    async attachAnnotationMarker(annotationId, sessionId, timestampMs, markerPage) {
      const current = activeRef.current
      if (typeof sessionId === 'number') {
        const response = await fetch(`/api/audio-notes/${sessionId}/markers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotation_id: annotationId, timestamp_ms: timestampMs, page: markerPage }),
        })
        if (!response.ok) throw new Error('audio marker save failed')
        if (current?.id === sessionId) {
          const marker = await response.json() as AudioNoteMarker
          const next = { ...current, markers: [...current.markers, marker].sort((a, b) => a.timestamp_ms - b.timestamp_ms) }
          setActiveRecording(next)
        }
        return
      }
      if (!current || current.id !== sessionId) return
      const marker: AudioNoteMarker = {
        id: `local-marker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        session_id: sessionId,
        annotation_id: annotationId,
        page: markerPage,
        timestamp_ms: timestampMs,
      }
      const next = { ...current, markers: [...current.markers, marker].sort((a, b) => a.timestamp_ms - b.timestamp_ms) }
      setActiveRecording(next)
      persistDraft({ markers: next.markers })
    },
  }), [])

  const updateElapsed = () => {
    const next = currentElapsed()
    elapsedMsRef.current = next
    setElapsedMs(next)
    const current = activeRef.current
    if (current) onActiveChange?.({ sessionId: current.id, timestampMs: next })
  }

  const start = async () => {
    setError('')
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported')
      return
    }
    const mimeType = recordingMimeType()
    if (!mimeType || !isAllowedAudioMime(mimeType)) {
      setStatus('unsupported')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setStatus('permission-denied')
      return
    }

    let remote: AudioNoteSession | null = null
    if (!isEncrypted) {
      try {
        const response = await fetch('/api/audio-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book_id: bookId, title: normalizeAudioTitle(title) || undefined }),
        })
        if (response.ok) remote = await response.json() as AudioNoteSession
        else setLocalOnly(true)
      } catch {
        setLocalOnly(true)
      }
    }
    const id = remote?.id ?? createLocalAudioDraftId()
    const draftId = typeof id === 'number' ? createLocalAudioDraftId() : id
    const nextActive: ActiveRecording = { id, draftId, title: normalizeAudioTitle(title) || t('reader.audioNotes'), page, mimeType, markers: [] }
    try {
      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      streamRef.current = stream
      recorderRef.current = recorder
      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
          persistDraft()
        }
      }
      recorder.onerror = () => setError(t('reader.audioNotesUploadFailed'))
      recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()) }
      recorder.start(1000)
      elapsedBeforeSegmentRef.current = 0
      elapsedMsRef.current = 0
      segmentStartedAtRef.current = Date.now()
      setActiveRecording(nextActive)
      setElapsedMs(0)
      setStatus('recording')
      timerRef.current = window.setInterval(updateElapsed, 200)
      persistDraft()
      if (remote) void fetch(`/api/audio-notes/${remote.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'recording' }) }).catch(() => {})
    } catch {
      stream.getTracks().forEach(track => track.stop())
      setStatus('unsupported')
    }
  }

  const pauseOrResume = () => {
    const recorder = recorderRef.current
    const current = activeRef.current
    if (!recorder || !current) return
    if (status === 'recording') {
      updateElapsed()
      elapsedBeforeSegmentRef.current = elapsedMsRef.current
      recorder.pause()
      setStatus('paused')
      if (typeof current.id === 'number') void fetch(`/api/audio-notes/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paused', duration_ms: elapsedMsRef.current }) }).catch(() => {})
    } else if (status === 'paused') {
      recorder.resume()
      segmentStartedAtRef.current = Date.now()
      setStatus('recording')
      if (typeof current.id === 'number') void fetch(`/api/audio-notes/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'recording', duration_ms: elapsedMsRef.current }) }).catch(() => {})
    }
  }

  const addMarker = async () => {
    const current = activeRef.current
    if (!current) return
    updateElapsed()
    const timestampMs = currentElapsed()
    const marker = { session_id: current.id, annotation_id: null, page, timestamp_ms: timestampMs }
    let saved = marker as AudioNoteMarker
    if (typeof current.id === 'number') {
      const response = await fetch(`/api/audio-notes/${current.id}/markers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(marker),
      })
      if (!response.ok) { setError(t('reader.audioNotesUploadFailed')); return }
      saved = await response.json() as AudioNoteMarker
    } else {
      saved = { ...marker, id: `local-marker-${Date.now()}` }
    }
    const next = { ...current, markers: [...current.markers, saved].sort((a, b) => a.timestamp_ms - b.timestamp_ms) }
    setActiveRecording(next)
    persistDraft({ markers: next.markers })
  }

  const stop = async () => {
    const recorder = recorderRef.current
    const current = activeRef.current
    if (!recorder || !current) return
    updateElapsed()
    const durationMs = currentElapsed()
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    setStatus('uploading')
    const blob = await new Promise<Blob>(resolve => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunksRef.current, { type: current.mimeType })), { once: true })
      recorder.stop()
    })
    recorderRef.current = null
    streamRef.current = null
    if (replayUrlRef.current) URL.revokeObjectURL(replayUrlRef.current)
    replayUrlRef.current = URL.createObjectURL(blob)
    setReplay({ id: current.id, url: replayUrlRef.current, markers: current.markers, page: current.page })

    let uploaded = false
    if (typeof current.id === 'number' && !isEncrypted && blob.size <= AUDIO_NOTE_MAX_BYTES) {
      const formData = new FormData()
      formData.append('file', blob, `audio-note.${current.mimeType === 'audio/mp4' ? 'm4a' : 'webm'}`)
      formData.append('duration_ms', String(durationMs))
      try {
        const response = await fetch(`/api/audio-notes/${current.id}/upload`, { method: 'POST', body: formData })
        uploaded = response.ok
        if (uploaded) {
          const session = await response.json() as AudioNoteSession
          setSessions(currentSessions => [session, ...currentSessions.filter(item => item.id !== session.id)])
          await deleteLocalAudioDraft(current.draftId).catch(() => {})
        }
      } catch {
        uploaded = false
      }
    }
    if (!uploaded && typeof current.id === 'number') setLocalOnly(true)
    if (!uploaded) persistDraft({ durationMs, markers: current.markers })
    if (uploaded) setError('')
    else if (typeof current.id === 'number') setError(t('reader.audioNotesUploadFailed'))
    setStatus('idle')
    setActiveRecording(null)
    setElapsedMs(durationMs)
    setDrafts(await listLocalAudioDrafts(bookId).catch(() => drafts))
  }

  const recoverDraft = async (id: string) => {
    const draft = await getLocalAudioDraft(id).catch(() => null)
    if (!draft?.blob) return
    if (replayUrlRef.current) URL.revokeObjectURL(replayUrlRef.current)
    replayUrlRef.current = URL.createObjectURL(draft.blob)
    setReplay({ id: draft.id, url: replayUrlRef.current, markers: draft.markers || [], page: draft.page })
  }

  const discardDraft = async (id: string) => {
    await deleteLocalAudioDraft(id).catch(() => {})
    setDrafts(current => current.filter(draft => draft.id !== id))
    if (replay?.id === id) setReplay(null)
  }

  const seekMarker = (sessionId: number | string, marker: AudioNoteMarker) => {
    const audio = audioRefs.current.get(String(sessionId))
    if (audio) {
      audio.currentTime = marker.timestamp_ms / 1000
      void audio.play().catch(() => {})
    }
    onGoToPage(marker.page)
    if (marker.annotation_id !== null) onOpenAnnotation(marker.annotation_id)
  }

  const renderMarkers = (sessionId: number | string, markers: AudioNoteMarker[]) => (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {markers.map(marker => (
        <button key={String(marker.id)} type="button" onClick={() => seekMarker(sessionId, marker)} className={`rounded-full border px-2 py-1 text-[10px] ${themeStyle.button}`}>
          {formatTime(marker.timestamp_ms)} · {t('reader.audioNotesSource', { page: marker.page })}
        </button>
      ))}
    </div>
  )

  const recorderPanel = (
    <div className={`fixed inset-y-0 right-0 z-[125] w-full overflow-y-auto border-l p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:w-[23rem] ${themeStyle.panel}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className={`text-xs uppercase tracking-[0.18em] ${themeStyle.subtle}`}>{t('reader.audioNotes')}</p>
          <p className={`text-sm ${themeStyle.subtle}`}>{localOnly ? t('reader.audioNotesLocalOnly') : t('reader.audioNotesElapsed')}</p>
        </div>
        <button type="button" onClick={onClose} className={`rounded-lg border px-2 py-1 text-xs ${themeStyle.button}`}>×</button>
      </div>
      {!active && status === 'idle' && (
        <>
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder={t('reader.audioNotesTitlePlaceholder')} className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${themeStyle.button}`} maxLength={120} />
          <button type="button" onClick={() => void start()} className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${themeStyle.active}`}><Mic size={16} />{t('reader.audioNotesStart')}</button>
        </>
      )}
      {active && (
        <div className={`rounded-2xl border p-3 ${themeStyle.active}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{active.title}</span>
            <span className="font-mono text-sm tabular-nums">{formatTime(elapsedMs)}</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={pauseOrResume} className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs ${themeStyle.button}`}>{status === 'paused' ? <Play size={14} /> : <Pause size={14} />}{status === 'paused' ? t('reader.audioNotesResume') : t('reader.audioNotesPause')}</button>
            <button type="button" onClick={() => void addMarker()} className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs ${themeStyle.button}`}><Tag size={14} />{t('reader.audioNotesMarker')}</button>
            <button type="button" onClick={() => onOpenNoteAtMarker(active.id, currentElapsed(), page)} className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs ${themeStyle.button}`}><Tag size={14} />{t('reader.audioNotesAddNote')}</button>
          </div>
          <button type="button" onClick={() => void stop()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-red-400/40 bg-red-500/20 px-2 py-2 text-xs font-semibold text-red-100"><Square size={14} />{t('reader.audioNotesStop')}</button>
          {renderMarkers(active.id, active.markers)}
        </div>
      )}
      {status === 'unsupported' && <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs">{t('reader.audioNotesUnsupported')}</p>}
      {status === 'permission-denied' && <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs">{t('reader.audioNotesPermissionDenied')}</p>}
      {status === 'uploading' && <p className={`text-xs ${themeStyle.subtle}`}>{t('reader.audioNotesUploading')}</p>}
      {error && <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-xs">{error}</p>}
      {replay && (
        <div className={`rounded-2xl border p-3 ${themeStyle.button}`}>
          <p className="text-xs font-semibold">{t('reader.audioNotesReplay')}</p>
          <audio ref={element => { if (element) audioRefs.current.set(String(replay.id), element) }} controls preload="metadata" src={replay.url} className="mt-2 w-full" />
          {renderMarkers(replay.id, replay.markers)}
        </div>
      )}
      {drafts.length > 0 && (
        <div className={`rounded-xl border p-3 ${themeStyle.button}`}>
          <p className="text-xs font-semibold">{t('reader.audioNotesRecoverDraft')}</p>
          {drafts.map(draft => (
            <div key={draft.id} className="mt-2 flex items-center gap-2 text-xs">
              <button type="button" onClick={() => void recoverDraft(draft.id)} className="min-w-0 flex-1 truncate text-left">{draft.title || t('reader.audioNotes')}</button>
              <span className={themeStyle.subtle}>{formatTime(draft.durationMs)}</span>
              <button type="button" onClick={() => void discardDraft(draft.id)} className="rounded p-1 text-red-300" aria-label={t('reader.audioNotesDiscardDraft')}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {!isEncrypted && sessions.length === 0 && !active && <p className={`text-xs ${themeStyle.subtle}`}>{t('reader.audioNotesNoSessions')}</p>}
      {!isEncrypted && sessions.map(session => (
        <div key={session.id} className={`rounded-2xl border p-3 ${themeStyle.button}`}>
          <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{session.title}</span><span className={`text-xs ${themeStyle.subtle}`}>{formatTime(session.duration_ms)}</span></div>
          {session.file_path ? <audio ref={element => { if (element) audioRefs.current.set(String(session.id), element) }} controls preload="metadata" src={audioNoteStreamUrl(session.id)} className="mt-2 w-full" /> : <p className={`mt-2 text-xs ${themeStyle.subtle}`}>{t('reader.audioNotesNoAudio')}</p>}
          {renderMarkers(session.id, session.markers || [])}
        </div>
      ))}
    </div>
  )

  return (
    <>
      {open && recorderPanel}
      {active && !open && (
        <div className={`fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[130] rounded-2xl border p-3 shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[24rem] ${themeStyle.panel}`}>
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{t('reader.audioNotes')}</span><span className="font-mono text-sm">{formatTime(elapsedMs)}</span></div>
          <div className="mt-2 flex gap-2"><button type="button" onClick={pauseOrResume} className={`flex-1 rounded-lg border px-2 py-2 text-xs ${themeStyle.button}`}>{status === 'paused' ? t('reader.audioNotesResume') : t('reader.audioNotesPause')}</button><button type="button" onClick={() => void addMarker()} className={`flex-1 rounded-lg border px-2 py-2 text-xs ${themeStyle.button}`}>{t('reader.audioNotesMarker')}</button><button type="button" onClick={() => void stop()} className="rounded-lg border border-red-400/40 bg-red-500/20 px-3 py-2 text-xs text-red-100"><Square size={14} /></button></div>
        </div>
      )}
    </>
  )
})

export default AudioNoteRecorder
