# imagii — interaction coverage ledger

The enforcement artifact for the standing bar in `CLAUDE.md`: every
interactive element is driven to its real end state by a test, or has a
disposition row here naming the OS boundary that stops it and the
deepest layer covered instead. An element missing from this ledger is a
bug.

**State: inventory edition (2026-08-15).** Complete element inventory
from the round-22 renderer sweep; dispositions and test names are being
filled by the coverage campaign (see `docs/TICKETS.md` T-13 onward).
Counts: ~343 interactive elements; ~11 E2E-covered at sweep time (~3%);
58 headless-limited; 8 native confirm/prompt dialogs; 6 orphaned
(unreachable) controls.

Flags: `HL` = headless-limited (reason given) · `COV` = E2E-covered at
sweep time · `NAT` = native confirm/prompt (needs a Playwright dialog
handler).

Global test hooks: `window.__imagiiStage` (Konva Stage, Canvas.tsx:360),
`window.__imagiiVideoEl` (Player.tsx:124).

---

## Summary by route

| Group | Elements | Covered at sweep | HL | NAT |
|---|---|---|---|---|
| Welcome | 1 | 0 (bypassed by seeding) | 0 | 0 |
| Home | 15 | 5 (NavCards) | 2 | 0 |
| Record | 17 | 1 | 13 | 1 |
| Video | 149 | 4 + 2 render-only | 27 | 3 |
| Audio | 48 | 1 | 5 | 1 (orphaned) |
| Image | 66 | 1 | 6 | 0 |
| References | 20 | 1 | 5 | 3 |
| Shared | 21 | 2 | 0 | 0 |
| Orphaned | 6 | 0 | 0 | 1 |
| **Total** | **~343** | **~11 (~3%)** | **58** | **8** |

---

## Defects found by the sweep (ticketed)

1. **HotkeyOverlay never mounted** (`components/HotkeyOverlay.tsx`) —
   the `?` shortcut it owns is advertised in Player.tsx:188 hint copy
   and its SHORTCUTS_BY_ROUTE table is the only shortcut documentation.
   Two dead interactions. → T-13
2. **PresetPanel (audio cleanup presets) never mounted** — four dead
   controls; `audio:listPresets/savePreset/deletePreset` IPC channels
   live in main with no reachable UI. → T-14
3. **Video Studio has no undo affordance** — no header buttons, no
   Ctrl+Z listener (Audio has one at AudioStudio.tsx:31, Image at
   ImageStudio.tsx:38). videoStore.undo/redo only reachable from Home's
   global button. → T-15
4. **Tutorial coachmarks target nonexistent selectors** —
   `[data-tutorial="video-crop"]` (videoTutorial.ts:53) and
   `[data-tutorial="audio-multitrack"]` (audioTutorial.ts:60) highlight
   nothing. → T-16
5. **Invalid interactive nesting** — text input inside a button
   (ClipList.tsx:90-100), remove button inside a label wrapping inputs
   (TextOverlayEditor.tsx:171). Ambiguous roles, testability hazard.
   → T-17
6. **RecentFilesMenu dismisses only on mouse-leave** (no click-outside,
   no Escape) — hover-dependent, flaky headless. → T-18
7. **Audio Studio Close has no confirm** while Video Studio's does;
   both drop unexported work. → T-19
8. **PostChecklist diary lives in localStorage** (`imagii.postingDiary`)
   — excluded from project save/load and autosave, unlike all other
   studio state; wiped with the Chromium profile. → T-20

Also noted, not ticketed: Tutorial's scrim click ADVANCES rather than
dismisses (Tutorial.tsx:121) — by design, but tests must not click the
scrim to escape; Image emote-pack export (112x112 + PNG) silently emits
three files from one click (ExportDialog.tsx:77-89) — intended feature,
needs coverage; Canvas.tsx:446 exports getStageDataUrl() that nothing
imports.

---

## Native-dialog inventory (each needs a Playwright dialog handler)

| Call | file:line |
|---|---|
| confirm("A recording is in progress. Stop and save it…") | RecordStudio.tsx:434 |
| confirm("Close this video? N clip(s)…") | VideoStudio.tsx:45 |
| confirm("Remove clip \"X\"?") | ClipList.tsx:111 |
| confirm("Delete preset \"X\"?") | CustomPresetManager.tsx:69 |
| confirm("Delete preset \"X\"?") | PresetPanel.tsx:46 (orphaned) |
| prompt("Name your first mood board:") | ReferencePanel.tsx:31 |
| prompt("Rename mood board", name) | MoodBoardPanel.tsx:68 |
| confirm("Delete \"X\" and all N item(s)?") | MoodBoardPanel.tsx:75 |

