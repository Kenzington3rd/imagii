# imagii — interaction coverage ledger

The enforcement artifact for the standing bar in `CLAUDE.md`: every
interactive element is driven to its real end state by a test, or has a
disposition row here naming the OS boundary that stops it and the
deepest layer covered instead. An element missing from this ledger is a
bug.

**State: inventory edition (2026-08-15), defect rows updated after
T-13..T-20.** Complete element inventory from the round-22 renderer
sweep; dispositions and test names are being filled by the coverage
campaign (see `docs/TICKETS.md` T-13 onward). Counts at sweep time: ~343
interactive elements; ~11 E2E-covered (~3%); 58 headless-limited; 8
native confirm/prompt dialogs; 6 orphaned (unreachable) controls.

**Changed by T-13..T-20 (round 23):** the 6 orphaned controls are now
mounted and reachable (0 orphaned, so PresetPanel's delete confirm is a
live dialog rather than a dead one); the native-dialog inventory grows
from 8 to 9 with Audio Studio's new Close confirm; Video Studio gains
Undo/Redo buttons plus a Ctrl+Z/Y/Shift+Z binding. Every element added
or altered carries unit-level coverage in this round and is named below
with the fleet ticket that will drive its end state.

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
| Video | 151 (149 + 2 undo/redo, T-15) | 4 + 2 render-only | 27 | 3 |
| Audio | 48 (4 of them un-orphaned by T-14) | 1 | 5 | 2 (Close, T-19) |
| Image | 66 | 1 | 6 | 0 |
| References | 20 | 1 | 5 | 3 |
| Shared | 23 (21 + HotkeyOverlay x2, T-13) | 2 | 0 | 0 |
| Orphaned | 0 (was 6) | — | — | — |
| **Total** | **~345** | **~11 (~3%)** | **58** | **9** |

---

## Defects found by the sweep (ticketed)

All eight are FIXED in round 23. Each row keeps the original finding and
adds what landed, the unit-level coverage that ships with it, and the
fleet ticket that will drive its end state.

1. **HotkeyOverlay never mounted** (`components/HotkeyOverlay.tsx`) —
   the `?` shortcut it owns is advertised in Player.tsx hint copy
   and its SHORTCUTS_BY_ROUTE table is the only shortcut documentation.
   Two dead interactions. → T-13 **FIXED**: mounted app-wide in
   `App.tsx` outside `<Routes>`; `?` toggles on every route (INPUT/
   TEXTAREA guarded), Escape and the "Esc" close button both dismiss via
   `Modal`. Table drift corrected in the same change (Audio's phantom
   Space row removed, Video's Ctrl+Z added, Delete row now says Delete /
   Backspace). Covered: `HotkeyOverlay.test.ts` (toggle predicate, route
   lookup), `tests/unit/hotkeyTable.test.ts` (every row is either a real
   binding found in that route's component tree or a listed mouse hint),
   `tests/unit/interactionWiring.test.ts` (mount + close control).
   E2E: T-21.
2. **PresetPanel (audio cleanup presets) never mounted** — four dead
   controls; `audio:listPresets/savePreset/deletePreset` IPC channels
   live in main with no reachable UI. → T-14 **FIXED**: rendered in
   Audio Studio's right column between Levels and Add-a-second-track
   (card + `PanelHeader icon="gear"`, per DESIGN_GUIDE). Markup already
   matched current conventions; unchanged. Covered:
   `interactionWiring.test.ts` (mounted, reachable from `/audio`, all
   four controls still reach the IPC, delete still behind a confirm) +
   the existing main-side `audio/presets.test.ts`. E2E: T-24.
3. **Video Studio has no undo affordance** — no header buttons, no
   Ctrl+Z listener (Audio has one, Image has one).
   videoStore.undo/redo only reachable from Home's global button.
   → T-15 **FIXED**: header Undo/Redo buttons (disabled off
   `canUndo`/`canRedo`) + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z. The branch all
   three studios had copied is now one hook,
   `hooks/useUndoRedoHotkeys.ts`. Covered:
   `useUndoRedoHotkeys.test.ts` (10 cases incl. the INPUT/TEXTAREA
   guard), `interactionWiring.test.ts` (buttons + hook in all three
   studios, no fourth copy). E2E: T-22.
4. **Tutorial coachmarks target nonexistent selectors** —
   `[data-tutorial="video-crop"]` and `[data-tutorial="audio-multitrack"]`
   highlight nothing. → T-16 **FIXED**: `video-crop` on CropOverlay's
   control row; `audio-multitrack` on the SecondaryTrackPanel host
   wrapper in AudioStudio (the panel root already carries `audio-music`
   for the ducking step). Covered: `tests/unit/tutorialTargets.test.ts`
   walks EVERY step of ALL FOUR tutorials and resolves each selector
   against the components that route can actually render, so the next
   coachmark added without its host fails the build. E2E: T-21.
5. **Invalid interactive nesting** — text input inside a button
   (ClipList), remove button inside a label wrapping inputs
   (TextOverlayEditor). Ambiguous roles, testability hazard.
   → T-17 **FIXED**: ClipList's row is a flex row with the rename input
   and the select button as siblings (the input's `stopPropagation` is
   gone with the ancestor handler that needed it; both controls gained
   their own `aria-label`). TextOverlayEditor's label now wraps only its
   own field, with the remove button as a sibling. A third instance the
   sweep missed — seven rotation presets inside PropertiesPanel's
   Rotation label — is fixed with them. Covered:
   `tests/unit/interactiveNesting.test.ts` parses every renderer `.tsx`
   with the TypeScript TSX parser and fails on any control nested in
   another (repo-wide, not just these three), plus
   `interactionWiring.test.ts` for behavior preservation. No existing
   E2E selector changed — `smoke.spec` and `export.spec` both pass
   unmodified. E2E: T-22.
6. **RecentFilesMenu dismisses only on mouse-leave** (no click-outside,
   no Escape) — hover-dependent, flaky headless. → T-18 **FIXED**:
   Escape (window keydown) and click-outside (document mousedown,
   measured against the wrapper so the toggle button still closes what
   it opened) added; mouse-leave retained. Covered:
   `RecentFilesMenu.test.ts` (pure dismissal policy, all four cases),
   `interactionWiring.test.ts` (listeners registered and removed).
   E2E: T-21.
7. **Audio Studio Close has no confirm** while Video Studio's does;
   both drop unexported work. → T-19 **FIXED**: `confirmAudioClose`
   asks before `clearSource()` whenever the chain differs from
   `DEFAULT_CHAIN_SPEC`, cut regions exist, or a second track is loaded;
   an untouched chain still closes with no nag. Copy mirrors
   VideoStudio's. Covered: `AudioStudio.test.ts` (17 cases: message per
   edit kind, and the declined branch asserted separately).
   E2E: T-24.
