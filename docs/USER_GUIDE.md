# imagii — User Guide

How to use imagii. imagii runs on your computer, with no account and no
subscription. Two features go online: **Reference Search** (in References)
and the **one-time caption model download**. Everything else works offline,
and everything you make is saved to your own disk.

Press **`?`** to see the keyboard shortcuts for the screen you are on. It
does nothing while you are typing in a text box.

---

## First launch

- **Windows 10 or 11, 64-bit.** imagii is a Windows app, about 170 MB.
- **Download `imagii.exe`.** On the release page, use the **Assets** list.
  Do not use **Source code (zip)**; that is the source, not the app.
- **The first launch is slow.** For 10 to 15 seconds after you double-click,
  no window appears while imagii unpacks itself. Wait for it.
- **SmartScreen.** The file is not signed, so Windows says "Windows protected
  your PC". Click **More info**, then **Run anyway**.
- **Antivirus.** If your antivirus quarantines `imagii.exe`, restore it and
  allow it.
- **Where your data lives.** Settings, autosaves, mood boards and the caption
  model are kept in `%APPDATA%\imagii`. Exports go wherever you choose (see
  **Saving your work**).

---

## Your first clip

The shortest path from a long recording to a posted clip.

1. **Open Video Studio** and drop a video in, or click **Choose file…**.
2. imagii makes one clip, **Clip 1**, that spans the whole video. If you scan
   for highlights and add one, the untouched whole-video clip steps aside, so
   Export does not re-encode the whole recording beside your excerpts.
3. **Trim** by dragging the two handles on the timeline. `I` and `O` set them
   at the playhead.
4. Under **Export**, check the platforms you want. A red mark says the clip
   does not fit that platform, and the card says why.
5. Click **Choose folder…** and pick where the files go. Export asks for a
   folder before it starts.
6. Click **Export N files**. imagii writes one file per checked platform for
   each clip in the list, and runs them all.
7. When a file is finished, click **Show in folder** beside it to open its folder with
   the file selected.

---

## What imagii does not do

- **No game or desktop audio.** A recording takes your screen or window, and
  your microphone and webcam if you check them. Game and desktop sound are not
  captured.
- **No face tracking.** Vertical reframing is a center crop: Left, Center, or
  Right. It does not follow faces or action.
- **English-only captions.** The caption engine is set up for English, and
  there is no language choice.
- **Projects store paths, not copies.** A `.imagii.json` project remembers
  where your video and audio files are; it does not contain them. If you move
  or delete a source, the project still opens, but imagii names the missing
  file and you load it again in its studio.

---

## Tours and shortcuts

Video, Audio, Stream Graphics and References each have a short tour. Record
does not. The first three open their tour the first time you load a video or
audio file, or put something on the canvas, because there is nothing to point
at on an empty studio. References opens its tour on your first visit. **Skip**,
**Esc**, and **Done** close a tour for good.

The round **?** button in a studio's header (its tooltip reads *Show tutorial*)
replays that studio's tour at any time. The **`?`** key is different: it opens
the list of keyboard shortcuts for the screen you are on. It does nothing while
you are typing in a text box or while another dialog is open.

---

## Home

The Home screen has a card for each of the five studios. The top-right
controls:

- **Undo / Redo** — step back and forward through your recent actions across
  the whole app.
- **Open project / Save project** — a *project* (`.imagii.json`) saves the
  state of every studio at once. imagii also **autosaves** — if it finds a
  recent autosave on launch, it offers to pick up where you left off, and
  **Restore** takes you back to the studio you were in, with your selections
  and the playhead where you left them. Choosing **Later** or **Clear**
  starts a fresh session instead; nothing is restored unless you ask for it.

---

## Record

Capture your screen or a window to a single video file, with your microphone
and webcam if you want them. Game and desktop sound are not captured.

1. Click **Pick a screen or window** and choose a source.
2. Under **Audio**, check **Record microphone** if you want your voice.
3. Under **Webcam**, check **Include webcam in recording (picture-in-picture)**,
   then pick the corner it sits in.
4. Under **Output**, leave **Convert to MP4 after recording** checked (slower,
   better compatibility), or uncheck it for an instant WebM, which some apps do
   not accept.
