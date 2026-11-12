import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Clip } from '@shared/clip'
import type { ChainSpec, ExtractedSound } from '@shared/audio'
import { DEFAULT_CHAIN_SPEC } from '@shared/audio'
import type { CanvasDocument } from '@shared/canvas'
import type { ImagiiProject } from '@shared/workspace'
import {
  MAX_SCHEMA_VERSION,
  validateProject,
  validateProjectJsonString,
  isSafeToAutosave
} from '@shared/projectValidation'
import { pathToImagiiFileUrl } from '@shared/fileUrl'
import { newTextOverlay } from '@shared/textOverlay'
import toast from 'react-hot-toast'
import {
  captureProject,
  applyProject,
  applyPlace,
  currentRoute,
  describeApplyOutcome,
  describeUnavailableSources,
  replacedSince,
  audioSettled,
  sessionHoldsWork,
  describeRestoreRefused,
  subscribeSessionStores,
  keptPartQuestion
} from './ProjectIO'
import { useVideoStore, videoKey } from '../video-studio/store/videoStore'
import { useAudioStore, soundKey } from '../audio-studio/state/audioStore'
import { useCanvasStore } from '../image-studio/state/canvasStore'
import { useReferencesStore } from '../references/state/referencesStore'

/**
 * T-07 (a) — save -> load round trip at the logic level.
 *
 * ProjectIO itself has no DOM dependency: the three studio stores are
 * plain zustand and only reach outward through `window.api` inside
 * `loadSource`. So the whole pipeline runs in the node environment with
 * a stubbed preload bridge — no jsdom needed. The one piece that stays
 * out of reach at this layer is `Home.tsx` / `AutosaveRestore.tsx`,
 * which are React components; the validate-then-apply ORDER they
 * implement is pinned here through `loadProjectJson` below, which
 * mirrors the product flow (main's `project:load` validates, the
 * renderer applies only on ok).
 */

const VIDEO_PATH = '/home/user/Videos/stream.mp4'
const SRT_PATH = '/home/user/Videos/stream.srt'
const AUDIO_PATH = '/home/user/Audio/mic.wav'
const MUSIC_PATH = '/home/user/Audio/bed.mp3'

/** What `audio:extractFromVideo` answers (T-126 (7)): the scratch WAV and what the probe found in the file's streams (null: it could not tell). */
const sound = (wavPath: string, hasVideo: boolean | null = null): ExtractedSound => ({ wavPath, hasVideo })

const CLIP_A: Clip = {
  id: 'clip-a',
  name: 'Cold open',
  startSec: 0,
  endSec: 12.5,
  cropRect: { x: 0, y: 0, w: 1920, h: 1080 },
  textOverlays: [
    {
      id: 'ov-1',
      text: 'first blood',
      font: 'Inter',
      sizePx: 48,
      colorHex: '#ff5c00',
      x: 100,
      y: 200,
      startSec: 1,
      endSec: 4
    }
  ],
  selectedPresets: ['youtube', 'tiktok'],
  customPresetIds: ['custom-1'],
  speedMultiplier: 1.5,
  colorGrade: { brightness: 0.1, contrast: 1.2, saturation: 1.1, temperature: -0.5 },
  autoZoom: true,
  hypeShake: false
}

const CLIP_B: Clip = {
  id: 'clip-b',
  name: 'The clutch',
  startSec: 40,
  endSec: 58,
  cropRect: null,
  textOverlays: [],
  selectedPresets: ['reels']
}

const CHAIN: ChainSpec = {
  denoise: 'parametric',
  // sensitivity is the legacy round-18 field, kept optional so older
  // presets round-trip — included here so the round trip covers it.
  denoiseParams: { noiseFloorDb: -45, reductionDb: 18, sensitivity: 1 },
  hum60: true,
  rumbleHighpass: true,
  deEss: true,
  compressor: 'voice',
  loudnorm: true,
  loudnormTargetLufs: -14,
  gainDb: 2.5,
  cutRegions: [{ startSec: 3, endSec: 7.25 }],
  secondaryTrack: {
    filePath: MUSIC_PATH,
    fileName: 'bed.mp3',
    role: 'music',
    gainDb: -6,
    duckUnderPrimary: true,
    matchLoudness: false,
    duckParams: { thresholdDb: -24, ratio: 6, attackMs: 15, releaseMs: 350 }
  }
}

const DOC: CanvasDocument = {
  width: 1200,
  height: 800,
  background: '#101014',
  layers: [
    {
      id: 'layer-rect',
      type: 'rect',
      name: 'Backing plate',
      visible: true,
      locked: false,
      x: 10,
      y: 20,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 0.9,
      width: 400,
      height: 120,
      fill: '#ff5c00',
      stroke: '#ffffff',
      strokeWidth: 2,
      cornerRadius: 8
    },
    {
      id: 'layer-text',
      type: 'text',
      name: 'Handle',
      visible: true,
      locked: false,
      x: 24,
      y: 44,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      text: 'live now',
      fontSize: 42,
      fontFamily: 'Inter',
      fill: '#ffffff'
    }
  ]
}

const VIDEO_PROBE = {
  duration: 120,
  width: 1920,
  height: 1080,
  fps: 60,
  videoCodec: 'h264',
  audioCodec: 'aac',
  bitrate: 8_000_000,
  sizeBytes: 120_000_000
}

const AUDIO_PROBE = {
  duration: 120,
  sampleRate: 48_000,
  channels: 2,
  codec: 'pcm_s16le',
  bitrate: 1_536_000,
  format: 'wav',
  sizeBytes: 23_000_000
}

/**
 * T-129: the waveform's half of the audio bridge. `loadSource` opens a file and main's peaks job (`audio:peaks`) draws it after;
 * these answer at once, and Close's cancel of a job still drawing has somewhere to go.
 */
const PEAKS_BRIDGE = {
  peaks: () => Promise.resolve({ peaks: [[0.5], [-0.5]], duration: 120 }),
  onPeaksProgress: () => () => undefined,
  cancel: () => Promise.resolve(true)
}

/** Mirrors the product load flow: validate first, apply only on ok. */
async function loadProjectJson(raw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = validateProjectJsonString(raw)
  if (!result.ok) return { ok: false, reason: result.reason }
  await applyProject(result.project)
  return { ok: true }
}

async function seedAllStudios(): Promise<void> {
  await useVideoStore.getState().loadSource(VIDEO_PATH)
  useVideoStore.setState({ clips: [CLIP_A, CLIP_B], selectedClipId: CLIP_B.id, srtPath: SRT_PATH })
  // A plain audio file the user picked. A sound EXTRACTED from the video is a
  // different thing with a different project shape (T-99, its own block below).
  await useAudioStore.getState().loadSource(AUDIO_PATH)
  useAudioStore.setState({ chain: CHAIN })
  useCanvasStore.getState().setDocument(DOC)
}

function wipeAllStudios(): void {
  useVideoStore.getState().clearSource()
  // T-173 (4): a transcript's path is held for the session so it comes back with its video; a test is a new session.
  useVideoStore.getState().forgetHeldTranscripts()
  useAudioStore.getState().clearSource()
  useCanvasStore.getState().resetDocument()
}

beforeEach(() => {
  vi.stubGlobal('window', {
    api: {
      video: {
        probe: (_p: string) => Promise.resolve(VIDEO_PROBE),
        fileUrl: (p: string) => pathToImagiiFileUrl(p)
      },
      audio: {
        ...PEAKS_BRIDGE,
        probe: (_p: string) => Promise.resolve(AUDIO_PROBE)
      }
    }
  })
  wipeAllStudios()
})

afterEach(() => {
  wipeAllStudios()
  vi.unstubAllGlobals()
})

describe('captureProject -> validate -> applyProject round trip', () => {
  it('a project with content in all three studios survives the full pipeline', async () => {
    await seedAllStudios()

    const captured = captureProject()
    const raw = JSON.stringify(captured)

    const validation = validateProjectJsonString(raw)
    expect(validation.ok).toBe(true)
    if (!validation.ok) throw new Error(`validation refused a captured project: ${validation.reason}`)

    // Prove restoration actually happens rather than the seed lingering.
    wipeAllStudios()
    expect(useVideoStore.getState().source).toBeNull()
    expect(useAudioStore.getState().source).toBeNull()
    expect(useCanvasStore.getState().doc.layers).toHaveLength(0)

    await applyProject(validation.project)

    const video = useVideoStore.getState()
    expect(video.source?.filePath).toBe(VIDEO_PATH)
    expect(video.clips).toEqual([CLIP_A, CLIP_B])
    expect(video.selectedClipId).toBe(CLIP_B.id)
    expect(video.srtPath).toBe(SRT_PATH)

    const audio = useAudioStore.getState()
    expect(audio.source?.filePath).toBe(AUDIO_PATH)
    expect(audio.source?.fromVideo).toBeNull()
    expect(audio.chain).toEqual(CHAIN)

    expect(useCanvasStore.getState().doc).toEqual(DOC)
  })

  it('captureProject emits MAX_SCHEMA_VERSION and every studio key it has state for', async () => {
    await seedAllStudios()
    const captured = captureProject()
    expect(captured.schemaVersion).toBe(MAX_SCHEMA_VERSION)
    expect(captured.savedAt).toBeGreaterThan(0)
    expect(captured.videoStudio?.sourcePath).toBe(VIDEO_PATH)
    expect(captured.videoStudio?.srtPath).toBe(SRT_PATH)
    expect(captured.audioStudio?.sourcePath).toBe(AUDIO_PATH)
    expect(captured.audioStudio?.extractedFromVideo).toBeUndefined()
    expect(captured.audioStudio?.fromVideoPath).toBeUndefined()
    expect(captured.imageCanvas?.doc).toEqual(DOC)
  })

  it('a captured project is accepted by BOTH gates it must pass (validator + autosave)', async () => {
    await seedAllStudios()
    const captured = captureProject()
    // If capture ever emits a shape the validator refuses, autosave dies
    // silently and every save is lost. Pin both gates on the same object.
    expect(validateProject(captured)).toMatchObject({ ok: true })
    expect(isSafeToAutosave(captured)).toEqual({ ok: true })
  })

  it('a project holding the overlay "+ Add text" stores untouched saves, autosaves and restores (T-113)', async () => {
    // The default overlay's color was the NAME "white", which `isValidTextOverlay` (hex only)
    // refuses: Save project threw, and an autosave holding it failed to restore.
    await useVideoStore.getState().loadSource(VIDEO_PATH)
    const clip = useVideoStore.getState().clips[0] as Clip
    useVideoStore.getState().addTextOverlay(clip.id, newTextOverlay(clip.startSec, clip.endSec))
    // ...and a name typed into an existing overlay is stored as its hex too.
    useVideoStore.getState().addTextOverlay(clip.id, newTextOverlay(clip.startSec, clip.endSec))
    const second = useVideoStore.getState().clips[0]?.textOverlays[1]
    useVideoStore.getState().updateTextOverlay(clip.id, second?.id as string, { colorHex: 'Red', sizePx: 9999 })

    const captured = captureProject()
    expect(validateProject(captured)).toMatchObject({ ok: true })
    expect(isSafeToAutosave(captured)).toEqual({ ok: true })
    const raw = JSON.stringify(captured)
    const validation = validateProjectJsonString(raw)
    expect(validation.ok).toBe(true)

    wipeAllStudios()
    if (validation.ok) await applyProject(validation.project)
    const overlays = useVideoStore.getState().clips[0]?.textOverlays ?? []
    expect(overlays.map((o) => [o.colorHex, o.sizePx])).toEqual([
      ['#ffffff', 48],
      ['#ff0000', 512]
    ])
  })

  it('an empty session captures no studio keys and is refused by the autosave gate', () => {
    const captured = captureProject()
    expect(captured.videoStudio).toBeUndefined()
    expect(captured.audioStudio).toBeUndefined()
    expect(captured.imageCanvas).toBeUndefined()
    expect(isSafeToAutosave(captured)).toEqual({
      ok: false,
      reason: 'no studio state to save'
    })
  })

  it('a v1 project round-trips through migration and restores video state', async () => {
    const v1: ImagiiProject = {
      schemaVersion: 1,
      savedAt: Date.now(),
      appVersion: '1.0.0',
      videoStudio: {
        sourcePath: VIDEO_PATH,
        clips: [CLIP_B],
        selectedClipId: CLIP_B.id,
        watermark: null
      }
    }
    const outcome = await loadProjectJson(JSON.stringify(v1))
    expect(outcome).toEqual({ ok: true })
    expect(useVideoStore.getState().clips).toEqual([CLIP_B])
    // v1 had no srtPath field; it must come back null, not undefined-ish.
    expect(useVideoStore.getState().srtPath).toBeNull()
  })
})

// T-124 (5): the Home page offered the autosave on EVERY visit, mid-session included, and Restore applied it over the live
// session with no question (it wiped the undo histories). The banner is for a session that holds nothing: a launch, or
// the page a crash reloads to. "Holds work" is what captureProject would emit a studio for.
describe('sessionHoldsWork: is there anything in the stores worth protecting from a Restore (T-124 (5))', () => {
  it('an untouched session holds none', () => {
    expect(sessionHoldsWork()).toBe(false)
  })

  it('a video, a sound or a layer is work, each alone', async () => {
    await useVideoStore.getState().loadSource(VIDEO_PATH)
    expect(sessionHoldsWork()).toBe(true)
    wipeAllStudios()
    expect(sessionHoldsWork()).toBe(false)

    await useAudioStore.getState().loadSource(AUDIO_PATH)
    expect(sessionHoldsWork()).toBe(true)
    wipeAllStudios()
    expect(sessionHoldsWork()).toBe(false)

    useCanvasStore.getState().setDocument(DOC)
    expect(sessionHoldsWork()).toBe(true)
    wipeAllStudios()
    expect(sessionHoldsWork()).toBe(false)
  })

  it('a canvas whose layers were all removed is empty again, and clips with no video behind them are not work', () => {
    useCanvasStore.getState().setDocument(DOC)
    expect(sessionHoldsWork()).toBe(true)
    useCanvasStore.getState().setDocument({ ...DOC, layers: [] })
    expect(sessionHoldsWork()).toBe(false)
    useVideoStore.setState({ clips: [CLIP_A, CLIP_B], selectedClipId: CLIP_B.id })
    expect(sessionHoldsWork()).toBe(false)
  })

  it('is the very definition the autosave gate uses: a captured session is saveable exactly when it holds work', async () => {
    expect(isSafeToAutosave(captureProject()).ok).toBe(sessionHoldsWork())
    await seedAllStudios()
    expect(isSafeToAutosave(captureProject()).ok).toBe(sessionHoldsWork())
  })
})

describe('a refused project file never reaches the stores', () => {
  /** Tampers the serialized form of a good captured project. */
  async function capturedRawWith(
    mutate: (p: Record<string, unknown>) => void
  ): Promise<string> {
    await seedAllStudios()
    const captured = JSON.parse(JSON.stringify(captureProject())) as Record<string, unknown>
    mutate(captured)
    return JSON.stringify(captured)
  }

  /** Loads a tampered file over a known-good session and asserts the
   *  session survived byte-for-byte. */
  async function expectRefusedWithoutClobber(raw: string, reason: string): Promise<void> {
    wipeAllStudios()
    await seedAllStudios()
    const goodVideo = useVideoStore.getState()
    const goodClips = goodVideo.clips
    const goodChain = useAudioStore.getState().chain
    const goodDoc = useCanvasStore.getState().doc

    const outcome = await loadProjectJson(raw)

    expect(outcome).toEqual({ ok: false, reason })
    expect(useVideoStore.getState().source?.filePath).toBe(VIDEO_PATH)
    expect(useVideoStore.getState().clips).toEqual(goodClips)
    expect(useVideoStore.getState().srtPath).toBe(SRT_PATH)
    expect(useAudioStore.getState().chain).toEqual(goodChain)
    expect(useCanvasStore.getState().doc).toEqual(goodDoc)
  }

  it('refuses a traversal sourcePath and leaves the loaded session intact', async () => {
    const raw = await capturedRawWith((p) => {
      ;(p.videoStudio as Record<string, unknown>).sourcePath = '/home/user/../../etc/passwd'
    })
    await expectRefusedWithoutClobber(raw, 'videoStudio.sourcePath unsafe or malformed')
  })

  it('refuses a traversal secondaryTrack.filePath and leaves the session intact', async () => {
    const raw = await capturedRawWith((p) => {
      const audio = p.audioStudio as Record<string, unknown>
      const chain = audio.chain as Record<string, unknown>
      ;(chain.secondaryTrack as Record<string, unknown>).filePath = '../../../.ssh/id_rsa'
    })
    await expectRefusedWithoutClobber(
      raw,
      'audioStudio.chain.secondaryTrack.filePath unsafe or malformed'
    )
  })

  it('refuses a filter-injection colorHex and leaves the session intact', async () => {
    const raw = await capturedRawWith((p) => {
      const video = p.videoStudio as Record<string, unknown>
      const clips = video.clips as Array<Record<string, unknown>>
      const overlays = clips[0]?.textOverlays as Array<Record<string, unknown>>
      const overlay = overlays[0]
      if (overlay) overlay.colorHex = "white':fontsize=99'"
    })
    await expectRefusedWithoutClobber(raw, 'videoStudio.clips[0].textOverlays[0] malformed')
  })

  it('refuses an unsupported schemaVersion and leaves the session intact', async () => {
    const raw = await capturedRawWith((p) => {
      p.schemaVersion = 99
    })
    await expectRefusedWithoutClobber(
      raw,
      'unsupported schemaVersion 99 (supported: 1, 2, 3, 4, 5)'
    )
  })

  it('refuses truncated JSON and leaves the session intact', async () => {
    const raw = (await capturedRawWith(() => {})).slice(0, 40)
    wipeAllStudios()
    await seedAllStudios()
    const outcome = await loadProjectJson(raw)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toMatch(/^invalid JSON: /)
    expect(useVideoStore.getState().source?.filePath).toBe(VIDEO_PATH)
    expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
    expect(useCanvasStore.getState().doc).toEqual(DOC)
  })
})

/**
 * T-47 — the place record: route, selections, playhead. The rule the tests
 * below encode is that place is a CONVENIENCE and the studio state is the
 * work: a place that no longer makes sense degrades quietly, field by
 * field, and never costs the user a restore.
 */
