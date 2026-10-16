# imagii 

A creative studio built for you. Free, runs on your computer, no accounts, no subscriptions.

## How to run it

1. Double-click `imagii.exe`.
2. Windows SmartScreen will warn you ("Windows protected your PC"). Click **More info** → **Run anyway**. This is normal for unsigned apps; the file is safe.
3. Read the welcome (yes, it says hi to you), then click "Let's go →".

That's it. Everything's local — no install, no setup. Run it from anywhere on your machine.

## What's inside

### 🔴 Record
Capture a screen or window straight to MP4, with an optional microphone and webcam (the webcam is composited into a corner you pick). Game and desktop sound are not captured — pick a screen or window, optionally a microphone, hit Start recording.

### 🎬 Video Studio
Drag a video in, trim it, export for **YouTube / Reels / TikTok / X / Facebook**. Each platform gets the right aspect ratio and resolution automatically. Multiple clips per source, batch export, crop overlay with snap-to-aspect, watermark with your @handle, text overlays.

Plus, in the side panels:
- **Output preview** — live snapshot of what the chosen platform crop looks like
- **Smart highlight finder** — finds loud moments in a long VOD and offers them as clip ranges
- **Chat spike finder** — paste a Twitch chat log, finds bursts in message density
- **Reframe to 9:16** — one-click vertical export from a horizontal source: a fixed strip you place Left, Center, or Right (it does not track faces or action)
- **GIF export** — width / fps / speed selectors for the trimmed range
- **Compile clips** — stitch your clip list into one montage MP4; **Fade between clips** dips each cut to black and back (set it to 0 for hard cuts)
- **Picture-in-picture composite** — overlay one video on another (e.g. webcam on screen)
- **Auto-captions** — Whisper-based transcription, save SRT or burn into video (needs a one-time whisper-cli.exe install; English only)
- **Color & motion** — per-clip brightness / contrast / saturation / temperature, plus auto-zoom and hype-shake toggles
- **Posting helpers** — Title starters, hashtag packs, Posting log with view, like and comment counts

Hotkeys: `Space` play/pause · `← →` nudge 0.1 s · `, .` frame-step · `I O` set in/out · `?` show shortcut overlay

### 🎚 Audio Studio
Import an audio file, or extract audio from any video. One-click denoise (light/medium/aggressive), hum removal (60 Hz or 50 Hz mains), softer harsh 's' sounds, voice/music/mixed compressor presets, two-pass loudnorm to podcast-standard −16 LUFS. Drag on the waveform to mark cuts. Live volume meter so you can see clipping. Save/load named cleanup presets ("My USB mic"). Add a second track for background music with sidechain ducking, or mix in a co-host's mic. Export MP3/WAV/FLAC/AAC, or re-attach cleaned audio to the original video.

The Video Studio has a **🎚 Clean audio** button that pipes a video's audio through here automatically (the whole video's sound, not just the selected clip).

### 🖼 Stream Graphics
Paste / drop / import images. Layers, exact-degree rotation (15/30/45/90/180/270 presets, or type any number). Streamer templates for YouTube thumbnails and Twitch overlay frames with a webcam hole (the guides and placeholders show while you design and are left out of the export). Grid + snap. Drawing tools: rectangle, ellipse, line, freehand. Export PNG / JPG with HiDPI scale.

Hotkeys: `V R O L P` tools · `Ctrl+Z` undo · `Ctrl+Y` redo · `Delete` remove layer

### ✨ References
DuckDuckGo image search with strict SafeSearch. Save references to local mood boards. Hover any saved item and click **→ Canvas** to drop it as a 40%-opacity reference layer in Stream Graphics (great for tracing or composition).

## Project save / load + crash-safe autosave

- Top-right of the home screen: **💾 Save project** writes a `.imagii.json` snapshot of every studio's state. **📂 Open project** restores it.
- Autosave runs in the background while you work, and imagii takes one last snapshot as it closes. When it starts and finds an autosave (after a crash or a force-quit, and after a normal close too), it shows a banner: *"imagii autosaved your work N min ago. Want to pick up where you left off?"*, with **Restore**, **Clear** and **Later**. Click Restore and you're back where you left off.
- Autosave uses an atomic write protocol with a rolling backup file, so even a corrupted primary file recovers from the previous version.

## Tutorials

Video, Audio, Stream Graphics and References each have a short tour (Record does not). The first three open it the first time you load a video or audio file, or put something on the canvas, because there is nothing to point at on an empty studio; References opens it on your first visit. Skippable with **Esc**. Replay anytime by clicking the **?** button in the studio header.

Press **?** anywhere in the app for a context-aware keyboard shortcut overlay.

## Privacy

Everything runs on your computer. No telemetry, no analytics, no accounts. Only two things touch the internet: reference image search (DuckDuckGo) and the one-time caption model download. All your videos, audio, images, recordings, mood boards, and projects stay local.

App data lives at `%APPDATA%\imagii\`. The browser engine inside imagii keeps its own cache there too, and it can hold copies of images the search fetched; **Clear thumbnail cache** doesn't touch it, and deleting that folder clears everything imagii keeps there. Temporary working copies live in `%TEMP%` instead, in the folders `imagii-audio` (sound pulled out of a video), `imagii-import` (a converted video) and `imagii-concat` (a compile in progress); imagii deletes the ones older than 6 hours the next time it starts.

## Things that might happen

- **SmartScreen warning** — see install step 2
- **Antivirus might flag it** — unsigned Electron portables sometimes trip heuristics; the source code is fully readable in this folder if you want to verify
- **Every launch is slow** — the portable .exe unpacks the bundle to `%TEMP%` each time you start it (10–15 seconds with no window); wait for it
- **Captions need a one-time install** — you download whisper-cli.exe from the whisper.cpp releases once; imagii downloads the English model for you (that download goes online, once). The Captions panel walks you through it. Everything else works without that.

## Made by Makenah · enjoy! ❤️
