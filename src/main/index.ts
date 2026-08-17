import { app, BrowserWindow, screen, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resolveWindowBounds } from '../shared/windowSizing'
import { getSetting, setSetting } from './store'
import { flushAutosaveOnQuit } from './quitFlush'
import { registerSettingsIpc } from './ipc/settings'
import { registerVideoIpc } from './ipc/video'
import { registerAudioIpc } from './ipc/audio'
import { registerSearchIpc } from './ipc/search'
import { registerCaptionsIpc } from './ipc/captions'
import { registerProjectIpc } from './ipc/project'
import {
  registerRecordingIpc,
  cancelRecordingConvert,
  abandonAllRecordingStreams
} from './ipc/recording'
import { smokeTestFfmpeg } from './ffmpeg/smoke'
import { registerPrivilegedSchemes, registerFileProtocol } from './protocol'
import { pruneStaleTempFiles } from './tempCleanup'
import { sweepOrphanThumbs } from './search/moodboard'
import { cancelAllExportJobs } from './ffmpeg/export'
import { cancelAllAudioJobs } from './audio/process'
import { cancelAllConcatJobs } from './ffmpeg/concat'
import { cancelAllReframeJobs } from './ffmpeg/reframe'
import { cancelAllGifJobs } from './ffmpeg/gif'
import { cancelAllHighlightJobs } from './ffmpeg/highlights'
import { cancelAllFrameJobs } from './ffmpeg/frame'
import {
  cancelWhisperModelInstall,
  cancelTranscribe,
  cancelBurnIn
} from './sidecars/whisperManager'

registerPrivilegedSchemes()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

/**
 * T-47 — the quit flush runs once per session. Both ways out of the app
 * come through here: the window's X (which fires `close` while the renderer
 * is still alive) and `app.quit()` (menu, `app:quit` IPC, the E2E driver),
 * whichever happens first. The flag is what stops the second one from
 * asking for a snapshot the renderer can no longer take, and what lets the
 * re-entrant quit through after the first has finished.
 */
let quitFlushed = false

/** Coalesces the burst of move/resize events a single drag produces. */
const BOUNDS_SAVE_DEBOUNCE_MS = 400
let boundsTimer: NodeJS.Timeout | null = null

function persistWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  // getNormalBounds, not getBounds: while the window is maximized the
  // latter reports the whole work area, which would overwrite the size the
  // user actually chose and leave nothing to un-maximize back to.
  const bounds = win.getNormalBounds()
  setSetting('windowBounds', { ...bounds, maximized: win.isMaximized() })
}

function scheduleBoundsSave(win: BrowserWindow): void {
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    boundsTimer = null
    persistWindowBounds(win)
  }, BOUNDS_SAVE_DEBOUNCE_MS)
}

function flushBoundsNow(win: BrowserWindow): void {
  if (boundsTimer) {
    clearTimeout(boundsTimer)
    boundsTimer = null
  }
  persistWindowBounds(win)
}

function resolveIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '../../resources/icon.png'),
    path.join(process.resourcesPath ?? '', 'resources/icon.png'),
    path.join(process.cwd(), 'resources', 'icon.png')
  ]
  for (const candidate of candidates) {
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      if (fs.existsSync(candidate)) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

function createWindow(): void {
  const iconPath = resolveIconPath()
  // T-47: reopen at the size and position the last session ended at, or —
  // when nothing is stored, or what is stored lands on a display that is no
  // longer connected — at the auto-size for this screen, centered. Sizing
  // is relative to the primary display's work-area (the screen minus
  // taskbar/dock): on 1080p that caps at the prior 1280x800 default, on
  // 1440p it opens roughly 1600x1000, on 4K around 2200x1400. Pure helper,
  // unit-tested, including the unplugged-monitor case.
  const primary = screen.getPrimaryDisplay()
  const sized = resolveWindowBounds(
    getSetting('windowBounds'),
    screen.getAllDisplays().map((d) => d.workArea),
    primary.workArea
  )
  mainWindow = new BrowserWindow({
    title: 'imagii',
    width: sized.width,
    height: sized.height,
    ...(sized.x !== undefined && sized.y !== undefined ? { x: sized.x, y: sized.y } : {}),
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#120c0c',
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (sized.maximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // T-47: geometry is persisted independently of anything the user does
  // with the restore banner — a window that forgets its size is a bug on
  // its own terms, not part of the opt-in continuity offer.
  const win = mainWindow
  win.on('resize', () => scheduleBoundsSave(win))
  win.on('move', () => scheduleBoundsSave(win))
  win.on('maximize', () => scheduleBoundsSave(win))
  win.on('unmaximize', () => scheduleBoundsSave(win))

  win.on('close', (event) => {
    // The X button. Bounds first — synchronous, and they must land whether
    // or not the flush below gets anywhere.
    flushBoundsNow(win)
    if (quitFlushed) return
    // The renderer is still alive at `close` and dead by `before-quit` on
    // this path, so this is the only place a final snapshot can be taken
    // when the user closes the window rather than quitting the app.
    event.preventDefault()
    void flushAutosaveOnQuit(win)
      .catch(() => undefined)
      .finally(() => {
        quitFlushed = true
        if (!win.isDestroyed()) win.close()
      })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only hand well-formed web URLs to the OS. Today the only reachable
    // links are hardcoded https hrefs, but a future feature rendering
    // search-result URLs must not be able to launch file:/protocol handlers.
    if (details.url.startsWith('https://') || details.url.startsWith('http://')) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  registerFileProtocol()
  registerSettingsIpc()
  registerVideoIpc()
  registerAudioIpc()
  registerSearchIpc()
  registerCaptionsIpc()
  registerProjectIpc()
  registerRecordingIpc()
  // Fire-and-forget (round 18): the smoke result is only logged, but the
  // old `await` serialized two child-process spawns before createWindow()
  // even ran — on a cold Windows start with AV scanning the bundled
  // binaries, that delay gated first paint. Same pattern as
  // pruneStaleTempFiles below.
  smokeTestFfmpeg().then(
    (smoke) => {
      if (smoke.ffmpegOk) {
        console.log(`[ffmpeg] ${smoke.ffmpegVersion}`)
        console.log(`[ffprobe] ${smoke.ffprobeVersion}`)
      } else {
        console.error('[ffmpeg] smoke test failed:', smoke.error)
      }
    },
    (err) => {
      console.error('[ffmpeg] smoke test failed:', err)
    }
  )
  // Tech-debt fix: prune temp files left behind by prior crashed sessions
  // (audio:extractFromVideo wavs + any leftover concat segments). Async
  // and best-effort — never block app startup on a slow/locked tempdir.
  pruneStaleTempFiles().then(
    ({ scanned, removed }) => {
      if (removed > 0) {
        console.log(`[tempCleanup] removed ${removed}/${scanned} stale temp file(s)`)
      }
    },
    (err) => {
      console.warn('[tempCleanup] failed', err)
    }
  )
  // T-58: a deleted board keeps its cached thumbnails so the session's undo
  // can put it back whole. Launch is the first moment those orphans are
  // certainly unreachable, so this is where they are reclaimed. Same
  // fire-and-forget shape as the sweep above — never gate first paint on it.
  sweepOrphanThumbs().then(
    (removed) => {
      if (removed > 0) console.log(`[moodboard] reclaimed ${removed} orphaned thumbnail(s)`)
    },
    (err) => {
      console.warn('[moodboard] thumbnail sweep failed', err)
    }
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// M10 fix (round 15): before quitting, hard-kill every spawned child the app
// owns. Pre-15, child ffmpeg / whisper / install processes survived the
// renderer-window closing — Windows Task Manager would show orphaned
// ffmpeg.exe instances using CPU after the app icon was long gone.
app.on('before-quit', (event) => {
  // T-47: the app-quit path (menu quit, `app:quit` from the renderer, an
  // OS session end). The window is still alive here, so the final snapshot
  // is taken before anything is torn down — then quit is re-entered and
  // runs straight through the reaping below. A slow disk cannot wedge
  // this: the flush is bounded and best-effort, and its failure is not the
  // user's problem at the moment they are leaving.
  //
  // The two hooks overlap on purpose. On a plain `app.quit()` either one
  // would do (whichever runs first sets the flag and the other skips), but
  // neither covers the other's own route: `close` is the only event on the
  // window's X, because by the time `before-quit` follows it the renderer
  // is gone; and `before-quit` is the only event on a shutdown that
  // destroys windows instead of closing them.
  const win = mainWindow
  if (!quitFlushed && win && !win.isDestroyed()) {
    event.preventDefault()
    void flushAutosaveOnQuit(win)
      .catch(() => undefined)
      .finally(() => {
        quitFlushed = true
        app.quit()
      })
    return
  }
  try {
    cancelAllExportJobs()
  } catch {
    /* ignore */
  }
  try {
    cancelAllAudioJobs()
  } catch {
    /* ignore */
  }
  try {
    cancelAllConcatJobs()
  } catch {
    /* ignore */
  }
  // Round 16: cover the spawn sites round 15 missed.
  try {
    cancelAllReframeJobs()
  } catch {
    /* ignore */
  }
  try {
    cancelAllGifJobs()
  } catch {
    /* ignore */
  }
  try {
    cancelAllHighlightJobs()
  } catch {
    /* ignore */
  }
  try {
    cancelAllFrameJobs()
  } catch {
    /* ignore */
  }
  try {
    cancelWhisperModelInstall()
  } catch {
    /* ignore */
  }
  try {
    cancelTranscribe()
  } catch {
    /* ignore */
  }
  try {
    cancelBurnIn()
  } catch {
    /* ignore */
  }
  try {
    cancelRecordingConvert()
  } catch {
    /* ignore */
  }
  // Round 18: reap any open streaming-recording session and its partial
  // temp file — quit mid-recording must not leave GB-scale .webm partials.
  try {
    abandonAllRecordingStreams()
  } catch {
    /* ignore */
  }
})
