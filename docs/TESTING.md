# imagii — Testing Guide

imagii ships five complementary test layers. Each catches a different
class of regression; together they make a clean `npm run verify`
followed by `npm run test:e2e:build` and `npm run test:media` enough
confidence to tag a release.

---

## How long each layer takes

The one place the durations live (T-122: they had drifted three ways across this guide, `vitest.integration.config.ts` and
`release.yml`; every other mention points here, `playwright.config.ts` and `video-pipelines.spec.ts` included since T-123). The idle
| `npm run verify` | emoji guard, both typechecks, the unit suite (210 files, 6436 tests) | about 50 s (46.6 s and 48.1 s of vitest in round 84; 48.7 s to 58.6 s over three runs in round 83) | up to about 80 s (round 72, not re-measured) |
| `npm run test:media` | the real-ffmpeg suite, 512 cases (495 run, 17 platform- or binary-skipped: the T-151 and T-152 drawtext cases run only where drawtext exists — the distro 6.1.1 here, Windows at release) | about 10 minutes (607 s in round 84, with documentation edits beside it; 702 s in round 83, with only documentation edits running beside it; 680 s in round 82, run beside short unit runs; 610 s in round 81; 602 s before; the whole file on the distro's 6.1.1 measured 550 s in round 77: 272 passed and the same 7 pins written for the bundled binary failed, as in round 75; rounds 78-79 ran their touched blocks or the whole file there with the same 7 pins, and round 86's merged tree ran the whole file there: 357 passed and the same 7 failed, and round 89's Track A, with 40 more cases, 403 passed and the same 7 failed; its 7.0.2 run took 1076 s, loaded) | 9 to 10 minutes (round 72, not re-measured) |
| `npm run test:e2e:build` | the build (about 7 s), then the Playwright suite, 747 tests, one worker | about 29 minutes (1731 s of Playwright; the round-80 landings' loaded runs took 27 to 38 minutes, round 82's, with 14 more cases, 36.6, round 83's, with 5 more, 36.3, round 84's, with 23 more, 38.4, 36.7 and 36.8 over three full runs, round 85's, with 20 more across its two tracks, 39.0 on the merged tree, round 86's, with 15 more across its two tracks, 47.5 on the merged tree, with real-media runs before it, round 87's, with 8 more across its two tracks, 49.3 on the merged tree, round 88's, with 13 more across its tracks, 47.5 on the merged tree, round 89's first landing (Track C), with 11 more, 55.5 on its own tree with two other tracks' gates running beside it, its second (Track B), with 12 more, 58.1 on the merged tree, its third (Track A), with 7 more, 57.3 on the merged tree, round 90's first landing (Track B), with 7 more, 63.3 on its own tree with two other tracks' gates beside it, its second (Track A), with 4 more, 53.0 on its own tree, and its third (Track C), with 12 more, about 52 on the merged tree (a container restart cut it at 503; the last 21 ran after on the same build), round 91's landing (T-142), with 2 more, 44.4 with Layer 5 running beside it, round 92's (T-143), with 1 more, 45.0 with Layer 5 beside it, round 93's (T-144), with 10 more, 44.5 with Layer 5 beside it, round 94's (T-145), with 4 more, 44.3 with Layer 5 beside it, round 95's (T-146), with 5 more, cut at 358 by a container restart and the last 188 run on the same build (22.8 min), round 96's (T-147), with 15 more across its three tracks, 47.1 on the merged tree with the real-media suite beside it, round 97's (T-148), with 3 more, 44.5, round 98's (T-149), with 5 more across its two tracks, 44.6 on the merged tree with the real-media suite beside it, round 99's (T-150), with 10 more across its three tracks, 45.6 on the merged tree with the real-media suite beside it, round 100's (T-151), with 1 more, 46.9 on the merged tree with the real-media suite beside it, round 101's (T-152), with 5 more across its two tracks, 51.3 on the merged tree with the real-media suite beside it, round 102's (T-153), with 15 more across its two tracks, 50.2 on the merged tree with the real-media suite beside it, round 103's (T-154), with 9 more, cut at 579 by a container restart and the last 31 run on the same build (2.8 min), round 104's (T-155), with 12 more across its two tracks, 51.0 on the merged tree with the real-media suite beside it, round 105's (T-156), with 4 more across its two tracks, 50.4 on the merged tree with the real-media suite beside it, round 106's (T-157), with 5 more across its two tracks, 48.6 on the merged tree with the real-media suite beside it (one load flake: home-chrome.spec.ts T-131 "the last step names the ? key", outside the round's files, passed 5 of 5 standalone on the same build), round 107's (T-158), with 2 more, 48.8 on its own tree with the real-media suite beside it, after a container restart had stopped the worker mid-mutation, round 108's (T-159), with 4 more, 40.6 on its own tree with nothing beside it, round 109's (T-160), with 11 more across its two tracks, 41.6 on the merged tree with nothing beside it (one load flake: video-core.spec.ts "a trimmed video: close asks first", a timeline click then `i` that left the In point unmoved, outside the round's files, passed 5 of 5 standalone on the same build), round 110's (T-161), with 8 more across its three tracks, 41.9 on the merged tree with nothing beside it, round 111's (T-162), with 6 more across its two tracks and a fold, 42.3 on the merged tree with nothing beside it, round 112's (T-163), with 7 more across its two tracks, 42.3 on the merged tree with nothing beside it, round 113's (T-164), with 10 more across its three tracks, 42.5 on the merged tree with nothing beside it, round 114's (T-165), with 17 more across its two tracks, 43.6 on the merged tree with nothing beside it, round 115's (T-166), with 6 more across its two tracks, 43.4 on the merged tree with nothing beside it, round 116's (T-167), with 11 more across its two tracks, 51.1 on the merged tree with nothing beside it (two listed flakes: video-pipelines.spec.ts T-89 "a ranged burn with no cue", passed 5 of 5 standalone; home-chrome.spec.ts T-131 "the last step names the ? key", which failed most standalone runs on the base build and the tip alike — 7 of 10 and 8 of 10, alternated — and was a product bug, fixed in T-168 (6)), round 117's (T-168), with 16 more across its two tracks, 51.7 on the merged tree with nothing beside it (no failures; the T-131 case passed, and 10 of 10 standalone on Track B's build), round 118's (T-169), with 11 more across its two tracks, 52.1 on the merged tree with nothing beside it (no failures), round 119's (T-170), with 8 more across its two tracks, 53.1 on the merged tree with nothing beside it (no failures)) | not separately measured |

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

**Count.** 5361 tests across 193 files (round 88 (T-139) added 186 tests and three files - `src/main/fsAtomic.test.ts` and `tests/unit/atomicWrites.test.ts` (Track A: the atomic writer, and the scan that holds every user-file write and every e2e folder listing to it) and `src/renderer/src/components/restoreRun.test.ts` (Track B: the autosave offer's withdrawal) - Track A 126 of the tests, Track B 46 and Track C 14, the files they grew named in the round-88 paragraphs below; before that, round 87 (T-138) added 56 tests and two files, one per track - `src/renderer/src/lib/boundedImage.test.ts` (Track B: `loadImage` sets no-referrer, before `src`) and `src/main/ipc/videoScanSingleFlight.test.ts` (Track A: the highlight scan's claim in main, over the real handler) - Track A 34 of the tests and Track B 22, the files they grew named in the two round-87 paragraphs below; before that, round 86 (T-137) added 106 tests and three files, all three Track B's - `src/main/ipc/projectSave.test.ts` (the real `project:save` handler's size rule), `src/shared/imageBounds.test.ts` (the bounded copy's arithmetic) and `src/renderer/src/modules/video-studio/ChatHighlightPanel.test.ts` (`peakRange`) - Track A 27 of the tests and Track B 79, the files they grew named in the two round-86 paragraphs below; before that, round 85 (T-136) added six: Track A five - `src/main/ipc/videoConvertSingleFlight.test.ts`, `src/renderer/src/components/RunningCancel.test.tsx`, `src/renderer/src/components/ProgressTrack.test.tsx`, `src/renderer/src/modules/video-studio/OutputPreview.test.tsx` and `tests/unit/runningJobControls.test.ts` (the scan that holds every running-job Cancel to the shared component) - and Track B one, `tests/unit/stderrCapped.test.ts` (the AST scan that holds every main-process stderr accumulator to a cap); before that, round 84 (T-135) added five files - `src/renderer/src/lib/runStore.test.ts` (7: the run slot's claim, patch, end and its subscribers), `src/renderer/src/modules/video-studio/store/exportQueue.test.ts` (7: the batch's rows, the single-flight claim, a failure, a cancel, the file taken from the batch's own results), `src/renderer/src/modules/audio-studio/state/audioExport.test.ts` (8), `src/main/ipc/audioExtractSingleFlight.test.ts` (9: a second extraction is refused naming the one that runs, the slot comes back on every ending) and `src/shared/chatPeaks.test.ts` (10: the merge of adjacent buckets, the window, the cap) - and grew `interactionWiring.test.ts` from 172 to 191 (the T-135 block: the pins for items 13, 6, 5, 8 and 2, one per panel that holds its run in a store, the Export, audio export, Clip Kit, Captions-progress and extraction pins, and the derived results), `videoStore.test.ts` from 122 to 134 (`previewUrl` and the `derived` block), `failurePathLanguage.test.ts` from 36 to 45 (the board and preset writes), `projectValidation.test.ts` from 169 to 176 (the unknown preset id is dropped), `ProjectIO.test.ts` from 110 to 115, `audio.test.ts` from 43 to 48, `chain.test.ts` from 60 to 65 (`cutsLeaveNothing` over the unfloored length), `captions.test.ts` from 78 to 81, `mediaFormats.test.ts` from 35 to 37, `referencesStore.test.ts` from 22 to 24 (the store names the newest request's query), `exportProgress.test.ts` from 6 to 7, and the two per-file scans `copyConventions.test.ts` (134 to 138) and `noRawHex.test.ts` (114 to 118), which gain a row per new source file; round 83 (T-134) added no file and grew `interactionWiring.test.ts` from 168 to 172 (the T-134 block: the Restore that navigates only a person still on Home, the per-button busy flags, the marker keys on the press only, the preset name's cap and cut; the older T-57, T-119 and T-133 (7b) pins follow the renamed flags and the guarded keys), `referencesStore.test.ts` from 18 to 22 (the T-133 (8) drop-test flipped into the newest-query tests: a corrected query is asked, a late answer is never drawn in either order, a stale failure leaves no error), and `docClaims.test.ts` from 59 to 64 (the no-picture claim corrected, the scan that lists the callers of `wroteNoPicture`, and the scan that reads the native-dialog inventory against the renderer); round 82 (T-133) added two files - `src/main/sidecars/burnInNoPicture.test.ts` (11: the real `runBurnIn` over a fake ffmpeg that exits 0 having written an audio-only mp4 or a stub, the shifted SRT and the file go with the refusal, the empty-output line found past the kept 16 KB tail, a whole-video burn, a one-frame clip, a count split across chunks, a stream that never reported one, a real failure keeps its own words) and `src/renderer/src/lib/liveTake.test.ts` (5: nothing live, declined, accepted, unregistered, a stale unregister) - and grew `interactionWiring.test.ts` from 158 to 168 (the disabled-button scan with its discrimination block, the held-key and Space wiring, the live-take wiring and the table of `navigate()` calls, the Clean audio second question), `repeatPress.test.ts` from 8 to 15 (`createHeldKeyGuard`), `referencesStore.test.ts` from 15 to 18 (one search at a time), `AudioStudio.test.ts` from 33 to 38 (`confirmReplaceAfterWait`), `noPicture.test.ts` from 22 to 24 (the astral-name cut, a good thumbnail stamped in the past, a file already at the path is refused, the burn-in sentence), `partialOutput.test.ts` from 7 to 9 (`wroteOutput` without a clock), `HotkeyOverlay.test.ts` from 28 to 29, `AppToaster.test.tsx` from 2 to 3, `audio.test.ts` from 42 to 43 and `docClaims.test.ts` by 3 (the `reportFailure` signature in STYLE_GUIDE read off the real one, USER_GUIDE's waveform timing, the "every runner" claim); round 81 (T-132) added one file - `src/main/ffmpeg/noPicture.test.ts` (22: `PictureFrames` reads the progress block's frame count by whole lines and says nothing about a stream that never reported one; `wroteNoPicture` is either fact; the refusals are finished sentences of at most 240 characters; and the real `runExportJob`, `runReframe` and `extractFrame` over a fake ffmpeg that exits 0 having written a stub, an audio-only mp4, a legitimate one-frame clip, a report that ends inside the number, no file, an empty file, and an old file at the path) - and grew `audioStore.test.ts` from 15 to 21 (`waveformArrived`: arrives, already drawn, refused, closed, replaced, not held), `ProjectIO.test.ts` from 98 to 110 (`currentRoute`; `audioSettled` over the real stores and the real `applyProject`, including a refusal that landed before anyone asked), `Tutorial.test.ts` from 71 to 75 (a repeat is held), `concat.test.ts` from 28 to 32 and `concatRunner.test.ts` from 24 to 27 (the compilation refusals name the clip), `presets.test.ts` from 47 to 50 (`customPresetStartFor`), `audio.test.ts` from 38 to 42 (`peaksMaxMagnitude`, the playback sentence), `interactionWiring.test.ts` from 150 to 158, `docClaims.test.ts` from 52 to 56 (the 2-hour limit read in README, PRODUCT_GUIDE and USER_GUIDE), `persistSetting.test.ts` from 6 to 7 and `reportFailure.test.ts` from 2 to 3 (the fixed toast id); `presetTablesInSync.test.ts` and `failurePathLanguage.test.ts` gained assertions; the Layer 5 file grew by 10 cases (the item-4 block, 9; the join's "Impossible to open" line, 1); the E2E count is 366 + 7 = 373 (seven new cases: Clean audio during a live take and while elsewhere, the Captions row's geometry, a partial clear, the tour's held Enter, an asymmetric waveform, and Play while the waveform is drawn; five existing cases gained assertions); round 79 (T-131) added two files - `src/renderer/src/lib/claimFirst.test.ts` (6: the flag is raised before anything awaits, a second call is dropped, the claim is given back on success, on a throw and on a canceled dialog, and a refused call does not lower the first one's claim) and `src/renderer/src/lib/repeatPress.test.ts` (8: `isRepeatPress`, and `isSwallowedRepeat`, the pure core of `swallowRepeatClicks`: a repeat inside the 500 ms after a dialog closes is dropped, one after the window and a first click never are) - and grew `networkAllowlist.test.ts` from 32 cases to 42 (the guard asked the other way round: `open` / `eval` / `Function` by their last segment unless the file binds the head, `x['name']`, a constructor used as a value, `createElement(dynamic)` / `setAttribute(dynamic)`, any `scheme://` literal that is not local, a closed list of file types under `src/`, the package names pinned), `interactionWiring.test.ts` from 136 to 147 (a scan that finds every renderer call of a bridge function that opens a native chooser and holds the set to a decided table, with a discrimination block; the wiring pins of items 3-9 and 13-17), `tutorialCopy.test.ts` from 148 to 157 (every tour ends by naming the `?` key), `cancelSentinel.test.ts` from 192 to 199 (the picture-in-picture probe and the re-attach's mux pass are held to the cancel latch), `muxCodec.test.ts` from 30 to 35, `concatRunner.test.ts` from 13 to 15, `videoStore.test.ts` from 116 to 121, `releaseWorkflowShape.test.ts` from 15 to 19 (Inter's license ships), `copyConventions.test.ts` from 130 to 132 (the letter x between numbers) and `noRawHex.test.ts` from 110 to 112 (it reads the two new files); the Layer 5 file grew by 20 cases (the two compilation and re-attach blocks, T-131 (1) and (2); 332 on the landed tree), and the Playwright suite by 20 tests (366 on the landed tree; `tests/e2e/chooser.ts` is the shared slow-chooser stand-in, not a spec); round 79 (T-130) added two files - `src/shared/compileFps.test.ts` (7: the rate a compilation is written at is the source's up to 60, 59.94 stays 59.94, a rate that is not a number pulls nothing down, none at all is 30) and `src/main/ffmpeg/frame.test.ts` (7: a thumbnail of a cropped clip is one `-vf crop` in even pixels of the probed size, clamped inside the frame, and a clip without a crop runs the command it always did, with no probe) - and grew `videoCropPayload.test.ts` (+12: `video:extractFrame` refuses an unusable crop before the runner), `concatRunner.test.ts` (+9: `-r` and the fps stage are the one derived value on every segment), `presetTablesInSync.test.ts` (+7: YouTube 1080p60 on both sides of the bridge, the kit still five), `watermark.test.ts` (+6: the margins and which shapes are vertical), `filters.test.ts` (+5: all four corners, vertical and landscape), `cancelSentinel.test.ts` (+4: a cancel before the thumbnail's probe), `concat.test.ts` (+4) and `presets.test.ts` (+4: the new row); the E2E count is 346, two new cases (a 60 fps recording's Compile card and file, and YouTube 1080p60 beside YouTube with the kit still five) and the Clip Kit Short case extended to its three thumbnails; test:media is 312 cases, 299 run | 13 skipped (sixteen new across four blocks: the rate eight, the thumbnail five, the margins two, and the preset loop's sixth row). The round's runs shared the box with another worker's Playwright suite (load average about 12), so the durations in the table at the top were not re-measured. Round 78 added six files - `src/renderer/src/lib/persistSetting.test.ts` (6: a refused settings write never rejects, says one sentence, and the caller carries on), `src/main/transcripts.test.ts` (10, over real folders: a burn-in's temp copy and sub-folders are not counted, a link is never followed, a remove that refuses is counted and the rest go), `src/main/ipc/captionsTranscripts.test.ts` (3: the real handlers over a real userData, an argument aimed at another folder is ignored), `src/main/ipc/recordingQuit.test.ts` (5: over the real convert module and latch, a quit mid-convert is released only after the half-written mp4 is gone and the raw take is kept, a Discard removes both, an open Save dialog is not a run), `src/main/ffmpeg/convertQuit.test.ts` (7: the import transcode is a run, a failed one removes its partial, a cancel for another owner leaves it running) and `src/main/ipc/videoCustomPresetIds.test.ts` (13: `video:deleteCustomPreset` refuses a bad id before the store is asked) - and grew `pathSafety.test.ts` (+8: one nanoid alphabet in `src`), `extract.test.ts` (+4: the extraction is a run), `captions.test.ts` (+4: `clearedTranscriptsMessage`), `failurePathLanguage.test.ts` (+3: a settings write is never a bare promise), `a11ySweep.test.ts` (+2: rule 6, every cut name carries a `title`), `interactionWiring.test.ts` (+2: Inter as woff2 alone, and the transcript clear's ref pin joined an existing one), `recordingStream.test.ts` (+1: the quit sweep leaves a closed, mid-finalize session's take) and `videoStore.test.ts` (+1: `setSrtPathFor(…, null)`), and the per-file scans grew by two; round 78 (T-128) added six files - `src/renderer/src/lib/persistSetting.test.ts` (6: a refused settings write never rejects, says one sentence, and the caller carries on), `src/main/transcripts.test.ts` (10, over real folders: a burn-in's temp copy and sub-folders are not counted, a link is never followed, a remove that refuses is counted and the rest go), `src/main/ipc/captionsTranscripts.test.ts` (3: the real handlers over a real userData, an argument aimed at another folder is ignored), `src/main/ipc/recordingQuit.test.ts` (5: over the real convert module and latch, a quit mid-convert is released only after the half-written mp4 is gone and the raw take is kept, a Discard removes both, an open Save dialog is not a run), `src/main/ffmpeg/convertQuit.test.ts` (7: the import transcode is a run, a failed one removes its partial, a cancel for another owner leaves it running) and `src/main/ipc/videoCustomPresetIds.test.ts` (13: `video:deleteCustomPreset` refuses a bad id before the store is asked) - and grew `pathSafety.test.ts` (+8: one nanoid alphabet in `src`), `extract.test.ts` (+4: the extraction is a run), `captions.test.ts` (+4: `clearedTranscriptsMessage`), `failurePathLanguage.test.ts` (+3: a settings write is never a bare promise), `a11ySweep.test.ts` (+2: rule 6, every cut name carries a `title`), `interactionWiring.test.ts` (+2: Inter as woff2 alone, and the transcript clear's ref pin joined an existing one), `recordingStream.test.ts` (+1: the quit sweep leaves a closed, mid-finalize session's take) and `videoStore.test.ts` (+1: `setSrtPathFor(…, null)`), and the per-file scans grew by two; round 78 (T-129) added one file - `src/main/audio/peaks.test.ts` (16: the fold of a stream of samples into bounded highest/lowest pairs, a sample cut across two chunks, the last-bucket clamp, the command line, the job's progress, its failure sentence, the per-job Cancel and a Cancel during the probe, the quit sweep, the latch run held until the child closes) - and grew `audioStore.test.ts` (+7: the file opens first, `drawing` carries main's percent, `waveform` its answer, an unreadable file or an answer that is not a waveform is refused and let go, Close and a second file stop the job and its late answer draws nothing), `docClaims.test.ts` (+1) and `interactionWiring.test.ts` (+1: the peaks wiring, the progress line, Close's Cancel, the quit sweep), and shrank `audio.test.ts` (-4: the ceiling's sentences go; `isWaveformPeaks`, `WAVEFORM_READ_FAILED` and `PLAYBACK_ERROR_MESSAGE` come) and `audioExtractCeiling.test.ts` (-10: the length gate and the scratch-WAV backstop go, the same files now extracted), with one `ProjectIO.test.ts` pin flipped (a sound file over two hours opens); the E2E count is 344: round 78 (T-128)'s eight new cases (a long board name, a long source-tile title, Welcome with a settings write main refuses, Export with the same refusal, Clear saved transcripts, and the window's X in the middle of a recording's MP4 convert, an import transcode and an extraction) and round 78 (T-129)'s two (Close and a quit while a long file is drawn), with six flipped or rewritten in place (the long file, the long video, Clean audio on a long video, the ADPCM file the player cannot play, the file main cannot read, the audio-only mkv); test:media is 296 cases, 285 run | 11 skipped (T-128: two new in the quit block; T-129: four new in the peaks block, two flipped in place). The two rounds' trees were gated separately and re-gated as one at the round-80 landing; the durations in the table at the top are that landing's own runs. Round 77 added no file and grew `networkAllowlist.test.ts` from 19 cases to 32 (the scan's last gaps: constructors through a global, `getBuiltinModule(` and `createRequire(`, `export ... from`, a location chain, an IPv6 literal, `image-set(`, `createElement`, `devDependencies`, every module the set names, a guard that no `.js` file hides under `src/`), `cancelLatch.test.ts` (8: `drainRuns`, and a scan that every runner ends its run after its work), `reattachCollision.test.ts` (2: a quit mid-re-attach is released only after the scratch WAV is gone), `concatRunner.test.ts` (1: `-shortest`), `audioExtractCeiling.test.ts` (5) and `audio.test.ts` (2) (`NoUsableDurationError`), `textOverlay.test.ts` (5: `overlayTimePair`), `tutorialCopy.test.ts` (3), `designTokensInSync.test.ts` (3: the placeholder rule) and `interactionWiring.test.ts` (the net-silence calls, the `before-quit` wait, the Modal scrim, the three save handlers, the titles); round 76 added four files - `src/main/ffmpeg/folderVerdict.test.ts` (8: one stat per path in flight, a 1 s deadline, `unknown` is not "not a folder"), `src/main/ipc/settingsFolderDeadline.test.ts` (5: the real `settings:get` over a hung stat), `src/main/ffmpeg/highlightsArgv.test.ts` (4: both loudness scans take `EBUR128_SCAN_FILTER`, no `peak=true`) and `src/renderer/src/modules/audio-studio/state/audioStore.test.ts` (8: `fromVideo` follows the streams, the extension only when the probe could not say) - and grew `networkAllowlist.test.ts` from 12 cases to 19, `interactionWiring.test.ts` (the seven more `singleFlight` handlers, Export's chooser, the readout audit, the refusal row), `designTokensInSync.test.ts` (`::selection`), `clockTime.test.ts` (`formatTimer`), `textOverlay.test.ts`, `units.test.ts` (`readoutText`), `saveCard.test.ts` (`micLostLine`), `audioExtractCeiling.test.ts`, `muxCodec.test.ts` (`-tag:v hvc1`), `filters.test.ts` / `concat.test.ts` / `reframe.test.ts` (`fps=N` after the retime); round 75 added five files - `src/main/ffmpeg/concatRunner.test.ts` (5: a compilation segment is Matroska with PCM sound, the join copies the picture and encodes the sound once to AAC at 192 kbps, the list file, the fades, and a folder that cannot be made refuses before one segment is encoded), `src/main/audio/exportProgress.test.ts` (6: the progress is over the length that is kept), `src/main/ipc/settingsFolders.test.ts` (17: `settings:get` answers a folder key only for a folder that exists now, for each of the three), `src/renderer/src/hooks/useVideoOutputDir.test.ts` (14: the four panels' folder is one store) and `src/shared/clockTime.test.ts` (10: `formatClock` and `parseClock`) - and grew `videoReframePayload.test.ts` (+17: the whole recipe at the boundary), `audioExtractCeiling.test.ts` (+11: a probe that failed is not a probe that said no; an AIFF or a WMA is not a video), `ProjectIO.test.ts` (+13: `extractedFrom`, `replacedSince`), `interactionWiring.test.ts` (+13: the round's wiring pins), `videoCropPayload.test.ts` (+7), `outputPath.test.ts` (+6: `ensureOutputDir`, `outputFolderRefusal`), `reframe.test.ts` in `src/main/ffmpeg/` (+9: the strip through `buildVideoFilter`) and in `src/shared/` (+4: the readout over the crop), `gradeMatrix.test.ts` (+5), `chain.test.ts` (+5: the strengths in order, the 4096 stage), `tutorialCopy.test.ts` (+4: the Clip Kit step), `videoPickOutputDir.test.ts` (+3), `textOverlay.test.ts` (+3: the window of no length, the time refusal), `designTokensInSync.test.ts` (+3: the native-controls rule and the toast marks), `audio.test.ts` (+2), `extract.test.ts` (+1) and `tutorialTargets.test.ts` (+1), and `networkAllowlist.test.ts` went from 6 cases to 12 by vitest's count (the T-124 entry first said 23, a transposed figure; the guard now also sees `useImage(`, a dynamic `import()`, the updater and crash SDKs, a fetching `spawn` and the media elements, holds the CSP to every directive with one named exception, and asserts the package and the builder config; each new shape is proven to red); the E2E count is 314, seventeen new cases (a header-less WebM, a WMA, the 9:16 file's look and header, three for the output folders, the long-name layout, a video over an hour, a double-clicked Export, Clean audio over a changed Audio Studio, the Source time boxes and names, the arrow's row, the Clip Kit tour step, two for the dropped microphone, and the crash screen's promise), and many extended (the cases that pressed Choose folder... in each panel in turn, every file-name expectation, the overlay locators, the position and rotation boxes, the toast marks and the native-control properties); test:media is 271 cases, 260 run | 11 skipped (twenty-two new across six blocks: the join, the extraction clock, the strengths, the 4096 stage, the 9:16 file and the output folder). Round 74 added five files - `src/main/windowBounds.test.ts` (5: the window-geometry write never throws: a refused write, a window that dies between the check and the question, nothing latched), `src/main/ffmpeg/reframe.test.ts` (17: the 9:16 graph is `setpts`, the crop stage on the cropped frame, the strip, `setsar=1`, and the sound at the clip's speed), `src/main/ipc/audioExtractCeiling.test.ts` (5: the handler probes first and never reaches the extractor for a video over 2 hours), `src/main/ipc/videoReframePayload.test.ts` (23: the reframe and GIF payloads are checked at the boundary, crop before speed, the name from the opened video) and `tests/unit/networkAllowlist.test.ts` (6: an AST scan of `src/` for every way the app reaches the network, held to an exact per-file list and the page's CSP, with the scan's own discrimination cases) - and grew `docClaims.test.ts` (+15: the `%TEMP%` disclosure, the Levels ceiling sentence, the layout guide, the re-pointed cites), `interactionWiring.test.ts` (+8: the round's wiring pins), `audio.test.ts` (+5: the ceiling's two sentences), `keyOwnership.test.ts` (+5: `hasChordModifier`), `textOverlay.test.ts` (+5: a window that misses the clip), `ProjectIO.test.ts` (+4: `sessionHoldsWork`), `recordingStream.test.ts` (+4: `abandonOpenRecordingSessions`), `canvas.test.ts` (+4: `layerOffsetRange`, `LAYER_ROTATION_RANGE`), `projectValidation.test.ts` (+3: `hasStudioState`), `chain.test.ts` (+1: the cut stage is re-chunked to 256 samples first), `settingsClear.test.ts` (+1) and, by the per-file scans, `copyConventions.test.ts` (+1) and `noRawHex.test.ts` (+1). Round 73 (3976 tests in 146 files) added eight files - `src/main/sendIfAlive.test.ts` (6: the one way main reports to a window drops a send for a destroyed WebContents, never asks one to send, swallows a window that dies between the check and the send), `src/main/ipc/closeMidJob.test.ts` (18: each real progress handler, a dead sender in two shapes), `tests/unit/progressSendsGuarded.test.ts` (5: no bare `.send(` under `src/main`, with a finder that discriminates), `src/main/rendererRecovery.test.ts` (11: reload once, never inside the cooldown, never when quitting), `src/main/audio/singleTrackTail.test.ts` (15: the single-track `-af` ends in the mix bus's limiter, a bare chain does not, Even volume does not, `dual_mono` on both passes for a mono source and not for 2 or 6 channels or the mix path), `src/renderer/src/lib/keyOwnership.test.ts` (35: every tag and input type through the three questions), `src/shared/draftNumber.test.ts` (14) and `tests/unit/docClaims.test.ts` (36: the claims the twelfth pass found false, held against the code they describe, the cites in `image.spec.ts` with an anchor each) - and grew `useUndoRedoHotkeys.test.ts` (+15) and `HotkeyOverlay.test.ts` (+11) (a checkbox, a range, a radio, a colour well, a file field and a button no longer own Ctrl+Z or `?`), `chain.test.ts` (+6: `settb=AVTB` between `select` and `setpts`, `dual_mono` on both passes), `filters.test.ts` (+8: a crop the validator accepts is inside the frame, at the measured ratio and the ceiling), `audio.test.ts` (+7: the 2 hour ceiling and its sentence), `recordingStream.test.ts` (+4: the cap under twelve concurrent begins), `emojiGuard.test.ts` (+3: `.html` and `.css`, and a file type the script does not read), and, by the per-file scans, `copyConventions.test.ts` (+3), `noRawHex.test.ts` (+3), `interactiveNesting.test.ts` (+1) and `failurePathLanguage.test.ts` (+1) for the three new renderer files, with `a11ySweep.test.ts` (+1: the shared `DraftField` and the Color box are two facts) and `interactionWiring.test.ts` (the Timeline's key guard, the saved-toast shape and the Edit in Video Studio bridge re-pointed to where they now live); the E2E count is 267, eighteen new cases (the focus-keeps-its-keys case in Audio, Stream Graphics and the Player, the Time boxes, the number boxes in Stream Graphics (one) and Video Studio (three), the self-ended take, the scrim drag, the five output-folder names, the renderer crash, three layout cases, and three waveform cases) and five extended (Reframe's toast action, Save .srt's scope sentence, the Posting log's Facebook chip, the Levels case's ceiling sentence, the thumbnail cache tooltip); test:media is 238 cases, 227 run | 11 skipped (thirteen new: the crop block (five), the single-track peaks and loudness block (seven), and the AVI seam case; two existing loudnorm cases re-pointed to the dual-mono meter); round 72 added one file, `tests/unit/emojiGuard.test.ts` (6: every directory of `src/` is a root of the emoji guard and every root exists, the script itself run from a scratch tree on one emoji under each of the four roots and naming the file, a clean control, a test file that may carry one) and grew `filename.test.ts` (+8: the `{handle}` token in any script, with an emoji's variation selector, the separators and no handle, and the mark that rides on `_` and `-`), `muxCodec.test.ts` (+5: `-enc_time_base:v filter` beside `-fps_mode passthrough` on a cut and on every re-encode, absent from a copy), `devices.test.ts` (+1: the empty-device hint names the third recovery) and `interactionWiring.test.ts` (+2: the kit's folder asked for with the sanitized name, the Second-track footer behind Duck); the E2E count is 249, one new case (a Clip Kit on a clip whose name was cleared) and two extended or re-pinned (the second-track case, and the six Record cases that read the hints); test:media is 225 cases, 214 run | 11 skipped (three new: the cut re-attach's timestamps on the 24 fps ramp and on a 30 fps source, and the check's own discrimination); round 71 added no file and grew `releaseWorkflowShape.test.ts` (+9: the packaged tree carries one ffprobe and none of the four unused dependencies, with a discrimination case), `AudioStudio.test.ts` (+11: a chain that lacks keys is not a chain with edits), `chain.test.ts` (+8: the picture cut closes each gap by the time it took, never by a frame rate, with the overlap, touching, nested, out-of-order and before-the-file shapes), `filename.test.ts` (+7) and `chatLog.test.ts` (+3) (letters and numbers of any script survive, a mark stays on its letter, an emoji's variation selector does not), `projectValidation.test.ts` (+4: QA's clip with no `textOverlays` and the rows around it), `clipKit.test.ts` (+6: non-ASCII clip names through the real queue builders) and `interactionWiring.test.ts` (+3: the camera fallback's catch and thumbnail, the Timeline's four relative keys, the name `mark`); the E2E count is 248, three new cases (a camera that opens and a compositor that cannot start, leaving Record while the camera is opening, the Timeline's arrows and `,` / `.` during playback) and the zero-camera case extended; test:media is 222 cases, 211 run | 11 skipped (seven new: the burn-in, the PiP and the cut re-attach on the MediaRecorder fixture, per codec, and the overlapping cuts); round 70 added two files - `src/main/ffmpeg/probe.test.ts` (`probedFps`: a container's clock is not a frame rate - the average rate first, the real rate when there is no average, a `1000/1` millisecond clock reads as unknown, the 240 ceiling is inclusive, no rate is 0) and `src/main/ipc/videoPickOutputDir.test.ts` (the real `video:pickOutputDir` handler: a usable absolute path becomes the chooser's `defaultPath`, anything else is ignored and nothing is refused, the answer still comes back) - and grew `audioChainValidation.test.ts` (+37: a cut's and the custom noise reduction's numbers through both handlers and the preset), `settingsClear.test.ts` (+19: the dotted keys the nested schema judges, through the real store), `interactionWiring.test.ts` (+8: the round-70 wiring pins and their discrimination blocks), `videoStore.test.ts` (+6: the Player transport, `playheadNow`, the pronoun), `convertCancel.test.ts` (+5: `-fps_mode vfr` in the convert's argv and `remuxWebm`), `cancelSentinel.test.ts` (+5), `recordingCancel.test.ts` (+4: the WebM branch's remux), `settingsKnownKeys.test.ts` (+2: the schema flattened and compared to the allowlist, no dotted property name) and `releaseWorkflowShape.test.ts` (+2: `electron-builder.yml` pins no Electron version); the E2E count is 245, seven new cases (a held Enter in the Fix wizard, Space on the timeline, I during playback, the Clip Kit chooser's folder, the recording view's preview and thumbnail, leaving Record while the capture opens, and the window's background-throttling option) and the WebM save, the Output hint and the Variants case extended; test:media is 215 cases, 204 run | 11 skipped (ten new: the MediaRecorder block, eight cases, and the Auto Zoom pair); round 69 added two files - `src/main/ipc/captionsOpenFolder.test.ts` (the real `captions:openModelsFolder` handler on a real tree: the folder exists at the instant the shell is asked, parents too, an existing folder is left alone, a non-empty answer is logged, a folder that cannot be made does not throw) and `src/main/ipc/settingsClear.test.ts` (the real `settings:set` / `settings:get` over the real electron-store against a file in a temp folder: `undefined` clears a key from memory and from the file, anything else is stored and judged as before) - and grew `projectValidation.test.ts` (+38: a clip, a chain and a canvas document that are structurally empty are refused, named by field, and whole ones with and without every optional field are accepted), `filters.test.ts` (+9: the matrix stage per tag, the two bt601 tags get the tag alone), `gradeMatrix.test.ts` (+1: each real runner's `-vf` for each tag), `interactionWiring.test.ts` (+6: the single-flight finder with its discrimination block, the timeline's keys, the `videoDiscardMessage` wiring, the blank watermark's clears), `recordingStream.test.ts` (+3: abandon after a write error, through the real handler), `videoStore.test.ts` (+3: `videoDiscardMessage`), `a11ySweep.test.ts` (+2: rule 5 and its discrimination), `Tutorial.test.ts` (+1) and `truthInCopy.test.ts` (+1: the README and the release body); the E2E count is 238, eight new cases (Start's "Starting…", Edit in Video Studio's question, the audio importer's second file, the Fix wizard's focus, the timeline's keys, a focused select, the coachmark under Reduce motion, and a blank watermark with the kit after it) and five re-pinned or extended (the mic-refusal case presses Start twice, the clip-list case reads the rename field's ring, the Variants case asserts focus, the trim-handle drags find the handles by place, and the Fix wizard's modal-contract case in `home-chrome.spec.ts` expects the question to open on its first answer, where it used to open on Close); test:media is 205 cases, 194 run | 11 skipped (seven new: the bt601 cases in the T-118 block); round 68 added one file, `src/main/ffmpeg/gradeMatrix.test.ts` - the real `runExportJob` and `runConcat` against a fake child and a fake probe: a bt709 source's color space reaches the temperature stage from each, and untagged and bt601 sources get nothing - and grew `autosave.test.ts` (+6: the real `clearAutosave` with an `unlink` stand-in, the first failed unlink's errno in the message, a vanished file's code left out, each shape through `userFacingError`), `userFacingError.test.ts` (+7: the Autosave Clear shapes), `filters.test.ts` (+11: the matrix stage for bt709 and none otherwise) and `captions.test.ts` (+1: the equals sign in a path); the E2E count is 230, unchanged (`home-chrome.spec.ts`'s Clear-failure case re-pinned: its two stubs are main's real shapes, and the first now asserts no cause is guessed); test:media is 198 cases, 187 run | 11 skipped (the `a=b.srt` burn-in case and the five-case bt709 block); round 67 added three files - `src/main/ipc/audioPresetIds.test.ts` (the real `audio:deletePreset` handler with the store wrapped in a spy: a traversal, a slash, a backslash, a space, an extension, `..` and a trailing newline are refused before the store is asked, and a minted id still deletes), `src/main/pathConfine.test.ts` (`isOutsideFolder` under posix and win32, and a scan that fails on a hand-rolled `startsWith('..')` anywhere in `src/main`) and `src/renderer/src/lib/reportFailure.test.ts` (a failure is a red toast for `ERROR_TOAST_MS`, a cancel is a neutral one) - and grew `presets.test.ts` (+23: a traversal id aimed at a real file leaves it standing and is refused, the parser and the list refuse an id that is a path), `pathSafety.test.ts` (+21: `isSafeId` / `assertSafeId`), `captionsSaveSrt.test.ts` (+11) and `captionsWriteKitSrt.test.ts` (+10) (a transcript whose name starts with two dots is in the folder; five real traversals still refuse), `filename.test.ts` (+10: the local stamps in three zones, a Date whose local and UTC fields differ, and a scan for `toISOString()`), `outputPath.test.ts` (+3: the kit folder's day under `America/Los_Angeles` and `Pacific/Auckland`), `userFacingError.test.ts` (+5: Record's save failure shapes), `recordingStream.test.ts` (+1: the empty-take sentence), `moodboard.test.ts` (+1: a dot-named thumbnail), and moved assertions inside `failurePathLanguage.test.ts` (+2: no renderer source calls `ipcErrorMessage`, with a finder that discriminates) and `interactionWiring.test.ts` (-1: the `MUST_LAST` row for the Save-failure and Autosave-Clear toasts moved to `reportFailure.test.ts`; Record's save, its source list and the Autosave Clear are `reportFailure` now); the E2E count is 230, three new cases in `record.spec.ts` (and the source-list refusal and the autosave Clear failure re-pinned to their sentences, each with a second, known-cause refusal) (the suggested name on a clock whose day is not UTC's; a save that fails with EPERM, then ENOSPC; an empty take through the real IPC), the kit case re-run on that skewed clock, and the `kitStamp()` helper reading the local day; test:media is unchanged at 181 passed | 11 skipped (comments only); round 66 added one file, `src/main/ipc/captionsSaveSrt.test.ts` (the real `captions:saveSrt` handler on real files: a transcript that is gone, or outside the captions folder, is refused in a finished sentence before the Save dialog opens, the folder gate answering first; each sentence passes `userFacingError` unchanged; the copy and the canceled dialog still work), and grew `copyConventions.test.ts` (the tick rule reads the un- prefix; the two word rules also read every string in main, shared and preload, with a discrimination block and a guard against an empty scan) and `recordingCancel.test.ts` (the convert-failure sentence says "uncheck" and quotes the label exactly), plus more assertions inside `a11ySweep.test.ts` (rule 4 accepts `has-[:focus-visible]:opacity-100` and no longer accepts `focus-within`; no new test); the E2E count is 227, one new case (Save .srt on a transcript that is gone) and four re-pinned (Save .srt outside the captions folder reads main's sentence; the two References overlays tab in with the keyboard and add the mouse-click-away assertion; the Record convert-failure case reads "uncheck"); test:media is unchanged at 181 passed | 11 skipped (one comment); round 65 added no file and grew `convertCancel.test.ts` (the convert's progress is ffmpeg's position over the take's length, 0-99, and carries no percent without one: eleven cases over ffmpeg's real `-progress` text), `recordingCancel.test.ts` (the length `promoteTempWebm` hands the convert, progress forwarded as it came), `filters.test.ts` (`EVEN_PICTURE` is a crop, never a scale), `projectValidation.test.ts` / `autosave.test.ts` (a verbatim legacy JSON with `"sizePx": 800` restores at 512, the injection pins stand, the gate stays strict), `highlights.test.ts` (`hookAsk` and `HOOK_DEBOUNCE_MS` replace `hookWindowKey`), `a11ySweep.test.ts` (rule 4: a hover-only container shows on focus, with a discrimination block; two more named elements) and `interactionWiring.test.ts` (the three failure toasts that must last, with a finder that discriminates; the convert bar's null branch; the hook badge's debounce, its first ask, its cleanup) and `failurePathLanguage.test.ts` (Save .srt awaits its call inside a `try` whose `catch` is `reportFailure`, with a finder that discriminates; its header now says it reads only `catch` clauses and not a missing one); the E2E count is 226, two new cases (the convert bar draws what main reports; Save .srt on a transcript outside the captions folder says it could not) and eleven extended or re-pinned (the two hook cases, the two References overlays, the Export format name, the overlay x/y names, and the three spawn-order or title cases that had assumed the hook badge was already done); test:media is 181 passed | 11 skipped — 7 new cases (the convert's progress ×4 against the real binary, and the 1-pixel checkerboard ×3); round 64 added three files — `src/shared/overlayColors.test.ts` (the 148-name table and its resolver, moved from `textOverlay.test.ts`, and `#rgb`), `src/main/audio/reattachCollision.test.ts` (the real `runAudioReattach` on real files with `NODE_ENV=production` forced: a source or a video sitting where the scratch WAV goes is refused and left intact, nothing spawned) and `src/main/audio/silentLoudnorm.test.ts` (the real `runAudioExport` against a fake child that prints a silent pass 1: pass 2 is the single-pass loudnorm) — and grew `projectValidation.test.ts` / `autosave.test.ts` (a verbatim pre-T-113 schema-5 JSON with the overlay color NAME `white` restores, and the injection strings still refuse), `validators.test.ts` (the source scan now reads every non-test file under `src/main` through the syntax tree, with `AUDITED_PURE_INVARIANTS`), `captionsBurnIn.test.ts` / `captionsProgress.test.ts` (the gate's caption colors; the runner's own check under forced production; the burn-in's chain always opens with the even-size stage), `convertCancel.test.ts` (the convert's `-vf`), `filters.test.ts` (`EVEN_PICTURE` once; the overlay font table: six fonts, thirteen fallbacks), `chain.test.ts` (a silent measurement is no measurement), `clipKit.test.ts` (all nine kit file names for eight device-like clip names), `ProjectIO.test.ts` (`describeApplyOutcome(outcome, via)`), `highlights.test.ts` (`hookWindowKey` is `"<window>@<start>"`), `templateTruth.test.ts` (the square card's sentence), `a11ySweep.test.ts` (rule 1 sees a border, a ring and a wash too, with a discrimination block; fourteen more elements named) and `interactionWiring.test.ts` (the hook badge's key, its gate and its per-clip key; both callers of `describeApplyOutcome`; the kit's file names); the E2E count is 224, one new case (the start-handle drag) and twelve extended; test:media is 174 passed | 11 skipped — 12 new cases that run (the odd-sized picture through the convert x3, the burn-in x3 and the PiP x2 plus the fixture check, and the silent input x3) and 2 win32-gated ones (the six fonts, and the Font choice reaching the picture); round 63 added seven files — `src/shared/textOverlay.test.ts` (the 148-name color table, name and hex resolution, the 8-512 clamp, the default overlay, the store patch), `src/main/ipc/captionsWriteKitSrt.test.ts` (the real `captions:writeKitSrt` handler on real files: the kit's `.srt` on the clip's clock, nine refused ranges and speeds), `src/renderer/src/hooks/useAutosave.test.ts` (the hold and the quit flush through the real stores), `tests/unit/spawnWindowsHide.test.ts` (a syntax-tree scan: every `spawn(` under `src/main` passes `windowsHide: true`), `tests/unit/jobClipNormalized.test.ts` (every export job takes its clip through `clipForExport`), `tests/unit/tempSandbox.test.ts` (the three test files that share a temp family each have a private `tmpdir()`), and `tests/unit/a11ySweep.test.ts` (selected-by-fill buttons need a state attribute, bounded scrollers need a tab stop, each named element is wired) — each scan with a discrimination block over sample code — and grew `validators.test.ts` / `assert.test.ts` (every validator throws under `NODE_ENV=production`, `assertAlways`, and a source scan that keeps every IPC gate off the soft `assert(`), `audioChainValidation.test.ts` (the chain gate under forced production), `muxCodec.test.ts` (the even-size stage ahead of a cut), `videoCropPayload.test.ts` (Compile's plain sentence, the default overlay compiles), `captionsProgress.test.ts` / `whisperManager.test.ts` / `captions.test.ts` (the burn's opening event has no percent, a probe frame of 0, `shiftSrtToRange` with a speed, `isUsableFrame`, the finished gate sentences), `clipKit.test.ts` (the YouTube Short's 180 s, `clipForExport` in the queue, `buildKitSrtRequest`, `kitCanceledMessage`), `highlights.test.ts` (`hookWindow` is `null` under 0.5 s, `hookWindowKey`), `videoStore.test.ts` / `ProjectIO.test.ts` (overlay normalization; both staleness baselines, the playhead for a video that opened, the toast ids and sentences), `AudioStudio.test.ts` (the lead-in and the grammatical list), `templateTruth.test.ts` (the sample-text rule over the Asset Library), and `extract.test.ts` (each child found by the file it was asked to read); the E2E count is 215 + 8 = 223; test:media is 162 passed | 9 skipped, the 7 new cases being the odd-sized re-attach (VP9, VP8, VP9 with a cut, plus the two fixture checks) and the kit's captions against the loudness of the kit's own export; round 62 added one file, `src/main/ipc/videoRemoveKitDir.test.ts` — the real `video:removeKitDir` handler on real folders: an empty kit folder goes, a folder with a file or an empty subfolder stays, every refusal is a console note, a path that fails the gate is refused before anything is touched — and grew the ones that already guard its surface: `ExportPanel.test.ts`
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

**Round 85, Track B (T-136; the count line above is the expediter's).** One new file, `tests/unit/stderrCapped.test.ts`: a syntax-tree scan of every
`<x>.stderr.on('data', handler)` under `src/main` that fails on a handler which accumulates (`x += ...`, `x = x + ...`, `.push(...)`) without assigning
the accumulator a tail of at most 16384 (`x = x.slice(-N)`), with a discrimination block over sample code (the bare accumulator, the tail of something
else, a head slice, a named constant, a bigger cap, a handler passed by name, stdout and other events) and one over its own accounting against the
audited-exceptions table (a file with more, fewer or no uncapped handlers than its row allows; a stale row). The table holds what the scan found and
this round did not cap: the ebur128 loudness scans (their stderr IS the measurement), `ffmpeg -version`, and the two ffprobe header reads. Grown
files: `chatPeaks.test.ts` (the rank is the densest window, the tie-break, the 0 to 60 clamp, the rule sentence tied to the constants it names),
`audio.test.ts` (the pick-time sentence), `importDiagnostics.test.ts` (a quoted file name is not a cause; a real cause still is, with a lone quote,
two quoted names, and a quoted name beside it), `concatRunner.test.ts` (the fake ffmpeg now takes an exit code per command: a lost FIRST segment at any
exit, the exit-0 control, a Cancel that wins), `failurePathLanguage.test.ts` (the mood board's cache clear and tile remove). Layer 5 gains one block,
"a compilation whose FIRST segment is lost at the join names its clip", which runs the real `runConcat` with segment 0 deleted between the list and the
join (a directory watcher on the runner's scratch folder), on the bundled 7.0.2 and on the distro's 6.1.1.

**Round 86, Track A (T-137; the count line above is the expediter's).** No new unit file; four grew and one block was appended to each shared one.
`recordingQuit.test.ts` gains "a Discard cancels its own take and no other (T-137 (2))": two takes saving at once over the REAL convert module and the
real handlers (only the ffmpeg child is a stand-in), the MP4 convert and the WebM remux both, a Discard on the second take, and the first take asserted
by what is on disk and in the registry (its child unsignalled, its output in place, its raw take there, its run open, then a success that reaps the temp
take), plus the channel's gates (no id, a malformed id, an id that names no take) and a quit after a Discard. `convertCancel.test.ts` and
`convertQuit.test.ts` gain the owner-is-the-take blocks, `saveCard.test.ts` the Start refusal's sentence, `mediaFormats.test.ts` the preview copy's skip
sentence, and `interactionWiring.test.ts` the "T-137 Track A" block (one pin per item, and one that reads the guides for the four `RunningCancel`
placements). The existing owner literals (`'recording'`) in `convertCancel`, `convertQuit`, `cancelSentinel`, `recordingCancel`, `recordingQuit` and
Layer 5 are `recordingOwner('take-a')` now: the type has no owner-wide recording cancel. Layer 5 gains one block, "a Discard on one take leaves another
take's save running", two concurrent real encodes of two takes with one cancel (bundled 7.0.2 and the distro's 6.1.1). The Playwright cases: audio.spec.ts
"T-137 (1)" (2), record.spec.ts "T-137 (2)" (2), video-pipelines.spec.ts "T-137 (3), (4)" (2) and "T-137 (5)" (1).

**Round 86, Track B (T-137; the count line above is the expediter's).** Three new unit files: `src/main/ipc/projectSave.test.ts` (the REAL `project:save`
handler with only electron stood in for: a project over the size limit is refused in its sentence before the dialog and writes no file, one exactly at the limit is
written and `validateProjectJsonString` accepts the file, the file is the compact serialization the size was measured on), `src/shared/imageBounds.test.ts` (the
arithmetic of the bounded copy and the two numbers) and `ChatHighlightPanel.test.ts` (`peakRange`, the one clamp the row and "+ Clip" share). Grown files:
`projectValidation.test.ts` ("one size rule": a project one under, at and one over the limit is allowed or refused alike by Save, Open and autosave; the three sentences
are finished lines `userFacingError` lets stand; the size rounds UP; and the `customPresetIds` rule for 5, `{ a: 1 }`, `true`, a string, `null` and a list with a non-string),
`useAutosave.test.ts` (on the fake clock with the real stores: a grid toggle, grid size, snap and a scan's derived results write nothing after a write, with a real edit and an
undo as controls; a 51 MiB picture is not sent, raises ONE toast with its id, is not told again while it stays over, resumes by itself and is told again on a new overflow),
`videoStore.test.ts` (`pruneCustomPresets` over a number, an object, `true`, a string and `null`), `silentLoudnorm.test.ts` (a loudnorm block after 600 KB of warnings still reaches
the second pass), `noPicture.test.ts` / `concat.test.ts` / `concatRunner.test.ts` (both stderr patterns against the echoed `Output #0` / `Input #0` lines, a metadata value and a
path-first error line, which must not match, and the real lines, which must; the runners succeed into a folder named with either phrase and still refuse on the real lines). The
scan in `tests/unit/stderrCapped.test.ts` now walks from a `slice(-N)` up to its handler and counts it only when nothing can skip it (an `if`, `?:`, `&&` or `||` guarding it
may mention the accumulator and nothing else), with a discrimination block for exactly the shape that shipped (`if (!collectStderr && stderr.length > 16384) ...`) and for
each way a guard can hide; the real-tree case is red on the unchanged `audio/process.ts`. Pins that named the moved code were re-pointed, not loosened: `docClaims.test.ts`
(the 800 px cap is `LAYER_DRAWN_MAX_DIM` in `imageBounds.ts` and `ImportPanel.tsx:65` uses it), `networkAllowlist.test.ts` (`new Image(` is in `lib/boundedImage.ts` now,
the one place a picture is decoded to be copied), `interactionWiring.test.ts` ((13) reads `loadImage(src, 'anonymous')`). Playwright: home-chrome.spec.ts "T-137 (6): a project
over the size limit" (four cases on a seeded project 150 characters under the limit, so a real "+ Add text" is the edit that crosses it), image.spec.ts "an imported picture is
stored as a bounded copy" (a 4000x3000 PNG, a 3000x2000 JPEG, a half-transparent PNG and the 64x48 control; the node's decoded `<img>` is the stored src), video-pipelines.spec.ts
"the range a row shows is the range + Clip adds" (and the three existing cases that depended on the raw range: T-48's two assertions, the leave-and-return case, and the T-136 (9) layout case, which now loads a 10-hour 1 fps fixture so the widest row is real), references.spec.ts "→ Canvas embeds the picture" (send, Clear
thumbnail cache, visit the canvas fresh; a transparent thumbnail keeps its alpha). Layer 5 gains two blocks, both run on the bundled 7.0.2 and on the distro's 6.1.1: "a path that
contains a phrase ffmpeg uses is not ffmpeg saying it" (the premise that the phrase IS in a successful run's stderr, a real compilation into a folder named "Impossible to open",
a real export into and from one named "Output file is empty", a reframe, and the control that the real lines still refuse there) and "the loudness measure pass keeps a 16 KB
tail and the measurement is in it" (a damaged mp3 whose decoder floods stderr past 32 KB: the last 16 KB parse to the same measurement as all of it; and a two-pass export through
the real runner whose decoded samples are compared with a hand-built linear two-pass render, after proving that the single-pass fallback writes different samples, so a measurement
that did not survive the cap would fail it: the first version of this case only checked the level and a 16-character tail passed it). One existing Layer 5 case now names its files like the runner's segments (`seg-<job>-<index>.mkv`), because the pattern it reads is the demuxer's line about one.

**Round 87, Track B (T-138; the count lines are the expediter's).** One new unit file: `src/renderer/src/lib/boundedImage.test.ts` (`loadImage` with `Image` stood in
for by a class that records what is assigned and in what order: the no-referrer policy is set, before `src`, with and without `crossOrigin`; a picture that does not decode
rejects in the sentence callers report). Grown files: `imageBounds.test.ts` (`storedImageMaxDim`: twice the longer side for the templates' real sizes, the 1600 floor for an
emote and a card, a portrait document read by its height, every size that is not a size back to the floor, and what the stored copy does with it: a 4000x3000 picture
3840x2880 on the 1920x1080 overlay and 2560x1920 on the 1280x720 thumbnail, a 1920x1080 one kept whole), `projectValidation.test.ts` (the Save and autosave sentences name
what frees bytes and say nothing of shrinking; the existing "one finished line `userFacingError` lets stand" case holds the 240-character and no-known-cause rules for
both), `useAutosave.test.ts` and `projectSave.test.ts` (the same sentences, where the toast and the thrown error are read), `interactionWiring.test.ts` (a "T-138 Track B"
block: ImportPanel reads the document after the load and has no fixed bound left; the Clip Kit's Cancel question is one component, held by `ClipKitRunning` and drawn after
the live wrapper, put down in the render that finds no card; the restore run is claimed before the first await, given back in a `finally`, `applied` raised after the
apply and before the navigate and heard by a subscription), `docClaims.test.ts` (USER_GUIDE's stored-copy and over-limit wording against the code, DESIGN_GUIDE's placement
rule and the order a new Cancel is decided in, the STYLE_GUIDE sentence's place). Pins that named the moved code were re-pointed, and said so in the pin: the T-134 (7) busy-flag
pin (`restoring` is the run slot's now, `clearing` is still local), the T-137 (3) fragment shape of `ClipKitRunning`, the T-131 (9) and T-136 (1) KitCancel pins (the clip
list's `KitCancel` keeps its own state; the card's button and question are `ClipKitRunning`'s), and `runningJobControls.test.ts`'s title list (two `RunningCancel`
titles in `ClipKitButton.tsx`, the clip list's and the card's). Playwright: image.spec.ts "T-138 (2)" (two cases: the 1920x1080 overlay and the 1280x720 thumbnail; the node's
decoded `<img>` is the stored src) and the T-137 (6) case adapted to the default 1200x800 canvas it runs on (2400x1800, 2400x1600, and a 3000x2000 transparent fixture so the
alpha case still exercises the bounded path); home-chrome.spec.ts "T-137 (6)" (the two sentences it pins); video-pipelines.spec.ts "T-138 (4)" (three cases: the closed-video
card's question has no `[aria-live]` / `[role="status"]` ancestor, adds no gap, Keep running keeps the kit and Cancel jobs ends it; a question nobody answers goes with the
kit; the clip list's the same ancestry); record.spec.ts "T-138 (5)" (a Restore held open, Stream Graphics and back to Home: "Restoring…" with Restore and Clear off and Later on,
then the banner gone, one "Restored from autosave", no skip toast, one extraction request in main, and, with the sound closed and Home visited again, an offer whose Restore can be pressed: a run that was never ended survived its first mutation until this last step was added).

**Round 87, Track A (T-138; the count line above is the expediter's).** One new file, `src/main/ipc/videoScanSingleFlight.test.ts`: the REAL
`video:findHighlights` handler with only electron and the scan stood in for. A second start while one runs is refused naming the video (the same video too: a
reloaded panel is fresh, the scan main runs is not), two starts in one breath run one, the slot comes back after a success, a failure and a cancel, a refused
start does not give the running one's slot away, a path refused at the boundary never takes it, the sentence is one `userFacingError` lets stand through
Electron's envelope, a long name is cut by code point, and the clip's hook analysis (its own superseding pass) is not gated. Grown files: `concat.test.ts` and
`concatRunner.test.ts` (the lost-part line as each platform prints it - glibc `0x...`, mingw-w64's bare lowercase hex, which is a capture of the shipped exe, the
Microsoft CRT's uppercase, `(nil)` - as printed, in CRLF, and straight after a stats line that ends in a bare CR; the echoed-path negatives for every pointer; another
demuxer's context and a bracket that closes on a later line are not it; through the real runner at exit 0 and 254 with the sentence naming the clip) and
`docClaims.test.ts` (the guides name every `LUFS_PRESETS` target: USER_GUIDE's Levels bullet by the picker's own label, README's line by the number). The
Playwright case is video-pipelines.spec.ts "Scan VOD - one scan at a time, in main (T-138 (9))" (1).

**Round 88, Track A (T-139; the count lines above are the expediter's).** Two new unit files and 126 new unit tests (190 files / 5175 tests become 192 / 5301 on this track alone: `fsAtomic.test.ts` 33, `atomicWrites.test.ts` 23, and
`userFacingError.test.ts` +23, `importDiagnostics.test.ts` +13, `autosave.test.ts` +10, `moodboard.test.ts` +7, `projectSave.test.ts` +5, `image.test.ts` +5, `captionsSaveSrt.test.ts` +4, `captionsWriteKitSrt.test.ts` +3). `src/main/fsAtomic.test.ts`:
`writeFileAtomic` over the REAL `node:fs/promises` with the failures a disk makes injected (a write that puts half its bytes down and then fails, a refused
rename, a refused cleanup, a drive that cannot fsync) - the target is byte-identical and no tmp is left in every one, the error is the disk's own, the bytes written
are exactly the bytes given (text, and all 256 byte values), the tmp is in the target's folder and never the target, and two saves in flight leave one of them whole.
`tests/unit/atomicWrites.test.ts`: a syntax-tree scan (the `stderrCapped.test.ts` shape) that finds every `writeFile` / `copyFile` / `appendFile` /
`createWriteStream` under `src/main`, requires each file's count to match its audited row (a reason, or NOT CONVERTED), holds the four converted files to the helper's
call counts, and has a discrimination block over the shapes it must and must not see (an aliased import, a namespace call, a comment, a string). Grown files, each a
new `describe` over the REAL handler or module with the injection in a `vi.mock('node:fs/promises', importOriginal)` that is off unless a test turns it on:
`projectSave.test.ts`, `image.test.ts`, `captionsSaveSrt.test.ts`, `captionsWriteKitSrt.test.ts` and `moodboard.test.ts` (a failed write leaves the old file
byte-identical, a first write that fails leaves no file, a success leaves no tmp, and the sentence the person reads; the `.srt` copy is checked byte for byte with a
byte order mark, CRLF and a non-UTF-8 byte; the board lock's clean-up is held to raising no `unhandledRejection` across two failed writes, a defect the fault tests found
in code that was already there), `autosave.test.ts` (overlapping writes of very different sizes in both orders over four trials, a burst of six, the quit
flush beside a periodic write through the real `quitFlush`, a tmp of its own per write, a failure not wedging the chain - once by a disk error, once by a call that
throws - the failed write's tmp checked BEFORE the next write could sweep it, the sweep of a cut-off tmp and Clear's), and `userFacingError.test.ts` /
`importDiagnostics.test.ts` (the win32 "Permission denied" lines: the sweep's export and probe lines and two captured again under Wine from the shipped
`ffmpeg.exe`, through the envelope and bare, every runner's prefix, LF and CRLF, with the controls that must not move). Two techniques worth keeping: an `fs`
stand-in that fails HALF-WAY (the first half of the bytes reaches the file, then the error) is the failure the bug was about - a stand-in that fails before it writes
anything proves nothing about truncation; and a fault test is checked for the leftover BEFORE the next operation, because a cleanup in the next call (the autosave
sweep) can hide a leftover the failing call should have removed (the first draft of the failed-write test survived its mutation for exactly that reason).
No Layer 5 case: no ffmpeg command, filter or chain changed (the `chain.ts` edit is a comment). Layer 2: two new cases in `image.spec.ts`, "a save in flight leaves a
tmp in the folder (T-139 (1))" (458 become 460 Playwright tests on this track alone), and two new helpers, `tests/e2e/slowWrites.ts` and `tests/e2e/atomicTmp.ts`. The
atomic write put `<name>.<8 hex>.tmp` in the folder a test lists for the length of a write, and the first landing's full run failed once on it: `savedNames` was a bare
`readdirSync(downloadDir)` and `waitForDownloads` polls a COUNT, so it read the tmp as a saved file. A race that lives for a millisecond cannot be tested by waiting
for it, so `holdAtomicRenames(app)` wraps `fs/promises`'s `rename` in the main process (the `mainSpawn.ts` technique: `process.getBuiltinModule` and
`syncBuiltinESMExports`; nothing in `src/` changes) and parks the writer's rename at a gate the test opens (`releaseAtomicRenames`), `heldRenameCount` being the proof
the window really was open. The cases hold the rename, assert the folder holds exactly the tmp, that `savedNames` is empty and `waitForDownloads(1)` does not return, then
release it and assert one whole PNG (and, for the emote pack, three) and no tmp. `withoutAtomicTmp` filters on `ATOMIC_TMP`, which `src/main/fsAtomic.ts` exports beside
the line that builds the name; `fsAtomic.test.ts` pins the two together, and `atomicWrites.test.ts` fails on any `readdirSync` over `downloadDir` / `exportsDir` in a
spec outside `withoutAtomicTmp(...)` (`rawNames` is the one listing that shows the tmp, for the cases about it). The rest of every write's success end state is the
existing Playwright cases, unchanged.

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
- **Open a second session through the bridge to aim a call at a stranger (T-137 (2)).** The bug needed two takes, and the fixed product offers no way to
  start the second one while the first is saving, so the case does not try: `window.api.recording.begin()` opens a real second session, its Discard
  (`cancelSave(id)`) is called with the second id while the first take's convert is held, and the assertions are on the first take (it finishes, the file
  is h264). On the unchanged build the same call answers true and the first take is gone. A call with no id goes through the same bridge and is read for
  main's refusal.
- **A live region is an element with an identity (T-137 (3)).** "Announced reliably" is a screen reader's behavior, but its precondition is DOM: the
  region exists BEFORE it has something to say. The case takes `elementHandle()` of the wrapper while nothing is running, drives the state that fills
  it, and asserts the handle `isConnected` and now holds the text; a region that mounts with its content fails the first locator (count 0) and the
  identity check. The empty region's cost is read too (the 20 px gap between the header and the studio, before and after).
- **Measure the wrap, not the label (T-137 (4)).** `expectOneLine` on the button, at 1632 x 918 and at 1024 x 640, plus the geometry that makes it true
  (the Cancel's top at or below the button's bottom, its right edge on the button's, the button less than 34 px tall). It was red on the unchanged build at
  the default window, "wraps onto 2 lines", the finding's own measurement.
- **Ask the DOM what a dialog is inside (T-138 (4)).** A dialog that is announced as part of a live region is a fact about its ancestors, so the case reads it
  from the page: `document.querySelector('[role="dialog"]').closest('[aria-live],[role="status"]')` is null. It is red on the unchanged build with the wrapper
  named (`div[polite]`), and the same call on the clip list is the control that passes on both builds. A `Modal` does not portal, so where it is written is where it sits.
- **Count what main was asked, from a wrapper that sees the original command (T-138 (5)).** "One extraction request" is a fact of the main process: a second wrapper
  around `child_process.spawn`, installed AFTER `installSpawnStall` so it sees the command before the stall rewrites it, counts the spawns of ffmpeg with `-vn` whose
  output is in the scratch folder `imagii-audio`. A held run is a state the test makes (the first ffmpeg is held 15 s), and "away and back" is Stream Graphics and Home
  inside that window; the case seeds no `place`, so the banner going is the banner going and not Home being left.
- **Hold a child with SIGSTOP and read its life from /proc after the quit (T-138 (9)).** "A scan is running" and "no scan survived the quit" are facts about the
  process table, and a scan of the 20-minute fixture takes two seconds. `holdScans` wraps `child_process.spawn` in main (the `installSpawnStall` technique), recognizes
  the full-source scan by its filter and the absence of `-ss` (the per-clip hook analysis has one), records the PID and stops the child (`SIGSTOP`) inside the same call,
  so there is no window; `SIGKILL`, which is what Cancel and the quit sweep send, still reaches a stopped process. The PIDs are recorded before `app.close()`, and
  `scanAlive` reads `/proc/<pid>/stat` (a killed child nobody has reaped is a zombie, and is gone). The press that must be refused comes after a real
  `webContents.reload()` (it keeps the URL's hash, so the page is back in an empty Video Studio) and the video dropped again. The assertions are the sentence as an
  error toast, ONE scan child in the record, the panel idle again, and no survivor. A scan that outlives the quit also keeps the debugging pipe Playwright closes the
  app through (the child inherited it), so `close()` is raced against a bound and the survivors are what is reported; the `finally` kills only the PIDs the test recorded.
  The assertions after the press are soft, so one run on the unchanged build reports the missing sentence, the second ffmpeg, the busy panel and the survivor together.
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

**Round 87 (T-138): the lost-part guard against the SHIPPED Windows exe, under Wine, and the block that makes the platform a variable.** The join's "Impossible to
open" guard (T-131 (1), T-136 (15), T-137 (12)) spelled the context's pointer the way glibc prints it, `[concat @ 0x40dea0c0]`, and the exe the product ships prints
`[concat @ 00007fffff45eb80]` in CRLF lines: every case of those blocks that reads the real line was red on it (five), green on both Linux majors, and only
`release.yml`'s windows-latest run would have said so, at tag time. Two additions, both run on the bundled 7.0.2 and on the distro's 6.1.1. (1) The block "the lost-part guard reads
this binary's own line in every platform's dress" takes the line each binary REALLY printed for a lost first input and a lost later one, re-prints the pointer of every
`[<context> @ <pointer>]` prefix as glibc (`0x...`), mingw-w64 (bare lowercase), the Microsoft CRT (bare uppercase) and glibc's null pointer print it, and asserts the guard and
the index parser read it as it came, in CRLF, and straight after a stats line that ends in a bare CR; its discriminator runs a clean join at `-loglevel debug` (the demuxer's
own other lines with the same context, and a line naming each segment file) through the same dresses and asserts nothing is a lost part. It is red on the unchanged regex on
EVERY binary, not only the Windows one (three cases on the Linux majors, four on the exe). (2) The T-131 (1), T-136 (15), T-137 (12) and new blocks run on the exe itself.
**The recipe, none of it in the repo:** the gyan.dev 6.1.1 essentials `ffmpeg.exe` (the build `ffmpeg-static` ships for win32), a Wine (`wine64`, no display,
`WINEDLLOVERRIDES=mscoree,mshtml=d`) with a private `WINEPREFIX` that has `zlib1.dll` beside its system DLLs, a three-line wrapper (`exec wine64 ffmpeg.exe "$@"`), a one-line
module exporting the wrapper's path aliased for `ffmpeg-static` in a throwaway config object (with `@shared`; `ffprobe` stays the bundled Linux one, which the tests' own
probes use), and `-t` to pick blocks. Every ffmpeg start costs about 0.6 s under Wine, so the whole file takes about an hour and a half (5383 s here). Red on the unchanged tree
(the exe): T-131 (1) twice (`what ffmpeg says of an empty segment...`, `the join's "Impossible to open" line names the segment file...`), T-136 (15) twice (`the shape...`,
`through runConcat...`), the T-137 (12) control that a real lost segment still names its clip, and the new block; green after.
**The whole file on the exe: 354 passed, 16 failed, 13 platform-skipped of 383, and none of the 16 is a defect of the product.** Five are expected platform differences,
pinned for the bundled Linux binary and inverted on a build that has the thing: the four `KNOWN linux-binary gap` drawtext pins (the exe HAS `drawtext`) and the `KNOWN
linux-binary bug: mpegts input crashes the convert child` pin (6.1.1 does not crash; the distro's 6.1.1 fails it the same way). One is Wine's timing: the waveform case "Cancel
kills the real ffmpeg mid-read" bounds the answer at 1500 ms and the exe answered in 2043 ms (2973 ms in the sweep's earlier run of that case), because a SIGKILL of the wrapper does not take
the Windows process with it at once; the case passes on both Linux majors. Ten are the caption burn-in cases (`caption burn-in`, `burned caption size follows the frame`, and
the two captioned cases of the odd-sized block): the prefix has no fonts, so libass (DirectWrite) logs `fontselect: failed to find any fallback with glyph 0x0 for font:
(Arial, 400, 0)` and paints nothing (PSNR 99 dB against the control, 0 white pixels); the same command on the same exe with `fontsdir` pointing at a TTF paints 3256 glyph pixels.
Real Windows has Arial, so the release run is where those ten are confirmed.

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

## Round 88, Track B (T-139): what the new cases hold

- **Unit.** `src/shared/imageBounds.test.ts` (`placementFor` at the emote, the banner and the overlay, the margin giving way, an invalid document, and a sweep of pictures x
  documents for "wholly inside, aspect kept, never enlarged"; `nextStoredDim`; `chooseStoredCopy` with a stand-in encoder: which copy, in what order, opacity asked once and
  only when needed, the budget boundary, the 1 px end), `src/renderer/src/lib/boundedImage.test.ts` (`storedDataUrl` over a stand-in `document.createElement('canvas')`: the
  canvas sizes and formats, the JPEG quality, opacity read on one canvas), `canvasStore.test.ts` (the layer makers' position), the new
  `src/renderer/src/components/restoreRun.test.ts` (the withdrawal signal), and pins in `interactionWiring.test.ts` ("T-139 Track B": the placement is read after the load
  by every way a picture arrives, the ladder, the withdrawal after the apply and the press-time backstop inside the claim, the three record-making buttons, Welcome),
  `docClaims.test.ts` (the guides' placement, budget and figures; the decision order held to the code it classifies, panel by panel) and `truthInCopy.test.ts` (the Captions
  setup names the zip, the .dll files and the Release folder; the two links on the card are exactly the releases page and the model's page).
- **Playwright**, each red on a build of the unchanged tree first: image.spec.ts "a picture is first placed wholly on the canvas it lands on" (the emote by drop, chooser and
  paste, the banner, the overlay as the control) and "an incompressible picture is stored within the byte budget" (4000x3000 uniform-noise PNGs, 35 MB opaque and 41 MB with a
  transparent corner, on the 4K overlay: the opaque copy 13.4 million characters as a JPEG, the transparent one a PNG stepped down to 1687 px at 9.1 million, autosave written
  with both and never paused; the unchanged build stored 47.0 and 54.2 million and paused it), references.spec.ts "-> Canvas places the picture wholly on a small canvas",
  home-chrome.spec.ts "the autosave banner goes when Open project lands" and "a double-click on Welcome's Let's go" (at 1366x768 and 1306x734), video-pipelines.spec.ts and
  audio.spec.ts "a double-click on a record-creating button makes one record" and the Captions setup case (the zip, the .dll files, the link's address).
- **A write slowed from the test.** `tests/e2e/slowWrites.ts` replaces `writeFile` of `node:fs/promises` in main with one that waits when the target is in a presets folder
  (the technique of `mainSpawn.ts`), so a second press lands while the first write is still out. Without it the two layers of the fix (the repeat press ignored, the save
  claimed) cannot be told apart: a fast write is over before a real second press arrives. The repeat press is held by a second press that comes AFTER the write (a clickCount-2
  press by hand); the claim and the disabled button by a double-click and an Enter during the slow write.
- **Fixtures.** Noise comes from the bundled ffmpeg (`color=...,noise=alls=100:allf=u`, `-compression_level 1`; the transparent corner is `alphamerge` with a gray mask), and
  goes in through the real file chooser, not as a base64 argument over the debugging protocol.

## Round 89, Track C (T-140): what the new cases hold

- **Unit.** `src/shared/userFacingError.test.ts` (a whisper exit is the captions engine's: a damaged model, other codes, `null`, no stderr, a crash code that is not the missing-files one, a code that only contains its digits, the digits in the stderr; the missing-files code 0xC0000135 in both spellings Node or .NET might print - 3221225781 and -1073741515 - bare, wrapped and with a stderr tail; the burn-in and FFmpeg exits keeping the video tool's sentence whatever code they carry; only a message that STARTS with the exit counts; Permission denied, a full disk and a missing file keeping their own sentences), `src/renderer/src/components/restoreRun.test.ts` (`withdrawWhenSessionGainsWork` over the real canvas store: a landing withdraws once and every listener hears it, at once when the session already holds work, nothing for a canvas with no layers, the way back stops it, a Restore's own landings withdraw nothing and the guard is the run and not a latch), `src/renderer/src/modules/project/ProjectIO.test.ts` (`subscribeSessionStores` over the real video, audio and canvas stores; `describeRestoreRefused` for every combination of the three studios: one line, at most 240 characters, a period), the pins in `interactionWiring.test.ts` ("T-140 Track C"; the T-139 (5), (9) and T-18 pins follow the code, and the "every disabled button looks disabled" scan reads `aria-disabled` with discrimination rows both ways) and `docClaims.test.ts` (USER_GUIDE quotes the failure sentence the code says; the ledger and the Home spec no longer call the backstop unreachable; STYLE_GUIDE's closing section is last and the moved rules are inside the guide; the 256-sample agreement is qualified; the `AutosaveRestore.tsx` cites in the Home table were re-pointed, not loosened).
- **Playwright**, each red on a build of the unchanged tree first (the focus cases a second time, after the first draft asserted the button's attribute and not the focus loss): home-chrome.spec.ts "T-140 (6)" (a sound being extracted when the person went Home lands and the banner goes by itself; a video-and-sound Restore keeps saying "Restoring…" - green on the unchanged build by design, it holds the guard) and "T-140 (9)" (Escape from an entry and from Clear list, Escape with the focus elsewhere taking nothing, Clear list from the keyboard, the pointer leaving the list, a keyboard pick), audio.spec.ts "T-140 (7)" (a held Enter) and "T-140 (8)", video-pipelines.spec.ts "T-140 (8)" and "T-140 (10)" (a stand-in engine that exits 1, and the missing-files exit through a stubbed `captions:transcribe`).
- **Focus is asserted where the bug is.** A keyboard press under `slowPresetWrites` is checked HALFWAY through the write (700 ms into a 1.5 s hold) with `toBeFocused()`, before anything else about the button: the first draft asserted `aria-disabled` first and went red on the unchanged build for the wrong reason (the attribute was absent, not the focus lost). Playwright's `toBeDisabled()` also counts `aria-disabled`, so the T-139 (9) cases that use it still pass on the new attribute and were left alone.
- **A held key is `keyboard.down` twice.** Playwright marks a second `down` of a key already down as a repeat (`repeat: true`), as the existing held-key cases rely on; the repeats here arrive 600 ms after the press, as after an OS repeat delay, so the first press has saved and cleared the box (a repeat sent at once would find the claim up and be dropped in silence, and the red toast would never be seen).
- **A Windows exit code is not producible here.** A shell's exit status is one byte, so 0xC0000135 is a unit and the toast path is driven by a stubbed `captions:transcribe` that throws the message main would; the real exit is a Windows hand-test.

## Round 89, Track B (T-140): what the new cases hold

- **Unit.** The new `src/shared/newText.test.ts` (`contrastRatio` against the ratios `tokens.ts` documents, `inkFor` over the template backgrounds, white, a transparent or unreadable one and every grey, `newTextSize` for the pages the app makes and a sweep of shapes, `estimatedTextBox`, `newTextLook` wholly inside every document), `canvasStore.test.ts` (`textLayerFor` over the default page, every template and every asset: inside, 4.5:1 against what is shown, a token color; the last removal leaves the blank page, undo and redo, the walk back; `keepsRatioOnCornerDrag`), `hotkeyTable.test.ts` (the Shift+drag row's evidence) and `docClaims.test.ts` (the image.spec.ts cites re-pointed: Canvas.tsx moved 13 lines and canvasStore.ts 2 to 6).
- **Playwright**, each red on a build of the unchanged tree first: image.spec.ts "+ Add text lands wholly on the document and can be read against it" (the Konva text node's `getClientRect` relative to the document layer, so the stage's zoom is out of the numbers), "a corner drag keeps a picture's and a word's proportions" (a real corner drag by the Transformer's anchor, Shift held with `keyboard.down` so the mouse events carry it; the export decoded by the bundled ffmpeg and the red box measured), "start blank after a template's last layer is removed is the blank page", and "the Export bar and the Layers card are on screen at the smallest window".
- **A measurement that does not click.** `layout.ts` `expectInViewport` reads the element's box and what is on top at its centre, and the cases call it between a resize and nothing else: every older case reached these controls with `click()`, which scrolls the element into view first, so the Export bar sat 54 px below a 640 px window under green tests. The last case of the block is its negative control (an element past the edge, one a dialog covers). The wheel case runs a 1024x500 window, shorter than a person can drag the window, to prove the root scrolls.
- **The contrast the case checks is its own.** The (2) case spells the luminance out instead of importing `contrastRatio`, so the rule is not checked by itself; and the spec imports nothing new from `src/shared` (it has to load on the unchanged build the cases are proven red against).

## Round 89, Track A (T-140 (1)): what the new cases hold

A render is written to `<stem>.<8 hex>.partial<ext>` beside the file it will become and renamed over it when whole (`main/ffmpeg/partialOutput.ts`). Four layers hold it, each for the half the others cannot see.

- **Unit.** `partialOutput.test.ts` is the helper on real files: the name (extension LAST, per format, new on every call), `discardPartial` (removes a partial and refuses any name that is not one, so the failure path cannot delete the target even when handed it), `commitPartial` (`replace` and `beside`; a Cancel recorded before the swap wins; a refused swap throws the disk's error and removes the partial; EBUSY / EPERM / EACCES are tried again inside a budget, and a refusal that is not a lock is not; a swap onto an existing file that stays refused for good lands the render beside it at the next free name in `replace` mode only, answers that path, leaves the held file byte for byte, and gives way to a Cancel recorded during the last try), and `finishPartial` (the work's value and the landing path, the work's own error untouched). `cancelSentinel.test.ts` is the table over every real runner with a child that writes where ffmpeg writes (the last argument of its command): ffmpeg is never told to write the target, a Cancel or a failure after the output was opened (exit 228, the full drive) leaves the file that was there byte for byte (sha256) and nothing else in the folder, a Cancel recorded between the exit and the swap wins, and a name taken while the render ran is not replaced; the compilation's join and the picture-in-picture have the same rows. `recordingCancel.test.ts` runs the recording's save over the real convert module and the real latch for the MP4 and the WebM: a Discard, a crash and a full drive leave the earlier take, the fallback copy goes to a partial and is swapped in (the earlier file is never unlinked first), a swap the disk refuses is not blamed on the convert. `atomicWrites.test.ts` gains the ffmpeg-spawn audit (every `spawn(ffmpegPath, ...)` under `src/main` is in a table with its `finishPartial` call or the reason its output is no person's file) and the e2e listing scan covers the render folders. The files that pin command lines (`muxCodec`, `exportProgress`, `silentLoudnorm`, `singleTrackTail`, `audioChainValidation`) stub the swap and say so; the ones that read folders (`concatRunner`, `reframeProgress`, `noPicture`, `videoExportBatch`, `captionsProgress`, `reattachCollision`, `recordingQuit`) use a child that writes its output.
- **Layer 5, on both majors.** The block "a render is written beside its target and swapped in only when whole" runs ten runners (the platform export, GIF, reframe, the compilation's join, picture-in-picture, the audio export, the re-attach's mux, the caption burn-in and the recording's MP4 convert and WebM save) over an existing target, three ways each: a Cancel after ffmpeg opened its output (the target is byte for byte what it was WHILE the render writes, and after, and nothing else is in the folder), a finished run (ffprobe reads the new file; `replace` runners: the old bytes are gone; `beside` runners: the earlier file is untouched and the new one is `name (2)`), and a run into a folder with nothing at the name. "The partial of every format a runner writes is read as that format" runs the real runner for mp3, wav, flac, m4a, upper-case `.MP3` / `.WAV`, mp4, gif, webm and jpg, and asks ffprobe for the container and codec the target's name would have given. No runner writes mkv or ogg to a person's path (a compilation's segment is Matroska in the job's scratch folder). The recording's cases need electron: a stand-in for `electron` is installed for the block, the handlers are the product's. Run on the bundled 7.0.2 (`npm run test:media`) and on the distro's 6.1.1 with the throwaway config the recipe above describes.
- **Playwright.** `audio.spec.ts` "T-140 (1): an audio export is the old file until the new one is whole" (red on the unchanged build: the Save dialog's earlier file was gone after Cancel), `video-pipelines.spec.ts` "T-140 (1): the file a render replaces is whole until the new one is" (a Discard in the middle of the recording's convert over an earlier take: red on the unchanged build; the folder export run again, cancelled, then finished: red on the unchanged build only for the partial's name, because T-106 already wrote that beside the earlier export and the earlier export was never at risk there, and kept as the pin that the partial left no hole in it). The specs that waited for the in-flight file at its final name now wait for the partial (the burn-in's Cancel, the audio render's Cancel, the three quits, "Cancel mid-encode"). Every listing of a render folder says what it wants (`tests/e2e/atomicTmp.ts`): `withoutAtomicTmp` for the finished files (a poll on a count would read an in-flight partial as an export, the T-139 lesson again), `withEverything` for "nothing is left" after a Cancel, a failure or a quit, `partialsOnly` for the render still being written; `atomicWrites.test.ts` fails a bare `readdirSync` of `outDir`, `kitDir`, `kitParent`, `seeded` or `studio.root`.
- **A file open in another app (the send-back).** Windows refuses a swap onto a file a player or an editor holds without FILE_SHARE_DELETE for as long as it is held, and Linux has no such file, so every layer fakes the refusal where the swap is made: `fs/promises`' `rename` throws EPERM when the DESTINATION is the chosen name and goes through for any other. Unit: `partialOutput.test.ts` (the lands-beside rows for each lock code, the next free number, a transient refusal that lifts and lands on the target, the original error when the folder refuses everything, no redirect for a name nothing is at, in `beside` mode, or for ENOSPC, and a Cancel recorded during the last try), `cancelSentinel.test.ts` (the audio export, the caption burn-in, the mux pass and the re-attach, which must feed the mux the intermediate WAV it LANDED, not a stale file at the first name, and remove both) and `recordingCancel.test.ts` (the MP4 convert, the WebM remux and the fallback copy: `outputPath` is the file that exists and `requestedPath` the chosen one); `atomicWrites.test.ts` fails a `finishPartial` call that throws the landed path away outside its one audited row; `interactionWiring.test.ts` pins that the audio export, the burn-in and Record report, reveal and open the answer. Playwright: `audio.spec.ts` "T-140 (1): an audio export over a file that is open in another app is kept beside it" drives the real Export button with `refuseRenamesOnto` (`tests/e2e/atomicTmp.ts`, which also counts the refusals so a patch that never took cannot pass): the toast names `name (2)` and why, Show in folder reveals it, Edit in Video Studio opens it, the file that was open is byte for byte what it was, and no partial or scratch WAV is left. No ffmpeg command changed, so there is no new Layer 5 block.
- **A test that starts a long render stops it in a `finally`.** The Layer 5 cancel cases start an hour-long audio render and 1080p encodes; a failed assertion before the Cancel left them running behind the next case (found on the first run of the block against the unchanged tree, which was still running ten minutes in when it was stopped).

## Round 90, Track B (T-141): what the new cases hold

- **Unit.** `src/shared/newText.test.ts` gains the T-141 (2) rule: `worstContrast` and `inkFor` over a list (maximin, order does not matter, a tie to the dark ink, an empty list is the workspace, every pair of greys), `surfacesUnder` (an ellipse is its own shape and not its bounding box, a badge or a narrow bar under the interior of the box that touches neither side, a sweep proving a patch of width/16 by height/6 is seen wherever it lies, `rgba()` alpha and layer opacity are laid over what is under them, layer order, a hidden / transparent / unreadable / picture / closed-line layer draws nothing, rotation and scale, a text layer's estimated box as a second colour at 40% for a hint, a project file's garbage does not throw) and `newTextLook` with layers (the corner order top-right, bottom-left, bottom-right, the scan when every corner is taken, a pocket nearer the first corner beating one earlier in the scan, the POG band, the emote's disc, the best of a tie, a document that is not a size, 300 layers inside a bound). `canvasStore.test.ts` holds `textLayerFor` over the default page, all 12 templates and all 9 assets against every colour that can show under the word, `foldTextScale` (T-141 (6)) and the store's `removeLayer` guard and the selection `undo` and `redo` keep (T-141 (8)).
- **Playwright**, each red on a build of the unchanged tree first: image.spec.ts "+ Add text is readable against what is drawn under it, on every template" (the independent oracle is rendered pixels: the stage's document layer drawn at 1:1 with the new word and the editor's chrome layers hidden, as an export draws it, every pixel in the word's box laid over the workspace colour, the lowest contrast against the word's ink reported with where it is), "a word dragged to a size says that size in Properties, and a typed size draws at exactly it" (a real corner drag by the Transformer's anchor, Shift held with `keyboard.down`; the drawn height is read off the node's `getClientRect`, not off the attribute it is compared with) and "Delete after an Undo records nothing, and Redo brings the word back" (keys only: Ctrl+Z, Delete, Backspace, Ctrl+Y).
- **A measurement that cannot grade itself.** The T-140 (2) case held the ink to the document's background with the same arithmetic the rule used, so it was green over a word at 2.92:1 on its own disc. The T-141 case reads pixels and spells the luminance out in the spec (it must load on the unchanged build), and the unit tests of `surfacesUnder` are held by mutations of the geometry (an ellipse as its bounding box, alpha ignored, text layers dropped, a far edge inclusive), not by the rule agreeing with itself.
- **The T-140 cases that carried the old premise were changed as the new rule requires, and say so in a comment:** the T-140 (2) Playwright case no longer holds the ink to the document's background (it holds it to be one of the two tokens), its blank-page case no longer expects the second word at (60, 60), `canvasStore.test.ts` "the emote and the 4K overlay take the light ink" is now the dark ink for the emote, and the T-140 (3) text case reads the drawn scale (the size over 32 px) because a word's node scale is 1 after a drag.

## Round 90, Track A (T-141): what the new cases hold

Three findings and two non-counted parts of the main process: a Save-dialog output that is a file the job reads (item 1), a Discard that landed after the convert exited and a swap the disk refused (item 5), a flush that leaked its handle (item 10).

- **Unit.** `src/main/ffmpeg/sameFile.test.ts` (the helper: a detour, a symlink and a symlinked folder, a name nothing is at, a relative path, win32 case folding against the platforms that keep case, a hard link; the guard: every output and every input, unset inputs, the sentence exactly and through `userFacingError` and the IPC envelope), `src/main/ffmpeg/outputIsInput.test.ts` (the REAL `runAudioExport`, `runAudioMux`, `runAudioReattach` and `runBurnIn` and the three IPC handlers on real files in a temp folder, only the child process and the probes faked, and the fake child is what counts: for each input kind a refusal is "nothing spawned, no run left open, every input byte for byte, the folder as it was"; the same rows on a case-folding platform, where `process.platform` is set to win32 and the output is a case variant of the input; a control per runner so a guard that refuses everything cannot pass), `src/main/fsFlush.test.ts` (`flushToDisk`, the autosave over four writes and `writeFileAtomic`, against the real `fs/promises` with `open` returning the real handle whose `sync` rejects, asked whether it is closed through its own `fd`), `convertCancel.test.ts` and `cancelLatch.test.ts` (a cancel on a run says who asked: a Discard and the quit with no child running, both orders, another take's Discard, a run begun after a cancel; the factory and the plain default), `recordingCancel.test.ts` (a Discard after the exit now deletes the raw take, the quit after the exit keeps it, and a refused swap keeps it and says so, for the MP4 convert, the WebM remux and the fallback copy, with the failed-convert and failed-copy controls) and `tests/unit/atomicWrites.test.ts` (every runner that finishes a partial in `replace` mode asks `refuseOutputOverInputs`, or has a row that says why not).
- **Layer 5, on both majors.** "a Save-dialog output that is a file the job reads is refused before any ffmpeg runs": the real runners on real media (the audio export over its source, a detour to it, a symlink to it and the second track; the mux over its video and over its sound; the re-attach over its video, source and second track and with the scratch WAV as the second track; the burn-in, whole and ranged, over its video and over its .srt), with `node:child_process`'s `spawn` wrapped to COUNT and still start the real thing: the runner is refused, zero children were started (not even a probe), the inputs are byte for byte what they were and the folder holds what it held. The control rows (a different name exports, attaches and burns, and ffprobe reads what came out) are what prove the counter counts. 7.0.2 via `npm run test:media`, 6.1.1 via the alias config.
- **Playwright**, each red on a build of the unchanged tree first: audio.spec.ts "T-141 (1)" (the real Export button with the Save dialog stubbed to the source: the sentence, a Failed row, the source byte for byte and no partial, and another name exporting afterwards in the same session; Re-attach to video over its own video: the sentence, no scratch WAV, the recording byte for byte) and record.spec.ts "T-141 (5)" (the real recorder, convert or remux, the Save dialog stubbed, and `refuseRenamesOnto` for the swap, which counts the refusals: one red toast that is the sentence, a real webm in `userData/recordings` that ffprobe reads, nothing at the chosen name).
- **The burn-in has no Playwright case** (the e2e suite does not install the captions model, as in T-140's burn-in rows): its unit rows and Layer 5 hold it, and the audio export's case holds the shared mechanism end to end.
- **A refusal is asserted by what did NOT happen.** "Rejected with the sentence" is the weak half; the strong half is the spawn count, the byte-for-byte inputs and the unchanged folder, and the open-run count (the quit waits for every run). Layer 5 counts the real `spawn`; the unit file counts a fake one.
- **A stream copy cannot be made "long enough" (non-counted).** Layer 5's T-140 (1) Cancel case for the recording's WebM remux raced the remux: it is a packet copy, over in milliseconds for any take that fits in a test, so under host load ffmpeg exited and the partial was swapped over the target before the 25 ms poll saw the partial ("the target is untouched while ffmpeg writes" failed once in a full run; on 6.1.1 the run came back saved). The case now gates the REAL remux at its exit (`vi.doMock` of `remuxWebm`: the real ffmpeg and partial, a promise awaited after the real one resolves) and the Cancel releases it, so the swap cannot come first; a second case takes the instant after the exit exactly (a Discard there: the earlier file stays, the partial and the raw take go). A fixture's length is the wrong lever for a copy; the seam the product already has (the exit, before the swap) is the right one.
- **Fixtures.** The synthetic Windows paths in `record.spec.ts` and `home-chrome.spec.ts` name `C:\Users\streamer\...`.

## Round 90, Track C (T-141): what the new cases hold

- **Unit.** `src/renderer/src/lib/repeatPress.test.ts` (`ignoreHeldEnter`: the auto-repeat of Enter has its default action canceled, a fresh Enter does not, no other key's repeat does) and a new describe in `tests/unit/interactionWiring.test.ts` ("T-141 Track C"): Select seeks and neither add button nor the store's `selectClip`, `addClip` or `appendRange` does; the Go to buttons (the Scan row's start, the chat row's SHOWN start, named for the time); the Timeline's handle geometry (anchored by the edge they stand for, no `-ml-2`, the grab offset taken from the handle's rect and zero for a scrub, both still pointer-only); the one `ignoreHeldEnter` and the three places that use it; the captions setup's branches and sentences; the mood-board toast and a scan of every renderer source for a literal toast that names Ctrl+Z and takes a default duration. Three older pins moved with the code they read (the Fix wizard's local function, the Save buttons' attribute order, ClipList's `onClick`).
- **Playwright**, each red on a build of the unchanged tree first: video-pipelines.spec.ts "T-141 (3)" (six cases: Select; the clip narrower than 16 px; Scan VOD's Go to; the chat row's Go to; the two finders' widest rows at 1024, 1632 and 1920 px), "T-141 (4)" (two: a held Enter on "+ Save preset" after a save, and after a refused write) and "T-141 (7)" (the four states of the captions setup), audio.spec.ts "T-141 (4)" (a held Enter on "Save current"), references.spec.ts "T-141 (9)" (the delete toast 4.5 s later) and smoke.spec.ts "imagii Electron network log with the captions setup card" (the one case that is GREEN on the unchanged build, by design: it measured that nothing resolves, and stays as the pin).
- **A held key on a button is `keyboard.down` twice, after the first press has finished.** As the T-140 (7) case: the repeats arrive 600 ms after the press, when the first save has emptied the box (a repeat sent at once would find the claim up and be dropped in silence, and the red toast would never be seen). The case asserts the keyboard is STILL on the button before it sends them: that is the precondition that makes a repeat a click on it.
- **A seek is read from the media element, not from the store.** `landedAt` waits for `seeking` to be false and reads `currentTime`; `expectPlayheadAt` polls until the playhead has reached the target less the tolerance and then asserts it within the tolerance both ways, so a seek that never happens fails saying where the playhead stayed. The playhead is put FAR from the target first (a click on the track at 20%, 50% or 90%), or the case would pass on a seek that did nothing. `clickTrack` scrolls the track into view first: the studio is one scrolling column, and a textarea filled or a finder pressed a moment ago can leave the Timeline out of the window, where a press lands on nothing (found on the first run of the two finder cases).
- **The narrow clip is measured, not assumed.** The case makes a 0.1 s clip of a 14 s video with the keys (click the track, I, ArrowRight, O) and asserts from the boxes that its range is under 16 px before it asserts anything else; the handle checks are pixel checks against the range's box (the edge went where the pointer went, within 1.5 px), because the grab offset it holds is 6 px, 0.09 s here, and a readout that truncates to a tenth cannot see it. The last step is a scrub after both drags: it is what holds the offset's reset.
- **A layout is checked in the widest row, and the scan is answered by main.** The Smart highlight finder's widest honest row is a ten-hour range, which a real scan of a ten-hour file would need an hour of audio to produce, so `video:findHighlights` is replaced in main with a one-candidate answer; every pixel of the row is the real panel. The first draft of the row kept the reasons on the first line, and the pair wrapped under them in every row (three lines each, the buttons alone on the middle one); the second put the pair beside the range and measured 260 px for the widest range in the 258 a row has. Both were read in screenshots and in a measurement of the real row before the layout case was trusted, and the first line now holds the range, the score and the pair with `flex-wrap`: a three-hour range fits on it, a ten-hour one drops the pair under it. The case's "pair ends at the row's right edge" and "nothing overflows the card or the list" assertions are what read that; a mutation that takes `flex-wrap` away turns the case red.
- **The net-log case has a control for the half it measures.** `session.resolveHost` of a name that does not exist is asked from main, and the log must hold that one lookup and no other. Measured on the same unchanged build before the case was written: a `<link rel="dns-prefetch" href="//host">` hint IS a lookup in the log; an anchor and a `rel=preconnect` link are not.
- **A job a case cancels is held open by the case (the burn-in Cancel).** The burn of the 20-minute fixture is a second of work, so "the source is long" was a claim about an idle machine: under load the case reached its Cancel after the burn had ended. `holdCaptionBurn` (video-pipelines.spec.ts) wraps `child_process.spawn` in main, as `mainSpawn.ts` does, and puts `-re` before the input of the one ffmpeg whose filter chain has the `subtitles=` stage: the burn then needs the source's whole 20 minutes and only the product's Cancel ends it. Proven three ways: the old case with a 6 s slow reaction fails and the new one passes; five runs under a media suite and encoders at load 13 to 14; and the burn-in Cancel broken in the renderer and in main turns it red.

## Round 91 (T-142): what the new cases hold

- **Unit.** `src/main/ipc/recordingReveal.test.ts` (the `recording:revealTake` handler against the mocked electron surface: a take that is there is shown at the path main builds, a missing one opens the folder, ids that are empty, path-shaped, separator- or dot-bearing, absolute or not strings are refused with the shell never asked); `src/renderer/src/lib/savedToast.test.tsx` "toastKeptTake" (the react-hot-toast mock gains `error` and `dismiss`: the toast is the error kind, `duration` is `Infinity`, it has its own id, Show in folder reveals THIS session id and does not dismiss, Close dismisses exactly that id and reveals nothing, both buttons carry `pointer-events-auto`); `src/shared/userFacingError.test.ts` "the kept-take sentence" and `recordingCancel.test.ts` (both forms of main's sentence open with the one shared `RECORDING_KEPT_LEAD`, and the classifier recognises what `userFacingError` shows, and rejects the convert's, the empty take's and the blocked-file and disk-full sentences); `convertCancel.test.ts` (a quit and a Discard landing on one live convert, in both orders, via the child's `close` and `error`; the real module with a fake child).
- **The cancel on a live child is the latch's rule, tested the same way.** `cancelWhere` kept the entry deleted-on-cancel, so only the FIRST cancel could say who asked. The cases drive both orders and the two exits, plus the two things that fall out of keeping the entry: only the first cancel kills and answers true (the existing "a second cancel finds nothing to kill" row holds), and an entry is gone once the child has closed.
- **The re-attach's scratch name is chosen in the run.** `reattachCollision.test.ts` gains a slow `lstat` (a folder on a slow share) and a Cancel during the listing: the job ends as a cancel well before the listing would have, which is what `run.guard` around `nextFreePath` holds (without it the job ends only after the listing, because the next guard sees the mark). The T-114 cases that expected a refusal for a source at `<output>.cleaned.wav` now assert the new end state (the job runs, the source is byte for byte what it was); `cancelSentinel.test.ts`'s "stale intermediate" case writes the file AFTER the run has chosen its name, because that is the only way a file is at the scratch name when the swap happens now.
- **Layer 5, both majors.** `media.spec.ts` "the re-attach's scratch WAV never replaces a file the person already has (real ffmpeg, T-142)": an unrelated file at `<output>.cleaned.wav` is byte for byte what it was, the job succeeds, and the output ffprobes with a picture and sound; the T-114 collision case (the source at that name) and T-141 (1)'s "the scratch WAV it makes and deletes is the second track" case (the music at that name) now complete with the file intact, instead of being refused. Both are red on a build of the unchanged tree on 7.0.2 and 6.1.1. The two guards over the scratch name (`refuseOutputOverInputs`, `assertAlways`) are belts that a name collision can no longer reach (a free name is never an input), so no test can turn them red; they stay because the ticket keeps them.
- **Playwright**, red on a build of the unchanged tree: record.spec.ts "T-142 (1)" (Convert to MP4 and Convert off, through the real recorder, the real convert or remux, the real swap refused by `refuseRenamesOnto`): both buttons, the toast still up after `ACTION_TOAST_MS` + 2 s, the take on disk and whole after the failure branch's abandon, Show in folder pressed twice reaches the stubbed `shell.showItemInFolder` with exactly `<userData>/recordings/<id>.webm` (which ffprobes as the webm container) and leaves the toast up, Close removes it and the take stays; and the T-141 (5) cases, whose "the sentence alone" now reads "the sentence, then Show in folder and Close". The stub is main's `shell.showItemInFolder` through `stubShellReveal` (the OS window is the boundary); the missing-file fallback (`shell.openPath` of the folder) is the unit.
- **The take surviving the abandon is asserted after the wait, not before.** The failure branch calls `recording:abandon` for the same session id in the same tick as the toast; a check made at once could pass on a take that had not been deleted YET. The case waits 10 s and then looks. A mutation that makes `abandon` of an unknown session delete `<id>.webm` turns it red.

## Round 92 (T-143): what the new cases hold

- **A promised window is tested with the real reaper, not only the words.** `recordingCancel.test.ts` "the kept take's 6 hours start at the sentence" drives the real save path with a refused swap for the MP4 convert, the WebM remux and the fallback copy, the take backdated 7 h by the refusal seam (standing in for a long convert): after the kept-take error its mtime is now, and `pruneStaleTempFiles` through the userData seam (with `TMPDIR` pointed at an empty folder, so the host's `%TEMP%` families are never scanned) keeps it at +5 h 59 min and reaps it at +6 h 1 min. A `utimes` that rejects still throws the exact sentence and leaves the take; the quit-kept take is a control that stays as old as it was.
- **Playwright, red on a build of the unchanged tree:** record.spec.ts "T-143 (1)" wraps main's refused-rename patch so the first refusal ages every file in `<userData>/recordings` by 7 h, closes the app after the kept-take toast and relaunches on the same userData, so the real launch sweep runs. The wait for the sweep has an end that cannot lie: a 7 h old shifted-SRT decoy in `captions/` (swept after `recordings/`) is gone only once the sweep has been through the take, and a 7 h old decoy in `recordings/` that must be reaped proves the sweep reaps what is old. The take is then asserted there, byte for byte, with a fresh mtime. One variant (Convert to MP4) because the others share `keepRefusedTake`, which the unit suite covers on all three paths.

## Round 93 (T-144): what the new cases hold

- **A job whose panel is gone is tested through the screen that is left, not the one that left.** video-pipelines.spec.ts "T-144 (1)" closes the video (the real Close question, its words read off the dialog) over each kind of running job and drives the closed-video card to the end state: an export batch of two files (the card names the file it is on; its Cancel asks first, Keep running keeps the encode - a partial is still on disk and the card still up - and Cancel jobs ends it with no file and no partial), a one-file export (no question), Reframe, GIF, Compile and Picture-in-picture one after another on the 20-minute fixture (each card row, each Cancel, the neutral "canceled" toast, no file), Scan VOD (the scan's ffmpeg is held with SIGSTOP the moment main spawns it, and the case reads its end off `/proc`), a transcription (the stand-in engine of T-108: the engine process is killed by the card's Cancel) and a caption burn-in (`-re`, T-141's hold: no video and no partial). The caption model's download is the one kind with no case on the card: its row and its Cancel function are unit-tested, its panel Cancel is T-136 (4)'s case, and starting it needs the model host (IC ledger).
- **Unit.** `VideoJobsRunning.test.tsx` (the rows each run kind makes, none, a video open, the Close sentence, the card's markup: an always-mounted polite region that is empty and takes no gap), `store/runs.test.ts` (each job's Cancel reads the id off the run and aims main's cancel at it; a job that is not running asks main nothing), `store/exportQueue.test.ts` (the Export Cancel's threshold: one job left cancels at once, two ask), and `interactionWiring.test.ts` (the card is mounted once ahead of the conditional; every panel's Cancel and the card's call the same function and neither calls `window.api` for a cancel of its own).
- **The header is measured, not read.** "T-144 (2)" opens a video with a 55-character file name at the 1024 px minimum and takes `expectOneLine` of the title and every header button, `expectEllipsized` of the name and `expectNoHorizontalOverflow` of the header; on the unchanged build the title is two lines (64 px against 34). Audio Studio's header, which also shows a name, was measured at the same size with the same name and holds (it has no Clean audio button, the widest one in Video Studio's); Record, Stream Graphics and References show no name in their headers.
- **A typed range is tested through the whole path.** "T-144 (a)": Margin takes digits one at a time, 500 is 200 and -5 is 0 when typing ends, an emptied box changes nothing, and the number in the composite's `overlay=` filter (read off the spawn in main) is the box's 200.
- **A double press is held slow, in main.** references.spec.ts "T-144 (b)" slows the board file's write by 300 ms (`fs/promises` `writeFile` for a path under `moodboards`, the `slowWrites.ts` technique) so the second press certainly lands while the first create is out: a double-click, Enter pressed twice and a held Enter (`keyboard.down` repeated, which sets `repeat`) each make one board.
- **A second live region beside the first broke three older cases, and only the full suite saw it.** T-137 (3), (4) and T-138 (4) located the kit's closed-video region by `div[aria-live="polite"]` as a direct child of the studio, which was the only one; `VideoJobsRunning` is the second, so they now take `header + div[aria-live="polite"]` (the kit's, right after the header). A new always-mounted element that shares a selector with an old one is a change to those old cases' scope, whatever the unit layer says.
- **The export gate has its own cases** (`videoExportBatch.test.ts`): refused file names (both separators, a drive path, `.`, `..`, only the extension, another extension, a reserved or control character, a leading space, an empty or non-string name, 256 characters) and watermarks (text past the cap, an unknown corner, an infinite, NaN or out-of-range opacity, a numeric-string or negative size), all before the first probe, plus the names the app itself makes (Export's template names with spaces and brackets, a Unicode one, Clip Kit's) passing - the case that would catch a gate stricter than the product. The first draft of the rule was `sanitizeFilename`'s (letters, digits, `_`, `-`), which refuses every ordinary Export name; it is `safeNamePart`'s.

## Round 94 (T-145): what the new cases hold

- **"The figure moved" is a claim about two reads, so the job is slowed and the card is read twice.** video-pipelines.spec.ts "T-145 (1)" runs Scan VOD, Reframe and a caption burn-in at a fraction of real time (`slowTheJob` puts `-readrate` ahead of the job's `-i` in main's `spawn`, the T-141 `-re` technique with a rate: the job reports a new figure every second or so and is still running for the whole case), closes the video, reads the card's percent, and polls until it is higher. On the unchanged build the figure stays where Close left it (the listeners went with the panels), which is the red. The Cancel after it is the T-144 one, so the case ends as those do: neutral toast, no file, no partial.
- **A hook with an effect is unit-tested by running the effect.** `store/useVideoProgressFeeds.test.ts` mocks React's `useEffect` to run at once and keep the cleanup, so what is under test is what the hook subscribes to and what each event writes (nothing renders a component in the unit layer). The one thing a run-once mock cannot see is the dependency list, so `interactionWiring.test.ts` "T-145" pins `[]`: the mutant with no dependency array survived the unit cases until that pin was added.
- **A moved line is a failing test in two other files.** The hook's call and comment sit above `VideoStudio.tsx`'s native-dialog calls, so `docClaims.test.ts`'s inventory (which cites file:line) failed until the four rows moved; and `atomicWrites.test.ts` refused a raw `readdirSync` of a save folder in the new export case until it said `withoutAtomicTmp(...)`. Both are the verify gate doing its job.
- **A toast with a button is read through the DOM, and its file through the shell.** "T-145 (a)" slows the export's ffmpeg so the video can be closed mid-batch, waits for "Exported 2 files", clicks Show in folder and reads `shell.showItemInFolder`'s argument (`stubShellReveal`): the first file written is the one with the earliest modification time. Unit: `store/exportQueue.test.ts` walks the toast element for its buttons and calls the click.

## Round 95 (T-146): what the new cases hold

- **A class fixed in one studio is a grep for its sibling.** T-144 gave Video Studio a card for jobs that outlive the closed video; Audio Studio's Close had the same hole and no test looked, because the T-144 cases drive Video Studio. audio.spec.ts "T-146 (1)" is the sibling: an export (a one-hour mp3 slowed with `-readrate` in main's `spawn`, as T-145's cases do) and a re-attach to a video, each started, then Close, then the Close question read off the dialog spy (`studio.dialogs.messages`, the exact sentence), then the card's reading taken twice. The re-attach case cannot compare percents alone (its second pass starts again from 0), so a reading has advanced when the percent is higher in the same pass OR the pass label is a later one. Cancel ends both: the neutral toast, no file at the target, nothing beside it (`withEverything` of the output folder is empty: the partial and the scratch WAV are gone), and the card is gone.
- **The unconfirmed Close has its own case, with a measurement.** "Close with nothing running and nothing to lose still asks nothing" asserts the dialog spy saw no message and that the empty always-mounted region (`div[aria-live="polite"].-mb-5`) is 0 px high: the gap trick is only right if the studio's column has one gap to give back, and a region that took a row of its own would show here.
- **A third case lets the export finish.** The card must also END on its own: the export left running with the sound closed finishes, says "Cleaned audio exported", the card goes, and ffprobe reads the whole mp3 with no partial beside it. A card that stayed up on a finished export (the row outlives the export in the store, so a choice made on the row instead of the running flag would) is red here and in `AudioJobRunning.test.tsx` ("a row left over from a finished one").
- **The unit layer renders the card the way `VideoJobsRunning.test.tsx` does.** A server render reads a zustand store's initial state, so the two stores the card reads are mocked as plain objects; the row choice (`audioJobRow`) is a pure function and needs none of that. `interactionWiring.test.ts` "T-146" pins what a render cannot: the card is mounted once between the header and the conditional, the dialog's Cancel and the card's are the one `cancelAudioExport`, main's `audio.cancel` is asked in exactly one place, and the card has no listener of its own.
- **A toast that gained a button changed what four older cases read.** "Exported 1 file" is now the sentence followed by "Show in folder" in the toast's text, so the cases that compared the whole text (`t === 'Exported 1 file'`, `toContain('Exported 1 file')` on the log's array) read it as `startsWith` / `stringContaining`; the cases that already used `expectToast` (a substring match) did not move. The new case leaves Video Studio mid-batch by the Home link (the video stays open in the store, which is exactly the state the T-145 rule missed), lets the slowed batch finish on Home and reads `shell.showItemInFolder`'s argument.

## Round 96 (T-147), Track A: what the new cases hold

- **A pass's progress is proved by what the real binary prints, not by what the command looks like.** The copy re-attach's bar rests on one fact about ffmpeg: it prints `out_time` while it re-encodes the SOUND to AAC during a video stream copy. The unit tests (`muxCodec.test.ts`) feed the runner a fake child, so they prove the arithmetic (the start event, the total); only media.spec.ts "T-147 (1)" proves the premise: a generated 120 s H.264 + sine video through the real `runAudioReattach`, no cuts, every event collected, and at least one `mux` event between the 0 and the 100 (on 7.0.2 and on 6.1.1 through the alias config). It is long enough that the AAC encode spans several of ffmpeg's half-second progress prints; red on the unchanged tree by the first `mux` event being the 100. Making the source costs about a second.
- **A slider drag is driven with the real mouse, and from a focused neighbour.** audio.spec.ts "T-147 (T-78)" uses `dragThrough` (press, five positions, release) on the real range inputs, then ONE Ctrl+Z. The first version of the fix (the bare `onPointerUp` + `onBlur` pair) passed the Levels case and failed Cleanup's: the Custom button had just been clicked, so the press moved focus, its blur arrived after the slider's first `input` event and closed the window mid-drag (the first drag was two steps). The unit tests of the store, driven in the order a person thinks, could not see it; `gestureEnd.test.ts` now pins the rule at its seam (a blur during a press is not an end) and the e2e pins it end to end. Arrow keys are `press('ArrowRight')` on the focused slider, then `blur()`.
- **Slowing an export is how a test closes the sound under it.** "T-147 (2)" uses the T-146 pattern (`-readrate` ahead of the render's `-i`, added in main's `spawn`) to hold an audio-only export open while the sound is closed, then reads the toast through the DOM (`[data-rht-toaster] [role="status"]`, filtered by its text) and presses Show in folder against `stubShellReveal`. The toast text is "the sentence, then the button's name", so ten older cases that read it exactly were changed to read "Cleaned audio exported Show in folder"; the one that asserted "no success was claimed" now asks `includes` rather than for an absent exact string, which the new text would have satisfied for the wrong reason.
- **An accessible name is asserted by what the browser computes.** "T-147 (6b)" reads `getByRole('group', { name })` and `toHaveAccessibleDescription`, and checks the group's `aria-labelledby` is the visible heading's own id (a copy of its words would pass the name check and drift). It also asks the focused element's `closest('[role="group"]')` - the thing a screen reader walks - not just that a group exists.
- **Per-control keys are belt and braces.** The pointer-up and blur handlers close the window at every change of control, so two sliders sharing a key is an equivalent mutant at the e2e layer; the store's unit test (a different key is a new step with no `endGesture` between) is what holds them apart.

## Round 96, Track C (T-147 items 5, 6a, 7): what the new cases hold

- **A duplicate save is two tests at two layers.** `referencesStore.test.ts` "adding a picture that is already on the board" stands the bridge in with one that dedupes on `fullUrl` as main does, and asserts the answer (`true`, then `false`), that the `history` OBJECT is untouched by the duplicate (identity, not length: Home's cross-studio queue reads a new object as a step), and that one Undo takes back the real save. references.spec.ts "T-76 (T-147 (5))" is the click path on a seeded board: the toast log reads exactly `Saved to "Inspiration"` then `Already on "Inspiration"`, the file on disk still holds one copy, ONE press of Undo empties it, and the Undo button is then disabled (an empty step left on top by a duplicate would leave it lit). The older first-save case counts toasts that name the board, which still holds with the new wording.
- **The search status region is read as a screen reader reads it, and measured.** references.spec.ts "T-147 (7)" swaps `search:images` in main for a stand-in with five answers (three results, one, none, a notice, a rejection) and reads the panel's own `role="status"` region (the selector excludes react-hot-toast's, which sits inside `[data-rht-toaster]`): "3 results.", "1 result.", "No results.", the notice's sentence with no "results." beside it, the plain failure sentence with the red card inside it. Before any search the region is there, empty and 0 px high, and with results the grid sits exactly one 16 px gap under the note above it: the `-mb-4` is only right if it takes back the one gap the region holds.
- **The tour's live region is asserted against the tour's own data.** home-chrome.spec.ts "T-147 (6a)" builds the expected sentence from `videoTutorial.steps` rather than retyping the copy, reads the region empty on open, after Next, and after Back, and resolves the card's `aria-describedby` to the element whose text is the step's body.

## Round 96, Track B (T-147 items 3 and 4, the T-75 and T-78 image-half folds): what the new cases hold (the count line above is the expediter's)

- **A promise is tested against the state the app is actually in.** T-119 (3) promised "asking nothing when there is nothing to lose", and its unit test drove `videoDiscardMessage(0)`: zero clips, a state a loaded video never has, so the test passed while Close asked "1 clip and its edits will be discarded" of every video anyone opened. The new unit cases build the session the store really holds after `loadSource` (one `makeDefaultClip` clip, an empty history, nothing derived) and walk each loss kind away from it: a second clip, a changed clip, an undo step, a scan, a pasted chat log, the spikes found in one, each asking on its own; a transcript, an undone step and no source each asking nothing. The last unit case runs the real store from `loadSource` through a `setClipRange` to `clearSource`. The e2e cases are the same states in the app: video-core.spec.ts counts dialog EVENTS (a dialog Playwright auto-dismisses looks like a question that was declined, so "the importer is back" alone would also pass on a build that asked), and record.spec.ts runs three real takes (empty studio, an untouched take, an edited one) through the real `confirm`.
- **Three older pins assumed the question on an untouched video, and each was changed to make the video touched, not to loosen the assertion.** record.spec.ts and the Reframe case in video-pipelines.spec.ts add a clip before the "Edit in Video Studio" step (the question they read is now "2 clips and their edits"), and video-core.spec.ts's Close case trims first (click the track, press I). home-chrome.spec.ts's recent-file case and the T-144 idle-Close case now assert no dialog at all.
- **A hotkey guard is tested under the dialog that is NOT a Modal.** T-68's e2e drives the Variants dialog, which is a `<Modal>`, so it never saw the hole T-75 describes. "hotkeys under an open tutorial coachmark" starts the tour with the header's button, presses R, Delete, Backspace and Ctrl+Z, and asserts the tool, the layer and the undo stack are unchanged, then presses `?` (T-72's exemption) and repeats the keys with two dialogs up, closes both with Escape and shows the same keys working again. Without the last step a build that disabled the hotkeys for good would pass.
- **A drag is driven with the real mouse, through several positions.** The opacity case presses the slider's thumb and visits four positions (`dragThrough`, as the canvas drags do), so the store sees four `input` events; one Ctrl+Z must land on 100%, not one notch back (0.55 on the unchanged build). The second drag starts where the first ended and its Undo must land on the first drag's value, which is what proves the panel's `onPointerUp` ends the window (a build without it folds both drags into one step). The name field is typed with the keyboard (one step), left, and undone by the button.
- **A cite that moves fails in two other files.** `docClaims.test.ts` holds image.spec.ts's file:line comments (four of them moved with this round's edits: the three `canvasStore.ts` lines and `PropertiesPanel.tsx:47`; the `ImageStudio.tsx` ones were kept in place by folding the new comment into the old one) and the native-dialog inventory's `VideoStudio.tsx` / `editInVideoStudio.ts` lines (kept in place the same way). The four moved cites were updated in the table and in image.spec.ts's comments together.
- **Not covered, and why.** Record's Escape-to-stop guard with a coachmark open has no e2e: Record has no tour, and no Modal is reachable mid-take, so the guard is pinned in `interactionWiring.test.ts` and by `anyDialogClaim`'s unit cases.

## Round 97 (T-148): what the new cases hold

- **A class fixed in one studio is a grep for the pattern, then a real drag in every studio that has it.** T-147 closed the press-moves-focus split in Audio Studio and wrote down that Video Studio "very likely" had it; T-148 measured it before changing anything (video-core.spec.ts "T-148": drag Brightness, then Contrast, ONE Undo; the unchanged tree left Contrast at its press value) and ran the same drag on the two other studios that coalesce (the Clips card's Speed slider after a click in the rename field; image.spec.ts "T-148", Opacity after a click in the Name field). Each is red on a build of the unchanged tree (`git archive` of the base, specs copied in) and green on the fix.
- **A drag that is meant to expose the split must start OFF the thumb.** The first version of the image case pressed the slider at 100%, where it already was: the press changed nothing, so no `input` event fired before the Name field's blur and the case passed on the unchanged tree. It presses at 90% now, so the press itself is the first `input`. A negative or edge case is only a test once it has been red against the unfixed code.
- **One rule, one unit file.** `lib/gestureEnd.test.ts` holds the press and blur cases (a blur during a press is not an end; a release outside the card clears the press; two instances do not share a flag), the T-80 text-field cases (a release inside the focused field is not an end, outside it is) and the old `endsGestureOnPointerUp` table, which moved with the predicate. The DOM is two injected values (a target is `{ tagName, type }`, the active element is a function), so the node environment drives all of it. `interactionWiring.test.ts` "T-148" pins that each of the seven cards spreads the hook with its own store's `endGesture` and that no bare pair or second copy of the rule is left.

## Round 98, Track A (T-149 items 1, 2 and 3): what the new cases hold

- **A fixture for a threshold bug has to be found by trying levels, not chosen.** The highlight scan stretched a loud moment across the digital silence after it only when the decay jumped from above the threshold straight under -70 LUFS: ebur128's last partial window after a tone sits at a fixed distance under the tone, so a 0.5-volume tone leaves -69.8 (above -70, read, closes the peak: no bug) while 0.2, 0.15 and 0.1 leave -77.7 and lower (dropped before the loop: the bug) and 0.05 reproduced nothing (the tone itself fell under the threshold). media.spec.ts "T-149 (1)" makes the 20 s pink-noise bed, a 2.5 s 1 kHz tone, 60 s of EXACT zeros (`anullsrc`) and 20 s of bed at the three reproducing levels and runs the real `findHighlights` on each (red on the unchanged tree: one candidate 15.1-87.6 s, the tone being 20-22.5 s), on 7.0.2 and on 6.1.1. A first case checks the fixture says what it claims (the zeros read under -100 LUFS, the tone 10 LU over the bed).
- **The unit half drives the real function with the series in hand.** `highlightsSilence.test.ts` runs `findHighlights` against a fake ffmpeg whose stderr is a synthetic series (loud, loud, -161 x N, quiet): the candidate closes at the first silent sample and not at the next sound; a `-nan` series closes it too; a mostly silent file keeps the threshold its audible samples give (the statistics still read the audible samples only); a moment that runs to the end still closes at the end. `highlights.test.ts` holds the parser half: a `nan` / `-nan` / `-inf` momentary reading is kept as a non-finite sample, because a line the pattern skips cannot close anything.
- **A cap that must end the output at the base has to be proven on the base with no sound.** `-shortest` ended the PiP composite at the base only through the base's sound, so the T-131 (2) cases (every one a base WITH sound, or a silent base under an overlay of the same length) all passed while a silent 6 s base under an 8 s overlay came out 8.000 s. media.spec.ts "T-149 (2)" runs the real `runPipComposite` on a video-only 6 s base under an 8 s overlay (red on the unchanged tree: 7.96 s), the control (the same base with sound), and a SHORTER overlay (3 s) over the silent base, which holds the output at 6 s and rejects `overlay=shortest=1` as the fix (mutation M20 cuts it at 3). Both majors. `concatRunner.test.ts` pins the argv: `-t <the probe's length, three decimals>` is an output option after the last `-i`, `-shortest` and the sound pad stay, and a base whose length cannot be read gets neither.
- **An empty result needs its own state in the panel, tested past the toast's life.** video-pipelines.spec.ts "T-149 (3)": a generated 8 s steady tone scans to `[]`; the line reads "No standout moments found in this video." after the scan, is still there once the toast has gone and a second more has passed, gives way to the progress bar during a re-scan (a 4 s ffmpeg stall holds it open) and returns, survives a trip to Home, and is gone when another video is opened; a never-scanned video and a scan that found a candidate show no line. Red on a build of the unchanged tree (`git archive` of the base).

## Round 98, Track B (T-149): what the new cases hold

- **Ask the process that decides, not a count of what you re-read.** A save's "did that add anything?" was inferred from the item counts of two lists the renderer re-read around the call, which two presses in flight both passed. Main now decides under its lock and the store trusts it, so the unit cases are the flag itself (`moodboard.test.ts`: new, duplicate, two in flight, a board that is gone) and the store believing it over the counts (`referencesStore.test.ts`: two concurrent adds against a deduping stub are true then false, ONE step; a true answer is a step even when the re-read count did not move). The e2e is a REAL `dblclick`, and the thumbnail socket answers after 300 ms: that delay is what makes the second press certainly start while the first is in main (an instant socket can hide the race), and it is red on the unchanged build with two toasts.
- **A fix to a shared rule keeps the cases the OLD rule protected.** `gestureEnd.test.ts` now names the four cases that decide the text-field exemption: (a) a caret click in the field that already had focus is no end, (b) a press that moves focus into another text field is, (c) a slider drag after another control is still one end with its first blur ignored, (d) a release elsewhere ends. The e2e drives a MOUSE click between the caption and the Color box (`video-core.spec.ts` "T-149 (5)"); a keyboard Tab between fields never showed the defect, which is why the T-148 round did not see it.
- **A layout fix is measured, not looked at.** `audio.spec.ts` "T-149 (fold)" sets the real window to 1024x640 and reads the name's `getBoundingClientRect().width` against the 146 px it measured before (145.5 on the unchanged build), then checks the pass label is whole on one line and the panel does not overflow.

## Round 99, Track A (T-150 item 1): what the new cases hold

- **A control that cannot fail does not prove "unchanged".** The fixtures for a loudness feature are measured, not chosen: `media.spec.ts` "Match loudness follows the voice when Even volume is off" scales pink and brown noise by an `ebur128` reading to exactly -22 and -32 LUFS, lays them out so one stretch has only the music (the voice starts at 10 s) and one only the voice (the bed ends at 18 s), and judges each stretch as its own programme. The first fixture put 6 s of silence at the head of the bed and a single-pass `loudnorm` under-shot by about 5 LU for the rest of the file (measured: -26.9 against -22.0 without the silence), so the head is sound and the stretch is read after loudnorm's first seconds. The Even-volume control passes on the voice reading alone; a stretch where both tracks play moved only 0.8 LU when the mix bus's loudnorm was removed, too little to separate from the target by a tolerance that holds on both majors, so that guard is the unit graph (`matchVoice.test.ts`) and the L5 mutation that removes it survives by name in the ledger.
- **The graph is pinned for every combination, and the fallback for the value ffmpeg would refuse.** `matchVoice.test.ts` runs the real runner with a fake child that prints what loudnorm prints: Even volume off x Match off / on, Even volume on x Match off / on (the measurement is NOT followed there: the music goes to the target), ducking, the clamp at -70 and -5 (and a -3 target box that the measuring chain must not read: ffmpeg refuses an `I` over -5), `-inf` and an unparseable block (the music takes its plain gain; no `-inf` reaches ffmpeg), the measure pass's own stages in order (cut, high-pass, gain), the progress events (measure then render, each at 0%) and a Cancel during the measuring pass (one child spawned, none after). `audio.test.ts` pins the plan and the "Step 1 of 2" label.
- **A label is a promise about the plan.** audio.spec.ts "T-150 (1)" holds `audio:export` in main, as the T-100 row case does, and reads what the dialog planned: Match on gives "Step 1 of 2 - measuring loudness" on the row and the progress bar's accessible name, Match off gives "Rendering..." alone (red on a build of the unchanged tree).

## Round 99, Track B (T-150 items 3, 4, the video half of 5, and the Recent fold): what the new cases hold

- **Two repeats, two guards, each killed on its own.** video-pipelines.spec.ts "T-150 (3)" presses "+ Clip" on a Scan VOD row and on a Chat spike row twice ways: a real `dblclick()` (the second click carries `detail` 2) and a held Enter (`keyboard.down('Enter')` repeated, which the page sees as keyboard clicks with `detail` 0). The double-click case asserts ONE clip and ONE "Clip added" toast and no "Already in the Clips list" (so only the panel's `isRepeatPress` passes it: with the store guard alone the second click would raise that toast); the held-Enter case asserts one clip and the "Already in the Clips list" toast (so only the store guard passes it). One Undo then puts the untouched whole-video clip back, which a phantom step would break. `videoStore.test.ts` holds the store's side: a duplicate changes nothing (the very same `clips` array), the comparison is on the clamped range, a different range still adds, a hand-made clip with the range counts, and the pristine whole-video clip is not compared.
- **Read the stored value, not the box.** video-core.spec.ts "T-150 (4)" cannot see the overlay's 0-1 fraction through the percent box, so it saves the project from Home (the save dialog stubbed) and reads `videoStudio.clips[0].textOverlays[0].x / y` from the file: 50 stores 0.5, a refused 150 and -5 leave the file where it was, 100 stores 1. That is the only layer that tells "refused" from "clamped to the edge and shown as the number typed".
- **A negative control in the same describe.** home-chrome.spec.ts "T-150" seeds `config.json` with a missing file ahead of a real one and picks the missing one in Video and in Audio Studio: the exact toast, the menu and the file on disk both lose that path and only that path. The third case picks a present file that is not a video and asserts the entry stays and no removal is claimed; it passes on the unchanged tree on purpose, and a mutation that drops the entry on every failure fails it.
- **A backstop with no control is pinned, not driven.** Record's "Pick a screen or window first" sits behind a Start button that is disabled while no source is picked, so no UI path reaches it. `interactionWiring.test.ts` pins the sentence to the button's words; the ledger row says so.
- **Copy fixes move their pins in the same change.** The two scan toasts now say what their inline lines say; the e2e `expectToast` calls and the wiring pins moved with them, and the T-149 (3) case reads the toast with `exact: true` so the line (with its period) cannot satisfy it.

## Round 99, Track C (T-150 items 2, 5 image half, fold): what the new cases hold

- **A queue is tested with a stub that behaves like the thing behind it.** `referencesStore.test.ts` "overlapping board edits are separate Undo steps" gives the bridge main's shape: a lock-serialised writer whose first call is slow (a thumbnail still downloading), so the second press is certainly issued while the first is in flight. The synchronous stub the file used before could not tell press time from turn time. The same block holds the cases around the chain, not only the headline one: an undo pressed mid-save waits for it, an edit pressed right after an undo waits for the undo's disk write (a slow `restore`), a rejected mutation does not stall the next.
- **Mutate every place that should join the chain.** The first mutation run left one survivor (the undo's disk write fired outside the chain); the case above was written for it. The e2e (references.spec.ts "T-150 (2)") holds picture A's thumbnail socket until the test lets it go, saves B, releases, and reads the board file after each Ctrl+Z.
- **A held key is driven with `keyboard.down` repeated, not `press`.** Playwright marks the second `down` of a key that is already down as `repeat`, which is what the OS auto-repeat does; "T-150: a held Enter" focuses Save, repeats six times and expects one toast.
- **A longer caption is measured in its fixed column.** image.spec.ts "T-150" reads the label's height against its line height so "Stroke (px)" cannot start wrapping in the `w-16` column unnoticed.

## Round 100, Track A (T-151 item 1): what the new cases hold

- **A fraction of the frame is clamped by the text's own size, and only decoded pixels say so.** `filters.test.ts` pins the exact drawtext for an in-frame position and for x = 0.9 / y = 0.98 and parses the quoted `min(max(0,X),w-tw)` back to one filter; media.spec.ts "T-151" renders a 30-odd character white caption at 64 px on a black 1080x1920 lavfi frame and reads the first and last white column from the decoded gray frame. The control is the same caption at x = 0.1, so "the width is unchanged" cannot be a caption that was clipped and merely ended early. Red on the unchanged tree: the run touched column 1079.
- **A font-less binary is a skip, and the substitution lives in the test.** The bundled linux 7.0.2 has no drawtext and Wine has no fonts, so the case asks `ffmpeg -filters` and skips without it; on the 611 config (`vitest.611.config.mjs`) it takes the system font from `fc-match sans` (else the first .ttf / .otf under /usr/share/fonts) and replaces ONLY the `C\:/Windows/Fonts/arial.ttf` fontfile in the graph production built. Its win32-gated twin runs the shipped 6.1.1 and the real Arial unsubstituted in the release run.

## Round 100, Track B (T-151 item 2 and the fold): what the new cases hold

- **A stalled network call is tested by the signal it is given, and then by a socket that really stalls.** `moodboard.test.ts` spies `AbortSignal.timeout` to hand back a signal the test fires, so it asserts the 10 s it was asked for and that the item lands without a cached thumbnail once the deadline fires, with no fake timers and no 10 s wait; references.spec.ts "T-151 (2)" is the end-to-end twin (an HTTP server that accepts and never answers) and waits out the real 10 s because no hook shortens it.
- **A byte cap needs a stream that never ends.** The oversize case serves a body that enqueues 1 MB for as long as it is read and asserts the read stopped within a few chunks of the cap, so a "drain it, then check the size" version fails; a body of exactly the cap is kept, which pins `>` against `>=`.
- **A hook with no DOM is tested with React's hooks as pass-throughs.** `useRecentFiles.test.ts` mocks `react` (`useState`, `useEffect`, `useCallback`) and `persistSetting`, so `remove` is the plain function the importer holds and a refused settings read is a rejected stub.

## Round 101, Track A (T-152 items 1 and 5): what the new cases hold

- **A clamp's order decides which end of the sentence is lost, so test the case that does not fit.** T-151's case used a caption that FITS (25 characters at x = 0.9) and so could never see `min(max(0,X),w-tw)` cut the start of a line wider than the frame. media.spec.ts "T-152" renders a 51-character caption at 64 px twice with production's own drawtext string: at x = 0 on a black 3000x200 frame (the whole line, the reference) and at x = 0.5 on 1080x1920. It asserts the reference is wider than 1080 (the case is real), the narrow render's ink touches column 1079 (the end runs off), its first ink column is the reference's (the start is kept) and its first 200 columns of the caption's rows match the reference's with a mean absolute difference under 2 of 255. The same glyphs at the same integer x rasterize identically, so the measured value is 0.000; a start shifted by 4 px measures 34.6, so 2 sits far from both. Same 6.1.1 config, system-font substitution and win32 twin as "T-151". Red on the unchanged tree (the ink ended at 1073 and began mid-sentence). `filters.test.ts` and `reframe.test.ts` pin the exact string in the new order.
- **A number box that is not a DraftField is checked by what reaches the disk.** image.spec.ts "T-152 (5)" types "4" then "-3" key by key into Stroke (px) and polls the autosave file for the rectangle's `strokeWidth` (0, not the stored sign-dropped 3 the unchanged build kept), then reads the canvas node and the box. Typing key by key is the convention (`fill('-3')` sets the whole value in one event and never meets the half-typed "-"). `interactionWiring.test.ts` pins the commit and drops 'strokeWidth' from the coalescing-key list, since a DraftField commits once.


## Round 101, Track B (T-152 items 2, 3, 4): what the new cases hold

- **A replace that asks is driven through the dialog both ways.** references.spec.ts "T-152 (2)" puts a layer on the canvas, goes to the Asset Library and presses a card with the confirm DISMISSED (still on References, no toast in the log, the canvas read back from Stream Graphics unchanged), then ACCEPTED (the asset's layer rows, the toast, still up 4.5 s later because it carries the way back, and Ctrl+Z restoring the previous layer); the dialog's exact message is asserted both times. The older Asset Library card case records every dialog the page raises, so its first card (an empty canvas) proves it was not asked and its second reads the question.
- **A size read before a file is tested with a file that cannot be read.** `projectSave.test.ts` makes SPARSE files with `truncate` (nothing written, so a 600,000,000-byte case costs no disk or time), drives the real `project:load` handler through the electron mock, and spies `node:fs/promises` `readFile` so "never read" is an assertion and not an inference from the sentence; a file exactly at the limit still reads and opens, and a path that is not there takes the read-failure path.
- **A floor is tested at the edge and in the middle.** `videoStore.test.ts` drives `setClipEnd(0)`, `setClipStart(D)`, a press past the edge, a mid-clip press, a drag, one undo step and a source shorter than 0.1 s; video-core.spec.ts "T-152 (4)" reads the Timeline's tenths (the Clips list prints whole seconds and shows "0:00 -> 0:00" for 0.1 s too) and exports the 0.1 s clip for real, ffprobing the file.
- **Pins.** `interactionWiring.test.ts` pins the order in `dropToCanvas` (confirm, return, setDocument, navigate), that `project:load` stats before it reads inside the try, and that `applyRange` alone holds the floor; `truthInCopy.test.ts` pins the three USER_GUIDE lines.


## Round 102, Track A (T-153 items 1-7 and the Export-notes fold): what the new cases hold

- **A typed number is undone by ONE Undo, driven key by key.** image.spec.ts "T-153 (1)" types into Stroke (px), Size (px), X (px), Y (px) and Rotation with `retype` (select, delete, type digit by digit), leaves the box, presses the header's Undo once and reads the layer off the stage (the old width, size, position, angle, not the "1" on the way to "12"); a second run after leaving is a second step, X then Y are two, and a rotation preset is its own step with the typed run after it another. `canvasStore.test.ts` holds the store's half (keyed updates coalesce, `endGesture` or a discrete action closes the window) and PASSES on the unchanged tree: the store was right and the panel passed no key, so the red is the e2e and the wiring pin, not the unit.
- **A repeat click is tested with the browser's own click count.** home-chrome.spec.ts "T-153 (3)" uses Playwright's `dblclick` (a second press with `detail` 2) on Home's Stream Graphics card of an empty session and waits past the half-second window before asserting that the template grid is still showing; a single click then a template at once, and Enter on a focused card, are the two cases that must NOT be swallowed. The Home-link double-click case is a guard and cannot be red (the second press lands on Home's heading).
- **"One line" is asserted for every chip and label that shares a row.** "T-153 (2)" opens `?` on all six routes at 1024x640 and runs `expectOneLine` over every chip; "T-153 (7)" runs it over the X and Y labels at both window sizes, with `expectControlsWhole` on the boxes.
- **An empty live region is measured, not just found.** "T-153 fold" asserts the `role="status"` wrapper exists before JPG is picked and holds the note after, and that the card's bottom edge is still its padding below the Export button while the region is empty (a `-mt-2` copy of the GIF card's correction measured 21 px and fails it).
- **Pins.** `interactionWiring.test.ts` pins the five keys, the `kbd` classes, the App effect and its place above the early returns, the label map, the meter's `bg-ember`, the two labels and the wrapper's shape; `truthInCopy.test.ts` pins "YouTube Shorts". The video-pipelines posting-log case now reads the three boxes by their accessible names.

## Round 102, Track B (T-153 items 8-10 and the folds): what the new cases hold

- **A saved clip is driven in through the real Open project button.** video-core.spec.ts "T-153 (8)" writes a project JSON whose clips are [0, 0] and [D, D], stubs the open chooser in main, presses Open project, reads the Timeline's printed In / Length / Out for each clip and exports both, ffprobing each file; `ProjectIO.test.ts` drives `applyProject` with the same clips against the stubbed probe, and `clip.test.ts` pins `floorRange` at both edges, mid, on a source shorter than the floor and on a reversed pair. `applyRange` calls the same helper, so `videoStore.test.ts` is the proof that the I and O keys did not change.
- **A readout is tested with the values that were wrong, not the ones that never were.** `clockTime.test.ts` has the measured failures (1.2, 4.1, 19.9, 59.9, 10 - 9.9), the truncation that must stay (1.49, 65.999), the carry (59.9999 is 1:00.0, never 0:59.10) and every tenth 0.0-39.9 in a loop. The 2 s e2e fixture's end values are exact floats, so T-152 (4)'s I-at-the-end case alone cannot be red here: "T-153 (9)" opens a project with clips at 1.1 / 1.9 and 0.2 / 1.2 and presses I at the end of a real 10 s video.
- **Geometry the recorder cannot show in CI is a pure function plus the draw calls.** `compositor.test.ts` pins `computeContainRect` for the same aspect, wider, taller and not-yet-reported sizes, and `drawFrame` across an aspect change mid-take with a stub context (the black fill only when there are bars, the screen at the fitted rect, the webcam's rect untouched). Screen capture is an OS boundary: the disposition is in docs/INTERACTION_COVERAGE.md.
- **A size rule that is not bytes is tested with a file whose bytes and characters differ.** `projectSave.test.ts` keeps the SPARSE files (the limit plus one byte, exactly 3x, 3x plus one, 600,000,000) with `readFile` spied, and adds a project of exactly the limit in characters made partly of two-byte letters (more bytes than the limit) that opens.
- **A live region is tested by the element, not the text.** "T-153 (fold)" keeps a handle to the status region before the uncheck and asserts that same element holds the sentence after it (a region that mounts with its text is not reliably announced), and that it is empty again after the check.

## Round 103, Track A (T-154 items 1-7, 9 and the shortcuts-column fold): what the new cases hold

- **A repeat press is only proved after the route-change swallow has lapsed.** App drops a repeat click for half a second after every route change (T-153 (3)), so a `dblclick` issued inside it never delivers its second press and the case is green on the unchanged build. Every T-154 double-click waits 800 ms after the studio opens, and each case was run on a build of the unchanged tree to see it red for the stated reason (the first draft of "-> Canvas" and the tile case were green there).
- **Two guards on one press are tested separately.** The ✕ and "-> Canvas" carry a repeat guard (`isRepeatPress`) and a claim; a `dblclick` is caught by either, so each has its own case: the claim by two separate presses while the load is parked (`HTMLImageElement.src` held, the T-135 (13) helper) or the write is held 1.2 s (the T-144 `fs.promises.writeFile` delay), the repeat guard by a slow double-click made with `mouse.down({ clickCount: 2 })` after the first removal has finished and the grid has reflowed. The "-> Canvas" repeat guard has no case of its own that can be red: after a fast load the route change swallows the press anyway (disclosed in the ledger).
- **A no-op is observed by its undo step.** The tile ✕ pressed twice on the same id left the board right and raised no visible error; ONE Ctrl+Z not bringing the picture back is what showed it.
- **A held chord is `keyboard.down` repeated.** Playwright marks a `down` of a key already down as an auto-repeat (`repeat: true`); the paste case holds Control, presses `v` four times, releases, and counts layers, then a fresh `Control+v` must paste again.
- **A native chooser is counted through the `filechooser` event.** The Import case records every event, asserts one after a `dblclick` and after a second press, answers it with `setFiles`, and shows the next press opens another; a dismissed chooser is a `cancel` event dispatched on the input that `HTMLInputElement.click` was called on (the case patches `click` to keep it), and a paste that is not the chord is `webContents.paste()` from main right after the hold.
- **A column is measured, not looked at.** The shortcuts case reads every row's description `left` and the widest chip's `right` on /video and /image at 1024x640.
- **Pins.** `interactionWiring.test.ts` pins each guard and claim, the paste tracking, the Player's attributes against the handler's cases, and the grid classes; `truthInCopy.test.ts` pins the tutorial's body against the panel's label. Locators the changes broke were updated in place (the `docClaims` ImportPanel cite, the native-dialog inventory lines, `failurePathLanguage`'s ✕ handler regex, and the T-17 overlay-remove pin).

## Round 103, Track B (T-154 item 8): what the new cases hold

- **A mid-stream size change is measured after the change.** media.spec.ts "a recording that changes size keeps its shape" builds the fixture in the test: a 1280x720 flat-gray libvpx segment and a 1000x1000 white one with a red 500x500 square in its middle, joined with `concat -c copy` into ONE webm that starts at 1280x720 and turns 1000x1000 (the shape of a MediaRecorder file whose window was resized; a decode with `scale=iw:ih` proves the second half is really 1000x1000). The real `convertToMp4` then has to give 1280x720 at SAR 1:1 with every frame of the input, and a decoded frame from the second half has black at both sides, a picture 720x720 square within 2 px and centred, and the red square 360x360 square within 2 px; a frame from the first half is the whole gray, no bars. The unit tests of the argv passed on the stretching command, and so did the output's size: only the pixels after the change say it.
- **Controls that must NOT move.** A MediaRecorder-shaped 320x240 webm and an odd-sized one go through the old command (spelled out in the test, not imported) and the new one, and the decoded frames hash to the same md5; a rotated mp4 stays upright at 360x640 with no bar; an anamorphic one keeps its 16:15. These fail on a fit that touches a constant-size file, and the rotation and pixel-aspect ones are the only cases that tell the probe's guards from their absence (the probe's `stream_side_data_list` is spelled for the bundled ffprobe 4.0, which rejects the newer name: a failed probe falls back to the plain crop, silently, so the post-resize case is what fails when the probe breaks).
- **The probe is a child like the encode.** `convertCancel.test.ts` answers the probe by argv shape (`-show_entries`) and keeps `lastChild` the encode's, so every earlier case reads as before; the new block covers the fit chain, the probe's argv, the even rounding, a failed probe, unreadable output, a missing spawn, each guard (rotation by matrix and by tag, a non-square pixel, two video streams, a size under two pixels), and a Discard and the quit's sweep landing during the probe (the sentinel, `byQuit` told apart, no encode started, nothing left registered). convertQuit, recordingQuit and cancelSentinel answer the probe the same way.
- **What is not driven.** Screen capture itself is an OS boundary (docs/INTERACTION_COVERAGE.md): no test resizes a real captured window. Layer 5 is the deepest layer; the multi-video-stream guard is covered by `heldSizeOf` alone (no real file with a cover picture), and `force_divisible_by` and `setsar=1` change no pixel on any fixture here, so they are held by the argv pin.


## Round 104, Track A (T-155 items 1-3): what the new cases hold

- **A stalled host is a held assignment when the page cannot reach one.** The renderer's CSP bars a loopback HTTP host, so "-> Canvas" cannot be pointed at a socket that never answers; the case holds `HTMLImageElement.prototype.src` for the one address ("stall-thumb") and never releases it, which is what the page sees. The shipped 10 s deadline has no env hook, so the case waits it out (~13 s) and asserts the whole sequence in one run: both buttons `aria-disabled` and titled, a press on the second tile says "Still adding the last picture" and adds nothing, the failure sentence, the marks gone, then the second tile adds its layer.
- **Playwright treats `aria-disabled` as not actionable.** A plain `click()` on a button that is `aria-disabled` waits for it to lift (the first draft waited out the stall and so never saw the busy toast); the press that must land while it is marked uses `{ force: true }`, which is what a person's click is.
- **A held chord that the OS hides is dispatched.** Shift+Insert is a real `keyboard.down` repeated (Chromium on Linux pastes on it); a Ctrl+V on a Cyrillic layout cannot be typed by the harness, so `KeyboardEvent`s with `code: 'KeyV'` and `key: 'м'` are dispatched on the window and each is followed by the real `webContents.paste()` of a real clipboard image.
- **Each double-click and held Enter case ran on a build of the unchanged tree.** All but "Start with text" were red for the stated reason (`Layers (5)`, `Layers (3)`, `Clips (3)`, `Text overlays (2)`); "Start with text" is green there, because the button is replaced by the canvas its first press makes (a guard that cannot be red; kept as the negative).
- **A one-layer stack cannot tell a propagated repeat from a kept selection.** With one layer the row under the pointer after a Duplicate is the copy itself, already selected, so a second press that leaks to the row's select handler is invisible; the Duplicate case that checks the selection uses two layers (a double-click on the bottom row's Duplicate must leave the copy selected, not the row that shifted under the pointer), found by the expediter's mutation.
- **Pins.** `interactionWiring.test.ts` pins the deadline, the cleared timer, the flag and the three attributes, the paste chord and the five guarded buttons; `truthInCopy.test.ts` pins that the deadline sentence passes `userFacingError` as written.

## Round 104, Track B (T-155 item 4 and the compositor fold): what the new cases hold

- **Two surfaces, each waiting for the other.** video-pipelines.spec.ts "T-155 (4): Export and Clip Kit wait for each other" holds a kit in main the way the T-136 case does (the second probe stalled 25 s with `installSpawnStall`) and asserts Export disabled with "Clip Kit is running. Export when it is done.", no Failed row, then the kit canceled and Export enabled with no title; then holds an export batch (the first ffmpeg stalled 60 s) and asserts Clip Kit disabled with "An export is running. Clip Kit starts when it is done.", a `dispatchEvent('click')` at the disabled button (a Playwright `click()` would wait for it to enable, so it cannot be the discriminating press) makes no kit folder, shows no refusal toast and leaves no Failed row, then the export canceled and Clip Kit enabled with its own title back. The T-111 / T-112 case that used to press Clip Kit for main's refusal now asserts the button shut and asks the gate directly with `window.api.video.exportBatch([])` (the gate is the handler's first line, so no job is needed); a Layer 5 block is not touched (no ffmpeg argument changed).
- **A cadence test needs a clock you own.** compositor.test.ts's "startCompositor draws what the recorder keeps" runs the real `startCompositor` in the node environment against stubbed `document`, `requestAnimationFrame` and `cancelAnimationFrame` (a video-like stub that is always ready, a canvas whose context counts `drawImage`), hands the loop one second of ticks at 144, 60 and 24 Hz with `now` the tick's time, and counts screen draws. It pins 29-31 at 144 and 60 Hz, every tick at 24 Hz and at 60 fps on 60 Hz, a re-arm after every tick and nothing after `stop()`. The 60 Hz case is the one that tells the 2 ms of slack from its absence (without it, float drift in the tick times makes the loop skip every other tick and draw 24).
- **What is not driven.** The saving itself (a CPU share under a real display) is host-dependent and unasserted; the live compositor path still has no e2e (docs/INTERACTION_COVERAGE.md, the Record rows). `interactionWiring.test.ts` pins the source shape of the two buttons' `disabled` and titles and of the loop, and three older pins that spelled the old `disabled` expression were updated with them.

## Round 105, Track A (T-156 items 1-2): what the new cases hold

- **A cadence test needs ticks you can shape.** compositor.test.ts's "startCompositor keeps its 30 on any display (T-156 (1))" takes the T-155 fake rAF clock and hands the loop an explicit list of tick times, so a stall or a jitter is just a tick list. It pins 29-31 draws a second at 60, 75, 100, 144, 165 and 240 Hz (75 and 100 Hz are the two that gave 25 before), every tick at 24 Hz, 29-31 at 60 Hz with alternating +-1 ms of jitter, no two draws closer than an interval less the 2 ms at 240 Hz (what tells the slack from a wider one), and, after a 500 ms stall and after a 50 ms hitch, one draw then none on the next ticks (what tells a resync from a burst; the 50 ms case is the one that tells a one-interval threshold from a two-interval one). The earlier version of these cases had three surviving mutants (slack 0, slack 8 ms, a two-interval resync); each is now a case of its own.
- **A remount is driven through Home, not through a store write.** video-core.spec.ts "T-156 (2)" seeks the real media element to 1.0 s, presses the Home link and Video Studio again, and reads three places that must agree (the Player's clock readout, the media element's `currentTime`, the Timeline slider's `aria-valuenow`), each within one frame; then Close and a drop of a second fixture and reads 0:00.00 and the element at 0 (the "a different file starts at 0" half, which is why the case builds a second fixture). About 3 s. The path-change-while-mounted branch has no UI route, so `interactionWiring.test.ts` "T-156 Track A" pins the mount ref, the restore expression and the two store zeroings by source shape.
- **What is not driven.** A real display's refresh rate (the cadence is a fake clock) and the live cam stream; see the round 105 rows in docs/INTERACTION_COVERAGE.md.

## Round 105, Track B (T-156 items 3-5): what the new cases hold

- **A page-side hold with two behaviours.** references.spec.ts "T-156 (4) / (5)" reuses the T-155 (1) hold on `HTMLImageElement.prototype.src` (an address that says "stall-thumb" is never started) and adds a second branch: an address that says "fail-thumb" fires the image's `error` event at once, which is what an offline fetch or a 404 looks like to `loadImage`, deterministically and inside the CSP. The first case switches to Asset Library and back while the send is out, which is the remount the module-scope claim has to survive; it presses the second tile with `force: true` (Playwright waits out `aria-disabled`, a person's click lands). The deadline is the shipped 10 s, so it runs ~12 s.
- **Copy that promises is tested against the mechanism.** video-pipelines.spec.ts "T-156 (3)" holds an export running the way the T-155 (4) case does and asserts the kit's new title, then that the kit is enabled with its idle title and did not start by itself; `truthInCopy.test.ts` keeps the word "starts" out of that title.


## Round 106, Track A (T-157 items 1-3): what the new cases hold

- **A detached media element is read by recording its creation.** wavesurfer's `<audio>` is never in the document, so audio.spec.ts "T-157 (1), (2)" wraps `document.createElement` just before the Home round trip and reads the newest `<audio>` it recorded: the readout and that element must agree on the time the person left (about 3 s).
- **A swap while the studio stays mounted is the Clean audio route.** The audio importer is hidden once a sound is open, so the swap is the one real way a second sound arrives under a mounted view: a 60 s WAV playing, a video dropped on Video Studio, Clean audio with its ffmpeg held (`installSpawnStall`), back to Audio Studio, Play; when the extraction lands the readout must read 0:00.00 and the button Play within 1.5 s (about 16 s).
- **A source swap is made on the element, not through a store.** video-core.spec.ts "T-157 (3)" presses Play, asserts the element is playing, sets `__imagiiVideoEl.src` to a second fixture's `imagii-file` URL (all `previewUrl` changes in the Player) and reads the button's name and title. The test does not make a real preview copy (video-pipelines.spec.ts covers the ProRes route).

## Round 106, Track B (T-157 items 4-6): what the new cases hold

- **A label that reaches the DOM through a map is pinned by the map.** The crop presets, the source tile captions and the Corner options each render a value from a `Record` (`PRESET_LABELS`, `SOURCE_TYPE_LABELS`, `WEBCAM_CORNER_LABELS`), which the copy scanner cannot see. copyConventions.test.ts "T-157 Track B" reads the declaration out of the file, asserts each map's values, that the render site reads the map (not `{m}` or `{s.type}`), and that every value starts with a capital or a digit. The e2e cases read what a person sees: video-core.spec.ts's crop case finds the "Free" button by name, record.spec.ts "T-157 (5) / (6)" reads the two tile captions on a screen and a window the named-source stub offers (its ids carry the type's prefix, which is how main types a source), and the Corner select's four options.

## Round 107 (T-158 items 1-3): what the new cases hold

- **A race the harness cannot produce is modelled at its narrowest seam.** The stale-store bug needs the last playback tick to land a frame short of the end; Chromium on Xvfb reads the exact duration there, so a plain play-through is green on the old build. audio.spec.ts "T-158 (1)" wraps the media element's `currentTime` getter to report a frame short of the end (the setter, the restore's seek and the playing are real) and reads the element's true position through the saved original getter.
- **A held rename is a save with no ffmpeg child.** record.spec.ts "T-158 (2)" patches main's `rename` onto the chosen name to wait at a gate the test controls and then refuse with a lock code, which leaves the convert finished, the save's run open and nothing to kill. The Discard is pressed there; the card must keep "Discarding the recording..." a second later, and the gate's release ends it as "Recording discarded" with no take left. convertCancel.test.ts holds the main-side answer (an open run: true, none: false, another take's run: false).

## Round 108 (T-159 items 1-3): what the new cases hold

- **The meter is driven by a sound that plays.** audio.spec.ts "T-159 (2)" makes its tones with the bundled ffmpeg's `sine` (a gain on its 0.125 default: 7.7 for -0.33 dBFS, 2 for -12 dBFS) and a seeded `anoisesrc` (amplitude 0.3), drops them, presses Play and reads the dB label and the twelve bars off the screen; the label is sampled every 16 ms in the page from the press, so a single frame of "-0 dB" is caught. A hard-clipped tone is the wrong fixture: its decoded peaks overshoot 1.0, the meter's clamp prints "0 dB" and the old build passes too, so the full-scale case sits at -0.33 dBFS, where `toFixed(0)` still printed "-0".
- **The seam is `toFixed`.** React prints a number's `-0` as "0" but `toFixed(0)` returns the string "-0", so the label is `Math.round(peakDb)`; the browser case kills the `toFixed(0)` mutation, and interactionWiring.test.ts "T-159" pins the form. REVISED by round 109 Track B: the label is `Math.ceil(peakDb)` now.
- **A remembered setting is read back through the disk.** video-pipelines.spec.ts "T-159 (3)" seeds config.json, clears the Filename box, exports one preset and polls config.json for the key's absence, then goes Home and back; the box must read the default. copyConventions.test.ts "T-159 (1)" is the Audio Studio counterpart of the one-name rule: it scans the person-visible strings under `modules/audio-studio/**` and the Audio tour for the Video Studio unit, with its own discrimination block.
- **The T-159 fold.** media.spec.ts "the scratch the compilation made is gone..." (T-125 (1)) waited a fixed 1.5 s before its cancel, and the whole 8-segment join takes 1.2-1.8 s on a fast host, so it finished first and "the join ended as a cancel" failed; it now polls (20 ms, 30 s) for the canceled job's first scratch file, which is what its comment claimed.

## Round 109 Track A (T-160 items 1, 2, 5 and two folds): what the new cases hold

- **An old autosave is seeded by its own date.** home-chrome.spec.ts "T-160 (1)" writes a valid project into `autosave/autosave.json` with `savedAt` nine days back (main prints the age from `savedAt` for a file that validates), so the banner's "9 days ago" is the real path and not a stub. The Restore case ends in Stream Graphics holding the layer; the Clear case ends with the file gone and the "Last autosave" line with it. The unit pin in autosaveCorruptInfo.test.ts moved from "gates on age" to "no age comparison and no STALE_THRESHOLD_MS".
- **A held transcript is a project with an `srtPath`.** video-pipelines.spec.ts "T-160 (2)" opens a project whose `videoStudio.srtPath` names a real SRT in the captions folder, with main told the engine is ready (`captions:status` replaced, as the other caption cases do since no engine is installed in any test environment), so the first-run hint's condition is live. A second case with no transcript keeps the hint and "Transcribe", which is what stops the fix from deleting the hint.
- **The dialog is the assertion.** references.spec.ts "T-160 (5)" captures the confirm text, accepts it, and presses Ctrl+Z: the board comes back with both items on disk. The two older cases that read the question (three assertions) were edited in place.
- **Two caps compared from source.** interactionWiring.test.ts "T-160" reads ExportPanel.tsx and `src/main/store.ts` and asserts each input's `maxLength` against the schema's (equal for the Filename box, at or under for the watermark box); removing the attribute or moving either number fails it.

## Round 109 Track B (T-160 items 3-4): what the new cases hold

- **A stereo fixture tells a channel meter from a mono one.** audio.spec.ts "T-160 (3)" builds stereo WAVs with the bundled ffmpeg (`sine`, `volume`, then `pan=stereo|c0=<l>*c0|c1=<r>*c0`): a tone on L only, on R only, and L = -R (zero in a mono down-mix, so the old meter read "-60 dB"), plus -0.7 and -1.2 dBFS tones either side of the red line. Each is played under the built app and the label sampled every 16 ms in the page; the last 20 samples must be one and the same text. The mutations that listen to the wrong channel, read one channel, or read the mono analyser each fail a named case.
- **The label fold needs a fixture on each side of -1 dBFS.** `Math.ceil` against `Math.round` differs only between -1 and -0.5 and between -1.5 and -1; the -0.7 dBFS tone (red, "0 dB") and the -1.2 dBFS tone ("-1 dB", muted) are the pair that fails `round`, and a threshold moved to -0.5 fails the second.
- **A file's size is read off its header, not trusted from the name.** image.spec.ts "T-160 (4)" opens the 2K thumbnail template, sets Scale 0.5x and JPG, and saves the four variants to the stubbed folder; the JPEG's size comes from its first start-of-frame marker and the PNG's from IHDR. The PNG-at-1x case is the guard that the default path is unchanged. The JPG quality slider is held by the wiring pin alone.

## Round 110 Track A (T-161 items 1-3): what the new cases hold

- **A subtitle track is built into the fixture, not assumed.** media.spec.ts "T-161 (1)" muxes a 10 s source with the bundled ffmpeg's own `srt` (Matroska) and `mov_text` (MP4) encoders, asserts the fixtures really carry the track, and compiles two ranges (1-5 s and 7-8 s) through the real `runConcat`. The assertions are the output's duration against the sum of the ranges within one frame, the frame count, and a stream list of exactly video and audio; the unchanged runner gave 4.498 s for the MKV and 1.996 s for the MP4. A source with no subtitle track is the control. `-dn` has no case that fails without it (ffmpeg selects no data stream by default), which the ledger discloses.
- **A caption is a spread of luma on a flat picture.** "T-161 (2)" burns a ranged window of a flat gray video holding a transcript saved with "[MUSIC]", "(upbeat music)" and music-note cues, and reads the bottom third of the frames at the tags' times: the spoken words' frame has a spread above 40, each tag's has none. A window holding only a tag is the clip with no captions (`captioned: false`). The engine is not installed in any test environment, so its write-back is held by transcribeClean.test.ts, which fakes the child (captionsProgress.test.ts's technique) and has the engine write the tags; the real-media half is the old-transcript path through `shiftSrtToRange`.
- **A level claim is measured per channel.** "T-161 (3)" makes a mono Opus WebM with the bundled ffmpeg (what Record makes), a stereo file with a 8 dB difference between the sides and a 5.1 file, runs the real `extractAudioFromVideo`, and reads each channel's peak with `astats`: L = R = the take's own peak within 0.1 dB (the unchanged extract read 3 dB under), each side of the stereo file within 0.1 dB of its source, the 5.1 file in both sides. A file with a mono and a stereo track is compared with the plain `-ac 2` extraction. extract.test.ts fakes the new ffprobe (`./probe`), since its fake `spawn` drives one child.
- **The empty-transcript toast is a pure helper.** captions.test.ts pins `captionsReadyMessage(0)` as "No speech found, so there are no captions" (the older 0-lines case was updated in place), because a transcription of music or silence now leaves no cue.

## Round 110 Track B (T-161 items 4-6): what the new cases hold

- **A fixture whose signal lives on the channel the node would drop.** audio.spec.ts "T-161 (4)" builds a six-channel WAV with the bundled ffmpeg (`sine`, `volume`, then `pan=5.1|FC=c0`, every other channel silent) and asserts the fixture really has six channels before it plays it. The old meter read "-60 dB" from it; the fold reads the centre at 0.7071 of the tone's peak, so a 7.7x tone (peak 0.9625) settles on "-3 dB" (-3.34 dBFS, 0.34 dB from the ceil edge at -3 and 0.66 from -4). The stereo cases (L only, R only, L = -R, -0.7 / -1.2 dBFS) are the guard that the fold costs a stereo source nothing, and they are unchanged. The mutants that change the fold's channel count, count mode or interpretation are killed by this case and by those.
- **A question's list is asserted whole, from a real session.** video-core.spec.ts "T-161 (5)" runs Scan VOD over the opened video and presses Close with nothing edited, then asserts the exact sentence and that it holds neither "edit" nor "clip". The chat-log, spike and undo-history sentences are unit-only (videoStore.test.ts "names what is lost"), where each kind and each pairing is a one-line case; the e2e case is the proof that the store's list reaches the dialog.
- **"Not answered yet" is held, not waited out.** video-pipelines.spec.ts "T-161 (6)" holds main's `captions:status` behind a gate, so the unknown state lasts as long as the assertions need, and looks for the card ten times across a second before releasing; a card that painted and was removed within a frame would be missed by one look and caught by ten.

## Round 110 Track C (T-161 items 7-8): what the new cases hold

- **The dialog is read where the person reads it.** image.spec.ts "T-161 (7)" asserts the Variants dialog's `variants-output` block, not the source: the size note's exact sentence at Scale 2x PNG on the 1280x720 template, before and after Generate; on the emote template the line contains "Output: 112x112 PNG" and not "as the Export card". The freshness fold is a state walk: generate at PNG, close, JPG, move the quality slider, PNG, reopen, and the four previews are still there (the quality slider exists only at JPG, so a mutation that compares the quality for PNG too is what fails it).
- **The confirm text is captured, not inferred.** references.spec.ts "T-161 (8)" seeds a board with no item and one with a single item, dismisses the native confirm and asserts its exact message; the three older assertions that read "and all 0 items" / "and all 1 item" were edited in place. interactionWiring.test.ts "T-161" pins the single builder (`deleteQuestion`) and its three branches.

## Round 111 Track A (T-162 items 1-2): what the new cases hold

- **A transcript's emptiness is read from the burn's own output, and a level claim from one coefficient at a time.** media.spec.ts "T-162 (1)" burns a flat gray video through the real `runBurnIn` WHOLE (no range) with a 0-byte transcript, a tag-only one, a tag-and-speech one and a speech-only one in a folder of its own, and compares frames as the T-161 (2) describe does: a caption is a spread of luma (min to max over the whole frame, or its bottom third), "no tag drawn" is a spread of at most 3 at the tag's time and "the speech is drawn" is a spread above 40 at its time; the unchanged runner exited 183 on the empty file and drew the tags. "T-162 (2)" puts a 440 Hz sine at -24.08 dBFS on ONE channel of a 5.1, 5.1(side) or 7.1 layout (or a 3, 4, 5 or 7 channel one) and reads each extracted side with `astats` (a silent side is `-Infinity`; the older `channelPeaks` helper cannot read "-inf"): centre and surrounds at -3.01 dB of the source, fronts at unity, LFE silent, an AAC 5.1 file the same within 0.3 dB. A full-scale in-phase tone on FL, FC and BL reads back as raw s16 beside the source's own front left: the left spends over 60% of the wave at the rail and no loud sample changes sign (a wrap would); the unchanged extract normalised the matrix and never clipped. The T-161 (3) 5.1 pin was edited in place to hold -3.01 dB of the source. transcribeClean.test.ts fakes the engine (a tag-only output leaves no file and answers `srtPath: null`), extract.test.ts the filter per channel count, and video-pipelines.spec.ts "T-162 (1)" stubs main's `captions:transcribe` and reads the panel and the toast: the app's own warning icon is an `svg` beside the sentence and react-hot-toast's success mark is not, so a `toast.success` fails it. cancelSentinel.test.ts's burn-in row was given a real transcript, since the whole-video burn reads one.
- **The burn toast is keyed on whether the burn had a range.** video-pipelines.spec.ts "T-162 fold" burns a tag-only transcript through the real runner from a reopened project, whole (range box off) and then ranged: "No speech in this transcript — exported without captions" with the warning icon and a 2 s file, then "No captions in this range — exported without captions"; captions.test.ts holds the three answers and interactionWiring.test.ts pins that the panel passes the burn's own range decision. Red on the unchanged tree; a constant `true` or `false` at the call site is killed by the e2e and the pin.

## Round 111 Track B (T-162 items 3-6): what the new cases hold

- **The canceled sentence is held at both ends, on a real batch.** video-pipelines.spec.ts "T-162 (3)" holds job 1's encode behind a spawn stall and cancels a two-file batch inside it (Cancel, then the question's Cancel jobs): the one cancel toast is exactly "Export canceled.", both rows say Canceled, no row offers Show in folder and the folder is empty. The second case holds job 2's probe and cancels after job 1 landed: the folder sentence. exportQueue.test.ts drives the same two orders through `runExportBatch` with a fake bridge (a job-complete event before the rejection, or none), so the count is read from the rows main has already updated. Eleven older pins of the long sentence were read one by one for what their scenario produces; the three-job cancel counts its Show in folder buttons instead of assuming a timing.
- **A drawn box is read against a drawn box.** image.spec.ts "T-162 (4)" applies the channel-art template and reads the sample text node's and the TV-safe rect's client rects from the stage (stroke skipped, so the frame is the layer's declared size), asserting all four edges and clearance from the hint line. The width is the machine's real glyph run, which a unit test cannot know; templateTruth.test.ts holds the part that is data (y to y + fontSize x lines inside the rect, one line, still a hint).
- **A 7.1 file is heard and metered through one fold.** audio.spec.ts "T-162 (6)" builds an eight-channel WAV with the bundled ffmpeg (`pan=7.1|FC=c0`, a 7.7x tone: peak 0.9625), checks the probe reads "8 ch", plays it and samples the label every 16 ms: "-3 dB" (the centre at 0.7071, -3.34 dBFS). On the unchanged build the label read "-60 dB", so the media element does hand Web Audio all eight channels and the item stands. interactionWiring.test.ts reads the matrix from the exported `FOLD_7_1` (the gains into each side, the LFE absent) and pins the graph's edges: the fold's output feeds the spectrum analyser (which plays to the destination) and the two-channel splitter, and the source reaches neither directly. Two older meter pins that asserted the source feeding the analyser directly were edited in place to the new edges.

## Round 112 Track A (T-163 items 1-3): what the new cases hold

- **"Ran, found nothing" is a state with a line, held through the whole life of the video.** video-pipelines.spec.ts "T-163 (1)" stubs `captions:transcribe` in main (as T-162 (1) does) to answer `srtPath: null, segments: []` and asserts the line "No speech found in this video, so there are no captions." is on the panel ONCE after the toast has gone (waited out), with no preview, no Save .srt and Burn into video, the header "Re-transcribe" and no first-run hint; it survives a trip to Home, is gone for a different video (hint and "Transcribe" back), is absent while a held (6 s) run is under way, and a run with speech takes it away. T-162 (1) was moved in place (the hint gives way to the line; the header says "Re-transcribe").
- **A safe-zone intro read against the tall orientation.** "T-163 (2)" crops 4K video to 9:16, ticks YouTube and TikTok and reads the dialog's new intro and its row "TikTok frame → cut down for YouTube"; the 4:3 pin moved with the sentence.
- **A toast rule is checked on helper outputs too.** copyConventions.test.ts "T-163 (3)" is an explicit list of calls (captionsReadyMessage 0/1/3, all four burnInDoneMessage pairs, clearedTranscriptsMessage's two single-sentence branches, previewCopySkippedMessage), each asserted to end without a period and hold no ". "; the two-sentence helpers (staleCaptionsMessage, the partial clear) are asserted to keep both periods. Left out on purpose: failure sentences (a full sentence with its period), overlayOutsideClipMessage (an inline note) and clearTranscriptsQuestion (a confirm). A new result-toast helper must be added to the list by hand.

## Round 112 Track B (T-163 items 4-5): what the new cases hold

- **A paste behind a dialog is a real paste.** image.spec.ts "T-163 (4)" puts a picture on Electron's clipboard (`clipboard.writeImage`, as the older paste cases do) and presses a real Ctrl+V with the Variants dialog open after Generate (four previews, Save all focused) and with the Templates dialog open. Each asserts the layer count is unchanged after 1.5 s (long enough for the async image read to have landed a layer), and the Variants case that the four previews and the focused button are still there. The same case then closes the dialog and presses the chord again, which must add the layer: that proves the clipboard held a picture the listener would have taken, so the unchanged count is the guard's doing and not an empty clipboard's. A separate no-dialog case is the plain control. The unit pin (interactionWiring.test.ts) holds what no e2e can: that the guard is the first statement of `onPaste` and never calls `preventDefault`, which is what lets a text field inside a dialog still paste.
- **Save with nothing open is asked of the real handler and the real button.** projectSave.test.ts runs the real `project:save` with only electron stood in for: an empty project throws the sentence, `showSaveDialog` is never called, nothing is written, and `userFacingError` shows the sentence as written after Electron's wrapper; a project with a video reaches the dialog; a malformed project keeps `unsupported schemaVersion` (the order against the shape check). home-chrome.spec.ts "T-163 (5)" presses Save project on a fresh launch with the Save dialog replaced in main by the suite's recording stand-in, and reads the toast log: exactly the sentence once, no "Project saved", no dialog call, no file; its control opens a real video in Video Studio and saves.

## Round 113 Track A (T-164 items 1-3): what the new cases hold

- **A level claim on an export needs a source that tells the paths apart, and a codec tolerance that was measured.** media.spec.ts "T-164 (1)" runs the real `runAudioExport` on 5.1 WAVs with one tone on one channel and reads the decoded MP3's per-channel peaks with astats: the unencoded expectation (front left at the source's peak, centre -3.01 dB per side) is held to 0.6 dB, the codec's own error measured at 0.26 dB on 7.0.2. The Even volume case uses a back-left tone, because R128 weights a surround channel +1.5 dB and the fold does not: front-left and centre tones read the same whether the loudnorm measured six channels or two (a first version of the case with them passed on the unchanged tree), the back-left one lands 4.7 LU low there. WAV and FLAC are controls that keep six channels. The fold in the MEASURE pass is not separable at this layer (the render pass's loudnorm re-corrects a measure that is 4.5 LU off: -16.4 LUFS executed on 7.0.2), so that stage is pinned by singleTrackTail.test.ts alone.
- **An outline weight is measured as dark pixels.** "T-164 (2)" burns one cue on a flat gray clip in white text with a black outline at one font size, and counts pixels under luma 64 in the bottom third: Big-outline accessibility is at least 1.8x Subtle subtitle (5476 each on the unchanged tree), and a style with no `outlineWidth` is pixel-identical to the same style at 2.
- **The preset load failure is asked of main.** audio.spec.ts "T-164 (3)" replaces `audio:listPresets` in main with a throw before the sound opens (the panel loads the list on mount) and reads the toast log for exactly the sentence.

## Round 113 Track B (T-164 items 4-6): what the new cases hold

- **A running Reframe has a row wherever its panel is not drawn.** video-pipelines.spec.ts "T-164 (4)-(6)" (4) starts a Reframe on the 20-minute fixture (still running when the person acts, as the T-144 cases rely on), closes the video, builds a vertical 180x320 file with the bundled ffmpeg and drops it on the importer. The cases assert what a person sees: no Reframe panel for the vertical video, the card's row "Reframe - Clip 1" with exactly one Cancel and the sentence that does not say a video is closed, then Cancel gives the neutral toast, the row goes and the folder holds no file and no partial. The unit layer holds the rule's edges the e2e cannot cheaply reach (a square video, a horizontal video with no clip selected, a horizontal video WITH a selected clip leaving the card empty so the panel's own row is not doubled, every other job still drawing no row with a video open).
- **The card names the person's file, from a real conversion.** "T-164 (4)-(6)" (5) drops stream.flv, waits for the real convert, starts a one-file Export, holds the export's own encode in main with `installSpawnStall` (30 s; the conversion's ffmpeg is already over, so the first spawn after the patch is the export's), closes the video and reads the card: "Export - stream.flv: file 1 of 1", and nothing on screen matching a working copy's `-<8 characters>.mp4`. Cancel before the stall ends leaves no real ffmpeg behind (the wrapper is killed while it still sleeps). The Compile sentence is read off the real card beside the Reframe card's.

## Round 113 Track C (T-164 items 7-10): what the new cases hold

- **A mixed clipboard is written and pasted for real.** image.spec.ts "T-164 (7)" writes Electron's `clipboard.write({ text: 'PASTED', image })` in main, clicks Properties' Name box, selects all and presses a real Ctrl+V: the box holds PASTED and Layers stays (1); then, in the same flow and with the same clipboard, the focus goes to the canvas and the chord adds the picture (2). A second case pastes into the text layer's Text `<textarea>` (the guard covers every text-entry element, not `<input>` alone: narrowing it to `HTMLInputElement` fails this case and only this one).
- **The selection handles are read off the stage.** "T-164 (8)" reads `borderStroke()`, `anchorStroke()` and `anchorFill()` from the stage's Transformer with a layer selected on the white page and again on a dark template, and asserts the accent and ink-base tokens (red on the unchanged build: `rgb(0, 161, 255)`); designTokensInSync.test.ts pins the props as token imports and the 3:1 visibility of an anchor on white and on the near-black.
- **Tiles are measured, not eyeballed.** image.spec.ts "T-164 (9)" (the empty state's grid and the Templates dialog's) and references.spec.ts "T-164 (9)" (the Asset Library) set the window to the 1024 minimum, group the tiles into rows by their own top and require every row's preview client-rect tops to agree within 1 px, with at least one row of two tiles so the test cannot pass on a one-column grid.
- **The webcam hint is read on the card.** record.spec.ts "T-164 (10)" reads the exact sentence on the Record card and asserts the old developer words are gone.

## Round 114 Track A (T-165 items 1, 6, 7 and a fold): what the new cases hold

- **Every clipboard is real and cleared first.** image.spec.ts "T-165 Track A" writes Electron's `clipboard` in main (`clear()`, then `writeImage`, `writeText` or `write({ text, image })`) and presses a real Ctrl+V. A picture alone pasted with Properties' Name box focused adds the image layer (Layers (2), an Image on the stage); text AND a picture, and text alone, pasted into the box fill it and add nothing (controls, green on the unchanged build). Words alone with the canvas focused add one selected Text layer holding them, and Ctrl+Z removes it; a whitespace-only clipboard adds nothing and raises no toast; on the empty start screen the toast log is exactly the refusal sentence and the start screen stays; a held chord (Control down, `v` down three times) adds ONE text layer and a fresh chord another.
- **The selection frame is read two ways.** The stage's Transformer gives `padding()` 4 and `borderDash()` [6, 4]; and a screenshot of a fresh rectangle (the `r` tool, then Select) on the white page is read with the bundled ffmpeg (`pixelsOtherThanBackground`): the three rows just outside the stroke, 30 px wide a quarter along the top edge, are the page, and the rows 4 to 7 out hold ink (a dash of the frame). The sample is off the middle because the top handle and the rotation stalk sit there; on the unchanged build the frame is ON the stroke, so the first read counts ink and the second finds none. It is deterministic at the suite's window size and would need re-measuring if the window or the zoom changed.
- **The emote tiles are read from the grid.** The empty state's tiles are found by exact name ("Emote · Blank circle", "Emote · Text "POG""), both must contain "28, 56, and 112 px", and no tile may say "auto-exports". interactionWiring.test.ts's T-164 (7) pin now also asks that the guard reads the clipboard's `text/plain` type before it.

## Round 114 Track B (T-165 items 2-5 and a fold): what the new cases hold

- **A camera is presented, not assumed.** record.spec.ts "T-165 (2)" reads the Record card's webcam hint in the three states: the default (unticked), ticked with the container's real zero cameras (the hint absent, "No camera found" on screen), and ticked with the `stubCameras` pair (the hint present beside Corner, gone when unticked). The T-164 (10) wording case ticks a stubbed camera first, because that is now the only state that shows the sentence.
- **The Export card is driven through the tick.** audio.spec.ts "T-165 (3)" drops a real mp4 (Re-attach opens ticked), asserts no Format and no Bitrate, unticks (Format is back, enabled, at MP3), picks WAV, ticks and unticks again and reads WAV. The older pin that the select was DISABLED while ticked ("drop of a video extracts its audio") now asserts there is no select on the card at all while ticked and an enabled one after unticking.
- **A held key is one keydown and repeats.** video-pipelines.spec.ts "T-165 (4)" is the suite's held-Enter pattern (`keyboard.down('Enter')` five more times on the focused button): one post in the card and in config.json, one toast, no red. A control case presses Enter twice with a different name each time and gets two posts.
- **The caption dials are driven from a project.** "T-165 (5)" opens a seeded project through Home (the way the style controls are reached without a model), reads the line, clicks each of the four presets and asserts `aria-pressed` is true for that one and false for the other three, then moves Size and Position and asserts none is pressed. captions.test.ts "captionStyleMatches" holds the rule's edges (each preset, a one-field move, uniqueness, the default style, the omitted-`outlineWidth` rule).

## Round 115 Track A (T-166 item 1 and a fold): what the new cases hold

- **The box is read as Konva drew it.** image.spec.ts "T-166 Track A" opens the template, selects nothing (a click on bare paper with the Select tool: no Name field), writes a real clipboard in main and presses a real Ctrl+V, then reads the new Text node's `x`, `y` and the `width()` and `height()` Konva measured for it (not the editor's estimate). The right and bottom edges must be inside the page (1280x720 on "YouTube · Bold thumbnail", 112x112 on "Emote · Blank circle") and the ink at least `READABLE_CONTRAST` against everything `surfacesUnder` finds under the measured box. The numbers are attached as test annotations: on 3e30b43 the thumbnail's right edge was 1597 and the emote's 360; they are 506 and 96. A third case opens the `?` overlay in Stream Graphics and reads the Ctrl+V row.
- **The unit layer holds the rule, the wiring and the controls.** newText.test.ts: `estimatedTextBox` of a two-line string, `\r\n` as one break (the longer line first, so a stray `\r` shows), the height fit on a 4000x30 strip, the sentence on the Bold thumbnail's and both emote documents' (built from templates.ts) inside and at `READABLE_CONTRAST` by the module's own `worstContrast` and `surfacesUnder`, a two-line title inside each page. canvasStore.test.ts: `textLayerFor(doc)` pinned to today's literal layers, `textLayerFor(doc, sentence)` differs. The one-line sentence cases are controls (green on 3e30b43: `newTextLook` already took a word); a two-line title is the case that is red there.
- **A readable place is promised only where one exists.** A two-line title on an emote's disc has no place that reads (a 106 px by 22 px box covers the disc and the transparent corners), so those cases hold "inside" only; the Bold thumbnail's two-line case holds both.
- **An existing case that pinned the old box was changed in place.** "a pasted text layer looks like "+ Add text" on the same dark template" asserted x equal; it asserts the rest equal and the right edges equal.

## Round 115 Track B (T-166 items 2-4): what the new cases hold

- **A no-op edit is judged by the store's own witness.** videoStore.test.ts "T-166 (3)" runs each guarded setter (crop, grade, range through `setClipStart` / `setClipEnd` / `setClipRange`, speed, text overlay) with the value already stored and asserts `history`, `historyKey` and `clips` are the SAME objects afterwards (no `set` at all), then the control: a real change pushes exactly one step and Undo reverses it. video-core.spec.ts "T-166 (3)" is the same claim through the studio's Undo button on a real video: tick and untick Crop, Reset, Reset color all leave it disabled, and a 16:9 crop lights it, so a button that is never enabled cannot pass.
- **The Audio tour is read at the step.** audio.spec.ts "T-166 (2)" drops a real mp4, opens the tour with Show tutorial and presses Next until the card's name ends ": Export", reads the new sentence, closes the tour and checks the card it described (Re-attach ticked, no Format; unticked, Format).
- **The native menu is recorded, not drawn.** references.spec.ts "T-166 (4)" wraps `Menu.prototype.popup` in main through `app.evaluate` (it records the popped menu's item roles and keeps the menu; the OS menu itself cannot be seen or clicked from a page), puts text on Electron's clipboard, and right-clicks the focused Reference Search box with a real `click({ button: 'right' })`. Electron reads a built item's role back in lower case ('selectall'), so the order is compared lower-cased. The recorded menu's Paste item is then clicked in main with the window as its target, which is what the OS menu does, and the box must hold the clipboard text. A right-click on the page heading, a place that is not a text box, must pop nothing, so a menu that pops everywhere fails. contextMenu.test.ts holds the pure rule: the editable list in order, each item enabled by its own flag alone, Copy alone for selected words in plain text, nothing otherwise (a white-space-only selection too).

## Round 116 Track A (T-167 items 1-2 and a fold): what the new cases hold

- **The box is read as Konva drew it, and the page as the background node drew it.** image.spec.ts "T-167 Track A" writes 25 lines of 45 capitals and spaces (so the box is over 800 px wide by the editor's estimate, the case the picture rule shrank) to Electron's clipboard, presses a real Ctrl+V on the default page with the canvas (not a field) focused, and reads the new Text node's `getClientRect({ relativeTo: <its layer> })` (document units) and the background node's size: right and bottom must be inside 1200x800 and the box must still be all 25 lines tall (above 700 px, so a shrunken box cannot pass). On 3f308a6 the bottom was 859.26 of 800. A second case rotates a rectangle 45 by its "Rotate 45 degrees" preset, presses Ctrl+Z, presses "Rotate 0 degrees" and asserts the Redo button is still enabled (and brings the 45 back): disabled on 3f308a6.
- **The estimate is held against the measurement, not against itself.** newText.test.ts carries the advances measured in the built app (a canvas 2d context, `100px Inter` at 400 and at 700 after `document.fonts.ready`, every printable ASCII character: 95 numbers each) and asserts that no character is wider than `estimatedTextBox` says, that every entry is the ceiling of its own measured advance (so an entry padded to a round number fails), that "WWWW MMMM" and an all-caps sentence are at least as wide as measured, and that an all-caps 90-character line sized to a 1280 page fits as drawn. The T-141 (2) cases on rendered pixels (image.spec.ts, "+ Add text is readable against what is drawn under it") are the witness that a tighter-than-flat estimate matters: a per-class bound, tried first, put the POG emote's word on the disc's stroke. The brute-force sweep (lines 1-60 step 3, characters 1-300 step 7, five pages) skips the shapes that do not fit even at the 1 px floor and states its count; a control compares the new home place with `placementFor` for every box up to 800 px, so "does not move for a small box" is a test and not a claim.
- **Store no-ops are judged by identity.** canvasStore.test.ts "T-167 (2)" asserts `doc`, the `history` object, `past`, `future` and `historyKey` are the SAME objects after `setRotation` to the current rotation (a layer with no rotation counts as 0), `updateLayer` with the layer's own x and y (keyed and not), a line's `points` copied, a hint retyped with its own words, an empty patch, an unknown id, and `reorderLayers` with the same order, so a guard that still calls `set` fails; a keyed no-op leaves the window key of the last real edit; controls: a real rotation, patch and reorder are one step each and clear Redo, a keyed run is still one step.
- **Existing cases that pinned the old numbers were changed in place:** the "Text" box (76.8 to 70.4 at 32 px), `ab\ncdef` (24 to 22.1), `abcd\r\nef` (24 to 24.3), the blank line (6 to 6.3), the 30x500 strip's width-fit size (12 to 13), the Bold thumbnail's "+ Add text" x (1150.4 to 1156.2) and the blank emote's place ((52, 58) to (56, 58)); the rotation case that pressed 90 twice presses 90 then 180; docClaims' three `canvasStore.ts` cites moved by the new lines. The T-165 "looks like + Add text" case keeps "PASTED WORDS" (8.19 em against "Text" 2.20) and compares the right edges by those widths.

## Round 116 Track B (T-167 items 3-5, the (z) fold and the crop-click check): what the new cases hold

- **A late scan is held in main.** video-pipelines.spec.ts "T-167 (3), (4)" replaces `video:findHighlights` with a handler that answers when the test says (the T-131 (3) technique), so the video can be closed, or another opened, while the scan runs. Released after Close, the plain toast names the file and no "Found" or "No standout" toast appears; with a second video open, the finder's progress bar reads `Scanning <first file> for highlights`. The T-131 (3) replaced-video pin gained the same toast in place, and the four pins of the old bar name ("Scanning the video for highlights": a11ySweep and three e2e cases) moved to the new one.
- **A failed kit is the suite's failing job, at job 3.** The source is removed while job 3's probe is held (`installSpawnStall`, `ffprobe` nth 3), so jobs 1 and 2 are on disk; the toast is read whole ("Clip Kit failed. The 2 files already finished are in your folder." then the cause) and the folder holds exactly two files.
- **The keyboard menu uses the real key.** references.spec.ts "T-167 (5)" presses Shift+F10 with Playwright's keyboard (a CDP key event; Chromium's own handler raises `context-menu` with `menuSourceType: 'keyboard'` on Linux, so nothing is emitted by hand) with the pointer parked at (5, 5). `Menu.prototype.popup` is wrapped in main to record the OPTIONS it is given, and a second `context-menu` listener records the params; they must match and the place must be inside the Search box. A right-click is the 'mouse' control.
- **Layer 5 for the audio chain (IMG-PREC).** media.spec.ts "a hot master with +12 dB of Manual gain and Even volume (T-167 (z))": a generated stereo sine that reads -9.8 LUFS (lavfi's sine is 1/8 amplitude and the mono-to-stereo upmix is power-preserving, so the gain is +11.27 dB; the first case reads it back), a fixture check that pass 1 of the boosted chain prints `input_i` above 0, `parseLoudnormJson` on that real stderr, the real `runAudioExport` to WAV (measure then render, within 1 LU of -16), and the unboosted control on the measured two-pass path. Run on the bundled 7.0.2 and on 6.1.1. chain.test.ts holds the unit half (each field just past its range is null; the range edges parse).
- **The crop click is judged by Undo.** video-pipelines.spec.ts "T-167: a click on the crop box with no drag" crops to 9:16, 1:1 and 4:5, presses and releases on the middle of the box with no movement between, and presses Undo once: the button must be disabled (one crop, one step). The 16:9 crop of the 16:9 fixture is the whole frame, whose arithmetic is exact, and passes on the old code; the no-click case proves one Undo undoes the crop alone.

## Round 117 Track A (T-168 items 1-3 and 5): what the new cases hold

- **The late toast is read for its duration, not its text.** video-pipelines.spec.ts "T-168 Track A" (1) holds the scan in main (as T-167 (3) does), closes the video, releases the scan, finds the toast bar, reads the first `path` of its icon (the warning triangle, not the magnifier), waits 6 s after the toast appeared and asserts it is still visible, then asserts it goes within 10 s (a finite duration). react-hot-toast keeps nothing readable about a duration, so waiting past the 4 s default is the only witness.
- **The scan line is measured with a name that does not fit.** "T-168 Track A" (2) reads the line as text with the title holding the file name (another video open), and with a 70-character name checks `expectEllipsized`, that the percent, the bar and Cancel share the line's row (vertical centres within 3 px), that the bar is still 40 px or wider and that the card does not overflow sideways.
- **A crop handle is pressed without a move and judged by Undo.** "T-168 Track A" (3) crops to a locked ratio (one step), presses and releases on a handle (re-resizable's handles are `div`s whose inline style carries the cursor: `se-resize` and `nw-resize` for the corners, `col-resize` and `row-resize` for the edges, which exist only once the ratio is Free), then presses Undo once: the button must be disabled. The controls: a real drag of the corner leaves Undo enabled after one Undo; and a click on the corner after a real resize and a real move adds no fourth step (control). The "stale delta" case is the one that discriminates the guard: re-resizable never resets its `delta` between presses, so after a real resize and a preset that puts the box at a fractional size, a click on a handle is handed the old non-zero delta; a guard that reads `delta` pushes a fourth step, one that compares the size at the press does not. A top-edge resize (height only) is a control that the guard does not skip a real change.
- **The unreadable chat log is read from the panel.** "T-168 Track A" (5) types the two unsupported shapes into the finder's box and expects the sentence (warn ink, below the textarea), and expects nothing for an empty, a blank, a supported and a mixed log. chatLog.test.ts holds the constant's text and the shapes the parser returns `[]` for; those two shape cases and the control pass on the unchanged parser by design (the parser did not change), the constant's two cases are the red ones.

## Round 117 Track B (T-168 item 4 and its fold, item 6, three folds): what the new cases hold

- **A running batch is held in main, then moved from video to video.** video-core.spec.ts "T-168 (4)" replaces `video:exportBatch` with a handler that answers `[]` when the test says, starts an export on a copy of the fixture named stream-a.mp4, closes that video and drops stream-b.mp4: the line "Export of stream-a.mp4, started on another video." must be on screen with the file name as its title and above the Queue heading, must not be on screen on stream-a.mp4 itself (the control; a line that is always drawn fails there), and must go when the held batch is released. A second case holds `video:exportGif`, `video:concat` and `video:pipComposite` the same way and reads each card's busy line (the clip "Clip 1", the video "video-core.mp4", the base file) with its title and its Cancel, which must still be there.
- **The double-click is real and its precondition is asserted.** home-chrome.spec.ts "T-168 (6)" walks the video tour to its last step, then scrolls the studio so the "Watermark position" select is under the middle of Done (the tour's own scroll varies run to run, which is what made the T-131 case a coin flip) and asserts `document.elementsFromPoint` at that point holds the select. A real `dblclick()` follows; the page's own document listeners (mousedown, mouseup, click) must have seen no press with a count above 1, `document.activeElement` must not be a SELECT, and `?` must open the shortcuts (a popup that opened would hold the key). The three checks are soft assertions so the unchanged build shows all three failing. The T-131 case itself was run 10 times standalone on each build: 2 of 10 passed on 01edf08, 10 of 10 on the new build.
- **The listener rule is a unit test on a stand-in window.** repeatPress.test.ts stubs `window` with an object that records `addEventListener`, imports a fresh copy of the module each time (the once-flag is module state) and calls the handler each type registered with an event stand-in: mousedown, mouseup and click inside the window are stopped and canceled; a first press or a press after the window is not; a second close moves the window without stacking handlers.
- **The helper pin.** copyConventions.test.ts gained a describe that pins `countOf(ASSET_CATALOG.length, 'asset')` in AssetLibraryPanel.tsx (red on 01edf08). The LayerPanel deletion has no test: the branch it removed is unreachable by construction (ImageStudio's mount condition), and a test of the absence of copy no path draws would pin nothing.

## Round 118 Track A (T-169 items 1 and 3): what the new cases hold

- **The files appear after the panel mounted, and one press is judged by main's call count.** video-pipelines.spec.ts "T-169 Track A" (1) replaces `captions:status` with a handler that answers from a flag and `captions:transcribe` with one that counts its calls and holds, opens the studio on the real (empty) install so the cached status is "not ready", flips the flag (the engine "placed in the bin folder", the panel told nothing) and presses Transcribe once: the button reads "Transcribing…", main's transcribe was called exactly once and the setup card is gone. The control keeps the flag false: the press opens the setup instructions and main's transcribe is never called. The control passes on the unchanged build by design; the first case is the red one. Two more cases hold the status answer in main and press Transcribe: one closes the video, one closes it and drops a DIFFERENT video (a video is open when the answer arrives, so only the file-path guard, not a presence check, drops the press); both expect main's transcribe never called, and the second no "Transcribing…" either. Both pass on the unchanged build by design (it never reads the status); mutation proves them (the presence-only guard is killed by the second).
- **The scan line is measured at the default window with the guide's own name.** "T-169 Track A" (3) holds the scan on `stream.mp4` and reads the line's `scrollWidth <= clientWidth` (whole, no ellipsis), its bottom at or above the bar's top, and the bar at 120 px or wider; the T-168 long-name case is updated in place to the new shape (cut with an ellipsis and its title, the name's row above, the bar, percent and Cancel on one row, no sideways overflow).

## Round 118 Track B (T-169 item 2 and four folds): what the new cases hold

- **A no-op is judged by object identity, with Redo held.** audioStore.test.ts "T-169 (2)" makes one real change and an undo first, so `future` holds a step, then asserts that `history`, `historyKey` and `chain` are the same objects after each patch that names only what the chain already holds (a flag, a preset, a number; `cutRegions` equal by value in a new array; `denoiseParams` equal by value; an equal `secondaryTrack`; `secondaryTrack: undefined` over `null`; `humHz: 60` over an absent one). Controls that pass on the unchanged store by design: a real change still pushes, a patch with one real field and one equal field is one step carrying both, a keyed patch coalesces; the keyed case also pins that an equal keyed patch opens no window and that the drag's repeat of its last value does not close the one it holds. referencesStore.test.ts "T-169 (2)" counts calls at `moodboard.rename` and compares the `history` object for the board's own name, the name padded, empty and blank; a rename queued behind another that set the same name is judged on the name when its turn starts (red on the unchanged store: two calls).
- **The e2e cases drive the buttons and read Undo and Redo.** audio.spec.ts "T-169 (2)" clicks the pressed "Off" under Quieter background and the Compressor's pressed "Off" on a fresh file (Undo stays disabled), then Medium, Undo and "Off" (Redo stays enabled, Redo restores Medium), then Light (Undo enabled, Redo disabled: the control). references.spec.ts "T-169: References" confirms the pre-filled Rename dialog with Enter (the dialog closes, Undo stays disabled), renames and undoes, confirms the board's own name padded with spaces (Redo stays enabled), and ends with a real rename (the control).
- **The held key is two repeats after the answer arrived.** The case sends one search with `keyboard.down('Enter')`, waits for its picture and the idle button, then sends two more downs (Playwright marks them `repeat`) and counts calls at the replaced `search:images` handler: one. On the unchanged panel the repeats send two more, because the single-flight rule only covers a request still out. Two separate presses after it settles send two (the control).
- **The hover line is checked with a result and without one.** Absent before any search and after "No results.", present with a picture, whose Save scrim is at opacity 0 until the tile is hovered and 1 after, so the sentence is true of the screen (the `img` itself cannot be hovered: the scrim covers it).
- **The cut copy is pinned where it is drawn.** audio.spec.ts "T-169 (iii)" reads the hint, drags a cut, puts it back through its chip and reads the hint again. The existing hint pin and the everything-cut sentence moved in place; interactionWiring.test.ts asserts the five places and the absence of "Click a mark" in the hint and the tour; the Layer 5 sentence in media.spec.ts was run alone.

## Round 119 Track A (T-170 items 2 and 3): what the new cases hold

- **Three jobs are held in main, then moved from video to video.** video-pipelines.spec.ts "T-170 Track A" (2) replaces `captions:transcribe`, `captions:burnIn` and `video:reframe` with handlers that count their calls and answer when the test says (T-168 (4)'s approach), runs each job on a copy of the fixture named `...-a.mp4`, closes that video and drops `...-b.mp4`: the line "Transcription of t170tx-a.mp4, started on another video." (or "Caption burn-in on ...", or "Reframe of Clip 1 from ...") must be on screen with the sentence as its title, must be above the progress bar (for the transcription main sends a `captions:progress` event so a phase row exists; for the Reframe the row is the run's own), must not be on screen on the first video (the control; a line that is always drawn, or never drawn, fails one half), and must go when the held job is released. The burn-in case first transcribes with a handler that answers at once with a transcript path, so Burn into video is there to press; the save dialog is the suite's `stubDialogs`.
- **The stale cached answer is made by installing the stub before the studio mounts.** "T-170 Track A" (3) stubs `captions:status` on Home, so the panel's first (cached) answer is READY, then flips the stub to NOT ready and presses Transcribe once: the setup instructions open, the status stub was asked exactly once (a press that trusts the cache asks zero times) and main's transcribe was never called. The second case keeps READY and holds the transcribe: one ask per press, one job. The T-169 (1) cases (the files placed after mount) keep the other direction.
- **The refusal is a unit case with `paths` stubbed.** transcribeMissing.test.ts mocks `electron` and `./paths` as transcribeClean.test.ts does, with the model and the engine toggled absent, calls the real `runTranscribe` and passes the rejection through `userFacingError`; it asserts the finished sentence for each missing combination and that the run is not left claimed. Without the stub the real `paths` throws on the missing Electron `app` and the call rejects with a TypeError, which `userFacingError` also reduces to "Transcription failed." - so a test that does not stub it is green or red for no reason it names.
- **The wiring pins are structural and cheap.** interactionWiring.test.ts "T-170 Track A" reads the two `begin` payloads, the two lines' conditions and sentences, and that `transcribe()` holds no `status?.ready`; the e2e cases are the behaviour. The T-135 pin on `useCaptionsRun`'s type, `runs.test.ts`, `useVideoProgressFeeds.test.ts` and `VideoJobsRunning.test.tsx` moved in place for the two new fields.

## Round 119 Track B (T-170 items 1 and 4): what the new cases hold

- **The meter is judged on a sound that is still playing when it is replaced.** audio.spec.ts "T-170 (1)" opens a 30 s tone at -0.33 dBFS in Audio Studio, goes to Video Studio, drops a clip, holds every ffmpeg for 8 s (`installSpawnStall` with no `nth`: the extraction, then the new sound's peaks) and presses Clean audio, then returns to Audio Studio and plays the tone until the label reads "0 dB" with bars raised. The extraction lands over it; while "Drawing the waveform" is on screen the label must read "-60 dB" and all twelve bars must be at the 2% floor (a bar with no level is drawn at 2%, not 0), still so 600 ms later. Splitting the two resets matters: the label fails when only the bars reset, the bar heights fail when only the dB resets.
- **The hint is judged with two boards and the older one selected.** references.spec.ts "T-170 (4)" seeds "Layouts" newer than "Colors", so the store's default selection is "Layouts"; picking "Colors" on Mood Boards makes the line name "Colors" (text, `title`, truncated class), a Save lands there (toast and the file on disk), and picking "Layouts" moves the line. A hint written from the first board fails at the first assertion. The no-board control reads the new-board sentence and the first Save's name dialog. The T-169 hover-hint case moved in place to the same sentence.
