# imagii

A free, local-first creative studio for Windows. One app, five studios:

- **🔴 Record** — capture screen + webcam + mic straight to MP4 (replaces OBS for simple recording)
- **🎬 Video Studio** — trim and clip video, export sized for YouTube, Reels, TikTok, X, or Facebook; auto-reframe, GIF export, captions, picture-in-picture, multi-clip compilation, chat-spike highlight finder
- **🎚 Audio Studio** — clean noise, normalize loudness, multi-track + ducking, save reusable cleanup presets
- **🖼 Image Canvas** — layered design with streamer templates for thumbnails and overlay frames
- **✨ References** — DuckDuckGo image search with strict SafeSearch + local mood boards that drag onto the canvas

Crash-safe autosave plus full project save / load. No accounts, no subscriptions, no cloud uploads.

---

## System requirements

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 (64-bit) | Windows 11 |
| RAM | 8 GB | 16 GB |
| Disk | ~500 MB free | ~1 GB free if you also want auto-captions |
| GPU | Anything (no GPU required) | — |

**Hardware notes:**
- No GPU is required. The previous AI image-generation feature was removed in the refit; nothing in imagii now needs CUDA / VRAM.
- Auto-captions are optional and use [whisper.cpp](https://github.com/ggerganov/whisper.cpp). The captions panel inside Video Studio walks you through downloading `whisper.exe` and a small model file (~150 MB).

---

## Download & install

### Option 1: Use the prebuilt .exe (easiest)

1. **Get the file.** You should have received either `imagii-for-mike.exe` (~166 MB) on its own, or `for-mike.zip` (~165 MB) containing the .exe plus a quick-start text file.
2. **If it's a zip**, right-click → **Extract All…** to unzip it anywhere you like.
3. **Save the .exe anywhere on your computer.** Desktop, `Downloads`, `Documents` — wherever. There's no installer; the file *is* the app.
4. **Skip to "First launch" below.**

### Option 2: Build it yourself from source

```bash
# Prerequisites: Node.js v20+ from https://nodejs.org
git clone <this repo>
cd imagii
npm install
npm test           # 28 tests covering autosave validation + atomic write
npm run dist       # produces dist/imagii-for-mike.exe (~166 MB)
```

Output goes to `dist/`. The `.exe` is portable and runs from any folder.

---

## First launch

### 1. Double-click the .exe
First run is slower than later ones — Electron unpacks itself to `%TEMP%`. Give it 5–10 seconds.

### 2. Get past Windows SmartScreen
Because the .exe isn't code-signed (commercial signing certificates cost a couple hundred dollars per year), Windows will show a blue warning:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from starting.

**This is normal for unsigned apps.** Click **More info** then **Run anyway**.

### 3. Antivirus might briefly hold it
Some antivirus engines flag unsigned Electron apps the first time they see them. This is a generic heuristic. If your antivirus quarantines it, restore the file and add an exception.

### 4. Welcome screen
You'll see a personalized welcome the first time. Click "Let's go →" to enter the home screen.

### 5. Home screen
Five cards: **Record**, **Video Studio**, **Audio Studio**, **Image Canvas**, **References**. Plus 💾 **Save project** and 📂 **Open project** buttons in the header.

If imagii previously crashed or was force-quit mid-edit, you'll see a banner: *"imagii autosaved your work N minutes ago — Restore?"* — click it to pick up where you left off.

---

## Using the studios

### 🔴 Record
1. Click "Pick a screen or window" → choose from the live thumbnail grid.
2. Tick "Record microphone" and pick your input device. Optionally enable webcam preview.
3. Choose whether to convert to MP4 on save (slower; better compatibility) or keep WebM.
4. Click ● Start. Stop button appears in the header.
5. On stop, save the recording somewhere (skip the dialog to discard).

### 🎬 Video Studio
1. **Import.** Drop a video onto the window or click "Choose file…". Recent files dropdown remembers the last 10. Supports MP4, MOV, AVI, MKV, WEBM, M4V.
2. **Trim.** Drag the timeline handles, or hit `I` (in) / `O` (out) at the playhead.
3. **Optional: crop.** Tick "Crop" above the player to draw a box; pick an aspect ratio preset (16:9 / 9:16 / 1:1 / 4:5).
4. **Optional: enable safe-zones.** "Safe zones" toggle in the player overlays ghosted 9:16 / 1:1 / 4:5 rectangles so you can frame the action to survive future crops.
5. **Optional: per-clip color, speed, effects.** The Color & motion panel has brightness / contrast / saturation / temperature sliders plus auto-zoom and hype-shake toggles. The clip list has a speed slider (0.25× to 4×) per selected clip.
6. **Optional: text overlays + watermark.** Watermark field stamps your @handle on every export. Filename template controls how exports are named (tokens: `{source} {clip} {preset} {date} {time} {handle}`).
7. **Pick platforms.** Tick the platforms you want; success indicator shows green/yellow/red per platform.
8. **Click Export.** Sequential render with a progress bar; cancel any time.

The sidebar also has: Output preview, Auto-highlight finder (audio peaks), Chat-spike finder (paste a Twitch chat log), Auto-reframe to 9:16, GIF export, Compile clips into a montage, PiP composite (overlay video), Captions, Posting helpers (title patterns + hashtag packs + posting diary).

**Player hotkeys:** `Space` play/pause · `← →` nudge 0.1s · `, .` frame step · `I O` set in/out · `?` show all shortcuts

### 🎚 Audio Studio
1. **Import.** Drop an audio file (MP3, WAV, FLAC, AAC, M4A, OGG, OPUS) or any video file (audio is extracted automatically). Recent files dropdown.
2. **Cut regions (optional).** Drag on the waveform.
3. **Volume meter** sits below the waveform — turns red on clipping.
4. **Cleanup panel:** denoise strength (light/medium/aggressive), low rumble highpass, 60 Hz hum reduction, de-ess.
5. **Levels panel:** voice/music/mixed compressor preset, two-pass loudnorm, ±12 dB manual gain.
6. **Cleanup presets:** name and save your tuned chain ("My USB mic"), one-click re-apply next session.
7. **Add a second track** for background music with optional ducking, a co-host's mic, or game audio.
8. **Click Export.** MP3 / WAV / FLAC / AAC. If you imported audio from a video, you can re-attach the cleaned audio to a new MP4.

### 🖼 Image Canvas
1. **Import.** Drop an image, paste with `Ctrl+V`, or pick a file. Or click **✨ Templates** for pre-made YouTube thumbnails and Twitch overlay frames with a facecam hole.
2. **Tools:** `V` Select · `R` Rect · `O` Ellipse · `L` Line · `P` Pencil.
3. **Layers panel** for reorder / hide / lock / duplicate / delete.
4. **Grid** + snap-to-grid for alignment.
5. **Properties panel** for exact-degree rotation, opacity, fill/stroke, text editing.
6. **Export** PNG or JPG with HiDPI scale (0.5×–3×).

### ✨ References
- **Reference Search** — DuckDuckGo image search with strict SafeSearch hard-coded ON. Click ★ on any result to save to a mood board.
- **Mood Boards** — local JSON-persisted boards. Hover an item and click **→ Canvas** to drop it as a 40%-opacity reference layer in the Image Canvas.

---

## Project save / load + autosave

- **💾 Save project / 📂 Open project** in the home header serialize the entire workspace (all studios, all clips, all audio chain settings, the canvas) to a single `.imagii.json` file.
- **Autosave** runs every few seconds in the background while you work. It writes atomically (temp file → fsync → atomic rename) and keeps one rolling backup file. If the primary autosave gets corrupted, recovery falls through to the backup automatically.
- On launch, if a recent autosave exists you'll see a banner: *"imagii autosaved your work N minutes ago"* with **Restore / Discard / Later** buttons.
- 28 unit tests cover the validation + atomic-write paths (`npm test`).

---

## Troubleshooting

**"Windows protected your PC" warning** → Click "More info" then "Run anyway". This is the unsigned-app warning.

**Antivirus flagged the .exe** → Restore from quarantine and add a folder exception.

**Slow first launch (15+ seconds)** → Normal. Subsequent launches are 2–3 seconds.

**Video Studio won't import a file** → Check the codec (right-click → Properties). H.264, H.265, VP9, ProRes, AV1 in any common container should work. Some old AVI files use codecs FFmpeg can't decode.

**Audio export is slow** → If "Normalize to LUFS" is on, the app does a two-pass measure-then-apply. Turn it off for a faster single-pass export.

**Image canvas feels laggy with a huge image** → Images over 4096 px on a side may stall the canvas. The preview downsamples to 2048 px; very large originals still take memory.

**Captions panel says missing whisper** → Click the in-panel "open folder" buttons and follow the steps to drop `whisper.exe` and a `ggml-*.bin` model in place. Restart imagii.

**Reference search returns nothing** → DuckDuckGo's image endpoint is undocumented and occasionally rate-limits. Wait a minute.

**App data + autosave + projects live at `%APPDATA%\imagii\`.** To reset everything, delete that folder.

---

## Privacy

- **No telemetry, no analytics, no accounts.** The app makes zero network requests on startup.
- **The only feature that touches the internet is reference image search**, which queries DuckDuckGo (no tracking, no API key).
- **All your videos, audio, recordings, images, mood boards, and projects stay on your computer.**

---

## Tech stack

- Electron 31 + React 18 + TypeScript + Tailwind, packaged with electron-builder
- FFmpeg-static for all video and audio processing
- wavesurfer.js for audio waveform display
- Konva for image canvas
- Vitest for the autosave + validation test suite (28 tests)
- Zustand for state management

---

## License

MIT
