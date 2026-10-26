import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { readFile } from 'node:fs/promises'
import type { ImagiiProject } from '../../shared/workspace'
import {
  writeAutosave,
  readAutosave,
  clearAutosave,
  getAutosaveInfo
} from '../autosave'
import { projectSizeProblem, serializeProject, validateProject, validateProjectJsonString } from '../../shared/projectValidation'
import { assertAlways, assertDefined } from '../../shared/assert'
import { writeFileAtomic } from '../fsAtomic'

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
      assertAlways(valid.ok, valid.ok ? 'unreachable' : `project:save invalid project — ${valid.reason}`)

      // T-137 (6): the SAME size rule Open and autosave hold, on the one serialization they hold it on, asked before the person is asked where to save
      // (a finished sentence, which the Save button's toast shows as written). The file is exactly the text that was measured, so it always opens.
      const raw = serializeProject(enriched)
      const tooLarge = projectSizeProblem(raw.length, 'save')
      if (tooLarge !== null) throw new Error(tooLarge)

      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: 'Save imagii project',
        defaultPath: defaultName ?? 'project.imagii.json',
        filters: [{ name: 'imagii project', extensions: ['imagii.json', 'json'] }]
      })
      if (result.canceled || !result.filePath) return null
      // T-139 (1): the chosen file stays the old project until the new one is whole (a full drive used to leave a stub Open refuses).
      await writeFileAtomic(result.filePath, raw)
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
