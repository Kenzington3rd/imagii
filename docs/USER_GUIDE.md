# imagii — User Guide

How to use imagii. imagii runs on your computer — no account, no
subscription, and no internet required, except for image search in
References and the one-time caption model download. Everything you make
is saved to your own disk.

Press **`?`** anywhere to see the keyboard shortcuts for the current
screen.

Each studio has a short tour. It opens the first time you load something
into the studio (not before — there is nothing to point at on an empty
one), and the **?** button in the studio's header replays it. **Skip**,
**Esc**, and **Done** all close it for good; it only points at what is on
screen, so it covers more once you have a video, audio file, or canvas
loaded.

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

Capture your screen or a window to a single video file, with your webcam
and mic if you want them. Game and desktop sound are not captured.

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
- **Clips** — mark ranges and add them to the Clips list. Loading a
  video starts you with one clip spanning all of it ("Clip 1").
- **Crop** — tick **Crop** above the player and draw a box. Your crop
  becomes the picture: each platform you export to takes a centered cut
  of it in that platform's own shape, so nothing is ever stretched. A
  tall crop on a wide platform (or the reverse) loses its edges, and the
  export tells you so before it starts.
- **Export** — tick the platforms you post to (YouTube, Reels, TikTok,
  X, Facebook); each shows a green/yellow/red indicator predicting how
  well your clip fits there. A red one says why — **Wrong shape** or
  **Too long** — and the reason is printed on the card. The button says
  how many files it will write ("Export 3 files"). Add a **watermark**
  to stamp your handle on the batch export — your handle and the corner
  you put it in are remembered for your next batch. GIF, reframe,
  compilation and picture-in-picture don't take one.
- **Clip Kit** — one click exports a clip for all five platforms plus
  thumbnails into a single folder. It stamps the watermark you last
  exported with, and asks once before it starts if the clip is longer
  than a platform's typical limit (it never asks about cropping: each
  platform takes a centered cut of your picture).
- **Smart highlight finder** — scans the audio for loud, exciting
  moments and suggests clips. The first highlight you add replaces the
  untouched whole-video "Clip 1" (so Export doesn't re-encode your whole
  VOD beside your excerpts); `Ctrl+Z` brings it back. The chat-spike
  finder works the same way.
- **Reframe to 9:16 (center crop)** — cuts a vertical 9:16 strip for
  TikTok, Reels, and Shorts. Pick **Left**, **Center**, or **Right**; it
  doesn't track faces or action.
- **Captions** — auto-transcribes speech and burns styled captions in.
  The first use downloads a transcription model (~141 MB, one time).
- **Color & motion**, **GIF export**, **compilation**, and
  **picture-in-picture** panels handle the rest.
- **Cancel any long render.** Reframe, GIF, Compile, PiP, highlight
  scan, and caption burn-in all show a **Cancel** button next to the
  progress bar while they're running. Click it to abort cleanly — the
  background ffmpeg/whisper process is killed, the panel returns to its
  idle state, and imagii says the job was canceled (a plain note, never a
  red error). In an Export batch, files that already finished stay in your
  folder and the rows that didn't are marked **Canceled**.
- **When something fails,** the message says what happened and what to
  try, in plain words — and an Export row that didn't finish is marked
  **Failed**, so you can still see which one after the message fades.
- **Open project** with a video or audio file that has moved: imagii
  opens everything else in the project and names the missing file, so you
  can load it again in its studio.
- **References — Mood Boards** has a **Clear thumbnail cache** button
  to drop the on-disk image cache immediately. Your boards keep every
  item: a cleared thumbnail loads again from its source the next time
  you open the board. imagii also tidies the cache at each launch, but
  only ever removes images no board still uses.

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

- **Reference Search** — search images. SafeSearch is always on
  (strict): DuckDuckGo does the filtering, and imagii doesn't scan images
  itself. It is the one feature that goes online. Click **Save** to add
  an image to a mood board.
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
