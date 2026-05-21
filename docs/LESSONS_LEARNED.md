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