describe('place record: capture, restore, and per-field degradation', () => {
  it('captures the selections and the playhead alongside the studio state', async () => {
    await seedAllStudios()
    useVideoStore.getState().requestSeek(42)
    useCanvasStore.getState().selectLayer('layer-text')
    useReferencesStore.getState().setTab('moodboards')

    const captured = captureProject()

    expect(captured.place?.videoClipId).toBe(CLIP_B.id)
    expect(captured.place?.canvasLayerId).toBe('layer-text')
    expect(captured.place?.referencesTab).toBe('moodboards')
    expect(captured.place?.videoTimeSec).toBeCloseTo(42, 5)
    // And the whole thing still passes both gates it has to pass.
    expect(validateProject(captured)).toMatchObject({ ok: true })
    expect(isSafeToAutosave(captured)).toEqual({ ok: true })
  })

  it('restores the selections and parks the playhead for the Player', async () => {
    await seedAllStudios()
    useVideoStore.getState().requestSeek(42)
    useCanvasStore.getState().selectLayer('layer-text')
    const raw = JSON.stringify(captureProject())
    wipeAllStudios()
    useReferencesStore.getState().setTab('reference')

    expect(await loadProjectJson(raw)).toEqual({ ok: true })

    expect(useVideoStore.getState().selectedClipId).toBe(CLIP_B.id)
    expect(useCanvasStore.getState().selectedLayerId).toBe('layer-text')
    // Parked as a seek REQUEST: the Player is the only thing that owns the
    // media element, so a restore hands it the position rather than
    // writing one nothing is listening to.
    expect(useVideoStore.getState().seekRequest?.seconds).toBeCloseTo(42, 5)
    expect(useVideoStore.getState().currentTime).toBeCloseTo(42, 5)
  })

  it('drops a selection that no longer exists instead of selecting nothing', async () => {
    await seedAllStudios()
    const project = captureProject()
    wipeAllStudios()
    await applyProject({
      ...project,
      place: { videoClipId: 'clip-that-was-deleted', canvasLayerId: 'layer-gone' }
    })

    // The clip selection falls back to what the studio state itself says…
    expect(useVideoStore.getState().selectedClipId).toBe(CLIP_B.id)
    // …and a dangling layer id selects nothing rather than a wrong layer.
    expect(useCanvasStore.getState().selectedLayerId).toBeNull()
  })

  it('applies nothing at all for a snapshot with no place (v1/v2 files)', async () => {
    await seedAllStudios()
    const project = captureProject()
    wipeAllStudios()
    useReferencesStore.getState().setTab('assets')

    const { place: _dropped, ...withoutPlace } = project
    void _dropped
    await applyProject({ ...withoutPlace, schemaVersion: 2 })

    // Exactly the pre-T-47 restore: data back, nothing else touched.
    expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
    expect(useReferencesStore.getState().tab).toBe('assets')
    expect(useVideoStore.getState().seekRequest).toBeNull()
  })

  it('parks no playhead when the snapshot has no video source to seek in', () => {
    wipeAllStudios()
    applyPlace({ route: '/video', videoTimeSec: 30 })
    expect(useVideoStore.getState().seekRequest).toBeNull()
    expect(useVideoStore.getState().currentTime).toBe(0)
  })

  it('leaves the canvas history EMPTY, so the app never opens offering to undo the restore', async () => {
    await seedAllStudios()
    const raw = JSON.stringify(captureProject())
    wipeAllStudios()
    // A pre-existing step in each store that keeps one, to prove the restore
    // clears rather than adds.
    useCanvasStore.getState().addLayer({
      ...DOC.layers[0]!,
      id: 'pre-existing'
    })
    useReferencesStore.setState({
      history: {
        past: [{ collections: [], selectedCollectionId: null }],
        future: []
      }
    })
    expect(useCanvasStore.getState().canUndo()).toBe(true)
    expect(useReferencesStore.getState().canUndo()).toBe(true)

    expect(await loadProjectJson(raw)).toEqual({ ok: true })

    // The contract: right after a restore there is nothing to undo in any
    // studio — the same thing every editor does when it opens a file.
    expect(useCanvasStore.getState().canUndo()).toBe(false)
    expect(useCanvasStore.getState().canRedo()).toBe(false)
    expect(useVideoStore.getState().canUndo()).toBe(false)
    expect(useAudioStore.getState().canUndo()).toBe(false)
    // T-58: References keeps a history now, and a project file carries no
    // board state to put back — so the restore's only job here is to make
    // sure Undo does not come back pointing at the session before it.
    expect(useReferencesStore.getState().canUndo()).toBe(false)
    expect(useReferencesStore.getState().canRedo()).toBe(false)
  })
})

/**
 * T-84 — a project whose video was moved opens the REST of the project.
 *
 * applyProject used to be one straight line of awaits, so the first
 * `loadSource` that threw (a recording moved to another drive, a file on a
 * disconnected USB stick) rejected the whole call and left the project
 * half-restored — canvas in, audio and place never applied — behind a toast
 * that printed ffprobe's stderr. A project is the user's work in up to four
 * studios; one missing media file is a fact about ONE of them. The contract
 * these tests pin:
 *
 *   - a studio whose source cannot be loaded is reported, not thrown, and is
 *     left exactly as it was (no clips or caption path applied over a source
 *     that is not there);
 *   - every other studio is applied regardless of which one failed or in
 *     what order the failures come;
 *   - the report names the file, so the one message the user sees can too.
 */
describe('applyProject: a studio whose file is gone does not take the rest down (T-84)', () => {
  const MISSING = (p: string): Error =>
    new Error(`ffprobe exit 1: ${p}: No such file or directory`)

  /** The preload bridge with the given paths "moved": their probes reject. */
  function bridgeWithout(...gone: string[]): void {
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (p: string) =>
            gone.includes(p) ? Promise.reject(MISSING(p)) : Promise.resolve(VIDEO_PROBE),
          fileUrl: (p: string) => pathToImagiiFileUrl(p)
        },
        audio: {
          ...PEAKS_BRIDGE,
          probe: (p: string) =>
            gone.includes(p) ? Promise.reject(MISSING(p)) : Promise.resolve(AUDIO_PROBE)
        }
      }
    })
  }

  /** A full project on disk, as `captureProject` wrote it. */
  async function fullProject(): Promise<ImagiiProject> {
    await seedAllStudios()
    useCanvasStore.getState().selectLayer('layer-text')
    const project = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
    wipeAllStudios()
    return project
  }

  it('a moved VIDEO still opens the audio, the canvas and the place', async () => {
    const project = await fullProject()
    bridgeWithout(VIDEO_PATH)

    const outcome = await applyProject(project)

    expect(outcome.unavailable).toEqual([
      { studio: 'video', path: VIDEO_PATH, fileName: 'stream.mp4' }
    ])
    // Everything the project could still give back is back…
    expect(useAudioStore.getState().source?.filePath).toBe(AUDIO_PATH)
    expect(useAudioStore.getState().chain).toEqual(CHAIN)
    expect(useCanvasStore.getState().doc).toEqual(DOC)
    expect(useCanvasStore.getState().selectedLayerId).toBe('layer-text')
    // …and the studio that lost its file holds NOTHING from the project: no
    // clips or caption path hanging over a video that is not there.
    expect(useVideoStore.getState().source).toBeNull()
    expect(useVideoStore.getState().clips).toEqual([])
    expect(useVideoStore.getState().srtPath).toBeNull()
  })

  it('a moved AUDIO file still opens the video, the canvas and the place', async () => {
    const project = await fullProject()
    bridgeWithout(AUDIO_PATH)

    const outcome = await applyProject(project)

    expect(outcome.unavailable).toEqual([
      { studio: 'audio', path: AUDIO_PATH, fileName: 'mic.wav' }
    ])
    expect(useVideoStore.getState().source?.filePath).toBe(VIDEO_PATH)
    expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
    expect(useVideoStore.getState().selectedClipId).toBe(CLIP_B.id)
    expect(useVideoStore.getState().srtPath).toBe(SRT_PATH)
    expect(useCanvasStore.getState().doc).toEqual(DOC)
    expect(useAudioStore.getState().source).toBeNull()
    // The audio load failing must not leave the store stuck "loading".
    expect(useAudioStore.getState().loading).toBe(false)
  })

  it('both media files gone still opens the canvas, and reports both in order', async () => {
    const project = await fullProject()
    bridgeWithout(VIDEO_PATH, AUDIO_PATH)

    const outcome = await applyProject(project)

    expect(outcome.unavailable.map((u) => u.studio)).toEqual(['video', 'audio'])
    expect(useCanvasStore.getState().doc).toEqual(DOC)
    expect(useCanvasStore.getState().selectedLayerId).toBe('layer-text')
  })

  it('reports nothing when every file is where the project left it', async () => {
    const project = await fullProject()
    bridgeWithout()

    const outcome = await applyProject(project)

    expect(outcome.unavailable).toEqual([])
    expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
    expect(useAudioStore.getState().source?.filePath).toBe(AUDIO_PATH)
  })

  it('does not apply a place that points into the studio that lost its file', async () => {
    const project = await fullProject()
    bridgeWithout(VIDEO_PATH)
    // The clip selection and playhead live in the video studio; with no
    // video there is nothing for them to select or seek.
    await applyProject({
      ...project,
      place: { videoClipId: CLIP_B.id, videoTimeSec: 42 }
    })
    expect(useVideoStore.getState().selectedClipId).toBeNull()
    expect(useVideoStore.getState().seekRequest).toBeNull()
  })
})

describe('describeUnavailableSources: the ONE message for the files a project could not find (T-84)', () => {
  const video = { studio: 'video' as const, path: '/v/stream.mp4', fileName: 'stream.mp4' }
  const audio = { studio: 'audio' as const, path: '/a/mic.wav', fileName: 'mic.wav' }

  it('says nothing when nothing is missing', () => {
    expect(describeUnavailableSources([])).toBeNull()
  })

  it('names the video, says the rest is open, and says where to load it again', () => {
    expect(describeUnavailableSources([video])).toBe(
      "Couldn't find stream.mp4. It may have been moved or deleted. " +
        'The rest of your project is open — load the video again in Video Studio.'
    )
  })

  it('names the audio file and sends the user to Audio Studio', () => {
    expect(describeUnavailableSources([audio])).toBe(
      "Couldn't find mic.wav. It may have been moved or deleted. " +
        'The rest of your project is open — load the audio again in Audio Studio.'
    )
  })

  it('names both files in one sentence when both are gone', () => {
    expect(describeUnavailableSources([video, audio])).toBe(
      "Couldn't find stream.mp4 and mic.wav. They may have been moved or deleted. " +
        'The rest of your project is open — load the video again in Video Studio ' +
        'and the audio again in Audio Studio.'
    )
  })
})

/**
 * T-99 — user data never points into a temp family.
 *
 * Extracting the sound of a video writes a WAV under `%TEMP%/imagii-audio`, and
 * saving the project stored THAT path as the audio source. Launch-time temp
 * pruning removes files after six hours, so the next day's "Open project" said
 * "Couldn't find aB3dE5fG7h.wav" — a name the user never chose, for a file they
 * never saw, with no way to get it back (the video it came from was recorded
 * right beside it in the project). A project now stores the VIDEO and a marker,
 * and opening it extracts the sound again.
 */
describe('a sound extracted from a video is stored as the video (T-99)', () => {
  const WAV_THIS_SESSION = '/tmp/imagii-audio/aB3dE5fG7h.wav'
  const WAV_NEXT_LAUNCH = '/tmp/imagii-audio/kQ9rS1tU3v.wav'

  /**
   * The preload bridge as it behaves across a prune: files in `gone` no longer
   * exist (their probes reject like ffprobe's), and every extraction writes the
   * next WAV in `extractions` — a new random name each time, as the real one does.
   */
  function bridge(opts: { gone?: string[]; extractions?: string[] } = {}): { extracted: string[] } {
    const gone = opts.gone ?? []
    const queue = [...(opts.extractions ?? [])]
    const extracted: string[] = []
    const missing = (p: string): Error =>
      new Error(`ffprobe exit 1: ${p}: No such file or directory`)
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (p: string) =>
            gone.includes(p) ? Promise.reject(missing(p)) : Promise.resolve(VIDEO_PROBE),
          fileUrl: (p: string) => pathToImagiiFileUrl(p)
        },
        audio: {
          ...PEAKS_BRIDGE,
          probe: (p: string) =>
            gone.includes(p) ? Promise.reject(missing(p)) : Promise.resolve(AUDIO_PROBE),
          extractFromVideo: (video: string) => {
            extracted.push(video)
            if (gone.includes(video)) return Promise.reject(new Error(`audio extract exit 1: ${video}: No such file or directory`))
            const wav = queue.shift()
            return wav ? Promise.resolve(sound(wav)) : Promise.reject(new Error('no extraction queued'))
          }
        }
      }
    })
    return { extracted }
  }

  async function extractionSession(): Promise<void> {
    bridge({ extractions: [WAV_THIS_SESSION] })
    await useVideoStore.getState().loadSource(VIDEO_PATH)
    const { wavPath: wav, hasVideo } = await window.api.audio.extractFromVideo(VIDEO_PATH)
    await useAudioStore.getState().loadSource(wav, VIDEO_PATH, undefined, hasVideo)
    useAudioStore.setState({ chain: CHAIN })
  }

  it('saves the VIDEO and the marker, and no path into the temp folder anywhere in the file', async () => {
    await extractionSession()
    const captured = captureProject()

    expect(captured.schemaVersion).toBe(MAX_SCHEMA_VERSION)
    expect(captured.audioStudio).toEqual({
      sourcePath: VIDEO_PATH,
      extractedFromVideo: true,
      chain: CHAIN
    })
    const raw = JSON.stringify(captured)
    expect(raw).not.toContain('imagii-audio')
    expect(raw).not.toContain(WAV_THIS_SESSION)
    // …and the file it wrote passes both gates it has to pass.
    expect(validateProject(captured)).toMatchObject({ ok: true })
    expect(isSafeToAutosave(captured)).toEqual({ ok: true })
  })

  it('a plain audio file is stored as itself, with no marker', async () => {
    bridge()
    await useAudioStore.getState().loadSource(AUDIO_PATH)
    const audio = captureProject().audioStudio
    expect(audio).toEqual({ sourcePath: AUDIO_PATH, chain: expect.any(Object) })
    expect(audio?.extractedFromVideo).toBeUndefined()
    // ...and the header names the file itself: only an EXTRACTION takes the video's name (T-108).
    expect(useAudioStore.getState().source?.fileName).toBe('mic.wav')
  })

  it('save -> the scratch WAV is pruned -> reopen: the sound is extracted again and the chain is back', async () => {
    await extractionSession()
    const saved = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
    wipeAllStudios()

    // The next launch: the old WAV is gone and the project only knows the video.
    const { extracted } = bridge({ gone: [WAV_THIS_SESSION], extractions: [WAV_NEXT_LAUNCH] })
    const outcome = await applyProject(saved)

    expect(outcome.unavailable).toEqual([])
    expect(extracted).toEqual([VIDEO_PATH])
    const audio = useAudioStore.getState()
    expect(audio.source?.filePath).toBe(WAV_NEXT_LAUNCH)
    expect(audio.source?.fromVideo).toEqual({ videoPath: VIDEO_PATH })
    expect(audio.chain).toEqual(CHAIN)
  })

  it('goes through the validator on the way back, as Open project does', async () => {
    await extractionSession()
    const raw = JSON.stringify(captureProject())
    wipeAllStudios()
    const { extracted } = bridge({ extractions: [WAV_NEXT_LAUNCH] })
    expect(await loadProjectJson(raw)).toEqual({ ok: true })
    expect(extracted).toEqual([VIDEO_PATH])
    expect(useAudioStore.getState().source?.filePath).toBe(WAV_NEXT_LAUNCH)
  })

  it('a video that moved is reported as the file that is gone, and the rest of the project opens', async () => {
    await seedAllStudios()
    await useAudioStore.getState().loadSource(AUDIO_PATH, VIDEO_PATH)
    const project = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
    wipeAllStudios()

    bridge({ gone: [VIDEO_PATH] })
    const outcome = await applyProject(project)

    // The video studio and the sound both needed the same file; both say so,
    // and the one message names it once.
    expect(outcome.unavailable.map((u) => [u.studio, u.fileName])).toEqual([
      ['video', 'stream.mp4'],
      ['audio', 'stream.mp4']
    ])
    expect(describeUnavailableSources(outcome.unavailable)).toBe(
      "Couldn't find stream.mp4. It may have been moved or deleted. " +
        'The rest of your project is open — load the video again in Video Studio ' +
        'and the audio again in Audio Studio.'
    )
    expect(useAudioStore.getState().source).toBeNull()
    expect(useAudioStore.getState().loading).toBe(false)
    expect(useCanvasStore.getState().doc).toEqual(DOC)
  })

  it('an extraction that fails with the video still there is reported, not thrown', async () => {
    await extractionSession()
    const project = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
    wipeAllStudios()
    bridge({ extractions: [] }) // the extractor has nothing to give
    const outcome = await applyProject(project)
    // T-112: the video is there, so this is not a missing file.
    expect(outcome.unavailable).toEqual([])
    expect(outcome.failed).toEqual([
      { studio: 'audio', path: VIDEO_PATH, fileName: 'stream.mp4', message: "Couldn't open stream.mp4." }
    ])
    expect(useAudioStore.getState().source).toBeNull()
  })

  describe('a project written before the marker keeps the shape it was written in', () => {
    const OLD_EXTRACTION: ImagiiProject = {
      schemaVersion: 3,
      savedAt: 1_700_000_000_000,
      appVersion: '1.0.0',
      audioStudio: { sourcePath: WAV_THIS_SESSION, fromVideoPath: VIDEO_PATH, chain: CHAIN }
    }

    it('still opens when its scratch WAV is still there, without extracting anything', async () => {
      const { extracted } = bridge()
      expect(await loadProjectJson(JSON.stringify(OLD_EXTRACTION))).toEqual({ ok: true })
      expect(extracted).toEqual([])
      const audio = useAudioStore.getState()
      expect(audio.source?.filePath).toBe(WAV_THIS_SESSION)
      expect(audio.source?.fromVideo).toEqual({ videoPath: VIDEO_PATH })
      expect(audio.chain).toEqual(CHAIN)
    })

    it('recovers a pruned WAV from the video it already names (T-107): extracted again, chain back, nothing reported', async () => {
      const { extracted } = bridge({ gone: [WAV_THIS_SESSION], extractions: [WAV_NEXT_LAUNCH] })
      const result = validateProjectJsonString(JSON.stringify(OLD_EXTRACTION))
      if (!result.ok) throw new Error(result.reason)
      const outcome = await applyProject(result.project)
      expect(outcome.unavailable).toEqual([])
      // The sound came from the VIDEO the v3 file carried beside the dead WAV.
      expect(extracted).toEqual([VIDEO_PATH])
      const audio = useAudioStore.getState()
      expect(audio.source?.filePath).toBe(WAV_NEXT_LAUNCH)
      expect(audio.source?.fromVideo).toEqual({ videoPath: VIDEO_PATH })
      // The header names the video, not either WAV (T-108).
      expect(audio.source?.fileName).toBe('stream.mp4')
      expect(audio.chain).toEqual(CHAIN)
    })

    it('with the WAV AND the video gone it names the VIDEO — the file the person knows', async () => {
      const { extracted } = bridge({ gone: [WAV_THIS_SESSION, VIDEO_PATH] })
      const result = validateProjectJsonString(JSON.stringify(OLD_EXTRACTION))
      if (!result.ok) throw new Error(result.reason)
      const outcome = await applyProject(result.project)
      expect(outcome.unavailable).toEqual([
        { studio: 'audio', path: VIDEO_PATH, fileName: 'stream.mp4' }
      ])
      expect(extracted).toEqual([VIDEO_PATH])
      expect(useAudioStore.getState().source).toBeNull()
      expect(useAudioStore.getState().loading).toBe(false)
    })

    it('a v1-3 PLAIN audio file with a dead path still says so (no video to recover from)', async () => {
      const { extracted } = bridge({ gone: [AUDIO_PATH] })
      const plain: ImagiiProject = {
        schemaVersion: 3,
        savedAt: 1_700_000_000_000,
        appVersion: '1.0.0',
        audioStudio: { sourcePath: AUDIO_PATH, fromVideoPath: null, chain: CHAIN }
      }
      const outcome = await applyProject(plain)
      expect(outcome.unavailable).toEqual([
        { studio: 'audio', path: AUDIO_PATH, fileName: 'mic.wav' }
      ])
      expect(extracted).toEqual([])
    })
  })
})

/**
 * T-107 — T-99's sibling for pictures: user data never points into a temp family.
 *
 * Dropping an flv/ts/wmv/mpg/3gp converts it to an mp4 working copy under
 * `%TEMP%/imagii-import`, and the video studio's source IS that copy. Saving the
 * project stored its path, the next launch pruned it, and "Open project" said
 * "Couldn't find stream-aB3dE5fG.mp4" for a file the person never chose, with the
 * original sitting where they dropped it. A project now stores the ORIGINAL and a
 * marker, and opening it converts again.
 */
