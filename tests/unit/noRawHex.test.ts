import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { RENDERER_ROOT } from './routeSources'
import { allLiterals, parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-104 — no raw palette hex in renderer source.
 *
 * CLAUDE.md: "Colors come from tokens, never raw hex." The rule was enforced by
 * review and by `designTokensInSync`, which can only compare the two token files
 * with each other. It cannot see a hex that was never put in either — and two
 * panels had carried five of them (HighlightPanel's Chat and Hype signal bars,
 * SafeZoneOverlay's 9:16, 1:1 and 4:5 guides) since the day they were written:
 * nothing failed and nothing looked wrong, and a retheme would have walked past
 * every one of them (the T-56 / T-71 story, a third time).
 *
 * This reads the syntax tree of every renderer source file and fails on a string
 * that contains a `#rgb` / `#rrggbb` / `#rrggbbaa` color, wherever the string is
 * (a style, an SVG stroke, a Konva fill, a constant). Comments are not strings,
 * so prose that names a color is fine. Test files are not scanned and neither is
 * `styles/tokens.ts`, the one file whose job is to hold the hex.
 *
 * What is allowed to stay is exactly what docs/DESIGN_GUIDE.md ("Documented
 * raw-color exceptions") says may — and the list is a list of FILES and
 * LITERALS, not a pattern, so a new exception is a visible edit to this file
 * and to that guide, not a quiet one.
 */

/** Hex colors: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, delimited like a color. */
const HEX_COLOR = /(?:^|[^\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/

/** Whole files that are documents or pre-theme fallbacks (DESIGN_GUIDE.md). */
const EXEMPT_FILES: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: path.join('components', 'ErrorBoundary.tsx'),
    why: 'the crash screen avoids Tailwind and layout dependencies on purpose'
  },
  {
    file: path.join('modules', 'image-studio', 'templates.ts'),
    why: 'artwork: template compositions end up as pixels in the user\'s export'
  },
  {
    file: path.join('modules', 'references', 'assetCatalog.ts'),
    why: 'artwork: asset cards are compositions, not chrome'
  }
]

/** Single literals in files that are otherwise held to the rule. */
const EXEMPT_LITERALS: ReadonlyArray<{ file: string; text: string; why: string }> = [
  {
    file: path.join('modules', 'image-studio', 'state', 'canvasStore.ts'),
    text: '#ffffff',
    why: 'the blank page is white paper: artwork, not chrome (DESIGN_GUIDE.md)'
  },
  {
    file: path.join('modules', 'video-studio', 'OutputPreview.tsx'),
    text: '#000',
    why: 'the preview canvas is a picture of EXPORT pixels, and an export\'s bars are black'
  },
  {
    file: path.join('modules', 'video-studio', 'TextOverlayEditor.tsx'),
    text: 'white or #ffcc00',
    why: 'a typing example shown to the user in a placeholder, not a color drawn'
  }
]

export interface HexHit {
  file: string
  line: number
  text: string
}

/** Every string in `sf` that holds a hex color and is not an allowed exception. */
export function rawHexHits(sf: ReturnType<typeof parseSource>, relFile: string): HexHit[] {
  if (EXEMPT_FILES.some((e) => e.file === relFile)) return []
  return allLiterals(sf)
    .filter((l) => HEX_COLOR.test(l.text))
    .filter((l) => !EXEMPT_LITERALS.some((e) => e.file === relFile && e.text === l.text))
    .map((l) => ({ file: relFile, line: l.line, text: l.text }))
}

const TOKENS = path.join('styles', 'tokens.ts')
const FILES = sourceFilesUnder(RENDERER_ROOT).filter(
  (f) => path.relative(RENDERER_ROOT, f) !== TOKENS
)

/** The renderer's `.css` and `.html` (outside the syntax-tree scan above). */
function styleSheetsUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 8) return
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      if (statSync(full).isDirectory()) walk(full, depth + 1)
      else if (/\.(css|html)$/.test(name)) out.push(full)
    }
  }
  walk(dir, 0)
  return out
}

