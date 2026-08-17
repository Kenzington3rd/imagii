# imagii — User Guide

How to use imagii. imagii runs entirely on your computer — no account,
no subscription, no internet required (except image search in
References). Everything you make is saved to your own disk.

Press **`?`** anywhere to see the keyboard shortcuts for the current
screen.

---

## Home

The Home screen has a card for each of the five studios. The top-right
controls:

- **Undo / Redo** — step back and forward through your recent actions
  across the whole app.
- **Open project / Save project** — a *project* (`.imagii.json`) saves
  the state of every studio at once. imagii also **autosaves** — if it
  finds a recent autosave on launch, it offers to pick up where you left
  off, and **Restore** takes you back to the studio you were in, with
  your selections and the playhead where you left them. Choosing
  **Later** or **Discard** starts a fresh session instead; nothing is
  restored unless you ask for it.

---

## Record

Capture your screen, a window, or your webcam to a single video file.

1. Click **Pick a screen or window** and choose a source.
2. Under **Audio**, choose whether to record your microphone.
3. Under **Webcam**, tick **Include webcam in recording** to composite
   your camera into the video as a picture-in-picture. Pick which
   corner it sits in.
4. Choose **Convert to MP4** (slower, plays everywhere) or untick it
   for instant WebM.
5. Click **Start recording**. Click **Stop** when done, then pick where
   to save.

Your webcam corner and your MP4 choice are remembered for next time.
If no screens or windows turn up, the panel says so — grant screen
recording permission for imagii, then click **Refresh sources**.

---

## Video Studio

Drop a video in (or use the file picker), then:

- **Trim** with the timeline — `Space` to play, `←/→` to nudge, `I`/`O`
  to set the in/out points.
- **Clips** — mark ranges and add them to the Clips list.
- **Export** — tick the platforms you post to (YouTube, Reels, TikTok,
  X, Facebook); each shows a green/yellow/red indicator predicting how
  well your clip fits there. Add a **watermark** to stamp your handle on
  every export — your handle and the corner you put it in are remembered
  for your next batch.
- **Clip Kit** — one click exports a clip for all five platforms plus
  thumbnails into a single folder.
- **Smart highlight finder** — scans the audio for loud, exciting
  moments and suggests clips.
- **Auto-reframe** — crops a clip to vertical 9:16 for TikTok / Reels.
- **Captions** — auto-transcribes speech and burns styled captions in.
  The first use downloads a transcription model (~141 MB, one time).
- **Color & motion**, **GIF export**, **compilation**, and
  **picture-in-picture** panels handle the rest.
- **Cancel any long render.** Reframe, GIF, Compile, PiP, highlight
  scan, and caption burn-in all show a **Cancel** button next to the
  progress bar while they're running. Click it to abort cleanly — the
  background ffmpeg/whisper process is killed and the panel returns to
  its idle state.
- **References — Mood Boards** has a **Clear thumbnail cache** button
  to drop the on-disk image cache when boards have grown large.

---

## Audio Studio

Drop in audio — or any video, and imagii extracts its audio.

- **Help me fix this** runs a short wizard that picks cleanup settings
  for you if you're not sure.
- Or set them yourself: **noise cleanup**, **levels**, **denoise**, and
  a **secondary track** you can duck under your main voice.
- Drag on the waveform to mark a region to cut; click a cut tag to undo
  it. `Ctrl+Z` / `Ctrl+Y` step through the cleanup chain.
- **Export** to MP3, WAV, FLAC, or AAC.

---

## Stream Graphics

Make thumbnails, Twitch overlays, banners, and emotes on a canvas.

1. Start from a **template** — presets are grouped by type and offered
   in 1080p, 2K, and 4K sizes — or start blank / import your own image.
2. Edit with the toolbar: **Select**, **Rectangle**, **Ellipse**, and
   (under **+ More**) **Line** and **Pencil**. Keyboard: `V R O L P`.
3. Use the **Layers** panel to reorder, hide, lock, duplicate, and
   delete. The **Properties** panel edits the selected layer.
4. **Export** as PNG or JPG. On a high-DPI monitor the export scale
   defaults to match what you see; bump it manually for extra sharpness.

---

## References

Gather inspiration and grab ready-made stream assets.

- **Reference Search** — search images (SafeSearch is permanently on;
  thumbnails are screened locally). Click **Save** to add an image to a
  mood board.
- **Mood Boards** — your saved collections. Hover an item and send it
  to the Stream Graphics canvas as a reference layer.
- **Asset Library** — curated, free-to-use stream assets (overlay
  frames, lower thirds, scene cards, social cards). Click one to drop
  it straight into the Stream Graphics editor.

---

## Saving your work

- **Save project** writes a `.imagii.json` you can reopen later.
- **Autosave** runs in the background, and imagii takes one final
  snapshot as it closes, so the last few seconds of work are in it too.
  On the next launch it offers to restore that session — route,
  selections and playhead included. If the autosave file is damaged,
  imagii says so and offers to clear it rather than loading it.
- **The window remembers its size and position** between launches, and
  re-centres itself if the display it was on is no longer connected.
  That happens whatever you choose in the restore banner.
- Exports (videos, images, audio) are written wherever you choose in
  the save dialog — they are normal files on your disk.

---

This guide tracks the shipping product. If imagii's features change,
this document changes with them.
