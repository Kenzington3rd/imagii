# imagii — for Mike

A creative studio built for you. Free, runs on your computer, no accounts, no subscriptions.

## How to run it

1. Double-click `imagii-for-mike.exe`.
2. Windows SmartScreen will warn you ("Windows protected your PC"). Click **More info** → **Run anyway**. This is normal for unsigned apps; the file is safe.
3. Confirm you're 18+ on the gate, then read the welcome (yes, it says hi to you).

That's it. Everything's local — no install, no setup. Run it from anywhere on your machine.

## What's inside

### 🎬 Video Studio
Drag a video in, trim it, export for **YouTube / Reels / TikTok / X / Facebook**. Each platform gets the right aspect ratio and resolution automatically. Multiple clips per source, batch export, crop overlay with snap-to-aspect, text overlays.

Hotkeys: `Space` play/pause · `← →` nudge 0.1s · `, .` frame-step · `I O` set in/out

### 🎚 Audio Studio
Import an audio file, or extract audio from any video. One-click denoise (light/medium/aggressive), 60 Hz hum removal, de-essing, voice/music/mixed compressor presets, two-pass loudnorm to podcast-standard −16 LUFS. Drag on the waveform to mark cuts. Export MP3/WAV/FLAC/AAC, or re-attach cleaned audio to the original video.

The Video Studio has a **🎚 Clean audio** button that pipes a clip through here automatically.

### 🖼 Image Canvas
Paste / drop / import images. Layers, exact-degree rotation (15/30/45/90/180/270 presets, or type any number). Color picker tool (`C`) lets you click a color in an image and replace all similar pixels with a tolerance slider. Grid + ruler guides + snap. Drawing tools: rectangle, ellipse, line, freehand. Export PNG / JPG / SVG / **PDF** with DPI selection.

Hotkeys: `V R O L P C` tools · `Ctrl+Z` undo · `Ctrl+Y` redo · `Delete` remove layer

### ✨ AI Art (5 tabs)
- **Generate** — text-to-image with Stable Diffusion (1–4 variations, seed control)
- **Expand (Outpaint)** — pick a base image, choose a direction, describe what to extend it with
- **Inpaint (Brush)** — paint over an area on a base image, describe what should replace it
- **Reference Search** — DuckDuckGo image search with strict SafeSearch + local NSFW screening on every thumbnail
- **Mood Boards** — save references locally; click → Canvas to drop them as 40%-opacity overlay layers in the Image Canvas

**The first three (AI generation) need two extra files** — see the Setup card inside the AI Art tab. The links and exact paths are right there. Reference search and mood boards work without any of that.

## Privacy

Everything runs on your computer. No telemetry, no analytics, no accounts. The only feature that touches the internet is the reference image search (DuckDuckGo — they don't track). All your videos, audio, images, and mood boards stay local.

App data lives at `%APPDATA%\imagii\`.

## Things that might happen

- **SmartScreen warning** — see install step 2
- **Antivirus might flag it** — unsigned Electron portables sometimes trip heuristics; the source code is fully readable in this folder if you want to verify
- **First launch is slow** — Electron unpacks the bundle to %TEMP%; subsequent launches are fast
- **AI generation needs ~10 GB free disk** — for the model download (only if you want AI features)

## Made by Makenah · enjoy! ❤️