5. Click **Start recording**. Click **Stop** when you are done, then pick where
   to save. **Cancel** in the save dialog discards the take — the dialog's title
   says so. With **Convert to MP4** on, **Discard recording** stops the
   conversion; with it off, saving a WebM is a plain copy and there is nothing
   to stop.

Your webcam corner and your MP4 choice are remembered for next time. If no
screens or windows turn up, the panel says so — grant screen recording
permission for imagii, then click **Refresh sources**. **Refresh sources** also
re-checks your microphone and camera, each on its own, so a missing webcam never
hides your microphone. If one is missing, plug it in or allow its access in
Windows privacy settings, then click **Refresh sources** again.

---

## Video Studio

Drop a video in (or click **Choose file…**), then:

- **Trim** with the timeline. Drag the two handles, or press `I` and `O` to set
  the in and out points at the playhead. `Space` plays, and `←` / `→` nudge
  0.1 seconds.
- **Clips.** Loading a video starts you with **Clip 1**, which spans all of it.
  **+ Add clip** adds another clip that spans the whole video; trim it with the
  handles. Each clip has its own name, crop, platforms and text.
- **Crop** — check **Crop** above the player and draw a box. Your crop becomes
  the picture: each platform you export to takes a centered cut of it in that
  platform's own shape, so nothing is ever stretched. A tall crop on a wide
  platform (or the reverse) loses its edges, and the export tells you so before
  it starts. **Crop guides**, beside the player, draws the 9:16, 1:1 and 4:5
  shapes over the picture so you can see what each one keeps.
- **Export** — check the platforms you post to: **YouTube**, **Reels**,
  **TikTok**, **X / Twitter**, and **Facebook**. Each shows a green, yellow, or
  red mark predicting how well your clip fits there. A red one says why —
  **Wrong shape** or **Too long** — and the reason is printed on the card. The
  button says how many files it will write (**Export 3 files**). Every export
  is encoded at 30 fps (a custom preset uses its own frame rate), and each
  platform's card shows its size and rate (**1920×1080 · 30 fps**).
  Add a **watermark** by typing your handle in the **Watermark** field and
  choosing a corner. Your handle and corner are saved when you export, and they
  fill in again next time. GIF, reframe, compilation and picture-in-picture
  don't take one.
- **Clip Kit** — one click exports a clip for all five platforms plus three
  thumbnails into a single folder. It stamps the watermark you last exported
  with, and it asks once before it starts only if the clip is longer than a
  platform's typical limit. It never asks about cropping: each platform takes a
  centered cut of your picture.
- **Smart highlight finder** — **Scan VOD** scans the audio for loud, exciting
  moments and suggests clips. The first highlight you add replaces the
  untouched whole-video **Clip 1**, so Export doesn't re-encode your whole VOD
  beside your excerpts. **Ctrl+Z** brings it back.
- **Reframe to 9:16 (center crop)** — cuts a vertical 9:16 strip (1080×1920)
  for TikTok, Reels, and Shorts. Pick **Left**, **Center**, or **Right**. It
  doesn't track faces or action.
- **Captions** — transcribes the speech, then saves an `.srt` or burns styled
  captions into a new MP4. Captions are English only. They burn into the
  original video, not the platform exports. **Size** is a scale, not pixels:
  the readout beside it says how tall the text comes out on a 1080p video.
  Captions need a one-time setup; see **Captions setup** below.
- **Color & motion**, **Export as GIF**, **Compile clips**, and
  **Picture-in-picture composite** are the other panels. The player does not
  show color changes — they appear in the exported file. **Compile clips** is
  always there; with one clip it asks for a second.
- **Cancel any long render.** Reframe, GIF, Compile, PiP, highlight scan, and
  caption burn-in all show a **Cancel** button next to the progress bar while
  they're running. Click it to abort cleanly — the background ffmpeg/whisper
  process is killed, the panel returns to its idle state, and imagii says the
  job was canceled (a plain note, never a red error). In an Export batch, files
  that already finished stay in your folder and the rows that didn't are marked
  **Canceled**.
- **When something fails,** the message says what happened and what to try, in
  plain words — and an Export row that didn't finish is marked **Failed**, so
  you can still see which one after the message fades.
