# imagii — Design Guide

How imagii looks and lays out. This is the source of truth for the
**visual** system. Code-level conventions live in `STYLE_GUIDE.md`; the
name, voice, and identity live in `BRANDING_GUIDE.md`.

The `design-reviewer` agent checks the renderer against this document.

---

## Design tokens

All color comes from the Tailwind theme (`tailwind.config.js`). Never
hard-code chrome colors in `className` — use the token.

| Token | Value | Use |
|---|---|---|
| `bg-base` | `#120c0c` | App background, deepest layer — obsidian black, warm undertone |
| `bg-elevated` | `#1c1313` | Cards, panels, modals |
| `bg-hover` | `#2a1a18` | Hover state for interactive surfaces |
| `accent` | `#ff3131` | Primary actions, focus rings, active states — neon magma red (5.29:1 on `bg-base`, 4.55:1 on `bg-hover`) |
| `accent-muted` | `#f52e2e` | Hover state of accent elements |
| `ink-base` | `#ece4e2` | Primary text (15.5:1) |
| `ink-muted` | `#a59a97` | Secondary text, labels (7.1:1) |
| `ink-dim` | `#9c8f8b` | Tertiary text, borders, disabled — 6.2:1 on `bg-base`, 5.8:1 on `bg-elevated`, both above WCAG AA's 4.5:1 (the round-15 B9 lesson, re-verified for the round-19 obsidian-volcano palette). |
| `ember` | `#fbbf24` | Warning **surfaces** (`bg-ember/10`, `border-ember/40`, the yellow status dot), the icon's sun, and the **playhead** in both timed studios — wavesurfer's cursor in Audio, the Timeline marker in Video. 10.0:1 on `bg-hover`, 7.4:1 on the clip range's `accent/25` fill, so it stays readable over the accent it is drawn across (T-56). |

**The semantic tier (T-71)** — three meanings that used to be carried by
raw rose/amber/emerald palette classes across a dozen files. The values
are the palette values that were already on screen, so adopting them was
a rename, not a redesign.

| Token | Value | Use |
|---|---|---|
| `danger` | `#fda4af` | Destructive actions, failures, clipping — **text**. Delete buttons, the REC clock, error copy. 9.6:1 on `bg-elevated`, 7.0:1 on a `danger-strong/20` wash. |
| `danger-soft` | `#fecdd3` | The hover brighten on a `text-danger` ghost-button label, and error-card body copy. 12.9:1 on `bg-elevated`. |
| `danger-strong` | `#fb7185` | Danger as a **mark**: meter bars, status dots, failed progress bars, borders, `/NN` washes. 7.2:1 on `bg-base`. Text drawn ON it is `text-bg-base` (7.2:1), never `ink-base` (2.2:1). |
| `warn` | `#fcd34d` | Caution / "this needs setup" — **text**. 12.6:1 on `bg-elevated`, 10.4:1 on an `ember/10` wash. |
| `ok` | `#6ee7b7` | Healthy, ready, passed — **text**. 12.0:1 on `bg-elevated`, 8.2:1 on an `ok-strong/20` wash. |
| `ok-strong` | `#34d399` | Ok as a **mark**: meter bars, status dots, borders, washes. 10.1:1 on `bg-base`. |

There is deliberately **no `warn-strong`** — `amber-400` is `ember` to the
byte, so warning surfaces use the ember token rather than a second name
for one color. `designTokensInSync.test.ts` fails if any other token is
ever given the ember hex.

