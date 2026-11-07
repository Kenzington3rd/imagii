/**
 * The right-click menu of a text box (T-166 (4)). Electron has no built-in context menu, so without this a right-click in a chat box, a name field or a search
 * box shows nothing, and the mouse path a Windows streamer expects (right-click, Paste) does not exist. This is the pure half: which items, in which order,
 * each enabled by Chromium's own edit flags. Main turns the list into a native menu (it has the electron import; this file does not).
 */

export type ContextMenuItem =
  | { role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'; enabled: boolean }
  | { type: 'separator' }

export interface ContextMenuParams {
  isEditable: boolean
  selectionText: string
  editFlags: {
    canUndo: boolean
    canRedo: boolean
    canCut: boolean
    canCopy: boolean
    canPaste: boolean
    canSelectAll: boolean
  }
}

/** A text box gets the full edit menu; selected words in plain text get Copy alone; anything else (the canvas, the waveform, bare page) gets no menu. */
export function contextMenuTemplate(params: ContextMenuParams): ContextMenuItem[] {
  const { isEditable, selectionText, editFlags: f } = params
  if (isEditable) {
    return [
      { role: 'undo', enabled: f.canUndo },
      { role: 'redo', enabled: f.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: f.canCut },
      { role: 'copy', enabled: f.canCopy },
      { role: 'paste', enabled: f.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: f.canSelectAll }
    ]
  }
  if (selectionText.trim() !== '') return [{ role: 'copy', enabled: true }]
  return []
}
