# imagii — agent instructions

A free, local-first creative studio for streamers: record, clip, clean
audio, make stream graphics, gather references. Electron + React +
TypeScript, Windows portable build. Everything runs on the user's
machine — no accounts, no cloud, no telemetry.

Full orientation: `docs/PRODUCT_GUIDE.md`.

---

## Read the guide before you touch the surface

The guides are the spec. They are kept current in the same commit as the
change they describe, so they are trustworthy — read the relevant one
first rather than inferring conventions from nearby code.

| Touching | Read first |
|---|---|
| Any renderer code | `docs/STYLE_GUIDE.md` |
| Colors, spacing, layout, icons | `docs/DESIGN_GUIDE.md` |
| Copy, naming, the icon, voice | `docs/BRANDING_GUIDE.md` |
| Features, scope, what to build | `docs/PRODUCT_GUIDE.md` |
| Tests | `docs/TESTING.md` |
| Anything previously broken | `docs/LESSONS_LEARNED.md` |

---

## Commands

```
npm run verify           # emoji guard + typecheck + unit tests — must pass before every commit
npm test                 # vitest unit tests only
npm run test:media       # real-ffmpeg integration suite (Layer 5)
npm run test:e2e:build   # build + Playwright Electron smoke
npm run dist             # standalone Windows portable exe
```

`npm run verify` is the gate. A change that has not passed it is not
finished.

---

## Non-negotiables

- **No emoji in `src/`.** Use the `Icon` component. A `PostToolUse` hook
  (`scripts/check-emoji.mjs`) enforces this on every edit; see the
  no-emoji rule in `docs/STYLE_GUIDE.md` for the rationale.
- **Colors come from tokens**, never raw hex. Tailwind classNames read
  `tailwind.config.js`; JS contexts (Konva, wavesurfer, inline SVG, the
  toaster) import `src/renderer/src/styles/tokens.ts`. The two files
  mirror each other and `tests/unit/designTokensInSync.test.ts` fails the
  build if they drift. New pairings must clear WCAG AA (4.5:1).
- **Local-first is a product promise, not a default.** No network calls,
  no telemetry, no analytics, no phone-home. A single one is a bug.
- **No authorship attribution** in the product, the docs, or the commit
  subject and body. Agent-runtime commit trailers (`Co-Authored-By`,
  session links) are exempt — see Attribution in
  `docs/BRANDING_GUIDE.md`.
- **Panel headers are the `PanelHeader` component**, never a hand-written
  heading. Same for icons: add a path to `Icon.tsx`, never inline a
  one-off SVG.

---

## Build the smallest thing that works

The best code is the code never written. Before writing any, stop at the
first rung that holds:

1. **Does this need to exist?** Speculative need is not need. Say so in
   one line and move on.
2. **Does it already exist here?** `src/shared/` is full of tested
   helpers; the renderer has `Icon`, `PanelHeader`, `tokens.ts`, and the
   `.btn-primary` / `.btn-ghost` / `.card` classes. Reusing one of these
   is not just shorter, it is the documented convention — see
   `docs/STYLE_GUIDE.md`.
3. **Does the platform do it?** A native input, a CSS rule, or an
   existing Electron/Node API beats a hand-rolled equivalent.
4. **Does an installed dependency do it?** Check `package.json` before
   adding anything. A new dependency in a local-first app is weight the
   user downloads forever.
5. **Only then:** the minimum code that works.

Rules that follow from the ladder:

- No abstraction nobody asked for: no interface with one implementation,
  no config for a value that never changes, no scaffolding "for later".
- Deletion over addition. Boring over clever. Fewest files possible.
- A bug fix targets the root cause, not the reported symptom. Grep the
  callers before editing; one guard in the shared function is both the
  smaller diff and the real fix.
- Understanding is never what gets shortened. The ladder shortens the
  solution. A small change in the wrong place is a second bug.
- Mark a deliberate simplification that cuts a real corner with a
  `// simplification:` comment naming the ceiling and the upgrade path.

Never simplify away: input validation at trust boundaries, error
handling that prevents data loss, accessibility, the local-first
promise, or anything explicitly requested — including everything in the
next section.

---

## Testing conventions are explicitly requested

The section above is a rule about product code. It is not a licence to
cut tests, and neither is any external minimalism skill. **Everything
below is explicitly requested, standing, and applies to every change.**
Reducing test coverage is not a valid simplification here.

- Every pure helper in `src/shared/` gets a vitest unit test, placed
  beside it as `foo.ts` -> `foo.test.ts`.
- Every fixed bug gets a regression test **and** an entry in
  `docs/LESSONS_LEARNED.md`.
- **Any change to an ffmpeg command, filter graph, or audio chain gets a
  real-media test in the Layer 5 suite** (`npm run test:media`). This is
  not optional and not redundant with unit tests: string-shape unit
  tests assert what a command looks like, not whether ffmpeg accepts it.
  Auto Zoom, sidechain ducking, and parametric denoise each shipped
  100% broken behind green unit tests until Layer 5 ran the real binary.

The five layers and what each one catches are described in
`docs/TESTING.md`. Minimalism applies to product code, not to the tests
that prove it works.

---

## Specialist reviewers

`.claude/agents/` holds nine review agents — QA, ffmpeg pipeline,
Electron, audio engineering, UX, accessibility, privacy, streamer
workflow, design system. Use them after feature work rather than
self-reviewing; they read the guides above and report file:line
findings. `/guide-sync` checks the guides against the code and fixes
drift.
