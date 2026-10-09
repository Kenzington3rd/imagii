import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImageSaveManyRequest, ImageSaveRequest } from '../../shared/canvas'
import { assert } from '../../shared/assert'
import { assertNonEmptyString, assertPlainObject } from '../../shared/validators'
import {
  decodeImageDataUrl,
  formatOfFileName,
  isImageFormat,
  safeImageFileName
} from '../imageSave'

/** An emote pack is three files and the variants dialog four; this is a bound, not a target. */
const MAX_FILES_PER_SAVE = 16

/**
 * T-91 — Stream Graphics saves through main.
 *
 * `image:save` is "Save as…" for one picture; `image:saveMany` is "choose a
 * folder" for a set (the emote pack, the variants). Both return only after the
 * dialog has been answered AND the bytes are on disk, and both return `null`
 * when the user canceled — so the renderer can toast "saved" after a save and
 * say nothing after a cancel. (It used to click a hidden `<a download>`, which
 * hands the file to the browser and tells the renderer nothing.)
 *
 * The data URLs are validated BEFORE any dialog opens: a hostile or malformed
 * request is refused without bothering the user.
 */
export function registerImageIpc(): void {
  ipcMain.handle('image:save', async (_e, req: ImageSaveRequest) => {
    assertPlainObject(req, 'image:save req')
    assert(isImageFormat(req.format), 'image:save format must be png or jpg')
    const bytes = decodeImageDataUrl(req.dataUrl, req.format)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'Save image',
      defaultPath: safeImageFileName(req.defaultName, req.format),
      filters: [
        req.format === 'png'
          ? { name: 'PNG image', extensions: ['png'] }
          : { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }
      ]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, bytes)
    return result.filePath
  })

  ipcMain.handle('image:saveMany', async (_e, req: ImageSaveManyRequest) => {
    assertPlainObject(req, 'image:saveMany req')
    assertNonEmptyString(req.title, 'image:saveMany title')
    assert(
      Array.isArray(req.files) && req.files.length > 0 && req.files.length <= MAX_FILES_PER_SAVE,
      `image:saveMany files must be 1-${MAX_FILES_PER_SAVE} entries`
    )
    // Everything is decoded and named up front, so one bad entry refuses the
    // whole save instead of leaving a half-written folder.
    const prepared = req.files.map((f) => {
      assertPlainObject(f, 'image:saveMany file')
      const format = typeof f.name === 'string' ? formatOfFileName(f.name) : null
      assert(format !== null, 'image:saveMany file name must end in .png or .jpg')
      return {
        name: safeImageFileName(f.name, format),
        bytes: decodeImageDataUrl(f.dataUrl, format)
      }
    })
    assert(
      new Set(prepared.map((p) => p.name)).size === prepared.length,
      'image:saveMany file names must be distinct'
    )
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: req.title,
      buttonLabel: 'Save here',
      properties: ['openDirectory', 'createDirectory']
    })
    const dir = result.filePaths[0]
    if (result.canceled || dir === undefined) return null
    for (const file of prepared) {
      await writeFile(path.join(dir, file.name), file.bytes)
    }
    return { dir, count: prepared.length }
  })
}
