import { ipcMain, desktopCapturer, dialog, BrowserWindow, app } from 'electron'
import { spawn } from 'node:child_process'
import { writeFile, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { ffmpegPath } from '../ffmpeg/paths'
import type {
  RecordingResult,
  RecordingSource,
  RecordingSpec
} from '../../shared/workspace'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertPlainObject
} from '../../shared/validators'
import { assert } from '../../shared/assert'

function recordingsDir(): string {
  return path.join(app.getPath('userData'), 'recordings')
}

async function convertWebmToMp4(webmPath: string, mp4Path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-y',
        '-i',
        webmPath,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        mp4Path
      ],
      { windowsHide: true }
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`webm→mp4 exit ${code}: ${stderr.slice(-500)}`))
    })
  })
}

export function registerRecordingIpc(): void {
  ipcMain.handle('recording:listSources', async (): Promise<RecordingSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      type: s.id.startsWith('screen') ? 'screen' : 'window'
    }))
  })

  ipcMain.handle(
    'recording:save',
    async (_e, spec: RecordingSpec): Promise<RecordingResult | null> => {
      assertPlainObject(spec, 'recording:save spec')
      assertNonEmptyString(spec.filename, 'spec.filename')
      assert(
        spec.webmBytes instanceof ArrayBuffer || ArrayBuffer.isView(spec.webmBytes),
        'spec.webmBytes must be an ArrayBuffer or typed array'
      )
      const byteLen =
        spec.webmBytes instanceof ArrayBuffer
          ? spec.webmBytes.byteLength
          : (spec.webmBytes as ArrayBufferView).byteLength
      assert(byteLen > 0, 'spec.webmBytes must not be empty')
      if (spec.durationMs !== undefined) {
        assertFiniteNonNeg(spec.durationMs, 'spec.durationMs')
      }
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null

      await mkdir(recordingsDir(), { recursive: true })
      const tempName = `${nanoid(10)}.webm`
      const tempPath = path.join(recordingsDir(), tempName)
      const webmBuffer = Buffer.from(spec.webmBytes)
      await writeFile(tempPath, webmBuffer)

      const baseName = spec.filename.replace(/\.(webm|mp4)$/i, '')
      const targetExt = spec.convertToMp4 ? 'mp4' : 'webm'

      const result = await dialog.showSaveDialog(win, {
        title: 'Save recording',
        defaultPath: `${baseName}.${targetExt}`,
        filters: [
          spec.convertToMp4
            ? { name: 'MP4 video', extensions: ['mp4'] }
            : { name: 'WebM video', extensions: ['webm'] }
        ]
      })
      if (result.canceled || !result.filePath) {
        try {
          await unlink(tempPath)
        } catch {
          /* ignore */
        }
        return null
      }

      let outputPath = result.filePath
      if (spec.convertToMp4) {
        await convertWebmToMp4(tempPath, outputPath)
        try {
          await unlink(tempPath)
        } catch {
          /* ignore */
        }
      } else {
        const fs = await import('node:fs/promises')
        await fs.copyFile(tempPath, outputPath)
        try {
          await unlink(tempPath)
        } catch {
          /* ignore */
        }
      }

      const sizeBytes = existsSync(outputPath)
        ? (await (await import('node:fs/promises')).stat(outputPath)).size
        : 0

      return {
        outputPath,
        sizeBytes,
        format: spec.convertToMp4 ? 'mp4' : 'webm',
        durationMs: spec.durationMs ?? 0
      }
    }
  )
}
