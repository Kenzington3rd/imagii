# How imagii Was Made

A step-by-step build log of imagii — a free, local-first creative studio for streamers and content creators. Originally a personal gift to Mike; later refit for the broader streamer audience. Windows desktop app, Electron + React + TypeScript + FFmpeg.

This guide is the chronological development story, pulled from the commit log and the architectural decisions made along the way. Each stage names the problem being solved, the approach taken, and the lessons that shaped what came next.

---

## Stage 0 — Foundation (initial commit + Sprint 0)

**Goal:** Stand up an Electron app skeleton that could host multiple "studios" (capture, edit, design) under one roof.

**Stack chosen:**
- **Electron 31** for the desktop shell (cross-platform; familiar web tech in the renderer; a real Node.js main process for OS-level work).
- **React 18 + TypeScript** in the renderer.
- **Vite** as the build tool (via `electron-vite`), giving fast HMR during development.
- **Zustand** for state management — picked over Redux because it's tiny, has no boilerplate, and per-store subscriptions integrate cleanly with the IPC + autosave patterns added later.
- **Tailwind CSS** for styling.
- **electron-builder** for packaging the portable `.exe`.

**Architecture:**
- `src/main/` — Node.js main process (file I/O, FFmpeg, IPC handlers).
- `src/preload/` — context-bridge that exposes a typed `window.api` to the renderer.
- `src/renderer/` — React UI.
- `src/shared/` — types and pure helpers used by both sides.

**Routes:** Welcome → Home (5 NavCards: Record, Video, Audio, Image, References).

---

## Stage 1 — Video Studio MVP (Sprint 1-2)

**Problem:** Take a single video, trim it, export sized for YouTube / Reels / TikTok / X / Facebook.

**Approach:**
- Bundle `ffmpeg-static` and `ffprobe-static` for all video work.
- Wrap each FFmpeg command in an IPC handler in `src/main/ipc/video.ts`.
- The renderer's Video Studio (`src/renderer/src/modules/video-studio/`) builds a queue of `ExportJobSpec`s, sends to the main process, gets per-job progress events back through `webContents.send`.
- Per-platform "preset" (YouTube 1920×1080, Reels 1080×1920, TikTok 1080×1920, X 1280×720, Facebook 1280×720) defined as a typed map in `presets.ts`.

**Notable patterns:**
- **All FFmpeg invocations are streamed**: `child_process.spawn(ffmpegPath, args)`, parse stderr for progress markers, never block the renderer.
- **Cropping math is centralized** in geometry helpers — same logic powers the live preview overlay AND the export command.
- **Filename templates** with `{source}_{clip}_{preset}` token expansion, persisted via electron-store.

---

## Stage 2 — Audio + Image Studios (Sprint 3-6)

**Audio Studio.** Built around a "chain" model: import audio (or extract from video), pick cleanup options (denoise / hum removal / de-ess / compressor / loudnorm / gain), preview waveform via wavesurfer.js, export to MP3/WAV/FLAC/AAC. Cut regions are drawn directly on the waveform.

**Two-pass loudnorm.** FFmpeg's `loudnorm` filter is most accurate when run twice: first pass measures, second pass applies with the measurements baked in. The chain logic at `src/main/audio/chain.ts` produces both filter strings; `src/main/audio/process.ts` runs them sequentially with progress events for each pass.

**Image Canvas.** Konva for the canvas surface. Tools: select / rect / ellipse / line / pencil. Layers. Templates for streamer thumbnails and overlays. Export to PNG/JPG with HiDPI scale.

**Cross-cutting decisions made here:**
- **Recent files** persisted per-bucket (video / audio / image) via electron-store.
- **Hotkey overlay** (`?` key) — a single component reads route-to-shortcut maps for context-aware help.
- **Tutorial system** — each studio has a JSON tutorial definition (`src/renderer/src/tutorials/`); the `Tutorial` component renders a step-by-step walkthrough, persisted as `tutorialSeen.<studio>`.

---

## Stage 3 — Reference Search + Mood Boards (Sprint 7-9)

**Goal:** Let users grab visual references without leaving imagii.

