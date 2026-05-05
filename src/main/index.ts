import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { registerSettingsIpc } from './ipc/settings'
import { registerVideoIpc } from './ipc/video'
import { registerAudioIpc } from './ipc/audio'
import { registerAiIpc } from './ipc/ai'
import { registerSearchIpc } from './ipc/search'
import { registerImageIpc } from './ipc/image'
import { smokeTestFfmpeg } from './ffmpeg/smoke'
import { registerPrivilegedSchemes, registerFileProtocol } from './protocol'

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
  mainWindow = new BrowserWindow({
    title: 'imagii',
    width: 1280,
    height: 800,
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
  registerAiIpc()
  registerSearchIpc()
  registerImageIpc()
  const smoke = await smokeTestFfmpeg()
  if (smoke.ffmpegOk) {
    console.log(`[ffmpeg] ${smoke.ffmpegVersion}`)
    console.log(`[ffprobe] ${smoke.ffprobeVersion}`)
  } else {
    console.error('[ffmpeg] smoke test failed:', smoke.error)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
