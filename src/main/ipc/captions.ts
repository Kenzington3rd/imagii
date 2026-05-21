import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  cancelWhisperModelInstall,
  getCaptionsStatus,
  installWhisperModel,
  runBurnIn,
  runTranscribe
} from '../sidecars/whisperManager'
import { captionsOutputDir } from '../sidecars/paths'
import type { TranscribeRequest, BurnInRequest } from '../../shared/captions'
import {
  assertNonEmptyString,
  assertPlainObject
} from '../../shared/validators'
import { assertSafeAbsolutePath } from '../../shared/pathSafety'

export function registerCaptionsIpc(): void {
  ipcMain.handle('captions:status', () => getCaptionsStatus())

  ipcMain.handle('captions:transcribe', async (e, req: TranscribeRequest) => {
    // Validate the renderer-supplied request like every other IPC handler.
    // sourcePath reaches the Whisper sidecar / ffmpeg; require a safe
    // absolute path so a traversal path can't reach an arbitrary file.
    assertPlainObject(req, 'captions:transcribe req')
    assertNonEmptyString(req.jobId, 'req.jobId')
    assertSafeAbsolutePath(req.sourcePath, 'req.sourcePath')
    return runTranscribe(req, (p) => e.sender.send('captions:progress', p))
  })

  ipcMain.handle('captions:burnIn', async (e, req: BurnInRequest) => {
    assertPlainObject(req, 'captions:burnIn req')
    assertNonEmptyString(req.jobId, 'req.jobId')
    assertSafeAbsolutePath(req.videoPath, 'req.videoPath')
    assertSafeAbsolutePath(req.srtPath, 'req.srtPath')
    assertSafeAbsolutePath(req.outputPath, 'req.outputPath')
    return runBurnIn(req, (p) => e.sender.send('captions:progress', p))
  })

  ipcMain.handle(
    'captions:saveSrt',
    async (_e, srtPath: string, defaultName: string) => {
      // INIT-C (round 15): mirror copySrtTo — confine srtPath to the
      // captions output directory before any read. Without the confinement
      // a malicious renderer could exfiltrate arbitrary files via the
      // copy-then-show-in-folder path.
      assertNonEmptyString(srtPath, 'srtPath')
      assertNonEmptyString(defaultName, 'defaultName')
      const allowedRoot = path.resolve(captionsOutputDir())
      const resolvedSrc = path.resolve(srtPath)
      const rel = path.relative(allowedRoot, resolvedSrc)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('captions:saveSrt source path outside captions directory')
      }
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: 'Save .srt subtitle file',
        defaultPath: defaultName,
        filters: [{ name: 'SubRip subtitle', extensions: ['srt'] }]
      })
      if (result.canceled || !result.filePath) return null
      await copyFile(resolvedSrc, result.filePath)
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

  // Tech-debt fix: cancel an in-flight model download.
  ipcMain.handle('captions:cancelInstall', () => cancelWhisperModelInstall())

  // Tech-debt fix: copy an SRT to a target path without prompting.
  // Used by Clip Kit to bundle the SRT alongside the per-platform mp4s.
  // Returns { ok, reason? } so the kit's UI can render a clear error if
  // the source SRT is missing.
  //
  // Bug fix (path-traversal): restrict srcPath to the captions output
  // directory. Even though the only current caller passes a path
  // produced by our own runTranscribe, defense-in-depth prevents a
  // future caller (or a compromised renderer) from passing
  // ../../somewhere-sensitive and exfiltrating arbitrary files via the
  // copy-then-read pattern.
  ipcMain.handle(
    'captions:copySrtTo',
    async (
      _e,
      params: { srcPath: string; destPath: string }
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      assertNonEmptyString(params.srcPath, 'srcPath')
      assertNonEmptyString(params.destPath, 'destPath')
      const allowedRoot = path.resolve(captionsOutputDir())
      const resolvedSrc = path.resolve(params.srcPath)
      // path.relative returns a path that starts with `..` if the source
      // is outside the allowed root. Empty result = exactly the root.
      const rel = path.relative(allowedRoot, resolvedSrc)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { ok: false, reason: 'source SRT is outside the captions directory' }
      }
      if (!existsSync(resolvedSrc)) {
        return { ok: false, reason: 'source SRT not found' }
      }
      try {
        await copyFile(resolvedSrc, params.destPath)
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : 'copy failed'
        }
      }
    }
  )
}