## Headless-limited categories (58 elements)

| Boundary | Elements | Deepest coverable layer |
|---|---|---|
| Native open/save/dir dialogs | picker buttons across all studios, project save/load, ClipKit, reframe/gif/compile/pip output dirs, srt save, burn-in output, audio export | IPC handler unit tests + seeded-settings E2E bypass (export.spec pattern) |
| shell.showItemInFolder / openExternal / openPath | every "Show" toast action + reveal button, whisper doc links, bin/models folder buttons | assert the IPC call fires (button wiring); the OS side is untestable headless |
| desktopCapturer + MediaRecorder + media devices | the entire Record capture pipeline (13 elements) | UI-state E2E (checkbox/select wiring, phase transitions with stubs where possible); real capture needs a Windows hand-test |
| whisper.exe + 141 MB model download | transcribe, model install/cancel | not-ready branch E2E (setup panel), burn-in already Layer 5 |
| Live DuckDuckGo network | search input/button, result Save, remote thumbnails | duckduckgo.ts parser unit tests on fixture HTML + error-path E2E |
| Clipboard | PostChecklist copy buttons, Image paste | grant clipboard permissions in Playwright context where possible |
| Browser download (a[download]) | Image export, variants save | page.waitForEvent('download') — coverable, different mechanism |

---

## Full element inventory

