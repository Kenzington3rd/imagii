import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
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
    // T-92: the dismiss control says "Close" (not "Esc"); the Esc hint is the
    // footer line, and a copy of it on the button is the label that varied.
    expect(overlay).toMatch(/>\s*Close\s*<\/button>/)
    expect(overlay).toMatch(/Press Esc or \? to close/)
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
    // T-90: Apply patches the preset's CLEANUP settings, never the raw chain.
    expect(panel).toMatch(/patchChain\(presetPatch\(p\)\)/)
    expect(panel).not.toMatch(/patchChain\(p\.chain\)/)
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

  // T-58 made it four: References grew a history, and joined the binding
  // rather than growing a copy of it.
  it('all four studios share one binding — no second copy of the branch', () => {
    for (const rel of [
      'modules/video-studio/VideoStudio.tsx',
      'modules/audio-studio/AudioStudio.tsx',
      'modules/image-studio/ImageStudio.tsx',
      'modules/references/ReferencesStudio.tsx'
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
    // T-112 (label in name): the accessible name still starts with the clip's name and now
    // CONTAINS the timecode the button shows.
    expect(list).toMatch(
      /aria-label=\{`Select clip \$\{clip\.name\}, \$\{formatClock\(clip\.startSec\)\} → \$\{formatClock\(clip\.endSec\)\}`\}/
    )
    // The stopPropagation existed only to stop the ancestor button; with the
    // nesting gone it must not linger as cargo.
    expect(list).not.toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/)
  })

  it('TextOverlayEditor still removes an overlay', () => {
    const editor = read('modules/video-studio/TextOverlayEditor.tsx')
    expect(editor).toMatch(/onClick=\{\(\) => removeTextOverlay\(clip\.id, overlay\.id\)\}/)
    expect(editor).toMatch(/aria-label="Remove overlay"/)
    // T-125 (27): each box's name BEGINS with the text it shows beside it (WCAG 2.5.3, label in name); the start box was
    // "Overlay start second" beside a visible "Source time".
    expect(editor).toMatch(/aria-label="Source time, start \(seconds, or a time like 2:47:13\)"/)
    expect(editor).toMatch(/aria-label="Source time, end \(seconds, or a time like 2:47:13\)"/)
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

describe('T-59 — a success toast reports what happened, not what was attempted', () => {
  // E2E: tests/e2e/record.spec.ts drives the crashed convert end to end
  // (friendly toast, no partial file); tests/e2e/video-pipelines.spec.ts
  // drives the highlight Add. Both facts below are one line of source each
  // and unreachable from a node test without a DOM, so they are pinned here.

  it('HighlightPanel gates its "Clip added" on the store not refusing (T-94: addScannedClip)', () => {
    const panel = read('modules/video-studio/HighlightPanel.tsx')
    expect(panel).toMatch(
      /const added = addScannedClip\(`Highlight \$\{index \+ 1\}`, h\.startSec, h\.endSec\)/
    )
    expect(panel).toMatch(/if \(added === 'refused'\) \{/)
    // The refusal says so rather than passing for a success.
    const gate = panel.slice(panel.indexOf("if (added === 'refused')"), panel.indexOf('Clip added'))
    expect(gate).toMatch(/toast\.error\(/)
    expect(gate).toMatch(/return/)
  })

  it('ChatHighlightPanel still has the same gate (T-48, the shape this copies)', () => {
    const panel = read('modules/video-studio/ChatHighlightPanel.tsx')
    expect(panel).toMatch(/const added = addScannedClip\(/)
    expect(panel).toMatch(/if \(added === 'refused'\) \{/)
  })

  it('RecordStudio unwraps the IPC envelope instead of toasting err.message', () => {
    const studio = read('modules/record-studio/RecordStudio.tsx')
    // T-117: and the source list is `reportFailure` too (it was the last renderer site that showed main's
    // string as written; failurePathLanguage.test.ts fails on a new one).
    expect(studio).not.toMatch(/ipcErrorMessage/)
    expect(studio).toMatch(/reportFailure\(err, \{ failed: "Couldn't list what can be recorded\." \}\)/)
    // The old line: Electron's "Error invoking remote method
    // 'recording:finalize': …" reached the toast in full.
    expect(studio).not.toMatch(/toast\.error\(err instanceof Error \? err\.message : 'Save failed'\)/)
  })

  // T-117 (4): stripping the envelope was all the save-failure toast did, so a copyfile EPERM (with both
  // full paths), an ENOSPC from the write stream and "recording:finalize recording is empty" each reached
  // the person as main's raw string - only the convert crash had a sentence. The failure goes through
  // `reportFailure` (userFacingError; 8 s, ERROR_TOAST_MS, pinned in lib/reportFailure.test.ts) with the
  // studio's own lead sentence. The mapping itself is userFacingError.test.ts; the toast a person reads is
  // record.spec.ts.
  it("RecordStudio's save failure goes through reportFailure with its own sentence, not ipcErrorMessage", () => {
    const studio = read('modules/record-studio/RecordStudio.tsx')
    const finalize = studio.slice(studio.indexOf('async function finalizeRecording'), studio.indexOf('function announceDiscarded'))
    expect(finalize.length, 'the slice found finalizeRecording').toBeGreaterThan(500)
    expect(finalize).toMatch(/reportFailure\(err, \{ failed: 'Saving the recording failed\.' \}\)/)
    expect(finalize).not.toMatch(/ipcErrorMessage\(/)
    expect(finalize).not.toMatch(/'Save failed'/)
    // A discard (the cancel sentinel) is still the calm line, decided BEFORE the failure report.
    expect(finalize.indexOf('isCancelledError(err)')).toBeGreaterThan(-1)
    expect(finalize.indexOf('isCancelledError(err)')).toBeLessThan(finalize.indexOf('reportFailure('))
  })
})

describe('T-94 — only the highlight scanners retire the whole-video clip', () => {
  // The store's unit tests prove WHAT addScannedClip does; this pins WHO calls
  // it. The distinction is the whole feature: a manual "+ Add clip" is the
  // user making a clip on purpose and must never delete one, and a scanner's
  // "+ Clip" that quietly went to the plain add would put the three-hour VOD
  // back into every export. (T-101 deleted the store's second range-add,
  // `addClipFromRange`, which no control called; deadActions.test.ts is what
  // stops another from surviving.) E2E: video-pipelines.spec.ts.
  const scanners = [
    'modules/video-studio/HighlightPanel.tsx',
    'modules/video-studio/ChatHighlightPanel.tsx'
  ]

  it.each(scanners)('%s adds through addScannedClip, and says so when it retired a clip', (file) => {
    const panel = read(file)
    expect(panel).toMatch(/useVideoStore\(\(s\) => s\.addScannedClip\)/)
    expect(panel).toMatch(/added === 'added-dropped-whole-video'/)
    expect(panel).toMatch(/toast\(WHOLE_VIDEO_DROPPED_MESSAGE/)
  })

  it('the manual paths do not: ClipList adds through addClip', () => {
    const list = read('modules/video-studio/ClipList.tsx')
    expect(list).toMatch(/useVideoStore\(\(s\) => s\.addClip\)/)
    expect(list).not.toMatch(/addScannedClip/)
  })

  it('the Export and Compile buttons say how many files and clips they will make', () => {
    expect(read('modules/video-studio/ExportPanel.tsx')).toMatch(
      /`Export \$\{countOf\(totalQueued, 'file'\)\}`/
    )
    expect(read('modules/video-studio/CompilationPanel.tsx')).toMatch(
      /`Compile \$\{countOf\(clips\.length, 'clip'\)\}`/
    )
  })
})

describe('T-57 — clearing an autosave has an error path', () => {
  // E2E: tests/e2e/home-chrome.spec.ts drives a failing autosave:clear and
  // reads the toast plus the banner that stays.
  const banner = read('components/AutosaveRestore.tsx')

  it('clearAutosave() catches a failed clear', () => {
    // T-92: renamed from discard() when both banners' buttons became "Clear".
    const discard = banner.slice(
      banner.indexOf('async function clearAutosave'),
      banner.indexOf('const ageText')
    )
    expect(discard).toMatch(/await window\.api\.autosave\.clear\(\)/)
    expect(discard).toMatch(/\} catch \(err\) \{/)
    // T-117: the failure is `reportFailure` (8 s, a plain cause where the shape is known). It spliced
    // main's string into its own sentence before ("Couldn't clear the autosave: <reason>.").
    expect(discard).toMatch(/reportFailure\(err, \{ failed: "Couldn't clear the autosave\. It's still on disk\." \}\)/)
    expect(discard).not.toMatch(/ipcErrorMessage|toast\.error\(/)
    // Truthful state: the banner is only dismissed on the branch where the
    // file is actually gone.
    const dismissIndex = discard.indexOf('setDismissed(true)')
    const catchIndex = discard.indexOf('} catch (err) {')
    expect(dismissIndex).toBeGreaterThan(-1)
    expect(dismissIndex).toBeLessThan(catchIndex)
  })

  it('both banner buttons that start the clear are disabled while it runs', () => {
    const corruptionBanner = banner.slice(
      banner.indexOf('imagii found an autosave from'),
      banner.indexOf('imagii autosaved your work')
    )
    expect(corruptionBanner).toMatch(/>\s*Clear\s*</)
    expect(corruptionBanner).toMatch(/disabled=\{busy\}/)
    // T-92: the healthy banner's button is "Clear" too (it was "Discard"), and
    // starts the same call, so it is held to the same disabled-while-busy rule.
    const healthyBanner = banner.slice(banner.indexOf('imagii autosaved your work'))
    expect(healthyBanner).toMatch(/onClick=\{\(\) => void clearAutosave\(\)\}\s*disabled=\{busy\}/)
    expect(healthyBanner).toMatch(/>\s*Clear\s*</)
    expect(healthyBanner).not.toMatch(/Discard/)
  })
})

describe('T-54 — the document background is a node the export can see', () => {
  // E2E: tests/e2e/image.spec.ts "the document background lands in the bytes…"
  // samples a background pixel out of a real exported PNG and JPG, and the
  // transparent corner of a real emote pack. The three facts below are the
  // ones a future edit could quietly undo, and none is reachable without a DOM.
  const canvas = read('modules/image-studio/Canvas.tsx')
  /** The document layer's opening tag through the first element inside it. */
  const documentLayer = canvas.slice(
    canvas.indexOf('<KonvaLayer>'),
    canvas.indexOf('{doc.layers.map(renderLayer)}')
  )
  const backgroundRect = documentLayer.slice(
    documentLayer.indexOf('<Rect'),
    documentLayer.indexOf('/>', documentLayer.indexOf('<Rect'))
  )

  it('draws doc.background as the first node of the document layer', () => {
    // `documentLayer` ends where the user's layers begin, so a background
    // found in it is drawn BEFORE them — one painted over the artwork is not
    // a background.
    expect(backgroundRect).toMatch(/name="background"/)
    expect(backgroundRect).toMatch(/fill=\{doc\.background\}/)
    expect(backgroundRect).toMatch(/width=\{doc\.width\}/)
    expect(backgroundRect).toMatch(/height=\{doc\.height\}/)
    // Not a click target: the empty-canvas click is what deselects, and it
    // only reaches the Stage while nothing is listening in front of it.
    expect(backgroundRect).toMatch(/listening=\{false\}/)
  })

  it('no longer leaves the background as a CSS style Konva cannot see', () => {
    expect(canvas).not.toMatch(/background: doc\.background/)
  })

  it('does not tag it chrome — that tag means "hide for the capture"', () => {
    expect(backgroundRect).not.toMatch(/chrome/)
    // The two layers that ARE chrome still carry the tag (T-53).
    expect(canvas).toMatch(/name="grid chrome"/)
    expect(canvas).toMatch(/name="overlay chrome"/)
  })
})

describe('T-46 — the variants dialog captures the document, not the screen', () => {
  // E2E: tests/e2e/image.spec.ts "variants: generate four tiles…" saves a
  // variant and reads 1280x720 off the bytes, and drives the reopen both ways.
  const variants = read('modules/image-studio/ThumbnailVariants.tsx')

  it('renders its base through the shared captureDocument', () => {
    expect(variants).toMatch(/import \{ captureDocument, type ExportStage \} from '\.\/ExportDialog'/)
    expect(variants).toMatch(/captureDocument\(stage, doc\.width, doc\.height, \{/)
  })

  it('keeps no raw stage.toDataURL of its own', () => {
    // The renderer's last raw stage capture was deleted in T-53; this one was
    // the other half of it, and either is a ready-made way back to T-45/T-53.
    expect(variants).not.toMatch(/stage\.toDataURL/)
  })

  it('ties the previews to the document they were rendered from', () => {
    // T-120: the empty case is one shared array (NO_PREVIEWS), so the focus effect can key on the list's identity.
    expect(variants).toMatch(/previews !== null && previews\.doc === doc \? previews\.items : NO_PREVIEWS/)
    expect(variants).toMatch(/setPreviews\(\{ doc, items: out \}\)/)
  })

  it('offers Generate and Regenerate through the same handler', () => {
    // Which is why the E2E's "generating re-reads the canvas" proof covers
    // both buttons: Regenerate is Generate with a different label.
    expect(variants.match(/onClick=\{generate\}/g)).toHaveLength(2)
  })
})

describe('T-49 — the export panel carries no copy a user can never reach', () => {
  // E2E: tests/e2e/video-pipelines.spec.ts "refuses to start without an output
  // folder…" drives the refusal that IS reachable — the disabled button — and
  // watches the toast log stay clean. The deleted branch can only be pinned
  // here: a string no code path reaches is invisible to a DOM test, which is
  // exactly how it survived long enough to be documented as a defect.
  const panel = read('modules/video-studio/ExportPanel.tsx')

  it('has no "No presets selected on any clip" toast behind the disabled button', () => {
    expect(panel).not.toMatch(/No presets selected/)
  })

  it('still refuses at zero queued targets, by disabling Export', () => {
    // The reachable half of the same guard. If this line ever goes, the
    // deleted branch stops being dead and its removal becomes a bug.
    expect(panel).toMatch(/disabled=\{running \|\| totalQueued === 0\}/)
  })

  it('remembers the watermark corner with the handle, not instead of it', () => {
    // Both keys are written in the same block, so a future edit cannot drop
    // one and leave the export remembering half of one preference.
    const persist = panel.slice(panel.indexOf('if (watermark) {'), panel.indexOf('const sourceBase'))
    expect(persist).toMatch(/settings\.set\('streamerHandle', watermark\.text\)/)
    expect(persist).toMatch(/settings\.set\('watermarkPosition', watermark\.position\)/)
  })

  // T-119 (13): and forgets them together. The guide says Clip Kit stamps "the watermark you last exported
  // with"; an export with the field blank used to leave the previous handle on disk for the kit to stamp.
  // E2E: video-pipelines.spec.ts "a blank export forgets the saved watermark" (the file on disk and the kit).
  it('a blank watermark clears the handle and the corner together, in the same block', () => {
    const persist = panel.slice(panel.indexOf('if (watermark) {'), panel.indexOf('const sourceBase'))
    const blank = persist.slice(persist.indexOf('} else {'))
    expect(blank).toMatch(/settings\.set\('streamerHandle', undefined\)/)
    expect(blank).toMatch(/settings\.set\('watermarkPosition', undefined\)/)
  })
})

describe('T-73 — one Escape closes one dialog, and it is the topmost', () => {
  // E2E: tests/e2e/home-chrome.spec.ts "Escape closes only the topmost dialog"
  // drives the ONE stack a user can build today — the `?` shortcuts overlay
  // raised over a tutorial coachmark — and its mutation proof is the
  // coachmark's own guard. Modal-over-Modal is not reachable in this app: no
  // dialog opens another, and every opener sits behind a scrim. That half of
  // the claim can only be pinned here, which is exactly how the T-49 dead
  // branch survived long enough to be documented.
  const modal = read('components/Modal.tsx')
  const tutorial = read('components/Tutorial.tsx')
  const trap = read('hooks/useFocusTrap.ts')

  it('Modal answers Escape only while it holds the topmost claim', () => {
    const handler = modal.slice(modal.indexOf("if (e.key !== 'Escape')"), modal.indexOf('onClose()'))
    expect(handler).toMatch(/if \(!isTopmost\(\)\) return/)
  })

  it('the coachmark consults the same claim before acting on any key', () => {
    const handler = tutorial.slice(
      tutorial.indexOf('function onKey'),
      tutorial.indexOf('const intent =')
    )
    expect(handler).toMatch(/if \(!isTopmost\(\)\) return/)
  })

  it('both take that claim from the one shared trap', () => {
    for (const [label, source] of [
      ['Modal.tsx', modal],
      ['Tutorial.tsx', tutorial]
    ] as const) {
      expect(source, label).toMatch(/import \{ useFocusTrap \} from '\.\.\/hooks\/useFocusTrap'/)
      expect(source, label).toMatch(/useFocusTrap\(/)
    }
  })

  it('leaves no second copy of the trap behind (T-64, the T-15 precedent)', () => {
    // One binding, one implementation. A component that re-grows its own
    // focusable query has stopped sharing the claim with it.
    for (const [label, source] of [
      ['Modal.tsx', modal],
      ['Tutorial.tsx', tutorial]
    ] as const) {
      expect(source, label).not.toMatch(/FOCUSABLE|querySelectorAll/)
    }
    expect(trap).toMatch(/FOCUSABLE_SELECTOR/)
  })

  // T-127 (8): E2E video-pipelines.spec.ts drives the double-click on Export with the safe-zone question pending. This is the one
  // shared place the rule lives, so every dialog has it: the scrim closes on a click that BEGAN and ENDED on the scrim (T-123 (7))
  // and is not the second click of a multi-click.
  it('the scrim closes the dialog only on a first click that began and ended on it: a press that touched the card and a second click are ignored (T-127 (8), T-123 (7))', () => {
    const code = modal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(
      /onClick=\{\(e\) => \{\s*const dragged = pressTouchedCardRef\.current\s*pressTouchedCardRef\.current = false\s*if \(dragged\) return\s*if \(e\.detail > 1\) return\s*if \(closeOnScrimClick\) onClose\(\)\s*\}\}/
    )
  })

  it('keeps the topmost dialog topmost on screen', () => {
    // The claim decides who answers Escape; the z-order has to agree, or the
    // dialog that owns the keyboard is the one buried under the other's scrim.
    const modalZ = /z-\[(\d+)\]/.exec(modal)
    const tutorialZ = /z-\[(\d+)\]/.exec(tutorial)
    expect(modalZ?.[1]).toBeDefined()
    expect(tutorialZ?.[1]).toBeDefined()
    expect(Number(modalZ?.[1])).toBeGreaterThan(Number(tutorialZ?.[1]))
  })
})

/**
 * T-28 — `prompt` is not a thing in Electron, and never becomes one.
 *
 * MoodBoardPanel.onRename and ReferencePanel.ensureCollection both asked for
 * a name with `window.prompt`. Electron does not implement it: the renderer
 * throws "prompt() is and will not be supported.", no dialog appears, and the
 * control is dead while looking perfectly healthy. That is invisible to a
 * types check, invisible to a review that reads the line as ordinary DOM, and
 * — because the failure is a throw inside a click handler — invisible to
 * anything but a test that watches for it.
 *
 * So the rule is enforced on the whole tree rather than on the two files that
 * happened to break: the app asks for a name with `<NameDialog>`.
 * E2E: tests/e2e/references.spec.ts drives both flows to disk.
 */
describe('T-28 — nothing in src/ calls the DOM prompt', () => {
  const SRC_ROOT = path.resolve(__dirname, '../../src')

  /**
   * Every call in `code` whose callee is `prompt` or `<something>.prompt`.
   *
   * Parsed rather than grepped, for the reason interactiveNesting gives: a
   * regex over source text answers a question about characters, not about
   * code. The first draft of this check flagged its own doc comment, and
   * would have flagged a string in an error message just as happily — a
   * scanner nobody can write prose around gets weakened until it passes.
   */
  function promptCalls(code: string, file = 'x.tsx'): string[] {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
    const found: string[] = []
    function walk(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const name = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isIdentifier(callee)
            ? callee.text
            : null
        if (name === 'prompt') found.push(callee.getText(source))
      }
      ts.forEachChild(node, walk)
    }
    walk(source)
    return found
  }

  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) sources(full, out)
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
    }
    return out
  }

  const files = sources(SRC_ROOT)

  it('finds sources to check', () => {
    // Floor: a scanner that silently matched nothing would look identical to
    // a clean tree (the interactiveNesting lesson).
    expect(files.length).toBeGreaterThan(100)
  })

  it('has no call left anywhere', () => {
    const offenders = files
      .filter((f) => promptCalls(readFileSync(f, 'utf8'), f).length > 0)
      .map((f) => path.relative(SRC_ROOT, f))
    expect(offenders).toEqual([])
  })

  it('discriminates: it catches both spellings of the call it removed', () => {
    // The exact two lines that were in the tree, plus the bare form.
    expect(promptCalls("const next = prompt('Rename mood board', collection.name)")).toEqual([
      'prompt'
    ])
    expect(promptCalls("const name = window.prompt('Name your first mood board:')")).toEqual([
      'window.prompt'
    ])
    expect(promptCalls('function f() { return globalThis.prompt() }')).toEqual([
      'globalThis.prompt'
    ])
  })

  it('does not fire on names that merely end in "prompt", or on prose', () => {
    // A future AI-art panel with a `setPrompt(value)` call must not fail the
    // build; the rule is about the DOM function, not about the word.
    expect(promptCalls('setPrompt(value)')).toEqual([])
    expect(promptCalls('const userPrompt = promptText')).toEqual([])
    expect(promptCalls("throw new Error('prompt() is not supported') // prompt(x)")).toEqual([])
  })

  it('names NameDialog as the replacement, and both flows use it', () => {
    expect(read('components/NameDialog.tsx')).toMatch(/<Modal/)
    for (const rel of [
      'modules/references/MoodBoardPanel.tsx',
      'modules/references/ReferencePanel.tsx'
    ]) {
      expect(read(rel), rel).toMatch(/<NameDialog/)
    }
  })
})

describe('T-88 — Record: Refresh sources re-checks what its hints send people to it for', () => {
  // E2E: tests/e2e/record.spec.ts — "Refresh sources re-scans the microphone and
  // camera" counts the scan's calls through the click; "a microphone and NO
  // camera" and "with a camera attached" prove the lists are independent; the
  // saving-card and sentinel tests drive the post-Stop copy. These pins are the
  // shape underneath them: the button is wired to the function that does both
  // jobs, and the combined probe that blanked a list is not coming back.
  const studio = read('modules/record-studio/RecordStudio.tsx')
  const code = studio.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the button runs refreshAll, and refreshAll runs BOTH the source list and the device scan', () => {
    expect(code).toMatch(/onClick=\{refreshAll\}/)
    const body = /function refreshAll\(\): void \{([\s\S]*?)\n  \}/.exec(code)?.[1] ?? ''
    expect(body).toMatch(/chooseSource\(\)/)
    expect(body).toMatch(/refreshDevices\(\)/)
  })

  it('scans through scanDevices (one probe per kind) and never asks for audio and video in one call', () => {
    expect(code).toMatch(/scanDevices\(navigator\.mediaDevices\)/)
    expect(code).not.toMatch(/audio:\s*true,\s*video:\s*true/)
  })

  it('both hints come from noDeviceHint, and the old "after granting permission" hint is gone', () => {
    expect(code).toMatch(/noDeviceHint\('microphone'\)/)
    expect(code).toMatch(/noDeviceHint\('camera'\)/)
    expect(code).not.toMatch(/after granting permission/)
  })

  it('the save card is the saveCard() copy, and Discard is gated on it', () => {
    expect(code).toMatch(/const save = saveCard\(convertToMp4, discarding\)/)
    expect(code).toMatch(/disabled=\{!save\.canDiscard\}/)
    expect(code).not.toMatch(/converting and writing to disk/)
  })

  it('a rejected discard goes through the one failure helper, and a sentinel rejection is a discard', () => {
    expect(code).toMatch(/\.cancelSave\(\)[\s\S]*?\.catch\(\(err\) => \{[\s\S]*?reportFailure\(err/)
    expect(code).toMatch(/if \(isCancelledError\(err\)\) \{/)
  })

  // T-115: the convert's progress carries a percent only when main measured one. An event without
  // it is "working": the bar slides (E2E "the convert bar draws what main reports"). `?? 0` here
  // would be the old lie in a new place - a bar parked at its 2% floor for the whole convert.
  it('a progress event without a percent is "no measurement" (null), and null draws the sliding bar', () => {
    expect(code).toMatch(/setSavePercent\(info\.percent \?\? null\)/)
    expect(code).toMatch(/useState<number \| null>\(0\)/)
    expect(code).toMatch(/savePercent === null \? \(\s*<div className="h-full bg-accent progress-indeterminate" \/>/)
  })
})

describe('T-90 — the Fix Wizard shows what it applies, and Start over starts over', () => {
  // E2E: audio.spec.ts "Fix Wizard reconfigures Cleanup and Levels…". Unit:
  // fixWizard.test.ts runs all 18 answer combinations through the pure halves.
  const wizard = read('modules/audio-studio/FixWizard.tsx')

  it('builds the patch ONCE and renders the list from it', () => {
    expect(wizard.match(/fixPatch\(/g)).toHaveLength(1)
    expect(wizard).toMatch(/fixSummary\(patch\)/)
  })

  it('applies that same object — no second derivation from the answers', () => {
    expect(wizard).toMatch(/patchChain\(patch\)/)
    // The component never reads an answer to decide what a setting is: that is
    // what let the list and the apply step disagree.
    expect(wizard).not.toMatch(/answers\.(backgroundNoise|primaryUse)/)
  })

  it('Start over restarts the wizard; Close is what closes it', () => {
    expect(wizard).toMatch(/onClick=\{restart\}\s*>\s*Start over/)
    expect(wizard.match(/onClick=\{close\}/g)?.length).toBeGreaterThanOrEqual(1)
    // restart() must not close: onClose is called from close() only.
    const restartFn = wizard.slice(wizard.indexOf('function restart'), wizard.indexOf('function close'))
    expect(restartFn).not.toMatch(/onClose/)
  })

  it('speaks as imagii, not as "I"', () => {
    expect(wizard).not.toMatch(/\bI'll\b/)
    expect(wizard).toMatch(/imagii will set/)
  })
})

describe('T-90 — preset save and delete report failures', () => {
  const panel = read('modules/audio-studio/PresetPanel.tsx')

  it('both IPC calls sit inside a try with a reportFailure catch', () => {
    expect(panel).toMatch(/try \{\s*await window\.api\.audio\.savePreset\([^)]*\)\s*\} catch \(err\) \{\s*reportFailure\(err/)
    expect(panel).toMatch(/try \{\s*await window\.api\.audio\.deletePreset\([^)]*\)\s*\} catch \(err\) \{\s*reportFailure\(err/)
  })

  it('says exactly what a preset keeps', () => {
    expect(panel).toMatch(
      /Saves your cleanup settings — noise, levels, and voice treatments — so you can reuse\s+them\. Cuts and the second track stay with the session\./
    )
  })
})

describe('T-91 — Stream Graphics saves through main and toasts after the save', () => {
  // E2E: tests/e2e/image.spec.ts "export: …" and "variants: …" drive the real
  // dialogs both ways (saved / canceled). These pin the shape that makes the
  // lie impossible: no hidden <a download>, and no success toast above the await.
  const exportDialog = read('modules/image-studio/ExportDialog.tsx')
  const variants = read('modules/image-studio/ThumbnailVariants.tsx')

  it('neither dialog clicks a hidden download link any more', () => {
    for (const [rel, src] of [['ExportDialog', exportDialog], ['ThumbnailVariants', variants]]) {
      expect(src, rel).not.toMatch(/\.download\s*=/)
      expect(src, rel).not.toMatch(/createElement\('a'\)/)
      expect(src, rel).not.toMatch(/downloadDataUrl/)
    }
  })

  it('the Export button saves one file through image.save and the emote pack through ONE saveMany', () => {
    expect(exportDialog).toMatch(/window\.api\.image\.save\(/)
    expect(exportDialog.match(/window\.api\.image\.saveMany\(/g)).toHaveLength(1)
    // Three files, one dialog: the pack is built as a list, never saved in a loop.
    expect(exportDialog).not.toMatch(/for \(const size of EMOTE_PACK_SIZES\)[^}]*image\.save/)
  })

  it('a success toast only ever comes after a null (canceled) check on the save result', () => {
    for (const [rel, src] of [['ExportDialog', exportDialog], ['ThumbnailVariants', variants]]) {
      const successes = [...src.matchAll(/toast\.success\(/g)].map((m) => m.index ?? 0)
      for (const at of successes) {
        const before = src.slice(Math.max(0, at - 220), at)
        expect(before, `${rel}: toast.success at ${at}`).toMatch(/if \(saved === null\) return\s*(toast\.success\([^\n]*\)\s*return\s*if \(saved === null\) return\s*)?$|if \(saved === null\) return\s*$/)
      }
    }
  })

  it('Save all says what it saves: the three variants plus the original', () => {
    expect(variants).toMatch(/Save all \(\{items\.length - 1\} \+ original\)/)
    expect(variants).not.toMatch(/Saving \$\{items\.length\} variants/)
    expect(variants).toMatch(/Saved \$\{countOf\(saved\.count, 'thumbnail'\)\}/)
  })

  it('the capture hides hint nodes through the same switch as the editor chrome', () => {
    expect(exportDialog).toMatch(/stage\.find\(`\.\$\{HINT_NODE_NAME\}`\)/)
    const canvas = read('modules/image-studio/Canvas.tsx')
    // T-124 (8): the image node shares the shapes' props now (`base`, one object), so there is ONE site that sets the name and
    // the image node takes it by spreading that object: a second, hand-written copy on the image node is the thing that drifted.
    expect(canvas.match(/name: layer\.hint \? HINT_NODE_NAME : undefined/g)).toHaveLength(1)
    expect(canvas).toMatch(/<KonvaImage ref=\{shapeRef\} image=\{img\} width=\{layer\.width\} height=\{layer\.height\} \{\.\.\.base\} \/>/)
  })

  it('the Layers panel tags what will not export, from the shared rule', () => {
    const panel = read('modules/image-studio/LayerPanel.tsx')
    expect(panel).toMatch(/hintTag\(layer\)/)
  })
})

/**
 * Round 62 (T-112): the wiring of the review-gate fixes that no DOM-less test can drive
 * — a mounted component's calls — pinned as "the call is there and its old twin is
 * not". Their behavior is unit-tested where it is pure (videoStore, ProjectIO,
 * ExportPanel's `settleJobs`, clipKit, the shared helpers) and driven end to end in
 * video-pipelines.spec.ts ("T-112: review-gate fixes"). Each pin was shown to fail with
 * the call put back (round 62 lessons).
 */
describe('T-112 — the fixes are wired where the person reaches them', () => {
  const captions = read('modules/video-studio/CaptionsPanel.tsx')
  const videoStudio = read('modules/video-studio/VideoStudio.tsx')
  const exportPanel = read('modules/video-studio/ExportPanel.tsx')
  const importer = read('modules/video-studio/Importer.tsx')
  const home = read('routes/Home.tsx')
  const restore = read('components/AutosaveRestore.tsx')

  it('a finished transcription is attached through the source guard — never with the bare setter', () => {
    expect(captions).toMatch(/setSrtPathFor\(startedFor, result\.srtPath\)/)
    expect(captions).not.toMatch(/\bsetSrtPath\(/)
    // ...and the words and segments of a refused result are not applied either.
    expect(captions.indexOf('setSrtPathFor(')).toBeLessThan(captions.indexOf('setSegments(result.segments)'))
  })

  it('Clean audio asks Audio Studio\'s own question before it extracts, and is off for a video with no sound', () => {
    // T-113: the lead-in is "Replace the audio you're editing?", not Close's.
    expect(videoStudio).toMatch(/if \(!confirmAudioClose\(useAudioStore\.getState\(\)\.chain, \(message\) => confirm\(message\), 'replace'\)\) return/)
    expect(videoStudio.indexOf('confirmAudioClose(')).toBeLessThan(videoStudio.indexOf('window.api.audio.extractFromVideo'))
    expect(videoStudio).toMatch(/disabled=\{extractingAudio \|\| noSound\}/)
    expect(captions).toMatch(/disabled=\{running \|\| noSound\}/)
    expect(read('modules/video-studio/HighlightPanel.tsx')).toMatch(/disabled=\{scanning \|\| noSound\}/)
  })

  it('the Hook label and the window it measures come from the same hookWindow, so a short clip never says 3', () => {
    const clipList = read('modules/video-studio/ClipList.tsx')
    expect(clipList).toMatch(/const hook = selected \? hookWindow\(selected\) : null/)
    expect(clipList).toMatch(/durationSec=\{hook\.sourceSec\}/)
    expect(clipList).toMatch(/outputSec=\{hook\.outputSec\}/)
    expect(clipList).toMatch(/First \{Math\.round\(hook\.outputSec \* 10\) \/ 10\} s:/)
    // The literal that was true only of a clip of three seconds or more.
    expect(clipList).not.toMatch(/>First 3 s:</)
  })

  it('Clip Kit asks main to remove its folder only when it fails or is canceled with no file landed in it', () => {
    const kit = read('modules/video-studio/ClipKitButton.tsx')
    // The one call site: in the catch, guarded by the count of finished files, and never a
    // user-facing error (a rejection is swallowed).
    expect((kit.match(/removeKitDir\(/g) ?? []).length).toBe(1)
    expect(kit).toMatch(/if \(kitDir !== null && landed === 0\) \{\s*void window\.api\.video\.removeKitDir\(kitDir\)\.catch\(\(\) => undefined\)/)
    expect(kit.indexOf('removeKitDir(')).toBeGreaterThan(kit.indexOf('} catch (err) {'))
    expect(kit.indexOf('removeKitDir(')).toBeLessThan(kit.indexOf('reportFailure(err'))
    // Every file the kit writes moves the count: a finished job and a finished thumbnail.
    expect(kit).toMatch(/finished \+= 1\s*landed \+= 1/)
    expect(kit).toMatch(/outputPath: outPath\s*\}\)\s*landed \+= 1/)
    // Main side: a non-recursive rmdir behind the path gate, on the preload's channel.
    const main = readFileSync(path.join(__dirname, '../../src/main/ffmpeg/frame.ts'), 'utf8')
    expect(main).toMatch(/await rmdir\(kitDir\)/)
    expect(main).not.toMatch(/rmdir\(kitDir,/)
    expect(readFileSync(path.join(__dirname, '../../src/preload/index.ts'), 'utf8')).toMatch(
      /removeKitDir: \(kitDir\) => ipcRenderer\.invoke\('video:removeKitDir', kitDir\)/
    )
  })

  it('Open project says its outcome as a project and the autosave Restore says it as an autosave (T-114)', () => {
    const home = read('routes/Home.tsx')
    const restore = read('components/AutosaveRestore.tsx')
    expect(home).toMatch(/describeApplyOutcome\(outcome, 'project'\)/)
    expect(restore).toMatch(/describeApplyOutcome\(outcome, 'autosave'\)/)
    // Nobody else toasts an apply outcome: a third caller has to choose its wording on purpose.
    const callers = ['routes/Home.tsx', 'components/AutosaveRestore.tsx']
    for (const rel of reachableFrom('/home')) {
      if (callers.includes(rel) || rel.endsWith('ProjectIO.ts')) continue
      expect(read(rel), rel).not.toMatch(/describeApplyOutcome\(/)
    }
  })

  it('Clip Kit names its SRT and thumbnails through kitSrtFilename / kitThumbFilename, never by the bare clip name (T-114)', () => {
    const kit = read('modules/video-studio/ClipKitButton.tsx')
    expect(kit).toMatch(/path\.join\(kitDir, kitSrtFilename\(safeName\)\)/)
    expect(kit).toMatch(/path\.join\(kitDir, kitThumbFilename\(safeName, i\)\)/)
    // The shapes that were: `<name>.srt` (a clip called Aux is a Windows device) and an inline thumb name.
    expect(kit).not.toMatch(/\$\{safeName\}\.srt/)
    expect(kit).not.toMatch(/\$\{safeName\}_thumb_/)
  })

  it('Export opens the chooser instead of toasting when there is no folder, and settles its rows through settleJobs', () => {
    expect(exportPanel).not.toMatch(/Choose an output folder first/)
    expect(exportPanel).toMatch(/dir = await window\.api\.video\.pickOutputDir\(\)/)
    expect(exportPanel).toMatch(/setJobs\(\(prev\) => settleJobs\(prev, \{ cancelled, message \}\)\)/)
    // The old blanket: every unfinished row painted with the one verdict.
    expect(exportPanel).not.toMatch(/j\.percent < 100 \? \{ \.\.\.j, error: message, canceled: cancelled \}/)
  })

  // T-126 (6): the four side panels' hook and Clip Kit start their chooser on the folder they show; Export's button passed nothing, so the
  // chooser opened wherever the OS last was, beside a chip that named another folder. (The no-folder-yet press in `startExport` has nothing to start on.)
  it('Export\'s folder button opens the chooser on the folder it shows, as the side panels\' hook and Clip Kit do (T-126 (6))', () => {
    const code = exportPanel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const pick = code.slice(code.indexOf('async function pickOutDir'), code.indexOf('async function', code.indexOf('async function pickOutDir') + 10))
    expect(pick).toMatch(/const picked = await window\.api\.video\.pickOutputDir\(outDir \?\? undefined\)\s*if \(picked\) setOutDir\(picked\)/)
    expect(pick).not.toMatch(/pickOutputDir\(\)/)
    // The hook the four panels use hands its own folder to the same chooser.
    expect(read('hooks/useVideoOutputDir.ts')).toMatch(/window\.api\.video\.pickOutputDir\(useOutputDirStore\.getState\(\)\.dir \?\? undefined\)/)
  })

  it('the importer refuses a second import while one runs, from the drop and from the picker alike', () => {
    expect(importer).toMatch(/busyRef\.current = true/)
    expect(importer.match(/refuseIfBusy\(\)/g)?.length).toBeGreaterThanOrEqual(3) // definition + drop + handleFile
    expect(importer).toMatch(/Still converting the last video\. Wait for it to finish\./)
  })

  // T-113 (15): a clip with no hook to rate shows no row (behavior of the window: highlights.test.ts).
  // T-114: the previous score stays up while the next is worked out, a different clip starts fresh,
  // and a video with no sound has no row at all.
  // T-115: the effect runs on the EXACT start and window and the ask waits for them to be still - a
  // trailing debounce, `HOOK_DEBOUNCE_MS` - instead of keying on whole seconds (which left the badge
  // up to half a second off after a drag). E2E: video-pipelines "the hook badge asks once the speed
  // stops moving" and "dragging the start handle asks once, after it settles, with the exact start".
  it('the Hook badge asks for the exact numbers after a trailing debounce, and cancels the pending ask on every change', () => {
    const indicator = read('modules/video-studio/HookIndicator.tsx')
    const code = indicator.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // The deps are the exact numbers - the whole point of the change.
    expect(code).toMatch(/\}, \[sourcePath, startSec, durationSec\]\)/)
    // What is asked comes from the one gate, and is sent as it is.
    expect(code).toMatch(/const ask = hookAsk\(startSec, durationSec\)/)
    expect(code).toMatch(/analyzeClipHook\(\{ sourcePath, \.\.\.ask \}\)/)
    // The ask is behind the timer, and the cleanup kills both the timer and the late answer.
    expect(code).toMatch(/const timer = setTimeout\(\(\) => \{[\s\S]*?\}, wait\)/)
    // ...and the wait is the debounce for a CHANGE, nothing for a badge's first ask (selecting a clip
    // must not take a quarter second longer to show its badge than it did before the debounce, and the
    // spawn-order E2Es read the log assuming the first ask is prompt).
    expect(code).toMatch(/const wait = asked\.current \? HOOK_DEBOUNCE_MS : 0\s*\n\s*asked\.current = true/)
    expect(code).toMatch(/cancelled = true\s*\n\s*clearTimeout\(timer\)/)
    // None of the whole-second machinery is left.
    expect(code).not.toMatch(/hookWindowKey|windowKey|exactStart|exactDuration|Math\.round\(startSec/)
    // The old score is NOT cleared when the next analysis starts (that was the flash and the spinner).
    expect(code).not.toMatch(/\bsetScore\(null\)\s*\n\s*setLoading\(true\)/)
    // The row is behind the window and the sound: a clip too short for a hook (null) asks for nothing,
    // and neither does a video with no sound.
    const clipList = read('modules/video-studio/ClipList.tsx')
    expect(clipList).toMatch(/\{source && hook && !videoHasNoSound\(source\) \?/)
    // One badge per clip: selecting another clip starts fresh instead of showing the last clip's tier.
    expect(clipList).toMatch(/<HookIndicator\s+key=\{`\$\{source\.filePath\}\|\$\{selected\.id\}`\}/)
  })

  // T-113 (11e): the hold covers the apply and nothing else; both ways of opening a project
  // go through the one wrapper, and neither keeps a timer of its own.
  it('Open project and Restore hold autosave through applyProjectHeld, and release it with the apply', () => {
    for (const [rel, src] of [['routes/Home.tsx', home], ['components/AutosaveRestore.tsx', restore]] as const) {
      expect(src, rel).toMatch(/await applyProjectHeld\(/)
      expect(src, rel).not.toMatch(/suppressAutosave/)
      expect(src, rel).not.toMatch(/setTimeout\(release/)
      expect(src, rel).not.toMatch(/\bapplyProject\(/)
    }
  })

  it('both ways of opening a project report through describeApplyOutcome — not the missing-file sentence alone', () => {
    for (const [rel, src] of [['routes/Home.tsx', home], ['components/AutosaveRestore.tsx', restore]] as const) {
      expect(src, rel).toMatch(/describeApplyOutcome\(outcome, '(project|autosave)'\)/)
      expect(src, rel).not.toMatch(/describeUnavailableSources/)
    }
  })

  it('the saved toasts name the file the runner chose', () => {
    for (const rel of ['GifPanel', 'CompilationPanel', 'PipPanel']) {
      const src = read(`modules/video-studio/${rel}.tsx`)
      expect(src, rel).toMatch(/toastSaved\(`Saved \$\{basename\(result\.outputPath\)\}`, result\.outputPath\)/)
    }
    // T-123 (18): Reframe's names the file the same way and carries one more action, Record's own ("Edit in Video Studio").
    expect(read('modules/video-studio/ReframePanel.tsx')).toMatch(
      /toastSaved\(`Saved \$\{basename\(result\.outputPath\)\}`, result\.outputPath, \{\s*label: 'Edit in Video Studio',\s*onClick: \(\) => \{\s*void editInVideoStudio\(result\.outputPath\)/
    )
  })

  it('Reframe\'s three positions are a pressed-state group, and the safe-zone overlay is hidden from assistive tech', () => {
    expect(read('modules/video-studio/ReframePanel.tsx')).toMatch(/aria-pressed=\{position === p\.id\}/)
    expect(read('modules/video-studio/SafeZoneOverlay.tsx')).toMatch(/aria-hidden="true"/)
  })
})

// T-115: two failure toasts were left on the library's 4 s default beside the 8 s every other
// failure gets (`reportFailure`, `ERROR_TOAST_MS`): Record's "the take is gone" message after a
// failed save and the Autosave banner's "couldn't clear it" (T-117: both are a `reportFailure` now, which names the
// duration once, for every caller: lib/reportFailure.test.ts). The remaining row is the one that is not. They are
// the messages a person must not miss, so each names the duration. A table, not a blanket rule:
// the one-word form toasts ("Name your preset first") are fine at the default.
describe('T-115 — the failure toasts nobody may miss last ERROR_TOAST_MS', () => {
  /** Every `toast.error(...)` call in a source text: the call's argument text, and whether it names the duration. */
  function toastErrorCalls(text: string): Array<{ args: string; lasts: boolean }> {
    const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const out: Array<{ args: string; lasts: boolean }> = []
    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.expression.getText(sf) === 'toast' &&
        n.expression.name.text === 'error'
      ) {
        const options = n.arguments[1]
        const lasts =
          options !== undefined &&
          ts.isObjectLiteralExpression(options) &&
          options.properties.some(
            (p) =>
              ts.isPropertyAssignment(p) &&
              p.name.getText(sf) === 'duration' &&
              p.initializer.getText(sf) === 'ERROR_TOAST_MS'
          )
        out.push({ args: n.arguments[0]?.getText(sf) ?? '', lasts })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return out
  }

  const MUST_LAST: ReadonlyArray<readonly [string, string, string]> = [
    ['modules/record-studio/RecordStudio.tsx', 'Recording screen only', 'the webcam or mic did not open']
  ]

  it.each(MUST_LAST)('%s: the toast for %s names ERROR_TOAST_MS (%s)', (rel, marker) => {
    const calls = toastErrorCalls(read(rel)).filter((c) => c.args.includes(marker))
    expect(calls, `${rel} has exactly one toast.error about ${marker}`).toHaveLength(1)
    expect(calls[0]?.lasts, `${rel}: ${marker}`).toBe(true)
  })

  it('the finder discriminates: a bare call, a different duration and the named one', () => {
    expect(toastErrorCalls("toast.error('x')")).toEqual([{ args: "'x'", lasts: false }])
    expect(toastErrorCalls("toast.error('x', { duration: 8000 })")[0]?.lasts).toBe(false)
    expect(toastErrorCalls("toast.error('x', { duration: ERROR_TOAST_MS })")[0]?.lasts).toBe(true)
    expect(toastErrorCalls("toast('x')")).toEqual([])
  })
})

// T-119 (round 69): wiring for the review gate's eighth pass. Behavior of each fix is pinned where it
// lives (recordingStream.test.ts, the E2E specs named per test); what no DOM-less test can see is that the
// control a person reaches is the one that carries the fix, and these read the source to say so.
describe('T-119 — the round-69 fixes are wired where the person reaches them', () => {
  /** The declaration `name` in a TSX source, or undefined. */
  function declaration(text: string, name: string): { sf: ts.SourceFile; fn: ts.FunctionDeclaration } | undefined {
    const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let found: ts.FunctionDeclaration | undefined
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n
      if (!found) ts.forEachChild(n, visit)
    }
    visit(sf)
    return found ? { sf, fn: found } : undefined
  }

  /**
   * Does the function set `<ref>.current = true` before its first `await` (so a second call in the same
   * tick sees it), and set it back to false in the `finally` of a `try`? Both halves matter: a claim after
   * the first await leaves the window open, and a release outside a `finally` leaves a refused start
   * stuck on "Starting…".
   */
  function singleFlight(text: string, name: string, ref: string): { claimedFirst: boolean; releasedInFinally: boolean } {
    const d = declaration(text, name)
    if (!d) return { claimedFirst: false, releasedInFinally: false }
    const { sf, fn } = d
    let firstAwait = Number.POSITIVE_INFINITY
    let claim = Number.POSITIVE_INFINITY
    let releasedInFinally = false
    const isAssign = (n: ts.Node, value: string): boolean =>
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      n.left.getText(sf) === `${ref}.current` &&
      n.right.getText(sf) === value
    const visit = (n: ts.Node): void => {
      if (ts.isAwaitExpression(n)) firstAwait = Math.min(firstAwait, n.getStart(sf))
      if (isAssign(n, 'true')) claim = Math.min(claim, n.getStart(sf))
      if (ts.isTryStatement(n) && n.finallyBlock) {
        const inFinally = (m: ts.Node): void => {
          if (isAssign(m, 'false')) releasedInFinally = true
          ts.forEachChild(m, inFinally)
        }
        inFinally(n.finallyBlock)
      }
      ts.forEachChild(n, visit)
    }
    visit(fn)
    return { claimedFirst: claim < firstAwait, releasedInFinally }
  }

  it('Start recording claims startingRef before its first await, releases it in a finally, and its button shows Starting… (2)', () => {
    const studio = read('modules/record-studio/RecordStudio.tsx')
    expect(singleFlight(studio, 'startRecording', 'startingRef')).toEqual({ claimedFirst: true, releasedInFinally: true })
    // The re-entry gate is the function's first statement, ahead of even the source check.
    expect(studio).toMatch(/async function startRecording\(\): Promise<void> \{\s*\n\s*if \(startingRef\.current\) return/)
    // The button: off while it opens, and saying so. E2E: record.spec.ts "Start while the capture is still opening".
    expect(studio).toMatch(/disabled=\{!selectedSourceId \|\| starting\}/)
    expect(studio).toMatch(/\{starting \? 'Starting…' : 'Start recording'\}/)
  })

  it('Edit in Video Studio asks through videoDiscardMessage before it loads, and Close asks through the same list (3)', () => {
    // T-123 (18): the bridge is one hook, `lib/editInVideoStudio`, that Record's saved take and Reframe's saved file both
    // call (it was a function inside RecordStudio). The ask is read there, and each caller must be on it.
    const lib = read('lib/editInVideoStudio.ts')
    const code = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const handler = code.slice(code.indexOf('return async function editInVideoStudio'))
    // The count is read when the button is pressed, from the store, not from a render's closure.
    expect(handler).toMatch(/videoDiscardMessage\(useVideoStore\.getState\(\)\.clips\.length, 'replace'\)/)
    // ...and the question comes before the load, and a "no" leaves before any of it.
    expect(handler).toMatch(/if \(message !== null && !confirm\(message\)\) return/)
    expect(handler.indexOf('confirm(message)')).toBeGreaterThan(0)
    expect(handler.indexOf('confirm(message)')).toBeLessThan(handler.indexOf('loadVideoSource(outputPath)'))
    // Both callers use it, each with its own sentence for a file that will not open, and neither carries a copy.
    for (const [rel, sentence] of [
      ['modules/record-studio/RecordStudio.tsx', "Couldn't open the recording in Video Studio."],
      ['modules/video-studio/ReframePanel.tsx', "Couldn't open the reframed video in Video Studio."]
    ] as const) {
      const caller = read(rel)
      expect(caller, rel).toContain(`useEditInVideoStudio("${sentence}")`)
      expect(caller, rel).not.toMatch(/loadSource\(|loadVideoSource|videoDiscardMessage/)
    }
    expect(read('modules/video-studio/VideoStudio.tsx')).toMatch(/videoDiscardMessage\(clipCount\)/)
  })

  it('the Playhead slider hears I / O and , / . through the store calls the Player makes, and the trim handles are pointer-only (5)', () => {
    const timeline = read('modules/video-studio/Timeline.tsx')
    const code = timeline.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const handler = code.slice(code.indexOf('function onScrubKey'), code.indexOf('if (!source || !clip'))
    // The Player's stand-down for the control that owns the key. The slider has no children today, so no E2E can put a
    // key in a field under it; this is the line a future child (a rename box in the track, say) would rely on.
    // T-123 (2): it was `if (tag === 'INPUT' || tag === 'TEXTAREA') return` - any INPUT, so a ticked checkbox killed
    // the keys - and is now the ONE question `lib/keyOwnership` answers, the same call, with the same arguments, that
    // the Player's own handler makes (the next two lines pin that the two cannot drift apart), and that module's
    // `focusOwnsKey` is text fields first (`keyOwnership.test.ts` drives every tag and type through it).
    const ASKS_THE_SAME_QUESTION = /if \(focusOwnsKey\(\(e\.target as HTMLElement\)\.tagName, inputTypeOf\(e\.target\), e\.key\)\) return/
    expect(handler).toMatch(ASKS_THE_SAME_QUESTION)
    expect(read('modules/video-studio/Player.tsx')).toMatch(/if \(focusOwnsKey\(tag, inputTypeOf\(e\.target\), e\.key\)\) return/)
    expect(read('lib/keyOwnership.ts')).toMatch(
      /return \(\s*isTextEntryTarget\(tagName, inputType\) \|\|\s*tagName\.toUpperCase\(\) === 'SELECT' \|\|\s*controlOwnsKey\(tagName, inputType, key\)\s*\)/
    )
    expect(handler).toMatch(/case 'i':\s*case 'I':\s*e\.preventDefault\(\)\s*setMarker\('in'\)/)
    expect(handler).toMatch(/case 'o':\s*case 'O':\s*e\.preventDefault\(\)\s*setMarker\('out'\)/)
    // T-121: from the frame on screen (`now`, `playheadNow`), where this pin used to read the store's `currentTime`
    // (the bug: it trails playback). The T-121 pin below holds all four relative keys.
    expect(handler).toMatch(/case ',':\s*next = now - 1 \/ fps/)
    expect(handler).toMatch(/case '\.':\s*next = now \+ 1 \/ fps/)
    // The same two store actions and the same end of the gesture as Player.setMarker. (T-120: at the element's
    // time when a Player is mounted, `playheadNow`; the T-120 pin below holds that half.)
    expect(code).toMatch(/state\.setClipStart\(id, at\)/)
    expect(code).toMatch(/state\.setClipEnd\(id, at\)/)
    expect(code).toMatch(/state\.endGesture\(\)/)
    // Both handles: out of the tab order, out of the accessibility tree, and no name left to announce.
    const handles = code.match(/<button\b[\s\S]*?\/>/g) ?? []
    expect(handles).toHaveLength(2)
    for (const h of handles) {
      expect(h).toMatch(/tabIndex=\{-1\}/)
      expect(h).toMatch(/aria-hidden="true"/)
      expect(h).not.toMatch(/aria-label/)
    }
  })

  it('the audio importer refuses a second import from the drop, the picker and Recent, and releases the flag in a finally (6)', () => {
    const importer = read('modules/audio-studio/AudioImporter.tsx')
    expect(singleFlight(importer, 'loadFile', 'busyRef')).toEqual({ claimedFirst: true, releasedInFinally: true })
    expect(importer).toMatch(/async function loadFile\(filePath: string\): Promise<void> \{\s*\n\s*if \(refuseIfBusy\(\)\) return/)
    expect(importer).toMatch(/if \(file && refuseIfBusy\(\)\) return\s*\n\s*const diag = examineDroppedFile\(file\)/)
    expect(importer).toMatch(/if \(refuseIfBusy\(\)\) return\s*\n\s*if \(pathLooksLikeCloudSync\(filePath\)\)/)
    expect(importer).toMatch(/Still extracting audio from the last file\. Wait for it to finish\./)
    expect(importer).toMatch(/Still loading the last file\. Wait for it to finish\./)
  })

  it('Export claims startingRef before its first await, in both entries (the button and the safe-zone question\'s "Export anyway"), and gives it back in a finally (T-125 (18))', () => {
    const panel = read('modules/video-studio/ExportPanel.tsx')
    expect(singleFlight(panel, 'startExport', 'startingRef')).toEqual({ claimedFirst: true, releasedInFinally: true })
    expect(singleFlight(panel, 'continueExport', 'startingRef')).toEqual({ claimedFirst: true, releasedInFinally: true })
    // The re-entry gate is each function's first statement, and the ref is a hook declared ahead of the early `return null`.
    expect(panel).toMatch(/async function startExport\(\): Promise<void> \{\s*\n\s*if \(startingRef\.current\) return/)
    expect(panel).toMatch(/async function continueExport\(dir: string\): Promise<void> \{\s*\n\s*if \(startingRef\.current\) return/)
    const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code.indexOf('const startingRef = useRef(false)')).toBeGreaterThan(-1)
    expect(code.indexOf('const startingRef = useRef(false)')).toBeLessThan(code.indexOf('if (!source) return null'))
    // The modal's continue goes through the guarded entry, not straight to the queue.
    expect(panel).toMatch(/if \(outDir\) void continueExport\(outDir\)/)
    expect(panel).not.toMatch(/void runExportQueue\(outDir\)/)
  })

  // T-126 (19): `ExportPanel.startExport` was the only start handler with the claim-first shape. The other seven claimed "busy" AFTER
  // their first await (the folder chooser, the save dialog, a settings read), so a double-click ran two of them - executed in the built
  // app: two choosers, two output files on Compile, GIF, Reframe and Audio Export. With the four above this is eleven (and fourteen with
  // the three saves of T-127 (11) below); the guide (STYLE_GUIDE) keeps no count and points here. E2E: video-pipelines.spec.ts / audio.spec.ts, "a double-click ... one chooser, one file".
  it('the other seven start handlers claim their ref before the first await, first of all, and give it back in a finally (T-126 (19))', () => {
    const handlers = [
      ['modules/audio-studio/ExportDialog.tsx', 'startExport', 'startingRef'],
      ['modules/video-studio/CompilationPanel.tsx', 'exportCompilation', 'startingRef'],
      ['modules/video-studio/GifPanel.tsx', 'exportGif', 'startingRef'],
      ['modules/video-studio/PipPanel.tsx', 'run', 'startingRef'],
      ['modules/video-studio/ReframePanel.tsx', 'reframe', 'startingRef'],
      ['modules/video-studio/ClipKitButton.tsx', 'runKit', 'startingRef'],
      ['modules/video-studio/CaptionsPanel.tsx', 'burnIn', 'burnStartingRef']
    ] as const
    for (const [rel, fn, ref] of handlers) {
      const text = read(rel)
      expect(singleFlight(text, fn, ref), `${rel}: ${fn}`).toEqual({ claimedFirst: true, releasedInFinally: true })
      // The re-entry gate is the function's FIRST statement (a dropped press is silent: the first one's chooser is on screen), and the
      // claim follows it with nothing between.
      expect(text, `${rel}: ${fn} opens with the gate and the claim`).toMatch(
        new RegExp(`async function ${fn}\\(\\): Promise<void> \\{\\s*\\n\\s*if \\(${ref}\\.current\\) return\\s*\\n\\s*${ref}\\.current = true\\s*\\n\\s*try \\{`)
      )
      // The ref is a hook declared ahead of any early `return null` (hooks run in the same order on every render).
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const declared = code.indexOf(`const ${ref} = useRef(false)`)
      expect(declared, `${rel}: ${ref} is declared`).toBeGreaterThan(-1)
      const early = code.indexOf('if (!source) return null')
      if (early !== -1) expect(declared, `${rel}: ${ref} is declared before the early return`).toBeLessThan(early)
    }
  })

  // T-127 (11): three more handlers that went straight to a native dialog with no claim (executed: a double-click on "Save all" = two
  // choosers and eight files). With the eleven above, fourteen. E2E: image.spec.ts (Save all, and a variant's Save) and
  // video-pipelines.spec.ts (Save .srt) put a 300 ms dialog in the window the second press lands in.
  it('the three save handlers (a variant\'s Save, Save all, Save .srt) claim their ref before the first await, first of all, and give it back in a finally (T-127 (11))', () => {
    const handlers = [
      ['modules/image-studio/ThumbnailVariants.tsx', 'saveOne', 'startingRef', 'p: VariantPreview'],
      ['modules/image-studio/ThumbnailVariants.tsx', 'saveAll', 'startingRef', ''],
      ['modules/video-studio/CaptionsPanel.tsx', 'saveSrt', 'saveSrtStartingRef', '']
    ] as const
    for (const [rel, fn, ref, params] of handlers) {
      const text = read(rel)
      expect(singleFlight(text, fn, ref), `${rel}: ${fn}`).toEqual({ claimedFirst: true, releasedInFinally: true })
      expect(text, `${rel}: ${fn} opens with the gate and the claim`).toMatch(
        new RegExp(`async function ${fn}\\(${params.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\): Promise<void> \\{\\s*\\n\\s*if \\(${ref}\\.current\\) return\\s*\\n\\s*${ref}\\.current = true\\s*\\n\\s*try \\{`)
      )
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const declared = code.indexOf(`const ${ref} = useRef(false)`)
      expect(declared, `${rel}: ${ref} is declared`).toBeGreaterThan(-1)
      // Hooks run in the same order on every render: declared ahead of every early `return null`.
      const early = [code.indexOf('if (!source) return null'), code.indexOf('if (!open) return null')].filter((i) => i !== -1)
      for (const at of early) expect(declared, `${rel}: ${ref} is declared before the early return`).toBeLessThan(at)
    }
  })

  it('Clean audio keeps what Audio Studio held and compares it when the extraction ends: a changed source loads nothing and navigates nowhere (T-125 (20))', () => {
    const studio = read('modules/video-studio/VideoStudio.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const flow = studio.slice(studio.indexOf('async function cleanAudioFlow'), studio.indexOf('return (\n    <div className="h-full'))
    expect(flow).toMatch(/const heldBefore = useAudioStore\.getState\(\)\.source/)
    const held = flow.indexOf('const heldBefore')
    const extract = flow.indexOf('await window.api.audio.extractFromVideo')
    const compare = flow.indexOf('replacedSince(heldBefore, useAudioStore.getState().source)')
    const load = flow.indexOf('await loadAudioSource(')
    const go = flow.indexOf("navigate('/audio')")
    expect(held, 'held before the wait').toBeGreaterThan(-1)
    expect(held).toBeLessThan(extract)
    expect(compare, 'compared after it').toBeGreaterThan(extract)
    expect(compare, 'before anything is loaded').toBeLessThan(load)
    expect(load).toBeLessThan(go)
    expect(flow).toMatch(/replacedSince\(heldBefore, useAudioStore\.getState\(\)\.source\)\) \{[\s\S]*?return\s*\}/)
    expect(flow).toContain("Skipped this video's sound because you opened another file in Audio Studio while it was extracting")
    // the same rule opening a project uses, not a second copy of it
    expect(read('modules/project/ProjectIO.ts')).toMatch(/export function replacedSince</)
    expect(studio).toMatch(/import \{ replacedSince \} from '\.\.\/project\/ProjectIO'/)
  })

  it('DraftField keeps what is typed while the box has focus, even after a live commit, and gives the box back to the store only on leaving (T-125 (8))', () => {
    const field = read('components/DraftField.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const onChange = field.slice(field.indexOf('onChange={(e) => {'), field.indexOf('onBlur={finish}'))
    expect(onChange, 'the draft is set to what was typed on EVERY keystroke').toMatch(/setDraft\(typed\)\s*if \(live\?\.\(typed\)\)/)
    expect(onChange, 'a usable keystroke no longer hands the box back to the stored text').not.toMatch(/setDraft\(null\)/)
    expect(onChange).toMatch(/commit\(typed\)\s*liveCommitted\.current = typed/)
    // ...and leaving does not commit a number the store already has a second time, but does give the box back.
    const finish = field.slice(field.indexOf('function finish()'), field.indexOf('const box ='))
    expect(finish).toMatch(/if \(liveCommitted\.current === draft\) \{[\s\S]*?setDraft\(null\)[\s\S]*?return\s*\}/)
    expect(finish).toMatch(/const refused = commit\(draft\)/)
  })

  it('the single-flight finder discriminates: a late claim, no finally, the right shape', () => {
    const good = 'async function f() { if (r.current) return; r.current = true; try { await x() } finally { r.current = false } }'
    const late = 'async function f() { await y(); r.current = true; try { await x() } finally { r.current = false } }'
    const noFinally = 'async function f() { r.current = true; try { await x() } catch { r.current = false } }'
    const unclaimed = 'async function f() { try { await x() } finally { r.current = false } }'
    expect(singleFlight(good, 'f', 'r')).toEqual({ claimedFirst: true, releasedInFinally: true })
    expect(singleFlight(late, 'f', 'r').claimedFirst).toBe(false)
    expect(singleFlight(noFinally, 'f', 'r').releasedInFinally).toBe(false)
    expect(singleFlight(unclaimed, 'f', 'r').claimedFirst).toBe(false)
    expect(singleFlight(good, 'g', 'r')).toEqual({ claimedFirst: false, releasedInFinally: false })
  })
})

describe('T-120 — the round-70 fixes are wired where the person reaches them', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const MAIN_INDEX = path.resolve(RENDERER_ROOT, '../../main/index.ts')

  /** The body of `function name` (a declaration) in a TSX/TS source, or undefined. */
  function declaration(text: string, name: string): { sf: ts.SourceFile; fn: ts.FunctionDeclaration } | undefined {
    const sf = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let found: ts.FunctionDeclaration | undefined
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n
      if (!found) ts.forEachChild(n, visit)
    }
    visit(sf)
    return found ? { sf, fn: found } : undefined
  }

  /**
   * Every `await` in the function's OWN body (a nested function's awaits are its own business), and whether one of
   * the next two statements of its block is `if (<guard>(...)) return`. Two, because a ref assignment sits between
   * an await and its check (`screenStreamRef.current = screenStream`).
   */
  function awaitsChecked(text: string, name: string, guard: string): Array<{ await: string; checked: boolean }> {
    const d = declaration(text, name)
    if (!d) return []
    const { sf, fn } = d
    const out: Array<{ await: string; checked: boolean }> = []
    const returns = (s: ts.Statement): boolean =>
      ts.isReturnStatement(s) || (ts.isBlock(s) && s.statements.some((x) => ts.isReturnStatement(x)))
    const isGuard = (s: ts.Statement | undefined): boolean =>
      s !== undefined &&
      ts.isIfStatement(s) &&
      ts.isCallExpression(s.expression) &&
      s.expression.expression.getText(sf) === guard &&
      returns(s.thenStatement)
    const visit = (n: ts.Node): void => {
      if (n !== fn && (ts.isFunctionLike(n) || ts.isClassLike(n))) return
      if (ts.isAwaitExpression(n)) {
        let stmt: ts.Node = n
        while (stmt.parent && !(ts.isBlock(stmt.parent) || ts.isSourceFile(stmt.parent))) stmt = stmt.parent
        const siblings = ts.isBlock(stmt.parent) ? stmt.parent.statements : []
        const at = siblings.indexOf(stmt as ts.Statement)
        out.push({
          await: n.getText(sf).slice(0, 60),
          checked: at >= 0 && (isGuard(siblings[at + 1]) || isGuard(siblings[at + 2]))
        })
      }
      ts.forEachChild(n, visit)
    }
    visit(fn)
    return out
  }

  it('Record attaches both live previews in an effect on the phase, from the stream refs, and lets go on the way out (3)', () => {
    const studio = strip(read('modules/record-studio/RecordStudio.tsx'))
    const from = studio.indexOf("if (phase !== 'recording') return\n    const main")
    // The effect ends at its dependency list, and that list is the phase: keyed on nothing it would run once, on
    // mount, when the phase is 'idle' and neither element exists.
    const to = studio.indexOf('}, [phase])', studio.indexOf('const main = previewRef.current'))
    expect(from, 'the attach effect is there').toBeGreaterThan(0)
    expect(to, 'and it is keyed on the phase').toBeGreaterThan(from)
    const effect = studio.slice(from, to)
    expect(effect).toMatch(/const main = previewRef\.current\s*const cam = camPreviewRef\.current/)
    expect(effect).toMatch(/if \(main && streamRef\.current\) \{\s*main\.srcObject = streamRef\.current/)
    // The camera thumbnail shows a camera that is IN the take: the compositor exists exactly then.
    expect(effect).toMatch(/if \(cam && camStreamRef\.current && compositorRef\.current\) \{\s*cam\.srcObject = camStreamRef\.current/)
    expect(effect).toMatch(/return \(\) => \{\s*if \(main\) main\.srcObject = null\s*if \(cam\) cam\.srcObject = null/)
    // ...and nothing assigns srcObject while the phase is still 'idle': startRecording ran before the elements existed.
    const start = studio.slice(studio.indexOf('async function startRecording'), studio.indexOf('function stopRecording'))
    expect(start).not.toMatch(/srcObject/)
    expect(start).not.toMatch(/previewRef|camPreviewRef/)
  })

  it('the recorder is asked for 8 Mbps, merged with the mime option, and the Output hint says what that costs in disk (6)', () => {
    const raw = read('modules/record-studio/RecordStudio.tsx')
    const studio = strip(raw)
    expect(studio).toMatch(/const RECORDING_VIDEO_BITS_PER_SECOND = 8_000_000/)
    expect(studio).toMatch(
      /new MediaRecorder\(combined, \{\s*\.\.\.\(mime \? \{ mimeType: mime \} : \{\}\),\s*videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND\s*\}\)/
    )
    // The old call: `mime ? { mimeType: mime } : undefined` - no bitrate, Chromium's own ~2.5 Mbps.
    expect(studio).not.toMatch(/new MediaRecorder\(combined, mime \?/)
    // 8 Mbps is 1 MB a second: 3.6 GB an hour, in the temp take and again in the saved copy.
    expect(raw.replace(/\s+/g, ' ')).toMatch(/A take can use about 3\.6 GB of disk per hour, and saving needs room for a second copy of it\./)
  })

  it('every await in startRecording is followed by the unmount check, and the flag is set by the unmount cleanup and cleared on mount (9)', () => {
    const studio = strip(read('modules/record-studio/RecordStudio.tsx'))
    const awaits = awaitsChecked(studio, 'startRecording', 'leftWhileStarting')
    // The screen capture, the microphone, the camera, the compositor and the main-process session.
    expect(awaits.map((a) => a.await)).toHaveLength(5)
    expect(awaits.filter((a) => !a.checked), 'an await with no unmount check after it').toEqual([])
    // The check releases what it was handed and the session, through the one teardown the failure path also uses.
    expect(studio).toMatch(/function leftWhileStarting\(\.\.\.extra: Array<MediaStream \| null>\): boolean \{\s*if \(!unmountedRef\.current\) return false\s*for \(const stream of extra\) stream\?\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)\s*abandonStart\(\)\s*return true/)
    expect(studio).toMatch(/function abandonStart\(\): void \{\s*stopAllStreams\(\)\s*const sid = sessionIdRef\.current[\s\S]*?window\.api\.recording\.abandon\(sid\)/)
    expect(studio).toMatch(/abandonStart\(\)\s*reportFailure\(err, \{ failed: "Couldn't start recording\." \}\)/)
    // The flag: false at the start of the mount effect (StrictMode runs the cleanup and the effect again in dev),
    // true in its cleanup, ahead of the stop.
    expect(studio).toMatch(/unmountedRef\.current = false\s*void refreshDevices\(\)/)
    expect(studio).toMatch(/return \(\) => \{\s*cancelled = true\s*unmountedRef\.current = true\s*stopAllStreams\(\)/)
  })

  it('the await finder discriminates: a missing check, a check too far away, a nested function and the right shape', () => {
    const good = 'async function f() { const a = await x(); r.current = a; if (gone()) return; const b = await y(); if (gone()) return }'
    const missing = 'async function f() { const a = await x(); if (gone()) return; const b = await y(); use(b) }'
    const far = 'async function f() { const a = await x(); one(); two(); if (gone()) return }'
    const nested = 'async function f() { const a = await x(); if (gone()) return; g(async () => { await z() }) }'
    const notReturning = 'async function f() { const a = await x(); if (gone()) log() }'
    expect(awaitsChecked(good, 'f', 'gone').map((a) => a.checked)).toEqual([true, true])
    expect(awaitsChecked(missing, 'f', 'gone').map((a) => a.checked)).toEqual([true, false])
    expect(awaitsChecked(far, 'f', 'gone').map((a) => a.checked)).toEqual([false])
    expect(awaitsChecked(nested, 'f', 'gone').map((a) => a.checked), "the nested function's await is not this function's").toEqual([true])
    expect(awaitsChecked(notReturning, 'f', 'gone').map((a) => a.checked)).toEqual([false])
    expect(awaitsChecked(good, 'nope', 'gone')).toEqual([])
  })

  it('the window keeps rendering when minimized: webPreferences sets backgroundThrottling false (5)', () => {
    const sf = ts.createSourceFile('index.ts', readFileSync(MAIN_INDEX, 'utf8'), ts.ScriptTarget.Latest, true)
    let webPreferences: ts.ObjectLiteralExpression | undefined
    const visit = (n: ts.Node): void => {
      if (
        ts.isNewExpression(n) &&
        n.expression.getText(sf) === 'BrowserWindow' &&
        n.arguments?.[0] &&
        ts.isObjectLiteralExpression(n.arguments[0])
      ) {
        for (const prop of n.arguments[0].properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText(sf) === 'webPreferences' && ts.isObjectLiteralExpression(prop.initializer)) {
            webPreferences = prop.initializer
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    expect(webPreferences, 'a new BrowserWindow({ webPreferences: {...} }) in main/index.ts').toBeDefined()
    const value = (key: string): string | undefined =>
      webPreferences?.properties.flatMap((p) => (ts.isPropertyAssignment(p) && p.name.getText(sf) === key ? [p.initializer.getText(sf)] : []))[0]
    // The webcam compositor is a requestAnimationFrame loop into canvas.captureStream; Chromium stops rAF in a
    // hidden document unless the window opts out, and a recorder is minimized for the whole of a take.
    expect(value('backgroundThrottling')).toBe('false')
    // The settings it sits beside are untouched.
    expect(value('contextIsolation')).toBe('true')
    expect(value('nodeIntegration')).toBe('false')
  })

  // T-127 (1): the app phoned Google on every launch (the spellcheck dictionary, DNS-over-HTTPS probes). The built-app net-log test
  // (smoke.spec.ts) is the proof where it can run; this is the pin that holds on every machine, because the DoH probe only happens
  // where the resolver is a DoH-capable provider, and a CI runner's is not.
  it('the app does not phone Google: spellcheck is off in webPreferences, and startup, BEFORE the window exists, turns DNS-over-HTTPS off and empties the spellchecker languages (T-127 (1))', () => {
    const text = readFileSync(MAIN_INDEX, 'utf8')
    const sf = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true)
    const flat = (n: ts.Node): string => n.getText(sf).replace(/\s+/g, ' ')
    // The window's own option (the renderer's spellchecker client). Alone it does not stop the browser-side dictionary download.
    let spellcheck: string | undefined
    // The `app.whenReady().then(callback)` callback's top-level statements, in order.
    let startup: ts.Statement[] | undefined
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'spellcheck') spellcheck = flat(n.initializer)
      if (
        ts.isCallExpression(n) &&
        flat(n.expression) === 'app.whenReady().then' &&
        n.arguments[0] &&
        (ts.isArrowFunction(n.arguments[0]) || ts.isFunctionExpression(n.arguments[0])) &&
        ts.isBlock(n.arguments[0].body)
      ) {
        startup = [...n.arguments[0].body.statements]
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    expect(spellcheck, 'webPreferences.spellcheck').toBe('false')
    expect(startup, 'an app.whenReady().then(() => { ... }) callback in main/index.ts').toBeDefined()
    const calls = (startup ?? []).filter(ts.isExpressionStatement).map((s) => flat(s.expression))
    const resolver = calls.indexOf("app.configureHostResolver({ secureDnsMode: 'off' })")
    const languages = calls.indexOf('session.defaultSession.setSpellCheckerLanguages([])')
    const window = calls.indexOf('createWindow()')
    expect(resolver, "app.configureHostResolver({ secureDnsMode: 'off' }) is a top-level statement of the ready callback").toBeGreaterThanOrEqual(0)
    expect(languages, 'session.defaultSession.setSpellCheckerLanguages([]) is a top-level statement of the ready callback').toBeGreaterThanOrEqual(0)
    expect(window, 'createWindow() is a top-level statement of the ready callback').toBeGreaterThanOrEqual(0)
    // The spellcheck service is created with the first renderer and starts its download then: an empty list must already be in place.
    expect(languages, 'the languages are emptied before the window is created').toBeLessThan(window)
    expect(resolver, 'DNS-over-HTTPS is off before the window is created').toBeLessThan(window)
    expect(text).toMatch(/import \{[^}]*\bsession\b[^}]*\} from 'electron'/)
  })

  // T-127 (15): a name the layout cuts with an ellipsis is the person's only way to read the rest of it by hovering; four sites drew one
  // with no `title` (the folder chip, DESIGN_GUIDE, always had it). E2E reads the attribute on the rendered span (audio.spec.ts,
  // video-core.spec.ts); this holds the source so a refactor that rewraps the span cannot drop it unseen.
  it('a file or preset name that truncates carries its whole self as the title: the second track, both studios\' headers and the preset rows (T-127 (15))', () => {
    const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    expect(strip(read('modules/audio-studio/SecondaryTrackPanel.tsx'))).toMatch(
      /<span className="font-medium truncate" title=\{`\$\{ROLE_OPTIONS\.find\(\(o\) => o\.value === secondary\.role\)\?\.label\}: \$\{secondary\.fileName\}`\}>/
    )
    expect(strip(read('modules/video-studio/VideoStudio.tsx'))).toMatch(/<span className="truncate max-w-\[40ch\]" title=\{source\.fileName\}>\{source\.fileName\}<\/span>/)
    expect(strip(read('modules/audio-studio/AudioStudio.tsx'))).toMatch(
      /<span className="ml-3 text-ink-muted truncate max-w-\[40ch\]" title=\{source\.fileName\}>\s*\{source\.fileName\}\s*<\/span>/
    )
    expect(strip(read('modules/audio-studio/PresetPanel.tsx'))).toMatch(/<span className="flex-1 truncate font-medium" title=\{p\.name\}>\{p\.name\}<\/span>/)
  })

  // T-127 (3): a quit in the middle of a job left its half-written output at the FINAL name (Cancel deletes it, T-100; the quit did not):
  // the kills `before-quit` issues only START the cleanup, and the process was gone before it ran. Layer 2 (video-pipelines.spec.ts,
  // audio.spec.ts) measures the folder after a real quit; this is the handler's shape, which no test that quits the app can vary.
  it('before-quit kills every family of child, THEN waits (bounded) for every run to end, holding the quit with preventDefault, before the recording sweep (T-127 (3))', () => {
    const main = strip(readFileSync(MAIN_INDEX, 'utf8'))
    const handler = main.slice(main.indexOf("app.on('before-quit'"))
    expect(handler.length, "an app.on('before-quit') handler in main/index.ts").toBeGreaterThan(100)
    expect(main).toMatch(/import \{ drainRuns, openRunCount \} from '\.\/ffmpeg\/cancelLatch'/)
    // Every cancel that was in the handler is still ahead of the wait: the wait is for what THEY started.
    const wait = handler.indexOf('drainRuns()')
    expect(wait, 'the handler waits with drainRuns()').toBeGreaterThan(0)
    for (const cancel of [
      'cancelAllExportJobs', 'cancelAllAudioJobs', 'cancelAllExtractions', 'cancelAllConcatJobs', 'cancelAllReframeJobs', 'cancelAllGifJobs',
      'cancelAllHighlightJobs', 'cancelAllFrameJobs', 'cancelWhisperModelInstall', 'cancelTranscribe', 'cancelBurnIn', 'cancelAllConverts'
    ]) {
      const at = handler.indexOf(`${cancel}()`)
      expect(at, `${cancel}() is called in the handler`).toBeGreaterThan(0)
      expect(at, `${cancel}() is called before the wait`).toBeLessThan(wait)
    }
    // Held once, released by the drain's end (a timeout is an end), and only then does the re-entrant quit go through.
    expect(handler).toMatch(
      /if \(!quitDrained && openRunCount\(\) > 0\) \{\s*event\.preventDefault\(\)\s*quitDrain \?\?= drainRuns\(\)\.finally\(\(\) => \{\s*quitDrained = true\s*app\.quit\(\)\s*\}\)\s*return\s*\}/
    )
    // And the streaming-recording sweep is still the last thing it does, after the wait.
    expect(handler.indexOf('abandonAllRecordingStreams()'), 'the recording sweep follows the wait').toBeGreaterThan(wait)
  })

  it('the Timeline hears Space through the Player\'s transport, stops the studio scrolling, and reads markers through playheadNow (4, 14)', () => {
    const timeline = strip(read('modules/video-studio/Timeline.tsx'))
    const handler = timeline.slice(timeline.indexOf('function onScrubKey'), timeline.indexOf('if (!source || !clip'))
    expect(handler).toMatch(/case ' ':\s*e\.preventDefault\(\)\s*useVideoStore\.getState\(\)\.transport\?\.togglePlay\(\)\s*return/)
    // Both markers go through the one rule, and it is the store's exported function, not a local read.
    expect(timeline).toMatch(/const at = playheadNow\(state\)\s*if \(which === 'in'\) state\.setClipStart\(id, at\)\s*else state\.setClipEnd\(id, at\)/)
    expect(timeline).not.toMatch(/state\.currentTime\)/)
    expect(timeline).toMatch(/import \{[^}]*playheadNow[^}]*\} from '\.\/store\/videoStore'/)
    // The Player lends them, for as long as it is mounted, and its own toggle is the function it lends.
    const player = strip(read('modules/video-studio/Player.tsx'))
    expect(player).toMatch(
      /registerTransport\(\{ readTime: \(\) => videoRef\.current\?\.currentTime \?\? null, togglePlay \}\)\s*return \(\) => registerTransport\(null\)/
    )
    expect(player).toMatch(/function togglePlay\(\): void \{\s*const v = videoRef\.current/)
    // The overlay's rows say who hears them.
    const overlay = read('components/HotkeyOverlay.tsx')
    for (const keys of ["'Space'", "', / .'", "'I / O'"]) {
      expect(overlay, keys).toMatch(new RegExp(`keys: ${keys}, description: '[^']*\\(player or timeline focused\\)'`))
    }
  })

  it('the Fix wizard ignores a held Enter in both of its bodies, and Variants focuses Save all on the previews\' identity (10)', () => {
    const wizard = strip(read('modules/audio-studio/FixWizard.tsx'))
    expect(wizard).toMatch(/function ignoreHeldEnter\(e: KeyboardEvent<HTMLElement>\): void \{\s*if \(e\.key === 'Enter' && e\.repeat\) e\.preventDefault\(\)\s*\}/)
    expect(wizard.match(/<div onKeyDown=\{ignoreHeldEnter\}>/g) ?? []).toHaveLength(2)
    const variants = strip(read('modules/image-studio/ThumbnailVariants.tsx'))
    expect(variants).toMatch(/useEffect\(\(\) => \{\s*if \(items\.length > 0\) saveAllRef\.current\?\.focus\(\)\s*\}, \[items\]\)/)
    expect(variants).toMatch(/previews\.items : NO_PREVIEWS/)
    expect(variants).not.toMatch(/hasItems/)
  })

  it('Clip Kit opens its folder chooser on the folder it last wrote to, through the one picker (11)', () => {
    const kit = strip(read('modules/video-studio/ClipKitButton.tsx'))
    expect(kit).toMatch(/window\.api\.settings\.get<string>\('clipKit\.lastOutputDir'\)/)
    expect(kit).toMatch(/window\.api\.video\.pickOutputDir\(\s*typeof lastDir === 'string' && lastDir\.length > 0 \? lastDir : undefined\s*\)/)
    expect(kit).toMatch(/window\.api\.settings\.set\('clipKit\.lastOutputDir', parentDir\)/)
    // main: only a usable absolute path becomes the dialog's defaultPath.
    const video = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/video.ts'), 'utf8'))
    // T-125 (10): and only one that is a folder THAT EXISTS now (a deleted one, or an unplugged drive's, is ignored like a malformed one).
    expect(video).toMatch(/\.\.\.\(isSafeAbsolutePath\(defaultPath\) && \(await isExistingFolder\(defaultPath\)\) \? \{ defaultPath \} : \{\}\)/)
  })
})

describe('T-121 — the round-71 fixes are wired where the person reaches them', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('a camera that fails is let go and has no thumbnail: the catch asks whether the studio is gone, stops the stream, and the box follows camInTake (3)', () => {
    const studio = strip(read('modules/record-studio/RecordStudio.tsx'))
    // The catch opens with the same teardown the awaits above it have, then lets the camera go BEFORE the toast.
    expect(studio).toMatch(
      /\} catch \(err\) \{\s*if \(leftWhileStarting\(micStream\)\) return\s*camStream\?\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)\s*camStreamRef\.current = null\s*const \{ message \} = userFacingError\(err, 'Webcam failed\.'\)\s*toast\.error\(`\$\{message\} Recording screen only\.`/
    )
    // "A camera is in the take" is set where the compositor ref is and cleared where the streams are let go...
    expect(studio).toMatch(/compositorRef\.current = compositor\s*if \(leftWhileStarting\(micStream\)\) return\s*setCamInTake\(true\)/)
    expect(studio).toMatch(/compositorRef\.current = null\s*setCamInTake\(false\)/)
    expect(studio).toMatch(/const \[camInTake, setCamInTake\] = useState\(false\)/)
    // ...and the thumbnail is drawn from it, not from the checkbox.
    expect(studio).toMatch(/\{camInTake \? \(\s*<video\s*ref=\{camPreviewRef\}/)
    expect(studio).not.toMatch(/\{showCam \? \(\s*<video\s*ref=\{camPreviewRef\}/)
  })

  it('the Timeline steps and nudges from the frame on screen: all four relative keys read playheadNow, none reads the store time (4)', () => {
    const timeline = strip(read('modules/video-studio/Timeline.tsx'))
    const handler = timeline.slice(timeline.indexOf('function onScrubKey'), timeline.indexOf('if (!source || !clip'))
    expect(handler).toMatch(/const now = playheadNow\(useVideoStore\.getState\(\)\)\s*let next: number/)
    for (const [key, expr] of [
      ['ArrowLeft', 'now - NUDGE_SEC'],
      ['ArrowRight', 'now + NUDGE_SEC'],
      [',', 'now - 1 / fps'],
      ['.', 'now + 1 / fps']
    ] as const) {
      expect(handler, key).toMatch(new RegExp(`case '${key}':\\s*next = ${expr.replace(/[+/]/g, '\\$&')}\\s*break`))
    }
    // The store's time is what the track DRAWS; it is not an input to any key.
    expect(handler).not.toMatch(/\bcurrentTime\b/)
  })

  it('a cut is a "mark" in the overlay row, the refusal, the waveform hint and the tutorial: one name per concept (8)', () => {
    const overlay = read('components/HotkeyOverlay.tsx')
    expect(overlay).toMatch(/keys: 'Click a mark', description: 'Put a cut back'/)
    expect(overlay).not.toMatch(/cut tag/i)
    const refusal = readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/audio.ts'), 'utf8')
    expect(refusal).toMatch(/Click its mark to put it back, then cut that part again\./)
    expect(refusal).not.toMatch(/Click its tag/)
    expect(read('modules/audio-studio/WaveformView.tsx')).toMatch(/Click a mark to put it back\./)
    expect(read('tutorials/audioTutorial.ts')).toMatch(/click a mark to put it back/)
  })
})

describe('T-122 — the round-72 fixes are wired where the person reaches them', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('Clip Kit names the folder from the sanitized name, computed before the folder is made, so a blank name reaches main as "clip" (3)', () => {
    const kit = strip(read('modules/video-studio/ClipKitButton.tsx'))
    // The one sanitized name, then the folder asked for with it: the raw `clip.name` never reaches `video:makeKitDir`.
    expect(kit).toMatch(
      /const safeName = sanitizeFilename\(clip\.name\)\s*setPhase\('Creating folder…'\)\s*kitDir = await window\.api\.video\.makeKitDir\(\{\s*parentDir,\s*clipName: safeName\s*\}\)/
    )
    expect(kit).not.toMatch(/clipName: clip\.name/)
    expect((kit.match(/sanitizeFilename\(/g) ?? []).length).toBe(1)
    // Main keeps its gates: they are trust-boundary validation, and the renderer now satisfies them.
    const video = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/video.ts'), 'utf8'))
    expect(video).toMatch(/assertNonEmptyString\(params\.clipName, 'clipName'\)/)
  })

  it('the Second-track footer "This track dips whenever you talk" is drawn only while Duck is on (4)', () => {
    const panel = strip(read('modules/audio-studio/SecondaryTrackPanel.tsx'))
    expect(panel).toMatch(
      /\{secondary\.duckUnderPrimary \? \(\s*<p className="text-xs text-ink-dim">\s*This track dips whenever you talk/
    )
    // And it appears once: no second, unconditional copy of the sentence.
    expect((panel.match(/This track dips whenever you talk/g) ?? []).length).toBe(1)
  })
})

describe('T-124 — the round-74 fixes are wired where the person reaches them', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const MAIN_INDEX = path.resolve(RENDERER_ROOT, '../../main/index.ts')

  it('a take ends when the screen does: the ended listener is on the raw capture, goes on after the phase is recording, and comes off with the streams (1)', () => {
    const studio = strip(read('modules/record-studio/RecordStudio.tsx'))
    // After the phase is 'recording', so the 'saving' phase an already-ended track sets is the last word.
    expect(studio).toMatch(/setPhase\('recording'\)\s*watchScreenEnd\(screenStream\)/)
    expect(studio).toMatch(
      /function watchScreenEnd\(screenStream: MediaStream\): void \{\s*const tracks = screenStream\.getVideoTracks\(\)\s*tracks\.forEach\(\(t\) => t\.addEventListener\('ended', stopRecording\)\)\s*screenEndOffRef\.current = \(\) => tracks\.forEach\(\(t\) => t\.removeEventListener\('ended', stopRecording\)\)\s*if \(tracks\.some\(\(t\) => t\.readyState === 'ended'\)\) stopRecording\(\)/
    )
    // Let go with the other teardown, ahead of the track stops.
    expect(studio).toMatch(/function stopAllStreams\(\): void \{\s*screenEndOffRef\.current\?\.\(\)\s*screenEndOffRef\.current = null\s*(?:micEndOffRef\.current\?\.\(\)\s*micEndOffRef\.current = null\s*)?streamRef\.current/)
    // Never on what the recorder is handed: with the webcam in the take that is the compositor's canvas capture, which never ends.
    expect(studio).not.toMatch(/(combined|videoTrackSource|streamRef\.current)\.getVideoTracks\(\)[^\n]*addEventListener/)
    expect(studio).not.toMatch(/watchScreenEnd\((combined|videoTrackSource)/)
  })

  it('the crash recovery loads the entry fresh (no hash kept) and abandons the dead page\'s recording sessions; the window geometry write goes through the guarded helper (2, 3, 4)', () => {
    const main = strip(readFileSync(MAIN_INDEX, 'utf8'))
    // The reload branch: sessions first (fire-and-forget, logged), then the same loader createWindow uses.
    expect(main).toMatch(/lastCrashReloadAt = Date\.now\(\)\s*abandonOpenRecordingSessions\(\)\.then\([\s\S]*?\)\s*loadEntry\(win\)\s*\}\)/)
    // `reload()` keeps the URL's hash: it is not called anywhere in main.
    expect(main).not.toMatch(/webContents\.reload\(/)
    // One loader: the dev server under electron-vite dev, the built file otherwise - used by the first load and by the recovery.
    expect(main.match(/process\.env\.ELECTRON_RENDERER_URL/g) ?? []).toHaveLength(2)
    expect(main.match(/\bloadEntry\(/g) ?? []).toHaveLength(3) // the definition and the two callers
    // The geometry write: only through windowBounds.ts, which never throws.
    expect(main).toMatch(/import \{ persistWindowBounds \} from '\.\/windowBounds'/)
    expect(main).toMatch(/persistWindowBounds\(win, \(bounds\) => setSetting\('windowBounds', bounds\)\)/)
    expect(main.match(/setSetting\('windowBounds'/g) ?? []).toHaveLength(1)
    const bounds = strip(readFileSync(path.resolve(path.dirname(MAIN_INDEX), 'windowBounds.ts'), 'utf8'))
    expect(bounds).toMatch(/try \{\s*if \(win\.isDestroyed\(\)\) return[\s\S]*?\} catch \(err\) \{\s*console\.warn\(/)
  })

  it('the autosave banner is not shown over a session that holds work: ONE gate ahead of both banners, asked once per mount, on the autosave gate\'s own definition (5)', () => {
    const banner = strip(read('components/AutosaveRestore.tsx'))
    expect(banner).toMatch(/const \[holdsWork\] = useState\(sessionHoldsWork\)/)
    // The early return is what BOTH banners sit below (the damaged-file notice and the restore offer).
    expect(banner).toMatch(/if \(dismissed \|\| holdsWork \|\| !snapshot \|\| !snapshot\.info\) \{/)
    const gate = banner.indexOf('holdsWork ||')
    expect(gate).toBeGreaterThan(0)
    expect(banner.indexOf('if (!snapshot.ok) {')).toBeGreaterThan(gate)
    expect(banner.indexOf('imagii autosaved your work')).toBeGreaterThan(gate)
    // The definition is the autosave gate's: one function, used by both.
    expect(strip(read('modules/project/ProjectIO.ts'))).toMatch(/export function sessionHoldsWork\(\): boolean \{\s*return hasStudioState\(captureProject\(\)\)/)
    const validation = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../shared/projectValidation.ts'), 'utf8'))
    expect(validation).toMatch(/if \(!hasStudioState\(project\)\) \{\s*return \{ ok: false, reason: 'no studio state to save' \}/)
  })

  it('the 2-hour gate is asked where the length is known, before the work, with the sentence for what the file is (6, 7)', () => {
    // Clean audio: before the replace question and before the extraction, on the probe the open video already carries.
    const studio = strip(read('modules/video-studio/VideoStudio.tsx'))
    const flow = studio.slice(studio.indexOf('async function cleanAudioFlow'), studio.indexOf('return (\n    <div className="h-full overflow-auto'))
    const gate = flow.indexOf("waveformCeilingRefusal(source.probe.duration, 'video')")
    expect(gate, 'the gate reads the open video\'s probe').toBeGreaterThan(0)
    expect(flow).toMatch(/if \(tooLong\) \{\s*reportFailure\(new Error\(tooLong\), \{ failed: "Couldn't extract the audio\." \}\)\s*return\s*\}/)
    expect(flow.indexOf('confirmAudioClose(')).toBeGreaterThan(gate)
    expect(flow.indexOf('window.api.audio.extractFromVideo')).toBeGreaterThan(gate)
    // main: the probe, the refusal, THEN the extraction - for a video, so the Video Studio remedy.
    const audio = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/audio.ts'), 'utf8'))
    const handler = audio.slice(audio.indexOf("ipcMain.handle('audio:extractFromVideo'"), audio.indexOf("ipcMain.handle('audio:export'"))
    // T-125 (4, 7): only "no sound" is the probe's verdict (any other probe failure is an UNKNOWN length and the extraction goes ahead,
    // the WAV's own gate in the store being the backstop), and the sentence is chosen by what the file IS (an AIFF is not a video).
    // T-126 (7): and the file is a VIDEO because its streams carry a picture (the probe's `hasVideo`), the extension only when the probe could not say.
    expect(handler).toMatch(
      /let hasVideo: boolean \| null = null\s*try \{\s*const probe = await probeAudio\(videoPath\)\s*duration = probe\.duration\s*hasVideo = probe\.hasVideo \?\? null\s*\} catch \(err\) \{\s*if \(isNoAudioStreamError\(err\)\) throw err\s*if \(err instanceof NoUsableDurationError\) hasVideo = err\.hasVideo\s*console\.warn\([^)]*\)\s*\}\s*const kind = \(hasVideo \?\? isVideoFilename\(videoPath\)\) \? 'video' : 'audio'\s*const tooLong = duration === null \? null : waveformCeilingRefusal\(duration, kind\)\s*if \(tooLong\) throw new Error\(tooLong\)\s*const result = await extractAudioFromVideo\(videoPath\)/
    )
    // T-126 (8): a length that was unknown is asked of the WAV in main, and a refused WAV is deleted with the refusal.
    expect(handler).toMatch(/if \(duration === null\) \{[\s\S]*?probeAudio\(result\.wavPath\)[\s\S]*?if \(late\) \{\s*await result\.cleanup\(\)\s*throw new Error\(late\)\s*\}\s*\}\s*return \{ wavPath: result\.wavPath, hasVideo \}/)
    // the load: a sound that came out of a video is a video's problem, a file that was only ever sound is not.
    const store = strip(read('modules/audio-studio/state/audioStore.ts'))
    expect(store).toMatch(/waveformCeilingRefusal\(probe\.duration, fromVideoPath \? 'video' : 'audio'\)/)
  })

  it('Reframe carries the clip\'s whole recipe (crop, speed, color, text, Auto Zoom, Hype Shake: the fields Compile sends), and Reframe and GIF are named for the video the person opened (16, 17; T-125 (9))', () => {
    const reframe = strip(read('modules/video-studio/ReframePanel.tsx'))
    expect(reframe).toMatch(/sourceName: source\.fileName\.replace\(/)
    expect(reframe).toMatch(/\.\.\.clipRecipe\(clip\)/)
    expect(reframe, 'the old two-field subset is gone').not.toMatch(/cropRect: clip\.cropRect,\s*speedMultiplier: clipSpeed\(clip\)/)
    expect(strip(read('modules/video-studio/CompilationPanel.tsx')), 'and it is the same call Compile makes').toMatch(/\.\.\.clipRecipe\(c\)/)
    // The header reads the CROP's size (the strip is cut from it), from the shared helper.
    expect(reframe).toMatch(/reframeReadout\(source\.probe\.width, source\.probe\.height, clip\.cropRect\)/)
    const gif = strip(read('modules/video-studio/GifPanel.tsx'))
    expect(gif).toMatch(/sourceName: source\.fileName\.replace\(/)
    expect(gif).toMatch(/cropRect: clip\.cropRect/)
    // main: the payload is checked at the boundary, the crop before the speed, then handed to the shared builders.
    const video = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/video.ts'), 'utf8'))
    expect(video).toMatch(/assertUsableCrop\([^)]*\)[\s\S]{0,600}assertUsableRecipe\(params, 'video:reframe', 'params'\)/)
  })

  it('the GIF, Compile, Reframe and Picture-in-picture panels start from the folder the last file went to, through ONE hook and ONE key (21)', () => {
    for (const panel of ['ReframePanel', 'GifPanel', 'CompilationPanel', 'PipPanel']) {
      const text = strip(read(`modules/video-studio/${panel}.tsx`))
      expect(text, `${panel}: uses the hook`).toMatch(/useVideoOutputDir\(\)/)
      expect(text, `${panel}: asks for the folder at the press, through the hook`).toMatch(/await resolveOutDir\(\)/)
      expect(text, `${panel}: keeps the folder once a file was written there`).toMatch(/rememberOutDir\(/)
      expect(text, `${panel}: the button is the hook's`).toMatch(/onClick=\{pickDir\}/)
      expect(text, `${panel}: no chooser of its own`).not.toMatch(/pickOutputDir/)
    }
    const hook = strip(read('hooks/useVideoOutputDir.ts'))
    expect(hook).toMatch(/VIDEO_OUTPUT_DIR_KEY = 'video\.lastOutputDir'/)
    expect(hook, 'what came off disk is checked before it is used').toMatch(/isSafeAbsolutePath\(stored\) \? stored : null/)
    // the key is a setting the renderer may read and write, and the store knows it
    const main = (rel: string): string => strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main', rel), 'utf8'))
    expect(main('ipc/settings.ts')).toMatch(/'video\.lastOutputDir'/)
    expect(main('store.ts')).toMatch(/'video\.lastOutputDir'\?: string/)
  })

  it('the re-attached video\'s saved toast is the shared one with "Edit in Video Studio", and the audio-only export\'s is not (20)', () => {
    const dialog = strip(read('modules/audio-studio/ExportDialog.tsx'))
    expect(dialog).toMatch(/const editInVideoStudio = useEditInVideoStudio\("Couldn't open the cleaned video in Video Studio\."\)/)
    // The mux branch: the saved toast with the action, on the file that was written.
    const mux = dialog.slice(dialog.indexOf('await window.api.audio.mux('), dialog.indexOf('} else {', dialog.indexOf('await window.api.audio.mux(')))
    expect(mux).toMatch(/toastSaved\('Cleaned audio attached to the video', outputPath, \{\s*label: 'Edit in Video Studio',\s*onClick: \(\) => \{\s*void editInVideoStudio\(outputPath\)/)
    // The audio-only branch stays a plain toast: there is no video to open.
    const audioOnly = dialog.slice(dialog.indexOf('await window.api.audio.export('), dialog.indexOf('setJob((prev) => (prev ? { ...prev, percent: 100'))
    expect(audioOnly).toMatch(/toast\.success\('Cleaned audio exported'\)/)
    expect(audioOnly).not.toMatch(/Edit in Video Studio|editInVideoStudio/)
  })

  it('a control with no live preview says so where it is: Speed, the overlay card, the Audio side column and the Fix Wizard\'s toast (19), and the overlay\'s window is flagged against the clip (18)', () => {
    expect(strip(read('modules/video-studio/ClipList.tsx'))).toContain('Speed is applied when you export. The player here always plays at normal speed.')
    const overlay = strip(read('modules/video-studio/TextOverlayEditor.tsx'))
    expect(overlay).toContain('Text appears in the exported file, not in the player. Times are seconds in the source video, or a time like 2:47:13.')
    expect(overlay).toContain('Source time')
    // The window that misses the clip: asked of the shared helper, drawn as a live region so a screen reader hears it appear.
    expect(overlay).toMatch(/overlayOutsideClipMessage\(/)
    expect(overlay).toMatch(/role="status"/)
    expect(strip(read('modules/audio-studio/AudioStudio.tsx'))).toContain('Changes here are applied when you export. The player plays your original sound.')
    expect(strip(read('modules/audio-studio/FixWizard.tsx'))).toContain(
      'Cleanup configured. It is applied when you export, so tweak it from the side panels if needed.'
    )
  })
})

describe('T-125 (round 75): the layout, copy and listener fixes are wired where the elements are', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  it('the folder chip ends in an ellipsis inside a cap, and carries the full path as its tooltip (11)', () => {
    const label = strip(read('components/OutputDirLabel.tsx'))
    expect(label).toMatch(/<span className="inline-flex items-center gap-1\.5 w-full max-w-\[9rem\]" title=\{outDir\}>/)
    expect(label).toMatch(/<span className="min-w-0 truncate">\{basename\(outDir\)\}<\/span>/)
    // The icon does not give up its width to the name.
    expect(label).toMatch(/<Icon name="folder" size=\{13\} className="shrink-0" \/>/)
    // And the accessible name is unchanged by the truncation: the screen-reader prefix is still there, then the whole name.
    expect(label).toMatch(/<span className="sr-only">Output folder: <\/span>/)
  })

  it('the picture-in-picture card gives the Position select a row of its own (12)', () => {
    const pip = strip(read('modules/video-studio/PipPanel.tsx'))
    expect(pip).toMatch(/<div className="grid grid-cols-2 gap-2 text-xs">/)
    expect(pip).not.toMatch(/grid-cols-3/)
    expect(pip).toMatch(/<label className="flex flex-col gap-1 col-span-2">\s*<span className="text-ink-muted">Position<\/span>/)
  })

  it('both Size boxes say they count pixels, and the overlay card\'s label column fits the longer word (16)', () => {
    expect(strip(read('modules/image-studio/PropertiesPanel.tsx'))).toMatch(/<span className="text-xs text-ink-muted w-16">Size \(px\)<\/span>/)
    const editor = strip(read('modules/video-studio/TextOverlayEditor.tsx'))
    expect(editor).toMatch(/label="Size \(px\)"/)
    expect(editor).not.toMatch(/label="Size"/)
    // Every label of the card shares one width, so the boxes stay in a column: "Size (px)" does not fit w-12.
    expect(editor).toMatch(/w-14 shrink-0">Font</)
    expect(editor).toMatch(/w-14 shrink-0">x \/ y</)
    expect(strip(read('components/DraftField.tsx'))).toMatch(/text-ink-muted w-14 shrink-0">\{label\}/)
  })

  it('the arrow, the end box and "s" are one wrap unit in the Source time row (17), and the pair decides the form (T-127 (7))', () => {
    const editor = strip(read('modules/video-studio/TextOverlayEditor.tsx'))
    expect(editor).toMatch(
      /<span className="flex flex-wrap items-center gap-x-1\.5 gap-y-0\.5">\s*<span className="text-ink-dim">→<\/span>\s*<DraftField[\s\S]{0,700}aria-label="Source time, end \(seconds, or a time like 2:47:13\)"[\s\S]{0,80}\/>\s*\{overlayTimePair\(overlay\.startSec, overlay\.endSec\)\.clock \? null : <span className="text-ink-dim">s<\/span>\}\s*<\/span>/
    )
    // T-127 (7): and the form is the PAIR's. Each box used to ask `overlayTimeText` about its own value ("3590.00 -> 1:00:10.00 s"); both
    // now read the one function that decides for the two, and the unit is drawn only when it says seconds.
    expect(editor).toMatch(/value=\{overlayTimePair\(overlay\.startSec, overlay\.endSec\)\.start\}/)
    expect(editor).toMatch(/value=\{overlayTimePair\(overlay\.startSec, overlay\.endSec\)\.end\}/)
    expect(editor, 'no box decides its own form').not.toMatch(/overlayTimeText/)
    expect(editor).not.toMatch(/\(seconds in the source video\)/)
  })

  it('the two toasts that carry a needed fact are held as long as an action toast (19)', () => {
    const wizard = strip(read('modules/audio-studio/FixWizard.tsx'))
    expect(wizard).toMatch(/import \{ ACTION_TOAST_MS \} from '\.\.\/\.\.\/lib\/savedToast'/)
    expect(wizard).toMatch(/toast\.success\(\s*'Cleanup configured\. It is applied when you export, so tweak it from the side panels if needed\.',\s*\{ duration: ACTION_TOAST_MS \}\s*\)/)
    const board = strip(read('modules/references/MoodBoardPanel.tsx'))
    expect(board).toMatch(/import \{ ACTION_TOAST_MS \} from '\.\.\/\.\.\/lib\/savedToast'/)
    expect(board).toMatch(/toast\.success\("Added to canvas as a reference — it won't be in your export", \{ duration: ACTION_TOAST_MS \}\)/)
  })

  it('the crash screen says the work is still open in its studios, and no longer says it waits on Home (21)', () => {
    const boundary = strip(read('components/ErrorBoundary.tsx'))
    const shown = boundary.replace(/\s+/g, ' ')
    expect(shown).toContain('Your work is still open in its studios, and imagii saves it every few seconds. Reload to Home to carry on.')
    expect(shown).not.toMatch(/waiting on/i)
    // The promise is true only while Reload to Home changes the hash and rebuilds no store: pin the button doing exactly that.
    expect(boundary).toMatch(/this\.setState\(\{ error: null, componentStack: null \}\)\s*window\.location\.hash = '#\/home'/)
    expect(boundary).not.toMatch(/location\.reload\(|location\.href\s*=/)
  })

  it('no panel keeps its own m:ss formatter: they all read the clock from the one helper, and the Source time boxes parse it (23)', () => {
    for (const rel of [
      'modules/video-studio/Timeline.tsx',
      'modules/video-studio/ClipList.tsx',
      'modules/video-studio/HighlightPanel.tsx',
      'modules/video-studio/CaptionsPanel.tsx',
      'modules/video-studio/ChatHighlightPanel.tsx',
      'modules/video-studio/Player.tsx',
      'modules/audio-studio/WaveformView.tsx'
    ]) {
      const src = strip(read(rel))
      expect(src, rel).toMatch(/import \{ formatClock \} from '@shared\/clockTime'/)
      expect(src, `${rel} still has its own minutes-past-59 formatter`).not.toMatch(/Math\.floor\(seconds \/ 60\)/)
      expect(src, rel).not.toMatch(/function format(Time|Short)\(/)
    }
    const editor = strip(read('modules/video-studio/TextOverlayEditor.tsx'))
    expect(editor).toMatch(/import \{ parseClock \} from '@shared\/clockTime'/)
    // Both boxes are text boxes that parse a clock time and refuse what they cannot read, in the shared sentence.
    expect(editor.match(/type="text"\s+inputMode="decimal"/g)?.length).toBe(2)
    expect(editor.match(/const n = parseClock\(typed\)\s+if \(n === null\) return OVERLAY_TIME_REFUSAL/g)?.length).toBe(2)
  })

  it('a microphone that ends mid-take is told once, and the listener comes off with the streams (25)', () => {
    const studio = strip(read('modules/record-studio/RecordStudio.tsx'))
    expect(studio).toMatch(/setPhase\('recording'\)\s*watchScreenEnd\(screenStream\)\s*if \(micStream\) watchMicEnd\(micStream\)/)
    expect(studio).toMatch(
      /function watchMicEnd\(micStream: MediaStream\): void \{\s*const tracks = micStream\.getAudioTracks\(\)\s*let told = false[\s\S]{0,300}toast\.error\('The microphone stopped\. The rest of this recording has no sound from it\.', \{ duration: ERROR_TOAST_MS \}\)[\s\S]{0,300}tracks\.forEach\(\(t\) => t\.addEventListener\('ended', warn\)\)\s*micEndOffRef\.current = \(\) => tracks\.forEach\(\(t\) => t\.removeEventListener\('ended', warn\)\)\s*if \(tracks\.some\(\(t\) => t\.readyState === 'ended'\)\) warn\(\)/
    )
    // The take itself is not ended by it (the screen's end is what ends a take): the mic watcher never calls stopRecording.
    const watcher = studio.slice(studio.indexOf('function watchMicEnd'), studio.indexOf('function stopRecording'))
    expect(watcher).not.toMatch(/stopRecording/)
    // Let go with the streams, so a take that finished cannot be told about a mic it no longer holds.
    expect(studio).toMatch(/function stopAllStreams\(\): void \{\s*screenEndOffRef\.current\?\.\(\)\s*screenEndOffRef\.current = null\s*micEndOffRef\.current\?\.\(\)\s*micEndOffRef\.current = null/)
  })

  it('the Video tour\'s Clip Kit step points at a button that carries its anchor (24)', () => {
    expect(strip(read('modules/video-studio/ClipKitButton.tsx'))).toMatch(/disabled=\{running\}\s*data-tutorial="video-clipkit"/)
  })

  it('every overlay field\'s name begins with the text drawn beside it (27)', () => {
    const editor = strip(read('modules/video-studio/TextOverlayEditor.tsx'))
    const labels = [...editor.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1] as string)
    const named = labels.filter((l) => !/^Remove overlay$/.test(l))
    expect(named).toEqual([
      'x / y, horizontal position (0 to 1)',
      'x / y, vertical position (0 to 1)',
      'Source time, start (seconds, or a time like 2:47:13)',
      'Source time, end (seconds, or a time like 2:47:13)'
    ])
    // The visible words those names must start with are the ones the card draws.
    expect(editor).toContain('>x / y</span>')
    expect(editor).toContain('>Source time</span>')
    for (const l of named) expect(/^(x \/ y|Source time)\b/.test(l), l).toBe(true)
  })
})

// T-126 (11): "300 ms" wrapped in Compile's fade row because the readout was `w-14 text-right` in a flex row with nothing to keep it from
// being squeezed (the class T-124 (25) fixed in ParamSlider alone). Every fixed-width readout in a flex row gets the same pair: `shrink-0`
// (the row gives somewhere else) and `whitespace-nowrap` (its words stay on one line). This is the audit, kept: a new readout that is a
// `font-mono` text with a fixed `w-N` and no guard fails here, whoever writes it. E2E (video-pipelines.spec.ts / audio.spec.ts) measure
// the rendered ones.
describe('T-126 (11) — a fixed-width readout is never squeezed or wrapped', () => {
  const NON_READOUT_TAGS = new Set(['input', 'textarea', 'select', 'DraftField', 'button'])

  /** The className strings of non-input elements that are a `font-mono` text of fixed width, and lack the pair. */
  function unguardedReadouts(text: string, file = 'x.tsx'): string[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const found: string[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(sf)
        if (!NON_READOUT_TAGS.has(tag)) {
          for (const attr of n.attributes.properties) {
            if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'className' || !attr.initializer) continue
            const classes = attr.initializer.getText(sf)
            if (/\bfont-mono\b/.test(classes) && /\bw-\d+\b/.test(classes) && !(/\bshrink-0\b/.test(classes) && /\bwhitespace-nowrap\b/.test(classes))) {
              found.push(`${file}:${sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1} <${tag} ${classes}>`)
            }
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return found
  }

  function tsxUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return tsxUnder(full)
      return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [full] : []
    })
  }

  it('every font-mono readout with a fixed width carries shrink-0 and whitespace-nowrap', () => {
    const files = tsxUnder(RENDERER_ROOT)
    expect(files.length, 'the scan reads the renderer').toBeGreaterThan(40)
    const offenders = files.flatMap((f) => unguardedReadouts(readFileSync(f, 'utf8'), path.relative(RENDERER_ROOT, f)))
    expect(offenders, 'a fixed-width readout that a flex row can squeeze or wrap').toEqual([])
  })

  it('the finder discriminates: the unguarded readout is found, the guarded one, an input and a width-less mono text are not', () => {
    expect(unguardedReadouts('const a = <span className="font-mono w-14 text-right">{x} ms</span>')).toHaveLength(1)
    expect(unguardedReadouts('const a = <span className={`font-mono w-14 text-right ${on ? "a" : "b"}`}>{x}</span>')).toHaveLength(1)
    expect(unguardedReadouts('const a = <span className="font-mono w-14 shrink-0 text-right">{x}</span>')).toHaveLength(1)
    expect(unguardedReadouts('const a = <span className="font-mono w-14 whitespace-nowrap text-right">{x}</span>')).toHaveLength(1)
    expect(unguardedReadouts('const a = <span className="font-mono w-14 shrink-0 whitespace-nowrap text-right">{x}</span>')).toEqual([])
    expect(unguardedReadouts('const a = <input className="font-mono w-20 bg-bg-base" />')).toEqual([])
    expect(unguardedReadouts('const a = <span className="font-mono text-right">{x}</span>')).toEqual([])
    expect(unguardedReadouts('const a = <span className="text-ink-muted w-16">Gain</span>')).toEqual([])
  })
})

// T-126 (3): a label-less DraftField's refusal sentence sat BESIDE the box (an 8-line column 70 px wide at the overlay card's 224 px row; for
// the end box, between the box and its "s"). It is a row of its own now: `basis-full order-last` on the sentence, and the two places that
// draw a Source time box let their row wrap. E2E: video-core.spec.ts "a refused Source time is one full-width sentence under its box".
describe('T-126 (3) — a refused Source time is a full-width sentence under its box', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  it('the sentence is basis-full and drawn last, and the label and the end unit that hold the boxes wrap', () => {
    const field = strip(read('components/DraftField.tsx'))
    expect(field).toMatch(/<p id=\{alertId\} role="alert" className="text-xs text-danger basis-full order-last">/)
    // Without a label the box and the sentence are still siblings, not wrapped: the boxes' own flex classes act in the caller's row.
    expect(field).toMatch(/if \(label === undefined\) \{\s*return \(\s*<>\s*\{box\}\s*\{refusal\}\s*<\/>\s*\)\s*\}/)
    const editor = strip(read('modules/video-studio/TextOverlayEditor.tsx'))
    expect(editor).toMatch(/<label className="flex flex-wrap items-center gap-x-1\.5 gap-y-0\.5">\s*<span className="text-ink-muted shrink-0">Source time<\/span>/)
    expect(editor).toMatch(/<span className="flex flex-wrap items-center gap-x-1\.5 gap-y-0\.5">\s*<span className="text-ink-dim">→<\/span>/)
  })
})
