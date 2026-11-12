import { describe, it, expect } from 'vitest'
import { contextMenuTemplate } from './contextMenu'

const ALL_ON = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
const ALL_OFF = { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false }

describe('contextMenuTemplate (T-166 (4))', () => {
  it('a text box: Undo, Redo, a line, Cut, Copy, Paste, a line, Select all - in that order', () => {
    expect(contextMenuTemplate({ isEditable: true, selectionText: '', editFlags: ALL_ON })).toEqual([
      { role: 'undo', enabled: true },
      { role: 'redo', enabled: true },
      { type: 'separator' },
      { role: 'cut', enabled: true },
      { role: 'copy', enabled: true },
      { role: 'paste', enabled: true },
      { type: 'separator' },
      { role: 'selectAll', enabled: true }
    ])
  })

  it('each item is enabled by its own flag and no other', () => {
    const flags = ['canUndo', 'canRedo', 'canCut', 'canCopy', 'canPaste', 'canSelectAll'] as const
    const roles = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const
    flags.forEach((flag, i) => {
      const items = contextMenuTemplate({ isEditable: true, selectionText: '', editFlags: { ...ALL_OFF, [flag]: true } })
      const enabled = items.flatMap((item) => ('role' in item && item.enabled ? [item.role] : []))
      expect(enabled, `only ${flag} is on`).toEqual([roles[i]])
    })
  })

  it('an empty box with nothing on the clipboard shows every item, all dimmed', () => {
    const items = contextMenuTemplate({ isEditable: true, selectionText: '', editFlags: ALL_OFF })
    expect(items).toHaveLength(8)
    expect(items.every((item) => !('role' in item) || !item.enabled)).toBe(true)
  })

  it('selected words in plain text (not editable): Copy alone, enabled whatever the flags say', () => {
    expect(contextMenuTemplate({ isEditable: false, selectionText: 'a chat line', editFlags: ALL_OFF })).toEqual([{ role: 'copy', enabled: true }])
  })

  it('anything else - no selection, or a selection of only white space, on a page that is not a text box - has no menu', () => {
    expect(contextMenuTemplate({ isEditable: false, selectionText: '', editFlags: ALL_ON })).toEqual([])
    expect(contextMenuTemplate({ isEditable: false, selectionText: '  \n\t ', editFlags: ALL_ON })).toEqual([])
  })

  it('an editable target keeps the text-box menu whatever it has selected', () => {
    expect(contextMenuTemplate({ isEditable: true, selectionText: 'picked', editFlags: ALL_ON })).toHaveLength(8)
  })
})
