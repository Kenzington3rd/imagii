/**
 * Writing the window's geometry down (T-47, T-124 (4)).
 *
 * `persistWindowBounds` ran from a debounce timer and from the window's `close` handler with nothing above
 * either to catch a throw. A `config.json` another program holds open (a sync client, an antivirus scan, a
 * read-only attribute: EPERM on the rename electron-store's atomic write ends in) made the write throw: from the
 * timer that is an uncaught exception in main, which raises Electron's blocking "A JavaScript error occurred in
 * the main process" dialog, and from the `close` handler it aborted the handler before the quit snapshot was
 * asked for, so closing the window lost the work the snapshot exists to keep. It was the one unguarded
 * synchronous config write left in main. A window that forgets its size is a small loss; nothing here is worth a
 * dialog or a lost snapshot, so a failed write is logged and the app carries on.
 */

/** The three questions the write asks of a window; `BrowserWindow` answers all of them. */
export interface BoundsSource {
  isDestroyed(): boolean
  getNormalBounds(): { x: number; y: number; width: number; height: number }
  isMaximized(): boolean
}

export interface StoredBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/**
 * Saves the window's geometry through `write`. Never throws: a window that is gone is skipped, and a failure to
 * ask the window or to write the file is a console warning.
 */
export function persistWindowBounds(win: BoundsSource, write: (bounds: StoredBounds) => void): void {
  try {
    if (win.isDestroyed()) return
    // getNormalBounds, not getBounds: while the window is maximized the
    // latter reports the whole work area, which would overwrite the size the
    // user actually chose and leave nothing to un-maximize back to.
    const bounds = win.getNormalBounds()
    write({ ...bounds, maximized: win.isMaximized() })
  } catch (err) {
    console.warn(`[imagii] could not save the window size and position: ${err instanceof Error ? err.message : String(err)}`)
  }
}
