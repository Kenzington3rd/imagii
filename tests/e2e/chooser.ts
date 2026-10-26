import type { ElectronApplication } from '@playwright/test'

/**
 * T-126 (6), (19), moved here by T-131 (5) so every spec that presses a button over a native chooser shares ONE stand-in.
 *
 * A chooser that records what it was ASKED and answers the way a person does, after a moment. The moment is the point: a real dialog takes
 * tens of milliseconds to draw and the person's second press of a double-click lands inside it. `delayMs: 300` is that window.
 *
 * `dialog.showOpenDialog` and `dialog.showSaveDialog` are replaced in the MAIN process from the test (the file header of video-pipelines.spec.ts
 * explains why nothing in `src/` changes): every handler reads the method off Electron's `dialog` at call time, so the click, the IPC round trip
 * and everything after the answer stay real. A FOLDER chooser answers `answer` (null: canceled); a FILE chooser takes the next of `files`
 * (null/none left: canceled). A SAVE dialog is replaced only when `saveAs` is given (null: canceled), so a spec that stubs its own Save dialog
 * and then installs this for the open dialogs keeps it. Every call is recorded with the `defaultPath` it was asked to open on.
 */
export interface ChooserCall {
  /** True for a folder chooser (showOpenDialog with `openDirectory`); a file chooser and a Save dialog are false. */
  folder: boolean
  /** True only for a Save dialog. */
  save?: true
  defaultPath?: string
}

export interface SlowChooserOptions {
  answer?: string | null
  files?: string[]
  saveAs?: string | null
  delayMs?: number
}

export async function recordSlowChooser(app: ElectronApplication, options: SlowChooserOptions): Promise<void> {
  await app.evaluate(({ dialog }, o) => {
    const g = globalThis as unknown as { __chooser?: Array<{ folder: boolean; save?: true; defaultPath?: string }> }
    g.__chooser = []
    const queue = [...(o.files ?? [])]
    const later = async (): Promise<void> => {
      if (o.delayMs) await new Promise((resolve) => setTimeout(resolve, o.delayMs))
    }
    ;(dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async (...args: unknown[]) => {
      const asked = (args.length > 1 ? args[1] : args[0]) as { properties?: string[]; defaultPath?: string } | undefined
      const folder = (asked?.properties ?? []).includes('openDirectory')
      g.__chooser?.push({ folder, defaultPath: asked?.defaultPath })
      await later()
      if (folder) return o.answer == null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [o.answer] }
      const next = queue.shift()
      return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] }
    }
    if (o.saveAs !== undefined) {
      ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (...args: unknown[]) => {
        const asked = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string } | undefined
        g.__chooser?.push({ folder: false, save: true, defaultPath: asked?.defaultPath })
        await later()
        return o.saveAs == null ? { canceled: true } : { canceled: false, filePath: o.saveAs }
      }
    }
  }, options)
}

/** Every chooser `recordSlowChooser` has been asked since it was installed. */
export async function chooserCalls(app: ElectronApplication): Promise<ChooserCall[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __chooser?: ChooserCall[] }).__chooser ?? []
  )
}