8. **PostChecklist diary lives in localStorage** (`imagii.postingDiary`)
   — excluded from project save/load and autosave, unlike all other
   studio state; wiped with the Chromium profile. → T-20 **FIXED**:
   moved to the settings store under the new `postingDiary` key (added
   to `SettingsKey`, the IPC allowlist, and the electron-store schema),
   with a one-time localStorage migration that also retires a corrupt
   legacy blob. Covered: `src/shared/postingDiary.test.ts` (23 cases:
   parse/normalize, round trip, migration, corrupt-JSON path),
   `settingsKnownKeys.test.ts` (new key accepted; allowlist and store
   schema pinned against each other). E2E: T-23.

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
| confirm("Delete preset \"X\"?") | PresetPanel.tsx:46 (reachable since T-14) |
| confirm("Close this audio? … will be discarded.") | AudioStudio.tsx (T-19) |
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

- **Chrome (6):** HomeLink (COV), Undo + Redo buttons and the
  Ctrl+Z/Y/Shift+Z binding (T-15; `useUndoRedoHotkeys.test.ts` +
  `interactionWiring.test.ts`, E2E T-22), Clean audio (extract->wav->
  Audio Studio->navigate), Close (NAT confirm), TutorialButton.
- **Importer (6):** dragover/leave/drop (COV export.spec both paths),
  Choose file (HL dialog), RecentFilesMenu pick/clear.
- **Player (13):** play/pause, frame step x2, safe-zones checkbox,
  video events, keyboard Space/arrows/,/./I/O (7 bindings).
- **CropOverlay (5):** enable checkbox, aspect presets x5, reset, Rnd
  drag, Rnd resize. Control row hosts `data-tutorial="video-crop"`
  since T-16.
- **Timeline (2):** trim-start drag, trim-end drag (mousedown/move/up).
- **ClipList (6):** add clip, speed slider, speed reset, row select
  (button, `aria-label="Select clip …"`), name input (sibling of the
  select button since T-17, `aria-label="Rename clip …"`), remove (NAT).
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
  fields (start/end gained aria-labels in T-17), remove (sibling of the
  time label since T-17).
- **ExportPanel (13):** presets gear, output dir (HL; label COV
  render-only), Export N (COV export.spec end-to-end), cancel + modal
  keep/cancel-jobs, watermark input+position, filename template,
  preset checkboxes x5, Show per row (HL shell; COV render-only),
  safe-zone modal cancel/continue.
- **CustomPresetManager (12):** close, name, base select, w/h/fps,
  bitrates x2, save, delete (NAT), done, Escape/scrim.
- **PostChecklist (10):** suggest titles, copy x2 (HL clipboard),
  hashtag select, name input, platform toggles x6, notes, log post
  (writes `settings.postingDiary` since T-20), delete entry, perf
  inputs x3. Persistence covered by `shared/postingDiary.test.ts`;
  E2E T-23.

### Audio (48)