describe('a video converted on import is stored as its original (T-107)', () => {
  const ORIGINAL = '/home/user/Videos/stream.flv'
  const COPY_THIS_SESSION = '/tmp/imagii-import/stream-aB3dE5fG.mp4'
  const COPY_NEXT_LAUNCH = '/tmp/imagii-import/stream-kQ9rS1tU.mp4'
  const WAV_THIS_SESSION = '/tmp/imagii-audio/aB3dE5fG7h.wav'
  const WAV_NEXT_LAUNCH = '/tmp/imagii-audio/kQ9rS1tU3v.wav'

  /**
   * The bridge across a prune: files in `gone` no longer exist, every conversion
   * writes the next copy in `conversions` (a new random name each time, as the real
   * one does), and every extraction the next WAV in `extractions`.
   */
  function bridge(
    opts: { gone?: string[]; conversions?: string[]; extractions?: string[] } = {}
  ): { converted: string[]; extracted: string[] } {
    const gone = opts.gone ?? []
    const conversions = [...(opts.conversions ?? [])]
    const extractions = [...(opts.extractions ?? [])]
    const converted: string[] = []
    const extracted: string[] = []
    const missing = (p: string): Error =>
      new Error(`ffprobe exit 1: ${p}: No such file or directory`)
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (p: string) =>
            gone.includes(p) ? Promise.reject(missing(p)) : Promise.resolve(VIDEO_PROBE),
          fileUrl: (p: string) => pathToImagiiFileUrl(p),
          convertForImport: (p: string) => {
            converted.push(p)
            if (gone.includes(p)) {
              return Promise.reject(
                new Error(`convert-to-mp4 exit 1: ${p}: No such file or directory`)
              )
            }
            const copy = conversions.shift()
            return copy ? Promise.resolve(copy) : Promise.reject(new Error('no conversion queued'))
          }
        },
        audio: {
          ...PEAKS_BRIDGE,
          probe: (p: string) =>
            gone.includes(p) ? Promise.reject(missing(p)) : Promise.resolve(AUDIO_PROBE),
          extractFromVideo: (video: string) => {
            extracted.push(video)
            if (gone.includes(video)) {
              return Promise.reject(new Error(`audio extract exit 1: ${video}: No such file or directory`))
            }
            const wav = extractions.shift()
            return wav ? Promise.resolve(sound(wav)) : Promise.reject(new Error('no extraction queued'))
          }
        }
      }
    })
    return { converted, extracted }
  }

  /** What the Importer does for a dropped flv: convert, then load the copy with its original. */
  async function conversionSession(extractions: string[] = []): Promise<void> {
    bridge({ conversions: [COPY_THIS_SESSION], extractions })
    const copy = await window.api.video.convertForImport(ORIGINAL)
    await useVideoStore.getState().loadSource(copy, ORIGINAL)
    useVideoStore.setState({ clips: [CLIP_A, CLIP_B], selectedClipId: CLIP_B.id, srtPath: SRT_PATH })
  }

  it('the studio shows the name of the file that was dropped, not the working copy', async () => {
    await conversionSession()
    const source = useVideoStore.getState().source
    expect(source?.filePath).toBe(COPY_THIS_SESSION)
    expect(source?.convertedFrom).toBe(ORIGINAL)
    expect(source?.fileName).toBe('stream.flv')
  })

  it('saves the ORIGINAL and the marker, and no path into the temp folder anywhere in the file', async () => {
    await conversionSession()
    const captured = captureProject()

    expect(captured.schemaVersion).toBe(MAX_SCHEMA_VERSION)
    expect(captured.videoStudio).toEqual({
      sourcePath: ORIGINAL,
      convertedForImport: true,
      clips: [CLIP_A, CLIP_B],
      selectedClipId: CLIP_B.id,
      watermark: null,
      srtPath: SRT_PATH
    })
    const raw = JSON.stringify(captured)
    expect(raw).not.toContain('imagii-import')
    expect(raw).not.toContain(COPY_THIS_SESSION)
    // ...and the file it wrote passes both gates it has to pass.
    expect(validateProject(captured)).toMatchObject({ ok: true })
    expect(isSafeToAutosave(captured)).toEqual({ ok: true })
  })

  it('a natively playable video is stored as itself, with no marker', async () => {
    bridge()
    await useVideoStore.getState().loadSource(VIDEO_PATH)
    const video = captureProject().videoStudio
    expect(video?.sourcePath).toBe(VIDEO_PATH)
    expect(video).not.toHaveProperty('convertedForImport')
    expect(useVideoStore.getState().source).not.toHaveProperty('convertedFrom')
  })

  it('save -> the working copy is pruned -> reopen: converted again, and the clips and captions are back', async () => {
    await conversionSession()
    const saved = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
    wipeAllStudios()

    // The next launch: the old copy is gone and the project only knows the original.
    const { converted } = bridge({ gone: [COPY_THIS_SESSION], conversions: [COPY_NEXT_LAUNCH] })
    const outcome = await applyProject(saved)

    expect(outcome.unavailable).toEqual([])
    expect(converted).toEqual([ORIGINAL])
    const video = useVideoStore.getState()
    expect(video.source?.filePath).toBe(COPY_NEXT_LAUNCH)
    expect(video.source?.convertedFrom).toBe(ORIGINAL)
    expect(video.source?.fileName).toBe('stream.flv')
    expect(video.clips).toEqual([CLIP_A, CLIP_B])
    expect(video.selectedClipId).toBe(CLIP_B.id)
    expect(video.srtPath).toBe(SRT_PATH)
    // A second save from the reopened session is still the original, not the new copy.
    expect(captureProject().videoStudio?.sourcePath).toBe(ORIGINAL)
  })

  it('goes through the validator on the way back, as Open project does', async () => {
    await conversionSession()
    const raw = JSON.stringify(captureProject())
    wipeAllStudios()
    const { converted } = bridge({ conversions: [COPY_NEXT_LAUNCH] })
    expect(await loadProjectJson(raw)).toEqual({ ok: true })
    expect(converted).toEqual([ORIGINAL])
    expect(useVideoStore.getState().source?.filePath).toBe(COPY_NEXT_LAUNCH)
  })

  it('an original that moved is reported by ITS name (the T-84 voice), and the rest of the project opens', async () => {
    await conversionSession()
    useCanvasStore.getState().setDocument(DOC)
    const saved = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
    wipeAllStudios()

    bridge({ gone: [ORIGINAL] })
    const outcome = await applyProject(saved)

    expect(outcome.unavailable).toEqual([{ studio: 'video', path: ORIGINAL, fileName: 'stream.flv' }])
    expect(describeUnavailableSources(outcome.unavailable)).toBe(
      "Couldn't find stream.flv. It may have been moved or deleted. " +
        'The rest of your project is open — load the video again in Video Studio.'
    )
    // Nothing from the studio that lost its file is applied over the hole.
    expect(useVideoStore.getState().source).toBeNull()
    expect(useVideoStore.getState().clips).toEqual([])
    expect(useCanvasStore.getState().doc).toEqual(DOC)
  })

  it('a conversion that fails with the original still there is reported, not thrown — and not as a missing file (T-112)', async () => {
    await conversionSession()
    const saved = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
    wipeAllStudios()
    bridge({ conversions: [] }) // the converter has nothing to give
    const outcome = await applyProject(saved)
    // The file is there; "moved or deleted" would send the person looking for nothing.
    expect(outcome.unavailable).toEqual([])
    expect(outcome.failed).toEqual([
      { studio: 'video', path: ORIGINAL, fileName: 'stream.flv', message: "Couldn't open stream.flv." }
    ])
    expect(useVideoStore.getState().source).toBeNull()
  })

  describe('a project written before the marker keeps the shape it was written in', () => {
    const OLD_CONVERSION: ImagiiProject = {
      schemaVersion: 4,
      savedAt: 1_700_000_000_000,
      appVersion: '1.0.0',
      videoStudio: {
        sourcePath: COPY_THIS_SESSION,
        clips: [CLIP_A],
        selectedClipId: CLIP_A.id,
        watermark: null,
        srtPath: null
      }
    }

    it('still opens when its working copy is still there, without converting anything', async () => {
      const { converted } = bridge()
      expect(await loadProjectJson(JSON.stringify(OLD_CONVERSION))).toEqual({ ok: true })
      expect(converted).toEqual([])
      expect(useVideoStore.getState().source?.filePath).toBe(COPY_THIS_SESSION)
      expect(useVideoStore.getState().source).not.toHaveProperty('convertedFrom')
    })

    it('says plainly that the copy is gone when it has been pruned — the original is not in the file, so nothing can be recovered', async () => {
      const { converted } = bridge({ gone: [COPY_THIS_SESSION], conversions: [COPY_NEXT_LAUNCH] })
      const result = validateProjectJsonString(JSON.stringify(OLD_CONVERSION))
      if (!result.ok) throw new Error(result.reason)
      const outcome = await applyProject(result.project)
      expect(outcome.unavailable).toEqual([
        { studio: 'video', path: COPY_THIS_SESSION, fileName: 'stream-aB3dE5fG.mp4' }
      ])
      expect(converted).toEqual([])
      expect(useVideoStore.getState().source).toBeNull()
    })
  })

  describe('the sound of a converted video (Clean audio) points at the original too', () => {
    /** Video Studio's "Clean audio": extract from the working copy, tell the audio studio the original. */
    async function cleanAudioSession(): Promise<void> {
      await conversionSession([WAV_THIS_SESSION])
      const { wavPath: wav, hasVideo } = await window.api.audio.extractFromVideo(COPY_THIS_SESSION)
      await useAudioStore.getState().loadSource(wav, COPY_THIS_SESSION, ORIGINAL, hasVideo)
      useAudioStore.setState({ chain: CHAIN })
    }

    it('keeps the working copy for re-attaching this session, and names the original in the header', async () => {
      await cleanAudioSession()
      const audio = useAudioStore.getState().source
      expect(audio?.fromVideo).toEqual({ videoPath: COPY_THIS_SESSION, convertedFrom: ORIGINAL })
      expect(audio?.fileName).toBe('stream.flv')
    })

    it('saves the original of the video and no path into either temp folder', async () => {
      await cleanAudioSession()
      const captured = captureProject()
      expect(captured.audioStudio).toEqual({
        sourcePath: ORIGINAL,
        extractedFromVideo: true,
        chain: CHAIN
      })
      const raw = JSON.stringify(captured)
      expect(raw).not.toContain('imagii-import')
      expect(raw).not.toContain('imagii-audio')
    })

    it('save -> both scratch files pruned -> reopen: the video is converted and the sound extracted, from the original', async () => {
      await cleanAudioSession()
      const saved = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
      wipeAllStudios()

      const { converted, extracted } = bridge({
        gone: [COPY_THIS_SESSION, WAV_THIS_SESSION],
        conversions: [COPY_NEXT_LAUNCH],
        extractions: [WAV_NEXT_LAUNCH]
      })
      const outcome = await applyProject(saved)

      expect(outcome.unavailable).toEqual([])
      expect(converted).toEqual([ORIGINAL])
      expect(extracted).toEqual([ORIGINAL])
      expect(useVideoStore.getState().source?.filePath).toBe(COPY_NEXT_LAUNCH)
      expect(useAudioStore.getState().source?.filePath).toBe(WAV_NEXT_LAUNCH)
      expect(useAudioStore.getState().source?.fileName).toBe('stream.flv')
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })

    it('an original that moved is named once for both studios', async () => {
      await cleanAudioSession()
      const saved = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
      wipeAllStudios()
      bridge({ gone: [ORIGINAL] })
      const outcome = await applyProject(saved)
      expect(describeUnavailableSources(outcome.unavailable)).toBe(
        "Couldn't find stream.flv. It may have been moved or deleted. " +
          'The rest of your project is open — load the video again in Video Studio ' +
          'and the audio again in Audio Studio.'
      )
    })
  })
})

/**
 * T-112 — what a project open does while a long wait is running, and what it says
 * when it did not work.
 *
 * Three things the long re-convert / re-extract (T-99, T-107) made reachable:
 *
 *  - It takes minutes for a long VOD, and the app is not locked meanwhile: the
 *    person can close the video and drop a different one. The conversion then
 *    finished and `loadSource` replaced THEIR video with the project's — source,
 *    clips and captions, undo history gone. The guard captures what the studio holds
 *    before the wait and skips the apply when it holds something else after.
 *  - "Couldn't find X. It may have been moved or deleted." was said of EVERY failure
 *    of the load; it is true of one (the file is not there).
 *  - The sound's re-extract waits as long as the conversion and showed nothing.
 */