describe('renderer source holds no raw hex color (T-104)', () => {
  it('finds the sources (the scan is not vacuously empty)', () => {
    const rels = FILES.map((f) => path.relative(RENDERER_ROOT, f))
    for (const must of [
      path.join('modules', 'video-studio', 'HighlightPanel.tsx'),
      path.join('modules', 'video-studio', 'SafeZoneOverlay.tsx'),
      path.join('modules', 'image-studio', 'Canvas.tsx')
    ]) {
      expect(rels).toContain(must)
    }
    expect(rels).not.toContain(TOKENS)
    expect(FILES.length).toBeGreaterThan(80)
  })

  for (const file of FILES) {
    const rel = path.relative(RENDERER_ROOT, file)
    it(`${rel}: every color comes from tokens.ts`, () => {
      expect(rawHexHits(parseSource(file), rel)).toEqual([])
    })
  }

  it('the style sheets and index.html hold none either', () => {
    const sheets = styleSheetsUnder(path.resolve(RENDERER_ROOT, '..'))
    expect(sheets.length).toBeGreaterThan(0)
    for (const sheet of sheets) {
      const text = readFileSync(sheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(text.match(new RegExp(HEX_COLOR, 'g')) ?? [], sheet).toEqual([])
    }
  })

  it('every exception still exists and still needs it (a stale one is a hole)', () => {
    for (const e of EXEMPT_FILES) {
      const hits = allLiterals(parseSource(path.join(RENDERER_ROOT, e.file))).filter((l) =>
        HEX_COLOR.test(l.text)
      )
      expect(hits.length, `${e.file} (${e.why}) no longer holds a hex color`).toBeGreaterThan(0)
    }
    for (const e of EXEMPT_LITERALS) {
      const texts = allLiterals(parseSource(path.join(RENDERER_ROOT, e.file))).map((l) => l.text)
      expect(texts, `${e.file} (${e.why}) no longer holds ${e.text}`).toContain(e.text)
    }
  })
})

describe('the scan discriminates — it fires on the code that shipped', () => {
  const run = (src: string, rel = path.join('modules', 'video-studio', 'HighlightPanel.tsx')): string[] =>
    rawHexHits(parseSource(rel, src), rel).map((h) => h.text)

  it('catches HighlightPanel\'s two bars, as they were written', () => {
    expect(
      run(`
        const a = <SignalBar label="Chat" value={v} color="#f472b6" />
        const b = <SignalBar label="Hype" value={v} color="#fbbf24" />
      `)
    ).toEqual(['#f472b6', '#fbbf24'])
  })

  it('catches SafeZoneOverlay\'s guide map, as it was written', () => {
    expect(
      run(
        `const RATIO_COLOR: Record<string, string> = {
          '9:16': '#f472b6', '1:1': '#fbbf24', '4:5': '#22d3ee', '16:9': ACCENT
        }`,
        path.join('modules', 'video-studio', 'SafeZoneOverlay.tsx')
      )
    ).toEqual(['#f472b6', '#fbbf24', '#22d3ee'])
  })

  it('catches every form a color is written in, and in a template or a style string', () => {
    expect(run(`const c = '#fff'`)).toEqual(['#fff'])
    expect(run(`const c = '#FFFF'`)).toEqual(['#FFFF'])
    expect(run(`const c = "#ff3131"`)).toEqual(['#ff3131'])
    expect(run('const c = `#ff313180`')).toEqual(['#ff313180'])
    expect(run(`const s = { border: '1px solid #352a2a' }`)).toEqual(['1px solid #352a2a'])
    expect(run('const s = `2px dashed #22d3ee ${x}`')).toHaveLength(1)
  })

  it('leaves what is not a color alone', () => {
    // A token, a name, a comment that names a hex, an entity, a hashtag, an anchor.
    expect(run(`const c = ACCENT`)).toEqual([])
    expect(run(`// the old #f472b6 was pink-400\nconst c = EMBER`)).toEqual([])
    expect(run(`/* #fbbf24 */ const c = EMBER`)).toEqual([])
    expect(run(`const e = '&#8212;'`)).toEqual([])
    expect(run(`const tag = '#gaming #fyp'`)).toEqual([])
    expect(run(`const href = '#/video'`)).toEqual([])
    expect(run(`const id = 'section-#3'`)).toEqual([])
  })

  it('the exceptions are exact: the literal is allowed in ITS file and nowhere else', () => {
    const preview = path.join('modules', 'video-studio', 'OutputPreview.tsx')
    expect(run(`ctx.fillStyle = '#000'`, preview)).toEqual([])
    // the same literal elsewhere is a violation…
    expect(run(`ctx.fillStyle = '#000'`)).toEqual(['#000'])
    // …and so is any OTHER literal in the exempt file.
    expect(run(`ctx.fillStyle = '#f472b6'`, preview)).toEqual(['#f472b6'])
    // A whole-file exception covers the file, not the neighbors.
    const templates = path.join('modules', 'image-studio', 'templates.ts')
    expect(run(`const fill = '#ff3131'`, templates)).toEqual([])
    expect(run(`const fill = '#ff3131'`, path.join('modules', 'image-studio', 'Canvas.tsx'))).toEqual([
      '#ff3131'
    ])
  })
})
