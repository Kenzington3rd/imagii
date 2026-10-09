# imagii — interaction coverage ledger

The enforcement artifact for the standing bar in `CLAUDE.md`: every
interactive element is driven to its real end state by a test, or has a
disposition row here naming the OS boundary that stops it and the
deepest layer covered instead. An element missing from this ledger is a
bug.

**State: round-26 edition (2026-08-15) — the coverage fleet is
complete.** Element inventory from the round-22 renderer sweep;
dispositions for every group are recorded in the round-25 (Wave A) and
round-26 (Wave B) sections below. Gates at round 26: 757 unit / 97 E2E
green. Counts at sweep time (historical baseline): ~343 interactive
elements; ~11 E2E-covered (~3%); 58 headless-limited; 8 native
confirm/prompt dialogs; 6 orphaned (unreachable) controls.

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
`window.__imagiiVideoEl` (Player.tsx, E2E handle only since T-38),
`window.__imagiiCrashTest` (App.tsx — arms the #/__crash ErrorBoundary
harness; unarmed, the route redirects to Home like any unknown hash.
SHIPS IN THE PRODUCTION BUNDLE BY DESIGN, double-gated — do not remove
without replacing the T-35 coverage).

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
dismisses (Tutorial.tsx:212) — by design, but tests must not click the
scrim to escape; Image emote-pack export (112x112 + PNG) silently emits
three files from one click (ExportDialog.tsx:77-89) — intended feature,
covered by T-25 (round 26). The orphaned getStageDataUrl() this note
used to flag was deleted in round 29 (T-53 rider); ThumbnailVariants'
private copy — the last raw stage.toDataURL() in the renderer, and the
one that HAD reintroduced T-45 — went in round 40 (T-46). Every capture
in the renderer now goes through `captureDocument`, pinned in
interactionWiring.test.ts.

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

## Headless-limited categories

58 elements at sweep time; rounds 25-26 shrank this hard. Three rows
were WRONG and are corrected below — the boundary either did not exist
under xvfb or had a deeper crossing than the sweep assumed. Verify a
boundary by probing before dispositioning against it.

| Boundary | Elements | Deepest coverable layer |
|---|---|---|
| Native open/save/dir dialogs | the OS chooser itself, everywhere | **Crossed in-house (rounds 25-26):** stub `dialog.show*Dialog` in the MAIN process via `app.evaluate` (queue variant `stubDialogs` for multi-ask flows) — click, IPC, validators, job, and bytes on disk all stay real. Only the OS chrome is untestable. |
| shell.showItemInFolder / openExternal / openPath | every "Show" toast action + reveal button, whisper doc links, bin/models folder buttons | the IPC call recorded in main with its exact argument (round 26); the OS side is untestable headless |
| ~~desktopCapturer + MediaRecorder + media devices (13 elements)~~ | **CORRECTED (T-27): only the mic/webcam `<select>`s (2 elements).** desktopCapturer, `getUserMedia({chromeMediaSource:'desktop'})` and MediaRecorder all work under xvfb; the other 11 elements are real E2E now. Only `enumerateDevices()` is empty in a container, and `--use-fake-device-for-media-capture` does not survive Electron's command line | reveal-gates driven both ways + zero-device branches asserted; real devices need HAND-TEST 2-3 |
| whisper.exe + 141 MB model download | transcribe, model install/cancel | not-ready branch E2E (setup panel), burn-in already Layer 5 |
| Live DuckDuckGo network | search input/button, result Save, remote thumbnails | duckduckgo.ts parser unit tests on fixture HTML + error-path E2E |
| ~~Clipboard~~ | **RETIRED (T-23 + T-25).** Both directions covered for real: main-process `clipboard.readText()` after the copy buttons; main-process `clipboard.writeImage` + a real Ctrl+V for paste | — |
| Browser download (a[download]) | Image export, variants save | **Crossed (T-25):** `session.will-download` in the main process — page `'download'` events NEVER fire under `_electron.launch` (probed on page and context). House pattern for every `a[download]` row; asserts real files on disk |

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
| AutosaveRestore: Restore / Discard / Later / Clear / Dismiss | AutosaveRestore.tsx:179-199,155-167 | applyProject / autosave:clear / dismiss | stores rehydrated / file deleted / banner hidden; a clear that fails toasts the reason and KEEPS the banner (T-57) | |

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
  cancel-jobs, long-clip confirm cancel/continue (T-85; it was the safe-zone
  modal until the kit stopped asking that — see round 52).
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

### References (26)

HomeLink (COV), TutorialButton, tabs x3, search input + Enter + button
(HL live DDG), result Save (live results HL; the SAVE and its
first-board flow are covered since T-28), remote thumbs (HL), board
name input + Enter + "+" button, board row select, clear thumb cache,
rename button, delete (NAT), item ->Canvas (cross-studio bridge), item
remove, asset cards (headless-safe canvas replacement). **T-28 added
six**: the rename dialog's field / Cancel / Rename, and the first-save
dialog's field / Cancel / Create & save — one `<NameDialog>` serving
both, so Modal's own rows cover the scrim, Escape and focus restore.

### Shared (21)

Modal scrim/stopPropagation/Escape/focus-trap, Tutorial scrim-advance /
Skip (no persist) / Back / Next-Done (persists tutorialSeen) + 4 key
bindings, **the coachmark's own Tab cycle + focus restore and the
topmost-claim Escape (T-64/T-73 — Modal and Tutorial share one trap)**,
RecentFilesMenu toggle/mouse-leave/item/
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
E2E; Redo -> defect pin [T-32] at round 25 — UPGRADED round 31 to
positives (cross-route undo, Redo re-applies, newest-first ordering),
see the round-31 section. Open/Save project -> HL-dialog (deepest:
ProjectIO + projectValidation units). AutosaveRestore: Restore/Discard/
Later -> E2E; Clear/Dismiss -> corrupt-offers-nothing pin + unit
[T-33, unreachable today] — UPGRADED round 34: the corruption banner
renders and both buttons are driven E2E, see the round-34 section. Modal contract (scrim/stop/Escape/trap/
restore) -> Templates + FixWizard E2E. Tutorial: full-run/Back/arrows/
scrim-advance/Skip-no-persist -> E2E; Enter -> pin [T-34 double-step]
— UPGRADED round 36: Enter exactly-one-step from both focus states;
left/right coachmark clamped at 1280x800 with every button hit-tested
(elementFromPoint) and clicked through; Tutorial.test.ts 61 units.
RecentFilesMenu (toggle/item/clear/Escape/click-outside) -> E2E;
mouse-leave -> unit policy. HotkeyOverlay ?/Esc -> E2E. AppToaster ->
E2E on studios; absent on Home [T-31] at round 25 — UPGRADED round 31:
one app-level mount, asserted on Home and a studio route.
ErrorBoundary -> OPEN [T-35] — UPGRADED round 36: real render throw
via the gated #/__crash harness; fallback + raw-hex exception styling
(the DESIGN_GUIDE-documented exception) + stack disclosure +
Reload-to-Home recovery to a working Home; the unarmed guard asserted
first. Expediter mutation: guard forced armed -> that assertion red.

### Video core (T-22)
Chrome: Undo/Redo buttons + Ctrl+Z/Y -> trim-drag E2E (Ctrl+Shift+Z
unit); Clean audio -> extract-handoff E2E; Close both branches -> E2E;
TutorialButton -> E2E. Importer: drop -> export.spec + every launch;
picker -> HL-dialog. Player: transport/Space/safe-zones/events -> E2E;
nudges + frame steps + ,/. -> seek-request E2E, end-state blocked by
[T-37 BUG-SEEK] at round 25 — UPGRADED round 27 to landed-playhead
E2E, see the round-27 section; I/O -> E2E. CropOverlay: all 10 rows -> E2E incl.
uncheck-clears-store proof. Timeline: both drags -> E2E + undo. ClipList:
all 6 rows -> E2E incl. confirm both branches. OutputPreview select ->
dataURL-delta E2E. ColorGrade: all 7 rows -> E2E. TextOverlayEditor:
all 10 rows -> E2E.

### Audio (T-24)
Import drop/hover -> E2E; .txt negative -> exact-toast E2E; video
extract -> real-ffmpeg E2E; recents + Choose-file -> E2E with
main-process dialog stub (OS chooser itself HL); waveform seek/play/
pause -> E2E; region-drag -> ONE gesture, one cut (T-36 fixed the
two-gesture defect the tripwire pinned) + overlapping-drag and
no-self-duplicate-on-re-render E2E + chip lifecycle E2E; all
Cleanup/Levels/gain controls -> E2E with readout assertions;
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
composition). Rename + first-save prompt -> defect pins [T-28] —
UPGRADED round 46 to positives: both flows run through the in-app
`<NameDialog>`, driven to disk (rename incl. undo/redo; first save
creates the board, saves the item and caches its thumbnail bytes), see
the round-46 section. Clear thumb cache -> POSITIVE since [T-29]: the
button empties the cache (it used to call the 500 MB LRU trim, which
under the budget deleted nothing), and since [T-79] the tiles it
empties out from under fall back to their source image; the launch
pass is the orphan sweep alone and is driven by launching the app. See
the round-47 and round-48 sections.

## Dispositions — round 26 (Wave B)

Recorded by the expediter from the three worker reports; test names are
in tests/e2e/{record,image,video-pipelines}.spec.ts and
src/renderer/src/modules/record-studio/compositor.corner.test.ts.
Expediter gates: 757 unit / 97 E2E green; discrimination re-executed
personally on record.spec.ts (bundle mutation of the "Recording
discarded." copy -> the named dialog-cancel test failed showing the
mutated string arriving in the live toast log -> byte-identical restore
verified by md5 -> green).

### Record (T-27) — the 13-element HL block was wrong; it is 2

