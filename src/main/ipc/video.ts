import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { VIDEO_EXTENSIONS } from '../../shared/mediaFormats'
import { convertForImport } from '../ffmpeg/convert'
import { probeVideo } from '../ffmpeg/probe'
import {
  runExportJob,
  cancelAllExportJobs,
  beginExportBatch
} from '../ffmpeg/export'
import { runReframe, cancelReframeJob, type ReframeJobSpec } from '../ffmpeg/reframe'
import {
  analyzeClipHook,
  findHighlights,
  cancelActiveHighlightScan
} from '../ffmpeg/highlights'
import { runGifExport, cancelGifJob } from '../ffmpeg/gif'
import { runConcat, runPipComposite, cancelConcatJob } from '../ffmpeg/concat'
import { extractFrame, makeKitDir, removeKitDir, cancelAllFrameJobs } from '../ffmpeg/frame'
import { ALL_PRESET_IDS } from '../ffmpeg/presets'
import {
  listCustomPresets,
  saveCustomPreset,
  deleteCustomPreset
} from '../customPresets'
import { nanoid } from 'nanoid'
import type { ClipRecipe, CompileSegment, CropRect, ExportJobSpec, ExportResult } from '../../shared/clip'
import type { CustomPreset } from '../../shared/customPresets'
import { isValidBitrate } from '../../shared/customPresets'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertRange,
  assertEnum,
  assertArray,
  assertOptionalClipRecipe,
  assertOptionalCropRect,
  assertPlainObject
} from '../../shared/validators'
import { assertAlways } from '../../shared/assert'
import { HOOK_MAX_SOURCE_SEC, HOOK_MIN_SEC } from '../../shared/highlights'
import { assertSafeAbsolutePath, assertSafeId, isSafeAbsolutePath, SAFE_ID_RE } from '../../shared/pathSafety'
import { sendIfAlive } from '../sendIfAlive'
import { isExistingFolder } from '../ffmpeg/outputPath'
import { safeNamePart } from '../../shared/filename'
import { clipNameForSentence } from '../ffmpeg/noPicture'

const REFRAME_POSITIONS = ['left', 'center', 'right'] as const
const PIP_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

// Round 17 B2/B4/B5: validate a renderer-supplied job id (same alphabet as
// nanoid) and fall back to a freshly-minted id when the renderer didn't
// pass one. Keeps the IPC API safe for callers older than round 17.
function pickJobId(provided: unknown): string {
  if (typeof provided === 'string' && provided.length > 0) {
    assertAlways(SAFE_ID_RE.test(provided), 'jobId must match nanoid alphabet')
    assertAlways(provided.length <= 64, 'jobId too long')
    return provided
  }
  return nanoid(10)
}

/**
 * What a streamer is told when a clip's stored crop cannot be used (T-106). The
 * crop becomes `crop=` arguments in the filter graph, so `video:exportBatch`
 * checks it like Compile and the GIF do — and a project file is a file a person
 * can edit, which is how a crop like this arrives. The validator's own message is
 * a path into the payload ("jobs[2].clip.cropRect.w must be in [...]"), which
 * `userFacingError` rightly refuses to show; this is a finished sentence, which it
 * stands behind. The detail goes to the console.
 *
 * T-109: the same sentence for all three paths. Compile and the GIF used to throw
 * the validator's path-shaped message, which reached the person as the generic
 * "failed" line while the batch next to them told them what to do.
 */
const DAMAGED_CROP = "One of this project's clips has a damaged crop — redraw it and try again."

/** True for a display name worth using: a string with something in it (a blank one is no name). */
function hasSourceName(sourceName: unknown): sourceName is string {
  return typeof sourceName === 'string' && sourceName.trim() !== ''
}

/**
 * The base an output is named from (T-124 (17), T-125 (22)): the display name of the file the person opened, made safe the way Export's
 * `{source}` token is, else the scratch file's own name; then, for an output that is ONE clip's (Reframe, the GIF), `_<clip name>`. A converted import is played from `imagii-import/<name>-<nanoid>.mp4`,
 * so the path's basename is a working copy's: Reframe and the GIF named their files for it (`stream-aB3dE5fG_reframe-...`).
 * The renderer's string is joined into a path, so it is sanitized here, at the boundary.
 */
