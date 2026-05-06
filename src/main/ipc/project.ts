import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import type { ImagiiProject } from '../../shared/workspace'
import {
  writeAutosave,
  readAutosave,
  clearAutosave,
  getAutosaveInfo
} from '../autosave'

export function registerProjectIpc(): void {
  ipcMain.handle(
    'project:save',
    async (_e, project: ImagiiProject, defaultName?: string) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: 'Save imagii project',
        defaultPath: defaultName ?? 'project.imagii.json',
        filters: [{ name: 'imagii project', extensions: ['imagii.json', 'json'] }]
      })
      if (result.canceled || !result.filePath) return null
      const enriched: ImagiiProject = {
        ...project,
        savedAt: Date.now(),
        appVersion: app.getVersion()
      }
      await writeFile(result.filePath, JSON.stringify(enriched, null, 2), 'utf8')
      return result.filePath
    }
  )

  ipcMain.handle('project:load', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Open imagii project',
      properties: ['openFile'],
      filters: [{ name: 'imagii project', extensions: ['imagii.json', 'json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const raw = await readFile(result.filePaths[0], 'utf8')
    return JSON.parse(raw) as ImagiiProject
  })

  ipcMain.handle('autosave:write', (_e, project: ImagiiProject) => writeAutosave(project))
  ipcMain.handle('autosave:read', () => readAutosave())
  ipcMain.handle('autosave:info', () => getAutosaveInfo())
  ipcMain.handle('autosave:clear', () => clearAutosave())
}