Probed before writing: under Linux/xvfb, `desktopCapturer.getSources`,
`getUserMedia({chromeMediaSource:'desktop'})` and MediaRecorder ALL
work. Only `enumerateDevices()` is empty (no mic/cam exists in a
container, and Chromium's fake-device switch does not survive
Electron's command line). The screen half of the pipeline is real E2E.

Covered (15/17): Refresh sources + thumbnails + auto-select + Start
enablement -> E2E against the real screen source; zero-sources branch
via a main-side getSources stub [T-41 pin: both branches rendered
identically] — UPGRADED round 41: the stub is held back 1.5 s and all
three source-search states are driven and distinguished (invitation;
"Looking for screens and windows…" with the button disabled; the amber
"No screens or windows found." twin of the mic warning, exact copy +
class), no toast for an empty-but-successful search (`[role="status"]`
count), plus a THROWING getSources stub proving the refusal names the
fault, strips the invoke envelope, and leaves the in-flight state.
Start refusal (mic on, no device) -> E2E, no orphaned temp. Stop -> real WebM on disk (ffprobe: webm container, video stream,
no audio stream) + `Saved N.N MB.` toast. Esc -> real MP4 (ffprobe:
mp4/h264) through the convert phase. Mic checkbox both branches
(zero-device warning asserted, select asserted absent). Webcam checkbox
-> Corner select with its four exact labels [T-42 pin: no zero-camera
hint, PiP silently dropped]. Corner select -> `record.webcamCorner` on
disk AND restored by a second launch on the same userData; the
mount-write was pinned [T-43] — FIXED round 41: both controls persist
from their own onChange, so arriving on /record leaves config.json
byte- and mtime-identical (asserted in both persistence tests). MP4
checkbox -> `record.convertToMp4` on disk on change, kept across a
Home round trip, restored by a second launch, and re-ticked back to
`true` (two-way binding) [was T-43 pin: component-local, reset on
revisit]. Save dialog both branches
(main-process stub): chosen path -> ffprobed file + recents entry;
cancel -> exact "Recording discarded." + temp reaped + no recents.
Discard mid-convert -> real SIGKILL of a live convert [T-44 pin: raw
IPC error text + stranded half-written .mp4] — UPGRADED round 32: calm
"Recording discarded." toast (trash icon, no error styling), partial
output unlinked, recordings dir empty; see the round-32 section. Show ->
`shell.showItemInFolder` recorded in main with the exact output path.
Edit in Video Studio -> navigation + `take.mp4` loaded and visible.
HomeLink idle (navigates silently) + capture-phase confirm (exact copy
pinned from the live dialog; dismiss branch keeps the take rolling).
Streaming save proven: exactly one session `.webm` under
`userData/recordings` while recording.

Still HL (2): Microphone `<select>` and Webcam `<select>` — no
audioinput/videoinput device exists in a container. Deepest: both
reveal gates driven both ways; zero-device branches asserted.
HAND-TEST steps 2-3.

Adjacent row added to the inventory: the live compositor path
(`startCompositor` with a real cam stream — offscreen videos, rAF loop,
`canvas.captureStream`) has no E2E anywhere; its pure geometry is
unit-covered incl. the new corner.test.ts branches (camRatio arm + dy
centering, `readyState < 2` guard, zero-dimension fallback, portrait
canvas, 64px clamp edges — with a pin that `computeCornerRect` does NOT
clamp into bounds on tiny canvases). HAND-TEST steps 3-5. The
resolution-adaptive margin is inline in `startCompositor` and
unexported — hand-test only.

### Image (T-25) — no HL rows remain in Image(66)

Templates (12 empty-state cards under 4 headers + dialog + all four
dismissals proven non-applying) -> E2E derived from `CANVAS_TEMPLATES`,
not transcribed. Tools x5 via buttons AND keys (both letter cases) +
`+ More` + Tool badge + Ctrl+V-is-not-Select -> E2E. Draw-commit x4
tools + the sub-4px floor -> E2E via `__imagiiStage` (rect incl. a
backwards drag; ellipse centre+radii; line 4 points; pencil >4).
Grid/snap/grid-size -> E2E: grid is a real third Konva layer with exact
line counts; snapped coords asserted exactly, mutation-proven.
Selection/Transformer -> E2E; the corner-anchor drag IS drivable
(`getAbsolutePosition()`), proven to reach the store by Undo->Redo
round-tripping scaleX — no disposition needed. Delete/Backspace + the
in-field INPUT guard -> E2E, guard mutation-proven; no confirm dialog
asserted via dialog spy. LayerPanel all six row controls -> E2E
(invisible layer stops rendering; locked drag refused with byte-equal
x/y, mutation-proven; both reorder no-op ends; duplicate +20/+20 on
top). PropertiesPanel every field incl. 7 rotation presets, opacity
readout, and the text subtree; line layer offers none -> E2E. Import:
drop in both states + `.txt` exact-copy refusal + `+ Import image` via
Playwright's filechooser (real input path, NOT HL) + `+ Add text` +
paste via a real Electron clipboard image and Ctrl+V -> E2E. Export
PNG/JPG/scale/quality/filename patterns -> E2E on real bytes (PNG
header dims; JPG >=10% smaller at 50%) via `session.will-download`;
export dims are document dims [T-45, fixed round 28], content is the
document only [T-53, fixed round 29] and carries the document
background [T-54, fixed round 40 — probe pixel out of the PNG and the
JPG]. Emote pack -> three downloads, three names, 1:2:4 ratio, three
distinct payloads, transparent alpha kept; JPG takes the single-file
path. Variants generate/save/regenerate/save-all/Close -> E2E incl. a
re-reads-the-canvas proof, saved bytes pinned at document size and the
reopen driven both ways [T-46, fixed round 40]. Undo/redo
buttons + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z + redo-branch drop -> E2E.

### Video pipelines (T-23) — Video 4g, 4j-4p, 4r-4t

4g ChatHighlightPanel (5/5) -> E2E: spike found in an
arithmetic-designed log, `+ clip` lands the padded range, bucket/pad
inputs re-derive the peak, both exact-copy negatives; the silent
`+ clip` no-op pinned [T-48] — UPGRADED round 32: success toast gated
on the store's answer, past-the-end refusal copy asserted, overrun
clamps and lands; see the round-32 section. 4j HighlightPanel (5/5) -> E2E: real
ebur128 scan of a generated burst fixture, SignalBars, `+ Clip`,
debounced chat rescore moving all three signals 0->100, Cancel kills a
live scan on a ~20-min `-stream_loop -c copy` fixture. 4k Reframe: 4
positions + output dir + real run (ffprobed incl. SAR 1:1 for T-12) ->
E2E; cancel -> HL-timing (a 2 s clip reframes faster than a click can
land; deepest: round-17 cancelReframe unit + the same cancel pattern
driven live in PiP); toast Show -> HL-shell. 4l Gif (3 selects + dir +
real run, frame count proving fps+speed) -> E2E; cancel HL-timing;
Show HL-shell. 4m Compilation (fade slider + dir + real run with
duration = sum of ranges + panel-absent-with-one-clip) -> E2E; cancel
HL-timing; Show HL-shell. 4n PiP (9/9) -> E2E: both file pickers via
the queued dialog stub, all 3 geometry controls, composite ffprobed,
negative, real cancel of a 20-min job. 4o Captions (18): setup toggle,
refresh status, both doc links, both folder buttons, model-download
button, Transcribe-opens-setup, ALL style controls via a
project-file-restored srtPath (the only whisper-free route in), trim,
and Save .srt writing through the main-process confinement check ->
E2E; transcribe execution HL-whisper; model download/cancel HL-network
(141 MB, local-first — deliberately not clicked); burn-in + its cancel
HL-dialog + Layer 5 (`runBurnIn`); the folder buttons' OS side
HL-shell. 4p ClipKit (6/6) -> E2E: full kit run (5 platform MP4s + 3
thumbnails, ffprobed) + `clipKit.lastOutputDir`; safe-zone and cancel
modals both branches, no jpg leak; `copySrtTo` not exercised (needs
srtPath + a kit in one session; deepest: `captions:copySrtTo` IPC
unit). 4r PostChecklist (10/10) -> E2E: title ideas + all 6 hashtag
packs reach the REAL system clipboard (read back in main), all 6
platform toggles, diary -> `settings.postingDiary` on disk with
localStorage proven empty, perf inputs, delete. 4s CustomPresetManager
(12): 11/12 E2E — full CRUD to on-disk JSON, both confirm branches,
both exact validation toasts, Escape/Done/Close; scrim-click owned by
the T-21 Modal contract; custom presets never become export targets,
pinned in both directions [T-50]. 4t ExportPanel (13): 12/13 E2E — 2
clips x 2 presets -> 4 template-named ffprobed files + persisted
settings; watermark reaches the filter graph, and since round 41 BOTH
halves of it persist — handle + `watermarkPosition` on disk, then read
back off the live panel after a relaunch on the same userData, and
absent together when the watermark is blank [was T-49 pin: position
never persisted]. The dead "No presets selected on any clip" branch is
deleted [T-49]; the disabled Export button is the whole refusal, with
the copy's absence pinned in `interactionWiring.test.ts` (a string
nothing renders is invisible to a DOM test) and the E2E toast-log
tripwire kept for the other direction. Safe-zone modal both branches; cancel modal both branches
(real SIGKILL); refusals without an output folder / selection; per-row
Show HL-shell. Watermark PIXELS: proven on win32
since round 45 — the T-51 Layer 5 block (four corners + two overlays
diffed against a control render) executes in the release workflow's
test:media step; two linux pins fail loudly if ffmpeg-static ever
gains drawtext.

---

## HAND-TEST — Windows, real hardware (T-27; the only manual residue)

The two HL elements above plus the live compositor are the entire
manual surface of the app. Run on the portable exe from `npm run dist`,
on a machine with a working mic and webcam. Each step names its
expected end state; anything else is a regression (or the named open
ticket).

1. **Sources grid.** Open Record, click "Pick a screen or window". ->
   Grid fills with one card per monitor AND one per open window, each
   with a live thumbnail, correct title, and `screen`/`window` under
   it. The first card is already ringed and "Start recording" is
   enabled. Click a WINDOW card — ring moves, Start stays enabled.
   (E2E only ever sees one `screen` source; per-window enumeration and
   titles are Windows-only.)
2. **Mic select.** Tick "Record microphone". -> A `<select>` appears
   (not the "No microphone found." warning) listing real device names.
   Pick a non-default device. Record 10 s of speech, save, play back.
   -> Audio present, from THE DEVICE YOU PICKED, in sync.
3. **Webcam select + PiP corner.** Tick "Include webcam in recording".
   -> A camera `<select>` appears alongside the Corner picker. Set
   Corner to Top-left, record 10 s, save, play back. -> Webcam
   composited at the top-left, correct aspect (face not stretched),
   margin scaled to resolution (~19 px at 1080p, ~38 px at 4K). Repeat
   for the other three corners. (Covers what only `computeCornerRect`
   geometry covers today.)
4. **Webcam without touching the dropdown.** Tick the webcam box and
   Start WITHOUT opening the camera select. -> The saved file still
   contains the webcam (`effectiveCamId ?? cams[0]` fallback). If it
   is screen-only, that is a regression.
5. **Mic + cam + screen together.** All three on, record 30 s, save.
   -> One file: screen video, webcam corner, mic audio, all in sync,
   no drift at the 30 s mark.
6. **Esc stop.** Start a recording, press Esc (focus anywhere, not on
   a button). -> Stops immediately, saving card appears. Esc again
   while idle -> nothing happens.
7. **Convert on.** Leave "Convert to MP4" ticked, record 30 s, save.
   -> Save dialog defaults to `.mp4` with an MP4 filter; progress bar
   advances; result opens in Windows Media Player / Photos.
8. **Convert off.** Untick it, record 30 s, save. -> Dialog offers
   `.webm`, save is near-instant with no progress phase, file plays in
   a browser.