**Approach:** A renderer panel calls `window.api.search.images(query)`. Main process queries DuckDuckGo's undocumented image endpoint, filters thumbnails locally with strict SafeSearch, returns to the renderer. Saved references go into named "mood boards" stored as JSON under `%APPDATA%/imagii/moodboards/`. Hover an item, click "→ Canvas" — drops it into the Image Canvas at 40% opacity for tracing.

**Privacy decision:** the only feature that touches the network. Hard-coded SafeSearch on. No user data leaves the machine.

---

## Stage 4 — The streamer-focused refit (commit `14b9e9b`)

**Pivot:** original drafts had an AI image generation studio (Stable Diffusion via `sd.exe`). Dropped it — too heavy, too narrow. Replaced with:

- **Recording** — capture screen + mic to MP4, replacing OBS for simple uses.
- **Project IO** — save the entire workspace state (all clips, all panels, canvas) to a single `.imagii.json`. Open it later to resume exactly where you left off.
- **Custom export presets** — beyond the five defaults.

**Key architecture decision:** the project file format (`ImagiiProject` interface in `src/shared/workspace.ts`) became the canonical serialization for ALL studio state. Every store knows how to capture itself into the shape and apply itself from the shape. This pays off massively later (autosave, schema migrations, clip-kit SRT bundling).

---

## Stage 5 — Streamer ideation pack (commit `e6d2a43`)

**The 13-feature push.** Identified pain points small-audience streamers hit, then built features for each:

- **A1 Compilation panel** — concat clips with crossfades into a montage.
- **A2 Chat highlight reel** — paste a Twitch chat log, finds bursts in message density.
- **A3 Output preview** — live snapshot of what the chosen platform crop will look like.
- **A4 PiP composite** — overlay one video on another (e.g. webcam on screen).
- **B2 Hotkey overlay** — `?` for context-aware shortcuts.
- **B3 + B5 Auto-zoom + hype shake** — per-clip toggles, FFmpeg `zoompan` + jittered crop on export.
- **C4 Color grading** — per-clip brightness / contrast / saturation / temperature, baked into export.
- **D1 Title pattern suggester** — 8 templates with random verb/subject/game banks.
- **D2 + D3 Posting checklist + diary** — log clips, manually track views/likes/comments.
- **E1 Recent files**, **E2 Filename templates** — quality-of-life persistence.

Each feature is a focused component (`HighlightPanel`, `ChatHighlightPanel`, etc.) that talks to either an existing store or a small new IPC handler.

---

## Stage 6 — Crash-safe autosave (commit `4f36693`)

**Problem:** users lose work to a crash or force-quit. The manual "save project" button isn't enough.

**Solution:** layered guard rails.

1. **Atomic write protocol** in `src/main/autosave.ts`:
   - Write `<userdata>/autosave/autosave.tmp`.
   - `fsync` the temp file to disk.
   - Copy current `autosave.json` → `autosave.prev.json` (one-deep rolling backup).
   - Atomic rename `.tmp` over `autosave.json`.
   - At any crash point, the prior file is intact; rename is atomic; `.prev` is the recovery vector.

2. **Validation** in `src/shared/projectValidation.ts`:
   - Schema version check.
   - Type-shape verification of every field.
   - 50 MB hard cap.
   - JSON parse errors caught — never throws.

3. **Renderer-side guards** in `src/renderer/src/hooks/useAutosave.ts`:
   - Subscribe to all three studio stores.
   - 5-second debounce, 5-second minimum interval.
   - Hash check — never re-write identical state.
   - Suppress flag during project load so we don't capture half-loaded state.
   - Silent failure path — autosave NEVER throws into render.

4. **Restore UX** (`AutosaveRestore.tsx`):
   - On launch, if a fresh autosave exists, show "imagii autosaved your work N minutes ago — Restore?"
   - 7-day staleness threshold.
   - Validation failure → corruption notice (not a restore prompt).

**28 tests** covered the validation + atomic-write paths.

---

## Stage 7 — The Power of Ten governance round (Phase 1)

**The pivotal decision:** adopted Holzmann's NASA "Power of Ten" rules for safety-critical software, translated into TypeScript / Electron terms. Bible for the project going forward.

