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

export function registerAudioIpc(): void {
  ipcMain.handle('audio:probe', async (_e, filePath: string) => probeAudio(filePath))

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
    const result = await extractAudioFromVideo(videoPath)
    return result.wavPath
  })

  ipcMain.handle('audio:export', async (e, spec: AudioExportSpec) => {
    return runAudioExport(spec, (p) => e.sender.send('audio:progress', p))
  })

  ipcMain.handle('audio:mux', async (e, spec: AudioMuxSpec) => {
    return runAudioMux(spec.jobId, spec.videoPath, spec.audioPath, spec.outputPath, (p) =>
      e.sender.send('audio:progress', p)
    )
  })

  ipcMain.handle('audio:cancel', (_e, jobId: string) => cancelAudioJob(jobId))

  ipcMain.handle('audio:revealInFolder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(
    'audio:suggestOutputName',
    (_e, sourcePath: string, format: string) => {
      const base = path.parse(sourcePath).name
      return `${base}-cleaned.${format}`
    }
  )

  ipcMain.handle('audio:listPresets', () => listChainPresets())
  ipcMain.handle('audio:savePreset', (_e, name: string, chain: ChainSpec) =>
    saveChainPreset(name, chain)
  )
  ipcMain.handle('audio:deletePreset', (_e, id: string) => deleteChainPreset(id))
}