describe('applyProject over a long wait (T-112)', () => {
  const ORIGINAL = '/home/user/Videos/stream.flv'
  const COPY = '/tmp/imagii-import/stream-kQ9rS1tU.mp4'
  const OTHER_VIDEO = '/home/user/Videos/other.mp4'
  const OTHER_AUDIO = '/home/user/Audio/other.wav'
  const WAV = '/tmp/imagii-audio/kQ9rS1tU3v.wav'

  interface Gate<T> {
    promise: Promise<T>
    resolve: (v: T) => void
    reject: (e: unknown) => void
  }
  function gate<T>(): Gate<T> {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  // `userFacingError` writes the raw error to the console (the contract that makes the plain
  // sentence safe); these cases make it do so on purpose, so they hold it and read it back.
  let consoleError: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    consoleError.mockRestore()
  })

  /** The bridge with the conversion and the extraction held open by the test. */
  function heldBridge(): { converting: Gate<string>; extracting: Gate<ExtractedSound>; probed: string[] } {
    const converting = gate<string>()
    const extracting = gate<ExtractedSound>()
    const probed: string[] = []
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (p: string) => {
            probed.push(p)
            return Promise.resolve(VIDEO_PROBE)
          },
          fileUrl: (p: string) => pathToImagiiFileUrl(p),
          convertForImport: () => converting.promise
        },
        audio: {
          ...PEAKS_BRIDGE,
          probe: (_p: string) => Promise.resolve(AUDIO_PROBE),
          extractFromVideo: () => extracting.promise
        }
      }
    })
    return { converting, extracting, probed }
  }

  /** A saved session of a converted import whose sound came from it. */
  function savedConvertedProject(): ImagiiProject {
    return {
      schemaVersion: MAX_SCHEMA_VERSION,
      savedAt: 1_700_000_000_000,
      appVersion: '1.0.0',
      videoStudio: {
        sourcePath: ORIGINAL,
        convertedForImport: true,
        clips: [CLIP_A, CLIP_B],
        selectedClipId: CLIP_B.id,
        watermark: null,
        srtPath: SRT_PATH
      },
      audioStudio: { sourcePath: ORIGINAL, extractedFromVideo: true, chain: CHAIN }
    }
  }

  describe('a different source loaded during the wait is never clobbered', () => {
    it('a video dropped while the project converts keeps its source, its clip and its history', async () => {
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject())
      await tick()

      // The person closes nothing and drops a different video; it loads at once.
      await useVideoStore.getState().loadSource(OTHER_VIDEO)
      const theirs = useVideoStore.getState().source
      const theirClips = useVideoStore.getState().clips

      held.converting.resolve(COPY)
      held.extracting.resolve(sound(WAV))
      const outcome = await pending

      expect(useVideoStore.getState().source).toBe(theirs)
      expect(useVideoStore.getState().source?.filePath).toBe(OTHER_VIDEO)
      expect(useVideoStore.getState().clips).toBe(theirClips)
      expect(useVideoStore.getState().srtPath).toBeNull()
      // The project's converted copy was never even probed.
      expect(held.probed).not.toContain(COPY)
      expect(outcome.skipped).toEqual(['video'])
      expect(outcome.unavailable).toEqual([])
      expect(outcome.failed).toEqual([])
    })

    it('skipping the video does not skip the rest: the sound, when nothing changed there, still opens', async () => {
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject())
      await tick()
      await useVideoStore.getState().loadSource(OTHER_VIDEO)
      held.converting.resolve(COPY)
      await tick()
      held.extracting.resolve(sound(WAV))
      const outcome = await pending

      expect(outcome.skipped).toEqual(['video'])
      expect(useAudioStore.getState().source?.filePath).toBe(WAV)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })

    it('a sound loaded while the project extracts is skipped, with its own chain left alone', async () => {
      const held = heldBridge()
      const pending = applyProject({ ...savedConvertedProject(), videoStudio: undefined })
      await tick()
      await useAudioStore.getState().loadSource(OTHER_AUDIO)
      const theirs = useAudioStore.getState().source
      useAudioStore.setState({ chain: { ...DEFAULT_CHAIN_FOR_TEST, gainDb: 3 } })

      held.extracting.resolve(sound(WAV))
      const outcome = await pending

      expect(useAudioStore.getState().source).toBe(theirs)
      expect(useAudioStore.getState().chain.gainDb).toBe(3)
      expect(outcome.skipped).toEqual(['audio'])
      expect(outcome.unavailable).toEqual([])
    })

    it('control: when the person did nothing, the project replaces what was open — that is what Open project means', async () => {
      const held = heldBridge()
      await useVideoStore.getState().loadSource(OTHER_VIDEO)
      await useAudioStore.getState().loadSource(OTHER_AUDIO)
      const pending = applyProject(savedConvertedProject())
      await tick()
      held.converting.resolve(COPY)
      await tick()
      held.extracting.resolve(sound(WAV))
      const outcome = await pending

      expect(outcome.skipped).toEqual([])
      expect(useVideoStore.getState().source?.filePath).toBe(COPY)
      expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
      expect(useAudioStore.getState().source?.filePath).toBe(WAV)
    })

    it('control: closing what was open during the wait is not "opening something else" — the project still opens', async () => {
      const held = heldBridge()
      await useVideoStore.getState().loadSource(OTHER_VIDEO)
      const pending = applyProject({ ...savedConvertedProject(), audioStudio: undefined })
      await tick()
      useVideoStore.getState().clearSource()
      held.converting.resolve(COPY)
      const outcome = await pending

      expect(outcome.skipped).toEqual([])
      expect(useVideoStore.getState().source?.filePath).toBe(COPY)
    })
  })

  describe('only a file that is not there reads "moved or deleted"', () => {
    function failingBridge(convertError: Error | null, extractError: Error | null): void {
      vi.stubGlobal('window', {
        api: {
          video: {
            probe: () => Promise.resolve(VIDEO_PROBE),
            fileUrl: (p: string) => pathToImagiiFileUrl(p),
            convertForImport: () =>
              convertError ? Promise.reject(convertError) : Promise.resolve(COPY)
          },
          audio: {
            ...PEAKS_BRIDGE,
            probe: () => Promise.resolve(AUDIO_PROBE),
            extractFromVideo: () => (extractError ? Promise.reject(extractError) : Promise.resolve(sound(WAV)))
          }
        }
      })
    }

    it('a missing original is "Couldn\'t find…" (the sentence is true of it)', async () => {
      failingBridge(new Error(`convert-to-mp4 exit 1: ${ORIGINAL}: No such file or directory`), null)
      const outcome = await applyProject({ ...savedConvertedProject(), audioStudio: undefined })
      expect(outcome.unavailable).toEqual([{ studio: 'video', path: ORIGINAL, fileName: 'stream.flv' }])
      expect(outcome.failed).toEqual([])
      expect(describeApplyOutcome(outcome, 'project')).toMatch(/^Couldn't find stream\.flv\. It may have been moved or deleted\./)
    })

    it('a conversion that failed on a damaged file says what is wrong with the FILE, not that it is gone', async () => {
      failingBridge(new Error('convert-to-mp4 exit 1: Invalid data found when processing input'), null)
      const outcome = await applyProject({ ...savedConvertedProject(), audioStudio: undefined })
      expect(outcome.unavailable).toEqual([])
      expect(outcome.failed).toHaveLength(1)
      expect(outcome.failed[0]?.message).toBe(
        "Couldn't open stream.flv. That file looks damaged or isn't a format imagii can read."
      )
      const sentence = describeApplyOutcome(outcome, 'project') ?? ''
      expect(sentence).toContain('damaged')
      expect(sentence).not.toMatch(/moved or deleted/)
      expect(sentence).toMatch(/The rest of your project is open\.$/)
    })

    it('a disk that filled up during the extraction says so', async () => {
      failingBridge(null, new Error("ENOSPC: no space left on device, write"))
      const outcome = await applyProject({ ...savedConvertedProject(), videoStudio: undefined })
      expect(outcome.unavailable).toEqual([])
      expect(outcome.failed[0]?.studio).toBe('audio')
      expect(outcome.failed[0]?.message).toBe(
        "Couldn't open stream.flv. Your disk is full. Free up some space and try again."
      )
    })

    it('what the failure was is still in the console, for a bug report', async () => {
      failingBridge(new Error('convert-to-mp4 exit 1: Invalid data found when processing input'), null)
      await applyProject({ ...savedConvertedProject(), audioStudio: undefined })
      expect(consoleError.mock.calls.flat().join(' ')).toContain('Invalid data found')
    })
  })

  describe('the sentence a caller toasts', () => {
    it('says nothing when everything opened', () => {
      expect(describeApplyOutcome({ unavailable: [], failed: [], skipped: [], superseded: false }, 'project')).toBeNull()
    })

    // T-113: a skip says what it left alone and how to get the skipped part back — it used to end
    // at "while it was loading.", which left the person to guess whether anything else had opened.
    it('names a skipped video, in the person\'s terms, and how to get it back', () => {
      expect(describeApplyOutcome({ unavailable: [], failed: [], skipped: ['video'], superseded: false }, 'project')).toBe(
        "Skipped the project's video because you opened another video while it was loading. " +
          'The rest of your project is open. Open the project again to bring its video back.'
      )
    })

    it('names a skipped sound, and both when both were skipped', () => {
      expect(describeApplyOutcome({ unavailable: [], failed: [], skipped: ['audio'], superseded: false }, 'project')).toBe(
        "Skipped the project's audio because you opened another audio file while it was loading. " +
          'The rest of your project is open. Open the project again to bring its audio back.'
      )
      expect(describeApplyOutcome({ unavailable: [], failed: [], skipped: ['video', 'audio'], superseded: false }, 'project')).toBe(
        "Skipped the project's video because you opened another video while it was loading. " +
          "Skipped the project's audio because you opened another audio file while it was loading. " +
          'The rest of your project is open. Open the project again to bring its video and audio back.'
      )
    })

    it('puts a missing file and a skipped one side by side, saying the rest is open once', () => {
      const text = describeApplyOutcome({
        unavailable: [{ studio: 'audio', path: '/a/mic.wav', fileName: 'mic.wav' }],
        failed: [],
        skipped: ['video'], superseded: false
      }, 'project')
      expect(text).toBe(
        "Couldn't find mic.wav. It may have been moved or deleted. " +
          'The rest of your project is open — load the audio again in Audio Studio. ' +
          "Skipped the project's video because you opened another video while it was loading. " +
          'Open the project again to bring its video back.'
      )
      expect(text?.match(/rest of your project is open/g)).toHaveLength(1)
    })

    it('a failure plus a skip says the rest is open once, too', () => {
      const text = describeApplyOutcome({
        unavailable: [],
        failed: [{ studio: 'audio', path: '/a/mic.wav', fileName: 'mic.wav', message: 'That file looks damaged.' }],
        skipped: ['video'], superseded: false
      }, 'project')
      expect(text?.match(/rest of your project is open/gi)).toHaveLength(1)
      expect(text).toContain('Open the project again to bring its video back.')
    })
  })

  // T-114: the autosave Restore used to toast the project's sentence. There is no project FILE behind an
  // autosave, "Open the project again" has nothing to open, and the way back it promised does not exist:
  // `applyProjectHeld` saves a change made during the wait the moment the hold lifts, and opening
  // another video IS that change - so the autosave file is replaced by what is open now. The skip
  // sentence for an autosave says that, plainly.
  describe('the same outcome, said for an autosave Restore (T-114)', () => {
    const skipped = (...studios: Array<'video' | 'audio'>) => ({ unavailable: [], failed: [], skipped: studios, superseded: false })

    it('a skipped video: no project to open again, and what happens to its clips', () => {
      expect(describeApplyOutcome(skipped('video'), 'autosave')).toBe(
        "Skipped the autosave's video because you opened another video while it was loading. " +
          'The rest of your work is open. ' +
          'Your autosave now holds what you have open, so the video and its clips will not come back from it.'
      )
    })

    it('a skipped sound, and both', () => {
      expect(describeApplyOutcome(skipped('audio'), 'autosave')).toBe(
        "Skipped the autosave's audio because you opened another audio file while it was loading. " +
          'The rest of your work is open. ' +
          'Your autosave now holds what you have open, so the audio and its settings will not come back from it.'
      )
      expect(describeApplyOutcome(skipped('video', 'audio'), 'autosave')).toBe(
        "Skipped the autosave's video because you opened another video while it was loading. " +
          "Skipped the autosave's audio because you opened another audio file while it was loading. " +
          'The rest of your work is open. ' +
          'Your autosave now holds what you have open, so the video and its clips, and the audio and its settings, will not come back from it.'
      )
    })

    it('never sends the person to a project file that does not exist', () => {
      for (const studios of [['video'], ['audio'], ['video', 'audio']] as const) {
        const text = describeApplyOutcome(skipped(...studios), 'autosave') ?? ''
        expect(text, studios.join('+')).not.toMatch(/Open the project/)
        expect(text, studios.join('+')).not.toMatch(/the project's/)
        expect(text, studios.join('+')).not.toMatch(/bring its/)
      }
    })

    it('says the rest is open once, beside a missing file and a failure', () => {
      const text = describeApplyOutcome(
        {
          unavailable: [{ studio: 'audio', path: '/a/mic.wav', fileName: 'mic.wav' }],
          failed: [],
          skipped: ['video'], superseded: false
        },
        'autosave'
      )
      expect(text).toBe(
        "Couldn't find mic.wav. It may have been moved or deleted. " +
          'The rest of your project is open \u2014 load the audio again in Audio Studio. ' +
          "Skipped the autosave's video because you opened another video while it was loading. " +
          'Your autosave now holds what you have open, so the video and its clips will not come back from it.'
      )
    })

    it('says nothing different when nothing was skipped: a missing file reads the same for both callers', () => {
      const outcome = { unavailable: [{ studio: 'video' as const, path: '/v/s.flv', fileName: 's.flv' }], failed: [], skipped: [], superseded: false }
      expect(describeApplyOutcome(outcome, 'autosave')).toBe(describeApplyOutcome(outcome, 'project'))
      expect(describeApplyOutcome({ unavailable: [], failed: [], skipped: [], superseded: false }, 'autosave')).toBeNull()
    })
  })

  describe('the sound\'s re-extract waits out loud, like the conversion above it', () => {
    const spyLoading = () => vi.spyOn(toast, 'loading').mockImplementation(() => 'id')
    const spyDismiss = () => vi.spyOn(toast, 'dismiss').mockImplementation(() => undefined)
    let loading: ReturnType<typeof spyLoading>
    let dismiss: ReturnType<typeof spyDismiss>
    beforeEach(() => {
      loading = spyLoading()
      dismiss = spyDismiss()
    })
    afterEach(() => {
      loading.mockRestore()
      dismiss.mockRestore()
    })

    it('shows "Extracting audio…" under an id while the sound is extracted, and takes it down after', async () => {
      const held = heldBridge()
      const pending = applyProject({ ...savedConvertedProject(), videoStudio: undefined })
      await tick()
      expect(loading).toHaveBeenCalledTimes(1)
      const [message, options] = loading.mock.calls[0] as unknown as [string, { id?: string }]
      expect(message).toBe('Extracting audio…')
      expect(typeof options.id).toBe('string')
      // Still up: the extraction has not finished.
      expect(dismiss).not.toHaveBeenCalled()

      held.extracting.resolve(sound(WAV))
      await pending
      expect(dismiss).toHaveBeenCalledWith(options.id)
    })

    it('takes it down when the extraction FAILS too (a finally, not a success path)', async () => {
      const held = heldBridge()
      const pending = applyProject({ ...savedConvertedProject(), videoStudio: undefined })
      await tick()
      const [, options] = loading.mock.calls[0] as unknown as [string, { id?: string }]
      held.extracting.reject(new Error('audio extract exit 1: Invalid data found when processing input'))
      await pending
      expect(dismiss).toHaveBeenCalledWith(options.id)
    })

    it('a plain audio file, which is only probed, shows no extraction toast', async () => {
      heldBridge()
      await applyProject({
        schemaVersion: MAX_SCHEMA_VERSION,
        savedAt: 1,
        appVersion: '1.0.0',
        audioStudio: { sourcePath: AUDIO_PATH, chain: CHAIN }
      })
      expect(loading).not.toHaveBeenCalled()
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T-113 (11) — the ProjectIO cluster.
// ───────────────────────────────────────────────────────────────────────────
describe('applyProject, second pass (T-113)', () => {
  const ORIGINAL = '/home/user/Videos/stream.flv'
  const COPY = '/tmp/imagii-import/stream-kQ9rS1tU.mp4'
  const OTHER_VIDEO = '/home/user/Videos/other.mp4'
  const OTHER_AUDIO = '/home/user/Audio/other.wav'
  const WAV = '/tmp/imagii-audio/kQ9rS1tU3v.wav'
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  function gate<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  function heldBridge(gone: string[] = []): { converting: ReturnType<typeof gate<string>>; extracting: ReturnType<typeof gate<ExtractedSound>> } {
    const converting = gate<string>()
    const extracting = gate<ExtractedSound>()
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (p: string) =>
            gone.includes(p)
              ? Promise.reject(new Error(`ffprobe exit 1: ${p}: No such file or directory`))
              : Promise.resolve(VIDEO_PROBE),
          fileUrl: (p: string) => pathToImagiiFileUrl(p),
          convertForImport: () => converting.promise
        },
        audio: {
          ...PEAKS_BRIDGE,
          probe: (_p: string) => Promise.resolve(AUDIO_PROBE),
          extractFromVideo: () => extracting.promise
        }
      }
    })
    return { converting, extracting }
  }

  function savedConvertedProject(extra: Partial<ImagiiProject> = {}): ImagiiProject {
    return {
      schemaVersion: MAX_SCHEMA_VERSION,
      savedAt: 1_700_000_000_000,
      appVersion: '1.0.0',
      videoStudio: {
        sourcePath: ORIGINAL,
        convertedForImport: true,
        clips: [CLIP_A, CLIP_B],
        selectedClipId: CLIP_B.id,
        watermark: null,
        srtPath: SRT_PATH
      },
      audioStudio: { sourcePath: ORIGINAL, extractedFromVideo: true, chain: CHAIN },
      ...extra
    }
  }

  let consoleError: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    consoleError.mockRestore()
  })

  describe('(a) the sound is guarded from the START, not from when its turn comes', () => {
    it('audio the person opened and tuned during the VIDEO\'s wait is not wiped by the project\'s sound', async () => {
      // The video converts for minutes; the sound's baseline used to be taken only after that wait,
      // so a sound opened meanwhile WAS the baseline and the project's replaced it without a word.
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject())
      await tick()

      await useAudioStore.getState().loadSource(OTHER_AUDIO)
      const theirs = useAudioStore.getState().source
      useAudioStore.setState({ chain: { ...DEFAULT_CHAIN_FOR_TEST, gainDb: 4 } })

      held.converting.resolve(COPY)
      await tick()
      held.extracting.resolve(sound(WAV))
      const outcome = await pending

      expect(useAudioStore.getState().source).toBe(theirs)
      expect(useAudioStore.getState().source?.filePath).toBe(OTHER_AUDIO)
      expect(useAudioStore.getState().chain.gainDb).toBe(4)
      expect(outcome.skipped).toEqual(['audio'])
      // The video, which nobody touched, still opened.
      expect(useVideoStore.getState().source?.filePath).toBe(COPY)
    })

    it('control: a sound that was already open before Open project is what the project replaces', async () => {
      const held = heldBridge()
      await useAudioStore.getState().loadSource(OTHER_AUDIO)
      const pending = applyProject(savedConvertedProject())
      await tick()
      held.converting.resolve(COPY)
      await tick()
      held.extracting.resolve(sound(WAV))
      const outcome = await pending
      expect(outcome.skipped).toEqual([])
      expect(useAudioStore.getState().source?.filePath).toBe(WAV)
    })
  })

  // T-135 (9): T-113's guard was written into `extractAgain` alone. The other two ways a project's sound opens - a plain audio file, and the scratch
  // WAV a v1-3 project wrote beside its video - called `loadSource` unguarded, so the same sound the person opened and tuned during the VIDEO's wait
  // was replaced by the project's (executed in a scratch repro with a deferred conversion; `skipped` stayed empty), against the rule's own comment.
  describe('(e) the sound that needs no wait of its own is guarded from the START too (T-135 (9))', () => {
    const PROJECT_AUDIO = '/home/user/Audio/project-sound.wav'
    const plainAudio = { sourcePath: PROJECT_AUDIO, chain: CHAIN }
    const scratchAudio = { sourcePath: WAV, fromVideoPath: ORIGINAL, chain: CHAIN }

    it.each([
      ['a plain audio file', plainAudio],
      ['the scratch WAV of a v1-3 project (and the video beside it)', scratchAudio]
    ])('%s: audio the person opened and tuned during the video\'s wait is not replaced, and the skip is reported', async (_label, audioStudio) => {
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject({ audioStudio }))
      await tick()

      await useAudioStore.getState().loadSource(OTHER_AUDIO)
      const theirs = useAudioStore.getState().source
      useAudioStore.setState({ chain: { ...DEFAULT_CHAIN_FOR_TEST, gainDb: 4 } })

      held.converting.resolve(COPY)
      const outcome = await pending

      expect(useAudioStore.getState().source, 'their sound is still the one open').toBe(theirs)
      expect(useAudioStore.getState().source?.filePath).toBe(OTHER_AUDIO)
      expect(useAudioStore.getState().chain.gainDb, 'and their tuning with it').toBe(4)
      expect(outcome.skipped, 'the skip is counted, not silent').toEqual(['audio'])
      expect(outcome.unavailable).toEqual([])
      expect(outcome.failed).toEqual([])
      // The video, which nobody touched, still opened.
      expect(useVideoStore.getState().source?.filePath).toBe(COPY)
    })

    it.each([
      ['a plain audio file', plainAudio, PROJECT_AUDIO],
      ['the scratch WAV of a v1-3 project', scratchAudio, WAV]
    ])('control, %s: a sound that was already open before Open project is what the project replaces', async (_label, audioStudio, opens) => {
      const held = heldBridge()
      await useAudioStore.getState().loadSource(OTHER_AUDIO)
      const pending = applyProject(savedConvertedProject({ audioStudio }))
      await tick()
      held.converting.resolve(COPY)
      const outcome = await pending
      expect(outcome.skipped).toEqual([])
      expect(useAudioStore.getState().source?.filePath).toBe(opens)
      expect(useAudioStore.getState().chain.gainDb, 'the project\'s chain came with it').toBe(CHAIN.gainDb)
    })

    it('control: a studio the person CLOSED during the wait is not "something else" - the project\'s sound opens in it', async () => {
      const held = heldBridge()
      await useAudioStore.getState().loadSource(OTHER_AUDIO)
      const pending = applyProject(savedConvertedProject({ audioStudio: plainAudio }))
      await tick()
      useAudioStore.getState().clearSource()
      held.converting.resolve(COPY)
      const outcome = await pending
      expect(outcome.skipped).toEqual([])
      expect(useAudioStore.getState().source?.filePath).toBe(PROJECT_AUDIO)
    })
  })

  describe('(b) the playhead and the clip selection belong to a video that actually opened', () => {
    const place = { videoClipId: CLIP_B.id, videoTimeSec: 42 }

    it('a video that is gone leaves the video the person has open alone', async () => {
      heldBridge([VIDEO_PATH])
      await useVideoStore.getState().loadSource(OTHER_VIDEO)
      useVideoStore.getState().requestSeek(5)
      const before = useVideoStore.getState().seekRequest
      const outcome = await applyProject({
        schemaVersion: MAX_SCHEMA_VERSION,
        savedAt: 1,
        appVersion: '1.0.0',
        videoStudio: { sourcePath: VIDEO_PATH, clips: [CLIP_A, CLIP_B], selectedClipId: CLIP_B.id, watermark: null },
        place
      })
      expect(outcome.unavailable).toHaveLength(1)
      // What the person has open was not seeked to 42 s of someone else's video.
      expect(useVideoStore.getState().seekRequest).toBe(before)
      expect(useVideoStore.getState().source?.filePath).toBe(OTHER_VIDEO)
    })

    it('a video that was skipped (the person opened another during the wait) is not seeked either', async () => {
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject({ audioStudio: undefined, place }))
      await tick()
      await useVideoStore.getState().loadSource(OTHER_VIDEO)
      const before = useVideoStore.getState().seekRequest
      held.converting.resolve(COPY)
      const outcome = await pending
      expect(outcome.skipped).toEqual(['video'])
      expect(useVideoStore.getState().seekRequest).toBe(before)
      expect(useVideoStore.getState().selectedClipId).not.toBe(CLIP_B.id)
    })

    it('control: a video that opened is seeked and its clip selected', async () => {
      heldBridge()
      await applyProject({
        schemaVersion: MAX_SCHEMA_VERSION,
        savedAt: 1,
        appVersion: '1.0.0',
        videoStudio: { sourcePath: VIDEO_PATH, clips: [CLIP_A, CLIP_B], selectedClipId: CLIP_A.id, watermark: null },
        place
      })
      expect(useVideoStore.getState().selectedClipId).toBe(CLIP_B.id)
      expect(useVideoStore.getState().seekRequest?.seconds).toBe(42)
    })

    it('the canvas and references parts of the place do not depend on the video', async () => {
      heldBridge([VIDEO_PATH])
      await applyProject({
        schemaVersion: MAX_SCHEMA_VERSION,
        savedAt: 1,
        appVersion: '1.0.0',
        imageCanvas: { doc: DOC },
        videoStudio: { sourcePath: VIDEO_PATH, clips: [CLIP_A], selectedClipId: CLIP_A.id, watermark: null },
        place: { canvasLayerId: 'layer-text', referencesTab: 'assets', videoTimeSec: 42 }
      })
      expect(useCanvasStore.getState().selectedLayerId).toBe('layer-text')
      expect(useReferencesStore.getState().tab).toBe('assets')
    })
  })

  describe('(c) the reopen conversion has its own toast, apart from the importer\'s', () => {
    const spyLoading = () => vi.spyOn(toast, 'loading').mockImplementation(() => 'id')
    const spyDismiss = () => vi.spyOn(toast, 'dismiss').mockImplementation(() => undefined)
    let loading: ReturnType<typeof spyLoading>
    let dismiss: ReturnType<typeof spyDismiss>
    beforeEach(() => {
      loading = spyLoading()
      dismiss = spyDismiss()
    })
    afterEach(() => {
      loading.mockRestore()
      dismiss.mockRestore()
    })

    it('shows "Converting for editing…" under "reopen-convert" and takes down only that id', async () => {
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject({ audioStudio: undefined }))
      await tick()
      expect(loading).toHaveBeenCalledTimes(1)
      const [message, options] = loading.mock.calls[0] as unknown as [string, { id?: string }]
      expect(message).toBe('Converting for editing\u2026')
      // The Importer's own conversion is 'convert': one id for both made each dismiss the other's.
      expect(options.id).toBe('reopen-convert')
      expect(dismiss).not.toHaveBeenCalled()
      held.converting.resolve(COPY)
      await pending
      expect(dismiss).toHaveBeenCalledWith('reopen-convert')
      expect(dismiss).not.toHaveBeenCalledWith('convert')
    })

    it('takes it down when the conversion fails too', async () => {
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject({ audioStudio: undefined }))
      await tick()
      held.converting.reject(new Error('ffmpeg exit 1: Invalid data found'))
      await pending
      expect(dismiss).toHaveBeenCalledWith('reopen-convert')
    })
  })

  describe('(d) a skipped source says what else opened and how to get it back', () => {
    it('is the sentence Home and the autosave Restore toast, from a real skip', async () => {
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject({ audioStudio: undefined }))
      await tick()
      await useVideoStore.getState().loadSource(OTHER_VIDEO)
      held.converting.resolve(COPY)
      const outcome = await pending
      expect(describeApplyOutcome(outcome, 'project')).toBe(
        "Skipped the project's video because you opened another video while it was loading. " +
          'The rest of your project is open. Open the project again to bring its video back.'
      )
    })

    it('the autosave Restore says it without a project to open again (T-114)', async () => {
      const held = heldBridge()
      const pending = applyProject(savedConvertedProject({ audioStudio: undefined }))
      await tick()
      await useVideoStore.getState().loadSource(OTHER_VIDEO)
      held.converting.resolve(COPY)
      const outcome = await pending
      expect(describeApplyOutcome(outcome, 'autosave')).toBe(
        "Skipped the autosave's video because you opened another video while it was loading. " +
          'The rest of your work is open. ' +
          'Your autosave now holds what you have open, so the video and its clips will not come back from it.'
      )
    })
  })
})

