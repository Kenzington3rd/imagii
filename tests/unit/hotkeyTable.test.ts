import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SHORTCUTS_BY_ROUTE } from '../../src/renderer/src/components/HotkeyOverlay'
import { ROUTE_ENTRY, RENDERER_ROOT, collectRouteSources, readAll } from './routeSources'

/**
 * T-13: the HotkeyOverlay table is the only shortcut documentation imagii
 * ships, and until this round nothing checked it against the code. It had
 * drifted twice — Audio Studio advertised a Space play/pause binding that
 * never existed, and Video Studio's Ctrl+Z (added in T-15) was undocumented.
 *
 * So every row must be classified: either it is a keyboard claim, and the
 * route's own component tree must carry the evidence named below, or it is a
 * mouse hint and it says so here. A new row that is neither fails the suite,
 * which is the point — an unclassifiable row is exactly how the last two
 * pieces of drift got in.
 */
const APP_TSX = readFileSync(path.join(RENDERER_ROOT, 'App.tsx'), 'utf8')

/** keys string -> the source evidence that the binding really exists. */
const KEYBOARD_EVIDENCE: Record<string, RegExp> = {
  'Space': /case ' ':/,
  '← / →': /case 'ArrowLeft':/,
  ', / .': /case ',':/,
  'I / O': /case 'i':/,
  'Ctrl+Z / Ctrl+Y': /useUndoRedoHotkeys\(/,
  'Ctrl+V': /addEventListener\('paste'/,
  'Delete / Backspace': /e\.key === 'Delete' \|\| e\.key === 'Backspace'/,
  V: /setTool\('select'\)/,
  R: /setTool\('rect'\)/,
  O: /setTool\('ellipse'\)/,
  L: /setTool\('line'\)/,
  P: /setTool\('pencil'\)/,
  Esc: /e\.key !== 'Escape'/,
  'Enter (search bar)': /e\.key === 'Enter'/
}

/** Rows that document a pointer affordance rather than a key binding. */
const MOUSE_HINTS = new Set([
  'Drag on waveform',
  'Click cut tag',
  'Click thumbnail',
  'Click any card',
  'Save button',
  'Save project',
  'Open project'
])

const sourcesByRoute = new Map<string, string>(
  Object.entries(ROUTE_ENTRY).map(([route, entry]) => [route, readAll(collectRouteSources(entry))])
)

describe('the shortcut table matches the shipped bindings', () => {
  it('documents every route the app can be on', () => {
    expect(Object.keys(SHORTCUTS_BY_ROUTE).sort()).toEqual(Object.keys(ROUTE_ENTRY).sort())
  })

  for (const [route, rows] of Object.entries(SHORTCUTS_BY_ROUTE)) {
    for (const row of rows) {
      it(`${route} — "${row.keys}" is real`, () => {
        if (row.keys === '?') {
          // Owned app-wide by the overlay itself, not by any one route.
          expect(APP_TSX).toMatch(/<HotkeyOverlay \/>/)
          return
        }
        if (MOUSE_HINTS.has(row.keys)) return
        const evidence = KEYBOARD_EVIDENCE[row.keys]
        expect(
          evidence,
          `"${row.keys}" on ${route} is neither a known key binding nor a listed mouse hint — ` +
            'add its evidence pattern to KEYBOARD_EVIDENCE or list it in MOUSE_HINTS'
        ).toBeDefined()
        const source = sourcesByRoute.get(route) ?? ''
        expect(
          evidence?.test(source),
          `${route} advertises "${row.keys}" but no component it renders matches ${String(evidence)} ` +
            '(if the binding was rewritten, update the evidence pattern; if it was removed, ' +
            'remove the row)'
        ).toBe(true)
      })
    }
  }
})

describe('the table honesty check discriminates', () => {
  it('rejects a binding the route does not have', () => {
    // Audio Studio's removed "Space — play/pause" row is the exact drift this
    // suite exists to catch: the waveform has a play BUTTON, not a Space
    // binding. Proof the evidence lookup can fail.
    const audio = sourcesByRoute.get('/audio') ?? ''
    expect(audio.length).toBeGreaterThan(0)
    expect(KEYBOARD_EVIDENCE['Space']?.test(audio)).toBe(false)
    // …while the route that really binds Space still passes.
    expect(KEYBOARD_EVIDENCE['Space']?.test(sourcesByRoute.get('/video') ?? '')).toBe(true)
  })

  it('sees Video Studio undo only because T-15 wired it', () => {
    for (const route of ['/video', '/audio', '/image']) {
      expect(
        KEYBOARD_EVIDENCE['Ctrl+Z / Ctrl+Y']?.test(sourcesByRoute.get(route) ?? ''),
        `${route} binds undo/redo`
      ).toBe(true)
    }
    // Routes with no undo stack must not claim one.
    for (const route of ['/record', '/references', '/home']) {
      expect(
        SHORTCUTS_BY_ROUTE[route]?.some((r) => r.keys.includes('Ctrl+Z')) ?? false,
        `${route} does not advertise undo`
      ).toBe(false)
    }
  })
})
