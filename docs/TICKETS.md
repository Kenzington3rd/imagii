# imagii — tickets

The work queue for the model-routing workflow in `CLAUDE.md`: Fable
writes and expedites tickets; Sonnet or Haiku implements them (owner
amendment, 2026-10-09; previously Opus). One ticket = one branch =
one PR.

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
- **Status:** done (round 23 — see Done; this status line was stale
  until round 44: the fix and its Layer 5 assertions shipped with
  T-08..T-12, but only the Done entry was updated)

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
- **Status:** done (round 46 — see Done)

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
- **Status:** done (round 47 — see Done; the round-38 LRU note was
  implemented: the budget runs at launch, chained after the orphan
  sweep)

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
- **Status:** done (round 47 — see Done)

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
- **Status:** done (round 46 — see Done)

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

## T-74 — text overlays never render on a clip that does not start at 0

- **Spec:** T-51 worker finding, proven on linux with drawbox as a
  build-independent stand-in. drawTextFilter emits
  enable='between(t,startSec,endSec)' in SOURCE-absolute seconds (the
  editor's Time fields show that same timeline), but runExportJob uses
  -ss clip.startSec — INPUT seeking, so frames reach the filter graph
  at t=0 and the window is clip-relative. For a clip starting at S
  with duration D the overlay shows only during t in [S, D] — late by
  S seconds, and gone entirely once S > D. Only a clip starting at
  0.00 behaves as promised. Transcript: clip 10->13 with the editor's
  default [10,13] window -> overlay ABSENT at all probed times; the
  same clip with [0,3] -> visible at all four.
- **Acceptance criteria:** the enable window is built clip-relative
  (subtract clip.startSec, or store it clip-relative — pick and
  document); Layer 5 case on a non-zero-start clip (drawbox stand-in
  on linux, drawtext under the win32 gate); the T-51 pixel tests'
  startSec: 0 note updated; LESSONS entry (two timebases, one field).
- **Status:** done (round 47 — see Done; the fix also divides by the
  speed multiplier, since setpts=PTS/speed moves the same clock — one
  step past the ticket's wording, proven by its own Layer 5 case)

## T-73 — one Escape closes every stacked modal at once

- **Spec:** T-72 worker finding, pre-existing. Each open Modal
  registers its own window keydown, so with a confirm stacked inside
  ExportDialog one Escape fires both handlers. Harmless today (the
  inner closing the outer is usually wanted) but it is the same
  topmost-claim gap T-72 fixed for ?; Modal now exposes
  openModalCount, so a per-instance depth claim is cheap.
- **Acceptance criteria:** Escape closes only the topmost modal;
  the stacked-confirm E2E asserts the outer dialog survives one
  Escape; existing single-modal Escape coverage green.
- **Status:** done (round 46 — see Done. The ticketed premise was
  wrong: no confirm ever stacks inside ExportDialog — no Modal opens
  over another anywhere. The REAL reachable stack was `?` over a
  tutorial coachmark, where one Escape did take both, plus a z-order
  bug leaving the overlay dimmed UNDER the coachmark scrim; both
  fixed via a shared topmost-claim stack, and Modal-over-Modal is
  pinned structurally for the day it becomes reachable.)

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
- **Status:** done (round 44 — see Done)

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
- **Status:** done (round 44 — see Done)

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
- **Status:** done (round 44 — see Done)

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
- **Status:** done (round 45 — see Done; the win32 positives' first
  real execution is the v1.5.0 release run, by design)

## T-75 — studio hotkeys fire under an open tutorial coachmark

- **Spec:** T-73/T-64 worker finding, pre-existing. The T-68 hotkey
  guard reads `openModalCount()`, and the coachmark deliberately stays
  out of that count so `?` stays pressable during a tutorial (the
  T-72 exemption). Side effect: with a coachmark open over a studio,
  the bare-letter tool keys and Delete still reach the canvas behind
  the scrim — exactly the T-68 failure, resurrected through the one
  dialog the count ignores. The claim stack in `hooks/useFocusTrap.ts`
  now counts every open dialog including the coachmark, so the right
  reader exists; the studios just don't consult it.
- **Acceptance criteria:** bare-letter/Delete studio hotkeys are inert
  while a coachmark is open (guard on the claim stack, not
  `openModalCount` — `?` must stay live per T-72); E2E drives a letter
  key under an open coachmark and asserts the canvas did not change;
  existing hotkey and `?`-during-tutorial coverage green.
- **Status:** open

## T-76 — saving a result already on the board toasts "Saved to X" without saving

- **Spec:** T-73/T-28 worker finding, T-48 class (false success copy).
  `addToCollection` (src/main/search/moodboard.ts:221) silently
  returns the collection unchanged when the result's fullUrl is
  already on the board — the dedupe is right — but
  `ReferencePanel.saveInto` toasts `Saved to "X"` unconditionally, so
  a duplicate save reports a write that never happened. Usability
  ruling: the toast must tell the truth.
- **Acceptance criteria:** a duplicate save gets its own honest toast
  (e.g. already-saved wording), distinct from the success copy; the
  renderer learns the difference from the call it already makes (item
  count, or a flag on the IPC result — pick and document); E2E drives
  the double save and asserts both toasts; the negative discriminates
  per round-21 protocol.
- **Status:** open

## T-77 — aria-modal is a promise the DOM does not keep: background stays in the AT tree

- **Spec:** a11y review, round 46 (MED). Every dialog is
  `aria-modal="true"`, but Chromium does not enforce aria-modal for
  virtual-cursor/browse-mode navigation — the studio behind the scrim
  stays in the accessibility tree, so a screen reader can walk out of
  the dialog the Tab trap correctly contains. The honest mechanism is
  `inert` (or `aria-hidden`) on the app root while any dialog claim is
  live; the claim stack from T-73 is the single source of truth for
  "any dialog open".
- **Acceptance criteria:** while any Modal or coachmark is open the
  app root behind it is inert/aria-hidden and interactive content
  behind the scrim is out of the AT tree; released when the last claim
  drops (stacked dialogs must not un-hide early); unit-pin the
  claim-count edge; E2E asserts the attribute toggles with the dialog
  lifecycle.
- **Status:** open (backlog)

## T-78 — Audio and Image sliders have T-40's mirror-image bug: no undo coalescing at all

- **Spec:** T-40 worker finding, pre-existing. `audioStore.patchChain`
  (audio-studio/state/audioStore.ts:99-103) pushes a history step per
  call, and the Cleanup/Levels/secondary-track sliders call it on every
  `input` event (CleanupPanel.tsx:135, LevelsPanel.tsx:127,
  SecondaryTrackPanel.tsx:110,219); same for `canvasStore.updateLayer`
  behind the image-studio opacity slider (PropertiesPanel.tsx:83-88).
  One drag fills the undo stack with dozens of steps and Ctrl+Z moves
  the value one notch — the exact inverse of T-40's video-studio bug,
  and the same usability ruling applies: one gesture, one undo step.
  (Konva canvas drags are fine — they commit on onDragEnd /
  onTransformEnd.)
- **Acceptance criteria:** both stores get the video store's
  `historyKey` + `endGesture` pair (one binding, one implementation —
  extract if the ladder says so, per the T-15 precedent); a slider drag
  is one undo step and two consecutive drags are two; unit tests on
  both stores; E2E drives a real drag per studio and walks Undo once
  back to the pre-drag value; existing undo coverage green.
- **Status:** open

## T-79 — the launch-time thumbnail LRU deletes images boards still reference

- **Spec:** guide-sync QA review (HIGH), a round-47 decision reversed
  on evidence. `pruneThumbCache` is a pure mtime LRU with no
  reference check; round 47 chained it after `sweepOrphanThumbs` on
  every launch. But the sweep already removes every orphan, so by the
  time the LRU runs, every surviving file is one a board points to —
  past 500 MB it can ONLY delete referenced images, silently breaking
  saved boards. Worse, the tile `<img>` (MoodBoardPanel.tsx:183-196)
  has no error fallback: `cachedThumbPath` set + file gone = broken
  tile forever, which means the now-working Clear button breaks every
  tile too. Referenced thumbnails are user data, not cache overhead;
  a budget must never eat them (usability ruling).
- **Acceptance criteria:** the launch chain runs the sweep only — no
  LRU (with its only other caller gone, the budget machinery goes
  too: dead code); the Clear button keeps a true clear; the tile
  falls back to `item.thumbnail` when the cached file fails to load,
  so a cleared cache heals from the network instead of breaking; the
  round-47 launch-LRU E2E flips into a protection test (launch over
  budget deletes NO board-owned thumb); a fallback E2E drives Clear
  and asserts the tile recovers; USER_GUIDE / TESTING.md / ledger
  corrected; LESSONS entry (a maintenance pass chained after a
  correctness pass inherits its guarantees or breaks them).
- **Status:** done (round 48 — see Done)

## T-80 — a caret click inside a focused text field ends the undo gesture

- **Spec:** guide-sync QA review (MED), T-40 follow-on. The panel-level
  `onPointerUp={endGesture}` in ClipList.tsx:33 and
  TextOverlayEditor.tsx:42 catches slider releases — but a plain click
  INSIDE an already-focused text or number input (repositioning the
  caret mid-edit, double-clicking a word) bubbles the same pointerup,
  so one caption edit splits into several undo steps. Exactly the
  mid-gesture close T-40's design promised not to have; blur is the
  documented gesture end for text fields.
- **Acceptance criteria:** pointerup whose target is the focused
  text-entry control (text/number input, textarea — NOT range/
  checkbox, whose releases must keep ending gestures) does not end
  the gesture; one shared implementation for both panels with the
  decision as a pure exported predicate, unit-tested (node, no DOM);
  E2E types, caret-clicks, types again, and ONE undo restores the
  whole edit (discriminates: red against the unguarded handler);
  existing T-40 slider/drag coverage green.
- **Status:** done (round 48 — see Done)

## T-81 — captions burned over a clip range show the wrong part of the transcript

- **Spec:** content review 2026-10-09 (streamer lens), T-74's sibling.
  `whisperManager.ts` ~344-362: the clip-range burn pushes `-ss`/`-to`
  BEFORE `-i` (input seek resets timestamps to 0) and then applies
  `subtitles=<whole-source SRT>`, whose cues are in source-absolute
  time. A clip cut from minute 40 is captioned with words from the
  stream's first minutes. Every existing burn-in Layer 5 test uses
  startSec 0 — the same blind spot that hid T-74.
- **Acceptance criteria:** the burned window shows the cues for that
  span (`-copyts` + output-side seek, or shift the cues — pick and
  document at the seam, citing the T-74 LESSONS entry); Layer 5 case
  with startSec > 0 proving real cue text/pixels land in-range
  (red-first against today's code); LESSONS entry.
- **Status:** done (round 49 — see Done)

## T-82 — audio cuts + "Re-attach to video" desync the sound and cut the video's tail

- **Spec:** content review (streamer lens). `audio/chain.ts` ~55-63
  closes cut gaps (`aselect…asetpts` — audio shortens);
  `audio/process.ts` ~231-256 muxes `-c:v copy` + `-shortest`. From
  the first cut on, sound runs ahead of picture and the video's last
  N seconds drop. The waveform copy ("Drag…to select a region to
  cut") never says the video is untouched, and "Re-attach to video"
  defaults ON. Rider: `ExportDialog.tsx:53` leaves
  `<name>.cleaned.wav` (~0.7 GB/hour) beside the MP4 forever — no
  unlink anywhere.
- **Acceptance criteria:** decide per the usability tiebreaker —
  either cut the video too when re-attaching (matching what a user
  means by "cut"), or block/warn the cuts+re-attach combination with
  honest copy; Layer 5 case proving the shipped behavior; the temp
  WAV is deleted after a successful mux (and the failure path leaves
  no litter); LESSONS entry.
- **Status:** done (round 49 — see Done)

## T-83 — a manual crop is applied to every ticked platform and stretched to fit

- **Spec:** content review (streamer lens). `ffmpeg/filters.ts`
  ~274-282: `clip.cropRect` is applied verbatim, then
  `scaleFilter(preset)` forces the preset's exact WxH — a 9:16 crop
  with YouTube still ticked (the default) stretches ~3x wide. Nothing
  warns: `ExportPanel.tsx` passes `cropAspect={null}` so the
  red/green grid never reflects the crop, the red label reads "Trim"
  even when the reason is aspect ("Trim" says shorten the clip), and
  the reason text is hover-only. The safe-zone modal uses "clip" as
  noun and verb and fires on every Clip Kit run.
- **Acceptance criteria:** a cropped clip exports without distortion
  on every ticked platform (pad, per-platform crop, or refuse with a
  clear message — pick per the tiebreaker and document); the grid
  gets the real crop aspect; red labels say WHY ("Wrong shape" /
  "Too long") with the reason visible, durations in minutes; the
  safe-zone modal copy rewritten in plain words; Layer 5 case on a
  cropped clip exported to a mismatched preset; LESSONS entry.
- **Status:** done (round 50 — see Done)

## T-84 — the failure path speaks ffmpeg, not English

- **Spec:** content review (all three lenses agree; the largest
  cluster). ~22 catch sites toast raw `err.message` — the user reads
  "Error invoking remote method 'video:exportBatch': Error: FFmpeg
  exit 1: …" for ~4 seconds (STYLE_GUIDE already mandates
  `ipcErrorMessage`; only 3 sites comply). Worse classes: pressing
  Cancel reports as a red failure (SIGKILL → nonzero exit → the same
  catch) across export/ClipKit/GIF/compile/reframe/PiP/highlights/
  audio/model-download; the corrupt-autosave banner and project-load
  toast print validator strings ("videoStudio.clips not array");
  a moved video file aborts project load half-restored with a raw
  probe error; search failures name a "provider switch" that does
  not exist; `importDiagnostics` prepends raw ENOENT text; the
  ErrorBoundary says "render error" and asks the user to "report"
  with no channel. Sites: Home.tsx:15,33; AutosaveRestore.tsx:109;
  ExportPanel.tsx:312; ClipKitButton.tsx:160; GifPanel.tsx:66;
  CompilationPanel.tsx:63; ReframePanel.tsx:95; PipPanel.tsx:66;
  CaptionsPanel.tsx:91,139,161; HighlightPanel.tsx:105;
  VideoStudio.tsx:81; audio+image ExportDialog; ImportPanel.tsx:77;
  ThumbnailVariants.tsx:167; MoodBoardPanel.tsx:45;
  RecordStudio.tsx:376,396; referencesStore.ts:130.
- **Acceptance criteria:** one shared helper turns any error into
  plain language (strips the IPC envelope, maps known failures,
  keeps the raw text in the console); cancellation is neutral
  ("Export canceled. Files already finished are in your folder."),
  never a red error, across every cancellable job; failed export
  rows show a visible failed state after the toast fades; error
  toasts get a longer duration; the autosave banner / project-load /
  search / import / crash-screen copy rewritten per the review's
  suggested lines; project load keeps applying the studios it can
  and names the missing file; E2E drives a cancel and a failure per
  class and asserts the visible copy (discriminating negatives per
  round-21); LESSONS entry.
- **Status:** done (round 51 — see Done)

## T-85 — copy that promises what the code does not do

- **Spec:** content review (all three lenses). Confirmed falsehoods
  reaching users: ReferencePanel ~93-98 "All thumbnails are screened
  locally before display" (no screening code exists anywhere — only
  DuckDuckGo's own SafeSearch parameter); the reframe tutorial/panel
  "follow the action" / "Auto" (code: 'smart' === 'center', a fixed
  strip); Home "Capture screen + webcam + mic … one-stop alternative
  to OBS" (no game/desktop audio — `audio: false` on the screen
  stream; webcam-only impossible; Esc-to-stop only with focus);
  "the watermark field stamps your @handle on every export" while
  Clip Kit passes `watermark: null` and GIF/reframe/compile/PiP take
  none; absolute "Everything runs locally" while Reference Search
  and the caption-model download go online (BRANDING honesty rule);
  HotkeyOverlay "Save full app state" while mood boards are not in
  the project file.
- **Acceptance criteria:** per the usability tiebreaker, each item is
  ruled code-to-promise or promise-to-truth and documented: Clip Kit
  APPLIES the saved watermark (code fix + Layer 5 pixel check on one
  kit output) and warns on over-limit durations; Clip Kit also stops
  asking the safe-zone question on every run — the kit's whole point
  is all five platforms, so the answer is already given (round-50
  note: only the modal's copy changed; the frequency is this
  ticket's); the rest are copy fixes using the review's suggested lines (SafeSearch line names
  DuckDuckGo as the filter and search as the one online feature;
  reframe renamed a centered 9:16 crop with Left/Center/Right and
  the duplicate "Auto (centered)" option dropped; Record copy names
  what is and is not captured, incl. no game audio; local-first copy
  names its two online exceptions, guide updated to match); E2E pins
  the new copy where tests exist; LESSONS entry.
- **Status:** done (round 52 — see Done)

## T-86 — tutorials auto-run over empty screens, can't be skipped, and describe a different app

- **Spec:** content review (all three lenses). `useTutorial.ts` opens
  the tour on first visit, but with no media loaded the studios
  render only the importer, so the coachmark floats over nothing and
  tells the user to drag handles that don't exist. "Skip" calls
  `onClose(false)` and never persists, so the tour returns every
  visit. Step copy is stale or false: "pink line" (playhead is
  ember), "Open Auto-Highlights" (no such control), captions "into
  the export" (separate file), watermark claims (see T-85),
  'Choose file…' / 'Duck under voice' / "Quick fix wizard" naming
  mismatches, "Image Canvas" (see T-92), "Two tabs" (three), the
  14-format list summarized as "pretty much anything", "New:" tags
  on shipped features, and LUFS/whisper.cpp/FFmpeg jargon.
- **Acceptance criteria:** a tour step only shows when its target
  exists (or the tour starts after first import — pick per the
  tiebreaker); Skip persists (or is labeled honestly); every step's
  text matches the live UI's control names and real behavior, jargon
  removed, "New:" dropped; E2E: tour on an empty studio shows no
  orphaned steps, Skip then revisit shows no tour; existing tutorial
  coverage green; LESSONS entry.
- **Status:** done (round 52 — see Done)

## T-87 — "Suggest 4 titles" writes broken English

- **Spec:** content review (all three lenses, verified). PostChecklist
  VERB_BANK is past tense ('clutched', 'reacted to') while patterns
  append d/ing: "I clutchedd a boss fight so you don't have to",
  "Day 41 of reacted toing glitch". The {game} bank is five random
  titles the streamer may not play; "a achievement" breaks the
  article.
- **Acceptance criteria:** every generatable title is grammatical
  (base-form verbs + correct conjugation, a/an handled, or patterns
  that need none); the game comes from the user or is omitted;
  button relabeled "Title starters" per the review; unit test
  generates the full cross-product and asserts no "dd"/"toing"/
  "a a" artifacts; E2E keeps the copy-to-clipboard path green.
- **Status:** done (round 53 — see Done)

## T-88 — Record: the recovery hint points at a button that can't help, and Cancel eats the take

- **Spec:** content review (UX + streamer lenses). "No microphone
  found. Click 'Refresh sources'…" but Refresh only re-lists
  screens/windows; device lists load once on mount, and the single
  combined `getUserMedia({audio:true, video:true})` probe means a
  missing camera also blanks the mic list (silent catch). The
  native save dialog is titled "Save recording" but Cancel discards
  the take with no warning; "Discard recording" during a
  non-convert save is a no-op; "converting and writing to disk…"
  shows when nothing converts.
- **Acceptance criteria:** Refresh re-scans devices; the mic and
  camera probes are split so one missing device doesn't blank the
  other; the save dialog says Cancel discards; discard/convert copy
  tells the truth per state; the hints name the real recovery
  (Windows privacy settings); E2E/unit per the standing bar for the
  reachable parts, dispositions for the OS-dialog boundary;
  LESSONS entry.
- **Status:** done (round 54 — see Done)

## T-89 — captions: setup copy, English-only truth, and "Font px" that isn't pixels

- **Spec:** content review (streamer lens). The setup card sends the
  user to fetch "whisper.exe" (current whisper.cpp builds ship
  `whisper-cli.exe`; the internal resources path is shown raw); the
  model download never says it goes online; "the model file you
  choose determines languages" but the model and language are
  hard-coded English; "Font px" is scaled by libass PlayResY 288 so
  the default 32 renders ~120 px on 1080p (the LESSONS entry already
  documents the scaling); progress shows raw phase ids
  ("BUILDING-SRT") and a jittering fake percent (15 + random*10);
  burn-in runs on the original file, which no copy says.
- **Acceptance criteria:** setup copy matches the real binary name
  and says in one line what is manual vs automatic and that the
  download is online-once; English-only stated plainly; the size
  control is honest (relabel + show the effective size, or map the
  number to real pixels); phases get plain labels and the fake
  percent becomes an indeterminate bar; a line says captions burn
  into the original video, not the platform exports; existing
  caption tests green; LESSONS entry.
- **Status:** done (round 54 — see Done)

## T-90 — audio studio copy: broadcast-engineer language, a wizard that misreports, presets that over-save

- **Spec:** content review (all three lenses). LevelsPanel ships a
  developer note ("fixed at −1.5 dBTP this round"); the −14 preset
  pair snaps to the wrong entry (first-match lookup); FixWizard's
  summary derives from different logic than the patch it applies
  (highpass can read "off" while on) and "Start over" closes the
  dialog; cleanup presets silently save cut regions and the
  second-track file and re-impose old cut times on new recordings;
  the waveform cut copy never says cuts apply at export only; hum
  removal is fixed at 60 Hz (US mains); "AAC" exports a bare .aac;
  save/delete preset calls have no catch. Jargon sweep: loudnorm/
  LUFS/dBTP/highpass/de-ess/sidechain/mux in rendered copy.
- **Acceptance criteria:** the summary renders from the exact patch
  object applied; Start over restarts; presets save cleanup settings
  only (or say exactly what they include); the merged −14 entry or a
  fixed lookup; cut copy says "removed when you export"; loudness
  copy in creator terms per the review's lines; 50 Hz available or
  the label names 60 Hz mains; .m4a container or honest label;
  failures toast; unit/E2E per the standing bar; LESSONS entry.
- **Status:** done (round 55 — see Done)

## T-91 — Stream Graphics: toasts before saves, template labels that mislead, exports that carry hints

- **Spec:** content review (UX + streamer lenses). Export/variants
  toast "saved" before the native Save dialog resolves (a canceled
  dialog still gets a success toast; the emote pack means three
  dialogs); "Generate 3 variants" then "Save all 4"; the Twitch
  banner template's size story doesn't match what platforms accept;
  the "4K thumbnail … crisp shorts" line mislabels a 16:9 asset; the
  facecam "hole" is a tinted rect + hint text that BAKES INTO the
  export with no warning, same for "@yourhandle"/"Game name"
  placeholders and the 40%-opacity reference layer from mood boards;
  export scale shows no output pixels/size (2x default can exceed
  YouTube's thumbnail cap); the lower-third asset copy implies a
  video overlay imagii doesn't do.
- **Acceptance criteria:** success toasts fire only after a real
  save (or main sets the path); counts say "3 + original"; template
  and asset copy tells the truth about sizes and destinations; the
  hint layers are named as to-delete (or stripped on export — pick
  per the tiebreaker and document); the reference layer's copy says
  delete before exporting (or export skips it — same ruling); a
  pixel readout ("Output: 2560x1440") next to scale; E2E per the
  standing bar for the reachable parts; LESSONS entry.
- **Status:** done (round 55 — see Done)

## T-92 — terminology and microcopy: one name per concept, plurals, jargon, toast mechanics

- **Spec:** content review (voice audit's tables + both other
  lenses). One studio, four names ("Stream Graphics" vs "Image
  Canvas" on Home's last-undo line, tutorials, README/FOR_MIKE);
  highlights under five names; posting log vs diary; delete vs
  remove vs clear vs discard crossed between button and confirm;
  "Top L/Bot R" vs "Top left"; "Rect" vs "Rectangle"; lowercase
  outliers ("copy", "+ clip", "✕ delete"); "1 clip(s)" / "Found 1
  candidates" plural bugs across six sites; completion verbs vary
  (saved/exported/done — "PiP done."); success toasts carrying the
  only action ("Edit in Video Studio") last ~2 s and "Show" doesn't
  say "Show in folder"; raw ids and units in labels (BUILDING-SRT →
  T-89, "sustained-loud", "ig reels general", h264 · aac, LUFS
  tooltips, "Bucket sec"/"Pad sec", "V bitrate" + digits-only
  bitrates read as bits/sec, "30fps" vs "30.00 fps", missing GIF
  width unit, exports silently 30 fps with no label); highlight
  scores cap at 40 without chat; dialog dismiss labels vary
  (Esc/✕/Close/Done); dialect mix ("cancelled"/"tick" vs US
  spelling); color-grade sliders have no preview and no copy saying
  so; "Safe zones" means crop guides; Compilation hidden until 2
  clips; bare "+" board button lacks an aria-label. Round-50 add:
  the export grid's visible reason text now sits inside each
  platform `<label>`, bloating the checkbox's accessible name —
  restructure so AT hears the platform, not the paragraph.
- **Acceptance criteria:** BRANDING_GUIDE gains the copy-conventions
  section the audit recommends (canonical name table, sentence case,
  delete/remove rule, toast punctuation, voice) and the renderer is
  swept to match it; plurals correct at every site; action toasts
  get duration + "Show in folder"; digits-only bitrates rejected or
  auto-suffixed (unit test); the jargon list relabeled per the
  review; interactionWiring-style pin where cheap (e.g. the plural
  helper); guide-sync's reviewers re-run clean on the sweep;
  LESSONS entry.
- **Status:** done (round 56 — see Done; the guide-sync criterion
  rides the wave-close pass with T-93's)

## T-93 — USER_GUIDE and release notes: a feature list where a first session needs a walkthrough

- **Spec:** content review (streamer lens, section B/C). The guide
  starts at "Home" with no first-launch page (SmartScreen, the
  10-15 s silent unpack, antivirus, where data lives, Windows-only);
  no end-to-end "long recording → posted clip" recipe (pick folder,
  Clip 1 behavior, Export runs all clips, Show reveals the file); no
  "what imagii does not do" box (no game audio, no face tracking,
  English-only captions, projects store paths not media); stale or
  wrong lines: "or your webcam", "stamp your handle on every
  export", template sizes "1080p, 2K, 4K", the export-scale
  sentence, the cache bullet under the wrong studio, "no internet
  required (except image search)" contradicting the captions
  download; Chat spikes, Posting helpers, Compile, and the per-studio
  tutorial button are uncovered. The release body omits the file
  size, the slow first launch, the Windows requirement, and that
  "Source code (zip)" sits beside the exe.
- **Acceptance criteria:** the guide gains first-launch,
  first-clip-out, and limitations sections and every stale line is
  corrected against the code; the release body in release.yml
  follows the review's suggested text (dispatch/tag triggers
  untouched); claims spot-checked against handlers the way this
  review did; LESSONS entry not required (docs), but guide-sync
  re-run clean.
- **Status:** done (round 53 — see Done; the guide-sync criterion is
  satisfied by the wave-close guide-sync pass, scheduled after the
  last fix round)

## T-94 — the whole-video "Clip 1" rides along in every export and compilation

- **Spec:** content review (streamer lens, verified).
  `videoStore.ts` ~147-156: loading a source creates Clip 1 spanning
  the full duration with YouTube ticked; highlights add clips beside
  it; Export and Compile run ALL clips. Scan a 3-hour VOD, add five
  highlights, press Export — the full VOD re-encodes too, and the
  button only says "Export 6".
- **Acceptance criteria:** the user can tell and choose what
  exports (per the tiebreaker: e.g. adding the first highlight
  offers to drop/untick the whole-video clip, or export honors
  selection); the button says what it will produce; E2E drives the
  VOD+highlights path and asserts the full source is not silently
  re-encoded (or is clearly chosen); existing export coverage
  green; LESSONS entry.
- **Status:** done (round 50 — see Done)

## T-95 — the References "+" button overflows its column and the detail card eats the click

- **Spec:** found at round-49 expedite: two long-green E2E tests red
  in a fresh container. The sidebar's create row (`flex-1` input +
  button) overflows the 220 px clamped column because a flex item's
  default `min-width:auto` keeps the input at its placeholder's
  intrinsic width — which is FONT-dependent, so the same build is
  green or red per environment, and the shipped Windows app can hit
  it at ordinary window widths. The button lands under the detail
  card, which intercepts every click.
- **Acceptance criteria:** `min-w-0` on the input; the same token on
  every `flex-1` form control in the renderer (the class dies, not
  the instance); the two catching tests green; LESSONS entry.
- **Status:** done (round 49 — expediter fix; see Done)

## T-96 — a cropped clip compiled or GIF'd comes out uncropped

- **Spec:** round-50 worker finding, the wrong-file class. `concat`
  segments carry only start/end/name, and GIF export takes no
  cropRect either — a clip the user cropped to 9:16 is compiled or
  GIF'd at the full frame, silently. The T-83 fix covers platform
  exports only.
- **Acceptance criteria:** Compile and GIF honor the clip's crop
  through the same crop-is-the-new-frame chain T-83 built (one
  implementation — extend, don't copy); Layer 5 case each
  (red-first); existing concat/GIF coverage green; LESSONS entry.
- **Status:** done (round 57 — see Done)

## T-97 — the export grid can say "Great" while upscaling a small crop

- **Spec:** round-50 worker finding. The "picture is smaller than
  this output" check still reads the FULL source size, so a quarter-
  frame crop exported at 1080p upscales 2x and the card still says
  "Great". The crop now defines the frame everywhere else (T-83);
  this check is the straggler. Round-52 add: duration checks (the
  grid's and Clip Kit's shared limits) read SOURCE seconds and
  ignore `speedMultiplier`, so a 2x clip is warned "Too long" at
  half its real output length — same honesty straggler, same fix
  shape (evaluate the effective value).
- **Acceptance criteria:** the resolution check reads the effective
  frame (`cropFrameSize`); the reason copy says what happens
  ("smaller than this output — it will be scaled up and look soft");
  unit cases in presets.test.ts both ways; the grid E2E extended
  with a small-crop row; existing grid coverage green.
- **Status:** done (round 57 — see Done)

## T-98 — Cancel is not a latch: clicked between jobs, it cancels nothing

- **Spec:** round-51 worker finding. `video:cancelAll` only kills
  LIVE export children — a Cancel clicked in the gap between a
  batch's jobs is a no-op and the batch continues; Clip Kit's Cancel
  cannot stop its three thumbnail `extractFrame` calls at all
  (`cancelAllFrameJobs` is quit-only). The T-84 copy promises
  "Export canceled" — the click must make that true whenever it
  lands.
- **Acceptance criteria:** cancellation latches per batch/kit: jobs
  not yet started don't start, frame extracts are cancellable, and
  the T-84 sentinel flows from the latch too; a cancel landing
  BEFORE a runner's child spawns (the probe phase — round-57 note:
  Compile and cropped GIF probe first, as do platform export and
  Reframe) also latches; E2E lands a cancel in
  the between-jobs gap deterministically and asserts nothing more is
  written; existing cancel coverage green; LESSONS entry.
- **Status:** done (round 58 — see Done)

## T-99 — a project that extracted audio from a video points at a temp file the next launch deletes

- **Spec:** round-51 worker finding. Extracting audio from a video
  writes a WAV under the `imagii-audio` temp family; saving a
  project then stores THAT path, and launch-time temp pruning
  removes it — reopening says "Couldn't find aB3dE5fG7h.wav" with no
  way back. User data must never point into a temp family.
- **Acceptance criteria:** the project stores the original video
  path (+ re-extracts on open), or the extracted WAV is promoted out
  of the temp family when a project references it — pick per the
  tiebreaker and document; unit/E2E proves save -> prune -> reopen
  works; LESSONS entry.
- **Status:** done (round 58 — see Done)

## T-100 — cancel/failure leftovers: partial files, red "Canceled" bars, unlabeled audio rows

- **Spec:** round-51 worker finding, polish cluster on T-84's new
  states. A canceled or failed export/GIF/reframe leaves its
  half-written output in the folder while the toast says finished
  files are there; a Canceled queue row keeps the danger-red bar
  under its neutral label; the audio ExportDialog's progress row has
  no Failed/Canceled label at all.
- **Acceptance criteria:** the half-written output of the job that
  was canceled/failed is deleted (finished files stay; respect the
  T-59-era partial-output conventions and document any deliberate
  exception); Canceled rows drop the danger tint; the audio dialog
  gains the same Failed/Canceled labels; round-54 add: the captions
  progress row is cleared (or labeled) after a canceled or failed
  burn-in instead of freezing at "Burning in… N%" with a dead
  Cancel button; round-55 add: the audio export's measure and
  render passes each restart the bar at 0 — label the passes or
  make one continuous bar so it does not read as a stall; round-56
  adds (same microcopy class, found by the sweep):
  ClipKitButton's `SRT not bundled (reason)` toast carries main's
  raw fragment; the audio waveform readout prints the raw codec id
  (pcm_s16le); reframe's progress prints raw phase ids; E2E pins
  each; LESSONS entry.
- **Status:** done (round 58 — see Done)

## T-101 — addClipFromRange has no caller: dead code or a missing control

- **Spec:** round-53 worker finding. `videoStore.addClipFromRange`
  is exercised by tests only — no renderer control calls it (the
  old USER_GUIDE line about "mark ranges and add them" was stale
  for the same reason). Either the ladder's deletion rule applies,
  or a range-to-clip control was always intended and never wired.
  Round-54 add: `recording.save` (the legacy buffered save handler)
  is still exposed through preload and api.ts with no renderer
  caller — same class, same ruling.
- **Acceptance criteria:** decide (owner may rule): delete the
  action and retarget its tests at `addScannedClip`'s shared
  `appendRange`, OR wire a real "add range as clip" control with
  full interaction coverage. Either way, no exported store action
  without a caller survives; ledger updated.
- **Status:** done (round 58 — see Done; five more dead actions beyond the two named were removed under the same criterion)

## T-102 — the captions setup path may not exist or survive on the portable exe

- **Spec:** round-54 worker finding, the wave's most important
  open question for the shipped build. The setup card tells the
  user to place whisper-cli.exe at
  `process.resourcesPath/app.asar.unpacked/resources/bin`, but
  electron-builder.yml does not unpack `resources/bin`, and the
  portable exe unpacks itself to %TEMP% — so the folder may not
  exist, and a binary placed there may not survive a relaunch or an
  app update. If so, the entire captions feature is impossible to
  set up on the shipped artifact while the card claims otherwise.
  NEEDS A WINDOWS HAND-TEST first (owner checklist); the likely fix
  is a stable user-writable location (userData/bin) checked first
  by the resolver, plus the card naming that path.
- **Acceptance criteria:** hand-test confirms or denies; the
  resolver prefers a per-user stable directory that survives
  relaunch; the setup card names a path that is real on the
  portable build; unit tests for the resolver order; the release
  checklist covers a captions setup on a clean Windows machine.
- **Status:** done (round 60 — see Done; the resolver and card now
  use a stable per-user directory; the Windows hand-test remains the
  owner's final verification, HAND-TEST step 15)

## T-103 — which template sample texts strip on export (owner ruling)

- **Spec:** round-55 follow-on. The hint-layer mechanism now strips
  guide layers and placeholders ("Facecam goes here", "@yourhandle",
  safe-area frames, "Drop clip here") from exports, with a visible
  "won't export" tag and a rule-based table check over all 21
  template/asset cards. Three edges need the owner's call: (1)
  design-copy samples deliberately left exporting ("YOUR TITLE
  HERE", "Your Name", "TUTORIAL", the banner schedule line) — an
  unedited one still ships in a user's export; (2) there is no
  control to KEEP a hint layer in an export (workarounds: retype the
  text, which clears the flag by design, or delete-and-redraw); (3)
  mood-board reference layers saved in pre-round-55 projects carry
  no flag and still export (indistinguishable from user images —
  no reliable migration exists; documented disposition).
- **Acceptance criteria:** owner rules each edge; whatever is ruled
  gets the hint-table treatment (flag + tag + templateTruth row +
  pixel E2E) or a documented disposition.
- **Status:** done (round 60 — see Done; ruled under the tiebreaker:
  text the user MUST replace is a hint, text that IS the card's
  deliverable exports; the per-card table makes every choice
  deliberate, and the countdown was flipped to a hint at expedite)

## T-104 — raw palette hex in the highlight bars and safe-zone overlays

- **Spec:** round-56 worker finding, a non-negotiable breach found
  in passing (not copy, so not fixed in the sweep):
  `HighlightPanel.tsx` draws its two signal bars with raw hex
  (#f472b6, #fbbf24) and `SafeZoneOverlay.tsx` its three overlay
  colors (#f472b6, #fbbf24, #22d3ee) — the colors-from-tokens rule
  says these come from tokens.ts, and designTokensInSync cannot see
  them where they are.
- **Acceptance criteria:** the five literals come from tokens.ts
  (new tokens if no existing ones match, WCAG-checked per the
  rule); a structural pin keeps raw hex out of renderer source the
  way the no-prompt scanner works (scoped to src/renderer, test
  files excluded); existing visual coverage green.
- **Status:** done (round 58 — see Done; two documented exceptions in DESIGN_GUIDE)

## T-105 — Compile and GIF run a different recipe than the clip the user built

- **Spec:** round-57 worker finding, the wrong-file class. Compile
  ignores a clip's speed, color grade, text overlays, auto zoom and
  hype shake (a 2x clip compiles at 1x, audio included) — the crop
  now carries (T-96) but nothing else does; the GIF panel's "over
  about 10 s" warning reads source seconds and ignores its own
  speed select (the T-97 shape); the speed normalization exists in
  four copies (runExportJob x2, buildVideoFilter, outputDurationSec)
  — extract one `clipSpeed` as part of this; the Compile card has
  no verdict row telling the user what a crop loses.
- **Acceptance criteria:** a compiled segment carries the clip's
  full recipe through the same builders the platform export uses
  (one implementation; the audio side included for speed); the GIF
  warning reads output seconds; `clipSpeed` is the one speed read;
  Layer 5 red-first per carried stage (speed at minimum; grade/
  overlays as the builders allow); the Compile card shows a verdict
  line consistent with the grid's; existing coverage green; LESSONS
  entry.
- **Status:** done (round 59 — see Done; the shared builder fix also
  corrected Auto Zoom's 25 fps zoompan desync, latent since it
  shipped)

## T-106 — export outputs can silently overwrite each other, and one boundary is unvalidated

- **Spec:** round-57 worker finding. `<source>_<w>px_<fps>fps.gif`
  and `<source>_compilation.mp4` are fixed names — the next job with
  the same settings silently overwrites the last; and
  `video:exportBatch` does not validate `clip.cropRect` at the IPC
  boundary (`assertOptionalCropRect` exists and is applied to the
  two new payloads only; a hand-edited project file reaches ffmpeg
  unchecked).
- **Acceptance criteria:** outputs never silently overwrite (a
  numbered suffix or a timestamp — follow whatever the platform
  export already does for collisions, or document that it has the
  same gap and fix both); exportBatch validates cropRect with the
  shared validator (note: this changes what a hand-edited project
  export does — the refusal must speak the T-84 voice); unit + E2E
  per the standing bar; LESSONS entry.
- **Status:** done (round 59 — see Done; extended to reframe, PiP and
  the kit folder under the same criterion)

## T-107 — converted video imports point at a temp file the next launch deletes (T-99's video sibling)

- **Spec:** round-58 worker finding, the T-99 data-loss class.
  Importing a video that needs conversion (flv/ts/wmv/mpg/3gp)
  stores the converted file's path under the `imagii-import` temp
  family; a saved project then references it and launch pruning
  breaks reopening, exactly like the extracted-audio WAV before
  round 58. Also: an OLD (v3) project whose extracted WAV was
  already pruned could be recovered the same way T-99 now works —
  its stored path encodes nothing, but the project may carry enough
  to re-extract; check what v3 actually stored before promising.
- **Acceptance criteria:** projects store the ORIGINAL source path
  + a converted-from marker and re-convert on open when the temp is
  gone (the T-99 mechanism, same schema-bump conventions, old shape
  read as written); the v3-WAV recovery is implemented if the v3
  shape carries the source video path, else documented as
  unrecoverable; save -> prune -> reopen E2E; LESSONS entry.
- **Status:** done (round 60 — see Done; v3 WAV recovery implemented —
  the v3 shape carries fromVideoPath; the Clean-audio second door
  closed under the same root cause)

## T-108 — small honesty and dead-surface cluster from round 58's sweep

- **Spec:** round-58 worker findings. (a) Reframe's `analyzing`
  event sends `percent: 0` — the round-54 rule says a progress
  number is a measurement or absent; (b) a finished burn-in leaves
  a "Done 100%" row forever; (c) Audio Studio's header shows the
  scratch WAV's random name (aB3dE5fG7h.wav) for audio extracted
  from a video — show the video's name; (d) `video.cancel(jobId)`
  and `app.quit()` are exposed through the preload with no renderer
  caller (the T-101 class); (e) transcription cannot be canceled
  at all — the whisper child never joins the cancel registry its
  own burn-in now uses.
- **Acceptance criteria:** (a) absent percent; (b) the row clears
  or says done-and-dismissible; (c) the header names the source
  video; (d) dead exposures deleted, deadActions-style pin extended
  to the preload surface; (e) transcribe joins the registry +
  latch, Cancel reaches it, sentinel flows (the burn-in's exact
  pattern); unit/E2E per the standing bar; LESSONS entry.
- **Status:** done (round 60 — see Done)

## T-109 — round-59 finds: invisible crops, a drifting zoom, a temperature slider that barely works

- **Spec:** round-59 worker findings, all verified in its runs. (a)
  `Player.tsx`'s `cropEnabled` starts false on a LOADED project, so
  a stored crop is applied to every export while the editor shows
  none — the user cannot see or adjust what will happen; (b) Auto
  Zoom drifts toward the top-left (zoompan's x/y default to 0 —
  ~24 px right-drift at 1.4 s in 720p), since it shipped; (c) the
  Temperature slider moves only shadows (colorbalance rs/bs), so
  warm/cool barely changes a mid-tone frame — the label promises a
  temperature change (tiebreaker: fix the code; the look of old
  projects shifts slightly and that is the honest direction); (d)
  Compile's and GIF's crop refusals still show a generic sentence
  where the batch speaks plainly; (e) USER_GUIDE still says Stream
  Graphics images download without asking (false since T-91).
- **Acceptance criteria:** (a) cropEnabled initializes from the
  loaded clip and the E2E reopens a cropped project seeing the
  crop; (b) zoompan centers (x/y expressions), Layer 5 pins the
  marker centered; (c) temperature reaches mids+highlights, Layer 5
  red-first on a mid-tone frame; (d) one plain refusal voice across
  the three paths; (e) the guide line corrected; LESSONS entry.
- **Status:** done (round 60 — see Done)

## T-111 — review-gate fixes, main process + shared + media chain

- **Spec:** the nine-reviewer sweep over the held wave
  (2026-10-10). Items: (1) `escapeDrawtext` mangles `'`, `%`, `\`
  and newline — an overlay "Let's go" KILLS the export (graph-level
  quote closes; `enable=` comma splits), "50% off" silently drops
  the overlay (verified on real ffmpeg 6.1.1); (2) an odd
  custom-preset size (e.g. 1081x607) fails every export with
  "width not divisible by 2" — `resolveExportPreset` must `even()`
  like compile segments already do; (3) `validateExportJob` gains
  `assertOptionalClipRecipe` (a 1e-6 speed currently yields a
  261-byte file reported as success) — T-110(d) decided: validate;
  (4) `amix` default `normalize=1` steps the surviving track +6 dB
  the moment the shorter one ends (`normalize=0` + a limiter on the
  manual-gain path); (5) secondary-track `gainDb` and ducking
  numerics reach the filtergraph unvalidated from a hand-edited
  project (filter-syntax injection -> arbitrary file write via
  `ametadata=:file=`); (6) the whisper scratch WAV is 48 kHz stereo
  (~690 MB/h; older `whisper.exe` builds reject non-16 kHz) — 16 kHz
  mono for transcription only; (7) loudness target range tightens
  to -70..-5 (loudnorm's real floor); (8) extraction ffmpeg children
  join a registry the quit sweep and `cancelAllAudioJobs` reach; (9)
  the transcribe arrival-kill leaves a stale `activeTranscribe`
  entry when Cancel lands pre-spawn; (10) burn-in percent is
  invented (5 + 0.5/s capped 99) — compute from real `-progress`
  time against output duration; (11) `video:exportBatch` gets a
  single-flight guard; (12) preload reframe listener type says
  `percent: number` where main sends `percent?`; (13) T-110(b)
  pulled in: a reopened project's re-attach muxes the ORIGINAL with
  `-c:v copy` into mp4 — probe the codec and convert first when mp4
  cannot carry it; (14) burned caption size follows frame HEIGHT,
  so a vertical/reframed clip gets an 817 px text block at default
  size (measured, 43% of the frame) — scale by the 16:9-equivalent
  basis on narrow frames so vertical burns match what the same size
  looks like on landscape.
- **Acceptance criteria:** every behavior change red-first; Layer 5
  (real ffmpeg) for items 1, 2, 4, 6, 13, 14 — drawtext with `'`
  and `%` (win32 twin), odd-preset export succeeds, voice-longer-
  than-music level step gone, scratch WAV ffprobes 16 kHz mono, wmv
  reopen re-attach produces a playable file, vertical burn's text
  band measured sane; injection strings refused in plain voice
  (item 5); `npm run verify` + `test:media` green.
- **Status:** done (round 61 — see Done)

---

## T-112 — review-gate fixes, renderer

- **Spec:** same sweep, renderer surface. Streamer/UX: Clip Kit's
  Shorts swap reads the SOURCE orientation, not the crop
  (`cropFrameSize`); Reels' 180 s is a recommendation cutoff, not a
  cap (reword, keep tables in sync); Compile discloses "1920x1080,
  30 fps"; "Crossfade" renamed — it is a dip to black; TikTok
  sweet-spot note stops flagging 60 s+ (Creator Rewards wants
  1 min+); hook badge divides by clip speed; a failed batch marks
  only the running row Failed (queued rows "Not run", reason in
  text); audio-dependent actions gate on `probe.audioCodec === null`
  ("This video has no sound"); Export with no folder opens the
  picker like its siblings; saved toasts name the file when
  numbering chose "name (2)"; kit folder removed on cancel/failure
  and the label counts; the header button stops saying
  "Transcribing…" during a burn-in; disabled Export explains
  itself; Compile sends `clipSpeed(clip)` not the raw store value;
  crop Reset keeps the section open in both arrival paths; "Clean
  audio" confirms via `audioCloseMessage` before discarding a tuned
  session; Importer refuses a second concurrent conversion; a late
  transcription cannot attach video A's SRT to video B (source
  guard); project open: staleness guard around the long re-convert,
  ENOENT-only "moved or deleted" (everything else through
  `userFacingError`), an "Extracting audio…" toast on the re-extract
  wait; canvas renders hint text dimmed so "won't export" is visible
  on the canvas itself, and the seven affected template descriptions
  say which text exports. A11y: audio export row gets
  role="progressbar" + pass label; Compile verdict list focusable
  (Chromium 126 has no focusable scrollers); GIF length warning in
  an always-mounted `role="status"`; the three sub-AA accent-on-wash
  pairings fixed (3.6-4.1:1 measured); setup-card links underlined
  at rest; `aria-pressed`/`aria-current` + label-in-name on
  Left/Center/Right and the clip list; SafeZoneOverlay svg
  aria-hidden. Design: dead `RATIO_COLOR['16:9']` removed with its
  pin, DESIGN_GUIDE says three guides; caption Size readout uses the
  loaded video's real height; fix wizard's summary names the mains
  notch; CleanupPanel's "-25 ≈ medium" is the LIGHT preset.
- **Acceptance criteria:** red-first for behavior changes;
  discriminating negative tests for new refusals; the coverage
  ledger rows updated for every touched element; AA pairings
  recomputed in the test that pins them; `npm run verify` + full
  Playwright green.
- **Status:** done (round 62 — see Done)

---

## T-113 — review-gate fixes, pass-2 findings (round 63)

- **Spec:** the nine reviewers' second pass over the held wave
  (2026-10-10). HIGH: the default "+ Add text" overlay
  (`colorHex: 'white'`, and any named color the editor's own
  placeholder invites) is refused by every overlay gate — Export and
  Compile fail with "a setting imagii can't use", Save project
  throws, an autosave holding it fails restore; names normalize to
  hex at the store boundary, the gates stay hex-only, Size clamps
  in the editor, and an E2E exports the DEFAULT overlay. MED: the
  Clip Kit bundles the whole-video SRT unshifted (source-clock cues
  beside a clip starting at 0:00 — shift to the clip's range on the
  OUTPUT clock, speed-divided); the kit's swapped YouTube-Short
  slot lost every length check when Reels went to 1200 s (own
  180 s limit); "Clean audio"'s confirm says "Close this audio?"
  (parameterized lead-in: "Replace the audio you're editing?…");
  selection shown by fill color alone on six older control groups
  (aria-pressed sweep). Plus: shared validators throw
  unconditionally (assert() fail-opens under NODE_ENV=production;
  validators-throw/assert-warns split recorded as design); the
  re-attach re-encode gains an even-dimension scale (odd VP9 webm
  died where copy once worked); windowsHide on the three bare
  spawns; concat refusals through assertUsableRecipe; burn-in's
  opening event carries no percent (the frozen determinate 0%) and
  a zero-dim probe never refuses a burn; two unfinished refusal
  sentences finished; the named test flake killed (shared real
  tmpdir between the new WAV-writing tests and tempCleanup's
  recursive rm — per-file dirs); ProjectIO: both staleness
  baselines at the top (the audio side could still be wiped),
  playhead applied only to a video that actually loaded, a distinct
  reopen-convert toast id, richer skip/stale toasts, autosave
  suppression narrowed to the store writes; batch and kit send
  clipRecipe-normalized clips; hook analysis keys on the rounded
  window (no ffmpeg respawn per slider tick) and sub-0.5 s clips
  show no dangling row; a11y: aria-expanded, aria-live on the kit
  button, three progressbars + signal meters, the visible loudness
  range, two more focusable scrollers + the DESIGN_GUIDE sentence;
  asset-catalog descriptions join the "sample text doesn't export"
  rule with the test extended; docs: FOR_MIKE crossfade line, the
  captions comment's wrong pixel figure, the UK-spelling sweep,
  "canvas dim" mislabel, STYLE_GUIDE's hint-dim sentence.
- **Acceptance criteria:** red-first per behavior change; Layer 5
  for the even-dimension guard and the kit SRT shift; the default-
  overlay export E2E; discriminating negatives per the round-21
  protocol; ledger rows for every touched element; LESSONS entries
  for the HIGH, the kit SRT, the flake and the validators; `npm run
  verify` x3 consecutive (the flake fix proves itself), test:media,
  full Playwright — all green.
- **Status:** done (round 63 — see Done)

---

## T-114 — review-gate fixes, sweep-3 findings (round 64)

- **Spec:** the nine reviewers' third pass (2026-10-10). Main:
  (1) the odd-dimension class closes on ALL its libx264 surfaces —
  convertToMp4, caption burn-in and the PiP composite get the
  shared even stage (each verified dying at exit 187 on a 321x241
  input; the recording convert's failure even deletes the take);
  (2) a legacy autosave holding a NAMED overlay color ('white',
  from the pre-fix default) still refuses to restore — a migration
  step in validateProject maps CSS names through the literal table
  (injection strings are not in it); (3) the two remaining
  trust-boundary soft asserts (the re-attach unlink collision
  guard — proven by execution to delete the source under
  NODE_ENV=production — and hexToAssColor) become assertAlways,
  the burn-in handler validates style colors at the gate, and the
  source scan widens to non-test src/main with an allow-list of
  the audited pure invariants; (4) parseLoudnormJson treats a
  non-finite measurement (silent input prints -inf) as
  no-measurement, falling back to single-pass loudnorm instead of
  a failed export; (5) the kit SRT's basename gains _captions so
  a clip named like a Windows device (Aux, COM1) cannot write 8
  files and then report failure; (6) the Font dropdown stops
  being a dead control — a whitelist table maps the six options to
  fixed font paths (the stored string is never interpolated),
  unknown values fall back to Arial. Renderer: the hook row gates
  on no-sound (the T-113 consolidation miss); the start-handle
  drag stops respawning ffmpeg per mousemove and keeps the last
  score visible; Autosave Restore's skip toast stops promising a
  project file that does not exist; the selected-state class
  actually closes (aria-pressed on the RecordStudio source cards,
  LayerPanel rows and MoodBoard rows become keyboard-selectable
  with state exposed, the eye toggle says which, and the sweep's
  regex widens to border/ring/wash selection styles); the
  SafeZone modal's initial focus returns to Cancel; the
  transcript scroller gets a role; the export queue bar becomes a
  named progressbar; the overlay editor's x/y inputs get names
  and the color input points at its alert; #rgb shorthand
  expands; the GIF live region stops adding a phantom 12 px gap;
  the loudness range hint leaves the checkbox's name and gains
  its parentheses and true minus; the square clip card's
  description stops implying the well exports. Docs: the
  remaining UK spellings in wave prose/comments (incl. the
  noRawHex test's own), the stale ledger row for the old
  Clean-audio wording, STYLE_GUIDE's contradictory
  throw-vs-ok:false bullets reconciled, the templateTruth comment
  that counts ten items as nine, and the crossfade stragglers
  (concat.ts comment, ClipKitButton header, HOW_IMAGII_WAS_MADE).
- **Acceptance criteria:** red-first per behavior change; Layer 5
  for items 1, 4 and 6 (real renders; win32-gated where drawtext
  demands); the legacy-autosave restore test uses a verbatim
  pre-fix JSON; discriminating negatives per the round-21
  protocol; ledger rows updated; LESSONS entries for 1, 2 and 6;
  `npm run verify`, test:media and the full Playwright suite
  green.
- **Status:** done (round 64 — see Done)

---

## T-115 — review-gate fixes, sweep-4 findings (round 65)

- **Spec:** the nine reviewers' fourth pass (2026-10-10; audio,
  privacy, ffmpeg and electron returned CLEAN). Code: (1) the
  recording convert's percent is measured (duration piped down,
  out_time over it, capped 99; indeterminate without one) instead
  of pinning at 99% for most of a long convert beside an enabled
  Discard, and its wrong comment dies; (2) the take-is-gone
  failure toast and the clear-failed toast use ERROR_TOAST_MS —
  the 4 s default vanishes before the one message that must not
  be missed; (3) the Save / "→ Canvas" hover overlays gain
  focus-within visibility so a keyboard user stops pressing Enter
  blind; (4) the image Export format select gets its name; (5)
  the hook recompute moves from whole-second keys to a trailing
  debounce on the EXACT start and window (the upgrade the code
  itself names) so the final badge is never a second stale, with
  the three half-second comments corrected; (6) EVEN_PICTURE
  becomes crop (pixel-exact; scale resamples the odd window
  captures the stage exists for) with a hard-edge Layer 5
  assertion; (7) the legacy migration also clamps a finite sizePx
  into bounds (the old editor had no upper clamp — same family as
  'white'); (8) the overlay x/y names say what they are
  ("Overlay horizontal position (0 to 1)"); (9) the square clip
  card says "do not export", not "never" (retyping a hint
  exports). Docs: the four surviving UK-spelling lines (incl.
  inside noRawHex.test.ts) plus the unquoted assertion message;
  the disclosure line's honest count (measured in round 65: 87
  pre-wave lines — 53 tests, 26 docs, 8 comments) and
  full category list; the two "crossfade" ledger rows; the
  STYLE_GUIDE confined-read ok:false exception for writeKitSrt;
  the DESIGN_GUIDE toggle sentence narrowed to state-named
  toggles (action-named Play/Pause/lock are standard ARIA); the
  overlayColors comment naming the right test file; the stale
  Mid.srt mention in the T-113 ledger row.
- **Acceptance criteria:** red-first per behavior change; Layer 5
  for the crop change (the checkerboard stays hard-edged) and the
  convert percent if its parse changes; the legacy sizePx test
  uses verbatim pre-fix JSON; discrimination per the round-21
  protocol; ledger rows updated; `npm run verify`, test:media and
  full Playwright green.
- **Status:** done (round 65 — see Done)

---

## T-116 — review-gate fixes, sweep-5 findings (round 66)

- **Spec:** the nine reviewers' fifth pass (2026-10-10; privacy,
  audio, streamer and a11y CLEAN; every other finding LOW — the
  wave's first zero-MED pass). Code: (1) the hover overlays reveal
  on KEYBOARD focus only (`has-[:focus-visible]:opacity-100`
  replaces `focus-within` at both sites — a mouse click left the
  tile's scrim stuck until focus moved; the sweep rule accepts the
  new spelling; the E2E tabs instead of calling focus() and adds a
  click-then-mouse-away assertion); (2) Save .srt's two real
  causes reach the person as finished sentences thrown by main (a
  transcript outside the captions folder on THIS computer — say
  transcribe again; a missing file found BEFORE the save dialog
  opens via the existsSync check writeKitSrt already does), E2E
  re-pinned; (3) "untick" becomes "uncheck" in the recording
  convert-failure message (BRANDING: check a box, never tick it)
  and the copyConventions regex learns the un- prefix (it could
  not match inside "untick") plus the main-process string scope if
  cheap; the pre-wave user-facing "Cancelling…"/"unrecognised"
  strings go US too (product copy; T-92's sweep missed them).
  Comments/docs: the stale "scale" comments (process.ts:399-403,
  muxCodec.test.ts:97 and :118), filters.ts:48-49's phantom
  "/pad", projectValidation.ts:106's now-untrue "still refuses"
  sentence; the five UK strings in UNTRACKED new test files the
  diff-based sweep could not see (cancelLatch titles x3,
  videoExportBatch "colour", transcribeCancel comment) with the
  disclosure line's enumeration made true again (and its grep
  scoped so package-lock's @img/colour does not pad the count);
  the ledger/TESTING count drift from the saveSrt delta (3344,
  +43, ten code items; TESTING:476's media total 192/181); the
  checkerboard claims scoped to the sampled row 7 everywhere;
  a11ySweep's header says four rules; the doc mentions quoting
  the mood-board button's real label.
- **Acceptance criteria:** red-first for the two behavior changes
  (the stuck-overlay assertion; the saveSrt sentences);
  discrimination per the round-21 protocol; ledger rows updated;
  `npm run verify` and the affected Playwright specs green, full
  suite at the expediter's gate.
- **Status:** done (round 66 — see Done)

---

## T-117 — review-gate fixes, sweep-6 findings (round 67)

- **Spec:** the nine reviewers' sixth pass (2026-10-10; privacy,
  a11y and electron CLEAN; every finding LOW — the second
  consecutive zero-MED pass). Code: (1) `audio:deletePreset` is
  the one id-to-path site without the safe-id alphabet guard — a
  traversal id reaches `unlink` in userData; the guard every
  sibling has goes on the preset boundary (covering save and load
  too), with the old LESSONS rationale ("since they're not
  paths") corrected; (2) the captions-folder gate treats a
  transcript whose own name starts with ".." as outside the
  folder (a video named `..intro.mp4` is legal on Windows), so
  Save .srt refuses the app's OWN file and round 66's sentence
  sends the person into a transcribe-again loop while the kit
  silently drops its captions — a shared real-parent-segment
  helper (`rel === '..' || rel.startsWith('..' + sep) ||
  isAbsolute(rel)`) at both caption sites and moodboard for
  parity, with in-folder `..`-named fixtures proving the save
  succeeds and the kit writes; (3) the kit folder and the
  recording's default name stamp the UTC date while the export
  panel's {date} token is local — an evening Pacific streamer's
  kit lands in tomorrow's folder; stamp both from local time via
  the filename.ts convention and update the kitStamp E2E helper;
  (4) Record's finalize failure toast only strips the IPC
  envelope, so every cause but the convert crash shows raw
  strings (EPERM with full paths, a channel-prefixed "recording
  is empty", mid-take ENOSPC) — route it through userFacingError
  at ERROR_TOAST_MS and give the empty-recording refusal a
  finished sentence; (5) "any more" becomes "anymore" in SRT_GONE
  with its two test pins and three doc quotes moved. Docs: the
  ledger row quoting the pre-rename E2E title; the tick-idiom
  disclosure made exact (the CropOverlay site is wave-added, not
  older; the unlisted sites join the list); category (5)'s
  eighteen recounted to nineteen with the borderline
  copyConventions comment decided; the four whole-frame softness
  claims about `scale` scoped to the measured edge-to-middle
  truth (filters.ts, filters.test.ts, STYLE_GUIDE, LESSONS —
  media.spec's wording is the model; sweep 7 re-measured: ~48%
  of pixels land in the suite's mid-gray band (80–175) and
  almost none stay pure 0/255 — the earlier "52.5% still pure"
  read the band's complement as purity), and
  filters.ts's command list names reframe.
- **Acceptance criteria:** red-first for the five code items (the
  traversal unlink, the `..`-named save/kit, the date stamps, the
  raw-string toasts, the sentence pins); discrimination per the
  round-21 protocol; ledger rows updated; `npm run verify` and
  the affected Playwright specs green, full stack at the
  expediter's gate.
- **Status:** done (round 67 — see Done)

---

## T-118 — review-gate fixes, sweep-7 findings (round 68)

- **Spec:** the nine reviewers' seventh pass (2026-10-10; QA,
  audio, privacy and streamer CLEAN; a11y and UX clean after two
  T-110 filings — the Record live-region to (l), the copy-branch
  take deletion to (u); every remaining finding LOW, all in the
  claim-accuracy class, independently verified by the expediter).
  Code: (1) Autosave Clear promises a cause it can never name —
  `clearAutosave` (main/autosave.ts) swallows every unlink errno
  and throws the shapeless "could not delete X", so the person
  always gets the bare fallback, and round 67 dropped the old
  "close anything using it and try again" advice for the one case
  (a locked file) where it was right. Carry the first failed
  unlink's errno code into the thrown message ("could not delete
  autosave.json (EBUSY)") so `userFacingError`'s existing
  `\bEBUSY\b|EPERM|EACCES` cause maps a locked file to "Windows
  blocked access to a file. Close any app using it, or check your
  antivirus." — the comment's and LESSONS' claim becomes true
  instead of softened, and the remedy returns. Truth-edits with
  it: the AutosaveRestore.tsx:140-141 comment names only causes
  that can occur (a locked file; unlink has no full-disk shape),
  the home-chrome E2E's first stub stays verbatim what main
  raises and the EBUSY case uses main's real new shape, and
  LESSONS (4b) and the INTERACTION_COVERAGE row say what is
  true. Comments: (2) RecordStudio.tsx:454-460 says the 8 s
  toast "says the take is gone" — true only of the convert
  sentence ("Nothing was saved"); the copy branch's ENOSPC/EPERM
  causes advise "try again" while the finally has deleted the
  take (the T-110(u) product call, extended this sweep) — scope
  the comment to which branch says what, citing (u). Docs: (3)
  the whole-frame softness prose says "about half the pixels (48
  percent) between black and white" — re-measured twice (sweep
  7 on the suite's pipeline, the expediter on raw gray):
  strictly-between is ~96-100% and pure 0/255 is ~0-4%; the 48%
  is the share in the suite's own mid-gray "soft" band (80-175,
  media.spec.ts's `hardness`) — and the same prose's "the left
  and top edge stay hard (nothing to blend)" is false too: both
  measurements show every edge soft at its middle (row 0: 70-82
  of 320 pixels in the band, values a flat ~124-131) with only
  the four corners hard, and media.spec.ts:5921's "most of the
  frame" overstates 48.5%. Name the band, drop "between black
  and white", and reword the edge claim to corners-hard /
  edges-soft-at-their-middle at filters.ts:54-57,
  filters.test.ts:875-879, STYLE_GUIDE, LESSONS (both the :43
  measured-fact line and the :95 entry), TESTING,
  INTERACTION_COVERAGE and media.spec.ts's T-115 comment (the
  two TICKETS sites are already corrected); (4) the "any more"
  disclosure cites
  interactionWiring.test.ts:716 for a title that sits at :721,
  and wave-added STYLE_GUIDE.md:336 carries the spelling
  undisclosed — re-point the cite and add the line; (5) category
  (5)'s "nineteen comments and titles with cancelled as a word"
  counts the string literal audio.spec.ts:1733 ('cancelled.mp3')
  yet omits its sibling media.spec.ts:3902 ('the recording
  convert was cancelled') — recount as eighteen comments and
  titles plus the two literals named, and re-point the stale
  failurePathLanguage.test.ts:245 cite to the real lines
  (:273-278). Code, from the ffmpeg reviewer (both items
  expediter-replicated on the real binaries): (6) [MED] the
  temperature grade corrupts saturated colors on the shipped
  win32 ffmpeg major — 6.1.1's `colorbalance` (an RGB filter)
  converts back to YUV with the bt601 matrix and writes
  `color_space=unknown`, so a bt709-tagged source (OBS's
  default) is encoded in the wrong matrix while players read the
  file as bt709 (replicated: a no-op `colorbalance=rs=0.0001` on
  a tagged source turns player-view SMPTE green (0,157,0) into
  (0,133,0) on 6.1.1 and strips the tag; bundled 7.0.2 preserves
  both). When the source's probed `color_space` is bt709
  (`probeVideo` carries it) and the temperature stage is in the
  graph, append `scale=out_color_matrix=bt709` after
  `colorbalance` — the reviewer measured the control restored
  within 2 levels on 6.1.1 and the output re-tagged; skip
  untagged and bt601 sources, whose in/out symmetry is already
  correct. Every Layer 5 grade fixture is untagged lavfi gray
  and matrix-blind, so the suite gains a bt709-TAGGED
  saturated-patch case; (7) `escapeSubtitlesPath` escapes `=` in
  neither character class, and the burn-in passes the SRT path
  positionally (`subtitles=<path>:force_style=...`), so ffmpeg's
  option parser splits a `Boss=Dead-<ts>.srt` at its `=` and
  dies with "Option not found", exit 8, on both majors — the
  person's only recourse is renaming the video and transcribing
  again (replicated in the app's exact filter shape; adding `=`
  to both classes loads and renders). Add `=` to both classes,
  an `a=b.srt` case to the Layer 5 burn-in it.each and a pin in
  captions.test.ts.
- **Acceptance criteria:** behavior changes are exactly three —
  the errno carry (1), the bt709 matrix stage (6) and the `=`
  escape (7) — each red-first with discrimination (break the
  guard, watch the named test fail, restore byte-identical
  content). For (1): the EBUSY-shaped throw maps to the cause
  sentence, the unknown shape still falls to the bare fallback,
  home-chrome pins updated red-first. For (6): a unit pins the
  appended stage for a bt709 source and its absence for
  untagged/bt601; the new Layer 5 case proves the real binary
  accepts the graph, the output keeps `color_space=bt709` and a
  saturated patch's player-view decode stays within a small
  delta of the ungraded control (IMG-PREC: a filter-graph
  change, so Layer 5 is mandatory); a one-off run against the
  distro 6.1.1 binary (the reviewer's alias-config trick) is
  recorded in the Done entry as red-first evidence on the
  affected major, and the win32 release run (T-110(f)) re-checks
  it on the real shipped binary. For (7): the Layer 5 it.each
  gains `a=b.srt` (red on the current escaper: exit 8) and
  captions.test.ts pins the class. Every re-pointed line cite
  verified against the tree; `npm run verify`, `npm run
  test:media` and the touched Playwright specs green, full
  stack at the expediter's gate.
- **Status:** done (round 68 — see Done)

---

## T-119 — review-gate fixes, sweep-8 findings (round 69)

- **Spec:** the nine reviewers' eighth pass (2026-10-11; the first
  sweep with the deeper rerun briefs — every finding below was
  verified by the expediter against source, and the three
  measured ones replicated on the real binaries). Code, behavior
  (red-first + discrimination each): (1) [MED] `recording:abandon`
  hangs forever when the take's WriteStream already auto-destroyed
  after a write error (recording.ts:396-402: `once('close')` on a
  stream whose close already fired never resolves; the session is
  already out of `streamSessions`, so the quit sweep cannot reap
  it either) — the renderer's own failure path (stream error →
  finalize throws → abandon) hits exactly this and the partial
  webm survives the "disk is full" toast; skip the wait when the
  stream is already `destroyed`/`closed` (or bound it with a
  race) and unlink in a `finally`; regression unit against the
  real handler per the QA repro (close the fd, append rejects,
  abandon must answer and the temp file must be gone). (2) [MED]
  Start recording is re-entrant (RecordStudio.tsx:235-371; the
  button gated only by `!selectedSourceId`, `phase` set only at
  the end): a second click during the getUserMedia/begin awaits
  overwrites every ref and orphans the first capture and its
  growing temp webm — a `startingRef` guard plus a visible
  starting state ("Starting…", disabled). (3) [MED] the save
  toast's "Edit in Video Studio" (`editInVideoStudio`) replaces a
  tuned Video Studio session with no confirm while both wave
  siblings ask (VideoStudio Close, T-112's `cleanAudioFlow`) —
  confirm with the T-112 shape ("Replace the video you're
  editing? N clips and their edits will be discarded."), asking
  nothing when there is nothing to lose; the broader Home
  Open-project case stays the ledgered T-110 residual. (4) [MED]
  bt601-TAGGED sources still lose their tag through colorbalance
  on 6.1.1 (expediter-replicated: smpte170m in → `unknown` out,
  pixels intact; every built-in preset is HD — at least 1280 px
  on its LONG side (the portrait ones are 1080×1920) — and
  tag-guessing players read HD as bt709, so the stripped file
  shifts exactly
  like the bt709 case T-118 fixed — it hits OBS Rec.601 profiles
  and SD captures) — extend the matrix stage: bt709 keeps
  `scale=...,setparams=...`; `smpte170m`/`bt470bg` get
  `setparams=colorspace=<probed tag>` ONLY (their round trip is
  pixel-symmetric; replicated: retag restores the tag, pixels
  within 1 level); bt2020nc stays the ledgered residual (retag
  alone would not fix its pixels). Reword the skip rationale at
  filters.ts:384-386, media.spec.ts:1794-1795, STYLE_GUIDE and
  LESSONS: untagged is skipped because ffmpeg's round trip is
  SYMMETRIC (swscale reads and writes bt601), NOT because
  "players assume bt601" (they guess bt709 at HD — the ledger's
  own Auto Zoom "correct but untagged" line contradicted the old
  wording). Unit pins flip from none-for-601 to retag-for-601
  (red-first); gradeMatrix wiring; a bt601-tagged Layer 5 case in
  the T-118 block (7.0.2-green by design, red on 6.1.1 pre-fix,
  same disclosure). (5) the timeline's keyboard path: I/O and ,/.
  handled from the timeline slider's `onScrubKey` (same
  text-field and modal guards as the Player's handler), the two
  trim-handle `<button>`s become `tabIndex={-1}` `aria-hidden`
  pointer affordances (today they are dead tab stops announcing
  as actionable), and the E2E covers the real sequence the guide
  promises (click the track, press I) — USER_GUIDE:38/:135 and
  HotkeyOverlay:26 then say something true. (6) AudioImporter
  gains the Importer's `busyRef`/`refuseIfBusy` single-flight on
  both drop and pick (a slow extraction landing late clobbers
  tuned work; T-112 fixed only the video sibling). (7)
  `captions:openModelsFolder` opens nothing on a fresh profile
  (nothing creates `<userData>/models` before the installer;
  T-102 gave the bin sibling `ensureUserBinDir`) — mkdir
  recursive in the handler, await `shell.openPath`, console-log a
  non-empty result. (8) the Fix-wizard drops keyboard focus on
  every step (each answer unmounts the focused button; the trap
  does not re-run) — focus the new step's first option (the
  Tutorial.tsx pattern); same for ThumbnailVariants' swapped
  Generate button. (9) ImageStudio's shortcut guard excludes only
  INPUT/TEXTAREA, and the Export format `<select>` is an inline
  panel (not a Modal), so typing `p` there switches tools and
  Delete removes the selected layer — add SELECT to the guard,
  regression test. (10) the clip rename input is the one
  `outline-none` field without a ring (`focus:bg-bg-base` is
  1.06:1 against the card), against DESIGN_GUIDE's focus-ring
  rule — add `focus:ring-1 focus:ring-accent`, and check why the
  a11ySweep outline-none rule missed an input (extend its
  discrimination if cheap). (11) Tutorial's
  `scrollIntoView({behavior:'smooth'})` animates under OS Reduce
  motion (CSS `scroll-behavior` does not govern an explicit
  option) — choose 'auto' when `prefers-reduced-motion: reduce`
  matches, and narrow the index.css comment that claims the CSS
  disables "smooth scrolling across the whole app". (12)
  `validateProject` accepts structurally empty studios
  (`clips:[{}]`, `chain:{}`, `doc:{}` all pass; the clips loop
  validates only text overlays) and the app then throws in render
  (`clip.selectedPresets` iteration, `chain.gainDb.toFixed`) or
  silently kills autosave capture (`doc.layers.length`) — valid
  required fields for a clip, the chain's rendered numbers and
  `doc.layers` as an array, refusals in the existing reason
  style, red-first with those exact shapes. (13) a blank export
  leaves the previous watermark for the Clip Kit to stamp
  (ExportPanel writes `streamerHandle`/`watermarkPosition` only
  `if (watermark)`; the guide says "the watermark you last
  exported with") — clear both keys on a watermark-less export so
  the guide's sentence is true. Docs and comments (every cite
  verified against the final tree): (14) README.md:179 ("The
  only feature that touches the internet is reference image
  search" — README:26 itself names the model download going
  online) and .github/workflows/release.yml:75 ("Everything
  stays on your computer") both violate BRANDING's
  never-"everything"-without-the-exceptions rule (T-85's own
  class; the fix table missed these two files) — name both
  exceptions in each, and extend the truthInCopy EXCEPTIONS pin
  to README (and the release body); the release.yml edit is BODY
  TEXT ONLY, no trigger or workflow-structure change. (15) the
  process.ts:328-338 mux comment says "amix runs to its longest
  input, so the mix is max(voice, music)" — true only with Duck
  off; the ducked bed ends with the voice (sidechaincompress
  forwards the first EOF; the suite's own comment says so) —
  scope the account to which branch does what and cite T-110(af).
  (16) process.ts:320-323 calls reframe a "whole-file re-encode
  ... default CRF — no bitrate cap ... frame rate left as the
  source's" while reframe.ts sets `-b:v 6M -r 30` on a trimmed
  range — say "like the burn-in"; soften the LESSONS echo. (17)
  filters.ts:380-381 "within 2 levels" is 3 on the suite's own
  fixture (both majors; Layer 5's tolerance of 4 agrees) — say
  3. (18) the "(0,157,0) into (0,133,0)" figure quotes the
  expediter's one-off hand fixture; the suite's runners record
  130 — quote 130 at filters.ts:379, filters.test.ts:872,
  media.spec.ts:1642/:1775 and STYLE_GUIDE:512 (LESSONS:31
  already names both measurements; keep its phrasing). (19)
  filters.test.ts:876 quotes the Layer 5 title inexactly ("keeps
  a bt709 source" for "keeps a bt709-tagged source ... (real
  ffmpeg, T-118)") — quote it exactly so it greps. (20)
  filters.test.ts:907 'no colour space at all' is a wave-added
  UK spelling that falsifies the ledger's "none" claim — 'color'.
  (21) presets.ts:37 "Meta extended Reels to 3 minutes in 2024"
  — the announcement was January 2025. (22) the spawnWindowsHide
  header says "Thirteen spawn sites had the option and three did
  not" — the tree has 17 (14+3), and the :61 floor of 16
  tolerates losing a site — fourteen/three, floor 17. (23) the
  "any more" inventory: INTERACTION_COVERAGE:2653's own row says
  "any more" (reword to "anymore"; the TICKETS instance is
  already fixed). (24) INTERACTION_COVERAGE's "eight lines/places
  that quote the old ffmpeg-era wording" counts 7 sites (10
  lines) after round 68's cite split — recount, and bring the
  uncategorized 'cancelled' string literals
  (recordingCancel.test.ts:51/75/168/226) and regex alternatives
  (audio.spec.ts:1755, video-pipelines.spec.ts:403) into the
  literals clause. (25) the softness prose's "band 80-175" only
  reproduces with the suite's EXCLUSIVE bounds (`v > 80 && v <
  175`; inclusive gives 49.3) — say "strictly between 80 and
  175"; and the "36 of column 0's 240" is the post-encode figure
  in a sentence describing the scaled frame (3 per end there) —
  label it. (26) tests/e2e/image.spec.ts:941/:945/:1247 cite the
  ImageStudio guard at pre-drift lines (:53-63/:54/:45-46; it
  sits at :51-52 — and moves again with item 9) — re-point after
  the guard edit. Ledger rows and LESSONS entries per the
  standing bars; the a11y toast-reachability design call is
  already filed at (l), the duck-length product call at (af), the
  Gain-vs-Match call at (ag).
- **Acceptance criteria:** red-first with discrimination for every
  behavior item (1-13): break the guard or stage, watch the NAMED
  test fail, restore byte-identical with sha256 pairs shown. For
  (1) the unit drives the real handler (fd closed, append
  rejects, abandon answers, temp gone). For (4) the unit pins the
  per-tag stage shapes (scale+setparams for bt709, setparams-only
  for smpte170m/bt470bg, nothing for untagged/unknown/bt2020nc,
  order pinned after colorbalance), gradeMatrix pins both
  runners' wiring, the new Layer 5 bt601 case proves the real
  binary accepts the graph and the tag survives (IMG-PREC: filter
  graph change → Layer 5 mandatory), and a one-off 6.1.1 run
  through the alias config is recorded in the Done entry as the
  red-first evidence on the affected major. For (5) the E2E
  covers click-the-track-then-I. For (12) the three empty shapes
  are the red fixtures. For (13) the kit stamps nothing after a
  blank export. Every re-pointed cite verified against the final
  tree; `npm run verify`, `npm run test:media` and the touched
  Playwright specs green, full stack at the expediter's gate.
- **Status:** done (round 69 — see Done)

---

## T-120 — review-gate fixes, sweep-9 findings (round 70)

- **Spec:** the nine reviewers' ninth pass (2026-10-14, the second
  deep-brief sweep; every item expediter-verified, the measured
  ones replicated on real binaries or real MediaRecorder media).
  Code, behavior (red-first + discrimination each): (1) [HIGH] a
  recording saved as WebM (Convert off) cannot be opened in Video
  Studio — a MediaRecorder webm has no header duration
  (expediter-replicated: a streamed webm probes `duration=N/A`;
  QA replicated on a REAL MediaRecorder file from the repo's own
  Electron), `probeVideo` refuses it, and the person who used
  imagii's own recorder reads "Re-export it as MP4 from your
  recorder" — fix the FILE at save time (remux the temp webm,
  `-c copy`, in `promoteTempWebm`'s non-convert branch) so the
  saved take probes with a finite duration AND a sane frame rate
  (the same file's container rate reads 1000/1 — item 2's root;
  the worker measures what `-c copy` yields and adds whatever
  normalization the measurements demand), Layer 5 case on a
  streamed/jittered MediaRecorder-shape fixture through the save
  remux asserting both, and the E2E WebM path finally CLICKS
  "Edit in Video Studio" (today only the MP4 path does); (2)
  [MED] "Convert to MP4" writes a 1000 fps file — the convert
  argv has no `-r`/`-fps_mode`, and a real MediaRecorder webm
  (r_frame_rate 1000/1, avg 0/0) comes out `avg_frame_rate
  1000/1`: QA measured 9575 frames for a 9.6 s take, 1m56s to
  convert, against 277 frames and 13 s with `-fps_mode vfr`, and
  `probeVideo` then reads fps 1000 so the Timeline's , and .
  step 1 ms — add `-fps_mode vfr` to convert.ts's argv, Layer 5
  jittered-ms case asserting output fps sane and frame count
  plausible; (3) [MED] the live preview is never attached —
  `srcObject` is assigned inside `startRecording` while `phase`
  is still 'idle' and both `<video>` elements render only at
  `phase === 'recording'`, so the recording view is a black box
  and the webcam thumbnail an empty border against the panel's
  own promise — attach in an effect keyed on the recording
  phase, E2E asserts `videoWidth > 0`; (4) [MED] Space after
  clicking the track does nothing and scrolls the studio
  (round 69's own guide sentence promises it; UX and a11y found
  it independently) — handle Space in `Timeline.onScrubKey`
  (toggle the same playback the Player's handler does), scope
  the HotkeyOverlay rows truthfully; (5) [MED] the webcam
  composite freezes when imagii is minimized — the compositor is
  a `requestAnimationFrame` loop into `canvas.captureStream` and
  the BrowserWindow keeps default `backgroundThrottling`, so a
  hidden document stops rAF (documented Chromium behavior;
  minimizing is the recorder's normal state) — set
  `backgroundThrottling: false` in webPreferences, wiring pin,
  Record guide note, and the win32 release run hand-checks it;
  (6) [MED] every recording encodes at Chromium's ~2.5 Mbps
  default (no `videoBitsPerSecond`; 1080p gameplay soft before
  the 8M platform re-encodes even run) — pass
  `videoBitsPerSecond: 8_000_000`, say the disk cost in the
  Output hint; (7) [LOW] the electron-store schema is DEAD for
  the 11 dotted keys — Conf nests dotted keys, so flat schema
  properties like `'record.convertToMp4'` match nothing
  (expediter-replicated: a 100-char `streamerHandle` is refused
  while `record.convertToMp4='yes'` and a non-array
  `recentFiles.video` are accepted and stored), `clearInvalidConfig`
  can never fix a corrupt nested value, and `useRecentFiles`
  crashes on one — NEST the schema (same on-disk layout),
  flatten-compare in settingsKnownKeys.test.ts, dotted refusal
  cases red-first with those exact shapes, and the store.ts
  "replaced with the default" comment made true; (8) [LOW]
  electron-builder.yml pins `electronVersion: 31.3.0` while the
  lockfile and every test run 31.7.7 — the shipped runtime never
  ran under any test; delete the pin (the release run re-checks);
  (9) [LOW] navigating away during "Starting…" still orphans a
  live capture (the unmount cleanup runs before the post-await
  code sets any ref; the Home guard checks only
  `phase === 'recording'`) — an unmounted ref checked after each
  await, tearing down streams and abandoning the session; (10)
  [LOW] the Fix wizard's new focus-follows-step means a HELD
  Enter auto-repeats through all three questions and presses
  Apply (React flushes the focus move inside the same discrete
  event) — ignore repeated Enter; and ThumbnailVariants' focus
  effect is keyed on the boolean `hasItems`, so a keyboard
  Regenerate (button disabled → Chromium blurs it) strands focus
  on body — key it on the previews' identity; (11) [LOW]
  `clipKit.lastOutputDir` is written and never read (the kit
  asks for a folder every press while Export remembers) — seed
  the kit picker's defaultPath from it; (12) [LOW]
  `videoDiscardMessage` says "1 clip and their edits" — its/their
  by count; (13) [LOW] `validateChainSpec` does not check the
  two values the round-69 docblock claims it does — a
  hand-edited `denoise:'parametric', denoiseParams:{}` passes
  validation and the export dies at the graph
  (expediter-replicated: ffmpeg refuses `afftdn=nf=NaN`) — add
  finite checks for `denoiseParams` (when parametric) and each
  cut's times, making the docblock true as written; (14) [LOW]
  Timeline I/O marks a stale playhead during playback (the store
  time updates only on `timeupdate`, up to 250 ms old; the
  Player path reads the element) — give `setMarker` the
  element's exact time (a Player-registered reader), pinned;
  (15) [MED, claims + one case] the matrix-stage story
  misstates its own mechanism: "a retag alone would not fix its
  [bt2020nc] pixels" is FALSE (ffmpeg reviewer measured
  retag-only within 2 levels of control for bt2020nc AND bt709),
  the bt709 `scale`'s REAL job is a following Auto Zoom
  (retag-only + zoompan reads (0,133,0); scale+retag + zoompan
  (0,155,0)) and NO real-media case tests the scale (a scratch
  drop stayed 12/12), and the ledgered upgrade recipe
  `scale=out_color_matrix=bt2020nc` is a constant the bundled
  7.0.2 REFUSES ("Undefined constant") — reword the claims at
  filters.ts:399-400, filters.test.ts:881-882/:919,
  STYLE_GUIDE:566-567, IC:2858/:2910 (retag restores pixels and
  tag unless Auto Zoom follows, which is why bt709 keeps its
  scale; the upgrade constant is `bt2020`), and add the Layer 5
  tagged-source + Temperature + Auto Zoom case (red on 6.1.1
  with the scale dropped; 7.0.2-green by design, disclosed).
  Docs (every cite against the FINAL tree): (16) the
  release.yml:5-6 cost comment and README:43-45 maintainer note
  say the workflow "never runs on push" while `push: tags: v*`
  is the deliberate second trigger — say "manual dispatch or a
  pushed v* tag (never branch push or PR)" in both (comment/body
  text ONLY; triggers untouched); (17) README:150 "28 unit
  tests" (siblings of the fixed Tech-stack line; count-free
  rewording), README:172 "projects live at %APPDATA%" (projects
  save via a dialog; say autosave), README:53 "360+" (count-free);
  (18) STYLE_GUIDE:376's universal "stands down for a field, a
  select and a dialog" heading contradicted by
  useUndoRedoHotkeys (deliberately INPUT/TEXTAREA only, pinned)
  — scope it to letter-key handlers; (19) Timeline.tsx:175-179's
  comment still justifies the separate slider by not hiding
  handles that round 69 now hides on purpose — keep the
  paint-order reason; (20) clipKit.ts:175's docstring quotes
  "Reels — the typical 3-minute limit", unproducible since
  Reels is 20 — quote the YouTube Short row; (21) the Record
  guide notes Esc stops the recording only while imagii is
  focused (during a game, alt-tab back first); (22) the five
  "first launch is slow / later ones fast" claims (README:75,
  :160, USER_GUIDE:18-19, FOR_MIKE:70, release.yml:72 body) say
  EVERY launch unpacks (10-15 s), per T-110(ai); (23) "every
  preset is 1280 px or wider" is false (Reels/TikTok are
  1080×1920) — "every built-in preset is at least 1280 px on its
  long side" at filters.ts:387, filters.test.ts:876, LESSONS:44,
  IC:2880, TESTING:658, STYLE_GUIDE:562 (TICKETS already
  corrected); (24) the IC native-dialog inventory cites lines
  that do not land (RecordStudio :454→:554, VideoStudio :44→:66,
  AutosaveRestore ranges) and omits the two newest native
  confirms (RecordStudio:420 round 69, VideoStudio:78 T-113) —
  re-point, add both, and fix the pre-wave drifted cells in the
  same tables (ClipList :111→:157, Home :80→:96); (25) the
  tick-idiom inventory's 10 stale cites re-pointed (the count of
  30 is right); (26) LESSONS:47 attributes the bt601/untagged
  blue and gray figures to "the bt709 cases" — attribute each to
  its fixture (bt709: red 199,42,42 vs 202,45,45, blue 38,54,195
  vs 40,56,197, gray 122,124,124 vs 124,126,126); (27)
  TESTING:62's "11 skipped (the seven bt601 cases…)" reads as
  describing the skipped — say "(seven new: …)".
- **Acceptance criteria:** red-first with discrimination for every
  behavior item (1-15): break the guard, stage or argv, watch the
  NAMED test fail, restore byte-identical with sha256 pairs. For
  (1) and (2), real-media fixtures with MediaRecorder's container
  shape (streamed, no duration, 1000/1 nominal rate) — IMG-PREC:
  ffmpeg command changes make Layer 5 mandatory — and the E2E
  WebM path drives the toast action to an OPEN Video Studio; for
  (5) a wiring pin on webPreferences; for (7) the dotted refusal
  shapes are the expediter's replication; for (15) the new Layer
  5 case runs once against the distro 6.1.1 (alias config,
  scratch only) with the scale dropped as the red; every
  re-pointed cite verified against the FINAL tree; `npm run
  verify`, `npm run test:media` and the touched Playwright specs
  green, full stack at the expediter's gate. The worker's own
  edits shift lines — re-point what they move (the round-69
  lesson).
- **Status:** done (round 70 — see Done)

---

## T-121 — review-gate fixes, sweep-10 findings (round 71)

- **Spec:** the nine reviewers' tenth pass (2026-10-14; every item
  expediter-verified, the fps-class and webcam ones replicated at
  runtime by reviewers or the expediter). Code: (1) [MED] the fps
  class is closed everywhere, not one argv at a time — T-120's
  remux made a Record WebM (container rate 1000/1) reach three
  more libx264/mp4 consumers: the caption burn-in
  (whisperManager, no `-r`/`-fps_mode`; measured 2987 frames at
  1000/1, "More than 1000 frames duplicated", 31.7 s for a 2 s
  take) and the PiP composite (concat.ts, same shape) each gain
  `-fps_mode vfr`; and the cut re-attach's
  `setpts=N/FRAME_RATE/TB` retimes survivors 1 ms apart
  (expediter-replicated on the real MediaRecorder artifact:
  2.4 s of kept picture collapsed to 0.073 s, and the product
  `runAudioMux` with a cut measured 0.074 s vs a 2.426 s
  control) — prefer the ffmpeg reviewer's timestamp-based retime
  (`setpts='PTS-(max(0,min(T,end)-start))/TB'` per cut, measured
  2.46 s on both majors) IF every existing Layer 5 cut case
  stays green and byte-exact where pinned; else normalize
  (`fps=30`) only when the probed fps is 0. Layer 5 gains
  MediaRecorder-fixture cases for burn-in, PiP and mux-with-cut
  (IMG-PREC: mandatory). (2) [MED] the portable exe ships
  ~275 MiB of dead ffprobe binaries (six platforms bundled;
  x64-win only loadable; measured: win-unpacked 706 MiB,
  ffprobe-static 336 MiB) plus four dependencies nothing imports
  (fluent-ffmpeg, pdf-lib, music-metadata, file-type) — add
  `files` excludes for ffprobe-static's darwin/linux/win32-ia32
  bins in electron-builder.yml and REMOVE the four dependencies
  (package.json may be edited for exactly these removals plus
  the lockfile, nothing else); this directly shrinks (ai)'s
  every-launch unpack; the win32 release run re-confirms
  `ffprobePath` resolves. (3) the webcam fallback branch
  (RecordStudio): when the camera or compositor fails, stop
  `camStream` and null its ref in the catch (QA measured the
  track "live" the whole take — camera light on during a
  screen-only recording), start the catch with the
  `leftWhileStarting` teardown its sibling awaits have, and gate
  the thumbnail `<video>` on a camera actually in the take (an
  empty accent-bordered box renders today; three reviewers). (4)
  Timeline ←/→/,/. read the store's lagging playhead during
  playback (QA's scratch E2E measured `.` stepping −0.151 s and
  → moving +0.053 s) — base all four on
  `playheadNow(useVideoStore.getState())` like I/O. (5)
  `validateClipRequiredFields` accepts a clip with no
  `textOverlays`, and Restore then crashes the studio (QA
  executed it; the T-119 docblock's "read with a default" is
  false for `textOverlays` — videoStore:275/579/594/607,
  TextOverlayEditor, filters.ts:521 all read it bare) — require
  `Array.isArray(textOverlays)` (red: QA's shape), and correct
  the docblock. (6) `audioCloseMessage` claims discards that do
  not exist: `secondaryTrack !== null` is true for the absent
  back-compat shape ("The second track will be discarded" with
  no second track), and `chainDiffersFromDefault` JSON-compares
  absent optional fields against the default ("your cleanup
  settings" on untouched audio) — use `!= null` and
  `chain[key] ?? DEFAULT_CHAIN_SPEC[key]`, with absent-shape
  tests. (7) `sanitizeFilename` and the chat-log username class
  are ASCII-`\w`: "Épico clutch" becomes `pico_clutch`, a Korean
  clip name becomes `clip`, and CJK/Cyrillic chat lines are
  dropped from the spike count — use `\p{L}\p{N}` with the `u`
  flag in both, non-ASCII test cases, and the "strips ALL
  non-alphanumeric" docstring made true. (8) the new BAD_CUT
  refusal says "Click its tag to undo it" where the product says
  "mark" (WaveformView hint, tutorial, USER_GUIDE) — say "mark",
  and align HotkeyOverlay's pre-wave "Click cut tag" row (one
  name per concept). Docs (verify every cite against the FINAL
  tree): (9) FOR_MIKE:56 "Every studio auto-runs a guided tour
  the first time you visit" — Record has none and the others
  wait for content (USER_GUIDE:72-76 is the true account); (10)
  README:103 "Optionally enable webcam preview" — the checkbox
  puts the webcam IN the recording; (11) STYLE_GUIDE:395 names
  the deleted `[hasItems]` key — say `[items]`; (12)
  STYLE_GUIDE:384-390 states the pre-T-120 Timeline behavior
  ("at the store's playhead", no Space) and :586-589's "one
  reading" bullet — reconcile both with the post-(4) truth; (13)
  PRODUCT_GUIDE:75 "model auto-installed on first use" — it
  downloads on request from the Captions panel button; (14)
  HOW_IMAGII_WAS_MADE:258's trailing generator-credit line
  (names a local `~/.claude` path; BRANDING bars generator
  credits in any artifact) — delete it; (15) "within 2 levels"
  for the retag-only claim is a REGRESSION of round 69's own
  correction — measured max 3 (bt709) and up to 4 (bt2020nc, one
  run) — write the measured figures and NAME the fixture at
  filters.ts:388-389, STYLE_GUIDE:563-564, IC:2861; (16)
  convert.ts:124 "(the default wrote 51)" is true of flv and wmv
  only (mpg wrote 50); (17) "compiled without libfreetype" is
  false on the real binary (expediter ran -buildconf:
  libfreetype IS enabled; the missing drawtext dep is
  libharfbuzz) — fix filters.ts:290 and the three test comments;
  (18) release.yml:32's ceiling rationale still says the media
  suite takes "~90 s" (it is ~6.3 min) — comment text only; (19)
  "instant" for the WebM save (RecordStudio:817, USER_GUIDE:111)
  contradicts the remux and the second-copy sentence — say
  "quick", and check BRANDING's "instant" exemplar stays
  truthful; (20) 8 Mbps is overclaimed: the code comment calls it
  "the figure the export presets already aim at" (only YouTube
  is 8M) and USER_GUIDE says recordings "are made at 8 Mbps" (a
  ceiling; 2.56 measured on a synthetic) — "up to 8 Mbps" / "the
  top preset"; (21) three stale pre-wave IC cites beside rows
  round 70 fixed: IC:29 (`Canvas.tsx:360`→:383), IC:148
  (`ExportDialog.tsx:77-89`→:197-224), IC:207
  (`Welcome.tsx:43`→:44); (22) DESIGN_GUIDE:242 says the export
  scale is "floor(devicePixelRatio)" — the code is ≥2.5→3,
  ≥1.75→2, else 1 — state the real mapping. Ledgered with the
  round, not fixed: older-build WebM takes still refuse with the
  re-export sentence (the remux fixes new saves only); the
  converted take's H.264 level 6.1 (plays in Chromium; a win32
  hand-check for other decoders); HEVC/ProRes "should work" and
  the possibly-raised YouTube thumbnail cap join the owner
  report's hand-check list.
- **Acceptance criteria:** red-first with discrimination for every
  behavior item (1-8): break it, watch the NAMED test fail,
  restore byte-identical with sha256 pairs. For (1) the three
  Layer 5 MediaRecorder cases are the reds (the mux-with-cut red
  is the 0.07 s collapse) and the existing steady-rate cut cases
  must stay green; a one-off 6.1.1 run via the alias config
  transcripts the class. For (2) the gates prove nothing needed
  the removed dependencies, and a `--win dir` or equivalent
  packaging probe shows ffprobe-static reduced to win32-x64. For
  (5) QA's clip shape is the red fixture. Every re-pointed cite
  verified against the FINAL tree; `npm run verify`, `npm run
  test:media` and the touched Playwright specs green, full stack
  at the expediter's gate; the worker runs the FULL Playwright
  suite itself before handback.
- **Status:** done (round 71 — see Done)

---

## T-122 — review-gate fixes, sweep-11 findings (round 72)

- **Spec:** the nine reviewers' eleventh pass (2026-10-14; every
  item expediter-verified; the ffmpeg and QA items carry executed
  real-binary evidence from the reviewers themselves). Code: (1)
  the cut re-attach gets `-enc_time_base:v filter` beside
  `-fps_mode passthrough` in `runAudioMux`'s re-encode branch
  (process.ts:428-429). On the shipped win32 major (6.1.1), a
  constant-rate source (an OBS mp4/mkv — the common case) gets an
  encoder time base of 1/fps, every retimed PTS is rounded to the
  frame grid, and a cut whose length is not a whole number of
  frames lands the first survivor on the frame before it:
  reproduced with the exact argv (24 fps ramp, cuts 3.3-5.7 and
  8.0-9.2) — ffprobe reads `pts_time` 3.291667 TWICE, stderr says
  "non-strictly-monotonic PTS" and "Non-monotonic DTS ... may
  result in incorrect timestamps", and through the real
  `runAudioMux` (30 fps, 3 non-aligned cuts) 6.1.1 writes 1
  duplicate-pts pair where 7.0.2 writes 0. The fix is verified on
  BOTH majors (6.1.1 exact times, no warning; 7.0.2 accepts it).
  Layer 5 gains a non-frame-aligned-cut case on a constant-rate
  source asserting no duplicate `pts_time` (IMG-PREC: mandatory);
  it cannot go red on 7.0.2 (exact there either way), so the red
  transcript is the 6.1.1 run via the alias-config pattern, PLUS
  a unit argv pin (option beside passthrough) that reds anywhere.
  With it, four claim sites in the same region: chain.ts:100-105
  "in step to the sample" — `aselect` drops whole 1024-sample
  audio frames (~21.3 ms; T-110(i)'s own sigma), so say "to
  within one audio frame (about 21 ms)"; process.ts:330-331
  "equal by construction" → "the same frames, to within one audio
  frame"; process.ts:419-424's "forces 25 fps CFR" warning claim
  is 7.0.x-only (on 6.1.1 a 60 fps source stays 60/1 with no
  warning — QA measured both) — scope it; media.spec.ts:4320-4322
  and TESTING.md:710-711 claim "7.0.2 does not write
  DefaultDuration" — false: QA ran the fixture recipe on both
  majors and BOTH write element 23 E3 83 (the unpatched pipe
  output reads 30/1 on both; the Void patch is what makes it
  1000/1) — say both majors write it and the patch is needed on
  both. (2) `{handle}` is the last ASCII sanitizer:
  filename.ts:43 `[^A-Za-z0-9_]` empties a non-Latin handle
  ("@토끼" → "") — the exact class T-121 (7) closed for names —
  use `/[^\p{L}\p{M}\p{N}_]/gu` (dots still stripped:
  "my.handle" → "myhandle" stays), with Hangul and
  decomposed-accent cases; there is no `{handle}` test at all
  today. (3) Clip Kit on a blank-named clip fails AFTER the
  folder pick with the bare "Clip Kit failed": the rename field
  accepts "" and ClipKitButton.tsx:121-124 passes raw `clip.name`
  into video.ts's hard `assertNonEmptyString` before any
  sanitizer runs — hoist the existing `safeName =
  sanitizeFilename(clip.name)` (line ~130) above `makeKitDir` and
  pass it as `clipName` (its 'clip' fallback satisfies the gate);
  keep the main-side gates — they are trust-boundary validation.
  Red: blank-name kit E2E beside video-pipelines' kit case. (4)
  the Second-track footer "This track dips whenever you talk"
  (SecondaryTrackPanel.tsx:187-190) is unconditional while
  "Second mic" defaults Duck OFF and no `sidechaincompress` is
  built — render it only when `secondary.duckUnderPrimary` (the
  tutorial step is already correctly conditional; the in-app
  promise must match what the export does). Red: footer
  absent-with-Duck-off assertion. (5) a camera held by another
  app (OBS — the streamer's common case) probes as unavailable
  and the empty-list hint names only two recoveries ("Plug one
  in, or allow camera access in Windows privacy settings") while
  the probe's own comment says the hint "names the recoveries" —
  add "close any other app using it" to `noDeviceHint`
  (devices.ts:128-133) and the Start-path parity holds
  (userFacingError.ts:112 already says it); unit copy pin. (6)
  the no-emoji guard has an unguarded directory:
  scripts/check-emoji.mjs ROOTS is renderer/main/shared — add
  `src/preload`, and prove discrimination (emoji into preload →
  script fails → restore); STYLE_GUIDE:37 misnames the hook
  ("PreToolUse/Stop" — it is PostToolUse on Edit|Write|MultiEdit)
  and STYLE_GUIDE:646-648 cites a local `~/.claude/...` path (the
  class T-121 (14) deleted) — fix the claim, delete the
  parenthetical. Docs (verify every cite against the FINAL
  tree): (7) the sanitizeFilename docstring and LESSONS:62
  overclaim marks: the regex also lets a mark ride on `_` and `-`
  (executed: `a_️b` keeps U+FE0F) — say "letter, number, `_` or
  `-`"; the regex itself stays (harmless, and tightening risks
  shipped names for zero user value). (8) the four exe-size
  figures are mutually inconsistent AND predate round 71's
  −275 MiB: README:34 (~169 MB), README:55 (~166 MB),
  USER_GUIDE:15 and release.yml:73 (~170 MB) — go number-free
  ("a single portable exe") until the release run measures the
  real one (electron's compression estimate: 55-65 MB smaller).
  (9) BRANDING name-table violations in user-facing docs:
  README:118 "posting diary" → "Posting log" and "title
  patterns" → "Title starters"; FOR_MIKE:23 "Auto-highlight
  finder" → "Smart highlight finder"; FOR_MIKE:31 "title pattern
  suggester" likewise; README:104 and FOR_MIKE:15 "● Start" →
  the real button, "Start recording" (RecordStudio.tsx:845).
  (10) the stale-cite batch beside the ones T-121 fixed (all
  identical in origin/main): ExportDialog.tsx:121
  (Canvas.tsx:168 → the stage fit at :175-189); image.spec.ts:44
  (:360 → :383), :52/:1805/:1932 (:168/:168-174/:167 → :175-189
  and the 4× cap at :184), :1049 (:230 → the 4 px floor at
  :247), :1095 (:153-156 → snap at :170-173), :1671 (:41 →
  `useImage` :49), :1039 (canvasStore.ts:285 → :325). (11) the
  duration figures disagree three ways:
  vitest.integration.config.ts:5-6 still says verify is
  "~10-second" and media "~1-2 minutes" against TESTING.md:507's
  ~6.8 min and release.yml:32's "roughly six" (measured this
  window: unit 137 files/3751 tests at ~80 s wall, media
  ~8-9 min under load) — keep ONE current figure in TESTING.md
  and make the config comment point there; TESTING.md:227, :273
  and :275 small figures likewise. (12) TESTING.md's heading
  ":505" says "Layer 2.5" while CLAUDE.md, IMG-PREC, STYLE_GUIDE
  and TESTING's own body say "Layer 5" — fix the heading. (13)
  STYLE_GUIDE:384-387 attributes Home/End to the Player; only
  Timeline.tsx:145-150 handles them — say they are the slider's
  own keys. (14) IC:219 names an AutosaveRestore control
  "Discard" that T-92 renamed Clear (AutosaveRestore.tsx:204-218
  has Restore/Clear/Later; the comment at :135-137 records the
  rename) — fix the row. Ledgered with the round, not fixed: the
  reframe Left/Right geometry (Left starts at x=196 on 1920 —
  not the edge) and the overlay/watermark fonts' missing CJK
  coverage are design/capability calls that join the owner
  report's hand-check list; the mic-processing question is
  letter (ak); the single-instance lock is (al); the image-layer
  `src` mechanism extends (g); locale paks extend (ai).
- **Acceptance criteria:** red-first with discrimination for every
  behavior item (1-6): break it, watch the NAMED test fail,
  restore byte-identical with sha256 pairs. For (1) the unit argv
  pin reds on any box and the Layer 5 case's red is transcripted
  on the 6.1.1 alias config (the shipped major is where the
  defect lives); every existing cut/re-attach/MediaRecorder case
  stays green on BOTH majors. Each fixed behavior bug (1-6) gets
  its LESSONS_LEARNED entry; IC ledger rows updated for the
  touched elements (kit button, duck footer, device hint). Every
  re-pointed cite verified against the FINAL tree, not this
  ticket's line numbers. `npm run verify`, `npm run test:media`
  and the full Playwright suite green before handback; no
  package.json or docs/TICKETS.md edits.
- **Status:** done (round 72 — see Done)

---

## T-123 — review-gate fixes, sweep-12 findings (round 73)

- **Spec:** the nine reviewers' twelfth pass (2026-10-14; every
  item expediter-verified, the measured ones replicated on the
  real binaries or in the built app). Code, behavior: (1) [MED]
  closing the window mid-job can raise Electron's blocking
  "JavaScript error in the main process" dialog (reproduced 3/40
  real closes mid-export; the WebContents dies 1-106 ms before
  before-quit kills the child, and an already-read stdout chunk
  still dispatches): every job-progress callback is a bare
  `e.sender.send(...)` / `win.webContents.send(...)` —
  video.ts:233/236/306/320, captions.ts:72/87/164,
  audio.ts:164/174, recording.ts:211 (grep for any sibling) —
  and src/main has no `uncaughtException` handler while
  index.ts:55 already guards this class for bounds. One
  `sendIfAlive(sender, channel, payload)` (isDestroyed +
  try/catch) at every site, plus a destroyed-sender regression
  test. (2) [MED] every window-level key guard stands down for
  ANY `INPUT`, so after a checkbox tick or slider drag the
  focused control eats Ctrl+Z/Ctrl+Y (`undoRedoIntent`,
  useUndoRedoHotkeys.ts:31), `?` (HotkeyOverlay.tsx:96), the
  canvas tool keys and Delete (ImageStudio.tsx:54-55) and the
  Player keys (Player.tsx:263) — dead against the overlay's and
  hint lines' own promises (found independently by UX and a11y).
  Fix: lift videoStore.ts's RELEASE_ON_POINTER_UP non-text type
  set (:659-669) to a shared module (videoStore imports it back)
  and a shared `isTextEntryTarget(tagName, inputType)`; stand
  down only for TEXTAREA, SELECT (T-119 type-ahead, ImageStudio)
  and text-like INPUT types, with native-ownership carve-outs: a
  focused `range` keeps ArrowLeft/Right/Up/Down/Home/End, a
  focused checkbox/radio keeps Space (Player already does this
  for BUTTON). `undoRedoIntent` gains `inputType`. Reds: unit
  cases with inputType 'checkbox'/'range', and E2Es "tick Hum
  removal then Ctrl+Z undoes it", "tick Snap then R switches
  tool". T-78 (per-tick slider undo) stays open and ledgered.
  (3) [MED] the TextOverlayEditor Time fields rewrite the
  controlled value to "N.00" per keystroke (`value={...toFixed(2)}`
  + `Number(...) || 0` + a per-keystroke End clamp) — typing
  "12" gives 1.00 (executed with real keys) — while `DraftField`,
  T-113's fix for Size/Color, sits in the SAME file: use it for
  both Time fields and clamp `endSec >= startSec` at commit.
  (4) seven more number inputs snap an emptied field to a
  default so typed digits append ("600" in PiP width gave
  360600, then a bare "Picture-in-picture failed." upstream):
  PipPanel.tsx:113, ChatHighlightPanel.tsx:133,
  CustomPresetManager.tsx:171/:181/:192, Toolbar.tsx:92,
  PropertiesPanel.tsx:176 — lift `DraftField` to
  src/renderer/src/components/ and use it at all seven (and
  item 3's two), committing on blur with each site's clamp.
  (5) a recording that stops ITSELF (captured window closed —
  every track ends) runs the whole save under a live "REC"
  screen with a dead Stop button: only user-initiated
  `stopRecording` sets phase 'saving' (RecordStudio.tsx:485-491)
  while `onstop` → `finalizeRecording` never does (:459-461) —
  set the phase at the top of `finalizeRecording` (idempotent
  for the normal path); E2E: end all tracks, assert the saving
  card and no REC. (6) `recording:begin`'s session cap is
  check-then-await-then-insert (recording.ts:324-354), so 12
  CONCURRENT begins all passed a cap sequential calls enforce —
  reserve the slot synchronously before the first await and
  release it on failure; the sweep's concurrent unit test is the
  red. (7) a drag that starts inside any Modal and releases on
  the scrim closes the dialog (Chromium dispatches click to the
  common ancestor; Modal.tsx:131-136 has no mousedown check) —
  NameDialog discards a typed name that way: record the
  mousedown target and close only when both mousedown and click
  landed on the scrim; E2E: mousedown in the card, mouseup on
  the scrim, dialog stays and the text survives. (8) the five
  output-folder buttons' accessible name is just the folder
  basename ("Videos, button") — OutputDirLabel.tsx renders icon
  + basename only: add an sr-only "Output folder:" prefix inside
  OutputDirLabel; name assertion test. (9) a single "Save" on a
  thumbnail variant gives no feedback on success
  (ThumbnailVariants.tsx:184-194 discards `image.save`'s result
  while saveAll and Export both toast): toast "Saved <name>"
  only when the result is non-null (null is cancel); E2E.
  (10) the single-track audio export has NO peak stage when
  Even volume is off, while the mix bus "always ends in a stage
  that answers for its peaks" (process.ts:34 comment): +12 dB
  Manual gain on a −2 dBFS source exports at 0.0 dBFS with flat
  factor 32.7 (expediter-replicated; the app previews only the
  unprocessed source so nothing warns) — append MIX_LIMITER (the
  same constant) to the single-track `-af` chain when
  `!spec.loudnorm` AND the chain is non-empty (a bare 'anull'
  pass-through stays untouched); Layer 5 red: the hot +12 dB
  fixture clips today, peaks ≤ −0.9 dBFS after; disclose the
  −1 dBFS ceiling where the Levels copy lives. (11) a mono
  source normalized by Even volume lands ~3 LU hotter than its
  label on every stereo playback (R128 dual-mono;
  expediter-replicated: −13.0 LUFS on the dualmono meter against
  the −16 label; `dual_mono=true` reads −16.0): plumb a
  `dualMono` flag into `loudnormFilter`/`buildChain` from the
  export's existing `probeAudio` (channels === 1) and append
  `:dual_mono=true` to BOTH passes; unit string pins + a Layer 5
  mono case measured with `ebur128=dualmono=true`. (12) the
  T-122 seam fix does not reach AVI sources (a
  NATIVE_VIDEO_EXTENSIONS member): an AVI's stream time base is
  1/fps, so `setpts` ITSELF rounds the retimed stamp onto the
  frame grid before the encoder is involved
  (expediter-replicated: the first survivor lands at 3.2917
  instead of 3.3083; `settb=AVTB` ahead of setpts gives
  3.308332 exactly) — add `settb=AVTB` between `select` and
  `setpts` in `vselectForCuts`; chain.test.ts pins updated
  red-first, and a Layer 5 AVI (mpeg4) fixture with the
  non-frame-aligned cuts — THIS red shows on the bundled 7.0.2
  too (the sweep measured identical dupes on both majors), plus
  the existing mp4 ramp cases stay exact (the sweep measured
  394/394 unchanged under settb). (13) a validator-accepted
  crop that overshoots the frame by ≥2 px fails the whole
  export with no output ("Invalid too big or non positive size",
  expediter-replicated): Chromium reports offsetWidth 800 in a
  799.5 px parent (ratio 1.000625), validators.ts accepts up to
  1.01, and `manualCropRegion` (filters.ts:131-143) never clamps
  — clamp the scaled region so x+w ≤ source width and y+h ≤
  source height (then the existing even()); unit cases at the
  measured ratios and a Layer 5 case: w=800/799.5 on a 3840x2160
  source fails today, exports clean after; Compile/GIF/Kit share
  `cropToFrame` so the one clamp covers them. (14) Audio
  Studio's waveform dies silently on big or undecodable files
  (WaveformView.tsx:49-62: `WaveSurfer.create({url})`, no error
  listener anywhere; measured 3.25 GB RSS for a 1 h WAV, an
  ADPCM WAV leaves a dead panel with no message): add
  `ws.on('error')` → a finished-sentence toast, and refuse
  sources longer than 2 hours at load with a finished sentence
  naming the ceiling and why, marked `// simplification:` naming
  the T-110(ao) peaks upgrade; unit for the gate, E2E or unit
  for the error path. (15) no `render-process-gone` handler
  anywhere (a crashed renderer leaves a live-looking dead
  window; the sweep proved `reload()` recovers to Home where
  AutosaveRestore lives): add a once-guarded handler on the main
  window that logs and reloads; E2E via forcefullyCrashRenderer
  (T-35 precedent). (16) "Save .srt" always copies the WHOLE
  recording's transcript on the source clock
  (captions:saveSrt → copyFile) but sits directly under "Burn
  captions over selected clip range only" with no qualifier —
  make the scope explicit at the button (label or adjacent hint
  per BRANDING voice); the range-aware save via the existing
  `writeKitSrt` shift is the ledgered upgrade. (17) the Posting
  log has no Facebook chip though the kit writes
  `*_facebook.mp4` (PostChecklist.tsx:254) — add Facebook to the
  array and the E2E data (video-pipelines ~:5124). (18) the
  Reframe saved-toast offers no next step while Record's
  identical moment offers "Edit in Video Studio"
  (ReframePanel.tsx:90) and the captioned-vertical route
  (reframe → reopen the 9:16 → transcribe → burn) is nowhere
  stated: add the same toast action through the same
  ask-before-replace bridge, one USER_GUIDE sentence giving the
  order, E2E + IC row. (19) the privacy disclosure for letter
  (am): extend USER_GUIDE's "Where your data lives" (~:25-27)
  and the Clear-thumbnail paragraph (~:425-429) with one
  sentence each saying Windows' own browser cache under
  `%APPDATA%\imagii` can keep copies of fetched search images
  that the Clear button does not touch (deleting the folder
  clears everything, as README already says). Docs and claims
  (verify every cite against the FINAL tree): (20) the cut-seam
  comments STILL read as a whole-file bound (chain.ts:103-105,
  process.ts:330-333): say the bound is PER CUT and additive —
  "at each cut, picture and sound agree to within one audio
  frame (about 21 ms); the errors add up over several cuts
  (T-110(i))". (21) FOR_MIKE:38 "pipes a clip through here" —
  Clean audio extracts the WHOLE video's audio
  (VideoStudio.tsx:82): say "a video's audio". (22)
  BRANDING_GUIDE:75-76's own example quotes the retired name
  ("Duck under primary") that tutorialCopy.test.ts forbids — use
  "Duck under your voice". (23) autosave-banner drift: README:95
  and FOR_MIKE:51 quote a banner string that does not exist and
  say it appears only after a crash (the real banner reads
  "imagii autosaved your work {N} min ago. Want to pick up where
  you left off?" with Restore/Clear/Later, and it also appears
  after a clean quit — index.ts takes a closing snapshot);
  USER_GUIDE:421 "your saved collections" and :313 "four title
  ideas" are BRANDING never-say terms (say saved boards / title
  drafts). (24) [HIGH, layout] the Properties Rotation row (w-16
  label + w-20 input + seven no-wrap preset buttons, 406 px) is
  clipped behind a hidden horizontal scrollbar at EVERY window
  size in the clamp(260px,16%,380px) column — only "0" and "15"
  visible at the 1632x918 default (screenshot-verified) though
  README/FOR_MIKE promise the presets: let the row wrap
  (flex-wrap) so all presets fit the clamp MINIMUM, and add the
  shared E2E no-horizontal-overflow assertion (red against
  pre-fix bytes at the default window; the suite's
  scroll-into-view is why ten sweeps missed this). (25) the
  denoise strength row (CleanupPanel.tsx:44-58 grid-cols-5)
  clips its own labels ("Aggress" at the default window,
  screenshot-verified): wrap or auto-fit so every label renders
  whole at the 1024 px minimum; overflow assertion. (26) each
  Posting-log row's three w-16 stat inputs (337 px) overflow the
  274 px list pushing "comments" off-screen
  (PostChecklist.tsx:283-310): wrap; overflow assertion. (27)
  the Platform and Power-line selects lack `min-w-0` and poke
  past the card edge (LevelsPanel.tsx:154-158,
  CleanupPanel.tsx:113-118): add it; assertion. (28) README:167
  "The preview downsamples to 2048 px" — nothing does (the only
  cap is the 800 px PLACED size, ImportPanel.tsx; originals stay
  full size in memory): state the truth. (29) DESIGN_GUIDE's
  raw-color exception list is incomplete: add the four
  `bg-black`/`bg-black/60` uses (Player.tsx:315,
  RecordStudio.tsx:859, MoodBoardPanel.tsx:231,
  ReferencePanel.tsx:136) and rows for the JS-only CHECKER_A/B
  tokens (tokens.ts:116-117; note why they have no tailwind
  mirror and that designTokensInSync exempts JS-only tokens).
  (30) the emoji guard reads only .ts/.tsx (executed: an emoji
  in src/renderer/index.html passed silently) while the
  round-72 claims say every directory is covered: scan .html
  and .css under the ROOTS too, extend emojiGuard.test.ts, redo
  the discrimination run, and soften/fix the STYLE_GUIDE:37-43
  and test-header claims. (31) playwright.config.ts:29 ("~4 min
  instead of ~2.7") and video-pipelines.spec.ts:100 ("~70 s")
  contradict the TESTING.md timing table T-122 made the single
  source: point both comments at the table. (32)
  image.spec.ts:1675 cites ImportPanel.tsx:70 for the 800 px cap
  (it is :71) — re-point, and re-verify the neighbors. (33)
  MoodBoardPanel.tsx:177's tooltip "Drop the on-disk thumbnail
  cache" uses the app's drag-drop verb where the button and
  BRANDING say Clear: say "Clear ...". (34) BRANDING:167 and
  STYLE_GUIDE:72 claim toasts default to 2 s — react-hot-toast
  2.6.0 defaults are success 2 s but plain/error 4 s and
  AppToaster sets none: state the real values (verify against
  the installed library). Ledgered with the round, not fixed:
  SAR geometry extends (h); renderer-deps-in-asar extends (ai);
  the primary-gain cancellation extends (ag); the waveform peaks
  pipeline is new (ao); the Chromium-cache clear-vs-no-store
  call is new (am); the 9:16 watermark inset is new (an);
  `validateExportJob` not gating `outputFilename` (renderer
  sanitizes; defense-in-depth) is noted; kit MAX_PATH on long
  names and whisper.cpp's win32 ANSI argv join the owner
  hand-check list.
- **Acceptance criteria:** red-first with discrimination for
  every behavior item (1-18): break it (or run against pre-fix
  bytes), watch the NAMED test fail, restore byte-identical with
  sha256 pairs. The sweep's scratch specs under scratchpad
  s12/qa/ (overlay, rec, cap) are starting points — adapt, do
  not trust. IMG-PREC: items 10, 11, 12, 13 each land a real
  Layer 5 case (the AVI case must red on the BUNDLED 7.0.2;
  10/11/13's reds are measured properties of real output; run
  the touched blocks on the distro 6.1.1 too via the alias
  pattern and transcript it). Layout items 24-27 get the shared
  no-overflow E2E helper asserting at the default 1632x918
  window, red against the pre-fix bytes. Each fixed behavior bug
  gets its LESSONS entry; IC rows updated for every touched
  element; TESTING counts and the timing table refreshed; all
  cites verified against the FINAL tree, never this ticket's
  line numbers. `npm run verify`, `npm run test:media` and the
  FULL Playwright suite green before handback; no package.json,
  package-lock.json or docs/TICKETS.md edits.
- **Status:** done (round 73 — see Done)

---

## T-124 — review-gate fixes, sweep-13 findings (round 74)

- **Spec:** the nine reviewers' thirteenth pass (2026-10-14; every
  item expediter-verified; the executed ones replicated or
  screenshot/transcript-checked). Behavior: (1) [MED] the
  recorder never hears a track END — `combined` is screen video
  + mic audio, MediaRecorder stops only when ALL tracks end, and
  nothing listens for `ended` (RecordStudio ~:338-410): with the
  default mic ON, a crashed game or closed captured window
  leaves REC counting over a frozen frame, against USER_GUIDE's
  "ends on its own and saves" — listen for `ended` on every
  captured VIDEO track (screen path and the compositor's base
  tracks) and call `stopRecording()`; E2E red with the mic ON.
  (2) [MED] `rendererRecovery`'s reload keeps the hash
  (index.ts:189 `webContents.reload()`), so a crash in a studio
  reloads INTO the dead studio where no AutosaveRestore mounts
  (executed: `#/audio` before and after, banner false; the log
  even says "reloading to Home.") — load the entry URL fresh
  (the same loader createWindow uses) and fix USER_GUIDE:471's
  claim; E2E crashing from a studio route asserts `#/home` +
  banner. (3) the recovery reload also STRANDS recording
  sessions (executed: four orphaned fds/webms, then
  "recording:begin too many open sessions") — on the reload
  branch, abandon sessions not yet `closed` (leave mid-finalize
  alone); unit red via the session registry. (4)
  `persistWindowBounds` is the one unguarded sync config write
  left in main: a held config.json (executed via chattr:
  EPERM) raises the blocking error dialog from the debounce
  timer AND breaks the close handler before the quit snapshot —
  wrap the body in try/catch + console.warn; destroyed-store
  unit red. (5) [MED] the autosave banner shows on EVERY Home
  visit mid-session (AutosaveRestore gates on file freshness
  alone; `dismissed` is component state; Restore applies over
  the LIVE session with no confirm, wiping undo histories) while
  README/USER_GUIDE say it appears on launch and after a crash —
  gate the banner on "the session holds no work" (the stores'
  own emptiness notion; projectValidation already refuses empty
  snapshots main-side), which preserves launch and crash-reload
  (stores empty after (2)) and kills the mid-session offer; E2E
  reds: edit → Home → no banner; the studio-crash E2E from (2)
  still shows it. (6) [MED] Clean audio / a video dropped on the
  Audio importer EXTRACTS THE WHOLE SOUND before the 2 h gate
  refuses (a 4 h VOD ≈ minutes + a ~2.8 GB WAV orphaned in
  %TEMP%\imagii-audio; the handler drops `cleanup`) — probe
  duration in `audio:extractFromVideo` and throw
  `waveformCeilingRefusal(duration)` BEFORE spawning ffmpeg, and
  short-circuit in VideoStudio's cleanAudioFlow where
  `source.probe.duration` is already in hand; red: a long video
  is refused with no imagii-audio file appearing. (7) the
  refusal sentence tells an AUDIO-ONLY file to go to Video
  Studio, which rejects it right back ("no picture, only sound —
  open it in Audio Studio instead") — make
  `waveformCeilingRefusal` kind-aware: the Video Studio remedy
  only for video sources; an honest external-split sentence for
  audio-only; pins updated red-first. (8) [MED] image layers
  NEVER get transformer handles: Canvas.tsx:307 passes
  `shapeRef={{...ref, current: ...}}` — a fresh object whose
  writes never reach `nodeRefs` (executed: Transformer.nodes()
  = 0; no Properties width/height either, so images cannot be
  resized at all; in a mixed doc the Transformer sticks to the
  previous node) — wire the real ref like the other layer types.
  (9) [MED] draw a shape then press Select: no handles — the
  attach effect deps are `[selectedLayerId, doc.layers]` with no
  `tool`, and the Transformer mounts only under select — add the
  dependency (or re-attach on mount). (10) [MED] releasing
  OUTSIDE the stage mid-draw loses the shape and leaves the
  dashed preview following the cursor (onMouseUp only on Stage)
  — finish the draw on a window/pointer-capture mouseup. (11)
  [MED] the Line tool refuses horizontal and vertical lines
  (`absW > 4 && absH > 4` gates every tool; snap makes dy=0
  certain) — gate lines on LENGTH (max(absW,absH) or hypot > 4).
  (12) [MED] layer names no longer truncate (T-114's span→button
  regression: the `truncate` span inside the column-flex button
  keeps max-content width; executed: "Rectangle" paints 22 px
  over "Move layer up" at 1024) — `w-full`/`overflow-hidden` on
  the span (the executed fix), and the "hint — won't export" tag
  stops triple-wrapping. (13) a LOCKED layer still resizes and
  rotates through the Transformer (draggable honors lock, the
  Transformer does not; executed scaleX 1→2.85) — do not attach
  (or disable resize/rotate) for locked layers. (14) Snap
  ignores image layers (ImageNode.onDragEnd never calls
  `snap()`; executed: text lands (200,150), image (115.2,94.3))
  — snap it. (15) the LAST per-keystroke number boxes:
  PropertiesPanel x/y/rotation EAT THE MINUS SIGN ("-50" → 50,
  "-15" → +15) and TextOverlayEditor's overlay x/y turn ".5"
  and ".25" into 1 (executed) — DraftField with per-site clamps
  (negatives and leading decimals legal). (16) [MED] Reframe
  ignores the selected clip's CROP and SPEED (video:reframe
  takes only source/range/side/size) — the T-96/T-105 wrong-file
  class, closed for Compile and GIF, never for Reframe, and the
  captioned-vertical route documents Reframe as its first step —
  pass cropRect and speed through the shared builders
  (cropToFrame + the speed filters) into reframe's graph; Layer
  5 red: a cropped, 2x clip reframed → measured geometry +
  duration. (17) Reframe and GIF output names start from the
  SCRATCH basename (`stream-aB3dE5fG_reframe-...`;
  video.ts:291 `path.parse(params.sourcePath).name`) — derive
  from the source's display name the way Export does (plumb
  `source.fileName`). (18) the overlay Time fields are
  source-absolute with a bare "Time" label, and a window that
  misses the clip exports NOTHING silently (filters.ts says
  "never matches") — label them as in-the-source time and show
  an inline warning when [start,end) does not intersect the
  selected clip's range; unit/E2E red. (19) the no-live-preview
  disclosures BRANDING:137-138 requires (the ColorGrade
  exemplar) are missing everywhere else they are due: one line
  in the Audio side column + the Fix-Wizard Apply toast wording
  ("applied when you export"), one under clip Speed (the Player
  always plays 1x; no playbackRate anywhere), one in the overlay
  editor (nothing previews overlays) — add them, pinned. (20)
  the re-attach (mux) export toast is a dead end while Video
  Studio still holds the UNCLEANED original (Clip Kit then
  exports noisy sound) — `toastSaved` with the same "Edit in
  Video Studio" action via `useEditInVideoStudio` on the MUX
  output only (not audio-only exports), + one USER_GUIDE
  sentence on the clean-then-clip order + E2E + IC row. (21)
  GIF, Compile, Reframe and PiP never seed their output folder
  (each asks again every studio visit) while Export and Clip Kit
  seed from settings — same pattern, four settings keys (or one
  shared video key), schema + allowlist + tests. (22) "Save
  .srt"-adjacent count fixes: tests/unit/progressSendsGuarded
  header says "eleven sites" (it is ten over eight channels) and
  PostChecklist.tsx:86's comment says `*_x.mp4` where the kit
  writes `*_twitter.mp4` — correct both. (23) [MED] the Text
  overlays card is visibly broken at the default window
  (screenshot: the Font select (flex-1, no min-w-0) runs under
  "Size"; the w-12 "x / y" label wraps to three lines; the Time
  row overflows its cell by ~41 px; the remove ✕ sits 12 px
  outside the card) — wrap the rows, min-w-0 the select, and add
  the overlay card to tests/e2e/layout.ts. (24) the round-73
  min-w-0 on the Power-line select traded overflow for CLIPPED
  VALUE TEXT ("60 Hz — US,"), and `expectControlsWhole` is
  vacuous for selects (scrollWidth == clientWidth always) —
  shorten the option labels so they fit the clamp minimum, add a
  select-aware check (measure the selected option's text), and
  fix the guide claim. (25) the ParamSlider readout (w-14, no
  shrink guard) compresses to 38 px and "-25 dB" wraps, bouncing
  the row height during a drag — shrink-0 (and whatever width
  the longest readout needs). (26) the new Levels sentence
  "Peaks above −1 dBFS are limited when you export" is
  UNCONDITIONAL but the bare-'anull' pass-through deliberately
  keeps no limiter — reword to its true scope ("When you boost
  or switch something on, ..."), pins updated. (27) the
  waveform-ceiling %TEMP% disclosure: the four round-73 "deleting
  that folder clears everything" sentences (README:181,
  FOR_MIKE:64, USER_GUIDE:29-30 and :451) are false for the
  %TEMP% working copies (imagii-audio full-length WAVs,
  imagii-import transcodes carrying the user's filename,
  imagii-concat; reaped only 6 h+ at a LATER launch) — say
  "clears everything imagii keeps there" + one sentence naming
  the three folders and the next-launch prune; docClaims pin.
  (28) a source-scan unit test pins the THREE sanctioned network
  destinations against an allowlist (every `net.fetch`/
  `net.request`/renderer remote-load site), so CLAUDE.md's "a
  single phone-home is a bug" fails `npm run verify` instead of
  relying on sweep vigilance. (29) bare-letter shortcuts fire on
  MODIFIED chords: ImageStudio computes `ctrl` and only `v`
  honors it (Ctrl+R/O/L/P switch tools), and Timeline/Player
  read no modifier at all (Ctrl+O sets an Out point and
  preventDefaults the browser chord) — add `hasChordModifier`
  beside `focusOwnsKey` in keyOwnership.ts and early-return in
  the three handlers; unit pins + E2E red (Ctrl+R over the
  canvas must NOT switch tools). (30) the Rotation preset
  buttons are announced as bare numbers ("45, button") —
  `aria-label={"Rotate N degrees"}` (visible text kept, 2.5.3)
  + E2E locator updates. (31) README's Levels bullet (~:127)
  lacks the peak-limit sentence the T-123 Done entry and
  LESSONS:58 say it carries — add it (making the record true).
  (32) [MED] cut precision is the DECODER BLOCK, not "1024
  samples / about 21 ms": FLAC decodes in 4608-sample blocks
  (96 ms), ALAC 4096, and 7.0.2's WAV demuxer hands 4096 where
  6.1.1 gives 1024 (executed through the real export: per-cut
  errors to −77 ms ALAC / −60 ms FLAC) — put
  `asetnsamples=n=256:p=0,` ahead of `aselect` in
  `aselectForCuts` (executed fix: −1..+3 ms across
  FLAC/WAV/ALAC, identical on both majors; `asetpts=N/SR/TB`
  is sample-indexed so the retime is unaffected), update the
  chain.ts/process.ts claim sites to the 256-sample truth,
  re-derive the T-122/T-123 checker's 0-2 tail-frame allowance
  from the new grid (the sweep's fuzz caught a correct export
  trimming 3 frames under the old 4096 WAV blocks), and land
  FLAC + ALAC cut Layer 5 cases red-first on BOTH majors
  (IMG-PREC). (33) ledger-adjacent doc updates that ride along:
  USER_GUIDE's recorder sentence from (1) if its wording moves,
  and the STYLE_GUIDE/TESTING touches the above imply — verify
  every cite against the FINAL tree. Ledgered with the round,
  not fixed: input-well 1.4.11 boundaries extend (l); derived
  results extend (j); the concat percent extends (c); the
  decoder-block truth corrects (i) (done, expediter); the
  whisper win32 DLL-beside-exe question and the desktop-capture
  frameRate default join the owner hand-check list.
- **Acceptance criteria:** red-first with discrimination for
  every behavior item: break it (or run against pre-fix bytes
  via the r73-style pristine build), watch the NAMED test fail,
  restore byte-identical with sha256 pairs. The sweep's scratch
  specs under scratchpad/s13/ (qa/pw/*.spec.ts for items
  8-15, design/ screenshots for 23-25, electron/ probes for
  2-4) are starting points — adapt, do not trust. IMG-PREC:
  items 16 and 32 each land real Layer 5 cases (32's FLAC/ALAC
  reds on both majors; 16's cropped+2x reframe measured); run
  the touched blocks on the distro 6.1.1 via the alias pattern
  and transcript it. Layout items 23-25 extend
  tests/e2e/layout.ts and its select-aware check, red against
  pre-fix bytes at 1632x918 and 1024x640. Every fixed behavior
  bug gets its LESSONS entry; IC rows for every touched element
  (the canvas items 8-15 revise the Stream Graphics rows);
  TESTING counts + timing table refreshed; all cites verified
  against the FINAL tree, never this ticket's line numbers.
  `npm run verify`, `npm run test:media` and the FULL Playwright
  suite green before handback; no package.json,
  package-lock.json or docs/TICKETS.md edits.
- **Status:** done (round 74 — see Done)

---

## T-125 — review-gate fixes, sweep-14 findings (round 75)

- **Spec:** the nine reviewers' fourteenth pass (2026-10-15; every
  item expediter-verified; the measured ones executed by the
  reviewers through the production functions on both majors, the
  claim items read in source by the expediter). Chain and main:
  (1) [HIGH] Compile's stream-copy join drifts the sound +29.3 ms
  PER JOIN (each AAC segment carries 1024 samples of priming +
  ~8 ms end padding; only the first edit list is honored):
  measured through the real `runConcat` on both majors — the
  beep-minus-flash offsets across 8 segments read 0/30/59/88/118/
  147/176/206 ms, identical on 6.1.1, invisible to duration
  checks — write the intermediate segments as `.mkv` with
  `-c:a pcm_s16le` and encode AAC ONCE at the join
  (`-c:v copy -c:a aac -b:a 192k`; the measured fix: 0 ms at all
  8, durations exact; re-encoding at the join alone still drifts
  8 ms/join; mpegts still segfaults the bundled 7.0.2 — keep that
  pin); Layer 5: a multi-segment beep-vs-flash case red-first on
  BOTH majors (IMG-PREC). (2) [MED] extraction ignores the audio
  stream's START OFFSET, so Clean audio → Re-attach moves the
  sound early by exactly `start_time` (measured: a 0.278 s
  late-audio mp4's burst lands 0.278 s early through the real
  extract→re-attach on both majors; transcription shares the
  extractor so burned captions inherit it) — add
  `-af aresample=async=1:first_pts=0` to the extraction argv
  (measured: the burst lands at container time on both majors,
  and a start-0 file's WAV is SHA-identical to today's); Layer 5
  late-audio case + the byte-identity assertion. (3) [MED] the
  denoise strengths are NOT ordered by noise removed (the carried
  check came back a finding): nf and nr point in opposite
  directions, so on pink/brown "loud fan" noise at −44 dBFS —
  exactly what CleanupPanel sells Aggressive for — Aggressive
  removes 3.6-10.6 dB where Light removes 8.7-12 dB (full matrix
  in the sweep log; quiet-content damage is likewise
  non-monotone) — swap the nf axis so Light/Medium/Aggressive =
  `nf=-35:nr=12` / `nf=-30:nr=18` / `nf=-25:nr=24` (measured
  monotone in removal AND in soft-content cost across all 12
  fixtures); Layer 5: an ordering case (removal(L) < removal(M)
  < removal(A)) on pink noise at −44 dBFS, both majors; the Done
  entry flags the exact numbers as an owner-retunable knob. (4)
  [MED] the pre-extract probe refuses DURATIONLESS containers
  that extraction handled (a MediaRecorder WebM, an older take,
  a crashed MKV; executed by three reviewers with the control
  proving the old flow worked end to end, and the person reads
  the wrong "can't read this audio format" advice) — a probe
  failure other than "No audio stream" means UNKNOWN length:
  fall through to extraction and let `loadSource`'s WAV-side
  gate backstop; unit red (durationless probe → extractor still
  called) + an audio.spec case. (5) the `asetnsamples=n=256`
  grid makes every downstream stage run on 256-sample frames —
  a chained cut export measured 1.7-2.3x slower on both majors —
  append `,asetnsamples=n=4096:p=0` AFTER `asetpts=N/SR/TB`
  (measured bit-identical output, cost removed); comment the
  why, assert the stage order in the unit pins. (6) the audio
  progress denominator is the SOURCE duration while `out_time`
  is the cut output's (a 300 s source with 200 s cut jumps
  33.3% → 100%) — use duration minus the merged cut length in
  both passes (the reframe change got this right; match it).
  (7) [MED] `.aiff`/`.aif`/`.wma` route through
  `audio:extractFromVideo` and are treated as VIDEOS end to end
  (executed: Export defaults "Re-attach to video" and fails on
  `-map 0:v:0`; a >2 h AIFF gets the Video Studio sentence and
  bounces between studios — the T-124 (7) circle these formats
  missed): pass `fromVideoPath` to `loadSource` only when
  `isVideoFilename(filePath)` (keep a separate extracted-from
  marker for display name and project re-extract), choose the
  refusal kind from `isVideoFilename` in the handler too, and
  land a load→export WMA case. (8) [MED] `DraftField`'s live
  commit nulls the draft, so React's string compare rewrites the
  box and typing "0.05" in overlay x commits 1, and rotation
  "-0.5" loses its sign (mechanism traced to the controlled
  value rewrite) — keep the draft while focused (clear on
  blur/Enter only; compare numerically if needed); E2E reds
  "0.05" and "-0.5". (9) [MED] Reframe still drops the clip's
  hook text, grade, Auto-zoom and Hype shake — the round-74
  premise "grade stays out matching Compile" was FALSE (Compile
  passes all four through `buildVideoFilter`; the T-105 lesson
  says the shared builder with a different frame, never another
  subset; the scope error was the EXPEDITER'S direction, not the
  worker's) — build the Reframe picture with `buildVideoFilter`
  at the target frame, swapping only the centered aspect stage
  for the position-aware strip; Layer 5: a reframed clip with a
  grade and an overlay, measured, both majors; the panel copy
  and readout then say the clip's look is used and show the
  crop's size (the readout still reads the uncropped source
  today). (10) [MED] a REMEMBERED output folder that no longer
  exists is seeded and used silently, the failure blames "a file
  imagii needs" (MISSING_FILE match), and Compile burns the full
  segment encode first — while USER_GUIDE:525 already promises
  "a folder that is no longer a usable path is ignored": ignore
  a non-existent remembered folder at the main-side read (extend
  the same validation `video:pickOutputDir` applies), `mkdir
  recursive` the output folder in the runners (an unplugged
  drive still fails — with a sentence that NAMES the folder),
  and a deleted-folder E2E; also (UX) the four buttons share
  live state through a tiny module store so a pick in one panel
  updates the others within the visit (the guide says they
  follow each other — today each reads once at mount). (11)
  [MED] OutputDirLabel never truncates: a long remembered name
  pushes the primary button out of all four cards (+55 px
  measured, screenshots) — `min-w-0 truncate` with a max width
  and `title={outDir}`, plus a seeded-long-name layout case.
  (12) [MED] the PiP Position select clips to "Bottom rig" at
  the default window and "Overlay width (px)" wraps its row —
  re-grid/stack the card and add PiP to `expectSelectsWhole`.
  (13) [MED] native controls render stock (no `color-scheme`/
  `accent-color`; toast icons are react-hot-toast's stock
  green/red): Chromium-blue checkboxes and sliders and light
  scrollbars against BRANDING's no-competing-color rule —
  `:root { color-scheme: dark; accent-color: <accent token> }`,
  token `iconTheme`s in AppToaster, and the DESIGN_GUIDE rule
  written. (14) [MED] a ZERO-LENGTH overlay window (end clamps
  to start) gets the false "its times fall outside the clip"
  sentence — a separate honest sentence ("its start and end are
  the same, so it never shows"); pin updated. (15) the Levels
  sentence's "With nothing switched on, the export keeps your
  levels as they are" is false when a CUT is the only edit (the
  cut makes the chain non-empty so the limiter runs; executed:
  −1.2 vs −0.3 dBFS) — add "or cut a part out" to the sentence's
  first half; pins updated; the cut-included limiter stays (it
  is pinned deliberate). (16) the two "Size" labels are bare
  numbers — say "(px)" like PiP and the preset manager. (17)
  the Source-time row wraps between the arrow and the end box —
  keep "→ [end] s" together. (18) `startExport` claims the
  button only AFTER awaited settings writes, so a fast
  double-click corrupts the queue display (main's gate stops the
  double encode; the rows then read Failed/Not run while the
  real batch runs) — a synchronous ref guard at the top
  (Importer.busyRef precedent); wiring pin. (19) the FixWizard
  Apply toast and the moodboard reference note carry needed
  facts at the 2 s success default — `ACTION_TOAST_MS`. (20)
  Clean audio can REPLACE Audio Studio work that was loaded
  during its extraction, and always yanks the user to /audio
  (the ask runs before the await) — compare the audio source
  before/after the extraction and skip the load+navigate when
  it changed (the `replacedSince` precedent); E2E. (21) the
  ErrorBoundary promises "most of it should be waiting on the
  Home screen" but its hash-only reload keeps the stores, so
  the gated banner (correctly) never shows — reword to the
  truth ("your work is still open in its studios") + pin. (22)
  the scratch-name class, completed: `video:concat` gains
  `sourceName` (Compile writes `stream-aB3dE5fG_compilation.mp4`
  today, executed) and the audio re-attach SUGGESTED name uses
  `fromVideo.convertedFrom ?? videoPath`; and GIF/Reframe names
  also carry the sanitized CLIP name (Export's `{source}_{clip}`
  convention — six scanned highlights currently come out
  "(2)".."(6)"). (23) long-VOD times: show h:mm:ss from one
  hour up (Timeline, ClipList, Highlight list — "167:13.0"
  today) and let the Source-time boxes ACCEPT h:mm:ss; unit +
  E2E. (24) a Video-tour step introduces Clip Kit (anchored on
  the button; tutorialCopy pins). (25) a mic that drops
  mid-take is silent — listen for `ended` on the mic track and
  warn with a toast (the mirror of `watchScreenEnd`); E2E. (26)
  the networkAllowlist guard is narrower than its claims
  (executed: seven call shapes return `[]` from the extracted
  scanner; the CSP regex `wss?:\/\/` can never match the
  shipped bare `ws:` token so "connect-src has no remote
  scheme" is asserted over its opposite; `useImage` — the
  ledgered (g) load path — is invisible to it): treat
  `useImage(` as a site with a (g)-cited allowlist entry; fix
  the regex to `/^(https?:|wss?:|ftps?:|\*)/` with a NAMED
  (m)-cited exception for the shipped `ws:`; add the dynamic
  `import()` node, `downloadURL`, `spawn` of curl/wget/
  powershell, `electron-updater`/`@sentry/*` modules and media
  elements to the vocabulary (or, where a shape is genuinely
  out of reach, narrow the header to what the scan sees); add
  assertions that `dependencies` holds no updater/telemetry/
  crash SDK and `electron-builder.yml` has no `publish`; keep
  every addition discriminating (prove each new shape reds).
  (27) the overlay fields' visible labels are missing from
  their accessible names (`aria-label="Overlay start second"`
  beside the visible "Source time" — WCAG 2.5.3, the criterion
  this round itself cited): put the visible text first in each
  name ("Source time, start (seconds in the source video)";
  same for x / y), update the two pins and the E2E locators.
  (28) docs: USER_GUIDE's folder-memory and crash-recovery
  sentences updated by (10)/(21); TESTING counts + the
  networkAllowlist figure (6); IC rows for every touched
  element; LESSONS entry; all cites verified against the FINAL
  tree. Ledgered with the round, not fixed: the OBS multitrack
  stream picker is new letter (ap); overlay text styling
  (outline/centre/wrap) is new letter (aq); the minimized-window
  save dialog joins the owner hand-check list (with the YouTube
  thumbnail 50 MB rollout note on the existing cap item); the
  5.1-AAC and ffprobe-4.0.2-vs-new-codecs checks came back
  clean; the 44.1 kHz resample-seam ledger facts were
  re-confirmed.
- **Acceptance criteria:** red-first with discrimination for
  every behavior item: break it (or run against pre-fix bytes
  via the pristine-build pattern), watch the NAMED test fail,
  restore byte-identical with sha256 pairs. IMG-PREC: items 1,
  2, 3, 5 and 9 are chain changes — each lands its real Layer 5
  case red-first, run on BOTH majors via the alias pattern with
  transcripts (item 5's case is the bit-identity + stage-order
  pin; item 1's red is the measured drift series). Layout items
  11, 12, 17 extend tests/e2e/layout.ts (seeded long name; PiP
  select; the arrow grouping), red against pre-fix bytes at
  1632x918 and 1024x640. The sweep's scratch under
  scratchpad/s14/ (ffmpeg fixtures and dn.spec, design
  screenshots, qa specs) are starting points — adapt, do not
  trust. Each fixed behavior bug gets its LESSONS entry; IC
  rows updated; TESTING counts + timing table refreshed. `npm
  run verify`, `npm run test:media` and the FULL Playwright
  suite green before handback; no package.json,
  package-lock.json or docs/TICKETS.md edits.
- **Status:** done (round 75 — see Done)

---

## T-126 — review-gate fixes, sweep-15 findings (round 76)

- **Spec:** the fifteenth sweep's verified findings, every one
  re-verified by the expediter in source (and the fps MED
  replicated on the bundled 7.0.2: an export-shaped `-r 30` on a
  60 fps flash+beep fixture gives 302 frames / 10.07 s with the
  flash first visible at 5.0667 s; `fps=30` in the chain gives
  300 / 10.00 s with the flash at 5.000 s; the beep sits at
  5.013 s in both). Adjudication notes: scratchpad/s15/*.md.

  1. **networkAllowlist.test.ts is rebuilt where it overclaims
     (privacy + electron, merged).** (i) CSP judgement inverts
     to a LOCAL allowlist: a source is local only if it is a
     quoted keyword (`'self'`, `'none'`, `'unsafe-inline'`, a
     nonce or hash) or `data:`/`blob:`/`imagii-file:`/
     `filesystem:`, plus the named `KNOWN_CSP_EXCEPTIONS`;
     everything else — scheme-led, bare host, `host:port`, IP,
     `localhost:*` — is remote. Regexes case-insensitive
     (`HTTPS://x.test`, `WSS:` today pass). The `://` HTML-level
     regex gets the same treatment. Discrimination cases for
     bare host, host:port, IP and uppercase forms. (ii) Call
     matching stops being exact-spelling: `net.request` matches
     on its last two segments (`electron.net.request`, aliased
     `enet.request`); calls through import aliases are judged
     (`import { spawn as run }`, `import useImg from
     'use-image'`); flagging moves to the IMPORT for aliasable
     surfaces (`use-image`, `wavesurfer.js`, `child_process`,
     and electron destructuring of `net`, `autoUpdater`,
     `crashReporter`). (iii) `crashReporter.start` is claimed in
     the header but no call-shape branch exists — implement the
     branch (an import/destructure of `crashReporter` or a
     `.crashReporter` read already fires; add the call shape and
     a case). (iv) Vocabulary gains the navigation and
     non-element loaders: `location.href =`,
     `location.assign(`, `location.replace(`,
     `document.location` writes (ErrorBoundary's `.hash` write
     must NOT match — add the discriminating case),
     `.setAttribute('src'|'href')`, SVG `image`/`use`/`feImage`
     in `LOADING_TAGS`, `<input type="image">`, and a computed
     CSS `url(` template containing `${}` (JS-set styles; the
     stylesheet scan reads only .css). (v) The header's claims
     and CANNOT-SEE list are rewritten to match what the scan
     now provably does — every claim either has a branch and a
     discriminating case or is listed as not covered. Round-21
     protocol on every new negative: break the guard, watch the
     named case fail, restore byte-identical.
  2. **The mic-loss record survives the toast (UX + streamer
     MED).** `watchMicEnd` (RecordStudio.tsx:518) sets a
     `micLostAt` state (elapsed-ms at loss) beside the told-once
     toast. Rendered as a persistent line on the REC header
     ("Microphone stopped at 02:14 — no sound after that", time
     via item 4's clock), repeated on the saving card and in the
     saved toast. A take with no loss renders nothing. E2E
     drives the mic-track end in the built app and asserts chip,
     card line and toast text; negative: a clean take shows none
     of the three.
  3. **A label-less DraftField's refusal gets its own
     full-width row (UX).** DraftField.tsx:99-106 returns
     `<>{box}{refusal}</>`, so inside TextOverlayEditor's
     `flex items-center` label the `role="alert"` lands BESIDE
     the box (an ~8-line 70 px column at the 224 px li; for the
     end box it sits between the box and the "s"). Wrap box +
     refusal in a flex-col (or `basis-full` row) so the sentence
     renders under the control at full width, matching the
     labelled variant and the component doc. Layout e2e measures
     the refusal state (today only text/aria are pinned,
     video-core.spec.ts:2355): refusal visible, one column, no
     overlap, at 1024 and 1632.
  4. **The REC clock is the shared clock (UX + streamer).**
     `formatElapsed` (RecordStudio.tsx:644-649) is the last
     minutes-unbounded copy outside shared/clockTime.ts: a
     2-hour take reads "REC 125:33". Use `formatClock`, keeping
     padded mm:ss below an hour (the E2Es pin /REC 00:0x/), and
     h:mm:ss from one hour up. Unit-test the boundary (59:59 →
     1:00:00); delete the local helper.
  5. **Source-time boxes and the outside-the-clip note speak
     clock above an hour (UX + streamer; owner tiebreaker:
     expected usability).** TextOverlayEditor at-rest values
     echo seconds ("2:47:18" rewrites to "10038.00") and the
     note reads "runs from 6043.50 to 6103.50 s" beside a
     Timeline that says 1:40:43.5. At rest, show
     `formatClock(n, 2)` from one hour up (below an hour the
     seconds form stays); the note (textOverlay.ts:103) uses the
     same formatter; the teaching line gains "or a time like
     2:47:13". The e2e pins that freeze the seconds echo
     (video-core.spec.ts:2341 '3723.00', :2348 '3601.50') flip
     to the new truth — red-first against pre-fix bytes.
  6. **Export's folder button starts the chooser on its
     remembered folder (streamer).** ExportPanel passes no start
     folder to `video:pickOutputDir` while the four side panels
     (useVideoOutputDir.ts:47) and Clip Kit do. Pass `outDir`.
     Wiring pin beside the existing ones.
  7. **Has-a-picture is decided by streams, not filename (audio
     MED).** audio.ts:175 picks the refusal kind with
     `isVideoFilename(videoPath)`, and the renderer's fromVideo
     marker (Re-attach, muxBack default) follows the extension
     too — an audio-only file in a video container (.mkv/.mp4
     with no video stream) is sent in the same circle T-125 (7)
     closed, and its Re-attach mux fails on `-map 0:v:0`. The
     pre-extract probe already runs ffprobe: extend it to report
     whether a video stream exists, pick the sentence kind from
     that truth (extension only as the fallback when the probe
     failed), hand `hasVideo` to the renderer, and set fromVideo
     only when the source really has a picture (the
     extracted-from marker for naming and project re-extract
     stays). Layer 5/e2e: an audio-only mkv loads, exports with
     Re-attach absent/off, and the over-ceiling sentence for it
     says the audio remedy.
  8. **The scratch WAV dies with the refusal (audio).** The
     durationless fall-through (T-125 (4)) extracts first and is
     then refused by the loadSource ceiling on the WAV — the
     multi-GB scratch WAV is orphaned until the 6-hour reaper.
     Move the backstop into the handler: after a fall-through
     extraction, read the WAV's real duration in main; over the
     ceiling → unlink the scratch, then throw the same refusal
     sentence. The renderer gate stays as the last resort.
     Layer 5: a durationless over-ceiling fixture → refusal
     AND no WAV left in the scratch dir.
  9. **Layer 5 title tells the truth about the limiter
     (audio rider).** media.spec.ts:4060's case title says
     "…and the limiter after it" — since T-125 (15) ANY
     non-empty chain ends in the limiter, so the phrase is
     either redundant or mis-anchored; rename the title to
     describe what the case's assertions actually pin.
  10. **Folder-key stats stop ganging up on the thread pool
     (electron).** settings.ts:46-54 stats on every read; five
     panels mount together and four read the same key — on an
     unreachable UNC/NAS path each stat parks a libuv thread
     (measured: with the pool parked, a 3 ms read still waited
     at 3000 ms and an imagii-file fetch queued behind it).
     Dedupe in-flight stats per path (one stat, many awaiters)
     and race a short deadline: timeout = "can't tell" =
     answer the stored value (the runner's `ensureOutputDir`
     still guards the real write). Unit tests: concurrent reads
     of one key → one stat; a hung stat → stored value after
     the deadline; the existing missing-folder filter holds.
  11. **Compile's fade readout stops wrapping (design MED).**
     CompilationPanel.tsx:140 `w-14 text-right` lacks
     `shrink-0 whitespace-nowrap` (the T-124 (25) class, fixed
     only in ParamSlider): "300 ms" wraps at ≤1632 and the row
     height changes while dragging. Add them — and audit the
     class: every fixed-width readout in a flex row across the
     renderer gets the same pair in this item.
  12. **The second-track card stops squeezing (design MED).**
     SecondaryTrackPanel: gain readout `w-12` → `w-14 shrink-0
     whitespace-nowrap` ("-10.0 dB" wraps today, every window
     size); "✕ Remove" gets `shrink-0 whitespace-nowrap` (the
     truncate name at :97 is what gives); DuckSlider's
     label/readout row gains `gap-2` (1 px apart at 2560); and
     `{value} {unit}` renders "8 :1" in the visible readout AND
     `aria-valuetext` while the hint says "8:1" — a unit-aware
     join (a unit starting with ':' joins without a space),
     one formatter for both, unit-tested.
  13. **Primary buttons are one line, and the suite can tell
     (design MED).** "Reframe to 9:16", the GIF primary and
     "Compile N clips" wrap to two lines beside a long source
     name at the 298 px cards (measured: "Stream Highlights"
     and longer). `whitespace-nowrap` on the three primaries;
     the chip side gives instead (`min-w-0` on the btn-ghost
     wrapper; OutputDirLabel already truncates). Test blind
     spot closed: `expectControlsWhole` passes a wrapped label
     (scrollWidth never grows), so the layout suite adds
     `expectOneLine` on the three primaries with a seeded long
     source name at 1024 and 1632 — named red: drop one
     nowrap, watch it fail, restore.
  14. **Headers stop breaking mid-word (design).** (i) The
     Reframe readout span (ReframePanel:119-122) gets
     `whitespace-nowrap` — "1280×720 →" / "1080×1920" strands
     the arrow today. (ii) The header is retitled "Reframe to
     9:16": "(center crop)" is stale since T-124's positions
     (a Left strip is not a center crop) and the shorter title
     also stops the wrap — update every pin and doc that cites
     the old title. (iii) PanelHeader's actions row becomes
     wrap-capable: HEADING_CLASS gains `whitespace-nowrap`, the
     row becomes `flex flex-wrap items-center gap-x-2 gap-y-1`
     with actions in an `ml-auto` inline-flex span (replaces
     justify-between; one-row rendering identical, and a
     squeezed header drops the actions WHOLE to a right-aligned
     second row — nothing clips, "OUTPUT PREVIEW" stops
     wrapping mid-word at 298 px). E2E at 1024: OutputPreview
     heading `expectOneLine` + its select `expectSelectsWhole`
     cycling every platform option.
  15. **The player transport survives 1024 and a 3-hour VOD
     (design).** Player.tsx:366-381: the clock div and the
     "Crop guides" label get `whitespace-nowrap shrink-0`; the
     probe-info div is the one that gives (`min-w-0 truncate` +
     `title` with the full text). Layout e2e adds the transport
     row at 1024 with an hour-scale duration: clock one line,
     no overflow.
  16. **Selected text wears the palette, and the guide stops
     overclaiming (design).** `::selection` in @layer base with
     an accent wash whose blend over the input background keeps
     ink-base ≥ 4.5:1 — computed and PINNED the way the toast
     marks are. The select's OPEN drop-down highlight row is
     OS-drawn and not styleable: DESIGN_GUIDE:159-166 narrows
     its claim (the closed control and the dark list come from
     color-scheme; the highlight row is the OS's), documents
     ::selection, and qualifies "a native control needs no
     class to be right".
  17. **STYLE_GUIDE stops quoting a forbidden sentence
     (docs-only, design).** :739 quotes the Levels sentence
     docClaims.test.ts:298 forbids — replace with the current
     LevelsPanel sentence; :738 "(nothing switched on is the
     file that went in)" gains "and nothing cut" per T-125
     (15); :223 "reads both functions" is rewritten to name the
     claim-first pattern and defer the list to the singleFlight
     block in interactionWiring.test.ts (item 19 grows it to
     eleven — no hard count in the guide).
  18. **Inter ships (design; guides are the spec).**
     DESIGN_GUIDE:87 and BRANDING_GUIDE:221 name Inter; no font
     file, @font-face or @fontsource exists, so a stock Windows
     machine draws Segoe UI. Bundle @fontsource/inter latin
     400/500/600 (the expediter has installed the dependency —
     import the three weight CSS files in the renderer entry;
     electron-vite bundles the woff2; zero runtime network —
     verify the built output references only bundled files).
     Stack stays as fallback; guides say the font is bundled.
     E2E in the built app: `document.fonts.check` true for 400,
     500 and 600 at '12px Inter'.
  19. **Seven start handlers get the claim-first flag (QA
     MED).** ExportDialog.startExport, CompilationPanel.
     exportCompilation, GifPanel.exportGif, PipPanel.run,
     ReframePanel.reframe, ClipKitButton.runKit and
     CaptionsPanel.burnIn all claim busy AFTER their first
     await (chooser/dialog/IPC), so a double-click runs two
     jobs — executed in the built app: two choosers, two output
     files on Compile, GIF, Reframe and Audio Export (T-125
     (18) fixed only ExportPanel). Byte-for-byte the
     startingRef pattern: `if (ref.current) return` as the
     FIRST statement, claim before every await and before the
     refusing checks, release in finally; silent return (the
     first press's chooser is up). interactionWiring
     singleFlight pins for all seven (four → eleven); e2e
     dblclick with a 300 ms dialog stub on Compile AND Audio
     Export → one chooser, one file; named red: strip one
     claim, watch the pin fail, restore.
  20. **Cancel leaves the blast radius (QA).** In Compile, GIF
     and PiP the busy row renders Cancel beside the `ml-auto`
     primary, and the busy label is shorter — the second click
     of a double-click lands on Cancel (measured: idle
     1093-1205, Cancel 1147.6-1205; Playwright dblclick
     produced "Compilation canceled." and no file). Move Cancel
     to its own row, the Reframe precedent. With item 19 the
     second press then hits the disabled primary. E2E: dblclick
     with a remembered folder → the job completes, no canceled
     toast, file on disk.
  21. **The picture lands on its sound at every frame rate
     (ffmpeg MED, expediter-replicated).** `-r N` alone
     (export.ts:109, reframe.ts:174, concat.ts:222) leaves the
     picture ~2 output frames late whenever the effective rate
     exceeds the preset's — +67 ms for any 60/59.94/50/120/48
     fps OBS recording on every platform export, Reframe and
     Compile, +45-80 ms for a 30 fps clip at 1.25x/2x (CFR
     vsync drops only past 1.1 frames ahead; the in-repo
     control is Auto Zoom, whose chain already carries fps=30
     and measures 0 ms). Fix: `fps=${preset.fps}` appended in
     `buildVideoFilter` immediately AFTER the setpts/speed
     stages (resampling honors the retime — the reasoning
     documented at filters.ts:483-487), before scale/pad; one
     place covers all three runners; `-r` stays (pins the
     muxer; harmless once the chain is CFR — the autoZoom path
     already carries both). GIF's own fps handling untouched.
     Layer 5 (IMG-PREC): a 60 fps flash+beep fixture through
     runExportJob, runReframe AND runConcat (red = +67 ms / 302
     frames), plus a 30 fps source at 2x (red ≈ +45 ms), event
     times measured on the real output, BOTH majors via the
     alias pattern.
  22. **Extraction cannot balloon on broken timestamps
     (ffmpeg).** EXTRACT_CLOCK_FILTER's async=1 compensates
     unboundedly: a setts +600 s forward jump turns a 30 s file
     into a 630 s WAV (115 MB of injected silence). Cap with
     `-t` against the probed duration (plus a small slack) when
     the probe knows one; the durationless fall-through stays
     uncapped. RED-FIRST DEFINES THE FIX: build the
     setts-forward-jump fixture, confirm the probe still reads
     ~30 s on it (if the probe also reads 630 s the cap is no
     fix — STOP and hand back for re-mechanism), then land the
     Layer 5 case (red = 630 s WAV, green ≈ 30 s), both majors.
     The timestamp-RESET case (real audio silently dropped;
     `first_pts=0` alone behaves the same) has no simple knob —
     record it as a known corrupt-timestamps limitation in the
     Done entry and the extract.ts comment.
  23. **The highlight scan stops paying for true-peak
     (ffmpeg).** highlights.ts:100 and :258 pass `peak=true`;
     the parser (:34) reads only t:/M:. ~3x scan time on a VOD
     (14.7 s vs 4.8 s on 30 min). Drop `:peak=true` from both;
     the framelog=info comments stay (load-bearing, T-09/T-10).
     Layer 5: the same fixture scanned with and without —
     identical parsed M: series, identical windows. Both
     majors.
  24. **HEVC re-attach plays on Apple players (ffmpeg).** The
     stream-copy re-attach (`-c:v copy`; hevc is in
     MP4_COPYABLE_VIDEO_CODECS) writes the default `hev1` tag,
     which QuickTime/Safari/iOS refuse. When the copied video
     codec is hevc, add `-tag:v hvc1` (h264/av1/mpeg4/mjpeg
     untouched). Layer 5: an HEVC mkv re-attached →
     `codec_tag_string == hvc1`, decodes clean. Both majors.

- **Acceptance criteria:** standard bars — red-first on every
  behavior item (break it or run the new test against pre-fix
  bytes via the pristine-build pattern, watch the NAMED test
  fail, restore byte-identical with sha256 pairs; `git checkout
  --` is forbidden); IMG-PREC: items 21, 22, 23 and 24 are
  ffmpeg-command changes and item 7/8 touch the extraction
  handler — each lands its real Layer 5 case red-first on BOTH
  majors via the alias pattern with transcripts. Layout items
  3, 11-15 extend tests/e2e/layout.ts / the pipeline specs with
  measured end states (expectOneLine where wrapping is the
  defect). Every fixed behavior bug gets its LESSONS entry;
  IC ledger rows updated for items 2, 3, 6, 19, 20; TESTING
  counts and the timing table refreshed; guides touched only
  where an item says so (items 14, 16, 17, 18). `npm run
  verify`, `npm run test:media` and the FULL Playwright suite
  green before handback; no package.json, package-lock.json or
  docs/TICKETS.md edits (the @fontsource/inter dependency is
  already installed by the expediter).
- **Status:** done (round 76 — see Done)

---

## T-127 — review-gate fixes, sweep-16 findings (round 77)

- **Spec:** the sixteenth sweep's verified findings. Expediter
  verification behind each item: the HIGH replicated personally
  (net-log capture scratchpad/s16/exp-netlog/net.json on the
  unmodified build: 4 requests to redirector.gvt1.com for
  en-us-10-1.bdic and 42 to dns.google), the Compile drift
  replicated personally (production runConcat, 25 fps fractional
  segments: event lags 3 → 57 → 76/83 → 112 ms across joins),
  the privacy probes executed against the real scanner (twelve
  spellings, twelve `[]`), and every source claim re-read.
  Adjudication: scratchpad/s16/adjudication.md. One sweep-16
  finding is already fixed expediter-side (@fontsource/inter
  moved to devDependencies so the asar stops shipping 4.38 MB
  nothing reads; package.json stays worker-forbidden).

  1. **[HIGH] The app stops phoning Google (design finding,
     out-of-lens; the gravest since the gate began).** The
     shipped app contacts Google on EVERY launch: Electron's
     default spellchecker downloads its Hunspell dictionary
     (redirector.gvt1.com/edgedl/chrome/dict/en-us-10-1.bdic —
     webPreferences has no `spellcheck: false` and no
     setSpellChecker* call exists), and Chromium's secure-DNS
     auto-upgrade probes dns.google whenever the machine's
     resolver is a known DoH provider (8.8.8.8 here; a user on
     8.8.8.8/1.1.1.1 gets the same). MECHANISM: (i)
     `spellcheck: false` in the BrowserWindow webPreferences —
     imagii's text fields are names, labels and short notes;
     the local-first promise wins over spellcheck decisively;
     (ii) turn the secure-DNS probing off app-side — verify the
     exact Electron 31 API (`app.configureHostResolver({
     secureDnsMode: 'off' })` is the expected shape; call it at
     the documented point in app startup); (iii) wiring pins
     for both (the webPreferences literal and the resolver
     call); (iv) a startup NET-LOG e2e on the BUILT app: launch
     with `--log-net-log`, idle past ready, parse the log, and
     assert ZERO http(s)/ws URL_REQUESTs — this makes README's
     "zero network requests on startup" a tested claim at last.
     RED-FIRST is already banked: the expediter's capture on
     today's bytes shows both hosts; the worker re-captures red
     before the fix and green after, and keeps both logs. (v)
     networkAllowlist.test.ts header: Chromium-runtime traffic
     (engine downloads, DNS probes) goes under WHAT IT CANNOT
     SEE with a pointer to the net-log e2e that now holds it.
     (vi) LESSONS entry. The win32-binary confirmation line
     goes on the release-run checklist (the mechanism is
     platform-independent; the proof run here is Linux).
  2. **[MED] Export's Cancel leaves the double-click blast
     radius (four convergent reports; QA executed 3/3: second
     press at 60/120/200 ms hit Cancel, "Export canceled.", no
     mp4; the default state is "Export 1 file" so cancelAll
     fires with NO confirm).** T-126 (20) fixed Compile, GIF
     and PiP and left Export out — the LESSONS "a guard that
     exists once is a convention nobody follows" case.
     MECHANISM: Cancel moves out of the PanelHeader actions to
     its own right-aligned row under the header (Compile's
     `flex justify-end` row); the >=2-jobs confirm modal stays.
     TESTS: extend the (20) geometry e2e (video-pipelines
     :5009) to the Export card; add a HUMAN-PACED second press
     (two mouse.click calls, gap >= 60 ms, after the busy
     re-render) that asserts the export completes and a file
     lands — red against pre-fix bytes. The dead "Xvfb font"
     caveat in LESSONS is corrected (Inter ships now).
  3. **[MED] Quit mid-job stops leaving wreckage at final names
     (electron; executed 6/6 window-X runs left
     vid_c1_youtube.mp4, ~1.5 MB, no moov; re-export then lands
     at "(2)").** cancelAll* kills the children at quit but
     every discardPartialOutput runs on an async `.catch` after
     the child's close, and the process exits first; Cancel
     deletes wreckage (T-100), quit does not, and
     process.ts:509-511 claims the intermediate WAV dies "on
     any failure or cancel" — false at quit. MECHANISM (worker
     picks the smaller diff that passes the scenario): a second
     bounded before-quit drain — preventDefault once, await the
     canceled runs' cleanup with a ~1.5 s ceiling (the
     QUIT_FLUSH_TIMEOUT_MS pattern), then re-quit — or a
     synchronous unlink registry of partial and intermediate
     paths swept like recording.ts:101-116 does with
     unlinkSync. TESTS: an e2e per the reviewer's quitprobe
     (window-X mid-export → no final-name file remains;
     mid-reattach → no .cleaned.wav remains), red against
     pre-fix bytes; the process.ts:509 comment made true.
  4. **[MED] Compile's joins stop drifting (ffmpeg;
     expediter-replicated).** Every segment whose length is not
     a whole frame count writes 1-2 extra video frames (fps
     stage + fractional -ss + EOF fill); the concat demuxer
     offsets the next segment by the video-led container
     duration and the join's AAC encode swallows the audio gap
     — cumulative, up to 227 ms over 8 fractional segments at
     25 fps, and present on imagii's own remuxed MediaRecorder
     takes with integer boundaries. MECHANISM: `'-shortest'` in
     the SEGMENT argv before segPath (reviewer-verified: the
     series becomes 3/-3/7/0/0 ms on both majors, and the
     patched concat passes all 33 compile Layer 5 cases on
     7.0.2; their scratch at s16/ffmpeg/concat.patched.ts is a
     reference, not a source to copy blind). LAYER 5
     (IMG-PREC): a fractional-segment case at 25 fps through
     production runConcat measuring the per-event flash-beep
     lag SERIES (red = the growing series; green = flat within
     ~15 ms), BOTH majors; keep the existing whole-second case.
     The Done entry corrects T-125's "<15 ms per segment" claim
     (true per segment, false across joins).
  5. **[MED] The guard sees qualified constructors (privacy;
     probes executed).** `new window.WebSocket(u)`,
     `new globalThis.XMLHttpRequest()`, `new window.Image()`
     all return []. Branch: `^(window|globalThis|self)\.<ctor>$`
     with a case per qualifier and a NEGATIVE for
     `new Konva.Image(` (arbitrary qualifiers stay unmatched on
     purpose). Round-21 proof per case.
  6. **[MED] The guard sees module loads beyond
     import/require/import() (privacy; probes executed).**
     `process.getBuiltinModule('node:https').get(u)`,
     `createRequire(import.meta.url)('node:net')` and
     `export * from 'node:https'` all return []. Make
     `getBuiltinModule(` and `createRequire(` sites the way
     `eval(` is, and judge ExportDeclaration module specifiers
     like imports; cases + round-21 proof for each.
  7. **[LOW] The Source-time row speaks one language (a11y +
     UX, merged).** The at-rest value shows h:mm:ss.cc from one
     hour (T-126 (5)) but the end box keeps an unconditional
     trailing "s" (TextOverlayEditor:259), both aria-labels
     still say "(seconds in the source video)", and EACH BOX
     picks its form independently ("3590.00 → 1:00:10.00 s").
     MECHANISM: the PAIR decides — if either of start/end is
     one hour or more, both boxes render clock form; the
     trailing "s" renders only when the pair is in seconds form
     (share overlayTimeText's boundary, never duplicate it);
     labels become "Source time, start/end (seconds, or a time
     like 2:47:13)". Pins at interactionWiring:1665 and
     :1731-1736 and the e2e reading the row flip — red both
     ways (above an hour: no "s", both clock; below: "s"
     stays, both seconds).
  8. **[LOW] A double-click cannot dismiss the question it
     raised (UX).** startExport/startKit put up the safe-zone /
     over-limit modal on click 1 and click 2 lands on the scrim
     (press and release both outside the centered card) and
     closes it. MECHANISM: the shared Modal's scrim onClick
     ignores `e.detail > 1` (one change covers every dialog;
     the T-123 (7) drag tracking stays). E2E: dblclick Export
     with safe-zone issues pending → the dialog is still open;
     red against pre-fix bytes.
  9. **[LOW] The tour names the button a user actually sees
     (UX).** videoTutorial.ts:89 says "Click 'Choose folder…'"
     — that label exists only while no folder is remembered
     (OutputDirLabel emptyLabel), so a replayed tour points at
     a button that reads a folder name. Reword: "the folder
     button — it reads 'Choose folder…' until you have picked
     one"; the copy pin follows.
  10. **[LOW] The streams' answer survives a missing duration
     (QA; executed).** probeAudio throws "no usable duration"
     BEFORE computing hasVideo, so a durationless audio-only
     WebM/MKV is classified by extension, Re-attach defaults ON
     (mux then fails on -map 0:v:0), and over 2 h the person is
     sent in the T-126 (7) circle — while the probe COULD read
     the streams. MECHANISM: carry hasVideo on the no-duration
     path — a typed refusal that holds the streams' answer, or
     a streams-only probe split — and use it in the handler's
     fall-through (extension only when the probe truly read
     nothing); the docs' "extension only when the probe could
     not read the file" becomes true. L5: the durationless
     audio-only fixture's sentence pin flips to the audio
     remedy; audioExtractCeiling pin updated. Red-first, both
     majors.
  11. **[LOW] Three more start handlers get the claim-first
     flag (QA; executed: dblclick "Save all" = two choosers +
     8 files).** ThumbnailVariants.saveOne/.saveAll and
     CaptionsPanel.saveSrt go straight to a native dialog with
     no claim — Q1's class on sites T-126 (19) did not name.
     ExportPanel.startingRef shape on all three; singleFlight
     pins grow 11 → 14; a delayed-chooser (300 ms stub)
     dblclick e2e on Save all → one chooser, one file set.
     Red-first per pin.
  12. **[LOW] Header-named guard shapes get their cases
     (privacy).** http.request, https.request and http.get are
     claimed with only https.get tested; 'tls' and 'dgram'
     appear only in the header and the set. One case each,
     round-21 proof.
  13. **[LOW] Guard vocabulary, last gaps (privacy; probes
     executed).** ADD: the location qualifier chain
     (window.top.location.href — keep the .hash negative),
     bracketed-IPv6 URL literals, `image-set(` beside url( in
     both the stylesheet scan and the computed-CSS branch, and
     `document.createElement` of a LOADING_TAG as a site
     (covers createElement('a').href+click cleanly; no in-tree
     false positives). DECLARE under WHAT IT CANNOT SEE: fetch
     used as a value (`const f = fetch`, `.map(fetch)`,
     `window['fetch']`, `.bind()`) — value tracking is beyond
     an AST scan; say so. HEADER TRUTH riders: the destinations
     wording notes the Hugging Face download follows a 302 to
     its CDN; sourceFilesUnder reads .ts/.tsx to depth 8 — say
     so and add a guard that fails if a .js file ever appears
     under src/; INTERACTION_COVERAGE:3168's wording aligned.
  14. **[LOW] The package check reads devDependencies too
     (privacy).** phoneHomePackages runs on dependencies only,
     while vite bundles whatever the renderer imports from
     either section. Spread devDependencies in; the existing
     negative stays green.
  15. **[LOW] A truncated name always carries its full self
     (design).** SecondaryTrackPanel:99 truncates the file name
     with no title; same omission at VideoStudio.tsx:162,
     AudioStudio.tsx:74 and PresetPanel.tsx:103. `title` with
     the full name at all four (the DESIGN_GUIDE chip rule);
     e2e asserts title == full name on the second-track span.
  16. **[LOW] Placeholder text joins the palette (design).**
     No ::placeholder rule exists, so Preflight's stock
     #9ca3af (a cool blue-gray, brighter than ink-dim) ships in
     every field. One @layer base rule from
     theme('colors.ink.dim') for input and textarea
     placeholders, pinned in designTokensInSync with a contrast
     recompute, the ::selection pattern exactly.

- **Acceptance criteria:** standard bars — red-first on every
  behavior item (break it or run against pre-fix bytes via the
  pristine-build pattern, watch the NAMED test fail, restore
  byte-identical with sha256 pairs; `git checkout --` is
  forbidden). IMG-PREC: items 4 and 10 are ffmpeg-surface
  changes — real Layer 5 cases red-first on BOTH majors via the
  alias pattern with transcripts; item 1's red/green is the
  net-log pair. Items 2, 8, 11 extend the e2e suites with
  executed end states. Every fixed behavior bug gets its
  LESSONS entry; IC rows for items 2, 8, 11 (and the two
  pin-only dispositions stay); TESTING counts and timing
  refreshed; guides touched only where an item says so (1, 13,
  15, 16 plus the LESSONS corrections in 2 and 4). `npm run
  verify`, `npm run test:media` and the FULL Playwright suite
  green before handback; no package.json, package-lock.json or
  docs/TICKETS.md edits (the @fontsource devDependencies move
  is already done expediter-side).
- **Status:** done (round 77 — see Done)

---

## T-128 — small-debt batch from the T-110 ledger (round 78)

- **Spec:** the Tier-1 residue, owner-authorized 2026-10-16
  ("proceed with the tech debt"). Six items.
  1. **Titles on the remaining truncated names.** The
     INTERACTION_COVERAGE round-77 found-not-fixed list names the
     truncate spans still without a `title` (mood board, post
     checklist, thumbnail variant labels, Record, layers,
     highlights). Every one gets `title` = the full text, the
     T-127 (15) pattern; one pin covering the set and one e2e
     spot-check.
  2. **Only woff2 ships.** The build emits the three .woff
     fallbacks (93 KB) Chromium 126 never requests. Replace the
     three @fontsource CSS imports with inline @font-face rules
     (in index.css or a local fonts.css) whose `src` references
     ONLY the woff2 files from the @fontsource package (vite
     asset-imports the files); the built output then carries
     woff2 alone. The smoke e2e's font-faces-loaded and
     built-css url() scans keep passing; DESIGN_GUIDE's font note
     updated.
  3. **Letter (s): transcripts can be cleared.** A "Clear saved
     transcripts" action in the Captions panel: confirm modal
     (Modal component), an IPC that empties ONLY
     `<userData>/captions` (path validated server-side), a toast
     naming the count removed, disabled/empty state when there is
     nothing to clear. IC row, e2e (seeded transcripts dir →
     cleared, count in the toast), USER_GUIDE's transcripts note
     updated.
  4. **Letter (x): no bare awaited settings write outside a
     try.** The ~47 awaited `window.api.*` setting-persist calls
     sitting outside any try: route the fire-and-forget ones
     through one tiny shared helper (void + reportFailure-style
     catch — the write's failure must not break the interaction),
     keep a real await only where the next line depends on it
     (then inside the existing try). A unit scan pins the rule
     (no bare awaited settings.set outside try/helper) with a
     round-21 negative.
  5. **Quit covers convert and extraction.** T-127 (3)'s named
     not-covered list: make the recording-save/import convert and
     `audio:extractFromVideo` latch runs (cancelLatch), so the
     before-quit drain waits for their cleanup too; a quit
     mid-convert leaves no partial at a final name and a quit
     mid-extraction unlinks the scratch WAV. e2e per the T-127
     (3) pattern (window-X mid-convert; mid-extraction), red
     against pre-fix bytes; LESSONS/IC updated.
  6. **Letter (ad): one nanoid alphabet.** Five older copies of
     the alphabet remain; one shared constant in src/shared, all
     five sites import it, unit pin that no second literal
     exists.
- **Acceptance criteria:** standard bars — red-first on every
  behavior item with sha256 content-replace restores; IC rows and
  LESSONS entries; `npm run verify`, `npm run test:media` (item 5
  touches extraction lifecycle — its L5 block re-run on both
  majors), build + FULL Playwright green before handback. Work in
  the assigned WORKTREE (run `npm install` there first); no git
  write operations; no docs/TICKETS.md, package.json or lockfile
  edits.
- **Status:** done (round 80, checkpoint 1 — see the Done entry)

---

## T-129 — the waveform stops decoding whole files in the renderer (T-110 (ao); round 78)

- **Spec:** the biggest real debt in the ledger,
  owner-authorized 2026-10-16. Audio Studio hands the WHOLE file
  to WebAudio to draw the waveform: a 1 h WAV peaks ~3.25 GB
  renderer RSS, 2 h ~6.5 GB (measured, sweep 12), so a 2-hour
  ceiling refuses longer files — the stopgap T-123 shipped. The
  ledgered fix: MAIN computes the peaks and hands wavesurfer
  `peaks` + `duration`, while the media element keeps streaming
  over the Range-capable imagii-file protocol; the renderer never
  decodes, and the ceiling retires.
  Mechanism:
  1. A main-side peaks job: ffmpeg decodes the file as a stream
     (s16le, mono downmix, reduced rate is fine) piped to node;
     fold min/max pairs into a bounded bucket array (~4000
     buckets) WITHOUT buffering the file; return
     `{peaks: Float32Array-able array, duration}` over IPC
     (size-bounded payload). Registered with cancelLatch (quit
     drain) and the per-job cancel registry; progress events the
     way extraction reports (a 3 h file takes real seconds).
  2. The renderer passes `peaks` + `duration` + the imagii-file
     url to wavesurfer and never calls its decode path. Playback,
     regions, cuts, seek behavior unchanged.
  3. The 2-hour ceiling retires: `waveformCeilingRefusal` and its
     pre-check/backstop uses are removed with their pins flipped
     (the refusal that remains is for a file whose PEAKS job
     fails, with a finished sentence in the T-84 voice); the
     panel/guide copy that mentions the 2-hour limit is updated.
     The T-127 (10) hasVideo plumbing stays exactly as is.
  4. IMG-PREC: Layer 5 case proving the peaks of a known fixture
     (tone bursts at known times) land in the right buckets at
     the right amplitudes, both majors; e2e: a LONG (>=2 h,
     generated cheaply at low bitrate) file loads, the waveform
     draws, and the renderer's process memory stays an order of
     magnitude under the old path (assert a generous ceiling,
     e.g. < 800 MB, red against pre-fix bytes where the old path
     refuses/explodes); the cancel and quit paths covered.
  5. LESSONS entry; IC rows (the import path's end state
     changed); TESTING counts; the (ao) letter's resolution noted
     in your handback for the expediter's ledger close.
- **Acceptance criteria:** standard bars; red-first with sha256
  restores; both-majors L5; full gates (verify, test:media, build
  + FULL Playwright) green in the WORKTREE (run `npm install`
  first); no git writes; no docs/TICKETS.md, package.json or
  lockfile edits. If wavesurfer's current major cannot take
  external peaks + duration without decoding, STOP and hand back
  with what you found rather than working around it with a
  renderer decode.
- **Status:** done (round 80, checkpoint 2 — see the Done entry)

---

## T-130 — platform-rate and kit-art debt: (q), (t), (an) (round 79)

- **Spec:** owner-authorized 2026-10-16; the design calls fall
  to the usability tiebreaker and are recorded here.
  1. **Letter (q): the output follows the source's rate up to
     60.** Compile derives its fps from the max source rate of
     its clips, capped at 60 (COMPILE_FPS becomes a derivation;
     the fps stage and `-r` take the derived value); a built-in
     "YouTube 1080p60" preset joins both preset tables (8M→12M
     bitrate per YouTube's guide for 1080p60). Layer 5: a 60 fps
     source compiles at 60 with events on the ideal timeline;
     the 1080p60 preset exports 60 fps with the fps stage; both
     majors. Preset-table pins updated; USER_GUIDE's rate note
     updated.
  2. **Letter (t): Clip Kit thumbnails honor the crop.** Pass
     the clip's cropRect into extractFrame (crop filter before
     scale); a 9:16-cropped clip's three thumbnails are the
     cropped picture. L5 pixel case (cropped region's content
     present, outside content absent).
  3. **Letter (an): the watermark clears platform UI on 9:16.**
     Per-preset margins replace the flat 20 px: vertical presets
     (TikTok/Reels/Shorts-shaped frames) take an inset that
     clears the caption rail and top bar (define one constant
     pair in the preset table, documented; landscape presets
     keep 20 px). The T-51 win32 pixel pins and the Layer 5
     pixel case land with the chosen margins.
- **Acceptance criteria:** standard bars; red-first; both-majors
  L5 for every ffmpeg change; full gates in the worktree; no git
  writes; no TICKETS/package.json/lockfile edits.
- **Status:** done (round 80, checkpoint 3 — see the Done entry)

---

## T-131 — review-gate fixes, sweep-17 findings (round 79)

- **Spec:** the seventeenth sweep's verified findings. Expediter
  verification behind the lead items: the Compile truncation
  replicated personally through production runConcat (10 s
  video / 6 s audio: segments [1,3],[7,9],[2,4] → 2.0 s instead
  of 6.0 s; straddle → 5.014 s of 7); the guard probes executed
  (eight spellings → eight []). Adjudication with mechanisms:
  scratchpad/s17/adjudication.md. Two sweep findings were folded
  into the in-flight T-128/T-129 workers by scope notes and are
  NOT here.
  1. **[MED, LEAD — a T-127 (4) regression] Compile survives
     audio that does not cover a segment.** `-shortest` makes a
     segment whose range sits past (or straddles) the source
     audio's end collapse to an unreadable ~977-byte stub
     (ffmpeg exits 0, "Output file is empty"); the join then
     silently drops every segment from the stub on and the
     panel toasts "Saved". Record's own mic-drop takes (T-125
     (25)) are exactly such sources. MECHANISM (verified by the
     sweep reviewer through a patched copy of the real runner,
     BOTH majors): keep `-shortest` and append
     `apad=whole_dur=<outSec>` as the LAST `-af` stage, always
     emitted, where outSec is the value buildSegmentFilters
     already computes ((end-start)/speed, toFixed(3)). WARNINGS
     (banked measurements, do not deviate): bare `apad` without
     whole_dur brings the 3/57/…/194 ms join drift back on
     6.1.1 and hangs with `-c:v copy` on 7.0.2. ALSO: the join
     must FAIL LOUDLY — a missing/unreadable segment is a hard
     error surfaced as the job's failure, never an exit-0
     partial with a success toast. Layer 5 (both majors):
     audio-ends-mid-segment, clip entirely past the audio end,
     audio-starts-late, the straddle; the T-127 (4) fractional
     drift series re-run flat; the join hard-error case. The
     Done entry corrects the T-127 (4) record.
  2. **[LOW] Re-attach and PiP survive short audio.** The same
     hazard, pre-existing: `-shortest` at process.ts:480
     (attachAudio) and concat.ts:430 (compositePip) ends the
     output where the audio ends (a mic-drop WebM: 12 s picture
     re-attaches to 5.0 s; PiP base the same; the stream-copy
     branch to 6.0 s). MECHANISM (reviewer-verified, both
     majors, works with -c:v copy): finite
     `apad=whole_dur=<picture length>` + keep `-shortest`
     (12.000 s out). The :346-368 comment updated (it documents
     -shortest only as the music-bed bound). Layer 5 per
     surface, both majors.
  3. **[LOW] Scan results die with their video.** HighlightPanel
     and ChatHighlightPanel keep the previous video's
     candidates/peaks/log when the source is replaced in place
     (the Edit-in-Video-Studio route; CaptionsPanel:67-70 is
     the guard that exists once), and a stale "+ Clip" row
     makes a PAST-THE-END clip (appendRange: safeStart clamps
     to duration, safeEnd becomes duration+0.1) with a "Clip
     added" toast. MECHANISM: reset both panels' state keyed on
     source.filePath (the CaptionsPanel pattern), AND
     appendRange refuses startSec >= duration with a finished
     sentence (T-84 voice). Unit + e2e through the
     Edit-in-Video-Studio route; red-first.
  4. **[LOW] The Fix wizard ignores a repeat press.** A
     double-click on an answer answers the next question too
     (executed: "Quick fix 3 of 3" from one dblclick; the
     next step's full-width buttons render at the same spot).
     T-120's held-Enter rule, now for clicks: answer buttons
     ignore `e.detail > 1`. Unit pin + e2e; red-first.
  5. **[LOW] Every remaining first-await-is-a-dialog picker is
     claim-first.** Importer "Choose file…", AudioImporter,
     SecondaryTrackPanel's role buttons (a second answer
     silently replaces the track), PipPanel's two pickers, Home
     "Open project"/"Save project" (executed: two choosers),
     ExportPanel.pickOutDir, useVideoOutputDir's chip handler.
     MECHANISM: ONE shared claim-first helper (the
     ExportPanel.startingRef shape) applied to all; the
     singleFlight pin list extended to cover them; one
     delayed-chooser (300 ms stub) dblclick e2e per studio
     entry point. The T-126/127 IC "pin-only, first await is a
     native dialog" dispositions are REWRITTEN — that rationale
     was disproven by execution. Red-first per pin.
  6. **[LOW] The tour ignores a repeat press.** next()
     advances once per discrete click, so a double-click skips
     a step and can close the tour from the penultimate step
     (steps sharing target+placement keep Next in place).
     MECHANISM: ignore `e.detail > 1` on Next/Back/Done and the
     coachmark scrim. e2e; red-first.
  7. **[LOW] The `?` overlay is discoverable again.** Nothing
     in the app names the `?` key (T-13's promise regressed;
     README/FOR_MIKE still claim it). MECHANISM: append "? all
     shortcuts" to the Player and Timeline hint lines and name
     the key in the tour's final step; copy pins updated.
  8. **[LOW] A closing dialog swallows the double-click's
     second press.** The second press of a dblclick on a
     closing dialog's button passes through to the page
     (executed: "Keep running" dblclick flipped the Facebook
     checkbox beneath, mid-batch). MECHANISM: when a Modal
     unmounts, a capture-phase window listener swallows clicks
     with `detail > 1` for ~500 ms (one shared change; the
     T-123 (7) drag logic and the scrim's own guard stay).
     e2e; red-first.
  9. **[LOW] The cancel confirm dies with its batch.** The
     >=2-jobs "Cancel running jobs?" modal outlives the batch
     and reads "Cancel 0 running jobs?" (executed; same shape
     in ClipKitButton). MECHANISM: close the confirm when
     running flips false, both sites. e2e; red-first.
  10. **[LOW] Guard: qualifier/value spellings.** `open(u)` and
     window/globalThis/self/top-qualified open; indirect
     eval/Function shapes; element access (navigator
     ['sendBeacon'], net['request'], window['open']); a value
     reference to a named network constructor (const WS =
     WebSocket; subclass; `as any` cast). MECHANISM: judge
     open/eval/Function by last segment, bare or parenthesized,
     UNLESS the file binds the head locally (autosave.ts's fs
     `open` is the mandatory negative); resolve x['name'] as
     x.name; value references to the constructor set are sites;
     reword the "last gaps" claims (header + IC:3325 +
     LESSONS:53) to the declared residue. Round-21 proof per
     branch.
  11. **[LOW] Guard: dynamic element vocabulary.** A non-literal
     first argument to createElement/setAttribute becomes a
     `(dynamic)` site — the rule import()/require()/spawn()
     already have. Cases + proof.
  12. **[LOW] Guard: the three inversions (class-closers).**
     (i) under src/ only .ts/.tsx/.d.ts/.css/index.html are
     allowed (closes .mts/.cts unread+unflagged); (ii) any
     `scheme://` literal whose scheme is not local
     (imagii-file, file, data, blob) is a site (closes
     rtmp/rtsp/srt/udp/tcp/sftp/smb); (iii) package.json
     dependency AND devDependency names pinned to an in-test
     allowlist (closes the HTTP-client name race). Riders: the
     TESTING win32 hand-check gains the wpad/OS-proxy allowance
     sentence; at expedite, probe whether CSP `connect-src ws:`
     lets the built renderer fetch https (a non-routable https
     URL; the CSP decision precedes routing) and record the
     answer against ledger (m). Round-21 proof per inversion.
  13. **[LOW] The folder chip sleeps while a job runs.** The
     busy Reframe/Compile primaries shrink 23-26 px and the
     LIVE folder chip sits under the double-click strip
     (executed: a chooser opened mid-job on a 120 ms second
     press). MECHANISM: disable the OutputDirLabel chip button
     while running on the four chip panels (changing the folder
     mid-job does nothing for the running job), plus min-width
     on the Reframe/Compile primaries so no sibling inherits
     the strip. e2e: second press at primary.x+4 while busy →
     no chooser; red-first.
  14. **[LOW] The filename template fits at 1024.** The inline
     "Tokens:" hint takes the row and the input clips its own
     default value (168 px box, 189 px value — the only cut
     input app-wide). MECHANISM: the hint moves to its own line
     under the box. e2e at 1024: input scrollWidth <=
     clientWidth with the default template.
  15. **[LOW] One multiplication glyph.** image-studio
     ExportDialog is the one file spelling dimensions with the
     letter x ("Output: 1280x720"; "28x28, …") against × on the
     same screen. Swap to ×, keep each line's existing spacing;
     update the five image.spec pins. (Spacing variance
     elsewhere is out of scope.)
  16. **[LOW, docs] STYLE_GUIDE speaks the pair rule.**
     :604-606 still describes the per-box form rule; rewrite
     for overlayTimePair (either value >= 1 h puts BOTH boxes
     in clock form) + the unit rule; soften the textOverlay.ts
     "never speaks two forms" comment (an overlay pair inside a
     clip pair is two coherent pairs).
  17. **[LOW, docs+comment] The quit story tells the Windows
     truth.** Electron emits no before-quit on a Windows
     shutdown/logoff (typings :172), so the index.ts comment
     ("an OS session end") is corrected and the not-covered
     lists (IC, LESSONS) gain the line; the optional
     session-end handler is ledgered as (az), not built here.
  18. **[LOW, compliance] Inter's license ships again.** The
     devDependencies move stripped the asar's only copy of
     Inter's OFL text while the woff2 still ship. MECHANISM:
     electron-builder `extraResources` copies
     node_modules/@fontsource/inter/LICENSE to
     resources/licenses/Inter-OFL.txt at package time
     (devDependencies are installed at build; the lockfile pins
     it); a release-run hand-check line confirms the file in
     the packaged tree. The guard's no-publish pin and the
     packaging tests stay green.
- **Acceptance criteria:** standard bars — red-first on every
  behavior item with sha256 content-replace restores (`git
  checkout --` forbidden); IMG-PREC: items 1 and 2 are ffmpeg
  changes — real Layer 5 cases red-first on BOTH majors via the
  alias pattern with transcripts, and item 1 re-runs the T-127
  (4) drift series; items 3-9, 13-14 extend the e2e suites with
  executed end states. LESSONS entries per fixed behavior bug
  (item 1's entry corrects the T-127 (4) record); IC rows
  updated (and item 5 REWRITES the disproven pin-only
  dispositions); TESTING counts/timing refreshed; guides only
  where an item says so (7, 12, 16, 17). `npm run verify`,
  `npm run test:media` and the FULL Playwright suite green
  before handback; no docs/TICKETS.md, package.json or lockfile
  edits (electron-builder.yml IS yours for item 18).
- **Status:** done (round 80, checkpoint 4 — see the Done entry)

---

## T-132 — sweep-18 fixes (round 81)

- **Spec:** the eighteenth review sweep's verified findings — every
  item below was confirmed by the expediter against source, and the
  measured ones replicated on the real binaries. 14 items.
  1. **[MED] Clean audio's completion navigates wherever the person
     is.** `VideoStudio.tsx` `cleanAudioFlow`: after the extraction
     (now minutes long with the ceiling retired), `navigate('/audio')`
     fires unconditionally — react-router's `activeRef` never resets,
     so it works from the unmounted component; landing on `/record`
     unmounts RecordStudio, whose cleanup stops the tracks and cuts a
     LIVE TAKE short (the save dialog then opens over Audio Studio).
     Fix: capture the router location and navigate only if the person
     is still on `/video`; otherwise load silently and toast with an
     "Open Audio Studio" action (the action-toast pattern exists).
     e2e: extraction ends while on `/record` mid-take → no navigation
     and the take continues; the stay-on-`/video` path still
     navigates. ProjectIO.ts's "nothing teleports the user" rule is
     the product sentence this enforces.
  2. **[MED] PRODUCT_GUIDE.md:35 still states the retired 2-hour
     ceiling.** A checkpoint-3 merge resolution took T-130's side of
     the studio table (built pre-T-129) and reverted T-129's fix —
     the only reverted line of the wave (verified by two reviewers'
     line-level diffs of every checkpoint pair). Restore the T-129
     sentence ("Opens sound of any length (the waveform is computed
     in the main process from a stream of the sound)"), correct
     INTERACTION_COVERAGE:3416's claim, and extend the
     `docClaims.test.ts` no-2-hour-limit scan to README.md,
     docs/PRODUCT_GUIDE.md and docs/USER_GUIDE.md so a merge cannot
     revert it silently again.
  3. **[MED] The "Clear saved transcripts" button wraps its label**
     onto two lines at every window up to 1920 px (measured in the
     built app; the only single-label button that wraps; the
     DESIGN_GUIDE wrap rule). Fix: `flex-wrap` on the row,
     `whitespace-nowrap` on the button, and the layout e2e case at
     DEFAULT_WINDOW and MIN_WINDOW per the T-123 pattern.
  4. **[LOW] Export, Reframe and extractFrame say "Saved" for empty
     or audio-only output.** Their closers check only `code === 0`.
     Two executed triggers (both majors): a restored project whose
     source file got shorter (OBS reusing a filename) exports a
     261-byte streamless stub as success; a source whose sound
     outlasts its picture exports a clip past the last frame as an
     audio-only mp4, and `extractFrame` resolves with NO file (Clip
     Kit then toasts "Saved your Clip Kit" over stubs and missing
     thumbnails). Compile (T-131 (1)) and GIF already fail loudly.
     Fix: reuse the `FFMPEG_EMPTY_OUTPUT` sticky-stderr guard in
     export.ts and reframe.ts, stat-after-exit-0 in frame.ts, each
     rejecting with a finished user sentence through the existing
     discard path. Layer 5 on both majors with the two triggers,
     plus discrimination (a legitimate 10-20 ms segment stays
     green).
  5. **[LOW] The waveform's bottom half clips on asymmetric audio.**
     `WaveformView` passes `normalize: true` and wavesurfer 7.12.6's
     `calculateVerticalScale` computes its max from channel 0 (the
     highs) alone, so louder lows draw past the canvas edge and the
     whole bottom half is mis-scaled. Fix: pass
     `maxPeak = max(|high|, |low|)` to `WaveSurfer.create` (typed
     and honored); a unit or Layer 5 case with an asymmetric burst.
  6. **[LOW] A held Enter walks the whole tour.** `tutorialKeyIntent`
     answers 'none' for Enter on a button (no preventDefault), focus
     is forced onto Next each step, and `stepOnce` passes detail-0
     clicks, so auto-repeat walks to Done and persists "seen" — the
     exact mechanism FixWizard's `ignoreHeldEnter` guards (T-120,
     red-first in the repo). Fix: an `e.repeat` Enter guard in the
     tour's keydown (or share `ignoreHeldEnter` on the card); an e2e
     that holds Enter and expects one step.
  7. **[LOW] A custom preset based on "YouTube 1080p60" starts at
     30 fps / 8M**, while INTERACTION_COVERAGE:3431 says it starts
     at 60. Tiebreaker: fix the code — `loadFromBase` also sets fps
     and bitrate from the base row (give the renderer table the
     fields it needs); unit case; keep the ledger sentence true.
  8. **[LOW] Copy made stale by the 12M row:** USER_GUIDE:146 and
     the RecordStudio comment say recordings use "up to 8 Mbps (the
     top export preset's rate)" — the top is now 12M (reword: the
     recording ceiling is its own 8 Mbps, no longer tied to "the top
     preset"); ExportPanel's three "five platforms" comments now
     count six.
  9. **[LOW] Play looks live while the waveform draws.** The Play
     button is `disabled={!ready}` with no `disabled:opacity-50`,
     and T-129 makes that state last seconds to tens of seconds.
     Add the class.
  10. **[LOW] PLAYBACK_ERROR_MESSAGE gives circular advice.** For an
     ADPCM .wav it says "Re-export it as WAV or MP3" — it already is
     a WAV — and never says the waveform, cuts and export still
     work. Reword (say what still works; tell WAV owners "a standard
     PCM WAV"); move the unit and e2e pins with the sentence.
  11. **[LOW] "Loaded" and the Recent entry land before the deferred
     waveform read can refuse the file** (T-129 made the read
     asynchronous after open). A refused file flashes a green
     "Loaded" and stays in Recent. Fix: push to Recent and toast
     Loaded when the waveform arrives (Home's "Project loaded" has
     the same shape); e2e: the refusing fixture gets no green toast
     and never lands in Recent.
  12. **[LOW] The compilation refusals under-name.** The
     empty-segment sentence says "Clip ${i+1}" by position — default
     names are creation-numbered, so position lies; `seg.name` is on
     the wire, use it. The lost-part join sentence names no clip and
     no next step; add what to do.
  13. **[LOW] A refused settings write stacks identical toasts.**
     `reportFailure` passes no toast id, and Export fires up to four
     `persistSetting` calls (verified stacking in react-hot-toast
     2.6.0). Give the persistSetting failure a fixed toast id so
     repeats coalesce.
  14. **[LOW] A partial transcript clear gets a green tick.**
     `clearedTranscriptsMessage` documents a plain toast for a
     partial clear; the panel calls `toast.success`. Use the
     warning-icon toast pattern (Home.tsx) when `failed > 0`; flip
     the pin.
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores recorded in a ledger; item 4 is an ffmpeg
  change and takes both-majors Layer 5 (IMG-PREC); items 1, 3, 6 and
  11 land with their e2e cases; `npm run verify`, `npm run
  test:media` and the FULL Playwright suite green before handback;
  no docs/TICKETS.md, package.json or lockfile edits.
- **Status:** done (round 81 — see the Done entry)

---

## T-133 — sweep-19 fixes (round 82)

- **Spec:** the nineteenth review sweep's verified findings — each
  confirmed by the expediter against source; the measured ones were
  executed by the reviewers (real binaries, a real Electron render)
  and spot-replicated. 11 items.
  1. **[MED] The "Open Audio Studio" toast action navigates off a
     live take with no confirm** — the T-132 (1) failure, reachable
     through the fix's own 8 s toast sitting over the REC screen;
     one click unmounts RecordStudio and cuts the take. Same
     family, older and lower odds: the saved-toast "Edit in Video
     Studio" action. Fix: a shared "a take is live" check — the
     toast action (and editInVideoStudio) asks the same confirm the
     Home link asks, or the button is omitted while
     `currentRoute() === '/record'` with a live take. e2e: click
     the action mid-take → the confirm appears (or no button) and
     the take continues.
  2. **[MED] Toast text escapes its card on a long unbroken file
     name.** react-hot-toast styles the message `pre-line` at
     350 px with no overflow-wrap, so an underscores-only name runs
     up to 81 px outside the card (measured in a real render; six
     older `Saved ${basename}` sites plus T-132's "Extracted the
     sound from" toast). Fix: `overflowWrap: 'anywhere'` in
     TOAST_STYLE (the reviewer's harness verified it); pin it in
     the toaster unit test.
  3. **[LOW] clipNameForSentence truncates by UTF-16 unit** and can
     keep a lone high surrogate before the ellipsis (executed: a
     broken glyph in the refusal). Fix: code-point truncation
     (`Array.from(flat).slice(0, 49)`), plus an astral-name unit
     case in noPicture.test.ts.
  4. **[LOW] The ranged caption burn-in is the one ranged video
     writer without the no-picture guard** (executed, both majors:
     a range past the picture exits 0, prints nothing to stderr,
     frame=0, audio-only output — then "Captions burned in"). Fix:
     feed runBurnIn's existing -progress stdout to PictureFrames
     and its stderr to FFMPEG_EMPTY_OUTPUT; on exit 0 +
     wroteNoPicture reject with a finished sentence (the discard
     path removes the stub). Both-majors Layer 5. Soften the
     "every runner that writes a video" claim in noPicture.ts:12
     and STYLE_GUIDE:835 — or make it true, which this does.
  5. **[LOW] wroteOutput's 2 s mtime slack now refuses GOOD
     thumbnails** on a share whose clock runs >2 s behind, aborting
     the kit with a false "no picture" — T-110 (p)'s documented
     cost ("a leftover file, never a lost one") no longer holds on
     the success path. Fix: extractFrame writes into a fresh
     makeKitDir folder, so require only `isFile() && size > 0`
     there (no mtime test; a pre-existing file is impossible by
     construction — assert the target absent before the spawn).
     Update (p)'s wording and the partialOutput comment.
  6. **[LOW] Clean audio silently replaces work tuned DURING the
     extraction.** The replace-ask runs once before the minutes-
     long wait; replacedSince is identity-only; loadSource resets
     the chain and history with no Undo — against USER_GUIDE's
     "asks first". Fix: after the wait, when confirmAudioClose
     would now ask (the held source is unchanged but its chain has
     edits), ask again; a decline takes the existing "Skipped…"
     toast path. e2e: tune during a held extraction → the question
     appears; decline keeps the tuning.
  7. **[LOW] The repeat family's boundary.** (a) A held Enter on
     Done or Skip closes the tour and the surviving auto-repeats
     click the refocused "?" and REOPEN it; FixWizard's Apply →
     "Help me fix this" has the same exposure. Fix:
     swallowRepeatClicks also installs a capture-phase keydown that
     cancels `e.repeat` Enter and Space for REPEAT_SWALLOW_MS (one
     shared guard covers the tour, the wizard and every Modal);
     red-first with a hold-at-Done e2e. (b) Pre-existing: Space
     (Player and Timeline) and the `?` overlay toggle on EVERY
     auto-repeat (~30 Hz stutter; AbortError spam). Fix:
     `if (e.repeat) return` on the toggle cases only — the nudge
     and frame-step keys keep repeating by design.
  8. **[LOW] Reference search's Enter bypasses the loading guard**
     (the button is disabled={loading}; submit() checks only the
     query): duplicate requests, and a stale response can overwrite
     newer results. Fix: `if (loading) return` in submit(); unit or
     e2e pin.
  9. **[LOW] Five disabled buttons have no disabled look**
     (AutosaveRestore ×3, Importer, AudioImporter — Importer's
     label does not even change), while interactionWiring:1817,
     audio.spec:1762 and IC:3521 claim "every other disabled
     button" is dimmed. Fix: add `disabled:opacity-50` to the five
     and make the claims true.
  10. **[LOW] WAVEFORM_READ_FAILED still gives the circular
     "Re-export it as WAV" advice** T-132 (10) removed from the
     playback sentence; its documented trigger IS a WAV. Fix: name
     "a standard PCM WAV or MP3"; move the pins.
  11. **[LOW] Doc corrections:** USER_GUIDE:399's waveform timing
     ("a few seconds" → up to a few tens of seconds, per the T-129
     measurement); STYLE_GUIDE:89's reportFailure signature gains
     the `id?` option; the burn-in guard's IC/TESTING rows land
     with item 4.
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores in a ledger; item 4 is an ffmpeg change
  and takes both-majors Layer 5 (IMG-PREC); items 1, 6 and 7 land
  with their e2e cases; `npm run verify`, `npm run test:media` and
  the FULL Playwright suite green before handback; no
  docs/TICKETS.md, package.json or lockfile edits.
- **Status:** done (round 82 — see the Done entry)

---

## T-134 — sweep-20 fixes (round 83)

- **Spec:** the twentieth review sweep's verified findings — each
  confirmed by the expediter; the MED was executed in a built app by
  the QA reviewer, and the measured claims were replicated. The
  clean lenses this sweep: privacy, electron, a11y. 7 items.
  1. **[MED] Autosave Restore navigates to the snapshot's route
     after a wait that can last minutes, wherever the person now
     is** — the T-132 (1)/T-133 (1) class at its one remaining site
     (found independently by four reviewers; executed: a 14 s held
     extraction, Restore, a take started on Record → the take was
     cut and the app landed on /video). The T-133 wiring table's
     rationale ("The autosave Restore is on Home") is true at the
     click and false at the navigate. Fix: after the await,
     `if (route && currentRoute() === '/home') navigate(route)` —
     continuity for a person still on Home, nobody else moved (the
     "Restored from autosave" toast already reports completion);
     correct the wiring-table comment; add the negative e2e (hold
     the extraction, start a take, assert still on Record and
     recording).
  2. **[LOW] A held I or O re-sets the marker on every auto-repeat**
     (executed against the real store: 60 repeats fill the 50-step
     undo cap and evict real edits — three addClip edits became
     un-undoable; the in-point drifts to the last repeat during
     playback). Fix: `if (!e.repeat)` on the i/o cases in Player.tsx
     and Timeline.tsx, exactly as Space got in T-133 (7b); the
     nudge and frame-step keys keep repeating; unit/e2e per the
     7b pattern.
  3. **[LOW] The single-flight search silently discards a CORRECTED
     query** typed while the first request is out — the results
     answer a query nothing on the page names. The T-133 (8) pin
     documents the drop as intended; the usability tiebreaker says
     latest-wins. Fix: remember the newest query asked during a
     flight and run it when the flight settles (one follow-up, not
     a queue), or apply answers by sequence number; flip the pinned
     drop-test; e2e: type, Enter, correct, Enter → the grid answers
     the corrected query.
  4. **[LOW] Claim corrections, thrice-measured:** noPicture.ts:12
     and STYLE_GUIDE:873-874 say a compilation's segments close on
     `wroteNoPicture(sawEmptyOutput, frames)` — they read the
     stderr line alone, which IS sufficient (measured on both
     majors by three parties: under apad + -shortest the
     past-picture shape yields a truly streamless ~970-byte stub
     AND the "Output file is empty" line at production verbosity).
     Correct both sentences and the docClaims pin that enshrines
     the over-claim; add the one-line scan test listing the
     wroteNoPicture users; correct the "ran up to 81 px OUT"
     wording (the ledger's own red measured 228 px — "up to" is not
     a bound); optionally pin the 5 s/9 s compile shape at Layer 5.
  5. **[LOW] A long unbroken custom-preset name pushes Delete out
     of its dialog** (measured in real Chromium: an 80-character
     spaceless name puts Delete at x=905 against a card ending at
     848; threshold ~72 characters). Fix: `truncate` + `title` on
     the name span per the DESIGN_GUIDE chip rule, a sensible
     maxLength on the name input, and the same cap on
     SafeZoneWarningModal's clipName row (it scrolls sideways
     inside its card); layout case.
  6. **[LOW] The IC native-dialog inventory is stale:** the Record
     row cites RecordStudio.tsx:623 but the confirm lives in
     lib/liveTake.ts:34 since T-133 (1); several rows' line numbers
     drifted; the T-133 (6) second Clean-audio confirm is missing.
     Refresh the inventory (it is what /guide-sync checks).
  7. **[LOW] Clear relabels Restore:** both buttons share one
     `busy` flag, so pressing Clear shows "Restoring…" on Restore
     for the unlink's duration — the label contradicts the action.
     Split the flags (or give Clear its own label); lands in-file
     with item 1.
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores in a ledger; items 1, 2 and 3 land with
  their e2e cases; item 4's optional L5 pin, if added, runs on both
  majors; `npm run verify`, `npm run test:media` and the FULL
  Playwright suite green before handback; no docs/TICKETS.md,
  package.json or lockfile edits.
- **Status:** done (round 83 — see the Done entry)

---

## T-135 — sweep-21 fixes (round 84)

- **Spec:** the twenty-first sweep's verified findings — each
  confirmed by the expediter against source, with the measured
  claims replicated on real binaries (both majors where the finding
  touches ffmpeg) and the layout claims measured in the built app by
  the reviewers. Clean lenses this sweep: privacy, electron, ffmpeg.
  14 items. Most are pre-existing whole-tree finds the earlier
  sweeps never reached; the wave's own delta contributed only items
  5, 6 and 14.
  1. **[MED] Leaving a studio mid-job loses the job's progress and
     Cancel while main keeps working.** Job rows and busy flags are
     component state (`ExportPanel.tsx:186-187`, and the same
     pattern in ClipKitButton, GifPanel, CompilationPanel,
     ReframePanel, PipPanel and audio ExportDialog), so a route
     change unmounts them; the panel comes back idle with Export
     enabled, a retry hits main's "An export is already running.
     Wait for it to finish, or cancel it, then try again." with no
     Cancel rendered anywhere — against USER_GUIDE:310-312's
     promise. The same remount re-arms "Clean audio"
     (`extractingAudio` useState, VideoStudio.tsx:45; `ipc/audio.ts`
     has no single-flight — a second press runs a second concurrent
     extraction whose completions cross-talk) and re-enables
     "Scan VOD" (a second scan overwrites `activeScan`,
     highlights.ts:119, orphaning the first from Cancel and the
     quit sweep). Fix direction: move batch/job state the panels
     render into module stores (the videoStore pattern) OR have a
     mounting panel ask main for the live batch (a small
     `video:exportStatus`-style query) and render rows + Cancel
     from it; give the extraction a single-flight guard at the IPC
     handler (refuse a second start, name the running one) and make
     a second Scan VOD press impossible while one runs (store flag,
     not component flag). Acceptance: an e2e that starts an export,
     navigates Home and back, and still sees progress + Cancel; a
     unit/e2e proving the second extraction is refused.
  2. **[MED] A video the preview cannot decode is a silent dead
     end.** The `<video>` element has no error listener
     (Player.tsx:324-343) and `togglePlay` flips to Pause
     optimistically (`void v.play()`, :203-213); conversion is
     extension-only (mediaFormats.ts), so an HEVC/10-bit/ProRes
     file probes fine, toasts "Video loaded", and plays black with
     no sentence — while README.md:163 says these "should work".
     The audio side already has PLAYBACK_ERROR_MESSAGE. Fix
     direction: an `onError` state on the player naming the truth
     ("imagii can't preview this video's picture format — trimming,
     scan and export still work") with an action that makes a
     preview copy through the existing convert path; `togglePlay`
     follows the `play()` promise instead of assuming success;
     narrow the README sentence to what the preview actually
     decodes vs what export accepts. e2e: a fabricated unplayable
     source (stub the element error in the harness if a real
     undecodable fixture is impractical) asserts the sentence and
     that export stays reachable.
  3. **[MED] The chat spike finder never merges neighbouring
     buckets.** `findPeaks` stores a PADDED `bucketStart`
     (`max(0, k - padSec)`, ChatHighlightPanel.tsx:46) and compares
     the next unpadded key against it (`k - last.bucketStart <
     bucketSec * 2`, :41); with the defaults (bucket 10, pad 15)
     adjacent hype buckets give 25 < 20 = false, so one 30 s chat
     explosion becomes three 40 s rows overlapping by 30 s, and the
     12-row cap fills with near-duplicates; a merged group's window
     also ignores its extra buckets (`end = bucketStart + bucketSec
     + 2*pad`, :104). Fix direction: track the unpadded `firstKey`
     and `endKey`, merge on `k - endKey <= bucketSec` (bridge
     exactly adjacent buckets), window = `firstKey - pad .. endKey
     + bucketSec + pad`; extract the helper to `src/shared/` as a
     pure function with unit tests (IMG-PREC), and an e2e fixture
     with a three-bucket spike that yields ONE row.
  4. **[LOW] Derived results die when the studio is left,**
     including via its own Clean audio button: scan
     candidates/progress, the pasted chat log and its spikes, and
     the transcript preview `segments` are all useState
     (HighlightPanel.tsx:60-68, ChatHighlightPanel.tsx:62-74,
     CaptionsPanel.tsx:47); a scan finishing while away toasts to
     an unmounted panel. Fix direction: hold scan candidates, chat
     text/spikes and the transcript preview in the video store
     keyed by (or reset with) `source.filePath` — `loadSource`
     already resets the store, which keeps the lifetime right.
     e2e: scan, leave, return, candidates still listed.
  5. **[LOW] The corrected-query fix is Enter-only, and the page
     can show a grid its input does not name.** The Search button
     is `disabled={loading}` (ReferencePanel.tsx:87) so a pointer
     or voice-control user cannot send a correction mid-flight
     (the store now accepts it); and `query` is panel-local
     (ReferencePanel.tsx:19) while `searchResponse` is store state,
     so a tab swap to Mood Boards and back shows the grid over a
     blank input — the exact state STYLE_GUIDE:269-272 calls a
     defect. Fix direction: expose the in-flight/answered query
     from the store; disable the button only when
     `loading && typed === inFlightQuery` (the store's same-query
     refusal still backstops a double-click); seed the input from
     the store on mount. e2e: correct a query BY CLICK mid-flight;
     tab away and back, the input names the grid.
  6. **[LOW] SafeZoneWarningModal's zone lines still scroll
     sideways** — T-134 (5) capped the clip-name span only; each
     zone line is a plain div embedding `preset.label`
     (= the custom preset's name, presets.ts:167), measured at
     scrollWidth 474 (60-char name) / 977 (pre-existing 80-char
     name) vs clientWidth 406. Fix: the same `truncate` +
     `title` (or `[overflow-wrap:anywhere]`) on the zone line;
     extend the existing layout case.
  7. **[LOW] The Clear-transcripts confirm overclaims:** "…including
     the one for the video you have open" renders unconditionally
     (CaptionsPanel.tsx:674-675) while the count is folder-wide and
     the open video may have none. Fix: append ", if it has one"
     or branch on whether the open video has a transcript; update
     the copy pin.
  8. **[LOW] Board-name writes fail silently.** Main caps a board
     name at 200 and throws (ipc/search.ts:29,78); neither input
     has a maxLength (MoodBoardPanel, NameDialog) and
     create/rename/delete have no catch; `createBoardAndSave`
     closes the dialog (`setPendingResult(null)`) BEFORE the await,
     so a refused first-save silently drops the picture being
     saved; CustomPresetManager's save/delete are also catchless
     (the audio PresetPanel has had the T-90 catch). Fix:
     `maxLength={200}` on both inputs; wrap the writes in
     `reportFailure`; keep `pendingResult` until the save lands.
     Unit/e2e: a refused create reports and keeps the dialog's
     work.
  9. **[LOW] A project/autosave open replaces a sound opened during
     the video's wait.** The T-113 `replacedSince(heldBefore, …)`
     guard lives only in `extractAgain` (ProjectIO.ts:441-448); the
     fromVideo-scratch and plain-audio load closures (:460-471)
     call `loadSource` unguarded, against the rule's own comment
     (:428-430) — executed in a scratch repro (deferred convert;
     the person's sound was replaced, `skipped` stayed empty). Fix:
     the same one-line guard at the top of both closures (counting
     the skip in `skipped`), red-first test for the plain path
     (existing tests cover only `extractedFromVideo`).
  10. **[LOW] An unknown preset id slips validation and kills
     Export silently.** `validateClipRequiredFields` checks
     `selectedPresets` entries only as strings
     (projectValidation.ts:166-168); ExportPanel:58 then reads
     `PLATFORM_INFO[id]` → `findSafeZoneIssues`/`runExportQueue`
     throw and `void startExport()` rejects unhandled (executed) —
     a hand-edited project, or one from a newer build with a
     preset this build lacks. Fix: drop ids not in `PLATFORM_IDS`
     (shared already) during validation — dropping, not rejecting,
     keeps older builds opening newer projects; unit test both.
  11. **[LOW] A second track with no sound stream fails late and
     blames the wrong file.** Nothing probes the second track
     (SecondaryTrackPanel accepts any path; process.ts:147 probes
     only the primary); measured on BOTH majors: the `[1:a]`
     reference exits 234 with "matches no streams", which matches
     no KNOWN_CAUSES pattern → the generic source/disk sentence,
     after a minutes-long measure pass when Even volume is on.
     Fix: `probeAudio(secondary.filePath)` at the top of
     exportAudio (and ideally at add time) with its own sentence
     ("The second track has no sound in it. Remove it or pick
     another file."); Layer 5 case on both majors (IMG-PREC).
  12. **[LOW] An all-cut chain exports a FALSE SUCCESS.** Measured
     on BOTH majors: cutting everything yields exit 0 and a
     78-byte header-only file (wav AND the aac/mp4 re-attach
     shape) — "Cleaned audio exported" over nothing.
     `writtenSeconds` is already computed (process.ts:158) and
     never checked; the audio path has no empty-output guard
     (video got T-131/T-132's). Fix: refuse before spawning when
     `keptDurationSec` is under ~0.05 s ("Everything is cut out.
     Click a mark to put a part back.", T-84 voice); Layer 5 case
     pinning the exit-0-empty shape on both majors (IMG-PREC).
  13. **[LOW] `sendToCanvas` navigates unconditionally after an
     await** (MoodBoardPanel.tsx:34-47; the awaited image load can
     be a network fetch when the tile fell back to the remote URL)
     — the T-134 (1) class at one more site, blessed by the same
     click-time premise the Restore fix refuted. Fix: navigate
     only `if (currentRoute() === '/references')` (the toast
     already reports the add); correct the wiring-table row; unit
     or e2e per the Restore pattern.
  14. **[LOW, docs] Truth corrections:** the stale comment at
     tests/e2e/home-chrome.spec.ts:1226 still says Restore's label
     changes "while ANY of the banner's actions runs: it is one
     busy flag" — false since T-134 (7) (the tolerant regex hides
     it); reword to the split-flag truth. (The T-134 Done entry's
     matching over-claim in this file is corrected by the
     expediter in the commit that carries this ticket.)
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores in a ledger; items 11 and 12 are ffmpeg
  error-path changes and take both-majors Layer 5 (IMG-PREC); items
  1, 2, 4, 5 and 6 land with their e2e cases; `npm run verify`,
  `npm run test:media` and the FULL Playwright suite green before
  handback; no docs/TICKETS.md, package.json or lockfile edits.
- **Status:** done (round 84 — see the Done entry)

## T-136 — sweep-22 fixes (round 85)

- **Spec:** the twenty-second sweep's verified findings — each
  confirmed by the expediter against source; the Importer, preview
  copy and model-download items were EXECUTED in the built app by
  the electron reviewer, and one reviewer theory (loudnorm on sub-3 s
  silence) was refuted by expediter measurement on both majors.
  Clean lens this sweep: privacy. 16 distinct findings, written as
  15 items in two tracks with DISJOINT source files so they can be
  worked in parallel; the theme is the edges of T-135 (1): long jobs
  its module-store conversion did not reach, and state it introduced.
  **Track A (job state, the Player, the shared Cancel):**
  1. **[MED] A running Clip Kit can become uncancelable.** The run is
     keyed by `clipId` (ClipKitButton.tsx:51-54), Cancel renders only
     for the owning clip, and ClipList renders ONE kit button, for the
     selected clip (ClipList.tsx:105-107) — so selecting another clip
     hides the progress and Cancel behind a disabled button whose
     title gives no reason, and removing the owning clip (✕ → confirm
     → removeClip) or Closing the video leaves every kit button
     disabled and NO Cancel anywhere until the kit ends minutes later
     (only quit stops it). Before T-135 the single button instance
     kept its Cancel across selection. The "one button per row"
     premise at ClipKitButton.tsx:48 and STYLE_GUIDE:297 is false.
     Fix direction: whenever `kitRun !== null`, the rendered kit
     button shows the running kit's label AND its Cancel whichever
     clip is selected, naming the clip it is for ("Clip Kit for
     "<name>": Exporting 2 of 5…" — the name from the run, so it
     survives the clip's removal and a Close); flip the e2e pin at
     video-pipelines.spec.ts:2764-2769; correct USER_GUIDE:331-333,
     STYLE_GUIDE:297 and the component comment. e2e: start a kit,
     select another clip → Cancel reachable; remove the owning clip →
     Cancel reachable and cancels; Close the video → same.
  2. **[MED] A conversion can run twice, and its late landing
     replaces the video being edited.** The Importer's
     flv/ts/wmv/mpg conversion and Player's "Make a preview copy"
     keep their busy state in the component (Importer.tsx:21-31;
     Player.tsx:100-102), and main's `video:convertForImport`
     (ipc/video.ts:191-195) has no single-flight — EXECUTED: a round
     trip re-arms both, two libx264 converts run at once, and the
     Importer's second landing reset 2 edited clips to 1 with no
     confirm (loadSource is not undoable); the preview copy's
     resume-position restore runs on the unmounted instance's refs,
     so the picture restarts at 0:00. Fix direction (one guard in the
     shared function): an `extractingFor`-shaped single-flight on
     main's `video:convertForImport` (claimed before the first await,
     released in finally, the refusal names the file being
     converted) — this also covers ProjectIO's open-path convert;
     `runs.ts` slots for the import and the preview copy so a
     remounted Importer/Player shows the busy label and refuses a
     second start; the Importer's landing asks whether a video
     arrived while it converted (any source in the store that was not
     there at the start) and, if so, does NOT replace it — a T-84
     sentence instead ("Skipped <file> because you opened another
     video while it was converting"); the preview copy's resume
     position lives with its run, not in component refs. e2e: leave
     mid-convert and return (busy shown, second start refused); open
     an mp4 while a conversion runs (the mp4 is kept); preview copy
     leave-and-return (button busy, one convert, position kept).
  3. **[MED] Autosave never fires while anything plays.**
     useAutosave subscribes `scheduleSave` to whole stores with no
     selector (useAutosave.ts:181-183) and every call re-arms the 5 s
     debounce; Player.tsx:399 writes `currentTime` on `timeupdate`
     (~4 Hz) and WaveformView.tsx:88/92 during audio playback, so the
     timer never elapses while playback runs — clips marked during a
     long review are not autosaved until playback stops for 5 s,
     against USER_GUIDE's and the crash screen's "every few seconds".
     Fix direction: the subscription ignores playhead-only changes
     (compare state vs prev and skip when only `currentTime` /
     `transport` changed in video, `currentTime` in audio), AND a max
     wait (a pending change is written no later than 30 s after it
     was first scheduled) so no future high-frequency field can
     starve it again. Unit (fake timers): an edit followed by 60 s of
     250 ms playhead updates writes within ~5 s; churn on a
     non-playhead field still writes by 30 s.
  4. **[LOW] The caption-model download loses its bar and Cancel on a
     round trip** (CaptionsPanel.tsx:71-72 `installing` /
     `installProgress` are useState; EXECUTED: progressbar 1 → 0,
     Cancel 1 → 0, Download re-enabled and refused by main; the
     finishing closure refreshes status on the unmounted instance so
     Transcribe reopens setup). IC:2628 is now false. Fix: a run slot
     for the install holding its progress; status refreshed through
     the store when it ends; correct IC:2628. e2e with `net.request`
     stubbed (the electron reviewer's harness): leave mid-download,
     return → bar + Cancel; Cancel works.
  5. **[LOW] The preview-unavailable notice may not be announced:**
     its `role="status"` mounts together with its content
     (Player.tsx:416-433) — the pattern GifPanel.tsx:88-94 documents
     as not reliably read. Fix: an always-mounted status wrapper per
     GifPanel (empty while the picture draws); wiring pin.
  6. **[LOW] The Output preview stays a silent black box** for a
     picture the Player says it cannot draw (OutputPreview.tsx:40-59,
     111-114: black fill under "Live snapshot at the playhead
     position…"). Fix: share the no-picture fact through the video
     store and say so in the card until a preview copy exists.
  7. **[LOW] The running-job Cancel is hand-copied 8 times and two
     Cancels are off-pattern** (STYLE_GUIDE:731 "If you write the same
     markup a third time, extract it"): the audio export's Cancel
     (ExportDialog.tsx:194-201: not btn-ghost, no danger ink, no
     title) and the Clip Kit's; the progress track is copied 7 times.
     Fix: one shared running-job Cancel (and progress track) used at
     every site, documented in STYLE_GUIDE; a scan test that fails on
     hand-written running-job Cancel markup outside it.
  8. **[LOW, copy] "Cancel PiP composite"** (PipPanel.tsx:192) is the
     only user-facing "PiP"; the heading and toast say
     "Picture-in-picture". Fix: "Cancel picture-in-picture composite"
     (lands with item 7).
  **Track B (small self-contained surfaces):**
  9. **[LOW] The chat spike panel:** (a) T-135 (3)'s merge made row
     length unbounded while the row shows only the start
     (ChatHighlightPanel.tsx:131-133) and rows rank by SUMMED count,
     so a long, moderately busy raid outranks a short explosion and
     "+ Clip" can add a ~5 min clip unannounced — show start → end
     (as Smart highlight rows do) and rank by the densest bucket's
     count; (b) "Extra seconds around each clip" accepts negatives
     (`Number(v) || 0`, advisory min) → zero/reversed windows whose
     "+ Clip" refusal blames the log (executed: pad −5 → [105,105]) —
     clamp 0..60 through DraftField like the bucket box (and clamp in
     findChatPeaks); (c) an empty result is a 4 s toast and the panel
     then looks unanalyzed (`[]` renders nothing) — keep an inline
     line naming the rule ("No chat spikes in N messages: a spike
     needs at least 5 messages in one window and twice the usual
     rate"), and name the rule in USER_GUIDE:345-354; (d) the two
     number boxes sit 16 px apart where the long label wraps
     (measured at 1024/1632/1920) — align the controls (justify-end
     or mt-auto). Unit: ranking + pad clamp; e2e: range text, empty
     line, alignment in the existing layout case.
  10. **[LOW] The pick-time no-sound refusal says "Remove it"** when
     nothing was added (SecondaryTrackPanel.tsx:64-71 reuses the
     export sentence; the e2e pins Remove count 0 right after it).
     Fix: a pick-time sentence of its own ("That file has no sound in
     it. Pick another file."); keep the export one; update
     USER_GUIDE:457-459 and the unit/e2e/L5 pins.
  11. **[LOW] "Last autosave: N ago" stays up right after "Autosave
     cleared"** (AutosaveRestore.tsx:92-103,145-151: the dismissed
     branch draws from mount-time `info`). Fix: a successful Clear
     sets `info` to not-exists; e2e asserts absence right after
     Clear (not only after a revisit).
  12. **[LOW] Two mood-board writes have no catch:** Clear thumbnail
     cache (MoodBoardPanel.tsx:208-213) and the tile ✕
     (removeFromCollection, :285) — T-135 (8) sibling sites. Fix:
     reportFailure on both; failurePathLanguage rows.
  13. **[LOW] The extraction's stderr accumulator is uncapped**
     (extract.ts:128) against LESSONS_LEARNED's every-spawn rule
     (peaks.ts:146, export.ts:170 cap at 16 KB); T-129 made
     multi-hour extractions reachable. Fix: the 16 KB tail idiom, and
     a source scan test that every `stderr` accumulator in src/main
     is capped (kills the class).
  14. **[LOW] The importer's keyword classifier rewrites a finished
     sentence from main** when the quoted file name contains a
     keyword (importDiagnostics.ts:133 matches 'codec'/'decoder'
     anywhere; EXECUTED: "Still extracting the sound from
     "codec_test.mp4"…" became the unreadable-format sentence). Fix:
     match keywords against the message with quoted spans removed;
     unit with the codec_test.mp4 case and a clean-name control.
  15. **[LOW] A compilation whose FIRST segment is lost at the join
     gets a misdirecting sentence** (EXECUTED on both majors):
     concat.ts:386 guards `code === 0 && lostAPart`, but the concat
     demuxer exits 254 when it cannot open its FIRST input, so the
     raw "concat exit 254" reaches userFacingError — "A file imagii
     needs isn't there" (reads as the person's source) or, for a
     Windows lock's unmapped "Permission denied", the generic
     video-tool sentence; a lost later segment gets the clip-naming
     `lostPartMessage`. Fix: key the guard on `lostAPart` alone (any
     exit), so every lost part names its clip; runner case + a
     Layer 5 case for segment 0 on BOTH majors (IMG-PREC).
  **Docs (ride with Track B):** DESIGN_GUIDE "Modals" list (ClipKit
  ×2, the Captions confirm and the Export cancel confirm use Modal);
  STYLE_GUIDE NameDialog entry gains `maxLength`; ProjectIO.ts:435-436
  comment ("can run beside") is false since T-135's single-flight.
  (Track A owns ClipKit/USER_GUIDE:331-333/STYLE_GUIDE:297.)
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores in a ledger; every behavior item lands
  with its e2e (items 1, 2, 3 (unit with fake timers), 4, 9, 11) or
  unit/wiring pin; items 13 and 15 touch main-process runners and
  item 15 takes both-majors Layer 5 (IMG-PREC); new cases go in NEW describe blocks appended at
  the end of shared spec/test files (the two tracks land serially);
  `npm run verify`, `npm run test:media` and the FULL Playwright
  suite green before handback; no docs/TICKETS.md, package.json or
  lockfile edits.
- **Status:** done (round 85, both tracks — see the two Done entries)

## T-137 — sweep-23 fixes (round 86)

- **Spec:** the twenty-third sweep's verified findings — each
  confirmed by the expediter against source; the project-size,
  autosave-rewrite and kit-label findings were EXECUTED or measured
  in the built app by reviewers; the Record take-deletion path was
  traced by the expediter to the unlink. Zero-finding lens: ffmpeg.
  12 findings, written as two tracks with DISJOINT source files.
  **Track A (job and screen state):**
  1. **[MED] Audio Studio's importer keeps its extraction in the
     screen, and a late landing replaces whatever is open.**
     AudioImporter.tsx:21,28 holds busy/busyRef/extractingRef as
     component state and its landing (:52-58) calls loadSource with
     no `replacedSince` — leave mid-extraction, come back to an idle
     importer, drop a plain WAV (main's extractingFor refuses only a
     second EXTRACTION) and edit it; the first extraction's landing
     resets source, chain and history (no confirm, not undoable),
     against USER_GUIDE:435-437. The exact T-136 (2) class at the
     importer T-136 did not reach. Fix direction: an audio-import run
     slot (the useImportRun pattern, in audio-studio state) so a
     remounted importer shows busy and refuses a second import, and
     a landing that asks `replacedSince(heldBefore, source)` and
     skips with a sentence (VideoStudio's "Skipped this video's
     sound…" shape). e2e: leave mid-extraction and return (busy);
     open a WAV while an extraction runs → the WAV is kept.
  2. **[MED] A second take's Discard can delete the FIRST take.**
     RecordStudio.tsx:49,87,90 keeps phase/savePercent/discarding as
     component state and the live-take guard registers only during
     'recording', so leaving during a save returns an idle Record
     over a running convert; a second take's "Discard recording"
     calls cancelRecordingConvert() → cancelConverts('recording')
     (convert.ts:288), which cancels EVERY recording-owner convert;
     the first take's save then sees ConvertCancelledError with
     byQuit false → keepTake false → recording.ts:357 unlinks its
     raw webm (and the half mp4 is removed). Fix direction: Record's
     save phase and percent in a module run slot (a remounted Record
     shows the save and its Discard; Start is refused while a save
     runs, in a T-84 sentence); Discard cancels ONLY its own take's
     convert (scope the cancel by the take's session/job id, not by
     owner — main must refuse to touch another take); unit for the
     scoping; e2e: leave during a save and return → saving shown;
     a discard cannot touch another take's file.
  3. **[LOW] The running-kit card's live region is not reliably
     announced.** ClipKitRunning (ClipKitButton.tsx:77-94) mounts its
     `aria-live` paragraph WITH its text — the class T-136 (5) fixed
     for the Player notice. Fix: an always-mounted live-region
     wrapper (empty while no kit runs) per GifPanel.tsx:88-94.
  4. **[LOW] The running Clip Kit label wraps mid-sentence** at the
     default and minimum windows (measured: 197x42 px, the clip list
     jumps ~36 px). Fix: the label on one line (whitespace-nowrap)
     and its Cancel on a row of its own under the button (DESIGN_GUIDE's
     rule for a primary wider than its idle label) or on the caption
     row; an `expectOneLine` layout case (DESIGN_GUIDE:325). Name the
     RunningCancel placements the code actually uses in DESIGN_GUIDE.
  5. **[LOW] The preview copy's skip toast blames "another video" on
     a plain Close** (Player.tsx:268-271; staleCaptionsMessage,
     shared/captions.ts:354-358, documents the same wording error).
     Fix: closed-or-replaced wording (branch on source === null or
     reuse the staleCaptionsMessage shape); pin the sentence.
  **Track B (data, validation, main):**
  6. **[MED] A project over 50 MiB saves but will not reopen, and
     autosave silently stops.** MAX_BYTES (projectValidation.ts:40)
     gates load (:410-411) and autosave (:444-448, console only), but
     project:save (ipc/project.ts:35-46) writes PRETTY-printed JSON
     with no size gate, and ImportPanel.tsx:69-75 keeps each image's
     full-size data URL though the layer is drawn at most 800 px —
     executed: four 11 MB PNGs → autosave stops, Save writes 56.9 MiB
     with "Project saved", Open refuses with the damaged-file
     sentence. Fix direction: ONE size rule for save and load measured
     on the same serialization (save refuses with a finished sentence
     naming the size and what to do, before the dialog when the size
     is known); a size-refused autosave raises ONE coalesced toast per
     session (not console only); ImportPanel stores a canvas-bounded
     copy (downscale to the layer's max dimension, keep aspect and
     format sensibly). e2e/unit per piece.
  7. **[LOW] The autosave dedupe never matches** — useAutosave.ts:209
     compares JSON.stringify(captureProject()) whose savedAt is
     Date.now() (ProjectIO.ts:83), so any non-captured store change
     (Find chat spikes, Scan VOD, a grid toggle) rewrites an identical
     autosave.json and rotates autosave.prev (executed: 28.4 MiB
     rewritten for a ticked Grid). Fix: dedupe on the project with
     savedAt neutralised; correct the :159 comment; unit: a
     non-captured change writes nothing.
  8. **[LOW] The loudness measure pass keeps all of its stderr.**
     process.ts:116-117 skips the cap when collectStderr is true, and
     stderrCapped.test.ts counts the handler as capped because a
     slice(-16384) is PRESENT (presence, not path) — T-136 (13)'s
     "every accumulator is capped" is false here. Fix: tail-cap the
     measure pass too (loudnorm prints its JSON last; keep e.g. the
     last 64 KB) and make the scan treat a cap the handler can skip
     under a condition as uncapped, with a discrimination case for
     exactly this shape.
  9. **[LOW] A chat row near a VOD's end shows an end past the
     video** (ChatHighlightPanel.tsx:144-146 prints p.endSec raw;
     addPeak clamps to duration at :59-60) against USER_GUIDE's "adds
     exactly that range". Fix: display the clamped start and end;
     e2e with a tail spike.
  10. **[LOW] Canvas reference layers die with the thumbnail cache:**
     "→ Canvas" sets layer.src to fileUrl(item.cachedThumbPath)
     (MoodBoardPanel.tsx:262-265 → makeReferenceLayer); Clear
     thumbnail cache (and the launch sweep after a board item is
     deleted) leaves an invisible layer with no marker
     (Canvas.tsx:65-68) and saved projects carry the dead src. Fix:
     embed a canvas-bounded copy of the picture when sending it to
     the canvas (it must respect item 6's size rule), or say so in the
     clear toast and USER_GUIDE:579-583 — prefer embedding (expected
     usability).
  11. **[LOW] A non-array customPresetIds passes validation and
     crashes /video** (validateClipRequiredFields never checks it;
     ExportPanel.tsx:60 iterates it in render; executed: 5, {a:1},
     true validate ok and throw) — autosave and Restore re-crash until
     Clear. Fix: require undefined or string[] (drop invalid entries,
     like dropUnknownPresetIds); harden videoStore.pruneCustomPresets;
     unit both.
  12. **[LOW] Two stderr regexes match ffmpeg's echo of a user path.**
     FFMPEG_UNREADABLE_PART = /Impossible to open/ (concat.ts:48) is
     unanchored and ffmpeg echoes the output path at default log level
     ("Output #0, mp4, to '<dir>/…'"), so a folder or source named with
     the phrase fails a good join (any exit since T-136 (15));
     FFMPEG_EMPTY_OUTPUT has the same shape. Fix: anchor each to
     ffmpeg's own line (and require the seg-<job>-N.mkv name that
     unreadableSegmentIndex parses); unit with an echoed path
     containing each phrase.
  **Docs (ride with the owning track):** DESIGN_GUIDE RunningCancel
  placements (Track A, with item 4); fold the model download's
  net.request into the T-110 (bi) wording (expediter).
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores in a ledger; items 1, 2, 4, 6, 9 and 10
  land with their e2e or layout cases; item 8 and item 12 touch
  main-process runners (unit + the scan; item 12's regex change is a
  guard on ffmpeg output — add a Layer 5 assertion that a real join
  with the phrase in its OUTPUT folder succeeds, both majors,
  IMG-PREC); new cases in NEW describe blocks appended at the end of
  shared files; `npm run verify`, `npm run test:media` and the FULL
  Playwright suite green before handback; no docs/TICKETS.md,
  package.json or lockfile edits.
- **Status:** done (round 86, both tracks — see the two Done entries)

---

## T-138 — sweep-24 fixes (round 87)

- **Spec:** the twenty-fourth sweep's verified findings — each
  confirmed by the expediter against source; the Windows lost-part
  regex was EXECUTED on the real shipped win32 ffmpeg (ffmpeg-static
  b6.1.1, gyan.dev 6.1.1 essentials) under Wine by the ffmpeg
  reviewer and its premise checked by the expediter in mingw-w64's
  own printf (`%p` is zero-filled hex with no "0x"); the Clip Kit
  dialog's live-region ancestry and the second-scan orphan were
  executed in the built app. Zero-finding lens: privacy. 9 findings,
  written as two tracks with DISJOINT source files.
  **Track A (main process and ffmpeg):**
  1. **[HIGH] The lost-part guard never matches on the shipped
     Windows binary.** concat.ts:55 `FFMPEG_UNREADABLE_PART` and :86
     `unreadableSegmentIndex` (T-137 (12)) accept only a glibc-style
     `[concat @ 0x…]` prefix; the win32 build prints
     `[concat @ 00007fffff45eb80] Impossible to open '…seg-j-9.mkv'`
     (CRLF, often after a `\r`-ended stats line), so on Windows a
     lost later segment saves a shorter file as "Saved" (the T-131 (1)
     bug, back) and a lost first segment shows raw "concat exit 254";
     the clip is never named. Layer 5 on the win32 exe: T-136 (15) x2,
     the T-137 (12) control and T-131 (1) :7580/:7595 are red, so
     release.yml's windows-latest `test:media` would fail at tag time.
     Fix direction: ONE prefix for both patterns,
     `\[concat @ [^\]\n]*\] ` (noPicture.ts's shape), the rest of
     each pattern unchanged (still line-anchored, still the runner's
     `seg-<job>-<n>.mkv`); unit fixtures in concat.test.ts and
     concatRunner.test.ts with the mingw lowercase form, the MSVCRT
     uppercase form, CRLF, and the line after a `\r` stats line (red
     on the current regex), and the echoed-path negatives kept; audit
     EVERY regex in src/main that reads ffmpeg/ffprobe output for a
     platform-specific shape (pointer, line ending, path separator)
     and list the audit in the ledger. Layer 5 (IMG-PREC): the T-131
     (1), T-136 (15) and T-137 (12) blocks green on the bundled 7.0.2,
     the distro 6.1.1 AND the win32 exe under Wine (harness below);
     then the WHOLE Layer 5 file once on the win32 exe, every failure
     reported and classified (Wine timing vs a real Windows-only
     defect) — fix only what is in this item's scope, report the rest.
  6. **[LOW] The guides name two of the three loudness targets.**
     USER_GUIDE.md:473-474 ("pick … (−16) or … (−14)") and
     README.md:127 omit "Broadcast TV and radio (−23)"
     (LevelsPanel.tsx:35, shipped since 2ff0eb1). Fix: name it in
     both; a docClaims pin that USER_GUIDE's Levels line names every
     `LUFS_PRESETS` target.
  9. **[LOW] A second highlight scan orphans the first past quit.**
     ipc/video.ts:375-386 `video:findHighlights` has no main-side
     claim, and highlights.ts:71/:119 keeps ONE `activeScan` slot a
     second scan overwrites; Cancel and `cancelAllHighlightJobs` reach
     only the slot. After a renderer reload (the render-process-gone
     auto-reload, or Ctrl+R) the renderer's `useScanRun` is fresh
     while main's scan runs; a second "Scan VOD" starts a second
     ffmpeg, Cancel stops the newest, and the older survives
     `app.quit()` (executed: PPID 1). Fix direction: `scanningFor`
     in `registerVideoIpc`, claimed before the handler's first await
     and given back in a `finally` (the `convertingFor` pattern), the
     refusal a finished sentence naming the running video that
     `userFacingError` lets stand and the panel shows; unit over the
     real handler (a second call refused, the slot back on success,
     failure and cancel); e2e: a scan held running, the renderer
     reloaded, the video reopened, "Scan VOD" refused in its
     sentence, and after `app.close()` no scan child alive (by PID);
     audit every module-level single-slot child tracker in src/main
     (each either has a main-side claim on its handler or holds a
     set) and list it in the ledger.
  Non-counted, rides with Track A: process.ts:224-226's "loudnorm is
  linear there" becomes true to the filter (linear only when its
  measured LRA is within the target; T-110 (bj)).
  **Track B (renderer and guides):**
  2. **[MED] An imported picture is stored at 1600 px whatever the
     document.** ImportPanel.tsx:72-75 bounds the stored copy to
     `STORED_IMAGE_MAX_DIM` (imageBounds.ts:17, 2 x 800) though a
     layer is freely resizable and the templates are 1280 to 3840 px
     documents: a 1920x1080 overlay frame or a 4K background enlarged
     to fill a 1920/2560/3840 overlay exports 1.2x to 2.4x upscaled
     (worse at the HiDPI 2x default), and re-importing bounds it
     again. Fix direction: `storedImageMaxDim(docWidth, docHeight)` =
     max(`STORED_IMAGE_MAX_DIM`, 2 x the document's longer side) in
     imageBounds.ts (unit), read from the canvas document at import
     time; a picture within it is kept as it came, the format rules
     unchanged; the size rule handles the sum. e2e: a 1920x1080 PNG on
     the 1920x1080 overlay template is stored at 1920x1080, a 4000x3000
     PNG there at 3840x2880, and on the 1280x720 thumbnail template at
     2560x1920; the existing bounded-copy case adapted (not loosened)
     to the document it runs on; the "→ Canvas" 800 px reference copy
     unchanged. USER_GUIDE's 1600 px wording follows.
  3. **[LOW] The over-limit sentences say "shrink", which frees
     nothing.** projectValidation.ts:72/:74 "Remove or shrink large
     images on the canvas": scaling a layer changes scaleX/scaleY,
     never `src`, so Save and autosave refuse again. Fix: "Remove some
     of the large images on the canvas, or import smaller copies of
     them" (Save: ", then save again."; autosave: ", and it will start
     again."), still finished sentences under 240 characters; the
     unit and home-chrome.spec pins and USER_GUIDE:624-625 follow.
  4. **[LOW] The Clip Kit's confirm dialog opens inside a live
     region.** ClipKitRunning's always-mounted `aria-live` wrapper
     (ClipKitButton.tsx:91, T-137 (3)) holds the card, whose
     `<KitCancel />` (:99) renders its `<Modal>` inline (Modal does not
     portal): pressing the closed-video card's Cancel inserts the whole
     dialog into the polite region (executed:
     `[role=dialog].closest('[aria-live]')` is the wrapper). Fix
     direction: the confirm Modal is rendered OUTSIDE the wrapper —
     ClipKitRunning holds the confirm state and returns the wrapper
     and the Modal as siblings (KitCancel split into its button and a
     shared confirm dialog); the clip-list path keeps its arrangement
     (already outside any live region); no Modal change. e2e: on the
     closed-video card, the dialog has no `[aria-live]` /
     `[role=status]` ancestor, Keep running keeps the kit, Cancel jobs
     ends it, and the empty wrapper's 20 px gap still holds; the same
     ancestry assertion on the clip-list path.
  5. **[LOW] A return to Home mid-restore offers Restore again.**
     AutosaveRestore.tsx:46 `restoring` is component state, `dismissed`
     is set only after the await (:124) and `holdsWork` is read once
     per mount, false while a restored sound is still being extracted:
     the person who leaves Home during a long Restore (T-134 (1),
     USER_GUIDE:107) and returns gets an enabled Restore; a second
     press re-applies the project, dismisses the first restore's
     progress toast (shared ids, ProjectIO.ts:394-401, 443-453) and can
     run a second extraction and a false "Skipped the autosave's
     audio" toast. Fix direction: the restore is a run slot
     (`createRunStore`, claimed before the first await, ended in
     `finally`); a banner mounted while it runs shows Restore as
     "Restoring…" and both buttons off (Clear keeps its own flag,
     T-134 (7)); when the run ends under a mounted banner the banner
     goes. e2e: a restore held open (record.spec.ts:2148's seam), Home
     left and re-entered: "Restoring…" and both off; released: the
     banner gone, ONE "Restored from autosave", no skip toast, one
     extraction request in main.
  7. **[LOW] DESIGN_GUIDE's placement-2 rule is false for the Clip
     Kit it names.** DESIGN_GUIDE.md:223-224: "under the primary when
     the primary is wider than its busy label (… the Clip Kit)", but
     the kit's busy label is the wider (measured 154 px idle, 233 px
     running). Fix: state the criterion that is true for all five
     (GIF, Compile, PiP, Export, Clip Kit) and keep "a new Cancel takes
     the first placement that applies" decidable.
  8. **[LOW] A STYLE_GUIDE sentence describes the wrong component.**
     STYLE_GUIDE.md:975-976 "Its two buttons have a busy flag each
     (`restoring`, `clearing` …)" follows the "→ Canvas"
     (MoodBoardPanel) sentence; the buttons are AutosaveRestore's
     (T-134 (7)). Fix: move it back beside the AutosaveRestore text
     (:968-972), updated for item 5.
  Non-counted, rides with Track B: `loadImage` (lib/boundedImage.ts)
  sets `referrerPolicy = 'no-referrer'` (PRODUCT_GUIDE:52's promise
  held by construction, as the two `<img>` sites do; pin it);
  networkAllowlist.test.ts:550-553's comment says what "→ Canvas"
  does now (it embeds a copy; ledger (g)'s premise narrowed).
  **Docs (ride with the owning track):** LESSONS_LEARNED (item 1: a
  pattern on a tool's log prefix holds on every platform the product
  ships; item 2: a bound sized to where a thing is placed, not where it
  can be dragged), IC rows, TESTING paragraphs, USER_GUIDE lines.
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores in a ledger; items 2, 4, 5 and 9 land with
  their e2e cases; item 1 lands with its unit fixtures and Layer 5 on
  all three binaries (7.0.2, 6.1.1, win32 under Wine) and the whole
  file once on win32 with every failure classified; items 3, 6, 7 and
  8 with their pins; new cases in NEW describe blocks appended at the
  end of shared files; `npm run verify`, `npm run test:media` and the
  FULL Playwright suite green before handback; no docs/TICKETS.md,
  package.json or lockfile edits; processes stopped by explicit PID
  only.
- **Status:** done (round 87, both tracks — see the two Done entries)

---

## T-139 — sweep-25 fixes (round 88)

- **Spec:** the twenty-fifth sweep's verified findings — each
  confirmed by the expediter against source; the save overwrite, the
  autosave overlap, the oversize stored copy and the banner after
  Open project were EXECUTED in the built app by reviewers; the
  "Permission denied" line was captured from the shipped win32 exe
  under Wine; the whisper.cpp releases page was fetched by the
  expediter. Zero-finding lenses: privacy, a11y. 10 findings, written
  as two tracks with DISJOINT source files.
  **Track A (main process and error mapping):**
  1. **[MED] Saving over a file destroys it when the write fails.**
     ipc/project.ts:52 `writeFile(result.filePath, raw)` truncates the
     chosen file first: a save over an existing project on a full or
     removed drive (or a crash mid-write) leaves neither the old
     project nor the new one (executed: ENOSPC on a tmpfs left a
     2,097,152-byte unparseable file). Same shape at ipc/image.ts:47
     and :83, ipc/captions.ts:124 (copyFile onto the chosen path) and
     search/moodboard.ts:195, :237, :258 (a truncated board silently
     drops out of the list). Fix direction: ONE helper in src/main
     (`writeFileAtomic(path, data)`: a unique tmp name in the SAME
     directory, then `rename` over the target, the tmp unlinked on any
     failure, the error rethrown), used at every write of a file the
     person chose or owns (project, image export, the .srt copy as
     copy-to-tmp then rename, the board writes); autosave.ts keeps its
     own tmp + rename. Unit (fault injection over the real handler or
     the helper): a write that fails after it began leaves the old
     file byte-identical and no tmp behind; the success path writes
     exactly the bytes.
  3. **[LOW] Overlapping autosave writes corrupt both autosave
     slots.** autosave.ts writes through ONE fixed `autosave.tmp`
     (:55) with no exclusion; the renderer's doSave can start a second
     write while one is in flight (lastWriteTime is set after the
     await, useAutosave.ts:243-247) and quitFlush.ts:90 writes beside
     it; overlapping calls truncate each other's tmp, a mixed file is
     renamed into autosave.json and copied over autosave.prev.json
     (executed: both slots corrupt in 6 of 6 overlapping trials).
     Fix direction: serialize `writeAutosave` in main (one promise
     chain: each call runs after the previous one settles; the last
     content wins) and give each write its own tmp name; unit: two
     concurrent writes of different sizes leave a parseable current
     AND prev, and current is the later content.
  10. **[LOW] ffmpeg's "Permission denied" gets the generic
     sentence.** userFacingError.ts:81-84 and importDiagnostics.ts:
     122-127 map EBUSY/EPERM/EACCES/"access is denied" to "Windows
     blocked access…", but the shipped win32 ffmpeg says "Error
     opening output files: Permission denied" (MSVCRT maps a sharing
     violation / ACL block to EACCES), so a file held by antivirus or
     an editor is told to check disk room and the source. Fix
     direction: map "permission denied" when it is a runner or probe
     exit's cause (the `… exit N: …: Permission denied` shape), and
     keep "Screen recording permission denied" unmapped
     (record.spec.ts:1099-1108 pins it); unit rows built from the
     captured win32 lines (export, probe), plus the screen-recording
     control.
  Non-counted, rides with Track A: chain.ts:161-166's "picture and
  sound agree to within one 256-sample block" holds only for a chain
  without afftdn or the limiter (T-110 (bl)) — say so.
  **Track B (renderer, copy and guides):**
  2. **[MED] An imported picture lands mostly off a small canvas.**
     ImportPanel.tsx:65-66 places a picture at min(its size, 800 px)
     whatever the document and canvasStore.ts makeImageLayer starts it
     at (60, 60); on the 112x112 emote template a 512x512 art file
     shows a 52 px corner, the other handles are off the stage, and
     there is no size field or fit control. Fix direction: the FIRST
     placement fits the document — the drawn size also bounded by the
     document (scale = min(1, 800 / longer side, docW / w, docH / h))
     and the position kept inside it (x = min(60, docW - w), likewise
     y, never negative) — for a drop, the file chooser, a paste and
     "→ Canvas"; templates' own layers untouched. E2E: a 512x512 PNG
     on the emote template lands wholly on the canvas; a tall picture
     on the 1200x480 banner likewise; the 1920 overlay keeps today's
     placement; docClaims pins and USER_GUIDE follow.
  4. **[LOW] One picture's stored copy can exceed the project size
     limit.** T-138 (2)'s `storedImageMaxDim` bounds pixels, not bytes,
     and only an image/jpeg source is re-encoded as JPEG: a 9000x6000
     PNG on the 4K overlay became a 54 MB data URL and paused autosave
     at once (executed). Fix direction: a byte budget per stored copy
     (`STORED_IMAGE_MAX_BYTES` in imageBounds.ts, about 16 MiB of data
     URL): over it, an opaque picture is re-encoded as JPEG at the same
     bound; still over (or transparent), the dimension steps down until
     it fits; the budget applies to a picture within the pixel bound
     too (it is then re-encoded rather than kept as it came). Unit for
     the step rule; e2e with a large incompressible PNG on the 4K
     template (stored under the budget, autosave not paused).
  5. **[LOW] The autosave banner stays after Open project, and its
     Restore replaces what was opened.** AutosaveRestore.tsx:44 reads
     `holdsWork` once per mount; Home.tsx:34-62's Open project applies
     the project and stays on Home, so the same banner offers Restore
     and pressing it applies the snapshot over the opened project
     (executed). Fix direction: the banner goes when Home's Open
     project lands (a shared signal beside `useRestoreRun`, as
     `applied` does), and `restore()` re-asks `sessionHoldsWork()` at
     press time as a backstop (the banner goes, nothing is applied).
     E2E: QA's probe — autosave seeded, a project opened from Home,
     the banner gone; and the backstop's unit/wiring pin.
  6. **[LOW] The captions setup names a file the releases page does
     not offer.** CaptionsPanel.tsx:343-352 and USER_GUIDE.md:392-396
     say "Download whisper-cli.exe from the whisper.cpp releases (the
     Windows build)", but the release marked Latest (v1.9.5) carries
     only source archives, the Windows builds are zips
     (whisper-bin-x64.zip) under the b-series pre-releases, and no
     asset is named whisper-cli.exe. Fix direction: name the zip, say
     it may be listed under a pre-release, and say to extract it and
     put whisper-cli.exe AND the .dll files beside it into the folder
     the panel opens (true whatever the owner's DLL hand-check
     decides); check the zip's real layout (a top-level folder or not)
     before wording it; link to github.com/ggml-org/whisper.cpp/
     releases (the pins on the two caption links follow).
  7. **[LOW] DESIGN_GUIDE's decision order contradicts its own
     placements.** DESIGN_GUIDE.md:232-235 sends the Clip Kit (it
     always answers pickOutputDir) beside the primary, Audio Studio's
     export (it draws a ProgressTrack) to the progress row, and the
     Export panel (ProgressTrack rows) to the progress row — the
     guide's own list and the code place them under the primary,
     beside it, and under it. Fix: an order that reproduces the listed
     classification (the sentence-label case; what "reports a percent"
     means for a queue row and for the audio row; a dialog ALWAYS
     answered between press and job), the docClaims pin following.
  8. **[LOW] DESIGN_GUIDE's GIF widths do not reproduce.** :225 "GIF
     112 px idle and 120 busy" measures 102 / 109 in the built app
     (Inter loaded); LESSONS repeats them as "re-measured". Fix:
     re-measure in the built app and correct, or drop the pixel
     figures and keep the criterion; correct LESSONS likewise.
  9. **[LOW] A double-press on three record-creating buttons.**
     PostChecklist.tsx:139-156 ("+ Log post") clears the name
     synchronously, so the second press of a double-click raises red
     "Add a clip name first" after "Added to your posting log";
     PresetPanel.tsx:41-58 and CustomPresetManager.tsx:74-122 clear
     after the awaited write, so the second press gets the red "name
     first" or, on a slow write, saves a DUPLICATE. Fix direction:
     `isRepeatPress` on the posting log's add; `claimFirst` and the
     button disabled while the write is out on both preset saves (the
     T-131 family's tools). E2E: a double-click adds one entry / one
     preset and raises no error toast. MEASURE FIRST (report either
     way): whether a double-click on Welcome's "Let's go" lands its
     second press on a Home NavCard at 1366x768 and 1536x864; if it
     does, the same family's fix and an e2e.
  Non-counted, rides with Track B: boundedImage.ts's "third place an
  Image fetches one" comment undercounts (Canvas.tsx's useImage is
  another; ledger (g)).
  **Track C (docs; expediter follow-up from Track B's found-not-fixed,
  Haiku):** README.md's whisper lines (the ggml-org link, the
  whisper-bin-x64.zip download, the exe and its .dll files) and its
  large-picture line (the stored copy is bounded, not the original
  at full size); the INTERACTION_COVERAGE Home table's stale
  Home.tsx / AutosaveRestore.tsx cites and the Welcome row (its
  chain and "never directly clicked" flag); a docClaims block that
  holds each.
  **Docs (ride with the owning track):** LESSONS_LEARNED entries
  (item 1: a write over the person's file is the old file until the
  new one is whole; item 2: a placement is sized to where it lands),
  IC rows, TESTING paragraphs, USER_GUIDE lines.
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores in a ledger; items 2, 4, 5 and 9 land with
  their e2e cases; items 1, 3 and 10 with unit cases over the real
  module (fault injection where the failure is a disk's); items 6, 7
  and 8 with their pins; new cases in NEW describe blocks appended at
  the end of shared files; `npm run verify`, `npm run test:media` and
  the FULL Playwright suite green before handback; no docs/TICKETS.md,
  package.json or lockfile edits; processes stopped by explicit PID
  only.
- **Status:** done (round 88, three tracks — see the three Done entries)

---

## T-140 — sweep-26 fixes (round 89)

- **Spec:** the twenty-sixth sweep's verified findings — each
  confirmed by the expediter against source; the destroyed replace
  target was EXECUTED by two reviewers (a Cancel 1.5 s into a real
  export, and ENOSPC on a 1 MB tmpfs); the Stream Graphics layout was
  measured in the built app at 1024x640 and after a 1632 → 1024
  shrink. Zero-finding lenses: privacy, ffmpeg. 11 findings (item 5
  carries two), written as three tracks with DISJOINT source files.
  **Track A (main process: ffmpeg outputs):**
  1. **[MED] A cancelled or failed render destroys the file it was
     replacing.** Every ffmpeg runner writes STRAIGHT to its final
     path (`-y`), and its failure path then removes what is there:
     audio/process.ts:238/:349-351 (the export the Save dialog at
     ipc/audio.ts:159-165 named) and the re-attach mux :528-544, both
     through :131-134 `discardPartialOutput`; whisperManager.ts:496/
     :524-526 → :575-579 (the burn-in, captions.ts:137-147's dialog);
     ipc/recording.ts:268-298 → :318-322 (an unconditional unlink of
     the chosen path) and :227-232 (unlink, then copy); and the folder
     exports, which name their outputs deterministically (video.ts:
     360-361 `_reframe-WxH-pos.mp4`, :581 `_pip.mp4`, export.ts,
     gif.ts, concat.ts ×2, frame.ts), so exporting the same clip into
     the same folder again replaces the earlier export. ffmpeg
     truncates the target when it opens it; a Cancel or a failure
     after that leaves NEITHER the old file nor the new one, and the
     toast says only "canceled" (executed: an existing 100,000-byte
     file gone after `cancelAudioJob`; gone after ENOSPC exit 228).
     The T-139 (1) class — a write over the person's file is the old
     file until the new one is whole — for the files ffmpeg writes.
     Fix direction: ONE shared mechanism in ffmpeg/partialOutput.ts —
     a runner renders to a sibling partial in the SAME folder whose
     name keeps the extension (e.g. `<stem>.<8 hex>.partial<ext>`, so
     ffmpeg still picks the muxer from it; or pass `-f` explicitly),
     the partial is renamed over the target only after the exit 0 AND
     the runner's existing checks (wroteOutput, noPicture, the
     segment checks), and the failure / cancel / quit paths unlink
     ONLY the partial (`discardPartialOutput` keeps its spawn rule for
     the partial). Every caller of `discardPartialOutput` and
     recording.ts's convert/remux/copy move to it; frame.ts's kit
     folder (a fresh folder, a target that must not exist) may keep
     its shape if the worker shows it cannot replace anything — say
     so. The tmp is swept like the atomic writer's: a launch sweep or
     the existing temp cleanup must not leave a crashed run's
     `.partial` beside the person's files forever (decide: sweep
     partials older than N hours in the folders imagii wrote to, or
     document the leftover as the crash ceiling, with a
     `// simplification:` naming it). tests/unit/atomicWrites.test.ts:
     15-18's "the discard is the answer to a failed spawn write"
     comment changes with it. Unit over the real runners (cancel and
     fail AFTER ffmpeg opened the output: the old file is
     byte-identical, no partial left; success: the target holds the
     new render, no partial left). **Layer 5 on BOTH majors
     (IMG-PREC: every runner's command changes its output path):** a
     real export, audio export, burn-in, GIF, reframe and compile over
     an existing target — cancelled mid-run (old file byte-identical)
     and completed (new file valid by ffprobe) — 7.0.2 via
     `npm run test:media`, 6.1.1 via the 611 config. E2E: the shared
     e2e listing filter (tests/e2e/atomicTmp.ts `withoutAtomicTmp`)
     also drops the partial name, and one e2e re-exports a clip into
     a folder that holds its earlier export, cancels, and finds the
     earlier export still there.
  Non-counted, rides with Track A: audio/process.ts:382-389's
  unqualified "agree within one 256-sample block" (T-110 (bl) — true
  only without afftdn or the limiter; say so, as chain.ts now does).
  **Track B (renderer: Stream Graphics):**
  2. **[MED] "+ Add text" places dark text at a fixed point.**
     ImportPanel.tsx:122-124 `addLayer(makeTextLayer(120, 120))` and
     canvasStore.ts:341-358 (`fontSize: 32`, `fill: BG_BASE`
     #120c0c) whatever the document: on the 112x112 emote the text
     starts at (120,120), wholly off the canvas (selected and
     invisible); every template background is #120c0c, #241614 or
     transparent (templates.ts), so the text is 1.00-1.11:1 against
     it. "+ Add text" is the compact panel's control once a template
     is applied — the thumbnail/overlay flow. The sibling of T-139
     (2), which fixed pictures only. Fix direction: makeTextLayer's
     caller passes the document — the text placed inside it by the
     `placementFor` margin rule (imageBounds.ts) using the text's
     measured or estimated box, the font size scaled to the document
     (a 32 px line on a 3840 overlay is a speck; on the emote it must
     fit), and a fill that contrasts with the document background
     (light on dark or transparent; BG_BASE on light; from tokens,
     contrast measured, the rule a pure helper in src/shared with a
     unit). E2E: Add text on the emote and on a dark thumbnail — the
     layer's box is wholly inside the document and its fill is not
     the background's; the blank white canvas keeps dark text.
  3. **[LOW] A corner drag stretches a picture.** Canvas.tsx:516
     `keepRatio={false}` for every layer: dragging a picture's corner
     distorts it, the distortion is exported (scaleX/scaleY stored),
     and Shift (Konva's free-ratio key) is documented nowhere. Fix
     direction: keepRatio for image layers (Shift frees it — say so in
     the shortcuts overlay and USER_GUIDE), shapes and text unchanged
     (decide text and say why). E2E: a corner drag on a picture keeps
     its ratio (scaleX === scaleY within a rounding step); a shape's
     corner drag still stretches.
  4. **[LOW] "Start blank" after a template's last layer is removed
     keeps the template.** canvasStore.ts:144-151 keeps the doc's
     width, height and background when the last layer goes, and the
     studio returns to the templates-first screen that says "Pick a
     template to start … or start blank below" / "Or start blank"
     (ImportPanel.tsx:171-174, :216): an import is then placed into
     the 112x112 transparent emote and Export writes the emote pack.
     The screen's promise is the rule (expected usability). Fix
     direction: decide one — the empty screen names the canvas it
     will use (size and background) with a way back to the default
     document, or "start blank" means the default document (an
     import from that screen resets the doc first). E2E: apply the
     emote, remove its layers, import from the empty screen — the
     document is what the screen said.
  5. **[MED ×2] Stream Graphics does not fit the minimum window.**
     (a) ImageStudio.tsx:84's root is `h-full overflow-hidden` (the
     four sibling studios are `overflow-auto`) and Canvas.tsx:416 has
     `min-h-[400px]`: at 1024x640 the Export bar (format, scale,
     Variants, Export) sits at y=640-694, past the window, and the
     wheel cannot reach it (Tab can; Playwright's click() scrolls
     programmatically, which is why the MIN_WINDOW cases pass).
     (b) ImageStudio.tsx:120's canvas column has no `min-w-0`, and
     Canvas.tsx:135-148 sizes the Stage in pixels from its container,
     so a wide document (the 1200x480 Twitch banner) holds the `1fr`
     track open: the Layers card is 76 px off the right edge on a
     fresh 1024x640 open and wholly off-screen after a 1632 → 1024
     shrink (live: `min-w-0` → stage 700x280, card at 740-1000). Fix
     direction: the canvas column takes `min-w-0`; the canvas's
     minimum height lets the Export bar fit inside 1024x640 without
     scrolling; the root becomes `overflow-auto` like its siblings
     as the backstop. E2E at MIN_WINDOW: on the thumbnail, emote and
     banner templates the Export button and the Layers card are
     inside the viewport by bounding box WITHOUT a click (click()
     scrolls first), and after a 1632x918 → 1024x640 resize with the
     banner open; the layout.ts helpers if one fits, a new one if not.
  **Track C (renderer: Home, focus, captions error):**
  6. **[LOW] Restore can do nothing, silently.** AutosaveRestore.tsx:
     44 reads `holdsWork` once per mount, and :123-131's press-time
     backstop withdraws the offer and returns with no sentence. It IS
     reachable: a conversion or extraction that lands while the person
     is on Home (Importer.tsx:49-82 / AudioImporter.tsx:71-79 run from
     module run slots that outlive the route) fills a studio under a
     banner that mounted empty; Restore then vanishes with nothing
     restored and no word. INTERACTION_COVERAGE's row and
     home-chrome.spec.ts:3278-3279 say no UI path reaches it — false.
     Fix direction: the banner withdraws itself when a studio GAINS
     work while it is mounted (subscribe to what `sessionHoldsWork`
     reads, not only Open project), and the backstop, if it still
     fires, says one finished sentence (what is open, and that
     nothing was restored). E2E: a conversion landing on Home with
     the banner up — the banner goes (or Restore says the sentence);
     the IC row and the spec comment corrected.
  7. **[LOW] A held Enter in the preset name box raises error
     toasts.** PresetPanel.tsx:101 `onKeyDown={(e) => e.key ===
     'Enter' && save()}` has no `e.repeat` check: after the first
     press saves and clears the name, each auto-repeat runs save →
     "Name your preset first" in red. The held-key class (T-120,
     T-133 (7b), T-134). Fix: ignore repeats (the repo's held-key
     guard if one fits). E2E: a held Enter saves one preset and raises
     no error toast.
  8. **[LOW] The preset buttons drop keyboard focus while saving.**
     CustomPresetManager.tsx:290 and PresetPanel.tsx:112
     `disabled={saving}` disable the button the keyboard just pressed;
     Chromium blurs it and focus falls to body behind the aria-modal
     dialog (the T-120 (10) record). Fix direction: keep the claim (it
     already makes a second press a no-op) and use `aria-disabled`
     (with the dimmed style) instead of `disabled`, or restore focus
     in the finally; the T-139 (9) pins follow. E2E: a keyboard press
     under `slowPresetWrites` keeps document.activeElement on the
     control, in both places.
  9. **[LOW] The recent-files menu drops focus when it closes.**
     RecentFilesMenu.tsx has no focus management: Escape, picking an
     item or Clear list unmount the focused item and focus falls to
     body. Fix: on a close with focus inside the menu, focus the
     toggle. E2E: Tab into the list, Escape → focus on the toggle; a
     keyboard pick → focus on the toggle (or wherever the pick's own
     flow puts it — say which).
  10. **[LOW] A failed transcription blames the video tool, and the
     setup card is gone.** A whisper exit matches RUNNER_EXIT
     (userFacingError.ts:59) and gets GENERIC_EXIT_CAUSE ("imagii's
     video tool stopped… Check that the source file still plays and
     the folder has room") — the wrong program and the wrong advice
     for the captions engine (a missing .dll beside the exe is
     Windows exit 0xC0000135 = 3221225781; a damaged model); and
     CaptionsPanel.tsx:321 shows the setup card only while
     `!status?.ready`, so after a failed Transcribe there is no way
     back to the folders. Fix direction: a whisper-exit cause naming
     the captions engine and its setup (the DLL case by its exit
     code, in its own sentence), and the setup instructions reachable
     when the files exist (a "Captions setup" disclosure that is
     always there, or shown after a failure). Unit rows for the
     sentence (the whisper exit, the DLL code, and a burn-in exit that
     keeps the generic sentence); e2e: a fake whisper that exits 1 →
     the sentence, and the setup reachable.
  Non-counted, rides with Track C: STYLE_GUIDE.md:911's unqualified
  "agree within one 256-sample block" (T-110 (bl)), and STYLE_GUIDE's
  "Round 88 additions" moved inside the guide's structure (it sits
  after the closing "When this guide changes" section).
  **Docs (ride with the owning track):** LESSONS_LEARNED entries
  (item 1: the T-139 (1) rule reaches the files a spawned program
  writes; item 5: a fixed-pixel child in a `1fr` track needs
  `min-w-0`, and click() hides an unreachable control), IC rows,
  TESTING paragraphs, USER_GUIDE lines (Shift for a free resize; the
  captions setup).
  **Ledger:** T-110 (bn) — re-check YouTube's thumbnail size and byte
  guidance at release (the help page could not be fetched in sweep 26;
  the Android page still says 1280x720; the copy is advice only —
  owner hand-check). (bm) gains the write side: a near-cap autosave
  costs about 0.55 s of main's loop per write (two serializations),
  measured in sweep 26.
- **Acceptance criteria:** standard bars; red-first with sha256
  content-replace restores in a ledger; items 1-10 land with the
  covering tests named above (item 1's Layer 5 cases on both majors
  are not optional); new cases in NEW describe blocks appended at the
  end of shared files; `npm run verify`, `npm run test:media` and the
  FULL Playwright suite green before handback; no docs/TICKETS.md,
  package.json or lockfile edits; processes stopped by explicit PID
  only.
- **Status:** open

---

## T-110 — residuals backlog from the wave + the review gate (post-wave)

- **Spec:** verified finds that stay out of the wave's scope. (a) a
  converted import re-converts and a video-sourced WAV re-extracts
  on EVERY open — minutes for a long VOD, and the scratch copies
  pile up in %TEMP% (one per open, reaped 6 h+ at next launch); a
  cache keyed by original path+size+mtime fixes the wait AND the
  pile-up, and replacing/clearing a source should delete its
  previous scratch; (c) the open-project conversion has no Cancel
  and no progress reaches the UI though main computes percent —
  and (sweep 13) the Compile, GIF and PiP cards are siblings: a
  label plus Cancel and no percent, because the concat path has
  no progress channel at all; (e)
  the GIF ignores the clip's grade/effects by design — revisit; add
  a size hint (width^2 x fps x duration) and a 112-128 px emote
  width (7TV: 7 MB/1000 frames; Discord free: 20 MB); (f)
  temperature coefficients were measured on linux ffmpeg 7.0.2, the
  shipped win32 is 6.1.1 — and sweep 7 proved the gap is real, not
  hypothetical: 6.1.1's `colorbalance` RGB round-trip uses the bt601
  matrix and drops the tag on bt709-tagged sources (T-118 item 6
  fixes the matrix; the release run's Layer 5 still confirms the
  win32 binary, now with a bt709-tagged fixture that is not
  matrix-blind); (g)
  `isSafeAbsolutePath` accepts UNC (`//host/share`) — deliberate for
  NAS, but a crafted shared project makes open touch an attacker's
  host (SMB/NTLM); decide reject-vs-confirm — and (sweep 11) the
  same crafted-project class reaches the renderer by a second
  mechanism: an image layer's `src` is unvalidated
  (`useImage(layer.src)` in Canvas.tsx under CSP `img-src https:`),
  so opening a shared `.imagii.json` whose layer points at
  `https://tracker.example/p.png` fires a GET that reveals the
  streamer's IP to a host that is none of the three sanctioned
  destinations; the strict fix (accept only `data:image/`,
  `imagii-file:` or `blob:` in `validateProject`) would break the
  legitimate remote case — a reference layer sent to canvas whose
  thumbnail cache is gone stores its DDG https URL — so the
  mechanism is named here for the same owner decision; (h) rotation-tagged
  sources crop on CODED dims — a rotated phone clip exported to
  Reels loses about half the picture (measured); probe must expose
  display dims — and (sweep 12) non-square pixels are the same
  mechanism: probe has no `sample_aspect_ratio`, so a 720x480 SAR
  32:27 DV/DVD-style source exports squeezed and cropped (executed
  through the real `runExportJob` on both majors: a display-square
  200x200 box lands 300x356, 76 rows cropped away; the GIF is
  320x213 where 16:9 gives 320x180) — `scale=iw*sar:ih` ahead of
  the aspect crop is the upgrade, landed together with the
  rotation display-dims fix since both are "geometry must use
  DISPLAY dims"; (i) multi-cut A/V drift via select frame-drops —
  measure with a Layer 5 multi-cut case, then snap cuts to the
  frame grid and afade the seams; CORRECTED (sweep 13, executed
  on both majors): the audio grid is the DECODER BLOCK, not a
  universal 1024 samples — FLAC decodes in 4608-sample blocks
  (96 ms), ALAC in 4096, and 7.0.2's WAV demuxer hands over 4096
  where 6.1.1 gives 1024, so the old "~16 ms sigma / about 21 ms"
  held only for WAV on the shipped major (measured per-cut errors
  to −77 ms on ALAC, −60 ms on FLAC through the real export);
  T-124 lands `asetnsamples=n=256:p=0` ahead of `aselect`
  (executed: −1..+3 ms across FLAC/WAV/ALAC, identical on both
  majors, and it future-proofs a 7.x win32 bump that would have
  quadrupled the seam error with Layer 5 still green), leaving
  this letter the frame-grid snap + afade upgrade only; (j)
  in-flight job state is panel-local React state in six panels —
  leaving a studio orphans a running job's Cancel/progress (the
  batch now refuses a duplicate and the SRT got a source guard, but
  store-held job state is the architectural fix; ADDRESSED by
  T-135 (1)'s module stores and T-136 (1), (2), (4) for the sites
  it did not reach) — and (sweep 13)
  DERIVED RESULTS are the same family: highlight scan candidates,
  chat spikes and the transcript preview live in panel state, so
  a multi-minute VOD scan is re-run after any trip to Home; (k) retry after a
  canceled batch re-encodes finished files as "(2)" duplicates —
  "Export remaining" is the upgrade; (l) a11y backlog: hover-only
  failure cause, placeholder-only inputs (Watermark/Filename/chat
  log), repeated names ("Frame", "+ Clip", the cut chip), safe-zone
  label halo, pointer-only canvases (waveform drag, crop Rnd), and
  the Record studio's Start/Stop/"Finishing up" phase changes
  announce nothing to AT (the progressbar + result toast carry the
  state — the Captions panel's accepted idiom; an always-mounted
  polite live region is the upgrade), the Reference Search
  outcomes are silent to AT (sweep 11: the results grid, "No
  results.", the error card and the offline notice mount with no
  status or alert role and no toast — the ONE inline-only async
  outcome in the renderer, so no accepted idiom covers it; a
  `role="status"` region plus `role="alert"` on the failure card,
  or a toast like every other panel, is the upgrade — the
  strongest member of this letter), and the saved-file toast's
  actions ("Show in folder", "Edit in Video Studio") are
  unreachable by keyboard inside their 8 s — react-hot-toast
  pauses on hover only and the toaster mounts after every studio
  control, so Tab cannot reach the buttons in time; mounting the
  toaster before the routes and pausing the timer on focus is the
  upgrade (sweep 8), and (sweep 12) the remaining AT/design-choice
  polish of the same family: a tutorial or FixWizard step advance
  announces nothing (focus stays on the persistent Next; a polite
  live region around the step title/body, and role="group" with
  aria-labelledby on the wizard options, is the shape), the
  Reference hover scrim's source line fails contrast on bright
  thumbnails (text-ink-dim on bg-black/60 reads 1.84:1 over white;
  ink-base or a /85 scrim is the choice), route changes carry no
  per-route document title or focus move, the Duck/Cleanup slider
  hints and HookIndicator reasons live only in `title`, more
  placeholder-only inputs are named (TextOverlayEditor,
  ReferencePanel, MoodBoardPanel, PresetPanel, PostChecklist ×2),
  and the Record device hint appears silently (files with this
  letter's Record live-region member), and (sweep 13) input wells
  are invisible at rest: inputs and selects are bg-bg-base on
  bg-bg-elevated cards (1.06:1) with Tailwind preflight zeroing
  their borders, failing WCAG 1.4.11's 3:1 field boundary — a
  shared field class with `border border-ink-dim` (~5.8:1 on
  elevated) is the design-wide upgrade, an owner look decision; (m)
  production CSP carries `connect-src ws:` (dev HMR leftover —
  verify dev still works before removing) and the moodboard
  thumbnail fetch checks URL length but not scheme; (n) canvas undo
  pushes a step per keystroke (video store coalesces, canvas does
  not) and Home's Open project replaces studios without a confirm;
  (o) zoompan: ±1 px integer jitter, and primaries/trc tags dropped
  (mixed tags across compile segments; decodes clean) — cosmetic,
  recorded; (p) the partial-output mtime guard can mis-keep on an
  SMB share whose clock runs >2 s behind (ceiling noted in the file
  comment; a freshness flag for nextFreePath writers if it ever
  matters) — T-133 (5) removed the slack from the SUCCESS path
  (wroteOutput asks only for a non-empty regular file, and
  extractFrame refuses a pre-existing target before the spawn), so
  the letter now covers the DISCARD path alone, whose cost stays "a
  leftover file, never a lost one"; (q) Compile stays 30 fps (now disclosed) — following
  the max source rate is the upgrade — and (sweep 16) the same
  ceiling holds for every built-in EXPORT preset: 60 fps
  gameplay is halved on the YouTube slot even after T-126 (21)
  made the downsample clean (YouTube's own guide lists 1080p60
  at 12 Mbps); a built-in "YouTube 1080p60" or a
  keep-source-rate-up-to-60 option is the upgrade (a custom
  preset can already do it by hand); (r) compile fades overlap
  when the output is shorter than two fades (pre-existing, already
  improved by the clamp); (s) transcripts live forever in
  `<userData>/captions` (now disclosed in the guide) — an in-app
  "clear transcripts" action is the upgrade; (t) Clip Kit
  thumbnails ignore the clip's crop — a design question (which
  cover frame belongs to which slot when the kit writes both
  orientations); (u) ANY failed save after a recording still
  deletes the take — promoteTempWebm unlinks the temp webm in its
  finally on both branches: a failed convert-to-MP4 (the T-59
  sentence at least says "Nothing was saved"), and, with Convert
  off, a failed copyFile to the chosen location (disk full on that
  drive, destination blocked), where the round-67 cause sentences
  ("free up some space and try again", "close any app using it")
  advise retrying a save whose take is already gone. Round 64
  fixed the odd-size cause; a product call is needed on keeping
  the webm when the save fails, and the retry wording on the copy
  branch should be revisited with it (UX sweep 7); (v) a Windows install missing one of the
  six overlay fonts fails that export — a font preflight falling
  back to Arial is the upgrade; (w) caption style size/position are
  not validated at the burn gate (cannot inject; hardening only);
  (x) ~47 awaited `window.api.*` calls sit outside any try (mostly
  pickers, settings writes and cancels — audit which can actually
  reject onto a user action; the failure-path scanner pins by
  name, a limitation its header now states); (y) the convert's
  -progress parser trusts each chunk's lines — a line split across
  chunks could yield one wrong percent for one tick (a line buffer
  fixes it); (z) a loudnorm measurement that is finite but outside
  ffmpeg's accepted ranges (input_i above 0 LUFS needs manual gain
  on already-hot audio) would still fail pass 2 — treat
  out-of-range as no-measurement like non-finite; (aa) the
  re-attach scratch WAV name is derived from the output path — a
  unique scratch name (the extract.ts nanoid pattern) would retire
  the collision guard class entirely, including its case-folding
  blind spot on NTFS; (ab) the caption burn-in's `-c:a copy` is
  the one mp4 writer that does not re-encode audio to AAC — an
  Opus/FLAC/PCM source carries its codec into the mp4 (plays in
  Chromium except AC-3-silent; measured) — re-encode to AAC for
  guaranteed compatibility; (ac) a PiP whose silent base is
  shorter than the overlay runs to the overlay's length with a
  frozen base (`-shortest` has no audio stream to bound it; the
  panel promises nothing about length — decide the expected cut);
  (ad) five older copies of the nanoid alphabet remain
  (customPresets, moodboard, ipc/search, the session and job id
  regexes) now that shared `isSafeId`/`assertSafeId` exists —
  consolidate, and give `video:deleteCustomPreset` the same
  handler-level gate `audio:deletePreset` gained; (af) the audio
  export's LENGTH depends on the Duck checkbox when the bed
  outlasts the voice (sweep 8): `amix=duration=longest` governs
  the duck-off branch (60 s voice + 180 s bed exports 180 s, 120 s
  of bare music cut mid-song with no fade), while the ducked bed
  passes through `sidechaincompress`, which ends with its shorter
  input, so duck-on exports 60 s — a product call on the expected
  length, sibling of (ac); the voice defining the length
  (`duration=first` or a trim to the primary) is the
  expected-usability reading, and whichever way it goes, an
  audio-only Layer 5 case with a longer bed in both duck modes
  lands with it (the false "mix is max(voice, music)" comment is
  fixed separately in T-119); (ag) the second track's Gain slider
  is silently ignored while "Match loudness" is on
  (`secondaryGainOrLoud` is either the loudnorm or the volume,
  never both) — the slider stays enabled with no hint; disable it
  with a one-line reason, or apply the gain as an offset after
  the loudnorm (sweep 8) — and (sweep 12) the PRIMARY Manual gain
  slider is the same story whenever "Even volume" (or the wizard,
  which always enables it) is on: `volume=` sits ahead of loudnorm
  and pass 1 measures after it, so the gain cancels exactly
  (expediter-replicated on the real binary: +8 dB in, −16.0 LUFS
  out, to the decimal, gain or no gain) — one decision covers both
  sliders; (ah) a running take is protected on
  some exits and not others (sweep 9): Esc stops and saves, the
  Home link asks "Stop and save it before leaving?", but the
  window X / Alt+F4 flushes autosave and then
  `abandonAllRecordingStreams` unlinks the webm — hand-test 13
  documents that as the expected outcome, so changing it is a
  product call (a native confirm in the `close` handler when a
  recording session is open); the same review notes no
  application menu is ever set, so Electron's default
  accelerators (Ctrl+R reload, which drops every studio's
  in-memory state mid-take) look live under `autoHideMenuBar` —
  `Menu.setApplicationMenu(null)` is the candidate fix, decided
  together (sweep 25, executed: a reload mid-take also leaves the
  recording session open in main - four takes each followed by a
  reload kept four partial webms and the fifth `recording:begin`
  was refused "too many open sessions"; only the
  render-process-gone path abandons sessions, so the same decision
  covers abandoning them on a main-frame navigation); (ai) the portable exe unpacks itself on EVERY launch
  (electron-builder's portable template deletes and re-extracts
  its install dir each start; nothing sets `unpackDirName`), a
  10-15 s no-window wait on every start — T-120 rewords the five
  "first launch is slow / later ones fast" claims (README ×2,
  USER_GUIDE, FOR_MIKE, the release body) to say so — and caching
  the unpack via `unpackDirName`, or an
  installer target, is the upgrade and a product call (sweep 9) —
  and the unpack itself carries dead weight (sweep 11): the app is
  English-only but ships Electron's 55 locale paks (38.3 MiB),
  re-extracted on every launch; `electronLanguages: [en-US]` in
  electron-builder.yml is the candidate trim, with its win32
  efficacy unconfirmed (check in a `--win dir` probe before
  relying on it) — and (sweep 12) the renderer-only dependencies
  (react, konva, wavesurfer.js and friends) ship in app.asar
  although Vite inlines them into the renderer bundle: moving
  them to devDependencies measured app.asar 15.2 → 4.0 MB in a
  scratch packaging probe (the main/preload bundles import only
  electron, electron-store, ffmpeg-static, ffprobe-static and
  nanoid), another ~10 MiB off every launch's unpack, decided
  with this letter since it is package.json/lockfile churn;
  (aj) defense-in-depth navigation hardening (sweep 10): the app
  has no `will-navigate` guard and no permission handler — the
  live drop vector is REFUTED (Electron's `navigateOnDragDrop`
  defaults to false; sweep 8 drop-tested the built app via CDP
  and sweep 10's electron reviewer could not make an injected
  drop navigate either, and every anchor uses `target=_blank`),
  so nothing reaches the privileged bridge today, but a
  `will-navigate` preventDefault for non-app URLs, a window-level
  dragover/drop preventDefault, and a deny-by-default
  `setPermissionRequestHandler` are cheap belt-and-braces for a
  future anchor or a compromised renderer; (ae) Clip Kit
  thumbnails write bt709 YCbCr into a JFIF JPEG (frame.ts argv) —
  a decoder that follows JFIF's bt601 assumption shifts saturated
  colors (sweep 7 measured red (206,46,47) shown as (194,30,50));
  `-vf format=rgb24 -pix_fmt yuvj420p` measured within 2 levels on
  both ffmpeg majors, and the fix should land with (t)'s crop
  design call since both touch the same argv; (ak) Record's mic
  rides Chromium's voice-call processing (sweep 11): the
  getUserMedia constraint is `{}` or `{deviceId}` only, and
  Chromium defaults echoCancellation, autoGainControl and
  noiseSuppression ON — AGC pumping and NS warble are baked into
  the take before Audio Studio's own denoise and loudnorm run on
  top; requesting all three `false` (with `channelCount: 1`) is
  the raw-capture fix, but no echo cancellation hurts anyone
  monitoring through speakers, so it is a product call — and a
  `getSettings()` readout in the Record E2E pins whichever way it
  goes; (al) no single-instance lock (sweep 11): nothing calls
  `app.requestSingleInstanceLock`, and the (ai) windowless 10-15 s
  unpack invites the second double-click — which starts a second
  full app on the same `<userData>` (autosave.json, config.json,
  recordings) and a second unpack; taking the lock and focusing
  the existing window is standard practice but only helps once the
  first instance is past its unpack ((ai) is the real fix), and
  the codebase's own comments acknowledge concurrent instances, so
  it is an owner call, decided with (ai); (am) Chromium's
  persistent profile is a stored-bytes channel the guide does not
  name (sweep 12): the window uses the default session (no
  `partition`), nothing calls `clearCache`/`clearStorageData`,
  and the renderer loads DDG search thumbnails into it — so
  `%APPDATA%\imagii`'s own Cache/Network dirs can hold copies of
  fetched search images that "Clear thumbnail cache" never
  touches and the "Where your data lives" list omits (whether
  image bytes actually land depends on response cache headers
  nobody could verify from this box; Chromium's network-state
  files accrue regardless) — T-123 adds the disclosure sentences;
  the product call left here is whether to also clear
  (`clearCache()`+cookies at quit beside the thumb sweep) or pass
  `cache: 'no-store'` on the three `net.fetch` calls; (an) the
  watermark inset is 20 px flat in every corner at 3.5%-of-height
  font (filters.ts): on a 1080x1920 kit output every corner sits
  inside where TikTok, Reels and Shorts draw their UI
  (third-party safe-zone guides disagree on exact pixels but all
  exceed 20 px several times over), so the stamp lands under the
  caption rail or top bar on precisely the vertical files the kit
  exists for — an owner design call (larger 9:16 inset vs
  per-preset margins; the T-51 win32 pixel tests pin today's
  corners, and the IMG-PREC Layer 5 pixel case lands with
  whatever is chosen); (ao) Audio Studio decodes the WHOLE file
  in the renderer to draw the waveform (sweep 12, measured in the
  built app: a 1 h WAV peaks 3.25 GB renderer RSS, 2 h peaks
  6.5 GB, linear ~4.7× the WAV size — a 3-6 h VOD is 10-20 GB, a
  dead renderer on most PCs): T-123 lands the stopgap (an
  `error` listener with a finished sentence, and a refusal over a
  documented duration ceiling); the real fix ledgered here is
  main-side peak computation handed to wavesurfer as
  `peaks`+`duration` (the media element already streams over the
  Range-capable imagii-file protocol), which also retires the
  ceiling; (ap) no audio-track choice (sweep 14): extraction has
  no `-map` and the re-attach maps `0:v:0`+`1:a:0`, so an OBS
  multitrack recording always cleans track 1 (normally the mixed
  track, not the mic-only one) and the re-attach silently drops
  the other tracks while the tutorial says it "puts the cleaned
  sound back on the original" — a stream picker is the upgrade,
  an owner product call; (aq) overlay text styling (sweep 14):
  the hook-caption drawtext has no outline, shadow or box (the
  watermark has one), is left-anchored with no centre option,
  and the single-line input cannot wrap, so a long hook on a
  1080-wide vertical runs off the edge and white-on-bright is
  hard to read — an outline/box toggle, centring and wrap are
  the upgrade, an owner design call — and (sweep 15) the size is
  wrong by platform before styling even starts: `fontsize` is
  fixed output pixels while x/y are fractional and the watermark
  scales by height (filters.ts:385-392 vs :513), so the default
  48 px hook is 4.4% of frame height on YouTube 1080p but 6.7%
  on X/Facebook 720p, and 4.4% of the WIDTH on the 1080-wide
  verticals against 2.5% on YouTube — store the size as a
  percent of frame height (or scale by `preset.height / 1080`)
  when styling lands; (ar) a background take is out of reach
  (sweep 15): USER_GUIDE tells the person to minimize imagii
  during a take, and then every signal lives in the hidden
  window — the mic-loss toast (8 s, ERROR_TOAST_MS) plays to
  nobody, and Stop needs an Alt+Tab (Esc is a window-level
  keydown; no `Notification`, `flashFrame` or `globalShortcut`
  anywhere in src) — T-126 (2) puts a durable mic-lost record
  in the window (REC chip + saving card + saved toast); the
  OS-level reach (a native notification on mic loss,
  `flashFrame` on the taskbar, a global Stop shortcut) is the
  upgrade, an owner call on OS-integration scope; (as) six
  highlights have no batch affordances (sweep 15): the clip
  list only appends (reorder = remove + re-add, which loses
  crop, text and grade; Compile joins in list order), and
  platforms are ticked per clip (Reels + TikTok across six
  clips is six selections plus twelve ticks) — move buttons or
  sort-by-time, plus apply-platforms-to-all, an owner product
  call; (at) Electron 31 is past end of life (sweep 15):
  package.json pins `electron ^31.3.0` (installed 31.7.7,
  Chromium 126); Electron supports the latest three majors and
  31 fell out of support when 34 shipped (Jan 2025), while the
  renderer decodes untrusted bytes (DDG thumbnails under
  `img-src https:`, a shared project's image `src` per (g),
  imported media) — a bump touches `process.getBuiltinModule`,
  the ESM preload and the sandbox flag, so it is an owner call
  with a release run beside it; (au) HDR sources export wrong
  (sweep 15): a 10-bit PQ/bt2020 HEVC exports as 8-bit yuv420p
  still TAGGED smpte2084/bt2020 — not valid HDR, and washed out
  in SDR players; the bundled 7.0.2 has `zscale` and `tonemap`
  compiled in so a tone-map stage is feasible, and the lighter
  options are a detect-and-notice line in Export ("HDR source —
  exported as SDR") or a documented refusal — owner picks the
  scope; nothing in panel copy promises HDR today; (av) the
  Reframe "Left"/"Right" strips are inset 15% of the margin
  (stripCrop, filters.ts — verified: a 1080p Right strip spans
  x 1116-1722 while the app's own Twitch overlay template puts
  the facecam hole at x 1500-1900, so the strip keeps 222 of
  the hole's 400 px and a corner facecam is cut through the
  face; same at 1440p): the hints say "nearer the edge" so the
  copy is consistent, but no behavior rationale is recorded
  anywhere and the usability tiebreaker favors flush 0%/100%
  (or a "Facecam corner" strip) — an owner design call; (aw)
  the highlight scanner's 5 s pre-roll and the hook badge
  disagree by construction (sweep 16): every "+ Clip" from Scan
  VOD starts 5 s before the loud run, and the badge rates the
  first 3 s — the quiet lead-in — so a scanned clip reads as a
  weak hook while its peak sits at 0:05, against the platforms'
  first-3-seconds rule; pad ~2 s instead, or have the badge
  teach the trim ("peak starts at 0:05") — an owner product
  call; (ax) burned captions on vertical sit inside the
  platform UI band (sweep 17): the TikTok-bold default draws
  one line with its bottom edge 266 px above the frame bottom
  (fontSize 56, bottom, baseMarginV 40 scaled), and whisper
  cues are never chunked (no -ml/-sow; a 60-char cue is 4 lines
  reaching mid-frame), while current third-party safe-zone
  guides reserve the bottom 25-35% (367-672 px of 1920) on
  TikTok/Reels/Shorts — this CONTESTS the LESSONS "REFUTED
  ~270 px clear of chrome" entry with newer figures (official
  specs unreachable; the 270 px measurement itself was right,
  the reserved-band claim moved). Options: raise the vertical
  MarginV to clear ~35%, add a "Lower middle" position, chunk
  cues (-ml 28 -sow, or split in parseSrt), correct the hint
  and the LESSONS note — an owner design call against a
  deliberate round-15 (INIT-B) decision; (ay) a vertical-crop
  Clip Kit silently writes X and Facebook as 1280x720 cuts of
  the middle 31% band upscaled 2.11x (sweep 17; only the
  YouTube slot swaps on a vertical frame): documented ("It
  never asks about cropping") but waste in an upload-ready
  folder — skip the two slots on vertical, adapt their shape,
  or name them in the kit's one question; an owner product
  call; (az) a Windows shutdown or logoff emits NO before-quit
  (Electron's own typings), so the quit autosave flush and the
  T-127 (3)/T-131 drains never run on that one exit path — the
  code comment and the not-covered lists are corrected by
  T-131; the optional upgrade is a win32 `session-end` handler
  doing a synchronous best-effort kill-and-unlink, which cannot
  be verified on this Linux box and belongs beside (v) on the
  win32 release-run checks; forward note for (ai): moving the
  renderer packages out of dependencies would strip their
  bundled MIT/OFL license files from the asar the way the
  @fontsource move did (fixed for Inter by T-131) — the (ai)
  work must ship a consolidated notices file.
  New letters from the T-129 landing (round 80): (ba) an
  extraction past about 6.2 hours writes a WAV beyond the
  header's 4 GB size field — the retired 2-hour ceiling used to
  hide the path entirely; the source file is never at risk, the
  failure is a bad scratch WAV. The sweep-18 audio reviewer
  widened it: `runAudioExport`'s WAV output hits the same field
  for a directly imported file of that length, so the fix covers
  both writers. Candidate: `-rf64 auto` on the WAV outputs with
  their own both-majors Layer 5 cases, and a check that
  whisper-cli reads RF64 before it ships; (bb)
  Clean audio's extraction has no user-facing Cancel (the quit
  sweep covers it since T-128 (5); a button does not exist) —
  carried from T-129's found-not-fixed list. From sweep 20's
  electron review: (bc) `captions:burnIn` confines its `srtPath`
  only to safe-absolute while `saveSrt` and `writeKitSrt` confine
  to the captions folder — a hardening inconsistency (reachable
  only through a hostile project file plus a user-initiated burn;
  the only output is a video at a user-chosen path, no network);
  align the confinement.
  New letters from sweep 21 (round 84 adjudication): (bd) Record
  gives no sign the mic is live or muted — a hardware-muted or
  wrong device records a silent take with no warning
  (`watchMicEnd` listens only for `ended`); candidate: reuse the
  VolumeMeter's AnalyserNode on the Audio card and REC header, and
  treat a `mute` event like `ended`; (be) Reframe's
  Left/Center/Right strip cannot be previewed before rendering
  (`stripCrop` lives in main only) — candidate: move the math to
  `src/shared/` and draw the chosen strip on the Output preview
  (separate from (av), which is the strip's geometry); (bf) the
  DuckDuckGo `net.fetch` has no timeout, so a hung newest request
  keeps the search panel busy until a different query is sent —
  noted by two sweeps; candidate: an AbortSignal.timeout with the
  T-30 outage sentence; (bg) the autosave banner's "Later" label
  over-promises — the offered snapshot survives only until the
  next session's first autosave write (USER_GUIDE documents the
  behavior; the label does not); candidate: "Not now" or a
  USER_GUIDE-matching tooltip; (bh) ffmpeg 7.x measures `-to` per
  stream (measured: audio ending 5.234 s on a 5 s range when the
  stream starts at 0.256 s; 6.1.1 cuts at 5.000 s) — invisible
  today because the shipped win32 binary is 6.1.1, but a tripwire
  if the bundled binary ever moves majors; candidate: a Layer 5
  pin on the range end per major, or `-t` arithmetic instead of
  `-to`.
  From sweep 22's privacy review (expediter-measured with real
  Electron 31.7.7 on loopback): (bi) every main-process `net.fetch`
  (the mood-board thumbnail copy) and every renderer `<img>` load
  (search-result and mood-board thumbnails) sends Electron's default
  User-Agent, "… imagii/<version> Chrome/… Electron/…", so the image
  hosts learn the app and its version; the DuckDuckGo calls set
  their own generic UA. No guide promises UA anonymity (the
  thumbnails promise https + no referrer, both hold), so not
  gate-holding; candidate: `app.userAgentFallback` (or the
  session's) set to a generic Chromium UA at startup, pinned by the
  loopback probe; the Whisper model download's `net.request` carries
  the same default UA, so the one setting covers it too (sweep 23).
  From sweep 24 (verified, not gate-holding): (bj) loudnorm's
  `linear=true` is honoured only when the measured LRA is within the
  target LRA (hard-coded 11, chain.ts:209), the shifted true peak is
  within TP and no measurement is a sentinel (n6.1.1 af_loudnorm.c
  init); otherwise pass 2 runs dynamic. Loudness still lands on
  target and no guide promises linear normalization; candidate: an
  LRA target of max(11, measured LRA) on pass 2, with a Layer 5 case
  on a wide-range source; (bk) Audio Studio's VolumeMeter runs its
  60 Hz requestAnimationFrame loop and a React render for as long as
  a file is open, paused or with the window hidden
  (`backgroundThrottling: false`; measured about 3% renderer CPU on
  software GL, 0.7% with the loop stubbed); candidate: run the loop
  only between the media element's play and pause/ended.
  From sweep 25 (verified, not gate-holding): (bl) afftdn delays the
  sound by two hops (~25 ms at any rate) and the export limiter
  (`alimiter`, latency off) by 5 ms, and neither emits the input's
  last hops (measured on both majors: a 1 kHz burst at 1.000 s comes
  out at 1024.67 ms through afftdn=nf=-30:nr=18, 1005.04 through the
  limiter, 1029.65 through both; length unchanged) - far inside
  lip-sync detectability, no guide promises sample-exact sync;
  candidates: `latency=1` on the limiter, and a pre-pad + atrim of
  two hops around afftdn, with a Layer 5 onset/tail check per
  denoise mode; (bm) with a large autosave on disk every visit to
  Home costs 0.5-0.7 s of main-loop lag (measured with 46 MB:
  `AutosaveRestore` reads and parses the file twice, `info` and
  `read`, even when `holdsWork` hides the banner) and every autosave
  write stringifies the project twice in main; candidate: read the
  file once and only when the banner can show.
  From sweep 26 (verified, not gate-holding): (bm) has a write side -
  near the 50 MiB cap one autosave write costs about 0.55 s of main's
  loop (measured with 46.4 MB: `isSafeToAutosave`'s serialization
  257-316 ms and `writeAutosaveNow`'s second `JSON.stringify` 246-282
  ms; 592 ms of loop gap across three overlapping writes; about 220 ms
  at 20 MB); candidate: serialize once and hand the string through;
  (bn) YouTube's thumbnail guidance (1280x720, 2 MB) could not be
  re-checked in sweep 26 (the help page did not fetch; the Android
  page still says 1280x720, and a larger desktop recommendation is
  reported) - the template and its copy are advice only; owner
  hand-check at release.
- **Acceptance criteria:** per item, standard bars (red-first where
  behavior changes; Layer 5 for anything in a graph; T-84 voice for
  refusals); (f) is a release-run checkpoint, not code; (g), (h)
  and (j) need an owner decision on the mechanism.
- **Status:** open (post-wave backlog)

---

## Done

Round 88, Track A — T-139 items 1, 3 and 10, landed in the commit that
carries this entry, merged onto Track B (f60e617) and Track C
(8d34de0). Worked by one Sonnet in a fresh clone of d7e1738. The
fixes: every write of a file the person chose or owns is atomic -
one `writeFileAtomic` (src/main/fsAtomic.ts: a tmp beside the target,
a best-effort flush, a rename over it, the tmp removed and the disk's
own error rethrown on any failure) at ten sites (project save, image
save and save-many, both .srt writes, five mood-board writes), held by
fault-injection units over the real handlers and an AST scan; the
autosave writes run one after another (a promise chain in main, a
unique tmp per write, cut-off tmps swept) so overlapping calls can no
longer corrupt both slots; ffmpeg's "Permission denied" at a runner or
probe exit maps to the Windows-blocked sentence (the screen-recording
refusal stays unmapped). It also fixed a defect the fault tests
exposed: every failed board write raised an unhandled rejection
(moodboard.ts's lock clean-up). SENT BACK ONCE by the expediter: my
FULL Playwright run of the handed-back tree went 457/458 - image.spec
"the document background lands in the bytes" - and the cause was the
change itself: the e2e helpers that list a save folder counted the
atomic writer's `<target>.<8 hex>.tmp` mid-write. The fix is in the
tests (the product is right): one shared predicate (`ATOMIC_TMP`,
exported beside the name it matches, and `withoutAtomicTmp` for the
specs), a deterministic red that holds the rename at a gate in main so
the tmp is guaranteed visible (red on the old helper, green after),
and a scan that fails any listing of a download or export folder
outside the filter. 71 ledger mutations all restored byte-identical
(one survived a first pass and was killed after the test was split),
11 reds. Expedited personally: verify x2 (192/5301 after the
send-back), test:media on 7.0.2 (370 passed | 13 skipped of 383),
FULL Playwright 457/458 before the send-back (the race above), and
after it image.spec and references.spec whole 70/70 in the clone and
the FULL suite on the merged tree below; integrity and ledger audit
clean (no forbidden files, no Track B or C file touched, no file at a
mutant's sha); two independent mutations at seams no ledger row names
(the atomic writer copying into place instead of renaming → 5 named
cases red; the shared tmp filter made a no-op → both "a save in
flight" cases red), each restored byte-identical, sha256 verified.
Merged by structure onto 8d34de0 (rehearsed in a scratch clone):
four shared files conflicted - the coverage ledger and image.spec
(each track's appended block re-appended, B's first), LESSONS (A's
entry on top, newest first) and tests/e2e/slowWrites.ts, which both
tracks had created with different helpers (combined into one file
with both sets of exports) - and a line-level proof over all eight
files both tracks touched showed neither side lost a line beyond what
the other deliberately changed; all 20 Track-A-only files are
byte-identical to the expedited clone, and the rehearsed tree verified
at 193 files / 5361 tests, the three tracks' counts summed exactly.
The merged tree's gates are this entry's commit.

Round 88, Track C — T-139 docs follow-up, landed in the commit that
carries this entry, onto Track B (f60e617). Worked by one Haiku in a
fresh clone of f60e617 (sent back once for the Welcome row's chain
column). README.md now says what the captions panel says (the
ggml-org link, whisper-bin-x64.zip, whisper-cli.exe and its .dll
files from the Release folder) and what the importer does (a copy
bounded to twice the design's long side and about 16 MB, not the
original at full size); the IC Home table's eight cites point at
the current lines, and the Welcome row names persistSetting and
swallowRepeatClicks and the e2e cases that click it. A new docClaims
block (14 cases) holds every one of those lines, red-first against
the old README and IC (11 failed, and the Welcome chain case 1 more). Expedited personally: verify x2
(191/5235); one independent mutation (the Save project row back to
Home.tsx:96) → its named case red → restored byte-identical. No
source file changed.

Round 88, Track B — T-139 items 2, 4, 5, 6, 7, 8 and 9, landed in the
commit that carries this entry (Track A, items 1, 3 and 10, lands
next, after a send-back). Worked by one Sonnet in a fresh clone of
d7e1738. The fixes: a picture's FIRST placement fits the document
(`placementFor`: the drawn size bounded by the canvas as well as by
800 px, the position kept inside it) for a drop, the chooser, a paste
and "→ Canvas", so art on the 112 px emote canvas lands whole; a
stored copy has a byte budget (`STORED_IMAGE_MAX_BYTES`, 16 MiB of
data URL: an opaque picture over it is re-encoded as JPEG, then the
bound steps down by a quarter until it fits — measured: a 4000x3000
noise PNG stored as a 13.4M-character JPEG and autosave kept writing,
where it was 47M and paused); the autosave banner goes when Home's
Open project lands (`useAutosaveOffer.withdraw()` after the apply),
and Restore re-asks `sessionHoldsWork()` inside its claim; the
captions setup names whisper-bin-x64.zip (the newest release that
lists it, some marked Pre-release) and says to copy whisper-cli.exe
and every .dll from its Release folder (the layout read from
whisper.cpp's own release workflow — the zip itself could not be
fetched from this session); DESIGN_GUIDE's decision order reproduces
its own placements (checked against the code by a new docClaims
block) and its GIF figures are re-measured (102 / 109 px); "+ Log
post" ignores a repeat press, both preset saves are claimed and
disabled while they write, and Welcome's "Let's go" swallows the
repeat press that MEASURED as landing on the Stream Graphics card at
1366x768 and smaller windows. 59 ledger mutations all restored
byte-identical (two survived a first pass: one killed after two
assertions were added, one - CustomPresetManager's claim at e2e - held
by its wiring pin, the form having no Enter path), 17 reds.
Expedited personally: verify x2 (191/5221), test:media on 7.0.2 (370
passed | 13 skipped of 383), build + FULL Playwright 469/469 with zero
flakes, key-file shas unchanged; integrity and ledger audit clean (no
forbidden files, no Track A file touched, no file at a mutant's sha);
one independent mutation at a seam no ledger row names (Home
withdrawing the offer on a FAILED open) → the T-139 (5) wiring pin red
→ restored byte-identical, sha256 verified (the e2e has no failed-open
case; the wiring pin is what holds it). Landed conflict-free onto its
own base, all 33 paths byte-identical to the expedited clone, whose
gates are this tree's; verify re-run on the landed tree.

Round 87, Track A — T-138 items 1, 6 and 9, landed in the commit that
carries this entry, merged onto Track B's (67ca808). Worked by one
Sonnet in a fresh clone of 63d18ff; the same container restart stopped
it, and after the expediter's audit found all 26 recorded mutations
restored byte-identical and no file at a mutant's sha, the same worker
was resumed in the same clone (its whole-file Layer 5 run on the
Windows exe had survived and was waited on, not restarted). The fixes:
the lost-part line is read in every platform's dress - one shared
context, `\[concat @ [^\]\n]*\] `, for both patterns, so the bare
zero-padded pointer the shipped Windows ffmpeg prints (mingw-w64's
`%p`) is ffmpeg's line again, line-anchored and naming the runner's
segment file as before; unit fixtures for the glibc, mingw-w64,
Microsoft CRT and glibc-null pointers, as printed, in CRLF and after a
stats line ending in a bare CR; a new Layer 5 block that re-prints
each binary's real line in every dress, red on the unchanged regex on
all three binaries; and the T-131 (1), T-136 (15) and T-137 (12)
blocks green on the bundled 7.0.2, the distro's 6.1.1 AND the shipped
win32 exe under Wine (a private prefix in scratch). An audit of every
parser of ffmpeg / ffprobe output in src/main found no other platform
assumption (smoke.ts's version line keeps a CR on Windows - one
console line, left). The highlight scan is single-flight in main
(`scanningFor`, claimed before the first await, given back in
`finally`, the refusal a finished sentence naming the running video),
held by a unit over the real handler and an e2e that reloads the
renderer mid-scan, presses Scan VOD again and finds the sentence, one
ffmpeg, and no scan alive after the close; an audit of every
module-level child tracker found one other single slot (frame.ts's
`activeFrame`, reported). USER_GUIDE and README name the third
loudness target, pinned against `LUFS_PRESETS`. The whole Layer 5 file
on the Windows exe: 354 passed, 16 failed, every one classified - 5
pins written for the Linux binaries (`skipIf(win32)` on a Windows
host), 1 Cancel bound that Wine's launcher overshoots, and 10 caption
burn-ins that paint no glyphs because the Wine prefix has no fonts
(the same command with an explicit fontsdir paints them); no
Windows-only defect, and the release run's windows-latest test:media
is where those ten are confirmed. 26 ledger mutations, 0 survivors,
10 reds. Expedited personally: verify x2 (189/5153), test:media on
7.0.2 (370 passed | 13 skipped of 383), the item-1 blocks 26/26 on
6.1.1 and 26/26 on the win32 exe under Wine, build + FULL Playwright
451/451 with zero flakes, key-file shas unchanged; integrity and
ledger audit clean (no forbidden files, no Track B file touched, no
file at a mutant's sha); the whole-file classification checked
against the spec's platform gates; one independent mutation at a seam
no ledger row names (`unreadableSegmentIndex` without its multiline
flag) → 9 named unit cases red → restored byte-identical, sha256
verified. Merged by structure onto 67ca808 (rehearsed in a scratch
clone first): five shared files conflicted where both tracks appended
or inserted, each track's block was lifted by a unique window of the
base's last lines and re-appended (Track B's first, as it landed
first; A's LESSONS entry above B's, newest first; B's TESTING
paragraphs before A's), the middle edits merged cleanly; a line-level
proof over all seven files both tracks touched showed neither side
lost a line beyond what the other deliberately changed, every Track-A
-only file is byte-identical to the expedited clone, and the rehearsed
tree verified at 190 files / 5175 tests, the tracks' counts summed
exactly. The merged tree's gates are this entry's commit.

Round 87, Track B — T-138 items 2, 3, 4, 5, 7 and 8, landed in the
commit that carries this entry (Track A, items 1, 6 and 9, lands
next). Worked by one Sonnet in a fresh clone of 63d18ff; a container
restart stopped it mid-run, and after the expediter's audit found all
37 recorded mutations restored byte-identical and no file at a
mutant's sha, the same worker was resumed in the same clone (its e2e
mutation batch had survived the restart and finished). The fixes: an
imported picture's stored copy is bounded by the document it lands on
(`storedImageMaxDim`: twice the canvas's longer side, never under 1600
px), so a full-frame overlay or background on a 1920 / 2560 / 3840 px
template exports from its own pixels; the over-limit sentences say
"Remove some of the large images on the canvas, or import smaller
copies of them" (scaling a layer frees nothing); the closed-video Clip
Kit card's confirm dialog is a sibling of its live region, not inside
it (`KitCancelConfirm`; an unanswered question goes with the kit); the
autosave Restore is a run slot (`useRestoreRun`), so a banner that
mounts during a long restore reads "Restoring…" with both buttons off
and goes when the restore is applied; DESIGN_GUIDE's RunningCancel
rule and the misplaced STYLE_GUIDE sentence are corrected; `loadImage`
sets no-referrer before its src. Two deviations accepted: the
DESIGN_GUIDE criterion the dispatch dictated ("the idle primary is
wider than its busy label") was measured false in the built app (GIF
112 / 120 px, Picture-in-picture 86 / 108, Compile equal), so the guide
now says what is true of all five (the primary is the right-most item
of its row, or its busy label is a sentence) and the order a new
Cancel is decided in; and the restore run holds `{ applied }`, read by
a store listener, because the run ends in the same tick it is applied.
47 ledger mutations all restored byte-identical (one survived a first
run - the Restore slot never given back - and was killed once the
case asked the slot again), 13 reds. Expedited personally: verify x2
(189/5141), test:media on 7.0.2 (364 passed | 13 skipped of 377),
build + FULL Playwright 457/457 with zero flakes while Track A's Wine
job ran beside it, key-file shas unchanged; integrity and ledger audit
clean (no forbidden files, no Track A file touched, no file at a
mutant's sha); one independent mutation at a seam no ledger row names
(the confirm dialog wrapped in an in-flow element) → T-137 (3) "an
empty region leaves no hole" and T-138 (4) "with the question open"
red at 40 px for 20 → restored byte-identical, sha256 verified.
Landed conflict-free onto its own base, all 26 paths byte-identical to
the expedited clone, whose gates are this tree's; verify re-run on the
landed tree.

Round 86, Track B — T-137 items 6-12, landed in the commit that
carries this entry, merged onto Track A's (6ac4768). Worked by one
Sonnet in a fresh clone of 7690cf5. The data-loss fix (item 6): one
size rule and one serialization for Save, Open and autosave
(`projectSizeProblem` over `serializeProject`, compact JSON);
`project:save` measures the string it will write and refuses a
project over the limit in a finished sentence BEFORE the dialog, so
a file it writes always opens; an autosave over the limit is not
sent to main, one toast says autosave is paused and why, and it
resumes by itself when the project fits; Open names the size instead
of "damaged". Imported pictures and "→ Canvas" references are stored
as bounded copies drawn through one offscreen-canvas helper
(`lib/boundedImage.ts`), so a reference layer no longer points at the
thumbnail cache and dies with it. The autosave dedupe key sets
`savedAt` aside, so a grid toggle or a scan writes nothing. The
loudness measure pass keeps a 16 KB stderr tail and the source scan
now counts a cap only when no guard can skip it. A chat row shows the
range "+ Clip" adds (`peakRange`, one clamp for both). A
`customPresetIds` that is not a list of strings is dropped at the
gate instead of crashing Export. The lost-segment and empty-output
patterns are ffmpeg's own lines, anchored, so a folder named with
either phrase no longer fails a good job. 59 ledger mutations all
restored byte-identical (four survived a first run: one equivalent,
whose redundant check was deleted from the product code, and three
that led to stronger tests - an echo with the quote the pattern
needs, a 6.1.1 control with a real lost segment, and a two-pass
export compared by decoded samples against a hand-built render -
each killing its mutant on rerun), 27 reds incl. both majors at
Layer 5. Expedited personally: verify x2 (188/5092), test:media on
7.0.2 (363 passed | 13 skipped of 376), the WHOLE Layer 5 file on
6.1.1 (356 passed + exactly the 7 documented platform pins), build +
FULL Playwright 443/443 with zero flakes, and the image.spec case the
worker reported flaky once under shared load 5/5 standalone;
integrity and ledger audit clean (no forbidden files, no Track A
file touched, key-file shas unchanged across the gates). The
expediter's first independent mutation (the chat row's "+ Clip"
adding the raw ends) was equivalent - the store's `appendRange`
clamps identically and the toast carries no range - so it was
restored and a second, non-equivalent seam was taken: the autosave
branch of `projectSizeProblem` returning no problem → three named
cases red ("each refusal names the size and the limit", "autosave
refuses an oversize project in the autosave sentence", and
startAutosave's "pauses autosave and says so once") → restored
byte-identical, sha256 verified, `out/` rebuilt. Merged by
structure, as round 85's: both tracks appended whole blocks to the
same shared docs and test files, so each block was lifted out by a
unique window of the base's last lines, the middle edits merged
cleanly, and the blocks were re-appended (B's LESSONS entry above
A's, newest first; A's TESTING paragraph above B's); a line-level
proof over all eight files both tracks touched showed neither side
lost a line beyond what the other deliberately changed and every
line either side added is present, and all 28 Track-B-only files
are byte-identical to the expedited clone. The merged tree's gates
are this entry's commit.

Round 86, Track A — T-137 items 1-5, landed in the commit that
carries this entry (Track B, items 6-12, lands next). Worked by one
Sonnet in a fresh clone of 7690cf5. The data-loss fix (item 2): a
recording's convert owner is now its TAKE (`recording:<takeId>`,
convert.ts), every convert, remux and save run registers under it,
and `recording:cancelSave` takes the take's id (refused when empty
or malformed), so a second take's Discard can no longer cancel the
first take's save and delete its raw file — held by a unit that runs
two concurrent saves over the real convert module, a Layer 5 case on
both majors and a bridge-driven e2e; Record's save phase lives in a
module run (saveRun.ts), so a Record that mounts over a running save
draws its card and Discard, and Start refuses in a sentence while a
save runs. Audio Studio's importer holds its import in a run slot
(audioImport.ts) and its landing asks `replacedSince`, so a file
opened during a long extraction is kept and the late sound is
skipped with a sentence. The running-kit card's live region is
always mounted (and now mounts ahead of the video's branch, so a
Close does not mount it with its text); the kit label stays on one
line with its Cancel on a row of its own, held by an expectOneLine
case at the default and minimum windows, and DESIGN_GUIDE names the
four RunningCancel placements the code uses; the preview copy's
skip toast says "closed or replaced". 40 ledger mutations all
restored byte-identical (five survived a first run: three killed
after pins were strengthened from the string to the condition, one
invalid mutant redone and killed, and two disclosed - an equivalent
latch-run id and a nowrap that the moved Cancel makes invisible at
the tested widths, pin-held), 11 reds incl. a unit that reproduces
the first-take kill on the unchanged tree. Expedited personally:
verify x2 (185/5040), test:media on 7.0.2 (356 passed | 13 skipped
of 369), the WHOLE Layer 5 file on 6.1.1 (349 passed + exactly the
7 documented platform pins, since the owner literals moved across
it), build + FULL Playwright 442/442 with zero flakes; integrity and
ledger audit clean (no forbidden files, no Track B file touched, no
file at a mutant's sha); spot-read of the take-scoped cancel end to
end; one independent mutation at a seam no ledger row names (the
preload bridge dropping the take id from cancelSave → "the channel
is aimed at one take from the button to main" red → restored
byte-identical, sha256 verified, 209/209). Landed conflict-free onto
its own base, every patched path byte-identical to the expedited
clone. The landed tree's gates are this entry's commit.

Round 85, Track B — T-136 items 9-15, landed in the commit that
carries this entry, merged onto Track A's (2c85611). Worked by one
Sonnet in a fresh clone of 47ef529 and, after the same container
restart, resumed in the same clone by a second Sonnet once the
expediter's audit found all 67 recorded mutations restored
byte-identical and no file at a mutant's sha. 84 ledger mutations
all restored byte-identical (eight survived a first run and are
listed: three killed on rerun after the tests were strengthened,
one superseded, two equivalent or by-design at their layer and
killed at unit level, and one - the chat row's `whitespace-nowrap`
- that led the worker to a real layout defect: a 10-hour stream's
range wrapped "+ Clip" past its row at the 1024 and default
windows, now fixed with a wrapping first line), 21 reds incl. both
majors at Layer 5. The fixes: the chat spike finder ranks rows by
their densest window, shows start → end, clamps "Extra seconds" to
0..60 (in the box and in findChatPeaks), keeps an inline line
naming the rule when a log holds no spike, and lines its two boxes
up; the pick-time refusal of a soundless second track has its own
sentence with no "Remove it"; a successful autosave Clear takes the
"Last autosave" line with it; Clear thumbnail cache and a tile's ✕
report a refused write; the extraction caps its stderr at 16 KB and
a source-scan test holds every main-process stderr accumulator to
a cap; the importer's classifier ignores keywords inside quoted
file names, so a finished sentence from main passes through; a
compilation whose first segment is lost at the join names its clip
like any later one (any exit code; a Cancel still wins). Sent back
once by the expediter: an independent mutation (the pick refusing
on ANY probe error) survived the whole unit suite and both
second-track e2e cases - T-135 (11)'s rule that only a no-audio
verdict refuses was pinned nowhere in the renderer; a follow-up
Sonnet added an e2e (a MediaRecorder WebM with no header duration
is added, and the no-sound sentence is not said) and a wiring pin,
both killing that exact mutant, re-confirmed red/green by the
expediter. Expedited personally: verify x2 (180/4929 before the
follow-up), test:media on 7.0.2 (355 passed | 13 skipped of 368),
the T-136 (15) Layer 5 block on 6.1.1 (3/3), build + FULL
Playwright 424/424 with zero flakes; integrity and ledger audit
clean (no forbidden files, no Track A file touched). Merged by
structure, not by hunk: both tracks appended whole blocks to the
same eight shared docs and test files, so each track's block was
lifted out by a unique window of the base's last lines, the middle
edits merged cleanly, and the blocks were re-appended (B's LESSONS
entry above A's, newest first); a line-level proof showed neither
side lost a line beyond what the other deliberately changed and
every line either side added is present, and every Track-B-only
file is byte-identical to the expedited clone. The merged tree's
gates are this entry's commit.

Round 85, Track A — T-136 items 1-8, landed in the commit that
carries this entry (Track B, items 9-15, lands next). Worked by one
Sonnet in a fresh clone of 47ef529 and, after a container restart
killed it mid-run, resumed in the same clone by a second Sonnet:
the expediter's death-protocol audit found every one of its
recorded mutations restored byte-identical and its orphaned e2e
mutation batch still running and restoring itself, so the batch
was left to finish (13 rows, 12 killed) before the resume. 71
ledger mutations all restored byte-identical (two survived a first
run - M-i3b and M-i6b - and both are killed on rerun after the
tests were strengthened: the playhead cases now run past the 30 s
ceiling, and the Output-preview e2e watches the DOM through the
moment the copy lands), 20 reds, the new e2e cases red on a build
of the unchanged base. The fixes: a running Clip Kit carries the
clip it was started for, so whichever clip is selected - and after
that clip is removed or the video closed - the kit button shows
the running kit, names its clip and offers its Cancel; main's
`video:convertForImport` is single-flight with a refusal that names
the file, and the Importer's and the preview copy's conversions
hold their busy state in run slots, so a trip away cannot re-arm
them, while the Importer's landing keeps a video opened meanwhile
and says so (the preview copy keeps its playhead in its run);
autosave ignores playhead-only store changes and never waits more
than 30 s for a pending change, so a playing video can no longer
starve it; the caption-model download keeps its bar and Cancel in
a run slot; the Player's notice is an always-mounted live region;
the Output preview says the picture cannot be shown instead of
drawing a black box under "Live snapshot"; every running-job
Cancel and progress track is one shared component
(RunningCancel, ProgressTrack), held by a scan test; "Cancel
picture-in-picture composite". Expedited personally: verify x2
(184/4953), test:media on 7.0.2 (352 passed | 13 skipped of 365;
no Layer 5 block touched), build + FULL Playwright 424 passed + the
documented record.spec load flake (T-124 (1), hit while Track B's
gates loaded the machine) 5/5 green standalone; integrity and
ledger audit clean (no forbidden files, no Track B file touched, no
file at a mutant's sha); one independent mutation at a seam no
ledger row names (ProgressTrack's accessible name dropped → "is a
progressbar named for its job" red → restored byte-identical,
sha256 verified, 6/6 green). Landed conflict-free onto its own
base, every patched path byte-identical to the expedited clone;
the worker's LESSONS entry moved from the file's end to its
newest-first position.

Round 84 — T-135, all 14 of the twenty-first sweep's verified
findings, landed in the commit that carries this entry. Worked by
one Sonnet in a fresh clone of 2b0f717; 133 ledger mutations all
restored byte-identical (six survived a first run and are listed:
three killed after the test was strengthened, three killed at unit
level where an e2e cannot reach the seam), 58 reds, every new or
changed Playwright case proven red on a build of the unchanged
base. The three MEDs: a panel's long job now lives in a module
store (lib/runStore.ts, one slot per panel in
video-studio/store/runs.ts, the Export queue in exportQueue.ts,
the audio export in audioExport.ts), so leaving a studio and coming
back finds the progress rows and Cancel that USER_GUIDE promises,
and main's `audio:extractFromVideo` is single-flight with a
refusal that names the running video; the Player listens to its
element's own error (decode or no-supported-source) and says
"imagii can't preview this video's picture format — trimming,
scanning and export still work.", with "Make a preview copy"
through the existing convert, and Play follows what the element
does; the chat spike finder (now src/shared/chatPeaks.ts, unit
tested) merges neighbouring buckets by index and spans the merged
window, so one 30 s explosion is one row. The LOWs: derived results
(scan candidates, the pasted chat log and its spikes, the
transcript preview) live in the video store; the corrected query
goes out by click as by Enter and the box names the grid after a
tab swap; SafeZone zone lines truncate with a title; the
Clear-transcripts confirm names the open video only when it has a
transcript; board and preset writes report refusals (board names
capped at 200 in one shared constant) and the first-save dialog
keeps its picture until the board exists; both remaining project
sound-load closures carry the T-113 guard; unknown preset ids are
dropped on open; a soundless second track and an all-cut chain are
refused before anything spawns (the all-cut shape — exit 0 over a
header-only file — pinned at Layer 5 on both majors); sendToCanvas
navigates only from References; the stale home-chrome comment is
corrected. Worker's disclosed deviations, accepted: the Export
store's late-completion race it found with its own e2e (rows now
also take files from the batch's results); two older tests that
pinned the removed panel-local shape revised rather than deleted;
the audio.spec "header has no duration" one-shot toast read turned
into a poll — the expediter reproduced the race independently on
a build of the unchanged base with the original test, 7 of 12
repeats failing with the identical symptom. Expedited personally:
verify x2 (179/4870), test:media on 7.0.2 (352 passed | 13 skipped
of 365), the T-135 Layer 5 blocks on 6.1.1 (15/15), build + FULL
Playwright 415/415 with zero flakes; integrity and ledger audit
clean (no forbidden files, no file left at a mutant's sha); one
independent mutation at a seam no ledger row names (the extraction
slot released only on success → "and when it fails or is canceled"
and the probe-refusal case red, the success case green → restored
byte-identical, sha256 verified, 9/9 green). Landed conflict-free
onto its own base, every patched path byte-identical to the
expedited clone; the landed tree's gates are this entry's commit.

Round 83 — T-134, all 7 of the twentieth sweep's verified findings,
landed in the commit that carries this entry. Worked by one Sonnet
in a fresh clone of eed3101; 41 ledger mutations all killed and
restored byte-identical, 11 reds (the new e2e cases proven red on a
build of the unchanged base tree). The MED (item 1): Autosave
Restore now navigates to the snapshot's route only if the person is
still on Home when the restore settles —
`if (route && currentRoute() === '/home') navigate(route)` — so a
take started on Record during a long restore is no longer cut; the
wiring-table rationale now states the click-time premise and the
negative e2e holds it (restore held open, take started, still on
Record and recording). A held I or O sets its marker once
(`if (!e.repeat)` in Player and Timeline, the T-133 (7b) pattern;
preventDefault still runs on repeat so the browser does nothing
either), keeping auto-repeat from flooding the 50-step undo
history. The reference search applies answers by sequence number —
the worker's judged deviation from the ticket's follow-up sketch,
accepted: a corrected query goes out immediately, only the newest
request's answer (or failure) is drawn, the panel stays busy until
the newest settles, and a same-query press while that query is out
is still refused; the pinned drop-test flipped, e2e type → Enter →
correct → Enter answers the corrected query. The compile claim is
now the measured truth in noPicture.ts and the STYLE_GUIDE
(segments close on the stderr line alone, which both majors prove
sufficient), with a scan test listing the wroteNoPicture users and
an optional 5 s/9 s compile pin at Layer 5; the "up to 81 px"
wording now reports 228 px measured. Custom-preset names truncate
with a title (input capped at 60; SafeZoneWarningModal's clipName
row got the same cap); the IC native-dialog inventory is refreshed
and a self-checking docClaims scan — the worker's second judged
deviation, accepted — keeps its rows pointing at real lines; Clear
and Restore no longer share a busy flag: each keeps its own static
label and both dim while either runs. (Corrected in round 84: this
entry first claimed a "Clearing…" label that was never built —
three sweep-21 reviewers caught the over-claim; the behavior
itself, split flags with Restore alone relabelling, is as the
ticket allowed and the wiring pin holds.) Expedited personally: verify x2
(174/4751), test:media on 7.0.2 (337 passed | 13 skipped of 350),
the touched T-132 (4) block on 6.1.1 (10/10), build + FULL
Playwright 392/392 with zero flakes on both the worker's and the
expediter's runs; one independent mutation at a seam no ledger row
names (referencesStore's `latestQuery = query` made a no-op → the
"one request for three presses of one query" case red, plus its
correction-undone sibling → restored byte-identical, sha256
verified, 22/22 green). Landed conflict-free onto its own base;
the landed tree's gates are this entry's commit.

Round 82 — T-133, all 11 of the nineteenth sweep's verified
findings, landed in the commit that carries this entry. Worked by
one Sonnet in a fresh clone of d90c01b; 58 ledger mutations all
killed and restored byte-identical, 29 reds (15 of them the new
e2e cases proven red on a base build of the unchanged tree; seven
early confounded mutation rows disclosed and re-run clean). The
headline (item 1): a LIVE TAKE is now registered once, in
lib/liveTake.ts, and every way off the Record screen asks the same
question — the Home link, the "Open Audio Studio" toast action and
both "Edit in Video Studio" toast actions; OK stops and saves the
take where the person is, Cancel keeps recording, and the caller
never navigates immediately; a wiring test holds the renderer's
navigate() calls to a decided table. Toast text can no longer
escape its card (overflowWrap: 'anywhere', measured red on base at
228 px of overrun); clip names truncate by code point; the ranged
caption burn-in gained the no-picture guard (PictureFrames +
sticky stderr; 7 Layer 5 cases green on BOTH majors, replicated by
the expediter personally; the "every runner" claims softened to
the truth); wroteOutput asks only for a non-empty regular file and
extractFrame refuses a pre-existing target before the spawn, so a
slow-clocked share can no longer lose a good thumbnail (T-110 (p)
narrowed to the discard path); Clean audio re-asks before
replacing work tuned DURING the extraction (only when the chain
changed since the first ask — the worker's right narrowing — and a
decline keeps the tuning with a truthful toast); a held Enter or
Space is guarded BY KEY until release (createHeldKeyGuard — the
worker's improvement over the ticket's fixed window, with the
window-mutant killed to prove the difference; covers the tour,
the wizard and every Modal), and Space/? toggles ignore repeats
while the nudge keys keep repeating; the reference search's
single-flight guard lives in the store's search() so every caller
shares it; the five undimmed disabled buttons are dimmed and the
"every other disabled button" claims are now true; the waveform
read's refusal names "a standard PCM WAV or MP3"; the doc
corrections landed with three new docClaims pins. Found-not-fixed,
ledgered: importDiagnostics.ts:142 still carries the old circular
advice (one line + its pin — out of item 10's scope). Expedited
personally: verify x2 (174/4738), test:media on 7.0.2 (336 passed
| 13 skipped of 349), the whole Layer 5 file on 6.1.1 (329 passed
+ exactly the 7 known pins), build + FULL Playwright 387/387 on
the expediter's run (the worker's one flake was the documented
record.spec load flake, 5/5 standalone); the burn-in guard
replicated on both real binaries; one independent mutation at a
seam no ledger row names (mayLeaveLiveTake answering true on OK →
the "the caller still does not navigate" case red → restored
byte-identical, 5/5 green). Landed conflict-free onto its own
base; the landed tree's gates are this entry's commit.

Round 81 — T-132, all 14 of the eighteenth sweep's verified
findings, landed in the commit that carries this entry. Worked by
one Sonnet in a fresh clone of 1304e0a; 51 ledger mutations all
restored byte-identical, 22 reds, 11 of the new e2e cases proven
red against a build of the unchanged base tree. The worker
disclosed two survived mutants (each superseded by a stronger one),
three after-the-fact TSV exit-code corrections, one documented
redesign (the first audioSettled draft read an empty studio as "no
sound opened"), and one measured deviation the expediter replicated
personally on BOTH majors before accepting: the ticket's
FFMPEG_EMPTY_OUTPUT sketch cannot catch the audio-only trigger
(that run prints NOTHING to stderr), so the new
src/main/ffmpeg/noPicture.ts reads ffmpeg's own progress stream and
treats a last-block frame=0 OR the stderr line as "wrote no
picture" — a stream that never reported is not accused, and
legitimate one-frame clips stay successes. Headlines: Clean audio's
completion navigates only when the person is still on /video
(anywhere else the sound loads silently and a toast offers the way;
a live Record take keeps recording — e2e holds the extraction 14 s
through a take); Export/Reframe/extractFrame refuse empty and
audio-only output with named-clip sentences through the existing
discard path (both-majors Layer 5, 9 cases); PRODUCT_GUIDE's
reverted ceiling sentence is restored and docClaims now scans
README, PRODUCT_GUIDE and USER_GUIDE; the Clear-transcripts row
wraps whole; the waveform's maxPeak covers both halves; a held
Enter (or arrow — the worker's right scope call) steps the tour
once; custom presets inherit fps and bitrates from their base row;
"Loaded"/Recent wait for the waveform's arrival; compilation
refusals name the clip the person sees; the settings-write failure
toast coalesces under one id; a partial clear warns instead of
ticking green. One ticket item consciously narrowed: the third
"five platforms" comment is Clip Kit's own count, which IS five.
Expedited personally: verify x2 (172/4686), test:media on 7.0.2
(329 passed | 13 skipped of 342), the whole Layer 5 file on 6.1.1
(322 passed + exactly the 7 known pins), build + FULL Playwright
(one load flake in the suite run — the durationless-WebM import,
green standalone in 2 s and green in the worker's own 373/373 run;
re-adjudicated on the landed tree's full run below), the item-4
triggers replicated on both real binaries (exit 0, empty stderr,
frame=0, audio-only output), one independent mutation at a seam no
ledger row names (wroteNoPicture's OR -> AND → 5 unit cases red
across both shapes → restored byte-identical, 22/22 green). Landed
conflict-free onto its own base; the landed tree's gates are this
entry's commit.

Round 80, checkpoint 4 (the round's last) — T-131, all 18 of the
seventeenth sweep's verified findings, landed in the commit that
carries this entry; docs/SESSION-HANDOFF.md is deleted with it, the
four-ticket wave being complete. Worked by Sonnet (paused
2026-10-16 as wip/t131-partial-20261016), resumed by a second
Sonnet, killed by a container restart near its final gate, and
finished by a third under the death protocol (all 124 ledger rows'
current shas matched their before state — zero mid-mutation
residue; the item-1 red re-proven on BOTH majors: removing
apad=whole_dur fails 11 unit cases and 8 Layer 5 cases including
both replication-harness cases, restored byte-identical). The
headline (item 1, the T-127 (4) regression): a compilation segment
is written with -shortest, so a source whose sound did not cover a
segment made the SOUND the shorter stream — an empty stub the join
silently dropped with every segment after it, and the file still
said "Saved". The fix is the banked apad=whole_dur=<outSec> as the
last -af stage (bare apad regresses drift on 6.1.1 and hangs with
-c:v copy on 7.0.2 — never deviate), -shortest kept, PLUS two
fail-loudly guards: an exit-0 segment that wrote nothing and an
exit-0 join that lost a part each reject with a user sentence
instead of saving a shorter file. Item 2 gives Re-attach and
Picture-in-picture the same pad. Items 3-9: scan results no longer
outlive their video (a late scan is dropped, appendRange refuses),
isRepeatPress/claimFirst/swallowRepeatClicks retire the
double-click family (the next question answered, a tour step
skipped, a second chooser, a checkbox under a closing dialog), the
Cancel question no longer reads "Cancel 0 running jobs?", and the
`?` key is named in the UI. Items 10-12: the networkAllowlist scan
grew to 42 cases and stopped claiming to be finished. Items 13-15:
the folder chip sleeps under a busy primary, the filename hint has
its own line, one × glyph app-wide. Items 16-18: STYLE_GUIDE
corrections, the honest win32 quit comment (T-110 (az)), and
Inter's OFL ships via extraResources (releaseWorkflowShape pins
it). Expedited personally on the worker's tree: verify x2
(162/4467), test:media on 7.0.2 (299 passed | 11 skipped of 310),
the touched 6.1.1 blocks 22/22 (including the 10 s/6 s replication
harness: segments [1,3][7,9][2,4] deliver 6.0 s and
[1,3][5,8][2,4] deliver 7.0 s, on the distro binary), build + FULL
Playwright 354/354 (the two load flakes its worker saw against a
pristine base did not recur); one independent mutation at a seam no
ledger row names (isRepeatPress's boundary, detail > 1 → > 2 → the
"click number 2 of a run is a repeat" case red → restored
byte-identical, 8/8 green). Landed as the fourth serial checkpoint
with seven hand-resolved merges; three real union collisions were
found and fixed at the landing: T-130's new fade assertion now
expects T-131's apad tail, the shared concatRunner probe mock
carries both trees' knobs (probedFps + probedSec/throw), and the
T-131 (18) license pin now reads the package's woff2 urls from
index.css (T-128 (2) moved the consumption out of main.tsx). The
union tree re-gated: verify 171/4614 plus the full media and
Playwright suites (results in this entry's commit).

Round 80, checkpoint 3 — T-130, the platform-rate and kit-art debt
((q), (t), (an)), landed in the commit that carries this entry.
Worked by Sonnet in a fresh clone of 1f3c12e; a container restart
killed it mid-round and a second Sonnet resumed under the death
protocol (all 30 ledger rows' shas matched their before state — no
residue; one red per item re-broken and restored byte-identical).
(q): the compilation follows its source's rate up to 60 —
`compileFps()` in shared takes the fastest clip rate as a number
(NTSC stays fractional), caps at `MAX_COMPILE_FPS = 60`, and falls
back to `COMPILE_FPS = 30` only when no clip states one; the fps
stage and `-r` both take the derived value, and the Compile card
shows it. A "YouTube 1080p60" preset (1920x1080, 60 fps, 12M per
YouTube's 1080p60 guide) joins both preset tables — and the Clip
Kit now reads its own `KIT_PLATFORM_IDS` so the kit stays five
files instead of silently gaining a sixth. (t): Clip Kit
thumbnails honor the clip's crop — `extractFrame` takes `cropRect`
and applies the shared even-pixel clamped `cropToFrame` stage (the
only filter: the thumbnail is the crop at source pixels, so there
is no scale to order against); the source is probed only when a
crop exists. L5 pixel cases prove the inside color present and the
outside absent, with a positive control that caught `-ss 0`
decoding zero frames from a JPEG (a lesson entry: a negative pixel
assertion needs a positive control through the same reader). (an):
the watermark clears platform UI on 9:16 — `isVerticalFrame`
(shape-judged, 2% snap tolerance; 4:5 and square are not vertical)
takes `VERTICAL_WATERMARK_INSET = { top: 0.15, bottom: 0.25 }` of
the frame height (288/480 px at 1080x1920, clearing the published
TikTok/Reels/Shorts header and collapsed-caption rail), landscape
keeps the flat 20 px; the side action rail is documented as not
cleared (a left corner is the answer). Worker deviations accepted
by the expediter: the rate reads the probe's existing fps (average
first — the Timeline's own reading; keeps the Record WebM 1000/1
clock as "no rate"), the inset pair lives in shared/watermark.ts
because main, renderer and tests all read it, and the T-127 (4)
fractional-series fixture starts moved onto the 25 fps grid the
compile now actually runs at (adjudicated: the drop-`-shortest`
mutation still reds the case at 0/10/30/60/80/110/130/130 ms).
Found in the round and ledgered: two settings unit tests fail when
TMPDIR exceeds ~31 chars (the fixture path overflows
streamerHandle's 80-char schema cap), and the e2e suite fails
under a symlinked TMPDIR — both in IC's found-not-fixed. Expedited
personally on the worker's tree: verify x2 (168/4522), test:media
on 7.0.2 (295 passed | 13 skipped of 308), the whole Layer 5 file
on 6.1.1 (288 passed + exactly the 7 known pins), build + FULL
Playwright 344/344; one independent mutation at a seam no ledger
row names (the vertical inset computed from the frame's WIDTH
instead of its height → 4 unit pins red → restored byte-identical,
142/142 green). Landed with hand-resolved doc merges; the merged
tree re-gated: verify 169/4533 plus the full media and Playwright
suites (results in this entry's commit).

Round 80, checkpoint 2 — T-129, the waveform stops decoding whole
files in the renderer and the 2-hour ceiling retires (T-110 (ao)),
landed in the commit that carries this entry. Worked by Opus in
round 78 (paused 2026-10-16 as wip/t129-partial-20261016), resumed
by a second Opus under the death protocol (all 94 named unit tests
re-run by name; one red per finished sub-item re-broken and
restored byte-identical; one predecessor restore row marked FORCED
was re-proven with identical shas as v3b). The mechanism: main
decodes the sound as a STREAM (ffmpeg, mono, 8 kHz, s16le to a
pipe) and folds every chunk into 4000 highest/lowest pairs holding
at most one carry byte between chunks; wavesurfer is given peaks +
duration and never fetches or decodes the file (the STOP rule was
re-verified against the installed 7.12.6 source: with peaks, both
the fetch and the WebAudio decode branches are unreachable);
playback streams over the Range-capable imagii-file protocol as it
always did. The renderer shows "Drawing the waveform… NN%" from
the job's progress events where the waveform will appear. The old
path measured 173 → 1460 MB of renderer memory in ~8 s on a 2 h
5 min file (render-process crash, exit 5, or an immediate decode
refusal — run-dependent); the new path peaks at ~182 MB with main
growing +1.5 to +29 MB, drawn in ~15 s. The 2-hour ceiling is
retired everywhere (code, copy, pins: README, PRODUCT_GUIDE,
USER_GUIDE, STYLE_GUIDE; the T-126 (8) scratch-WAV backstop went
with the pre-check; a 4 h VOD now extracts and opens like any
recording). A failed read refuses the file with its own sentence
(WAVEFORM_READ_FAILED); a player that cannot play reports
PLAYBACK_ERROR_MESSAGE separately; Close or opening another file
cancels the job (per-job latch; the quit sweep stops it with the
other audio jobs). The resume worker also fixed a test-design gap
it found: the long-file e2e read renderer memory only after Play
turned on, so the memory line could never fire — the wait now ends
on the first of Play, the 800 MB line, or the player's error, and
the percent is checked in the visible words. Expedited personally
on the worker's tree: verify x2 (161/4397), test:media on 7.0.2
(283 passed | 11 skipped of 294), the touched 6.1.1 blocks (10
passed: the peaks block + both extraction flips), build + FULL
Playwright 336/336; one independent mutation at a seam no ledger
names (the peak folder's carry-path sign conversion → the two
chunk-boundary unit cases red → restored byte-identical, 16/16
green). Landed with hand-resolved merges in preload/api,
media.spec.ts, video-pipelines.spec.ts, interactionWiring and the
three count docs; the merged tree re-gated: verify 167/4468,
test:media 285 passed | 11 skipped of 296, and the full Playwright
suite. The first merged-tree suite run surfaced a pre-existing
test race, root-caused by the expediter: two single-output e2e
cases poll for the output file (which exists at ffmpeg's FIRST
write) and then gave the rest of the encode, the close and the
re-render only expect's 5 s default — measured 5.09 s under three
concurrent suites, a razor's edge both parent trees happened to
clear. Both enabled-checks now carry a 60 s ceiling with a comment
naming the contract (the repo's own round-77 lesson: a green test
that races the platform proves the platform's speed). The failure
reproduced three times before the fix and the case passes with it;
the full suite re-run after the fix is 344/344 (38.1 minutes with
both sibling workers' suites running). Found-not-fixed carried to the
T-110 ledger as (ba) the >4 GB WAV header past ~6.2 h extractions
and (bb) no user-facing Cancel on Clean audio's extraction.

Round 80, checkpoint 1 — T-128, the six-item small-debt batch,
landed in the commit that carries this entry. Worked by Sonnet in
round 78 (paused 2026-10-16 as wip/t128-partial-20261016), resumed
by a second Sonnet under the death protocol (inherited ledger
re-verified: named tests re-run, one red per completed item
re-broken and restored byte-identical). The six: (1) titles on
every remaining truncated name, with an a11ySweep rule that counts
the pattern so a new truncate without a title fails the build —
DESIGN_GUIDE 220-222 is now true; (2) woff2-only Inter via three
explicit @font-face rules, the build emits 3 woff2 and 0 woff
(e2e-asserted), @fontsource stays out of the asar; (3) Clear saved
transcripts (T-110 (s)) — main/transcripts.ts counts and empties
only main's own <userData>/captions (lstat never follows links; a
shifted burn-in copy is not a transcript; the IPC takes no
argument), CaptionsPanel confirms with the count and reports
removed/failed distinctly; (4) persistSetting() (T-110 (x)) — a
refused settings write is one reportFailure sentence and the press
still works, with a failurePathLanguage rule failing any bare
settings.set; (5) quit coverage for convert + extraction (the
T-127 (3) "not covered" list) — both are latch runs until their
cleanup is done so the before-quit drain waits for it, proven on
real ffmpeg on both majors (no moov-less mp4, no scratch WAV), and
the CRITICAL half: the quit sweep never touches a finalizing
take — ConvertCancelledError.byQuit tells a quit from a Discard, a
quit-ended save keeps the raw webm (the only copy) and removes the
half-written mp4 (e2e: window-X mid-convert); (6) one id alphabet
(T-110 (ad)) — SAFE_ID_RE exported from pathSafety.ts is the single
spelling, with a pin that fails on a second copy. Expedited
personally on the worker's tree: verify x2 (166/4457), test:media
on 7.0.2 (281 passed | 11 skipped of 292), the touched 6.1.1
blocks (22 passed; the 1 failure re-run by name and confirmed as
the known mpegts platform pin), build + FULL Playwright 342/342;
one independent mutation at a seam no ledger names
(cancelAllConverts' byQuit argument → both quit-keeps-the-take
unit cases red through the real convert.ts → restored
byte-identical, 5/5 green); verify + the touched L5 blocks re-run
on the landed tree.

Round 77 — review-gate fixes, the sixteenth pass's findings:
T-127, all 16 items (item 2's packaging half was done
expediter-side: @fontsource/inter moved to devDependencies, so
the asar stops carrying 4.38 MB nothing reads at runtime). The
HIGH headliner: the shipped app contacted Google on EVERY
launch — Electron's default spellchecker downloaded its
Hunspell dictionary from redirector.gvt1.com and Chromium's
secure-DNS auto-upgrade probed dns.google whenever the
machine's resolver is a known DoH provider. Found by the
sweep-16 design reviewer's net-log run, replicated by the
expediter before ticketing (4 gvt1 + 42 dns.google requests on
an idle launch), fixed by three calls (webPreferences
`spellcheck: false`; `app.configureHostResolver({secureDnsMode:
'off'})`; `session.defaultSession.setSpellCheckerLanguages([])`
— the third was a MEASURED necessity the ticket had not named:
the empty language list is what actually stops the download,
and it must run every launch because Electron re-seeds en-US
into an empty persisted list), and held from now on by a
built-app NET-LOG e2e (zero URL_REQUESTs with a loopback
control; README's "zero network requests on startup" is a
tested claim at last) plus a wiring pin on the three calls and
their order. The expediter re-captured both logs personally:
red on the pre-fix build, zero hosts on the fixed one. The
win32-binary confirmation is on the release run's hand-checks.
  The other MEDs: Export's Cancel moved to its own row (four
convergent sweep reports; a human-paced second press now lands
on the disabled primary — e2e presses at 120 ms for real);
quit mid-job drains — cancelLatch gained openRunCount()/
drainRuns() (bounded 1.5 s, never rejects) and before-quit
waits once for the killed runs' own T-100 cleanup, so a window
X mid-export no longer leaves `name.mp4` wreckage at its final
name and a re-attach's .cleaned.wav dies with it (named
not-covered: quit mid-convert, extraction scratch WAVs — the
6 h reaper — and the model download's partial); Compile's
joins stopped drifting — `-shortest` in the segment argv
(red series 3/57/83/112/125/161/194/194 ms over eight
fractional 25 fps segments, green 3/-3/7/0/0/0/0/0, both
majors, new fractional-segment Layer 5 case; T-125 (1)'s
"<15 ms" claim corrected: true per segment, false across
joins); and the guard's two MED blind spots (qualified
constructors; getBuiltinModule/createRequire/export-from)
closed with the LOW vocabulary batch (http.request-family and
tls/dgram cases, location qualifier chain, bracketed IPv6,
image-set(, createElement of loading tags, devDependencies in
the package check, window.eval/new window.Function,
import-equals; fetch-as-value and platform traffic DECLARED
under WHAT IT CANNOT SEE — the net-log e2e holds the latter).
  The LOWs: the Source-time pair speaks one language
(overlayTimePair, ONE boundary; trailing "s" only in seconds
form; labels teach the clock form); the Modal scrim ignores
e.detail > 1 so a double-click cannot dismiss the question it
raised; the tour names the folder button as it actually reads;
probeAudio computes hasVideo BEFORE judging the duration and
NoUsableDurationError carries it (a durationless audio-only
WebM now gets the audio remedy and no Re-attach); ThumbnailVariants'
saveOne/saveAll and CaptionsPanel.saveSrt claim-first
(singleFlight 11 → 14); titles on four truncated names (the
remaining title-less truncate spans are named in IC as
found-not-fixed); ::placeholder drawn from ink.dim and pinned
with its contrast triple (6.20/5.83/5.33).
  Worker: one Sonnet round, 40 files, +1857/-160; ledger
r77/ledger.tsv (199 rows, every restore byte-identical,
superseded rows marked); red/green net-logs in r77/netlog/.
Expediter gates re-run personally (transcript
tasks/brndqgiad.output): verify ×3 — 160 files / 4386 tests;
media 279|11 of 290 on 7.0.2; 6.1.1 blocks T-127 3 / T-126 17
/ cut-stage+MediaRecorder 19 (the worker additionally ran the
WHOLE 6.1.1 suite: 272 pass + exactly the 7 ledgered platform
pins); build + FULL Playwright 333/334 with the one failure —
record.spec.ts "a window that closed while the start was still
opening" (T-124 (1)) — re-run 3/3 green in isolation and green
in the worker's own full run: a load-timing flake, recorded
here, not a regression. Expediter independent mutation at a
seam none of the worker's 199 rows name: the moved Cancel's
`remaining >= 2` confirm threshold broken to `>= 99` — the
PRE-round pin ("cancelling a multi-job batch asks first",
video-pipelines:2883) went red, proving the old coverage still
guards the relocated button — restored byte-identical
(f2ed96c3fe18 → d4822a3bf82f → f2ed96c3fe18) and the test
green again.
  SHIPPED ON THE OWNER'S INSTRUCTION (2026-10-15, "Pause after
the next update. Ship what you've fixed so far"): this commit
closes rounds 49-77 with every verified finding from sixteen
review sweeps fixed, and supersedes the two-consecutive-clean-
sweeps hold for this ship; NO post-round-77 review sweep has
run — sweep 17 was staged (scratchpad/s17/brief-common.md) and
not dispatched. The review-fix loop is PAUSED here. Standing
owner notes: /long.mp4 (a 647 KB round-74 scratch at the
container's filesystem root; the delete sits behind the
root-level safety check), the release run's hand-checks in
TESTING.md (win32 net-log, asar without @fontsource, the
v1.6.0 release dispatch must carry inputs {tag:"v1.6.0"}), and
the T-110 backlog stands at letters (a)-(aw).

Round 76 — review-gate fixes, the fifteenth pass's findings
(held uncommitted): T-126, 23 of 24 items landed; item 22
closed by its own STOP rule instead (below). The round survived
a worker death: a container restart at ~07:29Z killed the first
Sonnet worker mid-ticket. The death audit found a clean join —
every mutation row in its ledger reads restored=IDENTICAL, the
current shas matched the restored shas, and `npm run verify`
was green at the join (160 files / 4321) — and a resume worker
under the T-119 death protocol re-verified every inherited
claim with its own re-run mutation per completed item (ledger
rows r2-*/r2b-*, 88 mutations, every restore byte-identical)
before finishing the rest. The first worker also deleted
/dev/null with a typo'd rm (restored by the platform at the
next restart, no repo impact — its own ledger recorded the
accident), and the resume worker deleted four ~1.4 GB scratch
WAVs its predecessor's red mutants had leaked into
/tmp/imagii-audio.
  The MED headliner (21): `-r N` alone left the picture ~2
output frames behind its sound whenever the effective rate
exceeded the preset's — the expediter replicated it on the
bundled 7.0.2 before writing the ticket (export-shaped `-r 30`
on a 60 fps flash+beep fixture: 302 frames / 10.07 s, flash
first visible at 5.0667 s; with `fps=30` in the chain: 300 /
10.00 s, flash at 5.000 s; beep at 5.013 s in both) — fixed by
one `fps=${preset.fps}` stage in `buildVideoFilter` right
after the speed retime, covering Export, Reframe and Compile;
Layer 5 measures the event times on real output through all
three runners, both majors. The double-click MED (19): seven
start handlers (audio Export, Compile, GIF, PiP, Reframe,
Clip Kit, burn-in) claimed busy only after their first await,
so a double-click ran two jobs (QA executed it: two choosers,
two files) — all seven now carry ExportPanel's claim-first
startingRef shape, pinned by singleFlight (4 -> 11 functions)
and a dblclick e2e with a 300 ms chooser stub. The audio MED
(7): has-a-picture is decided by the probe's STREAMS, not the
filename — an audio-only .mkv/.mp4 no longer rides the
Re-attach circle; the refusal kind falls back to the extension
only when the probe cannot read the file. Durationless
fall-throughs now ask the ceiling of the WAV in the handler
and delete a refused scratch with the refusal (8). The
networkAllowlist guard was rebuilt where it overclaimed (1):
CSP judged by a LOCAL allowlist (scheme-less hosts, host:port,
IPs and case variants all read as remote now), call matching
on the last two segments and through import aliases,
import-level sites for aliasable surfaces, crashReporter.start
implemented, location/setAttribute/SVG/computed-url(
vocabulary added, header rewritten to claim exactly what the
scan proves (43 new positives red on the old scanner; 35
round-21 negative breaks, each failing its named case).
  ITEM 22, CLOSED WITHOUT CODE (the STOP rule fired): the
sweep's fix sketch — cap extraction with `-t` against the
probed duration — was disproven by the worker before
implementing: ffprobe reads ~630 s on EVERY shape of the
timestamp-jump fixture (the reviewer's own fixture included),
because the jump inflates the container's claimed length
itself, so there is no truer figure to cap against; the WAV
already matches the duration every player and this app's UI
report. The timestamp-RESET case silently drops real audio and
has no ffmpeg knob (`first_pts=0` alone behaves the same).
Both bounds are now recorded where the filter is used
(extract.ts, "T-126 (22), known limitation").
  Honest limits, recorded as found: the Reframe readout's
nowrap (14) has no demonstrable red after the header retitle
("Reframe to 9:16" — "(center crop)" was stale against the
Left/Center/Right positions) because the short title fits
either way, kept as a guarantee; DraftField's basis-full (3)
is redundant beside order-last today, kept as a guarantee; the
Cancel-row fix (20) is witnessed by geometry (Cancel below the
primary) because the Xvfb font misses Cancel by ~50 px on the
base build's dblclick; the fade readout's own classes (11) are
not isolatable in the e2e (the slider gives first) and are
held by the unit scan that also fixed thirteen siblings in
twelve files. Worker deviations beyond the ticket's letter,
each driven by a measured finding: min-w-0 on the six flex-1
sliders beside guarded readouts (the shrink-0 readout
otherwise overflowed the card by 27 px); OutputDirLabel
`w-full max-w-[9rem]` (a bare min-w-0 left the label at
min-content and the ellipsis never fired; the first attempt,
max-w-[min(9rem,100%)], lost the cap during button sizing and
failed one Playwright case before being fixed and the suite
re-run green); the gain readout is min-w-[3.5rem], not w-14
("-10.0 dB" is 58 px in Liberation Mono). Inter ships (18):
@fontsource/inter latin 400/500/600 imported in the renderer
entry (dependency installed by the expediter; lockfile
expediter-owned), proven in the built app by
document.fonts.load faces — `document.fonts.check` alone is
TRUE for an unknown family, measured and recorded — plus a
built-css url() scan (no scheme, no host, every file exists).
  Expediter gates on the final tree (transcript
tasks/bxpnigbbs.output): verify ×3 — 160 files / 4336 tests;
test:media on 7.0.2 — 276 passed | 11 skipped of 287; 6.1.1
blocks via the alias config — T-126 16, T-125 22, cut-stage +
MediaRecorder 19, all green; build + FULL Playwright 326
passed. Expediter independent mutation at a seam no worker row
names: `readoutText` (shared/units.ts, new this round, no
mutation in either worker ledger) broken to always space the
unit — the named ratio case failed ("expected '8 :1' to be
'8:1'") — restored byte-identical (006128da3a08 ->
ca96453af0c4 -> 006128da3a08; r76/ledger.md). TESTING counts
and timing refreshed by the worker (verify 39.0 s; media
366 s; e2e 1287 s; the loaded-timing column marked not
re-measured); LESSONS has the full T-126 section;
INTERACTION_COVERAGE gained the round 76 rows (2, 3, 4, 5, 6,
7, 8, 11-16, 18-20) plus the pin-only disposition for the two
dialog-first double-click surfaces (Clip Kit, burn-in). Owner
notes standing: /long.mp4 (a root-level 647 KB scratch from
round 74; the delete is behind the root-level safety check)
and the v1.6.0 release dispatch must carry inputs
{tag:"v1.6.0"}.

Round 75 — review-gate fixes, the fourteenth pass's findings
(held uncommitted): T-125, all 28 items. The HIGH: Compile's
segments are now Matroska with PCM sound and the join encodes
AAC ONCE (`-c:v copy -c:a aac -b:a 192k`) — the stream-copy
join of per-segment AAC drifted the sound +29.3 ms PER JOIN
(priming + end padding; the Layer 5 beep-vs-flash case's red
was the measured 0/30/59/88/118/147/176/206 ms series, on both
majors, now < 15 ms per segment). Extraction carries
`aresample=async=1:first_pts=0` (a late-starting audio stream
re-attached 0.278 s early; captions shared the extractor; a
start-0 file's WAV stays SHA-identical). The denoise strengths
are ORDERED: `nf=-35/-30/-25` with `nr=12/18/24` (the sweep's
matrix showed Aggressive removing least on the loud-fan noise
its label sells; the Layer 5 ordering case pins
removal(L) < removal(M) < removal(A) on pink −44 dBFS; the
exact numbers are flagged as the owner's to retune, and the
Custom hint now names Light's real floor — a worker deviation
the old ticket wording would have made false). A durationless
container falls through to extraction (the WAV-side gate
backstops; quadruple-confirmed finding). The 256-sample cut
grid re-chunks to 4096 after `asetpts` (the 1.7-2.3x slowdown
measured gone, output bit-identical). The audio progress bar
divides by `keptDurationSec` (merged spans — the expediter's
independent mutation broke the merge and three named pins went
red, restored byte-identical da624272). `.aiff`/`.aif`/`.wma`
stopped being videos (fromVideoPath only for real videos; the
refusal kind from `isVideoFilename`; the WMA load→export case
is the red; the T-124 (7) circle is closed for them). DraftField
keeps the draft while the box has focus ("0.05" and "-0.5"
arrive intact; the comment documents the React value-rewrite
mechanism). Reframe builds with `buildVideoFilter` at the 9:16
frame with the position-aware strip — grade, hook text, zoom
and shake now reach the vertical file (the round-74 "matching
Compile" scope was the EXPEDITER'S error, owned here; the
Layer 5 red measured an unbrightened gray and a missing
overlay; drawtext stands in as drawbox on the bundled 7.0.2 and
runs real on 6.1.1, the suite's established split). The folder
class: the settings read answers `undefined` for a remembered
folder that is not a folder NOW (stored value kept — the drive
may come back; Export/Kit/video keys alike), runners mkdir
their output folder and the failure sentence NAMES it, the four
side-panel buttons share one store so a pick follows within the
visit, OutputDirLabel truncates at max-w-[9rem] with a title
(the pristine red: a long name pushed "Reframe to 9:16" 370 px
past its card), and the PiP card re-grids ("Bottom rig" whole
again). Native controls wear the theme (`color-scheme: dark`,
`accent-color` from the token, toast icons from tokens — stock
Chromium blue and stock toast green/red were the reds). The
zero-length overlay window gets its own honest sentence; the
Levels sentence gained "or cut a part out"; "Size (px)" ×2; the
Source-time row keeps "→ end s" together; `startExport` claims
synchronously; the FixWizard and moodboard fact toasts hold
ACTION_TOAST_MS; Clean audio skips its load+navigate when the
audio source changed during extraction (`replacedSince`); the
ErrorBoundary tells the truth ("Your work is still open in its
studios..."); Compile and the re-attach suggestion drop the
scratch names and GIF/Reframe names carry the clip
(`stream_Clip 1_reframe-...`); times read h:mm:ss from one hour
(`shared/clockTime.ts`, also replacing four pre-existing copies
— disclosed; the Source-time boxes accept h:mm:ss); the Video
tour introduces Clip Kit; a mic that dies mid-take warns once
while the take carries on (watchMicEnd, the mirror of
watchScreenEnd). The networkAllowlist guard grew to its claims:
`useImage(` is a site with a (g)-cited ALLOWED line, the CSP
regex sees bare `ws:` with `KNOWN_CSP_EXCEPTIONS` naming the
(m) token (both recorded as owner-pending EXPOSURES, not
approvals), the vocabulary gained WaveSurfer.create/dynamic
import/eval/new Function/downloadURL/updater+crash
SDKs/fetching spawns/media elements (18 discriminating
mutations incl. a planted `publish:` and a remote font), the
dependency and electron-builder assertions landed, and the
header says honestly what an AST scan cannot see — the test is
12 cases now and TESTING says so. The overlay fields' visible
labels lead their accessible names (2.5.3). Counts moved: unit
151→156 files / 4,089→4,254; media 271 cases; Playwright
297→314. Gates, worker then expediter independently: verify ×3
(156/4,254), media 260|11 of 271 on 7.0.2, the 6.1.1
T-125/T-124/MediaRecorder blocks 22+10+14 under the expediter's
own alias config, clean build, FULL Playwright 314/314; the
same SEVEN 6.1.1 platform pins as rounds 73-74, no new ones.
Worker ledger: 143 rows, all restored=IDENTICAL. Ledgered, not
fixed: the Custom noise-floor's default (−25/12, no preset's
setting after the swap) is a product note; PipPanel's Margin
box stays a per-keystroke input (low, noted); the OBS
multitrack picker is letter (ap) and overlay text styling is
letter (aq); the minimized-window save dialog joins the owner
hand-check list with the YouTube-thumbnail 50 MB rollout note;
the hour-scale highlight/captions lists are unit+pin covered
(an E2E needs a scanned VOD, disclosed); the deleted-folder E2E
takes ~9 min to FAIL on a pre-fix build by polling design —
noted so nobody reads the slow red as a hang.

Round 74 — review-gate fixes, the thirteenth pass's findings
(held uncommitted): T-124, all 33 items. The recorder now hears
a screen track END (`watchScreenEnd` on the captured video
tracks; with the mic on, a crashed game used to leave REC
counting over a frozen frame — three E2Es incl. webcam and
already-ended); crash recovery loads the ENTRY (`loadEntry`,
shared with createWindow) instead of `reload()`, which kept the
hash and reloaded INTO the dead studio while logging "reloading
to Home." (round-73 defect; the studio-crash E2E asserts #/home
+ banner), and the recovery reload abandons recording sessions
not yet closed (four orphaned fds used to exhaust the cap); the
autosave banner is gated on `sessionHoldsWork` — one ask per
mount, ahead of BOTH banners, so a mid-session Home visit no
longer offers a destructive unconfirmed Restore while launch
and crash-reload still do; `persistWindowBounds` is try/caught
(a chattr-held config.json used to raise the main-process
dialog and break the quit snapshot); the 2 h gate now refuses
BEFORE extracting (handler probe + the VideoStudio
short-circuit; a 4 h VOD used to burn minutes and orphan a
~2.8 GB WAV) and `waveformCeilingRefusal` is kind-aware (the
old sentence sent an audio-only file to Video Studio, which
sent it straight back). The Stream Graphics canvas family is
CLOSED: image layers get real per-id ref callbacks (the
spread-fresh `shapeRef` meant images could never be resized),
the attach effect keys on `tool`, a draw finishes on a window
mouseup (releasing off-stage used to lose the shape and strand
the preview), the Line tool gates on `Math.hypot` (horizontal
and vertical lines were refused; the boundBoxFunc also stops
freezing thin boxes — a worker find, red-first), layer names
truncate again (T-114's span→button regression), a locked
layer gets no Transformer at all, images snap like everything
else, and PropertiesPanel x/y/rotation plus overlay x/y are
DraftFields (the minus sign and leading decimals survive;
bounds in shared/canvas.ts `layerOffsetRange` [-extent,
2×extent] and ±360 — the expediter's independent mutation bent
those BOUNDS and three named pins went red, restored
byte-identical 08dbdc37). Reframe consumes the clip's CROP and
SPEED through the shared builders (the T-96/T-105 wrong-file
class; Layer 5 measured the red block excluded and the 2x
durations on BOTH majors) and Reframe/GIF names derive from the
source's display name, not the scratch basename. Copy and
affordances: "Source time" labels + a role=status warning when
an overlay window misses the clip (it exported nothing,
silently), the BRANDING no-preview lines at the four owed sites,
the re-attach MUX toast carries "Edit in Video Studio" (audio
exports deliberately do not), GIF/Compile/Reframe/PiP seed one
shared `video.lastOutputDir`, the Text-overlays card joined the
layout suite (its ✕ sat 12 px outside the card), the Power-line
select is stacked full-width with shortened labels and layout.ts
gained `expectSelectsWhole` (the old check was provably vacuous
for selects), the ParamSlider readout stopped wrapping
mid-drag, the Levels sentence states its true scope, the four
%TEMP% sentences stopped overclaiming (naming imagii-audio/
import/concat and the 6 h next-launch prune), README got the
peak-limit sentence its ledger record claimed, and
`tests/unit/networkAllowlist.test.ts` (6 cases by vitest's count —
this entry first said 23, a transposed figure; sweep 14 counted —
AST scan, its own discrimination proofs) makes "a single
phone-home is a bug" fail `npm run verify`. `hasChordModifier` stands the bare-letter
shortcuts down on Ctrl/Meta/Alt chords (Ctrl+O used to set an
Out point; AltGr marked as a simplification), and the Rotation
presets say "Rotate N degrees". Cut precision: `asetnsamples=
n=256:p=0` ahead of `aselect` (the decoder-block truth that
corrected letter (i): FLAC 4608/ALAC 4096/WAV-7.x 4096; reds
measured to −77 ms on ALAC through the real export on both
majors; greens −1.3..+3.0 ms; `asetpts=N/SR/TB` is
sample-indexed so the retime is untouched), the checker's tail
allowance re-derived from the new grid with its derivation
commented, and WAV/FLAC/ALAC Layer 5 cases red-first on both
majors. Counts moved: unit 146→151 files / 3,976→4,089; media
249 cases; Playwright 267→297. Gates, worker then expediter
independently: verify ×3 (151/4,089), media 238|11 of 249 on
7.0.2, the 6.1.1 T-124/T-123/MediaRecorder blocks 10+13+14
under the expediter's own alias config, clean build, FULL
Playwright 297/297. The worker's ledger: 116 rows, every one
restored=IDENTICAL, with its two non-discriminating first
attempts disclosed and redone, and its whole-suite 6.1.1 run
isolating the SEVEN pre-existing platform pins (drawtext ×4,
GIF 25/2, ansi text-file, mpegts) as identical on the round-73
tree — ledgered in TESTING, not this round's business. Worker
finds beyond the ticket, accepted: the 44.1 kHz resample sits
AFTER the limiter so cut seams can ring past −1 dBFS on
non-48 kHz sources (pre-existing; IC "found, not fixed"; a
chain-reorder product call), and no application menu means a
real Ctrl+R is Electron's default Reload (owner decision,
rides with (ah)). Housekeeping: the worker accidentally wrote
/long.mp4 (647 KB scratch, OUTSIDE the repo) and the root-level
rm safety check rightly blocked both it and the expediter —
harmless in an ephemeral container, left for the owner. Owner
hand-check list gains the whisper win32 DLL-beside-exe question
and the desktop-capture frameRate default.

Round 73 — review-gate fixes, the twelfth pass's findings (held
uncommitted): T-123, all 34 items — the wave's biggest round, and
the one a container restart tried to kill. The FIRST worker died
mid-ticket (~items 1-13, 15, 20 landed); the expediter audited
the interrupted tree (consistent; three wiring pins red from the
in-flight refactor) and dispatched a RESUME worker under the
T-119-death protocol: re-verify every inherited item against the
predecessor's own baseline snapshot, never its claims. That
protocol EARNED ITS KEEP: the predecessor had been killed
mid-mutation leaving PostChecklist.tsx with the Facebook chip
REMOVED and no ledger row (re-applied), item 10's ceiling
disclosure was missing though marked done (added: the Levels
panel, USER_GUIDE, README and STYLE_GUIDE now say peaks above
−1 dBFS are limited on export), and item 4's DraftField
mutation discriminated only one of five cases (redone across
all five). What shipped: `sendIfAlive` guards the ten
job-progress send sites over eight channels (this entry first
said "nine"; sweep 13 counted) — the close-mid-export crash
dialog, with destroyed-sender tests; `keyOwnership.ts` is the one
stand-down answer (text fields and selects own every key, a
range/checkbox/radio/button owns only its native key) wired
into undoRedoIntent (+inputType), HotkeyOverlay, ImageStudio,
Player and Timeline, with videoStore importing the shared
non-text set; `DraftField` (now a component) holds drafts at
all nine number inputs, the Time fields clamp end>=start at
commit; `finalizeRecording` sets the saving phase (a take whose
window closes mid-capture no longer saves under a live REC);
`recording:begin` reserves its cap slot synchronously; the
Modal closes only when mousedown AND click both landed on the
scrim; OutputDirLabel says "Output folder:" to AT; saveOne
toasts after the null check (the component was fixed to the
pinned shape, not the pin to the component); the single-track
chain ends in MIX_LIMITER when loudnorm is off and the chain is
non-empty (red: a +12 dB export at 0.0 dBFS flat-factor 32.7,
now ≤ −1); loudnorm carries `dual_mono=true` for a mono source
on both passes (red: −13.0 on the dual-mono meter against the
−16 label; the two re-pointed legacy loudnorm cases RULED
correct — measured both directions, the old plain-meter
assertions fail on CORRECT output at −18.8, and a new stereo
control carries the plain claim); `settb=AVTB` sits between
select and setpts (the AVI 1/fps stream time base rounded the
retimed stamp BEFORE the encoder — red on BOTH majors, the one
seam case the bundled binary can show); `manualCropRegion`
clamps x+w and y+h inside the frame (red: "Invalid too big or
non positive size" killed the whole export at validator-passed
ratios); the waveform toasts its failures and refuses >2 h with
a finished sentence (`// simplification:` citing (ao));
`render-process-gone` reloads to Home once; Save .srt's
whole-recording scope is stated at the button; the Posting log
has its Facebook chip; the Reframe toast carries "Edit in Video
Studio" through the shared `useEditInVideoStudio` hook
(extracted from Record — four pins re-pointed for it); the (am)
disclosure names the browser engine's own cache (that phrasing
over the ticket's "Windows'", accepted); and the doc batch
20-34 landed, held by the new docClaims.test.ts (36 pins:
cites, the bg-black list, toast durations against the installed
library, the 800 px truth). The layout HIGH and its three
siblings: the Rotation row wraps (every preset visible at the
column's 260 px minimum), the denoise labels render whole, the
Posting-log stat rows wrap (+break-words on notes), the two
selects take min-w-0 — all held by the new
tests/e2e/layout.ts no-horizontal-overflow helper at 1632x918
and 1024x640, red against the pre-round build ("406 px wide in
a 260 px box ... <button> \"270\" +146px"). Counts moved: unit
138→146 files / 3,773→3,976; media 225→238 cases; Playwright
249→267. Gates, worker then expediter independently: verify ×3
(146/3,976), media 227|11 of 238 on 7.0.2, the 6.1.1
T-123/T-82/MediaRecorder blocks 13+22+14 under the expediter's
own alias config, clean build, FULL Playwright 267/267.
Expediter mutation at the unnamed crop x+w coupling seam
(`source.width - x` → `source.width`): 3 named reds including
the property-based sweep, restored byte-identical to b7d3bb08.
Worker deviations accepted on evidence: the hook extraction,
the CustomPresetManager floor-of-1 commit (Save still enforces
64 with its sentence, documented), the waveform gate thrown
from loadSource so every route shows one sentence, and the
unreadable-file double-emit discriminated with its own fixture.
Ledgered, not fixed: everything in letters (am)/(an)/(ao) and
the (h)/(l)/(ag)/(ai) extensions; the owner hand-check list
gains kit MAX_PATH on long names and whisper.cpp's win32 ANSI
argv for non-ASCII source names (beside reframe geometry and
the CJK overlay/watermark fonts); `validateExportJob` not
gating `outputFilename` stays a defense-in-depth note (the
renderer sanitizes it); FOR_MIKE:73 "Made by Makenah" is the
owner's own line in the gift doc — flagged as an owner call,
untouched. Owner-report material recorded here: the shipped
win32 pairing is ffmpeg 6.1.1 + ffprobe 4.0.2, and sweep 12's
ffmpeg reviewer ran the full Layer 5 suite under a win32 shim
with a Fonts folder at 220 passed / 0 failed / 5 skipped.

Round 72 — review-gate fixes, the eleventh pass's findings (held
uncommitted): T-122, all 14 items. The headline is the argv fix:
`-enc_time_base:v filter` beside `-fps_mode passthrough` in the
cut re-attach, because 6.1.1 (the shipped win32 major) gave a
constant-rate source an encoder time base of 1/fps and ROUNDED
every retimed stamp onto the frame grid — one `pts_time` written
twice at a non-frame-aligned seam, "non-strictly-monotonic PTS"
on stderr. The new Layer 5 block ("a cut that is not a whole
number of frames long...") compares EVERY output packet with
where its source frame belongs (duplicate check first, the
expectation read from the source's own packets, the tail allowed
0-2 frames to `-shortest`); it cannot red on 7.0.2 (exact there
either way), so the red is the 6.1.1 run (expediter re-ran it on
his own alias config: `pts_time written twice: 3.291667`, and
`packet 32 ... 16.7 ms from where its frame belongs`) and the
muxCodec unit pin (4 named reds anywhere) covers the
bundled-only box. Claim sites corrected with it: chain.ts now
says "in step to within one audio frame (about 21 ms)",
process.ts's "equal by construction" likewise, the 25-fps-CFR
warning claim is scoped to 7.0.x (on 6.1.1 a 60 fps source stays
60/1 — measured), and the false "7.0.2 does not write
DefaultDuration" is corrected in media.spec and TESTING (both
majors write it; the Void patch is needed on both). The other
behavior fixes, each red-first with byte-identical restores:
`{handle}` is Unicode — shipped as the anchored mark-bound form
`(?:[\p{L}\p{N}_]\p{M}*)+` joined with '' rather than the
ticket's literal class (worker deviation accepted on
measurement: the literal class leaves an emoji's U+FE0F behind
as an invisible name, the exact residue T-121 (7) closed), with
7 `{handle}` cases ("@토끼" red was 'export.mp4' vs '토끼.mp4');
the Clip Kit computes `safeName` BEFORE `makeKitDir` and passes
it as the clipName, so a cleared rename field no longer dies in
main's `assertNonEmptyString` after the folder pick (E2E red:
"Clip Kit failed." → folder `clip-kit-<date>`; main's
trust-boundary gates untouched); the Second-track footer renders
only when Duck is on (E2E asserts the full
on/off/on/role-switch round trip); `noDeviceHint` names all
three recoveries including "close any other app using it" (the
OBS-holds-the-camera case; USER_GUIDE sentence updated); and the
emoji guard scans `src/preload` (177 files now, up from 175),
with emojiGuard.test.ts pinning that every directory of `src/`
is a ROOT and a live discrimination transcript (emoji in
preload → exit 1 → restored). Docs: the four exe-size figures
went number-free until the release run measures; BRANDING names
fixed at five README/FOR_MIKE sites ("Posting log", "Title
starters", "Smart highlight finder", "Start recording" ×2); the
stale-cite batch re-pointed against the final tree (plus two
more the worker found, ledgered as its deviation 2); the
duration figures consolidated into a single TESTING timing
table the config and workflow comments point at; the "Layer
2.5" heading is now "Layer 5" (heading only — the section stays
where the suite runs, between unit and E2E, so document order
reads 1, 2, 5, 3, 4 deliberately); STYLE_GUIDE's hook claim
(PostToolUse), Home/End attribution (the slider's own keys) and
`~/.claude` parenthetical fixed/deleted; IC:219's retired
"Discard" is "Clear". LESSONS has the dated T-122 entry; IC has
the round-72 section with the kit/footer/hint rows and the
ledgered not-fixed items. Expediter gates on the final tree:
verify ×3 at 138 files / 3,773 tests, media 214|11 of 225 on
7.0.2, the 6.1.1 T-82 + MediaRecorder families 21 + 14 and the
new block 3/3 on the distro binary, clean build, FULL Playwright
249/249. Expediter mutations: the option removal (2 named 6.1.1
reds + 4 unit reds, restored to fa2a1bfa) and an independent
sign-flip at the unnamed `vselectForCuts` seam `PTS-(`→`PTS+(`,
which reds BOTH new cases on the bundled 7.0.2 (222 packets for
394 surviving frames) — the block discriminates on the major
where the option removal is green — restored to 429bd0ae. The
worker's ledger (scratchpad/r72) reads restored=IDENTICAL on
every row; docs/TICKETS.md and package.json byte-identical
throughout. Ledgered, not fixed: reframe Left/Right geometry
and the overlay/watermark fonts' CJK coverage join the owner
report's hand-check list; HOW_IMAGII_WAS_MADE's historical
names and the period IC/LESSONS accounts stay as history.

Round 71 — review-gate fixes, the tenth pass's findings (held
uncommitted): T-121, all 22 items. The fps class is CLOSED, not
patched per argv: burn-in and PiP gain `-fps_mode vfr`, and the
cut re-attach's count-based `setpts=N/FRAME_RATE/TB` is replaced
by a timestamp retime (per-cut `max(0\,min(T\,end)-start)`
subtracted from PTS) — shipped because the entire existing
59-case cut/re-attach/burn-in/PiP/odd-size/MediaRecorder family
stayed green on BOTH binaries, with one disclosed and accepted
seam shift: the first survivor after a cut lands one frame
period later (41.7 ms on the 24 fps ramp), which puts later
frames ON their sound where the old numbering ran them 41.7 ms
ahead. Beyond the ticket, accepted: overlapping cuts are merged
first (`disjointCuts` — a widened cut double-counted its overlap
in the shift; its own Layer 5 case), a cut wholly before the
file shifts by `0` (never an empty group), and the worker's own
first PiP case tripped the ledgered T-110(ac) silent-base
behavior and was rebuilt — (ac) re-confirmed in passing. New
Layer 5: burn-in, PiP and mux-with-one-cut on the MediaRecorder
fixtures, VP9 and VP8 each (the mux red was the measured 0.058 s
collapse), plus the overlap case; the 6.1.1 transcript (the
worker's, re-run by the expediter: 7/7 on the distro binary)
shows each fix's removal failing exactly its own two cases.
Packaging: three ffprobe-static excludes and the four unused
dependencies removed (`--ignore-scripts`; the lockfile's −23
packages and a version-header sync, no bump; @types/fluent-ffmpeg
kept — a devDependency, ledgered) — the dir-build probe reads
win-unpacked 706→409 MiB, app.asar 36→15 MiB, ffprobe-static
336→61 MiB (win32/x64 alone); releaseWorkflowShape pins the
excludes and the removals; the win32 release run re-checks
ffprobePath and the real ffmpeg.exe. The webcam fallback: the
cam catch now starts with the same leftWhileStarting teardown
its sibling awaits have (no toast for a screen nobody is on),
stops and nulls the camera stream (it stayed live — light on —
through a screen-only take), and the thumbnail renders on a new
`camInTake` state set beside the compositor ref (an empty
accent-bordered box drew over the preview); two new E2Es and six
wiring pins, each red-first against the sha-verified pre-round
bytes. Timeline ←/→/,/. base on `playheadNow` like I/O (the
pre-fix E2E measured ArrowRight moving the playhead BACKWARD
0.72 s during playback). `validateClipRequiredFields` requires
`textOverlays` as an array (QA's restore-crash shape is the red)
and the T-119 docblock stops listing it among "read with a
default". `audioCloseMessage` uses `!= null` and
`?? DEFAULT_CHAIN_SPEC[key]`, so an absent-shaped chain asks
nothing (11 absent-shape tests; the false "second track will be
discarded" and "your cleanup settings" reds). `sanitizeFilename`
and the chat username class are Unicode — with the worker's
measured improvement over the ticket: `\p{L}\p{N}` ALONE mangles
Thai, Hindi and decomposed accents (vowel signs and accents are
marks), so the shipped classes carry `\p{M}` bound to a base
character, and an emoji's variation selector cannot become an
invisible name ("Épico clutch" and "클립 이름" survive end to
end through the real kit builders). The BAD_CUT refusal and
HotkeyOverlay both say "mark" (one name per concept; a BRANDING
name-table row pins the four sites). Docs: the FOR_MIKE tour
claim, README's "webcam preview", STYLE_GUIDE's `[items]` key
and reconciled Timeline bullets, PRODUCT_GUIDE's model-install
sentence, the generator-credit line DELETED from
HOW_IMAGII_WAS_MADE (it named a local `~/.claude` path against
BRANDING's no-generator-credits rule), the retag figures written
as measured WITH their fixtures named (3 on the suite's bt709
bands; 4 on a scratch bt2020nc fixture — round 69's "2 is 3"
lesson, regressed by T-120's rewording, now pinned to fixtures),
"(the default wrote 51)" scoped to flv and wmv, the false
"compiled without libfreetype" corrected to libharfbuzz at all
four sites (the expediter's own -buildconf confirmed libfreetype
IS enabled), release.yml's "~90 s" ceiling rationale updated
(comment only), "instant"→"quick" including BRANDING's own
exemplar (kept truthful) and IC's "near-instant", 8 Mbps as "up
to"/"the top preset", the three pre-wave IC cites re-pointed
(ExportDialog's pack branch measured to :199-240, differing from
the ticket's guess — verified against the tree), and
DESIGN_GUIDE's export-scale sentence states the real ≥2.5→3 /
≥1.75→2 / else 1 mapping. Round-71 coverage notes ledger:
old-build WebM takes still refuse (the remux fixes new saves),
the converted take's H.264 level 61 (win32 decoder hand-check),
HEVC/ProRes and the YouTube thumbnail cap join the owner
hand-check list, @types/fluent-ffmpeg, and the retime's one-frame
seam. Expediter gates on the final tree, all run personally:
verify ×3 (137 files, 3751 tests), test:media 211 passed | 11
skipped (222), build clean, FULL Playwright 248/248, the T-121
block 7/7 on the distro 6.1.1 under the expediter's own alias
config. The expediter's independent mutation hit the unnamed
comma-escaping seam inside the new setpts expression (the exact
class that killed burn-ins before T-119): six named unit reds,
restored byte-identical (c0ebd76d).

Round 70 — review-gate fixes, the ninth pass's findings (held
uncommitted): T-120, all 27 items. The HIGH: a recording saved as
WebM now opens in Video Studio — `promoteTempWebm`'s non-convert
branch remuxes the temp (`remuxWebm`, `-c copy`, through the same
cancel registry as the convert; a cancel is RETHROWN before the
fallback so a Discard stays a discard, and a remux failure falls
back to a plain copy rather than losing the take, logged and
ledgered), the E2E WebM path finally clicks "Edit in Video
Studio", and the Layer 5 MediaRecorder block (8 cases; VP8/VP9
piped fixtures with ms clocks and the DefaultDuration blanked)
pins the repaired header. Deviation accepted on measurement: a
`-c copy` remux cannot fix the container's 1000/1 nominal rate,
so `probedFps` gained a 240 fps plausibility ceiling (above it
reads as unknown; the Timeline and Player step at 30 — the 1/30
stepping on a recording is ledgered found-not-fixed). The MEDs:
`-fps_mode vfr` on the convert argv (a real MediaRecorder take
went 2980 frames → 90 and 2.16 s → 0.19 s; the flv/wmv/mpg
25-fps sources keep exactly 50 frames in 2 s); the live previews
are actually attached (an effect keyed on the recording phase;
`startRecording` no longer writes `srcObject` into elements that
do not exist; the E2E asserts `videoWidth > 0`); Space works
from the timeline track through the Player-registered
`PlayerTransport.togglePlay` (one toggle, two surfaces, no
double-handling; the HotkeyOverlay qualifiers are true);
`backgroundThrottling: false` so the webcam composite survives
minimizing (wiring pin + a live `getBackgroundThrottling()` E2E;
the minimized behavior itself is a win32 release-run hand-check,
this box has no window manager); `videoBitsPerSecond` 8 Mbps
with the disk cost in the Output hint (measured: the option
raises a synthetic capture's rate as expected); and the
matrix-stage story now tells the truth — a retag alone restores
bt2020nc's (and bt709's) PIXELS, the bt709 `scale`'s real job is
a following Auto Zoom (the new Layer 5 pair proves it: retag-only
+ zoompan reads (0,133,0) on 6.1.1, scale+retag (0,155,0); red
with the scale dropped, `2 failed` on 6.1.1, 7.0.2-green by
design), and the upgrade constant is `bt2020` (7.0.2 refuses
`bt2020nc`/`bt470bg` as out_color_matrix values). The LOWs: the
electron-store schema is nested so the 11 dotted keys are
actually validated (red-first with the expediter's replication
shapes; settingsKnownKeys flattens and compares; the
schema-vs-launch corner is a marked simplification); the
`electronVersion: 31.3.0` pin is deleted so the shipped runtime
is the tested one (releaseWorkflowShape pins its absence);
leaving Record during "Starting…" tears down and abandons
(`unmountedRef` checked after each await; the E2E asserts no
temp file and no recordings folder); held Enter cannot chain the
Fix wizard's steps and ThumbnailVariants' focus is keyed on the
previews' identity; the kit chooser seeds `defaultPath` from the
once-write-only `clipKit.lastOutputDir` (handler-validated, 11
new cases); "1 clip and its edits"; `validateChainSpec` checks
the parametric denoise numbers and each cut's times with
finished-sentence refusals (the docblock's "checks every value"
is now true; 37 new cases); and Timeline I/O reads the element's
exact time through the transport (an E2E that stops `timeupdate`
on purpose proves the store would have been stale). Docs: the
release workflow's "never on push" comment and README maintainer
note now name the deliberate v* tag trigger; README's "28 unit
tests", "projects live at %APPDATA%" and "360+" claims fixed
count-free; the STYLE_GUIDE stand-down heading is scoped to
letter-key handlers; the Timeline slider comment keeps only the
paint-order reason; the clipKit docstring quotes a producible
row; the Record guide says Esc needs imagii focused; the five
"first launch is slow" claims say EVERY launch unpacks (T-110
(ai)); "every built-in preset is at least 1280 px on its long
side"; the IC native-dialog inventory is re-pointed with the two
newest confirms added and the pre-wave drifted cells fixed; the
tick-idiom cites land; LESSONS attributes each matrix figure to
its fixture; TESTING's parenthetical reads "(seven new: …)".
Worker rigor notes, accepted: three first-run mutation survivors
were strengthened and re-run red (M13b, M03b, E09a — the ledger
shows GREEN rows followed by RED); the mutations that predated
its own late comment edits were re-run on the FINAL bytes (14
FINAL- rows, all red); it ran the FULL Playwright suite itself
(the round-69 lesson). Expediter gates on the final tree, all
run personally: verify ×3 (137 files, 3700 tests), test:media
204 passed | 11 skipped (215), build clean, FULL Playwright
245/245, and both 6.1.1 blocks under the expediter's own alias
config (the matrix block 14/14 with the Auto Zoom pair, the
MediaRecorder block 8/8). The expediter's independent mutation
hit an unnamed seam — the cancel rethrow dropped from
`saveWebm`'s catch — and went red in exactly one named test ("a
Discard during the remux is a discard: null, the half-written
webm and the temp are gone"), restored byte-identical
(694d7310). New residuals ledgered in the round-70 coverage
notes: the 1/30 frame-step on recordings; the remux-failure copy
fallback (that file still has no duration); no Discard offered
for a WebM save (`canDiscard: false`, simplification); the
nested schema's launch-stop corner; the minimized-window
hand-check.

Round 69 — review-gate fixes, the eighth pass's findings (held
uncommitted): T-119, all 26 items, across an interruption — the
first worker died at the Sonnet weekly limit after item 12 (the
tree was left green and consistent, verified by the expediter's
hash audit against the round-68 close), and a resume worker
reconciled the tree from its predecessor's own baseline snapshot,
completed items 13-26, and re-derived the ENTIRE evidence ledger
itself rather than trusting inherited work: 82 mutations run, 86
byte-identical restores proven by sha256, zero stale hash rows.
The four MEDs: `recording:abandon` no longer hangs after a stream
error — it waits only for a close that has not already happened,
bounded at 2 s, with the unlink in a `finally` (deviation
accepted on its evidence: skip on `closed` alone, not
`destroyed`, because a destroyed-but-still-closing stream holds
the fd and Windows refuses the unlink — a 150 ms delayed-close
case pins it and the `destroyed` mutation fails it); Start
recording claims a `startingRef` before its first await and shows
a disabled "Starting…" (the mic-refusal case now presses Start
twice — added when the ref-not-released mutation survived the
first version); "Edit in Video Studio" asks with the T-112 shape
("Replace the video you're editing? N clips...") before replacing
a tuned session, asking nothing when there is nothing to lose;
and bt601-TAGGED sources keep their tag through a temperature on
6.1.1 — smpte170m/bt470bg get `setparams=colorspace=<tag>` ONLY,
the retag being the whole fix since their round trip is
pixel-symmetric (the bt709-recipe-on-601 variant run settles it:
rescaling 601 breaks the pixels, green (11,184,3) vs (0,158,0)),
and the skip rationale everywhere now says SYMMETRY, not "players
assume bt601", which the ledger's own Auto Zoom line had
contradicted. Also landed: I/O and ,/. work from the timeline
track with the trim handles made pointer-only tabIndex -1 (a
keyboard-only double-I undo case was added when the endGesture
mutation survived the pointer-driven test); AudioImporter
single-flight on drop and pick; the models folder is created and
`shell.openPath` awaited with its error logged; the Fix wizard
and Thumbnail Variants keep keyboard focus across step swaps —
and the FULL suite caught what the fix's own tests could not, the
old modal-contract pin expecting Close focus (re-pinned; lesson
recorded: a fix's own tests are not the suite); the SELECT
shortcut guard; the rename ring plus a NEW a11ySweep outline-none
rule (the ticket assumed one existed; none did — discrimination
block, red on ClipList pre-fix); Tutorial scroll honors Reduce
motion and the index.css comment stops overclaiming;
`validateProject` refuses `clips:[{}]`, `chain:{}` and `doc:{}`
(+38 tests, red-first on those exact shapes); and a blank export
forgets the watermark — `setSetting` deletes the key on
`undefined` (electron-store refuses `set(key, undefined)`; a
main-process change the mechanism text had not named, accepted),
so the kit stamps nothing, pinned to the keys' absence from
config.json and five clean kit files. Docs: README and the
release body name both online exceptions and truthInCopy pins
them (the stale Tech-stack "Vitest ... (28 tests)" line, found at
the expediter's gate, went to a Haiku micro-fix: guard clean,
pins 23/23); the mux comment says which Duck branch bounds what,
citing (af); reframe is no longer called a whole-file re-encode;
the matrix figures are the suite's own (130, and "within 3
levels" for bt709's scale AND bt601's retag — the predecessor's
"within 1 level" was corrected on measurement); the Layer 5 title
quote greps; 'colour' → 'color'; Reels says January 2025; the
spawn-site header reads fourteen + three with the floor at 17 (a
hidden-site probe showed floor 16 tolerating a lost site); the
"any more" ledger row reworded; the eight-places count redone as
seven places on ten lines with the uncategorized 'cancelled'
literals and regex alternatives brought into the literals clause;
the softness bounds say "strictly between 80 and 175" with the
column-0 figure labeled post-encode; and the image.spec cites
re-pointed after the guard moved. Expediter gates on the final
tree, all run personally: verify ×3 (135 files, 3596 tests),
test:media 194 passed | 11 skipped (205 cases), build clean, FULL
Playwright 238/238 (the worker's own full run predated its last
re-pin; this one does not), and the 12-case matrix block 12/12 on
the distro 6.1.1 under the expediter's own alias config. The
expediter's independent mutation hit the disclosed weakest seam —
INPUT removed from the Timeline stand-down — and went red in
exactly the named wiring pin, restored byte-identical (3776507f).
New residuals ledgered in round 69's coverage notes: awaited
settings writes sit outside any try (T-110(x) family); the 2 s
abandon bound; the Timeline stand-down pinned by source text
alone; ffprobe-static 4.0.2 beside ffmpeg-static 7.0.2.

Round 68 — review-gate fixes, the seventh pass's findings (held
uncommitted): T-118, all seven items. The sweep's one MED is
fixed: 6.1.1's `colorbalance` RGB round-trip used the bt601
matrix and dropped the tag on bt709-tagged sources (OBS's
default) — the temperature stage now appends
`scale=out_color_matrix=bt709,setparams=colorspace=bt709` for a
probed-bt709 source (`ProbeResult.colorSpace` →
`SourceDimensions.colorSpace`, threaded at export.ts:64 and
concat.ts:170; untagged and bt601 skipped on purpose, their round
trip already symmetric). The worker's one deviation, accepted on
its evidence: the ticket's literal mechanism (`scale` alone)
restores the pixels on 6.1.1 but does NOT re-tag there (its
transcript (c): tag assertions red, pixel assertions green), so
`setparams` writes the tag back. 6.1.1 red-first transcript
(distro binary through a scratch alias config, outside the
repo): (a) stage as shipped — the T-118 Layer 5 block 5 passed;
(b) stage removed — 3 failed (export and compilation: "expected
undefined to be 'bt709'" and "green graded 0,130,0 vs control
0,157,0: expected 27 to be less than or equal to 4"; warm gray:
the tag line); (c) scale-only — 3 failed on the tag alone. The
block passes on the bundled 7.0.2 with or without the fix
(disclosed in the Layer 5 header and TESTING; the reds that fire
anywhere live in filters.test.ts plus the new gradeMatrix.test.ts,
8 cases driving the real runners' -vf). The expediter re-ran the
block on 6.1.1 under his own alias config (5/5) and had earlier
replicated the raw defect by hand (a no-op `colorbalance=rs=0.0001`
on a tagged source: tag → unknown, player-view green (0,157,0) →
(0,133,0); 7.0.2 preserves both). `escapeSubtitlesPath` escapes
`=` in both classes — the burn-in's path is the filter's
POSITIONAL first option, so `Boss=Dead-<ts>.srt` split at the `=`
and died "Option not found" exit 8; unit red "expected
'/a/a=b.srt' to be '/a/a\\\=b.srt'", Layer 5 red "ffmpeg exit 8",
green after on both majors (class 2 is not needed by ffmpeg —
the second round escapes the first's backslash — and is pinned by
the unit alone, M7b). Autosave Clear carries the FIRST failed
unlink's errno for a file that survived ("could not delete
autosave.json (EBUSY)", no trailing period so an unknown shape
still falls to the caller's sentence), so `userFacingError` names
the locked-file cause and the dropped "close anything using it"
remedy returns through it; a code on a vanished file is not
reported; 7 of the 8 new or changed autosave cases were red on
the old function; home-chrome's stubs are main's real shapes and
the bare case asserts no cause is guessed. Comments and docs now
say only what is true: RecordStudio's "says the take is gone"
scoped to the convert branch, citing (u); the softness prose
names the band in all seven places plus three more the worker's
grep found (48% in 80-175, the suite's `hardness` band; strictly
between 0 and 255 is 96.2% scaled / 92.0% after the encode;
corners hard, every edge soft at its middle — row 0: 70 of 320 in
the band, 48 pure at each end); the "any more" cite re-pointed to
:721 with STYLE_GUIDE.md:336 joining the disclosure; category (5)
recounted as eighteen comments and titles plus two named string
literals. Worker mutations M1-M9 and E1/E2, each restored
byte-identical with sha256 pairs in the handback; the expediter's
independent mutation at a seam the worker never named — the
matrix pair's ORDER swapped — went red in 4 named tests (the pins
hold the full ordered regex, not token presence) and restored to
e3dad290. Expediter gates, all re-run personally on the final
tree: verify ×3 exit 0 (133 files, 3522 tests), test:media exit 0
(187 passed | 11 skipped on the bundled 7.0.2), build clean, full
Playwright 230/230, and the T-118 block 5/5 on the distro 6.1.1.
New residuals ledgered in round 68's coverage notes: bt2020nc
sources take the same 6.1.1 round trip and are not rewritten; the
Layer 5 bt709 block is 7.0.2-green by design; gradeMatrix.test.ts
performs the real `<tmp>/imagii-concat` mkdir (two tests do now);
Auto Zoom downstream of a grade still drops tags via zoompan
(T-110(o) family; the worker measured the pixels right on both
majors, green (0,155,0)).

Round 67 — review-gate fixes, the sixth pass's findings (held
uncommitted): T-117, all nine items plus the class-closing delta.
The preset id is confined (shared `isSafeId`/`assertSafeId` in
pathSafety; guarded at the parse, the store and the handler — a
traversal id REACHED unlink, proven by a red that deleted the
temp userData target; the round-16 LESSONS rationale corrected).
The captions-folder gate tests a REAL parent segment
(`isOutsideFolder` in main/pathConfine.ts, win32-testable from
Linux, adopted at saveSrt, writeKitSrt and moodboard with a scan
against hand-rolled `startsWith('..')` — a video named
`..intro.mp4` had its own transcript refused and round 66's
sentence looped the person; in-folder `..`-named fixtures now
save and kit). The kit folder and the recording's suggested name
stamp the PERSON'S date (localDate/localTime/localStamp in
filename.ts; a new skewedClock E2E helper proves both directions
— the red kit E2E polled out 540 s for a folder the app had made
under tomorrow's UTC date). Record's finalize failures reach the
person as sentences (reportFailure; EPERM/ENOSPC map to tier-1
lines, the empty take says "Nothing was recorded." — the raw
`EPERM … copyfile 'C:\Users\…'` line was on screen, red-first),
and the DELTA closed the whole class: the source-list toast and
the Autosave Clear banner were the last two renderer
`ipcErrorMessage` call sites, both now reportFailure, and
failurePathLanguage PINS the class (any renderer call to
ipcErrorMessage is red). "anymore" in SRT_GONE with its pins and
quotes moved. Docs: the pre-rename E2E title quote, the
tick-idiom list made exact (30 sites, each verified, wave-added
relabeled), eighteen recounted to nineteen with the borderline
comment decided into category (1), the four whole-frame softness
claims scoped to the measured truth (the worker re-measured:
about half the pixels land in the suite's mid-gray "soft" band
(80–175) and almost none stay pure 0/255 (sweep 7 corrected this
clause, which had read the band's complement as purity), corner
tiles at full contrast,
a mid-frame flat 130 — plus three more claims the same grep
found, fixed), filters.ts's list names reframe, and USER_GUIDE
says the kit folder's date is the computer's clock. Accepted
deviations: the shared-helper homes (pathSafety for ids,
main/pathConfine for folder confinement — the renderer cannot
take node:path), the double gate at handler and store, the
skewedClock TZ mechanism, the tick list growing to 30. Worker
process slip disclosed and reversed (a momentary stash, popped;
the tree proven intact by the green runs that followed).
Expedite: verify 3489/3489 x3 consecutive (132 files), test:media
181|11, build clean, full Playwright 230/230 — all re-run by the
expediter on the final tree; the worker's ~30 named mutations
across both hand-backs reviewed (hash-verified restores); one
independent expediter mutation at the untouched stamp-separator
seam (localStamp's dash made a colon -> exactly 7 named reds
incl. the "safe in a Windows file name" pin -> byte-identical
restore c1839e2e -> 18/18 and the full stack green). T-110 gained
(ab) burn-in audio passthrough, (ac) PiP silent-base length,
(ad) alphabet-copy consolidation.

Round 66 — review-gate fixes, the fifth pass's findings (held
uncommitted): T-116, all six items — the wave's smallest round,
every finding LOW. The overlays reveal on KEYBOARD focus only
(`has-[:focus-visible]` replaces `focus-within` at both sites — a
mouse click left the tile's scrim stuck until focus moved; the
sweep's rule 4 now REJECTS the focus-within spelling outright,
the worker's correct tightening of my "accept the new spelling"
direction; the E2E tabs instead of calling focus() and adds
click-then-pointer-away at both tiles, the navigating button via
press-and-drag-off). Save .srt speaks in sentences thrown by
main: a transcript missing from this computer is refused BEFORE
the save dialog opens (the existsSync writeKitSrt already did),
and the outside-the-folder case says to transcribe again — both
pass userFacingError as written (captionsSaveSrt.test.ts, 8
cases). "untick" became "uncheck" in the convert-failure message
and the copyConventions scan learned the un- prefix AND grew a
main/shared/preload string scope (77 files; red-first named
exactly recording.ts:119); the seven "Cancelling"/"unrecognised"
sites turned out to be comments, fixed as such. The comment/count
batch: the three stale "scale" comments, the phantom "/pad", the
now-untrue "still refuses" sentences (code and test), the five UK
strings in UNTRACKED files the diff-based sweep could not see,
the disclosure line's enumeration true again with its grep scoped
past the lockfile (the 87 recounted and standing) and a fifth
category added honestly, the saveSrt-delta count drift (3344->
counts now read 3356), TESTING's media total, the checkerboard
claims scoped per-row (the worker re-measured: rows 7/100/233 had
70/320/67 soft pixels under scale, 0 under crop), a11ySweep's
header says four rules, and the docs quote the real "→ Canvas"
label. Residuals ledgered, dispositioned: the scrim staying lit
after the FIRST-save dialog only (focus-restore makes
:focus-visible match — measured; the fix touches every dialog's
focus-restore, out of proportion); saveSrt still throws where
writeKitSrt answers ok:false (the split is documented design);
tick-idioms and UK words in older comments/titles (listed
file:line in the disclosure). Expedite: verify 3356/3356 x3
consecutive (129 files), test:media 181|11, build clean, full
Playwright 227/227 — all re-run by the expediter on the final
tree; the worker's ~18 named mutations reviewed (hash-verified
restores); one independent expediter mutation at the untouched
sentence-finishedness seam (the outside-folder sentence's period
dropped -> exactly 3 named reds incl. "userFacingError lets it
stand" -> byte-identical restore 436c4599 -> 8/8 and the full
stack green).

Round 65 — review-gate fixes, the fourth pass's findings (held
uncommitted): T-115, all 15 items plus the saveSrt delta. The two
MEDs: the recording convert's percent is MEASURED (the take's
duration rides down from promoteTempWebm; the shared
burnInPercent maps out_time over it, capped 99; no duration means
no percent and an indeterminate bar — a 5-minute take sat at 99%
for most of its convert beside an enabled Discard, under a
comment that said 1%/s while the code did 2); and the Save /
"→ Canvas" hover overlays are focus-within visible, so a
keyboard user no longer presses Enter blind (a11ySweep gained
rule 4 for the hover-reveal class). The rest: ERROR_TOAST_MS on
the take-is-gone and clear-failed toasts (the one message that
must not be missed lasted 4 s); the image Export format select
has its name; the hook recompute moved to a trailing 250 ms
debounce on the EXACT start and window (hookAsk, a pure gate;
hookWindowKey deleted; first ask immediate so mount timing holds;
the badge after a drag settles is exact, never a second stale —
the worker's first cut debounced the mount too and the full
suite caught what that moved, three non-hook tests now wait for
the badge to settle); EVEN_PICTURE is crop (pixel-exact; the
scale stage resampled the odd window captures it exists for —
Layer 5 pins a 1-px checkerboard staying hard-edged; red-first
showed 70 soft pixels in its sampled row 7 under scale); the
legacy migration
clamps sizePx (renamed migrateLegacyOverlays — a verbatim
"sizePx": 800 autosave restores at 512; the old editor had no
upper clamp); the overlay x/y inputs say what they are; the
square clip card says "do not export"; Save .srt reports its own
failure instead of silently doing nothing (reportFailure with
"Couldn't save the captions file."; failurePathLanguage pins the
site by name and states its scanner's limitation — ~47 awaited
api calls without try are T-110(x)). Docs: the wave's last UK
spellings (wider than listed — the worker swept the unquoted
t109 messages and titles too), the disclosure line now carries
the MEASURED pre-wave count (87 lines: 53 tests, 26 docs, 8
comments — correcting both earlier guesses), the two crossfade
ledger rows, STYLE_GUIDE's confined-read ok:false exception,
DESIGN_GUIDE's toggle sentence narrowed with both patterns
blessed, the overlayColors comment and the Mid_captions.srt
ledger row. Expedite: verify 3344/3344 x3 consecutive (128
files), test:media 181|11, build clean, full Playwright 226/226
— all re-run by the expediter on the final tree; the worker's ~40
named mutations across both hand-backs reviewed (hash-verified
restores); one independent expediter mutation at the untouched
shared 99-cap seam (cap dropped -> exactly 2 named reds, one per
consumer: the burn-in pin and the convert pin -> byte-identical
restore 1af284ee -> 73/73 and the full stack green). T-110 gained
letters x-aa (the await audit, the -progress line buffer, the
out-of-range loudnorm measurement, the unique-scratch-name
upgrade).

Round 64 — review-gate fixes, the third pass's findings (held
uncommitted): T-114, all 23 items. The odd-dimension class closed
on EVERY libx264 surface: `EVEN_PICTURE` exported from filters.ts
and prepended to convertToMp4 (whose failure was DELETING THE
TAKE via promoteTempWebm's finally — the take now converts), the
burn-in chain (ahead of subtitles=, both branches) and the PiP
base — nine Layer 5 cases, red-first all exit 187. A legacy
autosave holding the pre-fix 'white' default restores again: a
migration step in validateProject maps CSS names through the
table (moved with its resolver to the leaf shared/overlayColors.ts
— textOverlay imports projectValidation, so the leaf breaks the
cycle), verbatim pre-fix JSON red-first, the injection strings
still refused. The last two soft trust-boundary asserts are
assertAlways (the re-attach unlink collision guard — execution
had PROVEN it deletes the source under NODE_ENV=production — and
hexToAssColor), captions:burnIn validates its style colors at the
gate, and the source scan now covers ALL of non-test src/main
with an allow-list of audited pure invariants. A silent input
survives Match loudness: parseLoudnormJson treats a non-finite
measurement as none and the render falls back to single-pass
(Layer 5 anullsrc, red-first exit 222). The kit SRT is
`_captions.srt`, so a clip named like a Windows device no longer
writes eight files and then reports failure. The Font dropdown is
honest at last: a whitelist table maps the six options to fixed
font paths — the stored string is NEVER interpolated, unknown
falls back to Arial — with per-font command pins and a win32
Layer 5 pair (run here against a six-face stand-in; real Windows
is the release run's check). Renderer: the hook row gates on
no-sound (the T-113 consolidation miss, owned); the start-handle
drag asks once per whole second and keeps the previous score up;
Autosave Restore's skip toast stops naming a project file that
does not exist (describeApplyOutcome takes a required via);
the selected-state class ACTUALLY closed — aria-pressed on the
RecordStudio source cards, LayerPanel rows and MoodBoard rows
keyboard-selectable with aria-current (the eye toggle says its
state), and the a11ySweep regex widened to border/ring/wash
styles, red on the unfixed sites first; the SafeZone modal's
initial focus is Cancel again (round-63 regression); the
transcript scroller has a role; the export queue bar is a named
progressbar; the overlay editor's x/y have names and the color
box points at its alert; #rgb expands; the GIF live region's
phantom 12 px gap is gone (the region stays in the tree); the
loudness hint left the checkbox's name and reads in BRANDING
style; the square clip card stopped implying its well exports.
Docs: the remaining wave UK spellings (disclosure line updated —
round 65 measured the real pre-wave count: 87 "centre/colour"
lines — 53 in older tests, 26 in older docs, 8 in source/config
comments),
the superseded round-62 ledger row amended, STYLE_GUIDE's
throw-vs-ok:false bullets reconciled by naming the five real
ok:false channels, the templateTruth count comment, the crossfade
stragglers. Worker's own full-suite run caught its own LayerPanel
regression (row lost its click target) — fixed before handback;
two of its test pins were sharpened when their first mutations
slipped through. Found-not-fixed, ledgered: ANY failed convert
still deletes the take (product call, T-110), a Windows install
missing one of the six fonts needs a preflight, caption
size/position gate hardening. Expedite: verify 3301/3301 x3
consecutive (128 files), test:media 174|11, build clean, full
Playwright 224/224 — all re-run by the expediter on the final
tree; the worker's ~30 named mutations reviewed (hash-verified
restores); one independent expediter mutation at the untouched
unknown-color pass-through seam (resolver made pass-through ->
exactly 5 named reds incl. both security pins -> byte-identical
restore 2be30558 -> 11/11 and the full stack green).

Round 63 — review-gate fixes, the second pass's findings (held
uncommitted): T-113, all 19 items plus the owner-approved delta.
The HIGH died at the boundary: named overlay colors normalize to
hex when the overlay is STORED (src/shared/textOverlay.ts — the
148 CSS names as a literal table; the editor's default is
#ffffff, Size clamps 8..512, an unknown name refuses in the
editor), the gates stay hex-only (the drawtext-injection pin
stands), and a new E2E exports the untouched default overlay
(red-first: on the old tree it failed with "a setting imagii
can't use"). The validators became unconditional: `assertAlways`
in shared/assert.ts (an import cycle kept it out of validators.ts
— accepted) with the split recorded as design (validators and
gates throw, `assert()` warns), then the delta converted all 36
plain `assert(` boundary refusals in src/main/ipc to it (audited
one by one, none left soft; a source scan pins the class, 41
offenders named red-first; packaged behavior unchanged —
NODE_ENV is unset there, so this closes only the fail-open
environment hole). The kit: its SRT is written SHIFTED to the
clip's range on the output clock, speed-divided (the renamed
`captions:writeKitSrt` — it is not a copy anymore — source
confined to the captions dir, dest through the traversal gate,
"no captions fall inside this clip" when empty; Layer 5 and two
E2Es, red-first "minute 0 line where minute 4 line expected");
the swapped YouTube-Short slot has its own 180 s question (the
Reels-to-1200 regression); a fruitless cancel says "Clip Kit
canceled." and no longer points at the folder it just removed.
The flake is dead and NAMED twice over: the shared real
os.tmpdir()/imagii-audio between the WAV-writing tests and
tempCleanup's recursive rm (each file now sandboxes tmpdir,
pinned by tempSandbox.test.ts) AND an order-dependent
spawned[0] assumption the soak exposed — 40 parallel runs clean
(was 2-in-12 red). The re-attach re-encode evens odd frames
(scale=trunc(iw/2)*2 — an odd VP9 webm died at exit 187 where
copy once worked; three Layer 5 cases). ProjectIO: both
staleness baselines at the top (audio tuned during the long
video wait is no longer wiped), the playhead only seeks a video
that actually loaded, the reopen convert toast has its own id,
the skip and stale-SRT toasts say the way back, and autosave is
held for exactly the apply (released in a finally, a held change
saves on release; a quit DURING the wait keeping only the prior
autosave is the named residue). Batch and kit send
clipRecipe-normalized clips (a stored speed 0 is 1x at every
consumer). The hook asks once per rounded second and clips under
0.5 s output show no row. Burn-in's opening event carries no
percent (the frozen determinate 0% is gone) and a zero-size
probe can never refuse a burn. Two refusal sentences finished.
The a11y class sweep landed (aria-pressed on six groups,
aria-expanded, aria-live on the kit button, three progressbars,
signal meters, the visible -70..-5 hint, two more focusable
scrollers, the DESIGN_GUIDE sentence) pinned by
a11ySweep.test.ts; windowsHide on the last three spawns pinned
by spawnWindowsHide.test.ts; concat refuses in the DAMAGED_CLIP
sentence; asset-catalog descriptions joined the sample-text
rule; the doc-truth set (FOR_MIKE, the captions pixel figure,
the UK-spelling sweep, the drop-shadow mislabel, the hint-dim
sentence). Accepted deviations: assertAlways's home, the
grammatical join reaching Audio Studio's own Close, the second
flake fix, autosave's exact-hold mechanism, writeKitSrt's reply
shape. Expedite: verify 3184/3184 x3 consecutive (125 files),
build clean, full Playwright 223/223, test:media re-run — all by
the expediter; the worker's ~45 named mutations across both
hand-backs reviewed (every restore hash-verified); one
independent expediter mutation at the untouched LevelsPanel
aria-pressed seam (dropped -> exactly 1 named a11ySweep red ->
byte-identical restore 7420e246 -> 22/22).

Round 62 — review-gate fixes, renderer (held uncommitted): T-112,
all 36 items. The streamer cluster: Clip Kit's Shorts swap decides
by the CROP (`cropFrameSize`); Reels' 180 s is a yellow note
("Instagram won't recommend…") with the hard limit at Reels' real
20 minutes; the Compile card says "1920x1080, 30 fps"; "Crossfade"
is now "Fade between clips" (it dips to black and the copy says
so); the TikTok sweet-spot note stops flagging 60 s+; the hook
badge covers 3 OUTPUT seconds (worker's correct inversion of the
ticket's "divide" — output time is source over speed, so the
source window is 3 x speed, cut at the clip's end). The honesty
cluster: a failed batch marks only the running row Failed with the
reason in text (queued rows read "Not run"; a cancel still marks
all unfinished "Canceled"); no-sound sources disable Clean audio /
captions / highlight scan with "This video has no sound."; Export
with no folder opens the picker; saved toasts name the numbered
file; the kit folder is removed on a fruitless cancel/failure (the
one approved main addition: `video:removeKitDir`, a non-recursive
`rmdir` behind the path gate — it can only ever remove an empty
folder) and the kit label counts; the captions header is
phase-true; disabled Export explains itself; Compile normalizes
speed through `clipRecipe` (a stored 0 compiles at 1x); crop Reset
keeps the section open both ways; Clean audio confirms through
`audioCloseMessage` (moved to audio-studio/audioClose.ts) before
discarding a tuned session; the Importer refuses a concurrent
conversion; a late transcription can no longer attach video A's
SRT to video B (`setSrtPathFor`, a store action so no caller can
forget it). Project open: a staleness guard skips applying over
whatever the person loaded during the long wait (a closed studio
is not "something else"); only ENOENT reads "moved or deleted",
every other failure reaches the person through `userFacingError`;
the re-extract wait says "Extracting audio…". Canvas: hint text
renders at 0.4 display opacity (display-only — exports
byte-identical) and seven template descriptions say which text
exports; the Twitch banner stopped pointing at a template that
does not exist. A11y/design: audio export rows are progressbars
with pass labels; the Compile verdict list is focusable (Chromium
126) and its name column flexes 2:3; the GIF warning announces in
an always-mounted role="status"; the three sub-AA washes fixed and
recomputed; setup links underlined at rest; aria-pressed /
aria-current + label-in-name on Reframe positions and the clip
list; SafeZoneOverlay svg aria-hidden; the dead 16:9 guide data
removed and DESIGN_GUIDE says three; the caption Size readout
measures the loaded video ("about N px tall on this video");
the fix wizard names the mains notch; the Cleanup hint says LIGHT;
the loudness box clamps -70..-5 on commit (draft-and-commit so
typing is never blocked). Expedite: verify 2993/2993 (118 files)
re-run by the expediter x4 (one transient failure in the run that
followed an E2E teardown, never reproduced — flagged to the
re-sweep), full Playwright 215/215 re-run by the expediter;
test:media untouched by design (no graph changes; worker confirmed
155|9); the worker's ~30 unit + 18 E2E named mutations reviewed
(every restore hash-verified); one independent expediter mutation
at the untouched aria-pressed seam (wiring dropped -> exactly 1
named red, the reframe positions E2E -> byte-identical restore
`d21da94d`). Accepted deviations: the hook-window inversion, fix
in `clipRecipe` not the panel, the audioClose extraction, the
store-action SRT guard, display-only dim, draft-and-commit
clamping, cancel-keeps-Canceled rows, 2:3 name split.

Round 61 — review-gate fixes, main + shared + media chain (held
uncommitted): T-111, the nine-reviewer sweep's main-process
cluster. The two ffmpeg majors died at the root: `escapeDrawtext`
now writes for all three of ffmpeg's parses — an overlay "Let's go"
KILLED the export, "Sale 50% off" silently drew nothing — with the
map derived against the real 6.1.1 under a pixel oracle
(`textfile=` + `expansion=none`, 16 texts pixel-identical) and two
rules the oracle itself exposed (edge whitespace escaped, edge
newlines dropped — 6.1 draws NOTHING for an empty first/last
line); odd custom presets `even()` at `resolveExportPreset`
(1081x607 failed every export with "width not divisible by 2").
`validateExportJob` takes `assertOptionalClipRecipe` — T-110(d)
decided: validate (a 1e-6 speed produced a 261-byte file reported
as success). `amix` gets `normalize=0` (the +6 dB step when a
shorter bed ends: measured 6.0 dB before, 0.0 after) with
`alimiter=limit=0.891:level=disabled` guarding the manual-gain
path. `secondaryTrackProblem` holds the second track's numbers to
the slider ranges at the IPC gate AND at project open (the
`ametadata` filter-injection string refused in a sentence). The
whisper scratch WAV is 16 kHz mono (6x smaller; older whisper.exe
builds reject anything else). Loudness target -70..-5 (loudnorm's
real floor). Extraction children join a registry the quit sweep
and `cancelAllAudioJobs` kill; the transcribe arrival-kill deletes
its map entry. Burn-in percent is measured (`out_time` over the
probed length, starts at 0, indeterminate when unknown) instead of
invented. `video:exportBatch` is single-flight in a sentence.
Reopen re-attach probes the picture and re-encodes what mp4 cannot
carry (wmv2 died with "Could not find tag for codec wmv2";
accepted deviation: re-encode inside the mux, not
convertForImport — one decode+encode, no scratch file, no second
cancel path). Vertical captions draw on the 16:9-equivalent basis
(`min(h, w·9/16)`): a 1080x1920 default burn was an 18%-of-frame
glyph box; now glyph-height-over-width matches landscape within
0.1% measured, landscape burns byte-identical, MarginV scaled to
hold the same height fraction (accepted additions: that scaling,
and PlayResX left at libass's default so the wrap width keeps its
landscape fraction). Expedite: verify 2856/2856 (117 files) and
test:media 155 passed | 9 skipped re-run by the expediter; the
worker's full Playwright 198/198 on a fresh build; the worker's
~40 named mutations reviewed; one independent expediter mutation
at the untouched main-side `even()` (width un-evened -> exactly 5
named sync reds across the five bases -> byte-identical restore
`39122330ed02` -> 19/19).

Round 60 — content fix wave batch 13, the wave's last fix round
(held uncommitted): T-102 + T-103 + T-107 + T-108 + T-109. T-102:
`whisper-cli.exe` resolves from `<userData>/bin` first (then
`resources/bin`), so captions setup survives replacing the portable
exe; the miss message and the setup card name the userData path and
Open folder opens it, created on demand (the clean-Windows
walkthrough is HAND-TEST step 15 in the coverage ledger). T-103,
refined ruling: text the user MUST replace is a hint; text that IS
the card's deliverable exports. Eight scene-card layers un-hinted
(BRB and STARTING SOON screens export their own words again), eleven
placeholders hinted, and the Countdown "0:00" flipped to a hint at
expedite — no stream starts at 0:00 — with both doc records
corrected; templateTruth.test.ts pins a per-card TEXT_LAYERS table
over all 21 cards, and a BRB pixel E2E proves deliverable text lands
in the exported file. T-107: project schema v5 — `convertedForImport`
marker, a converted import converts again on open (a toast says so
while it transcodes), and a v1-3 project whose scratch WAV a launch
pruned recovers through `fromVideoPath` — extracted again from the
video instead of reporting a file the person never chose. T-108:
honest percent-0 starts, the Done row reads 100%, scratch-WAV
naming, two dead preload exposures deleted (pinned by
deadExposures.test.ts), and transcription gained a working Cancel —
the run-scoped latch through whisperManager with an arrival-kill for
a Cancel that lands before the extraction child exists;
`cancelExportJob` deleted (cancelAllExportJobs is the one surface;
tests retargeted). T-109: loaded crops draw again, zoompan centered
x/y (the corner drift), Temperature moves midtones AND highlights
(colorbalance rm/bm + rh/bh — it read shadows-only before),
refusal-copy parity, the stale guide line. Expedite: verify
2644/2644 (114 files), build clean, test:media 138 passed | 7
platform-skips (mandatory — ffmpeg surfaces moved), full Playwright
198/198 incl. the BRB pixel and transcribe-cancel E2Es; the worker's
mutation evidence reviewed, one independent expediter mutation at
the untouched arrival-kill seam (block removed -> exactly 1 named
red, "a Cancel that lands before the extraction child exists kills
it the moment it does", byte-identical restore verified by hash ->
8/8). Deviation owned: my send-back listed the Countdown as
content — wrong both ways a user would read it — flipped at expedite.
Residuals filed as T-110.

Round 59 — content fix wave batch 12 (held uncommitted): T-105 +
T-106, plus a shipped-since-day-one desync fixed on the way. The
find: Auto Zoom's zoompan stamps frames at its own default 25 fps —
a 30 fps zoomed clip exported 20% LONG with its sound left at real
length, and overlays after the zoom rode the wrong clock; the
worker's own Layer 5 length assertion caught it, and the fix in the
one shared builder (fps pinned around zoompan) corrects platform
exports and Compile alike. T-105: compile segments run the clip's
FULL recipe through buildVideoFilter itself — speed (atempo on the
audio side, chained for extreme factors), grade, overlays on the
clip clock (drawbox stand-in generalized to runConcat + win32
drawtext twin + linux pin), zoom, shake, fades placed on OUTPUT
length; `clipSpeed` is the single speed read, enforced by a
syntax-tree scan with a discrimination block; the GIF warning
counts output seconds; the Compile card shows the grid's own
verdict per clip against the compile target. T-106: `nextFreePath`
(name (2).ext, gap-filling, bounded, documented
check-then-write simplification) guards EVERY user-folder writer —
export, GIF, compile join, reframe, PiP (which gained a latch run),
and the kit folder; three-runs-one-name Layer 5 proves no silent
replacement and that a canceled second export no longer deletes the
first; `video:exportBatch` validates crops with the plain-voice
refusal. Expedite: verify 2574/2574 (111 files), build clean,
test:media 134/134 (+7 gates), full Playwright 190/190 incl. round
58's 183; worker's nine mutations reviewed (per-runner collision
pins proven independent), one independent expediter mutation at the
untouched recipe boundary (speed check dropped -> 8 named reds
across both layers, byte-identical restore -> 82/82). Deviations
accepted: the Auto Zoom timing fix (reverting would have carried a
desync into Compile faithfully), reframe/PiP/kit-folder collision
coverage, batch validation held to crop+overlays (hand-edited
project compatibility), GIF keeps its own speed. Findings filed as
T-109 (invisible loaded crops, the zoom's corner drift, the
temperature slider, refusal-copy parity, one stale guide line).

Round 58 — content fix wave batch 11 (held uncommitted with all
later rounds per the owner's 2026-10-10 hold-and-final-push
directive): T-98 + T-99 + T-100 + T-101 + T-104. T-98: a run-scoped
cancel latch (the worker's correct veto of my per-family generation
counter — per-job cancel semantics need per-run identity) wired
through nine runners, checked before every spawn AND after every
pre-spawn await; frame extracts join the registry; my suggested E2E
turned out to pass on HEAD, so the worker built the honest one — a
held-spawn harness (mainSpawn.ts) lands the cancel inside the real
between-jobs gap and inside a probe. T-99: project schema v4 — an
extraction stores the SOURCE VIDEO path + marker and re-extracts on
open, so launch pruning can no longer break a saved project; old
shapes read as written. T-100: every runner's failure path discards
its own half-written output through a guard that refuses to delete
a file predating the spawn (ffmpeg truncates at OPEN, not spawn — an
unconditional unlink would eat a previous export of the same name;
FAT 2 s slack documented); Canceled rows go neutral; audio rows get
Failed/Canceled words and "Step n of m" pass labels; the captions
row resets after a failed or canceled burn; the SRT toast, waveform
readout, and reframe phases speak plainly. T-101: seven dead store
actions and the legacy recording:save surface deleted, pinned by
deadActions.test.ts. T-104: SIGNAL_PINK/SIGNAL_CYAN tokens (EMBER
reused for the third color), noRawHex.test.ts keeps hex out of the
renderer with two documented exceptions. Expedite: verify 2436/2436
(108 files), build clean, test:media 115/115 (+6 gates), full
Playwright 183/183; nine worker mutations reviewed (incl. a
112-red boolean-latch proof), one independent expediter mutation at
the untouched discard-guard seam (mtime guard dropped -> the
pre-spawn-file protection pin red, byte-identical restore -> 7/7).
Findings filed: T-107 (converted video imports have T-99's exact
bug) and T-108 (percent:0, the Done-100% row, the scratch-WAV
header name, two dead preload exposures, uncancelable
transcription).

Round 57 — content fix wave batch 10: T-96 + T-97, the last of the
review's wrong-file class. T-96: the crop stage extracted byte for
byte from buildVideoFilter into `cropToFrame(crop, source,
targetAspect)` — one implementation, three callers. Compile
segments carry the clip's crop, then a centered cut to the
compilation's 16:9, then the normalizing scale (the worker's
correct veto of my "keep the mixed-sizes mechanism" direction: that
mechanism WAS the stretch, and an uncropped non-16:9 source now
center-cuts instead of stretching — T-83's rule extended to its
last holdout, flagged and accepted). GIFs keep the shape the user
drew (null aspect skips the cut; height follows width). Both IPC
payloads carry the rect, validated by the repo's first rect
validator (with a 1% edge tolerance for Rnd's whole-pixel
rounding). Layer 5 proves exclusion: a red marker the crop excludes
yields zero red pixels in the compiled and GIF'd outputs
(red-first: 17956 and 1154 leaked pixels at HEAD). T-97: verdicts
take the CLIP — `evaluateSuccess` and `platformsOverLimit` share
`outputDurationSec` (speed-divided) and `cropFrameSize`, so the
grid and the kit cannot disagree; a small crop reads "The picture
is smaller than this output — it will be scaled up and look soft";
a 2x clip is judged at its real output length (red-first: TikTok
never reached "Great" at 2x on HEAD, and the kit raised its modal
for a file that fit). Expedite: verify 2177/2177 (102 files), build
clean, test:media 101/101 (+6 gates; mandatory), full Playwright
173/173; worker's six mutations reviewed (incl. the narrow redo of
an over-broad one — the discipline holding), one independent
expediter mutation at the untouched null-aspect seam (the skip
removed -> 5 named reds across gif/filters pins, concat rightly
green — per-caller semantics proven; byte-identical restore ->
45/45). Worker findings filed: T-105 (Compile ignores
speed/grade/overlays — the recipe class continues; GIF's 10 s
warning; the four speed copies; a Compile verdict row) and T-106
(fixed output names silently overwrite; exportBatch's unvalidated
cropRect boundary); the probe-phase cancel gap amended into T-98.

Round 56 — content fix wave batch 9: T-92, the terminology sweep,
plus a latent click-eater fixed at its root. BRANDING_GUIDE now has
the Copy conventions section (canonical name table, sentence case,
Delete/Remove/Clear/Discard verb rules — the worker's sharper
definitions accepted: Delete = a saved thing, always confirms;
Remove = an item in what you're editing — toast rules, voice,
dismiss labels) and the renderer was swept to match: Stream
Graphics everywhere at last (Home's last-undo line, README,
FOR_MIKE, the history doc), highlight naming unified ("Chat spike
finder"; "Found 1 highlight" plural-correct via countOf at ten
pinned sites), posting log unified, corners spelled out, verbs
paired between button and confirm (the posting-log delete gained
the confirm its verb requires), dismiss labels one "Close" per
dialog (two duplicate footers deleted), US spelling, units spaced,
"Crop guides", the compile card visible-but-disabled at one clip
with its reason, the board "+" labeled for AT. Behavior fixes
inside the sweep: digits-only bitrates auto-suffix to kilobits
(and a lowercase m becomes M — ffmpeg reads m as MILLIbits; bare
numbers over 100000 are refused with the working spelling);
highlight scores renormalize over the weights in play, so a
chatless scan can reach 100 instead of capping at 40; the export
grid's reason text moved to aria-describedby so a checkbox's
accessible name is "YouTube", not a paragraph (plus the
pointer-interception fix that made the tiles clickable for
Playwright and mice alike). The send-back: my gate run caught the
emote-pack E2E timing out under a success toast — the worker proved
the interception LATENT at HEAD (react-hot-toast cards take pointer
events; run order had hidden it) and fixed it at the root: every
toast card is pointer-events none, only the reveal buttons are
auto, with unit + click-through E2E pins and a mutation proving
both layers (accepted cost, documented: hover no longer pauses a
toast). Enforcement: copyConventions.test.ts scans rendered strings
(and all literals for the name rules — the original "Image Canvas"
hid in a Record value) with a discrimination block; 35 reds against
HEAD source. Expedite: verify 2113/2113 (99 files), build clean, no
main/preload changes so no test:media (claim verified by diff),
full Playwright 167/167; worker's five mutations reviewed, one
independent expediter mutation at the untouched suffix seam
(normalization dropped -> the named m-is-mega pin red,
byte-identical restore -> 18/18). Findings: T-104 filed (raw hex in
the highlight bars and safe-zone overlays — a token-rule breach the
sweep could not touch), three microcopy stragglers folded into
T-100, main's lenient isValidBitrate boundary kept deliberately
(old preset files still load; the form is the strict layer) and
documented.

Round 55 — content fix wave batch 8 (recovered through two container
restarts with the tree intact): T-90 + T-91, plus a blocker found
and fixed on the way. The found bug: EVERY audio export taken from a
video threw before its Save dialog opened — the default "Re-attach
to video" asks the name/pick IPC for format mp4, which both handlers
rejected, and Layer 5 had always driven below the IPC so nothing
caught it (AUDIO_SAVE_FORMATS now shared, E2E through the real
panel, LESSONS'd). T-90: the FixWizard builds ONE patch and renders
its summary from it (it can no longer report "off" while applying
"on"); Start over restarts; presets save cleanup settings ONLY —
stripped at save AND ignored at apply for old files on disk, so a
pre-existing preset cannot re-impose cut times; the two −14 loudness
entries merged (killing the snap-back); hum removal gained the 50 Hz
mains option (red-first Layer 5: tones at five frequencies through
both settings); AAC writes a real .m4a (Layer 5: container
verified); the waveform cut copy says WHEN cuts apply; the
engineer's vocabulary left the rendered copy under an AST scan with
a discrimination block. T-91: image saves moved from the blind
a[download] to main-owned IPC saves — the toast follows the WRITE, a
canceled dialog toasts nothing, the emote pack is one folder picker;
the new trust boundary validates magic bytes, caps allocation
before decoding, and reduces names to traversal-proof leaves;
template hint layers (facecam guide, "@yourhandle", safe-area
frames) carry a visible "won't export" tag and are stripped by
captureDocument's chrome mechanism — retyping a hint text layer
clears the flag so a user's real handle can never silently vanish
(worker's correct extension, mutation-proved); mood-board reference
layers get the same flag at creation; every size/destination claim
across all 21 template/asset cards is table-checked
(templateTruth.test.ts), with the social clip card's well corrected
to a true 9:16 and the "Twitch banner" renamed to the profile
banner it actually is; the export dialog shows the real output
pixels and warns past YouTube's thumbnail size. Expedite: verify
1955/1955 (95 files), build clean, test:media 95/95 (+6 gates;
mandatory — hum argv + .m4a container), full Playwright 164/164;
worker's three mutations reviewed, one independent expediter
mutation at the untouched sanitizer seam (separators survive into
the file name -> the named traversal pin red, byte-identical
restore -> 13/13). Findings routed: T-103 filed (owner ruling on
design-sample copy in exports; keep-a-hint control; the documented
no-migration disposition for pre-round-55 reference layers), the
two-bars audio export note folded into T-100. hum60's stored name
kept for project/preset compatibility, documented.

Round 54 — content fix wave batch 7: T-88 + T-89. T-88: device
scanning extracted pure (`devices.ts`) — the mic and camera probes
are SEPARATE, each in its own try/catch, so a missing camera can no
longer blank the mic list; "Refresh sources" re-scans devices too
(with a scan-sequence guard so racing clicks cannot interleave
state); stale device picks are dropped on every scan; the hints
name the real recoveries (plug it in / Windows privacy settings /
Refresh); the native save dialog says "Save recording (Cancel
discards it)"; the post-Stop card tells the truth per state
("converting…" only when converting, Discard disabled when nothing
cancellable remains) via pure `saveCard.ts`. T-89: the resolver
accepts whisper-cli.exe (current builds) first and whisper.exe
second; the setup card divides the manual and automatic steps in
one honest line and says the model download goes online once;
"Captions are English only." stated plainly; "Font px" is now
"Size" with the true rendered height beside it ("about 120 px tall
on 1080p" for the default 32 — PlayResY 288, stored semantics
untouched); the made-up progress percents are GONE — phases without
a measurement render an indeterminate bar (reduced-motion safe),
per the new STYLE_GUIDE rule "a progress number is a measurement or
absent"; a ranged burn with no cues toasts "No captions in this
range — exported without captions" (runBurnIn reports `captioned`);
the References online line re-ruled and fixed in panel AND tour.
Expedite: verify 1735/1735 (84 files), build clean, test:media
93/93 (+6 gates; no argv changed — the caption block re-asserted
with `captioned`), full Playwright 155/155; worker's six mutations
reviewed, one independent expediter mutation at the untouched
reconcile seam (stale picks survive -> 2 named reds, byte-identical
restore -> 18/18). Deviations accepted: the discard path was
already sentinel-safe via T-44 (belt-and-braces branch kept), the
other two invented percents removed as the same family. Findings:
T-102 filed (the portable exe's captions setup path may not exist
or survive — NEEDS the Windows hand-test; flagged for the owner
checklist), the frozen progress row after a cancelled burn folded
into T-100, the dead legacy `recording.save` export folded into
T-101. Residual noted: a user with only the deprecated whisper.exe
stub reads as ready and fails at transcribe with a plain error.

Round 53 — content fix wave batch 6, the first HAIKU round: T-87 +
T-93. T-87: the title generator is table-driven — every verb form
(base/past/gerund) comes from a conjugation table, patterns name
the form they need, articles come from article(), the random game
bank is gone (the game is the user's to name), and the button says
"Title starters". The old generator's quoted output ("I clutchedd a
boss fight", "Day 41 of reacted toing glitch") is pinned
unreproducible by a full 8x6x4 cross-product test (no dd/toing/
"a a"/placeholders/exclamations); the worker also caught that the
old code's single .replace only ever filled a pattern's FIRST slot
occurrence — replaceAll now. T-93: USER_GUIDE gains "First launch"
(SmartScreen path, the 10-15 s silent unpack, ~170 MB, data in
%APPDATA%\imagii), "Your first clip" (a walkthrough verified
against the post-wave app), "What imagii does not do" (no game
audio, center-crop reframe, English-only captions, projects store
paths), coverage for chat spikes / posting helpers / Compile / the
two different "?" controls, and every stale line re-checked against
current source; the release.yml body follows the review's text with
the captions line softened to "one-time setup" (expediter edit —
the setup is a manual exe fetch plus a download, not one download);
releaseWorkflowShape.test.ts pins the dispatch/tag-only triggers so
the standing CI-cost rule cannot be silently widened (fixture-
proven to reject a widened trigger). Expedite (closer line review
for the first Haiku round — the diffs held up): verify 1665/1665
(80 files), build clean, full Playwright 149/149, no ffmpeg surface
so no test:media; worker's two mutations reviewed (its glued-suffix
pattern test is sharper than the suggested mutation), one
independent expediter mutation (article() always 'a' -> 4 named
reds, byte-identical restore -> 20/20). Haiku deviations accepted:
'achievement' removed from SUBJECTS (article() still built and
tested), my ungrammatical sample pattern corrected, bare {subject}
replaced by {a_subject} everywhere. Worker findings: the References
"one feature that goes online" line conflicts with the two-
exceptions ruling (re-ruled; fix rides round 54 with T-89), the
CaptionsPanel language line is T-89's as filed, T-101 filed
(addClipFromRange has no caller). T-93's guide-sync criterion is
deferred to the wave-close guide-sync pass by design.

Round 52 — content fix wave batch 5: T-85 + T-86. T-85, ruled item
by item (the table is in LESSONS): Clip Kit now STAMPS the saved
watermark (code-to-promise — buildWatermark in src/shared is the
one WatermarkSpec constructor; the kit's pure half extracted to
clipKit.ts so Layer 5 drives the exact jobs it queues; linux pin +
win32-gated pixel case in the T-51 pattern, the pixel case's first
real run is the next release dispatch, by design), asks its one
honest question (a long-clip confirm naming the platforms over
their typical limits) and no longer raises the safe-zone modal at
all — choosing all five platforms IS that answer; 'smart' is gone
from the reframe API end to end (panel: "Reframe to 9:16 (center
crop)", Left/Center/Right, says plainly it does not track faces);
SafeSearch copy tells the truth (DuckDuckGo filters; imagii does
not scan); Record copy names what is and is not captured (no game/
desktop sound); "Everything runs locally" carries its two honest
exceptions everywhere including BRANDING_GUIDE itself (the guide
was wrong; ruled and fixed); HotkeyOverlay's save line stops
claiming mood boards. T-86: tours are target-gated AND
content-gated (the worker's correct extension: the importer's own
target resolves on an empty studio, so `ready` carries "content
loaded"); an auto-tour never opens over an empty studio and the
first-visit flag survives until content exists; Skip/Escape/Done
all persist; all four tutorial files rewritten against live
control names with the false steps dead and one false step
deleted outright; tutorialCopy.test.ts structurally pins every
quoted control name against the route's source and bans the stale
words. Expedite: verify 1641/1641 (78 files), build clean,
test:media 93/93 (+6 gates), full Playwright 149/149; worker's
three mutations reviewed, one independent expediter mutation at
the untouched limit seam (platformsOverLimit never fires -> 5
named unit reds incl. the kit-grid shared-limits cross-pin,
byte-identical restore -> 15/15). Accepted deviations: the `ready`
flag, "one feature" over my "one part" (more honest — the model
download is online too), a false multi-track step deleted, kit
coachmark E2Es now start from `?`. Noted: a handle typed but never
exported is not stamped (tutorial says so honestly — acceptable
semantics); kit/grid duration checks ignore speedMultiplier
(amended into T-97); README "Image Canvas" + FOR_MIKE naming
belong to T-92 as filed.

Round 51 — content fix wave batch 3: T-84, the failure-path
overhaul (the review's largest cluster). Cancellation is now a fact
main records, not a string the renderer parses: `killAsCancelled`
flags the child before the SIGKILL, every runner's close handler
rejects through `cancelledOr`, one sentinel (`imagii:cancelled`,
with ConvertCancelledError now extending the shared CancelledError
— one mechanism, not two), and the old treat-any-SIGKILL-as-cancel
guess is gone, so an outside kill is a failure again. One renderer
helper (`userFacingError` + the `reportFailure` toast wrapper)
feeds all ~22 sites: envelope stripped, known shapes mapped to
plain causes, raw error always in the console, cancel = neutral
6 s toast, failure = 8 s error toast. Export queue rows carry
visible Failed/Canceled labels that outlive the toast. Project
load survives a moved file: each studio applies independently, one
message names what's missing, and Open/Restore toast a warning
instead of a false "Project loaded". Copy rewrites landed for the
autosave banner (validator reason to console; T-33 pins moved with
the words, the exists-only gate untouched), Home load, the search
notice (the fictional "switch provider" died), import diagnostics
(raw prefix gone, audio wording for audio files), and the
ErrorBoundary (details collapsed, no report-nowhere ask).
Structural enforcement: failurePathLanguage.test.ts scans the
renderer for raw `.message` reads and toast.error(message) calls
the way the no-prompt scanner does. Expedite: verify 1449/1449 (72
files), build clean, test:media 92/92 (+5 gates; run though not
required — the SIGKILL paths flow through it), full Playwright
144/144; the worker's seven mutation proofs reviewed (incl. a
three-mutation E2E build and a kind-vs-words discrimination on the
cancel toast), one independent expediter mutation at the import-
diagnostics seam (raw prefix re-prepended -> 14 named unit reds on
the "without printing the raw message" pins, byte-identical
restore -> 31/31). Worker deviations accepted: cancels log at
console.info, the audio dialog's cancel race fixed in-scope, no
global toaster duration change. Findings filed: T-98 (cancel is
not a latch between jobs; Clip Kit thumbnails unstoppable), T-99
(projects can reference a temp WAV the next launch prunes), T-100
(partial outputs + Canceled-row tint + audio-row labels).

Round 50 — content fix wave batch 2: T-83 + T-94. T-83: a manual
crop is now the new SOURCE FRAME — crop (user's) ->
autoCropForAspect against the CROPPED size -> scale, one
implementation with two callers, so nothing is ever stretched: each
platform takes a centered cut of the user's chosen content. Layer 5
proves it with a known white square measured from decoded pixels
across 4:3->Reels, 9:16->YouTube, 1:1->X, an odd-sized source, and
a matching-shape control (red-first: the old filter returned
180x426 for a 427 px square). The grid tells the truth to match:
the real crop aspect flows in (cropAspect was hard-coded null),
labels are reason-specific ("Wrong shape" / "Too long") with the
reasons visible on the card rather than hover-only, durations read
as words, caps read "typical limit", and a 9:16 crop can now turn
TikTok/Reels green (E2E-pinned). Shared geometry readers
(cropFrameSize / outputSourceRect in src/shared/safeZone.ts) give
the grid, pre-flight, and OutputPreview one answer; the safe-zone
modal got its plain-words rewrite ("Some platforms will crop the
picture"). T-94: a PRISTINE whole-video Clip 1 (table-driven
predicate) steps aside when a SCANNER adds its first clip — removed
in the same undo step as the add, neutral toast with the Ctrl+Z
path; manual adds never trigger it, a touched or renamed clip is
the user's and stays. Export/Compile buttons say what they produce
("Export {n} files", plural-correct via the new shared countOf).
Expedite: verify 1259/1259 (68 files), build clean, test:media
92/92 (+5 win32 gates), full Playwright 137/137; the worker's three
mutations reviewed (incl. red-first E2E driven against a clean
HEAD build), one independent expediter mutation at the untouched
shared-geometry seam (platform cut dropped from outputSourceRect ->
3 named unit reds, pre-flight E2E rightly unaffected — the
containment half is its reader; byte-identical restore -> 25/25).
Worker findings filed as T-96 (Compile/GIF ignore cropRect — the
wrong-file class again) and T-97 (the resolution check still reads
the full source size, so a small crop upscales under a "Great"
card); the Clip Kit ask-every-run modal folded into T-85's
criteria, the checkbox accessible-name bloat into T-92's. Worker
deviations accepted: hour wording for 2h+ caps, both toasts on a
scanner retire, OutputPreview re-pointed in-scope (its caption
promised the fixed behavior), the shared plural helper T-92 will
reuse.

Round 49 — content fix wave batch 1: T-81 + T-82 + T-95 (the two
wrong-file ffmpeg bugs, plus the layout bug the gate surfaced). First
round under the amended routing: a Sonnet worker implemented from the
expediter's pre-made mechanism decisions, with two scoped extensions
mid-round. T-81: ranged caption burns now shift the SRT onto the clip
clock (pure `shiftSrtToRange` in src/shared — drop outside, clamp
straddlers, whole-ms arithmetic; a latent variable-length-fraction
parse bug in tsToSeconds fixed in passing), temp copy unlinked in a
finally and its orphan family swept by tempCleanup under a strict
matcher so real transcripts are untouchable; the empty window burns
uncaptioned (ffmpeg cannot open a cue-less SRT — documented ruling);
`captions:burnIn` validates ranges at the IPC boundary. T-82: cuts
now remove the same spans from the PICTURE — a shared keepExpression
drives matching select/aselect so the streams cannot drift; with a
secondary track the cut applies once, post-mix, so music is cut with
the voice; re-encode only on the cut path (fps passthrough after the
worker caught ffmpeg's silent 25 fps CFR fallback), stream-copy
byte-identity proven on the no-cut path; `-shortest` kept as the
long-music-bed bound with its true rationale documented; the
intermediate WAV dies with the job in main (`runAudioReattach`),
asserted against clobbering its own inputs. Worker's honest note of
record: its first long-bed discriminator was ducked and already
short — it split the cases rather than ship a weak proof. T-95
(expediter): two long-green E2E went red in this fresh container
because the References create row overflowed its 220 px column —
flex min-width:auto makes placeholder-intrinsic width font-dependent
— leaving the "+" button under the detail card; min-w-0 on every
flex-1 form control kills the class. Expedite: verify 1178/1178,
build clean, test:media 87/87 (+5 win32 gates), full Playwright
131/131; the worker's thirteen mutations reviewed, one independent
mutation re-executed personally at the untouched seam (the burn
call-site wired back to the ORIGINAL SRT -> both ranged cases red,
no-cue case rightly green, byte-identical restore -> 5/5). Noted,
not ticketed (worker edge probes, no repro): unknown-frame-rate
sources vs setpts, nonzero video start_time offsets, CRF 23 on very
high-bitrate sources; "cuts + Re-attach take longer" UI hint folded
into T-90's copy scope; the empty-window "Captions burned in" toast
folded into T-89's.

Round 48 — guide-sync QA follow-ons: T-79 + T-80, the same-day
reversal of round 47's launch-LRU decision. The guide-sync reviewers
ran over rounds 46-47; design returned zero violations, QA returned
1 HIGH + 1 MED, both verified against source before ticketing.
T-79 (HIGH): chaining the 500 MB LRU behind sweepOrphanThumbs meant
that by the time it ran, every orphan was gone — past the budget it
could ONLY delete images boards still reference, silently and
unrecoverably, and the tile <img> had no fallback, so even the
now-working Clear button broke every tile. Fix: launch maintenance
is the sweep alone (it deletes by REFERENCE, the only safe kind);
the budget machinery is deleted outright (pruneThumbCache ->
clearThumbCache(), no parameter — "prune" was the word the budget
hid inside); the tile falls back one-way per item to item.thumbnail
on load error, so a clear costs a re-download, never a board. The
round-47 launch test flipped into the protection test (600 MB of
board-owned thumbs + launch = zero deletions, with an orphan as the
the-chain-ran signal). T-80 (MED): the T-40 panel-level onPointerUp
also caught the click that repositions a caret inside a focused
text field, splitting one caption edit into several undo steps —
pure predicate endsGestureOnPointerUp (release types range/checkbox/
radio/color/button-ish end gestures; text-like and unknown types do
not; unfocused targets always do) + one DOM-facing wrapper shared by
ClipList and TextOverlayEditor; ColorGradePanel verified range-only
and left alone. Expedite: verify 1133/1133, build clean, full
Playwright 131/131; worker's red-first evidence for all three new
tests + two mutations reviewed, and a third independent mutation
re-executed personally (clearThumbCache's unlink gutted -> ONLY the
clear-button test red, protection test green -> byte-identical
restore -> 11/11). The first mutation attempt hit the count guard
(the unlink line exists in the sweep too) and was retargeted on
unique context — the guard doing its job. Note for T-78: when audio/
image stores gain coalescing, their panels must use
endsGestureOnPointerUp from day one. USER_GUIDE/TESTING/ledger
corrected in-commit; the round-47 ledger rows amended in place with
the reversal named rather than rewritten.

Round 47 — backlog batch 20: T-29 + T-40 + T-74 (the final open
trio; the backlog is clear). Three controls measured against the
wrong number, each correct only on the one input where the numbers
coincide. T-74: overlay times are stored SOURCE-absolute (the
editor's Time fields' own promise) but -ss-before--i hands the graph
clip-relative frames, and setpts=PTS/speed divides the same clock
again — so `buildVideoFilter`, the one place that sees clip and
overlay together, converts: t_graph = (t_source - clip.startSec) /
speed. The speed divisor is one step past the ticket's wording and
load-bearing: the expediter's independent mutation removed ONLY that
division and the sped-up Layer 5 case went red at the pixel level
(overlay overstaying to t=3.6) while the plain clip-relative case
stayed green — exact discrimination. Layer 5 now cuts every T-51
clip at CLIP_START=2, with two all-platform cases running the real
runExportJob with drawtext swapped for drawbox (name substituted,
enable argument byte-identical — the stand-in rule now in
TESTING.md). T-29: "Clear thumbnail cache" called the 500 MB LRU
trim, which under the budget deletes nothing — a new
moodboard:clearThumbs channel calls pruneThumbCache(0) ("keep
nothing", so a zero-byte truncated write cannot survive on size
arithmetic), and the budgeted trim — which had NO automatic caller —
now runs once per launch, chained after sweepOrphanThumbs (round-38
note implemented; both unlink from one dir, so chained not
concurrent). Defect pin flipped to two positives, one driven by
launching alone. T-40: historyKey could tell "a different kind of
edit" but never "a second gesture of the same kind" — endGesture()
closes the window at gesture end (Timeline mouseup, crop drag/resize
stop, marker presses, and a bubbling onPointerUp+onBlur pair per
panel so future controls inherit it); two consecutive trim drags are
two undo steps, the video-core workaround retired. Expedite: verify
1126/1126, build clean, test:media 73/73 (+5 win32 gates), full
Playwright 129/129, worker's three mutation proofs reviewed + the
speed-divisor one re-executed personally (content-replace, restored
byte-identically). Worker finding filed as T-78 (audio/image sliders
have the mirror-image bug: no coalescing at all, one drag = dozens
of steps). Also noted, not ticketed: watermarks carry no enable
window — nothing in the app offers to time one, so there is no
promise to break; the T-74 comment sits above both drawtext users if
that changes.

Round 46 — backlog batch 19: T-73 + T-28 + T-64 (the modal cluster).
T-73's ticketed stack turned out not to exist — no Modal ever opens
over another — but the CLASS was real where the ticket didn't look:
`?` raised over a tutorial coachmark, where one Escape closed both
AND a z-order bug (Modal z-[800] under the coachmark's z-[1000])
left the overlay dimmed beneath the scrim it was raised over. Fix is
a shared numbered-claim stack in the new `hooks/useFocusTrap.ts`:
every open dialog takes an identity claim and consults
`isTopmost()` before acting on Escape or Tab, released by ID so
out-of-order closes stay correct; Modal moved to z-[1200]. T-64
rides the same extraction — the coachmark (aria-modal since it
shipped, trapping nothing) now calls the one trap Modal uses, and
the red-first E2E proved Tab used to walk out (landed on Home).
Rider fixed too: scrollIntoView once per step and a sameRect
epsilon gate (7 calls per 2 s -> 1, instrumented in the live page).
T-28: `window.prompt` — which Electron does not implement — replaced
by the in-app `<NameDialog>` for rename and first-save; both flows
driven to disk (rename preserves id/createdAt and is undoable;
first save creates the board, saves the item, and the cached
thumbnail's BYTES are asserted through a test-owned HTTP server +
net.fetch); an AST scanner in interactionWiring.test.ts bans
prompt/alert/confirm in src/ forever. Worker fixed an Enter
double-fire found mid-build (confirm closes the dialog, focus
restores to the opener, and the same keypress's default action
clicks it — reopening the dialog; `e.preventDefault()`, the T-34
mechanism). Expedite: verify 1112/1112, build clean, full Playwright
127/127, worker's mutations reviewed + one re-run personally
(Enter-guard -> named red -> byte-identical restore -> green 9/9).
a11y review: 0 HIGH; the MED (aria-modal not honest for AT virtual
cursor) filed as T-77, the latent zero-focusable Tab fallback
hardened in-batch (tabIndex before focus), the two LOWs are
inherited house patterns, noted and accepted. Worker findings filed
as T-75 (hotkeys fire under a coachmark — the T-72 exemption's side
effect) and T-76 (duplicate save toasts "Saved to X" without
saving). Expediter also retired Modal.tsx's fictional
"confirm-over-ExportDialog" comments — the stack cited three times
never existed; comments now name the real one.

Round 45 — T-51 (the release-paired Layer 5 capability ticket) +
the v1.5.0 version bump. Watermark and text-overlay PIXELS are now
proven where they can be: five win32-gated Layer 5 tests against a
flat mid-gray fixture at preset geometry (crop/scale no-ops, so
drawtext is the only thing that can move a pixel and untouched
regions re-encode bit-identically — exact assertions, not drift
bands); four watermark corners each leaving the other three flat;
two overlays in one export proving position, per-overlay colour by
dominant-channel counting, and the enable gate both ways; a font
preflight so a runner without Arial fails legibly. Two linux pins
mirror the mpegts pattern and name their own obsolescence condition;
discrimination proved the pin reads the real -filters table (486
parsed, scale/subtitles asserted present) and — the ticket's premise
confirmed — that NO other test anywhere catches a broken watermark
graph: drawtext->drawtxt left all 1082 unit tests green and only the
Layer 5 pin red. release.yml gains a test:media step (dispatch/tag
triggers untouched; timeout 30->45), so the win32 positives' first
real execution is the release run — structured for legible failure
by design. Expediter re-ran the pin inversion personally (named red,
restore, 71/5). The worker's deep-read found T-74 (text overlays
never render on clips not starting at 0 — enable windows are
source-absolute while -ss makes frames clip-relative; proven with
drawbox), deliberately NOT pinned yet so a wrong pin could not block
the release; filed with the full transcript and noted in the v1.5.0
release notes as a known issue.

Round 44 — fix wave batch 18: T-65 + T-71 + T-72 (the final product
trio). T-65: scaleFilter was the only crop-then-scale graph without
setsar=1 (runReframe and concat both had it) — one line on the shared
filter covers every platform preset, custom preset, and stacked
effect; Layer 5 red captured the exact 405:404, and the T-50 identity
suite gained ABSOLUTE 1:1/16:9 pins after the mutation proved
relative equality passes when both paths agree on the wrong value.
T-71: the semantic tier is a RENAME, not a redesign — danger/
danger-soft/danger-strong, warn, ok/ok-strong carry the exact palette
values already on screen (WCAG table in the worker report, all AA);
amber-400 IS ember to the byte so those surfaces moved onto the
existing token with a new no-second-token-owns-this-hex test. One
pre-existing AA failure found and fixed (MoodBoard remove chip hover
2.93:1 -> 7.20:1, the one deliberate visible delta beyond three
one-step tone changes — owner screenshot review flagged). withAlpha
riders converted incl. two same-disease literals two lines away;
templates/assetCatalog stay literal as a documented fourth
DESIGN_GUIDE exception (artwork specs are the user's pixels, not
chrome; the app's DEFAULT marks do follow tokens, the blank page's
white does not — one line to overrule). T-72: the overlay's pure
predicate now counts modal claims and subtracts its own
(openModals <= overlayOpen ? 1 : 0) — inert behind any other dialog,
still self-closing, yields to anything above it. The Record rider was
REACHABLE, not speculative: /record advertises Esc and ?, one Escape
mid-take reached both handlers (E2E red captured "Still recording:
the phase never changed"... inverted — the take kept rolling? No: the
overlay ate the phase change); guarded with isModalOpen. Worker
mutations per ticket (setsar removed; hex tweak; wrong-token swap;
naive guard -> the overlay trapped open behind its own claim exactly
as the ticket predicted). Expediter's own: the Record Escape guard
disabled -> exactly the extended Esc E2E red, restore, 17/17. Gates:
1082 unit / 69+2 Layer 5 / 123 E2E at workers:1. T-12's stale status
line corrected (fixed since round 23; only the Done entry had been
updated). T-73 filed to backlog (Escape closes every stacked modal).

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