/**
 * T-125 (7) - a sound pulled out of an AIFF or a WMA is not a video's.
 *
 * `.aiff`, `.aif` and `.wma` are audio files WebAudio cannot decode, so the importer sends them through the same extraction a
 * video's sound takes, and the store then called every extraction "from a video": Export defaulted to "Re-attach to video" and
 * failed on `-map 0:v:0` (there is no picture), a 3-hour AIFF was told to "export the part you want from Video Studio" (which
 * refuses a file with no picture and sends the person back: the circle T-124 (7) closed for plain audio), and the suggested name
 * was the scratch WAV's. The store keeps TWO things apart now: `fromVideo` is for a real video (the picture to re-attach to), and
 * `extractedFrom` is the file a non-video's sound was taken from (the header's name, and what a saved project stores to extract
 * again). The decision is `isVideoFilename`, in one place.
 */
describe('a sound extracted from an AIFF or a WMA is not a video\'s (T-125 (7))', () => {
  const WMA = '/home/user/Audio/take one.wma'
  const AIFF = '/home/user/Audio/pad.aiff'
  const WAV = '/tmp/imagii-audio/kQ9rS1tU3v.wav'
  let probeDuration = 120

  function bridge(): { extracted: string[] } {
    const extracted: string[] = []
    vi.stubGlobal('window', {
      api: {
        video: { probe: () => Promise.resolve(VIDEO_PROBE), fileUrl: (p: string) => pathToImagiiFileUrl(p) },
        audio: {
          ...PEAKS_BRIDGE,
          probe: () => Promise.resolve({ ...AUDIO_PROBE, duration: probeDuration }),
          extractFromVideo: (file: string) => {
            extracted.push(file)
            return Promise.resolve(sound(WAV))
          }
        }
      }
    })
    return { extracted }
  }

  beforeEach(() => {
    probeDuration = 120
  })

  it.each([
    ['.wma', WMA],
    ['.aiff', AIFF],
    ['.aif', '/home/user/Audio/pad.AIF']
  ])('a %s is not "from a video": no picture to re-attach to, and the header names the file', async (_label, file) => {
    bridge()
    await useAudioStore.getState().loadSource(WAV, file)
    const source = useAudioStore.getState().source
    expect(source?.fromVideo, 'Export would default to "Re-attach to video" and fail on -map 0:v:0').toBeNull()
    expect(source?.extractedFrom).toBe(file)
    expect(source?.fileName, 'the name the person gave it, not the scratch WAV\'s').toBe(file.slice(file.lastIndexOf('/') + 1))
    expect(source?.filePath).toBe(WAV)
  })

  it('a real video still is: the picture to re-attach to, and no second marker', async () => {
    bridge()
    for (const video of ['/home/user/Videos/stream.mp4', '/home/user/Videos/clip.MKV', '/home/user/Videos/old.wmv', '/home/user/Videos/take.webm']) {
      await useAudioStore.getState().loadSource(WAV, video)
      const source = useAudioStore.getState().source
      expect(source?.fromVideo, video).toEqual({ videoPath: video })
      expect(source?.extractedFrom, video).toBeNull()
    }
  })

  it('a converted import\'s original is still what a video\'s header names (T-107 is untouched)', async () => {
    bridge()
    await useAudioStore.getState().loadSource(WAV, '/tmp/imagii-import/stream-aB3dE5fG.mp4', '/home/user/Videos/stream.flv')
    const source = useAudioStore.getState().source
    expect(source?.fromVideo).toEqual({ videoPath: '/tmp/imagii-import/stream-aB3dE5fG.mp4', convertedFrom: '/home/user/Videos/stream.flv' })
    expect(source?.fileName).toBe('stream.flv')
  })

  it('a plain audio file has neither', async () => {
    bridge()
    await useAudioStore.getState().loadSource(AUDIO_PATH)
    expect(useAudioStore.getState().source).toMatchObject({ fromVideo: null, extractedFrom: null })
  })

  it('a project saves the WMA itself, with the marker that says "extract again", and no path into the temp folder', async () => {
    bridge()
    await useAudioStore.getState().loadSource(WAV, WMA)
    useAudioStore.setState({ chain: CHAIN })
    const captured = captureProject()
    expect(captured.audioStudio).toEqual({ sourcePath: WMA, extractedFromVideo: true, chain: CHAIN })
    expect(JSON.stringify(captured)).not.toContain('imagii-audio')
    expect(validateProject(captured)).toMatchObject({ ok: true })
  })

  it('save -> reopen: the sound is extracted again from the WMA and is STILL not a video\'s', async () => {
    bridge()
    await useAudioStore.getState().loadSource(WAV, WMA)
    useAudioStore.setState({ chain: CHAIN })
    const saved = JSON.parse(JSON.stringify(captureProject())) as ImagiiProject
    wipeAllStudios()
    const { extracted } = bridge()
    const outcome = await applyProject(saved)
    expect(outcome.unavailable).toEqual([])
    expect(extracted).toEqual([WMA])
    const source = useAudioStore.getState().source
    expect(source?.fromVideo).toBeNull()
    expect(source?.extractedFrom).toBe(WMA)
    expect(source?.fileName).toBe('take one.wma')
    expect(useAudioStore.getState().chain).toEqual(CHAIN)
  })

  // T-129 flips this pin: a sound file over two hours was refused (with the AIFF's own sentence, T-125 (7)); the ceiling is retired
  // with the renderer's decode, so both kinds of source open, and reopen from a project, at three hours.
  it('a sound file over two hours opens, as does a video\'s sound over two hours: no length ceiling (T-129)', async () => {
    bridge()
    probeDuration = 3 * 3600
    await useAudioStore.getState().loadSource(WAV, AIFF)
    expect(useAudioStore.getState().source).toMatchObject({ extractedFrom: AIFF, fromVideo: null })
    expect(useAudioStore.getState().source?.probe.duration).toBe(3 * 3600)
    await useAudioStore.getState().loadSource(WAV, '/home/user/Videos/vod.mp4')
    expect(useAudioStore.getState().source?.fromVideo).toEqual({ videoPath: '/home/user/Videos/vod.mp4' })
  })
})

/**
 * T-125 (20) - `replacedSince`: "did the person put something else in this studio while a long job ran". Opening a project used to
 * be its only reader; Clean audio's extraction (minutes for a long VOD) reads it too, so it is exported and held here.
 */
describe('replacedSince (T-112, T-113, T-125 (20))', () => {
  const A = { id: 'a' }
  const B = { id: 'b' }

  it('is false when the studio holds what it held: nothing, or the same object', () => {
    expect(replacedSince(null, null)).toBe(false)
    expect(replacedSince(A, A)).toBe(false)
  })

  it('is true when something was loaded where nothing was, or in place of what was there', () => {
    expect(replacedSince(null, A)).toBe(true)
    expect(replacedSince(A, B)).toBe(true)
  })

  it('a studio CLOSED meanwhile is not "something else": the result may still be opened', () => {
    expect(replacedSince(A, null)).toBe(false)
  })

  it('a reload of the same file counts: `loadSource` makes a new source object, and the person did something there', async () => {
    vi.stubGlobal('window', {
      api: { audio: { ...PEAKS_BRIDGE, probe: () => Promise.resolve(AUDIO_PROBE) }, video: { fileUrl: (p: string) => pathToImagiiFileUrl(p) } }
    })
    await useAudioStore.getState().loadSource(AUDIO_PATH)
    const held = useAudioStore.getState().source
    await useAudioStore.getState().loadSource(AUDIO_PATH)
    expect(replacedSince(held, useAudioStore.getState().source)).toBe(true)
  })
})

/**
 * T-132 (11) - `audioSettled`: "Project loaded" / "Restored from autosave" were said the moment `applyProject` returned, but the sound it
 * opened is drawn AFTER that (T-129), and a file main then refuses is let go of with an error. The green line waits for the waveform of
 * the sound THIS open put in Audio Studio (`outcome.audioOpened`); a project that opened no sound has nothing to wait for.
 */
describe('audioSettled - a project open is only good news once the sound it opened has its waveform (T-132 (11))', () => {
  let peaksAnswer: () => Promise<unknown>
  const project = (): ImagiiProject =>
    ({ schemaVersion: 4, savedAt: 0, appVersion: '1.0.0', audioStudio: { sourcePath: AUDIO_PATH, chain: DEFAULT_CHAIN_FOR_TEST } }) as unknown as ImagiiProject
  beforeEach(() => {
    peaksAnswer = () => Promise.resolve({ peaks: [[0.5], [-0.5]], duration: 120 })
    vi.stubGlobal('window', {
      api: {
        audio: { ...PEAKS_BRIDGE, peaks: () => peaksAnswer(), probe: () => Promise.resolve(AUDIO_PROBE) },
        video: { fileUrl: (p: string) => pathToImagiiFileUrl(p) }
      }
    })
    useAudioStore.getState().clearSource()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a project with no sound has nothing to wait for', async () => {
    const outcome = await applyProject({ schemaVersion: 4, savedAt: 0, appVersion: '1.0.0' } as unknown as ImagiiProject)
    expect(outcome.audioOpened).toBeUndefined()
    expect(await audioSettled(outcome)).toBe(true)
  })

  it('records the sound the open put in Audio Studio, and is true when its waveform arrives', async () => {
    let answer: (v: unknown) => void = () => undefined
    peaksAnswer = () => new Promise((resolve) => { answer = resolve })
    const outcome = await applyProject(project())
    expect(outcome.audioOpened, 'the source this open loaded').toBe(useAudioStore.getState().source)
    let verdict: boolean | null = null
    void audioSettled(outcome).then((v) => { verdict = v })
    await new Promise((r) => setTimeout(r, 0))
    expect(verdict, 'still being read').toBeNull()
    answer({ peaks: [[0.5], [-0.5]], duration: 120 })
    await new Promise((r) => setTimeout(r, 0))
    expect(verdict).toBe(true)
  })

  it('is false when the sound the open put there is refused - even when the refusal landed before anyone asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    peaksAnswer = () => Promise.reject(new Error('Error invoking remote method \'audio:peaks\': Error: imagii couldn\'t read the sound in this file to draw its waveform.'))
    const outcome = await applyProject(project())
    await new Promise((r) => setTimeout(r, 0))
    expect(useAudioStore.getState().source, 'the studio already let go of it').toBeNull()
    expect(outcome.audioOpened, 'but the open recorded what it opened').toBeDefined()
    expect(await audioSettled(outcome)).toBe(false)
  })

  it('a sound that could not be opened at all is the outcome\'s own business (a file that is gone), and records nothing', async () => {
    vi.stubGlobal('window', {
      api: { audio: { ...PEAKS_BRIDGE, probe: () => Promise.reject(new Error('ffprobe exit 1: /home/user/Audio/mic.wav: No such file or directory')) }, video: { fileUrl: (p: string) => pathToImagiiFileUrl(p) } }
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const outcome = await applyProject(project())
    expect(outcome.unavailable).toHaveLength(1)
    expect(outcome.audioOpened).toBeUndefined()
  })
})

/**
 * T-132 (1) - `currentRoute`: where the person is RIGHT NOW, for code that outlives the component that started it. Clean audio's
 * extraction takes minutes; what decides whether the result may take the person to Audio Studio is the screen they are on when it ends.
 */
describe('currentRoute - the screen on display, read off the router\'s hash (T-47, T-132 (1))', () => {
  const at = (hash: string): string | undefined => {
    vi.stubGlobal('window', { location: { hash } })
    return currentRoute()
  }
  it.each([['#/video', '/video'], ['#/record', '/record'], ['#/audio', '/audio'], ['#/image', '/image'], ['#/references', '/references'], ['#/home', '/home']])(
    '%s is %s',
    (hash, route) => {
      expect(at(hash)).toBe(route)
    }
  )

  it('is undefined for anything that is not one of the app\'s routes, or no hash at all', () => {
    expect(at('')).toBeUndefined()
    expect(at('#')).toBeUndefined()
    expect(at('#/nowhere')).toBeUndefined()
    expect(at('#/video/extra')).toBeUndefined()
    expect(at('#/video?x=1')).toBeUndefined()
  })

  it('is undefined with no window at all (a plain function can be called anywhere)', () => {
    vi.stubGlobal('window', undefined)
    expect(currentRoute()).toBeUndefined()
  })
})

const DEFAULT_CHAIN_FOR_TEST: ChainSpec = {
  denoise: 'off',
  hum60: false,
  rumbleHighpass: false,
  deEss: false,
  compressor: 'off',
  loudnorm: false,
  loudnormTargetLufs: -16,
  gainDb: 0,
  cutRegions: [],
  secondaryTrack: null
}

/**
 * T-136 (2) - the project open's re-convert goes through the same `video:convertForImport` as the importer's and the preview copy's, so main's
 * one-conversion-at-a-time refusal can reach it: a project whose video is a converted import, opened while another conversion runs. The refusal is a
 * finished sentence naming the file that is being converted (`videoConvertSingleFlight.test.ts`), and `loadReporting` is where a failed studio is
 * reported: it must stand as written, name no missing file ("moved or deleted" would be false), leave the video studio as it was, and let the rest of
 * the project open. The comment in `applyProject` that said the conversion and Clean audio's extraction "can run beside" each other was true only
 * until T-135 (1) gave each a single slot in main.
 */
describe('applyProject when main refuses a second conversion (T-136 (2))', () => {
  const ORIGINAL = '/home/user/Videos/stream.flv'
  const BUSY = 'Still converting "other-stream.flv". Wait for it to finish, then try again.'

  let consoleError: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    consoleError.mockRestore()
  })

  function projectWithConvertedVideo(): ImagiiProject {
    return {
      schemaVersion: MAX_SCHEMA_VERSION,
      savedAt: 1_700_000_000_000,
      appVersion: '1.0.0',
      videoStudio: { sourcePath: ORIGINAL, convertedForImport: true, clips: [CLIP_A], selectedClipId: CLIP_A.id, watermark: null, srtPath: null },
      imageCanvas: { doc: DOC }
    }
  }

  function refusingBridge(message: string): void {
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (_p: string) => Promise.resolve(VIDEO_PROBE),
          fileUrl: (p: string) => pathToImagiiFileUrl(p),
          // Electron wraps what a handler throws, as it does for every channel.
          convertForImport: () => Promise.reject(new Error(`Error invoking remote method 'video:convertForImport': Error: ${message}`))
        },
        audio: { ...PEAKS_BRIDGE, probe: (_p: string) => Promise.resolve(AUDIO_PROBE) }
      }
    })
  }

  it('reports the refusal as a failure in main\'s own words, not as a file that is gone, and opens the rest', async () => {
    refusingBridge(BUSY)
    const outcome = await applyProject(projectWithConvertedVideo())
    expect(outcome.unavailable, 'the file is not missing').toEqual([])
    expect(outcome.skipped).toEqual([])
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]?.studio).toBe('video')
    expect(outcome.failed[0]?.message, 'the finished sentence stands as written: no envelope, no "Couldn\'t open" in front of it').toBe(BUSY)
    expect(useVideoStore.getState().source, 'the video studio is left as it was').toBeNull()
    expect(useCanvasStore.getState().doc.layers.length, 'and the rest of the project opened').toBe(DOC.layers.length)
  })

  it('the person reads that sentence, then that the rest is open - and is not told the file moved', async () => {
    refusingBridge(BUSY)
    const message = describeApplyOutcome(await applyProject(projectWithConvertedVideo()), 'project')
    expect(message).toContain(BUSY)
    expect(message).toContain('The rest of your project is open')
    expect(message).not.toMatch(/moved or deleted|Couldn't find/)
  })

  it('a refusal from main does not touch a video the person already has open', async () => {
    refusingBridge(BUSY)
    await useVideoStore.getState().loadSource('/home/user/Videos/open.mp4')
    const held = useVideoStore.getState().source
    await applyProject(projectWithConvertedVideo())
    expect(useVideoStore.getState().source).toBe(held)
  })
})

// T-140 (6): a conversion or an extraction that lands while the person is on Home fills a studio under a banner that mounted over an empty session, and Restore
// then vanished with nothing restored and no word. The banner now hears the stores `sessionHoldsWork` reads, and the press-time backstop, if it still fires, says
// what is open and that nothing was restored.
describe('subscribeSessionStores: the stores sessionHoldsWork reads, as something a banner can listen to (T-140 (6))', () => {
  it('runs the listener for a change in each of the three stores, and the work test is already true inside it', async () => {
    const seen: boolean[] = []
    const off = subscribeSessionStores(() => seen.push(sessionHoldsWork()))
    await useVideoStore.getState().loadSource(VIDEO_PATH)
    expect(seen.length, 'the video store').toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(true)
    wipeAllStudios()
    seen.length = 0
    await useAudioStore.getState().loadSource(AUDIO_PATH)
    expect(seen.length, 'the audio store').toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(true)
    wipeAllStudios()
    seen.length = 0
    useCanvasStore.getState().setDocument(DOC)
    expect(seen.length, 'the canvas store').toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(true)
    off()
  })

  it('stops when told to: a change after the way back is not heard', async () => {
    let heard = 0
    const off = subscribeSessionStores(() => (heard += 1))
    useCanvasStore.getState().setDocument(DOC)
    const before = heard
    expect(before).toBeGreaterThan(0)
    off()
    useCanvasStore.getState().resetDocument()
    await useAudioStore.getState().loadSource(AUDIO_PATH)
    await useVideoStore.getState().loadSource(VIDEO_PATH)
    expect(heard, 'nothing after off()').toBe(before)
  })
})

