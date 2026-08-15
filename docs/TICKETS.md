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

- **Spec:** T-26 finding. getVqd() runs outside searchDuckduckgoImages's
  try/catch: hop-1 failures reject the IPC and the error card shows
  "Error invoking remote method 'search:images': ..." while hop-2
  failures get friendly copy. Pinned by the unit test "rejects — it
  does not notice — when the vqd page itself fails".
- **Acceptance criteria:**
  - [ ] Hop-1 failures produce the same friendly notice shape as hop-2.
  - [ ] Flip the pin; E2E error-card assertion updated to the friendly
        copy exactly.
- **Status:** open

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
- **Status:** open

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
- **Status:** open

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
- **Status:** open

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
- **Status:** open

## T-35 — ErrorBoundary coverage (forced renderer crash)

- **Spec:** T-21 dispositioned ErrorBoundary as NOT COVERED — needs a
  deliberately induced render throw.
- **Acceptance criteria:**
  - [ ] A test route/flag or component-level unit harness that forces a
        render error; asserts the fallback renders (raw-hex exception
        styling intact), details disclosure expands, "Reload to Home"
        recovers to a working Home.
  - [ ] Ledger row updated from NOT COVERED.
- **Status:** open

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
- **Status:** open

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
- **Status:** open (P1)

## T-38 — preview canvas is blank until the first undoable edit

- **Spec:** T-22 BUG-PREVIEW. PreviewWrapper reads window.__imagiiVideoEl
  during a render that happens before Player attaches the element, and
  VideoStudio only re-renders on source/clips.length/canUndo/canRedo.
- **Acceptance criteria:**
  - [ ] Freshly imported video shows the output preview immediately
        (ref callback, effect, or store-driven attach signal).
  - [ ] E2E asserts a non-default preview canvas right after import.
- **Status:** open

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
- **Status:** open

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
- **Status:** open (owner-requested; schedule with T-32/T-33 in the fix
  wave — same subsystem)

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

Every fix flips its pin; every flip is red-green evidenced; LESSONS per
IMG-PREC.

## T-41 — zero capture sources is indistinguishable from never-searched

- **Spec:** T-27 finding A. chooseSource flips phase to 'choosing' but
  both branches render the same button — no message, spinner, or
  disabled state. On denied-permission systems the button looks dead.
- **Acceptance criteria:** empty result renders a distinct, helpful
  state (what happened + what to try); pin flipped in record.spec.ts.
- **Status:** open

## T-42 — webcam checkbox with zero cameras silently drops the PiP

- **Spec:** T-27 finding B. No zero-camera hint (mic has one); checkbox
  stays ticked, Corner picker appears, recording proceeds screen-only
  with no warning — the exact UI-vs-output mismatch the effectiveCamId
  comment says it set out to kill.
- **Acceptance criteria:** zero-camera state mirrors the mic warning;
  recording with a ticked-but-unavailable webcam surfaces the existing
  webcam-failure toast; pins flipped.
- **Status:** open

## T-43 — Record settings persistence is inconsistent (MP4 checkbox; mount-writes)

- **Spec:** T-27 findings C+D. convertToMp4 is component-local state
  (the only Record preference that resets), while the corner-persist
  effect writes config.json on mere mount with no user-touched guard.
- **Acceptance criteria:** MP4 choice persists like the corner; no
  settings write occurs from mounting the route untouched (relaunch
  test asserts both); pins flipped.
- **Status:** open

## T-44 — "Discard recording" reports as a crash and strands a broken file

- **Spec:** T-27 finding E. Cancel SIGKILLs ffmpeg and the rejection
  surfaces as raw IPC text (same class as T-30); the calm "Recording
  discarded." copy exists but is never used on this path — and the
  half-written output .mp4 at the user's chosen path is never reaped
  (promoteTempWebm's finally reaps only its temp .webm).
- **Acceptance criteria:** deliberate cancel yields the calm copy, no
  error styling; the partial output file is deleted; pins flipped;
  usability ruling applies (user expects a discard, not a crash).
- **Status:** open

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
- **Status:** open (P1)

## T-46 — variants dialog shows stale previews of a dead canvas

- **Spec:** T-25 BUG-VARIANTS-STALE. previews state survives close, so
  reopening after canvas changes shows renders of a canvas that no
  longer exists and hides the Generate button.
- **Acceptance criteria:** reopen regenerates or clears (Generate
  visible); stale pin flipped.
- **Status:** open

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
- **Status:** open

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
- **Status:** open

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
- **Status:** open

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
