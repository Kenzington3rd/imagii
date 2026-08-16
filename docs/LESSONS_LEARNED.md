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
  name / preset id keep `assertNonEmptyString` since they're not paths.
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
  and Meta extended Reels to 3 minutes the same year.
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
- **Fix.** `assertDefined` now throws in both dev and prod. Prod path still logs `console.warn` for telemetry, but then falls through to the same `throw new AssertionError(...)`. The post-condition matches the type signature: if you got a value back, it's defined.
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
