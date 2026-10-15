# imagii — User Guide

How to use imagii. imagii runs on your computer, with no account and no
subscription. Two features go online: **Reference Search** (in References)
and the **one-time caption model download**. Everything else works offline,
and everything you make is saved to your own disk.

Press **`?`** to see the keyboard shortcuts for the screen you are on. It
does nothing while you are typing in a text box.

---

## First launch

- **Windows 10 or 11, 64-bit.** imagii is a Windows app: a single portable exe.
- **Download `imagii.exe`.** On the release page, use the **Assets** list.
  Do not use **Source code (zip)**; that is the source, not the app.
- **Every launch is slow.** For 10 to 15 seconds after you double-click,
  no window appears while imagii unpacks itself, and it does so each time you
  start it. Wait for it.
- **SmartScreen.** The file is not signed, so Windows says "Windows protected
  your PC". Click **More info**, then **Run anyway**.
- **Antivirus.** If your antivirus quarantines `imagii.exe`, restore it and
  allow it.
- **Where your data lives.** Settings, autosaves, mood boards and the caption
  model are kept in `%APPDATA%\imagii`. Exports go wherever you choose (see
  **Saving your work**). The browser engine inside imagii keeps its own cache in
  that folder too, and it can hold copies of images that Reference Search
  fetched; **Clear thumbnail cache** does not touch it. Deleting the
  `%APPDATA%\imagii` folder clears everything imagii keeps there. Temporary
  working copies live in `%TEMP%` instead, in the folders `imagii-audio`
  (sound pulled out of a video), `imagii-import` (a converted video) and
  `imagii-concat` (a compile in progress); imagii deletes the ones older than
  6 hours the next time it starts.

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
- **No face tracking.** Vertical reframing is a fixed strip: Left, Center, or
  Right. It does not follow faces or action.
- **English-only captions.** The caption engine is set up for English, and
  there is no language choice.
- **Projects store paths, not copies.** A `.imagii.json` project remembers
  where your video and audio files are; it does not contain them. If you move
  or delete a source, the project still opens, but imagii names the missing
  file and you load it again in its studio. A project made from a video's
  extracted audio remembers the **video**, not the temporary audio file imagii
  makes from it, and extracts the sound again when you open the project.

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
you are typing in a text box or while another dialog is open. The single-letter
shortcuts (the Stream Graphics tool keys, and `I` and `O` in Video Studio) are for
the letter on its own: with **Ctrl**, **Alt** or **Cmd** held, the key belongs to
your computer or the window (**Ctrl+R**, **Ctrl+O**, **Alt+←**), and imagii leaves it alone.

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
   better compatibility), or uncheck it for a quick WebM save, which some apps do
   not accept.
5. Click **Start recording**. While imagii opens the capture the button reads
   **Starting…** and cannot be pressed again, so one press is one take. Click **Stop**
   when you are done, then pick where to save. **Cancel** in the save dialog discards the take — the dialog's title
   says so. With **Convert to MP4** on, **Discard recording** stops the
   conversion; with it off, saving a WebM is a quick copy and there is nothing
   to stop. Either way the saved file opens in Video Studio. If the window or screen
