# imagii — Branding Guide

The name, voice, and identity of imagii. Visual tokens are in
`DESIGN_GUIDE.md`; this is about how imagii presents itself.

---

## The name

**imagii** — always lowercase, even at the start of a sentence or a
heading. Never "Imagii", "IMAGII", or "iMagii". The one exception is
where a platform mechanically forces title-case (e.g. a Windows window
title); the in-app `<h1>` and all copy use lowercase.

Pronounced "image-ee".

---

## What imagii is (the positioning line)

> A free, local-first creative studio for streamers.

Every piece of copy should be consistent with three promises:

1. **Free.** No subscriptions, no accounts, no upsell. Never imply a
   paid tier exists.
2. **Local-first.** Everything runs on the user's computer, except
   Reference Search and the one-time caption model download, which go
   online. No cloud, no telemetry, no upload. Say so when it reassures
   the user — and never say "everything" without the exceptions: an
   absolute that is false in two places is a promise the user can
   catch us breaking (T-85).
3. **For streamers.** The audience is Twitch / YouTube / TikTok
   creators. Examples and defaults should reflect that.

imagii is a **bespoke single-user build**, made for one named user
(see `FOR_MIKE.md` in the repo root). The by-name greetings in
`routes/Welcome.tsx` ("Hi Mike!") and `routes/Home.tsx` ("Hi Mike —
pick a studio") are an intentional, warm personalization — not a copy
or branding bug. Do not flag or "fix" them.

---

## Voice & tone

imagii talks like a **competent, friendly studio-mate** — not a
corporation, not a hype machine.

- **Plain and direct.** "Trim and clip video." Not "Leverage our
  cutting-edge clipping engine."
- **Warm, not cutesy.** Encouraging is good; baby-talk and exclamation
  spam are not.
- **Honest about limits.** If a feature has a caveat, say it. "Off =
  save as WebM (instant, but some apps don't accept WebM)." Copy
  promises only what the code does: a fixed crop is a "center crop", not
  an "auto" reframe; SafeSearch is DuckDuckGo's filter, not ours (T-85).
- **Action-first in controls.** Buttons are verbs: "Start recording",
  "Save project", "Export".
- **No emoji in the product UI** (see `STYLE_GUIDE.md`). Emoji are
  fine in informal docs like this one if genuinely useful; they are
  never shipped in the app.

### Microcopy patterns

- Errors name what failed and, where possible, what to do:
  "Export failed. A file imagii needs isn't there. It may have been moved
  or deleted." The raw message (ffmpeg's stderr, an errno, a validator's
  field path) never reaches the toast — it goes to the console. A cancel is
  not an error: say it was canceled, neutrally, and say what survived
  ("Export canceled. Files already finished are in your folder."). Spell it
  "canceled".
- A crash screen says what is safe and where it is, and never asks the user
  to "report" anything — a local-first app has no channel to report to.
- Empty states invite the next action: "Drop a video here".
- A tutorial step names a control exactly as the screen does ("Duck under
  primary", not "Duck under voice"), says what the code does and no more,
  and is two short sentences in plain words: "loudness", not "LUFS"; "the
  captions engine", not a binary's name. No "New:" tags — a shipped feature
  is not new — and no "Step 4:" numbers; the coachmark counts, and a step
  whose target is off the page is skipped (T-86).
- Destructive actions are explicit and never silent.

---

## Copy conventions (T-92)

The rules a sentence on screen is held to. The voice above says how imagii
sounds; this section says what each thing is CALLED and how a label is
written, so two panels never name one idea two ways. `tests/unit/copyConventions.test.ts`
scans the renderer's rendered strings for the mechanical half of it.

### One name per concept

| Say | Never say | What it is |
|---|---|---|
| **Stream Graphics** | Image Canvas, Image Studio | The studio at `/image`. "Canvas" alone is the drawing area inside it. |
| **Smart highlight finder** | highlight scanner, "AI clips" | The loudness scan in Video Studio (button: "Scan VOD"); chat can sharpen it. |
| **Chat spike finder** | Chat highlight reel, hype finder | The chat-log panel (button: "Find chat spikes"). |
| **highlight** | candidate, hype moment, peak | A moment the Smart highlight finder found. |
| **chat spike** | hype moment, chat peak | A burst of messages the Chat spike finder found. |
| **clip** | segment, excerpt | A Video Studio unit: a trimmed range with its own export targets. |
| **cut** | | An Audio Studio unit: a part removed when you export. |
| **Mood board** | Moodboard, collection | A saved set of references (two words). |
| **Posting log** | posting diary, diary | The list of where a clip was posted. The feature and its list are both "Posting log". |
| **Title starters** | title ideas, title generator | The posting helper that builds four title drafts. |
| **Clip Kit** | clip kit, Clip kit | One clip exported for all five platforms plus thumbnails. |
| **Reframe to 9:16** | Auto-reframe, smart crop | A fixed vertical strip. It tracks nothing. |
| **Crop guides** | Safe zones | The Player's overlay of the 9:16, 1:1 and 4:5 shapes. |
| **Show in folder** | Show, Reveal, Open location | Selects a finished file in Explorer. |

### Writing a label

- **Sentence case** for every button, label, header and menu item: "Save
  project", "Reframe to 9:16", "Add clip". Proper names keep their capitals
  (Video Studio, Clip Kit, Stream Graphics); the product name is always
  lowercase "imagii".
- **A button is a verb, capitalized.** No lowercase outliers ("copy", "open
  folder"), no glyph standing in for the verb ("✕ delete"). A leading "+" is
  fine ("+ Clip", "+ Add clip") and the word after it is capitalized.
- **Spell a corner out.** "Top left", "Bottom right" — never "Top L" or "Bot R".
  Same for a shape: "Rectangle", not "Rect". A word cut short to fit is a
  layout bug, not a label.
- **A count and its noun come from `countOf`** (`@shared/plural`). "1 clip",
  "2 clips"; never "clip(s)", never a hard-coded plural. A sentence that reads
  "Found 1 highlights" is the bug this rule exists to prevent.
- **Units are spaced and spelled the same way everywhere**: "30 fps" (not
  "30fps"), "8 Mbps", "192 kbps", "480 px", "3 s". A bare number is not a
  value: "30" beside a "Width" label is ambiguous, "480 px" is not.
- **A label names the thing, not its internal id.** "Long loud stretch", not
  `sustained-loud`; "Video h264 · audio aac", not "h264 · aac"; the first 3
  seconds' loudness, not "LUFS". Where a number genuinely needs the unit
  (Audio Studio's loudness target), it goes in parentheses beside the number.
- **Say what a control does not do.** A slider with no live preview says so in
  one line ("Color changes show up in the exported file, not in this preview.").

### Destruction verbs

Four verbs, four meanings. A button and the confirm it opens always use the
SAME verb, and the toast that follows uses its past tense.

| Verb | Means | Example |
|---|---|---|
| **Delete** | Destroy something saved under its own name. It always asks first, and says so when Ctrl+Z can bring it back. | Delete preset, Delete board, Delete a posting-log entry |
| **Remove** | Take one item out of what you are editing. It lives in the document, so Undo puts it back. | Remove clip, Remove layer, Remove overlay |
| **Clear** | Empty something that stays: the file or cache is still there, with nothing in it. | Clear the autosave, Clear thumbnail cache |
| **Discard** | Abandon something that was never saved. | Discard the recording, Close this video (its edits are discarded) |

### Toasts

- **One sentence.** A toast that reports a result has no trailing period when it
  is a single sentence: "Saved to your folder". Two sentences keep both
  periods. A failure is the exception: `reportFailure`'s `failed` is a full
  sentence with its period ("GIF export failed.") because a plain cause may
  follow it (see `STYLE_GUIDE.md`).
- **The completion verb is "Saved" or "Exported"**, plus what and, where it
  helps, where: "Saved the GIF", "Exported 4 files". Never "done", "finished" or
  "ready" for a file that was written.
- **A toast that carries the ONLY way to do something lasts at least 8 s** and
  names the action in full: "Show in folder", never a bare "Show"; "Edit in
  Video Studio". The default 2 s is a notification, not a place to keep a
  button. `lib/savedToast.tsx` is the one helper that does this.
- A canceled job is neutral ("Export canceled.") and says what survived; it is
  never a red error toast.

### Voice

- imagii speaks as imagii, or in the imperative: "imagii will set:", "Pick a
  clip first". Never "I", never "we".
- **US spelling**: canceled, color, center, analyze. "Check" a box, never "tick"
  it.
- **No exclamation marks** in the product. (The one warm greeting on the
  welcome screen is the personalization noted above.)
- Plain words over developer words: "loudness", not "LUFS"; "captions engine",
  not a binary's name; "sound", not "audio stream".

### Dismissing a dialog

- A dialog with nothing to decide has one dismiss control, and its label is
  **Close**. Not "Esc", "✕", "Done" or "Cancel". The Esc hint lives in the
  shortcuts dialog and nowhere else.
- A dialog that asks a question pairs a verb with **Cancel** ("Export anyway" /
  "Cancel"; "Keep running" / "Cancel jobs").
- **Done** is for the end of a multi-step flow (the tutorial tour), not for
  closing a window.

---

## Color identity

imagii's signature palette is **obsidian volcano** (round 19): neon magma
red `#ff3131` on an obsidian-black ground (`#120c0c`, warm undertone),
with ember `#fbbf24` as the secondary highlight. The lava accent is the
brand — it carries primary actions, focus states, and the app icon.
Don't introduce a competing brand color; per-studio accent washes (on
the Home cards) are warm-family tints, not new brand colors. The
canonical values live in `tailwind.config.js` +
`src/renderer/src/styles/tokens.ts` (see `DESIGN_GUIDE.md`).

---

## Logo & icon

The app icon lives in `resources/icon.png` / `icon.ico` (generated by
`scripts/build-icon.mjs`). The in-app wordmark is simply the lowercase
text "imagii" in Inter Semibold. There is no separate logomark beyond
the app icon.

---

## Attribution

imagii ships without authorship attribution in the product, the
commits, or the docs. Do not add "made with" tags, generator credits,
or co-author lines to any artifact.

Two exceptions:

- **A license term** from a third-party dependency that legally
  requires a specific disclosure — flagged and discussed before it is
  added.
- **Agent-runtime commit trailers.** Coding agents run under harnesses
  that mandate a `Co-Authored-By` / session trailer on every commit;
  the agent cannot suppress it. Those trailers are exempt. The rule
  still binds everywhere the reader sees it — the product UI, the docs,
  release notes, and the commit *subject and body*. Attribution belongs
  nowhere a user looks; a machine-generated trailer in git metadata is
  not that place.

---

## When this guide changes

Branding decisions update this file in the **same commit**. Copy in the
app, the `README`, and the user-facing docs must stay consistent with
it.
