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
weights 400/500/600.

**Documented raw-color exceptions.** Four places use raw hex / rgba
deliberately; nowhere else may:

- **NavCard accent washes.** Per-studio NavCard accents on the Home
  screen use one-off rgba values (each studio has a tint).
- **AppToaster.** The toast styling passes raw hex because the toaster
  renders outside the Tailwind-themed tree.
- **ErrorBoundary.** The render-error fallback (`components/ErrorBoundary.tsx`)
  uses inline-style raw hex on purpose — the error may originate in
  layout itself, so the fallback avoids Tailwind classes that depend on
  shared layout context.
- **Document content** (T-71). `image-studio/templates.ts`,
  `references/assetCatalog.ts`, and the blank page's `background:
  '#ffffff'` in `canvasStore.ts` describe **artwork**, not chrome: they
  are compositions with per-template alphas that a designer tuned by eye,
  and they end up as pixels inside the user's exported PNG. A chrome
  retheme must not silently redesign a shipped template. The line: the
  app's own **default marks** — the fill and stroke a freshly drawn
  rect / ellipse / line / text layer comes out in — DO follow the tokens,
  because a user expects new shapes to arrive in imagii's colors.

**Text on a semantic fill.** Any token used as a `bg-*` under text needs
its own pairing checked — the fill tones (`accent`, `danger-strong`,
`ember`, `ok-strong`) are all bright, so the readable partner is
`text-bg-base`, the way `.btn-primary` already does it. `ink-base` on a
bright fill fails AA and looks fine while doing so; that was the T-71
finding in MoodBoardPanel's remove chip (2.93:1).

---

## Component patterns

Three CSS component classes are defined in `styles/index.css`. Use them;
do not re-derive their styling inline.

- **`.btn-primary`** — filled accent button. Primary action per surface.
- **`.btn-ghost`** — outlined button. Secondary actions.
- **`.card`** — elevated surface: `bg-elevated`, dim border, rounded-xl.

Buttons that pair an icon with a label use
`inline-flex items-center gap-1.5` (or `gap-2` at larger sizes).

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
and HotkeyOverlay all use `<Modal>`. The only "modal-shaped" UIs that
DON'T use it are the image-studio and audio-studio export bars, which
are inline panels, not dialogs. If you find yourself writing
`fixed inset-0 bg-black/70` again, stop — that's a bug.

---

## Layout

- **Studios** are full-height flex columns: a `header` row, then content.
- **Side panels** use a responsive grid:
  `grid-cols-1 lg:grid-cols-[1fr_clamp(MIN,PCT,MAX)]`. Never a fixed
  pixel panel width — see "Resolution" below.
- **Modals** are `fixed inset-0` with a `bg-black/70` scrim, a centered
  `bg-elevated` card, `max-w-*` + `max-h-[NNvh]`, and a header row with
  a close control.
- **Spacing** is Tailwind's scale. Cards: `p-3` to `p-6`. Gaps between
  sections: `gap-4`/`gap-5`. Tight control rows: `gap-1.5`/`gap-2`.

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
- **Export scale** defaults to `floor(devicePixelRatio)` so HiDPI
  exports match what the user sees.
- Chromium handles CSS pixels correctly at any DPR; Konva auto-tracks
  `devicePixelRatio`. Do not add manual DPI scaling to CSS.

---

## Accessibility

- Every icon-only button has a `title` or `aria-label`.
- Decorative icons are `aria-hidden` (the `Icon` component does this
  automatically when no `title` is passed).
- Interactive elements keep a visible focus ring (`focus:ring-2
  focus:ring-accent` — baked into `.btn-*`).
- Color is never the only signal — pair it with text or an icon.

---

## When this guide changes

If a design decision changes the rules above, update this file in the
**same commit**. The `design-reviewer` agent and the `/guide-sync`
command both treat this document as authoritative — stale guidance is
worse than none.
