import { ipcMain, app } from 'electron'
import { getSetting, setSetting } from '../store'
import type { SettingsKey } from '../../shared/api'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', (_e, key: SettingsKey) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key: SettingsKey, value: unknown) => {
    setSetting(key, value)
  })
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.on('app:quit', () => {
    app.quit()
  })
}
