# imagii — tickets

The work queue for the model-routing workflow in `CLAUDE.md`: Fable
writes and expedites tickets; Opus implements them. One ticket = one
branch = one PR.

**Format.** Each ticket has an ID (`T-NN`, allocated sequentially), a
spec reference (which guide or analysis it comes from), acceptance
criteria (checkable, not vibes), and a status line. The expediter marks
a ticket done only after re-running the checks itself — the
implementer's own report is not sufficient. Done tickets keep their
entry with the commit hash; do not delete history.

Statuses: `open` -> `in-progress (worker)` -> `review (expediter)` ->
`done (commit)` or back to `open` with rework notes.

---

## T-01 — Layer 5 real-media test for PiP reframe

- **Spec:** `docs/TESTING.md` Layer 2.5 + IMG-PREC. From the 2026-08-14
  test-gap analysis: `src/main/ffmpeg/reframe.ts` (195 lines) has zero
  real-ffmpeg coverage, and PiP is the feature whose IPC validator
  rejected every call until round 18 — the fix has never been proven
  against a real run.
- **Acceptance criteria:**
  - [ ] `tests/integration/media.spec.ts` gains a test that runs the
        real reframe/PiP job on generated fixtures (main + overlay),
        asserting output dimensions, both streams present, and overlay
        actually composited (probe alone is not enough — sample a pixel
        region or assert stream count + duration).
  - [ ] Covers at least two overlay positions/sizes.
  - [ ] `npm run test:media` green.
- **Status:** done (round 21 — see Done)

## T-02 — Layer 5 real-media test for multi-clip concat

- **Spec:** same analysis. `src/main/ffmpeg/concat.ts` (298 lines),
  zero real-media coverage; concat classically fails on mismatched
  timebase/SAR/codec params with silent desync.
- **Acceptance criteria:**
  - [ ] Layer 5 test joins two generated clips with deliberately
        different properties (resolution and/or fps), asserts output
        duration equals the sum (±0.5 s) and both streams decode.
  - [ ] A second case joins clips where one has no audio stream, and
        asserts the job either succeeds with defined behavior or fails
        with a clear error — whichever the code intends, pinned.
  - [ ] `npm run test:media` green.
- **Status:** done (round 21 — see Done)

## T-03 — E2E: import a file and export it through the real UI

- **Spec:** `docs/TESTING.md` Layer 2 is navigate-and-screenshot only.
  One import→export pass through the built app would have caught both
  the PiP validator bug and the protocol round-trip bug on day one.
- **Acceptance criteria:**
  - [ ] Playwright test: launch built app, load a small generated mp4
        into Video Studio (drag-drop path or seeded recent-file), run
        an export, assert the output file exists and ffprobe accepts it.
  - [ ] Runs headless under xvfb in `npm run test:e2e:build`.
- **Status:** done (round 21 — see Done)

## T-04 — Real-media coverage for highlight clip cutting

- **Spec:** `src/main/ffmpeg/highlights.ts` is unit-tested for scoring
  but the seek/cut boundary behavior has never run against ffmpeg.
- **Acceptance criteria:**
  - [ ] Layer 5 test cuts a clip at a known timestamp from a generated
        source and asserts output duration and start-content (not just
        exit 0).
  - [ ] `npm run test:media` green.
- **Status:** done (round 21 — see Done)

## T-05 — Whisper burn-in real-media test

- **Spec:** subtitle *path escaping* has Layer 5 coverage; the burn-in
  job itself does not. A canned `.srt` makes this cheap.
- **Acceptance criteria:**
  - [ ] Layer 5 test burns a 2-line fixture `.srt` into a generated
        clip; asserts exit 0 and output frames differ from input frames
        in the subtitle region (or at minimum output probes clean and
        is larger/different from a no-subtitle control).
  - [ ] Skipped cleanly (with reason) if the whisper sidecar layout is
        required and absent — burn-in uses ffmpeg only, so this should
        not need the model.
- **Status:** done (round 21 — see Done)

## T-06 — Protocol handler trust-boundary test

- **Spec:** `src/main/protocol.ts` uses tested `pathSafety` helpers,
  but nothing proves the handler actually wires them in — a traversal
  regression would be invisible.
- **Acceptance criteria:**
  - [ ] Unit test (or E2E fetch) proving a traversal-shaped
        `imagii-file://` request is refused and a legitimate one
        resolves. The existing E2E protocol assertions may be extended
        instead of a new file — expediter's call.
- **Status:** done (round 21 — see Done)

## T-07 — ProjectIO + autosave data-loss tests

- **Spec:** `ProjectIO.ts` and `useAutosave.ts` are untested; autosave
  already produced one logged bug (round 18). Data loss is the failure
  imagii can least afford.
- **Acceptance criteria:**
  - [ ] Save→load round-trip test at the store level: a project with
        content in all studios survives serialize→validate→restore.
  - [ ] Corrupted-autosave path: a truncated/garbage autosave file is
        refused without crashing and without clobbering good state.
- **Status:** done (round 21 — see Done)

## T-08 — probeVideo accepts text files as video (ansi demuxer)

- **Spec:** found by T-03's negative test. ffmpeg's `ansi` demuxer claims
  `.txt`, so any text file probes as a 640x400 "video" and imports with
  a full export panel. Root cause: no codec floor in
  `src/main/ffmpeg/probe.ts`.
- **Acceptance criteria:**
  - [ ] `probeVideo` rejects `ansi` (or applies an equivalent
        plausibility floor) with a specific, user-readable error.
  - [ ] Covers drop, picker, and recent-files paths (they all route
        through probe).
  - [ ] Layer 5 negative test: a `.txt` fixture is refused with the
        exact error; E2E negative in `export.spec.ts` upgraded from
        `.log` to `.txt` once refused.
  - [ ] LESSONS_LEARNED entry per IMG-PREC.
- **Status:** done (round 23 — see Done)

## T-09 — findHighlights is 100% non-functional (framelog=quiet)

- **Spec:** found by T-04's pinned test. `ffmpeg/highlights.ts` scans
  with `ebur128=...:framelog=quiet:...` then parses per-frame lines that
  `framelog=quiet` suppresses — `parseEbur128` always sees zero samples,
  so every VOD returns zero highlight candidates. Same class as the
  round-18 autoZoom/ducking/denoise failures. Verified: `framelog=info`
  yields 60 frame lines and 4 candidates on the test fixture.
- **Acceptance criteria:**
  - [ ] `framelog=info` (or equivalent) in the scan command; candidates
        returned on the burst fixture.
  - [ ] Flip the `KNOWN BUG` pin in media.spec.ts into a positive test
        asserting candidate presence and rough timestamp.
  - [ ] LESSONS_LEARNED entry per IMG-PREC.
- **Status:** done (round 23 — see Done)

## T-10 — analyzeClipHook always reports the -70 LUFS floor

- **Spec:** same root class as T-09: `metadata=1` demotes framelog to
  debug, so the hook indicator scores every clip identically at -70.
  With `framelog=info` the same windows read -21.8 vs -55.7 LUFS.
