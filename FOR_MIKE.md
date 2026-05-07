# imagii — for Mike

A creative studio built for you. Free, runs on your computer, no accounts, no subscriptions.

## How to run it

1. Double-click `imagii-for-mike.exe`.
2. Windows SmartScreen will warn you ("Windows protected your PC"). Click **More info** → **Run anyway**. This is normal for unsigned apps; the file is safe.
3. Read the welcome (yes, it says hi to you), then click "Let's go →".

That's it. Everything's local — no install, no setup. Run it from anywhere on your machine.

## What's inside

### 🔴 Record
Capture screen + window + mic + (preview-only) webcam straight to MP4. Replaces the OBS dependency for simple recordings — pick a screen or window, optionally a microphone, hit ● Start.

### 🎬 Video Studio
Drag a video in, trim it, export for **YouTube / Reels / TikTok / X / Facebook**. Each platform gets the right aspect ratio and resolution automatically. Multiple clips per source, batch export, crop overlay with snap-to-aspect, watermark with your @handle, text overlays.

Plus, in the side panels:
- **Output preview** — live snapshot of what the chosen platform crop looks like
- **Auto-highlight finder** — finds loud moments in a long VOD and offers them as clip ranges
- **Chat highlight reel** — paste a Twitch chat log, finds bursts in message density
- **Auto-reframe to 9:16** — one-click vertical export from horizontal source
- **GIF export** — width / fps / speed selectors for the trimmed range
- **Compile clips** — stitch your clip list into one montage MP4 with crossfades
- **Picture-in-picture composite** — overlay one video on another (e.g. webcam on screen)
- **Auto-captions** — Whisper-based transcription, save SRT or burn into video (needs whisper.exe install)
- **Color & motion** — per-clip brightness / contrast / saturation / temperature, plus auto-zoom and hype-shake toggles
- **Posting helpers** — title pattern suggester, hashtag packs, posting log + performance diary

Hotkeys: `Space` play/pause · `← →` nudge 0.1s · `, .` frame-step · `I O` set in/out · `?` show shortcut overlay

### 🎚 Audio Studio
Import an audio file, or extract audio from any video. One-click denoise (light/medium/aggressive), 60 Hz hum removal, de-essing, voice/music/mixed compressor presets, two-pass loudnorm to podcast-standard −16 LUFS. Drag on the waveform to mark cuts. Live volume meter so you can see clipping. Save/load named cleanup presets ("My USB mic"). Add a second track for background music with sidechain ducking, or mix in a co-host's mic. Export MP3/WAV/FLAC/AAC, or re-attach cleaned audio to the original video.

The Video Studio has a **🎚 Clean audio** button that pipes a clip through here automatically.

### 🖼 Image Canvas
Paste / drop / import images. Layers, exact-degree rotation (15/30/45/90/180/270 presets, or type any number). Streamer templates for YouTube thumbnails and Twitch overlay frames with a webcam hole. Grid + snap. Drawing tools: rectangle, ellipse, line, freehand. Export PNG / JPG with HiDPI scale.

Hotkeys: `V R O L P` tools · `Ctrl+Z` undo · `Ctrl+Y` redo · `Delete` remove layer

### ✨ References
DuckDuckGo image search with strict SafeSearch. Save references to local mood boards. Hover any saved item and click **→ Canvas** to drop it as a 40%-opacity reference layer in the Image Canvas (great for tracing or composition).

## Project save / load + crash-safe autosave

- Top-right of the home screen: **💾 Save project** writes a `.imagii.json` snapshot of every studio's state. **📂 Open project** restores it.
- Autosave runs in the background while you work. If imagii crashes or you force-quit mid-edit, the next launch shows a banner: *"imagii autosaved your work N minutes ago — Restore?"*. Click Restore and you're back where you left off.
- Autosave uses an atomic write protocol with a rolling backup file, so even a corrupted primary file recovers from the previous version.

## Tutorials

Every studio auto-runs a guided tour the first time you visit. Skippable with **Esc**. Replay anytime by clicking the **?** button in the studio header.

Press **?** anywhere in the app for a context-aware keyboard shortcut overlay.

## Privacy

Everything runs on your computer. No telemetry, no analytics, no accounts. The only feature that touches the internet is reference image search (DuckDuckGo — they don't track). All your videos, audio, images, recordings, mood boards, and projects stay local.

App data lives at `%APPDATA%\imagii\`.

## Things that might happen

- **SmartScreen warning** — see install step 2
- **Antivirus might flag it** — unsigned Electron portables sometimes trip heuristics; the source code is fully readable in this folder if you want to verify
- **First launch is slow** — Electron unpacks the bundle to `%TEMP%`; subsequent launches are fast
- **Captions need a one-time install** — whisper.exe + a model file from whisper.cpp releases. The Captions panel walks you through it. Everything else works without that.

## Made by Makenah · enjoy! ❤️
