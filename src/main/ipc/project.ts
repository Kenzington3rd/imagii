import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import type { ImagiiProject } from '../../shared/workspace'
import {
  writeAutosave,
  readAutosave,
  clearAutosave,
  getAutosaveInfo
} from '../autosave'
import { validateProject, validateProjectJsonString } from '../../shared/projectValidation'
import { assert, assertDefined } from '../../shared/assert'

export interface ProjectLoadResult {
  ok: true
  project: ImagiiProject
  filePath: string
}

export interface ProjectLoadError {
  ok: false
  reason: string
}

export function registerProjectIpc(): void {
  ipcMain.handle(
    'project:save',
    async (_e, project: ImagiiProject, defaultName?: string) => {
      const enriched: ImagiiProject = {
        ...project,
        savedAt: Date.now(),
        appVersion: app.getVersion()
      }
      // Validate the about-to-be-written payload at the IPC boundary so a
      // bad project never reaches disk.
      const valid = validateProject(enriched)
      assert(valid.ok, valid.ok ? 'unreachable' : `project:save invalid project — ${valid.reason}`)

      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: 'Save imagii project',
        defaultPath: defaultName ?? 'project.imagii.json',
        filters: [{ name: 'imagii project', extensions: ['imagii.json', 'json'] }]
      })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, JSON.stringify(enriched, null, 2), 'utf8')
      return result.filePath
    }
  )

  ipcMain.handle(
    'project:load',
    async (): Promise<ProjectLoadResult | ProjectLoadError | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        title: 'Open imagii project',
        properties: ['openFile'],
        filters: [{ name: 'imagii project', extensions: ['imagii.json', 'json'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const filePath = assertDefined(result.filePaths[0], 'filePath')
      let raw: string
      try {
        raw = await readFile(filePath, 'utf8')
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : 'read failed' }
      }
      const validation = validateProjectJsonString(raw)
      if (!validation.ok) {
        return { ok: false, reason: validation.reason }
      }
      return { ok: true, project: validation.project, filePath }
    }
  )

  ipcMain.handle('autosave:write', (_e, project: ImagiiProject) => writeAutosave(project))
  ipcMain.handle('autosave:read', () => readAutosave())
  ipcMain.handle('autosave:info', () => getAutosaveInfo())
  ipcMain.handle('autosave:clear', () => clearAutosave())
}