- **Acceptance criteria:**
  - [ ] Loud and quiet windows produce distinct, plausible LUFS.
  - [ ] Flip the `KNOWN BUG` pin into a positive discrimination test.
  - [ ] LESSONS_LEARNED entry (may share T-09's).
- **Status:** done (round 23 — see Done)

## T-11 — caption positions top/middle render in the wrong place

- **Spec:** found by T-05. `alignmentForPosition` in
  `sidecars/whisperManager.ts` writes libass-internal Alignment values
  where ASS numpad values are required: `top` renders left+middle,
  `middle` renders left+top; both lose centring. Correct values: top=6,
  middle=10 (confirmed by mutation proof). `bottom`=2 is right by
  coincidence.
- **Acceptance criteria:**
  - [ ] top/middle/bottom each render centred in the correct third
        (PSNR-banded Layer 5 assertions — flip the `KNOWN BUG` pin).
  - [ ] LESSONS_LEARNED entry per IMG-PREC.
- **Status:** done (round 23 — see Done)

## T-12 — reframe output carries non-square SAR (cosmetic)

- **Spec:** T-01 observation, unpinned: `runReframe` output has SAR
  404:405 (DAR 101:180 instead of 9:16) — `scale` preserves source DAR;
  nothing sets `setsar=1` after the crop. Sub-1% geometry error.
- **Acceptance criteria:**
  - [ ] `setsar=1` (or equivalent) in the reframe graph; Layer 5 asserts
        SAR 1:1 on reframe output.
- **Status:** open (low priority)

## T-13 — mount HotkeyOverlay (dead `?` shortcut, advertised in-app)

- **Spec:** round-22 inventory. `components/HotkeyOverlay.tsx` is never
  mounted; Player.tsx:188 hint copy advertises `?`, and its
  SHORTCUTS_BY_ROUTE table is the app's only shortcut documentation.
- **Acceptance criteria:**
  - [ ] Overlay mounted app-wide (App.tsx); `?` toggles it on every
        route; Esc and its close button dismiss; INPUT/TEXTAREA guarded.
  - [ ] Unit or E2E coverage driving open + close paths.
- **Status:** done (round 23 — see Done)

## T-14 — mount PresetPanel (audio cleanup presets unreachable)

- **Spec:** inventory. Four dead controls; audio:listPresets/savePreset/
  deletePreset IPC live with no reachable UI; main-process CRUD already
  unit-tested (audio/presets.test.ts).
- **Acceptance criteria:**
  - [ ] Panel rendered in AudioStudio (placement per DESIGN_GUIDE panel
        conventions); save/apply/delete flows work end to end.
  - [ ] E2E: save a preset, mutate chain, apply restores it, delete
        removes it (confirm dialog handled).
- **Status:** done (round 24 — see Done)

## T-15 — Video Studio has no undo affordance

- **Spec:** inventory finding 4. videoStore has full history (round 18)
  but the studio has no Ctrl+Z listener and no header buttons; undo only
  reachable from Home. Timeline drags, clip removal, and color grades
  are effectively un-undoable in place.
- **Acceptance criteria:**
  - [ ] Header Undo/Redo buttons + Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z listener,
        parity with AudioStudio.tsx:31 pattern (INPUT/TEXTAREA guarded).
  - [ ] E2E: make a change, undo restores prior state, redo reapplies.
- **Status:** done (round 24 — see Done)

## T-16 — tutorial coachmarks target nonexistent selectors

- **Spec:** inventory. `[data-tutorial="video-crop"]`
  (videoTutorial.ts:53) and `[data-tutorial="audio-multitrack"]`
  (audioTutorial.ts:60) match nothing; those steps render no cutout.
- **Acceptance criteria:**
  - [ ] Attributes added to the intended hosts (CropOverlay container,
        SecondaryTrackPanel host) or steps retargeted; every tutorial
        step's selector resolves.
  - [ ] Test iterating all tutorial steps asserting each target exists.
- **Status:** done (round 24 — see Done)

## T-17 — invalid interactive nesting (input-in-button, button-in-label)

- **Spec:** inventory. ClipList.tsx:90-100 nests the rename input inside
  the row select button; TextOverlayEditor.tsx:171 nests the remove
  button inside a label wrapping inputs. Ambiguous roles; a11y hazard.
- **Acceptance criteria:**
  - [ ] Restructured to valid nesting with identical behavior (row
        select still works, rename still stops propagation).
  - [ ] a11y-reviewer agent passes the two components; existing E2E
        selectors updated if affected.
- **Status:** done (round 24 — see Done)

## T-18 — RecentFilesMenu dismisses only on mouse-leave

- **Spec:** inventory. No click-outside or Escape dismissal; hover-only
  is flaky headless and unfriendly on touchpads.
- **Acceptance criteria:**
  - [ ] Escape and click-outside both close the menu; mouse-leave
        behavior retained.
  - [ ] Unit/E2E coverage of both new dismissal paths.
- **Status:** done (round 24 — see Done)

## T-19 — Audio Studio Close drops work without confirm

- **Spec:** inventory. VideoStudio Close confirms; AudioStudio Close
  (AudioStudio.tsx:75) discards chain edits and cut regions silently.
- **Acceptance criteria:**
  - [ ] Confirm before clearing when a source is loaded and the chain
        differs from defaults (or cut regions/secondary track exist).
  - [ ] E2E: dialog-handler test covering accept and dismiss branches.
- **Status:** done (round 24 — see Done)

## T-20 — PostChecklist diary excluded from save/autosave (localStorage)

- **Spec:** inventory. imagii.postingDiary lives in localStorage —
  wiped with the Chromium profile, absent from project files and
  autosave, unlike all other studio state.
- **Acceptance criteria:**
  - [ ] Diary migrated to the settings store (new known key, validated
        in settingsKnownKeys) with one-time localStorage migration.
  - [ ] Unit test for migration + persistence round trip.
- **Status:** done (round 24 — see Done)

## T-21 — coverage: Home, Welcome, and shared chrome

- **Spec:** ledger rows Welcome(1), Home(15), Shared(21). All
  headless-safe except project save/load (native dialogs).
- **Acceptance criteria:**
  - [ ] Welcome "Let's go" clicked for real once (no welcomeSeen seed in
        that test): asserts settings write + Home renders.
  - [ ] Global Undo/Redo buttons round-trip a change from each studio;
        "last:" readout asserted.
  - [ ] AutosaveRestore all five buttons: seeded good autosave ->
        Restore rehydrates stores; Discard deletes file; Later dismisses;
        seeded corrupt autosave -> Clear/Dismiss variants.
  - [ ] Modal contract on at least two dialogs: Escape, scrim click,
        focus trap (activeElement stays inside), focus restore to opener.
  - [ ] Tutorial full run: Next-to-Done persists tutorialSeen; Skip does
        NOT persist; Back works; scrim click ADVANCES (asserted as
        designed); all four key bindings.
  - [ ] RecentFilesMenu: toggle, pick loads file, clear empties setting,
        Escape + click-outside dismiss (post-T-18).
  - [ ] Project save/load dispositioned: IPC-layer tests + ledger rows
        marked HL-dialog.
  - [ ] Every touched ledger row gets its disposition filled.
- **Status:** done (round 25 — see Done)

## T-22 — coverage: Video Studio core editing surface

- **Spec:** ledger Video 4a-4f, 4h, 4i, 4q. Post-T-15 (undo affordance)
  and post-T-17 (nesting fixes) selectors.
- **Acceptance criteria:**
  - [ ] Player: play/pause, frame steps, safe-zones toggle, all seven
        keyboard bindings incl. I/O markers moving Timeline handles.
  - [ ] Timeline: both trim drags via mouse down/move/up; In/Length
        readouts + store range asserted; undo reverses the drag
        (post-T-15, in-studio).
  - [ ] ClipList: add, select, rename (post-T-17 structure), speed
        slider + reset, remove with confirm handler both branches.
  - [ ] CropOverlay: enable, all five aspect presets, Rnd drag + resize
        (store rect asserted), reset, uncheck-clears.
  - [ ] ColorGrade: four sliders + reset + both checkboxes asserted in
        store; OutputPreview platform select redraws (screenshot or
        canvas hash delta).
  - [ ] TextOverlayEditor: add, every field, remove (post-T-17).
  - [ ] Studio chrome: Clean audio handoff (wav extract -> Audio Studio
        navigation), Close confirm both branches, tutorial button.
  - [ ] Ledger dispositions filled for every row in scope.
- **Status:** done (round 25 — see Done)

## T-23 — coverage: Video Studio pipelines and export surface

- **Spec:** ledger Video 4g, 4j-4p, 4r-4t. Post-T-09/T-10 (working
  highlights) and post-T-20 (diary in settings).
- **Acceptance criteria:**
  - [ ] ChatHighlightPanel: find spikes -> +clip -> ClipList row (pure
        renderer path); parse-error negative with exact toast.
  - [ ] HighlightPanel: scan a generated burst fixture -> candidates
        rendered -> +Clip; chat-log rescoring; cancel mid-scan.
  - [ ] CaptionsPanel not-ready branch (setup panel, refresh status);
        with a seeded srtPath: style presets, font slider, position
        select, color inputs, trim checkbox all asserted in store; save
        .srt and burn-in dispositioned HL-dialog (burn-in itself is
        Layer 5 covered).
  - [ ] ExportPanel: multi-preset queue (2+ clips x presets), cancel
        modal both branches, watermark + template inputs persisted,
        safe-zone warning modal both branches (fixture that trips it),
        per-row Show dispositioned HL-shell.
  - [ ] CustomPresetManager: full CRUD with confirm handler; validation
        toasts (negative: bad width) asserted exactly.
  - [ ] ClipKit: cancel-confirm modal branches; run dispositioned
        HL-dialog with IPC-layer coverage of makeKitDir/copySrtTo.
  - [ ] Reframe/Gif/Compilation/PiP panels: all parameter controls
        asserted in state; jobs dispositioned (Layer 5 covers the
        runners; dir pickers HL) — cancel buttons E2E via seeded dirs
        where feasible.
  - [ ] PostChecklist: titles, hashtag pack select, platform toggles,
        log post -> diary row (settings-backed post-T-20), delete
        entry, perf inputs; copy buttons via granted clipboard
        permission or dispositioned.
  - [ ] Ledger dispositions filled for every row in scope.
- **Status:** done (round 26 — see Done; a round-25 edit marked this
  ticket done by mistake where T-26 was meant — both corrected here)

## T-24 — coverage: Audio Studio full surface

- **Spec:** ledger Audio(48) + PresetPanel post-T-14 + close-confirm
  post-T-19.
- **Acceptance criteria:**
  - [ ] Import: drop wav (real load, waveform ready), recents, extract
        path from a video drop; picker dispositioned HL.
  - [ ] Waveform: play/pause, click-seek, region drag creates cut
        (chip + store), chip removal, multiple cuts.
  - [ ] Every chain control asserted in audioStore: denoise x5 +
        parametric sliders, rumble/hum/de-ess, compressor x4, loudnorm
        + LUFS + platform select interplay (custom detection), gain.
  - [ ] Secondary track: role add via... pickers are HL — seed via
        store or disposition; gain/match/duck + four duck sliders.
  - [ ] FixWizard: full three-question run -> Apply reconfigures
        Cleanup+Levels visibly; Start over; Escape resets.
  - [ ] PresetPanel (post-T-14): save/apply/delete with confirm
        handler; Enter-to-save.
  - [ ] Undo/redo keys + buttons; Close confirm both branches
        (post-T-19). Export dispositioned HL-dialog (Layer 5 covers
        runAudioExport/mux).
  - [ ] Ledger dispositions filled.
- **Status:** done (round 25 — see Done)

## T-25 — coverage: Image Studio full surface

- **Spec:** ledger Image(66).
- **Acceptance criteria:**
  - [ ] Templates: empty-state card apply, dialog open/apply/cancel/
        close/Escape/scrim.
  - [ ] Tools: all five via buttons AND keyboard (V/R/O/L/P), +More
        disclosure; draw-commit on the Konva stage for rect, ellipse,
        line, pencil (layer count + LayerPanel row asserted via
        __imagiiStage); grid/snap/grid-size affecting draw coords.
  - [ ] Selection: shape click -> Transformer attaches; drag-end and
        transform-end persist geometry; Delete/Backspace keys.
  - [ ] LayerPanel: all six per-row buttons; PropertiesPanel: every
        field incl. rotation presets x7 and text-layer fields.
  - [ ] Import: drop (both states), Playwright filechooser for +Import,
        +Add text; paste dispositioned HL-clipboard.
  - [ ] Export: PNG and JPG via download events; emote-pack branch
        asserts THREE downloads from one click; scale select affects
        pixel dimensions of downloaded file; Variants generate ->
        four tiles -> save one + save-all download counts.
  - [ ] Undo/redo restores canvas doc across a draw + a delete.
  - [ ] Ledger dispositions filled.
- **Status:** done (round 26 — see Done)

## T-26 — coverage: References + search parser

- **Spec:** ledger References(20). Live DuckDuckGo is HL — the parser
  gets unit coverage on fixture HTML instead.
- **Acceptance criteria:**
  - [ ] Tabs x3 switch panels; tutorial targets resolve (post-T-16).
  - [ ] Mood boards: create (button + Enter), select, rename + delete
        with prompt/confirm handlers, item remove, clear thumb cache
        (store emptied on disk), ->Canvas bridge asserts navigation +
        overlay layer at 0.4 opacity in canvasStore.
  - [ ] Asset Library: card click replaces canvas doc + navigates;
        at least two categories exercised.
  - [ ] duckduckgo.ts: unit tests on saved fixture HTML — happy parse,
        malformed HTML, vqd-missing, empty results; searchValidate
        rejection paths asserted by exact reason.
  - [ ] Search UI: error-path E2E (network blocked) asserting the
        error card copy; live search dispositioned HL-network.
  - [ ] Ledger dispositions filled.
- **Status:** done (round 25 — see Done; this ticket shipped in Wave A
  but a round-25 edit marked T-23 instead)

## T-27 — coverage: Record Studio reachable subset + dispositions

- **Spec:** ledger Record(17), 13 HL. The capture pipeline cannot run
  headless; everything around it can.
- **Acceptance criteria:**
  - [ ] UI wiring: mic/webcam checkboxes reveal selects; corner select
        persists record.webcamCorner; convert checkbox state; refresh
        sources button surfaces the empty-sources state gracefully
        (assert no crash + user-visible message).
  - [ ] compositor.ts already unit-tested — extend if corner math
        uncovered branches exist.
  - [ ] HomeLink capture-phase confirm: dispositioned (requires
        recording phase) with the confirm copy pinned in a unit test if
        extractable.
  - [ ] Every HL row dispositioned: desktopCapturer/MediaRecorder/
        devices/save-dialog/shell marked for the Windows hand-test
        checklist with exact steps.
  - [ ] Ledger dispositions filled; a docs section lists the manual
        Windows verification steps for the capture pipeline.
- **Status:** done (round 26 — see Done). Note: the ticket's premise
  was wrong in the right direction — the capture pipeline DOES run
  headless (only device enumeration doesn't), so 15/17 elements got
  real E2E instead of dispositions, and the hand-test shrank to a
  14-step checklist (ledger HAND-TEST section).

## T-28 — mood board rename and first-save are dead: Electron has no prompt()

- **Spec:** found by T-26's coverage. MoodBoardPanel.onRename and
  ReferencePanel.ensureCollection both call window.prompt(), which
  Electron does not implement — the renderer throws, no dialog appears,
  nothing is renamed, and saving a search result with no board yet is
  impossible. Pinned by the defect tests in references.spec.ts.
- **Acceptance criteria:**
  - [ ] Both flows use the in-app Modal with an inline input (the
        create-board field pattern), no window.prompt anywhere in src/
        (add a static check or extend interactiveNesting-style scanning
        if cheap).
  - [ ] Flip both defect pins into positive tests (rename persists to
        disk; first-save creates the board and saves the item).
  - [ ] LESSONS entry per IMG-PREC.
- **Status:** open

## T-29 — "Clear thumbnail cache" only trims above a 500 MB budget
   (Round-38 note: T-58 moved the eager per-delete thumb reap to a
   launch-time sweepOrphanThumbs so undo can resurrect boards whole;
   the 500 MB LRU still never runs on its own. When this ticket gives
   the button a real clear, consider running the LRU at startup next
   to the sweep.)

- **Spec:** T-26 finding. The button calls moodboard:prune ->
  pruneThumbCache() with the default budget — an LRU trim — while
  toasting "Thumbnail cache cleared". Under 500 MB it deletes nothing.
  Pinned in both directions in references.spec.ts.
- **Acceptance criteria:**
  - [ ] A true clear path (pruneThumbCache(0) via a dedicated channel or
        argument), leaving the budgeted trim for the automatic path.
  - [ ] Flip the defect pin: cache dir emptied under the budget too.
  - [ ] LESSONS entry.
- **Status:** open

## T-30 — first-hop search failure leaks raw IPC error text
   (Round-32 note: T-44 established the house shape for this class —
   throw a typed sentinel at the origin, branch on it at the IPC
   boundary, never string-match ffmpeg/IPC text in the renderer. Reuse
   it here, and see T-59 for the recording-side remainder.)

- **Spec:** T-26 finding. getVqd() runs outside searchDuckduckgoImages's
  try/catch: hop-1 failures reject the IPC and the error card shows
  "Error invoking remote method 'search:images': ..." while hop-2
  failures get friendly copy. Pinned by the unit test "rejects — it
  does not notice — when the vqd page itself fails".
- **Acceptance criteria:**
  - [ ] Hop-1 failures produce the same friendly notice shape as hop-2.
  - [ ] Flip the pin; E2E error-card assertion updated to the friendly
        copy exactly.
- **Status:** done (round 38 — see Done)

## T-31 — Home never mounts the toast surface

- **Spec:** T-21 finding A. Every studio mounts AppToaster; Home does
  not, so "Project saved/loaded", "Restored from autosave", "Autosave
  discarded." and all four error toasts on Home are dispatched into a
  page that never renders them.
- **Acceptance criteria:**
  - [ ] AppToaster mounted once at the app level (App.tsx) and the
        per-studio duplicates removed. (Usability ruling: notifications
        are expected everywhere, including future routes — app-level is
        the expectation-safe default; only keep per-studio if reading
        the history reveals a hard technical reason.)
  - [ ] E2E: a Home toast (e.g. Restore) is visible; flip T-21's
        finding-A contrast into a positive.
  - [ ] LESSONS entry.
- **Status:** done (round 31 — see Done)

## T-32 — Home global undo cannot see studio work; Redo never enables

- **Spec:** T-21 findings B+C. useGlobalUndo's tracker only arms on
  store mutations while Home is mounted, and its own undo() suppresses
  the re-render that would refresh canUndo/canRedo — Redo is unreachable
  through the UI.
- **Acceptance criteria:**
  - [ ] Tracker survives route changes (module-level or store-level
        last-change record) so edits in any studio arm Home's Undo.
  - [ ] Enablement refreshes after undo/redo clicks; Redo reachable.
  - [ ] Flip T-21's two defect tests into positives (cross-route undo;
        redo re-applies).
  - [ ] LESSONS entry.
- **Status:** done (round 31 — see Done)

## T-33 — corrupt-autosave banner is dead code (info shape mismatch)

- **Spec:** T-21 finding D. AutosaveRestore gates the corruption UI on
  info.ageMs, which main/autosave.ts omits exactly when validation
  fails — so a corrupt autosave renders nothing: no banner, no Clear,
  no "Last autosave:" line.
- **Acceptance criteria:**
  - [ ] Corrupt autosave surfaces the corruption banner with working
        Clear + Dismiss (pick the field contract deliberately and pin
        it in tests/unit/autosaveCorruptInfo.test.ts, which currently
        pins the mismatch). (Usability ruling: a user with a corrupt
        autosave EXPECTS to be told — silence is the worst outcome.)
  - [ ] Flip T-21's "offers nothing" defect test into the positive
        banner path.
  - [ ] LESSONS entry.
- **Status:** done (round 34 — see Done)

## T-34 — tutorial tooltips overflow the window; Enter double-advances

- **Spec:** T-21 findings E+F. Tooltip clamping exists only for
  top/bottom placements — left/right can render offscreen (Video step 2
  buttons unclickable at 1280px; 8 steps across the four tutorials use
  left/right). Enter's keydown advances, then focus lands on Next and
  the default action advances again.
- **Acceptance criteria:**
  - [ ] Clamp all placements into the viewport; E2E asserts the
        coachmark's buttons are clickable on a left/right step at
        1280x800.
  - [ ] Enter advances exactly one step (preventDefault or focus
        sequencing); T-21's counter-based test updated to pin one-step.
  - [ ] LESSONS entry.
- **Status:** done (round 36 — see Done)

## T-35 — ErrorBoundary coverage (forced renderer crash)

- **Spec:** T-21 dispositioned ErrorBoundary as NOT COVERED — needs a
  deliberately induced render throw.
- **Acceptance criteria:**
  - [ ] A test route/flag or component-level unit harness that forces a
        render error; asserts the fallback renders (raw-hex exception
        styling intact), details disclosure expands, "Reload to Home"
        recovers to a working Home.
  - [ ] Ledger row updated from NOT COVERED.
- **Status:** done (round 36 — see Done)

## T-36 — waveform drag-to-cut needs two gestures instead of one

- **Spec:** T-24 finding. WaveformView subscribes to the new region's
  update-end inside the plugin's region-created handler, but wavesurfer
  7.12 emits region-created at drag END — so the first gesture leaves a
  region and no cut; only manipulating that region afterwards commits
  one. The panel copy promises a single gesture. Pinned as a tripwire
  (toHaveCount(0) after gesture 1) in audio.spec.ts, with the fixer's
  trap documented in place: store-driven cut regions also emit
  region-created and their __cut marker is set after addRegion returns,
  so the guard must key on the cut- id prefix.
- **Acceptance criteria:**
  - [ ] One drag gesture creates the cut (commit on region-created, or
        equivalent), store-rendered cut regions still don't
        self-duplicate.
  - [ ] Flip the tripwire: chip count 1 after gesture 1; delete the
        second gesture from the test's dragCut helper.
  - [ ] LESSONS entry.
- **Status:** done (round 33 — see Done)

## T-37 — P1: video seeking is broken (imagii-file:// ignores Range requests)

- **Spec:** T-22 finding BUG-SEEK. protocol.ts serves media via
  net.fetch(file://...), which ignores Range headers -> Chromium reports
  video.seekable as [0,0] and clamps EVERY currentTime assignment to 0.
  Frame steps, arrow nudges, and precise positioning are all broken in
  the shipped app; playback works only because it streams sequentially.
  Evidence pinned in video-core.spec.ts (seek-request assertions note
  the blocked end state).
- **Acceptance criteria:**
  - [ ] Protocol handler answers Range requests (206 with correct
        Content-Range from a stream/slice; also correct Content-Length
        on full reads); seekable spans the duration.
  - [ ] video-core.spec.ts seek assertions upgraded from
        "seek requested" to "playhead lands there" for nudges, frame
        steps, and both buttons.
  - [ ] Layer 5 or E2E proof of a mid-file seek (e.g. park at 1.5s of a
        2s clip without playing through).
  - [ ] LESSONS entry.
- **Status:** done (round 27 — see Done)

## T-38 — preview canvas is blank until the first undoable edit

- **Spec:** T-22 BUG-PREVIEW. PreviewWrapper reads window.__imagiiVideoEl
  during a render that happens before Player attaches the element, and
  VideoStudio only re-renders on source/clips.length/canUndo/canRedo.
- **Acceptance criteria:**
  - [ ] Freshly imported video shows the output preview immediately
        (ref callback, effect, or store-driven attach signal).
  - [ ] E2E asserts a non-default preview canvas right after import.
- **Status:** done (round 35 — see Done)

## T-39 — crop/safe-zone overlays draw over the letterbox; crop row sits inside the frame

- **Spec:** T-22 findings 3+4. Both overlays anchor to the wrapper, not
  the video box, so guides/crop draw over black bars whenever aspect
  differs; the Crop control row renders beside the picture inside the
  player's black box while the tutorial says "above the player".
- **Acceptance criteria:**
  - [ ] Overlays anchored to the rendered video rect (correct at
        multiple window widths); E2E asserts guide geometry against the
        video element's box, not the wrapper.
  - [ ] Crop controls moved above the player per the tutorial copy.
        (Usability ruling 2026-08-15: the tutorial's promise defines
        expected placement — move the controls, don't edit the copy.)
- **Status:** done (round 35 — see Done)

## T-40 — undo coalescing never closes a gesture

- **Spec:** T-22 finding 5. historyKey only resets on discrete actions,
  undo/redo and selectClip — consecutive trim drags or repeated preset
  clicks collapse into one undo step. video-core.spec.ts works around
  it (comment marks the spot).
- **Acceptance criteria:**
  - [ ] Gesture end (Timeline onUp, Rnd stop, slider commit) closes the
        coalescing window; two consecutive drags = two undo steps.
  - [ ] Unit test on the store; E2E workaround removed with the pin
        flipped.
- **Status:** open

## T-47 — session continuity: close the app, reopen where you were (owner request, 2026-08-15)

- **Spec:** owner directive. Closing imagii and reopening should offer
  to continue exactly where the user was — their choice via the
  existing restore banner, never forced. Today's autosave captures
  project DATA (stores) but not PLACE: restore lands on Home with
  selections lost, the last few seconds of work can miss the snapshot,
  and the window forgets its size. Builds on T-32/T-33 (same files).
- **Acceptance criteria:**
  - [ ] Autosave snapshot gains a place record: active route, selected
        clip id (video), selected layer id (canvas), references tab,
        player currentTime — versioned in the schema, validated like
        every other field, old snapshots without it still restore.
  - [ ] A final autosave flush runs on quit (before-quit path, and the
        window-close path) so the snapshot is the LAST state, not the
        last debounce tick. Quit must never hang on a slow disk —
        bounded, best-effort, tested both ways.
  - [ ] Restore returns the user to the captured route with selections
        and playhead applied (playhead lands within the T-37-fixed
        seek behavior; if T-37 is not yet merged, park via the same
        mechanism the player uses).
  - [ ] Window bounds (size/position, maximized flag) persist across
        launches independently of the banner choice — but never
        restore a window onto a disconnected display (validate against
        current screen geometry; center on primary as fallback).
  - [ ] Declining the banner ("Later"/dismiss) or discarding must
        leave a fresh-start session untouched — continuity is opt-in
        per the owner's wording, asserted in both branches.
  - [ ] Known non-goals documented in the ticket close: in-flight
        exports/recordings do not survive a restart (their cancel/reap
        behavior on quit is already covered); References search
        results are not persisted (network state).
  - [ ] E2E: edit in two studios -> quit via window close -> relaunch
        on the same userData -> Restore -> assert route, selections,
        playhead, and window bounds. Negative: corrupt place record
        degrades to today's data-only restore, never a crash (extends
        the T-33 contract + autosaveCorruptInfo pins).
  - [ ] LESSONS entry if any bug is found while building; ledger rows
        for the new/changed elements in the same PR per the standing
        bar.
- **Status:** done (round 34 — see Done). Non-goals, as the ticket
  required: in-flight exports/recordings do not survive a restart
  (their quit cancel/reap behavior was already covered); References
  SEARCH RESULTS are not persisted (network state) — only the active
  tab is. Both documented in continuity.spec.ts's header.

## Fix-wave plan (dispatches when Wave B lands; owner tiebreaker applies)

Priority by usability impact, per the owner's 2026-08-15 ruling that
expected behavior wins every call:

1. **T-37** seeking (P1 — core editing is broken without it)
2. **T-32** global undo tracker + Redo reachability
3. **T-31** Home toast surface (silent success/failure)
4. **T-36** one-gesture waveform cut (panel copy is the promise)
5. **T-33** corruption banner (user must be told)
5b. **T-47** session continuity (owner request; same subsystem as
    T-32/T-33 — place record, quit flush, route+selection restore,
    window bounds)
6. **T-34** tutorial clamp + Enter=one step
7. **T-38** preview blank until first edit
8. **T-39** overlay anchoring + crop controls above player
9. **T-28** mood-board rename/first-save via in-app Modal
10. **T-29** true cache clear
11. **T-40** undo gesture granularity
12. **T-30** friendly first-hop search errors
13. **T-35** ErrorBoundary coverage

Wave B findings slot in by the same usability ruling:

- **T-45** (P1: exports lie about their size, Twitch rejects the emote
  pack) runs immediately after T-37 — the two P1s first.
- **T-44** (discard reports as a crash + strands a broken file) and
  **T-48** (silent false "Clip added") join the top half — silent or
  alarming wrong feedback is the same class as T-31/T-33.
- **T-50** (custom presets are a dead end) and **T-42** (webcam
  silently dropped) follow — features that promise and don't deliver.
- **T-41, T-43, T-46, T-49** ride the tail with the polish tickets.
- **T-51** (win32-gated drawtext pixels) is test infrastructure — pair
  it with the first release-workflow run after the fix waves.
- **T-52** (timeline click-to-scrub + seek edges, filed round 27) runs
  right after T-45: with seeking fixed, the un-clickable timeline is
  the most visible affordance gap in the app.
- **T-53** (P1, filed round 28: selection handles and grid baked into
  export bytes) joins the P1 tier — wrong pixels in the deliverable
  beat every polish item. **T-54** (background dropped from exports)
  follows it; **T-55** (suite contention flake) is test infrastructure
  and can run any time a worker is otherwise idle.

Every fix flips its pin; every flip is red-green evidenced; LESSONS per
IMG-PREC.

## T-41 — zero capture sources is indistinguishable from never-searched

- **Spec:** T-27 finding A. chooseSource flips phase to 'choosing' but
  both branches render the same button — no message, spinner, or
  disabled state. On denied-permission systems the button looks dead.
- **Acceptance criteria:** empty result renders a distinct, helpful
  state (what happened + what to try); pin flipped in record.spec.ts.
- **Status:** done (round 41 — see Done)

## T-42 — webcam checkbox with zero cameras silently drops the PiP

- **Spec:** T-27 finding B. No zero-camera hint (mic has one); checkbox
  stays ticked, Corner picker appears, recording proceeds screen-only
  with no warning — the exact UI-vs-output mismatch the effectiveCamId
  comment says it set out to kill.
- **Acceptance criteria:** zero-camera state mirrors the mic warning;
  recording with a ticked-but-unavailable webcam surfaces the existing
  webcam-failure toast; pins flipped.
- **Status:** done (round 37 — see Done)

## T-43 — Record settings persistence is inconsistent (MP4 checkbox; mount-writes)

- **Spec:** T-27 findings C+D. convertToMp4 is component-local state
  (the only Record preference that resets), while the corner-persist
  effect writes config.json on mere mount with no user-touched guard.
- **Acceptance criteria:** MP4 choice persists like the corner; no
  settings write occurs from mounting the route untouched (relaunch
  test asserts both); pins flipped.
- **Status:** done (round 41 — see Done)

## T-44 — "Discard recording" reports as a crash and strands a broken file

- **Spec:** T-27 finding E. Cancel SIGKILLs ffmpeg and the rejection
  surfaces as raw IPC text (same class as T-30); the calm "Recording
  discarded." copy exists but is never used on this path — and the
  half-written output .mp4 at the user's chosen path is never reaped
  (promoteTempWebm's finally reaps only its temp .webm).
- **Acceptance criteria:** deliberate cancel yields the calm copy, no
  error styling; the partial output file is deleted; pins flipped;
  usability ruling applies (user expects a discard, not a crash).
- **Status:** done (round 32 — see Done)

## T-45 — P1: image exports render at screen zoom, not document size

- **Spec:** T-25 findings BUG-EXPORT-ZOOM + BUG-EMOTE-SIZES (same root).
  ExportDialog captures stage.width() = doc.width x fit-to-container
  zoom, so a 1280x720 template exports at 956x537 at "1x" and the size
  varies with the window. The emote pack inherits it and hits the 4x
  zoom cap: labeled 28/56/112, actually 112/224/448 — Twitch rejects.
  Pinned in image.spec.ts (dimension pin + emote tripwire).
- **Acceptance criteria:**
  - [ ] Export pixelRatio computed against doc dimensions (independent
        of window size); "1x" emits exactly doc.width x doc.height.
  - [ ] Emote pack emits exactly 28/56/112; tripwire flipped.
  - [ ] Window-resize invariance asserted (two sizes, same bytes-dims).
  - [ ] LESSONS entry. Usability ruling: the labels are the promise.
- **Status:** done (round 28 — see Done)

## T-46 — variants dialog shows stale previews of a dead canvas, and saves at screen zoom

- **Spec:** T-25 BUG-VARIANTS-STALE. previews state survives close, so
  reopening after canvas changes shows renders of a canvas that no
  longer exists and hides the Generate button. EXTENDED round 28: the
  T-45 worker probed that `ThumbnailVariants.tsx:118` has the same
  screen-zoom capture bug T-45 just fixed in ExportDialog — saving the
  "Warm" variant of a 1280x720 template writes 956x537, and the
  existing variants test only asserts `w > 0`, so nothing pins it.
  `captureDocument` is exported from ExportDialog.tsx and fixes it in
  one line.
- **Acceptance criteria:** reopen regenerates or clears (Generate
  visible); stale pin flipped; variant saves go through
  `captureDocument` and a dimension pin asserts doc-size bytes.
- **Status:** done (round 40 — see Done)

## T-48 — chat highlight "+ clip" reports success for a clip it never adds

- **Spec:** T-23 FINDING-1. `addPeak` clamps the padded END to the
  source duration but never the START
  (`ChatHighlightPanel.tsx:83-89`), so when the chat log's timestamps
  run past the loaded source the range comes out reversed;
  `addClipFromRange` rejects it silently and `toast.success('Clip
  added')` fires anyway. Pinned in video-pipelines.spec.ts (toast
  fires, `Clips (1)` unchanged).
- **Acceptance criteria:**
  - [ ] A peak outside the source either lands as a valid clamped
        range or is refused with honest copy — the success toast fires
        only when the clip actually appears.
  - [ ] Pin flipped red-green; LESSONS entry (silent-success class).
- **Status:** done (round 32 — see Done)

## T-49 — watermark position never persists; dead "No presets" error path

- **Spec:** T-23 FINDINGS 2+3, same panel. `runExportQueue` persists
  `streamerHandle` + `filenameTemplate` only (`ExportPanel.tsx:177-178`)
  — a user who picks "top left" gets bottom-right back next launch.
  And `"No presets selected on any clip"` (`ExportPanel.tsx:204-207`)
  is unreachable: the Export button is disabled at `totalQueued === 0`
  and the queue is built from the same sum. Both pinned in
  video-pipelines.spec.ts.
- **Acceptance criteria:**
  - [ ] Watermark position persists and restores like the handle.
  - [ ] The dead path is removed (or made genuinely reachable and
        tested); no unreachable user-facing copy remains in the panel.
  - [ ] Pins flipped red-green.
- **Status:** done (round 41 — see Done)

## T-50 — custom presets can never be used for an export

- **Spec:** T-23 FINDING-4. A saved custom preset round-trips to disk
  but never becomes an export target — the per-clip preset grid maps
  `ALL_PLATFORM_IDS` only (`ExportPanel.tsx:357`), and the manager
  modal's own footer admits it. The whole feature is a dead end.
  Pinned in both directions (5 platform checkboxes, no custom entry).
- **Acceptance criteria:**
  - [ ] Saved custom presets appear alongside the platform presets in
        the per-clip grid and export at their stored dimensions
        (ffprobe-verified E2E).
  - [ ] Deleting a custom preset that clips have queued degrades
        safely (unqueue, never a crash or a ghost row).
  - [ ] Pins flipped red-green; usability ruling applies (saving a
        preset promises it can be used).
- **Status:** done (round 37 — see Done)

## T-52 — timeline click-to-scrub, and two seek edges the T-37 fix exposed

- **Spec:** T-37 worker findings, not fixed there. (a) Timeline renders
  a playhead from currentTime but has NO click handler — "click the
  timeline to scrub" is the most obvious seeking gesture and it does
  nothing; now that seeking works this is the most visible remaining
  gap (usability ruling: the playhead invites the click). (b)
  `Player.tsx:28` resets `currentTime = 0` whenever `source?.url`
  identity changes — a no-op while seeking was broken, a real playhead
  rewind now if source identity ever churns. (c) `nudge()` clamps to
  the ffprobe duration (2.0) rather than the media element's
  (2.020136), so tail nudges stop ~20 ms short of the real end.
- **Acceptance criteria:**
  - [ ] Clicking (and dragging) on the Timeline track seeks there;
        landed-playhead E2E like the T-37 assertions.
  - [ ] Source-change effect only resets the playhead on a genuinely
        different file (or is removed if redundant); regression test.
  - [ ] Tail nudge reaches the media element's own duration; unit or
        E2E pin.
  - [ ] Ledger rows for the new interactive surface in the same PR.
- **Status:** done (round 30 — see Done)

## T-53 — P1: selection handles and the grid are baked into image exports

- **Spec:** T-45 worker finding, probed on the fixed build. Konva's
  `Stage._toKonvaCanvas` draws ALL visible layers, and Canvas.tsx puts
  the Transformer (selection handles/border) and the grid overlay in
  stage layers — so exporting with a layer selected, or with Grid
  checked, writes them into the PNG/JPG bytes. Reachable from the
  default flow: select a shape, hit Export. The canvas-vs-export bytes
  differ exactly by the chrome.
- **Acceptance criteria:**
  - [ ] Exports (single, emote pack, and variants once T-46 routes
        them through `captureDocument`) exclude the Transformer and
        grid layers — hide-for-capture inside `captureDocument` (same
        neutralise-and-restore pattern, `finally`-guarded).
  - [ ] E2E: export with a selection and with Grid on produces bytes
        identical to the deselected/grid-off export of the same doc.
  - [ ] Riders (same files, deletion over addition): remove the dead
        `Canvas.tsx:446 getStageDataUrl()` (zero callers); refresh
        `defaultExportScale`'s doc comment, whose "match what the user
        sees" rationale described the bug T-45 removed.
  - [ ] LESSONS entry.
- **Status:** done (round 29 — see Done)

## T-54 — exports drop the document background

- **Spec:** T-45 worker finding. `doc.background` is a CSS style on
  the stage element, not a Konva layer, so no export captures it: PNGs
  come out transparent and JPGs composite onto black, while the canvas
  shows the template's background (e.g. the thumbnail templates'
  dark fill). Usability ruling: the user expects what the canvas
  shows. Nuance: the emote pack and overlay-style docs WANT
  transparency — that is the point of an emote.
- **Acceptance criteria:**
  - [ ] Exports paint `doc.background` behind the layers (PNG and
        JPG); the emote-pack path stays transparent; if a per-export
        "transparent background" choice is added, it defaults to
        matching the canvas.
  - [ ] E2E samples a background pixel from the exported bytes both
        ways.
- **Status:** done (round 40 — see Done)

## T-55 — full-suite E2E runs drop one roaming test under runner contention

- **Spec:** observed across rounds 27-28: full-suite runs (99 tests,
  ~2.3m) intermittently fail exactly one mouse-timing test — a
  different one each run (video-core trim drag, audio waveform drag,
  references tabs) — and every one is green standalone and in-file,
  across two workers' runs and the expediter's. The runner hosts
  several concurrent agent sessions; video-pipelines.spec.ts's header
  documents observed 50-100x slowdowns. Cost: every expedite now burns
  a re-run to discriminate flake from regression.
- **Acceptance criteria:**
  - [ ] Identify the shared timing assumption in the drag/gesture
        helpers (likely fixed-step mouse moves racing rAF-driven
        layout) and replace with condition-based waits, matching the
        deterministic-wait house style — no bare retries that would
        mask real regressions, no sleeps.
  - [ ] Ten consecutive full-suite runs green on a loaded box, or the
        specific failing gestures hardened with evidence of the race.
- **Status:** done (round 33 — see Done; closed on the AC's second
  branch — mechanism proven with a deterministic intruder harness,
  helpers hardened, 0 truncations post-fix across every arm)

## T-59 — a genuine convert crash still strands its partial output and toasts raw IPC text

- **Spec:** T-44 findings 1+2 — T-44 fixed the DELIBERATE-cancel
  branch only. A real ffmpeg crash mid-convert still (a) leaves the
  half-written .mp4 at the user's chosen path (pinned as a known gap
  in recordingCancel.test.ts so a fix flips it) and (b) surfaces in
  the renderer as `Error invoking remote method 'recording:finalize':
  ...` verbatim. Same class as T-30; use the T-44 sentinel shape.
  Rider: HighlightPanel.tsx:111-114 has the same unconditional
  toast.success — addClipFromRange now returns boolean, so the gate is
  one line (not currently reachable as a false success, but the shape
  is the disease).
- **Acceptance criteria:** crash branch reaps the partial file AND
  still reports an error, in friendly copy naming what failed; the
  known-gap pin flips; HighlightPanel gate added; negative tests
  discriminate per round-21 protocol.
- **Status:** done (round 39 — see Done)

## T-60 — the single-slot convert registry lets Discard kill an unrelated import

- **Spec:** T-44 finding 3, pre-existing. cancelActiveConvert() kills
  whatever convert child is in flight: an import transcode
  (convertForImport — flv/ts/wmv) running while a recording finishes
  would be killed by "Discard recording", and vice versa. Two
  long-running converts can also race the single slot.
- **Acceptance criteria:** cancellation is scoped to the job that
  asked (keyed registry or per-job handle); a Layer 5 or E2E proof
  that discarding a recording leaves a concurrent import transcode
  running to completion.
- **Status:** done (round 39 — see Done)

## T-57 — discarding an autosave has no error path

- **SEVERITY RAISED round 34:** the corruption banner's Clear button
  (dead code until T-33) now reaches discard() — a failing
  autosave:clear leaves the button spinning with no message, on a
  surface users can actually hit. Rider: the `lastRoute` settings key
  is dead (in SettingsKey, allowlist, and schema; zero readers or
  writers — T-47 restores route via the snapshot's place record
  instead). Delete it in this fix.
- **Spec:** T-31/T-32 worker finding. `AutosaveRestore.discard()`
  awaits `window.api.autosave.clear()` with no catch: a failed clear
  rejects unhandled and the user sees nothing (the "Autosave
  discarded." toast simply never appears, and the banner state is
  ambiguous). Now that Home renders toasts (T-31), an error toast has
  somewhere to land.
- **Acceptance criteria:** failed clear surfaces a specific error
  toast and leaves the banner in a truthful state; negative test
  proves the copy discriminates (round-21 protocol).
- **Status:** done (round 39 — see Done)

## T-58 — give References an undo history (owner ruled: yes, 2026-08-16)

- **Spec:** T-32 worker finding; the owner ruled that References gets
  a history like the other studios rather than a documented boundary.
  The references/moodboard store currently has none, so Home's "Undo
  last action" can never target reference work, and deleting a mood
  board is destructive-with-confirm while every other studio's
  destructive action is undoable.
- **Acceptance criteria:**
  - [ ] referencesStore gains the same history shape the other three
        studios use (past/future, canUndo/canRedo, the 50-step cap) —
        reuse the existing store history pattern, no fourth variant.
  - [ ] Undoable: board create/rename/delete (delete restores the
        board WITH its items), item add/remove, asset-canvas bridge
        state if it lives in this store. The delete confirm stays
        (it guards more than the store: cached thumbs), but a
        confirmed delete is now reversible.
  - [ ] References joins useGlobalUndo's module-level tracker (the
        counting reconciler picks it up from the store subscription
        list) and Home's "last:" readout names it.
  - [ ] Studio-level undo affordance consistent with the others
        (useUndoRedoHotkeys + header buttons per the T-15 pattern).
  - [ ] E2E: delete a board -> Undo restores it with items; cross-
        studio ordering test extended to a references edit; ledger
        rows updated.
  - [ ] Snapshot/restore interplay: the T-47 post-restore contract
        (Undo disabled after restore) applies to this store too.
