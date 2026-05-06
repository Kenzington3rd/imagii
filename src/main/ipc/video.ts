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

export function registerVideoIpc(): void {
  ipcMain.handle('video:probe', async (_e, filePath: string) => {
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

  ipcMain.handle('video:cancel', (_e, jobId: string) => cancelExportJob(jobId))
  ipcMain.handle('video:cancelAll', () => cancelAllExportJobs())

  ipcMain.handle('video:revealInFolder', (_e, filePath: string) => {
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
    (_e, preset: Omit<CustomPreset, 'id'>) => saveCustomPreset(preset)
  )
  ipcMain.handle('video:deleteCustomPreset', (_e, id: string) => deleteCustomPreset(id))

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