describe('describeRestoreRefused: the one sentence when Restore finds the session holding work (T-140 (6))', () => {
  const base = { schemaVersion: MAX_SCHEMA_VERSION, savedAt: 1_700_000_000_000, appVersion: '1.0.0' } as const
  const video: NonNullable<ImagiiProject['videoStudio']> = { sourcePath: VIDEO_PATH, clips: [], selectedClipId: null, watermark: null, srtPath: null }
  const audio: NonNullable<ImagiiProject['audioStudio']> = { sourcePath: AUDIO_PATH, chain: CHAIN }
  const canvas: NonNullable<ImagiiProject['imageCanvas']> = { doc: DOC }

  it.each([
    ['a video', { videoStudio: video }, 'Nothing was restored: a video is open now, and restoring would replace it.'],
    ['audio', { audioStudio: audio }, 'Nothing was restored: audio is open now, and restoring would replace it.'],
    ['a canvas', { imageCanvas: canvas }, 'Nothing was restored: a Stream Graphics canvas is open now, and restoring would replace it.'],
    ['a video and audio', { videoStudio: video, audioStudio: audio }, 'Nothing was restored: a video and audio are open now, and restoring would replace them.'],
    ['a video and a canvas', { videoStudio: video, imageCanvas: canvas }, 'Nothing was restored: a video and a Stream Graphics canvas are open now, and restoring would replace them.'],
    [
      'all three',
      { videoStudio: video, audioStudio: audio, imageCanvas: canvas },
      'Nothing was restored: a video, audio and a Stream Graphics canvas are open now, and restoring would replace them.'
    ]
  ])('names what is open: %s', (_label, studios, sentence) => {
    expect(describeRestoreRefused({ ...base, ...studios })).toBe(sentence)
  })

  it('is one finished line a toast shows as written: at most 240 characters, no line break, a period at the end - for every combination', () => {
    const studios = [{ videoStudio: video }, { audioStudio: audio }, { imageCanvas: canvas }]
    for (let mask = 1; mask < 8; mask++) {
      const project = studios.reduce<ImagiiProject>((acc, s, i) => ((mask >> i) & 1 ? { ...acc, ...s } : acc), { ...base })
      const sentence = describeRestoreRefused(project)
      expect(sentence.length, sentence).toBeLessThanOrEqual(240)
      expect(sentence).not.toContain('\n')
      expect(sentence).toMatch(/\.$/)
      expect(sentence.startsWith('Nothing was restored: ')).toBe(true)
    }
  })

  it('reads the live session when it is given none: what the stores hold is what it names', async () => {
    useCanvasStore.getState().setDocument(DOC)
    expect(describeRestoreRefused()).toBe('Nothing was restored: a Stream Graphics canvas is open now, and restoring would replace it.')
    await useVideoStore.getState().loadSource(VIDEO_PATH)
    expect(describeRestoreRefused()).toBe('Nothing was restored: a video and a Stream Graphics canvas are open now, and restoring would replace them.')
  })

  it('a session that holds nothing still gets a true sentence (the backstop is only asked when it does, but the words must not say "undefined")', () => {
    const sentence = describeRestoreRefused({ ...base })
    expect(sentence).not.toMatch(/undefined|null/)
    expect(sentence).toBe('Nothing was restored: your work is open now, and restoring would replace it.')
  })
})

/**
 * T-153 (8) - a clip with no length restores with the floor every range edit holds. v1.6.0's I and O keys wrote [0, 0] and [D, D] (the validator checks
 * finiteness only), and every output of such a clip said only "Export failed.". The source's duration (VIDEO_PROBE: 120 s) is known once `loadSource` has
 * answered, and that is when the restore floors each clip.
 */
describe('applyProject floors a clip with no length once the source is known (T-153 (8))', () => {
  const clip = (id: string, startSec: number, endSec: number): Clip => ({ id, name: id, startSec, endSec, cropRect: null, textOverlays: [], selectedPresets: ['youtube'] })
  const projectWith = (clips: Clip[], extra: Partial<NonNullable<ImagiiProject['videoStudio']>> = {}): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    videoStudio: { sourcePath: VIDEO_PATH, clips, selectedClipId: clips[0]?.id ?? null, watermark: null, srtPath: null, ...extra }
  })

  it('[0, 0] and [D, D] come back as [0, 0.1] and [D - 0.1, D]; everything else about the clip is as saved', async () => {
    const saved = [clip('start', 0, 0), clip('end', 120, 120), clip('mid', 30, 30)]
    await applyProject(projectWith(saved))
    const { clips } = useVideoStore.getState()
    expect(clips.map((c) => [c.startSec, c.endSec])).toEqual([[0, 0.1], [120 - 0.1, 120], [30, 30.1]])
    expect(clips.map((c) => c.id)).toEqual(['start', 'end', 'mid'])
    expect(clips[0]).toEqual({ ...saved[0], endSec: 0.1 })
  })

  it('a clip with length is untouched, even one past the end of a source that got shorter (T-133 (4): Burn says so in a sentence)', async () => {
    await applyProject(projectWith([clip('ok', 12.5, 40), clip('past', 100, 400), clip('gone', 500, 600)]))
    expect(useVideoStore.getState().clips.map((c) => [c.startSec, c.endSec])).toEqual([[12.5, 40], [100, 400], [500, 600]])
  })

  it('a clip with no length past the end of the source comes back as the last 0.1 s', async () => {
    await applyProject(projectWith([clip('past', 500, 500)]))
    expect(useVideoStore.getState().clips[0]).toMatchObject({ startSec: 120 - 0.1, endSec: 120 })
  })

  it('the selection is the saved one, on the floored clip', async () => {
    await applyProject(projectWith([clip('a', 0, 5), clip('b', 0, 0)], { selectedClipId: 'b' }))
    expect(useVideoStore.getState().selectedClipId).toBe('b')
    expect(useVideoStore.getState().clips[1]).toMatchObject({ startSec: 0, endSec: 0.1 })
  })

  it('a video that did not open leaves the studio as it was: no clips applied, none floored', async () => {
    vi.stubGlobal('window', { api: { video: { probe: () => Promise.reject(new Error('gone')), fileUrl: (p: string) => pathToImagiiFileUrl(p) }, audio: { ...PEAKS_BRIDGE, probe: () => Promise.resolve(AUDIO_PROBE) } } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await applyProject(projectWith([clip('start', 0, 0)]))
    } finally {
      consoleError.mockRestore()
    }
    expect(useVideoStore.getState().clips).toEqual([])
  })
})

/**
 * T-174 (4) - what a Restore or a project open could not apply because the file was unavailable or would not open is KEPT for the session, written by the next
 * capture (so the autosave keeps it) and given back when the same file is opened again (`videoKey` / `soundKey`); another file opening in that studio drops it.
 * The sentence "load the video again" was a promise the app broke: loading it again opened it fresh, and the autosave after replaced the only copy.
 */
describe('a part that could not be applied is kept for the file and given back to it (T-174 (4))', () => {
  const ORIGINAL = '/media/stream.flv'
  const COPY_A = '/tmp/imagii-import/stream-aB3dE5fG.mp4'
  const COPY_B = '/tmp/imagii-import/stream-Zx9Kp2Lm.mp4'
  const OTHER = '/home/user/Videos/other.mp4'
  const WAV_1 = '/tmp/imagii-audio/aB3dE5fG7h.wav'
  const WAV_2 = '/tmp/imagii-audio/Zx9Kp2LmQr.wav'
  const missing = (p: string): Error => new Error(`ffprobe exit 1: ${p}: No such file or directory`)

  /** The preload bridge with `gone` files absent (probe, conversion and extraction say so) and `broken` files present but refusing to open (a cause that is not "missing"). */
  function bridge(opts: { gone?: string[]; broken?: string[] } = {}): void {
    const gone = opts.gone ?? []
    const broken = opts.broken ?? []
    const fail = (p: string): Error | null => (gone.includes(p) ? missing(p) : broken.includes(p) ? new Error('Cannot open: Permission denied') : null)
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (p: string) => (fail(p) ? Promise.reject(fail(p)) : Promise.resolve(VIDEO_PROBE)),
          fileUrl: (p: string) => pathToImagiiFileUrl(p),
          convertForImport: (p: string) => (fail(p) ? Promise.reject(fail(p)) : Promise.resolve(COPY_A))
        },
        audio: {
          ...PEAKS_BRIDGE,
          probe: (p: string) => (fail(p) ? Promise.reject(fail(p)) : Promise.resolve(AUDIO_PROBE)),
          extractFromVideo: (p: string) => (fail(p) ? Promise.reject(fail(p)) : Promise.resolve(sound(WAV_1, true)))
        }
      }
    })
  }
  const videoProject = (extra: Partial<NonNullable<ImagiiProject['videoStudio']>> = {}): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    videoStudio: { sourcePath: VIDEO_PATH, clips: [CLIP_A, CLIP_B], selectedClipId: CLIP_B.id, watermark: null, srtPath: SRT_PATH, ...extra }
  })
  const audioProject = (part: NonNullable<ImagiiProject['audioStudio']>): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    audioStudio: part
  })
  /** Let the session forget a kept part the way a person does: open some other file in the studio, then close it. */
  async function moveOn(): Promise<void> {
    await useVideoStore.getState().loadSource(OTHER)
    useVideoStore.getState().clearSource()
    useVideoStore.getState().forgetHeldTranscripts()
    await useAudioStore.getState().loadSource(MUSIC_PATH)
    useAudioStore.getState().clearSource()
  }
  beforeEach(async () => {
    bridge()
    await moveOn()
  })
  afterEach(async () => {
    bridge()
    await moveOn()
  })

  const quiet = async <T,>(run: () => Promise<T>): Promise<T> => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      return await run()
    } finally {
      spy.mockRestore()
    }
  }

  describe('the video', () => {
    it('an unavailable video: with nothing open, the next capture still holds its clips, selection and caption path - the autosave keeps them', async () => {
      bridge({ gone: [VIDEO_PATH] })
      const outcome = await quiet(() => applyProject(videoProject()))
      expect(outcome.unavailable).toHaveLength(1)
      expect(useVideoStore.getState().source).toBeNull()
      expect(captureProject().videoStudio).toEqual({
        sourcePath: VIDEO_PATH,
        clips: [CLIP_A, CLIP_B],
        selectedClipId: CLIP_B.id,
        watermark: null,
        srtPath: SRT_PATH
      })
      // ...and what the autosave writes passes the validator the file will be read through.
      const raw = JSON.stringify(captureProject())
      expect(validateProjectJsonString(raw)).toMatchObject({ ok: true })
    })

    it('the same file opened again: its clips, selection and caption path are back, and the kept part is gone', async () => {
      bridge({ gone: [VIDEO_PATH] })
      await quiet(() => applyProject(videoProject()))
      bridge()
      await useVideoStore.getState().loadSource(VIDEO_PATH)
      const video = useVideoStore.getState()
      expect(video.clips).toEqual([CLIP_A, CLIP_B])
      expect(video.selectedClipId).toBe(CLIP_B.id)
      expect(video.srtPath).toBe(SRT_PATH)
      // gone: Close, and the next capture holds nothing for it; opened again it is a fresh one-clip video.
      useVideoStore.getState().clearSource()
      expect(captureProject().videoStudio).toBeUndefined()
      // (T-173 (4) holds a caption path under its key for the session, apart from this: the transcript is forgotten here so only the kept part is in question.)
      useVideoStore.getState().forgetHeldTranscripts()
      await useVideoStore.getState().loadSource(VIDEO_PATH)
      expect(useVideoStore.getState().clips).toHaveLength(1)
      expect(useVideoStore.getState().srtPath).toBeNull()
    })

    it('a video that was there but would not open (not "missing") is kept the same way', async () => {
      bridge({ broken: [VIDEO_PATH] })
      const outcome = await quiet(() => applyProject(videoProject()))
      expect(outcome.failed).toHaveLength(1)
      expect(captureProject().videoStudio?.clips).toEqual([CLIP_A, CLIP_B])
      bridge()
      await useVideoStore.getState().loadSource(VIDEO_PATH)
      expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
    })

    it('a converted import: the capture names the ORIGINAL and the marker; the NEW working copy of the same original gets the clips', async () => {
      bridge({ gone: [ORIGINAL] })
      await quiet(() => applyProject(videoProject({ sourcePath: ORIGINAL, convertedForImport: true })))
      expect(captureProject().videoStudio).toEqual({
        sourcePath: ORIGINAL,
        convertedForImport: true,
        clips: [CLIP_A, CLIP_B],
        selectedClipId: CLIP_B.id,
        watermark: null,
        srtPath: SRT_PATH
      })
      bridge()
      await useVideoStore.getState().loadSource(COPY_B, ORIGINAL)
      expect(useVideoStore.getState().source?.filePath).toBe(COPY_B)
      expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
      expect(useVideoStore.getState().srtPath).toBe(SRT_PATH)
    })

    it('another video is open when the apply fails: the capture is of the OPEN video; Close keeps the part, and the missing file opened later gets it', async () => {
      bridge({ gone: [VIDEO_PATH] })
      await useVideoStore.getState().loadSource(OTHER)
      await quiet(() => applyProject(videoProject()))
      expect(useVideoStore.getState().source?.filePath, 'the apply left the open video alone').toBe(OTHER)
      expect(captureProject().videoStudio?.sourcePath, 'while a video is open the capture is of it').toBe(OTHER)
      useVideoStore.getState().clearSource()
      expect(captureProject().videoStudio?.clips, 'Close keeps the part').toEqual([CLIP_A, CLIP_B])
      expect(captureProject().videoStudio?.sourcePath).toBe(VIDEO_PATH)
      bridge()
      await useVideoStore.getState().loadSource(VIDEO_PATH)
      expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
    })

    it('a kept part is not work the session holds: Restore over it is not refused, and its sentence names nothing open', async () => {
      bridge({ gone: [VIDEO_PATH] })
      await quiet(() => applyProject(videoProject()))
      expect(captureProject().videoStudio).toBeDefined()
      expect(sessionHoldsWork()).toBe(false)
      expect(describeRestoreRefused()).toBe('Nothing was restored: your work is open now, and restoring would replace it.')
    })

    it('control: a DIFFERENT video opened drops it - closed and the first one opened later, there are no clips back and the capture holds nothing', async () => {
      bridge({ gone: [VIDEO_PATH] })
      await quiet(() => applyProject(videoProject()))
      bridge()
      await useVideoStore.getState().loadSource(OTHER)
      expect(useVideoStore.getState().clips).toHaveLength(1)
      useVideoStore.getState().clearSource()
      expect(captureProject().videoStudio, 'the person moved on: nothing is written for the file that was missing').toBeUndefined()
      await useVideoStore.getState().loadSource(VIDEO_PATH)
      expect(useVideoStore.getState().clips, 'the missing file came back, but its clips were let go when another video opened').toHaveLength(1)
      expect(useVideoStore.getState().srtPath).toBeNull()
    })

    it('control: a skipped video (the person opened another while it loaded) keeps nothing', async () => {
      let release: (copy: string) => void = () => undefined
      const gate = new Promise<string>((resolve) => {
        release = resolve
      })
      bridge()
      const base = (window as unknown as { api: { video: Record<string, unknown> } }).api.video
      base.convertForImport = () => gate
      const pending = applyProject(videoProject({ sourcePath: ORIGINAL, convertedForImport: true }))
      await useVideoStore.getState().loadSource(OTHER)
      release(COPY_A)
      const outcome = await pending
      expect(outcome.skipped).toEqual(['video'])
      useVideoStore.getState().clearSource()
      expect(captureProject().videoStudio).toBeUndefined()
      await useVideoStore.getState().loadSource(COPY_B, ORIGINAL)
      expect(useVideoStore.getState().clips).toHaveLength(1)
    })

    it('control: a video that opened keeps nothing - Close, and the capture holds nothing', async () => {
      await applyProject(videoProject())
      expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
      useVideoStore.getState().clearSource()
      expect(captureProject().videoStudio).toBeUndefined()
    })

    it('a project that opens the video AFTER a failed apply supersedes the kept part (the new clips are the ones applied)', async () => {
      bridge({ gone: [VIDEO_PATH] })
      await quiet(() => applyProject(videoProject()))
      bridge()
      await applyProject(videoProject({ clips: [CLIP_A], selectedClipId: CLIP_A.id, srtPath: null }))
      expect(useVideoStore.getState().clips).toEqual([CLIP_A])
      expect(useVideoStore.getState().srtPath).toBeNull()
      useVideoStore.getState().clearSource()
      expect(captureProject().videoStudio).toBeUndefined()
    })

    it('a second failed apply replaces the first (one part per studio)', async () => {
      bridge({ gone: [VIDEO_PATH, OTHER] })
      await quiet(() => applyProject(videoProject()))
      await quiet(() => applyProject(videoProject({ sourcePath: OTHER, clips: [CLIP_A], selectedClipId: CLIP_A.id, srtPath: null })))
      expect(captureProject().videoStudio).toMatchObject({ sourcePath: OTHER, clips: [CLIP_A] })
    })
  })

  describe('the sound', () => {
    it('a sound whose extraction failed: the capture holds its chain (the video named, the marker), and the same file opened again has the chain back', async () => {
      bridge({ broken: [VIDEO_PATH] })
      const outcome = await quiet(() => applyProject(audioProject({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })))
      expect(outcome.failed).toHaveLength(1)
      expect(useAudioStore.getState().source).toBeNull()
      expect(captureProject().audioStudio).toEqual({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })
      expect(validateProjectJsonString(JSON.stringify(captureProject()))).toMatchObject({ ok: true })

      bridge()
      await useAudioStore.getState().loadSource(WAV_2, VIDEO_PATH, undefined, true)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
      useAudioStore.getState().clearSource()
      expect(captureProject().audioStudio, 'given back, so gone').toBeUndefined()
    })

    it('a sound from a converted import: the extraction of the NEW working copy of the same original gets the chain', async () => {
      bridge({ gone: [ORIGINAL] })
      await quiet(() => applyProject(audioProject({ sourcePath: ORIGINAL, extractedFromVideo: true, chain: CHAIN })))
      expect(captureProject().audioStudio?.sourcePath).toBe(ORIGINAL)
      bridge()
      await useAudioStore.getState().loadSource(WAV_2, COPY_B, ORIGINAL, true)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })

    it('a plain audio file that is gone: kept as itself (no marker), and given back to that file', async () => {
      bridge({ gone: [AUDIO_PATH] })
      await quiet(() => applyProject(audioProject({ sourcePath: AUDIO_PATH, chain: CHAIN })))
      expect(captureProject().audioStudio).toEqual({ sourcePath: AUDIO_PATH, chain: CHAIN })
      bridge()
      await useAudioStore.getState().loadSource(AUDIO_PATH)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })

    it('an older project that names the video beside a scratch WAV: kept under the VIDEO, as an extraction', async () => {
      bridge({ broken: [VIDEO_PATH, WAV_1] })
      await quiet(() => applyProject(audioProject({ sourcePath: WAV_1, fromVideoPath: VIDEO_PATH, chain: CHAIN })))
      expect(captureProject().audioStudio).toEqual({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })
    })

    it('another sound is open when the apply fails: the capture is of the OPEN sound; Close keeps the chain, and the video opened later gets it', async () => {
      bridge({ broken: [VIDEO_PATH] })
      await useAudioStore.getState().loadSource(MUSIC_PATH)
      await quiet(() => applyProject(audioProject({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })))
      expect(useAudioStore.getState().source?.filePath).toBe(MUSIC_PATH)
      expect(captureProject().audioStudio?.sourcePath, 'while a sound is open the capture is of it').toBe(MUSIC_PATH)
      useAudioStore.getState().clearSource()
      expect(captureProject().audioStudio).toEqual({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })
      bridge()
      await useAudioStore.getState().loadSource(WAV_2, VIDEO_PATH, undefined, true)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })

    it('control: a DIFFERENT file opened drops it', async () => {
      bridge({ gone: [AUDIO_PATH] })
      await quiet(() => applyProject(audioProject({ sourcePath: AUDIO_PATH, chain: CHAIN })))
      bridge()
      await useAudioStore.getState().loadSource(MUSIC_PATH)
      expect(useAudioStore.getState().chain).not.toEqual(CHAIN)
      useAudioStore.getState().clearSource()
      expect(captureProject().audioStudio).toBeUndefined()
      await useAudioStore.getState().loadSource(AUDIO_PATH)
      expect(useAudioStore.getState().chain, 'the file came back, but the chain was let go when another sound opened').not.toEqual(CHAIN)
    })

    it('control: a skipped sound (another opened while it loaded) keeps nothing, and a sound that opened keeps nothing', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      bridge()
      const audioApi = (window as unknown as { api: { audio: Record<string, unknown> } }).api.audio
      audioApi.extractFromVideo = async () => {
        await gate
        return sound(WAV_1, true)
      }
      const pending = applyProject(audioProject({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN }))
      await useAudioStore.getState().loadSource(MUSIC_PATH)
      release()
      const outcome = await pending
      expect(outcome.skipped).toEqual(['audio'])
      useAudioStore.getState().clearSource()
      expect(captureProject().audioStudio).toBeUndefined()

      bridge()
      await applyProject(audioProject({ sourcePath: AUDIO_PATH, chain: CHAIN }))
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
      useAudioStore.getState().clearSource()
      expect(captureProject().audioStudio).toBeUndefined()
    })
  })
})

