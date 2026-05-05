# imagii

A free, local-first creative studio for Windows. One app, four studios:

- **🎬 Video Studio** — trim and clip video, export sized for YouTube, Reels, TikTok, X, or Facebook
- **🎚 Audio Studio** — clean noise, normalize loudness, polish audio to podcast quality
- **🖼 Image Canvas** — manipulate images with layers, rotation, color replace, drawing tools
- **✨ AI Art** — generate, expand, and inpaint images with local Stable Diffusion · search reference images · build mood boards

Everything runs on your computer. No accounts. No subscriptions. No cloud uploads.

---

## System requirements

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 (64-bit) | Windows 11 |
| RAM | 8 GB | 16 GB |
| Disk | ~500 MB free for the app | ~12 GB free if you want AI features (model download) |
| GPU | Anything (Intel iGPU works for everything except AI) | NVIDIA with 4+ GB VRAM (for AI generation) |

---

## Download & install

### Option 1: Use the prebuilt .exe (easiest)

1. **Get the file.** You should have received either `imagii-for-mike.exe` (~227 MB) on its own, or `for-mike.zip` (~226 MB) containing the .exe plus a quick-start text file.
2. **If it's a zip**, right-click → **Extract All…** to unzip it anywhere you like.
3. **Save the .exe anywhere on your computer.** Desktop, `Downloads`, `Documents` — wherever. There's no installer; the file *is* the app.
4. **Skip to the "First launch" section below.**

### Option 2: Build it yourself from source

If you have the source code and want to build it:

```bash
# Prerequisites: Node.js v20+ from https://nodejs.org
git clone <this repo>
cd imagii
npm install
npm run dist       # produces dist/imagii-for-mike.exe (~227 MB)
```

The build downloads ~150 MB of Electron binaries on first run, then takes another minute or two to package. Output ends up in `dist/`. Copy the `.exe` somewhere convenient — it's portable and runs from any folder.

---

## First launch

### 1. Double-click the .exe

The first launch is slower than later ones — Electron unpacks itself to a temp folder. Give it 5–10 seconds.

### 2. Get past Windows SmartScreen

Because the .exe isn't code-signed (commercial signing certificates cost a couple hundred dollars per year), Windows will show a blue warning:

> **Windows protected your PC**  
> Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk.

**This is normal for unsigned apps.** To run it anyway:

1. Click the **More info** link (small text, at the top of the dialog)
2. A new button appears: **Run anyway**
3. Click that.

Windows will remember your choice for this file.

### 3. Antivirus might briefly hold it

Some antivirus engines (Windows Defender, Norton, etc.) flag unsigned Electron apps the first time they see them. This is a generic heuristic, not a real detection. If your antivirus quarantines it, restore the file from quarantine and add an exception. The full source code is in this repo if you want to verify what it does.

### 4. Welcome screen

You'll see a personalized welcome the first time. Click "Let's go →" to enter the home screen.

### 5. Home screen

Four cards: Video Studio, Audio Studio, Image Canvas, AI Art. Click any of them to enter that studio.

---

## Using the studios

### 🎬 Video Studio

1. **Import.** Drop a video onto the window, or click "Choose file…". Supports MP4, MOV, AVI, MKV, WEBM, M4V.
2. **Trim.** Drag the handles on the timeline, or move the playhead and press `I` (in-point) and `O` (out-point).
3. **Crop (optional).** Tick the "Crop" checkbox above the player to draw a crop region. Pick an aspect ratio preset (16:9, 9:16, 1:1, 4:5) or drag freely.
4. **Add text overlays (optional).** Use the "Text overlays" panel on the right.
5. **Pick platforms.** Tick the platforms you want to export for. Each shows a green/yellow/red indicator predicting how well your clip will perform on that platform.
6. **Choose an output folder.** Click "Choose folder…".
7. **Click Export.** All selected platforms get encoded sequentially with a progress bar. "Show" reveals each output in Explorer when it's done.

**Player hotkeys:** `Space` play/pause · `← →` nudge 0.1s · `, .` frame-by-frame step · `I O` set in/out

### 🎚 Audio Studio

1. **Import.** Drop an audio file (MP3, WAV, FLAC, AAC, M4A, OGG, OPUS) or any video file (audio is extracted automatically).
2. **Cut regions (optional).** Drag on the waveform to mark regions to cut. Click a cut tag below the waveform to undo it.
3. **Cleanup panel:**
   - **Denoise strength** — light (subtle hiss), medium (room tone), aggressive (HVAC noise)
   - **Remove low rumble** — highpass filter for handling/wind/AC rumble
   - **Reduce 60 Hz hum** — for power-line buzz from cheap cables
   - **De-ess sibilance** — softens harsh "s" sounds
4. **Levels panel:**
   - **Compressor preset** — voice / music / mixed
   - **Normalize to LUFS** — −16 is the podcast standard; −14 for streaming
   - **Manual gain** — slider for ±12 dB tweaks
5. **Click Export.** Choose format (MP3 / WAV / FLAC / AAC) and bitrate. If you imported audio from a video, you can re-attach the cleaned audio to the original video as a new MP4.

The Video Studio has a **🎚 Clean audio** button on each clip that pipes its audio through here automatically and routes you back when done.

### 🖼 Image Canvas

1. **Import.** Drop an image, paste from clipboard with `Ctrl+V`, or click "Choose file…". PNG, JPG, BMP, SVG, WEBP, GIF.
2. **Layers.** Each thing you import or draw becomes a layer. Use the right panel to reorder, hide, lock, duplicate, delete.
3. **Tools (toolbar at top, or keyboard shortcut):**
   - `V` Select / move / resize / rotate
   - `R` Rectangle
   - `O` Ellipse
   - `L` Line
   - `P` Pencil (freehand)
   - `C` Color replace — click on an image layer to pick a color, then choose replacement color and tolerance