**Phase 1A** — `src/shared/assert.ts`. `assert(cond, msg): asserts cond` and `assertDefined<T>(v, name): T`. Throws in dev, warns in prod. Used in place of `!` non-null assertions everywhere new code is written.

**Phase 1B** — IPC parameter validation. Built `src/shared/validators.ts` (`assertNonEmptyString`, `assertFiniteNonNeg`, `assertRange`, `assertEnum`, `assertPlainObject`, `assertArray`). Wired into every IPC handler so untrusted input from the renderer is validated at the boundary.

**Phase 1C** — strict TS flags. Enabled `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`. Fixed every resulting error — usually by replacing `arr[i]!` with `assertDefined(arr[i], '...')`. Split into a node-side commit and a renderer-side commit so each landed green individually.

**Lesson learned:** strict flags are best enabled *project-wide* in one tsconfig change, fixed across all callsites in the same commit. Half-and-half states are painful.

---

## Stage 8 — Verified bug fixes (Phase 2)

**Process:** spawned an explorer agent to scan for bugs, verified each finding by reading the actual source (the agent surfaced 25 candidates; ~7 were real). Fixed:

- **Double-loudnorm with `matchLoudness`** — secondary track was being normalized twice.
- **`project:load` parsed without try/catch** — a corrupted file crashed the IPC.
- **`addClipFromRange` reversed range** — auto-highlight finder could produce negative-duration clips.
- **Whisper SRT parser fractional seconds** — `Number(m[4]) / 1000` was wrong for non-3-digit fractions.
- **AutosaveRestore finally ordering** — locked autosave for 1.5s on failure paths.

---

## Stage 9 — Polish features (Phase 3)

Built four "extend FOR_MIKE" items the market research called out:

- **3.1 Caption styling + standalone SRT** — `BurnInRequest` gained a `style` (font size / position / colors) and optional clip range. Trim-to-clip burn-in uses ffmpeg `-ss`/`-to` on input. Save SRT button always available when `srtPath` is set.
- **3.2 Sidechain ducking parameters UI** — replaced hardcoded `threshold=0.05:ratio=8:attack=20:release=400` with sliders. dBFS → linear conversion via `Math.pow(10, dB/20)`.
- **3.3 Parametric denoise** — added `'parametric'` to `DenoiseStrength`; new sliders for noise floor / reduction / sensitivity, mapped onto FFmpeg's `afftdn` filter.
- **3.4 Safe-zone export warning** — pre-export check: when multiple platforms are selected, does each platform's centered crop preserve the others' safe zones? If not, modal lists affected pairs with "Continue anyway" / "Cancel".

---

## Stage 10 — Market research → Phase 4

**The pivot point.** Rather than guess what to build next, ran a structured market research process targeting Twitch-first streamers (0–10K audience). Created a reusable `market-researcher` agent. Two parallel agents: one inventoried imagii's features, the other researched competitors (StreamLadder, Eklipse, OpusClip, CapCut, Adobe Podcast Enhance, Buffer) and pain points.

**Decisive insight:** the market is moving toward AI clip detection in the cloud, but every viable option requires uploading VODs. imagii's local-first posture is a real wedge — but only if it closes the AI-detection gap.

**Five Phase 4 deliverables, each tied to a research finding:**

- **4A.1** — `ai-studio/` module renamed to `references/`. The directory name was misleading (AI gen had been removed); URL `/ai-art` and settings key `tutorialSeen.ai` kept for backward compat.
- **4A.2** — Caption styling presets. Four named one-clicks: TikTok bold, Reels minimal, Subtle subtitle, Big-outline accessibility.
- **4A.3** — Line/Pencil tools moved behind a "+ More" disclosure. The primary toolbar now shows only Select / Rect / Ellipse — what 95% of streamer thumbnail work actually uses.
- **4B** — **Smart highlight scoring**. Combined audio peaks + chat density + Twitch-flavored hype-keyword detection (`POG`, `KEKW`, `LMAO`, `clip it`, etc.) into a unified ranked list with per-signal mini-bars. Each highlight shows *why* it scored, addressing the AI-clipper's monetization moat.
- **4C** — **First-3s hook indicator**. Single fast FFmpeg ebur128 pass on the opening of the selected clip. Green / amber / rose badge mapped to peak loudness thresholds. Heuristic-only; no ML.
- **4D** — **One-click "Clip Kit" export**. One button → all 5 platforms + 3 thumbnail JPGs in a named subfolder. Pure orchestration of existing capabilities.
- **4E** — **Whisper model auto-install**. Streams `ggml-base.en.bin` (~141 MB) from Hugging Face with progress bar + cancel button + size-bound verification.