**The signal pair (T-104)** — two hues that tell series apart and mean
nothing else: the highlight finder's Audio / Chat / Hype bars and the crop
guides for 9:16 / 1:1 / 4:5 (ember is one of those hues; these are the other
two, and accent is the Audio bar's). They were raw `#f472b6` / `#22d3ee` literals in
`HighlightPanel` and `SafeZoneOverlay`. They are not status colors, so they
stay out of the semantic tier.

| Token | Value | Use |
|---|---|---|
| `signal-pink` | `#f472b6` | The Chat signal bar and the 9:16 crop guide. 7.3:1 on `bg-base`, 6.3:1 on `bg-hover`. |
| `signal-cyan` | `#22d3ee` | The 4:5 crop guide. 10.7:1 on `bg-base`, 9.2:1 on `bg-hover`. |

The Hype bar and the 1:1 guide are `ember`; the Audio bar is `accent` — three
crop guides, three distinct hues, pinned by `designTokensInSync.test.ts` (T-112
removed a fourth, a 16:9 entry with a color and a shape and no caller: the
overlay draws the three that Player asks for). They are drawn in JS contexts (an inline style, an
SVG stroke), so they are imported from `tokens.ts` as `SIGNAL_PINK` /
`SIGNAL_CYAN`; the Tailwind half (`signal.pink` / `signal.cyan`) exists so the
sync test sees them.

The palette (round 19, "obsidian volcano") lives in TWO files by
necessity: `tailwind.config.js` (for classNames) and
`src/renderer/src/styles/tokens.ts` (for JS contexts — Konva strokes,
wavesurfer options, inline SVG, the toaster). Never write a raw chrome
hex anywhere else; import from `tokens.ts`.
`tests/unit/designTokensInSync.test.ts` fails the build if the two files
drift, and also pins the contrast claims above.

**A raw palette color is the same bug as a raw hex.** `bg-pink-400`,
`bg-rose-500/20`, `rgba(244, 63, 94, .35)` — Tailwind's default palette
resolves them all, so nothing fails and nothing looks broken, and a
retheme walks straight past them. Three of them survived round 19 inside
the Timeline and the waveform until T-56. If a color is not in the table
above, it does not belong in `src/renderer`.

**Alpha in a JS context** is `withAlpha(TOKEN, 0.25)` from `tokens.ts`,
not a hand-written `rgba()` — a literal cannot follow the token it was
copied from. In a className, use Tailwind's own `/NN` suffix
(`bg-accent/25`).

**Font:** Inter (`font-sans`), with `system-ui` fallbacks. One family,
weights 400/500/600. It is BUNDLED (T-126 (18)): `main.tsx` imports the latin
400, 500 and 600 files of `@fontsource/inter`, the build emits the font files
beside the page, and the stylesheet points at them, so the app draws Inter on
a machine that has never had it and requests it from no one (local-first). The
stack stays as the fallback for a glyph the latin subset lacks. The built-app
E2E (`smoke.spec.ts`) asks the page's `document.fonts` for all three weights
and reads the built style sheets for a `url()` that is not a bundled file.

**Documented raw-color exceptions.** These places use raw hex or rgba
deliberately; nowhere else may. For HEX that is mechanical since T-104:
`tests/unit/noRawHex.test.ts` reads every renderer source file and fails on a
string holding a hex color, so a hex exception is a visible edit to its
allow-list (by file, or by exact literal in a file) AND to this list. Plain
`rgba(...)` values are NOT caught by the scan — the rgba entries here are
held by this list alone, so a new one must be added below:

- **NavCard accent washes.** Per-studio NavCard accents on the Home
  screen use one-off rgba values (each studio has a tint).
- **Dimming and glow chrome (rgba).** The tutorial scrim
  (`components/Tutorial.tsx`), the crop overlay's dim
  (`video-studio/CropOverlay.tsx`), the stage's drop shadow
  (`image-studio/Canvas.tsx`, the `boxShadow` under the canvas), and the
  `.btn-primary` glow shadows (`styles/index.css`) are one-off black/accent
  washes over whatever sits beneath them; no token names a translucent scrim tier.
- **Pure black: the video matte and the hover scrim (T-123).** `bg-black` is the letterbox behind a picture, not a
  chrome color: the Video Studio player's stage (`video-studio/Player.tsx`) and Record's live capture preview
  (`record-studio/RecordStudio.tsx`) are black the way an export's bars are, so a retheme must not tint the matte of a
  video. `bg-black/60` is the dim over a reference thumbnail that makes the Save and "→ Canvas" buttons legible on any
  picture (`references/MoodBoardPanel.tsx`, `references/ReferencePanel.tsx`): the picture under it is arbitrary, so
  the scrim is black, not a surface token. (`Modal`'s `bg-black/70` scrim is the fifth black wash and is described under
  Modals.) No token names pure black or a translucent scrim tier. `designTokensInSync.test.ts` fails on a `bg-black` in a
  renderer file this list does not name.
- **The transparency checkerboard: `CHECKER_A` and `CHECKER_B` (T-71, T-123).** Two warm darks in `styles/tokens.ts`
  (`#221616`, `#1c1313`) drawn as an inline `repeating-conic-gradient` behind a transparent preview (the Stream Graphics
  import panel, the Templates dialog and the Asset Library). They are JS-only tokens: no className draws them, so
  `tailwind.config.js` has no mirror for them, and `designTokensInSync.test.ts` (which compares each token it names with its
  Tailwind twin) has nothing to compare. `CHECKER_B` happens to be `BG_ELEVATED`'s value; it is its own token so a
  retheme of the card does not retint the tiles. They are named here, in the one place a raw value may live, so the next
  reader does not take them for an unmirrored drift.
- **ErrorBoundary.** The render-error fallback (`components/ErrorBoundary.tsx`)
  uses inline-style raw hex on purpose — the error may originate in
  layout itself, so the fallback avoids Tailwind classes that depend on
  shared layout context.
- **OutputPreview's matte** (T-104). `ctx.fillStyle = '#000'` in
  `OutputPreview.tsx`: the preview canvas is a picture of the EXPORT's pixels,
  and an export's bars are black by definition; the E2E suite compares it
  against a canvas of its own black.
- **The overlay editor's typing example** (T-104). `placeholder="white or
  #ffcc00"` in `TextOverlayEditor.tsx` shows the user the form a color is typed
  in; it is copy, not a color drawn.
- **Document content** (T-71). `image-studio/templates.ts`,
  `references/assetCatalog.ts`, and the blank page's `background:
  '#ffffff'` in `canvasStore.ts` describe **artwork**, not chrome: they
  are compositions with per-template alphas that a designer tuned by eye,
  and they end up as pixels inside the user's exported PNG. A chrome
  retheme must not silently redesign a shipped template. The line: the
  app's own **default marks** — the fill and stroke a freshly drawn
  rect / ellipse / line / text layer comes out in — DO follow the tokens,
  because a user expects new shapes to arrive in imagii's colors.

**Text on a wash of its own hue (T-112).** The same check applies to a *translucent*
fill: an accent or ember wash (`bg-accent/20`, `bg-ember/10`) over a card is a
composite, and `text-accent` on it measured 3.6:1 (the Highlight finder's score pill,
Clip Kit's button) and 4.1:1 (the Captions setup card's links) — under AA, and
invisible to a check of "token on background". The readable partner of a wash is
`ink-base` (10:1 or better on an accent wash) with the accent *border* carrying the
identity, or `text-warn` on an ember wash (10.4:1). `designTokensInSync.test.ts`
recomputes the ratios from the tokens and fails on any renderer className that sets
`text-accent` and a `bg-accent/NN` or `bg-ember/NN` wash together.

**Text on a semantic fill.** Any token used as a `bg-*` under text needs
its own pairing checked — the fill tones (`accent`, `danger-strong`,
`ember`, `ok-strong`) are all bright, so the readable partner is
`text-bg-base`, the way `.btn-primary` already does it. `ink-base` on a
bright fill fails AA and looks fine while doing so; that was the T-71
finding in MoodBoardPanel's remove chip (2.93:1).

**Native controls are drawn in the palette (T-125 (13)).** The browser's own controls (a
checkbox's tick, a radio, a range slider's thumb, the scrollbars, a `<select>`'s drop-down list, a
number box's spinner) take their colors from two properties on the root, and with neither set
they are stock Chromium: blue ticks and sliders and light scrollbars on the near-black window,
a second accent against the one color BRANDING allows. `styles/index.css` has ONE rule for it,
`:root { color-scheme: dark; accent-color: theme('colors.accent.DEFAULT') }`: the accent is read from
the Tailwind theme, the token the buttons use, not a hex written beside it. A native control's
closed face needs no class to be right (the open list of a `<select>` is the exception below),
and a new one is not given a color of its own. The same rule for the
two things a library draws with its own stock colors: the toast marks (the green tick and the red
cross are react-hot-toast's own) are set from the tokens in `AppToaster` (`TOAST_ICON_THEME`:
`OK_STRONG` and `DANGER_STRONG` discs, `BG_BASE` glyphs, 10.08:1 and 7.20:1).
`designTokensInSync.test.ts` fails on a second `:root` rule, a changed value, or a toast mark that
is not a token.

**What the two properties do not reach (T-126 (16)).** `color-scheme: dark` makes a `<select>`'s
closed control and its open list dark. The row the pointer or the arrow keys are on in that open
list is drawn by the operating system and is not styleable from CSS: it stays the system's
highlight color, and nothing in the guide or the tests claims otherwise. **Selected text** is
palette-colored by one rule of its own, `::selection` in `@layer base`: the accent at 40% with
`ink-base` on it. The wash is composited over whatever surface the text is on, so the pairing is
computed over each of them (`bg-base` 8.94:1, `bg-elevated` 8.38:1, `bg-hover` 7.74:1; AA is 4.5:1) and
pinned the way the toast marks are. `designTokensInSync.test.ts` reads the alpha from the style
sheet and fails on a second `::selection` rule, a different ink, or a wash that takes any surface
under 7:1.

**Placeholder text is `ink-dim` (T-127 (16)).** Tailwind's Preflight draws every `input` and `textarea`
placeholder in its stock `#9ca3af`, a cool blue-gray brighter than the palette's own dim ink and
the one colour in the app that belongs to no token. One rule, `input::placeholder, textarea::placeholder`
in `@layer base`, sets it from `theme('colors.ink.dim')`: 6.2:1 on `bg-base` (where the inputs sit), 5.83:1 on
`bg-elevated` and 5.33:1 on `bg-hover` (AA is 4.5:1). Preflight already sets the opacity to 1, so the drawn colour is
that token exactly (measured on the glyph pixels of the built app: `156,143,139`, where the stock colour
read `156,163,175`). `designTokensInSync.test.ts` fails on a second rule, a raw hex, another token,
or a pairing under AA.

---

## Component patterns

Three CSS component classes are defined in `styles/index.css`. Use them;
do not re-derive their styling inline.

- **`.btn-primary`** — filled accent button. Primary action per surface.
- **`.btn-ghost`** — outlined button. Secondary actions.
- **`.card`** — elevated surface: `bg-elevated`, dim border, rounded-xl.

Buttons that pair an icon with a label use
`inline-flex items-center gap-1.5` (or `gap-2` at larger sizes).

**A chip that shows a name the person chose is capped, and ends in an ellipsis (T-125 (11)).** The
output-folder button (`OutputDirLabel`, in five cards) drew the whole name of the remembered
folder, so a long one ("Stream Highlights 2026 - Season Finale - ...") pushed the card's primary
button out of the card by 55 px. The chip is `max-w-[9rem]` with `w-full` (never past 9 rem, and never past the button it sits in, which is the item that gives in a narrow card: T-126 (13)) with the name in a
`min-w-0 truncate` span and the full path as its `title`; the icon is `shrink-0`, and the
accessible name still reads "Output folder: " and then the whole name. A new chip of a
user-given name (a file, a board, a preset) gets the same three parts. **A name that a layout cuts
with an ellipsis always carries its whole self as its `title` (T-127 (15))**: the second track's
"Role: file name" line, the file name in the Video and Audio Studio headers (cut at 40 characters)
and the Cleanup preset rows had no tooltip, so the rest of a long name could not be read anywhere
(each is pinned in `interactionWiring.test.ts` and read in the built app by audio.spec.ts and
video-core.spec.ts).

**Panel section headers** are always the `PanelHeader` component
(`components/PanelHeader.tsx`) — never a hand-written `<h3>`. It renders
the one canonical heading style (`text-xs`, uppercase, an icon) and an
optional right-aligned `actions` slot. This is the single source of
truth for what a panel header looks like; see `STYLE_GUIDE.md`.

**Modals** use the `<Modal>` helper from `components/Modal.tsx` (added
in round 15). It centralizes `role="dialog"` / `aria-modal="true"`,
first-focusable-on-mount, Tab trapping, Escape close, scrim-click close,
and focus restore (and as of round 16, a `useId()`-generated
`aria-labelledby` so stacked modals don't collide). New dialogs should
NOT roll their own fixed-inset scrim — they should compose
`<Modal open={…} onClose={…} title={…}>{children}</Modal>`.

Adoption is now project-wide as of round 16: TemplatesDialog,
SafeZoneWarningModal, FixWizard, ThumbnailVariants, CustomPresetManager,
HotkeyOverlay and NameDialog all use `<Modal>`. The only "modal-shaped"
UIs that DON'T use it are the image-studio and audio-studio export bars,
which are inline panels, not dialogs. If you find yourself writing
`fixed inset-0 bg-black/70` again, stop — that's a bug.

**A dialog with nothing to decide has one dismiss control, and it says "Close"**
(T-92). Not "Esc", "✕", "Done" or "Cancel": the header's Close is the control, and
the Esc hint lives only in the shortcuts dialog's footer. A dialog that asks a
question pairs a verb with "Cancel" (`Export anyway` / `Cancel`). "Done" belongs to
the end of the tutorial tour. `BRANDING_GUIDE.md` has the full copy rules.

**Ask for one value with `<NameDialog>`** (`components/NameDialog.tsx`)
rather than building another one-field dialog: title, labelled field,
Cancel and a confirm button, Enter to submit, blank refused. It is what
the mood-board rename and the first-save flow both use (T-28). And
never `window.prompt` / `window.alert` — Electron does not implement
them, so the call throws inside the click handler and the control is
silently dead. `tests/unit/interactionWiring.test.ts` fails the build on
any `prompt` call in `src/`.

**Two z-layers, and only two.** Dialogs sit at `z-[1200]` (Modal's
scrim) and the tutorial coachmark at `z-[1000]`; react-hot-toast's own
container is above both. A Modal can only ever open OVER a coachmark, so
that order is also the order of the Escape claim — the dialog that owns
the keyboard is the one on top of the screen (T-73). Don't introduce a
third layer; compose `<Modal>` and inherit the one that exists.

---

## Layout

- **Studios** are full-height flex columns: a `header` row, then content.
- **Side panels** use a responsive grid:
  `grid-cols-1 lg:grid-cols-[1fr_clamp(MIN,PCT,MAX)]`. Never a fixed
  pixel panel width — see "Resolution" below.
- **Modals** are `fixed inset-0` with a `bg-black/70` scrim, a centered
  `bg-elevated` card, `max-w-*` + `max-h-[NNvh]`, and a header row with
  a close control. The scrim closes a dialog on a click that began AND ended on it, never on the tail of a drag that
  started in the card (T-123).
- **Spacing** is Tailwind's scale. Cards: `p-3` to `p-6`. Gaps between
  sections: `gap-4`/`gap-5`. Tight control rows: `gap-1.5`/`gap-2`.
- **A row of controls wraps; it never scrolls sideways (T-123).** A row that holds fixed-width controls (a labeled
  box and a group of preset buttons, three labeled number boxes, five option buttons) is `flex flex-wrap`, or its
  buttons take the width their label needs and share the row (`flex-1 whitespace-nowrap`), so it fits the narrowest
  box it can land in: the `clamp()` column's minimum (260 px for Stream Graphics' layers and Properties) and the 1024 px
  window minimum, not only the default 1632 px window. A `flex-1` input is `min-w-0`, or it is as wide as its content and pokes
  past the card. A `<select>` fails BOTH ways (T-124 (24)): without `min-w-0` it is as wide as its longest option and pokes past
  the card; with it, it shrinks and CLIPS the selected option's text ("60 Hz — US," of "60 Hz — US, Canada"), and its own
  `scrollWidth` equals its `clientWidth` whatever is cut, so the overflow checks cannot see it. A select therefore gets the room
  its selected text needs at the narrowest column (a label stacked above a full-width select, as the Power-line row is; option
  labels written short enough, "YouTube, TikTok, Reels (−14)"), and `expectSelectsWhole` measures it. The trap: a column with `overflow-y-auto` computes its x-overflow to `auto` too, with a
  scrollbar nobody sees, so a too-wide row is clipped silently and looks like a design choice (the Rotation row showed
  "0" and "15" of seven presets at every window size for ten sweeps). `tests/e2e/layout.ts` measures it
  (`expectNoHorizontalOverflow`: `scrollWidth <= clientWidth` and nothing past the right edge;
  `expectControlsWhole`: each control inside its box and its own text not cut off; `expectSelectsWhole`: the SELECTED option's
  text against the select's content box less its padding and arrow; `expectNoOverlap`: nothing drawn over anything else, which
  the Text overlays card's Font select under "Size" and a layer name painted over its "Move layer up" button both passed the
  others; `expectOneLine`: a label or readout that wraps by the word, "x / y" on three lines or "-25 dB" on two) at
  `DEFAULT_WINDOW` and `MIN_WINDOW`, because every behavior case reaches a control with `click()`, which scrolls it into view
  first. A new panel row gets its case beside those. A row of a name and its actions wraps the actions onto their own line
  (the Layers panel's rows: `flex flex-wrap`, the name `min-w-[7rem]`, the four buttons together at the right), and a slider's
  readout is `shrink-0 whitespace-nowrap` on the label's row, above a full-width slider (`ParamSlider`).
- **A glyph that belongs to a box wraps WITH it (T-125 (17)).** A flex row that wraps by item can break
  between a connector and what it connects: the Source time row left "→" at the end of one line and its
  end box under it. The connector, the box and the unit are one `flex items-center` span, so the row breaks
  before the group. `expectSameRow` measures that the pieces share a line. A card of three columns of
  boxes in a 300 px card gives each a third, and a `<select>` or a label of more than a short word does not
  fit in it: the Picture-in-picture card is two boxes to a row and the Position select on a row of its
  own (T-125 (12)), and a label column is as wide as its longest label ("Size (px)": `w-14`).

---

## Iconography

imagii ships **one icon set** — the inline-SVG `Icon` component
(`components/Icon.tsx`). 24×24 viewBox, 2px strokes, round caps,
`currentColor`. No emoji in the UI (see `STYLE_GUIDE.md` for the rule
and the rationale). To add an icon, add a path to `Icon.tsx`; never
inline a one-off SVG or use an emoji glyph.

Icon sizing convention:
- Inline with body text: omit `size` (defaults to `1em`).
- In buttons / labels: `size={13}`–`size={15}`.
- Hero / empty-state: `size={26}`–`size={48}`.

---

## Resolution & DPI

imagii must look right on **1080p, 1440p (2K), and 4K** monitors.

- **Window size** adapts to the display via
  `shared/windowSizing.ts` — never a fixed default.
- **Side panels** use `clamp()` widths so they scale with the window
  but stay bounded (readable on 1080p, not dominant on 4K).
- **The Stage canvas** fits its container and may zoom past 1× (capped
  at 4×) so a 1080p document fills a 4K editing area.
- **Export scale** defaults from the display's pixel ratio
  (`defaultExportScale`, `ExportDialog.tsx`): 3x at 2.5 and above, 2x
  from 1.75, otherwise 1x, so HiDPI exports match what the user sees.
- Chromium handles CSS pixels correctly at any DPR; Konva auto-tracks
  `devicePixelRatio`. Do not add manual DPI scaling to CSS.

---

## Accessibility

- Every icon-only button has a `title` or `aria-label`.
- Decorative icons are `aria-hidden` (the `Icon` component does this
  automatically when no `title` is passed).
- Interactive elements keep a visible focus ring (`focus:ring-2
  focus:ring-accent` — baked into `.btn-*`). An element that removes the browser's
  outline with `outline-none` brings a ring of its own in the same `className` (`focus:ring-1 focus:ring-accent` on an inline
  field, `focus-visible:ring-2` elsewhere); a background that changes on focus is not a ring - the clip rename field's
  was 1.06:1 against its card (T-119). `a11ySweep.test.ts` rule 5 fails on `outline-none` with no `focus:ring-` or
  `focus-visible:ring-` beside it, except the `role="dialog"` card, which is only ever focused by script.
- Color is never the only signal — pair it with text or an icon. A control that
  is one of a set and shows which is selected - by its fill, its border, a ring
  or a wash - also says it with `aria-pressed` (a tab strip's open tab,
  `aria-current`); a bar that shows a number is a `progressbar` or `meter`,
  named and valued (T-114: the Export queue's bar is named for its job). A row
  that selects has a real button in it, not only a clickable `<li>`: the button is
  what takes focus and answers Enter and Space, and the row carries
  `aria-current` as well (a row whose button is narrow keeps its own `onClick`
  too, so a click in its blank space still selects).
  `a11ySweep.test.ts` rule 1 fails on a button or anything with an `onClick`
  whose class swaps to one of those styles without a state attribute.
- A toggle that is named for its STATE says it with `aria-pressed` and a name that stays put
  ("Layer visible"); a title that changes with the state is a tooltip, not the name. A control
  named for its ACTION is the other standard pattern, and it is not given `aria-pressed`: the
  name flips with the state and says what pressing will do ("Play" / "Pause" on the player's
  transport, "Lock layer" / "Unlock layer"). The two must not be mixed on one control - a name
  that flips and `aria-pressed` together read as the opposite of what the button does.
- A control that is shown on hover (`opacity-0 group-hover:opacity-100`, the Save and "→ Canvas"
  buttons on a reference tile) is shown on KEYBOARD focus too: `has-[:focus-visible]:opacity-100` on the
  container (T-116). A button drawn at opacity 0 still takes Tab, and a keyboard user pressed Enter on it
  blind. It is `:focus-visible`, not `focus-within`: a mouse click focuses the button as well, and
  `focus-within` kept the scrim lit over the picture until focus moved on, long after the pointer had
  left. `a11ySweep.test.ts` rule 4 fails on a hover-only container that holds a button, link or field and
  does not show on `:focus-visible` (the old `focus-within` spelling fails it too).
- Scrollable regions without focusable children are made focusable
  (`tabIndex={0}`, an `aria-label` and `focus-visible:ring-2`, with a role when
  it is not already a list): Chromium 126 has
  no focusable scrollers, so a keyboard user could not scroll them at all. A
  dialog that asks a question opens on its safe answer (`data-initial-focus`),
  not on the first thing in the DOM with a tab stop - which is often exactly
  such a scroller.

---

## When this guide changes

If a design decision changes the rules above, update this file in the
**same commit**. The `design-reviewer` agent and the `/guide-sync`
command both treat this document as authoritative — stale guidance is
worse than none.
