import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT, ROUTE_ENTRY, collectRouteSources } from './routeSources'
import { parseSource, sourceFilesUnder } from './renderedStrings'

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
    // T-134 (7): the flag is per button now (`restoring`, `clearing`); either one running dims the file's buttons.
    expect(corruptionBanner).toMatch(/disabled=\{restoring \|\| clearing\}/)
    // T-92: the healthy banner's button is "Clear" too (it was "Discard"), and
    // starts the same call, so it is held to the same disabled-while-busy rule.
    const healthyBanner = banner.slice(banner.indexOf('imagii autosaved your work'))
    expect(healthyBanner).toMatch(/onClick=\{\(\) => void clearAutosave\(\)\}\s*disabled=\{restoring \|\| clearing\}/)
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
    expect(persist).toMatch(/persistSetting\('streamerHandle', watermark\.text\)/)
    expect(persist).toMatch(/persistSetting\('watermarkPosition', watermark\.position\)/)
  })

  // T-119 (13): and forgets them together. The guide says Clip Kit stamps "the watermark you last exported
  // with"; an export with the field blank used to leave the previous handle on disk for the kit to stamp.
  // E2E: video-pipelines.spec.ts "a blank export forgets the saved watermark" (the file on disk and the kit).
  it('a blank watermark clears the handle and the corner together, in the same block', () => {
    const persist = panel.slice(panel.indexOf('if (watermark) {'), panel.indexOf('const sourceBase'))
    const blank = persist.slice(persist.indexOf('} else {'))
    expect(blank).toMatch(/persistSetting\('streamerHandle', undefined\)/)
    expect(blank).toMatch(/persistSetting\('watermarkPosition', undefined\)/)
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
    // T-135 (4): the preview is the video store's, set for the video the job started on - after the guard has said that video is still open.
    expect(captions.indexOf('setSrtPathFor(')).toBeLessThan(captions.indexOf('setDerivedFor(startedFor, { transcript: result.segments })'))
  })

  it('Clean audio asks Audio Studio\'s own question before it extracts, and is off for a video with no sound', () => {
    // T-113: the lead-in is "Replace the audio you're editing?", not Close's.
    // T-133 (6): the chain the question is about is kept (`chainAsked`) to compare with the one there when the extraction ends.
    expect(videoStudio).toMatch(/const chainAsked = useAudioStore\.getState\(\)\.chain\s*if \(!confirmAudioClose\(chainAsked, \(message\) => confirm\(message\), 'replace'\)\) return/)
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
    // (T-130 (t): the extract also carries the clip's crop, so the call has one more field after the path.)
    expect(kit).toMatch(/outputPath: outPath,[^}]*\}\)\s*landed \+= 1/)
    // T-130 (t): and the crop it carries is the clip's, so a thumbnail is the picture the platform files are cut from.
    expect(kit).toMatch(/video\.extractFrame\(\{[^}]*cropRect: clip\.cropRect/)
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
    // T-135 (1): the settling moved with the batch into the queue's store (the panel can be gone when the batch ends); the panel hands the batch over.
    expect(exportPanel).toMatch(/await runExportBatch\(\{ queue, statuses, dir, sourcePath: source\.filePath \}\)/)
    const queueStore = read('modules/video-studio/store/exportQueue.ts')
    expect(queueStore).toMatch(/set\(\{ jobs: settleJobs\(get\(\)\.jobs, end\) \}\)/)
    expect(queueStore).toMatch(/useExportQueue\.getState\(\)\.settle\(\{ cancelled, message \}\)/)
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
    // T-136 (2): the claim is the import run's `begin()` in the module store (it was a component ref), taken before the first await.
    expect(importer).toMatch(/useImportRun\.getState\(\)\.begin\(\{ filePath, converting: false \}\)/)
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
    // T-134 (2): on the press only (`if (!e.repeat)`); the T-134 pin at the end of this file holds that half.
    expect(handler).toMatch(/case 'i':\s*case 'I':\s*e\.preventDefault\(\)\s*if \(!e\.repeat\) setMarker\('in'\)/)
    expect(handler).toMatch(/case 'o':\s*case 'O':\s*e\.preventDefault\(\)\s*if \(!e\.repeat\) setMarker\('out'\)/)
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
  // video-pipelines.spec.ts (Save .srt) put a 300 ms dialog in the window the second press lands in. T-128 (3): and the confirm of
  // "Clear saved transcripts" (fifteen), which closes its dialog on the first press and must not clear twice.
  it('the save handlers (a variant\'s Save, Save all, Save .srt) and the transcript clear claim their ref before the first await, first of all, and give it back in a finally (T-127 (11), T-128 (3))', () => {
    const handlers = [
      ['modules/image-studio/ThumbnailVariants.tsx', 'saveOne', 'startingRef', 'p: VariantPreview'],
      ['modules/image-studio/ThumbnailVariants.tsx', 'saveAll', 'startingRef', ''],
      ['modules/video-studio/CaptionsPanel.tsx', 'saveSrt', 'saveSrtStartingRef', ''],
      ['modules/video-studio/CaptionsPanel.tsx', 'clearTranscripts', 'clearStartingRef', '']
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
    expect(studio).toMatch(/import \{ currentRoute, replacedSince \} from '\.\.\/project\/ProjectIO'/)
  })

  // T-133 (6): `replacedSince` is identity of the SOURCE; work tuned on the file already open during the wait was replaced with no question
  // (loadSource resets the chain and the undo history). E2E: video-pipelines.spec.ts "Clean audio asks again about work tuned while it was
  // extracting" (tuned during a held extraction: the question appears; declined keeps the tuning, accepted replaces it).
  it('Clean audio asks again after the wait about work tuned meanwhile, and a decline takes the Skipped path (T-133 (6))', () => {
    const studio = read('modules/video-studio/VideoStudio.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const flow = studio.slice(studio.indexOf('async function cleanAudioFlow'), studio.indexOf('return (\n    <div className="h-full'))
    const asked = flow.indexOf('const chainAsked = useAudioStore.getState().chain')
    const firstAsk = flow.indexOf('confirmAudioClose(chainAsked')
    const extract = flow.indexOf('await window.api.audio.extractFromVideo')
    const compare = flow.indexOf('replacedSince(heldBefore, useAudioStore.getState().source)')
    const again = flow.indexOf('confirmReplaceAfterWait(chainAsked, useAudioStore.getState().chain')
    const load = flow.indexOf('await loadAudioSource(')
    expect(asked, 'the chain the first question is about is kept').toBeGreaterThan(-1)
    expect(asked).toBeLessThan(firstAsk)
    expect(firstAsk).toBeLessThan(extract)
    expect(again, 'asked again after the wait and the different-file check, before anything loads').toBeGreaterThan(compare)
    expect(again).toBeGreaterThan(extract)
    expect(again).toBeLessThan(load)
    expect(flow).toMatch(/if \(!confirmReplaceAfterWait\(chainAsked, useAudioStore\.getState\(\)\.chain, \(message\) => confirm\(message\)\)\) \{\s*toast\.dismiss\('extract-audio'\)\s*toast\("Skipped this video's sound to keep the changes you made in Audio Studio while it was extracting"[\s\S]*?return\s*\}/)
    expect(studio).toMatch(/import \{ confirmAudioClose, confirmReplaceAfterWait \} from '\.\.\/audio-studio\/audioClose'/)
  })

  // T-132 (1): the extraction takes minutes, and `navigate` still works from a studio that unmounted (react-router's activeRef never resets), so
  // Clean audio took the person to /audio wherever they were: from /record that unmounted RecordStudio, whose cleanup stops the tracks and cut a
  // live take short. E2E: record.spec.ts "Clean audio finishing during a live take does not move the person or stop the take" (the take runs on,
  // no "Opening Audio Studio") and video-pipelines.spec.ts "Clean audio finishing while the person is elsewhere loads the sound and offers Open
  // Audio Studio"; the stay-on-/video path is every existing Clean audio case (it still navigates).
  it('Clean audio navigates only a person who is still on Video Studio; anyone else keeps their screen and is offered the way (T-132 (1))', () => {
    const studio = read('modules/video-studio/VideoStudio.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const flow = studio.slice(studio.indexOf('async function cleanAudioFlow'), studio.indexOf('return (\n    <div className="h-full'))
    const where = flow.indexOf('const where = currentRoute()')
    const load = flow.indexOf('await loadAudioSource(')
    expect(where, 'the route is read AFTER the wait, when the sound is loaded').toBeGreaterThan(load)
    expect(flow).toMatch(/if \(where === '\/video'\) \{\s*toast\.success\('Opening Audio Studio'\)\s*navigate\('\/audio'\)\s*\} else \{/)
    expect(flow.match(/navigate\('\/audio'\)/g) ?? [], 'two places navigate: the stay-here branch, and the toast\'s own button').toHaveLength(2)
    // T-133 (1): the button's press asks about a live take first (the toast can be over the REC screen).
    expect(flow).toMatch(/where === '\/audio'\s*\? \[\]\s*: \[\s*\{\s*label: 'Open Audio Studio',\s*onClick: \(\) => \{\s*if \(mayLeaveLiveTake\(\)\) navigate\('\/audio'\)\s*\}\s*\}\s*\]/)
    // The route is read from the hash the router writes, by the one function Save project reads it with (not a render's stale closure).
    expect(read('modules/project/ProjectIO.ts')).toMatch(/export function currentRoute\(\): string \| undefined/)
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
      'cancelAllHighlightJobs', 'cancelAllFrameJobs', 'cancelWhisperModelInstall', 'cancelTranscribe', 'cancelBurnIn', 'cancelAllConverts',
      // T-129: the waveform's peaks job (also reached through cancelAllAudioJobs; named here as the inventory entry, like extractions).
      'cancelAllPeaks'
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
    // T-133 (7b): on the press only (`if (!e.repeat)`); the guard itself is pinned in the T-133 (7) block below.
    expect(handler).toMatch(/case ' ':\s*e\.preventDefault\(\)\s*if \(!e\.repeat\) useVideoStore\.getState\(\)\.transport\?\.togglePlay\(\)\s*return/)
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
    expect(kit).toMatch(/persistSetting\('clipKit\.lastOutputDir', parentDir\)/)
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
      /const safeName = sanitizeFilename\(clip\.name\)\s*useKitRun\.getState\(\)\.patch\(\{ phase: 'Creating folder…' \}\)\s*kitDir = await window\.api\.video\.makeKitDir\(\{\s*parentDir,\s*clipName: safeName\s*\}\)/
    )
    expect(kit, 'the folder is asked for with the sanitized name').not.toMatch(/makeKitDir\(\{[^}]*clipName: clip\.name/)
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

  // T-129 flips the round-71 pin "the 2-hour gate is asked where the length is known, before the work, with the sentence for what the
  // file is (6, 7)": the ceiling is RETIRED with the renderer's decode (the waveform is main's streamed peaks now), so no route asks it.
  it('no route asks a length ceiling any more: Clean audio, the extraction handler and the load go straight to the work (T-129, flipping 6, 7)', () => {
    const studio = strip(read('modules/video-studio/VideoStudio.tsx'))
    const flow = studio.slice(studio.indexOf('async function cleanAudioFlow'), studio.indexOf('return (\n    <div className="h-full overflow-auto'))
    expect(flow, 'Clean audio: no gate on the open video\'s length').not.toMatch(/waveformCeilingRefusal|tooLong|probe\.duration/)
    // The replace question is still asked first, then the extraction.
    expect(flow.indexOf('confirmAudioClose(')).toBeGreaterThan(0)
    expect(flow.indexOf('window.api.audio.extractFromVideo')).toBeGreaterThan(flow.indexOf('confirmAudioClose('))
    // main: the probe (for "no sound" and for the picture question), THEN the extraction, and nothing asked of the scratch WAV.
    const audio = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/audio.ts'), 'utf8'))
    const handler = audio.slice(audio.indexOf("ipcMain.handle('audio:extractFromVideo'"), audio.indexOf("ipcMain.handle('audio:peaks'"))
    // T-125 (4): only "no sound" is the probe's verdict. T-126 (7) / T-127 (10): the picture question is answered from the streams, the
    // extension only when the probe could not say (the renderer's `isPicture`). That plumbing stays exactly as it was.
    expect(handler).toMatch(
      /let hasVideo: boolean \| null = null\s*try \{\s*const probe = await probeAudio\(videoPath\)\s*hasVideo = probe\.hasVideo \?\? null\s*\} catch \(err\) \{\s*if \(isNoAudioStreamError\(err\)\) throw err\s*if \(err instanceof NoUsableDurationError\) hasVideo = err\.hasVideo\s*console\.warn\([^)]*\)\s*\}\s*const result = await extractAudioFromVideo\(videoPath\)\s*return \{ wavPath: result\.wavPath, hasVideo \}/
    )
    expect(handler, 'the T-126 (8) backstop went with the ceiling').not.toMatch(/probeAudio\(result\.wavPath\)|result\.cleanup\(\)/)
    // the load: no gate, and nothing in the tree still speaks of one.
    const store = strip(read('modules/audio-studio/state/audioStore.ts'))
    expect(store).not.toMatch(/waveformCeilingRefusal|WAVEFORM_MAX_SEC/)
    for (const [label, code] of [['VideoStudio.tsx', studio], ['ipc/audio.ts', audio], ['audioStore.ts', store]] as const) {
      expect(code, label).not.toMatch(/longer than 2 hours/)
    }
  })

  it('the waveform is drawn from main\'s peaks and never decoded here: the job, its progress line, its Cancel on Close, and the quit sweep (T-129)', () => {
    // The store opens the file, THEN runs the peaks job for it; Close and a superseding open stop a job still drawing.
    const store = strip(read('modules/audio-studio/state/audioStore.ts'))
    const load = store.slice(store.indexOf('loadSource: async'), store.indexOf('clearSource: () => {'))
    expect(load).toMatch(/stopDrawing\(get\(\)\.drawing\)\s*const jobId = nanoid\(10\)\s*set\(\{\s*source,\s*waveform: null,\s*drawing: \{ jobId, percent: 0 \},/)
    expect(load).toMatch(/void drawWaveform\(source, jobId\)/)
    const clear = store.slice(store.indexOf('clearSource: () => {'), store.indexOf('setCurrentTime: (t)'))
    expect(clear).toMatch(/stopDrawing\(get\(\)\.drawing\)/)
    expect(store).toMatch(/function stopDrawing\(drawing: WaveformDrawing \| null\): void \{\s*if \(drawing\) window\.api\.audio\.cancel\(drawing\.jobId\)/)
    const draw = store.slice(store.indexOf('async function drawWaveform'), store.indexOf('export const useAudioStore'))
    expect(draw).toMatch(/const answer = await window\.api\.audio\.peaks\(source\.filePath, jobId\)\s*if \(!isWaveformPeaks\(answer\)\) throw new Error\(WAVEFORM_READ_FAILED\)/)
    // A job whose file was closed or replaced answers nobody, in either direction.
    expect(draw.match(/if \(getState\(\)\.source !== source\) return/g) ?? []).toHaveLength(2)
    expect(draw).toMatch(/reportFailure\(err, \{ failed: "Couldn't draw the waveform\." \}\)/)
    // wavesurfer: created only once there are peaks, and handed them with the length; no `url`-only load anywhere.
    const view = strip(read('modules/audio-studio/WaveformView.tsx'))
    expect(view).toMatch(/if \(!source \|\| !waveform \|\| !containerRef\.current\) return/)
    expect(view).toMatch(/WaveSurfer\.create\(\{\s*container: containerRef\.current,\s*url: source\.url,\s*peaks: waveform\.peaks,\s*duration: waveform\.duration,/)
    expect(view.match(/WaveSurfer\.create\(/g) ?? []).toHaveLength(1)
    expect(view).not.toMatch(/\.load\(|\.loadBlob\(/)
    // While it draws, the box the waveform will fill says how far it has read (the expediter's T-129 note: not an empty dark box).
    expect(view).toMatch(/role="progressbar"\s*aria-label="Drawing the waveform"/)
    expect(view).toMatch(/Drawing the waveform… \{percent\}%/)
    // main: the per-job Cancel and the quit sweep reach the peaks registry through the audio cancels, and before-quit names it.
    const proc = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/audio/process.ts'), 'utf8'))
    expect(proc).toMatch(/export function cancelAudioJob\(jobId: string\): boolean \{\s*const peaks = cancelPeaksJob\(jobId\)/)
    expect(proc).toMatch(/if \(!child\) return marked \|\| peaks/)
    expect(proc).toMatch(/export function cancelAllAudioJobs\(\): void \{[\s\S]*?cancelAllPeaks\(\)\s*\}/)
    const audio = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/audio.ts'), 'utf8'))
    expect(audio).toMatch(/ipcMain\.handle\('audio:peaks', async \(e, filePath: string, jobId: string\) => \{\s*assertSafeAbsolutePath\(filePath, 'audio:peaks filePath'\)\s*assertNonEmptyString\(jobId, 'audio:peaks jobId'\)\s*return readPeaks\(filePath, jobId, \(p\) => sendIfAlive\(e\.sender, 'audio:peaksProgress', p\)\)/)
  })

  // T-132 (5): wavesurfer 7.12.6's `normalize` finds its scale in channel 0 (the highs) ONLY (`calculateVerticalScale`), so a take whose lows
  // are louder drew the bottom half past the canvas edge. `maxPeak` is its own fixed-scale option: the view hands it the loudest sample of
  // BOTH halves. E2E: audio.spec.ts "an asymmetric take draws both halves to scale" reads the painted canvas.
  it('the waveform is scaled by the loudest sample of both halves, not wavesurfer\'s highs-only guess (T-132 (5))', () => {
    const view = strip(read('modules/audio-studio/WaveformView.tsx'))
    expect(view).toMatch(/normalize: true,\s*maxPeak: peaksMaxMagnitude\(waveform\.peaks\),/)
    expect(view).toMatch(/import \{ PLAYBACK_ERROR_MESSAGE, peaksMaxMagnitude \} from '@shared\/audio'/)
    // ...and the option is one the installed wavesurfer honors (typed, and read by the renderer's scale), or this is a no-op.
    const wsRoot = path.resolve(RENDERER_ROOT, '../../../node_modules/wavesurfer.js/dist')
    expect(readFileSync(path.join(wsRoot, 'wavesurfer.d.ts'), 'utf8')).toMatch(/maxPeak\?: number/)
    expect(readFileSync(path.join(wsRoot, 'renderer.js'), 'utf8')).toMatch(/maxPeak: options\.maxPeak/)
  })

  // T-132 (11): `loadSource` resolves when the file is OPEN, and its waveform is read after that (T-129): main can still refuse it, and the
  // studio then lets go of it. The green "Loaded" and the Recent entry landed first (a refused file sat in Recent beside the refusal), and so
  // did "Project loaded" / "Restored from autosave" for a project whose sound was refused. E2E: audio.spec.ts "a file main cannot read the sound
  // of is refused while its waveform is drawn" (no "Loaded", nothing in Recent); the project lines are held by `audioSettled`'s unit cases.
  it('"Loaded" and the Recent entry wait for the waveform; the project lines wait for the sound the open put there (T-132 (11))', () => {
    const importer = strip(read('modules/audio-studio/AudioImporter.tsx'))
    const arrived = importer.indexOf('if (!(await waveformArrived(opened))) return')
    expect(arrived, 'the importer asks whether the waveform came').toBeGreaterThan(-1)
    expect(importer.indexOf('await push(filePath)'), 'the Recent entry comes after the answer').toBeGreaterThan(arrived)
    expect(importer.indexOf("toast.success('Loaded')"), '"Loaded" comes after it').toBeGreaterThan(arrived)
    expect(importer.match(/opened = await loadSource\(/g) ?? [], 'both ways in keep the source they opened').toHaveLength(2)
    expect(strip(read('routes/Home.tsx'))).toMatch(/\} else if \(await audioSettled\(outcome\)\) \{\s*toast\.success\('Project loaded'\)/)
    const restore = strip(read('components/AutosaveRestore.tsx'))
    expect(restore).toMatch(/void audioSettled\(outcome\)\.then\(\(settled\) => \{\s*if \(settled\) toast\.success\('Restored from autosave'\)/)
    expect(restore, 'and the restore\'s navigation does not wait for the line').not.toMatch(/await audioSettled/)
    const project = strip(read('modules/project/ProjectIO.ts'))
    expect(project.match(/opened = await useAudioStore\.getState\(\)\.loadSource\(/g) ?? [], 'the three ways a project opens its sound').toHaveLength(3)
    expect(project).toMatch(/if \(opened\) outcome\.audioOpened = opened/)
  })

  // T-132 (7): "Base on" sets all five boxes from the platform, not the size alone. E2E: video-pipelines.spec.ts "saves, lists, queues and
  // deletes a custom preset" drives the select to YouTube 1080p60 and reads the boxes (60 fps, 12M, 192k).
  it('"Base on" loads the platform\'s rate and bitrates into the form, not its size alone (T-132 (7))', () => {
    const manager = strip(read('modules/video-studio/CustomPresetManager.tsx'))
    const load = manager.slice(manager.indexOf('function loadFromBase'), manager.indexOf('async function save'))
    expect(load).toMatch(/const start = customPresetStartFor\(p\)/)
    for (const setter of ['setWidth(start.width)', 'setHeight(start.height)', 'setFps(start.fps)', 'setVideoBitrate(start.videoBitrate)', 'setAudioBitrate(start.audioBitrate)', 'setBase(p)']) {
      expect(load, setter).toContain(setter)
    }
  })

  // T-132 (6): the tour's window keydown hands the key's `repeat` to `tutorialKeyIntent`, and a 'hold' cancels the default action (the focused
  // button's click) and does nothing else. E2E: home-chrome.spec.ts "Video tutorial: a held Enter steps once".
  it('the tour passes e.repeat to its key intent and cancels a held key without stepping (T-132 (6))', () => {
    const tour = strip(read('components/Tutorial.tsx'))
    expect(tour).toMatch(/tutorialKeyIntent\(\{ key: e\.key, onButton, repeat: e\.repeat \}\)/)
    expect(tour).toMatch(/if \(intent === 'none'\) return\s*[\s\S]*?e\.preventDefault\(\)\s*if \(intent === 'close'\) onClose\(\)\s*else if \(intent === 'next'\) next\(\)\s*else if \(intent === 'prev'\) prev\(\)/)
  })

  // T-132 (3): the "Clear saved transcripts" row wraps by item and its label never wraps by word. E2E: video-pipelines.spec.ts "the Clear
  // saved transcripts row keeps its label on one line and inside its card at the default window and the minimum" measures the real layout.
  it('the Clear saved transcripts row wraps by item and the button keeps its label on one line (T-132 (3))', () => {
    const panel = read('modules/video-studio/CaptionsPanel.tsx')
    const row = panel.slice(panel.indexOf('{transcriptCount !== null ? ('), panel.indexOf('<Modal'))
    expect(row).toMatch(/<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-dim border-t border-ink-dim\/20 pt-2">/)
    expect(row).toMatch(/className="btn-ghost px-2 py-1 ml-auto inline-flex items-center gap-1\.5 whitespace-nowrap disabled:opacity-50"/)
  })

  // T-132 (14): `clearedTranscriptsMessage` documents a partial clear as something other than a success, and the panel drew it with
  // `toast.success` (a green tick over "Cleared 2 of 3 saved transcripts. The rest are open in another program"). E2E: video-pipelines.spec.ts
  // "a clear that got part of the way is a warning" (main's handler answers 2 removed, 1 failed: the card has the warning icon, no tick).
  it('a partial transcript clear is a warning toast, a full one a success and a total refusal an error (T-132 (14))', () => {
    const panel = strip(read('modules/video-studio/CaptionsPanel.tsx'))
    const clear = panel.slice(panel.indexOf('async function clearTranscripts'), panel.indexOf('async function transcribe'))
    expect(clear).toMatch(/if \(message\.error\) toast\.error\(message\.text, \{ duration: ERROR_TOAST_MS \}\)\s*else if \(result\.failed > 0\) toast\(message\.text, \{ icon: <Icon name="warning" size=\{18\} \/>, duration: ERROR_TOAST_MS \}\)\s*else toast\.success\(message\.text\)/)
    expect(clear, 'a partial clear is not drawn with the success toast').not.toMatch(/toast\.success\(message\.text, \{/)
  })

  // T-132 (9): Play is off until the waveform is drawn (T-129: seconds, up to tens of seconds for a long file) and drew like a live button
  // all that time - `btn-ghost` has no disabled look of its own, and every other disabled button in the app carries `disabled:opacity-50`.
  // E2E: audio.spec.ts "Play looks disabled while the waveform is being drawn" reads the computed opacity.
  it('Play is dimmed while it is off (T-132 (9)): the disabled button carries the class every other one does', () => {
    const view = strip(read('modules/audio-studio/WaveformView.tsx'))
    const play = view.slice(view.indexOf('<button\n          className="btn-ghost px-3 py-2'), view.indexOf('<Icon name={playing ?'))
    expect(play, 'found the Play button').toMatch(/onClick=\{togglePlay\}/)
    expect(play).toMatch(/className="btn-ghost px-3 py-2 disabled:opacity-50"/)
    expect(play).toMatch(/disabled=\{!ready\}/)
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
    expect(strip(read('modules/video-studio/ClipKitButton.tsx'))).toMatch(/disabled=\{kitRun !== null\}\s*data-tutorial="video-clipkit"/)
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

// T-128 (2): the three @fontsource CSS imports (latin-400/500/600) each listed a .woff fallback after the .woff2, and the build emitted all
// six files; Chromium 126 (this Electron) reads woff2 and never requests the .woff, so 93 KB of the download was a font nothing could use.
// The rules are inline now (top of styles/index.css) and name ONLY the package's woff2 files, which Vite asset-imports by that path.
// smoke.spec.ts reads the BUILT folder (no .woff, every url() a file the build holds, the page loads all three weights from them).
describe('T-128 (2) — Inter ships as woff2 alone, from inline @font-face rules', () => {
  const noComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /** What is wrong with the stylesheet's Inter faces: one entry per problem, empty when the set is the three weights, woff2 alone. */
  function fontFaceProblems(css: string, fileExists: (spec: string) => boolean): string[] {
    const faces = noComments(css).match(/@font-face\s*\{[^}]*\}/g) ?? []
    const problems: string[] = []
    const weights = faces.map((f) => /font-weight:\s*(\d+)/.exec(f)?.[1] ?? '?').sort()
    if (weights.join() !== '400,500,600') problems.push(`faces for weights ${weights.join() || 'none'}, not 400,500,600`)
    for (const face of faces) {
      const label = `the ${/font-weight:\s*(\d+)/.exec(face)?.[1] ?? '?'} face`
      if (!/font-family:\s*'Inter'/.test(face)) problems.push(`${label} is not the Inter family`)
      const src = /src:\s*([^;]+);/.exec(face)?.[1] ?? ''
      const urls = [...src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1] as string)
      if (urls.length !== 1) problems.push(`${label} lists ${urls.length} sources (woff2 alone: one)`)
      for (const u of urls) {
        if (!/^@fontsource\/inter\/files\/inter-latin-\d+-normal\.woff2$/.test(u)) problems.push(`${label} names ${u}, not a woff2 file of the package`)
        else if (!fileExists(u)) problems.push(`${label} names ${u}, which the package does not hold`)
      }
      if (/format\(\s*['"]woff['"]\s*\)/.test(src)) problems.push(`${label} still carries a woff format`)
    }
    return problems
  }
  const NODE_MODULES = path.resolve(RENDERER_ROOT, '../../../node_modules')
  const inPackage = (spec: string): boolean => {
    try {
      statSync(path.join(NODE_MODULES, spec))
      return true
    } catch {
      return false
    }
  }
  const face = (weight: number, src: string): string =>
    `@font-face { font-family: 'Inter'; font-style: normal; font-display: swap; font-weight: ${weight}; src: ${src}; }`
  const ok = (w: number): string => face(w, `url('@fontsource/inter/files/inter-latin-${w}-normal.woff2') format('woff2')`)

  it('the renderer entry imports no @fontsource css, and the style sheet holds the three weights as woff2 files of the package', () => {
    expect(noComments(read('main.tsx'))).not.toMatch(/@fontsource/)
    expect(fontFaceProblems(read('styles/index.css'), inPackage)).toEqual([])
  })

  it('the finder discriminates: a woff fallback, a lost weight, a file the package lacks and another family are each found', () => {
    const set = [ok(400), ok(500), ok(600)].join('\n')
    expect(fontFaceProblems(set, () => true)).toEqual([])
    const fallback = face(600, "url('@fontsource/inter/files/inter-latin-600-normal.woff2') format('woff2'), url('@fontsource/inter/files/inter-latin-600-normal.woff') format('woff')")
    const withFallback = fontFaceProblems([ok(400), ok(500), fallback].join('\n'), () => true)
    expect(withFallback.join('|')).toMatch(/lists 2 sources/)
    expect(withFallback.join('|')).toMatch(/inter-latin-600-normal\.woff, not a woff2 file/)
    expect(withFallback.join('|')).toMatch(/still carries a woff format/)
    expect(fontFaceProblems([ok(400), ok(500)].join('\n'), () => true).join('|')).toMatch(/weights 400,500, not 400,500,600/)
    expect(fontFaceProblems(set, (u) => !u.includes('-500-')).join('|')).toMatch(/500 face names .*-500-.*does not hold/)
    expect(fontFaceProblems(set.replace("font-family: 'Inter'", "font-family: 'Roboto'"), () => true).join('|')).toMatch(/is not the Inter family/)
    // A commented-out rule is not a rule.
    expect(fontFaceProblems(`${set}\n/* ${face(700, "url('x.woff')")} */`, () => true)).toEqual([])
  })
})

// T-131 (round 79): wiring for the seventeenth pass's renderer fixes. Behavior is pinned where it lives (repeatPress.test.ts, claimFirst.test.ts,
// videoStore.test.ts) and proven on the built app by the E2E specs named per test; what no DOM-less test can see is that the control a person
// reaches is the one that carries the fix, and these read the source to say so.
describe('T-131 — the sweep-17 fixes are wired where the person reaches them', () => {
  const MAIN_INDEX_FOR_T131 = path.resolve(RENDERER_ROOT, '../../main/index.ts')
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  it('(3) the highlight finder, the chat spike finder and the transcript preview clear their results with the open video: the store empties them on load and close (T-135 (4) moved them there from three effects keyed on the path)', () => {
    // The three panels used to reset on `[openPath]` / `[source?.filePath]`, which also ran on every MOUNT (T-135 (4)): a result lasted until the
    // person left the studio. Now `loadSource` and `clearSource` empty them, so a replaced video starts clean and the same video keeps its results.
    const store = strip(read('modules/video-studio/store/videoStore.ts'))
    expect(store.match(/derived: EMPTY_DERIVED/g) ?? [], 'initial state, loadSource and clearSource').toHaveLength(3)
    const captions = strip(read('modules/video-studio/CaptionsPanel.tsx'))
    expect(captions).not.toMatch(/\[source\?\.filePath\]/)
    const highlight = strip(read('modules/video-studio/HighlightPanel.tsx'))
    expect(highlight).not.toMatch(/\[openPath\]/)
    const chat = strip(read('modules/video-studio/ChatHighlightPanel.tsx'))
    expect(chat).not.toMatch(/\[openPath\]/)
    // A scan that finishes after the video was replaced is for a video that is gone: its candidates are stored for the video it started on, and
    // the store drops them (and the toast with them) when that video is no longer the open one.
    const scan = highlight.slice(highlight.indexOf('async function scan()'), highlight.indexOf('function addAsClip'))
    expect(scan).toMatch(/const startedFor = source\.filePath/)
    expect(scan).toMatch(/await window\.api\.video\.findHighlights\(startedFor\)/)
    expect(scan).toMatch(/setDerivedFor\(startedFor, \{ scanCandidates: found \}\)/)
    expect(scan).toMatch(/if \(!stored\(narrowed\)\) return/)
    // ...and the store refuses what neither panel can any longer hand it.
    expect(strip(read('modules/video-studio/store/videoStore.ts'))).toMatch(
      /if \(duration - startSec < MIN_SCANNED_CLIP_SEC\) return 'refused'/
    )
  })

  it('(4) every Fix wizard answer ignores the second press of a double-click', () => {
    const wizard = strip(read('modules/audio-studio/FixWizard.tsx'))
    expect(wizard).toMatch(/import \{ isRepeatPress \} from '\.\.\/\.\.\/lib\/repeatPress'/)
    const answers = wizard.slice(wizard.indexOf('{q.options.map'), wizard.indexOf('{opt.label}'))
    expect(answers).toMatch(/onClick=\{\(e\) => \{\s*if \(isRepeatPress\(e\)\) return\s*if \(q\.id === 'noise'\)/)
  })

  it('(6) the tour\'s Next / Done, Back and scrim step once per discrete press', () => {
    const tour = strip(read('components/Tutorial.tsx'))
    expect(tour).toMatch(/const stepOnce = \(go: \(\) => void\) => \(e: \{ detail: number \}\): void => \{\s*if \(isRepeatPress\(e\)\) return\s*go\(\)\s*\}/)
    expect(tour).toMatch(/mask="url\(#tutorial-mask\)"\s*onClick=\{stepOnce\(next\)\}/)
    expect(tour).toMatch(/onClick=\{stepOnce\(prev\)\}/)
    // Next and Done are ONE button: the label changes on the last step.
    expect(tour).toMatch(/ref=\{nextBtnRef\}[\s\S]*?onClick=\{stepOnce\(next\)\}/)
    // The keys are the window handler's (detail 0) and are not routed through the click rule.
    expect(tour).toMatch(/else if \(intent === 'next'\) next\(\)/)
  })

  it('(7) the Player\'s and the Timeline\'s hint lines name the ? key', () => {
    const player = strip(read('modules/video-studio/Player.tsx'))
    expect(player).toMatch(/set in\/out ·\{' '\}\s*<kbd className="px-1 bg-bg-hover rounded">\?<\/kbd> all shortcuts\s*<\/p>/)
    const timeline = strip(read('modules/video-studio/Timeline.tsx'))
    expect(timeline).toMatch(/at the playhead ·\{' '\}\s*<kbd className="px-1 bg-bg-hover rounded">\?<\/kbd> all shortcuts\s*<\/p>/)
  })

  it('(8) a dialog that closes arms the swallow of a double-click\'s second press, in the Modal and in the tour', () => {
    expect(strip(read('components/Modal.tsx'))).toMatch(
      /useEffect\(\(\) => \{\s*if \(!open\) return\s*openModals\+\+\s*return \(\) => \{\s*openModals--\s*swallowRepeatClicks\(\)\s*\}\s*\}, \[open\]\)/
    )
    expect(strip(read('components/Tutorial.tsx'))).toMatch(/useEffect\(\(\) => swallowRepeatClicks, \[\]\)/)
    // One capture-phase listener on the window, ahead of React's, stopping the click before any handler or default action.
    const lib = strip(read('lib/repeatPress.ts'))
    expect(lib).toMatch(/window\.addEventListener\(\s*'click',[\s\S]*?e\.stopImmediatePropagation\(\)\s*e\.preventDefault\(\)[\s\S]*?true\s*\)/)
  })

  it('(9) the Cancel question goes with its batch: Export closes it the moment `running` is false, and Clip Kit\'s lives in a component that exists only while a kit runs (T-136 (1))', () => {
    expect(strip(read('modules/video-studio/ExportPanel.tsx'))).toMatch(/useEffect\(\(\) => \{\s*if \(!running\) setShowCancelConfirm\(false\)\s*\}, \[running\]\)/)
    // The kit's question is KitCancel's state, and KitCancel is drawn only for a run that exists - so it cannot outlive the run.
    const kit = strip(read('modules/video-studio/ClipKitButton.tsx'))
    expect(kit).toMatch(/function KitCancel\(\): JSX\.Element \{\s*const \[showCancelConfirm, setShowCancelConfirm\] = useState\(false\)/)
    expect(kit.match(/\{kitRun !== null \? <KitCancel \/> : null\}/g) ?? [], 'the button draws it only while a kit runs').toHaveLength(1)
    expect(kit.match(/<KitCancel \/>/g) ?? [], 'and ClipKitRunning (the closed video) is the only other place').toHaveLength(2)
  })

  it('(13) the four folder chips are off while their job runs', () => {
    for (const [rel, flag] of [
      ['modules/video-studio/ReframePanel.tsx', 'running'],
      ['modules/video-studio/CompilationPanel.tsx', 'busy'],
      ['modules/video-studio/GifPanel.tsx', 'busy'],
      ['modules/video-studio/PipPanel.tsx', 'busy']
    ] as const) {
      expect(strip(read(rel)), rel).toMatch(new RegExp(`<button className="btn-ghost min-w-0 px-3 py-1\\.5 text-xs disabled:opacity-50" onClick=\\{pickDir\\} disabled=\\{${flag}\\}>\\s*<OutputDirLabel`))
    }
  })

  it('(13) the Reframe and Compile primaries keep their idle width, so the busy label cannot shrink them', () => {
    expect(strip(read('modules/video-studio/ReframePanel.tsx'))).toMatch(/className="btn-primary px-4 py-1\.5 ml-auto whitespace-nowrap min-w-\[8\.6rem\] disabled:opacity-50"/)
    expect(strip(read('modules/video-studio/CompilationPanel.tsx'))).toMatch(/className="btn-primary px-3 py-1\.5 text-xs ml-auto whitespace-nowrap min-w-\[7\.1rem\] disabled:opacity-50"/)
  })

  it('(16), (17) the guide speaks the pair rule, the overlay comment no longer says the card never speaks two forms, and the quit comment tells the Windows truth', () => {
    const guide = readFileSync(path.resolve(RENDERER_ROOT, '../../../docs/STYLE_GUIDE.md'), 'utf8')
    expect(guide).toMatch(/The two Source time boxes are ONE form, decided by the PAIR \(`overlayTimePair`/)
    expect(guide).toMatch(/when\s+EITHER is one hour or more BOTH show the clock/)
    expect(guide).not.toMatch(/A time shown at rest in a box is the seconds the card line says/)
    const overlay = readFileSync(path.resolve(RENDERER_ROOT, '../../shared/textOverlay.ts'), 'utf8')
    expect(overlay).not.toMatch(/never speaks two forms/)
    expect(overlay).toMatch(/are\s+\/\/ two pairs, each coherent in itself/)
    const main = readFileSync(MAIN_INDEX_FOR_T131, 'utf8')
    expect(main).toMatch(/NOT a Windows shutdown, restart or logoff/)
    expect(main).toMatch(/Electron emits\s+\/\/ no `before-quit` for those/)
    expect(main, 'the old claim is gone').not.toMatch(/an OS session\s+end/)
  })

  // ── (5) every picker whose first await is a native dialog is claim-first ──────────────────────────────────────────────────────────
  // T-126 (19) and T-127 (11) fixed the start handlers and left the pickers "pin-only: the first await is a native dialog". That rationale was
  // disproven by execution (two choosers from one double-click on Importer, AudioImporter, a role button, PipPanel, Home, the folder chip).
  // The scan finds every renderer call of a bridge function that opens a native chooser, names its enclosing function, and holds the set to a
  // table: a new picker fails here until it is decided, and one under `claimFirst` is checked to be under the claim it names.
  const DIALOG_CALL = /^window\.api\.(?:video\.pickFile|audio\.pickFile|video\.pickOutputDir|project\.save|project\.load)$/

  interface Site {
    file: string
    fn: string
    call: string
    /** The flag of the `claimFirst(flag, ...)` call this call sits under, or null. */
    claim: string | null
  }

  function enclosingFunction(n: ts.Node): string {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name) return p.name.text
      if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text
    }
    return '<module>'
  }

  /** Every call of a dialog-opening bridge function in `text`, with the function it is in and the `claimFirst` flag above it. */
  function dialogSites(text: string, file: string): Site[] {
    const sf = parseSource(file, text)
    const out: Site[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && DIALOG_CALL.test(n.expression.getText(sf))) {
        let claim: string | null = null
        for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
          if (ts.isCallExpression(p) && p.expression.getText(sf) === 'claimFirst') {
            claim = p.arguments[0]?.getText(sf) ?? null
            break
          }
        }
        out.push({ file, fn: enclosingFunction(n), call: n.expression.getText(sf).replace('window.api.', ''), claim })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return out
  }

  /** What is decided for every site: under `claimFirst(<flag>)`, or protected by the start handler's own claim (pinned by the singleFlight tests above). */
  const DECIDED: Array<[string, string, string, string]> = [
    ['modules/video-studio/Importer.tsx', 'onPickFile', 'video.pickFile', 'pickingRef'],
    ['modules/video-studio/PipPanel.tsx', 'pick', 'video.pickFile', 'pickingRef'],
    ['modules/audio-studio/AudioImporter.tsx', 'onPickFile', 'audio.pickFile', 'pickingRef'],
    ['modules/audio-studio/SecondaryTrackPanel.tsx', 'pickAndAdd', 'audio.pickFile', 'pickingRef'],
    ['modules/video-studio/ExportPanel.tsx', 'pickOutDir', 'video.pickOutputDir', 'pickingDirRef'],
    ['hooks/useVideoOutputDir.ts', 'pickOutputDir', 'video.pickOutputDir', 'choosing'],
    ['routes/Home.tsx', 'handleSave', 'project.save', 'projectDialog'],
    ['routes/Home.tsx', 'handleLoad', 'project.load', 'projectDialog'],
    // The start handlers that ask for the folder when none is chosen: claim-first themselves (T-125 (18), T-126 (19)); the Clip Kit and
    // Export starts are in the two singleFlight tables above, and `resolveOutputDir` is called only from the four panels' start handlers.
    ['modules/video-studio/ExportPanel.tsx', 'startExport', 'video.pickOutputDir', ''],
    ['modules/video-studio/ClipKitButton.tsx', 'runKit', 'video.pickOutputDir', ''],
    ['hooks/useVideoOutputDir.ts', 'resolveOutputDir', 'video.pickOutputDir', '']
  ]

  it('(5) every native-chooser call in the renderer is decided, and each picker is under its claim', () => {
    const found = sourceFilesUnder(RENDERER_ROOT).flatMap((f) => dialogSites(readFileSync(f, 'utf8'), f).map((site) => ({ ...site, file: path.relative(RENDERER_ROOT, f).split(path.sep).join('/') })))
    const key = (file: string, fn: string, call: string): string => `${file} ${fn} ${call}`
    expect(found.map((x) => key(x.file, x.fn, x.call)).sort(), 'a new picker is decided here, in the commit that adds it').toEqual(
      DECIDED.map(([file, fn, call]) => key(file, fn, call)).sort()
    )
    for (const [file, fn, call, flag] of DECIDED) {
      const site = found.find((x) => x.file === file && x.fn === fn && x.call === call)
      if (flag === '') expect(site?.claim, `${file}: ${fn} holds its own start claim, not claimFirst`).toBeNull()
      else expect(site?.claim, `${file}: ${fn} opens ${call} under claimFirst(${flag}, ...)`).toBe(flag)
    }
  })

  it('(5) each flag is a hook or a module object declared once, and the shape is discriminated: a bare call and a late claim are not under the claim', () => {
    for (const [rel, decl] of [
      ['modules/video-studio/Importer.tsx', 'const pickingRef = useRef(false)'],
      ['modules/video-studio/PipPanel.tsx', 'const pickingRef = useRef(false)'],
      ['modules/audio-studio/AudioImporter.tsx', 'const pickingRef = useRef(false)'],
      ['modules/audio-studio/SecondaryTrackPanel.tsx', 'const pickingRef = useRef(false)'],
      ['modules/video-studio/ExportPanel.tsx', 'const pickingDirRef = useRef(false)'],
      ['hooks/useVideoOutputDir.ts', 'const choosing = { current: false }'],
      ['routes/Home.tsx', 'const projectDialog = { current: false }']
    ] as const) {
      const code = strip(read(rel))
      expect(code.split(decl).length - 1, `${rel}: ${decl}`).toBe(1)
      // A component's ref is a hook: declared ahead of any early `return null`.
      const early = code.indexOf('if (!source) return null')
      if (decl.includes('useRef') && early !== -1) expect(code.indexOf(decl), `${rel}: declared before the early return`).toBeLessThan(early)
    }
    const good = 'async function f() { await claimFirst(r, async () => { const p = await window.api.video.pickFile() }) }'
    const bare = 'async function f() { const p = await window.api.video.pickFile() }'
    const other = 'async function f() { await claimFirst(a, async () => 1); const p = await window.api.audio.pickFile() }'
    expect(dialogSites(good, 'x.tsx').map((x) => x.claim)).toEqual(['r'])
    expect(dialogSites(bare, 'x.tsx').map((x) => x.claim)).toEqual([null])
    expect(dialogSites(other, 'x.tsx').map((x) => x.claim), 'a claim on something else does not cover the call after it').toEqual([null])
    expect(dialogSites('async function f() { await window.api.video.startSomething() }', 'x.tsx')).toEqual([])
  })
})

// T-133 (9): five buttons (the autosave banner's Restore and its two Clear, the video Importer's and the audio Importer's "Choose file…") were
// `disabled` and drew exactly like live ones - `btn-primary` / `btn-ghost` have no disabled look of their own - while three comments, an E2E and
// the ledger said "every other disabled button carries `disabled:opacity-50`". Importer's label does not even change while it is busy. The claim
// is a scan now: a `<button disabled=...>` whose className has no `disabled:opacity-*` fails here, with its file and line.
// E2E: video-pipelines.spec.ts "the video Importer's Choose file is dimmed while a file is loading" and home-chrome.spec.ts for the banner.
describe('every disabled button looks disabled (T-133 (9))', () => {
  /** Every `<button>` that takes a `disabled` prop: where it is, and whether its className carries a `disabled:opacity-*`. */
  function disabledButtons(code: string, file: string): Array<{ where: string; dimmed: boolean }> {
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const found: Array<{ where: string; dimmed: boolean }> = []
    function visit(node: ts.Node): void {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === 'button') {
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute)
        if (attrs.some((a) => a.name.getText(sf) === 'disabled')) {
          const className = attrs.find((a) => a.name.getText(sf) === 'className')?.initializer?.getText(sf) ?? ''
          found.push({ where: `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`, dimmed: /disabled:opacity-\d+/.test(className) })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return found
  }
  const undimmed = (code: string): string[] => disabledButtons(code, 'x.tsx').filter((b) => !b.dimmed).map((b) => b.where)

  const all = sourceFilesUnder(RENDERER_ROOT)
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => disabledButtons(readFileSync(f, 'utf8'), path.relative(RENDERER_ROOT, f)))

  it('finds the buttons to check (a scan that matched nothing would look like a clean tree)', () => {
    expect(all.length).toBeGreaterThan(40)
  })

  it('no disabled button in the renderer draws like a live one', () => {
    expect(all.filter((b) => !b.dimmed).map((b) => b.where)).toEqual([])
  })

  it('discriminates: a bare disabled button, a self-closing one and a conditional className are judged', () => {
    expect(undimmed('const a = <button className="btn-ghost" disabled={busy}>x</button>')).toEqual(['x.tsx:1'])
    expect(undimmed('const a = <button disabled>x</button>')).toEqual(['x.tsx:1'])
    expect(undimmed('const a = <button className="btn-ghost disabled:opacity-50" disabled={busy}>x</button>')).toEqual([])
    expect(undimmed('const a = <button className={`btn-ghost ${on ? "ring-2" : ""} disabled:opacity-40`} disabled={busy} />')).toEqual([])
    expect(undimmed('const a = <button className="btn-ghost" onClick={go}>x</button>'), 'a button that cannot be disabled is not judged').toEqual([])
    expect(undimmed('const a = <div className="btn-ghost" disabled={busy} />'), 'only a <button> is').toEqual([])
  })
})

// T-133 (7): the repeat family's boundary, wired where the person reaches it. E2E: home-chrome.spec.ts "a held Enter on the tour's Done closes it
// once: the repeats do not reopen it" and "a held ? toggles the shortcuts once", video-core.spec.ts "a held Space plays once".
describe('T-133 (7) — a held key is one decision, and a key held through a closing dialog does not act under it', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('(a) the close of any dialog arms the held-key guard, and the guard listens from the moment the module loads (it has to SEE the key go down)', () => {
    const lib = strip(read('lib/repeatPress.ts'))
    const swallow = lib.slice(lib.indexOf('export function swallowRepeatClicks'))
    expect(swallow, 'swallowRepeatClicks arms it').toMatch(/heldKeys\.dialogClosed\(\)/)
    // Capture phase on the window, ahead of React's listeners, and installed at load rather than inside swallowRepeatClicks.
    const moduleLevel = lib.slice(lib.indexOf("if (typeof window !== 'undefined')"), lib.indexOf('let swallowUntil'))
    expect(moduleLevel).toMatch(/addEventListener\(\s*'keydown',[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?preventDefault\(\)[\s\S]*?true\s*\)/)
    expect(moduleLevel).toMatch(/addEventListener\('keyup'/)
    expect(moduleLevel).toMatch(/addEventListener\('blur'/)
    // The two dialog closers that matter are the ones that call it: Modal (every dialog, the FixWizard included) and the tour.
    expect(strip(read('components/Modal.tsx'))).toMatch(/swallowRepeatClicks\(\)/)
    expect(strip(read('components/Tutorial.tsx'))).toMatch(/useEffect\(\(\) => swallowRepeatClicks, \[\]\)/)
  })

  it('(b) Space toggles play on the press only, in the Player and on the Timeline; the nudge and frame-step keys still repeat by design', () => {
    const player = strip(read('modules/video-studio/Player.tsx'))
    const playerSpace = player.slice(player.indexOf("case ' ':"), player.indexOf("case 'ArrowLeft':"))
    expect(playerSpace).toMatch(/e\.preventDefault\(\)\s*if \(!e\.repeat\) togglePlay\(\)/)
    // T-134 (2): the I / O markers joined Space as one decision per press (their own pin is in the T-134 block below); what repeats is the
    // arrows, `,` and `.`.
    const playerRest = player.slice(player.indexOf("case 'ArrowLeft':"), player.indexOf("case 'i':"))
    expect(playerRest, 'the arrows, , and . are not guarded').not.toMatch(/repeat/)
    const timeline = strip(read('modules/video-studio/Timeline.tsx'))
    const timelineSpace = timeline.slice(timeline.indexOf("case ' ':"), timeline.indexOf("case 'ArrowLeft':"))
    expect(timelineSpace).toMatch(/e\.preventDefault\(\)\s*if \(!e\.repeat\) useVideoStore\.getState\(\)\.transport\?\.togglePlay\(\)\s*return/)
    expect(timeline.slice(timeline.indexOf("case 'ArrowLeft':"), timeline.indexOf("case 'i':")), 'nor the Timeline\'s').not.toMatch(/repeat/)
  })

  it('(b) the ? overlay hands the event\'s repeat flag to its predicate', () => {
    expect(strip(read('components/HotkeyOverlay.tsx'))).toMatch(/overlayOpen: open,\s*repeat: e\.repeat/)
  })
})

// T-133 (1): the toast's way off the Record screen cut a LIVE TAKE short (T-132 (1)'s own fix put "Open Audio Studio" in an 8 s toast over the REC
// screen; the saved-file toasts' "Edit in Video Studio" is the same family). Every way off asks the Home link's question through ONE function.
// E2E: record.spec.ts "a toast's way off the Record screen asks first while a take is live".
describe('T-133 (1) — every way off the Record screen asks about a live take', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('Record registers the take while its phase is "recording", and its Home link asks through the same function (no copy of the question)', () => {
    const studio = strip(read('modules/record-studio/RecordStudio.tsx'))
    expect(studio).toMatch(/useEffect\(\(\) => \{\s*if \(phase !== 'recording'\) return\s*return registerLiveTake\(stopRecording\)\s*\}, \[phase\]\)/)
    expect(studio).toMatch(/onClickCapture=\{\(e\) => \{\s*if \(mayLeaveLiveTake\(\)\) return\s*e\.preventDefault\(\)\s*e\.stopPropagation\(\)\s*\}\}/)
    expect(studio, 'the Home link\'s own copy of the question is gone').not.toMatch(/A recording is in progress/)
    expect(strip(read('lib/liveTake.ts'))).toMatch(/export const LIVE_TAKE_MESSAGE =\s*'A recording is in progress\. Stop and save it before leaving\? \(Cancel keeps recording\.\)'/)
  })

  it('"Edit in Video Studio" asks first, ahead of the replace-the-video question and before anything loads or navigates', () => {
    const hook = strip(read('lib/editInVideoStudio.ts'))
    const body = hook.slice(hook.indexOf('return async function editInVideoStudio'))
    expect(body).toMatch(/if \(!mayLeaveLiveTake\(\)\) return/)
    expect(body.indexOf('mayLeaveLiveTake()')).toBeLessThan(body.indexOf('videoDiscardMessage('))
    expect(body.indexOf('mayLeaveLiveTake()')).toBeLessThan(body.indexOf('await loadVideoSource('))
    expect(body.indexOf('mayLeaveLiveTake()')).toBeLessThan(body.indexOf("navigate('/video')"))
  })

  it('every navigate() that a toast button (or a completion that outlives its screen) can run asks about the take, or is the screen\'s own', () => {
    // The renderer's navigate() calls, decided: a new one fails until it is decided here.
    const calls: Record<string, number> = {}
    for (const file of sourceFilesUnder(RENDERER_ROOT).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
      const n = strip(readFileSync(file, 'utf8')).match(/\bnavigate\(/g)?.length ?? 0
      if (n > 0) calls[path.relative(RENDERER_ROOT, file).split(path.sep).join('/')] = n
    }
    expect(calls).toEqual({
      // Asset Library "drop to canvas": the person is on References, pressing a button on the screen, and the drop is synchronous (no await between the
      // press and the navigate); no take can be live there.
      'modules/references/AssetLibraryPanel.tsx': 1,
      // Mood board "→ Canvas": the same click, but the navigate runs after an AWAIT (the picture's load, a network fetch when the tile fell back to the URL
      // it came from), so "the person is on References" is a premise of the click and false at the navigate - the table blessed it as the screen's own
      // until the twenty-first sweep (T-135 (13)). It goes only if `currentRoute()` is still /references (pinned in the T-135 block at the end of this file).
      'modules/references/MoodBoardPanel.tsx': 1,
      // The autosave Restore: its click is on Home, but its navigate runs after an apply that can take MINUTES (a sound extracted again), so "it is
      // on Home" is a premise of the click and false at the navigate. It asks where the person is NOW and goes only if that is still Home (T-134
      // (1), pinned in the T-134 block at the end of this file); this table blessed it as "on Home" until the twentieth sweep ran a take through it.
      'components/AutosaveRestore.tsx': 1,
      // Clean audio: the stay-here branch (the person is on /video) and the toast's button, which asks (below).
      'modules/video-studio/VideoStudio.tsx': 2,
      // The "Edit in Video Studio" bridge, which asks first (above).
      'lib/editInVideoStudio.ts': 1
    })
  })
})

// T-134 (1), (2), (7): the twentieth sweep's wiring, where the person reaches it. E2E: record.spec.ts "an autosave Restore that finishes after the person
// went to another screen leaves them there (T-134 (1))"; video-core.spec.ts "a held I or O marks once ..."; continuity.spec.ts "Clear does not relabel Restore".
describe('T-134 — a Restore that outlasts the person does not move them, a held marker key is one mark, Clear does not relabel Restore', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const restoreSrc = (): string => strip(read('components/AutosaveRestore.tsx'))
  const restoreBody = (): string => {
    const src = restoreSrc()
    return src.slice(src.indexOf('async function restore()'), src.indexOf('async function clearAutosave()'))
  }

  it('(1) Restore navigates only if the person is STILL on Home when the apply finishes - the router location is read after the await, off the hash', () => {
    const body = restoreBody()
    expect(body, 'found the function').toContain('await applyProjectHeld(snapshot.project)')
    expect(body).toMatch(/const route = snapshot\.project\.place\?\.route\s*if \(route && currentRoute\(\) === '\/home'\) navigate\(route\)/)
    expect(body.indexOf('await applyProjectHeld('), 'asked AFTER the wait, not before it').toBeLessThan(body.indexOf('currentRoute()'))
    expect(restoreSrc()).toMatch(/import \{[^}]*\bcurrentRoute\b[^}]*\} from '\.\.\/modules\/project\/ProjectIO'/)
    // The renderer's navigate() table (T-133 (1)) names this site as the screen's own only while the guard is there.
    expect(restoreSrc().match(/\bnavigate\(/g) ?? []).toHaveLength(1)
  })

  it('(7) Restore and Clear each have their own busy flag: only Restore\'s sets the "Restoring…" label', () => {
    const src = restoreSrc()
    expect(src).toMatch(/const \[restoring, setRestoring\] = useState\(false\)/)
    expect(src).toMatch(/const \[clearing, setClearing\] = useState\(false\)/)
    expect(src, 'no shared flag is left').not.toMatch(/\bsetBusy\b/)
    const label = src.slice(src.indexOf('btn-primary'), src.indexOf('Clear\n', src.indexOf('btn-primary')))
    expect(label).toMatch(/\{restoring \? 'Restoring…' : 'Restore'\}/)
    const clearFn = src.slice(src.indexOf('async function clearAutosave()'), src.indexOf('const ageText'))
    expect(clearFn, 'Clear runs on its own flag').toMatch(/setClearing\(true\)[\s\S]*setClearing\(false\)/)
    expect(clearFn, 'and never touches Restore\'s').not.toMatch(/setRestoring/)
    expect(restoreBody(), 'nor Restore Clear\'s').not.toMatch(/setClearing/)
    // Either running dims all of the banner's buttons that act on the file: one at a time, as before.
    expect(src.match(/disabled=\{restoring \|\| clearing\}/g) ?? [], 'Restore and Clear in the healthy banner, Clear in the damaged one').toHaveLength(3)
  })

  it('(2) I and O mark on the press only, in the Player and on the Timeline - a held key is one undo step and one point, not the keyboard\'s repeat rate', () => {
    const player = strip(read('modules/video-studio/Player.tsx'))
    const playerKeys = player.slice(player.indexOf("case 'i':"), player.indexOf('default:', player.indexOf("case 'i':")))
    expect(playerKeys).toMatch(/case 'i':\s*case 'I':\s*e\.preventDefault\(\)\s*if \(!e\.repeat\) setMarker\('in'\)\s*break/)
    expect(playerKeys).toMatch(/case 'o':\s*case 'O':\s*e\.preventDefault\(\)\s*if \(!e\.repeat\) setMarker\('out'\)\s*break/)
    const timeline = strip(read('modules/video-studio/Timeline.tsx'))
    const timelineKeys = timeline.slice(timeline.indexOf("case 'i':"), timeline.indexOf('default:', timeline.indexOf("case 'i':")))
    expect(timelineKeys).toMatch(/case 'i':\s*case 'I':\s*e\.preventDefault\(\)\s*if \(!e\.repeat\) setMarker\('in'\)\s*return/)
    expect(timelineKeys).toMatch(/case 'o':\s*case 'O':\s*e\.preventDefault\(\)\s*if \(!e\.repeat\) setMarker\('out'\)\s*return/)
  })

  it('(5) a custom preset\'s name is capped in its box, cut with an ellipsis (and carried whole as the tooltip) in its row, and the safe-zone warning cuts a clip name the same way', () => {
    const manager = strip(read('modules/video-studio/CustomPresetManager.tsx'))
    expect(manager).toMatch(/const PRESET_NAME_MAX = 60/)
    expect(manager).toMatch(/aria-label="Custom preset name"/)
    const nameBox = manager.slice(manager.lastIndexOf('<input', manager.indexOf('aria-label="Custom preset name"')), manager.indexOf('aria-label="Custom preset name"'))
    expect(nameBox, 'the cap is on the input itself').toMatch(/maxLength=\{PRESET_NAME_MAX\}/)
    const row = manager.slice(manager.indexOf('{presets.map((p) => ('), manager.indexOf('</ul>', manager.indexOf('{presets.map((p) => (')))
    expect(row).toMatch(/<span className="font-medium min-w-0 truncate" title=\{p\.name\}>/)
    expect(row, 'the numbers do not give way').toMatch(/<span className="text-xs text-ink-dim font-mono shrink-0">/)
    expect(row, 'and neither does Delete').toMatch(/className="ml-auto shrink-0 text-ink-dim hover:text-danger text-xs"/)
    const warning = strip(read('modules/video-studio/SafeZoneWarningModal.tsx'))
    expect(warning).toMatch(/<span className="font-medium block truncate" title=\{row\.clipName\}>/)
  })
})

// T-135: the twenty-first sweep's wiring, where the person reaches it. E2E per item: references.spec.ts "→ Canvas that finishes after the person went
// to another screen ... (T-135 (13))".
describe('T-135 — the twenty-first sweep', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('(13) → Canvas navigates only if the person is STILL on References when the picture has loaded - the route is read after the await', () => {
    const src = strip(read('modules/references/MoodBoardPanel.tsx'))
    const fn = src.slice(src.indexOf('async function sendToCanvas'), src.indexOf('useEffect(() => {'))
    expect(fn, 'found the function').toContain('await loadImageDimensions(src)')
    expect(fn).toMatch(/if \(currentRoute\(\) === '\/references'\) navigate\('\/image'\)/)
    expect(fn.indexOf('await loadImageDimensions('), 'asked AFTER the wait, not before it').toBeLessThan(fn.indexOf('currentRoute()'))
    expect(src).toMatch(/import \{ currentRoute \} from '\.\.\/project\/ProjectIO'/)
    // The layer and the toast are not behind the guard: the add is reported wherever the person is.
    expect(fn.indexOf('addCanvasLayer('), 'the layer is added before the route is asked').toBeLessThan(fn.indexOf('currentRoute()'))
    expect(fn.indexOf('toast.success('), 'and so is the toast').toBeLessThan(fn.indexOf('currentRoute()'))
    expect(src.match(/\bnavigate\(/g) ?? [], 'the navigate() table (T-133 (1)) counts one site here').toHaveLength(1)
  })

  it('(6) each zone line of the safe-zone warning is cut with an ellipsis and carries the whole line as its tooltip (a custom preset\'s name is in it)', () => {
    const warning = strip(read('modules/video-studio/SafeZoneWarningModal.tsx'))
    expect(warning).toMatch(/<div key=\{zone\} className="text-ink-muted truncate" title=\{zone\}>/)
    // The clip-name span (T-134 (5)) is still cut the same way.
    expect(warning).toMatch(/<span className="font-medium block truncate" title=\{row\.clipName\}>/)
  })

  it('(5) the Search button is off only for the question that is already out, and the input starts as the query the grid answers', () => {
    const refs = strip(read('modules/references/ReferencePanel.tsx'))
    expect(refs, 'the input is seeded from the store on mount').toMatch(/useState\(\(\) => useReferencesStore\.getState\(\)\.searchQuery\)/)
    expect(refs).toMatch(/const sameQueryOut = loading && query === inFlightQuery/)
    expect(refs).toMatch(/onClick=\{submit\} disabled=\{sameQueryOut\}/)
    expect(refs, 'not off for a different question').not.toMatch(/disabled=\{loading\}/)
    const store = strip(read('modules/references/state/referencesStore.ts'))
    expect(store, 'the query is named when the request goes out').toMatch(/set\(\{ searchLoading: true, searchError: null, searchQuery: query \}\)/)
    expect(store, 'and the store\'s own refusal reads the same field').toMatch(/get\(\)\.searchLoading && query === get\(\)\.searchQuery/)
  })

  it('(8) a board\'s name is capped by ONE number (shared with main) on the three boxes that take it, and the first-save dialog closes only once the board exists', () => {
    const shared = strip(read('../../shared/search.ts'))
    expect(shared).toMatch(/export const MAX_BOARD_NAME = 200/)
    const main = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/search.ts'), 'utf8'))
    expect(main, 'main reads the shared number').toMatch(/import \{ MAX_BOARD_NAME, validateSearchResult \} from '\.\.\/\.\.\/shared\/search'/)
    expect(main, 'and has no copy of it').not.toMatch(/MAX_BOARD_NAME = \d+/)
    const board = strip(read('modules/references/MoodBoardPanel.tsx'))
    expect(board).toMatch(/placeholder="New board name…"\s*maxLength=\{MAX_BOARD_NAME\}/)
    expect(board).toMatch(/confirmLabel="Rename"\s*maxLength=\{MAX_BOARD_NAME\}/)
    const refs = strip(read('modules/references/ReferencePanel.tsx'))
    expect(refs).toMatch(/confirmLabel="Create & save"\s*maxLength=\{MAX_BOARD_NAME\}/)
    expect(strip(read('components/NameDialog.tsx'))).toMatch(/aria-label=\{label\}\s*maxLength=\{maxLength\}/)
    // The picture and the dialog are kept until the create has landed: nothing clears `pendingResult` ahead of the await.
    const fn = refs.slice(refs.indexOf('async function createBoardAndSave'), refs.indexOf('return (', refs.indexOf('async function createBoardAndSave')))
    expect(fn.indexOf('await createCollection('), 'found the create').toBeGreaterThan(-1)
    expect(fn.indexOf('setPendingResult(null)'), 'the dialog is closed AFTER the create, not before it').toBeGreaterThan(fn.indexOf('await createCollection('))
    expect(fn, 'one press makes one board').toMatch(/await claimFirst\(creatingRef,/)
    // Rename keeps its dialog until the rename has landed, behind the same claim.
    const rename = board.slice(board.indexOf('async function onRename'), board.indexOf('async function onDelete'))
    expect(rename).toMatch(/await claimFirst\(renamingRef,/)
    expect(rename.indexOf('setRenaming(false)\n    })'), 'closed after the write').toBeGreaterThan(rename.indexOf('await renameCollection('))
  })

  it('(2) the Player hears the element\'s own verdicts on the picture, follows play() instead of assuming it, and offers a preview copy through the importer\'s convert', () => {
    const player = strip(read('modules/video-studio/Player.tsx'))
    // Both signals: the `error` event (codes 3 and 4 only) and the metadata tell (width 0 for a file ffprobe says has a picture).
    expect(player).toMatch(/onLoadedMetadata=\{onLoadedMetadata\}\s*onError=\{onElementError\}/)
    expect(player).toMatch(/if \(code === 3 \|\| code === 4\) setNoPicture\(true\)/)
    expect(player).toMatch(/source\.probe\.width > 0 && v\.videoWidth === 0\) setNoPicture\(true\)/)
    // togglePlay: no optimistic `setPlaying(true)`; the rejection is handled; the element's play / pause events own the flag.
    const toggle = player.slice(player.indexOf('function togglePlay()'), player.indexOf('function onElementError('))
    expect(toggle).toMatch(/v\.play\(\)\.catch\(\(err: unknown\) => \{/)
    expect(toggle).toMatch(/err\.name === 'NotSupportedError'\) setNoPicture\(true\)/)
    expect(toggle, 'no hopeful flip to Pause').not.toMatch(/setPlaying\(true\)/)
    expect(toggle, 'and no bare void play()').not.toMatch(/void v\.play\(\)/)
    expect(player).toMatch(/onPlay=\{\(\) => setPlaying\(true\)\}/)
    // The element plays the copy when there is one; the copy is made by the importer's own convert and stored for the video it was made for, one at a time.
    expect(player).toMatch(/src=\{previewUrl \?\? source\.url\}/)
    const copy = player.slice(player.indexOf('async function makePreviewCopy()'), player.indexOf('function nudge('))
    expect(copy).toMatch(/await claimFirst\(copyingRef,/)
    expect(copy).toMatch(/await window\.api\.video\.convertForImport\(startedFor\)/)
    // T-136 (2): the playhead travels with the copy into the store (it was the unmounted instance's ref), read AFTER the wait.
    expect(copy).toMatch(/useVideoStore\.getState\(\)\.setPreviewCopyFor\(startedFor, copyPath, resumeAt\)/)
    expect(copy).toMatch(/reportFailure\(err, \{ failed: "Couldn't make a preview copy\.", canceled: 'Preview copy canceled\.' \}\)/)
    expect(player).toMatch(/\{PREVIEW_UNAVAILABLE_MESSAGE\}/)
    // The README promises only what the preview decodes.
    const readme = readFileSync(path.resolve(RENDERER_ROOT, '../../../README.md'), 'utf8')
    expect(readme).not.toMatch(/H\.264, H\.265, VP9, ProRes, AV1 in any common container should work/)
    expect(readme).toMatch(/imagii reads H\.264, H\.265, VP9, ProRes and AV1/)
  })

  // (1): a long job's busy flag and handle outlive the screen that started it. E2E: video-pipelines.spec.ts "a job that is running when the person
  // leaves the studio is still running, with its Cancel, when they come back" (one case per panel), audio.spec.ts "an audio export that is running ...".
  it.each([
    ['modules/video-studio/GifPanel.tsx', 'useGifRun', 'exportGif'],
    ['modules/video-studio/CompilationPanel.tsx', 'useCompileRun', 'exportCompilation'],
    ['modules/video-studio/PipPanel.tsx', 'usePipRun', 'run'],
    ['modules/video-studio/ReframePanel.tsx', 'useReframeRun', 'reframe'],
    ['modules/video-studio/HighlightPanel.tsx', 'useScanRun', 'scan'],
    ['modules/video-studio/CaptionsPanel.tsx', 'useCaptionsRun', 'transcribe'],
    ['modules/video-studio/ClipKitButton.tsx', 'useKitRun', 'runKit'],
    ['modules/video-studio/VideoStudio.tsx', 'useCleanAudioRun', 'cleanAudioFlow']
  ])('(1) %s holds its job in %s, claimed at the start and given back in a finally - not in the panel\'s state', (rel, store, fn) => {
    const src = strip(read(rel))
    expect(src, 'reads the run from the module store').toMatch(new RegExp(`${store}\\(\\(s\\) => s\\.run`))
    const body = src.slice(src.indexOf(`function ${fn}(`))
    expect(body, 'the run is claimed with begin()').toMatch(new RegExp(`${store}\\.getState\\(\\)\\.begin\\(`))
    expect(body, 'and given back with end() in a finally').toMatch(new RegExp(`finally \\{\\s*(?:useCaptionsProgress\\.setState\\(\\{ progress: null \\}\\)\\s*)?${store}\\.getState\\(\\)\\.end\\(\\)`))
    // None of the component-state spellings this replaced.
    expect(src).not.toMatch(/\bset(Busy|Running|Scanning|ExtractingAudio|Job)\(/)
    expect(src).not.toMatch(/\bjobIdRef\b/)
    expect(src).not.toMatch(/\bcanceledRef\b/)
  })

  it('(1) the Export panel draws the queue store and hands the batch to it: no rows or running flag of its own, no listeners of its own', () => {
    const panel = strip(read('modules/video-studio/ExportPanel.tsx'))
    expect(panel).toMatch(/useExportQueue\(\(s\) => s\.jobs\)/)
    expect(panel).toMatch(/useExportQueue\(\(s\) => s\.running\)/)
    expect(panel).not.toMatch(/\bset(Jobs|Running)\(/)
    expect(panel, 'its rows are drawn while a batch runs or for the video they were made from, never under another one').toMatch(/\(running \|\| queueSource === source\?\.filePath\)/)
    expect(panel, 'the progress and completion listeners are the batch\'s').not.toMatch(/window\.api\.video\.on(Progress|JobComplete)/)
    const queue = strip(read('modules/video-studio/store/exportQueue.ts'))
    expect(queue).toMatch(/const offProgress = window\.api\.video\.onProgress\(/)
    expect(queue).toMatch(/const offDone = window\.api\.video\.onJobComplete\(/)
    expect(queue, 'the listeners come off in the finally').toMatch(/finally \{\s*offProgress\(\)\s*offDone\(\)\s*useExportQueue\.getState\(\)\.finish\(\)/)
  })

  it('(1) Captions: the progress line main sends is its own store (the row draws what main reports), emptied when a job starts and when it ends', () => {
    const src = strip(read('modules/video-studio/CaptionsPanel.tsx'))
    expect(src).toMatch(/const progress: CaptionsProgress \| null = useCaptionsProgress\(\(s\) => s\.progress\)/)
    expect(src).toMatch(/window\.api\.captions\.onProgress\(\(p\) => useCaptionsProgress\.setState\(\{ progress: p \}\)\)/)
    expect(src.match(/useCaptionsProgress\.setState\(\{ progress: null \}\)/g) ?? [], 'cleared at the start and at the end of both jobs').toHaveLength(4)
    expect(strip(read('modules/video-studio/store/runs.ts'))).toMatch(/export const useCaptionsRun = createRunStore<\{ job: 'transcribe' \| 'burn-in' \}>\(\)/)
  })

  it('(1) the audio export dialog draws the audio export store and registers its progress listener for the length of its own export', () => {
    const dialog = strip(read('modules/audio-studio/ExportDialog.tsx'))
    expect(dialog).toMatch(/useAudioExport\(\(s\) => s\.running\)/)
    expect(dialog).not.toMatch(/\bset(Job|Running)\(/)
    expect(dialog, 'no effect-scoped listener').not.toMatch(/useEffect/)
    expect(dialog).toMatch(/const offProgress = window\.api\.audio\.onProgress\(/)
    expect(dialog).toMatch(/finally \{\s*offProgress\(\)\s*useAudioExport\.getState\(\)\.finish\(\)/)
  })

  it('(1) Clip Kit\'s run is shown wherever the kit button is, whichever clip is selected, with its Cancel (T-136 (1) replaced "one clip\'s row": the list draws ONE button)', () => {
    const kit = strip(read('modules/video-studio/ClipKitButton.tsx'))
    expect(kit, 'the clip-keyed reading is gone').not.toMatch(/kitRun\.clipId === clip\.id|kitRun\.clipId !== clip\.id|otherKitRunning/)
    expect(kit, 'the button is off, and shows the running label, for ANY run').toMatch(/disabled=\{kitRun !== null\}/)
    expect(kit).toMatch(/\{kitRun !== null \? kitRun\.phase \|\| 'Working…' : `Clip Kit/)
    expect(kit).toMatch(/begin\(\{ clipId: clip\.id, clipName: clip\.name, phase: '', canceled: false \}\)/)
    // The cancel latch is the run's field, set by the confirm and read by every step.
    expect(kit).toMatch(/useKitRun\.getState\(\)\.patch\(\{ canceled: true \}\)/)
    expect(kit).toMatch(/if \(useKitRun\.getState\(\)\.run\?\.canceled\) throw new CancelledError\(\)/)
  })

  it('(1) main refuses a second audio extraction, claimed before the handler\'s first await and given back in a finally', () => {
    const audio = strip(readFileSync(path.resolve(RENDERER_ROOT, '../../main/ipc/audio.ts'), 'utf8'))
    const handler = audio.slice(audio.indexOf("ipcMain.handle('audio:extractFromVideo'"), audio.indexOf('async function extractSound('))
    expect(handler).toMatch(/assertSafeAbsolutePath\(videoPath, 'audio:extractFromVideo videoPath'\)\s*if \(extractingFor !== null\) throw new Error\(extractionBusyMessage\(extractingFor\)\)\s*extractingFor = videoPath\s*try \{\s*return await extractSound\(videoPath\)\s*\} finally \{\s*extractingFor = null\s*\}/)
  })

  it('(4) the scan\'s candidates, both pasted chat logs, the spikes and the transcript preview are read from the video store, written to it, and reset by nothing in the panels', () => {
    for (const [rel, reads] of [
      ['modules/video-studio/HighlightPanel.tsx', ['derived.scanCandidates', 'derived.highlightChat']],
      ['modules/video-studio/ChatHighlightPanel.tsx', ['derived.spikeChat', 'derived.spikes']],
      ['modules/video-studio/CaptionsPanel.tsx', ['derived.transcript']]
    ] as const) {
      const src = strip(read(rel))
      for (const field of reads) expect(src, `${rel} reads ${field}`).toContain(`s.${field}`)
      expect(src, `${rel} keeps no copy of them`).not.toMatch(/useState<(AudioCandidate|ChatPeak|CaptionSegment)\[\]/)
      expect(src, `${rel} resets nothing on mount`).not.toMatch(/useEffect\(\(\) => \{\s*set(AudioCandidates|ChatText|Peaks|Segments)\(/)
    }
  })
})

// T-136 Track A: the twenty-second sweep's wiring, where the person reaches it. E2E per item (video-pipelines.spec.ts, "T-136 (n): ..."): (1) three
// cases (another clip selected, the owning clip removed, the video closed); (2) the importer after a trip to Home, a video opened during a conversion,
// the preview copy after a trip to Home and the preview copy finished while away; (4) the model download across a trip to Home and its end;
// (6) the Output preview. (3) is unit-tested with a fake clock (useAutosave.test.ts). Item (7)'s scan is runningJobControls.test.ts.
describe('T-136 Track A — the twenty-second sweep', () => {
  // JSX comments first (`{/* ... */}`), then block and line comments: in the other order a JSX comment leaves an empty `{}` behind.
  const strip = (text: string): string => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const readMain = (rel: string): string => readFileSync(path.resolve(RENDERER_ROOT, '../../main', rel), 'utf8')

  it('(1) the kit is drawn by whoever holds the run: any clip\'s button, and beside the importer once the video is closed', () => {
    const kit = strip(read('modules/video-studio/ClipKitButton.tsx'))
    // The run names the clip it was started on, so the line survives a rename, a removal and a Close.
    expect(kit).toMatch(/\{kitRunCaption\(kitRun\.clipName\)\}/)
    expect(strip(read('modules/video-studio/store/runs.ts'))).toMatch(/useKitRun = createRunStore<\{ clipId: string; clipName: string; phase: string; canceled: boolean \}>\(\)/)
    // The closed video's kit: a component reading the same run, mounted where the importer is, and nowhere the clip list is.
    expect(kit).toMatch(/export function ClipKitRunning\(\): JSX\.Element \| null \{\s*const kitRun = useKitRun\(\(s\) => s\.run\)\s*if \(kitRun === null\) return null/)
    const studio = strip(read('modules/video-studio/VideoStudio.tsx'))
    expect(studio).toMatch(/<>\s*<ClipKitRunning \/>\s*<div data-tutorial="video-import"><Importer \/><\/div>\s*<\/>/)
    // Cancel is the shared component, behind the same question, and the question is the kit's.
    expect(kit).toMatch(/<RunningCancel title="Cancel Clip Kit" onClick=\{\(\) => setShowCancelConfirm\(true\)\} \/>/)
    expect(kit).toMatch(/useKitRun\.getState\(\)\.patch\(\{ canceled: true \}\)\s*void window\.api\.video\.cancelAll\(\)/)
  })

  it('(2) the importer\'s run is a module store, claimed before the first await; a video that arrived during the conversion is not replaced', () => {
    const importer = strip(read('modules/video-studio/Importer.tsx'))
    expect(importer).toMatch(/const busy = useImportRun\(\(s\) => s\.run !== null\)/)
    expect(importer, 'none of the component-state spellings this replaced').not.toMatch(/busyRef|convertingRef|setBusy\(/)
    const handle = importer.slice(importer.indexOf('async function handleFile('), importer.indexOf('function onDrop('))
    expect(handle).toMatch(/if \(refuseIfBusy\(\)\) return\s*if \(!useImportRun\.getState\(\)\.begin\(\{ filePath, converting: false \}\)\) return\s*const heldBefore = useVideoStore\.getState\(\)\.source/)
    expect(handle).toMatch(/finally \{\s*useImportRun\.getState\(\)\.end\(\)\s*\}/)
    // After the wait, before the load: the same rule as a project open's.
    expect(handle.indexOf('convertForImport(')).toBeLessThan(handle.indexOf('replacedSince(heldBefore, useVideoStore.getState().source)'))
    expect(handle.indexOf('replacedSince(')).toBeLessThan(handle.indexOf('await loadSource('))
    expect(handle).toMatch(/Skipped \$\{basename\(filePath\)\} because you opened another video while it was converting/)
    expect(handle, 'the skip returns before the load, the Recent entry and "Video loaded"').toMatch(/duration: 8000\s*\}\)\s*return\s*\}/)
  })

  it('(2) the preview copy\'s run is a module store; the playhead it resumes at travels with the copy, read after the wait', () => {
    const player = strip(read('modules/video-studio/Player.tsx'))
    expect(player).toMatch(/const makingCopy = usePreviewCopyRun\(\(s\) => s\.run !== null\)/)
    expect(player, 'no component-state copies of the busy flag or the position').not.toMatch(/setMakingCopy|resumeAtRef/)
    const copy = player.slice(player.indexOf('async function makePreviewCopy()'), player.indexOf('function nudge('))
    expect(copy.indexOf('usePreviewCopyRun.getState().begin({ sourcePath: startedFor })')).toBeGreaterThan(-1)
    expect(copy.indexOf('begin('), 'claimed before the convert').toBeLessThan(copy.indexOf('convertForImport('))
    expect(copy.indexOf('convertForImport('), 'the playhead is read after the wait').toBeLessThan(copy.indexOf('playheadNow(useVideoStore.getState())'))
    expect(copy).toMatch(/finally \{\s*usePreviewCopyRun\.getState\(\)\.end\(\)\s*\}/)
    // The element that hears the metadata takes the position from the store, whichever instance it is.
    expect(player).toMatch(/const resumeAt = useVideoStore\.getState\(\)\.takePreviewResume\(\)\s*if \(resumeAt !== null\) v\.currentTime = resumeAt/)
  })

  it('(2) main refuses a second conversion, claimed before the handler\'s first await and given back in a finally; the Importer and the project open both reach it', () => {
    const video = strip(readMain('ipc/video.ts'))
    const handler = video.slice(video.indexOf("ipcMain.handle('video:convertForImport'"), video.indexOf("ipcMain.handle('video:pickFile'"))
    expect(handler).toMatch(/assertSafeAbsolutePath\(filePath, 'video:convertForImport filePath'\)\s*if \(convertingFor !== null\) throw new Error\(convertBusyMessage\(convertingFor\)\)\s*convertingFor = filePath\s*try \{\s*return await convertForImport\(filePath\)\s*\} finally \{\s*convertingFor = null\s*\}/)
    // The three callers of the channel all go through it (a fourth would too: the guard is the handler's).
    expect(read('modules/video-studio/Importer.tsx')).toMatch(/window\.api\.video\.convertForImport\(filePath\)/)
    expect(read('modules/video-studio/Player.tsx')).toMatch(/window\.api\.video\.convertForImport\(startedFor\)/)
    expect(read('modules/project/ProjectIO.ts')).toMatch(/window\.api\.video\.convertForImport\(sourcePath\)/)
    // ...and the false comment is gone from the open path.
    expect(read('modules/project/ProjectIO.ts')).not.toMatch(/can run beside/)
  })

  it('(3) autosave subscribes through the playhead rule and the ceiling: no whole-store subscription, no bare timer of its own', () => {
    const hook = strip(read('hooks/useAutosave.ts'))
    expect(hook).toMatch(/useVideoStore\.subscribe\(\(state, prev\) => \{\s*if \(!playheadOnlyChange\(state, prev, VIDEO_PLAYHEAD_KEYS\)\) scheduleSave\(\)\s*\}\)/)
    expect(hook).toMatch(/useAudioStore\.subscribe\(\(state, prev\) => \{\s*if \(!playheadOnlyChange\(state, prev, AUDIO_PLAYHEAD_KEYS\)\) scheduleSave\(\)\s*\}\)/)
    expect(hook, 'the video and audio stores are not handed to the scheduler whole').not.toMatch(/use(Video|Audio)Store\.subscribe\(scheduleSave\)/)
    expect(hook).toMatch(/const scheduler = createSaveScheduler\(/)
    expect(hook, 'the debounce is the scheduler\'s: no timer of the hook\'s own').not.toMatch(/window\.setTimeout|debounceTimer/)
  })

  it('(4) the caption model download is a run in the store, claimed first; its listener lasts the download; the status is the store\'s', () => {
    const panel = strip(read('modules/video-studio/CaptionsPanel.tsx'))
    expect(panel).toMatch(/const installRun = useModelInstallRun\(\(s\) => s\.run\)/)
    expect(panel).toMatch(/const status = useCaptionsStatus\(\(s\) => s\.status\)/)
    expect(panel, 'none of the component state this replaced').not.toMatch(/setInstalling|setInstallProgress|setStatus\(|useState<CaptionsInstallStatus/)
    const install = panel.slice(panel.indexOf('async function installModel()'), panel.indexOf('// T-112: the header button names'))
    expect(install).toMatch(/if \(!useModelInstallRun\.getState\(\)\.begin\(\{ progress: \{ phase: 'starting', percent: 0 \} \}\)\) return\s*const offProgress = window\.api\.captions\.onModelProgress\(\(p\) => useModelInstallRun\.getState\(\)\.patch\(\{ progress: p \}\)\)/)
    expect(install).toMatch(/finally \{\s*useModelInstallRun\.getState\(\)\.end\(\)\s*offProgress\(\)\s*\}/)
    expect(install, 'the status is refreshed through the store when the download ends').toMatch(/await refreshStatus\(\)/)
    expect(panel).toMatch(/useCaptionsStatus\.setState\(\{ status: await window\.api\.captions\.status\(\) \}\)/)
    // The setup card (the download's bar and Cancel are inside it) opens over a download that is running.
    expect(panel).toMatch(/useState\(\(\) => useModelInstallRun\.getState\(\)\.run !== null\)/)
    expect(panel, 'no effect-scoped progress listener for the model').not.toMatch(/useEffect\(\(\) => \{\s*const off = window\.api\.captions\.onModelProgress/)
  })

  it('(5) the Player\'s notice sits inside a status wrapper that is always mounted, empty while the picture draws', () => {
    const player = strip(read('modules/video-studio/Player.tsx'))
    expect(player).toMatch(/<div role="status" className=\{noPicture \? undefined : '-mb-3'\}>\s*\{noPicture \? \(/)
    // The role is on the wrapper, not on the notice that mounts with its content (the pattern GifPanel documents as not reliably read).
    expect(player.match(/role="status"/g) ?? []).toHaveLength(1)
    expect(player).toMatch(/\) : null\}\s*<\/div>\s*<div className="flex items-center gap-3 text-sm">/)
  })

  it('(6) the Player shares its no-picture verdict through the video store, and the Output preview says so until a copy exists', () => {
    const player = strip(read('modules/video-studio/Player.tsx'))
    expect(player).toMatch(/const noPicture = useVideoStore\(\(s\) => s\.noPicture\)\s*const setNoPicture = useVideoStore\(\(s\) => s\.setNoPicture\)/)
    expect(player, 'the verdict is not component state any more').not.toMatch(/useState\(false\)\s*\n?\s*const \[makingCopy/)
    const preview = strip(read('modules/video-studio/OutputPreview.tsx'))
    expect(preview).toMatch(/const pictureUnavailable = useVideoStore\(\(s\) => s\.noPicture && s\.previewUrl === null\)/)
    expect(preview).toMatch(/\{pictureUnavailable \? \(\s*<p className="text-xs text-ink-dim">\{OUTPUT_PREVIEW_UNAVAILABLE_MESSAGE\}<\/p>\s*\) : \(\s*<p className="text-xs text-ink-dim">\s*Live snapshot at the playhead position/)
  })

  it('(1) the guides say the same as the code: no "other clips\' kit buttons wait", no "one button per row"', () => {
    const userGuide = readFileSync(path.resolve(RENDERER_ROOT, '../../../docs/USER_GUIDE.md'), 'utf8')
    expect(userGuide).not.toMatch(/other clips' kit buttons wait/)
    expect(userGuide).toMatch(/Clip Kit[\s\S]{0,400}whichever clip is selected/)
    const styleGuide = readFileSync(path.resolve(RENDERER_ROOT, '../../../docs/STYLE_GUIDE.md'), 'utf8')
    expect(styleGuide).not.toMatch(/A job with one button per row \(Clip Kit\)/)
    expect(read('modules/video-studio/ClipKitButton.tsx')).not.toMatch(/one button per row/)
  })
})

describe('T-135 (11) pick rule - a picked second track is refused ONLY on the probe\'s no-sound verdict', () => {
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // E2E: audio.spec.ts "a second track whose length cannot be read is still added" drives a durationless WebM to the added track; the refusal
  // itself is "a second track with no sound in it is refused when picked". This holds the condition between them (round 85: a refusal on ANY
  // probe error passed both cases and every unit test).
  it('the catch around the pick-time probe refuses on isNoAudioStreamError(err) alone, and any other failure falls through to the add', () => {
    const panel = strip(read('modules/audio-studio/SecondaryTrackPanel.tsx'))
    expect(panel).toMatch(
      /try \{\s*await window\.api\.audio\.probe\(filePath\)\s*\} catch \(err\) \{\s*if \(isNoAudioStreamError\(err\)\) \{\s*toast\.error\(SECOND_TRACK_PICK_NO_SOUND_MESSAGE, \{ duration: ERROR_TOAST_MS \}\)\s*return\s*\}\s*\}\s*setSecondaryTrack\(\{/
    )
  })
})
