import { ipcMain, desktopCapturer, dialog, BrowserWindow, app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
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

// M6 fix (round 15): track the webm→mp4 conversion child so the renderer can
// abort a slow save mid-flight, and so before-quit can take it down with the
// rest of the active job maps. Single-slot because only one save runs at a
// time (the renderer's `phase === 'saving'` state guards reentry).
let activeConvert: ChildProcess | null = null

export type RecordingProgressListener = (info: {
  percent: number
  message?: string
}) => void

async function convertWebmToMp4(
  webmPath: string,
  mp4Path: string,
  onProgress: RecordingProgressListener
): Promise<void> {
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
        '-progress',
        'pipe:1',
        '-nostats',
        mp4Path
      ],
      { windowsHide: true }
    )
    activeConvert = child
    let stderr = ''
    let durationSec = 0
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const [k, v] = line.split('=')
        if (k === 'out_time' && v) {
          const m = v.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
          if (m) {
            const elapsed = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
            // No prior probe of duration — emit a coarse 1% per second so the
            // UI knows something is happening. The renderer caps the bar.
            durationSec = elapsed
            onProgress({ percent: Math.min(99, durationSec * 2) })
          }
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => {
      stderr += c
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    child.on('error', (err) => {
      activeConvert = null
      reject(err)
    })
    child.on('close', (code) => {
      activeConvert = null
      if (code === 0) resolve()
      else reject(new Error(`webm→mp4 exit ${code}: ${stderr.slice(-500)}`))
    })
  })
}

/**
 * M6 + M10 (round 15): abort the in-flight conversion child if any. Returns
 * true when there was something to cancel. Used by both the renderer
 * "Discard recording" button and the app-level before-quit cleanup.
 */
export function cancelRecordingConvert(): boolean {
  const child = activeConvert
  if (!child) return false
  try {
    child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
  activeConvert = null
  return true
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

      // M1 fix (round 15): the previous code ran writeFile(tempPath) then
      // showSaveDialog at top-level. A dialog throw (window destroyed mid-
      // IPC, native dialog backend explodes) skipped both the cancel-branch
      // unlink AND the conversion try/finally — the WebM leaked. Wrap the
      // whole post-writeFile region in try/finally so the temp file is
      // always reaped, regardless of which branch threw.
      try {
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
          return null
        }

        const outputPath = result.filePath
        // Inner try keeps the conversion-time cleanup tight against the
        // outer leak guard. Both finally blocks attempt the unlink — the
        // second attempt no-ops because the file is already gone.
        if (spec.convertToMp4) {
          await convertWebmToMp4(tempPath, outputPath, (info) => {
            win.webContents.send('recording:progress', info)
          })
        } else {
          const fs = await import('node:fs/promises')
          await fs.copyFile(tempPath, outputPath)
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
      } finally {
        // Cleanup is best-effort and idempotent. Ignore ENOENT since some
        // branches already removed the temp file (e.g. successful path).
        try {
          await unlink(tempPath)
        } catch {
          /* ignore */
        }
      }
    }
  )

  // M6 fix (round 15): renderer-callable cancel for the save phase.
  ipcMain.handle('recording:cancelSave', async (): Promise<boolean> => {
    return cancelRecordingConvert()
  })
}