/**
 * T-175 (3) - a part kept for a file that could not be opened is not let go without a word. Every entry that opens a file into a studio asks `keptPartQuestion` with
 * the key the give-back will compare (`videoKey` / `soundKey` of what it opens), so the question is null for the SAME file (it gets the part back) and a sentence
 * for any other. The e2e twins drive the question in the built app (home-chrome.spec.ts, audio.spec.ts); the entries asking it are pinned in interactionWiring.test.ts.
 */
describe('keptPartQuestion - what is asked before a kept part is let go (T-175 (3))', () => {
  const ORIGINAL = '/media/stream.flv'
  const COPY_B = '/tmp/imagii-import/stream-Zx9Kp2Lm.mp4'
  const OTHER = '/home/user/Videos/other.mp4'
  const WAV_2 = '/tmp/imagii-audio/Zx9Kp2LmQr.wav'
  const WIN_VIDEO = 'D:\\Captures\\night-stream.mp4'
  const missing = (p: string): Error => new Error(`ffprobe exit 1: ${p}: No such file or directory`)

  function bridge(gone: string[] = []): void {
    const fail = (p: string): Error | null => (gone.includes(p) ? missing(p) : null)
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (p: string) => (fail(p) ? Promise.reject(fail(p)) : Promise.resolve(VIDEO_PROBE)),
          fileUrl: (p: string) => pathToImagiiFileUrl(p),
          convertForImport: (p: string) => (fail(p) ? Promise.reject(fail(p)) : Promise.resolve(COPY_B))
        },
        audio: {
          ...PEAKS_BRIDGE,
          probe: (p: string) => (fail(p) ? Promise.reject(fail(p)) : Promise.resolve(AUDIO_PROBE)),
          extractFromVideo: (p: string) => (fail(p) ? Promise.reject(fail(p)) : Promise.resolve(sound(WAV_2, true)))
        }
      }
    })
  }
  const videoProject = (sourcePath: string, clips: Clip[] = [CLIP_A, CLIP_B], extra: Partial<NonNullable<ImagiiProject['videoStudio']>> = {}): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    videoStudio: { sourcePath, clips, selectedClipId: clips[0]?.id ?? null, watermark: null, srtPath: null, ...extra }
  })
  const audioProject = (part: NonNullable<ImagiiProject['audioStudio']>): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    audioStudio: part
  })
  async function moveOn(): Promise<void> {
    await useVideoStore.getState().loadSource(OTHER)
    useVideoStore.getState().clearSource()
    useVideoStore.getState().forgetHeldTranscripts()
    await useAudioStore.getState().loadSource(MUSIC_PATH)
    useAudioStore.getState().clearSource()
  }
  const quiet = async <T,>(run: () => Promise<T>): Promise<T> => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      return await run()
    } finally {
      spy.mockRestore()
    }
  }
  beforeEach(async () => {
    bridge()
    await moveOn()
  })
  afterEach(async () => {
    bridge()
    await moveOn()
  })

  it('null while the studio keeps no part, for either studio', () => {
    expect(keptPartQuestion('video', OTHER, 'other.mp4')).toBeNull()
    expect(keptPartQuestion('audio', OTHER, 'other.mp4')).toBeNull()
  })

  it('video: a different file asks, in the ticket\'s words, with FILE NAMES (a POSIX path and a Windows path)', async () => {
    bridge([VIDEO_PATH])
    await quiet(() => applyProject(videoProject(VIDEO_PATH)))
    expect(keptPartQuestion('video', OTHER, 'other.mp4')).toBe('Open other.mp4? The 2 clips kept for stream.mp4, which could not be opened, will be discarded.')
    expect(keptPartQuestion('video', 'C:\\clips\\Raid.mp4', 'Raid.mp4')).toBe('Open Raid.mp4? The 2 clips kept for stream.mp4, which could not be opened, will be discarded.')
    expect(keptPartQuestion('audio', OTHER, 'other.mp4'), 'the other studio keeps nothing').toBeNull()
  })

  it('video: a Windows-path kept file is named by its file name, never its path', async () => {
    bridge([WIN_VIDEO])
    await quiet(() => applyProject(videoProject(WIN_VIDEO)))
    const question = keptPartQuestion('video', OTHER, 'other.mp4')
    expect(question).toBe('Open other.mp4? The 2 clips kept for night-stream.mp4, which could not be opened, will be discarded.')
    expect(question).not.toContain('Captures')
  })

  it('video: one clip is "1 clip" (countOf), not "1 clips"', async () => {
    bridge([VIDEO_PATH])
    await quiet(() => applyProject(videoProject(VIDEO_PATH, [CLIP_A])))
    expect(keptPartQuestion('video', OTHER, 'other.mp4')).toBe('Open other.mp4? The 1 clip kept for stream.mp4, which could not be opened, will be discarded.')
  })

  it('video: the SAME key asks nothing (the give-back applies the part)', async () => {
    bridge([VIDEO_PATH])
    await quiet(() => applyProject(videoProject(VIDEO_PATH)))
    expect(keptPartQuestion('video', VIDEO_PATH, 'stream.mp4')).toBeNull()
  })

  it('video: a part with no clips has nothing to lose, so it asks nothing', async () => {
    bridge([VIDEO_PATH])
    await quiet(() => applyProject(videoProject(VIDEO_PATH, [])))
    expect(keptPartQuestion('video', OTHER, 'other.mp4')).toBeNull()
  })

  it('audio: a different file asks, in the ticket\'s words, with the kept file\'s NAME', async () => {
    bridge([VIDEO_PATH])
    await quiet(() => applyProject(audioProject({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })))
    expect(keptPartQuestion('audio', MUSIC_PATH, 'bed.mp3')).toBe('Open bed.mp3? The changes kept for stream.mp4, which could not be opened, will be discarded.')
    expect(keptPartQuestion('video', MUSIC_PATH, 'bed.mp3'), 'the other studio keeps nothing').toBeNull()
  })

  it('audio: the SAME key asks nothing', async () => {
    bridge([VIDEO_PATH])
    await quiet(() => applyProject(audioProject({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })))
    expect(keptPartQuestion('audio', VIDEO_PATH, 'stream.mp4')).toBeNull()
  })

  it('audio: a kept chain at its defaults (no cuts, no second track) has nothing to lose, so it asks nothing', async () => {
    bridge([VIDEO_PATH])
    await quiet(() => applyProject(audioProject({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: { ...DEFAULT_CHAIN_SPEC } })))
    expect(keptPartQuestion('audio', MUSIC_PATH, 'bed.mp3')).toBeNull()
  })

  it('a part that was given back, or let go, asks nothing afterwards', async () => {
    bridge([VIDEO_PATH])
    await quiet(() => applyProject(videoProject(VIDEO_PATH)))
    bridge()
    await useVideoStore.getState().loadSource(OTHER)
    expect(keptPartQuestion('video', MUSIC_PATH, 'bed.mp3'), 'the other file opened and the give-back dropped the part').toBeNull()
  })

  describe('the key an entry asks with is the key the give-back compares, so the same file never asks', () => {
    it('Importer / Edit in Video Studio, a plain video: videoKey of the loaded video is the picked path, and opening it brings the clips back', async () => {
      bridge([VIDEO_PATH])
      await quiet(() => applyProject(videoProject(VIDEO_PATH)))
      bridge()
      await useVideoStore.getState().loadSource(VIDEO_PATH)
      const open = useVideoStore.getState().source
      expect(open && videoKey(open)).toBe(VIDEO_PATH)
      expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
    })

    it('Importer, a converted import: the picked path IS videoKey of the converted video, and the new working copy gets the clips', async () => {
      bridge([ORIGINAL])
      await quiet(() => applyProject(videoProject(ORIGINAL, [CLIP_A, CLIP_B], { convertedForImport: true })))
      expect(keptPartQuestion('video', ORIGINAL, 'stream.flv'), 'the picked path is the key').toBeNull()
      // ...whereas the working copy's path is NOT the key: asking with it would ask about the very file that gets the part.
      expect(keptPartQuestion('video', COPY_B, 'stream-Zx9Kp2Lm.mp4')).not.toBeNull()
      bridge()
      await useVideoStore.getState().loadSource(COPY_B, ORIGINAL)
      const open = useVideoStore.getState().source
      expect(open && videoKey(open), 'what the importer asks with = what the give-back compared').toBe(ORIGINAL)
      expect(useVideoStore.getState().clips).toEqual([CLIP_A, CLIP_B])
    })

    it('AudioImporter, a video\'s sound: the picked video is soundKey of the extracted sound, and it gets the chain', async () => {
      bridge([VIDEO_PATH])
      await quiet(() => applyProject(audioProject({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })))
      expect(keptPartQuestion('audio', VIDEO_PATH, 'stream.mp4')).toBeNull()
      bridge()
      await useAudioStore.getState().loadSource(WAV_2, VIDEO_PATH, undefined, true)
      const open = useAudioStore.getState().source
      expect(open && soundKey(open)).toBe(VIDEO_PATH)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })

    it('AudioImporter, an AIFF / WMA extraction (not a video\'s sound): the picked file is soundKey (extractedFrom), and it gets the chain', async () => {
      const AIFF = '/home/user/Audio/voice.aiff'
      bridge([AIFF])
      await quiet(() => applyProject(audioProject({ sourcePath: AIFF, extractedFromVideo: true, chain: CHAIN })))
      expect(keptPartQuestion('audio', AIFF, 'voice.aiff')).toBeNull()
      bridge()
      await useAudioStore.getState().loadSource(WAV_2, AIFF, undefined, false)
      const open = useAudioStore.getState().source
      expect(open && soundKey(open)).toBe(AIFF)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })

    it('AudioImporter, a plain file: the picked path is soundKey, and it gets the chain', async () => {
      bridge([AUDIO_PATH])
      await quiet(() => applyProject(audioProject({ sourcePath: AUDIO_PATH, chain: CHAIN })))
      expect(keptPartQuestion('audio', AUDIO_PATH, 'mic.wav')).toBeNull()
      bridge()
      await useAudioStore.getState().loadSource(AUDIO_PATH)
      const open = useAudioStore.getState().source
      expect(open && soundKey(open)).toBe(AUDIO_PATH)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })

    it('Clean audio: videoKey(source) (what the cleanAudioFlow asks with) is soundKey of the extracted sound - a plain video and a converted import both', async () => {
      // A plain video.
      bridge([VIDEO_PATH])
      await quiet(() => applyProject(audioProject({ sourcePath: VIDEO_PATH, extractedFromVideo: true, chain: CHAIN })))
      bridge()
      await useVideoStore.getState().loadSource(VIDEO_PATH)
      const plain = useVideoStore.getState().source
      expect(plain).not.toBeNull()
      const plainKey = videoKey(plain!)
      expect(keptPartQuestion('audio', plainKey, plain!.fileName), 'the same video\'s own kept chain asks nothing').toBeNull()
      await useAudioStore.getState().loadSource(WAV_2, plain!.filePath, plain!.convertedFrom, true)
      expect(soundKey(useAudioStore.getState().source!)).toBe(plainKey)
      expect(useAudioStore.getState().chain).toEqual(CHAIN)

      // A converted import: the key is the ORIGINAL, not the working copy.
      useAudioStore.getState().clearSource()
      useVideoStore.getState().clearSource()
      bridge([ORIGINAL])
      await quiet(() => applyProject(audioProject({ sourcePath: ORIGINAL, extractedFromVideo: true, chain: CHAIN })))
      bridge()
      await useVideoStore.getState().loadSource(COPY_B, ORIGINAL)
      const converted = useVideoStore.getState().source!
      expect(keptPartQuestion('audio', videoKey(converted), converted.fileName)).toBeNull()
      expect(keptPartQuestion('audio', converted.filePath, 'x'), 'the working copy\'s path is not the key').not.toBeNull()
      await useAudioStore.getState().loadSource(WAV_2, converted.filePath, converted.convertedFrom, true)
      expect(soundKey(useAudioStore.getState().source!)).toBe(videoKey(converted))
      expect(useAudioStore.getState().chain).toEqual(CHAIN)
    })
  })
})

/**
 * T-195 (2) - a sound that OPENS and is then refused (its waveform read fails: an unknown WAV format) keeps its part exactly as a load that threw does (T-174 (4)), so the capture writes it while
 * no sound is open and the same file opened again gets it back. Not kept when the studio let go for another reason (a Close, another file opened) or a newer open has taken the slot.
 * The peaks answer is held per file here, so a refusal can land before or after the thing that is meant to make it not count.
 */
describe('a sound that opens and is then refused keeps its part (T-195 (2))', () => {
  const VIDEO_FILE = '/home/user/Videos/stream.mp4'
  const WAV = '/tmp/imagii-audio/aB3dE5fG7h.wav'
  const REFUSAL = new Error("Error invoking remote method 'audio:peaks': Error: imagii couldn't read the sound in this file to draw its waveform.")
  const peaks: Record<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = {}
  const gone = new Set<string>()

  function bridge(): void {
    for (const k of Object.keys(peaks)) delete peaks[k]
    vi.stubGlobal('window', {
      api: {
        video: { fileUrl: (p: string) => pathToImagiiFileUrl(p) },
        audio: {
          ...PEAKS_BRIDGE,
          // Held: the test decides when (and whether) each file's waveform read answers.
          peaks: (p: string) => new Promise((resolve, reject) => { peaks[p] = { resolve, reject } }),
          probe: (p: string) => (gone.has(p) ? Promise.reject(new Error(`ffprobe exit 1: ${p}: No such file or directory`)) : Promise.resolve(AUDIO_PROBE)),
          extractFromVideo: () => Promise.resolve(sound(WAV, true))
        }
      }
    })
  }
  const part = (sourcePath: string, extra: Partial<NonNullable<ImagiiProject['audioStudio']>> = {}): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    audioStudio: { sourcePath, chain: CHAIN, ...extra }
  })
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const refuse = async (p: string): Promise<void> => {
    peaks[p]!.reject(REFUSAL)
    await flush()
  }
  /** The next capture's audio part, from a studio with nothing open. */
  const kept = (): ImagiiProject['audioStudio'] => captureProject().audioStudio

  beforeEach(async () => {
    gone.clear()
    bridge()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Let the session forget a kept part the way a person does: open some other file, then close it.
    const open = useAudioStore.getState().loadSource(MUSIC_PATH)
    await flush()
    peaks[MUSIC_PATH]?.resolve({ peaks: [[0.5], [-0.5]], duration: 120 })
    await open
    useAudioStore.getState().clearSource()
  })
  afterEach(() => {
    useAudioStore.getState().clearSource()
    vi.restoreAllMocks()
  })

  it('the refusal keeps the part: the next capture writes it with nothing open, and the same file opened again gets the chain back', async () => {
    await applyProject(part(AUDIO_PATH))
    expect(useAudioStore.getState().source, 'the file opened; its waveform is still being read').not.toBeNull()
    await refuse(AUDIO_PATH)
    expect(useAudioStore.getState().source, 'the studio let go of it').toBeNull()
    expect(kept()).toEqual({ sourcePath: AUDIO_PATH, chain: CHAIN })
    // ...and what the autosave writes passes the validator the file is read through.
    expect(validateProjectJsonString(JSON.stringify(captureProject()))).toMatchObject({ ok: true })

    const again = useAudioStore.getState().loadSource(AUDIO_PATH)
    await flush()
    peaks[AUDIO_PATH]!.resolve({ peaks: [[0.5], [-0.5]], duration: 120 })
    await again
    expect(useAudioStore.getState().chain).toEqual(CHAIN)
    // given back once: Close, and it is gone.
    useAudioStore.getState().clearSource()
    expect(kept()).toBeUndefined()
  })

  it('the sound of a video that is refused is kept as an extraction, under the VIDEO', async () => {
    await applyProject(part(VIDEO_FILE, { extractedFromVideo: true }))
    await refuse(WAV)
    expect(kept()).toEqual({ sourcePath: VIDEO_FILE, extractedFromVideo: true, chain: CHAIN })
  })

  it('a v4+ project (the scratch WAV beside its video) whose WAV opens and is refused is kept under the VIDEO, and a fresh extraction of that video gets the chain back', async () => {
    const OLD_WAV = '/tmp/imagii-audio/old-scratch.wav'
    await applyProject(part(OLD_WAV, { fromVideoPath: VIDEO_FILE }))
    expect(useAudioStore.getState().source?.filePath, 'the scratch WAV opened through the first road').toBe(OLD_WAV)
    await refuse(OLD_WAV)
    expect(useAudioStore.getState().source).toBeNull()
    expect(kept(), 'under the video, not the dead scratch WAV').toEqual({ sourcePath: VIDEO_FILE, extractedFromVideo: true, chain: CHAIN })
    const again = useAudioStore.getState().loadSource(WAV, VIDEO_FILE, undefined, true)
    await flush()
    peaks[WAV]!.resolve({ peaks: [[0.5], [-0.5]], duration: 120 })
    await again
    expect(useAudioStore.getState().chain).toEqual(CHAIN)
  })

  it('does not wait for the waveform: the open returns while the read is still going, with nothing kept yet', async () => {
    const outcome = await applyProject(part(AUDIO_PATH))
    expect(outcome.audioOpened).toBeDefined()
    expect(peaks[AUDIO_PATH], 'the read has not answered').toBeDefined()
    expect(useAudioStore.getState().source).toBe(outcome.audioOpened)
    expect(kept()?.sourcePath, 'an open sound is what the capture writes').toBe(AUDIO_PATH)
  })

  it('a waveform that arrives keeps nothing: Close afterwards leaves no audio part', async () => {
    await applyProject(part(AUDIO_PATH))
    peaks[AUDIO_PATH]!.resolve({ peaks: [[0.5], [-0.5]], duration: 120 })
    await flush()
    expect(useAudioStore.getState().waveform).not.toBeNull()
    useAudioStore.getState().clearSource()
    expect(kept()).toBeUndefined()
  })

  it('a Close before the refusal keeps nothing (the person let go of it)', async () => {
    await applyProject(part(AUDIO_PATH))
    useAudioStore.getState().clearSource()
    await refuse(AUDIO_PATH)
    expect(kept()).toBeUndefined()
  })

  it('another file opened before the refusal keeps nothing: the chain is the new file\'s, and Close leaves no audio part', async () => {
    await applyProject(part(AUDIO_PATH))
    const other = useAudioStore.getState().loadSource(MUSIC_PATH)
    await flush()
    peaks[MUSIC_PATH]!.resolve({ peaks: [[0.5], [-0.5]], duration: 120 })
    await other
    await refuse(AUDIO_PATH)
    expect(useAudioStore.getState().source?.filePath, 'the other file is still open').toBe(MUSIC_PATH)
    expect(useAudioStore.getState().chain).not.toEqual(CHAIN)
    useAudioStore.getState().clearSource()
    expect(kept()).toBeUndefined()
  })

  it('a newer open that holds the slot keeps it: its part is what the capture writes, not the refused one\'s', async () => {
    await applyProject(part(AUDIO_PATH))
    // The newer project names a file that is gone: it fails and keeps ITS part (T-174 (4)) while the first sound's waveform is still being read.
    gone.add(MUSIC_PATH)
    const newer = await applyProject(part(MUSIC_PATH, { chain: { ...CHAIN, gainDb: 6 } }))
    expect(newer.unavailable).toHaveLength(1)
    await refuse(AUDIO_PATH)
    expect(useAudioStore.getState().source).toBeNull()
    expect(kept()).toEqual({ sourcePath: MUSIC_PATH, chain: { ...CHAIN, gainDb: 6 } })
  })
})

