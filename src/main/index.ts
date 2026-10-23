import { app, BrowserWindow, screen, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resolveWindowBounds } from '../shared/windowSizing'
import { getSetting, setSetting } from './store'
import { flushAutosaveOnQuit } from './quitFlush'
import { rendererGoneAction } from './rendererRecovery'
import { persistWindowBounds } from './windowBounds'
import { registerSettingsIpc } from './ipc/settings'
import { registerVideoIpc } from './ipc/video'
import { registerAudioIpc } from './ipc/audio'
import { registerImageIpc } from './ipc/image'
import { registerSearchIpc } from './ipc/search'
import { registerCaptionsIpc } from './ipc/captions'
import { registerProjectIpc } from './ipc/project'
import { registerRecordingIpc, abandonAllRecordingStreams, abandonOpenRecordingSessions } from './ipc/recording'
import { smokeTestFfmpeg } from './ffmpeg/smoke'
import { registerPrivilegedSchemes, registerFileProtocol } from './protocol'
import { pruneStaleTempFiles } from './tempCleanup'
import { sweepOrphanThumbs } from './search/moodboard'
import { cancelAllExportJobs } from './ffmpeg/export'
import { cancelAllAudioJobs } from './audio/process'
import { cancelAllExtractions } from './audio/extract'
import { cancelAllPeaks } from './audio/peaks'
import { cancelAllConcatJobs } from './ffmpeg/concat'
import { drainRuns, openRunCount } from './ffmpeg/cancelLatch'
import { cancelAllReframeJobs } from './ffmpeg/reframe'
import { cancelAllGifJobs } from './ffmpeg/gif'
import { cancelAllHighlightJobs } from './ffmpeg/highlights'
import { cancelAllFrameJobs } from './ffmpeg/frame'
import { cancelAllConverts } from './ffmpeg/convert'
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
 * is still alive) and `app.quit()` (menu, the E2E driver),
 * whichever happens first. The flag is what stops the second one from
 * asking for a snapshot the renderer can no longer take, and what lets the
 * re-entrant quit through after the first has finished.
 */
let quitFlushed = false

/**
 * T-127 (3): the second bounded wait of a quit - for the canceled jobs' own cleanup. Set once the drain has finished (or timed out), which
 * is what lets the re-entrant quit through; `quitDrain` is the drain in flight, so a second quit request during it does not start another.
 */
let quitDrained = false
let quitDrain: Promise<unknown> | null = null

/** Coalesces the burst of move/resize events a single drag produces. */
const BOUNDS_SAVE_DEBOUNCE_MS = 400
let boundsTimer: NodeJS.Timeout | null = null

/** T-124 (4): through `windowBounds.ts`, which never throws (a held config.json used to break the close handler). */
function saveBounds(win: BrowserWindow): void {
  persistWindowBounds(win, (bounds) => setSetting('windowBounds', bounds))
}

function scheduleBoundsSave(win: BrowserWindow): void {
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    boundsTimer = null
    saveBounds(win)
  }, BOUNDS_SAVE_DEBOUNCE_MS)
}

