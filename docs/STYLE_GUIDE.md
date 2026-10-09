# imagii — Style Guide

Code-level conventions for the imagii renderer and shared code. The
**visual** system is in `DESIGN_GUIDE.md`; this document is about how
the code is written. The `design-reviewer` agent enforces it.

---

## The no-emoji rule

**No emoji in the UI.** Emoji pictographs render differently on every OS
and every OS version — a 🎬 is not the same glyph on Windows 10,
Windows 11, and macOS, and some render in color, some in monochrome.
That inconsistency is unacceptable for a polished product.

Replace every emoji with the `Icon` component:

```tsx
// Wrong
<button>💾 Save project</button>
const LABELS = { overlay: '🎮 Overlays' }
toast('Done', { icon: '🗑' })

// Right
<button className="inline-flex items-center gap-1.5">
  <Icon name="save" size={15} /> Save project
</button>
const LABELS = { overlay: 'Overlays' }            // icon rendered separately
toast('Done', { icon: <Icon name="trash" size={18} /> })
```

**Allowed:** geometric typographic glyphs that render identically
everywhere — `✕` (close), `·` (separator), `–`/`—` (dashes), `→`/`←`
inside body copy. These are punctuation, not emoji. For *new* close
controls prefer `<Icon name="close" />`; existing `✕` buttons are fine.

**Enforcement:** a `PreToolUse`/`Stop` hook (see `.claude/settings.json`)
greps `src/` for emoji ranges on every change. CI-style: if it fires,
the emoji must be removed before the change is considered done.

---

## The Icon system

One icon set: `components/Icon.tsx`. Inline SVG, 24×24 viewBox, 2px
strokes, `currentColor`.

- Add an icon by adding a key to the `IconName` union and a path to
  `ICON_PATHS`. TypeScript's `Record<IconName, JSX.Element>` guarantees
  every name has a path.
- Never inline a one-off `<svg>` in a component. Never use an `<img>`
  for an icon. Never use a glyph character where an `Icon` fits.
- Decorative by default (`aria-hidden`); pass `title` for a meaningful,
  labelled icon.

---

## Shared affordances

Repeated UI is a component, not copy-paste:

- **`HomeLink`** — the "back to Home" link in every studio header.
- **`OutputDirLabel`** — the folder-icon + basename chip in export
  panels. Its `basename()` helper is pure and unit-tested.
- **`AppToaster`** — the app-wide toast surface. Mounted exactly once, in
  `App.tsx` beside `HotkeyOverlay`, so every route has it. Never mount a
  second one in a studio: react-hot-toast keeps one toast store per
  toaster id and each `<Toaster>` draws all of it, so two mounts render
  every toast twice (T-31).
- **`reportFailure(err, { failed, canceled? })`** (`lib/reportFailure.ts`,
  over `userFacingError` in `@shared/userFacingError`) — what EVERY `catch`
  around a `window.api.*` call does (T-84). Electron wraps anything an
  `ipcMain.handle` handler throws in
  `Error invoking remote method '<channel>': Error: …`, and the runners'
  own messages are ffmpeg's ("FFmpeg exit 1: …"), so
  `toast.error(err.message)` showed the user a channel name, the word
  "remote" for work that never left their machine, and an encoder's stderr
  (T-30, T-59, T-84). The helper strips the envelope, maps known shapes (an
  encoder exit, a missing or locked file, a full disk, no network, a refused
  capture device) to the caller's `failed` sentence plus one plain cause,
  lets a finished sentence main wrote stand alone, and otherwise shows just
  `failed`; **the raw error always goes to the console**. `failed` is a full
  sentence with its period ("GIF export failed."). A failure raises
  `toast.error` for 8 s. **Never write `toast.error(err.message)`, or read
  `.message` in a `catch` outside a `console` call** —
  `tests/unit/failurePathLanguage.test.ts` parses the renderer and fails on
  it, and lists every site that must route through the helper.