- **Status:** done (round 38 — see Done)

## T-56 — Timeline playhead is a raw palette color; track space stops at the probe duration

- **Spec:** T-52 worker findings. (a) The playhead marker is
  `bg-pink-400` — a raw Tailwind palette color, violating the
  colors-from-tokens non-negotiable; predates round 19's retheme, and
  several E2E locators key on the class, so the swap needs its own
  change with locator updates. WIDENED round 33: WaveformView.tsx
  carries two raw rgba() literals in JS context (the drag-selection
  fill and the cut-region fill rgba(244,63,94,…) — rose-500, not even
  the accent) despite importing tokens.ts two lines up; same disease,
  same fix pass. (b) The track's coordinate space is the
  ffprobe duration, so its right edge sits ~20 ms short of the media
  element's real end — the last frames are unreachable by click or the
  End key (the Player's own nudge already reaches them post-T-52);
  upgrade path is publishing the element's duration into the store on
  `durationchange`.
- **Acceptance criteria:**
  - [ ] Playhead color comes from tokens.ts/tailwind.config.js (WCAG
        AA against the track); all dependent locators updated; the
        designTokensInSync check stays green.
  - [ ] Track space (click, drag, End, aria-valuemax) reaches the
        element's duration; the T-52 tail pin extended to the track.
- **Status:** done (round 42 — see Done)

## T-64 — the tutorial coachmark is aria-modal but traps no focus

- **Spec:** T-34/T-35 worker finding, pre-existing. The coachmark is
  role="dialog" aria-modal="true" with NO Tab focus trap and no focus
  restore on close — Tab walks out into the studio behind the scrim.
  Modal.tsx (98-112) already does both; the tutorial predates it.
  Rider: Tutorial polls its target every 300 ms with a fresh rect
  object AND re-issues scrollIntoView({behavior:'smooth'}) each tick —
  an open coachmark re-renders ~3x/s while nothing moves.
- **Acceptance criteria:** Tab cycles inside the coachmark; focus
  restores on close/skip (reuse Modal's mechanism per the ladder);
  poll only updates state when the rect actually changed and
  scrollIntoView fires once per step; E2E + unit per the standing bar.
- **Status:** open

## T-63 — Space on a focused crop button both clicks it and toggles playback

- **Spec:** T-38/T-39 worker finding, pre-existing. Player's key
  handler sits on the column with tabIndex=0 and exempts only
  INPUT/TEXTAREA, so Space on a focused crop preset button activates
  the button AND toggles playback. Now more visible with the crop row
  above the player.
- **Acceptance criteria:** Space on a focused button activates only
  the button (exempt BUTTON, or scope the handler); E2E asserts no
  playback toggle; existing Space-toggles-playback coverage still
  green.
- **Status:** done (round 42 — see Done)

## T-61 — a cut drag that starts on top of an existing cut does nothing

- **Spec:** T-36 worker finding, pre-existing. Every stored cut region
  gets its own makeDraggable even with drag:false/resize:false, and
  its document-level pointermove handler calls preventDefault() first;
  enableDragSelection's handler then bails on defaultPrevented. So
  dragging a new cut starting inside an existing one silently does
  nothing — the exact gesture a user makes to widen a cut. Usability
  ruling applies.
- **Acceptance criteria:** a drag starting inside an existing cut
  creates its own cut (or visibly extends — pick the behavior a user
  expects and say why); E2E asserts it; the T-36 overlap test's
  "starts in the gap" workaround note is retired.
- **Status:** done (round 42 — see Done)

## T-72 — HotkeyOverlay's ? toggle stacks over open dialogs

- **Spec:** T-68 worker finding. The ? window listener has only the
  tagName guard, so ? behind an open Variants/Templates dialog stacks
  the overlay on top of it. It cannot take isModalOpen() naively — it
  renders its own Modal and would be unable to close itself; needs a
  topmost-modal notion or a self-exemption. Rider: RecordStudio's
  Escape-to-stop has the same shape, harmless today only because no
  Modal is reachable while recording — leave a guard or a comment so a
  future modal doesn't make Escape both close it and end the take.
- **Acceptance criteria:** ? is inert behind other modals but the
  overlay can still dismiss itself; E2E both ways; the Record Escape
  shape addressed or documented in place.
- **Status:** open

## T-71 — no semantic color tier: rose/amber/emerald raw palette classes repo-wide

- **Spec:** T-56 worker finding. There is no danger/warn/ok token
  tier, so text-rose-300, bg-rose-500, bg-amber-300, bg-emerald-400,
  border-amber-400/40 carry those meanings across ~12 files
  (VolumeMeter, SuccessIndicator, ReferencePanel notice + error cards,
  most delete buttons). Same disease as T-56's playhead, larger scope.
  Rider: hand-copied alpha literals of real tokens are now mechanical
  with withAlpha — Canvas.tsx:87,98 (INK_MUTED@0.18),
  canvasStore.ts:259,281; templates.ts/assetCatalog.ts are arguably
  document content, decide and document.
- **Acceptance criteria:** danger/warn/ok tokens added to both files
  + the sync test, WCAG AA shown per pairing; all semantic palette
  classes migrated with locators updated; withAlpha adopted for the
  alpha literals; owner screenshot review flagged (visual deltas).
- **Status:** open

## T-69 — a stale source selection keeps Start enabled after a refresh into nothing

- **Spec:** T-41/T-43 worker finding, pre-existing. selectedSourceId
  survives a refresh that returns an empty or changed list, so a user
  who picked a source and refreshed into nothing keeps Start recording
  enabled, pointing at a source that no longer exists (fails later at
  getUserMedia).
- **Acceptance criteria:** a refresh reconciles the selection against
  the new list (drop or reselect-first per the existing auto-select
  behavior); E2E: select real -> stub empty -> refresh -> Start
  disabled + the T-41 empty state shown.
- **Status:** done (round 43 — see Done)

## T-70 — installToastLog records every mounted element, not toasts

- **Spec:** T-41 worker finding. record.spec.ts's installToastLog (the
  export.spec pattern) logs the text of every element mounted under
  body, so panel copy pollutes ~12 assertions in that file (it broke
  the old T-41 pin's toEqual([]) on the fixed build).
  references.spec.ts already has the narrowed [role="status"] version.
- **Acceptance criteria:** the narrowed helper adopted repo-wide (one
  shared helper file per the ladder); the polluted assertions
  re-verified; a mutation proof that the narrow version still catches
  a real toast.
- **Status:** done (round 43 — see Done)

## T-68 — image hotkeys fire through open modals

- **Spec:** T-46/T-54 worker finding, pre-existing. ImageStudio's
  global key handler guards only INPUT/TEXTAREA, not "a modal is
  open" — with the Variants or Templates dialog up, Delete still
  removes the selected layer behind the scrim and R/O/L/P still
  switch the canvas tool.
- **Acceptance criteria:** studio hotkeys are inert while a Modal is
  open (shared mechanism if another studio has the same hole — grep
  first); E2E asserts Delete behind the Variants dialog removes
  nothing; existing hotkey coverage stays green.
- **Status:** done (round 43 — see Done)

## T-67 — tempCleanup.test.ts is polluted by other suites' temp families

- **Spec:** T-59/T-60 worker finding, pre-existing. The test clears
  only imagii-audio and imagii-concat, but pruneStaleTempFiles also
  scans imagii-import — running test:media (whose linux
  mpegts-segfault pin leaves a partial there) before npm test makes
  "handles a missing tempdir gracefully" fail with expected 0 to be 2.
- **Acceptance criteria:** the test isolates every family the
  function scans (clear or tempdir-scope them all); running test:media
  then npm test back-to-back is green.
- **Status:** done (round 43 — see Done)

## T-66 — References polish: failure notice contradicted by "No results."; delete toast should advertise undo

- **Spec:** T-58/T-30 worker findings. (a) ReferencePanel renders
  "No results." underneath a failure notice — now the COMMON failure
  view since hop-1 routes there too; reads as "the search ran and
  found nothing". One condition fixes it. (b) MoodBoardPanel's delete
  toast still says only "Deleted." — the action is reversible since
  T-58 and the toast is where the other studios advertise it.
- **Acceptance criteria:** no "No results." while a notice is shown
  (both asserted); delete toast names the undo path; copy per
  BRANDING_GUIDE.
- **Status:** done (round 42 — see Done)

## T-65 — auto-cropped exports carry a non-square SAR (anamorphic by ~0.25%)

- **Spec:** T-50 worker finding, pre-existing on the platform path.
  autoCropForAspect rounds crops to even pixels (1080x606 off a
  1080x1920 source is 1.782:1, not 1.778:1) and ffmpeg records the
  difference as SAR 405:404 instead of scaling — T-12's square-pixel
  rule is enforced only in runReframe. The T-50 Layer 5 suite asserts
  custom and platform paths are geometrically identical and documents
  this at the assertion.
- **Acceptance criteria:** export path emits SAR 1:1 (setsar or
  scale-after-crop, matching runReframe's approach); Layer 5 asserts
  square pixels on an odd-aspect crop; pins updated.
- **Status:** open

## T-62 — remaining mouse gestures still on the truncatable shape

- **Spec:** T-55 follow-through. The hardened drag.ts helper (send
  redundantly, poll the app's drawn state before release) covers the
  roster that actually failed; the same exposure remains in
  image.spec.ts's Transformer move/resize drags (~3 sites) and
  video-core.spec.ts's crop-overlay drag/resize. They have not failed
  yet; the mechanism (pointerout mid-drag when a sibling window maps)
  applies to them identically.
- **Acceptance criteria:** those call sites route through drag.ts (or
  its pattern); one loaded-box roster loop green. WIDENED round 37:
  image.spec.ts:1168 (layer-panel end-state test) asserts a
  gesture-derived coordinate at precision 0 instead of the file's own
  MOUSE_TOL — deterministically red at 1600x1200 Xvfb geometry, green
  at 1920x1080 (fit-zoom changes pointer->document rounding). Fix the
  tolerance in the same pass. WIDENED round 39: under the T-59 worker's
  self-generated load (two extra Electron launches at 2 workers), the
  audio waveform drag helper's readiness read returned NaN and the
  drag failed reproducibly — passes on an idle box at the same worker
  count (expediter confirmed 120/120). Harden the readiness read (poll
  a number, not a first read); `--workers=1` remains the documented
  fallback if flakes continue after conversion.
- **Status:** done (round 43 — see Done; closed on the fallback
  branch: workers pinned to 1 in playwright.config.ts after the
  residual crossing-event window was proven unpollable)

## T-51 — nothing anywhere renders watermark/text-overlay pixels (drawtext)

- **Spec:** T-23 finding 5 — a per-platform capability gap, same class
  as the round-20 mpegts segfault. The linux ffmpeg-static build has
  NO `drawtext` filter: any export carrying a watermark or a text
  overlay dies at graph init on dev boxes, so every dev/CI execution
  asserts drawtext's command string at most — its pixels are proven on
  no platform. The shipped win32 (gyan.dev) build has the filter, and
  the release workflow is the de facto Windows CI (LESSONS 2026-08-15).
- **Acceptance criteria:**
  - [ ] Layer 5 test gated `it.skipIf(process.platform !== 'win32')`
        proving watermark/text-overlay pixels land (diff vs a clean
        render of the same source — nonzero where the text sits, zero
        elsewhere; the caption burn-in PSNR-band technique applies).
  - [ ] A linux pin that FAILS when ffmpeg-static gains drawtext, so
        the gate gets lifted instead of rotting (mirror the mpegts
        segfault pin).
  - [ ] Runs in the release workflow's verify step; documented in
        mediaFormats-style per-platform caveat comment where the
        watermark graph is built.
- **Status:** open

---

## Done

Round 43 — fix wave batch 17: T-62 + T-67 + T-70 (test infra) +
T-68 + T-69 (product). T-62: five gesture call sites converted to
drag.ts (Transformer move/anchor with live-node extents; the locked
drag as the documented commit-nothing case; crop move/resize against
the rnd box); the geometry-fragile layer-panel assertion split — the
app's own +20 arithmetic asserted exactly, the drag-derived nominal
under MOUSE_TOL — red at 1600x1200 before, 20/20 after; dragCut's
readiness read is settledBox (two agreeing numeric reads). The
residual audio flake was then cornered honestly: planning boxes
proven byte-identical before/after settling, so the only mechanism
left is the crossing event landing between mouse.down and the first
processed move — a window no polled condition can wait out. CLOSED ON
THE FALLBACK BRANCH: workers: 1 pinned in playwright.config.ts (the
config comment carries the full why), 123/123 at 4.4m vs the 2/9
failure rate at 2 workers under load; the expediter re-ran green.
T-67: the clear list derives from the function's own TEMP_SUBDIRS so
a new family is isolated on the same commit; deterministic repro red
(a planted imagii-import partial) then green with all three families
polluted; the acceptance sequence run (test:media -> npm test green —
with the honest note that /tmp/imagii-import is empty after
test:media on THIS box, so the repro, not the sequence, is the
proof). T-70: one shared tests/e2e/toastLog.ts — selector
[data-rht-toaster] [role="status"] (both halves load-bearing: the
export panel renders a per-job role=status readout the wide version
logged as a toast), de-duped by element identity not text (two
identical refusal toasts must count as two); 197 duplicated helper
lines deleted across 8 specs; mutation proof via selector redirect.
T-68: Modal owns a module-level open COUNTER (dialogs stack;
ExportDialog's confirm opens over ExportDialog) read at event time;
the same hole was found and fixed in the shared undo hotkeys (Ctrl+Z
behind Variants rewrote the document the dialog rendered from);
red-first (Delete removed the layer behind the scrim), and the
after-close half proves the fix is not hotkeys-off. Expediter
mutation: the counter threshold made unreachable -> exactly the T-68
E2E red (the worker had mutated the consumer check — both halves now
proven). T-69: one reconcile subsumes the old
first-selection-only auto-select — keep if listed, else first, else
null; the catch branch reconciles against [] (a refused refresh has
no claim to a stale id); three branches asserted (empty/changed/
refused) with two branch-isolating mutations. Gates: 1070 unit /
123 E2E x2 (+ the workers:1 rerun), test:media -> npm test sequence
green. Findings: T-72 filed (? stacks over dialogs, Record Escape
rider); tests/ outside the tsconfig includes noted (spec type errors
surface only at run time).

Round 42 — fix wave batch 16: T-56 + T-61 + T-63 + T-66 (UI residues).
T-56: the playhead is bg-ember — EMBER already IS the Audio Studio's
playhead (wavesurfer cursor), so one mark now has one color in both
timed studios; 9.99:1 on the bare track, 7.35:1 over the clip fill
(accent rejected: the range/handles are accent and the old pink sat
at 1.38:1 where the handles paint over the marker). The two waveform
rgba literals route through a new tokens.ts withAlpha helper — the
drag fill was ACCENT@0.25 exactly (byte-identical output); the cut
fill goes rose->accent DELIBERATELY, chips moved with it (the chip is
the legend for the mark) — owner screenshot review flagged. Track
space: the Player publishes the element duration on durationchange;
playableDuration feeds the track, aria-valuemax, the transport
readout, and requestSeek's clamp, so the readout can no longer say
0:02.00 while the playhead sits at 2.02. T-61: wavesurfer attaches
makeDraggable to every region unconditionally (drag:false only gates
onMove) and its preventDefault starves enableDragSelection — stored
cuts are marks, not controls, so pointer-events: none on the cut
elements kills the interception at the root; a drag starting inside a
cut now creates its own cut (extend-under-press would make one
gesture mean two things). T-63: the bug was WORSE than ticketed — the
container's preventDefault also suppressed Chromium's keyup button
activation, so Space on a focused preset applied nothing and only
started playback. Per-key exemption (BUTTON owns Space; arrows/,/.
stay global in the column — target-scoping would have silently cost
those four bindings after any click). T-66: one condition kills "No
results." under a notice, with a NEW empty-but-successful-search
phase (main-stub) so deleting the branch outright cannot pass;
delete toast: "Deleted — press Ctrl+Z to undo." Red-green on all
pins; worker mutations per ticket; EXPEDITER CORRECTION: the batch's
new right-edge-click test was geometry-fragile — at the runner's
1280 screen the strip right of the trim-end handle is sub-pixel
(measured 895.5 on an 896 track; resizing wider is clamped by
windowSizing), so the click landed on the handle, which has drag
priority BY DESIGN. Rewritten as the honest pointer gesture: a drag
that starts on the scrub surface and carries under the handle to the
edge, expectation derived from the real boxes — 19/19 + 121/121
after. Expediter mutation: playableDuration ignoring the element ->
3 named units + the keyboard-scrubber E2E red, restore, green.
Gates: 1069 unit / 121 E2E. Findings: T-71 filed (semantic color
tier, repo-wide); clip ranges still clamp to probe (deliberate,
export path untouched); the T-47 restore-park probe-clamp residual
bounded under SEEK_TOLERANCE and unit-pinned.

Round 41 — fix wave batch 15: T-49 + T-41 + T-43 (the persistence/
honesty trio; one shared lesson — a control is a promise in both
directions). T-49: watermarkPosition persists in the same
if(watermark) block as the handle and restores through the same mount
effect, guarded by a WATERMARK_POSITIONS array that also feeds the
picker so the options and the guard cannot drift; the relaunch E2E
reads both halves back off the live panel. The dead "No presets
selected on any clip" path was judged genuinely unreachable (the
button disables on the same sum the queue iterates) and DELETED, with
source-level pins in interactionWiring (a string nothing renders is
invisible to a DOM test) plus the toast tripwire kept. T-41: the
ambiguous 'choosing' phase deleted rather than patched — the source
card now models never/searching/done and renders three distinct
states (invitation; disabled "Looking for screens and windows...";
the amber twin of the mic/camera warnings), and making the wait real
forced an error path into existence: a rejected listSources now
toasts through ipcErrorMessage instead of hanging the wait forever.
Driven off a 1.5 s-delayed stub (an instant stub cannot show
in-flight) plus a throwing stub for the refusal. T-43: BOTH Record
controls now write from their own onChange — the value-keyed persist
effect is gone, so a write is a user action by construction (one
fewer effect than a guard would cost); the byte/mtime-identical
no-write-on-arrival assertion is snapshotted post-Home because
electron-store legitimately stamps its theme default once per launch
(probed first). record.convertToMp4 + watermarkPosition added to all
four settings registries with the cross-check floor 16 -> 18.
Red-green on all pins; worker mutations per ticket; expediter's own:
the MP4 restore inverted -> exactly the T-43 relaunch test red
(first mutation attempt failed to match and was caught by the test
passing on the unmutated build — the guard against phantom
mutations working as designed), restore, 16/16. Gates: 1055 unit /
121 E2E clean, no flake. Findings: T-69 filed (stale selection keeps
Start enabled), T-70 filed (installToastLog is not a toast log);
USER_GUIDE corrected where its copy contradicted the shipped default.

Round 40 — fix wave batch 14: T-46 + T-54 (the image-capture pair).
T-54's mechanism is the standout: instead of painting the background
at capture time (either capture-side option would re-split the very
property whose split WAS the bug, and would drag DOM dependencies
into the node-testable captureDocument), doc.background became a
permanent Rect — first child of the document layer, listening=false,
NOT tagged chrome (the T-53 trap, pinned) — and the CSS background on
the Stage is deleted. One property, one renderer: screen and every
capture path agree by construction, and captureDocument needed zero
changes. fill="transparent" draws nothing, so the 7
overlay/emote templates keep their alpha with no branch and no
speculative UI (the AC's optional control skipped, stated). T-46:
variants route through captureDocument (the last raw toDataURL in the
renderer deleted); stale previews are keyed to the document they were
rendered from — reopening an untouched canvas keeps the tiles,
reopening after any edit shows Generate (chosen over clear-on-close:
discarding a render nobody invalidated loses under the tiebreaker;
store identity is exactly the question). Red-green: PNG {0,0,0,0} and
JPG r=0 flipped to the canvas's #241614; variants save 956x537
flipped to 1280x720 (the ticket's exact numbers); the stale pin
inverted. Byte-identity interplay re-verified: the T-45
window-invariance and T-53 four-way chrome tests stay green with the
background painted. Worker mutations: background Rect deleted, raw
toDataURL restored, doc-identity check dropped. Expediter's own: the
background tagged chrome -> exactly the not-chrome unit pins + the
background-pixel E2E red, restore, green — the T-53 trap guard
discriminates. Gates: 1052 unit / 121 E2E (one T-62 audio-drag drop
under parallelism, green standalone; image suite 19/19 twice). E2E
pixel technique recorded: sample via bundled ffmpeg with format
BEFORE crop (JPEG chroma subsampling rounds a 1x1 crop to 0x0
otherwise). Findings: T-68 filed (hotkeys fire through modals); the
no-background-control gap noted as a future owner call (setBackground
has zero callers — the natural home if a transparent-background
choice is ever wanted); duplicate round-39 ledger section deduped.

Round 39 — fix wave batch 13: T-57 + T-59 + T-60 (the error-path
cluster). T-60 first, because T-59 builds on it: the single convert
slot became a keyed registry — each job's entry carries its owner
('recording' | 'import') and its own T-44 cancelled flag; Discard
cancels only 'recording', convertForImport owns 'import', before-quit
cancels all. The red transcript is the ticket's exact disaster run
live: two real encodes, "Discard recording" -> the IMPORT died with
ConvertCancelledError while the recording's own convert ran to
completion untouched. Green: a Layer 5 concurrency test (stream_loop
long fixtures, cancel one owner, ffprobe the survivor) — "which
process did the SIGKILL reach" is a question no fake child can
answer; convertCancel.test.ts 10 -> 18 incl. the second latent slot
bug (a finished convert evicting other registrations). T-59: the
partial-output unlink moved ABOVE the cancel/crash branch so both
reap; ffmpeg's real text stays in main's log; the IPC carries a
friendly typed message and the renderer strips Electron's envelope
via the new shared ipcErrorMessage (STYLE_GUIDE entry) — the
known-gap pin flipped, and a real-crash E2E asserts the plain copy
with envelope/ffmpeg vocabulary absent. HighlightPanel rider gated.
T-57: the root cause was TWO-layered — clearAutosave swallowed unlink
errors, so the toast lied before discard() could even fail; main now
verifies the files are gone and throws naming survivors, discard()
catches, toasts the reason + "It's still on disk", and dismisses
NOTHING (banner + Clear stay, asserted). lastRoute rider deleted from
all four registries with the cross-check updated. Worker mutations
per ticket (owner-blind cancel; unlink-in-cancel-only; raw toast
restored; gate removed; swallow restored) — each red by name.
Expediter's own: ipcErrorMessage envelope-strip disabled -> 3 units +
the real-crash E2E red, restore, 13/13 + 16/16. Gates: 1045 unit /
68+2 Layer 5 / 120 E2E (worker green at --workers=1 under its own
load; expediter 120/120 at default workers on an idle box — the
discrepancy recorded in T-62, which gains the readiness-read
hardening; workers:1 stays a documented fallback, not a config
change no ticket asked for). tempCleanup cross-suite pollution noted
below as a new ticket.

Round 38 — fix wave batch 12: T-58 + T-30 (the References pair; T-58
per the owner's 2026-08-16 ruling). T-58: referencesStore gains the
house history shape copied field-for-field from videoStore (past/
future, 50-step cap, history identity changing EXACTLY on history
events — pinned by identity, not length; setTab/select/search never
rebuild it). Undo reaches DISK through one inverse: moodboard:restore
writes every board in the target snapshot and unlinks the rest, so
create/rename/delete/item-add/item-remove all reverse through one
gated path (assertSafeId/assertBoardName + parseCollection +
confineThumbPath — the same trust gates as the read side) and a
restored board keeps its id, items, and createdAt. Writes chain on a
module promise that refreshCollections awaits, so a panel mount right
after Ctrl+Z cannot re-read the pre-undo directory and silently put
the change back; a failed write makes the store adopt what disk says.
Thumbnails: the per-delete reap MOVED to a launch-time
sweepOrphanThumbs (an undone delete showing grey squares is not an
undo) which refuses to run if any board fails to parse and skips
files newer than the sweep — both disk states tested. References
joins the global tracker, the "last:" readout, and the shared
useUndoRedoHotkeys + header buttons; hotkeyTable and
interactionWiring extended to four studios; the T-47 post-restore
reset applies. T-30: SearchUnavailableError thrown over the WHOLE
first hop (including URL build — encodeURIComponent throws on a lone
surrogate, same bug one line earlier), runImageSearch lifted out of
ipcMain.handle for testability, one searchFailureNotice() shared with
hop 2; exact copy asserted in the amber card with the rose card
absent. Red-green via revert-the-product-change (md5-verified);
worker mutations: tracker subscription dropped, history push dropped,
getVqd re-exposed. Expediter's own: restoreCollections made a disk
no-op — both disk-asserting E2Es red ("comes back whole" and
"Remove is undoable") + 3 moodboard units, restore, 12/12 + 8/8 (one
botched restore attempt was caught by the red tests and redone —
the tests policed the expediter too). Gates: 1010 unit / 118 E2E.
Findings: T-66 filed (notice + "No results." contradiction; delete
toast should advertise undo), T-29 annotated (launch LRU),
one continuity-spec load flake observed once and green on repeats.

Round 37 — fix wave batch 11: T-50 + T-42 (the promised-affordance
pair; the batch survived a container restart mid-run and was resumed
with the tree intact). T-50: custom presets are real export targets —
one queuedPresets helper resolves platform + custom targets for the
grid, the Export-N count, the safe-zone pre-flight and the job queue
(a custom preset is a row, not a parallel path); resolveExportPreset
in main swaps geometry/fps/bitrates with aspectRatio RE-DERIVED from
the custom dimensions (inheriting the base aspect would crop-and-
stretch); ExportJobSpec carries the whole preset so an in-flight job
finishes at the dimensions it resolved, race-free by construction.
Delete-while-queued: prune drops the id from every clip (deliberately
NOT undoable — undo must never re-queue a deleted preset's file);
JobStatus carries presetLabel so a finished row keeps its true name.
Manager footer copy now states what presets DO; two new trust-boundary
guards (isValidBitrate both ends — these strings reach -b:v argv;
basePlatformId constrained to the five platforms, closing a latent
manager crash on hand-edited files). IMG-PREC attached: the export
resolution path changed, so Layer 5 gained a 6-case custom-preset
suite (67/2 green, worker and expediter runs). T-42: zero-camera state
mirrors the mic warning verbatim-but-the-noun; the Corner picker gates
like the device select; the effectiveCamId guard moved INSIDE the try
so a ticked-but-absent webcam lands in the EXISTING failure path
("Webcam failed: ... Recording screen only.") — one failure path, no
silent hole. New stubCameras E2E helper lifts the Webcam select out of
the HL block (Record HL 2 -> 1; HAND-TEST narrows to mic + live
compositor). All four pins flipped red-green. Worker mutations:
resolveExportPreset ignoring its custom arg (6 Layer 5 red), warning
render disabled (2 named E2E red). Expediter's own: pruneCustomPresets
no-op'd — E2E stayed GREEN (queuedPresets filters dead ids at every
consumer) while exactly the three prune unit tests went red; recorded
as the layers discriminating different things — the prune's contract
(stored-state hygiene, not-undoable) lives at the unit layer. Gates:
979 unit / 67+2 Layer 5 / 117 E2E. Worker's restart note: Xvfb
geometry changes fit-zoom rounding — a pre-existing image.spec
assertion is deterministically geometry-dependent, folded into T-62;
T-65 filed (anamorphic SAR on auto-crop, pre-existing platform-path
bug the new Layer 5 test documents).

Round 36 — fix wave batch 10: T-34 + T-35 (the last two items on the
original fix-wave list). T-34: one placement pipeline for all four
sides — requested side, opposite side, cross axis, then a clamp of
last resort into the window; never shrink (harder-to-read copy loses
under the tiebreaker); geometry runs on the card's MEASURED size via
useLayoutEffect (the 448x320 reservation overshot by 2 px in a real
case and wrongly bounced the card to the side), settling in one pass.
Enter is preventDefault'd where the window handler consumes it, with
the button-focus defer branch intact and the decision extracted pure
(tutorialKeyIntent); pinned one-step from BOTH focus states. Red at
HEAD: card right edge 1486.6 px in a 1280 window; Enter 1 -> 3.
Tutorial.test.ts adds 61 unit cases; the E2E hit-tests each button
via elementFromPoint before clicking through. Worker mutations: one
clamp arm (14 units red, E2E green — the layers discriminate
different things, reported honestly), full pre-T-34 geometry (the
exact unfixed 1486.6 red), preventDefault. T-35: ErrorBoundary driven
in the REAL app via a #/__crash route double-gated (unlinked hash +
window.__imagiiCrashTest, same family as the __imagii* test hooks);
unarmed it redirects like any unknown hash and the spec asserts that
guard FIRST. Fallback copy + verbatim thrown message + the documented
raw-hex exception styling (DESIGN_GUIDE:45-48 — deliberately not
tokens) + stack disclosure + Reload-to-Home recovering to a WORKING
Home (routing, toaster, hotkeys, an edit) with the boundary re-armed;
componentDidCatch probed to fire exactly once through recovery (6/6
incl. 5x repeat). Worker discrimination: boundary sabotaged to render
children -> named red. Expediter's own mutation: guard forced armed ->
exactly the T-35 test red on its unarmed-redirect assertion, restore,
15/15. Gates: 948 unit / 114 E2E clean. The crash route ships in the
production bundle BY DESIGN (gated, documented) — recorded in the
ledger so it is not later cleaned up without replacing the coverage.
Findings: T-64 filed (aria-modal coachmark traps no focus; 300 ms
poll churn rider).

Round 35 — fix wave batch 9: T-38 + T-39 (the video-preview pair).
T-38: the element now reaches OutputPreview through an owned attach
signal — Player takes onVideoElement, VideoStudio owns the state,
PreviewWrapper is deleted, and the ref is a useCallback so the
per-render detach/reattach churn from the T-37 report is gone
(deliberately NOT a store field: a DOM node has no place in a
serializable store that captureProject reads). Second independent
defect found and fixed on the way: the preview redrew on loadeddata,
which promises DATA, not a painted frame — instrumented drawImage off
that event was black about half the time, which is why the old tests
had to play the clip for pixels. One requestVideoFrameCallback,
re-armed in its own callback, now covers first frame, seeks, and
playback; the two tests that carried the playback workaround dropped
it and parkPlayhead is deleted. T-39: both overlays consume one
useVideoContentRect (element offset + the contain fit) — the fit math
was already computeCropBox read the other way round, so no second
copy; four unit tests pin that reading. The observer watches the
CONTAINER as well as the element (a resize moves a centered video
without resizing it — an element-only ResizeObserver never fires,
which was half the bug). Crop controls split out and moved above the
player per the tutorial's promise, coachmark still resolving (39/39);
the crop rectangle stays inside for the shadow-clip reason documented
in place. Rider on the same lines: applyAspectPreset normalizes
against the SOURCE frame, fixing 1:1 presets exporting non-square
under the old squeezed layout. Red-green: the T-22 pins flipped
(preview 300x150 default -> real 135x240 frame with Undo asserted
disabled both sides; guides at the box edge -> on the picture to the
pixel at two window sizes, with the letterbox first asserted 40+ px
wide so a box-anchored overlay cannot pass). Worker mutations: attach
call deleted, rect anchored to the container; expediter's own:
computeCropBox x-centering dropped -> exactly the three
centering/pillarbox unit tests red, restore, 14/14 + video-core
19/19. Gates: 887 unit / 112 E2E, no drops. Crop drags NOT converted
to drag.ts (worker's edits never touched those lines — T-62 stays
open and honest). Findings: T-63 filed (Space double-fires on focused
crop buttons); canvasSnapshot's bare querySelector noted; preload
note recorded.

Round 34 — fix wave batch 8: T-33 + T-47 (the corrupt-autosave banner,
and the owner's session-continuity feature). T-33: the renderer's
corruption branch gates on info.exists alone — age is decoration and
staleness is not a gate (a corrupt autosave is never restorable, so
hiding an old one just strands it); ageMs comes from the file's mtime
when the in-file timestamp can't be trusted, keeping the "(5 min ago)"
copy honest; savedAt stays undefined for corrupt files. T-21's
"offers nothing" pin flipped to the full banner path (copy verbatim,
Clear deletes + toasts, Dismiss keeps the file and reveals the
Last-autosave line, reload persistence both ways). T-47: snapshot
schema v3 adds a validated place record (route, video clip id, canvas
layer id, references tab, playhead) with per-field degradation — a bad
place is never fatal, and every-field-bad degrades to exactly the
pre-T-47 data-only restore; old v1/v2 snapshots restore unchanged
(fixture-asserted). Quit flush: 1.5 s bounded race on both paths
(window close intercepts, before-quit backstops — they overlap by
design since each is the only event on its path), silent-in-main on
failure per the T-44 rule, timeout branch tested with a write that
never settles. Window bounds: hand-rolled (no new dependency),
getNormalBounds + maximized flag so maximizing never destroys the
normal size, resolveWindowBounds validates against live displays and
centers-on-primary keeping size when the display is gone; exact
round-trip E2E + off-screen recovery E2E. Playhead parks via
requestSeek; found and fixed a real ordering bug — the T-52 mount
reset zeroed a park that happened before /video mounted, so
seekRequest is now a one-reader mailbox the mount effect applies
instead of rewinding. Post-restore Undo contract per the round-31
note: Undo AND Redo disabled after restore in every studio
(applyProject now resets canvas history rather than pushing a step);
the two T-32 E2Es re-armed with a real edit and additionally prove the
restored layer survives the Undo. Red-first discipline for a
greenfield feature: the first continuity.spec asserted TODAY'S
behavior green (seven gaps pinned in one transcript), then flipped.
Worker mutations: ageMs re-omit, old renderer gate, sanitizePlace
drop, close-flush disable, both-flush disable; expediter's own:
off-screen visibility threshold broken -> exactly the two
display-gone unit tests red, restore, 19/19 + continuity 5/5.
Gates: 883 unit / 110 E2E green (worker and expediter runs). One
mid-run drop of the T-52 scrub test in a worker intermediate run
(green before/after + 3 isolated repeats; uses the hardened helper, so
NOT the T-55 shape — logged, watching for recurrence). Findings:
T-57 severity raised (Clear now reachable) + lastRoute dead key added
as its rider; StrictMode dev-only double-mount cosmetic noted;
USER_GUIDE updated with the continuity promise; TESTING.md count
refreshed by the expediter.

Round 33 — fix wave batch 7: T-36 + T-55 (one-gesture cuts, and the
roaming flake mechanism). T-36: wavesurfer 7.12 emits region-created
when the button comes up (saveRegion's last statement) and never emits
update-end for the drag that created a region — so the old
subscribe-inside-created shape could only commit on a second gesture.
The commit now happens on region-created, keyed on the cut- id prefix
(the ONLY marker that exists that early: addRegion emits the event
synchronously before the caller can set a property — the documented
trap, now the documented mechanism), and the __cut expando is gone so
there is one marker, not two. Tripwire flipped (chip after ONE
gesture, second gesture deleted from dragCut); overlap and
no-self-duplicate coverage added. T-55: the mechanism is NOT rAF and
NOT the app — Playwright's CDP mouse never moves the real X pointer,
so when a sibling Electron window maps over screen centre mid-drag,
the display server's crossing event surfaces as a document-level
pointerout (relatedTarget null) with the button down; wavesurfer's
makeDraggable treats pointerout as pointerup and saves the region
short, Konva drops its cached pointer. Proven with an instrumented
probe (region stopped to the pixel at the last move before the
pointerout) and a deterministic intruder harness (3/3 then 5/5
truncations on the old shape, 0/5 on the new; --workers=1 control
25/25 green). tests/e2e/drag.ts is the house gesture helper now: send
redundantly, press+move in one batch, poll the app's own drawn state
until the extent lands before releasing — a truncated gesture fails by
name instead of committing a plausible wrong value. Failure rates:
5/60 then 2/10 truncations pre-fix; 0/30, 0/9, 0/5 post-fix; final
suite 105/105 x2 by the worker and x2 by the expediter. Closed on the
AC's hardened-gestures branch (ten-consecutive-loaded-runs was not
achieved with the intermediate helper; the final shape was). Worker
honestly flagged its M2 mutation proof failing as a livelock rather
than a named assertion. Expediter mutation: id-prefix guard inverted
-> exactly the cuts test red, restore, 13/13. Batch was interrupted
mid-measurement by a session gap and resumed a day later with the
tree intact; the worker's ledger edit (region-drag row) was deliberate
and kept. Findings ticketed: T-61 (drag starting on an existing cut is
swallowed), T-62 (Transformer/crop drags still on the old shape);
T-56 widened (WaveformView raw rgba literals). workers:1 rejected as
the fix — 2x wall time is a real cost and the helper fix removes the
disease, not the trigger.

Round 32 — fix wave batch 6: T-44 + T-48 (the false-feedback pair).
T-44: the cancelled-vs-crashed distinction is made at the origin —
convert.ts's single-slot registry carries a `cancelled` flag set
before the SIGKILL, and the child's close/error handlers reject with a
typed ConvertCancelledError instead of raw stderr; promoteTempWebm
(the tail shared by both save paths) catches exactly that class,
unlinks the partial .mp4 at the user's chosen path, and returns the
same null the cancelled save dialog returns — which the renderer
already renders as the calm "Recording discarded." Zero renderer
changes; a real crash still throws with its text intact (asserted).
T-48: addClipFromRange returns boolean and the chat panel's success
toast is gated on it; a peak wholly past the end refuses with honest
copy in the panel's own register, a peak that merely overruns clamps
and lands (both branches asserted). Worker honestly reported that the
start clamp alone flips nothing — the store's reversed-range guard
already refused those; the behaviour change is carried by the
return-value gate, the clamp is defence-in-depth. Red-green on both
pins; worker mutations (unlink dropped, toast unconditional, guard
inverted) plus the expediter's own (sentinel instanceof disabled ->
exactly the discard positive red, restore, green). Gates: 831 unit /
105 E2E (one roaming T-55 flake — image draw-commit, a NEW roster
member — green standalone; record+pipelines 34/34); test:media 61/2
run although no command changed. New unit suites:
convertCancel.test.ts (10), recordingCancel.test.ts rewritten (6,
incl. the crash-still-strands gap pinned for T-59). Findings ticketed:
T-59 (crash branch: strand + raw text, incl. HighlightPanel gate
rider), T-60 (single-slot registry cross-kill); T-30 annotated with
the sentinel house shape.

Round 31 — fix wave batch 5: T-31 + T-32 (Home chrome). T-31: one
AppToaster at app level beside HotkeyOverlay, all five per-studio
mounts deleted — react-hot-toast keeps a global store per toasterId
and every bare Toaster renders the whole default bucket, so app-level
plus per-studio would draw every toast twice; single-mount is now a
STYLE_GUIDE rule pinned by an interactionWiring block and a
container-count E2E assertion. T-32: useGlobalUndo rewritten —
module-level undo/redo order arrays fed by store subscriptions
registered at import (outside any component lifecycle), reconciled by
COUNTING each store's own history lengths (handles change/undo/redo/
reset identically, including a studio's own Ctrl+Z moving the global
order), reference-identity test on the history object filters
non-history mutations and coalesced trims, React bound via
useSyncExternalStore over a version counter so enablement re-derives
after the hook's own click. Cross-studio ordering: newest actionable
entry first, Redo mirrors; the "last:" readout names what the next
Undo would revert. Red-green: T-21's finding-A contrast and both B/C
pins captured red post-fix in pinned form, flipped to positives
(cross-route undo, Redo re-applies, newest-first ordering). Worker
mutation proofs: toaster unmount, Home-scoped re-scope, bump no-op,
capped-push, redoOrder reconcile; expediter's own: newest-first loop
reversed -> exactly the ordering E2E red, restore, 13/13 + 11/11.
Gates: 813 unit / 105 E2E (worker hit the T-55 roaming flake once,
green standalone; expediter's full run 105/105 clean). Findings
ticketed: T-57 (discard() unhandled rejection), T-58 (References
invisible to global Undo — owner call); TESTING.md stale count fixed.
T-47 note recorded: module-level tracker makes restore-to-route
independent of undo state, but a silent continuity restore must apply
the document through a non-history path or the app opens offering to
undo the restore itself.

Round 30 — fix wave batch 4: T-52 (timeline click-to-scrub + two seek
edges). The Timeline gains a dedicated scrub surface — its own
`role="slider"` layer under the trim handles (slider children are
presentational, so the role on the track itself would have hidden the
handle buttons from assistive tech; sibling paint order gives handles
drag priority with no stopPropagation) — click seeks, drag scrubs
continuously through the existing window-level gesture loop, ←/→
nudge 0.1 s, Home/End jump, full ARIA value wiring, focus ring from
tokens. Scrub-while-paused stays paused; scrub-while-playing keeps
playing (both asserted). Seeks flow through one new store channel
(`requestSeek`, fresh-object identity so repeat seeks to the same
second still fire; clamped, NaN-rejected, optimistic currentTime).
Edge (b): the Player's reset effect now keys on the actual file path
and clamps instead of zeroing — store churn/remounts with the same
file no longer rewind (pinned by "the playhead never lies", whose
remount half was red pre-fix at a 60% marker over a 0s video). Edge
(c): tail nudges clamp to the media element's duration, not ffprobe's
(pinned — was 20 ms short). Tutorial trim step corrected ("purple
handles" survived the round-19 retheme; it now teaches the scrub the
copy already promised). HotkeyOverlay gains Home/End + Click timeline
rows, pinned by the 35-case hotkey checker. Red-green on all four new
tests; two worker mutation proofs (proportion math, reset dep array)
plus the expediter's own (End key -> 0: exactly the keyboard-scrubber
test red, restore, green). Gates: 799 unit / 104 E2E green twice, no
T-55 flake; the worker also killed a flake-in-waiting by polling for
Chromium's refined duration instead of reading it once. Findings
ticketed T-56 (raw pink-400 playhead + track space ends at probe
duration); Player ref-callback churn left to T-38's neighborhood.

Round 29 — fix wave batch 3: T-53 (P1 editor chrome in exports).
Canvas.tsx names its two editor-only stage layers with Konva's
whole-token tag (`grid chrome`, `overlay chrome`); captureDocument
hides every `hasName('chrome')` layer for the capture and restores
each layer's PRIOR visibility in the finally (never a blanket
show-all), with the scale mutation moved inside the try so a throw
can't strand a neutralised stage. Exclusion is enumerated, not
inferred: a future editor layer becomes export-invisible the moment it
carries the tag. No-flicker argued from Konva source (hide/capture/
restore is one synchronous block; redraw is rAF-deferred) and asserted
observably in E2E. Red-green: the new four-way byte-comparison test
failed on the unfixed build with all three chrome states leaking, green
after. Riders: dead getStageDataUrl deleted (grep-verified zero
importers — it was the last raw stage.toDataURL() outside
ThumbnailVariants); defaultExportScale's comment rewritten in
post-T-45 terms. Expedited by Fable: 790 unit / 100 E2E (one T-55
roaming flake — same audio drag test, green standalone, image suite
18/18); overlay-tag mutation re-executed personally (exactly the two
"selected" cases red — the inverse half of the worker's grid-tag
proof), byte-level restore verified by diff stat and green re-run.
T-54 confirmed from the render tree side (background is CSS, not a
node — needs an explicit fill, not visibility work).

Round 28 — fix wave batch 2: T-45 (P1 image exports). Exports now
render at DOCUMENT resolution via `captureDocument` (neutralise the
fit-to-container stage scale, pass the doc box explicitly, restore in
a `finally`) — chosen over ratio compensation because Konva sizes the
output canvas `width x pixelRatio`, so 112 x 0.25 is exactly 28 while
the compensated quotient can truncate a pixel. Both export paths
(single PNG/JPG, emote pack) go through it; on-screen rendering is
untouched. Red-green: both round-26 pins went red with the exact
pre-fix numbers after the rebuild (1280x720 delivered where 956x537
was pinned; 28/56/112 where 112/224/448 was pinned; the emote
tripwire's own named red captured), then flipped to positive
assertions. New E2E: same doc exported at two window sizes is
byte-identical. Unit 782 -> 786 (capture-at-scale-1, restore-on-throw,
exact trio arithmetic). Expedited by Fable: 786 unit green; full suite
run twice — each dropped ONE roaming mouse-timing test (audio drag,
then references tabs), both green standalone and unreachable by this
image-only diff, matching the contention signature two workers
independently hit -> accepted as flake and ticketed T-55 rather than
waved off. Worker findings verified and ticketed: T-53 (P1: Transformer
handles + grid bake into export bytes — probed real), T-54 (background
dropped from exports), T-46 extended (variants share the screen-zoom
root cause, unpinned today). LESSONS: screen state leaking into
deliverable bytes; the labels are the promise.

Round 27 — fix wave batch 1: T-37 (P1 seeking). The protocol handler
now serves bytes itself (streamed fs read, RFC 9110 Range semantics:
206/Content-Range, 416 only for a valid range that misses the file,
invalid input ignored per §14.2) instead of `net.fetch(file://…)`,
which dropped Range and made Chromium report every video non-seekable.
Removing `net.fetch` also removed `pathToFileURL` — the
platform-pinned-URL class from the v1.3.0 release failure is gone from
the handler rather than re-tested. protocol.test.ts 17 -> 42 (real
tmpdir files, one named case per malformed-Range form, path-safety
refusals kept verbatim + a Range-present hostile-path case, no-file-
access teeth preserved); video-core.spec.ts seek pins upgraded from
"requested" to "landed within half a frame", plus a new
seekable-spans-duration + park-at-1.5s-without-playing test.
Red-green: both E2E pins failed on the unfixed build (`seek to 0.4s
landed at 0s`; seekable end 0) and pass rebuilt. Expedited by Fable:
782 unit / 98 E2E green under the expediter's own runs; reversed-range
mutation re-executed personally (exactly the named test red, restore,
42/42; an expediter git-checkout slip during the proof was recovered
by byte-exact reconstruction, verified by the same 42 tests and diff
stat). Worker findings ticketed as T-52 (timeline click-to-scrub +
two seek edges); T-38/T-40 confirmed still pinned. LESSONS entry: a
protocol handler is an HTTP server — ignored request headers fail as
silently missing capabilities, and "the binding requested the right
thing" is not an end state.

Round 26 — Wave B of the coverage fleet (T-23, T-25, T-27; expedited
by Fable: 757 unit / 97 E2E full-suite green under the expediter's own
runs in 2.2m; "Recording discarded." bundle-mutation discrimination
re-executed personally on record.spec.ts — named red with the mutated
copy visible in the live toast log, md5-verified byte-identical
restore, green). 50 E2E tests (record 13, image 16, video-pipelines
21) + 10 compositor corner-math unit tests added. The coverage
campaign's interactive-surface pass is COMPLETE: every element is
either driven to its real end state or dispositioned in the ledger,
and the manual residue is a single 14-step Windows hand-test (ledger
HAND-TEST section). Wave B found 8 more shipped defects, ticketed:
T-41..T-44 (Record: indistinguishable zero-sources, silent webcam
drop, inconsistent persistence, discard-reports-as-crash),
T-45..T-46 (Image: P1 exports at screen zoom with a mislabeled emote
pack, stale variants), T-48..T-50 (Video export: silent false "Clip
added", unpersisted watermark position + dead error path, custom
presets unreachable as export targets) — plus T-51 (drawtext pixels
proven on no platform; win32-gated Layer 5). T-27 also disproved the
sweep's 13-element headless assumption by probing: the capture
pipeline runs under xvfb, only device enumeration doesn't. Techniques
now house patterns (ledger HL table): queued main-process dialog
stubs, session.will-download, main-process clipboard both directions,
project-file seeding, -stream_loop long fixtures.

Round 25 — Wave A of the coverage fleet (T-21, T-22, T-24, T-26;
expedited by Fable: 747 unit / 47 E2E full-suite green under the
expediter's own runs; confirm-copy discrimination re-executed personally
on video-core). 44 E2E tests + 32 unit tests added across four suites;
ledger dispositions applied (see INTERACTION_COVERAGE.md round-25
section). The fleet found 12 more shipped defects, ticketed:
T-28..T-30 (References: dead prompt() flows, cache-clear lie, raw IPC
error), T-31..T-35 (Home/shared: toastless Home, mount-scoped global
undo, dead corruption banner, offscreen/double-step tutorials,
ErrorBoundary gap), T-36 (two-gesture waveform cut), T-37..T-40 (Video:
P1 broken seeking, blank preview, letterboxed overlays, gesture
coalescing). Remaining Wave B: T-23, T-25, T-27.

Round 24 (T-13..T-20; expedited by Fable — gates re-run independently:
715 unit / build / 3 e2e; tutorial-target scanner discrimination
re-executed personally: attribute deleted -> named failure -> restored
-> 39/39. The worker's two beyond-ticket calls are ACCEPTED: the
third-copy extraction of useUndoRedoHotkeys across all three studios,
and the PropertiesPanel nesting fix its repo-wide scanner forced —
both are the ladder and the coverage bar working as written):

- **T-13** HotkeyOverlay mounted app-wide; shortcut table corrected
  against real bindings and pinned by a 32-case checker that fails on
  any row not backed by a real binding.
- **T-14** PresetPanel mounted in Audio; wiring covered.
- **T-15** Video Studio undo: header buttons + hotkeys via the new
  shared useUndoRedoHotkeys (third copy eliminated).
- **T-16** Coachmark targets fixed; 39-case scanner walks every step of
  all four tutorials — and the worker caught its own first version
  passing with the attributes deleted, rebuilt it to discriminate.
- **T-17** Nesting fixed in ClipList, TextOverlayEditor, and a third
  instance (PropertiesPanel) found by the new repo-wide TSX parser
  (75 cases); no E2E selector fallout.
- **T-18** RecentFilesMenu: Escape + click-outside, toggle-aware.
- **T-19** Audio Close confirm with default-chain field comparison;
  declined branch asserted separately; two mutation proofs.
- **T-20** Diary migrated to settings (validated key, bounded parser,
  corrupt-blob retirement); 23 tests + allowlist/schema sync check.

238 new unit tests (477 -> 715), including three standing static
checkers (nesting, tutorial targets, hotkey table). LESSONS round-23b:
seven entries incl. the self-satisfying-test near-miss.

Round 23 (T-08..T-12; expedited by Fable — gates re-run independently:
477 unit / 61 passed + 2 platform-skipped media / 3 e2e; T-09 red-green
re-executed personally: framelog reverted -> burst test fails ->
restored byte-identical -> passes):

- **T-08** probe codec floor — text files refused with their own
  user-readable sentence across drop/picker/recents; E2E negative
  upgraded to .txt.
- **T-09/T-10** findHighlights + analyzeClipHook — framelog=info makes
  the parser's input exist; pins flipped to positives (burst found at
  the right timestamps; loud/quiet windows ~34 LU apart).
- **T-11** caption alignment — ASS numpad values; render test proves
  each position paints its own third, centred, by PSNR symmetry.
- **T-12** reframe setsar=1 — square pixels, 9:16 DAR asserted.

All four LESSONS entries written. Find Highlights and correct caption
positioning ship for the first time.

Round 21 (all seven initial tickets; expedited by Fable — gates re-run
independently: 477 unit / 60 passed + 2 platform-skipped media / 3 e2e
including the new export spec; protocol-guard discrimination proof
re-executed by the expediter personally: bypass -> exactly the 5
path-safety negatives fail -> restore -> 17/17):

- **T-01** reframe/PiP Layer 5 — 7 tests incl. pixel-level overlay
  discriminators and two named-error negatives.
- **T-02** concat Layer 5 — 4 tests; API reality documented (one source,
  N ranges); no-audio behavior pinned as defined success; reversed-range
  guard asserted by exact message.
- **T-03** E2E import->export — real renderer drop -> UI export ->
  ffprobe-verified artifact; negative asserts exact refusal copy and
  no loaded state. Found T-08.
- **T-04** highlight cutting Layer 5 — 8 tests; ramp-clock fixture makes
  every frame self-timestamping; found T-09/T-10 and pinned both.
- **T-05** caption burn-in Layer 5 — 3 tests; PSNR-banded proof that
  text lands in the caption band only; found T-11 and pinned it.
- **T-06** protocol trust boundary — 17 tests; refusal shape asserted as
  403/'Path rejected'/no-filesystem-touch; two mutation proofs.
- **T-07** ProjectIO + autosave — 28 tests across round-trip, refusal
  matrix (7 corruption classes with exact reasons), no-clobber
  guarantees; four mutation proofs.

All discrimination proofs were performed by the implementing workers
and left zero residue (verified: `git diff -- src/` empty at expedite
time). Commit: the commit introducing this Done entry.
