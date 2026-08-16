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
covered by T-25 (round 26). The orphaned getStageDataUrl() this note
used to flag was deleted in round 29 (T-53 rider) — it was the last raw
stage.toDataURL() outside ThumbnailVariants, i.e. a ready-made way to
reintroduce T-45/T-53.

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
E2E; Redo -> defect pin [T-32] at round 25 — UPGRADED round 31 to
positives (cross-route undo, Redo re-applies, newest-first ordering),
see the round-31 section. Open/Save project -> HL-dialog (deepest:
ProjectIO + projectValidation units). AutosaveRestore: Restore/Discard/
Later -> E2E; Clear/Dismiss -> corrupt-offers-nothing pin + unit
[T-33, unreachable today]. Modal contract (scrim/stop/Escape/trap/
restore) -> Templates + FixWizard E2E. Tutorial: full-run/Back/arrows/
scrim-advance/Skip-no-persist -> E2E; Enter -> pin [T-34 double-step].
RecentFilesMenu (toggle/item/clear/Escape/click-outside) -> E2E;
mouse-leave -> unit policy. HotkeyOverlay ?/Esc -> E2E. AppToaster ->
E2E on studios; absent on Home [T-31] at round 25 — UPGRADED round 31:
one app-level mount, asserted on Home and a studio route.
ErrorBoundary -> OPEN [T-35].

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
composition). Rename + first-save prompt -> defect pins [T-28]. Clear
thumb cache -> defect pin both directions [T-29].

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
via a main-side getSources stub, pinned [T-41: both branches render
identically]. Start refusal (mic on, no device) -> E2E, no orphaned
temp. Stop -> real WebM on disk (ffprobe: webm container, video stream,
no audio stream) + `Saved N.N MB.` toast. Esc -> real MP4 (ffprobe:
mp4/h264) through the convert phase. Mic checkbox both branches
(zero-device warning asserted, select asserted absent). Webcam checkbox
-> Corner select with its four exact labels [T-42 pin: no zero-camera
hint, PiP silently dropped]. Corner select -> `record.webcamCorner` on
disk AND restored by a second launch on the same userData; the
mount-write is pinned [T-43]. MP4 checkbox -> toggles, resets on
revisit, writes nothing [T-43 pin]. Save dialog both branches
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
export dims pinned [T-45 P1: renders at screen zoom — 1280x720 exports
as 956x537; emote pack 112/224/448 vs labeled 28/56/112, tripwire flips
on fix]. Emote pack -> three downloads, three names, 1:2:4 ratio, three
distinct payloads; JPG takes the single-file path. Variants
generate/save/regenerate/save-all/Close -> E2E incl. a
re-reads-the-canvas proof; stale previews pinned [T-46]. Undo/redo
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
settings; watermark reaches the filter graph, its handle persisted,
its position NOT [T-49]; the dead "No presets selected on any clip"
path [T-49]; safe-zone modal both branches; cancel modal both branches
(real SIGKILL); refusals without an output folder / selection; per-row
Show HL-shell. Watermark PIXELS are platform-pinned: linux
ffmpeg-static has no `drawtext`, so nothing anywhere renders a
watermark or text overlay — win32-gated Layer 5 coverage is [T-51].

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