- **Cancel is a fact, not a string.** Pressing Cancel SIGKILLs the child,
  which exits non-zero exactly like a crash. Main marks the kill —
  `killAsCancelled(child)` in a runner's cancel function,
  `cancelledOr(child, failure)` in its close handler
  (`src/main/ffmpeg/cancelMark.ts`) — and the rejection carries the one
  sentinel `CANCELLED_MESSAGE` (`@shared/cancel`; `ConvertCancelledError`
  is a subclass). `userFacingError` reports it as `cancelled: true` and
  `reportFailure` raises a plain `toast(canceled)` in the feature's own
  words — never `toast.error`, never in ffmpeg's. **The renderer never
  string-matches ffmpeg text to detect a cancel.** A new cancellable runner
  needs both halves and a row in
  `src/main/ffmpeg/cancelSentinel.test.ts`. Rows that stopped (the export
  queue) keep saying "Failed" or "Canceled" after the toast fades.
- **`ipcErrorMessage(err, fallback)`** (`@shared/ipcError`) — the
  envelope-stripping step `userFacingError` starts with. Still the right
  call for a site that wants only main's own sentence (the T-30/T-59 sites:
  Record's source list and save, the autosave clear).
- **`useUndoRedoHotkeys(undo, redo)`** — the window-level
  Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z binding for a studio's own history
  (`hooks/useUndoRedoHotkeys.ts`). Video, Audio, Image and References all
  call it; its pure `undoRedoIntent` half is what the unit test drives.
  Never hand-roll another copy of the branch.
- **`useFocusTrap(active, ref)`** (`hooks/useFocusTrap.ts`) — the app's
  ONE focus trap: focus in on arrival, Tab cycling, focus restore on
  close. It also takes the dialog's claim on the window and returns the
  `isTopmost()` predicate the caller's own key handler must consult, so
  one Escape closes one dialog (T-73). `Modal` and the tutorial
  coachmark both call it; a third copy of a trap is a bug. Its pure
  `isTopmostClaim` half is what the unit test drives.
- **`<NameDialog>`** (`components/NameDialog.tsx`) — "ask the user for
  one name", the whole of it: Modal chrome, a labelled field, Enter or
  the confirm button, a blank name refused, Cancel/Escape/scrim leaving
  the caller untouched. **Never `window.prompt` or `window.alert`** —
  Electron does not implement them, so the call throws inside the click
  handler and the control looks fine while doing nothing (T-28).
  `tests/unit/interactionWiring.test.ts` parses `src/` and fails on any
  `prompt` call.
- **`PanelHeader`** — every panel section header. Renders the standard
  `<h3>` (`text-xs font-semibold uppercase tracking-wide text-ink-muted`,
  an `Icon`, `inline-flex items-center gap-1.5`). Pass an `actions`
  prop for a right-aligned control and it renders the
  `flex items-center justify-between` row for you. **Never hand-write a
  panel-header `<h3>`** — use `<PanelHeader icon="…">Label</PanelHeader>`.

```tsx
<PanelHeader icon="palette">Color & motion</PanelHeader>
<PanelHeader icon="bolt" actions={<button>Scan</button>}>
  Smart highlight finder
</PanelHeader>
```

If you write the same markup a third time, extract it.

---

## TypeScript conventions

- **Strict everywhere.** Both tsconfigs run `noUnusedLocals`,
  `noImplicitReturns`, `noUncheckedIndexedAccess`, etc. Don't fight
  them — fix the root cause.
- **No `!` non-null assertions.** Use `assertDefined(value, name)` from
  `shared/assert.ts`. It throws (dev and prod) with a named message.
- **`assert(cond, msg)`** at the top of functions that take untrusted
  or wide input — Power of Ten rule 5.
- **IPC handlers** validate their inputs at the boundary and return
  `{ ok: false, reason }` rather than throwing across the bridge.

## Power of Ten

imagii follows Holzmann's 10 rules (see
`~/.claude/.../memory/governance_power_of_ten.md`). The ones that bite
most often: functions ≤ ~60 lines, ≥2 assertions per function, all
loops bounded, no recursion, check every return value.

---

## Tests

- Pure logic gets a unit test. Vitest, `environment: 'node'` — **no
  DOM**, so test pure functions, not React rendering.
- Every fixed bug gets a regression test **and** an entry in
  `LESSONS_LEARNED.md`.
- Test files sit next to the code: `foo.ts` → `foo.test.ts`.

---

## When this guide changes

A convention change updates this file in the **same commit** as the
code. The `/guide-sync` command and the `design-reviewer` agent treat
this document as authoritative.