9. **Discard mid-save.** Record 60 s with convert ON, Stop, click
   "Discard recording" while the bar is moving. -> A calm "Recording
   discarded." message (no error styling) and NO file at the chosen
   path (T-44, fixed round 32); `%APPDATA%/imagii/recordings` empty
   afterwards. A raw IPC/ffmpeg error toast or a stranded unplayable
   `.mp4` is a regression.
10. **Cancel the save dialog.** Record, Stop, Cancel in the native
    dialog. -> "Recording discarded." toast, no file written,
    recordings dir empty, nothing in Video Studio's recents.
11. **Toast actions.** Complete a save. -> Toast reads `Saved N.N MB.`
    with Show and Edit in Video Studio. Show -> Explorer opens with
    the file selected. Redo, Edit in Video Studio -> lands in Video
    Studio with the recording loaded, correct duration, scrubbable.
12. **Leave mid-recording.** Start recording, click Home. -> Native
    confirm: "A recording is in progress. Stop and save it before
    leaving? (Cancel keeps recording.)" Cancel -> still recording,
    clock running. Again, OK -> stops and runs the normal save flow;
    the take is kept. (E2E covers the copy and the Cancel branch; OK
    needs the native dialog.)
13. **Quit mid-recording.** Start recording, close with the X. -> App
    exits, no orphaned `ffmpeg.exe` in Task Manager, no multi-GB
    `.webm` partials under `%APPDATA%/imagii/recordings`.
14. **OS capture indicator.** Record with the webcam on, Stop. -> The
    Windows "screen is being shared" / camera-in-use indicator clears
    within a second or two. If it lingers, `screenStreamRef` /
    compositor teardown regressed.

---

## Dispositions — round 27 (fix wave batch 1: T-37)

Seeking works, so the seek rows stop being request-level:

- **Player arrow nudges (2), `,`/`.` frame keys (2), frame-step buttons
  (2):** upgraded from "seek requested" to landed-playhead E2E —
  video-core.spec.ts "player keyboard: nudges and frame steps land the
  playhead, I and O move the clip range" asserts both the exact
  requested time AND `currentTime` within half a frame (0.0333 s at the
  15 fps fixture; Chromium lands within 1 microsecond, the tolerance is
  headroom).
- **New row — media seekability itself:** video-core.spec.ts "player
  seeking: the source is seekable and parks mid-file without playing
  (T-37)" — `video.seekable` is one range spanning the duration; a park
  at 1.5 s of a 2 s clip with Play never pressed (readout `0:01.5`,
  timeline playhead at 70-80%, still paused, frame decoded); then a
  backwards seek. No prior row covered the media element's own
  capability, which is exactly where the shipped break lived.
- **Trust boundary widened, refusals intact:** protocol.test.ts 17 ->
  42 — Range is new input at the imagii-file:// boundary; one named
  case per malformed form, 416 only for a valid range missing the
  file, and every original path-safety refusal re-asserted (plus
  hostile-path-with-Range) against the no-file-access recorder.
