# imagii — Testing Guide

imagii ships five complementary test layers. Each catches a different
class of regression; together they make a clean `npm run verify`
followed by `npm run test:e2e:build` and `npm run test:media` enough
confidence to tag a release.

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

**Count.** 1735 tests across 84 files (round 54 added four files —
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
cancellable runners (video export, GIF, compile, PiP, reframe, highlight
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
Fresh-run time on a
mid-range laptop: ~7 seconds. (The count moves most rounds; treat the
`npm run verify` output as the source of truth and this line as the
last-updated marker.)

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

**What it deliberately doesn't cover.** Media processing flows. Spawning
ffmpeg on a CI runner is slow and flaky; the unit layer covers the
pure parts and the cancel contract. The smoke verifies "did the app
get built correctly and reach every studio" — not "did a 90-minute
reframe finish".

**Why not in `npm run verify`.** E2E requires the `out/` build
artifact. `verify` is the fast pre-commit pass (~10 seconds total);
the E2E layer lives behind `npm run test:e2e:build` for release smoke
(~30 seconds for build + 6 seconds for the spec).

**Adding an E2E case.** Drop `*.spec.ts` into `tests/e2e/`. Keep the
launch hermetic (`os.tmpdir()` userDataDir + cleanup in a `finally`)
so concurrent runs don't collide.

**Two shared helpers, and the rule for each** (the specs are not
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

## Layer 2.5: real-media integration (`tests/integration/media.spec.ts`)

**Run with:** `npm run test:media` (~90 seconds).

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

**What it covers.** Source files under `src/renderer`, `src/main`, and
`src/shared` are scanned for emoji + pictograph glyphs. Two
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
