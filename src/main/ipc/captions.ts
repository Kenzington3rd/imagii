import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { copyFile } from 'node:fs/promises'
import {
  getCaptionsStatus,
  installWhisperModel,
  runBurnIn,
  runTranscribe
} from '../sidecars/whisperManager'
import type { TranscribeRequest, BurnInRequest } from '../../shared/captions'

export function registerCaptionsIpc(): void {
  ipcMain.handle('captions:status', () => getCaptionsStatus())

  ipcMain.handle('captions:transcribe', async (e, req: TranscribeRequest) => {
    return runTranscribe(req, (p) => e.sender.send('captions:progress', p))
  })

  ipcMain.handle('captions:burnIn', async (e, req: BurnInRequest) => {
    return runBurnIn(req, (p) => e.sender.send('captions:progress', p))
  })

  ipcMain.handle(
    'captions:saveSrt',
    async (_e, srtPath: string, defaultName: string) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: 'Save .srt subtitle file',
        defaultPath: defaultName,
        filters: [{ name: 'SubRip subtitle', extensions: ['srt'] }]
      })
      if (result.canceled || !result.filePath) return null
      await copyFile(srtPath, result.filePath)
      return result.filePath
    }
  )

  ipcMain.handle('captions:pickBurnInOutput', async (_e, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'Save captioned video',
      defaultPath: defaultName,
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('captions:openBinFolder', async () => {
    const status = getCaptionsStatus()
    shell.openPath(path.dirname(status.exePath))
  })

  ipcMain.handle('captions:openModelsFolder', async () => {
    const status = getCaptionsStatus()
    shell.openPath(status.modelsDir)
  })

  // Phase 4E: stream the Whisper model file into userData/models/.
  // Progress events go to the focused window via captions:modelProgress
  // so the UI can render an accurate progress bar.
  ipcMain.handle('captions:installModel', async (e) => {
    return installWhisperModel((p) => e.sender.send('captions:modelProgress', p))
  })
}
