import { app, BrowserWindow, screen, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { computeInitialWindowSize } from '../shared/windowSizing'
import { registerSettingsIpc } from './ipc/settings'
import { registerVideoIpc } from './ipc/video'
import { registerAudioIpc } from './ipc/audio'
import { registerSearchIpc } from './ipc/search'
import { registerCaptionsIpc } from './ipc/captions'
import { registerProjectIpc } from './ipc/project'
import { registerRecordingIpc } from './ipc/recording'
import { smokeTestFfmpeg } from './ffmpeg/smoke'
import { registerPrivilegedSchemes, registerFileProtocol } from './protocol'
import { pruneStaleTempFiles } from './tempCleanup'

registerPrivilegedSchemes()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

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
  // Size the window relative to the user's primary display work-area
  // (the screen minus taskbar/dock). On 1080p this caps at the prior
  // 1280x800 default; on 1440p it opens roughly 1600x1000; on 4K it
  // opens around 2200x1400 so the studios aren't squeezed into a
  // 1080p-sized box on a high-res screen. Pure helper, unit-tested.
  const primary = screen.getPrimaryDisplay()
  const sized = computeInitialWindowSize(primary.workAreaSize.width, primary.workAreaSize.height)
  mainWindow = new BrowserWindow({
    title: 'imagii',
    width: sized.width,
    height: sized.height,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0b0f',
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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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
  const smoke = await smokeTestFfmpeg()
  if (smoke.ffmpegOk) {
    console.log(`[ffmpeg] ${smoke.ffmpegVersion}`)
    console.log(`[ffprobe] ${smoke.ffprobeVersion}`)
  } else {
    console.error('[ffmpeg] smoke test failed:', smoke.error)
  }
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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
