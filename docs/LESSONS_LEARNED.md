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
