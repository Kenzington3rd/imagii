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
  they share. Two rules for this style: it cannot see conditional
  rendering, so a green run means "reachable", not "on screen"; and it
  reads source text, so **always run it against the broken state first**
  — `tutorialTargets` initially passed with both missing attributes
  deleted, because the tutorial definition files contain the selector
  strings and are reachable from every studio.

**Count.** 883 tests across 58 files (round 34). Fresh-run time on a
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

---

## Layer 2.5: real-media integration (`tests/integration/media.spec.ts`)

**Run with:** `npm run test:media` (~30-60 seconds).

**Environment.** node + the real bundled ffmpeg/ffprobe binaries. No
Electron, no DOM. Configured by `vitest.integration.config.ts` so it
stays out of the fast `verify` pass.

**What it covers.** The layer every other layer stops short of: it
drives the actual production job runners (`runExportJob`,
`runAudioExport`, `runGifExport`, `runAudioMux`) against tiny generated
sources and asserts on the bytes that come out — dimensions, codecs,
faststart atom order, two-pass loudnorm accuracy (±1 LU), sidechain
ducking depth (measured through a bandpass isolate), cut-region
durations, and subtitle-path escaping against ffmpeg's real filtergraph
parser.

**Why it exists.** Round 18 proved the gap: three shipped features
(autoZoom, sidechain ducking, parametric denoise) had filter strings
that passed every string-shape unit test and were rejected by ffmpeg at
runtime, 100% of the time. A unit test can pin what we *think* the
filter should say; only real ffmpeg can pin that it *parses and runs*.

**Adding a case.** Generate sources in `beforeAll` with lavfi
(`testsrc2`, `sine`, `anoisesrc`), drive the real exported function, and
assert with `ffprobeJson`/`measureLufs`/`bandMeanVolume` helpers already
in the spec.

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
