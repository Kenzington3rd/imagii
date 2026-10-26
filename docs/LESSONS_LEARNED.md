# imagii — Lessons Learned

A running log of bugs we've found, the lesson each one taught, and the test that pins it from coming back.

The format for each entry:

> **Bug** — what the symptom was.
> **Root cause** — why it happened.
> **Fix** — what changed.
> **Test** — file:test that locks it in.
> **Lesson** — the generalizable takeaway. This is the part future code reviews should reference.

Entries are grouped by date. Most recent first.

---

## 2026-10-26 — T-140 Track A (round 89): a render that truncated the file it was replacing, and a premise about the folder exports that the code had already outgrown

The twenty-sixth pass, Track A (item 1 of T-140, and one comment; Tracks B and C land beside it). Ledger: r89a/ledger.tsv (24 red rows, two of them superseded by a rewrite or a re-run of their case, and 72 mutation rows over 71 mutations, plus four void rows of a Playwright run whose grep matched no test; all 76 restores byte-identical; every mutant is killed in its last run, and the one that survived its first run (the compilation's join in `beside` mode: only the table's runners had the "a name arrived while the render ran" row) was strengthened with a case for the join and killed). The sent-back landing (a swap the disk keeps refusing lands beside the target) is 7 of the red rows and 34 of the mutations. Every red was a test run against the old product code (unit files and the Layer 5 block copied into a `git archive` of the unchanged tree `9a5fe93`; every new or changed Playwright case on a build of that tree).

### (1) [MED] - a Cancel or a failed render destroyed the file it was replacing

- **Bug.** Export audio over a file the Save dialog had been told to replace, then Cancel (or let the drive fill): the earlier file was gone and the new one was not there. Executed by two reviewers: a 100,000-byte file gone after `cancelAudioJob`, and gone after ENOSPC (ffmpeg exit 228) on a 1 MB tmpfs. The same for the re-attach's mux, the caption burn-in, and the recording's save (whose failure path unlinked the chosen path unconditionally, and whose remux-failure fallback unlinked it and then copied).
- **Root cause.** ffmpeg truncates the file it opens, and every runner handed it the final path with `-y`. T-100 removed the half-written file after a stop (`discardPartialOutput`, guarded by a clock test against the spawn so it would not delete last week's export); it could not give back the file that the open had already emptied. T-139 (1) had the rule for the files node writes, a write over a file the person owns is the old file until the new one is whole; nothing carried it to the files a spawned program writes.
- **The ticket's premise, corrected.** The ticket said the folder exports (platform export, GIF, reframe, the compilation's join, picture-in-picture, the Clip Kit's per-clip files) "name their outputs deterministically" and so a second export "replaces the earlier export". They do not, since T-106: each takes the first free name (`nextFreePath`: `name (2).mp4`), so a re-export into the same folder never replaced anything: the earlier export was never at risk on the unchanged build (Layer 5's T-106 case, "a canceled job beside an earlier export of the same name leaves that export alone", holds it), and the new e2e of that case is red there only for the partial's name. They moved to the partial anyway, for what it changes for them: a stop removes a unique file by name instead of by a clock test on the final name (on a share whose clock ran behind, the old rule left the partial for good); a crash leaves `name.<hex>.partial.mp4` where it used to leave an unplayable `name.mp4` that looked like an export; and the free name was only free when it was chosen. Before, the file ffmpeg was writing held the name for the whole encode; with a partial, nothing does for the minutes between the choice and the swap, so the swap asks for the next free name again (`beside` mode) and a file that arrived meanwhile is not replaced.
- **Fix.** One mechanism, `main/ffmpeg/partialOutput.ts`. A runner names its output with `partialPathFor(target)`: `<stem>.<8 hex>.partial<ext>` in the SAME folder (a rename across volumes is not atomic), the extension LAST so ffmpeg picks the muxer exactly as it would for the target (Layer 5 runs the real runner for mp3, wav, flac, m4a, upper-case `.MP3` and `.WAV`, mp4, gif, webm and jpg on both majors and reads the container and codec back). It runs ffmpeg against that, runs its own checks on the exit (`wroteNoPicture`, the join's lost-part guard, `wroteOutput`), and calls `finishPartial(work, { run, partial, target, mode })`: a rejection removes the partial and rethrows the SAME error; a success renames the partial over the target (`replace`: the person named it in the Save dialog; `beside`: the runner chose a free name) only after the run's cancel latch is asked, so a Cancel or the quit sweep that lands between the exit and the rename wins over a finished render and the file that was there stays. `discardPartial` removes a file that carries the partial name and nothing else, so the failure path cannot delete the target even if a caller hands it the target. A rename Windows refuses while a scanner holds the new file (EBUSY, EPERM, EACCES) is tried again for about 1.5 s: the step did not exist before, and a finished render of minutes must not be lost to Defender's 50 ms. And a swap that stays refused (the NAMED file is open in another app) lands the render beside it as `name (2)`; see "Sent back" below. `discardPartialOutput` and its clock-and-spawn rule are deleted (every caller moved, `extractFrame` included: it refuses an existing target before ffmpeg starts, but "refuses" is a stat and a spawn apart). The recording's save passes a partial to `convertToMp4` and `remuxWebm`, copies the fallback to a partial, and a swap the disk refuses is the disk's error (`userFacingError` words it) and not "Converting the recording to MP4 failed". `export.ts` and `reframe.ts` announce 100% / done once the file is THERE. `audio/process.ts`'s comment on the cuts now says the one-block agreement is the cuts' only (T-110 (bl)), as `chain.ts` does.
- **Decided, with a `// simplification:` in `partialOutput.ts`: leftovers.** A crash, a kill -9 or a power loss in the middle of a render leaves its partial beside the output and nothing sweeps it: the launch sweep only knows folders imagii owns, and the Save dialog's folder is not remembered, so a sweep of "the folders imagii wrote to" would clear some partials and not others. A Cancel, a failure and the quit (`drainRuns`) all remove it. The upgrade is a journal of in-flight partials in userData reaped at launch. The same note names two more ceilings: the partial is not fsynced before the rename, and the redirect below reads every lock code on an existing target as "open in another app" (a read-only file refuses a replace with the same code, so the sentence can name the wrong reason; the render is kept beside it either way).
- **Found on the way.** (a) Fourteen unit files faked ffmpeg by closing a child that wrote nothing and read the output path off the last argument; with a swap that needs the file, five of them (the command-line pins) stub it and say so, the rest write their output like ffmpeg does. (b) `tests/e2e` waited for the in-flight file at its final name in six tests (the burn-in and audio Cancels, "Cancel mid-encode", the three quit cases) and counted `.mp4` / `.gif` names in about fifty listings of render folders; the extension-last name means a count of `.mp4` includes the partial, which is the T-139 race again, so `withoutAtomicTmp` drops the partial too and every listing of a render folder now says whether it wants the finished files or what is LEFT (`withEverything`: a Cancel or a quit must leave nothing, and a filter would hide the leak); `atomicWrites.test.ts` fails a bare listing. (c) The first run of the new Layer 5 block against the unchanged tree ran for more than ten minutes: a failed assertion before the Cancel left an hour-long audio render and 1080p encodes running behind the next cases, so each cancel case stops its run in a `finally`.
- **Test.** `partialOutput.test.ts` (the helper on real files, the retry on a refused rename); `cancelSentinel.test.ts` (every real runner against a child that writes where ffmpeg writes: never told to write the target, a stop or a full drive leaves the earlier file byte for byte (sha256) and nothing else in the folder, a Cancel between the exit and the swap wins, a name that arrived meanwhile is not replaced; the join's rows); `recordingCancel.test.ts` and `recordingQuit.test.ts` (the real convert module and latch: MP4 and WebM, a Discard, a crash, a full drive, the fallback copy never unlinking first, a refused swap); `atomicWrites.test.ts` (the audit of `spawn(ffmpegPath, ...)` against `finishPartial`, the listing scan over the render folders, the filter helpers); Layer 5 "a render is written beside its target and swapped in only when whole" (ten runners x Cancel / finished / fresh, over an existing target, both majors) and "the partial of every format a runner writes is read as that format"; Playwright audio.spec.ts and video-pipelines.spec.ts "T-140 (1)" (the audio Cancel over an earlier export and the recording Discard over an earlier take are red on the unchanged build, the first with the earlier file truncated to the empty file's sha256; the folder re-export is red there only for the partial's name and pins that the partial left no hole in T-106).
- **Sent back: the first landing turned a fast failure into a slow loss.** The first handback disclosed, as a `// simplification:`, that a swap the disk keeps refusing discards the finished render. The expediter rejected the ceiling as a regression in the most common Windows case: re-export over a file still open in a player or an editor, which Windows refuses `MoveFileEx REPLACE_EXISTING` for as long as it is open (libuv EPERM / EACCES). Before T-140 ffmpeg's `-y` failed within a second of the press, at open; after it the person waited through a render of minutes and lost it. Expected usability decides: keep the render, beside the file, and say so. `commitPartial`, in `replace` mode only, when the rename is still refused with a lock code after the retries AND something is at the target, lands the partial at `nextFreePath(target)` in the same folder and returns that path (the old file is not touched). It is not tried for `beside` (its name was free a moment ago), for a name nothing is at (the disk's own refusal, which the frame extract's fresh kit folder would hit), or for an error that is not a lock (a full or read-only drive refuses the new name too); a Cancel recorded during the last try wins (the retry loop makes no check after it), and if the new name is refused as well the ORIGINAL error goes up. The consequence is that the path a runner hands back is no longer always the one it was given, so every replace-mode runner now returns the LANDED path to its caller and through IPC (`runFfmpegToFile` -> `exportAudio` / `attachAudio` -> `AudioJobResult`; `runBurnIn`; `recording:finalize`, which adds `requestedPath` only when it moved), and the re-attach feeds its mux the intermediate WAV it landed (a stale `.cleaned.wav` held open would otherwise have been muxed instead of this run's sound) and removes both. The panels report the answer for words and for actions (`ExportDialog`: the toast, the row's Show in folder, Edit in Video Studio; the burn-in toast; Record's toast and its two buttons), with one sentence from one shared helper, `landedBesideNote` ("cleaned.mp3 is open in another app, so this export was saved as cleaned (2).mp3."), and `atomicWrites.test.ts` fails a `finishPartial` call that throws the answer away. Tests: the unit rows named in TESTING.md (each replace-mode runner over a faked persistent EPERM on the target, plus the transient row that still lands on the target), the wiring pins, and three Playwright cases that fake the refusal in main (`refuseRenamesOnto`, which counts refusals so a patch that never took cannot pass): the audio export and the re-attach (toast, Show in folder, Edit in Video Studio on the `(2)` file) and the burn-in. No ffmpeg command changed, so no new Layer 5 block.
- **Lesson.** **A file a person asked to replace is theirs until the replacement is whole, and that is as true of what a child process writes as of what node writes: give the child a name of its own, beside the target with the extension last, and let one function decide what lands. And check a ticket's premise against the code before building to it: the part of "every export replaces the last" that was real was the Save-dialog paths, and the folder exports needed the same mechanism for a different reason (a name chosen before a long encode is free only when it was chosen). And a safety net that makes a failure later and slower must not make it total: moving the failure from the open to the swap means the person has already paid for the render, so the swap's last resort is to keep it, beside the thing in the way, and to say where.**

### Non-counted - "picture and sound agree to within one 256-sample block", in `audio/process.ts`

- `runAudioMux`'s comment said so of the cuts without saying it holds only for a chain with no `afftdn` and no export limiter (T-110 (bl)); it now says that, as `audio/chain.ts` does. No behavior change.

## 2026-10-26 — T-140 Track B (round 89): a word placed off its canvas in an ink the canvas hides, a picture stretched by its own corner, a "start blank" that kept the template, and a studio that did not fit its smallest window

The twenty-sixth pass, Track B (items 2 to 5 of T-140; Track A's item 1 and Track C's items 6 to 10 land beside it). Ledger: r89b/ledger.tsv (30 red rows - the e2e cases against a build of the unchanged tree 9a5fe93 and the unit cases against the unchanged store; 17 from the first passes (two superseded by a rerun after the shortcuts case was split into its own test) and 13 from a final pass of every T-140 case, on the final spec, against the unchanged build - and 52 mutation rows over 52 mutations, 52 of 52 restores byte-identical by sha256; every mutant is killed in its last run, none survived).

### (2) [MED] - "+ Add text" put near-black 32 px text at (120, 120) of whatever document was open

- **Bug.** On the 112x112 emote the new word started at (120, 120): wholly off the canvas, selected and invisible. On every template background (#120c0c, #241614, transparent) the near-black `BG_BASE` text was 1.00 to 1.11:1 against it, and on the 3840 px overlay a 32 px line is a speck. "+ Add text" is the compact panel's control once a template is applied, so this was the thumbnail and overlay flow.
- **Root cause.** `makeTextLayer`'s defaults (32 px, `BG_BASE`) and its caller's (120, 120) were chosen for the default white 1200x800 page and applied to every document. T-139 (2) had found the same blindness in the picture's first placement and fixed pictures only; where a layer lands, how big it is and what color it has are all facts about the document it lands on.
- **Fix.** `@shared/newText`: `newTextSize` (32 px per 800 px of the document's shorter side, so the default page keeps 32, the 1080p overlay gets 43 and the 4K one 86; a 20 px floor so the emote's word is legible, and a fit so it is never wider or taller than the document), the position from `placementFor` (the rule a picture follows) over `estimatedTextBox` (0.6 em a character, an upper bound: the shipped Inter measures "Text" at 2.02 em, 64.7 px at 32 px, so the estimate is never narrower than the drawing), and `inkFor`, the WCAG contrast rule over the two inks the caller passes in (a transparent, unreadable or missing background shows the dark workspace behind the canvas, which most overlays sit on too). The module holds no hex: `canvasStore.textLayerFor(doc)` hands it `BG_BASE`, `INK_BASE` and the workspace color, so the colors stay tokens. `makeTextLayer` is what it was for its other callers.
- **Test.** `newText.test.ts` (the ratios `tokens.ts` documents, every template background, white, a name / `#rgb` / garbage / a missing background, every grey: the pick is the better ink and no grey leaves both under 3.9:1; the pages the app makes; a sweep of shapes for "wholly inside"), `canvasStore.test.ts` (`textLayerFor` over the default page, all 12 templates and all 9 assets: inside, 4.5:1, a token) and image.spec.ts "+ Add text lands wholly on the document and can be read against it" (the Konva node's box in document units; an independent luminance; red on the unchanged build: the emote's word at (120, 120) with its right edge at 184.7 of 112, #120c0c on #120c0c at 1.00:1 and on #241614 at 1.11:1, 32 px on the 4K overlay).
- **Lesson.** **A default chosen for one document is a claim about every document. Anything a new layer starts with that depends on where it lands (its size, its place, its color) is derived from that document, in a pure rule that takes its tokens as arguments so one unit can hold it over everything the app can open. And a color that has to be read is chosen against the surface by measured contrast, never by "the usual one": the near-black was right for the one page it was picked on and 1.0:1 on the others.**

### (3) [LOW] - a corner drag stretched a picture, and the Shift key the fix needed was not Konva's default

- **Bug.** `keepRatio={false}` for every layer: dragging a picture's corner distorted it, the distortion was exported (`scaleX` and `scaleY` are stored and drawn), and Shift - the key for the other behavior - was documented nowhere.
- **Root cause.** One Transformer, configured once for the layer kind where stretching is the point (a rectangle's width and height), and inherited by the kinds that have proportions of their own. The ticket also said Shift frees the ratio as "Konva's built-in". It does not: `shiftBehavior` defaults to `keepRatio || shiftKey`, so with the ratio kept Shift does nothing, and with it free Shift KEEPS the ratio (which is what Shift on a rectangle has always done).
- **Fix.** `keepsRatioOnCornerDrag(type)` (a picture and text) is the Transformer's `keepRatio`, and `shiftBehavior` is `inverted` for those, so Shift frees them, and `default` for shapes, so a shape stretches and Shift keeps its ratio as before. Text was decided with the pictures: a word's proportions are its glyphs', and a stretched word is not a style anyone asks for by dragging a corner (the side handles still stretch it). The shortcuts overlay gets "Shift+drag" and the USER_GUIDE a sentence.
- **Test.** image.spec.ts "a corner drag keeps a picture's and a word's proportions" (a 200x100 picture dragged +100,+10: one scale, and the red box in the exported file is 2:1; Shift with +60,0 changes the width alone; the same for text; a rectangle dragged +150,+10 still stretches and Shift keeps its ratio; red: scaleX 1.50 and scaleY 1.11 for the picture, 2.23 and 1.12 for the text), the overlay row's case, `canvasStore.test.ts` (`keepsRatioOnCornerDrag`) and `hotkeyTable.test.ts`. The mutation that leaves `keepRatio` on and `shiftBehavior` at Konva's default turns the Shift half red, which is how the claim above was checked rather than assumed.
- **Lesson.** **Read the library's key table before documenting a key, and when a ticket says "built-in", check it with the setting it will actually have: Shift frees a ratio only when asked to. A proportion that is part of what a thing IS (a picture, a word) is kept by default and freed on purpose; one that is the thing's job to change (a shape) is the other way round.**

### (4) [LOW] - "start blank" after a template's last layer was removed kept the template

- **Bug.** Apply the emote, remove its layers, and the studio returns to the screen that says "Pick a template to start ... or start blank below". An import or "Start with text" from it was placed on the 112x112 transparent emote, and Export wrote the emote pack.
- **Root cause.** Removing the last layer kept the document's width, height and background, which the empty screen does not show and cannot change. State the screen hides was deciding what its buttons did.
- **Fix.** One guard in the store's `removeLayer`: a document with no layers is the default blank page. Chosen over resetting at the import because the store is where the state becomes invisible: the drop, the chooser, the paste, "Start with text" and the mood board's "-> Canvas" all start from it, and a project never holds an empty canvas (the capture leaves one out). Undo is the history's, not the document's: `prev` (the template with its layer) is what the removal pushed, so undo brings it back whole, redo takes the layer away again, and undo after an import walks back through the removal.
- **Test.** `canvasStore.test.ts` (the last removal; a removal that leaves layers; undo and redo; an add on the empty screen and the walk back) and image.spec.ts "start blank after a template's last layer is removed is the blank page" (the readout 1200 x 800, one saved PNG of that size with an opaque white corner, and the history; red: 112 × 112).
- **Lesson.** **A screen's words are a promise about the state behind it. When two states look the same on screen (an empty template and an empty page), normalize them where they become the same, not in each button; and keep undo coherent by letting the history, not the new state, remember the old one.**

### (5) [MED x2] - Stream Graphics did not fit the smallest window

- **Bug.** (a) At 1024x640 the Export bar (format, scale, Variants, Export) sat at y = 640-694, past the window, and the wheel could not reach it. (b) The 1200x480 Twitch banner pushed the Layers card 76 px past the right edge of a fresh 1024x640 window (it started at x = 840) and wholly off screen after a 1632 to 1024 shrink (x = 1040).
- **Root cause.** (a) The root was `overflow-hidden` where the four sibling studios are `overflow-auto`, and the canvas had `min-h-[400px]` with a 300 px floor in its ResizeObserver, which left 54 px less than the bar needs. (b) The Stage is a fixed-pixel box fitted to its container, and the `1fr` grid track's automatic minimum is its content's: the Stage drawn at 1308 px held the track at 1308 px when the window shrank. Every case that touched these controls used `click()`, which scrolls the element into view before it presses, so they were green over controls a person could not reach.
- **Fix.** The canvas column is `min-w-0`; the canvas box flexes down to `CANVAS_MIN_H` (240 px, one constant for the box's `minHeight` and the ResizeObserver's floor, so the Stage is never taller than what clips it); the root is `overflow-auto`, the backstop. Measured on the unchanged build and on this one (blank page, Bold thumbnail, emote, Twitch banner; the window is 640 / 1024 px): at 1024x640 the Export bar's bottom edge was 694 (729 on the emote, whose bar wraps) and is 620 (the root's 20 px of bottom padding is kept); the Layers card's right edge was 985, 1011, 1000 and 1100 (1300 after the shrink) and is 985, 1000, 1000 and 1000; at 1280x728 the banner's card ended at 1300 and ends at 1256; 1366x768 and 1632x918 were fine and are unchanged.
- **Test.** image.spec.ts "the Export bar and the Layers card are on screen at the smallest window, without a scroll" (`layout.ts` `expectInViewport` for the Export button, the whole bar and the Layers card, and the stage inside its box, four documents x four sizes with no click between the resize and the measurement; the banner opened first on a fresh 1024x640 window, and shrunk from 1632x918 and grown back; a 1024x500 window and a real wheel; and the helper's negative control). Red on the unchanged build: "the Export button ends 41 px below the window (681 of 640)", and the wheel moved nothing.
- **Lesson.** **A fixed-pixel child in a `1fr` track needs `min-w-0` on the item that holds it, and a layout claim is a measurement, not a click: `click()` scrolls first, so a control no one can reach passes every test that uses it. Measure the box against the window with nothing in between, at the smallest window the app is allowed to be.**

### Found on the way

- **`shiftBehavior`'s default keeps the ratio when Shift is held, so a shape's Shift-drag has always done what the new overlay row says** (it was undocumented, not missing). The row names both halves so the three layer kinds read the same.
- **The cites table (`docClaims.test.ts`) pins image.spec.ts's comment line numbers to the source lines they name**, so an edit to `Canvas.tsx` or `canvasStore.ts` that moves a line is a failing test until the comments and the table are re-pointed (done here: Canvas.tsx +13 lines, canvasStore.ts +2 to +6).

## 2026-10-26 — T-140 Track C (round 89): a Restore that vanished without a word, a held Enter that shouted, buttons that dropped the keyboard, a menu that dropped it twice, and a failed transcription that blamed the wrong program

The twenty-sixth pass, Track C (items 6 to 10 of T-140 and two non-counted STYLE_GUIDE fixes; Track A's item 1 and Track B's items 2 to 5 land beside it). Ledger: r89c/ledger.tsv (17 red rows and 66 mutation rows over 66 mutations, 66 of 66 restores byte-identical; every mutant was killed in its first run and none survived). Every red was a test run against the old product code: the unit files copied into a `git archive` of the base commit `9a5fe93`, and every new Playwright case run on a build of that tree (the two cases of item 8 and the pointer case of item 9 were run red a second time after the first draft asserted the symptom's neighbour - the button's attribute - and not the focus loss itself).

### (6) [LOW] - Restore could do nothing, silently

- **Bug.** A conversion or an extraction that landed while the person was on Home filled a studio under an autosave banner that had mounted over an empty session. Restore then withdrew the offer at the press and returned: nothing restored, nothing said. The ledger row and a spec comment both said no way in the UI reaches that.
- **Root cause.** The same premise-read-once as T-139 (5), from the other side: `holdsWork` is read at the mount, the importers' runs (T-136 (2), T-137 (1)) are module stores that outlive the route, and the one signal the banner heard (`useAutosaveOffer`, raised by Home's Open project) was not raised by a landing. The comment that called the backstop unreachable was a claim about the UI written from the components, not from the module stores that run behind them.
- **Fix.** `withdrawWhenSessionGainsWork()` (`restoreRun.ts`) asks `sessionHoldsWork()` at once and on every change of the three stores it reads (`subscribeSessionStores`, `ProjectIO.ts`) and withdraws on the existing signal, so every mounted banner drops its offer; the banner listens while it is not dismissed and was mounted over an empty session. It does not act while a RESTORE is running (`useRestoreRun`): the work a restore puts in the stores is its own, and the banner keeps its "Restoring…" until the snapshot is applied (T-138 (5); the first draft's e2e control, a video-and-sound restore, is the case that tells the guard from its absence). The press-time backstop stays and now says one finished sentence (`describeRestoreRefused`: "Nothing was restored: a video is open now, and restoring would replace it.", naming what is open).
- **Test.** `restoreRun.test.ts` (a landing withdraws once and every listener hears it; a session that already holds work withdraws at once; a canvas with no layers withdraws nothing; the way back stops it; a landing during a Restore withdraws nothing, and the guard is the run and not a latch), `ProjectIO.test.ts` (`subscribeSessionStores` hears each of the three stores and stops; `describeRestoreRefused` for every combination: one finished line, at most 240 characters, a period), the wiring pins, and home-chrome.spec.ts "T-140 (6)" (a sound being extracted when the person went Home lands and the banner goes with nothing pressed, nothing restored, Stream Graphics still empty; red on the unchanged build: the banner count stayed 1 for 90 s) and the multi-source Restore that keeps saying "Restoring…" (green on both builds by design - it holds that this change did not regress T-138 (5)). The backstop itself has no E2E: it is the few milliseconds between a landing and the banner's re-render.
- **Lesson.** **A premise read once is a claim about a moment; whatever can make it false must say so on a channel the reader hears. And "no way in the UI reaches this" is a claim about every module store and every run that outlives its screen, not about the component in front of you: write it only after asking what else writes to the thing that is read.**

### (7) [LOW] - a held Enter in the preset name box raised error toasts

- **Bug.** Holding Enter in the Cleanup presets' name box saved the preset with the first press and then raised the red "Name your preset first" on every auto-repeat.
- **Root cause.** `onKeyDown={(e) => e.key === 'Enter' && save()}` has no `e.repeat` check: the first press saves and clears the name, each repeat finds it empty (the held-key class of T-120, T-133 (7), T-134).
- **Fix.** `&& !e.repeat`, the house idiom (the Player's Space and the markers).
- **Test.** audio.spec.ts "T-140 (7)" (a held Enter, the repeats arriving after the OS's repeat delay: one preset, no error; a fresh press still saves and an empty box still says so), the wiring pin. Red on the unchanged build: four "Name your preset first" toasts, one per repeat.
- **Lesson.** **A key handler on a text box that acts on Enter is a handler for the repeat of Enter too, until it says otherwise. The guard goes on the repeat, not on the message: the red toast is right for a fresh press.**

### (8) [LOW] - the preset buttons dropped the keyboard while saving

- **Bug.** Saving a Cleanup preset or a Custom export preset with Enter or Space moved the focus to the page (behind the dialog, for the custom one).
- **Root cause.** `disabled={saving}` on the button the keyboard had just pressed: Chromium blurs a focused button that becomes disabled (the T-120 (10) record). The disabled attribute was doing a job the claim already did (a second press is a no-op), and costing the keyboard its place.
- **Fix.** `aria-disabled={saving}` with `aria-disabled:opacity-50` (Tailwind's `disabled:` is the `:disabled` pseudo-class, which an aria-disabled button never matches). The press still reaches the click handler, and the handler is the claim. The "every disabled button looks disabled" scan in `interactionWiring.test.ts` read only `disabled`, so it could not have seen these buttons; it reads `aria-disabled` and its variant now, with discrimination rows both ways.
- **Test.** audio.spec.ts and video-pipelines.spec.ts "T-140 (8)": a keyboard press under `slowPresetWrites` keeps `document.activeElement` on the button halfway through the write and after, the button is `aria-disabled` and its computed opacity is below 0.7 meanwhile and 1 after, and a second Enter and Space during the write start nothing (one preset on disk, said once). Red on the unchanged build: `Received: inactive` at the focus assertion, in both places. The T-139 (9) wiring pins follow.
- **Lesson.** **`disabled` on the control that has the focus takes the focus with it. When something else already makes the second press harmless, use `aria-disabled` and keep the person where they are. A scan for "looks disabled" has to read every spelling of disabled.**

### (9) [LOW] - the recent-files menu dropped the focus when it closed

- **Bug.** Escape, picking an entry and Clear list unmounted the list with the focus inside it; focus fell to the page and the next Tab started at the top of the window.
- **Root cause.** The menu had no focus management at all (T-18 gave it Escape and click-outside but only as dismissal).
- **Fix.** `closeToToggle()`: asked BEFORE it closes whether focus is inside the menu (the unmount is what drops it), and if so the toggle (a ref) takes it; for Escape, a pick and the pointer leaving the list. Focus that was elsewhere (a press outside, Shift+Tab to Choose file…) is where the person put it and is left alone. **Clear list is the exception the ticket did not see:** with no entries the whole menu unmounts, the toggle with it, so "focus the toggle" would hand the focus to something that is gone one tick later. The control before the menu in its row (the importers' "Choose file…") takes it. A pick that opens a file replaces the importer with the studio (as Choose file… does), so what is held is the part the menu owns: the toggle keeps the focus while the pick loads.
- **Test.** home-chrome.spec.ts "T-140 (9)": Tab into the list and Escape (also from Clear list), with the control (Escape with the focus on Choose file… takes nothing), Clear list from the keyboard (emptied on disk, the menu gone, "Choose file…" focused), the pointer leaving the list, and a keyboard pick in Audio Studio (the toggle focused while the extraction is held). Red on the unchanged build: `Received: inactive` in all four.
- **Lesson.** **A control that unmounts on the action that closes it cannot be where the focus returns to. Ask what is still there after the action, not what was there before it.**

### (10) [LOW] - a failed transcription blamed the video tool, and the setup was gone

- **Bug.** A failed Transcribe said "imagii's video tool stopped before it finished. Check that the source file still plays and the folder has room" - the wrong program and the wrong advice - and the setup card with the folders showed only while the files were missing, so after the failure there was no way back to them.
- **Root cause.** The speech engine's runner words its failure `whisper exit <code>: <stderr>`, which has the shape `RUNNER_EXIT` knows (a word, `exit`, a code), so it got the generic sentence written for ffmpeg. A missing `.dll` beside `whisper-cli.exe` - the failure the setup card's zip step makes likely - is Windows' exit 0xC0000135.
- **Fix.** Two sentences in `userFacingError`, anchored at the start of the message and tried after the known causes: "The captions engine stopped before it finished. Open Captions setup to check its files and the model, then try again." and, for 0xC0000135, "The captions engine couldn't start because a file it needs is missing. Copy every .dll that came in the zip next to whisper-cli.exe (Captions setup opens that folder), then try again." Node reports a Windows exit code as the unsigned 32-bit value (3221225781); the signed spelling (-1073741515) is accepted too because nothing depends on which a runtime picks. A burn-in exit is ffmpeg's and keeps the generic sentence; a more specific cause wins for the engine as for every runner (a model another app holds open ends a line in "Permission denied" and reads as a locked file). The panel keeps its setup instructions reachable once the files exist: a closed "Captions setup" disclosure under the panel, the same markup as the card (one `setupDetails`).
- **Test.** `userFacingError.test.ts` (the engine's exits: a damaged model, other codes, null, no stderr, a crash code that is not the missing-files one, a code that only contains its digits, the digits in the stderr; both spellings of the missing-files code, bare, wrapped and with a stderr tail; the burn-in and FFmpeg exits keeping the generic sentence whatever code they carry; only a message that STARTS with the engine's exit counts; Permission denied, a full disk and a missing file keeping their sentences), and video-pipelines.spec.ts "T-140 (10)": a stand-in engine that exits 1 through the real extraction, `runTranscribe`, mapping and toast (the sentence, none of the runner's words), the disclosure opening both folders and the two folder buttons reaching `shell.openPath` with them; and the missing-files exit through a stubbed `captions:transcribe` (an exit status is one byte on this platform, so the code cannot be produced by a script). Red on the unchanged build: the video tool's sentence, and no "Captions setup" button.
- **Lesson.** **A runner's failure shape is not a program. The sentence for "a runner exited" has to name the program that ran, or it is advice for a different tool; and a sentence that sends the person somewhere has to be checked against the screen they will be on.**

### Non-counted - STYLE_GUIDE

- The unqualified "at each cut picture and sound agree to within one 256-sample block" is the cuts' only (T-110 (bl)), as `audio/chain.ts` says. The "Round 88 additions" block that sat after the guide's closing section is moved into the guide's structure, wording unchanged, with the T-140 revisions beside it; `docClaims.test.ts` holds both.

## 2026-10-25 — T-139 Track A (round 88): a save that truncated first, an autosave that shared its tmp, and a locked file told to check the disk

The twenty-fifth pass, Track A (items 1, 3 and 10 of T-139, and one comment; Track B's items 2, 4 to 9 land beside it). Ledger: r88a/ledger.tsv (11 red rows and 71 mutation rows over 50 mutations, 71 of 71 restores byte-identical; every mutant is killed in its last run, and the one that survived its first run was a test that checked for a leftover only after the next write could have swept it, which was split and the group re-run). Every red was a test run against the old product code, in the clone before the change and again in a git-archive of the unchanged tree `d7e1738`.

### (1) [MED] - saving over a file destroyed it when the write failed

- **Bug.** Save project over a project the person already has, Save image over a picture, the emote pack over an earlier pack, Save .srt over an earlier subtitle file and every mood-board write opened the target for writing, which truncates it before the first new byte lands. A write that failed after it began (a full or removed drive, a crash) left neither file: executed, ENOSPC on a tmpfs left a 2,097,152-byte unparseable file where a project had been, and a truncated board file does not parse, so `readCollection` dropped the board and all its items from the list without a word.
- **Root cause.** `writeFile(chosen, bytes)` and `copyFile(source, chosen)` are not atomic: the old content is gone at open. Nothing tied "a file the person chose or owns" to a safe way of writing it, so each handler wrote it the way the first one had.
- **Fix.** `writeFileAtomic(target, data)` in `src/main/fsAtomic.ts`: the bytes go to `<target>.<8 hex>.tmp` in the SAME folder (a rename across volumes is not atomic), are flushed (best effort: a drive that cannot fsync still gets a whole file), and `rename` swaps the tmp over the target (it replaces an existing file on Windows too; a target another app holds open refuses the rename, EPERM or EBUSY, and the person keeps the old file and is told why by `userFacingError`). On any failure the tmp is removed (its own error ignored) and the ORIGINAL error is rethrown. Used at `project:save`, `image:save`, `image:saveMany` (each file), `captions:saveSrt` (the transcript's bytes are read, then written the same way: a copy of a file of kilobytes is a read and an atomic write, and the bytes are not re-encoded), `captions:writeKitSrt`, and all five board writes (create, rename, add, remove, restore: the ticket named three; the other two have the same shape). A `// simplification:` comment names the ceiling (the new file takes the folder's default attributes and ACL, and a symlink at the target is replaced, not written through).
- **Found on the way.** The fault tests for the board writes also surfaced a defect that was already there: `withCollectionLock` ended with `void next.finally(...)`, and a `finally` on a promise that rejected is a NEW promise that rejects too, with nobody listening, so every failed board write was also an unhandled rejection in main (Node's default raises it) on top of the caller's own. The clean-up is `next.then(release, release)` now; `moodboard.test.ts` listens for `unhandledRejection` across two failed writes (red on the unchanged lock, and vitest itself reported 4 unhandled errors on the first run of the fault tests).
- **Test.** `fsAtomic.test.ts` (the real `node:fs/promises` with a write that puts half its bytes down and then fails, a refused rename, a refused cleanup and a drive that cannot fsync: the target is byte-identical and no tmp is left in every one, the error is the disk's own, the success path writes exactly the bytes as text and as every byte value, the tmp is beside the target and never the target, two saves in flight leave one WHOLE); the real handlers over the same injection, each with a first save that fails leaving no file, a success leaving no tmp, and the sentence the person reads (`projectSave.test.ts`, `image.test.ts`, `captionsSaveSrt.test.ts` incl. the copy being byte for byte, a BOM, CRLF and a non-UTF-8 byte kept, `captionsWriteKitSrt.test.ts`, `moodboard.test.ts` for all five writes); and `tests/unit/atomicWrites.test.ts`, a syntax-tree scan that fails on any `writeFile` / `copyFile` / `appendFile` / `createWriteStream` under `src/main` that is not in its audited table, with a discrimination block. The raw writes that remain, each with its reason in the table: the thumbnail cache, autosave's own tmp-and-rename, three temp or partial files, and three marked NOT CONVERTED because they sit outside Track A's files (`recording.ts`'s fallback copy to a chosen path, and the two preset writers, each a NEW file under a fresh id).
- **Found in the full run (the same item's second half).** The tmp is a file in the person's folder for the length of a write, and the harness listed that folder: `image.spec.ts`'s `savedNames` was a bare `readdirSync(downloadDir)`, and `waitForDownloads` polls its COUNT and then reads every name, so a poll that landed while the one file was still `imagii-1.png.<8 hex>.tmp` counted it and read a name the rename had taken (the expediter's full run: "the document background lands in the bytes", 1 of 458, 5/5 standalone). A race the change introduced into the tests, not a load flake. Fix at the root, in the tests: `tests/e2e/atomicTmp.ts` (`withoutAtomicTmp`, filtering on `ATOMIC_TMP`, which `fsAtomic.ts` exports beside the line that builds the name) in `savedNames`, `clearDownloads` and the Reference Export's wait in `references.spec.ts`. Proof is deterministic: `tests/e2e/slowWrites.ts` holds `fs/promises`'s `rename` at a gate in main (the `mainSpawn.ts` technique), so the tmp is guaranteed to be in the folder; two cases in `image.spec.ts` ("a save in flight leaves a tmp in the folder") ask the helpers the racing question and were red on the old `savedNames` (`Array [ "imagii-<stamp>.png.a9dd5cf3.tmp" ]` where `[]` was expected, for Export PNG and for the emote pack), green on the filter, and the filter removed again is red. `fsAtomic.test.ts` pins `ATOMIC_TMP` to the name the real writer makes (a drift in either, red), and `atomicWrites.test.ts` scans every spec: a `readdirSync` over `downloadDir` / `exportsDir` outside `withoutAtomicTmp(...)` fails.
- **Lesson.** **A write over a file the person owns is a replacement, not an edit: the old file stays the old file until the new one is whole. `writeFile` onto the real path is a bet that nothing goes wrong half-way, and the bet is lost on exactly the machines (a full drive, a flaky share) where the file matters most. A rule like that is a scan, not a memory: every raw write in main is either the helper or a row with the reason it needs none. And a change that adds a transient file to a folder is a change to every test that lists the folder: widen the window with a gate, not with load, and filter on the writer's own pattern.**

### (3) [LOW] - overlapping autosave writes corrupted both slots

- **Bug.** `writeAutosave` wrote through ONE fixed `autosave.tmp` with no exclusion. The renderer's `doSave` sets `lastWriteTime` AFTER its await (so a second write can start while one is in flight) and the quit flush writes beside it: overlapping calls truncated each other's tmp, a mixed file was renamed into `autosave.json` and then copied over `autosave.prev.json` (executed: both slots corrupt in 6 of 6 overlapping trials).
- **Root cause.** A fixed scratch name is a lock nobody took. The writer is in main, the callers are three (the debounced save, the quit flush, a second one fired while the first awaits), and nothing in main ordered them.
- **Fix.** `writeAutosave` is a module-level promise chain: each call starts after the previous one has settled (the later content wins; an earlier caller still gets its own result), a call that fails or throws does not stop the ones behind it, and each write has its own tmp name (`autosave.<8 hex>.tmp`) so even a mistake elsewhere could not make two share one. Because a name of its own no longer overwrites the last write's leftover, a write that fails removes its half file, the next write sweeps any `autosave.*.tmp` a killed process left (a quit flush that hit its deadline leaves one up to the size limit), and Clear lists every tmp name, not one. The fsync, the `.prev` copy and the rename are as they were.
- **Test.** `autosave.test.ts` over the real module and real files: two overlapping writes of very different sizes, four trials, in both orders (a parseable current AND prev, current the later call's content, prev the earlier's, no tmp, both callers told ok), a burst of six (each result its own size), the quit flush beside a periodic write through the real `quitFlush`, a distinct tmp name per write, a failed write (half its bytes down) not wedging the chain and leaving no tmp, a call whose safety check throws not wedging it, the sweep (only our own names), and Clear removing a cut-off tmp. Red on the unchanged code in 7 places (`ENOENT ... rename 'autosave.tmp'` where the second writer found its tmp already renamed).
- **Lesson.** **Serialize a writer where the file is, not where the callers are. And when giving each write its own scratch name, give the leftovers of a write that was killed a reaper in the same change: the fixed name used to clean up after itself by being overwritten.**

### (10) [LOW] - ffmpeg's "Permission denied" got the generic sentence

- **Bug.** A recording another app held open, or an export aimed at a file an editor had, said "Export failed. imagii's video tool stopped before it finished. Check that the source file still plays and the folder has room" (and the importer, "imagii couldn't open that file. imagii's video tool stopped..."): the cause was a locked file.
- **Root cause.** `KNOWN_CAUSES` and `describeImportError` listed the errno names and Windows' own wording (EBUSY, EPERM, EACCES, "access is denied"). The shipped Windows ffmpeg prints strerror's text instead, because the Microsoft C runtime maps a sharing violation or an ACL block to EACCES: `Error opening output files: Permission denied`. Captured again under Wine from the shipped `ffmpeg.exe` (a folder where the output, or the input, should be gives EACCES): three CRLF lines, `[out#0/mp4 @ 00007fffff466e00] Error opening output Z:\...\clip.mp4: Permission denied`, `Error opening output file Z:\...\clip.mp4.`, `Error opening output files: Permission denied`; the input side prints `[in#0 @ ...] Error opening input: Permission denied`. The probe line (`ffprobe exit 1: C:\x\rec.mp4: Permission denied`) is the sweep's capture; the harness has no ffprobe.exe.
- **Fix.** One exported pattern, `RUNNER_PERMISSION_DENIED` (`userFacingError.ts`): a runner or probe exit (`RUNNER_EXIT`'s prefix) with a line that ENDS in `: Permission denied`, case-insensitive, CRLF or LF. `KNOWN_CAUSES` maps it to the existing Windows-blocked sentence and `describeImportError` reads the same pattern. The bare phrase is NOT a cause: "Screen recording permission denied" (main's own words for a capture the OS refused, pinned by `record.spec.ts`), the browser's "Permission denied" (a `NotAllowedError` is mapped by NAME), ffmpeg's line with no runner around it, and a runner line that merely mentions the words all stay as they were.
- **Test.** `userFacingError.test.ts` and `importDiagnostics.test.ts`: the real win32 lines (export, probe, the two Wine captures) through the Electron envelope and bare, every runner's prefix, LF and CRLF, the Windows-blocked sentence for each and no path, tool name or errno in it, the existing EBUSY / EPERM / EACCES / "Access is denied" controls, and the controls above. Red on the unchanged code in 18 places.
- **Lesson.** **Match the words the SHIPPED binary prints, not the errno names the OS API documents; and a phrase that is a cause in one shape (a runner's `<path>: Permission denied` line) is not one in another (a capture the OS refused). Anchor the mapping to the shape.**

### Non-counted - "picture and sound agree to within one 256-sample block"

- `audio/chain.ts` said so of the cuts without saying it holds only for a chain with no `afftdn` and no export limiter: `afftdn` delays the sound by two hops (about 25 ms at any rate) and `alimiter` (latency off) by 5 ms (T-110 (bl)). The comment says that. No behavior change.

## 2026-10-25 — T-139 Track B (round 88): a picture placed past the edge of its canvas, a copy with no byte budget, an offer that outlived what it offered, and a double-click on three buttons that make records

The twenty-fifth pass, Track B (items 2, 4, 5, 6, 7, 8 and 9 of T-139, and one comment; Track A's items 1, 3 and 10 land beside it). Ledger: r88b/ledger.tsv (17 red rows, two of them superseded by a rerun after a fixture bug - the first posting-log and preset cases pressed a button that was scrolled out of the window - and 59 mutation rows over 58 mutations, 59 of 59 restores byte-identical; two rows survived: the memo that asks a picture's opacity once, which the first test never gave a JPEG source (strengthened, then killed), and the Custom presets' claim, which the disabled button covers at E2E and the wiring pin kills). Every red was a test run against the old product code (unit files copied into a `git archive` of the base commit; every new or changed Playwright case run on a build of that tree).

### (2) [MED] - an imported picture landed mostly off a small canvas

- **Bug.** A 512x512 file dropped on the 112x112 emote template showed a 52 px corner of itself: the other handles were off the stage, and the Properties panel has no size field to bring it back.
- **Root cause.** The first placement was `min(its size, 800 px)` at (60, 60) whatever the document. The 800 was chosen for the default 1200x800 canvas and was a number about the picture; where the picture lands is a fact about the document.
- **Fix.** `placementFor(picW, picH, docW, docH)` in `@shared/imageBounds`: the drawn size is also bounded by the document, the position is 60 px in when there is room and less when there is not. The drop, the file chooser and the paste (all through `ingestFile`) and "-> Canvas" read the open document after the picture has loaded and use it. Templates' own layers are untouched.
- **Test.** `imageBounds.test.ts` (the emote, the banner, the overlay, the margin giving way, a bad document, a sweep of pictures x documents for "wholly inside", and the rounding case `120 * (31 / 120)`), `canvasStore.test.ts`, image.spec.ts and references.spec.ts "wholly on the canvas" (red on the unchanged build: a 512 px layer at (60, 60) on a 112 px canvas; the overlay case is the control and was green there too).
- **Lesson.** **A size chosen for the common case is a claim about every case: ask where a thing lands before deciding how big it is. The check that proves it is the box, wholly inside the container, at the smallest container the app makes.**

### (4) [LOW] - one picture's stored copy could pass the project size limit by itself

- **Bug.** T-138 (2) bounded the stored copy's pixels, not its bytes, and only a source that was a JPEG was re-encoded as one: a 9000x6000 PNG on the 4K overlay became a 54 MB data URL and paused autosave at once.
- **Root cause.** The unit of the limit is bytes and the unit of the bound was pixels; noise (a screenshot of text is the opposite) costs about 4 bytes of PNG a pixel, 5.3 as a data URL.
- **Fix.** `STORED_IMAGE_MAX_BYTES` (16 MiB of data URL characters) and `chooseStoredCopy`: the first copy that fits, in this order: the file as it came when it is within the bound; the copy at the bound; an opaque picture as a JPEG at that bound; the bound stepped down by a quarter, as a JPEG if opaque and a PNG if not. A picture within the pixel bound whose file is over the budget is re-encoded. Opacity is read once, and only when a copy is over.
- **Test.** `imageBounds.test.ts` (the ladder against a stand-in encoder), `boundedImage.test.ts` (the canvases under it), image.spec.ts "an incompressible picture is stored within the byte budget" (35 MB and 41 MB noise PNGs on the 4K overlay: 13.4 and 9.1 million characters; the unchanged build stored 47.0 and 54.2 and paused autosave).
- **Lesson.** **A limit in one unit needs a bound in that unit. When a fix for a size is written in pixels, ask what the limit counts.** The fix is a ladder and its order is the design: put the cheapest change that cannot lose anything first (a JPEG of an opaque picture), and the one that costs pixels last.

### (5) [LOW] - the autosave banner outlived the project opened under it, and its Restore replaced it

- **Bug.** The banner is drawn over an empty session on Home; Open project applies the project and stays on Home, so the same banner offered Restore, and pressing it applied the snapshot over what had just been opened.
- **Root cause.** `holdsWork` is read once per mount (T-124 (5)), and a mount can outlive a change that makes the premise false. T-138 (5) had put the restore's own end on a shared signal; the OTHER way the premise ends (a project opened) had none.
- **Fix.** `useAutosaveOffer` beside `useRestoreRun`: Home raises `withdraw()` when the project has applied, and every mounted banner drops its offer. `restore()` asks `sessionHoldsWork()` again at the press, inside its claim and before the apply, and withdraws the same way.
- **Test.** home-chrome.spec.ts "the autosave banner goes when Open project lands" (red: the banner count was 1), `restoreRun.test.ts`, and the wiring pins for the order and the backstop (the backstop has no E2E: nothing in the UI reaches it).
- **Lesson.** **A premise read once is a claim about a moment. Whatever makes it false should say so on the same channel the other things that make it false use, and the thing that acts on it asks again at the moment it acts.**

### (6) [LOW] - the captions setup named a file the releases page does not offer

- **Bug.** "Download whisper-cli.exe from the whisper.cpp releases (the Windows build)": the release marked Latest carries source archives only, the Windows builds are zips under the b-series pre-releases, and no asset is called whisper-cli.exe.
- **Root cause.** The step was written from what the program is called on disk, not from what the page offers.
- **Fix.** The card and USER_GUIDE name `whisper-bin-x64.zip`, the newest release that lists it (some are marked Pre-release), and say to copy `whisper-cli.exe` and every `.dll` next to it from the zip's Release folder into the folder shown; the link is `github.com/ggml-org/whisper.cpp/releases`. The zip's layout (a top-level Release folder) is read from whisper.cpp's own release workflow, which `Compress-Archive`s `build/bin/Release`; the zip itself could not be fetched from the build host.
- **Test.** `truthInCopy.test.ts`, and the setup-card case in video-pipelines.spec.ts (the code list, both sentences, both links' addresses).
- **Lesson.** **An instruction that names a download names what the page offers, in the words the page uses, and says where the pieces are inside it.**

### (7) [LOW] - the decision order contradicted the placements beside it

- **Bug.** DESIGN_GUIDE's order for a running-job Cancel sent the Clip Kit (it always asks for a folder) beside its primary, Audio Studio's export (it draws a bar) to the progress row, and the Export panel (it draws bars) to the progress row; the guide's own list and the code place them under it, beside it and under it.
- **Root cause.** The order was one question per placement, in an order nobody ran against the list: "reports a percent" is true of a queue row and of a job row that stays after the job, and "a dialog is answered" is true of a chooser that opens only on a first run.
- **Fix.** The order is now: a progress row of the job's own (it exists only while the job runs and holds the bar); the caption row (no primary); the row under the primary if the busy label is a sentence; beside the primary if a dialog is ALWAYS answered; else under. `docClaims.test.ts` runs it, panel by panel, against the code that draws each Cancel and each chooser.
- **Test.** `docClaims.test.ts` "(7) the decision order classifies each panel the guide lists the way the code draws it".
- **Lesson.** **A rule with an order is a function: run it on every example the document lists before it is written down. And a doc claim about code is held to the code, not to the other claim beside it.**

### (8) [LOW] - the GIF widths did not reproduce

- **Bug.** DESIGN_GUIDE said GIF's button was 112 px idle and 120 busy; LESSONS repeated them as "re-measured". In the built app, Inter loaded, they are 102 and 109, at 1632 and at 1024 px wide.
- **Root cause.** A measurement quoted from memory of a measurement (T-138 (7) wrote the pair next to ones it did measure; Picture-in-picture's 86 and 108 and the kit's 154 and 233 do reproduce).
- **Fix.** Corrected in both places, with how they were measured. The criterion (where a Cancel beside the primary would land) did not depend on them.
- **Test.** `docClaims.test.ts` "(8)" (the figures, and that the old pair is nowhere).
- **Lesson.** **"Re-measured" is a claim about a run. Say which build, which font, which window, and re-run it when the number is repeated in another document.**

### (9) [LOW] - the second press of a double-click on three record-making buttons

- **Bug.** "+ Log post" cleared its form in the same tick, so the second press raised a red "Add a clip name first" after the green "Added"; "Save current" and "+ Save preset" cleared the name after the awaited write, so the second press got the red error or, on a slow write, saved a duplicate. Measured first, for Welcome's "Let's go": its second press lands on Stream Graphics' card at 1366x768 (and 1306x734, 1161x653, 1024x640) and opens the studio.
- **Root cause.** Each is a button whose first press changes what the second one means, and none had the family's guard (T-131).
- **Fix.** `isRepeatPress(e)` on the three; `claimFirst(savingRef, ...)` and `disabled={saving}` on the two preset saves; `swallowRepeatClicks()` when Welcome is dismissed.
- **Test.** video-pipelines.spec.ts, audio.spec.ts and home-chrome.spec.ts "T-139 (9)". Two layers cover a double-click, so the tests tell them apart: a second press AFTER the write (by hand, click count 2) holds the repeat guard; a write slowed from the test (`slowWrites.ts`) with a double-click and a held Enter holds the claim and the disabled button.
- **Lesson.** **When two guards cover one gesture, a test of the gesture proves neither. Make the case where only one of them applies (a press that comes after the work, a press that comes during it) and show each fails alone.**

### Found, not fixed

- Canvas.tsx's `useImage` sets no referrer policy (ledger (g)); README.md still links the old owner's repository and the old instruction; a Restore pressed while an Open project is still applying can apply over it. See the round 88 Track B section of INTERACTION_COVERAGE.md.

## 2026-10-25 — T-138 Track A (round 87): a guard that read the Linux binary's pointer, a scan slot a reload could overwrite, and a loudness target the guide forgot

The twenty-fourth pass, Track A (items 1, 6 and 9 of T-138, and one comment; Track B's items 2 to 5, 7 and 8 land beside it). Ledger: r87a/ledger.tsv (10 red rows and 26 mutation rows over 26 mutations, 26 of 26 restores byte-identical; every mutant was killed, and two early drafts of the Playwright red are kept as superseded rows). Every red was a test run against the old product code, a build of the unchanged tree `63d18ff` for the Playwright case, or the real binary for Layer 5 on the bundled 7.0.2, the distro's 6.1.1 and the SHIPPED Windows exe under Wine.

### (1) [HIGH] - the lost-part guard never matched the shipped Windows binary

- **Bug.** On the Windows ffmpeg, `FFMPEG_UNREADABLE_PART` and `unreadableSegmentIndex` (T-137 (12)) never matched the join's "Impossible to open" line: a lost LATER segment saved a shorter file as "Saved" (the T-131 (1) bug, back), and a lost FIRST one showed the raw "concat exit 254" with no clip named. Layer 5 on the shipped exe was red in five places (T-131 (1) twice, T-136 (15) twice, the T-137 (12) control), so `release.yml`'s windows-latest `test:media` would have failed at tag time. Every Linux gate was green.
- **Root cause.** The prefix was spelled `[concat @ 0x[0-9a-f]+] `, the shape glibc's `%p` prints. The shipped ffmpeg (gyan.dev 6.1.1, mingw-w64) prints the pointer bare and zero-padded, `[concat @ 00007fffff45eb80]`; the Microsoft CRT prints it in uppercase; glibc prints a null one as `(nil)`; and on Windows the line arrives in CRLF, often straight after a stats line that ends in a bare `\r`. T-136 (15) and T-137 (12) were written and proven against the only binary on the machine in front of the author.
- **Fix.** One shared prefix for both patterns, `\[concat @ [^\]\n]*\] ` (`noPicture.ts`'s shape); the rest unchanged (still line-anchored under the `m` flag, which also starts a line after a bare CR, and still the runner's `seg-<job>-<n>.mkv`).
- **Test.** `concat.test.ts` and `concatRunner.test.ts` (each pointer's dress as printed, in CRLF and after a stats line; the echoed-path negatives for each; through the real runner at exit 0 and 254); Layer 5, a new block that takes the line each binary REALLY printed and re-prints its pointer in each dress (red on both Linux majors on the unchanged regex, not only on the Windows exe), and the T-131 (1), T-136 (15) and T-137 (12) blocks on the bundled 7.0.2, the distro's 6.1.1 and the shipped exe under Wine (red on the unchanged tree in the five places above, green after). The whole Layer 5 file on the exe is in the ledger with every failure classified.
- **Lesson.** **A guard on a tool's log line holds on every platform the product ships. The pointer in ffmpeg's prefix is `0x...` on glibc and bare zero-padded hex on Windows, and the line's ending and what it follows are the platform's too. Match the shape the platforms share (a bracket that closes on its own line), not the spelling of the machine in front of you, and run the guard against the SHIPPED binary before the release run does.**

### (6) [LOW] - the guides named two of the three loudness targets

- **Bug.** USER_GUIDE's Levels bullet and README's Audio Studio line said "pick Talking and podcasts (-16) or YouTube, TikTok, Reels (-14)"; the picker has had a third, "Broadcast TV and radio (-23)", since 2ff0eb1, and no sentence anywhere said so.
- **Root cause.** The list is code (`LUFS_PRESETS`) and the sentence that counts it is prose; nothing tied them.
- **Fix.** Both name all three. A docClaims pin reads `LUFS_PRESETS` and fails until USER_GUIDE's bullet names every label and README's line every number.
- **Test.** `docClaims.test.ts` "the guides name every loudness target the Levels picker offers" (red on the unchanged guides; a fourth target added to the picker fails it until the guides name it).
- **Lesson.** **A sentence that counts a list the code owns is read by a test that reads the list.**

### (9) [LOW] - a second highlight scan orphaned the first past the quit

- **Bug.** After a renderer reload (Ctrl+R, the render-process-gone recovery) the panel's `useScanRun` is fresh while main's scan runs; a second "Scan VOD" started a second ffmpeg, Cancel stopped the newest, and the older survived `app.quit()` (executed: PPID 1).
- **Root cause.** `video:findHighlights` had no claim of its own and `highlights.ts` keeps ONE `activeScan` slot that a second scan overwrites. T-135 (1) moved the busy flag into a module store, which survives a trip to Home and not a reload.
- **Fix.** `scanningFor` in `registerVideoIpc`, claimed before the handler's first await and given back in a `finally` (the `convertingFor` pattern). The refusal is a finished sentence naming the running video, which `userFacingError` lets stand and the panel shows as an error toast: `Still scanning "long.mp4" for highlights. Wait for it to finish, then try again.`
- **Test.** `videoScanSingleFlight.test.ts` over the real handler (a second call refused naming the first, the same video too, two in one breath run one, the slot back after a success, a failure and a cancel, a refused start does not give the running one's slot away, a bad path never takes it, the hook analysis is not gated); video-pipelines.spec.ts "Scan VOD - one scan at a time, in main (T-138 (9))" (a scan held by SIGSTOP, the renderer reloaded, the video dropped again, the second press refused in its sentence, one scan child in the record, and no scan alive after `app.close()` by PID; red on a build of the unchanged tree on all four counts).
- **Lesson.** **A busy flag in the renderer dies with the renderer. A single-slot child in main is guarded where the slot is, in the handler, or a reload hands the person a button over work main is still doing.**

### Non-counted - "loudnorm is linear there"

- `audio/process.ts` said the measure pass's loudnorm "is linear there". It is linear only when loudnorm takes its linear mode (the measured LRA within the target LRA, the shifted true peak within TP; T-110 (bj)); the comment says that. No behavior change.

## 2026-10-25 — T-138 Track B (round 87): a stored copy sized to where a picture is placed, a question inside a live region, and a Restore a returning banner could press twice

The twenty-fourth pass, Track B (items 2, 3, 4, 5, 7 and 8 of T-138, and the two non-counted riders; Track A's items 1, 6 and 9 land beside it). Ledger: r87b/ledger.md: 13 red rows (5 unit and wiring runs on the unchanged code or docs, 8 Playwright cases on a build of the unchanged tree) and 47 mutation rows over 46 mutants, 47 of 47 restores byte-identical; one mutant survived its first run (the restore run never given back: the Playwright case watched the banner go and never asked the slot again), the case was extended to close the sound and return to Home, and the rerun killed it.

### (2) [MED] - an imported picture was stored at 1600 px whatever the document

- **Bug.** A 1920x1080 frame (or a 4K background) enlarged to fill a 1920 / 2560 / 3840 px overlay was exported from a 1600 px copy: 1.2x to 2.4x upscaled, worse at the HiDPI 2x default, and importing the exported file again bounded it again.
- **Root cause.** T-137 (6) sized the copy to where a picture is first PLACED (at most 800 px, doubled for a HiDPI export). A layer is freely resizable and the templates are 1280 to 3840 px documents, so the largest a picture is ever shown at is the document it fills, not the size it started at.
- **Fix.** `storedImageMaxDim(docWidth, docHeight)` in `imageBounds.ts`: twice the document's longer side, never under 1600, a size that is not a size back to the floor. `ImportPanel` reads the open canvas document from the store at import time (the paste listener is registered when the panel mounts, so a value captured by the component would be the mount-time document) and a picture within the bound is kept as it came. The placed size (800 px) and the "to Canvas" 800 px copy are unchanged.
- **Test.** `imageBounds.test.ts`; image.spec.ts "T-138 (2)" (the 1920x1080 overlay: 1920x1080 kept whole, 4000x3000 at 3840x2880; the 1280x720 thumbnail: 2560x1920, and 1920x1080 kept; a paste and a chosen file on the overlay), and the T-137 (6) case adapted to the default 1200x800 canvas it runs on (2400 px; its transparent fixture made 3000x2000 so it still takes the bounded path). Red on a build of the unchanged tree.
- **Lesson.** **A bound sized to where a thing is placed is not a bound on where it can be dragged. Ask what the thing can be made into, not what it starts as, and read the value that answers it when it is needed, from the store, not from what a long-lived listener saw at mount.**

### (3) [LOW] - the over-limit sentences told the person to do something that freed nothing

- **Bug.** "Remove or shrink large images on the canvas": scaling a layer changes `scaleX` / `scaleY`, never its `src`, so Save and autosave refused again.
- **Fix.** "Remove some of the large images on the canvas, or import smaller copies of them" (Save: ", then save again."; autosave: ", and it will start again."), still one finished line under 240 characters that `userFacingError` lets stand.
- **Test.** `projectValidation.test.ts` (the sentences, no "shrink"; the existing finished-line case holds length and no known cause), the two pins that read the toast and the thrown error (`useAutosave.test.ts`, `projectSave.test.ts`), home-chrome.spec.ts "T-137 (6)".
- **Lesson.** **Advice in a refusal has to name an action that changes the thing the rule measures. Read the rule's input before writing the verb.**

### (4) [LOW] - the Clip Kit's Cancel question opened inside a live region

- **Bug.** The closed-video card sits in `ClipKitRunning`'s always-mounted `aria-live` wrapper (T-137 (3)), and its Cancel rendered the confirm `<Modal>` inline: the whole dialog was inserted into the polite region (executed: `[role=dialog].closest('[aria-live]')` was the wrapper).
- **Root cause.** `Modal` does not portal. Splitting a component's markup from its dialog is not cosmetic when the dialog's position in the tree is its position in the accessibility tree.
- **Fix.** The question is `KitCancelConfirm({ open, onClose })`; `ClipKitRunning` holds the state and returns the wrapper and the dialog as siblings (the dialog is `fixed`, so it takes no room in the studio's column: the empty wrapper's 20 px gap holds). Its state now outlives the card, so it is put down in the render that finds no card, which keeps T-131 (9) true (an unanswered question goes with the kit). The clip list keeps `KitCancel` (button and question together; nothing there is a live region).
- **Test.** video-pipelines.spec.ts "T-138 (4)": the dialog has no `[aria-live]` / `[role="status"]` ancestor on the card and in the clip list, Keep running keeps the kit, Cancel jobs ends it, an unanswered question goes with the kit. Red on the unchanged build for the card (`div[polite]`). The wiring pins that named the old arrangement were re-pointed.
- **Lesson.** **Where a dialog is written is where it sits in the accessibility tree. A component that renders one inline inherits every ancestor's semantics; draw it beside the region, not in it, and make its state outlive whatever it used to unmount with.**

### (5) [LOW] - a return to Home mid-restore offered Restore again

- **Bug.** The person who left Home during a long Restore and came back got an enabled Restore: `restoring` was the banner's state, and `holdsWork` is read once per mount and is false while a restored sound is still being extracted. A second press re-applied the project, took down the first restore's progress toast (they share toast ids) and could start a second extraction and say "Skipped the autosave's audio".
- **Fix.** The restore is a run in a module store (`useRestoreRun`, `components/restoreRun.ts`), claimed with `begin()` before `restore()`'s first await and ended in a `finally`; `restoring` is derived from it (Clear keeps its own local flag); a banner that mounts over the run says "Restoring…" with both buttons off. The closure raises `applied` after the apply and every mounted banner drops its offer through a `subscribe` listener, not a selector: `applied` is raised and the run ended in the same tick, and a render in between would never see it. An apply that threw never raises it, so the banner and its Restore stay for another try.
- **Test.** record.spec.ts "T-138 (5)" (a restore held open, Stream Graphics and back: "Restoring…", Restore and Clear off, Later on; then the banner gone, one "Restored from autosave", no skip toast, one extraction request counted in main; the sound closed and Home visited again, the offer is back with a Restore that can be pressed, which is what killed the mutant that never ended the run; red on the unchanged build), `interactionWiring.test.ts` (the claim before the first await, the `finally`, `applied` after the apply and before the navigate, the listener).
- **Lesson.** **A flag that guards a long operation belongs where the operation lives, not in the screen that started it, and whoever decides to offer the operation again asks that place. When one signal is raised and cleared in the same tick, listen; do not select.**

### (7) [LOW] - the guide's placement rule was false for the cases it named

- **Bug.** DESIGN_GUIDE put a running-job Cancel under the primary "when the primary is wider than its busy label", and listed the Clip Kit, whose busy label is the wider (154 px idle, 233 running).
- **Root cause.** The rule was written from the first measurement (GIF, T-126 (20)) and extended by listing. Re-measured in the built app's own CSS and font, it is false for more than the kit: GIF 102 px idle and 109 busy, Picture-in-picture 86 and 108, Compile equal since T-131 (13); only the Export panel with files queued is wider idle. (The GIF pair was first written here as 112 and 120, which did not reproduce: T-139 (8) re-measured it in the built app, Inter loaded, at 1632 and 1024 px wide.)
- **Fix.** The test is where a Cancel beside the primary would land: at the row's end, on the strip the idle primary's right part held, whatever the label widths; or the busy label is a sentence that wraps. The guide now says the order a new Cancel is decided in.
- **Test.** `docClaims.test.ts` (the rule's wording, the order, and the kit's facts it quotes).
- **Lesson.** **A rule extended by listing is a claim about every case on the list. Measure each one before it goes in, and state the criterion that holds for all of them, not the one the first case showed.**

### (8) [LOW] - a sentence about AutosaveRestore sat under the paragraph about MoodBoardPanel

- **Fix.** "Its two buttons have a busy flag each" is back beside the AutosaveRestore text, names the component and the run slot of (5). **Test.** `docClaims.test.ts` (the sentence's place, and what it says against the banner's code). **Lesson.** **A sentence that starts with a pronoun is a claim about the nearest noun; when an edit separates it from its noun, it describes something else.**

### Non-counted - `loadImage` sent the default referrer policy

- **Fix.** `loadImage` (the one place a picture is decoded to be copied) sets `referrerPolicy = 'no-referrer'` before `src`, as the two `<img>` that draw a thumbnail do; PRODUCT_GUIDE's promise holds by construction. **Test.** `boundedImage.test.ts` (the policy, before `src`, with and without `crossOrigin`). The `networkAllowlist.test.ts` comment on ledger (g) now says "to Canvas" embeds a copy.

## 2026-10-25 — T-137 Track B (round 86): a file Save wrote that Open refused, an autosave that rewrote itself, and two phrases a folder name could say

The twenty-third pass, Track B (items 6 to 12 of T-137; Track A's items 1 to 5 land beside it). Ledger: r86b/ledger.md (27 red rows and 59 mutation rows over 51 mutations, 59 of 59 restores byte-identical; 4 mutants survived and each is listed in the ledger's notes: one is equivalent (a redundant `typeof`, deleted) and three sent a test back to be strengthened and were killed on the rerun). Every red was a test run against the old product code, a build of the unchanged tree `7690cf5` for the Playwright cases, or the real binary for Layer 5 on both majors.

### (6) [MED] - a project over 50 MiB saved, would not reopen, and stopped autosaving without a word

- **Bug.** Four 11 MB PNGs put a project over `MAX_BYTES`: autosave refused it with a console line (and kept refusing), Save wrote 56.9 MiB of pretty-printed JSON and said "Project saved", and Open refused the file with "may be damaged, or saved by a newer version" (executed).
- **Root cause.** Three writers and readers each had their own idea of the limit: Open measured the file's text, autosave measured `JSON.stringify(project)`, `project:save` measured nothing and wrote `JSON.stringify(project, null, 2)`, which is longer than either. And the document held what it was handed: ImportPanel kept every picture's full-size data URL though the layer is first drawn at most 800 px wide.
- **Fix.** One number, one serialization, one function: `projectSizeProblem(size, doing)` over `serializeProject` (compact JSON). `project:save` serializes once, measures that string, throws a finished sentence BEFORE the dialog, and writes exactly the string it measured, so a file it writes always opens. An autosave over the limit is not sent to main (a 50 MiB clone every few seconds to be refused); `startAutosave` raises one toast with a fixed id per episode ("Autosave is paused: ...") and resumes by itself when the project fits. Open names the size instead of "damaged". The document keeps a copy of an imported picture bounded to 1600 px (twice the drawn size: the default 2x export of a placed picture keeps its pixels), PNG unless it came as an opaque JPEG; a picture already within the bound is kept as it came.
- **Test.** `projectValidation.test.ts` ("one size rule": one under, at and one over the limit agree across Save, Open and autosave), `projectSave.test.ts` (the real handler), `useAutosave.test.ts` (not sent, one toast, told again after a fit), `imageBounds.test.ts`; home-chrome.spec.ts "T-137 (6): a project over the size limit" (four cases on a seeded project 150 characters under the limit; the first goes red on the unchanged build because the file Save wrote was 52,428,980 bytes, 180 over what Open accepts, for a project the app itself had just opened) and image.spec.ts "an imported picture is stored as a bounded copy".
- **Lesson.** **A limit that two paths enforce is one function with one input. Measure the text you will write, with the function the reader will use, and write exactly that text. And a rule that only refuses is half a rule: the person who is refused needs the size, the limit and the thing to do, in the place they are looking.**

### (7) [LOW] - the autosave dedupe never matched

- **Bug.** Ticking Grid rewrote a 28.4 MiB `autosave.json` and rotated `autosave.prev`; so did every Find chat spikes and Scan VOD.
- **Root cause.** The key was `JSON.stringify(captureProject())`, and `captureProject` stamps `savedAt: Date.now()`: two captures of the same work were never equal. The hook's comment called it a "serialization round-trip".
- **Fix.** The key is the capture with `savedAt` set aside (a fixed 13-digit stamp, so it is also the length of what main measures); the comment says what it is.
- **Test.** `useAutosave.test.ts` "a change that is not in the project writes nothing" (on the fake clock with the real stores; a real edit and an undo are the controls).
- **Lesson.** **A "did it change?" key is built from the fields that mean change. A timestamp taken at the moment of asking makes the answer always yes.**

### (8) [LOW] - a scan that counted a cap the handler could skip

- **Bug.** The loudness measure pass kept all of its stderr, against T-136 (13)'s "every accumulator is capped".
- **Root cause.** `if (!collectStderr && stderr.length > 16384) stderr = stderr.slice(-16384)`: a tail WAS assigned, so the scan, which looked for the assignment, passed it; the one pass that always ran with `collectStderr` skipped it.
- **Fix.** Every pass keeps the 16 KB tail (loudnorm's block is under a kilobyte and near the end of the log, `parseLoudnormJson` reads the tail), the flag is gone, and the scan walks from the `slice` up to the handler: a guard may mention the accumulator and nothing else.
- **Test.** The scan's real-tree case (red on the unchanged `audio/process.ts`), a discrimination block that includes exactly the old shape and each other way a guard can hide, `silentLoudnorm.test.ts` (a block after 600 KB of warnings reaches the second pass), and Layer 5 on both majors (a damaged mp3 whose decoder floods stderr: the last 16 KB parse to the same measurement as the whole log; and the runner's two-pass file is sample-identical to a hand-built linear render, which a measurement lost to the cap would not be: the case's first version checked only the level, and a 16-character tail passed it).
- **Lesson.** **A scan that checks for the PRESENCE of a guard instead of the PATH to it is satisfied by dead code. Ask what can stop the line from running.**

### (9) [LOW] - a chat row near the end of a VOD showed an end past the video

- **Bug.** The row printed the spike's raw ends while "+ Clip" clamped them to the video, so a 20:00 video showed "19:35 to 20:25" and the clip came out 19:35 to 20:00, against the guide's "adds exactly that range".
- **Fix.** `peakRange` is the one clamp; the row and the add both call it.
- **Test.** `ChatHighlightPanel.test.ts`; video-pipelines.spec.ts "the range a row shows is the range + Clip adds" (a spike in the last bucket; the clip is the row's text). Three existing cases had depended on the raw range (a 2 s video with a log ten hours in drew the widest row; two compared raw text) and were adapted: the layout case now loads a 10-hour 1 fps fixture, so its widest row is real.
- **Lesson.** **When a panel promises "exactly this", the display and the action call the same function.**

### (10) [LOW] - a reference layer died with the thumbnail cache

- **Bug.** "→ Canvas" set the layer's `src` to the address of the tile's cached thumbnail. Clear thumbnail cache (and the launch sweep after a board item is deleted) removed the file; the layer drew nothing, with no marker, and saved projects carried the dead address.
- **Fix.** The layer carries a copy of the picture (800 px; JPEG when every pixel is opaque, PNG otherwise), drawn through an offscreen canvas by the same `lib/boundedImage.ts` the importer uses.
- **Test.** references.spec.ts "→ Canvas embeds the picture" (send, clear the cache, visit the canvas fresh: the layer still draws; a half-transparent thumbnail keeps its alpha, which is what the opaque-only JPEG rule is for).
- **Lesson.** **A document that points at a file the app is allowed to delete will one day point at nothing. Anything the person's work depends on is copied into the work, or is not disposable.**

### (11) [LOW] - a clip field that was not a list crashed Export

- **Bug.** `customPresetIds: 5` (or `{ a: 1 }`, or `true`) validated and threw in the Export panel's render, on every Restore until Clear.
- **Fix.** The validator drops a field that is not a list and the entries that are not strings (dropped, not refused, like the unknown platform ids); `pruneCustomPresets` reads the field as `unknown`.
- **Test.** `projectValidation.test.ts` and `videoStore.test.ts`, both over 5, `{ a: 1 }`, `true`, a string, `null` and a mixed list.
- **Lesson.** **T-119's rule stands: a field a studio iterates without a guard is checked at the gate. The sweep that adds a field to the clip adds its line to the gate.**

### (12) [LOW] - two stderr patterns a folder's name could satisfy

- **Bug.** ffmpeg echoes the person's paths at the default log level ("Output #0, mp4, to '<dir>/<name>.mp4':"), and `/Impossible to open/` and `/Output file is empty/` were tested against all of stderr, so a good compilation, export, reframe or burn-in into (or from) a folder named with either phrase failed.
- **Fix.** Each is ffmpeg's own line at the start of a line (`[concat @ 0x...] Impossible to open '...seg-<job>-<n>.mkv'`, `[out#0/mp4 @ 0x...] Output file is empty, nothing was encoded`).
- **Test.** The unit pins over the echoed lines; Layer 5 on both majors: the premise (the phrase is in a successful run's stderr on this binary), a real join into "Impossible to open", a real export into and from "Output file is empty", a reframe, and the control that the real lines still refuse there. One existing Layer 5 case now names its files like the runner's segments.
- **Lesson.** **A guard on a tool's output matches the tool's line, not a phrase in a stream that also carries the user's strings. If the person can type it, anchoring is the difference between reading ffmpeg and reading them.**

## 2026-10-25 — T-137 Track A (round 86): a job that was the screen's, a Discard aimed at every take, and a live region that arrived with its text

The twenty-third pass, Track A (items 1 to 5 of T-137; Track B's items 6 to 12 land beside it). Ledger: r86a/ledger.tsv (11 red rows and 40 mutation rows, 40 of 40 restores byte-identical; 2 mutants survive, each listed in the ledger's notes (one equivalent today, one a guard class no supported window can see), 3 more survived their first run and were killed after their wiring pins were strengthened, and 1 mutant was invalid (its edit broke the build) and was redone; every red a test run against the old product code or a build of the unchanged tree `7690cf5` for the Playwright cases; item 2 at Layer 5 on both ffmpeg majors).

### (1) [MED] - Audio Studio's importer kept its extraction in the screen, and a late landing replaced whatever was open

- **Bug.** `AudioImporter` held `busy`, `busyRef` and `extractingRef` as component state, and its landing called `loadSource` with no `replacedSince`. Leave mid-extraction, come back to an idle importer, drop a plain WAV (main refuses only a second EXTRACTION), edit it: the first extraction's landing reset the source, the chain and the undo history, with no confirm and no undo. Executed in the built app on the unchanged tree (the red case: "Project loaded" and then "Loaded" for the video's sound, with the project's WAV open and tuned).
- **Root cause.** T-119 made the importer single-flight in the component, and T-136 (2) moved the VIDEO importer's run into a module store without reaching its sibling: the same two defects (state that dies with the route, a landing that does not ask what is open now) sat in the other importer for a round.
- **Fix.** `useAudioImportRun` (`audio-studio/state/audioImport.ts`: the file and whether it extracts), claimed with `begin()` before the first await and given back in the `finally`; a returning importer is the same import (**Loading…**, off, refusing a second file in the same words). The landing asks `replacedSince(heldBefore, source)` after the extraction and skips with "Skipped the sound of x.mp4 because you opened another file in Audio Studio while it was extracting".
- **Test.** audio.spec.ts "T-137 (1)" (two cases: the importer after a trip to Home; a project's WAV opened and tuned during the extraction, the late landing skipped and the selection untouched; both red on the unchanged build), the wiring pins; mutations: the skip removed, the busy flag the screen's again, the refusal never made, the run not given back, the words swapped.
- **Lesson.** **When a ticket moves state out of a component, grep for the other component that copies its idiom. `busyRef` was in two importers; one was fixed, and the sweep that found the other found it a round later.**

### (2) [MED] - A second take's Discard could delete the FIRST take

- **Bug.** `RecordStudio` kept `phase`, `savePercent` and `discarding` as component state, and the live-take guard is registered only during 'recording', so leaving during a save returned an IDLE Record over a convert main was still running. A second take's "Discard recording" called `cancelConverts('recording')`, which cancelled EVERY recording-owner convert; the first take's save then saw a cancel that was not the quit's (`byQuit` false), kept nothing, and unlinked its raw webm - the only copy of a recording the person never discarded. Traced to the `unlink`; the unit reproduces it with the real convert module (the first take's child receives SIGKILL).
- **Root cause.** The cancel was scoped by KIND ("recording", not "import"), which was right for the bug it was written for (T-60: a Discard killed an import) and wrong the moment two of one kind could exist; and the screen the second take was recorded on was reachable only because the first take's save was not the screen's state.
- **Fix.** The save is a run in a module store (`useRecordSave`: the take's session id, whether it is the MP4 convert, the percent, "discarding", the microphone line); the closure that saves keeps writing to it after its screen is gone, and a Record that mounts over it draws the saving card with its bar and its Discard and no Start (`startRecording` refuses in "Still saving the last recording. Wait for it to finish." besides, as a backstop no click reaches). A Discard is aimed at one take: a convert's owner is `recording:<takeId>` (`recordingOwner`), `recording:cancelSave` takes the id and refuses a call without one, and the owner type has no owner-wide recording cancel - the wide cancel cannot be written again by the next caller. The quit sweep still takes every take and keeps each raw take.
- **Test.** `recordingQuit.test.ts` "a Discard cancels its own take and no other" (two takes over the real convert module and handlers, the MP4 convert and the WebM remux; red on the unchanged tree at "its ffmpeg was not signalled: expected [ 'SIGKILL' ] to deeply equal []"), `convertCancel.test.ts`, `convertQuit.test.ts`, record.spec.ts "T-137 (2)" (the saving card on return, and a second real session's Discard answering false while the first take lands as h264; both red on the unchanged build), Layer 5 "a Discard on one take leaves another take's save running" on both majors; mutations: a shared owner at five sites, the sweep restored, the id gates removed one at a time.
- **Lesson.** **A cancel is aimed at a thing, not at a kind of thing. Scoping by kind is a fix for the collision you have; when two of one kind can exist the scope must be the instance, and the cheapest way to keep it that way is a type that has no kind-wide form. And a state that is "the screen's" is a state some other screen can contradict: if a job can outlive its panel, the job's handle is not the panel's.**

### (3) [LOW] - The running-kit card's live region arrived with its text

- **Bug.** `ClipKitRunning` mounted its `aria-live` paragraph WITH its text, the class T-136 (5) fixed for the Player's notice.
- **Root cause, one level down.** The ticket's direction (an always-mounted wrapper, GifPanel's pattern) is necessary and not sufficient: `ClipKitRunning` was mounted by `VideoStudio` only in the branch that exists when the video is CLOSED, so a wrapper inside it would still have mounted at the very moment it had something to say - the Close with a kit running.
- **Fix.** The wrapper is `aria-live="polite"` and empty while no kit runs (`-mb-5` takes back the second `gap-5`), and `VideoStudio` mounts `ClipKitRunning` ahead of the open-or-closed conditional, so the region exists while the video is open; the card draws inside it for a run with no video open. Not `role="status"` (atomic: it would read the whole card at every phase).
- **Test.** video-pipelines.spec.ts "the card for a kit that outlives its video is announced from a live region that was already mounted": the region's handle is taken with a video open and no kit, and after Close it is the same connected element holding the card (red on the unchanged build: no such region); the 20 px gap before, during and after; the wiring pin (one return, one `aria-live`, mounted ahead of `{source ? (`); mutations: the live attribute dropped, the early return, the margin dropped.
- **Lesson.** **A live region has to exist before the event it announces, so ask where the COMPONENT is mounted, not only where the region sits in its file: a wrapper inside a branch that appears with the event is the same bug one level up.**

### (4) [LOW] - The running Clip Kit label wrapped mid-sentence

- **Bug.** At the default and the minimum window the running label ("Exporting platform version 2 of 5…") wrapped onto two lines (measured on the unchanged build by `expectOneLine`: 32 px of text height for a 16 px line), and the clip list jumped as the phase changed length.
- **Fix.** The label is `whitespace-nowrap` and the kit's column is the caption, the button and the Cancel, which has a row of its own under the button (as GIF, Compile, Picture-in-picture and Export have had since T-126 (20)). DESIGN_GUIDE names the four placements `RunningCancel` actually has (the progress row; a row of its own under the primary; the caption row where there is no primary; beside the primary in Audio Studio's export row, the one that is not a row of its own).
- **Test.** video-pipelines.spec.ts "the running label is one line at the default window and at the minimum ...": `expectOneLine`, `expectNoHorizontalOverflow` and the geometry (Cancel at or below the button, its right edge on the button's) at 1632 x 918 and 1024 x 640; mutations: the nowrap dropped, the Cancel back beside the button.
- **Lesson.** **A label that is a sentence is `whitespace-nowrap` in a column with room for it, not a wrap-friendly button in a row it shares: and "one line" is measured at the minimum window, because the default one always has the room.**

### (5) [LOW] - The preview copy's skip toast blamed a Close on "another video"

- **Bug.** A preview copy that finished after the video was closed said "because you opened another video" (`staleCaptionsMessage` had documented the same wording error for the transcript).
- **Fix.** `previewCopySkippedMessage(fileName)` in `shared/mediaFormats.ts`: "Skipped the preview copy for x.mov because the video was closed or replaced while the copy was being made". The store cannot tell a close from a replace (`setPreviewCopyFor` answers false for both), so the sentence is true of both and names the file.
- **Test.** `mediaFormats.test.ts` (the sentence, no "another video"), video-pipelines.spec.ts "T-137 (5)" (the copy held, the video closed; red on the unchanged build), the wiring pin; mutations: the sentence blaming another video, "replaced" alone.
- **Lesson.** **A sentence written for one trigger and shown for two says the wrong thing at one of them. When the code cannot tell the triggers apart, the sentence must be true of both; do not branch on a distinction the store does not hold.**

### Found, not fixed

- **A skipped extraction's scratch WAV stays in `%TEMP%` until the launch sweep** (the same as Clean audio's identical skip has always done): the renderer holds no `fs`, so the delete is a main-side helper.
- **`recording.ts`'s save run (`beginConvertRun`) is scoped to the take, and nothing observable depends on it today**: the save never calls `run.check()` or `guard`, so a mutant that registers every take's run under one id survives (the latch is the quit's drain count). It is scoped anyway so a future `check()` cannot reintroduce the sweep.

## 2026-10-24 — T-136 Track B (round 85): a rank that rewarded length, a sentence true at one moment and said at another, and a keyword read out of a file name

The twenty-second pass, Track B (items 9 to 15 of T-136; Track A's items 1 to 8 land beside it). Ledger: r85b/ledger.md (21 red rows and 84 mutation rows, 84 of 84 restores byte-identical; 8 mutants survived, each listed in the ledger's notes; every red a test run against the old product code, a build of the unchanged tree `47ef529` for the Playwright cases, or the real binary for Layer 5; item 15 at Layer 5 on both ffmpeg majors).

### (9) [LOW] - the chat spike finder ranked by length, showed half a range, accepted a negative pad, and said nothing when it found nothing

- **Bug.** (a) T-135 (3)'s merge made a row's length unbounded while the row showed only its start, and rows ranked by their SUMMED count, so a raid (twenty windows of 6 messages, 120 in all) outranked a short explosion (15 in one window) when the 12-row cap forced a choice and "+ Clip" could add a five-minute clip unannounced. (b) "Extra seconds around each clip" was `Number(v) || 0` with an advisory `min`: -5 made a window of zero length (executed: [105, 105]) and the "+ Clip" refusal blamed the log. (c) A log with no spike was a 4 s toast, and the panel then looked as if it had not been run. (d) The two number boxes sat 16 px apart where the long label wraps (measured at 1024, 1632 and 1920).
- **Root cause.** A row was ranked by an aggregate that grows with its length, where what makes it a spike is its densest window; a number box's `min`/`max` attributes were taken for a rule; "analyzed, nothing found" was drawn as nothing, the same as "not analyzed"; and two controls were positioned by their labels' heights.
- **Fix.** `findChatPeaks` ranks by the densest window (then the total, then time order) and keeps `count` as the total; the pad is clamped to 0..60 inside it (`MAX_CHAT_PAD_SEC`, NaN is 0). The panel's row shows start → end on one line with the preview on a second, the extra seconds is a `DraftField` with the spike window's 0..60 clamp (a fraction of a second is kept), `NO_CHAT_SPIKES_MESSAGE` (the rule, built from `MIN_SPIKE_MESSAGES` and `MIN_SPIKE_WINDOWS`) stays under the button for `derived.spikes === []`, and both boxes take `mt-auto`.
- **A second bug, found by the new layout case and fixed in the same item.** The row this item draws is wider than the one it replaced (a range, not a start), and the first layout case measured a 2 s video's short range and a 120-message count: green, with one pixel to spare at the 1024 px minimum (the card leaves the row 258 px: 122 for a 17-character range, 33 for "+ Clip", 86 for "120 messages"). A ten-hour stream's range (`10:01:25 → 10:05:15`) or a fourth digit in the count left "+ Clip" no room, and it wrapped onto two lines ("+" over "Clip") and ended 5 px past the row; the default 1632 px window has the same 258 px row. The first-line row is `flex-wrap` now (the button drops under the range, `ml-auto` keeps it at the right edge, the count's `whitespace-nowrap` makes the row wrap by item), and the case measures the widest row the panel draws and the list's own overflow (the list is `overflow-y-auto`, so a row wider than the list is a scrollbar the card's check never sees).
- **Test.** `chatPeaks.test.ts` (the raid against the explosions at the cap, the total kept, the tie-break, the densest window in the middle of a run, the clamp at -5, -1e9, 600, Infinity and NaN, the sentence tied to the constants and the constants to the function's edges); video-pipelines.spec.ts "ChatHighlightPanel - range, extra seconds, empty result, alignment" (four cases; the alignment one at 1024, 1632 and 1920 px, red on the unchanged build at 16 px lower at every size, and red again on this tree before the row fix at "+ Clip wraps onto 2 lines" and "-5 px from the row's right edge") and the six existing row pins now read "start → end".
- **Lesson.** **Rank a thing by the property that makes it that thing, not by an aggregate that also grows with its size. And when a state has two meanings ("not run", "ran and found none"), draw them differently: a toast is gone by the time anyone looks at the panel. And a layout case measures the WIDEST content the control can hold, not the fixture that is handy: it had one pixel of slack at three hours and none at ten, and the short fixture was green.**

### (10) [LOW] - "Remove it" over a track nothing had added

- **Bug.** The pick-time refusal reused the export's sentence, "The second track has no sound in it. Remove it or pick another file.", and the panel adds nothing when it refuses (the e2e pinned zero Remove buttons right after it).
- **Fix.** `SECOND_TRACK_PICK_NO_SOUND_MESSAGE` = "That file has no sound in it. Pick another file."; the export keeps its own words for a track that is added and loses its sound afterwards.
- **Test.** `audio.test.ts` (both sentences, finished, through the envelope); audio.spec.ts "a second track with no sound in it is refused when picked, and when the file loses its sound before the export" now asserts each sentence once and no "remove" at the pick. The other half of the pick's rule - only that verdict refuses, so a file whose length cannot be read (a MediaRecorder WebM) is still added - had no test: the expediter's mutation (refuse on ANY probe error) left the whole suite green, and audio.spec.ts "a second track whose length cannot be read is still added (T-135 (11) pick rule)" and a pin of the catch's condition in `interactionWiring.test.ts` now kill it (ledger `M-i10g`, `M-i10h`).
- **Lesson.** **A sentence that says what to do next is true of a state. Say it at the moment that state holds; one string reused for two moments says the wrong thing at one of them.**

### (11) [LOW] - "Last autosave: N ago" under "Autosave cleared"

- **Bug.** The dismissed state draws its status line from the `info` read when the page mounted; a successful Clear deleted the file and left the line up until the next visit to Home.
- **Fix.** A successful Clear sets `info` to `{ exists: false }`; a refused one touches nothing.
- **Test.** home-chrome.spec.ts "T-136 (11): the status line goes with the file" (healthy and damaged banner, in the same visit; the controls: Later keeps the line, a refused Clear keeps it).
- **Lesson.** **A line derived from a read made at mount is wrong the moment the action it reports on succeeds. The action that changes the source updates what is derived from it, on its success path only.**

### (12) [LOW] - two mood-board writes with no catch

- **Bug.** "Clear thumbnail cache" awaited `moodboard.clearThumbs()` bare (a refusal was an unhandled rejection and the button did nothing) and the tile's ✕ called `removeFromCollection` with nothing awaiting it. T-135 (8) had fixed the four writes beside them.
- **Fix.** `onClearThumbs` and `onRemoveItem`: the await in a `try`, the success toast inside it, `reportFailure` in the `catch`; a refused remove leaves the tile (the store changes after main answers).
- **Test.** `failurePathLanguage.test.ts` (both handlers, the toast's place, no inline `async` arrow in the JSX); references.spec.ts "a refused Clear thumbnail cache never says "cleared", and a refused ✕ says so and leaves the tile" (main's handlers replaced by ones that throw; the same ✕ with a working main is the control).
- **Lesson.** **When a sweep fixes writes in a file, grep the file for every `window.api` await, not the ones the ticket named: the sibling that was not listed is the next ticket.**

### (13) [LOW] - the one spawn nobody capped

- **Bug.** `audio/extract.ts` did `stderr += String(b)` with no cap, against the round-18 rule that every spawn keeps a 16 KB tail; T-129 made multi-hour extractions reachable.
- **Fix.** The tail idiom in the handler, and `tests/unit/stderrCapped.test.ts`: every `<x>.stderr.on('data', handler)` under `src/main`, read with the syntax tree, must assign the accumulator a tail of at most 16384 (or be a row in the table of audited exceptions, with its reason). The scan found four more uncapped handlers: the two ebur128 loudness scans (the stderr is the measurement), `ffmpeg -version`, and the two ffprobe header reads; the first three are audited as they are, the probes are listed as found, not fixed.
- **Test.** The scan (red on the unchanged tree: `extract.ts`), a discrimination block over sample code and over its accounting; mutations: the cap removed, 16 MB, a head slice, a slice whose result is thrown away, and nine of the scan itself.
- **Lesson.** **A rule applied spawn by spawn from memory misses one. The fix for a missed instance of a class is the scan that lists the class, and the scan's first run is its own audit of the instances nobody remembered.**

### (14) [LOW] - a file's name read as the cause of its failure

- **Bug.** `describeImportError` matched 'codec', 'decoder' and the rest anywhere in the message, and main's finished sentence "Still extracting the sound from "codec_test.mp4". Wait for it to finish, then try again." became "imagii can't read this audio format..." (executed).
- **Fix.** The keywords are looked for in the message with its double-quoted spans taken out; a lone quote removes nothing.
- **Test.** `importDiagnostics.test.ts` (eight names that hold a keyword, a clean-name control, and the controls that a real cause is still found: beside a quoted name, between two, after a lone quote).
- **Lesson.** **A classifier that reads free text must not read what the person typed. Judge the part of the message the program wrote.**

### (15) [LOW] - a compilation whose first segment was lost blamed the person's source

- **Bug.** `concat.ts` guarded the lost-segment sentence with `code === 0 && lostAPart`. The concat demuxer exits 0 for a LATER input it cannot open and non-zero (254, both majors) for the FIRST, so that case reached the person as the raw "concat exit 254" and then as the generic missing-file sentence, about their source.
- **Fix.** The guard is the line, whatever the exit code (`if (lostAPart)`), still through `cancelledOr`, so a join the user killed is a cancel.
- **Test.** `concatRunner.test.ts` (the fake ffmpeg takes an exit code: a lost first segment at 254, 1, 255 and 234, a later one at 0 and non-zero, the control without the line, the control that succeeds, a Cancel that wins); Layer 5 "a compilation whose FIRST segment is lost at the join names its clip" on both majors (the shape with the real binary, and the real `runConcat` with segment 0 deleted between the list and the join; red on the unchanged tree on both).
- **Lesson.** **An exit code is not the evidence; the line the program printed is. When one cause has two exit shapes, key the guard on the cause.**

---

## 2026-10-24 — T-136 Track A (round 85): a run keyed to a row the list does not draw, a busy flag the remount forgot, a debounce a playing video starved, and a Cancel copied eleven times

The twenty-second pass, Track A (items 1-8, expediter-ticketed; Track B's seven are logged separately). The theme: the edges of T-135 (1) - the long jobs its module-store conversion did not reach, and a premise it introduced. Ledger: r85a/ledger.md (20 red rows and 71 mutation rows, 71 of 71 restores byte-identical; 2 mutants survived their first run, M-i3b and M-i6b, each killed on a rerun after the test was strengthened and both rows kept; no Layer 5 block is touched by this track; every red a test run against the old product code or, for the Playwright cases, a build of the unchanged tree `47ef529`).

### (1) [MED] - a running Clip Kit could become uncancelable

- **Bug.** The Clip Kit's run was keyed by `clipId`, its Cancel rendered only for the owning clip, and the clip list draws ONE kit button (for the selected clip). Selecting another clip put the kit's progress and Cancel behind a disabled button with an idle label and a title that gave no reason; removing the owning clip, or closing the video, left every kit button disabled and no Cancel anywhere until the kit ended minutes later (only quitting stopped it).
- **Root cause.** T-135 (1) moved the run into a store and wrote down a premise - "one button per row" - that the list had never made true. A comment, a guide sentence and an end-to-end pin all repeated it, so the three of them agreed with the bug.
- **Fix.** The run carries the clip it was started on (`clipId`, `clipName`); the kit button shows the running kit (its label and, above it, `Clip Kit for "<name>"`) with its Cancel whichever clip is selected, and starts nothing; `ClipKitRunning` draws the same line and Cancel in a card beside the importer once the video is closed. The Cancel and its question are one component that exists only while a kit runs, so the question cannot outlive the run.
- **Test.** video-pipelines.spec.ts "T-136 (1)" (another clip selected, the owning clip removed, the video closed: each cancels through the confirm and reads the exact sentence; all red on the unchanged build) and the T-135 case whose pin was FLIPPED (it asserted an idle label and no Cancel on the other clip); `kitRunCaption` in `clipKit.test.ts`; the wiring pins.
- **Lesson.** **A pin written from a premise proves the premise, not the product. When a bug report says "the control is gone", look for the test that asserts it is gone and ask who wrote that expectation down - and render from the thing that owns the state (the run), not from a row the UI may never draw.**

### (2) [MED] - a conversion could run twice, and its late landing replaced the video being edited

- **Bug.** The Importer's flv / ts / wmv / mpg transcode and the Player's "Make a preview copy" kept their busy state in the component, and main's `video:convertForImport` had no single-flight. A trip to Home re-armed both: two libx264 converts at once (executed), and the Importer's second landing replaced the video the person was editing - 2 edited clips reset to 1, with no confirm, and loading cannot be undone. The preview copy's playhead was restored from the unmounted Player's refs, so the picture restarted at 0:00.
- **Root cause.** The same as T-135 (1) - state about a job in a component - at three sites T-135 did not reach, plus a landing that never asked what was open now (T-112's `replacedSince` rule, applied to project opens and Clean audio, not to the Importer).
- **Fix.** One guard where every caller goes through: main's handler holds one conversion slot (`audio:extractFromVideo`'s shape - claimed before the first await, given back in a `finally`, a finished sentence naming the file). Run slots in the module store for the Importer (`useImportRun`) and the preview copy (`usePreviewCopyRun`), so a returning panel draws the busy state; the Importer's landing asks `replacedSince` and, if a video arrived meanwhile, loads nothing and says "Skipped <file> because you opened another video while it was converting"; the preview copy's playhead is read when the copy is swapped in and travels with it in the video store (`previewResumeAt`).
- **Test.** `videoConvertSingleFlight.test.ts` (nine cases through the real handler), `ProjectIO.test.ts` (main's refusal reaches `loadReporting` as a finished sentence, not as a missing file - green on the unchanged tree by design, it pins what the existing code already does with the new refusal), `videoStore.test.ts`; video-pipelines.spec.ts "T-136 (2)" (four cases: the importer after a trip to Home with main's refusal read through the real bridge, a project opened during a conversion keeps its video and its two clips, the preview copy after a trip, the preview copy finished while away resuming at 0:01).
- **Lesson.** **A guard that protects a shared resource goes in the shared function, not in each caller's UI state; and anything that lands after a wait asks what is open now, not what was open when it started.**

### (3) [MED] - autosave never fired while anything played

- **Bug.** `useAutosave` subscribed a 5 s debounce to whole stores, and the Player writes `currentTime` on every `timeupdate` (about four a second) and the waveform on every `audioprocess`: the timer never elapsed while playback ran, so clips marked during a long review were not on disk until it stopped for 5 s, against the guide's and the crash screen's "every few seconds".
- **Root cause.** A trailing debounce has no ceiling, so any field that changes faster than its period starves it; a subscription with no selector listens to every field.
- **Fix.** The video subscription skips a change to nothing but the playhead (`currentTime`, the Player's `transport`, a `seekRequest`) and the audio one a change to `currentTime` (`playheadOnlyChange`), and the debounce is `createSaveScheduler`: a burst is one write 5 s after its last change but never later than 30 s after its first. The hook's effect is `startAutosave`, a plain function, so a test can drive the real stores on a fake clock.
- **Test.** `useAutosave.test.ts` (an edit followed by 60 s of 250 ms playhead updates writes within 6 s; playhead-only churn writes nothing; churn on a field that is work writes by 30 s and again every window; the single-edit and hold behavior unchanged).
- **Lesson.** **A debounce wants a ceiling the moment its input can be a stream, and a subscription wants a selector the moment the store has a field that is not "work". Make the effect a plain function: a hook that cannot be mounted in the test layer gets no timing test.**

### (4) [LOW] - the caption-model download lost its bar and Cancel on a round trip

- **Bug.** `installing` / `installProgress` were `useState` (and the progress listener an effect), so a trip to Home came back with no bar, no Cancel and Download re-enabled (main refused the second press); the finishing closure refreshed the status of the panel that was gone, so Transcribe reopened the setup over an installed model. INTERACTION_COVERAGE said the panel disabling its button made a second request impossible.
- **Fix.** The download is a run in the module store (`useModelInstallRun`, with a listener that lasts exactly the download) and the engine / model status is the store's (`useCaptionsStatus`, written by whoever asked); a panel that mounts over a running download opens its setup card, where the bar and Cancel are.
- **Test.** video-pipelines.spec.ts "T-136 (4)": `net.request` replaced in main by a download that reports progress and never ends (the real handler and the real partial file), leave and return, Cancel; and a download that ends after the person came back. The ledger row is corrected.
- **Lesson.** **A closure that finishes after its component is gone must write somewhere the next component reads. "The panel disables its button" is a claim about one instance, not about the job.**

### (5)-(6) [LOW] - a notice that may not be announced, and a black box captioned "Live snapshot"

- **(5)** The Player's preview-unavailable note had its `role="status"` mounted together with its content, the pattern GifPanel documents as not reliably read: an always-mounted wrapper (`-mb-3` while empty) now holds it. **(6)** The Output preview mirrors the Player's element onto a canvas, so a picture the Player cannot draw left it black under "Live snapshot at the playhead position..."; the Player's verdict (`noPicture`) is the video store's now, and the card says "No snapshot to show: imagii can't preview this video's picture format. Your exports are not affected." until a preview copy exists.
- **Test.** The wiring pin (5); video-pipelines.spec.ts "T-136 (6)", `OutputPreview.test.tsx`, `videoStore.test.ts` and `mediaFormats.test.ts` (6). The first mutation of the e2e (drop "and no preview copy exists" from the condition) SURVIVED: the Player clears its verdict when the copy loads, so the final state is the same with or without the clause, and the clause only matters for the beat between the copy landing in the store and the element reporting. The case now arms a DOM observer before the press and asserts the note is never on screen once the `<video>` is on the copy (killed), and a rendered unit test pins the same beat.
- **Lesson.** **A fact one component learns and another needs belongs in the store between them; a live region has to exist before it speaks.**

### (7)-(8) [LOW] - the Cancel of a running job, hand-written eleven times; "Cancel PiP composite"

- **Bug.** Eleven places wrote their own Cancel and two had drifted off the pattern (the audio export's was a plain gray box with no danger ink and no title; the Clip Kit's a hand-rolled bordered one; the model download's a bare cross), six drew the same progress track by hand, and one title said "PiP", the only place the product did.
- **Fix.** `components/RunningCancel.tsx` and `components/ProgressTrack.tsx`, used at every site; the title is "Cancel picture-in-picture composite"; STYLE_GUIDE "Shared affordances" and DESIGN_GUIDE say it.
- **Test.** `RunningCancel.test.tsx`, `ProgressTrack.test.tsx`, and `runningJobControls.test.ts`, a scan that fails on a hand-written Cancel button outside a `Modal` and on a `role="progressbar"` outside the track and its two decided exceptions (shown to discriminate: the eleven copies fail it on the unchanged tree, and putting a copy back is red).
- **Lesson.** **STYLE_GUIDE's "write it a third time, extract it" was in the guide for eleven copies. A rule that lives only as a sentence is a suggestion; the scan is what makes the twelfth copy fail.**

---

## 2026-10-24 — T-135 (round 84): a job that lived in the panel's state, a preview that said nothing, and a guard that answered for the click instead of the state

The twenty-first pass (14 items, expediter-ticketed). Ledger: r84/ledger.md (58 red rows and 133 mutation rows, 133 of 133 restores byte-identical; 6 mutants survived their first run, each either killed on a rerun after the test was strengthened or killed by a unit test at another layer; every red a test run against the old product code, a build of the unchanged tree `2b0f717` for the Playwright cases, or a content-replace mutation of the finished code with a sha256 triple; every restore byte-identical; items 11 and 12 at Layer 5 on both ffmpeg majors).

### (1) [MED] - leaving a studio mid-job lost the job's state and its Cancel

- **Bug.** The long-job panels (Reframe, GIF, Compile, PiP, Scan VOD, Captions, Clip Kit, Clean audio, the Export batch, the audio export) kept their busy flag, their job id and their rows in `useState` / `useRef`, and their progress listeners in an effect. A trip to Home unmounted all of it: the panel came back idle with its primary button enabled over a job main was still running, no Cancel anywhere (USER_GUIDE promises one), and a retry hit main's "An export is already running". Clean audio's button state was the studio's, so a second press ran a second concurrent extraction.
- **Root cause.** A job's lifetime is longer than a screen's, and the state that describes the job was given the screen's lifetime.
- **Fix.** The run is a module store (`lib/runStore.ts` + `video-studio/store/runs.ts`; `store/exportQueue.ts`; `audio-studio/state/audioExport.ts`): the closure that runs the job writes to the store after its panel is gone and a remounted panel draws what is there. `begin()` is the claim (before the first await), `end()` is in a `finally`. Clip Kit's run records the clip that owns it, so only that row shows the label and the Cancel and the others are off. Main's `audio:extractFromVideo` is single-flight and refuses a second start in a sentence that names the video that is running. While writing the Export store a real race showed up that the old always-on listener had hidden: the batch's job-complete event can be dispatched AFTER the call has resolved, and a listener that lasts one batch is already gone, so the rows stayed at 100% with no file and no "Show in folder"; the rows now also take each file from the batch's own results.
- **Test.** `runStore.test.ts`, `exportQueue.test.ts` (including the late event), `audioExport.test.ts`, `audioExtractSingleFlight.test.ts`, the T-135 wiring pins; video-pipelines.spec.ts "Leaving a studio mid-job (T-135 (1), (4))" (eight cases, red on the unchanged build) and audio.spec.ts "an export that is running when the person leaves Audio Studio ..." and "an export that ends while the person is away ...". Two older cases pinned the old shape and were revised, not deleted: the T-111/T-112 "pressing Export again after leaving Video Studio" case (a returning panel that believes nothing runs) became "there is no Export to press, and Clip Kit, the other door, is refused by main", and the first full Playwright run caught the T-89 captions-progress case, which sends the engine's events from main with no job running: the progress line is its own store, not a field of the run.
- **Lesson.** **State that describes a job outlives the screen that started it, or the screen lies when it comes back. Ask of every `useState` in a panel that starts something slow: "what is true of this when the person is on another screen?" And a listener that lasts exactly one call must not be the only way the call's result reaches the UI: events and replies race, so the reply carries the record.**

### (2) [MED] - a video the preview cannot decode was a silent dead end

- **Bug.** ProRes, some H.265 and 10-bit files load in the `<video>` element with `videoWidth` 0, `readyState` 4, no `error` event and a `play()` that resolves (measured in this Electron). Play flipped to Pause over a black rectangle, with nothing said; README promised "H.264, H.265, VP9, ProRes, AV1 in any common container should work".
- **Fix.** The Player hears the element's three signals (the `error` event, codes 3 and 4; `play()` rejected as `NotSupportedError`; the metadata tell: width 0 for a file ffprobe says has a picture), `togglePlay` follows the `play()` promise, and a note under the picture says what still works with a "Make a preview copy" button through the importer's own convert. The copy is `previewUrl` in the video store, not a swapped `source`, so exports, projects and the `replacedSince` identity keep the original. README narrowed.
- **Test.** video-pipelines.spec.ts "Player — a picture the preview cannot decode (T-135 (2))" (a real ProRes fixture), `videoStore.test.ts`, `mediaFormats.test.ts`, the wiring pin.
- **Lesson.** **An element that stays quiet has not said yes. The Player's error listener alone would never have heard this file; measure what the element does with the worst file you can make before deciding which signals to listen for.**

### (3) [MED] - the chat spike finder never merged neighbouring buckets

- **Bug.** A spike over three buckets listed as three rows, two of them heads of the same moment, each with its own padding.
- **Fix.** `findChatPeaks` (`shared/chatPeaks.ts`): buckets whose unpadded keys are adjacent merge, and a row runs from the first bucket minus the padding to the last bucket's end plus the padding.
- **Test.** `chatPeaks.test.ts`; video-pipelines.spec.ts "three adjacent hype buckets are ONE row, and + Clip lands the whole spike with its padding".
- **Lesson.** **Merge on the keys you bucketed by, not on the padded windows: padding makes any two nearby buckets overlap and the merge swallows quiet gaps.**

### (4) [LOW] - derived results died when the studio was left

- **Bug.** A scan's candidates, the pasted chat logs, the spikes found in them and the transcript preview were panels' `useState`; every visit to Home emptied them.
- **Fix.** They are `derived` in the video store (`setDerivedFor` drops a result that arrives after the video was replaced; load and close empty them).
- **Test.** `videoStore.test.ts`; video-pipelines.spec.ts "scan candidates, pasted chat logs and found spikes are still there after a trip to Home, and a different video starts clean". The transcript preview has no end-to-end case (it needs the speech engine; INTERACTION_COVERAGE says so).
- **Lesson.** **A result belongs to the thing it was computed from. If the thing outlives the screen, so does the result, and the store that holds the thing is where it lives.**

### (5) [LOW] - the corrected-query fix was Enter-only, and the box could be blank over a grid

- **Bug.** The Search button was `disabled={loading}`, so a pointer or voice-control user could not send the correction Enter could; and the input was panel state while the grid was store state, so Mood Boards and back drew the grid over an empty box.
- **Fix.** The store holds the newest request's query (`searchQuery`); the button is off only when loading and the typed text equals it; the input starts as it.
- **Test.** `referencesStore.test.ts`, the wiring pin; references.spec.ts "a corrected query is sent BY CLICK while the typo is out, and the box names the grid after a trip to another tab".
- **Lesson.** **When a guard learns to tell "the same question" from "a different one", every entry point has to learn it, not only the one the bug was found through.**

### (6)-(8) [LOW] - a zone line that scrolled sideways, a confirm that over-claimed, writes that failed silently

- **(6)** The safe-zone warning's zone lines carry a custom preset's name and were plain divs (474 and 977 px against 406): `truncate` and a `title`. **(7)** "Clear saved transcripts" said it would delete the open video's transcript whether or not it had one (`clearTranscriptsQuestion`, conditional copy). **(8)** Board create / rename / delete / save and preset save / delete were bare awaits, the first-save dialog closed before the create landed, and the name boxes had no cap although main enforced 200: each reports a sentence and keeps what was typed, the dialog closes after the board exists, `MAX_BOARD_NAME` is one number.
- **Test.** video-pipelines.spec.ts (zone lines, Clear transcripts, the preset refusal), references.spec.ts (the cap, the refused first save, the refused create and rename), `captions.test.ts`, `failurePathLanguage.test.ts`, the wiring pins.
- **Lesson.** **A write the other side can refuse needs a sentence and must not throw away what the person typed. And a number main enforces is exported once, so the box cannot disagree with it.**

### (9)-(10) [LOW] - two loads that trusted what they had been handed

- **(9)** Opening a project or restoring an autosave replaced a sound the person opened during the video's wait; two of the three closures were unguarded (`replacedSince`, by identity, on all three). **(10)** An unknown preset id in a project's clip survived validation and killed Export at the batch; unknown ids are dropped on the way in, with the rest of the file kept.
- **Test.** `ProjectIO.test.ts` (the plain path was the red-first case), `projectValidation.test.ts`.
- **Lesson.** **A guard added to one of three sibling closures is a guard on one of three. Grep the siblings when you add it, and drop (do not refuse the file for) a value the build no longer knows.**

### (11)-(12) [LOW] - two audio exports that said the wrong thing

- **(11)** A second track with no sound failed late, at ffmpeg's `[1:a] matches no streams` (exit 234), and the sentence blamed the primary file. It is probed when picked and again at the top of `exportAudio`, in its own sentence. **(12)** A chain whose cuts remove everything exits 0 from ffmpeg with a header-only file (78 bytes of WAV, about 257 of AAC, about 620 of MP3, measured on both majors) and "Cleaned audio exported" was said over nothing; an export that keeps less than 0.05 s is refused before ffmpeg is spawned (`cutsLeaveNothing` reads the unfloored length, because `keptDurationSec` floors at 0.1 s).
- **Test.** Layer 5 `media.spec.ts` "T-135 (11)" and "T-135 (12)" on the bundled 7.0.2 and the distro's 6.1.1; `chain.test.ts`, `audio.test.ts`, `exportProgress.test.ts`; audio.spec.ts "a second track with no sound in it is refused ..." and "a chain that cuts the whole file is refused ...".
- **Lesson.** **A success exit code is not a success: when the input can be empty, pin the exit-0-empty shape against the real binary. And a floor that exists for one purpose (a duration that is never zero) must not be reused as a test for another (nothing is left).**

### (13), (14) - a navigate after a wait, and a stale comment

- **(13)** "→ Canvas" awaits the picture's load (a network fetch for a tile whose cached thumbnail is gone) and navigated to `/image` wherever the person was; it now navigates only if `currentRoute() === '/references'`, read after the await. The layer and the toast are not behind the guard. **(14)** The stale comment at `home-chrome.spec.ts:1226` says what the case does.
- **Test.** references.spec.ts "→ Canvas that finishes after the person went to another screen ..." (the load is held by parking the page's `HTMLImageElement.src` setter), the wiring pin.
- **Lesson.** **The T-132 (1) and T-134 (1) rule again, at one more site: any `navigate` after an `await` asks where the person IS. Grep for `navigate(` after every await when a wait can be long.**


### Found while gating - a toast log read once, right after the waveform

- **Bug.** audio.spec.ts "a recording whose header has no duration (a MediaRecorder WebM) imports ..." read the toast log once, as soon as the waveform and the Play button were up, and expected "Loaded" in it. The toast is raised a few milliseconds after the waveform is drawn, so the case failed about one run in three (4 of 12 on the unchanged build, 2 of 8 on this one) and failed once in this ticket's second full Playwright run.
- **Fix.** The case waits for the toast (`expect.poll` over the log, 15 s) and then reads the log for the negative assertion. The assertions are the same; only the wait is new.
- **Test.** The case itself: 0 failures in 20 standalone runs after the change.
- **Lesson.** **A log that is read once is a snapshot, not a wait. When a case asserts an event is IN a log, poll for it; a one-shot read is only right for "nothing was logged" after the thing it is waiting for has been seen.**
---

## 2026-10-24 — T-134 (round 83): a table that blessed a premise of the click, a held key that was a hundred decisions, and a guard that refused the question that had changed

The twentieth pass (7 items, expediter-ticketed). Ledger: r83/ledger.md (every red a test run against the old product code, a build of the unchanged tree `eed3101` for the Playwright cases, or a content-replace mutation of the finished code with a sha256 triple, every restore byte-identical; item 4's Layer 5 pin on both ffmpeg majors). The items that taught something:

### (1) [MED] - the autosave Restore navigated after a wait the person had spent elsewhere

- **Bug.** `AutosaveRestore.restore()` awaits `applyProjectHeld` (minutes, when a long recording's sound is extracted again) and then called `navigate(snapshot.place.route)` wherever the person was by then. `navigate` still works from a component that unmounted, so a person who went to Record and started a take was taken to /video, which unmounted RecordStudio, whose cleanup stops the tracks: the take was cut (executed by the sweep in a built app: a 14 s held extraction, Restore, a take started; the hash became `#/video` and Stop was gone). Four reviewers found it independently. It was the T-132 (1) / T-133 (1) class at the one site left, and T-133's own navigate table had listed it as safe with the comment "The autosave Restore is on Home."
- **Fix.** After the await, `if (route && currentRoute() === '/home') navigate(route)`: a person still on Home gets the continuity Restore promises; anyone else keeps their screen, and "Restored from autosave" already says it is done. The table's comment now says why the old one was wrong.
- **Test.** record.spec.ts "an autosave Restore that finishes after the person went to another screen leaves them there, and a live take runs on" (red on the unchanged build: `Expected: "#/record" Received: "#/video"`); continuity.spec.ts keeps the other half (a person still on Home IS taken to the studio); the wiring pin holds that the read comes after the await.
- **Lesson.** **A review table that decides a set of call sites by one sentence of rationale ("it is on Home") has decided them at the moment of the click. For anything that awaits before it acts, the premise has to hold at the act, so the rationale must name the await.** The table existed to make a new exit fail until it was decided; it did, and the decision was wrong because it was made about the press and not about the navigate.

### (2) [LOW] - a held I or O re-set the marker on every auto-repeat

- **Bug.** T-133 (7b) made Space one decision per press and left the markers: a held I or O ran `setMarker` on each auto-repeat (about 30 a second), and each is an undo step, so 60 repeats filled the store's 50-step history and evicted real edits (executed against the real store: three `addClip` edits became un-undoable), and during playback the in point drifted to the last repeat's frame.
- **Fix.** `if (!e.repeat)` on the i/o cases in the Player and the Timeline, exactly as Space got it; `preventDefault` still runs on a repeat; the nudge and frame-step keys still repeat.
- **Test.** video-core.spec.ts "a held I or O marks once: one Undo takes it back, in the Player and on the Timeline" (the witness is Undo: after four keydowns of one held key ONE Undo takes the point back to where it started; red on the unchanged build: `Expected: 0 Received: 0.5`); the wiring pins.
- **Lesson.** **When a fix makes one key of a family "a decision per press", the same sentence has to be asked of every key in the family. A held key is a decision per auto-repeat unless something says otherwise, and the cost of the wrong answer is not the extra work, it is what the extra work pushed out of a bounded history.**

### (3) [LOW] - the single-flight search discarded a CORRECTED query

- **Bug.** T-133 (8) refused every press while a request was out, to stop a held Enter sending duplicates. A person who typed, pressed Enter, saw a typo and corrected it was silently refused, and the typo's answer then filled a grid that no query on the page named. The pinned drop-test called that intended.
- **Fix.** The guard refuses the SAME query only (a held Enter is one request); a different query goes out at once; each request takes a number and only the newest request's answer, failure and idle state are drawn (an older one is dropped, but its failure is still logged). The ticket's other option, one follow-up after the flight, would have made a person on a slow connection wait for the typo and then for the correction.
- **Test.** `referencesStore.test.ts` (the drop-test flipped; the typo is never drawn, even for a moment, whichever answers first; a typo's failure leaves no error over the newest search); references.spec.ts "a held Enter is one request, a corrected query is answered, and the typo's late answer never replaces it" (red on the unchanged build: the corrected query was never asked).
- **Lesson.** **A single-flight guard has to say what "the same" means. "Anything while one is out" is the cheapest thing to write and refuses the one request that mattered most; "the same question while it is out, and the newest question owns the answer" costs a counter and is what the person meant.**

### (5) [LOW] - a long unbroken name pushed Delete out of its dialog

- **Bug.** A saved preset's name was drawn whole in a flex row with nothing to give: an 80-character spaceless name put Delete at x=905 against a card that ends at 848 (measured in real Chromium; the threshold is about 72 characters). The safe-zone warning listed a clip's name the same way, in a box that scrolls sideways once a line is too long.
- **Fix.** The names are cut with an ellipsis and carry the whole name as the tooltip (the DESIGN_GUIDE chip rule); the numbers and Delete do not shrink; the name box takes at most 60 characters.
- **Test.** video-pipelines.spec.ts "a very long unbroken preset name is cut with an ellipsis and Delete stays inside the dialog ..." and "a clip with a very long unbroken name is cut with an ellipsis in the safe-zone warning ..." (geometry at the default window and the 1024 px minimum; the long names are WRITTEN to disk, because a cap on the box does not shorten what is already saved); the wiring pin and `a11ySweep.test.ts` rule 6.
- **Lesson.** **A cap on an input is not a layout fix: the layout has to survive whatever is already stored, so the test writes the long value past the input.**

### (7) [LOW] - Clear relabelled Restore

- **Bug.** The banner's two buttons shared one busy flag, so pressing Clear showed "Restoring…" on Restore for the unlink's duration: a word about an action nobody took. The T-133 (9) ledger row had called that intended.
- **Fix.** A flag per button (`restoring`, `clearing`); either one running still dims both, since they act on one file.
- **Test.** continuity.spec.ts "Clear does not relabel Restore ..." (main's clear is held open; red on the unchanged build: `Expected: "Restore" Received: "Restoring…"`); the wiring pin.
- **Lesson.** **A label that describes a state belongs to the flag for that state. One flag shared by two buttons can only be right for one of them.**

### (4), (6) - three documentation claims the code contradicted

- **(4)** `noPicture.ts` and STYLE_GUIDE said a compilation's segments close on `wroteNoPicture(sawEmptyOutput, frames)`; `concat.ts` reads the stderr line alone. The runtime worry (an audio-only segment slipping through `-shortest`) was measured on both majors by three parties and does not happen: a segment ends in `apad` + `-shortest`, so a range past the picture is a streamless ~970-byte stub and the line is printed. The sentences were corrected, the `docClaims` pin that held the over-claim now holds the correction, a scan lists the callers of `wroteNoPicture` (the T-133 (4) lesson, "every X does Y" is unverified until something lists X, applied to its own fix), and a Layer 5 case pins the 5 s picture / 9 s sound shape on both majors. "Ran up to 81 px OUT" became "by as much as the name was long": the ledger's own red measured 228 px, so "up to" was never a bound.
- **(6)** The native-dialog inventory was stale three ways (a confirm that moved files, line numbers that drifted, a confirm with no row). It is refreshed, and a `docClaims.test.ts` scan now reads it against the renderer: every native `confirm` / `alert` / `prompt` call has a row at its line and every cite points at a line that still holds one.
- **Lesson.** **A table of file:line cites is a claim about the tree. Re-pointing it by hand fixes it for the length of one sweep; a test that parses the table and the source fixes it for good.**

---

## 2026-10-24 — T-133 (round 82): the fix's own button that cut the take it protected, a tolerance borrowed from the wrong side of a failure, and a guess about how long a human holds a key

The nineteenth pass (11 items, expediter-ticketed). Ledger: r82/ledger.md (every red a test run against the old product code or a content-replace mutation of the finished code with a sha256 triple, every restore byte-identical; the e2e reds were run against a build of the unchanged tree at `d90c01b`; item 4 on both ffmpeg majors). The items that taught something:

### (1) [MED] - T-132's "Open Audio Studio" toast action navigated off a live take with no question

- **Bug.** T-132 (1) stopped Clean audio from moving a person off a running take and put an "Open Audio Studio" button in an 8-second toast instead. That toast sits over the REC screen, and the button was a bare `navigate('/audio')`: one click unmounted RecordStudio, whose cleanup stops the tracks, and cut the take: the failure the fix existed to prevent, through the fix's own exit. The saved-file toasts' "Edit in Video Studio" had the same shape, older and less likely (the next take has to be started inside its 8 seconds).
- **Fix.** Record REGISTERS a live take for as long as its phase is "recording" (`lib/liveTake.ts`), and every way off that screen asks `mayLeaveLiveTake()` first: the Home link (its question, word for word, now lives once), the toast's button, and the "Edit in Video Studio" bridge. OK stops the take (its normal save runs on Record) and Cancel keeps recording; either way the caller does not navigate now. A scan holds the set of renderer `navigate()` calls to a decided table.
- **Test.** record.spec.ts "a toast's way off the Record screen asks first while a take is live ..." and "\"Edit in Video Studio\" pressed while the next take is live ..." (red on the unchanged build: no dialog); `liveTake.test.ts`; the wiring pins.
- **Lesson.** **A fix that adds an exit has to ask what the exit does to the thing the fix was protecting; and a toast outlives the screen that raised it, so the screen's own guard on its own exits is not a guard on the exits its toasts carry.** Register the thing to protect where every exit can ask, not in the one exit you were looking at.

### (5) [LOW] - the success path borrowed a tolerance that is only safe on the failure path

- **Bug.** `wroteOutput` (is there a real file at the path?) reused `discardPartialOutput`'s "not older than the spawn, with 2 s of slack" to tell this run's file from an earlier one's. On the discard path an error in that test keeps a leftover file ("a leftover file, never a lost one"); on the success path the same error refuses a GOOD thumbnail as "no picture" and aborts the kit, on a share whose clock runs more than 2 s behind.
- **Fix.** `wroteOutput` asks only for a non-empty regular file, with no clock; what made the clock necessary (an earlier file at the path) is made impossible instead: the thumbnail goes into a fresh `makeKitDir` folder and `extractFrame` refuses a target that already exists, before ffmpeg runs.
- **Test.** `noPicture.test.ts` (a fake ffmpeg whose JPEG is stamped a minute in the past is a success; a file already at the path is refused and left alone), `partialOutput.test.ts` (`wroteOutput`).
- **Lesson.** **A tolerance has a direction. Slack that makes a delete conservative makes a check liberal or strict depending on which side of the failure it sits, so a helper that serves both sides is wrong on one of them. Prefer removing the ambiguity (a fresh folder, a refused collision) to measuring it with a clock.**

### (7a) [LOW] - a held Enter on Done reopened the tour, and a fixed window would not have helped

- **Bug.** A held Enter on the tour's Done closes it with its first press; the focus trap puts focus back on the "?" that opened it, and the key's auto-repeats are keyboard clicks on that button (`detail` 0, so no click rule can tell them from a decision). The tour reopened. The Fix wizard's Apply -> "Help me fix this" is the same shape. The ticket's direction was a capture-phase keydown that cancels repeats for `REPEAT_SWALLOW_MS` (500 ms).
- **Fix.** The first repeat arrives after the OS's repeat delay (250 ms to 1 s on Windows), so a window starting at the close can lapse before it. The guard is on the key: `createHeldKeyGuard` tracks which of Enter and Space are down (listening from the moment the module loads, because it has to see the key go down) and, when a dialog closes, swallows the repeats of those until they are let go. A fresh press, a key-up and a window blur clear it.
- **Test.** home-chrome.spec.ts "a held Enter on Done closes the tour once ..." (the repeats arrive 800 ms after the press; a 500 ms-window variant of the guard is a mutation it kills) and audio.spec.ts for Apply; `repeatPress.test.ts`.
- **Lesson.** **A fixed time window is a guess about a human. When the real condition is "while this key is held" or "until that finished", track the condition; and write the test with the human's delay in it, not with the fastest timing the test runner can produce.**

### (4), (6), (8), and the rest

- **(4)** The ranged caption burn-in was the one ranged video writer left without the no-picture guard (T-131 (1), T-132 (4) had both said "every runner"; the claim was a comment, not a scan). It resolved on `code === 0` and said "Captions burned in" over an audio-only file; Layer 5 on both majors now holds it. **A claim of the form "every X does Y" in a comment is unverified until something lists the Xs.**
- **(6)** Clean audio asked "Replace the audio you're editing?" once, before a wait of minutes, and `replacedSince` compared only the FILE: work tuned on the open file during the wait was replaced with no way back. It asks again after the wait, but only when the chain is no longer the one the person said yes about (the ticket's "when `confirmAudioClose` would now ask" would have asked a second time about work they had just agreed to lose). **Ask again about what changed since the answer, not about everything.**
- **(8)** Reference Search's button was `disabled={loading}` and the input's Enter was not; the guard went in the store's `search`, the function every entry point calls, so a stale render closure cannot let two presses through. **Put a single-flight guard in the shared function, not in one of its callers.**
- Also fixed: (2) toast text escaped its card on a name with no break (`overflowWrap: anywhere`); (3) `clipNameForSentence` cut by UTF-16 unit and could leave half an emoji (code-point cut); (7b) Space and `?` toggled on every auto-repeat; (9) five disabled buttons drew like live ones (a syntax-tree scan now holds the claim "every disabled button is dimmed"); (10) the waveform refusal's advice was circular for a WAV; (11) three documentation lines.

## 2026-10-24 — T-132 (round 81): a completion that navigated from a screen the person had left, an exit code taken for a verdict (again), and a "Loaded" that landed before the work it announced

The eighteenth pass (the sweep's verified findings, expediter-ticketed; 14 items). Ledger: r81/ledger.md (every red a test run against the old product code or a content-replace mutation of the finished code with a sha256 triple, every restore byte-identical; the e2e reds were run against a build of the unchanged tree). The items that taught something:

### (1) [MED] - Clean audio's completion took the person to Audio Studio wherever they were, and from Record that cut a live take short

- **Bug.** `cleanAudioFlow` ended with `navigate('/audio')`. The extraction takes minutes for a long recording and nothing locks the app meanwhile, and react-router's `navigate` keeps working from a component that unmounted (`activeRef` is set once and never reset). A person who had gone to Record and started a take was moved to Audio Studio when the extraction ended: RecordStudio unmounted, its cleanup stopped the tracks, and the save dialog opened over the wrong studio. Executed on the unchanged build: the toast log read `Opening Audio Studio`, then `Saved 0.1 MB` for a take that was meant to run on.
- **Fix.** After the wait, the function reads where the person IS (`currentRoute()`, the router's own hash, exported from `ProjectIO.ts`). On `/video` it navigates as it always did; anywhere else it keeps their screen, the sound is loaded, and a toast offers the way there (`toastWithActions`, "Open Audio Studio"; on `/audio` itself, no button).
- **Test.** record.spec.ts "Clean audio finishing during a live take does not move the person or cut the take short" (the extraction is held 14 s while a take is started: the clock keeps counting, the take is saved whole); video-pipelines.spec.ts "Clean audio finishing while the person is elsewhere ..." (Stream Graphics and Audio Studio); `currentRoute` and the wiring in unit tests.
- **Lesson.** **A handler that outlives its screen must ask where the person is when it ends, not where they were when it began.** `navigate` is not a no-op after unmount, and neither is any other call made through a closure of the old render. T-125 (20) asked "did they open something else"; this is the same question about the screen.

### (2) [MED] - a merge resolution reverted a documentation fix, and nothing read the documents

- **Bug.** PRODUCT_GUIDE's studio table said "Opens sound up to 2 hours long" again after T-129 had retired the ceiling: a checkpoint's conflict resolution took the OTHER side of the table (built before T-129) and the only reverted line of the wave went through green, because the scan that forbids the sentence read source files and not the three documents a reader opens first.
- **Fix.** The sentence restored, and `docClaims.test.ts` reads README, PRODUCT_GUIDE and USER_GUIDE for the limit in each of its shapes and for the sentence that replaced it.
- **Lesson.** **A claim that was retired in several files is retired by a test that reads all of them; taking one side of a conflicted table is a regression you can only catch by reading the table's claims.**

### (4) [LOW] - Export, Reframe and the Clip Kit's thumbnails closed on `code === 0` alone

- **Bug.** The T-131 (1) lesson ("an exit code is not a verdict") was applied to the compilation and not to its siblings. A range past the PICTURE exits 0 having written either a 261-byte container with no streams ("Output file is empty") or - when the sound outlasts the picture - an audio-only mp4 with no such line; Export said "Exported", Reframe "Saved", and `extractFrame` resolved with no file (the kit then said "Saved your Clip Kit").
- **Fix.** The ticket's direction (the sticky "Output file is empty" line) catches only the first shape: measured on both majors, the audio-only output prints nothing of the kind. What is true of both is the last progress block's `frame=0` (`-progress pipe:1`), so the runners close on `wroteNoPicture(sawEmptyOutput, frames)` (`noPicture.ts`); the progress stream is parsed by whole lines (a chunk can end inside the number); `extractFrame` asks whether this run wrote a non-empty file; each rejects with a finished sentence through the existing discard path. A legitimate 10-20 ms clip reports 2 frames through the production `fps=30` stage and stays a success.
- **Test.** Layer 5 on BOTH majors (`a clip with no picture is an error in a sentence ...`, 9 cases: the two shapes for Export and Reframe, the straddle, two tiny clips, `extractFrame`, and what each binary prints), unit `noPicture.test.ts` (22: the runners over a fake ffmpeg, the chunk split, the unknown stream). A mutation that calls a clip of fewer than 3 frames empty turns the discrimination cases red; one that calls fewer than 2 frames empty survives them (the stage doubles a 15 fps source's frames), which is why the comparison is on 3.
- **Lesson.** **When a lesson names a class ("an exit code is not a verdict"), grep the siblings the day it is written; and when the ticket's mechanism cannot see one of the two measured triggers, measure the other trigger and use the fact that holds in both.**

### (11) [LOW] - "Loaded", and the Recent entry, landed before the work they announced

- **Bug.** T-129 made the waveform read asynchronous after open, so `loadSource` resolves with the file OPEN while main can still refuse it. The importer said "Loaded" and pushed the file to Recent at that moment; a file main then refused flashed a green "Loaded" beside the refusal and stayed in Recent. "Project loaded" and "Restored from autosave" had the same shape.
- **Fix.** `loadSource` resolves with the source it opened; the importer asks `waveformArrived(source)` and says "Loaded" and pushes to Recent only for a file that stayed. The project lines ask `audioSettled(outcome)` about `outcome.audioOpened`, the source `applyProject` recorded. **The first version asked "does the studio hold a new source?" and was wrong:** a refusal that lands before the question leaves the studio EMPTY, which that question reads as "the project opened no sound". The identity of what was opened has to be carried to whoever asks.
- **Lesson.** **When the work behind an announcement is deferred, the announcement is deferred with it; and ask about the thing you started, not about whatever the shared state shows now (a failure can already have cleared it).**

### The rest

(3) the Clear saved transcripts row wraps by item and its label never wraps by word (layout case at the default window and the minimum, T-123's pattern); (5) wavesurfer's `normalize` scales by channel 0 only, so `maxPeak` is handed the loudest of both halves (a pixel-reading case on a +0.2 / -0.8 square wave); (6) a held Enter - and a held arrow - steps the tour once (`tutorialKeyIntent` gets `repeat`; the mechanism is the Fix wizard's `ignoreHeldEnter`); (7) "Base on" fills the platform's rate and bitrates, not its size alone; (8) two stale comments and the USER_GUIDE sentence; (9) Play is dimmed while the waveform is drawn; (10) the playback sentence says what still works and sends a WAV owner to "a standard PCM WAV"; (12) the compilation refusals name the clip by the name on the wire and the join's says what to do (the clip comes off ffmpeg's own "Impossible to open" line); (13) the settings refusal has one fixed toast id; (14) a partial transcript clear is a warning toast.

---

## 2026-10-23 — T-131 (round 79): a fix that made a compilation shorter and said "Saved", pickers nobody pressed twice, and a guard that stopped claiming to be finished

The seventeenth pass (the sweep's verified findings, expediter-ticketed; 18 items). The pattern: **a fix is a claim about the inputs it was measured on** — T-127 (4) measured `-shortest` on sources whose sound covers the picture, and the first source whose sound does not (Record's own mic-drop takes) turned it into a join that silently dropped clips; "the first await is a native dialog, so a pin is enough" was a sentence, and executing it showed two choosers from one double-click on seven more buttons; "the guard's last gaps" were called the last four times. Ledger: r80c/ledger.md (worker r80c resumed r79 at its WIP commit; every red below is a content-replace with a sha256 triple, every restore byte-identical). Gates at hand-back, on a 4-core box shared with other workers' suites: `npm run verify` 162 files / 4467 tests green; `npm run test:media` 310 cases, 299 passed | 11 platform-skipped on the bundled 7.0.2; the T-131 and T-127 (4) blocks (22 cases) green on 6.1.1 through the alias recipe, and the whole file there 292 passed with the same 7 linux-binary pins failing (4 drawtext, the GIF palette, the ansi text file, mpegts), none of them this round's; the Playwright suite 354 tests, green in two of the round's four full runs and, in the other two, failing only tests in code this round did not touch (the Record `watchScreenEnd` test, twice, and the Captions ranged-burn test, once) that are load-sensitive and pass alone, and on the pristine pre-round tree at the same rate (IC, "Found, not fixed"). One more finding, not fixed: `settingsFolders.test.ts` and `settingsFolderDeadline.test.ts` build a fixture path from `os.tmpdir()` that must stay under the 80-character `streamerHandle` schema, so a temp directory longer than about 31 characters fails them (a CI runner's Windows temp path is about 40).

### (1) [MED, a T-127 (4) regression] - a compilation of a source whose sound ends early lost every clip from the first one past the sound, and toasted "Saved"

- **Bug.** T-127 (4) put `-shortest` on every compilation segment so a segment ends at its shorter stream. When the SOUND is the shorter one (a Record take whose microphone dropped, a clip captured with the sound starting late) a range past the sound's end ended where the sound did: wholly past it, no packet at all - ffmpeg printed "Output file is empty, nothing was encoded" and **exited 0** with a ~970-byte Matroska stub. The join opened that stub, logged "Impossible to open", stopped there and **exited 0 too**: every segment from the stub on was missing and the panel said "Saved". Executed through production `runConcat` on a 10 s picture with 6 s of sound: `[1,3] [7,9] [2,4]` came out **2.0 s** instead of 6.0, `[1,3] [5,8] [2,4]` (the second clip straddles the sound's end) **5.014 s** instead of 7.0.
- **Fix.** Each segment's `-af` ends in `apad=whole_dur=<its length in the output>` (always emitted; `(end - start) / speed`, the value `buildSegmentFilters` already computes), and `-shortest` STAYS: the sound is padded with silence up to the picture's length, so the picture is the shorter stream. **The two measured warnings are constraints, not style:** a bare `apad` (no `whole_dur`) is endless - it brought the join drift back on 6.1.1 (3 / 57 / 83 / 112 / 125 / 161 / 194 / 194 ms, reproduced) and hangs `-c:v copy` on the bundled 7.0.2. And the join **fails loudly**: a segment ffmpeg wrote nothing for ("Output file is empty", exit 0) stops the job there with "Clip N of the compilation has no picture in the video (check its start and end), so nothing was saved."; a join that "Impossible to open"s a segment (exit 0) fails with "The compilation could not be put together because one of its clips could not be read, so nothing was saved." and its short file is removed by the existing failure path. Both are finished sentences (`userFacingError` lets them stand); the two patterns are exported and Layer 5 runs the real binary against them, so a release whose wording changed fails there and not in the field.
- **Test.** Layer 5 `a compilation survives a source whose sound does not cover a segment` (8 cases: sound ends mid-segment, a segment wholly past it alone and mid-list, the straddle in a list with fades, sound starting late, a mic-drop WebM, a range the PICTURE does not reach is an error in a sentence with no file and no scratch, and the two patterns against the real binary) and `the sweep-17 replication` (the expediter's 10 s / 6 s harness verbatim: 6.0 s and 7.0 s); the T-127 (4) fractional drift series re-run flat on the fixed tree, both majors (`3 / -3 / 7 / 0 / 0 / 0 / 0 / 0`). Unit: `concat.test.ts` (the pad is LAST, finite, the clip's length in the output at 1x / 2x / 0.5x), `concatRunner.test.ts` (7: both exit-0 guards, the sentence reaches the person, the half file is removed). E2E: video-pipelines.spec.ts presses the Compile button on an 8 s picture with 3 s of sound (three clips, two of them past the sound's end, set through a project file): the file is 5.0 s and carries sound. **Red-first (the E2E: the pad removed, the conditional `-af` restored and both guards off gives a 1.5 s file under a "Saved" toast, `expected 1.5 to be greater than 4.8`); both majors, on the true pre-fix bytes (pad removed, the conditional `-af` restored, both exit-0 guards off):** `the picture of the three clips: 2 s, expected 6 s` and `5.014 s, expected 7 s`, exactly the ticket's numbers; with only the pad removed the stub is now caught and reads `Clip 2 of the compilation has no picture in the video ...`. Mutations (rows i1-m1..m6, r80c-inh-*, i1-rep-*): no pad, bare `apad` (the banked drift series on 6.1.1), no `-shortest`, no segment guard, no join guard, each pattern misspelled - every one red.
- **Correction (T-127 (4)).** T-127 (4)'s Fix line, "`-shortest` in the segment's argv", is incomplete: `-shortest` is only safe beside the pad. It fixed the drift of sources whose sound covers the picture and turned the first source whose sound does not into a silent truncation. The drift series was green throughout because its fixture's sound was as long as its picture.
- **Honest limit.** The pad is at the END only. A clip that begins BEFORE a late-starting sound keeps the gap: that segment's sound is shorter than its picture by the excess (measured: 60 ms for a 1.6 s gap) and the join pulls the next segment's sound that much earlier (-64 ms on both majors). `aresample=async=1:first_pts=0` ahead of the pad fills the start (measured, both majors) and is the upgrade; the ticket's mechanism was held, the comment in `concat.ts` says `simplification:`, and Layer 5 asserts the straddling segment's own beeps and not the later ones.
- **Lesson.** **A fix is a claim about the inputs it was measured on; test it on the input that breaks its premise.** The shape was in the product (Record's own mic-drop takes) the day the fix landed. And **an exit code is not a verdict**: two ffmpeg commands exited 0 having written nothing, and the runner believed them. A job that assembles parts checks that every part arrived.

### (2) [LOW] - Re-attach and Picture-in-picture ended where a SHORTER sound did

- **Bug.** The same `-shortest` ended `attachAudio` and `compositePip`'s output at the sound: a 12 s picture whose microphone dropped at 5 s re-attached to **5.0 s** (a PiP base the same; the stream-copy branch 6.0 s of a 6 s sound).
- **Fix.** `apad=whole_dur=<the picture's length>` (finite: a bare `apad` hangs `-c:v copy`) beside the kept `-shortest`. The re-attach's length is the probe's duration less the merged cuts (`keptDurationSec`), so the probe that decided the stream-copy now also runs with a cut; the PiP probes its base. A picture whose length cannot be read (a durationless recording) is re-encoded and not padded, as it always was. The progress bar measures against the picture's length (the output is that long). The `-shortest` comment in `process.ts` now says what the flag is for on both sides.
- **Test.** Layer 5 `a sound shorter than the picture does not shorten the file` (10 cases, both majors): the stream-copy branch, the VP8 WebM re-encode, the whole flow (extract, clean, put back), a cut, a sound LONGER than the picture still cut at it, PiP over a 5-of-12 base, over the mic-drop WebM, with a 20 s overlay (still ends with the base) and over a base with no sound at all (no audio stream appears). Unit: `muxCodec.test.ts` (5 new, 1 rewritten: a cut now probes), `concatRunner.test.ts` (PiP pad, 3), `cancelSentinel.test.ts` (the PiP probe and a NEW mux-pass row are held to the cancel latch: 7 generated cases). **Red-first, both majors:** `copy: the container's length: expected 5 to be greater than 11.8`, PiP `expected 5.014 to be greater than 11.8` (5.013 on 6.1.1); no `-shortest` turns the two controls red (`15 s, expected 12 s`; a 20 s overlay `expected 20 to be less than 12.2`). The bare form is held by the unit pins only: running it at Layer 5 would hang.

### (3) [LOW] - scan results died with nothing: they outlived their video

- **Bug.** HighlightPanel and ChatHighlightPanel stay mounted when the open video is replaced in place (Reframe's "Edit in Video Studio" loads the 9:16 file into the same studio), so the previous video's candidates, scan progress and pasted chat log stayed, and a stale "+ Clip" row made a clip that STARTS at the end of the new video and runs 0.1 s past it, with a success toast (`appendRange` clamped the start to the duration and made the end `duration + 0.1`).
- **Fix.** Both panels reset on `source.filePath` (CaptionsPanel's pattern, written once in T-112); a scan that finishes after the swap is dropped (`openPathRef` against the path it started on); and `appendRange` refuses a range with less than the shortest clip (0.1 s) left in the video, so no clip ever ends past the end (the panels' existing refusal sentences carry it).
- **Test.** Unit `videoStore.test.ts` (4), `interactionWiring.test.ts`; E2E video-pipelines.spec.ts through the real Edit-in-Video-Studio route (a real scan, a pasted log, a real reframe) and a held scan answered after the swap. **Red-first:** the finders keep `Re-scan`, a row and the log; the late scan lands `Found 1 highlight` and a row on the new video; the store adds the past-the-end clip.
- **Lesson.** **A guard that exists once is a convention nobody follows** (again): the sibling panels of the one that was fixed in T-112 kept the bug for fifteen rounds.

### (4), (6) [LOW] - a double-click answered the next question, skipped a tour step, and could close the tour

- **Bug.** The Fix wizard replaces its answer buttons with the next question's in the same place, so the second press of a double-click answered question 2 too ("Quick fix 3 of 3" from one double-click); the tour's Next advanced once per discrete click, so a double-click skipped a step (steps that share a target and a placement keep Next where it was) and from the penultimate step the second press was Done.
- **Fix.** One rule, `isRepeatPress(e)` (`e.detail > 1`; a keyboard click has 0), in `lib/repeatPress.ts`: the wizard's answers, and the tour's Next / Done, Back and scrim, ignore it (T-120's held Enter, for clicks). A person pressing once at their own pace is untouched.
- **Test.** `repeatPress.test.ts`, the wiring pins; audio.spec.ts and home-chrome.spec.ts press `dblclick()` at every step (question 1 -> 2, 2 -> 3, 3 -> summary; Next, Back and the scrim from "Pick your platforms") and then press once to show single presses still step. **Red-first:** `Quick fix · 3 of 3` expected `2 of 3`; the tour lands on `Export` expected `Add a watermark`.
- **Lesson.** **Anything that replaces the control under the pointer must answer a repeat.**

### (5) [LOW] - "the first await is a native dialog, so a pin is enough" was disproven by pressing twice

- **Bug.** T-126 (19) and T-127 (11) made the start handlers claim-first and left every PICKER pin-only on the rationale that the first await is a native dialog, which protects itself. It does not: the second press lands in the few milliseconds before the OS draws the dialog. Executed in the built app: two choosers from one double-click on Video Studio's and Audio Studio's "Choose file…", the second-track role buttons (the second answer silently REPLACED the track), Picture-in-picture's two file buttons, Export's folder chip, the four side panels' shared chip, and Home's Open project and Save project.
- **Fix.** ONE helper, `claimFirst(flag, work)` (`lib/claimFirst.ts`): the `ExportPanel.startingRef` shape (raise the flag before anything awaits, lower it in a `finally`, answer `undefined` to a second call) applied to all of them; the Home pair shares one claim over the dialog only (the apply after an open stays concurrent, T-112). The `interactionWiring` scan finds EVERY renderer call of a bridge function that opens a native chooser (`video.pickFile`, `audio.pickFile`, `video.pickOutputDir`, `project.save`, `project.load`), names its enclosing function, and holds the set to a decided table (under `claimFirst(<flag>)`, or a start handler's own claim): a new picker fails until decided.
- **Test.** `claimFirst.test.ts` (6: raised synchronously, a second call dropped, released on success and on throw, a canceled dialog, a refused call does not lower the first's claim), the scan (11 sites) with a discrimination block, and a delayed-chooser (300 ms) `dblclick` E2E per entry point: video-pipelines.spec.ts (Importer, the two PiP buttons, Export's chip and the shared chip), audio.spec.ts (Importer, role button), home-chrome.spec.ts (Open project, Save project, one file written), and the two start handlers the old dispositions had called covered by a pin (Clip Kit: one folder chooser, one kit; Burn into video: one Save dialog, one file). The stand-in moved to `tests/e2e/chooser.ts`. **Red-first:** with `claimFirst` not claiming, every one of those E2E fails on `Expected: 1 Received: 2` (choosers) and the unit cases fail; per site, a claim on a throwaway flag (`claimFirst({ current: false }, ...)`) fails the scan AND that site's own E2E on all eight pickers (rows i5s-*), and removing the Clip Kit's or the burn-in's own claim fails the wiring pin and its E2E (`one folder chooser`, `one save dialog, not two`).
- **Lesson.** **A rationale is a hypothesis until someone presses twice.** Both IC dispositions that said "pin-only" are rewritten.

### (7) [LOW] - nothing in the app named the `?` key

- **Bug.** T-13's promise (the `?` key opens the shortcuts) regressed: the Player's hint line lost it, the tours named only the header's round `?` BUTTON (which replays the tour), and README and FOR_MIKE still claim the key.
- **Fix.** "? all shortcuts" on the Player's and the Timeline's hint lines; every tour's last step says "the ? button in the header replays this tour any time, and the ? key on your keyboard lists every shortcut on the screen you are on" (two sentences, `tutorialCopy.test.ts` rule 3 still holds).
- **Test.** `tutorialCopy.test.ts` (9 new cases), `interactionWiring.test.ts`; home-chrome.spec.ts reads the card, both hint lines (one `<kbd>?</kbd>` each) and presses the key.

### (8) [LOW] - the second press of a double-click on a closing dialog's button landed on the page beneath

- **Bug.** Executed: "Keep running" double-clicked mid-batch flipped the Facebook checkbox beneath the dialog.
- **Fix.** When a `Modal` closes (and when the tour does) a capture-phase listener on the window drops clicks with `detail > 1` for 500 ms, ahead of React's handlers and a checkbox's default action (`swallowRepeatClicks`). One shared change; the scrim's own guard (T-127 (8)) and the drag rule (T-123 (7)) stay. Only a repeat is touched.
- **Test.** video-pipelines.spec.ts records every click that reaches the page after `dblclick()` on "Keep running" (none may) and reads every checkbox before and after; home-chrome.spec.ts the same after a double-click on the tour's Done. **Red-first:** a click with `detail: 2` reaches the page.
- **Lesson.** Witness the event, not the geometry: which control sits under a button depends on the window.

### (9) [LOW] - the Cancel question outlived its batch and read "Cancel 0 running jobs?"

- **Fix.** Export's and Clip Kit's confirm close the moment `running` is false. E2E: both questions are left unanswered while the batch runs to its end; the dialog is gone and both jobs finished. **Red-first:** the dialog is still up (`the question is gone with the batch` and `... with the kit`, `Expected: 0 Received: 1` dialog).

### (10), (11), (12) [LOW] - the network guard stopped claiming to be finished

- **Bug.** `open(u)` and every qualified or parenthesized spelling, `(0, eval)(x)`, `Function('...')`, `navigator['sendBeacon'](u)`, `const WS = WebSocket`, `class X extends WebSocket`, `(WebSocket as any)`, `document.createElement(tag)`, `rtmp://` / `rtsp://` / `srt://` / `udp://` / `tcp://` / `sftp://` / `smb://` literals, a `.mts` file under `src/` and an HTTP client spelled any other way in package.json each returned `[]` (or passed). Four rounds had called their gaps "the last".
- **Fix.** Three questions asked the other way round, as in T-126 (1): `open` / `eval` / `Function` are judged by their LAST segment, bare, qualified, parenthesized, indirect or by element access, **unless the file binds the head of the chain itself** (autosave.ts's `open` from `node:fs/promises` is the mandatory negative, and the real file is parsed in the test); `x['name']` reads as `x.name`; a named network constructor used as a VALUE is a site; a non-literal first argument to `createElement` / `setAttribute` is `(dynamic)`; ANY `scheme://host` literal is a site unless its scheme is `imagii-file`, `file`, `data` or `blob`; under `src/` only `.ts` (`.d.ts`), `.tsx`, `.css` and `renderer/index.html` may exist; and every dependency and devDependency name is on a list written in the test, exact both ways. The header no longer claims to be complete: WHAT IT CANNOT SEE is the declared residue (a computed member name, a global reached through an alias of `window`, `fetch` as a value, and the flow-insensitive binding rule).
- **Test.** `networkAllowlist.test.ts` 32 -> 42 cases. **Round-21 proof:** 35 branch breaks (rows r80c-g10-* / g11-* / g12-*); 34 red the first time, and the one survivor (dropping the `extends`-token test: `class Fake implements WebSocket {}` was not a case) was closed with that negative and re-run red.
- **Rider, answered (ledger (m)).** Does `connect-src 'self' ws: imagii-file:` let the built renderer fetch an https URL? Probed in the built app with a NON-ROUTABLE target (`127.0.0.1:9`): **no.** fetch and XHR of `https://` and `http://` (and `ftp://`, `rtmp://`) are refused by the POLICY ("Refused to connect ... connect-src 'self' ws: imagii-file:"); what `ws:` leaves open is `new WebSocket('ws://' | 'wss://')` to any host (the CSP does not refuse it; the attempt then dies at the network stage). smoke.spec.ts holds both halves. The TESTING win32 hand-check gains the wpad / OS-proxy allowance sentence.
- **Lesson.** **A closed vocabulary is a list of what someone thought of** (said in T-127 (5), (6), (12), (13), (14), and then ignored by the next sentence of this entry's header). Invert the question where you can, and declare the residue where you cannot instead of calling the work finished.

### (13) [LOW] - the folder chip woke under a busy primary's double-click

- **Bug.** The busy Reframe and Compile primaries shrank (Reframe 137 -> 114 px, Compile 112 -> 86, measured at the default window), and the live chip beside them GREW into the room (129 -> 152 px, 154 -> 164): the strip the second press of a double-click lands on was the chip's, and a chooser opened mid-job (executed on a 120 ms second press).
- **Fix.** The chip is disabled while the job runs on all four chip panels (changing the folder does nothing for the running job), and the Reframe and Compile primaries keep their idle width (`min-w` 8.6 rem and 7.1 rem).
- **Test.** video-pipelines.spec.ts: for each of the four panels at 1632 and 1024 px, the primary is pressed, the chip is asserted `disabled`, a second press lands on the idle primary's left strip 150 ms later, no folder chooser opens and the busy primary is not narrower than the idle one. **Red-first, each protection alone:** the chip enabled -> `the folder chip is off while the job runs` and a chooser opened; the `min-w` removed -> `the busy primary shrank from 137 to 114 px` (Compile 112 to 86). **Caught in the round:** the first version of this test raced itself - Picture-in-picture's Base and Overlay buttons share one claim, the test pressed Overlay inside the 150 ms hold of Base's chooser, the press was (correctly) dropped and the job never started; it failed the same way on the UNMUTATED tree under load, which is why the first "red" for the `min-w` (a failure at `the job started`) was thrown away and the row redone after the test waited for each answer to land.

### (14), (15) [LOW] - the only cut input app-wide, and two ways to write a multiplication

- **Fix.** The filename template's "Tokens:" hint is its own line under the box (at 1024 px the inline hint left the input 168 px for a 189 px default value). image ExportDialog spells every size with × (`Output: 1280×720`, `28×28, 56×56, 112×112`, the YouTube-size note), and `copyConventions.test.ts` gains the rule "the letter x between numbers" (the tree has no other violation; the discrimination block fires it on a made-up string).
- **Test.** E2E reads `scrollWidth <= clientWidth` at both window sizes and that the hint sits under the box; the image.spec.ts pins moved to ×.

### (16), (17), (18) [LOW] - the guide, the quit story, the license

- **(16)** STYLE_GUIDE speaks the pair rule (either value one hour or more puts BOTH boxes in clock form; the unit follows the form; the overlay's pair and the clip's pair are two pairs) and `textOverlay.ts` no longer says "the card never speaks two forms".
- **(17)** Electron emits no `before-quit` on a Windows shutdown, restart or logoff (its own typings), so the autosave flush, T-127 (3)'s drain and the kill do not run on that one exit path; the `index.ts` comment said "an OS session end" and the not-covered lists (IC, this log) now say it. The optional `session-end` handler is ledgered (az) and not built: nothing here can verify it. *The T-127 (3) entry's "Not covered, stated" gains the line below.*
- **(18)** `@fontsource/inter` left the asar in T-127 (2) and took its LICENSE - the packaged tree's only copy of the SIL Open Font License - while the woff2 files still ship. `electron-builder.yml` `extraResources` copies it to `resources/licenses/Inter-OFL.txt`. A scratch `electron-builder --win --dir` probe on this box assembled the tree (it then stopped at the rcedit step, "wine is required") and the file is there, byte-identical to node_modules' (4477 B), with no @fontsource entry in the asar; `releaseWorkflowShape.test.ts` (4) holds the configuration, the source file's text and the font's import. The release run's hand-check confirms the file in the real packaged tree.

### What this round did not cover, stated

- A late-starting sound's START is not padded (see (1)); a scan finishing after a swap is dropped but the old scan keeps running in main until it answers; `swallowRepeatClicks` drops a legitimate fresh double-click begun within 500 ms of a dialog closing (the cost of the rule, named in `lib/repeatPress.ts`); the chip is not disabled on the Export card (its chooser changes the folder for the NEXT export; the ticket named the four side panels).
## 2026-10-23 — T-130 (round 79): a "no red pixels" check that read nothing, and a list that meant two things

The platform-rate and kit-art debt: a compilation that follows its source's rate up to 60 (and a YouTube 1080p60 row), Clip Kit thumbnails that honor the crop, a watermark that clears the platform's own interface on a vertical frame. Two things the work found are not about frame rates.

### (1) [test] - a pixel count of zero from a reader that read no pixels

- **Bug.** The pixel reader every Layer 5 and e2e colour case shares seeks first (`-ss <t>`), then decodes one frame. On a JPEG, `-ss 0 -i thumb.jpg` decodes NO frame at all, on both majors (executed: 0 bytes on 7.0.2 and on 6.1.1, 691200 without the `-ss`). The thumbnail cases for (t) assert "no red pixels outside the crop": against a reader that reads nothing, that is true of every file ever written.
- **Fix.** The readers in `media.spec.ts` and `video-pipelines.spec.ts` leave `-ss` off for a still image, and the e2e one throws "pixel read returned no frame" for an empty read instead of counting it as zero.
- **Test.** The control in the Layer 5 block: the same reader on the uncropped thumbnail must find more than 100 000 red pixels. **Red-first:** it read `expected 0 to be greater than 100000` before the reader was fixed, which is how the empty read was caught; the cropped case also asserts what IS there (the strip's green over 90% of the file, the white square where the crop puts it), so it cannot pass on emptiness.
- **Lesson.** **A negative pixel assertion needs a positive control run through the same reader.** "Zero of X" is a measurement only if the same call finds X somewhere it should. Count the bytes a reader returned before you count what is in them.

### (2) [design] - one list that was both the grid and the kit

- **Bug.** `ALL_PLATFORM_IDS` was "the platforms the Export grid offers" and, by reuse, "the platforms Clip Kit writes a file for". Adding YouTube 1080p60 to the grid would have made the kit write a sixth file (the clip at 60 fps whatever it was recorded at, at 12 Mbps), changed its button to "Clip Kit (6 + thumbs)" and its cancel question.
- **Fix.** `KIT_PLATFORM_IDS` (the five, in queue order) in `presets.ts`; the kit's queue, effective presets, limit targets, button and confirm read it.
- **Test.** `presetTablesInSync.test.ts` (the kit list is the five, without the new id, each in the grid), the e2e case that ticks 1080p60 beside YouTube and still reads "Clip Kit (5 + thumbs)". **Red-first mutation:** the kit list given the new id fails both.
- **Lesson.** **A list reused for a second job is a coupling nobody wrote down.** When a row is added to a shared list, grep who else reads the list and ask each reader whether the new row is theirs; give a reader that means something narrower its own list.

---

## 2026-10-16 — T-129 (round 78): the waveform stops decoding whole files in the renderer, and the 2-hour ceiling retires

T-110 (ao), owner-authorized. Audio Studio handed wavesurfer the file's address alone, and wavesurfer did what that means: it fetched the WHOLE file into the renderer and decoded it with WebAudio to draw the picture. Sweep 12 measured 3.25 GB of renderer memory for a 1 h WAV and 6.5 GB for 2 h, and T-123 shipped the stopgap - a flat 2-hour ceiling, marked `// simplification:` with this letter as its upgrade - which then grew a pre-check before extraction (T-124 (6)), a kind-aware sentence (T-124 (7)), a backstop on the scratch WAV (T-126 (8)) and a durationless branch (T-127 (10)): four rounds of machinery around a limit a streamer's ordinary 3-6 h VOD always hit.

- **Bug.** A long recording could not be opened at all (refused), and under the ceiling the renderer still held the whole decoded sound. Measured this round on a 2 h 5 min, 48 kHz MP3 (30 MB) with the ceiling lifted on the round-77 build: the renderer went 170 MB -> 481 -> 987 -> 1428 MB in six seconds and then CRASHED (`render-process-gone`, `crashed`); the waveform never drew. Re-measured on the T-129 build with only the renderer decode put back (`url` alone): 173 -> 1460 MB in about eight seconds, then `crashed`, exit 5.
- **Fix.** Main computes the picture: `audio:peaks` (`main/audio/peaks.ts`) has ffmpeg decode the first sound stream, mono at 8 kHz, as raw PCM into a pipe, and folds every chunk as it arrives into `PEAK_BUCKETS` (4000) highest/lowest pairs, keeping nothing of the stream (one odd byte between chunks at most). The answer is two 4000-number arrays and the probed length, checked where it lands (`isWaveformPeaks`, a size-bounded payload). `WaveformView` creates wavesurfer only once those exist, with `url` + `peaks` + `duration`: given `peaks`, wavesurfer 7.12.6's `loadAudio` skips both `Fetcher.fetchBlob` and `Decoder.decode` (read in the installed source before anything was written), and the `url` is only its media element's, which streams over imagii-file's Range support as it always did. The studio opens on the file at once and the box the waveform will fill says how far main has read ("Drawing the waveform… N%", a named, valued `role="progressbar"`) - the old path showed an empty dark box and a disabled Play. The job is a `CancelLatch` run with a per-job registry: Close (or another file opened while one draws) stops it through `audio:cancel`, and the quit sweep (`cancelAllPeaks`, also inside `cancelAllAudioJobs`) and the quit's drain cover it. A file main cannot read is the refusal that remains (`WAVEFORM_READ_FAILED`, shown as written by every route; the studio lets go of it), and with the waveform drawn from peaks, what a media-element error now means is PLAYBACK (`PLAYBACK_ERROR_MESSAGE`; Play goes back off). The ceiling, its sentence, its pre-check, its backstop and its `// simplification:` are deleted; the T-127 (10) `hasVideo` plumbing is untouched.
- **Measured after.** The same 2 h 5 min file: renderer 165-173 MB while main reads, peak 182 MB, waveform drawn at 15-16 s (the decode is main's ffmpeg's time); the e2e case logs 184-185 MB. Main's own memory while 120 MB of PCM goes through the job: +1.5 to +29 MB over the runs on both majors (Layer 5; a job that keeps the chunks grows +116 to +123 MB).
- **Test.** Layer 5, `media.spec.ts` "the waveform is read from a stream of the sound in main ..." (both majors): two 250 Hz bursts at known times and heights on a 48 kHz stereo file land in their buckets (edges to one 5 ms bucket) at their heights, silence is flat; a 2 h 5 min file is 4000 pairs with this process under +60 MB; an undecodable WAV (format tag 0x9999: ffprobe reads it, no decoder does) is the sentence; Cancel kills the real ffmpeg at once. Round-21 breaks, each red on its case on both majors: bucket time x1.05, `-ac 2`, an unsigned read, the raw stderr as the message, Cancel without the kill, no final 100 %, the chunks kept. E2E (`audio.spec.ts`): the long file opens, shows its percent, then draws tone where the tone is and flat where the silence is, with 0 page fetches of the file and renderer `VmHWM` under 800 MB, read WHILE it waits (see the second lesson); Close mid-draw kills the job's ffmpeg (`SIGKILL`, recorded in main) and says nothing; a quit mid-draw has killed it by `will-quit`; the unreadable WAV is refused once; the ADPCM WAV draws and says it cannot be played; a 2 h video is extracted and opens (and Clean audio on one, `video-pipelines.spec.ts`). All red on the round-77 build; per-defect breaks on this build (wavesurfer given `url` alone: `the renderer peaked at 800 MB while the waveform was read and drawn ... Expected: < 800`; no stop on Close; no quit sweep; no progress box: `element(s) not found`; percent not wired; the words frozen at 0 % while `aria-valuenow` moves: `Expected: > 0 Received: 0`) each red. Unit: `peaks.test.ts` (the fold, odd byte boundaries, the clamp, the command line, the job's progress, failure, per-job Cancel, the Cancel during the probe, the sweep, the latch run), `audioStore.test.ts`, `audio.test.ts`, `audioExtractCeiling.test.ts` (flipped), `interactionWiring.test.ts`, `docClaims.test.ts` (flipped).
- **Lesson.** **A ceiling that guards a mechanism is debt with a meter running: every round spent on its edges (where it is asked, which sentence, what happens to the scratch) was work the mechanism's replacement deletes.** Fix the mechanism the limit exists for as soon as it is understood; and when a library is handed an address, read what it does with it - "give it the URL" was "copy the whole file into this process".
- **Lesson (the resume).** **A memory line read after the thing it guards has finished cannot see the failure it exists for.** The first form of the long-file case read the renderer's high-water mark once Play turned on; against the old path the renderer crashed (or its decode was refused) before Play ever did, so the case went red on Play and the line never fired. Watching the line while it waits, and asserting it first, is what made the memory assertion itself red on the old path - and measuring showed the old path fails two different ways on the same file depending on the moment (two runs of three refused the decode at once, one climbed to the crash), which a single after-the-fact reading would have reported as a timeout.
## 2026-10-16 — T-128 (round 78): a quit that deleted the only copy of a recording, a Welcome screen that a full disk could lock, and five spellings of one alphabet

The small-debt batch from the T-110 ledger (six items, owner-authorized: "proceed with the tech debt"). Two of them were not small once measured: the quit mid-convert finding the sweep-17 reviewer executed, and the bare settings writes that could end a click. The pattern: **a cleanup that was added to every runner but the three that were not "runners" (a convert, a transcode, an extraction) is a rule with three exceptions nobody listed**; and **a green test that races the platform proves the platform's speed** (below).

### (1) [LOW] - cut names with no tooltip, and a rule that said "always" about four of them

- **Bug.** T-127 (15) titled the four cut names the sweep named and DESIGN_GUIDE said "a name that a layout cuts with an ellipsis always carries its whole self as its `title`". Twelve more `truncate` spans and two `line-clamp-2` spans had none: the mood board's list row and heading, the post checklist's output name and hashtag preview, the variant labels, Record's source tiles (an OS window's own title, cut at about 33 characters at 1024 px, with the full text nowhere else on the screen), the layer names, the highlight and chat-peak lines, the Export panel's preset labels and queue rows, and a saved reference's title on its tile.
- **Fix.** `title` on each, the full text. The `hashtagLine` is computed once and serves the preview, its tooltip and Copy.
- **Test.** `a11ySweep.test.ts` rule 6 (a syntax-tree rule, with a discrimination block): every JSX element whose class has `truncate` or `line-clamp-N` has a `title` of its own or inside a tag the BROWSER draws (a component's `title` prop is not a tooltip: `<Modal title>` is a heading, which the first run of the rule counted as cover and so missed the variant labels). **Red-first:** `expected [ …(12) ] to deeply equal []` listing `LayerPanel.tsx:114`, `RecordStudio.tsx:770`, `MoodBoardPanel.tsx:155 / :190`, `ExportPanel.tsx:608 / :644` and the rest; the two clamps joined when the rule learned `line-clamp`. E2E: references.spec.ts (a long board name is really cut - `scrollWidth > clientWidth` - and carries the name, in the list and the heading) and record.spec.ts (a 120-character window title on a source tile), both red on the pristine build with `Received: ""`; the queue row's two titles are asserted in the export case below.
- **Lesson.** **"Always" in a guide is a claim about every site, so it needs a rule that reads every site.** The T-127 pass pinned the four it fixed by name; the next pass found twelve. A sweep over the syntax tree (and a discrimination case for the shape that fooled its first draft) is what makes the sentence true.

### (2) [LOW] - 93 KB of fonts nothing could load

- **Bug.** `@fontsource/inter/latin-NNN.css` lists a `.woff` after each `.woff2`; Chromium 126 reads woff2 and never requests the fallback, but the build emitted all six files.
- **Fix.** Three `@font-face` rules at the top of `styles/index.css` whose `src` is the package's woff2 file alone (Vite resolves `url('@fontsource/inter/files/...')` through the package, no relative `node_modules` path); `main.tsx` imports no `@fontsource` CSS. The built folder holds three woff2 files and no `.woff`.
- **Test.** `interactionWiring.test.ts` (no `@fontsource` import, three Inter faces, one woff2 source each that exists in the package, with a discrimination block) and smoke.spec.ts (no `.woff` in a built sheet or in the assets folder, exactly three woff2). **Red-first on the pristine build:** `no sheet names a .woff (woff2 alone)`, `Received ["./inter-latin-400-normal-CyCys3Eg.woff", ...]`.
- **Lesson.** **A dependency's CSS is a decision someone else made for browsers you do not ship to.** When the target is one browser, read what the package asks it to download.

### (3) [feature] - the transcripts nobody could clear (T-110 (s))

- **Bug.** Every transcription keeps its `.srt` in `<userData>/captions` for good; the guide said "delete them there whenever you like", which is not an action.
- **Fix.** A line at the bottom of the Captions panel counts them and **Clear saved transcripts** (disabled with none, and while a job runs) opens a confirm that opens on Cancel and says it deletes the open video's too; two IPCs that take NO argument (`captions:countTranscripts`, `captions:clearTranscripts`), so a renderer cannot aim a clear anywhere. `main/transcripts.ts` counts and removes regular files directly in the folder whose name ends in `.srt` and that are not a ranged burn-in's temp copy (a job may be reading it); a link is never followed (a `.srt` link to a file elsewhere is skipped, and a captions folder that is itself a link is not searched); a file that will not go is counted as failed and the rest still go. The panel then forgets the transcript of the video that was open (`setSrtPathFor(startedFor, null)`; its Save .srt and Burn would point at a file that is gone).
- **Test.** `transcripts.test.ts` (10, real folders: temp copy, sub-folders, links, a refusing remove), `captionsTranscripts.test.ts` (the real handlers: nothing beside the folder is touched, an argument is ignored), `captions.test.ts` (the toast sentences), `videoStore.test.ts`, the single-flight pin, and video-pipelines.spec.ts (a seeded folder with three transcripts, a temp copy, a notes file and a `.srt` in `models/`: Escape and Cancel change nothing, Clear empties exactly the transcripts, the toast names the count, the open video is no longer transcribed). **Red-first:** the module and the handlers did not exist; the e2e on the pristine build: `getByText('3 saved transcripts kept on this computer.')` element(s) not found. Nine breaks, each failing a named case (the temp copy counted, a followed link, a handler that takes the caller's folder, a clear that keeps the panel's transcript, a button not disabled at zero, no confirm).
- **Disposition, stated.** A refusal by the OS (a transcript open in another program) cannot be forced in the e2e; the unit counts it and the message names how far the clear got.

### (4) [MED] - a refused settings write could end the click that made it (T-110 (x))

- **Bug.** `window.api.settings.set` is an IPC round trip main can refuse (a full disk, a config it cannot replace). Written as `await window.api.settings.set(...)` in the middle of a handler it ended the handler: the Welcome screen's "Let's go" awaited `welcomeSeen` BEFORE it let the person in (a refusal left the button doing nothing, and the next launch asked again), and Export awaited the watermark handle, its corner and the file-name template before it built the queue (the button came back, no row, no toast, no file). The `void` writes beside them were unhandled rejections. The sweep that found "about 47" such awaits counted pickers, cancels and reads too; the writes were 14 sites.
- **Fix.** `lib/persistSetting.ts`: a promise that never rejects (a refusal is one `reportFailure` sentence, "Couldn't save your settings.", the raw error to the console); `void` it when nothing depends on the write, `await` it where the order matters (the recent-files list). The one write the next line DOES depend on, the posting diary's migration (the old copy is removed only once the new one is stored), stays an `await` in its `try`.
- **Test.** `failurePathLanguage.test.ts`: no renderer `window.api.settings.set` that is neither AWAITED inside a `try` with a `catch` nor `.catch`ed (a `void` call inside a `try` is not caught by it: the rejection arrives after the `try` is over - the first draft of the rule trusted it, and found 12 of the 14), with a discrimination block; `persistSetting.test.ts` (6). E2E (red on the pristine build): home-chrome.spec.ts Welcome with `settings:set` made to refuse - `the person is let in` fails, still on "Hi Mike!" - and video-pipelines.spec.ts Export with the same refusal - no file in 120 s. Six breaks of the rule and the helper, one of the Welcome handler through the build.
- **Not done, stated.** The other awaited bridge calls outside any `try` (38 at the end: native pickers, cancels, store reads and the mood-board and custom-preset writes) are not this rule's; they are listed in INTERACTION_COVERAGE's round-78 "Found, not fixed" with the ones that could reject onto a click.
- **Lesson.** **A convenience must not be able to veto the action it decorates.** "Remember the folder" is not part of "export"; the code that ordered them on one line made it so.

### (5) [HIGH] - a quit in the middle of a save deleted the only copy of the recording

- **Bug.** T-127 (3) made `before-quit` wait for every latch run to end, and listed what it did not cover: the recording's save convert, an import transcode and the extraction of a recording's sound ("not a latch run"). The sweep-17 reviewer executed the first: a window X or `app.quit()` in the middle of the MP4 convert left the half-written `take.mp4` at the name the person chose AND `abandonAllRecordingStreams` - the sweep that follows the wait - unlinked the temp webm in `userData/recordings`, the take's only copy. Both gone is a lost recording, from a person who asked to close a window. The import transcode left its partial in `%TEMP%\imagii-import`, the extraction up to 1.3 GB of WAV in `%TEMP%\imagii-audio`, for the 6-hour reaper.
- **Fix.** A convert is a run (`beginConvertRun`; `convertForImport` holds its own): the recording's save opens it once the Save dialog has answered (a dialog nobody has answered is not work, and a quit with one open must not wait on it) and ends it after the cleanup, the extraction is a run (`extractLatch`) until its WAV is gone, and `cancelConverts` / `cancelAllConverts` / `cancelAllExtractions` mark the runs they are aimed at (a cancel that lands while a folder is being made spawns nothing). **A quit is not a Discard**: `ConvertCancelledError.byQuit`, set by `cancelAllConverts`; the save removes the half-written output either way and removes the raw take only when the person discarded it. The quit sweep skips a CLOSED session (mid-finalize: the Save dialog, the convert), as the reload's has since T-124 (3): what the sweep owns is a take still being recorded. `recording:finalize`'s own `finally` no longer unlinks after a save the quit ended. An import transcode that fails or stops removes its partial.
- **Test.** `recordingQuit.test.ts` (the real convert module and latch over a fake child, a 150 ms unlink: the quit is released only after the partial is gone, the raw take survives, the webm branch is the same, a Discard removes both, an open dialog is not a run), `recordingStream.test.ts` (the sweep leaves the closed session), `convertQuit.test.ts` (7), `extract.test.ts` (4), two Layer 5 cases (media.spec.ts: the real SIGKILL on a real ffmpeg and the real removal, green on 7.0.2 and 6.1.1; red on the round-77 bytes of `convert.ts` and `extract.ts`: `expected [ 'quit-import-HPWxPF99.mp4' ] to deeply equal []`, `expected [ 'x2_85lzXVN.wav' ] to deeply equal []`), and three E2E in video-pipelines.spec.ts that quit by the window's X in the middle of each job in an app whose temp folder is its own (`TMPDIR`) and read the folders after the app has exited. **Red-first on the pristine build:** `no half-written mp4 at the name the person chose`, `Received ["t128-import-quit-aKbOI9WY.mp4"]`, `Received ["wtPTx9INfS.wav"]`, and, in the first run of the recording case, `the raw take survived the quit ... Expected ["H-pDBMOMdQ.webm"] Received []`: the take was gone. **The e2e had to be made to discriminate:** with nothing patched the unfixed app removed the extraction's WAV and the transcode's mp4 in time (the cleanup is a few milliseconds and the window's teardown takes about as long), so the extraction case PASSED on the pristine build. The three cases patch `fs/promises.unlink` in the main process to take 600 ms for the job's file (`installSpawnStall`'s technique: a built-in patched, published with `syncBuiltinESMExports`), a slow disk; the fixed app waits for it (the drain's ceiling is 1.5 s), the unfixed one exits first. Eleven breaks, each failing a named case (the drain's run, the byQuit flag, the sweep's skip, the handler's second unlink, a run that ends before the cleanup, a cancel that marks every owner), four of them through a rebuilt app.
- **Not covered, stated.** The raw take that a quit keeps is in `userData/recordings` until the launch sweep reaps files older than 6 hours; there is no recovery screen (T-110 (u) is the product call about keeping the take when any save fails). The caption model's download partial is still not a run. The extraction handler's own probe (`audio:extractFromVideo` asks ffprobe before it extracts) is not one; a quit there spawns nothing because the app is gone before the extraction would start.
- **Lesson.** **When you teach a quit to wait for cleanup, ask what the NEXT step of the quit deletes.** The wait made the sweep after it run on a take whose save had just been cleaned up, and the sweep's rule ("everything registered is mine") was older than the save. A cancel carries WHO cancelled it when the cleanup differs: a Discard and a quit are the same SIGKILL to the child and opposite promises to the person. And a test that races the platform proves the platform's speed: make the slow case slow.

### (6) [LOW] - five spellings of one alphabet (T-110 (ad))

- **Bug.** `[A-Za-z0-9_-]`, the alphabet nanoid mints, was written out in `customPresets`, `moodboard`, `ipc/search`, the recording sessions and the video job ids beside the shared `isSafeId`; `video:deleteCustomPreset` checked "non-empty" at the handler and left the rest to the store, where `audio:deletePreset` holds both since T-117.
- **Fix.** `SAFE_ID_RE` exported from `pathSafety.ts`, the five sites import it, and the handler gains `assertSafeId`.
- **Test.** `pathSafety.test.ts` fails on a second `[A-Za-z0-9_-]` anywhere in `src` (comments aside; base64 and `\w` are other classes), requires the five sites to import and use the constant, and holds it free of `g` / `y` (a stateful `test()` answers differently the second time); `videoCustomPresetIds.test.ts` (a spy on the store: the handler refuses before it is asked). **Red-first:** 15 failed on the unchanged sources.
- **Lesson.** **A fix that lands in the shared function leaves the copies that were written before it existed.** T-117 made the helper and recorded five copies in the ledger; the pin that there is one literal is what turns the ledger line into a test.

---

## 2026-10-15 — T-127 (round 77): an app that said "zero network requests on startup" and phoned Google on every launch, a quit that left half a file at its final name, and a compilation that walked 190 ms off its sound

The sixteenth pass (the sweep's verified findings, expediter-ticketed; 16 items, every one a change). The pattern: **the claims that were false were the ones nothing could fail** - README's "zero network requests on startup" was held by a scanner of OUR source, and the traffic came from the platform; "Cancel deletes the wreckage" was tested for the button and not for the other way a job ends; "under 15 ms per segment" was measured on segments that are a whole number of frames, which is the one shape that cannot drift.

### (1) [HIGH] - the app contacted Google on every launch, and the README said it did not

- **Bug.** A net-log of the BUILT app left idle for 30 s (`--log-net-log`, capture mode Everything, closed gracefully so the log is a complete document) held 15 http(s) requests: one to `redirector.gvt1.com/edgedl/chrome/dict/en-us-10-1.bdic` at 35 ms (Electron's default spellchecker downloading its Hunspell dictionary) and 14 to `dns.google` (Chromium probing the DNS-over-HTTPS endpoint of a machine whose resolver is a known provider, here 8.8.8.8: the first at ~5 s, then backing off). By the raw `"url"` tally the expediter's capture used, that is 4 for the dictionary and 42 for `dns.google`; mine matched it exactly. No source scan can see either (`networkAllowlist.test.ts` reads our code), and no test launched the app and looked.
- **Fix.** `app.configureHostResolver({ secureDnsMode: 'off' })` and `session.defaultSession.setSpellCheckerLanguages([])` as the first statements of the `ready` callback, ahead of the window, and `spellcheck: false` in the window's `webPreferences`. **The ticket's mechanism (i) alone was not enough, measured:** `webPreferences.spellcheck: false` plus DoH off took `dns.google` from 42 to 0 and left the dictionary request in place (that option stops the renderer's checker; the dictionary is downloaded by the browser-side `SpellcheckService`, created with the first renderer); `session.setSpellCheckerEnabled(false)` did not stop it either; `setSpellCheckerLanguages([])` (it empties the dictionary list AND turns the checker off) did: 0 requests, 11 log events, not one DNS transaction. It must run EVERY launch: the list is a persisted preference that Electron re-seeds with `en-US` when it finds it empty.
- **Test.** smoke.spec.ts `the built app makes no network request` launches the built app with a net-log, idles 8 s past ready (the first DoH probe lands ~5 s in), makes ONE loopback request from main (the control: the log must hold exactly that request, so a log that records nothing fails instead of passing "zero"), closes the app, and reads the log: no http(s)/ws/ftp `URL_REQUEST_START_JOB` but the control, and no resolver lookup of a host other than this machine. `interactionWiring.test.ts` pins all three calls and their order ahead of `createWindow()`, on every machine (the DoH leg of the e2e only shows where the resolver is a DoH provider; the dictionary leg shows anywhere). **Red-first:** on the round-76 bytes the failure is `received [".../en-us-10-1.bdic", "https://dns.google/dns-query" x6, control]`; with each call removed alone: no `configureHostResolver` +6 `dns.google`, no `setSpellCheckerLanguages` +1 dictionary; with the control not made, `[] != [control]`. Removing `spellcheck: false` alone is NOT red in the e2e (the empty language list already stops the download): that leg is held by the wiring pin only, and six breaks of the pin each fail it.
- **Release run.** The mechanism is platform-independent and the proof ran on Linux; the win32 release run confirms it on the shipped binary (TESTING, "the release run's hand-checks").
- **Lesson.** **A privacy claim is a property of the running program, not of its source.** A runtime's defaults are network calls (a spellchecker, a resolver, an updater, a crash uploader): audit the DEFAULTS, and hold the claim with a test that launches the build and reads what the network stack did, with a control that proves the log can see.

### (2) [MED] - Export's Cancel sat where the primary had just been

- **Bug.** T-126 (20) gave Compile, GIF and PiP a row for Cancel and left Export, whose Cancel stayed in the header beside the primary: "Export 1 file" is wider than "Exporting...", so the second press of a double-click landed on Cancel, and with ONE job there is no confirm (QA: 3 times in 3 at 60, 120 and 200 ms: "Export canceled." and no mp4). Measured on the round-76 build: the idle primary spans x 771-881, Cancel 809-881.
- **Fix.** Cancel moves to its own right-aligned row under the header (the siblings' classes and a `title`); the two-or-more-jobs confirm modal is unchanged.
- **Test.** video-pipelines.spec.ts: the (20) geometry test now includes the Export card (Cancel below the primary's box, no overlap, one file, no canceled toast), and `a second press on Export at a human pace` (two real mouse clicks 120 ms apart on the right part of the button, the encode held 2.5 s): the export is still running 400 ms later, finishes, and its file lands. **Red-first:** `Cancel (x 809-881, y 633-667) has a row of its own, below where the primary was (x 771-881, y 634-666)` and `the second press did not stop the export ... element(s) not found` on the round-76 bytes; ExportPanel at its old bytes alone fails both.
- **Correction.** T-126 (19), (20) above said that in the Xvfb font the second press misses Cancel by ~50 px, "so the double-click alone is not a witness here". That was a property of a missing typeface: Inter ships since T-126 (18), widths no longer depend on the machine's fonts, and on this card the second press hits Cancel. The geometry measure stays (it is stable), and the human-paced press is a witness again.
- **Lesson.** **A guard that exists once is a convention nobody follows** (again). When a fix is a layout rule for a family of cards, list the cards, and measure each.

### (3) [MED] - a quit in the middle of a job left half a file at its final name

- **Bug.** Cancel deletes a half-written output (T-100); the window's X and `app.quit()` did not. `before-quit` SIGKILLs every child and returns; the deletion runs later (the child's `close`, then the runner's failure path), and the process was gone first. Executed 6 times in 6: `vid_c1_youtube.mp4`, ~1.5 MB with no moov atom, and the next export of that clip landed at "(2)"; a re-attach left its `.cleaned.wav` (~0.7 GB per hour of audio). `process.ts` said the intermediate "dies on any failure or cancel": false at quit.
- **Fix.** The smaller diff that passes: `before-quit` waits, once and at most 1.5 s, for every run to END, then re-enters. Every runner (export, reframe, GIF, compile, frame, highlights, audio, caption burn-in and transcription) ends its `CancelLatch` run in a `finally`, AFTER its tested failure-path cleanup, so `drainRuns()` (a module-level count across every latch, `cancelLatch.ts`) reuses that cleanup on every platform with no per-runner change; an unlink registry swept synchronously would have raced the killed child's file handle on Windows (the awaited path runs after `close`). `runAudioReattach` holds a run of its own until its `.cleaned.wav` unlink is done (the two passes' runs end before it), and the docstring is now true.
- **Test.** `cancelLatch.test.ts` (the drain: immediate with nothing running, waits for the END and not the cancel, counts every latch, ended-twice counted once, ceiling, and a scan that every runner is `try { return await work } finally { run.end() }`, because a bare `return work()` would end the run before the work settled), `reattachCollision.test.ts` (the mux child killed with a 150 ms unlink: the quit is released only after the WAV is gone), `interactionWiring.test.ts` (the handler's shape), and two e2e (video-pipelines.spec.ts: the window's X in the middle of an export and in the middle of a re-attach; the folder is empty after the app has exited). **Red-first:** `nothing is left in the folder after the quit ... Received ["t127-quit_Clip 1_youtube.mp4"]` and `Received ["result.cleaned.wav"]` on the round-76 build, and with the drain block removed alone. Seventeen breaks of the latch, the handler, the runner shape and the re-attach run each fail their named case.
- **Not covered, stated.** A convert (the recording's save, an import transcode) is not a latch run and its output cleanup lives in `recording.ts`; extraction scratch WAVs rely on the 6 h reaper; the model download's partial file. A quit mid-save of a recording is a separate path. *Added by T-131 (17):* and a Windows shutdown, restart or logoff: Electron emits no `before-quit` for it (its own typings), so the autosave flush, this drain and the kill do not run on that one exit path (T-110 (az)).
- **Lesson.** **A cleanup that runs after the kill is not done until something waits for it.** Test the other way a job ends, and say in the comment which exits the claim covers.

### (4) [MED] - a compilation's joins walked the picture 190 ms off its sound

- **Bug.** A segment whose length is not a whole number of frames wrote one or two extra video frames (the fps stage, a fractional `-ss`, the end-of-file fill). The join's concat demuxer offsets the next segment by the picture-led container length and the join's AAC encode swallows the gap in the sound: cumulative. T-125 (1) measured "under 15 ms per segment" on segments cut on the frame grid from a 30 fps source, the one shape that cannot show it.
- **Fix.** `-shortest` in the segment's argv, ahead of its path (reviewer-verified; every compile Layer 5 case stays green).
- **Test.** Layer 5 `fractional segments do not walk the picture off its sound across the joins`: eight fractional segments of a 25 fps flash-and-beep source through the real `runConcat`, the SERIES of picture-minus-sound lags per flash. **Red-first, identical on 7.0.2 and 6.1.1:** `3 / 57 / 83 / 112 / 125 / 161 / 194 / 194 ms` (spread 191); with the fix `3 / -3 / 7 / 0 / 0 / 0 / 0 / 0` (spread 10, asserted <= 15). Unit: `concatRunner.test.ts` (one `-shortest`, after `-i`, last before the path; three breaks).
- **Correction.** T-125 (1)'s "the beep stays on the flash at every segment (under 15 ms)" is true per segment and was false across joins for any cut that is not a whole number of frames, which is nearly every cut. The T-125 (1) entry now says so.
- **Lesson.** **Measure a time axis on the shape the product actually produces.** A fixture that cannot show the bug is a green that costs a sweep.
- **Correction (T-131 (1)).** The Fix line above is incomplete: `-shortest` alone is only safe when the sound covers the picture. On a source whose sound is SHORTER (Record's own mic-drop takes), it ended a segment where the sound ended, a range wholly past the sound came out as an exit-0 stub, and the join silently dropped every segment from the stub on while the panel said "Saved" (10 s picture, 6 s sound, `[1,3] [7,9] [2,4]`: 2.0 s instead of 6.0). The segment's last `-af` stage is now `apad=whole_dur=<its length>` beside the kept `-shortest`, and the join fails loudly. The drift series above was green throughout because its fixture's sound was as long as its picture.

### (5), (6), (12), (13), (14) [MED / LOW] - the network guard's gaps, called the last (they were not: T-131 (10)-(12))

- **Bug and fix.** Each returned `[]`: `new window.WebSocket(u)`, `new globalThis.XMLHttpRequest()`, `new window.Image()` (a constructor reached through a global: `window.`, `globalThis.`, `self.`, any other qualifier such as `new Konva.Image(` stays unmatched on purpose); `process.getBuiltinModule('node:https')` and `createRequire(import.meta.url)('node:net')` (sites like `eval(`), `export * from 'node:https'` and TypeScript's `import x = require()` (judged like imports; a type-only export loads nothing); `window.top.location.href = u` (any chain of globals, `.hash` still stays in the page); a bracketed IPv6 URL literal; `image-set(` beside `url(` in the computed-CSS branch and in the style-sheet scan; `document.createElement` of any loading tag and of `a` (`a.href = u; a.click()`); `devDependencies` (Vite bundles from either section). `window.eval(` and `new window.Function(` ride on the same qualifier. The header now declares what it cannot see: the PLATFORM's own traffic (pointing at (1)'s net-log test), `fetch` used as a value, and the Hugging Face 302 to its CDN; a test fails if a `.js`/`.jsx`/`.mjs`/`.cjs` file or anything deeper than the scan's eight levels ever appears under `src/`. Header-named shapes that had no case now have one each: `http.request`, `http.get`, `https.request`, and EVERY module the set names (a table written out in the test, so a module dropped from the set fails it).
- **Test.** 13 new cases in `networkAllowlist.test.ts` (19 to 32). **Round-21 proof:** 38 breaks, each failing its named case (the first batch had 11 rows that were not red: ten were my own substring checks on a failure message vitest does not print, one an invalid regex edit, and one negative that discriminated against nothing; they were fixed and the whole batch re-run on the final bytes).
- **Lesson.** **A closed vocabulary is a list of what someone thought of.** Each round's gap was a spelling of something already on the list; invert the question where you can (the CSP is judged by what is local) and write the table out where you cannot.

### (7) [LOW] - the Source time row spoke two languages

- **Bug.** The boxes picked their own form: "3590.00 -> 1:00:10.00 s", a trailing "s" on a clock, and labels that still said "(seconds in the source video)".
- **Fix.** `overlayTimePair`: the PAIR decides (either at one hour or more: both are the clock, and the unit belongs only to the seconds form), on `overlayTimeText`'s one boundary (the outside-the-clip sentence's own copy of `>= 3600` is deleted: it disagreed at 3599.996). Labels: "Source time, start/end (seconds, or a time like 2:47:13)".
- **Test.** `textOverlay.test.ts` (5), the wrap-unit pin, and video-core.spec.ts (over: no "s", both clock; under: the "s" is back, both seconds; 59:50 beside 1:00:10 is one form). Red both ways: the unit always drawn fails `a clock has no unit`, never drawn fails `and the "s" is back`, per-value forms fail the start box. 
- **Lesson.** **A display rule that depends on two values is a function of the pair.**

### (8) [LOW] - the second click of a double-click closed the question the first one asked

- **Bug.** Export raises the safe-zone question on click 1 and click 2 lands on the scrim (the button is outside the centered card) and closed it.
- **Fix.** The shared `Modal`'s scrim ignores a click whose `detail` is above 1 (one change covers every dialog; the T-123 (7) press-in-the-card rule stays).
- **Test.** video-pipelines.spec.ts: a double-click on Export leaves the dialog open and nothing exported; one click on the scrim still closes it. Red: `the question is on screen after the double-click ... element(s) not found`. Wiring pin with four breaks.

### (9) [LOW] - the tour named a button by a label it only has while no folder is remembered

- **Fix.** "Click the folder button - it reads 'Choose folder...' until you have picked one - then click the Export button...". Pinned against `OutputDirLabel`'s empty state (the quoted-name check passes a label that exists in source, which is why it never caught this).

### (10) [LOW] - a recording whose header has no length lost the answer its streams had

- **Bug.** `probeAudio` threw "no usable duration" before computing `hasVideo`, so a durationless audio-only WebM or MKV was classified by extension: Re-attach defaulted ON (its mux dies on `-map 0:v:0`) and over two hours the person was sent in the circle T-126 (7) closed for files with a duration.
- **Fix.** `NoUsableDurationError(hasVideo)` (`shared/audio.ts`): same message, so every caller that only reads it is unchanged; `audio:extractFromVideo` reads the answer, so the extension decides only when nothing was read - which is what T-126 (7)'s sentence ("the extension only when the probe could not read the file") already claimed.
- **Test.** Layer 5 (`the extraction reads a picture from the streams`): the 2 h durationless audio-only WebM is now told the audio remedy, and a new case with two short streamed WebMs (sound alone, and a picture) answers `false` and `true` through the probe and the handler. Unit: `audioExtractCeiling.test.ts` (5), `audio.test.ts` (2). **Red-first on both majors:** `expected 'That file is longer than 2 hours...' to match /Split it into shorter files in another app/`, `expected null to be false`, `to be an instance of NoUsableDurationError`, `a picture?: expected false to be true`.

### (11) [LOW] - three more start handlers went straight to a native dialog

- **Bug.** `ThumbnailVariants.saveOne` / `saveAll` and `CaptionsPanel.saveSrt` had no claim: a double-click on "Save all" opened two folder choosers and wrote the set twice (8 files).
- **Fix.** ExportPanel's `startingRef` shape (one ref for both variant saves; a `saveSrtStartingRef`). `singleFlight` pins: eleven to fourteen.
- **Test.** image.spec.ts (a 300 ms dialog; one chooser, four files; one save dialog, one file; the claim is given back) and video-pipelines.spec.ts (Save .srt), red on the round-76 build: `one folder chooser, not two: Expected 1 Received 2`, `one save dialog, not two`. Six pin breaks.

### (15), (16) [LOW] - truncated names without their full self, and a placeholder in a colour no token owns

- **Fix.** `title` with the full name on the second track's line, both studio headers and the preset rows; one `@layer base` rule for `input::placeholder, textarea::placeholder` from `theme('colors.ink.dim')`.
- **Test.** The names: audio.spec.ts and video-core.spec.ts read the attribute off the rendered span (red: `Expected: "video-core.mp4" Received: ""`). The colour: `designTokensInSync.test.ts` (one rule in the base layer, no raw hex, AA on every surface: 6.20 / 5.83 / 5.33, six breaks). **Measured in the built app, not asserted from source:** `getComputedStyle(el, '::placeholder')` is not implemented in Chromium (it returned the INPUT's colour, which is how the first probe lied); the glyph pixels of a 64 px placeholder are `156,143,139` (ink-dim) on this build and `156,163,175` (the stock `#9ca3af`) on the round-76 build.

### What this round did not fix

- The other `truncate` spans with no `title` (mood board names, the post checklist's output name, the variant labels, Record's source names, the layer names, the highlight lines): the ticket named four; a scan for the rest is the upgrade.
- A quit in the middle of a recording's save (a convert is not a latch run), and the model download's partial file.
- Placeholder-only inputs remain nameless to assistive technology (T-110 (l)); only their colour changed.

---

## 2026-10-15 — T-126 (round 76): a picture two frames late on every 60 fps recording, a test that proved a font was loaded by asking about a font nobody had defined, and a fix that moved the overflow

The fifteenth pass (the sweep's verified findings, expediter-ticketed; 24 items, 23 of them changes and one closed with a comment). Four ffmpeg changes landed each with a real-media case on BOTH majors; the rest are layout and double-press fixes whose tests MEASURE the rendered thing. The pattern: **a check that cannot fail is the most expensive kind of green** - `document.fonts.check` answers true for a family nothing defines, `expectControlsWhole` passes a label that wrapped, a double-click's second press only lands on Cancel in the font the reviewer had - and three of this round's tests had to be redesigned because their obvious form passed (or could not fail) on the build it was meant to fail on.

### (21) [MED] - the picture sat two output frames behind its sound on every 60 fps recording

- **Bug.** `-r N` alone is the encoder's rate. Its vsync drops a frame only once the output runs more than 1.1 frames ahead, so any source whose effective rate is above the preset's (60 / 59.94 / 50 / 120 / 48 fps: OBS's usual) or a 30 fps clip at 1.25x / 2x left the picture late: the flash first visible at 5.0667 s where 5.000 s is right, 302 frames for a 10 s clip; the beep at 5.013 s either way.
- **Fix.** `fps=${preset.fps}` in `buildVideoFilter` right after the retime stage (so the resample honors the speed) and before scale/pad; one place covers export, Reframe and Compile. `-r` stays (it pins the muxer; a no-op on a constant-rate stream). Auto Zoom's path, which carried the stage already, was the control (0 ms).
- **Test.** Layer 5 `the picture lands on its sound at every frame rate (real ffmpeg, T-126 (21))`: a 60 fps flash+beep source through the real `runExportJob`, `runReframe` and `runConcat`, plus a 30 fps source at 2x; picture minus sound at every flash must be within 30 ms. **Red-first (stage removed, 7.0.2):** export 0 / 67 / 67 ... ms, reframe the same, compile 0 / 67 / 67 / 66 / 133 / 133, the 2x export 0 / 45 / 43 ...; on 6.1.1 the 2x export was 0 / 79. Unit pins in `filters.test.ts` / `concat.test.ts` / `reframe.test.ts`.
- **Lesson.** **A frame-rate option on the output is not a frame-rate filter in the graph.** If a number must hold on the picture, put it where the picture is made and measure it on the file at the far end.

### (23) [MED] - the highlight scan paid three times its time for numbers it threw away

- **Bug and fix.** Both loudness passes ran `ebur128=...:peak=true`; the parser reads only `t:` and `M:`. True peak oversamples every block 4x (14.7 s against 4.8 s on a 30 minute source). The filter is one exported constant, `EBUR128_SCAN_FILTER`, without `peak=true` (the `framelog=info` that makes the lines appear stays, T-09 / T-10).
- **Test.** Layer 5 `the highlight scans compute no true peak, and read the same series without it`: no `TPK:` and no true-peak summary on the production string, the control (`peak=true`) prints both, and the parsed `t` / `M` series are equal sample for sample; `highlightsArgv.test.ts` holds both argv builders to the constant. **Mutated:** `:peak=true` back in the constant - the unit case fails 3 of 4, Layer 5 fails on `TPK:`, both majors.

### (24) [MED] - an HEVC picture re-attached to its sound would not play on a Mac or an iPhone

- **Bug and fix.** The stream-copy re-attach writes a copied HEVC stream into an mp4 with ffmpeg's default tag `hev1`, which QuickTime, Safari and iOS refuse. `copyableCodec` now returns the codec, and a copied `hevc` gets `-tag:v hvc1`; h264 / av1 / mpeg4 / mjpeg and every re-encode are untouched.
- **Test.** Layer 5 `an HEVC picture re-attached to its sound plays on Apple players`: the control proves a naive copy lands as `hev1`, the re-attach is `hvc1` and decodes clean, h264 stays `avc1`, a cut HEVC is re-encoded `avc1`. **Mutated:** the tag line removed - `expected 'hev1' to be 'hvc1'` on both majors, 3 unit cases in `muxCodec.test.ts`.

### (22) [MED] - closed, not fixed: extraction of a file with broken timestamps

- **Premise tested and false.** The ticket's cap (`-t` against the probed duration) is a fix only if the probe still reads ~30 s on a +600 s `setts` jump. It reads ~630 s on every shape of the fixture (an audio-only jump, a jump in both streams, an mp4, and the reviewer's own file): the extraction's output matches the length the CONTAINER claims, which is also what every player and the app's own UI report. A timestamp RESET (real audio dropped) has no ffmpeg knob either (`first_pts=0` alone behaves the same). Nothing was implemented; the bound is recorded in the `EXTRACT_CLOCK_FILTER` comment in `extract.ts`.
- **Lesson.** **A cap needs a second opinion on the length.** When the only witness to a duration is the same container that is wrong, there is nothing to cap against - say so and stop (the ticket's own STOP rule did).

### (7), (8) [MED] - "is this a video?" was decided from the file name, and a refused extraction left its multi-GB WAV behind

- **Bug.** (7) An audio-only `.mkv` / `.mp4` (a podcast, a voice memo) was a "video": Re-attach was on by default (its mux dies on `-map 0:v:0`) and a 2-hour one was told to export a part from Video Studio, which refuses a file with no picture. (8) A file whose probe read no length was extracted first, and the only gate on the result was the renderer's, after the multi-GB scratch WAV existed; nothing deleted it until the 6-hour reaper.
- **Fix.** `probeAudio` reports `hasVideo` (a video stream that is not `attached_pic` cover art); the handler picks the sentence kind from it (the extension only when the probe could not read the file - true of a durationless file only since T-127 (10): `probeAudio` threw before computing `hasVideo`), returns `{ wavPath, hasVideo }`, and the renderer's `isPicture` sets `fromVideo` only for a real picture. After a fall-through extraction the handler reads the WAV's own length, and over the ceiling it deletes the scratch and throws the same sentence; the renderer's gate stays as the last resort.
- **Test.** Layer 5 `the extraction reads a picture from the streams, and a refused extraction leaves no scratch behind` (the real handler behind a stand-in `ipcMain`; 5 cases incl. cover-art mp3, audio-only mkv / mp4, a 2 h audio-only mkv told the audio remedy, and a 2 h durationless WebM refused with no WAV left); `audioExtractCeiling.test.ts`, `audioStore.test.ts`; audio.spec.ts `an audio-only .mkv loads as sound`. **Mutated:** extension decides (unit 5 failed, Layer 5 audio-remedy failed, both majors), the WAV kept after the refusal (unit 2 failed; Layer 5 `a ~1.4 GB WAV left` on 7.0.2 and 6.1.1).

### (10) [MED] - five panels stat-ing the same unreachable share parked the thread pool

- **Bug and fix.** `settings:get` stat-ed a folder key on every read, and four panels read the same key at once: on a NAS that is asleep each stat parks one of libuv's four threads (measured: with the pool parked a 3 ms read waited 3000 ms and an `imagii-file:` fetch queued behind it). `folderVerdict` makes ONE stat per path while it is in flight and races a 1 s deadline: `unknown` means the stored value is answered (the runner's `ensureOutputDir` still guards the write).
- **Test.** `folderVerdict.test.ts` (8) and `settingsFolderDeadline.test.ts` (5): six readers, one stat; a hung stat answers after the deadline; the missing-folder filter holds. **Mutated:** no dedupe (2 failed), no deadline (2 failed, 10 s), `unknown` hiding the value (2 failed).

### (2), (4), (5) [MED] - the mic-loss record vanished with its toast, the REC clock read "125:33", and the Source time boxes echoed seconds beside a Timeline that spoke clock

- **Fix.** (2) `watchMicEnd` records how far into the take the microphone stopped (a ref for the saved toast's closure, state for the render): "Microphone stopped at 02:14 - no sound after that" stays on the REC header, repeats on the saving card and is the saved toast's second sentence; a clean take shows none of the three. (4) `formatTimer` (the shared `formatClock` with the minutes padded below an hour; `1:00:00` from one hour up) replaces Record's own `mm:ss`. (5) `overlayTimeText` shows the Source time boxes as the clock from one hour up (below an hour the seconds form stays), the outside-the-clip note speaks the same, and the teaching line gains "or a time like 2:47:13"; "2:47:13" is no longer rewritten to "10033.00" when the box is left.
- **Test.** record.spec.ts (the loss take: header line, card line, toast text; the clean take: none of the three; the REC clock two hours in reads `REC 2:00:0x`), `clockTime.test.ts` (59:59 -> 1:00:00), `textOverlay.test.ts` (the hundredths are exact: a float's `.57` is not `.56`), video-core.spec.ts (the flipped `3723.00` / `3601.50` pins). **Red-first (round-75 build):** the loss take has no header line; the REC clock is "REC 120:0x"; the box reads `3723.00`. **Mutated:** `micLostLine(null)` returning a line - the clean-take case fails.

### (3) [MED] - a refused Source time was an 8-line column beside its box

- **Bug and fix.** A label-less `DraftField` returned `<>{box}{refusal}</>`, so inside the overlay card's `flex items-center` label the `role="alert"` sat BESIDE the box (70 px wide at the 224 px row; for the end box, between the box and its "s"). The sentence is `basis-full order-last`, and the two rows that hold a Source time box (the label and the end unit) wrap. A wrapper around box + refusal was the ticket's first option and was not used: the boxes' own classes (`flex-1 min-w-0` in the Image Studio properties) are flex-item classes of the caller's row and a wrapper takes their place.
- **Test.** video-core.spec.ts `a refused Source time is one full-width sentence under its box, over nothing` (the sentence is below its box, at least 90% of the row wide, starts at the row's left edge, at most four lines, inside the card, over nothing, and the "s" stays on the end box's line) at 1632 and 1024; `interactionWiring.test.ts` T-126 (3). **Red-first (round-75 build):** 80 px of a 240 px row beside the box, 16 messages. **Mutated:** `order-last` dropped - the "s" falls 70 px below its arrow; `basis-full` dropped is NOT red (a wrapping row already gives a 520 px sentence its own line - it is kept as the guarantee for a shorter sentence).

### (6) [MED] - Export's folder button opened the chooser wherever the OS last was

- **Fix and test.** `pickOutDir` passes `outDir` like the hook and Clip Kit do. video-pipelines.spec.ts `Export's folder button opens the chooser on the folder it shows` records the dialog's `defaultPath` (red on the round-75 build: `undefined`); `interactionWiring.test.ts` pins the call (mutated: bare `pickOutputDir()`).

### (11)-(15) [MED] - readouts, primaries and headers the rendered page squeezed, and the check that could not see it

- **Bug.** Fixed-width readouts in flex rows had no guard ("300 ms" wrapped; the row changed height as the slider moved; "-10.0 dB" wrapped at every window size), Reframe / GIF / Compile primaries wrapped to two lines beside a long folder name, "OUTPUT PREVIEW" broke mid-word, and a 3-hour VOD's clock wrapped in the transport row at 1024.
- **Fix.** `shrink-0 whitespace-nowrap` on every fixed-width readout (fourteen, in twelve files, kept by a scan: `interactionWiring.test.ts` T-126 (11)); `whitespace-nowrap` on the three primaries and `min-w-0` on the folder chip; `PanelHeader` is a wrap-capable row (heading never wraps, the actions drop whole to a second row); the Reframe title is "Reframe to 9:16"; the transport's clock and Crop guides keep their width and the probe line gives (`truncate` + `title`); the ducking sliders' label and readout have a gap.
- **Test.** video-pipelines.spec.ts / audio.spec.ts measure each at 1632 and 1024 (and 2560 for the second-track card): `expectOneLine` (now the TEXT's height: a padded `btn-primary` read as two lines), the row height at both ends of the slider, `expectSelectsWhole` for every preview platform. **Red-first (round-75 build):** the fade readout wraps at both sizes, all three primaries wrap, the clock and "Crop guides" wrap at 1024, the gain readout and "Remove" wrap and the Threshold label sits 1 px from its readout. **Mutated:** `PanelHeader` at its old bytes - "OUTPUT PREVIEW" wraps.
- **What the geometry found that the ticket's mechanism did not (each fixed here).** (a) With the readout `shrink-0` the Compile row overflowed its card by 27 px - a range input's default width is its floor; `min-w-0` on the six `flex-1` sliders beside the guarded readouts makes the slider the item that gives. (b) With the chip button `min-w-0` its inline-flex label kept its min-content width (156 px in a 127 px button), so the ellipsis never fired and the text painted past the button; the chip label is `w-full max-w-[9rem]` (the first try, `max-w-[min(9rem,100%)]`, lost the cap while the button was being sized and the Export card's button went 240 px out of the card: the T-125 (11) case caught it in the full run). (c) "-10.0 dB" is 58 px in a 56 px `w-14` box in Liberation Mono, so the gain readout's width is a floor (`min-w-[3.5rem]`).
- **Lesson.** **A wrapped label has no overflow, and a squeezed one has no clipping.** Measure the line count and the gap, not the box; and when you stop one item shrinking, ask which item gives instead, and measure that one.

### (16), (18) [MED] - selected text was Chromium's stock blue, and the guides named a font that nothing shipped

- **Fix.** (16) `::selection` in `@layer base`: the accent at 40% with ink-base on it (8.94 : 1 on bg-base, 8.38 on bg-elevated, 7.74 on bg-hover); the alpha is READ from the stylesheet by `designTokensInSync.test.ts`, which fails on a second rule, another ink, or a wash that takes a surface under 7:1. The open `<select>` list's highlight row is the OS's and no CSS reaches it: DESIGN_GUIDE says so. (18) `@fontsource/inter` latin 400 / 500 / 600 are imported by `main.tsx`; the build emits the woff2 files beside the page.
- **Test.** smoke.spec.ts `Inter is bundled`: every `url()` in the built style sheets is a file in the build (no scheme, no host, no `@import`) and the page loads all three weights. **The ticket's check was vacuous:** `document.fonts.check('500 12px Inter')` is TRUE for a family nothing defines (measured on the round-75 build: `check` true, zero faces), so on its own it passes on the unfixed build; the test asks `document.fonts.load(...)` for the matching faces and requires them `loaded`. **Red-first:** the round-75 build has no Inter in its built sheet.

### (19), (20) [MED] - seven start handlers claimed "busy" after their first await, and Cancel sat where the primary had been

- **Bug.** `ExportPanel.startExport` was the only start handler with the claim-first `startingRef`; Compile, GIF, Reframe, PiP, Clip Kit, Captions burn-in and Audio Export claimed after the chooser or the save dialog, so a double-click ran two (executed: two choosers and two output files). And in Compile, GIF and PiP the busy row drew Cancel beside the `ml-auto` primary, whose busy label is shorter: the second click of a double-click could land on Cancel and cancel the job it had just started.
- **Fix.** The `startingRef` pattern byte for byte on all seven (`if (ref.current) return` first, claim before the first await and before the refusing checks, release in `finally`); Cancel has a row of its own in Compile, GIF and PiP (Reframe's precedent).
- **Test.** `interactionWiring.test.ts` (the seven join the four `singleFlight` pins: eleven); video-pipelines.spec.ts `a double-click on Compile opens ONE chooser and writes ONE file` (300 ms chooser), audio.spec.ts `a double-click on Export opens ONE save dialog and writes ONE file`, and `a double-click on Reframe, GIF, Compile and Picture-in-picture runs the job to its end` (the encode held 2.5 s; Cancel's box is below the primary's). **Red-first:** the pins fail on the round-75 bytes of all seven files and on 14 single mutations (claim removed / release removed, per file); two choosers / two save dialogs on the round-75 build; Cancel on the primary's row in each of the three panels (per-panel, with that panel at its old bytes).
- **Honest limit.** In the Xvfb font the round-75 build's second press does NOT land on Cancel (it misses by ~50 px), so the double-click alone is not a witness here; the measured geometry (Cancel on its own row) is. *Corrected by T-127 (2): that was the missing typeface. Inter ships since (18), widths no longer depend on the machine's fonts, and on the Export card the second press does land on Cancel (idle primary x 771-881, Cancel x 809-881); the geometry measure is still the stable witness.*
- **Lesson.** **A guard that exists once is a convention nobody follows.** The fix for the first double-press (T-125 (18)) was one panel; the sweep found it in six more. When a fix is a pattern, list the places that need it and pin each by name.

### (1) [MED] - the allowlist guard was still narrower than its claims

- **Bug.** The CSP check named what looked remote (`/^(https?:|wss?:|ftps?:|\*)/`), which passes a bare host, `host:port`, an IP, `localhost:*`, a wildcard host and any scheme in capitals; `net.request` matched only by exact spelling; an aliased `spawn` / `useImage` / `net` was invisible; `crashReporter.start` was claimed by the header and had no branch; navigation (`location.href =`, `assign`, `replace`), `setAttribute('src')`, SVG loaders, `<input type="image">` and a computed CSS `url(${})` were not in the vocabulary.
- **Fix and test.** `networkAllowlist.test.ts` is 19 cases (it was 12). The CSP is judged by what is LOCAL (a quoted keyword, a nonce or hash, `data:` `blob:` `imagii-file:` `filesystem:`), in every directive and every letter case; the HTML check gets the same inversion; `child_process`, `use-image` and `wavesurfer.js` are sites at their import (a type-only import is not), calls are judged through the alias map, `net` counts only from `electron`; 17 files gained an `import:child_process` / `electron:net` line in ALLOWED. The header's claims are each a branch with a case or are listed as not seen. **Red-first:** all 43 new positive expectations fail on the previous scanner (none is vacuous); **mutated (round-21 protocol):** 35 breaks of the branches the new negatives protect (the `.hash` write, a location read, `str.replace`, a class `setAttribute`, `<input type="text">`, `url(#fragment)`, a type-only import, an alias from another module, `const { net } = totals`, `timer.start()`, case-insensitivity, the exception list ...), each fails its named case and is restored byte for byte.

### (9) - the Layer 5 case title that named a limiter it did not test

- `media.spec.ts` "a cut with a high-pass, hum removal, a compressor and the limiter after it" is now "a cut followed by a high-pass, hum removal and a compressor": since T-125 (15) every non-empty chain ends in the limiter, so the phrase was redundant; the case pins that the 4096 re-chunk is byte-neutral through those stages.

### Existing tests this round changed (each a verdict, not a drive-by)

- E2E: the ratio readout is "8:1" / "8.5:1" (and `aria-valuetext`), not "8 :1" (12); the Source time boxes read the clock from an hour up (5); the Reframe title is "Reframe to 9:16" (14); `expectOneLine` measures the text's height (13). Unit: `truthInCopy.test.ts` and `interactionWiring.test.ts` follow the title, the teaching line, the chip's `w-full max-w-[9rem]` and the Source time rows' `flex-wrap`; `a11ySweep.test.ts` still finds the refusal wiring (the long comment moved to the component doc).

### Deviations from the ticket (each disclosed to the expediter)

- (3) `basis-full order-last` and wrapping rows, not a wrapper. (4) `formatTimer` is a shared helper over `formatClock` (the padded form below an hour). (5) `overlayTimeText` builds the hundredths from whole hundredths (a float's `.57` printed `.56`). (11) Beyond Compile's readout: fourteen readouts audited in total and the six sliders given `min-w-0`; the chip label is `w-full max-w-[9rem]`; the gain readout is `min-w-[3.5rem]`. (14)(i) cannot be shown red here: with the short title the readout fits one line even without `whitespace-nowrap`; it is kept as the ticket says and measured green. (22) closed. (18) the check is `fonts.load`, not `fonts.check` alone.

### Found, not fixed

- Item 22's corrupt-timestamp limitation (above). `basis-full` on the refusal sentence is currently redundant. See the round-76 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-15 — T-125 (round 75): a join that added 29 ms every time it ran, a scope error called a decision, and a store that read the setting once

The fourteenth pass (the sweep's executed probes, then the expediter's tickets; every item expediter-verified). Twenty-seven behavior, layout and copy items, five of them ffmpeg changes that each landed with a real-media case run on BOTH majors (the bundled 7.0.2 and the shipped 6.1.1), and the docs that ride along. The pattern: **the round's findings were mostly premises that nobody had measured** — "Light removes the least", "grade stays out matching Compile", "the four buttons follow each other", "most of it should be waiting on Home". Each was a sentence in a comment, a ticket or the UI, and each was false.

### (1) [HIGH] - a compilation's sound drifted a third of a second behind its picture by the ninth clip

- **Bug.** Each segment was an MP4 with AAC sound and the join stream-copied them. The AAC encoder primes with 1024 samples of silence and writes an edit list; a stream copy keeps the priming, so every join inserted 29.3 ms of silence before the next clip's sound: 0 / 30 / 59 / 88 / 118 / 147 / 176 / 206 ms at the eighth segment. Nothing in the picture changed, so no still-frame check could see it.
- **Fix.** The intermediate is Matroska with PCM sound (`SEGMENT_EXTENSION`, `SEGMENT_AUDIO_CODEC`; PCM has no priming and no edit list) and the join copies the picture and encodes the sound ONCE (`-c:v copy -c:a aac -b:a 192k`). The fades ride on the segment's `-af` ahead of the PCM write, unchanged. The segments are unlinked in the runner's `finally`, whatever their extension.
- **Test.** Layer 5 `a compilation keeps the sound on its picture across many joins (real ffmpeg, T-125 (1))`: eight segments of a flash-and-beep source through the real `runConcat`, the beep minus the flash measured at each (under 15 ms), and the scratch gone on finish and on cancel. **Red-first, both majors (the old join):** `the sound drifted off its picture: beep minus flash at each segment is 0 / 30 / 59 / 88 / 118 / 147 / 176 / 206 ms: expected 206 to be less than 15`. Unit: `concatRunner.test.ts` (the segment's `.mkv` and `pcm_s16le`, the join's argv, the list file, the fades). The segment extension is not behavior-bearing for the drift (PCM in an MP4 joins clean too, measured), so only the pin keeps the intermediate Matroska; the join's `-c:a aac` is both pinned and measured.
- **Lesson.** **A copy is only as good as what it copies.** "Stream copy, so nothing is lost" is true of the bytes and false of the clock when the stream carries an encoder's priming. Measure a pipeline's time axis at the END of the chain, across many joins, with a source that has an event on every second in both streams; one join looks fine.
- **Correction (T-127 (4)).** "The beep minus the flash ... (under 15 ms)" at each of eight segments was true of THAT case, whose segments are whole seconds on a 30 fps frame grid; it was false across joins for any segment whose length is not a whole number of frames (the picture fell 3 / 57 / 83 / 112 / 125 / 161 / 194 / 194 ms behind at eight fractional segments of a 25 fps source), and that is nearly every cut. `-shortest` on the segment fixes it; Layer 5 `fractional segments do not walk the picture off its sound across the joins` measures it.

### (2) [MED] - a video whose sound starts late was extracted with the sound at the start

- **Bug.** The extraction wrote the WAV from the first sample the container held, dropping the gap before it: a sound that begins 0.278 s into its video came out 0.278 s early in Audio Studio, in the transcription's clock and in the re-attached file.
- **Fix.** `EXTRACT_CLOCK_FILTER` (`aresample=async=1:first_pts=0`) puts the extracted WAV on the container's clock (a stream that starts late is padded, not shifted). A sound that starts with its picture extracts to the same bytes.
- **Test.** Layer 5 `a sound that starts late in its container stays where it was through the extraction (real ffmpeg, T-125 (2))` (the WAV, and Clean audio -> Re-attach). **Red-first, both majors:** `the burst in the WAV (the sound began 0.278 s into the file): 1.0213958333333333 s, expected 1.278 s`. Unit: `extract.test.ts`.
- **Lesson.** The sweep's own probe hid drift above 100 ms behind the same filter (hard compensation resets the clock), so the case measures the raw decode against `ffprobe`'s `start_time`, and uses the container-clock mode only for single-pass files. **A measuring tool that can repair what it measures needs a control.**

### (3) [MED] - "Light" removed MORE noise than "Medium"

- **Bug.** `afftdn`'s `nf` (the noise floor it assumes) and `nr` (the reduction) point in opposite directions: a HIGHER (less negative) `nf` removes more. The three strengths had `nf` falling with the name (Light -25, Medium -30, Aggressive -35), so Light removed 8.7 dB of a loud fan and Aggressive 4.7 dB.
- **Fix.** Light `nf=-35:nr=12`, Medium `-30:18`, Aggressive `-25:24` (`chain.ts`). The Custom noise floor's hint follows the preset it names: "-35 is the Light preset's setting." (the ticket said the hint stays; after the swap it would have named the Aggressive preset's number as Light's).
- **Test.** Layer 5 `the three denoise strengths are ordered by the noise they remove (real ffmpeg, T-125 (3))` (pink and brown noise through the real chain, the removed level measured). **Red-first, both majors:** `loud fan noise (pink, -44.6 dBFS): Light removes 8.7 dB, Medium 6.8 dB, Aggressive 4.7 dB: expected 8.728727 to be less than 6.762177999999999`. E2E (audio.spec.ts "every Cleanup control writes through to the chain"): `Expected pattern: /-35 is the Light preset's setting\.$/ Received string: "... -25 is the Light preset's setting."`.
- **Lesson.** **Name an ordering by what it MEASURES, not by what the parameter is called.** A preset named for a strength is a claim about a result.

### (4), (6), (7) [MED] - a recording with no header duration refused, the export's progress ran over the wrong length, and an AIFF or a WMA was treated as a video

- **Bug.** (4) Clean audio's two-hour pre-check treated "ffprobe could not read a length" (a MediaRecorder WebM carries none) as a refusal. (6) The export's progress was a fraction of the SOURCE's length, so a cut file finished at 50%. (7) Every sound taken out of a file was "from a video": an AIFF or a WMA offered **Re-attach to video** (a `-map 0:v:0` that cannot succeed) and was suggested the scratch WAV's name.
- **Fix.** (4) `audio:extractFromVideo` wraps the probe: only "no audio stream" (`isNoAudioStreamError`) is the probe's verdict; any other failure warns on the console and the extraction goes ahead without the pre-check. (6) `keptDurationSec(duration, cuts)` is the denominator of both passes (cuts and overlaps taken out, clipped to the file). (7) The one decision, `isVideoFilename`, is made in `loadSource`: a non-video source is `extractedFrom`, a project keeps it, and the suggested name is `convertedFrom ?? videoPath ?? extractedFrom ?? filePath`.
- **Test.** (4) audio.spec.ts `a recording whose header has no duration (a MediaRecorder WebM) imports: the probe not reading a length is not a refusal (T-125 (4))`, red-first on the pristine build: `expect(locator).toBeVisible() ... element(s) not found` at the waveform (a minute of waiting for a file that was refused). Unit: `audioExtractCeiling.test.ts` (**mutated:** a probe failure refuses again: `promise rejected "Error: ffprobe returned no usable duratio…" instead of resolving`, three kinds). (6) `exportProgress.test.ts` (**mutated:** over the source: `expected [ 33.33333333333333 ] to deeply equal [ 50 ]`; overlaps double-counted: `expected 180 to be 200`; not clipped to the file: `expected 150 to be 250`). (7) audio.spec.ts `a WMA loads and exports as the sound file it is: no "Re-attach to video", named for the WMA, written (T-125 (7))`, red-first: `expect(locator).toHaveCount(expected) failed Expected: 0 Received: 1` (the re-attach checkbox on a WMA); mutated: `named for the WMA, not for the scratch WAV: Expected: "take one-cleaned.mp3" Received: "ZcKE-WMsqy-cleaned.mp3"`; `ProjectIO.test.ts` (**mutated:** the store ignores `isVideoFilename`: `Export would default to "Re-attach to video" and fail on -map 0:v:0`).
- **Lesson.** **A probe that fails is not a probe that said no.** Collapse "unknown" into "refuse" and the first file the probe cannot read becomes a refusal of a file that was fine.

### (5) [MED] - the block the rest of the chain saw after a cut was the cut's, not its own

- **Bug.** T-124 (32) put `asetnsamples=n=256:p=0` ahead of `aselect` so a cut lands within 256 samples. The re-chunk applies to the WHOLE downstream chain: every stage after the cut (compressor, limiter, loudness) ran on 256-sample frames.
- **Fix.** `DOWNSTREAM_BLOCK_SAMPLES = 4096` appended after the retime (`asetpts=N/SR/TB,asetnsamples=n=4096:p=0`): a stage ahead of the cut sees 256, everything after it 4096, the samples unchanged.
- **Test.** Layer 5 `the cut stage hands the rest of the chain 4096-sample frames and changes no sample (real ffmpeg, T-125 (5))` (`ashowinfo`; a cut alone is the same bytes with the stage and without). **Red-first, both majors:** `a frame after the cut that is not 4096 samples: 256 (of 1290)`. **Mutated:** the stage removed (the chain pins and `a frame after the cut that is not 4096 samples: 256 (of 1290)`), a big block ahead of the select (the T-124 cut-accuracy case: `per-cut error ... 5.123-5.456 s: -77.0 ms ... expected 0.077 to be less than 0.0055`), the stage padded, and the stage placed before the retime (each red on the chain pins).

### (8) [MED] - typing "0.05" in an overlay's x committed 1, and a rotation of "-0.5" lost its sign

- **Bug.** `DraftField` handed the box back to the stored value on every usable keystroke. A number input reports "" for "0." and for "-", so after "0" (usable) the DOM said "" and the store said "0": React compared the two strings and rewrote the box, and the next digits stacked up behind a lost point.
- **Fix.** While the box has focus it shows what was TYPED (`setDraft(typed)` always), a usable value still goes to the store, and `finish` neither commits the same text twice nor keeps the draft past the blur.
- **Test.** video-core.spec.ts `text overlays: the position boxes take a leading decimal (.5 is 0.5, not 1), and a typed number is held to 0 to 1 (T-124 (15))` (now "0.05", and the typed text while focused), image.spec.ts `the x, y and rotation boxes take a minus sign and keep what is typed (T-124 (15))` (now "-0.5"). **Red-first (round-74 build, rotation):** `the sign and the point survive the digit: Expected: "-0.5" Received: "0.5"`. **Red with the fix mutated out (the old behavior restored in `DraftField`), both cases:** overlay x `".25" stays as typed while the box has focus: Expected: ".25" Received: "0.25"`, and the same rotation message. (The overlay case cannot be run against the round-74 build as written: its locators are the new names, see 27; the mutation is the evidence.) Unit: the wiring pin (**mutated:** the draft nulled on a live commit; the blur re-commits).
- **Lesson.** **A controlled input and a browser that normalizes its text are two writers.** Keep the draft until the person is done and compare numbers, not strings.

### (9) [MED] - Reframe still dropped the clip's text, grade, Auto Zoom and Hype Shake: the round-74 premise was FALSE, and the scope error was the expediter's

- **Bug.** Round 74 sent Reframe the crop and the speed and called the rest "out, matching Compile". Compile passes all four through `buildVideoFilter`. The T-105 lesson says the shared builder with a different frame, never another subset.
- **Fix.** `buildReframeGraph` is `buildVideoFilter` at the 9:16 frame; the ONE stage that differs is the aspect crop, swapped for the left / center / right strip through the builder's optional `position` argument (`StripPosition`). The even-dimension and `setsar=1` guarantees stay; the progress denominator is unchanged. The IPC checks the whole recipe (`assertUsableRecipe`), the panel sends `...clipRecipe(clip)`, the header reads the size of the CROP the strip is cut from, and the sentence says the clip's look is used.
- **Test.** Layer 5 `a reframed clip is the clip the user built: grade, text, zoom and shake (real ffmpeg, T-125 (9))` (the text case through the `drawbox` stand-in on every build, for real on 6.1.1, where the shipped binary has `drawtext`). **Red-first, both majors:** `brightened gray 47,47,47 vs 47,47,47: expected 47 to be greater than 87`; `the hook text is on 1.0 s into the clip (0 red px): expected 0 to be greater than 5000`. E2E: video-pipelines.spec.ts `reframe: the header reads the crop's size, not the source's, and the panel says the clip's look is used (T-125 (9))` (pristine: `getByText("with the clip's crop, speed, color, text and effects") ... element(s) not found`) and `reframe: the color set for the clip reaches the 9:16 file (T-125 (9))`. **Mutated:** each stage dropped in the builder (the grade, text, zoom, shake, color space), the position ignored, the IPC dropping the recipe or checking only the speed; the panel dropping `...clipRecipe(clip)` and reading the source's size.
- **Lesson.** **Say whose premise it was.** A ticket's "X stays out, matching Y" is a claim about Y, and nobody read Y. When two paths must agree, they call the same builder with a different frame; a second builder with a subset of the stages is the bug.

### (10)-(12) [MED] - a remembered folder that no longer existed was used silently, the four buttons did not follow each other, a long folder name pushed the primary button out of every card, and the PiP card cut its own select

- **Bug.** (10) A well-formed path to a deleted folder (or an unplugged drive's) was seeded into every button and written into; the failure blamed "a file imagii needs", and Compile ran its whole segment encode before finding out. USER_GUIDE already promised "a folder that is no longer a usable path is ignored". The four panels each read the setting once at mount, so a pick in GIF left Compile, Reframe and Picture-in-picture empty while the guide said they follow each other. (11) The chip drew the folder's whole name: a long one made the Reframe card 668 px of content in a 298 px box, its button 370 px past the edge. (12) In three columns the Position select drew "Bottom rig" and "Overlay width (px)" wrapped onto two lines.
- **Fix.** (10) `settings:get` answers a folder key (`export.lastOutputDir`, `clipKit.lastOutputDir`, `video.lastOutputDir`) only if the folder exists now (the stored value is left alone: the drive may come back), `video:pickOutputDir` applies the same test to the default it opens on, `ensureOutputDir` (recursive) runs before the probe and before `nextFreePath` in every runner (Compile before its first segment), and a folder that cannot be made is refused in a sentence that NAMES it (`outputFolderRefusal`). The four buttons are one zustand store (`useOutputDirStore`; the hook is its binding). (11) The chip is `max-w-[9rem]`, the name a `min-w-0 truncate` span, the path its `title`. (12) Two boxes to a row and the select on its own (`col-span-2`).
- **Test.** Three E2E cases (a deleted remembered folder is ignored by all four buttons and the action opens the chooser; a pick in one is the others' at once; a deleted-after-chosen folder is made again and an unmakeable one is named with an empty spawn log), Layer 5 `an output folder that is gone is made again before anything is encoded (real ffmpeg, T-125 (10))`, and the long-name layout case (all five cards, both window sizes). **Red-first (round-74 build):** `GIF: already follows the pick made in Reframe`; `Reframe: the deleted folder is not shown`; Layer 5 `expected 'ENOTDIR: not a directory, lstat ...' to be 'Couldn't create the folder "Clips". ...'`; layout: `the Reframe card at the default 1632 px window scrolls sideways: its content is 668 px wide in a 298 px box. Past its edge: <button> "Reframe to 9:16" +370px; <button> "Output folder: Stream_Highligh" +273px`, `the Position select showing "bottom-right" ...: "Bottom right" is cut off (70 px of text for 59 px of room in a 86 px select)`, `"Overlay width (px)" wraps onto 2 lines`. Unit: `settingsFolders.test.ts` (**mutated:** the read unvalidated: nine red), `useVideoOutputDir.test.ts` (**mutated:** pick not shared, remember not shared), `outputPath.test.ts`, `concatRunner.test.ts` (**mutated:** no early mkdir: `expected 'ENOTDIR: not a directory, lstat ...' to be 'Couldn't create the folder "Clips". ...'`; the sentence leaking the path), `videoPickOutputDir.test.ts` and `settingsClear.test.ts` (their fixtures pointed at folders that do not exist; they now name real ones, a verdict). **E2E with the fix mutated out:** the pick not shared (`Reframe: follows the pick made in GIF`), the stored folder unvalidated (`Reframe: the deleted folder is not shown`), the GIF runner without its mkdir (`Expected: true Received: false` after nine minutes of polling for a file that never comes), the chip without its truncation (`the Export card at the default 1632 px window scrolls sideways: its content is 1544 px wide in a 1216 px box`), the PiP card back in three columns (`"Bottom left" is cut off (61 px of text for 59 px of room in a 86 px select)`). **The six existing E2E cases that pressed Choose folder... in each panel in turn** timed out 30 s on the second panel (the button is no longer there): they assert the folder is shown (`expectFolderShown`).
- **Lesson.** **A fixture whose folder does not exist tests nothing once existence is part of the contract.** And **two states that must agree are one state**: four readers of a setting are one store.

### (13) [MED] - native controls rendered stock Chromium, and the toast marks were react-hot-toast's own green and red

- **Bug.** No `color-scheme` and no `accent-color`: blue checkboxes and sliders and light scrollbars on a near-black window, against BRANDING's no-competing-color rule; the toast tick and cross were `#61d345` and `#ff4b4b`.
- **Fix.** One `:root` rule, `color-scheme: dark; accent-color: theme('colors.accent.DEFAULT')`, and `TOAST_ICON_THEME` in `AppToaster` (`OK_STRONG` and `DANGER_STRONG` discs with `BG_BASE` glyphs, 10.08:1 and 7.20:1). DESIGN_GUIDE has the rule. No E2E compares a screenshot (they write them), so no pixel assertion moved.
- **Test.** home-chrome.spec.ts: the root's computed `colorScheme: 'dark'`, `accentColor: 'rgb(255, 49, 49)'`, the success disc `rgb(52, 211, 153)` and the error disc `rgb(251, 113, 133)`. **Red-first (round-74 build):** `Expected value: "rgb(52, 211, 153)" Received array: ["rgb(97, 211, 69)"]`; `Expected value: "rgb(251, 113, 133)" Received array: ["rgb(255, 75, 75)"]`. Unit: `designTokensInSync.test.ts`. **Mutated:** the `:root` rule removed, the toaster's `iconTheme` removed.

### (14)-(17), (27) [MED/LOW] - the overlay card: a zero-length window told the wrong sentence, "Size" counted nothing, a row wrapped between a glyph and its box, and the fields' names did not start with their labels

- **Bug and fix.** (14) An end typed before the start clamps TO the start; the window of no length got "its times fall outside the clip", false for one inside it. It has its own sentence now: "This text won't show in the export: its start and end are the same, so it never shows." (15) The Levels sentence said "With nothing switched on, the export keeps your levels as they are", which a cut alone falsifies (a cut makes the chain non-empty, so the limiter runs: -1.2 against -0.3 dBFS): "When you boost, switch something on or cut a part out, ...". (16) The two "Size" labels are "Size (px)" (the label column is `w-14`). (17) The arrow, the end box and "s" are one wrap unit. (27) Each field's accessible name BEGINS with its visible text (WCAG 2.5.3): "Source time, start (seconds in the source video)", the same for end, "x / y, horizontal position (0 to 1)" and vertical; the E2E locators and the two pins follow.
- **Test.** video-core.spec.ts `... a window that misses the clip is flagged ...` (zero-length inside the clip, outside it, back to the clip sentence, and none; **fix mutated out:** `inside the clip, and still a window of no length: Expected: "This text won't show in the export: its start and end are the same, so it never shows." Received: "This text won't show in the export: its times fall outside the clip, which runs from 0.00 to 2.00 s of the video."`); `the Text overlays card draws every control whole ...` (the label by its text; **pristine and mutated:** `the Size label says what it counts, at the default 1632 px window ... element(s) not found`); `the Source time row keeps the arrow with its end box and its "s" ...` (a new `expectSameRow`; **group removed:** `the Source time row's end half at the default 1632 px window: the end box is on a different line from the arrow (24 px lower)`, and the same at the 1024 px minimum); the names are checked by a loop over every labelled field (**pristine:** the new names do not exist; **mutated:** the start box back to "Overlay start second"). Unit: `textOverlay.test.ts` (**mutated:** the zero-length sentence falls through, or applies only inside the clip), `docClaims.test.ts` (**mutated:** the old sentence in the panel, the guide and the README: three red), and the wiring pins for 16, 17 and 27 (each mutated).

### (18)-(20) [MED] - Export could be pressed twice in a breath, two toasts were gone before they were read, and Clean audio could replace Audio Studio work

- **Bug and fix.** (18) `startExport` claimed the button only AFTER awaited settings writes, so a fast double-click showed the queue as Failed and Not run beside a batch that was running (main's gate stopped the second encode): a synchronous `startingRef` at the top, given back in a `finally`, and the safe-zone question's continue goes through `continueExport` under the same guard. (19) The Fix Wizard's Apply toast and the mood board's reference note carry a fact at the 2 s success default: `{ duration: ACTION_TOAST_MS }`. (20) Clean audio compared nothing after its extraction and always went to /audio: it holds `useAudioStore.getState().source` before the await and `replacedSince(heldBefore, now)` after it; a changed source loads nothing, navigates nowhere and says what it skipped.
- **Test.** video-pipelines.spec.ts `a fast double-click on Export starts ONE batch and the queue shows it truthfully ...` (**pristine:** `expect(locator).toHaveCount(expected) failed Expected: 1 Received: 0` for the finished file's **Show in folder**), `Clean audio does not replace what was opened in Audio Studio ...` (**pristine:** `Expected: ArrayContaining [StringContaining "Skipped this video's sound because ..."] Received: ["Video loaded", "Extracting audio…", "Loaded", "Opening Audio Studio"]`); the two toasts are still on screen 4.5 s after they appeared (a success toast is gone at about 3 s). Unit: the `singleFlight` finder (**mutated:** claim after the first await; no `finally`; the continue unguarded) and the Clean audio pin (**mutated:** compared after navigating; held after the wait). **E2E with the fix mutated out:** the guard removed from `startExport` (`Expected: 1 Received: 0`), the comparison removed from Clean audio (the same `Received: ["Video loaded", "Extracting audio…", "Loaded", "Opening Audio Studio"]`), the two toasts back to the default duration (`the Apply toast carries a needed fact and is held like an action toast ... element(s) not found`; `the reference note outlives a success toast's default ... element(s) not found`).

### (21) [MED] - the crash screen promised something Reload to Home never did

- **Bug.** "imagii saves your work every few seconds, so most of it should be waiting on the Home screen." The button changes the hash and nothing else, so no store is rebuilt, the restore banner (rightly) never shows, and nothing is "waiting on" Home: the work is where it was.
- **Fix.** "Your work is still open in its studios, and imagii saves it every few seconds. Reload to Home to carry on." USER_GUIDE and BRANDING say the same, with the reason.
- **Test.** home-chrome.spec.ts: the sentence, and `after Reload to Home the work is still open in its studio, and no restore banner is offered over it (T-125 (21))` (a text layer is still on the canvas afterwards). **Red-first (round-74 build):** the sentence is `element(s) not found`. Unit: the wiring pin (the copy, the button sets the hash and nothing else).

### (22) [MED] - a compilation was named `stream-aB3dE5fG_compilation.mp4`, and six highlights of one VOD came out "(2)" to "(6)"

- **Bug and fix.** `video:concat` gained `sourceName` (the file the person opened, not the converted working copy); the audio re-attach SUGGESTS `convertedFrom ?? videoPath`; the GIF and the 9:16 file carry the sanitized CLIP name after the source's (`outputBaseName`, as Export's `{source}_{clip}`).
- **Test.** video-pipelines.spec.ts `reframe, GIF and compilation are named for the video the person opened (...)`. **Red-first (round-74 build):** `the 9:16 file is named for stream.flv: Expected stream_Clip 1_reframe-1080x1920-center.mp4`. **Mutated** (the clip name dropped from `outputBaseName`): the same message. Many file-name expectations in the suite carry `_Clip 1_` now (a verdict: the name changed on purpose).

### (23), (24) [MED] - times past an hour read "167:13.0", the Source time boxes could not be typed a clock time, and the Video tour never mentioned Clip Kit

- **Bug and fix.** (23) Eight panels each had their own `m:ss` with no upper bound. `formatClock(seconds, places)` (`@shared/clockTime`) is the one copy: `m:ss` under an hour (unchanged to the character), `h:mm:ss` from one hour up; the Timeline, the clip list, the highlight and captions lists, the chat spike list, the player and Audio Studio's waveform all call it (four more than the ticket named, because they were the same copy). `parseClock` reads seconds, `m:ss`, `h:mm:ss` and a fraction and refuses a field of 60 or more beside a bigger unit; the Source time boxes are text boxes that use it and refuse the rest in `OVERLAY_TIME_REFUSAL`. (24) The tour has a **Clip Kit** step after **Export**, anchored on the button.
- **Test.** video-pipelines.spec.ts `a video over an hour reads its times as h:mm:ss ...` (a 3700 s video; **pristine:** `Length: not "61:40.0" Expected: "1:01:40.0" Received: "61:40.0"`); video-core.spec.ts `... the Source time boxes take 1:30 and 2:47:13, refuse what is not a time ...` and `the Video tour introduces Clip Kit after Export, and its highlight sits on the Clip Kit button (T-125 (24))` (the accent outline is the button's box plus 8 px). **E2E with the fix mutated out:** the formatter without its hour branch (`Length: not "61:40.0" Expected: "1:01:40.0" Received: "61:40.0"`), the Source time boxes back to number inputs (their text-box locators `element(s) not found`), the Clip Kit anchor removed (the tour case times out on the step it cannot point at). Unit: `clockTime.test.ts` (**mutated:** the hour branch removed: `expected '60:00' to be '1:00:00'`; a field of 60 or more accepted: `expected 135 to be null`), `tutorialCopy.test.ts` and `tutorialTargets.test.ts` (**mutated:** the step removed; the anchor removed: `no component reachable from /video declares data-tutorial="video-clipkit"`).

### (25) [MED] - a microphone that dropped mid-take was silent

- **Bug and fix.** The mic's audio track ends alone: the screen keeps recording and REC keeps counting over a silent take. `watchMicEnd` (the mirror of `watchScreenEnd`) toasts once, in the error style for 8 s: "The microphone stopped. The rest of this recording has no sound from it." The take is NOT ended; the listener comes off with the streams.
- **Test.** record.spec.ts `a microphone that drops mid-take is announced once, the take carries on, and it still saves (T-125 (25))` and the negative `a take with a working microphone that is stopped by the person says nothing about the microphone (T-125 (25))`. **Red-first (round-74 build):** the toast count is `Expected: 1 Received: 0`. **Mutated:** the watcher never registered.

### (26) [MED] - the allowlist guard was narrower than its claims

- **Bug.** Seven call shapes returned `[]` from the extracted scanner; the CSP regex `wss?:\/\/` could never match the shipped bare `ws:` (so "connect-src has no remote scheme" was asserted over its opposite); `useImage` (the ledgered (g) load path) was invisible to it.
- **Fix and test.** `networkAllowlist.test.ts` is 12 cases now (it was 6). It sees `useImage(` (with a (g)-cited allowlist line: a KNOWN, owner-pending exposure, not an approval), `WaveSurfer.create(`, a dynamic `import()` (judged by its specifier, a computed one is a site), `eval(` / `new Function(`, `downloadURL`, `electron-updater` and `@sentry/*` modules and Electron's `autoUpdater` / `crashReporter`, a `spawn` of `curl` / `wget` / `powershell` or of anything but imagii's three binaries, and `<video>` / `<audio>` / `new Audio(`; the CSP check is `/^(https?:|wss?:|ftps?:|\*)/` over EVERY directive with ONE named exception, `connect-src ws:` (ledger letter (m), a dev-server leftover; removing the token fails the test until the exception is deleted); `dependencies` holds no updater, telemetry or crash SDK and `electron-builder.yml` has no `publish`; the style sheets name no remote address; the header says what the scan cannot see. **Every addition is proven to red:** the parse probes (each shape returns its name; the old scanner returned `[]`), plus 18 mutations (a vocabulary entry removed, the old CSP regex restored, a `publish:` key added to `electron-builder.yml`, a `wss://` source and a remote `font-src` added to `index.html`, `import { autoUpdater } from 'electron-updater'` added to a source file, a remote `url()` added to the style sheet), each red and restored byte-identical.

### Existing tests this round changed (each a verdict, not a drive-by)

- E2E: every case that named a GIF or Reframe file now has `_Clip 1_` in it (22); the cases that pressed **Choose folder...** in each of the four panels in turn assert the later panels already show the folder (10); the overlay cases locate the Source time boxes as text boxes by their new names (23, 27); the position-box case expects the typed text while focused (8); `Size` is found as `Size (px)` (16); the ErrorBoundary case expects the new sentence (21); the Custom hint and the Cleanup strengths follow (3). Unit: `chain.test.ts`, `audioStudioCopy.test.ts`, `truthInCopy.test.ts` (the strip is `StripPosition`), `interactionWiring.test.ts` (the Clip List aria-label calls `formatClock`; the T-124 mic/screen teardown pin allows the mic line; the handler pin for (4)), `a11ySweep.test.ts` (the x / y names), `videoPickOutputDir.test.ts` and `settingsClear.test.ts` (real folders).

- **Lesson (the family).** **Ask of every sentence in a comment, a ticket or the UI: who measured it?** The denoise order, the "subset" Reframe, the four buttons that "follow each other", the Home screen that "waits" were each stated and none was run. **Ask of every fix to a controlled input: which two writers disagree about the text?** **Ask of every filter that rewrites a clock: what is its control?** (The extraction's own `aresample` repaired the drift the case was meant to see.) **And ask of a number in a layout: was the fixture the case the person has?** The long-name case passed on the pre-fix build with a name that had spaces in it (a space is a place to wrap) and went red with 668 px of content in a 298 px card the moment the name had none.

### Deviations from the ticket (each disclosed to the expediter)

- (3) The Custom noise floor's hint changed to "-35 is the Light preset's setting." (the ticket left it; it would have named Aggressive's number as Light's). (9) The text case of the Layer 5 reframe test is the `drawbox` stand-in on the bundled 7.0.2 (no `drawtext` in the linux static build) and runs for real on 6.1.1. (11) The cap is `max-w-[9rem]`. (21) The wording is "Your work is still open in its studios, and imagii saves it every few seconds. Reload to Home to carry on." (23) The four extra formatters (captions, chat spikes, player, Audio Studio's waveform) use the same helper. (25) The toast is the red 8 s error style, not a warning icon. (26) The vocabulary also covers `WaveSurfer.create(`, `Image.fromURL(`, `eval(` / `new Function(` and a spawn of anything but imagii's three binaries, with ALLOWED lines for `smoke.ts` (`runVersion(bin)`), `tempCleanup.ts` (`eval('require')`), the Player and the two preview `<video>`s. The networkAllowlist figure the ticket cites (6) is the T-124 count; it is 12 now.

### Found, not fixed

See the round-75 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-15 — T-124 (round 74): a gesture that ended somewhere nobody was listening, a fix that stopped at the first node type, and a grid that belonged to the decoder

The thirteenth pass (nine reviewers, then the sweep's executed probes; every item expediter-verified). Thirty-three items: twenty-one behavior changes, four layout changes with measured numbers, two Layer 5 cases and the doc, count and cite edits that ride along. One family: **an event, a type or a block size was handled for the first thing that came to hand, and the rest of its kind was left to behave by accident.** The recorder listened to the recording's end and not to its input's; the canvas gave handles to shapes and not to pictures; the cut ran on whatever block the decoder happened to produce. Every behavior item was red-first, against the round-73 build or with the fix mutated out and the file put back byte for byte.

### (1) [HIGH] - the captured window closing did not end a take that had the microphone on

- **Bug.** `MediaRecorder` stops only when ALL its tracks have ended, and the microphone's track outlives the screen's: the window closed, `onstop` never ran, REC kept counting over a frozen frame. T-123 (5) fixed the save for a take that ended; nothing HEARD it end.
- **Fix.** `watchScreenEnd` (RecordStudio): `ended` on the screen's own video track(s), the RAW capture (with the webcam in the take the recorder is handed the compositor's canvas capture, which never ends), registered after the phase is `recording` (a track that had already ended then sets `saving` last) and removed in `stopAllStreams` first.
- **Test.** Three E2E cases (mic on; webcam in the take; the window closing while the start was still opening). `track.stop()` does not fire `ended`, so the test dispatches the event the way the OS does. **Red-first:** `the take ended itself and began its save (REC kept counting over a frozen frame)`. Mutations: the listener on the compositor's canvas track, none in the teardown, no already-ended check, the listener on the combined stream: each fails its own case.

### (2)-(4) [MED] - a crash came back where it died, left its recording on disk, and a read-only config could throw on every resize

- **Bug.** (2) `webContents.reload()` keeps the URL's hash: a renderer that died in `#/audio` came back as Audio Studio, with no banner, while the guide said Home. (3) The recovery never told main the dead page's recording sessions were gone: each held a cap slot and a partial `.webm` for the launch. (4) `persistWindowBounds` was an unguarded `setSetting` on `resize` and `move`: an `EPERM` on `config.json` was an uncaught main-process exception per event.
- **Fix.** `loadEntry(win)` (the dev URL or the built file, the one `createWindow` uses) replaces `reload()`; `abandonOpenRecordingSessions()` (the body of `recording:abandon`, for every session not yet closed) runs first; `persistWindowBounds` (`windowBounds.ts`) is a `try` with a `console.warn`.
- **Test.** E2E from a studio route (the page object is dead after the crash, so the next page is read from main): `#/home`, the banner, and no `.webm` left. Unit: the registry (open sessions go, a closed one stays, the count, the file) and the geometry write (EPERM, a window that dies between the check and the question, nothing latched). **Red-first:** `hash: '#/audio', h1: 'Audio Studio', banner: false`; `the dead renderer's partial webm is still on disk after the reload`; `expected [Function] to not throw an error but 'Error: EPERM: operation not permitted...' was thrown`.

### (5) [MED] - the autosave banner was offered over a session that had work in it

- **Bug.** `AutosaveRestore` read the snapshot on every Home mount: going Home mid-session offered a restore that would land on the work being done, and a damaged file was announced mid-session too.
- **Fix.** `hasStudioState(project)` (`projectValidation.ts`, the autosave gate's own definition, now shared), `sessionHoldsWork()` (`ProjectIO.ts`: `hasStudioState(captureProject())`) asked once per mount, ahead of BOTH banners (the restore offer and the damaged-file notice).
- **Test.** Two E2E cases (the offer on launch and none after an edit and a trip Home; the damaged notice not over live work); unit on both definitions. **Red-first:** `the banner is offered again over the live session` and `the damaged-file notice came back over the live session`.

### (6)-(7) [MED] - Clean audio on a 3-hour video extracted the whole sound before the 2-hour gate, and the refusal told a video to "split it"

- **Bug.** `audio:extractFromVideo` and Clean audio ran ffmpeg for the whole file (a multi-gigabyte WAV in `%TEMP%`) and the length was checked after; the refusal sentence was one for both kinds of file and told a VIDEO to split it in another app.
- **Fix.** `waveformCeilingRefusal(duration, 'video' | 'audio')` (a video's remedy: "Export the part you want from Video Studio first, then open that shorter file."); main probes first and throws before ffmpeg is spawned; Video Studio refuses on the probe the open video already carries, ahead of the replace question. **Retired with the ceiling by T-129 (2026-10-16):** a long video is now extracted and opened.
- **Test.** Unit: both sentences, the boundary, the handler never reaching the extractor. E2E: a >2 h video at the button (no question, no ffmpeg in the spawn log, nothing new in `%TEMP%`) and dropped on the importer. **Red-first:** `promise resolved "'/tmp/imagii-audio/fake.wav'" instead of rejecting`; `Received array: ["Video loaded", "Extracting audio...", "That file is longer than 2 hours ..."]`; `expected 'That file is longer than 2 hours...' not to match /Video Studio/`.

### (8)-(15) [MED] - the canvas: pictures had no handles, a tool change dropped them, a release off the stage froze a draw, a straight line was refused, a lock did not lock, Snap skipped pictures, and a minus sign could not be typed

- **Bug and fix.** (8) The Transformer attached through a ref only the shape nodes registered; every layer type now shares one `base` props object and a stable per-id ref callback that bumps a tick when the selected node mounts. (9) The attach effect did not depend on the tool, so draw-then-Select showed no frame until another click; it does now. (10) The draw ended on the Stage's `mouseup`, which never fires for a release outside it; a window `mouseup` listener lives while a draw is in progress. (11) Every draw tool gated on `absW > 4 && absH > 4`, which a straight line fails by construction; the Line gates on its length (`Math.hypot`). **Found while doing it:** that let the first thin box through to the Transformer's `boundBoxFunc`, which refused ANY box under 5 px, so a horizontal line could not be resized (scale NaN); it now refuses only a shrink. (13) A locked layer's frame still resized and rotated it; a locked layer has none. (14) Snap quantized a dragged shape and not a dragged picture, and a drag shorter than half a cell left the node where the pointer let go (React saw no new prop); `onDragEnd` snaps and puts the node on the grid. (15) The x / y / Rotation boxes and the overlay's x / y were `type="number"` boxes fed `String(n)` on every keystroke: a minus sign never survived, ".5" became 1. They are `DraftField`s now, held by `layerOffsetRange` (-1x to 2x the document: no existing convention, chosen), `LAYER_ROTATION_RANGE` (+/-360) and 0..1.
- **Test.** Seven image cases and two video-core cases, each driven to its end state (handles by class, a dragged picture's x on the grid, a drawn line's points, every intermediate state of a typed number). **Red-first (round-73 build):** `the picture has no handles`; `no handles on the shape that was just drawn`; `Layers (2)` against `Layers (1)Text` for (10) and (11); `a locked layer still has handles`; `the picture was not snapped (Expected: 100, Received: 97.41...)`; `emptied: nothing snaps back into it (Expected: "", Received: "0")`; and for the thin line, with only the `boundBoxFunc` fix mutated out, `horizontal line stretched by its right handle: the drag never reached its extent (last read: NaN)`.

### (12), (23)-(25) [MED] - layout the click could not see, now measured at both window sizes

- **Bug.** (12) A layer name painted over "Move layer up" and the hint tag wrapped onto three lines. (23) The Text overlays card was 311 px of content in a 298 px box, the remove cross 13 px outside it, "x / y" on three lines, the Font select under "Size". (24) Round 73's `min-w-0` on the Power-line select traded the overflow for CLIPPED text ("60 Hz - US," of "60 Hz - US, Canada") and `expectControlsWhole` is vacuous for a select (its `scrollWidth` is its `clientWidth` whatever is cut). (25) The custom slider's readout wrapped at 38 px and bounced the row's height through a drag. The same select-aware check found the Platform select's 210 px label in a 176 px select.
- **Fix.** The layer row wraps (the actions drop to their own line); the overlay card is one column with the remove cross beside the caption; the Power-line row stacks its label above a full-width select, the Platform label is "YouTube, TikTok, Reels (-14)" (Spotify is named by the hint line); `ParamSlider` is two lines with `shrink-0 whitespace-nowrap` readouts.
- **Test.** `tests/e2e/layout.ts` gained `expectSelectsWhole` (the SELECTED option's text in the select's font against its content box, the arrow's `SELECT_ARROW_PX` calibrated on the real select: Chromium draws the text up to 25 px short of the right edge), `expectNoOverlap` and `expectOneLine`. **Red-first, at BOTH sizes, on the round-73 build:** at 1632x918 `the Text overlays card ... scrolls sideways: its content is 311 px wide in a 298 px box. Past its edge: <button> "x" +13px`, `"60 Hz - US, Canada" is cut off (120 px of text for 76 px of room in a 112 px select)`, `"-80 dB" wraps onto 2 lines`, `the row "a-very-long-image-file-name..." ...: nothing may be drawn over anything else`; and with the minimum measured FIRST (a copy of the specs that swaps the two sizes) the same four are red at 1024x640 (`... 120 px of text for 77 px of room in a 112 px select`, `311 px wide in a 298 px box`).

### (16)-(17) [MED] - Reframe ignored the clip's crop and speed, and Reframe and GIF were named for a scratch file

- **Bug.** The 9:16 strip was cut from the whole frame at 1x whatever was drawn in the player and whatever Speed said; Reframe and GIF named their files from `source.filePath`'s basename, which for a converted import is the working copy (`stream-aB3dE5fG_reframe-...`).
- **Fix.** `buildReframeGraph(spec, source)` is `setpts`, `cropToFrame` (the strip is computed on the CROPPED frame's dimensions), scale, `setsar=1`, with the sound through `buildAudioSpeedFilter` (`-af` only where the source has sound) and the progress denominator the range over the speed; the handler checks the payload at the boundary (crop, then speed); both panels pass the open video's display name.
- **Test.** Layer 5 "a reframed clip keeps its crop and its speed" (four cases, on 7.0.2 and 6.1.1, transcripts in the round's record), unit (`reframe.test.ts`, `videoReframePayload.test.ts`), two E2E cases. **Red-first (real ffmpeg, 7.0.2):** `the crop excludes the red block, but 66400 red pixels came out`; `2x: the file: 6 s, expected 3 s`; `crop + 2x: the file: 3 s, expected 1.5 s`; `a silent 3 s clip at 2x: 3 s, expected 1.5 s`; with either stage mutated out, red on 6.1.1 too. E2E: `the crop excludes the red block ... Received: 83425`; `the 9:16 file is named for stream.flv ... "stream-m19JB-61_reframe-1080x1920-center.mp4"`.

### (18)-(19) [MED] - an overlay window that misses the clip said nothing, and four controls with no live preview did not say so

- **Fix.** The overlay's Time boxes are "Source time", `overlayOutsideClipMessage` flags a window that misses the clip in a `role="status"` sentence naming the range the clip covers, and the card says "Text appears in the exported file, not in the player. Times are seconds in the source video."; the clip Speed, the Audio side column and the Fix Wizard's toast say "applied when you export" (BRANDING: a control with no live preview says so in one line).
- **Test.** Unit (`overlayOutsideClipMessage`, both ends of the closed interval), E2E, and a wiring pin for the sentences. **Red-first:** `the card says nothing previews an overlay, and what its times are`; `expected '' to be 'This text won't show in the export: ...'`.

### (20) [MED] - the re-attach toast was a dead end

- **Fix.** `toastSaved('Cleaned audio attached to the video', outputPath, { label: 'Edit in Video Studio', ... })` through `useEditInVideoStudio` on the MUX output only (an audio-only export has no video to open), and one USER_GUIDE sentence on the order the toast makes natural: clean the sound first, then clip.
- **Test.** One E2E case (Show in folder reaches the shell with the file; Edit in Video Studio lands on the route with the file in the header and the player mounted; an audio-only export offers neither). **Red-first:** `the saved toast carries the action ... element(s) not found`; with the action also on the audio-only toast, `Received array: [..., "Cleaned audio exported Show in folder Edit in Video Studio"]`.

### (21) [MED] - GIF, Compile, Reframe and Picture-in-picture asked for a folder every time the studio opened

- **Fix.** `useVideoOutputDir()`: ONE shared key, `video.lastOutputDir` (SettingsSchema, the nested `video` schema, the allowlist), read when the panel mounts and again when the action is pressed with nothing chosen, written after a file landed there; what came off disk is used only if it is an absolute path without `..`; the chooser opens on the current folder. One key, not four: the four write the same kind of thing and a person who chose where their side exports go means all of them (Export and the Clip Kit keep their own: a kit is a folder, an export a batch).
- **Test.** Two E2E cases (all four panels seeded: the button shows the folder, no folder chooser is opened, each file lands there; a folder one panel finished with is the next panel's, a canceled chooser remembers nothing, a stale value is ignored), the key in the settings tests, and a wiring pin. **Red-first:** `Reframe: the button shows the remembered folder ... element(s) not found`; `Expected: ".../out-t124remember-..." Received: undefined`.

### (26), (27), (31), (33) - four sentences that were false, and the README that did not say what the log said it did

- **(26)** The Levels sentence "Peaks above -1 dBFS are limited when you export" was unconditional; a bare pass-through has no limiter on purpose. It reads "When you boost or switch something on, peaks above -1 dBFS are limited in the export, so a boost cannot clip. With nothing switched on, the export keeps your levels as they are." **(31)** README's Levels bullet now carries the sentence the T-123 entry said it did. **(27)** "Deleting that folder clears everything" was false for the `%TEMP%` working copies (full-length WAVs in `imagii-audio`, converted videos carrying the person's file name in `imagii-import`, `imagii-concat`): it says "clears everything imagii keeps there", names the three folders and says they are pruned at the next launch when 6 hours old, in README, FOR_MIKE and twice in USER_GUIDE. All four are `docClaims.test.ts` pins that read the sentence AND the code it describes. **(22)** `progressSendsGuarded.test.ts` said "eleven sites" (it is ten over eight channels); PostChecklist's comment said `*_x.mp4` where the kit writes `*_twitter.mp4`. **(33)** The recorder sentence, the crash-recovery sentence, the disclosure sentences, the layout helpers and the cites in `image.spec.ts` are re-pointed against the final tree.
- **Red-first:** each doc pin was shown failing with the old sentence put back; the first version of the folder-names pin passed with one of the two USER_GUIDE mentions removed (a document-wide `toContain`), so it now reads the 420 characters after each limited claim.

### (28) - "a single phone-home is a bug" is a test now

- **Test.** `networkAllowlist.test.ts` parses every non-test file under `src/` and records each outbound site (a call named `fetch`, `net.request`, Node's `http`/`https`/`net`/`tls`/`dgram`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `shell.openExternal`, `window.open`, `loadURL`, an `<img>` / `new Image()` / `<iframe>` / `<script>` / `<link>`, every `http(s)://host` literal) against an exact per-file list, plus the page's CSP (`connect-src` has no remote scheme, `https:` only for images). Three destinations: DuckDuckGo, Hugging Face, GitHub. **Red-first:** `fetch()` in `shared/assert.ts` (`expected [ 'fetch(', 'host:example.com' ] to deeply equal []`), a `WebSocket`, an `import https`, an `<img>` in a new file, a second `fetch` in an allowlisted file, `connect-src https:`, and a line removed from the allowlist.

### (29)-(30) [LOW] - a bare-letter shortcut fired on a chord, and the rotation presets were announced as bare numbers

- **Fix.** `hasChordModifier(e)` (Ctrl, Meta or Alt; Shift is not one) beside `focusOwnsKey` in `keyOwnership.ts`, an early return in the Stream Graphics, Timeline and Player handlers: Ctrl+R, Ctrl+O, Ctrl+L and Ctrl+P no longer switch tools and Ctrl+O no longer sets an Out point under a `preventDefault`. The seven rotation presets carry `aria-label="Rotate N degrees"` (the visible number stays the start of the label, WCAG 2.5.3).
- **Test.** Unit (`hasChordModifier`), an image case (the keydown is dispatched: a real Ctrl+R is the app menu's Reload) and a video-core case that drives both focus paths and keeps the bare O as the control; the rotation cases click and read the new names. **Red-first:** `ctrlKey + r left the tool alone ... element(s) not found`; `no chord from the Player set a point`; `Locator ... name: 'Rotate 0 degrees' ... element(s) not found`.

### (32) [MED] - a cut lands on the DECODER's block, not on "1024 samples (about 21 ms)"

- **Bug.** `aselect` keeps or drops whole frames and a frame is whatever the decoder produced: FLAC 4608 samples (96 ms at 48 kHz), ALAC 4096, a WAV 1024 on the distro's 6.1.1 and 4096 on the bundled 7.0.2. Through the real export the per-cut errors were up to -77 ms (ALAC and a WAV on 7.0.2) and -60 ms (FLAC), and the picture (which retimes by the exact time removed, T-121) was out of step with the sound by the same amount. Three comments said 21 ms.
- **Fix.** `asetnsamples=n=256:p=0,` ahead of `aselect` in `aselectForCuts` (`p=0`: no padding of the last short frame; `asetpts=N/SR/TB` is sample-indexed, so the retime is unaffected): a cut's start and end each land within 256 samples (5.3 ms at 48 kHz). Measured on both majors, all three sources, six cuts each: -1.3 to +3.0 ms, identical. The claim sites (`chain.ts`, `process.ts`, STYLE_GUIDE) say 256 samples.
- **Test.** Layer 5 "a cut is accurate to a 256-sample block, whatever block the decoder hands over": WAV, FLAC and ALAC through `runAudioExport`, six cuts at times on no block size's grid, the bound one block, a fixture check that the FLAC and ALAC files really hand the graph 4608 and 4096 samples (`ashowinfo`), and a control showing the un-chunked cut misses by more than a block. **Red-first, both majors:** 7.0.2 `flac: per-cut error 3-3.5 s: -20.0 ms, 5.123-5.456 s: -45.0 ms, 7.7-8.9 s: -48.0 ms, ..., 12.6-14.1 s: -60.0 ms`, `alac: ... 5.123-5.456 s: -77.0 ms`; 6.1.1 the same for FLAC and ALAC and `wav: ... 7.7-8.9 s: 16.0 ms` (1024-sample blocks). Mutations: the stage removed (both majors), n=1024, `p` dropped (unit), the re-chunk placed after the select.
- **The checker's tail allowance, re-derived.** T-122/T-123's survivors check allowed a flat "0 to 2 frames" off the tail, derived from a 1024-sample grid the cut never had. `-shortest` ends the picture where the sound ends; the sound is shorter by up to n x 256 samples for n cuts, plus the source's own overhang of one 1024-sample AAC frame, so the allowance is `ceil((cuts x 256 + 1024) / 48000 x fps)` (`maxTailFrames`: 1 for two cuts at 24 fps, 2 for three at 30). Measured under the new grid: 0, 0, 0 on 7.0.2 and 0, 0, 1 (the AVI) on 6.1.1. The old flat 2 was one the sweep's fuzz had already exceeded (3 under 7.0.2's 4096-sample WAV blocks).
- **An existing Layer 5 case was moved, and that is a verdict.** "any chain with a stage ends in the limiter, a cut-only chain included" cut a 44.1 kHz -0.3 dBFS tone at 1-2 s and read `-0.2 dBFS` with the new grid where it read `-1.0` before. The limiter was working; the export is written at 48 kHz (`-ar 48000`), the resampler that does it sits AFTER the limiter, and a cut's seam (two phases of a sine butted together) rings in it. Over 24 cuts of that tone, 11 peaked above -0.9 dBFS (to 0.0) on the decoder's grid and 6 on the 256-sample one: the old pass was where one seam happened to land. The cut case now runs on a 48 kHz source (no resample after the limiter), and still fails with the limiter removed from a cut-only chain (`a cut on a -0.3 dBFS 48 kHz source peaks at -0.4`). The overshoot itself is ledgered, not fixed.

### Existing tests this round changed (each a verdict, not a drive-by)

- `interactionWiring.test.ts` "the capture hides hint nodes through the same switch as the editor chrome": the hint name had two hand-written sites (the shapes' props and the image node's); there is ONE now (the shared `base`) and the image node spreads it, so the pin asks for one site and the spread. Both halves fail when mutated. `chain.test.ts` and `singleTrackTail.test.ts`: the cut stage's string has `asetnsamples=n=256:p=0,` in front. `audio.spec.ts` / `home-chrome.spec.ts`: the Fix Wizard's toast, the Levels sentence and the re-attach toast (now a sentence plus two buttons: read as a substring) follow their new words. `image.spec.ts`: the rotation presets are found by their new names; its `file:line` cites and `docClaims.test.ts`'s table are re-pointed (Canvas.tsx moved by the round's own edits). `media.spec.ts`: the limiter case above, and the T-122 checker's allowance.

- **Lesson (the family).** **Ask of every listener: what is it attached to, and what does that thing outlive?** The recorder heard its own recording end, and the thing that actually ended was one of the inputs. **Ask of every refactor that gives two types one code path: which of them had its own copy of each property?** The image node had a hand-written name, a hand-written drag end and no ref; the fix was to stop having two. **Ask of every number a comment states: who produced it?** "1024 samples, about 21 ms" was true of nothing the cut ever ran on, and only a measurement through the real export found it. **And ask of a green case that goes red under a change that should not touch it: is the case wrong, or is the product?** Here it was both, in different measures: the case was lucky (a seam that happened to land well), and the product has an overshoot after its limiter that the case had hidden.

### Found, not fixed

See the round-74 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-14 — T-123 (round 73): a guard written for one control, a default written for one keystroke, and the fix that stopped at the first site

The nine reviewers' twelfth pass (every item expediter-verified; the measured ones replicated on the real binaries or in the built app). Eighteen behavior items (two of them layout items with measured numbers, four with a Layer 5 case) and sixteen claim, cite and count edits. One family: **a rule was written for the case in front of its author and applied as a blanket, and its twin was left in the old shape.** "Any `INPUT`" stood in for "a field someone types in" in five key guards; `Number(typed) || default` judged every keystroke in nine boxes while the one fix (T-113) sat in the same file as two of them; the seam fix (T-122) was exact on the mp4 ramp and not on the AVI; the mix bus ended in a limiter and the single-track path beside it did not; the kit wrote a Facebook file and the log had no Facebook chip; Record's toast offered "Edit in Video Studio" and Reframe's identical moment did not. Every behavior change was broken once and watched to fail; the reds are quoted below, the mutation table (sha256 before, mutated, after; every restore `IDENTICAL`) is in the hand-back, and the 6.1.1 transcripts for (10)-(13) are quoted under them.

### Bug (1) [MED] - closing the window mid-job could raise Electron's blocking "JavaScript error in the main process" dialog

- **Bug.** Reproduced on 3 of 40 real closes during an export. The WebContents dies 1-106 ms before `before-quit` kills the child, and a chunk the child had already written still dispatches: every progress callback was a bare `e.sender.send(...)` or `win.webContents.send(...)`, `send` on a destroyed WebContents throws, and nothing above a stdout listener catches it.
- **Fix.** One `sendIfAlive(sender, channel, payload)` (`src/main/sendIfAlive.ts`: `isDestroyed()` and a `try`) at every site: `video.ts` (progress, job complete, reframe, highlights), `captions.ts` (transcribe, burn-in, model download), `audio.ts` (export, re-attach), `recording.ts` (the convert, which holds the WebContents it took while the window was certainly alive: a destroyed `BrowserWindow` throws on `.webContents` itself). `quitFlush.ts` is the one other `.send(` and wraps its own in a `try` whose `catch` settles the flush.
- **Test.** `closeMidJob.test.ts` drives each real handler with the runner standing in for the child, reporting the way a stdout listener does (a bare call), against a sender that is already dead, in two shapes (`isDestroyed()` true; false with a `send` that throws). `sendIfAlive.test.ts` (the helper), and `tests/unit/progressSendsGuarded.test.ts`, the grep for siblings the ticket asked for, kept: no `.send(` under `src/main` but the helper and `quitFlush.ts`, with a finder that discriminates. **Red-first:** 18 failures, `promise rejected "Error: Object has been destroyed" instead of resolving`; each guard broken once (no `isDestroyed`: 11 fail; no `try`: 11; the audio re-attach bare: 3; Record's convert bare: 4).

### Bug (2) [MED] - after a checkbox tick or a slider drag, Ctrl+Z, `?`, the canvas keys, Delete and the Player's keys were dead

- **Bug.** Every window-level key guard stood down for ANY `INPUT`, and a control that was just ticked or dragged STAYS focused: tick Hum removal, press Ctrl+Z, nothing happens. The shortcut overlay's and the hint lines' own promises were false from there (UX and accessibility found it independently).
- **Fix.** `lib/keyOwnership` (the input-type set lifted out of `videoStore`, which imports it back): `isTextEntryTarget(tag, type)` is a text field and owns every key; `controlOwnsKey` is the one native key a range (the arrows, Home, End) or a checkbox, radio or button (Space) has; `focusOwnsKey` adds a `<select>` (the letters are its type-ahead). Ctrl+Z / Ctrl+Y (`undoRedoIntent` gained `inputType`) and `?` ask the text-field question alone, as a select has no use for either; the tool keys, Delete, the Player and the Timeline ask `focusOwnsKey`.
- **Test.** `keyOwnership.test.ts` (every tag and type), `useUndoRedoHotkeys.test.ts` and `HotkeyOverlay.test.ts` (a checkbox, range, radio, colour, file and button fire; a text field, a search box and a textarea still own them); E2E "a ticked checkbox or a moved slider keeps its focus and still lets Ctrl+Z, Ctrl+Y and ? through" (Audio; the focus is asserted to be on the checkbox, so the trap is real), "tick Snap and R still switches the tool, Delete still removes the layer, Ctrl+Z still brings it back" (Stream Graphics) and "player keyboard: a ticked Crop guides box keeps its focus and the Player's keys still answer, Space stays the box's" (Video Studio). **Red-first:** unit `expected null to be 'undo'` (twelve cases); E2E `Ctrl+Z from the focused checkbox undoes the tick  Expected: not checked  Received: checked`, `R from the focused checkbox switches the tool  Expected: visible`, `Expected: > 0  Received: 0`. Each guard broken once, and the two native-key carve-outs (a checkbox's Space, a select) broken once each. T-78 (a step per tick of a slider) is a separate, open item.

### Bug (3) [MED] and (4) - the overlay's Time boxes and seven more number boxes rewrote the box on every keystroke

- **Bug.** `value={n.toFixed(2)}` with `Number(typed) || 0` turned "12" into 1.00 (the "1" came back as "1.00" and the "2" landed after it); `Number(typed) || 360` snapped an EMPTIED PiP width to 360, so "600" typed after clearing it was 360600 and the composite failed with a bare "Picture-in-picture failed." The same shape sat in the spike window, a custom preset's width, height and frame rate, the grid size and a text layer's Size. T-113 had fixed Size and Color with `DraftField` in the same file as the Time boxes.
- **Fix.** `DraftField` is lifted to `components/` and used at all nine boxes (with `@shared/draftNumber`: `typedNumber`, `isTypedInRange`, `clampTyped`): the box keeps what is typed until it is blurred or Enter is pressed (or, with `live`, until it is already a number in range), then commits with the site's clamp; the Time boxes clamp `endSec >= startSec` at commit. **One deviation, on purpose:** a preset's width and height commit with a floor of 1, not 64, because a width under 64 is refused at Save in a sentence ("Width / height must be at least 64") and that refusal is kept.
- **Test.** `draftNumber.test.ts`; E2E at every site, typed with `retype` (`tests/e2e/typing.ts`: select, delete, then `pressSequentially`, because `fill` replaces the value in one step and cannot find a box that rewrites itself, which is how the old cases stayed green): the emptied state, each intermediate state, the committed one, the clamp. **Red-first (pre-round build):** `emptied: nothing snaps back into it  Expected: ""  Received: "0.00"` (Time), `"10"` (spike window), `"64"` (preset), `"360"` (PiP), `"2"` (grid); each broken once on the current build (the draft judged on every keystroke, Enter not committing, the PiP clamp removed: `Expected: "960"  Received: "5000"`).

### Bug (5) [MED] - a recording that stopped itself saved under a live "REC" screen with a dead Stop

- **Fix.** `finalizeRecording` sets the `saving` phase at its top; only the Stop button did. **Test.** `record.spec.ts` "a take that ends ITSELF (the captured window closed: every track ends) shows the saving card at once, not a live REC screen with a dead Stop". **Red-first:** `expect(locator).toBeVisible() failed ... element(s) not found` (the saving card); broken once.

### Bug (6) [MED] - `recording:begin`'s session cap passed twelve concurrent calls

- **Fix.** `beginsInFlight` is counted in the same synchronous step as the check and released in a `finally`. **Test.** `recordingStream.test.ts`: twelve begins at once open exactly four; a slot freed by abandon is usable again, once. **Red-first:** `expected [ Array(12) ] to have a length of 4 but got 12`; three guards broken (slot never released: 15 fail; check ignores in-flight: 2; reserve after the first await: 2).

### Bug (7) [MED] - a drag that began inside a dialog and ended on the scrim closed it (and threw the typed name away)

- **Fix.** `Modal` records whether the press began, or ended, inside the card, and a click on the scrim after that is not a click on the scrim (Chromium dispatches a drag's click to the common ancestor). **Test.** `references.spec.ts` "a drag that starts inside the dialog and is released on the scrim neither closes it nor loses the typed name; a plain click on the scrim still does". **Red-first:** `a drag out of the card is not a click on the scrim  Expected: visible`; each half broken once.

### Bug (8), (9) [LOW]

- **(8)** The five output-folder buttons' accessible name was the folder's basename ("Videos, button"): `OutputDirLabel` carries an `sr-only` "Output folder: " prefix; E2E "each of the five says what it is to a screen reader" (red: `Expected: visible`, the name not found). **(9)** A single Save on a thumbnail variant discarded `image.save`'s answer and was the one save with no word of success: `saveOne` toasts `Saved <name>` after the null (canceled) check, the shape the other two saves have (T-91's pin reads it); E2E "variants: generate four tiles, save one..." (red: `Expected value: "Saved imagii-variant-warm-1792002615961.png"  Received array: []`; broken once: the toast on a cancel too).

### Bug (10) [MED] - the single-track export had no stage that answers for its peaks

- **Bug.** +12 dB of Manual gain on a -2 dBFS source exported at 0.0 dBFS with a flat-topped wave, and the app previews only the unprocessed source, so nothing warned. The mix bus has always ended in a stage that answers for its peaks (T-111); this path did not unless Even volume was on.
- **Fix.** A chain with any stage in it ends in `MIX_LIMITER` (the same constant, -1 dBFS, `level=disabled` so it never re-levels), a bare `anull` stays untouched (nothing switched on is the file that went in), and an Even volume chain gets none (its last stage is `loudnorm`, whose true-peak limit is -1.5 dB). The Levels panel says it under Manual gain ("Peaks above -1 dBFS are limited when you export, so a boost cannot clip"), and the guides do.
- **Test.** Unit `singleTrackTail.test.ts` (the `-af` tail per stage); Layer 5, "a single-track export answers for its peaks and its loudness label": +12 dB on a -2 dBFS source peaks at or under -0.9 dBFS (and above -1.3: limited, not muted), a quiet source is not re-leveled (+6 dB lands 6 dB higher), a cut-only chain and a high-pass on a -0.3 dBFS source end in the limiter, a bare chain is unchanged. **Red-first (real output):** `exports at 0 dBFS (0.0 is a flat-topped wave): expected 0 to be less than -0.9`, `rumble filter on a -0.3 dBFS source peaks at 0`. Broken once each way (no limiter; the bare chain limited: 1; limited after loudnorm: 3), on 7.0.2 and on the distro's 6.1.1.

### Bug (11) [MED] - a mono source normalized by Even volume landed 3 LU hotter than its label on every stereo playback

- **Bug.** R128 counts a mono file as ONE channel; both speakers carry it, 3 LU hotter than the meter says. Measured: -13.0 LUFS on `ebur128=dualmono=true` against the -16 label; `dual_mono=true` reads -16.0.
- **Fix.** `loudnormFilter` / `buildChain` take `dualMono` (from the export's own `probeAudio`: one channel and no second track) and `:dual_mono=true` goes on BOTH passes, because pass 1's `measured_I` and pass 2's gain must agree on what was measured, and on the single-pass fallback for a silent measurement. **One call the ticket did not make:** with a second track the primary is forced to stereo ahead of the mix, whose own last stage (a stereo `loudnorm`) answers for the label, so that path is not told (`singleTrackTail.test.ts` pins it).
- **Test.** Unit string pins (both passes, the fallback, the tail of the stage, none for 2 or 6 channels); Layer 5 "Even volume on a mono source lands on its label on the meter a stereo playback uses" (the export is still mono; -16 on dual mono, not -13) and the stereo control (unchanged, on target on the plain meter). **Red-first:** `expected -13 to be less than -15`. **Two existing Layer 5 cases are re-pointed, and that is a verdict:** "two-pass loudnorm lands within 1 LU of the -16 target" and "the control: a track with sound still gets the measured two-pass render" export the mono `voiceWav` and read it on the plain meter, which is the meter that says -16 for a file that plays at -13. They now read the dual-mono meter with the SAME band (-17 to -15). That keeps what they proved (pass 2 lands on the label through a real measured pass) and is stricter: on the pre-fix export the re-pointed cases read -13 and fail, and the old plain-meter form fails on the fixed export (-19). The stereo control carries the plain-meter claim for a stereo source.

### Bug (12) [MED] - the T-122 seam fix did not reach AVI sources

- **Bug.** An AVI's video stream time base is 1/fps, so `setpts` ITSELF rounded the retimed stamp onto the frame grid before the encoder was involved (the first survivor at 3.2917 s, which is the frame before the cut and already there, instead of 3.3083 s); `-enc_time_base:v filter` cannot keep a stamp the filter had rounded. It is identical on both majors.
- **Fix.** `settb=AVTB` between `select` and `setpts` in `vselectForCuts`: 3.308332, exact.
- **Test.** `chain.test.ts` (the pins updated, and the new one for the time base); Layer 5 "an AVI source (stream time base 1/fps) with cuts that are not frame-aligned" (the fixture asserts the 1/24 trap itself; every output packet against where its frame belongs). **Red-first, on the BUNDLED 7.0.2:** `the 24 fps AVI: pts_time written twice: 3.291667 3.666667: expected [ 3.291667, 3.666667 ] to deeply equal []` (broken again on 7.0.2 and on 6.1.1); the existing mp4 ramp cases stay exact. The seam comments now say the bound is PER CUT and additive (T-110(i)), where they said it of the whole file.

### Bug (13) [MED] - a crop the validator accepts could fail the whole export

- **Bug.** Chromium reports `offsetWidth` 800 in a 799.5 px parent (1.000625); `assertOptionalCropRect` accepts up to 1.01; `manualCropRegion` never clamped: `crop=3842:2160:0:0` on a 3840 px source, "Invalid too big or non positive size", no output.
- **Fix.** The size is clamped to what is left of the frame past the offset, then `even()`, and the offset leaves room for the 2 px minimum: `x + w <= width`, `y + h <= height`. `cropToFrame` is shared by the platform export, Compile, the GIF and the Clip Kit, so the one clamp covers all four.
- **Test.** `filters.test.ts` at the measured ratios and the validator's ceiling, an offset crop, the 2 px edge, an odd source, and a property sweep; Layer 5 "a crop that overshoots the frame by the validator's slack still exports": the measured crop on a 3840x2160 source lands a 1080p file with the marker square and centred, the height at 1.002, the ceiling at 1.01, an offset crop, and Compile and GIF through the same function. **Red-first:** `expected [ 'crop=3842:2160:0:0' ] to deeply equal [ 'crop=3840:2160:0:0' ]`, and on the real binary `Invalid too big or non positive size`; the clamp removed, the 2 px room removed, and the clamp placed after `even()` each fail their cases.

### Bug (14) [MED] - Audio Studio's waveform died silently on a big or an undecodable file

- **Bug.** `WaveSurfer.create({ url })` swallows the load's rejection and tells only the `error` event, which nothing listened to: an ADPCM WAV left a dead panel with no message, and a 1 h WAV took 3.25 GB of the renderer's memory (2 h: 6.5 GB; a 3-6 h VOD is 10-20 GB, a renderer that dies).
- **Fix.** `ws.on('error')` toasts a finished sentence (a failed `load()` emits the event and rethrows into the constructor's own catch, which emits it again; a media-element error, the ADPCM case, is emitted once; so the toast has an id), and `audioStore.loadSource` refuses a file over `WAVEFORM_MAX_SEC` (2 h) before the studio holds it, in a sentence naming the ceiling and the reason that every route (the importer, Clean audio, a restored project) shows as written. **A marked simplification:** a flat ceiling, not a computation; the upgrade is main-side peaks handed to wavesurfer as `peaks` + `duration` (T-110(ao)).
- **Test.** `audio.test.ts` (the boundary at exactly 7200 s, a one-second overshoot, a 6 h VOD, non-finite lengths, the sentence is a finished sentence that `userFacingError` and `describeImportError` pass through unchanged, even through the IPC envelope); E2E: an ADPCM WAV says the sentence once; a file whose bytes cannot be read (the page's `fetch` refuses the file protocol) says it once although wavesurfer reports it twice; and a 2 h 1 s WAV is refused at load, naming the ceiling, with no "Loaded", no waveform, and a short file taken on the same drop zone straight after. **Red-first:** `Expected value: "Couldn't draw this file's waveform. ..."  Received array: ["Loaded"]` and the same for the ceiling sentence; broken: no toast; no toast id (`the sentence was toasted 2 times`, on the unreadable-file case alone, because the ADPCM case reports once and cannot tell); the gate removed; the boundary `<`; a 3 h ceiling.
- **Retired (T-129, 2026-10-16).** The ceiling and its simplification are gone: the upgrade it named landed (main-side peaks; see the top of this file). The `error` listener stays, and now means the PLAYER could not play the file.

### Bug (15) [MED] - a crashed renderer left a live-looking dead window

- **Fix.** A once-guarded `render-process-gone` handler (`rendererGoneAction`, `rendererRecovery.ts`) logs why and reloads to Home, where the autosave banner lives; a second death inside the cooldown is left alone and said so, and a clean exit or a quitting app is ignored. **Test.** `home-chrome.spec.ts` (`webContents.forcefullyCrashRenderer()`, beside T-35's ErrorBoundary case): the window is back on Home with the banner, a second death at once is left, not looped; unit `rendererRecovery.test.ts`. **Red-first:** `crashed: true, page: null` where `crashed: false, page: { h1: 'imagii', banner: true }` is expected; no reload, and a reload with no cooldown (the log line for the left window never comes), each broken once.

### Bug (16)-(18) [LOW]

- **(16)** "Save .srt" copies the WHOLE transcript and sat directly under "Burn captions over selected clip range only": a sentence beside the button that the button is described by (`aria-describedby`): "The box above only changes Burn into video. Save .srt keeps the captions for the whole video." E2E (the existing project-restore case, with the range box checked: the saved file is still the whole transcript). **(17)** The Posting log had no Facebook chip though the kit writes `*_facebook.mp4`: added (a Facebook post is logged, drawn and stored in the E2E; red: no such button). **(18)** The Reframe toast offered no next step where Record's identical moment offers "Edit in Video Studio": the same action, through ONE shared hook (`useEditInVideoStudio`, `lib/editInVideoStudio.ts`, the ask-before-replace bridge that was a function inside `RecordStudio`), a USER_GUIDE sentence giving the order (reframe, then Edit in Video Studio, then Transcribe and Burn into video), and an E2E that declines the question (still the source, Reframe still there), accepts it (the 9:16 file replaces it, the Reframe card is gone, Captions is on it). Red: `the saved toast carries the action  Expected: visible`.

### Layout (24)-(27) [24 HIGH] - rows that only a scrollbar nobody could see held

- **Bug.** The Properties Rotation row (a `w-16` label, a `w-20` box and seven no-wrap presets: 406 px) in the `clamp(260px,16%,380px)` column was clipped at EVERY window size, behind a horizontal scrollbar that `overflow-y-auto` makes and nobody sees: "0" and "15" of seven presets at the default window, though the README and FOR_MIKE promise them. The Cleanup strength row (five equal columns) cut "Aggressive" to "Aggress"; each Posting-log row's three `w-16` stat boxes (337 px) pushed "comments" out of a 274 px list; the Platform and Power-line selects lacked `min-w-0` and poked past the card by 19 and 3 px. Ten sweeps missed them: every behavior case reaches a control with `click()`, which scrolls it into view first.
- **Fix.** The rotation row, the Posting-log stat row (and the notes: `break-words`, so a pasted link wraps; **beyond the ticket**) and the presets wrap; the strength buttons take the width their label needs and share the row (`flex-1 whitespace-nowrap`); both selects are `min-w-0`.
- **Test.** The shared helper `tests/e2e/layout.ts` (`setWindowSize` to `DEFAULT_WINDOW` 1632x918 and `MIN_WINDOW` 1024x640, `expectNoHorizontalOverflow`: `scrollWidth <= clientWidth` and nothing past the right edge, `expectControlsWhole`) in four cases, one per surface. **Red-first, against the pre-round BUILD:** `the layers and Properties column at the default 1632 px window (a text layer) scrolls sideways: its content is 406 px wide in a 260 px box. Past its edge: ... <button> "270" +146px`; `the Logged posts list at the default 1632 px window scrolls sideways: its content is 337 px wide in a 274 px box. Past its edge: <label> "comments" +63px`; `the Cleanup card ... its content is 303 px wide in a 300 px box. Past its edge: <select> "60 Hz - US, Canada 50 Hz - mos" +3px`. Each class broken once on the current build (the rotation wrap, the strengths back to five columns, each `min-w-0`, the stats wrap, the notes).

### The rest of the twelfth pass (one line each)

- **(19)** USER_GUIDE ("Where your data lives" and the Clear thumbnail cache paragraph), README, FOR_MIKE and PRODUCT_GUIDE say the browser engine inside imagii keeps its own cache under `%APPDATA%\imagii`, can hold copies of fetched search images, and is not touched by Clear thumbnail cache; deleting the folder clears everything. (The ticket's "Windows' own browser cache" is the engine's cache, not Windows'; the sentence says so.) **(20)** The seam comments say the bound is per cut and additive (T-110(i)). **(21)** FOR_MIKE: Clean audio takes a video's audio (`extractFromVideo(source.filePath)`), not a clip's. **(22)** BRANDING's own tutorial example quoted a name `tutorialCopy.test.ts` forbids: now "Duck under your voice". **(23)** README and FOR_MIKE quoted a banner that does not exist and said it appears only after a crash; the real one, with Restore, Clear and Later, appears after a normal close too (the closing snapshot); USER_GUIDE's "saved collections" and "title ideas" are the never-say terms. **(28)** README said "the preview downsamples to 2048 px"; nothing does (the only cap is the 800 px PLACED size; originals stay full size in memory). **(29)** DESIGN_GUIDE's raw-color exceptions name the five `bg-black` washes (the four the ticket listed and `Modal`'s) and the JS-only `CHECKER_A` / `CHECKER_B` (no Tailwind mirror, so `designTokensInSync` has nothing to compare). **(30)** The emoji guard read `.ts` and `.tsx` only (executed: an emoji in `src/renderer/index.html` passed everything); it reads `.html` and `.css` too, `emojiGuard.test.ts` fails on a file type it does not read, and STYLE_GUIDE and the test header no longer say "every directory" where they meant directories alone (red: `expected +0 to be 1` for the page and the stylesheet; the unguarded script broken back in). **(31)** `playwright.config.ts` ("~4 min instead of ~2.7") and `video-pipelines.spec.ts` ("~70 s") carried durations of their own: both point at the TESTING table. **(32)** `image.spec.ts` cited `ImportPanel.tsx:70` for the 800 px cap (it is :71), and its neighbors: every cite in that file was re-read against the final tree (`ImageStudio.tsx`'s moved with this round's own edit, and so did `index.ts:116-117`). **(33)** The mood board's tooltip said "Drop the on-disk thumbnail cache": "Clear ...", the verb the button and BRANDING use. **(34)** BRANDING and STYLE_GUIDE said toasts default to 2 s; react-hot-toast 2.6.0's defaults are success 2 s but plain and error 4 s, and `AppToaster` sets none (a test reads the installed library). `tests/unit/docClaims.test.ts` holds (21)-(23), (28), (29), (31), (33) and (34) against the code they describe; each was broken once.
- **Lesson (the family).** **Ask of every guard: what does it stand down for, and who else does that guard cover?** "Any INPUT" covered a checkbox, a slider, a colour well and a file field because it was written for a text box. **Ask of every fix: what is its twin?** The Time boxes had a sibling in the same file that was already right; the seam fix had a second container; the mix bus had a second path; the kit had a second list; the toast had a second panel. **And ask of every layout test: could the click see it?** A control that cannot be seen is clicked anyway; a layout is a number, and the number is `scrollWidth` against `clientWidth`.

### Found, not fixed

See the round-73 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-14 — T-122 (round 72): the option that meant something different on the shipped ffmpeg, and the last copies of things already fixed once

The nine reviewers' eleventh pass (every item expediter-verified; the ffmpeg and QA items carry executed real-binary evidence from the reviewers themselves, which this round re-ran). Six behavior items and eight claim, cite and count edits. One family: **a thing was fixed at the place it was reported and its twin was left in the old shape.** The cut's retime (T-121) was exact on the bundled 7.0.2 and rounded onto the frame grid on the 6.1.1 the Windows exe ships; `sanitizeFilename` was made Unicode-aware (T-121 (7)) and `{handle}`, in the same file, was not; the kit's file names were sanitized and the folder request beside them was the raw name; the tutorial's Duck step was conditional and the panel's footer was not; Start's error said "Close any app using it" and the empty-list hint did not; the emoji guard watched three of the four directories of `src/`. Every behavior change was broken once and watched to fail; the mutation table, with the sha256 before and after each restore, is in the hand-back, and the 6.1.1 transcripts for (1) are quoted under it.

### Bug (1) [MED] - the cut re-attach wrote two frames on one timestamp on the ffmpeg the exe ships

- **Bug.** The exact argv on a constant-rate source (the 24 fps ramp, cuts 3.3-5.7 s and 8.0-9.2 s; OBS mp4 and mkv are this shape) on 6.1.1: ffprobe reads `pts_time` `3.291667` twice, stderr says `non-strictly-monotonic PTS` and `Non-monotonic DTS in output stream 0:0; previous: 40448, current: 40448; changing to 40449. This may result in incorrect timestamps in the output file.`, and 393 packets are written for the 394 surviving frames. On 7.0.2 the same argv writes 394 packets and the first survivor at `3.308268`. Through the real `runAudioMux` (a 30 fps source, three cuts) 6.1.1 puts every survivor after a cut 16.7 ms (half a frame at 30 fps) from where its frame belongs.
- **Root cause.** A cut's length is almost never a whole number of frames (3.3 to 5.7 s is 57.6 frames at 24 fps), so `setpts` hands the encoder a stamp between two frame slots. On 6.1.1 libx264's encoder time base for a constant-rate source is `1/fps`, so each stamp was ROUNDED onto the frame grid: source 5.7083 s belongs at 3.3083 s, landed on 3.2917 s, the frame before the cut, which was already there. 7.0.2 keeps the graph's own time base and is exact either way, which is why every green run on the bundled binary said nothing about it.
- **Fix.** `-enc_time_base:v filter` beside `-fps_mode passthrough` in the re-encode branch of `runAudioMux` (cut or not: the same argv serves a picture re-encoded only to fit an mp4). With it 6.1.1 writes `3.308268`, 394 packets and no warning; 7.0.2 accepts it and writes the same bytes' times (all four runs are in the hand-back: `repro.sh`). Four claims in the same region are corrected: `chain.ts` and `process.ts` said picture and sound agree "to the sample" and are "equal by construction" (`aselect` keeps or drops whole 1024-sample frames of sound: to within one audio frame, about 21 ms); `process.ts` and the Layer 5 case said `setpts` makes ffmpeg force 25 fps CFR (7.0.x only: a 60 fps source stays `60/1` with no warning on 6.1.1, measured on both); `media.spec.ts` and TESTING said 7.0.2 does not write the Matroska `DefaultDuration` (it does, element `23 E3 83`, and the unpatched pipe output reads `30/1` on both majors: the Void patch is what makes it `1000/1`, on both).
- **Test.** Layer 5, T-82 block, "a cut that is not a whole number of frames long keeps every survivor on its own timestamp": the 24 fps ramp with the two cuts above and a generated 30 fps source with three (0.35, 0.85 and 0.41 s). Each compares EVERY output packet with where its source frame belongs (the source's own packet time minus the cut time before it, read from the source and not assumed from `k / fps`) to 1 ms, after a duplicate check; `-shortest` may trim the last one or two frames to the sound's end and a frame lost from the middle shifts all after it, so the tail is allowed and the middle is not; a third case runs the check on hand-made lists (a duplicate, a grid-rounded stamp, a lost middle frame). Unit: `muxCodec.test.ts` pins `-fps_mode passthrough -enc_time_base:v filter` back to back on a cut and on a wmv2, vp9 and mpeg2 re-encode and absent from a copy (red on any box). **Red-first, one change, three runs of the same unfixed bytes:** unit `expected '-fps_mode passthrough -c:a aac' to be '-fps_mode passthrough -enc_time_base:…'` (four cases); Layer 5 on 6.1.1 (the distro binary through the alias recipe in TESTING) `the 24 fps ramp: pts_time written twice: 3.291667: expected [ 3.291667 ] to deeply equal []` and `the 30 fps source: packet 32 is at 1.100000 s, 16.7 ms from where its frame belongs: expected 0.01666700000000021 to be less than 0.001`; Layer 5 on the bundled 7.0.2, **green** on the same unfixed bytes: it cannot go red there, by design, so the 6.1.1 run is the evidence and the unit pin is what reds anywhere. Fixed: green on both. The whole cut / re-attach / audio-chain mux / MediaRecorder family (55 cases) is green on 6.1.1 with the option, and the full suite on 7.0.2.
- **Lesson.** **A defect that lives on the shipped major needs the shipped major in the room.** The bundled binary is not the one the Windows build runs, and a case that cannot fail on it is still worth writing when the transcript that proves it is taken on the other: say which run is the red, and put a unit pin beside it for the box that cannot show it.

### Bug (2) [MED] - `{handle}` was the last ASCII sanitizer

- **Bug.** The export panel's `{handle}` token emptied a handle in any other script: "@토끼" was `""` (so `{handle}` alone fell to `export.mp4`), "@Épico" lost its É, and a decomposed accent its accent. There was no `{handle}` case at all.
- **Fix.** `filename.ts` takes the runs of `(?:[\p{L}\p{N}_]\p{M}*)+` and joins them with nothing (dots and every other character are still dropped: "my.handle" is "myhandle"). **One deviation, on measurement:** the ticket's class `[^\p{L}\p{M}\p{N}_]` with `\p{M}` matched anywhere leaves an emoji's variation selector behind (`@Streamer` + U+2764 U+FE0F is `Streamer` + an invisible U+FE0F), which is the exact residue T-121 (7) measured and closed for names. The anchored form is the sanitizer's own and drops it.
- **Test.** `filename.test.ts`, seven `{handle}` cases (ASCII unchanged, Korean, Japanese, Chinese, Cyrillic, Arabic, Hebrew and accented Latin, a decomposed accent and Thai and Hindi, an emoji and its selector, separators and reserved characters in any script, no handle). **Red-first:** `expected 'export.mp4' to be '토끼.mp4'`, `expected 'export.mp4' to be 'うさぎ.mp4'`, `expected 'Epico.mp4' to be 'Épico.mp4'`, `expected 'xy.mp4' to be '토끼xy.mp4'`; the ASCII class put back fails the same four; the ticket's literal class fails the emoji case alone (`expected 'Streamer️.mp4' to be 'Streamer.mp4'`).

### Bug (3) [MED] - Clip Kit on a blank-named clip failed after the folder was picked

- **Bug.** The rename field accepts an empty name; the kit passed the raw `clip.name` to `video:makeKitDir`, whose `assertNonEmptyString` refused it, and the person who had just picked a folder read "Clip Kit failed." with no cause.
- **Fix.** `ClipKitButton.runKit` computes `safeName = sanitizeFilename(clip.name)` before the folder is made and asks main for the folder with it, so the folder and every file derive from one name (a blank name is `clip`, the fallback the file names already used). Main's gates stay: they are trust-boundary validation, and `sanitizeFilename` is idempotent, so main's own pass changes nothing.
- **Test.** `video-pipelines.spec.ts`, beside the kit case: "a Clip Kit on a clip whose name was cleared still runs: the folder and the files are named "clip"" (the real rename field cleared, the folder pick stubbed in main as in the other kit cases; the folder is `clip-kit-<date>`, the eight files are `clip_*`, the reveal selects `clip_youtube.mp4`). The wiring pin reads the order (`safeName`, then `makeKitDir({ parentDir, clipName: safeName })`, one `sanitizeFilename` call). **Red-first, pre-round build:** `a kit asked for on a blank-named clip Expected: "saved" Received: "Clip Kit failed."`; and again on a build with `clipName: clip.name` put back, plus the pin.

### Bug (4) [LOW] - "This track dips whenever you talk" was said of a track that does not dip

- **Bug.** The Second-track footer was unconditional; "Second mic" defaults Duck OFF and the export builds no `sidechaincompress` then. The tutorial step was already conditional; the panel was not.
- **Fix.** The sentence is drawn only while `secondary.duckUnderPrimary`.
- **Test.** `audio.spec.ts` "a second track can be added in every role...": footer present with Background music (Duck on by default), absent after unchecking Duck, present again on re-check, absent on Second mic (Duck off by default), present on Game audio; plus the wiring pin. **Red-first:** `Duck off: nothing dips, so the footer that says it does is gone ... Expected: 0 Received: 1` (pre-round build, and again with the guard made `true`).

### Bug (5) [LOW] - the empty-device hint named two of the three recoveries

- **Bug.** A camera another app has open (OBS: the streamer's usual case) rejects the probe exactly as an absent or a blocked one, and the hint under the empty list said "Plug one in, or allow camera access in Windows privacy settings". The probe's own comment says the hint names the recoveries; Start's error (`userFacingError`) already said "Close any app using it".
- **Fix.** `noDeviceHint`: "No camera found. Plug one in, close any other app using it, or allow camera access in Windows privacy settings, then click Refresh sources." (and the microphone twin).
- **Test.** `devices.test.ts` (both sentences exactly, and the clause for either kind) and the five `record.spec.ts` cases that read the copy. **Red-first:** `expected 'No microphone found. Plug one in, or …' to be 'No microphone found. Plug one in, clo…'` and `expected 'No microphone found. Plug one in, or …' to match /close any other app using it/`; the E2E on the pre-round build: `expect(locator).toBeVisible() failed ... element(s) not found`.

### Bug (6) [LOW] - the emoji guard did not read `src/preload`

- **Fix.** `scripts/check-emoji.mjs` `ROOTS` gains `src/preload` (clean: 177 files scanned, preload's two included). **Test.** `tests/unit/emojiGuard.test.ts`: every directory of `src/` is a root and every root exists; the script is RUN from a scratch tree with one emoji under each of the four roots and must exit 1 and name the file; a clean control; a test file may carry one. **Red-first:** `src/preload is not scanned by scripts/check-emoji.mjs: expected [ 'src/renderer', 'src/main', …(1) ] to include 'src/preload'` and, for the run, `expected +0 to be 1` (the unguarded script exits 0 on a preload emoji). Live: a temporary emoji in `src/preload/index.ts` fails the script (`src/preload/index.ts:215: // temp: ...  [...]`, exit 1) and the file is restored byte-identical. STYLE_GUIDE named the hook "PreToolUse/Stop" (it is a PostToolUse hook on Edit|Write|MultiEdit) and cited a local `~/.claude/...` path, the class T-121 (14) removed; both are fixed.
- **Lesson (the family).** **Ask of every fix: what is its twin?** The retime had a second ffmpeg major, the Unicode sanitizer a second token, the kit's name a second consumer, the tutorial a second place the promise is made, the hint a second place the recovery is named, the guard a fourth directory.

### The rest of the eleventh pass (one line each)

- **(7)** The `sanitizeFilename` docstring and the T-121 entry above said a combining mark stays "only on the letter it modifies"; the class lets a mark ride on `_` and `-` too (executed: `a_️b` keeps its U+FE0F). Harmless, so the regex stays and the sentence now says "a letter, a number, `_` or `-`"; a test pins the claim. **(8)** The four exe-size figures (README twice, USER_GUIDE, `release.yml`'s release body) disagreed with each other and predated round 71's 275 MiB: all four say "a single portable exe" until the release run measures the real one. **(9)** BRANDING's name table in README and FOR_MIKE: "Posting log", "Title starters", "Smart highlight finder", and the real button, "Start recording" (it is not "● Start"). **(10)** Stale cites to `Canvas.tsx`, `canvasStore.ts` (and `ExportDialog.tsx`'s comment) re-pointed against the final tree, two more than the ticket listed (`canvasStore.ts:113` and `:70` had moved to `:148` and `:107`). **(11)** Duration figures disagreed three ways (`vitest.integration.config.ts` "~10 seconds" / "~1-2 minutes", TESTING "~6.8 minutes", `release.yml` "roughly six"): one table in TESTING ("How long each layer takes"), measured this round, and the config and the workflow point at it. **(12)** TESTING's heading said "Layer 2.5" where the repo says Layer 5. **(13)** STYLE_GUIDE gave Home and End to the Player; only `Timeline.onScrubKey` handles them. **(14)** The ledger's AutosaveRestore row named a "Discard" that T-92 renamed Clear.

### Found, not fixed

See the round-72 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-14 — T-121 (round 71): a fix for one consumer of a shape, and the siblings that share it

The nine reviewers' tenth pass over the held wave (the expediter replicated the fps-class and webcam findings at runtime). Eight behavior items and fourteen claim and count edits. One family: **a fix landed on the consumer that was reported, and the siblings that read the same shape were left as they were.** T-120 made the convert keep a MediaRecorder take's frames, and its own remux then sent the same `1000/1` container to three more commands; the Timeline's I / O were taught to read the frame on screen and the four keys beside them kept the lagging store; the webcam fallback told the person what the take would be and left the camera it had opened running; `audioCloseMessage` guarded the `null` shape and not the absent one; `sanitizeFilename` was written for the ASCII names in its first test. Every behavior change was broken once and watched to fail; the mutation table, with the sha256 before and after each restore, is in the hand-back, and the 6.1.1 transcript for (1) is quoted under it.

### Bug (1) [MED] - the fps class was closed for the convert and open for the three commands beside it

- **Bug.** A Record WebM saved with Convert to MP4 off (remuxed, so its container still reads `1000/1`) reaches three more libx264/mp4 consumers than the convert T-120 fixed. The caption burn-in (no `-r`, no `-fps_mode`) measured 2987 frames for a 3 s take, "More than 1000 frames duplicated" on stderr, 31.7 s for a 2 s one; the PiP composite is the same shape; and the cut re-attach's `setpts=N/FRAME_RATE/TB` numbered the survivors at the container's nominal rate, 1 ms apart (the expediter replicated it on the real MediaRecorder artifact: 2.4 s of kept picture collapsed to 0.073 s, and the product `runAudioMux` with a cut measured 0.074 s against a 2.426 s control).
- **Fix.** `-fps_mode vfr` on the burn-in and the PiP, exactly as the convert has it. The cut re-attach is retimed by timestamp, the ffmpeg reviewer's form, and NOT by the `fps=30` fallback: `vselectForCuts` is now `select='<keep>',setpts='PTS-(max(0,min(T,end)-start)+...)/TB'`, each survivor moving earlier by the length of the removed spans before it. The spans are merged first (`disjointCuts`), because widening a cut by dragging a new one over it is a supported gesture and a plain sum counts the overlap twice. The keep expression is untouched, so sound and picture still drop the same frames.
- **Why the timestamp form shipped.** The whole Layer 5 cut / re-attach / burn-in / PiP / MediaRecorder family (59 cases) was green on the bundled 7.0.2 and on the distro's 6.1.1 with it. On the suite's 3 s MediaRecorder fixture, cut 1.0-2.0 s (58 survivors): 0.058 s of picture before, 1.957 s after on 7.0.2 and 0.059 s / 1.958 s on 6.1.1. **The one behavior that shifts, measured on the 24 fps ramp with the cut 4-7 s:** the first survivor after the cut sits at output 4.0417 s, where the count-based numbering put it at 4.000 s (packet times `3.958333 4.000000` before, `3.958333 4.041667` after), and the total picture is 16.959 s against 16.917 s with the sound at 17.0 s. `between(t, 4, 7)` is inclusive at both ends, so 73 frames (3.0417 s) are dropped while 3.000 s of sound is; the old numbering closed the picture's gap by a frame too much and put every later frame 41.7 ms ahead of its sound, the new one leaves a one-frame hold at the seam and keeps each survivor on its sound. Nothing pinned moved (the luma reads are within 8 of 12 per second and the durations within 0.25 s).
- **Test.** Layer 5, in the T-120 MediaRecorder block, VP9 and VP8 each: the burn-in and the PiP write an average rate between 20 and 60, 75 to 105 frames for the 3 s take and a duration within 0.5 s of it; `runAudioMux` with one cut (1.0-2.0 s, 2 s of cleaned sound) keeps a picture within 0.35 s of 2 s and of the sound's length; plus, in the T-82 block, overlapping cuts handed out of order (`[6,9]`, `[4,7]`: source 10 s lands at output 5 s under the sound's burst). Unit: `chain.test.ts` (the exact strings, no `FRAME_RATE`, overlap, touching, nested, out of order, a region before the file, a region wholly before it). **Red-first, at the unfixed argv:** `avg_frame_rate 1000/1: expected 1000 to be less than 60` (burn-in and PiP, both codecs) and `video 0.058 s: expected 0.058 to be greater than 1.65` (the cut, both codecs); each fix removed alone turns exactly its own two cases red and leaves the other four green; the merge removed: `video duration 13.958984: expected 13.958984 to be greater than 14.75`. The first version of the PiP case ran a 6 s overlay over a 3 s silent take and read 181 frames and 5.968 s on the FIXED argv (T-110 (ac): `-shortest` has no audio stream to bound a silent base), so the overlay is as long as the take.
- **Lesson.** **Fixing the source of a shape widens its audience.** The remux made a webm that every later consumer reads at 1000 fps; the convert's `-fps_mode vfr` was a fix for one of four. When a change makes a file reach more commands, `grep -n libx264 src/main` is the list (TESTING, T-114), and each line of it is a case on the file that broke.

### Bug (2) [MED] - the portable exe shipped ~275 MiB of binaries nothing could load, and four dependencies nothing imports

- **Measured** with `electron-builder --win dir` into the scratch folder (`signAndEditExecutable=false`, the Electron zip already cached), before and after: `win-unpacked` 706 MiB to 409 MiB; `app.asar` 36 MiB to 15 MiB (83 to 68 top-level packages in it); `app.asar.unpacked` 412 MiB to 137 MiB; `ffprobe-static` 336 MiB to 61 MiB, from six binaries to `bin/win32/x64/ffprobe.exe` alone. (The `ffmpeg-static` binary in that tree is this box's linux one: its install script fetches the platform's binary, so the release run is where the win32 `ffmpeg.exe` is checked; `ffprobePath` resolves from `ffprobe-static/index.js` to `bin/win32/x64/ffprobe.exe`, which is the file left.)
- **Fix.** Three `files` excludes in `electron-builder.yml` (`bin/darwin/**`, `bin/linux/**`, `bin/win32/ia32/**`) and `npm uninstall` of `fluent-ffmpeg`, `pdf-lib`, `music-metadata` and `file-type` (23 packages out of the lockfile). `package.json` lost four lines and nothing else. The lockfile diff is the 23 packages, npm's sync of its own `version` header (`1.0.0` to the `1.5.1` package.json already said) and two `"dev": true` marks on packages that are now reached only through dev dependencies. `@types/fluent-ffmpeg` stays: the ticket named four dependencies.
- **Test.** The gates are the proof that nothing needed them (no file under `src`, `tests` or `scripts` names any of the four; typecheck, the unit suite, Layer 5 and the whole E2E suite are green without them; the build bundles). `releaseWorkflowShape.test.ts` pins the three excludes, the absence of an exclude for the x64 binary and of the four dependencies, with a discrimination case; broken once each: the linux exclude dropped, `fluent-ffmpeg` back in `dependencies`. The win32 release run re-confirms `ffprobePath`. The "10 to 15 s" unpack figure in the guides is unmeasured on the smaller exe.

### Bug (3) [MED] - a webcam that opened and could not be composited stayed live for the whole take

- **Bug.** Ticking "Include webcam" and having the compositor fail toasted "Recording screen only." and left the camera's tracks live (QA measured the track live the whole take: the camera's light on during a screen-only recording), drew an empty accent-bordered box where the thumbnail goes (three reviewers), and, if the person had left Record while the camera opened, toasted into a screen nobody was on and went on to open a take.
- **Root cause.** The `catch` of the camera block was written for the message. Its sibling awaits end with `leftWhileStarting`, and the thumbnail was drawn from the checkbox, not from a camera being in the take.
- **Fix.** The catch starts with `if (leftWhileStarting(micStream)) return`, stops every track of `camStream` and nulls `camStreamRef` before the toast, and the thumbnail is drawn from `camInTake` (set after the compositor ref and its unmount check, cleared where the streams are let go). The compositor tears down its own elements on a failed start, so the stream is all there is to release.
- **Test.** `record.spec.ts`: the zero-camera case ("Start with the webcam ticked and no camera says so...") now asserts the preview is there and the camera box is not; "a camera that opens and a compositor that cannot start" (a canvas stream is the camera, `HTMLMediaElement.prototype.play` refuses it: the track ends, no box, the take rolls on, no temp file left); "leaving Record while the camera is opening, then the camera failing, ends the start silently" (the refusal held behind a gate until after the Home link). Unit: the wiring pin (the catch's three statements in order before the toast, `setCamInTake` after the compositor ref's check and in `stopAllStreams`, the thumbnail gated on it and not on `showCam`). **Red-first, against the pre-round bytes (the file reconstructed by the inverse edits and sha-checked against the baseline):** `no empty camera box over the screen preview Expected: 0 Received: 1`; `the camera stayed live through a screen-only take` (`['live']` against `['ended']`); with only the catch's check removed: `a failure toast for a screen nobody is on` (received `Webcam failed. imagii isn't allowed to use that device. Check Windows Settings > Privacy, then try again. Recording screen only.`); each of the six pin mutations fails the pin.

### Bug (4) [MED] - the Timeline's arrows and `,` / `.` stepped from a playhead that lags playback

- **Bug.** QA's scratch E2E: during playback `.` stepped back 0.151 s and the right arrow moved +0.053 s. T-120 taught I / O to read `playheadNow`; the four keys beside them in `onScrubKey` kept `currentTime` from the store, which is written on `timeupdate` and trails the picture by up to a quarter second.
- **Fix.** `const now = playheadNow(useVideoStore.getState())` ahead of the switch; the four cases keep `NUDGE_SEC` and `1 / fps` as they were.
- **Test.** `video-core.spec.ts` "the arrows and , . during playback step from the frame on screen" (the store made stale on purpose, T-120's technique, once per key: park the store near the start with a click, let the picture run past 0.9 s, press, pause, compare). **Red-first, pre-round bytes:** `ArrowRight moved the playhead from 0.922926 s to 0.200172 s` (`Expected: >= 0.05, Received: -0.722754`); each key reverted alone: ArrowRight `-0.713054`, ArrowLeft `Expected: >= -0.15 Received: -1.906576`, `.` `Expected: >= 0.0167 Received: -1.742021`, `,` `Expected: >= -0.1167 Received: -0.883008`. Unit: the wiring pin (all four cases read `now`, `now` is `playheadNow(...)`, no `currentTime` is read in the handler); the T-119 pin that encoded `currentTime - 1 / fps` is re-pointed.

### Bug (5) [MED] - `validateProject` accepted a clip with no `textOverlays`, and Restore crashed the studio

- **Root cause.** The T-119 docblock said `textOverlays` is "read with a default". It is read bare (`videoStore` three times, the overlay editor, `buildVideoFilter`). The field has been in the saved clip since the repository's first commit, so no older file lacks it.
- **Fix.** `Array.isArray(clip.textOverlays)` in `validateClipRequiredFields`, with the file's reason style (`videoStudio.clips[0].textOverlays not an array`), after the overlay gate so a payload in an overlay is still named as one; both docblocks and the STYLE_GUIDE paragraph corrected.
- **Test.** `projectValidation.test.ts`: QA's clip (`{id, name, startSec, endSec, selectedPresets}`) is refused, a clip without the key is refused, `undefined`, `null` and `{}` rows; the "accepts a clip with no textOverlays (back-compat)" case and the bare-clip fixture are inverted. **Red-first:** `expected true to be false` (twice) and `the project was accepted` with the check removed.

### Bug (6) [LOW] - `audioCloseMessage` named discards that did not exist

- **Fix.** `chain.secondaryTrack != null` (the field is optional; `undefined !== null` said "The second track will be discarded" about no second track) and `JSON.stringify(chain[key] ?? DEFAULT_CHAIN_SPEC[key])` (an older chain lacks the switches added since; `undefined` against `false` called untouched audio "your cleanup settings").
- **Test.** `AudioStudio.test.ts`: eleven cases on chains that lack keys (no `secondaryTrack`, each switch missing, all at once, beside a real edit, and the real second track still named). **Red-first, one guard at a time:** with `!== null` back, `expected 'Close this audio? The second track wi…' to be null` (four cases fail); with the default fallback removed, `expected 'Close this audio? Your cleanup settin…' to be null` (seven).

### Bug (7) [LOW] - `sanitizeFilename` and the chat-log username were ASCII `\w`

- **Bug.** "Épico clutch" became `pico_clutch`; a Korean clip name became `clip` (two such clips shared a kit); chat lines from a Korean, Japanese or Cyrillic chatter matched nothing and were dropped from the spike count.
- **Fix.** `\p{L}\p{N}` with the `u` flag in both. **One deviation, on measurement:** with the letter and number classes alone a Thai or Hindi name is mangled (`สว_สด_ชาวโลก`, `ह_न_द_क_ल_प`: the vowel signs are marks, `\p{M}`) and so is a decomposed accent (`E_pico`, what a file named on macOS carries). The sanitizer matches `(?:[\p{L}\p{N}_-]\p{M}*)+` and joins the runs with `_`, so a mark stays only when it directly follows a letter, a number, `_` or `-` (T-122: this said "only on the letter it modifies", and the class lets a mark ride on an underscore or a dash too, executed: `a_\uFE0Fb` keeps its U+FE0F; harmless, so the regex stayed), and the variation selector of an emoji does not survive as an invisible name (`❤️` is `clip`, not U+FE0F); the chat class takes the marks directly. ASCII behaves as before (the existing cases are unchanged), and the path separators, dots and reserved characters are still outside the class.
- **Test.** `filename.test.ts` and `chatLog.test.ts` (Épico, Korean, Japanese, Chinese, Cyrillic, Arabic, Hebrew, Thai, Hindi, a decomposed accent, the emoji cases, hostile paths in other scripts; the CJK and Cyrillic chat lines counted), `clipKit.test.ts` (six non-ASCII names through the real queue builders, every file name a writable path). **Red-first:** `expected 'pico_clutch' to be 'Épico_clutch'`, `expected 'clip' to be '클립_이름'`, `expected [ { tSec: 30, text: 'ascii' }, …(1) ] to deeply equal [ { tSec: 30, text: 'ascii' }, …(5) ]`; without the marks, `expected 'E_pico_clutch' to be 'Épico_clutch'`; with marks matched anywhere, `expected '️' to be 'clip'`.

### Bug (8) [LOW] - one name for a cut's mark

- The BAD_CUT refusal said "Click its tag to undo it" and the shortcut overlay "Click cut tag / Undo a cut", where the waveform hint, the tutorial and the guide say "mark" and "put it back". Now: "Click its mark to put it back, then cut that part again." and "Click a mark / Put a cut back"; BRANDING's name table carries the row. `audioChainValidation.test.ts` (every case that quotes the sentence), `hotkeyTable.test.ts` and a wiring pin that reads all four places. **Red-first:** each reverted alone fails its pin.

### The rest of the tenth pass (one line each)

- **(9)** FOR_MIKE's "Every studio auto-runs a guided tour" is USER_GUIDE's account (Record has none; the others wait for content). **(10)** README: the webcam checkbox puts the camera IN the recording. **(11)** STYLE_GUIDE names `[items]`, not the deleted `[hasItems]`. **(12)** STYLE_GUIDE's two Timeline passages say Space, the four relative keys and I / O all act from `playheadNow`, and the store's time is only drawn. **(13)** PRODUCT_GUIDE: the caption model downloads on request from the Captions panel. **(14)** HOW_IMAGII_WAS_MADE's trailing generator credit (and the separator above it) is gone.
- **(15)** "Within 2 levels" for a retag alone was a regression of round 69's own correction. Re-measured on 6.1.1 (a cast of 0.01 through a 1080p export against the ungraded control, twice, identical): the suite's T-118 bands, bt709, retag only AND the shipped scale-plus-retag, within 3 (red `199,42,42` against `202,45,45`, the rest 2); the same bands made in the bt2020 matrix and tagged bt2020nc, a hand fixture that is not in the suite, with the retag only, within 4 (red `200,43,40` against `202,45,44`, green `153` against `155`, blue and gray 1), and with no stage `0,135,0` against `0,155,0` and no tag. Written at `filters.ts`, STYLE_GUIDE and the ledger with the fixture named.
- **(16)** The convert's "(the default wrote 51)" is true of the flv and the wmv; the mpg wrote 50 (re-measured on both majors). **(17)** "Compiled without libfreetype" is false: `-buildconf` of the bundled linux build lists `--enable-libfreetype`, `--enable-fontconfig` and `--enable-libass` and no `--enable-libharfbuzz`, the filter is absent, and the distro's 6.1.1 (both libraries) has it; `filters.ts` and the three test comments say so. **(18)** `release.yml`'s ceiling rationale: the media suite is minutes, not "~90 s" (comment text only). **(19)** "instant" for the WebM save contradicts the remux and the second-copy sentence: "quick" in the Output hint, the guide, BRANDING's exemplar, the E2E that reads the hint and the ledger's hand-test. **(20)** 8 Mbps is the top export preset's rate (YouTube's; the others are 5-6) and a ceiling: the comment and the guide say so. **(21)** IC's three stale pre-wave cites are re-pointed (`Canvas.tsx:383`, `ExportDialog.tsx:199, :224-240`, `Welcome.tsx:44`), and so are the ones this round's own edits moved. **(22)** DESIGN_GUIDE states `defaultExportScale`'s mapping (3x from 2.5, 2x from 1.75, else 1x).
- **Lesson (the family).** **Ask of every fix: what else reads this shape?** The remux's webm had four consumers and one fix, the Timeline handler five keys and two fixes, the camera block a message and a stream, the close question a `null` and an absent field, the sanitizer a class that stopped at the author's own alphabet.

### Found, not fixed

See the round-71 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-14 — T-120 (round 70): a file that never said how long it was, a clock read as a frame rate, and a preview attached before it had anywhere to go

The nine reviewers' ninth pass over the held wave (the second deep-brief sweep; every finding expediter-verified, the measured ones replicated on real binaries or on real MediaRecorder media). Fifteen behavior items and twelve claim and count edits. One family: **a value was set before the thing that holds it existed, or described a thing other than the one it governs.** The preview's stream was assigned before its `<video>` was rendered; the unmount cleanup ran before the start's awaits landed; the schema named properties the store's layout does not have; a stream copy was expected to carry a frame rate the container writes from its own clock; a comment said a retag would not fix pixels that it does fix. Every behavior change was broken once and watched to fail; the mutation table, with the sha256 before and after each restore, is in the hand-back. The 6.1.1 transcript for (15) is quoted under it.

### Bug (1) [HIGH] - a recording saved as WebM could not be opened in Video Studio

- **Bug.** With Convert to MP4 off, the toast's "Edit in Video Studio" loaded a file `probeVideo` refused ("ffprobe returned no usable duration for the video"), and the person who had used imagii's own recorder was told to re-export it from "your recorder".
- **Root cause.** A MediaRecorder webm is streamed, so its header has no duration (`ffprobe` prints `duration=N/A`), and the save was a plain `copyFile` of it. The E2E drove "Edit in Video Studio" only for an MP4.
- **Fix.** `remuxWebm` (`convert.ts`, `-i temp -c copy output.webm`) is the same child as the MP4 convert, registered under the same owner, so "Discard recording", `cancelConverts('recording')` and the quit sweep reach it and a kill is the one sentinel. `saveWebm` (`recording.ts`) runs it; a discard removes the half-written webm and answers `null` like the convert's; any OTHER failure falls back to the plain copy the branch always made and logs it, because the remux only repairs a header and is never a reason to lose the take. **Measured, and the answer to "what does `-c copy` yield":** on QA's real MediaRecorder file (`mr1080.webm`, 1920x1080 VP9) the remux has `duration=9.544` and all 277 packets, on 7.0.2 and on 6.1.1; but its frame rate still reads `1000/1`, because the Matroska muxer writes the stream's millisecond clock as `DefaultDuration` (1,000,000 ns) and no option changes that for a stream copy: `-r`, `-r:v`, `-fps_mode passthrough|vfr|cfr`, `-fflags +genpts`, `-enc_time_base` and `-r` as an input option were each tried on both majors and each left 1 ms in the file. So the normalization the ticket asked for lives where the number is read: `probeVideo` (`probedFps`) treats a rate above 240 (the ceiling the export gates already use) as "the file does not say", the 0 the Timeline and the Player already turn into 30.
- **Test.** Layer 5, "a MediaRecorder take: saved as WebM and converted to MP4 (real ffmpeg, T-120)": a fixture of MediaRecorder's shape (encoded to a PIPE with `-live 1` so there is no duration to write back, millisecond clocks, `setts`-jittered packet times, the muxer's `DefaultDuration` overwritten with an EBML Void), checked FIRST to read `duration=N/A`, `1000/1`, `0/0` like QA's file, VP9 and VP8; the saved remux probes finite, keeps every packet, and reads `1000/1` in the container and `0` through `probeVideo`. `recordingCancel.test.ts` (four cases through the real handler with the remux stood in: the remux gets the temp take and the chosen path; a discard answers `null` and leaves nothing; a failed remux saves the take as recorded and logs; the MP4 branch never remuxes), `convertCancel.test.ts` and `cancelSentinel.test.ts` (the argv; the discard; a failure is not a cancel), `probe.test.ts` (`probedFps`), and `record.spec.ts` "record -> Stop -> save as WebM ..." now reads `format.duration` and CLICKS "Edit in Video Studio" to an open studio with a clip. **Red-first** (each restored byte-identical): the save a plain copy: 4 of the 4 remux cases (`expected [] to deeply equal [ { …(2) } ]`) and the E2E (`format.duration was undefined`); the discard swallowed: `expected { …(4) } to be null`; no fallback: `expected ConvertFailedError: convert-to-mp4 exit 1… to be null`; a remux that re-encodes: the argv pin; a remux that writes a live stream, Layer 5: `ffprobe returned no usable duration for the video` for both codecs; the ceiling widened: `probeVideo: 1000 fps is a clock, not a rate: expected 1000 to be +0`.
- **Lesson.** **Fix the file at the moment it is written, and measure what the fix cannot do.** The remux repairs the duration and cannot repair the rate; the sentence in the ticket that said "add whatever normalization the measurements demand" was the instruction to find that out, and the second fix belongs at the reader.

### Bug (2) [MED] - "Convert to MP4" wrote a 1000 fps file

- **Bug.** A MediaRecorder webm declares no frame rate (`r_frame_rate 1000/1`, `avg 0/0`) and the mp4 muxer's default output mode is a constant rate, so the convert wrote one frame per millisecond: QA measured 9575 frames for a 9.6 s take and 1m56s to convert, and `probeVideo` then read fps 1000, so the Timeline's `,` and `.` stepped 1 ms.
- **Fix.** `-fps_mode vfr` in the convert's argv, which also serves the importer's flv, ts and wmv.
- **Test.** Layer 5, same block: the VP9 and VP8 fixtures through `convertToMp4` have `avg_frame_rate` between 20 and 60, 75 to 105 frames in 3 s, and a probe fps between 20 and 60; and an flv, a wmv and an mpg at 25 fps keep exactly 50 frames in 2 s with `avg 25/1` (the control for "the importer shares this argv"). Measured on the suite's fixture: 2980 frames in 2.2 s without the flag, 90 frames in 0.19 s with it, on 7.0.2 and on 6.1.1. **Red-first:** the flag removed: `avg_frame_rate 1000/1: expected 1000 to be less than 60` (both codecs) and, past it, `flv: frames: expected 51 to be 50` (the default mode also added a frame to the steady flv, so the control discriminates in the other direction too); `-fps_mode cfr`: the same; the unit pin `convertCancel.test.ts` "asks for a variable frame rate".

### Bug (3) [MED] - the live preview was never attached

- **Bug.** The recording view was a black box and the webcam thumbnail an empty border.
- **Root cause.** `startRecording` assigned `srcObject` while `phase` was still `'idle'`; both `<video>` elements render only at `phase === 'recording'`, so the refs were null at that moment.
- **Fix.** An effect keyed on the phase attaches both from the stream refs and lets go on the way out; the camera thumbnail only shows a camera that is in the take (the compositor exists exactly then).
- **Test.** `record.spec.ts`: the WebM case polls the preview's `videoWidth > 0`, and "the recording view shows the take..." fakes a camera with a canvas stream (this container has none) and asserts the preview is playing and the thumbnail is 320 wide. **Red-first:** `the recording view's <video> never showed the capture`, `Expected: > 0 Received: 0`; the thumbnail left unattached: `Expected: 320 Received: 0`; the effect keyed on nothing: `the screen preview showed nothing`, plus the wiring pin (`and it is keyed on the phase: expected -1 to be greater than 4605`).

### Bug (4) [MED] - Space after clicking the track did nothing and scrolled the studio

- **Fix.** `Timeline.onScrubKey` handles Space through the Player's own toggle: the Player registers a `PlayerTransport` (`readTime`, `togglePlay`) on the video store while it is mounted, and the Timeline asks it, so there is one play / pause. `preventDefault` keeps the page still. The overlay's Space, `,` / `.` and I / O rows say "(player or timeline focused)".
- **Test.** `video-core.spec.ts` "timeline: click the track, then Space plays and pauses the video, and the studio does not scroll": both keydowns were handled (read after the app's handlers), the video plays and pauses, nothing scrolled. **Red-first:** `Expected: false Received: true` (the video never started) and, with only `preventDefault` removed, `both Spaces were handled`.

### Bug (5) [MED] - the webcam composite froze when imagii was minimized

- **Fix.** `backgroundThrottling: false` in the window's `webPreferences`. A window manager is what hides a minimized window from the page, and this box has none (a probe that hid and minimized the window left `document.visibilityState` `visible`), so the minimized behavior itself is a hand-check on the win32 release run.
- **Test.** `record.spec.ts` reads `webContents.getBackgroundThrottling()` on the live window (`false`), and the wiring pin reads the `BrowserWindow` options in `main/index.ts` with the syntax tree. **Red-first:** `Expected: false Received: true`.

### Bug (6) [MED] - every recording encoded at Chromium's default bitrate

- **Fix.** `videoBitsPerSecond: 8_000_000`, merged with the mime option, and the Output hint says what it costs: "A take can use about 3.6 GB of disk per hour, and saving needs room for a second copy of it." Measured with the real MediaRecorder in this repo's Electron on a synthetic 1080p canvas (a flat, moving, very compressible picture): 1.36 Mbps by default and 2.56 Mbps with the option, so the option is honored; real screen content is what approaches the ceiling.
- **Test.** The wiring pin (the constant, the merged options, the old `mime ? { mimeType: mime } : undefined` gone, the hint's sentence) and the E2E that reads the hint. **Red-first:** the option removed, and the constant changed to 2.5 Mbps, each fail the pin.

### Bug (7) [LOW] - the electron-store schema was dead for the eleven dotted keys

- **Bug.** `record.convertToMp4 = 'yes'` and a non-array `recentFiles.video` were accepted and stored (and `useRecentFiles` then crashed on the latter) while a 100-character `streamerHandle` was refused.
- **Root cause.** Conf nests a dotted key (`{ record: { convertToMp4 } }` on disk), and a schema property named `'record.convertToMp4'` matches nothing in that layout.
- **Fix.** The schema is nested per group (`tutorialSeen`, `recentFiles`, `record`, `export`, `clipKit`); the file on disk and Conf's dotted `get`/`set`/`delete` are unchanged. `settingsKnownKeys.test.ts` now flattens the schema back to dotted paths and compares THEM to the allowlist, and fails on any property name with a dot in it (the flat comparison alone passes the dead layout: both flatten to the same paths). The `store.ts` comment that said a bad value "is replaced with the default" is replaced by what is true: a bad value is refused when it is WRITTEN, and `clearInvalidConfig` resets the file only when it cannot be parsed. **Measured, and left as a disclosed ceiling (a `// simplification:` in the file):** a `config.json` that parses but breaks the schema stops the launch (Conf validates when the store opens). That was always so for the flat keys (`streamerHandle: 5` threw at construction, measured), and the dotted keys now share it.
- **Test.** `settingsClear.test.ts`, through the real handlers and store: fifteen refused shapes (the expediter's two among them), the accepted ones read back through the dotted key and found nested on disk, the ends of the range, a refused write leaving its siblings alone, a dotted key clearing like a flat one. **Red-first:** with the `record` group flattened back: `record.convertToMp4 = "yes" is refused...: promise resolved "undefined" instead of rejecting`, and the dot rule: `expected [ 'record.webcamCorner', …(1) ] to deeply equal []`; the same for `recentFiles`; a group dropped: the allowlist comparison.

### Bug (8) [LOW] - the packaged runtime was never the tested one

- `electron-builder.yml` pinned `electronVersion: 31.3.0` while the lockfile and every run used 31.7.7. The line is deleted (nothing else in the file moved) and `releaseWorkflowShape.test.ts` fails if it comes back. The release run on the Windows runner is where the packaged build is re-checked.

### Bug (9) [LOW] - leaving Record during "Starting…" orphaned a live capture

- **Root cause.** The unmount cleanup runs before any of `startRecording`'s awaits lands, so it found nothing to stop; the start then carried on in a component nobody could see: a `MediaRecorder` was started and a temp webm grew with the screen capture live. The Home link is not intercepted during "Starting…" (the guard asks for phase `'recording'`).
- **Fix.** `unmountedRef` (cleared on mount, because StrictMode runs the cleanup and the effect again in dev, and set in the unmount cleanup); `leftWhileStarting(...extra)` after each of the five awaits releases what it was handed and ends the start through `abandonStart`, the teardown the failure path now shares.
- **Test.** `record.spec.ts` "leaving Record while the capture is still opening lets go of it": the real desktop capture is held open, the Home link is clicked, the capture is released: every track ends, no temp file, and `recording:begin` was never asked (the recordings folder does not exist). The wiring pin is a syntax-tree finder (every `await` in `startRecording`'s own body is followed within two statements by `if (leftWhileStarting(...)) return`), with its own discrimination block. **Red-first:** the flag never set: `the capture was left running Expected: 0 Received: 1`; the first guard removed: `recording:begin was asked for a take nobody will see` (the later guard cleaned up, but a session had been opened and thrown away; the first version of the E2E was green on this and the folder check was added).

### Bug (10) [LOW] - a held Enter walked the Fix wizard to Apply; a keyboard Regenerate lost focus

- **Fix.** The wizard ignores a repeated Enter (`ignoreHeldEnter` on a wrapper in both bodies: React flushes the focus move to the next question inside the same event, so each auto-repeat landed on the next step's button). The Variants focus effect is keyed on the previews' identity (one shared `NO_PREVIEWS` array when there are none), not on whether there are any: Regenerate disables itself while it renders and Chromium blurs it.
- **Test.** `audio.spec.ts` "Fix Wizard: a held Enter answers one question..." (Playwright marks a second `keyboard.down` of the same key a repeat), `image.spec.ts` "variants..." (a keyboard Regenerate ends with Save all focused). **Red-first:** `Apply was pressed by a repeat` (the toast log held `Cleanup configured...`); `Expected: focused Received: inactive`.

### Bug (11) [LOW] - Clip Kit asked for a folder from scratch on every press

- **Fix.** `video:pickOutputDir` takes an optional `defaultPath`; the kit reads `clipKit.lastOutputDir` and passes it; main uses it only if it is a usable absolute path and ignores anything else (it came off disk, and a stale setting must not stop a kit).
- **Test.** `videoPickOutputDir.test.ts` (eleven cases through the real handler), `video-pipelines.spec.ts` "the Clip Kit chooser opens on the folder the last kit went to, and a stale setting is ignored" (the chooser stubbed in main, the options read). **Red-first:** `Expected: "/tmp/.../kit-parent-..." Received: undefined`; main trusting any string: the relative path, the empty string and the `..` path each fail.

### Bug (12) [LOW] - "1 clip and their edits"

- `videoDiscardMessage` says "its" at one and "their" otherwise. Unit and three E2E cases (Close in `video-core.spec.ts` and `home-chrome.spec.ts`, Replace in `record.spec.ts`). **Red-first:** `Expected: "... 1 clip and its edits will be discarded." Received: "... 1 clip and their edits will be discarded."`

### Bug (13) [LOW] - `validateChainSpec` did not check what `validateProject`'s docblock said main checks

- **Bug.** `denoise: 'parametric', denoiseParams: {}` passed the gate and died mid-export at the graph: the runner printed `afftdn=nf=NaN` (a test shows the command), which ffmpeg refuses. A cut's start or end that is a string reached `toFixed` and threw.
- **Fix.** Each cut's two times must be finite numbers, and a parametric denoise's `noiseFloorDb` and `reductionDb` must be (absent or `null` is the default, as `denoiseFilter` reads it; another strength never reads them). Refusals are finished sentences with the path-shaped detail in the console, like the second track's.
- **Test.** `audioChainValidation.test.ts` (nine cut shapes and seven denoise shapes through `audio:export` and `audio:mux`, a saved preset, the sentences through `userFacingError`, the controls, and under `NODE_ENV=production`). **Red-first:** `expected undefined to be 'The custom noise reduction has a sett…'` and `expected 'c.startSec.toFixed is not a function' to be 'One of the cuts has a start or end im…'`; the check widened to every strength: the controls case rejects.

### Bug (14) [LOW] - Timeline I / O marked a stale playhead during playback

- **Fix.** `playheadNow(state)` (`videoStore.ts`): the Player's element time when it is registered, else the store's. The Timeline's markers read it.
- **Test.** `videoStore.test.ts` (five cases: the element's time wins however stale the store is, `null` falls back, a playhead at 0 is a time and not "nothing", the registration survives opening and closing a file) and `video-core.spec.ts` "timeline: I during playback marks the frame on screen..." (the store is made stale on purpose by stopping the element's `timeupdate` before React hears it). **Red-first:** `the in point moved to the playing frame: Expected: > 0.7 Received: 0.1`; the `||` variant (0 as "nothing"): `expected 9 to be +0`.

### Bug (15) [MED, claims and one case] - the matrix stage's story misstated its own mechanism

- **What was false.** "A retag alone would not fix [bt2020nc's] pixels": on 6.1.1 a retag alone restores a graded bt709 source's tag AND pixels, and a graded bt2020nc one's (re-measured: bt2020nc plain `(0,135,0)` against the control's `(0,155,0)` with the tag `unknown`; retag only `(0,153,0)` with the tag back). The bt709 `scale`'s real job is a following Auto Zoom: `zoompan` drops the tag, a frame still in RGB at that point is converted afterwards as an untagged one, and the retag-only graph reads green `(0,133,0)` against `(0,157,0)` where the `scale` plus the retag reads `(0,155,0)`. And the ledgered upgrade recipe `scale=out_color_matrix=bt2020nc` is refused by the bundled 7.0.2 (`Undefined constant or missing '(' in 'bt2020nc'`, as is `bt470bg`); the constant that both majors accept is `bt2020`.
- **Fix.** The comments and prose are reworded where the ticket named them (`filters.ts`, `filters.test.ts`, STYLE_GUIDE, the ledger twice) and in the two places that repeated them.
- **Test.** A new Layer 5 case in the T-118 block, a bt709 source with a grade AND Auto Zoom, through the export and a compilation segment, every band against the Auto Zoom control under a bt709 decode. **Red-first, on the affected major** (the distro's 6.1.1 through a scratch alias config outside the repo; a one-test spec prints what the production resolver hands out: `/usr/bin/ffmpeg | ffmpeg version 6.1.1-3ubuntu5`, and `/home/user/imagii/node_modules/ffmpeg-static/ffmpeg | ffmpeg version 7.0.2-static` under the repo's own config): the stage as shipped, `14 passed`; with the `scale` dropped (`setparams` alone), `2 failed | 12 passed` - `green graded 0,133,0 vs control 0,157,0: expected 24 to be less than or equal to 4` on both runners, the other twelve green, which is the measurement that the scale is for this and not for the plain grade. On the bundled 7.0.2 the same mutation is green, by design (the block's header rule: 7.0.2 keeps the matrix through `colorbalance`).
- **Lesson.** **A test that cannot go red on the machine that runs it is a claim about another machine** (still true), **and a sentence that explains why a piece of code exists is a claim a test should be able to fail.** The `scale` had no test of its job for two rounds because its comment named a job it did not do.

### The rest of the ninth pass (one line each)

- **(16)** `release.yml`'s cost comment and the README's maintainer note said the workflow "never runs on push"; `push: tags: v*` is the deliberate second trigger. Both now say "manual dispatch or a pushed `v*` tag, never a branch push or a pull request" (comment and prose only; the triggers are untouched and `releaseWorkflowShape.test.ts` is green).
- **(17)** README: "28 unit tests", "360+" and "projects live at `%APPDATA%`" are count-free and true (projects are the `.imagii.json` files you save wherever you chose).
- **(18)** STYLE_GUIDE's stand-down heading is scoped to the letter-key handlers; the Ctrl+Z chord is the recorded exception (`useUndoRedoHotkeys` stands down for a field and a dialog, not a select; `useUndoRedoHotkeys.test.ts` holds it).
- **(19)** The Timeline's comment keeps the paint-order reason for the separate slider and drops the one round 69 removed on purpose. **(20)** `clipKit.ts`'s docstring quotes the Short row ("YouTube Short — the typical 3-minute limit"), and `clipKit.test.ts` asserts the string.
- **(21)** The Record guide says Esc stops the recording only while imagii is the window being used. **(22)** The five "first launch is slow, later ones fast" claims say every launch unpacks (10 to 15 s).
- **(23)** "Every preset is 1280 px or wider" is "every built-in preset is at least 1280 px on its long side" at the six sites. **(24), (25)** The ledger's native-dialog inventory, its Home table and the "tick" idiom list are re-pointed against the final tree (the two newest native confirms added; ClipList and Home cells fixed). **(26)** The bt709 and bt601 figures are attributed to their fixtures, re-measured here: bt709 red `199,42,42` against `202,45,45`, blue `38,54,195` against `40,56,197`, gray `122,124,124` against `124,126,126`; smpte170m, bt470bg and untagged alike red `204,45,46` against `205,46,47`, blue `40,57,198` against `43,58,200`, gray `125` against `128` (the same on both majors). **(27)** TESTING's skip count reads "seven new", not as a description of the skipped.
- **Lesson (the family).** **Ask of every assignment: does the thing it assigns to exist yet, and does the thing it describes govern what it says?** The `<video>` did not, the component did not, the store layout did not match its schema, and the retag did more than its comment said.

### Found, not fixed

See the round-70 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-14 — T-119 (round 69): a wait on an event that had already fired, a retag the pixels never needed, and a setting that had no way to be cleared

The nine reviewers' eighth pass over the held wave (the first with the deeper rerun briefs; every finding was checked against source and the three measured ones replicated on the real binaries). Thirteen behavior items and thirteen claim-accuracy edits. One family: **a guard, a count or a sentence that was right about the case in front of its author and silent about the next one.** `recording:abandon` waited for an event that, after a write error, had already fired; a second Start press, a second dropped audio file and a second "Edit in Video Studio" each found a door the sibling next door had closed; the Reduce-motion block governed what CSS decides and not what script asks for; the bt709 stage covered the one tag its author had met. Every behavior change was red-first and every new guard was broken once and watched to fail; the mutation table, with the sha256 before and after each restore, is in the hand-back, and the 6.1.1 transcripts for item 4 are quoted under (4).

### Bug (1) [MED] - a take whose write failed could never be thrown away

- **Bug.** When the temp file hit a write error (a full disk, a drive that went away), the renderer's own failure path - the append rejects, finalize throws, abandon runs - never got an answer from `recording:abandon`, and the partial webm outlived the "disk is full" toast.
- **Root cause.** `abandon` did `stream.once('close', ...)` and then `destroy()`. A `WriteStream` that failed a write has auto-destroyed and emitted its one `close` already, so the event never came again. The session was out of `streamSessions` too (it is deleted first, which is what makes abandon idempotent), so the quit sweep could not reap the file either.
- **Fix.** `abandon` waits only while `stream.closed` is false, never past `ABANDON_CLOSE_WAIT_MS` (2 s), and unlinks in a `finally`, so every branch reaps the file. **Deviation from the first reading, owned:** skipping the wait on `destroyed` is wrong. A stream that is destroyed but still closing holds the fd, Windows refuses to unlink an open file, and the unlink's `catch` swallows the refusal, so the partial would survive. The unit holds that case with a close it delays by 150 ms.
- **Test.** `recordingStream.test.ts`, three cases through the REAL handler (the test sees the stream the handler made by wrapping `createWriteStream`): the fd is closed under the stream so the next append rejects, the stream is left to finish dying (destroyed AND closed), and `abandon` must answer inside 1.5 s, the temp file must be gone, and a second `abandon` is `false`; a destroyed stream whose close is held for 150 ms is waited for; a close that never arrives still answers inside the bound. **Red-first** on the round-68 body: `expected 'abandon never answered' to be true // Object.is equality`, the first and third case (2 of 18). **Mutations:** the skip dropped (always wait): the first case; skip on `destroyed`: `expected false to be true` (the delayed-close case); a bound that never fires: the third case; the unlink on the waiting branch only: `expected true to be false` (the partial survived); the session left in the map: five cases, by leaking sessions.
- **Lesson.** **Awaiting a one-shot event is a claim that the event is still ahead of you.** Ask the object first (`closed`), and put a bound on every wait whose far end is a disk.

### Bug (2) [MED] - Start recording could be pressed twice

- **Bug.** The button was gated by the source alone and `phase` only changes at the end of the `getUserMedia` / `recording:begin` awaits, so a second press during the wait began a second capture over the first one's refs and orphaned it, with its temp webm still growing.
- **Fix.** `startingRef` is claimed before the first `await` and released in the `finally`; `starting` state makes the button read **Starting…** and disabled.
- **Test.** `record.spec.ts` "Start while the capture is still opening says "Starting…", cannot be pressed again, and opens exactly one take" (the capture is held open; the handler is also called twice in one tick through React's own props, and the capture is asked for once); the mic-refusal case now presses Start a second time after the refusal and expects a second refusal toast. `interactionWiring.test.ts` reads `startRecording` with a syntax-tree finder (`singleFlight`: the claim comes before the first `await`, the release is inside a `finally`) that has its own discrimination block. **Red-first:** `expect(locator).toBeDisabled() failed ... element(s) not found` on the round-68 shape; with only the ref guard gone, `Expected: 1 Received: 3` (the capture was asked for three times). **Mutations:** the button not disabled: `Expected: disabled Received: enabled`; the state never released: the mic-refusal case; the ref never released: `Expected: 2 Received: 1` at the retry (the first draft of the retry assertion did not exist and this mutation was green, so it was added); the claim moved after an `await`: `claimedFirst: false`.
- **Lesson.** **A guard released only on success eats the retry, and the retry is half of its test.**

### Bug (3) [MED] - "Edit in Video Studio" replaced a tuned session without asking

- **Bug.** The save toast's button loaded the recording over whatever Video Studio held (clips, edits, undo history) with no question, while Video Studio's own Close and T-112's Clean audio both ask.
- **Fix.** `videoDiscardMessage(clipCount, 'close' | 'replace')` (`videoStore.ts`) is the one list: Close keeps its round-18 sentence word for word, Replace says "Replace the video you're editing? N clips and their edits will be discarded.", and zero clips asks nothing. The count is read from the store when the button is pressed (the toast outlives the render that made it), and the question comes before the load.
- **Test.** `videoStore.test.ts` (three cases), `record.spec.ts` "\"Edit in Video Studio\" asks before it replaces the video being edited, and asks nothing when nothing is open" (the real `confirm` text; declining leaves the first take open), and a wiring pin that the question precedes `loadVideoSource` and that Close goes through the same helper. **Red-first:** `Expected: 1 Received: 0` (no question was asked). **Mutations:** asked at zero clips: `expected 'Close this video? 0 clips and their e…' to be null`; Replace saying Close's words: unit `expected 'Close this video? 1 clip and their ed…' to be 'Replace the video you\'re editing? 1 …'` and the same text in the E2E; the question after the load: `expected 247 to be less than 96`; Close no longer through the helper: the pin. The broader Open-project case stays T-110(n).

### Bug (4) [MED] - bt601-tagged sources still lost their tag through the Temperature slider

- **Bug.** Round 68 put the matrix stage after `colorbalance` for `bt709` only. A source tagged `smpte170m` or `bt470bg` (OBS's Rec.601 profile, SD captures) still came out of 6.1.1 with `color_space=unknown`, and every built-in preset is at least 1280 px on its long side, where a player that guesses reads an untagged file as bt709, so the stripped file shifts exactly like the bt709 case did.
- **Fix.** `smpte170m` and `bt470bg` get `setparams=colorspace=<that tag>` right after `colorbalance` and NOTHING else; `bt709` keeps `scale=out_color_matrix=bt709,setparams=colorspace=bt709`; untagged, `unknown`, `bt2020nc` and any other string get nothing. The tag is printed from the matched literal, never from the probe's string. The skip rationale is reworded everywhere it was written (`filters.ts`, `media.spec.ts`, `filters.test.ts`, STYLE_GUIDE, the ledger): untagged and bt601 are skipped because the round trip is SYMMETRIC (swscale reads and writes bt601 by default), NOT because "players assume bt601" - at HD they guess bt709, for the input and the output alike, which is what the ledger's own "correct but untagged" Auto Zoom line already said.
- **Test.** Unit: `filters.test.ts` (the per-tag shape: setparams only for the two bt601 tags at five temperatures, no `scale`, the two tags told apart, the stage order after `colorbalance` and before whatever follows, a crop, and ten inputs that get nothing - no tag, `null`, an empty string, `unknown`, `bt2020nc`, `bt470m`, `fcc`, `smpte240m`, a smuggled filter, the wrong case), `gradeMatrix.test.ts` (each real runner's `-vf` for each tag). Layer 5, in the T-118 block (seven new cases): both bt601 fixtures are what they say (tagged, probed as tagged, decoding to the colors they were drawn as under a 601 decode), each tag through the export and a compilation segment at a cast of 0.01 against the ungraded control under a 601 decode with the tag asserted on the output, and a full warm grade on the gray band. **Red-first on the affected major** (the distro's `/usr/bin/ffmpeg` 6.1.1-3ubuntu5 through a scratch config that aliases `ffmpeg-static`, `ffprobe-static` and `@shared`, kept out of the repo, with a one-test spec that prints what the production resolver hands out: `/usr/bin/ffmpeg | ffmpeg version 6.1.1-3ubuntu5`): the stage as shipped, `12 passed`; the bt601 branch removed, `5 failed | 7 passed` - `the graded output is still tagged smpte170m: expected undefined to be 'smpte170m'` (and the `bt470bg` twin, on both runners, and the warm-grade case); the whole stage removed, `8 failed | 4 passed` (round 68's three bt709 reds, `green graded 0,130,0 vs control 0,157,0: expected 27 to be less than or equal to 4`, plus those five); the bt709 recipe given to the bt601 sources instead of the tag alone, `4 failed | 8 passed` - `green graded 11,184,3 vs control 0,158,0: expected 26 to be less than or equal to 4`, which is the measurement that settles the mechanism: the tag survives and the pixels do not, so the tag alone is the stage. On the bundled 7.0.2 the same block is `12 passed` with the bt601 branch removed and with it present: **green by design**, as the T-118 cases are, because 7.0.2 keeps the tag. **Mutations (unit):** the branch removed: 9 red; widened to any tag: 7 red (including `unknown`); bt601 also rescaled: 6 red; both tags written back as `smpte170m`: 5 red; the tag written before `colorbalance`: 8 red; `export.ts` and `concat.ts` no longer handing over the probe's value: 3 red each, exactly that runner's cases.
- **Measured, and corrected.** On the suite's own fixtures the pixels are within **3** levels of the ungraded control on both majors for the bt709 cases, not the 2 `filters.ts` said (bt709: red 199,42,42 against 202,45,45, blue 38,54,195 against 40,56,197, gray 122,124,124 against 124,126,126), and the bt601 cases read the same 3 (smpte170m and bt470bg alike, and the untagged fixture: red 204,45,46 against 205,46,47, blue 40,57,198 against 43,58,200, gray 125 against 128); the "within 1 level" in the first draft of this item's comments was the one-off hand fixture. The no-op cast on 6.1.1 turns player-view green (0,157,0) into (0,130,0) in the suite's runners, not (0,133,0) (the hand fixture's figure); both measurements are named where they are used.
- **Lesson.** **A test that cannot go red on the machine that runs it is a claim about another machine** (round 68's lesson, still true: the new cases are the record, the unit pair is the regression suite), **and a rationale that says why a case is skipped has to be true of the thing it skips.** "Players assume bt601" was false at HD, and the untagged skip was right for a different reason.

### Bug (5) - the keyboard path the guide promised did not exist

- **Bug.** The guide's sequence is "click the track, press `I`". A click on the track hands the keyboard to the Playhead slider, not to the Player's column where `I` / `O` and `,` / `.` were handled, so the keys did nothing; and the two trim-handle `<button>`s were dead tab stops that announced themselves as buttons ("Trim start", "Trim end") and did nothing on Enter or Space.
- **Fix.** `Timeline.onScrubKey` handles `I` / `O` (the same store actions as the Player, and the gesture ended, so a keypress is its own undo step) and `,` / `.` (one frame), with the Player's text-field stand-down. The Player has no modal guard to copy (its handler is on its own column, and a dialog's focus trap keeps the keys inside it). The handles are `tabIndex={-1}` and `aria-hidden`, with no name.
- **Test.** `video-core.spec.ts` "timeline: click the track, then I and O set the in and out points and , and . step a frame; the trim handles are pointer-only": click at 40 percent, `I` moves In; click at 80 percent, `O` moves Out and In stays; Undo takes Out back; Home, `I`, five nudges, `I` again and Undo takes the in point back to the first `I`; `.` and `,` step a frame; two `aria-hidden` handles with `tabindex=-1`, no `Trim` button, and Tab from the slider never lands on one. **Red-first:** `Expected: > 0.5 Received: 0` (In stays at 0 after the press). **Mutations:** `I` dropped: the same; `O` dropped: `Expected: < 2 Received: 2`; `,` and `.` dropped: the frame-step poll; the start handle a named tab stop again: `Expected: 2 Received: 1` aria-hidden handles; `endGesture` dropped: `Undo took the second I back to the first ... Expected: < 0.15 Received: 0.8`; the text-field stand-down dropped: the wiring pin only (the slider has no children, so no key can reach it from a field today).
- **Lesson.** **A keyboard test with a click between the steps cannot see a missing end-of-gesture:** the store closes the undo window on every pointer-up, so the first draft of the undo assertion (a click, `I`, a click, `O`, Undo) was green with `endGesture` removed. The step that discriminates is two keypresses with the keyboard alone between them.

### Bug (6) - a late audio extraction clobbered the file that was open

- **Bug.** The audio importer had no single-flight (T-112 gave one to the video sibling): drop a video, drop a second file while the extraction ran, and the first landed after the second had loaded and been tuned.
- **Fix.** `busyRef` and `refuseIfBusy` as the video Importer has them, on the drop (before the cloud-sync warning, so a person is not told two things that disagree), on the picker, and in `loadFile` (Recent goes through it); the flag is released in a `finally`, so a refused file does not stick.
- **Test.** `audio.spec.ts` "a second file while the first one is still being extracted is refused, from a drop and from Recent, and the first one is what opens" (a held ffmpeg; one extraction in the spawn log; a text file refused first and the next file taken after, so the flag does not stick). The picker leg is a native dialog; it is held by the wiring pin. **Red-first:** `Expected value: "Still extracting audio from the last file. Wait for it to finish."` against a toast log that held the cloud-sync warning instead. **Mutations:** `loadFile` unguarded: the Recent leg (`Drop audio or video here` not visible); the drop unguarded: `Expected pattern: not /cloud-sync/i`; the flag never released: `Expected value: "Extracting audio…"` (the file after the refusal was refused too); the picker unguarded: the wiring pin.

### Bug (7) - "Show models folder" opened nothing on a fresh profile

- **Bug.** Nothing creates `<userData>/models` before the model installer runs, so on a fresh profile the button handed `shell.openPath` a folder that was not there, on the card that tells a person to put the model in it.
- **Fix.** The handler makes the folder (recursive) and then awaits `shell.openPath`, logging a non-empty answer. A folder that cannot be made is logged, not thrown: the button calls the bridge with no `catch`, so a rejection would have been an unhandled one.
- **Test.** `captionsOpenFolder.test.ts` (the real handler on a real tree): the folder exists at the instant the shell is asked, parents too, an existing folder is left as it is, a non-empty answer is logged and an empty one is not, a file where the folder goes does not throw. **Red-first:** `expected { existed: false, …(1) } to deeply equal { existed: true, …(1) }` (4 of 5 red). **Mutations:** no mkdir: 3 red; the folder made after the shell is asked: the same assertion; the answer not logged: `expected "error" to be called 1 times, but got 0 times`; the `catch` removed: `promise rejected "Error: EEXIST: file already exists, mkdir…" instead of resolving`. The shell opening a window is the OS boundary; the ledger says so.

### Bug (8) - the wizards dropped keyboard focus on every step

- **Bug.** Each answer in the Fix wizard unmounts the buttons that were just pressed, and Variants' Generate button is swapped for the previews; the focused element went with it, focus fell to the page behind the dialog, and the trap only places focus when the dialog opens.
- **Fix.** An effect keyed on the swap focuses the new content's primary control (each question's first option, Apply on the summary; **Save all** in Variants), the Tutorial coachmark's pattern; declared above the early return.
- **Test.** `audio.spec.ts` "Fix Wizard keeps keyboard focus on every step: the first option of each question, then Apply" (keyboard only through all three questions, Start over, the trap still cycles and Escape returns to the opener); `image.spec.ts` "variants: generate four tiles..." asserts **Save all** is focused when the previews arrive. **Red-first:** `Expected: focused Received: inactive`. **Mutations:** the first option's ref dropped: the same at question 1; Apply's ref dropped: at Apply; the effect keyed on `open` only: at question 2; Variants' ref or its effect dropped: at **Save all**. The full Playwright run then found the one older case that pinned the old opening focus (`home-chrome.spec.ts` "Modal contract (FixWizard)" expected focus on **Close** when the wizard opens); it is re-pinned to the first answer, with the trap's two wraps asserted from there. **Lesson: a fix's own tests are not the suite.** The focused runs of the new case, and every mutation of it, were green or red for the right reasons and could not see a contract case written for the behavior being changed.

### Bug (9) - typing in the Export format select switched the tool, and Delete removed a layer

- **Bug.** The shortcut guard stood down for `INPUT` and `TEXTAREA` only, and the Export format and Scale `<select>`s are inline panels, not Modals: `p` to reach PNG switched the tool to Pencil, and Delete over a select removed the selected layer.
- **Fix.** `SELECT` joins the tag guard.
- **Test.** `image.spec.ts` "a focused select owns the keys..." (`j` selects JPG; `p r o l`, Delete and Backspace change nothing; the Scale select likewise; with focus back on the page the same keys work, so the pins are about the select and not a dead handler). **Red-first:** `Expected: visible` of `Tool: Select` (the tool had switched). **Mutations:** `SELECT` honored for the letters but not for Delete: `Expected substring: "Layers (2)" Received string: "Layers (1)Text"`.

### Bug (10) - the clip rename field was the one input in the app with no focus ring

- **Bug.** `outline-none focus:bg-bg-base` on the rename input: the background change is 1.06:1 against the card, against DESIGN_GUIDE's rule that interactive elements keep a visible ring.
- **Why the sweep missed it.** It had no rule about `outline-none` at all (the ticket assumed one): rules 1-4 are selection state, scroller focus, progress bars and hover-only controls, and the `.btn-*` classes carry their ring in the class, so no hand-written input was ever looked at.
- **Fix.** `focus:ring-1 focus:ring-accent`, and rule 5 in `a11ySweep.test.ts`: `outline-none` needs a `focus:ring-` or `focus-visible:ring-` of its own, the `role="dialog"` card (focused by script) excepted, with a discrimination block (the unfixed class string, a ring that is always on or only on hover, both spellings of the fix, the dialog card, a class that merely contains the letters). It found exactly one element.
- **Test / red-first.** The rule against the unfixed class string: `expected [ Array(1) ] to deeply equal []`, the array holding `modules/video-studio/ClipList.tsx:133`. `video-core.spec.ts` "clip list: add, rename, select, speed slider and speed reset" reads the computed `box-shadow`: `Expected substring: "rgb(255, 49, 49)" Received string: "none"`.

### Bug (11) - the tutorial scrolled smoothly under "Reduce motion"

- **Bug.** `scrollIntoView({ behavior: 'smooth' })` is an explicit option; the CSS `scroll-behavior: auto` of the `prefers-reduced-motion` block does not govern it, so the page glided to every step under the OS setting that exists to stop that. The comment in `index.css` said the block disabled "smooth scrolling across the whole app".
- **Fix.** `tutorialScrollBehavior(reduceMotion)` (`'auto'` under Reduce motion) fed by `matchMedia`; the CSS comment says what the block governs and where script has to ask for itself.
- **Test.** `Tutorial.test.ts` (the pure choice) and `home-chrome.spec.ts` "T-119 the coachmark scrolls instantly under Reduce motion and smoothly otherwise" (every `scrollIntoView` on the page recorded with the behavior it asked for, under both emulated settings). **Red-first:** `toEqual(['auto'])` against `['smooth']`. **Mutations:** the media query not read: the same; the choice inverted: `expected 'smooth' to be 'auto'` and the E2E.

### Bug (12) - `validateProject` accepted studios that threw as soon as they rendered

- **Bug.** `clips: [{}]`, `chain: {}` and `doc: {}` all validated; the app then threw in render (`for (const p of clip.selectedPresets)`, `chain.gainDb.toFixed`) or silently killed autosave capture (`doc.layers.length`).
- **Fix.** The fields a studio reads without a guard are required, with refusals in the file's reason style: a clip's `id`, `name`, `startSec`, `endSec`, `selectedPresets` (an array of strings); the chain's `gainDb`, `loudnormTargetLufs` and `cutRegions` (each with two numbers); `doc.layers` as an array. What a studio reads with a default stays optional exactly as an older build left it, and the second-track and overlay refusals are still named first.
- **Test.** `projectValidation.test.ts` (the three empty shapes, every field wrong in every way, the clip that is wrong named by index, whole clips with and without every optional field accepted, the empty-array studios accepted, and the three shapes through the file reader the autosave and Open project use). **Red-first:** all three removed, `33 failed | 129 passed` of 162, each `the project was accepted`. **Mutations:** clips: 17 red; chain: 12; doc: 6; `selectedPresets` alone: `Cannot read properties of undefined (reading 'length')`; the chain check moved ahead of the second-track refusals: `expected 'audioStudio.chain.gainDb not a number' to match /secondaryTrack/` (3 red, two of them older path-safety cases).

### Bug (13) - a blank export left the old watermark for Clip Kit to stamp

- **Bug.** `ExportPanel` wrote `streamerHandle` and `watermarkPosition` only when there was a handle, and the guide says the kit stamps "the watermark you last exported with": a person who cleared the field to stop stamping still got the old handle on every kit file.
- **Fix.** A blank export clears both keys. They had no way to be cleared: electron-store refuses `undefined` from `set` ("Use `delete()` to clear values"), so `setSetting` deletes the key for `undefined` and stores everything else as before (`null` included, which the string schema still refuses).
- **Test.** `settingsClear.test.ts` (the real `settings:set` / `settings:get` over the real store against a file in a temp folder: both keys gone from memory and from the file, clearing a key never saved is not an error, only the key given is cleared, `null` and a bad corner are still refused, an unknown key still refused), `interactionWiring.test.ts` (the two clears sit in the else branch of the block that writes them), and `video-pipelines.spec.ts` "a blank export forgets the saved watermark, and the kit stamps nothing after it" (a handle seeded, the field emptied, one export, both keys absent from `config.json`, then Clip Kit writes five files and `Saved your Clip Kit`, which on this platform's drawtext-less ffmpeg a stamped kit cannot). **Red-first:** `Expected: false Received: true` (the key is still in the file); past that assertion, `Expected: 5 Received: 0` (the stamped kit died on `drawtext`); with `setSetting` back to a plain `set`, `TypeError: Use \`delete()\` to clear values` (3 of 5), and in the E2E the export itself never starts, because the rejected write sits ahead of the queue. **Mutations:** only the handle cleared, only the corner cleared (each fails the file assertion on the other key); `null` also clearing: `promise resolved "undefined" instead of rejecting`.
- **Lesson.** **A feature that remembers needs a verb for forgetting.** The write half shipped in T-49 and T-85 without one, so the only way to un-remember was a state the UI could not reach.

### The rest of the eighth pass (one line each)

- **(14) README and the release notes said an absolute.** `README.md` called reference search "the only feature that touches the internet" while its own system-requirements note says the model download goes online, and the release body said "Everything stays on your computer": both name the two exceptions now (the release edit is body text only), and `truthInCopy.test.ts` reads both files (red against each old line). The same phrase is in `HOW_IMAGII_WAS_MADE.md` ("the only feature that touches the network", a history of the build) and is not changed here; it is in the ledger's "Found, not fixed".
- **(15), (16) The mux comment.** `process.ts` said `amix` "runs to its longest input, so the mix is max(voice, music)" (true with Duck off; the ducked bed ends with the voice) and called Reframe a whole-file re-encode "with no bitrate cap" while `reframe.ts` sets `-b:v 6M -r 30` on a trimmed range. Both are scoped, T-110(af) is cited, and the echo in the T-82 entry below is corrected in place.
- **(17), (18), (19), (20) Numbers and quotes.** "Within 2 levels" is 3; the hand-fixture figure `(0,133,0)` is 130 in the suite's runners (`filters.ts`, `filters.test.ts`, `media.spec.ts` twice, STYLE_GUIDE); the Layer 5 title is quoted exactly ("the temperature grade keeps a bt709-tagged source in bt709 (real ffmpeg, T-118)"); "colour" is "color" in a test title. Caught while measuring (4): the "within 1 level" for bt601 was the same kind of figure.
- **(21) Meta extended Reels to 3 minutes in January 2025**, not 2024 (`presets.ts`, and the "same year" in the stale-limits entry below).
- **(22) The spawn count.** `spawnWindowsHide.test.ts` said thirteen sites had the option and three did not; the tree has seventeen (fourteen and three), and the floor of 16 tolerated losing a site. Measured: with one site made invisible to the scan, the floor of 16 stays green and 17 fails (`expected 16 to be greater than or equal to 17`).
- **(23) "any more" is "anymore"** in the ledger's own row. **(24) The ffmpeg-era inventory** is recounted (seven places on ten lines, with the cites as they sit now) and the string literals and regex alternatives that spell "cancelled" the old way join the literals clause.
- **(25) The softness prose** says "strictly between 80 and 175" (the suite's bounds are exclusive; counted inclusively the scaled frame is 49.3 percent, not 48.5) and labels which frame its edge figure describes: column 0 has 3 pure pixels at each end on the scaled frame and 36 after the encode (row 0: 48 on both). Re-measured on both majors with the T-115 fixture.
- **(26) Cites into `ImageStudio.tsx`** from `image.spec.ts` are re-pointed to where the guard sits after the SELECT edit (`:62-71`, `:63`, `:54-55`).
- **Lesson (the family).** **Before writing "closed", "refused" or "the same as" about one place, name the sibling and the event the claim does not cover.** The importer next door had the guard; the stream had already emitted; the CSS block governs CSS; the second tag is a tag.

### Found, not fixed

See the round-69 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-10 — T-118 (round 68): a cause nobody could raise, a fix that passed on the wrong binary, and a separator the escaper had not met

The nine reviewers' seventh pass over the held wave (QA, audio, privacy and streamer clean; accessibility and UX clean after two T-110 filings). Seven items: three behavior changes (the Autosave Clear's errno, the bt709 matrix stage, the `=` in a caption path) and four claim-accuracy edits (a comment, the softness prose, two disclosure counts). One family: **a claim that was true of the piece in front of its author and could not be true of the whole.** Round 67's toast promised a cause that its producer never raised; the bt709 case is green on the one binary where the bug does not exist; the escaper had been "verified against real ffmpeg" for the characters someone thought of. Every behavior change was red-first (the quotes are below) and every new guard was broken once and watched to fail; the full mutation table, with the sha256 before and after each restore, is in the hand-back.

### Bug (1) - the Autosave banner's Clear could never name a locked file

- **Bug.** Round 67 sent the Clear failure through `userFacingError`, which maps `EBUSY`, `EPERM` and `EACCES` to "Windows blocked access to a file. Close any app using it, or check your antivirus." The comment above the call and the lessons entry (4b) both said a locked autosave is named. It never was: the person always read the bare "Couldn't clear the autosave. It's still on disk.", and the advice to close what was using the file, true for exactly that case, had been dropped in the same round.
- **Root cause.** `clearAutosave` (`main/autosave.ts`) swallowed every unlink errno (T-57's `existsSync` decides whether a failure mattered, correctly) and threw `could not delete autosave.json`. The renderer's half was tested with a stub that threw the string `EBUSY: resource busy or locked, unlink 'C:\Users\...'`, a shape main has never raised. Two halves, each green against the other's imagined output.
- **Fix.** The first failed unlink's `code`, taken only from a file that is still there afterwards (a file a second window already cleared is not a failure and its ENOENT is not reported), ends the message: `could not delete autosave.json (EBUSY)`. No trailing period, on purpose: a shape the helper has no words for must stay out of tier 2 ("a finished sentence a person wrote") and fall to the caller's sentence. The comment in `AutosaveRestore.tsx` names only the cause that can occur (a locked file; unlink has no full-disk shape), and (4b) below says what is true.
- **Test.** `autosave.test.ts` drives the REAL `clearAutosave` with an `unlink` stand-in (a `vi.doMock` of `node:fs/promises` that keeps everything else real) and feeds the thrown error to the REAL `userFacingError`: EBUSY and EPERM end in the cause sentence, also after Electron's envelope; no code is the bare shape and the bare sentence; `EROFS` has no words and is the bare sentence; the FIRST of three failures supplies the code; a file that vanished under its unlink (ENOENT) is not reported while the folder that really stayed supplies `EISDIR`/`EPERM`. `userFacingError.test.ts` holds the shapes as literals, wrapped as Electron wraps them. `home-chrome.spec.ts`: the first stub is the shape main raises when the failed unlink carries no code (and now asserts that no cause is guessed), the second is main's real new shape. **Red-first:** 7 of the 8 new or changed autosave cases failed on the old function (`expected 'could not delete autosave.json' to be 'could not delete autosave.json (EBUSY)'`; the bare-shape case passed on both and is the control). **Mutations:** the errno dropped again: the same 7; the last failure supplies the code: the "FIRST" case; a vanished file's code reported: `expected 'could not delete autosave.tmp (ENOENT)' to match /...(EISDIR|EPERM)/`; E2E, the second stub given `(EISDIR)`: `Received string: "Couldn't clear the autosave. It's still on disk. | Couldn't clear the autosave. It's still on disk."` after the 20 s poll; the first stub given `(EBUSY)`: `Expected substring: not "Windows blocked access"`.
- **Lesson.** **A stub "verbatim from the producer" is only as true as the producer.** The renderer's mapping was right, tested and shipped, and nothing in the system could ever hand it the input it was tested on. When a consumer's sentence depends on a field, the producer's test has to assert the field; when a test stubs the producer, the stub's text has to be copied from a run of the producer, not from the consumer's regex.

### Bug (6) [MED] - the Temperature grade shifted saturated colors on the shipped ffmpeg, and the case that proves the fix is green on the other one

- **Bug.** On the win32 ffmpeg (6.1.1) a bt709-tagged source (OBS's default) with any Temperature set came out in the wrong matrix and with its tag stripped, while every player reads an HD file as bt709: SMPTE green `(0,157,0)` became `(0,133,0)` for a no-op cast. Reproduced here on the distro's 6.1.1 through the real runners as `(0,130,0)` against the control's `(0,157,0)`, for a cast of 0.01. The bundled linux 7.0.2 keeps both the matrix and the tag, so nothing in the suite, on any dev box or CI run that is not the Windows release, could see it.
- **Root cause.** `colorbalance` is an RGB filter; ffmpeg converts YUV to RGB with the frame's tagged matrix and back with bt601 on 6.1.1 and writes `color_space=unknown`. Every grade fixture in Layer 5 is a neutral gray, which is the same in every matrix, so none was able to fail.
- **Fix.** `probeVideo` carries the video stream's `color_space` (`colorSpace`, absent when untagged or `unknown`); `runExportJob` (and so Clip Kit) and `runConcat` hand it to `buildVideoFilter` in `source.colorSpace`; when it is `bt709` and the grade has a temperature, `colorGradeFilter` appends `scale=out_color_matrix=bt709,setparams=colorspace=bt709` right after `colorbalance`. Untagged, `unknown` and bt601 sources get nothing. **[Superseded in part by T-119, round 69: the two bt601 tags, `smpte170m` and `bt470bg`, lost their tag the same way and now get `setparams=colorspace=<tag>` alone; untagged and `unknown` still get nothing, for the symmetric round trip and not because "players assume bt601".]** **Deviation, owned:** the ticket's mechanism was the `scale` alone, and said the output is re-tagged by it. Measured on 6.1.1 with the real runners, the `scale` puts the pixels back (green `(0,155,0)` against `(0,157,0)`) and does NOT re-tag (`color_space` stays `unknown`; 7.0.2's `scale` does re-tag); `setparams=colorspace=bt709` writes the tag back (verified by hand with `-vf` variants: `out_range`, `in_color_matrix`, `lanczos` and a following `format` all left it `unknown`). The ticket's own acceptance, "the output keeps `color_space=bt709`", is false on the shipped major without it, so it is in the stage; dropping it is a one-token edit in `filters.ts` and one in each pin.
- **Test.** Unit: `filters.test.ts` (the stage and the tag immediately after `colorbalance` for bt709 at five temperatures, none for no code, null, empty, `unknown`, `bt470bg` and `smpte170m` (the last two now get the tag alone, T-119), none without a temperature or with only eq-type grades, the order eq, colorbalance, matrix, tag, then whatever follows the grade, and a manual crop does not hide the source), `gradeMatrix.test.ts` (the real `runExportJob` and `runConcat` against a fake child and a fake probe: each runner's `-vf` carries the stage for a bt709 probe and not for an untagged or bt601 one). Layer 5, "the temperature grade keeps a bt709-tagged source in bt709": four saturated bands converted into bt709 and tagged (checked: ffprobe, `probeVideo`, and the bands decoded as player sees them match what was drawn), through the export and a compilation segment, graded at 0.01 and compared with the ungraded control after a player-style decode within 4 levels, the output still tagged bt709, a full warm grade still warms the gray band, and an untagged source's grade within 4 levels of its control under a bt601 decode. **Red-first on the affected major** (the distro's `/usr/bin/ffmpeg` 6.1.1 through a scratch config that aliases `ffmpeg-static` and `ffprobe-static`, kept out of the repo): with the stage removed, `3 failed | 2 passed`, `green graded 0,130,0 vs control 0,157,0: expected 27 to be less than or equal to 4` on both runners and `the graded output is still tagged bt709: expected undefined to be 'bt709'` on all three graded cases; with the ticket's `scale` alone, the pixel assertions pass and only the tag assertions fail; with the stage as shipped, `5 passed`. On the bundled 7.0.2 the stage removed gives `5 passed`, which is the point of the next paragraph. **Mutations:** the stage removed (5 unit reds), widened to any tagged source (6 reds: bt601, PAL and `unknown`), `export.ts` no longer handing over the probe's value (exactly the export case), `concat.ts` the same (exactly the compilation case), `probe.ts` no longer reading `color_space` (the Layer 5 fixture case).
- **Lesson.** **A test that cannot go red on the machine that runs it is a claim about another machine.** The case is written, runs everywhere and is green on every dev box with or without the fix; its red exists only on a 6.1.1 binary, so the unit pins that fail anywhere (the builder, and each runner's wiring) are the regression suite and the Layer 5 case is the record that the real binary agrees. Say so in the test's header, and record the one-off run on the affected major in the Done entry. And a fixture has to be able to see the property: a neutral gray is blind to a matrix by construction, which is why the bug lived through nine Layer 5 grade cases.

### Bug (7) - a video called `Boss=Dead.mp4` could never be captioned

- **Bug.** The burn-in failed with `Error applying option '.../a' to filter 'subtitles': Option not found` (exit 8) for any caption file whose name holds an equals sign, on both ffmpeg majors. The person's only recourse was renaming the video and transcribing again.
- **Root cause.** `escapeSubtitlesPath` was "verified against real ffmpeg for apostrophes, spaces, commas, semicolons, brackets and Windows drive colons"; the path is the filter's FIRST, positional option (`subtitles=<path>:force_style=...`), so the option parser reads an unescaped `=` as a name and a value. The list of tested characters was the list of characters someone had thought of.
- **Fix.** `=` in both character classes of `escapeSubtitlesPath`. Measured: the real binary needs it in the FIRST class (the option-level escape) only. With it in the first class alone, `a=b.srt` also burns, because the second round escapes the backslash the first round added, and the filtergraph parser has no use for `=`. It is in both, as the ticket and the other separators have it, and the class-2 half is pinned by the unit alone.
- **Test.** `captions.test.ts` ("escapes an equals sign twice, like the other separators": one, two and a repeated `=`) and the Layer 5 `it.each` of the burn-in escapes gains `a=b.srt`. **Red-first:** unit `expected '/a/a=b.srt' to be '/a/a\\\=b.srt'`; Layer 5 `Error applying option '/tmp/imagii-media-.../a' to filter 'subtitles': Option not found` / `ffmpeg exit 8`. **Mutations:** `=` out of the first class: unit red and Layer 5 exit 8; out of the second only: unit red, Layer 5 still green (the measurement above). Run once against the distro's 6.1.1 as well: all five escape cases pass.
- **Lesson.** **An escaper is tested with every character its parser treats as syntax, not the ones its author met.** The cheap way to get the list is the parser's own source, and the cheap tell is a docstring that enumerates what was verified.

### The rest of the seventh pass (one line each)

- **(2) A comment that said the whole toast "says the take is gone".** `RecordStudio.tsx` now says which branch says what: only the convert sentence says "Nothing was saved"; with Convert off, the copy branch's ENOSPC/EPERM causes advise "try again" while `promoteTempWebm`'s `finally` has already deleted the take. Comment only; the product call is T-110(u).
- **(3) The softness prose, measured twice and still wrong in its labels.** "About half the pixels (48 percent) between black and white" and "the left and top edge stay hard (nothing to blend)" (seven places, with the guides, LESSONS twice, TESTING, the ledger and the Layer 5 comment) are replaced by what the instruments say. Re-measured here on the T-115 fixture (321x241 lossless 1-pixel checkerboard, `scale=320:240`): 48.5 percent of the frame in the mid-gray band strictly between 80 and 175 that `hardness` counts (47.5 after `libx264 -preset fast`; the suite's bounds are exclusive, `v > 80 && v < 175`, and counted inclusively the scaled frame is 49.3, the figure round 69 caught the prose rounding past); 96.2 percent strictly between 0 and 255 and 3.8 percent still exactly 0 or 255 on the scaled frame (92.0 and 8.0 after the encode); the interior 60 pixels in from the edges is 85 percent in the band and none pure; every edge is soft at its middle (row 0: 70 of 320 pixels in the band, 48 pure at each end, scaled frame and encode alike) and only the four corners are hard (column 0 of 240: 3 pure at each end on the scaled frame, 36 at each end after the encode; round 68 gave the 36 in a sentence about the scaled frame). The first-draft wording named a band and called it a range. **Lesson: when a measurement has a name (a band, a threshold), the sentence reports the name.** The Layer 5 comment's "most of the frame" is "about half".
- **(4) The "any more" disclosure** cited `interactionWiring.test.ts:716` for a title that sits at `:721`, and wave-added `STYLE_GUIDE.md:336` carries the spelling in prose; the cite is re-pointed and the line is listed. (Those were the round-68 line numbers; after round 69's edits the title is at `:731` and the prose at `STYLE_GUIDE.md:355`.)
- **(5) Category (5) of the spelling disclosure** counted `audio.spec.ts:1861` (the file name `'cancelled.mp3'`) as a comment and missed its sibling `media.spec.ts` assertion message `'the recording convert was cancelled'`; it is eighteen comments and titles plus the two literals, named, and the stale `failurePathLanguage.test.ts:245` is `:273-278`. The line numbers the disclosures cite into files this round edited were re-pointed (`media.spec.ts` for "honours" and the cancelled literal, `captions.test.ts` for "recognises", `AutosaveRestore.tsx`, `filters.ts` and `RecordStudio.tsx` in the tick list).
- **(4b) corrected.** Entry (4b) of the round-67 list says a locked autosave is named in plain words; it was not until this round (item 1 above).
- **Lesson (the family).** **Say which instrument measured the claim.** A toast promised a cause no code could produce, a regression case was green on the binary where the bug cannot occur, an escaper was verified for the characters its author listed, a band was reported as a range. In each the claim was true of the piece in front of its author. Before writing "named", "fixed" or "covered", ask what, running where, could have made the sentence false.

### Found, not fixed

See the round-68 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-10 — T-117 (round 67): a gate that fit its example, a day that was three different days, and a toast that only took off the envelope

The nine reviewers' sixth pass over the held wave (privacy, accessibility and electron came back clean; every finding was LOW - the second pass in a row with no MED). Five code items and four docs items, and two families. **A gate written for the example in front of its author**: an id waved through "since it's not a path", and a "starts with two dots" test for a question about path segments. **Three places that each answered "what day is it" their own way**: the export panel's `{date}` read the person's clock, the Clip Kit folder and Record's file name read UTC.

### Bug (1) - `audio:deletePreset` joined the renderer's id into a path and unlinked it

- **Bug.** `audio:deletePreset('../config')` deleted `<userData>/config.json` (and any `<x>.json` the join could reach). The Delete button cannot send it - the list is built from files main wrote and the renderer hands back the id it was given - but the IPC boundary is where an untrusted string first arrives, and every sibling store had a gate here except this one.
- **Root cause.** `audio/presets.ts` did `path.join(presetsDir(), `${id}.json`)` on the raw id. The audio IPC pass in round 16 moved six handlers to `assertSafeAbsolutePath` and left the preset id on `assertNonEmptyString`, with a one-line reason in this file: "since they're not paths". It is one. `customPresets.ts` (round 15, INIT-C), the mood boards and the search handlers all gate the same id with the alphabet nanoid mints; the audio twin of `customPresets.ts` got its parse fix in round 18 and never this one.
- **Fix.** `isSafeId` / `assertSafeId` in `shared/pathSafety.ts` (`[A-Za-z0-9_-]`; `assertAlways`, so it throws under `NODE_ENV=production` too). Three places, because the id is a path in one and reaches the renderer in the other two: `deletePreset` (the store), the `audio:deletePreset` handler (the way `ipc/search.ts` does for mood boards), and `parseChainPreset` (a hand-edited file whose id is `../config` is not a preset the list shows, so Delete can never be aimed by the list). `savePreset` mints its own id and `listPresets` reads by directory entry: `deletePreset` was the one id-to-path site. The old line above (round 16's "Audio IPC handlers accepted traversal paths") is corrected in place.
- **Test.** `presets.test.ts` on REAL files in a temp userData: `../config`, `sub/../../config` and `../notes/keep` each aim at a real file one folder up, and after the call the file is still there and the call refused with "nanoid alphabet" (the test first asserts the join really lands on the file, so a green run is a refusal and not a miss); empty, a space, `x.json`, `..`, a slash, a backslash, a NUL, a trailing newline, a number, `undefined` and an object each refuse and delete nothing; the parser refuses the same ids and still takes every id nanoid can mint; the list skips a planted file whose id is `../config`; the minted id still deletes. `audioPresetIds.test.ts` drives the real handler with the store wrapped in a spy, so a green run proves the HANDLER refused (the store's own guard would otherwise answer first and hide a missing one). `pathSafety.test.ts` holds the alphabet. Red-first: the survival assertion went red with `ENOENT: no such file or directory, open '<userData>/config.json'` - the real unlink had run - for all three traversal ids at the store and the one at the handler; 21 of the new store cases and 8 of the handler's were red.
- **Lesson.** **"Not a path" is a claim about a use, not about a type.** A rationale that exempts a field from a gate is a bet on every future caller, and the cheap check is a grep for the field inside a `join` or `resolve`. This entry's own lesson said "mirror the change across every adjacent surface" and carried an exemption list one line long; an exemption list gets the same grep.

### Bug (2) - a transcript called `..intro` was "outside" the captions folder

- **Bug.** A video named `..intro.mp4` (legal on Windows) is transcribed to `<userData>/captions/..intro.srt`. Save .srt refused the app's own file with "That transcript isn't in imagii's captions folder on this computer - transcribe the video again." (round 66's sentence), and transcribing again writes the same name into the same folder and is refused again. The Clip Kit asked `captions:writeKitSrt` for the same file, got `ok: false`, and dropped the kit's captions without a word.
- **Root cause.** The gate was `rel.startsWith('..')` on `path.relative(root, target)`, written three times (`captions:saveSrt`, `captions:writeKitSrt`, the mood-board thumbnail gate) from the round-15 pattern. The question is whether the first path SEGMENT is `..`; the test asked whether the first two characters are. The three existing pins used genuine climbs only, so they passed on the wrong rule and on the right one, and `round17Coverage.test.ts` tested a hand-copied version of the expression and not the handler.
- **Fix.** `isOutsideFolder(root, target)` (`main/pathConfine.ts`): `rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)`, with the path flavor as an optional argument so the tests hold the Windows rules from any machine. All three sites call it; it is in main and not in `shared/pathSafety.ts` because the renderer imports that file and cannot take `node:path`. A scan fails on a fourth hand-rolled `startsWith('..')` anywhere in `src/main`, and `round17Coverage.test.ts` asks the helper.
- **Test.** `captionsSaveSrt.test.ts` and `captionsWriteKitSrt.test.ts`: `...and then-123.srt`, `..intro.srt`, `.. .srt`, `....srt` and a transcript inside a folder called `..old stream` save (and write the kit's captions); a ..-named transcript that is gone says "gone" / "not found", not "outside"; the real traversals still refuse (the folder's parent, a file one level up, a sibling that starts with the folder's name, a climb that comes back down into a ..-named file, a climb written with the separator). `pathConfine.test.ts` holds the rule under posix and win32 (another drive, a UNC share, case-insensitive paths). `moodboard.test.ts`: a `..cover.jpg` thumbnail in the cache is kept and one outside it is still unset. Red-first: every in-folder fixture failed on the old rule - saveSrt threw the "isn't in imagii's captions folder" sentence (`promise rejected ... instead of resolving`), writeKitSrt answered `{ ok: false }` - and every real-traversal pin stayed green on both rules, which is the point of keeping them.
- **Lesson.** **A confinement test needs a name that LOOKS like the attack and is not.** Fixtures spelled with the attack's own characters (`..`) found it at once; a table of genuine climbs cannot tell "starts with two dots" from "is a parent segment". And a pin that copies the expression it guards has stopped guarding it.

### The rest of the sixth pass (one line each)

- **(3) The Clip Kit folder and Record's default name stamped the UTC day.** `makeKitDir` and `recording-${new Date().toISOString()...}` read UTC; the export panel's `{date}` and `{time}` read the clock. An evening Pacific streamer's kit landed in tomorrow's folder and the take was named for the day after it was made. `localDate()`, `localTime()` and `localStamp()` (`shared/filename.ts`) are the one reading now (`recording-2026-10-10T21-23-02`: local, no colon, and no trailing Z that claimed UTC). Unit: `filename.test.ts` (a Date whose local fields and UTC fields name different days, in both directions, and the real clock under `America/Los_Angeles`, `Pacific/Auckland` and `UTC`; the `{date}` token agrees with the helper; a scan fails on any non-test `toISOString()` under `src`), `outputPath.test.ts` (`makeKitDir` at 04:23 UTC on the 11th under `America/Los_Angeles` is `-kit-20261010`). E2E: the kit test and a new Record case run on a clock whose day is never the UTC day (`tests/e2e/skewedClock.ts`: UTC+14 from 10:00 UTC on, UTC-12 before), because a machine in UTC cannot tell the readings apart and the old `kitStamp()` helper was written in UTC. Red-first: the kit E2E waited out its 540 s for a folder named with the UTC day; the unit stamp failed on the evening and the morning case.
- **(4) Record's save-failure toast only stripped the envelope.** `ipcErrorMessage(err, 'Save failed')` showed a copyfile EPERM with both full paths, an ENOSPC from the write stream and `recording:finalize recording is empty` as main wrote them; only the convert crash had a sentence. It is `reportFailure(err, { failed: 'Saving the recording failed.' })` (8 s, `userFacingError`), and main's empty-take refusal is `RECORDING_EMPTY_MESSAGE`, "Nothing was recorded, so there is nothing to save. Start the recording again.". Unit: `userFacingError.test.ts` (the EPERM-shaped and ENOSPC-shaped rejections map to their tier-1 sentences with no path; the empty sentence and the convert crash stand as written; the old channel string falls to the caller's sentence), `recordingStream.test.ts` (the real handler's refusal is the sentence and survives the envelope), `reportFailure.test.ts` (the 8 s lives here once now), the wiring pin in `interactionWiring.test.ts`. E2E: main's `recording:finalize` is replaced with the exact strings Node raises, two takes in a row, and the toasts read the two sentences with no path, errno or channel; and the real handler's refusal crosses the bridge as the sentence. Red-first: the E2E's toast log was `EPERM: operation not permitted, copyfile 'C:\Users\...' -> 'D:\...'`, verbatim.
- **(4b) The last two `ipcErrorMessage` toasts, closed in the same round (the class closes).** Record's source list toasted `ipcErrorMessage(err, 'Could not list screens or windows')` and the Autosave banner spliced `ipcErrorMessage(err, 'unknown reason')` into "Couldn't clear the autosave: <reason>.", so main's string reached the person as written (E2E red-first: `Received string: "Screen recording permission denied"` and `"Couldn't clear the autosave: could not delete autosave.json. It's still on disk — close anything using it and try again."`). Both are `reportFailure(err, { failed })` now ("Couldn't list what can be recorded.", "Couldn't clear the autosave. It's still on disk."), so a known cause is named in plain words (a blocked folder and a full disk for the source list; for the Clear, a locked file and nothing else, since unlink has no full-disk shape; no errno, no path) and the rest stays in the console. **Round 68 corrected this claim:** the Clear could not name a locked file in round 67, because `clearAutosave` swallowed the errno and threw the shapeless "could not delete autosave.json"; it ends in the errno code now (T-118, item 1), and that is when the sentence became true. `failurePathLanguage.test.ts` fails on any renderer call to `ipcErrorMessage` (the finder discriminates), which is what a class closing looks like; the only callers left are inside `userFacingError` and `importDiagnostics`, which do not show their input. The old pins that asserted the raw text (`Screen recording permission denied` twice in `record.spec.ts`, `could not delete autosave.json` in `home-chrome.spec.ts`) were re-pointed on purpose. **Lesson:** when a ticket fixes one member of a class, grep the class (`ipcErrorMessage(` had three renderer callers, not one) and close it in the same round.
- **(5) "any more" is "anymore"** in `SRT_GONE` (its two test pins and three doc quotes moved with it). The comments and test titles that still say "any more" are not copy and no rule reads them.
- **(6) The docs.** The ledger row that quoted the round-65 E2E title is the real title and says what the case does now; the tick-idiom list is exact (thirty sites, not nine and "a handful"; `CropOverlay.tsx:125` is the wave's, not older, and STYLE_GUIDE's own "ticked for" is "checked for" - the guides are the spec); category (5) of the spelling disclosure is nineteen, not eighteen (`record.spec.ts:96` was missing; the borderline `copyConventions.test.ts:519` is a line inside a fixture and is category (1)); and the whole-frame softness claim about `scale` is the measured one in all four places it was made, and in three more the same grep found (`filters.test.ts`' test title, `TESTING.md`, the first sentence of `media.spec.ts`' own comment). Re-measured with the repo's ffmpeg on the T-115 fixture: about half the pixels (48 percent) end up in the mid-gray band strictly between 80 and 175 under `scale=320:240`, only the four corners stay hard, every edge is soft at its middle, the center is a flat 130 (round 68 corrected this sentence, which had said "between black and white" and "the left and top edge stay hard"; see T-118). `filters.ts` names the reframe among the commands that end in their own `scale`.
- **Lesson (the family).** **The second author of a rule copies the example, not the rule.** `startsWith('..')` was copied three times and the id gate was not copied once, each from a case where it happened to be enough. When a guard is added, find its siblings by grep and write the test with the input that differs from the example (a name that looks like the attack, a field the last rationale exempted, a day that is not UTC's).

### Found, not fixed

See the round-67 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-10 — T-116 (round 66): a check true of the thing it was written for and silent about its neighbors

The nine reviewers' fifth pass over the held wave (privacy, audio, streamer and accessibility came back clean; every other finding was LOW - the wave's first pass with no MED). Three code items and the comments and docs around them, and one family: **a check that is right for the case in front of its author and blind to the one beside it.** `\btick` cannot match inside "untick" (a `\b` sits between a non-word and a word character, never between two letters), `focus-within` cannot tell a Tab from a click, and the diff-based spelling sweep cannot read a file that is not in the diff. Each was a fair rule that had never been run against its nearest neighbor.

- **(1) A mouse click left the tile's scrim lit.** Round 65 made the Save and "→ Canvas" overlays `focus-within:opacity-100` so Tab no longer pressed a button drawn at opacity 0. A click focuses a button too, so after Save (or "→ Canvas") the overlay stayed over the picture until focus moved on, long after the pointer had left. It is `has-[:focus-visible]:opacity-100` at both sites (Tailwind 3.4's `has-*`): keyboard focus shows it, a click does not. Sweep rule 4 accepts that spelling and now FAILS on `focus-within` (the stuck spelling); the discrimination block runs both. E2E: the first-save test Tabs from the Search button to Save (it called `focus()` before, which proves nothing about a keyboard), checks 0 at rest / 1 on Tab / 0 after Shift+Tab, and after a real click moves the mouse off and reads 0 with Save still the focused element; the mood-board test presses "→ Canvas" and drags off it before letting go (a click would navigate to Stream Graphics and end the test), reads 0 with the button focused, then Tabs in from Delete and reads 1. Red-first on the `focus-within` build: `a clicked Save lets go when the pointer leaves: Expected "0" / Received "1"`, and the same for "→ Canvas"; the Tab steps before them passed on both builds, so the red is the click alone. Unit red-first: new source against the old rule listed exactly `MoodBoardPanel.tsx:231` and `ReferencePanel.tsx:136`. **Residue, found by a probe and left:** after the first-save dialog closes (a mouse flow), `useFocusTrap` restores focus to Save and `:focus-visible` matches it (the field the dialog had focused was the active element, and a scripted focus move keeps `:focus-visible` from the element it leaves), so that one tile's overlay stays lit until focus moves; measured, `focused=true`, `focus-visible=true`, opacity 1 with the pointer parked away. `focus({ focusVisible: false })` is a Firefox option as far as I know, and a probe in this Electron (Chrome 126) still matched, so there is no cheap way to ask for a quiet restore; the upgrade is restoring focus only when the dialog was opened from the keyboard, which is a change to every dialog.
- **(2) Save .srt said "Couldn't save the captions file." for two causes it could name.** `captions:saveSrt` threw `captions:saveSrt source path outside captions directory` for a transcript outside `<userData>/captions` (a project file may name any safe path) and found a transcript that had gone only AFTER the Save dialog was answered (`copyFile` ENOENT, so a person picked a name for a copy that could not be made, then read "A file imagii needs isn't there"). Both are finished sentences from main now - "That transcript isn't in imagii's captions folder on this computer - transcribe the video again." and "That transcript isn't on this computer anymore - transcribe the video again." ("any more" until round 67) - which `userFacingError` lets stand (tier 2), and the `existsSync` check runs before the dialog, as `writeKitSrt`'s does. The folder gate answers first, so an outside path never reveals whether a file is there; the detail (the path) goes to the console. Unit (`captionsSaveSrt.test.ts`, the real handler on real files, electron faked): both refusals reject with the sentence and the Save dialog is never asked, a path outside the folder is "outside" whether or not a file is there, each sentence survives `userFacingError` through the Electron envelope with no channel name or path in it, and the copy and the canceled dialog still work. E2E: the outside case re-pinned to the sentence, a new "gone" case that also counts how often the dialog is asked (zero). Red-first: unit 5 of 8 failed (`got 'ENOENT: no such file or directory, co...'`); E2E `Received: ["Couldn't save the captions file."]` for outside and `["Couldn't save the captions file. A file imagii needs isn't there. It may have been moved or deleted."]` for gone. The handler still throws where `writeKitSrt` answers `ok: false` (STYLE_GUIDE records it as the exception).
- **(3) "untick" in the recording convert's failure sentence, and the scan that could not see it.** BRANDING: check a box, never tick it. `recordingConvertFailureMessage` said `untick "Convert to MP4 after recording"`, because `copyConventions.test.ts` matched `\btick(ed|ing|s)?\b` (blind to "untick") and read only `src/renderer` (the sentence is written in main). It says "uncheck", the label quoted exactly; the rule is `(un)?tick`; and the two word rules (US spelling, tick) now also read every string literal under `src/main`, `src/shared` and `src/preload` (77 files; two hits when first run, this sentence and the cancel sentinel's value `imagii:cancelled`, which is a protocol id and is exempt by name), with a discrimination block and a guard against an empty scan. Red-first: extending the regex alone turned the new main scan red on exactly `main/ipc/recording.ts:128`; `recordingCancel.test.ts` and the Record E2E now pin the exact `uncheck "Convert to MP4 after recording"`.
- **(4) Seven older comments** spelled "Cancelling" or "unrecognised" (`NameDialog.tsx`, `ClipKitButton.tsx`, `ExportPanel.tsx` twice, `cancel.ts`, `whisperManager.ts`, `watermark.ts`); the ticket called them user-facing strings, and every one is a comment. They are US now. **(5) The diff-based spelling sweep cannot read an untracked file**: `cancelLatch.test.ts` (three titles), `videoExportBatch.test.ts` ("colour") and `transcribeCancel.test.ts` (a comment) held the five it missed. Scan the diff AND `git status --short | grep '^??'`.
- **(6) Four comments that described the stage before it was a crop** (`process.ts`, `muxCodec.test.ts` twice, `filters.ts`' phantom "`/pad`" - no pad stage exists), and `projectValidation.ts` / `projectValidation.test.ts` / STYLE_GUIDE saying Save project "still refuses" an out-of-range overlay size (it clamps, through `validateProject`; Export and Compile run the strict gate).
- **(7) Docs.** Round 65's counts (3344 tests, +43, ten code items), the media total in `TESTING.md` (192 cases, 181 run), and the checkerboard claim, which was measured per row and scoped to none: under the scale row 7 had 70 soft pixels of 320 and a middle of 120-143, row 100 had no black or white pixel at all (it opens 100, 165, 93, 158) and row 233 had 67; reproduced this round with the repo's own ffmpeg (`scale` then `libx264 -preset fast`, then each row decoded), and 0 in all three through the crop. The disclosure line's enumeration is true again and its grep is scoped (`git grep ... ':!package-lock.json'`: the lockfile's `@img/colour` is a package name).
- **Lesson.** **Run a new rule against its nearest neighbor before trusting it.** `untick` was one letter away from the word the rule matched, a click was one event away from the Tab the selector was written for, and a file one `git add` away from the diff the sweep read. The cheap tell is a rule whose red-first run only ever used the example in the ticket.

### Found, not fixed

See the round-66 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-10 — T-115 (round 65): the number that was a guess, and the key that was a rounding

The nine reviewers' fourth pass over the held wave (audio, privacy, ffmpeg and electron came back clean). Ten code items and six docs items, and one family seen from two windows: **an approximation shipped as a convenience, which then stood in for the thing it approximated.** The convert bar was `encoded seconds x 2` because nobody had handed the convert the take's length; the hook badge was keyed on whole seconds because exact numbers respawned ffmpeg, and the rounding became the badge's meaning. Each was a fair answer to the problem in front of it, and each outlived that problem as a number the user read as true.

### Bug (1) — the recording's convert bar read 99% from 50 seconds in

- **Bug.** Stop a 5-minute recording with "Convert to MP4" on. The "Finishing up" card's bar reached 99% about a minute in and sat there for the rest of the convert, beside a Discard button that was enabled the whole time. A person watching a full bar and a button that says "abandon this" had been told the work was done.
- **Root cause.** `convertToMp4` had no idea how long the take was, so it reported `Math.min(99, encodedSeconds * 2)` under a comment that said "1% per second". The recorder knew (`spec.durationMs` reaches `promoteTempWebm`) and never said. T-111 gave the burn-in a measured percent and wrote the rule (a progress number is a measurement or it is absent); the convert was listed as a known gap and stayed one.
- **Fix.** `convertToMp4(owner, in, out, onProgress, durationSec?)`: the percent is ffmpeg's `out_time` over `durationSec`, through `burnInPercent` (one mapping for every encode bar, 0-99), and a progress event with no usable length carries NO `percent`. `promoteTempWebm` passes `spec.durationMs / 1000` (none for 0 or absent). Record's bar became `savePercent: number | null`: an event without a percent is `null` and draws the sliding segment (no `aria-valuenow`), as the captions panel does. `burnInPercent` also refuses a non-finite length (`10 / Infinity` was a confident 0%). `convertForImport` passes nothing and keeps working; the wrong comment is deleted.
- **Test.** Unit (`convertCancel.test.ts`, fake child, ffmpeg's real `-progress` text): 25 / 50 / 75 of 10 s, a 5-minute take at 50 s is 16.7% (not 99), hours and minutes, 0 and the 99 cap, and five lengths that are not a length (none, 0, negative, NaN, Infinity) each reporting without a percent; `recordingCancel.test.ts` (the handler hands the convert 8 for `durationMs: 8000`, nothing for 0 or absent, and forwards progress as it came). Layer 5 ("the convert reports a measured progress, or none"): the real binary on a 6 s webm - the right length ends at 90-99, twice the length at 45-52 (it is a measurement, not a guess), a tiny length pins at 99, no length ticks with no percent; red-first against the old formula (`[11.84]`, which is `2 x 5.92 s`). E2E ("the convert bar draws what main reports"): `finalize` is held open and the real progress channel is driven - 0 before anything, 40 as 40, `{}` as the sliding bar with no number, then 99 as a number again; red on the old build (`aria-valuenow="NaN"`). The existing job-scoped cancellation case counted `p.percent > 0` to know both encodes were running; it counts ticks now (the importer has no length to measure against).
- **Lesson.** **A known gap that a rule names is still a gap.** The rule ("a number is a measurement or it is absent") was written in round 61 with the convert listed as the exception, and the exception lasted four rounds because the measurement was one argument away. When a rule has an exception list, the list is the next ticket. And the cheap tell: a comment that explains a number in terms of "so the UI knows something is happening" is describing a number whose job is to move, not to be true.

### Bug (5) — the hook badge could describe a start up to half a second away, for good

- **Bug.** Drag the start handle to 12.4 s and let go: the badge describes the window that began at 12.0 s. Drag it to 12.6: 13.0. The badge is a loudness tier for the first three seconds of the clip, and the clip the person trimmed is not the clip it rated.
- **Root cause.** T-113 and T-114 stopped the badge respawning ffmpeg on every mousemove and every 0.05 speed tick by keying its effect on `hookWindowKey`: the window and the start rounded to whole seconds. That bounded the asks, and it made the rounding the badge's meaning - while the key held, nothing re-asked, so the stale answer was permanent until the next whole second. The staleness ceiling was written in the code ("the upgrade, if a tier ever flips on one, is a debounce on the exact numbers") and carried in the ledger as a known gap.
- **Fix.** `HookIndicator` runs its effect on the EXACT `startSec` and window and waits `HOOK_DEBOUNCE_MS` (250 ms) before it asks; every change clears the pending timer and ignores the late answer (the cleanup), so a drag is one ask when it settles, for the numbers it settled on. A badge's FIRST ask is immediate (`asked` ref): the first cut waited on mount too, and the full Playwright run showed what that moves - three spawn-order cases that read the log assuming the hook's own ffmpeg had already run (a stall meant for the export landed on the badge's analysis: `Expected: 1 / Received: 2`; a stray `ffmpeg` in a log asserted empty; a baseline taken before the badge's spawn) - so the badge keeps its old timing at mount, those three cases also wait for the badge to settle before they read a log, and the title case finds the badge by what only the badge says (the spinner's title also says "first 2 seconds"). `hookWindowKey` is deleted. `hookAsk(start, window)` (shared) is the one gate for what is asked: the numbers untouched, or `null` for a start that is NaN / infinite / negative and a window outside main's 0.5-30 s (no ask, no badge, instead of an ask main refuses and the badge swallows). Kept: the previous score stays on screen while the next is worked out, the sub-0.5 s no-row rule (`hookWindow`), a per-clip badge. The three comments that said "half a second" are corrected or gone.
- **Test.** Unit (`highlights.test.ts`): `hookAsk` returns exactly what it was given (12.37 / 3.45, never rounded), refuses each unusable start and window, takes the gate's bounds inclusively, accepts every window `hookWindow` can produce; `HOOK_DEBOUNCE_MS` is 250 and lives between 100 and 500; wiring (`interactionWiring.test.ts`): the deps are the exact numbers, the ask is inside the timer, the cleanup clears it, the old score is not cleared. E2E (both hook cases re-pinned, intent kept): three speed ticks in a row are ONE ask for the last window (3.45), and the next settled value one more (3.6); a four-move start drag is ONE ask whose `startSec` matches where the handle stopped to within 0.06 s (not the whole second it rounds to), the old badge staying up with no spinner while a held answer is pending, then replaced by the new one; red on the old build (`Expected: 3 / Received: 2`: no ask at all inside the same whole second). Five consecutive runs of each timing case were green.
- **Lesson.** **A rounding that bounds a cost also bounds the truth.** Keying on a coarser value is the fastest way to stop a respawn, and it quietly changes what the output means. The debounce does the same job without touching the numbers, and it was named in the code as the upgrade a round earlier - a ceiling written as a comment is a ticket. When the fix for "too often" is "less precisely", ask what the consumer of the precision was.

### The rest of the fourth pass (one line each)

- **(2) Two failure toasts vanished in 4 s**: Record's "the take is gone" (`ipcErrorMessage(err, 'Save failed')`) and the Autosave banner's "couldn't clear it" pass `{ duration: ERROR_TOAST_MS }` like `reportFailure`. A table-driven AST pin lists the three toasts that must last (the third was already right) and proves its finder discriminates; red on the two.
- **(3) Tab reached a button drawn at opacity 0**: the Save (reference tile) and "→ Canvas" (mood-board tile) overlays gain `focus-within:opacity-100` (round 66 replaced that spelling with `has-[:focus-visible]:opacity-100`, because a mouse click matched it too: see T-116). Sweep rule 4 (a hover-only container holding a button, link or field must show on focus; red on exactly those two sites, with a discrimination block) and two E2E assertions (mouse parked: opacity 0 at rest, 1 on focus, 0 after blur; Enter on the focused button does the whole job).
- **(4) The image Export format select had no name**: `aria-label="Export format"`; three E2E locators found it as "the first combobox" and now use the name (red: not found by name).
- **(6) `EVEN_PICTURE` is a crop**: `scale=trunc(iw/2)*2:trunc(ih/2)*2` resampled a 321-wide window capture to lose one pixel (hard in the four corners and soft along every edge's middle and through the center - the text the stage exists to serve; round 67 re-measured the whole frame: about half the pixels, 48 percent, in the mid-gray band strictly between 80 and 175, and a flat gray center, and round 68 corrected that line, which had said "between black and white" and "hard at the left and top edge"; this entry said "every pixel" until round 67); `crop=` trims one pixel at the right and bottom and nothing else. Layer 5, a lossless 1-pixel checkerboard through `convertToMp4`: before, row 7 had 70 pixels in the soft band and a middle of 120-143; after, none, and an even-sized control proves the encoder does not soften it (note for the next author: `crop` rounds a yuv420p size to even BY ITSELF unless `exact=1`, so the odd fixture has to be made with `exact=1`). The nine odd-size cases stay green. Two "not a rescale" comments now say what is true.
- **(7) A legacy size outside 8-512 refused the whole restore**: the old editor had no upper clamp (same family as the name `white`). `migrateLegacyOverlays` (renamed from `migrateNamedOverlayColors`: it migrates colors AND sizes) clamps a FINITE number and leaves anything else to the gate; verbatim legacy JSON with `"sizePx": 800` restores at 512 (red: refused), the injection pins unchanged, `isValidTextOverlay` still strict. The old pin "rejects an out-of-range sizePx" through `validateProject` was re-pointed on purpose (it is the clamp now); the same assertion on the gate is untouched.
- **(8) The overlay x / y boxes** are "Overlay horizontal position (0 to 1)" and "Overlay vertical position (0 to 1)" (they were "x" and "y"). **(9) The square clip card** says "do not export", not "never" (retyping a hint exports it).
- **(10)-(15) Docs and comments**: UK spellings the wave added (the four named lines plus the assertion message, and then the ones a diff scan found: comments and unquoted test strings in `media.spec.ts`, `filters.test.ts`, `captions.test.ts`, `designTokensInSync.test.ts`, `whisperManager.test.ts`, `videoCropPayload.test.ts`, and my own new comments - the stage that fixes spelling should be checked by the same scan); the disclosure line's count, measured this time (see the round-65 section of `INTERACTION_COVERAGE.md`); the two "crossfade" ledger rows; STYLE_GUIDE's confined-read exception for `captions:writeKitSrt`; DESIGN_GUIDE's toggle sentence narrowed to state-named toggles with action-named ones (Play / Pause, Lock / Unlock layer) blessed; the `overlayColors.ts` comment that named the wrong test file; the T-113 kit row that still said `Mid.srt`.
- **(16) "Save .srt" did nothing, visibly, when its transcript was outside the captions folder**: `CaptionsPanel.saveSrt` awaited `captions:saveSrt` with no `try` (main throws for any source outside `<userData>/captions`, and a project file may name one), so the rejection was unhandled and the click showed nothing. It is `try` / `reportFailure` with "Couldn't save the captions file."; E2E seeds a transcript outside the folder and reads the toast, no file, no `pageerror` (red: the toast log was empty); `failurePathLanguage.test.ts` pins the shape by name and says in its header that it reads only `catch` clauses - about 47 awaited `window.api.*` calls sit outside a `try`, nearly all pickers and settings writes, so the blanket scan waits for a second site. The handler was unchanged in round 65 (it still throws where `writeKitSrt` answers `ok: false`); round 66 gave both of its throws a finished sentence and moved the missing-file check ahead of the Save dialog (T-116).

### Found, not fixed

See the round-65 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-10 — T-114 (round 64): the fix that stopped at the surface its author pictured

The nine reviewers' third pass over the held wave. Twenty-three items, and one family seen from many windows: **a rule applied to the surface its author had in front of them, and not to its siblings.** The even-size stage went onto one of four libx264 commands; `assertAlways` went onto the IPC handlers and not onto the two runners that stand between a value and a command line; the selected-state rule saw one of four ways the app marks a selection; the overlay color was normalized where it is STORED and not where an older build's value is READ. The two that were not about siblings were a control that stored a choice and ignored it (the Font box) and a hint put inside the label it was a hint for. **IMG-PREC triggered three times**: the even stage reached three more ffmpeg commands (Layer 5, nine cases), the two-pass loudness render met silence (Layer 5, three cases) and the overlay font changed a filter graph (a win32 pair, run here against a stand-in; below). Every behavior change was red-first against the tree as it stood, and every new guard was shown to discriminate: broken, the exact red named, restored by content replace (sha256 before and after in the brackets; the two are equal every time).

### Bug (1) — the even-size stage went onto one libx264 command of four, and the three that were left died at exit 187 (one of them deleted the take)

- **Bug.** A 321x241 VP9 webm (a screen recording) converted to MP4 died with `width not divisible by 2 ... Could not open encoder before EOF` (exit 187). So did the caption burn-in of the same picture, with a subtitle stage and without one, and the picture-in-picture composite over it. The recording's convert was the worst: `recording.ts` unlinks the temp webm in the `finally` of `promoteTempWebm`, so a failed convert DELETED THE TAKE.
- **Root cause.** T-113 evened the re-attach's re-encode (`EVEN_PICTURE`, a constant local to `audio/process.ts`) and the ticket named that command only. `convertToMp4`, `runBurnIn` and `compositePip` are the same shape (`libx264`, `yuv420p`, a picture they did not make) and each took a source's odd edge straight to the encoder. Nothing had a way to ask "which commands encode a source?": a platform export and a compilation segment end in a `scale` to an even preset size, the reframe crops to an even box, and the other four did nothing.
- **Fix.** The stage moved to `ffmpeg/filters.ts` (`EVEN_PICTURE`, exported; a leaf of pure builders that `concat.ts` already imports, so `convert.ts` and `whisperManager.ts` need not import the audio runner) and heads the `-vf` of the convert (`-vf` added), the burn-in (always: with a subtitle stage the chain is `EVEN_PICTURE,subtitles=...:force_style='...'`, joined by one comma outside the quotes; with no subtitle stage - a window with no cue in it - it is the whole chain, where there was no `-vf` at all) and the PiP (`[0:v]EVEN_PICTURE[base];[1:v]scale=W:-1[ov];[base][ov]overlay=...`). An even picture passes through it untouched.
- **Test.** Layer 5, "an odd-sized picture through every other libx264 command": a flat-gray 321x241 VP9 webm (the odd size is `scale`d after the source and `ffprobe`d before it is used) through `convertToMp4` and through `convertForImport`, `runBurnIn` with a cue (the text is painted in the bottom band: luma spread over 100, the top band flat) and with none, and `runPipComposite` (the overlay's green at its center, the base's gray at the far corner); each output is 320x240 h264 yuv420p and decodes with nothing on stderr; an even-sized control beside each. Unit: `convertCancel.test.ts` (the convert's `-vf` is the stage and comes before the encoder), `captionsProgress.test.ts` (the no-cue burn's whole chain is the stage; the subtitle chain starts `stage,subtitles=` and has exactly one comma outside the quoted style), `filters.test.ts` (the literal, once). **Red-first** (the tree as it stood): `5 failed | 4 passed`, every red `exit 187` (`ConvertFailedError: convert-to-mp4 exit 187`, `burn-in exit 187`, `pip exit 187`), the even controls green. **Mutations:** `convert.ts` [`a55c91e1dea8`] the stage removed: the unit pin (`Received: "-y"`) and 2 Layer 5 reds; `whisperManager.ts` [`65f7f5505d56`] `subtitles=` without the stage in front: the Layer 5 burn (exit 187) and the unit pin; the no-cue chain back to a no-op: the Layer 5 no-cue case (exit 187); `concat.ts` [`184a8eb1ae2e`] `[0:v]null[base]`: the Layer 5 PiP (exit 187); `process.ts` [`5f5aee1fd525`] the re-attach's stage removed (T-113's pin, after the move): 5 `muxCodec` reds.
- **Deviation, owned.** The ticket said "export it from where it lives"; it lives in `filters.ts` now, not in `audio/process.ts`. The audio runner is the wrong thing for a convert or a caption job to import, and `filters.ts` is where the stage's neighbor `even()` already is.
- **Lesson.** **A fix for one command is a fix for a class only when someone has listed the class.** `grep libx264 src/main` is a five-line audit; it had not been run, so the same bug was three more bugs, the worst of which erased a recording. When a rule is "every X does Y", write the list of X in the test, not in the ticket.

### Bug (2) — an autosave from before T-113 could not be restored: its overlay color was the NAME "white"

- **Bug.** T-113 made the overlay editor store `#ffffff`; before it, the default was the name `white`. An autosave (or a saved project) written by that build holds `"colorHex": "white"`, which the hex-only gate refuses, so `validateProjectJsonString` returned `ok: false` and the launch banner offered a damaged-autosave Clear instead of the person's session.
- **Root cause.** T-113 normalized the value where it is STORED and kept the gates hex-only (correct: the color is printed into `drawtext`, and `white,movie=...` is how a crafted project injects a filter). It did not ask about values already written by the old store. The restore path reads exactly the files the old build wrote.
- **Fix.** `validateProject` runs `migrateNamedOverlayColors` over each clip before the overlay check: a `colorHex` that fails the hex gate and IS a CSS name becomes the table's hex (`resolveOverlayColor`; the value written is the TABLE's, never the typed string). Anything else - an injection string, an unknown word, a non-string, `constructor` - is left exactly as it was and the gate refuses it, so the injection pin does not move. The table and the resolver moved to a leaf module, `shared/overlayColors.ts`, because `textOverlay.ts` already imports the size bounds from `projectValidation.ts` (a cycle); `textOverlay.ts` keeps the refusal sentence. `#rgb` shorthand expands there too (item 15), before the table and the hex check; the gates stay six-digit.
- **Test.** `projectValidation.test.ts` ("a legacy project holding a NAMED overlay color is migrated"): a verbatim schema-5 JSON string as that build wrote it with `"colorHex": "white"` restores `ok` with `#ffffff` and every other field untouched; `Gold`, `  RED `, `rebeccapurple` and `grey` migrate; a hex is left byte for byte (`#FFCC00`, `AABBCC`); a filter-injection string, the `ametadata` string, a quote that would close the option, an unknown name, `constructor` and the empty string still refuse (`textOverlays[0] malformed`); a number is not coerced; `isValidTextOverlay('white')` is still `false`. `autosave.test.ts`: the real `readAutosave` on a legacy file on disk restores and `getAutosaveInfo` reports a real `savedAt` (no corruption banner). **Red-first:** 6 reds, the first `{"ok":false,"reason":"videoStudio.clips[0].textOverlays[0] malformed"}: expected false to be true`. **Mutations:** `projectValidation.ts` [`50dd37caaa7b`] the migration call removed: 6 reds plus the autosave read; `overlayColors.ts` [`2be30558596a`] `hasOwnProperty` -> `in`: `constructor: expected [Function Object] to be null`; the shorthand disabled / expanded to the wrong digits (`expected '#f00f00' to be '#ff0000'`).
- **Lesson.** **A gate that gets stricter has to say what happens to what the loosest earlier version wrote.** T-113 closed the door for new writes and left the old writes in the house. The migration belongs in the one function every reader passes through, before the check, and the thing it must never do is widen the check.

### Bug (6) — the Font dropdown was a dead control: six fonts stored, saved, and ignored

- **Bug.** The editor offered Arial, Impact, Verdana, Georgia, Courier New and Comic Sans MS. A streamer who picked Impact for a title got Arial, with no sign anything was wrong.
- **Root cause.** `drawTextFilter` printed `fontfile='C\:/Windows/Fonts/arial.ttf'` as a constant and never read `overlay.font`. The ledger counted "font" among the covered fields because the E2E set it and read the value back from the store - the end state of a font is a picture, and no test looked at one.
- **Fix.** `OVERLAY_FONTS` (`@shared/textOverlay`, the editor's list, in its order) and a literal table in `filters.ts` keyed by that union (`OVERLAY_FONT_FILES`: `arial.ttf`, `impact.ttf`, `verdana.ttf`, `georgia.ttf`, `cour.ttf`, `comic.ttf`), so a font added to the list without a file fails the typecheck. `overlayFontPath` looks the stored value up as an own key; a name that is not one (an older project, a hand-edited one, `constructor`, a string built to break out of `fontfile='...'`) is Arial, and the stored string is never interpolated. The watermark keeps `arialbd.ttf`.
- **Test.** Unit (`filters.test.ts`): the command text for each of the six; six fonts, six different files, in the editor's order; thirteen shapes (unknown, absent, `null`, empty, a number, wrong case, trailing space, `constructor`, `__proto__`, a file name, a path, an option break-out, a filter injection) all print Arial and the stored string is nowhere in the graph. Layer 5, win32-gated like its T-51 neighbors: every offered font exists on the machine and exports and paints, and a line of ten i's is as wide in Courier New as it is NOT in Arial (a monospaced `i` is about 2.7x), while an unknown font, an empty one and a hostile string are EXACTLY Arial's width. The win32 pair ran here against a stand-in, the way TESTING.md describes (system ffmpeg 6.1.1, `process.platform` set to win32, a working directory holding `C:/Windows/Fonts/` with the six names symlinked to six different DejaVu faces); the real Windows file names are the standard ones and could not be checked on this box - the first assertion of the gated pair checks them on the release run. **Red-first** (real `drawtext`, the old filter): `Courier New is a different face: 126 px against Arial's 126 px for the same text: expected 126 to be greater than 201.6`. **Mutations** (`filters.ts` [`11754bb15e8e`]): the font ignored again: 6 reds (`expected 'C\:/Windows/Fonts/arial.ttf' to be 'C\:/Windows/Fonts/impact.ttf'`); an unknown font interpolated: 13 reds; `hasOwnProperty` -> `in`: 2 reds (`function Object() { [native code] }` in the filename).
- **Lesson.** **A control's end state is the thing the control is FOR.** Reading a select back from the store proves the select works; it says nothing about whether the font reaches a picture. When the coverage for a field is "I changed it and it changed", ask where the changed value goes next and put the assertion there.

### The rest of the third pass (one line each)

- **(3) Soft asserts at two trust boundaries**: `runAudioReattach`'s guard before an UNCONDITIONAL `unlink` (as `assert()` it logged and continued under `NODE_ENV=production`, and the `finally` deleted the user's source - shown by execution: the job ran to its end) and `hexToAssColor` (the only check on a burn style's colors) are `assertAlways`; `captions:burnIn` refuses a non-`#RRGGBB` `primaryColor` / `outlineColor` at the gate in one plain sentence ("A caption color has a setting imagii can't use ..."), the detail to the console. `validators.test.ts`'s scan covers every non-test file under `src/main` (it read `src/main/ipc` only) with `AUDITED_PURE_INVARIANTS`: seventeen asserts in six files, each read against its caller (the IPC handler or the protocol handler has already refused) and keyed by file and message, with a stale-entry check. New tests: `reattachCollision.test.ts` (real files, forced production), `captionsBurnIn.test.ts`, `captionsProgress.test.ts`. **Red-first:** 11 + 3 reds, `promise resolved ... instead of rejecting` on the soft guard (and `audio/process.ts: \`intermediate audio path ... would overwrite a file this job reads\`` named by the scan). Mutations: `process.ts` [`5f5aee1fd525`], `whisperManager.ts` [`b901ef8e5b63`], `captions.ts` [`8a7916ef9486`], `protocol.ts` [`6b7044405b22`] (a converted audited assert -> the stale-entry red).
- **(4) A silent input exported nothing under "Match loudness"**: pass 1 over silence prints `input_i: "-inf"` and `target_offset: "inf"`; pass 2 hands them back and ffmpeg refuses `measured_I=-inf` (`out of range [-99 - 0]`, exit 222). `parseLoudnormJson` returns `null` for a field that is not a plain finite decimal, and the existing fallback (`exportAudio` renders pass 2 without a measurement: the single-pass dynamic loudnorm) takes over - pinned in `silentLoudnorm.test.ts`. Layer 5 (an `anullsrc` input; the fixture is checked to print `-inf` first): red `FFmpeg exit 222`, green exports a 4 s file that is still silence. `chain.ts` [`3cc0c5a3ef8d`].
- **(5) The kit's SRT was named by the bare clip name**: a clip called Aux, Con, COM1 or lpt9 wrote five videos and three thumbnails and then failed the whole kit at the path gate (`Aux.srt` is a Windows device). `kitSrtFilename` -> `<name>_captions.srt` and `kitThumbFilename`, like the queue's `<name>_<platform>.mp4`; `clipKit.test.ts` builds all nine file names for eight device-like clip names and checks each against `isSafeAbsolutePath`, with the bare name as the control that the gate DOES refuse. `clipKit.ts` [`05f0498ea3b5`].
- **(7) The hook row ignored "no sound"** (the T-113 consolidation gated three panels and left this one): `ClipList` adds `!videoHasNoSound(source)`; the no-sound E2E asserts no `First N s:`, no spinner, no badge (red `Expected: 0 / Received: 1`). `ClipList.tsx` [`e3d55bb29d48`].
- **(8) A start-handle drag respawned ffmpeg per mousemove and flashed the badge**: `hookWindowKey(window, start)` is `"<whole-second window>@<whole-second start>"` (staleness ceiling documented: up to half a second), the exact numbers are read from refs at the moment the key changes, the previous score stays up while the next is worked out, and `ClipList` keys the badge by clip so another clip starts fresh. E2E red-first: six analyses where two were allowed (`startSec` 0.099, 0.198, 0.297, 0.397). `highlights.ts` [`cfb4b46466b6`], `HookIndicator.tsx` [`65f061bec3a7`].
- **(9) The autosave Restore promised a project that does not exist**: `describeApplyOutcome(outcome, 'project' | 'autosave')`; for an autosave the skip sentence says the autosave now holds what is open, so the skipped part will not come back from it. Five unit reds; the two call sites are pinned. `AutosaveRestore.tsx` [`4dec6617db62`], `ProjectIO.ts` [`3b2660148fc9`].
- **(10) Selected-state class, closed**: `aria-pressed` on the Record source cards; the layer rows and the board rows have a real button for the name (the keyboard route; the board's fills its row, the layer's is ~50 px in a 234 px panel, so the layer row also keeps its own `onClick` - the first version dropped it and three image E2Es that click the row's middle stopped selecting, which the full Playwright run caught) with `aria-current` on the row and the button; the eye toggle is `aria-pressed` with a constant name "Layer visible" and a title that names the action; `a11ySweep.test.ts` rule 1 matches `border-accent`, `ring-accent` and `bg-accent/NN` too, on a `button` or anything with an `onClick` (it flagged exactly `LayerPanel.tsx:58`, `RecordStudio.tsx:608`, `MoodBoardPanel.tsx:133` before the fix, and the drop zones lit by `dragOver` are not it). E2E: a layer and a board selected by Enter and by Space. One mutation was not caught the first time (the board row's `aria-current` on the `<li>`: the pin's pattern also matched the button's copy) - the pin is `<li key aria-current` now.
- **(11) The safe-zone dialog opened on its scrollable list**: `useFocusTrap` honors `[data-initial-focus]`; the dialog's Cancel carries it (E2E: no `.focus()` call, initial focus on Cancel, Shift+Tab reaches the list). **(12)** the transcript scroller is `role="region"`. **(13)** the export queue's bar is a named `progressbar` ("Clip 1 · YouTube", valuenow). **(14)** the overlay's x and y boxes are named and the color box is `aria-describedby` its alert. **(15)** `#rgb` expands. **(16)** the GIF panel's empty live region cost a phantom 12 px gap (measured 24 px from the header to the controls where one gap is 12): `-mb-3` while it is empty, nothing hidden - it stays in the accessibility tree. **(17)** the loudness range hint is beside the checkbox's label, not in its name, as "(−70 to −5)". **(18)** the square clip card says the well and its label never export and only the sample title is retyped.
- **(19)-(23) Docs and comments**: UK spellings in the lines the wave added, the stale round-62 ledger row for "Close this audio?", STYLE_GUIDE's contradictory throw-vs-`ok: false` bullets (a payload refusal throws; an outcome that is not a fault returns `ok: false`), the templateTruth comment that counted ten items as nine (the four frames, the lower-third, the three scene cards and the square card are nine), and the crossfade stragglers.

### Found, not fixed

See the round-64 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-10 — T-113 (round 63): the default overlay that could not be exported, the kit's captions on the wrong clock, a flake with two causes, and validators that fail open

The nine reviewers' second pass over the held wave. Nineteen findings, three families seen from many windows. **A name the product invites that the gate behind it refuses** (the editor's own default "white" and its placeholder "white or #ffcc00" against a hex-only overlay gate; a Size box that offered 400 against a gate that takes 512; an `assert` that said "refuse" and meant "warn"). **A value copied from the world the work began in** (a whole recording's SRT on the recording's clock beside a clip that starts at 0:00; a sound's staleness baseline taken after the video's wait; a playhead aimed at whichever video happened to be open). **A rule that held in the case its author pictured** (a "named flake" whose named cause was real and whose failing line was another one). **IMG-PREC triggered twice**: the even-dimension scale is a change to an ffmpeg command (Layer 5, three cases) and the kit's captions need a real file to prove their clock (Layer 5, two cases, below). Every behavior change was red-first against the tree as it stood, and every new guard was shown to discriminate: broken, the exact red named, restored by content replace (sha256 before and after in the brackets; the two are equal every time).

### Bug (1) — "+ Add text" made an overlay that Export, Compile, Save project and a project's restore all refused

- **Bug.** Click "+ Add text" and press Export: "One of this project's clips has a setting imagii can't use — check its speed, color and text, then try again." Compile said "Compilation failed.", Save project threw, and an autosave holding the overlay failed its own restore. The person had touched nothing.
- **Root cause.** `TextOverlayEditor` created the overlay with `colorHex: 'white'` and its Color box said `white or #ffcc00`; `isValidTextOverlay` (the gate behind all four) takes `#?RRGGBB` and nothing else, on purpose — the color is printed into `drawtext`, so `white,movie=...` is how a crafted project injects a filter. Nobody had ever pressed Export on a default overlay: the E2E typed `#ffcc00` into the box first. The Size box had the same shape (max 400 in the editor, 512 in the gate, and `Math.max(8, ...)` on every keystroke, which turns a typed "72" into "82").
- **Fix.** At the store boundary, not the gates. `@shared/textOverlay`: a literal table of the 148 CSS color names (no dependency), `resolveOverlayColor`, `clampOverlaySize`, `newTextOverlay` (the default, `#ffffff`, in shared so the renderer holds no hex) and `normalizeOverlayPatch`; `videoStore.addTextOverlay` / `updateTextOverlay` run every write through it (a name becomes its hex, a size is clamped to 8-512, a color that is neither is left out of the patch so the stored one stays). The editor's Color and Size boxes are `DraftField`s: what is typed stays in the box until typing ends (blur or Enter; a size already inside the range goes straight in), so "blue" on its way to "blueviolet" is never judged, and an unknown name is refused in a sentence in the editor — "imagii doesn't know that color. Use a name like white or a code like #ffcc00." — not at export. The gates stay hex-only; `isValidTextOverlay({ colorHex: 'red' })` is still `false` (its pin is untouched).
- **Test.** `textOverlay.test.ts` (the table: 148 entries, every value a gate-valid hex; names in any case; hex with and without `#`; `constructor`, `__proto__` and a filter-injection string refused; the clamp; the default passes the gate); `videoStore.test.ts` (the default passes every gate that reads it; a name handed to either action is stored as hex; an unreadable color leaves the stored one and still lands the rest of the patch; a size is clamped; every state the store can hold passes the gate); `ProjectIO.test.ts` (a project holding the default overlay saves, autosaves, restores, and a typed `Red` and `9999` come back as `#ff0000` and `512`); `videoCropPayload.test.ts` (a Compile segment carrying the default overlay compiles); E2E in `video-pipelines.spec.ts` ("the text overlay "+ Add text" stores, untouched, is one the exporter takes": on win32 the file exports, on linux the job dies at `No such filter: 'drawtext'` — the platform pin — and that it dies THERE and not at the gate is the proof) and in `video-core.spec.ts` (the Color box turns `Gold` into `#ffd700`, shows the sentence for `notacolor` with the text kept, takes it away on retyping; `9999` becomes `512`, `3` becomes `8`, and typing `72` key by key stays `72`). **Red-first:** unit, five reds on the old store ("expected 'white' to be '#ffffff'", "expected 'Gold' to be '#ffd700'", "expected 'notacolor' to be '#ffffff'", "expected 5000 to be 512", and `{"sizePx":-9,"colorHex":"nonsense",...}: expected false to be true`) and `expected { ok: false, …(1) } to match object { ok: true }` on the project round trip; E2E on the old behavior (the default and the store's normalization put back) `Expected: "#ffffff" / Received: "white"` and, with that assertion skipped, `Received: ["Video loaded", "One of this project's clips has a setting imagii can't use — check its speed, color and text, then try again."]` where `Export failed.` was expected. **Mutations:** `videoStore.ts` [`73f51994746b`] `updateTextOverlay` without the normalization: 4 reds; `textOverlay.ts` [`11c30aed9564`] `hasOwnProperty` guard -> a bare index: 1 red ("never lets an inherited property pass for a color name"); the clamp's ceiling removed: 5 reds; `TextOverlayEditor.tsx` [`e8cfb1de1a54`] the refusal returning `null`: the video-core E2E, `waiting for ... getByRole('alert')`. All restored byte for byte.
- **Lesson.** **A default is an input the product sends itself, and nothing tested it because every test supplied its own.** The editor's placeholder, its default and its gate were three claims about one field, written in three places and exercised by no test that did not first overwrite the field. The fix for "the gate and the editor disagree" is not to loosen the gate (it exists to refuse strings like the placeholder's) but to put ONE normalization where the value is stored, so every writer — the editor, a future preset, a paste — is covered by it, and to test the thing a person does first: press the button and use the result.

### Bug (9) — the Clip Kit's captions were the whole recording's, on the recording's clock

- **Bug.** A kit made from the minute-40 clip of a stream came with an `.srt` that began at minute 40's earlier speech and ran to the end of the recording, beside five videos that start at 0:00 and run a minute. No cue matched what was said, in any player. A clip at 2x was off by another factor of two on top.
- **Root cause.** The bundle was `captions:copySrtTo`: a `copyFile` of the transcript (the channel is `captions:writeKitSrt` now; it copies nothing). The transcript is of the whole recording on the source clock; the kit's files are one clip, cut at `-ss`, played at `setpts=PTS/speed`. `shiftSrtToRange` (the burn-in's conversion, T-81) had been written for exactly this clock change and the kit never called it. The coverage ledger said "`copySrtTo` not exercised (needs srtPath + a kit in one session)" since the kit shipped — the route to a session with both was a project file that carries a transcript path.
- **Fix.** The IPC takes the clip: `{ srtPath, dest, startSec, endSec, speed }` (validated at the boundary: a real range and a speed in 0.1-10). Main reads the transcript and writes `shiftSrtToRange(srt, startSec, endSec, speed)` — shifted by -startSec, cut to the range, THEN divided by the speed (so a cue never outlives the clip; whole milliseconds, no drift); a clip nobody speaks in gets no file and the answer says `written: false` (the toast: "Saved your Clip Kit (no captions fall inside this clip)"). The renderer builds the request with `buildKitSrtRequest` (`clipSpeed`, so a stored 0 is 1x). A whole-file clip at 1x writes the same cues it always did.
- **Test.** `captionsWriteKitSrt.test.ts` (the REAL `captions:writeKitSrt` handler on REAL files: a mid-stream clip's first cue near 30 s and not at 210 s; 2x halves, 0.5x doubles; a whole-file clip at 1x is every cue as it was; a half-inside cue is cut at the edge; an empty clip writes nothing; the transcript untouched; confinement, a traversal destination, nine malformed ranges and speeds refused before a byte is read); `captions.test.ts` (`shiftSrtToRange` with a speed: divide after the cut, 1x identical, thirds don't drift); `clipKit.test.ts` (`buildKitSrtRequest`); Layer 5 ("the Clip Kit's captions are on the clock of the kit's own file": the REAL export the kit's job describes of `rampSrc` — whose loud burst is at 10.0-11.5 s of its source — at 2x, 0.5x and 1x, the shifted cue measured against the loudness of the file at that moment: -22 dB during the cue, -56 dB 0.6 s before it, and the old copy's 10 s beyond a 3-second file); E2E ("the kit's captions are on the clip's clock": a project whose transcript sits in the app's captions folder, a clip 0.5-2.0 s at 2x, the kit's `Mid.srt` is exactly `00:00:00,050 --> 00:00:00,250 / 00:00:00,350 --> 00:00:00,700` and the video is 0.75 s; and "a clip nobody speaks in gets no .srt"). **Red-first:** the new handler test on the old `copyFile` handler, 18 reds ("expected 30 to be close to 15", "expected 'minute 0 line' to be 'minute 4 line'" — the whole transcript, from minute 0); E2E with the handler's range replaced by 0..1e9 (the source clock): `Expected: ArrayContaining [StringContaining "Saved your Clip Kit (no captions fall inside this clip)"] / Received: ["Saved your Clip Kit"]`; Layer 5 with the division by speed removed `expected 2 to be close to 1, received difference is 1`. **Mutations:** `captions.ts` (main) [`e1966e38f1ac`] range ignored: both kit E2Es; `captions.ts` (shared) [`e5dec1f2b1e7`] `/ 1` for `/ speed`: both Layer 5 cases.
- **Lesson.** **A value that crosses from the world a thing was made in to the world it is used in needs a function whose name says which clock it is on, and a test that measures the result against the thing it describes.** The burn-in learned this in T-81; the kit had the same transcript, the same clip and no test that put a cue next to a sound. The strongest assertion here is not a number in a file: it is "the file is loud where the cue says someone is talking".

### Bug (10) — the named flake had two causes; the one that was named was real, and the one that failed was the other

- **Bug.** `npx vitest run` went red about one run in six, on `extract.test.ts` "holds several at once and clears each on its own" (a 5 s timeout), and not on a re-run.
- **Root cause.** (a) The named one: `extract.test.ts` and `transcribeCancel.test.ts` run the real extractor, which writes `tmpdir()/imagii-audio`, and `tempCleanup.test.ts` removes that exact folder recursively in `beforeEach`/`afterEach` and asserts exact counts — vitest runs files in parallel, so one file's WAV could vanish or be counted under another's feet. (b) The one that failed: the test starts two extractions, each of which `await`s its `mkdir` before it spawns, and then closed `spawned[0]` as "A's child". Two concurrent mkdirs finish in either order; when B's child was `spawned[0]`, closing it settled B, left `await a` waiting for a child nothing would close, and the case timed out. It had been written with the order the author saw, on an idle machine.
- **Fix.** (a) `tempCleanup.test.ts`, `extract.test.ts` and `transcribeCancel.test.ts` each mock `node:os` so `tmpdir()` — for the module under test AND the test — is a folder made for that file alone and removed after it (`tests/unit/tempSandbox.test.ts` fails if one stops, and if any other test file removes a real shared temp family). (b) The two-child case finds each child by the file it was asked to read.
- **Test.** The race itself: three files at once, before and after. Before (the three files in parallel): 2 of 12 runs red, every one the same case, `Test timed out in 5000ms`. After the sandbox alone: still 2 of 20 — which is how (b) was found. After both, 0 of 40; the full suite three times in a row (`npm run verify`, below); no `imagii-*sandbox*` folder left behind. **Mutation:** `transcribeCancel.test.ts` [`1e592056fc48`] without its `vi.mock('node:os'`: the sandbox pin names it.
- **Lesson.** **A fix for a named flake is not finished until the flake stops, and a plausible cause is a hypothesis until the red run stops.** The ticket's cause was true and would have been fixed and declared done — and the suite would have gone on failing one run in ten. Measure the failure rate before and after, in the configuration where it fails (files in parallel), with enough runs to tell 1-in-6 from zero (40), and read WHICH line fails: it was not the line the cause predicted. And a test that picks "the child I spawned first" has asserted an order nothing promised.

### Bug (3) — every validator failed open under NODE_ENV=production (design: validators throw, assert warns)

- **Bug.** With `NODE_ENV=production` in the environment, `chain.gainDb: "0dB,ametadata=mode=print:file=x"` went through the audio gate into the filter graph, and a `..` path went through `assertSafeAbsolutePath` into `ffmpeg -i`.
- **Root cause.** Every validator in `shared/validators.ts` (and `assertSafeAbsolutePath`) was written with `assert()`, which is a soft invariant by design: it throws in dev and `console.warn`s and RETURNS in production. A validator is the opposite thing — its whole job is to refuse. The packaged app does not set `NODE_ENV`, so this fails open for the person who has the variable set, and the unit tests (which never set it) could not see it.
- **Fix.** The split is the design, now stated: **validators throw; `assert()` warns.** `assertAlways(cond, msg)` (in `assert.ts`, throws in every environment) is the primitive; `validators.ts` and `assertSafeAbsolutePath` use it; `assert()` is unchanged. No call-site changes in those two modules; the IPC gates were converted in the same round (below).
- **IPC gates.** The 36 plain `assert(` boundary checks in `src/main/ipc/*.ts` (audio 2, image 4, project 1, recording 8, search 5, video 16: job and session ids, ranges, chunk caps, the project-save validity check, the moodboard ids and names) are `assertAlways` too; none was a soft invariant. The packaged app leaves `NODE_ENV` unset, so shipped behavior is unchanged; this closes only the environment hole (`project:save` would have written a project that failed validation under `NODE_ENV=production`). The source scan now covers `src/main/ipc`, call sites and the `assert` import alike.
- **Test.** `validators.test.ts` ("every validator throws under NODE_ENV=production": each of the ten validators on input it must refuse, nothing warned in place of a throw, valid input still accepted, and a source scan that fails on a soft `assert(` in `validators.ts` or `pathSafety.ts` and in any non-test file under `src/main/ipc`, with two sample-string tests that the scan sees a call, a multi-line call and the import and ignores comments); `assert.test.ts` (`assertAlways` dev and prod, and `assert()` still warns); `audioChainValidation.test.ts` (the real `audio:export` handler under forced production: a string `gainDb`, an out-of-range one and a second track whose path climbs out are refused and nothing is spawned). **Red-first:** `assertAlways` made soft (the old delegate): 20 reds, 17 in `validators.test.ts` and 3 in the chain gate ("promise resolved ... instead of rejecting"). **Mutations:** `assert.ts` [`0fbb8acb4a29`] soft in production: 20 reds; `pathSafety.ts` [`29702eb818dc`] back on `assert(`: the source scan and the valid-input case. IPC scan, red-first on the unconverted tree: 41 offending lines named, 1 failed | 70 passed. Mutations (restored byte-identical): `video.ts` [`dd3afa7c47b1`] one `video:cancelConcat` gate back on `assert(` names `video.ts:557`; `recording.ts` [`07a05faa55cf`] imports the soft `assert` names `recording.ts:22`; `audio.ts` [`6692e5e4a229`] the multi-line-form neighbor `chain.cutRegions` names `audio.ts:61`.
- **Lesson.** **A refusal that depends on an environment variable is not a refusal.** Soft assertions and hard validators answer different questions ("is my own code consistent?" and "is this input acceptable?"), and giving them one function meant the safer-looking name hid the weaker behavior. Name the two things differently, and test the hard one in the environment where the soft one lets go.

### The rest of the second pass (one line each)

- **(2) Re-attach re-encode died on an odd-sized picture** (a screen recording as VP9/VP8 webm is 321x241; libx264 + yuv420p refuse odd sizes, exit 187 "Error while opening encoder"): the re-encode chains `scale=trunc(iw/2)*2:trunc(ih/2)*2` ahead of any cut. Layer 5 red-first on three cases (VP9, VP8, VP9 with a cut), all exit 187 on the old command; `muxCodec.test.ts` pins the stage and its position before `select`. Mutation `process.ts` [`95da24f11b34`]: order swapped -> 1 red; stage dropped for a cut -> 1 red.
- **(4) Three ffmpeg/ffprobe spawns drew a console window on Windows** (`ffmpeg/probe.ts`, `audio/probe.ts`, `ffmpeg/smoke.ts` had no `windowsHide`): `tests/unit/spawnWindowsHide.test.ts` reads the syntax tree of every `spawn(` under `src/main` and fails on one without `windowsHide: true` (red on exactly those three; mutation `extract.ts` [`8d5f34591e92`] `windowsHide: false` -> 1 red on the multi-line call).
- **(5) Compile's refusals reached the person as "Compilation failed."**: `video:concat` called the raw validator; it now goes through `assertUsableRecipe` and says the batch's sentence (9 reds on the old handler; `videoCropPayload.test.ts` re-pinned knowingly).
- **(6) Burn-in's opening event carried `percent: 0` before the video was probed**, so a failed probe froze a determinate 0%: the opening event has no percent, `percent: 0` is sent once the length is known, and the 0.5-step throttle counts from it. (`captionsProgress.test.ts:297`, titled "indeterminate" and pinning `[0]`, now asserts that no event of an unknown-length burn carries a `percent` key.)
- **(7) A probe frame of 0 refused a burn** (`captionBasisPx` asserts a positive size): `isUsableFrame` (shared; the size readout and the burn both ask it) makes any non-positive or non-finite frame "no frame", the landscape command.
- **(8) Two refusals were unfinished sentences**: "Transcription already in progress" and "install already in progress" are now "A transcription is already running. Wait for it to finish, then try again." and "A model download is already running. Wait for it to finish, then try again.".
- **(11) ProjectIO: (a)** both staleness baselines are taken at the top of `applyProject` (the sound's was taken after the video's minutes-long wait, so audio opened and tuned meanwhile was wiped); **(b)** the clip selection and the playhead are applied only when the project's video actually opened; **(c)** the reopen conversion's toast is `reopen-convert` (it shared `convert` with the Importer and each dismissed the other's); **(d)** a skip says "The rest of your project is open. Open the project again to bring its video back." once, however many parts the outcome has, and the stale-transcript toast says "closed or replaced" (a close is not "another video") and "Transcribe again when you're ready."; **(e)** `applyProjectHeld` holds autosave for exactly the apply and lets go in a `finally` — the 1.5 s hold after it and the hold across the file dialog are gone, and a change made during a hold is saved the moment the last hold lets go. The residue is named below. Mutations on `ProjectIO.ts` [`67cefd3bfdf8`]: each of (a)-(d) -> 1-4 named reds; `useAutosave.ts` [`c03035c5825e`]: the 1.5 s hold back, no hold, no re-arm, release only on success -> 1, 1, 1 and 4 reds.
- **(12) Export panel and Clip Kit sent the stored clip where Compile sent the clip as it plays**: a hand-edited speed 0 was a batch refusal there and 1x everywhere else. `clipForExport` (`@shared/clip`) at both sites, and `tests/unit/jobClipNormalized.test.ts` fails on a third queue builder that does not (mutations: `ExportPanel.tsx` [`33827fd7fb07`], `clipKit.ts` [`8b0ac8ad8dd4`]).
- **(13) The kit's YouTube Short had no length check since Reels went to 1200 s**: `kitLimitTargets` names the swapped slot "YouTube Short" with its own 180 s limit; Reels stays 1200. A 4-minute 9:16 clip kitted with no question; now the question names the Short alone (E2E, and the mutation `clipKit.ts` [`695ef64b5964`] with the slot back to Reels' info: `waiting for ... 'This clip is long for some platforms'`).
- **(14) A kit canceled with nothing finished** (its folder was just removed) said "Files already finished are in your folder": `kitCanceledMessage(landed)`; three E2Es updated, each an exact-text match.
- **(15) Hook badge: ffmpeg was killed and restarted on every 0.05 speed tick** (the effect was keyed on the exact window, 3 x speed): it is keyed on the whole-second window (`hookWindowKey`; 76 ticks -> at most 12 changes). A clip whose output is under 0.5 s shows no row (`hookWindow` returns `null`; main's gate takes 0.5-30 and the badge asked for 0.1, dying silently); the stale comment in `highlights.ts` is fixed. Both E2Es were broken and shown red (`Received array: [6, 3, 3.15..., 3.3..., 3.45...]`).
- **(16) Accessibility sweep**: `aria-pressed` on the selected-state groups in the crop presets, Levels' compressors, Cleanup's strengths, the posting log's platforms and Stream Graphics' tools; `aria-current` on the References tabs; `aria-expanded` on the chat-log disclosure; `aria-live` on the kit button; `progressbar` on the scan bar, the model download and the record convert bar; `meter` on the signal bars; the loudness range visible beside the box; the transcript preview and the cropped-clips list focusable. `tests/unit/a11ySweep.test.ts` turns the class into rules (a selected-by-fill button without a state attribute; a bounded scroller with nothing to tab to) with a discrimination block, and DESIGN_GUIDE's Accessibility section says both.
- **(17) "Clean audio" asked "Close this audio?"** when nothing is closed: the lead-in is a parameter (`'close'` | `'replace'`), Clean audio asks "Replace the audio you're editing? Your cleanup settings and 2 cuts will be discarded." **Deviation, owned:** the list now reads "X and Y" / "X, Y and Z" for Audio Studio's Close too (it read "X, Y"); two pins changed.
- **(18) Asset descriptions never said their sample text does not export**: `templateTruth.test.ts`'s sentence rule now covers `ASSET_CATALOG` (nine cards reworded; the starting-soon card's "countdown to replace" is "The sample "0:00" does not export until you type your own").
- **(19) Docs**: the "crossfades" line in FOR_MIKE, the captions comment's "~120 px on both" (it is ~68 px on 1080x1920, the same fraction of the WIDTH), the stage's drop shadow that DESIGN_GUIDE called a dim, STYLE_GUIDE's hint-text sentence, and a UK-to-US spelling sweep of the lines the wave added (docs prose and code comments, never an identifier such as `cancelledOr`, never a quoted message or test title).

### Found, not fixed

See the round-63 section of `INTERACTION_COVERAGE.md`.

---

## 2026-10-10 — T-112 (round 62): a transcript that followed the wrong video, a failed batch that failed every row, a project that overwrote the video you had just opened, and the rest of the review gate's renderer finds

The renderer half of the nine-reviewer sweep (T-111 was main's). Thirty-six findings, one family seen from many windows: **a value captured when work began and used when the work ended, with nothing asking whether the world was still the one it was captured in** (the transcript, the project's reopen, the importer, the batch's rows, the second Export), and its sibling, **a label written for the case its author pictured** (a crop is not a source, a Reset is not a Close, a notch is not "mains", 20 minutes is not 3). **No ffmpeg command, filter graph or audio chain changed**, so Layer 5 (`test:media`) was not triggered (IMG-PREC); the main-side edits are Reels' number in the mirrored preset table, which `presetTablesInSync.test.ts` now pins to the renderer's (Reels 1200 s, TikTok 60 s), and one new channel, `video:removeKitDir` (item 11, approved after the first hand-back). Every behavior change below was red-first against the tree as it stood, and every new refusal was shown to discriminate by breaking its guard, naming the exact red, and restoring the file by content replace (sha256 before and after in the brackets).

### Bug (18) — captions made for one video were attached to the next

- **Bug.** Transcribe on video A (a job of minutes), open video B, and when A's job finishes: "Captions ready", and B's panel offers "Burn into video" carrying A's words, which the burn would have printed on B.
- **Root cause.** The panel's `await window.api.captions.transcribe(...)` resumed and called `setSrtPath(result.srtPath)` on whatever was open. The store action took a path and nothing else; the closure knew which video it had started on and never compared.
- **Fix.** `videoStore.setSrtPathFor(sourcePath, srtPath): boolean` stores the path only when the open source is the one named and says whether it did. The panel passes the path it captured at click time and, on a refusal, says "Captions for <name> finished after you opened another video, so they weren't added". The guard is in the STORE action so the next caller cannot forget it; `interactionWiring.test.ts` pins that the panel never calls the bare setter after its wait. The same file opened again meanwhile IS the video it started on (same path); closing the video is not.
- **Test.** `videoStore.test.ts` > "setSrtPathFor" (six cases, one through the real `loadSource`); E2E "transcription that finishes after the video changed is not attached to the new video" (a held `captions:transcribe`: A closed, B dropped, A released -> no "Burn into video", none of A's words, the toast). **Red-first:** unit, six reds on the old store (`setSrtPathFor` does not exist); E2E on the old build, `Expected: ArrayContaining [StringContaining "finished after you opened another video, so they weren't added"]` / `Received: ["Video loaded", "Video loaded", "Captions ready (1 line)"]`. **Mutations:** `videoStore.ts` [`7b527594c80e`] guard -> `if (false)`: 4 reds ("transcribe A, open B, A finishes: B gets nothing", "does not overwrite B's own captions with A's", "nothing open ... is not the video it started on", "works through the real loadSource"); `CaptionsPanel.tsx` [`c9a64329fcf3`] bare setter back: 1 red (the wiring pin). E2E, `CaptionsPanel.tsx` with the bare setter back: the same `Received: ["Video loaded", "Video loaded", "Captions ready (1 line)"]`.
- **Lesson.** **An `await` is a gap in which the world can change; the code after it is a different caller.** Anything that applies an async result to "the current X" must be told which X it was made for. Put the comparison in the thing being written to, not in each place that writes to it.

### Bug (20) — a project reopened over a long wait replaced the video you opened meanwhile

- **Bug.** Open a project whose video must be converted or whose sound must be re-extracted (seconds to minutes), then drop a different video: when the wait ends the project's video replaced yours, source, clips and history. The same for the sound.
- **Root cause.** `applyProject` awaited the conversion/extraction and loaded the result unconditionally.
- **Fix.** The source each studio held is captured before the waits (`heldBefore`); after them `replacedSince(before, now)` (`now !== null && now !== before`) skips the stale source and ONLY that source: the clips are not laid over a video that is not the project's, the other studio still opens, and the outcome says "Skipped the project's video because you opened another video while it was loading." Closing the video during the wait is not "opening another" (nothing to protect), so it still applies. Two sibling findings ride the same function: "moved or deleted" is said only for a failure that says a file is not there (`isMissingFileError`, one pattern shared with `userFacingError`'s known causes), and every other failure goes through `userFacingError` ("Your disk is full...", "That file looks damaged...") instead of a guess; and the sound's re-extract now shows "Extracting audio…" (own toast id, dismissed in a `finally`) like the conversion above it. One composer, `describeApplyOutcome`, serves Home's Open and the autosave Restore.
- **Test.** `ProjectIO.test.ts` > "applyProject over a long wait (T-112)" (deferred gates drive the real stores and the real `applyProject`: a video dropped during the conversion keeps its source, clip and history; the sound likewise; skipping one does not skip the other; closing is not replacing; the control with nothing opened applies; the class of each failure; the sentences; the toast shown, and taken down on failure too); `userFacingError.test.ts` > "isMissingFileError"; E2E: the T-107 reopen test now reads "Extracting audio…". **Red-first:** `expected { …(5) } to be { …(4) }` (the dropped video's store replaced), `expected [ { studio: 'video', …(2) } ] to deeply equal []` (a failed conversion reported as missing), `expected "spy" to be called 1 times, but got 0 times` (no extract toast); E2E on the old build, `Expected substring: "Extracting audio…"` / `Received string: "Converting for editing… | Project loaded"`. **Mutations:** `ProjectIO.ts` [`13fbd7f89856`] `replacedSince` -> `false`: 3 reds; every error "missing": 4 reds; the extract toast removed: 2; the dismiss out of the `finally`: 2. `userFacingError.ts` [`9e14b627c52a`] `isMissingFileError` -> `true`: 9 reds. Two existing tests ("an extraction that fails with the video still there", "a conversion that fails ...") were changed on purpose: they asserted `unavailable` for a failure that is not a missing file.
- **Lesson.** **A long wait that the user cannot see is a window for them to do something else.** The decision to apply a result belongs after the wait, against what is true now, and a skip must be local (the stale source), not a refusal of the whole project. And a catch-all that says "moved or deleted" for every failure is a diagnosis nobody made.

### Bug (7) — one failed job marked every unfinished row Failed

- **Bug.** A batch whose second job failed showed "Failed" on that row and on every row behind it (which never started), no reason on screen once the toast faded, and Cancel and failure read the same.
- **Root cause.** The catch handler marked every row that was not done with the error.
- **Fix.** `settleJobs(jobs, { cancelled, message })`, pure and exported: finished rows are untouched; a Cancel is the user's decision on the whole batch (every unfinished row "Canceled"); a failure marks the FIRST unfinished row "Failed" with its reason as text on the row and the rest "Not run" (neutral). Jobs run sequentially and a failure ends the batch, so the first unfinished row is the culprit. `// simplification:` in the file names the ceiling: a refusal before anything starts (the single-flight gate) marks row 1, and the upgrade is a `video:jobStarted` event. A finished row also shows the file it wrote (`name (2).mp4` when the name was taken).
- **Test.** `ExportPanel.test.ts` > "settleJobs" (seven cases); E2E "a failed batch marks the job that failed — Failed, with its reason as text — and the jobs behind it Not run" (four jobs, one of them a 9:16 platform whose safe-zone question is answered; the source removed while job 2's probe is held with `installSpawnStall`: one finished, one Failed, two Not run, one red bar, the reason still on screen after the toast). **Red-first:** unit, all seven cases red (`settleJobs` absent); E2E on the old build (the first, three-job version of the test, before it was widened to four so the plural is visible), `Expected: 1` / `Received: 2` on the Failed count. **Mutations:** `ExportPanel.tsx` [`01e075570bd3`] the rows behind marked failed instead of "Not run": 2 reds; a Cancel not marked canceled: 1 red. E2E, `ExportPanel.tsx` with the blanket back: `getByText('Failed', { exact: true })` `Expected: 1` / `Received: 3`.
- **Lesson.** **A status that names the culprit has to know who the culprit is.** "Everything unfinished failed" is the cheap way to leave no row in a state that looks running, and it is wrong about the rows that never started.

### Bug (16) — Clean audio silently replaced a tuned Audio Studio session

- **Bug.** Audio Studio's own Close asks "Close this audio? Your cleanup settings will be discarded." Video Studio's Clean audio opened the video's sound in the same studio over a tuned session without asking: an hour of Custom noise floor, EQ and Levels gone.
- **Root cause.** `audioCloseMessage` and the confirm lived in `AudioStudio.tsx`; the other door into the same session never called them.
- **Fix.** The helpers moved to `audio-studio/audioClose.ts` (`AudioStudio.tsx` re-exports them) so Video Studio imports the question and not the component tree; `cleanAudioFlow` begins with `confirmAudioClose(chain, confirm)`. An untouched session (chain equal to the default) asks nothing; a declined confirm extracts nothing and opens nothing.
- **Test.** E2E "Clean audio asks before it replaces a tuned Audio Studio session, in Audio Studio's own words" (the native confirm answered by the test's dialog handler: the message word for word, declined -> still in Video Studio, the button free and no "Opening Audio Studio" toast; accepted -> Audio Studio with the video's sound; the control, an untouched session, asks nothing); `interactionWiring.test.ts` pins the call before the extraction; `AudioStudio.test.ts` (unchanged) still tests the message and the confirm through the re-export, so both doors answer to one pair of tests. **Red-first:** `Expected: 1` / `Received: 0` (no confirm was asked). E2E, `VideoStudio.tsx` [`57f187670484`] with the confirm line removed: `Expected: 1` / `Received: 0`.
- **Lesson.** **A confirm belongs to the destruction, not to the button that was first to be written.** When a second path reaches the same destructive step, move the question to where both can call it.

### The rest, one line each (the covering test is named; every row also has a ledger entry in `INTERACTION_COVERAGE.md`)

- **(1) Clip Kit's YouTube slot is a Short when the CROP is vertical**, not when the source is (`isVerticalFrame` via `cropFrameSize`; a portrait source cropped to landscape keeps its landscape file, a square crop is not vertical). `clipKit.test.ts` (six cases); E2E "a 16:9 recording cropped to 9:16 gets a Short from Clip Kit" (eight files, the Short probes 1080x1920, no `Clip_1_youtube.mp4`). Mutation `clipKit.ts` [`d4f7a3cecf6f`] (the source's orientation judged instead of the crop's): 3 reds.
- **(2, 5) Reels' 180 s was Instagram's RECOMMENDATION cutoff, not its limit.** Past 3 minutes the card is yellow ("Over 3 minutes — Instagram won't recommend it to new viewers"), red only past 20 minutes; main's mirror table says 1200 s; TikTok stops saying "Over the 34-second sweet spot" of a clip of a minute or more. `presets.test.ts`, `presetTablesInSync.test.ts`, E2E (the T-97 speed test re-pointed: 300 s at 1x Instagram's advice and no "Too long", 150 s at 2x the sweet-spot reason, 600 s at 0.5x the advice again, never the length's red; a 36-minute source red at 1x, the advice at 2x. The fixture's 4:3 picture into 9:16 reads "Wrong shape" as a whole, which is the shape's verdict, not the length's: the first draft of the test asserted the whole card was "OK" and the full run was the only thing that said otherwise). Mutations: `presets.ts` [`0db0893bcd77`] Reels back to 180 s: 16 reds; the Reels note off: 3; the TikTok 60 s guard off: 2; main's `presets.ts` [`4b031b3bb6be`] Reels back to 180 s: 3 reds (`presetTablesInSync`).
- **(3, 4) The Compile card discloses what it makes** ("1920×1080, 30 fps", from `COMPILE_SIZE` and `COMPILE_TARGET.fps`) and calls its fade what ffmpeg does (out to black, in from black, no overlap; "Crossfade" was wrong). E2E "the Compile card says what it makes...".
- **(6) The Hook badge says "First 3 s" and measures 3 SECONDS THE VIEWER SEES**: `hookWindow(clip)` -> `{ sourceSec, outputSec }`, the window is output seconds x speed in source seconds (**deviation from the ticket's "divide"**: output time is source time over speed, so the source window is multiplied; 2x listens to 6 source seconds). The window is also cut at the clip's end, and the LABEL follows it ("First 2 s:" over a 2 s clip; it said 3 over a window that ran past the clip, a third truth found when the old T-92 hook test went red on the new window and was re-pointed). `highlights.test.ts`; `interactionWiring.test.ts` (label and window from one `hookWindow`); E2E (replaces the IPC in main and reads 6 / 1.5 / 12 / 3 s at 2x / 0.5x / 4x / 1x, and "First 3 s:" on a long clip). Mutation `highlights.ts` [`7ea11a872ac9`] (the window ignores speed): 2 reds.
- **(8) A video with no sound has nothing to clean, transcribe or scan**: the three buttons are off and say "This video has no sound." (`videoHasNoSound`; the probe's `audioCodec` already existed, no main edit). E2E "a video with no sound ..." (a forced click goes nowhere; the control has all three). Mutation `videoStore.ts` [`7b527594c80e`] `videoHasNoSound` -> `false`: 1 red.
- **(9, 13) Export with no folder opens the chooser** (a canceled chooser starts nothing and says nothing; the old "Choose an output folder first" toast is pinned gone), and a disabled Export says why ("Check at least one platform below to export." on screen and as the title). E2E "with no output folder Export opens the chooser ...".
- **(10, 14) Saved toasts name the file** ("Saved name (2).gif": the runner's own `outputPath`, which all four IPCs already returned), and Compile's wire carries the speed the clip PLAYS at (`clipRecipe` -> `clipSpeed`, **fixed in the shared function, not the panel**, so a legacy stored 0 compiles at 1x instead of failing main's round-61 validator). `clip.test.ts`; E2E "a clip whose stored speed is 0 compiles at 1x ..." and the four T-106 duplicate-name tests. Mutation `clip.ts` [`2c3cbfd6bba3`] (raw stored speed back on the wire): 2 reds. E2E mutation: `Expected substring: not "Compilation failed"` / `Received string: "Project loaded | Compilation failed."` (the test waits for the file OR that toast, so the red takes seconds; the first version of the test only polled for the file and its red took nine minutes).
- **(11) Clip Kit's button counts its work** ("Exporting platform version 2 of 5…", then "Extracting thumbnail 2 of 3…", moved by `video:jobComplete`). `clipKit.test.ts`; E2E holds job 2's probe. Mutation `clipKit.ts` [`d4f7a3cecf6f`] label -> a total: 3 reds. **The kit's empty folder is removed on a Cancel or a failure that landed no file** (`video:removeKitDir`, a main-side addition approved after the first hand-back: a non-recursive `rmdir` behind the path gate, every refusal a console note; the renderer asks only while its `landed` count is 0). `videoRemoveKitDir.test.ts` (15 cases on real folders); three E2E (cancel and failure remove it through the real handler; a cancel after a file landed keeps the folder and the renderer never asks). **Red-first:** on the build before the change the folder survived (`existsSync(kitDir)` `Expected: false` / `Received: true`). **Mutations:** `ClipKitButton.tsx` [`e83c5905af7e`] the call removed: both removal tests red; the `landed === 0` guard dropped: the keep test red (a call was recorded); `frame.ts` [`5ab93d0b708d`] the `rmdir` a no-op: both removal tests red, and the handler's own unit mutations (recursive `rm`: 4 reds; the failure rethrown: 5; the gate removed: 3; the channel absent: 14) with `video.ts` [`1a61416b3a5b`].
- **(12) The Captions header says what is running**: Transcribing… / Burning in… / Re-transcribe / Transcribe (a `job` state, not one boolean). E2E (the real burn in the T-100 test).
- **(15) Crop > Reset clears the crop and keeps the section open, whichever way the crop arrived.** E2E "Reset clears the crop but keeps the Crop section open, whichever way the crop arrived": a project-loaded crop and a hand-drawn one (the control). **Red-first:** the old build, on the loaded crop after the Reset click, `Expected: checked` / `Received: unchecked` (the box unchecked itself). E2E mutation, `CropOverlay.tsx` [`aa08a4eadece`] Reset without `onEnabledChange(true)`: the same `Expected: checked` / `Received: unchecked`.
- **(17) The importer refuses a second import while one runs** ("Still converting the last video. Wait for it to finish." / "Still loading the last video. Wait for it to finish."), from the drop, Choose file and Recent alike, with a REF (two arrivals in one tick are both seen; state would not be). E2E "a second drop while a conversion runs is refused, not started in parallel". **Red-first:** `Received: ["Converting for editing…", "Video loaded", "Video loaded"]` (both started). E2E mutation, `Importer.tsx` [`115d5f7a1843`] with the busy check forced open: the same `Received: ["Converting for editing…", "Video loaded", "Video loaded"]`.
- **(19) Export pressed again after leaving Video Studio and coming back** is refused with the single-flight sentence and starts nothing (the spawn log is unchanged): round 61 shipped the refusal in main; this drives it end to end. E2E "pressing Export again after leaving Video Studio and coming back is refused ...". The orphaned Cancel of the first batch is T-110(j).
- **(21) done under (20).** **(22) done under (20).**
- **(23) Hint text draws at 40% on the canvas only** (`displayOpacity`; the stored layer is untouched, `captureDocument` still switches hint nodes off, so the export is byte-for-byte unchanged); the five template descriptions say which text does not export; the Profile banner no longer points at an "offline screen" no card provides. `canvas.test.ts`, `canvasStore.test.ts`, `image-studio/ExportDialog.test.ts`, `templateTruth.test.ts`; E2E (Konva node opacity 0.4 / 1 / 1-after-typing, with the two existing pixel checks proving the export unchanged). Mutations `canvas.ts` [`ab9fdcd1fe4f`], `ExportDialog.tsx` [`10684d4ee9bc`], `templates.ts` [`3743a56af5af`].
- **(24) The audio export row is a `progressbar`** named by its pass ("Step 2 of 2 — rendering"), with min, max and now. E2E (the T-100 export-row test through both passes).
- **(25) The Fix Wizard names the notch it applies** ("Hum removal: on (50 Hz mains)"; the patch carries the chain's frequency so Apply writes back what the line said). `fixWizard.test.ts`; E2E (60 Hz and a new 50 Hz test). Mutation `fixWizard.ts` [`3b02a518a7d7`]: 15 reds.
- **(26) "-25 is the Light preset's setting."** (the hint said Medium). `audioStudioCopy.test.ts` derives the owner of the number from main's `denoiseFilter`; E2E (the Custom-controls test). Mutation `CleanupPanel.tsx` [`04bdd6384b87`]: 2 reds.
- **(27) The loudness box stops a number loudnorm refuses**: `min`/`max` from `LOUDNESS_TARGET_LUFS`, and a number outside -70..-5 becomes the nearest edge when typing ends (blur or Enter); a number inside goes straight to the chain; junk changes nothing (**deviation: draft + commit**, because a keystroke cannot be refused and `min`/`max` do not block typing). `commitLoudnessTarget`: `audio.test.ts`; E2E "the loudness target box stops a number loudnorm refuses" (-3 -> -5, -80 -> -70, "" keeps -70, typing -23 key by key passes through -2). Mutation `audio.ts` [`5745a610f833`]: 3 reds.
- **(28-35) Accessibility and design.** The Compile verdict list takes focus with a ring (`tabIndex`, `focus-visible:ring-2`) and its name column flexes (a 2:3 share of the row beside the verdict, both `min-w-0`; the first attempt, a bare `flex-1` name, measured **0 px** on the live card, because a flex item with a zero basis gets none of a row that a long verdict has already claimed; no unit test can see layout, and the E2E bounding-box measurement was the one that said so); the GIF warning lives in an always-mounted `role="status"` so a Speed change announces it; four contrast pairings that missed AA (the Highlight pill 3.58:1, the Clip Kit label 4.12:1 / 3.58:1 on hover, the Captions setup card 4.10:1) are ink on their wash at 10.4-12.0:1, and `designTokensInSync.test.ts` now scans the renderer for accent-family TEXT on an accent or ember WASH and recomputes the pairings from the tokens (the review's 3.60 / 4.10 / ~3.6 / 4.09 were close but not these: the recomputed old values are the ones quoted); setup-card links are underlined at rest in the warn tone; `aria-pressed` on Reframe's positions; `aria-current` on the selected clip row and its select button, whose accessible name now contains its timecode (label-in-name); the crop-guides svg is `aria-hidden`; the dead `RATIO_COLOR['16:9']` is gone (three guides, pinned in `designTokensInSync.test.ts`, and DESIGN_GUIDE says three). Mutation `HighlightPanel.tsx` [`c56dedcf6997`]: the structural scan red.
- **(36) The Caption Size readout uses the loaded video's real size** ("about 35 px tall on this video", `captionSizeReadout(fontSize, probe)` through `effectiveCaptionPx` with the width), the 1080p wording only with no video. `captions.test.ts`; E2E (320x240 -> 20 / 35 / 18 / 45 px). Mutation `captions.ts` [`6855ff1d1fd4`] (always the 1080p wording): 2 reds.

### Every E2E guard, broken once (round 62)

Each row: the guard broken in the SOURCE (or, for the single-flight gate, in the built bundle, so `src/main` stays untouched), the app rebuilt, only that test run with `--retries=0`, the exact red, then the file written back by content replace. sha256 (first 12) before = after on every row; the logs are the round-62 scratch `mut-e2e.txt` and `mut-e2e-2.txt`.

| Guard broken | File [hash] | The test's red |
|---|---|---|
| the single-flight gate open (built `out/main/index.js`) | [`7db868e8c617`] | `Received: ["Video loaded", "Exported 1 file"]` (the second batch ran) |
| importer busy check forced open | `Importer.tsx` [`115d5f7a1843`] | `Received: ["Converting for editing…", "Video loaded", "Video loaded"]` |
| Clean audio confirm removed | `VideoStudio.tsx` [`57f187670484`] | `Expected: 1` / `Received: 0` dialogs |
| Reset without `onEnabledChange(true)` | `CropOverlay.tsx` [`aa08a4eadece`] | `toBeChecked` `Expected: checked` / `Received: unchecked` |
| bare `setSrtPath` after the wait | `CaptionsPanel.tsx` [`c9a64329fcf3`] | no "finished after you opened another video" toast; `"Captions ready (1 line)"` instead |
| blanket "every unfinished row failed" | `ExportPanel.tsx` [`01e075570bd3`] | Failed `Expected: 1` / `Received: 3` |
| raw stored speed on the compile wire | `clip.ts` [`2c3cbfd6bba3`] | `not "Compilation failed"` / `"Project loaded \| Compilation failed."` |
| hook label a literal "First 3 s:" | `ClipList.tsx` [`aa537399cdcc`] | `getByText('First 2 s:')` not found (T-92 test); unit wiring pin red |
| `videoHasNoSound` always false | `videoStore.ts` [`7b527594c80e`] | Clean audio `Expected: disabled` / `Received: enabled` |
| Export with no folder toasts again | `ExportPanel.tsx` [`01e075570bd3`] | `Received: ["Video loaded", "Choose an output folder first"]` |
| kit judges the source's orientation | `clipKit.ts` [`d4f7a3cecf6f`] | file list `toEqual` (the landscape YouTube file instead of the Short) |
| hook window ignores speed | `highlights.ts` [`7ea11a872ac9`] | `Expected: 6` / `Received: undefined` (no call followed the speed change) |
| GIF warning region not `role="status"` | `GifPanel.tsx` [`80e90331a5c5`] | `getByRole('status')` `Expected: 1` / `Received: 0` |
| verdict list not focusable | `CompilationPanel.tsx` [`cf612b33fec9`] | `tabindex` `Expected: "0"` / `Received: ""` |
| verdict claims the whole row | `CompilationPanel.tsx` [`cf612b33fec9`] | name width `Expected: > 100` / `Received: 0` |
| loudness commit does not clamp | `audio.ts` [`5745a610f833`] | `Expected: "-5"` / `Received: "-3"` |
| Fix Wizard ignores the chain's mains | `FixWizard.tsx` [`c746652da496`] | `Expected substring: "Hum removal: on (50 Hz mains)"` |
| audio export row not a progressbar | `ExportDialog.tsx` (audio) [`24e876ccda4b`] | `toHaveAccessibleName` `Expected: "Step 1 of 2 — measuring loudness"` (no `progressbar`) |

The slow rereds are a finding of their own: a test that polls for a file for nine minutes turns a broken guard into a coffee break. The kit and the zero-speed compile now wait for "finished" (the label leaving "Exporting…", or the failure toast) and read the result once.

### Decisions this round, for the next reader

- **The guard lives in the shared function or the store action, not the caller** (items 14, 18). The panel is the third caller of a thing that already has two.
- **"Not run" is a status**, not a variant of Failed. A canceled batch keeps "Canceled" for every unfinished row; only a failure distinguishes the culprit from the rows behind it.
- **Reels' 20-minute hard limit is the one main-side number changed**; the renderer's 180 s lives on as a yellow RECOMMENDATION constant (`REELS_RECOMMEND_CUTOFF_SEC`), so the grid's yellow and red never disagree with the file main writes.
- **The importer's busy flag is a ref**: two arrivals in one tick (a double drop) are both seen; React state would show the first as free to the second.
- **The loudness box edits a draft.** A controlled number input cannot refuse a keystroke, and a half-typed "-2" on the way to "-23" is inside the legal range for one key.

### Found, not fixed

- **The Export batch and Clip Kit still refuse a clip stored at speed 0** (their sentence names the speed, and the slider shows 1.00x, so the person cannot fix it); Compile now plays it at 1x. The batch's `assertOptionalClipRecipe` or the same `clipSpeed` reading would close it.
- **`settleJobs` blames row 1 for a refusal before anything starts** (the single-flight gate). A `video:jobStarted` event would name the real culprit.
- **Template and catalog cards with hint text but no "sample text doesn't export" sentence**: frame-clean-corner and its 2K/4K variants, lower-third-clean, the scene cards, social-square-clip.
- **The native (non-conversion) `loadSource` probe window in `applyProject` is unguarded**: milliseconds, and the dominant cases (conversion, extraction) are guarded.
- **Panel-local job state and the orphaned Cancel** remain T-110(j). The importer's busy toast has its own id, separate from Clean audio's.
- **Audio Studio's slider hints are hover-only** (`ParamSlider` puts the hint in the label's `title`), so the corrected Light-preset sentence reaches pointer users alone; the verdict reasons moved on screen in T-83, these have not.

---

## 2026-10-10 — T-111 (round 61): a title that killed the export, a mix that jumped 6 dB, a vertical clip with a wall of text, and the rest of the review gate's main-process finds

Nine reviewers swept the held wave and this ticket is the main-process and media-chain half of what they found. One family again, seen from a new side: **text and numbers that pass through several parsers or several windows, checked against the one they were written for.** An apostrophe is fine to the person who typed it and to the form that stored it; ffmpeg reads it three times. A sound is one level to the mixer's arithmetic for as long as both tracks play; it is the survivor's level after one stops. A size is right at 1920x1080 and says nothing about 1080x1920. **This round changes ffmpeg graphs and commands** (the drawtext text, the mix, the burn's style, the re-attach's mux, the extractor's format), so `npm run test:media` was part of it (IMG-PREC). The win32-only drawtext cases were also run against a system ffmpeg 6.1.1 (the shipped build's major; it has drawtext) with the DejaVu fonts standing in for Arial, by aliasing `ffmpeg-static` in a throwaway vitest config; that config is not committed (the suite has no pattern for a second binary).

### Bug (1) — "Let's go" killed the export, "Sale 50% off" exported and drew nothing, a newline drew the letter n

- **Bug.** A text overlay or watermark containing `'` failed the whole export with `No such filter: '0.000'`; one containing `%` exported a file with the overlay silently missing; a newline drew the letter n; `C:\games\run` lost its backslashes.
- **Root cause.** `escapeDrawtext` assumed one parser. ffmpeg reads `text='...'` three times: the filtergraph parser (`av_get_token`: quotes removed, `\x` is `x` outside them), the option parser (the same rules again on what is left, now without the quotes), and drawtext's own expansion (`\x` is `x`, a bare `%` starts a `%{...}` call). The old map was right for none of the three together: its `\'` closed the pass-1 quote (so `enable='between(t,0.000,...` lost its commas), its `\%` was one pass short, and its `\n` is not drawtext's newline.
- **Fix.** One map, derived empirically and then proven pixel for pixel: `\` -> four backslashes, `%` -> `\\%`, `:` -> `\:`, `'` -> `\'\''` (a literal backslash inside the quote, close it, an escaped quote outside, reopen), a newline stays a real newline, a space or tab at either end is backslash-escaped (pass 2 trims a value's ends), and a newline at either end is dropped (drawtext 6.1 draws NOTHING for a text whose first or last line is empty). The derivation harness rendered 16 texts as overlays and as watermarks through the REAL `buildVideoFilter` and compared each frame with the same raw text drawn through `textfile=` + `expansion=none`: identical, except the edge-newline texts, where the oracle itself drew nothing.
- **Test.** `filters.test.ts`: the exact strings; a small model of ffmpeg's two `av_get_token` passes and drawtext's expansion that parses the whole `drawtext=...` back for twelve texts (each must come out as the typed text with `fontsize`, `fontcolor`, `x`, `y`, `enable` and `fontfile` intact), the watermark, and the two reviewer texts pinned as whole graphs; the model is shown to fail the old escape (it throws on the apostrophe and on the percent). Layer 5 (win32 twins): the four tricky texts export and paint at the lower third, a two-line overlay paints both lines, a watermark of `Joe's 50%: live` paints its corner. **Red-first:** 15 unit reds on the old `filters.ts`; the Layer 5 twins against the system ffmpeg on the old source: `FFmpeg exit 8 ... No such filter: '0.000'` and `a two-line overlay paints its second line (0 green px)`. **Mutations** (filters.ts `c47b0427623a`): the baseline file restored -> the 15; restored byte-identical.
- **Lesson.** **Count the parsers between the text and the thing that reads it.** The unit test pinned the string and the string looked like every escape in the docs; nothing asked what ffmpeg would make of it, and the T-74 stand-in trick cannot help here (the argument under test IS the filter's). The model-of-the-parser test is what a platform with no drawtext can still run.

### Bug (2) — a custom preset of 1081x607 failed every export

- **Bug.** The custom-preset form takes any size from 16 to 16384; libx264 refuses an odd side ("width not divisible by 2"); every export made with such a preset failed. Compile's segments had been snapped to even since round 15.
- **Fix.** `resolveExportPreset` snaps the custom size with `even()` (1081x607 -> 1080x606) and derives the aspect from what it will write; the renderer's mirror `customPresetInfo` does the same, so the grid judges the file that will exist (`presetTablesInSync.test.ts` holds the two to the same answer). **Test.** `presets.test.ts`; Layer 5 "an odd custom size exports" (landscape, portrait, and Auto Zoom, whose `s=` writes the size a second time). **Red-first:** `[libx264] width not divisible by 2 (1081x607)`. **Mutation** (presets.ts `39122330ed02`): baseline -> the Layer 5 case red.
- **Lesson.** **The rounding that one code path does is a rule of the encoder, not of that path.** Both callers of the same encoder need it, and the one that did not have it was the one a user can type a number into.

### Bug (3) — `video:exportBatch` checked a clip's crop and overlays and nothing else

- **Bug.** A speed of 1e-6 (a hand-edited project) wrote a 261-byte file and reported success; a temperature of 5 is outside what `colorbalance` takes. Compile had checked the whole recipe since T-105.
- **Fix.** `assertOptionalClipRecipe` on each clip (T-110(d) decided: validate), answered with one finished sentence ("One of this project's clips has a setting imagii can't use — check its speed, color and text, then try again."), the detail to the console, the crop still speaking its own. **Test.** `videoExportBatch.test.ts`, 15 cases through the real handler (11 damaged recipes, the whole-batch refusal, the crop's sentence unchanged, the envelope, a good recipe at the slider's ends). **Red-first / mutation** (video.ts `30ef92f86937`): the call removed -> 12 reds.
- **Lesson.** **The second caller of a validator is the bug.** T-105 wrote the recipe check for the caller it was fixing.

### Bug (4) — the survivor of a mix steps up 6 dB the moment the other track ends

- **Bug.** `amix` scales each input by 1/N where N is the number of inputs still running. A music bed shorter than the voice (a 3-minute track under a 40-minute stream) ends mid-recording and the voice jumped 6 dB: measured in the voice's own band, -30.1 -> -24.1 dB (manual gain, and with ducking) and 4.7 dB under match-loudness. Every existing mix fixture had a bed as long as the voice, so the survivor was never alone.
- **Fix.** `normalize=0`: each input keeps the weight it was given, so the voice is one level from the first second to the last and the bed's gain sets how loud it sits. Summing at full weight can pass full scale, so a manual-gain mix ends in `alimiter=limit=0.891:level=disabled` (a match-loudness mix has its loudnorm's -1.5 dB true-peak limit). `level=disabled` matters: alimiter's default re-levels the output toward the limit (measured: a -18.1 dB peak came out -17.1).
- **Test.** Layer 5 "the voice is one level when a shorter music bed ends" (a steady 300 Hz voice for 8 s, a 3 kHz bed that stops at 3 s, each measured through a bandpass 1 s before and 0.3 s after): manual, ducked, a +6 dB bed (6 dB hotter, the voice unmoved), match-loudness (0.7 dB after, was 4.7), two near-full-scale tracks limited rather than clipped (peak -1.0 dB, was 0.0), and a quiet mix left exactly where the upmix puts it (the limiter must not re-level). The twenty existing audio-chain cases passed unchanged. **Red-first:** `the voice before (-30.1 dB) and after (-24.1 dB) the bed ends differ by under 1 dB: expected 6 to be less than 1`; `(-21.2 dB) and (-16.5 dB) ... expected 4.7 to be less than 2`. **Mutations** (process.ts `b622fab8d825`): the limiter -> `anull` -> the hot case red (`peaks at 0 dB`); the limiter without `level=disabled` -> the hot case AND the quiet case red (`expected 1.01 to be less than 0.5`).
- **Lesson.** **A normalizing combiner has a state the fixtures must visit: one input left.** Test the mix at the moment one track leaves, not only while both play.

### Bug (5) — a second track's numbers reached the filter graph unchecked

- **Bug.** `secondaryTrack.gainDb` is printed into `volume=${gainDb}dB` and the ducking numbers into `sidechaincompress=ratio=...`. The gate checked the track's FILE and nothing else: a hand-edited project with `gainDb: "0dB,ametadata=mode=print:file=x"` put a second filter into the graph, and `ametadata` writes the file it is told to (an arbitrary file write).
- **Fix.** `secondaryTrackProblem` (`@shared/audio`, pure) holds gain to -60..+12 and the ducking numbers to the sliders' ranges (threshold -60..0, ratio 1..20, attack 1..200, release 50..2000), finite numbers only; main's `validateChainSpec` and `validateProject` (a project is refused when it opens) both call it. The export gate answers in a finished sentence ("The second track has a setting imagii can't use — check its gain and ducking, then try again."), detail to the console. **Item 7 rides along:** the loudness target is `loudnorm`'s own -70..-5 (it was -70..0; a typed -3, reachable from an unbounded number box, reached ffmpeg and died as a bare "Export failed."), with its own sentence; a project is NOT refused over it (a person's project with an odd target is still theirs).
- **Test.** `audioChainValidation.test.ts`: the runner shown embedding the injected string verbatim in `-filter_complex` (the hazard; green on HEAD), then 17 refusals each on `audio:export` and `audio:mux`, the saved-preset door, the envelope, the controls at the slider ends, 17 loudness cases; `audio.test.ts`; `projectValidation.test.ts`. An injection is never run through a real ffmpeg. **Red-first:** 46 of 55 on the old `audio.ts`. **Mutations:** the shared check removed from `projectValidation.ts` (`16cb33652ec4`) -> 6 reds; the old `audio.ts` -> the 46.
- **Lesson.** **A number that is printed into a command is a string until proven otherwise.** The project validator checked the path because the path was the known hazard; the numbers were "just numbers" in the type, and a type is not a check at a boundary a file can cross.

### Bug (13) — a reopened project's Re-attach copied a wmv2 picture into an mp4

- **Bug.** A reopened project re-attaches to the ORIGINAL video (a session that imported a .wmv muxed onto the h264 working copy it had made). `-c:v copy` of wmv2 into an mp4 is `Could not find tag for codec wmv2 in stream #0, codec not currently supported in container`, every time.
- **Fix.** The mux probes the picture first: h264, hevc, av1, mpeg-4 and mjpeg are still copied packet for packet (`canStreamCopyIntoMp4`); anything else (wmv2, vp8/vp9, theora, mpeg-2...) is re-encoded in the same step with the cut path's settings (libx264 medium, yuv420p, passthrough), its bar measured against the cleaned audio's length. A picture that cannot be probed is re-encoded too. A cut skips the probe (it re-encodes anyway). **Deviation from the ticket's mechanism:** it said to convert the video first with `convertForImport` and mux onto the copy, with a "Step n of m" for the extra step; the mux re-encodes instead, which is one decode and one encode rather than a full transcode (video AND an audio track the mux then discards) plus a copy, needs no scratch file, no second cancel path and no new pass label (and so no change to the renderer's `JobState` type, which is round 62's file).
- **Test.** Layer 5 "a picture an mp4 cannot carry is re-encoded, not copied": a wmv2 fixture generated in-test -> h264, yuv420p, aac, every frame decodes with nothing on stderr and none dropped; the h264 control still byte-identical in its packets; a wmv2 with a cut. `muxCodec.test.ts`: the command for each carriable and non-carriable codec, an unprobeable picture, the bar, a Cancel in the probe. **Red-first:** `FFmpeg exit 234: ... Could not find tag for codec wmv2`. **Mutations** (process.ts `b622fab8d825`): always copy -> 16 reds; an unprobeable picture copied -> 1; the probe unguarded -> the Cancel case; the cut probing anyway -> 1.
- **Lesson.** **A fix that is only exercised on the path the fixture takes is not a fix of the path.** T-107 made the original the stored truth and noted the codec risk in a comment; the bytes it could produce were never made.

### Bug (14) — a vertical clip got a wall of caption text

- **Bug.** libass draws a `force_style` FontSize at frame HEIGHT / PlayResY (288) pixels per unit, so the same Size drew text 1.78x as large, in proportion to the picture, on 1080x1920 as on 1920x1080: the default 32 wrapped a 38-character caption into a block 845 px tall, 44% of the frame (measured on a real render).
- **Fix.** `runBurnIn` probes its video; on a frame narrower than 16:9 the style also carries `PlayResY = 288 * height / (width * 9/16)` (910 for 1080x1920) and a `MarginV` scaled by the same factor (126, so the caption sits the same fraction of the way up the frame, 13.9%, as it always did), which makes libass's scale the 16:9-equivalent `width * 9/16 / 288`. libass honors `PlayResY` in `force_style` (verified on the bundled 7.0.2 and on 6.1.1). On 16:9 and wider, and when the probe fails, the style string is byte for byte what it was. `effectiveCaptionPx(fontSize, height, width?)` takes the frame (T-112 wires the panel's readout). Square (512), 4:5 (640) and 4:3 (384) are narrower than 16:9 and scale too.
- **Test.** Layer 5 "burned caption size follows the frame": the glyphs' white boxed on four mid-gray shapes, height over WIDTH within 10% of landscape's (landscape 0.0599, vertical 0.0602 measured by hand); the vertical default is a single line under 7% of the height; the margin is as high as on landscape (within 3%); 24 -> 48 is 2x on a vertical clip. Unit: `buildForceStyle` byte for byte on landscape, `PlayResY`/`MarginV` on the others; `captionPlayResY`'s scale within 0.1% of the target; `captionsProgress.test.ts` (the style handed to ffmpeg follows the probe). **Red-first:** the vertical glyph box 353 px of 1920 (18%, wrapped) against under 7%; the cross-shape ratio 6.34. **Mutations** (whisperManager.ts `3dd3b5ecfc97`): the frame not passed -> the vertical command case; the margin not scaled -> 3 unit reds and the Layer 5 margin case (`0.096` apart).
- **Lesson.** **"Percent of the picture" has an axis.** The slider was tuned on a 16:9 frame where height and width say the same thing; the first vertical clip is what says which one the text is measured against.

### The rest (3, 6, 7, 8, 9, 10, 11, 12, 15)

- **(6) The speech engine's scratch WAV is 16 kHz mono**, not 48 kHz stereo (~115 MB an hour against ~690; older `whisper.exe` builds refuse anything else). `extractAudioFromVideo(path, onChild, format)`; Audio Studio's stays 48 kHz stereo. Layer 5 ffprobes both and the byte ratio (5.5-6.5); `transcribeCancel.test.ts` reads the argv of the real extractor under `runTranscribe`. **(8) Every extraction child joins a registry** (spawn to close or error) that `cancelAllExtractions`, `cancelAllAudioJobs` and the quit sweep reach (Audio Studio's import of a recording's sound had no handle at all); `extract.test.ts` (6 mutations each named by the tests that should catch them) and a Layer 5 case that SIGKILLs a real extraction and checks its WAV goes.
- **(9) The arrival-kill left a dead job's child in `activeTranscribe`** when a Cancel landed before the extraction child existed: the wait's cleanup ran first, then the callback re-registered the child before killing it, so the next `cancelTranscribe()` reported a cancel of nothing. One `delete` after the kill; `transcribeCancel.test.ts` (mutation: the delete removed -> 1 red).
- **(10) The burn's percent is measured:** `out_time` over the length of the file (the probe's duration, or the range clipped to what the source has), 0 at the start, 99 at most, absent when unknown; the invented `5 + 0.5/s` is gone (`burnInPercent`, `burnInLengthSec`). The probe is a pre-spawn wait, so it is guarded and in the T-98 table. **(11) `video:exportBatch` is single-flight** ("An export is already running. Wait for it to finish, or cancel it, then try again."; the gate is claimed before any await and opens on success, failure and cancel; four named mutations). **(12) The preload's reframe listener says `percent?: number`**, as `api.ts` and main do (a source read, since the preload imports Electron). **(15)** the 130-column comment in `index.ts` is rewrapped, and `partialOutput.ts` names its ceiling (a share whose clock runs more than 2 s behind can keep a just-written partial).
- **Lesson.** **A registry nobody sweeps and a cleanup that runs before the thing it cleans up are the same bug**: the state exists, and the code that should empty it ran at the wrong moment. Both were found by asking what is left after the Cancel, not whether the Cancel worked.

### Decisions this round, for the next reader

- **Edge whitespace in a drawtext text is escaped, not lost, and edge newlines are dropped.** Three more lines in the escape for texts nobody can type into the field (an `<input>` takes no newline) and a leading space nobody notices; they cost one regex each and keep the pixel oracle exact.
- **The mix limiter sits at -1 dBFS on the manual path only.** A match-loudness mix has its loudnorm's -1.5 dB true-peak limit; a limiter ahead of it would only fight it.
- **The loudness target is not a reason to refuse a project**, the second track's numbers are: the first is a person's setting the next Export explains; the second can only have come from an edit.
- **Re-attach re-encodes rather than converts first** (see (13)); a long wmv costs one encode, with a bar.
- **The burn's probe failing is not a reason to refuse the burn.** The size and the bar are enhancements; a recording with no usable duration still burns, sized as landscape with an indeterminate bar.

### Found, not fixed

- Compile's recipe refusals still name their field (path-shaped, so the generic line); the burn sizes by the coded dimensions of a rotation-tagged clip (T-110(h)); the loudness box has no `min`/`max` (T-112); `convertForImport` leaves its half-written copy on failure; an odd-sized picture cannot be re-encoded for the mux (already true of a cut). Details in the coverage ledger's round-61 section.

---

## 2026-10-10 — T-102 + T-103 + T-107 + T-108 + T-109 (round 60): an install path that did not survive the exe, words that shipped in a thumbnail, a project that pointed at a second scratch folder, a Cancel that did not exist, and a zoom that grew out of a corner

The last fix round before the review gate. Five tickets, one family again: **a promise made in one place and kept (or not) in another that nothing compared.** The captions card promised a folder the portable build rebuilds on every launch; a template promised a title and posted its placeholder; a project promised a video and stored a scratch copy; a panel promised Cancel and had no button for the long job; a slider promised temperature and moved the dark corners. **This round changes ffmpeg graphs (Auto Zoom's, the grade's) and the audio extractor**, so `npm run test:media` was part of it (IMG-PREC); the transcripts are in the report.

### Bug (T-102) — the captions setup path was inside the scratch copy the portable exe unpacks every launch

- **Bug.** The setup card told people to put `whisper-cli.exe` at `process.resourcesPath/app.asar.unpacked/resources/bin`. `electron-builder.yml` does not ship that folder, and the portable exe unpacks itself to `%TEMP%` on every launch — so the folder may not exist, and a binary placed there would not survive a relaunch or an update. On the shipped build the whole captions feature could be impossible to set up while the card said otherwise.
- **Root cause.** The resolver and the card both derived the path from the app's install location, which is the one place a portable app does not control. Nothing compared "the path the card names" with "a place that outlives the process".
- **Fix.** `userBinDir()` = `<userData>/bin` (the app's own data root: user-writable, stable across launches and updates). `whisperExePath()` looks there FIRST (`whisper-cli.exe`, then `whisper.exe`), then at the old folder beside the app (a dev checkout, or a build that ships one), and a miss names the user-folder path — so the card shows a path that is real on the portable build. `ensureUserBinDir()` makes the folder lazily (mkdir recursive, failure-safe: an unwritable profile still gets an answer), whenever the resolver runs — which is when the card asks. The card says why in one line: "This folder survives app updates, so you only set this up once." **The Windows hand-test stays on the ledger**: the fix makes the documented path real; only real hardware confirms the portable exe.
- **Test.** `paths.test.ts`: the whole resolver order as a ladder of fixtures (four rungs, each case puts a file on its rung and every rung below it; the highest wins), the folder-before-name rule both ways, a miss names the per-user path, the folder is made on first ask, and a profile where `bin` is a FILE still answers. E2E ("the not-ready branch names what is missing…"): the card's first path is `<userData>/bin/whisper-cli.exe`, not under `resources`, the folder exists on disk, and the why-line is on screen. **Red-first:** 11 of 18 resolver cases against the old `paths.ts`; E2E on the HEAD build `Expected: ".../ud-captions-…/bin" Received: ".../resources"`. **Mutations** (paths.ts `a061abcbd41c`): the two folders swapped -> 4 named reds; the lazy mkdir removed -> 1 red; both restored byte-identical.
- **Lesson.** **A path you ask a user to write to must be one the app does not rebuild.** The T-89 card was careful about the file's NAME and never asked where the folder lives on the artifact that ships. And a stand-in engine at the new path is what made the transcription-cancel E2E (below) possible without a model download.

### Bug (T-103) — "YOUR TITLE HERE" shipped in a thumbnail

- **Bug.** Round 55 stripped guide layers and literal placeholders from exports, and deliberately left design-copy samples exporting ("YOUR TITLE HERE", "TUTORIAL", "Your Name", the banner schedule): an unedited one went out in the PNG a streamer posted.
- **Fix (owner ruling, refined the same day).** The first ruling was "every text layer is a hint"; it over-applied — it left the BRB scene exporting a plate with no words. **The rule is: text the person MUST replace for the export to be theirs is a hint; text that IS the card's deliverable exports as it is.** The test for each layer is "would a user plausibly ship this text verbatim ON PURPOSE?" — no means hint ("YOUR TITLE HERE", "Your Name", "@yourhandle", "Game name", the banner's schedule line, the thumbnail card's "TUTORIAL / How to do the thing / in 3 minutes", "CLIP TITLE HERE"), yes means content ("BE RIGHT BACK", "STARTING SOON", "THANKS FOR HANGING OUT", the lines under them, the emote's "POG"); the countdown's "0:00" was ruled content at first and flipped to a HINT at expedite — no stream starts at 0:00, so the user must set a real time, which is the definition of a placeholder. `asHint(...)` went on the 12 sample-text layers that were not hints (eleven in the send-back plus the flipped countdown); retyping clears the flag (T-91), so whatever a person types always exports; non-text design (plates, bars, borders, shapes) keeps exporting. **`templateTruth.test.ts` is a per-card table** — for each of the 21 templates and assets, exactly which text layers are hints and which are content — so every choice is deliberate and a text layer added to a card (or a new card) fails until the table decides which side it is on; a guard keeps a content layer from reading like a stand-in ("@yourhandle", "HERE", "Your Name").
- **Test.** `templateTruth.test.ts` (the per-card table: 8 cards red against the old data (the eight whose stand-ins exported), plus a vacuity row that there are dozens of text layers with hints and content both, a row that the four deliverables export — BRB, STARTING SOON, THANKS FOR HANGING OUT, POG — the stand-in guard, and "every non-text, non-guide layer still exports"). E2E, both directions of the one rule: "sample words stay out of the export until you type your own" — the unedited `yt-thumb-bold` exports a title box that is plain background (0 non-background pixels, with the accent bar in the same file as the positive control), and typing "MY TITLE" over it puts > 3 000 glyph pixels in the same box; and "text that IS the card's deliverable exports" — the BRB asset, opened through References -> Asset Library, exports "BE RIGHT BACK" (> 3 000 glyph pixels in the headline's box) with the handle's box plain background. **Red-first:** `Expected: 0 Received: 29528` on the HEAD build. **Mutations:** a placeholder un-hinted (templates.ts `6d708f8a4708`, yt-thumb-bold's Title) -> its table row red; BRB's words hinted (assetCatalog.ts `9b15cc70f87e`) -> its row and the deliverables row red, and the new E2E red (`Received string: "Brbhint — won't export"`); retyping stops clearing the flag (canvasStore.ts `9ec9031a136c`) -> 3 unit reds and the first E2E's second half red (`"Titlehint — won't export"`).
- **Dispositions.** The keep-a-hint control stays unbuilt (retype, or delete-and-redraw, covers it); pre-round-55 mood-board references stay as they were saved (no reliable migration).
- **Lesson.** **A blanket rule is as wrong as a regex of exceptions — decide per item, in a table, and make the table fail when the data grows.** The T-91 rule needed a regex of "placeholder" words; the first T-103 ruling made it "all text", which blanked the scene cards; the per-card table asks the one question that matters (would they ship it on purpose?) once per layer, where a reviewer can see every answer.

### Bug (T-107) — a converted video import pointed at a second scratch folder, and v3 audio had no way back

- **Bug.** Dropping an flv/ts/wmv/mpg/3gp converts it to an mp4 working copy under `%TEMP%/imagii-import`, and the video studio's source IS that copy. A saved project stored its path; the next launch pruned it; "Open project" said "Couldn't find e2e-clip-eTHEs10y.mp4" for a file the person never chose, with the original where they dropped it. The same copy leaked through a second door: Video Studio's **Clean audio** extracts from the working copy and hands THAT path to the audio studio, which saved it as the video of an extraction. And a v1-3 project whose scratch WAV had been pruned reported the WAV by its random name although the file carried the video beside it.
- **Root cause.** T-99's, one studio over: user data pointed into a temp family. The video side was filed as "check what v3 stored" and not fixed in round 58.
- **Fix.** Schema 5: `videoStudio.convertedForImport` (a boolean) says `sourcePath` is the ORIGINAL; opening converts it again (every time, T-99's rule — a path in the file is a path the file can be wrong about) behind the importer's own "Converting for editing…" toast, and a missing original is reported by ITS name through the T-84 sentence. The migration v4 -> v5 is a version bump with no data change, and an old project keeps the shape it was written in (a working copy that is still there opens; one that is gone says so). `VideoSource` carries `convertedFrom`; the importer sets it; the header and the export names use the original's name (`stream.flv`, not `stream-aB3dE5fG.mp4`). The audio side: `fromVideo.convertedFrom` rides along from Clean audio, and a saved project names the original (the working copy stays the session's `videoPath`, because re-attach muxes the h264 copy with `-c:v copy`, and an original in another codec — a wmv's — may not go into an mp4 that way). **v3 recovery:** the v3 shape DOES carry the video (`fromVideoPath`), so a pruned WAV is now extracted again from it (only when the WAV fails to load — a WAV that is still there opens exactly as before), and if the video is what is gone, the video is the file named. **The old v4 converted-video shape is NOT recoverable** (the working copy's path names nothing about its original): one documented sentence in `migrateV4ToV5`, nothing invented.
- **Test.** `projectValidation.test.ts` (schema 5: the marker, refusals by name, the path gate, v1-v4 migrate up, the marker is not invented); `ProjectIO.test.ts` (capture stores the original and no temp path; save -> prune -> reopen converts again and restores clips and captions; the validator on the way back; a moved original is named; a conversion that fails is reported; both old-shape directions; the Clean audio door; the v3 recovery both ways). E2E ("an flv is converted again when its project is opened after the working copy is gone"): drop an flv, Clean audio, save from Home (the file names the flv for both studios and holds no temp path), close the app, delete the copy AND the WAV, relaunch the same profile, Open project -> both studios load, the header says `e2e-clip.flv`, it was converted under a new name, then the original deleted -> "Couldn't find e2e-clip.flv…" naming both studios; audio.spec ("a project saved before the marker, whose scratch WAV was already pruned, is recovered"). **Red-first:** 24 unit reds on the HEAD source; E2E on the HEAD build `Received array: ["Couldn't find e2e-clip-eTHEs10y.mp4. It may have been moved or deleted. The rest of your project is open — load the video again in Video Studio and the audio again in Audio Studio."]`; audio.spec `["Couldn't find aB3dE5fG7h.wav…"]`. **Mutations** (ProjectIO.ts `cfd729b76247`): the marker ignored on read -> 4 unit reds and the E2E red (`Expected substring "Converting for editing" Received "Project loaded"` — the flv was probed fine and handed to a player that cannot play it); capture stores the copy again -> 8 unit reds and the E2E red; the v3 fallback removed -> 2 unit reds.
- **Lesson.** **Fix the class, not the instance, and look for the second door.** T-99 closed the audio door and the ticket for the video door sat for a round; and the video door had a sibling (the audio extracted from the video's copy) that no ticket named. The question that finds it is "who else is handed this path, and does it end up in a file?"

### Bug (T-108) — transcription could not be canceled, and four smaller untruths around it

- **Bug (e).** The Cancel button was drawn for the burn-in phase only and no IPC reached `cancelTranscribe` (only the quit sweep did, and it found nothing while the job was still extracting the sound). Most of a transcription of a long VOD is that first child — the audio extraction — before the speech engine exists.
- **Fix (e).** `runTranscribe` opens a run on a `CancelLatch` of its own (`transcribeLatch`, the burn-in's pattern); the extraction ffmpeg is registered in the same `activeTranscribe` map as the engine (`extractAudioFromVideo(path, onChild)` hands the caller its child; a Cancel that landed before the child existed kills it the moment it does); `run.guard` ends the wait AT ONCE; `run.check()` stands before the engine spawn. The sentinel flows through `reportFailure` (the neutral toast "Transcription canceled."), and the panel's `finally` resets the row. **`extractAudioFromVideo` now removes the WAV it was writing when it fails or is killed** (a fresh nanoid name, so the file is this call's alone — T-100's rule). New IPC `captions:cancelTranscribe` (one runs at a time, so no job id). The Cancel button shows in the `extracting` and `transcribing` phases and NOT in `building-srt` (the SRT write is instant and a Cancel there could not stop it).
- **Bugs (a)-(d).** (a) Reframe's `analyzing` event sent `percent: 0` (an invented number: now absent, the bar indeterminate, `percent` optional on the type). (b) A finished burn-in left "Done 100%" with nothing to press: single-job panels show their row only while running (Reframe, GIF, Compile), so the burn's and the transcription's rows clear when the job ends — in the `finally`, which T-100 had half-written in the `catch`. (c) Audio Studio's header showed the scratch WAV's random name for extracted audio: `AudioSource.fileName` is the video's (or the original's). (d) `video.cancel(jobId)` and `app.quit()` were exposed to the renderer (and answered in main) with no caller: deleted, and `tests/unit/deadExposures.test.ts` holds every function of `ImagiiApi` to "some renderer file reaches `<ns>.<member>`".
- **Test.** Unit: `transcribeCancel.test.ts` (the real extractor and the real runner against a fake `spawn`: a Cancel during the extraction kills THAT child, removes its WAV and never starts the engine; the quit sweep does the same; the wait ends before the child notices; a Cancel before the child exists kills it on arrival; a stale Cancel does not reach the next job; a Cancel during the engine kills it and removes the WAV; a failure nobody asked for is still a failure); `cancelSentinel.test.ts` (transcription joins the pre-spawn table with a held extraction); `reframeProgress.test.ts`; `deadExposures.test.ts` (with a discrimination block: comments and strings keep nothing alive, a same-named member of another namespace keeps nothing alive); `ProjectIO.test.ts` (the header names). E2E: "Cancel stops a transcription while the engine runs" — **a stand-in engine dropped in `<userData>/bin`** (a shell script that records its pid and sleeps; the T-102 resolver finds it, the real extraction runs, the real engine is spawned): Cancel -> neutral toast, the process is dead, the row is gone, Transcribe is enabled, no WAV left; "Cancel while the sound is still being extracted" (the 20-minute source): the engine never starts and no WAV is left; the burn rows clear; reframe's bar has no value and no "0%". Layer 5: "extracting the sound for a transcription can be stopped" (a real SIGKILL of a real extraction that has opened its file -> the file is gone). **Red-first:** transcription unit tests 8 of 8 on the HEAD source (`cancelTranscribe('j1')` returned false: the extraction child was not registered); the pre-spawn row timed out at 5 s (the wait never ended on a Cancel); E2E on the HEAD build: the Cancel button never appears for `Transcribing…`; `Expected: 0 Received: 1` progress bars after a finished burn; `app.quit`/`video.cancel` reported by the pin. **Mutations:** the extraction child not registered (whisperManager.ts `d0edb1c4a3e4`) -> 2 reds; the latch never marked -> 14 reds (the whole new table and the new file); the Cancel button removed (CaptionsPanel.tsx `5ab71512086c`) -> both E2E red; the burn's row clear removed -> the burn E2E red; `analyzing` sends 0 again (reframe.ts `6f5169034cc5`) -> red; `app.quit` back in the type (api.ts `e8397b31b973`) -> red; the extractor stops cleaning (extract.ts `9ad138fe6203`) -> the Layer 5 case red (`expected [ 'gdninuEGrA.wav' ] to deeply equal []`).
- **Lesson.** **A cancel that exists in the exported function and in the quit sweep is not a Cancel button.** The registry had the entry for a year; nothing connected the click to it, and no test asked "can the person who started this stop it?". The standing question per long job: what does the button do in each phase, and is there a phase that has no button?

### Bug (T-109) — a crop nobody could see, a zoom that grew out of a corner, and a slider for the dark corners

- **Bug (a).** `Player.tsx`'s `cropEnabled` started `false`, so a project opened with a stored crop applied it to every export while the editor showed an unchecked box and no rectangle. **Fix.** The crop is on when the person turned it on OR the selected clip has one — derived, not initialized, so it also holds after a project opens into a Player that is already mounted, when another clip is selected, and when Undo brings a crop back. The box follows the selected clip.
- **Bug (b).** Auto Zoom grew out of the top-left corner (`zoompan`'s `x`/`y` default to 0): a centered subject drifted ~24 px right and ~13 px down by 1.4 s in 1280x720, since the feature shipped. **Fix.** `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`, in the one shared builder.
- **Bug (c).** The Temperature slider set `colorbalance`'s shadows only. Measured on this machine's ffmpeg, the shadows band is gone by about 0x50 (a gray of 0x80 moves 0 levels; 0x10 moves 71) — so "warm" and "cool" changed the dark corners of a picture and nothing else. **Fix.** The same sign on the mid-tones (`rm`/`bm`, a quarter of the shadows' strength — it fills the dead zone between the two bands, which a gradient would show as a seam) and the highlights (`rh`/`bh`, half — it carries a mid-gray frame: about +36 red, -27 blue at the end of the slider). The shadows keep their old values exactly; every number stays inside `colorbalance`'s -1..1. The look of an old project shifts toward warmer or cooler across the whole picture, which is what the label always said.
- **Bug (d).** Compile's and the GIF's crop refusals were the validator's path ("segments[0].cropRect.w must be in [...]"), which `userFacingError` hides behind the generic line, while the batch said "One of this project's clips has a damaged crop — redraw it and try again." **Fix.** `assertUsableCrop(crop, channel, name)` (the T-106 wrapper, generalized) on all three paths; the detail goes to the console. (e) The USER_GUIDE line "Stream Graphics images … download without asking" is corrected to the Save dialog and the folder picker.
- **Test.** (a) E2E ("a crop stored in a project is visible when it opens"): a two-clip project, one cropped -> the box is checked, the rectangle is drawn at half the picture each way; selecting the plain clip unchecks it and removes the rectangle; back, it is checked again; unchecking removes the crop; Undo brings it back, visibly; a no-crop project opens unchecked. (b) Layer 5 ("Auto Zoom zooms about the CENTRE of the frame"): a centered marker stays centered within 2.5 px at 1.4 s in a compilation AND in a platform export, and an off-center marker moves away from the middle by exactly the zoom the same run measured (derived from the geometry, not from the expression). (c) Layer 5 ("Temperature warms and cools the mid-tones and highlights"): a 0x80 half beside a 0xd0 half; warm raises red and lowers blue on both, cool the reverse, a slight move is a slight cast; unit `filters.test.ts` (six numbers, the signs, the shadows unchanged, the ratios, the range). (d) `videoCropPayload.test.ts` (the sentence for every bad crop on both paths, the detail in the console, through Electron's envelope) and the damaged-crop E2E extended to the GIF and Compile. **Red-first:** (a) `Expected: checked Received: unchecked`; (b) `the zoomed marker is at (663.5, 373); a zoom about the centre leaves it at (640, 360): expected 23.5 to be less than 2.5` and `centre x is 995 in a 1920-wide frame`; (c) `warm mid-tone 125,125,125 vs 128,128,128: red rises: expected 125 to be greater than 143`; (d) 21 of 36 payload cases and the E2E's sentence count `Expected: 2 Received: 1`. **Mutations:** the derivation dropped (Player.tsx `7132022b3085`) -> E2E red; the zoom's `x`/`y` dropped (filters.ts `5d12d7cd110e`) -> 2 unit and 2 Layer 5 reds; temperature back to the shadows -> 4 unit and 1 Layer 5 red; the GIF's wrapper removed (video.ts `ec22a9fb13d3`) -> the GIF's ten crop rows red and Compile's green; Compile's wrapper removed -> 11 reds (its ten rows and the every-segment row) and the GIF's green.
- **Lesson.** **A control's range is a claim about the picture, not about one tone of it.** The slider was tested on the dark half because that is where the filter moved — the test was written to the implementation. The round-59 worker measured a mid-tone and found the label false; the fixture that holds it is a frame with NO shadows. And the zoom: **a transform without a pivot has the pivot the library chose** — for `zoompan` that is the corner.

### Decisions this round, for the next reader

- **Every converted import is converted again on open**, T-99's rule, although a transcode is minutes and an extraction seconds. The alternative (reuse the copy if it survives) needs its path in the file, which is the bug. A cache keyed by the original's path, size and mtime, kept outside the temp families, is the upgrade (found, not fixed, below).
- **Scene-card text exports; placeholder text does not** (the refined T-103 ruling). The judgment calls the table records: the lines under the scene titles ("Grabbing a coffee — back in a few.", "Stretch, grab water, settle in.", "See you next stream.") are CONTENT — generic enough to ship on purpose; the thumbnail card's "TUTORIAL" eyebrow is a HINT — a sample category label that only means something beside "How to do the thing"; the starting-soon card's "0:00" countdown was flipped to a hint at expedite, which makes its "to replace" description true as written.
- **Transcription's Cancel shows in two phases, not three**, and the progress row clears when ANY caption job ends (the ticket named the burn-in's finished row; the transcription's is the same state).
- **Temperature's mid/highlight strengths (a quarter, a half) are a judgment**, picked from a tonal curve measured on the linux ffmpeg; the shadows are untouched.
- **A schema bump for an optional field**, as T-99 did: an older build reading a v5 project would otherwise open an flv as if it were playable and show nothing. It refuses the file in plain words instead.
- **`video:cancel` and `app:quit` are gone from main as well as the preload**, and so is `cancelExportJob`, the per-job cancel `video:cancel` reached: it had no caller outside tests. Its rows in the sentinel tables, the batch test and Layer 5 are retargeted at the batch's Cancel (`cancelAllExportJobs`, what `video:cancelAll` calls); the "aimed at another job" row of the export runner went with the by-name cancel, and `videoExportBatch.test.ts` pins the property it carried (a click spent on nothing marks nothing) with the batch's Cancel.

---

## 2026-10-10 — T-105 + T-106 (round 59): a compilation that was not the clip, a stretch hiding in Auto Zoom, and an export that replaced the one before it

Both tickets are the wrong-file class again, which round 57's worker found and round 57's own fixes (T-96) only started
on: **a file that opens, plays and is the right size, and is not the file the person asked for.** A clip set to 2x
compiled at 1x, its color and text gone; a second GIF with the same settings silently replaced the first; a Cancel on
that second job then deleted the first's finished file with it. None of it threw. **This round changes ffmpeg filter
graphs and output names** (Compile's per-segment graph and its audio, Auto Zoom's, every runner's output path), so
`npm run test:media` was part of it (IMG-PREC); the transcripts are in the report.

### Bug (T-105) — Compile took a clip's range and its crop and nothing else

- **Bug.** Set Clip 1 to 2x, brighten it, switch on Auto Zoom or Hype Shake, give it a text overlay, add Clip 2 and press
  Compile: both clips came out at 1x, in the original color, with no text, no zoom and no shake — the sound too. The file
  was 1920x1080 and the right length for the wrong clips (4 s where the clips make 3).
- **Root cause.** The same as T-96's, one property over: a compilation segment was specified by what it TOOK
  (`{ startSec, endSec, name, cropRect }`), so there was nothing to apply, and its filter graph was a hand-built subset of
  `buildVideoFilter` (the crop chain, then a `scale`). T-96 extracted the crop stages into `cropToFrame` and stopped; the
  six other stages of "what a clip's picture is" stayed in the one function only a platform export could call.
- **Fix.** A segment is made by `buildVideoFilter` itself (`buildSegmentFilter`, concat.ts), with the compilation as the
  frame — 1920x1080, 16:9, 30 fps, a `FilterFrame` — so speed, crop, shake, scale, grade, zoom and overlays are the
  export's, in the export's order, and a stage added to the export reaches Compile with no second edit. Its sound is
  `buildAudioSpeedFilter`'s `atempo` chain (one stage covers 0.5-2.0, so 4x is 2 x 2 and 0.25x is 0.5 x 0.5), and **the
  fades are placed on the clip's length in the OUTPUT**: a 4 s range at 2x is 2 s, and a fade-out computed from the range
  started after the clip was over. What crosses the bridge is `CompileSegment` — the range, the name and `clipRecipe(clip)`,
  the six fields that decide how a clip looks and sounds — and `assertOptionalClipRecipe` checks every one of them at the
  boundary, because every one becomes filter-graph text (speed 0.1-10, a grade inside what `eq` and `colorbalance` accept,
  boolean flags, overlays through `isValidTextOverlay`). Overlay windows are rebased by the segment's own start, as for an
  export: each segment is its own ffmpeg run with its own clock, so a neighbor's text never leaks across.
- **Test.** Layer 5, "a compiled clip is the clip the user built", all against the decoded output: speed at 2x, 4x, 0.5x and
  0.25x (each stream's own length; the ramp's picture clock; where the 1.5 s audio burst lands, which IS the tempo because
  `atempo` keeps the pitch), a source with no sound, grade (brightness raises every channel of both halves, saturation 0
  collapses the blue's channels, temperature moves the SHADOWS — read on the dark half, because `colorbalance` barely touches
  a mid-tone), Auto Zoom (the marker grows 1.037x by 1.4 s and is 1.0x on the first frame), Hype Shake (the first frame is
  ~6 px off center, the neighbor is dead center), the fade on a 2x clip (picture and sound), and everything at once. Text
  overlays are proven by the T-74 drawbox stand-in generalized to `runConcat` (three clips: both overlays at 1x, one at 2x,
  a plain one that must not inherit text), a win32-gated real-drawtext twin, and a linux pin in which the real runner dies
  naming `drawtext` WITH the overlay and renders WITHOUT it. Unit: `concat.test.ts` (a segment's graph is byte for byte the
  export's at the same geometry; stage order; fades at 1x/2x/0.5x/4x; the tempo before the fades), `filters.test.ts`
  (`buildAudioSpeedFilter` at 0.25/0.5/1/2/4 and every chain's product), `validators.test.ts` and `videoCropPayload.test.ts`
  (every recipe field refused by name before the runner is touched), `clip.test.ts` (`clipRecipe` carries every field a
  `Required<Clip>` has except the five listed as not part of the recipe — a field added to `Clip` fails the typecheck of that
  file until someone decides). E2E: "compilation: each clip is compiled as the clip it was built" (speed slider, Brightness,
  Auto-zoom, + Add clip, Compile: 3 s not 4, the sound 3 s, Clip 1 brighter than Clip 2 at the same source moment).
  **Red-first against the HEAD build and source, quoted:** 18 of 18 new Layer 5 cases red (the T-106 ones included) on the
  untouched source —
  `2x: the compilation: 7.024 s, expected 4 s` (and 9.0 / 3.0 / 2.0 s for 4x / 0.5x / 0.25x), `bright gray 47,47,47 vs
  47,47,47`, `the marker is 160px beside the control's 160px at 1.4 s`, `the shaken marker is at (639.5, 359.5); the
  control's is dead centre`, `"LOWER THIRD" paints red at x=0.1,y=0.85 (0 red px at t=1)`, the pin `promise resolved … instead
  of rejecting`; E2E `Expected: < 3.2 Received: 4.024`. **Mutations** (python content replace, count == 1, byte-identical
  restores, sha prefixes): (a) `clipSpeed` hardcoded to 1 (clip.ts `b3cef81de98d`) -> 22 unit reds in six files and 10 Layer 5
  reds — the four speed rows, the silent source, the fade, the whole recipe, the 2x overlay window and the two PLATFORM-export
  speed cases that were already there — with grade, zoom, shake and the drawtext pin correctly green; (b) the tempo dropped from
  Compile's audio alone (concat.ts `dd2a3124d61d`) -> 4 unit and 6 Layer 5 reds (`the sound (4 s at 2x): 4.022 s, expected 2 s`),
  so the sound path is pinned apart from the picture's; (c) the fade-out computed from the range (same file) -> 4 unit reds and
  `the picture is mostly faded out 0.1 s before the clip ends (128)`; (d) a hand-written speed read put back in `export.ts`
  (`27290c560425`) -> the structural scan red, naming `main/ffmpeg/export.ts:66`; (e) Compile's recipe dropped from the panel
  (CompilationPanel.tsx `aa9b30dce434`, built into the app) -> the compile E2E red (`Received: 4.024`); no unit test can see the
  panel, which is why that E2E exists.
- **Lesson.** **A shared concept needs a shared builder, not a shared helper for its first stage.** T-96 found that "what a
  manual crop means" had three implementations and shared one stage of it; the finding was right and the extraction stopped
  one function short. The question that finishes it is "who else makes THIS file from a clip?" — and the answer is the
  builder, called with a different frame. Second: **a fade's position is a time in the OUTPUT.** Any filter that follows a
  speed change (fades, overlay windows, the zoom's clock) lives in output time, which is why the tempo comes first in the
  audio chain and the overlay windows are divided by the speed.

### Bug (T-105, found by its own test) — Auto Zoom stretched every clip it touched

- **Bug.** An Auto Zoom export of a 2 s, 30 fps clip was 2.4 s long; of a 60 fps clip, 4.8 s — the picture running slow
  against a sound that kept its real length, and every text overlay after the zoom on the wrong clock. Since Auto Zoom
  shipped. Compile would have inherited it the moment it carried Auto Zoom, and the concat demuxer would have drifted the
  sound a fifth of a second per zoomed clip.
- **Root cause.** `zoompan` ignores its input's timestamps: it emits `d` frames per input frame and stamps them at ITS OWN
  `fps`, which defaults to 25. The round-18 fixes made the filter parse and size correctly (`time` for `t`, an explicit
  `s`); nothing measured its LENGTH, because every existing Auto Zoom case asserted dimensions.
- **Fix.** One token in the one builder: `fps=N` ahead of `zoompan` (so a 60 fps source and a sped-up clip are resampled by
  timestamp) and `:fps=N` on it, with N the rate the encoder writes (`-r`), so the filter is one frame in, one frame out.
  This is **outside the ticket's text** and is flagged as a deviation: it is a change to a platform export's graph, made
  because carrying Auto Zoom into Compile faithfully meant carrying a defect, and a "faithful" desync is not a feature.
- **Test.** Layer 5 "Auto Zoom keeps a clip's length whatever the source frame rate" (30 and 60 fps, an export and a
  compilation, each stream's length) — red on the HEAD source for the export alone (`30 fps export: the picture: 2.4 s,
  expected 2 s`) — and "pulses on the clip clock". Unit: `filters.test.ts` (the `fps=N,zoompan=...:fps=N` pair for every
  preset's own rate). **Mutation:** the pair removed (filters.ts `a2ed0ecedb59`) -> 3 unit reds and 2 Layer 5 reds
  (`30 fps export: the picture: 2.4 s, expected 2 s`, `the compilation: 4.422 s, expected 4 s`). **Lesson.** **A test that
  asserts a filter's size and not its length passes a stretch.** Measure the
  dimension the filter is *for* and also the one it must leave alone.

### Bug (T-105) — the GIF warning counted source seconds, the speed rule had four copies, the Compile card had no verdict

- **Bug.** (a) A 20 s range at 3x makes a ~7 s GIF and was told it would "get huge"; a 6 s range at 0.5x makes a 12 s GIF
  and was not. (b) "A missing, zero or negative speed is 1x" was written out in `runExportJob` twice, `buildVideoFilter`
  and `outputDurationSec` (and a fifth, differently, in the store's setter, the slider's readout and its "is this clip
  pristine" check); the copies disagreed about `Infinity`. (c) A 9:16 crop in a 1920x1080 compilation keeps the middle 32% of
  its height, which the export grid says in words for a platform; the Compile card said nothing until the file was written.
- **Fix.** (a) The warning is `outputDurationSec({ range, speed: the panel's own select }) > 10` — the T-97 shape, with the
  select's value. (b) `clipSpeed(clip)` (`@shared/clip`) is the only reading; every copy now calls it. (c) The Compile card
  lists one row per clip, and each row IS the grid's verdict: `SuccessIndicator` with `COMPILE_TARGET` (the compilation as an
  export target: 1920x1080, 16:9, no length to be too long for), so the words are the grid's by construction.
- **Test.** E2E: "gif: the 'over about 10 s' warning counts the GIF that will be written" (a 14 s clip: warned at 1x and 0.5x,
  not at 1.5x, 2x, 3x; a 6 s clip: not at 1x, warned at 0.5x), "compilation: each clip has a verdict row in the grid's own
  words" (Great / Wrong shape with the exact sentence the YouTube tile shows, Clip 2's row did not move, cleared -> Great).
  Unit: `presets.test.ts` (`COMPILE_TARGET`), `tests/unit/clipSpeedOneReading.test.ts` — a syntax-tree scan that fails on
  any read of `.speedMultiplier` outside the file that defines `clipSpeed`, allowing only a hand-over (`{ speedMultiplier:
  seg.speedMultiplier }`), with a discrimination block over the shapes the four copies took. **Red-first:** the GIF E2E
  `Expected: 0 Received: 1` (the warning still showing at 2x), the
  verdict E2E `Expected: 2 Received: 0` (no list); mutation (d) above for the scan.
- **Lesson.** **Count the copies before the fourth reader arrives.** The ticket that found four copies in round 57 was
  right to say "extract one"; the structural scan is what makes the fifth copy a failing test instead of a review comment.

### Bug (T-106) — an export replaced the one before it, and a Cancel then deleted it

- **Bug.** `<source>_<w>px_<fps>fps.gif`, `<source>_compilation.mp4`, the template's name for a platform export,
  `<source>_reframe-WxH-position.mp4`, `<source>_pip.mp4` and a Clip Kit's `<clip>-kit-<date>` folder are all functions of
  their settings, and every runner passed `-y`. The next job with the same settings replaced the last without a word: a second
  GIF of another part of the clip, a re-ordered compilation, two clips with the same name in one batch. **And T-100 made it
  worse**: a canceled job deletes the file it was writing, so a Cancel on a job that shared a path with a finished export
  deleted the finished export.
- **Root cause.** No runner ever asked whether the name it wanted was free. The platform export had the same gap as GIF and
  Compile (the ticket's "follow what the platform export does" had nothing to follow); T-100's cleanup assumed the path was the
  job's alone.
- **Fix.** `nextFreePath(wanted)` (`main/ffmpeg/outputPath.ts`): `name.ext` if nothing is there, else the first free
  `name (2).ext`, `name (3).ext` — a gap is filled before a higher number is used, `lstat` so a dangling link counts, bounded at
  9999 with a plain sentence. Every runner that writes into a folder the user chose calls it inside `run.guard` — a platform
  export, GIF, a compilation's join, reframe, and picture-in-picture, which therefore **gained a run** (the round-58 note "PiP
  has no run" is no longer true: it now waits before it spawns) — and uses the path it returns for ffmpeg, for the cleanup of a
  stopped job and for the result the panel reveals. `makeKitDir` numbers the kit's FOLDER (`{ directory: true }`: a kit is a set,
  and a half-new half-old folder would be worse than either). The check and the write are two steps (`// simplification:` in
  the helper, with the upgrade path: `-n` instead of `-y`).
- **Test.** Unit: `outputPath.test.ts` (free name; taken; 1..n; a gap; past 9 and 99; dots in a name; no extension; a name that
  already ends in a number; a folder and a dangling link count; a missing parent is not an error; the folder mode; `makeKitDir`
  twice), `cancelSentinel.test.ts` (every runner that names its output is told to write BESIDE a file that is there, a Cancel
  removes its own file and leaves the earlier export, the compilation's join, a Cancel landing while the name is being chosen for
  every runner incl. PiP). Layer 5 "an export never replaces a file that is already there": three runs of each of GIF, compile,
  export (template name and default name) and reframe with DIFFERENT content under one name -> three files named `x`, `x (2)`,
  `x (3)`, each earlier file byte for byte what it was; "a canceled job beside an earlier export of the same name leaves that
  export alone". E2E: "a second GIF, compilation and export … land beside the first and never over it, and each panel points at
  the file it wrote" (the toast's and the row's "Show in folder" deliver the numbered path), "a second Reframe and a second
  picture-in-picture … land beside the first" (red under mutation (f) on a built app, its polls cut to 15 s on a throwaway copy),
  "a second kit of the same clip on the same day lands in its own folder". **Red-first:** Layer 5 `gif:
  ramp_160px_10fps.gif is what run 1 wrote, after run 2` (and the same
  line for compile, export and reframe; PiP joined the block after the HEAD run and fails the same way under mutation (f)), and
  `the earlier export is still there: expected false to be true` for the cancel case; E2E: the second GIF's `(2)` file and the
  second kit's folder never appear (a 9-minute poll each). **Mutations:** (f) `nextFreePath` returns its input (outputPath.ts
  `021560b202e4`) -> 20 unit reds (every naming runner's "writes beside" and "a Cancel leaves the earlier export", the join, the
  kit's folder, the helper's own table) and 6 Layer 5 reds; (g) the GIF runner alone stops calling it (gif.ts `8d26e6117d14`) -> 4
  unit reds (its two output rows and the two name-wait Cancel rows) and 2 Layer 5 reds, with compile, export, PiP and reframe
  green — each runner is pinned on its own; (h) `makeKitDir` back to `mkdir(recursive)` (frame.ts `5748578cc827`) -> its unit
  case red.
- **Lesson.** **A cleanup that removes "the file this job was writing" is only safe if the job's path is its own.** T-100's
  proof of ownership was "newer than the spawn" — true of a rewritten earlier export. Making the name unique is what turns
  the cleanup from "probably yours" into "yours".

### Bug (T-106) — `video:exportBatch` took a crop nobody checked

- **Bug.** `assertOptionalCropRect` gated Compile and the GIF; the platform export's batch checked the overlays and not the crop,
  so a hand-edited project's `cropRect` reached `crop=` unchecked and came back as "Export failed. imagii's video tool stopped…".
- **Fix.** `validateExportJob` runs the same validator and refuses the WHOLE batch before the first job's probe, with one sentence
  `userFacingError` stands behind: "One of this project's clips has a damaged crop — redraw it and try again." The validator's own
  message (a path into the payload) goes to main's console. Compile's and the GIF's path-shaped refusals are unchanged (found, not
  fixed, below).
- **Test.** `videoExportBatch.test.ts` (nine malformed crops, one plain sentence, no probe, no child; a bad crop on the SECOND job
  refuses the first; the sentence survives Electron's envelope and `userFacingError` unchanged; the control). E2E: "a hand-edited
  project with a damaged crop is refused in plain words … and redrawing the crop fixes it" (Open project -> Export -> the sentence,
  Failed row, nothing written; Crop + 16:9 -> the same Export works). **Red-first:** E2E `Received: ["Project loaded",
  "Export failed. imagii's video tool stopped
  before it finished. Check that the source file still plays and the folder has room, then try again."]`. **Mutation** (i) the
  call removed from `validateExportJob` (video.ts `2a309c6c0aba`) -> 10 named reds in `videoExportBatch.test.ts` (nine crops and
  the later-job case) and the E2E red again on the mutated build.
- **Lesson.** **A validator applied to the two new callers is a validator the old caller still lacks.** The same
  search-the-callers-of-the-input rule as T-96.

### Decisions this round, for the next reader

- **Numbered suffix, not a timestamp.** The ticket allowed either, and the platform export had no convention to follow
  (it had the same gap). `name (2).ext` is how Explorer names a copy, keeps the name the person's template chose recognizable, and
  cannot make a name of one job depend on the clock. A gap in the numbering is filled before a higher number is used.
- **The kit's FOLDER is numbered, not its files.** With only the runners fixed, a second kit of the day would have mixed
  `Clip_1_reels (2).mp4` with thumbnails and a caption file that `-y` still replaced — half old, half new. A kit is a set, so the
  set gets the number.
- **Reframe and PiP are fixed too, although the ticket names two outputs.** "Outputs never silently overwrite" is the acceptance
  criterion and `_reframe-…mp4` and `_pip.mp4` are the same bug. PiP needed a run to do it properly (choosing the name is a wait
  before the spawn, and T-98's rule is a guard around every such wait), which is the one structural cost of the fix.
- **Auto Zoom's timing is fixed inside T-105** (see its entry): carrying a stage into Compile means carrying its defects, and
  this one only shows up when its LENGTH is measured. Deviation from the dispatch direction, which expected structure-only
  assertions for zoom and shake.
- **Compile segments are validated field by field; `video:exportBatch` still checks only overlays and the crop.** The new
  payload fields are new trust-boundary input and are held to `assertOptionalClipRecipe`. Applying the same function to the batch
  would change what a hand-edited project's export does for a bad grade or speed (they reach ffmpeg as a number's digits or a
  TypeError, never as filter text), so it was left as its own decision.
- **The GIF does not take the clip's speed, grade or effects.** It has a Speed select of its own and the ticket asked only that
  the warning read it. A GIF of a 2x clip at the panel's default 1x is 1x.
- **No `-n` for ffmpeg.** `nextFreePath` is check-then-write (documented as a `simplification:`); `-n` instead of `-y` on the
  final output would make "never replace" structural even against a race, at the cost of turning that exit into a retry. Nothing
  in the app can race today.

---

## 2026-10-10 — T-98 + T-99 + T-100 + T-101 + T-104 (round 58): a Cancel that landed where nothing was alive, a project that pointed at scratch, the wreckage a stop leaves, five dead actions, five raw colors

The last fix round of the content wave, and its five tickets are one family: **a control or a file that
says one thing and means another, in a place no test was looking.** A Cancel that was honored only if it
happened to land on a live child; a project that stored a path the app itself deletes; a "canceled" job that
left a real-looking `.mp4` in the folder its toast sends you to; store actions that no control calls; hex
literals in two panels the color-sync test could not see. None of them threw. **This round touches
`src/main/audio` and `src/main/ffmpeg` (the cancel and cleanup paths of every runner, no argv or filter
changed), so `npm run test:media` was part of it (IMG-PREC)**; the transcripts are in the report.

### Bug (T-98) — a Cancel pressed where there was no child to kill canceled nothing

- **Bug.** Press Cancel on a batch in the instant between two of its jobs and the batch carried on: every
  remaining file was written, and the toast said "Export canceled. Files already finished are in your
  folder." Press Cancel on Reframe, a cropped GIF, a compilation or the highlight scan in the first moments
  and the job ran to the end and saved its file under a "canceled" toast. Clip Kit's Cancel only ever reached
  its export batch: the last few seconds of every kit — three thumbnails — were beyond it, and a click in
  the gap between the kit's calls did nothing at all.
- **Root cause.** Every cancel function looked the job up in a map of LIVE ffmpeg children and killed what
  it found. A runner registers its child at the spawn, and nearly every one waits before it: a platform
  export, a compilation, a cropped GIF, a reframe and the scan probe the source; the next job of a batch
  begins with that same probe; a frame extract makes its folder; a ranged burn-in reads its SRT. A Cancel
  that arrived in the wait found an empty registry, returned `false`, and was forgotten. T-84 made a cancel a
  FACT main knows ("the kill was ours"), and applied it only where a kill happened; the click is the user's
  decision, and where it lands in a run is none of their business. (The probe is ~40 ms wide, which is why
  the existing cancel tests — each clicks Cancel as soon as the button shows — passed for years: they were
  racing a window that nearly always closed first.)
- **Fix.** `src/main/ffmpeg/cancelLatch.ts`: a runner opens a RUN for as long as it works
  (`latch.begin(jobId)`, `end()` in its `finally`). Every cancel function marks the open runs it is aimed at
  — by name (`cancelGifJob(id)`) or all of them (`cancelAll…`, the quit sweep) — as well as killing children.
  `run.check()` is the last look before a spawn, and before each queued job of a batch; `run.guard(work)`
  wraps a pre-spawn await and a Cancel ends that wait AT ONCE (it does not wait the probe out — a probe of a
  file on a slow share can take seconds), and work that fails after a cancel reads as the cancel. Both throw
  the T-84 sentinel, so `reportFailure` needed no new case. Runs: export (per job, and one per batch held by
  `video:exportBatch`), GIF, compile, reframe, the scan, frame extract (joined to `video:cancelAll`, so the
  kit's cancel reaches the thumbnails), audio export and re-attach, and the caption burn-in. **The run ends
  with its job, so a stale Cancel cannot reach the next one** — pressed with nothing running, it marks
  nothing, and a boolean flag (the first design) would have killed the next job (mutation c below).
  `ClipKitButton` keeps a flag of its own, because the kit is four calls the RENDERER sequences and between
  two of them nothing runs in main to cancel.
- **Test.** Unit: `cancelLatch.test.ts` (15: by name, all, empty name, stale cancel, same-name successor,
  guard races, no unhandled rejection); `cancelSentinel.test.ts` grew a pre-spawn table over nine runners
  (a held probe — the real runners against a fake child — cancel each way, probe FAILS after the cancel still
  reads as the cancel, no child ever spawned; the control spawns; a stale cancel and one aimed at another job
  leave it alone) plus the compilation's list-file write; `src/main/ipc/videoExportBatch.test.ts` makes the
  Cancel happen INSIDE `e.sender.send('video:jobComplete')` — after job 1, before job 2 — which is the gap,
  not "near" it. E2E (`video-pipelines.spec.ts`): "a Cancel pressed between two jobs of a batch stops the
  rest" holds the second job's ffprobe for 8 s with `tests/e2e/mainSpawn.ts` (a `child_process.spawn` wrapper
  installed in MAIN; nothing in `src/` changes) and asserts the spawn log is exactly `ffprobe, ffmpeg,
  ffprobe`, one file, a Canceled row, and that the toast arrived well inside the hold; "a Cancel pressed
  before the job's ffmpeg exists still cancels Reframe, a cropped GIF, Compile and the highlight scan";
  "Cancel during the thumbnails reaches them"; "a Cancel that lands between two thumbnail calls still stops
  the kit" (the extract handler is replaced in main by one the test holds). Layer 5 (real ffprobe, cancel
  issued in the same tick as the call): export, cancelAll, cropped GIF, reframe, compile, scan, audio, frame.
  **Red-first against the HEAD build, quoted:** `Received: ["Video loaded", "Exported 2 files"]` (the batch),
  `Received: ["Video loaded", "Saved your Clip Kit"]` (both kit cases), `Received: ["Video loaded", "Saved the
  vertical version Show in folder"]` (Reframe, canceled and saved), 14 of 14 Layer 5 cases red, 45 cancelSentinel
  and 4 of 6 batch unit cases red. **Mutations** (python content replace, count==1, byte-identical restores,
  `cancelLatch.ts` `8b6fe858f731`): (a) `check()` never throws -> 13 named reds (the batch gap x3, the
  compilation join x2, the ranged burn-in x2, six latch cases); (b) `end()` leaves the run open -> the two
  stale-run cases red; (c) a boolean latch — `cancelAll` leaves a flag the next `begin` obeys — -> **112 reds**
  (the stale-click cases, and the whole sentinel table, whose `beforeEach` sweeps every registry).
- **Lesson.** **A Cancel is a latch scoped to a run, not a call that must land on a live child.** Anything
  that waits before it acts is a window the click can fall into, and "the app promised it" is a reason to
  close the window, not to shorten it. Second: **scope the latch to the run, not to the family** — a flag per
  family would cancel a sibling job, and a flag that outlives its run cancels the next one (mutation c is the
  proof the tests discriminate it). Third: **do not aim a test at a 40 ms window — widen it.** Wrapping
  `spawn` in main to hold the probe turned a race the suite had passed for years into a state the test
  creates; the spawn log then proves the strong claim ("no encoder was ever started"), which "no file
  appeared" cannot (a slow job satisfies it too).

### Bug (T-99) — a project that extracted audio from a video pointed at a file the next launch deletes

- **Bug.** Drop a video on Audio Studio (its sound is extracted to a WAV), save the project, and come back the
  next day: "Couldn't find aB3dE5fG7h.wav" — a name the user never chose, for a file they never saw, with the
  video it came from sitting in the same project.
- **Root cause.** The extraction writes `%TEMP%/imagii-audio/<nanoid>.wav` and the audio studio's source IS
  that path; `captureProject` stored `audio.source.filePath`. `pruneStaleTempFiles` removes files older than
  six hours at launch. User data pointed into a temp family; the video path was right there
  (`fromVideoPath`) and was only used to remember to offer "Re-attach to video".
- **Fix.** Schema 4: an extraction is stored as the VIDEO plus `extractedFromVideo: true`, and opening it
  extracts the sound again (a missing video fails inside the extractor and is reported as the file that is
  gone, in the T-84 voice). A plain audio file is stored as it always was. The old shape is read as written —
  a v3 project whose scratch WAV is still there opens, one whose WAV is gone says so exactly as before; the
  migration is a version bump and does not invent the marker. `fromVideoPath` is now held to the path gate on
  read (it reaches `ffmpeg -i` on export).
- **Test.** `ProjectIO.test.ts` (save stores the video and the marker and no path into the temp folder;
  save -> prune -> reopen extracts again and restores the chain; a moved video is the file reported;
  both old-shape directions), `projectValidation.test.ts` (schema 4, the marker, migration without it, the
  unsafe `fromVideoPath`). E2E (`audio.spec.ts`): drop a video -> save from Home -> close the app -> delete the
  scratch WAV -> relaunch the same profile -> Open project -> the waveform plays and Re-attach is ticked; then
  the video moved -> "Couldn't find e2e-clip.mp4…". **Red-first (HEAD):** the saved file's `sourcePath`
  `Received: "/tmp/imagii-audio/F7BRlapFIv.wav"`; 8 `ProjectIO` unit cases and 9 validation cases red.
  **Mutations** (`ProjectIO.ts` `276a83138ceb`): marker ignored on read -> 3 unit reds and the E2E red (`Re-attach
  to video` never checked: the studio loaded the video as if it were a sound); capture stores the file again
  -> 5 unit reds.
- **Lesson.** **User data never points into a temp family: store the source and derive the scratch.** The bug
  was invisible for a day by construction (the prune is six hours old files at launch) — the only test that
  catches it models the next launch, so the E2E closes the app. And note what was NOT done: the WAV's path is
  not stored "as a hint" for reuse, because a path in the file is a path the file can be wrong about.

### Bug (T-100) — what a stop leaves behind: half-written files, red Cancels, rows for jobs that are gone

- **Bug.** (a) A canceled or failed export, GIF, reframe, compilation, audio render or burn-in left its
  half-written output under the right name, unplayable (an MP4's moov atom is written last), in the folder the
  toast calls "finished". (b) A Canceled queue row kept the danger-red bar under its neutral label. (c) The
  audio Export row had no Failed/Canceled word. (d) The captions progress row froze at "Burning in… 40%" with a
  Cancel button for a job that no longer existed — and a failed transcription left a bar sliding forever.
  (e) The audio export's measure and render passes each restart the bar at 0, which reads as a stall.
  (f) Clip Kit's toast read `SRT not bundled (source SRT not found)`. (g) The waveform readout printed
  `pcm_s16le`. (h) Reframe's row printed the phase id, upper-cased: `ANALYZING`.
- **Root cause.** T-84 gave a stop its words and left the state a stop leaves untouched, field by field:
  nothing in a runner's failure path knew the file was its wreckage; the row color was set from "has an
  error", not from "which kind"; the audio dialog never stored what stopped it; the captions `catch` raised the
  toast and left `progress` alone; the label table keyed on the id; the SRT toast interpolated main's `reason`
  (a fragment written for a log); the readout printed whatever ffprobe said.
- **Fix.** (a) `ffmpeg/partialOutput.ts`: each runner calls `discardPartialOutput(outputPath, spawnedAt)` from
  its failure path, after the child has exited. **The guard is the point:** a path is removed only if the child
  was actually spawned AND the file is not older than the spawn (minus 2 s for FAT's coarse stamps) — ffmpeg
  truncates its output when it OPENS it, well after the spawn for a slow input, so a Cancel before that leaves
  last week's export of the same name exactly as it was. Deleting unconditionally (the first draft, and the
  T-59 convert's convention) is data loss in a batch with a deterministic filename and no overwrite prompt.
  Earlier jobs' files are never touched: each job knows only its own path. (b) a Canceled row's bar is
  `bg-ink-muted`; Failed stays red. (c) the audio dialog stores `error`/`canceled` from `reportFailure` and
  draws the same two words. (d) the captions `catch` clears `progress` (burn-in AND transcription).
  (e) `audioPassPlan` / `audioPassLabel`: "Step 1 of 2 — measuring loudness", "Step 2 of 2 — rendering",
  "Step 2 of 2 — attaching to video" for a re-attach; a single pass says "Rendering…". (f) the SRT toast goes
  through `userFacingError` with "Couldn't include captions in the kit." (g) the codec id is gone from the
  readout (sample rate and channels stay). (h) `reframePhaseLabel`, keyed by the phase union.
- **Test.** `partialOutput.test.ts` (real files: spawned/never spawned, older than the spawn, FAT slack, a
  folder at the path, a sibling's file stays); the `cancelSentinel.test.ts` output rows for eight runners and the compilation's join (a cancel
  under both exit shapes, a failure, a stale file left alone, the control keeps its file); `audio.test.ts`,
  `reframe.test.ts`. E2E: "Cancel mid-encode leaves no half-written file, and the job that finished before it
  keeps its file" (two clips of the 20-minute source; `Received +1` file on HEAD), the multi-job cancel test
  (neutral bars, `Expected: 3 Received: 0` on HEAD; every file left is a real video), "the Export row names
  its steps, and says Failed or Canceled after the toast fades" (driven from main on the real
  `audio:progress` channel; HEAD `Received string: "Measuring loudness…0%"`), "Cancel in the render pass leaves
  no half-written file", "a canceled or failed burn-in puts the progress row back…" (`Expected: 0 Received: 1`
  progress bars; and a failed transcription), "captions that cannot come along say so in plain words"
  (HEAD: `SRT not bundled (source SRT not found)`), the waveform readout in the import test. Layer 5: a real
  SIGKILL mid-write for export, GIF, reframe, audio and burn-in — **14 of 14 Layer 5 cases red on HEAD**
  (`the half-written export is gone: expected true to be false`). **Mutation** (gif.ts `6c89771ad734`): the
  GIF runner's unlink dropped -> 3 named reds in the sentinel table and the real-ffmpeg GIF case red.
- **Lesson.** **A stop has a state, and every field of it needs an owner.** Giving the stop words (T-84) was
  the visible half; the file, the bar's color, the row, the label each hid in a different file. Second: **an
  automatic delete needs a proof that the thing is yours** — "did this run write it" (spawned, not older than
  the spawn) is what separates cleaning up from data loss, and the unit table has a case for each direction.
  Third: **a row that shows a running job must stop showing it when the job stops** — reset in the `catch`
  that already knows.

### Bug (T-101) — store actions and an IPC nothing called

- **Bug.** `videoStore.addClipFromRange` had unit tests and no caller; `recording.save` (the buffered save the
  streaming protocol replaced) was exposed through the preload and `api.ts` with no caller.
- **Root cause.** Code kept alive by the tests that prove it works. The ticket's criterion was general ("no
  exported store action without a caller survives"); looking for the named one found four more of the same
  (`setSelectedPresets`, the audio store's `resetChain` and `updateCutRegion`, the canvas store's
  `setBackground` and `setCanvasSize`).
- **Fix.** Deleted, by the ladder's first rung (does this need to exist?): the six actions; `recording.save`'s
  handler, its preload wiring, its `api.ts` type and the `RecordingSpec` type; `appendRange`'s now-constant
  flag. The range rules `addClipFromRange` shared with the scanners' add are pinned where the product reaches
  them (`videoStore.test.ts`, retargeted at `addScannedClip`). A future "add this range as a clip" control is
  a feature ticket with its own coverage.
- **Test.** `tests/unit/deadActions.test.ts` reads each store's state interface and fails on any function
  member no renderer file (other than the store's own, tests excluded) names as an identifier — comments do not
  keep an action alive — with a discrimination block. **Red-first (HEAD):** `[ 'addClipFromRange', … ]`,
  `[ 'resetChain', 'updateCutRegion' ]`, `[ 'setBackground', 'setCanvasSize' ]`. Mutation: the action put back
  in the interface -> the video-store case red.
- **Lesson.** **When the criterion is a rule, scan for the rule, not the example.** The ticket named one
  action and the rule found six; the structural test is what stops the seventh.

### Bug (T-104) — five raw colors in two panels, where the sync test could not see them

- **Bug.** `HighlightPanel` drew its Chat and Hype signal bars in `#f472b6` / `#fbbf24` and `SafeZoneOverlay`
  its 9:16 / 1:1 / 4:5 guides in `#f472b6` / `#fbbf24` / `#22d3ee`.
- **Root cause.** The colors-from-tokens rule was enforced by review and by `designTokensInSync`, which
  compares the two token files with each other — it cannot see a hex that was never put in either.
- **Fix.** `#fbbf24` IS `EMBER` to the byte, so both uses moved onto the existing token. The other two are
  `SIGNAL_PINK` / `SIGNAL_CYAN` (`tokens.ts` + `tailwind.config.js`, mirrored, contrast pinned on all three
  surfaces: 7.3:1 / 10.7:1 on `bg-base`, the lowest 6.3:1 on `bg-hover`). The values are the ones already on
  screen. Two more raw literals the scan found are documented exceptions (OutputPreview's `#000` matte, which
  the E2E suite compares against; the overlay editor's `#ffcc00` typing example).
- **Test.** `tests/unit/noRawHex.test.ts` parses every renderer source and fails on a string holding a hex
  color, outside `styles/tokens.ts` and the documented exceptions (listed by file or by exact literal, with a
  case that an exception holds only in its own file); `designTokensInSync.test.ts` gained the signal pair, its
  distinctness (four guides, four hues) and its contrast. **Red-first (HEAD):** the scan fails exactly the two
  files, 2 + 3 literals. **Mutations:** the exception allowed in any file -> the exactness case red; a raw hex
  put back in `HighlightPanel` -> that file's case red.
- **Lesson.** **A rule a test can only half-see is a rule with a hole the shape of every file the test does
  not compare.** The cheap structural scan (syntax tree, strings only, comments exempt) closes it for good, and
  its allow-list is a visible edit to the file and to the guide.

### Decisions this round, for the next reader

- The batch holds a run of its own although a job's run would catch the same Cancel nearly everywhere: between
  two jobs there is no macrotask, so today the gap is the probe — but the batch run is what makes "jobs not yet
  started do not start" true if anyone puts an `await` between jobs, and `videoExportBatch.test.ts` proves it at
  the exact point.
- A project always RE-EXTRACTS an audio-from-video source on open rather than reusing a surviving WAV: reuse
  needs the WAV's path in the file, which is the bug. The cost is one extraction (seconds, I/O-bound).
- PiP has no run: it spawns in the same tick the handler runs, so there is no wait for a Cancel to fall into. (Superseded in
  round 59: T-106 made it choose a free output name first, which IS such a wait, so PiP holds a run now.)

---

## 2026-10-10 — T-96 + T-97 (round 57): a crop that stopped at the export grid, and a grid that judged the file instead of the picture

Both tickets are the stragglers of round 50. T-83 made a manual crop "the frame an export starts from" and
fixed `buildVideoFilter` and the grid's SHAPE check; a worker's report said the idea had not reached every
place that already knew a clip's crop. Neither bug produced a broken file or a red error: a GIF and a
compilation opened, played, and were the size they were asked to be, and a green "Great" was printed
beside a picture that would be scaled up 2x. Every one of those surfaces was telling the truth about a
clip it was not exporting. **This round touches ffmpeg filter graphs** (Compile's per-segment graph and the
GIF's), so `npm run test:media` was part of it (IMG-PREC); the transcripts are below.

### Bug (T-96) — a clip cropped to 9:16 was compiled and GIF'd at the full frame

- **Bug.** Draw a 9:16 crop, press Export GIF: the GIF is the whole 16:9 frame. Compile the same clip: the
  whole frame again, and anything that was not 16:9 (a 4:3 source, a phone recording) was STRETCHED to
  1920x1080 by a bare `scale=1920:1080`. The Export panel next to them cut the same crop correctly.
- **Root cause.** The crop-is-the-new-frame chain lived inside `buildVideoFilter`, so the only way for a
  runner to use it was to be a platform export. The two other runners that cut a clip out of a source were
  specified by what they TOOK: `video:concat` segments carried `{ startSec, endSec, name }` and
  `video:exportGif` took no crop at all, so there was nothing to apply and each built its own graph from
  scratch. T-83 grepped for callers of the function it was fixing; the bug was in the callers of the
  *concept* (a clip's crop) that were not callers of the function.
- **Fix.** The crop stages are one function, `cropToFrame(cropRect, source, targetAspect)` (filters.ts),
  extracted from `buildVideoFilter` byte for byte, with THREE callers (the T-82 `keepExpression`
  precedent): a platform export; `buildSegmentFilter` (concat.ts: the clip's crop, then a centered cut of
  it to the compilation's 16:9, then the same normalizing `scale`); and `buildGifFilter` (gif.ts: the crop
  first, then `fps`, `scale=W:-1` and the palette; `targetAspect: null`, because a GIF keeps the shape the
  user drew). The payloads carry the clip's `cropRect` (`CompilationPanel` per segment, `GifPanel`);
  `assertOptionalCropRect` (shared/validators.ts) refuses a string, `NaN`, a rect with no area or one
  outside the frame at the IPC boundary, before any ffmpeg is spawned — the numbers become `crop=` filter
  arguments. Main probes the source's size itself (a platform export does the same); an uncropped GIF
  starts no extra process and its graph is byte-for-byte what it was.
  **One behavior change beyond the ticket, flagged for the owner:** `cropToFrame` has no "only when
  cropped" branch (T-83: "the no-crop path is the same call with the whole source as the frame"), so an
  UNCROPPED segment whose source is not 16:9 is now cut to 16:9 around the middle instead of stretched. A
  16:9 source's graph is unchanged. By the usability tiebreaker a stretch is the worse default, and
  keeping it only for uncropped clips would mean drawing a crop of the whole frame changed the output.
- **Test.** Layer 5 (`media.spec.ts`, "a cropped clip compiled or GIF'd keeps its crop (real ffmpeg,
  T-96)"): a black 1920x1080 frame with a RED block every crop excludes and a white SQUARE at every crop's
  centre. Compile: a cropped segment beside an uncropped one for a 4:3 crop, a 9:16 crop and a 16:9 control
  — the cropped half contains no red at all, its white square is square (0.97-1.03), the hand-derived size
  (the cut's full width onto 1280) and centered, and the uncropped half still has its red (the control); plus
  an uncropped 4:3 source that comes out un-stretched. GIF: 4:3 and 9:16 crops come out in the crop's shape
  with no red, the marker square, and an uncropped GIF beside each still has the red. **Red-first against
  HEAD's ffmpeg sources, quoted:** `the crop excludes the red block, but 17956 red pixels came out` (compile,
  all three crops), `marker came out 240x180 (expected a 240px square)` (uncropped 4:3), `the crop excludes
  the red block, but 1154 red pixels came out` (GIF, both). Unit: `filters.test.ts` (`cropToFrame` in both
  modes, and `buildVideoFilter` starts with its stages for every preset), the new `concat.test.ts`
  (`buildSegmentFilter`) and `gif.test.ts` (`buildGifFilter`, an uncropped graph byte for byte, the crop's
  place after `setpts` and before `fps`), `validators.test.ts` (`assertOptionalCropRect`) and the new
  `src/main/ipc/videoCropPayload.test.ts` (both handlers refuse ten malformed crops before the runner is
  called, and pass a good one through). E2E (`video-pipelines.spec.ts`): "gif: the crop drawn for the
  clip reaches the GIF" (1:1 crop through the real Crop control -> a square GIF with no red; cleared ->
  320x180 with red) and "compilation: every clip keeps the crop it was drawn with" (Clip 1 cropped, Clip 2
  not: no red in the first 2 s, the red block back in the next 2 s). Both red against the HEAD build:
  `Received: 1600` / `Received: 58549` red pixels where 0 was expected. **Mutations**, python content
  replace, count==1, byte-identical restores: (a) `buildSegmentFilter` stops calling `cropToFrame`
  (concat.ts `b7dd46394526`) -> 6 unit reds and the 4 Layer 5 compile cases red (`17956 red pixels came
  out`), the 2 GIF cases and `gif.test.ts` green; (b) `buildGifFilter` stops calling it (gif.ts
  `4e9e1ea22828`) -> 5 unit reds and the 2 Layer 5 GIF cases red (`1154 red pixels came out`), compile
  green — the two paths are pinned independently; (c) each IPC gate removed (video.ts `e8704e671234`) -> 10
  and 11 named reds in `videoCropPayload.test.ts`.
- **Lesson.** **When a fix lands in one consumer of a shared concept, search for the other consumers of the
  INPUT, not of the function.** "Who else cuts a clip out of this source?" finds `concat` and `gif`;
  "who calls `buildVideoFilter`?" never could. Second: **assert what an output LEFT OUT.** A frame the
  right size and length is no evidence a crop happened; a colour that is present in the control and absent
  from the output is. The fixture needs a region the crop excludes, a shape that keeps its proportions, and
  the same call uncropped beside it, so a test cannot pass because the marker was never visible.

### Bug (T-97) — a quarter-frame crop was "Great" at 1080p, and a 2x clip was "Too long" at half its length

- **Bug.** The export grid's "picture is smaller than this output" check read the FULL source's size, so a
  crop a quarter of a 4K frame (1080p of picture) ticked for a 1080p platform said "Great" while the export
  scaled it up 2x. And every duration check (the grid's "Too long" and sweet-spot reasons, Clip Kit's
  long-clip question) read SOURCE seconds and ignored the clip's speed: a 6-minute range at 2x is a 3-minute
  file, and it was warned against Reels' 3-minute limit as though it were six.
- **Root cause.** `evaluateSuccess(platform, clipDuration, sourceWidth, sourceHeight, cropAspect)` took five
  numbers the CALLER had to get right, and T-83 corrected only one of them (the aspect, from `cropFrameSize`).
  The size and the length were the same kind of mistake, one argument over. `platformsOverLimit(durationSec,
  presets)` took a bare number for the same reason, so the kit's question and the grid's verdict agreed on
  the limits and not on what they were limits ON.
- **Fix.** The verdict takes the CLIP: `evaluateSuccess(platform, clip, sourceWidth, sourceHeight)` reads the
  frame through `cropFrameSize` (the one reading of "the picture an export starts from", used for the aspect
  and now the resolution check, in whole pixels so a crop drawn as a fraction does not fail by a rounding
  hair) and the length through the new `outputDurationSec(clip)` (the range divided by the speed, a
  missing, zero, negative or non-finite speed being 1x, as the encoder reads it). `platformsOverLimit(clip,
  presets)` takes the clip too, so the grid and the kit cannot disagree about the file's length, and the
  kit's question quotes that length ("This clip is 3:00"). The reason reads "The picture is smaller than this
  output — it will be scaled up and look soft" (it said "will be enlarged", and named neither the cause nor
  what the viewer would see).
- **Test.** Unit (`presets.test.ts`, `clipKit.test.ts`): a small crop of a big source is soft and the same
  source uncropped says nothing; each platform judged on its own size; a custom preset on ITS size; the
  whole-pixel rounding both ways; a probe with no size never throws; `outputDurationSec` at 0.5x / 1x / 2x
  and for a nonsense speed; and a limit walked at 0.5x / 1x / 2x against Reels' 180 s on both sides of the
  boundary (360 s at 2x is not over, 360.2 s is), for the grid, for Clip Kit, and for both against each other
  across all five platforms. Existing grid cases kept their assertions and moved to the clip signature.
  E2E: "a crop smaller than the output says the picture will be scaled up and look soft" (a 1920x1080 source;
  the 16:9 crop button -> YouTube "OK" with the reason, X and Facebook still "Great", cleared -> "Great"),
  "the grid judges the length of the file at the clip's speed" (a 300 s source: Reels "Too long" at 1x, gone
  at 2x with the 1:30 sweet-spot reason in its place, back at 0.5x), "a 9:16 clip over TikTok's sweet spot at
  1x is inside it at 2x" (OK -> Great), and "the long-clip question quotes the length of the file" (the kit
  asks about 5:00 at 1x and starts without a question at 2x). **Red-first against the HEAD build:** the
  YouTube tile never reached "OK" with the crop, Reels still read "Longer than the typical 3-minute limit" at
  2x, TikTok never reached "Great", and at 2x the kit raised the modal (its button never reached "Exporting 5
  platform versions…"); against HEAD's `presets.ts` / `clipKit.ts` the new unit file fails 30 cases (about
  half of them from the signature, which is why the mutations below are the discrimination proof).
  **Mutations** (byte-identical restores, `presets.ts` `6882f2883be6`): (a) the speed division dropped ->
  8 named unit reds across `outputDurationSec`, `evaluateSuccess` and `platformsOverLimit`, and 3 of the 4
  T-97 E2E cases red (the soft-crop case stays green); (b) only the resolution comparison reading the source's
  size again -> 4 unit reds and the soft-crop E2E red, every T-83 case green.
- **Lesson.** **Hand a verdict the thing, not the numbers read off it.** Five numeric arguments are five
  chances for the caller to read the wrong field, and each of the three bugs here (aspect, size, seconds)
  was one of them. The function that decides "does this fit" should be given the clip and read what it needs
  through the shared helpers, so a new property that matters (a speed, a crop) is one change in one place.
  And **a limit is a limit on the OUTPUT**: every threshold in the grid is about the file the person will
  upload, which is the clip's range at its speed, in the crop's frame.

## 2026-10-09 — T-92 (round 56): one name per idea, a plural that read wrong at 1, a button on a two-second toast, and a score that could not reach its own scale

One ticket from the content review, the last planned copy round of the wave. The thread
through all of it: the same fact was written by hand in several places (a studio's name, a
noun's plural, a button's label, a scale's top) and nothing made the places agree. The
sweep is wide (about thirty files); the five bugs below are the ones with a mechanism, and
the rest is held by `tests/unit/copyConventions.test.ts` reading every string a person can
see. **Nothing here touches ffmpeg**: no filter, argument or chain changed, so
`npm run test:media` was not part of this round (IMG-PREC applies to those changes only).

### Bug (T-92) — four names for the studio, five for a found moment, and a diary that was a log

- **Bug.** Stream Graphics was "Image Canvas" on Home's last-undo line, in the README,
  FOR_MIKE and HOW_IMAGII_WAS_MADE. A found moment was a "candidate", a "hype moment", a
  "Highlight N" and a "Chat hype N"; the chat panel was a "Chat highlight reel". The posting
  log was a "diary" in its toasts, errors and list header. Corners were "Top L / Bot R" in one
  panel and "Top left" in the next; "Rect" sat in the toolbar above a status line that said
  "Tool: Rectangle"; "copy", "+ clip", "open folder" and "✕ delete" were the lowercase
  outliers; the Player's "Safe zones" were crop guides.
- **Root cause.** A name was typed wherever it was needed, so there was no single place to be
  wrong in — and the E2E suite repeated each string a second time, which made the old name
  *load-bearing*: five assertions read `last: Image Canvas`, and one test pinned "Rect"
  against "Rectangle" in the same loop.
- **Fix.** `docs/BRANDING_GUIDE.md` gained "Copy conventions" (the canonical-name table,
  sentence case, the four destruction verbs, toast punctuation, voice, dismiss labels). The
  renderer was swept to it: Stream Graphics everywhere, Smart highlight finder / Chat spike
  finder / highlight / chat spike, Posting log ("Logged posts (N)" for the list), spelled-out
  corners and shapes, `Copy` / `+ Clip` / `Open folder` / `Delete`, **Crop guides**, hashtag
  packs named for people ("Instagram Reels, general", not `ig_reels_general`). Dialect: US
  spelling, and "check" a box, never "tick" it (the tutorials said "Tick" five times).
- **Test.** `tests/unit/copyConventions.test.ts` (new) parses every renderer source and runs
  its rules over the strings a person reads (JSX text, copy attributes and properties, toast
  and confirm arguments, the strings a JSX expression chooses between — never an identifier, a
  comment or a comparison): the retired names, `(s)`, unspaced units, cut-short words, "done"
  on a toast, British spelling, "tick", the first person, an exclamation mark, a lowercase
  button or panel header, a bare "Show" button, an "Esc" / "Done" dismiss button, a trailing
  period on a one-sentence result toast. Its discrimination block runs the scanner over the copy
  that shipped and over copy that must pass. **Run against HEAD's source it fails 35 ways**
  (`AutosaveRestore.tsx:138 [a result toast with a trailing period] "Autosave discarded."`,
  `PipPanel.tsx:57 ["done" as a completion word] "PiP done."`, `ChatHighlightPanel.tsx:111
  ["Chat highlight reel" …]`, `PipPanel.tsx:144 ["Top L" / "Bot R" …] "Top L"`…); green after.
- **Lesson.** **A name needs one owner and a scanner that reads what the screen shows.** A
  grep of the source cannot tell `'sustained-loud'` the id from `sustained-loud` the label,
  and a test that repeats a string freezes it — the fix for the second is the same as for the
  first: one table, one scan, and tests that find a control by what it is (its role and
  accessible name), not by a phrase that was a mistake the day it was copied.

### Bug (T-92) — "1 clip(s)", "Found 1 candidates", "5 msgs", "3 day(s) ago", "1 cut region(s)"

- **Bug.** Six hand-written plurals read wrong at 1 (and two E2E assertions pinned the
  wrong text: `'Close this video? 1 clip(s) and their edits will be discarded.'`). One more,
  `audioCloseMessage`, began its sentence in lower case ("Close this audio? your cleanup
  settings…").
- **Root cause.** `countOf` (round 50) existed; each site predated it or never met it.
- **Fix.** Every site goes through `countOf`: highlights, chat spikes, messages, clips, cuts,
  items, days, templates, running jobs. The audio close sentence capitalizes its list.
- **Test.** `copyConventions.test.ts` bans `\w(s)` in anything rendered and pins the
  `countOf(...)` call at each of the ten sites the review and the sweep found (a pin of the
  call, not the output — the output is `plural.test.ts`'s). The two E2E assertions that
  pinned the bug now pin the singular.
- **Lesson.** **A helper only prevents the bug at the call sites that use it.** The scan is
  what turns "we have `countOf`" into "no number meets a noun without it".

### Bug (T-92) — a success toast carried the only way on, and lasted two seconds

- **Bug.** GIF, picture-in-picture, reframe and compilation raised `toast.success` holding a
  bare "Show"; Record's held "Show" and "Edit in Video Studio". react-hot-toast removes a
  success toast after 2 s. Look away and the way to the file was gone. The completion verb
  was whatever the panel's author felt like: "PiP done.", "GIF saved.", "Vertical version
  saved.", "Clip kit ready".
- **Root cause.** Five hand-built copies of the same toast, none with a duration.
- **Fix.** `lib/savedToast.tsx`: `toastSaved(message, outputPath, extra?)` — one sentence with
  no trailing period, "Show in folder", `ACTION_TOAST_MS` (8 s). Messages are now "Saved the
  GIF", "Saved the picture-in-picture video", "Saved the vertical version", "Saved the
  compilation", "Saved your Clip Kit", "Saved 12.3 MB". The inline "Show" beside a finished
  Export / audio-export row is "Show in folder" too (one name for the control).
- **Test.** Unit, `savedToast.test.tsx`: the duration is `ACTION_TOAST_MS` (>= 8000), the
  toast's buttons are exactly `['Show in folder']` (and `['Show in folder', 'Edit in Video
  Studio']` for Record), and the button's click reveals exactly the path it was given.
  E2E (`expectRevealToast`): PiP, reframe, GIF and compilation each find "Show in
  folder" on the toast, wait 3.5 s (past the 2 s default), find it still there, press it,
  and assert the shell (stubbed in main, `tests/e2e/shellReveal.ts`) received exactly the file
  that was written. **Red-first against the HEAD build**: `Error: "Show" is still there 3.5 s
  later` for the GIF flow. `copyConventions.test.ts` fails on a bare "Show" button and pins the five panels
  to the helper.
- **Lesson.** **A toast is a notification, not a place to keep a button.** If an action is
  worth offering, it outlives the default; and a duration that lives in five call sites is
  five chances to omit it.

### Bug (T-92) — a bare "192" was saved as 192 bits per second

- **Bug.** The custom-preset form took "V bitrate" / "A bitrate" with no unit anywhere.
  ffmpeg reads a bare number as BITS per second, so the "192" a person meant as kilobits
  saved an audio rate nothing could hear, and "8000" video was 8 kbps. (Also: to ffmpeg a
  lowercase `m` is *milli*, and the validator accepted it — "8m" encodes at 0.008 bits/s.)
- **Root cause.** The form validated that a bitrate was *parseable* (T-50) and never asked
  what unit it meant.
- **Fix.** `normalizeBitrate(raw, kind)` in `shared/customPresets.ts`: a bare number is
  kilobits per second (the unit the field's own examples teach) and is saved with its `k`;
  a bare number over 100,000 is refused with the spelling that works ("5000000 is too big to
  be kilobits per second. Write 5M instead."); `m` becomes `M`, `K` becomes `k`; every
  accepted value passes `isValidBitrate`, the gate main applies again. The form writes the
  understood value back into the field, labels the fields "Video bitrate (e.g. 8M)" /
  "Audio bitrate (e.g. 192k)", and says what M and k mean. `formatBitrate` prints "8 Mbps" /
  "192 kbps" in the saved list (and reads a legacy bare number the way ffmpeg does).
- **Test.** Unit, red-first against a stub with today's behavior: **9 failed**
  (`expected { ok: true, value: '192' } to deeply equal { ok: true, value: '192k' }`,
  `expected { ok: true, value: '8m' } to deeply equal { ok: true, value: '8M' }`,
  `expected true to be false` for 5000000). E2E, red-first against the HEAD build: the saved
  file held `"videoBitrate": "8000"` where `"8000k"` was expected. Mutation: the auto-suffix
  returns the text unchanged -> 3 named unit reds, byte-identical restore (`ea70ebdb4a39`).
- **Lesson.** **A unit-less field needs a rule for its unit, applied at the door and shown
  back.** Normalize on entry, put what was understood on screen, and keep the strict gate at
  the trust boundary — the form is the friendly half, `validateExportJob` the safe one.

### Bug (T-92) — highlight scores stopped at 40 without a chat log

- **Bug.** The panel's score chip says "Combined score (0–100)". With no chat pasted, the
  chat and hype weights (0.4 + 0.2) multiplied zeros, so the loudest possible moment scored
  `1 x 0.4 = 40`. Every scan without chat topped out at 40 and read as mediocre. Its fallback
  reason was the scanner's own id ("sustained-loud").
- **Root cause.** A weighted average whose denominator was the sum of ALL weights, not the
  weights in play; the 0–100 was a label, not a property.
- **Fix.** `scoreHighlights` divides by the weights actually in play: audio alone when no
  chat messages exist, all three when any do ("chat present" means messages exist, not that
  they scored — a log that is silent at a moment weighs against it). The fallback reasons are
  "Loud peak" and "Long loud stretch"; the other reasons are capitalized.
- **Test.** Unit, red-first, 9 failed (`expected 0.4 to be close to 1`, `expected 2 to be less
  than or equal to 1`): an audio-only score IS the audio signal at every loudness, the old
  score was audio x 0.4 (pinned, so the change is visible), chat-present weights are
  unchanged, weights that do not sum to 1 still stay in 0..1. E2E: the rescoring test now
  walks 100 (no chat) -> 40 (chat that says nothing about this moment) -> 100 (chat that does)
  -> 100 (cleared). Mutation: drop the division -> 5 reds, byte-identical restore
  (`d36868c6f255`).
- **Lesson.** **A scale printed on the screen is a promise the arithmetic has to be able to
  keep.** And a test that pinned the broken ceiling ("= audio x 0.4") was the clearest
  statement of the bug anyone had written.

### Bug (T-92) — the export checkbox's name was a paragraph

- **Bug.** Round 50 (T-83) moved each platform's reason text *into* its `<label>` so it
  would be visible. A label is a name: a screen reader read "YouTube 1920×1080 OK Under the
  1-minute sweet spot · 25% of the picture's height is trimmed to fit this shape · Picture is
  smaller than this output — it will be enlarged, checkbox" for one tick box.
- **Root cause.** "Visible" and "associated" were treated as one decision; wrapping the
  text in the label achieved both and cost the name.
- **Fix.** The label wraps the checkbox and the platform's name (and the Custom tag) only;
  the size line ("1920×1080 · 30 fps" — the export IS 30 fps, and now says so; a custom
  preset shows its own rate) and the verdict sit beside it as the checkbox's description
  (`aria-describedby`). The label's `::after` is stretched over the card, so the whole
  tile is still one hit area; the input is lifted above it (`relative z-10`) because Playwright
  (rightly) refuses to click a box whose label overlay "intercepts pointer events".
  `PlatformInfo.fps` joins the renderer table, and `presetTablesInSync.test.ts` holds it to
  main's.
- **Test.** E2E, red-first against the HEAD build: `getByRole('checkbox', { name: 'YouTube',
  exact: true })` found 0 (the names were the paragraphs above); green: each of the five has
  exactly the platform as its accessible name and "1920×1080 · 30 fps" / the verdict in its
  accessible description, and a click on the size line still toggles it. The T-83 grid test
  finds a tile by the checkbox it holds (`[data-export-target]`).
- **Lesson.** **Say what a thing is called and what it is like in different places.** ARIA
  gives them different slots (name, description); visible text that is part of the
  description does not belong in the label to be seen.

### Bug (T-92 send-back) — a toast card caught the click meant for the button under it

- **Bug.** After the 8-second action toasts, `image.spec.ts` "emote pack: … ONE folder dialog"
  timed out clicking Export: `<div role="status">Emote pack saved (3 PNGs: 28, 56, 112)</div>
  from <div data-rht-toaster> subtree intercepts pointer events`, 56 retries over 30 s. A user
  could not press any control under a live toast.
- **Root cause.** react-hot-toast draws every card with `pointer-events: auto` (and its
  wrapper's `> * { pointer-events: auto }`), and pauses a hovered toast's timer — so a card over
  the Export button took the click, and a pointer resting on it kept the card alive. The
  emote-pack toast is a plain 2 s `toast.success`, not one of the 8 s toasts: **the same test
  fails against a clean HEAD build in isolation** (checked: `git archive HEAD`, same
  `intercepts pointer events`, same timeout), so T-92's 8 s duration made a latent bug four
  times longer rather than causing it. It passed in the full suite only because where the
  pointer rests moves with run order.
- **Fix.** `AppToaster`'s `TOAST_STYLE` sets `pointerEvents: 'none'` on every card (an inline
  style beats the library's class rule); the one control meant to be pressed opts back in
  (`pointer-events-auto` on the "Show in folder" / "Edit in Video Studio" buttons in
  `lib/savedToast.tsx`), which also keeps a toast up while it is pointed at. One place, so
  every toast shares it; no other toast has interactive content. The emote-pack toast stays a
  plain `toast.success` (it saved to a folder the user picked, but the image saves — "PNG saved",
  "Saved 4 thumbnails", the pack — have no reveal button, and their E2E asserts the exact text).
  Cost: a card can no longer be hovered to pause, so a long error toast is not held open by
  the pointer.
- **Test.** The failing emote-pack E2E goes green unchanged (32.8 s timeout -> 3.0 s).
  `AppToaster.test.tsx` pins `pointerEvents: 'none'` on the mounted element; `savedToast.test.tsx`
  pins `pointer-events-auto` on every button. E2E `expectToastClickThrough` (run on each of the
  four saved toasts) presses the toast's own padding and asserts the click landed on something
  that is not the toaster. **Mutation** (`pointerEvents: 'auto'`): the unit pin goes red
  (`expected 'auto' to be 'none'`), the emote-pack test times out (`intercepts pointer
  events`) and the GIF flow fails `the click reached the control under the toast, not the
  toast`; restore byte-identical (`da8ea4bfacc2`).
- **Lesson.** **A transient surface must never take input it does not need.** Duration and
  pointer capture multiply: lengthening a toast without making it click-through turned a rare
  2 s annoyance into an 8 s wall. And a test that passes only in a particular order is
  reporting the pointer's position, not the product's behavior.

### Smaller fixes with the same root

- **Dismiss labels** were Esc, ✕, Close, Done and Cancel across five dialogs. Every dialog
  with nothing to decide now has ONE dismiss control reading "Close": the shortcuts overlay
  (its Esc hint is its footer), Templates (the footer "Cancel" went — it duplicated the
  header's), Custom export presets (the footer "Done" went), Thumbnail variants, the audio
  wizard. A dialog that asks a question keeps its verb + "Cancel".
- **Destruction verbs** crossed between a button and its confirm: the preset list said
  "Remove preset" and asked "Delete preset"; Layers said "Delete" while the shortcuts dialog
  said "Remove"; the autosave banners said "Discard" and "Clear" for one call. Delete = a
  saved thing (asks first), Remove = an item in what you are editing (undoable), Clear =
  emptying what stays, Discard = something never saved. The posting-log entry's delete (which
  had no confirm and no undo) now asks.
- **Compilation hid until the second clip**, so nobody with one learned it existed; the card
  now always renders and says "Add a second clip to compile." with its button disabled.
- **Jargon and units:** the hook badge's tooltip no longer says "LUFS"; the player reads
  "30 fps · video h264 · audio aac"; GIF width and frame rate carry "px" and "fps"; PiP
  fields say "(px)"; the chat panel's "Bucket sec" / "Pad sec" are "Spike window (s)" and
  "Extra seconds around each clip"; the color panel says its sliders have no preview.
- **Test.** `copyConventions.test.ts`, E2E assertions beside each panel, `units.test.ts`
  for `formatFps`, `interactionWiring.test.ts` for the Close and Clear pins.
- **Lesson.** **One concept, one control, one word.** Two buttons that dismiss one window
  are two chances to disagree; the cheaper fix was deleting one.

## 2026-10-09 — T-90 + T-91 (round 55): a summary that was not what Apply did, a preset that carried last week's cuts, and a "saved" toast raised before anyone had saved

Two tickets from the content review. T-90 is Audio Studio saying one thing and doing
another in four places (the wizard's list, the presets, the loudness picker, the AAC
export), plus the engineer's vocabulary the panels were built from. T-91 is Stream
Graphics promising things its pixels did not keep (a "saved" toast, a "9:16" well, a
facecam hole that shipped in the file). Same root both times: a sentence and the
code under it were written separately and nothing made them agree.

### Bug (T-90) — the wizard's list was its own arithmetic, and "Start over" closed the dialog

- **Bug.** The Fix Wizard's last card printed "Highpass + 60 Hz hum reduction: off" for a
  talking recording in a quiet room, and Apply then switched the highpass ON. "Start
  over" closed the dialog (Close's job). The card said "I'll set".
- **Root cause.** The list was computed inline in the JSX from the answers
  (`noise !== 'none'`); the settings were computed in `applyResult` from the answers
  (`noise !== 'none' || use === 'voice'`). Two derivations of one decision, one line
  for what are two settings.
- **Fix.** `audio-studio/fixWizard.ts` (new, pure): `fixPatch(answers)` builds the patch
  ONCE; `fixSummary(patch)` renders one creator-words line per setting FROM that object
  ("Quieter background: on (aggressive)", "Low rumble removal: on", "Hum removal: off",
  "Softer harsh 's' sounds: on", "Even volume: on (target −16)"); the component builds
  the patch once and hands the same object to both the list and `patchChain` — the T-82
  `keepExpression` precedent. `restart()` resets the steps and answers and keeps the dialog
  open; `close()` (Close, Esc, scrim, Apply) resets and closes. The card speaks as imagii.
- **Test.** Unit: `fixWizard.test.ts` runs all 18 answer combinations and holds each line
  to the patch field it describes, pins the quiet-room-voice case, and shows that changing
  one patch field changes exactly its line. `interactionWiring.test.ts`: one `fixPatch(`
  call in the component, no `answers.backgroundNoise` read there, Start over bound to
  `restart` which never calls `onClose`. E2E (`audio.spec.ts` "Fix Wizard…"): Start over
  leaves the dialog open on question one (and a different run gives a different summary);
  the voice-in-a-quiet-room card says rumble on / hum off and the panels agree after Apply.
- **Lesson.** **If a screen shows what will happen and a button does it, they read one
  object.** A summary computed beside its action is a second implementation that happens to
  agree today.

### Bug (T-90) — a cleanup preset carried one recording's cuts and music

- **Bug.** "Save current" wrote the whole chain, so a preset saved on Monday held Monday's
  cut times and the path to Monday's music, and Apply put both on Tuesday's recording.
- **Root cause.** A preset was typed as a `ChainSpec`; the chain is cleanup settings AND
  that recording's edit (`cutRegions`, `secondaryTrack`), and nothing separated them.
- **Fix.** `@shared/audioPreset`: `CleanupSettings = Omit<ChainSpec, 'cutRegions' |
  'secondaryTrack'>` and `cleanupSettings(chain)`. Main's `savePreset` writes it (so the cut
  times and the music path never reach disk), `parseChainPreset` normalizes through it (so a
  file an older build wrote is read back without them), and the panel's Apply patches
  `presetPatch(p)` = `cleanupSettings(p.chain)`. `ChainPreset.chain` is typed
  `CleanupSettings`. The panel says what a preset keeps. `savePreset` / `deletePreset` sit in
  a `try` and route a failure through `reportFailure` (they were unhandled rejections).
- **Test.** Unit, red-first: `audioPreset.test.ts` and `PresetPanel.test.ts` (an OLD-SHAPE
  fixture applied through the real store) failed 6 ways against today's whole-chain
  behaviour (`expected [ { startSec: 400, endSec: 450 } ] to deeply equal [ { startSec: 3,
  endSec: 4.5 } ]`, `expected { …(5) } to be null`); `presets.test.ts`: the file on disk has
  no `cutRegions`/`secondaryTrack` and does not contain the music's name, and listing an old
  file drops both. E2E: save with a cut and a music bed on screen (file has neither), apply
  (this recording's cut and bed untouched); an old-shape file on disk applies its cleanup and
  nothing else; ENOSPC from main's handler toasts "Couldn't save that preset. Your disk is
  full…" and keeps the typed name. The three E2E fail against the HEAD build.
  Mutation: `savePreset` stops stripping -> the named `presets.test.ts` case, byte-identical
  restore (`d45c57e88bc9`).
- **Lesson.** **Type the thing you mean to keep.** A preset typed as the whole chain keeps
  whatever the chain holds next year; the narrower type turns "what belongs in a preset"
  into a compile error instead of a review comment. And fix BOTH ends: stop writing it, and
  stop believing the old files.

### Bug (T-90) — the loudness picker could not stay on its second −14 row

- **Bug.** YouTube/Spotify and TikTok/Reels were two rows with the same −14. Choosing the
  second wrote −14, the picker looked the number up, found the FIRST row and snapped back.
- **Root cause.** A select whose value is `find(target)` over a table with a duplicate key.
- **Fix.** One row per distinct number ("YouTube, Spotify, TikTok, Reels (−14)"); the table
  is exported. The developer note ("fixed at −1.5 dBTP this round") became the creator
  explanation; `loudnorm`, `LUFS` outside parentheses, `highpass`, `de-ess`, `sidechain` and
  `mux` left every string a user reads.
- **Test.** `LevelsPanel.test.ts`: every row survives the round trip (the property that rules
  the class out), one row per number. `tests/unit/audioStudioCopy.test.ts` reads the audio
  studio's syntax trees (JSX text, attribute values, toast arguments, copy-named properties —
  not identifiers) for the banned words, and proves on a bad snippet that it discriminates.
- **Lesson.** **A lookup that inverts a table needs a table with unique keys — and a test
  that round-trips every row.** And a vocabulary rule is only a rule if a test reads the
  strings the user reads.

### Bug (T-90) — 60 Hz only, AAC as a bare `.aac`, and a re-attach export that threw before its dialog

- **Bug.** Hum removal was fixed at 60 Hz (a notch at the wrong grid removes nothing). The AAC
  option saved a raw ADTS `.aac`. And, found while writing the m4a test: **every export from a
  video threw before the Save dialog opened** — the Export panel asks `audio:suggestOutputName`
  and `audio:pickOutputFile` for the format `mp4` when "Re-attach to video" is ticked (the
  default), and both validated against the four audio formats only. The call was outside any
  `catch`, so the button looked fine and did nothing.
- **Root cause.** The format set was named once for exports and reused for save dialogs that
  take a fifth value; Layer 5 drove `runAudioReattach` directly, so no test ever went through
  the IPC the button uses.
- **Fix.** `ChainSpec.humHz?: 50 | 60` (absent = 60, so every saved project and preset means
  what it meant); `humFrequency()` accepts only the literal 50 and returns 60 for anything else,
  because the value is interpolated into a filter string. A "Power-line frequency" picker
  appears with hum removal and relabels the box. `AUDIO_SAVE_FORMATS` adds `mp4`;
  `audioFileExtension('aac')` is `m4a`, used by the dialog's filter, the suggested name and the
  Export panel's label "AAC (.m4a)". The codec arguments are unchanged — only the container
  around them. The save is wrapped and reported. Phase names are plain words ("Measuring
  loudness…", "Rendering…", "Attaching to video…"), and the first phase is the measuring pass
  when loudness is on. With parts removed, the panel says the picture is re-encoded.
- **Test.** Layer 5, red-first: "hum removal notches the mains the user chose" exports a pure
  tone at 50, 60, 100, 120 and 1000 Hz through each setting and asserts the tone's own level —
  against the fixed-60 chain it failed `50 Hz setting should remove the 50 Hz tone (dropped
  0.1 dB)`; "AAC exports as a real .m4a container" asserts the codec is still aac at 48 kHz,
  `format_name` contains `m4a`, the file opens `ftypM4A `, and the same encode named `.aac` is
  headerless `aac`. Unit: `chain.test.ts` (graph per setting, a hostile `humHz` can never reach
  the string), `audioSaveFormat.test.ts` (the real handlers: `aac` -> `.m4a`, `mp4` opens a
  dialog — 4 cases fail against HEAD, 2 of them the mp4 rejection). E2E: the AAC option asks for
  and writes a real m4a; a video drop exports through Re-attach with a cut, the picture and
  sound both shorter, and the phase label reads "Attaching to video…"; a saved preset carries
  `humHz: 50`.
- **Lesson.** **Test the path the button takes, not only the function it eventually calls.**
  The re-attach job was proven for a year; the call that reaches it was never made. And a
  setting that becomes part of a command string is validated at the string, not only at the
  edge.

### Bug (T-91) — "PNG saved" was raised before any dialog had answered

- **Bug.** Export, the emote pack and the variants dialog clicked a hidden `<a download>` and
  toasted success in the same tick. A canceled Save dialog still got "PNG saved"; the emote
  pack meant three dialogs; "Save all 4" said "Saving 4 variants…" first.
- **Root cause.** `<a download>` hands the file to the browser and reports nothing back, so the
  renderer had nothing to wait for — and the E2E harness drove it through `will-download`,
  which cannot be canceled from a test, so the cancel path was unreachable by construction.
- **Fix.** `image:save` and `image:saveMany` (main/ipc/image.ts): main opens the native Save
  dialog (or ONE folder picker for a set) and writes the bytes, answering only afterwards —
  the path / `{dir, count}`, or `null` for a cancel. The renderer toasts success on a non-null
  answer, says nothing on `null`, and routes a rejection through `reportFailure`. The data URL
  is untrusted now: `main/imageSave.ts` requires the declared format's magic bytes, caps the
  size before decoding, and reduces names to a safe leaf. The emote pack is one folder picker
  writing three files; Scale is disabled for it with the reason on screen. "Save all (3 +
  original)" and "Saved 4 thumbnails" replace the count that did not match "Generate 3".
- **Test.** E2E, red-first against the HEAD build (a canceled download still toasted):
  `TOASTS=["PNG saved"] COMPLETED=[]`. New: a canceled Save writes nothing and raises no toast;
  saved raises it only once the file exists; an unwritable folder is "Export failed…" and never
  "saved"; the emote pack is one folder dialog and no Save dialog; Save all is one folder
  dialog, canceled then saved. Unit: `imageSave.test.ts` (magic bytes, oversize, names that
  climb out of a folder), `image.test.ts` (the real handlers with dialogs stubbed: a cancel
  writes nothing, one bad file refuses the whole set before the picker),
  `interactionWiring.test.ts` (no `.download =`, a toast only after `saved === null` is checked).
- **Lesson.** **A success message belongs after the thing it reports, and the only way to know
  is to be the one who did it.** If a component cannot find out whether the save happened, it
  must not say it did — move the save to where the answer is. And a test that cannot reach the
  failure branch is not a test of it.

### Bug (T-91) — guidance baked into the file: facecam holes, placeholders, safe-area frames, references

- **Bug.** The "Facecam hole" (a tinted rect), "Facecam goes here", "Drop face here",
  "@yourhandle", "NOW PLAYING · Game name", the channel banner's safe-area frames and the
  mood-board reference at 40% opacity were ordinary layers: all of them exported into the PNG a
  streamer posts, with nothing saying they would.
- **Root cause.** The document model had no notion of a layer that is for the editor. The T-53
  `chrome` mechanism hid whole Konva LAYERS, and a document is one layer.
- **Fix.** `BaseLayer.hint?: boolean` (absent = exports, so every saved project is unchanged);
  `asHint()` in the template data; Canvas names a hint's node `hint`; `captureDocument` switches
  off `stage.find('.hint')` beside the chrome layers and restores each node's PRIOR flag in the
  `finally`; the Layers panel tags a row "hint — won't export" / "reference — won't export"
  (text, not only a colour); `makeReferenceLayer` flags the mood-board picture. **Retyping a hint
  text layer clears the flag** (`applyLayerPatch`): "@yourhandle" is a placeholder only until the
  user types their own, and an export that dropped what they typed would be worse than the bug.
- **Test.** Pixel, red-first against HEAD: the probe inside the face guide read `{r:76, g:26,
  b:24}` against a `{36, 22, 20}` background; green now, with a positive control (the accent
  bar's red is in the same file), and an overlay's facecam hole is alpha 0 where it was 26.
  `ExportDialog.test.ts`: hint nodes hidden for the capture and restored, including one that
  was already off and when the capture throws. `canvasStore.test.ts`: moving keeps a hint, new
  words clear it, a duplicate keeps it. `templateTruth.test.ts` holds EVERY template and asset to
  the rule (every guide and `@yourhandle`/`Game name`/`goes here` text is a hint; nothing else is;
  a card with a guide says it does not export). `references.spec.ts`: the reference row carries
  its tag and the exported pixel under the faded picture is plain white. Mutations: the strip
  made pass-through -> 3 unit + 2 E2E reds (`ExportDialog.tsx`, `10684d4ee9bc`); retyping stops
  clearing the flag -> 3 unit reds + the typed-handle E2E (`canvasStore.ts`, `be34a4653048`).
  Both restored byte-identical.
- **Lesson.** **When the editor has things the output must not, give the model a word for
  them.** An enumerated exclusion (the `chrome` tag) scales; "remember to delete the hint" does
  not. And the escape from a rule that hides things is a rule about when they stop being hidden.

### Bug (T-91) — cards that described a different asset than the data beside them

- **Bug.** The Twitch "video-player / offline banner" was 1200×480, Twitch's PROFILE banner size
  (the offline screen is 16:9). The 4K thumbnail was sold for "crisp shorts" (it is 16:9; a Short
  is vertical). The square clip card promised a "9:16 video well" and drew a 13:20 one (520×800).
  The lower-third said "drop into recordings" of a PNG imagii cannot lay over a video. A
  gradient bar was a flat colour.
- **Fix.** Descriptions rewritten from the data: sizes first, destinations named ("transparent
  PNG for OBS", "for OBS or your editor", "the banner on your Twitch channel page. Not the 16:9
  offline screen", "16:9, so not for vertical Shorts"); the Twitch template is "Twitch · Profile
  banner" (id kept — saved projects address it). The clip card's well is now 450×800 (exactly
  9:16, centered), because the promise is a sensible one and the data was the part that was off.
  The export panel shows `Output: WxH` from the capture's own arithmetic (floored, as Konva's
  canvas is) and a soft note when a 16:9 non-transparent export is bigger than 1280×720.
- **Test.** `templateTruth.test.ts` table-checks all 21 cards (12 templates, 9 assets): every W×H a card states is its own
  (or YouTube's, if it says YouTube), a card that says 9:16 has a 9:16 rect, nothing sells 16:9
  for Shorts, transparent docs say PNG for OBS. `ExportDialog.test.ts`: `outputPixels` and
  `thumbnailSizeNote` tables. E2E: the readout moves with Scale and the note appears at 2×.
- **Lesson.** **Copy that states a number must be generated from, or checked against, the thing
  it is a number of.** A table-check over every entry is cheaper than finding the next one.

**Found, not fixed (round 55).** (1) Other sample copy still exports unflagged — "YOUR TITLE
HERE", "Your Name", "TUTORIAL", a schedule line — by ruling (design copy the user rewrites); an
unedited one ships. (2) There is no way to keep a hint layer in the export except deleting it
and drawing a copy, or retyping a text one; a "export this layer anyway" control was not asked
for. (3) Projects saved before this round keep their mood-board references as ordinary layers
(no `hint`), so they still export; no migration was written. (4) `ChainSpec.hum60` now means
"hum removal on" at either frequency; the name is stored in projects, so it was kept. (5) The
audio export progress for the measuring pass is `out_time` over the source duration — a real
measurement, but the second pass restarts the bar at 0.

## 2026-10-09 — T-88 + T-89 (round 54): a hint that pointed at the wrong button, a Cancel that ate the take, and a "px" that was not pixels

Two tickets from the content review, one root: the product said a thing — a
button name, a status line, a dialog title, a unit, a percentage — and nothing
held the thing to what the code did. Both are fixed by making the code and the
sentence come from the same place, and by testing the sentence.

### Bug (T-88) — Record's recovery path did not recover, and its save copy lied about three states

- **Bug.** "No microphone found. Click 'Refresh sources' after granting
  permission." — but Refresh re-listed screens and windows only; the device
  lists loaded once, on arrival, and never again. They came from ONE
  `getUserMedia({ audio: true, video: true })` probe, which rejects if ANY
  requested kind is missing, into a `catch` that said nothing — so a streamer
  with a microphone and no webcam (the common case) read "No microphone found".
  The native save dialog was titled "Save recording" while its Cancel button
  threw the take away. The card after Stop said "converting and writing to
  disk…" with Convert to MP4 OFF (nothing converts), drew a progress bar that sat
  on its 2% floor, and offered "Discard recording", which in that state called a
  cancel with nothing behind it and did nothing at all.
- **Root cause.** Four unrelated strings had each been written once, for the
  case the author was looking at, and never re-read against the others. The
  hint named a control by what it USED to do; the combined probe was a
  convenience that made two independent questions one all-or-nothing answer;
  the dialog title was the verb for the happy path; the card was one sentence
  for three states.
- **Fix.** `modules/record-studio/devices.ts` (new, pure): `scanDevices` probes
  the microphone and the camera SEPARATELY and releases each probe stream at
  once, then lists a kind only if its own probe succeeded (a device Windows will
  not let the app open is not offered, even though the enumeration names it);
  `reconcileDeviceId` drops a pick for a device that has gone (T-69's rule for
  screens, applied to devices); `noDeviceHint` is the one sentence for both
  hints — "No microphone found. Plug one in, or allow microphone access in
  Windows privacy settings, then click Refresh sources." — naming the two real
  recoveries and the button. "Refresh sources" now runs `chooseSource()` AND
  `refreshDevices()`; only the newest scan may write state, because two clicks
  now start two scans. `modules/record-studio/saveCard.ts` (new, pure): the
  card's status line, bar and Discard availability per state — converting
  (bar, Discard live), plain WebM copy ("saving to disk…", no bar, Discard
  disabled with the reason on screen), a discard in flight ("Discarding the
  recording…"). `RecordStudio` keeps a `discarding` flag so the button cannot be
  clicked twice, and re-enables it if the click found nothing to kill.
  `ipc/recording.ts`: the dialog title is "Save recording (Cancel discards it)".
  A save that rejects with the cancel sentinel is announced as the calm
  discard, not a red "Save failed" (main already answers a killed convert with
  `null` since T-44; the sentinel is the same fact in rejection form).
- **Test.** Unit: `devices.test.ts` (18) drives `scanDevices` against a fake
  `mediaDevices` that behaves like the real one where it matters — a request for
  a missing kind rejects, and a request for several kinds rejects if ANY is
  missing — so the test is the machine and a combined probe fails it.
  `saveCard.test.ts` (6): Discard is offered in exactly one state; "converting"
  appears only with Convert on. `recordingCancel.test.ts`: the dialog's options
  object carries the title (MP4 and WebM), and Cancel then resolves `null` and
  reaps the take, so the title's claim is true. `interactionWiring.test.ts`:
  the button is wired to the function that does both jobs, no
  `audio: true, video: true` literal, Discard is gated on the card. E2E
  (`record.spec.ts`): "Refresh sources re-scans the microphone and camera, not
  just the screens" — a spy in the page counts the scan through the click, then a
  camera is plugged in and unplugged by stub; "a microphone and NO camera: the
  mic is listed and only the camera warns"; "a WebM take: the card says "saving",
  has nothing to stop, and the dialog title warns that Cancel discards" (the
  stubbed save dialog now records its options and can be held open, which is
  what makes the card assertable at all); "a save that comes back as the cancel
  sentinel is a discard, not "Save failed"" (the `recording:finalize` handler is
  replaced in main). The existing T-42 stub moved from the combined probe to the
  per-kind one, and the "with a camera attached" test now also asserts the mic
  warning beside the camera list. Red-first: 6 of the 18 device cases fail
  against the combined probe (`expected [] to deeply equal [ { deviceId:
  'mic-1', … } ]`); all four new E2E fail against the old build; and with
  `refreshAll` re-listing screens only the Refresh test fails at the click
  (`Expected: 2  Received: 1`). Mutations (each byte-identical on restore):
  probes recombined into one call -> the 6 device cases; title reverted -> 2
  `recordingCancel` cases; Discard live for a WebM save -> 2 `saveCard` cases.
- **Lesson.** **A recovery hint is a promise about a control: re-read it
  whenever the control changes, and test that the control does what the hint
  says it does** — the Refresh test asks the one question the DOM cannot
  answer (did the click re-run the scan?) by counting calls. **Do not ask two
  independent questions in one call.** An all-or-nothing probe turns "one thing
  is missing" into "everything is missing", and a swallowed `catch` hides it:
  probe each thing alone and let each answer decide only its own list. **A
  button that cannot act should say so, not pretend**: Discard is disabled with
  its reason on screen when there is nothing to stop. And a dialog whose Cancel
  is destructive must say so in its title — the OS chrome is untestable, but the
  options it is opened with are not.

### Bug (T-89) — the captions panel sent people to a file that does not exist, said it was English-only in neither place, and called a scale "px"

- **Bug.** The setup card told the user to fetch `whisper.exe`; current
  whisper.cpp builds ship `whisper-cli.exe`. It never said the model download
  goes online, nor which half of setup is manual. "The model file you choose
  determines languages" — the model and the language are hard-coded English.
  "Font px" is not pixels: libass scales `force_style` FontSize against a
  288-line script (the T-11 entry measured it), so the default 32 paints ~120 px
  on 1080p and the slider's maximum, 96, paints 360. Progress printed raw phase
  ids in capitals ("BUILDING-SRT") and, during transcription, a percentage that
  was `15 + Math.random() * 10` — it jittered between 15 and 25 for as long as
  the engine ran and measured nothing. A burn over a range nobody speaks in wrote
  the clip with no captions and toasted "Captions burned in". Nothing said that
  a burn-in reads the ORIGINAL file, not the platform exports. The References
  panel said Reference Search "is the one feature that goes online", which the
  model download makes false.
- **Root cause.** The same as T-88's, in a panel that had grown by phases: copy
  written for the author's own machine (the old binary name), a unit taken from
  a variable's doc comment ("Pixel font size") instead of from the renderer that
  consumes it, and a progress number invented to make a bar move because the
  type required a `percent`. The ranged burn already KNEW when the shifted SRT
  was empty (T-81 added that branch) and returned a result that could not say so.
- **Fix.** `sidecars/paths.ts`: `WHISPER_EXE_NAMES = ['whisper-cli.exe',
  'whisper.exe']` — the first that exists wins, and with neither the answer is
  the preferred name's path (the file the card asks for); a user who set up under
  the old name is not stranded. `CaptionsPanel`: the card leads with "You
  download the captions engine once (whisper-cli.exe); imagii downloads the
  English model (~141 MB) for you — that download goes online, once." and frames
  the resources path as "save it exactly here"; "Font px" is "Size", with "about
  N px tall on 1080p" under it (`effectiveCaptionPx` = size x 1080 / 288 in
  `shared/captions.ts`; the STORED value and every preset are unchanged — a
  label and a derived readout, no reinterpretation, per the T-74 lesson);
  the slider's accessible name no longer claims pixels. Two lines are always on
  the panel: "Captions are English only." and "Captions burn into the original
  video, not the platform exports." `CaptionsProgress.percent` is optional: main
  sends it only when it is true (`done` is 100; burn-in keeps the encode-time
  estimate it always had — see the ledger's found-not-fixed note) and sends NO percent for extracting, transcribing and building the
  SRT — extraction's fixed 5 and the SRT write's fixed 95 measured nothing
  either, which the ticket did not name; the panel draws an indeterminate bar
  (`role="progressbar"`, no `aria-valuenow`, `.progress-indeterminate` in
  `styles/index.css`, a static third under Reduce motion) and a plain label from
  `captionPhaseLabel`. `runBurnIn` resolves `{ outputPath, captioned }`;
  `captioned` is false exactly when a ranged burn had no cue in range, and the
  panel toasts "No captions in this range — exported without captions." with its
  own warning icon instead of "Captions burned in". "Captioned N segments"
  became "Captions ready (N lines)" through the shared `countOf`;
  "Whisper model installed" became "Caption model downloaded". The References
  note reads "Reference Search goes online; your saved boards stay on your
  computer." (and the tutorial step that said the same false thing). No ffmpeg
  or whisper argv changed: the burn's command line is byte-for-byte what it was.
- **Test.** Unit: `captions.test.ts` — `effectiveCaptionPx`, with expected values
  worked by hand from 1080/288 and the two numbers the T-11 entry measured from
  real renders, `captionSizeReadout`, `captionPhaseLabel`, both toast helpers;
  `sidecars/paths.test.ts` (new) — either name resolves, both prefers
  `whisper-cli.exe`, neither reports it as the missing path;
  `sidecars/captionsProgress.test.ts` (new) — the real `runTranscribe` and
  `runBurnIn` driven through a fake child: no event but `done` carries a
  number across 60 engine lines, and `captioned` is true/false for a whole
  burn, an in-range cue, an empty window and a window ending where the only cue
  starts; `truthInCopy.test.ts` — the panel's setup, English-only, placement,
  Size and toast strings, no `Math.random` in the transcribe path, and "one
  feature that goes online" gone from every source file. E2E
  (`video-pipelines.spec.ts`): the setup card, the Size readout (default, three
  presets, a dragged value), the progress row driven from main on the REAL
  `captions:progress` channel (plain labels, indeterminate bar, six transcribing
  events never put a number on it, burn-in keeps its 40% and its Cancel), and a
  real ranged burn through the panel — a clip with no cue in range writes a ~1 s
  file and toasts the no-captions line, the clip WITH the cue toasts "Captions
  burned in". Layer 5 (`tests/integration/media.spec.ts`): `captioned` is
  asserted beside the luma reads it must agree with. Red-first: the old
  whisperManager fails 6 of the 7 new main cases (`expected [ 'extracting',
  'transcribing', …(5) ] to deeply equal [ 'done' ]`; `expected undefined to be
  false`); the old build fails all five E2E, and the empty-range one reads
  `Received: ["Captions burned in"]`. Mutations (byte-identical on restore): the
  derivation returns the raw size -> 5 named reds (`expected 24 to be 90`,
  `expected 'about 32 px tall on 1080p' to be 'about 120 px tall on 1080p'`);
  `whisper-cli.exe` dropped from the resolver -> 6 reds across `paths.test.ts`
  and `truthInCopy.test.ts`.
- **Lesson.** **A unit is a claim; derive it from the consumer, not from a
  comment.** "Pixel size" was true of the variable and false of the picture, and
  the two numbers differ by 3.75 at every setting — the fix is a derived readout
  (the stored number is untouched, so no saved value is reinterpreted) and a test
  whose expected values are worked from the geometry, not read back from the
  helper. **A progress number is a measurement or it is absent**: an invented
  value that moves is worse than a bar that says "working" — make the field
  optional so "unknown" is representable, and let the renderer's two branches be
  the two honest states. **When a runner already knows a fact, put it in its
  result**: T-81 made `runBurnIn` skip the subtitle stage for an empty window and
  returned nothing to say so, which is how a success toast came to describe a
  file that did not match it. **A claim about "the only" is a claim about every
  other feature**: "the one feature that goes online" was written before the
  model download existed and was copied into a tutorial step; grep every site
  that repeats a superlative when the set it ranges over grows.

---

## 2026-10-09 — T-87 (round 53): a generator that glued letters onto words, and a subject that broke the article

One ticket, found by the content review rather than by a user: the "Suggest 4
titles" starters were the first sentences a streamer read after a clip, and the
review proved each lens's sample title broken before it reached anyone.

### Bug (T-87) — "Suggest 4 titles" wrote sentences a reader stops on

- **Bug.** The generator produced "I clutchedd a boss fight so you don't have
  to", "I beatd a glitch so you don't have to", "Day 41 of reacted toing
  glitch", and "I clutchedd a achievement so you don't have to": a doubled
  suffix, a gerund built on a past form, and an article in front of a word it
  had not chosen. Two patterns named one of five games the streamer might not
  play, and three slots dropped a bare noun into a sentence that needs one
  ("Why boss fight broke me").
- **Root cause.** The generator treated words as strings to glue. The verb bank
  held past forms ('clutched', 'reacted to'), and the patterns appended `d` and
  `ing` to whatever slot they sat in, so 'clutched' + 'd' and 'reacted to' +
  'ing' typed words that do not exist. The article was written into the
  pattern's literal text ("a {subject}"), so a subject that starts with a vowel
  could only ever read "a achievement". Nothing could fail: the strings were
  never checked against any grammar, and the set of titles the generator could
  produce was never enumerated, only sampled at random.
- **Fix.** `modules/video-studio/PostChecklist.tsx`. `VERBS` is a table of
  `{ base, past, gerund }`, and every pattern names the form it needs
  (`{base}`, `{past}`, `{gerund}`). `{a_subject}` is built with `article()`,
  which returns 'an' for a vowel. `fillTitle()` is the only substitution, and
  every slot takes a table value, its article, or the day number. `GAME_BANK`
  and every `{game}` slot are gone; the two patterns that used one now stand
  without it. 'achievement' left the subject list, so "an achievement" cannot be
  generated. The button reads "Title starters"; its toast and the rest of the
  panel are unchanged.
- **Test.** Red first, against the old banks. `PostChecklist.test.ts` reached
  the old constants through a temporary shim (the old banks exported under the
  new names and filled by the old `.replace` chain) and failed on the full
  cross-product: 20 titles with "dd ", 5 with "toing", 6 with "a achievement",
  6 with "a" before a vowel, 30 with "!", and 2 patterns naming a game. The shim
  was removed by restoring the original component (sha256 `411ca38e…`); the real
  change then went in, and the file went green at 20 of 20. Mutation: one
  pattern's `{past}` swapped to `{base}d` (`I {base}d {a_subject} so you
  don't have to`). The named test "no letter is glued onto a verb slot" went red
  (`expected [ Array(1) ] to deeply equal []`) and the file was restored
  byte-identically. The output checks cannot see that mutation (`clutchd` has no
  doubled letter), which is why the pattern-level check exists. The E2E pin moved
  to 'Title starters' (`tests/e2e/video-pipelines.spec.ts`, "title ideas and
  hashtag packs reach the real clipboard"), and it is green in the full run
  (149 passed, 0 failed). Before and after, from the same
  generator: "I clutchedd a boss fight so you don't have to" becomes "I clutched
  a boss fight so you don't have to"; "Day 41 of reacted toing glitch" becomes
  "Day 41 of reacting to a glitch".
- **Lesson.** **A string that will be concatenated with grammar is a grammar
  claim, and it needs a table, not a suffix.** Name the form each slot needs and
  look the form up; a letter appended to a table value is a bug no matter what
  the output looks like. **Enumerate what a generator can produce.** Random
  sampling showed the bug in a few runs at best; the cross-product of patterns,
  verbs and subjects is 192 titles, and every one of them is checked on the
  day a pattern or a word is added. **Put the rule where the word lives:** the
  article is a function of the word that follows it, so it is computed from the
  word and never typed into a pattern.

---

## 2026-10-09 — T-85 + T-86 (round 52): copy that promised what the code does not do, and tours that described a different app

Two tickets with one root: a string in the product is a claim, and nothing
held it to the code. T-85 audited the claims the content review proved false;
T-86 fixed the tutorial system that carried the most of them — and that opened
over empty screens and could not be dismissed.

### Bug (T-85) — six promises no code kept (and two Clip Kit behaviours that fell out of the watermark ruling); each ruled one way or the other

The usability tiebreaker decided each: when promise and code disagree, the user
expects the promise, so the CODE moves unless the promise was never reasonable.

| Promise (where) | Truth | Ruling |
|---|---|---|
| "The watermark field stamps your @handle on every export" (tutorial, README, USER_GUIDE) | Export stamped; Clip Kit passed `watermark: null`; GIF / reframe / compile / PiP take none | **Code to promise** for Clip Kit (it applies the SAVED watermark); copy to truth for the four panels that take none |
| Clip Kit asked the safe-zone question on every run | The kit IS all five platforms; each cut is made on purpose (T-83) | **Code**: the kit no longer raises the modal at all. The manual Export path keeps its pre-flight exactly |
| Clip Kit exported a 20-minute clip for Reels without a word | the grid already calls it "Too long" | **Code**: one confirm, only when a kit platform is over its typical limit, listing those platforms |
| "All thumbnails are screened locally before display" (ReferencePanel, USER_GUIDE) | no screening code anywhere; the only filter is DuckDuckGo's SafeSearch (`p=1`) | **Copy**: names DuckDuckGo as the filter; "Reference Search is the one feature that goes online" |
| "Auto-reframe … follow the action" / "Auto (centered)" (panel, tutorial) | `'smart'` was the centered case of a fixed strip; the "Left third" hint was a 15% offset | **Copy**: "Reframe to 9:16 (center crop)", Left / Center / Right, says plainly it tracks nothing; `'smart'` deleted from the type, validator and crop maths |
| "Capture screen + webcam + mic … your one-stop alternative to OBS" (Home, README, FOR_MIKE) | `audio: false` on the screen stream (no game/desktop sound); webcam-only is not a source | **Copy**: names what is and is not captured. The behaviour fixes are T-88's, deliberately not done here |
| "Everything runs locally" (Welcome, Home, BRANDING_GUIDE) | Reference Search and the one-time caption model download go online | **Copy, guide first**: the clause "except Reference Search and the one-time caption model download, which go online" — in BRANDING_GUIDE itself (the guide was wrong, so the guide changed), then Welcome/Home/USER_GUIDE/PRODUCT_GUIDE/FOR_MIKE |
| HotkeyOverlay "Save full app state" | mood boards are not in a project file | **Copy**: "Save your project (studios and layout; mood boards live outside projects)" |

- **Root cause.** Claims lived in strings, and a string has no test. The same
  false sentence also lived in three or four places (a tutorial step, a panel, a
  guide, the README), so fixing the one the review quoted left the rest. The
  watermark was the sharp case: `ExportPanel` and `ClipKitButton` each built
  their own `WatermarkSpec` (the kit's was a literal `null`), so the feature
  worked in one place and not the one beside it.
- **Fix.** `src/shared/watermark.ts` — `buildWatermark(text, position)` is the
  only constructor of the spec; the panel calls it on what is typed and Clip Kit
  on what an earlier export SAVED (`streamerHandle`, `watermarkPosition`), both
  untrusted (a hand-edited settings file can hold anything: blank, overlong, an
  unknown corner). `modules/video-studio/clipKit.ts` — the pure half of the kit
  (`buildKitQueue`, `platformsOverLimit`, `describeKitLimit`) pulled out of the
  button so the exact jobs it queues can be driven through the real export
  runner. `ClipKitButton` now: no safe-zone modal; resolve the saved watermark;
  one `<Modal>` confirm ("This clip is long for some platforms … Reels — the
  typical 3-minute limit", Cancel / Export anyway) only when a kit platform's
  typical limit is exceeded — the same limits and the same "typical" wording as
  the grid's red "Too long", and never a claim an upload would be refused. All
  the copy rows above. Docs moved in the same change: BRANDING, PRODUCT, USER,
  README, FOR_MIKE (and `HOW_IMAGII_WAS_MADE.md`, a history document, was left
  alone).
- **Test.** Red-first against the shipped code, quoted. `tests/unit/clipKitWatermark.test.ts`
  follows the kit's jobs into main's real `buildVideoFilter`:
  `youtube graph: expected 'scale=1920:1080:flags=lanczos,setsar=1' to match /drawtext=/`;
  `clipKit.test.ts`: `youtube carries the watermark: expected null to deeply equal
  { text: '@imagii', … }`. Layer 5 (`media.spec.ts`, inside the T-51 block, same
  platform rule): a win32 case — a kit file paints the SAVED corner, the other
  three quadrants stay flat, a kit with nothing saved is flat everywhere — and a
  linux pin driven through `buildKitQueue` and the real `runExportJob`: the kit
  job WITH the saved watermark must die naming `drawtext`, the same job without
  it must encode 1920x1080; against the old kit `promise resolved "{ …(3) }"
  instead of rejecting`. E2E (`video-pipelines.spec.ts`): the kit starts with NO
  dialog; a 20-minute clip asks once, names exactly Reels, declining starts
  nothing and never asks for the folder, accepting runs and cancels; with a saved
  handle the linux kit fails in plain words with `No such filter: 'drawtext'` in
  the console (win32: five files) — against the old build, with its safe-zone
  modal clicked through so the watermark was the only variable, `Expected:
  ArrayContaining [StringContaining "Clip Kit failed."]  Received: ["Video
  loaded", "Clip kit ready"]`. `tests/unit/truthInCopy.test.ts` keeps each
  falsehood out of the source and the guides (comments stripped, so a comment
  explaining what a line used to say does not trip it); `watermark.test.ts` pins
  the constructor. The E2E pins that held the old copy moved with it
  (`record.spec` header, `home-chrome` overlay row, `references.spec` SafeSearch
  line, `video-pipelines` reframe buttons) and new ones assert the new copy on
  Welcome, Home and the Reframe panel. Mutations, each restored byte-identically
  (sha256 shown): `buildKitQueue` back to `watermark: null`
  (`fe7192c4727e` -> `99b9af848f49` -> `fe7192c4727e`) -> 3 unit red, the Layer 5
  pin red, the E2E red; the Home card's OBS line restored (`374aeaf5e86e` ->
  `11c7a0a1b36c` -> `374aeaf5e86e`) -> `truthInCopy` red.
- **Lesson.** **A claim without a test is a bug waiting for its first reader.**
  Copy that states what the app does needs the same owner a function has — and
  the cheap owner is a test that reads the source and fails on the sentence.
  **A value that rides to an external program needs ONE builder both callers
  share:** two hand-built `WatermarkSpec`s agreed by luck until one was a
  literal `null`. **When a guide is wrong, fix the guide first** — BRANDING_GUIDE
  said "Everything runs on the user's computer", and every agent that read it
  would have kept writing the absolute.

### Bug (T-86) — tours opened over empty screens, could not be skipped, and described a different app

- **Bug.** `useTutorial` opened a studio's tour on a first visit whatever the
  studio showed. Video, Audio and Stream Graphics render only an importer (or a
  template picker) until something is loaded, so the coachmark floated over
  nothing and told the user to "drag the red handles" that did not exist. Skip
  and Esc called `onClose(false)`, which never wrote the first-visit flag, so a
  user who dismissed the tour got it back on every visit — a tour you cannot
  dismiss, behind a button labelled Skip. And the copy had drifted into another
  product: a "pink line" (the playhead is amber), "Open Auto-Highlights" (no such
  control), captions "into the export" (they make a separate file), "Duck under
  voice" (the checkbox says "Duck under primary"), "Quick fix wizard" (the button
  is "Help me fix this"), "Multi-track import" for a panel that adds ONE second
  track, "Choose file…" on a canvas whose button is "Import image", the Stream
  Graphics studio called "Image Canvas", "Two tabs" where there are three, "New:"
  on features that shipped long ago, a 14-format list summarised as "pretty much
  anything", and "LUFS", "whisper.cpp" and "FFmpeg chain" for a streamer.
- **Root cause.** Three things in one hook and its data. (1) *Nothing asked
  whether a step had anything to point at.* The coachmark already tolerated a
  missing target by centering the card — a deliberate design for the welcome and
  sign-off — which made a broken step and a deliberate one indistinguishable at
  runtime (T-16 said so, and fixed only the two attributes it found). (2) *Closing
  and finishing were two acts*: `stop(didFinish)` persisted only the second. (3)
  *Copy is data*, so nothing could fail when it drifted; T-16's target table
  proved a selector existed and said nothing about the words around it.
- **Fix.** `hooks/useTutorial.ts`: `useTutorial(def, ready)`. `ready` is "the
  studio has content" (a loaded video or audio file, a layer on the canvas;
  References passes nothing — its tab strip is there from the first frame). Until
  it is true the first-visit tour does not open and the flag is NOT consumed, so
  the first import opens it. When it opens, the definition is cut to the steps
  whose target is on the page (an element that is mounted but laid out nowhere is
  not on the page) and THAT is what the coachmark counts, so "3 of 7" is a tour
  the user can walk; an automatic tour with nothing pointed at does not open. The
  '?' button always opens, with whatever is on screen — on an empty studio that
  is the welcome, the importer and the sign-off. `stop()` persists, for Skip, Esc
  and Done alike (`onClose` lost its `didFinish` argument: there is one way out).
  Every step rewritten against the live control names; the "Multi-track import"
  step was dropped rather than reworded (it and "Background music" pointed at the
  same panel, and "load both" was false); "Step N:" and "New:" prefixes are gone
  (a gated tour skips a step, so a baked-in number would skip with it).
  **Deviation, deliberate:** the importer's own target resolves on an empty
  studio, so "no step resolves" alone could not hold the tour off an empty one;
  the studios therefore also pass `ready`, and the resolvable-step rule does the
  rest.
- **Test.** Red-first against the shipped build, quoted. E2E
  (`home-chrome.spec.ts`, "T-86 tours wait for something to point at"): an empty
  video studio gets no tour — `expect(getByRole('dialog')).toHaveCount(0)`
  `Expected: 0  Received: 1` — and its flag survives; the first import opens it,
  and walking it visits exactly the steps whose target is on the page (each with
  its cutout, the importer's step absent, shorter than the definition); Skip and
  Escape each persist — `expect.poll(tutorialSeen.video).toBe(true)`
  `Expected: true  Received: undefined` — and the tour is not back on the next
  visit nor the next launch; Audio Studio and Stream Graphics hold their tours
  until a file or a template; References opens from the first frame. The existing
  coachmark tests (Tab trap and restore, one Escape one dialog, scroll once per
  step, Next/Back/arrows/Enter/scrim to Done, the 1280x800 clamp) are unchanged
  in what they assert — they now start the tour from the '?' button (or after an
  import) because the first-visit tour no longer opens over an empty studio; the
  one that asserted "Skip does NOT persist" was the bug and is gone.
  `useTutorial.test.ts` (12) drives the rule against a fake page.
  `tests/unit/tutorialCopy.test.ts` (141): every control a step names in 'single
  quotes' is a real label on its route (the tutorial files are EXCLUDED from the
  text searched — T-16's lesson, applied at once), a banned-words scan, two
  sentences a step, unique ids and titles, centered first and last steps; against
  the old copy it is `25 failed | 96 passed` including `'Duck under voice'` and
  `'Choose file…'` on /image. Mutation: `resolvableSteps` made pass-through
  (`cae6625d2d0b` -> `8453023cb3ba` -> `cae6625d2d0b`, restored byte-identically)
  -> 8 unit red, and 7 E2E red (every tour then shows all twelve steps: `Video
  Studio · 1 of 3` is never found).
- **Lesson.** **A label is a promise about its effect.** Skip that does not
  remember is not "skip" — the cheapest honest fix was to make it remember, not
  to relabel it. **Do not use up a one-shot flag until the thing it gates has
  been shown:** the first-visit flag is consumed by showing the tour, so a tour
  that cannot show must leave it alone. **A step that cannot find its target
  should not exist, rather than be tolerated** — T-16's centered fallback was
  right for the welcome and wrong for everything else, and runtime cannot tell
  them apart. And **the way to keep copy honest is a test that looks each name up
  in the code and excludes the copy's own file** from the search.

---

## 2026-10-09 — T-84: the failure path spoke ffmpeg, not English

One symptom, four mechanisms. A streamer who pressed Cancel read a red
"FFmpeg exit null: …" for four seconds; one whose recording had been moved
read ffprobe's stderr; one whose autosave was damaged read a validator's field
path; one whose app crashed was asked to "report" a "render error" to a channel
a local-first app does not have. Nothing was wrong with the jobs. The words
were the bug.

### Bug (T-84) — ~22 catch sites toasted `err.message`

- **Bug.** `toast.error(err instanceof Error ? err.message : '<fallback>')`
  across export, Clip Kit, GIF, compile, reframe, PiP, captions (3), the
  highlight scan, Audio and Image export, image import, thumbnail variants,
  the mood-board canvas bridge, Record (2), Home (2), the autosave restore and
  the references store: "Error invoking remote method
  'video:exportBatch': Error: FFmpeg exit 1: …" on screen. Worse classes on top
  of it: **Cancel was a red failure** in every cancellable job (a SIGKILL'd
  child exits non-zero, which is the same catch); the **corrupt-autosave banner**
  and the **project-load toast** printed validator strings ("videoStudio.clips
  not array", "invalid JSON: Unexpected end of JSON input"); a **moved video
  aborted project load half-restored** (canvas in, audio and place never
  applied) behind ffprobe's stderr; **search failures** told the user to "switch
  provider" (no screen offers one) and otherwise printed `net::ERR_…`;
  **`describeImportError`** printed the raw message first and the explanation
  after it, and the audio importer showed video wording ("The video uses a
  codec…") for an mp3; the **crash screen** said "render error" and "report it";
  and a **failed export row** was a red bar that said nothing once the toast
  faded — you could not tell a fault from your own Cancel.
- **Root cause.** Four separate things hiding behind one line. (1) *No single
  place turned an error into words.* STYLE_GUIDE had a rule
  (`ipcErrorMessage`) and three sites followed it; the other 22 each wrote
  their own two lines, so whatever main threw WAS the interface. (2) *Cancel
  and crash are the same event to everyone but the party that asked.* The
  runners rejected with their own exit-code error; two of them guessed from the
  signal (`SIGTERM|SIGKILL` -> "highlight scan cancelled", "extractFrame
  cancelled"), which an out-of-memory kill satisfies equally. T-44 had already
  said where the distinction has to be made — at the point of origin — and
  applied it to converts only. (3) *`applyProject` was one straight line of
  awaits*, so the first missing file was an exception for the whole project.
  (4) *Row state was never stored.* The queue painted a bar red and kept
  nothing that outlived the toast.
- **Fix.** `src/shared/cancel.ts`: one sentinel (`CANCELLED_MESSAGE`,
  `CancelledError`, `isCancelledError`); `ConvertCancelledError` is now its
  subclass, so there is one mechanism, not two. `src/main/ffmpeg/cancelMark.ts`:
  `killAsCancelled(child)` writes the fact down BEFORE the SIGKILL and
  `cancelledOr(child, failure)` is what every runner's close/error handler
  rejects with — export, GIF, concat segment + concat + PiP, reframe, highlight
  scan, hook analysis, frame extract, audio (export, mux, re-attach), caption
  burn-in and transcription; the model download resolves `{ ok: false, reason:
  CANCELLED_MESSAGE }`. A WeakSet on the child rather than a field on each
  registry, because the child IS the job's handle in all of them. The signal
  guess is gone: an outside SIGKILL is a failure. `src/shared/userFacingError.ts`
  is the one helper: envelope stripped, the sentinel -> `cancelled: true`,
  known shapes (encoder exit, missing file, locked file, full disk, network,
  damaged input, refused capture device, model-server HTTP/checksum) -> the
  caller's context sentence + one plain cause, a finished sentence main wrote
  passes through, everything else -> the context sentence alone, and **the raw
  error always goes to the console** (cancel at info level — it is not an
  error). `lib/reportFailure.ts` is the toast half: a cancel is a plain
  `toast(...)` in the feature's own words ("Export canceled. Files already
  finished are in your folder."), a failure is `toast.error` for 8 s. All 22
  sites route through it. ExportPanel stores `error` + `canceled` per row and
  prints **Failed** / **Canceled**, which outlive the toast. `applyProject` now
  loads each studio through one isolation point (`loadReporting`): a media
  file that cannot be opened is reported in the outcome, the studio is left as
  it was, every other studio is applied, and Home and Restore show ONE message
  naming the file ("Couldn't find stream.mp4. It may have been moved or
  deleted. The rest of your project is open — load the video again in Video
  Studio."). Copy: autosave banner, project-open, search (both hops, one
  sentence), `describeImportError` (no raw prefix; `kind` makes audio say audio),
  and the crash screen (what is safe and where it is; the thrown text behind a
  collapsed Details).
- **Test.** Red-first, quoted. `src/main/ffmpeg/cancelSentinel.test.ts` (72):
  a TABLE of 12 runners x every way to ask each to stop x both exit shapes a
  SIGKILL produces (Windows code 1, POSIX null + SIGKILL), plus the control
  (the same exit unasked stays the runner's failure), a cancel aimed at another
  job, the superseded hook analysis, the model download, and the convert
  subclass — 50 failed / 22 passed against the old runners
  (`expected 'FFmpeg exit 1: ' to be 'imagii:cancelled'`, `'highlight scan
  cancelled'`, `{ reason: 'cancelled' }`). `src/shared/userFacingError.test.ts`
  (50) and `cancel.test.ts` (17): every envelope form, every mapped shape, the
  pass-through rule, the fallback, the console contract.
  `src/renderer/src/modules/project/ProjectIO.test.ts`: a moved video still
  opens audio, canvas and place; a moved audio file still opens the rest; both
  gone; none gone; a place that points into the empty studio — red against
  the abort (`Error: ffprobe exit 1: /home/user/Videos/stream.mp4: No such file
  or directory`), plus the one-message builder.
  `tests/unit/failurePathLanguage.test.ts` parses the renderer: no `catch`
  reads its variable's `.message` outside a console call, no `toast.error` is
  handed one, every named site still calls the helper, the crash screen has no
  "render error"/"report", no "switch provider", one spelling of cancel — and
  the scanner proves it discriminates on the shape that shipped; against the
  old tree it found 23 catch reads and 20 `toast.error(…message…)` calls.
  `importDiagnostics.test.ts`, `duckduckgo.test.ts`, `search.test.ts`,
  `referencesStore.test.ts` for the rewritten copy; the T-33 pins in
  `autosaveCorruptInfo.test.ts` and `interactionWiring.test.ts` moved with the
  banner's words. E2E (`video-pipelines.spec.ts`): the scan, batch, Clip Kit
  and PiP cancel tests now assert the neutral toast by words AND by KIND
  (`readToastEntries`: a plain `toast()` draws no status icon, so "Export
  canceled" in a red `toast.error` fails), "a failed export says so in plain
  words…" (source removed after import: the toast, the console, the **Failed**
  row, the row still there after the toaster empties, a clean next export),
  "cancelling a reframe, a GIF and a compilation…", "a vanished source fails
  Reframe, GIF, Compile and PiP in each panel's own plain words" (four catch
  sites, one scenario), and "Open project with a moved file" (one message, rest
  open, a complete project still says "Project loaded"); `audio.spec.ts`
  drives the Export panel for the first time (save dialog stubbed in main): an
  unwritable render fails in plain words, and Cancel on an hour-long two-pass
  render is ONE neutral toast — the old build raised "Audio export cancelled"
  AND the killed ffmpeg's message in red; `home-chrome` (banner copy + reason
  in the console, crash screen, Restore with a moved video), `references` (the
  one search sentence), `record`, and `export` (envelope gone from the import
  refusals). Red-first run against the
  old build, quoted: `Received: ["Video loaded", "Error invoking remote method
  'video:findHighlights': Error: highlight scan cancelled"]`, `"FFmpeg exit
  null: …"` for the batch and kit, `"pip exit null: …"`, `"reframe exit null:
  …"`, `"DuckDuckGo search failed: net::ERR_EMPTY_RESPONSE"`, `ffprobe exit 1:
  …stream-that-moved.mp4: No such file or directory`. Mutations, each reverted
  byte-identically (sha256 checked): `cancelledOr` ignoring the mark -> 43 of
  the sentinel table red; `isCancelledError` returning false -> 9 unit red and,
  in E2E with the project re-aborting and the row label deleted, all 7 named
  tests red (`Received: ["Video loaded", "Scan failed."]`); `reportFailure`
  raising the cancel through `toast.error` -> the kind assertion red on every
  cancel test (`"Scan canceled." is a plain toast, not an error or success
  toast`); ProjectIO rethrowing -> 4 unit red; the GIF site written the old way
  -> 3 structural red; the missing-file cause removed -> 3 helper red.
- **Lesson.** **A cancel is a fact main knows; make it where the kill happens
  and never let the renderer guess** (T-44's second lesson, now applied to
  every runner — and the guess it replaces was wrong in a way nobody had
  hit yet). Second: **when twenty-two sites share one bad line, the fix is the
  one place AND the scanner that fails on the shape** — a helper nobody is
  forced to call is `ipcErrorMessage`, which three sites used; the structural
  test is what makes the next site's author find out at `npm test`, not in front
  of a user. Third: **moving the raw text to the console is what makes friendly
  copy safe** — nothing a bug report needs is lost, it is only where the user
  no longer reads it. Fourth: **assert the KIND of a notification, not just its
  words** — a cancel in a red toast with the right sentence passes every text
  assertion. Fifth: **state that explains a failure must outlive the message
  that announced it**; the toast is for noticing, the row is for knowing.

---

## 2026-10-09 — T-83 + T-94: the export did something the screen never said

Both bugs produced files that opened, played and were the right size. T-83's
were the right size and the wrong SHAPE (a picture squeezed 2-3x on one
axis); T-94's were all correct and one too many (the whole source,
re-encoded beside the excerpts the user asked for). In both, the app had a
word on screen that was not about what the export would do — a green dot
judged on the file instead of the crop, a button that said "Export 6"
without saying six of what — so nothing the user could see told them
anything was wrong.

### Bug (T-83) — a manual crop was applied to every ticked platform and stretched to fit

- **Bug.** Draw a 4:3 crop, tick Reels, export: a 1080x1920 file with the
  picture ~2.4x too tall. Leave YouTube ticked (the default) beside a 9:16
  crop and it stretched ~3x wide. ffprobe saw nothing wrong — a stretched
  file is a valid file. The Export grid could not have warned: it passed
  `cropAspect={null}`, so its indicators judged the uncropped source; its red
  label said "Trim" (which reads as "shorten the clip") when the reason was
  aspect; the reason text lived in a hover-only `title`; and the safe-zone
  modal used "clip" as noun and verb in one sentence and fired on every
  Clip Kit run describing geometry the pipeline no longer had.
- **Root cause.** `buildVideoFilter` took ONE of two branches: apply
  `cropRect` verbatim, OR auto-crop the source to the preset's aspect.
  After a manual crop nothing reconciled the crop's shape with the
  platform's, so `scale` forced the preset's exact WxH on whatever the user
  had drawn. And four consumers each held their own idea of "the frame": the
  filter (the source, or the crop, never both), the grid (the source), the
  safe-zone pre-flight (the source — so with a 9:16 crop it named the TALL
  platform as the one losing picture, backwards), and OutputPreview (the
  crop squeezed onto the platform's canvas, previewing the stretch).
- **Fix.** The crop is the new source frame. Chain: crop (the user's) ->
  `autoCropForAspect` against the CROPPED size -> scale. The no-crop path is
  the same call with the whole source as the frame, so there is one
  implementation of "cut this frame to that shape" and two callers (the T-82
  keep-expression precedent); a crop that already has the platform's shape
  adds no second stage. Every crop dimension and offset stays even
  (yuv420p), and an odd source works. Of the three honest options — pad,
  per-platform centered crop, refuse — the usability tiebreaker picks the
  crop: padding puts bars on screen the user did not draw, and refusing
  blocks the app's default multi-platform workflow; a centered cut keeps the
  user's content and never distorts it, and its cost (edges lost on the
  other shape) is exactly what the grid and the modal now say. On the
  screen: `cropFrameSize` (shared/safeZone.ts) is the renderer's one
  reading of "the frame an export starts from", used by the grid (the real
  crop aspect instead of `null`), by `findSafeZoneIssues` (rows now name the
  platform whose picture is cut down: "TikTok frame -> cut down for YouTube"),
  and by OutputPreview (your crop, then the platform's shape cut from it).
  `SuccessIndicator` labels are reason-specific — "Great", "OK", "Too long",
  "Wrong shape", or both joined — and the reasons print on the card, under
  the label, instead of in a tooltip; durations are words ("the 10-minute
  sweet spot", "the typical 3-minute limit", "2:20" for a non-whole minute,
  hours only for the multi-hour caps where "720-minute" would be absurd) and
  every platform cap is a "typical" limit, because an account's real cap
  depends on the account. The modal reads "Some platforms will crop the
  picture", says why in plain words, lists each line as "X frame -> cut down
  for Y", and its buttons are Cancel / Export anyway.
- **Test.** Layer 5 (`npm run test:media`), "manual crop exported to a
  mismatched preset (real ffmpeg, T-83)": a black frame carrying a white
  160 px SQUARE centered where every crop is centered, five real
  `runExportJob` runs, the output decoded whole and the marker's bounding box
  measured from pixels — square (0.97-1.03), the hand-derived scale
  (e.g. 160 x 1920 / 720 for a 4:3 crop into Reels), and centered, for
  4:3 -> Reels, 9:16 -> YouTube, 1:1 -> X, an odd 1919x1079 source, and the
  matching-shape control (a 16:9 crop into YouTube, green on the old code
  too, there so a fix that over-crops cannot pass). Red-first against the old
  filter, quoted: "marker came out 180x426 (expected a 427px square):
  expected 0.4225 to be greater than 0.97", "568x180", "190x106". Unit:
  `src/main/ffmpeg/filters.test.ts` "a manual crop is the frame each
  platform is cut from (T-83)" (exact crop strings both ways, no second
  stage when the shape already matches, the no-crop path unchanged, a
  last-crop-has-the-preset's-aspect invariant over six rects x five presets,
  every dimension and offset even over three source sizes, a custom preset's
  aspect); `src/shared/safeZone.test.ts` `cropFrameSize`;
  `src/renderer/src/modules/video-studio/presets.test.ts` (new —
  `evaluateSuccess` had no test: labels, both-red, minutes wording, "typical"
  on every platform's cap, no reason names a platform, a 9:16 crop turning
  TikTok/Reels green and the rest red); `ExportPanel.test.ts` (new —
  `findSafeZoneIssues` against the crop's frame: the direction flips, a crop of
  the platforms' own shape silences it, per-clip crops, custom presets).
  E2E (`video-pipelines.spec.ts`): "the grid judges the crop, not the file"
  on a 4K 26 s fixture (no crop: TikTok/Reels "Wrong shape" with the reason
  visible; a 9:16 crop drawn through the real Crop control: TikTok and Reels
  "Great", the other three "Wrong shape"; unchecking Crop gives the source
  back and no "Trim" anywhere), "with a crop in place the safe-zone
  pre-flight reads the crop", and "a cropped clip exports at every ticked
  platform's own size with square pixels". Mutation, quoted: the post-crop
  `autoCropForAspect` stage skipped when `cropRect` is set -> 4 unit cases
  and 4 of the 5 Layer 5 cases red (the matching-shape control stays green,
  as it should); restored byte-identically (sha256 87a825828f42acce before
  and after).
- **Lesson.** **A stretch is invisible to every probe — measure a shape
  whose truth you know.** ffprobe, dimensions, codecs and durations all
  agreed with a picture squeezed 2.4x; only a square that stopped being
  square said so (the third time this layer has been right where the
  container was not: T-65's SAR, T-81/T-82's content at an offset). Second:
  **when several surfaces answer one question, give them one source for the
  answer.** The filter, the grid, the pre-flight and the preview each
  decided what "the frame" was, and the fix is the shared reading
  (`cropFrameSize`), not four patches. Third: **a label that names a
  remedy ("Trim") instead of the problem sends the user to the wrong
  control**; say what is wrong, and put the reason where the eyes already
  are, not behind a hover.

### Bug (T-94) — the whole-video "Clip 1" rode along in every export and compilation

- **Bug.** Loading a source creates Clip 1 spanning the full duration with
  YouTube ticked. Scan a three-hour VOD, add five highlights, press Export:
  six clips run, so the full VOD is re-encoded beside the five excerpts — and
  the button only said "Export 6". Compile likewise stitched the whole video
  in, behind a button that only said "Compile".
- **Root cause.** The editor needs a clip to select the moment a file loads,
  so `loadSource` makes one; nothing ever distinguished that placeholder from
  a clip the user chose to make, and Export / Compile run ALL clips. The two
  buttons printed a number (or nothing) with no noun, so the user had no way
  to read the surprise off the screen before it happened.
- **Fix.** The placeholder steps aside, and only for the people who have said
  they want excerpts. `isPristineWholeVideoClip` (videoStore.ts) defines the
  placeholder exactly — named "Clip 1", `[0, duration]`, no crop, no overlays,
  no grade, no speed / auto-zoom / hype-shake, exactly `['youtube']` and no
  custom presets; a field set back to its default counts as untouched, since
  the export would not change. The highlight scanners (audio and chat-spike)
  add through the new `addScannedClip`, which shares ONE `appendRange`
  with `addClipFromRange` (same guards, same single `snapshot(null)`), so
  retiring the placeholder and adding the highlight are one undo step: Ctrl+Z
  puts the whole-video clip back and takes the highlight away together. The
  scanner answers 'refused' / 'added' / 'added-dropped-whole-video' and the
  panel toasts the last one neutrally — "Removed the whole-video clip — the
  highlights are your clips now. Press Ctrl+Z to keep it." — beside the usual
  "Clip added". The manual "+ Add clip" and `addClipFromRange` never retire
  anything: that is the user making a clip on purpose. Export reads
  "Export {n} file(s)" and Compile "Compile {n} clip(s)" through a new
  `countOf` helper (`src/shared/plural.ts`), which also builds the "Exported
  N file(s)" toast — the plural bug class on file ("Export 1 files") is
  closed at these sites by construction.
- **Test.** `videoStore.test.ts`: the predicate table-driven — every field
  that breaks pristineness flips it, set-back-to-default does not, the
  duration is judged as given, and the clip `loadSource` really creates IS
  pristine (the predicate and the creator cannot drift) — and the scanner
  action: retire + add, ONE undo restores both and the selection, redo
  re-applies, later adds just add, a touched / renamed clip is left alone,
  only the pristine one goes when the user also made another, a refused range
  changes nothing (and costs no undo step), an open coalescing key does not
  swallow the step, and the manual paths never retire.
  `src/shared/plural.test.ts`. `tests/unit/interactionWiring.test.ts`: who
  calls what (both scanners through `addScannedClip`, ClipList through
  `addClip`, the T-59 refusal gate re-pinned on the new shape). E2E
  (`video-pipelines.spec.ts`): the VOD path end to end on the burst fixture —
  button "Export 1 file", scan, + Clip, the whole-video clip gone, the toast
  exactly once, ONE Ctrl+Z restores "Clip 1" (Undo then disabled), Ctrl+Y
  takes it away again, a second platform makes it "Export 2 files", and the
  export writes exactly two files from "Highlight 1", each ~11 s of a 14 s
  source, none from "Clip 1"; the chat scanner retires it too while a
  manual "Clip 2" of the same range survives; a renamed clip is left alone
  with no removal toast. Red-first against the shipped build, quoted:
  `Expected: "Clips (1)"  Received: "Clips (2)"` after the first + Clip (the
  whole-video clip still there), and the chat case's toast poll timing out
  with `["Video loaded", "Found 1 hype moments", "Clip added"]`. Mutations,
  each red: predicate forced false -> 8 unit cases and both retire E2Es red
  (the renamed-clip test stays green, as it must); predicate forced true ->
  25 unit cases and the renamed-clip E2E red (`Clips (2)`, received
  `Clips (1)`); restored byte-identically (sha256 cd1ef8da94a15b27 before and
  after).
- **Lesson.** **A default the app creates for its own convenience must be
  distinguishable from a choice the user made, or the first batch operation
  runs it as one.** "Untouched since creation" is a checkable property —
  define it field by field in one predicate, and test that the creator
  satisfies it. Second: **a button that prints a number owes the noun** — the
  surprise was readable on screen the whole time as "6", and unreadable
  because nothing said six of what. Third: when an action does two things the
  user would want to take back together, make it one history entry in the
  store, not two in the caller (T-40's `snapshot(null)` is the seam).

## 2026-10-09 — the References "+" button was unclickable: flex-1 without min-w-0 in a clamped column

- **Bug.** In the References sidebar (a grid column clamped to 220 px),
  the create-board button sat at x 287-322 while its own card ended at
  x 252 — the whole input+button row overflowed the column and the
  button landed UNDER the neighbouring detail card, which swallowed
  every click. Found when two long-green E2E tests went red in a fresh
  container.
- **Root cause.** A flex item's default `min-width` is `auto`, so
  `flex-1` on the name input could not shrink it below the intrinsic
  width of its placeholder text. Intrinsic text width depends on the
  environment's fonts, which is why the same build was green in one
  container and red in the next — and why the shipped Windows app, with
  different fonts again, can hit it at ordinary window widths. A
  layout that only works under one font stack is the platform-sensitive
  test class (2026-08-15) wearing CSS.
- **Fix.** `min-w-0` on the input (`MoodBoardPanel.tsx`), and the same
  token on every other `flex-1` form control in the renderer — the
  audio preset name input and the image-studio PropertiesPanel fields
  sit in the same clamped-column pattern and differed only in not
  having been pushed over the threshold by this font stack yet.
- **Test.** The two tests that caught it ("mood boards: create by
  button and by Enter…" and "Home global Undo walks the studios…")
  drive the click to its end state and are the regression coverage;
  both red before the one-token fix, green after, nothing else
  changed.
- **Lesson.** **`flex-1` on a form control is a bug until `min-w-0`
  joins it.** Content-intrinsic minimums are font-dependent, so the
  overflow they cause is invisible on the machine that wrote the code
  and real on someone else's.

## 2026-10-09 — T-81 + T-82: two exports that were valid files with the wrong content

Both bugs shipped a file that opened, played, had the right codec, the
right container and a plausible length. Neither failed anything; each
was wrong only in WHAT was in the file at an offset from the start — the
caption words of a clip cut from minute 40, the picture under a sound
three seconds into an edit. Every existing test measured the container
or the origin (startSec 0, "the file is shorter by the cut"), which is
the one place the wrong and the right answer coincide.

### Bug (T-81) — captions burned over a clip range showed the wrong part of the transcript

- **Root cause.** T-74's sibling, same disease: two timebases, one file.
  The SRT Whisper writes is on the SOURCE clock (cue times are seconds
  into the whole video, and the Captions panel lists them that way).
  `runBurnIn` seeks with `-ss`/`-to` BEFORE `-i`, which resets the filter
  graph's clock — the clip's first frame reaches `subtitles=` at t=0 —
  and then handed the filter the whole-source SRT untouched. A clip cut
  from minute 40 was captioned with the stream's first minutes, and once
  `startSec` exceeded the clip's own length no cue could ever show. At
  `startSec` 0 the two clocks read the same number, which is where every
  burn-in test had been written.
- **Fix.** Convert at the one place that sees both clocks (block comment
  at the seam in `runBurnIn`). `shiftSrtToRange(srt, startSec, endSec)`
  — a pure helper in `src/shared/captions.ts` — rewrites the cues onto the
  clip clock: shifted by -startSec, wholly-outside cues dropped,
  edge-straddling cues clamped to the range, renumbered, timestamps
  re-serialised as `hh:mm:ss,mmm` in whole milliseconds (no float
  drift). A ranged burn writes that to a sibling temp SRT, burns from it,
  and unlinks it on success, ffmpeg failure and cancel alike; `-ss`/`-to`
  stay before `-i` (fast, and now correct because the cue clock matches
  the seeked clock). `-copyts` plus an output-side seek was the
  alternative and was rejected: it keeps the source clock but makes
  ffmpeg decode from the top of the file to reach minute 40. The SRT on
  disk — and what Save .srt exports — stays source-absolute; nothing
  stored is reinterpreted (unlike T-74, no saved project is affected).
  `tsToSeconds` moved to `shared/captions.ts` beside the helper that
  needs it (its tests moved with it). One behaviour the fix surfaced: a
  window nobody speaks in shifts to a cue-less SRT, and ffmpeg's
  `subtitles` cannot open one ("Unable to open"), so that case burns with
  no subtitle stage at all — the clip, uncaptioned, which is what a
  `startSec`-0 range with no cue in it always produced and what the
  suite's own control render depends on. Two follow-ons in the same round:
  `captions:burnIn` now validates the range at the IPC boundary
  (`assertOptionalTimeRange`: both absent, or finite numbers with
  0 <= startSec < endSec; a lone startSec, an empty or inverted range, NaN
  or a numeric string is rejected with a plain message before any file is
  read — before this an inverted range silently burned the WHOLE video);
  and a hard kill mid-burn used to strand the shifted copy forever, so its
  naming and its sweep share one helper pair (`shiftedSrtPath` /
  `isShiftedSrtName`, strict UUID tail) and `tempCleanup` sweeps stale
  `*.srt.clip-<uuid>.srt` from `userData/captions` at launch — only those
  names, because that folder also holds the user's real transcripts.
- **Test.** `src/shared/captions.test.ts` — "shiftSrtToRange — the SRT on
  the clip clock (T-81)": inside / before / after / touching an edge /
  straddling each edge / spanning both / zero-length, renumbering, hour
  boundaries, variable-length fractions, float drift, CRLF + BOM +
  multi-line, junk blocks, invalid range. Layer 5 (`npm run test:media`),
  "caption burn-in (real ffmpeg)" on the flat-gray source cut 2 -> 5 s:
  "a ranged burn shows the cues of the burned span, on the clip clock
  (T-81)" (cue A at source 3.2-4.4 s must be painted at output 1.8 s;
  cue B at source 0.2-1.0 s must paint nothing at output 0.6 s, where the
  bug put it; exact luma-spread reads, 0 vs > 100), "cues straddling
  either edge keep their visible half", "a range with no cue inside it
  still yields the clip, uncaptioned", "a burn that fails inside ffmpeg
  still removes its shifted SRT", and "a ranged burn with a missing SRT
  fails on the read, before any ffmpeg" (the old missing-SRT case now
  runs unranged so it keeps pinning the runner's own ffmpeg error).
  `src/shared/validators.test.ts` — `assertOptionalTimeRange`;
  `src/main/ipc/captionsBurnIn.test.ts` — the real handler, driven through a
  captured `ipcMain.handle`, refuses eight bad ranges and never reaches the
  runner (handler call deleted -> 8 red; `endSec > startSec` deleted -> the
  validator case and both handler cases red). `src/main/tempCleanup.test.ts`
  — "the captions temp-copy family": a stale orphan goes, a fresh orphan
  (a burn that may still be running), an old real transcript and an old
  note stay (sweep with no name filter -> red; wrong folder -> red).
  Red-first against the old `runBurnIn`: 3 of the new cases fail — "caption
  spread at output 1.8 s ... 0: expected 0 to be greater than 100".
  Mutation: `shiftSrtToRange` returning its input -> the helper's unit
  cases and 3 Layer 5 cases red; skipping the unlink -> 3 Layer 5 cases red.
- **Lesson.** **T-74 and T-81 are one bug in two filters: a number that
  was right on its own clock and wrong on the consumer's, hidden both
  times by the origin.** Write down which clock each side is on at the
  place they meet — and put the fixture at an offset: a test that starts
  at 0 cannot tell two timebases apart. When a fix lands for one consumer,
  grep for the others that read the same stored field (here: any filter
  that reads source-absolute seconds after an input `-ss`; the grep
  after this fix found none left — `concat.ts` fades are already
  clip-relative).
  Second: a stand-in for "nothing to show" has to be checked against what
  the downstream tool will accept; an empty SRT is a different failure
  from an SRT whose cues are elsewhere, and the difference only showed up
  when a pre-existing test's control render stopped working.

### Bug (T-82) — audio cuts + "Re-attach to video" desynced the sound and cut the video's tail

- **Root cause.** The chain closes cut gaps in the AUDIO (`aselect` +
  `asetpts`, so the audio gets shorter by the total cut length) and
  `runAudioMux` then put it on the ORIGINAL picture with `-c:v copy
  -shortest`. From the first cut on, the sound ran ahead of the picture by
  the cut length, and `-shortest` quietly threw away the video's last N
  seconds — N the total cut — to make the lengths agree. Nothing errored.
  It also made the obvious test useless: the output's video and audio
  durations were EQUAL (both trimmed to the shorter), so "durations match"
  passed on the bug; only the content at an offset told the truth. The
  waveform copy ("Drag on the waveform to select a region to cut") never
  said the picture was untouched, and "Re-attach to video" defaults ON.
  Rider: the intermediate `<name>.cleaned.wav` (~0.7 GB per hour) was named
  and written by the renderer (`ExportDialog`) and never deleted by
  anyone — and the renderer is the one place that cannot delete it on every
  failure path.
- **Fix.** Per the usability tiebreaker, "cut" means cut both: when cut
  regions exist and the mux-back path runs, the picture drops the same
  spans. `chain.ts` has ONE `keepExpression` builder (`not(between(t,..)+..)`)
  and two thin wrappers — `aselectForCuts` and the new `vselectForCuts`
  (`select=..,setpts=N/FRAME_RATE/TB`) — so the two streams can never be
  cut at different instants. `runAudioMux` takes the cut list; with cuts
  the picture is re-encoded (libx264 medium, yuv420p, default CRF, like the
  caption burn-in; T-119 corrected "like the other whole-file re-encodes":
  Reframe sets `-b:v 6M -r 30` on a trimmed range); the streams agree by
  construction, so `-shortest` no longer papers over anything — it stays on
  BOTH paths for one remaining job: bounding a music bed longer than the
  picture (with Duck off, `amix` runs to its longest input, so the mix is
  max(voice, music) minus the cuts and overruns a cut picture whenever the
  music outlasts the source; with Duck on the bed ends with the voice and
  there is no tail, T-119 scoped this and T-110(af) is the open length call;
  `-shortest` trims the tail where there is one, it shifts nothing). With NO
  cuts the `-c:v copy -shortest` path is untouched, byte for byte. Two things
  the re-encode had to re-establish that a stream copy gave for free:
  (1) frame rate — `setpts` leaves the graph's output rate unknown, so
  ffmpeg falls back to a forced 25 fps CFR with duplicated frames (a 24 or
  60 fps recording came out at 25), fixed with `-fps_mode passthrough`;
  (2) progress — the mux pass was measured against a duration of 0 (fine for
  an instant copy), so a minutes-long re-encode sat at 0%; it now measures
  against the cut audio's length. The orchestration moved to main:
  `AudioMuxSpec` is now `{ jobId, videoPath, sourcePath, outputPath, chain }`
  and `runAudioReattach` renders the intermediate WAV, muxes, and deletes
  the WAV in a `finally` — success, failure or cancel, either pass. The
  WAV path is derived in main, so no renderer-supplied path is ever
  deleted, and an assert refuses the one collision (a source or video
  sitting exactly where the intermediate would go). With mux-back OFF the
  exported audio file IS the deliverable and never goes through this
  function. The waveform copy needed no change: with this fix it is true
  of both outputs. One more combination the same promise covers: with a
  SECONDARY track the chain used to cut only the primary input, so the
  music ran uncut beside a cut voice, `amix` (longest input) made the audio
  as long as the music, and the music's own moments sat late. The cut now
  applies once, to the MIX (`aselectForCuts`, the same shared keep-expression,
  ahead of the mix-bus loudnorm so that measures only what is kept); the
  primary's own stages are built without it, and without a secondary track
  the cut stays first in the primary's chain as before. The measure pass
  stays cut-first — loudnorm there is linear, so a gain measured on the
  kept audio is the right constant to apply before or after the cut.
- **Test.** `src/main/audio/chain.test.ts` — "cut regions — one expression
  for sound and picture (T-82)": the audio string is unchanged by the
  refactor, the picture string is its twin, and the two keep-expressions
  are asserted IDENTICAL (the drift guard). Layer 5, "audio cuts
  re-attached to video (real ffmpeg, T-82)", on the ramp fixture (every
  frame's luma is 12 x its source second; audio has one burst at 10.0-11.5
  s) cut 4 -> 7 s through the real `extractAudioFromVideo` ->
  `runAudioReattach`: "a cut removes the same span from the picture and
  the sound, and they end together" (both stream durations 17 s +- 0.25
  and within 0.15 of each other, the frame at output 5 s reads source 8 s,
  the frame at 16 s reads source 19 s, the burst sits at output 7.0-8.5 s
  with source second 10 under it, frame rate 24 not 25, mux progress moves,
  and the directory holds only the output); "with no cuts the picture is
  stream-copied untouched" (video packet md5 equals the source's, and no
  litter); "a mux that fails still removes the intermediate WAV" (video
  path does not exist, so the export pass has finished and a complete WAV
  is on disk when the mux dies); "refuses to clobber a file that sits where
  the intermediate WAV would go" (source survives byte-identical); "a
  secondary track is cut with the voice, so music, voice and picture stay
  in step" (a 3 kHz burst in the SECONDARY track at source 12.0-13.5 s,
  after the cut, must sit at output 9.0-10.5 s under source second 12, be
  silent where the uncut file would have put it, and video / audio /
  container durations all come out source-minus-cut) and "a music bed
  longer than the picture is trimmed to it, not shifted" (the same
  assertions with a 26 s bed under the 20 s source, so the mix would be
  23 s against a 17 s picture without the bound; the burst still lands at
  its shifted time). `media.spec.ts` audio
  chain: "a cut applies to the mix, music included" (8 s music + a 2 s cut =
  6 s out, not 8), "a cut mix still ducks the music under the voice", and
  "the mix cut and the mix-bus loudnorm share one graph".
  Red-first against the old behaviour (same orchestration, no cut, no
  delete): "frame at output 5 s reads luma 61; source 8 s is 96",
  `[ 'ramp-cleaned.cleaned.wav', ... ]` left beside the output, and the
  collision case dying inside ffmpeg. Mutations, each red: drop the video
  select (-> the luma case), skip the unlink (-> three litter cases), swap
  `passthrough` for `cfr` (-> "output frame rate 25/1"), delete the assert
  (-> the collision case), zero the progress duration (-> "expected 1 to
  be greater than or equal to 2"), make `vselectForCuts` drop a region
  (-> three unit cases). The secondary-track cases, red-first against the
  pre-mix cut: "audio duration 20: expected 20 to be less than 17.25" and
  "expected 8 to be less than 6.25"; the pre-mix position restored as a
  mutation -> exactly those two red; `join(';')` instead of `join(',')` in
  the post-mix stages -> "FFmpeg exit 234" on the composition case. (Ducking
  alone could not discriminate: a sidechain ends with its shorter input, so
  the ducked graph was already 6 s.) The long-bed case, red-first against
  the cut path without `-shortest`: "audio duration 22.928: expected 22.928
  to be less than 17.25"; removing the `-shortest` that fixed it turns
  exactly that case red while the equal-length case stays green.
- **Lesson.** **`-shortest` turns a length mismatch into a quiet
  truncation, so a duration check cannot catch the mismatch it hides.**
  Assert on content at an offset (the frame under a known sound), not on
  lengths. Second: **when an edit is applied to one stream, the other has
  to be asked.** The chain was written audio-first and the video that rides
  along was assumed to be "just carried" — the cut list is the only
  description of the edit, so both streams must be built from the same
  builder. Third: **a fast path that becomes a slow path owes everything
  the fast path did implicitly** — frame rate and progress here — and the
  frame-rate half was a second silent defect (24 fps out as 25) that the
  first fix's green tests walked straight past; it surfaced only when the
  output was probed. Fourth: a temp file named in one process
  and needed to be deleted on every exit path belongs in the process that
  can see every exit path.

---

## 2026-08-26 — T-79 + T-80: two fixes that inherited the wrong half of an earlier one

Both bugs here were introduced by the round-47 entry directly below.
Neither is a typo or an oversight in the code that landed — each is a
mechanism that was correct where it was written and wrong one line
further down the chain it was attached to. A pass that runs after
another pass inherits that pass's guarantees, or breaks them.

### Bug (T-79) — the launch-time LRU could only delete pictures boards still used

- **Root cause.** Round 47 gave the 500 MB `pruneThumbCache` an
  automatic caller by chaining it after `sweepOrphanThumbs` at launch —
  "the same moment the sweep already proves safe". It is not the same
  moment, and the sweep's safety was never the moment: the sweep builds
  a `referenced` set from every board file first and unlinks only what
  no board points at. `pruneThumbCache` is a pure mtime LRU with no
  reference check at all, and it ran *after* the sweep, when every
  orphan is already gone. So past the budget it could only ever delete
  files a board still refers to — silently, with the board left pointing
  at a hole. The tile made that permanent: `<img src={cachedThumbPath}>`
  had no error fallback, so a missing cached file was a broken square
  for good, which also meant the now-working "Clear thumbnail cache"
  button broke every tile on the board it emptied.
- **Fix.** Launch runs the sweep and nothing else. With the LRU's only
  other caller being the clear button at budget 0, the budget machinery
  was dead code and went with it: `pruneThumbCache(maxBytes)` is
  `clearThumbCache()`, one operation with no argument, still on the
  `moodboard:clearThumbs` channel. And the tile falls back to
  `item.thumbnail` — the URL the picture came from, which the board
  keeps forever — when the cached file fails to load, one way per item
  id so a failing source cannot loop. A cleared cache now heals instead
  of breaking. Referenced thumbnails are user data; a disk budget is not
  allowed to eat them (owner's usability tiebreaker).
- **Test.** `tests/e2e/references.spec.ts` — the round-47 launch-LRU
  test is now "launching far over any budget deletes no board-owned
  thumbnail (T-79)": 600 MB of sparse board-owned thumbs plus one
  unowned orphan, app launched, nothing clicked; the orphan's
  disappearance is the proof the maintenance chain really ran, and all
  four owned files outlive it, the app's close, and a second launch.
  "a tile whose cached file was cleared falls back to its source image
  (T-79)" drives the Clear button and finds the picture — not a hole —
  on the next launch. `src/main/search/moodboard.test.ts` —
  "clearThumbCache — the button empties it, whatever it holds".
- **Lesson.** **A maintenance pass chained after a correctness pass
  inherits its guarantees or breaks them.** "Right after the safe one"
  is not a safety property; the sweep was safe because of the set it
  builds, and running an LRU behind it left the LRU nothing to eat but
  the files the sweep had just decided to keep. Second: **a cache is
  only disposable if the thing that reads it can survive its absence.**
  The clear button was safe to press only once the tile could re-derive
  its picture — the fallback is what makes the word "cache" true.

### Bug (T-80) — a caret click inside a focused field split one edit into several undo steps

- **Root cause.** T-40 closed the undo-coalescing window with one
  `onPointerUp={endGesture}` per panel rather than a prop on every
  control, deliberately, so a control added later would inherit it.
  pointerup bubbles, though, and a plain click *inside* a text or
  number input the user is already typing in bubbles the identical
  event: repositioning the caret mid-caption, or double-clicking a word
  to replace it, ended the gesture. One rename or one caption edit
  became as many undo steps as the user clicked, and the first Undo
  gave back only the tail — the exact mid-gesture close T-40's own
  design notes promised not to have, since blur is the documented
  gesture end for a text field.
- **Fix.** `endsGestureOnPointerUp(tagName, inputType, isActiveElement)`
  in `videoStore.ts` — a pure predicate, no DOM — answers the one
  question: a release inside the FOCUSED text-entry control (textarea,
  or an input whose type is text-like, with a missing or unrecognized
  type read as text) is part of the edit, everything else ends the
  gesture. Range, checkbox, radio and colour releases still end it, or
  T-40's slider fix regresses. `handleGestureEndPointerUp` is the one
  DOM-facing line, shared by ClipList and TextOverlayEditor; both keep
  `onBlur={endGesture}`, which is what actually ends a text edit.
  ColorGradePanel holds only sliders, checkboxes and a button, so its
  bare `endGesture` is already right and was left alone.
- **Test.** `src/renderer/src/modules/video-studio/store/videoStore.test.ts`
  — "endsGestureOnPointerUp — a caret click is not a gesture end
  (T-80)" covers the text-like types, the missing/unknown type, the
  release types that must still end a gesture, the unfocused field, and
  case. `tests/e2e/video-core.spec.ts` — "clip list: a caret click
  mid-rename keeps the edit one undo step (T-80)" types, clicks inside
  the focused field, types again, and ONE Undo restores "Clip 1" with
  Undo then disabled (unguarded, it restores the half-typed "HOOK").
- **Lesson.** **A handler placed on a container to catch one kind of
  event catches every element that bubbles that event, including the
  ones the feature was meant to protect.** Delegation is the right
  shape here — it is what makes a later control inherit the behavior —
  but it owes each element class an answer, and "text entry ends on
  blur" was already the written rule when the pointerup handler was
  added on top of it.

---

## 2026-08-26 — T-29 + T-40 + T-74: three controls measured against the wrong number

A button that measured a clear against a budget, an undo step that
measured a gesture against a label, and a filter window that measured
one clock against another. Each one worked perfectly on the one input
where the two numbers happen to agree — a cache over 500 MB, a drag
followed by an undo, a clip starting at 0.00 — which is exactly why all
three survived their own tests.

### Bug (T-74) — text overlays never rendered on a clip that does not start at 0

- **Root cause.** Two timebases, one field. `overlay.startSec` /
  `endSec` are SOURCE-absolute seconds: that is what the Text overlays
  panel shows in its Time fields and what it defaults a new overlay to
  (`clip.startSec` -> `clip.endSec`). `drawTextFilter` emitted those
  numbers straight into `enable='between(t,...)'`, but `runExportJob`
  passes `-ss` BEFORE `-i` — input seeking — so the clip's first frame
  reaches the filter graph at t=0 and the window is clip-relative. For a
  clip starting at S with duration D the overlay appeared only during
  t in [S, D]: late by S seconds, and absent entirely once S > D. A
  clip cut at 10 -> 13 with the editor's own default window showed
  nothing at all. `setpts=PTS/speed`, which sits ahead of the overlay in
  the chain, divides the same clock again, so a sped-up clip was wrong
  in a second way.
- **Fix.** `buildVideoFilter` — the one place that can see both the clip
  and the overlay — converts: `t_graph = (t_source - clip.startSec) /
  speed`. Storage stays source-absolute deliberately: it is what the
  editor displays and what every saved project already holds, so
  re-basing it would silently reinterpret existing files. Unclamped, so
  a window that opens before the clip keeps its visible half. The whole
  derivation lives in the block comment above `drawTextFilter`, at the
  seam, not in a ticket.
- **Test.** `src/main/ffmpeg/filters.test.ts` — "text-overlay enable
  window (T-74)" pins the conversion including the speed divisor and the
  negative-start case. Layer 5 (`npm run test:media`) proves real ffmpeg
  agrees: the T-51 pixel block now cuts every clip at CLIP_START = 2
  instead of 0, and two new cases run a REAL `runExportJob` with
  `drawtext` swapped for `drawbox` — the linux binary has no drawtext at
  all — asserting the overlay is painted from the clip's first frame and
  that a 2x clip's window lands at 0.2 -> 0.8.
- **Lesson.** **When a stored number and a consumed number are both
  "seconds", write down which clock each one is on at the place they
  meet.** The bug is invisible at the origin (0 is 0 in every timebase),
  which is where tests get written; it only appears at an offset. And a
  stand-in filter is a legitimate way to test a filter the local binary
  cannot run — as long as you substitute the NAME and keep the argument
  under test byte-identical, so the production string and the production
  command are still the things being proven.

### Bug (T-29) — "Clear thumbnail cache" cleared nothing under 500 MB

- **Root cause.** The button invoked `moodboard:prune`, whose handler
  called `pruneThumbCache()` with its DEFAULT 500 MB budget. That is an
  LRU trim: under the budget it deletes nothing and returns happily,
  and the renderer toasted "Thumbnail cache cleared" regardless. Since
  essentially every cache is under 500 MB, the button did nothing for
  essentially every user. The mirror-image half: the budgeted trim had
  no automatic caller at all — this button was the only thing that ever
  ran it — so a cache under the cap grew forever and one over it was
  trimmed only by a user pressing a button that claimed to do something
  else.
- **Fix.** Two intents, named separately. `moodboard:clearThumbs` calls
  `pruneThumbCache(0)` and empties the directory (0 is treated as "keep
  nothing", not "trim to 0 bytes" — a zero-byte truncated write fits
  under any budget and would have survived a clear expressed as size
  arithmetic). The 500 MB LRU became the automatic path: it runs once
  per launch, chained after `sweepOrphanThumbs` rather than beside it,
  because both unlink from the same directory. No renderer-supplied
  budget crosses the bridge, so there is nothing new to validate at the
  boundary. **REVERSED by T-79 (see the entry above): that second half
  was wrong.** Behind the sweep, the only files an LRU can reach are
  ones a board still refers to, so the budget was deleting user data by
  construction. The budget is gone; `pruneThumbCache` is
  `clearThumbCache()` and launch runs the sweep alone. The clear half of
  this fix stands.
- **Test.** `src/main/search/moodboard.test.ts` — the clear-vs-trim
  block is now "clearThumbCache — the button empties it, whatever it
  holds (T-29, T-79)"; the zero-byte case survives as the clear's own,
  the budget cases died with the budget.
  `tests/e2e/references.spec.ts` — the old two-direction defect pin is
  now "Clear thumbnail cache empties the cache under the budget too",
  and the launch test is the protection test T-79 flipped it into.
- **Lesson.** **A toast is a promise; the call under it has to be the
  thing the promise says.** "Prune" and "clear" are different operations
  and a default argument is not a place to decide which one a user
  asked for. The other half of this entry taught the opposite of what it
  claimed: **a maintenance routine with no automatic caller is a
  question, not a bug** — before wiring one up, ask what it will be
  allowed to delete at the moment it runs. Here the honest answer was
  "only things the user still wants", which is a reason to delete the
  routine rather than to schedule it.

### Bug (T-40) — undo coalescing never closed, so two drags were one step

- **Root cause.** `historyKey` marks a run of high-frequency mutations
  as one undo step ("range:<clipId>", "grade:<clipId>", ...), and it
  only ever reset on a discrete action, on undo/redo, or on selecting
  another clip. A key can say "the same kind of edit as last time"; it
  cannot say "a different gesture of that same kind". So two
  consecutive trim drags, two crop drags, four colour sliders and the
  Reset that followed them all collapsed into a single step, and one
  Undo threw away every one of them. `video-core.spec.ts` had been
  written around it — its trim-end drag comes after an undo/redo, which
  is what re-opened the window.
- **Fix.** `endGesture()` on the store closes the window (a no-op when
  none is open, since every pointerup in the studio reaches one), and
  the surfaces that own a gesture call it when the gesture ENDS:
  Timeline's window `mouseup`, the crop rectangle's `onDragStop` /
  `onResizeStop`, the aspect-preset and Reset buttons that share the
  crop key, the Player's I/O marker presses, and — via one bubbling
  `onPointerUp` + `onBlur` pair on each panel rather than props on every
  control — the speed slider, the four grade sliders, the rename fields
  and the overlay editor's inputs.
- **Test.** `src/renderer/src/modules/video-studio/store/videoStore.test.ts`
  — "two consecutive trim drags are two undo steps, not one", plus the
  cases pinning that one open gesture still collapses and that the
  no-op cannot swallow a step. `tests/e2e/video-core.spec.ts` — "two
  consecutive trim drags are two undo steps (T-40)" drives two real
  drags back to back with nothing in between, and the colour-and-motion
  test now walks Undo/Redo through slider, slider, Reset as three steps.
- **Lesson.** **Coalescing needs an end event, not just a key.** Any
  "batch the next N events into one" scheme has to be told when the
  batch is over by whatever owns the gesture — mouseup, drag stop,
  blur — because the events themselves cannot tell you. If the only
  thing that closes your window is a different KIND of action, then
  doing the same thing twice in a row is silently one thing.

---

## 2026-08-26 — T-28 + T-73 + T-64: the dialogs, and what each of them only half was

Three bugs about dialogs. Two of them are the same shape as bugs this
file already records — a rule written where it was found rather than
where it holds (T-65/T-71/T-72), and a key consumed without being
prevented (T-34) — arriving in a place nobody had looked.

### Bug (T-28) — Rename and first-save were dead: Electron has no window prompt

- **Root cause.** `MoodBoardPanel.onRename` and
  `ReferencePanel.ensureCollection` both asked for a name with the DOM's
  `prompt`. Electron does not implement it: the renderer throws
  "prompt() is and will not be supported.", the click handler dies
  there, and nothing at all happens — no dialog, no toast, no error, the
  board keeps its name. Two controls that looked completely healthy.
  The first-save half was worse: its Save button was ALSO disabled
  whenever there were no boards, which is precisely the state that
  branch exists for, so the flow was unreachable *and* broken and the
  disabled button is why nobody noticed. Its continuation then re-read
  the boards directory and took `list()[0]` as "the one I just made" —
  right only because the list is sorted newest-first and nothing else
  had happened.
- **Fix.** One `<NameDialog>` (a `<Modal>` around the same inline text
  field the create-board row uses) serves both flows: pre-filled and
  pre-selected for a rename, empty for the first save, Enter or the
  button to confirm, a blank name unconfirmable, and Escape / Cancel /
  scrim leaving everything untouched. The rename still goes through
  `renameCollection`, so it stays undoable like every other board edit.
  `createCollection` now RESOLVES with the new board's id, so the
  first-save continuation saves into the board it just made rather than
  into whichever one sorts first. Save is never disabled: having no
  board is a reason to ask for one.
- **Test.** `tests/e2e/references.spec.ts` — the old
  "defect: Rename throws instead of renaming" pin is now
  "the Rename dialog renames on Enter and on the button, and both
  cancels leave disk alone" (every path asserted against the board JSON,
  plus undo/redo), and "saving a result with no board yet names one,
  creates it, and saves into it" drives the first save end to end with
  the thumbnail served over a socket the test owns and the cached file
  compared byte-for-byte. `tests/unit/interactionWiring.test.ts` parses
  every file in `src/` with the TypeScript compiler and fails on any
  call whose callee is `prompt`.
- **Lesson.** **A renderer API that Electron does not implement fails as
  a throw inside a click handler, which is the quietest failure mode
  there is** — no red screen, no toast, no console anyone is reading,
  and a control that looks fine. `alert`, `prompt` and `showModalDialog`
  are the list; the guard is a repo-wide scan, not a fix at the two call
  sites that happened to be found. And the second lesson, free with the
  first: **a disabled control is a place bugs go to hide.** Ask why the
  state it refuses exists — if the answer is "so it can ask the user
  something", the control should be enabled and do the asking.

### Bug (T-28, found by the E2E) — Enter confirmed the dialog, then reopened it

- **Root cause.** T-34's double-advance, exactly, in a new place.
  `NameDialog`'s Enter handler confirmed and closed the dialog; the
  focus trap's cleanup then restored focus to the button that had opened
  it; and Chromium applied the SAME keypress's default action to
  whatever was focused by then — clicking the opener and reopening the
  dialog. The rename had already landed, so the symptom was "it worked
  and the dialog is still up", which reads like the close is broken.
- **Fix.** `e.preventDefault()` on the Enter we consume.
- **Test.** Both new references E2E tests assert the dialog count is 0
  after an Enter; the mechanism was found by the first run of them.
- **Lesson.** Second instance, so it is a rule now: **a key handler that
  consumes a key AND moves focus must preventDefault it.** The default
  action is applied late, against wherever focus ended up, so "I handled
  it" and "the browser will not also handle it" are two separate
  statements and only one of them is free.

### Bug (T-73) — one Escape closed every open dialog

- **Root cause.** Each open dialog registered its own window keydown and
  closed on any Escape it saw. Reachable today by pressing `?` over a
  tutorial coachmark: one Escape dismissed the shortcuts overlay AND the
  tour behind it. The same gap T-72 closed for the `?` key itself, one
  key over.
- **Fix.** A claim stack in `hooks/useFocusTrap.ts`. Each dialog takes a
  numbered claim while it is open and asks `isTopmost()` before acting
  on a key — Escape and Tab both. The claim is an ID released by
  identity, not a depth compared against a count, so an out-of-order
  close leaves the survivor live rather than inert. `<Modal>` also moved
  to `z-[1200]`, above the coachmark's `z-[1000]`: the dialog that owns
  the keyboard has to be the one on top of the screen, or the overlay
  `?` raises is dimmed under a scrim and unclickable.
- **Test.** `tests/e2e/home-chrome.spec.ts` "Escape closes only the
  topmost dialog" (one Escape closes the overlay, the coachmark
  survives, a second closes it, and `elementFromPoint` proves the
  overlay is really on top). `useFocusTrap.test.ts` pins the pure
  predicate at every ordering; `interactionWiring.test.ts` pins that
  both dialogs consult it, because Modal-over-Modal is not reachable in
  today's app and no DOM test can reach that half.
- **Lesson.** **Window-level listeners are broadcast, not delivery.**
  Every handler for a key sees every press of it, so "the newest one
  wins" is a claim that has to be stated somewhere both handlers can
  read. Count-based guards answer "is anyone else here"; only an
  identity claim answers "am I the one who should act".

### Bug (T-64) — the coachmark said aria-modal and trapped nothing

- **Root cause.** `role="dialog" aria-modal="true"` with no Tab trap and
  no focus restore, written before `Modal` existed and never revisited.
  Tab walked straight out into the studio behind the scrim — controls
  the mouse cannot reach (the scrim eats clicks) and the keyboard can,
  which is the worst of both. Rider: the 300 ms target poll built a
  fresh rect object every tick and handed it to setState unconditionally
  (React compares by identity, so an unmoved target re-rendered the card
  ~3x/s) and re-issued `scrollIntoView({behavior:'smooth'})` with it, so
  the page crawled under a coachmark nobody had touched — 7 scrolls in
  two seconds, measured.
- **Fix.** `Modal`'s trap moved into `hooks/useFocusTrap.ts` and the
  coachmark calls it — one implementation, two dialogs, the T-15
  `useUndoRedoHotkeys` precedent. The poll compares before it writes
  (`sameRect`, half-pixel epsilon) and the scroll fires once per step,
  because bringing a target into view belongs to ARRIVING at a step, not
  to watching it.
- **Test.** `tests/e2e/home-chrome.spec.ts` — "the tutorial coachmark
  traps Tab and restores focus to its opener" (red on the unfixed build:
  one Tab landed on `Home`) and "scrolls its target into view once per
  step, not 3x a second" (red: 7). `Tutorial.test.ts` pins `sameRect`
  including a hair over the epsilon; disabling the shared trap fails the
  coachmark test AND both pre-existing Modal-contract tests, which is
  what "shared" means.
- **Lesson.** **`aria-modal="true"` is a promise about the keyboard, not
  a label.** An element that claims it owes a focus trap and a focus
  restore, and the way to keep that promise everywhere is one
  implementation every dialog calls — a second copy is a second thing to
  forget. And for polls: **a timer that recomputes state must compare
  before it writes.** A fresh object is never equal to the old one, so
  an unconditional setState turns "watch for a change" into "re-render
  forever".

---

## 2026-08-17 — the release runner catches platform-sensitive TESTS, again (v1.5.0)

### Bug — two wave-era tests failed only on windows-latest
- **Root cause.** Two test constructs that every linux run waves
  through: (1) protocol.test.ts compared the no-file-access recorder's
  verbatim paths (forward slashes — what the handler passes to fs)
  against `path.join`-built expectations (backslashes on win32);
  (2) autosaveCorruptInfo.test.ts slices AutosaveRestore.tsx between
  multi-line indexOf markers containing bare \n — a CRLF checkout
  (core.autocrlf) makes indexOf return -1 and the slice silently comes
  out EMPTY, so `expect('').toContain(...)` was the failure, not the
  product.
- **Fix.** Separator-insensitive comparison at the assertion (the
  recorder stays verbatim); LF-normalize the source at read time.
- **Test.** The same two, now green on both platforms (linux locally;
  win32 by the re-run release workflow).
- **Lesson.** Third instance of the class (pathToFileURL drive
  letters, filter availability, now separators + line endings): **a
  test that touches paths, file contents, or platform binaries is
  itself platform-sensitive code.** Structural tests that slice source
  by multi-line markers must normalize line endings; path comparisons
  must normalize separators. The release workflow's test steps remain
  the only Windows execution — treat every red there as a gift.

---

## 2026-08-17 — T-65 + T-71 + T-72: a rule that was only ever enforced where it was found

Three bugs, one shape: a rule the app genuinely holds — square pixels,
color comes from tokens, a dialog owns the window — written down at the
one call site where somebody hit it, and nowhere else. Each survived
because the places it was missing looked exactly like the places it was
present.

### Bug (T-65) — auto-cropped exports were anamorphic by ~0.25%

- **Root cause.** `autoCropForAspect` can only snap a crop to even
  pixels, so a 16:9 target off a 1080x1920 source crops 1080x606 —
  1.7822:1, not 1.7778:1. `scale` preserves the SOURCE display aspect
  rather than forcing square pixels, so ffmpeg banked the difference as
  `SAR 405:404` and the file every player stretched back to 1.782:1 was
  the "1920x1080" one the user uploaded. T-12 had fixed exactly this in
  `runReframe` and `concat.ts` already carried it, but the fix was
  written as a fact about those two graphs instead of a rule about
  crop-then-scale, so `filters.ts` — the graph every platform export
  goes through — never got it.
- **Fix.** `setsar=1` on the shared `scaleFilter`, mirroring
  `runReframe`'s `crop,scale,setsar=1`. One line, and it covers every
  preset, every custom preset and every effect stacked after the scale.
- **Test.** `tests/integration/media.spec.ts` — "an auto-crop that
  cannot land on the exact target aspect still ships square pixels"
  exports the portrait fixture to the YouTube preset and probes the
  real encode for `SAR 1:1` / `DAR 16:9`. Red on the unfixed build:
  `expected '405:404' to be '1:1'`. The autoZoom test gained the same
  SAR assertion, because `zoompan` runs AFTER the setsar and a filter
  appended past the scale is exactly how this would come back. The
  T-50 custom-vs-platform identity test now pins the shared value
  absolutely as well as relatively — an equality alone passes happily
  when both paths are wrong together.
- **Lesson.** Square pixels are a property of any crop-then-scale
  graph, not of the graph where the bug was reported. When a fix is a
  one-line invariant, grep for the shape (`scale=` here, all four
  hits) in the same pass and either fix or explicitly exempt every
  one — the ticket that found it names one site, and the other sites
  will not name themselves. And it is Layer 5 that can see this at
  all: SAR is not in the command string, it is in the file ffmpeg
  wrote.

### Bug (T-71) — three meanings lived in raw Tailwind palette classes

- **Root cause.** The palette had no semantic tier, so danger, warn and
  ok were spelled `text-rose-300`, `bg-amber-300`, `bg-emerald-400`,
  `border-amber-400/40` in a dozen files. Tailwind's defaults resolve
  all of them, so nothing fails, nothing looks broken, and a retheme
  walks straight past every one — the same disease as T-56's
  `bg-pink-400` playhead, an order of magnitude wider. One of them
  (`hover:bg-rose-500` on MoodBoardPanel's remove chip, glyph left at
  inherited ink) had been sitting at 2.93:1 the whole time: neither
  color was a token, so no contrast rule ever looked at the pair.
- **Fix.** `danger` / `danger-soft` / `danger-strong`, `warn`, `ok` /
  `ok-strong` in both palette files and the sync test, at the values
  that were already on screen — a rename, not a redesign. Two tiers
  because both were in use and mean different things: the readable
  text tone, and the saturated mark tone under it. No `warn-strong`:
  `amber-400` IS `ember`, so warning surfaces moved onto the token
  that already claimed warnings in the guide, and a test now fails if
  any other token is ever given the ember hex. The chip took
  `hover:text-bg-base` (7.20:1), the same dark-on-fill answer
  `.btn-primary` already uses against accent.
- **Test.** `tests/unit/designTokensInSync.test.ts` — the three tier
  tests, "has no second name for the ember hex", and the AA blocks
  covering each tone on all three surfaces, on a wash of its own strong
  tone, and dark-on-danger-fill. E2E locators that keyed on the old
  class names moved with them (`references.spec.ts`,
  `record.spec.ts` x2, `video-pipelines.spec.ts`, `image.spec.ts`) —
  which is itself the discrimination: a class rename with no test
  pointed at it is a rename nothing can check. Mutations: one wrong
  hex in `tailwind.config.js` reddens the sync test; the notice card's
  `border-ember/40` swapped for `border-danger-strong/40` reddens the
  T-30 references test.
- **Lesson.** "Use tokens" only holds where a test can see a token. A
  className is invisible to typecheck and to unit tests, so the two
  things that make the rule real are the sync test (the name exists in
  both files) and an E2E locator or contrast assertion pointed at the
  site. Corollary found here: the moment a token becomes a `bg-*`
  under text it is a new pairing and needs its own AA check — the
  bright fill tones all need `text-bg-base`, and `ink-base` on them
  looks perfectly fine while failing.

### Bug (T-72) — `?` stacked the shortcut overlay over an open dialog

- **Root cause.** The `?` window listener had only the T-13
  `INPUT`/`TEXTAREA` guard, so it never asked the second question T-68
  had already answered for the studios: who owns the window right now.
  It could not simply call `isModalOpen()` either — HotkeyOverlay
  renders its OWN `Modal`, so once open it is one of the modals the
  guard counts, and the naive version would have made `?` unable to
  close the thing `?` opened, with the panel still promising "Press ?
  again to close." The same shape was live on `/record`: Escape stops
  the take, `?` opens a Modal mid-take, and one Escape reached both
  handlers — checking the shortcut list cost the user their recording.
- **Fix.** `Modal` exposes the count it already kept
  (`openModalCount()`), and the overlay subtracts its own claim:
  `openModals <= (overlayOpen ? 1 : 0)`. RecordStudio's Escape takes
  the plain `isModalOpen()` guard, since it owns no modal.
- **Test.** `tests/e2e/image.spec.ts` (T-68 test, extended) — `?`
  behind the Variants dialog leaves exactly one dialog up and it is
  the Variants one; with nothing open `?` opens AND closes the
  overlay. `tests/e2e/home-chrome.spec.ts` — the third dismissal path.
  `tests/e2e/record.spec.ts` — `?` mid-take, Escape closes the overlay
  only, Stop still on screen, then Escape really does stop. Unit:
  `HotkeyOverlay.test.ts`, the four count/self cases. Red before the
  fix: two dialogs where the test wanted one, and `Stop` gone from the
  recording screen. Mutation: the naive `openModals === 0` guard
  reddens both the unit self-close case and the home-chrome `?`-close.
- **Lesson.** A guard that a component applies to itself needs a
  self-exemption, and the honest way to write one is to subtract your
  own claim from a count rather than to special-case your own name.
  Second: when a global binding is added, check it against every OTHER
  global binding on the routes it covers — `?` and Escape were both
  documented in the same table, on the same route, and nobody had put
  them in a room together.

---

## 2026-08-17 — T-68 + T-69: a control that answers for something that is no longer there

Two bugs, one shape: a claim that stayed true after the thing it
described was gone. A window-level key binding kept answering after a
dialog took the window; a source selection kept naming a window after
the list stopped containing it. Both are silent — the user sees a
control behaving normally and finds out later, from a layer that has
vanished or an error out of `getUserMedia`.

### Bug (T-68) — Delete removed the layer behind the Variants dialog

- **Root cause.** ImageStudio's window `keydown` handler exempted
  `INPUT`/`TEXTAREA` and nothing else, so "is anyone else entitled to
  this keystroke?" was answered by the tag of the focused element
  alone. A Modal is not an element focus happens to be inside — it is a
  claim over the whole window — so with the Variants or Templates
  dialog up, Delete still reached `removeLayer`, R/O/L/P still switched
  the tool on a canvas nobody could see, and the same hole in the
  shared `useUndoRedoHotkeys` let Ctrl+Z rewrite the very document the
  dialog was rendered from. Nothing was visible until the dialog closed.
- **Fix.** `Modal` counts its own open instances and exports
  `isModalOpen()`; ImageStudio's handler and `undoRedoIntent` both
  return early on it. A counter rather than a boolean because dialogs
  stack (a confirm opened inside ExportDialog must not un-guard the
  outer one), and a counter rather than a `[role="dialog"]` query
  because the DOM answer is both wider (any dialog, Modal or not) and
  later (a keydown re-deriving what the component already knows).
- **Test.** `tests/e2e/image.spec.ts` — "T-68: every studio hotkey is
  inert behind an open dialog, and works again after it closes" drives
  Delete, Backspace, R/O/L/P and Ctrl+Z behind the Variants dialog and
  asserts the layer list, the layer names and the tool badge are
  untouched, then closes the dialog and drives the same keys to their
  real end states so the fix cannot be "hotkeys off". Unit half:
  `useUndoRedoHotkeys.test.ts` — "never fires while a Modal is open".
  Red before the fix: `Layers (2)` where the test wanted 3. Mutation:
  with `if (e.modalOpen) return null` deleted, the Ctrl+Z assertion is
  the one that goes red.
- **Lesson.** A window-level key handler needs two guards, not one:
  who owns this KEY (T-63 — a focused button owns Space) and who owns
  the WINDOW right now. The second question has exactly one honest
  source, the component that took the window, which is why the answer
  belongs in `Modal` and not in each studio's idea of what a dialog
  looks like.

### Bug (T-69) — Start recording stayed enabled over "no screens found"

- **Root cause.** `chooseSource` auto-selected the first source only
  when nothing was selected yet (`if (first && !selectedSourceId)`) and
  never looked at the selection again. That is right exactly once — the
  first search. Every refresh after it kept an id the new list might
  not contain, so a user who picked a window, closed it, and hit
  "Refresh sources" had Start recording enabled directly over the T-41
  card telling them there was nothing to record. The refusal arrived
  much later, from `getUserMedia`, in the app's least specific words.
- **Fix.** One reconcile at the point the list is replaced: keep the
  selection if the new list still has it, otherwise take the first
  entry, otherwise null — which turns the old auto-select into a
  special case of the same rule instead of a second one. The failure
  path reconciles against an empty list too: a refresh that was refused
  has no more claim to a stale id than a refresh that came back empty.
- **Test.** `tests/e2e/record.spec.ts` — "T-69: a refresh reconciles
  the selection — dropped when the list empties, moved when it changes"
  walks the real screen, a stubbed-empty refresh (Start disabled, T-41
  card up), a changed list (selection moves to a source that IS listed,
  Start stays enabled), and a refused refresh. Red before the fix:
  Start enabled after the empty refresh. Mutations: dropping instead of
  reselecting kills the auto-select the first refresh depends on;
  keeping any selection while the list is non-empty leaves the
  surviving source unselected.
- **Lesson.** A selection is a reference into a list, and every
  replacement of that list is a chance for the reference to dangle.
  Reconcile it where the list is assigned — the one place that knows
  both the old id and the new list — rather than trusting the control
  that reads it downstream to notice.

---

## 2026-08-17 — T-56 + T-61 + T-63 + T-66: the layer on top must not eat the gesture, the number, or the sentence

Four small UI residues across three studios, and three of them are the
same shape: something drawn or handled ON TOP of a surface quietly took
what belonged to the surface underneath. A decoration took the pointer
(T-61), a container key handler took the key (T-63), a stale message
took the answer (T-66). The fourth is the reason the other three lived
so long unseen: what nothing can measure, nothing corrects (T-56).

### Bug (T-61) — a cut drag that started on an existing cut did nothing

- **Root cause.** wavesurfer 7.12's `Region.initMouseEvents` calls
  `makeDraggable(element)` unconditionally — `drag: false` /
  `resize: false` only make `onMove`/`onResize` no-ops, they do not
  stop the listener being attached. That draggable's document-level
  `pointermove` handler calls `preventDefault()` the moment the
  threshold is crossed, and `enableDragSelection`'s handler — added
  later, on the wrapper, so it runs second — opens with
  `if (t.defaultPrevented) return`. Press on a stored cut and the new
  drag was consumed by a region that had nothing to do with it: no
  selection, no chip, no error. The exact gesture a user makes to widen
  a cut, answered with silence.
- **Fix.** Stored cuts are marks, not controls — they are removed
  through their chips — so the mark is now pointer-transparent:
  `region.element.style.pointerEvents = 'none'` at `addRegion`. No
  pointerdown on the region, no draggable, and the gesture is an
  ordinary drag selection wherever it starts. The behavior chosen is
  "creates its own cut", not "extends the one under the press": that is
  what a drag already does everywhere else on the waveform (a drag that
  ENDS inside a cut has always got its own chip), and the panel copy
  promises one drag, one region.
- **Test.** `tests/e2e/audio.spec.ts` — "waveform drag makes cut
  regions, and cut chips remove them" now drags 70% -> 95% starting
  squarely inside the 60%..80% cut and asserts a fourth chip whose
  start is inside that cut and whose end runs past it, plus
  `pointer-events: none` on the mark itself. The T-36 "starts in the
  gap" workaround note is retired. Red: the drag helper timed out with
  `the drag never reached its extent (last read: NaN)` — the selection
  region never existed.
- **Lesson.** Look for the listener, not the flag. A library that
  offers `drag: false` has told you what its region will DO, not what
  it will LISTEN to; the two are different questions and only the
  source answers the second. And the general rule this repo keeps
  re-learning: anything drawn over an interactive surface has to be
  `pointer-events: none` unless it is itself a control. The Timeline's
  clip range and playhead already carry that comment.

### Bug (T-63) — Space on a focused crop preset went to the transport

- **Root cause.** The Player's key handler sits on the column that
  holds the crop row, the picture and the transport, and exempted only
  `INPUT`/`TEXTAREA`. A `<button>` is neither, so Space on a focused
  crop preset reached `togglePlay()` — and its `e.preventDefault()`
  then suppressed the button's OWN activation on keyup. The ticket
  described this as "activates the button AND toggles playback"; the
  red run showed worse. The preset never applied at all: the class
  stayed `bg-bg-hover`, the video started rolling, and the only thing
  the keypress did was the thing it was not aimed at.
- **Fix.** `if (tag === 'BUTTON' && e.key === ' ') return`. Per-key,
  not per-element: Space is how a keyboard user clicks a button, so the
  button owns it — while `,`, `.`, the arrows and I/O mean nothing to a
  button and stay available from anywhere in the column, which is what
  makes them feel global inside the player. Scoping the whole handler
  to `e.target === e.currentTarget` would have been fewer characters
  and would have cost the user those four bindings after any click.
- **Test.** `tests/e2e/video-core.spec.ts` — "player transport" focuses
  the 1:1 preset, presses Space, and asserts the preset applied, the
  video stayed paused and the playhead did not move, then presses
  ArrowRight from that same focused button and asserts the nudge still
  lands. The pre-existing Space-from-the-column coverage above it is
  untouched.
- **Lesson.** A key handler on a container is a claim over every key of
  every control inside it. Exempt by what the focused control does with
  THAT key, not by what kind of element it is — and remember that
  `preventDefault()` on keydown reaches forward into the activation the
  browser was going to perform on keyup, so a container handler that
  fires on a control does not merely double up, it can replace.

### Bug (T-66) — "No results." printed underneath a failure notice

- **Root cause.** The panel's two conditions were written for two
  states that were once far apart: an amber notice for "the search
  could not run", and "No results." for `results.length === 0`. A
  notice response also carries zero results, so both rendered — and
  since T-30 routed the first-hop failure through the notice too, that
  pair is the COMMON failure view: an outage message with "the search
  ran and found nothing" printed under it.
- **Fix.** One condition — `&& !response.notice`. The delete toast in
  MoodBoardPanel got the other half of this ticket: reversible since
  T-58, so it says so ("Deleted — press Ctrl+Z to undo."). No other
  studio advertises undo in a toast, so this is the pattern to copy,
  not to diverge from.
- **Test.** `tests/e2e/references.spec.ts` — the notice test asserts
  "No results." is absent in both notice phases, and a new phase 4
  stubs `search:images` in MAIN to answer the way DuckDuckGo answers a
  query with no hits (a normal response, zero results, no notice) and
  asserts the copy IS there — without it, deleting the branch outright
  would have passed. The delete-toast pin now carries the exact
  sentence.
- **Lesson.** Two conditions written for two states are one bug the
  moment a third state satisfies both. When a new failure path is
  routed into an existing view (T-30 did exactly that), re-read every
  other condition on that screen — the new route is what makes an
  impossible pair common.

### Bug (T-56) — a raw palette color and a duration that stopped early

- **Root cause, colors.** The Timeline playhead was `bg-pink-400` and
  the waveform's cut regions were `rgba(244, 63, 94, 0.35)` +
  `bg-rose-500/20` — raw Tailwind palette values, two lines under a
  `tokens.ts` import in one case. Round 19 rethemed the app around them
  because nothing could see them: `designTokensInSync` compares the two
  token FILES, and a color that is in neither file is invisible to it.
  They are now `bg-ember` (a token that existed in `tokens.ts` and was
  missing from `tailwind.config.js` because only JS had needed it) and
  `withAlpha(ACCENT, …)`.
- **Root cause, duration.** The Timeline's coordinate space was
  `probe.duration`. ffprobe reports the container's rounded number and
  the decoder has the real one — 2.000 vs 2.020136 on the fixture — so
  the track's right edge sat ~20 ms short of the end of the file and
  the last frames were unreachable by click, by drag and by End. T-52
  fixed exactly this for the Player's own nudge and the Timeline kept
  the old ceiling.
- **Fix.** The Player publishes the element's duration on
  `durationchange`; `playableDuration(source, mediaDuration)` is the
  one function the track, the `aria-valuemax`, the transport readout
  and `requestSeek`'s clamp all read. Non-finite and non-positive
  values (NaN before metadata, Infinity for a live stream) land as
  null, and a new source clears it.
- **Test.** `designTokensInSync.test.ts` gained the ember pair, the
  playhead's contrast on both the track and the clip-range fill, and
  `withAlpha`'s exact output + its refusals. `videoStore.test.ts` pins
  `playableDuration`, what the element is allowed to publish, and that
  a position past the probe but inside the element is NOT clamped (the
  T-47 restore parks the playhead through that same channel). E2E: the
  keyboard-scrubber pin now asserts `aria-valuemax` and End land on the
  element's duration, and the scrub test clicks the far end of the
  track and asserts the playhead lands PAST the probe duration.
- **Lesson.** A checker that compares two files cannot see a value that
  is in neither. That is not an argument against the checker — it is
  the reason a color has to be in the table at all, and why "it is a
  Tailwind class so it must be fine" is the exact shape of the mistake.
  The duration half is the same lesson in numbers: ffprobe describes
  the container, the decoder plays the file, and every surface that
  claims to reach "the end" has to be built on the second one.

## 2026-08-17 — T-49 + T-41 + T-43: a control is a promise, in both directions

One entry for three tickets, because they are one lesson seen from
three sides. Every one of them is a gap between what a control implies
and what the app actually does with it: two preferences the UI let the
user set and then forgot (T-49's watermark corner, T-43's MP4
checkbox), one settings write no user ever asked for (T-43's
mount-write), one state with no words on it (T-41's empty source list),
and one set of words with no state behind it (T-49's dead toast). The
same sentence covers all five: what is on screen is the promise, and
the file on disk and the copy in the panel both have to keep it.

### Bug (T-49) — the watermark remembered half of itself
- **Root cause.** `runExportQueue` persisted `streamerHandle` and
  `filenameTemplate` and nothing else, while the position `<select>` was
  plain component state seeded at `'bottom-right'`. A user who set
  `@handle` + "top left" and came back the next day got their handle in
  the corner they had rejected — and no way to tell, short of exporting
  and looking at the file, because the picker showed the default as
  confidently as it would have shown their choice. Two halves of one
  preference, one of them remembered.
- **Fix.** A `watermarkPosition` settings key, written in the same block
  as the handle (`if (watermark) { … }`, so a blank watermark still
  writes neither) and restored in the same mount effect, guarded against
  a stored value that is no longer one of the four corners. The four
  corners are now one `WATERMARK_POSITIONS` array feeding both the guard
  and the `<option>` list, so a fifth corner cannot be offered by the
  picker and rejected by the restore. Four registries move together, as
  they always do here: the `SettingsKey` union, the IPC allowlist, the
  electron-store schema, and `settingsKnownKeys.test.ts`.
- **Test.** `tests/e2e/video-pipelines.spec.ts` — "the watermark reaches
  the filter graph, and both halves of it survive a relaunch (T-49)"
  keeps the drawtext half and now asserts `watermarkPosition` on disk,
  then relaunches on the SAME userData, re-imports the footage, and
  reads `@imagii_e2e` and `top-left` back off the live panel (the
  two-launch technique record.spec uses for the webcam corner). The
  four-file queue test asserts the pair is absent together when the
  watermark is blank. Red-green: the old pin was
  `expect(JSON.stringify(config)).not.toContain('top-left')`.

### Bug (T-49, second half) — a refusal nobody could ever reach
- **Root cause.** `runExportQueue` opened with a
  `queue.length === 0 → toast.error(…)` branch. The Export button is
  disabled at `totalQueued === 0`, and `totalQueued` is the sum of the
  same `queuedPresets()` the queue loop pushes — so the toast could only
  fire if those two disagreed, which they cannot. Dead copy is worse
  than no copy: it reads as a covered case in review, it survives
  refactors nobody tests, and if the impossible ever happens it is the
  message that has never once been seen by anyone.
- **Fix.** Deleted, with a comment naming the button that does the real
  refusing so the branch is not "restored" by a future reader.
- **Test.** `tests/unit/interactionWiring.test.ts` (+3) — the copy is
  gone from the panel source, the disabling condition is still there
  (delete it and the branch stops being dead), and both watermark keys
  are written in one block. A string nothing renders is invisible to a
  DOM test, which is exactly how it survived long enough to be filed;
  the E2E keeps its toast-log tripwire for the other direction.
  Red-green: re-adding the toast line reds the source pin — as did, on
  the first run, a comment that merely quoted the deleted sentence.

### Bug (T-41) — "no screens found" looked exactly like "not looked yet"
- **Root cause.** `chooseSource` flipped a phase to `'choosing'`, and
  the `'idle'` and `'choosing'` branches rendered identical markup. When
  `desktopCapturer` answered `[]` — a locked workstation, Wayland with
  no portal, macOS with screen recording denied — the placeholder card
  came back verbatim: same button, no message, no spinner, no toast. The
  button looked broken on precisely the systems where the user most
  needs to be told what to do.
- **Fix.** The ambiguous phase is deleted, not patched. `Phase` is now
  `'idle' | 'recording' | 'saving'` and the source list carries its own
  `'never' | 'searching' | 'done'`, which is the question the card was
  actually being asked. Three states, three renders: the invitation; the
  wait ("Looking for screens and windows…", button disabled so it cannot
  be double-fired); and the answer — an amber line in the Audio card's
  own register, "No screens or windows found. Click "Refresh sources"
  after granting screen-recording permission." Adding the wait made an
  error path mandatory rather than optional: a rejected `listSources`
  used to leave a phase nobody could see, and would now leave the wait
  on screen forever, so the catch toasts through `ipcErrorMessage` and
  the `finally` always lands on `'done'`.
- **Test.** `tests/e2e/record.spec.ts` — "zero capture sources says so"
  drives all three states off a main-side `getSources` stub held back
  1.5 s (an instant stub cannot show an in-flight state), asserts the
  exact copy and the amber class, asserts no toast is raised for an
  empty-but-successful search (`[role="status"]`, react-hot-toast's own
  aria wrapper), and then swaps in a THROWING stub to prove the refusal
  path names the fault, strips Electron's invoke envelope, and leaves
  the wait. Red-green: the old pin asserted no "no … found" text existed
  anywhere on the page.

### Bug (T-43) — one preference of three, and a write nobody asked for
- **Root cause.** Two faults with one shape. (a) `convertToMp4` was
  component-local `useState(true)` while the webcam corner was a
  settings key, so the one Record preference a user is most likely to
  change permanently — I want WebM, not a slow convert — reset on every
  visit to the route, including a mid-session trip to Home. (b) The
  corner's persistence was an effect keyed on the value, and an effect
  keyed on a value runs on mount, so merely arriving at /record stamped
  `record.webcamCorner: "bottom-right"` over an absent key. Harmless in
  value and wrong in kind: the settings file recorded a decision the
  user had not made, and "did they choose this or did they walk past it"
  became unanswerable from disk.
- **Fix.** `record.convertToMp4` joins the corner as a settings key
  (same four registries), and BOTH controls now write in their own
  `onChange` instead of through an effect — a write is a user action by
  construction, no `userTouched` ref required. The mount effect is
  reads-only. That is one fewer effect and one fewer piece of state than
  a touched-guard would have cost.
- **Test.** `tests/e2e/record.spec.ts` — "MP4 checkbox persists like the
  corner, and an untouched visit writes nothing (T-43)" snapshots
  config.json's bytes AND mtime once the app has settled on Home, walks
  into /record, waits 2 s (the old mount-write landed inside 200 ms) and
  asserts the file is untouched to the byte; then unchecks, reads
  `false` off disk, proves a Home round trip keeps it, relaunches on the
  same userData and finds the box still unchecked, and re-ticks to prove
  the binding runs both ways. The corner test carries the same
  no-write-on-arrival assertion. Red-green: both old pins
  (`record.webcamCorner === 'bottom-right'` after mere arrival; the MP4
  box checked again after a route round trip) fail on the fixed build.

### Lesson
**A control on screen is a promise about state, and the promise runs in
both directions: remember what the user chose, store only what the user
chose, and say out loud what actually happened.** Three practical rules
came out of this batch. First, a preference is not "persisted" until
the control that shows it is restored from disk on a fresh launch —
half-persistence (the handle without its corner, the corner without the
MP4 box) is the worst state, because the UI looks equally confident
about the value it kept and the value it invented; when a preference
has two fields, write them in one block so a future edit cannot drop
one. Second, persist from the event, not from an effect: an effect
keyed on a value cannot tell a user's choice from a component's
default, so it writes on mount, and every "was this chosen?" question
about the settings file becomes unanswerable. Third — the honesty half
— every state a user can reach needs words, and every set of words
needs a state that reaches it. The two failures look opposite and are
the same review question, asked in each direction: for this state, what
does the panel say, and for this sentence, what does the user do to see
it? An empty result rendered as an untouched panel is a lie by
omission; a toast behind a condition that cannot occur is a lie in the
other direction, and neither one shows up in a test that only drives
the happy path.

---

## 2026-08-17 — T-54 + T-46: the image capture had one more thing the canvas showed and it did not

One batch, one lesson, third round running on the same helper. T-45
took the window's zoom out of the export MATH; T-53 took the editor's
chrome out of the export CONTENT; this pair finishes the list — the
part of the document that was never in the render tree at all, and the
one capture path that had never been routed through the shared helper.

### Bug (T-54) — every export dropped the document's background
- **Root cause.** `doc.background` was applied as a CSS `background` on
  the Konva stage's container element (`Canvas.tsx`'s `<Stage style>`).
  Konva's `Stage._toKonvaCanvas` draws NODES into a fresh off-screen
  canvas; a CSS property on the host element is not a node and is not in
  that canvas. So every export lost it: a PNG of the 1280x720
  `yt-thumb-bold` template came out with a fully transparent
  `rgba(0,0,0,0)` where the canvas showed `#241614`, and the JPG — no
  alpha channel to carry the hole — composited the same pixels onto
  BLACK. The user's thumbnail was a dark design on screen and a
  transparent-or-black design in the file. It survived T-45 and T-53
  because every export assertion to that point read the PNG header
  (size) or compared two exports of the same doc to each other (chrome):
  both are blind to a background that is uniformly missing from every
  byte in every case.
- **Fix.** The background is now the first NODE of the document layer —
  a `<Rect name="background" width={doc.width} height={doc.height}
  fill={doc.background} listening={false} />` — and the CSS property is
  gone. Chosen over the two capture-time alternatives (adding a
  temporary background layer inside `captureDocument`, or compositing
  the captured data URL onto a filled canvas): both leave TWO renderers
  of one property, CSS for the screen and a fill for the file, which is
  precisely the split that caused the bug and would have to be kept in
  step by every future export path. As a node it is one render, so
  screen and every capture — single PNG/JPG, emote pack, variants, and
  anything added later — agree by construction, `captureDocument` needs
  no change at all, and there is no capture-time mutation to flicker or
  to strand on a throw. `listening={false}` keeps the empty-canvas click
  on the Stage, which is what deselects. It is deliberately NOT tagged
  `chrome`: that tag means "hide for the capture", the exact opposite of
  why this node exists. Transparency needs no branch and no per-export
  control — a `transparent` fill draws nothing, so the overlay and emote
  templates (whose whole point is an alpha channel) still export
  transparent, and the same is true of any doc the user sets that way.
- **Test.** `tests/e2e/image.spec.ts` — "the document background lands
  in the bytes, and a transparent doc stays transparent" exports the
  1280x720 template as PNG and as JPG and samples one document pixel out
  of the real bytes with the repo's own bundled ffmpeg
  (`format=rgba,crop=1:1:x:y` — the `format` first because a JPEG
  decodes subsampled and `crop` rounds a 1x1 box down to 0x0), asserting
  exactly `{36,22,20,255}` for the PNG and within a JPEG tolerance for
  the JPG; the probe point is guarded against every layer box derived
  from the template module, so "background" is a claim and not a hope.
  It then applies the emote template through the Templates dialog and
  asserts the corner of the 112px pack member has `a === 0`, with the
  centre pixel asserted to be the circle's own fill as a positive
  control — otherwise "transparent corner" would also pass on an export
  that came out empty. `tests/unit/interactionWiring.test.ts` (+3) pins
  the three facts a later edit could quietly undo: the rect is first in
  the document layer, the CSS property has not come back, and the node
  is not tagged chrome. Red-green: on the unfixed build the PNG probe
  read `{0,0,0,0}` and the JPG probe `r=0` against 36; both flipped with
  the fix. The T-45 window-invariance and T-53 four-way chrome
  byte-identity tests were re-run and stay green — the background is
  constant across window sizes and chrome states, so painting it cannot
  break an equality between two exports of the same document.

### Bug (T-46) — variants showed a dead canvas, and saved at window size
- **Root cause.** Two faults in one dialog, both from it being the one
  capture path nobody had touched. (a) `ThumbnailVariants` kept
  `previews` in component state and only early-returned on `!open`, so
  the instance and its previews survived a close — and every edit. Close
  the dialog, hide a layer, reopen: four renders of a canvas that no
  longer existed, with the Generate button hidden precisely BECAUSE
  `previews` was non-empty, so there was no way back to a fresh render
  except the Regenerate button buried under the stale tiles. (b) It had
  its own local `getStageDataUrl()` calling `stage.toDataURL()` raw —
  the last raw stage capture in the renderer, T-53 having deleted the
  other one — so saving the "Warm" variant of a 1280x720 template wrote
  956x537, exactly the T-45 defect, months after T-45 fixed it in
  `ExportDialog`. The existing test asserted `pngSize(warm).w > 0`,
  which is true of every PNG ever written.
- **Fix.** (a) The previews now carry the document they were rendered
  from: `useState<{ doc, items } | null>`, and the render uses them only
  while `previews.doc === doc`. The store replaces the `doc` object on
  every edit and hands the same object back on undo, so identity IS the
  question being asked. Reopening an untouched canvas keeps the work;
  reopening after any edit shows the Generate button again. Clearing on
  close was the smaller change and the worse one — it throws away a
  render nobody invalidated. (b) The local capture is deleted; the base
  render goes through `captureDocument` like everything else, so a
  variant is the document at 1:1, without the editor's chrome (T-53) and
  with the background (T-54) — a variant of what the user sees.
- **Test.** `tests/e2e/image.spec.ts` — "variants: generate four tiles,
  save one, regenerate, save all" pins the saved bytes at exactly
  `1280x720` (the old assertion was `w > 0`) for the single Save and for
  all four of Save all, having first asserted the on-screen stage is NOT
  1:1 so the number is a claim about the capture; and drives the reopen
  both ways — untouched keeps the four tiles, hidden-layer shows zero
  tiles and the Generate button. `tests/unit/interactionWiring.test.ts`
  (+4) pins the `captureDocument` route, the absence of any raw stage
  capture, the identity check, and that Generate and Regenerate are the
  same handler (which is what makes the E2E's re-read proof cover both).
  Red-green: the unfixed build reported `956x537` where `1280x720` is
  now asserted, and four tiles where zero are; the old stale pin
  (`stale === urls` with Generate absent) is inverted.

### Lesson
**A capture pipeline is only as complete as its least-visited path, and
"what the canvas shows" includes everything the canvas shows.** Four
rounds on one export: the zoom (T-45), the editor's furniture (T-53),
the background (T-54), and a second capture path that had silently kept
its own copy of the original bug (T-46). Two rules fall out. First: when
a property is rendered one way for the screen and another way for the
file, the file will eventually be wrong — the durable fix puts the
property in the render tree BOTH paths already share, rather than
teaching the export path to reproduce it. Second: one shared capture
helper is only a fix for the call sites that actually call it. T-45 and
T-53 both landed in `captureDocument` and both were correct, and a
component fifty lines away kept a private `stage.toDataURL()` and stayed
broken through both. When a helper is introduced to make a mistake
unrepeatable, grep for the mistake, not for the helper. And note again
what hid it: dimension assertions are blind to content (T-53's lesson),
and equality assertions between two exports of the same document are
blind to anything uniformly missing from both. Only sampling an actual
pixel against an expectation derived from the document catches a
background that was never drawn.

---

## 2026-08-17 — T-59 + T-60 + T-57: three ways to lie about a failure

One batch, three failures in main-process error handling. They are
different bugs with one family resemblance: in each, the code knew
something had gone wrong and the user did not.

### Bug — a crashed convert kept the wreckage and reported in ffmpeg
- **Root cause.** T-44 taught `promoteTempWebm` to tell a deliberate
  cancel from a crash, and then fixed only the cancel: the crash branch
  was a bare `throw err`. So a real ffmpeg failure left the half-written
  .mp4 sitting at the name the user picked in the save dialog — killed
  long before the moov atom, openable by nothing — and rejected the IPC
  with ffmpeg's own sentence, which Electron wrapped and the renderer
  toasted whole: `Error invoking remote method 'recording:finalize':
  Error: convert-to-mp4 exit 1: <stderr tail>`. The reaping and the
  cancel were coupled for no reason other than the order the tickets
  were written in; ffmpeg leaves the same unplayable stub either way.
- **Fix.** The unlink moved above the branch, so both outcomes reap.
  `ConvertFailedError` now carries the exit code and signal as fields
  (T-44's argument, applied one level down: a caller that has to explain
  the failure should not be parsing ffmpeg's message back out of a
  string), `recordingConvertFailureMessage` turns those fields into the
  studio's own sentence — naming the failure, the take, and the one
  checkbox that gets the user a file anyway — and `console.error` keeps
  the real detail in main for the bug report. On the renderer side
  `src/shared/ipcError.ts` strips Electron's invoke envelope, so no
  catch that toasts a rejected `window.api.*` call can leak it again.
- **Test.** `src/main/ipc/recordingCancel.test.ts` — the round-32 pin
  ("crash still strands its partial output") flipped from `toBe(true)`
  to `toBe(false)`, plus the crash/discard discrimination in one test
  and four cases on the copy; `src/shared/ipcError.test.ts` (13);
  `tests/e2e/record.spec.ts` "a convert that really crashes says so in
  plain words and leaves nothing behind" — a real ffmpeg failure, the
  friendly copy asserted present and the envelope, the ffmpeg
  vocabulary and the calm discard copy all asserted absent.
- **Lesson.** When a fix splits a path in two, the half you did not come
  for is now a branch someone deliberately wrote. Whatever the old code
  did on that side is not "unchanged", it is endorsed — so it has to be
  read as a decision and defended as one, or it inherits the bug the
  ticket was about.

### Bug — "Discard recording" killed an unrelated import
- **Root cause.** `convert.ts` held one global slot. Whichever child
  spawned last owned it, so `cancelActiveConvert()` — the recorder's
  Discard button, and before-quit — SIGKILLed whatever happened to be in
  there. A user who dropped an flv on the importer and then discarded a
  take killed the import; the take's own convert ran happily on. The
  same slot made the first of two concurrent converts uncancellable: its
  registration was overwritten, so nothing could reach it, before-quit
  included. Both are the same mistake — the registry recorded "a
  convert" where the callers needed "whose convert".
- **Fix.** One entry per in-flight child, each carrying the owner
  (`'recording' | 'import'`) that cancellation keys on;
  `cancelConverts(owner)` for the buttons, `cancelAllConverts()` for
  before-quit, whose contract genuinely is everything. The entry is the
  job's handle, so a child that finishes clears its own registration
  instead of the whole slot. Per-job semantics from T-44 are untouched:
  the cancelled flag is still set before the kill, and each job still
  rejects with its own `ConvertCancelledError`.
- **Test.** `tests/integration/media.spec.ts` "discarding a recording
  leaves a concurrent import transcode running to completion" — two real
  encodes, one cancel, ffprobe on the survivor (Layer 5, because a fake
  child cannot prove which process the SIGKILL reached);
  `src/main/ffmpeg/convertCancel.test.ts` grew 10 -> 18 (scoping both
  directions, two jobs under one owner, cancelAll, and a finished
  convert no longer clearing someone else's entry).
- **Lesson.** A single-slot registry is a bet that two of the thing can
  never be in flight at once. The bet is invisible at the spawn site and
  is lost by a feature added a year later in another file — here, the
  round-20 change that pointed the importer at the recorder's
  converter. If a cancel button exists, the registry has to know whose
  work it is cancelling, not just that some work exists.

### Bug — an autosave that failed to clear said nothing, then said the wrong thing
- **Root cause.** Two halves. `clearAutosave` wrapped every `unlink` in
  `try {} catch { /* ignore */ }`, so a locked or read-only file
  resolved as success: "Autosave discarded.", banner gone, and the same
  autosave back on the next launch with nothing said. And
  `AutosaveRestore.discard()` had no `catch` at all, so on the days the
  call did reject the promise went unhandled — no toast, the banner in
  an ambiguous state, and (since T-33 made the corruption banner
  renderable) a Clear button users can actually reach doing nothing
  visible.
- **Fix.** `clearAutosave` checks whether each file is actually gone and
  throws naming the survivors — the check is `existsSync` rather than
  the errno, because a file that vanished underneath us is the outcome
  the caller wanted. `discard()` catches, toasts
  `Couldn't clear the autosave: <reason>. It's still on disk — close
  anything using it and try again.`, and dismisses nothing: the file is
  still there, so the banner and its button stay. Clear gained
  `disabled={busy}` to match Discard. The dead `lastRoute` settings key
  went out with it (declared in three places, read by none since T-47
  started restoring the route from the snapshot's `place` record).
- **Test.** `src/main/autosave.test.ts` (clearAutosave reports the file
  it could not delete, and names which one — driven by putting a
  directory in the file's place, which unlink refuses on every OS and
  for root too); `tests/e2e/home-chrome.spec.ts` "a clear that fails
  says so and leaves the banner and the file alone" — the refusal and
  then the same button succeeding, in one launch, so the two copies are
  read side by side; `tests/unit/interactionWiring.test.ts` for the
  catch and the busy gate; `settingsKnownKeys.test.ts` pins `lastRoute`
  deleted.
- **Lesson.** `catch { /* ignore */ }` on a delete is a promise that the
  delete does not matter. It did: it is the whole content of the button
  the user pressed. Swallowing at the bottom and no handler at the top
  is the same bug twice — the failure has to be raised where it is
  known and answered where the user is standing.

---

## 2026-08-16 — T-30: one outage, two different stories

### Bug — a first-hop search failure leaked raw IPC text
- **Root cause.** `searchDuckduckgoImages` scrapes in two hops: the search
  page for a `vqd` token, then `i.js` for the results. Only the second was
  inside the try/catch, so an unreachable network produced friendly copy
  ("DuckDuckGo search failed: …") when it killed the second request and
  Electron's raw `Error invoking remote method 'search:images': Error:
  net::ERR_…` when it killed the first — the same outage, and which
  sentence the user got depended on which request happened to die. The
  first hop was also where `encodeURIComponent` runs, so a query holding a
  lone surrogate rejected the channel before any request went out.
- **Fix.** The T-44 shape, reused: hop 1 raises a `SearchUnavailableError`
  sentinel over its whole region (URL build included), and `runImageSearch`
  — the channel body, lifted out of `ipcMain.handle` so it is testable —
  branches on that class and returns `searchFailureNotice(...)`, the single
  place the copy is written and now shared with hop 2. Anything that is not
  the sentinel is a bug rather than a failed search and still rejects.
- **Test.** `src/main/search/duckduckgo.test.ts` (the old "rejects — it does
  not notice" pin flipped to three typed-sentinel cases incl. the lone
  surrogate); `src/main/ipc/search.test.ts` (`runImageSearch`: both hops
  yield the identical notice object, blank query still short-circuits, a
  good search passes through); `tests/e2e/references.spec.ts` "Reference
  Search surfaces the friendly notice when the network is unreachable" —
  amber notice card carrying `DuckDuckGo search failed: net::ERR_…`, rose
  error card absent.
- **Lesson.** A guarded region that covers *some* of the steps a user thinks
  of as one action is not a guard, it is a coin flip. When an operation has
  several hops that fail the same way for the user, the failure has to be
  named once, at the origin, and translated once, at the boundary — and the
  boundary is where the shape of the answer stops being negotiable.

---

## 2026-08-16 — T-50 + T-42: the UI took a choice it had no way to honour

Two tickets, one root lesson, so one entry. Both are the same class — call
it the **promised affordance**. In each, a control accepted the user's
input, stored it, and rendered follow-on UI that only makes sense if the
choice were going to be honoured. Neither ever honoured it. Nothing threw,
nothing was logged, and both defects were invisible from inside the
component that contained them, because each one's evidence lives somewhere
else: in the file on disk, or in the panel next door.

### Bug — a saved custom export preset could never be used for an export (T-50)
- **Root cause.** `CustomPresetManager` was a complete CRUD surface: name,
  base platform, width, height, fps, both bitrates, save, list, delete,
  a confirm, real JSON files under `userData/export-presets`, and a parser
  hardened in round 14 against corrupt ones. Everything except a consumer.
  `ExportPanel`'s per-clip grid mapped `ALL_PLATFORM_IDS` and nothing else,
  so the five built-in checkboxes were the whole set of export targets a
  clip could have. `Clip.customPresetIds` existed in the type and was
  written by nothing. The modal's own footer said so out loud — "Custom
  presets currently scaffold metadata only" — which is the tell: the copy
  had been updated to describe the gap instead of the gap being closed, and
  once it read as documentation nobody treated it as a bug.
- **Fix.** The grid draws targets, not platforms. `queuedPresets(clip,
  customPresets)` returns the clip's platform presets followed by its
  custom ones, each already resolved to the advisory table's own
  `PlatformInfo` shape, and the grid, the `Export N` count, the safe-zone
  pre-flight and the job queue all iterate that one list — so a custom
  preset is not a parallel code path, it is another row. The encode side
  gets the same treatment: `ExportJobSpec` carries the whole `CustomPreset`,
  and `resolveExportPreset(baseId, custom)` is the single place its
  geometry, fps and bitrates replace the base platform's. `aspectRatio` is
  re-derived from the custom dimensions rather than inherited — a 1280x720
  preset built on Reels would otherwise auto-crop to 9:16 and then stretch,
  which is the wrong picture rather than merely the wrong number.
  Deleting a preset re-reads the list and prunes its id off every clip, so
  the checkbox, the count and the queued job disappear together; the prune
  is deliberately NOT pushed onto the undo stack, because an undo step there
  would offer to re-queue a preset whose file is gone. A job already handed
  to main keeps its dimensions, so an in-flight export finishes at the size
  it resolved. Two guards came with it, both at trust boundaries the feature
  newly crosses: bitrates are validated with one shared `isValidBitrate`
  (the manager refuses to SAVE a preset that could not encode; the export
  IPC refuses to RUN one), and `parseCustomPreset` now requires
  `basePlatformId` to be one of the five platforms instead of any non-empty
  string — the old contract let a hand-edited file resolve to `undefined`
  and throw on the next property read.
- **Test.** `tests/integration/media.spec.ts` "custom export presets (real
  ffmpeg)" (6 cases: encodes at the custom size and not the base's, honours
  the custom fps, crops to the custom aspect with geometry identical to the
  equivalent platform preset, survives autoZoom + hypeShake + speed, two
  presets on one base do not overwrite each other, and a job with no custom
  preset is still the platform path). `tests/e2e/video-pipelines.spec.ts`
  "a custom preset exports at its stored dimensions, and deleting it
  mid-batch leaves the running job alone (T-50)" — saves a preset through
  the real manager, queues it beside YouTube, deletes it while the batch is
  in flight, and ffprobes 960x540 out of the file. The CustomPresetManager
  test carries the flipped pins (grid 5 -> 6 checkboxes; the entry that was
  asserted absent is asserted present, tagged and tickable), the queued-then-
  deleted degradation, and the new bitrate refusal. Units:
  `resolveExportPreset` (7 cases), `videoStore` toggle/prune (10),
  `isValidBitrate` (6), `parseCustomPreset`'s base-platform guard (2), and
  `presetTablesInSync` now pins the renderer's `customPresetInfo` against
  main's `resolveExportPreset` on every base. Mutation: making
  `resolveExportPreset` ignore its custom argument turned five Layer 5
  assertions red with the base platform's numbers (`expected 1280 to be
  1080`, `expected '30/1' to be '24/1'`) and took the E2E ffprobe with it.
- **Lesson.** **A feature is finished at its consumer, not at its store.**
  Round-trip-to-disk is the easy half and the one that feels like progress:
  it has a visible surface, a file you can `cat`, and tests that pass. The
  half that makes it a feature is the place the saved thing gets USED, and
  nothing in the storage half fails when that place does not exist. When
  a control writes something, name the code that reads it before calling
  the work done — and if the honest answer is "nothing yet", that is a
  ticket, not a footer.

### Bug — a ticked webcam box with no camera silently recorded screen-only (T-42)
- **Root cause.** `startRecording` guarded the compositor with
  `if (showCam && effectiveCamId)`, and `effectiveCamId` is
  `selectedCamId ?? cams[0]?.deviceId ?? null`. With no camera attached
  that is `null`, so the entire branch — including its `catch`, which owns
  the only "webcam failed" message the studio has — was skipped. The user
  ticked "Include webcam in recording (picture-in-picture)", got a Corner
  picker as confirmation, recorded, and received a screen-only file with no
  warning at any point. The comment directly above that line said the
  fallback existed to kill "the exact UI-doesn't-match-output bug" — it
  killed the case where the dropdown was untouched, and created the case
  where there was no dropdown. Meanwhile the Audio card one panel over had
  handled its own zero-device state since it was written: `includeMic &&
  mics.length === 0` renders "No microphone found." The Webcam card had a
  `cams.length > 0` branch for its select and no `else`.
- **Fix.** Mirror the mic, in both places it differs. The panel renders the
  warning's twin — same sentence bar the noun, same amber, same slot the
  device select would have occupied — and the Corner picker is gated on
  `cams.length > 0` like the select beside it, because a corner is only a
  choice when there is something to put in one. In `startRecording` the
  guard moves INSIDE the `try`: a missing camera throws `No camera found`
  and lands in the existing catch, so the ticked box that cannot be
  honoured raises the same "Webcam failed: … Recording screen only." toast
  a dead camera raises. One failure path for the whole branch, not one path
  plus a silent hole.
- **Test.** `tests/e2e/record.spec.ts` "webcam checkbox with no camera warns
  exactly like the mic, and offers no Corner (T-42)" (asserts both warnings
  on screen together, so "mirrors" is checkable rather than claimed; select
  and Corner both absent; toggled both ways), "with a camera attached the
  webcam select and the Corner picker both appear (T-42)", and "Start with
  the webcam ticked and no camera says so, instead of silently recording
  screen-only (T-42)" — which drives a real take and matches the toast text
  exactly. The with-a-camera half needed a renderer-side `enumerateDevices`
  stub (`stubCameras`); that lifts the Webcam `<select>` out of the ledger's
  headless-limited block and keeps the Corner select — now gated — covered.
  Mutation: dropping the warning's render turned two named tests red.
- **Lesson.** **When two controls promise the same kind of thing, they need
  the same states, and the pair is the test.** The mic's zero-device branch
  was right there, three JSX lines away, and had been for rounds. What made
  the gap survivable was that each card was read on its own: the Webcam card
  is internally consistent, and only looks wrong beside its sibling. Also:
  **a guard that skips a branch skips that branch's error handling.**
  `if (thing && thingIsPossible)` reads as defensive and is the opposite —
  the impossible case is exactly the one the user must hear about, so the
  possibility check belongs inside the `try`, not in front of it.

### The shared lesson
**A control that accepts input has promised something; find the promise and
test it end to end.** Both defects passed every test that existed, because
every test asked "did the click change the state?" and both answers were
yes. The question that catches this class is the user's: *what did I get?* —
a file at the size the panel showed, a recording with the camera in it. That
question can only be answered where the artifact lands, which is why both
fixes are pinned at ffprobe and at a toast raised by a real take, not at a
checkbox's `checked` attribute. And when a promise cannot be met, saying so
is not an error path bolted on afterwards; it is the feature. The copy that
admits a gap ("scaffold metadata only") and the copy that is simply missing
(no zero-camera hint) fail the user the same way — one lies politely, the
other says nothing at all.

---

## 2026-08-16 — T-34: the coachmark that walked off the window, and the key that pressed itself twice

Both halves of the tutorial's chrome were built for the easy case and left
the hard one to chance: a clamp written for two of four placements, and a
keyboard shortcut that shared one keypress with the browser.

### Bug — a 'left'/'right' coachmark rendered past the window edge with its buttons unclickable
- **Root cause.** `computeTooltipPosition` clamped 'top'/'bottom' cards into
  the viewport horizontally and clamped 'left'/'right' cards only on the
  cross axis — never along the axis they are actually placed on. A 'right'
  step was laid out at `target.left + target.width + 16` and left there.
  Video Studio's step 2 points at `[data-tutorial="video-import"]`, the
  importer that spans the whole content column, so at 1280x800 the card
  started ~1038 px in and ran to 1486 px: a 206 px overhang carrying Skip,
  Back and Next. Eight steps across the four tutorials use left/right.
- **Fix.** One clamp for all four placements, and a documented order that
  MOVES the card instead of shrinking it: the requested side, else the
  opposite side, else the cross axis (a left/right request falls back to
  bottom then top), else the requested side clamped hard into the window.
  Every branch ends at the same clamp, so no placement can leave the
  viewport. The geometry takes the card's MEASURED size — a
  `useLayoutEffect` reads the real card and re-runs the placement before
  paint — because a guessed height decides "this does not fit below" for a
  card that plainly does, and the user then gets a coachmark beside the
  thing instead of under it. The measure/position loop settles in one pass
  because the clamp guarantees the card always has more room to its right
  than it occupies, so CSS shrink-to-fit can never squeeze it and its width
  cannot depend on where it was put.
- **Test.** `tests/e2e/home-chrome.spec.ts` "Video tutorial: the left/right
  coachmark stays inside a 1280x800 window and its buttons are clickable
  (T-34)" — drives that exact step in a real 1280x800 window, first proving
  the target really is too wide for its own side, then asserting the card
  and each button lie inside the viewport, that `elementFromPoint` at each
  button's center is that button, and that clicking Next advances the tour.
  `src/renderer/src/components/Tutorial.test.ts` covers the decisions
  underneath at every placement (61 cases: flips in all four directions,
  the cross-axis fallback, targets past each edge, a target that engulfs
  the window, a window smaller than the card). Mutation: restoring the
  pre-fix geometry (no fit test, no clamp on that axis) fails the E2E at a
  right edge of 1486.625 px, the same number the unfixed build produced.
- **Lesson.** **A clamp that covers some of its cases is a bug with a
  comment on it.** The old code looked deliberate — it called `clamp` on
  every return — but the argument it clamped was the cross axis in half the
  branches, so the half of the placements most likely to overflow (beside a
  full-width panel) were the half left unclamped. When geometry has N
  variants, the escape hatch belongs at the one exit they share, not in each
  branch. And the input that decides "does it fit" has to be the real size:
  a reserved box big enough to be safe is big enough to be wrong.

### Bug — Enter advanced the tutorial two steps
- **Root cause.** One keypress, two advances. The window `keydown` handler
  ran `next()`, React flushed the step change, the step-change effect pulled
  focus onto the newly rendered Next button, and Chromium then applied that
  same keypress's default action to whatever was focused by then — clicking
  Next a second time. The handler already knew about the collision and tried
  to dodge it by ignoring Enter while focus sat on a button, which fixed the
  common case and left the "focus is anywhere else" case advancing 1 -> 3. A
  user paging through with Enter read every other step.
- **Fix.** `e.preventDefault()` on the key the handler consumes. The
  deferral stays for the on-a-button case, so the two mechanisms are
  mutually exclusive by construction: either the button activates the key or
  the window does, never both. The decision is now a pure
  `tutorialKeyIntent({ key, onButton })` beside the other coachmark logic.
- **Test.** `tests/e2e/home-chrome.spec.ts` "Video tutorial: Next / Back /
  arrows / Enter / scrim…" pins BOTH focus states — Enter with focus blurred
  moves exactly one step, and Enter right after a mouse click on Next (focus
  on the button) moves exactly one more. The old test asserted only "greater
  than 1", which is what let the defect sit pinned-but-unfixed for a round.
  `Tutorial.test.ts` covers the intent table. Mutation: dropping the
  `preventDefault()` fails the named test, which never sees step 2.
- **Lesson.** **If you handle a key the platform also handles, say so with
  `preventDefault` — dodging the platform's turn only works until focus
  moves.** The old guard reasoned about where focus IS; the default action
  runs against where focus ENDS UP, which our own handler had just changed.
  And a test that pins a defect should pin the number, not the direction:
  "advanced" was true of both the bug and the fix.

---

## 2026-08-16 — T-38 + T-39: the video preview drew nothing, and the overlays drew in the wrong place

Two tickets in the Video Studio player, both from taking a stand-in for
the thing itself: a global read at the wrong moment stood in for "the
player has a video element", `loadeddata` stood in for "there is a frame
to draw", and the player's black box stood in for the picture inside it.

### Bug — a freshly imported video showed a blank preview until the first undoable edit (T-38)
- **Root cause.** Two independent failures, and fixing either alone
  still left a black canvas. First, `PreviewWrapper` read
  `window.__imagiiVideoEl` **during render** — the render that mounts
  the Player, so the `<video>` does not exist yet and the value is
  always null. `VideoStudio` re-renders on source / clips.length /
  canUndo / canRedo and on nothing else, so the next chance to pick up
  the element came with the user's first undoable edit. Second, even
  once `OutputPreview` had the element, it redrew on `timeupdate` /
  `seeked` / `loadeddata` — and `loadeddata` promises DATA, not a
  painted frame. Instrumented in the real app, `drawImage` at the
  moment the React effect ran after `loadeddata` produced an all-black
  canvas about half the time, and nothing else was ever going to redraw
  a paused video, which is why the E2E suite had to PLAY the clip to get
  a frame on screen at all.
- **Fix.** The Player publishes its element through an
  `onVideoElement` prop as the ref attaches, and `VideoStudio` holds it
  in state — the preview has it on the very next render, no global, no
  render-phase read. The ref callback is a `useCallback` so React
  attaches it once instead of detaching and re-attaching (null, then the
  element) on every render. `OutputPreview` drops its `tick` state and
  its three media listeners for one `requestVideoFrameCallback`,
  re-armed inside its own callback: it fires when a frame has been
  PRESENTED, which is the only moment there is something new to mirror,
  and it covers the first frame, seeks, and playback with one
  subscription.
- **Test.** `tests/e2e/video-core.spec.ts` "output preview: a freshly
  imported video draws a real frame with no edit first (T-38)" — asserts
  the canvas is the platform's 135x240 rather than an undrawn canvas's
  300x150, that its pixels differ from a same-size canvas carrying only
  the preview's own black backdrop, and that **Undo is still disabled**
  on both sides, so the test cannot pass by accidentally editing
  something. The two tests that used to play the clip first now wait for
  that first frame instead, and `parkPlayhead` is gone with them.
  Mutation: dropping the `onVideoElement(el)` call leaves the canvas at
  300x150 and the test fails on the size.
- **Lesson.** **A render-phase read of a mutable global is a read of the
  past, and an event named for data is not an event about pixels.** If a
  component needs a DOM node another component owns, the owner has to
  publish it (ref callback -> state), because nothing re-renders the
  reader when a ref quietly changes. And when the question is "can I
  draw this video yet", the platform has a callback that answers exactly
  that; media-readiness events answer a different one.

### Bug — crop and safe-zone overlays drew across the letterbox, and the crop row sat inside the player (T-39)
- **Root cause.** Both overlays were `absolute inset-0` — pinned to the
  player's black box — while being SIZED from the video's client box.
  The box is the full column width and the video is centered `w-auto`,
  so every guide and the whole crop rectangle were drawn ~190 px to the
  left of the picture they describe. Each overlay also watched only the
  video element with a `ResizeObserver`, and a window resize moves a
  centered video WITHOUT changing its size, so the offset was not even
  recomputed. Separately, `CropOverlay` returned its control row and its
  rectangle as one fragment rendered inside the black box, so the row
  rendered as a flex sibling of the `<video>` — beside the picture,
  squeezing it — while the tutorial's crop step says "tick 'Crop' above
  the player".
- **Fix.** One `useVideoContentRect` hook in `Player.tsx` measures where
  the picture actually is: the element's offset inside the box plus the
  `object-fit: contain` fit of the media's intrinsic aspect inside the
  element's box. The fit is `computeCropBox` from `@shared/safeZone` —
  the centered rect of a given aspect inside a frame is the same
  geometry whether the frame is a source image or an on-screen box, so
  there is no second copy of it. The hook observes the CONTAINER as well
  as the video, which is what makes a resize-without-a-size-change
  reach the overlays. Both overlays became dumb: they take that rect and
  position themselves on it, and their duplicated observers are gone.
  `CropOverlay.tsx` now exports `CropControls` (the row, rendered above
  the player, per the usability tiebreaker — move the controls, not the
  copy) and `CropOverlay` (the rectangle, inside the box where the
  black-box `overflow-hidden` still clips its dimming shadow). The
  aspect presets normalize against the SOURCE frame instead of the
  on-screen box, which is what the stored rect has always meant to
  ExportPanel and OutputPreview.
- **Test.** `tests/e2e/video-core.spec.ts` "overlays: the crop rect and
  the safe-zone guides sit on the picture, not the letterbox (T-39)" —
  computes the picture's viewport rect from the element itself
  (independently of the product helper), asserts the guides' `<svg>` and
  the crop rectangle match it to the pixel at **two window sizes**
  driven through `BrowserWindow.setSize`, first checking each time that
  the black box really is 40+ px wider than the picture so the
  assertion cannot pass on a box-anchored overlay. It also asserts the
  crop row's bottom edge clears the top of the black box. Mutation:
  anchoring the rect at the container's own box (x: 0, w: outer.width)
  fails with the guides at 32 px where the picture is at 222.5 px.
- **Lesson.** **An overlay belongs to the picture, not to the element
  that happens to contain it.** A `<video>` is centered inside its box
  and letterboxed inside itself, so two offsets stack up before a single
  guide is drawn; anchor to the box and the app confidently draws a
  promise about framing over a black bar. The same measurement rule
  follows: observe what can MOVE the thing, not only what can resize it.
  And when a tutorial's copy and the layout disagree about where a
  control lives, the copy is the promise the user was given — move the
  control.

---

## 2026-08-16 — T-33 + T-47: a contract nobody could see, and a session that ended at the last debounce tick

Two tickets in the autosave subsystem. The first was a banner that could
not render because the producer and the consumer of one field disagreed
about when it exists. The second was the feature that disagreement was
hiding: closing imagii and reopening it brought back the work but not the
session.

### Bug — a corrupt autosave showed the user nothing at all (T-33)
- **Root cause.** `AutosaveRestore.tsx` gated its corruption branch on
  `result.info.ageMs !== undefined`, and `main/autosave.ts` returned
  `{ exists, filePath, sizeBytes }` — no `ageMs` — for exactly the files
  that fail validation, because the age was computed from the project's
  own `savedAt` and an unparseable file has none. Every corrupt autosave
  therefore rendered the empty branch: no banner, no **Clear** (the only
  in-app way to delete the bad file), and not even the "Last autosave: …"
  status line. Both halves were individually reasonable; nothing in
  either file said what `ageMs` promised, so neither side was wrong on
  its own terms and the pair was dead code.
- **Fix.** Name the field's meaning and make both sides keep it. `ageMs`
  is now "how long ago this autosave was written", sourced from `savedAt`
  when the file validates and from the file's **mtime** when it does not —
  the filesystem knows when the bytes were written even when the bytes are
  garbage. `savedAt` stays absent for a corrupt file, because that one IS
  the in-file value and there is none to trust. The renderer's corruption
  branch now asks only whether the file exists: age is decoration there,
  never a gate, and staleness is not a gate either — an old corrupt
  autosave is not restorable, so hiding it only leaves it on disk with no
  way for the user to hear about it.
- **Test.** `tests/unit/autosaveCorruptInfo.test.ts` — the file that used
  to pin the mismatch now pins the contract from both ends, with the
  corrupt file backdated ten minutes so an mtime-derived age is
  distinguishable from `Date.now()`, and a valid file whose `savedAt` and
  mtime disagree so it is observable which half answers.
  `tests/e2e/home-chrome.spec.ts` "a corrupt autosave says so — Dismiss
  hides it, Clear deletes the file" flips T-21's "offers nothing" defect
  test into the banner path, with Clear driven to a deleted file.
  `src/main/autosave.corruption.test.ts` carries the same shape at the
  reader. Mutation: re-omitting `ageMs` on the corrupt branch fails the
  unit pins and the E2E on `(just now)` -> `(unknown)`; restoring the old
  renderer gate makes the banner disappear again.
- **Lesson.** **An optional field is a contract, and a contract with no
  written meaning is where two correct files meet as a bug.** When one
  module gates on the presence of a value another module omits by
  construction, no test on either side can see it — the mismatch only
  exists in the gap. Write the meaning at the type (`ageMs` says what it
  measures and where it comes from in each case), and make presence a
  property of the data being available rather than of one particular
  source being available.

### Bug — restoring a session armed Undo with the restore itself (T-47)
- **Root cause.** `applyProject` put the canvas back through
  `canvasStore.setDocument`, which is the *edit* path: it pushes the
  previous document onto the undo stack. With Home's global undo now
  tracking every studio (T-32), the app came back from a restore with
  Undo lit and "last: Image Canvas" showing — offering to revert work the
  user had never done, and one click away from throwing the restored
  session out.
- **Fix.** `resetDocument` takes an optional document, and the restore
  goes through it: the document is replaced and the history is cleared,
  which is what "open a file" means everywhere else. The T-32 undo
  tracker needed no change at all — it counts each store's history
  lengths, so a restore that grows no history moves no entry. Contract:
  **right after a restore there is nothing to undo in any studio.**
- **Test.** `ProjectIO.test.ts` "leaves the canvas history EMPTY, so the
  app never opens offering to undo the restore" (with a pre-existing step
  proving the restore clears rather than adds);
  `tests/e2e/continuity.spec.ts` asserts `last: no recent change` with
  both buttons disabled immediately after Restore. The two T-32 E2E tests
  that used to arm Undo *with* a restore now arm it with a real edit made
  on the restored canvas and assert the restored layer survives the Undo.
- **Lesson.** **"Load" and "edit" must not share a setter.** A function
  that records history is a function about user intent; restoring, opening
  and importing are not user edits, and routing them through the edit path
  makes the app's first offer after launch a destructive one.

### Bug — the restored playhead was rewound by the Player's own mount reset (T-47)
- **Root cause.** T-52 gave `Player` an effect that zeroes the transport
  and the store's `currentTime` on mount, because a remounted Player
  attaches a fresh `<video>` at 0 and the stale store value would draw a
  playhead the video was nowhere near. A session restore parks the
  playhead *before* navigating to `/video`, so the Player mounted second
  and its reset threw the parked position away — the seek subscription
  only ever hears changes made after it subscribes.
- **Fix.** Treat `seekRequest` as a one-reader mailbox. The Player empties
  it as each seek lands, so a request still sitting there at mount can
  only have been posted while no Player existed — which is exactly the
  restore case — and the mount effect applies it instead of zeroing.
  Everything else is untouched: with the request consumed on arrival, a
  scrub followed by leaving and returning still resets to 0, which is
  T-52's contract.
- **Test.** `tests/e2e/continuity.spec.ts` lands the restored playhead on
  the media element within half a frame (the suite's `SEEK_TOLERANCE`);
  `video-core.spec.ts` "leaving and returning resets it (T-52)" is
  unchanged and still green, which is what proves the mailbox is empty on
  the ordinary path.
- **Lesson.** **A reset that exists to discard stale state has to be able
  to tell stale from pending.** Both look like "a value from before this
  component existed". The discriminator is not age but whether anything
  has consumed it — so consume explicitly, and the two cases separate
  themselves.

### Bug — quitting lost the last few seconds of work (T-47)
- **Root cause.** Nothing was wrong; nothing existed. Autosave was
  debounced at 5 s in the renderer and that was the only writer, so the
  snapshot offered on the next launch was the last debounce tick, not the
  last state. Editing and immediately closing the window lost the edit.
- **Fix.** On quit, main asks the renderer for one last capture and writes
  it. Both exits are hooked because they are not the same path: the
  window's X fires `close` while the renderer is alive and `before-quit`
  only after it is gone, while `app.quit()` fires `before-quit` with the
  window still up. The whole exchange — round trip plus disk write —
  races a single 1.5 s deadline, so a wedged renderer or a spun-down disk
  costs the user that and no more; the previous snapshot stays intact.
  Nothing crosses back to the renderer: an outcome a quitting UI cannot
  show is not worth the T-44 risk of leaking raw IPC text.
- **Test.** `src/main/quitFlush.test.ts` drives the branch a manual test
  cannot: a write that never settles returns `'timeout'` inside the
  budget, a silent renderer does the same, and neither leaves an IPC
  listener behind for the next quit to resolve on.
  `tests/e2e/continuity.spec.ts` adds a clip and closes the window
  immediately, then reads the third clip back off the file.
- **Lesson.** **A debounce is a promise about the steady state, not about
  the end of one.** Any batching writer needs a flush at the lifecycle
  edge it batches across — and the flush needs a deadline, because the
  one moment the user is guaranteed to be watching is the moment they
  asked the app to go away.

## 2026-08-16 — T-36 + T-55: an event handler's name is not its timing

Two tickets that met in the same 40 lines of wavesurfer. One shipped a
gesture that needed doing twice; the other made every synthetic gesture
in the E2E suite a coin flip. Both came from believing what an event is
called rather than reading when it fires.

### Bug — drag-to-cut needed two gestures, and the panel promised one (T-36)
- **Root cause.** `WaveformView` subscribed to the new region's
  `update-end` from inside the regions plugin's `region-created`
  handler, on the reasonable-sounding theory that a region is created
  when the drag starts and finishes updating when the drag ends. In
  wavesurfer 7.12.6 it is the other way round.
  `enableDragSelection` (`dist/plugins/regions.esm.js`) constructs the
  Region on the drag's first move and appends its element directly,
  but calls `saveRegion(region)` — the only thing that emits
  `region-created` — from the `"end"` branch, i.e. when the button comes
  up. And `update-end` is emitted by the region's OWN draggable, which
  never saw the pointerdown for the gesture that created it, so it never
  fires for that gesture at all. The first drag therefore left a
  selection region and no cut; the cut only appeared once the user
  grabbed that leftover region and nudged it — a second gesture the
  panel copy ("Drag on the waveform to select a region to cut") never
  mentions.
- **Fix.** Commit on `region-created`, which for a user drag IS the end
  of the drag, and remove the selection region there. The trap that made
  the obvious fix wrong: the stored cuts are re-rendered through
  `addRegion`, which emits the same `region-created` **synchronously,
  from inside the call**, so any marker the caller sets on the returned
  region is not set yet — a `__cut` boolean assigned after `addRegion`
  returns is always `undefined` when the handler reads it, and every
  re-render would commit the whole list again, unbounded. The id is the
  only thing that exists that early, so `CUT_ID_PREFIX` is now both what
  stored cuts are named and what the commit handler skips on, and the
  `__cut` marker is deleted rather than kept as a second source of
  truth.
- **Test.** `tests/e2e/audio.spec.ts` "waveform drag makes cut regions,
  and cut chips remove them" — the round-24 tripwire (`toHaveCount(0)`
  after one gesture) is flipped to `toHaveCount(1)`, `dragCut` lost its
  second gesture, and the test now also drives a third drag that runs
  into an existing cut and asserts three chips / three regions / no
  leftovers, which is what runs away if the id guard is dropped.
- **Lesson.** **Read the emitter, not the event name.** `created` and
  `update-end` both sound like they bracket a gesture; in this library
  one fires at the end of it and the other never fires for it. And when
  a library emits an event synchronously from inside a factory call, the
  object it hands you is not yet the object you configured — any guard
  that keys on a property you set afterwards is reading the past. Key on
  something the constructor already knows, like the id you passed in.

### Bug — one E2E test failed per full-suite run, a different one each time (T-55)
- **Root cause.** Not load, not rAF, not the app. Playwright's
  `page.mouse` dispatches synthetic events over CDP and never moves the
  machine's real pointer, so the browser's pointer bookkeeping still
  refers to wherever that pointer is parked — under a headless X server,
  the middle of the virtual screen, which every Electron window in the
  suite is centred over. When a second Playwright worker maps its
  Electron window there, the display server sends a crossing event and
  Chromium delivers a document-level `pointerout` with
  `relatedTarget: null` while our button is still down. wavesurfer's
  `makeDraggable` routes `pointerout`/`pointercancel` to the same
  handler as `pointerup`: a null `relatedTarget` ends the drag, saves
  the region at whatever width it had reached, and removes the
  `pointermove` listener. Konva drops its cached pointer position and
  `Canvas.tsx`'s move handler swallows the event. Everything sent after
  that point is discarded — so a helper that spends `steps: 8` twice
  inside the button-down window has sixteen chances to be cut off, and
  the resulting short drag commits a plausible-looking wrong value
  instead of failing.
- **Fix.** `tests/e2e/drag.ts`, one contract for every synthetic drag:
  press and move in the same wire batch, send the destination rather
  than a staircase of intermediate positions, and — the half that makes
  it honest — poll the app's own drawn state (the selection region's
  right edge, the preview shape's width, the readout the handle drives)
  until the extent has landed BEFORE releasing the button. A crossing
  event after that point is harmless, because the gesture is already
  where it was going. Repeats of the same destination are free at every
  gesture layer involved (they work from absolute position or from a
  delta against the last move they PROCESSED), so the destination is
  sent three times: enough that one dropped event does not kill the
  gesture, short enough that the exposure is ~50 ms instead of ~500.
- **Test.** The helper is used by `tests/e2e/audio.spec.ts` `dragCut`,
  `tests/e2e/image.spec.ts` `dragOnStage`, and `video-core.spec.ts`'s
  trim-handle and timeline-scrub drags. The mechanism itself was pinned
  by experiment, not by assertion: mapping a second Electron window
  while the button was down truncated the waveform drag 5 times out of 5
  with the old `steps: 8` shape and 0 times out of 5 with the new one,
  and the pointer log showed every discarded move being delivered to the
  document and ignored by the app.
- **Lesson.** **A synthetic gesture is not the gesture the app sees.**
  Injected input bypasses the pointer the browser thinks it has, so
  anything the environment does to that pointer — another window
  mapping, a dialog, focus moving — lands in the middle of a drag that
  cannot notice. The defence is not more steps or a retry; it is to
  release only once the app has shown you the state the gesture was
  supposed to produce, so a truncated gesture fails by name instead of
  committing something that merely looks reasonable. Corollary for the
  runner: this needs two windows on one display to happen at all — the
  same suite ran 25/25 green under `--workers=1` on the same loaded box.

---

## 2026-08-15 — T-44 + T-48: the message and the outcome were computed separately

Two tickets, one root lesson, so one entry. Both are the same class: the
feedback the user sees was decided by *which line of code ran*, not by
*what actually happened to their file*. In one the app called a
deliberate discard a crash; in the other it called a refusal a success.
Neither is a rendering bug — in both, the code that knew the truth threw
it away before the toast was chosen.

### Bug — "Discard recording" reported a crash and left a broken file behind (T-44)
- **Root cause.** `cancelActiveConvert` SIGKILLs the ffmpeg child, and
  `convertToMp4`'s `close` handler saw only `(code=null,
  signal='SIGKILL')` — indistinguishable from a crash — so it rejected
  with `convert-to-mp4 exit signal SIGKILL: <stderr tail>`. That
  rejection travelled up through `recording:finalize` as a rejected IPC
  and `finalizeRecording`'s catch toasted `err.message` verbatim, so
  asking to throw a take away produced "Error invoking remote method
  'recording:finalize': …" in error styling. The calm "Recording
  discarded." copy existed the whole time — the cancelled-save-dialog
  branch used it — but the discard button could never reach it. And
  because `promoteTempWebm`'s `finally` reaps only its own temp `.webm`,
  the half-written `.mp4` ffmpeg had already started writing at the
  user's chosen path stayed there: a file with the name they picked
  that no player can open, because the kill lands long before the moov
  atom.
- **Fix.** The cancel is recorded where it is known. `cancelActiveConvert`
  marks its child `cancelled` before killing it, and the close/error
  handlers reject with a `ConvertCancelledError` sentinel instead of an
  exit-code error. `promoteTempWebm` catches that one class, unlinks the
  partial output, and returns `null` — the same "nothing was saved"
  answer a cancelled save dialog gives, which the renderer already
  renders as the calm discard toast. No renderer change, no string
  matching on ffmpeg output, and both save paths (legacy `recording:save`
  and streaming `recording:finalize`) are fixed by the one guard because
  they share that tail. A genuine convert failure still rejects with its
  text intact.
- **Test.** `src/main/ffmpeg/convertCancel.test.ts` (10 cases: clean
  exit, non-zero exit keeps its stderr tail, cancel rejects as
  cancelled and NOT as SIGKILL, cancel-then-error, slot cleared, and a
  later failure is still a failure); `src/main/ipc/recordingCancel.test.ts`
  (finalize returns null and the partial mp4 is gone on cancel, rejects
  with the ffmpeg text on a crash); `tests/e2e/record.spec.ts` "Discard
  recording kills the running convert, says so calmly, and leaves no
  file behind" drives the real ffmpeg kill and asserts the trash-icon
  toast, the absent file, an empty recordings dir and untouched recents.
- **Lesson.** **A process you killed on purpose cannot be identified by
  how it died.** Exit code and signal describe the corpse, not the
  intent; every cancel path must record "this was us" at the moment it
  fires, and callers must branch on that fact rather than pattern-match
  the failure text downstream. The renderer is the wrong place to guess:
  by then the only evidence left is a string.

### Bug — chat highlight "+ clip" claimed a clip it never added (T-48)
- **Root cause.** `ChatHighlightPanel.addPeak` clamped the padded END of
  a peak to the source duration but never the START, so a chat log whose
  timestamps run past the loaded video (a trimmed VOD, a clip of one
  segment, the wrong file) produced a reversed range — start 15 s, end
  2 s. `addClipFromRange` rejects reversed ranges by design (Phase 2.12)
  and returns silently, and the panel called `toast.success('Clip
  added')` on the next line unconditionally. The user got a success
  message and an unchanged Clips list.
- **Fix.** Both ends clamp to the duration, and the panel reports what
  the store did: `addClipFromRange` now returns `true`/`false`, and the
  success toast fires only on `true`. The refusal says what is actually
  wrong in the panel's own voice — "That spike is past the end of this
  video — check the log matches this source." A peak that merely
  overruns the end still clamps and lands, so the refusal is about the
  moment being outside the video, not about padding hitting the edge.
- **Test.** `src/renderer/src/modules/video-studio/store/videoStore.test.ts`
  "return value reports what actually happened" (true only when the clip
  joined the list; false for reversed, zero-length, non-finite, no
  source, and the collapsed range a past-the-end peak clamps to);
  `tests/e2e/video-pipelines.spec.ts` ChatHighlightPanel negatives assert
  the refusal copy with no "Clip added" toast and no new clip, then the
  overrunning peak landing as `0:00 → 0:02`.
- **Lesson.** **A store action that can refuse must say so, and its
  callers must ask.** "Validate as if any caller might be wrong" (the
  2026-05-07 entry on this same function) is only half the contract —
  a silent reject leaves every caller free to invent a success. Make the
  refusal part of the return type, and gate user-facing confirmation on
  it: `toast.success` on the line after a call that can no-op is a bug
  waiting for the input that triggers it.

### The shared lesson
**Feedback is an assertion about the world, so derive it from the world.**
Both bugs read the same way in review — a toast on the line after the
work — and both were invisible until something failed. Wherever an
outcome can vary (a cancel, a refusal, a partial write), the message must
be computed from the outcome value, and the cleanup that outcome implies
must run on the same branch. Also: when a path can end in a partial file
at a path the USER named, deleting it is part of the outcome, not a
nicety — `promoteTempWebm` had a `finally` for its own temp file and
nothing at all for the output it asked ffmpeg to produce.

---

## 2026-08-15 — T-31 + T-32: Home's chrome was mounted per-route while the promise was app-wide

Two tickets, one root lesson, so one entry: both the toast surface and
the global-undo tracker were wired to a component's lifetime when the
thing they promise the user is app-wide.

### Bug — every toast Home raised was silently dropped (T-31)
- **Root cause.** `<AppToaster/>` was mounted by each of the five
  studios and by nobody else. Home is not a studio, so "Project saved",
  "Project loaded", "Restored from autosave", "Autosave discarded." and
  all four of Home's error toasts were dispatched into a page with no
  Toaster to draw them. `toast.error(...)` is not a no-op when the
  surface is missing — react-hot-toast happily writes into its global
  store and every subscriber (there were none) renders it — so the call
  sites looked correct and the failure was invisible from the code. The
  worst case is the silent one: `handleLoad`'s "Couldn't load project:
  …" is the only feedback a rejected project file ever produces, so a
  user who picked a corrupt `.imagii.json` saw absolutely nothing
  happen.
- **Fix.** One `<AppToaster/>` in `App.tsx`, next to `HotkeyOverlay` and
  outside `<Routes>` — the mount that already exists for app-wide
  chrome — and the five per-studio copies deleted. It has to be a move,
  not an addition: react-hot-toast keeps one toast store per `toasterId`
  and every `<Toaster>` without one renders that store in full
  (`node_modules/react-hot-toast/dist/index.js`, the `V`/`T` registry
  and `oe`'s `x.map`), so an app-level mount plus a studio mount draws
  every studio toast twice, in two stacked fixed containers. Dedup is
  by toast id INSIDE the store, never across renderers. The previous
  arrangement had no double-render window only because React Router
  renders one route at a time.
- **Test.** `tests/e2e/home-chrome.spec.ts` — "AutosaveRestore: Restore
  rehydrates the video and image stores" now asserts the Restore toast
  is VISIBLE on Home and lands in the MutationObserver log (it asserted
  the opposite, as T-21 finding A), and counts `[data-rht-toaster]` as
  exactly 1 on Home and again on the Video Studio route — the count is
  what would catch a re-added studio mount. The studio side is a
  positive control in the same file: "RecentFilesMenu…" still reads
  'Video loaded' and the FixWizard test still reads 'Loaded', both
  raised inside studios that no longer mount a Toaster of their own.
  `tests/unit/interactionWiring.test.ts` — "T-31 — the toast surface is
  mounted app-wide" (+3) pins the mount and that no studio has a copy.
  Red-green: deleting the App.tsx mount fails the count assertion, and
  with that line removed too, the visibility assertion times out.

### Bug — global Undo could not see studio work, and Redo never enabled (T-32)
- **Root cause.** Two mistakes in one hook, both from tying app state to
  Home's mount. (1) `useGlobalUndo` kept its "which studio changed last"
  record in Home's own `useState`, and subscribed to the three studio
  stores from Home's `useEffect`. Home is unmounted for the entire time
  the user is editing, so the record started empty on every return from
  a studio: the global Undo could only ever undo something that happened
  while Home was on screen, which in practice meant the autosave restore
  and nothing else. (2) Enablement was read with
  `useCanvasStore.getState().canUndo()` DURING render — a call, not a
  subscription — while the hook set an `undoingRef` flag to suppress the
  store event its own `undo()` raised. Suppressing the event also
  suppressed the only thing that would have re-rendered Home, so after
  a click the buttons stayed painted from the pre-click snapshot: Redo
  dark although `canRedo()` was true underneath, Undo lit over an empty
  past. Redo was unreachable through the UI.
- **Fix.** The order lives at module level in `useGlobalUndo.ts`, next
  to the stores whose lifetime it shares: two arrays (`undoOrder`,
  `redoOrder`) and three subscriptions registered at import and never
  torn down. The subscriptions no longer classify events with a flag —
  they count. `reconcile()` makes the number of entries a store holds in
  each array equal that store's own `history.past`/`history.future`
  length, which covers a new change, an undo, a redo and a history reset
  identically and, crucially, covers them whoever ran them: a Ctrl+Z
  inside Video Studio moves the global order exactly like Home's button
  does. `record()` returns early when the `history` object is reference-
  identical (zustand's partial `set` keeps untouched keys), which is an
  exact "was this a history event" test and also filters video's
  coalesced trim drags. The React half is now `useSyncExternalStore` over
  a version counter bumped by that same code path, so enablement is
  re-derived after the click the hook itself made — no flag, no
  `forceUpdate`. Cross-studio ordering falls out of the arrays: Home's
  Undo takes the newest entry that its store can still act on, so edit
  video then the canvas and the first Undo hits the canvas, the second
  hits video, and Redo mirrors it. The 250 ms "let first-render
  synchronisation settle" window is gone with the flag: only real
  history steps arm the buttons, so there is nothing to settle.
- **Test.** `src/renderer/src/hooks/useGlobalUndo.test.ts` (new, 11
  tests) drives the real three stores with no React at all — which is
  the point, since "records studio work with Home unmounted" is exactly
  what the old design could not do: newest-first undo across video and
  canvas, mirrored redo, a studio undoing on its own, a new change
  retiring that studio's redo, a history reset dropping its entries,
  non-undoable mutations (`setTool`, `selectLayer`, `setCurrentTime`,
  `requestSeek`) not arming anything, and the 50-step cap case where
  `past` stops growing. `tests/e2e/home-chrome.spec.ts` — "Home global
  Undo walks the studios newest-first — a video edit and a canvas edit"
  makes both edits INSIDE the studios (Recent-files load + "+ Add clip",
  then "Start with text"), walks Home each time, and drives both Undos
  and both Redos to their end states in the studios; "Home global Redo
  enables after an Undo and re-applies the change" is T-21's finding-C
  pin inverted; the finding-B pin's tail now asserts the record survives
  the round trip instead of being wiped. Red-green: all three T-21 pins
  passed on the pre-fix build and failed on the fixed one before being
  rewritten. Mutations: re-scoping the tracker to Home's mount (a
  `homeMounted` flag set in an effect, arrays cleared on unmount) turns
  both cross-route positives red at `last: Video Studio` / Redo-enabled;
  making `bump()` a no-op turns the Redo test red at the readout;
  deleting the capped-push branch reds only the 50-step unit test;
  dropping the `redoOrder` reconcile reds five of the eleven.
- **Lesson.** **Chrome that promises something app-wide has to be
  mounted app-wide — and "app-wide" includes the state behind it, not
  just the element.** Both halves of this entry are the same mistake at
  different depths: a toast surface that only exists on five of six
  routes, and a change tracker whose subscriptions only exist while one
  route is rendered. The tell in both cases is a lifetime mismatch — the
  data (zustand stores) outlives the component, so anything derived from
  it that lives in the component starts from zero every time the user
  navigates. Second tell, specific to undo: a suppression flag whose job
  is "ignore the event my own action raised" is almost always hiding a
  classification problem. Deriving the meaning of a change from the
  before/after state (past and future lengths) needs no flag, is correct
  for actions taken through other doors — the studio's own Ctrl+Z — and
  does not have to swallow the event that keeps the UI honest. And per
  the usability tiebreaker: a disabled button that is disabled only
  because nothing re-rendered is worse than a broken feature, because
  the app is telling the user there is nothing to redo when there is.

---

## 2026-08-15 — T-52: the Timeline drew a playhead the video was nowhere near

### Bug — leave Video Studio, come back, and the marker lied
- **Root cause.** Two objects can answer "where is the playhead", and
  only one direction between them was wired. The `<video>` is owned by
  `Player` and is destroyed and recreated every time the studio is
  mounted; `videoStore.currentTime` is module-level and survives route
  changes. The sync was `timeupdate` -> store, which covers playback and
  seeks — but a freshly mounted element sits at 0 and fires NO
  `timeupdate` for it (the media load algorithm only queues one if the
  position actually changed, and a new element's position is already 0).
  So park the playhead at 1.2 s, click Home, click Video Studio: the
  video restarts at 0, the store still says 1.2, and the Timeline draws
  its marker at 60% of a track whose video is at the very start. The
  Player's source-change effect looked like the place that handled this
  — it reset `time` and `playing` — but it only ever touched Player's
  own React state and the media element, never the store, and it was
  keyed on `source.url`, a string DERIVED from the path rather than the
  file's own identity. With click-to-scrub landing in the same ticket,
  the lie got worse: the track now invites a click, and a click lands
  the playhead somewhere the marker disagreed with.
- **Fix.** The effect resets the shared playhead (`setCurrentTime(0)`)
  alongside the local readout, and is keyed on `source.filePath`. It no
  longer writes `video.currentTime = 0`: setting `src` already rewinds
  the element, and that write was the only way this effect could ever
  move a playhead the user placed. The new scrub path goes the other
  way through one channel — `videoStore.requestSeek(seconds)` clamps
  into the source, moves `currentTime` optimistically so the marker
  stays under the cursor on a slow file, and hands the Player a fresh
  `seekRequest` object it applies to the element it owns.
- **Test.** `tests/e2e/video-core.spec.ts` — "timeline: the playhead
  never lies — store churn keeps it, leaving and returning resets it
  (T-52)": parks at 1.2 s, churns the store with an unrelated clip add
  and a grade slider (the playhead must NOT move), then walks Home and
  back and asserts the element is at 0 AND the drawn marker is under 1%.
  Red on the pre-fix build at 60%. Mutation: dropping the effect's
  dependency array (so it re-runs on every render) flips it red at the
  first park instead, proving the assertion reads the real playhead.
- **Lesson.** When a durable store mirrors a DOM object that gets
  recreated — a media element, a canvas, a worker — an event-driven sync
  only covers the directions that fire events. The mount itself is a
  state change nobody emits, so the component that recreates the object
  has to re-seed the store there. And prefer the identity the user
  thinks in (the file path) over a value derived from it (the url) as
  the key for "is this a different thing now".

### Also fixed here — "the duration" is two different numbers
- **Root cause.** `nudge()` clamped to `source.probe.duration`, the
  duration ffprobe reads out of the container. The media element reports
  its own, decoded, duration — 2.000 vs 2.020136 s on the E2E fixture —
  so every tail nudge stopped ~20 ms short of the real end of the file,
  and the last frames were unreachable from the keyboard.
- **Fix.** `nudge()` clamps to `v.duration` when it is finite, falling
  back to the probe's number only before metadata arrives.
- **Test.** `tests/e2e/video-core.spec.ts` — "player: a tail nudge
  reaches the media element own duration, not ffprobe rounded one
  (T-52)" asserts the REQUESTED seek equals `v.duration` to 5 decimals
  and that the playhead lands past `FIXTURE_SECONDS`. The exactness is
  the point: a 20 ms error is smaller than the half-frame landing
  tolerance, so a landing assertion alone cannot see this class of bug.
- **Lesson.** Anything handed back to the media element must be clamped
  by the media element's numbers, not by a probe of the same file. Two
  measurements of "the same" quantity that disagree in the third decimal
  will always eventually meet an assertion that cares — and the test for
  that gap has to be written at a precision that can see it. (Chromium
  also refines `v.duration` from the container's rounded value to the
  decoder's once it has parsed the file, so a test reading it must poll
  for the refined value rather than read it once.)

## 2026-08-15 — T-53: selection handles and the grid were baked into image exports

### Bug — the export contained the editor, not just the artwork
- **Root cause.** Konva's `Stage._toKonvaCanvas` walks the stage's
  children and draws every layer whose `isVisible()` is true. Canvas.tsx
  keeps two layers that are not the document at all: the grid overlay
  (`showGrid`) and the overlay layer that carries the draw preview and
  the `Transformer` — the selection border and its eight anchors. So the
  export path faithfully rendered the app's own furniture into the
  user's PNG. It was reachable from the default flow, not a corner: draw
  a shape (which selects it) or click a layer row, hit Export, and the
  handles ship. Check Grid and the gridlines ship too. `captureDocument`
  had already taken the window's zoom out of the capture (T-45) and this
  survived it untouched, because the two are different mistakes: T-45
  was view state in the output MATH, T-53 was view state in the output
  CONTENT. Nothing caught it because every export test to date asserted
  dimensions — PNG header width and height — and chrome does not change
  the size of the canvas it is drawn on.
- **Fix.** Canvas.tsx tags both editor layers with the Konva name
  `chrome` (`"grid chrome"`, `"overlay chrome"`). `captureDocument`
  reads `stage.getLayers()`, records the prior `visible()` of every
  layer carrying that tag, switches them off, captures, and restores
  each one's PRIOR flag in the `finally` — restore is per-layer, never a
  blanket show-all, so a layer that was already off stays off. The
  exclusion is enumerated rather than inferred from layer order or from
  "does it contain a Transformer": order is an accident of JSX, and a
  future editor-only layer (rulers, guides, a marquee) is chrome the
  moment someone tags it. Putting the hide inside `captureDocument`
  rather than at the call sites means both current callers — single
  PNG/JPG and the emote pack — and every future one inherit it. Nothing
  on screen changes: hide, capture and restore are one synchronous
  block, so the `display:none` Konva writes onto a hidden layer's canvas
  element (`Layer._checkVisibility`) is reverted before the browser can
  paint, and Konva's own redraw is rAF-deferred
  (`Node._requestDraw` -> `batchDraw`), so the frame it eventually draws
  sees the restored flags.
- **Test.** `tests/e2e/image.spec.ts` — "editor chrome stays out of the
  file: selection and grid leave the bytes alone" exports the same
  1280x720 template four ways (deselected/grid-off, grid on, grid on +
  selected, selected) and asserts all four PNGs are byte-identical,
  after first proving two identical clicks already are — otherwise a
  difference would prove nothing about chrome. The chrome is asserted to
  be really on screen at capture time (`layers === 3`, `gridLineCount >
  0`, `transformerNodeCount === 1`) and really back afterwards
  (`hiddenLayerCount === 0`). The four cases are compared as one list so
  a red run names WHICH chrome leaked.
  `src/renderer/src/modules/image-studio/ExportDialog.test.ts` (+4, 13
  total) pins the helper: which layers are still drawing when Konva is
  asked, name matching by whole token (a layer named
  `chromecast-preview` is not chrome), restore-to-prior including
  already-off layers, restore on throw, and chrome staying up between
  the emote pack's three captures. Red-green: on the pre-fix build the
  E2E reported all three cases leaking; with the fix it is green;
  dropping only the grid layer's tag flipped exactly `["grid on", "grid
  on + selected"]` red while `"selected"` stayed green.
- **Riders.** Deleted `Canvas.tsx`'s exported `getStageDataUrl()` —
  zero importers (`ThumbnailVariants.tsx` has its own local function of
  the same name), and it was the last remaining raw `stage.toDataURL()`
  in the renderer, i.e. a ready-made way to reintroduce both this bug
  and T-45. Rewrote `defaultExportScale`'s doc comment, which still
  justified the HiDPI default as making the export "match what the user
  actually SEES on canvas" — the rationale T-45 deleted. The behaviour
  is unchanged and its unit tests pin it; the honest reason is that a
  HiDPI user reviews the deliverable on a screen with two device pixels
  per CSS pixel, so 2x is about the file's crispness on their own
  monitor, not about the canvas.
- **Lesson.** **Editor chrome living in the render tree makes WYSIWYG
  capture a lie by default.** Any canvas app draws two things into the
  same surface: the document, and the affordances for editing it —
  handles, guides, grids, marquees, hover states, in-progress previews.
  A capture API that renders "the visible scene" cannot tell them apart,
  so the default behaviour is always to ship the furniture. The capture
  path must therefore ENUMERATE what it excludes, in one place, with the
  exclusion attached to the chrome itself (a tag) rather than to the
  capture's knowledge of today's layout — order-based or
  content-sniffing discrimination breaks the first time someone adds a
  layer. And note what hid it: dimension assertions are blind to
  content. A test that reads the PNG header can prove the file is
  1280x720 while every pixel in it is wrong; only comparing bytes of the
  same document captured under different EDITOR states can see chrome.
  Per the usability tiebreaker: the file is what the user made, not what
  the editor happened to be showing.

---

## 2026-08-15 — T-45: image exports rendered at screen zoom, not document size

### Bug — "1×" meant "whatever size the window happens to be"
- **Root cause.** `ExportDialog` captured the canvas with
  `stage.toDataURL({ pixelRatio })`. Konva renders a stage at its own
  `width()`/`height()`, and Canvas.tsx sizes the stage to
  `doc.width * stageScale` where `stageScale` is a fit-to-container
  zoom capped at 4×. The document was never in the export arithmetic at
  all — only the viewport was. A 1280×720 template exported at "1×"
  landed as 956×537 in one window and 711×400 in a narrower one, so the
  same click produced a different file depending on how the user had
  dragged the window corner. The emote pack inherited it and multiplied
  it: a 112×112 document sits pinned to the 4× cap, so
  `pixelRatio = size/112` off a 448 px stage wrote 112/224/448 under the
  filenames `imagii-emote-28/56/112` and a toast reading
  "Emote pack saved (3 PNGs: 28, 56, 112)". Twitch rejects those
  uploads. Both shipped green: the unit tests covered
  `defaultExportScale`, which is a different question entirely, and the
  export path had no test that looked at the bytes.
- **Fix.** One helper, `captureDocument` in `ExportDialog.tsx`: read the
  stage's scale, set it to 1, capture with the document box passed
  explicitly (`width: doc.width, height: doc.height`), restore the scale
  in a `finally`. Konva sizes the output canvas `width * pixelRatio`
  (`Stage._toKonvaCanvas`), so the export is exactly
  `doc.width × doc.height` at 1×, and the emote trio is exactly
  28/56/112 — `112 × 0.25` rather than a quotient of two floats that can
  truncate a pixel away. Both export paths (single PNG/JPG and the emote
  pack) go through it. Neutralising the zoom rather than compensating for
  it was the deciding detail: the compensating form,
  `pixelRatio × (doc.width / stage.width())`, is arithmetically right and
  numerically fragile, and "exactly 28" is the whole acceptance
  criterion. Nothing on screen is touched — Konva renders into a fresh
  off-screen canvas, the restore is synchronous, and Konva's own redraw
  is `requestAnimationFrame`-deferred, so it never observes the
  neutralised scale.
- **Test.** `tests/e2e/image.spec.ts` — the two T-25 defect pins flipped
  to positive assertions on PNG header dimensions read off bytes on
  disk: "PNG and JPG export real bytes…" now asserts
  `1280×720 / 2560×1440 / 640×360` for 1×/2×/0.5× (and the JPG path
  matching), "emote pack…" asserts `[28, 56, 112]` on both axes, and
  each first asserts the stage IS zoomed so the claim cannot pass by
  coincidence. New: "the export is the document, not the window: two
  window sizes, same bytes" resizes the real `BrowserWindow` to
  1100×700 and 1560×980, waits for the fit-to-container zoom to move,
  and asserts the two PNGs are byte-identical.
  `src/renderer/src/modules/image-studio/ExportDialog.test.ts` covers
  the helper's contract: the document box is what Konva is asked for,
  the capture happens at scale 1, the on-screen zoom is restored even
  when `toDataURL` throws. Red-green both ways: on the pre-fix build the
  pins passed as pinned and the tripwire read "Expected: not
  [28, 56, 112]" once the fix landed; dropping the explicit box put
  956×537 and 112/224/448 straight back, and dropping only the scale
  neutralisation kept the dimensions right while the two windows'
  payloads diverged — which is what the byte-equality assertion is for.
- **Lesson.** **View state must not appear in output math.** A zoom, a
  scroll offset, a device pixel ratio and a preview size are properties
  of the window the user happens to have open; a file's dimensions are a
  property of the document. When a capture API renders "the thing on
  screen", the export path's job is to take the screen back out of it —
  neutralise the view transform and state the output box explicitly,
  rather than multiplying by a correction factor and hoping the floats
  land. And per the owner's usability tiebreaker: a control labelled
  "1×", a filename reading `-28-`, and a toast promising "28, 56, 112"
  are the product's promise. When the bytes disagree with the label, the
  bytes are the bug — the label does not get quietly redefined to
  whatever the code already did. What made this invisible for so long is
  that string-shape and pure-helper tests cannot see it: only a test
  that reads the PNG header off a downloaded file can tell 1280 from
  956.

---

## 2026-08-15 — T-37: `net.fetch(file://…)` made every video unseekable

### Bug — the playhead could only ever be at 0
- **Root cause.** `registerFileProtocol` answered every `imagii-file://`
  request with `net.fetch(pathToFileURL(path))`. That hands back the
  whole file, 200, no `Accept-Ranges` — the `Range` header the media
  stack sent was dropped on the floor. Chromium treats a resource that
  will not answer a Range request as non-seekable: `video.seekable`
  reads `[0, 0]`, and the HTML spec clamps every assignment to
  `currentTime` into the seekable ranges, i.e. to 0. Playback looked
  perfect because sequential streaming never needs a seek, so the one
  flow everybody exercised hid the break, while the arrow nudges, the
  `,` / `.` frame steps, both frame buttons and any precise positioning
  silently rewound the clip to the start. It shipped that way.
- **Fix.** The handler serves the bytes itself: `stat` for the size,
  `createReadStream(path, { start, end })` through `Readable.toWeb` for
  the body, explicit `Accept-Ranges: bytes` / `Content-Length` /
  `Content-Type` on every response, and `206 Partial Content` with
  `Content-Range` when a `Range` header is present. RFC 9110 semantics
  on the parse, because the header is untrusted input at the same trust
  boundary as the URL: anything invalid or unsupported (garbage,
  reversed spec, multi-range list, unknown unit, non-integer, integer
  too large to be safe) is IGNORED and the full 200 body is served;
  `416` is reserved for a syntactically valid range that misses the file
  (first-byte-pos at or past EOF, zero-length suffix). Dropping
  `net.fetch` also dropped `pathToFileURL` from the handler, and with it
  the entire platform-pinned-URL class the entry below is about.
- **Test.** `src/main/protocol.test.ts` (17 tests to 42, now driving
  real files under `os.tmpdir()` instead of a mocked `net.fetch`):
  exact bytes + `Content-Range` + `Content-Length` for leading,
  mid-file, open-ended, suffix, clamped and `bytes=0-` probe forms, and
  one named refusal case per malformed form. `tests/e2e/
  video-core.spec.ts` — "player seeking: the source is seekable and
  parks mid-file without playing (T-37)" asserts `seekable` spans the
  duration and parks at 1.5 s of a 2 s clip having never pressed Play;
  "player keyboard: nudges and frame steps land the playhead…" now
  asserts where the playhead LANDS (within half a frame at 15 fps) as
  well as what each binding requested. Both were run against the
  pre-fix build first and failed with `seek to 0.4s landed at 0s` and a
  `seekable` end of 0.
- **Lesson.** **A protocol handler is an HTTP server, and a media
  element is an HTTP client with opinions.** `net.fetch(file://…)` is
  not a drop-in way to serve media: the request headers a custom scheme
  receives — `Range` above all — are input the handler has to answer,
  and a handler that ignores them does not fail, it silently loses a
  CAPABILITY. Nothing throws, nothing logs, the feature just quietly
  isn't there. When we hand a browser API a resource, the failure mode
  to go looking for is the reduced capability, not the exception. The
  test corollary is sharper: "the binding requested the right thing" is
  not an end state. Four pins in `video-core.spec.ts` stopped at the
  requested seek and stayed green for the entire life of a 100% broken
  feature — the ledger even recorded the block as a disposition. A
  disposition that says "the end state is unreachable" is a claim about
  the product, and this one was really a bug report nobody had filed.

---

## 2026-08-15 — Round 26 (coverage Wave B): a disposition is a claim, and claims get probed

No product code changed this round, but three findings generalize.

### The ledger wrote off 13 Record elements as "headless-impossible"; 11 of them weren't
- **What happened.** The round-22 sweep dispositioned the entire
  capture pipeline as HL on the assumption that `desktopCapturer`,
  `getUserMedia`, and `MediaRecorder` cannot run in a container. The
  T-27 worker probed before writing: all three work under xvfb. Only
  `enumerateDevices()` is empty (no mic/cam device exists), and
  Chromium's `--use-fake-device-for-media-capture` does not survive
  Electron's command line. Result: real recordings, real WebM/MP4
  bytes, real ffprobe verification — and five shipped defects
  (T-41..T-44) found in a studio the ledger said was untestable.
- **Lesson.** **A disposition is a testable claim about a boundary,
  and the claim gets probed before it gets recorded.** Ten minutes of
  probe script beats a permanent hole in the coverage map. The ledger's
  HL table now records the probe result alongside each boundary.

### `page.on('download')` never fires under `_electron.launch`
- **What happened.** T-25 needed the Image export downloads. The
  Playwright download event — the documented mechanism — simply never
  fires for `a[download]` clicks in an Electron window (probed on both
  page and context). The crossing that works is Electron's own
  `session.will-download` in the main process, which is also a deeper
  end state: real files on disk instead of a download event object.
- **Test.** `tests/e2e/image.spec.ts` export/emote/variants tests.
- **Lesson.** House pattern for every `a[download]` surface. When a
  framework event is silent, drop a level: the main process sees what
  the page wrapper doesn't.

### Watermark/text-overlay pixels are proven on NO platform (drawtext)
- **What happened.** The linux ffmpeg-static build has no `drawtext`
  filter — any export carrying a watermark or text overlay dies at
  graph init on every dev/CI box, so all existing coverage asserts the
  command string at most. The shipped win32 build has the filter, but
  nothing executes it under test. Third instance of the per-platform
  class (mpegts segfault, pathToFileURL drive letters) — ticketed
  T-51 for a win32-gated Layer 5 test that runs where the release
  workflow runs.
- **Closed (T-51).** Layer 5 gained a drawtext block: win32-gated
  positives render a watermark in all four corners and two text
  overlays against a control render of a flat-gray source (region luma
  exact on the untouched quadrants, PSNR bands corroborating, the
  `enable` window proven on and off), and two linux pins fail the day
  ffmpeg-static gains the filter. `release.yml` now runs
  `npm run test:media` after `verify` so the gated half executes.
  Renaming the watermark's filter to `drawtxt` leaves all 1082 unit
  tests green and fails only the linux pin — the string-shape layer
  never covered this graph at all, which is the finding the ticket's
  premise predicted.
- **Lesson.** Per-platform evidence applies to FILTER AVAILABILITY,
  not just binaries and runtimes. When a feature's only executions all
  happen on a platform that can't run it, its coverage is a unit-level
  string assertion wearing an integration test's name.

---

## 2026-08-15 — the release runner is the only Windows execution of the test suite

### Bug — v1.3.0 release run failed: three protocol tests pinned linux-only URLs
- **Root cause.** `pathToFileURL('/home/user/x')` is platform-dependent:
  on win32 a rootless POSIX path resolves against the current drive
  (`file:///D:/home/user/x`). The round-21 protocol positives pinned the
  POSIX form. Every local and CI execution of `npm run verify` happens
  on linux — the Windows release workflow is the only place the suite
  runs on the shipping platform, and it caught them.
- **Fix.** Platform-aware fixtures (win32 uses `C:/Users/...` and
  expects `file:///C:/...`), keeping exact-URL pinning rather than
  building expectations with `pathToFileURL` itself, which would be
  tautological against the handler's own builder.
- **Test.** `src/main/protocol.test.ts` positives, now green on both
  platforms (linux verified locally; win32 verified by the re-run
  release workflow).
- **Lesson.** Extends the round-23 rule: **test evidence is
  per-platform when the RUNTIME is per-platform** — not just the
  binaries. Anything pinning paths, URLs, or path-derived strings must
  either be platform-aware or run on both platforms. The release
  workflow doubles as the de facto Windows CI; treat its verify step as
  load-bearing, not ceremonial.

---

## 2026-08-15 — Round 23b: the eight defects an interaction inventory found (T-13..T-20)

The round-22 sweep walked all ~343 interactive elements instead of testing
the ones we thought mattered. Six controls turned out to be coded, shipped,
and impossible to reach; two more were reachable but wrong. None of it
failed a test, because none of it had one. Every fix below ships with
coverage that fails if the element goes dark again.

### Bug — coded, shipped, unreachable: the shortcut overlay and the preset panel (T-13, T-14)
- **Root cause.** `HotkeyOverlay` was never mounted by any component, and
  `PresetPanel` was never rendered by Audio Studio. Both had complete
  implementations, both were imported by nothing. The overlay's `?` was
  advertised in Player's hint copy and its table was the app's only
  shortcut documentation; the preset panel's `audio:listPresets/savePreset/
  deletePreset` handlers, their validation, and their unit tests all
  existed in main with no UI on the other end. Typecheck is happy with an
  unrendered component; so is every unit test that imports the module
  directly.
- **Fix.** `<HotkeyOverlay />` in `App.tsx` outside `<Routes>` (one
  instance, reads the route via `useLocation`); `<PresetPanel />` in Audio
  Studio's right column under Levels.
- **Test.** `tests/unit/interactionWiring.test.ts` — asserts the mount
  points and that the panel is reachable from `/audio` by walking the
  route's real import graph (`tests/unit/routeSources.ts`). Behavior is
  covered beside each component (`HotkeyOverlay.test.ts`).
- **Lesson.** **An unmounted component is invisible to every layer we
  had.** Unit tests import the module, the typechecker only sees the file,
  and E2E never looks for a control nobody told it about. Reachability is
  its own assertion: for any control that matters, something must prove a
  route can render it.

### Bug — the app's only shortcut documentation had drifted from the app (T-13)
- **Root cause.** `SHORTCUTS_BY_ROUTE` advertised a Space play/pause
  binding for Audio Studio that never existed (the waveform has a play
  *button*), and after T-15 wired Ctrl+Z into Video Studio the table said
  nothing about it. Documentation stored as data still rots — it just rots
  silently, because a wrong row renders exactly as convincingly as a right
  one.
- **Fix.** Table corrected; every row now must be classifiable.
- **Test.** `tests/unit/hotkeyTable.test.ts` — each row is either a
  keyboard claim whose evidence pattern must appear in that route's own
  component tree, or a listed mouse hint. A new unclassifiable row fails
  the suite. Discrimination is proven in the same file: the removed Space
  claim is shown absent from `/audio` and present in `/video`.
- **Lesson.** **In-app documentation is code and needs a test that reads
  the code.** If a doc table can name a binding, a test can go looking for
  it.

### Bug — coachmarks pointing at nothing, in a tour that reported success (T-16)
- **Root cause.** Two tutorial steps targeted `[data-tutorial="video-crop"]`
  and `[data-tutorial="audio-multitrack"]`; no component declared either.
  The Tutorial renders a full-screen step when a target is missing, which
  is also a legitimate design — so a broken step and a deliberate one are
  indistinguishable at runtime.
- **Fix.** `video-crop` on CropOverlay's control row; `audio-multitrack` on
  the SecondaryTrackPanel host wrapper (its root already carried
  `audio-music`).
- **Test.** `tests/unit/tutorialTargets.test.ts` — every step of all four
  tutorials, checked against the components its route can render, plus
  "a step with no target must be a `center` step" so a dropped selector
  can't hide as a design choice. **The first version of this test passed
  with both attributes deleted**: the tutorial definition files are
  reachable from every studio (a studio imports its own tour) and they
  contain the selector strings, so each step proved its own existence. The
  scanner now skips `tutorials/` and ignores `data-tutorial` preceded by
  `[`. Mutation proof: with the attributes removed the suite reports "no
  component reachable from /video declares data-tutorial=video-crop".
- **Lesson.** **A test that reads source text can accidentally read the
  spec instead of the implementation.** Always run a static check against
  the broken state before trusting a green one.

### Bug — controls nested inside other controls (T-17)
- **Root cause.** ClipList put the rename `<input>` inside the row-select
  `<button>` (and needed an `onClick` `stopPropagation` to stop typing from
  selecting); TextOverlayEditor put the remove `<button>` inside the
  `<label>` that wrapped the time fields; PropertiesPanel — which the sweep
  missed — put seven rotation presets inside the Rotation label. Ambiguous
  accessible roles, an unpredictable activation target, and a locator that
  resolves to two overlapping controls.
- **Fix.** Siblings in a flex row in all three; the workaround
  `stopPropagation` deleted with the nesting that needed it; `aria-label`s
  added where the restructure split an accessible name.
- **Test.** `tests/unit/interactiveNesting.test.ts` parses every renderer
  `.tsx` with the TypeScript compiler's own TSX parser and fails on any
  interactive element inside another — repo-wide, so it pins components
  nobody has written yet. Red-green: it failed on exactly three files
  before the fix (including the one the human sweep missed) and passes
  after.
- **Lesson.** **When a sweep finds two instances of a defect, write the
  check that finds the third.** A parser-based structural test costs about
  as much as fixing the two by hand and covers the whole tree forever.

### Bug — a popover only a mouse could close, and a Close button that asked nothing (T-18, T-19)
- **Root cause.** `RecentFilesMenu` dismissed on `onMouseLeave` alone — no
  Escape, no click-outside. Audio Studio's Close called `clearSource()`
  directly, discarding the cleanup chain, every cut region, a loaded second
  track, and the undo history that could have restored them; Video Studio
  had confirmed the same action since round 18.
- **Fix.** Escape + click-outside on the menu (mouse-leave kept), measured
  against the wrapper so the toggle button can still close what it opened.
  `confirmAudioClose` asks first whenever there is anything to lose, and
  stays silent on an untouched chain.
- **Test.** `RecentFilesMenu.test.ts` (dismissal policy, including
  "inside" not dismissing) and `AudioStudio.test.ts` — where the declined
  branch gets its own assertion, because that is the branch that saves the
  work.
- **Lesson.** **Parity between two studios is a testable claim.** When one
  surface guards a destructive action and its twin doesn't, the gap is a
  bug report waiting to be written by a user who lost work.

### Bug — the posting diary lived outside the app's state (T-20)
- **Root cause.** `PostChecklist` persisted to `localStorage` under
  `imagii.postingDiary`, i.e. inside the Chromium profile: wiped by a
  profile reset, absent from project save/load and autosave, invisible to
  every other persistence path in the app. Every other studio's state went
  through the settings store or the project file.
- **Fix.** New `postingDiary` settings key (union + IPC allowlist + store
  schema) with a one-time localStorage migration. A corrupt legacy blob
  yields an empty diary and still retires the key, so a broken value can't
  make every mount re-fail.
- **Test.** `src/shared/postingDiary.test.ts` — parse/normalize, JSON round
  trip, migration precedence (settings always wins, `[]` is a real value),
  and the corrupt-JSON path; `settingsKnownKeys.test.ts` now also pins the
  IPC allowlist and the electron-store schema against each other.
- **Lesson.** **"It persists" is not "it is saved."** Ask which of the
  app's storage layers a value belongs to; a lone `localStorage` call in a
  local-first app is state the user cannot back up, move, or restore.

### Bug — the same keyboard branch copied into three studios (T-15)
- **Root cause.** Audio Studio and Image Canvas each carried their own
  Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z listener; Video Studio — the studio with
  the most undoable actions, and full history in its store since round 18 —
  carried none, so its undo was reachable only from Home's global button.
  Nothing tested any of the three, because a window listener needs a DOM.
- **Fix.** `hooks/useUndoRedoHotkeys.ts`: one hook, one pure
  `undoRedoIntent` decision, used by all three; header Undo/Redo buttons
  added to Video Studio.
- **Test.** `useUndoRedoHotkeys.test.ts` (10 cases including the
  INPUT/TEXTAREA guard and the `key: 'Z'` Chromium reports under Shift);
  `interactionWiring.test.ts` asserts all three studios use the hook and
  that no fourth hand-rolled copy exists.
- **Lesson.** **Extracting the third copy is also how the untested branch
  gets tested.** The pure decision function is the part a node-env unit
  test can drive; the copies that stayed inline never could be.

---

## 2026-08-15 — Round 22: the four bugs round 21's own tests had already found

Round 21 built the Layer 5 and E2E coverage the tickets asked for, and that
coverage immediately turned up four real defects. They were pinned as
`KNOWN BUG` tests (worded to fail once fixed) and filed as T-08..T-12 rather
than fixed in the same round. This round fixes all four and flips every pin
into a positive assertion, so each test named below fails if the bug comes
back. Two of the four had shipped 100% non-functional behind green unit
tests — the same shape as the round-18 autoZoom / ducking / denoise trio.

### Bug — any text file imported as a 640x400 "video", with a full export panel behind it (T-08)
- **Root cause.** ffmpeg's `tty` demuxer registers the `.txt` extension and
  its `ansi` (ASCII/ANSI art) decoder synthesizes a video stream out of
  arbitrary text: ffprobe exits 0 with a 640x400 pal8 stream and a real
  duration. Every check `probeVideo` made — a video stream exists,
  `format.duration` > 0 — was satisfied, so a streamer's notes file loaded
  into Video Studio with a player, a clip, and an Export button. The drop
  zone's extension hint is advisory by design ("may not be a supported
  video — trying anyway"), so nothing upstream stopped it either.
- **Fix.** One codec floor in `src/main/ffmpeg/probe.ts`: a video stream
  whose `codec_name` is `ansi` is refused with "This file is text, not a
  video — pick a video file such as MP4, MOV, or MKV." It sits in
  `probeVideo` because drop, the file picker, and recent-files all funnel
  through it — three entry points, one guard. The wording deliberately
  avoids the trigger words `codec` and `no video stream`, both of which
  `shared/importDiagnostics.describeImportError` rewrites into a different
  message.
- **Test.** Layer 5 `probeVideo refuses a text file that the ansi demuxer
  claims as video` — it asserts ffprobe *still* reports `tty`/`ansi` first,
  so a future pass proves the guard fired rather than that the binary
  changed its mind. `tests/e2e/export.spec.ts` negative upgraded from
  `.log` (where ffprobe itself fails, so the guard was never exercised) to
  `.txt`, asserting the new refusal copy and no loaded state. Mutation
  proof: with the guard's codec name altered, the E2E shows the app
  loading "640×400 · 25.00 fps · ansi · (no audio)", a "Video loaded"
  toast, and the entire export panel.
- **Lesson.** **"ffprobe accepted it" is not "it is a video."** A demuxer's
  job is to find *a* plausible reading of the bytes, not to agree with the
  user's intent, so a format-detection layer needs a plausibility floor of
  its own at the trust boundary. Two corollaries: an advisory warning is
  not a guard; and when a test has to pick its fixture *around* a hole
  (round 21 chose `.log` precisely because `.txt` passed), the hole is the
  finding — write the failing test.

### Bug — highlight discovery and the hook indicator were both 100% non-functional (T-09, T-10)
- **Root cause.** ebur128 prints its per-frame `t: … M: …` lines at the log
  level its `framelog` option selects, and both consumers parse exactly
  those lines out of stderr. `findHighlights` asked for `framelog=quiet`
  and then parsed what it had just silenced; `analyzeClipHook` left
  `framelog` unset while passing `metadata=1`, which demotes the same lines
  below stderr. Neither parser ever saw a sample: `findHighlights` hit its
  `samples.length < 5` early-out and returned zero candidates for every VOD
  ever scanned, and `analyzeClipHook` fell through to its -70 LUFS floor,
  scoring every clip in the app identically.
- **Fix.** An explicit `framelog=info` in both ebur128 commands in
  `src/main/ffmpeg/highlights.ts`, with the reason recorded at both call
  sites so nobody "tidies" it back to quiet.
- **Test.** The two round-21 pins are now
  `findHighlights finds the burst the fixture actually contains` (a
  candidate covering the fixture's 10.0-11.5 s burst, peak above -35 LUFS,
  and not a shrug spanning the whole source) and
  `analyzeClipHook tells a loud window from a quiet one` (both windows off
  the -70 floor, ~34 LU apart). Red-green evidence: on the pre-fix command
  both fail on their first assertion (0 candidates; -70 == -70).
- **Lesson.** **A filter argument that changes only what ffmpeg *prints* is
  as load-bearing as one that changes what it renders, the moment your
  feature parses the printout.** The unit tests here were real and passing
  — they tested `parseEbur128` against canned stderr, which is the one
  input the bug could never produce. Note also how the failure presented:
  "no highlights found" and "every clip scores low" both look exactly like
  an honest answer about a quiet VOD, which is why this survived to a
  second round. A feature whose broken state is indistinguishable from its
  empty state needs a fixture with a known answer.

### Bug — captions positioned "top" or "middle" rendered in the wrong third and lost their centring (T-11)
- **Root cause.** `alignmentForPosition` emitted ASS *numpad* alignments
  (top=8, middle=5, bottom=2), but libass's `force_style` path writes that
  number straight into its INTERNAL representation —
  HALIGN_LEFT/CENTRE/RIGHT = 1/2/3 OR-ed with VALIGN_SUB/TOP/CENTER =
  0/4/8 — skipping the numpad conversion its v4+ style parser applies. So 8
  decoded as left+middle and 5 as left+top: `top` rendered mid-frame,
  `middle` rendered at the top, both flush left. `bottom` (2 = centre+sub)
  was correct by coincidence, which is why the feature looked fine in its
  default configuration.
- **Fix.** `alignmentForPosition` returns libass-internal values: top=6,
  middle=10, bottom=2 unchanged.
- **Test.** The pin becomes `renders every caption position centred in the
  third it names` — each position paints its own third of the frame, leaves
  the other two clean, and is horizontally symmetric. Mutation proof:
  restoring 8/5 puts the top third at 55.6 dB PSNR (untouched) where the
  fixed build measures ~18. The unit test on the constants is kept but
  renamed to say what the numbers are, pointing at the render test for what
  they *do*.
- **Lesson.** **A unit test on a constant proves the constant, not the
  contract.** `expect(alignmentForPosition('top')).toBe(8)` passed for as
  long as the bug existed and would have "protected" it forever. When a
  value's meaning is decided by someone else's parser, only that parser's
  output is evidence. Second, smaller lesson from writing the replacement:
  the assertion geometry had to be *measured*, not assumed — libass scales
  `force_style` FontSize by PlayResY (288 by default), so a nominal 24
  renders ~90 px tall on 1080p, and the first draft of the test failed on
  bands that were the wrong size for the text.

### Bug — every reframed vertical clip carried non-square pixels (T-12)
- **Root cause.** `scale` preserves the *source's* display aspect ratio, so
  cropping 1920x1080 to 9:16 and scaling to 1080x1920 emitted SAR 404:405
  and a DAR of 101:180 instead of 9:16. Players honour SAR, so the clip was
  stretched by ~0.2% wherever it was uploaded. Cosmetic, and invisible to
  every test that asserted width and height.
- **Fix.** `setsar=1` after the crop/scale in `src/main/ffmpeg/reframe.ts`.
- **Test.** The Layer 5 reframe tests now assert
  `sample_aspect_ratio` 1:1 and `display_aspect_ratio` 9:16 on the primary
  case, and square pixels again on the even-snap case (where the scale
  target changes, which is exactly where a source-derived SAR leaks back
  in).
- **Lesson.** **Output geometry is three facts, not two:** width, height,
  and the pixel aspect the container carries alongside them. Any test for a
  pipeline that crops or scales should assert SAR — dimensions alone cannot
  see a stretched frame.

---

## 2026-08-14 — Round 20 format widening: the Layer 5 matrix caught a bundled-ffmpeg segfault before it shipped

Import format support widened (flv/wmv/mpg/mpeg/3gp video via
convert-on-import, aiff/wma audio via extract-to-wav, avif images), with
all five hand-rolled extension lists replaced by `shared/mediaFormats.ts`
— they had already drifted (the audio picker's video filter was missing
m4v). Two findings worth recording:

### Bug — the bundled ffmpeg SIGSEGVs on any muxed output from an mpegts input (linux binary only — resolved same day)
- **Root cause.** ffmpeg-static ships binaries from DIFFERENT upstream
  builders per platform: linux x64 is johnvansickle 7.0.2-static,
  win32 x64 is gyan.dev 6.1.1. The johnvansickle build crashes with
  SIGSEGV whenever an mpegts input (`.ts`, `.m2ts`) is written to ANY
  muxed output — mp4/mov/mkv, remux (`-c copy`), transcode, and pipe
  input alike. Decode to `-f null` is fine, which is why nothing short
  of the real conversion command surfaced it.
- **Fix.** Initially excluded the family outright — wrong call for the
  product, discovered by running the exact repro against the win32
  binary (the one that actually ships in the exe) under wine: every
  shape passes (mpeg2-in-ts and h264-in-ts transcode, m2ts, wav
  extraction). ts/m2ts/mts are ENABLED; the per-platform caveat is
  documented in `shared/mediaFormats.ts`. Linux dev runs still crash on
  ts import — known, pinned, harmless to the product.
- **Test.** Layer 5 matrix entries for ts/m2ts run where the shipping
  builder runs (`skipIf` non-win32); a linux-only test pins the
  segfault itself, worded so that an ffmpeg-static upgrade that fixes
  the linux build FAILS the pin and prompts un-gating the matrix.
- **Lesson.** Two lessons. **(1) "ffmpeg reads it" is a per-binary,
  per-path claim, not a general truth** — the matrix also caught MPEG-1/2
  encoders rejecting non-broadcast frame rates the same hour. **(2) Test
  evidence is per-platform when the binaries are per-platform.** The dev
  environment's binary and the shipped binary were entirely different
  programs from different maintainers; a crash in one said nothing about
  the other. Before cutting a feature over a binary bug, check which
  binary the USER runs — wine made that testable without a Windows
  machine.

### Bug — five duplicated extension lists, one already drifted
- **Root cause.** Picker filters (ipc/video, ipc/audio), two drop zones,
  and the image import panel each carried their own inline list; the
  audio picker's video filter lacked m4v.
- **Fix.** `shared/mediaFormats.ts` is the single source; every filter,
  drop-zone check, and hint string derives from it.
- **Test.** `mediaFormats.test.ts` (m4v pinned, tier-overlap guards,
  hint format).
- **Lesson.** Same as the fileUrl bug one entry down, generalized: **two
  copies that must agree are one module that hasn't been written yet.**

---

## 2026-08-14 — Media never loaded in the shipped app: the imagii-file:// round-trip was lossy

The first real user report ("files don't load, nothing usable") turned
out to be a 100% failure of media loading in the packaged app, on every
platform, present since the Video Studio MVP. Eighteen review rounds
missed it because no automated test ever loaded a file through the real
protocol, and agent rounds run headless on Linux without real media.

### Bug — every imagii-file:// request returned 403, so no video, audio, or thumbnail ever loaded
- **Root cause.** The URL builder (inlined in the preload's `fileUrl`)
  embedded the filesystem path into the URL authority + path, and the
  protocol handler reassembled it from `url.hostname + url.pathname`.
  URL parsing is lossy there in three independent ways: a Windows drive
  colon (`C:`) parses as a port delimiter and vanishes, the POSIX
  leading slash the builder stripped was never restored, and `#` in a
  filename (unescaped by `encodeURI`) truncated the path as a fragment.
  Every corrupted path then failed `isSafeAbsolutePath` and the handler
  403'd. A second copy of the builder in `protocol.ts` — dead code the
  renderer never used — made the preload/handler disagreement invisible.
- **Fix.** `src/shared/fileUrl.ts` — one tested module owning both
  directions. The whole absolute path is percent-encoded as a single
  URL path segment under a fixed dummy host
  (`imagii-file://local/<encodeURIComponent(path)>`), so URL structure
  can never touch path bytes. The preload builder and the protocol
  handler both import it; the duplicate builders are gone.
- **Test.** `src/shared/fileUrl.test.ts` — round-trip identity matrix
  (drive letters, spaces, `#`, `?`, `%`, unicode, UNC, POSIX) plus the
  three corruptions pinned individually; and `tests/e2e/smoke.spec.ts`
  now fetches a real file through the protocol inside real Chromium
  (200 + exact byte count, 403 for traversal) — the test that would
  have caught this on day one.
- **Lesson.** **A filesystem path is not URL material.** Never place
  path bytes where a URL parser assigns meaning (authority, port,
  fragment); encode the whole path as one opaque segment and decode it
  with the mirror of the same module. And when a builder and a parser
  must agree byte-for-byte across a process boundary, they are ONE
  function pair in ONE file with a round-trip test — two inline copies
  agreeing by luck is how this shipped broken for months. Finally:
  string-shape confidence strikes again — unit tests asserted what the
  URL looked like; only fetching through the real protocol stack proves
  the app can read a file. That is the same lesson as the round-18
  ffmpeg layer, one boundary over.

---

## 2026-08-14 — Account-wide GitHub Actions budget exhausted

Not an imagii bug — imagii is public, so its Actions runs are free and
its single workflow has run once, ever. Recorded here because the
account-level consequence lands on this repo too, and because the cause
is a mistake any repo here could repeat.

### Bug — the account's 2,000 included Actions minutes hit 100% mid-cycle
- **Root cause.** In a sibling repo, `ci.yml` listened to `push` on all
  branches **and** `pull_request`. Both events fire for a branch that
  has an open PR, so every PR commit ran two identical jobs — double
  the spend for zero extra signal. Docs-only commits ran the full suite
  as well.
- **Fix.** The house pattern, established in `wubwub` and adopted here
  for any future workflow:
  - `push` restricted to `main`; every other branch is already covered
    by `pull_request`.
  - `paths-ignore: ["docs/**", "**/*.md"]` — skips a run only when
    *every* changed file matches, so mixed code+docs commits still run.
  - `concurrency: { group: <name>-${{ github.ref }}, cancel-in-progress: true }`
    so a newer commit cancels the in-flight run.
  - Anything that publishes (release, deploy) stays `workflow_dispatch`
    plus an explicit tag trigger, never ordinary pushes.
  imagii's `release.yml` already satisfied the last rule and adds
  `timeout-minutes: 30`, which caps the blast radius of a hung run.
- **Test.** None possible — workflow triggers are only exercised by
  GitHub. The compensating control is that `npm run verify` runs
  locally and is the real pre-push gate; CI is confirmation, not the
  first line of defence.
- **Lesson.** **`push` and `pull_request` overlap; listening to both
  bills twice for one commit.** More generally: a CI trigger is a
  standing financial commitment, so read it like one. Cost review
  belongs at the moment a workflow is added, not at the moment the
  budget page turns red — by then the spend is already made, and the
  freeze lands on every repo in the account, including the ones that
  never cost anything.

**Status:** a $0 Actions budget is set account-wide and the cycle resets
**2026-09-01** (resume 09-02). Until then, treat all workflow activity
as frozen. Local verification costs nothing and is unaffected.

---

## 2026-08-09 — Bug round 18: the real-ffmpeg layer — three features that never worked, streaming recording, Video Studio undo

Round 18 added the test layer rounds 1–17 never had: `npm run test:media`
(`tests/integration/media.spec.ts`) drives the REAL production job
runners against real ffmpeg and asserts on the output bytes. Its first
run caught three shipped features that failed 100% of the time despite
green unit tests, because every prior test pinned the *string we meant
to send*, never *whether ffmpeg accepts it*.

### Bug — Auto Zoom failed every export, on every preset
- **Root cause.** Two independent bugs in one filter:
  `zoompan=z='…sin(t*0.6)…'` used a `t` variable that zoompan's
  expression evaluator has never had (the variable is `time`), so the
  graph failed at runtime; and `s=hd1080` hardcoded landscape output, so
  even with a valid expression a TikTok/Reels export would have come out
  1920x1080.
- **Fix.** `autoZoomFilter(preset)` — `time`-based expression,
  `s=${preset.width}x${preset.height}`.
- **Test.** `tests/integration/media.spec.ts` — autoZoom on tiktok
  (portrait) and youtube (landscape) both assert output dimensions.
- **Lesson.** A filter string that "looks like ffmpeg" is a hypothesis,
  not a fact. Only spawning ffmpeg falsifies it. Unit tests pin
  regressions in strings we've already proven; the integration layer is
  what proves them the first time.

### Bug — sidechain ducking failed every export
- **Root cause.** The filter graph consumed the `[primary]` label twice
  (sidechaincompress key input + amix input). A filtergraph label is
  single-consumer; ffmpeg rejects the graph outright.
- **Fix.** `asplit=2[primary][primary_sc]` — one copy keys the
  sidechain, one carries the mix. The primary is also now resampled to
  48 kHz stereo before amix (the round-15 M5 fix only normalized the
  secondary — the round-10 "mirror the fix to the twin" lesson, missed
  again).
- **Test.** Integration test measures the 3 kHz secondary through a
  bandpass in primary-loud vs primary-silent windows and asserts >3 dB
  of actual ducking — not just "the export succeeded".
- **Lesson.** Test the *effect*, not the completion. "Ducking export
  finishes" and "ducking ducks" are different claims.

### Bug — parametric ("Custom") denoise failed every export
- **Root cause.** The filter emitted `ns=…` — afftdn has no `ns` option
  (verified against `ffmpeg -h filter=afftdn`). Also `nf` was clamped to
  [-80,-10] when afftdn's real ceiling is -20, and `nr` to [0,50] when
  the real floor is 0.01 — so even without `ns`, a third of the slider
  range produced rejected values.
- **Fix.** Emit only `nf`/`nr` with true-range clamps; the Sensitivity
  slider is gone (its field survives as an optional no-op so old saved
  presets still parse).
- **Test.** `chain.test.ts` pins the corrected strings + clamps;
  integration test exports at both slider extremes.
- **Lesson.** Filter options and ranges come from `ffmpeg -h
  filter=…` output, not from memory or plausibility. Wrong-but-plausible
  parameters survive string-shape tests indefinitely.

### Bug — Picture-in-Picture never produced output
- **Root cause.** `video:pipComposite`'s validator required
  `overlayWidth` in [0.05, 1] — written as if a fraction — while the
  panel sends pixels (default 360, range 120–960) and concat.ts consumes
  pixels (`scale=${overlayWidth}:-1`). Every real call threw before
  ffmpeg was reached.
- **Fix.** Pixel-range validation [16, 3840].
- **Lesson.** A validator is itself a contract claim that needs a test
  driving it with the *values the real UI sends*. Round 17 added the
  validators; nothing ever called one with production inputs.

### Bug — References search results rendered as broken images
- **Root cause.** The renderer loads DuckDuckGo result thumbnails via
  `<img src="https://…">`, but the CSP's `img-src` allowlist had no
  `https:` — Chromium silently blocks every one. Found independently by
  the privacy and Electron review lenses.
- **Fix.** `https:` added to img-src (kept `referrerPolicy=
  "no-referrer"`); PRODUCT_GUIDE now names live thumbnails as one of the
  four user-triggered network flows.
- **Lesson.** The E2E smoke asserts panels render, not that features
  *work* — a fully CSP-blocked feature still passes a "heading is
  visible" test. Feature-level assertions need the feature's actual
  output (here: a loaded image).

### Bug — match-loudness mixes landed ~3 LU under target
- **Root cause.** amix's default normalization scales each input by 1/N.
  Two tracks individually loudnormed to -16 LUFS mix to ≈ -19 LUFS
  (measured).
- **Fix.** When match-loudness (or a loudnormed chain) feeds the mix, a
  single-pass loudnorm on the mix bus restores the target. Manual-gain
  mixes stay untouched by design.
- **Test.** Integration test measures mix LUFS with ebur128, asserts
  within ±2 LU of target.

### Bug — recorder shipped the whole recording through one IPC call
- **Root cause.** Chunks accumulated in renderer memory; stop built one
  Blob → one ArrayBuffer → one `ipcRenderer.invoke` (structured clone =
  full copy) → main copied again into a Buffer. Three simultaneous
  copies of a potentially-GB recording.
- **Fix.** Streaming protocol (`recording:begin/appendChunk/finalize/
  abandon`) — 1 s MediaRecorder timeslices append to a temp .webm as
  they arrive; peak memory is one chunk. Ordering by renderer-side
  promise queue + single WriteStream; every failure path lands in
  `abandon`; before-quit reaps open sessions.
- **Test.** `src/main/ipc/recordingStream.test.ts` (14 tests: byte-order
  across 25 chunks, every rejection class, abandon idempotency).
- **Lesson.** IPC payload size scales with user behavior, not test
  behavior. Anything user-recorded/user-loaded needs a streaming path
  before it needs anything else.

### Bug — Video Studio had no undo at all
- **Root cause.** The undo system (round 15) wired audio + canvas
  stores; videoStore was skipped with a comment and nobody returned. Its
  most destructive actions (clip ✕, Close) also had no confirm.
- **Fix.** Same past/future history as the other stores (50-cap),
  gesture coalescing so a trim drag is one step, useGlobalUndo
  delegation, confirms on remove-clip and Close.
- **Test.** 8 new videoStore tests.
- **Lesson.** "Undo works" is a per-store claim. A global-undo hook that
  silently skips a store turns a missing feature into an invisible one.

### Smaller fixes (each with test or typecheck pin)
- Burn-in failed on SRT paths with apostrophes → two-level
  `escapeSubtitlesPath`, pinned against the real filtergraph parser
  (integration test sweeps apostrophe/space/comma/bracket names).
- `audio:listPresets` crashed on valid-JSON-wrong-shape preset files →
  `parseChainPreset` choke point (the round-14 customPresets lesson,
  finally mirrored to its twin).
- Concurrent mood-board saves clobbered each other (ipcMain.handle is
  not serialized per channel) → per-collection write lock;
  `moodboard.test.ts` races 8 concurrent adds.
- Export progress divided by speedMultiplier (2× exports stalled at 50%).
- X Premium cap corrected to 4 h per help.x.com; main/renderer platform
  tables were two rounds out of sync → synced +
  `tests/unit/presetTablesInSync.test.ts` pins them together.
- concat.ts's three stderr accumulators capped at 16 KB (round-16
  lesson applied to the sites it missed); whisper transcribe dropped a
  never-read stdout accumulator.
- Startup no longer awaits the ffmpeg smoke test before creating the
  window; `shell.openExternal` gated to http(s); `captions:copySrtTo`
  destPath + `video:reframe` jobId validated like their siblings;
  reframe scale target forced even; dead SD/NudeNet sidecar paths and
  onnxruntime asarUnpack removed.
- VolumeMeter's dB readout double-logged already-dB-scaled frequency
  bytes → real time-domain dBFS peak; static de-ess EQ notch → ffmpeg's
  dynamic `deesser`; FixWizard's dead `voiceQuiet` field removed.
- A11y sweep: focus ring on the Player shortcut surface, aria-labels on
  five selects and four ✕ buttons, CleanupPanel slider aria, Esc now
  actually stops recording (HotkeyOverlay promised it), Tutorial gained
  dialog semantics + focus management, export progress is a live region,
  Clip Kit runs the same safe-zone preflight as ExportPanel, all six
  long-job Cancel buttons share one treatment.
- Record → Video handoff: recordings land in recent files and the
  success toast offers "Edit in Video Studio"; leaving mid-recording
  confirms and saves in place.

### Double-reviewed and REFUTED (documented so it isn't "re-found")
- "Burned-in captions sit 40 real pixels from the edge and collide with
  TikTok UI chrome." Rendered frames prove `force_style` values live in
  libass's 384×288 PlayRes space and scale with the frame: MarginV=40 ≈
  14% above the bottom edge (~270 px on a 1080×1920 export) — clear of
  platform chrome. **Lesson:** a units claim about a rendering stack
  needs a rendered pixel measurement, not coordinate-space reasoning.

### Known-and-accepted (not bugs, recorded deliberately)
- drawtext/watermark hardcode `C:/Windows/Fonts/arial.ttf` — fine while
  the app ships Windows-only (`electron-builder --win portable`); bundle
  a font before any cross-platform build.
- `sandbox: false` in BrowserWindow — flipping it requires a CJS preload
  (electron-vite currently emits ESM) and a real regression pass;
  recommended as its own follow-up experiment, not a drive-by.
- whisper transcribe progress jitters 15–25% (random) because whisper's
  stdout has no parseable percent; the timestamp in the message is the
  real signal.

Round 16 closed the *app-quit* orphan-process gap — every spawn site now
has a `cancelAll*` the before-quit hook calls. Round 17 closes the
*user-time* gap: every long-running panel now has a Cancel button that
SIGKILLs the in-flight ffmpeg/whisper child via a per-job IPC. Three
dead IPC bridges (`autosave:info`, `moodboard:prune`,
`captions:openModelsFolder`) were wired into the UI rather than removed.
A path-traversal-style hole in moodboard IPC was closed with the same
validator surface every other channel already uses. A new Playwright
smoke layer launches the built app and walks every studio.

### Bug — six long-running panels had no in-UI Cancel button
- **Root cause.** Round 16's pass added `cancelAll*` for app-quit but
  none of `ReframePanel`, `GifPanel`, `HighlightPanel`, `CompilationPanel`,
  `PipPanel`, or `CaptionsPanel` (burn-in phase) exposed a way to cancel
  a *single* in-flight job from the UI. A user who hit "Reframe" on a
  90-minute VOD then realized they wanted center instead of left had to
  let it run or quit the app entirely.
- **Fix.** Each module gained either a `cancelXxx(jobId)` or
  single-slot `cancelActiveXxx()` export. New IPC channels
  (`video:cancelReframe/Gif/Concat/Pip/Highlight`,
  `captions:cancelBurnIn`) route panel clicks to those exports. The
  three IPC handlers that previously minted their own internal jobIds
  (concat, pip, gif) now accept an optional renderer-supplied jobId so
  the panel's Cancel button has something to match on. Renderer-supplied
  jobIds are gated by the nanoid alphabet so a hostile string can't
  collide with sub-keys like `${jobId}:seg-N`.
- **Test.** `src/main/ffmpeg/perJobCancel.test.ts` covers every cancel
  helper's no-op-when-empty path; the per-IPC handler signature changes
  are covered by typecheck.
- **Lesson.** "App-quit will clean it up" is not the same as "the user
  can cancel". Every long-running action needs both. If a panel renders
  a progress bar, the panel needs a Cancel button next to it.

### Bug — six moodboard IPC handlers accepted any input
- **Root cause.** `src/main/ipc/search.ts` registered six moodboard
  handlers (`create`, `delete`, `rename`, `addItem`, `removeItem`, list)
  that passed `name: string`, `id: string`, `result: SearchResult`
  straight to the store with zero validators. Every other IPC handler
  in the codebase passes inputs through `assertNonEmptyString` /
  `assertPlainObject` / id-shape gates first. A compromised renderer
  could ship `""` ids, non-string names, or hostile SearchResult fields
  that get persisted to moodboard JSON and re-served as cached thumbs.
- **Fix.** Each handler now validates: ids match the nanoid alphabet
  and a length cap; names are non-empty and ≤200 chars;
  `addItem.result` goes through a new `validateSearchResult` in
  `src/shared/search.ts` that requires `fullUrl`, `thumbnail`, `source`
  to be non-empty strings under a 4KB ceiling; `addItem` strips any
  renderer-supplied `cachedThumbPath` so the store rebuilds it.
- **Test.** `src/shared/searchValidate.test.ts` covers the validator
  positively + every rejection class; `src/main/ipc/round17Coverage.test.ts`
  covers the store CRUD over a tempdir-mocked userData.
- **Lesson.** Every IPC handler is a security boundary. When a new
  module adds handlers, run a checklist against the validator pattern
  before merging — not after a round-17-style audit catches the gap.

### Bug — three IPC bridges were exposed but never called
- **Root cause.** `autosave:info`, `moodboard:prune`,
  `captions:openModelsFolder` shipped in preload + handler with no
  caller in the renderer. Dead code rots — either it gets removed
  silently (losing a useful feature) or the contract drifts.
- **Fix.** Wired each into the UI: `AutosaveRestore` now uses
  `autosave.info()` to render a lightweight "Last autosave: 5 min ago"
  status line even after the user dismisses the restore prompt;
  `MoodBoardPanel` adds a "Clear thumbnail cache" button;
  `CaptionsPanel` adds a "Show models folder" link next to the existing
  "open folder" for binaries.
- **Test.** Behavioral, covered by the E2E smoke walking every studio.
- **Lesson.** Either wire the bridge or remove it. A preload export
  with no caller is a maintenance liability — every refactor pays for
  its presence with extra type updates.

### Bug — settings:set accepted arbitrary keys
- **Root cause.** `src/main/ipc/settings.ts` passed the renderer-supplied
  `key` straight to electron-store. The store happily creates whatever
  top-level field it's handed. A hostile renderer could pollute the
  store with hundreds of junk keys or shadow future legitimate ones.
- **Fix.** Both `settings:get` and `settings:set` now validate the key
  against the `SettingsKey` union via `KNOWN_SETTINGS_KEYS`. Per-key
  value shape stays loose — electron-store's schema validation
  (round-15 INIT-D) catches malformed values.
- **Test.** `src/main/ipc/settingsKnownKeys.test.ts` covers every known
  key plus the rejection classes (unknown string, non-string, `__proto__`,
  traversal).
- **Lesson.** "We control the renderer so it's fine" is not a security
  argument once the codebase is open-sourced or accepting third-party
  plugins. Allowlist every IPC boundary.

### Initiative — dead code removal in sidecars/paths.ts
- **What.** `logsDir()` and `aiOutputDir()` were defined but unreferenced
  anywhere in main or renderer.
- **Fix.** Removed. Replaced with a one-line comment explaining the
  intentional absence so a future reader doesn't recreate them.
- **Lesson.** Audit unreferenced exports periodically. Each one is a
  promise the codebase makes ("there's a logs directory") that the rest
  of the code doesn't honor.

### Initiative — Playwright Electron smoke layer
- **What.** A new `tests/e2e/smoke.spec.ts` driven by
  `@playwright/test`'s Electron driver launches the built app, asserts
  Home renders with all five NavCards, then walks each studio,
  screenshotting each into `tests/e2e/screenshots/`. The test runs in
  ~6 seconds against a hermetic `userDataDir` pre-seeded with
  `welcomeSeen` so it never collides with the developer's real data.
- **Why not bake into `npm run verify`.** E2E requires the `out/` build
  artifact. `verify` is the fast unit + typecheck pass that runs on
  every save; the E2E layer lives behind `npm run test:e2e:build` for
  release smoke.
- **Lesson.** A node-only test suite catches contract bugs but not
  "does the app actually launch and reach Home". One smoke that touches
  every route is cheap insurance against shipping a broken bundle.

### Initiative — IPC handler test coverage round-out
- **What.** Phase-6 of round 17 added ~50 new tests across
  `src/main/audio/presets.test.ts`, `src/main/customPresets.test.ts`,
  `src/main/ipc/recordingCancel.test.ts`, and
  `src/main/ipc/round17Coverage.test.ts`. The pattern: mock
  `electron.app.getPath` to a per-test `mkdtempSync`, exercise the real
  CRUD against real disk, assert the validation rejections.
- **Lesson.** A handler that imports `electron` can still be tested —
  mock the surface, drive the store-backed body. Don't let "needs
  electron" be a reason to leave a handler untested.

---

## 2026-05-20 — Bug round 16: round-15 follow-up (uniform cancel coverage, Modal rollout, banner geometry)

Round 15's 11-lens review surfaced a clean pattern: most of round 15's
fixes were narrow, not project-wide. The `activeJobs` + `before-quit`
contract was added to 3 ffmpeg modules; 4 more spawned children that
never got the same treatment. The `<Modal>` helper was built and
adopted by one dialog (TemplatesDialog); 6 other dialogs that motivated
the helper kept their hand-rolled scrims. The audio IPC missed the
path-safety pass video IPC got. Round 16 closes those gaps.

### Bug — runReframe / runGifExport / extractFrame / ebur128 children survived app quit
- **Root cause.** `src/main/ffmpeg/reframe.ts`, `gif.ts`, `frame.ts`,
  and `highlights.ts` each spawned ffmpeg without a `cancelAll*` export
  the before-quit hook could call. Round 15 added the contract to
  `export.ts`, `concat.ts`, and `audio/process.ts` but stopped there.
  On Windows, Task Manager showed orphaned `ffmpeg.exe` instances
  burning CPU after the app icon was gone.
- **Fix.** Each module now exports a no-arg `cancelAll*Jobs()` that
  SIGKILLs every tracked child. `src/main/index.ts` `before-quit`
  calls all four. `frame.ts` and `highlights.ts` gained single-slot
  trackers (only one extract / scan runs at a time); `reframe.ts` and
  `gif.ts` already had multi-slot maps and just needed the cancelAll
  export.
- **Test.** `src/main/ffmpeg/cancelAll.test.ts` — each cancelAll is
  safe to call with no in-flight children and is idempotent (a stress
  before-quit may call it twice).
- **Lesson.** When you establish a contract like "every spawn site
  registers with a map and exports a cancelAll", finish the pass
  across every spawn site in one PR. A "we'll do the rest next round"
  comment ages into a real orphan-process bug.

### Bug — runBurnIn stderr accumulator was uncapped (memory growth on long burn-ins)
- **Root cause.** `src/main/sidecars/whisperManager.ts:389` did
  `stderr += c` with no size cap. Every other ffmpeg spawn in the
  codebase caps at 16KB but burn-in was missed. An hour-long burn-in
  at verbose ffmpeg log levels could accumulate tens of MB of stderr
  that only the last 500 chars get used from.
- **Fix.** Cap the accumulator at 16KB by slicing the tail inside
  the data handler. Same idiom as every other spawn.
- **Test.** Behavioral / runtime; documented here.
- **Lesson.** Stderr accumulators need an upper bound. Audit them
  alongside any "spawn ffmpeg" pattern — even a one-shot can run for
  hours in the burn-in case.

### Bug — Audio IPC handlers accepted traversal paths
- **Root cause.** Round 15 brought every video IPC handler under
  `assertSafeAbsolutePath`, but audio IPC (six handlers in
  `src/main/ipc/audio.ts`) still used `assertNonEmptyString` on path
  fields that flow into `ffmpeg -i`, `shell.showItemInFolder`, and
  `path.parse`. A `../../etc/secret` filePath in `audio:probe` would
  reach `ffprobe`.
- **Fix.** Replace `assertNonEmptyString` with `assertSafeAbsolutePath`
  on `audio:probe`, `audio:extractFromVideo`, `audio:export`'s
  `sourcePath`/`outputPath`, `audio:mux`'s three paths,
  `audio:revealInFolder`, and `audio:suggestOutputName`. JobId / preset
  name keep `assertNonEmptyString` since they're not paths. *(The preset
  id was listed here too, "since it's not a path". It is one:
  `<userData>/audio-presets/<id>.json`, and `audio:deletePreset('../config')`
  reached `unlink`. Round 67, T-117, put the nanoid-alphabet gate on it; see
  the 2026-10-10 entry for that round.)*
- **Test.** Existing `src/shared/pathSafety.test.ts` pins the
  validator; the handler-level change is enforced at the type level.
- **Lesson.** Path validation is a project-wide contract. When you
  upgrade one IPC surface, mirror the change across every adjacent
  surface in the same PR. "We'll get to audio next" leaves a hole.

### Bug — Modal aria-labelledby id collided when two modals stacked
- **Root cause.** `src/renderer/src/components/Modal.tsx` used a
  hardcoded `id="imagii-modal-title"`. Two titled modals open at once
  (e.g. a confirm-on-cancel layered inside ExportDialog) both rendered
  the same id, making AT-labels ambiguous.
- **Fix.** React 18 `useId()` so each instance gets a unique id.
- **Test.** No isolated test (would require jsdom for `useId`);
  documented here. The INIT-I cancel-confirm modal exercises the
  stacking case at runtime.
- **Lesson.** A "single instance at a time" assumption breaks the
  moment you nest dialogs. Use `useId()` for any ARIA pointer
  generated inside a reusable component.

### Bug — Twitch / YouTube banner templates used wrong dimensions
- **Root cause.** `templates.ts` shipped `tw-banner-channel` at
  1920×480 (not a real Twitch surface) and `yt-banner-channel` with a
  safe-area marker at 1106×350 (neither YouTube's all-device safe area
  1546×423 nor its TV-safe minimum 1235×338).
- **Fix.** Renamed the Twitch template to `tw-banner-videoplayer`
  at 1200×480 (the video-player / offline-screen banner — the most
  useful target for a wordmark + schedule design). The YouTube banner
  now renders BOTH safe-area frames: outer 1546×423 all-device and
  inner 1235×338 TV-safe.
- **Test.** `src/renderer/src/modules/image-studio/templates.test.ts`
  pins the corrected dimensions and confirms the stale id is gone.
- **Lesson.** Platform geometry is a spec, not a guess. Cite the
  documented values in a code comment and lock them in a test —
  vendor specs change rarely enough that the test is cheap insurance.

### Bug — audio ExportDialog had no Cancel button
- **Root cause.** Round 15 added Cancel to ExportPanel, ClipKit, and
  RecordStudio but the audio dialog was missed. Audio export+mux can
  run for minutes on a long source; the backend `audio:cancel` IPC
  already existed and went unused.
- **Fix.** Add a Cancel button next to the running progress UI in
  `src/renderer/src/modules/audio-studio/ExportDialog.tsx`.
- **Test.** Behavioral; documented here.
- **Lesson.** When you ship a "Cancel" pattern, run the audit across
  every long-running surface in one pass. The audio export surface
  hadn't gotten quieter; we just hadn't checked.

### Bug — RecordStudio cam preview overlay had no positioned ancestor
- **Root cause.** `RecordStudio.tsx` used `absolute bottom-8 right-8`
  for the cam preview thumbnail, but the wrapping `<div>` was
  `flex flex-col` without `relative`. The overlay anchored against
  the page root, so on a tall window the thumbnail drifted far below
  the main preview.
- **Fix.** Add `relative` to the wrapping div so `absolute` is
  contained.
- **Test.** Behavioral; documented here.
- **Lesson.** Every `absolute`/`fixed` child needs an explicit
  positioned ancestor. When you copy a pattern from one component to
  another, copy the `relative` wrapper too.

### Initiative — Modal helper rollout (a11y completeness)
- **Root cause.** Round 15 built `<Modal>` with focus trap, focus
  restore, Escape close, and scrim click — then migrated only
  TemplatesDialog. Six other dialogs kept their hand-rolled scrims
  and were missing one or more of those behaviors. SafeZoneWarningModal
  and FixWizard were the worst — blocking decision dialogs with no
  Escape and no focus restore (WCAG 2.1.2 + 4.1.2).
- **Fix.** Migrated `SafeZoneWarningModal`, `FixWizard`,
  `ThumbnailVariants`, `CustomPresetManager`, and `HotkeyOverlay` to
  the shared `<Modal>`. The image-studio and audio-studio
  ExportDialogs are inline export bars, not modals — verified and
  skipped per spec. DESIGN_GUIDE.md now notes that hand-rolled scrims
  are deprecated project-wide.
- **Test.** Behavioral; documented here.
- **Lesson.** When you build a reusable a11y helper, the migration
  PR has to ship in the same round — or every dialog you didn't
  migrate continues to ship the regression the helper was meant to
  fix. Don't separate the helper from its callers.

### Initiative — Loudness platform presets in LevelsPanel
- **Root cause.** The plumbing for `loudnormTargetLufs` already
  shipped end-to-end, but the UI gave the user only a numeric input
  with the hint "podcast standard −16". A streamer aiming for
  YouTube/TikTok had no idea to type −14, or for Broadcast −23.
- **Fix.** Added a small `<select>` above the LUFS number input in
  `LevelsPanel.tsx`: Podcast (−16), YouTube/Spotify (−14),
  TikTok/Reels (−14), Broadcast EBU R128 (−23), Custom. Picking a
  platform patches `loudnormTargetLufs`; typing into the numeric input
  flips the picker to 'custom'. TP ceiling stays hardcoded at −1.5
  this round with an inline note about the asymmetry.
- **Test.** `src/renderer/src/modules/audio-studio/LevelsPanel.test.ts`
  pins the numeric→preset mapping including 'custom' fallback.
- **Lesson.** When a feature's data path is plumbed but only a power
  user knows the values, that's a UX gap, not a feature win. Wrap the
  common cases in a picker.

### Initiative — Confirm before cancelling a multi-job batch
- **Root cause.** ExportPanel and ClipKit Cancel buttons hit
  `cancelAll` immediately. A misclick during a 20-clip / 5-platform
  ClipKit batch torched the entire batch with no recovery.
- **Fix.** When ≥ 2 jobs are running, the Cancel button opens a
  Modal confirm — "Cancel N running jobs?" with `Keep running` /
  `Cancel jobs`. Single-job cancels still go through immediately.
- **Test.** Behavioral; documented here.
- **Lesson.** Destructive actions whose cost scales with batch size
  deserve a confirm — graduated friction proportional to the cost of
  the mistake.

---

## 2026-05-20 — Bug round 15: autosave wiring, mains-hum filter, faststart cascade

### Bug — autosave hook existed but was never invoked (data loss on crash)
- **Root cause.** Round 3 introduced `useAutosave()` in
  `src/renderer/src/hooks/useAutosave.ts` and added `AutosaveRestore` to
  the launch flow, but no component ever called the writer hook. Only
  `suppressAutosave` was imported anywhere. `AutosaveRestore` always
  read a missing file.
- **Fix.** `src/renderer/src/App.tsx` now calls
  `useAutosave({ enabled: status.phase === 'ready' })` once, gated on
  the post-welcome `ready` state. The main-side `isSafeToAutosave`
  guard still protects against empty-project saves.
- **Test.** Behavioral / timer; documented here instead.
- **Lesson.** A hook is just a function — if no component renders it,
  it doesn't run. Add a smoke check (or a feature flag wired into a
  visible UI affordance) when a feature lives entirely in a hook.

### Bug — `hum60` filter did not touch 60 Hz mains hum
- **Root cause.** `src/main/audio/chain.ts` pushed `highpass=f=70` and
  `lowpass=f=10000` when `hum60` was enabled. Highpass at 70 Hz passes
  60 Hz unchanged; lowpass at 10 kHz dulls voice without affecting
  hum. The label said "Reduce 60 Hz hum"; the code did the opposite.
- **Fix.** Use notches: `bandreject=f=60:width_type=h:w=2` and
  `bandreject=f=120:width_type=h:w=2` (fundamental + first harmonic).
- **Test.** `src/main/audio/chain.test.ts` — buildChain emits both
  bandreject stages and neither legacy filter when hum60 is on.
- **Lesson.** Audio filters are commutative — a chain that "feels
  related" to a problem is not the same as a chain that addresses it.
  When the label promises a specific outcome, pin the filter form in a
  test.

### Bug — Platform duration limits stale (TikTok 10 min, Reels 90 s)
- **Root cause.** TikTok extended uploads to 60 minutes in late 2024
  and Meta extended Reels to 3 minutes in January 2025 (T-119: this said
  "the same year", and the round-15 comment in `presets.ts` said 2024).
  `presets.ts` `durationHardLimit` values predated both changes;
  perfectly valid longer-form posts were red-flagged.
- **Fix.** TikTok hard limit → 3600 s; Reels hard limit → 180 s,
  sweet spot max → 90 s.
- **Lesson.** Constants tied to third-party policy decay. Cite the
  source in a comment so the next refresh has somewhere to start.

### Bug — faststart missing on three MP4 emit paths
- **Root cause.** `runPipComposite`, `runBurnIn`, and `runAudioMux`
  all emitted libx264 MP4 outputs without `-movflags +faststart`.
  Round-2 audit fixed `runExportJob`/`runConcat`/`runReframe` but
  these three regressed silently. Web players stall while the moov
  atom is fetched from the tail.
- **Fix.** Add `'-movflags', '+faststart'` to all three ffmpeg arg
  lists. Match the runExportJob shape.
- **Lesson.** A grep for `-movflags` should be part of the
  new-encode PR checklist. The flag is invisible from runtime
  behavior unless you test on a slow / partial network.

### Bug — Export and Clip Kit batches had no Cancel button
- **Root cause.** Main-process `cancelAllExportJobs` existed and
  preload exposed it as `window.api.video.cancelAll`, but no UI
  called it. A long batch couldn't be aborted.
- **Fix.** `ExportPanel.tsx` and `ClipKitButton.tsx` render a
  Cancel button while running that calls `cancelAll()`.
- **Lesson.** A cancellation primitive is only as useful as its
  furthest UI invocation. Wire it end-to-end when you add it.

### Bug — `text-ink-dim` failed WCAG AA contrast (3.04:1)
- **Root cause.** `tailwind.config.js` set `ink.dim` to `#5d5d6e` —
  ~3.04:1 on `#0b0b0f`. Below 4.5:1 AA minimum for body text. Used
  across FixWizard, ThumbnailVariants, AssetLibraryPanel, preset
  copy, importer hints.
- **Fix.** Bumped `ink.dim` to `#8b8b9c` (~6.6:1) and updated the
  DESIGN_GUIDE token table.
- **Lesson.** When the dim/secondary token wraps important hint text
  (not decorative dividers), check contrast on every background it
  lands on, not just `bg.base`.

### Bug — `prefers-reduced-motion` ignored
- **Root cause.** No global rule in
  `src/renderer/src/styles/index.css`. Spinners, opacity transitions,
  smooth scrolling ran regardless of the OS setting.
- **Fix.** Bottom-of-file `@media (prefers-reduced-motion: reduce)`
  block disables animation-duration, transition-duration, and
  scroll-behavior app-wide.
- **Lesson.** This is one CSS block. Add it at project setup.

### Bug — Audio Studio Ctrl+Z / Ctrl+Y documented but not wired
- **Root cause.** HotkeyOverlay advertised undo/redo for `/audio`
  but AudioStudio had no `keydown` listener — only ImageStudio did.
- **Fix.** `useEffect` in `AudioStudio.tsx` mirrors ImageStudio's
  pattern (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; skip when typing).
- **Lesson.** Doc fields like HotkeyOverlay are claims about
  behavior — exercise them or remove them.

### Bug — Temp WebM leaked when `dialog.showSaveDialog` threw
- **Root cause.** `src/main/ipc/recording.ts` wrote `tempPath`
  BEFORE showing the dialog. If the dialog threw (window destroyed
  mid-IPC), neither the cancel-branch unlink nor the conversion
  try/finally ran — the WebM leaked.
- **Fix.** Outer try/finally around the entire post-`writeFile`
  block. The conversion try/finally becomes nested.
- **Lesson.** A dialog can throw. Wrap any post-write IO that
  depends on a dialog in try/finally that cleans up the write.

### Bug — `cachedThumbPath` could point at any safe absolute path
- **Root cause.** `parseCollection` accepted the JSON-supplied path
  as-is and the protocol handler served any safe absolute path. A
  crafted board JSON could point cachedThumbPath at a sensitive file.
- **Fix.** Two layers: shared `parseCollection` drops the field if
  it fails `isSafeAbsolutePath`; main-process `readCollection`
  further confines the path to `thumbsCacheDir()` via
  `path.relative`.
- **Test.** `src/shared/moodboardParse.test.ts` — relative and
  non-string both produce undefined cachedThumbPath; safe path
  passes through (main confines further).
- **Lesson.** Persisted strings that reach the filesystem need
  validation AND confinement to a known root.

### Bug — Spawn children leaked through app quit
- **Root cause.** runPipComposite, runBurnIn, runTranscribe,
  runConcat segments, webm→mp4 conversion: none registered in
  cancellable maps. `window-all-closed` was the only quit hook.
  Closing the window left orphan ffmpeg / whisper processes.
- **Fix.** Per-module activeJobs maps + cancelAll exports plus a
  `before-quit` handler in `src/main/index.ts` that fires every
  cancelAll.
- **Lesson.** Every spawn should be registered before any other
  code awaits the child.

### Bug — Odd crop dimensions slipped through to libx264
- **Root cause.** `cropToFilter` / `autoCropForAspect` / reframe.ts
  used `Math.round()` for crop W/H/X/Y. yuv420p needs even values;
  libx264 strict mode refuses odd dimensions.
- **Fix.** New `even()` helper in `src/main/ffmpeg/filters.ts`
  (`n & ~1`) applied to every crop coordinate and to concat.ts
  scale dims.
- **Test.** `src/main/ffmpeg/filters.test.ts` — `even(1081)===1080`,
  `even(0)===0`, `even(-1)===-2`, `even(NaN)===0`.
- **Lesson.** When a codec has a divisibility constraint, snap at
  the source-of-truth (filter graph construction), not at the
  caller.

### Bug — Secondary track at 44.1 kHz silently mismatched amix
- **Root cause.** `runAudioExport` mixed primary (forced 48 kHz)
  with secondary unmodified. amix requires equal SR + channel
  layout; ffmpeg either silently auto-resampled or errored.
- **Fix.** Prepend `aresample=48000,aformat=channel_layouts=stereo`
  to the secondary's filter stage.
- **Lesson.** Filter graphs that join two streams need explicit
  format-alignment before the join.

### Bug — RecordStudio save phase had no progress or abort
- **Root cause.** Conversion can take minutes for a long screencap.
  RecordStudio just showed a static "Finishing up…" card.
- **Fix.** New IPC: `recording:progress` (main → renderer) and
  `recording:cancelSave` (renderer → main). RecordStudio shows a
  progress bar and Discard button during the saving phase; the
  conversion child is registered so before-quit can kill it.
- **Lesson.** A spinner without progress is acceptable for sub-
  second ops. Multi-minute ops need visible progress AND a way out.

### Bug — Range sliders had no accessible names
- **Root cause.** Many `<input type="range">` relied on a sibling
  `<span>` for the visible value — AT reads neither the wrap nor
  the sibling, so a screen reader announced "slider, 0 to 100"
  with no context.
- **Fix.** `aria-label` on every slider plus `aria-valuetext` for
  the formatted value. Applied across ColorGradePanel,
  CompilationPanel, CaptionsPanel, ClipList, PropertiesPanel,
  LevelsPanel, SecondaryTrackPanel (both helpers), image
  ExportDialog, Toolbar grid size, CustomPresetManager name.
- **Lesson.** A `<label>` wrap is the minimum; sliders showing a
  formatted value in a sibling need `aria-valuetext`.

### Bug — Modals had no focus management
- **Root cause.** Every modal was a hand-rolled fixed-inset div
  with no focus trap, no Escape handler beyond ad-hoc, and
  TemplatesDialog lacked scrim-click-to-close.
- **Fix.** New shared `<Modal>` in
  `src/renderer/src/components/Modal.tsx` centralizes role /
  aria-modal, first-focusable-on-mount, Tab trapping, Escape
  close, scrim-click close, focus restore. TemplatesDialog
  refactored as the first consumer.
- **Lesson.** The seventh hand-rolled implementation is the right
  time to write the helper.

### Bug — Eight `!` non-null assertions
- **Root cause.** Quick fixes that papered over narrowing escape
  cases. Most were logically safe under current code but governance
  bans `!` because future refactors drift the guards apart from the
  assertion.
- **Fix.** Each replaced with `assertDefined`. Special case for
  `ReframePanel.tsx:59` — the previous `outDir!` referenced STALE
  React state (setOutDir is async), so the picker value is captured
  in a `resolvedOutDir` local instead. Real correctness fix.
- **Lesson.** `!` is a TS-level lie. And `!` on React state right
  after a setState call is almost always a bug.

### Round 15 also shipped
- audio chain: explicit `nr` values for light/medium/aggressive
  denoise presets; FixWizard echoy surfaces a mic-placement tip
  instead of silently discarding; amix weights `1 1` under ducking
- streamer kit: X copy mentions Premium 3 h cap; emote template
  name + auto-emit-3-PNG pack on 112×112 export; "Smart" reframe →
  "Auto (centered)"; tiktok-bold caption default → bottom; Clip Kit
  routes vertical sources to a 1080×1920 YouTube Short
- IPC defense-in-depth: pinned `WHISPER_MODEL_SHA256` verified after
  download; `assertSafeAbsolutePath` on every video IPC path field;
  `captions:saveSrt` confined to the captions output dir;
  nanoid-alphabet gate on customPresets and moodboard ids
- resource hygiene: tempCleanup also walks
  `userData/recordings`; `store.ts` electron-store schema with
  `clearInvalidConfig`
- UX polish: last-used export and Clip Kit folder persisted;
  ImageStudio tool badge renamed (rect → Rectangle, etc.); spinning
  loading indicator on App boot; longer + diagnostic video import
  errors; version label sourced from `app.getVersion()` instead of
  the hardcoded `v0.1`

---

## 2026-05-18 — Bug round 14: overlay injection, preset-list crash, captions hardening

### Bug — FFmpeg filter-graph injection via unvalidated text-overlay fields
- **Root cause.** `drawTextFilter` in `src/main/ffmpeg/filters.ts` escaped
  `overlay.text` and rounded `x`/`y`, but interpolated `overlay.sizePx`
  and `overlay.colorHex` **raw** into the `drawtext` filter string.
  `validateProject` checked that `videoStudio.clips` was an array but
  never descended into `clips[].textOverlays[]`, and `validateExportJob`
  validated the job's clip range but not its overlays. A malicious
  `.imagii.json` could set `colorHex` to
  `white,movie=C\:/Users/victim/.ssh/id_rsa[k];[k]...`, injecting
  arbitrary FFmpeg filter directives (`movie=` reads arbitrary files into
  the render).
- **Fix.** Defense in depth across three layers: (1) `validateProject`
  now descends into every clip and rejects the project via a new
  `isValidTextOverlay` helper — `colorHex` must match `/^#?[0-9A-Fa-f]{6}$/`,
  `sizePx` finite in 8..512, position/timing fields finite. (2)
  `validateExportJob` in `src/main/ipc/video.ts` reuses `isValidTextOverlay`
  on `clip.textOverlays` so a malformed overlay can't pass the
  `video:exportBatch` IPC. (3) `drawTextFilter` no longer interpolates
  raw — `safeOverlaySize` clamps to a finite 8..512 (fallback 48) and
  `safeOverlayColor` falls back to `white` on any non-hex value.
- **Test.** `src/shared/projectValidation.test.ts` — overlay injection
  payload / bad sizePx rejected, well-formed overlay accepted, no-overlay
  clip still accepted, plus direct `isValidTextOverlay` cases.
  `src/main/ffmpeg/filters.test.ts` — `safeOverlaySize` /
  `safeOverlayColor` coercion cases.
- **Lesson.** "Escape the text field" is not "sanitize the filter
  string." Every value interpolated into a command/filter string is an
  injection sink — validate or coerce *all* of them, and do it at the
  load boundary, the IPC boundary, and the sink.

### Bug — `listCustomPresets` crashed the IPC on a structurally-broken preset
- **Root cause.** `src/main/customPresets.ts` guarded `JSON.parse` in
  try/catch, but the next line `presets.sort((a, b) => a.name.localeCompare(b.name))`
  called `.localeCompare` on `undefined` if a preset `.json` was valid
  JSON yet structurally wrong (`{}`, `null`, `42`, a half-written file
  from a crash). The `TypeError` rejected the whole
  `video:listCustomPresets` IPC and the studio's preset list failed to
  load — the identical class fixed for mood boards in round 13.
- **Fix.** New pure `src/shared/customPresetParse.ts` —
  `parseCustomPreset(raw)` parses *and validates*, returning a
  fully-formed `CustomPreset` or `null`. `listCustomPresets` routes every
  file through it and skips nulls, so `.sort` only ever sees presets with
  a real `name`.
- **Test.** `src/shared/customPresetParse.test.ts` — well-formed parsed,
  invalid JSON → null, non-object root → null, missing/blank name → null,
  missing id → null, non-finite numeric field → null.
- **Lesson.** Same as round 13, now generalized: any "read a directory of
  user JSON files then operate on them" path needs a single
  parse-and-normalize choke point. A try/catch around `JSON.parse` alone
  is half a guard.

### Bug — captions IPC handlers lacked argument validation
- **Root cause.** `captions:transcribe` and `captions:burnIn` in
  `src/main/ipc/captions.ts` passed the raw renderer-supplied request
  straight to `runTranscribe` / `runBurnIn` with no validation — unlike
  every other IPC handler. Not currently exploitable (values come from
  the trusted renderer) but an inconsistent hardening gap.
- **Fix.** Each handler now `assertPlainObject`s the request and
  validates its path fields with `assertSafeAbsolutePath`
  (`sourcePath` for transcribe; `videoPath` / `srtPath` / `outputPath`
  for burn-in), mirroring `validateChainSpec` in `src/main/ipc/audio.ts`.
- **Test.** No direct unit test — the handlers import `electron` and
  cannot load under the node-env vitest config; the asserts are pure
  reuse of already-tested validators.
- **Lesson.** Hardening must be uniform. One handler that trusts its
  input is the one a future refactor wires an untrusted caller into.

---

## 2026-05-18 — Bug round 13: complete the moodboard corrupt-file guard

### Bug — a structurally-wrong board JSON still threw a `TypeError`
- **Root cause.** Round 12 wrapped `JSON.parse` in `renameCollection` /
  `addToCollection` / `removeFromCollection` so a *syntactically* corrupt
  board file returned `null` instead of throwing a `SyntaxError`. But the
  callers then immediately touched `collection.items` —
  `addToCollection` did `collection.items.some(...)`,
  `removeFromCollection` did `.find`/`.filter`. A file that was *valid
  JSON yet structurally wrong* (e.g. `{"id":"x","name":"y"}` with no
  `items`) passed `JSON.parse`, then threw
  `TypeError: Cannot read properties of undefined` one line later. The
  round-12 fix guarded the parse but not the access — an incomplete fix
  for the very scenario it set out to handle.
- **Fix.** New pure `src/shared/moodboardParse.ts` —
  `parseCollection(raw)` parses *and normalizes*: it returns a
  fully-formed `MoodBoardCollection` (with `items` guaranteed to be an
  array, structurally-broken items dropped) or `null`, never a
  half-valid object. `moodboard.ts` gained a single `readCollection`
  choke point that every reader (`listCollections`, `deleteCollection`,
  `renameCollection`, `addToCollection`, `removeFromCollection`) now
  routes through.
- **Test.** `src/shared/moodboardParse.test.ts` — 7 cases: well-formed,
  invalid JSON, missing `items` → `[]`, non-array `items` → `[]`,
  broken-items dropped, non-object root rejected, missing
  id/name/createdAt rejected.
- **Lesson.** A guard that catches a parse error but not the very next
  line that consumes the parsed value is only half a guard. When you
  harden a corrupt-input path, harden the *whole* path: parse AND
  normalize to a known-good shape at one choke point, so no caller can
  ever see a partially-valid object.

---

## 2026-05-18 — Bug round 12: whisper-download stream leak on cancel & unguarded moodboard parses

### Bug — `installWhisperModel` leaked the write stream + `.partial` file when the download was cancelled
- **Root cause.** In `src/main/sidecars/whisperManager.ts`, the write stream
  `const out = createWriteStream(partialPath)` was declared inside the
  `request.on('response')` handler, so it was only in scope for the
  `response.*` handlers. The sibling request-level handlers
  `request.on('error')` and `request.on('abort')` both called
  `cleanupPartial()` — which `unlink`s `partialPath` — without first closing
  `out`. When the user cancelled the 141 MB download, `request.abort()` fired
  `request.on('abort')` and `unlink` ran while `out` still held an open file
  descriptor. On Windows that throws `EBUSY` (swallowed by `cleanupPartial`),
  so the `.partial` file leaked and the fd stayed open until GC. The
  round-10 `out.on('error')` handler only covered the disk-error path.
- **Fix.** Hoisted the stream: declared
  `let out: import('node:fs').WriteStream | null = null` in the Promise
  scope above `request.on('response')`, and assign `out = createWriteStream(...)`
  inside the response handler. Both `request.on('error')` and
  `request.on('abort')` now call `out?.destroy()` before `cleanupPartial()`,
  mirroring how `response.on('error')` already destroys `out` first. The
  `response.*` handlers reference the same `out` via closure.
- **Test.** None — exercising it needs a network mock the suite doesn't have.
  The structural invariant is: every path that unlinks `partialPath` first
  destroys the write stream.
- **Lesson.** A resource cleanup function (`unlink`) and the handle that
  owns the resource (the write stream fd) must be released together, on
  *every* exit path. Declaring the handle in a narrower scope than the
  cleanup callers silently leaves cancellation paths unable to close it —
  and on Windows an unlink over an open fd fails instead of being harmless.

### Bug — moodboard `renameCollection`/`addToCollection`/`removeFromCollection` threw an uncaught `SyntaxError` on a corrupt board JSON
- **Root cause.** In `src/main/search/moodboard.ts`, those three functions
  each did `JSON.parse(raw) as MoodBoardCollection` with no try/catch. A
  corrupt board `.json` (hand-edited, or a partial write from a prior crash)
  threw a `SyntaxError` straight across the IPC boundary. The sibling
  functions `listCollections` and `deleteCollection` already guarded their
  parse.
- **Fix.** Wrapped the `readFile` + `JSON.parse` of each of the three
  functions in try/catch; on failure they `return null`, matching the
  `MoodBoardCollection | null` return shape the not-found branch already uses.
  The happy path is unchanged.
- **Test.** None — `moodboard.ts` imports `electron`'s `net` and resolves
  paths via `app.getPath`, so it is not loadable under `environment: 'node'`
  without an electron mock the suite doesn't have.
- **Lesson.** `JSON.parse` on any file a user (or a crash) can touch must be
  guarded. When some functions in a module already guard their parse and
  others don't, the unguarded ones are the latent crash — consistency across
  sibling functions is the tell.

---

## 2026-05-18 — Bug round 11: enum-validate the export preset, plug a thumb-cache leak & two design-token slips

### Bug — `validateExportJob` accepted any non-empty string as `preset`
- **Root cause.** `validateExportJob` in `src/main/ipc/video.ts` ended with
  `assertNonEmptyString(job.preset, ...)`, but `preset` must be one of the
  five `PlatformId`s. An unknown key (e.g. `"instagram"`) passed the IPC
  guard, then `PLATFORM_PRESETS[job.preset]` in `ffmpeg/export.ts` returned
  `undefined` and `buildVideoFilter` read `preset.aspectRatio` — an uncaught
  `TypeError` thrown across the IPC boundary. Every other enum field in
  `video.ts` (reframe/pip positions) already used `assertEnum`.
- **Fix.** Replaced it with
  `assertEnum(job.preset, ALL_PRESET_IDS, \`jobs[${idx}].preset\`)`;
  imported `ALL_PRESET_IDS` from `ffmpeg/presets.ts`. `assertEnum` was
  already imported in `video.ts`.
- **Test.** `src/main/ffmpeg/presets.test.ts` — `ALL_PRESET_IDS` exactly
  matches `PLATFORM_PRESETS` keys, and `assertEnum` over `ALL_PRESET_IDS`
  rejects `"instagram"`. `validateExportJob` itself is module-private and
  `video.ts` imports `electron` at top level (not loadable under
  `environment: 'node'`), so the guard's invariant is pinned at the
  `ALL_PRESET_IDS` + `assertEnum` layer instead.
- **Lesson.** A field with a closed set of valid values must be validated
  with `assertEnum`, never `assertNonEmptyString`. An IPC validator that
  lets a bad value reach a `Record` lookup just relocates the crash from a
  clean rejection to an uncaught `TypeError`.

### Bug — `deleteCollection` orphaned every cached thumbnail file
- **Root cause.** `deleteCollection(id)` in `src/main/search/moodboard.ts`
  unlinked only the `${id}.json` file. But `addToCollection` caches each
  item's thumbnail to disk and records `cachedThumbPath`; `removeFromCollection`
  cleans those up per-item. `deleteCollection` did not — every cached thumb
  for a deleted board leaked until the 500 MB `pruneThumbCache` cap reaped it.
- **Fix.** `deleteCollection` now reads + parses the collection and unlinks
  each item's existing `cachedThumbPath` (best-effort, per-file errors
  ignored) before unlinking the JSON. The read is wrapped in try/catch so a
  corrupt/missing JSON still lets the JSON unlink proceed.
- **Test.** None — `moodboard.ts` imports `electron`'s `net` and resolves
  paths via `app.getPath`, so it is not loadable under `environment: 'node'`
  without an electron mock the suite doesn't have.
- **Lesson.** When one operation creates side-effect files, every operation
  that destroys the owning record must clean them up. A per-item delete and
  a whole-collection delete are not one path — fixing the leak in one does
  not fix the other.

### Bug — `PostChecklist` sub-headers re-derived `PanelHeader` inline
- **Root cause.** Four sub-section headers in `PostChecklist.tsx` ("Title
  ideas", "Hashtag pack", "Posting log", "Diary (n)") were hand-written
  `<div className="text-xs uppercase tracking-wide text-ink-muted">` — the
  exact `PanelHeader` typography re-derived inline. They were missed in
  earlier passes because they are `<div>`, not `<h3>`.
- **Fix.** Converted all four to `<PanelHeader>` with sensible icons
  (`text` for the title/hashtag headers, `clipboard` for the log/diary).
- **Test.** None — renderer component, needs a DOM.
- **Lesson.** A shared component has one source of truth; grepping for the
  `<h3>` tag misses inline copies that drifted to a `<div>`. Search for the
  class string, not the element.

### Bug — `CropOverlay` painted a raw accent hex on a DOM element
- **Root cause.** `CropOverlay.tsx` set `border: '2px solid #a78bfa'` in the
  inline `style` of a `react-rnd` `<Rnd>` element. `#a78bfa` is the `accent`
  design token; `DESIGN_GUIDE` forbids raw chrome hex.
- **Fix.** Moved the border to the element's `className` as
  `border-2 border-accent`. The `boxShadow` scrim mask stays inline — it has
  no token equivalent.
- **Test.** None — renderer component, needs a DOM.
- **Lesson.** A literal hex that equals a token is a token by another name.
  Tailwind classes flow through `className`; only genuinely token-less
  values (a 9999px scrim shadow) belong in inline `style`.

---

## 2026-05-18 — Bug round 10: unreachable Record studio, unguarded streams & IPC args

### Bug — the Record studio was unreachable (no route registered)
- **Root cause.** `App.tsx` routed Welcome/Home/Video/Audio/Image/References
  but never registered `/record`, even though `routes/Record.tsx` existed
  and `Home.tsx` rendered a `NavCard to="/record"`. The unmatched path
  fell through to the `*` wildcard `<Navigate to="/home">`, so clicking
  "Record" silently bounced back to Home — the entire screen-capture +
  webcam-compositor studio was dead code.
- **Fix.** `App.tsx` now imports `Record` and registers
  `<Route path="/record" element={<Record />} />` before the wildcard.
- **Test.** None — `App.tsx` routing needs a DOM; vitest runs
  `environment: 'node'`.
- **Lesson.** A nav link and a route are two halves of one feature;
  adding a `NavCard` without the matching `<Route>` produces a silent
  redirect, not an error. When adding a screen, grep for its route
  string in `App.tsx` to confirm both halves exist.

### Bug — `installWhisperModel` write stream had no `'error'` handler
- **Root cause.** In `whisperManager.ts`, `createWriteStream(partialPath)`
  received `write()`/`end()`/`on('finish')` but no `on('error')`. A Node
  stream that emits `'error'` with no listener throws an uncaught
  exception — an ENOSPC on a near-full disk during the 141 MB model
  download crashed the whole Electron main process instead of failing
  cleanly.
- **Fix.** Added `out.on('error', ...)` that destroys the stream, runs
  `cleanupPartial()`, reports `phase: 'failed'`, and `settle()`s with
  `{ ok: false }` — matching the existing `response.on('error')` handler.
- **Test.** None — needs a network + fs-failure mock.
- **Lesson.** Every writable stream needs an `'error'` listener;
  an unhandled stream error is a process-level crash, not a local
  rejection.

### Bug — `probeVideo` silently coerced a missing duration to `0`
- **Root cause.** `probeVideo` used `duration: Number(data.format?.duration ?? 0)`.
  A malformed/partial ffprobe response (video stream present, no
  `format.duration`) yielded `duration: 0`, which flowed into
  `videoStore.loadSource` → `makeDefaultClip(0, 1)` → a silent
  `0:00→0:00` clip with no error. Round 7 fixed this exact pattern in
  `probeAudio` but never mirrored it to `probeVideo`.
- **Fix.** `probeVideo` now validates the duration once and
  `reject(...)`s with "ffprobe returned no usable duration for the
  video" when it is non-finite or `<= 0` — mirroring `probeAudio`.
- **Test.** None — needs an ffprobe mock (consistent with how the
  `probeAudio` round-7 fix was handled).
- **Lesson.** When a bug is fixed in one of two parallel code paths,
  immediately mirror the fix to the twin. Audio and video probes share
  a shape; a fix to one is a TODO for the other.

### Bug — `search:images` IPC handler trusted `query` was a string
- **Root cause.** The handler ran `query.trim()` directly on the IPC
  argument. A non-string arg (a renderer bug, or a malformed call)
  threw a TypeError across the IPC boundary instead of returning a
  result. Every other IPC handler guards its args.
- **Fix.** Extracted `normalizeImageQuery(raw: unknown)` — a pure
  helper that coerces non-strings to `''` and returns the clean
  empty-result shape for blank/non-string input — and routed the
  handler through it.
- **Test.** `src/main/ipc/search.test.ts` — covers non-blank, blank,
  empty, and a table of non-string args (`undefined`, `null`, number,
  object, array, boolean) all returning the empty shape without
  throwing.
- **Lesson.** IPC arguments are untrusted input; type-guard them at
  the boundary before any string/object method call.

---

## 2026-05-18 — Bug round 9: secondary-track path traversal, stream leaks, compositor hang

### Bug — `secondaryTrack.filePath` bypassed path-safety validation
- **Root cause.** `projectValidation.validateProject` validated
  `videoStudio.sourcePath`/`srtPath` and `audioStudio.sourcePath` with
  `isSafeAbsolutePath`, but `audioStudio.chain.secondaryTrack.filePath`
  was never checked — the audio branch only asserted `chain` was an
  object. A malicious `.imagii.json` could point `secondaryTrack.filePath`
  at an SSH key; that path reaches `ffmpeg -i` during audio export →
  arbitrary file read mixed into the output.
- **Fix.** `validateProject` now rejects a present-but-unsafe
  `secondaryTrack` (must be a plain object whose `filePath` passes
  `isSafeAbsolutePath`); `null`/absent stay accepted for back-compat.
  Mirrored in `validateChainSpec` (`main/ipc/audio.ts`) via
  `assertSafeAbsolutePath` so the IPC boundary rejects it too.
- **Test.** `src/shared/projectValidation.test.ts` — "rejects
  audioStudio.chain.secondaryTrack.filePath with .. traversal",
  "rejects ... non-object value", "accepts a safe absolute
  secondaryTrack.filePath", plus the null/absent back-compat cases.
- **Lesson.** When a validator walks a nested object, every
  externally-supplied path *inside* it needs the same path-safety check
  as the top-level ones — a single un-walked sub-object is a hole.
  Validate at both the file-load boundary and the IPC boundary.

### Bug — RecordStudio leaked streams when MediaRecorder construction threw
- **Root cause.** In `RecordStudio.startRecording`, by the time
  `new MediaRecorder(...)` / `recorder.start()` runs, `screenStreamRef`,
  `camStreamRef`, `compositorRef`, and `streamRef` may all be assigned.
  The outer `catch` only showed a toast — a `NotSupportedError` from
  MediaRecorder left every stream and the compositor rAF loop running
  until navigation.
- **Fix.** The outer `catch` now calls `stopAllStreams()` before the
  toast, releasing all four refs.
- **Test.** None — the device/recorder pipeline needs a real browser
  env. The structural invariant is "every `startRecording` exit path
  either calls `stopAllStreams` or hands ownership to the recorder."
- **Lesson.** Any function that acquires several resources in sequence
  before the success point must release them on *every* throw, not just
  the ones that happen before the first acquisition.

### Bug — compositor `waitForMetadata` could hang forever
- **Root cause.** `waitForMetadata(v)` resolved only on `loadedmetadata`
  with no timeout and no reject path. A stream that produced a track but
  never emitted `loadedmetadata` left `startCompositor` pending forever
  — the UI stuck, offscreen `<video>`s never torn down (the partial-init
  catch only fires on a throw).
- **Fix.** `waitForMetadata` now races the event against a 10 000 ms
  timeout that rejects with a clear `Error`; the timer is cleared if
  metadata arrives first (no dangling timer). The existing setup-phase
  try/catch in `startCompositor` then runs `teardownOffscreen` and
  propagates.
- **Test.** None added — `waitForMetadata` is module-private and depends
  on a real `HTMLVideoElement` (`addEventListener`/`readyState`), which
  needs a DOM env this vitest config (`environment: 'node'`) does not
  provide. Covered by manual smoke testing.
- **Lesson.** Any Promise that resolves only on a DOM event must also
  have a timeout-reject — an event that never fires is a silent hang,
  not an error.

---

## 2026-05-11 — Design system, guides, and review agents

A standardization pass: built a single icon system, replaced every emoji
in the UI, wrote five governing guides, stood up Design + QA review
agents, and added a deterministic emoji-enforcement hook. Two real bugs
fell out of the review.

### Bug — webcam silently dropped from a recording when the camera dropdown was never opened
- **Root cause.** `RecordStudio.tsx:startRecording` gated the compositor
  on `showCam && selectedCamId`. But `selectedCamId` stays `null` until
  the user actually *opens* the `<select>` and picks — the select
  merely *displays* `cams[0]` as its value via the `value={... ?? cams[0]}`
  fallback. A user who ticked "Include webcam", saw a camera in the
  dropdown, and hit record without touching it got a screen-only
  recording. Exactly the "UI shows X, output is Y" anti-pattern the
  original webcam-preview fix existed to kill — reintroduced one level
  down. The mic path didn't have the bug: its constraint falls back to
  the default device.
- **Fix.** Resolve `effectiveCamId = selectedCamId ?? cams[0]?.deviceId`
  in `startRecording`, mirroring how the `<select>` computes its
  displayed value. The compositor now runs whenever the dropdown shows
  a camera, touched or not.
- **Test.** Smoke-level (the device pipeline needs a real browser env);
  the structural invariant — "the gate matches the select's displayed
  value" — is the lesson of record.
- **Lesson.** **A controlled `<select>` whose `value` uses a `?? fallback`
  has a displayed value that its state variable doesn't reflect until
  `onChange` fires.** Any logic gated on that state must apply the same
  fallback, or the feature silently does nothing for the
  never-touched-the-dropdown case — which is the *common* case.

### Bug — layer "lock" toggle showed the same icon locked or unlocked
- **Root cause.** The emoji→icon migration replaced
  `{layer.locked ? '🔒' : '·'}` with an unconditional
  `<Icon name="lock" />`. The sibling visibility button correctly
  toggled `eye`/`eye-off`; lock did not, so a locked and an unlocked
  layer looked nearly identical (only a color shift).
- **Fix.** Added an `unlock` (open-padlock) icon; the button now toggles
  `lock`/`unlock` like the visibility button toggles `eye`/`eye-off`.
- **Lesson.** **When a migration swaps a two-state glyph
  (`A ? '🔒' : '·'`) for an icon, the icon must stay two-state.**
  Dropping the conditional turns a toggle into a label. Migrations that
  touch dozens of files need a second pass specifically for the
  conditional-render sites.

### Standardization — emoji → one icon system
- Built `components/Icon.tsx`: ~45 inline-SVG icons, 24×24 / 2px /
  `currentColor`, one `IconName` union. Replaced every emoji pictograph
  across ~30 components, plus the geometric/technical glyphs the design
  review caught (`⏸▶⏮⏭⎘◌↺▾▸` — media controls, disclosure carets, a
  duplicate glyph, a spinner) that an emoji-only scan had missed.
- Extracted three shared affordances that had been copy-pasted:
  `HomeLink`, `OutputDirLabel`, `AppToaster`.
- **Lesson.** **Emoji are an OS-fragmentation bug, not a style choice.**
  The same codepoint is a different glyph — sometimes color, sometimes
  monochrome — on every OS and OS version. The fix is one owned icon
  set. And the enforcement scan must cover *technical and geometric*
  Unicode blocks (U+2300–27BF, U+25A0–25FF), not just the emoji planes
  — the first version of `check-emoji.mjs` missed `⏸`/`▶` because they
  live in Misc Technical / Geometric Shapes.

### Process — guides + agents + a deterministic hook
- Wrote `PRODUCT_GUIDE`, `DESIGN_GUIDE`, `STYLE_GUIDE`, `BRANDING_GUIDE`,
  `USER_GUIDE` under `docs/`.
- Added `.claude/agents/qa-reviewer.md` and `design-reviewer.md`, and a
  `/guide-sync` command that re-checks guide↔code drift and runs both
  reviewers.
- Added `scripts/check-emoji.mjs` + a `PostToolUse` hook so the no-emoji
  rule is enforced on every file change, not just at review time.
- **Follow-up done:** the panel-header drift (~7 panels on `text-sm`
  where `STYLE_GUIDE` pins `text-xs`) is resolved — a `<PanelHeader>`
  component now backs all ~25 panel headers, so the markup has one
  source of truth and can't drift again.
- **Lesson.** **A guide only governs if something enforces it.** A prose
  rule decays; a `check-emoji.mjs` hook does not. Pair every guide rule
  that *can* be made deterministic with a script, and leave the
  judgment calls to the review agents.

---

## 2026-05-11 — Resolution / DPI rework (1080p · 2K · 4K)

Concrete fragility surfaced by a targeted audit and fixed across the renderer + main process. Goal: the app should look right and behave right on any of the three common streamer monitor classes — 1920×1080, 2560×1440, 3840×2160.

### Fragility 1 — Fixed 1280×800 window default cramped 4K monitors
- **Root cause.** `src/main/index.ts:createWindow` opened a 1280×800 BrowserWindow regardless of display size. On a 1080p screen that's the prior cramped default users got. On 2K or 4K it was actively bad: the studios were squeezed into a 1080p-sized box on a screen with 2–4× the pixel area.
- **Fix.** New `src/shared/windowSizing.ts` with a pure `computeInitialWindowSize(workW, workH)` helper. Returns 85% of the work-area, clamped into `[MIN 1280×800, MAX 2400×1500]`, and finally clamped to the work-area itself so we never request more pixels than the screen has. Wired into `createWindow` via `screen.getPrimaryDisplay().workAreaSize`.
- **Test.** `windowSizing.test.ts` — 6 cases pinning the behavior at each of the three resolutions plus an ultrawide and a too-small netbook case. Invalid input rejected at the function entry.
- **Lesson.** **A fixed pixel default is a tax on every user whose monitor isn't the developer's monitor.** The right move is "scale to your display." Adding the helper as a pure function with unit tests is cheap and means the next time someone touches the window-size code they have to update tests to break it.

### Fragility 2 — Canvas Stage scale capped at 1.0
- **Root cause.** `Canvas.tsx:157` computed `stageScale = Math.min(containerSize.w / doc.width, containerSize.h / doc.height, 1)`. On a 4K monitor with a 1920×1080 document, the container after panels might be 2500×1800 — and the canvas would render at 1:1 (1920×1080), wasting the rest of the screen. Users with 4K monitors had to either resize the document or accept a tiny editing canvas.
- **Fix.** Lifted the cap to `MAX_STAGE_ZOOM = 4`. A 1080p doc on a 2500-wide container now renders at ~1.3× (fills the area, stays sharp). A 112×112 emote caps at 4× so it doesn't blow up to a pixelated mess. Konva's pixelRatio auto-tracks DPR so the backing pixels stay crisp.
- **Test.** Existing rendering tests cover the scale math indirectly via the Canvas component; the explicit cap value is a code-readability decision documented inline.
- **Lesson.** **A `Math.min(..., 1)` hardcoded "never zoom in past 1×" guard usually means "I didn't have a high-res monitor when I wrote this."** Fit-to-container should fit to container — let the user's display reward them.

### Fragility 3 — Side panels fixed at 280/320/360 px
- **Root cause.** `ImageStudio`, `AudioStudio`, `VideoStudio`, `RecordStudio` all used `lg:grid-cols-[1fr_NNNpx]` with fixed pixel widths. On 1080p (1920 logical) those are ~15-19% of width (reasonable). On 4K (3840 logical) they're ~7-9% — the panels look like a strip of postage stamps next to a massive canvas.
- **Fix.** Switched all four to `clamp(MIN_PX, PERCENTAGE, MAX_PX)` patterns: Image 260/16%/380, Audio+Video 300/18%/460, Record 320/20%/520. On 1080p the percentage equals the prior pixel widths; on 4K the panels scale up but cap at the MAX so they don't dominate the canvas area.
- **Test.** CSS values; no direct unit test. Verified at three target resolutions during the manual review.
- **Lesson.** **`clamp(min, preferred, max)` is the right tool for a control panel that needs to be readable on both 1080p and 4K.** Fixed pixels are wrong; pure percentages are wrong (panels would be huge on ultrawide); clamp expresses the actual UX constraint ("at least readable, at most one-fifth of the screen").

### Fragility 4 — ExportDialog defaulted scale to 1× regardless of DPR
- **Root cause.** `ExportDialog.tsx:scale` defaulted to `1`. On a 4K monitor at 200% Windows scaling, `window.devicePixelRatio` is `2` — the canvas the user SEES is internally rendered at 2× — and yet the default PNG export was half the size of what they saw on screen. They had to remember to bump scale to 2× or 3× every time.
- **Fix.** New pure `defaultExportScale(dpr)` helper returns 1× for DPR<1.75, 2× for 1.75-2.49, 3× for ≥2.5. Wired into `useState` initial value. The picker still lets the user override.
- **Test.** `ExportDialog.test.ts` — 5 cases covering the three DPR bands plus invalid input fallback.
- **Lesson.** **A "scale" picker that defaults to "1×" is asking the user to remember what their monitor is.** The system already knows via `devicePixelRatio`; use it. The picker remains for the cases where the user wants explicit control (e.g., exporting a 2K canvas at 1× to keep the file small).

### Fragility 5 — Compositor webcam margin fixed at 32 px
- **Root cause.** `compositor.ts` defaulted `marginPx` to 32. On a 720p recording that's a sensible inset; on a 4K recording it's pinned-to-the-edge.
- **Fix.** Margin defaults to `Math.max(16, canvasW * 0.01)` — ~13 px at 720p, ~19 px at 1080p, ~26 px at 1440p, ~38 px at 4K. Caller can still override.
- **Test.** Existing `computeCornerRect` tests already cover margin behavior; the new computation lives in the caller path, verified by reading.
- **Lesson.** **Any "looks fine at the resolution I tested it at" margin is suspect.** Express margins as a function of the surface they're inset from, not as a constant. (Twitch's overlay margin recommendations are also expressed as percentages, which validates the choice of constant.)

### Fragility 6 — Templates and asset catalog targeted only 1080p
- **Root cause.** `templates.ts` had 1280×720 thumbnails and 1920×1080 overlays only. `assetCatalog.ts` had 1920×1080 only. Streamers with 1440p or 4K capture pipelines had to manually resize after picking a preset.
- **Fix.** Added 2K + 4K variants of the two most-used templates (Bold thumbnail, Streamer overlay) and the most-used asset (Clean corner frame). 4 new template entries + 2 new asset entries. All layer dimensions scale proportionally to the new canvas size so the look matches across resolutions.
- **Test.** Visual; the templates render through existing code paths covered by `templates.test.ts` style tests.
- **Lesson.** **A preset catalog that targets one resolution forces every user with a different resolution to do the conversion math themselves.** Offering 2K + 4K variants of the most-popular presets is cheap (the layout math is just multiplication) and removes friction for the streamers who'd otherwise tab out to a sizing chart.

### Things deliberately NOT changed
- **Konva default pixelRatio** — Konva already auto-uses `window.devicePixelRatio` for layer rendering. No explicit override needed; the canvas is sharp on 4K out of the box.
- **CSS pixel sizing throughout the renderer** — Chromium handles `1px` = 1 CSS pixel correctly at any DPR. The "fix CSS for HiDPI" instinct is misapplied here.
- **Recording resolution** — `screenStream.videoWidth/Height` is already the screen's natural resolution. Adapts automatically.

---

## 2026-05-11 — Bug sweep round 8 (compositor + assertDefined leaks)

### Bug — Screen MediaStream leaked when recording with webcam composited in
- **Root cause.** `RecordStudio.tsx:startRecording` opened the raw screen capture via `getUserMedia(screenConstraints)` and handed the resulting `MediaStream` to `startCompositor()`. The compositor wrapped it in a hidden `<video>` + `<canvas>` and returned a synthetic `outputStream` (the canvas-captureStream). RecordStudio stored *the synthetic stream* in `streamRef` and only stopped that ref in `stopAllStreams`. The original screen tracks from `desktopCapturer` were never `.stop()`d. After each webcam-composited recording, Windows kept the "screen is being shared" indicator visible and the GPU encode pipeline stayed open. Repeated recordings degraded framerate and eventually failed to start because the source was already in use.
- **Fix.** Added `screenStreamRef` in `RecordStudio.tsx`, assigned at the moment `getUserMedia` resolves (before any path that might hand it to the compositor). `stopAllStreams` now releases tracks from all four refs: `streamRef`, `camStreamRef`, `screenStreamRef`, and `compositorRef`. The pattern is uniform — every track-owning ref is in the cleanup function, no exceptions.
- **Test.** No direct unit test — covering this requires mocking `getUserMedia`/`MediaRecorder`/the whole device pipeline, which is high mock weight for one structural bug. This lesson doc is the test of record. The structural invariant is verifiable by reading `stopAllStreams`: if a new MediaStream-owning ref is added, it must be added to the cleanup block.
- **Lesson.** **A handle that wraps another handle is not a substitute for tracking both.** The compositor abstracts the canvas-captureStream pipeline cleanly, but it does NOT take ownership of the input streams — and it shouldn't, because the caller may want to fall back to a screen-only path with the same screenStream. Caller-owns-the-source is the right boundary; the bug was that the caller forgot to actually hold the source. When wrapping a resource, document explicitly who is responsible for stopping the wrapped thing.

### Bug — `startCompositor` leaked offscreen `<video>` elements on setup failure
- **Root cause.** `compositor.ts:startCompositor` appended two offscreen `<video>` elements to `document.body` BEFORE awaiting `play()`, `waitForMetadata()`, and `getContext('2d')`. If any of those steps threw (e.g., `play()` rejecting on a denied autoplay policy, `waitForMetadata` hanging on a stream that never emits `loadedmetadata`, `getContext` returning null in a low-memory scenario), the function rejected without removing the videos from the DOM. The orphaned elements kept their `srcObject` references to the input MediaStreams, so the screen and webcam tracks stayed open until page unload.
- **Fix.** Extracted `teardownOffscreen(elements)` helper (also reused by the normal `stop()` path). Wrapped the setup phase in try/catch: on failure, call `teardownOffscreen` before re-throwing. Hoisted `canvasW`/`canvasH`/`ctx`/`canvas` declarations outside the try so the post-setup code can use them, with `assert` ensuring `ctx` is non-null.
- **Test.** `compositor.test.ts` — 3 new cases under "teardownOffscreen (partial-init cleanup)": (1) pauses + nulls srcObject + removes from parent for each element, (2) survives a `pause()` throw on a half-detached element and still cleans the second one, (3) handles a detached element (no parentNode).
- **Lesson.** **`appendChild` is a side effect that must be undone on every failure path between it and the function's return.** The pattern "create → append → await → return handle" is dangerous because the awaits can throw. Either move the appendChild AFTER all the can-throw work (when feasible), or wrap the awaits in try/catch with an explicit cleanup. The same pattern bit us in `runConcat` (segment-encode failures leaving temp mp4s) — different resource, same root cause: side effects without paired cleanup.

### Bug — `assertDefined` silently returned `null` as type `T` in production
- **Root cause.** `src/shared/assert.ts:assertDefined` mirrored the `assert()` prod fallback ("warn + continue") but in a way that defeated its own purpose. When `value` was null/undefined in production, the function logged a warning and `return value as T`. The caller, trusting the `T` return type, immediately did `result.foo` or `result.length` and crashed with `TypeError: Cannot read properties of null` — a less informative error than the named `AssertionError` it would otherwise have produced. The whole point of using `assertDefined` over the `!` non-null assertion was Power-of-Ten compliance and clear failure messages; the prod path threw both away.
- **Fix.** `assertDefined` now throws in both dev and prod. Prod path still logs `console.warn` so the failure is visible on the console (nothing is collected or sent — there is no telemetry in imagii), but then falls through to the same `throw new AssertionError(...)`. The post-condition matches the type signature: if you got a value back, it's defined.
- **Test.** `assert.test.ts` — 3 new cases under "assertDefined in production": (1) still throws AssertionError on null with the named message, (2) still throws on undefined, (3) returns defined values unchanged (zero, empty string, false — the falsy-but-defined cases).
- **Lesson.** **A "soft" assertion is only soft if the post-condition is preserved without the asserted invariant.** `assert(cond, ...)` is genuinely soft: it returns void, callers that don't rely on `asserts cond` narrowing keep working. `assertDefined(value, ...)` is NOT soft: callers always rely on the return value being non-null. Throwing later with a worse message is strictly worse than throwing now with a good one. The "never crash a user's session" goal is real, but it applies to invariants that callers can degrade gracefully through — not to invariants the caller is about to dereference.

### False alarms verified clean (3 of 7 agent-flagged "bugs" were misreads)
- `concat.ts` missing `await` on `fs.mkdir` — agent misread; `const fs = await import(...)` is correctly assigned before use.
- `filename.ts sanitizeFilename` allowing trailing dots — regex `[^\w\-]+` matches `.`; the dots ARE stripped. Verified by hand.
- `ImportPanel.tsx` paste handler stale closure — `addLayer` is a Zustand action, stable across renders. Closure does the right thing.
- `ImageStudio.tsx` keyboard handler stale closure — dep array `[undo, redo, selectedLayerId, removeLayer, setTool]` is complete; effect re-binds when selection changes.
- `audioStore patchChain` race — JavaScript is single-threaded; Zustand `set/get` are synchronous; there is no race.
- `whisperManager cleanupPartial().then()` rejection — `cleanupPartial` has internal try/catch around the only awaited operation; it never rejects, so the `.then()` always fires.
- `safeZone.ts` floating-point asymmetric tolerance — symmetric tolerance is by construction (`>= outer - eps` on both sides, `<= outer + size + eps` on both sides). Misread.

**Process lesson.** Three of three sub-agents in this sweep returned at least one false-positive bug. They're useful for locating candidate files and patterns, but EVERY claim needs verification against source. Total agent-flagged bugs: 11. Real after verification: 3. Hit rate: 27%. Plan accordingly.

---

## 2026-05-11 — Webcam preview fix (held item → shipped)

### Bug — "Show webcam preview while recording" was preview-only, didn't composite into the saved file
- **Root cause.** `RecordStudio.tsx:startRecording` built the MediaRecorder's input from `screenStream.getVideoTracks()` + `micStream.getAudioTracks()`. The webcam's stream was attached to a `<video>` element for on-screen preview but never reached the MediaRecorder. Users would tick the box, see themselves in the preview window, and end up with a recording that contained only the screen.
- **Fix.** New `compositor.ts` module: when both screen and webcam are active, mount two hidden offscreen `<video>` elements, draw to a hidden `<canvas>` at the screen's natural resolution per `requestAnimationFrame`, and feed the recorder via `canvas.captureStream(fps)`. Compositor handle exposes a `stop()` that tears down the canvas + offscreen videos + captured stream tracks on recording end. Corner is user-selectable (top-left / top-right / bottom-left / bottom-right) and persisted via electron-store as `record.webcamCorner`.
- **Test.** `compositor.test.ts` — 11 cases covering `computeCornerRect` (all 4 corners, min-size clamp, negative-margin clamp, invalid inputs) and `drawFrame` (correct call order, aspect-preserve letterboxing when cam ratio ≠ box ratio, skipping webcam draw when null, skipping screen draw when not ready).
- **Lesson.** **A "preview" toggle that doesn't match the recorded output is a misleading-feature anti-pattern.** Either the preview IS the output or the toggle label needs to say so explicitly. The held-item docs flagged this — "looks like it'll record, doesn't" — and the fix took the harder path (actually composite) rather than the easy one (just rename to "preview only"). Worth it: webcam-in-recording is a baseline streamer feature; matching user expectations beats matching the original implementation's scope.

---

## 2026-05-11 — Bug audit round 7 (probe duration + tempCleanup input assertion)

### Bug — `probeAudio` silently coerced missing `duration` to 0
- **Root cause.** `src/main/audio/probe.ts` already threw on missing audio stream (line 49), but read `Number(data.format?.duration ?? 0)` for duration. A malformed or partial ffprobe response (audio stream present, format object empty) silently produced `duration: 0`, which propagated to `audioStore.loadSource` → produced `0:00 → 0:00` clip ranges downstream. Not a crash, but confusing UX.
- **Fix.** Compute `duration` once, validate with `Number.isFinite(duration) && duration > 0`, throw `'ffprobe returned no usable duration for the audio stream'` if invalid. Returns the validated value (no second `??`).
- **Test.** Not directly tested — would need to mock ffprobe stdout. Structural check at the function entry.
- **Lesson.** **A `?? 0` default on a numeric field that flows into UI is almost always wrong.** Either the field is essential (refuse on absence) or it's truly optional (in which case 0 is correctly meaningful). "Silently substitute 0" is the third option and it produces the worst UX: the user sees broken behavior with no error to copy-paste. Audit `?? 0` and `?? ''` for similar patterns where a missing value should be an error.

### Bug — `pruneStaleTempFiles` lacked parameter assertion on `now`
- **Root cause.** PoT rule 7 (validate parameters at function entry) wasn't applied. `now: number = Date.now()` was trusted as-is. A caller passing NaN would make `now - mtime < threshold` always-false (NaN comparisons are always false) → cleanup silently no-ops, files accumulate. A negative `now` would over-delete fresh files (the threshold delta goes the wrong way).
- **Fix.** Added `assert(Number.isFinite(now) && now >= 0, ...)` at function entry.
- **Test.** `tempCleanup.test.ts` — new case "throws on non-finite or negative now" covers NaN, Infinity, -1.
- **Lesson.** **PoT rule 7 isn't optional even for functions called only by trusted code.** Today's "called only by app startup with Date.now()" is tomorrow's "called from a test, an extension, or via IPC abuse." Cost of adding the assert: 1 line. Cost of debugging a silent-noop later: hours. The assert also serves as inline documentation of the function's preconditions.

### False alarms verified clean (5 candidates checked, 2 real)
- `scoreHighlights` inverted-range crash — inputs come from `findHighlights` (FFmpeg ebur128 output, always sorted), not from untrusted state. No injection path.
- `pathSafety.ts` permissive type guard — the guard variant intentionally returns false on bad input; the `assertSafe*` variant calls `assert()`. Already correct.
- `audio:extractFromVideo` cleanup lifecycle — leaked WAVs are mitigated by `pruneStaleTempFiles` (the prior round's fix). Acceptable.
- All test-coverage gaps flagged (probe, scoreHighlights, extractAudioFromVideo) require mocking native binaries; cost > value at the current scale.

---

## 2026-05-11 — Bug audit round 6 (transcribe race + drawtext newline escape)

### Bug — `runTranscribe` had no concurrency guard
- **Root cause.** Same shape as the `installWhisperModel` race from round 4, in a different function. The UI gates rapid clicks via `disabled={running}`, but a caller bypassing UI (dev console, multi-window scenario, IPC abuse) could trigger two concurrent transcribes. Each would extract a separate WAV (CPU + disk waste), spawn its own `whisper.exe` (CPU contention), and produce a separate timestamped SRT. The first-to-complete SRT path lands in renderer state; the second overwrites it; the first SRT becomes an orphan in `captionsOutputDir/`.
- **Fix.** Added a `transcribeInProgress` flag claimed synchronously at function entry, mirroring the `installInProgress` pattern. Refactored existing body into `runTranscribeBody`. New `__whisperTranscribeTesting__` export for unit-testable gate logic.
- **Test.** `whisperManager.test.ts` — 2 new cases under "runTranscribe — concurrency guard". 
- **Lesson.** **When you fix a concurrency-claim race in one function, immediately grep for the same pattern elsewhere.** The `installWhisperModel` fix (round 4) and this `runTranscribe` fix are structurally identical: long-running operation with module-level state, no synchronous claim before async work. The lessons doc now lists three "claim-flag must be synchronous" instances. Future code that spawns long-running sidecars should adopt the pattern proactively, not after the bug surfaces.

### Bug — `escapeDrawtext` didn't escape newlines or carriage returns
- **Root cause.** `src/main/ffmpeg/filters.ts:escapeDrawtext` escaped the well-known four offenders (backslash, single quote, colon, percent) but not `\n` / `\r`. A text overlay (multi-line caption) or a watermark with embedded newlines produced a malformed `drawtext=text='line1[NEWLINE]line2'...` arg, which FFmpeg's drawtext filter parser rejects. Result: the entire export fails with a cryptic FFmpeg error.
- **Fix.** Added `.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n')` to the escape chain. All three forms (CRLF, LF, CR) collapse to FFmpeg's `\n` escape sequence. Exported the helper via `__testing__` for direct unit testing.
- **Test.** New `src/main/ffmpeg/filters.test.ts` — 5 cases covering the four classics, all three newline forms, combined offenders without double-escape, empty input, safe-passthrough.
- **Lesson.** **"User text" includes whitespace characters, not just printable characters.** Any text-as-arg escape function should explicitly handle `\n` / `\r` / `\t`. The first three are the most common; harder-to-spot ones (RTL marks, zero-width joiners) are rarer but exist. Default to "block everything in a known-broken set" and add to the set as bugs surface — don't try to enumerate "every safe character."

### False alarms verified clean
- `HighlightPanel.tsx` onHighlightProgress cleanup — agent missed that `return off` IS the useEffect cleanup; not missing.
- `ExportPanel.tsx` offProgress/offDone null-check — preload always returns a function from these subscribe APIs; the null check is defensive but not addressing a real bug.
- `Canvas.tsx` ResizeObserver leak — early `if (!containerRef.current) return` means no observer is created in the leak scenario; nothing to leak.
- `exportBatch` cancel mid-loop — agent missed that `await runExportJob(...)` rejects on cancel, propagating up out of the for-of loop and terminating the batch.
- `Player.tsx` pause on source change — playback state IS reset; no audible artifact in practice.
- `aselectForCuts` overlapping cuts — `not(A + B)` in FFmpeg's expression evaluator correctly implements the union-drop; agent misread the semantics.
- `whisperManager.ts` partial SRT detection — existing `if (code === 0)` gate rejects before SRT is read.
- RecordStudio webcam stream toggle — flagged as a held product-decision item; not part of this audit's scope.

---

## 2026-05-11 — Bug audit round 5 (undo race + missing error boundary)

### Bug — `useGlobalUndo` 50ms setTimeout flag-clear created a race window
- **Root cause.** The `undoingRef` flag was set to `true` before calling the store's `undo()`/`redo()`, then cleared inside `setTimeout(() => { undoingRef.current = false }, 50)`. The intent was to suppress the change-tracker from logging the undo itself as a new user action. But Zustand fires its subscribers SYNCHRONOUSLY inside `setState()`, so by the time `undo()` returns, all subscribers have already run. The 50ms timeout created a window where a user-initiated mutation arriving immediately after the undo (e.g., a fast `Ctrl+Z` followed by typing) would be misclassified as "from undo" and dropped from the tracker. The next undo would then skip the user's real edit.
- **Fix.** Replaced `setTimeout(release, 50)` with a synchronous `try { storeUndo() } finally { undoingRef.current = false }`. The flag is true only for the exact span of the store call — zero ticks of stale window.
- **Test.** No unit test added: testing this would require `@testing-library/react` (a new dev dep) to render the hook and simulate the timing race. The fix is structural — there's nothing async between `undo()` returning and the flag clear, so the race can't exist. Lesson logged here is the test of record.
- **Lesson.** **A `setTimeout(..., 50)` placed "to let things settle" is almost always papering over a misunderstanding of the underlying API's timing.** If the API is synchronous (Zustand subscribers, React render passes within `act()`, etc.), the right fix is a `try/finally` that clears state on the same tick. If the API is async, the right fix is to await the actual signal of completion, not a wall-clock guess. Wall-clock guesses introduce races that are nearly impossible to reproduce in tests but show up as "occasionally lost edits" in user reports.

### Bug — No React error boundary; any render error crashes the whole app to a white screen
- **Root cause.** `App.tsx` wrapped its routes directly: `<Routes>...</Routes>`. React doesn't have a built-in error catch for render errors; the default behavior is to unmount the entire tree. A throw inside any studio component crashed the user to a white screen with no recovery UI; they had to force-quit imagii.
- **Fix.** New `src/renderer/src/components/ErrorBoundary.tsx` — class component, dependency-free, inline-styled (doesn't depend on Tailwind layout context in case the error came from layout itself). Catches via `getDerivedStateFromError`, logs to console with component stack, renders a recovery UI with the error message + collapsible component stack + a "Reload to Home" button that resets routing without losing autosave state. Wrapped around `<Routes>` in `App.tsx`.
- **Test.** Same situation — testing error boundaries needs RTL. Structurally guaranteed by React's error boundary contract.
- **Lesson.** **Every renderer app needs at least one error boundary at the top of the route tree.** Without one, every render error is a force-quit. The fix is small (~80 lines) and the failure mode it prevents is "user loses their work because we forgot." Treat it as table stakes alongside autosave.

---

## 2026-05-10 — Bug audit round 4 (paths + recording temp leak)

### Bug — Path traversal in `imagii-file://` protocol handler
- **Root cause.** `src/main/protocol.ts` registered a custom URL scheme to serve user files to the renderer (video/audio/image preview). The handler decoded the URL, called `pathToFileURL(decoded)`, then `net.fetch`. Zero validation. A malicious `.imagii.json` carrying `videoStudio.sourcePath: "../../../Users/victim/secret"` (or an absolute path to a sensitive file) would slip through: the project validator only checked `isOptionalString`, the renderer dutifully built an `imagii-file://` URL via `pathToImagiiFileUrl`, the protocol handler fetched it. Arbitrary file read on import.
- **Surface.** A user opening a shared `.imagii.json` (the user-facing import flow) is the attack vector. Renderer is trusted; the trust line is broken by treating the project file as data not code.
- **Fix.** New `src/shared/pathSafety.ts` with `isSafeAbsolutePath()` + `assertSafeAbsolutePath()`. Rejects: relative paths, unresolved `..` segments, Windows reserved device basenames (CON/PRN/AUX/NUL/COM1-9/LPT1-9). Wired into TWO sites for defense in depth:
  1. `projectValidation.ts` — new `isOptionalSafePath` predicate; rejects malicious paths at *load* time so they never reach the renderer.
  2. `protocol.ts` — `if (!isSafeAbsolutePath(decoded)) return 403` so even a path that somehow bypasses project validation still can't be fetched.
- **Test.** `src/shared/pathSafety.test.ts` (8 cases — accepted paths, rejected paths, the `foo..bar` non-false-positive, reserved-name case-insensitive, non-string input). `src/shared/projectValidation.test.ts` adds 5 integration cases (sourcePath traversal, srtPath traversal, relative audioStudio path, Windows reserved name, null srtPath back-compat).
- **Lesson.** **Anywhere a user-provided path is read, validate it the same way you'd validate untrusted SQL.** "It's just a string field" is how arbitrary-file-read bugs ship. Two-layer defense — project-file validator rejects, protocol handler also rejects — means a regression in one layer doesn't expose the other. The `isOptionalString` check is necessary but insufficient for any field that ultimately gets passed to a file API.

### Bug — `convertWebmToMp4` leaked 100MB+ WebM temp files on conversion failure
- **Root cause.** Recording flow in `src/main/ipc/recording.ts`. The `unlink(tempPath)` call sat AFTER `await convertWebmToMp4(tempPath, outputPath)`. If ffmpeg exited non-zero (any conversion error — bad codec, disk full, permissions, killed process), `convertWebmToMp4` threw and the `unlink` never ran. A typical 5-minute recording is 100–250 MB; multiple failed conversions = significant disk waste accumulating in `%APPDATA%/imagii/recordings/`.
- **Fix.** Same shape as the prior `runTranscribe` / `runConcat` fixes: wrap the post-dialog conversion/copy block in `try/finally`. The `unlink(tempPath)` lives in the finally; runs on every exit path.
- **Test.** Structural guarantee — try/finally enforces the invariant. Integration test would need a way to make ffmpeg fail predictably.
- **Lesson.** **This is the same pattern (success-path-only cleanup) that bit us in `runTranscribe` and `runConcat`.** Once is a coincidence; twice is a pattern; three times is a code-review checklist item. Going forward: ANY function that writes a temp file and then runs a subprocess MUST wrap the subprocess in `try/finally` with cleanup. Grep `await mkdir` + nearby `spawn` / `await writeFile` + nearby `spawn` should be flagged in review.

---

## 2026-05-09 — Regression audit round

### Bug — `installWhisperModel` could clobber its own concurrency-tracking pointer
- **Root cause.** Two callers entering `installWhisperModel()` in rapid succession could both pass the implicit "is null?" expectation: there are 3 `await` points before `activeInstall = me` is reached (`stat`, `mkdir`, `unlink`). Caller A pauses on `await stat`, caller B enters and also pauses on `await stat`, caller A resumes and sets `activeInstall = me1`, caller B resumes and overwrites with `activeInstall = me2`. From that point both callers' downloads write to the same `.partial` path, racing each other; only `me2` is reachable from the cancel button.
- **Surface.** UI gates rapid clicks via `disabled={installing}`, but the IPC handler is reachable from the dev console / multi-window scenarios / state desync. Defense-in-depth.
- **Fix.** Added a synchronous `installInProgress` boolean flag, claimed at function entry BEFORE any `await`. Released in a `finally`. Two rapid calls: the first claims, the second sees `installInProgress === true` and returns `{ok: false, reason: 'install already in progress'}` immediately. Refactored the body into a private `runInstall()` to keep the guard tidy.
- **Test.** `src/main/sidecars/whisperManager.test.ts` `installWhisperModel — concurrency guard` (2 cases). Added `__whisperInstallTesting__` export of `setInstallInProgressForTest` + `isInstallInProgress` so the gate is testable without mocking Electron's `net` module.
- **Lesson.** **A "claim" flag must be set synchronously, before any `await`.** JavaScript's single-threaded event loop guarantees a synchronous block runs atomically — that's the only window where you can safely claim shared state without races. If the claim happens after an `await`, two callers can pass through the same gate. The pattern: read-flag → set-flag → await...; never read-flag → await... → set-flag.

  **Companion check applied.** `analyzeClipHook` uses the same `activeHookProcess` pattern but has NO async pauses between function entry and the synchronous Promise constructor where the kill+spawn happens — so it's race-free without a separate flag. Different semantics anyway (latest wins for hook analysis; first wins for installs).

---

## 2026-05-08 — Tech-debt + bug round 2

### Bug — `runTranscribe` leaked a ~141 MB WAV on Whisper failure
- **Root cause.** `extractAudioFromVideo` returned `{wavPath, cleanup()}`. The success path called `cleanup()`, but if `whisper.exe` exited non-zero, the `await new Promise(...)` rejected and the function returned without ever touching `cleanup`. The WAV stayed in `%TEMP%/imagii-audio/` until the user rebooted.
- **Fix.** Wrapped the spawn-and-parse block in `try/finally`; `cleanup()` runs on every exit path.
- **Test.** `src/main/sidecars/whisperManager.test.ts` doesn't directly exercise this (would need an integration test with whisper sidecar), but the cleanup invariant is enforced by the try/finally structure. Phase 12 / commit `7f4c260`.
- **Lesson.** **`try/finally` is non-negotiable for any function that creates a temp resource and runs a subprocess.** "Success path cleanup" is the bug pattern: write the cleanup once and let `finally` handle every code path.

### Bug — `runConcat` leaked per-segment temp files on segment-encode failure
- **Root cause.** Same shape as above. The cleanup loop ran only after a successful concat; a segment-encode failure left dozens of partial mp4s behind.
- **Fix.** Same `try/finally` pattern. Also pushed segment paths to the cleanup list *before* spawning the encoder (rather than after success), so partially-written files are still tracked for cleanup.
- **Test.** Indirect — covered by the same try/finally structural guarantee.
- **Lesson.** **Track resources for cleanup at allocation time, not at success time.** If a step fails halfway through, the partial output still needs cleaning up.

### Bug — `CaptionsPanel` showed stale captions from the prior video after loading a new source
- **Root cause.** `srtPath` had been promoted to videoStore (good — clears on `loadSource`), but the panel's local `segments` and `progress` state weren't tied to source changes. Loading a new video left the segments list visible from the previous transcription.
- **Fix.** Added `useEffect(() => { setSegments(null); setProgress(null) }, [source?.filePath])`.
- **Test.** Component-level; not directly tested. The pattern is captured by reading the diff in commit `e111001`.
- **Lesson.** **When you promote one piece of state into a shared store but leave related local state, you get an inconsistency bug.** If state X resets on event Y, all state derived from X's lifecycle must reset on Y too. Audit the surrounding component for sibling state when promoting.

### Bug — `installWhisperModel` could `resolve()` twice
- **Root cause.** Three event sources (`response.error`, `request.error`, `request.abort`) could each fire `resolve()`. A network failure mid-stream could trigger both `response.on('error')` and the outer `request.on('error')`, doubling cleanup of the partial file and toast-spam the user.
- **Fix.** Added `let settled = false` and a single `settle()` wrapper. Every code path goes through it; second calls are no-ops.
- **Test.** Functional structure, not directly tested (would need network fault injection).
- **Lesson.** **When wrapping an event-driven API in a Promise, always add a single-resolve guard.** Multiple event sources is the rule, not the exception. The `settled` flag pattern is the canonical fix; don't omit it.

### Bug — Path-traversal in `captions:copySrtTo`
- **Root cause.** The IPC handler accepted any `srcPath` and ran `fs.copyFile(srcPath, destPath)`. Even though the only current caller passes our own `runTranscribe` output, defense-in-depth was missing.
- **Fix.** Restricted `srcPath` via `path.relative(captionsOutputDir(), srcPath)`. If the relative path starts with `..` or is absolute, reject with "outside the captions directory".
- **Test.** `src/main/ipc/captions.ts` has runtime check. Pure-function test would belong in a future `pathSafety.test.ts`.
- **Since.** The channel is `captions:writeKitSrt` (T-113); its confinement is now driven on real files by `captionsWriteKitSrt.test.ts`.
- **Lesson.** **Every IPC handler that takes a path must constrain that path to the directory it's allowed to operate on.** `path.relative` + `isAbsolute` check is the right shape; string-prefix matching breaks on symlinks and `..\\` sequences.

### Bug — Chat-log keystroke lag in HighlightPanel
- **Root cause.** `useMemo` recomputed `parseChatLog + scoreHighlights` on every keystroke. With a pasted 50KB+ chat log, that's user-perceivable lag on a fast typist.
- **Fix.** Debounced the chat value used by the scoring memo by 300ms. Textarea remains responsive; expensive recomputation lags one tick behind.
- **Test.** Not directly tested (timing-sensitive). The debounce constant is the documented contract.
- **Lesson.** **`useMemo` does not skip work when its inputs change rapidly — it just memoizes.** If the inputs include a fast-changing string from a textarea, debounce the memo input or move the work into a `useEffect` with cleanup.

---

## 2026-05-07 — Phase 2 verified bug fix round

### Bug — Double-loudnorm with secondary track `matchLoudness`
- **Root cause.** When `chain.loudnorm: true` AND `secondary.matchLoudness: true`, `process.ts` was concatenating `loudnorm=I=…:print_format=summary` (already in `finalChain.filterPass2` from the two-pass measurement) with another `loudnorm=I=${target}…`. Two loudnorms in series produced the wrong measurements before the mix.
- **Fix.** Added `chainEndsWithLoudnorm()` helper in `chain.ts`. `process.ts` now skips the appended loudnorm when the chain already ends in one.
- **Test.** `src/main/audio/chain.test.ts` `chainEndsWithLoudnorm` — true/false paths. `buildChain` test confirms exactly one `loudnorm=` per filter graph.
- **Lesson.** **When composing filter chains from multiple sources, write a "string ends with a particular stage" predicate and gate concatenations on it.** Every filter chain has the property "if it already does X, don't do X again."

### Bug — `project:load` parsed JSON without try/catch
- **Root cause.** `JSON.parse(raw) as ImagiiProject` is not safe — a corrupted file crashes the IPC and the renderer sees an unhandled rejection.
- **Fix.** Replaced with `validateProjectJsonString(raw)` (a helper that already existed but was unused on this path). Returns a discriminated union; the renderer walks the cases.
- **Test.** `src/shared/projectValidation.test.ts` — empty file, truncated JSON, garbage all return `{ok: false}`.
- **Lesson.** **Two helpers that solve the same problem in different code paths is a smell.** Audit for unused helpers before writing new ones; the answer is often already there. (`validateProjectJsonString` had been written for autosave but never wired into `project:load`.)

### Bug — `addClipFromRange` accepted reversed ranges
- **Root cause.** The auto-highlight finder and chat-spike panel both call `addClipFromRange(name, startSec, endSec)`. Neither validated `startSec < endSec`, so a sloppy candidate produced a clip with negative duration that broke export math downstream.
- **Fix.** Early-return on `endSec <= startSec` or non-finite values. Clamp valid ranges to `[0, source.duration]`.
- **Test.** `src/renderer/src/modules/video-studio/store/videoStore.test.ts` — 6 cases including reversed, equal, NaN, Infinity, overrun.
- **Lesson.** **State-mutation actions in stores are public APIs.** Validate as if any caller might be wrong, not just as if the current caller is correct. Silent reject + log is fine for "could be wrong but caller will continue" cases.

### Bug — Whisper SRT timestamp parser used variable-length fractional seconds incorrectly
- **Root cause.** `Number(m[4]) / 1000` assumed exactly 3 fractional digits. Whisper occasionally emits 1-, 2-, or 4+ digit fractions; `Number('5') / 1000 = 0.005` instead of `0.5`. Caption timestamps were silently 100× too small for 1-digit fractions.
- **Fix.** Replaced with `parseFloat('0.' + frac)`. Works for any digit count.
- **Test.** `src/main/sidecars/whisperManager.test.ts` `tsToSeconds` — 1, 2, 3, 4+ digit fractional cases.
- **Lesson.** **When parsing a timestamp / size / version field, never assume a fixed digit count.** The trick `parseFloat('0.' + frac)` works for any length and is more honest than the divide-by-power-of-10 form.

### Bug — `AutosaveRestore` held the suppress flag for 1.5s on failed restore
- **Root cause.** Successful restore needed a 1.5s window for stores to flush. The `setTimeout(release, 1500)` ran in `finally`, so a *failed* restore — where there's no flush to wait for — also delayed releasing autosave. Users hitting a corrupted autosave got a 1.5s autosave-locked window for no reason.
- **Fix.** `if (restored) setTimeout(release, 1500); else release()`.
- **Test.** Component-level; not directly tested.
- **Lesson.** **`finally` runs on every path. Sometimes that's exactly wrong.** Use a `succeeded` boolean and branch in `finally` if the cleanup behavior differs by outcome.

---

## How to add an entry to this doc

When you find a bug, add a new entry at the top under today's date. Use the standard 5-field shape: bug / root cause / fix / test / lesson.

The lesson is the most important part. It's the abstract pattern that future code reviewers should be able to recognize. If you can't articulate a generalizable lesson, the entry is incomplete.

Cross-reference each entry with the commit that fixed it. Future bisects will thank you.
