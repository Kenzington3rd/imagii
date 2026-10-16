import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { probeAudio } from '../audio/probe'
import { AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from '../../shared/mediaFormats'
import { extractAudioFromVideo } from '../audio/extract'
import { readPeaks } from '../audio/peaks'
import { runAudioExport, runAudioReattach, cancelAudioJob } from '../audio/process'
import {
  listPresets as listChainPresets,
  savePreset as saveChainPreset,
  deletePreset as deleteChainPreset
} from '../audio/presets'
import type { AudioExportSpec, AudioMuxSpec, ChainSpec } from '../../shared/audio'
import {
  AUDIO_SAVE_FORMATS,
  LOUDNESS_TARGET_LUFS,
  NoUsableDurationError,
  audioFileExtension,
  isLoudnessTarget,
  isNoAudioStreamError,
  secondaryTrackProblem
} from '../../shared/audio'
import {
  assertNonEmptyString,
  assertEnum,
  assertPlainObject,
  assertRange
} from '../../shared/validators'
import { assertAlways } from '../../shared/assert'
import { assertSafeAbsolutePath, assertSafeId } from '../../shared/pathSafety'
import { sendIfAlive } from '../sendIfAlive'

const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac'] as const

/**
 * What a streamer is told when a chain's numbers cannot be used (T-111). The
 * validators' own messages are paths into the payload ("chain.secondaryTrack…
 * must be in [-60, 12]"), which `userFacingError` rightly refuses to show; each
 * of these is a finished sentence it stands behind, and the detail goes to the
 * console. The loudness target is reachable from the Levels panel (a number box
 * with no limit); the second track's numbers are not — they arrive from a
 * project file a person edited.
 */
const BAD_LOUDNESS_TARGET = `The loudness target has to be between ${LOUDNESS_TARGET_LUFS.min} and ${LOUDNESS_TARGET_LUFS.max} LUFS. Change it and try again.`
const BAD_SECOND_TRACK =
  "The second track has a setting imagii can't use — check its gain and ducking, then try again."

// T-120: the two other kinds of number a chain carries into the filter graph. A cut's times go into
// `between(t,start,end)` through `toFixed`, and the custom noise reduction's two numbers into
// `afftdn=nf=...:nr=...`; a missing or non-numeric one is `nf=NaN`, which ffmpeg refuses mid-export.
const BAD_CUT =
  "One of the cuts has a start or end imagii can't use. Click its mark to put it back, then cut that part again."
const BAD_DENOISE =
  "The custom noise reduction has a setting imagii can't use — move its Noise floor and Reduction sliders, then try again."

const isFiniteNumber = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function refuse(sentence: string, detail: string): never {
  console.error(`[imagii] audio refused a chain: ${detail}`)
  throw new Error(sentence)
}

function validateChainSpec(chain: unknown): asserts chain is ChainSpec {
  assertPlainObject(chain, 'chain')
  // T-111: loudnorm's own range, -70..-5 (it was -70..0, and a -3 died in ffmpeg).
  if (!isLoudnessTarget(chain.loudnormTargetLufs)) {
    refuse(BAD_LOUDNESS_TARGET, `chain.loudnormTargetLufs is ${String(chain.loudnormTargetLufs)}`)
  }
  assertRange(chain.gainDb, -60, 60, 'chain.gainDb')
  // T-90: the mains choice is one of two numbers or absent (older projects).
  assertAlways(
    chain.humHz === undefined || chain.humHz === 50 || chain.humHz === 60,
    'chain.humHz must be 50 or 60'
  )
  assertAlways(Array.isArray(chain.cutRegions), 'chain.cutRegions must be an array')
  // T-120: `validateProject` says "main checks every value it prints into a filter graph at export", and
  // these two were the values it did not: each cut's two times, and the custom noise reduction's numbers
  // (only when 'parametric' is the choice - any other strength never reads them; absent is the default).
  chain.cutRegions.forEach((cut: unknown, i: number) => {
    if (!isObject(cut) || !isFiniteNumber(cut.startSec) || !isFiniteNumber(cut.endSec)) {
      refuse(BAD_CUT, `chain.cutRegions[${i}] is ${JSON.stringify(cut)}`)
    }
  })
  if (chain.denoise === 'parametric') {
    const p = chain.denoiseParams
    if (p !== undefined && p !== null && (!isObject(p) || !isFiniteNumber(p.noiseFloorDb) || !isFiniteNumber(p.reductionDb))) {
      refuse(BAD_DENOISE, `chain.denoiseParams is ${JSON.stringify(p)}`)
    }
  }
  // secondaryTrack.filePath reaches `ffmpeg -i`; a traversal path would
  // mix an arbitrary file into the export. Optional/null for back-compat.
  const secondary = chain.secondaryTrack
  if (secondary !== undefined && secondary !== null) {
    assertPlainObject(secondary, 'chain.secondaryTrack')
    assertSafeAbsolutePath(secondary.filePath, 'chain.secondaryTrack.filePath')
    // T-111: its gain and ducking numbers are printed into the filter graph.
    const problem = secondaryTrackProblem(secondary)
    if (problem) refuse(BAD_SECOND_TRACK, problem)
  }
}

export function registerAudioIpc(): void {
  ipcMain.handle('audio:probe', async (_e, filePath: string) => {
    // B6 fix (round 16): tighten path validators on every audio IPC handler
    // so a traversal path can't reach ffmpeg -i or shell.showItemInFolder.
    // Mirrors the video IPC pass from round 15.
    assertSafeAbsolutePath(filePath, 'audio:probe filePath')
    return probeAudio(filePath)
  })

  ipcMain.handle('audio:pickFile', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose an audio file',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: [...AUDIO_EXTENSIONS]
        },
        { name: 'Video (extract audio)', extensions: [...VIDEO_EXTENSIONS] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'audio:pickOutputFile',
    async (_e, options: { defaultName?: string; format: string } | undefined) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const format = options?.format ?? 'mp3'
      // The Export panel asks for 'mp4' when it re-attaches the sound to a
      // video; that is a save format as much as 'mp3' is, and the validator
      // used to be the four audio ones only (T-90).
      assertEnum(format, AUDIO_SAVE_FORMATS, 'audio:pickOutputFile format')
      // AAC is saved as .m4a (T-90): a bare .aac is a raw stream most players
      // and editors do not treat as a normal audio file.
      const ext = audioFileExtension(format)
      const result = await dialog.showSaveDialog(win, {
        title: format === 'mp4' ? 'Save video with cleaned audio' : 'Save cleaned audio',
        defaultPath: options?.defaultName ?? `cleaned.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    }
  )

  ipcMain.handle('audio:extractFromVideo', async (_e, videoPath: string) => {
    assertSafeAbsolutePath(videoPath, 'audio:extractFromVideo videoPath')
    // T-129: no length gate. T-123's 2-hour waveform ceiling (asked here BEFORE the work since T-124 (6), and of the scratch WAV
    // after it since T-126 (8)) is retired: the waveform is drawn from main's streamed peaks (`audio:peaks`), not decoded in the
    // renderer, so a 4 h VOD is extracted and opened like any other recording. The probe stays for what it still answers before
    // anything is spawned: a video with no sound fails here (the importer words it), and whether the file has a picture.
    //
    // T-125 (4): ONLY "no sound" is the probe's verdict. A probe that fails any other way could not READ the file's length (a
    // MediaRecorder WebM and a crashed MKV carry no duration in their header, so `probeAudio` refuses them), and the extraction
    // handles those end to end: the person read "can't read this audio format" for a file that worked.
    // T-126 (7): whether the file has a PICTURE, read from its streams. null = the probe could not read the file.
    let hasVideo: boolean | null = null
    try {
      const probe = await probeAudio(videoPath)
      hasVideo = probe.hasVideo ?? null
    } catch (err) {
      if (isNoAudioStreamError(err)) throw err
      // T-127 (10): a probe that read the streams and found no LENGTH still knows whether there is a picture (a durationless WebM or
      // MKV is exactly what MediaRecorder writes), so the extension decides only when the streams were not read at all.
      if (err instanceof NoUsableDurationError) hasVideo = err.hasVideo
      console.warn('[imagii] audio:extractFromVideo could not read the file\'s length; extracting anyway:', err)
    }
    const result = await extractAudioFromVideo(videoPath)
    return { wavPath: result.wavPath, hasVideo }
  })

  // T-129 (T-110 (ao)): the waveform's peaks, read here from a stream of the file's sound (`main/audio/peaks.ts`) and handed to the
  // renderer as `PEAK_BUCKETS` highest/lowest pairs, never the file. The job id is the renderer's: its Close (or a second file
  // opened while this one is drawing) cancels the job through `audio:cancel`, and the quit sweep stops it with the other audio jobs.
  ipcMain.handle('audio:peaks', async (e, filePath: string, jobId: string) => {
    assertSafeAbsolutePath(filePath, 'audio:peaks filePath')
    assertNonEmptyString(jobId, 'audio:peaks jobId')
    return readPeaks(filePath, jobId, (p) => sendIfAlive(e.sender, 'audio:peaksProgress', p))
  })

  ipcMain.handle('audio:export', async (e, spec: AudioExportSpec) => {
    assertPlainObject(spec, 'audio:export spec')
    assertNonEmptyString(spec.jobId, 'spec.jobId')
    assertSafeAbsolutePath(spec.sourcePath, 'spec.sourcePath')
    assertSafeAbsolutePath(spec.outputPath, 'spec.outputPath')
    assertEnum(spec.format, AUDIO_FORMATS, 'spec.format')
    validateChainSpec(spec.chain)
    return runAudioExport(spec, (p) => sendIfAlive(e.sender, 'audio:progress', p))
  })

  ipcMain.handle('audio:mux', async (e, spec: AudioMuxSpec) => {
    assertPlainObject(spec, 'audio:mux spec')
    assertNonEmptyString(spec.jobId, 'spec.jobId')
    assertSafeAbsolutePath(spec.videoPath, 'spec.videoPath')
    assertSafeAbsolutePath(spec.sourcePath, 'spec.sourcePath')
    assertSafeAbsolutePath(spec.outputPath, 'spec.outputPath')
    validateChainSpec(spec.chain)
    return runAudioReattach(spec, (p) => sendIfAlive(e.sender, 'audio:progress', p))
  })

  ipcMain.handle('audio:cancel', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'audio:cancel jobId')
    return cancelAudioJob(jobId)
  })

  ipcMain.handle('audio:revealInFolder', (_e, filePath: string) => {
    assertSafeAbsolutePath(filePath, 'audio:revealInFolder filePath')
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(
    'audio:suggestOutputName',
    (_e, sourcePath: string, format: string) => {
      assertSafeAbsolutePath(sourcePath, 'sourcePath')
      assertEnum(format, AUDIO_SAVE_FORMATS, 'format')
      const base = path.parse(sourcePath).name
      return `${base}-cleaned.${audioFileExtension(format)}`
    }
  )

  ipcMain.handle('audio:listPresets', () => listChainPresets())
  ipcMain.handle('audio:savePreset', (_e, name: string, chain: ChainSpec) => {
    assertNonEmptyString(name, 'preset name')
    validateChainSpec(chain)
    return saveChainPreset(name, chain)
  })
  ipcMain.handle('audio:deletePreset', (_e, id: string) => {
    // T-117: the id becomes `<userData>/audio-presets/<id>.json`; refuse anything outside the
    // alphabet nanoid mints here, the way ipc/search.ts does for mood boards (the store checks again).
    assertNonEmptyString(id, 'preset id')
    assertSafeId(id, 'preset id')
    return deleteChainPreset(id)
  })
}