/**
 * T-196 (1) - a part kept for a file that could not be opened (T-174 (4)) is given back when that file opens, and the sound then owns the chain. Its waveform is read AFTER it opens, and main can
 * still refuse it (T-195 (2)): the studio resets to the default chain and the sentence says "try again", so the give-back keeps the part again, as given back, until a read ARRIVES. The peaks answer
 * is held per file so a refusal can land before or after the thing that is meant to make it not count (a Close, another file, a newer apply).
 */
describe('a given-back part is kept again when its file is refused (T-196 (1))', () => {
  const VIDEO_FILE = '/home/user/Videos/stream.mp4'
  const WAV = '/tmp/imagii-audio/aB3dE5fG7h.wav'
  const REFUSAL = new Error("Error invoking remote method 'audio:peaks': Error: imagii couldn't read the sound in this file to draw its waveform.")
  const peaks: Record<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = {}
  const gone = new Set<string>()
  let extraction: { resolve: (v: ExtractedSound) => void } | null = null

  function bridge(): void {
    for (const k of Object.keys(peaks)) delete peaks[k]
    extraction = null
    vi.stubGlobal('window', {
      api: {
        video: { fileUrl: (p: string) => pathToImagiiFileUrl(p) },
        audio: {
          ...PEAKS_BRIDGE,
          peaks: (p: string) => new Promise((resolve, reject) => { peaks[p] = { resolve, reject } }),
          probe: (p: string) => (gone.has(p) ? Promise.reject(new Error(`ffprobe exit 1: ${p}: No such file or directory`)) : Promise.resolve(AUDIO_PROBE)),
          // Held when a test asks (a newer apply still waiting on its extraction), answered at once otherwise.
          extractFromVideo: (p: string) =>
            gone.has(p)
              ? Promise.reject(new Error(`ffprobe exit 1: ${p}: No such file or directory`))
              : extraction
                ? new Promise<ExtractedSound>((resolve) => { extraction!.resolve = resolve })
                : Promise.resolve(sound(WAV, true))
        }
      }
    })
  }
  const part = (sourcePath: string, extra: Partial<NonNullable<ImagiiProject['audioStudio']>> = {}): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    audioStudio: { sourcePath, chain: CHAIN, ...extra }
  })
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const refuse = async (p: string): Promise<void> => {
    peaks[p]!.reject(REFUSAL)
    await flush()
  }
  const arrive = async (p: string): Promise<void> => {
    peaks[p]!.resolve({ peaks: [[0.5], [-0.5]], duration: 120 })
    await flush()
  }
  /** The importer's open of a file: the source is in the studio at once, its waveform is read after. */
  const open = async (p: string, ...rest: [string?, string?, boolean?]): Promise<void> => {
    void useAudioStore.getState().loadSource(p, ...rest)
    await flush()
  }
  /** The next capture's audio part, from a studio with nothing open. */
  const kept = (): ImagiiProject['audioStudio'] => captureProject().audioStudio

  beforeEach(async () => {
    gone.clear()
    bridge()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Let the session forget a kept part the way a person does: open some other file, then close it.
    await open(MUSIC_PATH)
    await arrive(MUSIC_PATH)
    useAudioStore.getState().clearSource()
  })
  afterEach(() => {
    useAudioStore.getState().clearSource()
    vi.restoreAllMocks()
  })

  /** The T-174 (4) road: the project names a file that is not there (kept), then the file is back. */
  async function keptForMissing(file: string): Promise<void> {
    gone.add(file)
    const outcome = await applyProject(part(file))
    expect(outcome.unavailable).toHaveLength(1)
    gone.delete(file)
    expect(kept()).toEqual({ sourcePath: file, chain: CHAIN })
  }

  it('the file given the part back and then refused keeps it again - any number of tries - and a read that arrives ends it', async () => {
    await keptForMissing(AUDIO_PATH)
    await open(AUDIO_PATH)
    expect(useAudioStore.getState().chain, 'given back at the open').toEqual(CHAIN)
    expect(kept(), 'the open sound owns the chain, written from the source').toEqual({ sourcePath: AUDIO_PATH, chain: CHAIN })
    await refuse(AUDIO_PATH)
    expect(useAudioStore.getState().source, 'the studio let go of it').toBeNull()
    expect(kept(), 'kept again: the work waits for the file').toEqual({ sourcePath: AUDIO_PATH, chain: CHAIN })
    expect(validateProjectJsonString(JSON.stringify(captureProject()))).toMatchObject({ ok: true })
    expect(keptPartQuestion('audio', AUDIO_PATH, 'mic.wav'), 'the same file is not asked about').toBeNull()
    // a second try, refused again
    await open(AUDIO_PATH)
    expect(useAudioStore.getState().chain).toEqual(CHAIN)
    await refuse(AUDIO_PATH)
    expect(kept()).toEqual({ sourcePath: AUDIO_PATH, chain: CHAIN })
    // a third, whose read arrives: the chain is the sound's, and Close lets it go
    await open(AUDIO_PATH)
    await arrive(AUDIO_PATH)
    expect(useAudioStore.getState().chain).toEqual(CHAIN)
    useAudioStore.getState().clearSource()
    expect(kept()).toBeUndefined()
  })

  it('a part kept by a refused project open (T-195 (2)) and tried again by the same unchanged file is kept again on a second refusal', async () => {
    await applyProject(part(AUDIO_PATH))
    await refuse(AUDIO_PATH)
    expect(kept()).toEqual({ sourcePath: AUDIO_PATH, chain: CHAIN })
    await open(AUDIO_PATH)
    await refuse(AUDIO_PATH)
    expect(kept(), 'what the file refused twice still holds the chain').toEqual({ sourcePath: AUDIO_PATH, chain: CHAIN })
  })

  it('the sound of a video: its part is kept again, as an extraction, under the VIDEO', async () => {
    gone.add(VIDEO_FILE)
    await applyProject(part(VIDEO_FILE, { extractedFromVideo: true }))
    gone.delete(VIDEO_FILE)
    await open(WAV, VIDEO_FILE, undefined, true)
    expect(useAudioStore.getState().chain).toEqual(CHAIN)
    await refuse(WAV)
    expect(kept()).toEqual({ sourcePath: VIDEO_FILE, extractedFromVideo: true, chain: CHAIN })
  })

  it('a read that arrives keeps nothing: Close afterwards leaves no audio part', async () => {
    await keptForMissing(AUDIO_PATH)
    await open(AUDIO_PATH)
    await arrive(AUDIO_PATH)
    useAudioStore.getState().clearSource()
    expect(kept()).toBeUndefined()
  })

  it('a Close before the refusal keeps nothing (the person let go of it)', async () => {
    await keptForMissing(AUDIO_PATH)
    await open(AUDIO_PATH)
    useAudioStore.getState().clearSource()
    await refuse(AUDIO_PATH)
    expect(kept()).toBeUndefined()
  })

  it('another file opened before the refusal keeps nothing: Close leaves no audio part', async () => {
    await keptForMissing(AUDIO_PATH)
    await open(AUDIO_PATH)
    await open(MUSIC_PATH)
    await arrive(MUSIC_PATH)
    await refuse(AUDIO_PATH)
    expect(useAudioStore.getState().source?.filePath, 'the other file is still open').toBe(MUSIC_PATH)
    expect(useAudioStore.getState().chain).not.toEqual(CHAIN)
    useAudioStore.getState().clearSource()
    expect(kept()).toBeUndefined()
  })

  it('a DIFFERENT file than the kept one does not get the part, and its refusal keeps nothing', async () => {
    await keptForMissing(AUDIO_PATH)
    await open(MUSIC_PATH)
    expect(useAudioStore.getState().chain).not.toEqual(CHAIN)
    await refuse(MUSIC_PATH)
    expect(kept()).toBeUndefined()
  })

  it('a newer apply that holds the slot keeps it: the refusal lands while its extraction is still running, and the old part is not put back over it', async () => {
    await keptForMissing(AUDIO_PATH)
    await open(AUDIO_PATH)
    extraction = { resolve: () => undefined }
    // The newer project takes the slot (it claims it before its first wait); its sound is not in the studio yet.
    const newer = applyProject(part(VIDEO_FILE, { extractedFromVideo: true, chain: { ...CHAIN, gainDb: 6 } }))
    await flush()
    await refuse(AUDIO_PATH)
    expect(useAudioStore.getState().source).toBeNull()
    expect(kept(), 'nothing of the refused sound: the newer open has the slot').toBeUndefined()
    extraction.resolve(sound(WAV, true))
    await flush()
    await newer
    expect(useAudioStore.getState().chain).toEqual({ ...CHAIN, gainDb: 6 })
  })

  it('a newer apply whose file is gone keeps ITS part, not the refused one\'s', async () => {
    await keptForMissing(AUDIO_PATH)
    await open(AUDIO_PATH)
    gone.add(MUSIC_PATH)
    const newer = await applyProject(part(MUSIC_PATH, { chain: { ...CHAIN, gainDb: 6 } }))
    expect(newer.unavailable).toHaveLength(1)
    await refuse(AUDIO_PATH)
    expect(kept()).toEqual({ sourcePath: MUSIC_PATH, chain: { ...CHAIN, gainDb: 6 } })
  })
})

/**
 * T-198 (2) - a project open that a newer one overtook changes nothing. Opening a second project while the first still waits (a conversion or an extraction takes minutes, and Home calls that
 * supported) used to let the first one's late sound land in the second one's session (`replacedSince` reads an EMPTY studio as "not replaced"), its late failure overwrite the second's kept
 * part, and its place land over the second's. The shape is the expediter's probe: the first extraction is held, the second one is refused by main's one slot (so the second's sound is
 * not in the studio), and then the first one's answer arrives. Each case names what the base does.
 */
describe('a project open that a newer one overtook changes nothing (T-198 (2))', () => {
  const VIDEO_A = '/home/user/Videos/a-first.mp4'
  const VIDEO_B = '/home/user/Videos/b-second.mp4'
  const FLV_A = '/home/user/Videos/a-first.flv'
  const FLV_B = '/home/user/Videos/b-second.flv'
  const WAV_A = '/tmp/imagii-audio/aaaaaaaaaa.wav'
  const CHAIN_A: ChainSpec = { ...DEFAULT_CHAIN_SPEC, hum60: true }
  const CHAIN_B: ChainSpec = { ...DEFAULT_CHAIN_SPEC, rumbleHighpass: true }
  const BUSY = new Error("Error invoking remote method 'audio:extractFromVideo': Error: Still extracting the sound from \"a-first.mp4\". Wait for it to finish, then try again.")
  type Held = { resolve: (v: never) => void; reject: (e: Error) => void }
  const extractions: Record<string, Held> = {}
  const conversions: Record<string, Held> = {}
  /** Per video: held until the test answers it, or refused at once (main's one slot); every other extraction answers at once. */
  const mode: Record<string, 'hold' | 'refuse'> = {}
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  function bridge(): void {
    for (const k of Object.keys(extractions)) delete extractions[k]
    for (const k of Object.keys(conversions)) delete conversions[k]
    for (const k of Object.keys(mode)) delete mode[k]
    vi.stubGlobal('window', {
      api: {
        video: {
          probe: (_p: string) => Promise.resolve(VIDEO_PROBE),
          fileUrl: (p: string) => pathToImagiiFileUrl(p),
          convertForImport: (p: string) =>
            mode[p] === 'refuse'
              ? Promise.reject(new Error("Error invoking remote method 'video:convertForImport': Error: Still converting \"a-first.flv\". Wait for it to finish, then try again."))
              : new Promise((resolve, reject) => { conversions[p] = { resolve: resolve as Held['resolve'], reject } })
        },
        audio: {
          ...PEAKS_BRIDGE,
          probe: (_p: string) => Promise.resolve(AUDIO_PROBE),
          extractFromVideo: (p: string) =>
            mode[p] === 'refuse'
              ? Promise.reject(BUSY)
              : mode[p] === 'hold'
                ? new Promise((resolve, reject) => { extractions[p] = { resolve: resolve as Held['resolve'], reject } })
                : Promise.resolve(sound(`/tmp/imagii-audio/${p.length}-now.wav`, true))
        }
      }
    })
  }

  const project = (video: string, chain: ChainSpec, extra: Partial<ImagiiProject> = {}): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    videoStudio: { sourcePath: video, clips: [], selectedClipId: null, watermark: null, srtPath: null },
    audioStudio: { sourcePath: video, extractedFromVideo: true, chain },
    ...extra
  })
  const converted = (video: string, extra: Partial<ImagiiProject> = {}): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: 1_700_000_000_000,
    appVersion: '1.0.0',
    videoStudio: { sourcePath: video, convertedForImport: true, clips: [CLIP_A], selectedClipId: CLIP_A.id, watermark: null, srtPath: null },
    ...extra
  })
  /** What Save project would write right now. */
  const saved = (): ImagiiProject => captureProject()

  /** P1 opens and waits on its extraction; P2 opens over it and its extraction is refused. Returns both applies, P2 settled. */
  async function overtaken(first: ImagiiProject, second: ImagiiProject): Promise<{ first: Promise<Awaited<ReturnType<typeof applyProject>>>; second: Awaited<ReturnType<typeof applyProject>> }> {
    mode[VIDEO_A] = 'hold'
    mode[VIDEO_B] = 'refuse'
    const p1 = applyProject(first)
    await flush()
    expect(extractions[VIDEO_A], 'the first open is waiting on its extraction').toBeDefined()
    return { first: p1, second: await applyProject(second) }
  }

  beforeEach(() => {
    bridge()
    useReferencesStore.getState().setTab('reference')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // A session that holds no kept part from an earlier case: open a sound, then close it.
    useAudioStore.getState().clearSource()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('the older open\'s LATE SUCCESS does not load its sound over the newer one\'s session (red on the base: the sound of a-first.mp4 and its Hum removal)', async () => {
    const { first, second } = await overtaken(project(VIDEO_A, CHAIN_A), project(VIDEO_B, CHAIN_B))
    expect(second.failed, 'the newer open\'s extraction was refused').toHaveLength(1)
    extractions[VIDEO_A]!.resolve(sound(WAV_A, true) as never)
    await first
    await flush()
    expect(useAudioStore.getState().source, 'the older sound did not land').toBeNull()
    expect(useAudioStore.getState().chain, 'and the chain is not the older open\'s').toEqual(DEFAULT_CHAIN_SPEC)
    // Save project writes the newer open's video and its kept sound part - nothing of the older one.
    expect(saved().videoStudio?.sourcePath).toBe(VIDEO_B)
    expect(saved().audioStudio).toEqual({ sourcePath: VIDEO_B, extractedFromVideo: true, chain: CHAIN_B })
  })

  it('the older open\'s LATE FAILURE keeps no part: the newer open\'s kept part is what Save writes (red on the base: a-first.mp4 and its chain)', async () => {
    const { first, second } = await overtaken(project(VIDEO_A, CHAIN_A), project(VIDEO_B, CHAIN_B))
    expect(second.failed).toHaveLength(1)
    extractions[VIDEO_A]!.reject(new Error('ffmpeg exited with code 1'))
    const older = await first
    expect(older.failed, 'the failure is the older open\'s to report - and nobody does').toHaveLength(1)
    expect(saved().audioStudio).toEqual({ sourcePath: VIDEO_B, extractedFromVideo: true, chain: CHAIN_B })
  })

  it('the outcome says which open was overtaken: the older one is superseded, the newer one and a lone open are not (red on the base: the field is not there)', async () => {
    const { first, second } = await overtaken(project(VIDEO_A, CHAIN_A), project(VIDEO_B, CHAIN_B))
    expect(second.superseded, 'the newest open is never superseded').toBe(false)
    extractions[VIDEO_A]!.resolve(sound(WAV_A, true) as never)
    expect((await first).superseded).toBe(true)
    // Guard: a lone open, with a wait in it, is the newest one and says so.
    useVideoStore.getState().clearSource()
    useAudioStore.getState().clearSource()
    mode[VIDEO_A] = 'hold'
    const lone = applyProject(project(VIDEO_A, CHAIN_A))
    await flush()
    extractions[VIDEO_A]!.resolve(sound(WAV_A, true) as never)
    const outcome = await lone
    expect(outcome.superseded).toBe(false)
    expect(useAudioStore.getState().source, 'and its sound lands as it always did').not.toBeNull()
    expect(useAudioStore.getState().chain).toEqual(CHAIN_A)
  })

  it('a superseded open puts no place: the newer open\'s References tab stands (red on the base: the older one\'s tab lands last)', async () => {
    const { first } = await overtaken(
      project(VIDEO_A, CHAIN_A, { place: { route: '/audio', referencesTab: 'assets' } }),
      project(VIDEO_B, CHAIN_B, { place: { route: '/video', referencesTab: 'moodboards' } })
    )
    expect(useReferencesStore.getState().tab, 'the newer open put its place').toBe('moodboards')
    extractions[VIDEO_A]!.resolve(sound(WAV_A, true) as never)
    await first
    expect(useReferencesStore.getState().tab).toBe('moodboards')
  })

  it('a converted video\'s LATE conversion does not open over the newer open (red on the base: the older video and its clips land, the newer part is dropped)', async () => {
    mode[FLV_B] = 'refuse'
    const p1 = applyProject(converted(FLV_A))
    await flush()
    expect(conversions[FLV_A], 'the first open is converting').toBeDefined()
    const second = await applyProject(converted(FLV_B))
    expect(second.failed).toHaveLength(1)
    conversions[FLV_A]!.resolve('/tmp/imagii-video/converted-a.mp4' as never)
    const older = await p1
    expect(useVideoStore.getState().source, 'the older conversion did not open').toBeNull()
    expect(saved().videoStudio?.sourcePath, 'Save writes the newer open\'s kept part').toBe(FLV_B)
    expect(older.superseded).toBe(true)
  })

  it('a converted video\'s LATE FAILURE keeps no part: the newer open\'s kept video part is what Save writes (red on the base: the older file and its clips)', async () => {
    mode[FLV_B] = 'refuse'
    const p1 = applyProject(converted(FLV_A))
    await flush()
    const second = await applyProject(converted(FLV_B))
    expect(second.failed).toHaveLength(1)
    conversions[FLV_A]!.reject(new Error('ffmpeg exited with code 1'))
    const older = await p1
    expect(saved().videoStudio?.sourcePath).toBe(FLV_B)
    expect(older.superseded).toBe(true)
  })

  it('an open overtaken in its VIDEO wait skips its sound: it does not take the slot or drop the newer open\'s kept part (red on the base: the older sound opens)', async () => {
    // P1: a converted video whose conversion is held, with a sound; P2: a video and a sound whose extraction is refused (it keeps its part).
    mode[VIDEO_B] = 'refuse'
    const p1 = applyProject({ ...converted(FLV_A), audioStudio: { sourcePath: VIDEO_A, extractedFromVideo: true, chain: CHAIN_A } })
    await flush()
    expect(conversions[FLV_A], 'the first open is converting').toBeDefined()
    const second = await applyProject(project(VIDEO_B, CHAIN_B))
    expect(second.failed).toHaveLength(1)
    conversions[FLV_A]!.resolve('/tmp/imagii-video/converted-a.mp4' as never)
    const older = await p1
    expect(useAudioStore.getState().source, 'the older open\'s sound was not opened').toBeNull()
    expect(saved().audioStudio, 'the newer open\'s kept part is still the one Save writes').toEqual({ sourcePath: VIDEO_B, extractedFromVideo: true, chain: CHAIN_B })
    expect(older.superseded).toBe(true)
  })
})
