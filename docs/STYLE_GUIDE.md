# imagii — Style Guide

Code-level conventions for the imagii renderer and shared code. The
**visual** system is in `DESIGN_GUIDE.md`; this document is about how
the code is written. The `design-reviewer` agent enforces it.

---

## The no-emoji rule

**No emoji in the UI.** Emoji pictographs render differently on every OS
and every OS version — a 🎬 is not the same glyph on Windows 10,
Windows 11, and macOS, and some render in color, some in monochrome.
That inconsistency is unacceptable for a polished product.

Replace every emoji with the `Icon` component:

```tsx
// Wrong
<button>💾 Save project</button>
const LABELS = { overlay: '🎮 Overlays' }
toast('Done', { icon: '🗑' })

// Right
<button className="inline-flex items-center gap-1.5">
  <Icon name="save" size={15} /> Save project
</button>
const LABELS = { overlay: 'Overlays' }            // icon rendered separately
toast('Done', { icon: <Icon name="trash" size={18} /> })
```

**Allowed:** geometric typographic glyphs that render identically
everywhere — `✕` (close), `·` (separator), `–`/`—` (dashes), `→`/`←`
inside body copy. These are punctuation, not emoji. For *new* close
controls prefer `<Icon name="close" />`; existing `✕` buttons are fine.

**Enforcement:** a `PostToolUse` hook on `Edit|Write|MultiEdit` (see
`.claude/settings.json`) runs `scripts/check-emoji.mjs` over `src/` on every
edit, and `npm run verify` runs it again. CI-style: if it fires, the emoji must
be removed before the change is considered done. The script scans every
directory of `src/` (renderer, main, shared and preload; T-122 added the last)
and every type of file in them (`.ts`, `.tsx`, `.html` and `.css`; T-123 added
the last two, after an emoji in `src/renderer/index.html` passed silently), and
`tests/unit/emojiGuard.test.ts` fails when a directory of `src/` is not listed,
or when a file of a type the script does not read appears under `src/`. What it
does not read is everything outside `src/` (the docs, the scripts, the tests, the
README): the rule is for the shipped product, and those are not it.

---

## The Icon system

One icon set: `components/Icon.tsx`. Inline SVG, 24×24 viewBox, 2px
strokes, `currentColor`.

- Add an icon by adding a key to the `IconName` union and a path to
  `ICON_PATHS`. TypeScript's `Record<IconName, JSX.Element>` guarantees
  every name has a path.
- Never inline a one-off `<svg>` in a component. Never use an `<img>`
  for an icon. Never use a glyph character where an `Icon` fits.
- Decorative by default (`aria-hidden`); pass `title` for a meaningful,
  labeled icon.

---

## Shared affordances

Repeated UI is a component, not copy-paste:

- **`HomeLink`** — the "back to Home" link in every studio header.
- **`OutputDirLabel`** — the folder-icon + basename chip in export
  panels. Its `basename()` helper is pure and unit-tested. The chip draws an icon
  and a folder's name, so the button's accessible name used to be just "Videos"; a
  screen-reader-only "Output folder: " prefix inside the component makes it
  "Output folder: Videos" in all five panels at once (T-123). T-125 (11): the chip is capped
  (`max-w-[9rem]` with `w-full`: never past 9 rem, and never past the button it sits in when the button has to give), the name is a `min-w-0 truncate` span and the whole path is the `title`, so a long
  remembered folder cannot push a card's primary button out of the card.
- **`AppToaster`** — the app-wide toast surface. Its cards are **click-through**
  (`TOAST_STYLE.pointerEvents: 'none'`, T-92): react-hot-toast draws each card with
  `pointer-events: auto`, so a toast over the Export button swallowed the click for its
  whole life (react-hot-toast 2.6.0's defaults are 2 s for a success toast and 4 s for a
  plain or an error one, and `AppToaster` sets none; 8 s for an action toast) and, because
  the library pauses a hovered toast, indefinitely while the pointer rested on it. A button inside a toast
  opts back in with `pointer-events-auto` (`lib/savedToast.tsx` does). T-133 (2): the card's `overflowWrap` is `anywhere`:
  react-hot-toast sets the message `white-space: pre-line` in a 350 px card with no overflow-wrap, so a file name with no break
  opportunity (an underscores-only name, a hash; the `Saved ${basename}` sites, "Extracted the sound from", "Added ${name}")
  ran OUT of the card in a real render, by as much as the name was long (81 px for one name, 228 px for a 90-underscore one); `anywhere` (not `break-word`) also lowers the min-content width, so the
  flex row shrinks the message instead of widening the card (`AppToaster.test.tsx` pins the style; image.spec.ts measures the
  rects). Mounted exactly once, in
  `App.tsx` beside `HotkeyOverlay`, so every route has it. Never mount a
  second one in a studio: react-hot-toast keeps one toast store per
  toaster id and each `<Toaster>` draws all of it, so two mounts render
  every toast twice (T-31).
- **`reportFailure(err, { failed, canceled?, id? })`** (`lib/reportFailure.ts`,
  over `userFacingError` in `@shared/userFacingError`) — what EVERY `catch`
  around a `window.api.*` call does (T-84). Electron wraps anything an
  `ipcMain.handle` handler throws in
  `Error invoking remote method '<channel>': Error: …`, and the runners'
  own messages are ffmpeg's ("FFmpeg exit 1: …"), so
  `toast.error(err.message)` showed the user a channel name, the word
  "remote" for work that never left their machine, and an encoder's stderr
  (T-30, T-59, T-84). The helper strips the envelope, maps known shapes (an
  encoder exit, a missing or locked file, a full disk, no network, a refused
  capture device) to the caller's `failed` sentence plus one plain cause,
  lets a finished sentence main wrote stand alone, and otherwise shows just
  `failed`; **the raw error always goes to the console**. `failed` is a full
  sentence with its period ("GIF export failed."). A failure raises
  `toast.error` for 8 s. `id` (T-132 (13)) is the toast's id: a failure that can repeat within one press (the four settings
  writes of an Export) passes ONE fixed id, so the later cards replace the first instead of stacking. **Never write `toast.error(err.message)`, or read
  `.message` in a `catch` outside a `console` call** —
  `tests/unit/failurePathLanguage.test.ts` parses the renderer and fails on
  it, and lists every site that must route through the helper. **A write main can refuse is awaited in a `try`, and what the person
  typed stays until it landed (T-135 (8)):** the mood-board create / rename / delete / save and the custom-preset save / delete were bare
  awaits, so a refusal looked like success and a dialog that closed first dropped the picture it held. Each reports one sentence ("Couldn't
  create that board.") and keeps its dialog and its text; the first-save dialog closes after the board EXISTS, and a name box carries the
  number main enforces (`MAX_BOARD_NAME`, one copy in `shared/search.ts`) as its `maxLength`.
- **`persistSetting(key, value)`** (`lib/persistSetting.ts`, T-128 (4)) - how a screen remembers a preference without letting the remembering
  break what the person pressed. `window.api.settings.set` is an IPC round trip main can refuse (a full disk, a config it cannot
  replace); written bare in a handler it ended the handler (the Welcome screen's "Let's go" stayed put; Export, which saved the
  watermark before it built its queue, did nothing) or was an unhandled rejection. The helper never rejects: a refusal is one
  `reportFailure` sentence, "Couldn't save your settings.", and the raw error goes to the console. `void` it when nothing depends on the
  write; `await` it where the order matters (the recent-files list); a write the NEXT line depends on (the posting diary's migration deletes the
  old copy once the new one is stored) stays an `await` in a `try` with a `catch`. `failurePathLanguage.test.ts` fails on any other
  `window.api.settings.set` that is neither awaited inside a `try` with a `catch` nor `.catch`ed (a `void` call inside a `try` is not caught by
  it: the rejection arrives after the `try` is over). The pickers, cancels and reads that are also awaited bare are not this rule's.
  T-132 (13): the refusal's toast has ONE fixed id (`SETTINGS_FAILED_TOAST_ID`, passed through `reportFailure`'s optional `id`), because Export
  makes up to four of these writes in one press and a refusal of the settings file refuses all of them: with no id react-hot-toast 2.6.0
  stacks four identical red cards, and with one the later calls replace the live card.
- **Cancel is a fact, not a string.** Pressing Cancel SIGKILLs the child,
  which exits non-zero exactly like a crash. Main marks the kill —
  `killAsCancelled(child)` in a runner's cancel function,
  `cancelledOr(child, failure)` in its close handler
  (`src/main/ffmpeg/cancelMark.ts`) — and the rejection carries the one
  sentinel `CANCELLED_MESSAGE` (`@shared/cancel`; `ConvertCancelledError`
  is a subclass). `userFacingError` reports it as `cancelled: true` and
  `reportFailure` raises a plain `toast(canceled)` in the feature's own
  words — never `toast.error`, never in ffmpeg's. **The renderer never
  string-matches ffmpeg text to detect a cancel.** A new cancelable runner
  needs both halves and a row in
  `src/main/ffmpeg/cancelSentinel.test.ts`. Rows that stopped (the export
  queue, the audio export row) keep saying "Failed" or "Canceled" after the
  toast fades — and only a failure is red: a Canceled row's bar is `ink-muted`,
  because red says "something broke" and the user's own Cancel is not that
  (T-100).
- **Cancel is a latch, not a call that has to land on a live child (T-98).** A
  runner registers its child at the spawn, and nearly every one waits first — a
  platform export, a compilation, a cropped GIF, a reframe and the highlight scan
  probe the source; the next job of a batch begins with that probe; a frame
  extract makes its folder; a ranged burn-in reads its SRT — so a Cancel that
  arrived in the wait found nothing to kill, returned false, and the job started
  anyway. Every runner opens a run for as long as it works
  (`CancelLatch.begin(jobId)`, `src/main/ffmpeg/cancelLatch.ts`); its cancel
  functions mark the open runs they are aimed at (by name, or all of them) as well
  as killing children; the runner calls `run.check()` just before it spawns and
  wraps a pre-spawn await in `run.guard(work)`, which a cancel ends AT ONCE (a
  probe of a file on a slow share must not hold "Exporting…" for its whole
  length). Both throw the T-84 sentinel, so `reportFailure` needs no new case.
  A run ends in the runner's `finally`, so a stale Cancel — pressed with nothing
  running, or aimed at a job that is over — cannot reach the next job: a cancel
  marks the runs open when it arrives and nothing else. `video:exportBatch` holds
  a run of its own, asks it before every job, and is single-flight: a second batch while one runs is refused in a
  sentence (T-111; the Export panel and Clip Kit both start batches). What main cannot latch is what
  the renderer sequences in several calls (Clip Kit: folder, batch, three
  thumbnails, SRT) — between two of them nothing is running — so that
  orchestration keeps a flag the Cancel sets and every step asks (`stopIfCanceled`
  in `ClipKitButton`). A new cancelable runner needs a run, a `check` before its
  spawn, a `guard` around each await before it (the probe, and — T-106 —
  `nextFreePath`'s choosing of the output's name), and a row in the pre-spawn table
  in `cancelSentinel.test.ts`. T-128 (5): the convert (`beginConvertRun` for the recording's save, held from the chosen
  output name until the temp take is dealt with; `convertForImport` for its own) and the extraction (`extractAudioFromVideo`, until the scratch
  WAV is gone) are runs too, so `before-quit`'s wait covers their cleanup; the two whose only pre-spawn wait is a folder's creation
  are held by `convertQuit.test.ts` and `extract.test.ts` ("a cancel that lands while the folder is made spawns nothing") and not by the
  table. **A quit is not a Discard**: `ConvertCancelledError.byQuit` (set by `cancelAllConverts`) tells the save's cleanup which it is.
  Both remove the half-written output; only a Discard removes the raw take (`userData/recordings/<id>.webm`, the only copy), and the
  quit's sweep (`abandonAllRecordingStreams`) leaves a CLOSED session (mid-finalize) to the handler that owns it, as the reload's does
  (T-124 (3)): what the sweep owns is a take still being recorded.