function outputBaseName(sourceName: unknown, sourcePath: string, clipName?: unknown): string {
  const source = hasSourceName(sourceName) ? safeNamePart(sourceName) : path.parse(sourcePath).name
  // T-125 (22): and the CLIP's name after it, as Export's `{source}_{clip}` does - six highlights of one VOD, reframed or turned into GIFs
  // with the same settings, came out as "name.mp4", "name (2).mp4" ... "name (6).mp4".
  return hasSourceName(clipName) ? `${source}_${safeNamePart(clipName)}` : source
}

function assertUsableCrop(cropRect: unknown, channel: string, name: string): void {
  try {
    assertOptionalCropRect(cropRect, name)
  } catch (err) {
    console.error(`[imagii] ${channel} refused a clip crop:`, err)
    throw new Error(DAMAGED_CROP)
  }
}

/**
 * What a streamer is told when the rest of a clip's recipe cannot be used (T-111):
 * a speed, a color grade, an effect flag or a piece of text that is outside what
 * the filter graph can take. Same reasoning as `DAMAGED_CROP` — the validator's
 * own message is a path into the payload, which `userFacingError` rightly refuses
 * to show, so this is the finished sentence it stands behind, and the detail goes
 * to the console. Before this the batch checked the crop and the overlays and
 * nothing else: a speed of 1e-6 (a hand-edited project) wrote a 261-byte file and
 * reported success.
 */
const DAMAGED_CLIP =
  "One of this project's clips has a setting imagii can't use — check its speed, color and text, then try again."

function assertUsableRecipe(clip: Record<string, unknown>, channel: string, name: string): void {
  try {
    assertOptionalClipRecipe(clip, name)
  } catch (err) {
    console.error(`[imagii] ${channel} refused a clip recipe:`, err)
    throw new Error(DAMAGED_CLIP)
  }
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
  assertAlways((clip.endSec as number) > (clip.startSec as number), `jobs[${idx}].clip range invalid (endSec must exceed startSec)`)
  assertUsableCrop(clip.cropRect, 'video:exportBatch', `jobs[${idx}].clip.cropRect`)
  // T-111: the rest of the recipe — speed, grade, effect flags and the text
  // overlays — becomes filter-graph text too (an overlay's color and size
  // reach `drawtext` raw, which is how a crafted one injects directives), and
  // Compile has checked all of it since T-105 while the batch checked only the
  // crop. The crop was refused first, in its own sentence.
  assertUsableRecipe(clip, 'video:exportBatch', `jobs[${idx}].clip`)
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
  assertAlways(isValidBitrate(preset.videoBitrate), `${name}.videoBitrate malformed`)
  assertAlways(isValidBitrate(preset.audioBitrate), `${name}.audioBitrate malformed`)
}

/**
 * What a streamer is told when they start a batch while another is still going
 * (T-111). Two renderer surfaces start batches — the Export panel and Clip Kit —
 * and nothing between them stopped a second from starting under the first: both
 * ran at once (two libx264 encodes fighting for the CPU, progress events of two
 * batches interleaved on one channel, two Cancels aimed at the same registry),
 * and a cancel of either stopped both. A finished sentence, so it reaches them as
 * written.
 */
const EXPORT_ALREADY_RUNNING =
  'An export is already running. Wait for it to finish, or cancel it, then try again.'

/**
 * What a streamer is told when they start a conversion while another is still going (T-136 (2)). `video:convertForImport` is one function with three
 * callers - the Importer's flv / ts / wmv / mpg transcode, the Player's "Make a preview copy" and the project open's re-convert - and each kept its
 * own busy flag in the renderer, where a trip to Home re-armed it over a transcode main was still running: a second press ran a SECOND libx264 (two
 * encodes fighting for the CPU, two working copies of up to gigabytes) and the Importer's second landing replaced the video being edited. The guard
 * goes where every caller goes through, as `audio:extractFromVideo`'s does (T-135 (1)). A finished sentence naming the file that is being converted,
 * so it reaches the person as written; the name is cut by code point and the sentence stays on one line.
 */
function convertBusyMessage(runningFor: string): string {
  const name = clipNameForSentence({ name: path.basename(runningFor) })
  return `Still converting ${name ? `"${name}"` : 'another video'}. Wait for it to finish, then try again.`
}

/**
 * What a streamer is told when they press "Scan VOD" while a scan is still going (T-138 (9)). `highlights.ts` keeps ONE scan slot, and the panel's busy flag is the
 * renderer's: a renderer reload (the render-process-gone auto-reload, Ctrl+R) starts a fresh store over a scan main is still running, and a second press ran a
 * SECOND ffmpeg whose slot overwrote the first's - Cancel then reached only the newest, and the older survived the quit. The guard goes where every caller goes
 * through, as `video:convertForImport`'s does. A finished sentence naming the video that is being scanned, so it reaches the person as written; the name is cut by
 * code point and the sentence stays on one line.
 */
