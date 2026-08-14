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
- **Status:** open

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
- **Status:** open

## T-10 — analyzeClipHook always reports the -70 LUFS floor

- **Spec:** same root class as T-09: `metadata=1` demotes framelog to
  debug, so the hook indicator scores every clip identically at -70.
  With `framelog=info` the same windows read -21.8 vs -55.7 LUFS.
- **Acceptance criteria:**
  - [ ] Loud and quiet windows produce distinct, plausible LUFS.
  - [ ] Flip the `KNOWN BUG` pin into a positive discrimination test.
  - [ ] LESSONS_LEARNED entry (may share T-09's).
- **Status:** open

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
- **Status:** open

## T-12 — reframe output carries non-square SAR (cosmetic)

- **Spec:** T-01 observation, unpinned: `runReframe` output has SAR
  404:405 (DAR 101:180 instead of 9:16) — `scale` preserves source DAR;
  nothing sets `setsar=1` after the crop. Sub-1% geometry error.
- **Acceptance criteria:**
  - [ ] `setsar=1` (or equivalent) in the reframe graph; Layer 5 asserts
        SAR 1:1 on reframe output.
- **Status:** open (low priority)

---

## Done

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