- **A job that stops removes the file it was writing (T-100).** ffmpeg opens its
  output when it starts and writes the index (an MP4's moov atom, a GIF's trailer)
  when it ends, so a killed run leaves a file with a real name that nothing plays,
  in the folder whose toast says "Files already finished are in your folder". The
  runner calls `discardPartialOutput(outputPath, spawnedAt)`
  (`ffmpeg/partialOutput.ts`) from its failure path, after the child has exited.
  It removes the path only if the child was actually spawned AND the file is not
  older than the spawn: ffmpeg truncates its output when it OPENS it, which for a
  slow input is well after the spawn, and a Cancel before that leaves last week's
  export of the same name exactly as it was. Earlier jobs' files are never
  touched — each job knows only its own path. T-128 (5): the import transcode (`convertForImport`) removes its partial the same way on
  any failure or cancel.
- **A progress number is a measurement, or it is absent (T-89).** A progress
  event carries `percent` only when main KNOWS how far along the work is — a
  download's byte count, `done` = 100, the burn-in's encode position over the
  length of the file it writes (`burnInPercent`, T-111: starts at 0, tops out at
  99, and is absent when the length is not known) and the MP4 convert's (T-115: the same
  mapping, `convertToMp4(…, durationSec)` — the recording's own length, which
  `promoteTempWebm` hands down from `spec.durationMs`; with no length the progress event
  carries NO `percent`, and Record's bar draws the sliding segment). It used to be
  `encoded seconds x 2` under a comment that said 1% per second, which put a 5-minute
  take at 99% from 50 seconds in, beside an enabled Discard. A phase of unknown
  length (extracting audio, running the speech engine, writing the SRT) sends
  the phase with NO `percent`, and the renderer draws an indeterminate bar:
  `role="progressbar"` with no `aria-valuenow`, and the `.progress-indeterminate`
  segment from `styles/index.css` (a third of the track sliding across; under
  Reduce motion it is a static third, never a full bar). Never invent a number to
  make a bar move — the captions panel used to show `15 + Math.random() * 10`.
  Phase ids are never shown: a pure `captionPhaseLabel`-style table gives each a
  plain label ("Transcribing…", not "TRANSCRIBING") — Reframe's is
  `reframePhaseLabel` (`@shared/reframe`), keyed by the phase union so a phase added
  in main without a label fails the typecheck. A row that shows a job it no longer
  has is the same lie from the other side: when a canceled or failed job's
  `catch` runs, the progress row goes back to idle (the Captions panel clears its
  `progress`; the toast says what happened). And a job made of passes that each
  report 0-100% (the audio export: measure, then render, then — re-attaching to a
  video — mux) names its place in them, "Step 2 of 2 — rendering"
  (`audioPassLabel` / `audioPassPlan`, `@shared/audio`), so the bar restarting at
  0 reads as the next step and not as a stall.
- **Every long caption job has a Cancel in every phase that can be stopped (T-108).** Transcription is two
  children — the audio extraction, then the speech engine — and it is the extraction that fills most of a long
  recording's wait. Both register in `activeTranscribe`, the run holds a `CancelLatch` (`transcribeLatch`, the
  burn-in's pattern), and the panel's Cancel shows in the `extracting` and `transcribing` phases (not `building-srt`,
  which is instant) and calls `captions.cancelTranscribe`. A new long job answers, per phase: what does the button do
  here, and is there a phase with no button? `extractAudioFromVideo(path, onChild, format)` hands the caller its child and
  removes the WAV it was writing when it fails or is killed. Every extraction child is also in a module registry, from
  its spawn to its close (`cancelAllExtractions`, extract.ts), which the quit sweep and `cancelAllAudioJobs` call
  (T-111) — Audio Studio's own import of a recording's sound had no handle at all — and `format` is Audio Studio's
  48 kHz stereo by default, `TRANSCRIPTION_AUDIO` (16 kHz mono, `@shared/captions`) for the speech engine, whose
  scratch WAV is a sixth the size.
- **A result belongs to what the job was started on (T-112).** Nothing locks the app while a long job runs, so a
  result can arrive after the person has moved on. A transcription started on video A and finished after video B
  was opened used to attach A's captions to B: the panel captures the source path when the job starts and applies
  the result through `videoStore.setSrtPathFor(startedFor, srtPath)`, which stores nothing (and says so) unless
  that file is still the open one; the panel then toasts that the captions were not added instead of showing a
  transcript for the wrong picture. Opening a project is the same shape with a longer wait: `applyProject` holds
  what each studio held before the re-convert / re-extract and skips the project's source if the person opened a
  different one meanwhile (`replacedSince`: a studio CLOSED meanwhile is not "something else"), reporting it in
  `ApplyOutcome.skipped`. Both outcomes of a project open that are not "it opened" — a file that is gone
  (`unavailable`, said only when `isMissingFileError` is true), a file that would not open for any other reason
  (`failed`, the `userFacingError` sentence for the real cause), a source skipped — are one string from
  `describeApplyOutcome`, which Home's Open project and the autosave Restore both toast. A new long job asks: what
  is it for, and is that still what is open when it ends? T-125 (20): Video Studio's **Clean audio** is the same
  shape: it holds Audio Studio's source before the extraction, compares it with `replacedSince` when the extraction ends,
  and if the person opened something else meanwhile loads nothing, navigates nowhere and says what it skipped (the ask
  that comes BEFORE the await used to navigate and replace regardless). T-133 (6): `replacedSince` sees a different FILE; work tuned on the
  file already open during the wait was replaced silently (loading resets the chain and the undo history), so the flow keeps the chain
  the first question was about (`chainAsked`) and, when the extraction ends, `confirmReplaceAfterWait` (`audio-studio/audioClose.ts`) asks
  again if the chain is no longer that object (every edit makes a new one): work the person already agreed to lose is not asked about
  twice, and a decline takes the "Skipped this video's sound..." path with its own reason.
