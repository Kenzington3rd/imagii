import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { probeAudio } from '../audio/probe'
import { extractAudioFromVideo } from '../audio/extract'
import { runAudioExport, runAudioMux, cancelAudioJob } from '../audio/process'
import {
  listPresets as listChainPresets,
  savePreset as saveChainPreset,
  deletePreset as deleteChainPreset
} from '../audio/presets'
import type { AudioExportSpec, AudioMuxSpec, ChainSpec } from '../../shared/audio'
import {
  assertNonEmptyString,
  assertEnum,
  assertPlainObject,
  assertRange
} from '../../shared/validators'
import { assert } from '../../shared/assert'

const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac'] as const

function validateChainSpec(chain: unknown): asserts chain is ChainSpec {
  assertPlainObject(chain, 'chain')
  assertRange(chain.loudnormTargetLufs, -70, 0, 'chain.loudnormTargetLufs')
  assertRange(chain.gainDb, -60, 60, 'chain.gainDb')
  assert(Array.isArray(chain.cutRegions), 'chain.cutRegions must be an array')
}

export function registerAudioIpc(): void {
  ipcMain.handle('audio:probe', async (_e, filePath: string) => {
    assertNonEmptyString(filePath, 'audio:probe filePath')
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
          extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus']
        },
        { name: 'Video (extract audio)', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] },
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
      const ext = options?.format ?? 'mp3'
      assertEnum(ext, AUDIO_FORMATS, 'audio:pickOutputFile format')
      const result = await dialog.showSaveDialog(win, {
        title: 'Save cleaned audio',
        defaultPath: options?.defaultName ?? `cleaned.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    }
  )

  ipcMain.handle('audio:extractFromVideo', async (_e, videoPath: string) => {
    assertNonEmptyString(videoPath, 'audio:extractFromVideo videoPath')
    const result = await extractAudioFromVideo(videoPath)
    return result.wavPath
  })

  ipcMain.handle('audio:export', async (e, spec: AudioExportSpec) => {
    assertPlainObject(spec, 'audio:export spec')
    assertNonEmptyString(spec.jobId, 'spec.jobId')
    assertNonEmptyString(spec.sourcePath, 'spec.sourcePath')
    assertNonEmptyString(spec.outputPath, 'spec.outputPath')
    assertEnum(spec.format, AUDIO_FORMATS, 'spec.format')
    validateChainSpec(spec.chain)
    return runAudioExport(spec, (p) => e.sender.send('audio:progress', p))
  })

  ipcMain.handle('audio:mux', async (e, spec: AudioMuxSpec) => {
    assertPlainObject(spec, 'audio:mux spec')
    assertNonEmptyString(spec.jobId, 'spec.jobId')
    assertNonEmptyString(spec.videoPath, 'spec.videoPath')
    assertNonEmptyString(spec.audioPath, 'spec.audioPath')
    assertNonEmptyString(spec.outputPath, 'spec.outputPath')
    return runAudioMux(spec.jobId, spec.videoPath, spec.audioPath, spec.outputPath, (p) =>
      e.sender.send('audio:progress', p)
    )
  })

  ipcMain.handle('audio:cancel', (_e, jobId: string) => {
    assertNonEmptyString(jobId, 'audio:cancel jobId')
    return cancelAudioJob(jobId)
  })

  ipcMain.handle('audio:revealInFolder', (_e, filePath: string) => {
    assertNonEmptyString(filePath, 'audio:revealInFolder filePath')
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(
    'audio:suggestOutputName',
    (_e, sourcePath: string, format: string) => {
      assertNonEmptyString(sourcePath, 'sourcePath')
      assertEnum(format, AUDIO_FORMATS, 'format')
      const base = path.parse(sourcePath).name
      return `${base}-cleaned.${format}`
    }
  )

  ipcMain.handle('audio:listPresets', () => listChainPresets())
  ipcMain.handle('audio:savePreset', (_e, name: string, chain: ChainSpec) => {
    assertNonEmptyString(name, 'preset name')
    validateChainSpec(chain)
    return saveChainPreset(name, chain)
  })
  ipcMain.handle('audio:deletePreset', (_e, id: string) => {
    assertNonEmptyString(id, 'preset id')
    return deleteChainPreset(id)
  })
}