function scanBusyMessage(runningFor: string): string {
  const name = clipNameForSentence({ name: path.basename(runningFor) })
  return `Still scanning ${name ? `"${name}"` : 'another video'} for highlights. Wait for it to finish, then try again.`
}

export function registerVideoIpc(): void {
  // Per registration, not per module: the app registers once, and a test that
  // registers again starts with the gate open.
  let exportBatchRunning = false
  // T-136 (2): the file `video:convertForImport` is transcoding right now, or null. One conversion at a time, whoever asks. Claimed before the
  // handler's first await, given back in a `finally`.
  let convertingFor: string | null = null
  // T-138 (9): the video `video:findHighlights` is scanning right now, or null. One scan at a time, whoever asks - the slot in `highlights.ts` is single, and the
  // renderer's own flag does not survive a reload. Claimed before the handler's first await, given back in a `finally`.
  let scanningFor: string | null = null

  ipcMain.handle('video:probe', async (_e, filePath: string) => {
    assertNonEmptyString(filePath, 'video:probe filePath')
    // INIT-C (round 15): defend the file system against traversal payloads.
    assertSafeAbsolutePath(filePath, 'video:probe filePath')
    return probeVideo(filePath)
  })

  ipcMain.handle('video:convertForImport', async (_e, filePath: string) => {
    assertNonEmptyString(filePath, 'video:convertForImport filePath')
    assertSafeAbsolutePath(filePath, 'video:convertForImport filePath')
    if (convertingFor !== null) throw new Error(convertBusyMessage(convertingFor))
    convertingFor = filePath
    try {
      return await convertForImport(filePath)
    } finally {
      convertingFor = null
    }
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

  ipcMain.handle('video:pickOutputDir', async (_e, defaultPath?: unknown) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose where to save exports',
      // T-120: where the chooser opens (Clip Kit passes the folder it last wrote to). It only decides where a
      // dialog starts, and the value was read off disk, so one that is not a usable absolute path is ignored
      // rather than refused: a stale or hand-edited setting must not stop a kit. T-125 (10): and one that is
      // not a folder that EXISTS now (deleted, an unplugged drive) is ignored the same way.
      ...(isSafeAbsolutePath(defaultPath) && (await isExistingFolder(defaultPath)) ? { defaultPath } : {}),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'video:exportBatch',
    async (e, jobs: ExportJobSpec[]): Promise<ExportResult[]> => {
      // T-111: one batch at a time. Claimed synchronously, before any await, so two
      // calls arriving together cannot both pass (the transcription gate's rule).
      if (exportBatchRunning) throw new Error(EXPORT_ALREADY_RUNNING)
      assertArray<ExportJobSpec>(jobs, 'jobs', 1000)
      assertAlways(jobs.length > 0, 'jobs must not be empty')
      const len = jobs.length
      for (let i = 0; i < len; i++) {
        validateExportJob(jobs[i], i)
      }
      exportBatchRunning = true
      const results: ExportResult[] = []
      // T-98: the batch holds a run open from its first job to its last, so a
      // Cancel that lands in the instant between two jobs — nothing is
      // encoding, so there is no child to kill — stops the jobs not yet started
      // instead of being a click that canceled nothing.
      const batch = beginExportBatch()
      try {
        for (const job of jobs) {
          batch.check()
          const result = await runExportJob(job, (progress) => {
            sendIfAlive(e.sender, 'video:progress', progress)
          })
          results.push(result)
          sendIfAlive(e.sender, 'video:jobComplete', {
            jobId: job.jobId,
            outputPath: result.outputPath
          })
        }
      } finally {
        batch.end()
        exportBatchRunning = false
      }
      return results
    }
  )

  // The Export panel's Cancel and Clip Kit's: a kit is a batch of exports and
  // then three frame extracts, so its Cancel has to reach both (T-98).
  ipcMain.handle('video:cancelAll', () => {
    cancelAllExportJobs()
    cancelAllFrameJobs()
  })

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
        /** The name of the file the person opened, without its extension: what the output is named from (T-124 (17)). */
        sourceName?: string
        /** The clip's name, which follows it in the file's (T-125 (22)). */
        clipName?: string
        outDir: string
        position: 'left' | 'center' | 'right'
        startSec: number
        endSec: number
        targetWidth: number
        targetHeight: number
        // The clip's whole recipe (T-125 (9); the crop and the speed since T-124 (16)): `ReframeJobSpec` is `Partial<ClipRecipe>`.
      } & Partial<ClipRecipe>
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
      assertAlways(params.endSec > params.startSec, 'reframe endSec must exceed startSec')
      assertRange(params.targetWidth, 16, 16384, 'targetWidth')
      assertRange(params.targetHeight, 16, 16384, 'targetHeight')
      // T-124 (16), T-125 (9): the clip's recipe becomes filter-graph text (an overlay's color and size reach `drawtext` raw, which is
      // how a crafted one injects directives); a damaged one is refused in the batch's sentences (the crop first, in its own),
      // before any ffmpeg exists. The WHOLE recipe, as Compile's segments are checked (`assertUsableRecipe` reads only its fields).
      assertUsableCrop(params.cropRect, 'video:reframe', 'cropRect')
      assertUsableRecipe(params, 'video:reframe', 'params')
      const base = outputBaseName(params.sourceName, params.sourcePath, params.clipName)
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
        outputHeight: params.targetHeight,
        cropRect: params.cropRect,
        speedMultiplier: params.speedMultiplier,
        textOverlays: params.textOverlays,
        colorGrade: params.colorGrade,
        autoZoom: params.autoZoom,
        hypeShake: params.hypeShake
      }
      const result = await runReframe(spec, (progress) =>
        sendIfAlive(e.sender, 'video:reframeProgress', progress)
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
      if (scanningFor !== null) throw new Error(scanBusyMessage(scanningFor))
      scanningFor = sourcePath
      try {
        const jobId = `highlights-${Date.now()}`
        return await findHighlights(jobId, sourcePath, (p) =>
          sendIfAlive(e.sender, 'video:highlightProgress', p)
        )
      } finally {
        scanningFor = null
      }
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
      // The range the badge asks within (`hookWindow` hands back nothing outside it).
      assertRange(dur, HOOK_MIN_SEC, HOOK_MAX_SOURCE_SEC, 'durationSec')
      return analyzeClipHook(params.sourcePath, params.startSec, dur)
    }
  )

  // Phase 4D: Clip Kit support — single-frame thumbnail extraction
  // and create-named-subfolder, both small fast ops.
  ipcMain.handle(
    'video:extractFrame',
    async (_e, params: { sourcePath: string; timeSec: number; outputPath: string; cropRect?: CropRect | null }) => {
      assertPlainObject(params, 'video:extractFrame params')
      assertNonEmptyString(params.sourcePath, 'sourcePath')
      assertFiniteNonNeg(params.timeSec, 'timeSec')
      assertNonEmptyString(params.outputPath, 'outputPath')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.sourcePath, 'sourcePath')
      assertSafeAbsolutePath(params.outputPath, 'outputPath')
      // T-130 (t): the clip's crop becomes a `crop=` stage in the filter string, as on the other four paths - refused in the same one sentence.
      assertUsableCrop(params.cropRect, 'video:extractFrame', 'cropRect')
      return extractFrame(params.sourcePath, params.timeSec, params.outputPath, params.cropRect ?? null)
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

  // T-112: a canceled or failed kit that wrote nothing takes its empty folder with it.
  // `removeKitDir` is a non-recursive rmdir, so it cannot remove a folder with files in it.
  ipcMain.handle('video:removeKitDir', async (_e, kitDir: string) => {
    assertNonEmptyString(kitDir, 'video:removeKitDir kitDir')
    assertSafeAbsolutePath(kitDir, 'video:removeKitDir kitDir')
    await removeKitDir(kitDir)
  })

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
      assertAlways(isValidBitrate(preset.videoBitrate), 'preset.videoBitrate malformed')
      assertAlways(isValidBitrate(preset.audioBitrate), 'preset.audioBitrate malformed')
      return saveCustomPreset(preset)
    }
  )
  ipcMain.handle('video:deleteCustomPreset', (_e, id: string) => {
    // T-128 (6): the id becomes `<userData>/export-presets/<id>.json` and is unlinked. The store checks it again; the handler is
    // where it first arrives (the gate `audio:deletePreset` has had since T-117).
    assertNonEmptyString(id, 'preset id')
    assertSafeId(id, 'preset id')
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
        segments: CompileSegment[]
        fadeMs: number
        width: number
        height: number
        /** The name of the file the person opened, without its extension: the compilation is named from it (T-125 (22)). */
        sourceName?: string
      }
    ) => {
      assertPlainObject(params, 'video:concat params')
      assertNonEmptyString(params.sourcePath, 'sourcePath')
      assertNonEmptyString(params.outDir, 'outDir')
      // INIT-C (round 15)
      assertSafeAbsolutePath(params.sourcePath, 'sourcePath')
      assertSafeAbsolutePath(params.outDir, 'outDir')
      assertArray(params.segments, 'segments', 500)
      assertAlways(params.segments.length > 0, 'segments must not be empty')
      const segs = params.segments
      const segLen = segs.length
      for (let i = 0; i < segLen; i++) {
        const seg = segs[i]
        assertPlainObject(seg, `segments[${i}]`)
        assertFiniteNonNeg(seg.startSec, `segments[${i}].startSec`)
        assertFiniteNonNeg(seg.endSec, `segments[${i}].endSec`)
        assertAlways(seg.endSec > seg.startSec, `segments[${i}] range invalid (endSec must exceed startSec)`)
        // T-96 / T-105: the clip's recipe — its crop, speed, grade, effects and
        // text — becomes part of the filter graph. The crop first, in the plain
        // sentence the batch uses (T-109); the rest of the recipe is checked after.
        assertUsableCrop(seg.cropRect, 'video:concat', `segments[${i}].cropRect`)
        // T-113: the rest of it too, in the batch's sentence (it used to throw the
        // validator's path-shaped message, which reached the person as "Compilation failed.").
        assertUsableRecipe(seg, 'video:concat', `segments[${i}]`)
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
        height: params.height,
        // T-125 (22): `stream-aB3dE5fG_compilation.mp4` was the working copy's name, the bug Reframe and the GIF had until T-124 (17).
        ...(hasSourceName(params.sourceName) ? { sourceName: safeNamePart(params.sourceName) } : {})
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
        cropRect?: CropRect | null
        /** The name of the file the person opened, without its extension (T-124 (17)). */
        sourceName?: string
        /** The clip's name, which follows it in the file's (T-125 (22)). */
        clipName?: string
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
      assertAlways(params.endSec > params.startSec, 'gif endSec must exceed startSec')
      assertRange(params.width, 16, 4096, 'width')
      assertRange(params.fps, 1, 60, 'fps')
      assertRange(params.speed, 0.1, 10, 'speed')
      // T-96: the clip's crop becomes `crop=` arguments in the filter graph.
      assertUsableCrop(params.cropRect, 'video:exportGif', 'cropRect')
      return runGifExport({
        // Round 17 B2: per-job cancel from GifPanel needs a renderer-known id.
        jobId: pickJobId(params.jobId),
        sourcePath: params.sourcePath,
        outDir: params.outDir,
        startSec: params.startSec,
        endSec: params.endSec,
        width: params.width,
        fps: params.fps,
        speed: params.speed,
        cropRect: params.cropRect,
        ...(hasSourceName(params.sourceName) || hasSourceName(params.clipName)
          ? { sourceName: outputBaseName(params.sourceName, params.sourcePath, params.clipName) }
          : {})
      })
    }
  )

  // Round 17 B1/B2/B3/B4/B5: per-job cancel handlers. Each module already
  // tracks an activeJobs map (or a single slot for highlights). The panel-
  // level Cancel button calls the matching channel; the IPC promise rejects
  // when the ffmpeg child dies, and the panel's existing catch shows a toast.
  ipcMain.handle('video:cancelReframe', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancelReframe jobId')
    assertAlways(SAFE_ID_RE.test(jobId), 'video:cancelReframe jobId malformed')
    return cancelReframeJob(jobId)
  })
  ipcMain.handle('video:cancelGif', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancelGif jobId')
    assertAlways(SAFE_ID_RE.test(jobId), 'video:cancelGif jobId malformed')
    return cancelGifJob(jobId)
  })
  ipcMain.handle('video:cancelConcat', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancelConcat jobId')
    assertAlways(SAFE_ID_RE.test(jobId), 'video:cancelConcat jobId malformed')
    return cancelConcatJob(jobId)
  })
  // PiP shares concat's activeJobs map (M3 fix round 15).
  ipcMain.handle('video:cancelPip', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'video:cancelPip jobId')
    assertAlways(SAFE_ID_RE.test(jobId), 'video:cancelPip jobId malformed')
    return cancelConcatJob(jobId)
  })
  // Single-slot — no jobId required.
  ipcMain.handle('video:cancelHighlight', () => cancelActiveHighlightScan())
}