- **A start that takes time is single-flight: the flag is claimed before the first `await` and given back in a `finally`
  (T-112, T-119).** `RecordStudio.startRecording` (`startingRef`; the button reads **Starting…** and is disabled),
  `AudioImporter.loadFile` (`busyRef` and `refuseIfBusy`, the video Importer's rule), `ExportPanel.startExport`
  (T-125 (18): `startingRef`, claimed before the settings writes it awaits, because a fast double-click used to start two
  queue displays while main's gate stopped only the second encode) and main's Export gate are one
  shape. State alone is not the guard - a second press in the same breath reads it before the first render - so a
  `useRef` is set the instant the function runs, ahead of every `await` (and ahead of the checks that might refuse),
  and a `finally` puts it back whether the start worked, was refused or threw: a flag released only on success leaves a
  refused start unretryable, and one claimed after the first `await` leaves the window open. A refusal says why in a
  sentence ("Still extracting audio from the last file. Wait for it to finish."), and a drop is refused BEFORE the
  cloud-sync warning, so a person is not told two things that disagree. `interactionWiring.test.ts` reads every start
  handler that follows this claim-first pattern with a syntax-tree finder (`singleFlight`) that fails on a late claim or a
  release outside a `finally`, with a discrimination block over sample code. Its block is the list of handlers (the guide
  keeps no count, so a new one is added there and nowhere else). **A picker is not exempt because its first await is a native dialog
  (T-131 (5)):** the dialog does not protect itself - the second press of a double-click lands in the few milliseconds before the OS
  draws it, and executed in the built app it opened two choosers from every unguarded picker (the Importers' "Choose file…", the
  second-track role buttons, Picture-in-picture's file buttons, the folder chips, Home's Open project and Save project). The shape is
  one call, `claimFirst(flag, work)` (`lib/claimFirst.ts`): a `useRef(false)` in a component, a module-level `{ current: false }` for a
  handler that is not one, raised before `work` awaits anything, lowered in a `finally`, and a second call answers `undefined`.
  `interactionWiring.test.ts` finds EVERY renderer call of a bridge function that opens a native chooser (`video.pickFile`,
  `audio.pickFile`, `video.pickOutputDir`, `project.save`, `project.load`) and holds the set to a decided table, so a new picker fails
  until it is decided; each entry point has a delayed-chooser (300 ms) `dblclick` E2E. **A guard goes in the function every entry
  point calls, not in one of them (T-133 (8)):** Reference Search's button was `disabled={loading}` and its input's Enter was not, so a
  second Enter (or a held one) sent a second request and the LAST answer owned the grid. `referencesStore.search` reads
  `get().searchLoading` and returns for the query that is already out, so the button, Enter and any future shortcut share one rule; a
  render's closure would not do (two presses in one breath see the same render). **A guard that refuses must not refuse a different
  question (T-134 (3)):** T-133 (8) refused EVERY press while a request was out, which threw away a corrected query (type, Enter, spot the
  typo, fix it, Enter) and left the typo's answer on a grid no query on the page named. A different query goes out at once; each request
  takes a number, and only the newest request's answer, failure and idle state are drawn (an older one is dropped, still logged), so a slow
  typo can neither fill the grid nor clear the busy button of the search that replaced it. **The button follows the same rule, and the box is
  the grid's name (T-135 (5)):** `disabled={loading}` made the correction Enter-only, so a pointer or voice-control user could not send it. The
  store holds the newest request's query (`searchQuery`, in flight or answered); the button is off only when `loading` and the typed text
  equals it (the store's own refusal still backstops a double-click), and the panel's input starts as that query, so a trip to another tab
  and back never draws the grid over a blank box.
- **Waiting for an event that may already have fired hangs (T-119).** `recording:abandon` waited for the temp file's
  stream to emit `close`. A `WriteStream` that failed a write has auto-destroyed and emitted its one `close` already,
  so the renderer's own failure path (the append rejects, finalize throws, abandon runs) never got an answer, and the
  partial webm outlived the "disk is full" toast; the session was out of `streamSessions` too, so the quit sweep could
  not reap it either. It now waits only while `stream.closed` is false, never past `ABANDON_CLOSE_WAIT_MS`, and unlinks in
  a `finally`. Skipping the wait on `destroyed` alone is wrong: a stream that is destroyed but still closing holds the
  file open, and Windows refuses to unlink an open file (the unit holds that case with a close it delays by 150 ms). A
  one-shot event is asked about before it is awaited, and the wait has a bound.
- **A long job lives in a module store, not in the panel that started it (T-135 (1)).** A busy flag and a job id in a component's
  `useState` / `useRef` die with the route: the panel came back idle, its primary button enabled, over a job main was still running, with
  no Cancel (USER_GUIDE promises one while a render runs) and a retry that hit "An export is already running". The run is a zustand
  store (the videoStore pattern): `createRunStore<T>()` (`lib/runStore.ts`: `run`, `begin` the claim, `patch`, `end`) for the single-run panels
  (`video-studio/store/runs.ts`: GIF, Compile, PiP, Reframe, Scan VOD, Clean audio, Clip Kit, Captions), `useExportQueue` for the Export batch
  (rows that outlive the run, listeners that last exactly one batch, the file names taken from the batch's own results, rows drawn for the
  video they were made from) and `useAudioExport` for the audio export. The job's own closure writes to the store after its panel is gone;
  the panel only reads it, and `begin()` is claimed before the first `await` and given back in a `finally` (the component-level
  `startingRef` still covers the moments before a run, such as an open chooser). The Clip Kit's run records the clip it was STARTED ON (`clipId`
  and `clipName`) and is shown by whoever holds it (T-136 (1)): the clip list draws ONE kit button, for the selected clip - not one per row, which is
  what T-135 premised - so a run shown only on its own clip's button lost its progress and its Cancel behind a disabled idle label the moment another
  clip was selected, and for good when its clip was removed or the video closed. Now the button shows the running kit whichever clip is selected, names the
  clip from the run, and starts nothing; `ClipKitRunning` draws the same Cancel beside the importer once the video is closed. A single slot in main (the
  audio extraction, and since T-136 (2) the conversion `video:convertForImport`) refuses a second start itself, in a sentence that names the file that is
  running. `interactionWiring.test.ts` pins each panel to its store; the stores have
  unit tests; one Playwright case per panel leaves the studio and comes back with the job still running. T-136 (2), (4): the same for the three that
  T-135 did not reach - the Importer's load (`useImportRun`: a trip to Home re-armed it over a conversion main was still running, and its second landing
  replaced the video being edited, so a landing asks `replacedSince` first and says what it skipped), the Player's "Make a preview copy"
  (`usePreviewCopyRun`; the playhead it resumes at is `previewResumeAt` in the video store, set in the same update as `previewUrl`, because the
  Player that hears the new element's metadata is not always the one that asked) and the caption model's download (`useModelInstallRun`, whose
  progress listener lasts exactly the download, and `useCaptionsStatus`, which the finishing download writes: refreshing a panel that is gone left the
  one that came back asking for setup over an installed model). A panel that mounts over a running job opens whatever holds its bar (the setup card).
- **A change to the playhead is not an edit, and a pending change has a ceiling (T-136 (3)).** `useAutosave` subscribed a 5 s debounce to whole stores,
  and the Player writes `currentTime` on every `timeupdate` (about four a second) and the waveform on every `audioprocess`, so while anything played the
  timer never elapsed: clips marked during a long review were not on disk until playback stopped for 5 s, against the guide's "every few seconds". The
  video subscription skips a change to nothing but `currentTime`, `transport` and `seekRequest` (`VIDEO_PLAYHEAD_KEYS`), the audio one a change to
  `currentTime` (`playheadOnlyChange`, comparing the store's state with its previous one); the playhead is saved with the next real change and by the quit
  flush. And the debounce is `createSaveScheduler`: a burst is one write 5 s after its last change, but never later than 30 s
  (`AUTOSAVE_MAX_WAIT_MS`) after its first, so the next field that changes faster than the debounce cannot starve the save again. Ceiling: a write the
  min-interval rule defers starts a fresh window. The effect is `startAutosave` (the hook is two lines around it), so a unit test can drive the real
  stores on a fake clock; a field added to either store that changes with the playhead is added to the key list.
- **A result belongs to the video it was made for (T-135 (4)).** A scan's candidates, the pasted chat logs, the spikes found in them and the
  transcript preview were panels' `useState`, so every visit to Home emptied them. They are `derived` in the video store: applied with
  `setDerivedFor(sourcePath, patch)` (a result that arrives after the video was replaced is dropped, the `setSrtPathFor` rule), emptied by
  `loadSource` and `clearSource`, and reset by nothing on mount. A new per-video result goes there, not in a panel.
- **A media element that stays quiet is not a verdict (T-135 (2)).** A ProRes, some H.265 or 10-bit file loads in Chromium's `<video>` with
  `videoWidth` 0, `readyState` 4, no `error` event, and a `play()` that RESOLVES (audio only): the Player listened for nothing and Play flipped to
  Pause over a black rectangle. The Player hears three signals - the `error` event (codes 3 and 4 only: 1 is an abort), a `play()` rejected as
  `NotSupportedError`, and the metadata tell (width 0 for a file whose probe says it has a picture) - and `togglePlay` follows the `play()`
  promise instead of setting the flag first. The note (`PREVIEW_UNAVAILABLE_MESSAGE`) says what still works and does not blame the file; "Make a
  preview copy" runs the importer's own convert and stores the copy as `previewUrl` (NOT in `source`, so exports, projects and the
  `replacedSince` identity keep the original), for the video it was made for.
- **Main reports to a window through `sendIfAlive`, never a bare `.send(` (T-123).** `webContents.send` on a destroyed
  WebContents THROWS, and a job's progress callback runs from a child's stdout handler or a runner's own await with nothing
  above it to catch the throw, so closing the window mid-export raised Electron's blocking "A JavaScript error occurred in
  the main process" dialog (3 of 40 real closes: the WebContents dies 1-106 ms before `before-quit` kills the child, and a
  chunk already read still dispatches). `sendIfAlive(sender, channel, payload)` (`src/main/sendIfAlive.ts`) asks
  `isDestroyed()` and wraps the send in a `try`, and a report for a window that is gone is dropped. Every
  progress site (`video`, `captions`, `audio`, `recording` handlers) goes through it, and
  `tests/unit/progressSendsGuarded.test.ts` is the grep for siblings, kept: it fails on any `.send(` under `src/main` but
  the helper and `quitFlush.ts` (which wraps its own in a `try`). Record's convert holds the WebContents it took while the
  window was certainly alive, because a destroyed `BrowserWindow` throws on `.webContents` itself.
- **A `stderr` accumulator in main keeps a 16 KB tail (T-136 (13)).** A handler that does `stderr += chunk` holds all of an hour-long ffmpeg's log
  for the last few hundred characters a failure message uses (LESSONS_LEARNED, "runBurnIn stderr accumulator was uncapped", round 18: "every other
  spawn caps at 16 KB"). The audio extraction was the one nobody had capped, and T-129 made multi-hour runs of it reachable. The idiom is
  `if (stderr.length > 16384) stderr = stderr.slice(-16384)` inside the `data` handler (or `stderr = (stderr + text).slice(-16384)`), and
  `tests/unit/stderrCapped.test.ts` reads every `<x>.stderr.on('data', handler)` under `src/main` with the syntax tree and fails on a handler that
  accumulates without assigning a tail of at most 16384 to the accumulator. A handler whose stderr IS the product (the ebur128 scans parse every
  line) or that cannot grow (`-version`) is a row in its table of audited exceptions, with the reason, never a silent skip.
- **`recording:begin` takes its slot before its first await (T-123).** The cap on open sessions was read, then `mkdir` and
  the stream's `open` were awaited, then the session was inserted: twelve concurrent begins all read the same size and all
  passed a cap that four sequential ones enforce. `beginsInFlight` is counted in the same synchronous step as the check
  and released in a `finally`, so `streamSessions.size + beginsInFlight` is never short of what the handler has promised.
- **A renderer that dies is reloaded to Home, once (T-123, T-124).** `webContents.on('render-process-gone')` (`index.ts`,
  decided by `rendererGoneAction` in `rendererRecovery.ts`) logs why and loads the entry again, because a dead renderer used to
  leave a window that looked alive and painted nothing, and Home is where the autosave banner lives. T-124 (2): it loads through
  `loadEntry(win)`, the SAME loader `createWindow` uses (the dev server under `electron-vite dev`, the built file otherwise),
  never `webContents.reload()`: `reload()` keeps the URL's hash, so a crash in `#/audio` came back as a fresh Audio Studio with the
  banner nowhere in sight, while the guide said Home. T-124 (3): the dead page's recording sessions are abandoned first
  (`abandonOpenRecordingSessions()` in `ipc/recording.ts`: every session not yet closed, its stream destroyed and its partial
  temp file removed, the body `recording:abandon` has), because the renderer that would have finalized or abandoned them is gone
  and each held a cap slot and a `.webm` for the rest of the launch. A second death inside `CRASH_RELOAD_COOLDOWN_MS` is left
  alone (a renderer that dies while it LOADS would loop forever), and a clean exit or a quitting app is not a crash. T-124 (4):
  the window-geometry write on `resize`/`move` goes through `persistWindowBounds` (`windowBounds.ts`), which never throws: a
  read-only or full `userData` disk used to make every resize event an uncaught main-process exception.
- **The save begins when the take ends, whoever ended it (T-123, T-124).** `finalizeRecording` sets the `saving` phase itself;
  only the Stop button used to, so a take that ended on its own (the captured window closed and every track ended) saved
  under a live "REC" screen with a Stop that did nothing. The call in `stopRecording` stays as the instant answer to a click.
  T-124 (1): nothing HEARD a take end. `MediaRecorder` stops only when all of its tracks have ended, and with the microphone on
  the recorder's stream carries an audio track that outlives the screen, so closing the captured window left a frozen frame under
  a counting REC. `watchScreenEnd` listens for `ended` on the screen's own video track(s), the RAW capture (with the webcam in
  the take the recorder is handed the compositor's canvas capture, which never ends), after the phase is `recording` (an
  already-ended track then sets `saving` last) and comes off in `stopAllStreams` with the rest of the teardown. `track.stop()`
  does not fire `ended`, so the E2E dispatches the event the way the OS does.
- **A queue stops at the job that failed (T-112).** The Export queue is sequential and a failure ends it, so
  `settleJobs(rows, { cancelled, message })` marks the FIRST unfinished row Failed (red, the reason printed on the
  row as text, not only a hover title) and the rows behind it "Not run" (neutral ink); a cancel is the user's act on
  the whole batch and keeps every unfinished row "Canceled" (gray). A row that finished shows the file it wrote.
  Ceiling, in the file: a batch main REFUSES before any job starts (a second batch, a damaged recipe) marks row 1
  Failed with the refusal sentence, because main sends no "job started" event; `video:jobStarted` is the upgrade.
- **A single-job panel's progress row exists only while the job runs (T-108).** Reframe, GIF, Compile — and now the
  Captions panel after a transcription or a burn-in, in the `finally` that already resets `running`. A finished job's
  "Done 100%" row with nothing to press is a row for a job that no longer exists; the toast says it finished. (An export
  QUEUE, and the audio export row, keep their finished rows on purpose: they carry "Failed", "Canceled" and "Show in
  folder".)
- **A badge that asks main while a control is being dragged waits for the control to stop (T-115).**
  The hook badge (`HookIndicator`) asks `video:analyzeClipHook` for the clip's EXACT start and window, once
  neither has changed for `HOOK_DEBOUNCE_MS` (250 ms, `@shared/highlights`): every change cancels the pending ask
  and the late answer (the effect's cleanup), so a drag of the start handle or the speed slider is one ask when it
  settles - not one per mousemove, which killed the running ffmpeg each time (T-113, T-114). A badge's FIRST ask
  is immediate (nothing is moving, and the spawn-order E2Es read the log assuming it is prompt); only a change waits.
  Keying the effect on
  whole seconds instead, as T-114 did, stopped the respawning and left the badge describing a start up to half a
  second away for good. The previous score stays on screen while the next is worked out; a start or window main
  would refuse (`hookAsk` returns `null`) asks for nothing and shows nothing.
- **Nothing is exposed through the preload bridge that no renderer file calls (T-108).** `tests/unit/deadExposures.test.ts`
  holds every function of `ImagiiApi` (`src/shared/api.ts`, the type the preload object is checked against) to "reached
  from some renderer source as `<namespace>.<member>`" — comments, strings and tests do not count. The fix for a failure
  is deletion (the exposure, its type, and the main handler), or a control that calls it, with its own coverage.
- **A text overlay's color and size are normalized where they are stored (T-113).** The overlay gates
  (`isValidTextOverlay`, so Export, Compile, Save project and a project's restore) take `#RRGGBB` and nothing
  else — the color is printed into `drawtext`, so a name like `white,movie=...` is exactly how a crafted project
  injects a filter. That stays. The editor's own default was the NAME `white` and its placeholder invited one,
  so the untouched "+ Add text" overlay failed all four. `videoStore.addTextOverlay` / `updateTextOverlay` run
  `normalizeOverlayPatch` (`@shared/textOverlay`): a CSS color name becomes its hex (a literal table of the 148
  names in `@shared/overlayColors`, no dependency; `#rgb` shorthand expands to `#rrggbb`), a size is clamped to the
  gate's 8-512, a color that is neither is left out of the patch.
  The editor's Color and Size boxes keep what is typed to themselves until typing ends (`DraftField`), so
  "blue" on its way to "blueviolet" is never judged, and an unknown name is refused in a sentence there, not at
  export - a sentence the box points at (`aria-describedby`). The default overlay is `newTextOverlay` (shared, so
  no hex literal in the renderer).
- **A hold on autosave covers the apply and nothing else (T-113).** `applyProjectHeld` (`hooks/useAutosave.ts`)
  holds autosave for exactly `applyProject` and releases in a `finally`; Open project and the autosave Restore both
  go through it. Holding from before the file dialog until 1.5 s after the apply meant a quit during or just after
  a long conversion saved none of what was done meanwhile. While held, the timer and the quit flush
  (`captureForQuit`) save nothing — the stores hold half a project — and a change made during a hold is saved the
  moment the last hold lets go.
- **Every export job carries its clip through `clipForExport` (T-113).** `@shared/clip`: the clip itself with
  its recipe as it PLAYS (`clipRecipe`), so a stored speed of 0 is 1x in a batch, in Clip Kit and in Compile.
  `tests/unit/jobClipNormalized.test.ts` fails on a third queue builder that sends the stored clip.
- **Every file a Clip Kit writes has a suffix after the clip name (T-114).** `kitSrtFilename` /
  `kitThumbFilename` (`clipKit.ts`) and the queue's `<name>_<platform>.mp4`: a clip called Aux, Con,
  COM1 or lpt9 made the bare `Aux.srt` a Windows device name, so the kit wrote five videos and three
  thumbnails and then failed at the path gate. A name that is only ever a prefix is a file name for any clip.
- **A date or time in a file or folder name is the one on the person's clock (T-117).** `localDate()`,
  `localTime()` and `localStamp()` (`@shared/filename`) are the only readers: the export panel's `{date}` and
  `{time}`, the Clip Kit folder (`<name>-kit-<date>`, `makeKitDir`) and Record's default name
  (`recording-<YYYY-MM-DDTHH-MM-SS>`). `toISOString()` is UTC, so an evening streamer west of Greenwich got a
  kit in tomorrow's folder and a take named for the day after it was made. Times use `-`, never `:` (a Windows
  file name). `filename.test.ts` fails on any non-test `toISOString()` under `src`, and the specs that name the
  stamp run on a clock whose day is never UTC's (`tests/e2e/skewedClock.ts`), because a machine in UTC cannot
  tell the two readings apart.
- **An id the renderer hands back that main joins into a path is held to the alphabet nanoid mints (T-117).**
  `isSafeId` / `assertSafeId` (`@shared/pathSafety`; `[A-Za-z0-9_-]`, so no dot, slash, backslash, space or
  newline) at the store AND at the IPC handler, and at the parse of a file that carries an id the list hands
  back (`parseChainPreset`). "They are not paths" is not a reason to skip it: `audio:deletePreset` joined its id
  into `<userData>/audio-presets/<id>.json` and unlinked it, and `../config` reached `unlink` behind a one-line
  rationale in LESSONS that said otherwise. T-128 (6): the alphabet is spelled out ONCE, as the exported `SAFE_ID_RE` in
  `pathSafety.ts`; the custom export presets, the mood boards, `ipc/search.ts`, the recording sessions and the video job ids import it
  (`pathSafety.test.ts` fails on a second `[A-Za-z0-9_-]` anywhere in `src`), and `video:deleteCustomPreset` holds the
  handler-level `assertSafeId` that `audio:deletePreset` has. A new site calls `isSafeId` / `assertSafeId` or imports the constant.
- **"Outside the folder" is a real parent segment, asked in ONE place (T-117).** `isOutsideFolder(root, target)`
  (`main/pathConfine.ts`): `path.relative` is `..`, starts with `..` AND a separator, or is absolute (another
  drive). `rel.startsWith('..')` also refuses a file INSIDE the folder whose own name starts with two dots,
  and transcripts are named from the video (`..intro.mp4` is legal): Save .srt refused the app's own file with a
  sentence that sent the person to transcribe again, and the Clip Kit silently dropped its captions. The two
  caption handlers and the mood-board thumbnail gate call it; `pathConfine.test.ts` fails on a hand-rolled
  `startsWith('..')` anywhere in `src/main`. It lives in main because `shared/pathSafety.ts` is imported by the
  renderer, which cannot take `node:path`.
- **The apply outcome is said for who asked (T-114).** `describeApplyOutcome(outcome, via)` takes
  `'project'` (Open project: a file the person can open again) or `'autosave'` (the Restore: no file stands
  behind it, and opening another video during the wait is the change `applyProjectHeld` saves the moment
  the hold lifts, so the skipped part is gone from the autosave). The skip sentence says which.
- **Clip Kit's captions are the clip's (T-113).** `captions:writeKitSrt` takes the clip's range and speed
  (`buildKitSrtRequest`) and main writes the cues on the clock of the kit's own file
  (`shiftSrtToRange(srt, start, end, speed)`: shifted, cut to the range, then divided by the speed). A clip nobody
  speaks in gets no file. The YouTube slot of a vertical clip is asked about as a YouTube Short with its own
  3-minute limit (`kitLimitTargets`); Reels stays 20 minutes.
- **A project never points into a temp family (T-99, T-107).** A sound pulled out of a video (`imagii-audio`) and a video
  the importer converted (`imagii-import`) are scratch the next launch prunes; the project stores the ORIGINAL plus a
  marker (`audioStudio.extractedFromVideo`, `videoStudio.convertedForImport`, schema 4 and 5) and the work is done again on
  open. `VideoSource.convertedFrom` and `AudioSource.fromVideo.convertedFrom` carry the original in the session, and the
  header and the export names use it (`fileName` is the name of the file the person dropped, never the working copy's).
  A v1-3 audio extraction whose WAV is gone is extracted again from the `fromVideoPath` it carries.
- **A success toast follows a real save (T-91).** Stream Graphics never clicks a
  hidden `<a download>`: that hands the file to the browser and tells the
  renderer nothing, which is how "PNG saved" was raised before the Save dialog
  had answered (and for a Cancel). Saves go through main —
  `window.api.image.save(...)` (one file, a native Save dialog) and
  `window.api.image.saveMany(...)` (a set, ONE folder picker) — which answer only
  after the bytes are on disk, with `null` for a canceled dialog. A caller toasts
  success after a non-null answer, says **nothing** after `null` (the user changed
  their mind: not a success, not an error), and routes a rejection through
  `reportFailure`. The IPC payload is untrusted: `main/imageSave.ts` checks
  magic bytes, size and file names before anything is written.
- **A layer can be a hint (T-91).** `BaseLayer.hint` marks guidance for the
  person editing — a facecam hole, "@yourhandle", a mood-board reference. It
  draws and is saved in the project, and `captureDocument` leaves it out of every
  export by switching off the nodes `Canvas.tsx` names `hint` (the same
  mechanism as the editor `chrome` layers); the Layers panel tags it from the
  shared `hintTag`. Retyping a hint TEXT layer clears the flag — a user's own
  words are not a placeholder. Flag a template layer with `asHint(...)`;
  **text the person MUST replace for the export to be theirs is a hint (T-103)** ("YOUR TITLE HERE", "Your Name",
  "@yourhandle", a schedule line, the countdown's "0:00") — and what they type always exports — while text that IS the
  card's deliverable is not ("BE RIGHT BACK", "STARTING SOON", the emote's "POG"). The question per layer: would a user
  plausibly ship this text verbatim on purpose? `templateTruth.test.ts` holds every template and asset to a per-card table
  of exactly which text layers are which, so a new text layer or card fails until it is decided. Hint text draws at 0.4
  display opacity on the canvas (`displayOpacity`, `@shared/canvas`) so the words look like what they are; the stored
  opacity is untouched and exports are unaffected (`captureDocument` switches hint nodes off). Every card whose text hint
  is a sample says so in its description — "the sample handle does not export until you type your own" — for the
  templates and for the Asset Library alike.
- **A preset is `cleanupSettings(chain)` (T-90).** Audio presets save and apply
  the noise, level and voice settings only; the cut times and the second
  track's file belong to one recording and never enter a preset
  (`@shared/audioPreset`). Both directions go through it, so a preset an older
  build wrote cannot re-impose its cuts.
- **`useVideoOutputDir()`** (`hooks/useVideoOutputDir.ts`, T-124 (21)) — the output folder of the GIF, Compile, Reframe and
  Picture-in-picture panels. Export and the Clip Kit remembered their folder between visits (INIT-E, T-120) and these four asked
  from scratch every time the studio opened. ONE shared key, `video.lastOutputDir` (in `SettingsSchema`, the nested `video`
  schema and `ipc/settings.ts`'s allowlist), because the four write the same kind of thing: the folder is read when the panel
  mounts (its button shows it, as Export's does), again when the action is pressed with nothing chosen in the panel (a folder
  another panel remembered a moment ago is used and no chooser opens), and written after a file landed there. What came off disk
  is used only if `isSafeAbsolutePath`; the chooser opens ON the current folder. A new side panel that writes a file uses the
  hook; it never calls `pickOutputDir` itself. T-131 (13): the chip is disabled while the panel's job runs (the folder is
  not changed for a running job), and the Reframe and Compile primaries keep their idle width (`min-w`) so the busy label cannot shrink
  the button and hand its strip to the chip. T-131 (5): the four chips share ONE chooser claim. T-125 (10): the value is ONE module store (zustand,
  `useOutputDirStore`; the plain functions `seedOutputDir`, `pickOutputDir`, `resolveOutputDir` and `rememberOutputDir` are what
  `useVideoOutputDir.test.ts` drives), so a pick, a chooser's answer or a written file in any of the four updates the other three
  within the visit (each panel used to read the setting once at mount). A stored folder is validated where it is read: main's
  `settings:get` answers a folder key (`export.lastOutputDir`, `clipKit.lastOutputDir`, `video.lastOutputDir`) only if the folder
  exists now (`isExistingFolder`), and `video:pickOutputDir` applies the same test to the default it opens on; the stored value is
  left alone (the drive may come back). A runner never assumes the folder is there: `ensureOutputDir` (`outputPath.ts`) makes it
  (recursive) before the probe and before `nextFreePath`, in the export, GIF, compile (before its first segment), reframe and
  picture-in-picture runners, and a folder that cannot be made is refused in a sentence that NAMES it (`outputFolderRefusal`).
- **`toastSaved(message, outputPath, extra?)`** (`lib/savedToast.tsx`) — a success
  toast that carries the only way on from a finished file (T-92). The GIF,
  picture-in-picture, reframe and compilation panels and Record all raised a
  `toast.success` holding a bare "Show" button, which react-hot-toast removes after
  2 s. The helper gives the toast `ACTION_TOAST_MS` (8 s; T-125 (19): and the two plain toasts that carry a fact the person
  needs, the Fix Wizard's "Cleanup configured. It is applied when you export…" and the mood board's "Added to canvas as a
  reference — it won't be in your export", pass `{ duration: ACTION_TOAST_MS }` themselves) and the button the full
  name "Show in folder"; `extra` adds "Edit in Video Studio", Record's, (T-123) Reframe's and (T-124 (20)) the audio re-attach's (the MUX output
  only: an audio-only export has no video to open), all
  through `useEditInVideoStudio` (`lib/editInVideoStudio.ts`): one hook that asks `videoDiscardMessage`
  ("Replace the video you're editing?") before the load replaces the open video, loads, then navigates, with
  the caller's own sentence for a file that will not open. A second copy of that bridge is a bug. `message`
  is a completion sentence with no trailing period ("Saved the GIF"). A panel never
  builds its own reveal button inside a toast —
  `tests/unit/copyConventions.test.ts` fails on a bare "Show" button and pins the
  panels to the helper. The wording rules (verbs, names, toast punctuation) are
  `BRANDING_GUIDE.md`, "Copy conventions". A runner that numbers its output (`nextFreePath`, T-106) hands the
  panel the path it really wrote, and the GIF, Compile, Reframe and picture-in-picture toasts say it —
  `Saved ${basename(result.outputPath)}` — so "name (2).gif" is never a surprise in the folder (T-112); the Export
  queue's rows show the same basename.
- **A name quoted in a sentence is cut by code point, never by UTF-16 unit (T-133 (3)).** `clipNameForSentence` (`ffmpeg/noPicture.ts`)
  shortens a clip's name to 50 characters with an ellipsis, and `slice` on a string can end between the two halves of a glyph outside the
  BMP (an emoji, a rare CJK character) and leave a lone surrogate before the ellipsis: a broken glyph in the refusal. It cuts
  `Array.from(name)`, and its limit counts glyphs. A new helper that shortens text a person typed does the same.
- **`countOf(n, singular, plural?)`** (`@shared/plural`) — the only way a number and
  its noun meet in copy. "1 clip(s)", "Found 1 candidates" and "5 msgs" were each
  a hand-written plural that read wrong at 1; `copyConventions.test.ts` fails on a
  "(s)" in anything rendered and pins the call at every site that once got it wrong.
- **`ipcErrorMessage(err, fallback)`** (`@shared/ipcError`) — the
  envelope-stripping step `userFacingError` starts with. Still the right
  call for nothing in the renderer any more (T-117): the envelope was all it
  stripped, so a copyfile EPERM (both full paths), an ENOSPC from the write
  stream, a channel-prefixed "recording is empty", Record's source-list
  refusal and the Autosave banner's locked file each reached the toast as
  main's raw string, and only the convert crash had a sentence. Record's save,
  its source list and the autosave clear go through `reportFailure(err,
  { failed })` ("Saving the recording failed.", "Couldn't list what can be
  recorded.", "Couldn't clear the autosave. It's still on disk.") like every
  other catch (the clear can name only a locked file, and only because
  `clearAutosave` ends its message in the errno code of the unlink that failed,
  "could not delete autosave.json (EBUSY)", T-118: no code, no cause, and no
  trailing period, so an unknown shape stays the bare sentence), main's refusal of a take with no data is a finished sentence of
  its own (`RECORDING_EMPTY_MESSAGE`, `recording.ts`), and
  `failurePathLanguage.test.ts` fails on a renderer call to `ipcErrorMessage`.
  What remains is the first step inside `userFacingError` and the classifier in
  `importDiagnostics`, neither of which shows its input.
- **`useUndoRedoHotkeys(undo, redo)`** — the window-level
  Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z binding for a studio's own history
  (`hooks/useUndoRedoHotkeys.ts`). Video, Audio, Image and References all
  call it; its pure `undoRedoIntent` half is what the unit test drives.
  Never hand-roll another copy of the branch.
- **A key handler stands down for the control that OWNS the key, not for every `<input>` (T-68, T-119, T-120, T-123).**
  `lib/keyOwnership` is the one place that answers it: `isTextEntryTarget(tag, type)` (a `<textarea>`, or an `<input>`
  that takes text: text, number, search, email, date...) owns EVERY key, and `controlOwnsKey` gives the other controls the
  one native key each has (a range keeps the arrows, Home and End; a checkbox, a radio and a button keep Space).
  `focusOwnsKey` is both, plus a `<select>` (the letters are its type-ahead). "Any `INPUT`" was wrong in the other direction
  than it looks: a checkbox that has just been ticked, or a slider that has just been moved, STAYS focused, and every
  window-level guard that stood down for it killed Ctrl+Z, `?`, the canvas tool keys, Delete and the Player's keys for as
  long as it was there (the overlay's and the hint lines' own promises). The sets are `NON_TEXT_INPUT_TYPES`, lifted out
  of `videoStore` (which still reads it for `endsGestureOnPointerUp`). Which guard asks which: Stream Graphics' tool keys
  (V R O L P, Delete), the Player's column and the Timeline's Playhead slider ask `focusOwnsKey`; the tool keys also return
  early for `isModalOpen()` (T-68). T-124 (29): all three also return early for `hasChordModifier(e)` (Ctrl, Meta or Alt held;
  Shift is not one, `R` and `r` are one shortcut): a bare-letter shortcut is for the bare letter, and Ctrl+R / Ctrl+O / Ctrl+L /
  Ctrl+P (Alt+Left too) belong to the window or the browser. Stream Graphics computed `ctrl` and only `v` honored it, so four
  chords switched tools; the Timeline and the Player read no modifier at all, so Ctrl+O set an Out point and was swallowed by
  `preventDefault`. A focused select owns the letters, and the Export format and Scale selects are inline
  panels, not Modals, so the modal check never covered them (typing `p` to reach PNG switched the tool, and Delete over one
  removed the selected layer). Ctrl+Z / Ctrl+Y and `?` ask `isTextEntryTarget` alone and NOT for a select, because a select has no
  Ctrl+Z and no `?` of its own and the studio's undo and the overlay should still answer from one
  (`useUndoRedoHotkeys.test.ts`, `HotkeyOverlay.test.ts`). `T-78` (a step per tick of a slider) is a separate, open item.
- **The timeline's keyboard path is the Playhead slider's (T-119, T-120, T-121).** A click on the track hands the keyboard to the
  slider, the one focusable element in the track, not to the Player's column, so `Timeline.onScrubKey` hears every key the
  Player does: Space (the Player's own play / pause, through its transport), the arrows (a 0.1 s nudge), `,` / `.` (one
  frame), and `I` / `O`, which set the in and out points through the same store actions and end the gesture (a
  keypress has no pointer-up to close the undo window, so it is its own step). Home and End (jump to the start and to the end
  of the video) are the slider's own keys, not the Player's: only `Timeline.onScrubKey` has a case for them (T-122). Every key that steps from, or marks, "where the
  playhead is" reads `playheadNow(state)`, the frame on screen, and not the store's `currentTime`: that number is what the
  track DRAWS, and during playback it trails the picture by up to a quarter second (QA measured `.` stepping back 0.151 s and
  the right arrow moving 0.053 s instead of 0.1). The two trim handles are pointer affordances - `tabIndex={-1}`,
  `aria-hidden`, no name - because Enter and Space on them did nothing: an element with only a pointer path does not
  also ask to be tabbed to and announced.
- **When a press swaps the focused control for other content, focus is put on the new content's primary control
  (T-86, T-119).** A removed element takes focus to `<body>`, and the trap only places focus when its dialog OPENS.
  The tutorial coachmark did this first (its Next button); the Fix wizard now puts it on each question's first option
  (Apply on the summary) and Stream Graphics' Variants dialog on **Save all** when the previews replace Generate. It is
  an effect keyed on the swap (`[open, step]`, `[items]`), declared above any early return, and it leaves a reopen
  over content that was already there alone.
- **Smooth scrolling that script asks for reads the Reduce-motion setting itself (T-119).** The `prefers-reduced-motion`
  block in `index.css` sets `scroll-behavior: auto`, which governs scrolling CSS decides but not
  `scrollIntoView({ behavior: 'smooth' })`, an explicit option. The coachmark asks `matchMedia` and passes
  `tutorialScrollBehavior(reduceMotion)` (`'auto'` under Reduce motion); a new call that scrolls smoothly does the same.
- **`useFocusTrap(active, ref)`** (`hooks/useFocusTrap.ts`) — the app's
  ONE focus trap: focus in on arrival, Tab cycling, focus restore on
  close. It also takes the dialog's claim on the window and returns the
  `isTopmost()` predicate the caller's own key handler must consult, so
  one Escape closes one dialog (T-73). `Modal` and the tutorial
  coachmark both call it; a third copy of a trap is a bug. Its pure
  `isTopmostClaim` half is what the unit test drives.
- **`useTutorial(def, ready)`** (`hooks/useTutorial.ts`) — drives a studio's
  coachmark tour (T-86). `ready` is "the studio has content for a tour to
  describe" (a loaded video or audio file, a layer on the canvas): until it
  is true the first-visit tour does not open and its flag is left alone, so
  the first import is what opens it. The result's `def` is the tour cut to
  the steps whose target is on the page — render THAT, never the raw
  definition, and never a coachmark over nothing. **Every way out (Skip,
  Esc, Done) is `stop()`, and `stop()` persists the first-visit flag**: a
  Skip that does not makes the tour come back on every visit. A step names a
  control exactly as the screen does, in 'single quotes', and claims only
  what the code does; `tests/unit/tutorialCopy.test.ts` looks each quoted
  name up in the studio's own source and scans for the words that were once
  wrong. Its pure halves (`resolvableSteps`, `pointsAtSomething`,
  `gateTutorial`) are what `useTutorial.test.ts` drives.
- **`evaluateSuccess(platform, clip, sourceW, sourceH)` and `platformsOverLimit(clip, presets)`**
  (`video-studio/presets.ts`, `clipKit.ts`) — a verdict about an export takes the CLIP and reads the
  frame and the length itself (T-97): the frame through `cropFrameSize` (the crop when there is one, else
  the source — used for the shape AND the "smaller than this output" check), the length through
  `outputDurationSec(clip)` (the range at the clip's speed, since a platform's limit is on the file).
  Never hand a verdict the source's size or the source's seconds; the grid and Clip Kit must not be able
  to disagree about either. The main-process counterpart for the crop is `cropToFrame` (filters.ts, T-96):
  a platform export, a compilation segment and a GIF all build their crop stages through it, so a new
  runner that cuts a clip out of a source calls it rather than writing a `crop=`. The Compile card
  judges each clip the same way: `COMPILE_TARGET` (presets.ts) is the compilation as an export target
  (1920x1080, 16:9, no length to be too long for) and its rows are `SuccessIndicator`s, so what the card
  says about a crop is the grid's sentence (T-105).
- **A clip's recipe is built in ONE place (T-105).** `buildVideoFilter` (filters.ts) makes a clip's picture
  — speed, crop, shake, scale, grade, zoom, overlays — and `buildAudioSpeedFilter` its tempo. A platform
  export calls it with the platform's frame; a compilation segment calls it with the compilation's
  (`buildSegmentFilter`, concat.ts: 1920x1080, 16:9, the source's frame rate up to 60 - `compileFps`, `@shared/compileFps`, T-130 (q)), so a stage added to the export reaches Compile
  with no second edit. What crosses the IPC bridge for a segment is `CompileSegment` (`@shared/clip`): the
  range, the name, and `clipRecipe(clip)` — the fields that decide how a clip looks and sounds, nothing about
  which platforms it is checked for. `clip.test.ts` fails when a field is added to `Clip` and neither carried
  nor listed as not part of the recipe, and `assertOptionalClipRecipe` (`@shared/validators`) checks every
  one of them at the boundary (they all become filter-graph text): `video:exportBatch` (T-111) and `video:concat`
  (T-113) both answer with one plain sentence and keep the detail (the field) for the console. The text itself
  reaches `drawtext` through `escapeDrawtext`, which writes for the THREE passes ffmpeg makes over `text='…'`
  (filtergraph, option list, drawtext's own expansion) — a new filter that takes user text must say which passes
  read it. Fades in a segment are placed on its
  length in the OUTPUT (a 4 s range at 2x is 2 s), after the tempo. T-125 (9): Reframe is the same builder with the 9:16 frame, not a
  subset of it: `buildReframeGraph` (reframe.ts) calls `buildVideoFilter` with the strip as the ONE stage that differs, the optional
  `position` argument (`StripPosition`, filters.ts) swapping the centered aspect crop for the left / center / right strip, and the
  main handler checks the whole recipe with `assertUsableRecipe` as Compile's does, so a grade, text overlay, Auto Zoom or Hype
  Shake set for the clip reaches the 9:16 file. Round 74 sent the speed and the crop only, and the premise that "grade stays out
  matching Compile" was false: Compile passes all four through the same builder.
- **`clipSpeed(clip)`** (`@shared/clip`, T-105) is the only reading of a clip's playback speed: a missing,
  zero, negative or non-finite multiplier is 1x. The export's graph and audio, a segment's, the progress
  bar's length, `outputDurationSec` (the grid's "Too long" and the GIF panel's warning), the slider's
  readout and the store's setter all call it; `speedMultiplier` is never normalized by hand again.
- **`nextFreePath(wanted)`** (`main/ffmpeg/outputPath.ts`, T-106) is the only way a runner turns the name it
  wants into a name it may write: `name.ext` if nothing is there, else the first free `name (2).ext`,
  `name (3).ext`. Every runner that writes into a folder the user chose calls it (a platform export, a GIF,
  a compilation's join, a reframe, picture-in-picture), inside `run.guard(...)` like the probe, and uses the
  path it returns for ffmpeg, for the cleanup of a stopped job and for the result the panel reveals.
  `makeKitDir` numbers the kit's FOLDER (`{ directory: true }`), because a kit is a set. An export that
  replaces an earlier one is a bug whatever the reason: T-100 deletes what a canceled job was writing, so a
  Cancel on a job that shared a path with a finished export used to delete the export.
- **`buildWatermark(text, position)`** (`@shared/watermark`) — the one place a
  handle and a corner become a `WatermarkSpec`. The Export panel calls it on
  what is typed; Clip Kit calls it on what an earlier export SAVED
  (`streamerHandle`, `watermarkPosition`), so the two cannot stamp different
  looks (T-85). Both inputs are untrusted (the saved ones come off disk). An export with the field blank forgets both
  saved keys (T-119), because the guide says Clip Kit stamps "the watermark you last exported with":
  `window.api.settings.set(key, undefined)` deletes the key in main (`setSetting`; electron-store refuses `undefined` from
  `set`), and every other value, `null` included, is stored and judged by the schema as before.
- **`<NameDialog>`** (`components/NameDialog.tsx`) — "ask the user for
  one name", the whole of it: Modal chrome, a labeled field, Enter or
  the confirm button, a blank name refused, Cancel/Escape/scrim leaving
  the caller untouched. Its optional `maxLength` is the caller's limit, enforced on
  the input itself (T-135 (8): the mood-board rename passes `MAX_BOARD_NAME`, the
  number main enforces); unset, the field takes any length. **Never `window.prompt` or `window.alert`** —
  Electron does not implement them, so the call throws inside the click
  handler and the control looks fine while doing nothing (T-28).
  `tests/unit/interactionWiring.test.ts` parses `src/` and fails on any
  `prompt` call.
- **`<Modal>`'s scrim closes a dialog only when the press AND the release were both on it (T-123).** Chromium dispatches the
  `click` of a drag to the COMMON ANCESTOR of where the button went down and where it came up, so pressing inside the
  card (to select a word of a typed name) and letting go a little outside it fires a click ON the scrim, which closed
  the dialog and threw the typed name away. `Modal` records whether the press began, or ended, inside the card and
  ignores that click; a plain click on the scrim still closes (`closeOnScrimClick`). Never close on a bare scrim
  `onClick`. **The second press of a double-click is not a second decision (T-131 (4), (6), (8)):** `lib/repeatPress.ts`.
  `isRepeatPress(e)` (`e.detail > 1`; a keyboard click is 0) is ignored by a button that REPLACES itself with another under the pointer
  (the Fix wizard's answers, the tour's Next / Done, Back and scrim), and when a `Modal` (or the tour) closes,
  `swallowRepeatClicks()` has a capture-phase listener on the window drop clicks with `detail > 1` for 500 ms, so the second press
  never reaches what the dialog covered (a checkbox under "Keep running"). One listener, installed on the first close, ahead of React's;
  only a repeat is touched. A new control that swaps itself for another asks the same question. **The keyboard's double-click is a HELD
  key (T-133 (7a)):** a held Enter on the tour's Done (or a Modal's confirm, the Fix wizard's Apply) closes the dialog with its first
  press, focus goes back to the control that opened it, and the key's auto-repeats are keyboard clicks (`detail` 0, so no click rule sees
  them) on THAT control: the tour reopened itself. `createHeldKeyGuard` (`lib/repeatPress.ts`) remembers which of Enter and Space are down
  and, when a dialog closes (`swallowRepeatClicks` arms it), swallows the repeats of those until they are let go (capture phase on the
  window; a fresh press, a key-up and a window blur clear it). It is keyed on the KEY and not on a clock because the first repeat arrives
  after the OS's repeat delay (250 ms to 1 s on Windows), later than any fixed window can promise, and it listens from the moment the module
  loads because it has to SEE the key go down. A toggle is one decision per press (T-133 (7b)): Space on the Player and the Timeline and the
  `?` overlay ignore `e.repeat`; so does a marker (T-134 (2)): a held I or O set the point on every auto-repeat, each an undo step, and a second
  of holding filled the store's 50-step history and evicted real edits. The nudge (arrows) and frame-step (`,` `.`) keys repeat by design and
  are not guarded.
- **`DraftField`** (`components/DraftField.tsx`, T-113 for Size and Color, lifted by T-123) — a box that keeps what is typed
  to itself until typing ends. A controlled number input that judges every keystroke cannot be typed into: `Number(typed)
  || 360` snapped an emptied box to 360, so "600" typed after clearing it was 360600 (and the PiP composite failed with a bare
  sentence), and `value={n.toFixed(2)}` rewrote "12" to "1.00" mid-word. `DraftField` takes the store's value, a `commit(typed)`
  that returns a refusal sentence or null, and an optional `live(typed)` for "usable as typed" (a number inside the range
  goes straight to the store while the person types); it commits on blur or Enter, shows the refusal under the box
  (`aria-describedby`), and shows the store's value again when a commit stores nothing (an emptied box, text that is not a
  number). `@shared/draftNumber` (`typedNumber`, `isTypedInRange`, `clampTyped`) holds the pure judgments.
  T-125 (8): while the box has focus it shows what was TYPED, even after a live commit, and shows the stored number only when
  it is left. It used to hand the box back to the store on every usable keystroke, and for a number input that was a trap: the
  browser reports "" for "0." and for "-", so the store's text and the DOM's disagreed mid-word and React rewrote the box
  ("0.05" arrived as 1, "-0.5" lost its sign). `live` still commits as soon as the text is usable; `finish` does not commit the same
  text a second time. Every number
  box whose value feeds a gate (the overlay's Time, Size and Color, PiP width, the spike window, a custom preset's width,
  height and frame rate, the grid size, a text layer's Size, and (T-124 (15)) a layer's x / y / Rotation in Properties and the
  overlay's x / y, and (T-136 (9)) the chat spike finder's extra seconds, 0 to 60) is one; a new one is too, never `|| <default>` in an `onChange`. A `type="number"` box fed
  `String(n)` on every keystroke cannot be typed a minus sign into (`"-"` is not a number, so the store's old value replaced it)
  and turns ".5" into 1: the clamps are `layerOffsetRange` and `LAYER_ROTATION_RANGE` (`@shared/canvas`) for a layer and 0..1
  for the overlay's fractions, applied by `clampTyped` when typing ends.
- **`formatClock(seconds, places)` and `parseClock(typed)`** (`@shared/clockTime`, T-125 (23)) — a time in a source video as a person
  reads and types it. `formatClock` is the one `m:ss` (`places` 0, 1 or 2 truncated digits of fraction) and writes `h:mm:ss` from one
  hour up; the Timeline, the clip list, the highlight lists, the captions list, the player and Audio Studio's waveform all call it, and
  `interactionWiring.test.ts` fails on a panel that carries its own `Math.floor(seconds / 60)` formatter again (eight copies never went
  past 59 minutes: "167:13.0" for a three-hour VOD). `parseClock` reads seconds, `m:ss`, `h:mm:ss` and a fraction, and refuses a
  field of 60 or more beside a bigger unit; the overlay's Source time boxes are text boxes that use it (and refuse what is not a time
  in `OVERLAY_TIME_REFUSAL`). The two Source time boxes are ONE form, decided by the PAIR (`overlayTimePair`, T-127 (7), T-131 (16)): when
  both values are under an hour both boxes show the seconds the card line says ("12.50"); when EITHER is one hour or more BOTH show the clock
  the Timeline beside them reads (`overlayTimeText`: "1:40:43.50", T-126 (5)), so "2:47:18" is not rewritten to "10038.00" when the box
  is left and a window from 59:50 to 1:00:10 does not read "3590.00 -> 1:00:10.00". The unit follows the form: the trailing "s" belongs to
  the seconds form only, never to a clock. The outside-the-clip note puts the CLIP's range through the same function. The overlay's pair
  and the clip's pair are two pairs, each coherent in itself (an overlay window of 10-20 s inside a clip of 59:50-1:00:10 reads seconds in the
  boxes and a clock in the sentence about the clip), which is why the rule is about a pair and not about the card.
- **A disabled button looks disabled (T-133 (9)).** `btn-primary` and `btn-ghost` carry no disabled look of their own, so every
  `<button disabled=...>` also carries `disabled:opacity-50` in its className (the autosave banner's Restore and Clear, the two Importers'
  "Choose file…", Play while the waveform is drawn, and the rest). `interactionWiring.test.ts` scans every `<button disabled>` in the
  renderer with the TypeScript syntax tree and fails with its file and line, with a discrimination block over sample code.
- **`PanelHeader`** — every panel section header. Renders the standard
  `<h3>` (`text-xs font-semibold uppercase tracking-wide text-ink-muted`,
  an `Icon`, `inline-flex items-center gap-1.5`). Pass an `actions`
  prop for a right-aligned control and it renders a wrap-capable row for you
  (`flex flex-wrap items-center gap-x-2 gap-y-1`, the actions in an `ml-auto` span; T-126 (14)): the heading never
  wraps (`whitespace-nowrap`), and a row too narrow for both drops the actions WHOLE to a right-aligned second row
  instead of breaking a word or clipping. **Never hand-write a
  panel-header `<h3>`** — use `<PanelHeader icon="…">Label</PanelHeader>`.

```tsx
<PanelHeader icon="palette">Color & motion</PanelHeader>
<PanelHeader icon="bolt" actions={<button>Scan</button>}>
  Smart highlight finder
</PanelHeader>
```

- **`RunningCancel` and `ProgressTrack`** (`components/RunningCancel.tsx`, `components/ProgressTrack.tsx`, T-136 (7)) - the Cancel of a job that is
  running and the bar of one that reports how far along it is. The Cancel was hand-written eleven times (GIF, Compile, Picture-in-picture, Reframe, the
  highlight scan, both Captions jobs, the model download, the Export batch, the audio export, the Clip Kit) and two copies had drifted off the pattern:
  the audio export's was a plain gray box with no danger ink and no title, the Clip Kit's a hand-rolled bordered one, the model download's a bare cross.
  `<RunningCancel title="Cancel GIF export" onClick={...} />` is a `btn-ghost` with the danger ink, the word "Cancel" (what a screen reader and a
  voice-control user say) and the job it stops as its `title`; a dialog's "Cancel" is an answer, stays `btn-ghost px-3 py-1.5 text-sm` and lives in a
  `Modal`. `<ProgressTrack label percent tone? className? />` is the `role="progressbar"` named for its job: `percent` a number draws the fill and
  `aria-valuenow`, `null` draws the sliding `.progress-indeterminate` segment with no value (a bar is a measurement or it is absent, T-89), and `tone`
  keeps a row the person canceled gray and a failed one red (T-100); the percent beside it stays with the panel. `tests/unit/runningJobControls.test.ts`
  fails on a hand-written Cancel button outside a `Modal`, and on a `role="progressbar"` outside the track and its two decided exceptions (the waveform's
  "Drawing the waveform" box and the recording convert's bar, which has a 2% floor). The next job's panel writes `RunningCancel`, not a twelfth copy.

If you write the same markup a third time, extract it.

---

## TypeScript conventions

- **Strict everywhere.** Both tsconfigs run `noUnusedLocals`,
  `noImplicitReturns`, `noUncheckedIndexedAccess`, etc. Don't fight
  them — fix the root cause.
- **No `!` non-null assertions.** Use `assertDefined(value, name)` from
  `shared/assert.ts`. It throws (dev and prod) with a named message.
- **`assert(cond, msg)`** at the top of functions that take untrusted
  or wide input — Power of Ten rule 5. It is a SOFT invariant: it throws in
  dev and logs-and-continues under `NODE_ENV=production`, by design.
- **Validators throw; `assert()` warns (T-113, T-114).** A function whose job is to
  refuse input at a trust boundary (`shared/validators.ts`,
  `assertSafeAbsolutePath`, every payload check in `src/main/ipc/`, and any check in
  main that stands between a value and a command line, a style string or a `delete`) is built on `assertAlways(cond, msg)` — it throws in
  EVERY environment. Built on `assert()` it failed open for exactly the person who
  had `NODE_ENV=production` set: a chain's `gainDb` string reached the filter
  graph, a path with `..` reached `ffmpeg -i`, a caption color reached `force_style`, and
  the re-attach runner deleted the user's source (an `assert()` in front of an unconditional
  `unlink`). A new validator uses `assertAlways`; `validators.test.ts` scans every non-test
  file under `src/main` and fails on a soft `assert(` unless it is in its table of audited pure
  invariants (`AUDITED_PURE_INVARIANTS`: an argument only another function of ours supplies,
  behind a gate that already refused — add a row only after reading the caller).
- **IPC handlers: a refusal of the payload throws; an outcome that is not a fault returns
  `{ ok: false, reason }` (T-114).** The two rules above and this one are the same line drawn
  twice. A payload or shape that should never arrive (a missing field, a path with `..`, a
  color that is not `#RRGGBB`, a number out of range) is a bug or an attack, so the handler
  THROWS (`assertAlways` or a validator), with a finished sentence when a person can reach it
  (`audio.ts`' `refuse`). A runtime outcome that is expected and is the caller's to show - the
  file the project points at is unreadable (`project:load`), the autosave does not exist or
  failed validation (`autosave:read`, `autosave:write`), a kit's transcript is not there
  (`captions:writeKitSrt`), a model download did not finish (`captions:installModel`) - returns
  `{ ok: false, reason }` and does not throw across the bridge. A handler that returns
  `ok: false` for a bad payload, or throws for a missing file, is on the wrong side of the line.
  One confined read belongs on the `ok: false` side too (T-115): `captions:writeKitSrt` returns
  `{ ok: false, reason }` for a source SRT outside the captions directory - the transcript the
  caller named is not one the app wrote, which is a read-confinement outcome the caller handles as
  data (Clip Kit toasts one plain line and the rest of the kit stands), like the missing transcript
  beside it. A traversal in the WRITE path is not: `dest` goes through `assertSafeAbsolutePath` and
  THROWS, because a write target that escapes its folder is a payload no caller sends by accident.
  So the same handler holds both sides of the line, one per argument: the read it was told to open
  may be refused as data, the file it was told to write may not be aimed anywhere it likes.
  `captions:saveSrt` is the recorded exception (T-116): it still THROWS for both read outcomes, a
  transcript outside the captions folder and one that is gone, but each throw is a finished sentence
  ("That transcript isn't on this computer anymore - transcribe the video again.") that
  `userFacingError` lets stand (tier 2: no channel name, no path, nothing a tier-1 pattern would
  rewrite), and the existence check runs BEFORE the Save dialog opens so no one picks a name for a copy
  that cannot be made; the folder gate answers first, so a path outside the folder never reveals whether
  a file is there. Its one caller is a button whose `catch` is `reportFailure`. Moving it to the `ok: false`
  shape is the upgrade, and a bigger call than a sentence (see the ledger's "Found, not fixed").
- **Every libx264 command that takes a picture it did not make opens its `-vf` with
  `EVEN_PICTURE` (T-113, T-114, T-115).** `ffmpeg/filters.ts`' `crop=trunc(iw/2)*2:trunc(ih/2)*2`: libx264
  with yuv420p refuses an odd width or height at exit 187, and a VP8/VP9 screen recording is where
  an odd one comes from. It is a CROP, not a scale: a window capture's text is one-pixel strokes, and a
  scale from 321 to 320 resamples the picture to lose one pixel (bicubic; only the four corners stay
  hard, every edge is soft at its middle and the center is a flat gray: a 1-pixel checkerboard came out
  with about half its pixels, 48 percent, in the mid-gray band strictly between 80 and 175), where the crop trims one pixel at
  the right and bottom edge and leaves every other pixel as it was. Layer 5 holds it with a 1-pixel checkerboard. The audio re-attach, the MP4 convert (the recording's AND the importer's),
  the caption burn-in (with a subtitle stage and without one) and the picture-in-picture composite
  all start with it; a new command that encodes a source picture does too, and gets an odd-sized
  case in the Layer 5 suite. A platform export, a compilation segment and a reframe already end in a `scale`
  to an even size (the reframe a crop and then a scale). The convert matters most: `recording.ts` removes the temp webm when the
  convert fails, so an odd take was lost.
- **A graph stage that depends on how the source is tagged reads the probe (T-118, T-119, T-120).** `colorbalance` (the Temperature
  slider) is an RGB filter: on the shipped 6.1.1 its YUV round trip comes back in the bt601 matrix and drops the tag, so
  a bt709-tagged source (OBS's default) was re-encoded wrong while players read it as bt709 (SMPTE green `(0,157,0)`
  came out `(0,130,0)` in the suite's runners). `probeVideo` carries `colorSpace` (absent when untagged), `runExportJob` (and so Clip Kit) and
  `runConcat` hand it to `buildVideoFilter` as `source.colorSpace`, and the grade then appends right after `colorbalance`:
  for `bt709`, `scale=out_color_matrix=bt709,setparams=colorspace=bt709`; for `smpte170m` and `bt470bg`, the two bt601 tags (OBS's Rec.601
  profile, SD captures), `setparams=colorspace=<that tag>` and nothing else. The two tokens of the bt709 pair do different jobs
  (measured on 6.1.1): `setparams` puts back the TAG and, because the YUV conversion after it reads the tag, the pixels too (the retag
  alone reads within 3 levels of the ungraded control: the T-118 bands fixture at a cast of 0.01, worst band red `199,42,42` against `202,45,45`), and the `scale` (which does not re-tag there) is for a following Auto Zoom,
  whose `zoompan` drops the tag again: a frame still in RGB at that point is converted afterwards as an untagged one, so retag-only
  plus Auto Zoom reads green `(0,133,0)` and the `scale` plus the retag reads `(0,155,0)`. That is why bt709 keeps its `scale`, and
  the Layer 5 case "a bt709 source ... with a grade AND Auto Zoom on" is the one that tests it. The bt601 tags' tag was stripped
  the same way, and every built-in preset is at least 1280 px on its long side, where a player that guesses reads an untagged file as bt709; their pixels were never wrong,
  because swscale reads and writes bt601 by default, so for bt601 the round trip is symmetric and the tag is all there is
  to put back. Anything else gets nothing. **Untagged is skipped because that same round trip is symmetric** (the picture comes
  out as it went in and there is no tag to lose), NOT because "players assume bt601": at HD they guess bt709, for the input
  and the output alike. `bt2020nc` is the ledger's residual, and its upgrade is the same pair: a retag alone restores its tag and
  pixels on 6.1.1 as it does bt709's (measured: within 4 levels, red `200,43,40` against `202,45,44`, on the same bands made in the bt2020 matrix and
  tagged bt2020nc, a hand fixture that is not in the suite), and a `scale=out_color_matrix=bt2020` ahead of it is what survives an Auto Zoom. The
  constant is `bt2020`: the bundled 7.0.2 refuses `bt2020nc` and `bt470bg` as `out_color_matrix` values ("Undefined constant"),
  and `bt2020` is accepted by both majors. A new caller of `buildVideoFilter` passes the probe's value (`gradeMatrix.test.ts` holds the two that exist). The
  Layer 5 cases cannot go red on the bundled 7.0.2, which keeps both the matrix and the tag; see TESTING.md.
- **A recording saved as WebM is rewritten on save, and a container's millisecond clock is not a frame rate (T-120, T-121).** MediaRecorder
  streams its webm, so the header has no duration and `probeVideo` refuses the file. `promoteTempWebm`'s non-convert branch runs
  `remuxWebm` (`convert.ts`, `-c copy`) through the convert's own child registry, so Discard, `cancelConverts('recording')` and the quit
  sweep reach it; a discard removes the half-written file and answers `null`, and any other failure falls back to the plain copy (the
  remux only repairs a header, so it is never a reason to lose the take). No ffmpeg option writes a frame rate into a stream copy (the
  muxer stamps the stream's 1 ms clock as `DefaultDuration`: `r_frame_rate 1000/1`), so `probeVideo`'s `probedFps` reads a rate above
  240 as "the file does not say" (0, which the Timeline and the Player step at 30). The MP4 convert carries `-fps_mode vfr` for the
  same file: its muxer's default is a constant rate, which wrote one frame per millisecond. **Every command that re-encodes a
  take to mp4 closes the same class (T-121):** the caption burn-in and the picture-in-picture composite carry `-fps_mode vfr` exactly as the
  convert does (the burn-in measured 2987 frames for a 3 s take and "More than 1000 frames duplicated"), and the cut re-attach no longer
  retimes survivors by `setpts=N/FRAME_RATE/TB` (which spaced them 1 ms apart on a 1000/1 container: 2.4 s of kept picture collapsed to 0.07 s
  under 2.4 s of sound) but by their own timestamps, `vselectForCuts`: each survivor moves earlier by the length of the removed spans before
  it (`PTS-(max(0,min(T,end)-start)+...)/TB`, spans merged first so an overlap is counted once), and (T-123) behind `settb=AVTB`:
  `setpts` writes the stamp in the time base of the frames it is handed, and an AVI's video stream has `1/fps`, so `setpts` ITSELF
  rounded the retimed stamp onto the frame grid before the encoder was involved (a duplicate on the BUNDLED 7.0.2 too, which
  `-enc_time_base:v filter` cannot undo); a microsecond base between `select` and `setpts` hands it room for the fraction.
  At each cut picture and sound agree to within one 256-sample block of sound (5.3 ms at 48 kHz), and the errors ADD UP over
  several cuts (T-110 (i)): the bound is per cut, not per file. T-124 (32): the block is OURS, not the decoder's. `aselect` keeps
  or drops whole FRAMES and a frame is whatever the decoder produced (FLAC 4608 samples, ALAC 4096, a WAV 1024 on 6.1.1 but
  4096 on the bundled 7.0.2: up to 96 ms), so `aselectForCuts` puts `asetnsamples=n=256:p=0` ahead of it (`asetpts=N/SR/TB`
  after the select is sample-indexed, so the retime is unaffected) and Layer 5 measures FLAC, ALAC and WAV sources through
  the real export on both majors. The tail trim `-shortest` may make is derived from the same grid (`maxTailFrames` in the
  T-122 block), not a flat 2. A new libx264 command that takes a recording
  asks the same question (what is its frame rate when the container says 1000/1?) and gets a case on the MediaRecorder-shaped fixture. Layer 5 holds all of it on
  that fixture (`duration=N/A`, `1000/1`, `0/0`), not on a file ffmpeg made the ordinary way. A steady-rate source is unchanged by the vfr
  mode; the retime by time puts the first survivor after a cut one frame later than the old count did (41.7 ms at 24 fps, where the cut
  ends on a frame the `between` removes), which is where the sound is.
- **An audio export ends in a stage that answers for its peaks, and a mono file's loudness is the one a stereo playback hears (T-111,
  T-123).** The mix bus has always ended in `MIX_LIMITER` (`alimiter=limit=0.891:level=disabled`: peaks above -1 dBFS are
  limited and nothing below moves, `level=disabled` so the limiter does not re-level). The single-track `-af` did not unless
  Even volume was on: +12 dB of Manual gain on a -2 dBFS file exported at 0.0 dBFS, a flat-topped wave, with nothing in the app
  warning (the preview plays the unprocessed source). A chain with ANY stage now ends in the same constant, a bare pass-through
  (`EMPTY_CHAIN`, `anull`) is left alone (nothing switched on and nothing cut is the file that went in), and an Even volume chain gets none (its
  last stage is `loudnorm`, whose true-peak limit is -1.5 dB). The Levels panel says it, on the same condition ("When you boost, switch something
  on or cut a part out, peaks above −1 dBFS are limited in the export, so a boost cannot clip. Otherwise the export keeps your levels as they are."). EBU R128 counts a mono file as ONE channel, but every stereo playback of it is dual mono, 3 LU hotter than the
  meter said (Even volume's -16 landed at -13): `loudnormFilter` takes `dualMono` and appends `:dual_mono=true` to BOTH
  passes (pass 1's `measured_I` and pass 2's gain must agree on what was measured), for a mono source that is exported on its
  own; with a second track the primary is forced to stereo ahead of the mix's own last stage and is not told. Layer 5 measures
  both on real output (the peak with `volumedetect`, the loudness with `ebur128=dualmono=true`).
- **A crop is clamped to the frame (T-123).** The editor stores a crop as `offsetWidth / pictureWidth` and a browser rounds a box
  to whole pixels (800 px in a 799.5 px parent is 1.000625), so `assertOptionalCropRect` accepts up to 1.01 rather than refuse
  the editor's own crop. `manualCropRegion` (filters.ts) scales it and clamps the size to what is left of the frame past the
  offset, BEFORE `even()` (so `x + w <= width` and `y + h <= height` whatever got through): `crop=3842:2160:0:0` on a
  3840 px source failed the whole export with no output. `cropToFrame` is the one place a platform export, a compilation segment,
  a GIF and the Clip Kit build their crop, so the one clamp covers all four.
- **The waveform is main's peaks; the renderer never decodes a file (T-129, retiring T-123's ceiling).** Audio Studio used to hand
  wavesurfer the file's address alone, and wavesurfer fetched the WHOLE file and decoded it with WebAudio in the renderer (3.25 GB
  for 1 h of WAV, 6.5 GB for 2 h), so T-123 refused anything over two hours. Now `audio:peaks` (`main/audio/peaks.ts`) has ffmpeg
  decode the first sound stream, mono at 8 kHz, as raw PCM into a pipe, and folds each chunk as it arrives into `PEAK_BUCKETS`
  (4000) highest/lowest pairs - nothing of the stream is kept, in main or anywhere - and `WaveformView` creates wavesurfer only
  once those exist, with `url` + `peaks` + `duration` (given `peaks`, wavesurfer 7 skips both its fetch and its decode; the `url`
  is only its media element's, which streams the file over imagii-file's Range support). `audioStore.loadSource` opens the file
  (the studio shows it at once) and `drawWaveform` runs the job: `drawing` carries its percent, which the panel shows in the box
  the waveform will fill ("Drawing the waveform… N%", a `role="progressbar"`), and `waveform` its answer, checked by
  `isWaveformPeaks` (a size-bounded payload). A file main cannot read is REFUSED there - the studio lets go of it and every route
  shows `WAVEFORM_READ_FAILED` as written (`reportFailure`) - and a file closed or replaced while it draws has its job stopped
  through `audio:cancel` (the job has a per-job registry and a `CancelLatch` run, so the quit sweep and the quit's drain cover it).
  `WaveformView` listens to wavesurfer's `error` (it can emit it twice for one failed load, so the toast has an id): with peaks,
  what fails there is PLAYBACK, so the sentence is `PLAYBACK_ERROR_MESSAGE` and Play goes back off (T-132 (10): it says the waveform,
  the cuts and Export still work, and sends a WAV owner to "a standard PCM WAV", not to WAV; T-133 (10): `WAVEFORM_READ_FAILED` says the same, because the file it fires on, a WAV
  whose format tag no decoder knows, is a WAV too). There is no length gate
  anywhere: `audio:extractFromVideo` probes only for "no sound" and for whether the file has a picture (T-126 (7), T-127 (10)).
  T-132 (5): `normalize: true` alone scales the waveform by the loudest sample of channel 0 (the highs) ONLY, so a take with louder
  lows drew its bottom half past the canvas edge; `WaveformView` passes `maxPeak: peaksMaxMagnitude(waveform.peaks)` (the loudest of
  both halves, `shared/audio.ts`). T-132 (11): `loadSource` resolves when the file is OPEN, with the source it opened, and its waveform is
  read after that, so "the file opened" is not "main could read it": whoever celebrates a file asks `waveformArrived(source)` first
  (the importer's green "Loaded" and its Recent entry; the project open's "Project loaded" and "Restored from autosave" ask
  `audioSettled(outcome)`, about the source `applyProject` recorded in `outcome.audioOpened`, because a refusal that landed before
  anyone asked leaves the studio EMPTY, which is not "nothing was opened"). Play is `disabled:opacity-50` while the waveform is drawn.
- **What the Player owns, the Timeline asks for through the store (T-120, T-121).** The Player registers a `PlayerTransport` (`readTime`, the
  element's exact `currentTime`; `togglePlay`, its own play / pause) with `registerTransport` while it is mounted. The Timeline's Space
  calls `togglePlay`, and its arrows, `,` / `.` and I / O read `playheadNow(state)`: the element's time, else the store's `currentTime`, which is
  written on `timeupdate` and trails playback by up to a quarter second. There is one play / pause and one reading of "where the playhead is" for
  every key that acts on it; the store's `currentTime` is read in the Timeline only to DRAW the playhead and announce the slider's value, which
  may lag a quarter second behind a playing picture.
- **A completion that outlives its screen asks where the person IS before it moves them (T-132 (1)).** `useNavigate`'s `navigate` keeps
  working from a component that unmounted (react-router's `activeRef` is set once and never reset), so a long job's `navigate('/audio')`
  at its end took the person there from wherever they had gone - from `/record` that unmounted `RecordStudio`, whose cleanup stops the
  tracks, and a LIVE TAKE was cut short. A job that can outlast its screen reads `currentRoute()` (`ProjectIO.ts`, the router's own hash) AFTER
  the wait, navigates only a person who is still on the screen that started it, and otherwise loads the result and raises a toast whose
  action is the way there (`toastWithActions`; on the destination itself, no action). Clean audio is the case; `ProjectIO.applyPlace`'s
  "nothing teleports the user" is the same rule for a project open. **The autosave Restore is the case a click-time premise hid (T-134 (1)):**
  `AutosaveRestore` awaits `applyProjectHeld` (minutes, for a sound that is extracted again) and then went to the snapshot's route; the T-133
  navigate table had blessed it as "on Home", which is true at the click and false at the `navigate`. It goes only if `currentRoute()` is
  still `/home` once the apply is over, and otherwise says nothing more than "Restored from autosave" (a person who went to Record and started
  a take stays on Record, recording). **"→ Canvas" was the same premise on References (T-135 (13)):** `MoodBoardPanel.sendToCanvas` awaits the
  picture's load (which can be a network fetch for a tile whose cached thumbnail is gone) and then navigated to `/image` wherever the person
  was. The layer is added and the toast reports it either way; the navigate happens only if `currentRoute() === '/references'`, read after the
  await. Its two buttons have a busy flag each (`restoring`, `clearing`; both dim while either runs), so Clear
  never relabels Restore "Restoring…". **A toast outlives its screen, so its buttons ask where the person
  IS before they take them anywhere (T-133 (1)):** the "Open Audio Studio" button that fix put in an 8 s toast sat over the REC screen, and
  one press unmounted RecordStudio and cut the take. A take that is being recorded is REGISTERED (`registerLiveTake`, `lib/liveTake.ts`,
  for as long as the phase is "recording") and every way off that screen asks `mayLeaveLiveTake()` first: the Home link, the toast's "Open
  Audio Studio" and `useEditInVideoStudio` (Record's, Reframe's and the audio re-attach's "Edit in Video Studio"). It asks the Home link's
  question word for word (`LIVE_TAKE_MESSAGE`); OK stops the take and its normal save runs where the person is, Cancel keeps recording, and
  either way the caller does not navigate now. `interactionWiring.test.ts` holds the set of renderer `navigate()` calls to a decided
  table, so a new exit fails until it is decided.
- **`ffmpeg exited 0` is not "ffmpeg wrote a picture" (T-131 (1), T-132 (4), T-133 (4), (5), T-134 (4)).** A range that lies past the PICTURE exits 0 having written a
  261-byte stream-less container ("Output file is empty") or an audio-only mp4 (the sound outlasts the picture; no such line). Three runners
  that cut a video out of a RANGE of a source (Export, Reframe and, since T-133 (4), the caption burn-in, which
  was the one left out and said "Captions burned in" over an audio-only file) close on `wroteNoPicture(sawEmptyOutput, frames)`
  (`ffmpeg/noPicture.ts`): the sticky stderr line OR the final `frame=0` of `-progress pipe:1` (`PictureFrames`, which keeps an unfinished
  line until it is whole), reject with a finished sentence (`BURN_IN_NO_PICTURE_MESSAGE` for the burn-in), and let the existing
  `discardPartialOutput` remove the wreckage (and the burn-in's shifted SRT goes in its `finally`). A compilation's segments are the fourth cutter and
  read the stderr line alone (`concat.ts`, T-134 (4)), which is sufficient there: a segment ends in `apad` and `-shortest`, so a range past the
  picture, even one inside a sound that runs on, is a truly streamless ~970-byte stub with the line printed at the verbosity the app runs
  (measured on both majors by three parties; the earlier text said the segments read both facts, which over-claimed). `docClaims.test.ts` lists the
  runners that call `wroteNoPicture`, so a fourth caller fails until this paragraph is re-read. Layer 5 holds each on both majors, the segment shape
  too (a 5 s picture with 9 s of sound; a GIF of such a range needs no guard: it already fails, exit 234 on both). A
  stream that never reported a count is not accused. `extractFrame` is not one of these (a JPEG has no frame count): after its exit 0 it asks
  `wroteOutput`, which asks only whether a non-empty regular file is at the path, and no clock (T-133 (5): it borrowed the discard path's
  "newer than the spawn, 2 s of slack" and refused a GOOD thumbnail on a share whose clock ran more than 2 s behind, aborting the kit). What
  makes that safe is that nothing is at the target when it starts: the thumbnail goes into a fresh `makeKitDir` folder and `extractFrame`
  refuses a target that already exists, before ffmpeg runs, leaving it as it was.
- **An `await` in a start that can outlive its screen is followed by the unmount check (T-120).** `RecordStudio.startRecording` awaits the
  capture, the microphone, the camera, the compositor and the main-process session, and the unmount cleanup runs before any of them lands.
  `unmountedRef` is cleared on mount (StrictMode runs the cleanup and the effect again in dev) and set in the cleanup;
  `leftWhileStarting(...extra)` follows each await, releases what the await returned and what the refs hold, abandons the session if
  `begin` has answered, and ends the start with no toast. `interactionWiring.test.ts` fails on an await in that function with no check
  after it.
- **The electron-store schema is nested, one object per dotted group, and a test flattens it (T-120).** Conf nests a dotted key
  (`record.convertToMp4` is `{ record: { convertToMp4 } }` on disk), so a schema property named with a dot matches nothing: the eleven
  dotted keys were unchecked for rounds. `settingsKnownKeys.test.ts` flattens the schema into dotted paths and compares them to the IPC
  allowlist, and fails on any property name that contains a dot. A schema judges a write; a `config.json` that parses but breaks it stops
  the launch (the ceiling is recorded at the schema).
- **A text overlay's font is a key into a table, never printed (T-114).** The editor stores one of
  `OVERLAY_FONTS` (`@shared/textOverlay`); `overlayFontPath` (filters.ts) maps it to a literal
  `C\:/Windows/Fonts/<file>.ttf`, and a name that is not an own key - an older project, a
  hand-edited one, `constructor` - is Arial. The stored string is never interpolated. The
  table is typed over the union, so a font added to the list without a file fails the
  typecheck; the Font box was a dead control for as long as the filter printed `arial.ttf`.
- **A restore migrates what an older build stored, in `validateProject`, before the gate looks
  (T-114, T-115).** `migrateLegacyOverlays` does two things. An overlay color that is a CSS name
  (`white`, the editor's old default) becomes its table hex (`shared/overlayColors.ts`, a leaf
  module: `textOverlay.ts` and `projectValidation.ts` both need it and the first already imports
  the second); anything else is left alone and the hex-only gate refuses it, so the injection pin
  does not move. A size that is a FINITE number is clamped into the gate's 8-512 (the old editor
  had no upper clamp, so a person who typed 800 saved a project that could not be opened again);
  a size that is not a finite number - a string, `null`, `Infinity` - is left for the gate, so the
  clamp can only ever turn a number into a number. The gate itself (`isValidTextOverlay`) stays
  strict: Export and Compile run it on every overlay they are sent and still refuse a size outside the
  range; Save project and a restore go through `validateProject`, which migrates first, so neither refuses a
  legacy size (Save writes the clamped number).

- **`validateProject` requires what the studios read without a guard (T-119, T-121).** A field a studio dereferences with no
  default is required, with a reason in the file's style (`videoStudio.clips[1].selectedPresets not an array`): a clip's
  `id`, `name`, `startSec`, `endSec`, `textOverlays` (an array: T-121; the T-119 text called it "read with a default", and the
  store, the overlay editor and `buildVideoFilter` all read it bare) and `selectedPresets`; the chain's `gainDb`, `loudnormTargetLufs` and `cutRegions`
  (and each cut's two times); the canvas `doc.layers`, as an array. `clips: [{}]`, `chain: {}` and `doc: {}` used to pass
  and then threw in render (`for (const p of clip.selectedPresets)`, `chain.gainDb.toFixed`) or silently killed autosave
  capture (`doc.layers.length`). What a studio reads with a default stays optional exactly as an older build left it
  (`cropRect`, the speed, the grade, the flags, `humHz`, `denoiseParams`, `secondaryTrack`), and the
  refusals with a security reason - the second track's path and numbers, an overlay's color - are still named first.

## Power of Ten

imagii follows Holzmann's 10 rules. The ones that bite
most often: functions ≤ ~60 lines, ≥2 assertions per function, all
loops bounded, no recursion, check every return value.

---

## Tests

- Pure logic gets a unit test. Vitest, `environment: 'node'` — **no
  DOM**, so test pure functions, not React rendering.
- Every fixed bug gets a regression test **and** an entry in
  `LESSONS_LEARNED.md`.
- Test files sit next to the code: `foo.ts` → `foo.test.ts`.

---

## When this guide changes

A convention change updates this file in the **same commit** as the
code. The `/guide-sync` command and the `design-reviewer` agent treat
this document as authoritative.
