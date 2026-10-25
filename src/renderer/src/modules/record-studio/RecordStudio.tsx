import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { HomeLink } from '../../components/HomeLink'
import { Icon } from '../../components/Icon'
import { isModalOpen } from '../../components/Modal'
import { PanelHeader } from '../../components/PanelHeader'
import { useRecentFiles } from '../../hooks/useRecentFiles'
import { useEditInVideoStudio } from '../../lib/editInVideoStudio'
import type { RecordingSource } from '@shared/workspace'
import { isCancelledError } from '@shared/cancel'
import { formatTimer } from '@shared/clockTime'
import { localStamp } from '@shared/filename'
import { ERROR_TOAST_MS, userFacingError } from '@shared/userFacingError'
import { mayLeaveLiveTake, registerLiveTake } from '../../lib/liveTake'
import { persistSetting } from '../../lib/persistSetting'
import { reportFailure } from '../../lib/reportFailure'
import { toastSaved } from '../../lib/savedToast'
import { startCompositor, type CompositorHandle, type WebcamCorner } from './compositor'
import { noDeviceHint, reconcileDeviceId, scanDevices, type DeviceOption } from './devices'
import { micLostLine, saveCard, SAVE_RUNNING_MESSAGE } from './saveCard'
import { useRecordSave } from './saveRun'

type Phase = 'idle' | 'recording' | 'saving'

/**
 * T-120: what the recorder is asked to encode at (see `startRecording`). The temp take and the saved file are
 * each about 1 MB a second at this rate, and the Output card's hint says so.
 */
const RECORDING_VIDEO_BITS_PER_SECOND = 8_000_000

/**
 * T-41: what the source list knows about itself. There used to be a
 * 'choosing' phase that rendered exactly like 'idle', so a search that came
 * back with nothing was indistinguishable from a search that never ran — on
 * a Wayland session without a portal, or a macOS box with screen recording
 * denied, the button simply looked dead. These three states each render
 * differently: the invitation, the wait, and the answer.
 */
type SourceSearch = 'never' | 'searching' | 'done'

const WEBCAM_CORNERS: WebcamCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const WEBCAM_CORNER_LABELS: Record<WebcamCorner, string> = {
  'top-left': 'Top-left',
  'top-right': 'Top-right',
  'bottom-left': 'Bottom-left',
  'bottom-right': 'Bottom-right'
}