- **Open project** with a video or audio file that has moved: imagii opens
  everything else in the project and names the missing file, so you can load
  it again in its studio.

### Chat spike finder

Paste a Twitch chat log, one message per line in the form
`[mm:ss] user: message`, and click **Find chat spikes**. imagii counts messages
in short time windows (the **Spike window (s)** field) and lists the busiest
moments with the messages in them. **+ Clip** on a moment adds it as a clip named
**Chat spike N**, with **Extra seconds around each clip** on either side. Like
the Smart highlight finder, the first one you add replaces the untouched
whole-video **Clip 1**.

### Captions setup

Until the caption engine and model are in place, **Auto-captions** says
**Captions need setup**. You download the captions engine once; imagii
downloads the English model for you, and that download goes online, once. Both
steps are one-time:

1. Get `whisper-cli.exe` from the whisper.cpp releases page, and put it at the
   path the panel shows. The panel's **Open folder** button opens that folder.
   (The older name, `whisper.exe`, also works.) imagii does not download this
   file for you.
2. Click **Download model (~141 MB)**. imagii downloads the English model and
   keeps it. You can also fetch the model file yourself and put it at the model
   path the panel shows.

While it works, the panel shows the step it is on (extracting audio,
transcribing, building captions). Transcribing has no percentage — nobody can
know how long speech will take — so its bar slides instead of filling.

### Compile

**Compile clips** stitches every clip in the list, in list order, into one
1920×1080 MP4. Set **Fade** to blend neighboring clips with a crossfade (in
milliseconds), pick a folder, and click **Compile N clips**. **Cancel** stops it.

### Posting helpers

The posting helpers sit at the bottom of Video Studio, in three parts:

- **Title starters** — click **Title starters** for four title ideas built from
  a short list of patterns and verbs, such as *I clutched a boss fight so you
  don't have to*. Each one has a **Copy** button. The starters name no game;
  add yours yourself.
- **Hashtag pack** — choose a pack (for example *Twitch clip* or *TikTok,
  general*) and copy its hashtags.
- **Posting log** — type a clip name, check the platforms you posted it to
  (YouTube, Reels, TikTok, X, Twitch, or Discord), add notes, and click
  **+ Log post**. Each entry has **views**, **likes**, and **comments** boxes you
  fill in yourself, and a delete button that asks first. The log keeps the 100
  most recent entries. It is saved with
  your settings, not in a project file.

---

## Audio Studio

Drop in audio, or any video, and imagii extracts its audio.

- **Help me fix this** runs a short wizard that picks cleanup settings for you
  if you're not sure.
- Or set them yourself, panel by panel:
  - **Cleanup** — **Quieter background** (Off, Light, Medium, Aggressive, or
    Custom, where you tune the noise floor and reduction by hand), plus switches
    for removing low rumble (below 80 Hz), **Hum removal**, and softer harsh
    's' sounds. Hum removal follows your power grid: 60 Hz in the US and Canada,
    50 Hz in most other regions. Pick yours in the **Power-line frequency**
    list that appears when the box is checked.
  - **Levels** — the compressor preset, **Even volume** with a loudness target
    (pick talking and podcasts at −16, or YouTube, Spotify, TikTok and Reels at
    −14), and manual gain. imagii measures the whole file first, so exports
    with a loudness target take a little longer.
  - **Cleanup presets** — **Save current** keeps your cleanup settings (noise,
    levels and voice treatments) under a name, so you can apply or remove them
    later. Cuts and the second track belong to the recording, so they are not
    saved in a preset.
  - **Add a second track** — layer in background music, a co-host's mic, or game
    audio. **Duck under your voice** lowers it while you speak.
- The wizard's last card lists exactly the settings it is about to apply.
  **Start over** goes back to its first question; **Close** leaves it.
- Drag across the waveform to mark a part to remove. It comes out when you
  export; click a mark to put it back. `Ctrl+Z` / `Ctrl+Y` step back and
  forward through the cleanup chain.
- **Export** to MP3, WAV, FLAC, or AAC. AAC is saved as an `.m4a` file. From a
  video, **Re-attach to video** writes an `.mp4`; if you removed parts, the
  picture is re-encoded to match, which takes longer.

