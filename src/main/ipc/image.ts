import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { buildPdf, type PdfPageSpec } from '../image/pdf'

export function registerImageIpc(): void {
  ipcMain.handle(
    'image:savePdf',
    async (
      _e,
      spec: { pages: PdfPageSpec[]; dpi: number; title?: string; defaultName?: string }
    ) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: 'Save PDF',
        defaultPath: spec.defaultName ?? 'imagii-canvas.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return null
      const built = await buildPdf({
        outputPath: result.filePath,
        dpi: spec.dpi,
        pages: spec.pages,
        title: spec.title,
        author: 'imagii user'
      })
      return built
    }
  )

  ipcMain.handle('image:revealInFolder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}
