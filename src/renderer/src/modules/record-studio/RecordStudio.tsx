import { useEffect, useRef, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import type { RecordingSource } from '@shared/workspace'

type Phase = 'idle' | 'choosing' | 'recording' | 'saving'

interface MicDevice {
  deviceId: string
  label: string
}

interface CamDevice {
  deviceId: string
  label: string
}

export function RecordStudio(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [sources, setSources] = useState<RecordingSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [includeMic, setIncludeMic] = useState(true)
  const [convertToMp4, setConvertToMp4] = useState(true)
  const [mics, setMics] = useState<MicDevice[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null)
  const [cams, setCams] = useState<CamDevice[]>([])
  const [selectedCamId, setSelectedCamId] = useState<string | null>(null)
  const [showCam, setShowCam] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const camPreviewRef = useRef<HTMLVideoElement>(null)
  const startTimeRef = useRef<number>(0)
  const elapsedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void refreshDevices()
    return () => {
      stopAllStreams()
    }
  }, [])

  async function refreshDevices(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      stream.getTracks().forEach((t) => t.stop())
      const all = await navigator.mediaDevices.enumerateDevices()
      setMics(
        all
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }))
      )
      setCams(
        all
          .filter((d) => d.kind === 'videoinput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Camera' }))
      )
    } catch {
      /* user may decline; can still record screen-only without mic/cam */
    }
  }

  async function chooseSource(): Promise<void> {
    setPhase('choosing')
    const list = await window.api.recording.listSources()
    setSources(list)
    const first = list[0]
    if (first && !selectedSourceId) setSelectedSourceId(first.id)
  }

  function stopAllStreams(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    camStreamRef.current?.getTracks().forEach((t) => t.stop())
    camStreamRef.current = null
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }

  async function startRecording(): Promise<void> {
    if (!selectedSourceId) {
      toast.error('Pick a screen / window first')
      return
    }
    try {
      const screenConstraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedSourceId
          }
        }
      } as unknown as MediaStreamConstraints
      const screenStream = await navigator.mediaDevices.getUserMedia(screenConstraints)

      let micStream: MediaStream | null = null
      if (includeMic) {
        const audioConstraint: MediaTrackConstraints = selectedMicId
          ? { deviceId: { exact: selectedMicId } }
          : {}
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
      }

      const tracks = [
        ...screenStream.getVideoTracks(),
        ...(micStream ? micStream.getAudioTracks() : [])
      ]
      const combined = new MediaStream(tracks)
      streamRef.current = combined

      if (showCam && selectedCamId) {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: selectedCamId } }
          })
          camStreamRef.current = camStream
          if (camPreviewRef.current) {
            camPreviewRef.current.srcObject = camStream
            void camPreviewRef.current.play()
          }
        } catch {
          toast.error('Could not start webcam — recording without it.')
        }
      }

      if (previewRef.current) {
        previewRef.current.srcObject = combined
        void previewRef.current.play()
      }

      const mimePref = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      const mime = mimePref.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
      const recorder = new MediaRecorder(combined, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        void finalizeRecording()
      }
      recorder.start(500)
      recorderRef.current = recorder
      startTimeRef.current = Date.now()
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current)
      }, 200)
      setPhase('recording')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start recording')
    }
  }

  function stopRecording(): void {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'inactive') return
    recorder.stop()
    setPhase('saving')
  }

  async function finalizeRecording(): Promise<void> {
    try {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const buffer = await blob.arrayBuffer()
      const durationMs = Date.now() - startTimeRef.current
      stopAllStreams()
      const result = await window.api.recording.save({
        webmBytes: buffer,
        filename: `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${convertToMp4 ? 'mp4' : 'webm'}`,
        durationMs,
        convertToMp4
      })
      if (result) {
        toast.success(
          <span>
            Saved {(result.sizeBytes / 1e6).toFixed(1)} MB.{' '}
            <button
              className="underline"
              onClick={() => {
                if (window.api.video?.revealInFolder) {
                  window.api.video.revealInFolder(result.outputPath)
                }
              }}
            >
              Show
            </button>
          </span>
        )
      } else {
        toast('Recording discarded.', { icon: '🗑' })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setElapsed(0)
      setPhase('idle')
    }
  }

  function formatElapsed(ms: number): string {
    const total = Math.floor(ms / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/home" className="text-sm text-ink-muted hover:text-ink-base">
            ← Home
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Record</h1>
          <p className="text-xs text-ink-muted mt-1">
            Capture a screen, window, or webcam — saved locally as MP4 (or WebM).
          </p>
        </div>
        {phase === 'recording' ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-rose-300">● REC {formatElapsed(elapsed)}</span>
            <button className="btn-primary px-4 py-2" onClick={stopRecording}>
              Stop
            </button>
          </div>
        ) : null}
      </header>

      {phase === 'idle' || phase === 'choosing' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
          <div className="card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                What to record
              </h3>
              <button className="btn-ghost px-3 py-1 text-xs" onClick={chooseSource}>
                Refresh sources
              </button>
            </div>
            {sources.length === 0 ? (
              <div className="bg-bg-hover rounded p-6 text-center text-sm text-ink-muted">
                <button className="btn-primary px-4 py-2" onClick={chooseSource}>
                  Pick a screen or window
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSourceId(s.id)}
                    className={`text-left card p-2 transition-colors ${
                      selectedSourceId === s.id ? 'border-accent ring-2 ring-accent/50' : ''
                    }`}
                  >
                    <img
                      src={s.thumbnailDataUrl}
                      alt={s.name}
                      className="w-full rounded mb-2"
                    />
                    <div className="text-xs font-medium truncate">{s.name}</div>
                    <div className="text-xs text-ink-dim">{s.type}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="card p-4 flex flex-col gap-3 text-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Audio
              </h3>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeMic}
                  onChange={(e) => setIncludeMic(e.target.checked)}
                />
                <span>Record microphone</span>
              </label>
              {includeMic && mics.length > 0 ? (
                <select
                  className="bg-bg-base rounded px-2 py-1 text-sm"
                  value={selectedMicId ?? mics[0]?.deviceId ?? ''}
                  onChange={(e) => setSelectedMicId(e.target.value)}
                >
                  {mics.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {includeMic && mics.length === 0 ? (
                <p className="text-xs text-amber-300">
                  No microphone found. Click "Refresh sources" after granting permission.
                </p>
              ) : null}
            </div>
            <div className="card p-4 flex flex-col gap-3 text-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Webcam preview
              </h3>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showCam}
                  onChange={(e) => setShowCam(e.target.checked)}
                />
                <span>Show webcam preview while recording</span>
              </label>
              {showCam && cams.length > 0 ? (
                <select
                  className="bg-bg-base rounded px-2 py-1 text-sm"
                  value={selectedCamId ?? cams[0]?.deviceId ?? ''}
                  onChange={(e) => setSelectedCamId(e.target.value)}
                >
                  {cams.map((c) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <p className="text-xs text-ink-dim">
                Note: webcam shows in a preview window only — for true picture-in-picture
                composite, record screen first, then add the webcam clip in Video Studio.
              </p>
            </div>
            <div className="card p-4 flex flex-col gap-3 text-sm">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Output
              </h3>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={convertToMp4}
                  onChange={(e) => setConvertToMp4(e.target.checked)}
                />
                <span>
                  Convert to MP4 after recording (slower; better compatibility)
                </span>
              </label>
              <p className="text-xs text-ink-dim">
                Off = save as WebM (instant, but some apps don't accept WebM).
              </p>
            </div>
            <button
              className="btn-primary px-4 py-3 text-base disabled:opacity-50"
              disabled={!selectedSourceId}
              onClick={startRecording}
            >
              ● Start recording
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'recording' ? (
        <div className="flex flex-col gap-4">
          <video
            ref={previewRef}
            className="w-full max-h-[60vh] bg-black rounded"
            muted
            playsInline
          />
          {showCam ? (
            <video
              ref={camPreviewRef}
              className="absolute bottom-8 right-8 w-48 rounded shadow-xl border-2 border-accent"
              muted
              playsInline
            />
          ) : null}
        </div>
      ) : null}

      {phase === 'saving' ? (
        <div className="card p-6 text-center">
          <div className="text-2xl mb-2">💾</div>
          <p className="text-sm">Finishing up — converting and writing to disk…</p>
        </div>
      ) : null}

      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: '#16161e',
            color: '#e5e5ee',
            border: '1px solid rgba(149, 149, 165, 0.25)'
          }
        }}
      />
    </div>
  )
}
