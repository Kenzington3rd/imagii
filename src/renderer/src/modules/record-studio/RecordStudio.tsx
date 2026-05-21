import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { AppToaster } from '../../components/AppToaster'
import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'
import type { RecordingSource } from '@shared/workspace'
import { startCompositor, type CompositorHandle, type WebcamCorner } from './compositor'

type Phase = 'idle' | 'choosing' | 'recording' | 'saving'

const WEBCAM_CORNERS: WebcamCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const WEBCAM_CORNER_LABELS: Record<WebcamCorner, string> = {
  'top-left': 'Top-left',
  'top-right': 'Top-right',
  'bottom-left': 'Bottom-left',
  'bottom-right': 'Bottom-right'
}

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
  const [webcamCorner, setWebcamCorner] = useState<WebcamCorner>('bottom-right')
  const [elapsed, setElapsed] = useState(0)

  // M6 fix (round 15): surface webm→mp4 progress + give the user an abort button.
  const [savePercent, setSavePercent] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  // Raw screen capture stream from desktopCapturer. Tracked separately
  // from `streamRef` because in the webcam-composited path, `streamRef`
  // holds the compositor's canvas-captureStream output — NOT the original
  // screen tracks. Stopping streamRef alone would leave the desktop
  // capture pipeline running indefinitely (visible as the OS "screen is
  // being shared" indicator hanging around after recording stops).
  const screenStreamRef = useRef<MediaStream | null>(null)
  // Composited stream backing the MediaRecorder when the user opts into
  // webcam-in-recording. Owns its own canvas + offscreen video elements
  // and must be stopped to release them.
  const compositorRef = useRef<CompositorHandle | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const camPreviewRef = useRef<HTMLVideoElement>(null)
  const startTimeRef = useRef<number>(0)
  const elapsedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void refreshDevices()
    // Restore the user's preferred webcam corner across sessions.
    let cancelled = false
    void window.api.settings.get<WebcamCorner>('record.webcamCorner').then((stored) => {
      if (cancelled || !stored) return
      if (WEBCAM_CORNERS.includes(stored)) setWebcamCorner(stored)
    })
    return () => {
      cancelled = true
      stopAllStreams()
    }
  }, [])

  // M6 fix (round 15): wire the main-side conversion progress channel.
  useEffect(() => {
    const off = window.api.recording.onProgress((info) => {
      setSavePercent(info.percent)
    })
    return off
  }, [])

  // Persist the corner choice whenever it changes — survives restart.
  useEffect(() => {
    void window.api.settings.set('record.webcamCorner', webcamCorner)
  }, [webcamCorner])

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
    // Stop the RAW screen tracks. When the compositor path was used,
    // streamRef holds the canvas-captureStream output (not the screen
    // tracks themselves), so without this the desktop capture stays
    // open after recording stops.
    screenStreamRef.current?.getTracks().forEach((t) => t.stop())
    screenStreamRef.current = null
    // Tear down the composited canvas + offscreen videos if we ran them.
    compositorRef.current?.stop()
    compositorRef.current = null
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
      // Track the raw screen capture BEFORE we possibly hand it to the
      // compositor. stopAllStreams now releases this on every exit path,
      // including the failure paths where the compositor never started.
      screenStreamRef.current = screenStream

      let micStream: MediaStream | null = null
      if (includeMic) {
        const audioConstraint: MediaTrackConstraints = selectedMicId
          ? { deviceId: { exact: selectedMicId } }
          : {}
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
      }

      // If the user wants the webcam IN the recording (not just a preview),
      // grab the cam stream and run it through the compositor. The
      // compositor returns a synthetic MediaStream that contains a single
      // video track (screen + webcam corner drawn per frame) — we mix
      // mic audio into it for the recorder.
      let camStream: MediaStream | null = null
      let videoTrackSource: MediaStream = screenStream
      // Resolve the effective camera the same way the <select> displays
      // it: `selectedCamId` is null until the user actually opens the
      // dropdown, but the select shows cams[0] as its value. Without this
      // fallback, ticking "include webcam" and hitting record without
      // touching the dropdown silently recorded screen-only — the exact
      // UI-doesn't-match-output bug the webcam-preview fix set out to kill.
      const effectiveCamId = selectedCamId ?? cams[0]?.deviceId ?? null
      if (showCam && effectiveCamId) {
        try {
          camStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: effectiveCamId } }
          })
          camStreamRef.current = camStream
          const compositor = await startCompositor({
            screenStream,
            webcamStream: camStream,
            webcamCorner,
            webcamScalePct: 0.2,
            fps: 30
          })
          compositorRef.current = compositor
          videoTrackSource = compositor.outputStream
          if (camPreviewRef.current) {
            camPreviewRef.current.srcObject = camStream
            void camPreviewRef.current.play()
          }
        } catch (err) {
          toast.error(
            err instanceof Error
              ? `Webcam failed: ${err.message}. Recording screen only.`
              : 'Webcam failed; recording screen only.'
          )
          // Fall through with videoTrackSource still pointing at the raw screen
        }
      }

      const tracks = [
        ...videoTrackSource.getVideoTracks(),
        ...(micStream ? micStream.getAudioTracks() : [])
      ]
      const combined = new MediaStream(tracks)
      streamRef.current = combined

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
      // By the time MediaRecorder construction / start() runs, the screen,
      // cam, compositor, and combined streams may all be assigned. If this
      // throws (e.g. NotSupportedError), those streams + the compositor rAF
      // loop would leak until navigation. Release everything before the
      // toast — every startRecording exit path must end ownership.
      stopAllStreams()
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
    setSavePercent(0)
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
        toast('Recording discarded.', { icon: <Icon name="trash" size={18} /> })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setElapsed(0)
      setSavePercent(0)
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
          <HomeLink />
          <h1 className="text-2xl font-semibold mt-1">Record</h1>
          <p className="text-xs text-ink-muted mt-1">
            Capture a screen, window, or webcam — saved locally as MP4 (or WebM).
          </p>
        </div>
        {phase === 'recording' ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-rose-300 inline-flex items-center gap-1.5">
              <Icon name="record" size={15} /> REC {formatElapsed(elapsed)}
            </span>
            <button className="btn-primary px-4 py-2" onClick={stopRecording}>
              Stop
            </button>
          </div>
        ) : null}
      </header>

      {phase === 'idle' || phase === 'choosing' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_clamp(320px,20%,520px)] gap-5">
          <div className="card p-4 flex flex-col gap-3">
            <PanelHeader
              icon="video"
              actions={
                <button className="btn-ghost px-3 py-1 text-xs" onClick={chooseSource}>
                  Refresh sources
                </button>
              }
            >
              What to record
            </PanelHeader>
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
              <PanelHeader icon="microphone">Audio</PanelHeader>
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
              <PanelHeader icon="record">Webcam</PanelHeader>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showCam}
                  onChange={(e) => setShowCam(e.target.checked)}
                />
                <span>Include webcam in recording (picture-in-picture)</span>
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
              {showCam ? (
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-ink-muted w-16">Corner</span>
                  <select
                    className="bg-bg-base rounded px-2 py-1 text-sm flex-1"
                    value={webcamCorner}
                    onChange={(e) => setWebcamCorner(e.target.value as WebcamCorner)}
                  >
                    {WEBCAM_CORNERS.map((c) => (
                      <option key={c} value={c}>
                        {WEBCAM_CORNER_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="text-xs text-ink-dim">
                Webcam is composited into the recording at the chosen corner. The
                preview overlay in the recording view shows the cam alongside the
                screen for monitoring.
              </p>
            </div>
            <div className="card p-4 flex flex-col gap-3 text-sm">
              <PanelHeader icon="folder">Output</PanelHeader>
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
              className="btn-primary px-4 py-3 text-base disabled:opacity-50 inline-flex items-center justify-center gap-2"
              disabled={!selectedSourceId}
              onClick={startRecording}
            >
              <Icon name="record" size={18} /> Start recording
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'recording' ? (
        // B11 fix (round 16): the cam preview is `absolute`, but without a
        // positioned ancestor it climbed to the page root, which on a tall
        // window made the thumbnail drift far below the main preview. Mark
        // this wrapper `relative` so the cam thumbnail anchors inside it.
        <div className="relative flex flex-col gap-4">
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
        <div className="card p-6 text-center flex flex-col items-center gap-3">
          <div className="text-accent">
            <Icon name="save" size={28} />
          </div>
          <p className="text-sm">Finishing up — converting and writing to disk…</p>
          {/* M6 fix (round 15): show coarse progress + give the user a way
              to abort if they realize they don't want to wait. */}
          <div className="w-64 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.max(2, Math.round(savePercent))}%` }}
            />
          </div>
          <button
            className="btn-ghost px-3 py-1.5 text-sm"
            onClick={() => {
              void window.api.recording.cancelSave()
            }}
          >
            Discard recording
          </button>
        </div>
      ) : null}

      <AppToaster />
    </div>
  )
}