- Gap that remains, now ticketed [T-52]: the Timeline track draws a
  playhead but takes no click — click-to-scrub does not exist; plus two
  seek edges (source-change playhead reset, tail nudge clamping to the
  ffprobe duration ~20 ms short of the element's).

## Dispositions — round 28 (fix wave batch 2: T-45)

- **Image · Export button (PNG/JPG) + Scale select:** end state upgraded
  from screen-zoom bytes to DOCUMENT-size bytes — 0.5x/1x/2x now assert
  exact document multiples (640x360 / 1280x720 / 2560x1440 from the
  1280x720 template), PNG-header verified.
- **Image · emote-pack branch:** asserts exactly 28/56/112 on both
  axes — the labels' promise, Twitch-acceptable.
- **New row — export window-invariance:** image.spec.ts "the export is
  the document, not the window: two window sizes, same bytes" resizes
  the real BrowserWindow (1100x700 -> 1560x980, fit-zoom observed
  moving) and asserts byte-identical PNGs. Expediter mutation re-run:
  removing the scale neutralisation flips exactly this test red while
  the dimension tests stay green — dimensions alone cannot catch zoom
  leaking into content, which is why this row exists.
- Known remaining capture defects, ticketed: [T-53 P1] Transformer
  handles + grid layers bake into export bytes — FIXED round 29, see
  below; [T-54] doc background dropped (transparent PNG / black JPG);
  [T-46 extended] variants save path still captures at screen zoom,
  unpinned today.

## Dispositions — round 29 (fix wave batch 3: T-53)

- **Image · Export button + Scale select:** end state extends from
  document-SIZE bytes (round 28) to document-CONTENT bytes — the PNG is
  identical whatever the selection or grid state. Canvas.tsx tags its
  two editor layers `chrome` (grid, overlay/Transformer);
  captureDocument switches them off for the capture and restores each
  layer's PRIOR flag in the finally.
- **Image · Grid checkbox / Selection + Transformer:** each gains an
  export-side end state — visible on canvas, absent from the file.
- **New row:** image.spec.ts "editor chrome stays out of the file:
  selection and grid leave the bytes alone" — four-way byte comparison
  (baseline / selected / grid on / both) with a determinism guard, plus
  chrome-restored assertions after every capture. Discrimination proven
  from BOTH halves: worker dropped the grid tag (exactly the two grid
  cases red), expediter dropped the overlay tag (exactly the two
  selected cases red).

## Dispositions — round 30 (fix wave batch 4: T-52)

Timeline (2 -> 6 elements) plus one Player upgrade; test names in
tests/e2e/video-core.spec.ts and tests/unit/hotkeyTable.test.ts.

- **Track click (scrub surface, role="slider" aria-label="Playhead"):**
  "timeline: clicking the track scrubs there, dragging scrubs
  continuously, and the trim handles keep priority (T-52)" — landed
  playhead at 25%, drawn marker 24-26%, still paused.
- **Track drag (continuous scrub):** same test — three positions in one
  gesture, each landed; mouseup ends the gesture (a later move scrubs
  nothing).
- **Slider keys Left/Right (0.1 s) + Home/End:** "timeline: the track
  is a keyboard scrubber — arrows nudge, Home and End jump (T-52)" —
  incl. the floor-at-0 negative and aria-valuenow tracking. Expediter
  mutation: End -> 0 flips exactly this test red.
- **Negative — trim-handle priority:** the click/drag test proves a
  drag starting on a handle moves the Out point with the playhead
  unmoved.
- **State honesty:** "timeline: the playhead never lies — store churn
  keeps it, leaving and returning resets it (T-52)" — the marker and
  the media element cannot disagree (pre-fix red: marker at 60% over a
  video at 0).
- **Player tail nudge (row upgrade):** "player: a tail nudge reaches
  the media element own duration, not ffprobe rounded one (T-52)".
- **HotkeyOverlay /video table:** +Home/End, +Click timeline (mouse
  hint), pinned by the hotkey checker (32 -> 35 cases).
- Residue ticketed [T-56]: playhead marker color is raw pink-400 (not
  a token); the track's coordinate space ends at the probe duration,
  ~20 ms shy of the element's.


## Dispositions — round 31 (fix wave batch 5: T-31 + T-32)

- **Shared - AppToaster surface:** app-level single mount (STYLE_GUIDE
  rule; react-hot-toast renders its whole global bucket per bare
  Toaster, so duplicates would double every toast). Covered:
  home-chrome.spec.ts Restore-toast-visible-on-Home positive +
  [data-rht-toaster] count = 1 on Home AND a studio route;
  interactionWiring.test.ts "T-31" block (mounted in App.tsx outside
  Routes, no studio copy).
- **Home - Undo button:** cross-route and newest-first — "Home global
  Undo walks the studios newest-first — a video edit and a canvas
  edit". Expediter mutation: loop reversed to oldest-first flips
  exactly that test.
- **Home - Redo button:** defect pin retired — "Home global Redo
  enables after an Undo and re-applies the change".
- **Home - "last:" readout:** semantics pinned — names the studio the
  NEXT Undo targets (flips as entries are consumed).
- Unit: useGlobalUndo.test.ts (11) — counting reconciler, capped-push,
  reference-identity filter, redo mirror.
- Residue ticketed: [T-57] discard() unhandled rejection; [T-58]
  References work invisible to global Undo (no history store — owner
  call).


## Dispositions — round 32 (fix wave batch 6: T-44 + T-48)

- **Record - Discard recording:** end state upgraded from the T-44 pin
  to the calm path — record.spec.ts '"Discard recording" kills the
  running convert, says so calmly, and leaves no file behind': neutral
  toast with the trash icon (proving toast(), not toast.error), no
  raw-IPC/SIGKILL vocabulary anywhere in the toast log, chosen path
  absent, recordings dir empty, recents untouched. Expediter mutation:
  disabling the ConvertCancelledError instanceof flips exactly that
  test. HAND-TEST step 9 updated to match. The crash branch (real
  ffmpeg failure) still strands its partial output — pinned in
  recordingCancel.test.ts for [T-59].
- **Video 4g - ChatHighlightPanel + clip:** both branches driven —
  wholly-past-the-end refuses with exact copy and no success toast
  ('That spike is past the end of this video — check the log matches
  this source.'), overrun clamps and lands as a real ClipList row.
  addClipFromRange's boolean return is unit-pinned in
  videoStore.test.ts.
- New unit surface: convertCancel.test.ts (10 — sentinel semantics,
  slot lifecycle, crash vocabulary preserved).

## Dispositions — round 33 (fix wave batch 7: T-36 + T-55)

- **Audio - waveform region-drag:** one gesture commits one cut (the
  panel copy's promise); the T-24 tripwire is flipped and the second
  gesture deleted from dragCut. New coverage: second overlapping drag
  gets its own chip; a drag running INTO an existing cut commits;
  store re-render never self-duplicates ([part^="region "] pinned).
  Expediter mutation: id-prefix guard inverted -> exactly the cuts
  test red. Known residue [T-61]: a drag STARTING inside an existing
  cut is swallowed by that region's preventDefault.
- **Test infrastructure (affects every mouse-gesture row):**
  tests/e2e/drag.ts is the house gesture helper — redundant sends,
  press+move in one wire batch, poll the app's own drawn state before
  release. Mechanism it defeats: Playwright's CDP mouse never moves
  the real X pointer, so a sibling window mapping mid-drag fires a
  document-level pointerout that ends drags early (wavesurfer treats
  pointerout as pointerup; Konva drops its cached position). A
  truncated gesture now fails by name instead of committing a short
  value. Converted: audio waveform drag, image draw-commit, video-core
  trim + timeline scrub. Still on the old shape [T-62]: image
  Transformer move/resize, video-core crop overlay.


## Dispositions — round 34 (fix wave batch 8: T-33 + T-47)

New and changed elements; tests in tests/e2e/{continuity,home-chrome}
.spec.ts and the unit files named inline.

- **AutosaveRestore - Restore:** now applyProject -> applyPlace ->
  navigate: stores rehydrated, ROUTE restored, clip + layer selection
  and playhead applied (half-frame tolerance), Undo AND Redo disabled
  post-restore (fresh history — the open-a-file contract). COV
  continuity "two studios..." + home-chrome.
- **AutosaveRestore - Discard / Later:** unchanged semantics, re-proven
  opt-in both ways (fresh-start session untouched). COV both suites.
- **AutosaveRestore - Clear + Dismiss (corruption banner):** were
  "unreachable [T-33]" — now COV: banner + verbatim copy + mtime age,
  Clear deletes the file and toasts "Autosave discarded.", Dismiss
  keeps the file byte-identical and reveals the Last-autosave line,
  reload persistence both ways. Residue [T-57, severity raised]: a
  FAILING clear still spins silently.
- **Window close (X):** bounded 1.5 s autosave flush + synchronous
  bounds persist — the snapshot is the LAST state, proven by a
  3rd-edit-then-immediate-close E2E; timeout branch unit-tested with a
  write that never settles. COV continuity + quitFlush.test.ts.
- **App quit:** before-quit flush backstop (the only event when
  windows are destroyed without the X). COV continuity "quitting the
  APP...". The two paths overlap by design; disabling both fails the
  E2E, disabling either alone is covered by the other.
- **Window move/resize:** debounced windowBounds persist; exact
  {x,y,w,h} round trip across launches asserted BEFORE any banner
  interaction (independent of the choice); off-screen 9000,9000
  recovers centered-on-primary with size kept. Bounds driven via
  app.evaluate — a real title-bar drag is OS chrome, HL-dialog class.
  Expediter mutation: visibility threshold broken -> exactly the two
  display-gone unit tests red.
- **Window maximize/unmaximize:** HL — xvfb runs no window manager
  (probed: maximize() is a no-op, isMaximized() stays false). Deepest:
  windowSizing.test.ts carries-the-maximized-flag case + the
  non-maximized round-trip E2E. Windows hand-test: maximize, quit,
  relaunch -> maximized with the pre-maximize size remembered on
  un-maximize.
- Schema surface: place record v3 per-field degradation table pinned
  in projectValidation.test.ts + ProjectIO.test.ts (bad field drops
  alone; all-bad degrades to data-only; v1/v2 fixtures unchanged).


## Dispositions — round 35 (fix wave batch 9: T-38 + T-39)

- **Video - OutputPreview:** new pin "output preview: a freshly
  imported video draws a real frame with no edit first (T-38)" —
  canvas at the platform's 135x240 (not the undrawn 300x150 default),
  pixels differ from a backdrop-only canvas, Undo asserted disabled on
  both sides so the test cannot pass by editing. The platform-select
  and crop tests no longer need playback for pixels.
- **Video - safe zones + CropOverlay geometry:** "overlays: the crop
  rect and the safe-zone guides sit on the picture, not the letterbox
  (T-39)" — guide svg and crop rect match the element's own
  contain-fit rect to the pixel at two window sizes, with the
  letterbox first asserted 40+ px wide. Expediter mutation:
  computeCropBox centering dropped -> three named unit tests red.
- **Video - Crop control row:** moved above the player (tutorial
  promise); row-clears-the-box asserted; data-tutorial="video-crop"
  still resolves (39/39 checker). Component split CropControls /
  CropOverlay recorded.
- Test-hygiene note: video-core's canvasSnapshot uses a bare
  document.querySelector('canvas') — correct while /video has one
  canvas; revisit if a second lands.
- Residue ticketed [T-63]: Space on a focused crop button double-fires
  (button activation + playback toggle).


## Dispositions — round 36 (fix wave batch 10: T-34 + T-35)

- **Tutorial coachmark placement:** all four placements pass one
  pipeline (side -> opposite -> cross axis -> clamp of last resort);
  measured-size geometry. E2E at 1280x800 on the real Video step 2
  offender; 61 unit cases. Residue ticketed [T-64]: aria-modal without
  a focus trap; 300 ms poll churn.
- **Tutorial Enter:** exactly one step, both focus states, pure
  tutorialKeyIntent unit-covered.
- **ErrorBoundary:** see the upgraded round-25 row above; the
  production-shipping gated crash route is recorded in the hooks line.


## Dispositions — round 37 (fix wave batch 11: T-50 + T-42)

- **Video 4t ExportPanel:** preset checkboxes are x5 platform + one
  per saved custom preset (bordered `custom` tag, existing pinned
  token pairing). T-50's both-direction pin flipped: custom preset
  ticks, exports at its stored dimensions (ffprobe-verified E2E +
  6-case Layer 5), delete-while-queued degrades with no ghost row and
  the in-flight job finishing at resolved dimensions. Store hygiene
  (prune, not-undoable) is unit-owned: videoStore.test.ts x3 —
  expediter's E2E-layer mutation stayed green while exactly those
  three went red, the intended layering.
- **Video 4s CustomPresetManager:** 12 -> 13 elements (new
  bitrate-refusal negative); the dead-end footer clause replaced by
  copy stating what presets do, pinned in both directions; scrim-click
  still owned by the T-21 Modal contract.
- **Record:** Webcam `<select>` LEAVES the HL block via the
  stubCameras helper (labels, value, `selectedCamId ?? cams[0]`
  default asserted). HL count 2 -> 1 (Microphone only). The T-42 pin
  ("no zero-camera hint, PiP silently dropped") flips: "No camera
  found." warning mirrors the mic branch, Corner gates with the
  select, Start with a ticked-but-absent webcam raises the existing
  "Webcam failed: ... Recording screen only." toast. HAND-TEST steps
  2-3 narrow to the microphone select + the live compositor.


## Dispositions — round 38 (fix wave batch 12: T-58 + T-30)

References grows 20 -> 23 elements; tests in references.spec.ts,
home-chrome.spec.ts, referencesStore.test.ts (13), moodboard.test.ts.

- **References - header Undo button (NEW):** "a deleted mood board
  comes back whole — items, thumbnail and file — on Undo" (board +
  items + board JSON restored byte-identical, thumb re-decodes) and
  "a saved item goes to the canvas as a 40% overlay, and Remove is
  undoable". Expediter mutation: restoreCollections made a disk no-op
  -> both E2Es red on their disk assertions.
- **References - header Redo button (NEW):** same E2E, redo phase —
  the board leaves screen AND disk again.
- **References - Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z (NEW, shared hook):** same
  E2E keyboard phase; interactionWiring asserts four studios share the
  binding; hotkeyTable gained the /references rows.
- **Home - "last:" readout:** also names References — the ordering E2E
  now walks video -> mood board -> canvas.
- **Amended:** board delete (NAT confirm stays) and item remove are
  reversible; item-remove's end state changed from thumb-unlinked to
  thumb-survives-for-undo, swept at next launch by sweepOrphanThumbs
  (launch-time element, disposition: covered by moodboard.test.ts both
  ways — reap on sweep, refusal on corrupt board).
- **References - search error path:** upgraded from the raw-IPC pin to
  the friendly amber notice with exact copy, rose error card asserted
  absent ("Reference Search surfaces the friendly notice when the
  network is unreachable").


## Dispositions — round 39 (fix wave batch 13: T-57 + T-59 + T-60)

The error-path cluster. No new elements; three rows change end state,
all in main-process failure handling. Tests in
tests/e2e/{home-chrome,record}.spec.ts, tests/integration/media.spec.ts
and the unit files named inline.

- **Home - AutosaveRestore Clear / Discard:** end state gains its
  refusal branch. A failing `autosave:clear` used to reject unhandled —
  no toast of any kind, the banner in an ambiguous state, and (because
  main swallowed every unlink error) usually no failure reported at
  all. Now: `Couldn't clear the autosave: <reason>. It's still on disk
  — close anything using it and try again.`, the banner STAYS with
  Clear still offered and enabled, and the file is still there. E2E
  "AutosaveRestore: a clear that fails says so and leaves the banner
  and the file alone" drives both halves in one launch — the refusal,
  then the same button succeeding — so the two copies are read side by
  side. Clear also gains `disabled={busy}`, matching Discard. Main's
  half is unit-covered in autosave.test.ts (clearAutosave now reports
  a file that survived the unlink, and names which one).
- **Record - finalize save dialog (crash branch):** was "a real
  ffmpeg failure keeps its error text and travels up" — which meant
  `Error invoking remote method 'recording:finalize': Error:
  convert-to-mp4 exit 1: <stderr tail>` in a toast, and the
  half-written .mp4 left at the user's chosen path (pinned for T-59 in
  round 32). Now: the partial is reaped on both branches, and the
  failure crosses the IPC as `Converting the recording to MP4 failed
  (ffmpeg exit code N). Nothing was saved — try again, or untick
  "Convert to MP4 after recording" to keep the WebM.` E2E "a convert
  that really crashes says so in plain words and leaves nothing
  behind" (real ffmpeg, real failure — an unwritable output path)
  asserts the copy and the absence of the invoke envelope, ffmpeg
  vocabulary, and the calm discard copy; the reaping half is
  recordingCancel.test.ts, where the convert can write bytes and THEN
  fail (the round-32 pin flipped from `toBe(true)` to `toBe(false)`).
- **Record - Discard recording:** unchanged for the user, rebuilt
  underneath. Cancellation is keyed on the owner that started the
  convert, so this button can no longer reach an import transcode.
  Layer 5 "discarding a recording leaves a concurrent import transcode
  running to completion" runs both encodes for real and ffprobes the
  survivor; convertCancel.test.ts covers the registry (18 units, was
  10: per-owner scoping both directions, two jobs in one owner,
  cancelAll, and a finished convert no longer clearing someone else's
  registration).
- **Video 4j - HighlightPanel +Clip:** success toast gated on
  `addClipFromRange`'s boolean, the shape T-48 fixed next door in
  ChatHighlightPanel; a refused range now says "Couldn't add that clip
  — the highlight is outside this video." instead of claiming a clip
  that was never made. Not reachable as a false success today (the
  finder's candidates come from the loaded source), so it is pinned
  structurally in interactionWiring.test.ts rather than driven E2E.
- New shared surface: `src/shared/ipcError.ts` (13 units) — the single
  place Electron's invoke envelope is stripped before a message
  reaches a toast. Used by RecordStudio's finalize catch and
  AutosaveRestore's discard catch.


## Round-39 expediter addendum (dedup note, round 40)

The batch-13 worker wrote the full round-39 section above; this
addendum keeps only what it lacked (an accidental duplicate of the
whole section was removed in round 40): the expediter's independent
mutation — ipcErrorMessage's envelope strip disabled -> 3 units + the
real-crash E2E red — and one Shared row: **ipcErrorMessage** closes
the raw-IPC-text class (T-30/T-44/T-59) at a single tested helper (13
units); every renderer catch routes through it.


## Dispositions — round 40 (fix wave batch 14: T-54 + T-46)

The image-capture pair. No new interactive elements; four rows change
end state, all in `tests/e2e/image.spec.ts` and
`tests/unit/interactionWiring.test.ts`.

- **Image · Export button (PNG/JPG):** end state extends a third time —
  document SIZE (round 28, T-45), document CONTENT (round 29, T-53),
  and now the document's BACKGROUND. New test "the document background
  lands in the bytes, and a transparent doc stays transparent" samples
  one document pixel out of the real exported bytes with the bundled
  ffmpeg (`format=rgba,crop=1:1:x:y`): the PNG reads exactly the
  template's `#241614` at alpha 255, the JPG reads it within a lossy
  tolerance. The probe point is checked against every layer box derived
  from `templates.ts`, so it is provably background. Pre-fix red:
  `rgba(0,0,0,0)` for the PNG, `r=0` (black) for the JPG. Worker
  mutation: deleting the background rect from Canvas.tsx puts both back.
- **Image · emote-pack branch (transparency):** gains an explicit
  negative — the corner of the 112 px pack member is asserted `a === 0`
  after the fix, with the centre pixel asserted to be the circle's own
  fill as a positive control (otherwise a blank export would also pass).
  No per-export "transparent background" control was added: a
  `transparent` fill draws nothing, so the overlay and emote templates
  keep their alpha channel with no UI and no branch.
- **Image · Variants Save / Save all:** end state upgraded from
  `pngSize(w) > 0` — which every PNG satisfies — to exactly the document
  box (1280x720) for the single Save and for all four of Save all,
  after asserting the on-screen stage is NOT 1:1. The dialog now
  captures through the shared `captureDocument`, so variants inherit
  T-45's sizing, T-53's chrome exclusion and T-54's background. Pre-fix
  red: 956x537. Worker mutation: the raw `stage.toDataURL` restored
  writes 956x537 again.
- **Image · Variants button (reopen semantics):** the T-46 stale pin is
  retired and inverted. Reopening an UNTOUCHED canvas keeps the four
  tiles (nothing was invalidated, so nothing is thrown away); reopening
  after any document edit shows zero tiles and the Generate button. Both
  halves are driven in one launch. Regenerate keeps its row: it is the
  same handler as Generate (pinned in interactionWiring.test.ts), and
  the "generating re-reads the canvas" proof runs on the changed-canvas
  path. Worker mutation: dropping the `previews.doc === doc` check puts
  four tiles of the dead canvas back on the reopen.
- Unit: interactionWiring.test.ts +7 (35 in file) — background rect is
  first in the document layer, is not tagged `chrome` (that tag means
  "hide for the capture"), and the CSS `background` is gone; variants
  route through `captureDocument`, keep no raw stage capture, tie
  previews to their document, and share one handler across both buttons.
  All seven proven to discriminate.


## Dispositions — round 41 (fix wave batch 15: T-49 + T-41 + T-43)

- **Video 4t ExportPanel - watermark:** both halves persist and
  restore across a relaunch (handle + position read back off the live
  panel); a blank watermark writes neither key (asserted in the
  four-file queue test). The dead "No presets" copy is deleted;
  source-level pins in interactionWiring keep it dead, the toast
  tripwire keeps the direction covered.
- **Record - zero-sources branch:** the T-41 pin (both branches render
  identically) flips to three driven states — never-searched
  invitation, disabled "Looking for screens and windows...", and the
  amber "No screens or windows found..." — plus a throwing-stub
  refusal that names the fault with the IPC envelope stripped.
- **Record - Corner select:** mount-write pin flips —
  config.json byte/mtime-identical on an untouched visit.
- **Record - MP4 checkbox (was the one non-persisting preference):**
  on-disk write on change, Home round trip, relaunch restore, re-tick
  two-way. Expediter mutation: restore inverted -> exactly that test
  red.


## Dispositions — round 42 (fix wave batch 16: T-56 + T-61 + T-63 + T-66)

- **Video - Timeline playhead:** locator class bg-pink-400 -> bg-ember
  (token; WCAG numbers in the round-42 Done entry). Track space
  reaches the element's duration: aria-valuemax and End read the live
  element; the right-edge POINTER path is a drag (expediter-corrected:
  the strip right of the trim-end handle is sub-pixel at narrow
  geometries and the handle owns clicks by design — the drag carries
  under it, expectation derived from real boxes).
- **Video - Player Space handling:** BUTTON owns Space (activation
  now actually works — pre-fix the container's preventDefault
  suppressed the keyup activation entirely); arrows/,/./I/O stay
  global in the column, asserted from a focused button.
- **Audio - waveform cuts:** a drag STARTING inside a cut commits its
  own cut (pointer-events: none on stored cut marks — wavesurfer
  attaches makeDraggable unconditionally and its preventDefault
  starved the selection handler); the T-36 "starts in the gap"
  workaround retired; cut marks assert the accent fill.
- **References - search:** "No results." never renders under a notice
  (both notice phases), and a NEW empty-but-successful phase proves
  the copy still renders when a search truly finds nothing.
- **References - board delete toast:** "Deleted — press Ctrl+Z to
  undo." pinned verbatim.


## Dispositions — round 43 (fix wave batch 17: T-62/67/70 + T-68/69)

- **Image - studio hotkeys:** new negative end state — Delete/
  Backspace/R/O/L/P/Ctrl+Z all inert behind an open dialog, and each
  drives its real end state again after it closes ("T-68: every studio
  hotkey is inert behind an open dialog, and works again after it
  closes"; useUndoRedoHotkeys.test.ts "never fires while a Modal is
  open"). Mechanism: Modal's module-level open counter, read at event
  time; both halves mutation-proven (worker: consumer check; expediter:
  the counter itself).
- **Record - Refresh sources:** three new negatives — refresh into
  empty (Start disabled + the T-41 card), refresh into a changed list
  (selection moves to a LISTED source, Start enabled), refresh refused
  (selection dropped, error named). "T-69: a refresh reconciles the
  selection...".
- **Test infrastructure:** tests/e2e/toastLog.ts is the one toast
  reader ([data-rht-toaster] [role=status], element-identity dedupe) —
  8 specs converted, 197 duplicated lines gone. drag.ts adoption is
  complete across every mouse gesture. playwright.config.ts pins
  workers: 1 (T-62 fallback branch; the config comment carries the
  mechanism) — full suite 123/123 at ~4.4m, flake class removed.
- Residue ticketed [T-72]: ? stacks the hotkey overlay over open
  dialogs; Record's Escape-to-stop shape noted in the same ticket.


## Dispositions — round 44 (fix wave batch 18: T-65 + T-71 + T-72)

- **HotkeyOverlay ? toggle:** conditional — inert behind any other
  modal, still self-closing (the predicate counts modal claims and
  subtracts its own). Both directions E2E + 4 unit cases; the naive
  guard traps the overlay open behind its own claim (mutation-proven
  by worker), the missing guard stacks dialogs (red-first).
- **Record - Escape mid-take:** guarded by isModalOpen — ? then
  Escape dismisses the overlay only; the next Escape stops the take.
  Expediter mutation: guard disabled -> exactly that E2E red.
- **Export pipeline (Layer 5 surface):** every auto-cropped export
  ships SAR 1:1 (was 405:404 on odd-aspect crops); absolute pins
  added so path-identity cannot mask a shared wrong value.
- **Semantic color tier:** danger/warn/ok tokens across ~28 renderer
  files; five E2E locators renamed in place; MoodBoard remove-chip
  hover is the one behavioral delta (AA fix, 2.93 -> 7.20). The
  NavCard raw accents remain inside their documented exception;
  templates/assetCatalog are now a documented exception of their own
  (artwork specs, not chrome).


## Dispositions — round 45 (T-51 + v1.5.0)

- **Video 4t - watermark / TextOverlayEditor time fields:** pixel end
  states proven on win32 (release runner) — four corners, two
  overlays, enable window both ways, font preflight; linux carries
  the two capability pins. The time fields' SOURCE-vs-clip timebase
  defect is [T-74], filed with a drawbox transcript and noted in the
  v1.5.0 release notes.
- Release infrastructure: release.yml runs test:media on
  windows-latest after verify — the Layer 5 suite now executes on the
  shipping platform every release, closing the "green on linux only"
  gap the v1.3.0 failure exposed.


## Dispositions — round 46 (fix wave batch 19: T-73 + T-28 + T-64)

- **Escape, app-wide:** conditional — the TOPMOST dialog only. Every
  open dialog holds a numbered claim (`hooks/useFocusTrap.ts`) and
  consults it before acting on Escape or Tab. E2E drives the one stack
  a user can build (`?` over a coachmark): one Escape closes the
  overlay, the coachmark survives, a second closes it, and
  `elementFromPoint` proves the overlay is on top rather than dimmed
  under the coachmark's scrim (Modal moved to z-[1200]). Mutation:
  the coachmark's guard removed -> one Escape closes both (red).
  Modal-over-Modal is UNREACHABLE in today's app (no dialog opens
  another; every opener sits behind a scrim) — that half is pinned
  structurally in interactionWiring.test.ts plus 10 pure-predicate
  units, the T-49 precedent.
- **Tutorial coachmark (Shared 21):** Tab cycle + focus restore now
  real, not just claimed by `aria-modal`. E2E: Tab and Shift+Tab stay
  inside the card over 13 presses (red-first: one Tab landed on
  `Home`), Escape and Skip both hand focus back to the opener.
  Mutation: the shared trap disabled -> the coachmark test AND both
  pre-existing Modal-contract tests (Templates, FixWizard) go red,
  which is what "one implementation" means.
- **Tutorial target poll:** `scrollIntoView` fires once per step, and
  the poll only writes state when the rect really moved. Instrumented
  E2E counts the calls in the live page: 7 in two seconds before, 1
  after, and 2 after stepping away and back. `sameRect` unit-pinned
  including a hair over the half-pixel epsilon.
- **References - Rename (was NAT / defect pin [T-28]):** in-app
  `<NameDialog>`. New elements, all E2E-driven to disk in
  references.spec.ts "the Rename dialog renames on Enter and on the
  button, and both cancels leave disk alone": the board-name field
  (pre-filled AND pre-selected, asserted via selection length), Enter
  to confirm, the Rename button to confirm, Cancel, Escape, and the
  blank-name refusal (button disabled, Enter inert, disk untouched).
  Rename goes through the store, so undo/redo are asserted too, and
  the id/createdAt survive (same board, not a new one wearing the
  name). The `pageerror` and native-dialog spies must both stay empty.
- **References - result Save (was HL + NAT first-board prompt
  [T-28]):** the first-save flow is now covered rather than
  dispositioned. references.spec.ts "saving a result with no board yet
  names one, creates it, and saves into it" answers `search:images` in
  MAIN with one synthetic result whose thumbnail is served by an HTTP
  server the test owns, so the cache write is a real `net.fetch`: the
  board JSON, the item, and the cached thumbnail's BYTES are all
  asserted, and the tile is re-read through imagii-file:// with
  naturalWidth 8. Cancel writes nothing. The Save button is no longer
  disabled at zero boards (mutation: re-disable it -> red). Live
  DuckDuckGo results and remote thumbnails remain HL-network.
- **New elements (+6 on References 20 -> 26):** rename dialog field /
  Cancel / Rename; first-save dialog field / Cancel / Create & save.
  Both dialogs are one component (`components/NameDialog.tsx`), so
  Modal's scrim, Escape and focus-restore coverage carries over; the
  per-flow end states are the two tests named above.


## Dispositions — round 47 (fix wave batch 20: T-29 + T-40 + T-74)

- **References - Clear thumbnail cache (was defect pin both directions
  [T-29]):** POSITIVE. `moodboard:clearThumbs` -> `clearThumbCache()`
  (`pruneThumbCache(0)` at the time; renamed by T-79);
  references.spec.ts "Clear thumbnail cache empties the cache under the
  budget too" seeds board-owned thumbs (unowned ones are reaped by
  T-58's launch sweep before anything can be clicked), clicks, and
  asserts an EMPTY directory plus the boards left intact. Mutation: the
  handler put back to the budgeted call -> that assertion red with the
  two files still on disk.
- **New automatic end state (no control):** the 500 MB LRU now runs once
  per launch, chained after `sweepOrphanThumbs`. **Reversed by T-79 —
  see the round-48 section:** behind the sweep the LRU could only delete
  board-owned files, so the budget is gone and this end state with it.
  The launch test it was driven by is now the protection test that no
  board-owned thumbnail is deleted at launch.
- **Video 4e Timeline trim handles / 4i grade sliders + Reset / 4d crop
  rect + aspect presets / 4q overlay fields / Player I-O markers
  ([T-40]):** end state extended from "the edit lands" to "the edit is
  its OWN undo step". `endGesture()` closes the coalescing window at
  each gesture end; two consecutive drags of one handle are two steps
  (video-core.spec.ts "timeline: two consecutive trim drags are two undo
  steps (T-40)", driven with the house `dragTo` helper), and the
  colour-and-motion test now walks Undo/Redo through slider, slider,
  Reset as three separate steps. Mutation: `endGesture` made a no-op ->
  both E2E tests and two store unit cases red. The panel-level
  `onPointerUp` + `onBlur` pair means a control added to any of those
  panels later inherits the behavior; no new interactive elements.
- **Video 4q TextOverlayEditor time fields ([T-74], see round 45):**
  the SOURCE-vs-clip timebase defect is FIXED, so the fields' end state
  is now real pixels on a clip that does not start at 0. Layer 5 cuts
  every T-51 clip at CLIP_START = 2, and two new cases run a real
  `runExportJob` with `drawtext` swapped for `drawbox` (the linux binary
  has no drawtext) — clip-relative window proven on every build,
  including the speed divisor. The win32 drawtext pixel tests carry the
  same claim on the shipping platform via the release runner.


## Dispositions — round 48 (QA follow-ons: T-79 + T-80)

Two rows the round-47 entries above claimed and this round corrects.
No new interactive elements in either ticket; both change what an
existing control's end state is allowed to be.

- **References - mood-board tile `<img>` ([T-79]):** end state extended
  from "the cached bytes decode" to "the tile survives its cache being
  deleted". `onError` swaps the tile to `item.thumbnail`, one way per
  item id. references.spec.ts "a tile whose cached file was cleared
  falls back to its source image (T-79)" drives the real Clear button
  and finds the picture on the next launch — with `naturalWidth`, so
  the fallback is proven to DECODE, not merely to be set. The stand-in
  is the transport, not the code path: the renderer's CSP allows
  `https:` and `data:` for images but not `http:`, so the source URL in
  the fixture is a `data:` URL carrying the same real PNG bytes the
  HTTP-server tests serve to MAIN; live https thumbnails stay
  HL-network as before. Mutation: the `uncachedItemIds` guard removed
  from the src choice -> red, tile still on the dead `imagii-file://`
  URL.
- **References - launch maintenance (no control) ([T-79]):** the
  round-47 budget row is withdrawn — launch runs `sweepOrphanThumbs`
  and nothing else, and the end state under test is now a REFUSAL to
  delete. references.spec.ts "launching far over any budget deletes no
  board-owned thumbnail (T-79)": 600 MB of sparse board-owned thumbs
  plus one unowned orphan; the orphan's removal proves the chain ran,
  and every owned file survives the launch, the app's close and a
  second launch. Red-first against the round-47 chain: three of the
  four board-owned files gone.
- **Video 4f ClipList rename fields / 4q TextOverlayEditor caption,
  colour and number fields ([T-80]):** end state extended from "the
  edit lands and is undoable" to "a caret click inside the field does
  not split it". The panel `onPointerUp` is
  `handleGestureEndPointerUp`, which consults the pure
  `endsGestureOnPointerUp` predicate (unit-tested in
  videoStore.test.ts, node, no DOM) and lets a release inside the
  focused text-entry control through; `onBlur={endGesture}` still ends
  a text edit, and slider/checkbox releases still end a gesture, so
  T-40's coverage is unchanged and green. Driven by video-core.spec.ts
  "clip list: a caret click mid-rename keeps the edit one undo step
  (T-80)" — type, real mouse down/up inside the focused field, type,
  ONE Undo back to "Clip 1", Undo disabled, Redo restores the whole
  edit. Mutation: the predicate's last line forced to `return true` ->
  that E2E red at "HOOK" plus four unit cases red.
- **Video 4i ColorGradePanel ([T-80], verified not changed):** sliders,
  two checkboxes and a button only — no text entry — so its bare
  `onPointerUp={endGesture}` is already correct and was left alone.


## Dispositions — round 49 (T-81 + T-82: two ffmpeg exports that were valid and wrong)

No new interactive elements. Both tickets change what an existing
control's end state is allowed to be, and both end states cross the same
OS boundary as before (the save dialog), so the deepest layer is still
Layer 5 on the production job runner — now with cases that read CONTENT
at an offset, which the earlier cases at startSec 0 / "shorter by the
cut" could not.

- **Video 4o Captions - "Burn into video" button + "Burn captions over
  selected clip range only" checkbox ([T-81]):** end state extended from
  "an MP4 with captions" to "the captions of THE BURNED SPAN, on the clip
  clock". The click stays HL-dialog (`pickBurnInOutput`) plus HL-whisper
  (an SRT needs a transcribe to exist); the end state is proven at
  `runBurnIn` by media.spec.ts, flat-gray source cut 2 -> 5 s: the cue
  inside the range is painted at its shifted output time, the cue before
  it paints nothing where the bug put it, edge-straddling cues keep their
  visible half, a window nobody speaks in yields the clip uncaptioned, and
  the shifted temp SRT is gone after success AND after an ffmpeg failure.
  Pure shifter: src/shared/captions.test.ts. Red-first against the old
  `runBurnIn`; mutation (shifter returns its input) red in both layers.
  The burn's refusal states are covered below the click too: a bad range
  (lone/empty/inverted/NaN/string) is rejected at the `captions:burnIn`
  boundary with a plain message before any work
  (src/main/ipc/captionsBurnIn.test.ts drives the real handler), and the
  shifted temp copy a hard kill could strand is swept at the next launch
  (tempCleanup.test.ts, name-filtered so real transcripts are never touched).
- **Audio - "Re-attach to video" checkbox + Export button ([T-82]):** end
  state extended from "an MP4 with the cleaned sound" to "picture and
  sound cut at the same instants, ending together, with no intermediate
  file left beside it". The Export click stays HL-dialog; its mux-back
  branch is now ONE `audio:mux` call into `runAudioReattach` (the
  renderer no longer names or writes the `.cleaned.wav`), so the whole
  branch below the dialog is exercised by media.spec.ts "audio cuts
  re-attached to video (real ffmpeg, T-82)": stream durations vs source
  minus cut, the frame under a known sound, the sound's burst position,
  frame rate preserved, mux progress moving, the no-cut path
  stream-copied byte for byte, directory contents after success and after
  a failed mux, and the refusal to delete a file the job reads. With the
  checkbox OFF the exported audio file is the deliverable and never goes
  through that function. Red-first against the old behaviour; six
  mutations each red. A secondary (music) track is cut together with the
  voice — one `aselect` on the mix: a burst in the music AFTER the cut
  lands at its shifted output time and all three durations match
  source-minus-cut (media.spec.ts, same block; red-first, and the pre-mix
  cut restored as a mutation -> red).
- **Audio - Cancel button ([T-82], verified not changed):** still kills
  the active ffmpeg child by `jobId` (round-17 units). A cancel now also
  reaches the intermediate WAV's `finally`, which is the same cleanup path
  the failed-mux case covers; a cancel landing in the instant between the
  render and mux passes has no child to kill, as before.


## Dispositions — round 50 (T-83 + T-94: the export grid and the whole-video clip)

No new interactive elements. Both tickets change what an existing
control's end state is allowed to be, and every end state below is
reachable without an OS boundary except the export bytes' save dialog,
which the E2E crosses with the house main-process dialog stub.

- **Video 4d CropOverlay - enable checkbox, aspect presets, drag, resize,
  Reset ([T-83]):** end state extended from "the rect lands in the store
  and the preview redraws" to "every ticked platform exports a centered
  cut OF that rect at its own size, never stretched". Layer 5
  (media.spec.ts "manual crop exported to a mismatched preset (real
  ffmpeg, T-83)") measures a known SQUARE through five real
  `runExportJob` runs — 4:3 -> Reels, 9:16 -> YouTube, 1:1 -> X, an odd
  1919x1079 source, plus the matching-shape control — and asserts it is
  still square, centered and at the hand-derived scale. The same promise
  through the real UI: video-pipelines.spec.ts "a cropped clip exports at
  every ticked platform's own size with square pixels (T-83)" (1:1 crop,
  YouTube + Reels, both files at their preset's size with SAR 1:1).
  Red-first against the old filter: marker 180x426, 568x180, 190x106.
  Mutation (post-crop aspect cut skipped when `cropRect` is set) -> 4
  unit + 4 Layer 5 cases red.
- **Video 4t ExportPanel - platform checkboxes and their SuccessIndicator
  ([T-83]):** end state extended from "the box ticks" to "the card judges
  the frame the export starts from, says WHY, and says it on screen".
  video-pipelines.spec.ts "the grid judges the crop, not the file": on a
  4K 26 s fixture, no crop -> TikTok / Reels "Wrong shape" with the reason
  visible (`getByText`, not `title`); a 9:16 crop drawn through the real
  Crop control -> TikTok and Reels "Great", YouTube / X / Facebook "Wrong
  shape"; unchecking Crop returns the source's verdicts; "Trim" is gone.
  The verdict function itself is `evaluateSuccess`, newly unit-tested in
  presets.test.ts (labels, both-red, minutes wording, every cap is a
  "typical" limit, no reason names a platform, the 9:16-crop matrix).
- **Video 4t ExportPanel + 4p ClipKit - safe-zone modal Cancel / Export
  anyway ([T-83]):** buttons renamed (were "Cancel export" / "Continue
  anyway") with the dialog's title and body rewritten in plain words; same
  two end states as before — declined: no queue, no files, panel
  untouched; accepted: the same batch runs — asserted in the existing
  "safe-zone pre-flight warns before a mixed-aspect batch" and the two
  ClipKit tests, updated to the new copy and the new row format ("<A>
  frame -> cut down for <B>"). New: "with a crop in place the safe-zone
  pre-flight reads the crop" — the same 4:3 clip lists both directions
  uncropped and exactly "TikTok frame -> cut down for YouTube" under a 9:16
  crop (`findSafeZoneIssues` is re-pointed at the clip's effective frame and
  unit-tested in ExportPanel.test.ts for the first time). The modal is not
  one of the Modal-contract tests' named dialogs (Escape / scrim / trap are
  asserted on others); its `<Modal>` wiring is unchanged.
- **Video - OutputPreview platform select ([T-83]):** the canvas now
  draws "your crop, then this platform's shape cut from it" through the
  pure `outputSourceRect` (safeZone.test.ts: with and without a crop, never
  leaves the crop, a crop of the platform's own shape is whole, a corrupt
  rect is no crop). DISPOSITION: the `drawImage` call itself is DOM-bound
  and its pixels under a crop are NOT asserted — the existing video-core
  tests prove the select redraws and that a crop changes the picture; the
  geometry handed to it is the unit-tested part. Candidate follow-up: a
  marker-based canvas read, the preview's version of the Layer 5 case.
- **Video 4f ClipList + 4j HighlightPanel "+ Clip" + 4g ChatHighlightPanel
  "+ clip" ([T-94]):** end state extended from "a clip lands in the list" to
  "the first scanner clip also retires the untouched whole-video clip, in ONE
  undo step, and says so". video-pipelines.spec.ts "the first highlight
  retires the untouched whole-video clip, one undo brings it back, and
  Export writes only what is left (T-94)" drives the VOD path end to end:
  scan the burst fixture, + Clip, the list is exactly [Highlight 1], the
  neutral toast appears once, ONE Ctrl+Z restores "Clip 1" with Undo then
  disabled, Ctrl+Y re-applies both halves, and the export writes exactly the
  excerpt (two files, ~11 s of a 14 s source, none named for Clip 1). Chat
  scanner: "the chat scanner retires it too, a manual + Add clip never does,
  and a clip the user touched is left alone" and "a whole-video clip the
  user has trimmed is theirs". ClipList "+ Add clip" is the negative: a
  manual "Clip 2" of the same whole-video range SURVIVES a scanner add.
  Red-first against the shipped build: `Expected "Clips (1)", Received
  "Clips (2)"`. Mutations: predicate forced false -> unit + both retire
  E2Es red; forced true -> 25 unit cases and the renamed-clip E2E red.
- **Video 4t ExportPanel - Export button ([T-94]):** copy is "Export {n}
  file(s)" (plural-correct through `countOf`, unit-tested in plural.test.ts
  and pinned in interactionWiring.test.ts); the E2E asserts the real
  count at three points (1 file with the whole-video clip, 1 after the
  scan retires it, 2 after a second platform) and that the files on disk
  match it. The pre-existing export tests locate the button by name
  substring ("Export 4") and are green unchanged.
- **Video 4m CompilationPanel - Compile button ([T-94]):** copy is "Compile
  {n} clip(s)" (the panel only renders at 2+ clips). Driven by the
  existing compilation test, updated from the exact name "Compile" to
  "Compile 2 clips"; the header "Compile clips (N)" is unchanged.


## Dispositions — round 51 (T-84: the failure path speaks English)

One new interactive element and a changed END STATE for every control that
can fail or be canceled. The end state used to be "a red toast in ffmpeg's
words"; it is now (a) a plain sentence for a failure, (b) a neutral toast for
a cancel, in kind as well as in words, and (c) a row/banner/screen that says
the same thing after the toast fades. Every `window.api.*` catch in the
renderer now routes through `reportFailure` / `userFacingError`;
`tests/unit/failurePathLanguage.test.ts` parses the renderer and fails on the
old shape, and lists each site that must stay routed.

How the "which kind" question is asserted: `tests/e2e/toastLog.ts` gained
`readToastEntries`, which records whether a toast drew a status icon. A plain
`toast()` draws none; `toast.error` / `toast.success` do. Every cancel E2E
asserts the sentence AND `hasIcon === false` AND that nothing in the log is
in ffmpeg's or the bridge's voice — a cancel raised through `toast.error`
with the right words goes red (mutation below).

- **Video 4t ExportPanel - Cancel / Keep running / Cancel jobs ([T-84]):**
  end state extended from "the batch rejects and rows go red" to "a neutral
  'Export canceled. Files already finished are in your folder.', every row
  that did not finish says **Canceled** (none says Failed), and the label is
  still there after the toaster empties". video-pipelines.spec.ts
  "cancelling a multi-job batch asks first…" (updated). Sentinel plumbing
  below the click: src/main/ffmpeg/cancelSentinel.test.ts, the 'video export'
  rows. Red-first against the old build, quoted: `Received: ["Video loaded",
  "Error invoking remote method 'video:exportBatch': Error: FFmpeg exit null:
  …"]`.
- **Video 4t ExportPanel - Export (a failure) + the queue rows ([T-84]):**
  video-pipelines.spec.ts "a failed export says so in plain words, the row
  keeps saying so after the toast fades, and the next good export is clean":
  the source is removed after import, the REAL job fails, the toast is
  "Export failed. A file imagii needs isn't there. It may have been moved or
  deleted." as an ERROR toast, ffprobe's text is in the console and not on
  screen, the row says **Failed** (one danger bar) and still does once the
  toaster is empty, no file is written, and the next good export carries no
  stale label. The Linux-only watermark test (`drawtext` missing from the
  bundled ffmpeg) now proves the same split: the toast is a plain sentence, the
  console holds `No such filter: 'drawtext'` — still the proof that the
  watermark reached the filter string.
- **Video 4p ClipKit - Cancel / Cancel jobs ([T-84]):** "cancelling a kit
  asks first…" now expects the neutral 'Clip Kit canceled. Files already
  finished are in your folder.' DISPOSITION (unchanged, found): Clip Kit's
  Cancel only reaches the EXPORT phase (`video:cancelAll` kills export jobs);
  a click during the three thumbnail extractions has nothing to kill —
  candidate ticket.
- **Video 4j HighlightPanel - Cancel ([T-84]):** "Cancel kills the scan
  mid-flight…" now expects 'Scan canceled.' (neutral). The old behaviour
  guessed a cancel from ANY SIGTERM/SIGKILL; an outside kill is now a failure
  (cancelSentinel.test.ts, "a kill nobody asked for").
- **Video 4k ReframePanel / 4l GifPanel / 4m CompilationPanel - Cancel
  ([T-84]):** NEW E2E "cancelling a reframe, a GIF and a compilation…" on the
  20-minute source: each panel's own neutral sentence ('Reframe canceled.',
  'GIF canceled.', 'Compilation canceled.'), the button returns, no compilation
  file is left. Failure: "a vanished source fails Reframe, GIF, Compile and
  PiP in each panel's own plain words" — four catch sites, four error toasts
  that lead with their own sentence and end in the one cause, raw errors in the
  console, every panel freed.
- **Video 4n PipPanel - Cancel ([T-84]):** the existing cancel test expects
  'Picture-in-picture canceled.' (neutral); its failure is in the four-panel
  test above.
- **Video 4o CaptionsPanel - Transcribe / Burn into video / burn-in Cancel /
  model download + its cancel button ([T-84]):** DISPOSITION unchanged
  (HL-whisper, HL-network: whisper is not installed in any test environment
  and the model is a 141 MB download). Deepest layer covered, and newly so:
  the runners' own cancel — cancelSentinel.test.ts drives `runTranscribe`,
  `runBurnIn` (both cancel entry points, both exit shapes, the control) and
  `installWhisperModel` (a cancel resolves `{ ok: false, reason:
  CANCELLED_MESSAGE }`; a network error stays a failure) — and the four
  catch/result sites in the panel are pinned routed by the structural test.
- **Audio - Export (success path unchanged) / failure / Cancel ([T-84]):**
  UPGRADED from HL-dialog to E2E: audio.spec.ts stubs the save dialog in the
  main process (the OS chooser itself stays HL, as in video-pipelines) and
  drives the REAL job — a render whose folder does not exist fails with the
  plain sentence and frees the button; Cancel on an hour-long two-pass
  loudness render is ONE neutral 'Audio export canceled.' (the old build raised
  a neutral line from the Cancel handler AND the killed ffmpeg's message in
  red), the button frees, and nothing is written. Behavior change: the Cancel
  handler no longer flips `running` itself — it follows the export call's
  settling, so a Cancel that reaches no child (between passes) cannot re-enable
  Export over a render that is still going.
- **Home - Open project ([T-84]):** end state extended from "toast" to "the
  studios the file can still open ARE open, and ONE message names the file
  that is gone". video-pipelines.spec.ts "Open project with a moved file…"
  (project file + main-process open-dialog stub): canvas, audio and an EMPTY
  video studio; the message exactly; no 'Project loaded' beside it; the
  complete project still says 'Project loaded'. Unit:
  ProjectIO.test.ts — a moved video, a moved audio file, both, none, and a
  place pointing into the empty studio; `describeUnavailableSources`. Red-first:
  `Error: ffprobe exit 1: /home/user/Videos/stream.mp4: No such file or
  directory` (today's abort). Mutation: `loadReporting` rethrowing -> 4 unit
  red, and the E2E red.
- **Home - Save project ([T-84]):** HL-dialog, unchanged; the catch is routed
  (structural test) — a save failure reads "Couldn't save the project." plus a
  cause when one is known.
- **AutosaveRestore - Restore ([T-84]):** same rule as Open project —
  home-chrome.spec.ts "Restore with a moved video opens the rest and names the
  file": the message, no 'Restored from autosave', the canvas layer back, the
  video studio empty.
- **AutosaveRestore - corrupt-autosave banner, Clear, Dismiss ([T-84]):**
  copy rewritten ("imagii found an autosave from a moment ago, but it's damaged
  and can't be restored. Clear it to get rid of it."); the validator's reason
  moved to the console. The two T-33/T-57 E2Es assert the new sentence, that
  'invalid JSON' and 'validation' are NOT on screen, and (after a reload) that
  the reason IS in the console. The structural pins in
  autosaveCorruptInfo.test.ts and interactionWiring.test.ts moved with the
  words in the same change; the branch still gates on `exists` alone.
- **ErrorBoundary - Details disclosure (NEW) / Reload to Home ([T-84]):** the
  screen says "Something went wrong in this studio" and that the work is safe
  and where it is; the thrown message and React's stack are behind a collapsed
  Details. home-chrome.spec.ts (T-35 test, updated): the heading and sentence,
  that the VISIBLE text has no 'render error' or 'report', Details collapsed
  then expanded to the message and a multi-frame stack, the raw-hex styling
  pins unchanged, Reload to Home still recovers.
- **References - Search (button, Enter, in-flight, error card) ([T-84]):** the
  notice is one sentence for both hops and every transport ("Couldn't reach
  DuckDuckGo. Check your internet connection and try again. Your saved boards
  still work offline."); the proxy-hermetic E2E asserts it verbatim on the first
  failure and on the re-run, and that no `net::`, 'DuckDuckGo search failed' or
  'provider' appears. Main's transport detail is in the log
  (duckduckgo.test.ts / search.test.ts assert the `console.error`). The
  rejected-search card (referencesStore) is unit-tested.
- **Video 4a Importer / Audio importer - drop, Choose file ([T-84]):** the
  refusal sentences are exact now, with no IPC preamble (export.spec.ts and
  audio.spec.ts compare the toast entry whole, not as a substring); every
  `describeImportError` branch is unit-tested for both kinds, and an mp3 never
  reads video wording.
- **Record - Start recording failure ([T-84]):** "Start with mic enabled and
  no microphone refuses…" now asserts the plain sentence ("Couldn't start
  recording. That device wasn't found. Check it's plugged in, then try
  again.") and that the browser's 'Requested device not found' is not on
  screen; the webcam fallback toast is "No camera found. Recording screen
  only." (T-42's test updated). DISPOSITION: "Edit in Video Studio" failing
  needs a saved take whose file then vanishes — its catch is the same helper
  call, pinned by the structural test.
- **Stream Graphics - Export / Import / Thumbnail variants; References - Add
  to canvas ([T-84]):** DISPOSITION: the failure branches need a canvas stage
  or an image decoder that fails on cue; their happy paths are unchanged and
  already driven. Each catch is routed through the helper (structural test)
  and the helper is unit-tested on every shape those errors take.


## Dispositions — round 52 (T-85 + T-86: truth in copy, and tours that wait for something to point at)

Two NEW interactive elements (the Clip Kit long-clip confirm's Cancel and
Export anyway) and a changed END STATE for the Clip Kit button, the tutorial's
Skip / Esc, and the first-visit tour of every studio. The rest is copy: no
control changed what it does, so what is asserted is the words on screen and
that the old ones are gone.

- **Video 4p ClipKit - the button ([T-85], end state changed twice):**
  (1) it no longer raises the safe-zone modal — "all five platforms" IS the
  answer to that question, and each platform's centered cut is made on purpose
  (T-83). video-pipelines.spec.ts "one click produces the whole kit…" asserts
  `getByRole('dialog')` has count 0 straight after the click and that the run
  starts without an answer; "cancelling a kit asks first…" no longer has a
  safe-zone decline, and uses a dismissed folder chooser instead (a kit with no
  folder starts nothing, writes nothing, toasts nothing). The manual Export
  path keeps its pre-flight exactly (the T-83 safe-zone tests are untouched).
  Red-first: the old kit raised the modal on every run — the cancel test failed
  with `getByRole('dialog')  Expected: 0  Received: 1`, and the whole-kit test
  failed against the same build.
  (2) it stamps the SAVED watermark (`streamerHandle` + `watermarkPosition`,
  read where the Export panel reads them) on all five platform files. E2E "the
  kit stamps the SAVED watermark on every platform file (T-85)": linux — the
  kit fails in the plain sentence 'Clip Kit failed.', the raw
  `No such filter: 'drawtext'` is in the console and not on screen, no .mp4 is
  written, the saved handle and corner are not rewritten; win32 — five files.
  Deepest layers beneath it: Layer 5 `media.spec.ts` inside the T-51 block
  (the real `runExportJob` driven by the job `buildKitQueue` builds — a win32
  pixel case and a linux pin whose two jobs differ in exactly one field),
  `tests/unit/clipKitWatermark.test.ts` (all five jobs through main's real
  filter graph), `clipKit.test.ts`, `watermark.test.ts`.
  DISPOSITION (OS boundary, not a gap): the win32 pixel case cannot execute on
  the linux runner that builds this repo — the bundled linux ffmpeg has no
  `drawtext`. It is gated exactly like the T-51 cases and runs where the
  product ships (the windows-latest release run); the linux pin beside it fails
  the day drawtext appears, which is what forces the gate to be lifted.
- **Video 4p ClipKit - long-clip confirm: Cancel / Export anyway (NEW,
  [T-85]):** E2E "a clip over a platform's typical limit asks once…" on the
  20-minute source — heading 'This clip is long for some platforms', "This
  clip is 20:0x.", exactly ONE row (Reels — the typical 3-minute limit), no word
  that an upload would be refused; **Cancel** starts nothing, writes nothing and
  never asks for the output folder; **Export anyway** runs the kit with no
  second question (no safe-zone modal follows it) and the run is then cancelled
  through the existing Cancel / Cancel jobs. A clip inside every limit gets no
  question at all (the first kit test). The platform-selection rule is pure and
  unit-tested (`platformsOverLimit`: exactly-at-the-cap is not over, one second
  over names Reels alone, an hour-plus adds TikTok, a vertical source lists
  Reels once, the same caps as the grid's "Too long"). The modal's Escape and
  scrim behaviours are the shared Modal contract (home-chrome.spec.ts), not
  re-asserted per dialog.
- **Video 4t ExportPanel - Watermark field + corner select ([T-85]):**
  unchanged end state, but the spec is now built by the shared
  `buildWatermark` (Export and the kit cannot stamp different looks). The
  T-49 E2E ("the watermark reaches the filter graph, and both halves of it
  survive a relaunch") is green unchanged; interactionWiring.test.ts's pin on
  the handle-and-corner persistence block is green unchanged.
  FOUND, NOT FIXED (candidate ticket): a handle TYPED in the Export panel but
  not yet exported is not "saved", so Clip Kit does not stamp it — the kit uses
  what the last export wrote. The tutorial and USER_GUIDE say so ("After you
  have exported with one, Clip Kit stamps it too"). Saving on blur would close
  it; it was not in the ruling.
- **Video 4k ReframePanel - position buttons ([T-85]):** three buttons
  (Left / Center / Right) where there were four; the fourth, "Auto (centered)",
  was Center under another name. video-pipelines.spec.ts "reframe: the three
  positions are real state…" cycles all three (exactly one active at a time),
  asserts the title 'Reframe to 9:16 (center crop)' and the sentence that it
  does not track faces or action, and that neither 'Auto (centered)' nor
  'Auto-reframe' is on the panel. The `'smart'` position is deleted from the
  renderer type, `shared/api.ts`, main's `ReframePosition` and the IPC
  validator. NOTHING PERSISTS a reframe position (panel-local state, never in a
  project or an autosave), so there is no stored value to migrate — verified by
  grep, not assumed. Layer 5 "left and right positions keep different parts of
  the frame" is unchanged and green.
- **References - Reference Search, the SafeSearch line ([T-85]):** copy only.
  references.spec.ts "the three tabs swap panels…" asserts the exact sentence
  (DuckDuckGo does the filtering; imagii does not scan images itself; search is
  the one feature that goes online) and that "screened locally" is gone.
- **Home - Record NavCard, footer; Welcome - "Let's go" screen ([T-85]):**
  copy only. home-chrome.spec.ts "Welcome \"Let's go\"…" asserts the Welcome
  clause naming the two online exceptions, then on Home the Record card's exact
  sentence (no "one-stop", no "alternative to OBS") and the footer's clause.
- **Record - header ([T-85]):** record.spec.ts asserts the new header ("Capture
  a screen or window, with optional webcam and mic — saved locally as MP4 (or
  WebM)."). DISPOSITION: the behaviour behind it — no game or desktop audio,
  webcam-only impossible, Esc-to-stop only with focus — is T-88's, deliberately
  untouched; RecordStudio's device logic is unchanged.
- **HotkeyOverlay - the Home "Save project" row ([T-85]):** copy only.
  home-chrome.spec.ts "HotkeyOverlay: ? opens the route table…" asserts the new
  description and that "Save full app state" is gone; hotkeyTable.test.ts
  classifies the row by its key and is green unchanged.
- **Tutorial - Skip button, Esc, Done ([T-86], end state changed):** all three
  are one act now and all three PERSIST the first-visit flag. home-chrome.spec.ts
  "Skip persists…" and "Escape persists…" (one test each): import a video, the
  tour opens, close it, poll config.json until `tutorialSeen.video === true`
  (red-first: `Expected: true  Received: undefined` — the old Skip never wrote
  it), leave for Home and come back (no tour), then relaunch on the same
  userData and import again (no tour). The old test "Skip and Escape close it
  WITHOUT persisting" asserted the bug and was deleted.
- **Tutorial - the first-visit tour of every studio ([T-86], end state
  changed):** it waits for something to point at, and shows only steps whose
  target is on the page. "an empty video studio gets no tour; the first import
  opens it…": two seconds on the empty studio with no dialog and the flag
  untouched (red-first: `getByRole('dialog')  Expected: 0  Received: 1`), the
  drop opens it, and walking it visits exactly the steps whose target is on
  screen — each targeted step draws its cutout, the importer's step is absent
  (the importer is gone), the tour is shorter than its definition. "Audio Studio
  and Stream Graphics hold their tours until there is content; References has
  one from the first visit" does the same for the other three studios (a dropped
  wav; a clicked template). Unit: `useTutorial.test.ts` (the rule as pure
  functions against a fake page), `tutorialCopy.test.ts` and
  `tutorialTargets.test.ts` (every step still resolves on its route).
- **Tutorial - TutorialButton '?' ([T-86]):** unchanged control; on an empty
  studio it opens the three-step tour (welcome, importer, sign-off) rather than
  the full one — the T-34 clamp test, the T-64 Tab-trap/focus-restore and
  scroll-once tests and the T-73 stacked-Escape test now start it from this
  button, and are otherwise unchanged in what they assert. Nothing in the
  coachmark chrome (Next, Back, scrim advance, arrows, Enter, the claim stack)
  changed: the run-through test is the same assertions over a loaded studio
  (11 steps, not 12 — the importer's step drops out).
- **Tutorial copy ([T-86]):** every control a step names in 'single quotes' is
  looked up in the studio's own source (the tutorial files themselves excluded),
  and the words that were wrong or were jargon are banned. DISPOSITION: that
  proves the NAME exists on the route, not that the control is on screen at that
  moment — the E2E walk proves the cutouts, and only for the fixtures it loads.
