# imagii — Product Guide

What imagii is, who it's for, and the principles that decide what gets
built. This is the orientation document for anyone — human or agent —
working on the product. End-user instructions are in `USER_GUIDE.md`.

---

## In one line

A free, local-first creative studio for streamers — record, clip,
clean audio, make stream graphics, and gather references, all on your
own computer.

---

## Who it's for

Twitch / YouTube / TikTok creators who need a working toolset without a
subscription stack. The reference user is a solo streamer on a Windows
PC who wants to capture a stream, cut clips for socials, fix the audio,
and make a thumbnail — without OBS + a video editor + a paid graphics
tool + three accounts.

---

## The five studios

imagii is a `react-router` app; each studio is a route.

| Studio | Route | What it does |
|---|---|---|
| **Record** | `/record` | Capture screen + webcam + mic to one video. Webcam composites into the recording (picture-in-picture, user-chosen corner). Saves MP4 or WebM locally. |
| **Video Studio** | `/video` | Trim and clip video; export per-platform (YouTube, Reels, TikTok, X, Facebook). Smart highlight finder, chat-highlight reel, auto-reframe to 9:16, captions, color grading, GIF export, compilation, picture-in-picture, Clip Kit batch export. |
| **Audio Studio** | `/audio` | Clean noise, level volume, denoise, sidechain-duck a secondary track, and polish raw audio to podcast quality. A "fix wizard" picks settings for non-experts. |
| **Stream Graphics** | `/image` | A Konva canvas editor for thumbnails, Twitch overlays, banners, and emotes. Templates-first: pick a preset (1080p / 2K / 4K), edit, export PNG/JPG. |
| **References** | `/references` | Search inspiration (DuckDuckGo image search, SafeSearch locked on), save mood boards, and drop a curated CC0 stream asset straight onto the Stream Graphics canvas. |

A **project** (`.imagii.json`) captures the full state of every studio
and round-trips through Save / Open and autosave.

---

## Principles — what decides what gets built

1. **$0 to the user, forever.** No paid services, no subscriptions, no
   cloud spend. If a feature would cost money to run, it doesn't ship.
2. **Local-first.** Everything runs on the user's machine. No accounts,
   no telemetry, no upload. FFmpeg and Whisper.cpp run as local
   sidecars.
3. **Streamer-shaped.** Features, presets, and defaults target the
   streaming workflow. Generic "image editor" features lose to
   "thumbnail maker" features.
4. **Works clean, runs smooth, well tested.** Correctness over feature
   count. Every fixed bug gets a regression test and a
   `LESSONS_LEARNED.md` entry.
5. **Governed code.** The Power of Ten rules apply to every new
   function and every diff (see `STYLE_GUIDE.md`).
6. **Resolution-aware.** The app is usable and sharp on 1080p, 1440p,
   and 4K displays (see `DESIGN_GUIDE.md`).

---

## Architecture at a glance

- **Electron** — `src/main` (Node, privileged) + `src/renderer` (React
  UI) + `src/preload` (the bridge). `src/shared` is the typed code both
  sides import.
- **State** — Zustand stores per studio; `electron-store` for settings.
- **Media** — `ffmpeg-static` / `ffprobe-static` for video/audio;
  Whisper.cpp for transcription (model auto-installed on first use).
- **Canvas** — Konva (`react-konva`) for Stream Graphics.
- **Build** — `electron-vite` + `electron-builder` → a portable Windows
  `.exe`.

---

## What's deliberately out of scope

- Cloud sync / accounts — contradicts local-first.
- Anything that costs per-use money to run.
- AI image *generation* — the References module is search + curated
  assets, not a generator.

---

## When this guide changes

A change in product direction, a new studio, or a dropped feature
updates this file in the **same commit**. `USER_GUIDE.md` and the
`README` must stay consistent with it.
