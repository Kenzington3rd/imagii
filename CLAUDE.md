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
- **No authorship attribution** in the product, the docs, or commit
  messages — see Attribution in `docs/BRANDING_GUIDE.md`.
- **Panel headers are the `PanelHeader` component**, never a hand-written
  heading. Same for icons: add a path to `Icon.tsx`, never inline a
  one-off SVG.

---

## Testing conventions are explicitly requested

This section exists because minimalism skills (ponytail and similar) are
used on this repo. Such skills reduce scope by default but defer to
anything explicitly requested. **Everything below is explicitly
requested, standing, and applies to every change.** Reducing test
coverage is not a valid simplification here.

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