---

## Stage 11 — Tech-debt cleanup rounds

Two structured rounds. Each item: small, independent, committed separately for clean bisection.

**Round 1** (commits `d643dc3`, `453a127`, `37e1538`):
- HookIndicator FFmpeg cancellation — kill prior in-flight process when a new clip is selected.
- Whisper install cancellation — abort the in-flight request, clean up the `.partial`.
- Clip Kit per-file name sanitization — shared helper used by both subdirectory + leaf names.
- **`srtPath` promotion to schema v2** — biggest one. Added migration path (`migrateV1ToV2`), updated validator to accept both versions, threaded `srtPath` through videoStore + ProjectIO + Clip Kit (which now bundles the SRT).

**Round 2** (`9c438dd`):
- Tempdir cleanup on app start — prunes `imagii-audio/` and `imagii-concat/` of files older than 6 hours.
- Removed dead code in ProjectIO.
- Added videoStore.srtPath test coverage.
- `installProgress` reset on completion.
- Removed deprecated `SUPPORTED_SCHEMA_VERSION` alias.

---

## Stage 12 — Bug fix rounds

Two rounds catching bugs surfaced after the feature work:

**Round 1** (`e111001`):
- Stale captions panel after loading a new video.
- `installWhisperModel` could resolve twice on overlapping error events.
- Path traversal in `captions:copySrtTo`.
- Chat-log keystroke lag — debounced.

**Round 2** (`7f4c260`) — temp-file leaks on failure paths:
- `runTranscribe` leaked the WAV (~100 MB+) on Whisper failure.
- `runConcat` leaked per-segment temp files on segment-encode failure.
- Both fixed with `try/finally`; segment paths pushed *before* the spawn so partial writes are tracked.

---

## What ships today

- **5 studios**: Record, Video, Audio, Image Canvas, References.
- **163 passing tests** across 14 test files covering autosave, validation, audio chain, highlights scoring, geometry, project schema migration, filename sanitization, tempdir cleanup, more.
- **Both typechecks clean** — `tsconfig.node.json` and `tsconfig.web.json`, both with full strict flags.
- **`dist/imagii-for-mike.exe`** — ~173 MB portable Windows binary, built via `npm run dist`.
- **Crash-safe autosave** with atomic write + rolling backup.
- **Power of Ten governance** applied to every new function.

## What's deliberately out of scope

- iPhone version — Apple Developer fee + Mac required; deferred. PWA path explored, dismissed (FFmpeg-static + Whisper don't run in browsers).
- Cross-studio export queue — per-studio queues already exist.
- Live audio cleanup — NVIDIA Broadcast / Krisp own that lane.
- Live overlays / alerts — StreamElements / Streamer.bot are entrenched.
- Twitch VOD URL import — needs ToS verification before code.

## The recurring patterns that made it work

1. **One-shot atomic features** — every commit lands a single end-to-end thing: typecheck clean, tests green, manual smoke verified.
2. **Power of Ten governance** — assertions everywhere, ≤60-line functions, bounded loops, no recursion, ≤1 chained property access.
3. **Schema migration over breaking changes** — when the project schema needed a new field (`srtPath`), the validator was extended to accept both versions and migrate older ones in-memory rather than forcing users to re-create projects.
4. **Renderer orchestrates, main process executes** — multi-step user actions (Clip Kit) are orchestrated in the renderer with multiple IPC calls, not as one giant main-process function. Easier to cancel, easier to surface progress.
5. **Local-first as a wedge** — every feature stays on-device unless it has to. Privacy as a competitive advantage, not just a stance.
6. **Cost discipline** — no paid services, no subscriptions, no cloud. The user can run imagii with $0 of running cost.

---

*Generated 2026-05-09 from the imagii commit log + handoff docs at `~/.claude/projects/.../memory/`.*
