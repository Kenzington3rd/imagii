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
| `bg-base` | `#0b0b0f` | App background, deepest layer |
| `bg-elevated` | `#16161e` | Cards, panels, modals |
| `bg-hover` | `#20202c` | Hover state for interactive surfaces |
| `accent` | `#a78bfa` | Primary actions, focus rings, active states |
| `accent-muted` | `#7c5cf0` | Hover state of accent elements |
| `ink-base` | `#e5e5ee` | Primary text |
| `ink-muted` | `#9595a5` | Secondary text, labels |
| `ink-dim` | `#8b8b9c` | Tertiary text, borders, disabled — bumped 2026-05-20 (round 15) from `#5d5d6e` after a contrast review found the prior value at ~3.04:1 on `bg-base`, below WCAG AA's 4.5:1 minimum. `#8b8b9c` measures ~6.6:1. |

**Font:** Inter (`font-sans`), with `system-ui` fallbacks. One family,
weights 400/500/600.

**Documented raw-color exceptions.** Three places use raw hex / rgba
deliberately; nowhere else may:

- **NavCard accent washes.** Per-studio NavCard accents on the Home
  screen use one-off rgba values (each studio has a tint).
- **AppToaster.** The toast styling passes raw hex because the toaster
  renders outside the Tailwind-themed tree.
- **ErrorBoundary.** The render-error fallback (`components/ErrorBoundary.tsx`)
  uses inline-style raw hex on purpose — the error may originate in
  layout itself, so the fallback avoids Tailwind classes that depend on
  shared layout context.

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
and focus restore. New dialogs should NOT roll their own fixed-inset
scrim — they should compose `<Modal open={…} onClose={…} title={…}>{children}</Modal>`.
TemplatesDialog is the reference implementation.

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