function flushBoundsNow(win: BrowserWindow): void {
  if (boundsTimer) {
    clearTimeout(boundsTimer)
    boundsTimer = null
  }
  saveBounds(win)
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
      sandbox: false,
      // T-120: keep rendering when the window is minimized or hidden. The webcam composite is a
      // requestAnimationFrame loop into canvas.captureStream (Record), and Chromium stops rAF in a hidden
      // document by default, so the picture froze the moment imagii was minimized - which is where a
      // recorder sits during a take.
      backgroundThrottling: false,
      // T-127 (1): no spellchecker. Electron's default one downloads its Hunspell dictionary from Google
      // (redirector.gvt1.com/edgedl/chrome/dict/en-us-10-1.bdic) on EVERY launch, and imagii's text fields are names,
      // labels and short notes: the local-first promise outweighs red underlines. Proven by the built-app net-log test.
      spellcheck: false
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

  // T-123 (15): a renderer that dies (out of memory on a huge file, a GPU-process fault) used to
  // leave a window that looked alive and painted nothing. Log why, and reload it to Home, where the
  // autosave banner lives; a second death inside the cooldown is left alone rather than looped.
  // T-124 (2): `webContents.reload()` keeps the URL's hash, so a crash inside a studio reloaded INTO that
  // studio (no Home, no banner, and a log line that said "reloading to Home"): the entry is loaded fresh.
  // T-124 (3): and the recording sessions the dead page had open are abandoned with it.
  let lastCrashReloadAt: number | null = null
  win.webContents.on('render-process-gone', (_event, details) => {
    const action = rendererGoneAction(
      details.reason,
      Date.now(),
      lastCrashReloadAt,
      quitFlushed || win.isDestroyed()
    )
    console.error(
      `[imagii] the window's renderer process went away (${details.reason}, exit code ${details.exitCode}): ` +
        (action === 'reload'
          ? 'reloading to Home.'
          : action === 'leave'
            ? 'it already reloaded a moment ago, leaving the window as it is.'
            : 'nothing to reload.')
    )
    if (action !== 'reload') return
    lastCrashReloadAt = Date.now()
    abandonOpenRecordingSessions().then(
      (abandoned) => {
        if (abandoned > 0) console.warn(`[imagii] abandoned ${abandoned} recording session(s) the dead renderer left open`)
      },
      (err) => console.warn('[imagii] could not abandon the dead renderer\'s recording sessions:', err)
    )
    loadEntry(win)
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

  loadEntry(mainWindow)
}

/**
 * Shows the app's page in `win`: the dev server under `electron-vite dev`, the built file otherwise. The first load and the
 * crash-recovery reload both come through here (T-124 (2)) - a load with no hash is Home.
 */
function loadEntry(win: BrowserWindow): void {
  const loading = process.env.ELECTRON_RENDERER_URL
    ? win.loadURL(process.env.ELECTRON_RENDERER_URL)
    : win.loadFile(path.join(__dirname, '../renderer/index.html'))
  loading.catch((err) => console.error('[imagii] could not load the page:', err))
}

app.whenReady().then(async () => {
  // T-127 (1): no DNS-over-HTTPS. Chromium upgrades to the resolver's DoH endpoint when the machine's DNS is a known provider
  // (8.8.8.8 and 1.1.1.1 are) and PROBES it first: dns.google on every launch, from a person who asked for no network at all.
  // Must be called after ready. 'off' is plain system DNS, which is what every other desktop app on the machine uses.
  app.configureHostResolver({ secureDnsMode: 'off' })
  // T-127 (1): and no spellchecker dictionaries. `webPreferences.spellcheck: false` (in createWindow, above) stops only the renderer's checker: the browser-side
  // one still downloaded its dictionary (measured), and so did `setSpellCheckerEnabled(false)`. An empty language list does both jobs (it
  // turns the checker off too), before the first window creates the service that would start the download. It must run EVERY launch:
  // the list is a persisted preference, and Electron re-seeds an empty one with en-US.
  session.defaultSession.setSpellCheckerLanguages([])
  registerFileProtocol()
  registerSettingsIpc()
  registerVideoIpc()
  registerAudioIpc()
  registerImageIpc()
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
  //
  // T-79: the sweep is the whole of launch maintenance, deliberately. Round
  // 47 chained the 500 MB LRU behind it to give the budget an automatic
  // caller, but the two are not the same kind of delete: the sweep is safe
  // because it builds a `referenced` set first and only touches files no
  // board points at, and an mtime LRU has no such check. Running it here —
  // AFTER every orphan is already gone — left it nothing to reclaim but
  // pictures boards still refer to. A budget must never eat user data.
  sweepOrphanThumbs()
    .then((removed) => {
      if (removed > 0) console.log(`[moodboard] reclaimed ${removed} orphaned thumbnail(s)`)
    })
    .catch((err) => {
      console.warn('[moodboard] thumbnail sweep failed', err)
    })
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
  // T-47: the app-quit path (menu quit, an OS session end, the E2E
  // driver). The window is still alive here, so the final snapshot is
  // taken before anything is torn down — then quit is re-entered and
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
  // T-111: the ffmpeg that pulls a recording's sound out for Audio Studio (and
  // for a transcription) is its own registry, and a long VOD keeps it busy for
  // minutes. `cancelAllAudioJobs` reaches it too; this line is the inventory
  // entry that keeps the quit sweep complete if that ever changes.
  try {
    cancelAllExtractions()
  } catch {
    /* ignore */
  }
  // T-129: and the ffmpeg that reads a file's sound for its waveform (a 3 h file keeps it busy for seconds). The same pattern: the
  // audio sweep reaches it, and this line is its inventory entry.
  try {
    cancelAllPeaks()
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
  // T-60: every convert, whoever owns it — the recording's and any import
  // transcode. Per-owner cancellation is for the buttons in the UI; quitting
  // leaves no ffmpeg child of ours behind, which is this hook's whole job.
  try {
    cancelAllConverts()
  } catch {
    /* ignore */
  }
  // T-127 (3): the kills above only START the cleanup. A killed ffmpeg's `close`, the runner's failure path that deletes its half-written
  // output (T-100) and the intermediate a re-attach made all run on later event-loop turns, and the process used to be gone before them:
  // a quit in the middle of an export left `name.mp4` at its final name, and a re-attach its `.cleaned.wav`. So the quit waits, once and for
  // at most QUIT_DRAIN_TIMEOUT_MS (the flush's pattern above: bounded, best-effort, never a hang), until every run has ended - `run.end()` is
  // the last thing each runner does, after its cleanup - and then re-enters. With nothing running this costs nothing.
  if (!quitDrained && openRunCount() > 0) {
    event.preventDefault()
    quitDrain ??= drainRuns().finally(() => {
      quitDrained = true
      app.quit()
    })
    return
  }
  // Round 18: reap any open streaming-recording session and its partial
  // temp file — quit mid-recording must not leave GB-scale .webm partials.
  try {
    abandonAllRecordingStreams()
  } catch {
    /* ignore */
  }
})
