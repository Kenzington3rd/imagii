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
- **Status:** open

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
- **Status:** open

## T-03 — E2E: import a file and export it through the real UI

- **Spec:** `docs/TESTING.md` Layer 2 is navigate-and-screenshot only.
  One import→export pass through the built app would have caught both
  the PiP validator bug and the protocol round-trip bug on day one.
- **Acceptance criteria:**
  - [ ] Playwright test: launch built app, load a small generated mp4
        into Video Studio (drag-drop path or seeded recent-file), run
        an export, assert the output file exists and ffprobe accepts it.
  - [ ] Runs headless under xvfb in `npm run test:e2e:build`.
- **Status:** open

## T-04 — Real-media coverage for highlight clip cutting

- **Spec:** `src/main/ffmpeg/highlights.ts` is unit-tested for scoring
  but the seek/cut boundary behavior has never run against ffmpeg.
- **Acceptance criteria:**
  - [ ] Layer 5 test cuts a clip at a known timestamp from a generated
        source and asserts output duration and start-content (not just
        exit 0).
  - [ ] `npm run test:media` green.
- **Status:** open

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
- **Status:** open

## T-06 — Protocol handler trust-boundary test

- **Spec:** `src/main/protocol.ts` uses tested `pathSafety` helpers,
  but nothing proves the handler actually wires them in — a traversal
  regression would be invisible.
- **Acceptance criteria:**
  - [ ] Unit test (or E2E fetch) proving a traversal-shaped
        `imagii-file://` request is refused and a legitimate one
        resolves. The existing E2E protocol assertions may be extended
        instead of a new file — expediter's call.
- **Status:** open

## T-07 — ProjectIO + autosave data-loss tests

- **Spec:** `ProjectIO.ts` and `useAutosave.ts` are untested; autosave
  already produced one logged bug (round 18). Data loss is the failure
  imagii can least afford.
- **Acceptance criteria:**
  - [ ] Save→load round-trip test at the store level: a project with
        content in all studios survives serialize→validate→restore.
  - [ ] Corrupted-autosave path: a truncated/garbage autosave file is
        refused without crashing and without clobbering good state.
- **Status:** open

---

## Done

(none yet — entries move here with commit hash and expediter sign-off)