---

## Stream Graphics

Make thumbnails, Twitch overlays, banners, and emotes on a canvas.

1. Start from a **template**, or use **Or start blank**: **Import image** or
   **Start with text**. Templates are grouped as **Thumbnails** (1280×720, plus
   2K and 4K bold variants), **Stream overlays** (1920×1080, plus 2K and 4K),
   **Banners** (1200×480 for your Twitch channel page, and 2560×1440 for
   YouTube channel art), and **Emotes** (a 112×112 canvas). Guide layers such as
   the facecam hole, "Drop face here" and "@yourhandle" placeholders are tagged
   **hint — won't export** in the Layers panel: they show while you design and
   are left out of the file. Type your own words over a placeholder and they
   export.
2. Edit with the toolbar: **Select**, **Rectangle**, **Ellipse**, and (under
   **+ More**) **Line** and **Pencil**. Keyboard: `V` `R` `O` `L` `P`.
3. Use the **Layers** panel to move layers up and down, hide, lock, duplicate,
   and remove them. The **Properties** panel edits the selected layer.
4. **Export** as PNG or JPG. **Scale** sets how many pixels each pixel of your
   design becomes: 0.5×, 1×, 2×, or 3×, and **Output** beside it shows the size
   of the file in pixels (it adds a note when a 16:9 export is bigger than
   YouTube's 1280×720 thumbnail size). The export is the design itself, not
   your window, so 1× is the size you laid out. The scale starts at 2× on a
   high-DPI screen (3× on the densest ones) and at 1× otherwise. JPG adds a
   quality setting. An emote canvas exported as PNG writes the three-file Twitch
   pack, at 28, 56, and 112 px.
   Export opens a Save dialog (`imagii-<timestamp>.png` or `.jpg` is the
   suggested name), and imagii says "saved" only after the file is written; if
   you cancel the dialog, nothing is saved and nothing is announced. The emote
   pack and **Variants → Save all (3 + original)** ask for one folder instead
   and write all their files into it.

---

## References

Gather inspiration and grab ready-made stream assets. References has three tabs.

- **Reference Search** — search images. SafeSearch is always on (strict):
  DuckDuckGo does the filtering, and imagii doesn't scan images itself. Reference
  Search is one of the two features that go online; the other is the one-time
  caption model download. Hover a result and click **Save** to add it to the
  mood board you have selected. If you have no board yet, imagii asks you to
  name one first.
- **Mood Boards** — your saved collections. Hover an item and click **→ Canvas**
  to add it to the Stream Graphics canvas as a 40%-opacity reference layer. A
  reference is a guide only: it is tagged **reference — won't export** and is
  left out of exports.
  **Clear thumbnail cache** (on this tab) empties imagii's on-disk copy of the
  board thumbnails right away. Your boards keep every item: a cleared thumbnail
  loads again from its source the next time its board is shown. imagii also
  tidies the cache at each launch, but only removes thumbnails that no board
  still uses.
- **Asset Library** — curated, free-to-use stream assets: overlay frames, lower
  thirds, scene cards, and social cards. Click one to put it on the Stream
  Graphics canvas. Like a template, it replaces what is already on the canvas.

---

## Saving your work

- **Save project** writes a `.imagii.json` you can reopen later. It keeps the
  studios and their layout, and the file paths of your sources. Mood boards
  live outside projects.
- **Autosave** runs in the background, and imagii takes one final snapshot as
  it closes, so the last few seconds of work are in it too. On the next launch
  it offers to restore that session — route, selections and playhead included.
  If the autosave file is damaged, imagii says so and offers to clear it rather
  than loading it.
- **The window remembers its size and position** between launches, and
  re-centers itself if the display it was on is no longer connected. That
  happens whatever you choose in the restore banner.
- **Exports are normal files on your disk.** Video, GIF, compilation, reframe,
  and Clip Kit files go into the output folder you choose. Audio exports, caption
  files, burned-in videos, recordings, and projects ask where to save them.
  Stream Graphics images are the exception: they download without asking.

---

This guide tracks the shipping product. If imagii's features change, this
document changes with them.