you are capturing goes away (you close it), the take ends on its own, with your
microphone and webcam on or off, and saves the same way, with the saving card on
screen instead of a live **REC**. If your microphone goes away mid-take (a headset
unplugged, a wireless one out of range) the take keeps going, because the picture is
worth keeping, and imagii says once that the microphone stopped and the rest of the
recording has no sound from it, and keeps a line on screen that says when ("Microphone
stopped at 02:14 — no sound after that"): under the **REC** clock, on the saving card and in
the message that says the file is saved. Stop and start again if the voice matters.

While it records you can minimize imagii: the take, and the webcam picture in it,
keep going. **Esc** stops the recording only while imagii is the window you are
using, so if you are in a game, switch back to imagii first (Alt+Tab) and then
press **Esc** or click **Stop**. Recordings use up to 8 Mbps (the top export
preset's rate), so a take can use about 3.6 GB of disk per hour, and saving needs room for a second copy of it.

When the file is saved, the toast offers **Show in folder** and **Edit in Video
Studio**. **Edit in Video Studio** loads the recording into Video Studio; if you
are already editing a video there it asks first, because loading replaces that video
and its clips and edits (it asks nothing when Video Studio is empty).

Your webcam corner and your MP4 choice are remembered for next time. If no
screens or windows turn up, the panel says so — grant screen recording
permission for imagii, then click **Refresh sources**. **Refresh sources** also
re-checks your microphone and camera, each on its own, so a missing webcam never
hides your microphone. If one is missing, plug it in, close any other app using
it (OBS, for one, can hold a camera), or allow its access in
Windows privacy settings, then click **Refresh sources** again.

---

## Video Studio

Drop a video in (or click **Choose file…**), then:

(One video loads at a time. If you drop a second while the first is still loading
or converting, imagii says it is still working on the last one and leaves the
second alone.)

- **Trim** with the timeline. Drag the two handles, or click the track to put the
  playhead where you want it and press `I` and `O` to set the in and out points
  there. `,` and `.` step one frame, `Space` plays and pauses, and `←` / `→` nudge 0.1 seconds.
  The two handles are for the mouse; the keyboard's way to the same trim is `I` and `O`,
  and pressed while the video plays they mark the frame you are looking at.
- **Clips.** Loading a video starts you with **Clip 1**, which spans all of it.
  **+ Add clip** adds another clip that spans the whole video; trim it with the
  handles. Each clip has its own name, crop, platforms and text.
- **Crop** — check **Crop** above the player and draw a box. A clip that already
  has a crop (one you drew, or one a project brings back) opens with the box
  checked and the rectangle on the picture, and unchecking it removes the crop.
  **Reset** clears the rectangle back to the whole picture and leaves the section
  open, whichever way the crop got there. Your crop becomes
  the picture: each platform you export to takes a centered cut of it in that
  platform's own shape, so nothing is ever stretched. A tall crop on a wide
  platform (or the reverse) loses its edges, and the export tells you so before
  it starts. **Crop guides**, beside the player, draws the 9:16, 1:1 and 4:5
  shapes over the picture so you can see what each one keeps. **Export as GIF**,
  **Compile clips** and **Reframe to 9:16** use the same crop: a GIF keeps the
  shape you drew, a compilation takes the same centered cut of it to reach 16:9,
  and the 9:16 strip is cut from it.
- **Speed** — the slider in the **Clips** card runs from 0.25× to 4×. The sound follows
  the picture (its pitch stays put), and an export or a compilation of the clip is
  as long as the clip is at that speed. The player in Video Studio always plays at
  normal speed; the card says "Speed is applied when you export", and the file you
  export is the one that runs at it. The GIF panel has a **Speed** of its own,
  and its warning that a GIF over about 10 s gets huge counts the GIF you are about
  to make, at that speed.
- **Export** — check the platforms you post to: **YouTube**, **Reels**,
  **TikTok**, **X / Twitter**, and **Facebook**. Each shows a green, yellow, or
  red mark predicting how well your clip fits there. A red one says why —
  **Wrong shape** or **Too long** — and the reason is printed on the card. Lengths
  are advice until a platform really refuses them: a Reel past 3 minutes is yellow
  (Instagram stops recommending it to people who don't follow you) and only red
  past 20 minutes, and TikTok's short-clip note ends at a minute. The
  card judges the picture and the file you will really get: a crop smaller than a
  platform's size is marked as one that will be scaled up and look soft, and a
  clip's length counts at its speed, so a 6-minute clip at 2x is a 3-minute
  video. The button says how many files it will write (**Export 3 files**); when no
  platform is checked it is off, and a line beside it says to check one. If you
  press it before choosing a folder, imagii opens the folder chooser and goes on from
  there. Each row of the queue shows the file it wrote — **name (2).mp4** when the
  name was taken. Every export
  is encoded at 30 fps (a custom preset uses its own frame rate), and each
  platform's card shows its size and rate (**1920×1080 · 30 fps**).
  Add a **watermark** by typing your handle in the **Watermark** field and
  choosing a corner. Your handle and corner are saved when you export, and they
  fill in again next time. Exporting with the field blank forgets them, so Clip Kit
  stamps nothing until you type a handle and export again. GIF, reframe, compilation and picture-in-picture
  don't take one.
- **Clip Kit** — one click exports a clip for all five platforms plus three
  thumbnails into a single folder. It stamps the watermark you last exported
  with, and it asks once before it starts only if the clip is longer than a
  platform's typical limit. It never asks about cropping: each platform takes a
  centered cut of your picture. When the clip's picture is vertical — a 9:16 crop
  you drew, or a vertical recording — the YouTube slot is a 1080×1920 Short instead
  of a landscape file, and it is held to a Short's 3-minute limit (the question names
  it **YouTube Short**; Reels stays at 20 minutes). If you have transcribed the video,
  the kit includes the captions as `<clip name>_captions.srt` for THIS clip: the cues are moved to the
  clip's start and follow its speed, so they line up with the file in the folder (a
  clip nobody speaks in gets no `.srt`, and the toast says so). The button counts as it
  goes (**Exporting platform version 2 of 5…**). If you cancel before any file is
  finished, the folder is removed and the toast says only **Clip Kit canceled.**
- **Text overlays** — **+ Add text** draws a caption on the selected clip's export.
  The **Color** box takes a color name (**white**, **gold**) or a code (**#ffcc00**) and
  shows the code once you leave the box; a name imagii doesn't know is refused right
  there, in a sentence; a short code like **#fc0** is read as **#ffcc00**. **Font** picks
  the typeface (Arial, Impact, Verdana, Georgia, Courier New or Comic Sans MS) and the
  export draws it. **Size (px)** runs from 8 to 512. The untouched overlay is white, 48 px,
  Arial, and exports as it is. Text appears in the exported file, not in the
  player. **Source time** is in seconds of the video itself (not of the clip); the boxes also
  take a time the way a stream writes it, like **1:30** or **2:47:13**, and say so in a
  sentence when they cannot read what you typed. So an overlay set for 12 to 15 shows only
  if the clip includes those seconds; when the times fall outside the clip, a note under the
  overlay says so and gives the range the clip covers, and when the start and end are the
  same it says the text never shows. The Timeline, the clip list and the highlight list
  write a time past an hour as **2:47:13**.
- **A video with no sound** (a screen capture with the mic off) has nothing for
  **Clean audio**, **Auto-captions** or the highlight scan to work on; each says
  **This video has no sound.** and stays off.
- **Smart highlight finder** — **Scan VOD** scans the audio for loud, exciting
  moments and suggests clips. The first highlight you add replaces the
  untouched whole-video **Clip 1**, so Export doesn't re-encode your whole VOD
  beside your excerpts. **Ctrl+Z** brings it back.
- **Reframe to 9:16** — cuts a vertical 9:16 strip (1080×1920)
  for TikTok, Reels, and Shorts. Pick **Left**, **Center**, or **Right**. It
  doesn't track faces or action. It cuts the strip from the crop you drew for the clip
  (if any) and carries the rest of the clip's look into it, the way the compilation does: its speed,
  color, text overlays, Auto Zoom and Hype Shake. The panel's header reads the size of the crop
  it is cutting from, not the whole video's. The file is named for the video you opened
  and the clip (**video_Clip 1_reframe-1080x1920-center.mp4**), not for a working copy of the
  video, so six highlights do not all come out as **(2)** to **(6)**. The GIF is named the same way. Its toast,
  like the GIF's, compilation's and picture-in-picture's, names the file it wrote
  (**Saved name (2).mp4**), and
  carries **Edit in Video Studio**. For captions on the vertical version, go in
  this order: reframe, then **Edit in Video Studio** on that toast (it asks
  before it replaces the video you're editing), then **Transcribe** and **Burn
  into video** on the 9:16 file.
- **Captions** — transcribes the speech, then saves an `.srt` or burns styled
  captions into a new MP4. Captions are English only. They burn into the
  original video, not the platform exports. **Save .srt** keeps the captions for
  the whole video, even with **Burn captions over selected clip range only**
  checked; only **Burn into video** follows that box. **Size** is a scale, not pixels:
  the readout beside it says how tall the text comes out on the video you have
  open. On a
  vertical or square video the same Size makes the same share of the picture's
  width, so it doesn't swallow the frame.
  Captions need a one-time setup; see **Captions setup** below. Every
  transcription also keeps its raw `.srt` transcript in a `captions` folder
  inside imagii's own data folder — on your machine only, like everything
  else — and you can delete them there whenever you like.
- **Color & motion**, **Export as GIF**, **Compile clips**, and
  **Picture-in-picture composite** are the other panels. The player does not
  show color changes — they appear in the exported file. **Temperature** warms
  or cools the whole picture, dark and light parts alike, and **Auto-zoom**
  pulses about the middle of the frame. **Compile clips** is always there; with
  one clip it asks for a second.
- **Cancel any long render.** Reframe, GIF, Compile, PiP, highlight scan,
  transcription, and caption burn-in all show a **Cancel** button while
  they're running. Click it to abort cleanly — the background ffmpeg/whisper
  process is killed, the panel returns to its idle state, and imagii says the
  job was canceled (a plain note, never a red error). It works whenever you
  press it — in a job's first moment, or between two files of a batch — and the
  half-written file a canceled or failed job was making is removed. In an
  Export batch, files that already finished stay in your folder and the rows
  that didn't are marked **Canceled** (gray, not red). A batch that fails stops at
  the job that failed: that row is **Failed**, in red, with the reason printed on it,
  and the rows behind it that never started say **Not run**.
- **When something fails,** the message says what happened and what to try, in
  plain words — and the Export row that failed is marked **Failed** with the reason
  under it, so you can still see which one, and why, after the message fades.
- **Open project** with a video or audio file that has moved: imagii opens
  everything else in the project and names the missing file, so you can load
  it again in its studio. A file that is there but won't open (a conversion that
  failed, a full disk) is reported with its real cause instead, and if you open a
  different video while a long conversion is still running, the project's video is
  skipped — what you opened is never replaced — and a note says so.

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
   path the panel shows — a `bin` folder inside imagii's own data folder. The
   panel's **Open folder** button opens that folder, which imagii makes for you.
   It stays put when imagii updates, so you only do this once. (The older name,
   `whisper.exe`, also works.) imagii does not download this file for you.
2. Click **Download model (~141 MB)**. imagii downloads the English model and
   keeps it. You can also fetch the model file yourself and put it at the model
   path the panel shows. The **Show models folder** button opens that folder, and
   imagii makes the folder first if it is not there yet.

While it works, the panel shows the step it is on (extracting audio,
transcribing, building captions). Transcribing has no percentage — nobody can
know how long speech will take — so its bar slides instead of filling.

### Compile

**Compile clips** stitches every clip in the list, in list order, into one
1920×1080 MP4 at 30 fps, whatever the clips were recorded at. Each clip is compiled as you built it: its crop, its speed (the
sound too), its color, **Auto-zoom**, **Hype shake** and text. A clip that is not
16:9 is cut to 16:9 around its middle rather than stretched, and the card tells
you what that cut costs before you compile — one row per clip, **Great** or **OK**
or **Wrong shape**, with the share of the picture that fits, in the same words the
Export grid uses. Set **Fade between clips** (in milliseconds): each clip fades
out to black and the next fades in from black — sound too — and clips never
overlap, so 0 ms is a hard cut. Pick a folder and click **Compile N clips**.
**Cancel** stops it.

### Posting helpers

The posting helpers sit at the bottom of Video Studio, in three parts:

- **Title starters** — click **Title starters** for four title drafts built from
  a short list of patterns and verbs, such as *I clutched a boss fight so you
  don't have to*. Each one has a **Copy** button. The starters name no game;
  add yours yourself.
- **Hashtag pack** — choose a pack (for example *Twitch clip* or *TikTok,
  general*) and copy its hashtags.
- **Posting log** — type a clip name, check the platforms you posted it to
  (YouTube, Reels, TikTok, X, Facebook, Twitch, or Discord), add notes, and click
  **+ Log post**. Each entry has **views**, **likes**, and **comments** boxes you
  fill in yourself, and a delete button that asks first. The log keeps the 100
  most recent entries. It is saved with
  your settings, not in a project file.

---

## Audio Studio

Drop in audio, or any video, and imagii extracts its audio. (One file loads at a
time: if you drop another, or pick one from **Recent**, while the last is still being
extracted, imagii says it is still working on the last one and leaves the new one alone.)
Audio Studio opens sound up to 2 hours long: it draws the waveform from the whole file
in memory, so a longer one is refused with a note saying so. The length is checked
first, before any sound is pulled out of a video: **Clean audio** on a video over 2
hours, or a long video dropped here, is refused at once, with nothing extracted and
nothing left in your temporary folder. For a longer video, the note says to export the
part you want from Video Studio first and open that shorter file; for a longer sound
file, it says to split it into shorter files in another app first. If imagii cannot
draw a file's waveform (a damaged file, or a format it cannot read here), it says so too.

- **Help me fix this** runs a short wizard that picks cleanup settings for you
  if you're not sure.
- Or set them yourself, panel by panel:
  - **Cleanup** — **Quieter background** (Off, Light, Medium, Aggressive, or
    Custom, where you tune the noise floor and reduction by hand; each of the three
    removes more of the background than the one before it), plus switches
    for removing low rumble (below 80 Hz), **Hum removal**, and softer harsh
    's' sounds. Hum removal follows your power grid: 60 Hz in the US and Canada,
    50 Hz in most other regions. Pick yours in the **Power-line frequency**
    list that appears when the box is checked.
  - **Levels** — the compressor preset, **Even volume** with a loudness target
    (pick **Talking and podcasts (−16)** or **YouTube, TikTok, Reels (−14)**;
    the line under the picker says −14 also suits Spotify), and manual gain. The target box takes −70 to −5; a number outside that
    becomes the nearest edge when you leave the box. imagii measures the whole file
    first, so exports with a loudness target take a little longer. A mono file is
    measured the way stereo speakers play it (the one channel on both sides), so its
    target is what you hear. Whatever you switch on or cut out, peaks above −1 dBFS
    are limited when you export, so a boost cannot clip; an export with nothing
    switched on and nothing cut keeps the file's levels as they are.
  - **Cleanup presets** — **Save current** keeps your cleanup settings (noise,
    levels and voice treatments) under a name, so you can apply or remove them
    later. Cuts and the second track belong to the recording, so they are not
    saved in a preset.
  - **Add a second track** — layer in background music, a co-host's mic, or game
    audio. **Duck under your voice** lowers it while you speak.
- The wizard's last card lists exactly the settings it is about to apply — the
  hum line names the power-line frequency it keeps (**Hum removal: on (50 Hz
  mains)**). **Start over** goes back to its first question; **Close** leaves it.
- **Clean audio** in Video Studio replaces whatever Audio Studio holds. If you
  have tuned it, imagii asks first ("Replace the audio you're editing?") and
  lists what would be discarded, the same list as closing the audio gives.
- Drag across the waveform to mark a part to remove. It comes out when you
  export; click a mark to put it back. `Ctrl+Z` / `Ctrl+Y` step back and
  forward through the cleanup chain.
- **Export** to MP3, WAV, FLAC, or AAC. AAC is saved as an `.m4a` file. From a
  video with a picture, **Re-attach to video** writes an `.mp4` (a `.mkv` or `.mp4`
  that holds sound alone, a podcast for example, opens as sound: there is no
  picture to put it back on, so the box is not offered); if you removed parts, or the
  video is in a format an MP4 cannot hold as it is (a `.wmv`, for example), the
  picture is re-encoded, which takes longer. While it works the row
  says which step it is on — "Step 1 of 2 — measuring loudness", then "Step 2
  of 2 — rendering" — because each step has its own progress bar. If you cancel
  or it fails, the row says **Canceled** or **Failed** and no half-written file
  is left.
- The toast for a re-attached video says **Cleaned audio attached to the
  video** and carries **Show in folder** and **Edit in Video Studio**, which
  opens that new `.mp4` there (it asks before it replaces the video you're
  editing). An audio-only export has no video to open, so its toast has neither
  button. Clean the sound first, then clip: clips and edits made in Video
  Studio on the original video do not carry over to the re-attached file, so
  open that file and cut your clips from it.

---

## Stream Graphics

Make thumbnails, Twitch overlays, banners, and emotes on a canvas.

1. Start from a **template**, or use **Or start blank**: **Import image** or
   **Start with text**. Templates are grouped as **Thumbnails** (1280×720, plus
   2K and 4K bold variants), **Stream overlays** (1920×1080, plus 2K and 4K),
   **Banners** (1200×480 for your Twitch channel page, and 2560×1440 for
   YouTube channel art), and **Emotes** (a 112×112 canvas). Guide layers such as
   the facecam hole, and the sample text you are meant to replace — "YOUR TITLE
   HERE", "Your Name", "@yourhandle" — are tagged **hint — won't export** in the
   Layers panel: they show while you design and are left out of the file, so a
   template you forgot to edit never posts its placeholder. Type your own words
   over a sample and they export. The words that ARE a card — "BE RIGHT BACK" on
   the BRB screen, "STARTING SOON", "THANKS FOR HANGING OUT" — export as they
   are. A hint's words are drawn dimmed on the canvas, so what you see tells you
   what the file won't have. Shapes, bars and borders are part of the design and always export.
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
   and write all their files into it. A single **Save** on a variant says **Saved**
   and the file's name once it is written, and says nothing when you cancel.

---

## References

Gather inspiration and grab ready-made stream assets. References has three tabs.

- **Reference Search** — search images. SafeSearch is always on (strict):
  DuckDuckGo does the filtering, and imagii doesn't scan images itself. Reference
  Search is one of the two features that go online; the other is the one-time
  caption model download. Hover a result and click **Save** to add it to the
  mood board you have selected. If you have no board yet, imagii asks you to
  name one first.
- **Mood Boards** — your saved boards. Hover an item and click **→ Canvas**
  to add it to the Stream Graphics canvas as a 40%-opacity reference layer. A
  reference is a guide only: it is tagged **reference — won't export** and is
  left out of exports.
  **Clear thumbnail cache** (on this tab) empties imagii's on-disk copy of the
  board thumbnails right away. Your boards keep every item: a cleared thumbnail
  loads again from its source the next time its board is shown. imagii also
  tidies the cache at each launch, but only removes thumbnails that no board
  still uses. The browser engine's own cache in `%APPDATA%\imagii` can keep
  copies of fetched search images too, and the button does not clear it; deleting
  that folder clears everything imagii keeps there. Temporary working copies
  live in `%TEMP%` instead, in the folders `imagii-audio` (sound pulled out of
  a video), `imagii-import` (a converted video) and `imagii-concat` (a compile
  in progress); imagii deletes the ones older than 6 hours the next time it
  starts.
- **Asset Library** — curated, free-to-use stream assets: overlay frames, lower
  thirds, scene cards, and social cards. Click one to put it on the Stream
  Graphics canvas. Like a template, it replaces what is already on the canvas.

---

## Saving your work

- **Save project** writes a `.imagii.json` you can reopen later. It keeps the
  studios and their layout, and the file paths of your sources. Mood boards
  live outside projects. A video imagii had to convert when you dropped it
  (FLV, TS, WMV, MPG, 3GP) is saved as the file you dropped, and converted again
  when you open the project — that can take a while for a long recording, and
  a note says what it is doing while you wait. The same goes for the sound of a
  video in Audio Studio: it is taken from the video again on open, with the
  same kind of note.
- **Autosave** runs in the background, and imagii takes one final snapshot as
  it closes, so the last few seconds of work are in it too. On the next launch
  it offers to restore that session — route, selections and playhead included.
  If the window's rendering process ever dies, imagii reloads the window to Home,
  where the same banner offers the autosave back; a recording that was still being
  written at that moment is not kept (its half-written file is removed). If a studio
  hits an error instead and shows the crash screen, nothing has restarted: **Reload to Home**
  only changes the screen, so the studio you were in is still open with your work in it, and
  no restore banner is offered. The banner
  is not shown over work you have already started in this session, so a restore
  never lands on top of it. If the autosave file is damaged,
  imagii says so and offers to clear it rather than loading it. An autosave from an earlier version restores too. If you open a
  different video while Restore is still loading the autosave's, Restore skips that
  video and says so; the autosave then holds what you have open, so the skipped
  video and its clips do not come back from it.
- **The window remembers its size and position** between launches, and
  re-centers itself if the display it was on is no longer connected. That
  happens whatever you choose in the restore banner.
- **Exports are normal files on your disk.** Video, GIF, compilation, reframe,
  picture-in-picture and Clip Kit files go into the output folder you choose, and
  none of them replaces a file that is already there: a second export with the
  same name is written beside the first as **name (2).mp4**, then **name (3).mp4**,
  and a second Clip Kit of the same clip on the same day gets its own folder,
  **name-kit-date (2)** (the date is today's on your computer's clock). The **GIF**,
  **Compile**, **Reframe** and **Picture-in-picture** panels start on the folder the
  last one of them wrote to (the button shows its name), so the folder is chosen once and not
  every time Video Studio opens; **Choose folder…** changes it for all four, at once: a pick in one
  panel shows in the other three without leaving the studio. A folder that is no longer a usable path is ignored
  (a folder that has been deleted, or sits on a drive that is not plugged in) and the chooser opens as it always
  did. A folder you chose and then deleted is made again when you export; one that cannot be made
  is named in the message, before anything is encoded. A long folder name is shortened with
  an ellipsis on the button, and the full path is its tooltip. Audio exports, caption files, burned-in videos,
  recordings, and projects ask where to save them.
  Stream Graphics images ask too: **Export** opens a Save dialog, and the emote
  pack and **Variants → Save all** ask for one folder.

---

This guide tracks the shipping product. If imagii's features change, this
document changes with them.