The complete per-element tables (file:line, selector, handler chain,
end state, flags) produced by the round-22 sweep live in the section
below. Dispositions ("covered by <test>" / "covered at <layer> because
<boundary>") are being appended per element by the coverage campaign;
until a row carries one, treat it as OPEN.

### Welcome (1)

| Element | file:line | Chain | End state | Flags |
|---|---|---|---|---|
| Button "Let's go" | Welcome.tsx:43 | settings.set('welcomeSeen') | config.json written; Home renders | never directly clicked in any test |

### Home (15)

| Element | file:line | Chain | End state | Flags |
|---|---|---|---|---|
| Undo button | Home.tsx:55 | useGlobalUndo -> last store .undo() | state reverts | |
| Redo button | Home.tsx:63 | store .redo() | state advances | |
| "last:" readout | Home.tsx:71 | readout | assertion target | |
| Open project | Home.tsx:74 | project:load -> showOpenDialog -> applyProject | stores rehydrated; toast | HL dialog |
| Save project | Home.tsx:80 | project:save -> showSaveDialog | .imagii.json written; toast | HL dialog |
| NavCard x5 | Home.tsx:92-120 | router | route change | COV smoke |
| AutosaveRestore: Restore / Discard / Later / Clear / Dismiss | AutosaveRestore.tsx:157-176,136-144 | applyProject / autosave:clear / dismiss | stores rehydrated / file deleted / banner hidden | |

### Record (17; 13 HL)

Stop, Refresh sources, source thumbnails, mic checkbox+select, webcam
checkbox+select, corner select, mp4 checkbox, Start recording, Esc
binding, Discard recording, Show toast, Edit-in-Video-Studio toast,
HomeLink (+ capture-phase confirm intercept), finalize save dialog.
Full chains in the sweep; capture pipeline is HL (desktopCapturer /
MediaRecorder / devices absent headless); corner select persists
record.webcamCorner via settings; convert checkbox drives finalize
format. HomeLink COV.

### Video (149) — by panel

- **Chrome (4):** HomeLink (COV), Clean audio (extract->wav->Audio
  Studio->navigate), Close (NAT confirm), TutorialButton.
- **Importer (6):** dragover/leave/drop (COV export.spec both paths),
  Choose file (HL dialog), RecentFilesMenu pick/clear.
- **Player (13):** play/pause, frame step x2, safe-zones checkbox,
  video events, keyboard Space/arrows/,/./I/O (7 bindings).
- **CropOverlay (5):** enable checkbox, aspect presets x5, reset, Rnd
  drag, Rnd resize.
- **Timeline (2):** trim-start drag, trim-end drag (mousedown/move/up).
- **ClipList (6):** add clip, speed slider, speed reset, row select,
  name input (nested in button — T-17), remove (NAT).
- **ClipKit (6):** start (HL dir dialog+shell), cancel, keep-running,
  cancel-jobs, safe-zone modal cancel/continue.
- **OutputPreview (1):** platform select (canvas redraw).
- **ColorGrade (7):** 4 sliders, reset, auto-zoom + hype-shake boxes.
- **HighlightPanel (5):** scan, chat disclosure, chat textarea
  (debounced rescore), cancel, +Clip per candidate.
- **ChatHighlightPanel (5):** textarea, bucket, pad, find spikes (pure
  renderer — prime E2E candidate), +clip per peak.
- **ReframePanel (5):** position x4, output dir (HL), reframe (HL first
  run), cancel, Show (HL shell).
- **GifPanel (7):** width/fps/speed selects, dir (HL), export (HL),
  cancel, Show (HL).
- **CompilationPanel (5):** crossfade slider, dir (HL), compile (HL),
  cancel, Show (HL).
- **PipPanel (9):** base/overlay pickers (HL), width/margin numbers,
  position select, dir (HL), composite (HL), cancel, Show (HL).
- **CaptionsPanel (18):** transcribe (HL whisper; not-ready branch
  testable), setup toggle, external links x2 (HL shell), open folders
  x2 (HL shell), model download/cancel (HL network), refresh status,
  burn-in cancel, style presets, font slider, position select, color
  inputs x2, trim checkbox, save .srt (HL dialog), burn (HL dialog).
- **TextOverlayEditor (10):** add, text/font/size/color/x/y/start/end
  fields, remove (nested in label — T-17).
- **ExportPanel (13):** presets gear, output dir (HL; label COV
  render-only), Export N (COV export.spec end-to-end), cancel + modal
  keep/cancel-jobs, watermark input+position, filename template,
  preset checkboxes x5, Show per row (HL shell; COV render-only),
  safe-zone modal cancel/continue.
- **CustomPresetManager (12):** close, name, base select, w/h/fps,
  bitrates x2, save, delete (NAT), done, Escape/scrim.
- **PostChecklist (10):** suggest titles, copy x2 (HL clipboard),
  hashtag select, name input, platform toggles x6, notes, log post
  (localStorage — T-20), delete entry, perf inputs x3.

### Audio (48)

HomeLink (COV), undo/redo buttons + Ctrl+Z/Y/Shift+Z bindings, Close
(no confirm — T-19), TutorialButton, FixWizard trigger + 8 option
buttons + close/start-over/apply + modal escape/scrim, drop zone
(dragover/leave/drop), Choose file (HL), RecentFilesMenu, waveform
region-drag -> cut region, click-seek, play/pause, cut chip removal,
denoise buttons x5 + parametric sliders x2, rumble/hum/de-ess boxes,
compressor x4, loudnorm box + LUFS number + platform select, gain
slider, secondary role buttons x3 (HL dialog), remove, gain slider,
match-loudness + duck boxes, duck sliders x4, format/bitrate selects,
mux-back box, Export (HL dialog), cancel, Show (HL shell).
Orphaned: PresetPanel x4 (T-14).

### Image (66)

HomeLink (COV), undo/redo, TutorialButton, 10 keyboard bindings
(Ctrl+Z/Y/Shift+Z, Delete, Backspace, V/R/O/L/P), paste listener (HL
clipboard), drop zones (both states), +Import (HL file chooser — but
Playwright filechooser event can drive it), +Add text, Templates
button + empty-state template cards + dialog cards/close/cancel,
empty-state import/start-with-text, tool buttons x5 + More, grid/snap
boxes + grid-size number, Konva stage mousedown/move/up (draw commit),
shape click-select/drag-end/transform-end, layer rows + eye/lock/
up/down/duplicate/delete x6 per row, properties: name/x/y/rotation +
presets x7/opacity/fill/stroke/stroke-px/text/size/color, export
format/quality/scale selects, Variants (generate/save/regenerate/
save-all — download events), Export (browser download; emote-pack
3-file branch), modal escape/scrim.

### References (20)

HomeLink (COV), TutorialButton, tabs x3, search input + Enter + button
(HL live DDG), result Save (HL + NAT first-board prompt), remote thumbs
(HL), board name input + Enter + "+" button, board row select, clear
thumb cache, rename (NAT), delete (NAT), item ->Canvas (cross-studio
bridge), item remove, asset cards (headless-safe canvas replacement).

### Shared (21)

Modal scrim/stopPropagation/Escape/focus-trap, Tutorial scrim-advance /
Skip (no persist) / Back / Next-Done (persists tutorialSeen) + 4 key
bindings (Esc COV partial), RecentFilesMenu toggle/mouse-leave/item/
clear, TutorialButton x4, HomeLink x5 (COV), ErrorBoundary reload +
details disclosure, AppToaster surface (MutationObserver pattern from
export.spec).

### Orphaned (6) — dead until T-13/T-14 land

HotkeyOverlay `?` binding + Esc button; PresetPanel input/Enter/save/
apply/remove.
