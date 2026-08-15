import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { RENDERER_ROOT, ROUTE_ENTRY, collectRouteSources } from './routeSources'

/**
 * Round 23 (T-13, T-14, T-15, T-17, T-18, T-19, T-20): the unit layer runs in
 * node with no DOM, so a mounted React component cannot be rendered here.
 * What CAN be pinned without a DOM is that each control is reachable at all —
 * which is precisely the class of defect the round-22 sweep found: four
 * PresetPanel controls and two HotkeyOverlay interactions were shipped, coded,
 * and unreachable because nothing rendered them.
 *
 * The behavior of each control is unit-tested next to it (see
 * useUndoRedoHotkeys.test.ts, HotkeyOverlay.test.ts, RecentFilesMenu.test.ts,
 * AudioStudio.test.ts, postingDiary.test.ts); the end-state clicks land with
 * the coverage fleet, noted per element below.
 */
const read = (rel: string): string => readFileSync(path.join(RENDERER_ROOT, rel), 'utf8')

const reachableFrom = (route: string): string[] =>
  collectRouteSources(ROUTE_ENTRY[route] as string).map((f) => path.relative(RENDERER_ROOT, f))

describe('T-13 — the hotkey overlay is mounted app-wide', () => {
  // E2E: T-21 (shared chrome) drives `?` open, Esc and the close button shut.
  const app = read('App.tsx')

  it('App.tsx imports and renders it', () => {
    expect(app).toMatch(/import \{ HotkeyOverlay \} from '\.\/components\/HotkeyOverlay'/)
    expect(app).toMatch(/<HotkeyOverlay \/>/)
  })

  it('renders it outside <Routes> so one instance serves every route', () => {
    const closingRoutes = app.indexOf('</Routes>')
    const mount = app.indexOf('<HotkeyOverlay />')
    expect(closingRoutes).toBeGreaterThan(0)
    expect(mount).toBeGreaterThan(closingRoutes)
  })

  it('keeps a close control besides the Escape key', () => {
    const overlay = read('components/HotkeyOverlay.tsx')
    expect(overlay).toMatch(/aria-label="Close shortcuts"/)
    expect(overlay).toMatch(/onClick=\{\(\) => setOpen\(false\)\}/)
  })
})

describe('T-31 — the toast surface is mounted app-wide', () => {
  // E2E: T-21 (shared chrome) reads a Home toast and a studio toast, and
  // counts the toast containers on the page.
  const app = read('App.tsx')

  it('App.tsx imports and renders it', () => {
    expect(app).toMatch(/import \{ AppToaster \} from '\.\/components\/AppToaster'/)
    expect(app).toMatch(/<AppToaster \/>/)
  })

  it('renders it outside <Routes> so one instance serves every route', () => {
    const closingRoutes = app.indexOf('</Routes>')
    const mount = app.indexOf('<AppToaster />')
    expect(closingRoutes).toBeGreaterThan(0)
    expect(mount).toBeGreaterThan(closingRoutes)
  })

  it('leaves no per-studio copy — two Toasters draw every toast twice', () => {
    for (const rel of [
      'modules/video-studio/VideoStudio.tsx',
      'modules/audio-studio/AudioStudio.tsx',
      'modules/image-studio/ImageStudio.tsx',
      'modules/record-studio/RecordStudio.tsx',
      'modules/references/ReferencesStudio.tsx'
    ]) {
      expect(read(rel), rel).not.toMatch(/AppToaster/)
    }
  })
})

