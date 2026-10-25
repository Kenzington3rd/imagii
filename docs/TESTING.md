# imagii — Testing Guide

imagii ships five complementary test layers. Each catches a different
class of regression; together they make a clean `npm run verify`
followed by `npm run test:e2e:build` and `npm run test:media` enough
confidence to tag a release.

---

## How long each layer takes

The one place the durations live (T-122: they had drifted three ways across this guide, `vitest.integration.config.ts` and
`release.yml`; every other mention points here, `playwright.config.ts` and `video-pipelines.spec.ts` included since T-123). The idle
| `npm run verify` | emoji guard, both typechecks, the unit suite (179 files, 4870 tests) | about 50 s (46.6 s and 48.1 s of vitest in round 84; 48.7 s to 58.6 s over three runs in round 83) | up to about 80 s (round 72, not re-measured) |
| `npm run test:media` | the real-ffmpeg suite, 365 cases (352 run, 13 platform-skipped) | about 10 minutes (607 s in round 84, with documentation edits beside it; 702 s in round 83, with only documentation edits running beside it; 680 s in round 82, run beside short unit runs; 610 s in round 81; 602 s before; the whole file on the distro's 6.1.1 measured 550 s in round 77: 272 passed and the same 7 pins written for the bundled binary failed, as in round 75; rounds 78-79 ran their touched blocks or the whole file there with the same 7 pins) | 9 to 10 minutes (round 72, not re-measured) |
| `npm run test:e2e:build` | the build (about 7 s), then the Playwright suite, 415 tests, one worker | about 29 minutes (1731 s of Playwright; the round-80 landings' loaded runs took 27 to 38 minutes, round 82's, with 14 more cases, 36.6, round 83's, with 5 more, 36.3, and round 84's, with 23 more, 38.4, 36.7 and 36.8 over three full runs) | not separately measured |

Update this table when a round re-measures it, and nowhere else.

---

## Layer 1: vitest unit tests (`src/**/*.test.ts`)

**Run with:** `npm test` (or `npm run test:watch` for an interactive
re-run loop).

**Environment.** node, no DOM. Configured by `vitest.config.ts`.

**What it covers.**

- Every pure helper in `src/shared/` (path safety, filename templating,
  highlight scoring, caption parsing, validators, custom-preset
  parsing, project validation, chat-log parsing, window sizing,
  moodboard JSON parsing, search-result validation).
- The store-backed CRUD modules in `src/main/` — audio presets, video
  custom-export presets, moodboard collections, autosave write/read.
  These import `electron` so each test file mocks
  `app.getPath('userData')` to a per-test `mkdtempSync` and runs the
  real file IO against a tempdir.
- The ffmpeg/whisper cancel-helpers and accumulator caps. Long-running
  ffmpeg processes are not actually spawned in unit tests — instead we
  cover the cancel-when-empty path, the regex parsers (`parseEbur128`,
  `parseSrt`), the filter-string builders (`buildForceStyle`), and the
  pure path/duration helpers.
- IPC validator surfaces. `settingsKnownKeys.test.ts` and
  `searchValidate.test.ts` both lock the rejection classes (unknown
  key, hostile string, oversized payload) so a future refactor that
  loosens the gate breaks the build.
- **Structural checks over the renderer source** (round 23). No DOM
  means a mounted component can't be rendered here — but the questions
  the round-22 sweep found unanswered are answerable statically, and
  four tests in `tests/unit/` now answer them: `interactiveNesting`
  parses every `.tsx` with the TypeScript TSX parser and fails on a
  control nested inside another; `tutorialTargets` resolves every
  tutorial step's selector against the components its route can render;
  `hotkeyTable` requires each HotkeyOverlay row to be a real binding
  found in that route's tree or a listed mouse hint; `interactionWiring`
  pins that each control the sweep found orphaned is actually mounted.
  `routeSources.ts` (a helper, not a spec) does the import-graph walk
  they share. Round 52 added two more in the same style: `tutorialCopy`
  (every control a tutorial step names in 'single quotes' is a real label in
  the studio it is shown in, none of the words that were once wrong or were
  jargon comes back, a step is two short sentences with no number of its own)
  and `truthInCopy` (the six promises of T-85 — screened thumbnails, a
  reframe that follows action, a one-stop OBS replacement, a watermark on
  every export, an absolute "runs locally", "full app state" — stay out of
  the source and out of the guides). Two rules for this style: it cannot see conditional
  rendering, so a green run means "reachable", not "on screen"; and it
  reads source text, so **always run it against the broken state first**
  — `tutorialTargets` initially passed with both missing attributes
  deleted, because the tutorial definition files contain the selector
  strings and are reachable from every studio.

**Count.** 4870 tests across 179 files (round 84 (T-135) added five files - `src/renderer/src/lib/runStore.test.ts` (7: the run slot's claim, patch, end and its subscribers), `src/renderer/src/modules/video-studio/store/exportQueue.test.ts` (7: the batch's rows, the single-flight claim, a failure, a cancel, the file taken from the batch's own results), `src/renderer/src/modules/audio-studio/state/audioExport.test.ts` (8), `src/main/ipc/audioExtractSingleFlight.test.ts` (9: a second extraction is refused naming the one that runs, the slot comes back on every ending) and `src/shared/chatPeaks.test.ts` (10: the merge of adjacent buckets, the window, the cap) - and grew `interactionWiring.test.ts` from 172 to 191 (the T-135 block: the pins for items 13, 6, 5, 8 and 2, one per panel that holds its run in a store, the Export, audio export, Clip Kit, Captions-progress and extraction pins, and the derived results), `videoStore.test.ts` from 122 to 134 (`previewUrl` and the `derived` block), `failurePathLanguage.test.ts` from 36 to 45 (the board and preset writes), `projectValidation.test.ts` from 169 to 176 (the unknown preset id is dropped), `ProjectIO.test.ts` from 110 to 115, `audio.test.ts` from 43 to 48, `chain.test.ts` from 60 to 65 (`cutsLeaveNothing` over the unfloored length), `captions.test.ts` from 78 to 81, `mediaFormats.test.ts` from 35 to 37, `referencesStore.test.ts` from 22 to 24 (the store names the newest request's query), `exportProgress.test.ts` from 6 to 7, and the two per-file scans `copyConventions.test.ts` (134 to 138) and `noRawHex.test.ts` (114 to 118), which gain a row per new source file; round 83 (T-134) added no file and grew `interactionWiring.test.ts` from 168 to 172 (the T-134 block: the Restore that navigates only a person still on Home, the per-button busy flags, the marker keys on the press only, the preset name's cap and cut; the older T-57, T-119 and T-133 (7b) pins follow the renamed flags and the guarded keys), `referencesStore.test.ts` from 18 to 22 (the T-133 (8) drop-test flipped into the newest-query tests: a corrected query is asked, a late answer is never drawn in either order, a stale failure leaves no error), and `docClaims.test.ts` from 59 to 64 (the no-picture claim corrected, the scan that lists the callers of `wroteNoPicture`, and the scan that reads the native-dialog inventory against the renderer); round 82 (T-133) added two files - `src/main/sidecars/burnInNoPicture.test.ts` (11: the real `runBurnIn` over a fake ffmpeg that exits 0 having written an audio-only mp4 or a stub, the shifted SRT and the file go with the refusal, the empty-output line found past the kept 16 KB tail, a whole-video burn, a one-frame clip, a count split across chunks, a stream that never reported one, a real failure keeps its own words) and `src/renderer/src/lib/liveTake.test.ts` (5: nothing live, declined, accepted, unregistered, a stale unregister) - and grew `interactionWiring.test.ts` from 158 to 168 (the disabled-button scan with its discrimination block, the held-key and Space wiring, the live-take wiring and the table of `navigate()` calls, the Clean audio second question), `repeatPress.test.ts` from 8 to 15 (`createHeldKeyGuard`), `referencesStore.test.ts` from 15 to 18 (one search at a time), `AudioStudio.test.ts` from 33 to 38 (`confirmReplaceAfterWait`), `noPicture.test.ts` from 22 to 24 (the astral-name cut, a good thumbnail stamped in the past, a file already at the path is refused, the burn-in sentence), `partialOutput.test.ts` from 7 to 9 (`wroteOutput` without a clock), `HotkeyOverlay.test.ts` from 28 to 29, `AppToaster.test.tsx` from 2 to 3, `audio.test.ts` from 42 to 43 and `docClaims.test.ts` by 3 (the `reportFailure` signature in STYLE_GUIDE read off the real one, USER_GUIDE's waveform timing, the "every runner" claim); round 81 (T-132) added one file - `src/main/ffmpeg/noPicture.test.ts` (22: `PictureFrames` reads the progress block's frame count by whole lines and says nothing about a stream that never reported one; `wroteNoPicture` is either fact; the refusals are finished sentences of at most 240 characters; and the real `runExportJob`, `runReframe` and `extractFrame` over a fake ffmpeg that exits 0 having written a stub, an audio-only mp4, a legitimate one-frame clip, a report that ends inside the number, no file, an empty file, and an old file at the path) - and grew `audioStore.test.ts` from 15 to 21 (`waveformArrived`: arrives, already drawn, refused, closed, replaced, not held), `ProjectIO.test.ts` from 98 to 110 (`currentRoute`; `audioSettled` over the real stores and the real `applyProject`, including a refusal that landed before anyone asked), `Tutorial.test.ts` from 71 to 75 (a repeat is held), `concat.test.ts` from 28 to 32 and `concatRunner.test.ts` from 24 to 27 (the compilation refusals name the clip), `presets.test.ts` from 47 to 50 (`customPresetStartFor`), `audio.test.ts` from 38 to 42 (`peaksMaxMagnitude`, the playback sentence), `interactionWiring.test.ts` from 150 to 158, `docClaims.test.ts` from 52 to 56 (the 2-hour limit read in README, PRODUCT_GUIDE and USER_GUIDE), `persistSetting.test.ts` from 6 to 7 and `reportFailure.test.ts` from 2 to 3 (the fixed toast id); `presetTablesInSync.test.ts` and `failurePathLanguage.test.ts` gained assertions; the Layer 5 file grew by 10 cases (the item-4 block, 9; the join's "Impossible to open" line, 1); the E2E count is 366 + 7 = 373 (seven new cases: Clean audio during a live take and while elsewhere, the Captions row's geometry, a partial clear, the tour's held Enter, an asymmetric waveform, and Play while the waveform is drawn; five existing cases gained assertions); round 79 (T-131) added two files - `src/renderer/src/lib/claimFirst.test.ts` (6: the flag is raised before anything awaits, a second call is dropped, the claim is given back on success, on a throw and on a canceled dialog, and a refused call does not lower the first one's claim) and `src/renderer/src/lib/repeatPress.test.ts` (8: `isRepeatPress`, and `isSwallowedRepeat`, the pure core of `swallowRepeatClicks`: a repeat inside the 500 ms after a dialog closes is dropped, one after the window and a first click never are) - and grew `networkAllowlist.test.ts` from 32 cases to 42 (the guard asked the other way round: `open` / `eval` / `Function` by their last segment unless the file binds the head, `x['name']`, a constructor used as a value, `createElement(dynamic)` / `setAttribute(dynamic)`, any `scheme://` literal that is not local, a closed list of file types under `src/`, the package names pinned), `interactionWiring.test.ts` from 136 to 147 (a scan that finds every renderer call of a bridge function that opens a native chooser and holds the set to a decided table, with a discrimination block; the wiring pins of items 3-9 and 13-17), `tutorialCopy.test.ts` from 148 to 157 (every tour ends by naming the `?` key), `cancelSentinel.test.ts` from 192 to 199 (the picture-in-picture probe and the re-attach's mux pass are held to the cancel latch), `muxCodec.test.ts` from 30 to 35, `concatRunner.test.ts` from 13 to 15, `videoStore.test.ts` from 116 to 121, `releaseWorkflowShape.test.ts` from 15 to 19 (Inter's license ships), `copyConventions.test.ts` from 130 to 132 (the letter x between numbers) and `noRawHex.test.ts` from 110 to 112 (it reads the two new files); the Layer 5 file grew by 20 cases (the two compilation and re-attach blocks, T-131 (1) and (2); 332 on the landed tree), and the Playwright suite by 20 tests (366 on the landed tree; `tests/e2e/chooser.ts` is the shared slow-chooser stand-in, not a spec); round 79 (T-130) added two files - `src/shared/compileFps.test.ts` (7: the rate a compilation is written at is the source's up to 60, 59.94 stays 59.94, a rate that is not a number pulls nothing down, none at all is 30) and `src/main/ffmpeg/frame.test.ts` (7: a thumbnail of a cropped clip is one `-vf crop` in even pixels of the probed size, clamped inside the frame, and a clip without a crop runs the command it always did, with no probe) - and grew `videoCropPayload.test.ts` (+12: `video:extractFrame` refuses an unusable crop before the runner), `concatRunner.test.ts` (+9: `-r` and the fps stage are the one derived value on every segment), `presetTablesInSync.test.ts` (+7: YouTube 1080p60 on both sides of the bridge, the kit still five), `watermark.test.ts` (+6: the margins and which shapes are vertical), `filters.test.ts` (+5: all four corners, vertical and landscape), `cancelSentinel.test.ts` (+4: a cancel before the thumbnail's probe), `concat.test.ts` (+4) and `presets.test.ts` (+4: the new row); the E2E count is 346, two new cases (a 60 fps recording's Compile card and file, and YouTube 1080p60 beside YouTube with the kit still five) and the Clip Kit Short case extended to its three thumbnails; test:media is 312 cases, 299 run | 13 skipped (sixteen new across four blocks: the rate eight, the thumbnail five, the margins two, and the preset loop's sixth row). The round's runs shared the box with another worker's Playwright suite (load average about 12), so the durations in the table at the top were not re-measured. Round 78 added six files - `src/renderer/src/lib/persistSetting.test.ts` (6: a refused settings write never rejects, says one sentence, and the caller carries on), `src/main/transcripts.test.ts` (10, over real folders: a burn-in's temp copy and sub-folders are not counted, a link is never followed, a remove that refuses is counted and the rest go), `src/main/ipc/captionsTranscripts.test.ts` (3: the real handlers over a real userData, an argument aimed at another folder is ignored), `src/main/ipc/recordingQuit.test.ts` (5: over the real convert module and latch, a quit mid-convert is released only after the half-written mp4 is gone and the raw take is kept, a Discard removes both, an open Save dialog is not a run), `src/main/ffmpeg/convertQuit.test.ts` (7: the import transcode is a run, a failed one removes its partial, a cancel for another owner leaves it running) and `src/main/ipc/videoCustomPresetIds.test.ts` (13: `video:deleteCustomPreset` refuses a bad id before the store is asked) - and grew `pathSafety.test.ts` (+8: one nanoid alphabet in `src`), `extract.test.ts` (+4: the extraction is a run), `captions.test.ts` (+4: `clearedTranscriptsMessage`), `failurePathLanguage.test.ts` (+3: a settings write is never a bare promise), `a11ySweep.test.ts` (+2: rule 6, every cut name carries a `title`), `interactionWiring.test.ts` (+2: Inter as woff2 alone, and the transcript clear's ref pin joined an existing one), `recordingStream.test.ts` (+1: the quit sweep leaves a closed, mid-finalize session's take) and `videoStore.test.ts` (+1: `setSrtPathFor(…, null)`), and the per-file scans grew by two; round 78 (T-128) added six files - `src/renderer/src/lib/persistSetting.test.ts` (6: a refused settings write never rejects, says one sentence, and the caller carries on), `src/main/transcripts.test.ts` (10, over real folders: a burn-in's temp copy and sub-folders are not counted, a link is never followed, a remove that refuses is counted and the rest go), `src/main/ipc/captionsTranscripts.test.ts` (3: the real handlers over a real userData, an argument aimed at another folder is ignored), `src/main/ipc/recordingQuit.test.ts` (5: over the real convert module and latch, a quit mid-convert is released only after the half-written mp4 is gone and the raw take is kept, a Discard removes both, an open Save dialog is not a run), `src/main/ffmpeg/convertQuit.test.ts` (7: the import transcode is a run, a failed one removes its partial, a cancel for another owner leaves it running) and `src/main/ipc/videoCustomPresetIds.test.ts` (13: `video:deleteCustomPreset` refuses a bad id before the store is asked) - and grew `pathSafety.test.ts` (+8: one nanoid alphabet in `src`), `extract.test.ts` (+4: the extraction is a run), `captions.test.ts` (+4: `clearedTranscriptsMessage`), `failurePathLanguage.test.ts` (+3: a settings write is never a bare promise), `a11ySweep.test.ts` (+2: rule 6, every cut name carries a `title`), `interactionWiring.test.ts` (+2: Inter as woff2 alone, and the transcript clear's ref pin joined an existing one), `recordingStream.test.ts` (+1: the quit sweep leaves a closed, mid-finalize session's take) and `videoStore.test.ts` (+1: `setSrtPathFor(…, null)`), and the per-file scans grew by two; round 78 (T-129) added one file - `src/main/audio/peaks.test.ts` (16: the fold of a stream of samples into bounded highest/lowest pairs, a sample cut across two chunks, the last-bucket clamp, the command line, the job's progress, its failure sentence, the per-job Cancel and a Cancel during the probe, the quit sweep, the latch run held until the child closes) - and grew `audioStore.test.ts` (+7: the file opens first, `drawing` carries main's percent, `waveform` its answer, an unreadable file or an answer that is not a waveform is refused and let go, Close and a second file stop the job and its late answer draws nothing), `docClaims.test.ts` (+1) and `interactionWiring.test.ts` (+1: the peaks wiring, the progress line, Close's Cancel, the quit sweep), and shrank `audio.test.ts` (-4: the ceiling's sentences go; `isWaveformPeaks`, `WAVEFORM_READ_FAILED` and `PLAYBACK_ERROR_MESSAGE` come) and `audioExtractCeiling.test.ts` (-10: the length gate and the scratch-WAV backstop go, the same files now extracted), with one `ProjectIO.test.ts` pin flipped (a sound file over two hours opens); the E2E count is 344: round 78 (T-128)'s eight new cases (a long board name, a long source-tile title, Welcome with a settings write main refuses, Export with the same refusal, Clear saved transcripts, and the window's X in the middle of a recording's MP4 convert, an import transcode and an extraction) and round 78 (T-129)'s two (Close and a quit while a long file is drawn), with six flipped or rewritten in place (the long file, the long video, Clean audio on a long video, the ADPCM file the player cannot play, the file main cannot read, the audio-only mkv); test:media is 296 cases, 285 run | 11 skipped (T-128: two new in the quit block; T-129: four new in the peaks block, two flipped in place). The two rounds' trees were gated separately and re-gated as one at the round-80 landing; the durations in the table at the top are that landing's own runs. Round 77 added no file and grew `networkAllowlist.test.ts` from 19 cases to 32 (the scan's last gaps: constructors through a global, `getBuiltinModule(` and `createRequire(`, `export ... from`, a location chain, an IPv6 literal, `image-set(`, `createElement`, `devDependencies`, every module the set names, a guard that no `.js` file hides under `src/`), `cancelLatch.test.ts` (8: `drainRuns`, and a scan that every runner ends its run after its work), `reattachCollision.test.ts` (2: a quit mid-re-attach is released only after the scratch WAV is gone), `concatRunner.test.ts` (1: `-shortest`), `audioExtractCeiling.test.ts` (5) and `audio.test.ts` (2) (`NoUsableDurationError`), `textOverlay.test.ts` (5: `overlayTimePair`), `tutorialCopy.test.ts` (3), `designTokensInSync.test.ts` (3: the placeholder rule) and `interactionWiring.test.ts` (the net-silence calls, the `before-quit` wait, the Modal scrim, the three save handlers, the titles); round 76 added four files - `src/main/ffmpeg/folderVerdict.test.ts` (8: one stat per path in flight, a 1 s deadline, `unknown` is not "not a folder"), `src/main/ipc/settingsFolderDeadline.test.ts` (5: the real `settings:get` over a hung stat), `src/main/ffmpeg/highlightsArgv.test.ts` (4: both loudness scans take `EBUR128_SCAN_FILTER`, no `peak=true`) and `src/renderer/src/modules/audio-studio/state/audioStore.test.ts` (8: `fromVideo` follows the streams, the extension only when the probe could not say) - and grew `networkAllowlist.test.ts` from 12 cases to 19, `interactionWiring.test.ts` (the seven more `singleFlight` handlers, Export's chooser, the readout audit, the refusal row), `designTokensInSync.test.ts` (`::selection`), `clockTime.test.ts` (`formatTimer`), `textOverlay.test.ts`, `units.test.ts` (`readoutText`), `saveCard.test.ts` (`micLostLine`), `audioExtractCeiling.test.ts`, `muxCodec.test.ts` (`-tag:v hvc1`), `filters.test.ts` / `concat.test.ts` / `reframe.test.ts` (`fps=N` after the retime); round 75 added five files - `src/main/ffmpeg/concatRunner.test.ts` (5: a compilation segment is Matroska with PCM sound, the join copies the picture and encodes the sound once to AAC at 192 kbps, the list file, the fades, and a folder that cannot be made refuses before one segment is encoded), `src/main/audio/exportProgress.test.ts` (6: the progress is over the length that is kept), `src/main/ipc/settingsFolders.test.ts` (17: `settings:get` answers a folder key only for a folder that exists now, for each of the three), `src/renderer/src/hooks/useVideoOutputDir.test.ts` (14: the four panels' folder is one store) and `src/shared/clockTime.test.ts` (10: `formatClock` and `parseClock`) - and grew `videoReframePayload.test.ts` (+17: the whole recipe at the boundary), `audioExtractCeiling.test.ts` (+11: a probe that failed is not a probe that said no; an AIFF or a WMA is not a video), `ProjectIO.test.ts` (+13: `extractedFrom`, `replacedSince`), `interactionWiring.test.ts` (+13: the round's wiring pins), `videoCropPayload.test.ts` (+7), `outputPath.test.ts` (+6: `ensureOutputDir`, `outputFolderRefusal`), `reframe.test.ts` in `src/main/ffmpeg/` (+9: the strip through `buildVideoFilter`) and in `src/shared/` (+4: the readout over the crop), `gradeMatrix.test.ts` (+5), `chain.test.ts` (+5: the strengths in order, the 4096 stage), `tutorialCopy.test.ts` (+4: the Clip Kit step), `videoPickOutputDir.test.ts` (+3), `textOverlay.test.ts` (+3: the window of no length, the time refusal), `designTokensInSync.test.ts` (+3: the native-controls rule and the toast marks), `audio.test.ts` (+2), `extract.test.ts` (+1) and `tutorialTargets.test.ts` (+1), and `networkAllowlist.test.ts` went from 6 cases to 12 by vitest's count (the T-124 entry first said 23, a transposed figure; the guard now also sees `useImage(`, a dynamic `import()`, the updater and crash SDKs, a fetching `spawn` and the media elements, holds the CSP to every directive with one named exception, and asserts the package and the builder config; each new shape is proven to red); the E2E count is 314, seventeen new cases (a header-less WebM, a WMA, the 9:16 file's look and header, three for the output folders, the long-name layout, a video over an hour, a double-clicked Export, Clean audio over a changed Audio Studio, the Source time boxes and names, the arrow's row, the Clip Kit tour step, two for the dropped microphone, and the crash screen's promise), and many extended (the cases that pressed Choose folder... in each panel in turn, every file-name expectation, the overlay locators, the position and rotation boxes, the toast marks and the native-control properties); test:media is 271 cases, 260 run | 11 skipped (twenty-two new across six blocks: the join, the extraction clock, the strengths, the 4096 stage, the 9:16 file and the output folder). Round 74 added five files - `src/main/windowBounds.test.ts` (5: the window-geometry write never throws: a refused write, a window that dies between the check and the question, nothing latched), `src/main/ffmpeg/reframe.test.ts` (17: the 9:16 graph is `setpts`, the crop stage on the cropped frame, the strip, `setsar=1`, and the sound at the clip's speed), `src/main/ipc/audioExtractCeiling.test.ts` (5: the handler probes first and never reaches the extractor for a video over 2 hours), `src/main/ipc/videoReframePayload.test.ts` (23: the reframe and GIF payloads are checked at the boundary, crop before speed, the name from the opened video) and `tests/unit/networkAllowlist.test.ts` (6: an AST scan of `src/` for every way the app reaches the network, held to an exact per-file list and the page's CSP, with the scan's own discrimination cases) - and grew `docClaims.test.ts` (+15: the `%TEMP%` disclosure, the Levels ceiling sentence, the layout guide, the re-pointed cites), `interactionWiring.test.ts` (+8: the round's wiring pins), `audio.test.ts` (+5: the ceiling's two sentences), `keyOwnership.test.ts` (+5: `hasChordModifier`), `textOverlay.test.ts` (+5: a window that misses the clip), `ProjectIO.test.ts` (+4: `sessionHoldsWork`), `recordingStream.test.ts` (+4: `abandonOpenRecordingSessions`), `canvas.test.ts` (+4: `layerOffsetRange`, `LAYER_ROTATION_RANGE`), `projectValidation.test.ts` (+3: `hasStudioState`), `chain.test.ts` (+1: the cut stage is re-chunked to 256 samples first), `settingsClear.test.ts` (+1) and, by the per-file scans, `copyConventions.test.ts` (+1) and `noRawHex.test.ts` (+1). Round 73 (3976 tests in 146 files) added eight files - `src/main/sendIfAlive.test.ts` (6: the one way main reports to a window drops a send for a destroyed WebContents, never asks one to send, swallows a window that dies between the check and the send), `src/main/ipc/closeMidJob.test.ts` (18: each real progress handler, a dead sender in two shapes), `tests/unit/progressSendsGuarded.test.ts` (5: no bare `.send(` under `src/main`, with a finder that discriminates), `src/main/rendererRecovery.test.ts` (11: reload once, never inside the cooldown, never when quitting), `src/main/audio/singleTrackTail.test.ts` (15: the single-track `-af` ends in the mix bus's limiter, a bare chain does not, Even volume does not, `dual_mono` on both passes for a mono source and not for 2 or 6 channels or the mix path), `src/renderer/src/lib/keyOwnership.test.ts` (35: every tag and input type through the three questions), `src/shared/draftNumber.test.ts` (14) and `tests/unit/docClaims.test.ts` (36: the claims the twelfth pass found false, held against the code they describe, the cites in `image.spec.ts` with an anchor each) - and grew `useUndoRedoHotkeys.test.ts` (+15) and `HotkeyOverlay.test.ts` (+11) (a checkbox, a range, a radio, a colour well, a file field and a button no longer own Ctrl+Z or `?`), `chain.test.ts` (+6: `settb=AVTB` between `select` and `setpts`, `dual_mono` on both passes), `filters.test.ts` (+8: a crop the validator accepts is inside the frame, at the measured ratio and the ceiling), `audio.test.ts` (+7: the 2 hour ceiling and its sentence), `recordingStream.test.ts` (+4: the cap under twelve concurrent begins), `emojiGuard.test.ts` (+3: `.html` and `.css`, and a file type the script does not read), and, by the per-file scans, `copyConventions.test.ts` (+3), `noRawHex.test.ts` (+3), `interactiveNesting.test.ts` (+1) and `failurePathLanguage.test.ts` (+1) for the three new renderer files, with `a11ySweep.test.ts` (+1: the shared `DraftField` and the Color box are two facts) and `interactionWiring.test.ts` (the Timeline's key guard, the saved-toast shape and the Edit in Video Studio bridge re-pointed to where they now live); the E2E count is 267, eighteen new cases (the focus-keeps-its-keys case in Audio, Stream Graphics and the Player, the Time boxes, the number boxes in Stream Graphics (one) and Video Studio (three), the self-ended take, the scrim drag, the five output-folder names, the renderer crash, three layout cases, and three waveform cases) and five extended (Reframe's toast action, Save .srt's scope sentence, the Posting log's Facebook chip, the Levels case's ceiling sentence, the thumbnail cache tooltip); test:media is 238 cases, 227 run | 11 skipped (thirteen new: the crop block (five), the single-track peaks and loudness block (seven), and the AVI seam case; two existing loudnorm cases re-pointed to the dual-mono meter); round 72 added one file, `tests/unit/emojiGuard.test.ts` (6: every directory of `src/` is a root of the emoji guard and every root exists, the script itself run from a scratch tree on one emoji under each of the four roots and naming the file, a clean control, a test file that may carry one) and grew `filename.test.ts` (+8: the `{handle}` token in any script, with an emoji's variation selector, the separators and no handle, and the mark that rides on `_` and `-`), `muxCodec.test.ts` (+5: `-enc_time_base:v filter` beside `-fps_mode passthrough` on a cut and on every re-encode, absent from a copy), `devices.test.ts` (+1: the empty-device hint names the third recovery) and `interactionWiring.test.ts` (+2: the kit's folder asked for with the sanitized name, the Second-track footer behind Duck); the E2E count is 249, one new case (a Clip Kit on a clip whose name was cleared) and two extended or re-pinned (the second-track case, and the six Record cases that read the hints); test:media is 225 cases, 214 run | 11 skipped (three new: the cut re-attach's timestamps on the 24 fps ramp and on a 30 fps source, and the check's own discrimination); round 71 added no file and grew `releaseWorkflowShape.test.ts` (+9: the packaged tree carries one ffprobe and none of the four unused dependencies, with a discrimination case), `AudioStudio.test.ts` (+11: a chain that lacks keys is not a chain with edits), `chain.test.ts` (+8: the picture cut closes each gap by the time it took, never by a frame rate, with the overlap, touching, nested, out-of-order and before-the-file shapes), `filename.test.ts` (+7) and `chatLog.test.ts` (+3) (letters and numbers of any script survive, a mark stays on its letter, an emoji's variation selector does not), `projectValidation.test.ts` (+4: QA's clip with no `textOverlays` and the rows around it), `clipKit.test.ts` (+6: non-ASCII clip names through the real queue builders) and `interactionWiring.test.ts` (+3: the camera fallback's catch and thumbnail, the Timeline's four relative keys, the name `mark`); the E2E count is 248, three new cases (a camera that opens and a compositor that cannot start, leaving Record while the camera is opening, the Timeline's arrows and `,` / `.` during playback) and the zero-camera case extended; test:media is 222 cases, 211 run | 11 skipped (seven new: the burn-in, the PiP and the cut re-attach on the MediaRecorder fixture, per codec, and the overlapping cuts); round 70 added two files - `src/main/ffmpeg/probe.test.ts` (`probedFps`: a container's clock is not a frame rate - the average rate first, the real rate when there is no average, a `1000/1` millisecond clock reads as unknown, the 240 ceiling is inclusive, no rate is 0) and `src/main/ipc/videoPickOutputDir.test.ts` (the real `video:pickOutputDir` handler: a usable absolute path becomes the chooser's `defaultPath`, anything else is ignored and nothing is refused, the answer still comes back) - and grew `audioChainValidation.test.ts` (+37: a cut's and the custom noise reduction's numbers through both handlers and the preset), `settingsClear.test.ts` (+19: the dotted keys the nested schema judges, through the real store), `interactionWiring.test.ts` (+8: the round-70 wiring pins and their discrimination blocks), `videoStore.test.ts` (+6: the Player transport, `playheadNow`, the pronoun), `convertCancel.test.ts` (+5: `-fps_mode vfr` in the convert's argv and `remuxWebm`), `cancelSentinel.test.ts` (+5), `recordingCancel.test.ts` (+4: the WebM branch's remux), `settingsKnownKeys.test.ts` (+2: the schema flattened and compared to the allowlist, no dotted property name) and `releaseWorkflowShape.test.ts` (+2: `electron-builder.yml` pins no Electron version); the E2E count is 245, seven new cases (a held Enter in the Fix wizard, Space on the timeline, I during playback, the Clip Kit chooser's folder, the recording view's preview and thumbnail, leaving Record while the capture opens, and the window's background-throttling option) and the WebM save, the Output hint and the Variants case extended; test:media is 215 cases, 204 run | 11 skipped (ten new: the MediaRecorder block, eight cases, and the Auto Zoom pair); round 69 added two files - `src/main/ipc/captionsOpenFolder.test.ts` (the real `captions:openModelsFolder` handler on a real tree: the folder exists at the instant the shell is asked, parents too, an existing folder is left alone, a non-empty answer is logged, a folder that cannot be made does not throw) and `src/main/ipc/settingsClear.test.ts` (the real `settings:set` / `settings:get` over the real electron-store against a file in a temp folder: `undefined` clears a key from memory and from the file, anything else is stored and judged as before) - and grew `projectValidation.test.ts` (+38: a clip, a chain and a canvas document that are structurally empty are refused, named by field, and whole ones with and without every optional field are accepted), `filters.test.ts` (+9: the matrix stage per tag, the two bt601 tags get the tag alone), `gradeMatrix.test.ts` (+1: each real runner's `-vf` for each tag), `interactionWiring.test.ts` (+6: the single-flight finder with its discrimination block, the timeline's keys, the `videoDiscardMessage` wiring, the blank watermark's clears), `recordingStream.test.ts` (+3: abandon after a write error, through the real handler), `videoStore.test.ts` (+3: `videoDiscardMessage`), `a11ySweep.test.ts` (+2: rule 5 and its discrimination), `Tutorial.test.ts` (+1) and `truthInCopy.test.ts` (+1: the README and the release body); the E2E count is 238, eight new cases (Start's "Starting…", Edit in Video Studio's question, the audio importer's second file, the Fix wizard's focus, the timeline's keys, a focused select, the coachmark under Reduce motion, and a blank watermark with the kit after it) and five re-pinned or extended (the mic-refusal case presses Start twice, the clip-list case reads the rename field's ring, the Variants case asserts focus, the trim-handle drags find the handles by place, and the Fix wizard's modal-contract case in `home-chrome.spec.ts` expects the question to open on its first answer, where it used to open on Close); test:media is 205 cases, 194 run | 11 skipped (seven new: the bt601 cases in the T-118 block); round 68 added one file, `src/main/ffmpeg/gradeMatrix.test.ts` - the real `runExportJob` and `runConcat` against a fake child and a fake probe: a bt709 source's color space reaches the temperature stage from each, and untagged and bt601 sources get nothing - and grew `autosave.test.ts` (+6: the real `clearAutosave` with an `unlink` stand-in, the first failed unlink's errno in the message, a vanished file's code left out, each shape through `userFacingError`), `userFacingError.test.ts` (+7: the Autosave Clear shapes), `filters.test.ts` (+11: the matrix stage for bt709 and none otherwise) and `captions.test.ts` (+1: the equals sign in a path); the E2E count is 230, unchanged (`home-chrome.spec.ts`'s Clear-failure case re-pinned: its two stubs are main's real shapes, and the first now asserts no cause is guessed); test:media is 198 cases, 187 run | 11 skipped (the `a=b.srt` burn-in case and the five-case bt709 block); round 67 added three files - `src/main/ipc/audioPresetIds.test.ts` (the real `audio:deletePreset` handler with the store wrapped in a spy: a traversal, a slash, a backslash, a space, an extension, `..` and a trailing newline are refused before the store is asked, and a minted id still deletes), `src/main/pathConfine.test.ts` (`isOutsideFolder` under posix and win32, and a scan that fails on a hand-rolled `startsWith('..')` anywhere in `src/main`) and `src/renderer/src/lib/reportFailure.test.ts` (a failure is a red toast for `ERROR_TOAST_MS`, a cancel is a neutral one) - and grew `presets.test.ts` (+23: a traversal id aimed at a real file leaves it standing and is refused, the parser and the list refuse an id that is a path), `pathSafety.test.ts` (+21: `isSafeId` / `assertSafeId`), `captionsSaveSrt.test.ts` (+11) and `captionsWriteKitSrt.test.ts` (+10) (a transcript whose name starts with two dots is in the folder; five real traversals still refuse), `filename.test.ts` (+10: the local stamps in three zones, a Date whose local and UTC fields differ, and a scan for `toISOString()`), `outputPath.test.ts` (+3: the kit folder's day under `America/Los_Angeles` and `Pacific/Auckland`), `userFacingError.test.ts` (+5: Record's save failure shapes), `recordingStream.test.ts` (+1: the empty-take sentence), `moodboard.test.ts` (+1: a dot-named thumbnail), and moved assertions inside `failurePathLanguage.test.ts` (+2: no renderer source calls `ipcErrorMessage`, with a finder that discriminates) and `interactionWiring.test.ts` (-1: the `MUST_LAST` row for the Save-failure and Autosave-Clear toasts moved to `reportFailure.test.ts`; Record's save, its source list and the Autosave Clear are `reportFailure` now); the E2E count is 230, three new cases in `record.spec.ts` (and the source-list refusal and the autosave Clear failure re-pinned to their sentences, each with a second, known-cause refusal) (the suggested name on a clock whose day is not UTC's; a save that fails with EPERM, then ENOSPC; an empty take through the real IPC), the kit case re-run on that skewed clock, and the `kitStamp()` helper reading the local day; test:media is unchanged at 181 passed | 11 skipped (comments only); round 66 added one file, `src/main/ipc/captionsSaveSrt.test.ts` (the real `captions:saveSrt` handler on real files: a transcript that is gone, or outside the captions folder, is refused in a finished sentence before the Save dialog opens, the folder gate answering first; each sentence passes `userFacingError` unchanged; the copy and the canceled dialog still work), and grew `copyConventions.test.ts` (the tick rule reads the un- prefix; the two word rules also read every string in main, shared and preload, with a discrimination block and a guard against an empty scan) and `recordingCancel.test.ts` (the convert-failure sentence says "uncheck" and quotes the label exactly), plus more assertions inside `a11ySweep.test.ts` (rule 4 accepts `has-[:focus-visible]:opacity-100` and no longer accepts `focus-within`; no new test); the E2E count is 227, one new case (Save .srt on a transcript that is gone) and four re-pinned (Save .srt outside the captions folder reads main's sentence; the two References overlays tab in with the keyboard and add the mouse-click-away assertion; the Record convert-failure case reads "uncheck"); test:media is unchanged at 181 passed | 11 skipped (one comment); round 65 added no file and grew `convertCancel.test.ts` (the convert's progress is ffmpeg's position over the take's length, 0-99, and carries no percent without one: eleven cases over ffmpeg's real `-progress` text), `recordingCancel.test.ts` (the length `promoteTempWebm` hands the convert, progress forwarded as it came), `filters.test.ts` (`EVEN_PICTURE` is a crop, never a scale), `projectValidation.test.ts` / `autosave.test.ts` (a verbatim legacy JSON with `"sizePx": 800` restores at 512, the injection pins stand, the gate stays strict), `highlights.test.ts` (`hookAsk` and `HOOK_DEBOUNCE_MS` replace `hookWindowKey`), `a11ySweep.test.ts` (rule 4: a hover-only container shows on focus, with a discrimination block; two more named elements) and `interactionWiring.test.ts` (the three failure toasts that must last, with a finder that discriminates; the convert bar's null branch; the hook badge's debounce, its first ask, its cleanup) and `failurePathLanguage.test.ts` (Save .srt awaits its call inside a `try` whose `catch` is `reportFailure`, with a finder that discriminates; its header now says it reads only `catch` clauses and not a missing one); the E2E count is 226, two new cases (the convert bar draws what main reports; Save .srt on a transcript outside the captions folder says it could not) and eleven extended or re-pinned (the two hook cases, the two References overlays, the Export format name, the overlay x/y names, and the three spawn-order or title cases that had assumed the hook badge was already done); test:media is 181 passed | 11 skipped — 7 new cases (the convert's progress ×4 against the real binary, and the 1-pixel checkerboard ×3); round 64 added three files — `src/shared/overlayColors.test.ts` (the 148-name table and its resolver, moved from `textOverlay.test.ts`, and `#rgb`), `src/main/audio/reattachCollision.test.ts` (the real `runAudioReattach` on real files with `NODE_ENV=production` forced: a source or a video sitting where the scratch WAV goes is refused and left intact, nothing spawned) and `src/main/audio/silentLoudnorm.test.ts` (the real `runAudioExport` against a fake child that prints a silent pass 1: pass 2 is the single-pass loudnorm) — and grew `projectValidation.test.ts` / `autosave.test.ts` (a verbatim pre-T-113 schema-5 JSON with the overlay color NAME `white` restores, and the injection strings still refuse), `validators.test.ts` (the source scan now reads every non-test file under `src/main` through the syntax tree, with `AUDITED_PURE_INVARIANTS`), `captionsBurnIn.test.ts` / `captionsProgress.test.ts` (the gate's caption colors; the runner's own check under forced production; the burn-in's chain always opens with the even-size stage), `convertCancel.test.ts` (the convert's `-vf`), `filters.test.ts` (`EVEN_PICTURE` once; the overlay font table: six fonts, thirteen fallbacks), `chain.test.ts` (a silent measurement is no measurement), `clipKit.test.ts` (all nine kit file names for eight device-like clip names), `ProjectIO.test.ts` (`describeApplyOutcome(outcome, via)`), `highlights.test.ts` (`hookWindowKey` is `"<window>@<start>"`), `templateTruth.test.ts` (the square card's sentence), `a11ySweep.test.ts` (rule 1 sees a border, a ring and a wash too, with a discrimination block; fourteen more elements named) and `interactionWiring.test.ts` (the hook badge's key, its gate and its per-clip key; both callers of `describeApplyOutcome`; the kit's file names); the E2E count is 224, one new case (the start-handle drag) and twelve extended; test:media is 174 passed | 11 skipped — 12 new cases that run (the odd-sized picture through the convert x3, the burn-in x3 and the PiP x2 plus the fixture check, and the silent input x3) and 2 win32-gated ones (the six fonts, and the Font choice reaching the picture); round 63 added seven files — `src/shared/textOverlay.test.ts` (the 148-name color table, name and hex resolution, the 8-512 clamp, the default overlay, the store patch), `src/main/ipc/captionsWriteKitSrt.test.ts` (the real `captions:writeKitSrt` handler on real files: the kit's `.srt` on the clip's clock, nine refused ranges and speeds), `src/renderer/src/hooks/useAutosave.test.ts` (the hold and the quit flush through the real stores), `tests/unit/spawnWindowsHide.test.ts` (a syntax-tree scan: every `spawn(` under `src/main` passes `windowsHide: true`), `tests/unit/jobClipNormalized.test.ts` (every export job takes its clip through `clipForExport`), `tests/unit/tempSandbox.test.ts` (the three test files that share a temp family each have a private `tmpdir()`), and `tests/unit/a11ySweep.test.ts` (selected-by-fill buttons need a state attribute, bounded scrollers need a tab stop, each named element is wired) — each scan with a discrimination block over sample code — and grew `validators.test.ts` / `assert.test.ts` (every validator throws under `NODE_ENV=production`, `assertAlways`, and a source scan that keeps every IPC gate off the soft `assert(`), `audioChainValidation.test.ts` (the chain gate under forced production), `muxCodec.test.ts` (the even-size stage ahead of a cut), `videoCropPayload.test.ts` (Compile's plain sentence, the default overlay compiles), `captionsProgress.test.ts` / `whisperManager.test.ts` / `captions.test.ts` (the burn's opening event has no percent, a probe frame of 0, `shiftSrtToRange` with a speed, `isUsableFrame`, the finished gate sentences), `clipKit.test.ts` (the YouTube Short's 180 s, `clipForExport` in the queue, `buildKitSrtRequest`, `kitCanceledMessage`), `highlights.test.ts` (`hookWindow` is `null` under 0.5 s, `hookWindowKey`), `videoStore.test.ts` / `ProjectIO.test.ts` (overlay normalization; both staleness baselines, the playhead for a video that opened, the toast ids and sentences), `AudioStudio.test.ts` (the lead-in and the grammatical list), `templateTruth.test.ts` (the sample-text rule over the Asset Library), and `extract.test.ts` (each child found by the file it was asked to read); the E2E count is 215 + 8 = 223; test:media is 162 passed | 9 skipped, the 7 new cases being the odd-sized re-attach (VP9, VP8, VP9 with a cut, plus the two fixture checks) and the kit's captions against the loudness of the kit's own export; round 62 added one file, `src/main/ipc/videoRemoveKitDir.test.ts` — the real `video:removeKitDir` handler on real folders: an empty kit folder goes, a folder with a file or an empty subfolder stays, every refusal is a console note, a path that fails the gate is refused before anything is touched — and grew the ones that already guard its surface: `ExportPanel.test.ts`
(`settleJobs`: the row that failed, the rows that never ran, a cancel), `videoStore.test.ts` (`setSrtPathFor` through the real `loadSource`,
`videoHasNoSound`), `ProjectIO.test.ts` (an `applyProject` that waits, driven by deferred gates over the real stores: a video or a sound opened
meanwhile is never clobbered, only a missing file reads "moved or deleted", the extract toast is shown and taken down), `clipKit.test.ts`
(the Short by the crop's frame, the counting labels), `presets.test.ts` / `presetTablesInSync.test.ts` (Reels 1200 s, the 180 s note, TikTok 60 s),
`highlights.test.ts` (`hookWindow`), `clip.test.ts` (the wire speed), `captions.test.ts` (the readout from the real frame),
`userFacingError.test.ts` (`isMissingFileError`), `audio.test.ts` (`commitLoudnessTarget`), `fixWizard.test.ts` (the notch),
`audioStudioCopy.test.ts` (the Light hint derived from main's filter), `canvas.test.ts` / `canvasStore.test.ts` / `image-studio/ExportDialog.test.ts`
(the dimmed hint and its capture), `templateTruth.test.ts`, `designTokensInSync.test.ts` (the four AA pairings recomputed, a scan for accent text on an
accent wash, three guides) and `interactionWiring.test.ts` (each fix is reached from the panel that needs it); the E2E count is 198 + 17 =
215); round 61 added three files — `src/main/ipc/audioChainValidation.test.ts`, the real
`audio:*` handlers and the real audio runner against a fake child: a second track's gain and ducking numbers and the loudness
target are refused in a finished sentence with nothing spawned, after the same test shows the old runner printing an injected
`gainDb` into `-filter_complex` verbatim (T-111); `src/main/audio/extract.test.ts`, the extraction ffmpeg's registry (register,
clear on close and on error, kill, the `cancelAllAudioJobs` sweep) and its 48 kHz / 16 kHz formats; and
`src/main/audio/muxCodec.test.ts`, the Re-attach command for each codec an mp4 can and cannot carry — and grew
`filters.test.ts` (the drawtext escape, judged by a model of ffmpeg's three parsing passes), `videoExportBatch.test.ts` (a damaged
recipe, a second batch), `captions.test.ts`, `captionsProgress.test.ts` and `whisperManager.test.ts` (the burn's measured percent
and its style on non-landscape frames), `transcribeCancel.test.ts`, `presets.test.ts`, `presetTablesInSync.test.ts`,
`audio.test.ts`, `projectValidation.test.ts`, `mediaFormats.test.ts`, `reframeProgress.test.ts` and `cancelSentinel.test.ts`);
round 60 added three files — `src/main/sidecars/transcribeCancel.test.ts`,
the real `extractAudioFromVideo` and the real `runTranscribe` against a fake `spawn`: a Cancel during the extraction kills
THAT child, removes its half-written WAV and never starts the engine, a Cancel before the child exists kills it on arrival,
a stale Cancel does not reach the next job (T-108); `src/main/ffmpeg/reframeProgress.test.ts`, the real `runReframe`: the
phase of unknown length carries no `percent` key (T-108); and `tests/unit/deadExposures.test.ts`, which fails on any function
of `ImagiiApi` (`src/shared/api.ts`, the type the preload object is checked against) that no renderer file reaches as
`<namespace>.<member>`, with a discrimination block (T-108) — and grew `paths.test.ts` (the whole captions-engine resolver
order as a ladder of fixtures, the lazy `<userData>/bin`, T-102), `templateTruth.test.ts` (a per-card table of which text layers are hints and which are the card's own content, T-103), `ProjectIO.test.ts` / `projectValidation.test.ts` (schema 5: a converted import stored as its original, the Clean
audio door, the v3 audio recovery, T-107), `cancelSentinel.test.ts` (transcription joins the pre-spawn table with a held
extraction), `filters.test.ts` (the centered zoom, the three-band temperature, T-109) and `videoCropPayload.test.ts` (one plain
sentence on the Compile and GIF paths, T-109); round 59 added three files — `src/shared/clip.test.ts`, `clipSpeed`
(a missing, zero, negative or non-finite multiplier is 1x, a speed that is not a number is 1x) and `clipRecipe`
(carries every field of a `Required<Clip>` except the five listed as not part of how a clip comes out, so a field added to
`Clip` fails that file's typecheck until someone decides); `src/main/ffmpeg/outputPath.test.ts`, `nextFreePath` against real
files (free, taken, 1..n, a gap, past 9 and 99, dots in a name, no extension, a folder or a dangling link counts, a missing
parent is not an error, the folder mode) and `makeKitDir` twice (T-106); and `tests/unit/clipSpeedOneReading.test.ts`, a
syntax-tree scan that fails on any read of `.speedMultiplier` outside the file defining `clipSpeed`, with a discrimination block
over the shapes the four old copies took (T-105) — and grew `concat.test.ts` (a segment's graph is byte for byte the export's at
the same geometry, stage order, fades placed on the clip's OUTPUT length at 1x/2x/0.5x/4x), `filters.test.ts`
(`buildAudioSpeedFilter` at 0.25/0.5/1/2/4 and the product of every chain, the Auto Zoom `fps=N,zoompan=...:fps=N` pair),
`validators.test.ts` (`assertOptionalClipRecipe`), `videoCropPayload.test.ts` (every compile recipe field refused by name
before the runner is touched), `videoExportBatch.test.ts` (nine damaged crops, one plain sentence, no probe, no child),
`presets.test.ts` (`COMPILE_TARGET`), `presetTablesInSync.test.ts` (the compilation's size, shape and rate are one frame on both
sides of the bridge, and it is the YouTube preset's) and `cancelSentinel.test.ts` (every runner that names its output writes BESIDE a file that
is there; a Cancel lands while the name is being chosen, for every runner incl. PiP, which gained a run; the join's name);
round 58 added six files —
`src/main/ffmpeg/cancelLatch.test.ts`, the run-scoped latch every cancelable runner opens (a
cancel marks the runs open when it arrives and nothing else; a probe wait gives way to it at
once; a stale cancel never reaches the next run — T-98); `src/main/ffmpeg/partialOutput.test.ts`,
what a stopped job may delete, against real files (T-100); `src/main/ipc/videoExportBatch.test.ts`,
the real `video:exportBatch` handler with the Cancel made to happen INSIDE
`e.sender.send('video:jobComplete')` — after job 1, before job 2, which is the gap itself;
`src/shared/reframe.test.ts`; `tests/unit/noRawHex.test.ts`, a syntax-tree scan that fails on a
hex color in any renderer source outside `tokens.ts` and the documented exceptions, with a
discrimination block (it fails exactly the two files T-104 named, 2 + 3 literals, against HEAD);
and `tests/unit/deadActions.test.ts`, which fails on a store action nothing outside its store
names (T-101: it found six, the ticket named one) — and grew `cancelSentinel.test.ts` (a pre-spawn
table over nine runners with a held probe, the compilation's list-file write, and the output
rows for eight runners: a cancel under both exit shapes, a failure, a stale file left alone, the
control keeps its file), `ProjectIO.test.ts` / `projectValidation.test.ts` (schema 4: the
extracted-from-video marker, save -> prune -> reopen, both old-shape directions),
`audio.test.ts` (`audioPassPlan` / `audioPassLabel`), `designTokensInSync.test.ts` (the signal
pair, its distinctness and its contrast) and `videoStore.test.ts` (the range-add guards,
retargeted at `addScannedClip`); round 57 added three files —
`src/main/ipc/videoCropPayload.test.ts`, the IPC gate on the crop that Compile and GIF now carry
(both handlers driven through a captured `ipcMain.handle` with the runners mocked: ten malformed
crops refused before ffmpeg is spawned, a good one handed through untouched), and
`src/main/ffmpeg/concat.test.ts` / `gif.test.ts`, the pure per-segment and GIF filter builders —
and grew `filters.test.ts` (`cropToFrame`, the one crop chain three runners share),
`validators.test.ts` (`assertOptionalCropRect`), and `presets.test.ts` / `clipKit.test.ts`, whose
verdicts now take the clip: the size check against the crop's frame, and every length at the clip's
speed (T-96, T-97); round 56 added four files —
`src/renderer/src/components/AppToaster.test.tsx`, which pins the toast card click-through (see
the 2026-10-09 T-92 entry in `LESSONS_LEARNED.md`);
`tests/unit/copyConventions.test.ts`, the T-92 copy scan: it parses every renderer
source with the TypeScript parser, takes the strings a person reads (JSX text, copy
attributes and properties, toast and `confirm` arguments, the strings a JSX
expression chooses between — `tests/unit/renderedStrings.ts`, a helper, not a spec)
and fails on a retired name, a `(s)` plural, an unspaced unit, a cut-short word, a
lowercase button or panel header, a bare "Show" button, an "Esc" / "Done" dismiss
button, a trailing period on a one-sentence result toast and the other rules in
`docs/BRANDING_GUIDE.md` "Copy conventions"; it pins `countOf` at every site that once
hand-wrote a plural, and its discrimination block runs the scanner over the copy that
shipped (35 failures against HEAD before the sweep). `src/renderer/src/lib/savedToast.test.tsx`
reads the element tree of a `toast.success` (the renderer has no DOM here) to prove an
action toast lasts 8 s and names "Show in folder"; `src/shared/units.test.ts`, the fps
formatter — and grew `highlights.test.ts` (the 0-100 score, old vs new),
`customPresets.test.ts` (`normalizeBitrate` / `formatBitrate`), `presetTablesInSync.test.ts`
(fps in both tables) and `interactionWiring.test.ts`; round 55 added eleven files — `src/shared/audioPreset.test.ts`
and `PresetPanel.test.ts`, the T-90 old-shape preset fixture driven through the real
store (the cut times an older build saved must not come back); `fixWizard.test.ts`, all
18 answer combinations held to the patch the wizard applies; `src/shared/audio.test.ts`;
`src/main/ipc/audioSaveFormat.test.ts`, the real save-dialog handlers (AAC asks for
`.m4a`, the re-attach `mp4` no longer throws); `tests/unit/audioStudioCopy.test.ts`, a
syntax-tree scan for engineer's words in anything Audio Studio shows;
`src/shared/canvas.test.ts`; `canvasStore.test.ts`, a retyped placeholder stops being a
hint; `templateTruth.test.ts`, every template and asset card checked against its own
data; and `src/main/imageSave.test.ts` plus `src/main/ipc/image.test.ts`, the
renderer-to-disk trust boundary and the one-dialog-per-set contract — and grew
`chain.test.ts` (the mains frequency), `presets.test.ts`, `LevelsPanel.test.ts` (every
picker row round-trips) and `ExportDialog.test.ts` (hint nodes hidden for the capture,
the output readout); round 54 added four files —
`src/renderer/src/modules/record-studio/devices.test.ts`, the T-88 device scan
against a fake `mediaDevices` that rejects a missing kind the way the real one
does, so a combined probe fails it; `saveCard.test.ts`, the post-Stop card's
copy and Discard availability per state; `src/main/sidecars/paths.test.ts`, the
captions engine found under either of its two names; and
`src/main/sidecars/captionsProgress.test.ts`, the real `runTranscribe` and
`runBurnIn` driven through a fake child to prove that no progress number is
invented and that a burn says whether it was captioned — and grew
`captions.test.ts` (the size derivation, the phase labels, the toasts),
`recordingCancel.test.ts` (the save dialog's title), `truthInCopy.test.ts` and
`interactionWiring.test.ts`; round 53 added two files — `src/renderer/src/modules/video-studio/PostChecklist.test.ts`, the T-87 cross-product of every title starter (patterns x verbs x subjects) with its article and placeholder checks, and `tests/unit/releaseWorkflowShape.test.ts`, which pins the release workflow's `on:` block to `workflow_dispatch` and a `v*` tag push; round 52 added six files —
`src/shared/watermark.test.ts`, the one constructor of a `WatermarkSpec` that
the Export panel and Clip Kit now share, fed the untrusted values a settings
file can hold; `clipKit.test.ts`, the jobs Clip Kit queues (the saved watermark
on all five, the vertical-source YouTube Short swap) and its one long-clip
question; `tests/unit/clipKitWatermark.test.ts`, those jobs followed into main's
real filter graph; `useTutorial.test.ts`, the target-gating rule as two pure
functions against a fake page; and the two structural files named above;
round 51 added four files —
`src/main/ffmpeg/cancelSentinel.test.ts`, the table that drives twelve real
cancelable runners (video export, GIF, compile, PiP, reframe, highlight
scan, audio export and re-attach, caption burn-in, transcription, convert,
frame extract) against a fake child and asks, for every way the app can stop
each one under both exit shapes a SIGKILL produces, that the rejection is the
cancel sentinel — and that the same exit nobody asked for is not; plus the
superseded hook analysis, the model download and the convert subclass;
`src/shared/cancel.test.ts`; `src/shared/userFacingError.test.ts`, the helper
every renderer `catch` goes through, exercised on the real strings main
produces wrapped the way Electron wraps them; and
`tests/unit/failurePathLanguage.test.ts`, a TypeScript-AST scan of the renderer
that fails on a `catch` reading its variable's `.message` or a `toast.error`
handed one, lists every site that must stay routed through the helper, and
proves on a bad snippet that the scanner itself discriminates — and grew the
`applyProject` block in `ProjectIO.test.ts` (each studio's failure leaves the
others applied), the `describeImportError` table for both importer kinds, the
rewritten search notice in `duckduckgo.test.ts` / `search.test.ts`, and the
rejected-search case in `referencesStore.test.ts`; round 50 added three files —
`presets.test.ts`, the first unit test of `evaluateSuccess`, the export
grid's per-platform verdict, now with reason-specific labels;
`ExportPanel.test.ts`, the first for `findSafeZoneIssues`, now read against
a clip's effective frame (it imports the component module directly, which
works under the node config because nothing renders); and
`src/shared/plural.test.ts` — plus the T-83 crop-chain block in
`filters.test.ts`, `cropFrameSize` / `outputSourceRect` in
`safeZone.test.ts`, and the T-94 pristine-predicate table and
scanner-action block in `videoStore.test.ts`; round 49 added
`src/shared/captions.test.ts` — the T-81 `shiftSrtToRange` cases plus
`tsToSeconds`, which moved there from `whisperManager.test.ts` along with
its helper, a first unit pin for `escapeSubtitlesPath`, and the
shifted-copy naming/sweep agreement —, the T-82 cut-expression block in
`chain.test.ts`, `assertOptionalTimeRange` in `validators.test.ts`, the
handler-level `src/main/ipc/captionsBurnIn.test.ts` (the first IPC handler
test that drives a captured `ipcMain.handle` with the runner mocked, to
prove "rejected before any work"), and the captions-family case in
`tempCleanup.test.ts`, whose userData folders are isolated through a
`setUserDataDirForTest` seam the way its tmpdir families are isolated by
`TEMP_SUBDIRS`; round 48 added the T-80
`endsGestureOnPointerUp` block to `videoStore.test.ts` — a pure
predicate, which is why the DOM question "does a caret click end the
undo gesture" is answerable here at all — and rewrote the T-29
clear-vs-trim block in `moodboard.test.ts` as the clear's own, T-79
having removed the budget it was trimming against).
How long the pass takes is in
"How long each layer takes" at the top of this guide. (The count moves most
rounds; treat the `npm run verify` output as the source of truth and this
line as the last-updated marker.)

**Adding a test.** Drop `foo.test.ts` next to `foo.ts`. Vitest picks it
up automatically. If the module under test imports `electron`, see
`src/main/audio/presets.test.ts` for the `vi.mock('electron', …)`
pattern.

---

## The interaction-coverage bar

Standing owner directive (2026-08-14, see CLAUDE.md): every interactive
element is driven to its real end state by a test, or has an explicit
disposition row in `docs/INTERACTION_COVERAGE.md`. Layer 2 is where most
of that lives; elements whose end state crosses an OS boundary are
covered at the deepest reachable layer instead and the ledger says so.

## Layer 2: Playwright Electron smoke (`tests/e2e/smoke.spec.ts`)

**Run with:** `npm run test:e2e` (after `npm run build`), or
`npm run test:e2e:build` for the one-shot variant.

**Environment.** The real built Electron app, launched via
`@playwright/test`'s `_electron` driver against a hermetic
`userDataDir` pre-seeded with `welcomeSeen: true`.

**What it covers.**

- App launches without throwing.
- Home page renders with all five NavCards visible (Record, Video
  Studio, Audio Studio, Stream Graphics, References).
- Each NavCard routes to its studio.
- Every studio renders without throwing in its initial state.
- HomeLink works from every studio.
- A PNG screenshot of each route lands in `tests/e2e/screenshots/` for
  visual review.
- **The built app makes no network request (T-127 (1)).** It is launched with Chromium's net-log, left idle 8 s past ready (the first
  DNS-over-HTTPS probe lands ~5 s in), makes ONE loopback request from main (the control: the log must hold exactly that request, so a log
  that records nothing fails instead of passing "zero"), is closed, and the log is read: no http(s), ws or ftp `URL_REQUEST` but the control
  and no resolver lookup of a host other than this machine. README's "zero network requests on startup" is this test. It is the one thing
  that sees what the PLATFORM does (Electron's spellcheck dictionary and Chromium's DoH probes were the first finds); the source scan
  (`networkAllowlist.test.ts`) cannot. The DoH leg shows only where the machine's resolver is a DoH-capable provider, so the wiring pin in
  `interactionWiring.test.ts` holds the calls everywhere.
- **The renderer's memory with a long file open (T-129, audio.spec.ts).** The long-file case reads the renderer process's high-water mark
  (`VmHWM` in `/proc/<pid>/status` for `webContents.getOSProcessId()`, whose last reading stands once the process is gone; elsewhere
  Electron's `getAppMetrics()` sampled every 100 ms) WHILE it waits for a 2 h 5 min file to draw, not only after: the wait ends on the
  first of "Play is on", "the memory is over the line" or "the player said it cannot play the file", and the line (800 MB) is asserted
  first, then that the player said nothing. That order is what makes it red against the old path, which fails one of two ways on this
  file, measured on the T-129 build with the renderer decode put back: its decode climbs 173 -> 1460 MB in about eight seconds and the
  renderer crashes (`render-process-gone`, `crashed`), or the decode is refused at once and wavesurfer reports an error; which one
  depends on the moment (two of three runs inside the case refused, one climbed). Asserted after Play, the crash was a red on Play and
  the refusal a red three minutes later, and the memory line itself never fired. Measured on the fix: 182-185 MB. It also counts the
  page's own `fetch` / XHR requests for the file (0: wavesurfer is given the peaks), and reads the progress line's percent from its words
  as well as its `aria-valuenow`. Main's spawn is wrapped from the test (`recordPeaksChildren`) to see how the peaks ffmpeg ended -
  `SIGKILL` after a Close, and already `SIGKILL` at `will-quit` after a quit.

**What it deliberately doesn't cover.** Media processing flows. Spawning
ffmpeg on a CI runner is slow and flaky; the unit layer covers the
pure parts and the cancel contract. The smoke verifies "did the app
get built correctly and reach every studio" — not "did a 90-minute
reframe finish".

**Why not in `npm run verify`.** E2E requires the `out/` build
artifact. `verify` is the fast pre-commit pass; the E2E layer lives behind
`npm run test:e2e:build` (timings: "How long each layer takes" at the top of
this guide).

**Adding an E2E case.** Drop `*.spec.ts` into `tests/e2e/`. Keep the
launch hermetic (`os.tmpdir()` userDataDir + cleanup in a `finally`)
so concurrent runs don't collide.

**Four shared helpers, and the rule for each** (the specs are not
typechecked by `npm run verify` — `tsconfig.*.json` cover `src/` only —
so these conventions are held by review and by the suite itself):

- **Every synthetic mouse gesture goes through `tests/e2e/drag.ts`**
  (`dragTo` / `dragThrough`), never raw `mouse.down` + `mouse.move` +
  `mouse.up`. The helper's header explains the crossing-event race it
  closes; what a caller owes it is the `extent` — a read of what the
  app DRAWS while the button is down (the region's right edge, the
  node's `x`, the rnd box's width) and the value it has to reach. A
  gesture that must commit NOTHING is the one legitimate omission. Any
  coordinate the gesture is planned from is polled until it is a real
  number first: a box read before the surface lays out plans the whole
  drag against nothing and fails ten seconds later as `last read: NaN`
  (T-62).
- **Toasts are recorded, never polled for**, via
  `tests/e2e/toastLog.ts` (`installToastLog` before the action,
  `readToastLog` at the assertion; `readToastEntries` adds whether the toast
  drew a status icon, because a cancel in a red `toast.error` carries the
  right words and is still wrong — T-84). It records
  `[data-rht-toaster] [role="status"]` — react-hot-toast's own message
  node inside its own container — so the log holds toasts and nothing
  else. The wide version this replaced logged every element mounted
  under `<body>`, which meant a route change logged a studio's entire
  panel copy as one entry and `toContain` / `toEqual([])` assertions
  were quietly answering questions about the page (T-70).
- **A box that is typed into is typed into with `retype` (`tests/e2e/typing.ts`), never `fill`** (T-123 (3), (4)).
  `locator.fill('600')` replaces the value in one step, so it cannot find a box that rewrites itself on every keystroke:
  the specs that filled the PiP width and the overlay's Time boxes were green for rounds while "600" typed key by key gave 360600
  and "12" gave 1.00. `retype` selects the old number, deletes it (the box is EMPTY then, the instant an `|| default`
  snapped it back) and `pressSequentially`s the digits; `leave` Tabs out, which is when a draft commits. A case for any new
  number box asserts the emptied state, each intermediate state and the committed one.
- **A chooser the app must NOT open is counted, not just answered** (T-124 (21)). `recordOpenDialogs(app, files)`
  (video-pipelines.spec.ts) replaces `showOpenDialog` in main with a recorder: a folder chooser is answered "canceled" and
  logged, a file chooser takes the next of `files`, and `openedDialogs(app)` reads what was asked. "Pressing the action with a
  remembered folder opens no chooser" is then an assertion (`['file', 'file']`, the two the Picture-in-picture inputs need),
  where a stub that always answers cannot tell a panel that asked from one that did not.
- **Panels that share a value are driven as one** (T-125 (10)). Reframe, GIF, Compile and Picture-in-picture hold ONE output folder, so
  a case that drives them in turn picks the folder in the first and asserts the others already show it (`expectFolderShown`: no
  **Choose folder…**, and the button named `Output folder: <name>`); pressing a button that is no longer there timed out 30 s in six
  cases the day the store landed. A device that goes away is a dispatched `ended` (`endMicTrackOnly`, beside the screen's), and the
  take is stopped by the person, so both the told-once case and the told-nothing negative are driven.
- **A key a menu would take is dispatched, not pressed** (T-124 (29)). A real Ctrl+R in the Electron window is the default
  menu's Reload and takes the page with it before the assertion looks; `window.evaluate` dispatches the `keydown` on the canvas,
  which is what the page's handler hears. The chords that are not accelerators (Ctrl+O in Video Studio) are pressed for real.
- **A layout is asserted by measuring it, with `tests/e2e/layout.ts`** (T-123 (24)-(27)). Every behavior case reaches a
  control with `click()`, which scrolls it into view first, so a Rotation row clipped behind a hidden horizontal scrollbar
  passed ten sweeps of "click all seven presets". `setWindowSize(app, window, DEFAULT_WINDOW | MIN_WINDOW)` resizes the real
  window (1632x918, the size a 1080p display opens the app at, and the 1024x640 minimum; Xvfb's own screen is not either) and
  waits for the layout; `expectNoHorizontalOverflow(container, what)` asserts `scrollWidth <= clientWidth` and that nothing sits
  past the container's right edge, and names the widest offenders when it fails; `expectControlsWhole(container, controls, what)`
  asserts each control ends inside the container and its own text is not cut off ("Aggress" for "Aggressive"); T-124 added
  three: `expectSelectsWhole(container, selects, what)` (a `<select>` clips its text inside itself, so its `scrollWidth` is
  always its `clientWidth`: this measures the SELECTED option's text in the select's own font against its content box less
  padding and the arrow, `SELECT_ARROW_PX`, calibrated on the real select: Chromium draws the text up to 25 px short of the
  right edge), `expectNoOverlap(elements, what)` (nothing drawn over anything else: a control inside its box and not cut
  off can still sit on its neighbour) and `expectOneLine(elements, what)` (a label that wraps by the word). Red-first
  means against the pre-fix BUILD, because the number is the evidence: `the layers and Properties column ... scrolls sideways: its
  content is 406 px wide in a 260 px box`.
  T-125 added two: `expectSameRow(elements, what)` (the pieces of a wrapped row share a line: the Source time row left "→" at the end
  of one line with its box under it, and nothing was clipped, overlapped or cut) and `expectEllipsized(chip, fullText, what)` (a
  name too long for its box is clipped, ends in an ellipsis, is one line, and has the whole text as its tooltip). A case that checks
  several cards or sizes collects every finding and fails once with all of them (`problems`), so the pre-fix run names each one:
  `the Reframe card at the default 1632 px window scrolls sideways: its content is 668 px wide in a 298 px box. Past its edge:
  <button> "Reframe to 9:16" +370px`. The fixture for a long folder name has no spaces and no hyphens: a name with a break opportunity
  wraps inside the button instead of widening it, and the pre-fix build passes.
  T-126 changed one helper and added four rules. `expectOneLine` measures the TEXT's height (the box less its own vertical padding and
  border): a padded `btn-primary` is a line and 12 px of padding, which the box-height form read as two lines. The rules: (1) **seed both
  halves of a shape** - the same long folder name needs no spaces to push a button out of a card (T-125 (11)) and needs spaces to make a
  primary wrap (T-126 (13)), so there is a case for each. (2) **When a fix stops one item shrinking, measure the item that gives instead**:
  `shrink-0` on the Compile fade readout moved a 27 px overflow onto the card until the slider got `min-w-0`, and `min-w-0` on the folder
  chip let its label keep its min-content width inside a button that had shrunk (the ellipsis never fired) until the label got `w-full`
  (a first try, `max-w-[min(9rem,100%)]`, lost the cap while the button was being sized and was caught by the T-125 (11) case in the full run);
  the existing overflow and whole-control checks caught all three. (3) **A double-click is a witness only
  where the second press can land**: whether it hits Cancel depends on two labels' widths in the font in use, so the E2E holds the encode
  (`installSpawnStall`) and measures where Cancel is DRAWN (a row of its own, below the primary), then lets the job finish. (4) **A browser
  API that answers "true" for the empty case is not a check**: `document.fonts.check('500 12px Inter')` is true for a family nothing defines
  (measured on the pre-fix build: true, zero faces), so the font case asks `document.fonts.load()` for the matching faces and requires them
  `loaded`, and reads the built style sheets from disk for a `url()` that is not a file in the build.

**Two house patterns from round 60** (T-108 needed a speech engine that is not installed, T-103 a question one pixel cannot answer):

- **Put a stand-in where the real resolver looks.** The captions engine is not installed in any test environment (HL-whisper),
  but since T-102 the resolver looks in `<userData>/bin` first, so `video-pipelines.spec.ts`'s `installFakeEngine` writes a
  shell script there (it appends to a marker file, writes its pid, and `exec`s a long sleep) plus a placeholder model file. The
  real resolver finds it, the real audio extraction runs, the real `runTranscribe` spawns it, and a Cancel exercises the
  product's own registry, latch, sentinel and toast; the assertions are on the process (dead within seconds), the marker (the
  engine never started, for a Cancel during the extraction) and the temp folder (no WAV left). Skipped on win32, where the
  stand-in is a script.
- **Count the pixels that are not the background.** `image.spec.ts`'s `pixelsOtherThanBackground` decodes a whole box of an
  exported PNG with the bundled ffmpeg and counts the pixels any channel of which is more than a tolerance from the document's
  background. One pixel cannot say whether a line of text is in a file (glyphs have gaps); a box of them says 0 versus tens of
  thousands, and the same file's accent bar is the positive control. Red-first: `Received: 29528`.

**Three house patterns from round 71** (T-121 needed a camera that opens and then cannot be used, a store that lags on purpose once per key, and the bytes a red-first run really ran against):

- **Refuse the one element that holds the camera's stream.** record.spec.ts's camera-fallback cases replace `getUserMedia` for the camera with a canvas stream (this container has no camera) and `HTMLMediaElement.prototype.play` with a function that rejects when `this.srcObject` is that stream. The compositor plays its camera element before anything else, so a camera that opens and then cannot be composited is a state the test creates, and the evidence is the stream's own tracks (`readyState`) read after the toast: `['ended']`, not the absence of an error. The leave case holds the same refusal behind a gate (the round-70 technique) until the Home link has been clicked, and asserts what a start that carried on would have left: a toast, a recordings folder.
- **Stale on purpose, once per key.** The Timeline case loops over the four keys, parking the store's playhead near the start with a click each time and letting the picture run past it, because the first failure of a loop hides the others: the red-first run reverted each key alone and watched its own bound fail (`Received: -0.713054`, `-1.906576`, `-1.742021`, `-0.883008`).
- **Rebuild the bytes you claim were red, and hash them.** For a change in a file the held wave has edited and not committed, "red against HEAD" is not available. The pre-change file is rebuilt by the inverse edits and its sha256 compared with the baseline recorded before the round started (RecordStudio and the Timeline matched), and only then is the E2E run against it; the restore is a content replace, hashed again.

**Five house patterns from round 70** (T-120 needed states that exist only between two awaits, a key held down, and a number the page cannot be asked for):

- **Hold the real capture, leave the screen, let go.** `record.spec.ts` wraps `navigator.mediaDevices.getUserMedia` so the REAL desktop capture is made and then held behind a gate the test owns,
  clicks Start, clicks the Home link while the button still reads "Starting…", and opens the gate: the start's awaits now land in a studio that is gone. The evidence is what is left running: every
  track of every stream the wrapper handed out is `ended`, `<userData>/recordings` was never created (`recording:begin` was never asked), no temp file. The first version asserted only the tracks and the temp
  file, and the mutation that removed the FIRST unmount check stayed green (the later check cleaned up after a session had been opened and thrown away); the folder's absence is what tells them apart.
- **A held key is `keyboard.down` twice.** Playwright marks a `keydown` for a key that is already down as a repeat (`event.repeat`), which is what a held key sends. The Fix wizard's case presses Enter once, repeats it
  five times and releases, and asserts the wizard is still on its second question, nobody pressed Apply, and a fresh press still answers.
- **Make the store stale on purpose.** `timeupdate` reaches React through a listener on the `<video>` itself, so a capture-phase listener added by the test that calls `stopImmediatePropagation()` keeps the store's `currentTime` where the
  click left it while the video plays. "I marks the frame on screen" then differs by a second from "I marks what the store last heard", and the answer cannot be an accident of when a `timeupdate` landed.
- **Read what the chooser was opened WITH.** `dialog.showOpenDialog` is replaced in main with a stub that records its options and cancels; the Clip Kit case asserts `defaultPath` for the remembered folder, a relative path, a cleared
  setting and a written-back folder. A canceled chooser starts nothing and says nothing, which the same case asserts.
- **A setting the window reports about itself.** There is no window manager under xvfb, so a hidden or minimized window stays `visible` to the page (probed with the setting off: `document.visibilityState` was `visible` after `hide()` and after `minimize()`, and `requestAnimationFrame` ran 31 ticks in 500 ms in all three states),
  which means the effect of the setting cannot be shown here; the minimized behavior is a hand-check on the win32 release run. What can be read is `webContents.getBackgroundThrottling()` on the live window.

**Two house patterns from round 59** (T-106 needed two files at one path, T-105 two clips in one file):

- **Hash the files, wait the toast out, move the pointer off it.** `video-pipelines.spec.ts`'s `sha256(file)` is read before
  and after a second job, so "the first export is untouched" is a byte comparison and not an absence of an error, and
  `frameLuma(file, t)` (the whole frame's mean luma through the bundled ffmpeg) compares two clips of one compilation at the same
  moment of the source, so a color grade is the only difference. Two jobs in one test would each raise a "Show in folder" toast
  and `expectRevealToast` needs exactly one on screen, so the test waits for the first to go (`toHaveCount(0)`) and re-arms
  `stubShellReveal`. **A toast the pointer is resting on never leaves** — react-hot-toast pauses a hovered toast, and
  `expectRevealToast` presses the button — so move the mouse off it (`window.mouse.move(2, 2)`) before waiting; the dup tests
  that go on to click elsewhere do it for free, the Reframe/PiP one has to say so (it timed out on `toHaveCount(0)` the first time).
- **Red-first with a poll that waits 9 minutes: shorten it on a copy.** A "(2) never appears" test is red by timeout. The HEAD run
  is the real evidence; for a mutation run on a built app, copy the spec to a throwaway file with the poll timeouts cut to 15 s
  (`sed 's/540_000/15_000/g'`), run only that case, delete the copy. Nothing in the committed spec changes.

**Four house patterns from round 62** (T-112 needed states that only exist while something slow is
in flight; every one is "make the slow thing hold still, change the world, let it go"):

- **Hold a probe, delete the source under it.** "A failed batch marks the job that failed"
  (`video-pipelines.spec.ts`) holds the SECOND ffprobe with `installSpawnStall(app, [{ match:
  'ffprobe', nth: 2, ms: 6000 }])`, waits for job 1's file (`Show in folder` count 1), removes the
  source from disk, and lets the probe finish: job 2 fails with the REAL "file isn't there" error, job 3
  never starts. The assertions are the row labels (`Failed` x1, `Not run` x2, `Canceled` x0), the
  reason as text that outlives the toast, and one red bar. Red-first: `Expected: 1` / `Received: 2`.
- **Replace the handler, change the world, release the gate.** "Transcription that finishes after the
  video changed" swaps `captions:transcribe` in main for a handler that waits on a gate, closes video
  A, drops video B, then opens the gate: the result for A arrives while B is open. Where the slow
  thing is an ffmpeg the spawn stall holds it instead: the importer (an flv's conversion held 10 s, a
  second file dropped meanwhile, the spawn log still showing ONE ffmpeg) and the returning Export (the
  first batch's encode held 60 s, Home and back to a fresh panel, Export pressed again, the spawn
  log unchanged and no file written).
- **A native `confirm` is answered by the page's dialog handler.** Electron's `window.confirm` raises a
  Playwright `dialog` event: `window.on('dialog', ...)` records `dialog.message()` (asserted word for
  word against `audioCloseMessage`) and accepts or dismisses by a variable the test flips between
  clicks, so one launch proves declined = nothing happened, accepted = it happened, and an untouched
  session asks nothing.
- **Read a computed style, not a class.** The AA fixes are asserted as `getComputedStyle(...).color` /
  `textDecorationLine` on the live element (the setup links' six underlines, the pill's ink, the kit
  label's color), because a class name passing a test says nothing about the cascade that wins.
  `designTokensInSync.test.ts` is the other half: it recomputes the contrast ratios from the tokens and
  scans the renderer's source (comments stripped by a `code()` helper, since explanatory comments
  quote the very classes the scan forbids).

**Two house patterns from round 58** (T-98 needed a click inside a 40 ms window, T-100 a job that
cannot run here):

- **Hold the wait, then click in it.** `tests/e2e/mainSpawn.ts` (`installSpawnStall` /
  `readSpawnLog`) wraps `child_process.spawn` IN MAIN (nothing in `src/` changes) so a matching
  spawn — the Nth ffprobe, every ffprobe, the first single-frame extract — is replaced by a tiny
  Node process that waits `ms` and then runs the very same command with the same pipes. The probe
  still returns the real answer, late, and "Cancel pressed before the job's ffmpeg exists"
  becomes a state the test CREATES instead of a race it hopes to win. The spawn log is the other
  half of the evidence: "the app spawned exactly `ffprobe, ffmpeg, ffprobe`" proves no encoder
  was ever started for the second job, which "no file appeared" cannot (a slow job satisfies it
  too). It reaches the module with `process.getBuiltinModule` (main is ESM, so there is no
  `require` in `app.evaluate`) and publishes the patch with `syncBuiltinESMExports`. Written
  red-first: the HEAD build answered the held-probe Cancel with `Received: ["Video loaded",
  "Exported 2 files"]`.
- **Replace the handler with one the test holds.** The Clip Kit "Cancel between two calls" case
  swaps `video:extractFrame` in main for a handler that waits on a gate, clicks Cancel while the
  renderer is mid-sequence, then opens the gate and counts the calls that were made; the audio
  Export row case does the same with `audio:export` and sends `audio:progress` events on the
  real channel in the order the test chooses; the captions case replaces `captions:status` and
  `captions:transcribe` because the engine is not installed here. The component's real `catch`
  runs on a rejection of the shape the real job produces.

**One house pattern from round 57** (T-96 needed an end state no filename shows):

- **Decode the output and count a colour.** `video-pipelines.spec.ts`'s `redPixelCount(file, t)`
  has the bundled ffmpeg write one frame of a GIF or MP4 as raw `rgb24` and counts the strongly red
  pixels. A source with a red block the drawn crop excludes turns "did the crop reach the GIF /
  the compilation" into `0` versus `> 5000`, and the same run's other half (an uncropped clip, or the
  crop cleared) is the control. It was written red-first against the HEAD build
  (`Received: 58549` red pixels in the cropped half of a compilation). Layer 5 asserts the same facts
  with a square marker; the E2E version proves the control the person actually pressed reached them.

**Two house patterns from round 56** (T-92 needed a toast that outlives its default and a button
whose end state is Explorer):

- **Leave and come back (T-135).** A panel's state is tested for what a route change does to it: `leaveAndReturn(window)` (video-pipelines.spec.ts)
  clicks the Home link and goes back to Video Studio, where the video is still loaded (its store outlives the route) and every panel mounts again.
  The jobs are the 20-minute fixture (`longSrc`) or a probe held with `installSpawnStall`, so each is still running when the person is back; the case
  asserts the working label and the disabled primary, the bar, and the Cancel, then presses the Cancel and asserts the neutral toast and the idle
  panel. A finished-while-away case holds the encode a few seconds, goes Home, waits for the file and the toast, and comes back to the finished row.
  `audio.spec.ts` does the same for the audio export: a long MP3 with loudness on, whose measuring pass is the window.
- **A value past an input's cap.** Playwright's `fill` honors `maxlength`, so a test that wants to prove the refusal behind a cap writes the value
  with the native value setter and an `input` event (`setValuePastCap`, references.spec.ts) and asserts both halves: the box stops a person at the
  cap, and main still refuses what gets past it.
- **A fixture the preview cannot draw (T-135 (2)).** `proresSrc` (video-pipelines.spec.ts) is a real ProRes `.mov`: in this Electron it loads with
  `videoWidth` 0, `readyState` 4, no `error` event and a `play()` that resolves. The case reads the element through `window.__imagiiVideoEl`, so
  it asserts the tell, not just the note; the other two signals (a rejected `play()`, an `error` event) cannot be had from a file on every machine
  and are made by stubbing the page's element, not the app.
- **A load held by the page, not the network (T-135 (13)).** The renderer's content policy allows images from https only, so a held fetch cannot
  be served from a test. The case parks the page's `HTMLImageElement.src` setter for a file named "slow" and releases it when the test says, which is
  exactly the wait the click-time premise missed.
- **Hold a conversion, then count its working copies (T-136 (2)).** The Importer's transcode and the Player's preview copy are the first `ffmpeg` the
  page starts, so `installSpawnStall(app, [{ match: 'ffmpeg', nth: 1, ms: 20_000 }])` holds it while the case leaves and comes back; a SECOND conversion
  would not be held (the rule is for the first spawn only) and would write its file in `imagii-import` at once, so "one conversion" is a listing of
  that folder (`before` is taken ahead of the press), not a count of spawns - a remounted Clip Kit badge asks `ffmpeg` for its hook, and the spawn log
  counts that too. Main's own refusal is read through the real bridge (`window.api.video.convertForImport(...)` from `window.evaluate`), which is the
  sentence a second caller of any kind would get. A conversion that is finished while the person is away is waited for by the working copy's size
  holding still for two polls (ffmpeg writes the file as it goes and finishes the index last).
- **Stand in for the network, not for the handler (T-136 (4)).** `captions:installModel` is the product's own handler running `installWhisperModel`;
  the case replaces `net.request` in MAIN (`app.evaluate(({ net }) => { net.request = ... })`) with an `EventEmitter` that answers `response`, sends
  progress up to 40% and never ends, and whose `abort()` emits `abort` as Electron's does. The real partial file is written and removed, the real
  Cancel reaches `cancelWhisperModelInstall`, and the real "Download canceled." toast is read; only the 141 MB from Hugging Face is not fetched.
  The other half (a download that ENDS while the panel is on screen) uses the T-113 stand-in handlers, because a real end is a SHA-256 check of the
  real file.
- **Observe the beat a final state hides (T-136 (6)).** When a condition has a clause that only matters between two events (the Output preview's note
  must go the instant the preview copy is in the store, but the Player clears its own verdict a moment later when the copy loads), the final state is
  the same with and without the clause, and a case that only waits for the end passes on the mutant. Arm a `MutationObserver` from `window.evaluate`
  BEFORE the press, record every DOM state that violates the rule (the `<video>` is on the copy and the note is still on screen), and assert the
  record is empty AND that the observer saw the event it watches (`sawCopy`), so a mis-aimed observer cannot pass vacuously. A React commit is one
  DOM batch, so the observer's callback reads the page between that commit and the next task.
- **Wait past the default to prove a duration.** `expectRevealToast` (video-pipelines.spec.ts)
  finds "Show in folder" on a success toast, waits 3.5 s (react-hot-toast's success toast lasts 2 s)
  and asserts the button is still there — the one place a fixed wait IS the assertion. It was
  written red-first (`"Show" is still there 3.5 s later` against the old build).
- **Stub the shell in MAIN and read what it was handed.** `tests/e2e/shellReveal.ts`
  (`stubShellReveal` / `readRevealCalls`, shared by record.spec.ts, audio.spec.ts and
  video-pipelines.spec.ts) replaces `shell.showItemInFolder` and records its argument, so every
  "Show in folder" button is driven to its real end state — the exact file the job wrote — without
  an Explorer window. `expectToastClickThrough` presses a point on a live toast's own padding and
  reads where the click LANDED through a capture listener that swallows it, so the control beneath
  can be proven to receive the click without being pressed. An accessible name or description is asserted with `toHaveAccessibleName` /
  `toHaveAccessibleDescription`; a tile that holds a checkbox is found by that checkbox, not by its
  text.
- **A date in a name needs a clock whose day is not UTC's (T-117).** `tests/e2e/skewedClock.ts`
  (`skewTimeZone`, `localDay`, `utcDay`) puts the worker on UTC+14 once it is 10:00 UTC and UTC-12
  before, so the local day differs from the UTC day at the moment the case starts; the app is launched
  with `...process.env`, so main and the renderer inherit the zone. The Clip Kit folder and Record's
  suggested name were stamped from `toISOString()` for rounds, and every case that named the stamp
  computed the same UTC string (`kitStamp()` was written in UTC): they agreed with the bug on any
  machine, and a CI box is usually in UTC. The oracle is written from the `Date` getters, not from the
  app's helper, and each case asserts the skew is real before it starts. At the unit layer
  `process.env.TZ` can be assigned inside a test (Node re-reads it) beside `vi.useFakeTimers({ toFake:
  ['Date'] })`, and a Date whose local and UTC fields name different days works in any zone.

**Two more house patterns from round 55** (T-91 needed a save that can be canceled, and
T-90 a frequency a string test cannot vouch for):

- **Stand in for the OS dialog in MAIN, answer it both ways, and read the folder.**
  `image.spec.ts`'s `installSaveStub` replaces `dialog.showSaveDialog` and
  `showOpenDialog` and records every call; `answerDialogs` flips the next answer between
  save, cancel and "a folder that is gone". The assertions are on files in a temp
  directory and on the toast log, so "a canceled save raised no toast and wrote
  nothing" is a state the suite can reach. (The old `<a download>` path was driven
  through `will-download`, which cannot be canceled from a test — that is how the
  cancel bug survived.) A folder has no order: tests that save a set key the files by
  name, never by position.
- **Measure the frequency, not the filter string.** The Layer 5 hum case exports a
  pure tone per frequency (50, 60, 100, 120, 1000 Hz) through each mains setting and
  asserts the tone's own level, so "the 50 Hz notch is at 50" is a drop of 20+ dB on
  the 50 and 100 Hz tones and under 1.5 dB on the others. It was written red-first
  against the fixed-60 chain (`dropped 0.1 dB`).

**Three more house patterns from round 54** (T-88 and T-89 needed states the
container cannot produce on its own):

- **Hold the native dialog open to make a state assertable.** `stubSaveDialog`
  (record.spec.ts) records the options the OS dialog would have been opened with
  and can delay its answer. The card the renderer shows while a save is pending
  is on screen for exactly that long, so its per-state copy (and the dialog's own
  title) is readable without racing a copy that takes milliseconds.
- **Count the calls instead of guessing what a click did.** A wrapper around
  `navigator.mediaDevices` installed in the page (`spyOnDeviceScans`) turns "did
  Refresh re-run the device scan?" into a number the test can read before and
  after. Stubs for a device that is "plugged in" are installed AFTER the spy so
  they delegate to it, and `unstubDevices` puts the originals back.
- **Drive a renderer listener from MAIN on the real channel.** The captions
  progress row is only ever fed by `captions:progress` messages; with no whisper
  binary the engine cannot produce them, but
  `BrowserWindow.getAllWindows()[0].webContents.send('captions:progress', …)`
  from `app.evaluate` runs the same preload listener and the same render a real
  transcription would. The same trick replaces an `ipcMain` handler
  (`removeHandler` then `handle`) to make the renderer's real `catch` see a
  rejection shape that main never produces on its own.

**Three more house patterns from round 78** (T-128 needed an app that is quit in the middle of a job, and a main that refuses a write):

- **Quit by the window's X in an app whose temp folder is its own, and read the folders after it has exited.** `launchHomeInOwnTmp`
  (video-pipelines.spec.ts) launches with `TMPDIR` / `TMP` / `TEMP` pointed at a folder of the test's own, so what the job scratches is the
  only thing in it and another run on the machine cannot be mistaken for the job's. The assertions are made on disk, after `quitByWindowX`
  returned: a half-written mp4 at the name the person chose, a scratch WAV, a raw take in `userData/recordings`. For a save the invariant is
  "the finished file exists OR the raw take survives, never both gone".
- **Make the slow case slow.** A cleanup that is a few milliseconds of work on an idle disk races the window's teardown, and an unfixed app
  can win that race by luck (executed: the extraction case PASSED on the pristine build). `slowUnlinkInMain` patches `fs/promises.unlink` in
  the main process to take 600 ms for the job's file (a slow disk, an antivirus scan) and publishes the patch with `syncBuiltinESMExports`
  (`installSpawnStall`'s technique); the fixed app waits for it (the drain's ceiling is 1.5 s), the unfixed one exits first. A test of a
  cleanup that does not stall it proves the platform's speed.
- **Make main refuse.** `ipcMain.removeHandler('settings:set')` then a handler that throws puts the renderer's real `catch` in front of a
  refused write (a full disk, a config it cannot replace); the assertions are that the click still did its job (the file exists, the person
  is let in) and that the one sentence was said.

**A picture the RENDERER has to load cannot come from the test's HTTP
server.** `index.html`'s CSP allows `img-src 'self' data: blob: https:
imagii-file:` — no plain `http:` — so the local server that proves a
MAIN-process fetch (the T-28 first-save test) is the wrong harness for
a fixture the tile itself loads. A `data:` URL carrying the same real
bytes is: it decodes, `naturalWidth` still discriminates, and live
`https:` thumbnails stay HL-network (T-79's fallback test).

**A unit test that asserts an exact count over a shared tmpdir clears
every family the function scans, not just the ones it writes to.**
`tempCleanup.test.ts` cleared `imagii-audio` and `imagii-concat` while
`pruneStaleTempFiles` also scanned `imagii-import`, so `npm run
test:media` (whose linux mpegts pin can crash a convert child
mid-write) followed by `npm test` failed on a test that had nothing to
do with either. The list is derived from the function's own
`TEMP_SUBDIRS` now, so a family added later is isolated on the same
commit (T-67).

---

## Layer 5: real-media integration (`tests/integration/media.spec.ts`)

**Run with:** `npm run test:media` (342 cases, 329 run | 13 platform-skipped; timings: "How long each layer takes" at the top of this guide).

**Environment.** node + the real bundled ffmpeg/ffprobe binaries. No
Electron, no DOM. Configured by `vitest.integration.config.ts` so it
stays out of the fast `verify` pass.

**What it covers.** The layer every other layer stops short of: it
drives the actual production job runners (`runExportJob`,
`runAudioExport`, `runGifExport`, `runAudioMux`, `runAudioReattach`,
`runBurnIn`) against tiny generated
sources and asserts on the bytes that come out — dimensions, codecs,
faststart atom order, two-pass loudnorm accuracy (±1 LU), sidechain
ducking depth (measured through a bandpass isolate), cut-region
durations, and subtitle-path escaping against ffmpeg's real filtergraph
parser. Since T-60 it also runs two concurrent encodes and cancels one,
because "which process did the SIGKILL reach" is a question no fake
child can answer.

**Why it exists.** Round 18 proved the gap: three shipped features
(autoZoom, sidechain ducking, parametric denoise) had filter strings
that passed every string-shape unit test and were rejected by ffmpeg at
runtime, 100% of the time. A unit test can pin what we *think* the
filter should say; only real ffmpeg can pin that it *parses and runs*.

**Running the win32-only drawtext cases here (T-111).** A linux box cannot run them against the bundled binary, but a system
ffmpeg of the shipped major (6.1.1, which has drawtext) can, with four stand-ins and none of them in the repo: a throwaway vitest
config that aliases `ffmpeg-static` / `ffprobe-static` to `/usr/bin/ffmpeg` / `ffprobe`, a setup file that sets
`process.platform` to `win32`, a working directory holding a `C:/Windows/Fonts/` folder with `arial.ttf` / `arialbd.ttf` symlinked
to DejaVu (the filter graph names the font by that relative path), and `-t` to pick the cases. Round 61 ran its drawtext
cases that way (red-first included); the suite itself has no pattern for a second binary, so none was added. Round 64 ran
the font pair that way with SIX different faces behind the six file names (`impact.ttf` and `arialbd.ttf` both the bold
DejaVu Sans, `cour.ttf` the mono one, and so on), so "Courier New is wider than Arial for the same text" is a measurement
that cannot pass if the filter prints one file for all of them: red-first `126 px against Arial's 126 px`. A config file
kept outside the repo must not `import` from `vitest/config` (it cannot resolve it from there): export a plain object.
Round 68 (T-118) ran the same recipe for a different reason: the major itself. The bt709 block below and the burn-in escapes were
run against the distro's 6.1.1 with two two-line modules in the scratch folder (`export default '/usr/bin/ffmpeg'` for
`ffmpeg-static`, `export default { path: '/usr/bin/ffprobe' }` for `ffprobe-static`), a config whose `resolve.alias` points the two
package names at them, `root` set to the repo and `-t` to pick the cases. The config and the aliases stay outside the repo.
Round 69 (T-119) ran it again for the bt601 half of the same block, with `@shared` in the alias list too and a one-test spec
beside the config that prints what `ffmpegPath` and `ffprobePath` resolve to under it (`/usr/bin/ffmpeg | ffmpeg version
6.1.1-3ubuntu5`, and the bundled `7.0.2-static` under the repo's own config), so the transcript says which binary ran.
Round 74 (T-124) ran the WHOLE suite that way, for the first time, because its cut change (`asetnsamples=n=256` ahead of `aselect`)
touches every audio export: 231 passed and 8 failed on 6.1.1, and the same seven failed on the round-73 tree under the same config
(the four `KNOWN linux-binary gap` pins, which assert the BUNDLED binary has no `drawtext`; the GIF frame-rate read `25/2`; the `ansi`
demuxer claiming a text file; the mpegts convert-crash pin). The eighth was real: a case that read `-0.2 dBFS` where it read `-1.0`
before, which was the resample after the limiter and not the limiter (the case moved to a 48 kHz source, with the finding ledgered).
A changed cut graph is run through the shipped major's whole suite, not only its own block, and a failure there is compared with
the same config on the previous tree before it is called a regression or a platform difference.

**Round 75 (T-125): what each new chain case measures, and its first red.** Five changes to ffmpeg commands or filter graphs each
landed with a Layer 5 case that failed against the round-74 code, on the bundled 7.0.2 and on the shipped major's 6.1.1 (the alias
recipe above; the transcripts are in the round's record).
- *The join* (`a compilation keeps the sound on its picture across many joins`, item 1). Eight 1 s segments are cut from a source with
  a flash and a beep on the same instant every second, joined through the real `runConcat`, and the beep minus the flash is measured at
  each segment: under 15 ms at every one. Red with the old join (AAC segments, stream-copied): `beep minus flash at each segment is 0 / 30
  / 59 / 88 / 118 / 147 / 176 / 206 ms` (29.3 ms of encoder priming per join), identically on both majors. The segment is Matroska with
  PCM sound and the join encodes AAC once; a second case holds that the scratch is gone on finish and on cancel.
- *The extraction* (`a sound that starts late in its container stays where it was`, item 2). A video whose sound starts 0.278 s after its
  picture is extracted, and the burst is where the container had it, in the WAV the studio opens and in the re-attached file. Red: `the
  burst in the WAV: 1.0214 s, expected 1.278 s`. A sound that starts with its picture extracts to the SAME bytes as before.
- *The strengths* (`the three denoise strengths are ordered by the noise they remove`, item 3). Pink and brown noise through the real
  chain at each strength, the removed level measured: Light < Medium < Aggressive. Red: `Light removes 8.7 dB, Medium 6.8 dB, Aggressive
  4.7 dB` (the table had `nf` the wrong way round).
- *The block after the cut* (`the cut stage hands the rest of the chain 4096-sample frames and changes no sample`, item 5).
  `ashowinfo` on the chain's graph: every frame after the cut is 4096 samples (the last may be short), a stage ahead of the cut sees 256,
  and a cut alone produces the same bytes with the stage as without. Red: `a frame after the cut that is not 4096 samples: 256 (of 1290)`.
- *The 9:16 file* (`a reframed clip is the clip the user built`, item 9). A graded clip is measurably graded (a brightened gray, a
  desaturated blue), Auto Zoom and Hype Shake move the picture, the whole recipe at once is one valid 1080x1920 square-pixel file of the
  clip's length, and a text overlay shows in its window on the clip's own clock (at 2x, in the half of the output it belongs to). The
  text case runs the `drawbox` stand-in on every build (the bundled linux 7.0.2 has no `drawtext`) and for real on 6.1.1. Red: `brightened
  gray 47,47,47 vs 47,47,47` (Reframe ignored the grade).
- *The output folder* (`an output folder that is gone is made again before anything is encoded`, item 10). Every runner against a folder
  that does not exist yet writes into it, and against one that cannot be made (a file where a parent should be) refuses in a sentence that
  names it with nothing written. Red: `expected 'ENOTDIR: not a directory, lstat ...' to be 'Couldn't create the folder "Clips". ...'`.

**Round 77 (T-127): the two new chain cases, and their first red.** Both ran on the bundled 7.0.2 and on 6.1.1 through the alias recipe,
with identical numbers.
- *The joins* (`fractional segments do not walk the picture off its sound across the joins`, item 4). Eight segments with fractional
  boundaries (each in the dark part of its second, so a flash is never cut in half) of a 25 fps source with a flash and a beep on the same
  instant every second, joined through the real `runConcat`; the picture-minus-sound lag is read at EVERY flash and the SERIES is judged
  (flat within 15 ms, none over 30). The T-125 (1) case above cuts whole seconds from a 30 fps source: every segment there is a whole
  number of frames, the one shape that cannot drift. Red without `-shortest`: `3 / 57 / 83 / 112 / 125 / 161 / 194 / 194 ms`
  (spread 191); green `3 / -3 / 7 / 0 / 0 / 0 / 0 / 0`.
- *The durationless streams* (`a durationless file still answers whether it has a picture`, item 10). Two short streamed WebMs (no length in
  the header: what MediaRecorder writes), sound alone and a picture with sound, through the probe and the real handler: `false` and `true`;
  and the existing 2 h durationless audio-only case now expects the audio remedy. Red with the extension deciding:
  `expected 'That file is longer than 2 hours...' to match /Split it into shorter files in another app/`, `expected null to be false`.

**Round 78 (T-128): the quit's wait, with a real SIGKILL.** One block, `a quit in the middle of a transcode or an extraction`, two cases; the
unit tests (`convertQuit.test.ts`, `extract.test.ts`) hold the same contract with a fake child and a slow unlink, and these run the real
child, the real `close` and the real removal. Each points `TMPDIR` at a folder of its own (`os.tmpdir()` is read at each call), so the scratch
folder holds only what the job made. Both ran green on the bundled 7.0.2 and on 6.1.1 through the alias recipe.
- *The transcode* (`a transcode killed by the quit sweep leaves no mp4 in the working-copy folder once the quit's wait is over`). A 30 s FLV
  goes through the real `convertForImport`; once `out_time` ticks (the partial mp4 is open and growing) `cancelAllConverts()` is what
  `before-quit` calls, `drainRuns(10 s)` is what it waits on, and the folder must then be empty and the rejection a `ConvertCancelledError`
  that says the quit did it (`byQuit`). Red on the round-77 bytes of `convert.ts`, both majors: `expected [ 'quit-import-HPWxPF99.mp4' ] to
  deeply equal []`.
- *The extraction* (`an extraction killed by the quit sweep leaves no scratch WAV once the quit's wait is over`). 50 minutes of silence in
  FLAC (a few KB; 0.58 GB of WAV if it ran to the end) through the real `extractAudioFromVideo`; once the WAV is past 2 MB and still under
  500 MB, `cancelAllExtractions()` and the same wait, and the folder must be empty and the end a cancel. Red on the round-77 bytes of
  `extract.ts` (three runs on the bundled binary, one on 6.1.1, every time): `the half-written WAV is gone: expected [ 'x2_85lzXVN.wav' ] to
  deeply equal []`. The wait is immediate when no run is open, so the unfixed code reads the folder before the killed child's `close` has
  removed anything.
- *Not here.* The recording's save convert and the sweep that must leave its raw take are main-process handler behavior over Electron's
  dialog and window, so they are a unit case over the real convert module (`recordingQuit.test.ts`) and an E2E (the window's X in the middle
  of the convert); no ffmpeg argument changed this round.

**Round 78 (T-129): the waveform's peaks, read in main, and the ceiling's two cases flipped.** All on the bundled 7.0.2 and on 6.1.1
through the alias recipe.
- *The peaks* (`the waveform is read from a stream of the sound in main, into the right buckets at the right heights`, 4 cases). A 20 s,
  48 kHz STEREO file (the shape extraction writes) with 250 Hz bursts of 0.5 at 5.0-6.0 s and 0.25 at 12.0-12.5 s through the real
  `readPeaks`: inside each burst every bucket's top and bottom are the burst's height (within -6 / +4 %, so neither halved nor doubled by the
  downmix), its first and last bucket over half height are its start and end to one 5 ms bucket, the silence 30 ms clear of it is flat, and
  progress rises to 100. A 2 h 5 min file (8 kHz u8, 60 MB, two seconds to write; 120 MB of PCM through the job) is 4000 pairs drawn the
  whole length, and this process grows under 60 MB while it runs (measured +1.5 to +29 MB over the runs on both majors; a job that keeps
  the chunks grows +116 to +123 MB, both majors). A WAV with an unknown format tag (ffprobe reads it, no decoder does: exit 234) is `WAVEFORM_READ_FAILED`. Cancel kills the real
  ffmpeg mid-read: the job answers at once and no decoder is left (`pgrep`). Reds, each on both majors: the bucket time x1.05, `-ac 2`, an
  unsigned read, ffmpeg's stderr as the message, Cancel without the kill, no final 100 (7.0.2), the chunks kept.
- *The ceiling's cases, flipped* (the T-126 (7), (8) block). `an audio-only mkv over two hours is extracted` (a full-length 2 h 1 s WAV,
  no picture) and `a durationless file longer than two hours is extracted too` (kept for the studio); each removes its own ~1.4 GB WAV.
  Red on the round-77 handler, both majors: `That file is longer than 2 hours, ... Split it into shorter files in another app`.

**Round 79 (T-130): the rate, the thumbnail's crop and the margins.** Both majors: the bundled 7.0.2 ran the whole file green (295 passed | 13
skipped of 308); the distro's 6.1.1, through the alias recipe above, ran the whole file with exactly the seven failures written for the bundled
binary (the four `KNOWN linux-binary gap` drawtext pins, the GIF frame rate read `25/2`, the `ansi` text file, mpegts) and nothing else
(288 passed | 7 failed | 13 skipped).
- *The rate* (`the compilation follows the source's frame rate, up to 60`). Flash-and-beep sources at 60, 60000/1001 and 120 fps; a
  compilation of two 3 s ranges is judged on the clock (six flashes on 0..5 s, each on its beep within 30 ms, 360 frames) and on the
  container's own rate, which is an EXACT string (`60/1`, `60000/1001`) where the average over a join gets a quarter of a percent (a join
  stamps whole milliseconds: a 24 fps join reads `32000/1333` on 7.0.2, which the older mismatched-source case now allows for). Also a 24 fps
  source that stays 24, a Record take whose container says 1000/1 (the probe's "no rate") that falls back to 30 and NOT to the cap, and
  YouTube 1080p60 from a 60 fps source and from a 30 fps one (a 60 fps file either way: the preset's rate is the fps stage's). The preset loop
  (`%s preset produces upload-ready mp4`) now reads each file's `avg_frame_rate` against its preset's `fps`.
- *The thumbnail* (`a Clip Kit thumbnail is the clip's cropped picture`). A red frame with a blue square outside a green strip carrying a white
  square: the control (no crop) is the whole frame, the cropped thumbnail is exactly the strip's size with no red and no blue and the white
  square where the crop puts it, the three kit moments, odd edges, and an odd-sized (1919x1079) source. The pixel reader leaves `-ss` off for
  a still image: `-ss 0 -i x.jpg` decodes no frame on either major, and a count of zero from a reader that read nothing passes every
  "no red" assertion (the control caught it: `expected 0 to be greater than 100000`; LESSONS_LEARNED, 2026-10-23).
- *The margins* (`T-130 (an)`, in the T-51 block, `win32`-gated like the rest of it). Run here by the T-111 recipe on 6.1.1 (the scratch copy
  of the file with those gates lifted and a working directory holding `C:/Windows/Fonts/arialbd.ttf`, here Liberation Sans Bold, Arial's
  metrics): the 9:16 case measures, for each corner, that the rows above the box's border are the flat value to the pixel (the platform's
  header), the rows below it likewise (the caption), the handle's own half of the band carries glyphs and the dark box and the other half is
  flat; the landscape case that the last ten rows are flat and the box reaches 12 px from the edge. Green, with the preflight and the T-51
  corner case beside them. The bundled linux 7.0.2 has no `drawtext`, so on that major the margins are the unit pins on the filter string.
- *An older case, adapted.* The T-127 (4) fixture's segment starts (1.37, 7.23 ...) put the first flash of a segment between two frames, and
  a picture can only show it on a frame: with the compilation at the source's 25 fps (40 ms) instead of 30 (33 ms) the series read
  `10 / -10 / 20 / 20 / 20 / 0 / 0 / 20` ms with a correct join, which is rounding, not drift. The starts are now on the 25 fps grid (1.36,
  7.24, 12.32, 17.48, 22.88, 27.4, 31.2, 35.28) and the ends still are not, so the lengths stay a fraction of a frame; the 15 ms bound is
  unchanged. Red without `-shortest`, on the new fixture: `0 / 10 / 30 / 60 / 80 / 110 / 130 / 130 ms`.

**Round 79 (T-131): `-shortest` was half of the T-127 (4) fix, and its fixture could not tell.** Three blocks, run on the bundled 7.0.2 and on
6.1.1 through the alias recipe, with the same numbers on both.
- *The compilation* (`a compilation survives a source whose sound does not cover a segment`, item 1; 8 cases). A source whose sound ends
  mid-segment, a range wholly past the sound's end (alone and in the middle of the list), the straddle in a list with fades, a sound that
  starts late, a WebM whose microphone drops at 5 s of 12, a range the PICTURE does not reach (an error in a sentence, no file, no scratch),
  and the two ffmpeg messages the fail-loud guards match, run against the real binary (ffmpeg exits 0 after "Output file is empty" and after
  "Impossible to open": the unit tests fake the exit, so only this case knows the wording is still ffmpeg's). `the sweep-17 replication` (2
  cases) is the expediter's own harness through production `runConcat`: a 10 s test picture with 6 s of sine, `[1,3] [7,9] [2,4]` and
  `[1,3] [5,8] [2,4]`. Red on the true pre-fix bytes (the pad removed, the conditional `-af` restored, both exit-0 guards off):
  `the picture of the three clips: 2 s, expected 6 s` and `5.014 s, expected 7 s`. The T-127 (4) drift series above was re-run on the fixed
  tree and stays flat (`3 / -3 / 7 / 0 / 0 / 0 / 0 / 0`); a bare `apad` brings it back on 6.1.1 (`3 / 57 / ... / 194`) and hangs `-c:v copy`
  on 7.0.2, which is why the bare form is held by the unit pins and not run here.
- *Re-attach and picture-in-picture* (`a sound shorter than the picture does not shorten the file`, item 2; 10 cases). The stream-copy
  branch, the VP8 WebM re-encode, the whole flow (extract, clean, put back), a cut, a sound LONGER than the picture still cut at it, and
  picture-in-picture over a 5-of-12 base, over the mic-drop WebM, under a 20 s overlay and over a base with no sound at all (no audio stream
  appears). Red: `copy: the container's length: expected 5 to be greater than 11.8`, picture-in-picture `expected 5.014 to be greater than
  11.8` (5.013 on 6.1.1); no `-shortest` turns the controls red (`15 s, expected 12 s`).
- *The same compilation through the button* (video-pipelines.spec.ts, `Compile keeps every clip of a source whose sound ends before its
  picture`): an 8 s picture with 3 s of sound, three clips set through a project file, one press of the Compile button, and the file is 5.0 s.
  Red on the pre-fix bytes: 1.5 s under a "Saved" toast.

**Round 81 (T-132): an exit code is not a verdict, for the siblings too.** One block (`a clip with no picture is an error in a sentence, not
a file that says Exported`, item 4; 9 cases) and two cases in the T-131 (1) block (item 12), run on the bundled 7.0.2 and on 6.1.1 through the
alias recipe with the same results. Two fixtures: a 5 s picture with 5 s of sound, and a 5 s picture with 9 s of sound. A range past the end of
the first exits 0 with a 261-byte file with no streams and "Output file is empty"; a range past the last frame of the second exits 0 with an
**audio-only mp4 and no such line** (measured on both majors: the ticket's direction, the sticky stderr line alone, cannot see it). What both
print is the last `-progress` block's `frame=0`, so the runners read both. The cases: the control (a normal clip); past the end of the file;
past the last frame with the sound running on; a straddle (the picture that is there is written); a **20 ms and a 10 ms clip** (a legitimate
short clip is two frames through the production `fps=30` stage and stays a success: a guard that calls fewer than 3 frames empty turns these
red, one that calls fewer than 2 survives them, which is why the comparison is on 3); Reframe's four cases; `extractFrame` past the end and
inside; and what each binary prints for each shape (the empty-output line for the stub only, `frame=0` for both). Every failure case also
asserts the folder is empty: the stub and the audio-only mp4 are the job's wreckage. Red on the old behavior (exit 0 alone restored in each
runner, both majors): `expected undefined to be 'The clip "Boss fight" has no picture ...'`. In the T-131 (1) block, the empty-clip
sentence now names the clip by its name (`'The clip "b" ...'`), and a new case builds a real join with a stub segment named
`seg-<job>-<n>.mkv` and checks `unreadableSegmentIndex` reads the index off the real "Impossible to open" line.

**Round 82 (T-133): the burn-in was the one ranged video writer left out.** One block (`a ranged caption burn-in of a range with no picture is an
error in a sentence, not "Captions burned in"`, item 4; 7 cases) on the bundled 7.0.2 and on 6.1.1 through the alias recipe with the same results.
Measured on both binaries with the burn-in's own command (the `subtitles` stage and without it, `-c:a copy`, `-fps_mode vfr`): a range past the
picture exits 0, prints nothing to stderr, reports `frame=0` in its last progress block and writes an audio-only mp4 (the stub shape is not produced
by this command; the unit file `burnInNoPicture.test.ts` holds it). The cases, over the same two fixtures as the T-132 block (a 5 s picture with 5 s
of sound; a 5 s picture with 9 s): the control with its cue; past the end of the file; past the last frame with the sound running on, with a cue in
the range and with none (no subtitle stage); a straddle; a 20 ms and a 10 ms range (one frame, still a success); and a whole-video burn. Every
failure case asserts the folder is empty and no shifted SRT is left beside the transcript. Red on the old behavior (exit 0 alone restored, both
majors): `expected undefined to be 'This part of the video has no picture ...'`; the "progress count ignored" and "frames <= 1 is empty" mutants are
red on both. The linux 7.0.2 has no `drawtext`, which the burn-in does not use, and both binaries have `subtitles`: no platform gate. A GIF of such a range
already fails (exit 234 on both majors, measured), so it needs no case.

**Round 84 (T-135): two audio exports that said the wrong thing, pinned on both majors.** Two blocks, 15 cases in all (`T-135 (12)`: 9, `T-135 (11)`: 6), on the
bundled 7.0.2 (`npm run test:media`: 352 passed, 13 skipped of 365) and on 6.1.1 through the alias recipe (15 passed). The first pins the exit-0-empty shape the
guard exists for (the unguarded cut chain exits 0 and writes a 78-byte WAV, about 257 bytes of AAC and about 620 of MP3, measured on both majors) and then that
`exportAudio` refuses before the first child when the kept length is under 0.05 s (before the loudness pass's whole minutes too, with a second track in the mix,
and for Re-attach, which leaves no mp4 and no intermediate WAV), that 0.04 s kept is refused while 0.2 s kept writes a real file with that much sound in it, and
that a middle cut and no cut at all export as before. The second pins that a `[1:a]` reference to a file with no sound exits non-zero with "matches no streams"
(the late failure that blamed the primary file), that `runAudioExport` refuses at once with the second-track sentence (no progress events, no file; the
single-pass mix and Re-attach the same), that a second track WITH sound and a streamed WebM whose header has no length still export (the probe not reading a
length is not a refusal), and that a second track that is not there is still the missing-file failure it always was, now said before the measure pass. The
guards run before any command is built, so no filter graph changed; the blocks are red on the unchanged product code on both majors and the mutations
(the guard removed, the floored length used, the line moved, any probe failure refused) are red on both.

**Round 83 (T-134): the claim about a compilation's segments, pinned.** One case added to the T-132 (4) block (now 10; `a compilation segment past the
last frame of a 5 s picture with 9 s of sound is a streamless stub AND the empty-output line, so the line alone is enough`), on the bundled 7.0.2 and on
6.1.1 through the alias recipe with the same results. It pins what three parties measured and changes no ffmpeg command: the segment written with the
production filters (`buildSegmentFilters`), codecs and `-shortest`, over the block's `longaudio` fixture (a 5 s picture with 9 s of sound) at 6 to 8 s, is a
file under a kilobyte that ffprobe cannot read (exit 1, no streams) and ffmpeg prints "Output file is empty"; and `runConcat` over the same source in a
list names the clip and leaves the folder empty. That is why `concat.ts` can read the stderr line alone where Export, Reframe and the burn-in need the frame
count. Red on the finished code, by content-replace: `-shortest` off the segment command (`expected undefined to be 'The clip "b" has no picture ...'`: the
run no longer fails), the stderr read removed (the join's own sentence, "The compilation could not be put together ..."), and `apad` off the segment sound
(`ffmpeg exit 234`); the first two on both majors.

**Per-platform cases.** ffmpeg-static ships binaries from different
upstream builders per platform, so some evidence is only obtainable
where the product ships. Two capability gaps are gated here today: the
linux binary SIGSEGVs on mpegts input, and it has no `drawtext` filter
at all, which is the only filter a watermark or a text overlay
produces. Both follow the same shape — `it.skipIf(process.platform
!== 'win32')` positives, plus a **linux pin that fails the moment the
capability appears**, so an ffmpeg-static upgrade forces the gate to be
lifted instead of leaving dead coverage behind.

T-85's Clip Kit case has the same two halves, driven through the job the
kit REALLY builds (`buildKitQueue`, imported from the renderer — the module
is pure): a win32 positive that the saved corner is painted and a kit with no
saved watermark stays flat, and a linux pin in which the same kit job fails at
`drawtext` WITH the watermark and encodes a 1080p file WITHOUT it — two jobs
that differ in exactly one field, so a kit that drops the watermark fails the
first assertion.

A gated positive is not the only option, though: where what is under
test is an ARGUMENT rather than the filter itself, a stand-in runs
everywhere. T-74's `exportWithDrawboxStandIn` drives the real
`runExportJob` with `drawtext` swapped for `drawbox` — same `enable`
expression byte for byte, same x/y and colour, same `-ss`-before-`-i`
command — so the clip-relative overlay window is proven on the linux
binary that has no drawtext at all. Substitute the NAME, never the
argument under test, or the test stops being about the product.

The release workflow
(windows-latest, the de facto Windows CI — see the 2026-08-15 lesson)
runs `npm run test:media` after `verify`, which is where those gated
tests actually execute; nothing else in the project runs them.

**The release run's hand-checks** (what no test here can reach, so the person cutting a release looks):
- **The shipped binary's network silence (T-127 (1)).** Launch the portable exe on Windows with `--log-net-log=<file>` and leave it idle
  for 30 s, then read the log for `URL_REQUEST_START_JOB` events with an http(s) address, and for DNS lookups of any host but this
  machine: there are none. The mechanism (`app.configureHostResolver`, `session.setSpellCheckerLanguages([])`) is platform-independent and
  the proof run was on Linux (smoke.spec.ts); this confirms it on win32, where Electron downloads its dictionary the same way.
  **Allowed (T-131 (12)):** on a machine with a proxy configured, Windows may resolve `wpad` (the proxy auto-detection host) or the proxy
  host itself. That lookup is the OS working out how to reach a network, belongs to no request imagii made, and is not a finding; a
  lookup of any OTHER name is, and so is any `URL_REQUEST_START_JOB` with an http(s), ws or ftp address.
- **Inter's license in the packaged tree (T-131 (18)).** In the unpacked portable (or a `electron-builder --win --dir` output):
  `resources/licenses/Inter-OFL.txt` exists, begins "Copyright 2016 The Inter Project Authors" and is the SIL Open Font License, and
  `resources/app.asar` lists no `@fontsource` entry (the woff2 files are in the renderer bundle; the license travels beside the app).
  The probe on the Linux box reached `extraResources` before electron-builder stopped at the rcedit step ("wine is required"), so the
  copy is shown there and the real portable exe is what this line confirms.
- **The shipped binary on a Windows shutdown or logoff (T-131 (17), ledger (az)).** Electron emits no `before-quit` for it, so the
  quit autosave flush, the T-127 (3) drain and the kill do not run on that one exit path. Nothing in the suite can reach it; if a
  `session-end` handler is ever added (a synchronous best-effort kill-and-unlink), this is where it is checked.
- **A window minimized during a take** (T-120): the webcam composite keeps drawing (no window manager exists on the test box).

**Adding a case.** Generate sources in `beforeAll` with lavfi
(`testsrc2`, `sine`, `anoisesrc`), drive the real exported function, and
assert with `ffprobeJson`/`measureLufs`/`bandMeanVolume` helpers already
in the spec.

**Assert content at an offset, not just lengths.** Round 49's two bugs
(T-81 captions, T-82 re-attach after a cut) each produced a valid file of
a plausible length that was wrong only away from the origin, and T-82's
`-shortest` made the video and audio durations EQUAL on the bug, so a
duration check passed it. The fixtures that catch this are
self-describing ones: the flat-gray source (an untouched region is exactly
flat, so "is a caption painted at this instant" is a luma-spread read of
0 vs > 100) and the ramp (every frame's luma is 12 x its own source
second, plus one loud audio burst, so "which part of the source is under
this sound" is arithmetic). Cut at an offset, never from 0.

**Measure the LENGTH of each stream and where a known sound lands, not just that the file plays (T-105).**
A compiled clip at 2x with its audio left at 1x is a valid file of a plausible length, and a stretched Auto Zoom clip is a
valid file 20% too long: both passed every dimension and codec check for as long as they existed. Round 59's block reads each
stream's own duration, the ramp fixture's picture clock (luma = 12 x its source second), and where its 1.5 s audio burst lands
in the output — `atempo` keeps the pitch, so the burst's position IS the tempo — through 2x, 4x (two atempo stages), 0.5x and
0.25x, and each case sits beside a plain 1x clip so a join that drifts shows up in the total. Grade, zoom and shake use one
fixture each whose every pixel is known (a dark-gray half beside a blue half; a black frame with one white square) and a
control segment in the same file. When a stage needs `drawtext`, the T-74 drawbox stand-in is generalized to `runConcat` and a
linux pin proves the overlay reached the real runner's graph.

**Run the same job three times with DIFFERENT content under one name, and hash the earlier files (T-106).** An export that
replaces its predecessor is a valid file in the right place, and if the second run's bytes equal the first's a silent overwrite
leaves no trace. Each case moves the part of the source it cuts (or a margin, or a speed) so the runs differ, asserts
`x`, `x (2)`, `x (3)` for the names, and that each earlier file's sha256 is unchanged after every later run. The same block has
the case that made the bug matter: a CANCELED second job beside a finished export of the same name — T-100 removes what a
canceled job was writing, and the "file it was writing" used to be the earlier export.

**Measure a level on both sides of the moment something leaves, and a size across shapes (T-111).** Every mix fixture was as long
as its music bed, so `amix` never had to say what happens to the survivor; the voice stepped up 6 dB the moment a shorter bed
ended and nothing measured it. Round 61's fixtures: a steady 300 Hz voice under a 3 kHz bed that stops at 3 s, the voice's OWN
band read through a bandpass 1 s before and 0.3 s after, for the manual, ducked, +6 dB and match-loudness mixes (red-first: -30.1
to -24.1 dB, and 4.7 dB under match-loudness), plus a hot pair that must be limited and a quiet mix that must not be re-leveled
(the limiter's default raises its output; the test pins the exact upmix level). A caption's size is read off real frames: the white
of the glyphs boxed on mid-gray frames of four shapes, the box's height over the frame's WIDTH equal within 10%, the default on a
vertical clip one short line, the margin as high as on landscape; the same cases ran on the bundled 7.0.2 and on 6.1.1. A wmv2
file generated in-test is re-attached and every frame of the result decoded with nothing on stderr.

**An odd size, and a cue against a sound (T-113).** Round 63's two real-media blocks. A fixture an encoder will not make by itself: lavfi
sources round a yuv420p picture to even, so the 321x241 VP9 and VP8 webms are made with a `scale` after the source (the odd size is
`ffprobe`d before it is used), and re-attached; the old command died with `width not divisible by 2 ... exit 187` on all three cases
(plain, VP8, and with a cut). The kit's captions are proved against the thing they describe: the REAL export the kit's own job
describes of the ramp source, whose loud burst is at 10.0-11.5 s of its source, and the loudness of the kit's file read at the moment
the shifted cue starts (-22 dB during the cue, -56 dB 0.6 s before it; thresholds -30 and -45), at 2x, 0.5x and 1x — a cue left on the
source clock starts at 10 s, past the end of a 3-second file. Mutation: the division by the speed removed -> `expected 2 to be close to 1`.

**An odd size through every command that encodes a source, silence through a two-pass measurement, and a font that has to
reach a picture (T-114).** Round 64's Layer 5 blocks, each of which exists because the first fix stopped at the surface its
author pictured. The odd-sized fixture is a flat-gray 321x241 VP9 webm (a lavfi source rounds to even by itself, so the odd
size is made by a `scale` after it and `ffprobe`d before it is used), through the recording's convert, the importer's, the
burn-in with a cue (the caption's glyphs in the bottom band, the top band flat) and with none, and the PiP composite (the
overlay's color at its center, the base's elsewhere), each beside an even-sized control: red-first `exit 187` five times
and the controls green. The silent input is `anullsrc`, and its test starts by asserting that pass 1 prints `-inf` — the
trap must be in the fixture or a green run is no evidence — then exports and reads the output back as silence of the
same length (red-first `FFmpeg exit 222`). The font pair measures a WIDTH (ten lowercase i's are about 2.7x as wide in a
monospaced face), compares the same font twice for EXACT equality (an unknown, an empty and a hostile string are Arial,
so their widths are Arial's to the pixel), and exports each of the six to catch a wrong file name. **Audit the class when
the ticket names one member:** `grep -n libx264 src/main` is a five-line list of the commands that encode a source, and the
test that matters is one case per line of it.

**Test a stage that "loses one pixel" with the hardest edge there is, and a progress number with a length you control (T-115).**
Round 65's Layer 5 blocks. The even-size stage had to lose a pixel and was a `scale`, which resamples the picture to do it (hard in the four corners, soft along every edge's middle and through the center); the odd-size
cases from round 64 only read the OUTPUT SIZE, which a scale and a crop share, so they were green on both. A one-pixel checkerboard
(a lossless VP9 fixture, made at its size by a `crop` with `exact=1` because `crop` rounds a yuv420p size to even by itself, and
checked to be a hard checkerboard BEFORE the convert) is the test that separates them. Under the scale the three sampled rows (7, 100
and 233) had 70, 320 and 67 pixels in the mid-gray band strictly between 80 and 175 (the suite's own `hardness` count, exclusive bounds): row 7 was hard toward its two corners and soft in the middle (a middle of
120-143), row 100 had no black or white pixel at all; through the crop, none in any of the three, and an even-sized control proves the
encoder is not what softens it. **A size assertion cannot see resampling; sample pixels.** The convert's progress is tested with the real binary
and a length the test chooses: the right length ends the bar at 90-99, twice the length puts the same encode at about half, a
shorter-than-the-file length pins at 99, and no length reports no percent at all - four runs of a six-second webm that take well
under a second each. The fake-child unit cases (`convertCancel.test.ts`) feed ffmpeg's real `-progress` text; the real run is what
shows `out_time` is the position in the OUTPUT.

**A matrix-blind fixture cannot see a matrix bug, and a pass on one binary says nothing about the other (T-118).** `colorbalance` came
back from its RGB round trip in the bt601 matrix on 6.1.1 (the shipped win32 major) and kept the matrix and the tag on the bundled linux
7.0.2, so a bt709-tagged source (OBS's default) was re-encoded wrong on exactly one of them; every grade fixture before it was a neutral
gray, which is the same in every matrix. The fixture is four SATURATED bands (green, red, blue, a gray) converted with
`scale=out_color_matrix=bt709` and tagged bt709 (checked first: `ffprobe` says bt709, `probeVideo` carries it, the bands decode to the
colors they were drawn as), and the output is read the way a player reads it, `scale=in_color_matrix=bt709,format=rgb24`, against the
same job without a grade, through BOTH graded runners (the export Clip Kit shares, and a compilation segment). The grade used is a cast
of 0.01, so what is measured is the matrix and not the warmth; a full warm grade is checked on the gray band to prove the stage does
not undo it, and an untagged source gets the same comparison with a bt601 decode to prove the skip. **This block passes on the bundled
7.0.2 with or without the fix** (run once with the stage removed: 5 of 5 green), so it can only be red on a 6.1.1 binary: through the
alias recipe above, with the stage removed, the green band decoded `(0,130,0)` against the control's `(0,157,0)` (delta 27, limit 4)
and the output's `color_space` was missing, on both runners. With the stage as first written (`scale=out_color_matrix=bt709` alone)
the pixels come back and the tag does not, which is why `setparams=colorspace=bt709` follows it. What fails on every machine is the
unit pair (`filters.test.ts` for the builder, `gradeMatrix.test.ts` for the wiring from each runner: dropping the probe's value from
`runExportJob` or from `runConcat` turns exactly that runner's case red), and the win32 release run is the standing check on the real
binary.

**The second half of the same block: a source tagged bt601, and a skip that has to be true (T-119).** `smpte170m` and `bt470bg` (OBS's
Rec.601 profile, SD captures) lost their tag through `colorbalance` on 6.1.1 the same way, and every built-in preset is at least 1280 px on its long side, where a
player that guesses reads an untagged file as bt709. Their pixels were never wrong (swscale reads and writes bt601 by default), so the
stage is the tag alone, `setparams=colorspace=<tag>`. Two fixtures keyed to the 601 matrix and tagged (checked first, as the bt709 one is),
each tag through the export and a compilation segment at a cast of 0.01 against the ungraded control under a 601 decode, with the tag
asserted on the output, and a full warm grade on the gray band. Through the alias recipe on 6.1.1: the stage as shipped, 12 of 12
green; the bt601 branch removed, 5 failed (`the graded output is still tagged smpte170m: expected undefined to be 'smpte170m'`, the
`bt470bg` twin on both runners, and the warm grade); the whole stage removed, 8 failed (round 68's three plus those five); the bt709 recipe
given to a bt601 source instead of the tag alone, 4 failed on the PIXELS (`green graded 11,184,3 vs control 0,158,0`), which is the run that
settles why the stage is the tag alone. On the bundled 7.0.2 the block is 12 of 12 green with the branch and without it, by design. **The
tolerance is the suite's, not a hand fixture's:** the pixels are within 3 levels of the control on both majors (a soft assertion at 2 names
every band: bt709 reads red 199,42,42 against 202,45,45, blue 38,54,195 against 40,56,197, gray 122,124,124 against 124,126,126; the bt601 tags and the untagged fixture read red 204,45,46 against 205,46,47, blue 40,57,198 against 43,58,200, gray 125 against 128), where the first draft of the stage's
comment said 2 for bt709 and 1 for bt601 from a one-off fixture. **A skip is a claim, and its reason has to be true of what it skips:**
untagged is skipped because the round trip is symmetric, and the sentence that said "players assume bt601" was wrong at HD.

**A stage's comment names its job, and the job has to be a test that can fail (T-120).** Round 68's `scale=out_color_matrix=bt709` was
described as the half that restores the pixels of a graded bt709 source, and round 69 measured that a retag alone restores them and the
tag (a graded `bt2020nc` source reads `(0,153,0)` against the control's `(0,155,0)` with only the tag put back). The `scale`'s real job is
a clip that also has Auto Zoom on: `zoompan` drops the tag, a frame still in RGB at that point is converted afterwards as an untagged one,
and the retag-only graph reads green `(0,133,0)` against `(0,157,0)`. The new pair in the T-118 block (a bt709 source with a grade AND Auto
Zoom, through the export Clip Kit shares and through a compilation segment, every band against the Auto Zoom control under a bt709 decode)
is the only thing that fails when the `scale` goes. Through the alias recipe on 6.1.1 (the config prints `/usr/bin/ffmpeg | ffmpeg version
6.1.1-3ubuntu5` for the resolver, and the bundled `7.0.2-static` under the repo's own config): the stage as shipped, `14 passed`; the
`scale` dropped (`setparams` alone), `2 failed | 12 passed`, `green graded 0,133,0 vs control 0,157,0: expected 24 to be less than or equal
to 4` on both runners. On the bundled 7.0.2 the same mutation is green, by design. The upgrade recipe for the other matrices uses the
constant both majors accept: 7.0.2 refuses `bt2020nc` and `bt470bg` as `out_color_matrix` values (`Undefined constant or missing '(' in 'bt2020nc'`) and takes `bt2020`.

**Make the fixture the shape of the file that broke, and check the shape before judging on it (T-120).** Chromium's MediaRecorder writes a
streamed WebM: no duration in the header (`ffprobe` prints `N/A`), a container rate of `1000/1` with `avg_frame_rate` `0/0` (its clock ticks
in milliseconds), packets at irregular millisecond times. A fixture encoded to a file, with a duration and a steady rate, cannot fail any
of the three bugs that shape caused (a save that left the take without a duration, a convert that wrote one frame per millisecond, a probe
that read 1000 fps), and every unit test around them was green. The block in `media.spec.ts` encodes VP9 and VP8 to a PIPE, with
`-enc_time_base 1:1000` and a `setts` jitter, and overwrites the muxer's DefaultDuration element with an EBML Void of the same length (both
majors write it, element `23 E3 83`, and the unpatched pipe output reads `30/1` on both: the patch is what makes the file read `1000/1`, and it is needed
on both, T-122 corrected "7.0.2 does not write it"); each fixture is asserted to have that shape first.
The cases run the production `remuxWebm`, `convertToMp4` and `probeVideo`: the remux has a duration, every packet and a probe the studio
accepts (fps reads 0, the container still says `1000/1`: a stream copy cannot carry a rate, so `probedFps` treats a rate above 240 as
unknown); the convert has the frames the take has (90 for the 3 s fixture, where it wrote 2980) and a sane rate; and flv, wmv and mpg
sources at 25 fps keep exactly 50 frames in 2 s (the importer shares the argv). Red-first, one change at a time: the remux writing a live
stream, the convert without `-fps_mode vfr`, the convert forced to 1000 fps and the ceiling widened each fail their own case.

**Close the class, not the argv, and keep a fixture as long as the question (T-121).** T-120's remux sent the same `1000/1` file to three more libx264 commands than the convert it had fixed. The cases are the same fixtures (VP9 and VP8, the T-120 block), one per command: the caption burn-in and the PiP composite read an average rate between 20 and 60 and 75 to 105 frames for the 3 s take (`avg_frame_rate 1000/1: expected 1000 to be less than 60` unfixed), and `runAudioMux` with a 1 s cut keeps a picture within 0.35 s of the 2 s of sound (`video 0.058 s: expected 0.058 to be greater than 1.65`). Two traps the cases had to avoid: a silent take shorter than its overlay runs to the overlay's length with a frozen last frame (T-110 (ac)), so the PiP overlay is generated at the take's length (a 6 s overlay read 181 frames in 5.968 s on the FIXED argv); and a retime by a sum over the cuts counts an overlap twice, so a second case on the 24 fps ramp hands out overlapping cuts out of order (source 10 s must land at output 5 s under the sound's burst; `video duration 13.958984: expected 13.958984 to be greater than 14.75` with the merge removed). Each of the three fixes was removed alone and turned exactly its own cases red. The whole cut / re-attach / burn-in / PiP / MediaRecorder family (59 cases then) was run on the bundled 7.0.2 and on the distro's 6.1.1 through the alias recipe above before the timestamp retime was kept, because "every pinned case stays green" was the condition for it.

**A defect that lives on the shipped major needs the shipped major in the room, and a unit pin for the box that cannot show it (T-122).** The cut re-attach's retimed stamps were exact on the bundled 7.0.2 and rounded onto the frame grid on 6.1.1, the major the Windows exe ships (a constant-rate source got an encoder time base of `1/fps`): on the 24 fps ramp with cuts 3.3-5.7 s and 8.0-9.2 s, ffprobe read `pts_time` `3.291667` twice (`non-strictly-monotonic PTS` on stderr). Every Layer 5 case was green on 7.0.2 because 7.0.2 keeps the graph's own time base either way. The new cases ("a cut that is not a whole number of frames long keeps every survivor on its own timestamp", the T-82 block: the ramp, and a generated 30 fps source with three cuts) compare EVERY output packet with where its source frame belongs, to 1 ms (a duplicate check first, so the failure names the stamp), with the expectation read from the source's own packets and not assumed from `k / fps` (the frame count of a fixture depends on the ffmpeg that made it), and with the tail allowed to lose a frame or two to `-shortest` and the middle not. They **cannot go red on 7.0.2**: the same unfixed bytes ran green there. The red is the 6.1.1 run through the alias recipe above (`the 24 fps ramp: pts_time written twice: 3.291667`; `the 30 fps source: packet 32 is at 1.100000 s, 16.7 ms from where its frame belongs`), green with `-enc_time_base:v filter` on both majors; `muxCodec.test.ts` pins the option beside `-fps_mode passthrough` on every re-encode so a box with only 7.0.2 reds too. Say in the case which run is the red. The cut / re-attach / audio-chain mux / MediaRecorder family (55 cases) was run on both majors before the option was kept. Two smaller traps: the OUTPUT's `r_frame_rate` after a cut reads `120/1` (the survivors are no longer evenly spaced), so a rate check belongs on the fixture; and the fixture recipe's Matroska `DefaultDuration` is written by BOTH majors (an earlier note here said 7.0.2 does not), so the Void patch is needed on both.

**Measure a transform's pivot and a control's whole range (T-109).** Auto Zoom grew out of the top-left corner for as long as it
existed, and the Temperature slider moved only the shadows: both produced valid files of the right size and length, and the
fixtures that existed were chosen where the filter happened to work (a centered marker, a dark half). Round 60's cases use the
frame the feature is FOR: a centered marker must stay centered while it grows AND an off-center one must move away from the middle
by exactly the zoom the same run measured (expected positions derived from the geometry, never from the expression under test);
a mid-gray half beside a light-gray half, with no shadows in sight, must go warmer or cooler on both. Red-first against the HEAD
filter: the marker at (663.5, 373) against (640, 360), and a 0x80 half at 125,125,125 against its control's 128,128,128.

**Assert what an output LEFT OUT, with the control beside it (T-96).** Round 57's
Compile and GIF both ignored a clip's crop and produced a file that was the right size,
length and codec, so none of the dimension or duration checks that were already there could
see it. The fixture carries a RED block that every crop excludes and a white square at every
crop's centre; the output is decoded and three pixel facts are read (no red at all, a square
marker, the hand-derived size), and the same call UNcropped sits beside it in the same test
and must still contain the red. A test that asserts only the absence passes when the marker was
never visible. When several runners share one rule (`cropToFrame` has three callers) mutate
each path alone: dropping the stage from Compile alone must fail the Compile cases and leave
the GIF ones green, and the reverse.

**Kill a real encode, then look at the folder (T-100), and cancel inside the
probe (T-98).** A fake child cannot leave a half-written MP4, and a cancel test
that clicks "near" a 40 ms window passes for years. Round 58's block in
`media.spec.ts` starts the real runner on a 60 s 1080p source, waits for the file
ffmpeg opened (so the kill lands mid-write, a fact and not a hope), SIGKILLs it
through the runner's own cancel function and asserts three things: the rejection
is the T-84 sentinel, the half-written file is gone, and the finished job beside
it is untouched and probes as a real video. A file that predates the job is left
alone by a cancel that lands before ffmpeg opens its output. The T-98 half issues
the cancel in the same tick as the call, so the real ffprobe is certainly still
in flight: the job is refused, nothing is written, and the next job of the same
name runs (a stale click must not mark it). Written red-first against HEAD: 14 of
14 failed (`the half-written export is gone: expected true to be false`).

**A stretch passes every container check — measure a shape whose truth you
know.** Round 50's T-83 shipped a manual crop squeezed 2-3x on one axis
inside files whose dimensions, codec, SAR and duration were all correct, so
nothing ffprobe can say would have caught it. The fixture is a black frame
carrying one white SQUARE; the export is decoded whole and the square's
bounding box is measured from the pixels (square within 3%, the hand-derived
scale, centered). Two rules: derive the expected scale from the geometry of
the request ("the crop's full height maps onto 1920 px"), never from the
filter string under test; and keep a control whose shape already matches the
preset, so a fix that over-crops cannot pass.

---

## Layer 3: emoji guard (`scripts/check-emoji.mjs`)

**Run with:** `npm run check:emoji` (wraps into `verify`).

**What it covers.** Source files of four types (`.ts`, `.tsx`, `.html`, `.css`) under every
directory of `src/` (`src/renderer`, `src/main`, `src/shared` and `src/preload`) are scanned for
emoji + pictograph glyphs. `tests/unit/emojiGuard.test.ts` reads the script's
`ROOTS` and `EXTENSIONS` and fails when a directory of `src/` is not listed or a file of a type
the script does not read appears under it, and runs the script itself from a scratch tree with
one emoji under each root, and one in the page and the stylesheet (it must exit 1 and
name the file), plus a clean control and a test file that is allowed to carry one
(T-122: `src/preload` was the one directory left off; T-123: `.html` and `.css` were never read, and an
emoji in `src/renderer/index.html` passed with every gate silent). What it does not read is everything
outside `src/`: the docs, the scripts, the tests and the README. Two
typographic glyphs are allowlisted (`✕`, `✓`); everything else fails
the build. Test files are excluded because they legitimately contain
emoji fixtures to prove the app strips them.

**Why it exists.** `docs/STYLE_GUIDE.md` requires every icon to come
from `<Icon name="…" />` — emoji render inconsistently across OSes
and themes. A deterministic grep is the only reliable gate.

**Adding to the allowlist.** Edit `ALLOWED` in
`scripts/check-emoji.mjs`. Default: don't.

---

## Layer 4: per-round LESSONS_LEARNED + regression test pairing

Each bug round adds a dated section to `docs/LESSONS_LEARNED.md`
above the prior round. Every bug entry follows the same shape: **Bug
/ Root cause / Fix / Test / Lesson**, where `Test` cites the file:test
that pins the regression in.

Two outcomes:

1. The lessons doc becomes a searchable index of "we've seen this
   pattern before — here's the file that catches it now."
2. A reviewer can confirm a fix landed correctly by grepping for the
   cited test name; if it doesn't exist or doesn't fail without the
   fix, the entry is incomplete.

Round 17's entry is at the top of `docs/LESSONS_LEARNED.md`.

---

## Troubleshooting

**Playwright complains `out/main/index.js` missing.** Run
`npm run build` first, or use `npm run test:e2e:build`.

**Playwright spec hangs at "waiting for first window".** Electron
cold-start on an underpowered CI box can blow past 30s. The smoke
timeout is 60s; bump it in `playwright.config.ts` if your runner is
slower, but check whether the build artifact is actually present.

**A unit test passes locally but fails in CI.** Most common cause is
a leftover tempdir from a prior aborted run colliding with a fresh
`mkdtempSync`. Each test should use a per-test directory and clean it
up in `afterEach`; check that pattern if you see flakes.

**Emoji guard fails on a glyph that renders identically everywhere.**
Add it to `ALLOWED` in `scripts/check-emoji.mjs`. Reasonable
candidates: typographic glyphs in the U+2300–U+27BF range that aren't
emoji presentations.
