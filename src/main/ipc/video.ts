import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { VIDEO_EXTENSIONS } from '../../shared/mediaFormats'
import { convertForImport } from '../ffmpeg/convert'
import { probeVideo } from '../ffmpeg/probe'
import { runExportJob, cancelExportJob, cancelAllExportJobs } from '../ffmpeg/export'
import { runReframe, cancelReframeJob, type ReframeJobSpec } from '../ffmpeg/reframe'
import {
  analyzeClipHook,
  findHighlights,
  cancelActiveHighlightScan
} from '../ffmpeg/highlights'
import { runGifExport, cancelGifJob } from '../ffmpeg/gif'
import { runConcat, runPipComposite, cancelConcatJob } from '../ffmpeg/concat'
import { extractFrame, makeKitDir } from '../ffmpeg/frame'
import { ALL_PRESET_IDS } from '../ffmpeg/presets'
import {
  listCustomPresets,
  saveCustomPreset,
  deleteCustomPreset
} from '../customPresets'
import { nanoid } from 'nanoid'
import type { ExportJobSpec, ExportResult } from '../../shared/clip'
import type { CustomPreset } from '../../shared/customPresets'
import { isValidBitrate } from '../../shared/customPresets'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertRange,
  assertEnum,
  assertArray,
  assertPlainObject
} from '../../shared/validators'
import { assert } from '../../shared/assert'
import { assertSafeAbsolutePath } from '../../shared/pathSafety'
import { isValidTextOverlay } from '../../shared/projectValidation'

const REFRAME_POSITIONS = ['left', 'center', 'right', 'smart'] as const
const PIP_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

// Round 17 B2/B4/B5: validate a renderer-supplied job id (same alphabet as
// nanoid) and fall back to a freshly-minted id when the renderer didn't
// pass one. Keeps the IPC API safe for callers older than round 17.
const SAFE_JOB_ID_RE = /^[A-Za-z0-9_-]+$/
function pickJobId(provided: unknown): string {
  if (typeof provided === 'string' && provided.length > 0) {
    assert(SAFE_JOB_ID_RE.test(provided), 'jobId must match nanoid alphabet')
    assert(provided.length <= 64, 'jobId too long')
    return provided
  }
  return nanoid(10)
}

function validateExportJob(job: unknown, idx: number): asserts job is ExportJobSpec {
  assertPlainObject(job, `jobs[${idx}]`)
  assertNonEmptyString(job.jobId, `jobs[${idx}].jobId`)
  assertNonEmptyString(job.sourcePath, `jobs[${idx}].sourcePath`)
  assertNonEmptyString(job.outDir, `jobs[${idx}].outDir`)
  // INIT-C (round 15): every path field also needs the no-traversal gate, not
  // just the non-empty-string check — match the captions/audio IPC style.
  assertSafeAbsolutePath(job.sourcePath, `jobs[${idx}].sourcePath`)
  assertSafeAbsolutePath(job.outDir, `jobs[${idx}].outDir`)
  assertPlainObject(job.clip, `jobs[${idx}].clip`)
  const clip = job.clip
  assertFiniteNonNeg(clip.startSec, `jobs[${idx}].clip.startSec`)
  assertFiniteNonNeg(clip.endSec, `jobs[${idx}].clip.endSec`)
  assert((clip.endSec as number) > (clip.startSec as number), `jobs[${idx}].clip range invalid (endSec must exceed startSec)`)
  // textOverlays reach FFmpeg's drawtext filter string raw — a malformed
  // colorHex / sizePx is a filter-graph injection vector. Reject here so a
  // bad overlay cannot pass through the video:exportBatch IPC boundary.
  const overlays = clip.textOverlays
  if (overlays !== undefined) {
    assertArray(overlays, `jobs[${idx}].clip.textOverlays`, 1000)
    for (let i = 0; i < overlays.length; i++) {
      assert(
        isValidTextOverlay(overlays[i]),
        `jobs[${idx}].clip.textOverlays[${i}] malformed`
      )
    }
  }
  assertEnum(job.preset, ALL_PRESET_IDS, `jobs[${idx}].preset`)
  // T-50: a custom preset overrides the encoder's geometry and bitrates, so
  // every field of it reaches ffmpeg's argv. The preset comes off disk in a
  // directory the user can edit, and arrives here through the renderer —
  // validate it at the boundary exactly like the platform id above.
  if (job.customPreset !== undefined && job.customPreset !== null) {
    assertCustomPreset(job.customPreset, `jobs[${idx}].customPreset`)
  }
}