describe('T-14 — the cleanup preset panel is reachable', () => {
  // E2E: T-24 (Audio Studio full surface) saves, applies, and deletes a preset.
  it('Audio Studio renders PresetPanel', () => {
    const studio = read('modules/audio-studio/AudioStudio.tsx')
    expect(studio).toMatch(/import \{ PresetPanel \} from '\.\/PresetPanel'/)
    expect(studio).toMatch(/<PresetPanel \/>/)
  })

  it('the panel is in the /audio route tree', () => {
    expect(reachableFrom('/audio')).toContain(path.join('modules', 'audio-studio', 'PresetPanel.tsx'))
  })

  it('its four controls still reach the main-process CRUD', () => {
    const panel = read('modules/audio-studio/PresetPanel.tsx')
    expect(panel).toMatch(/window\.api\.audio\.listPresets\(\)/)
    expect(panel).toMatch(/window\.api\.audio\.savePreset\(/)
    expect(panel).toMatch(/window\.api\.audio\.deletePreset\(/)
    expect(panel).toMatch(/patchChain\(p\.chain\)/)
    // Delete stays behind a confirm (the ledger's native-dialog inventory).
    expect(panel).toMatch(/confirm\(`Delete preset/)
  })

  it('follows the panel conventions rather than a hand-rolled header', () => {
    const panel = read('modules/audio-studio/PresetPanel.tsx')
    expect(panel).toMatch(/<PanelHeader icon="gear">/)
    expect(panel).not.toMatch(/<h3/)
    expect(panel).toMatch(/className="card /)
  })
})

describe('T-15 — Video Studio can undo', () => {
  // E2E: T-22 (Video core) makes a change, undoes, redoes.
  const studio = read('modules/video-studio/VideoStudio.tsx')

  it('has header Undo and Redo buttons bound to the store', () => {
    expect(studio).toMatch(/const undo = useVideoStore\(\(s\) => s\.undo\)/)
    expect(studio).toMatch(/const redo = useVideoStore\(\(s\) => s\.redo\)/)
    expect(studio).toMatch(/disabled=\{!canUndo\}\s*\n\s*onClick=\{undo\}/)
    expect(studio).toMatch(/disabled=\{!canRedo\}\s*\n\s*onClick=\{redo\}/)
    expect(studio).toMatch(/<Icon name="undo" size=\{15\} \/> Undo/)
    expect(studio).toMatch(/<Icon name="redo" size=\{15\} \/> Redo/)
  })

  it('binds the keyboard through the shared hook', () => {
    expect(studio).toMatch(/useUndoRedoHotkeys\(undo, redo\)/)
  })

  it('all three studios share one binding — no fourth copy of the branch', () => {
    for (const rel of [
      'modules/video-studio/VideoStudio.tsx',
      'modules/audio-studio/AudioStudio.tsx',
      'modules/image-studio/ImageStudio.tsx'
    ]) {
      expect(read(rel), rel).toMatch(/useUndoRedoHotkeys\(undo, redo\)/)
      // The old hand-rolled branch must be gone from each of them.
      expect(read(rel), rel).not.toMatch(/e\.key === 'z'/)
    }
  })
})

describe('T-17 — the restructured rows keep their behavior', () => {
  // Structure is pinned repo-wide by interactiveNesting.test.ts; these pin
  // that the restructure did not drop a control. E2E: T-22.
  it('ClipList still selects on the row and renames in place', () => {
    const list = read('modules/video-studio/ClipList.tsx')
    expect(list).toMatch(/onClick=\{\(\) => selectClip\(clip\.id\)\}/)
    expect(list).toMatch(/onChange=\{\(e\) => renameClip\(clip\.id, e\.target\.value\)\}/)
    // Both controls carry their own accessible name now that neither wraps
    // the other.
    expect(list).toMatch(/aria-label=\{`Rename clip \$\{clip\.name\}`\}/)
    expect(list).toMatch(/aria-label=\{`Select clip \$\{clip\.name\}`\}/)
    // The stopPropagation existed only to stop the ancestor button; with the
    // nesting gone it must not linger as cargo.
    expect(list).not.toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/)
  })

  it('TextOverlayEditor still removes an overlay', () => {
    const editor = read('modules/video-studio/TextOverlayEditor.tsx')
    expect(editor).toMatch(/onClick=\{\(\) => removeTextOverlay\(clip\.id, overlay\.id\)\}/)
    expect(editor).toMatch(/aria-label="Remove overlay"/)
    expect(editor).toMatch(/aria-label="Overlay start second"/)
    expect(editor).toMatch(/aria-label="Overlay end second"/)
  })

  it('PropertiesPanel still applies its rotation presets', () => {
    const panel = read('modules/image-studio/PropertiesPanel.tsx')
    expect(panel).toMatch(/onClick=\{\(\) => setRotation\(layer\.id, r\)\}/)
  })
})

describe('T-18 — the recent-files popover has three dismissal paths', () => {
  // E2E: T-21 (shared chrome) drives Escape and click-outside.
  const menu = read('components/RecentFilesMenu.tsx')

  it('keeps mouse-leave', () => {
    expect(menu).toMatch(/onMouseLeave=\{\(\) => setOpen\(false\)\}/)
  })

  it('adds Escape and click-outside', () => {
    expect(menu).toMatch(/window\.addEventListener\('keydown', onKey\)/)
    expect(menu).toMatch(/document\.addEventListener\('mousedown', onPointerDown\)/)
    expect(menu).toMatch(/window\.removeEventListener\('keydown', onKey\)/)
    expect(menu).toMatch(/document\.removeEventListener\('mousedown', onPointerDown\)/)
  })

  it('measures "outside" against the wrapper, toggle button included', () => {
    // Otherwise mousedown closes the menu and the toggle's click reopens it.
    expect(menu).toMatch(/ref=\{wrapperRef\}/)
    expect(menu).toMatch(/wrapper\.contains\(e\.target as Node\)/)
  })
})

describe('T-19 — Audio Studio Close asks first', () => {
  // E2E: T-24 drives both dialog branches.
  it('the Close button goes through the confirm, not straight to clearSource', () => {
    const studio = read('modules/audio-studio/AudioStudio.tsx')
    expect(studio).toMatch(/onClick=\{handleClose\}/)
    expect(studio).not.toMatch(/onClick=\{clearSource\}/)
    expect(studio).toMatch(/if \(!confirmAudioClose\(chain, \(message\) => confirm\(message\)\)\) return/)
  })
})

describe('T-20 — the posting diary lives in the settings store', () => {
  // E2E: T-23 (Video pipelines/export surface) logs a post and reloads.
  const checklist = read('modules/video-studio/PostChecklist.tsx')

  it('reads and writes through window.api.settings', () => {
    expect(checklist).toMatch(/window\.api\.settings\.get<unknown>\('postingDiary'\)/)
    expect(checklist).toMatch(/window\.api\.settings\.set\('postingDiary', next\)/)
  })

  it('touches localStorage only to retire the legacy key', () => {
    expect(checklist).toMatch(/localStorage\.getItem\(DIARY_LEGACY_KEY\)/)
    expect(checklist).toMatch(/localStorage\.removeItem\(DIARY_LEGACY_KEY\)/)
    expect(checklist).not.toMatch(/localStorage\.setItem/)
  })

  it('routes the migration decision through the tested helper', () => {
    expect(checklist).toMatch(/migrateDiary\(\{ stored, legacyRaw \}\)/)
  })
})
