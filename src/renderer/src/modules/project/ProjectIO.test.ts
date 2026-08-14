import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Clip } from '@shared/clip'
import type { ChainSpec } from '@shared/audio'
import type { CanvasDocument } from '@shared/canvas'
import type { ImagiiProject } from '@shared/workspace'
import {
  validateProject,
  validateProjectJsonString,
  isSafeToAutosave
} from '@shared/projectValidation'
import { pathToImagiiFileUrl } from '@shared/fileUrl'
import { captureProject, applyProject } from './ProjectIO'
import { useVideoStore } from '../video-studio/store/videoStore'
import { useAudioStore } from '../audio-studio/state/audioStore'
import { useCanvasStore } from '../image-studio/state/canvasStore'

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
  colorGrade: { brightness: 0.1, contrast: 1.2, saturation: 1.1, temperature: -5 },
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
  await useAudioStore.getState().loadSource(AUDIO_PATH, VIDEO_PATH)
  useAudioStore.setState({ chain: CHAIN })
  useCanvasStore.getState().setDocument(DOC)
}

function wipeAllStudios(): void {
  useVideoStore.getState().clearSource()
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
    expect(audio.source?.fromVideo).toEqual({ videoPath: VIDEO_PATH })
    expect(audio.chain).toEqual(CHAIN)

    expect(useCanvasStore.getState().doc).toEqual(DOC)
  })

  it('captureProject emits MAX_SCHEMA_VERSION and every studio key it has state for', async () => {
    await seedAllStudios()
    const captured = captureProject()
    expect(captured.schemaVersion).toBe(2)
    expect(captured.savedAt).toBeGreaterThan(0)
    expect(captured.videoStudio?.sourcePath).toBe(VIDEO_PATH)
    expect(captured.videoStudio?.srtPath).toBe(SRT_PATH)
    expect(captured.audioStudio?.sourcePath).toBe(AUDIO_PATH)
    expect(captured.audioStudio?.fromVideoPath).toBe(VIDEO_PATH)
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
      'unsupported schemaVersion 99 (supported: 1, 2)'
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