function assertCustomPreset(preset: unknown, name: string): asserts preset is CustomPreset {
  assertPlainObject(preset, name)
  assertNonEmptyString(preset.name, `${name}.name`)
  assertRange(preset.width, 16, 16384, `${name}.width`)
  assertRange(preset.height, 16, 16384, `${name}.height`)
  assertRange(preset.fps, 1, 240, `${name}.fps`)
  assert(isValidBitrate(preset.videoBitrate), `${name}.videoBitrate malformed`)
  assert(isValidBitrate(preset.audioBitrate), `${name}.audioBitrate malformed`)
}

export function registerVideoIpc(): void {
  ipcMain.handle('video:probe', async (_e, filePath: string) => {
    assertNonEmptyString(filePath, 'video:probe filePath')
    // INIT-C (round 15): defend the file system against traversal payloads.
    assertSafeAbsolutePath(filePath, 'video:probe filePath')
    return probeVideo(filePath)
  })

  ipcMain.handle('video:convertForImport', async (_e, filePath: string) => {
    assertNonEmptyString(filePath, 'video:convertForImport filePath')
    assertSafeAbsolutePath(filePath, 'video:convertForImport filePath')
    return convertForImport(filePath)
  })

  ipcMain.handle('video:pickFile', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a video',
      properties: ['openFile'],
      filters: [
        {
          name: 'Video',
          extensions: [...VIDEO_EXTENSIONS]
        },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('video:pickOutputDir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose where to save exports',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'video:exportBatch',
    async (e, jobs: ExportJobSpec[]): Promise<ExportResult[]> => {
      assertArray<ExportJobSpec>(jobs, 'jobs', 1000)
      assert(jobs.length > 0, 'jobs must not be empty')
      const len = jobs.length
      for (let i = 0; i < len; i++) {
        validateExportJob(jobs[i], i)
      }
      const results: ExportResult[] = []
      for (const job of jobs) {
        const result = await runExportJob(job, (progress) => {
          e.sender.send('video:progress', progress)
        })
        results.push(result)
        e.sender.send('video:jobComplete', { jobId: job.jobId, outputPath: result.outputPath })
      }
      return results
    }
  )

  ipcMain.handle('video:cancel', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancel jobId')
    return cancelExportJob(jobId)
  })
  ipcMain.handle('video:cancelAll', () => cancelAllExportJobs())

  ipcMain.handle('video:revealInFolder', (_e, filePath: string) => {
    assertNonEmptyString(filePath, 'video:revealInFolder filePath')
    // INIT-C (round 15)
    assertSafeAbsolutePath(filePath, 'video:revealInFolder filePath')
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(
    'video:reframe',
    async (
      e,
      params: {
        jobId?: string
        sourcePath: string
        outDir: string
        position: 'left' | 'center' | 'right' | 'smart'
        startSec: number
        endSec: number
        targetWidth: number
        targetHeight: number
      }
    ): Promise<{ outputPath: string }> => {
      assertPlainObject(params, 'video:reframe params')
      assertNonEmptyString(params.sourcePath, 'sourcePath')
      assertNonEmptyString(params.outDir, 'outDir')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.sourcePath, 'sourcePath')
      assertSafeAbsolutePath(params.outDir, 'outDir')
      assertEnum(params.position, REFRAME_POSITIONS, 'position')
      assertFiniteNonNeg(params.startSec, 'startSec')
      assertFiniteNonNeg(params.endSec, 'endSec')
      assert(params.endSec > params.startSec, 'reframe endSec must exceed startSec')
      assertRange(params.targetWidth, 16, 16384, 'targetWidth')
      assertRange(params.targetHeight, 16, 16384, 'targetHeight')
      const base = path.parse(params.sourcePath).name
      const outputName = `${base}_reframe-${params.targetWidth}x${params.targetHeight}-${params.position}.mp4`
      const outputPath = path.join(params.outDir, outputName)
      // Round 17 B1: accept a renderer-supplied jobId so the panel's Cancel
      // button has something to identify the in-flight job. Round 18: route
      // it through pickJobId like every sibling per-job endpoint, so this
      // handler gets the same charset/length gate.
      const jobId = pickJobId(params.jobId)
      const spec: ReframeJobSpec = {
        jobId,
        sourcePath: params.sourcePath,
        outputPath,
        position: params.position,
        startSec: params.startSec,
        endSec: params.endSec,
        outputWidth: params.targetWidth,
        outputHeight: params.targetHeight
      }
      const result = await runReframe(spec, (progress) =>
        e.sender.send('video:reframeProgress', progress)
      )
      return { outputPath: result.outputPath }
    }
  )

  ipcMain.handle(
    'video:findHighlights',
    async (e, sourcePath: string) => {
      assertNonEmptyString(sourcePath, 'video:findHighlights sourcePath')
      // INIT-C (round 15)
      assertSafeAbsolutePath(sourcePath, 'video:findHighlights sourcePath')
      const jobId = `highlights-${Date.now()}`
      const candidates = await findHighlights(jobId, sourcePath, (p) =>
        e.sender.send('video:highlightProgress', p)
      )
      return candidates
    }
  )

  // Phase 4C: hook indicator. Fast single-pass ebur128 over first N seconds
  // of the clip range — UI calls this lazily on the selected clip.
  ipcMain.handle(
    'video:analyzeClipHook',
    async (
      _e,
      params: { sourcePath: string; startSec: number; durationSec?: number }
    ) => {
      assertPlainObject(params, 'video:analyzeClipHook params')
      assertNonEmptyString(params.sourcePath, 'sourcePath')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.sourcePath, 'sourcePath')
      assertFiniteNonNeg(params.startSec, 'startSec')
      const dur = params.durationSec ?? 3
      assertRange(dur, 0.5, 30, 'durationSec')
      return analyzeClipHook(params.sourcePath, params.startSec, dur)
    }
  )

  // Phase 4D: Clip Kit support — single-frame thumbnail extraction
  // and create-named-subfolder, both small fast ops.
  ipcMain.handle(
    'video:extractFrame',
    async (_e, params: { sourcePath: string; timeSec: number; outputPath: string }) => {
      assertPlainObject(params, 'video:extractFrame params')
      assertNonEmptyString(params.sourcePath, 'sourcePath')
      assertFiniteNonNeg(params.timeSec, 'timeSec')
      assertNonEmptyString(params.outputPath, 'outputPath')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.sourcePath, 'sourcePath')
      assertSafeAbsolutePath(params.outputPath, 'outputPath')
      return extractFrame(params.sourcePath, params.timeSec, params.outputPath)
    }
  )

  ipcMain.handle(
    'video:makeKitDir',
    async (_e, params: { parentDir: string; clipName: string }) => {
      assertPlainObject(params, 'video:makeKitDir params')
      assertNonEmptyString(params.parentDir, 'parentDir')
      assertNonEmptyString(params.clipName, 'clipName')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.parentDir, 'parentDir')
      return makeKitDir(params.parentDir, params.clipName)
    }
  )

  ipcMain.handle('video:listCustomPresets', () => listCustomPresets())
  ipcMain.handle(
    'video:saveCustomPreset',
    (_e, preset: Omit<CustomPreset, 'id'>) => {
      assertPlainObject(preset, 'preset')
      assertNonEmptyString(preset.name, 'preset.name')
      assertRange(preset.width, 16, 16384, 'preset.width')
      assertRange(preset.height, 16, 16384, 'preset.height')
      assertRange(preset.fps, 1, 240, 'preset.fps')
      // T-50: presets are export targets now, so a bitrate that ffmpeg
      // cannot parse must never reach disk — a saved preset promises it can
      // be used.
      assert(isValidBitrate(preset.videoBitrate), 'preset.videoBitrate malformed')
      assert(isValidBitrate(preset.audioBitrate), 'preset.audioBitrate malformed')
      return saveCustomPreset(preset)
    }
  )
  ipcMain.handle('video:deleteCustomPreset', (_e, id: string) => {
    assertNonEmptyString(id, 'preset id')
    return deleteCustomPreset(id)
  })

  ipcMain.handle(
    'video:concat',
    async (
      _e,
      params: {
        jobId?: string
        sourcePath: string
        outDir: string
        segments: Array<{ startSec: number; endSec: number; name: string }>
        fadeMs: number
        width: number
        height: number
      }
    ) => {
      assertPlainObject(params, 'video:concat params')
      assertNonEmptyString(params.sourcePath, 'sourcePath')
      assertNonEmptyString(params.outDir, 'outDir')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.sourcePath, 'sourcePath')
      assertSafeAbsolutePath(params.outDir, 'outDir')
      assertArray(params.segments, 'segments', 500)
      assert(params.segments.length > 0, 'segments must not be empty')
      const segs = params.segments
      const segLen = segs.length
      for (let i = 0; i < segLen; i++) {
        const seg = segs[i]
        assertPlainObject(seg, `segments[${i}]`)
        assertFiniteNonNeg(seg.startSec, `segments[${i}].startSec`)
        assertFiniteNonNeg(seg.endSec, `segments[${i}].endSec`)
        assert(seg.endSec > seg.startSec, `segments[${i}] range invalid (endSec must exceed startSec)`)
      }
      assertFiniteNonNeg(params.fadeMs, 'fadeMs')
      assertRange(params.width, 16, 16384, 'width')
      assertRange(params.height, 16, 16384, 'height')
      return runConcat({
        // Round 17 B4: accept a renderer-supplied jobId so per-job cancel
        // from CompilationPanel can target this specific stitch.
        jobId: pickJobId(params.jobId),
        sourcePath: params.sourcePath,
        outDir: params.outDir,
        segments: params.segments,
        fadeMs: params.fadeMs,
        width: params.width,
        height: params.height
      })
    }
  )

  ipcMain.handle(
    'video:pipComposite',
    async (
      _e,
      params: {
        jobId?: string
        basePath: string
        overlayPath: string
        outDir: string
        overlayWidth: number
        position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
        margin: number
      }
    ) => {
      assertPlainObject(params, 'video:pipComposite params')
      assertNonEmptyString(params.basePath, 'basePath')
      assertNonEmptyString(params.overlayPath, 'overlayPath')
      assertNonEmptyString(params.outDir, 'outDir')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.basePath, 'basePath')
      assertSafeAbsolutePath(params.overlayPath, 'overlayPath')
      assertSafeAbsolutePath(params.outDir, 'outDir')
      // Round 18: overlayWidth is PIXELS (the PIP panel sends 120-960 and
      // concat.ts scales the overlay to `${overlayWidth}:-1`). The prior
      // [0.05, 1] range — written as if this were a fraction — rejected
      // every real call, so PIP composite never produced output.
      assertRange(params.overlayWidth, 16, 3840, 'overlayWidth')
      assertEnum(params.position, PIP_POSITIONS, 'position')
      assertFiniteNonNeg(params.margin, 'margin')
      const base = path.parse(params.basePath).name
      const outputPath = path.join(params.outDir, `${base}_pip.mp4`)
      // Round 17 B5: PiP shares concat's activeJobs map, so a renderer-supplied
      // jobId lets cancelConcatJob target this pip job directly.
      return runPipComposite(pickJobId(params.jobId), params.basePath, params.overlayPath, outputPath, {
        overlayWidth: params.overlayWidth,
        position: params.position,
        margin: params.margin
      })
    }
  )

  ipcMain.handle(
    'video:exportGif',
    async (
      _e,
      params: {
        jobId?: string
        sourcePath: string
        outDir: string
        startSec: number
        endSec: number
        width: number
        fps: number
        speed: number
      }
    ) => {
      assertPlainObject(params, 'video:exportGif params')
      assertNonEmptyString(params.sourcePath, 'sourcePath')
      assertNonEmptyString(params.outDir, 'outDir')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.sourcePath, 'sourcePath')
      assertSafeAbsolutePath(params.outDir, 'outDir')
      assertFiniteNonNeg(params.startSec, 'startSec')
      assertFiniteNonNeg(params.endSec, 'endSec')
      assert(params.endSec > params.startSec, 'gif endSec must exceed startSec')
      assertRange(params.width, 16, 4096, 'width')
      assertRange(params.fps, 1, 60, 'fps')
      assertRange(params.speed, 0.1, 10, 'speed')
      return runGifExport({
        // Round 17 B2: per-job cancel from GifPanel needs a renderer-known id.
        jobId: pickJobId(params.jobId),
        sourcePath: params.sourcePath,
        outDir: params.outDir,
        startSec: params.startSec,
        endSec: params.endSec,
        width: params.width,
        fps: params.fps,
        speed: params.speed
      })
    }
  )

  // Round 17 B1/B2/B3/B4/B5: per-job cancel handlers. Each module already
  // tracks an activeJobs map (or a single slot for highlights). The panel-
  // level Cancel button calls the matching channel; the IPC promise rejects
  // when the ffmpeg child dies, and the panel's existing catch shows a toast.
  ipcMain.handle('video:cancelReframe', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancelReframe jobId')
    assert(SAFE_JOB_ID_RE.test(jobId), 'video:cancelReframe jobId malformed')
    return cancelReframeJob(jobId)
  })
  ipcMain.handle('video:cancelGif', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancelGif jobId')
    assert(SAFE_JOB_ID_RE.test(jobId), 'video:cancelGif jobId malformed')
    return cancelGifJob(jobId)
  })
  ipcMain.handle('video:cancelConcat', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancelConcat jobId')
    assert(SAFE_JOB_ID_RE.test(jobId), 'video:cancelConcat jobId malformed')
    return cancelConcatJob(jobId)
  })
  // PiP shares concat's activeJobs map (M3 fix round 15).
  ipcMain.handle('video:cancelPip', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancelPip jobId')
    assert(SAFE_JOB_ID_RE.test(jobId), 'video:cancelPip jobId malformed')
    return cancelConcatJob(jobId)
  })
  // Single-slot — no jobId required.
  ipcMain.handle('video:cancelHighlight', () => cancelActiveHighlightScan())
}
