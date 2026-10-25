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

Global test hooks: `window.__imagiiStage` (Konva Stage, Canvas.tsx:383),
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
dismisses (Tutorial.tsx:226) — by design, but tests must not click the
scrim to escape; Image emote-pack export (112x112 + PNG) silently emits
three files from one click (ExportDialog.tsx:199, :224-240) — intended feature,
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
| window.confirm("A recording is in progress. Stop and save it…") (T-133 (1): ONE asker, `mayLeaveLiveTake`; the callers are RecordStudio.tsx:708 (the Home link), VideoStudio.tsx:142 (Clean audio's "Open Audio Studio" toast button) and lib/editInVideoStudio.ts:25 (every "Edit in Video Studio"); each answers it the same way) | lib/liveTake.ts:34 |
| confirm("Replace the video you're editing? N clips and their edits will be discarded.") (T-119; "1 clip and its edits", T-120; the one hook Record's and Reframe's toast actions share since T-123) | lib/editInVideoStudio.ts:27 |
| confirm("Close this video? N clips and their edits will be discarded.") (T-120: "its" at one clip) | VideoStudio.tsx:73 |
| confirm("Replace the audio you're editing? … will be discarded.") (Clean audio, T-112; the lead-in is T-113's), asked BEFORE the extraction | VideoStudio.tsx:89 |
| confirm("Replace the audio you're editing? … will be discarded.") (Clean audio, T-133 (6): asked AGAIN after the extraction, over the chain as it stands then, and only when it is no longer the chain the first question was about; a decline keeps the work and says so) | VideoStudio.tsx:110 |
| confirm("Remove clip \"X\"?") | ClipList.tsx:156 |
| confirm("Delete preset \"X\"?") | CustomPresetManager.tsx:125 |
| confirm("Delete preset \"X\"?") | PresetPanel.tsx:66 (reachable since T-14) |
| confirm("Close this audio? … will be discarded.") | AudioStudio.tsx:46 (T-19) |
| confirm("Delete \"X\" from your posting log?") | PostChecklist.tsx:193 |
| ~~prompt("Name your first mood board:")~~ | **RETIRED (T-28):** `NameDialog` (`ReferencePanel.tsx:96`); Electron has no `window.prompt` |
| ~~prompt("Rename mood board", name)~~ | **RETIRED (T-28):** `NameDialog` (`MoodBoardPanel.tsx:155`) |
| confirm("Delete \"X\" and all N items?") | MoodBoardPanel.tsx:115 |

*Re-read against the source at T-134 (6): the table is every `confirm(` / `prompt(` / `alert(` call in `src/renderer` (a `grep -rnE "\b(window\.)?(confirm|alert|prompt)\("` that is not a comment or a test), and each line number is the line that call is on.*

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
| whisper-cli.exe (or the older whisper.exe) + 141 MB model download | transcribe, model install/cancel | not-ready branch E2E (setup panel), burn-in already Layer 5 (and, since T-89, driven through the panel in E2E) |
| Live DuckDuckGo network | search input/button, result Save, remote thumbnails | duckduckgo.ts parser unit tests on fixture HTML + error-path E2E |
| ~~Clipboard~~ | **RETIRED (T-23 + T-25).** Both directions covered for real: main-process `clipboard.readText()` after the copy buttons; main-process `clipboard.writeImage` + a real Ctrl+V for paste | — |
| ~~Browser download (a[download])~~ | **RETIRED (T-91).** Image export and variants no longer click a hidden download link: they save through main (`image:save` / `image:saveMany`), so the row became a native-dialog row. Driven by replacing `dialog.showSaveDialog` / `showOpenDialog` IN MAIN (`answerDialogs`: save / cancel / unwritable) and asserting files and the toast log — the cancel path the old `will-download` crossing (T-25) could not reach | — |
| Image Save dialog + emote-pack / variants folder picker | Image Export, Variants Save, Save all | the dialogs' chrome (incl. the "Save here" button label) is HL-dialog; the call options, answers, written bytes and toasts are asserted (image.spec.ts, `ipc/image.test.ts`) |

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
| Button "Let's go" | Welcome.tsx:44 | settings.set('welcomeSeen') | config.json written; Home renders | never directly clicked in any test |

### Home (15)

| Element | file:line | Chain | End state | Flags |
|---|---|---|---|---|
| Undo button | Home.tsx:73 | useGlobalUndo -> last store .undo() | state reverts | |
| Redo button | Home.tsx:81 | store .redo() | state advances | |
| "last:" readout | Home.tsx:84 | readout | assertion target | |
| Open project | Home.tsx:90 | project:load -> showOpenDialog -> applyProject | stores rehydrated; toast | HL dialog |
| Save project | Home.tsx:96 | project:save -> showSaveDialog | .imagii.json written; toast | HL dialog |
| NavCard x5 | Home.tsx:104-138 | router | route change | COV smoke |
| AutosaveRestore: Restore / Clear / Later (the healthy banner), Clear / Dismiss (the damaged one); T-92 renamed the healthy banner's Discard to Clear | AutosaveRestore.tsx:199-219 (Restore, Clear, Later), :173-186 (Clear, Dismiss) | applyProject / autosave:clear / dismiss | stores rehydrated / file deleted / banner hidden; a clear that fails toasts the reason and KEEPS the banner (T-57) | |

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
- **CompilationPanel (5):** fade slider ("Fade between clips": each clip fades out to black and the next
  fades in from black; nothing crossfades), dir (HL), compile (HL),
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
  time label since T-17). The font field's END STATE - which typeface is
  drawn - was NOT covered by the E2E that sets it (it read the select back
  from the store while the filter printed `arial.ttf` whatever it said); that
  is covered since [T-114], see round 64. x and y are named since T-114.
- **ExportPanel (13):** presets gear, output dir (HL; label COV
  render-only), Export N (COV export.spec end-to-end), cancel + modal
  keep/cancel-jobs, watermark input+position, filename template,
  preset checkboxes x5, Show per row (HL shell; COV render-only),
  safe-zone modal cancel/continue.
- **CustomPresetManager (12):** close, name, base select, w/h/fps,
  bitrates x2, save, delete (NAT), done, Escape/scrim.
- **PostChecklist (10):** title starters, copy x2 (HL clipboard),
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
denoise buttons x5 + parametric sliders x2, rumble/hum/de-ess boxes (+ the
power-line frequency select that appears with hum removal, T-90),
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
save-all — native Save / folder dialogs since T-91), Export (native Save
dialog; emote-pack one-folder branch), the Output readout and size note
(read-only, T-91), modal escape/scrim.

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
modals both branches, no jpg leak; `copySrtTo` was not exercised here
(needs srtPath + a kit in one session) until round 63, when a project
file carrying a transcript made both (see that section: the kit's `.srt`
is read back, on the clip's clock). 4r PostChecklist (10/10) -> E2E: title ideas + all 6 hashtag
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
   `.webm`, save is quick (a copy of the packets into a fresh file, no progress phase), file plays in
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
15. **Captions setup on the portable exe (T-102; a clean Windows machine).**
    Run `imagii.exe` from a download folder. Video Studio, load any video,
    open **Auto-captions** -> "Captions need setup" -> **Show setup
    instructions**. -> The first path is `%APPDATA%\imagii\bin\whisper-cli.exe`
    (NOT anything under `Temp`), and the line under it says the folder
    survives app updates. Click **Open folder** -> Explorer opens
    `%APPDATA%\imagii\bin` (it exists already). Put `whisper-cli.exe` from the
    whisper.cpp releases there, click **Download model**, then **Refresh status**
    -> the card goes away. Quit, delete the extracted `%TEMP%` copy of imagii (or
    just relaunch the exe), reopen the video -> Auto-captions is STILL ready, and
    **Transcribe** runs; **Cancel** during it stops the engine (no `whisper-cli.exe`
    left in Task Manager). If the card still says setup is needed after a
    relaunch, the resolver is looking somewhere other than `userData/bin`.

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
  (ffmpeg exit code N). Nothing was saved — try again, or uncheck
  "Convert to MP4 after recording" to keep the WebM.` (it said "untick"
  until round 66, T-116: a box is checked, never ticked) E2E "a convert
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
  asserts the title 'Reframe to 9:16' (T-126 (14): it read '(center crop)' until Left and Right made that stale) and the sentence that it
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

## Dispositions — round 53 (T-87 + T-93: the title starters, and the guide that has to match them)

One interactive element changed its LABEL and its generated output; no control
changed what it does. The button that was "Suggest 4 titles" is "Title starters"
and every starter it writes is grammatical. T-93 is copy and a release body
only: no element, no handler, no trigger changed, so it has no row here.

- **Video 4r PostChecklist - Title starters ([T-87], label and output changed):**
  the button writes four starters from the verb table and the subject list, each
  with its own copy button, and copy writes that starter to the REAL system
  clipboard. E2E (`video-pipelines.spec.ts`, "title ideas and hashtag packs reach
  the real clipboard"): clicks 'Title starters' by its new name, expects four rows,
  copies the first, and reads it back from the MAIN process's clipboard
  (`expect.poll(systemClipboard)` toBe the row's text). DISPOSITION: the OUTPUT is
  not an E2E question (Math.random picks the starter); every generatable starter is
  proven by `PostChecklist.test.ts`, which generates the full cross-product (8 patterns x
  6 verbs x 4 subjects = 192 starters) and asserts no doubled suffix, no
  'toing', no doubled or mismatched article, no placeholder, no exclamation mark,
  and no pattern names a game. The hashtag select, the platform toggles, the log and the
  diary are unchanged and keep their rows above.

## Dispositions — round 54 (T-88 + T-89: Record's recovery and save copy; the captions panel's setup, size and progress)

Two tickets, both bug clusters whose root is one thing: a string, or a number, in the product that nothing held to the code. No new control was added; nine existing ones changed what they do or say.

**Boundaries these rows lean on** (unchanged, restated because they decide what E2E can reach):
HL-dialog — the OS save chooser is never opened; main's `showSaveDialog` is stubbed in the MAIN process, and (new in T-88) the stub records the OPTIONS it was opened with and can hold the "dialog" open, so the saving card and the dialog's title are assertable.
HL-device — a container has no microphone or camera; `getUserMedia` for each rejects for real, and a stub that makes ONE kind appear (installed in the page, exactly the T-42 pattern) is the deepest reach for the with-a-device half. Real hardware and the Windows privacy toggle itself are OS boundaries.
HL-whisper — the whisper binary is not installed in any test environment, so transcription never runs; the panel's progress row IS reachable, because the panel only knows those events as messages on the real `captions:progress` channel and main can send them.

### T-88

- **Record - Refresh sources ([T-88], end state changed):** it re-lists screens and windows AND re-scans the microphones and cameras (the hints under an empty list send people to it; it used to touch only the screens). record.spec.ts "Refresh sources re-scans the microphone and camera, not just the screens": a spy in the page counts the scan — on arrival one enumeration and two `getUserMedia` probes (`{audio:true}` and `{video:true}`, never one call for both); after the click exactly one more enumeration and the same two probes; then a camera is "plugged in" (stub) and the click lists both cameras by name while the missing mic still warns, then "unplugged" and the click takes the stale list away. Red-first: against the old build the arrival scan never enumerates at all (`Expected: 1 / Received: 0`); mutation (`refreshAll` re-lists screens only) -> `Expected: 2 / Received: 1` at the click. Unit: devices.test.ts `scanDevices` against a fake `mediaDevices` that rejects a missing kind the way the real one does.
- **Record - Microphone and Webcam selects / the two "No ... found" hints ([T-88], behaviour and copy changed):** one missing device no longer blanks the other. record.spec.ts "a microphone and NO camera: the mic is listed and only the camera warns" (stub: a mic exists, the real camera probe rejects) and the T-42 "with a camera attached" test, which now also asserts the mic warning is visible beside the camera list. The hints read "No microphone found. Plug one in, or allow microphone access in Windows privacy settings, then click Refresh sources." and the camera twin, asserted exactly (T-122 added "close any other app using it" after "Plug one in,": the round-72 section below has the current sentence). Unit: `noDeviceHint`, `deviceListsFrom` (a kind whose probe failed is empty even when the enumeration names it — the privacy-blocked case), `reconcileDeviceId` (a pick for an unplugged device falls back to the first). Red-first: 6 of 18 devices.test.ts cases fail against the combined `{audio, video}` probe (`expected [] to deeply equal [ { deviceId: 'mic-1', ... } ]`); mutation (probes recombined) -> the same 6, byte-identical restore. DISPOSITION: a real denial in Windows Settings > Privacy is an OS boundary; a denied probe and an absent device are the same rejection to the app, and that path is the one driven.
- **Record - post-Stop "Finishing up" card ([T-88], copy and structure changed):** the status line is per state — "Finishing up — converting to MP4…" with a progress bar only when Convert to MP4 is on, "Finishing up — saving to disk…" with no bar otherwise ("converting and writing to disk…" is gone from every state). record.spec.ts "a WebM take: the card says "saving"..." holds the stubbed dialog open for 6 s and reads the card (no "convert" anywhere on the page, no bar, Discard disabled, the one-line reason on screen); the MP4 tests assert the converting line and an enabled Discard. Unit: saveCard.test.ts (the per-state copy; Discard offered in exactly one state). Red-first against the old build: `locator('div.card').filter({ hasText: 'Finishing up' }).getByText('Finishing up — saving to disk…')` not found.
- **Record - Discard recording ([T-88], end state changed):** live only while a convert is running (the one thing it can stop); disabled, with the reason beside it, for a plain WebM copy, where it used to call a cancel with nothing behind it; "Discarding the recording…" and disabled between the click and the convert's rejection, and back to enabled if the click found nothing to kill. The calm end state is unchanged and still driven: record.spec.ts '"Discard recording" kills the running convert, says so calmly...' (trash-icon neutral toast, no file, no recent). New: "a save that comes back as the cancel sentinel is a discard, not "Save failed"" replaces `recording:finalize` IN MAIN with a handler that rejects with the shared sentinel message and lets the renderer's real catch decide — a neutral "Recording discarded." (trash icon), no "imagii:cancelled" or "Save failed", nothing stranded in userData/recordings. Red-first: the old catch toasted the sentinel in red. NOTE (deviation, reasoned): main already answers a killed convert with `null` (T-44) and the sentinel is the same fact in rejection form; the catch now treats both as a discard, so the toast cannot read as an error whichever shape arrives. DISPOSITION: a click while the native save dialog is open is unreachable (the dialog is modal); the "Discarding..." state lasts milliseconds and is covered at the unit layer (`saveCard(true, true)`).
- **Record - native save dialog ([T-88], title changed):** "Save recording (Cancel discards it)". HL-dialog for the chrome itself. Deepest layers reached: recordingCancel.test.ts drives the real `recording:finalize` handler and asserts the title the dialog is opened with (MP4 and WebM), and that Cancel then resolves `null` and reaps the take (the claim in the title is true); record.spec.ts asserts the same title from the stub's recorded options in the WebM test and in "cancelling the save dialog discards the take". Mutation (title reverted) -> 2 named reds, byte-identical restore.

### T-89

- **Captions - setup card ([T-89], copy and path changed):** names `whisper-cli.exe`, says in one line what is manual and what is automatic and that the download goes online, once; "save it exactly here" frames the resources path (kept visible). video-pipelines.spec.ts "the not-ready branch names what is missing..." asserts the exact line, that every `<code>` reads `whisper-cli.exe`, that `whisper.exe` appears nowhere, and the first path ends `whisper-cli.exe`. Main accepts BOTH names: paths.test.ts (new) — either alone resolves, both prefers `whisper-cli.exe`, neither reports the preferred name as the missing path. Red-first: `Expected pattern: /whisper-cli\.exe$/ / Received: ".../resources/bin/whisper.exe"`. DISPOSITION: placing the binary and the 141 MB download are HL-whisper / HL-network; the "Download model" button is still not clicked.
- **Captions - Size slider (was "Font px") ([T-89], label, readout and accessible name changed):** stored semantics unchanged. video-pipelines.spec.ts "with an SRT restored from a project file..." asserts the label "Size", that "Font px" is gone, the readout for the default (120), three presets (210, 105) and a dragged value (72 -> 270), and the slider's `aria-valuetext`. The accessible name moved from "Caption font size in pixels" to "Caption size" (it claimed pixels). Unit: captions.test.ts `effectiveCaptionPx` / `captionSizeReadout`, with the expected values worked by hand from 1080/288 and the two measurements the T-11 entry recorded from real renders; mutation (derivation returns the raw value) -> 5 named reds, byte-identical restore.
- **Captions - progress row ([T-89], labels and bar changed):** each phase reads in plain words ("Extracting audio…", "Transcribing…", "Building captions…", "Burning in…", "Done"); a phase with no `percent` is an indeterminate bar (`role="progressbar"`, no `aria-valuenow`, the `.progress-indeterminate` segment, no percentage text). video-pipelines.spec.ts "progress reads in plain words..." sends the events from MAIN on the real channel and asserts all five phases, that six transcribing events in a row never put a number on the bar, that burn-in keeps its real 40% with its Cancel button, and that the upper-cased ids are gone. Main: captionsProgress.test.ts drives the real `runTranscribe` with a fake child — no event but `done` carries `percent`, across 60 engine lines. Red-first: 6 of 7 fail against the old whisperManager (the `Math.random` jitter; no `captioned`). DISPOSITION: the engine's own output is HL-whisper; the fake child is the deepest layer that produces transcribing events. FOUND, NOT FIXED: burn-in's and the MP4 convert's percentages are still positions estimated from encode time (no total duration is known to main); they move monotonically, so they were left, but they are the same family. The row is also not cleared after a cancelled or failed burn-in (it keeps "Burning in… N%" and a Cancel button that reaches nothing).
- **Captions - Burn into video ([T-89], end state changed; was DISPOSITIONED as not clicked):** UPGRADED to E2E — burn-in is ffmpeg only, so it runs for real. video-pipelines.spec.ts "a ranged burn with no cue in its range says so; with a cue it says "burned in"": a project supplies an SRT and two clips, the save chooser is stubbed in main; the clip with no cue in range writes a ~1 s file and toasts "No captions in this range — exported without captions." with its own warning icon and never "Captions burned in"; selecting the clip that holds the cue and pressing the same button toasts "Captions burned in". Layer 5 (`npm run test:media`, "caption burn-in") asserts the `captioned` flag beside the luma reads it must agree with (true on the two painted cases, false on the cue-less window). Red-first: `Received: ["Captions burned in"]`. The IPC handler passes the flag through (captionsBurnIn.test.ts).
- **Captions - Transcribe / model download toasts ([T-89], copy changed):** "Captions ready (N lines)" via the shared plural helper; "Caption model downloaded". HL-whisper / HL-network for the click paths; `captionsReadyMessage` and `burnInDoneMessage` are unit-tested and the strings are pinned in truthInCopy.test.ts.
- **Captions - the two explanatory lines ([T-89], copy added):** "Captions are English only." and "Captions burn into the original video, not the platform exports." are always on the panel (before setup, before and after a transcription). Asserted in both captions E2E tests; the old "the model file you choose determines languages" is asserted gone.
- **References - Reference Search note ([T-89], re-ruled):** "Reference Search goes online; your saved boards stay on your computer." — the old "the one feature that goes online" was false (the caption-model download is online too). references.spec.ts asserts the new sentence and that the old phrase is gone; truthInCopy.test.ts pins both and scans all source; the same false claim in the References tour step (aiTutorial) was corrected too (tutorialCopy.test.ts green).

## Dispositions — round 55 (T-90 + T-91: Audio Studio's words and presets; Stream Graphics' saves, hints and claims)

Two tickets, one root again: a sentence (a summary, a toast, a card, a label) that nothing held to the code under it. One new control (the power-line frequency select) and a dozen existing ones that changed what they do or say; the standing bar is met for every one of them below at the deepest layer reachable.

**Boundaries these rows lean on:**
HL-dialog — the OS Save chooser and folder picker are never opened; `dialog.showSaveDialog` / `showOpenDialog` are replaced IN MAIN (the record.spec pattern). New this round: the stub is steerable (`answerDialogs`: save, cancel, or "a folder that is gone") and records every call's options, so a canceled dialog and a failed write are states the suite can reach. What is NOT reached: the chrome of the real Windows dialog, including its "Save here" button label. Everything after the dialog — the IPC, the validation, the bytes on disk — is real.
HL-ffmpeg-encode — `npm run test:media` (Layer 5) is where the chain's bytes are judged; E2E asserts what the user sees and the file that lands.

### T-90

- **Audio - Fix Wizard - Start over ([T-90], end state changed):** restarts at question one with the dialog open (it closed it). audio.spec.ts "Fix Wizard…": after a full run, Start over leaves one dialog on "Quick fix · 1 of 3" with nothing answered; a different run from there gives a different summary ("Quieter background: off", not the first run's "on (aggressive)"); Close still closes and leaves a fresh wizard behind. Unit: `interactionWiring` pins `onClick={restart}` and that `restart()` never calls `onClose`. Red-first: against the HEAD build the Start over assertion fails `Expected: 1 / Received: 0` (the dialog was gone).
- **Audio - Fix Wizard - summary list and Apply ([T-90], copy and source changed):** the list renders from the exact patch Apply sets ("imagii will set:", "Quieter background: on (aggressive)", "Low rumble removal: on", "Hum removal: on", "Softer harsh 's' sounds: on", "Compressor: voice", "Even volume: on (target −16)"). audio.spec.ts asserts every line for three runs and, for the case the old list got wrong (a quiet room, talking), that the card says rumble ON / hum OFF and the Cleanup panel then shows exactly that. Unit: `fixWizard.test.ts` runs all 18 answer combinations; `interactionWiring` pins one `fixPatch(` call and no answer read in the component.
- **Audio - Cleanup - Quieter background (strength) buttons, Remove low rumble, Hum removal, Softer harsh 's' sounds ([T-90], labels changed):** the five strength buttons and the three boxes keep their end states (audio.spec.ts "every Cleanup control writes through to the chain" drives each by its new accessible name). `audioStudioCopy.test.ts` keeps the engineer's words out of everything shown.
- **Audio - Cleanup - Power-line frequency select ([T-90], NEW):** shown only while hum removal is ticked; 60 Hz (US, Canada) by default, 50 Hz (most other regions); the box relabels ("Hum removal (50 Hz mains)"). audio.spec.ts: absent until the box is ticked, both options listed, selecting 50 and back to 60 relabels the box, unticking hides it again; and the presets test saves a preset with 50 selected and reads `humHz: 50` off the file on disk. Layer 5 (`npm run test:media`, "hum removal notches the mains the user chose") is the end state: a pure tone at each of 50/60/100/120/1000 Hz exported through each setting — the notched tones drop 20+ dB, the others under 1.5 dB; red-first it failed `50 Hz setting should remove the 50 Hz tone (dropped 0.1 dB)` against the fixed-60 chain.
- **Audio - Levels - Even volume checkbox, loudness number, Platform select ([T-90], labels and table changed):** the YouTube/Spotify and TikTok/Reels rows are ONE row; choosing it leaves it chosen. audio.spec.ts "every Levels control writes through to the chain": the four options listed by their new labels, selecting the −14 row by label leaves `streaming` selected (the old test pinned the snap-back and was replaced), the explanation is the creator sentence and not the developer note. Unit: `LevelsPanel.test.ts` round-trips every row.
- **Audio - Cleanup presets - Save current / name input + Enter / Apply / remove ([T-90], scope and failure handling changed):** a preset is cleanup settings only. audio.spec.ts: save with a cut and a music bed on screen (the file has neither), apply (this recording's own cut and bed are untouched, 50 Hz and the loudness target arrive); an old-shape file on disk applies its cleanup and not its cut or music; ENOSPC from main's handler gives "Couldn't save that preset. Your disk is full. Free up some space and try again." (name kept in the box, no "Saved") and the delete twin. The panel's hint line is always visible and asserted. Unit: `presets.test.ts`, `PresetPanel.test.ts`, `audioPreset.test.ts`. Mutation (save stops stripping) -> a named red, byte-identical restore.
- **Audio - Waveform drag, cut chips ([T-90], copy changed):** the empty-state line says the part comes out when you export and the mark puts it back; the chips are labelled "Removed when you export:" and their title is "Click to put this part back". audio.spec.ts "waveform drag makes cut regions…" asserts the hint, the label and the title.
- **Audio - Second track - Match loudness / Duck under your voice / duck sliders ([T-90], labels and hints changed):** end states unchanged and still driven (audio.spec.ts "a second track can be added in every role…" by the new names).
- **Audio - Export - format select, Export, Show, Re-attach to video ([T-90], behavior and copy changed):** AAC reads "AAC (.m4a)" and the save dialog is opened for `.m4a` (suggested name `…-cleaned.m4a`, filter `m4a`). audio.spec.ts "the AAC option asks for, and writes, a real .m4a": the dialog's recorded options and a file whose first bytes are `ftypM4A ` and whose ffprobe container is m4a. Re-attach: audio.spec.ts "Re-attach to video exports a video with the cleaned sound…" drops a video, makes a cut, sees the re-encode note, exports through a stubbed `.mp4` dialog and probes the result (h264 + aac, shorter by the cut). FOUND AND FIXED on the way: `audio:suggestOutputName` and `audio:pickOutputFile` rejected `mp4`, so every export of audio taken from a video threw before its dialog (`audioSaveFormat.test.ts` drives the real handlers; 2 of its 4 HEAD failures are this). The progress row names its phase in words (the E2E reads "Attaching to video…"; `audio.test.ts` pins the three labels). DISPOSITION: the native dialog chrome is HL-dialog; the bytes are Layer 5 ("AAC exports as a real .m4a container…", which also shows the same encode named `.aac` has no container at all).

### T-91

- **Image - Export button, single file ([T-91], end state changed):** Export opens the native Save dialog through main and the toast follows the write. image.spec.ts "a canceled Save dialog writes nothing and says nothing…": canceled -> the dialog was asked once, the button comes back, the toast log is EMPTY and nothing is on disk; saved -> "PNG saved" is raised and the file already exists. "a save that fails says so…": a folder that is gone gives "Export failed. A file imagii needs isn't there…" and never "saved". The "PNG and JPG export real bytes…" test also asserts the dialog's suggested name and filter for PNG and JPEG. Red-first against the HEAD build (cancel the download in `will-download`): `TOASTS=["PNG saved"] COMPLETED=[]`. Unit: `image.test.ts` (the real handler, dialogs stubbed), `imageSave.test.ts` (magic bytes, size, names), `interactionWiring` (no hidden download link; a success toast only after the `null` check).
- **Image - Export - emote pack ([T-91], end state changed):** ONE folder picker for the three files. image.spec.ts "emote pack…": canceled picker -> nothing written, no toast; saved -> exactly two `showOpenDialog` calls over the test (the cancel and the save) and zero `showSaveDialog`, three files of 28/56/112 px keyed by name (a folder has no order), the toast after.
- **Image - Export - Scale select, Output readout, size note ([T-91], end state changed / NEW):** the readout (`Output: 1280x720`, `Output: 2560x1440` at 2×, `Output: 640x360` at 0.5×) is read before every export and the file's PNG header then matches it; at 2× on a 16:9 opaque document the soft note "Bigger than YouTube's thumbnail size (1280x720)." appears and is gone at 1× and 0.5×; a transparent 1920×1080 overlay gets no note; for the emote pack Scale is disabled and the readout names the trio. Unit: `ExportDialog.test.ts` `outputPixels` (floors like Konva's canvas) and `thumbnailSizeNote` tables.
- **Image - Variants - Save (per tile) and Save all (3 + original) ([T-91], end state and copy changed):** image.spec.ts "variants…": a canceled per-tile Save writes nothing and says nothing; saved writes the 1280×720 warm tile; "Save all (3 + original)" canceled -> no files and no toast, then saved -> ONE more folder dialog titled "Choose a folder for the thumbnail variants", four files, and "Saved 4 thumbnails" (the old "Saving 4 variants…" is asserted gone). Generate/Regenerate and the reopen behavior are unchanged and still driven.
- **Image - Layers panel - "hint — won't export" / "reference — won't export" tag ([T-91], NEW, not interactive):** text on the row, not only colour. image.spec.ts asserts the tag on the face guide, its label, the facecam hole, its hint and both placeholders — and its absence on the title, the accent bar and the lower-third plate.
- **Image - Export - hint layers ([T-91], end state changed):** image.spec.ts "the face guide shows on the canvas… and is not in the exported pixels": the guide is on the canvas (the stage still draws it), the probe pixel in the exported file is the plain background (red-first: `{r:76,g:26,b:24}` against `{36,22,20}` on the HEAD build), a positive control (the accent bar's red) is in the same file, and every hint node is visible again afterwards. "an overlay exports transparent where the facecam hole was": alpha 0 in the hole, the lower-third plate still there. "typing your own words over a placeholder makes them part of the export": the tag goes and the export bytes change. Unit: `ExportDialog.test.ts` (hidden at capture, prior flags restored, restored on a throw), `canvasStore.test.ts`, `templateTruth.test.ts` (every guide and placeholder in every template and asset is a hint, nothing else is). Mutation (strip made pass-through) -> 3 unit + 2 E2E reds; (retyping stops clearing the flag) -> 3 unit + 1 E2E red; both byte-identical on restore.
- **References - Mood Boards - → Canvas ([T-91], end state and copy changed):** the picture arrives as a hint: toast "Added to canvas as a reference — it won't be in your export", the row carries "reference — won't export", and an export has plain white under the faded picture (references.spec.ts "a saved item goes to the canvas as a 40% overlay…", which now exports through the stubbed dialog). The panel's note says exports leave it out.
- **Image - Templates dialog / empty-state cards, References - Asset Library cards ([T-91], copy changed):** no control changed. Every card's size and destination claim is held to its own data by `templateTruth.test.ts` (21 cards): the Twitch banner is the 1200×480 PROFILE banner, the 4K thumbnail is not for Shorts, the lower-third says "for OBS or your editor", and the Square clip card's well is a true 9:16 (its geometry changed with it). The existing card-text assertions in image.spec.ts and references.spec.ts read descriptions from the same modules and moved with them.
- **DISPOSITIONS, restated:** the real OS Save and folder dialogs (their chrome, their "Save here" label) are HL-dialog; the choice between "a few Save dialogs" and one folder picker for a set is a product call made by the tiebreaker (one question for one action) and asserted by dialog counts. FOUND, NOT FIXED: no control to keep a hint layer in the export (see LESSONS); other sample copy ("YOUR TITLE HERE", "Your Name") still exports by ruling; projects saved before this round keep their mood-board references as ordinary layers.

## Dispositions — round 56 (T-92: one name per concept, plurals, jargon, toast mechanics)

A sweep, not a feature: no new studio and no new control, but about thirty existing controls changed their label, their verb or their toast, one restructured (the export grid's tile), two were removed as duplicates, and one gained a confirm. Each is below with the test that drives it; the standing bar is met at the deepest layer reachable. **No ffmpeg surface changed** (no filter, argument or chain), so Layer 5 was not part of this round.

**Boundaries these rows lean on:**
HL-shell — "Show in folder" ends in Electron's `shell.showItemInFolder`, which opens Explorer; under xvfb nothing is there to assert. The deepest covered layer is the shell call itself: `tests/e2e/shellReveal.ts` (now shared with record.spec.ts) replaces `showItemInFolder` in main and records its argument, so the click is driven end to end and asserted to deliver exactly the path the job wrote. `savedToast.test.tsx` pins the same contract at the unit layer.
HL-dialog — unchanged from round 55: native `confirm()` dialogs ARE driven (a Playwright `dialog` handler reads the message and answers), the OS file choosers are stubbed in main.

### Renamed or relabeled (end state unchanged, name changed)

- **Home - Undo / Redo + "last: Stream Graphics" ([T-92], copy changed):** the studio is Stream Graphics, not "Image Canvas". home-chrome.spec.ts asserts `last: Stream Graphics` at the five places it used to assert the old name; `useGlobalUndo.test.ts` pins the label for the canvas store.
- **Video - Smart highlight finder - Scan VOD / Re-scan / + Clip ([T-92], copy and arithmetic changed):** "Found 1 highlight" (was "Found 1 candidates"), reasons in capitals with plain fallbacks ("Loud peak", "Long loud stretch" for the ids `loud` / `sustained-loud`), and the score chip reaches 100 without a chat log. video-pipelines.spec.ts "scans a real VOD…" (100, "Loud audio peak", "Found 1 highlight") and "the optional chat log rescoring…" (100 with no chat -> 40 with a chat log that is silent at the moment -> 100 with one that is not -> 100 cleared; the debounce still asserted on the first step). Unit: `highlights.test.ts` (old vs new score, reasons). Red-first and mutation in the LESSONS entry.
- **Video - Chat spike finder - Find chat spikes / + Clip / spike window / extra seconds ([T-92], copy changed):** the panel is "Chat spike finder" (was "Chat highlight reel"), the fields "Spike window (s)" and "Extra seconds around each clip" (were "Bucket sec" / "Pad sec"), the add button "+ Clip" (was "+ clip"), rows read "9 messages" (were "9 msgs"), clips are named "Chat spike N" (were "Chat hype N"), the toast is "Found 1 chat spike". video-pipelines.spec.ts "finds the spike a pasted log actually contains…" and the T-94 chat tests drive all of it, including the labeled fields' default values.
- **Video - Player - "Crop guides" checkbox, Frame / Frame buttons, readout ([T-92], copy changed):** the overlay checkbox is "Crop guides" (was "Safe zones"); the step buttons read "Frame" (were lowercase); the readout reads "320×240 · 15 fps · video h264 · audio aac" (was "15.00 fps · h264 · aac"). video-core.spec.ts "player transport…" drives the checkbox (3 guides appear) and asserts the exact readout. Every `Crop` lookup in the E2E suite became exact, since "Crop guides" now also contains the word.
- **Video - Color & motion - sliders ([T-92], NEW line, not interactive):** "Color changes show up in the exported file, not in this preview." video-core.spec.ts "color and motion…" asserts it before the first slider moves.
- **Video - Export as GIF - Width / Frame rate selects ([T-92], copy changed):** options read "480 px" and "15 fps" (were bare numbers and "FPS"). video-pipelines.spec.ts "gif: the three selects…" lists the option texts and still drives the job.
- **Video - Picture-in-picture - Position select / Overlay width / Margin ([T-92], copy changed):** "Top left … Bottom right" (were "Top L … Bot R"), fields labeled "(px)". "picks both inputs, composites them for real…" asserts the four option texts and the labels.
- **Video - Clip list - "First 3 s:" and the hook badge tooltip ([T-92], copy changed):** the tooltip ends "Based on how loud the first 3 seconds are, not what's on screen" and no longer says LUFS or "peak". video-pipelines.spec.ts "the hook badge says what it measures…".
- **Video - Posting helpers - Copy (title), Copy (hashtags), hashtag pack select, Delete entry ([T-92], copy and behavior changed):** the buttons are "Copy"; the pack picker lists "Twitch clip … YouTube, long video" (ids unchanged, so saved values are); the list is headed "Logged posts (N)", the toast is "Added to your posting log", and **Delete entry now asks first** ("Delete "Second clip" from your posting log?") — Cancel keeps the entry in the store and on disk. video-pipelines.spec.ts "logging a post writes a posting-log entry…" drives both answers; `copyConventions.test.ts` pins the pack labels against the keys.
- **Video - Captions - Open folder ([T-92], copy changed):** the lowercase "open folder" is "Open folder". Not driven (its end state, Explorer, is HL-shell); the label is held by the copyConventions scan.
- **Image - Toolbar - Rectangle ([T-92], copy changed):** "Rect" -> "Rectangle", matching the status line and the layer name. image.spec.ts drives the tool button by its new name in 13 places and the hotkey loop no longer special-cases it.
- **Image - Layers panel - Remove layer ([T-92], copy changed):** was "Delete layer" while the shortcuts dialog said "Remove selected layer"; both are Remove (an item in what you are editing, and Undo brings it back). image.spec.ts drives the button by name in three places.
- **Audio - Cleanup presets - Delete preset ([T-92], copy changed):** was "Remove preset" opening a "Delete preset" confirm; now the button and the confirm agree. audio.spec.ts drives all three call sites.
- **Audio - Close audio confirm ([T-92], copy changed):** "Close this audio? Your cleanup settings, 1 cut will be discarded." (capital, counted). `AudioStudio.test.ts` and audio.spec.ts.
- **References - Mood boards - "Create board" (the "+" button) ([T-92], accessible name NEW):** a bare "+" had no name. home-chrome.spec.ts and references.spec.ts find it by `Create board`. The board delete confirm counts its items ("all 1 item"). Red-first: the lookups by the new name fail against the HEAD build (the name was "+").
- **Home / Video - Autosave banners - Clear (both) ([T-92], copy changed):** the healthy banner's "Discard" and the damaged banner's "Clear" were one call; both read "Clear" (title "Clear the autosave") and the toast is "Autosave cleared". home-chrome.spec.ts (clear deletes the file, the failure path keeps the banner) and continuity.spec.ts (Later and Clear leave a fresh start untouched); `interactionWiring.test.ts` pins both buttons to `clearAutosave` and disabled-while-busy.

### Dismiss labels (one control, one word)

- **Shortcuts dialog - Close ([T-92], copy changed):** the button read "Esc"; it reads "Close" and the footer reads "Press Esc or ? to close." home-chrome.spec.ts opens it, closes it with the button, reopens it and closes it with Escape, and checks the button wins a hit test at its own centre over a coachmark. `interactionWiring.test.ts` pins both.
- **Image - Templates dialog - Close ([T-92], control REMOVED):** the header's "✕" is "Close" and the footer's second dismiss ("Cancel") is gone — two controls closing one window with different words. image.spec.ts drives the three dismissals that remain (Close, Escape, the scrim) and proves none changes the document; home-chrome.spec.ts' focus-trap test now ends the cycle on the last template card.
- **Video - Custom export presets - Close ([T-92], control REMOVED):** the footer's "Done" is gone; the header's "Close" is the only dismiss. video-pipelines.spec.ts closes the dialog with it in five places.
- **Thumbnail variants / audio wizard - Close:** already "Close"; unchanged and still driven.
- **Decision dialogs ([T-92], unchanged):** "Export anyway / Cancel", "Keep running / Cancel jobs", Clip Kit's cancel confirm and the Name dialog keep a verb + "Cancel"; "Done" stays on the tutorial tour's last step.

### Toasts and "Show in folder"

- **Video - GIF / Picture-in-picture / Reframe / Compile - success toast with "Show in folder" ([T-92], copy and duration changed):** "Saved the GIF", "Saved the picture-in-picture video", "Saved the vertical version", "Saved the compilation", each with a "Show in folder" button for 8 s (was a bare "Show" for 2 s). video-pipelines.spec.ts asserts, for each of the four, the toast text, that the button is still there 3.5 s later, and — pressing it — that the stubbed shell received the written file (`expectRevealToast`). Red-first against the HEAD build: `"Show" is still there 3.5 s later` failed. HL-shell for Explorer itself; `savedToast.test.tsx` covers the contract at the unit layer.
- **Record - Saved toast: Show in folder / Edit in Video Studio ([T-92], copy and duration changed):** "Saved 12.3 MB" + both buttons for 8 s. record.spec.ts clicks "Show in folder" (the reveal call is recorded) and "Edit in Video Studio" (the file loads into Video Studio, the route changes).
- **Video - Export queue rows / Audio - Export row - "Show in folder" ([T-92], copy changed):** the inline button beside a finished file, formerly a bare "Show". video-pipelines.spec.ts counts four after a four-file queue and presses the first (the stubbed shell receives `Clip 1-youtube.mp4`, the first row's file); audio.spec.ts shows it after the m4a export and presses it (the shell receives that file); export.spec.ts shows it after the single-clip export. HL-shell for Explorer itself.
- **Result toasts without a period ([T-92], copy changed):** "Recording discarded", "Autosave cleared", "No standout moments detected", "No chat spikes detected", "Deleted — press Ctrl+Z to undo", "<file> may not be a supported video — trying anyway", "Saved your Clip Kit" (was "Clip kit ready"). The E2E assertions that read them moved with them; `copyConventions.test.ts` fails on a one-sentence result toast that ends in a period, and leaves failures (`toast.error`, `reportFailure`) alone — their period is the T-84 contract.

- **Every toast card - click-through ([T-92 send-back], behavior changed):** a live toast no longer catches the click meant for the control under it; the "Show in folder" / "Edit in Video Studio" buttons opt back in. image.spec.ts "emote pack: … ONE folder dialog" (the control beneath is Export, clicked again while the pack toast is up) is the regression test and passes unchanged; video-pipelines.spec.ts' `expectToastClickThrough` runs on each of the four saved toasts; `AppToaster.test.tsx` and `savedToast.test.tsx` pin the two styles. Mutation in the LESSONS entry. FOUND AND FIXED: the same failure occurs on a clean HEAD build in isolation, so the bug predates the 8 s duration.

### The export grid and the custom-preset form

- **Video - Export grid - platform checkboxes ([T-92], restructured):** the checkbox's name is the platform ("YouTube", "Reels", "TikTok", "X / Twitter", "Facebook"; "<name> Custom" for a saved preset); the size and frame rate ("1920×1080 · 30 fps"; a custom preset shows its own) and the verdict are its description. video-pipelines.spec.ts "each export checkbox is named for its platform…": exactly one checkbox per exact name, `toHaveAccessibleName`, `toHaveAccessibleDescription` for the geometry and for "will be enlarged", and a mouse click on the size line still toggles the tile (it is one hit area). Red-first against the HEAD build: the names were the paragraphs (`checkbox "YouTube 1920×1080 OK Under the 1-minute sweet spot · …"`, transcript in the LESSONS entry). The T-83 grid-honesty test and the custom-preset queue test find tiles by `[data-export-target]` and by role.
- **Video - Custom export presets - Video bitrate / Audio bitrate / Save preset / Delete ([T-92], behavior and copy changed):** "8000" saves as "8000k" and "192" as "192k" (written back into the fields), "5000000" is refused with "5000000 is too big to be kilobits per second. Write 5M instead.", "8 Mbps" and "loud" are refused naming the field and an example; the saved list reads "1280×720 · 60 fps · 5 Mbps · Reels"; the row's delete is "Delete" (was "✕ delete") and its confirm says "Delete preset". video-pipelines.spec.ts "saves, lists, queues and deletes…" (refusals, the saved row, the confirm answered both ways, the queue unqueueing) and "the custom-preset form saves a bare bitrate with its unit…" (file on disk, red-first: `"videoBitrate": "8000"` against `"8000k"`). Unit: `customPresets.test.ts` (18 cases incl. the hostile-argument pair), mutation in the LESSONS entry.
- **Video - Compile clips at ONE clip ([T-92], hidden -> disabled with a reason):** the card is always on screen; with one clip its button ("Compile 1 clip") is disabled and the card says "Add a second clip to compile." video-pipelines.spec.ts "compilation: says what it needs at one clip, works at two…" asserts the card, the note, the disabled button, then the note gone and the button enabled after "+ Add clip". Red-first: against the HEAD build the card does not exist at one clip.

### Found, not fixed

- `HighlightPanel.tsx` still draws two signal bars with raw hex (`#f472b6`, `#fbbf24`), and `SafeZoneOverlay.tsx` three overlay colors (`#f472b6`, `#fbbf24`, `#22d3ee`) — raw colors outside the documented exceptions (DESIGN_GUIDE, T-71). Not copy; left for a design round.
- Main's `isValidBitrate` still accepts a lowercase `m` and a bare number, so a hand-edited preset file (or one written before this round) can still reach ffmpeg as milli-bits. The form no longer produces one; main's gate is the trust boundary and stays permissive for old files. `formatBitrate` shows a legacy bare number honestly (as bits per second).
- The Audio Studio readout prints ffprobe's codec id raw (`pcm_s16le`). The Player's was labeled this round; the waveform's was only spaced ("2 ch").
- `assetCatalog.ts` / `templates.ts` layer names (`name:`) are not read by the copyConventions scan (they are document content). Only the one catalog description with "8px" was spaced.
- Projects saved before this round keep their old clip names ("Chat hype 1", "Highlight 1"); names are data.
- Home's "last: Stream Graphics" status keeps its lowercase prefix (a status annotation, not a button, label or header).

## Dispositions — round 57 (T-96 + T-97: the crop reaches Compile and GIF; the grid judges the file, not the source)

No new interactive element. Six existing controls change what their end state is allowed to be. Every end
state below is reachable without an OS boundary: the output folder chooser is the house main-process stub,
and the bytes on disk are decoded by the bundled ffmpeg and read as pixels. **This round touches ffmpeg
filter graphs** (Compile's per-segment graph and the GIF's), so Layer 5 is part of every T-96 row
(IMG-PREC). T-97 changes no graph and no argument: its rows are unit and E2E.

- **Video 4l GifPanel - Export GIF ([T-96], end state changed):** from "a GIF of the clip's range, always the
  whole frame" to "a GIF of the clip's range in the crop the user drew, in the crop's own shape". E2E
  (video-pipelines.spec.ts "gif: the crop drawn for the clip reaches the GIF"): a 1:1 crop drawn through the
  real Crop control -> a 320x320 GIF whose decoded frame has NO red (the fixture's red block is outside the
  crop); Crop unchecked and exported again -> 320x180, red present. Red-first against the HEAD build: `Received:
  1600` red pixels where 0 was expected. Beneath it: Layer 5 "a cropped clip compiled or GIF'd keeps its crop"
  (4:3 and 9:16 crops, marker square and at the hand-derived scale, uncropped control beside each; HEAD:
  `1154 red pixels came out`), `gif.test.ts` (the graph, an uncropped one byte for byte),
  `videoCropPayload.test.ts` (the IPC gate: ten malformed crops refused before ffmpeg). Mutation: the crop
  stage out of `buildGifFilter` alone -> 5 unit + 2 Layer 5 reds, compile green.
- **Video 4m CompilationPanel - Compile N clips ([T-96], end state changed):** from "every clip's range at the
  full frame, scaled to 1920x1080" to "every clip's range in its own crop, cut to 16:9 around the middle,
  scaled to 1920x1080". E2E ("compilation: every clip keeps the crop it was drawn with"): Clip 1 cropped 1:1,
  Clip 2 not -> the first 2 s of the file have no red, the next 2 s have the red block (the control); 1920x1080.
  Red-first: `Received: 58549` red pixels in the cropped half. Layer 5: three crops (4:3, 9:16, and a 16:9
  control) each in a two-segment compile with an uncropped segment beside it, plus an uncropped 4:3 source
  that must come out un-stretched (HEAD: `17956 red pixels came out`, `marker came out 240x180`). Mutation: the
  crop stage out of `buildSegmentFilter` alone -> 6 unit + 4 Layer 5 reds, GIF green.
  **BEHAVIOR CHANGE, flagged:** an UNCROPPED clip of a source that is not 16:9 is now cut to 16:9 around the
  middle instead of being stretched to fit (one chain, no "only when cropped" branch; a 16:9 source is
  unchanged). The panel's sentence ("Stitch all clips into one 1920×1080 montage") is still true.
- **Video 4d CropOverlay - enable checkbox, aspect presets, drag, resize, Reset ([T-96], end state extended
  again):** the rect now reaches three exports, not one (platform exports T-83, GIF and Compile T-96). The two
  E2E rows above draw it through the real control (the `1:1` preset button).
- **Video 4t ExportPanel - platform checkboxes and their SuccessIndicator ([T-97], end state changed twice):**
  (1) the "smaller than this output" reason reads the frame the export starts from, so a crop smaller than a
  platform's size says "The picture is smaller than this output — it will be scaled up and look soft"
  (video-pipelines.spec.ts "a crop smaller than the output says…": a 1920x1080 source, the 16:9 crop button ->
  YouTube "OK" with the reason, X / Twitter and Facebook still "Great" without it, Crop unchecked -> "Great").
  Red-first: the YouTube tile never left "Great". (2) the length checks read the length of the FILE at the clip's
  speed ("the grid judges the length of the file at the clip's speed": a 300 s source — Reels "Too long" at 1x,
  the reason gone and "Over the 1:30 sweet spot" in its place at 2x, "Too long" again at 0.5x; and "a 9:16 clip
  over TikTok's sweet spot at 1x is inside it at 2x": "OK" -> "Great"). Red-first: Reels still read "Longer than
  the typical 3-minute limit" at 2x, TikTok never reached "Great". The old copy ("will be enlarged") is gone from
  the source and from the one E2E assertion that pinned it (the accessible-description test). Unit:
  `presets.test.ts` (both directions of the size check, the boundary and the rounding hair, a custom preset;
  `outputDurationSec` at 0.5x / 1x / 2x; the limit walked across its boundary at each speed) — existing grid
  cases kept their assertions and moved to the clip signature. Mutations: the speed division dropped -> 8 unit
  reds + 3 E2E; the size comparison reading the source again -> 4 unit reds + 1 E2E, T-83 green.
- **Video 4f ClipList - Speed slider ([T-97], end state extended):** was "the clip's speed lands in the store and
  the export"; now also "the grid's length verdicts and Clip Kit's question follow it". The slider is driven
  (`fill('2')`, `fill('0.5')`) in the three E2E rows above and the kit row below.
- **Video 4p ClipKit - the button and the long-clip confirm ([T-97], end state changed):** the question compares
  the length of the files the kit will write, and says it ("This clip is 5:00."). E2E ("the long-clip question
  quotes the length of the file"): a 300 s source at 1x -> the modal names Reels only and quotes 5:00; Cancel;
  speed 2x -> the click goes straight to "Exporting 5 platform versions…" with no dialog, then wound down by
  Cancel jobs. Red-first: at 2x the HEAD build raised the modal. Unit: `clipKit.test.ts` (`platformsOverLimit` at
  0.5x / 1x / 2x on both sides of each platform's cap, and agreeing with the grid's "Too long" across all five
  platforms and three speeds). The confirm's own Cancel / Export anyway are unchanged and still driven by the T-85
  test.
- **DISPOSITIONS, restated:** none new. The folder chooser is the house stub (HL-dialog); "Show in folder" is
  unchanged (HL-shell, `expectRevealToast`).

### Found, not fixed

- **Compile still ignores everything about a clip but its range and its crop.** `segments` carry no speed, no
  colour grade, no text overlays, no auto zoom or hype shake, so a clip set to 2x compiles at 1x with its
  audio at 1x. The same wrong-file class as T-96, one property over; a ticket of its own, since the audio chain
  (`atempo`) is part of it.
- **The GIF panel's "over about 10 s" warning reads the clip's source seconds.** A 20 s clip at 3x makes a ~7 s
  GIF and is told it will "get huge" (and a 6 s clip at 0.5x makes a 12 s one and is not). The T-97 fix shape:
  `outputDurationSec(clip) / speed` with the panel's own speed.
- **`video:exportBatch` does not validate `clip.cropRect`** (`validateExportJob` checks the overlays only).
  `assertOptionalCropRect` is the gate Compile and GIF now use; applying it to the batch changes what a
  hand-edited project's export does, so it was left for a decision.
- **Output names do not carry the crop.** `<source>_<width>px_<fps>fps.gif` and `<source>_compilation.mp4` are
  overwritten by the next job with the same settings, whatever its crop; a second GIF of one clip with a
  different shape replaces the first without a word.
- **The Compile panel says nothing about the edges a crop loses.** A 9:16 crop in a 1920x1080 compilation keeps
  only its middle 32% in height, which the export grid says in words for a platform; the compile card has no
  verdict row.
- **The speed rule has four copies.** `runExportJob` twice, `buildVideoFilter` and `outputDurationSec` (renderer)
  each normalize "missing, zero or negative is 1x"; a shared `clipSpeed` would be one. Left alone to keep this
  diff out of `export.ts`.
- **A cancel in the first moments of a Compile or a cropped GIF finds nothing to kill.** Both now probe the source
  before they spawn, and the job id is registered only at the spawn (a platform export and Reframe already
  behave this way); the window is the length of an ffprobe call. **Fixed in round 58 (T-98).**

## Dispositions — round 58 (T-98 + T-99 + T-100 + T-101 + T-104: Cancel is a latch; a project that never points at scratch; the wreckage a stop leaves; dead actions; raw colors)

No new interactive element. **Twenty-odd existing controls change what their end state is allowed to be**, and
every end state below is reachable without an OS boundary: the folder and Save/Open choosers are the house
main-process stubs, the held probe and the held thumbnail are `tests/e2e/mainSpawn.ts` (a `child_process.spawn`
wrapper installed in MAIN — nothing in `src/` changes), the audio and transcription jobs that cannot be run here
are driven from main on their real channels, and every file that was or was not left on disk is read back.
**This round touches `src/main/ffmpeg` and `src/main/audio`** (the cancel and cleanup paths of every runner; no
argv or filter), so Layer 5 is part of every T-98 / T-100 row (IMG-PREC).

### Cancel is a latch (T-98)

- **Video 4t ExportPanel - Cancel and the "Cancel jobs" confirm ([T-98], end state changed):** from "kills the
  ffmpeg that is running, if one is" to "stops the batch whenever it lands". E2E ("a Cancel pressed between two
  jobs of a batch stops the rest"): a 2-job batch with the SECOND job's ffprobe held 8 s -> job 1 finishes,
  Cancel is clicked inside the hold -> a neutral toast within the hold (the wait is cut short, not waited out),
  row "Canceled", the spawn log is exactly `ffprobe, ffmpeg, ffprobe`, one file, and 9 s later still nothing.
  Red-first: `Received: ["Video loaded", "Exported 2 files"]`. Beneath it: `videoExportBatch.test.ts` makes the
  Cancel happen inside `e.sender.send('video:jobComplete')` — the gap itself — for a batch of 2 and of 5.
- **Video 4k ReframePanel - Cancel ([T-98], end state changed), 4l GifPanel - Cancel, 4m CompilationPanel -
  Cancel, 4j HighlightPanel - Cancel scan:** the same four controls, pressed before the job's ffmpeg exists. One
  E2E ("a Cancel pressed before the job's ffmpeg exists still cancels…") holds every ffprobe 6 s, clicks each
  panel's Cancel inside it and asserts each panel's own neutral toast, the panel freed within 4 s, no ffmpeg ever
  spawned and nothing written. Red-first: `Received: ["Video loaded", "Saved the vertical version Show in
  folder"]`. Layer 5 does the same with the real ffprobe, the Cancel issued in the same tick as the call.
- **Video 4p ClipKit - the button, Cancel and "Cancel jobs" ([T-98], end state changed):** a kit Cancel now
  reaches the three thumbnails (`video:cancelAll` joins the frame family) and a Cancel between two of the kit's
  calls is remembered. E2E: "Cancel during the thumbnails reaches them" (the first extract held 20 s; five
  exports stay, zero thumbnails, one extract spawned, no "Saved your Clip Kit"; HEAD `Received: [… "Saved your
  Clip Kit"]`) and "a Cancel that lands between two thumbnail calls still stops the kit" (the extract handler
  replaced in main by one the test holds; the second call is never made).
- **Video 4o CaptionsPanel - Cancel (burn-in) ([T-98]):** the Cancel button appears with the first progress
  event, a few awaits before the child; the burn-in is in the pre-spawn table of `cancelSentinel.test.ts`
  (ranged: it reads its SRT first). Its end state is the T-100 row below.
- **Audio ExportDialog - Cancel ([T-98]):** an export probes the file first, and the re-attach's mux probes the
  cleaned audio; both are in the pre-spawn table. Layer 5: "audio export: a Cancel in the probe writes nothing".
- **DISPOSITION - PiP (4n) has no run:** `video:pipComposite` spawns in the same tick the handler runs, so there
  is no wait for a Cancel to fall into; its cancel stays a registry kill, with the T-100 cleanup of its output.
  **Superseded in round 59:** T-106 made it choose a free output name first, which is such a wait, so PiP now holds a
  run and has a row in the pre-spawn table.

### A project never points into a temp family (T-99)

- **Home - Save project, Open project; Audio Studio - drop / Choose file (a video) ([T-99], end state changed):**
  from "the saved project names the scratch WAV (gone the next day)" to "it names the video and re-extracts on
  open". E2E ("a sound extracted from a video survives its scratch file: save, prune, relaunch, open"): drop a
  video -> Home -> Save project (Save chooser stubbed) -> the file names the video, carries the marker and holds
  no `imagii-audio` path anywhere -> close the app -> delete the scratch WAV -> relaunch the same profile ->
  Open project -> "Project loaded", the waveform plays, Re-attach is ticked, a new scratch file exists -> the
  video moved -> "Couldn't find e2e-clip.mp4. It may have been moved or deleted. The rest of your project is
  open — load the audio again in Audio Studio." Red-first: the saved `sourcePath` was
  `/tmp/imagii-audio/F7BRlapFIv.wav`. Unit: `ProjectIO.test.ts` (both gates, save -> prune -> reopen, the moved
  video, the old shape both ways), `projectValidation.test.ts` (schema 4).
- **DISPOSITION - an old (v3) project whose scratch WAV is already gone** still says "Couldn't find
  aB3dE5fG7h.wav", as before (unit-pinned): it has the video in `fromVideoPath`, and re-extracting from it would
  recover it — see Found, not fixed.

### The wreckage a stop leaves (T-100)

- **Video 4t ExportPanel - Cancel, the queue rows, Show in folder ([T-100], end state changed):** a Canceled row
  is neutral (`bg-ink-muted`) and keeps its word; a Failed row stays red; the folder holds only what finished.
  E2E: the multi-job cancel test (HEAD `Expected: 3 Received: 0` neutral bars; every file left is a real video
  and the count equals the rows with "Show in folder"), and "Cancel mid-encode leaves no half-written file, and
  the job that finished before it keeps its file" (two clips of the 20-minute source: HEAD left a second .mp4).
- **Video 4k / 4l / 4m / 4n / 4o / 4p - the files their Cancel and failures leave:** the same rule at Layer 5 with
  a real SIGKILL mid-write (export, GIF, reframe, audio render, burn-in) and in the sentinel table for eight
  runners and the compilation's join; "a file that was already there before the job started is left alone".
- **Video 4o CaptionsPanel - Burn into video, Cancel, Transcribe ([T-100], end state changed):** the progress row
  goes back to idle after a canceled or failed burn (and a failed transcription). E2E ("a canceled or failed
  burn-in puts the progress row back and leaves no half-written video"): cancel mid-burn, then a burn that
  fails (output folder missing), then a transcription whose engine fails (`captions:status` / `transcribe`
  replaced in main — **HL-whisper**: the engine itself is not installed here, so the job's failure is injected on
  the real channel and the panel's real `catch` runs). Red-first: `Expected: 0 Received: 1` progress bars.
- **Audio ExportDialog - Export, Cancel, the progress row ([T-100], end state changed three ways):** (c) the row
  says Failed / Canceled and outlives the toast; (e) the passes are "Step 1 of 2 — measuring loudness" / "Step 2
  of 2 — rendering" / "Step 2 of 2 — attaching to video"; (a) a render canceled in its second pass leaves no
  file. E2E: "the Export row names its steps, and says Failed or Canceled after the toast fades" (driven from
  main on the real `audio:progress` channel; HEAD `"Measuring loudness…0%"`), "Cancel in the render pass leaves
  no half-written file" (HEAD: the file stayed), the re-attach test's final label.
- **Audio WaveformView - the readout ([T-100]):** "44100 Hz · 1 ch", no codec id (the import and extract tests
  assert both halves).
- **Video 4p ClipKit - the SRT notice ([T-100]):** E2E "captions that cannot come along say so in plain words"
  (a project whose SRT is gone; HEAD `SRT not bundled (source SRT not found)`; the raw fragment in the console).
- **Video 4k ReframePanel - the progress row ([T-100]):** "Checking the video…", never `ANALYZING`; asserted in the
  probe-phase E2E above; `reframe.test.ts` for the table.

### Dead code and raw colors (T-101, T-104)

- **Video 4f ClipList - "+ Add clip" ([T-101]):** unchanged; `addClipFromRange` (no control called it) is
  deleted with five more store actions no control called, and the buffered `recording.save` IPC with its
  preload and type. `tests/unit/deadActions.test.ts` fails on any store action nothing outside the store names.
  Every disposition above that cited `addClipFromRange` (round 32 and round 39 rows) now means `addScannedClip`'s
  guards, in `videoStore.test.ts`.
- **Video 4j HighlightPanel - the signal bars; Player - Crop guides ([T-104]):** the same hues, from tokens
  (`EMBER`, `SIGNAL_PINK`, `SIGNAL_CYAN`); the existing "overlays: the crop rect and the safe-zone guides sit on
  the picture" and highlight-scan E2E rows stay green and are unchanged. `noRawHex.test.ts` keeps hex out of the
  renderer.
- **DISPOSITIONS, restated:** the folder / Save / Open choosers are the house stubs (HL-dialog); "Show in folder"
  is unchanged (HL-shell, `expectRevealToast`); the captions engine is HL-whisper (above).

### Found, not fixed

- **Video imports that convert (flv / ts / wmv / mpg / 3gp) have the T-99 bug too.** `convertForImport` writes
  a working copy under `%TEMP%/imagii-import` and the video studio's source IS that path, so a saved project
  points at a file the next launch's prune deletes. Same fix shape: store the original and a marker, re-convert on
  open. Left out of this round: it needs its own schema field and a transcode on open.
- **An OLD project (v3) whose scratch WAV was already pruned could be recovered** by the same re-extract from its
  `fromVideoPath`; the round's direction was to leave it saying "Couldn't find …". It is a few lines.
- **`video.cancel(jobId)` and `app.quit()` are exposed through the preload with no renderer caller** — the same
  class as `recording.save`, outside what T-101 named. (`cancelExportJob` itself was used by the unit and Layer 5
  tables; round 60 deleted it too.)
- **Audio Studio's header shows the scratch WAV's random name** (`aB3dE5fG7h.wav`) for a sound extracted from a
  video, because `source.fileName` is read off `filePath`. It should read the video's name.
- **Reframe's `analyzing` event sends `percent: 0`** (a bar parked at 0%) where the T-89 rule says a phase of
  unknown length sends none and draws the indeterminate bar.
- **A finished burn-in leaves "Done 100%" on the captions row** until the next run starts.
- **Transcription cannot be canceled at all**, and its audio extraction is not in any registry (the WAV is
  extracted by a child nothing can reach).
- **Two scratch outputs still survive a failure:** `convertForImport` (the `imagii-import` working copy) and
  `extractAudioFromVideo` (the `imagii-audio` WAV) do not unlink a half-written file when their child fails.
  Neither is a file the user chose or sees, both live in temp families the launch prune reaps, and neither is
  named by T-100; the same one-line `discardPartialOutput` would do it. (Transcription writes its `.srt` only at
  the end, so a stopped run leaves none.)
- **`mainSpawn.ts` relies on `process.getBuiltinModule`** (Node 20.16+, so Electron 31); a future Electron bump
  has to keep it, or the held-probe cases fail loudly at `installSpawnStall`.

## Dispositions — round 59 (T-105 + T-106: Compile is the clip the user built; no export replaces another; the batch checks its crops)

No new interactive control. **One new read-only element** (the Compile card's verdict list) and **about a dozen
existing controls change what their end state is allowed to be**. Every end state below is reachable without an OS
boundary: the folder chooser and the project chooser are the house main-process stubs, the bytes on disk are decoded
by the bundled ffmpeg and read as pixels, samples of sound and lengths of streams, and "Show in folder" is the
`stubShellReveal` recording (HL-shell). **This round changes ffmpeg filter graphs and output names** (Compile's
per-segment graph and audio, Auto Zoom's graph, every runner's output path), so Layer 5 is part of every T-105 / T-106
row (IMG-PREC).

### Compile is the clip the user built (T-105)

- **Video 4m CompilationPanel - Compile N clips ([T-105], end state changed again):** from "every clip's range at the
  full frame or in its crop" to "every clip as it was built: crop, speed (the sound too), color grade, Auto Zoom,
  Hype Shake and text, in the export's own graph". E2E ("compilation: each clip is compiled as the clip it was
  built"): Clip 1 set to 2x, Brightness +0.5 and Auto-zoom through the real controls, Clip 2 added plain -> the file is
  3 s (1 s + 2 s) with 3 s of sound, and Clip 1 is brighter than Clip 2 at the same moment of the source. Red-first:
  the HEAD build wrote a 4 s file (`Expected: < 3.2 Received: 4.024`). Beneath it, Layer 5 "a compiled clip is the clip the user built" (speed at 2x / 4x / 0.5x / 0.25x with
  each stream's length, the picture clock and the audio burst's position; grade; Auto Zoom; Hype Shake; fades on a 2x
  clip; the whole recipe at once) and the T-51 block's compile cases (overlays by the drawbox stand-in on every build, by
  drawtext on win32, and the linux pin).
- **Video 4m CompilationPanel - the verdict list ([T-105], NEW, read-only):** one row per clip, each the export grid's own
  verdict with the compilation as the target. E2E ("compilation: each clip has a verdict row in the grid's own words"): two
  clips of a 1920x1080 source read "Great"; a 9:16 crop on Clip 1 turns its row "Wrong shape" with "Only the middle 32% of
  the picture's height fits this shape" and the scaled-up reason — the sentence the YouTube tile shows for the same crop —
  while Clip 2's row does not move; Crop unchecked -> "Great" again. Red-first: the HEAD build had no list (`Expected: 2 Received: 0` rows). Unit: `presets.test.ts`
  (`COMPILE_TARGET`: no length to be too long for, the shape and size reasons, a source that is not 16:9).
- **Video 4m CompilationPanel - Fade slider ([T-105], end state changed):** a fade (out to black, then in from black - nothing
  crossfades or overlaps) is placed on the clip's length in the OUTPUT. Layer 5 ("a fade is placed on the clip's length in the output") on a 2x clip, picture and sound; `concat.test.ts`
  for 1x / 2x / 0.5x / 4x and the tempo-before-fade order.
- **Video 4f ClipList - Speed slider and Reset ([T-105], end state extended):** the clip's speed now reaches Compile, and
  every reader of it (the export graph and audio, the bar, the grid, the GIF warning, the slider's readout, the store's
  setter) is `clipSpeed`. Driven (`fill('2')`) in the Compile row above, the dup row below and the kit row below.
- **Video 4i ColorGradePanel - Brightness / Contrast / Saturation / Temperature, Reset color, Auto-zoom, Hype shake
  ([T-105], end state extended):** the panel's own sentence ("Both effects bake into the export") is now also true of a
  compilation. Brightness and Auto-zoom are driven in the Compile row; Layer 5 covers all four sliders and both effects
  through `runConcat`. **Auto Zoom's end state also changed for a platform export** (below).
- **Video 4t ExportPanel - Export N files, with Auto-zoom on ([T-105], end state corrected):** the file is now the clip's
  length. Layer 5 "Auto Zoom keeps a clip's length whatever the source frame rate" (30 and 60 fps; HEAD: `30 fps export:
  the picture: 2.4 s, expected 2 s`) and `filters.test.ts` (the `fps=N,zoompan=...:fps=N` pair for every preset).
- **Video 4l GifPanel - Speed select and the warning ([T-105], end state changed):** "GIF exports over about 10 s get huge.
  Trim the clip first." counts the GIF that will be written. E2E ("gif: the 'over about 10 s' warning counts the GIF that
  will be written"): a 14 s clip is warned at 1x and 0.5x and not at 1.5x / 2x / 3x; a 6 s clip is not warned at 1x, is
  at 0.5x. Red-first: the HEAD build kept the warning at 2x (`Expected: 0 Received: 1`).

### No export replaces another (T-106)

- **Video 4l GifPanel - Export GIF; 4m CompilationPanel - Compile N clips; 4t ExportPanel - Export N files ([T-106], end
  state changed):** a second job with the same settings is written beside the first (`name (2).ext`), and the panel points
  at the file it wrote. E2E ("a second GIF, compilation and export with the same settings land beside the first and never
  over it"): a GIF at 320 px / 12 fps then again at 2x -> `pipeline_320px_12fps.gif` and `... (2).gif`, the first byte for
  byte what it was, the toast's "Show in folder" delivering the `(2)` path to the shell; a compilation, then again with Clip 1
  at 2x -> `pipeline_compilation (2).mp4`, the first untouched; a two-clip export, then again -> `Clip 1-youtube (2).mp4` and
  `Clip 2-youtube (2).mp4`, the first batch untouched, the second batch's row button delivering the numbered path.
  Red-first: on the HEAD build the second GIF's `(2)` file never appears (a 9-minute poll). Layer 5 does the same three
  times over for GIF, compile, export (template and default name), reframe and PiP.
- **Video 4k ReframePanel - Reframe to 9:16; 4n PipPanel - Composite ([T-106], end state changed):** the same rule. E2E ("a
  second Reframe and a second picture-in-picture with the same settings land beside the first"): Reframe twice -> `...-center.mp4`
  and `... (2).mp4`, the toast's button delivering the numbered path, the first byte for byte what it was; Composite twice (the
  second with another margin) -> `pipeline_pip.mp4` and `pipeline_pip (2).mp4`, the same checks. Red under a mutated build
  (`nextFreePath` returning its input: the `(2)` file never appears). Layer 5 (both, three runs each) and
  `cancelSentinel.test.ts` (both: the argv names the numbered file, the earlier one is untouched). **PiP now
  holds a run** (the round-58 disposition "PiP (4n) has no run" is superseded): choosing the output's name is a wait before the
  spawn, so a Cancel lands in it like in a probe — `cancelSentinel.test.ts` has PiP in the pre-spawn table.
- **Video 4p ClipKit - the button ([T-106], end state changed):** a second kit of the same clip on the same day gets
  `<clip>-kit-<date> (2)`, and the reveal opens THAT folder. E2E ("a second kit of the same clip on the same day lands in its
  own folder, and the first kit is untouched"). Red-first: on the HEAD build the second folder never appears. Unit: `outputPath.test.ts` (`makeKitDir` twice).
- **Video 4t ExportPanel / 4k / 4l / 4m / 4n - Cancel ([T-106], end state changed):** a Cancel on a job that shares a name with
  an earlier export removes the job's own file and leaves the earlier one (T-100 used to delete it). Layer 5 ("a canceled job
  beside an earlier export of the same name leaves that export alone": an export and a GIF, red on HEAD with `the earlier export
  is still there: expected false to be true`), and the output rows of `cancelSentinel.test.ts` for each naming runner.
- **Video 4t ExportPanel - Export N files, with a damaged crop ([T-106], end state changed):** from "ffmpeg's own failure" to
  one plain sentence before any job starts. E2E ("a hand-edited project with a damaged crop is refused in plain words … and
  redrawing the crop fixes it"): Open project (the project chooser stubbed) with a clip whose crop is twice the frame ->
  Export -> "One of this project's clips has a damaged crop — redraw it and try again." and a Failed row, no file written;
  Crop + 16:9 -> the same Export writes its file. Red-first: the HEAD build toasted `Export failed. imagii's video tool stopped before it finished…`. Unit: `videoExportBatch.test.ts`.
- **Video 4d CropOverlay - Crop checkbox, aspect presets ([T-106]):** the recovery path the sentence names ("redraw it") is
  driven end to end in the row above.
- **DISPOSITIONS, restated:** the folder and project choosers are the house stubs (HL-dialog); "Show in folder" is
  `stubShellReveal` (HL-shell); Clip Kit's own reveal is stubbed the same way in the kit row. The win32 `drawtext` case for a
  compiled overlay runs where the product ships (the release workflow), with the linux pin and the drawbox stand-in covering
  the argument everywhere else.

### Found, not fixed

- **The Crop checkbox starts unchecked on a loaded project even when its clips carry a stored crop**, so the crop is
  invisible (the player draws nothing) while every export, GIF and compilation applies it. Found while writing the T-106 recovery
  test: the damaged-crop sentence says "redraw it", and the person has to check Crop and pick a shape to do that. `cropEnabled`
  is local state in `Player.tsx`, initialized to `false`; it should start from "the selected clip has a crop".
- **Auto Zoom zooms toward the top-left corner, not the middle.** `zoompan`'s `x` and `y` default to 0, so the pulse that peaks
  at 1.05x moves the picture's center about 24 px right and 13 px down (measured at 1.4 s in a 1280x720 compile). Appearance only,
  in every platform export since Auto Zoom shipped; a centered zoom is `x='iw/2-(iw/zoom/2)'`, `y='ih/2-(ih/zoom/2)'`.
- **The Temperature slider moves only a picture's shadows.** The grade is `colorbalance=rs/bs`, which weights dark areas: a warm
  +1.0 on a mid-blue frame changes it by 2 levels per channel (63,111,191 -> 61,109,189) and on dark gray by +27 / -22. On
  most footage "warm" and "cool" read as nothing.
- **`video:exportBatch` does not range-check a clip's speed, grade or effect flags** (only the crop and the overlays); the new
  compile segments are checked for all of them. They cannot become filter text, only a TypeError or an ffmpeg refusal.
- **Compile's and the GIF's crop refusals still speak the validator's path** (`segments[0].cropRect.w must be in [...]`), which
  `userFacingError` hides behind "Compilation failed." / "GIF export failed."; the batch now says "One of this project's clips
  has a damaged crop — redraw it and try again." The same one-line wrapper would give all three the same sentence.
- **The GIF ignores the clip's own speed, color grade and effects** (its Speed select is separate). A GIF of a 2x, graded clip
  is 1x and ungraded unless the panel's select says otherwise.
- **`docs/USER_GUIDE.md` still says Stream Graphics images "download without asking"** — true before T-91, false since.
- **`npm run test:media` takes about four minutes here**, not the "~90 seconds" `docs/TESTING.md` quotes.

## Dispositions — round 60 (T-102 + T-103 + T-107 + T-108 + T-109: the install path that survives the exe; sample words that never ship; a project that never points at scratch; Cancel for transcription; the round-59 finds)

**One new interactive control** (the Cancel button on the transcription row, new IPC `captions:cancelTranscribe`) and **a
dozen existing ones whose end state changes.** Every end state below is reachable without an OS boundary except the portable
exe itself (HAND-TEST 15): the engine is a **stand-in script dropped where the T-102 resolver now looks** (`<userData>/bin`),
so the real extraction runs and the real spawn happens (the speech engine itself is still HL-whisper); the project chooser, the
save chooser and the folder chooser are the house main-process stubs (HL-dialog); the exports are decoded by the bundled ffmpeg
and read as pixels. **This round changes ffmpeg graphs (Auto Zoom's, the grade's) and the audio extractor**, so Layer 5 is part
of the T-108 and T-109 rows (IMG-PREC).

### The captions setup path is real on the portable exe (T-102)

- **Video 4o CaptionsPanel - the setup card, Show/Hide setup instructions, Open folder, Refresh status ([T-102], path and copy
  changed):** the first path is `<userData>/bin/whisper-cli.exe`, created on first ask, with the line "This folder survives app
  updates, so you only set this up once." E2E (the T-89 test, extended): the path's folder is `<userData>/bin`, it is not under
  `resources`, it exists on disk, and the sentence is on screen. Red-first: `Expected: ".../ud-captions-…/bin"
  Received: ".../resources"`. Unit: `paths.test.ts` (the whole resolver order, the lazy folder, an unmakeable folder). DISPOSITION:
  **Open folder** is `shell.openPath` (HL-shell: its argument is the folder the card names and the folder exists, both asserted);
  the exe itself on a clean Windows machine is **HAND-TEST 15**, which stays — the fix makes the documented path real, the hand-test
  confirms the portable build.
- **Video 4o CaptionsPanel - Transcribe, with the engine found in the user folder ([T-102]):** reachable now. The two cancel rows
  below use it; they would have been unreachable before (the card could not be satisfied in a test without writing into the repo).

### Sample words stay out of the export (T-103)

- **Stream Graphics - every template card in the Templates dialog and the empty-state grid; References - every Asset Library card
  that opens as a canvas ([T-103], end state changed):** applying one still draws its sample text on the canvas; the export
  leaves it out until it is retyped. E2E ("sample words stay out of the export until you type your own"): `yt-thumb-bold` ->
  the Layers panel tags Title "hint — won't export"; Export -> the title's box is plain background (0 non-background pixels),
  with the accent bar in the same file as the positive control; type "MY TITLE" into Text -> the tag goes, Export -> > 3 000
  glyph pixels in the same box. Red-first: `Expected: 0 Received: 29528`. **The rule (refined the same day): text the person MUST
  replace is a hint; text that IS the card's deliverable exports.** E2E ("text that IS the card's deliverable exports"): References ->
  Asset Library -> the BRB card opens in Stream Graphics; the Layers panel tags Handle and not Brb or Sub; Export -> "BE RIGHT BACK"
  is in the file (> 3 000 glyph pixels in the headline's box) and the handle's box is plain background. Unit: `templateTruth.test.ts`
  is a **per-card table** of which text layers are hints and which are content for all 21 cards (a new text layer or card fails
  until it is decided), plus "the four deliverables export" (BRB, STARTING SOON, THANKS FOR HANGING OUT, POG), a
  guard that content never reads like a stand-in, and "every non-text design layer is not a hint".
- **Stream Graphics - Layers panel tag ([T-103]):** on every sample-text layer a person must replace; the first T-91 E2E asserts it
  for the title as well as the face guide, the BRB E2E asserts its absence on the scene's words. The overlay test keeps its plate
  and facecam border exporting.
- **DISPOSITIONS:** a **keep-a-hint control stays unbuilt** (retype, or delete and redraw, covers it); **pre-round-55 mood-board
  references** keep exporting as saved (no reliable migration; recorded in round 55). **Scene cards and the text emote export their
  words** (the refined ruling); judgment calls recorded in the table: the lines under the scene titles are content, the thumbnail
  card's "TUTORIAL" eyebrow is a hint, and the starting-soon "0:00" countdown is a hint (flipped at expedite), so its "to replace" description is true as written.

### A project never points at a converted copy (T-107)

- **Video 4a Importer - drop zone and Choose file, for an flv/ts/wmv/mpg/3gp ([T-107], end state changed):** the studio's source
  is the working copy as before, but the store keeps the original beside it, the header and the export names use the original's
  name. E2E ("an flv is converted again when its project is opened after the working copy is gone"): the header reads
  `e2e-clip.flv` after the drop. Layer 5 already proves the conversion per container (round 20).
- **Home - Save project / Open project, with a converted import ([T-107], end state changed):** schema 5. E2E (the same test):
  Save from Home -> the file names the flv (`videoStudio.sourcePath`, `convertedForImport: true`) and the flv again for the sound
  (`audioStudio.extractedFromVideo: true`), schema 5, no `imagii-import` or `imagii-audio` anywhere in it; close the app, delete
  the working copy AND the scratch WAV, relaunch the same profile, Open project -> "Converting for editing…" appeared, "Project
  loaded", both studios load from new copies, the old copy was not needed; delete the flv and Open again -> the one sentence
  "Couldn't find e2e-clip.flv… load the video again in Video Studio and the audio again in Audio Studio." Red-first (HEAD build):
  `Received array: ["Couldn't find e2e-clip-eTHEs10y.mp4. …"]`. Unit: `ProjectIO.test.ts` and `projectValidation.test.ts` (24 reds
  on the HEAD source). DISPOSITION: the project chooser and save chooser are HL-dialog stubs.
- **Video 4 VideoStudio - Clean audio ([T-107], end state changed):** hands the audio studio the original as well as the working
  copy; driven in the E2E above (Clean audio, then Save, then reopen).
- **Audio Studio - Open project with a pre-marker (v1-3) extraction whose scratch WAV is gone ([T-107], end state changed):** the
  sound is extracted again from the video the file already named. audio.spec ("a project saved before the marker, whose scratch
  WAV was already pruned, is recovered"): a hand-written v3 file -> "Project loaded", Audio Studio plays, the header says
  `e2e-clip.mp4`, Re-attach is ticked; then with the video deleted -> "Couldn't find e2e-clip.mp4…" (the video, not the WAV).
  Red-first: `["Couldn't find aB3dE5fG7h.wav…"]`. DISPOSITION: a **v4 project whose converted video was already pruned is not
  recoverable** — its path names nothing about the original; it keeps saying the file is gone, as it always did.

### Cancel reaches transcription; four smaller untruths (T-108)

- **Video 4o CaptionsPanel - Cancel on the transcription row ([T-108], NEW control):** shown in the `extracting` and `transcribing`
  phases, calls `captions.cancelTranscribe` (new). E2E ("Cancel stops a transcription while the engine runs"): the stand-in
  engine runs (it records its pid) -> Cancel -> the neutral toast "Transcription canceled." (no status icon, nothing in ffmpeg's
  or the bridge's voice), the engine process is dead, no progress bar and no Cancel remain, Transcribe is enabled, and the WAV
  extracted for it is gone; E2E ("Cancel while the sound is still being extracted…", the 20-minute source): Cancel during
  "Extracting audio…" -> the same toast, the engine's marker file never appears, no WAV left. Red-first (HEAD build, the stand-in
  placed where HEAD looks): the Cancel button never appears (`Expected: visible`). Unit: `transcribeCancel.test.ts` (8) and the
  pre-spawn table of `cancelSentinel.test.ts` (6 rows). Layer 5: a real SIGKILL of a real extraction removes its file.
  DISPOSITION: the `building-srt` phase has no Cancel (instant; a Cancel there could not stop it).
- **Video 4o CaptionsPanel - the progress row after Transcribe or Burn into video finishes ([T-108], end state changed):** the row
  goes back to idle; "Done 100%" no longer stays. E2E: the ranged-burn test asserts no progress bar and no "Done" after each
  finished burn (red-first `Expected: 0 Received: 1`); the T-100 failed/canceled test asserts the same after a stop (shared `finally`).
  The T-89 progress test still drives a `done` event from main (no job is running, so nothing clears it) to assert the row's words.
- **Video 4k ReframePanel - the progress row ([T-108], end state changed):** while main checks the source, the bar is
  indeterminate (no `aria-valuenow`, the `.progress-indeterminate` segment, no "0%"). E2E (the T-98 held-probe test, extended).
  Red-first: no `progressbar` role on HEAD. Unit: `reframeProgress.test.ts`.
- **Audio Studio - the header name ([T-108], end state changed):** a sound extracted from a video shows the VIDEO's name (the
  original's, for a converted import). audio.spec: the extraction test asserts `e2e-clip.mp4` and no `.wav`; the T-99 test asserts
  it again after a relaunch; video-core.spec.ts ("clean audio extracts the track and hands it to Audio Studio") used to assert the header
  read `….wav` and now asserts it reads `video-core.mp4` and no `.wav` (the one existing assertion this round flipped, caught by the full
  run). Red-first: the header showed the scratch name.
- **Preload bridge - `video.cancel(jobId)` and `app.quit()` ([T-108], DELETED with their main handlers):** no control called them.
  `tests/unit/deadExposures.test.ts` holds all 83 functions of `ImagiiApi` to "reached from a renderer file". Red-first: against the
  HEAD `api.ts` it reports exactly `['app.quit', 'video.cancel']`.

### Crop, zoom, temperature, refusals (T-109)

- **Video 4d CropControls - Crop checkbox; CropOverlay - the rectangle ([T-109], end state changed):** a clip with a stored crop
  opens checked with the rectangle on the picture; the box follows the selected clip; unchecking clears the crop; Undo brings it
  back, visibly. E2E ("a crop stored in a project is visible when it opens") and its control ("a project with no crop opens with the
  box unchecked"). Red-first: `Expected: checked Received: unchecked`. The aspect presets and Reset are unchanged (still driven by
  video-core.spec.ts).
- **Video 4i ColorGradePanel - Temperature slider ([T-109], end state changed):** warm/cool now reach the mid-tones and highlights.
  Layer 5 ("Temperature warms and cools the mid-tones and highlights, not only the shadows"; HEAD: `warm mid-tone 125,125,125 vs
  128,128,128`) and `filters.test.ts`. DISPOSITION: the player does not preview color (it never did), so the slider's end state is
  the exported file, which is where Layer 5 reads it.
- **Video 4i ColorGradePanel - Auto-zoom checkbox ([T-109], end state changed):** the pulse is about the middle of the frame.
  Layer 5 ("Auto Zoom zooms about the CENTRE of the frame", and the platform-export twin; HEAD: `(663.5, 373)` against `(640, 360)`).
- **Video 4l GifPanel - Export GIF; 4m CompilationPanel - Compile N clips, with a damaged crop ([T-109], end state changed):** the
  same plain sentence the batch speaks. E2E (the T-106 damaged-crop test, extended): after the batch's refusal, Export GIF and then
  Compile 2 clips each toast "One of this project's clips has a damaged crop — redraw it and try again." and nothing else, no
  file written. Red-first: `Expected: 2 Received: 1` sentences. Unit: `videoCropPayload.test.ts`.

### Closed from round 59's "Found, not fixed"

The Crop checkbox starting unchecked (T-109a); the top-left Auto Zoom (T-109b); the Temperature slider (T-109c); Compile's and the GIF's
crop refusals (T-109d); the stale USER_GUIDE line (T-109e). Still open from that list: the GIF ignores the clip's own speed, grade
and effects. (`video:exportBatch` not range-checking a clip's speed, grade or effect flags was closed by T-111(3), round 61.)

### Found, not fixed

- **A converted import is converted again on every open** (T-99's rule), so opening a project with a two-hour flv waits a transcode
  (minutes) behind the "Converting for editing…" toast, where an extraction waits seconds. A cache keyed by the original's path,
  size and mtime, kept outside the temp families, would remove it.
- **Re-attach after a reopen muxes the ORIGINAL** (the project names it), and `-c:v copy` into an mp4 only works for codecs mp4
  carries (h264 flv does; a wmv's may not). In the session that converted it, re-attach still uses the h264 working copy.
  (Closed by T-111(13), round 61: a picture an mp4 cannot carry is re-encoded in the mux.)
- **The Temperature coefficients (a quarter for the mid-tones, a half for the highlights of the shadows' strength) were chosen from a
  tonal curve measured on the linux ffmpeg 7.0.2**; the shipped Windows build is 6.1.1 with the same filter source. Layer 5 runs on
  the release workflow's windows-latest, which is where that is confirmed; a hand look at real footage is worth a minute.
- **A canceled or failed Open project of a converted import leaves the "Converting for editing…" toast only as long as the
  conversion** (it is dismissed in a `finally`); there is no Cancel for the conversion itself (the import path never had one).

## Dispositions — round 61 (T-111: the review gate's main-process and media-chain fixes)

Fifteen fixes from the nine-reviewer sweep over the held wave; the renderer half is T-112 (round 62). Every behavior change below
was red-first (the quotes are in `LESSONS_LEARNED.md`, 2026-10-10 round 61). Where a row says "win32 twin", the real-drawtext render
is gated to win32 like the rest of the T-51 block; the same cases were also run during the round against a system ffmpeg 6.1.1 (the
shipped build's major, which has drawtext) with a font stand-in.

### What goes into the filter graph

- **Video 4q TextOverlayEditor - the caption field; 4t ExportPanel - the Watermark field ([T-111], end state changed):** the text
  drawn is the text typed, for an apostrophe, a percent sign, a colon, a backslash and a newline. `escapeDrawtext` writes for the
  three passes ffmpeg makes over `text='...'`. Layer 5 win32 twins ("T-111: an apostrophe, a percent sign, a colon and a backslash in
  an overlay export and paint"; "a two-line overlay draws both lines, and a watermark with an apostrophe and a percent sign draws");
  `filters.test.ts` parses the escape back the way ffmpeg does (a model of `av_get_token` and drawtext's expansion) for twelve texts
  and holds the whole graph for "Let's go" and "Sale 50% off". Red-first: `No such filter: '0.000'`; `0 green px`; 15 unit reds.
  DISPOSITION: the linux build has no drawtext, so the render is win32 (the release workflow); nothing in `tests/` runs a
  system-binary variant (the suite has no pattern for one).
- **Video 4t ExportPanel - a custom preset of an odd size ([T-111], end state changed):** exports at the even size below it
  (1081x607 -> 1080x606) and the grid shows that size. Layer 5 ("an odd custom size exports"; HEAD: `width not divisible by 2
  (1081x607)`); `presets.test.ts` and `presetTablesInSync.test.ts` (main and renderer agree on the even size).
- **Video 4t ExportPanel - Export; 4p ClipKit - with a hand-edited clip ([T-111], refusal added):** a speed, grade, effect flag or
  overlay outside what the graph takes is refused for the whole batch, before the first probe, in "One of this project's clips has
  a setting imagii can't use — check its speed, color and text, then try again." `videoExportBatch.test.ts`, 15 cases through the
  real handler (HEAD: a speed of 1e-6 wrote a 261-byte file and reported success). DISPOSITION: a damaged recipe can only arrive in
  a hand-edited project file, so there is no control to drive; the handler is the deepest layer.
- **Video 4t ExportPanel - Export; 4p ClipKit - a second batch while one runs ([T-111], refusal added):** a second `video:exportBatch` while one
  runs is refused with "An export is already running. Wait for it to finish, or cancel it, then try again.", does not disturb the
  first, and the gate opens when the first finishes, fails or is canceled. `videoExportBatch.test.ts`. NOT covered by an E2E: the
  panel's own controls disable themselves, so only two surfaces at once reach it (round 62's T-112 lists the renderer side).
- **Audio SecondaryTrackPanel - Gain, Threshold, Ratio, Attack, Release; Audio - Levels - the loudness number ([T-111], refusal
  added):** the second track's gain and ducking numbers are held to the sliders' ranges (gain -60..+12, threshold -60..0, ratio
  1..20, attack 1..200, release 50..2000) at the export gate AND when a project opens, and the loudness target to loudnorm's
  -70..-5, each in a finished sentence. `audioChainValidation.test.ts` (55 cases through the real handlers with a fake child: the
  command with an injected `gainDb` is shown, then refused with nothing spawned), `audio.test.ts`, `projectValidation.test.ts`.
  An injection is never run through a real ffmpeg. DISPOSITION: the second track's numbers are slider-bound in the UI; the refusals
  are for a hand-edited project. The loudness box is a free number input, so a typed -3 now reaches the sentence — the input's
  `min`/`max` is round 62's.

### The mix, the sound and the picture

- **Audio SecondaryTrackPanel - Add a second track; Audio ExportDialog - Export ([T-111], end state changed):** the voice is one level for the whole
  recording when a shorter music bed ends. `amix` no longer re-weights the survivor (`normalize=0`), and a manual-gain mix ends in a
  limiter at -1 dBFS (a match-loudness mix has its loudnorm's). Layer 5 ("the voice is one level when a shorter music bed ends", six
  cases: manual, ducked, a +6 dB bed, match-loudness, a hot pair limited, a quiet mix left alone). Red-first: the voice stepped
  -30.1 -> -24.1 dB (manual and ducked) and 4.7 dB under match-loudness. The existing equal-length mix cases were unchanged.
- **Audio ExportDialog - Re-attach to video, after a project reopen ([T-111], end state changed):** a picture in a codec an mp4
  cannot hold (wmv2, vp8/vp9, theora, mpeg-2...) is re-encoded in the mux step; h264, hevc, av1, mpeg-4 and mjpeg are still copied
  packet for packet. Layer 5 ("a picture an mp4 cannot carry is re-encoded, not copied": a wmv2 original -> playable h264 with the
  cleaned sound; the h264 control byte-identical; a cut one) and `muxCodec.test.ts` (the command for each codec, a failed probe,
  a Cancel in the probe). Red-first: `Could not find tag for codec wmv2 in stream #0`. DEVIATION recorded in the ticket's report:
  the extra step is not a separate "convert" pass, so no new progress label — the mux pass re-encodes and its bar measures.
  NOT covered by an E2E: reopening a project whose source is a .wmv, then Re-attach.
- **Video 4o CaptionsPanel - Transcribe ([T-111], end state changed):** the scratch WAV the engine reads is 16 kHz mono (a sixth of
  the bytes; older whisper.exe builds refuse anything else); Audio Studio's extraction stays 48 kHz stereo. Layer 5 ("the
  transcription format is 16 kHz mono, a sixth the size, and Audio Studio's stays 48 kHz stereo", ffprobe) and
  `transcribeCancel.test.ts` (the argv of the real extractor under `runTranscribe`). DISPOSITION: the engine is HL-whisper.
- **Video 4o CaptionsPanel - Transcribe's Cancel, pressed before the extraction child exists ([T-111]):** the child that arrives
  late is killed AND leaves nothing registered, so the next cancel finds nothing. `transcribeCancel.test.ts`.
- **App quit during Audio Studio's import of a video's sound ([T-111]):** the extraction ffmpeg is in a registry the quit sweep and
  `cancelAllAudioJobs` reach. `extract.test.ts` (fake child: register, clear on close and on error, kill, sweep) and Layer 5
  ("cancelAllExtractions SIGKILLs a real extraction nobody holds a handle to, and its WAV goes"). DISPOSITION: the quit itself is
  Electron's `before-quit`, which no test fires; main's sweep list names the call.
- **Video 4o CaptionsPanel - Burn into video, its bar and its size ([T-111], end state changed):** (1) the bar is the encode
  position over the length of the file (0 at the start, never 100 until `done`, absent when the length is unknown); (2) the same
  Size draws the same share of the picture's WIDTH on 1920x1080 and 1080x1920 (and square and 4:5), with the caption as far up the
  frame as before, and a landscape burn's command is exactly what it was. Unit: `captions.test.ts`, `whisperManager.test.ts`,
  `captionsProgress.test.ts`; `cancelSentinel.test.ts` (the burn now probes first, and a Cancel in that wait ends it at once).
  Layer 5 ("burned caption size follows the frame": glyph height over frame width within 10% on four shapes; the vertical
  default is one line at under 7% of the frame's height; the margin; a bigger Size is bigger; the bar's last report is near the
  end). Red-first: the vertical default was a 353 px block (18% of the frame, three lines) against a 3% line. The panel's Size
  readout still says "on 1080p" (T-112 wires the frame's real size into `effectiveCaptionPx`).
- **Reframe progress listener, preload ([T-111]):** typed `percent?: number` as `api.ts` and main have it. `reframeProgress.test.ts`
  reads the source (the preload imports Electron).

### Closed from round 60's "Found, not fixed"

Re-attach after a reopen muxing an original mp4 cannot carry (T-111(13)); `video:exportBatch` not range-checking a clip's
recipe (T-111(3)); the burn-in's invented percentage (T-111(10); the MP4 convert's remains an estimate).

### Found, not fixed

- **Compile's recipe refusals still name their field** ("segments[0].speedMultiplier must be in [...]"), which `userFacingError`
  turns into the generic failed line, while the batch now speaks a sentence. `videoCropPayload.test.ts` pins "only the crop speaks the
  plain sentence" on purpose; the GIF has no recipe to check.
- **A burn-in sizes by the CODED size of the video**, so a phone clip stored landscape and tagged rotated is sized as landscape on
  a portrait picture (T-110h's rotation-aware probe fixes it for the burn, the crop and the grid together).
- **The loudness box takes any number** (the sentence now says what to change, after the Export click). `LOUDNESS_TARGET_LUFS` is
  exported from `@shared/audio` for the input's `min`/`max`.
- **`convertForImport` still leaves its half-written copy** when it fails or is canceled (the launch prune reaps it).
- **An odd-sized picture cannot be re-encoded for the mux** (libx264 refuses an odd side): already true of a cut re-attach, and now
  also reachable for a non-carriable codec; no codec in the list encodes odd sizes, so it needs an odd-size file in a carriable codec
  plus a cut.

## Dispositions — round 62 (T-112: the review gate's renderer fixes)

Thirty-six fixes from the nine-reviewer sweep over the held wave: the renderer half of what round 61 (T-111) did in main. Every behavior
change was red-first (the quotes are in `LESSONS_LEARNED.md`, 2026-10-10 round 62), and every new refusal was shown to discriminate
(guard broken, the exact red named, the file restored byte for byte). **No ffmpeg command, filter graph or audio chain changed**
(IMG-PREC's Layer 5 trigger did not fire): the main-side edits are Reels' number in the mirrored preset table, pinned by
`presetTablesInSync.test.ts`, and `video:removeKitDir` (approved after the first hand-back). The OS boundaries are the house stubs (HL-dialog: the folder chooser and the native confirm), the held
probe (`installSpawnStall`) and a handler the test holds open (the speech engine, HL-whisper). E2E names below are in
`video-pipelines.spec.ts` ("T-112: review-gate fixes") unless a spec is named.

### Video Studio - what Export, Clip Kit and Compile say and do

- **Video 4p ClipKit - Clip Kit, a 16:9 recording cropped to 9:16 ([T-112], end state changed):** the YouTube slot is a 1080x1920 Short
  (`Clip_1_youtube_short.mp4`), judged by the CROP's frame (`cropFrameSize`) and not the source's; a portrait recording cropped to landscape
  keeps its landscape YouTube file; a square crop is not vertical. E2E "a 16:9 recording cropped to 9:16 gets a Short from Clip Kit...":
  eight files, the Short probes 1080x1920, no `Clip_1_youtube.mp4`. Unit: `clipKit.test.ts` (six cases incl. an unsizable probe).
- **Video 4p ClipKit - the button's label and color ([T-112]):** "Exporting platform version n of 5…" then "Extracting thumbnail n of 3…", moved by
  `video:jobComplete`; E2E holds job 2's probe and reads "version 2 of 5". The label reads in ink (4.1:1 at rest and 3.6:1 on hover became
  12.0 and 10.5). Unit: `kitExportLabel` / `kitThumbLabel`. **The empty kit folder is removed (approved main-side addition, `video:removeKitDir`):** a Cancel
  or a failure before ANY file landed in the folder (`landed`, counted per finished job and per finished thumbnail) asks main to remove it; main
  does a non-recursive `rmdir` behind the `assertSafeAbsolutePath` gate, so it can never take a file, and any refusal (not empty, gone, a file) is a
  console note, never a user-facing error. Once a file has landed the renderer does not ask. E2E (red-first: on the build before the change the
  folder survived, `existsSync(kitDir)` `Expected: false` / `Received: true`): "a kit canceled before any file landed takes its empty folder with
  it" (job 1's probe held; the real handler), "a kit that fails before any file landed takes its empty folder with it" (the source removed under
  the held probe; the real handler), "a kit canceled after a file landed keeps its folder, and the renderer does not even ask" (job 2's probe held;
  a recording handler sees zero calls); "cancelling a kit asks first" now holds job 2's probe so its folder has a file in it. Unit:
  `videoRemoveKitDir.test.ts` (15 cases through the real handler on real folders: an empty folder goes; a folder with a file, with an empty
  subfolder, a missing path and a path that is a file all stay without an error; a console note only on a refusal; relative, `..`, empty and
  non-string paths are refused before anything is touched), `interactionWiring.test.ts` (the single call site, in the catch, guarded by `landed === 0`).
- **Video 4t ExportPanel - the platform grid, Reels and TikTok ([T-112], verdict changed):** Reels' limit is 20 minutes (it was 180 s, Instagram's
  RECOMMENDATION cutoff); past 3 minutes the card is yellow "Over 3 minutes — Instagram won't recommend it to new viewers", red only past 20;
  TikTok no longer says "Over the 34-second sweet spot" of a clip of a minute or more (the short-clip advice below a minute is unchanged).
  The Clip Kit's long-clip question moved with the limit ("the typical 20-minute limit"). E2E: the T-97 speed test, re-pointed (300 s at 1x gets Instagram's
  advice and no "Too long", 150 s at 2x the sweet-spot reason, 600 s at 0.5x the advice again, never the length's red; the 4:3 fixture's card as a
  whole still reads "Wrong shape" for 9:16, which is the shape's verdict, and the level the length alone gives is pinned in `presets.test.ts`) plus a
  36-minute source (red at 1x, the advice at 2x);
  the two Clip Kit question tests moved to the 36-minute source. Unit: `presets.test.ts`, `clipKit.test.ts`, `presetTablesInSync.test.ts`.
- **Video 4t ExportPanel - Export with no folder; the disabled Export ([T-112], end state changed):** Export opens the chooser itself, and a canceled
  chooser starts nothing and says nothing; with nothing checked the button is off and "Check at least one platform below to export." is on screen
  and its title. E2E "with no output folder Export opens the chooser..." (canceled -> nothing; answered -> the folder is taken and the export
  runs in one click; the hint comes and goes with the checkbox). The old red "Choose an output folder first" toast is gone and pinned gone.
- **Video 4t ExportPanel - the queue's rows ([T-112], end state changed):** the row that failed is "Failed" (red) with its reason as TEXT; the rows
  the batch never reached are "Not run" (neutral); a canceled batch keeps "Canceled" for every unfinished row; a finished row shows the file it
  wrote (`name (2).mp4` when the name was taken). E2E "a failed batch marks the job that failed...": four jobs (YouTube, X / Twitter, Facebook, Reels;
  the safe-zone question answered "Export anyway"), the source removed while job 2's probe is held -> one finished, one Failed, two Not run, one red
  bar, the reason visible after the toast fades; the dup test asserts the numbered names on the rows. Unit: `settleJobs` (seven cases). The batch-refused-before-it-starts case reads Failed on row 1 (ceiling in the file).
- **Video 4t ExportPanel - Export again after leaving and returning ([T-112], the T-111 refusal driven):** the returning panel believes nothing runs; the
  second Export is refused with "An export is already running. Wait for it to finish, or cancel it, then try again." (an error toast, on the row as
  text) and starts nothing (the spawn log is unchanged). E2E "pressing Export again after leaving Video Studio and coming back is refused...".
  DISPOSITION: the orphaned Cancel/progress of the first batch is T-110(j), not this round.
- **Video 4l GifPanel / 4m CompilationPanel / 4k ReframePanel / 4n PipPanel - the saved toast ([T-112]):** "Saved <the file>" with the runner's own name,
  `name (2).gif` included. E2E: the four T-106 duplicate cases assert the numbered name in the toast; the first-run tests assert the plain one.
  Verified, not changed: all four IPCs already returned the real `outputPath` (`nextFreePath`), so no main edit was needed.
- **Video 4m CompilationPanel - the card ([T-112]):** says "1920×1080, 30 fps" (from `COMPILE_SIZE` and `COMPILE_TARGET.fps`, which
  `presetTablesInSync` ties to main's `COMPILE_FPS`); "Crossfade" is "Fade between clips" and says what it is (out to black, in from black, no
  overlap, 0 ms is a hard cut). The verdict list takes focus (`tabIndex=0`, an accent ring on keyboard focus) and its name column flexes
  (a 2:3 share of the row beside the verdict, both able to shrink: a bare `flex-1` name gets 0 px beside a verdict whose reasons are one long line;
  asserted > 100 px, the whole name in its title). E2E "the Compile card says what it makes...". The slider's accessible name is now "Fade between clips, in
  milliseconds" (every Compile test moved with it).
- **Video 4m CompilationPanel - Compile, a clip stored at speed 0 ([T-112], refusal avoided):** the wire carries the speed the clip PLAYS at
  (`clipRecipe` -> `clipSpeed`), so a legacy 0 compiles at 1x instead of failing main's round-61 validator. The fix is in the shared function,
  not the panel. E2E "a clip whose stored speed is 0 compiles at 1x..." (a project with a 0, the real compile, two 1 s clips -> ~2 s, no failure
  toast). Unit: `clip.test.ts`. The Export batch and Clip Kit still refuse such a clip (their sentence names the speed): "Found, not fixed".
- **Video 4f ClipList - the Hook badge ([T-112], end state changed):** the window it listens to is 3 x the clip's speed in source seconds
  (3 output seconds), cut at the clip's end, and the label beside it says the same number ("First 3 s:", or "First 2 s:" for a clip of two seconds;
  it said 3 over a window that ran past the clip). The T-92 hook test reads the 2 s fixture's "First 2 s:" and "first 2 seconds"; the T-112 test reads
  "First 3 s:" on a long clip at every speed. `interactionWiring.test.ts` pins that label and window come from one `hookWindow`. The ticket said "divide"; output time is source time over the speed, so the window is multiplied.
  E2E "the hook badge listens to the first 3 seconds the viewer SEES" replaces the IPC in main and reads 6 / 1.5 / 12 / 3 s at 2x / 0.5x / 4x / 1x.
  Unit: `hookWindow` (`highlights.test.ts`).
- **Video 4f ClipList - the select button and the selected row ([T-112], a11y):** the button's name contains its timecode ("Select clip Clip 1,
  0:00 → 0:02"); the selected row and its button carry `aria-current="true"`. E2E: the clip-list test in `video-core.spec.ts`;
  `interactionWiring.test.ts` pins the label.
- **Video 4k ReframePanel - Left / Center / Right ([T-112], a11y):** `aria-pressed`. E2E: the reframe test asserts the state through every click.
- **Video 4l GifPanel - the length warning ([T-112], a11y):** an always-mounted `role="status"` region, so a Speed change announces it. E2E "the GIF
  length warning is announced...": the region exists and is empty at 1x, holds the warning at 0.5x, empties again.
- **Video 4j HighlightPanel - the score pill ([T-112], contrast):** ink on the accent wash with an accent border (3.58:1 -> 10.5:1). E2E: the highlight
  test reads the computed color. Unit: `designTokensInSync.test.ts` recomputes all four pairings from the tokens.

### Video Studio - what a video with no sound, a late result, a second drop and a Reset do

- **Video - Clean audio; 4o CaptionsPanel - Transcribe; 4j HighlightPanel - Scan VOD, for a video with no audio stream ([T-112], gated):** each is off and
  says "This video has no sound." (the probe's `audioCodec` was already exposed, so no main edit). E2E "a video with no sound has nothing to clean,
  transcribe or scan...": the flat-green fixture has no audio; a forced click on Clean audio goes nowhere; the control video has all three.
- **Video - Clean audio, with a tuned Audio Studio session ([T-112], confirm added):** asks "Close this audio? Your cleanup settings will be
  discarded." (`audioCloseMessage`, moved to `audioClose.ts` so Video Studio need not import the Audio Studio component) before replacing it
  - as written in round 62; **round 63 [T-113] changed the Clean-audio confirm to "Replace the audio you're editing? ..." (the row below), and
  "Close this audio?" is now Audio Studio's own Close only**;
  declined = nothing extracted, nothing opened; an untouched session asks nothing. E2E "Clean audio asks before it replaces a tuned Audio Studio
  session...". NAT: the confirm is a native dialog, answered by the test's dialog handler.
- **Video 4a Importer - drop zone, Choose file…, Recent ([T-112], refusal added):** a second import while one runs is refused ("Still converting the last
  video. Wait for it to finish." / "Still loading..."), from the drop and from Recent alike (a ref, not state, so two arrivals in one tick are both
  seen). E2E "a second drop while a conversion runs is refused...": an flv's conversion is held; the second file is left alone, one ffmpeg ran, the
  first video opens, and the importer takes a file again afterwards.
- **Video 4o CaptionsPanel - Transcribe, a result that arrives after the video changed ([T-112], refusal added):** the result is applied only to the
  video the job started on (`videoStore.setSrtPathFor`); otherwise B gets nothing and a toast says the captions were not added. E2E
  "transcription that finishes after the video changed is not attached to the new video": a held `captions:transcribe`; A closed, B dropped, A's
  job released -> no Burn into video, no A words, the toast. Unit: `videoStore.test.ts` (six cases through the real `loadSource`).
- **Video 4o CaptionsPanel - the header button during a burn-in ([T-112]):** "Burning in…" (disabled), never "Transcribing…". E2E: the real burn in
  the T-100 test.
- **Video 4o CaptionsPanel - the setup card's links and the Size readout ([T-112]):** underlined at rest and in the `warn` tone (4.10:1 -> 10.4:1);
  the readout is "about N px tall on this video" from the loaded frame (`effectiveCaptionPx` with the width), the 1080p wording only with no
  video. E2E: the setup test (computed `text-decoration` and color on six links) and the style test (320x240 -> 20 / 35 / 18 / 45 px).
- **Video 4d CropControls - Reset ([T-112], end state changed):** clears the crop and keeps the section open whichever way the crop arrived. E2E "Reset
  clears the crop but keeps the Crop section open...": a project-loaded crop (red before: the box unchecked itself) and a hand-drawn one (the control).
- **Video 4d Player - Crop guides ([T-112]):** the overlay's svg is `aria-hidden`; the dead 16:9 guide (a color and a shape no caller used) is gone.
  E2E: the transport test; `designTokensInSync.test.ts` pins the source to three guides.

### Opening a project, Audio Studio and Stream Graphics

- **Home - Open project; the autosave Restore banner - Restore ([T-112], reports changed):** the outcome has three kinds of "not applied": a file that is
  gone (said only when the failure is a not-there error, `isMissingFileError`), a file that was there and would not open (the real cause through
  `userFacingError`: "Your disk is full...", "That file looks damaged..."), and a source skipped because the person opened a different one while the
  long re-convert / re-extract ran (never clobbered). One string, `describeApplyOutcome`, toasted by both callers. Unit: `ProjectIO.test.ts`
  (staleness for the video and the sound, closing is not "opening another", the control, the classes, the sentences). E2E: the T-107 reopen test.
  The two existing "fails with the file still there" cases changed knowingly (they were `unavailable`; they are `failed`), and a fixture that said
  "No such file" now says what ffmpeg says. NOT covered by an E2E: opening a project over a video the person opened during the conversion
  (the race needs a hold on main's convert AND a second drop; the unit test drives the real stores and the real `applyProject`).
- **Home - Open project / Restore, the sound of a reopened project ([T-112]):** "Extracting audio…" shows (its own toast id, dismissed in a `finally`) while
  the sound is taken from the video again. E2E: the T-107 reopen test reads it in the toast log; unit: shown under an id, dismissed on success AND on
  failure.
- **Audio ExportDialog - the progress row ([T-112], a11y):** `role="progressbar"`, named by the pass ("Step 2 of 2 — rendering"), with its value. E2E: the
  T-100 export-row test asserts name, min, max and now through both passes.
- **Audio - Fix Wizard, the last card ([T-112]):** the hum line names the notch it applies ("Hum removal: on (50 Hz mains)"); the patch carries the chain's own
  frequency, so Apply writes back what the line said. E2E: the existing wizard test (60 Hz) and "the Fix Wizard keeps the chain's 50 Hz mains...".
- **Audio - Cleanup, the Custom noise floor hint ([T-112]; superseded by [T-125], copy changed):** "-35 is the Light preset's setting." (T-112 had it "-25 is the Light preset's setting", main's `light` being `nf=-25:nr=12`; T-125 (3) swapped the strengths so Light removes the least, `nf=-35:nr=12`, Medium `-30:18`, Aggressive `-25:24`, and the hint follows the preset). E2E: audio.spec.ts "every Cleanup control writes through to the chain" (the sentence, and that Custom still STARTS at -25 / 12, which is no preset's setting now). Layer 5: media.spec.ts "T-125 (3)" (the three strengths remove noise in the order Light < Medium < Aggressive, on both majors).
  Unit: `audioStudioCopy.test.ts` derives the owner of the number from main's `denoiseFilter`. E2E: the Custom-controls test.
- **Audio - Levels, the loudness target box ([T-112], refusal added):** `min`/`max` from `LOUDNESS_TARGET_LUFS`, and a number outside -70..-5 becomes the nearest
  edge when typing ends (blur or Enter), where a number inside goes straight to the chain; junk changes nothing. E2E "the loudness target box stops a number
  loudnorm refuses...": -3 -> -5, -80 -> -70, "" keeps -70, and typing -23 key by key passes through -2. Unit: `commitLoudnessTarget`.
- **Stream Graphics - the canvas, hint text ([T-112]):** a hint's words draw at 40% of their own opacity on the canvas only (`displayOpacity`; the stored layer is
  untouched, a retyped layer is at full strength, `captureDocument` still switches hint nodes off). E2E: the T-103 sample-words test reads the Konva
  nodes' opacity (0.4 for the two hints, 1 for the rest, 1 again after typing) and its two existing pixel checks prove the export is unchanged. Unit:
  `canvas.test.ts`, `canvasStore.test.ts`, and `ExportDialog.test.ts` (a dimmed node is off for the capture and its opacity is never touched).
- **Stream Graphics / References - template cards' descriptions ([T-112]):** the Bold thumbnail (1x, 2K, 4K), Clean thumbnail, Minimal overlay, Profile banner and Channel
  banner descriptions say which text does not export and that what you type does; the Profile banner no longer mentions an "offline screen" no card
  provides and points at the Asset Library's scene cards. Unit: `templateTruth.test.ts` (every template with sample text names it; the five by name).

### Closed from round 61's "Found, not fixed"

The kit folder a canceled or failed kit left behind (round 62's own item 11, closed by the approved `video:removeKitDir`); the loudness target box now has `min`/`max` from `LOUDNESS_TARGET_LUFS` and clamps what is typed (E2E "the loudness target box stops a number loudnorm
refuses..."); the Caption Size readout uses the loaded video's real frame (E2E: the style test's 20 / 35 / 18 / 45 px at 320x240); the T-111
single-flight refusal is driven end to end from a returning panel (E2E "pressing Export again after leaving Video Studio and coming back is refused...").

### Found, not fixed

- **The Export batch and Clip Kit still refuse a clip stored at speed 0** (the batch's recipe check, round 61), and the slider shows 1.00x, so the person
  cannot see what to change. Compile plays it at 1x now (`clipRecipe` -> `clipSpeed`); the batch and the kit read the same speed one step later.
- **`settleJobs` blames row 1 for a refusal before anything starts** (the single-flight gate refuses the batch; no job began). The ceiling is in the file;
  a `video:jobStarted` event from main would name the real culprit.
- **Catalog and template cards that carry hint text say nothing about it**: frame-clean-corner and its 2K/4K variants, lower-third-clean, the scene cards,
  social-square-clip (the five cards this round named are done).
- **The native `loadSource` probe in `applyProject` is unguarded** (milliseconds, no conversion or extraction ahead of it); the long waits are guarded.
- **Panel-local job state and the orphaned Cancel** are T-110(j): a panel that unmounts forgets its job; the importer's busy toast has its own id,
  separate from Clean audio's "Opening Audio Studio".
- **Audio Studio's slider hints are hover-only.** `ParamSlider` puts its `hint` in the label's `title`, so the corrected "-25 is the Light preset's
  setting." is read by pointer users only (the E2E reads the attribute). Verdict reasons were moved on screen for the same reason in T-83; the
  Custom controls' hints have not been.

## Dispositions — round 63 (T-113: the review gate's second pass)

Nineteen fixes from the nine reviewers' second pass over the held wave. Every behavior change was red-first (the quotes and the mutation table, with sha256 before and after each restore, are in `LESSONS_LEARNED.md`, 2026-10-10 round 63). **IMG-PREC's Layer 5 trigger fired twice:** the re-attach re-encode gained an ffmpeg stage (three real-media cases, odd-sized VP9/VP8 webm) and the kit's captions needed a real file to prove their clock (two cases measuring the loudness of the kit's own export at the moment a cue starts). The OS boundaries are the house stubs: the folder chooser and native confirm (HL-dialog), the held probe (`installSpawnStall`), and a main handler the test replaces where the real one needs the speech engine or a 141 MB download (HL-whisper, HL-network); the panel's markup, its toasts and its code are the product's. E2E names are in `video-pipelines.spec.ts` ("T-113: review-gate fixes, pass 2") unless a spec is named.

### Video Studio - text overlays, Export, Compile

- **Video 4q TextOverlayEditor - "+ Add text", the Color box, the Size box ([T-113], end state changed):** the untouched overlay is `#ffffff` (it was the name `white`, which every overlay gate refuses) and EXPORTS; the Color box takes a CSS color name or a code, applied when typing ends, shows `#rrggbb` afterwards, and refuses an unknown name in a sentence in the row ("imagii doesn't know that color. Use a name like white or a code like #ffcc00.", `role="alert"`, the text kept to fix); the Size box clamps to 8-512 when typing ends, takes a number inside the range as typed, and no longer turns a typed 72 into 82. E2E: "the text overlay "+ Add text" stores, untouched, is one the exporter takes" (win32: the file; linux: the job reaches ffmpeg and dies at the known `drawtext` pin, never at the gate) and the extended "text overlays: add, edit every field, remove". Unit: `textOverlay.test.ts`, `videoStore.test.ts`, `ProjectIO.test.ts` (save, autosave, restore), `videoCropPayload.test.ts` (Compile).
- **Video 4t ExportPanel - Export with a clip stored at speed 0 ([T-113], end state changed):** the job carries the clip as it plays (`clipForExport`), so a hand-edited or older project's 0 is 1x (it was a batch refusal on a clip the slider showed at 1.00x). E2E "a clip stored at speed 0 exports at 1x" (the file, 2 s). Unit: `clip.test.ts`, and `jobClipNormalized.test.ts` (every export-job builder).
- **Video 4m CompilationPanel - Compile N clips, a refusal ([T-113], words changed):** a segment whose recipe the filter graph cannot take now answers the batch's sentence ("One of this project's clips has a setting imagii can't use - check its speed, color and text, then try again."), the field in the console - it reached the person as "Compilation failed.". Unreachable from the UI (the editor writes only valid values; a hand-edited project is the route): `videoCropPayload.test.ts` drives the real `video:concat` handler, nine recipes and the Electron envelope.
- **Re-attach to video (Audio Studio's Export dialog) of a project's original ([T-113]):** a picture an mp4 cannot carry is re-encoded with an even-sized stage; a 321x241 VP9/VP8 webm used to die with "Error while opening encoder". DISPOSITION: Layer 5 (three cases: VP9, VP8, VP9 with a cut; each `ffprobe`d and decoded to the last frame) and `muxCodec.test.ts` (the stage, and its place before `select`); the Re-attach toggle itself is covered by the existing audio E2Es, which use even-sized sources.

### Video Studio - Clip Kit, the hook badge, the highlight finder

- **Video 4p ClipKit - the `.srt` ([T-113], end state changed):** the kit's captions are the clip's, on the clock of the kit's own files (shifted to the clip's start, cut to its range, divided by its speed); a clip nobody speaks in gets no `.srt` and the success toast says "(no captions fall inside this clip)". **Closes round 62's and the original ledger's "`copySrtTo` not exercised"** (the channel is `captions:writeKitSrt` now): a project file carrying a transcript in the captions folder is the route to a session with both. E2E: "the kit's captions are on the clip's clock" (a 0.5-2.0 s clip at 2x: `Mid_captions.srt` read back, byte for byte, and the video's length; the file was `Mid.srt` when this row was written and was renamed in round 64, T-114, because a clip named like a Windows device made the bare name a device name) and "a clip nobody speaks in gets no .srt". Unit: `captionsWriteKitSrt.test.ts` (the real `captions:writeKitSrt` handler on real files), `captions.test.ts`, `clipKit.test.ts`. Layer 5: "the Clip Kit's captions are on the clock of the kit's own file" (the cue lands on the loud burst, 2x, 0.5x, 1x).
- **Video 4p ClipKit - the long-clip question for a YouTube Short ([T-113], end state changed):** the vertical clip's YouTube slot is "YouTube Short - the typical 3-minute limit" and Reels stays 20 minutes: a 4-minute 9:16 clip now asks, and names only the Short. E2E "a 4-minute vertical clip makes the kit ask about the YouTube Short, and only about it" (the question, then Cancel: nothing started, no folder). Unit: `clipKit.test.ts` (180 s at the limit, a second past it, 2x, landscape, the slots in queue order).
- **Video 4p ClipKit - Cancel, the toast ([T-113], words changed):** with no file finished the folder is gone and the toast says "Clip Kit canceled." alone; with files it still points at the folder. E2E: the three cancel-before-the-first-file tests now match the exact short sentence (`expectCanceledNotFailed` is exact-text), the cancel-after-a-file tests keep the long one.
- **Video 4p ClipKit - the button's `aria-live` ([T-113], a11y):** the label is the progress readout and is now announced. E2E: the full-kit test reads `aria-live="polite"`.
- **Video 4c ClipList - the hook row/badge ([T-113]; the whole-second key was replaced in round 65 by a debounce on the exact window, T-115 - see below):** the badge asks again only when the whole-second window changes (76 slider ticks, at most 12 asks), and a clip whose output is under half a second has no row and asks nothing. E2E: "the hook badge asks once per whole second of window" (the recorded asks while the slider moves 1x, 1.05, 1.1, 1.15, 1.2) and "a clip too short to have a hook shows no hook row" (0.375 s out: no label, no spinner, zero asks; 0.5 s out: "First 0.5 s:" and one ask). The existing "listens to the first 3 seconds the viewer SEES" still passes.
- **Video 4j HighlightPanel - the chat-log disclosure, the scan bar, the signal bars ([T-113], a11y):** `aria-expanded` on the disclosure, a named `progressbar` on the scan bar, a named and valued `meter` on each of the three signal bars. E2E: the scan test reads three meters (Audio 100, Chat 0, Hype 0), the rescoring test reads `aria-expanded` through open and closed, the cancel test reads the bar's name, bounds and value.

### Video Studio - captions, the safe-zone question, the crop and the posting log

- **Video 4o CaptionsPanel - the model download bar and the transcript preview ([T-113], a11y):** the bar is a `progressbar` named "Downloading the caption model" with its value; the preview is a focusable scroller ("Transcript preview", `tabindex="0"`, reachable and scrollable from the keyboard). E2E "the captions panel: the transcript preview scrolls from the keyboard, and the model download is a named progressbar" - the download is a stand-in main handler that sends a 42% event (HL-network: the real 141 MB download is never clicked; the panel, its markup and its toasts are the product's); the preview is read after a stand-in transcription returns thirty lines (HL-whisper).
- **Video 4o CaptionsPanel - the transcript that finished for a video that is gone ([T-113], words changed):** "Captions for X finished after that video was closed or replaced, so they weren't added. Transcribe again when you're ready." E2E: the existing "transcription that finishes after the video changed" test, exact new text. Unit: `captions.test.ts`.
- **Video 4o CaptionsPanel - Burn into video, progress ([T-113], end state changed):** the burn announces itself with no percent, becomes a real bar at 0 once the length is known, and stays indeterminate when it never is (a failed probe no longer freezes a determinate 0%); a probe that reports a frame of 0 no longer refuses the burn. Unit only, at the real runner with a fake child: `captionsProgress.test.ts`, `whisperManager.test.ts`, `captions.test.ts`. DISPOSITION: the E2E burn tests have a real probe; a probe that answers 0 or fails is not reachable from the UI.
- **Transcribe and the model download, a second one while one runs ([T-113], words changed):** main's single-flight gates say "A transcription is already running..." / "A model download is already running..." DISPOSITION: the panel disables its own button while the run is in its module store (T-136 (4): the download is a run, so a panel that mounts again over a download that is still going draws its bar and Cancel and keeps Download off, which the panel's own `useState` did not survive; before T-136 a trip to Home re-enabled the button and the second press was refused by main), so a second request reaches main only from a second window; `whisperManager.test.ts` pins the sentences and that each stands alone through `userFacingError`.
- **Video 4t SafeZoneWarningModal - the cropped-clips list ([T-113], a11y):** a focusable scroller ("Clips that will be cropped"). E2E: the safe-zone pre-flight test focuses it.
- **Video 4e CropOverlay - the shape buttons ([T-113], a11y):** `aria-pressed`. E2E: the Space-on-a-focused-button test reads false then true.
- **Video 4r PostChecklist - the posting log's platforms ([T-113], a11y):** `aria-pressed`. E2E: the posting-log test reads all six off, on, and the three toggled back.

### Opening a project, Audio Studio, Stream Graphics, References, Record

- **Home - Open project; the autosave Restore banner - Restore ([T-113], behavior changed):** (a) the sound's staleness baseline is taken at the start, so a sound opened and tuned during the video's wait is never wiped; (b) the clip selection and playhead are applied only to a video that opened; (c) the conversion's toast is "reopen-convert", apart from the importer's "convert"; (d) a skipped source says what is still open and "Open the project again to bring its video back."; (e) autosave is held for the apply alone and released the moment it ends. Unit through the real stores and the real `applyProject` / `captureForQuit`: `ProjectIO.test.ts` (the second-pass block, the skip sentences, the default-overlay round trip), `useAutosave.test.ts` (eight cases: the quit flush during and after the apply, nested holds, the re-arm). **Residue, stated:** a quit DURING the wait still saves nothing new (the stores hold half a project; the previous autosave stands); a quit AFTER it saves everything, including what was done meanwhile. DISPOSITION: the quit flush is an Electron before-quit round trip; the wait needs a held conversion AND an app quit, which Playwright cannot interleave. The pieces are covered at the deepest layer that has them: the held apply and the capture in unit tests, and the quit flush's IPC in the existing autosave E2E.
- **Video Studio - Clean audio, the confirm ([T-113], words changed):** "Replace the audio you're editing? Your cleanup settings and 2 cuts will be discarded." (Audio Studio's Close keeps "Close this audio?"; both lists now read "X and Y"). E2E: the Clean-audio test reads the new sentence word for word; the Audio Studio Close test reads the grammatical two-item list. Unit: `AudioStudio.test.ts`.
- **Audio - Levels (compressor presets, the loudness box) and Cleanup (noise strengths) ([T-113], a11y):** `aria-pressed` on the preset groups and the range "· -70 to -5" visible beside the loudness box (**round 64 [T-114] moved the range out of the checkbox's label and wrote it "(−70 to −5)"**, see below). E2E: `expectSelected` / `expectNotSelected` now assert `aria-pressed` (every Levels and Cleanup test reads it), and the loudness test reads the range text.
- **Stream Graphics - the toolbar's tools ([T-113], a11y):** `aria-pressed`. E2E: the toolbar test reads the active tool.
- **References - the tab strip ([T-113], a11y):** `aria-current="true"` on the open tab. E2E: the three-tabs test reads it through Reference Search -> Mood Boards.
- **Record - the saving card's convert bar ([T-113], a11y):** a `progressbar` named "Converting the recording to MP4" with its value. E2E: the MP4-save test reads name, bounds and a numeric value during the real convert.
- **Stream Graphics / References - asset cards' descriptions ([T-113]):** nine Asset Library cards (the four overlay frames including the two HiDPI ones, the lower-third, the three scene cards and the square clip card) say their sample text does not export until you type your own. Unit: `templateTruth.test.ts` (the templates' sentence rule now covers the assets).

### Not an element, but covered

- **Validators and IPC gates throw under `NODE_ENV=production`:** `validators.test.ts` (its source scan covers `src/main/ipc`; **since [T-114] it covers every non-test file under `src/main`, with a table of audited pure invariants**), `assert.test.ts`, `audioChainValidation.test.ts`. **Every `spawn(` hides its window on Windows:** `spawnWindowsHide.test.ts` (DISPOSITION: the console window exists on win32 only; the scan is the deepest layer a linux run has). **The test flake:** `tests/unit/tempSandbox.test.ts` and 40 consecutive runs of the three racing files.

### Closed from round 62's "Found, not fixed"

"The Export batch and Clip Kit still refuse a clip stored at speed 0" (`clipForExport`); "Catalog and template cards that carry hint text say nothing about it" (all nine asset cards now say it, and the rule is a test).

### Closed from this round's own "Found, not fixed" (owner-approved)

The IPC boundary checks that were plain `assert(` (36 call sites: audio 2, image 4, project 1, recording 8, search 5, video 16; the 37 first counted included a comment) are `assertAlways`, and `validators.test.ts` fails on any soft `assert(` under `src/main/ipc`. `captions:copySrtTo` is `captions:writeKitSrt` (handler, preload bridge, API type, the kit button, the tests).

### Found, not fixed

- **A quit during a long project open saves nothing new** (the residue named above). The upgrade is a capture that fills in the not-yet-applied studios from the project being applied, so mid-wait work and the pending sources are both saved; it needs `applyProject` to report what it has applied so far.
- **UK spellings remain in five kinds of place** (round 69 recounted category (5) once more: the places that quote the old ffmpeg-era wording on purpose are seven, on ten lines, not "eight"; and the string literals and regex alternatives that spell it the old way, which no clause held, are now in the literals clause; every cite below is where it sits after round 70's edits (which re-pointed them against the tree: `convert.ts`, `recording.ts`, `recordingCancel.test.ts`, `convertCancel.test.ts`, `cancelSentinel.test.ts`, `record.spec.ts`, `audio.spec.ts`, `video-pipelines.spec.ts`, `media.spec.ts` and `videoStore.ts` all moved); round 68 recounted category (5) a third time: eighteen comments and titles, not nineteen, plus two string literals it had counted as one comment or missed (`audio.spec.ts:1905` and `media.spec.ts:4239`), and the `failurePathLanguage.test.ts` cite is the real lines now; round 67 recounted category (5) again, found one more line in it (`record.spec.ts:96`: nineteen, not eighteen) and moved every line number the round's own edits shifted; round 66 recounted this line and found its list had never covered "cancelling", "unrecognised" or "cancelled" as words; round 65 had corrected its count; round 64 swept the rest of the wave's prose and comments, including `noRawHex.test.ts`'s own; round 65 swept the wave's unquoted test strings and its own new comments; round 66 swept what a diff-based scan cannot read, the UNTRACKED new files - `cancelLatch.test.ts`'s three titles, `videoExportBatch.test.ts`'s "colour" and `transcribeCancel.test.ts`'s comment - and the seven older comments the ticket took for user-facing strings: "Cancelling" in `NameDialog.tsx`, `ClipKitButton.tsx`, `ExportPanel.tsx` (twice), `cancel.ts` and `whisperManager.ts`, "unrecognised" in `watermark.ts`; every one was a comment, none was shown to a person). After those, every line the wave added (the whole `git diff HEAD`, and every file `git status --short` lists as `??`) holds no UK spelling except categories (1) and (2) below; that was checked for centre, colour, cancel*, recognis*, honour*, behaviour, favourite, grey, analyse and the -ise family. What follows is what has been LOOKED FOR in the older work, not every UK word in it. (1) Words that are not ours to change: code identifiers (`CENTRED` in `filters.test.ts`, `aria-labelledby`, `cancelledOr` and its family, `cancelled` as a property or variable name such as `UserFacingError.cancelled`, `settleJobs`' option and the effect flags in several panels, Web Audio's `AnalyserNode`), libass's own names (`PrimaryColour`, `OutlineColour`, `HALIGN_CENTRE`), the cancel sentinel's value `imagii:cancelled` (a protocol id; `copyConventions.test.ts` exempts it by name), the CSS name `grey`, and `copyConventions.test.ts`'s British-spelling rule and its samples, which have to contain the words they forbid - the sample of bad copy, and the sample CODE in which the same file proves the scan reads strings and not identifiers or comments (`copyConventions.test.ts:519`, the comment "a cancelled flag was called tick" inside that sample: a borderline line, decided in round 67 to belong here and not to category (5), because it is text inside a fixture that the rule is shown to ignore, not a comment about the product). (2) Three wave-added test strings that a ledger or lessons entry quotes verbatim, all in `media.spec.ts`: the title "Auto Zoom zooms about the CENTRE of the frame" (a doc that quotes it quotes the test's own string), its message "a zoom about the centre leaves it at (640, 360)" and "the control's is dead centre", and the words this section and the lessons entries quote in order to report them. (3) Work older than the wave, which was never part of a sweep: 87 lines hold "centre" or "colour" (`git grep -nIiE 'centre|colour' -- . ':!package-lock.json'`, less the lines the wave added; the lockfile is excluded because its three `@img/colour` lines are a package name, and the count is the same 87 round 65 measured) - 53 in tests (`media.spec.ts` 26, `image.spec.ts` 8, `video-pipelines.spec.ts` 8, `whisperManager.test.ts` 6, and 5 more in four other files), 26 in docs (the lessons entries of earlier rounds, which are history, 12; this ledger's older rows 7; `TICKETS.md` 4; `TESTING.md` 3) and 8 in source and config comments (`canvasStore.ts:70`, `videoStore.ts:655`, `AppToaster.tsx:16`, `whisperManager.ts` 4 lines (340-341 and the libass names at 384-385), `playwright.config.ts:22`). A wave-added ledger row also quotes one older test title verbatim, "cancelling a kit asks first" (`video-pipelines.spec.ts`). (4) Other UK words in older source comments: "honour", "honoured" and "honouring" (`HighlightPanel.tsx:131`, `reframe.ts:134`, `RecordStudio.tsx:368`, `protocol.ts:130`) and "recognised" (`importDiagnostics.ts:92`, `userFacingError.ts:62`). (5) Older "cancelling", "unrecognised" and "cancelled" in tests and comments (none is shown to a person; round 66's recount): eleven lines of "cancelling" or "unrecognised" - "cancelling" in the titles `convertCancel.test.ts:194` and `:210`, `recordingCancel.test.ts:250`, `record.spec.ts:2195` and `video-pipelines.spec.ts:2687`, `:3636` and `:4846` (the last three are titles that ledger rows above quote verbatim) and in the comments `audio.spec.ts:261` and `video-pipelines.spec.ts:339`, "unrecognised" in the titles `referencesStore.test.ts:333` and `clipKitWatermark.test.ts:75`; eighteen comments and titles with "cancelled" as a word (`cancelSentinel.test.ts:683`, `convert.ts:81` and `:248`, `convertCancel.test.ts:4`, `:140`, `:145` and `:156`, `highlights.ts:241`, `audioSaveFormat.test.ts:96`, `recording.ts:222`, `recordingCancel.test.ts:179` and `:185`, `userFacingError.ts:14`, `audio.spec.ts:717`, `continuity.spec.ts:32`, `record.spec.ts:96`, `:100` and `:708`) and string literals that spell it the old way: two named in round 68 (`audio.spec.ts:1905`, the file name `'cancelled.mp3'`, and `tests/integration/media.spec.ts:4212`, the assertion message `'the recording convert was cancelled'`; round 67 counted the first as a comment and left the second out) and six that nothing counted until rounds 69 and 70, the test-local outcome value of `recordingCancel.test.ts` (`:51`, the member of `type ConvertOutcome`, and its uses at `:86`, `:181` and `:239` from round 69, and at `:71` and `:427` from round 70, whose remux outcome reuses the type), plus two regex alternatives that match the word (`audio.spec.ts:1927` and `video-pipelines.spec.ts:403`, `/...|cancelled|imagii:cancelled|.../i`); and seven places, on ten lines, that quote the old ffmpeg-era wording on purpose ("highlight scan cancelled" and its spelling: `cancel.test.ts:45-48` is one table of four lines, `userFacingError.test.ts:59`, `video-pipelines.spec.ts:390`, `cancel.ts:9`, and the comment (`failurePathLanguage.test.ts:274` and `:275`) and the filter (`:278`) of the rule that fails on it). Not counted at all: "normalises" and "recognises" in test titles (`captions.test.ts:72`, `:249` and `:267`; `cancel.test.ts:19`, `:23` and `:38`) and "honours" in `media.spec.ts:2790`, found while looking. The older ones are left as they are on purpose; the product's own copy is held by `copyConventions.test.ts`, which since round 66 also reads the strings of `src/main`, `src/shared` and `src/preload`. (The count read "about eighty in `media.spec.ts` alone" before round 65: the eighty was about right for the whole tree and wrong for the file, which has 26.)
- **Two unit tests (`cancelSentinel.test.ts` and, since round 68, `gradeMatrix.test.ts`, both through `runConcat`) still write the real `<tmp>/imagii-concat` folder** (the folder only: the fake child dies before any segment exists). Nothing removes it from a test anymore, so nothing races it; sandboxing it like the three above is the tidy-up.
- **The Layer 5 kit-captions case measures loudness with `analyzeClipHook`** (the hook badge's ebur128 pass) rather than a purpose-built probe; the numbers (-22 dB during the burst, -56 dB before) have 8 and 11 dB of room to its thresholds on this fixture.

## Dispositions — round 64 (T-114: the review gate's third pass)

Twenty-three fixes from the nine reviewers' third pass over the held wave. Every behavior change was red-first (the quotes and the mutation table, with sha256 before and after each restore, are in `LESSONS_LEARNED.md`, 2026-10-10 round 64). **IMG-PREC's Layer 5 trigger fired three times:** the even-size stage reached the MP4 convert, the caption burn-in and the picture-in-picture composite (nine real-media cases, an odd-sized VP9 webm through each, an even-sized control beside each); the two-pass loudness render met a silent input (three cases, `anullsrc`); and the overlay font changed a `drawtext` graph (a win32-gated pair, run here against a stand-in: system ffmpeg 6.1.1 and a `C:/Windows/Fonts/` folder of symlinks to six different faces, the way TESTING.md describes it).

### Video Studio - the files it writes from a source picture

- **Record - Save recording with "Convert to MP4" ([T-114], end state changed):** a screen recording of an odd size (321x241 VP9, say) converts to an even-sized h264 mp4 that plays; before, the convert died at exit 187 and `promoteTempWebm` removed the temp webm in its `finally`, so the take was LOST. DISPOSITION: the save dialog is native (NAT) and the recording is screen capture (HL); the deepest layer is `convertToMp4`, which the recording and the importer share - Layer 5 ("the MP4 convert", three cases: through `convertToMp4('recording', ...)`, through `convertForImport`, and an even-sized control) and `convertCancel.test.ts` (the `-vf` is the even stage, before the encoder).
- **Video - Importer, a non-native container ([T-114]):** the same convert, so an odd-sized flv/wmv/webm imports. Layer 5 as above.
- **Video 4s CaptionsPanel - Burn into video ([T-114], end state changed):** an odd-sized picture burns, with a subtitle stage and with none (a range with no cue in it, which is "not captioned"); the stage is joined to `subtitles=` by one comma outside the quoted style. DISPOSITION: the output is a native dialog and the engine's SRT is HL, so the deepest layers are `runBurnIn` (Layer 5, three cases: the text painted in the bottom band and the top band flat on an odd picture, the no-cue window, an even control) and `captionsProgress.test.ts` (the chain, byte for byte, and the one comma). The style's colors: see "Captions - burn-in colors" below.
- **Video 4o PipPanel - Composite ([T-114], end state changed):** an odd-sized base composites into an even-sized mp4 with the overlay's green at the asked-for place and the base's gray elsewhere. DISPOSITION: the pickers and the output folder are native (NAT); the deepest layer is `runPipComposite` (Layer 5, odd and even bases).

### Video Studio - text overlays, Clip Kit, the clip list

- **Video 4q TextOverlayEditor - Font ([T-114], the field was dead; its end state is now a picture):** the six typefaces draw as themselves (`impact.ttf`, `verdana.ttf`, `georgia.ttf`, `cour.ttf`, `comic.ttf`, `arial.ttf`); a font that is not one of them - an older project, a hand-edited one - is Arial, and the stored string is never printed. The row for "font" in the T-113 and earlier ledgers counted it covered because an E2E set the select and read it back from the store. Unit: `filters.test.ts` (each font's command text; thirteen unknown or hostile values print Arial and appear nowhere in the graph). DISPOSITION: win32 only (the linux binary has no `drawtext`): Layer 5 "every font the editor offers is a file this machine has, and each one exports and paints" and "the Font choice reaches the picture" (width of a line of i's, Courier New against Arial; an unknown, an empty and a hostile font are EXACTLY Arial's width) execute on the release run on windows-latest, and ran here against the stand-in. The real Windows file names are the standard ones and were not checkable on this box.
- **Video 4q TextOverlayEditor - the x and y boxes, the Color box ([T-114], a11y):** the two position boxes are named "x" and "y" (one `<label>` wrapped both; renamed "Overlay horizontal position (0 to 1)" and "Overlay vertical position (0 to 1)" in round 65, T-115); the Color box is `aria-describedby` its `role="alert"` sentence, so focusing it reads the reason. `#rgb` is accepted and shown as `#rrggbb`. E2E: "text overlays: add, edit every field, remove" reads both names, the accessible description while refused and none after, and `aria-invalid`. Unit: `overlayColors.test.ts` (`#fff` -> `#ffffff`, `#f00` -> `#ff0000`, `fff` without the `#` is not a code, the refusal sentence unchanged).
- **Video 4p ClipKit - the `.srt` and the thumbnails' names ([T-114], names changed):** `<clip>_captions.srt` and `<clip>_thumb_N.jpg`, like the five `<clip>_<platform>.mp4`. A clip called Aux, Con, COM1 or lpt9 used to write eight files and then fail the whole kit at the path gate. E2E: the kit's captions case reads `Mid_captions.srt`. Unit: `clipKit.test.ts` (all nine names for eight device-like clip names pass `isSafeAbsolutePath`; the bare name is the control that the gate refuses) and the wiring pin that the button builds both through the helpers.
- **Video 4f ClipList - the hook row ([T-114], gated):** a video with no sound has no "First N s:" row, no spinner and no badge. E2E: the no-sound test asserts the three absences and the control (a video with sound) asserts the row. Unit: the wiring pin.
- **Video 4e Timeline - Trim start, and the hook badge it feeds ([T-114]; the whole-second key was replaced in round 65 by a debounce on the exact start, T-115 - see below):** a drag of the start handle asks the hook analysis once per whole second of start (not once per mousemove), the previous score stays on screen while the next is worked out (no spinner flash), and the badge is per clip. E2E "dragging the start handle asks once per whole second of start, and the last badge stays up meanwhile": four moves inside the first second -> no new analysis and no spinner; one past half a second -> exactly one, with the exact start, the old badge still up while a held answer is pending, then replaced. Unit: `highlights.test.ts` (`hookWindowKey`: one change per whole second across a 3 s drag of 61 starts, the staleness ceiling, half a second as the boundary, a non-number keys as 0).
- **Video 4t SafeZoneWarningModal - the safe-zone question ([T-114]):** the dialog opens on Cancel; the list above it keeps its tab stop and is one Shift+Tab away; Tab goes Cancel -> Export anyway. E2E: the safe-zone test no longer calls `.focus()` and asserts the initial focus and the order. Unit: the pins on `data-initial-focus` and on the trap honoring it (the other dialogs, which have none, still open on their first control).
- **Video 4j ExportPanel - the Queue's bars ([T-114], a11y):** each is a `progressbar` named "<clip> · <platform>" with `aria-valuemin/max/now`; the percent beside it is still the live region. E2E: the two-clip, two-preset queue reads four bars at 100 and four live percents.
- **Video 4s CaptionsPanel - the transcript preview ([T-114], a11y):** `role="region"` beside its tab stop and name. E2E: `getByRole('region', { name: 'Transcript preview' })`.
- **Video 4n GifPanel - the always-mounted live region ([T-114], layout):** it no longer adds a phantom 12 px gap under the header while it is empty (measured: 24 px from the header to the controls, 12 now), and it stays in the accessibility tree (no `display: none`, no `visibility: hidden`). E2E: the "over about 10 s" test measures the gap on the live page and asserts the region is still there, empty, with `display: block`.
- **Captions - burn-in colors ([T-114], refusals):** `captions:burnIn` refuses a `primaryColor` / `outlineColor` that is not `#RRGGBB` in one plain sentence ("A caption color has a setting imagii can't use ..."), before the runner is touched; the runner's own `hexToAssColor` refuses again under `NODE_ENV=production`. DISPOSITION: the panel's color inputs write `#rrggbb` only, so no click reaches it; `captionsBurnIn.test.ts` (ten malformed colors and the default and every preset pass) and `captionsProgress.test.ts` (forced production, ffmpeg never started).

### Opening a project, the autosave, Audio Studio, Stream Graphics, References, Record

- **Home - Restore (autosave) ([T-114], words changed, and a launch that now works):** an autosave from the build before T-113, whose overlay color is the NAME `white`, restores (it failed validation and the banner offered Clear). A restore whose video was skipped (the person opened another while it loaded) says what is true for an autosave: it now holds what is open, so the skipped video and its clips will not come back from it - not "Open the project again". DISPOSITION: a skip needs a long conversion and a second open in its window - Unit: `ProjectIO.test.ts` (`describeApplyOutcome(outcome, 'autosave')` from a real skip, and every wording beside a missing file and a failure; Open project's words are unchanged), `projectValidation.test.ts` (a verbatim schema-5 JSON restores; injection strings still refuse), `autosave.test.ts` (the real `readAutosave` on a legacy file) and the wiring pin on both call sites.
- **Audio - Levels, "Even volume" ([T-114], a11y and words):** the range is beside the checkbox's label, not inside it ("(−70 to −5)", the true minus), so the checkbox's name is "Even volume (target -16 LUFS)". E2E: the Levels test reads the new text, its absence from the label and from the accessible name.
- **Audio - Export with "Even volume", a silent source ([T-114], end state changed):** a silent track exports (single-pass loudness) instead of failing in ffmpeg. DISPOSITION: the save dialog is native (NAT); the deepest layers are Layer 5 "a silent input through the two-pass loudness render" (the fixture is checked to print `-inf` first; the export is 4 s of silence) and `silentLoudnorm.test.ts` (pass 2's `-af`).
- **Stream Graphics - the Layers panel ([T-114], keyboard and a11y):** a layer's name is a button: Enter and Space select it, Tab reaches it (a click anywhere on the row still selects, as before); the row and the button carry `aria-current`; the eye is `aria-pressed` with the name "Layer visible" and a title that says what pressing does ("Hide layer" / "Show layer", replacing the constant "Show/hide"). E2E: "every per-row control reaches its end state" selects Ellipse by Enter and Text by Space, tabs from the lock button to the name, and reads the eye's `aria-pressed` and description through hide and show; the other eye clicks use the new name.
- **References - Boards ([T-114], keyboard and a11y):** the board's row is a button (Enter and Space select it, Tab reaches it), the row and the button carry `aria-current`, and the name is "<board>, N items". E2E: the mood-board test selects Beta by Enter and Alpha by Space, reads `aria-current` moving, and the accessible name.
- **Record - the source cards ([T-114], a11y):** `aria-pressed` on the selected card. E2E: the stale-selection test reads it before and after picking the other card.
- **References 5c - the Asset Library's Square clip card ([T-114], words changed; "never" became "do not" in round 65, T-115):** "The well and its label never export. The sample title does not export until you type your own." (the well and its label are guides; only the title is retyped). Unit: `templateTruth.test.ts` (the sentence rule, the card's own wording, and the three layers still hints).

### Not an element, but covered

- **The even-size stage is one constant** (`EVEN_PICTURE`, `filters.ts`) at the head of the `-vf` of the audio re-attach, the MP4 convert, the burn-in and the PiP base. `filters.test.ts` pins the literal once; the four commands are pinned or run (see above).
- **The audited soft asserts:** `validators.test.ts`'s `AUDITED_PURE_INVARIANTS` (seventeen asserts in six files, each read against its caller, keyed by file and message, with a stale-entry check). A new soft assert anywhere in `src/main` fails until it is converted or audited into the table.
- **Accessibility rule 1 sees four ways to mark a selection** (the fill, a border, a ring, a wash) on a `button` or anything with an `onClick`: `a11ySweep.test.ts` (it flagged exactly the three unfixed sites, then none; the discrimination block covers each style, the state attributes, a drop zone and a hover variant). The renderer has no other clickable non-control (a scan found the Modal's scrim and the tutorial's SVG scrim, both with Escape).

### Closed from round 63's "Found, not fixed"

"UK spellings remain in test TITLES and quoted assertion messages" - the sweep covered the rest of the wave's prose and comments (the bullet above states what remains and why).

### Found, not fixed

- **Any failed MP4 convert still deletes the take, not only an odd-sized one.** `promoteTempWebm` removes the temp webm in its `finally` whatever the convert's failure, and the message ("Nothing was saved - try again, or untick Convert to MP4 ... to keep the WebM") sends the person to a recording that is gone. T-114 removed the one cause that was certain (an odd picture); the structural fix is to keep the temp file when the convert fails and offer the WebM save, which changes the post-Stop card's states and is a product call.
- **A Windows install without one of the six fonts** (an N edition stripped of Comic Sans, a locked-down image) fails the export at `drawtext` ("Cannot open font file") for an overlay set to it. The release run checks the runner's fonts, not the person's. The upgrade is a font preflight at export that falls back to Arial and says so.
- **The caption style's size and position are not validated at the gate** (only the colors are). They cannot reach the command as text - a size is rounded to a number and an unknown position is `undefined` in an integer slot - so this is hardening, not a hole.
- **`project:save` now migrates a legacy named color as it validates**, so the file it writes carries the hex. That is the right outcome and it is a side effect of `validateProject` mutating its input, as its three schema migrations already do; it is recorded here so nobody is surprised.
- **The hook badge describes a start up to half a second away while its key holds** (the staleness ceiling in `hookWindowKey`). A tier flipping on half a second of shift has not been seen; the upgrade is a debounce on the exact numbers.

## Dispositions — round 65 (T-115: the review gate's fourth pass)

Ten code items and six docs items from the nine reviewers' fourth pass (audio, privacy, ffmpeg and electron came back clean; items (1)-(9) and (16), Save .srt's `catch`, are code; (10)-(15) are docs; this line said nine because it stopped at (9)). Every behavior change was red-first (the quotes, the mutation table and the sha256 before and after are in the hand-back); a new test that guards something was broken once and watched to fail. The numbers: `npm run verify` 3344 tests in 128 files (3301 + 43, no new file); `test:media` and Playwright are counted in `TESTING.md`.

### Record - the convert bar, and the two toasts that must last

- **Record - the saving card's convert bar ([T-115], end state changed):** the bar draws the encode position over the take's own length (capped at 99), not `seconds x 2`; a convert that was handed no length reports progress with no percent and the bar slides (`role="progressbar"` with no `aria-valuenow`, the `.progress-indeterminate` segment, as the captions panel does). `promoteTempWebm` passes `spec.durationMs / 1000` (nothing for 0 or absent); `convertForImport` passes nothing. E2E: "the convert bar draws what main reports" holds `recording:finalize` open and drives the real progress channel - 0 before anything, 40 as 40 (width 40%), `{}` as the sliding bar with no number, 99 as a number again - and lets the save end into the calm "Recording discarded" (red on the old build: `aria-valuenow="NaN"`). Unit: `convertCancel.test.ts` (ffmpeg's `-progress` text through a fake child: the mapping, the 99 cap, hours and minutes, five lengths that are not a length report no percent, `out_time=N/A` reports nothing), `recordingCancel.test.ts` (the length handed down; progress forwarded as it came), `captions.test.ts` (`burnInPercent` refuses a non-finite length), `interactionWiring.test.ts` (`?? null`, the null branch draws the sliding bar), `a11ySweep.test.ts` (the bar's attributes). Layer 5 "the convert reports a measured progress, or none": the real binary on a 6 s webm. The existing E2E "record -> Esc -> save as MP4" still reads a numeric `aria-valuenow` during the real convert.
- **Record - the "Save failed" toast and Autosave - the banner's Clear failure ([T-115], duration changed):** both last `ERROR_TOAST_MS` (8 s) like every other failure; the take-is-gone message in particular was gone in 4 s. DISPOSITION: the toast's lifetime is a timer inside react-hot-toast and no E2E waits it out; the deepest layer is the AST pin in `interactionWiring.test.ts` (three toasts named, a finder that discriminates, red on the two that were bare). The wording of both toasts is unchanged and still asserted where it was.

### References, Stream Graphics, Video Studio

- **References - Save (a search result's tile) and "→ Canvas" (a mood-board tile) ([T-115], keyboard):** the overlay that holds them is drawn at `opacity-0` until hovered and now also `focus-within:opacity-100` (replaced in round 66 by `has-[:focus-visible]:opacity-100`, because a click matched it too; see the round-66 row); Tab reaches the button and it is visible. E2E: the first-save test parks the mouse, reads the overlay's opacity (0 at rest, 1 on focus, 0 after blur) and opens the name dialog from the keyboard (focus, Enter); the Canvas test does the same for "→ Canvas" and Enter carries it to the canvas with the 40% layer, as before. Unit: `a11ySweep.test.ts` rule 4 (a hover-only container that holds a button, link or field must show on focus; flagged exactly these two sites before the fix, with a discrimination block). Red on the old build: `Expected: "1" / Received: "0"`.
- **Stream Graphics - the Export card's format select ([T-115], a11y):** named "Export format". E2E: the PNG/JPG, emote-pack and background tests find it by that name (they found it as "the first combobox"), and the first asserts its two options. `a11ySweep.test.ts` names it.
- **Video 4q TextOverlayEditor - the x and y boxes ([T-115], a11y and words):** "Overlay horizontal position (0 to 1)" and "Overlay vertical position (0 to 1)" (they were "x" and "y"); the visible "x / y" label is unchanged. E2E: the text-overlay test reads both accessible names and finds the spinbuttons by them (red: `Received: "x"`).
- **Video 4c ClipList - the hook badge, with Trim start and the speed slider ([T-115], end state changed):** the badge asks once the start and the window have been still for 250 ms, for the EXACT numbers, not once per whole second (a badge's first ask - a clip selected, the studio re-entered - is immediate). E2E (both cases re-pinned, intent kept - bounded asks during a drag, the exact final state, no spinner flicker): "the hook badge asks once the speed slider stops moving, for the exact window" (three ticks in a row are one ask, for 3.45 s; the next settled value one more, 3.6 s; the old badge stays up with no spinner) and "dragging the start handle asks once, after it settles, with the exact start" (four moves are one ask whose `startSec` matches where the handle stopped to within 0.06 s, the previous score stays up while a held answer is pending, then the new one replaces it, and nothing else was asked); red on the old build (`Expected: 3 / Received: 2`). The other two hook cases ("listens to the first 3 seconds the viewer SEES", "a clip too short to have a hook") pass unchanged. Three cases that read the spawn log or a badge title were re-pointed to wait for the badge to settle first (T-98 "a Cancel pressed before the job's ffmpeg exists", T-111/T-112 "pressing Export again after leaving Video Studio", T-92 "the hook badge says what it measures"): the badge runs a real ffmpeg of its own, and the cases had assumed it was already done. Unit: `highlights.test.ts` (`hookAsk`: exact pass-through, every unusable start and window refused, the gate's bounds inclusive; `HOOK_DEBOUNCE_MS`), `interactionWiring.test.ts` (deps, the ask inside the timer, the cleanup, the previous score kept).
- **Video - everything that encodes a source picture: the Convert to MP4 save, the importer's non-native containers, the audio re-attach, the caption burn-in, the picture-in-picture base ([T-115], end state changed):** the even-size stage is a crop, so an odd window capture loses one pixel at the right and bottom edge instead of being resampled. Layer 5: "a 1-pixel checkerboard stays hard-edged" (a lossless 321x241 fixture and a 320x240 control through `convertToMp4`: no pixel of three sampled rows in the mid-gray band strictly between 80 and 175, every neighbor the other one; red on the old stage with 70 such pixels in row 7); the nine odd-size cases and the control stay green. Unit: `filters.test.ts` (the literal, and "a crop, never a scale"), `muxCodec.test.ts` (the re-attach's chain). The burn-in and the PiP base are covered by the unchanged odd-size cases and by the constant they share; a checkerboard through them would add no independent coverage of the stage.
- **References 5c - the Asset Library's Square clip card ([T-115], words changed):** "The well and its label do not export." (it said "never": retyping a hint exports it). Unit: `templateTruth.test.ts` (the sentence, no "never", the three layers still hints).

### Opening a project, the autosave

- **Home - Open project; the autosave Restore banner ([T-115], end state changed):** a project or autosave written by a build whose overlay editor had no upper clamp (a size of 800, or 3) restores, at 512 or 8, instead of failing validation. Unit: `projectValidation.test.ts` (a verbatim legacy JSON with `"sizePx": 800` restores at 512 with every other field as written; 1, 7.9, -3, 513 and 1e6 clamp to the nearest bound; a name and a size together both migrate; a string, a filter-graph payload, `1e999`, `null` and an object are still refused; the injection pins unchanged; `isValidTextOverlay` still refuses an out-of-range size), `autosave.test.ts` (the real `readAutosave` on a legacy file with two such overlays). `migrateNamedOverlayColors` is now `migrateLegacyOverlays` (it migrates colors and sizes).

### Video Studio - captions

- **Video 4s CaptionsPanel - Save .srt, a failure ([T-115], failure path added):** "Save .srt" had no `catch`: `captions:saveSrt` THROWS for a transcript outside `<userData>/captions` (a project file may name any safe absolute path as its `srtPath`) and the copy itself can fail (a full disk, a read-only destination), and the rejection was unhandled - no dialog, no toast, nothing. It is now the panel's one plain sentence through `reportFailure`: "Couldn't save the captions file." (a known cause - a full disk, a blocked file - is added after it by `userFacingError`; the refusal's own words, which name a channel, never reach the screen). The handler was NOT changed in round 65 (it still throws where `captions:writeKitSrt` answers `ok: false`; see below); round 66 gave its two throws a finished sentence each, so the toast above is now the fallback for a copy that fails after the dialog (a full disk, a read-only destination) and nothing more. E2E: "Save .srt on a transcript outside the captions folder says why, instead of doing nothing (T-115, T-116)" (named "...the app did not write says it could not..." in round 65, when it read the bare fallback; round 66 re-pinned it to the sentence main throws and added its sibling, "Save .srt on a transcript that is gone says so, without asking where to save it (T-116)", from the same table) seeds a transcript OUTSIDE the captions folder (the sibling: inside it, with no file), opens it through a project file, presses Save .srt, and reads exactly one toast, the sentence, with the Save dialog asked zero times, no file at the chosen path, no unhandled rejection (`pageerror`) and the button still enabled; the round-65 version was red on the unfixed build with the toast log empty (`Received: []`). The success path is the existing "with an SRT restored from a project file" case (a real copy, "SRT saved"). Unit: `failurePathLanguage.test.ts` pins the await inside a `try` whose `catch` calls `reportFailure` with that sentence, with a finder that discriminates (no try, a try that swallows, the real shape), and the table of sites now counts five in `CaptionsPanel`.

### Not an element, but covered

- **The even-size stage is a crop, still one constant** (`EVEN_PICTURE`, `filters.ts`): the entry above replaces the round-64 sentence's "scale".
- **Accessibility rule 4** (`a11ySweep.test.ts`): a hover-only container (`opacity-0 group-hover:opacity-100`) that holds a button, link or field shows on focus too; a discrimination block (flags a button, a link and a nested field; accepted `focus-within` and `group-focus-within` until round 66, which accepts `has-[:focus-visible]` and `group-has-[:focus-visible]` and fails on `focus-within`; ignores text-only overlays, plain `opacity-0` and `hover:opacity-100`; a `focus-within:ring-2` is not the reveal).
- **Docs:** STYLE_GUIDE (the confined-read exception for `captions:writeKitSrt`, the convert's measured percent, the crop, the migration's two halves, the debounce), DESIGN_GUIDE (state-named toggles and action-named ones, hover-only reveals), the two "crossfade" rows (this file, "CompilationPanel (5)" and the T-105 fade row), the T-113 kit row's `Mid.srt` (renamed `Mid_captions.srt` in round 64), the spelling disclosure above.

### Closed from round 64's "Found, not fixed"

"The MP4 convert's percent remains an estimate" (round 61's closing note, and the STYLE_GUIDE progress bullet that pointed here for it): closed by the measured percent above. "The hook badge describes a start up to half a second away while its key holds": closed by the debounce on the exact numbers (the key, `hookWindowKey` and its ceiling are gone). "`project:save` now migrates a legacy named color as it validates": still true, and it now clamps a legacy size the same way (the file it writes carries the clamped number); the side effect is the same one, recorded here so nobody is surprised.

### Found, not fixed

- **`captions:saveSrt` throws on the read-confinement outcome that `captions:writeKitSrt` answers as data.** Both confine the source SRT to the captions directory; one throws `captions:saveSrt source path outside captions directory`, the other returns `{ ok: false, reason }`. STYLE_GUIDE says why `writeKitSrt` is on the data side (Clip Kit toasts one plain line and the rest of the kit stands). The panel half is fixed in this round (its rejection is now a plain sentence, above), and round 66 made the two throws finished sentences (below); whether the two handlers should be one rule is a bigger call and was left.
- **The renderer awaits about 47 `window.api.*` calls with no `try`** (a syntax-tree scan, round 65): nearly all native pickers (`pickOutputDir`, `pickFile`), settings writes and `cancel*` calls that do not reject in practice, but `failurePathLanguage.test.ts` reads `catch` clauses and cannot see a missing one, so a new one would not be flagged. `CaptionsPanel.saveSrt` was the one that could and did reject, and it is pinned by name; the scan with an allow-list for the rest is the upgrade, to be written when a second site turns up (its header comment says so).

## Dispositions — round 66 (T-116: the review gate's fifth pass)

Three code items and the comments and docs around them, from the nine reviewers' fifth pass (privacy, audio, streamer and accessibility came back clean; every other finding was LOW, the wave's first pass with no MED). Every behavior change was red-first (the quotes, the mutation table and the sha256 before and after each restore are in the hand-back); each new guard was broken once and watched to fail. **IMG-PREC's Layer 5 trigger did not fire:** no ffmpeg command, filter graph or audio chain changed (the Layer 5 file gained one corrected comment). The numbers: `npm run verify` 3356 tests in 129 files (3344 + 12, one new file); `test:media` unchanged (192 cases, 181 run, 11 platform-skipped); Playwright 227 (one new case; the affected specs were run, the full suite is the gate's). All counted in `TESTING.md`.

### References - the tile overlays

- **References - Save (a search result's tile) and "→ Canvas" (a mood-board tile) ([T-116], keyboard only, end state changed):** the overlay that holds them is `opacity-0` until hovered and now shows on `has-[:focus-visible]:opacity-100` instead of `focus-within:opacity-100`: Tab reveals it, a mouse click does not keep it lit after the pointer leaves (the click focuses the button, and `focus-within` matched that). E2E, first-save test: the mouse is parked, one Tab from the Search button lands on Save (asserted focused), the overlay is 0 at rest, 1 on Tab and 0 after Shift+Tab; the dialog is opened with Tab then Enter (it called `focus()` before); then, with a board selected, a real click on Save is read at 1 under the pointer and, once the mouse leaves, at 0 with Save still the focused element. E2E, Canvas test: "→ Canvas" is pressed and the pointer dragged off before the button is released (a click would navigate away and end the test), read at 0 with the button focused and the studio unchanged; then Tab from Delete lands on it (1), and Enter carries it to the canvas with the 40% layer, as before. Unit: `a11ySweep.test.ts` rule 4 accepts `has-[:focus-visible]` and `group-has-[:focus-visible]` and flags `focus-within`, `group-focus-within`, a `focus-within:ring-2` and a `has-[:focus-visible]:ring-2`. Red on the `focus-within` build: `a clicked Save lets go when the pointer leaves` and `a pressed "→ Canvas" lets go when the pointer leaves`, each `Expected: "0" / Received: "1"`, the Tab steps before them green on both builds. **Residue, stated:** after the first-save dialog closes by mouse, focus is restored to Save and `:focus-visible` still matches it, so that one tile stays lit until focus moves (probed: focused, focus-visible, opacity 1); see Found, not fixed.

### Video Studio - captions

- **Video 4s CaptionsPanel - Save .srt, a transcript outside the folder or gone ([T-116], words changed, dialog order changed):** "That transcript isn't in imagii's captions folder on this computer — transcribe the video again." and "That transcript isn't on this computer anymore — transcribe the video again." (it said "any more" until round 67) are thrown by `captions:saveSrt` and shown as written (`userFacingError` tier 2: finished, no channel name, nothing a tier-1 pattern rewrites). The missing file is found BEFORE the Save dialog opens (`existsSync`, as `writeKitSrt` does), after the folder gate, so a path outside the folder never says whether a file is there. Console: the path. E2E (two cases from one table): "Save .srt on a transcript outside the captions folder says why" (re-pinned from the bare fallback) and "Save .srt on a transcript that is gone says so, without asking where to save it" (new: a project whose `srtPath` is inside `<userData>/captions` with no file); each reads exactly one toast, the sentence, counts the Save dialog's asks (zero), finds no file at the stubbed path, no `pageerror`, and the button enabled. Unit: `captionsSaveSrt.test.ts` (the real handler on real files, eight cases: both refusals before the dialog, the folder gate first, each sentence through `userFacingError` with the Electron envelope, the copy, the canceled dialog). Red on the old build: E2E `Received: ["Couldn't save the captions file."]` (outside) and `["Couldn't save the captions file. A file imagii needs isn't there. It may have been moved or deleted."]` (gone); unit 5 of 8. The success path is unchanged and still the "with an SRT restored from a project file" case. `failurePathLanguage.test.ts` is unchanged: it pins the fallback, which is what remains for a copy that fails after the dialog.

### Record

- **Record - Save recording, the convert's failure toast ([T-116], words changed):** "... try again, or uncheck "Convert to MP4 after recording" to keep the WebM." (it said "untick"; a box is checked, never ticked). The label is quoted exactly. E2E: "a convert that really crashes says so in plain words" reads `uncheck "Convert to MP4 after recording"` and no "tick"; red with the old word: `Received string: "... or untick \"Convert ..."`. Unit: `recordingCancel.test.ts` (the exact tail, and `not.toMatch(/tick/i)`).

### Not an element, but covered

- **The copy scan reads main now** (`copyConventions.test.ts`): the tick rule is `(un)?tick(ed|ing|s)?` (`\btick` cannot match inside "untick"), and the two word rules (US spelling, tick) also read every string literal under `src/main`, `src/shared` and `src/preload` (77 files), with `imagii:` protocol ids exempt by name, a discrimination block (the shipped sentence fires; a protocol id and the good sentence do not) and a guard against an empty scan. When first run it found exactly two strings: this one and the sentinel's value.
- **Accessibility rule 4** accepts the keyboard-focus spelling only (the row above).
- **Comments that were wrong:** `process.ts`, `muxCodec.test.ts` (twice) and `filters.ts` described the even-size stage as a scale, or a `pad` that does not exist; `projectValidation.ts`, its test and STYLE_GUIDE said Save project refuses an out-of-range overlay size (it clamps; Export and Compile run the strict gate). Seven older comments say "Canceling" and "unrecognized" now; five UK words in untracked new test files are US (the disclosure above).
- **Docs:** DESIGN_GUIDE and the lessons entries quote the button's real label, "→ Canvas"; STYLE_GUIDE records `captions:saveSrt` as the handler that still throws (with finished sentences) beside `writeKitSrt`'s `ok: false`; BRANDING_GUIDE says the word rules reach main; round 65's counts above (3344, +43, ten code items); `TESTING.md`'s media total (192 cases) and its checkerboard claim, now per row (7, 100 and 233 had 70, 320 and 67 soft pixels under the scale, reproduced this round; 0 under the crop), and the same comment in `media.spec.ts`.

### Closed from round 65's "Found, not fixed"

"`captions:saveSrt` throws on the read-confinement outcome that `captions:writeKitSrt` answers as data": half. The two throws are finished sentences and the existence check precedes the dialog; the handler still throws, which STYLE_GUIDE now records as the exception. "The renderer awaits about 47 `window.api.*` calls with no `try`": still true, T-110(x).

### Found, not fixed

- **A dialog that restores focus after a mouse flow leaves `:focus-visible` on the trigger.** After the first-save dialog closes, `useFocusTrap` restores focus to Save and the browser matches `:focus-visible` (the field the dialog had focused was the active element), so that tile's overlay stays lit until focus moves. Measured, not guessed: focused true, `:focus-visible` true, opacity 1, pointer parked away. `focus({ focusVisible: false })` is a Firefox option as far as I know and a probe in this Electron (Chrome 126) still matched. The upgrade is to restore focus only when the dialog was opened from the keyboard, a change to every dialog; the visible cost is one lit tile after the first save a person ever makes.
- **`captions:saveSrt` still throws where `captions:writeKitSrt` answers `ok: false`.** Now with sentences; the shape is the bigger call (round 65's note stands).
- **"tick" idioms remain in 30 older comments, test titles and fixtures**, none shown to a person (the scan reads strings, not comments). Round 70 re-pointed it against the tree again (ten of its cites no longer landed, and its own edits moved more; the count of 30 is right). Round 67 made the list exact against the tree (it had named nine sites and "a handful" in `record.spec.ts`; its `RecordStudio.tsx:689` was already stale, and the sites it left out are below). In source: `RecordStudio.tsx:358`, `:368`, `:399` and `:783`, `ExportPanel.tsx:391`, `filters.ts:517`, `videoStore.ts:655`, and the wave's own `CropOverlay.tsx:125` (the list called it older: it is not). In tests: `presets.test.ts:88`, `videoStore.test.ts:835` ("YouTube unticked"), the wave's own `clip.test.ts:123` ("ticked for"), `tutorialCopy.test.ts:171` (a fixture sentence, "Tick 'Crop' then '+ Clip'."), `audio.spec.ts:663` and `:1121`, `video-pipelines.spec.ts:1730` ("a success tick", the check-mark sense), `:2515`, `:5470` ("one tick box"), `:5498` and the wave's own `:6171`, and `record.spec.ts:73`, `:80`, `:88`, `:600`, `:608`, `:618`, `:699`, `:726`, `:990`, `:1000` and `:2199`. Not counted: a timer's or slider's tick (`tick()` helpers, "per tick", "poll ticks"), the sentences that STATE the rule (`recordingCancel.test.ts:276` and `:278`, `record.spec.ts:2398` and `:2400`) and `copyConventions.test.ts`'s rule and fixtures. STYLE_GUIDE's "ticked for" (wave-added prose, in the bullet "A clip's recipe is built in ONE place") is not on this list because it is fixed: the guides are the spec, and it says "checked for" now.
- **A mood-board tile's click-away cannot be driven by a plain click.** "→ Canvas" navigates to Stream Graphics and leaves the tile behind, so its E2E presses the button and drags off it before releasing; the plain-click assertion lives on the Save tile.

## Dispositions — round 67 (T-117: the review gate's sixth pass)

Five code items and the docs around them, from the nine reviewers' sixth pass (privacy, accessibility and electron came back clean; every finding was LOW, the second pass in a row with no MED). Every behavior change was red-first (the quotes, the mutation table and the sha256 before and after each restore are in the hand-back); each new guard was broken once and watched to fail. **IMG-PREC's Layer 5 trigger did not fire:** no ffmpeg command, filter graph or audio chain changed (the Layer 5 file gained one corrected comment, and `filters.ts` one). The numbers: `npm run verify` 3489 tests in 132 files (three new files); `test:media` unchanged (192 cases, 181 run, 11 platform-skipped); Playwright 230 (three new cases in `record.spec.ts`, one existing kit case re-run on a skewed clock). All counted in `TESTING.md`.

### Audio Studio - Cleanup presets

- **Audio - Cleanup - presets, Delete preset (the trash button on a saved preset) ([T-117], validation added):** the id the button hands back is held to the alphabet nanoid mints (`[A-Za-z0-9_-]`) at the handler, at the store and at the parse of a preset file, so `audio:deletePreset('../config')` no longer reaches `unlink`. The button's own end state is unchanged and still driven end to end by the existing audio.spec.ts cases "cleanup presets save, apply, and delete through both confirm branches" (a real delete of an id `savePreset` minted, which is in the alphabet) and "a preset that cannot be saved or deleted says so in plain words (T-90)". DISPOSITION: a traversal id cannot be sent by clicking (the list is built from the files main wrote and the renderer returns the id it was given), so the deepest layer that can reach it is the IPC handler and the store on real files: `audioPresetIds.test.ts` (the real handler, the store wrapped in a spy so only the handler's refusal can pass it: `../config`, a nested climb, a slash, a backslash, a space, `x.json`, `..`, a trailing newline, and the empty, numeric, undefined and null ids; the minted id still deletes) and `presets.test.ts` (a temp userData with a real file at each id's target: it is still there afterwards and the call refused with "nanoid alphabet"; a planted preset file whose id is `../config` is not listed). Red on the old build: the target file was gone (`ENOENT ... open '<userData>/config.json'`).

### Video Studio - captions and the Clip Kit

- **Video 4s CaptionsPanel - Save .srt, a transcript whose own name starts with two dots ([T-117], end state changed):** a transcript called `..intro.srt` or `...and then-123.srt` in `<userData>/captions` (transcripts are named from the video; `..intro.mp4` is legal) is saved, where the folder gate used to answer "outside" for the app's own file and round 66's sentence told the person to transcribe again, which wrote the same name and was refused again. A real traversal still refuses with the same sentence. Unit: `captionsSaveSrt.test.ts` (the real handler on real files: four dot-named transcripts and one inside a folder called `..old stream` are copied to where the dialog said; a dot-named transcript that is gone says "gone", not "outside"; the folder's parent, a file one level up, a sibling whose name starts with the folder's, a climb that comes back down into a dot-named file and a climb written with the separator each still refuse with the dialog never asked), `pathConfine.test.ts` (the rule, posix and win32). Red on the old rule: all five save cases threw the "isn't in imagii's captions folder" sentence. E2E: unchanged. The two Save .srt refusals ("outside the folder", "gone") are driven end to end as before; the dot-named name adds nothing at that layer that the unit does not (the E2E would seed a file the same way the unit does). DISPOSITION: the OS Save dialog is stubbed in both layers, as it was.
- **Video 4s ClipKit - the kit's captions file, a transcript whose name starts with two dots ([T-117], end state changed):** the same gate on `captions:writeKitSrt` answered `ok: false` for the same file, so the kit silently left its captions out. Unit: `captionsWriteKitSrt.test.ts` (three dot-named transcripts and the `..old stream` folder make the kit's captions on the clip's clock; the gone one is "not found", not "outside"; the same five real traversals answer `ok: false, reason: 'source SRT is outside the captions directory'` with nothing written). Red on the old rule: `ok: false` for each in-folder fixture. The Clip Kit E2E that builds the whole kit and its captions is unchanged.
- **Video 4s ClipKit - the kit folder's date ([T-117], end state changed):** `<name>-kit-<YYYYMMDD>` is the day on the person's clock, as the export panel's `{date}` already was, and not the UTC day: a kit made at 9:23 pm in Pacific time is dated that day and not the next. Unit: `outputPath.test.ts` (`makeKitDir` with the clock at 04:23 UTC on the 11th: `-kit-20261010` under `America/Los_Angeles`, `-kit-20261011` under `Pacific/Auckland` for 20:30 UTC on the 10th), `filename.test.ts` (the helpers, both directions, three zones, and a scan that fails on any non-test `toISOString()` under `src`). E2E: "one click produces the whole kit" now runs on a clock whose day is never the UTC day (`skewedClock.ts`) and reads the folder by the local day; the helper `kitStamp()` in `video-pipelines.spec.ts` (and so every other kit case) reads the local day too. Red on the UTC stamp: the case waited out its 540 s for a folder that did not exist (the app had made the UTC one). A mood-board tile's cached thumbnail is gated by the same segment rule (`moodboard.test.ts`: a `..cover.jpg` in the cache is kept, one outside it is unset); no element changed.
- **Video 4s CaptionsPanel - Save .srt, "gone" sentence ([T-117], words changed):** "That transcript isn't on this computer anymore — transcribe the video again." ("any more" before). Unit: `captionsSaveSrt.test.ts` (the exact sentence, before the dialog opens, and through `userFacingError`). E2E: "Save .srt on a transcript that is gone says so, without asking where to save it (T-116)" re-pinned.

### Record

- **Record - Stop, then the Save dialog's suggested name ([T-117], end state changed):** the name is `recording-YYYY-MM-DDTHH-MM-SS.webm` (or `.mp4`) on the person's clock; it was the UTC ISO string with a trailing `Z` and milliseconds, a day ahead on a Pacific evening. E2E: "the take's suggested name is stamped from the person's clock, not UTC (T-117)" runs a real take on a clock whose day is never UTC's and reads the `defaultPath` the Save dialog was opened with (the dialog is stubbed in main, as in every Record case): the date is the local day, not the UTC day, and the name has no colon and no `Z`. Red on the old name (`recording-2026-10-10T21-38-03-368Z.webm` fails the pattern) and, with the format right and the day wrong, on a `localDate()` that read UTC (`Expected value: "2026-10-10"`, `Received array: ["2026-10-11", "2026-10-11"]`). Unit: `filename.test.ts`.
- **Record - Save recording, a failure ([T-117], words changed):** "Saving the recording failed." plus the plain cause where the shape is known, for 8 s, from `reportFailure`; it was `ipcErrorMessage(err, 'Save failed')`, which showed main's string as written (a copyfile EPERM with both full paths, an ENOSPC from the write stream). The convert crash's own sentence still stands as written. E2E: "a save that fails for a reason Windows gives says so in a sentence, with no path and no channel (T-117)" replaces `recording:finalize` IN MAIN with a handler that throws the exact EPERM and then ENOSPC strings Node raises, over two real takes, and reads two red toasts: "Saving the recording failed. Windows blocked access to a file. Close any app using it, or check your antivirus." and "Saving the recording failed. Your disk is full. Free up some space and try again.", with no path, errno, channel or "Save failed" in any toast, nothing stranded in `userData/recordings`, and the studio back to idle. Red on the old catch: the toast log was `EPERM: operation not permitted, copyfile 'C:\Users\maken\AppData\...' -> 'D:\Videos\Stream take.webm'`. Unit: `userFacingError.test.ts` (the two shapes, the stand-alone sentences, the old channel string falling to the caller's sentence), `reportFailure.test.ts` (the 8 s and the neutral cancel), `interactionWiring.test.ts` (the call, and the discard decided before the failure). The old pin that named the 8 s on this toast (`MUST_LAST`) moved to `reportFailure.test.ts`: the duration is one line in the helper now, for every caller.
- **Record - Stop with nothing recorded ([T-117], words changed):** main refuses a take with no data in a finished sentence, "Nothing was recorded, so there is nothing to save. Start the recording again.", which the toast shows as written; it was `recording:finalize recording is empty`. E2E: "an empty take is refused in a sentence of its own, through the real IPC (T-117)" begins a real session with no chunk, calls the real `recording:finalize` and reads the sentence arrive in Electron's envelope, with the temp file reaped. Unit: `recordingStream.test.ts` (the sentence, the envelope, `userFacingError` showing it as written). DISPOSITION: the toast for this exact refusal is not driven by pressing Stop (a real take always delivers a first chunk), so the mapping is held at the unit layer on the real handler's message and the toast path is the EPERM / ENOSPC case above.

- **Record - Refresh sources / the first scan, when the list is refused ([T-117], words changed):** "Couldn't list what can be recorded." for 8 s, plus the plain cause where the shape is known ("Windows blocked access to a file. Close any app using it, or check your antivirus."); it toasted main's string as written, envelope stripped (`Screen recording permission denied`, or an errno with a path). The in-flight state still ends, the empty-state warning and the retry stay, and the selection is still dropped. E2E: "zero capture sources says so..." (T-41) and "T-69: a refresh reconciles the selection..." re-pinned (the sentence, and no `permission denied`, channel or envelope text), and the first one stubs a second refusal, an `EPERM` with a path, and reads the known-cause sentence with no `EPERM`, path or file name. Red on the old toast: `Received string: "Screen recording permission denied"`. Unit: `interactionWiring.test.ts` (the call, and no `ipcErrorMessage` in the file), `failurePathLanguage.test.ts` (the site count, and the class pin below).
- **Home - the Autosave banner's Clear, when the delete fails ([T-117], words changed; [T-118], the cause made reachable):** "Couldn't clear the autosave. It's still on disk." for 8 s, plus the plain cause where known. The only cause that can be named is a locked file ("Windows blocked access to a file. Close any app using it, or check your antivirus."): unlink has no full-disk shape, and any other failure is the bare sentence. Before T-117 the toast spliced main's string into the sentence ("Couldn't clear the autosave: could not delete autosave.json. It's still on disk — close anything using it and try again."). Round 67 promised the cause and main could not deliver it: `clearAutosave` swallowed every unlink errno and threw the shapeless "could not delete autosave.json", so the person always got the bare sentence and the advice to close what was using the file, true for exactly the locked case, was gone. T-118: the thrown message ends in the errno code of the first unlink that failed on a file that stayed ("could not delete autosave.json (EBUSY)"), with no trailing period, so a shape the helper does not know still falls to the bare sentence; a code on a file that vanished (a second window cleared it) is not reported. The banner and its Clear button stay, nothing is dismissed, the file stays on disk. E2E: "AutosaveRestore: a clear that fails says so and leaves the banner and the file alone" is pinned to the sentence with `could not delete autosave.json` absent; its first stub is the shape main raises when the failed unlink carried no errno code (the bare sentence, and the case asserts that no cause is guessed), its second is main's real locked-file shape, `could not delete autosave.json (EBUSY)`, and reads "...It's still on disk. Windows blocked access to a file. Close any app using it, or check your antivirus." with no errno, path or file name (before T-118 that stub was a raw `EBUSY: resource busy or locked, unlink 'C:\Users\...'` string, which main never raised); the success discrimination at the end is unchanged. The stubs are in MAIN, so this E2E cannot go red from `clearAutosave`; it holds the renderer's two branches (mutated: the second stub's code changed to `EISDIR` fails on the cause sentence, and the first stub given `(EBUSY)` fails the no-cause pin), and `autosave.test.ts` holds main's side. Unit: `autosave.test.ts` (the real function with an `unlink` stand-in: EBUSY and EPERM through `userFacingError` to the cause sentence, the bare shape and an unmapped code to the bare sentence, the first failure's code wins, a vanished file's ENOENT is not reported; red-first, 7 of the 8 new or changed cases failed on the old function, and the bare-shape case is the control that passed on both), `userFacingError.test.ts` (the shapes, wrapped as Electron wraps them), `interactionWiring.test.ts` (the T-57 pin names `reportFailure` and forbids `toast.error` and `ipcErrorMessage` in `clearAutosave`). Red on the T-117 build's old toast: `Received string: "Couldn't clear the autosave: could not delete autosave.json. It's still on disk — close anything using it and try again."`. The `MUST_LAST` row that named this toast's 8 s moved to `reportFailure.test.ts`, as Record's save row did.

### Not an element, but covered

- **No renderer site shows main's string as written** (`failurePathLanguage.test.ts`): no renderer source calls `ipcErrorMessage`, with a finder that discriminates (a call, a bare import, another function). The three that did (Record's save, its source list, the Autosave banner's Clear) are `reportFailure`. `ipcErrorMessage` is still the first step inside `userFacingError` and the classifier in `importDiagnostics.ts`, neither of which shows its input; both were checked and left.
- **`isOutsideFolder`** (`src/main/pathConfine.ts`): the one place main asks "is this path outside that folder"; a scan in `pathConfine.test.ts` fails on a hand-rolled `startsWith('..')` anywhere in `src/main` and has a discrimination block. `round17Coverage.test.ts` asks the helper instead of a copy of the expression.
- **`isSafeId` / `assertSafeId`** (`src/shared/pathSafety.ts`): the alphabet nanoid mints, held by `pathSafety.test.ts`; used by the audio presets at three places.
- **`localDate` / `localTime` / `localStamp`** (`src/shared/filename.ts`): the three readers of the person's clock; the export panel's `{date}` and `{time}` call them.
- **The copy of the whole-frame softness claim about `scale`** is the measured one in `filters.ts`, `filters.test.ts` (header and test title), STYLE_GUIDE, LESSONS, TESTING and the first sentence of `media.spec.ts`' T-115 comment. Re-measured with the repo's ffmpeg on the T-115 fixture (a 321x241 lossless 1-pixel checkerboard through `scale=320:240`): 48.5 percent of the pixels in the mid-gray band strictly between 80 and 175 (47.5 after `libx264 -preset fast`; the suite's `hardness` counts that band with EXCLUSIVE bounds, `v > 80 && v < 175`, and counted inclusively the scaled frame is 49.3 percent), which is not "between black and white" - nearly every pixel is, 96.2 percent strictly between 0 and 255 and only 3.8 percent still exactly 0 or 255 on the scaled frame (92.0 and 8.0 after the encode); every 8x8 corner tile still spanning 0 to 255, only the four corners hard (the first and last 15 percent or so of each edge: 48 of row 0's 320 pixels at each end, on the scaled frame and after the encode alike; column 0's 240 are 3 at each end on the scaled frame and 36 at each end after the encode) and every edge soft at its middle (row 0: 70 of 320 pixels in the band, no longer the "left and top edge stay hard" the text said until round 68), the center a flat 130; through the crop, none.
- **Docs:** STYLE_GUIDE (the confinement, id and stamp conventions; `ipcErrorMessage` no longer the call for any renderer site; "anymore"; "checked for"), LESSONS (this round's entry, and the round-16 line that wrote the preset id off "since they're not paths"), the round-65 row that quoted a pre-rename E2E title, the tick-idiom list (exact, 30 sites), category (5) of the spelling disclosure (nineteen), USER_GUIDE (the kit folder's date is the computer's).

### Closed from round 66's "Found, not fixed"

"tick" idioms: the list is exact now (the bullet above is the round-66 bullet, recounted). `captions:saveSrt` still throws where `captions:writeKitSrt` answers `ok: false`: unchanged and still the bigger call.

### Found, not fixed

- **Five older copies of the nanoid alphabet remain** (`customPresets.ts`, `search/moodboard.ts`, `ipc/search.ts`, `SAFE_SESSION_ID_RE` in `ipc/recording.ts`, `SAFE_JOB_ID_RE` in `ipc/video.ts`); each is correct. `isSafeId` is where they would go, one import each; nothing was wrong with them, so nothing was changed.
- **`video:deleteCustomPreset` gates its id in the store only.** The handler checks non-empty and the store (`deleteCustomPreset`) holds the alphabet, as the round-15 pattern has it. The audio handler now holds it in both, as `ipc/search.ts` does.
- **`captions:saveSrt` with `srtPath` equal to the captions folder itself passes the gate** (the relative path is empty) and fails at the copy with an EISDIR the person reads as the panel's fallback. Harmless, and not a path anyone sends.
- **A preset file whose own `id` field is outside the alphabet is no longer listed.** Nothing the app writes can produce one (ids are minted by nanoid), so this hides only a hand-edited file; it stays on disk, and is neither deleted nor shown.
- **The skewed-clock E2E trick depends on Chromium and Electron reading `TZ` from the environment**, which they do on Linux and Windows; it was verified here (the date in the renderer's `new Date()` and in main both followed it). A launch that sanitizes the environment would make those two cases pass vacuously, which is why each asserts that the skewed local day is not the UTC day before it starts.
- **"any more" remains in four comments, one test title and one line of guide prose** (the comments `useGlobalUndo.test.ts:91`, `moodboard.ts:263`, `copyConventions.test.ts:376` and `home-chrome.spec.ts:851`; the title `interactionWiring.test.ts:732`; and the wave-added `docs/STYLE_GUIDE.md:355`, "call for nothing in the renderer any more (T-117)", which is prose and not a comment). It is a house spelling for copy, not a rule any scan reads; the title was cited at `:716` until round 68, and the STYLE_GUIDE line was missing from the list.

## Dispositions — round 68 (T-118: the review gate's seventh pass)

Seven items from the nine reviewers' seventh pass (QA, audio, privacy and streamer clean; accessibility and UX clean after two T-110 filings; every finding LOW except one MED, the ffmpeg reviewer's). Three behavior changes, each red-first and each guard broken once and watched to fail (the quotes, the mutation table and the sha256 before and after each restore are in the hand-back): the Autosave Clear's errno, the bt709 matrix stage, the `=` in a caption path. **IMG-PREC's Layer 5 trigger fired twice** (a filter-graph change and an escaper that feeds a filter graph) and both are in the suite. The numbers: `npm run verify` 3522 tests in 133 files (one new file, `gradeMatrix.test.ts`); `test:media` 198 cases, 187 run and 11 platform-skipped (six new: the `a=b.srt` burn-in and the five-case bt709 block); Playwright 230, unchanged (no new case; `home-chrome.spec.ts`'s Clear-failure case re-pinned). All counted in `TESTING.md`.

### Video Studio - the Temperature slider

- **Video 4i ColorGradePanel - Temperature slider, on a source tagged bt709 ([T-118], end state changed):** the slider's output keeps a bt709 source's colors. On the shipped ffmpeg (6.1.1) `colorbalance` returned a bt709-tagged source (OBS's default) in the bt601 matrix and dropped the tag, so saturated colors shifted (SMPTE green `(0,157,0)` came out `(0,130,0)` here for a cast of 0.01) while players decode the file as bt709. `probeVideo` carries `colorSpace`, the export (and so Clip Kit) and the compilation hand it to `buildVideoFilter`, and a bt709 source's graph gains `scale=out_color_matrix=bt709,setparams=colorspace=bt709` right after `colorbalance`; an untagged or `unknown` source gets nothing (and, since round 69, the two bt601 tags get `setparams=colorspace=<tag>` alone: see "Dispositions - round 69"). Unit: `filters.test.ts` (the builder, a table of tags, the order, a crop), `gradeMatrix.test.ts` (each runner's real `-vf` for a bt709 probe and for an untagged and a bt601 one; dropping the probe's value from `export.ts` or from `concat.ts` fails exactly that runner's case). Layer 5: "the temperature grade keeps a bt709-tagged source in bt709" (five cases: the fixture is what it says; the export and a compilation segment each graded at 0.01 against an ungraded control within 4 levels after a player-style decode, output tagged bt709; a full warm grade still warms the gray band; an untagged source's grade within 4 levels of its control). DISPOSITION: the Layer 5 block passes on the bundled linux 7.0.2 with or without the fix (the stage removed: 5 of 5 green), because 7.0.2 keeps the matrix and the tag; the red-first run is the distro's 6.1.1 through a scratch alias config kept outside the repo (`green graded 0,130,0 vs control 0,157,0: expected 27 to be less than or equal to 4` and `the graded output is still tagged bt709: expected undefined to be 'bt709'`, on both runners; with the stage as the ticket first wrote it, `scale=out_color_matrix=bt709` alone, the pixels return and the tag does not, which is why `setparams` is in it), and the win32 release run (T-110(f)) is the standing check on the real binary. The slider itself is driven as before (the ColorGradePanel rows above, T-109's included); what changed is the file it writes for a tagged source, which no E2E decodes.

### Video Studio - captions

- **Video 4o CaptionsPanel - Burn into video, a video whose name has an equals sign ([T-118], end state changed):** the burn-in opens for a transcript called `Boss=Dead-<stamp>.srt` (derived from a video called `Boss=Dead.mp4`); it died with `Error applying option '.../a' to filter 'subtitles': Option not found` (exit 8) and the person's only recourse was renaming the video and transcribing again. `escapeSubtitlesPath` escapes `=` in both character classes. Unit: `captions.test.ts` (one, two and a repeated `=`). Layer 5: the burn-in escapes `it.each` gains `a=b.srt` (red on the old escaper: `ffmpeg exit 8`, run again on the distro's 6.1.1 with the fix: green). The click itself is unchanged: the OS save dialog and the whisper engine stay HL-dialog and HL-whisper as in the existing rows, and `runBurnIn` is driven by the real binary in the existing Layer 5 cases; the new case puts the escaper's output into the same `subtitles=<path>:force_style=...` shape the burn-in builds (`whisperManager.ts`). DISPOSITION: the Layer 5 case passes with `=` in the first character class alone (the second round escapes the backslash the first added, and the filtergraph parser has no use for `=`), so the second-class half is pinned by the unit only.

### Home - the Autosave banner

- The Clear failure row ("when the delete fails") is rewritten in place under round 67's heading, because round 67's claim about it (a locked file is named) was only true after this round; it now says what main raises, what each stub is, and why the E2E cannot be red from `clearAutosave`.

### Not an element, but covered

- **`clearAutosave`'s message** (`main/autosave.ts`): ends in the errno code of the first unlink that failed on a file that stayed, with no trailing period; `autosave.test.ts` drives the real function with an `unlink` stand-in and passes its error to the real `userFacingError`.
- **`ProbeResult.colorSpace`** (`main/ffmpeg/probe.ts`): read off the real file by the bundled ffprobe in the Layer 5 fixture check ("the fixture is what it says"); the probe's other fields are covered by the existing "probeVideo reports source dimensions" cases.
- **`RecordStudio.tsx`'s failure comment** now says which branch says what (comment only; the product call is T-110(u)).
- **The softness prose** is the measured one in every place it was written - `filters.ts`, `filters.test.ts`, STYLE_GUIDE, LESSONS (twice), TESTING, this ledger (twice) and the Layer 5 comment - with the numbers in the round-67 bullet above.

### Closed from round 67's "Found, not fixed"

The "any more" list is re-pointed (`interactionWiring.test.ts:732`) and carries the wave-added `STYLE_GUIDE.md:355`; category (5) of the spelling disclosure is eighteen comments and titles plus two named string literals, with the real `failurePathLanguage.test.ts` lines. Line cites into files this round edited were re-pointed in the same rows (`media.spec.ts`, `captions.test.ts`, `AutosaveRestore.tsx`, `filters.ts`, `RecordStudio.tsx`).

### Found, not fixed

- **Only `bt709` is rewritten** (round 68; round 69 added the two bt601 tags, tag alone: see "Dispositions - round 69"). A source tagged `bt2020nc` (HDR, rare in OBS recordings) or another matrix would take the same RGB round trip on 6.1.1 and is not covered. The upgrade is the same pair keyed on the tag (T-120, measured: a retag alone restores a graded bt2020nc source's tag and pixels on 6.1.1, within 4 levels (red `200,43,40` against `202,45,44`) on the T-118 bands made in the bt2020 matrix and tagged bt2020nc, a hand fixture that is not in the suite, as it does bt709's (within 3 on the suite's own bt709 bands, red `199,42,42` against `202,45,45`), and `scale=out_color_matrix=bt2020` ahead of it is what survives an Auto Zoom; the constant is `bt2020`, because the bundled 7.0.2 refuses `bt2020nc` and `bt470bg` as `out_color_matrix` values).
- **Auto Zoom after a grade strips the tags again.** `zoompan` drops them on both majors (6.1.1: all three unknown; 7.0.2: primaries and transfer unknown), as T-110(o) recorded; the pixels stay right (green `(0,155,0)` either way), so a bt709 clip with Auto Zoom and a Temperature is correct but untagged.
- **`scale=out_color_matrix=bt709` does not re-tag on 6.1.1** (it does on 7.0.2), measured with `setparams=colorspace=unknown` ahead of it on both; `out_range`, `in_color_matrix`, `lanczos` and a trailing `format` did not change that either. `setparams=colorspace=bt709` is the only token that did, and it is in the stage.
- **The GIF export ignores the grade by design** (T-110(e)), so it carries no `colorSpace`; no other runner builds a `colorbalance`.


## Dispositions — round 69 (T-119: the review gate's eighth pass)

Thirteen behavior items and thirteen claim-accuracy edits from the nine reviewers' eighth pass over the held wave (the first with the deeper rerun briefs). Every behavior change was red-first and every guard broken once and watched to fail (the quotes are in `LESSONS_LEARNED.md`, 2026-10-14; the mutation table with the sha256 before and after each restore is in the hand-back). **IMG-PREC's Layer 5 trigger fired once** (the Temperature stage's filter graph grew a branch) and is in the suite. The numbers: `npm run verify` 3596 tests in 135 files (two new files, `captionsOpenFolder.test.ts` and `settingsClear.test.ts`); `test:media` 205 cases, 194 run and 11 platform-skipped (seven new: the bt601 half of the T-118 block); Playwright 238 (eight new cases, five re-pinned or extended). All counted in `TESTING.md`.

### Record

- **Record - Start recording ([T-119], end state changed):** from the press until the capture and the main-process session are open, the button reads **Starting…** and is disabled, a second call of the handler in the same tick does nothing, and the press yields exactly one take; a refused start (no microphone) puts the button back and a second press runs the whole start again. E2E: record.spec.ts "Start while the capture is still opening says \"Starting…\", cannot be pressed again, and opens exactly one take" (the desktop capture held open; the capture asked for once however many presses) and "Start with mic enabled and no microphone refuses..." (presses Start twice: two refusal toasts, the second only if the guard was released). Unit: `interactionWiring.test.ts` (the claim before the first `await`, the release in a `finally`, the disabled prop and the label, with a finder that discriminates). DISPOSITION: the real screen capture is HL (it needs a display server's capture permission); the E2E stands in for `getUserMedia`, which is where the second capture used to begin.
- **Record - Saved toast, Edit in Video Studio ([T-119], behavior changed):** with clips in Video Studio it asks "Replace the video you're editing? N clips and their edits will be discarded." before it loads; with none it asks nothing; declining leaves Record, the toast's button and the first take as they were. E2E: record.spec.ts "\"Edit in Video Studio\" asks before it replaces the video being edited, and asks nothing when nothing is open" (the real `confirm`, its text read). Unit: `videoStore.test.ts` (`videoDiscardMessage`: nothing at zero, Close's sentence word for word, Replace's) and the wiring pin (the question precedes `loadVideoSource`; Close goes through the same helper). Home's Open project over a tuned studio stays T-110(n).
- **Record - a take whose write failed, `recording:abandon` (no element; the renderer's `catch` calls it) ([T-119], end state changed):** answers and removes the partial webm after a write error, where it used to wait forever for a `close` that had already fired. Unit: `recordingStream.test.ts` (three cases through the real handler: the fd closed under the stream, a close held for 150 ms, a close that never arrives). DISPOSITION: a full disk or a vanished drive is the OS; closing the fd under the stream is the deepest layer that makes the same stream state, and it is what the handler sees.

### Video Studio

- **Video 4e Timeline - Playhead slider keys, and the two trim handles ([T-119], behavior and a11y changed):** after a click on the track, `I` and `O` set the in and out points at the playhead (each its own undo step), `,` and `.` step a frame, and the existing arrows, Home and End are as before; the two handles are pointer-only (`tabindex=-1`, `aria-hidden`, no name). E2E: video-core.spec.ts "timeline: click the track, then I and O set the in and out points and , and . step a frame; the trim handles are pointer-only" (the sequence the guide promises; Undo takes only the Out point back; two `I` presses with the keyboard alone between them are two steps; Tab from the slider never lands on a handle). Unit: the wiring pin (the cases, the store actions, `endGesture`, the text-field stand-down, both handles). The handles lose their accessible names, "Trim start" and "Trim end": the earlier rows that use those words keep them as the names of the DRAGS in the tests, which find the handles by place (`[data-tutorial="video-timeline"] button[aria-hidden="true"]`). DISPOSITION for the stand-down: the slider has no children, so no key can reach it from a field today and no E2E can put one there; the pin reads the source.
- **Video 4f ClipList - the clip rename field ([T-119], a11y):** a focus ring (`focus:ring-1 focus:ring-accent`); it was the one input in the app with `outline-none` and only a background change on focus. E2E: video-core.spec.ts "clip list: add, rename, select, speed slider and speed reset" reads the computed `box-shadow` (none while blurred, the accent color while focused). Unit: `a11ySweep.test.ts` rule 5 (`outline-none` needs its own ring; found exactly this one element).
- **Video 4s CaptionsPanel - Show models folder ([T-119], end state changed):** opens `<userData>/models` on a fresh profile too (the handler makes the folder first, recursive, and awaits the shell; a non-empty answer is logged, a folder that cannot be made is logged and not thrown across the bridge). Unit: `captionsOpenFolder.test.ts` (the real handler on a real tree: the folder exists at the instant the shell is asked, parents too, an existing folder is left alone, the log, no throw). DISPOSITION: the Explorer window the shell opens is native (NAT/HL-shell); the handler is the deepest layer, and the button calls it with no logic of its own.
- **Video 4r ExportPanel - Export with the Watermark field blank, and Clip Kit after it ([T-119], end state changed):** a blank export forgets the saved handle and corner (both keys leave `config.json`), so the kit that follows stamps nothing; before, the old handle stayed and the kit stamped it. E2E: video-pipelines.spec.ts "a blank export forgets the saved watermark, and the kit stamps nothing after it" (a handle seeded, the field emptied, one export, both keys absent from the file, then Clip Kit writes its five files and says `Saved your Clip Kit`, which this platform's drawtext-less ffmpeg cannot do for a stamped kit - the neighboring "kit stamps the SAVED watermark" case is the control). Unit: `settingsClear.test.ts` (the real `settings:set` over the real store: `undefined` clears, anything else is stored and judged as before, `null` is still refused) and the wiring pin (both clears in the else branch). The existing "the watermark reaches the filter graph, and both halves of it survive a relaunch" case is unchanged, and its comment about an empty watermark now says what the new case adds.
- **Video 4i ColorGradePanel - Temperature slider, on a source tagged bt601 ([T-119], end state changed):** the slider's output keeps a `smpte170m` or `bt470bg` source's tag (it came out of 6.1.1 as `unknown`, and every built-in preset is at least 1280 px on its long side, where a player that guesses reads an untagged file as bt709). The graph gains `setparams=colorspace=<that tag>` right after `colorbalance` and nothing else (the bt709 recipe on a bt601 source moves the pixels: green came out `(11,184,3)` against the control's `(0,158,0)`); untagged, `unknown`, `bt2020nc` and every other string get nothing. Unit: `filters.test.ts` (the per-tag shapes, the order, a crop, ten inputs that get nothing), `gradeMatrix.test.ts` (each real runner's `-vf` for each tag; dropping the probe's value from `export.ts` or `concat.ts` fails exactly that runner's cases). Layer 5, the T-118 block (seven new cases: both fixtures are what they say, each tag through the export and a compilation segment against an ungraded control under a 601 decode with the tag asserted, a full warm grade still warms the gray band). DISPOSITION: like the bt709 cases, green on the bundled 7.0.2 with or without the branch (`12 passed` both ways) because 7.0.2 keeps the tag; the red-first run is the distro's 6.1.1 through a scratch alias config outside the repo (`5 failed | 7 passed` with the branch removed: `the graded output is still tagged smpte170m: expected undefined to be 'smpte170m'`; `8 failed | 4 passed` with the whole stage removed), and the win32 release run (T-110(f)) is the standing check on the real binary. The pixels are within 3 levels of the ungraded control on both majors (the suite's fixture; round 68's "2" was 3 as well).
- **Home - Open project, and the autosave Restore ([T-119], validation changed):** a project whose studio is structurally empty (`clips: [{}]`, `chain: {}`, `doc: {}`) is refused with a reason in the existing style (`videoStudio.clips[0].id missing`, `audioStudio.chain.gainDb not a number`, `imageCanvas.doc.layers not an array`) instead of opening a studio that threw in render or silently stopped autosaving. Unit: `projectValidation.test.ts` (every field wrong in every way, the clip named by index, whole clips with and without every optional field accepted, the three shapes through `validateProjectJsonString`). DISPOSITION: the Open dialog is native (NAT); the refusal reaches the person through the same Open project and Restore paths the existing rows drive, with the validator's reason in the console.

### Audio Studio

- **Audio - importer: drop, Choose file… and Recent while a load runs ([T-119], behavior changed):** a second file is refused with "Still extracting audio from the last file. Wait for it to finish." (or "Still loading the last file. Wait for it to finish."), the first one is what opens, and a refusal does not stick. E2E: audio.spec.ts "a second file while the first one is still being extracted is refused, from a drop and from Recent, and the first one is what opens" (a held ffmpeg; one extraction in the spawn log; a text file refused first and the next file taken after; the second drop sits in a cloud-sync-looking folder, so the refusal must come BEFORE the warning). Unit: the wiring pin (the claim before the first `await`, the release in a `finally`, all three entries). DISPOSITION: the Choose file… leg is a native dialog (NAT) and the button is disabled while busy; the race is a drop starting a load while the picker is open, held by the pin alone.
- **Audio - Fix Wizard, focus on every step ([T-119], a11y changed):** each question opens on its first option, the summary on Apply, and Start over on the first question again; the trap still cycles and Escape still returns to the opener. E2E: audio.spec.ts "Fix Wizard keeps keyboard focus on every step: the first option of each question, then Apply" (keyboard only). The older home-chrome.spec.ts case "Modal contract (FixWizard): Escape, scrim, focus trap, focus restore" is re-pinned: the wizard opens on its first answer ("None to speak of"), no longer on Close, one Shift+Tab back is Close, and the trap still wraps both ways. It was the one case in the full suite that went red, and the focused runs of the new case could not have shown it.

### Stream Graphics

- **Image - Variants: Generate, then Save all ([T-119], a11y changed):** the previews replace the Generate button and focus lands on **Save all**. E2E: image.spec.ts "variants: generate four tiles, save one, regenerate, save all" asserts it.
- **Image - tool keys with a focused Export format or Scale select ([T-119], behavior changed):** the letters belong to the select (type-ahead), and Delete and Backspace no longer remove the selected layer behind it; with focus back on the page the same keys work. E2E: image.spec.ts "a focused select owns the keys: typing in the Export format neither switches the tool nor deletes the layer". The three cites into the guard in that file are re-pointed (`ImageStudio.tsx:62-71`, `:63`, `:54-55`).

### Tutorial

- **Tutorial coachmark - the scroll to a step's target ([T-119], a11y changed):** an instant jump under the OS Reduce-motion setting, a glide otherwise. E2E: home-chrome.spec.ts "T-119 the coachmark scrolls instantly under Reduce motion and smoothly otherwise" (every `scrollIntoView` recorded with the behavior asked for, under both emulated settings). Unit: `Tutorial.test.ts` (`tutorialScrollBehavior`). The `index.css` comment that said the block disables "smooth scrolling across the whole app" now says what it governs.

### Not an element, but covered

- **`setSetting(key, undefined)`** (`main/store.ts`) deletes the key; `settingsClear.test.ts` drives the real handlers over a real file.
- **`truthInCopy.test.ts`** reads `README.md` and the release workflow's body for the two online exceptions (and against "the only feature that touches the internet" and "Everything stays on your computer"); the release edit is body text only, and `releaseWorkflowShape.test.ts` is unchanged and green.
- **`spawnWindowsHide.test.ts`** has a floor of 17 spawn sites (fourteen that had the option and three that did not, seventeen in all); a lost site stays green at the old floor of 16 and fails at 17 (measured).
- **`a11ySweep.test.ts` rule 5** (`outline-none` needs its own focus ring).

### Closed from round 68's "Found, not fixed"

"Only `bt709` is rewritten" is rewritten above (bt601 done; `bt2020nc` stays). The "any more" row in this file is "anymore", and the "any more" inventory and category (5) of the spelling disclosure below are recounted with their cites as they sit after this round's edits.

### Found, not fixed

- **`bt2020nc` and every other matrix still take 6.1.1's RGB round trip unrewritten.** The upgrade is the stage's own pair for that tag: `setparams=colorspace=<tag>` restores the tag and, measured on 6.1.1, the pixels (round 69 wrote that a retag alone would not; T-120 re-measured it and it does), with `scale=out_color_matrix=bt2020` ahead of it to survive an Auto Zoom. The constant is `bt2020`: the bundled 7.0.2 refuses `bt2020nc` and `bt470bg` there ("Undefined constant").
- **The Layer 5 bt601 cases are green on the bundled 7.0.2 by design** (as the bt709 block is); their red lives on 6.1.1 only, so the unit pair is the regression suite everywhere else.
- **`ExportPanel`'s settings writes are awaited outside any `try`** (T-110(x)'s family): a write that rejects ahead of the queue aborts the export silently. Measured with `setSetting` back to a plain `set`: the blank-watermark export never started. The two clears this round adds sit in the same unguarded spot as the two writes beside them.
- **`abandon`'s bound is a fixed 2 s** (a `// simplification:` comment at the constant): a drive slower than that gets an unlink Windows refuses, and the partial stays until the next launch's `tempCleanup` (files older than 6 h). The upgrade is to keep the close listener and unlink when it fires.
- **`HOW_IMAGII_WAS_MADE.md:69` still says "the only feature that touches the network"** (the build history, outside the ticket's two files); the same class as the README line this round fixed.
- **The Timeline's text-field stand-down is unreachable today** (the slider has no children) and is pinned by source text only.


## Dispositions — round 70 (T-120: the review gate's ninth pass)

Fifteen behavior items and twelve claim and count edits from the nine reviewers' ninth pass over the held wave (the second deep-brief sweep). Every behavior change was broken once and watched to fail (the quotes are in `LESSONS_LEARNED.md`, 2026-10-14; the mutation table with the sha256 before and after each restore is in the hand-back). **IMG-PREC's Layer 5 trigger fired twice** (the convert's argv gained `-fps_mode vfr` and the save gained a remux; the matrix stage's claims moved with a new case) and both are in the suite. The numbers: `npm run verify` 3700 tests in 137 files (two new files, `probe.test.ts` and `videoPickOutputDir.test.ts`); `test:media` 215 cases, 204 run and 11 platform-skipped (ten new: the MediaRecorder block, eight, and the Auto Zoom pair); Playwright 245 (seven new cases, the rest extended or re-pinned). All counted in `TESTING.md`.

### Record

- **Record - Save recording with Convert to MP4 off, and Edit in Video Studio on the result ([T-120], end state changed):** the WebM is written by a packet copy (`remuxWebm`) and so carries a duration; "Edit in Video Studio" on it opens a studio with a clip, where it used to read "Re-export it as MP4 from your recorder". E2E: record.spec.ts "record -> Stop -> save as WebM writes real bytes, toasts, and joins recent videos" now reads `format.duration` and CLICKS "Edit in Video Studio" (the h1, the file name, "Export 1", one `<video>`, no refusal toast). Unit: `recordingCancel.test.ts` (the remux is handed the temp take and the chosen path; a discard answers `null` and leaves no file; a failed remux saves the take as recorded and logs; the MP4 branch never remuxes), `convertCancel.test.ts` / `cancelSentinel.test.ts` (the argv; the sentinel). Layer 5: the MediaRecorder-shaped block, VP9 and VP8. DISPOSITION: the Save dialog is native (stubbed in main); a "Discard recording" press during the remux is not offered by the card (its WebM state has `canDiscard: false`, recorded under Found, not fixed) though main would honor it (`cancelRecordingConvert` reaches the remux).
- **Record - Convert to MP4 ([T-120], output changed):** the file keeps one frame per source frame instead of one per millisecond (`-fps_mode vfr`): the fixture's 3 s take is 90 frames and reads about 30 fps where it was 2980 frames at 1000 fps, 12 times faster, and Video Studio's `,` and `.` step a frame, not a millisecond. Layer 5 (same block): both codecs, and the importer's flv, wmv and mpg held to exactly 50 frames in 2 s.
- **Record - the recording view's preview and the webcam thumbnail ([T-120], end state changed):** the screen preview shows the capture (`videoWidth > 0`, playing) and, with a camera in the take, the thumbnail shows the camera; both let go of their streams when the phase ends. E2E: the WebM case (the preview) and record.spec.ts "the recording view shows the take: the screen preview and, with a camera in the take, its thumbnail" (a canvas stream stands in for the camera, which this container lacks; the compositor really runs). Unit: the wiring pin (the effect, its dependency list, no `srcObject` left in `startRecording`).
- **Record - Start recording, and leaving during "Starting…" ([T-120], end state changed):** a person who leaves Record while the capture is opening leaves nothing running: every track ends, no session is begun, no temp file. E2E: record.spec.ts "leaving Record while the capture is still opening lets go of it" (the real desktop capture held open, the Home link clicked, then released; tracks ended, no temp file, no recordings folder). Unit: the wiring pin (a syntax-tree finder: every `await` in `startRecording` is followed by the unmount check; the flag set in the cleanup and cleared on mount; a discrimination block). DISPOSITION: the check after `recording:begin` (the session already opened) is held by the pin alone; the E2E ends the start earlier, at the first check, and would not tell that guard's removal.
- **Record - the Output card's hint ([T-120], words changed):** "A take can use about 3.6 GB of disk per hour, and saving needs room for a second copy of it." beside the existing sentence; recordings are asked for 8 Mbps (`videoBitsPerSecond`, merged with the mime option). E2E: record.spec.ts reads the hint on the Output card; the wiring pin holds the constant and the merged options. Measured with the real MediaRecorder: 1.36 Mbps without the option, 2.56 with it, on a synthetic 1080p canvas.
- **Record - the "Finishing up" card, WebM state ([T-120], words changed):** "Saving a WebM is a quick copy, so there is nothing to stop." (it said "plain file copy"; the save is a packet copy into a fresh file now). E2E: record.spec.ts "a WebM take: the card says "saving"..." reads it.
- **The app window, minimized ([T-120], no element):** `backgroundThrottling: false`, so the webcam composite's `requestAnimationFrame` loop keeps running while imagii is minimized. E2E: record.spec.ts "the window opts out of background throttling" reads `webContents.getBackgroundThrottling()` on the live window; the wiring pin reads the `BrowserWindow` options. DISPOSITION: a window manager is what hides a minimized window from the page, and this box has none (a probe that hid and minimized the window left `document.visibilityState` `visible`); the minimized behavior itself is a hand-check on the win32 release run.

### Video Studio

- **Video 4e Timeline - Space on the Playhead slider ([T-120], behavior changed):** after a click on the track, Space plays and pauses the video through the Player's own toggle (registered with the store as a `PlayerTransport`) and does not scroll the studio; the shortcut overlay's Space, `,` / `.` and I / O rows say "(player or timeline focused)". E2E: video-core.spec.ts "timeline: click the track, then Space plays and pauses the video, and the studio does not scroll". Unit: the wiring pin (the case, `preventDefault`, the transport call, the overlay rows), `videoStore.test.ts` (the registration), `hotkeyTable.test.ts` (the rows are real bindings).
- **Video 4e Timeline - I and O during playback ([T-120], end state changed):** the in or out point is the frame on screen (`playheadNow`: the element's time, else the store's), where the store's `currentTime` trails playback by up to a `timeupdate`. E2E: video-core.spec.ts "timeline: I during playback marks the frame on screen, not the last time the store heard of" (the store made stale on purpose by stopping the element's `timeupdate`). Unit: `videoStore.test.ts` (five cases) and the wiring pin.
- **Video 4p ClipKit - the folder chooser ([T-120], end state changed):** opens on the folder the last kit went to (`clipKit.lastOutputDir`, which was written and never read). E2E: video-pipelines.spec.ts "the Clip Kit chooser opens on the folder the last kit went to, and a stale setting is ignored" (the chooser stubbed in main and the options it was opened with read; a relative path and a cleared setting open where it always did; nothing starts, no toast). Unit: `videoPickOutputDir.test.ts` (eleven cases through the real handler), the wiring pin. DISPOSITION: the chooser itself is native.
- **Video - Close and Record's "Edit in Video Studio" questions ([T-120], words changed):** "1 clip and its edits" at one, "N clips and their edits" otherwise. E2E: video-core.spec.ts "close asks first...", home-chrome.spec.ts "RecentFilesMenu: a pick loads the video...", record.spec.ts "\"Edit in Video Studio\" asks before it replaces the video being edited..."; unit: `videoStore.test.ts`.
- **Video Studio's frame step on a recording ([T-120], end state changed):** `probeVideo` reads a rate above 240 fps as unknown (0), so a saved WebM (whose container still says `1000/1`) steps at the Timeline's 30 fps default, not 1 ms. Unit: `probe.test.ts`; Layer 5 asserts the saved remux reads `0` through the production probe and a real 30 fps file still reads `30`.

### Audio Studio

- **Audio - Fix Wizard, a held Enter ([T-120], behavior changed):** a repeated Enter is ignored in every body of the wizard, so a held key answers one question, not all three and Apply; a fresh press still answers. E2E: audio.spec.ts "Fix Wizard: a held Enter answers one question, not all three and Apply" (a second `keyboard.down` of Enter is a repeat). Unit: the wiring pin.
- **Audio - Export and Re-attach with a hand-edited chain ([T-120], validation changed):** a cut whose times are not numbers, and a custom noise reduction whose numbers are missing or not numbers, are refused before anything is spawned, in a finished sentence; a saved preset is held to the same gate. Unit: `audioChainValidation.test.ts` (seven denoise shapes and nine cut shapes through both handlers, the preset, the sentences, the controls, `NODE_ENV=production`).

### Stream Graphics

- **Image - Variants: a keyboard Regenerate ([T-120], a11y changed):** focus ends on **Save all** after Regenerate, as after Generate. E2E: image.spec.ts "variants: generate four tiles, save one, regenerate, save all" (a keyboard Regenerate, then the focus assertion). Unit: the wiring pin.

### Not an element, but covered

- **The electron-store schema** is nested per dotted group; `settingsClear.test.ts` drives fifteen refused shapes and the accepted ones through the real handlers and store, and `settingsKnownKeys.test.ts` flattens the schema and compares it to the allowlist (and fails on a dotted property name).
- **`electron-builder.yml`** no longer pins `electronVersion`; `releaseWorkflowShape.test.ts` fails if it returns.
- **Docs:** the release workflow's comment and body and the README's maintainer note say "manual dispatch or a pushed `v*` tag" and "every launch unpacks" (comment and prose only; the triggers are untouched); the matrix stage's claims (`filters.ts`, `filters.test.ts`, STYLE_GUIDE, the two ledger bullets) say what was measured; "every built-in preset is at least 1280 px on its long side" at its six sites; the figures in LESSONS and TESTING are attributed to their fixtures; the native-dialog inventory, its Home table and the "tick" and UK-spelling inventories are re-pointed against this tree.

### Closed from round 69's "Found, not fixed"

"`bt2020nc` and every other matrix still take 6.1.1's RGB round trip unrewritten" stays open and is reworded: a retag alone does restore a graded bt2020nc source's tag and pixels (measured), and the constant for the matrix half is `bt2020`.

### Found, not fixed

- **A `config.json` that parses but breaks the schema stops the launch** (`new Store` validates the file as it opens it). It was so for the flat keys (`streamerHandle: 5`, measured) and the nested schema extends it to the eleven dotted ones, which is the price of the schema being alive. A `// simplification:` at the schema names the upgrade: catch the open, move the file aside, start from the defaults.
- **A WebM save offers no Discard although main can stop the remux** (`saveCard`'s WebM state has `canDiscard: false`, a `// simplification:` there). The remux runs at disk speed; the upgrade is `canDiscard: !discarding` with the card test and the E2E that pin "nothing to stop" re-pinned.
- **A remux that fails falls back to the plain copy, and that file has no duration.** Video Studio cannot open it (the old behavior); the failure is in the console and the take is not lost. Rare (a copy of the packets); not surfaced to the person.
- **`probeVideo` reports 0 for a rate above 240 rather than a measured one**, so a recording stepped by `,` and `.` moves 1/30 s, not the take's true 1/29-or-so. A second `ffprobe -count_packets` over the first seconds would measure it; the cost (a second spawn per such file) was not worth a frame of difference.
- **`videoBitsPerSecond: 8_000_000` is a ceiling, not a measurement of screen content**: the one measurement is a synthetic canvas (2.56 Mbps). The first real hour of gameplay is the hand-check for the 3.6 GB figure.
- **The minimized-window behavior** is a hand-check on the win32 release run (no window manager here).

---

## Dispositions — round 71 (T-121: the review gate's tenth pass)

Eight behavior items and fourteen claim and count edits from the nine reviewers' tenth pass over the held wave. Every behavior change was broken once and watched to fail (the quotes are in `LESSONS_LEARNED.md`, 2026-10-14, T-121; the mutation table with the sha256 before and after each restore is in the hand-back). **IMG-PREC's Layer 5 trigger fired three times** (the burn-in's and the PiP's argv gained `-fps_mode vfr`, and the cut re-attach's retime changed from a frame count to a timestamp) and all three are in the suite, on the MediaRecorder-shaped fixture. The numbers: `npm run verify` 3751 tests in 137 files (no new file); `test:media` 222 cases, 211 run and 11 platform-skipped (seven new: three per codec on the MediaRecorder fixture, and the overlapping cuts); Playwright 248 (three new cases, the zero-camera one extended). All counted in `TESTING.md`.

### Record

- **Record - Start recording with "Include webcam" checked, the camera opens and the compositor cannot start ([T-121], end state changed):** the take carries on as the screen alone, the camera that was opened is let go (every track `ended` while the take rolls), and no empty camera box is drawn over the preview. E2E: record.spec.ts "a camera that opens and a compositor that cannot start: the camera is let go and no empty box is left" (a canvas stream is the camera, `HTMLMediaElement.prototype.play` refuses it) and the existing "Start with the webcam ticked and no camera says so..." extended with the no-box assertion. Unit: the wiring pin. DISPOSITION: the camera's light is hardware; "every track ended" is the deepest state this box can read.
- **Record - Start recording, then leaving while the camera is opening, then the camera failing ([T-121], end state changed):** nothing is toasted for the screen nobody is on, no session is begun (no recordings folder, no temp file) and the camera's tracks end. E2E: record.spec.ts "leaving Record while the camera is opening, then the camera failing, ends the start silently" (the refusal held behind a gate until the Home link has been clicked). Unit: the wiring pin (the catch opens with the unmount check).
- **Record - the Output card's hint ([T-121], words changed):** "Off = save as WebM (quick, but some apps don't accept WebM)." (it said "instant"; the save is a packet copy into a fresh file, and the second-copy sentence beside it says it takes room). E2E: record.spec.ts reads the hint on the Output card.

### Video Studio

- **Video 4e Timeline - the left and right arrows and `,` / `.` during playback ([T-121], end state changed):** each steps from the frame on screen (`playheadNow`), not from the store's playhead, which trails playback by up to a `timeupdate`. E2E: video-core.spec.ts "timeline: the arrows and , . during playback step from the frame on screen, not the last time the store heard of" (the store made stale on purpose, once per key). Unit: the wiring pin (all four cases read `now`; the handler reads no `currentTime`).
- **Video 4s CaptionsPanel - Burn captions on a Record take saved as WebM ([T-121], output changed):** the file keeps one frame per source frame (`-fps_mode vfr`) instead of one per millisecond. Layer 5: the T-120 MediaRecorder block, both codecs. DISPOSITION: the speech engine is not installed here, so the E2E cannot reach the button's end state through a real transcription; the burn-in runner itself is driven for real at Layer 5 with a hand-written SRT, and `captionsBurnIn.test.ts` holds the handler.
- **Video - Picture-in-picture, base a Record take saved as WebM ([T-121], output changed):** the same `-fps_mode vfr`; Layer 5, both codecs, with an overlay as long as the take. The existing PiP E2E keeps its steady-rate sources.
- **Audio re-attach to a video with cuts, source a Record take saved as WebM ([T-121], output changed; the Export panel's "Re-attach to video" is Audio Studio's):** the picture keeps the rest of the take, as long as the sound: it was 0.07 s of picture under 2 s of sound. Layer 5: the T-120 block (`runAudioMux` with one cut, both codecs) and the T-82 block (overlapping cuts); the whole existing cut family is green on both majors. Unit: `chain.test.ts`.
- **Video 4p ClipKit - the file names of a clip named in another script ([T-121], names changed):** "Épico clutch" is `Épico_clutch_<platform>.mp4`, a Korean name keeps its letters, and two Hangul names no longer share `clip`. Unit: `filename.test.ts`, and `clipKit.test.ts` (six non-ASCII names through the real queue builders, each of the nine files a writable path). DISPOSITION: the kit's E2E keeps its ASCII clip; that Windows accepts these file names is a filesystem fact this box cannot show.
- **Video 4g ChatHighlightPanel - a chat log from chatters with non-ASCII names ([T-121], end state changed):** their lines count toward the spikes. Unit: `chatLog.test.ts` (Korean, Japanese, Cyrillic, accented, with marks, the `<name>` form). The panel's existing E2E keeps its ASCII log.
- **Open project and the autosave Restore, a clip with no `textOverlays` ([T-121], refusal added):** the project is refused naming the clip (`videoStudio.clips[0].textOverlays not an array`) instead of opening a studio that throws in render. Unit: `projectValidation.test.ts` (QA's clip as the red fixture). DISPOSITION: no UI path writes such a clip; the refusal is a damaged or hand-edited file's, so the deepest layer is the validator both entry points call.

### Audio Studio

- **Audio - the Close and "Clean audio" confirms ([T-121], words changed):** an older project's chain, with no `secondaryTrack` key or without the switches added since, no longer asks about "the second track" or "your cleanup settings" it does not have. Unit: `AudioStudio.test.ts` (eleven cases). The existing E2E (a native confirm answered both ways) keeps its edited chain.
- **Audio - Export and Re-attach with a hand-edited cut ([T-121], words changed):** the refusal says "Click its mark to put it back, then cut that part again." Unit: `audioChainValidation.test.ts`. DISPOSITION: not reachable from the UI (the numbers arrive from a hand-edited project).
- **Audio - the shortcut overlay's cut row ([T-121], words changed):** "Click a mark / Put a cut back". Unit: `hotkeyTable.test.ts` (a mouse hint), and the wiring pin that reads the four places the name appears.

### Not an element, but covered

- **`electron-builder.yml` and `package.json`:** three `files` excludes keep one ffprobe in the exe, and four dependencies nothing imports are gone; `releaseWorkflowShape.test.ts` pins both. Packaging probe (`electron-builder --win dir`, scratch output): `win-unpacked` 706 MiB to 409 MiB, `ffprobe-static` 336 MiB to 61 MiB (`bin/win32/x64/ffprobe.exe` only). The win32 release run is where `ffprobePath` and the Windows `ffmpeg.exe` are confirmed.
- **Docs:** the claims the ticket listed are corrected at their sites (FOR_MIKE, README, PRODUCT_GUIDE, HOW_IMAGII_WAS_MADE, STYLE_GUIDE, DESIGN_GUIDE, USER_GUIDE, BRANDING, `release.yml`'s comment, and four source and three test comments) and the cites this round's edits moved are re-pointed in this file.

### Closed from round 70's "Found, not fixed"

"`bt2020nc` and every other matrix still take 6.1.1's RGB round trip unrewritten" stays open and its figure is corrected: a retag alone restores a graded bt2020nc source within 4 levels (red `200,43,40` against `202,45,44`), not 2, on a hand fixture that is not in the suite; bt709's own is 3.

### Found, not fixed

- **Older-build WebM takes still refuse with the re-export sentence.** The remux repairs new saves only; a take saved by an earlier build has no duration in its header, and Video Studio says so. The same packet copy by hand (`ffmpeg -i old.webm -c copy new.webm`, which is what the save does now) gives it one.
- **The converted take's H.264 level is 6.1 on a 1080p take.** x264 is configured from the container's 1000/1 rate (re-measured here: 1920x1080, High profile, level 61, a `1000/1` fixture through the convert's argv; the same 320x240 take is level 4.2). It plays in Chromium; other decoders are a win32 hand-check. The burn-in, the PiP composite and the cut re-attach now share the argv shape and the level on a 1080p take (measured: 61 for the burn-in and for the cut).
- **HEVC and ProRes "should work", and the possibly-raised YouTube thumbnail cap** join the owner report's hand-check list: neither was run here (no file, no platform), and the claims in the guide are the platform's, not imagii's.
- **A silent PiP base shorter than its overlay runs to the overlay's length** with a frozen last frame (T-110 (ac), still open): `-shortest` has no audio stream to bound it. Met again while writing the PiP case (181 frames in 5.968 s over a 3 s take); the case uses an overlay as long as the take.
- **`@types/fluent-ffmpeg` is still a dev dependency** although `fluent-ffmpeg` is gone: the ticket named four dependencies and `package.json` was to change for those four only. It is not shipped.
- **A cut now leaves a one-frame hold at its seam** on a steady-rate source whose cut ends on a frame boundary (41.7 ms at 24 fps; the old count-based numbering closed the gap by a frame too much and put every later frame that much ahead of its sound). The upgrade is to snap cuts to the frame grid (T-110 (i)).

---

## Dispositions — round 72 (T-122: the review gate's eleventh pass)

Six behavior items and eight claim, cite and count edits from the nine reviewers' eleventh pass. Every behavior change was broken once and watched to fail (the quotes are in `LESSONS_LEARNED.md`, 2026-10-14, T-122; the mutation table with the sha256 before and after each restore is in the hand-back). **IMG-PREC's Layer 5 trigger fired once** (the cut re-attach's argv gained `-enc_time_base:v filter`): the case is in the suite and its red is the 6.1.1 run, because the defect lives on the major the exe ships and the bundled 7.0.2 is exact either way. The numbers: `npm run verify` 3773 tests in 138 files (one new file, `tests/unit/emojiGuard.test.ts`); `test:media` 225 cases, 214 run and 11 platform-skipped (three new: the two cut-timestamp cases and the checker's own); Playwright 249 (one new case; the second-track case and the six Record cases that read the hint extended or re-pinned). All counted in `TESTING.md`.

### Record

- **Record - Microphone and Webcam selects / the two "No ... found" hints ([T-122], copy changed):** the sentence names the third recovery: "No camera found. Plug one in, close any other app using it, or allow camera access in Windows privacy settings, then click Refresh sources." (and the microphone twin). A camera another app holds (OBS) probes as unavailable exactly like an absent or a blocked one, so the hint now says all three; Start's own error already did. E2E: the six record.spec.ts cases that read the hints exactly (`CAM_WARNING` and `MIC_WARNING`: "mic checkbox toggles...", "webcam checkbox with no camera...", "with a camera attached...", "Start with the webcam ticked and no camera...", "Refresh sources re-scans...", "a microphone and NO camera...") are re-pinned to the new sentences. Unit: `devices.test.ts` (both sentences exactly, and the clause for either kind). DISPOSITION: a device held by another app is an OS state this box cannot produce (no camera here); the sentence is what is asserted, and the probe's own rejection of all three is the shipped behavior the hint is written for.

### Video Studio

- **Video 4p ClipKit - Clip Kit on a clip whose name was cleared ([T-122], end state changed):** the rename field accepts an empty name, and the kit used to fail after the folder pick with "Clip Kit failed.". It now runs: the folder is `clip-kit-<date>`, the files are `clip_<platform>.mp4`, `clip_thumb_1-3.jpg`, and the reveal selects `clip_youtube.mp4`. E2E: video-pipelines.spec.ts "a Clip Kit on a clip whose name was cleared still runs: the folder and the files are named "clip"" (the real rename field cleared; the folder chooser stubbed in main, as in every kit case; a refusal fails the case with the toast's own words). Unit: the wiring pin (`safeName` is computed before `makeKitDir` and is what it is asked for; one `sanitizeFilename` call). Main's `assertNonEmptyString` gates are untouched (trust-boundary validation).
- **Video - Export panel, the `{handle}` token of the filename template ([T-122], names changed):** a handle in any script survives (`@토끼` is `토끼`; it was empty, so the template fell to `export`), a decomposed accent keeps its accent, an emoji and its variation selector go, dots and separators still go. Unit: `filename.test.ts` (seven `{handle}` cases; there was none). The panel's E2E keeps its ASCII handle. DISPOSITION: that Windows accepts these file names is a filesystem fact this box cannot show.

### Audio Studio

- **Audio - Second track panel, the "This track dips whenever you talk" footer ([T-122], conditional):** drawn only while "Duck under your voice" is checked. "Second mic" defaults Duck off and the export builds no `sidechaincompress` then, so the sentence was a promise about a dip that did not happen. E2E: audio.spec.ts "a second track can be added in every role and its mix controls drive the chain" (footer present with Background music, absent after unchecking Duck, present again, absent on Second mic, present on Game audio). Unit: the wiring pin.
- **Audio - Re-attach to video with cuts, the picture's timestamps ([T-122], output changed on the shipped ffmpeg):** a cut whose length is not a whole number of frames no longer puts two frames on one `pts_time` or shows a survivor up to half a frame early on a constant-rate source. Layer 5: the T-82 block, "a cut that is not a whole number of frames long keeps every survivor on its own timestamp" (the 24 fps ramp with two cuts; a 30 fps source with three), the whole output packet list against where each frame belongs, run on 7.0.2 (green with and without the option) and on 6.1.1 through the alias recipe (red without it: `pts_time written twice: 3.291667`). Unit: `muxCodec.test.ts` (the option beside passthrough on every re-encode, absent from a copy). DISPOSITION: the Export button's mux-back is the end state and is driven at Layer 5 through `runAudioReattach`; the Windows exe's own ffmpeg is the release run's.

### Not an element, but covered

- **The no-emoji guard** reads all four directories of `src/`; `tests/unit/emojiGuard.test.ts` fails when a directory is left off and runs the script on one emoji under each root. A temporary emoji in `src/preload/index.ts` failed the script and the file was restored byte-identical.
- **Docs:** the four exe-size figures are number-free ("a single portable exe") until the release run measures one; the BRANDING name-table violations in README and FOR_MIKE use the real names ("Posting log", "Title starters", "Smart highlight finder", "Start recording"); the timing figures live in one table in TESTING and the config comment and the release workflow's comment point at it; TESTING's media heading says Layer 5; STYLE_GUIDE names the hook (PostToolUse on Edit|Write|MultiEdit), gives Home and End to the Timeline, and no longer cites a local path; the stale cites in `image.spec.ts` and `ExportDialog.tsx` are re-pointed against this tree; the AutosaveRestore row above says Clear, not Discard.

### Found, not fixed

Ledgered with the round and not fixed, as the ticket said:

- **The reframe's Left and Right strips are not at the edges** (Left starts at x=196 on a 1920-wide source, not 0). A design call about what "Left" means; it joins the owner report's hand-check list.
- **The overlay and watermark fonts have no CJK coverage**, so a Korean or Japanese overlay text or watermark handle has no glyphs to draw with (the file name now survives; the picture is a separate question). A capability call (a font to ship, or a fallback chain); owner report.
- **(ak)** Record's microphone rides Chromium's voice-call processing (echo cancellation, auto gain, noise suppression all default on); **(al)** no single-instance lock; **(g)** the image-layer `src` mechanism; **(ai)** the portable exe's English-only locale paks. Each extends its lettered item in T-110's post-wave backlog.

Seen and left:

- **HOW_IMAGII_WAS_MADE.md** still says "Title pattern suggester" (line 96) and "auto-highlight finder" (line 159). It is the development log, and those are the names the items had when they were built; the user-facing docs are corrected.
- **TESTING.md's layers are numbered 1, 2, 5, 3, 4 in document order** now that the heading says Layer 5 (the repo's name for the media suite everywhere else). Moving the section is a roughly 260-line block move the ticket did not ask for.
- **The older LESSONS entry for T-82** (the cut re-attach's first fix) still says "ffmpeg falls back to a forced 25 fps CFR with duplicated frames"; it is that entry's own period account, measured on the bundled 7.0.x, and the claim is scoped to 7.0.x where the code and the test say it now.

---

## Dispositions — round 73 (T-123: the review gate's twelfth pass)

Eighteen behavior items (four of them layout items with measured numbers, four with a Layer 5 case) and sixteen claim, cite and count edits from the nine reviewers' twelfth pass. Every behavior change was broken once and watched to fail (the quotes are in `LESSONS_LEARNED.md`, 2026-10-14, T-123; the mutation table with the sha256 before and after each restore is in the hand-back). **IMG-PREC's Layer 5 trigger fired four times** (the single-track export's `-af` gained a limiter, a mono source's loudnorm gained `dual_mono`, the cut's picture chain gained `settb`, the crop region gained a clamp): each has a case on real output, the AVI one red on the BUNDLED 7.0.2 and all of them run on the distro's 6.1.1 too (the transcript is in the hand-back). **The layout rows below are the first to be asserted by measuring** (`tests/e2e/layout.ts`: `scrollWidth <= clientWidth` and every control inside its box, at the 1632x918 default window and the 1024x640 minimum), against the pre-round build. The numbers: `npm run verify` 3976 tests in 146 files (eight new files, `docClaims.test.ts` among them); `test:media` 238 cases, 227 run and 11 platform-skipped (thirteen new, two existing loudnorm cases re-pointed); Playwright 267 (eighteen new cases and five extended). All counted in `TESTING.md`.

### Record

- **Record - a take that ends by itself ([T-123], state changed):** when the captured window is closed every track ends, `onstop` runs `finalizeRecording`, and the save used to run under a live "REC 00:07" screen with a Stop that did nothing and no Discard (only the Stop button set the `saving` phase). `finalizeRecording` sets it at its top. E2E: record.spec.ts "a take that ends ITSELF (the captured window closed: every track ends) shows the saving card at once, not a live REC screen with a dead Stop" (every track ended from the page: the "Finishing up" card at once, no REC clock, no Stop, Discard enabled, the save dialog asked for the take's own title, and the take is still saved). Red on the pre-round build: the saving card `element(s) not found`. DISPOSITION: closing the captured window is an OS act this box cannot perform; ending the tracks from the page is the same event the recorder sees.
- **Record - the toast's "Edit in Video Studio" ([T-123], shared):** the ask-before-replace bridge is one hook now, `useEditInVideoStudio` (`lib/editInVideoStudio.ts`), that Record and Reframe both call; behavior unchanged. The two Record cases that drive it (record.spec.ts "record -> Esc -> save as MP4 runs the real convert and "Edit in Video Studio" hands the file over" and the T-119 question case) pass unchanged. Unit: `interactionWiring.test.ts` (the T-119 pin now reads the hook: the question before the load, a "no" returns first; both callers use it and neither carries a copy).

### Video Studio

- **Video 4q TextOverlayEditor - the Time boxes ([T-123], end state changed):** typing "12" is 12 (it was 1.00: the box rewrote itself to "N.00" on every keystroke), an emptied box stays empty, Enter or leaving commits, an end before the start is clamped to it and a start past the end lifts the end. E2E: video-core.spec.ts "text overlays: the Time boxes take typed digits (12 is 12, not 1.00), and the end never sits before the start" (typed with `retype`, because `fill` cannot find this class). Unit: `draftNumber.test.ts`. Red: `emptied: nothing snaps back into it  Expected: ""  Received: "0.00"`.
- **Video 4n PipPanel, 4j ChatHighlightPanel, 4s CustomPresetManager - the overlay width, the spike window, the preset's width, height and frame rate ([T-123], end state changed):** each took typed digits through `Number(typed) || default`, so an emptied box snapped to its default and the next digits appended ("600" in PiP was 360600, then a bare "Picture-in-picture failed."). They are `DraftField`s: the box holds what is typed, and a commit stores the number clamped to the range the box's own attributes name. E2E, one case each: video-pipelines.spec.ts "the overlay width takes typed digits: 600 is 600, not 360600, and what leaves the box is inside the range", "the spike window takes typed digits: 45 is 45, not 1045, and a number outside 3 to 60 is clamped when typing ends", "the size, height and frame-rate boxes take typed digits, and are held to what a preset can be". **One deviation, on purpose:** the width and height of a preset are clamped to 1 to 16384, not to 64, at the box: a width under 64 is refused at Save with its own sentence ("Width / height must be at least 64"), and that refusal is kept (and tested where it was).
- **Video - the five output-folder buttons ([T-123], name changed):** GIF, batch export, compilation, picture-in-picture and Reframe each draw an icon and the folder's name, so the button's accessible name was just "Videos". It is "Output folder: Videos" (`OutputDirLabel`'s `sr-only` prefix). E2E: video-pipelines.spec.ts "each of the five says what it is to a screen reader, "Output folder: <name>", not just the folder's name".
- **Video 4k ReframePanel - the saved toast's "Edit in Video Studio" ([T-123], new element):** the toast that names the file ("Saved name.mp4") carries the action Record's identical moment has. It asks "Replace the video you're editing? 1 clip and its edits will be discarded." before it loads the 9:16 file in place of the source; declined, the source and its Reframe panel stay and the button stays on the toast; accepted, the header names the new file, the Reframe card is gone (it is vertical) and Captions is on it. USER_GUIDE gives the order for a captioned vertical video: reframe, Edit in Video Studio, Transcribe, Burn into video. E2E: video-pipelines.spec.ts "reframe: the three positions are real state, and 9:16 comes out square-pixelled" (extended: the real reframe, then both branches of the question). Unit: the wiring pins. Red on the pre-round build: `the saved toast carries the action  Expected: visible`.
- **Video 4s CaptionsPanel - Save .srt, scope ([T-123], copy added):** "Save .srt" copies the whole transcript on the source's clock and sat directly under "Burn captions over selected clip range only". A sentence under the row says what the box does ("The box above only changes Burn into video. Save .srt keeps the captions for the whole video."), and the button is described by it (`aria-describedby`). E2E: the existing "with an SRT restored from a project file, every style control and Save .srt work" (the sentence visible, the button's accessible description equal to it, and with the range box CHECKED the saved file is still byte-identical to the whole transcript). The range-aware save through `writeKitSrt`'s shift is the ledgered upgrade.
- **Video 4r PostChecklist - the Posting log's platform chips ([T-123], new chip):** Facebook, between X and Twitch: the kit writes `*_facebook.mp4` and the log had no chip. E2E: video-pipelines.spec.ts "logging a post writes a posting-log entry to the settings store, and deleting it (after a confirm) takes it back out" (all seven toggles are multi-select and reversible; a Facebook post is logged, drawn in its row and stored as `['Facebook']`). Red: `Expected: "false"  Error: element(s) not found`.
- **Video 4r PostChecklist - the Logged posts rows ([T-123], layout):** the views / likes / comments boxes wrap (three `w-16` boxes were 337 px in a 274 px list, and "comments" sat off the edge behind a hidden scrollbar), and a pasted link in the notes wraps (`break-words`). E2E: video-pipelines.spec.ts "a logged post wraps its views / likes / comments boxes and its notes inside the list, at the default window and the minimum" (two entries, one with a long link; `expectNoHorizontalOverflow` on the list and the card, `expectControlsWhole` on every box and label). Red on the pre-round build: `the Logged posts list at the default 1632 px window scrolls sideways: its content is 337 px wide in a 274 px box. Past its edge: <label> "comments" +63px`.
- **Video 4b Player, 4e Timeline - the keys after a box is ticked ([T-123], end state changed):** a ticked "Crop guides" box stays focused, and the Player's keys (`,` `.` I O, the arrows) went dead; Space stays the box's. The Timeline's Playhead slider asks the same `focusOwnsKey`. E2E: video-core.spec.ts "player keyboard: a ticked Crop guides box keeps its focus and the Player's keys still answer, Space stays the box's". Unit: `keyOwnership.test.ts`.
- **Video - a crop that overshoots the frame by the validator's slack ([T-123], output changed):** an 800 px box in a 799.5 px parent (1.000625) made `crop=3842:2160:0:0` and refused the whole export. Layer 5: media.spec.ts "a crop that overshoots the frame by the validator's slack still exports" (the measured crop, a taller overshoot, the ceiling, an offset crop, Compile and GIF), on 7.0.2 and 6.1.1. Unit: `filters.test.ts`. DISPOSITION: the Export button is driven at Layer 5 through `runExportJob`; the crop rectangle's own drag is the existing CropOverlay rows.

### Audio Studio

- **Audio - Undo, Redo and `?` after a checkbox or a slider ([T-123], end state changed):** Ctrl+Z and `?` from a focused ticked box or a moved slider are the studio's (a text field still keeps its own). E2E: audio.spec.ts "a ticked checkbox or a moved slider keeps its focus and still lets Ctrl+Z, Ctrl+Y and ? through" (the focus asserted to be on the box, so the trap is real; Space still toggles it). Unit: `useUndoRedoHotkeys.test.ts`, `HotkeyOverlay.test.ts`.
- **Audio - Cleanup's five strength buttons, Power-line frequency, Platform ([T-123], layout):** "Aggressive" was cut to "Aggress" (five equal columns); both selects poked past their card (by 3 and 19 px). The buttons take the width their label needs and share the row; both selects are `min-w-0`. E2E: audio.spec.ts "Cleanup and Levels draw every label whole and keep their selects inside the card, at the default window and the minimum" (each of the five buttons whole and inside, both selects inside, neither card scrolls sideways). Red on the pre-round build: `the Cleanup card at the default 1632 px window scrolls sideways: its content is 303 px wide in a 300 px box. Past its edge: <select> "60 Hz — US, Canada 50 Hz — mos" +3px`.
- **Audio - Levels, Manual gain ([T-123], copy added):** "Peaks above −1 dBFS are limited when you export, so a boost cannot clip." sits under the slider. E2E: audio.spec.ts "every Levels control writes through to the chain" (the sentence). The behavior is Layer 5's (below).
- **Audio - the waveform ([T-123], error path and ceiling added):** a file that opens but cannot be drawn (an ADPCM WAV) says "Couldn't draw this file's waveform. It may be damaged or in a format imagii can't read here. Re-export it as WAV or MP3 and try again." once (a failed `load()` makes wavesurfer emit `error` twice; the toast has an id), and the transport that needs the picture stays off; a file over 2 hours is refused at load by every route to `loadSource` (the importer, Clean audio, a restored project) in a sentence naming the ceiling and the reason. E2E: audio.spec.ts "a file the waveform cannot be drawn for says so, once, in a finished sentence" (an ADPCM WAV), "a waveform whose file cannot be read says so once too, though wavesurfer reports it twice" (the page's `fetch` refuses the app's file protocol) and "a file longer than two hours is refused at load, naming the ceiling, and the studio never holds it" (a 58 MB, 2 h 1 s WAV; no "Loaded", no waveform, no export, and a short file is taken on the same drop zone straight after). Unit: `audio.test.ts`. Red on the pre-round build: `Received array: ["Loaded"]`. DISPOSITION: the ceiling is a marked simplification (T-110(ao)); a real 3 to 6 h decode is not run (that is the failure it prevents). **Superseded by T-129 (round 78, below): the ceiling is retired, the waveform is main's peaks, and these cases were flipped or replaced.**
- **Audio - Export, a single track's peaks and a mono file's loudness ([T-123], output changed):** a chain with any stage ends in the mix bus's limiter (-1 dBFS), a bare chain is the file that went in, and Even volume on a mono source lands on its label on the dual-mono meter (-16, where it landed at -13). Layer 5: media.spec.ts "a single-track export answers for its peaks and its loudness label" (seven cases on real output), and the two existing loudnorm cases re-pointed to the dual-mono meter. Unit: `singleTrackTail.test.ts`, `chain.test.ts`. DISPOSITION: the Export button's save dialog is stubbed in the existing E2E rows; what the bytes are is Layer 5's.
- **Audio - Re-attach to video with cuts, an AVI source ([T-123], output changed):** `settb=AVTB` ahead of `setpts` keeps a survivor on its own timestamp when the stream's time base is 1/fps. Layer 5: "an AVI source (stream time base 1/fps) with cuts that are not frame-aligned", red on the BUNDLED 7.0.2 (`pts_time written twice: 3.291667`), green on both majors. Unit: `chain.test.ts`.

### Stream Graphics

- **Image - the tool keys after Snap is ticked ([T-123], end state changed):** R, Delete and Ctrl+Z work with the Snap box (or a slider) focused. E2E: image.spec.ts "tick Snap and R still switches the tool, Delete still removes the layer, Ctrl+Z still brings it back" (the existing select case, "a focused select owns the keys", still holds).
- **Image - Toolbar Grid size and a text layer's Size ([T-123], end state changed):** the two boxes are `DraftField`s (an emptied box stays empty; 40 is 40, not 240), clamped when typing ends. E2E: image.spec.ts "the grid size and a text layer's Size take typed digits, and are held to their range when typing ends".
- **Image - Properties panel, the Rotation row ([T-123], layout, HIGH):** the row (label, box, seven presets: 406 px) was clipped behind the column's hidden horizontal scrollbar at every window size ("0" and "15" of seven at the default window); it wraps. E2E: image.spec.ts "the Properties column has no sideways overflow and all seven rotation presets are on screen, at the default window and the minimum" (a text layer and a rectangle, each at both sizes; the 270 preset then sets the angle). The existing "all seven rotation presets" case clicks them with `click()`, which scrolls them into view, and stayed green throughout. Red on the pre-round build: `the layers and Properties column at the default 1632 px window (a text layer) scrolls sideways: its content is 406 px wide in a 260 px box. Past its edge: <div> "0 15 30 45 90 180 270" +146px; <button> "270" +146px`.
- **Image - Variants, a single Save ([T-123], end state changed):** says "Saved <name>" after the file is written and nothing when the dialog is canceled (it was the one save with no word of success). E2E: image.spec.ts "variants: generate four tiles, save one, regenerate, save all" (a saved one toasts with the chosen name; a canceled one says nothing). Unit: T-91's pin (the null check, then the toast).

### References

- **References - Mood Boards, the "Clear thumbnail cache" tooltip ([T-123], words changed):** "Clear the on-disk thumbnail cache for mood boards" (it said "Drop", the app's drag-and-drop verb). E2E: references.spec.ts "Clear thumbnail cache empties the cache under the budget too" (the title attribute). Unit: `docClaims.test.ts`.
- **References - the rename dialog's scrim ([T-123], end state changed):** a drag that began in the dialog and ended on the scrim no longer closes it or discards the typed name; a plain click on the scrim still closes. E2E: references.spec.ts "a drag that starts inside the dialog and is released on the scrim neither closes it nor loses the typed name; a plain click on the scrim still does". The fix is in `Modal`, so every dialog has it (Templates, Variants, the Fix wizard, the Custom preset manager, the shortcuts overlay, NameDialog); the NameDialog case is the one that loses something.

### Not an element, but covered

- **Main's progress reports** go through `sendIfAlive`; closing the window mid-export no longer raises the main-process error dialog. Unit: `closeMidJob.test.ts` (each real handler, a dead sender in two shapes), `sendIfAlive.test.ts`, `progressSendsGuarded.test.ts` (the grep for siblings, kept). DISPOSITION: the real window close mid-export (3 of 40) is a timing the box cannot reproduce on demand; the destroyed sender is the same fault.
- **`recording:begin`'s cap** holds under concurrency (twelve begins at once open four). Unit: `recordingStream.test.ts`.
- **A crashed renderer** is reloaded to Home, once. E2E: home-chrome.spec.ts "T-123 (15) a renderer that dies is reloaded to Home and the autosave is offered again; a second death at once is left, not looped" (`webContents.forcefullyCrashRenderer()`, beside T-35's ErrorBoundary case). Unit: `rendererRecovery.test.ts`.
- **The no-emoji guard** reads `.html` and `.css` as well as `.ts` and `.tsx`; `emojiGuard.test.ts` runs it on an emoji in the page and the stylesheet and fails on a file type it does not read. A temporary emoji in `src/renderer/index.html` failed the script before this round and now fails it.
- **`tests/unit/docClaims.test.ts`** holds the claims the twelfth pass found false against the code they describe: the toast durations (against the installed react-hot-toast), the autosave banner's words, the never-say terms, the 800 px cap, the black washes, the tooltip's verb, the timing comments.
- **Docs:** the cites in `image.spec.ts` are re-pointed against the final tree (`ImportPanel.tsx:71`; `ImageStudio.tsx`'s and `index.ts`'s moved with this round's own edits), and so is every other cite this round's edits moved (the script that found them is in the hand-back); the seam comments say the bound is per cut and additive.

### Closed from round 72's "Found, not fixed"

None. (The reframe's Left and Right strips, the overlay fonts' CJK coverage, (ak), (al), (g) and (ai) are owner decisions or capability calls and stay open.)

### Found, not fixed

Ledgered with the round and not fixed, as the ticket said:

- **SAR geometry** (a 720x480 source with a 32:27 sample aspect ratio exports squeezed and cropped) extends (h). **The renderer's dependencies in the asar** extends (ai). **The primary-gain cancellation** extends (ag). **The waveform peaks pipeline** is new, (ao): a real fix retires the 2 hour ceiling. **The Chromium cache's clear-versus-no-store call** is new, (am): this round only discloses it. **The 9:16 watermark inset** (20 px flat, under the caption rail of the vertical files the kit exists for) is new, (an). `validateExportJob` does not gate `outputFilename` (the renderer sanitizes; defense in depth) is noted. Kit `MAX_PATH` on long names and whisper.cpp's win32 ANSI argv join the owner hand-check list.
- **The Posting log's three stat boxes** still read `Number(typed) || 0` (T-123 (4) names seven boxes whose default is not 0); with a default of 0 an emptied box then typed digits reads "05", which is 5, so the shape does no harm there. Left as it was.
- **The layout assertions run in Xvfb at 1x** at two window sizes; a HiDPI display is not driven.
- **"Edit in Video Studio" on the Reframe toast** is there only for a source wider than tall, because the Reframe panel is.

## Dispositions — round 74 (T-124: the review gate's thirteenth pass)

Thirty-three findings from sweep 13 (the Stream Graphics canvas, the output folders, the 9:16 strip, the re-attach toast, the cut grid). Every behavior change was red-first against the round-73 build or with the fix mutated out (the quotes are in `LESSONS_LEARNED.md`, 2026-10-15). A change to an interactive element carries its row here.

### Record

- **Record - the screen ending under a take that has the microphone on ([T-124], state changed):** closing the captured window ends the take and starts the save, with the mic on or off. `MediaRecorder` stops only when ALL of its tracks have ended and the microphone's outlives the screen, so the old take counted REC over a frozen frame. `watchScreenEnd` listens for `ended` on the screen's own video track after the phase is `recording`, and `stopAllStreams` takes the listener off. E2E: record.spec.ts "the captured window closing ends a take that has the microphone on, and saves it (T-124 (1))", "with the webcam in the take, the captured window closing still ends it: the listener is on the screen the compositor draws, not on its canvas (T-124 (1))", "a window that closed while the start was still opening ends the take the moment it begins (T-124 (1))". Native boundary: the OS fires `ended` when the real window closes; the test dispatches the event on the track the recorder was given, and `track.stop()` (which does not fire it) is not what the test uses. Unit: `interactionWiring.test.ts` "a take ends when the screen does".

### Home

- **Home - the Autosave banner, both of its notices ([T-124], state changed):** the restore offer AND the damaged-file notice are shown only over a session that holds no work (`sessionHoldsWork()` is `hasStudioState(captureProject())`, the autosave gate's own definition, asked once per mount), so going Home mid-session no longer offers a restore that would land on top of what is open. E2E: home-chrome.spec.ts "T-124 (5) the autosave is offered on launch, and not again over the work you are doing: edit, go Home, no banner", "T-124 (5) a damaged autosave is announced at launch, not over a session that has work in it". Unit: `projectValidation.test.ts` (`hasStudioState`), `ProjectIO.test.ts` (`sessionHoldsWork`), `interactionWiring.test.ts` "the autosave banner is not shown over a session that holds work".
- **A crashed renderer - the reload ([T-124], end state changed; extends the round-73 row below):** the window loads the entry again (`loadEntry`, the loader `createWindow` uses) instead of `webContents.reload()`, which kept the URL's hash: a crash inside a studio came back inside it, and the guide said Home. The dead page's open recording sessions are abandoned (partial `.webm` removed, cap slot released). E2E: home-chrome.spec.ts "T-124 (2) a renderer that dies inside a studio is reloaded to Home, with the autosave offered, not into the studio it died in", "T-124 (3) a crash mid-take leaves no recording session behind: the temp webm is removed and a new take can begin". Unit: `recordingStream.test.ts` (`abandonOpenRecordingSessions`: open sessions go, a closed one stays, the count, the file), `interactionWiring.test.ts`.
- **The window's size and position - the write ([T-124], failure path added):** `persistWindowBounds` never throws (a read-only or full `userData` made every `resize` and `move` an uncaught main-process error); it warns on the console and the app carries on. Unit: `windowBounds.test.ts` (a write the file system refuses, a window that dies between the check and the question, a gone window, and that the next write after a failed one still goes through). A real read-only disk is covered by the probe in the round's scratch (`chattr +i` on the config file: uncaught before, one warning after); an Electron window on a read-only volume is not driven by the suite.

### Video Studio

- **Video 4b Player, 4e Timeline - the O, I, `,` `.` and arrow keys with a modifier held ([T-124], end state changed):** Ctrl, Alt or Cmd makes the key a chord, which the handlers leave to the window; Ctrl+O set an Out point and was swallowed by `preventDefault`. E2E: video-core.spec.ts "Ctrl+O, Ctrl+I, Alt+. and Alt+ArrowRight are chords, not the O, I, . and arrow shortcuts: from the Player and from the Playhead slider they move nothing, and the bare O still sets the Out point (T-124 (29))" (both focus paths, and the bare O as the control). Unit: `keyOwnership.test.ts` (`hasChordModifier`).
- **Video 4k ReframePanel - the strip ([T-124], output changed):** the 9:16 file is cut from the clip's crop (when one is drawn) and runs at the clip's speed, sound included, through the shared builders (`cropToFrame`, `buildAudioSpeedFilter`); the progress denominator is the range over the speed. E2E: video-pipelines.spec.ts "reframe: the crop and the speed set for the clip reach the 9:16 file ..." (a 1:1 crop at 2x: no red block, one second, 1080x1920 square pixels; the uncropped 1x control keeps the red and both seconds). Layer 5: media.spec.ts "a reframed clip keeps its crop and its speed (real ffmpeg, T-124 (16))" (four cases, green on 7.0.2 and 6.1.1; red with either stage mutated out, on both). Unit: `reframe.test.ts`, `videoReframePayload.test.ts` (the payload is checked at the boundary: crop, then speed).
- **Video 4k ReframePanel, 4l GifPanel - the file's name ([T-124], name changed):** named for the video the person opened (`stream_reframe-1080x1920-center.mp4`, `stream_480px_15fps.gif`), not for the converted working copy it is played from (`stream-aB3dE5fG_...`). E2E: video-pipelines.spec.ts "reframe and GIF are named for the video the person opened, not for the working copy a converted import is played from (T-124 (17))".
- **Video 4k, 4l, 4m, 4n - the output-folder button and what Reframe, GIF, Compile and Picture-in-picture do with no folder chosen ([T-124], state changed):** the button shows the folder the last file of any of the four went to (one shared key, `video.lastOutputDir`, read at mount and again when the action is pressed), a press with nothing chosen uses it without opening a chooser, a canceled chooser starts nothing and remembers nothing, and a stored value that is not a usable absolute path is ignored. The chooser opens on the current folder. E2E: video-pipelines.spec.ts "GIF, Compile, Reframe and Picture-in-picture start on the folder the last export went to: the button shows it, no chooser opens, and the file lands there (T-124 (21))", "a folder one panel finished with is the next panel's without asking, a canceled chooser remembers nothing, and a stored value that is not an absolute path is ignored (T-124 (21))"; the existing `output-folder buttons` case (the empty state) is unchanged and green. Native boundary: the real folder dialog, replaced in main by a recorder that counts which kind of chooser was asked for. Unit: `settingsKnownKeys.test.ts` and `settingsClear.test.ts` (the key is a known setting), `interactionWiring.test.ts` "the GIF, Compile, Reframe and Picture-in-picture panels start from the folder the last file went to".
- **Video 4q TextOverlayEditor - the Time boxes, the position boxes and the card ([T-124], end state, copy and layout changed):** the x and y boxes are `DraftField`s held to 0..1 (".5" is 0.5, not 1); the Time boxes are labelled "Source time" and a window that misses the clip is flagged in a `role="status"` sentence naming the range the clip covers; the card says "Text appears in the exported file, not in the player. Times are seconds in the source video."; the controls are one column, each row wrapping, the remove cross beside the caption (it sat 12 px outside the card). E2E: video-core.spec.ts "text overlays: the position boxes take a leading decimal (.5 is 0.5, not 1), and a typed number is held to 0 to 1 (T-124 (15))", "text overlays: the Time boxes say they are source time, a window that misses the clip is flagged, and the card says nothing previews it (T-124 (18), (19))", "the Text overlays card draws every control whole, on one line and over nothing else, at the default window and the minimum (T-124 (23))". Unit: `textOverlay.test.ts` (`overlayOutsideClipMessage`).
- **Video 4e ClipList - the Speed slider ([T-124], copy added):** "Speed is applied when you export. The player here always plays at normal speed." (the player has no live speed). E2E: video-core.spec.ts "the clip speed says it is applied when you export, and that the player plays at normal speed (T-124 (19))".
- **Video - Clean audio, on a video over two hours ([T-124], failure path added):** refused at the button on the probe the open video already carries, before the replace question and before any ffmpeg: "Export the part you want from Video Studio first, then open that shorter file." (the audio-only sentence says to split the file in another app). E2E: video-pipelines.spec.ts "Clean audio on a video longer than two hours is refused at the button: no question, no extraction (T-124 (6))". Unit: `shared/audio.test.ts` (`waveformCeilingRefusal`'s two sentences), `interactionWiring.test.ts` "the 2-hour gate is asked where the length is known". **Superseded by T-129 (round 78, below): Clean audio on a long video extracts and opens.**

### Audio Studio

- **Audio - the importer's drop of a video over two hours ([T-124], failure path added):** `audio:extractFromVideo` probes first and refuses before ffmpeg is spawned (a 3 h video used to be extracted to a multi-gigabyte WAV in `%TEMP%` and only then refused). E2E: audio.spec.ts "a video longer than two hours is refused before any sound is extracted: no ffmpeg, no WAV in %TEMP% (T-124 (6))" (the spawn log has no ffmpeg; the temp folder gained nothing). Unit: `audioExtractCeiling.test.ts` (the handler, with a probe stub, never reaches the extractor). **Superseded by T-129 (round 78, below): the long video is extracted and opens.**
- **Audio - Export, "Re-attach to video", the saved toast ([T-124], new element):** "Cleaned audio attached to the video" carries **Show in folder** and **Edit in Video Studio** (the same two buttons Record's take has, through `useEditInVideoStudio`, which asks before it replaces the video being edited); an audio-only export's toast is unchanged and has neither. E2E: audio.spec.ts "the re-attach toast names the file, shows it in its folder, and opens it in Video Studio; an audio-only export offers no video to open (T-124 (20))" (Show in folder reaches the shell with the file; Edit in Video Studio lands on `#/video` with `e2e-clip-cleaned.mp4` in the header and the player mounted); the T-90 re-attach case reads the toast as "the sentence, then the buttons". The ask-before-replace branch is covered by Record's and Reframe's cases through the same hook.
- **Audio - the side column, and the Fix Wizard's toast ([T-124], copy added and changed):** "Changes here are applied when you export. The player plays your original sound." sits above the panels, and the wizard's confirmation says "Cleanup configured. It is applied when you export, so tweak it from the side panels if needed." E2E: audio.spec.ts "the side column says its changes are applied when you export, and the player keeps playing the original sound (T-124 (19))"; the wizard cases that quote the toast (audio.spec.ts, home-chrome.spec.ts) are updated to the new sentence.
- **Audio - Levels, Manual gain, the sentence under the slider ([T-124], copy changed; extended by [T-125] (15), see round 75):** "When you boost or switch something on, peaks above −1 dBFS are limited in the export, so a boost cannot clip. With nothing switched on, the export keeps your levels as they are." The round-73 sentence was unconditional and false for the export that changes nothing (a bare pass-through has no limiter by design). E2E: audio.spec.ts "every Levels control writes through to the chain" (the sentence, and the old one is gone). Unit: `docClaims.test.ts` (the panel, README and USER_GUIDE say the same condition, against `process.ts`).
- **Audio - Cleanup, the Power-line select, and the custom noise sliders; Levels, the Platform select ([T-124], layout and label changed):** the Power-line row stacks its label above a full-width select; "60 Hz — US, Canada" is shown whole; the Platform option reads "YouTube, TikTok, Reels (−14)" (the 210 px label was cut in a 176 px select; the hint line under it still names Spotify); each custom slider's readout is one line on the label's row. E2E: audio.spec.ts "Cleanup and Levels draw every label whole and keep their selects inside the card, at the default window and the minimum (T-123 (25), (27))" (now measures the selected option of each select), "the Custom noise sliders keep their readouts on one line and the row the same height from end to end of the slider (T-124 (25))".
- **Audio - an export with cut regions ([T-124], output changed):** a cut lands within one 256-sample block (5.3 ms), whatever block the decoder hands over; a FLAC source's cuts were up to 60 ms off and an ALAC's 77 ms (and a WAV's 77 ms on the bundled 7.0.2). Layer 5: media.spec.ts "a cut is accurate to a 256-sample block, whatever block the decoder hands over (real ffmpeg, T-124 (32))" (WAV, FLAC and ALAC through the real export, six cuts each; red with the re-chunk removed, with it set to 1024, or placed after the select; on 7.0.2 and 6.1.1). The re-attach cases keep their cut-survivor checks, with the tail allowance derived from the grid (`maxTailFrames`). Unit: `chain.test.ts`, `singleTrackTail.test.ts` (the stage and its place).

### Stream Graphics

- **Image - the selection frame (Transformer) on an imported picture, and after Select ([T-124], end state changed; revises the round-26 "Selection/Transformer" disposition above):** an imported picture gets resize and rotate handles like a shape; pressing Select (or `V`) right after drawing puts the handles on the selected layer without another click; a locked layer has none. E2E: image.spec.ts "an imported picture gets resize handles, and in a mixed canvas the handles follow what is selected (T-124 (8))", "draw a shape, then press Select: its handles are on it without another click (T-124 (9))", "a locked layer has no handles to resize or rotate it with; unlocking brings them back (T-124 (13))". The existing LayerPanel lock case (a locked drag is refused byte-equal) is unchanged.
- **Image - a draw gesture released outside the canvas ([T-124], state changed):** the button released over the toolbar, the page or the OS ends the draw: the shape is kept and the preview is gone (the Stage's own `mouseup` never fired, so the preview stuck to the pointer). E2E: image.spec.ts "releasing the button outside the canvas finishes the draw: the shape is kept and the preview is gone (T-124 (10))".
- **Image - the Line tool ([T-124], end state changed; revises "line 4 points" above):** a horizontal or vertical line draws (the gate is the line's length, not the larger of its box sides, so a straight line is not "under the floor"), a plain click still draws nothing, and a thin line can be resized from its frame (the Transformer refuses only a shrink below 5 px). E2E: image.spec.ts "the Line tool draws a horizontal and a vertical line, and still refuses a click (T-124 (11))".
- **Image - Snap, a dragged picture ([T-124], end state changed):** a dragged picture snaps to the grid the way a shape does, and a drag shorter than half a cell snaps back. E2E: image.spec.ts "Snap quantizes a dragged picture the way it does a dragged shape, and a drag shorter than half a cell snaps back (T-124 (14))".
- **Image - Properties, x / y / Rotation ([T-124], end state changed):** the three boxes are `DraftField`s (a minus sign can be typed, what is typed is kept until typing ends), held to `layerOffsetRange` (−1× to 2× the document) and ±360° when it ends. E2E: image.spec.ts "the x, y and rotation boxes take a minus sign and keep what is typed (T-124 (15))".
- **Image - Properties, the seven rotation presets ([T-124], a11y changed):** announced as "Rotate 45 degrees", not "45"; the visible text stays the number. E2E: image.spec.ts "every shape field, all seven rotation presets, and the opacity readout" (the name and the text) and "the Properties column has no sideways overflow and all seven rotation presets are on screen, at the default window and the minimum" (the 270 preset by its new name).
- **Image - the tool keys with Ctrl, Alt or Cmd held ([T-124], end state changed; revises "Ctrl+V-is-not-Select" above):** Ctrl+R, Ctrl+O, Ctrl+L, Ctrl+P (and the same with Alt or Cmd) leave the tool alone; the bare letters switch it. E2E: image.spec.ts "Ctrl, Alt or Meta held makes a tool key a chord, not a tool switch: ... (T-124 (29))" (the keydown is dispatched: a real Ctrl+R is the app menu's Reload). Unit: `keyOwnership.test.ts`.
- **Image - the Layers panel rows ([T-124], layout changed):** the name is cut with an ellipsis inside its own button (it painted over "Move layer up"), the hint tag takes at most two lines, and the four action buttons drop to their own line when the row is narrow. E2E: image.spec.ts "a layer name is cut with an ellipsis inside its button, never painted over the row's buttons, and the hint tag takes at most two lines (T-124 (12))" (both window sizes, with `expectNoOverlap`).

### Not an element, but covered

- **Every outbound network site** is held against an allowlist: three destinations (DuckDuckGo for a typed search, Hugging Face for the caption model - the download follows the server's 302 to Hugging Face's own CDN, which is the same destination - and GitHub for a link the person clicks). Unit: `networkAllowlist.test.ts` (an AST scan of the `.ts` and `.tsx` under `src/`, to eight levels, with a test that fails if any other code file or a deeper one appears; red with a `fetch`, a `WebSocket`, an `import https`, an `<img>` in a new file, a second `fetch` in an allowlisted file, and a CSP `connect-src https:`). What the scan cannot see is the PLATFORM's own traffic: that is read from a net-log of the built app (round 77, T-127 (1)).
- **The `%TEMP%` disclosure** (`imagii-audio`, `imagii-import`, `imagii-concat`, pruned at the next launch when 6 hours old) is stated beside every "deleting that folder clears everything imagii keeps there". Unit: `docClaims.test.ts`.
- **Docs:** every cite in `image.spec.ts` and every `file:line` the round's edits moved is re-pointed against the final tree (`docClaims.test.ts` holds the table).

### Found, not fixed

Ledgered with the round and not fixed:

- **The 48 kHz resample sits after the limiter.** The export is written at 48 kHz (`-ar 48000`) and the resampler is the last stage, so a 44.1 kHz source's -1 dBFS limit is not the file's peak: a cut's seam (two phases of a sine butted together) rings in the resampler, and 11 of 24 cuts of a hot 44.1 kHz tone peaked above -0.9 dBFS (to 0.0) on the decoder's block grid, 6 of 24 on the 256-sample one (T-124 (32) did not create it; it changed where the seams land). The Levels sentence and the README say what the LIMITER does. The fix is an `aresample` ahead of the limiter or a true-peak stage, which is a chain change with a Layer 5 case and a product call (an extra resample for every non-48 kHz export).
- **Seven Layer 5 cases fail on the distro's ffmpeg 6.1.1 and always did** (confirmed on the round-73 tree): the four `KNOWN linux-binary gap` pins (the distro build HAS `drawtext`; the pins assert the bundled binary does not), the GIF frame-rate read (`25/2` where the case expects `12/1`), the text file the `ansi` demuxer claims as video, and the mpegts convert-crash pin. They are platform pins for the bundled linux binary, not defects; the win32 binary is the one that ships.
- **A real Ctrl+R in the packaged app** is Electron's default menu (View > Reload), because main sets no application menu: the page loses its state (the autosave and the banner are the answer) and no handler of ours sees a keydown it could refuse. T-124 (29)'s E2E dispatches the keydown, since pressing it would reload the page under the test. Not driven; a menu decision for the owner.
- **`hasChordModifier` reads AltGr as a chord** (Ctrl+Alt on Windows): a layout that types one of V R O L P I O through AltGr stands the shortcut down. Marked `// simplification:` with the upgrade (`getModifierState('AltGraph')`).

## Dispositions — round 75 (T-125: the review gate's fourteenth pass)

Twenty-seven findings from sweep 14 (the compilation join, the 9:16 strip, the output folders, the overlay editor, the allowlist guard) and the docs that ride along. Every behavior change was red-first against the round-74 build (the pristine-build pattern) or with the fix mutated out; the quotes and the mutation ledger are in `LESSONS_LEARNED.md`, 2026-10-15 (T-125). An element this round changed carries its row here.

### Record

- **Record - the microphone ending under a take ([T-125] (25), state changed; the mirror of the screen's end above):** a microphone that goes away mid-take (a headset pulled, a wireless one out of range) ends its audio track and nothing else: REC kept counting over a silent take and nothing said so. `watchMicEnd` listens for `ended` on the mic's audio track after the phase is `recording` and toasts once, in the 8 s error style, "The microphone stopped. The rest of this recording has no sound from it."; the take is NOT ended (the picture is worth keeping; the screen's own end is what `watchScreenEnd` is for), and `stopAllStreams` takes the listener off. E2E: record.spec.ts "a microphone that drops mid-take is announced once, the take carries on, and it still saves (T-125 (25))" (told once, REC still counting, Stop still there, the file saves with its picture, not told again by the save) and "a take with a working microphone that is stopped by the person says nothing about the microphone (T-125 (25))" (the negative). Native boundary: the OS fires `ended` when a device goes away; the test dispatches it, as the screen's does (`stop()` from script does not fire it).

### Home

- **The crash screen - "Reload to Home" ([T-125] (21), copy changed):** "Your work is still open in its studios, and imagii saves it every few seconds. Reload to Home to carry on." It said "most of it should be waiting on the Home screen", which the button never made true (it changes the hash and rebuilds no store, so the restore banner is rightly not shown and nothing "waits" on Home). E2E: home-chrome.spec.ts "ErrorBoundary: a real render throw shows the fallback, the stack expands, and Reload to Home recovers (T-35)" (the sentence, and no "waiting on"), "ErrorBoundary: after Reload to Home the work is still open in its studio, and no restore banner is offered over it (T-125 (21))" (a text layer on the Stream Graphics canvas, a real render throw, Reload to Home, the layer is still there and the empty-state button is not). Unit: `interactionWiring.test.ts` (the copy, and that the button sets the hash and nothing else).
- **Toasts - the success and error marks ([T-125] (13), colors changed):** the tick and the cross are the palette's `ok-strong` and `danger-strong` (`TOAST_ICON_THEME`, BG_BASE glyphs at 10.08:1 and 7.20:1), not react-hot-toast's stock green and red. E2E: home-chrome.spec.ts "AutosaveRestore: Restore rehydrates the video and image stores" (the success disc is `rgb(52, 211, 153)`, not the library's `rgb(97, 211, 69)`), "AutosaveRestore: a clear that fails says so and leaves the banner and the file alone" (the error disc is `rgb(251, 113, 133)`, not `rgb(255, 75, 75)`). Unit: `designTokensInSync.test.ts`.
- **Every native control - checkbox, radio, range, scrollbar, select list, number spinner ([T-125] (13), colors changed):** one `:root` rule, `color-scheme: dark; accent-color: theme('colors.accent.DEFAULT')`, so they are drawn dark with the accent token instead of stock Chromium (blue ticks and sliders, light scrollbars). E2E: home-chrome.spec.ts "AutosaveRestore: Restore rehydrates the video and image stores" (the root's computed `colorScheme` is `dark` and `accentColor` is `rgb(255, 49, 49)`; both inherit to every control). Unit: `designTokensInSync.test.ts` (one `:root` rule, its two values, the accent being the buttons' token). No E2E asserts a screenshot (the specs write them, none compares), so the restyle breaks no pixel assertion; the drawn pixel of a native control is the browser's, and the computed property is the deepest layer the suite reads.

### Video Studio

- **Video 4k ReframePanel - the strip, its readout and its words ([T-125] (9), output and copy changed; revises the round-74 row above):** the 9:16 picture is `buildVideoFilter` at the 9:16 frame with only the aspect stage swapped for the strip, so a grade, text overlay, Auto Zoom and Hype Shake set for the clip reach the file (round 74 sent the crop and the speed and called the rest "out matching Compile", which was false: Compile sends all four). The header reads the size of the CROP the strip is cut from; the sentence says "…with the clip's crop, speed, color, text and effects. It takes a fixed strip — it does not track faces or action." E2E: video-pipelines.spec.ts "reframe: the header reads the crop's size, not the source's, and the panel says the clip's look is used (T-125 (9))", "reframe: the color set for the clip reaches the 9:16 file (T-125 (9))" (a graded clip's frame is measurably not the ungraded one's). Layer 5: media.spec.ts "T-125 (9)" (a clip with a grade, a text overlay, Auto Zoom and Hype Shake, measured; the text case on 7.0.2 through a stand-in because the bundled static build has no `drawtext`, and for real on 6.1.1; the strip's even dimensions and `setsar=1` kept). Unit: `reframe.test.ts`, `filters.test.ts`, `videoReframePayload.test.ts` (the whole recipe is checked at the boundary), `truthInCopy.test.ts`.
- **Video 4k, 4l, 4m, 4n - the four output-folder buttons ([T-125] (10), state, failure path and end state changed; revises the round-74 row above):** they are ONE value now (a module store): a pick in one shows in the other three at once, within the visit. A remembered folder that no longer exists is ignored at the main-side read (the guide already promised it; it used to be seeded, written into, and blamed on "a file imagii needs"), the chooser opens on it only if it exists, a folder chosen and then deleted is made again by every runner, and one that cannot be made is refused in a sentence that names it, before anything is encoded (Compile used to run its whole segment encode first). E2E: video-pipelines.spec.ts "a remembered folder that no longer exists is ignored by all four buttons, and the action opens the chooser (T-125 (10))", "a pick in one of the four panels is the other three' folder at once (T-125 (10))", "a folder deleted after it was chosen is made again; one that cannot be made is named, before anything is encoded (T-125 (10))" (the spawn log is empty for the unmakeable one); the cases that pressed **Choose folder…** in each panel in turn now assert the later panels already show the folder (`expectFolderShown`). Layer 5: media.spec.ts "T-125 (10)" (the runner against a real missing parent). Unit: `settingsFolders.test.ts`, `useVideoOutputDir.test.ts`, `outputPath.test.ts`, `concatRunner.test.ts`, `videoPickOutputDir.test.ts`, `settingsClear.test.ts`.
- **Video 4k, 4l, 4m, 4n, 4c - the output-folder chip, with a long name ([T-125] (11), layout changed):** the chip is capped (`max-w-[9rem]`), the name ends in an ellipsis and the full path is the tooltip; a long remembered folder pushed the primary button out of the card (to 668 px of content in a 298 px card, the primary button 370 px past the edge). E2E: video-pipelines.spec.ts "a long remembered folder name ends in an ellipsis and pushes no button out of any card, and the picture-in-picture card shows its whole Position select (T-125 (11), (12))" (all five cards, both window sizes: `expectNoHorizontalOverflow`, `expectControlsWhole`, and `expectEllipsized` for the clipped, ellipsized, nowrap name with its tooltip). The accessible name ("Output folder: <whole name>") is unchanged: video-pipelines.spec.ts "each of the five says what it is to a screen reader".
- **Video 4n PipPanel - the Position select and the labels ([T-125] (12), layout changed):** two boxes to a row and the select on a row of its own (in three columns "Bottom right" showed as "Bottom rig" and "Overlay width (px)" wrapped onto two lines). E2E: the same case (every option of the select through `expectSelectsWhole`, and the labels through `expectOneLine`, at both window sizes).
- **Video 4q TextOverlayEditor - Size and the label column ([T-125] (16), label and layout changed):** "Size (px)" (the Picture-in-picture boxes and the preset manager already said "(px)"); the label column is `w-14` so the longer word stays one line. E2E: video-core.spec.ts "the Text overlays card draws every control whole, on one line and over nothing else, at the default window and the minimum (T-124 (23))" (the label by its text, and every label on one line); image.spec.ts "the grid size and a text layer's Size take typed digits, and are held to their range when typing ends" (the Properties panel's own "Size (px)" is one line, and the field is found by it).
- **Video 4q TextOverlayEditor - the Source time row ([T-125] (17), (23), (27), end state, layout and accessible names changed):** the arrow, the end box and "s" wrap together; both boxes are text boxes that take seconds, `m:ss` and `h:mm:ss` ("1:30", "2:47:13", "1:00:01.5") and refuse anything else in a sentence under the box ("imagii could not read that time. Use seconds like 90.5, or a time like 1:30 or 2:47:13."), keeping the text for the person to fix; a field of 60 or more beside a bigger unit ("1:75") is refused. Every overlay field's accessible name begins with the text drawn beside it (WCAG 2.5.3): "Source time, start (seconds in the source video)", "Source time, end (...)", "x / y, horizontal position (0 to 1)", "x / y, vertical position (0 to 1)". E2E: video-core.spec.ts "text overlays: the Source time boxes take 1:30 and 2:47:13, refuse what is not a time, and every field is named by the text beside it (T-125 (23), (27))", "the Source time row keeps the arrow with its end box and its "s", at the default window and the minimum (T-125 (17))"; the cases that located the boxes by their old names are updated. Unit: `clockTime.test.ts`, `textOverlay.test.ts` (the refusal sentence and that its examples parse), `a11ySweep.test.ts`, `interactionWiring.test.ts`.
- **Video 4q TextOverlayEditor - the sentence for a window of no length ([T-125] (14), copy added):** "This text won't show in the export: its start and end are the same, so it never shows." for an overlay whose end was clamped to its start, inside the clip or outside it (it was given "its times fall outside the clip", false for one inside it). E2E: video-core.spec.ts "text overlays: the Time boxes say they are source time, a window that misses the clip is flagged, and the card says nothing previews it (T-124 (18), (19))" (zero-length inside the clip, zero-length outside it, a window with length back to the clip sentence, and a window that meets the clip to none). Unit: `textOverlay.test.ts`.
- **Video 4q, 4e, 4b - every box that takes a number: the overlay x / y, Size, Time, Color; Properties' x / y / Rotation; PiP width; the preset manager ([T-125] (8), end state changed; revises "DraftField" above):** while a box has focus it shows what was TYPED, even after a live commit, and shows the stored number when it is left. Handing the box back to the stored value on every usable keystroke made React rewrite a number input whose DOM value reads "" for "0." and "-": "0.05" arrived as 1, "-0.5" lost its sign. E2E: video-core.spec.ts "text overlays: the position boxes take a leading decimal (.5 is 0.5, not 1), and a typed number is held to 0 to 1 (T-124 (15))" (now also "0.05", and the typed text while focused), image.spec.ts "the x, y and rotation boxes take a minus sign and keep what is typed (T-124 (15))" (now also "-0.5"). Unit: `interactionWiring.test.ts` (the live commit keeps the draft; `finish` does not commit the same text twice).
- **Video - times past an hour: the Timeline, the clip list, the player, the highlight lists ([T-125] (23), copy changed):** a time from one hour up reads `h:mm:ss` ("1:01:40.0", not "61:40.0"); under an hour every readout is the string it always was. E2E: video-pipelines.spec.ts "a video over an hour reads its times as h:mm:ss in the Timeline, the clip list and the player (T-125 (23))" (a 3700 s video: In, Length, Out, the clip's name, the player's position and length, and the playhead at 59:59.0 and 1:00:00.0). The highlight and captions lists use the same helper (`clockTime.ts`); their rows need a scan of a loud hour and a transcript and are held by the wiring pin that no panel keeps its own formatter (`interactionWiring.test.ts`) and by `clockTime.test.ts`, not driven.
- **Video 4e ClipKitButton, and the Video tour ([T-125] (24), copy added):** the tour has a **Clip Kit** step after **Export** that points at the button (`data-tutorial="video-clipkit"`): "Select a clip and click 'Clip Kit' to export it for all five platforms, plus three thumbnails, into one new folder. The clip's captions join them as an .srt file, if it has any." E2E: video-core.spec.ts "the Video tour introduces Clip Kit after Export, and its highlight sits on the Clip Kit button (T-125 (24))" (the step follows Export; the accent outline is the button's box plus the 8 px pad). Unit: `tutorialCopy.test.ts` (the step, its place, the quoted name against the studio's source, the numbers against the button's tooltip), `tutorialTargets.test.ts`.
- **Video 4o ExportPanel - Export pressed twice in a breath ([T-125] (18), end state changed):** `startExport` claims `startingRef` before the settings writes it awaits and gives it back in a `finally` (the continue button of the safe-zone question goes through the same guard), so a fast double-click starts one batch and the queue reads truthfully (it read Failed and Not run beside a batch that was running). E2E: video-pipelines.spec.ts "a fast double-click on Export starts ONE batch and the queue shows it truthfully: no Failed row, no refusal, one file (T-125 (18))". Unit: `interactionWiring.test.ts` (the `singleFlight` finder).
- **Video - Clean audio, with Audio Studio open on something else ([T-125] (20), end state changed):** the extraction compares Audio Studio's source with what it held when the button was pressed (`replacedSince`); if the person opened something else meanwhile, nothing is loaded and nobody is taken there, and a toast says what was skipped. E2E: video-pipelines.spec.ts "Clean audio does not replace what was opened in Audio Studio while it was extracting, and does not pull the person back (T-125 (20))". Unit: `ProjectIO.test.ts` (`replacedSince`).
- **Video 4k, 4l, 4m - the files' names ([T-125] (22), name changed; extends the round-74 row above):** the compilation is named for the video the person opened (`name_compilation.mp4`, not `stream-aB3dE5fG_compilation.mp4`), and the GIF and the 9:16 file carry the clip's name after it (`name_Clip 1_reframe-1080x1920-center.mp4`), as Export's `{source}_{clip}` does; six highlights are six names and not "(2)" to "(6)". E2E: video-pipelines.spec.ts "reframe, GIF and compilation are named for the video the person opened (the clip's name after it, for the two that are one clip's), not for the working copy a converted import is played from (T-124 (17), T-125 (22))"; the cases that name a file are updated.
- **Video 4k, 4l, 4m - Reframe, GIF and Compile with a long line of work behind them: the compilation's join ([T-125] (1), output changed):** each segment is written as Matroska with uncompressed (PCM) sound and the join copies the picture and encodes the sound ONCE (AAC, 192 kbps): stream-copying AAC segments added 29.3 ms of silence per join (the encoder's priming and the edit list), so the sound drifted a third of a second behind the picture by the ninth clip. Layer 5: media.spec.ts "T-125 (1)" (an eight-join compilation: per-segment sound offset under 15 ms, on 7.0.2 and 6.1.1; red with the old join, with an AAC segment, and with the PCM write removed). Unit: `concatRunner.test.ts` (the segment's `.mkv` and `pcm_s16le`, the join's `-c:v copy -c:a aac -b:a 192k`, the list file, the fades untouched). The segments are unlinked in the runner's `finally` whatever their extension, so a cancel leaves none (Layer 5: "the scratch the compilation made is gone when it finishes, and when it is canceled"), and the next-launch prune takes `imagii-concat` by age, not by name (`tempCleanup.ts`; its comment now says Matroska).

### Audio Studio

- **Audio - Cleanup, "Quieter background": Light, Medium, Aggressive ([T-125] (3), output changed):** the three strengths remove progressively more noise (Light `nf=-35`, Medium `-30`, Aggressive `-25`; `afftdn`'s `nf` and `nr` point in opposite directions and the old table had them the other way round, so "Light" removed more than "Medium"). The Custom hint reads "-35 is the Light preset's setting." Layer 5: media.spec.ts "T-125 (3)" (the removed noise rises Light < Medium < Aggressive, on both majors). Unit: `chain.test.ts`, `audioStudioCopy.test.ts`. E2E: audio.spec.ts "every Cleanup control writes through to the chain".
- **Audio - the import and Clean audio: a sound's length and where it starts ([T-125] (2), (4), (6), output and failure path changed):** the extracted WAV is on the container's clock (`aresample=async=1:first_pts=0`), so a video whose sound starts late keeps it late; a recording whose header has no duration (a MediaRecorder WebM) imports, because the probe not reading a length is not a refusal (only "this video has no sound" is the probe's verdict); and the export's progress runs over the length that is kept (cuts and overlaps taken out), not the source's. E2E: audio.spec.ts "a recording whose header has no duration (a MediaRecorder WebM) imports: the probe not reading a length is not a refusal (T-125 (4))". Layer 5: media.spec.ts "T-125 (2)". Unit: `extract.test.ts`, `audioExtractCeiling.test.ts`, `exportProgress.test.ts`.
- **Audio - an export with cut regions: the block size after the cut ([T-125] (5), output changed):** the chain re-chunks to 4096 samples after the cut, so everything downstream of `aselect` sees the block it was written for. Layer 5: media.spec.ts "T-125 (5)" (the stage order and bit-identity). Unit: `chain.test.ts`, `singleTrackTail.test.ts`.
- **Audio - the importer and Export, with an AIFF or a WMA ([T-125] (7), end state changed):** a sound taken out of a file that is not a video (an AIFF, a WMA) is not "from a video": no **Re-attach to video**, the suggested name is the file's own, and a restored project agrees. E2E: audio.spec.ts "a WMA loads and exports as the sound file it is: no "Re-attach to video", named for the WMA, written (T-125 (7))". Unit: `ProjectIO.test.ts`, `audioExtractCeiling.test.ts`.
- **Audio - the re-attach's suggested name ([T-125] (22), name changed):** `fromVideo.convertedFrom ?? videoPath` (the original's name, not a converted working copy's). E2E: video-pipelines.spec.ts "reframe, GIF and compilation are named for the video the person opened ..." (the dialog suggests `stream-cleaned.mp4`).
- **Audio - Levels, Manual gain, the sentence under the slider ([T-125] (15), copy changed; revises the round-74 row above):** "When you boost, switch something on or cut a part out, peaks above −1 dBFS are limited in the export, so a boost cannot clip. Otherwise the export keeps your levels as they are." A cut alone is a stage (the chain is no longer a pass-through, so the limiter runs: a -0.3 dBFS file cut and nothing else exported at -1.2). E2E: audio.spec.ts "every Levels control writes through to the chain". Unit: `docClaims.test.ts` (the panel, README and USER_GUIDE), `singleTrackTail.test.ts`.
- **Audio - the Fix Wizard's Apply toast ([T-125] (19), duration changed):** held 8 s (`ACTION_TOAST_MS`), because it is the only place that says the cleanup waits for the export. E2E: audio.spec.ts "Fix Wizard reconfigures Cleanup and Levels, and resets on both exits" (still on screen 4.5 s after it appeared; a success toast is gone at about 3 s).

### References

- **References - the mood board's "→ Canvas", the note ([T-125] (19), duration changed):** "Added to canvas as a reference — it won't be in your export" is held 8 s. E2E: references.spec.ts "a saved item goes to the canvas as a 40% overlay, and Remove is undoable".

### Stream Graphics

- **Image - Properties, a text layer's Size ([T-125] (16), label changed):** "Size (px)". E2E: image.spec.ts "the grid size and a text layer's Size take typed digits, and are held to their range when typing ends".

### Not an element, but covered

- **The network allowlist, hardened ([T-125] (26)):** the guard now sees `useImage(` (the image layer's `src`, ledger letter (g): a shared project file can point it at any host under `img-src https:`; the allowlist line is the known, owner-pending exposure, not an approval), `WaveSurfer.create(`, a dynamic `import()`, `eval(` / `new Function(`, `downloadURL`, the updater and crash reporter (`electron-updater`, `@sentry/*`, `autoUpdater`, `crashReporter`), a `spawn` of `curl` / `wget` / `powershell` or of anything but imagii's three binaries, and `<video>` / `<audio>` / `new Audio(`; the CSP check is `/^(https?:|wss?:|ftps?:|\*)/` over every directive with ONE named exception, the shipped `connect-src ws:` (ledger letter (m), a dev-server leftover); `dependencies` holds no updater, telemetry or crash SDK and `electron-builder.yml` has no `publish`; the header says what the scan cannot see. Unit: `networkAllowlist.test.ts` (12 cases; each new shape is proven to be seen and not over-seen, and the CSP, package and builder checks are proven to discriminate).
- **Docs:** every cite re-pointed against the final tree; `TESTING.md` carries the counts and the timing table.

### Found, not fixed

Ledgered with the round and not fixed:

- **Custom starts at a setting that is no preset's.** After T-125 (3) the Custom noise floor starts at -25 / 12 dB, which is no preset's setting (Light is -35 / 12, Aggressive -25 / 24). The hint now says -35 is Light's; the starting value was left (a different start is a product call: it changes what a person who opens Custom hears first).
- **The highlight and captions lists at an hour** are held by the shared formatter's unit test and the wiring pin, not by an E2E (they need a scanned VOD and a transcript).
- **`useImage` (g) and `connect-src ws:` (m)** are on the allowlist as named, owner-pending exposures. The strict fix for (g) would break the reference layer whose stored thumbnail is a DuckDuckGo address.

---

## Dispositions — round 76 (T-126: the review gate's fifteenth pass)

Twenty-four findings from sweep 15 (the frame-rate lag, the double-press, the layout the click cannot see, the allowlist guard). Every behavior change was red-first: a new test against the round-75 build (the pristine-build pattern), against the pre-round bytes of the file, or with the fix mutated out; the quotes and the mutation ledger are in `LESSONS_LEARNED.md`, 2026-10-15 (T-126). An element this round changed carries its row here.

### Record

- **Record - the REC header, the saving card and the saved toast, with a microphone that dropped ([T-126] (2), state and copy added):** a microphone that ended mid-take leaves a line that outlives the 8 s toast: "Microphone stopped at 02:14 - no sound after that" under the REC clock, repeated on the saving card ("Finishing up") and as the saved toast's second sentence ("Saved 4.2 MB. Microphone stopped at 02:14 - no sound after that. Show in folder"). A take whose microphone never dropped shows none of the three. E2E: record.spec.ts "a microphone that drops mid-take is announced once, the take carries on, and it still saves" (the header line once, the card line, the toast text, gone with the take) and "a take with a working microphone that is stopped by the person says nothing about the microphone" (the negative; mutated: a line for a clean take fails it). Unit: `saveCard.test.ts` `micLostLine`.
- **Record - the REC clock ([T-126] (4), copy changed):** "REC 00:05" under an hour as it always read, "REC 1:00:00" from one hour up (it read "REC 125:33" for a two-hour take). E2E: the clean-take case above moves the renderer's clock two hours on and reads `REC 2:00:0x` (red on the round-75 build: `REC 120:0x`). Unit: `clockTime.test.ts` `formatTimer` (59:59 -> 1:00:00).

### Video Studio

- **Video 4q TextOverlayEditor - a refused Source time ([T-126] (3), layout changed):** the sentence is a full-width row under the box it refused (it was an 8-line column 70 px wide beside it; for the end box, between the box and its "s"), the "s" stays on the end box's line, and nothing is drawn over it. E2E: video-core.spec.ts "a refused Source time is one full-width sentence under its box, over nothing, at the default window and the minimum" (both boxes, both sizes; red on the round-75 build with 16 findings; mutated: `order-last` dropped fails it). Unit: `interactionWiring.test.ts` T-126 (3).
- **Video 4q TextOverlayEditor - the Source time boxes at rest, and the outside-the-clip note ([T-126] (5), copy changed):** from one hour up the boxes read the clock ("1:02:03.00", not "3723.00") and "2:47:13" stays "2:47:13.00" when the box is left; the note reads "runs from 1:40:43.50 to 1:41:43.50 of the video"; the teaching line ends "...or a time like 2:47:13". Under an hour every box is the string it always was. E2E: video-core.spec.ts "text overlays: the Source time boxes take 1:30 and 2:47:13, refuse what is not a time ..." (the `3723.00` / `3601.50` pins flipped; red on the round-75 build). Unit: `textOverlay.test.ts`.
- **Video 4o ExportPanel - the folder button ([T-126] (6), state changed):** the chooser opens ON the folder the button shows (it opened wherever the OS last was). E2E: video-pipelines.spec.ts "Export's folder button opens the chooser on the folder it shows" (records the dialog's `defaultPath`; red: `undefined`). Unit: `interactionWiring.test.ts` (mutated: bare `pickOutputDir()` fails it).
- **Video 4k, 4l, 4m, 4n - Compile, GIF, Picture-in-picture and Reframe pressed twice in a breath ([T-126] (19), (20), end state and layout changed; extends "Export pressed twice" above):** the start claims its ref before the first await (one chooser, one job, one file), and Cancel has a row of its own in Compile, GIF and Picture-in-picture, so the second press of a double-click lands on the disabled primary and cannot cancel the job the first one started. E2E: video-pipelines.spec.ts "a double-click on Compile opens ONE chooser and writes ONE file" (a 300 ms chooser; red: two choosers) and "a double-click on Reframe, GIF, Compile and Picture-in-picture runs the job to its end" (a remembered folder, the encode held 2.5 s, Cancel's box measured below the primary's, one file each, no canceled toast; red per panel with that panel at its old bytes). Unit: `interactionWiring.test.ts` (eleven `singleFlight` pins; 14 single mutations).
- **Video 4e ClipKitButton, 4m CaptionsPanel - the Clip Kit and the burn-in start ([T-126] (19), end state changed; REWRITTEN by [T-131] (5)):** both claim their ref first (`startingRef`, `burnStartingRef`) and release it in a `finally`. *This row said their press-twice end state was covered at the deepest reachable layer, the `singleFlight` pins, because "their first await is a native dialog". That rationale was disproven by execution in round 79 (two choosers from one double-click on every unguarded picker); both are now driven by a 300 ms-chooser `dblclick` E2E, see "Dispositions - round 79".*
- **Video 4m CompilationPanel - the fade readout ([T-126] (11), layout changed):** "300 ms" is one line (it wrapped at 1632 px and under) and the row keeps its height from end to end of the slider; the slider is the item that gives. E2E: video-pipelines.spec.ts "the Compile fade readout stays on one line and the row keeps its height from end to end of the slider" (red: wraps at both sizes). Unit: `interactionWiring.test.ts` T-126 (11) keeps every fixed-width readout in the renderer guarded.
- **Video 4k, 4l, 4m - the primary buttons beside a long folder name ([T-126] (13), layout changed):** "Reframe to 9:16", "Export GIF" and "Compile N clips" are one line beside a long (spaced) folder name; the chip is what gives and its name ends in an ellipsis inside the shrunken button. E2E: video-pipelines.spec.ts "the Reframe, GIF and Compile primary buttons are one line beside a long folder name" (red: all three wrap at both sizes).
- **Video 4k ReframePanel, 4h OutputPreview - the panel headers ([T-126] (14), layout and copy changed):** the Reframe title is "Reframe to 9:16"; "OUTPUT PREVIEW" never breaks mid-word (the header is a wrap-capable row: the heading never wraps and a row too narrow drops its actions whole to a second row); the preview select shows every platform whole. E2E: video-pipelines.spec.ts "the Reframe and Output preview headers keep their words whole at the minimum window, and the preview select shows every platform whole" (mutated: the old `PanelHeader` makes the heading wrap).
- **Video 4c Player - the transport row with a three-hour video ([T-126] (15), layout changed):** the clock and "Crop guides" keep one line and their width; the probe line gives (an ellipsis, the whole text as its tooltip). E2E: video-pipelines.spec.ts "the player transport keeps its clock and Crop guides on one line at the minimum window with a three-hour video" (red: both wrap at 1024).

### Audio Studio

- **Audio - the importer and Export, with an audio-only .mkv or .mp4 ([T-126] (7), end state and copy changed; extends the AIFF / WMA row above):** a file with no picture (a podcast, a voice memo) is read from its STREAMS, not its name: no **Re-attach to video**, a plain audio export, and over two hours the sentence is the audio remedy ("Split it into shorter files in another app first..."), never "Export the part you want from Video Studio". Cover art on an mp3 is not a picture. E2E: audio.spec.ts "an audio-only .mkv loads as sound: no Re-attach is offered, it exports as plain audio, and over two hours it is told to split the file in another app" (red: the box is there). Layer 5: media.spec.ts "T-126 (7), (8)" (the real handler). **T-129 (round 78) retired the "over two hours" clause with the ceiling.**
- **Audio - the importer, a file whose header has no length, over two hours ([T-126] (8), failure path changed):** the handler reads the extracted WAV's own length and, over the ceiling, deletes the scratch with the refusal (a multi-GB WAV stayed in %TEMP% until the 6-hour reaper). Layer 5: the same block ("a durationless file that turns out longer than two hours is refused, and its multi-GB scratch WAV is deleted with the refusal"; mutated: the WAV kept, both majors). Unit: `audioExtractCeiling.test.ts`. **Superseded by T-129 (round 78, below): no ceiling, so the WAV is extracted and kept; the case is flipped.**
- **Audio - the second-track card: gain, Remove and the ducking sliders ([T-126] (12), layout and copy changed):** "-10.0 dB" and "Remove" are one line at every width (the file's name is what gives), the four sliders' labels keep a gap from their readouts (1 px apart at 2560), and the Ratio reads "8:1" on screen and to a screen reader (it read "8 :1"). E2E: audio.spec.ts "the second-track card draws its gain readout, its Remove button and its slider readouts whole, on one line and apart, at 1024, 1632 and 2560" (red on the round-75 build: 13 findings) and "a second track can be added in every role and its mix controls drive the chain" (the `8 :1` pins flipped to `8:1`, `aria-valuetext` added).
- **Audio - Export pressed twice in a breath ([T-126] (19), end state changed):** one save dialog, one file. E2E: audio.spec.ts "a double-click on Export opens ONE save dialog and writes ONE file" (a 300 ms dialog; red: two save dialogs).

### Home

- **Every text box, number box and file-name box - selected text ([T-126] (16), colors changed):** `::selection` is the accent at 40% with ink-base on it (it was Chromium's stock blue). The open drop-down list of a `<select>` draws its own highlight row, which no CSS reaches: not claimed. Unit: `designTokensInSync.test.ts` (the alpha is read from the style sheet; ink-base clears 7:1 on bg-base, bg-elevated and bg-hover). No E2E drives a selection color: the rendered ::selection is a computed-style fact the unit pin reads from the source.
- **The whole app - the typeface ([T-126] (18), font bundled):** Inter latin 400 / 500 / 600 ship with the build; nothing is requested (every `url()` in the built style sheets is a file in the build). E2E: smoke.spec.ts "Inter is bundled" (the built sheets, then `document.fonts.load` for all three weights: `document.fonts.check` alone is TRUE for a family nobody defined).

### Not an element, but covered

- **The network allowlist, rebuilt ([T-126] (1)):** 19 cases; the CSP is judged by what is local, in every directive and letter case; navigation, `setAttribute`, SVG loaders, `<input type="image">`, a computed CSS `url(${})` and `crashReporter.start` are in the vocabulary; aliases of `spawn`, `useImage` and Electron's `net` are followed and `child_process`, `use-image` and `wavesurfer.js` are sites at their import. 35 breaks of the branches its negatives protect, each failing its named case (LESSONS 2026-10-15).
- **Folder settings under an unreachable share ([T-126] (10)):** one stat per path in flight and a 1 s deadline (`unknown` answers the stored value). Unit: `folderVerdict.test.ts`, `settingsFolderDeadline.test.ts`. The unreachable-UNC end state is an OS boundary; the stalled stat is simulated.
- **ffmpeg:** (21) `fps=N` after the retime, Layer 5 on export, Reframe, Compile and a 2x clip (both majors); (23) the highlight scans compute no true peak, Layer 5 on the same series (both majors); (24) a copied HEVC picture is tagged `hvc1`, Layer 5 (both majors).
- **Docs:** `TESTING.md` carries the counts and the timing table; DESIGN_GUIDE and BRANDING_GUIDE say the font ships and what `::selection` and the OS's `<select>` highlight are.

### Found, not fixed

- **Item 22 (extraction of broken timestamps) was closed, not fixed:** the probe reads the same ~630 s as the extraction on every shape of the +600 s jump, so a cap has nothing to cap against; the bound is in the `EXTRACT_CLOCK_FILTER` comment.
- **The double-click on Compile / GIF / Picture-in-picture is not a stable witness by itself:** whether the second press lands on Cancel depends on the widths of two labels in the font in use (in the Xvfb font the round-75 build's second press misses Cancel by about 50 px). The E2E measures where Cancel is drawn instead. *Round 77: that was the missing typeface, not the machine. Inter ships since T-126 (18), the widths no longer depend on the box's fonts, and on the Export card the second press does land on Cancel (round-76 bytes: primary x 771-881, Cancel x 809-881); the geometry measure stays because it is stable, and Export has a human-paced second press as well (T-127 (2) below).*
- **Item 14 (i), `whitespace-nowrap` on the Reframe readout, cannot be shown red:** with the short title the readout fits one line without it. It is kept (the ticket's mechanism) and the readout is measured one line.
- ~~**Clip Kit and the burn-in are not driven twice by an E2E** (their first await is a native dialog); the claim-first pins are the deepest layer.~~ *Retracted by [T-131] (5): the rationale was disproven by execution; both are driven (see "Dispositions - round 79").*

## Dispositions — round 77 (T-127: the review gate's sixteenth pass)

Sixteen findings from sweep 16 (the app phoning Google, the quit that left half a file, the join drift, the guard's last gaps). Every behavior change was red-first: a new test against the pristine round-76 build (`basebuild`), against the pre-round bytes of the file, or with the fix mutated out; the quotes, the sha256 triples and the mutation ledger are in the round's hand-back, and the story is in `LESSONS_LEARNED.md`, 2026-10-15 (T-127). An element this round changed carries its row here.

### Every launch

- **The built app, idle, past ready ([T-127] (1), no element, network behavior removed):** no http(s), ws or ftp request and no DNS lookup of a host that is not this machine. E2E: smoke.spec.ts "the built app makes no network request" (a net-log of the launch, 8 s idle, a loopback control that proves the log can see; red on the round-76 build: the dictionary download and six `dns.google` requests). Unit: `interactionWiring.test.ts` pins `spellcheck: false`, `app.configureHostResolver({ secureDnsMode: 'off' })` and `session.defaultSession.setSpellCheckerLanguages([])` ahead of the window. DISPOSITION: the DNS-over-HTTPS probe only happens where the machine's resolver is a DoH-capable provider (this box's 8.8.8.8 is; a CI runner's may not be), so the DoH leg of the E2E shows only there and the wiring pin holds it everywhere; the dictionary leg shows on any machine. The win32 release run is the confirmation on the shipped binary (TESTING, "the release run's hand-checks").
- **The window's X, and `app.quit()`, in the middle of a job ([T-127] (3), end state changed):** nothing is left at a final name: the export's half-written file and a re-attach's `.cleaned.wav` are deleted before the process exits (`before-quit` waits, at most 1.5 s, for every canceled run to finish its own cleanup). E2E: video-pipelines.spec.ts "quitting the app in the middle of an export leaves no half-written file at the final name" and "quitting the app in the middle of a re-attach leaves no scratch WAV and no half-written mp4" (the folder is read after the app has exited; red on the round-76 build: `Received ["t127-quit_Clip 1_youtube.mp4"]`, `Received ["result.cleaned.wav"]`). The re-attach is started through its IPC (`audio:mux`, which the Export panel's button calls with the same spec): the button's native save dialog is the OS boundary and is not the thing under test. Unit: `cancelLatch.test.ts` (the drain, and a scan that every runner ends its run after its work), `reattachCollision.test.ts`, `interactionWiring.test.ts` (the handler's shape). DISPOSITION: a convert (the recording's save, an import transcode) is not a latch run, and its output cleanup lives in `recording.ts`: a quit mid-save is not covered (see Found, not fixed). *Added by T-131 (17):* a Windows shutdown, restart or logoff emits no `before-quit` (Electron's own typings), so the autosave flush, this wait and the kill never run on that exit path; unreachable from this box (T-110 (az), the release run's hand-checks).

### Video Studio

- **Video 4o ExportPanel - Cancel ([T-127] (2), layout changed; extends "Compile, GIF and Picture-in-picture pressed twice" above):** Cancel has a row of its own under the header, so the second press of a double-click lands on the disabled primary. The two-or-more-jobs confirm modal is unchanged. E2E: video-pipelines.spec.ts "a double-click on Export, Reframe, GIF, Compile and Picture-in-picture runs the job to its end ..." (Export joins the geometry test: Cancel below the primary's box; red on the round-76 build: Cancel x 809-881 inside the primary's x 771-881) and "a second press on Export at a human pace lands on the disabled button, not on Cancel" (two real mouse clicks 120 ms apart; red: the export is canceled, no file).
- **Video 4k, 4l, 4m, 4o, 4p - the dialog a button raises, pressed twice ([T-127] (8), end state changed):** the shared `Modal` ignores the second click of a double-click on its scrim, so the safe-zone / over-limit question a button raises on click 1 is not dismissed by click 2. E2E: video-pipelines.spec.ts "a double-click on Export raises the safe-zone question and the second click does not dismiss it; one click on the scrim still does" (red: the dialog is gone). Unit: `interactionWiring.test.ts` (the handler's order: the T-123 (7) drag guard, then `detail`, then close; four breaks). Every other dialog (Clip Kit's, the variants, the name dialog) shares the one handler; no E2E presses each twice.
- **Video 4q TextOverlayEditor - the Source time row ([T-127] (7), copy and state changed; extends the T-126 (5) row above):** the PAIR decides the form: from one hour up in either box, both read the clock and there is no "s"; below it both are seconds and the "s" stays. The two labels are "Source time, start (seconds, or a time like 2:47:13)" and "..., end (...)". E2E: video-core.spec.ts "text overlays: the Source time boxes take 1:30 and 2:47:13 ..." (over, under, the start lifting the end, and 59:50 beside 1:00:10; every other test that names the boxes follows the new labels). Unit: `textOverlay.test.ts` `overlayTimePair`.
- **Video 4s CaptionsPanel - Save .srt pressed twice ([T-127] (11), end state changed):** one save dialog, one file. E2E: video-pipelines.spec.ts "a double-click on Save .srt opens ONE save dialog and writes ONE file" (a 300 ms dialog; red: two). Unit: the `singleFlight` pin (`saveSrtStartingRef`).
- **Video - the header's file name ([T-127] (15), tooltip added):** the whole name is the `title` of the cut one. E2E: video-core.spec.ts "the header names the open video in full as its title".
- **Video - the tour's Export step ([T-127] (9), copy changed):** "Click the folder button - it reads 'Choose folder...' until you have picked one - then click the Export button...". Unit: `tutorialCopy.test.ts` (the quoted label is the empty state of `OutputDirLabel`). The tour itself is driven by home-chrome.spec.ts (unchanged).

### Audio Studio

- **Audio - the importer, a durationless file ([T-127] (10), end state and copy changed; extends the T-126 (7), (8) rows above):** a streamed WebM or MKV with no length in its header is classified by its STREAMS (sound alone: no Re-attach by default, and over two hours the audio remedy), not by its extension. Layer 5: media.spec.ts "the extraction reads a picture from the streams ..." (the 2 h durationless audio-only WebM's sentence flips; a short audio-only and a short picture WebM answer `false` / `true`; red on both majors). Unit: `audioExtractCeiling.test.ts`, `audio.test.ts` (`NoUsableDurationError`). **T-129 (round 78): the "over two hours" sentence went with the ceiling; the streams' answer is unchanged.**
- **Audio - the second-track card's file name, the header's file name, the Cleanup preset rows ([T-127] (15), tooltip added):** each name that is cut with an ellipsis carries its whole self as its `title`. E2E: audio.spec.ts "the second-track card draws ..." (the second track's line and the header) and "cleanup presets save, apply, and delete through both confirm branches" (the row).

### Stream Graphics

- **Image - the Thumbnail variants dialog: Save and Save all pressed twice ([T-127] (11), end state changed):** one save dialog for a variant's Save, one folder chooser and one set of four files for Save all. E2E: image.spec.ts "a double-click on Save all opens ONE folder dialog and writes ONE set; a double-click on a variant's Save opens ONE dialog and writes ONE file" (a 300 ms dialog; red: `one folder chooser, not two`).

### Every text box

- **Every text box and text area - placeholder text ([T-127] (16), color changed):** `ink-dim` (it was Preflight's stock `#9ca3af`). Unit: `designTokensInSync.test.ts` (one rule in the base layer, no raw hex, AA on every surface: 6.20 / 5.83 / 5.33). No E2E drives a placeholder; the colour was read off the glyph pixels of the built app (`156,143,139`, against the round-76 build's `156,163,175`), a probe the round keeps in its scratch and not in the repo.

### Not an element, but covered

- **The network allowlist's widening, called "the last gaps" and not ([T-127] (5), (6), (12), (13), (14); widened again by [T-131] (10)-(12) below):** 32 cases; a constructor through `window.` / `globalThis.` / `self.`, `getBuiltinModule(` and `createRequire(`, `export ... from`, `import x = require()`, a location chain, a bracketed IPv6 literal, `image-set(` (computed and in the style sheets), `createElement` of any loading tag and of `a`, `devDependencies`, every module the set names, and a guard that no `.js` file hides under `src/`. 38 breaks of its branches, each failing its named case.
- **ffmpeg:** (4) `-shortest` on every compilation segment, Layer 5 on a 25 fps source with eight fractional segments (both majors: the lag series `3 / 57 / 83 / 112 / 125 / 161 / 194 / 194 ms` becomes `3 / -3 / 7 / 0 / 0 / 0 / 0 / 0`); (10) the durationless audio-only extraction, Layer 5 (both majors).
- **Docs:** `TESTING.md` carries the counts, the timing table and the release run's hand-checks; DESIGN_GUIDE says what a truncated name carries and what a placeholder is; the LESSONS entries for T-125 (1) and T-126 (19), (20) carry their corrections.

### Found, not fixed

- **Other `truncate` spans with no `title`:** the mood board's collection names, the post checklist's output name, the variant labels, Record's source names, the layer names and the highlight lines. The ticket named four.
- **A quit in the middle of a recording's save (a convert), and the caption model's download partial:** neither is a `CancelLatch` run, so the quit's wait does not reach them.
- **Removing `spellcheck: false` from the window alone is not red in the E2E** (the empty language list already stops the download): that leg is held by the wiring pin.

---

## Dispositions — round 78 (T-128: the small-debt batch from the T-110 ledger)

Six items (titles, woff2 alone, clearing transcripts, bare settings writes, a quit that covers convert and extraction, one alphabet). Every behavior change was red-first: a new test against the pristine build of the round-77 tree (`basebuild`, the sha256 triples and the mutation ledger are in the round's hand-back), and the story is in `LESSONS_LEARNED.md`, 2026-10-16 (T-128). An element this round added or changed carries its row here.

### Video Studio

- **Video 4m CaptionsPanel - Clear saved transcripts, and the line that counts them ([T-128] (3), T-110 (s); new element and state):** the bottom of the panel says "3 saved transcripts kept on this computer." (or "No saved transcripts."), and **Clear saved transcripts** (disabled with none, and while a transcription or burn-in runs) opens a confirm ("Clear saved transcripts?", opens on Cancel; Escape and Cancel change nothing; it says the open video's transcript goes too) whose **Clear transcripts** deletes every `.srt` directly in `<userData>/captions` and nothing else, toasts "Cleared 3 saved transcripts", and sends the panel back to "not transcribed" for the open video (its Save .srt and Burn into video are gone). E2E: video-pipelines.spec.ts "Clear saved transcripts: the line counts them, Escape and Cancel change nothing, Clear empties the folder of transcripts and of nothing else, and the open video is no longer transcribed" (a seeded folder: three transcripts, a burn-in's temp copy, a notes file; a `.srt` in `models/` beside it; the folders are read from disk after every step; red on the pristine build: the line and the button do not exist). Unit: `transcripts.test.ts` (10: the temp copy and sub-folders are not counted, a link is never followed, a refusing remove is counted and the rest go), `captionsTranscripts.test.ts` (the real handlers over a real `userData`: nothing beside the folder is touched, an argument aimed at another folder is ignored), `captions.test.ts` (`clearedTranscriptsMessage`), `interactionWiring.test.ts` (the confirm's `clearStartingRef` is claimed first and released in a `finally`), `videoStore.test.ts` (`setSrtPathFor(…, null)` for the open video only). DISPOSITION: a transcript the OS will not let go of (open in another program) cannot be forced in the e2e; the unit counts it and the toast names how far the clear got ("Cleared 2 of 3 saved transcripts. The rest are open in another program; close it and clear again."). A second press on the confirm is not driven (the dialog closes on the first); the single-flight pin is the static proof.
- **Video 4o ExportPanel - Export with a settings write main refuses ([T-128] (4), end state changed):** the watermark handle, its corner, the file-name template and the output folder are remembered with fire-and-forget writes, so a refusal no longer ends the click: the export runs, its file lands, and the person reads "Couldn't save your settings." once per refused write. E2E: video-pipelines.spec.ts "Export still runs when main refuses to remember the watermark and the template, and says so in one sentence" (`settings:set` swapped for a handler that throws; red on the pristine build: no file in 120 s, no row, no toast).
- **Video - the export queue's rows, the highlight and chat-peak lines, the post checklist's output name and hashtag preview, the preset labels ([T-128] (1), tooltips added):** each cut name carries the whole text as its `title`. E2E: the export case above reads the finished row's two titles (the clip and preset, and the file's full path). The rest are held by the source rule only (see Not an element, but covered). DISPOSITION: a title is a native tooltip, which the headless browser draws nowhere a test can read; the attribute on the rendered element is the deepest layer.
- **Video - the Clip Kit, Compile, GIF, Picture-in-picture and Reframe folder writes ([T-128] (4), end state changed):** `clipKit.lastOutputDir` and `video.lastOutputDir` are remembered through `persistSetting`; a refusal is the same one sentence and the finished file is unaffected. Unit: `useVideoOutputDir.test.ts` (unchanged cases green over the helper), `persistSetting.test.ts`.

### Record

- **Record - a source tile's name ([T-128] (1), tooltip added; the priority case):** a window's own title, as long as its program makes it, is cut with an ellipsis at the tile's width and carries the whole text as its `title` (nothing else on the screen says the rest). E2E: record.spec.ts "a long window title on a source tile is cut with an ellipsis and carries its whole self as the title" (a stubbed source list; the cut is measured, `scrollWidth > clientWidth`; red on the pristine build: `Received: ""`).
- **Record - the webcam corner and Convert to MP4 ([T-128] (4), end state changed):** remembered through `persistSetting`.
- **Record - Stop, then Save, then a quit in the middle of the convert ([T-128] (5), end state changed):** a window X or `app.quit()` while the MP4 is being written leaves NO half-written mp4 at the name chosen in the Save dialog and KEEPS the raw take (`userData/recordings/<id>.webm`); a Discard still removes both. E2E: video-pipelines.spec.ts "quitting the app in the middle of a recording's MP4 convert leaves no half-written mp4 and keeps the raw take" (the renderer's own begin / appendChunk / finalize calls over a real one-minute VP8 file, the Save dialog stubbed, a 600 ms slow disk patched into main; the folders are read after the app has exited; red on the pristine build: the partial stays at the chosen name, and with nothing patched the raw take was deleted by the sweep: `Expected ["<id>.webm"] Received []`). Unit: `recordingQuit.test.ts` (5, over the real convert module and latch: the quit is released only after the partial is gone, the webm branch is the same, a Discard removes both, an open Save dialog is not a run), `recordingStream.test.ts` (the quit sweep leaves a closed, mid-finalize session's take and reaps the one still being recorded). DISPOSITION: a person who quits mid-convert gets the raw take back only by finding it in the data folder (no recovery screen; T-110 (u)); the existing launch sweep reaps `recordings/` files older than 6 hours.

### Audio Studio

- **Audio - the importer, Clean audio and a restored project, with a quit in the middle of the extraction ([T-128] (5), end state changed):** the sound a recording's extraction was writing is removed before the app exits. E2E: video-pipelines.spec.ts "quitting the app in the middle of an extraction removes the half-written scratch WAV" (115 minutes of silence in FLAC extracted through `audio:extractFromVideo`, the window's X once the WAV is past 5 MB and still far from its 1.3 GB, the app's temp folder its own; red on the pristine build: `Received ["wtPTx9INfS.wav"]`). Unit: `extract.test.ts` (4: the quit is released only after a 150 ms unlink, a quit during the folder's creation spawns nothing, every ending gives its run back). Layer 5: media.spec.ts "a quit in the middle of a transcode or an extraction" (the real SIGKILL and the real removal, green on 7.0.2 and 6.1.1).
- **Video - the import transcode, with a quit in the middle ([T-128] (5), end state changed; Video 1 Importer's convert for flv / ts / wmv):** a transcode that stops (a quit, a crash, an unreadable source) removes its half-written working copy. E2E: video-pipelines.spec.ts "quitting the app in the middle of an import transcode leaves no half-written mp4 in the working-copy folder" (`window.api.video.convertForImport` on the same take; red on the pristine build: `Received ["t128-import-quit-aKbOI9WY.mp4"]`). Unit: `convertQuit.test.ts` (7: also a failed transcode, a Discard-style cancel by owner, a cancel during the folder's creation, and a cancel for another owner leaving the import running).

### Home

- **Home / Welcome - "Let's go" with a settings write main refuses ([T-128] (4), end state changed):** the person is let in whether or not `welcomeSeen` was stored (the next launch asks again), with the one sentence. E2E: home-chrome.spec.ts "Welcome \"Let's go\" still lets the person in when main refuses to remember it, and says so in one sentence" (red on the pristine build: still on "Hi Mike!").
- **Tutorials - the first-visit flag ([T-128] (4)):** `stop()` writes through `persistSetting` (it was a floating promise). DISPOSITION: covered by the scan; no E2E refuses that write.
- **Recent files (Video and Audio importers, Record's saved take) ([T-128] (4)):** the list is written through `persistSetting` and awaited, so a refusal costs the entry its persistence and not the open.

### References

- **References - the mood board's list row, heading and a saved reference's title ([T-128] (1), tooltip added):** E2E: references.spec.ts "a long board name is cut with an ellipsis and carries its whole self as the title, in the list and in the heading" (red on the pristine build: `Received: ""`). The overlay title on a tile (`line-clamp-2`, drawn on hover or keyboard focus) is held by the source rule only.

### Stream Graphics

- **Image - the layer names, the Thumbnail variants' labels ([T-128] (1), tooltip added):** held by the source rule (`a11ySweep.test.ts` rule 6) and the attribute reading above; no E2E reads these two.

### Not an element, but covered

- **Fonts ([T-128] (2)):** three `@font-face` rules, woff2 alone; the build holds three font files, not six. E2E: smoke.spec.ts (no `.woff` in a built sheet or the assets folder, exactly three woff2, the page loads all three weights; red on the pristine build: three `.woff` urls). Unit: `interactionWiring.test.ts` (no `@fontsource` CSS import, one woff2 source each, the files exist, with a discrimination block).
- **One alphabet ([T-128] (6), T-110 (ad)):** `SAFE_ID_RE` is written once; `pathSafety.test.ts` fails on a second `[A-Za-z0-9_-]` in `src`; `video:deleteCustomPreset` refuses a bad id at the handler (`videoCustomPresetIds.test.ts`, a spy on the store).
- **The source rules ([T-128] (1), (4)):** `a11ySweep.test.ts` rule 6 (every `truncate` / `line-clamp-N` element has a `title` on it or on a browser-drawn tag around it) and `failurePathLanguage.test.ts` (a settings write is awaited inside a `try` with a `catch`, `.catch`ed, or goes through `persistSetting`), each with a discrimination block.

### Closed from round 77's "Found, not fixed"

- **Other `truncate` spans with no `title`:** all of them, and the two `line-clamp-2` spans, and the rule is a test now.
- **A quit in the middle of a recording's save, and an import transcode:** both are runs the quit waits for; the extraction too. (The caption model's download partial is not: below.)

### Found, not fixed

- **38 awaited bridge calls outside any `try`, not settings writes:** native pickers (`pickFile`, `pickOutputDir`, `pickBurnInOutput`), cancels (`cancelGif`, `cancelPip`, `cancelReframe`, `cancelConcat`), store reads and writes (`referencesStore`'s `moodboard.*` calls and their `list()` re-reads, `settings.get` in `useRecentFiles`, `videoStore.loadSource`'s probe, `audioStore`'s probe, `ProjectIO`'s `convertForImport` / `extractFromVideo`) and a few effects (`captions.status`, `listCustomPresets`). Most do not reject in practice. The ones that could reject onto a click: `MoodBoardPanel`'s Clear thumbnail cache (a directory it cannot read), `CustomPresetManager`'s save and delete (a full disk), and the mood-board store's actions (a corrupt board file). A rule for them would need an allow-list of the pickers and cancels; the upgrade is the same scan with one.
- **The caption model's download partial** is still not a latch run; a quit mid-download leaves the `.part` file for the next launch's sweep.
- **A taken-and-kept recording after a quit has no way back in:** the raw take is in `userData/recordings` until the 6-hour sweep. T-110 (u) is the product call (a "Recover your last recording" card, or keeping the take whenever a save fails).
- **The extraction handler's own probe and the late length check** (`audio:extractFromVideo` asks ffprobe before it extracts, and asks again of a WAV of unknown length) are not part of the extraction's run; a quit there leaves, at worst, a finished scratch WAV for the 6-hour sweep.
- **The two new runs have no row in `cancelSentinel.test.ts`'s pre-spawn table:** that table holds a probe, an extraction or a name choice and these two wait only on a folder's creation; `convertQuit.test.ts` and `extract.test.ts` drive "a cancel that lands while the folder is made spawns nothing" directly.

## Dispositions — round 78 (T-129: the waveform is main's peaks, and the 2-hour ceiling is retired)

T-110 (ao), owner-authorized: Audio Studio decoded the WHOLE file in the renderer to draw its waveform (3.25 GB of renderer memory for a 1 h WAV), and T-123 refused anything over two hours. Main now reads the sound as a stream into 4000 highest/lowest pairs (`audio:peaks`), wavesurfer draws those and never decodes, and no route asks a length any more. Every change was red-first against the pristine round-77 build (`basebuild`, 327ccbf) or with the fix mutated out; the quotes and sha256 triples are in the round's hand-back, and the story is in `LESSONS_LEARNED.md`, 2026-10-16 (T-129). The rows above that describe the ceiling (T-123's waveform row, T-124's Clean audio and importer rows, T-126 (7)'s "over two hours" clause and T-126 (8)'s durationless row, T-127 (10)'s "over two hours" clause) are superseded by these.

### Audio Studio

- **Audio - opening a file, any length ([T-129], end state changed; supersedes the T-123 ceiling row):** the studio opens on the file at once, and the box the waveform will fill reads "Drawing the waveform… N%" (`role="progressbar"`, named "Drawing the waveform", valued) while main reads the sound; the waveform then replaces it, and Play turns on. A 2 h 5 min file opens. E2E: audio.spec.ts "a file longer than two hours opens, shows how far its waveform has been read, draws it, and the renderer never holds the file" (a 30 MB, 48 kHz MP3 made by stream copy: the progress line with a percent over 0 in its words and in `aria-valuenow`, Play off while it reads, then tall bars over the tone hour and flat 1 px bars over the silence, read off the canvas pixels; the page made 0 `fetch`/XHR requests for the file; the renderer's peak memory (`VmHWM`) watched WHILE it waits and under 800 MB - 182-185 MB measured - and the player silent about the file). Red on the round-77 build: the progress line `element(s) not found` (the file was refused). Mutations on this round's build, each red on the named case (sha triples in the hand-back): wavesurfer given `url` alone (the renderer decode back: `the renderer peaked at 800 MB while the waveform was read and drawn ... Expected: < 800`; measured, that path climbs to about 1.46 GB and crashes, or has its decode refused and says the player cannot play the file - the case ends its wait on either), the progress line removed (`element(s) not found`), and the words frozen at 0 % while `aria-valuenow` moves (`Expected: > 0 Received: 0`). Unit: `audioStore.test.ts` (open first, `drawing` while it reads, `waveform` when it answers), `interactionWiring.test.ts` ("the waveform is drawn from main's peaks and never decoded here ...").
- **Audio - the header's Close while the waveform is still being drawn ([T-129], end state added):** main's job is stopped (its ffmpeg is killed, `audio:cancel` through the per-job registry) and nothing is said (the person pressed Close); the next file opens. E2E: audio.spec.ts "Close while a long file is still being drawn stops main's job: its ffmpeg is killed, nothing is said, and the next file opens" (main's spawn is wrapped to record the peaks child and how it ended: `SIGKILL`). Red: the round-77 build (no job to stop: `element(s) not found`), and Close's `stopDrawing` mutated out (the child runs to its end). Unit: `audioStore.test.ts` (Close and a superseding open cancel the job; the job's late answer draws nothing). The same Cancel is sent when another file is opened while one is drawing (unit only: Audio Studio shows the studio, not the importer, while it draws, so the second open comes from Clean audio or a project).
- **Audio - a file main cannot read the sound of ([T-129], failure path added; replaces T-123's "a waveform whose file cannot be read"):** a WAV whose format tag no decoder knows opens (ffprobe reads it), its waveform job fails, and the studio lets go of it: "imagii couldn't read the sound in this file to draw its waveform. It may be damaged or in a format imagii can't read here. Re-export it as WAV or MP3 and try again." once, back to the drop zone, and a readable file is taken straight after. E2E: audio.spec.ts "a file main cannot read the sound of is refused while its waveform is drawn ..." (red on the round-77 build: `Received array: ["Loaded", "Couldn't draw this file's waveform. ..."]`). Layer 5: media.spec.ts "a file whose sound ffmpeg cannot decode is the finished sentence" (both majors). T-123's fetch-refusal case is retired with the fetch: with `peaks`, wavesurfer fetches nothing (the long-file case counts the page's requests for the file: 0).
- **Audio - a file the PLAYER cannot play ([T-123], copy changed by [T-129]):** an ADPCM WAV now shows its waveform (ffmpeg reads ADPCM) and says "imagii can't play this file here. It may be damaged or in a format the player can't read. Re-export it as WAV or MP3 and try again." once; Play stays off. E2E: audio.spec.ts "a file the player cannot play still shows its waveform, and says it cannot be played, once, in a finished sentence" (red on the round-77 build: the old "Couldn't draw this file's waveform" sentence).
- **Audio - the importer's drop of a video over two hours ([T-124], end state changed by [T-129]):** extracted and opened (a ~1.4 GB scratch WAV for 2 h 1 s), Re-attach offered, the waveform drawn from main's peaks of the WAV. E2E: audio.spec.ts "a video longer than two hours is extracted and opens, its waveform drawn from main's peaks" (the case removes its own WAV; red on the round-77 build: refused, `element(s) not found`). Unit: `audioExtractCeiling.test.ts` (flipped: 7201 s, 4 h and 9 h are extracted). Layer 5: "an audio-only mkv over two hours is extracted" and "a durationless file longer than two hours is extracted too" (flipped, both majors red on the round-77 handler: `That file is longer than 2 hours ...`).
- **Audio - an audio-only .mkv over two hours ([T-126] (7), clause retired by [T-129]):** there is no sentence to choose any more; the case keeps its no-Re-attach and plain-export assertions, and the long file's extraction is Layer 5's.

### Video Studio

- **Video - Clean audio, on a video over two hours ([T-124], end state changed by [T-129]):** the sound is extracted and Audio Studio opens on it, waveform drawn. E2E: video-pipelines.spec.ts "Clean audio on a video longer than two hours extracts its sound and opens Audio Studio on it" (removes its own WAV; red on the round-77 build: `Received array: ["Video loaded", "That file is longer than 2 hours, ..."]`). Unit: `interactionWiring.test.ts` "no route asks a length ceiling any more".

### Every launch

- **A quit while a waveform is being drawn ([T-129], end state added; extends T-127 (3)):** the peaks job's ffmpeg is killed by the quit sweep (`cancelAllPeaks`, also reached through `cancelAllAudioJobs`) and the quit's drain waits for its run to end. E2E: audio.spec.ts "quitting while a long file is being drawn kills main's job before the app is gone" (the peaks child's end is written down at `will-quit`: `SIGKILL`; red with both sweep calls mutated out: the child still running at `will-quit`). Unit: `peaks.test.ts` (the run stays open until the child closes), `interactionWiring.test.ts` (`cancelAllPeaks` ahead of the drain).

### Not an element, but covered

- **ffmpeg (IMG-PREC):** the peaks decode, Layer 5 "the waveform is read from a stream of the sound in main ..." on both majors: two 250 Hz bursts at known times and heights land in their buckets (edges to one bucket, 5 ms) at their heights (within 6 %), silence is flat, a 2 h 5 min file is 4000 pairs with this process growing well under 60 MB while 120 MB of PCM goes through it (measured +1.5 to +29 MB; a job that keeps the chunks grows 116-123 MB: red on both majors), an undecodable file is the sentence, and Cancel kills the real ffmpeg at once.
- **Docs:** README, USER_GUIDE, PRODUCT_GUIDE and STYLE_GUIDE no longer describe a 2-hour limit; USER_GUIDE says what the progress line is and what Close does while it shows. *Corrected by [T-132] (2): the PRODUCT_GUIDE half of this sentence was false from the round-79 checkpoint-3 merge (which took the other side of the studio table and put "up to 2 hours long" back) until T-132; it is true again, and `docClaims.test.ts` now reads README, PRODUCT_GUIDE and USER_GUIDE for the limit, so a merge cannot revert it silently.*

### Found, not fixed

- **A video of more than about 6.2 hours extracts past a WAV header's 4 GB size field** (48 kHz stereo 16-bit is ~0.69 GB an hour; ffmpeg's WAV writer does not switch to RF64 unless asked): the ceiling hid this; it is now reachable. Not measured here (a 4 GB+ scratch file); a candidate for `-rf64 auto` on the extraction with its own Layer 5 case.
- **Clean audio's extraction itself still has no Cancel** (Close stops the waveform job only once the studio is open; the extraction is T-128 (5)'s latch work).
---

## Dispositions — round 79 (T-130: the platform-rate and kit-art debt, letters (q), (t), (an))

Three items (the compilation's rate and the 60 fps preset, the Clip Kit thumbnails' crop, the watermark's margins on a vertical frame). Every behavior change was red-first (the tests written against the unchanged product code, then a mutation of the finished code for each pin; the sha256 triples are in the round's hand-back ledger). An element this round added or changed carries its row here. Rows above that this round makes stale are revised below, not edited.

### Video Studio

- **Video 4o ExportPanel - the YouTube 1080p60 checkbox ([T-130] (q), new element; revises "platform checkboxes" above):** a sixth built-in card beside YouTube, named "YouTube 1080p60", described "1920×1080 · 60 fps", unchecked until ticked. Ticked beside YouTube and exported, it writes a SECOND file (`<name>_youtube60.mp4`) at 1920×1080 and 60 fps next to the 30 fps one. E2E: video-pipelines.spec.ts "YouTube 1080p60 is a card of its own: ticked beside YouTube it writes a 60 fps file next to the 30 fps one, and Clip Kit is still five (T-130 (q))" (both files ffprobed: `r_frame_rate` 30/1 and 60/1; the toast; the Clip Kit button still reads "Clip Kit (5 + thumbs)") and the T-92 microcopy case "each export checkbox is named for its platform…" (the new card's description). The checkbox finder is now exact on the name (`YouTube` is a substring of `YouTube 1080p60`), and the custom-preset cases count 7 and 6 cards where they counted 6 and 5. Layer 5: media.spec.ts "video export presets (real ffmpeg)" now asserts every preset's `avg_frame_rate` is its own `fps`, the new row included (both majors); "YouTube 1080p60 exports a 60 fps recording at 60: 300 frames in five seconds, every flash on its second and its beep" and "...of a 30 fps recording is still a 60 fps file". Unit: `presets.test.ts` (the row's numbers: 12M, 192k, aac, 60), `presetTablesInSync.test.ts` (both tables carry it, the grid lists it straight after YouTube, `PLATFORM_IDS` names it).
- **Video 4k Output preview - the "Preview platform" select; 4b Custom preset manager - "Base on" ([T-130] (q), one more option each):** both lists are the grid's, so both gain "YouTube 1080p60 (1920×1080)"; no control changed. The preview select is already driven option by option, at the default and the minimum window, by video-pipelines.spec.ts "the Reframe and Output preview headers keep their words whole at the minimum window, and the preview select shows every platform whole (T-126 (14))", which now walks the new option too. A custom preset based on the new row starts at 60 fps (`customPresetParse.test.ts` accepts `youtube60` as a base). *Made true by [T-132] (7): until then "Base on" loaded the platform's size alone, so a preset based on this row started at 30 fps and 8M; the form now loads the platform's rate and both bitrates (`customPresetStartFor`), and video-pipelines.spec.ts drives the select to YouTube 1080p60 and reads 60, 12M and 192k.*
- **Video 4e ClipKitButton - the count and the cancel question, with the new preset in the grid ([T-130] (q), deliberately unchanged):** Clip Kit is one version per PLATFORM, so it reads its own list (`KIT_PLATFORM_IDS`, five), not the grid's: a sixth file would be the clip upsampled to 60 fps at 12 Mbps whatever it was recorded at. The button still reads "Clip Kit (5 + thumbs)" and the cancel confirm still says "5 exports + thumbnails". E2E: the 1080p60 case above (button text) and "a 16:9 recording cropped to 9:16 gets a Short from Clip Kit…" (five jobs, no landscape YouTube file beside the Short). Unit: `presetTablesInSync.test.ts` (the list is the five, without the new id), `clipKit.test.ts`.
- **Video 4m CompilationPanel - the card's rate ([T-130] (q), end state changed; revises "the card ([T-112])" above):** the line under the header names the rate the file WILL have, not a fixed 30: "1920×1080, 60 fps" for a 60 fps recording, "1920×1080, 15 fps" for the 15 fps fixture. The card and main derive it by one call (`compileFps`, `src/shared/compileFps.ts`) from the same probe. E2E: video-pipelines.spec.ts "a 60 fps recording: the Compile card says 60 fps and the compilation is a 60 fps file (T-130 (q))" (the card says 60 and not 30; the written file is 1920×1080 at `r_frame_rate` 60/1), the T-112 card case (now 15 fps) and the "compilation: says what it needs at one clip…" case (the file keeps the recording's 15/1). Layer 5 (`media.spec.ts`, "the compilation follows the source's frame rate, up to 60", both majors): 60 fps compiles at 60 with 360 frames in six seconds and every flash on its second and its beep; 59.94 stays 59.94 (the container reads 60000/1001); a 120 fps source is brought down to 60; a 24 fps one stays 24; a Record take whose container says 1000/1 (the probe's "no rate") falls back to 30, not to the cap. Unit: `compileFps.test.ts` (the cap, an NTSC rate, the fastest of several, an unreadable rate pulling nothing down, no rate at all is 30), `concat.test.ts` and `concatRunner.test.ts` (the fps stage and `-r` take the one derived value, through the real runner with a stubbed probe).
- **Video 4e ClipKitButton - the three thumbnails ([T-130] (t), end state changed):** each thumbnail is the CLIP'S picture: with a crop drawn (the 9:16 button is the usual one) it is the cropped region, at the source's own pixels, not the whole frame the crop threw most of away. E2E: video-pipelines.spec.ts "a 16:9 recording cropped to 9:16 gets a Short from Clip Kit…" (each of the three `Clip_1_thumb_N.jpg` is 9:16 and narrower than 220 px, shorter than the 360 px frame, and has NO red pixel where the source frame has thousands: the red block lies outside the crop). Layer 5 (`media.spec.ts`, "a Clip Kit thumbnail is the clip's cropped picture", both majors): the control without a crop is the whole frame; with a crop the file is exactly the cropped size with the strip's green and its white square in and no red or blue anywhere; the three kit moments; a crop on odd edges is even and inside the frame; an odd-sized source (1919×1079). Unit: `frame.test.ts` (the argv: one `-vf crop`, a probe only for a crop, the numbers in even pixels of the probed size, a crop that overshoots clamped), `videoCropPayload.test.ts` (`video:extractFrame` refuses an unusable crop in one sentence, as the other four paths do), `cancelSentinel.test.ts` (a cancel before the probe spawns nothing), `interactionWiring.test.ts` (the button hands `clip.cropRect` to the extract).
- **Video 4t ExportPanel - the Watermark corner on a vertical file ([T-130] (an), end state changed; revises the T-51 / T-111 rows above):** a 9:16 or taller export (Reels, TikTok, the YouTube Short the kit swaps in, or a custom size of that shape) puts the watermark's top corners 15% of the height down (288 px of 1080×1920) and its bottom corners 25% up (480 px), clear of the platform's header and caption; the sides stay 20 px and a landscape export keeps its flat 20 px. The pair is `VERTICAL_WATERMARK_INSET` in `src/shared/watermark.ts` (the doc comment names the published safe-zone figures it clears; DESIGN_GUIDE and USER_GUIDE state the numbers). Unit: `watermark.test.ts` (the pair at 1080×1920 and in proportion at other vertical sizes; which shapes are vertical, and that an unusable size is not), `filters.test.ts` (all four corners, vertical and landscape, in the filter string), `clipKitWatermark.test.ts` (the kit's reels and tiktok jobs through main's real graph: `y=288` / `y=h-th-480`; the landscape three keep 20). Layer 5 pixels (`media.spec.ts` T-51 block): "on a 9:16 export the watermark sits between the header and the caption in every corner, and the bands above and below it stay flat" and "a landscape export keeps the flat 20 px". DISPOSITION: both are `win32`-gated like every drawtext case (the bundled linux 7.0.2 has no `drawtext` filter), so they run for real in the Windows build; here they were run through the documented route (TESTING.md, "Running the win32-only drawtext cases here") on the distro's 6.1.1 with an Arial-metric stand-in font, red-first and with the mutation of each margin.

### Not an element, but covered

- **The source's rate and the 60 fps preset ([T-130] (q)):** `COMPILE_FPS` (30) is now only the fallback of `compileFps`; the ceiling is `MAX_COMPILE_FPS` (60). `presetTablesInSync.test.ts` ties the grid's compile row to the same constant.
- **The thumbnail's crop and the margins are shared helpers:** `cropToFrame` (the stage every runner builds) and `watermarkInset` / `isVerticalFrame` have their own unit pins and are driven end to end by the Layer 5 cases above.

### Found, not fixed

- **The right-hand column of like / share buttons on a vertical frame is not cleared:** the inset is vertical only; a bottom-right handle still shares that column. The guides say so and name a left corner as the answer. A horizontal inset is a second constant and a product call.
- **The bundled linux 7.0.2 cannot render the watermark pixel cases:** no `drawtext` filter in that build. The margins are proven on 7.0.2 as the filter string (unit) and on the shipped major 6.1.1 as pixels; on win32 both run natively.
- **A frame rate between two whole ones is written as read:** a variable-rate recording whose average is 29.8 fps is compiled at 29.8. `probe.fps` (average first) is the one reading the Timeline already uses, and snapping near-whole rates would be a second rule; the cap and the "no rate" fallback are the only judgments.
- **`settingsFolders.test.ts` and `settingsFolderDeadline.test.ts` fail when `TMPDIR` is longer than 31 characters:** they store a temp path (`<tmpdir>/imagii-settings-folders-XXXXXX/deleted-last-week`) as `streamerHandle`, whose 80-character schema limit then refuses the write: red under an 88-character scratch `TMPDIR`, green under a 19-character one (the folder passes at 31 characters or fewer). Not touched by this ticket; the fix is a value that does not grow with the temp path.
- **Thirteen e2e cases fail when `TMPDIR` is a symlink:** the app's `userData` is the real path and the cases compare it with the logical one (the References studio's thumbnail folder and URL, the Captions panel's folder and "outside the captions directory" refusal, the Clip Kit's caption cases). Executed: 14 of 344 red under `TMPDIR=/tmp/<short>` that pointed through a symlink, all 14 green under a real folder of the same name. A real temp path is the only supported one; the suites do not `realpath` it.
## Dispositions — round 79 (T-131: the review gate's seventeenth pass)

Eighteen findings from sweep 17 (a compilation that lost clips and said "Saved", pickers nobody pressed twice, a guard that stopped claiming to be finished). Every behavior change was red-first: the fix mutated out by content-replace with a sha256 triple (r80c/ledger.tsv; every restore byte-identical), on both ffmpeg majors for items 1 and 2; the story is in `LESSONS_LEARNED.md`, 2026-10-23 (T-131). **This round REWRITES the round-76/77 dispositions that said a picker's press-twice end state was "pin-only: the first await is a native dialog"** - executing it disproved the rationale (the second press lands before the OS draws the dialog): every picker is now claim-first (`lib/claimFirst.ts`), found by a scan that holds the set of native-chooser calls to a decided table, and every studio entry point has a delayed-chooser (300 ms) `dblclick` E2E. The two rows that said so ("Clip Kit and the burn-in start", T-126 (19), and the Found-not-fixed line "Clip Kit and the burn-in are not driven twice by an E2E") are corrected in place below.

### Video Studio

- **Video 4k, 4m, 4n, 4o Compile, Re-attach, Picture-in-picture - a source whose sound is shorter than the picture ([T-131] (1), (2), end state and failure path changed):** Compile keeps every clip (a segment past the sound's end is the picture's length, silent after it) and a clip that has no picture, or a join that cannot read a clip, fails in a sentence and writes no file; Re-attach and Picture-in-picture end at the PICTURE. Layer 5 (both majors): media.spec.ts "a compilation survives a source whose sound does not cover a segment" (8), "the sweep-17 replication" (2: the expediter's 10 s / 6 s harness, 6.0 s and 7.0 s) and "a sound shorter than the picture does not shorten the file" (10); the T-127 (4) fractional drift series re-run flat (`3 / -3 / 7 / 0 / 0 / 0 / 0 / 0`). Unit: `concat.test.ts`, `concatRunner.test.ts`, `muxCodec.test.ts`, `cancelSentinel.test.ts` (the PiP probe and the mux pass are held to the cancel latch). E2E: video-pipelines.spec.ts "Compile keeps every clip of a source whose sound ends before its picture, and the file is as long as its clips" presses the Compile button on an 8 s picture with 3 s of sound (three clips, two of them past the sound's end, set in a project file; red on the pre-fix bytes: the file is the first clip's 1.5 s, not 5.0 s). DISPOSITION: the loud-failure toast is `reportFailure` carrying main's sentence, driven at the runner (`concatRunner.test.ts` asserts `userFacingError` lets it stand) - a clip whose range the picture does not reach is not something the panel's own controls make (the store clamps a clip to the video), so that sentence is held at the runner and at Layer 5 and not by a click. A late-starting sound's START is not padded (named in `concat.ts`).
- **Video 4j Smart highlight finder, 4g Chat spike finder - results with the video ([T-131] (3), end state changed):** replacing the open video in place (Reframe's "Edit in Video Studio") clears the candidates, the scan's progress, the pasted chat log and the spikes; a scan that answers after the swap is dropped; a "+ Clip" whose range starts at the end of the video is refused. E2E: video-pipelines.spec.ts "a scan's candidates and a pasted chat log go with the video they were made for" (a real scan, log and reframe) and "a scan that finishes after the video was replaced puts nothing on the new video" (the scan held in main). Unit: `videoStore.test.ts` (4), `interactionWiring.test.ts`.
- **Video 4a Importer - Choose file…, 4n Picture-in-picture - Base and Overlay, 4t Export and the four side panels - folder chips, pressed twice ([T-131] (5), end state changed):** one chooser each. E2E: video-pipelines.spec.ts "a double-click on "Choose file…" opens ONE chooser and loads the file once", "... the Picture-in-picture file buttons opens ONE chooser each, and the first answer stands" and "... a folder chip opens ONE chooser: Export's own, and the one the GIF, Compile, Reframe and Picture-in-picture panels share" (300 ms choosers; red: two). Unit: `claimFirst.test.ts`, the native-chooser scan in `interactionWiring.test.ts`.
- **Video 4e ClipKitButton, 4o CaptionsPanel - the Clip Kit and the burn-in start, pressed twice ([T-126] (19) rewritten by [T-131] (5)):** both claim their ref first (`startingRef`, `burnStartingRef`) and release it in a `finally`, and their first await is a NATIVE folder chooser / Save dialog. *Rewritten:* the round-76 row said the press-twice end state was covered "at the deepest reachable layer, the `singleFlight` pins ... no E2E presses them twice", on the rationale that a native dialog protects itself. Executing the rationale disproved it (the second press lands before the OS draws the dialog), and these two are now driven like every other start handler. E2E: video-pipelines.spec.ts "a double-click on Clip Kit opens ONE folder chooser and makes ONE kit" and "a double-click on Burn into video opens ONE save dialog and writes ONE file" (300 ms stand-ins; red with the claim removed: two). Unit: the `singleFlight` pins (kept).
- **Video 4k, 4l, 4m, 4n - the folder chip and the primary while a job runs ([T-131] (13), layout and state changed):** the chip is disabled while the job runs and the Reframe and Compile primaries keep their idle width. E2E: video-pipelines.spec.ts "a second press on the busy primary never opens a chooser" (the four panels at 1632 and 1024 px; the second press lands on the idle primary's left strip 150 ms after the first; red per protection: the chip enabled -> a chooser opens, the `min-w` removed -> the primary shrinks 137 -> 114 px).
- **Video 4t ExportPanel, 4e ClipKitButton - the Cancel question ([T-131] (8), (9), end state changed):** the question closes when its batch ends ("Cancel 0 running jobs?" is gone), and a double-click on "Keep running" goes no further. E2E: video-pipelines.spec.ts "the Cancel question goes when its batch ends", "the Clip Kit Cancel question goes when the kit ends" and "a double-click on "Keep running" closes the question and goes no further" (every click that reaches the page recorded, every checkbox read before and after).
- **Video 4t ExportPanel - the filename template ([T-131] (14), layout changed):** the token hint is under the box; the box holds its whole default value at 1024 px. E2E: video-pipelines.spec.ts "the filename template shows its whole default value at the 1024 px minimum".
- **Video Player and Timeline - the hint lines ([T-131] (7), copy changed):** both end with "? all shortcuts". E2E: home-chrome.spec.ts "the last step names the ? key ..." reads both lines (one `<kbd>?</kbd>` each) and presses the key.

### Audio Studio

- **Audio - the Fix wizard's answers ([T-131] (4), end state changed):** a double-click answers ONE question. E2E: audio.spec.ts "a double-click on a Fix wizard answer answers ONE question, at every step" (red: `Quick fix · 3 of 3`).
- **Audio - the importer's Choose file… and the second-track role buttons, pressed twice ([T-131] (5), end state changed):** one chooser, one load, one track (the second answer used to replace the first). E2E: audio.spec.ts "a double-click on "Choose file…" opens ONE chooser and loads the file once" and "a double-click on a second-track role button opens ONE chooser and adds the track once".

### Home

- **Home - Open project and Save project, pressed twice ([T-131] (5), end state changed):** one chooser and one load; one Save dialog and one file. E2E: home-chrome.spec.ts "a double-click on Open project opens ONE chooser ... Save project opens ONE dialog and writes ONE file". DISPOSITION: the dialog is the OS boundary and is replaced in main (the click, the IPC, the validation, the file on disk and the store writes are real).
- **Every studio's tour - Next, Back, Done and the scrim ([T-131] (6), (7), (8), end state and copy changed):** a double-click moves ONE step; the last step names the `?` key beside the header's `?` button; a double-click on Done ends the tour and the second press reaches nothing. E2E: home-chrome.spec.ts "a double-click on Next, Back or the scrim moves the tour ONE step" and "the last step names the ? key; a double-click on Done ends the tour ...". Unit: `tutorialCopy.test.ts`, `repeatPress.test.ts`.
- **Every dialog - the second press of a double-click on its button ([T-131] (8), end state changed):** `Modal` arms a 500 ms swallow of repeat clicks when it closes (video-pipelines.spec.ts "Keep running" above is the witness; every other dialog shares the one change).

### Stream Graphics

- **Image - the Export card's "Output: 1280×720" and the emote pack's "28×28, 56×56, 112×112", the YouTube-size note ([T-131] (15), copy changed):** × instead of the letter x. E2E: image.spec.ts "PNG and JPG export real bytes, ...", "emote pack: a 112x112 PNG export ..." and "an overlay exports transparent ..." (the pins moved). Unit: `ExportDialog.test.ts`, `copyConventions.test.ts` (a rule for the letter x between numbers, with its discrimination).

### Not an element, but covered

- **The network allowlist, widened again ([T-131] (10), (11), (12)):** 42 cases; `open` / `eval` / `Function` in every spelling unless the file binds the head (autosave.ts's `open` is the negative), `x['name']`, a constructor used as a value, `createElement(dynamic)` / `setAttribute(dynamic)`, any `scheme://` literal that is not local, a closed list of file types under `src/`, and the package names pinned. 35 breaks, 34 red the first time and the 35th closed with a new negative. The header no longer says "last gaps": WHAT IT CANNOT SEE is the declared residue. **Rider ([T-110] (m)):** `connect-src ws:` does NOT let the built renderer fetch an https address (probed with a non-routable target; smoke.spec.ts holds it); it leaves WebSockets unrefused.
- **Inter's license ships again ([T-131] (18)):** `extraResources` -> `resources/licenses/Inter-OFL.txt`. Unit: `releaseWorkflowShape.test.ts`. Shown by a scratch `electron-builder --win --dir` probe on the Linux box (the tree is assembled before the rcedit step that needs wine); the real portable exe is the release run's hand-check.
- **The quit story ([T-131] (17)):** Electron emits no `before-quit` on a Windows shutdown, restart or logoff, so the autosave flush, T-127 (3)'s drain and the kill do not run on that one exit path (the comment said "an OS session end"). Ledgered as (az) in T-110; the optional `session-end` handler is not built.
- **ffmpeg:** (1) the pad and the two fail-loud guards, Layer 5 on both majors with the T-127 (4) drift series re-run; (2) the pad on Re-attach and Picture-in-picture, Layer 5 on both majors.
- **Docs:** STYLE_GUIDE (the claim-first rule for pickers, the repeat-press rule, the chip and its width, the time pair), BRANDING_GUIDE (×), USER_GUIDE (the `?` key), `TESTING.md` (counts, timing, the wpad allowance, the license and shutdown hand-checks).

### Found, not fixed

- **A late-starting sound's start is not padded** (`concat.ts` `simplification:`): the straddling segment's sound is shorter than its picture by the excess and the next segment's sound is pulled earlier by it (-64 ms measured, both majors). Upgrade: `aresample=async=1:first_pts=0` ahead of the pad.
- **A scan replaced mid-run keeps running in main** until it answers (its result is dropped by the panel); the highlight finder's Cancel still cancels the old scan.
- **`swallowRepeatClicks` costs a legitimate fresh double-click begun within 500 ms of a dialog closing** its second press.
- **The Export card's folder chip stays enabled while an export runs** (its chooser changes the NEXT export's folder; the ticket named the four side panels).
- **Quit on a Windows shutdown or logoff** (see above) is unreachable from this box.
- **record.spec.ts "a window that closed while the start was still opening ends the take the moment it begins" ([T-124] (1)) is load-sensitive, and not from this round:** on a 4-core box shared with other suites (load average 6 to 10) it failed in 2 of this round's 4 full Playwright runs (the other 2 passed all 354), and in isolation on the pristine pre-T-131 tree (`327ccbf`, built and run in a scratch directory) it failed 4 times in 32 runs, against 4 in 35 on this tree, the failure being the same on both: the take is still recording (`REC 00:29`, the Stop button) and "Finishing up - converting to MP4..." never appears within 30 s, i.e. `watchScreenEnd`'s check of a track that ended during the start's awaits did not end the take on that run. It passes in most runs (28 of 32 isolated runs on the base tree, 31 of 35 on this one, and the whole `record.spec.ts` file 38 of 38 on both). Not investigated further here (Record's start path is outside this ticket); the upgrade is to find which await in `RecordStudio.tsx`'s start the check races.
- **video-pipelines.spec.ts "a ranged burn with no cue in its range says so; with a cue it says burned in" ([T-89]) failed in 1 of this round's 4 full Playwright runs, in code this round did not touch:** the burn finished (the button enabled again, both files written) and a progress bar was still in the captions card 5 s later (`Expected: 0 Received: 1` at the T-108 line that asserts the finished burn leaves no "Done 100%" row). `CaptionsPanel.tsx` has no diff against the pre-T-131 tree. It passed 16 of 16 isolated runs on this tree and 16 of 16 on the pristine base. A hypothesis, not verified: a `captions:progress` event delivered after `burnIn`'s `finally` has already called `setProgress(null)` puts the row back, because the panel's listener is unconditional (`onProgress((p) => setProgress(p))`); the upgrade is to drop a progress event that arrives with no job running.
- **Two main-process tests build their fixture from `os.tmpdir()` and break on a long temp path:** `src/main/ipc/settingsFolders.test.ts` ("a string that looks like a missing path is still just a string under a key that is not a folder") and `src/main/ipc/settingsFolderDeadline.test.ts` ("a key that is not a folder key is never stat'd") store `<tmpdir>/imagii-settings-...-XXXXXX/<name>` under `streamerHandle`, whose schema allows 80 characters, so a `TMPDIR` longer than about 31 characters (found with an 88-character one) fails them with `Config schema violation: streamerHandle must NOT have more than 80 characters`; a Windows CI runner's short temp path is about 40 characters. Neither file is touched by this round. The upgrade is a short literal in place of the path-shaped fixture (the test is about a string that merely LOOKS like a path).

---

## Dispositions — round 81 (T-132: the review gate's eighteenth pass)

Fourteen findings from sweep 18 (a completion that moved the person off a live take, a documentation line a merge reverted, a verdict taken from an exit code a second time, a "Loaded" that landed before the work it announced). Every behavior change was red-first: the new test run against the old product code (unit tests before the fix; the e2e cases against a build of the unchanged tree at `1304e0a`) or the finished fix mutated out by content-replace with a sha256 triple (r81/ledger.tsv; every restore byte-identical); item 4 on both ffmpeg majors. The story is in `LESSONS_LEARNED.md`, 2026-10-24 (T-132).

### Video Studio

- **Video - Clean audio, when the extraction ends ([T-132] (1), end state changed; revises "Clean audio does not replace what was opened in Audio Studio while it was extracting ... ([T-125] (20))" above):** a person still on Video Studio is taken to Audio Studio as before ("Opening Audio Studio"); anyone else keeps their screen. The sound is loaded, and a toast reads "Extracted the sound from <video>" with an **Open Audio Studio** button (8 s, like every action toast); on Audio Studio itself the same sentence has no button. E2E: video-pipelines.spec.ts "Clean audio finishing while the person is elsewhere loads the sound and offers Open Audio Studio instead of taking them there" (the extraction is held 7 s; the person is on Stream Graphics: no "Opening Audio Studio", the toast and its button are still there 3 s later, the button opens Audio Studio on the sound; then on Audio Studio itself: the sentence alone, no move) and, for the stay case, every existing Clean audio case (they still navigate). Red on the unchanged build: `Received: ["Video loaded", "Extracting audio…", "Opening Audio Studio"]`. Unit: `ProjectIO.test.ts` (`currentRoute`), `interactionWiring.test.ts` (the route is read after the wait; two navigations: the stay branch and the toast's button).
- **Video 4o CaptionsPanel - Clear saved transcripts, the row ([T-132] (3), layout changed):** the row wraps by item and the button's label never wraps by word, at the default window (1632 px) and the minimum (1024 px). E2E: video-pipelines.spec.ts "the Clear saved transcripts row keeps its label on one line and inside its card at the default window and the minimum" (`expectOneLine` on the button and the count sentence, `expectControlsWhole`, `expectNoHorizontalOverflow` on the card; red on the unchanged build: the button and the sentence "wrap onto 2 lines" at both sizes). Unit: `interactionWiring.test.ts` (the classes; each removal is red).
- **Video 4o CaptionsPanel - Clear saved transcripts, a clear that got part of the way ([T-132] (14), end state changed):** a warning toast (the warning icon, 8 s), not a green tick: "Cleared 2 of 3 saved transcripts. The rest are open in another program; close it and clear again."; a whole clear is still the green success and a total refusal the red error. E2E: video-pipelines.spec.ts "a clear that got part of the way is a warning, not a green tick; a whole one is still a success" (main's handler answers `{ removed: 2, failed: 1 }`, as a held file produces on Windows; the card has the icon svg and no `OK_STRONG` disc; the whole clear has the disc and no svg). DISPOSITION: the OS refusing the delete is Windows' (a Linux file open elsewhere unlinks fine); the handler's answer is substituted in main, and everything from the click to the card is real. Unit: `captions.test.ts` (`clearedTranscriptsMessage`, unchanged), `interactionWiring.test.ts` (the three-way branch).
- **Video 4s CustomPresetManager - Base on ([T-132] (7), end state changed):** picking a platform sets all five boxes: size, frame rate, video and audio bitrate (YouTube 1080p60: 1920, 1080, 60, 12M, 192k; Reels: 1080, 1920, 30, 6M, 128k). E2E: video-pipelines.spec.ts "saves, lists, queues and deletes a custom preset" now reads the boxes after YouTube 1080p60 and after Reels (red on the unchanged build: `Expected: "60", Received: "30"`). Unit: `presets.test.ts` (`customPresetStartFor`, every platform, and equal to the grid's table), `presetTablesInSync.test.ts` (the renderer's bitrates equal main's), `interactionWiring.test.ts`.
- **Video 4t ExportPanel, 4k ReframePanel, 4e ClipKitButton - a clip with no picture ([T-132] (4), failure path changed):** an Export of a range past the picture is a failed row with a sentence ("The clip "<name>" has no picture in the video (check its start and end), so nothing was exported."), a Reframe is "This part of the video has no picture (check the clip's start and end), so no 9:16 file was saved.", and a Clip Kit thumbnail that gets no file is "The video has no picture at that point (check the clip's start and end), so the thumbnail was not saved."; none leaves a file. They were "Exported", "Saved" and "Saved your Clip Kit" over a 261-byte stub, an audio-only mp4 and a missing JPEG. DISPOSITION: the panels' rows and toasts are the existing failure paths (a finished sentence stands as written, `userFacingError`); the new end state is main's, and it is held at Layer 5 on real files, not in a driven panel. Layer 5 (both majors): media.spec.ts "a clip with no picture is an error in a sentence, not a file that says Exported" (9: the control, past the end of the file, past the last frame of a file whose sound runs on, a straddle, 20 ms and 10 ms clips, Reframe's four cases, `extractFrame`, and what each binary prints). Unit: `noPicture.test.ts` (22), `frame.test.ts` (its fake ffmpeg writes its JPEG now).
- **Video 4m CompilationPanel - the two refusals ([T-132] (12), copy changed; revises the T-131 (1) sentences above):** the empty clip is named by the name the person sees ("The clip "Boss fight" has no picture ...", not "Clip 2 of the compilation": default names are creation-numbered, so a position names the wrong clip), and the join that cannot read a clip names it (read off ffmpeg's own "Impossible to open '.../seg-<job>-<n>.mkv'" line) and says what to do ("Try again, and if it keeps happening, leave that clip out."). Layer 5: media.spec.ts "a segment of a range the PICTURE does not reach ..." (the new sentence) and "the join's "Impossible to open" line names the segment file ..." (both majors). Unit: `concat.test.ts`, `concatRunner.test.ts`.
- **Video 4t ExportPanel - the watermark / template / folder writes, refused ([T-132] (13), end state changed):** one red card, not one per write. E2E: video-pipelines.spec.ts "Export still runs when main refuses to remember the watermark and the template" now counts the sentence in the toast log (1; red on the unchanged build: 4). Unit: `persistSetting.test.ts`, `reportFailure.test.ts` (the optional `id`), `failurePathLanguage.test.ts`.

### Record

- **Record - a live take while Clean audio's extraction ends ([T-132] (1), end state changed):** the person stays on Record, the REC clock keeps counting, the take is saved whole (the save dialog opens over Record), and the sound waits in Audio Studio with the toast that offers the way there. E2E: record.spec.ts "Clean audio finishing during a live take does not move the person or cut the take short" (the extraction is held 14 s; red on the unchanged build: "Opening Audio Studio", then a take of 0.1 MB).
- **Record - the 8 Mbps ceiling's wording ([T-132] (8), copy changed):** USER_GUIDE and the RecordStudio comment no longer call 8 Mbps "the top export preset's rate" (12M is the top now); a recording's ceiling is its own. No element changed.

### Audio Studio

- **Audio - Play while the waveform is drawn ([T-132] (9), look changed):** `disabled:opacity-50`, like every other disabled button. E2E: audio.spec.ts "while the waveform is being drawn Play is dimmed and nothing says Loaded; when it arrives Play is live and the file is Loaded and in Recent" (the peaks job's ffmpeg is held 5 s; computed opacity below 0.7 while off, 1 once it can play; red on the unchanged build: opacity 1). Unit: `interactionWiring.test.ts`.
- **Audio - the waveform's scale ([T-132] (5), end state changed):** one scale for both halves, the loudest sample of either (`maxPeak`). E2E: audio.spec.ts "an asymmetric take draws both halves to scale: quiet highs, loud lows" (a +0.2 / -0.8 square wave; the canvas is read back: the lows fill their half, the highs reach a quarter as far; red on the unchanged build: the highs filled their whole half, 48 px). Unit: `audio.test.ts` (`peaksMaxMagnitude`), `interactionWiring.test.ts` (the option is passed, and the installed wavesurfer types and honors it).
- **Audio - a file the PLAYER cannot play, the sentence ([T-132] (10), copy changed; revises the T-129 row above):** "imagii can't play this file here, but the waveform, cuts and export still work on it. To hear it, re-export it as a standard PCM WAV or MP3." E2E: audio.spec.ts "a file the player cannot play still shows its waveform, ..." (the pin moved). Unit: `audio.test.ts`.
- **Audio - "Loaded" and the Recent entry ([T-132] (11), end state changed):** they come when the file's waveform arrives; a file main then refuses gets neither. E2E: audio.spec.ts "a file main cannot read the sound of is refused while its waveform is drawn" (no "Loaded" in the toast log, nothing in `recentFiles.audio` on disk, no Recent button; then a readable file is Loaded and in Recent) and the Play case above (nothing is said while the waveform is held; both arrive with it; red on the unchanged build: `Received array: [..., "Loaded"]`). Unit: `audioStore.test.ts` (`waveformArrived`: arrives, already drawn, refused, closed, replaced), `interactionWiring.test.ts`.

### Home

- **Home - Open project and Autosave Restore, the good-news line ([T-132] (11), end state changed):** "Project loaded" and "Restored from autosave" wait for the waveform of the sound the open put in Audio Studio (`outcome.audioOpened`), so a project whose sound main refuses is not announced green beside the red refusal. DISPOSITION: no e2e drives a refused sound through a project open; the deepest layer is `ProjectIO.test.ts` (`audioSettled`: no sound, a sound that arrives, a sound refused before anyone asked, a sound that could not be opened at all) over the real stores and the real `applyProject`, and `interactionWiring.test.ts` for the two callers (the restore's navigation does not wait for the line).
- **Every studio's tour - a held Enter or arrow ([T-132] (6), end state changed):** one step, whatever the key does while it is held; the tour is not finished and not marked seen. E2E: home-chrome.spec.ts "Video tutorial: a held Enter steps once, a held arrow steps once, and the tour is neither finished nor marked seen" (Playwright marks the repeats of a key already down; red on the unchanged build: the repeats walked the tour on). Unit: `Tutorial.test.ts` (`tutorialKeyIntent`: a repeat is held, a fresh press is untouched), `interactionWiring.test.ts`.

### Not an element, but covered

- **ffmpeg (IMG-PREC):** item 4 on both majors (above). The mechanism differs from the ticket's direction: the "Output file is empty" line is sticky-read in Export and Reframe as the ticket said, AND the final `frame=0` of the progress block is read, because the audio-only shape prints no such line (measured on both majors); the ticket's trigger 2 is caught by the second fact alone. Mutations at Layer 5: exit-0-alone back in Export, Reframe and `extractFrame` (red on both majors); the progress count removed from Export (the audio-only case red, on both majors); a guard that calls fewer than 3 frames empty (the 10 ms and 20 ms cases red). Item 12 changes sentences, not commands.
- **Docs:** PRODUCT_GUIDE:35 restored and `docClaims.test.ts` extended (item 2; the round-78 "Docs" row above is corrected in place); USER_GUIDE (items 8, 10, 11, 1, 14, 7); STYLE_GUIDE (the waveform scale and the order of "Loaded", the settings toast id, the completion that outlives its screen, the exit-code rule); TESTING (counts).

### Found, not fixed

- **The tour guards a held ArrowRight / ArrowLeft as well as Enter** (the ticket named Enter; the arrows step by the same `next` / `prev` and would walk to Done the same way). A person who wants to flip through quickly presses the key again; if a held arrow is wanted as a fast-forward that is a product call.
- **ExportPanel's third "five platforms" comment is Clip Kit's** (line 81: "choosing "all five platforms" already answers the question it asks") and is still true - the kit writes five files - so it was left; the two that counted the GRID (the `gridTargets` doc and the T-50 JSX note) and `customPresetParse.ts` now count six.
- **`PLATFORM_INFO` carries bitrates the grid does not print:** `COMPILE_TARGET` (a compilation, not a platform) fills the two required fields with YouTube's video figure and the join's 192k; nothing reads them for it.
- **Clean audio announces before the waveform too** (`cleanAudioFlow`: "Opening Audio Studio" / "Extracted the sound from ..." are said when the sound is LOADED, not when its waveform arrives). The sound is imagii's own scratch WAV, which main can read by construction, so a refusal there is not a case anyone has produced; the importer and the project open (the files a person brings) wait, this does not.
- **A window's worth of "Project loaded" delay:** with a long sound the green line arrives when its waveform does (seconds), after the studios are already on screen.

---

## Dispositions — round 82 (T-133: the review gate's nineteenth pass)

Eleven findings from sweep 19 (a toast's button that cut a live take short, a toast that wrote outside its own card, the one ranged video writer left without the no-picture guard, a held key that undid what it had just done, a second guard that was a guess about the clock). Every behavior change was red-first: the new test run against the old product code (unit tests before the fix; the e2e cases against a build of the unchanged tree at `d90c01b`) or the finished fix mutated out by content-replace with a sha256 triple (r82/ledger.tsv; every restore byte-identical); item 4 on both ffmpeg majors. The mechanisms that differ from the ticket's direction are named where they differ.

### Record

- **Record - a toast's way off the screen while a take is live ([T-133] (1), end state changed; extends "a live take while Clean audio's extraction ends ([T-132] (1))" above):** the Home link, the "Open Audio Studio" button in Clean audio's toast and the saved-file toasts' "Edit in Video Studio" (Record's, Reframe's, the audio re-attach's) all ask the Home link's question ("A recording is in progress. Stop and save it before leaving? (Cancel keeps recording.)") while a take is being recorded, through ONE function (`mayLeaveLiveTake`, `lib/liveTake.ts`; Record registers the take for as long as its phase is "recording"). Cancel keeps the take running on Record (REC clock counting, nothing loaded, nothing navigated); OK stops it and its normal save runs on Record, and the person is not moved. With no take, no question. E2E: record.spec.ts "a toast's way off the Record screen asks first while a take is live: declining keeps the take, accepting saves it on Record" (Clean audio's extraction held 12 s so its toast lands mid-take; declined: the dialog text, still on Record, Stop visible, the clock still counting, no "Opening Audio Studio"; accepted: the take is saved as a file as long as the clock said, the person is still on Record) and "\"Edit in Video Studio\" pressed while the next take is live asks first, and loads nothing" (the first take's button held on screen by the pointer, a second take started under it; declined: Record, Stop, no replace-the-video question; accepted: the second take is saved on Record). Red on the unchanged build: no dialog (`Expected: 1 Received: 0`) in both. Unit: `liveTake.test.ts` (nothing live, declined, accepted, unregistered, a stale unregister), `interactionWiring.test.ts` (Record registers; the Home link asks through the same function and holds no copy of the sentence; the hook asks ahead of the replace question; the set of renderer `navigate()` calls is a decided table).

### Video Studio

- **Video - Clean audio, work tuned while it extracted ([T-133] (6), end state changed; extends "Clean audio does not replace what was opened in Audio Studio while it was extracting ([T-125] (20))" above):** the first question ("Replace the audio you're editing?") is still asked once before the wait; when the extraction ends and the chain Audio Studio holds is no longer the one that question was about, it is asked again over what is there now, and a decline keeps the work: "Skipped this video's sound to keep the changes you made in Audio Studio while it was extracting" (8 s, warning icon), nothing loaded, nothing navigated. Work the person already agreed to lose before the wait is NOT asked about twice (the ticket's direction, "when `confirmAudioClose` would now ask", would have asked again about work they had just said yes to; the chain object is the difference). E2E: video-pipelines.spec.ts "Clean audio asks again about work tuned while it was extracting: declining keeps the tuning; work agreed to be lost is not asked about twice" (three runs: tuned during the wait and declined - the question, the Skipped line, Medium still pressed, tone.wav still the file; tuned BEFORE the press and accepted - asked once, not again, the new sound has a clean chain; clean at the press, tuned during the wait, accepted - asked, replaced). Red on the unchanged build: no question after the wait (`Expected: 1 Received: 0`). Unit: `AudioStudio.test.ts` (`confirmReplaceAfterWait`: unchanged, tuned, declined, more work on top, tuned and undone), `interactionWiring.test.ts` (the chain is kept before the first question; the second question sits after the extraction and the different-file check and before the load).
- **Video 4o CaptionsPanel - Burn into video over a range with no picture ([T-133] (4), failure path changed; the sibling of "a clip with no picture ([T-132] (4))" above):** a ranged burn whose range lies past the picture is the sentence "This part of the video has no picture (check the clip's start and end), so no captioned video was saved." (a red toast), not "Captions burned in" over an audio-only file; no file is left where the captioned video was to be (and the shifted SRT beside the transcript goes, as on every other end). The progress row goes and the button is live again. E2E: video-pipelines.spec.ts "a ranged burn over a clip that lies past the end of the video is a sentence, not \"Captions burned in\", and leaves no file" (a project whose clip is 5-6 s of a 2 s video; red on the unchanged build: the toast log was `["Captions burned in"]`). Layer 5 (both majors, IMG-PREC): media.spec.ts "a ranged caption burn-in of a range with no picture is an error in a sentence, not \"Captions burned in\"" (7 cases: the control with its cue; past the end of the file; past the last frame of a file whose sound runs on, with the subtitles stage and without it; a range that straddles the last frame; 20 ms and 10 ms ranges, which stay successes with a picture; and a whole-video burn untouched). The mechanism is Export's and Reframe's (`PictureFrames` on `-progress`, the sticky "Output file is empty" line), measured on both binaries: the audio-only shape prints no stderr line and reports `frame=0`; the stub shape is not produced by the burn-in's `-c:a copy` command, and is held by the unit file. Unit: `burnInNoPicture.test.ts` (11: both shapes, the shifted SRT and the file go, the line found past the kept 16 KB tail, a whole-video burn, a one-frame clip, a count split across chunks, a stream that never said, a real failure keeps its words), `noPicture.test.ts` (the sentence). The GIF needs nothing: a GIF of such a range already fails (exit 234, measured on both).
- **Video 4e ClipKitButton - a thumbnail on a share whose clock runs behind ([T-133] (5), end state changed; extends T-132 (4) above):** a good thumbnail is accepted whatever its timestamp says. `wroteOutput` asked "newer than the spawn, 2 s of slack" (the discard path's rule) and refused a GOOD file written by a share whose clock ran more than 2 s behind, aborting the kit with a false "no picture"; it asks now only whether a non-empty regular file is there. What makes that sound: the thumbnail goes into the kit's fresh folder (`makeKitDir`) and `extractFrame` refuses a target that already exists, before ffmpeg runs, leaving the old file exactly as it was. DISPOSITION: the OS clock of a network share is not drivable; the deepest layer is unit, with a fake ffmpeg whose file carries a timestamp a minute in the past (`noPicture.test.ts`, red on the unchanged code: the thumbnail is refused as "no picture"), real files in `partialOutput.test.ts` (`wroteOutput`: a non-empty file however old, nothing / empty / a folder are not), and `cancelSentinel.test.ts` (the "left alone" row does not apply to a runner that refuses before it spawns). The ffmpeg command is unchanged (the Layer 5 case "extractFrame: a time past the last frame is a sentence" still holds it).
- **Video 4b Player and 4e Timeline - a held Space ([T-133] (7b), end state changed):** one play/pause per PRESS; the auto-repeats do nothing (they flipped it at the keyboard's repeat rate, a stutter). The nudge (arrows) and frame-step (`,` `.`) keys still repeat by design. E2E: video-core.spec.ts "a held Space plays once, in the Player and on the Timeline; a held arrow still repeats" (four keydowns of one held Space, an even number so the old behavior ends paused: red on the unchanged build `a held Space started it, once: Expected: false Received: true`; then the same on the track's slider; then four keydowns of a held ArrowRight move the playhead four steps). Unit: `interactionWiring.test.ts`.
- **Video 4a Importer - Choose file while a file loads ([T-133] (9), look changed):** `disabled:opacity-50`, like every other disabled button (it was `disabled` and drew like a live one; the label does not change). E2E: video-pipelines.spec.ts "the Importer's Choose file is dimmed while a file is loading, and live again when it is not" (the probe is held 4 s; the computed opacity is polled below 0.7 while "Loading…" shows; red on the unchanged build: opacity 1). Unit: `interactionWiring.test.ts` ("every disabled button looks disabled": a syntax-tree scan of every `<button disabled>` in the renderer, with a discrimination block over sample code; red on the unchanged tree: the five, by file and line).

### Audio Studio

- **Audio - the Importer's Choose file while a file loads ([T-133] (9), look changed):** as the video Importer's, with the label "Loading…". E2E: audio.spec.ts "the Importer's Choose file is dimmed while a file is loading".
- **Audio - the Fix wizard's Apply, held ([T-133] (7a), end state changed; extends the T-120 (10) held-Enter case):** a held Enter on Apply applies once and the dialog stays closed: the repeats land on "Help me fix this", where focus went back to, and used to open the wizard again from question 1. E2E: audio.spec.ts "Fix Wizard: a held Enter on Apply applies once; the repeats do not reopen the wizard" (the repeats arrive 800 ms after the press, as after a real OS repeat delay; a fresh press afterwards opens the wizard again: the guard is not a latch; red on the unchanged build: `the repeats reopened the wizard`).
- **Audio - the waveform's refusal, the sentence ([T-133] (10), copy changed; revises the T-129 row above):** "imagii couldn't read the sound in this file to draw its waveform. It may be damaged or in a format imagii can't read here. Re-export it as a standard PCM WAV or MP3 and try again." (the file it fires on, a WAV whose format tag no decoder knows, is a WAV: "WAV or MP3" sent it back to the format it was in). E2E: audio.spec.ts "a file main cannot read the sound of is refused while its waveform is drawn" (the pin moved; red on the unchanged build). Unit: `audio.test.ts`.

### References

- **References - Reference Search, Enter while a search is out ([T-133] (8), end state changed; its "different query typed meanwhile is one request" half is REVISED by [T-134] (3), see "Dispositions - round 83"):** the Search button was disabled while a request was out and the input's Enter was not: a second Enter (or a held one) sent a second request and the last answer owned the grid. The guard is in the store's `search`, the one function the button, Enter and any future shortcut call (not in the panel's `submit`, as the ticket's direction had it: a render's closure is stale for two presses in one breath). E2E: references.spec.ts "Reference Search: Enter while a search is out sends nothing more, and the next one goes out when it is answered" (main's handler is held open and counts its calls: Enter, Enter, Enter and a different query typed meanwhile are ONE request; after the answer, the next Enter goes out; red on the unchanged build: three requests for four presses). Unit: `referencesStore.test.ts` (three presses, one request; the next search after the answer; a failed search gives the slot back).

### Home

- **Every studio's tour - a held Enter on Done ([T-133] (7a), end state changed; extends "a held Enter or arrow ([T-132] (6))" above):** the tour closes once and stays closed: focus goes back to the "?" that opened it, and the key's auto-repeats (keyboard clicks on that button) no longer reopen it. The guard is on the KEY, not on a clock (`createHeldKeyGuard`, `lib/repeatPress.ts`, armed by `swallowRepeatClicks` when any dialog closes: the ticket's direction was a fixed `REPEAT_SWALLOW_MS` window, which a real OS repeat delay of 500 ms or more outlasts - the e2e's repeats arrive 800 ms after the press, and the 500 ms variant is a mutation the case kills). A fresh press, a key-up and a window blur clear it. E2E: home-chrome.spec.ts "Video tutorial: a held Enter on Done closes the tour once; the repeats do not reopen it" (started from the "?" button, to the last step, Enter held on Done, six repeats after 800 ms; then a fresh Enter on the "?" opens the tour: not a latch; red on the unchanged build: `the repeats reopened the tour`). The same guard covers every Modal's confirm (the Fix wizard above). Unit: `repeatPress.test.ts` (`createHeldKeyGuard`: seven cases), `interactionWiring.test.ts`.
- **Shortcuts overlay - a held `?` ([T-133] (7b), end state changed):** one toggle per press (it opened and shut at the keyboard's repeat rate). E2E: home-chrome.spec.ts "Shortcuts overlay: a held ? opens it once and it stays open" (four keydowns: open; a fresh press closes it; red on the unchanged build: the overlay is shut). Unit: `HotkeyOverlay.test.ts`.
- **Autosave banner - Restore and Clear while one of them runs ([T-133] (9), look changed):** the three `disabled` buttons are dimmed (Restore, Clear on the healthy banner; Clear on the damaged one). Restore's label read "Restoring…" while ANY of the banner's actions ran (one busy flag; REVISED by [T-134] (7), which split it: see "Dispositions - round 83"). E2E: home-chrome.spec.ts "AutosaveRestore: Restore and Clear are dimmed while one of them runs; Later stays live" and "the damaged banner's Clear is dimmed while the clear runs" (main's `autosave:clear` is replaced by a handler that waits 4 s and removes the file, so "while it runs" is a state the test creates; Later and Dismiss stay at opacity 1; red on the unchanged build: opacity 1).
- **Toasts - a long file name in the message ([T-133] (2), layout changed):** the text wraps inside the 350 px card (`overflow-wrap: anywhere`; it ran outside it by as much as the name was long: 81 px for one name, 228 px for the 90-underscore one the e2e uses). E2E: image.spec.ts "a name with no break in it wraps inside the toast card instead of running out of it" (a 90-underscore file name dropped on Stream Graphics; the message's right edge against its card's; red on the unchanged build: the text ends at 973 against a card ending at 745). Unit: `AppToaster.test.tsx` (the style on the element the app mounts).

### Not an element, but covered

- **ffmpeg (IMG-PREC):** item 4 on both majors (above). The Layer 5 block ran on the bundled 7.0.2 (`npm run test:media`) and on the distro's 6.1.1 through the alias config; the "exit 0 alone again", "progress count ignored" and "a one-frame clip is called empty" mutations are red on both. Item 5 changes no argv (the check after the exit and a refusal before the spawn).
- **`clipNameForSentence` ([T-133] (3)):** cut by code point; a name of 60 emoji is 49 glyphs and an ellipsis, not 24 glyphs, half of one and an ellipsis. Unit: `noPicture.test.ts`.
- **Docs:** `docClaims.test.ts` holds the three item-11 corrections (the `reportFailure` signature is read off the real function, USER_GUIDE's waveform timing, the "every runner" claim); USER_GUIDE (the waveform timing, "a few seconds" -> up to a few tens of seconds; the live-take question for every way off the Record screen; Clean audio's second question; Reference Search's single request); STYLE_GUIDE (the `reportFailure` signature gains `id?`; the no-picture claim now says which runners it covers; the live take, the held key, the Clean audio re-ask, the single-flight store, the disabled look, the toast wrap, the code-point cut, `wroteOutput`); TESTING (counts).

### Found, not fixed

- **`importDiagnostics`' "can't read this audio format" sentence has the same circular advice** ("Re-export it as WAV or MP3 and try again.", `src/shared/importDiagnostics.ts`): the ticket scoped item 10 to `WAVEFORM_READ_FAILED`; a WAV that ffprobe cannot read at all reaches this one. Moving it to "a standard PCM WAV or MP3" is a one-line change with its pin (`importDiagnostics.test.ts`).
- **The held-key guard covers Enter and Space only.** Those are the two keys whose auto-repeat is a click; another held key that closes a dialog (Escape closes one dialog per press by the topmost-claim rule) does not need it.
- **`T-110 (p)`'s wording in `docs/TICKETS.md` is now stale** (the success path no longer shares the discard path's mtime slack; the discard path's ceiling stands): the worker may not edit the tickets file, so the wording is for the expediter.

---

## Dispositions — round 83 (T-134: the review gate's twentieth pass)

Seven findings from sweep 20 (a restore that navigated after a wait the person had spent elsewhere, a held marker key that filled the undo history, a guard that refused the question that was different, a name that pushed Delete out of its dialog, and three documentation claims the code contradicted). Every behavior change was red-first: the new test run against the old product code (unit and wiring pins before the fix, or on the unchanged tree `eed3101` kept as r83/base) and the six new or changed Playwright cases against a build of that unchanged tree, or the finished fix mutated out by content-replace with a sha256 triple (r83/ledger.md; every restore byte-identical); the Layer 5 pin on both ffmpeg majors.

### Home

- **Autosave banner - Restore, when the apply outlasts the person ([T-134] (1), end state changed; the one site left of "a live take while Clean audio's extraction ends ([T-132] (1))" and "a toast's way off the screen ([T-133] (1))"):** `restore()` awaits the apply (minutes, for a sound that is extracted again) and then goes to the snapshot's route only if the person is STILL on Home (`currentRoute() === '/home'`, read after the await). Anyone who went elsewhere keeps their screen; the restored work is in its studio and "Restored from autosave" says it is done. The T-133 navigate table had blessed this site as "the autosave Restore is on Home", a premise of the click that is false at the `navigate`; its comment is corrected and the table still holds one `navigate` here. E2E: record.spec.ts "an autosave Restore that finishes after the person went to another screen leaves them there, and a live take runs on" (the extraction is held 14 s; Restore, then Record and a live take; the restore ends in the middle of it: the hash stays `#/record`, Stop is still there, the clock keeps counting, the take is saved whole and as long as the clock said, and the restored sound is in Audio Studio; red on the unchanged build: `Expected: "#/record" Received: "#/video"`). The other half, a person still on Home IS taken to the studio they were in, is continuity.spec.ts "two studios, a window close, and a relaunch that offers the whole session back" (unchanged, green). Unit: `interactionWiring.test.ts` (the T-134 block: the read comes after `await applyProjectHeld`, one `navigate` in the file).
- **Autosave banner - Clear while it runs ([T-134] (7), label changed; REVISES the T-133 (9) row above, which called the shared "Restoring…" intended):** the two buttons have a busy flag each (`restoring`, `clearing`). Pressing Clear leaves Restore reading "Restore" (dimmed: both buttons act on one file, so either running dims both), instead of "Restoring…" for the unlink's duration. E2E: continuity.spec.ts "Clear does not relabel Restore: it stays \"Restore\" (dimmed) while the clear runs, and the banner goes when it is done" (main's `autosave:clear` is held open and removes the file when released; red on the unchanged build: `Expected: "Restore" Received: "Restoring…"`). Unit: the T-134 wiring pin; the T-57 and T-123 pins follow the renamed flags. The existing home-chrome.spec.ts dimmed-button cases are unchanged and green.

### Video Studio

- **Video 4b Player and 4e Timeline - a held I or O ([T-134] (2), end state changed; extends "a held Space ([T-133] (7b))" above):** one mark per PRESS, in both handlers; the auto-repeats do nothing (each used to set the point again and push an undo step: 60 repeats filled the store's 50-step history and evicted real edits, and during playback the in point drifted to the last repeat's frame). Arrows, `,` and `.` still repeat by design. `preventDefault` still runs on a repeat. E2E: video-core.spec.ts "a held I or O marks once: one Undo takes it back, in the Player and on the Timeline" (four keydowns of one held key, then ONE Undo: the point is back where it started; I and O, in the Player's column and on the track's slider; two separate presses are still two steps; red on the unchanged build: `ONE Undo took the held I back to the start: Expected: 0 Received: 0.5`). Unit: the T-134 wiring pin (and the T-119 and T-133 (7b) pins follow the guard).
- **Video 4t ExportPanel - the safe-zone warning, a clip with a very long name ([T-134] (5), layout changed):** the clip's name in the warning's list is cut with an ellipsis and carries all of itself as the tooltip, so the list no longer scrolls sideways inside its card (the list is an `overflow-y-auto` box, which scrolls the other axis too). E2E: video-pipelines.spec.ts "a clip with a very long unbroken name is cut with an ellipsis in the safe-zone warning, and the list does not scroll sideways" (a 126-character unbroken name; `expectEllipsized`, `expectNoHorizontalOverflow` on the list and on the dialog and `expectControlsWhole` on its buttons, at the default window and the 1024 px minimum; red on the unchanged build). Unit: the T-134 wiring pin and `a11ySweep.test.ts` rule 6 (a cut name carries a `title`).
- **Video 4s CustomPresetManager - a very long preset name ([T-134] (5), layout changed):** the saved-preset row cuts the name with an ellipsis (whole name as the tooltip) and the numbers and Delete never move: an 80-character unbroken name used to put Delete at x=905 against a card that ends at 848 (measured in real Chromium; the threshold is about 72 characters). The name box takes at most 60 characters (`maxLength` on the input); a longer name already on disk (saved before the cap, or edited by hand) is cut by the row. E2E: video-pipelines.spec.ts "a very long unbroken preset name is cut with an ellipsis and Delete stays inside the dialog; the name box takes at most 60 characters" (presets of 80 and 200 characters and a short one are WRITTEN to the presets folder; `maxlength` is 60 and typing 75 characters stops at 60; both long names are ellipsized with their whole text as the tooltip, every Delete is whole and inside the dialog and the dialog does not scroll sideways, at both window sizes; the short name is not cut; Delete on the longest row still deletes; red on the unchanged build: the input has no `maxlength`). Unit: the T-134 wiring pin.

### References

- **References - Reference Search, a corrected query ([T-134] (3), end state changed; REVISES "Enter while a search is out ([T-133] (8))" above):** T-133 (8) refused every press while a request was out, which threw away a corrected query (type, Enter, see the typo, fix it, Enter) and left the typo's answer on a grid no query on the page named. Now a press of the query that is already out still sends nothing (a held Enter is one request); a DIFFERENT query goes out at once; and only the newest request's answer, failure and idle state are drawn, so the typo's late answer neither fills the grid nor un-busies the search that replaced it (the mechanism is the ticket's second option, a sequence number; the first, a single follow-up after the flight, would have made a person on a slow connection wait for the typo and then the correction). E2E: references.spec.ts "Reference Search: a held Enter is one request, a corrected query is answered, and the typo's late answer never replaces it" (main's handler holds the FIRST request open and answers the rest at once with a one-pixel `data:` image titled with its query: Enter three times is one request; the corrected query is asked and its result is on the grid while the typo is still out and the button is idle; when the typo is released its result never appears; red on the unchanged build: the corrected query was never asked). Unit: `referencesStore.test.ts` (the T-133 (8) drop-test is flipped; the typo's answer is never drawn, even for a moment, in either answer order; a typo's failure leaves no error over the newest search).

### Not an element, but covered

- **ffmpeg (IMG-PREC):** item 4's optional Layer 5 pin, `media.spec.ts` "a compilation segment past the last frame of a 5 s picture with 9 s of sound is a streamless stub AND the empty-output line, so the line alone is enough": the segment written with the production filters, codecs and `-shortest` is a stub under a kilobyte that ffprobe cannot read, with ffmpeg's "Output file is empty" line; and `runConcat` over that source names the clip and leaves nothing behind. It pins measured behavior; no ffmpeg command changed. Run on the bundled 7.0.2 (`npm run test:media`) and the distro's 6.1.1 (alias config), green on both; the mutations (`-shortest` taken off the segment command; the stderr read removed) are red on both.
- **Docs:** the compilation-segments claim is corrected in `noPicture.ts` and STYLE_GUIDE (three runners call `wroteNoPicture`; the segments read the stderr line alone, measured sufficient), the `docClaims.test.ts` pin that held the over-claim now holds the correction, and a scan lists the callers of `wroteNoPicture` (a fourth fails until the two sentences are re-read); the toast overhang is "by as much as the name was long (81 px for one name, 228 px for the 90-underscore one)" at its five sites, not "up to 81 px"; USER_GUIDE (Restore leaves you where you are, the search's changed words, a held I or O); STYLE_GUIDE (the autosave Restore beside Clean audio, the marker keys beside Space, the guard that refuses a different question); TESTING (counts).
- **The native-dialog inventory (the table at the top of this file), refreshed against this tree ([T-134] (6)):** the Record confirm is `lib/liveTake.ts:34` (one asker since T-133 (1), reached from `RecordStudio.tsx`, `VideoStudio.tsx` and `lib/editInVideoStudio.ts`), and the second Clean-audio confirm T-133 (6) added (`VideoStudio.tsx`, after the wait) has its row; every line number was re-read against the source.

### Found, not fixed

- **A typo's request still runs to its end.** The newest-query rule (T-134 (3)) draws only the newest request's outcome, but main has no way to cancel a `search:images` call that is already out, so a corrected query costs one more DuckDuckGo request than a refused one did (user-triggered, to the same sanctioned destination, and never more than one per distinct query pressed). If that ever matters, an `AbortSignal` through the bridge is the upgrade.
- **The preset-name cap is the box's alone.** `video:saveCustomPreset` accepts any non-empty name; the 60-character `maxLength` stops the box, and the saved-preset row cuts whatever is on disk. Nothing reads the name as a path (the file is `<id>.json`), so the ceiling is cosmetic; a handler-side `assertAlways(name.length <= N)` is the upgrade if a second writer appears.
- **A clip's name has no cap at all.** The rename box in the clip list takes any length; the safe-zone warning now cuts it, and the other places that print a clip name (the queue rows, the Export panel's labels) already carry the ellipsis-and-tooltip rule (T-128 (1)). The name also reaches the output file name through the template, and `shared/filename.ts` sanitizes characters only, with no length cap; what an over-long path does on Windows was not tried.

---

## Dispositions — round 84 (T-135: the review gate's twenty-first pass)

Fourteen findings from sweep 21 (a job that outlived the screen that started it and left that screen lying about it, a video the preview cannot draw that said nothing, a spike finder that never merged, results that died with a visit, a button that could not send the correction its Enter could, two exports that said success over nothing or failed late and blamed the wrong file, and writes that failed without a word). Every behavior change was red-first: the new test run against the old product code (unit and wiring pins before the fix, or on the unchanged tree `2b0f717` kept as r84/base) and every new or changed Playwright case against a build of that unchanged tree, or the finished fix mutated out by content-replace with a sha256 triple (r84/ledger.md; every restore byte-identical); the two Layer 5 pins on both ffmpeg majors.

### Video Studio

- **Video 4t ExportPanel, 4l GifPanel, 4m CompilationPanel, 4n PipPanel, 4k ReframePanel, 4j HighlightPanel (Scan VOD), 4o CaptionsPanel, ClipKitButton, and the "Clean audio" button - a job that is running when the person leaves the studio ([T-135] (1), end state changed):** the run (its busy flag, its job id, its bar, its rows) lives in a module store (`lib/runStore.ts`, `video-studio/store/runs.ts`, `video-studio/store/exportQueue.ts`), so the panel that mounts again draws the job that is running: the primary button reads its working label and is off, the bar is drawn, and Cancel is there and reaches main. A retry no longer hits main's "An export is already running". The Export queue keeps its rows after the batch ends (they carry "Show in folder", "Failed", "Canceled") and draws them for the video they were made from, or while the batch runs; the rows take each file from the batch's own results, so a job-complete event that lands after the call resolved is not needed. Clip Kit's run belongs to ONE clip's row: that clip's button shows the label and the Cancel, the other clips' buttons are off while it works. Clean audio's second start is refused in main, in a sentence naming the video that is running (`audio:extractFromVideo` is single-flight, so the Audio Studio importer is covered too). E2E: video-pipelines.spec.ts "Leaving a studio mid-job (T-135 (1), (4))" - eight cases, each started on a 20-minute fixture or a held probe so the job is still running when the person is back: "a job that is running when the person leaves the studio is still running, with its Cancel, when they come back: Reframe, GIF and Compile", "Picture-in-picture: a composite that is running ...", "Export: the queue, its progress and its Cancel are still there after a trip to Home" (the bar moves past where it was; Cancel leaves nothing on disk), "Export: a batch that ends while the person is away shows its finished row when they come back" (the file lands and the toast says so while the panel is gone; back, the row is at 100% with its file name and Show in folder reaches the shell), "Clip Kit: a kit that is running when the person leaves is still running, with its Cancel, when they come back - and only on its own clip's row", "Scan VOD: a scan that is running ... a second press is not possible", and "Clean audio: the button stays off while its extraction runs, after a trip to Home; and a second extraction from the Audio Studio importer is refused by name" (red on the unchanged build: every one of the eight). Audio Studio's Export card (Audio ExportDialog) is the same shape: audio.spec.ts "an export that is running when the person leaves Audio Studio is still running, with its Cancel and its bar, when they come back" and "an export that ends while the person is away shows its finished row, with Show in folder, when they come back". Unit: `runStore.test.ts`, `exportQueue.test.ts`, `audioExport.test.ts`, `audioExtractSingleFlight.test.ts`, the T-135 wiring pins (each panel reads its run from the store, claims it with `begin()` and gives it back in a `finally`; none keeps a component-state spelling of it). **REVISES the T-112 rows above that drove "Export pressed again after leaving Video Studio" ([T-111]/[T-112] (19)):** that case's premise was a returning panel that believes nothing runs, with main's refusal on its row; the panel is no longer idle, so the case is rewritten as video-pipelines.spec.ts "after leaving Video Studio mid-batch there is no Export to press, and Clip Kit, the other door, is refused by main while the first batch runs" (back in the panel: "Exporting…" is disabled, there is no Export button, the row and Cancel are drawn; Clip Kit's batch, the other way to `video:exportBatch`, is refused by main with the same sentence as an error toast, the running batch's rows are untouched, the refused kit starts nothing and removes its empty folder; red on the unchanged build; the gate removed in main and the running flag ignored are both red). Captions' progress line is its own store (`useCaptionsProgress`), not a field of the run, because the T-89 case sends the engine's events from main with no engine behind them and the row has always drawn what main reports; the job's closure empties it when the job starts and ends.
- **Video 4j HighlightPanel, 4g ChatHighlightPanel and 4o CaptionsPanel - what a scan, a pasted chat log and a transcription produced ([T-135] (4), end state changed):** the scan's candidates, both pasted chat logs, the spikes found in the chat log and the transcript preview are kept with the open video in the video store (`derived`), applied to the video they were made for (`setDerivedFor`: a result that arrives after the video was replaced is dropped), emptied by loading another video or closing it, and not reset by any panel on mount. E2E: video-pipelines.spec.ts "scan candidates, pasted chat logs and found spikes are still there after a trip to Home, and a different video starts clean" (red on the unchanged build: the candidates are gone). Unit: `videoStore.test.ts` (the `derived` block: starts empty, patches, is applied to its own video only, reset by load and by close, what a panel leaves behind is still there for the next one). **Disposition (transcript preview):** a transcription needs the speech engine and a model download, an OS boundary this harness does not cross (see the whisper row of the Headless-limited table); the transcript preview is the same store field as the scan's, covered by the store's unit block and the wiring pin that CaptionsPanel reads `derived.transcript`, and the scan and chat halves above are driven for real.
- **Video 4b Player - a video whose picture the preview cannot draw ([T-135] (2), look and end state changed; adds one button):** ProRes, some H.265 and 10-bit files load in the player's element with no picture, no error event and a `play()` that resolves (measured in this Electron: `videoWidth 0`, `readyState 4`), so Play flipped to Pause over a black rectangle. The Player now hears the element's own verdicts (the `error` event with code 3 or 4, a rejected `play()` named `NotSupportedError`, and the metadata tell: a width of 0 for a file ffprobe says has a picture), shows a note under the picture ("imagii can't preview this video's picture format — trimming, scanning and export still work.") with a "Make a preview copy" button that converts a copy through the importer's own convert path, and `togglePlay` follows the `play()` promise instead of assuming it. The copy plays in the preview only (`previewUrl` in the store; the video's `source` object, the project and every export keep the original), is stored for the video it was made for, and goes with a load or a close. README's troubleshooting line no longer promises a preview for every codec it reads. E2E: video-pipelines.spec.ts "Player — a picture the preview cannot decode (T-135 (2))": "a ProRes file says so, keeps trim and export working, and a preview copy shows the picture while exports still read the original" (a real ProRes fixture: the note is shown with the element's width at 0 and no error raised; the clip row is untouched; an export from the undecodable preview writes a real mp4 with a picture; "Make a preview copy" runs the real convert, the note goes, the element then plays a file from imagii's import folder at the clip's width, the header still names the file that was opened, and a second export still reads the original), "a video the preview can decode says nothing and offers no copy", and "a play() the element refuses leaves the button on Play and says why; an element error says it too" (the element's `play()` and `error` are stubbed in the page for the two signals a fixture cannot give on every machine; red on the unchanged build). Unit: `videoStore.test.ts` (`previewUrl`), `mediaFormats.test.ts`, the T-135 wiring pin.
- **Video 4g ChatHighlightPanel - a spike of neighbouring buckets ([T-135] (3), end state changed):** the finder cut the chat into buckets and listed every busy bucket, so one spike over three buckets was three rows, two of them heads of the same moment. The pure helper `findChatPeaks` (`shared/chatPeaks.ts`) merges buckets that are next to each other (their unpadded keys differ by one bucket), and a row's window runs from the first bucket's start minus the padding to the last bucket's end plus the padding; the panel lists the helper's rows. E2E: video-pipelines.spec.ts "three adjacent hype buckets are ONE row, and + Clip lands the whole spike with its padding" (red on the unchanged build: three rows). Unit: `chatPeaks.test.ts`.
- **Video 4t ExportPanel - the safe-zone warning, a custom preset's name ([T-135] (6), layout changed; extends the T-134 (5) row above):** each zone line is cut with an ellipsis and carries the whole line as its tooltip, so a 60-character preset name (or the 80-character name already on disk) no longer scrolls the list sideways (measured: `scrollWidth` 474 and 977 against a `clientWidth` of 406). E2E: the existing video-pipelines.spec.ts case "a clip and a custom preset with very long unbroken names are cut with an ellipsis in the safe-zone warning, and the list does not scroll sideways" now also drives the zone lines (red on the unchanged build). Unit: the T-135 wiring pin.
- **Video 4o CaptionsPanel - "Clear saved transcripts" ([T-135] (7), copy changed):** the confirm names the open video's own transcript only when the open video has one (`This deletes the 3 saved transcripts imagii keeps on this computer, including the one for the video you have open. Transcribe again whenever you need one.`; without it, the clause is absent). E2E: video-pipelines.spec.ts "Clear saved transcripts: a video with no transcript of its own is not named in the confirm" (the dialog text is read in both states; red on the unchanged build). Unit: `captions.test.ts` (`clearTranscriptsQuestion`) and the copy pin.
- **Video 4s CustomPresetManager - Save and Delete when the write is refused ([T-135] (8), end state changed):** a refused preset save or delete says so ("Couldn't save that preset." / "Couldn't delete that preset."), keeps what was typed, and a retry once the folder is back saves. E2E: video-pipelines.spec.ts "a refused preset save is reported and the form keeps what was typed; once the folder is back, the retry saves" (the presets folder is replaced by a file; red on the unchanged build). Unit: `failurePathLanguage.test.ts` (the site is in the table) and the T-135 wiring pin.
- **Project open and the autosave Restore - a sound opened while the video was still loading ([T-135] (9), end state changed; no element):** the two closures that load the project's sound (the scratch-WAV one and the plain one) return without replacing a sound the person opened during the video's wait, the same `replacedSince` identity rule the third closure already had. Unit: `ProjectIO.test.ts` (describe "(e)": the plain path, the scratch path, and a closed studio is not "something else"); the plain path was the red-first case. No Playwright case: the window needs a video load that outlasts a person's click, which the unit test holds with a gate.
- **Project open - a clip that names a preset this build does not have ([T-135] (10), end state changed; no element):** an unknown platform id in a clip's `selectedPresets` is dropped on the way in, with the rest of the project; it used to survive validation and kill Export ("Unknown preset" at the batch). Unit: `projectValidation.test.ts` (the drop, an all-unknown list becomes the empty one, a clean file loads untouched).

### Audio Studio

- **Audio SecondaryTrackPanel and ExportDialog - a second track with no sound in it ([T-135] (11), end state changed):** the file is probed when it is picked, and a file with no audio stream is refused there ("The second track has no sound in it. Remove it or pick another file." as a toast); an export whose second track lost its sound meanwhile is refused at the top of `exportAudio`, in its own sentence, instead of failing late with ffmpeg's "matches no streams" and blaming the primary file. A streamed WebM whose duration the probe cannot read is NOT refused (it has sound). E2E: audio.spec.ts "a second track with no sound in it is refused when picked, and when the file loses its sound before the export" (red on the unchanged build). Layer 5 (IMG-PREC): media.spec.ts "T-135 (11)" blocks on the bundled 7.0.2 and the distro's 6.1.1: a real second track with no sound exits 234 "matches no streams" through the old chain and is refused before any spawn through the new one. Unit: `audio.test.ts`, `exportProgress.test.ts`.
- **Audio ExportDialog - a chain that cuts the whole file ([T-135] (12), end state changed):** an export whose cuts leave less than 0.05 s is refused before ffmpeg is spawned ("Everything is cut out. Click a mark to put a part back."); ffmpeg exits 0 for it with a header-only file (78 bytes of WAV, about 257 of AAC, about 620 of MP3, measured on both majors) and "Cleaned audio exported" was said over nothing. E2E: audio.spec.ts "a chain that cuts the whole file is refused in a sentence: a Failed row, no file written, and the button is free again" (the cut is a real drag across the waveform; red on the unchanged build). Layer 5: media.spec.ts "T-135 (12)" blocks on both majors pin the exit-0-empty shape and the guard (a near-all-cut chain of 0.2 s still exports). Unit: `chain.test.ts` (`cutsLeaveNothing` reads the unfloored length), `exportProgress.test.ts`.

### References

- **References - the Search button and the box ([T-135] (5), end state changed; REVISES the T-134 (3) row above):** T-134 (3) made a corrected query go out on Enter, but the button was `disabled` for any request in flight, so a pointer or voice-control user could not send the correction; and the box was the panel's own state while the grid is the store's, so a trip to Mood Boards and back drew the grid over an empty box. The button is now off only for the question that is already out (typed text equals the store's in-flight query; a double-click is still refused by the store), and the box starts as the query the grid answers. E2E: references.spec.ts "Reference Search: a corrected query is sent BY CLICK while the typo is out, and the box names the grid after a trip to another tab" (the typo is held; the button reads Searching… and is off for it; a trip to Mood Boards and back keeps the box and the button; the correction re-enables the button, a click sends it, its answer is on the grid; the typo's late answer is dropped; away and back with the grid on screen, the box names it; red on the unchanged build: the box is empty). Unit: `referencesStore.test.ts` (the store names the newest request's query) and the T-135 wiring pin.
- **References - Mood Boards: Create, Rename, Delete; the first-save dialog ([T-135] (8), end state changed):** the three board-name boxes take at most 200 characters, the number main already enforced (`MAX_BOARD_NAME` in `shared/search.ts`, one copy); a refused create, rename, delete or save says so in a toast ("Couldn't create that board." and the like) and keeps what was typed; the first-save dialog closes only once the board EXISTS (it used to close first and drop the picture on a refusal), and one press makes one board. E2E: references.spec.ts "the board-name boxes take at most 200 characters", "a refused first save says so, keeps the dialog with the name that was typed and the picture being saved, and the retry saves it" and "a refused Create and a refused Rename are reported, and keep what was typed" (red on the unchanged build). Unit: `failurePathLanguage.test.ts` and the T-135 wiring pin.
- **References - Mood Boards "→ Canvas" ([T-135] (13), end state changed):** the button awaits the picture's load, which can be a network fetch, and then navigated to the canvas wherever the person was. The layer is added and the toast says so either way; the person is taken to the canvas only if they are still on References when the picture arrives. E2E: references.spec.ts "→ Canvas that finishes after the person went to another screen adds the layer and leaves them where they are; one they waited for still opens the canvas" (the load is held by parking the page's `HTMLImageElement.src` setter for a file named "slow"; red on the unchanged build: the person was navigated). Unit: the T-135 wiring pin (the route is read after the await; the navigate table counts one site).

### Not an element, but covered

- **ffmpeg (IMG-PREC):** items 11 and 12 above; no filter graph changed (the guards run before the command is built). Run on the bundled 7.0.2 (`npm run test:media`) and the distro's 6.1.1 (alias config), green on both; the mutations (the second-track probe removed, the all-cut guard removed, the floored length used, the line moved) are red on both.
- **A flaky case, fixed (found by the full run):** audio.spec.ts "a recording whose header has no duration (a MediaRecorder WebM) imports ..." read the toast log once, right after the waveform, and expected "Loaded" in it; the toast comes a few milliseconds later, so the case failed about one run in three on the unchanged build too (4 of 12 there, 2 of 8 on this tree). It now waits for the toast (0 failures in 20 runs). No product code is involved.
- **Docs:** README's troubleshooting line, USER_GUIDE (Cancel and results survive a visit, the preview note, merged spikes, the Search button, the board-name cap, the two export refusals), STYLE_GUIDE (long jobs live in module stores; results belong to the open video; the verdicts a media element gives; the guard that must not refuse a different question, again), TESTING (counts and the new case families), LESSONS_LEARNED, and the native-dialog inventory (re-pointed against this tree: `MoodBoardPanel.tsx`, `CustomPresetManager.tsx`, `ReferencePanel.tsx` and `VideoStudio.tsx` moved). The stale comment at `home-chrome.spec.ts:1226` ([T-135] (14)) now says what the case does.

### Found, not fixed

- **A chat log's spikes are not re-found when the log is edited.** The merged rows are computed when "Find spikes" is pressed and kept with the video; editing the box afterwards leaves the old rows until the button is pressed again (as before the change, now across visits too).
- **The transcript preview has no end-to-end case.** See the disposition above: the speech engine is an OS boundary; the store field is unit-covered.
- **The preview copy is one file per press.** "Make a preview copy" writes a converted file in the importer's temp folder each time it succeeds and does not reuse an earlier copy of the same video; the folder is swept like the importer's other conversions. A cache keyed on the source's path and size is the upgrade if a person converts the same file repeatedly.

## Dispositions — round 85 (T-136 Track A: the edges of T-135 (1), the Player, and one running-job Cancel)

Eight items of sweep 22 (a Clip Kit that could become uncancelable, a conversion that could run twice and whose late landing replaced the video being edited, an autosave that never fired while anything played, a model download that lost its bar and Cancel on a round trip, a notice that might not be announced, an Output preview that stayed a silent black box, and a Cancel hand-written eleven times with two copies off the pattern). Every behavior change was red-first: the new Playwright cases run on a build of the unchanged tree `47ef529` (r85a/base) and the new unit and wiring tests run against the old product code, with a ledger of mutations (r85a/ledger.md).

### Video Studio

- **Video 4p ClipKit - the running kit, whichever clip is selected, after its clip is removed and after the video is closed ([T-136] (1), end state changed; REVISES the T-135 (1) row above, which said the kit belongs to one clip's row):** the clip list draws ONE kit button, for the selected clip, so a run shown only on its own clip's button put its progress and Cancel behind a disabled idle label the moment another clip was selected, and removing the clip or closing the video left NO Cancel anywhere until the kit ended minutes later. The run carries the clip it was started on (`clipId`, `clipName`); the button shows the running kit (its label, its Cancel, and `Clip Kit for "<name>"` above it) whichever clip is selected and starts nothing; `ClipKitRunning` draws the same line and Cancel in a card beside the importer once the video is closed. E2E: video-pipelines.spec.ts "T-136 (1)" - "selecting another clip keeps the running kit on the button, names the clip it is for, and keeps its Cancel", "removing the clip the kit was started on leaves the kit running, named, and cancelable" and "closing the video leaves the kit running beside the importer, with its Cancel" (each cancels through the confirm and reads the exact canceled sentence); the T-135 case "Clip Kit: a kit that is running when the person leaves ..." has its pin FLIPPED (the other clip shows the running label and has the Cancel; it said an idle label and no Cancel). Unit: `kitRunCaption` in `clipKit.test.ts`, the wiring pins.
- **Video 4a Importer - Choose file…, drop, Recent, after a trip to Home during a conversion ([T-136] (2), end state changed; REVISES the T-112 refusal row above):** the load (and, for flv / ts / wmv / mpg, the transcode) is a run in the module store (`useImportRun`), so a returning Importer is the same import: Choose file… is off, the label reads Loading…, a second drop is refused in the same words ("Still converting the last video. Wait for it to finish."). A video that arrived during the conversion (a project opened from Home, "Edit in Video Studio") is not replaced when the conversion ends: the copy is not loaded, the clips and undo history are untouched, and a toast says "Skipped stream.flv because you opened another video while it was converting". E2E: "T-136 (2)" - "the importer is still busy after a trip to Home ..." (one conversion; the second drop refused; main's refusal read through the real bridge) and "a video opened while a conversion runs is kept ..." (a two-clip project's mp4 stays open with both clips; red on the unchanged build: the late conversion replaced it and reset the clips).
- **Main - `video:convertForImport` is single-flight ([T-136] (2), end state changed; no element):** the importer's transcode, the Player's "Make a preview copy" and the project open's re-convert share one conversion slot in main (claimed before the handler's first await, given back in a `finally`); a second start is refused in a finished sentence naming the file being converted ("Still converting "stream.flv". Wait for it to finish, then try again."), which `userFacingError` lets stand through Electron's envelope. The project open reports it as a failed video with the rest of the project open. Unit: `videoConvertSingleFlight.test.ts` (nine cases through the real handler: the second start, the same file, the same breath, the slot returned after success / failure, the refusal that does not give the slot away, a path refused at the boundary, the envelope, a long name), `ProjectIO.test.ts` ("applyProject when main refuses a second conversion"). The two earlier "can run beside" comments (ProjectIO's re-extract) are corrected.
- **Video 4b Player - Make a preview copy, after a trip to Home during the copy; the copy finished while away ([T-136] (2), end state changed; adds no button):** the copy's run is in the module store (`usePreviewCopyRun`): back in the studio the button reads "Making a preview copy…" and is off, one conversion runs, and a second is refused by name. The playhead the copy resumes at is read when the copy is swapped in and travels with it in the video store (`previewResumeAt`, taken once by the element that hears its metadata), so a copy that finishes while nobody is looking at the Player comes back at the playhead, not at 0:00. E2E: "the preview copy is still being made after a trip to Home ..." and "a preview copy that is finished while the person is away comes back at the playhead it was asked at, not at 0:00" (red on the unchanged build).
- **Video 4b Player - the preview-unavailable notice's status region ([T-136] (5), a11y):** the `role="status"` is a wrapper that is always mounted (empty while the picture draws, `-mb-3` so it leaves no gap), as GifPanel's is, so the notice is announced when it appears instead of arriving with its own live region. Wiring pin only (the pattern's behavior in a screen reader is the OS boundary; the existing T-135 (2) case reads the sentence and the button).
- **Video 4h OutputPreview - the caption under a picture the Player cannot draw ([T-136] (6), copy changed):** while the Player's verdict (`noPicture`, now the video store's) is true and no preview copy exists, the card says "No snapshot to show: imagii can't preview this video's picture format. Your exports are not affected." instead of "Live snapshot at the playhead position..." under a black box; when the copy plays, the caption is true again. E2E: "T-136 (6)" (a ProRes file: the note, no caption; the copy: the caption back; a decodable video never shows the note; and a DOM observer armed before the press asserts the note is never on screen once the `<video>` is on the copy - the verdict clears itself when the copy loads, so the final state cannot tell "no preview copy exists" from "the verdict says so"). Unit: `OutputPreview.test.tsx` (the four verdict-by-copy states rendered, the moment the copy is in the store and the verdict is still true included), `mediaFormats.test.ts`, `videoStore.test.ts` (`noPicture`).
- **Video 4o CaptionsPanel - Download model, Cancel download, after a trip to Home; the download that ends after the person came back ([T-136] (4), end state changed; the bare cross is now the shared Cancel button):** the download is a run in the module store (`useModelInstallRun`, whose progress listener lasts exactly the download) and the engine / model status is the store's (`useCaptionsStatus`), so a panel that mounts over a running download opens its setup card with the bar and Cancel drawn and Download off, Cancel stops the download and removes the partial file, and a download that ends with the panel on screen leaves it ready (no setup card; Transcribe transcribes). E2E: "T-136 (4)" - "leave mid-download and come back ..." with `net.request` replaced in main by a download that reports progress and never ends (the real handler, the real `installWhisperModel`, the real `.partial` file; only the network is stood in for, HL-network) and "a download that ends after the person came back leaves the panel ready" (the T-113 stand-in handlers). The old ✕ button (a bare cross named "Cancel download") is the "Cancel" button with the title "Cancel download".
- **Every running job's Cancel and progress bar - GIF, Compile, Picture-in-picture, Reframe, Scan VOD, Captions (burn-in, transcription, model download), the Export batch, the audio export, the Clip Kit ([T-136] (7), look and copy changed; [T-136] (8), copy changed):** one `RunningCancel` (a ghost button, danger ink, the word "Cancel", the job it stops as the title) and one `ProgressTrack` (the named progressbar; a measured number or the sliding segment) replace eleven and six hand-written copies; the audio export's Cancel (a plain gray box, no title) and the Clip Kit's (a hand-rolled bordered box) now look and read like the rest. The Picture-in-picture Cancel's title is "Cancel picture-in-picture composite" (it said "Cancel PiP composite", the only "PiP" a person read). E2E: the existing Cancel cases of every panel (they find the button by its name "Cancel" and press it; none changed). Unit: `RunningCancel.test.tsx`, `ProgressTrack.test.tsx`, and `runningJobControls.test.ts`, which fails on a hand-written Cancel outside a Modal and on a hand-written progressbar outside two decided exceptions.

### Home and every studio

- **Autosave - while anything plays ([T-136] (3), end state changed; no element):** the video store's playhead (`currentTime`, the Player's transport, a seek request) and the audio store's position no longer re-arm the debounce, and a pending change is written no later than 30 s after it was first scheduled. Unit (`useAutosave.test.ts`, the real stores on a fake clock): an edit followed by 60 s of 250 ms playhead updates is written within 6 s; playhead-only churn writes nothing; churn on a field that is work writes by 30 s and then every window; a single edit still writes 5 s later; a hold still defers and its release still saves. No Playwright case: the 5 s debounce and a playing picture together are 60 s of waiting for a file the unit test reads through the same stores (the ticket asks for the unit).

### Not an element, but covered

- **Docs:** USER_GUIDE (the kit and the model download survive a visit and stay cancelable, one conversion at a time, a video opened during a conversion is kept, the Output preview's note, autosave's ceiling), STYLE_GUIDE (the run is the Clip Kit's STARTED-ON clip, the three new runs, the playhead rule and the ceiling, `RunningCancel` and `ProgressTrack` under Shared affordances), TESTING (counts and the new case families), LESSONS_LEARNED, and the native-dialog inventory (`VideoStudio.tsx` moved by one line).

### Found, not fixed

- **The recording convert's progress bar is still hand-written.** `RecordStudio.tsx` draws its own track (a fixed 16 rem width and a 2% floor so a started convert is visible); `runningJobControls.test.ts` names it as a decided exception. The upgrade is a `floor` prop on `ProgressTrack` and a second row in the E2E that reads it.
- **The importer's and the preview copy's conversions have no Cancel.** Quitting is still the only way to stop one (T-110 (c) names the open-project conversion as the same gap); the run slots now make a Cancel a small addition (main already has `cancelConverts`).

---


## Dispositions — round 85, Track B (T-136: the review gate's twenty-second pass)

Seven findings from sweep 22 (items 9 to 15; Track A's items 1 to 8 are its own section): a spike panel that ranked and showed its rows by the wrong measure, a refusal that told the person to remove what was never added, a status line that outlived its file, two writes that failed without a word, an accumulator without a cap, a classifier that read a file name as a cause, and a compilation that blamed the person's source for a lost first segment. Every behavior change was red-first: the new test run against the old product code (unit pins before the fix, or on the unchanged tree `47ef529` kept as r85b/base) and every new or changed Playwright case against a build of that unchanged tree, or the finished fix mutated out by content-replace with a sha256 triple (r85b/ledger.md); the Layer 5 case on both ffmpeg majors.

### Video Studio

- **Video 4g ChatHighlightPanel - the row, the extra seconds, the empty result, the two boxes ([T-136] (9), look, copy and end state changed; REVISES the T-135 (3) row above):** a row shows where its clip runs, "0:15 → 0:55", and its total ("9 messages"), with the messages' preview on a line of its own; rows rank by their densest window (then their total), so a long, moderately busy run no longer outranks a short explosion at the 12-row cap, and "+ Clip" adds exactly the range the row shows. "Extra seconds around each clip" is a `DraftField` clamped to 0 to 60 when typing ends (a fraction of a second is kept; an emptied box goes back to what it was) and `findChatPeaks` clamps it too. A log that was analyzed and holds no spike leaves "No chat spikes found. A spike is a window with at least 5 messages and twice as many as a usual window, and the log needs messages in at least 3 different windows to compare." under the button (the toast stays; the line is the video's own result and survives a visit), which is not drawn for a log that was not analyzed. The two number boxes share one line at 1024, 1632 and 1920 px (they sat 16 px apart), and the row is measured at its widest (a ten-hour stream's range, a four-digit count): the first line wraps by item, so "+ Clip" drops under the range at the right edge instead of breaking onto two lines past the row. E2E: video-pipelines.spec.ts "ChatHighlightPanel - range, extra seconds, empty result, alignment (T-136 (9))" (a long spike's range and the clip it adds, the clamp typed key by key, the empty line before, after, after a trip to Home and after a spike, the alignment and the row's one-line spans at three sizes; each red on the unchanged build) and the six existing row pins, now "start → end". Unit: `chatPeaks.test.ts`.
- **Video Importer and Audio AudioImporter - a finished sentence that quotes the file's name ([T-136] (14), end state changed):** `describeImportError` looks for its keywords outside double quotes, so "Still extracting the sound from "codec_test.mp4". Wait for it to finish, then try again." reaches the person as written instead of as "imagii can't read this audio format". Unit: `importDiagnostics.test.ts` (eight keyword-holding names, a clean-name control, and a real cause still found beside, between and after quoted names). The drop itself is the existing cases' (video-pipelines.spec.ts "Clean audio: the button stays off while its extraction runs ... a second extraction from the Audio Studio importer is refused by name" drives the sentence with an ordinary name).
- **Video 4m CompilationPanel (Compile) - a lost first segment ([T-136] (15), end state changed):** a join that cannot open ANY of its segments says which clip ("... the clip "Intro" could not be read, so nothing was saved. Try again, and if it keeps happening, leave that clip out."), whatever the exit code; the first segment's exit is non-zero (254) where a later one's is 0. The panel's own button and Cancel are unchanged. Unit: `concatRunner.test.ts`. Layer 5 (IMG-PREC): media.spec.ts "a compilation whose FIRST segment is lost at the join names its clip" on the bundled 7.0.2 and the distro's 6.1.1 (the real `runConcat` with segment 0 deleted between the list and the join; red on the unchanged tree on both).

### Audio Studio

- **Audio SecondaryTrackPanel - the pick-time refusal ([T-136] (10), copy changed; REVISES the T-135 (11) row above):** picking a file with no sound says "That file has no sound in it. Pick another file." and adds nothing (it said "Remove it or pick another file", about a track that was never added); the export says "The second track has no sound in it. Remove it or pick another file." for a track that lost its sound after it was added. E2E: audio.spec.ts "a second track with no sound in it is refused when picked, and when the file loses its sound before the export" (each sentence once, no "remove" at the pick; red on the unchanged build). Unit: `audio.test.ts`. No Layer 5 change: the L5 blocks pin the export's sentence, which is unchanged.
- **Audio SecondaryTrackPanel - a picked file whose length cannot be read is still added ([T-135] (11) pick rule, held after the expediter's mutation survived):** the pick refuses ONLY on the probe's "no audio stream" verdict; any other probe failure (a streamed MediaRecorder WebM carries no duration in its header, so the probe throws `NoUsableDurationError`) is no verdict on the file, the track is added and the export looks again. E2E: audio.spec.ts "a second track whose length cannot be read is still added (T-135 (11) pick rule)" (the fixture's `format=duration` is N/A and the panel's own probe is shown to fail with the length message, then the WebM is picked through the stubbed open dialog: "Background music added", the track and its Remove control are there, no "has no sound in it" sentence; red under a panel that refuses on ANY probe error). Unit: `interactionWiring.test.ts` pins the catch's condition (`isNoAudioStreamError(err)` alone, then the add). Ledger rows `M-i10g` (e2e) and `M-i10h` (unit).

### Home

- **Home AutosaveRestore - Clear, both banners ([T-136] (11), end state changed):** after "Autosave cleared" the line "Last autosave: N min ago" is gone in the same visit (it was drawn from the page's mount-time read until the next visit to Home). A Clear that is refused keeps the banner, the file and (after Dismiss) the line. E2E: home-chrome.spec.ts "T-136 (11): the status line goes with the file" (healthy banner, damaged banner, the Later control and the refused Clear; the first two red on the unchanged build).

### References

- **References - Mood Boards "Clear thumbnail cache" and a tile's ✕ ([T-136] (12), end state changed):** a refused clear says "Couldn't clear the thumbnail cache." and never "Thumbnail cache cleared"; a refused remove says "Couldn't remove that picture." and the tile stays (the board file too). E2E: references.spec.ts "a refused Clear thumbnail cache never says "cleared", and a refused ✕ says so and leaves the tile" (main's handlers replaced by ones that throw; the same ✕ with a working main removes the tile first as the control; red on the unchanged build). Unit: `failurePathLanguage.test.ts`.

### Not an element, but covered

- **main - the audio extraction's stderr ([T-136] (13)):** `audio/extract.ts` keeps a 16 KB tail like every other spawn; `tests/unit/stderrCapped.test.ts` reads every stderr `data` handler under `src/main` and fails on one that accumulates without one (a discrimination block over sample code and over the exceptions accounting). It lists, as audited exceptions, the two ebur128 scans (the stderr is the measurement), `ffmpeg -version`, and the two ffprobe header reads (the last two are found, not fixed: see below).
- **ffmpeg (IMG-PREC):** item 15 changes how a runner reads the join's result, not a command or a filter graph; it is held at Layer 5 on both majors (bundled 7.0.2 and the distro's 6.1.1), green on both, and red on both on the unchanged tree.
- **Docs:** USER_GUIDE (the chat spike rule, the range, the 0 to 60, the empty line; the second track's two sentences), DESIGN_GUIDE (the Modals list now names Clip Kit's two dialogs, the Captions clear-confirm and the Export cancel confirm), STYLE_GUIDE (`NameDialog`'s `maxLength`, the extra seconds among the `DraftField` boxes, the stderr tail), TESTING (the Track B paragraph), LESSONS_LEARNED, and this ledger (the native-dialog inventory's NameDialog cite moved to `MoodBoardPanel.tsx:155`).

### Found, not fixed

- **Two ffprobe header reads keep all of their stderr.** `audio/probe.ts` and `ffmpeg/probe.ts` accumulate `-v error` output with no tail. Bounded in practice (a header read, `probesize`, no decode) and listed as audited exceptions in `stderrCapped.test.ts`, but not capped: they are outside the files this track owned. The fix is one `if (err.length > 16384) err = err.slice(-16384)` in each handler and the deletion of two rows.
- **The `counts.length < 3` guard in `findChatPeaks` changes no result.** With fewer than three non-empty windows the median is the busiest window and the threshold is twice it, so nothing can be a spike anyway; the guard is kept (it is the rule the sentence names) and `MIN_SPIKE_WINDOWS` is pinned by value, not by behavior.
- **The empty-result line does not say how many messages were read.** The ticket's wording had "in N messages"; the count is not part of the video's stored result (`derived.spikes` is the rows), and a count taken from the box would be wrong the moment the log was edited. The line names the rule only.
- **A Cancel that wins over a lost-part line is held at unit level only.** The race (a join killed after it printed the line) cannot be set up deterministically against the real binary; `concatRunner.test.ts` drives it with the fake child.


## Dispositions — round 86, Track A (T-137: the twenty-third sweep's job and screen state)

Five items of sweep 23 (an audio importer whose extraction was the screen's, a Record whose save was the screen's and whose second take's Discard could delete the first take, a live region that arrived with its text, a kit label that wrapped, and a skip toast that blamed a Close on "another video"). Every behavior change was red-first: the new Playwright cases run on a build of the unchanged tree `7690cf5` (r86a/base), the new unit and wiring tests against the old product code, and the Layer 5 block against the real binary, with a ledger of mutations (r86a/ledger.tsv).

### Audio Studio

- **Audio importer - Choose file…, drop and Recent, after a trip to Home during an extraction; a sound opened meanwhile ([T-137] (1), end state changed; REVISES the T-119 refusal row above):** the load (and, for a video or an AIFF / WMA, the extraction) is a run in the module store (`useAudioImportRun`, `state/audioImport.ts`), so a returning importer is the same import: its button reads **Loading…** and is off, and a second file is refused in the same words ("Still extracting audio from the last file. Wait for it to finish."), from a drop and from Recent. A landing asks `replacedSince(heldBefore, source)` after the extraction: a sound that arrived meanwhile (a project opened from Home, Clean audio) is kept with its chain and history, and the late one is skipped with "Skipped the sound of e2e-clip.mp4 because you opened another file in Audio Studio while it was extracting" (no "Loaded", no Recent entry). E2E: audio.spec.ts "T-137 (1)" - "the importer is still busy after a trip to Home ..." (Loading… off, a WAV dropped on it refused, one ffmpeg started, main refuses a third caller by name, the first file is what opens) and "a sound opened while an extraction runs is kept ..." (a project with a plain WAV opened from Home, tuned with Cleanup Medium, the late extraction skipped in the sentence, the header and the selection untouched). Unit: the wiring pins in `interactionWiring.test.ts` ("T-137 Track A (1)": the claim before the first await, the heldBefore read, the check between the wait and the load, the skip returning before the load). The T-119 case "a second file while the first one is still being extracted is refused" is unchanged and green.

### Record

- **Record - Discard recording and the saving card, after a trip away during a save ([T-137] (2), end state changed; REVISES the T-88 and T-115 rows above):** the save (the take's session id, whether it is the MP4 convert, the percent, "discarding", the microphone line) is a run in the module store (`useRecordSave`, `saveRun.ts`); `finalizeRecording` keeps writing to it after its screen is gone, with a progress listener that lasts exactly the save. A Record that mounts over a running save draws the saving card (the named progress bar, **Discard recording**) and none of the idle controls - there is no **Start recording** to press. E2E: record.spec.ts "T-137 (2)" - "leaving Record during a save and coming back shows the saving card with its bar and its Discard, offers no Start, and the Discard it offers discards that take" (the convert's ffmpeg held, the card read after the round trip, Discard pressed from the returned screen: "Recording discarded", no temp take, no file at the chosen name, nothing in Recent).
- **Record - Start recording over a running save ([T-137] (2), end state changed; no new element):** `startRecording` refuses with "Still saving the last recording. Wait for it to finish." when a save run exists. The idle controls are not drawn over a save, so this is a backstop that no click reaches; it is held at unit level (`saveCard.test.ts` for the sentence, the wiring pin for the guard being the second statement of the function, after T-119's `startingRef` gate) and its disposition is that no automated test can press a button that is not on screen.
- **Main - `recording:cancelSave` is aimed at one take ([T-137] (2), end state changed; no element):** the channel takes the take's session id (a call without one, or with a malformed one, is refused by the handler's gates), and a convert's owner is `recording:<takeId>` (`recordingOwner`, `ffmpeg/convert.ts`), so a Discard cancels the convert of the take it names and no other; the type has no owner-wide recording cancel left. Before, a Discard on a second take cancelled the first take's convert too, and that save (told "cancelled" by something other than the quit) unlinked its raw webm. E2E: record.spec.ts "a Discard aimed at another take (what a second take's Discard sends) finds nothing and leaves the take that is being saved: it finishes, and its file is a real mp4" (a second real session opened through the bridge; its Discard answers false, a Discard without an id is refused, the first take lands as h264). Unit: `recordingQuit.test.ts` "a Discard cancels its own take and no other (T-137 (2))" (two takes saving at once over the real convert module and the real handlers, the MP4 convert and the WebM remux both; the other take keeps its output, its raw take and its run and finishes as a success; the channel's gates; a quit after a Discard still keeps the take it ends), `convertCancel.test.ts` and `convertQuit.test.ts` (the owner is the take's, and the run is marked for that take alone). Layer 5 (IMG-PREC): media.spec.ts "a Discard on one take leaves another take's save running (real ffmpeg, T-137 (2))" - two concurrent real encodes of two takes, one cancel, ffprobe on the survivor - on the bundled 7.0.2 and on the distro's 6.1.1.

### Video Studio

- **Video 4p ClipKit - the running label and its Cancel ([T-137] (4), look changed; REVISES the T-136 (1) row above):** the running label ("Exporting platform version 2 of 5…") is on one line (`whitespace-nowrap`) and **Cancel** has a row of its own under the button, right-aligned to it (the column is the caption, the button, the Cancel); beside the button it wrapped mid-sentence, 197 x 42 px, at the default and the minimum window, and the clip list jumped about 36 px as the phase changed length. E2E: video-pipelines.spec.ts "T-137 (3), (4)" - "the running label is one line at the default window and at the minimum, its Cancel sits on a row of its own under it, and nothing pokes out of the clip list" (`expectOneLine` and `expectNoHorizontalOverflow` at 1632 x 918 and 1024 x 640, the Cancel's top at or below the button's bottom and its right edge on the button's, the button one line tall; red on the unchanged build at "wraps onto 2 lines").
- **Video 4p ClipKit - the closed video's card and its live region ([T-137] (3), a11y; REVISES the T-136 (1) row above):** `ClipKitRunning` is mounted by `VideoStudio` whether a video is open or not, and its live region is the wrapper (`aria-live="polite"`, empty while no kit runs, `-mb-5` so the empty element leaves no gap in the studio's `gap-5` column); the card appears inside it when the video is closed during a kit. The paragraph no longer carries a live region of its own, and the card is drawn only for a run with no video open (the clip list's button shows it otherwise). The behavior of the pattern in a screen reader is the OS boundary; what is pinned is what a screen reader depends on: E2E "the card for a kit that outlives its video is announced from a live region that was already mounted ..." (the region exists with a video open and no kit, empty, with a 20 px gap between the header and the studio; it is still empty with the kit running and the video open; it holds the card after Close and is the SAME element, `isConnected`; it is empty again after the kit is canceled, with the importer one gap under the header), and the wiring pin.
- **Video 4b Player - the preview copy's skip toast ([T-137] (5), copy changed):** a copy that finishes for a video that is no longer the open one says "Skipped the preview copy for <file> because the video was closed or replaced while the copy was being made" (`previewCopySkippedMessage`, `shared/mediaFormats.ts`); it said "because you opened another video" after a plain Close. E2E: video-pipelines.spec.ts "T-137 (5)" (the copy held, the video closed, the sentence read, the old one absent). Unit: `mediaFormats.test.ts` (the sentence, the file carried whole, no "another video").

### Not an element, but covered

- **ffmpeg (IMG-PREC):** no command, filter graph or audio chain changed. What changed is the registry a Discard's SIGKILL is aimed through (the owner of a recording's convert is its take), and "the child that dies is the one the person meant" is the binary's to prove: the new Layer 5 block is green on both majors.
- **Docs:** USER_GUIDE (the importer after a trip away, the sound opened meanwhile, Record's saving card on return and its Discard, the kit's Cancel under its label, the preview copy's skip sentence), STYLE_GUIDE (`useAudioImportRun` and `useRecordSave` in the module-store rule, the Discard aimed at one take, the importer's claim), DESIGN_GUIDE (the four placements of `RunningCancel` the code uses), TESTING (the Track A paragraph), LESSONS_LEARNED, and this ledger (the native-dialog inventory's `RecordStudio.tsx` cite moved to 708).

### Found, not fixed

- **A skipped extraction's scratch WAV stays in `%TEMP%/imagii-audio` until the launch sweep.** The late extraction that `replacedSince` refuses has already written its WAV (up to gigabytes for a long recording); nothing deletes it, as Clean audio's identical skip has never deleted its own. The upgrade is an `unlink` of `wavPath` on both skip paths (and a main-side helper, since the renderer holds no `fs`).
- **Audio Studio's export row still draws its Cancel beside the primary.** DESIGN_GUIDE now names it as the one placement that is not a row of its own (the native Save dialog sits between the press and the job, so the second press of a double-click does not land on it); the T-126 (20) upgrade would give it a row like the other four.
- **The recording convert's bar is still hand-written** (unchanged from the T-136 note): the saving card's track keeps its 16 rem width and its 2% floor, and `runningJobControls.test.ts` still names it as a decided exception.