4. **Grid + guides.** Turn on the grid for visual alignment. Click "⎯ Guide" or "❘ Guide" to add draggable rulers. Double-click a guide to remove it.
5. **Export (bottom of canvas).**
   - **PNG / JPG** — pick scale (0.5×–3×) for HiDPI exports
   - **SVG** — vector for primitives, embedded data URLs for raster images
   - **PDF** — pick DPI (72/150/300/600); shows resulting print size in inches

**Hotkeys:** `Ctrl+Z` undo · `Ctrl+Y` redo · `Delete` remove selected layer

### ✨ AI Art

This tab has five sub-tabs. **The first three (Generate, Expand, Inpaint) need extra files installed.** See the Setup card at the top of the AI tab.

#### Reference Search & Mood Boards (work without any extra setup)

- **Reference Search** — image search via DuckDuckGo. SafeSearch is hardcoded on. Every thumbnail is screened locally before display.
- **Mood Boards** — click ★ on a search result to save it. Boards persist locally at `%APPDATA%\imagii\moodboards\`. Hover an item and click **→ Canvas** to add it to the Image Canvas as a 40%-opacity reference layer (great for tracing or composition reference).

#### AI Generation (optional setup required)

The Generate, Expand, and Inpaint tabs use [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) running locally on your GPU. To enable them:

1. Open the AI Art tab. The yellow "Setup" card at the top shows what's installed and what's missing.
2. **Download `sd.exe`** from [stable-diffusion.cpp releases](https://github.com/leejet/stable-diffusion.cpp/releases). For NVIDIA GPUs, pick the CUDA build (look for `cuda` in the filename). It's about 15 MB.
3. Place it at the path the Setup card shows — typically `<imagii install folder>\resources\bin\sd.exe`. The card has an "Open this folder" button that takes you there.
4. **Download `v1-5-pruned-emaonly.safetensors`** from [Hugging Face](https://huggingface.co/runwayml/stable-diffusion-v1-5/blob/main/v1-5-pruned-emaonly.safetensors). This is the AI model — about 4 GB. (The card mentions ~2 GB; that's the smaller fp16 version which is fine if you can find it.)
5. Place the model at `%APPDATA%\imagii\models\v1-5-pruned-emaonly.safetensors`. The card's "Open models folder" button takes you there.
6. (Optional but recommended) Download a **NudeNet ONNX** model from [NudeNet releases](https://github.com/notAI-tech/NudeNet) and place it at `<imagii>\resources\bin\nudenet.onnx`. This enables NSFW screening of generated images. About 80 MB.
7. **Restart imagii.** The Setup card should now show all three rows in green, and the Generate / Expand / Inpaint tabs become functional.

**Generate** tab — text-to-image. Type a prompt, set parameters, get 1–4 variations.

**Expand** tab — pick a base image, pick a direction (up/down/left/right), describe what should fill the new area. AI fills in matching content.

**Inpaint** tab — pick a base image, paint over an area you want to replace, describe what should be there instead.

All AI outputs pass through NudeNet (if installed) before being shown. Filtered images appear as a "🛡 Filtered: <reason>" placeholder instead of the raw image.

---

## Troubleshooting

**"Windows protected your PC" warning** → Click "More info" then "Run anyway". This is the unsigned-app warning, not a real detection.

**Antivirus flagged the .exe** → Restore from quarantine and add a folder exception. If you're not comfortable with that, the source code is fully readable in this repo and you can build it yourself.

**Slow first launch (15+ seconds)** → Normal. Electron unpacks itself to `%TEMP%` on first run; subsequent launches are 2–3 seconds.

**Video Studio won't import a file** → Check the file's actual codec (right-click → Properties). H.264, H.265, VP9, ProRes, and AV1 in any common container should all work. Some old AVI files use codecs FFmpeg can't decode.

**Audio export is slow** → If you turned on "Normalize to LUFS", the app does two passes through your audio (one to measure, one to apply). That's correct behavior, just slow on long files. Turn it off for a faster single-pass export.

**Image canvas feels laggy with a huge image** → Images over 4096 px on a side may stall the canvas. The app downscales the canvas preview to 2048 px for performance, but very large source images still take memory.

**AI Art Setup card says missing** → Double-check the exact paths the card shows. Windows hides file extensions by default — make sure the file is `sd.exe` and not `sd.exe.exe`. Same for `nudenet.onnx`.

**AI generation fails with OOM error** → Lower the resolution to 512×512 or reduce steps. 4 GB VRAM is tight for inpaint at higher resolutions.

**Reference search returns nothing** → DuckDuckGo's image endpoint is undocumented and occasionally rate-limits. Wait a minute and try again. If it stays broken, the search-provider adapter pattern in the code makes it easy to swap in a different backend.

**App data lives at `%APPDATA%\imagii\`.** To reset everything (mood boards, age gate, welcome status), delete that folder.

---

## Privacy

- **No telemetry, no analytics, no accounts.** The app makes zero network requests on startup.
- **The only feature that touches the internet is reference image search**, which queries DuckDuckGo (they don't track searches, no API key needed).
- **All your videos, audio, images, AI generations, and mood boards stay on your computer.**
- **Models you download for AI** stay in `%APPDATA%\imagii\models\` and never leave your machine.

---

## Tech stack (for the curious)

- Electron 31 + React 18 + TypeScript + Tailwind, packaged with electron-builder
- FFmpeg-static for video and audio processing
- wavesurfer.js for audio waveform display
- Konva for image canvas
- pdf-lib for PDF export
- onnxruntime-node + sharp for NSFW screening
- stable-diffusion.cpp as the AI generation sidecar
- Zustand for state management

---

## License

MIT