HomeLink (COV), undo/redo buttons + Ctrl+Z/Y/Shift+Z bindings (shared
`useUndoRedoHotkeys` since T-15), Close (NAT confirm since T-19),
TutorialButton, FixWizard trigger + 8 option
buttons + close/start-over/apply + modal escape/scrim, drop zone
(dragover/leave/drop), Choose file (HL), RecentFilesMenu, waveform
region-drag -> cut region, click-seek, play/pause, cut chip removal,
denoise buttons x5 + parametric sliders x2, rumble/hum/de-ess boxes,
compressor x4, loudnorm box + LUFS number + platform select, gain
slider, secondary role buttons x3 (HL dialog), remove, gain slider,
match-loudness + duck boxes, duck sliders x4, format/bitrate selects,
mux-back box, Export (HL dialog), cancel, Show (HL shell).
PresetPanel x4 (name input + Enter, Save current, Apply per row, remove
per row with NAT confirm) — mounted and reachable since T-14.

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
clear **+ Escape and click-outside (T-18)**, TutorialButton x4,
HomeLink x5 (COV), ErrorBoundary reload + details disclosure,
AppToaster surface (MutationObserver pattern from export.spec),
HotkeyOverlay `?` binding + Esc button (app-wide since T-13).

### Orphaned (0)

Empty since round 23. The six controls listed here at sweep time —
HotkeyOverlay's `?` binding and Esc button, PresetPanel's input/Enter/
save/apply/remove — are all mounted (T-13, T-14). A control that becomes
unreachable again belongs in this section with the ticket that will
mount it.


---

## Dispositions — round 25 (Wave A)

Recorded by the expediter from the four worker reports; test names are
in tests/e2e/{home-chrome,video-core,audio,references}.spec.ts and the
unit files named inline. Defect-pinned rows cite their ticket.

### Welcome + Home + Shared (T-21)
"Let's go" -> welcomeSeen E2E. Global Undo/readout -> restored-canvas
E2E; Redo -> defect pin [T-32]. Open/Save project -> HL-dialog (deepest:
ProjectIO + projectValidation units). AutosaveRestore: Restore/Discard/
Later -> E2E; Clear/Dismiss -> corrupt-offers-nothing pin + unit
[T-33, unreachable today]. Modal contract (scrim/stop/Escape/trap/
restore) -> Templates + FixWizard E2E. Tutorial: full-run/Back/arrows/
scrim-advance/Skip-no-persist -> E2E; Enter -> pin [T-34 double-step].
RecentFilesMenu (toggle/item/clear/Escape/click-outside) -> E2E;
mouse-leave -> unit policy. HotkeyOverlay ?/Esc -> E2E. AppToaster ->
E2E on studios; absent on Home [T-31]. ErrorBoundary -> OPEN [T-35].

### Video core (T-22)
Chrome: Undo/Redo buttons + Ctrl+Z/Y -> trim-drag E2E (Ctrl+Shift+Z
unit); Clean audio -> extract-handoff E2E; Close both branches -> E2E;
TutorialButton -> E2E. Importer: drop -> export.spec + every launch;
picker -> HL-dialog. Player: transport/Space/safe-zones/events -> E2E;
nudges + frame steps + ,/. -> seek-request E2E, end-state blocked by
[T-37 BUG-SEEK]; I/O -> E2E. CropOverlay: all 10 rows -> E2E incl.
uncheck-clears-store proof. Timeline: both drags -> E2E + undo. ClipList:
all 6 rows -> E2E incl. confirm both branches. OutputPreview select ->
dataURL-delta E2E. ColorGrade: all 7 rows -> E2E. TextOverlayEditor:
all 10 rows -> E2E.

### Audio (T-24)
Import drop/hover -> E2E; .txt negative -> exact-toast E2E; video
extract -> real-ffmpeg E2E; recents + Choose-file -> E2E with
main-process dialog stub (OS chooser itself HL); waveform seek/play/
pause -> E2E; region-drag -> defect tripwire [T-36] + chip lifecycle
E2E; all Cleanup/Levels/gain controls -> E2E with readout assertions;
undo/redo + INPUT guard -> E2E; FixWizard all paths -> E2E; PresetPanel
save/apply/delete both branches -> E2E + on-disk JSON; secondary track
full subtree -> E2E via dialog stub; Export/Cancel/Show -> HL around a
live job (deepest: Layer 5 runAudioExport/Mux + round17 cancel units);
Close untouched/edited/cuts variants -> E2E with dialog spy.

### References + parser (T-26)
Tabs/tutorial-coachmark-geometry -> E2E. Board CRUD incl. blank-name
refusal, delete both branches -> E2E + on-disk JSON. Item lifecycle ->
E2E (imagii-file:// thumb served for real; ->Canvas bridge to layer at
0.4 opacity; remove unlinks thumb). Asset cards x2 categories ->
replace-not-append E2E. Search: input/Enter/button/in-flight/error-card
-> proxy-hermetic E2E; live search + result Save + remote thumbs ->
HL-network (deepest: duckduckgo.test.ts 27 units + validator
composition). Rename + first-save prompt -> defect pins [T-28]. Clear
thumb cache -> defect pin both directions [T-29].
