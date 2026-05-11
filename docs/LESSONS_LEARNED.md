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