export function RecordStudio(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [sources, setSources] = useState<RecordingSource[]>([])
  const [sourceSearch, setSourceSearch] = useState<SourceSearch>('never')
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [includeMic, setIncludeMic] = useState(true)
  const [convertToMp4, setConvertToMp4] = useState(true)
  const [mics, setMics] = useState<DeviceOption[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null)
  const [cams, setCams] = useState<DeviceOption[]>([])
  const [selectedCamId, setSelectedCamId] = useState<string | null>(null)
  const [showCam, setShowCam] = useState(false)
  const [webcamCorner, setWebcamCorner] = useState<WebcamCorner>('bottom-right')
  const [elapsed, setElapsed] = useState(0)
  // T-126 (2): how far into the take the microphone stopped (null: it did not). The ref is what `finalizeRecording` reads for the
  // saved toast (its closure is the render the recorder was made in); the state is what the REC header and the saving card draw.
  const [micLostAt, setMicLostAt] = useState<number | null>(null)
  const micLostAtRef = useRef<number | null>(null)
  // T-119: Start has been pressed and the take is not rolling yet - the capture and the
  // main-process session are still being opened. `phase` only changes at the very end of
  // that, so without this a second press during the wait began a second capture over the
  // first one's refs and orphaned it (and its growing temp webm). The ref is the guard
  // (set the instant the function runs, before any render); the state is what the button
  // shows.
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)
  // T-121: a camera is IN the take - the compositor exists. The thumbnail is drawn from this and not from the
  // checkbox: checking "Include webcam" and having the camera fail left an empty accent-bordered box over the
  // screen preview for the whole take. Set where the compositor ref is, cleared where it is let go.
  const [camInTake, setCamInTake] = useState(false)
  // T-120: this component is gone. `startRecording` awaits the capture, the mic, the camera and the
  // main-process session one after another, and the unmount cleanup runs before any of them lands, so a
  // person who left during "Starting…" left a live capture (and a growing temp webm) nobody owned. Every
  // await in `startRecording` is followed by `leftWhileStarting()`.
  const unmountedRef = useRef(false)

  // M6 fix (round 15): surface webm→mp4 progress + give the user an abort button.
  // T-137 (2): the save - its percent, whether Discard has been pressed, which take it is - is a run in a module store (`saveRun.ts`), not this
  // component's state: leaving Record during it returned an IDLE screen over a convert main was still running, and a second take's Discard then
  // cancelled the first take's convert too and threw its raw webm away. A Record that mounts over a run shows the saving card (the bar, the
  // Discard) and offers no Start; `phase === 'saving'` is only the instant between the Stop click and the run beginning.
  // T-115: a null percent is "working, no measurement" (the convert had no length): an indeterminate
  // bar, like the captions panel's. 0 is a measurement - nothing converted yet.
  const saveRun = useRecordSave((s) => s.run)
  const saving = phase === 'saving' || (phase === 'idle' && saveRun !== null)
  const savePercent = saveRun === null ? 0 : saveRun.percent
  const discarding = saveRun?.discarding ?? false

  // Round 18 D: record → clip handoff. The saved file is pushed into the
  // shared recentFiles.video bucket (same one Video Studio's Importer
  // reads) and "Edit in Video Studio" mirrors VideoStudio.cleanAudioFlow:
  // load into the studio's store, then navigate.
  // The saved take's "Edit in Video Studio" (T-123 (18): shared with Reframe's saved file).
  const editInVideoStudio = useEditInVideoStudio("Couldn't open the recording in Video Studio.")
  const { push: pushRecentVideo } = useRecentFiles('video')

  const recorderRef = useRef<MediaRecorder | null>(null)
  // Round 18 A: streaming save. `sessionIdRef` names the main-process
  // write-stream session; `appendQueueRef` is a strict promise chain that
  // serializes appendChunk sends so bytes land in capture order;
  // `streamErrorRef` latches the first append failure so we stop early
  // and abandon instead of recording minutes of data going nowhere.
  const sessionIdRef = useRef<string | null>(null)
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve())
  const streamErrorRef = useRef<Error | null>(null)
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
  // T-124 (1): takes the `ended` listeners off the screen's video tracks (see `watchScreenEnd`); let go with the streams.
  const screenEndOffRef = useRef<(() => void) | null>(null)
  // T-125 (25): the same for the microphone's audio track (see `watchMicEnd`).
  const micEndOffRef = useRef<(() => void) | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const camPreviewRef = useRef<HTMLVideoElement>(null)
  const startTimeRef = useRef<number>(0)
  const deviceScanRef = useRef(0)
  const elapsedTimerRef = useRef<number | null>(null)

  // T-43: restore the Record preferences, and READ ONLY. Each control writes
  // its own choice in its onChange (below), so arriving on /record — or
  // bouncing through it on the way somewhere else — never touches
  // config.json. The old persist effect fired on mount and stamped the
  // default corner over an absent key, which made navigation alone a
  // settings write.
  useEffect(() => {
    // Set again on every mount: StrictMode runs this effect's cleanup and then the effect again in dev, and a
    // flag left true from that simulated unmount would make every Start bail.
    unmountedRef.current = false
    void refreshDevices()
    let cancelled = false
    void window.api.settings.get<WebcamCorner>('record.webcamCorner').then((stored) => {
      if (cancelled || !stored) return
      if (WEBCAM_CORNERS.includes(stored)) setWebcamCorner(stored)
    })
    void window.api.settings.get<boolean>('record.convertToMp4').then((stored) => {
      if (cancelled || typeof stored !== 'boolean') return
      setConvertToMp4(stored)
    })
    return () => {
      cancelled = true
      unmountedRef.current = true
      stopAllStreams()
    }
  }, [])

  // Round 18 C: the `?` HotkeyOverlay has documented "Esc: Stop recording"
  // for /record since round 15 but nothing ever wired it. Listener exists
  // only while recording and is removed on phase change and unmount.
  //
  // T-72: and the same table advertises `?` on this route, which opens the
  // HotkeyOverlay — a Modal, reachable mid-take. Escape then reached BOTH
  // handlers: the overlay closed and the recording ended, so checking the
  // shortcut list cost the user their take. Escape belongs to the topmost
  // claim on the window, and a Modal is exactly that claim (T-68).
  useEffect(() => {
    if (phase !== 'recording') return
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      if (isModalOpen()) return
      e.preventDefault()
      stopRecording()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  // T-133 (1): while a take is being recorded, every way off this screen asks about it first (`mayLeaveLiveTake`): the Home link below, and the
  // toasts' "Open Audio Studio" / "Edit in Video Studio" buttons, which outlive the screen that raised them. The registration is the live take;
  // it ends with the phase and with the screen.
  useEffect(() => {
    if (phase !== 'recording') return
    return registerLiveTake(stopRecording)
  }, [phase])

  // T-120: the live preview. `startRecording` used to hand each stream to its <video> while `phase` was still
  // 'idle', and both elements render only at phase === 'recording', so the refs were null at that moment:
  // the recording view was a black box and the webcam thumbnail an empty border. The attach belongs to the
  // render that has the elements, so it is an effect on the phase, and it lets go of the streams on the way
  // out (the elements go away with the phase, and an element holding a stopped stream is a frozen frame).
  // The camera thumbnail only shows a camera that is IN the take: the compositor exists exactly when it is, and
  // the element itself is rendered only then (`camInTake`, T-121), so a failed camera leaves no empty box.
  useEffect(() => {
    if (phase !== 'recording') return
    const main = previewRef.current
    const cam = camPreviewRef.current
    if (main && streamRef.current) {
      main.srcObject = streamRef.current
      main.play().catch(() => undefined)
    }
    if (cam && camStreamRef.current && compositorRef.current) {
      cam.srcObject = camStreamRef.current
      cam.play().catch(() => undefined)
    }
    return () => {
      if (main) main.srcObject = null
      if (cam) cam.srcObject = null
    }
  }, [phase])

  /**
   * T-88: re-scan the microphones and cameras. Runs on mount AND whenever the
   * user clicks "Refresh sources" — the hint under an empty device list sends
   * them there, and the button used to re-list only screens and windows.
   * `scanDevices` probes the two kinds separately, so a machine with no
   * webcam still gets its microphone; the selections are reconciled against
   * the new lists the way T-69 reconciles the screen pick.
   */
  async function refreshDevices(): Promise<void> {
    // Two clicks in a row start two scans; only the newest may write, or a
    // slow older scan could put a stale list back over a fresh one.
    const mine = ++deviceScanRef.current
    const next = await scanDevices(navigator.mediaDevices)
    if (mine !== deviceScanRef.current) return
    setMics(next.mics)
    setCams(next.cams)
    setSelectedMicId((current) => reconcileDeviceId(current, next.mics))
    setSelectedCamId((current) => reconcileDeviceId(current, next.cams))
  }

  /** Everything "Refresh sources" re-checks: the screens and windows, and the devices. */
  function refreshAll(): void {
    void chooseSource()
    void refreshDevices()
  }

  /**
   * T-69: point the selection at something that is actually in `list`.
   *
   * A refresh is how a user says "the windows have changed" — they closed the
   * game, they opened OBS. `selectedSourceId` used to survive that
   * unconditionally, so a refresh into nothing left Start recording enabled
   * over the "No screens or windows found" card, aimed at a source id that no
   * longer existed; the refusal arrived much later, from getUserMedia, in the
   * app's least specific words. Keeping a still-listed choice is the same
   * rule as auto-selecting the first one — the selection always names a
   * source the user can see.
   */
  function reconcileSelection(list: RecordingSource[]): void {
    setSelectedSourceId((current) =>
      current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? null)
    )
  }

  async function chooseSource(): Promise<void> {
    setSourceSearch('searching')
    try {
      const list = await window.api.recording.listSources()
      setSources(list)
      reconcileSelection(list)
    } catch (err) {
      // A refused capture permission comes back as a rejected IPC call, not
      // an empty list. Say what happened rather than leaving the wait on
      // screen forever — the empty state below then offers the retry.
      // T-117: in the studio's sentence (plus the plain cause where the shape is known). The
      // envelope-stripped string used to be toasted as main wrote it: an errno, a path.
      setSources([])
      reconcileSelection([])
      reportFailure(err, { failed: "Couldn't list what can be recorded." })
    } finally {
      setSourceSearch('done')
    }
  }

  function stopAllStreams(): void {
    screenEndOffRef.current?.()
    screenEndOffRef.current = null
    micEndOffRef.current?.()
    micEndOffRef.current = null
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
    setCamInTake(false)
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }

  /**
   * T-120: let go of everything a start has opened so far - every stream and the compositor, and the
   * main-process session if `begin` has already answered (its empty temp webm goes with it; abandon is
   * idempotent). A start that fails and a start whose studio was left both end here.
   */
  function abandonStart(): void {
    stopAllStreams()
    const sid = sessionIdRef.current
    if (sid) {
      sessionIdRef.current = null
      void window.api.recording.abandon(sid).catch(() => undefined)
    }
  }

  /**
   * T-120: asked after each await in `startRecording`. True means the person left Record while that await was
   * pending: whatever it just returned is released (`extra`: a stream the refs do not hold yet) and the start
   * ends, with no toast for a screen nobody is looking at.
   */
  function leftWhileStarting(...extra: Array<MediaStream | null>): boolean {
    if (!unmountedRef.current) return false
    for (const stream of extra) stream?.getTracks().forEach((t) => t.stop())
    abandonStart()
    return true
  }

  async function startRecording(): Promise<void> {
    if (startingRef.current) return
    // T-137 (2): a take is still being saved (this screen was left during it and came back). The idle controls are not drawn over a save, so this is
    // the backstop, not the way a person meets the rule; a second take over a running save is what let a Discard reach the first take's convert.
    if (useRecordSave.getState().run !== null) {
      toast(SAVE_RUNNING_MESSAGE, { id: 'record-save-busy', icon: <Icon name="warning" size={18} /> })
      return
    }
    if (!selectedSourceId) {
      toast.error('Pick a screen / window first')
      return
    }
    startingRef.current = true
    setStarting(true)
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
      if (leftWhileStarting()) return

      let micStream: MediaStream | null = null
      if (includeMic) {
        const audioConstraint: MediaTrackConstraints = selectedMicId
          ? { deviceId: { exact: selectedMicId } }
          : {}
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
        if (leftWhileStarting(micStream)) return
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
      if (showCam) {
        try {
          // T-42: zero cameras used to fall out of this branch entirely —
          // `showCam && effectiveCamId` was false, so the compositor was
          // skipped and the take came out screen-only with no message at
          // all. Raise it through the SAME failure path a dead camera takes,
          // so a ticked box that cannot be honoured always says so.
          if (!effectiveCamId) throw new Error('No camera found.')
          camStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: effectiveCamId } }
          })
          camStreamRef.current = camStream
          if (leftWhileStarting(micStream)) return
          const compositor = await startCompositor({
            screenStream,
            webcamStream: camStream,
            webcamCorner,
            webcamScalePct: 0.2,
            fps: 30
          })
          compositorRef.current = compositor
          if (leftWhileStarting(micStream)) return
          setCamInTake(true)
          videoTrackSource = compositor.outputStream
        } catch (err) {
          // T-121: the studio was left while the camera or the compositor was opening - the same teardown the
          // awaits above have, and no toast for a screen nobody is looking at (the start used to carry on from
          // here and open a take for it).
          if (leftWhileStarting(micStream)) return
          // T-121: the take continues WITHOUT the camera, so the camera is let go now. getUserMedia had
          // succeeded (only the compositor failed): its tracks stayed live for the whole take, the camera's
          // light on during a screen-only recording. Nothing else holds the stream (the compositor tore down
          // its own elements), and nothing is left to show a thumbnail of.
          camStream?.getTracks().forEach((t) => t.stop())
          camStreamRef.current = null
          // T-84: the cause in plain words (the zero-camera case is our own
          // sentence above), then what the take will be instead — so the
          // ticked box and the file still agree (T-42).
          const { message } = userFacingError(err, 'Webcam failed.')
          toast.error(`${message} Recording screen only.`, { duration: ERROR_TOAST_MS })
          // Fall through with videoTrackSource still pointing at the raw screen
        }
      }

      const tracks = [
        ...videoTrackSource.getVideoTracks(),
        ...(micStream ? micStream.getAudioTracks() : [])
      ]
      const combined = new MediaStream(tracks)
      streamRef.current = combined

      const mimePref = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      const mime = mimePref.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
      // T-120: say the bitrate. Without `videoBitsPerSecond` Chromium encodes at about 2.5 Mbps, which is soft
      // for 1080p gameplay before a platform re-encodes it. 8 Mbps is this recording's OWN ceiling (T-132 (8): it was
      // once "the top export preset's rate", and the 1080p60 preset's 12M is the top now), a CEILING and not what a take
      // is written at: the encoder spends what the picture needs (2.56 Mbps measured on a flat synthetic canvas). The
      // cost is disk, at most about 1 MB a second, 3.6 GB an hour, in the temp take AND the saved copy.
      const recorder = new MediaRecorder(combined, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND
      })

      // Round 18 A: open the main-process streaming session BEFORE the
      // recorder starts so the first chunk always has somewhere to go.
      // Chunks used to pile up in renderer memory (chunksRef) and cross
      // the IPC bridge as one recording-sized ArrayBuffer at stop time —
      // an OOM/freeze risk on long recordings. Now each ~1 s timeslice
      // chunk is appended to a temp .webm as it arrives.
      const { id: sessionId } = await window.api.recording.begin()
      sessionIdRef.current = sessionId
      if (leftWhileStarting(micStream)) return
      appendQueueRef.current = Promise.resolve()
      streamErrorRef.current = null

      recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return
        if (streamErrorRef.current) return
        // Strict promise chain: each link converts its blob and awaits its
        // appendChunk only after the previous link settled, so append order
        // (and therefore byte order in the temp file) matches capture order.
        appendQueueRef.current = appendQueueRef.current
          .then(async () => {
            if (streamErrorRef.current) return
            const buf = await e.data.arrayBuffer()
            await window.api.recording.appendChunk(sessionId, buf)
          })
          .catch((err) => {
            if (streamErrorRef.current) return
            streamErrorRef.current =
              err instanceof Error ? err : new Error(String(err))
            // Stop immediately rather than let the user record minutes of
            // data going nowhere. onstop → finalizeRecording sees the
            // latched error, abandons the session, and shows the toast.
            stopRecording()
          })
      }
      recorder.onstop = () => {
        void finalizeRecording()
      }
      recorder.start(1000)
      recorderRef.current = recorder
      startTimeRef.current = Date.now()
      micLostAtRef.current = null
      setMicLostAt(null)
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current)
      }, 200)
      setPhase('recording')
      watchScreenEnd(screenStream)
      if (micStream) watchMicEnd(micStream)
    } catch (err) {
      // By the time MediaRecorder construction / start() runs, the screen,
      // cam, compositor, and combined streams may all be assigned. If this
      // throws (e.g. NotSupportedError), those streams + the compositor rAF
      // loop would leak until navigation. Release everything before the
      // toast — every startRecording exit path must end ownership.
      // Round 18 A: if begin() succeeded but start() then threw, reap the
      // just-opened session's empty temp file. abandon is idempotent.
      abandonStart()
      reportFailure(err, { failed: "Couldn't start recording." })
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }

  /**
   * T-124 (1): the take ends when the SCREEN does. MediaRecorder stops by itself only when every track of the stream it
   * records has ended, and `combined` also holds the microphone's audio track (on by default), so a game that crashed or a
   * captured window that closed ended the picture, left the sound live, and REC went on counting over a frozen frame.
   * The listener goes on the raw capture's video tracks and not on what the recorder is handed: with the webcam in the
   * take that is the compositor's canvas capture, which never ends. A track that ended during the awaits of the start
   * (the listener was not there to hear it) ends the take at once. Called after the phase is 'recording', so the
   * 'saving' phase `stopRecording` sets is the last word.
   */
  function watchScreenEnd(screenStream: MediaStream): void {
    const tracks = screenStream.getVideoTracks()
    tracks.forEach((t) => t.addEventListener('ended', stopRecording))
    screenEndOffRef.current = () => tracks.forEach((t) => t.removeEventListener('ended', stopRecording))
    if (tracks.some((t) => t.readyState === 'ended')) stopRecording()
  }

  /**
   * T-125 (25): a microphone that goes away mid-take (a USB headset pulled, a Bluetooth one out of range, the device disabled)
   * ends its audio track and nothing else: the screen keeps recording, REC keeps counting, and the rest of the take is silent
   * with no word of it until the person plays the file back. The take is NOT ended (the picture is worth keeping, and the
   * screen's own end is what `watchScreenEnd` is for): the person is told, once, so they can stop and start again if the voice
   * matters. A track that had already ended during the awaits of the start is told at once. `stop()` from `stopAllStreams` does
   * not fire `ended`, and the listener is taken off there anyway, so a normal Stop says nothing.
   * T-126 (2): the toast is told once and gone in 8 s, so the loss is also RECORDED - how far into the take it stopped - and the
   * REC header, the saving card and the saved toast say it (`micLostLine`) until the file is done.
   */
  function watchMicEnd(micStream: MediaStream): void {
    const tracks = micStream.getAudioTracks()
    let told = false
    const warn = (): void => {
      if (told) return
      told = true
      const at = Math.max(0, Date.now() - startTimeRef.current)
      micLostAtRef.current = at
      setMicLostAt(at)
      toast.error('The microphone stopped. The rest of this recording has no sound from it.', { duration: ERROR_TOAST_MS })
    }
    tracks.forEach((t) => t.addEventListener('ended', warn))
    micEndOffRef.current = () => tracks.forEach((t) => t.removeEventListener('ended', warn))
    if (tracks.some((t) => t.readyState === 'ended')) warn()
  }

  function stopRecording(): void {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'inactive') return
    recorder.stop()
    setPhase('saving')
  }

  async function finalizeRecording(): Promise<void> {
    // T-123 (5): the save begins HERE, whoever stopped the take. Only the Stop button set the phase, so a take that ended
    // by itself (the captured window closed and every track ended, `onstop` runs this) saved under a live "REC" screen
    // with a Stop that did nothing and no Discard. The same call in `stopRecording` is the instant answer to a click;
    // setting a state to the value it already has is nothing.
    setPhase('saving')
    const sessionId = sessionIdRef.current
    const durationMs = Date.now() - startTimeRef.current
    const lostLine = micLostLine(micLostAtRef.current)
    stopAllStreams()
    // T-137 (2): the save is a run in the module store from here until the take is dealt with (saved, discarded or failed), claimed before the
    // first await and given back in the `finally`. `claimed` is false only with no session to save (the failure below says so) or if a run is
    // somehow already there - which Start's refusal prevents - and then this save leaves the other run alone. The progress listener lasts exactly
    // the save (it was an effect of the screen, and lost every event that arrived while the screen was gone).
    const claimed =
      sessionId !== null &&
      useRecordSave.getState().begin({ takeId: sessionId, convertToMp4, percent: 0, discarding: false, micLostAt: micLostAtRef.current })
    const offProgress = window.api.recording.onProgress((info) => {
      useRecordSave.getState().patch({ percent: info.percent ?? null })
    })
    try {
      // All chunks were queued by ondataavailable before onstop fired, so
      // awaiting the queue's tail awaits every pending appendChunk. Each
      // link routes its own failure into streamErrorRef (never rethrows),
      // so this await cannot itself reject.
      await appendQueueRef.current
      if (streamErrorRef.current) throw streamErrorRef.current
      if (!sessionId) throw new Error('Recording session was never started')
      const result = await window.api.recording.finalize(sessionId, {
        // T-117: the machine's clock, like the export panel's {date} and {time} - the UTC ISO
        // string named an evening Pacific take for tomorrow.
        filename: `recording-${localStamp()}.${convertToMp4 ? 'mp4' : 'webm'}`,
        durationMs,
        convertToMp4
      })
      // finalize reaped the session (success or not) — never abandon it too.
      sessionIdRef.current = null
      if (result) {
        // Round 18 D: recordings join the same recent-videos bucket the
        // Video Studio Importer reads, closing the record → clip loop.
        void pushRecentVideo(result.outputPath)
        // T-92: "Show in folder" and "Edit in Video Studio" are the only ways
        // on from here, so this toast stays up long enough to use them.
        // T-126 (2): a take that lost its microphone says so here too, as a second sentence (two keep both periods).
        const saved = `Saved ${(result.sizeBytes / 1e6).toFixed(1)} MB`
        toastSaved(lostLine ? `${saved}. ${lostLine}.` : saved, result.outputPath, {
          label: 'Edit in Video Studio',
          onClick: () => {
            void editInVideoStudio(result.outputPath)
          }
        })
      } else {
        announceDiscarded()
      }
    } catch (err) {
      if (isCancelledError(err)) {
        // T-88: a take the user threw away is not a failed save. Main answers
        // a discard with null (above); the shared sentinel is the same fact in
        // rejection form, so it gets the same calm line instead of a red toast
        // reading "imagii:cancelled".
        announceDiscarded()
      } else {
        // T-59: main names the convert crash in the studio's own words (a finished sentence
        // `userFacingError` lets stand). T-117: every OTHER cause used to reach the toast raw, the
        // envelope stripped and nothing more - a copyfile EPERM with both full paths, an ENOSPC from
        // the write stream mid-take, "recording:finalize recording is empty". They go through the
        // same helper as every other failure: this sentence, plus the plain cause where the shape is
        // known (disk full, a file Windows would not let us touch), shown for 8 s (T-115).
        // Which branch says what: only the convert sentence tells the person the take is gone
        // ("Nothing was saved"). With Convert off, the failure is the copy to the chosen place (the
        // WebM save is a remux that falls back to a plain copy, T-120), and
        // its ENOSPC / EPERM causes advise "free up some space and try again" / "close any app using
        // it" - but `promoteTempWebm`'s `finally` has already unlinked the temp webm on that branch
        // too, so there is nothing left to retry. That advice is wrong for the take, and it is a
        // product call, not a wording one: T-110(u) (keep the webm when the save fails, then revisit
        // the retry wording with it).
        reportFailure(err, { failed: 'Saving the recording failed.' })
      }
      // Failure path: reap the partial temp file. Reached when an append
      // failed mid-recording or finalize itself threw; in the latter case
      // main already deleted the session and abandon is a false no-op.
      if (sessionId) {
        sessionIdRef.current = null
        void window.api.recording.abandon(sessionId).catch(() => undefined)
      }
    } finally {
      offProgress()
      if (claimed) useRecordSave.getState().end()
      setElapsed(0)
      micLostAtRef.current = null
      setMicLostAt(null)
      setPhase('idle')
    }
  }

  function announceDiscarded(): void {
    toast('Recording discarded', { icon: <Icon name="trash" size={18} /> })
  }

  /**
   * T-88: "Discard recording" kills the running convert (the one thing in the
   * save that can be stopped); the convert's cancel comes back from main as a
   * discard, which `finalizeRecording` announces. If there was nothing to
   * kill — the click landed before the convert started or after it finished —
   * the button comes back instead of sitting on "Discarding…" forever.
   * T-137 (2): and it is aimed at ONE take, the run's (`takeId`): main cancels that take's convert and no other's, so a Discard here can never
   * reach another take's save. Pressed in the instant before the run begins (the Stop click, the recorder's last chunk) there is no take to name
   * yet and nothing to stop.
   */
  function discardRecording(): void {
    const takeId = useRecordSave.getState().run?.takeId
    if (takeId === undefined) return
    useRecordSave.getState().patch({ discarding: true })
    window.api.recording
      .cancelSave(takeId)
      .then((hadConvert) => {
        if (!hadConvert) useRecordSave.getState().patch({ discarding: false })
      })
      .catch((err) => {
        useRecordSave.getState().patch({ discarding: false })
        reportFailure(err, { failed: "Couldn't discard the recording." })
      })
  }

  // The card draws the SAVE's own facts when a run exists (a Record that mounted over it has neither the checkbox's value nor the take's mic line).
  const save = saveCard(saveRun === null ? convertToMp4 : saveRun.convertToMp4, discarding)
  const micLine = micLostLine(saveRun === null ? micLostAt : saveRun.micLostAt)

  return (
    <div className="h-full overflow-auto px-8 py-6 flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div>
          {/* Round 18 B: leaving mid-recording used to silently kill the
              media tracks (unmount → stopAllStreams) and lose the take.
              Capture-phase intercept swallows the router Link's click
              before it can navigate; confirming stops the recorder and
              runs the NORMAL save flow (dialog + convert) right here, so
              the take is kept — the user can leave once it's saved.
              Wrapping locally keeps the shared HomeLink untouched for the
              other studios. */}
          <span
            onClickCapture={(e) => {
              // T-133 (1): the question is shared (`lib/liveTake`) with every other way off this screen - a toast's button outlives the
              // screen that raised it - so it is asked by the registration below, not by this link's own copy.
              if (mayLeaveLiveTake()) return
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <HomeLink />
          </span>
          <h1 className="text-2xl font-semibold mt-1">Record</h1>
          <p className="text-xs text-ink-muted mt-1">
            Capture a screen or window, with optional webcam and mic — saved locally as MP4 (or WebM).
          </p>
        </div>
        {phase === 'recording' ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-3">
              <span className="font-mono text-danger inline-flex items-center gap-1.5">
                <Icon name="record" size={15} /> REC {formatTimer(elapsed / 1000)}
              </span>
              <button className="btn-primary px-4 py-2" onClick={stopRecording}>
                Stop
              </button>
            </div>
            {/* T-126 (2): the record of a microphone that went away - the toast that said so is gone in 8 s. */}
            {micLine ? <p className="text-xs text-danger">{micLine}</p> : null}
          </div>
        ) : null}
      </header>

      {phase === 'idle' && !saving ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_clamp(320px,20%,520px)] gap-5">
          <div className="card p-4 flex flex-col gap-3">
            <PanelHeader
              icon="video"
              actions={
                <button
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={refreshAll}
                  title="Re-list screens and windows, and re-check your microphone and camera"
                >
                  Refresh sources
                </button>
              }
            >
              What to record
            </PanelHeader>
            {sources.length === 0 ? (
              // T-41: three states, three renders. Before a search there is
              // only the invitation; during one the wait says so and the
              // button cannot be clicked twice; after one that found nothing
              // the card says what happened and what to try, in the Audio
              // card's own words (see the mic/camera warnings above).
              <div className="bg-bg-hover rounded p-6 text-center text-sm text-ink-muted flex flex-col items-center gap-3">
                {sourceSearch === 'searching' ? (
                  <p className="text-xs">Looking for screens and windows…</p>
                ) : null}
                {sourceSearch === 'done' ? (
                  <p className="text-xs text-warn">
                    No screens or windows found. Click "Refresh sources" after granting
                    screen-recording permission.
                  </p>
                ) : null}
                <button
                  className="btn-primary px-4 py-2 disabled:opacity-50"
                  onClick={chooseSource}
                  disabled={sourceSearch === 'searching'}
                >
                  Pick a screen or window
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSourceId(s.id)}
                    // T-114: one of a set, and it shows which by a border and a ring - which a
                    // screen reader cannot see.
                    aria-pressed={selectedSourceId === s.id}
                    className={`text-left card p-2 transition-colors ${
                      selectedSourceId === s.id ? 'border-accent ring-2 ring-accent/50' : ''
                    }`}
                  >
                    <img
                      src={s.thumbnailDataUrl}
                      alt={s.name}
                      className="w-full rounded mb-2"
                    />
                    <div className="text-xs font-medium truncate" title={s.name}>{s.name}</div>
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
                  aria-label="Microphone"
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
                <p className="text-xs text-warn">{noDeviceHint('microphone')}</p>
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
                  aria-label="Webcam"
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
              {/* T-42: mirrors the Audio card's zero-device branch exactly —
                  same wording, same amber, same place the <select> would
                  have been. Without it a user with no camera ticked the box,
                  watched a Corner picker appear, and got a screen-only
                  recording that never mentioned the webcam. */}
              {showCam && cams.length === 0 ? (
                <p className="text-xs text-warn">{noDeviceHint('camera')}</p>
              ) : null}
              {/* The corner only means something once there is a camera to
                  put in it, so it is gated the same way the device select
                  is — the mic card shows a warning OR a control, never a
                  control for a device that is not there. */}
              {showCam && cams.length > 0 ? (
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-ink-muted w-16">Corner</span>
                  <select
                    className="bg-bg-base rounded px-2 py-1 text-sm flex-1"
                    value={webcamCorner}
                    onChange={(e) => {
                      const corner = e.target.value as WebcamCorner
                      setWebcamCorner(corner)
                      void persistSetting('record.webcamCorner', corner)
                    }}
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
                  onChange={(e) => {
                    const on = e.target.checked
                    setConvertToMp4(on)
                    void persistSetting('record.convertToMp4', on)
                  }}
                />
                <span>
                  Convert to MP4 after recording (slower; better compatibility)
                </span>
              </label>
              <p className="text-xs text-ink-dim">
                Off = save as WebM (quick, but some apps don't accept WebM). A take can use about
                3.6 GB of disk per hour, and saving needs room for a second copy of it.
              </p>
            </div>
            <button
              className="btn-primary px-4 py-3 text-base disabled:opacity-50 inline-flex items-center justify-center gap-2"
              disabled={!selectedSourceId || starting}
              onClick={startRecording}
            >
              <Icon name="record" size={18} /> {starting ? 'Starting…' : 'Start recording'}
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
          {camInTake ? (
            <video
              ref={camPreviewRef}
              className="absolute bottom-8 right-8 w-48 rounded shadow-xl border-2 border-accent"
              muted
              playsInline
            />
          ) : null}
        </div>
      ) : null}

      {saving ? (
        <div className="card p-6 text-center flex flex-col items-center gap-3">
          <div className="text-accent">
            <Icon name="save" size={28} />
          </div>
          <p className="text-sm">{save.status}</p>
          {micLine ? <p className="text-xs text-danger">{micLine}</p> : null}
          {/* M6 fix (round 15): progress for the convert. T-88: only
              the convert reports progress, so only the convert gets a bar —
              a WebM save used to sit on this bar's 2% floor. T-115: the number
              is the encode position over the take's length; a convert with no
              length reports none and the bar slides (no aria-valuenow). */}
          {save.showProgress ? (
            <div
              className="w-64 h-1.5 bg-bg-hover rounded-full overflow-hidden"
              role="progressbar"
              aria-label="Converting the recording to MP4"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={savePercent === null ? undefined : Math.round(savePercent)}
            >
              {savePercent === null ? (
                <div className="h-full bg-accent progress-indeterminate" />
              ) : (
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.max(2, Math.round(savePercent))}%` }}
                />
              )}
            </div>
          ) : null}
          <button
            className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={!save.canDiscard}
            onClick={discardRecording}
          >
            Discard recording
          </button>
          {save.note ? <p className="text-xs text-ink-dim">{save.note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
