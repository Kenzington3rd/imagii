#!/usr/bin/env node
/**
 * Emoji guard — enforces the no-emoji rule from docs/STYLE_GUIDE.md.
 *
 * Scans the renderer + shared + main source for emoji pictographs and
 * fails (exit 1) if any are found. Wired as a Claude Code hook in
 * .claude/settings.json so every change is checked automatically, and
 * runnable by hand: `node scripts/check-emoji.mjs`.
 *
 * Why a script and not just code review: emoji slip in easily (a copied
 * snippet, a toast icon) and render inconsistently across OSes. A
 * deterministic grep is the only reliable gate.
 *
 * Allowed and NOT flagged:
 *   - Geometric typographic glyphs: U+2715 (X), middle dot, dashes,
 *     plain arrows. These render identically everywhere.
 *   - Test files (*.test.ts / *.test.tsx) — fixtures legitimately
 *     contain emoji to prove the app strips them.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Emoji + pictograph + technical/shape-glyph ranges (global, so we can
// inspect every match). Covers: Misc Technical (⏸⏮⏭…), Misc Symbols,
// Dingbats, Geometric Shapes (▶▾▸◌…), and the emoji planes. The design
// review of 2026-05-11 found media-control and disclosure glyphs that an
// emoji-only regex had missed — this range closes that gap.
const EMOJI =
  /[\u{2300}-\u{23FF}\u{25A0}-\u{27BF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]/gu

// Glyphs the style guide explicitly permits — they render identically on
// every OS, so they are not "emoji" for this rule. Close mark and check
// mark. Arrows (←→↑↓) and dashes/dots fall outside the ranges above and
// are unaffected. See docs/STYLE_GUIDE.md "The no-emoji rule".
const ALLOWED = new Set(['✕', '✓'])

const ROOTS = ['src/renderer', 'src/main', 'src/shared']
const SKIP_DIR = new Set(['node_modules', 'dist', 'out', '.git'])

/** Recursively collect .ts/.tsx files, excluding tests. Bounded by the tree. */
function collect(dir, acc) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      collect(full, acc)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      acc.push(full)
    }
  }
  return acc
}

const files = []
for (const root of ROOTS) collect(root, files)

const hits = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const matches = line.match(EMOJI)
    if (!matches) return
    // A line is a hit only if it contains at least one non-allowlisted
    // emoji char. Allowed geometric glyphs (✕, ✓) don't count.
    const offending = matches.filter((ch) => !ALLOWED.has(ch))
    if (offending.length > 0) {
      hits.push(`${file}:${i + 1}: ${line.trim()}  [${offending.join(' ')}]`)
    }
  })
}

if (hits.length > 0) {
  console.error('Emoji found in source (see docs/STYLE_GUIDE.md — use <Icon>):')
  for (const h of hits) console.error('  ' + h)
  console.error(`\n${hits.length} line(s). Replace each emoji with an <Icon name="…" />.`)
  process.exit(1)
}

console.log(`check-emoji: clean (${files.length} files scanned)`)
process.exit(0)
