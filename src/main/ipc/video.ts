import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { probeVideo } from '../ffmpeg/probe'
import { runExportJob, cancelExportJob, cancelAllExportJobs } from '../ffmpeg/export'
import { runReframe, type ReframeJobSpec } from '../ffmpeg/reframe'
import { findHighlights } from '../ffmpeg/highlights'
import { runGifExport } from '../ffmpeg/gif'
import { runConcat, runPipComposite } from '../ffmpeg/concat'
import {
  listCustomPresets,
  saveCustomPreset,
  deleteCustomPreset
} from '../customPresets'
import { nanoid } from 'nanoid'
import type { ExportJobSpec, ExportResult } from '../../shared/clip'
import type { CustomPreset } from '../../shared/customPresets'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertRange,
  assertEnum,
  assertArray,
  assertPlainObject
} from '../../shared/validators'
import { assert } from '../../shared/assert'

const REFRAME_POSITIONS = ['left', 'center', 'right', 'smart'] as const
const PIP_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

function validateExportJob(job: unknown, idx: number): asserts job is ExportJobSpec {
  assertPlainObject(job, `jobs[${idx}]`)
  assertNonEmptyString(job.jobId, `jobs[${idx}].jobId`)
  assertNonEmptyString(job.sourcePath, `jobs[${idx}].sourcePath`)
  assertNonEmptyString(job.outDir, `jobs[${idx}].outDir`)
  assertPlainObject(job.clip, `jobs[${idx}].clip`)
  const clip = job.clip
  assertFiniteNonNeg(clip.startSec, `jobs[${idx}].clip.startSec`)
  assertFiniteNonNeg(clip.endSec, `jobs[${idx}].clip.endSec`)
  assert((clip.endSec as number) > (clip.startSec as number), `jobs[${idx}].clip range invalid (endSec must exceed startSec)`)
  assertNonEmptyString(job.preset, `jobs[${idx}].preset`)
}

export function registerVideoIpc(): void {
  ipcMain.handle('video:probe', async (_e, filePath: string) => {
    assertNonEmptyString(filePath, 'video:probe filePath')
    return probeVideo(filePath)
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
          extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']
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
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(
    'video:reframe',
    async (
      e,
      params: {
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
      assertEnum(params.position, REFRAME_POSITIONS, 'position')
      assertFiniteNonNeg(params.startSec, 'startSec')
      assertFiniteNonNeg(params.endSec, 'endSec')
      assert(params.endSec > params.startSec, 'reframe endSec must exceed startSec')
      assertRange(params.targetWidth, 16, 16384, 'targetWidth')
      assertRange(params.targetHeight, 16, 16384, 'targetHeight')
      const base = path.parse(params.sourcePath).name
      const outputName = `${base}_reframe-${params.targetWidth}x${params.targetHeight}-${params.position}.mp4`
      const outputPath = path.join(params.outDir, outputName)
      const jobId = `reframe-${Date.now()}`
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
      const jobId = `highlights-${Date.now()}`
      const candidates = await findHighlights(jobId, sourcePath, (p) =>
        e.sender.send('video:highlightProgress', p)
      )
      return candidates
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
        jobId: nanoid(10),
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
      assertRange(params.overlayWidth, 0.05, 1, 'overlayWidth')
      assertEnum(params.position, PIP_POSITIONS, 'position')
      assertFiniteNonNeg(params.margin, 'margin')
      const base = path.parse(params.basePath).name
      const outputPath = path.join(params.outDir, `${base}_pip.mp4`)
      return runPipComposite(nanoid(10), params.basePath, params.overlayPath, outputPath, {
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
      assertFiniteNonNeg(params.startSec, 'startSec')
      assertFiniteNonNeg(params.endSec, 'endSec')
      assert(params.endSec > params.startSec, 'gif endSec must exceed startSec')
      assertRange(params.width, 16, 4096, 'width')
      assertRange(params.fps, 1, 60, 'fps')
      assertRange(params.speed, 0.1, 10, 'speed')
      return runGifExport({
        jobId: nanoid(10),
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
}
