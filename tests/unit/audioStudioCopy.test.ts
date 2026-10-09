import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT } from './routeSources'

/**
 * T-90 — Audio Studio speaks to a streamer, not a broadcast engineer.
 *
 * The panels carried the filter names the code is built from: "loudnorm",
 * "highpass", "de-ess", "sidechain", "mux", a "−1.5 dBTP this round" developer
 * note, "EBU R128". A user has no use for any of them and the reviewers could
 * not tell which were jargon and which were product, so the rule is mechanical:
 * none of these words appears in a string a user can read.
 *
 * What counts as "a string a user can read" is decided from the syntax tree,
 * not by grepping the file — the code legitimately says `muxBack`, `loudnorm`
 * (a ChainSpec field) and `'mux'` (a pass id) all over the place. A string is
 * READ when it is JSX text, a JSX attribute value (title, aria-label,
 * placeholder), a toast argument, or the value of a property that is copy by
 * name (label, hint, description, body, question, failed, canceled).
 *
 * LUFS is the one unit a number genuinely needs, so it may stand in
 * parentheses beside the number — "target -16 LUFS)", "(LUFS)" — and nowhere
 * else.
 */

const AUDIO_DIR = path.join(RENDERER_ROOT, 'modules', 'audio-studio')
const SHARED_AUDIO = path.resolve(__dirname, '../../src/shared/audio.ts')

const COPY_PROPS = new Set([
  'label',
  'hint',
  'description',
  'body',
  'question',
  'failed',
  'canceled',
  'title'
])
const COPY_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'aria-valuetext', 'alt'])

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}

function textOf(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  if (ts.isTemplateExpression(n)) {
    return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ')
  }
  return null
}

/** Every string in `sf` a user can read (see the header for the rule). */
export function readableStrings(sf: ts.SourceFile): string[] {
  const out: string[] = []
  const take = (n: ts.Node | undefined): void => {
    if (!n) return
    const t = textOf(n)
    if (t !== null) out.push(t)
  }
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n)) out.push(n.text)
    else if (ts.isJsxAttribute(n) && COPY_ATTRS.has(n.name.getText(sf))) {
      const init = n.initializer
      if (init && ts.isStringLiteral(init)) out.push(init.text)
      else if (init && ts.isJsxExpression(init)) take(init.expression)
    } else if (ts.isPropertyAssignment(n) && COPY_PROPS.has(n.name.getText(sf))) {
      take(n.initializer)
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf)
      if (callee === 'toast' || callee.startsWith('toast.')) take(n.arguments[0])
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Strip the one allowed use of the unit, then look for the banned words. */
export function jargonIn(strings: string[]): string[] {
  const BANNED: Array<[RegExp, string]> = [
    [/loudnorm/i, 'loudnorm'],
    [/dBTP|true-peak/i, 'dBTP / true peak'],
    [/highpass|lowpass/i, 'highpass'],
    [/de-?ess/i, 'de-ess'],
    [/sidechain/i, 'sidechain'],
    [/\bmux(ed|ing)?\b/i, 'mux'],
    [/\bnormali[sz]/i, 'normalize'],
    [/EBU|R128/, 'EBU / R128'],
    [/this round/i, 'a developer note ("this round")'],
    [/\bLUFS\b/, 'LUFS outside parentheses']
  ]
  const hits: string[] = []
  for (const raw of strings) {
    const s = raw.replace(/\(LUFS\)|\bLUFS\)/g, '')
    for (const [re, name] of BANNED) if (re.test(s)) hits.push(`${name}: "${raw.trim()}"`)
  }
  return hits
}

const SOURCES = readdirSync(AUDIO_DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => path.join(AUDIO_DIR, f))

describe('the words a streamer reads in Audio Studio', () => {
  it('finds the sources (the scan is not vacuously empty)', () => {
    const rels = SOURCES.map((f) => path.basename(f))
    for (const must of ['CleanupPanel.tsx', 'LevelsPanel.tsx', 'FixWizard.tsx', 'fixWizard.ts']) {
      expect(rels).toContain(must)
    }
    const all = SOURCES.flatMap((f) => readableStrings(parse(f)))
    expect(all.length).toBeGreaterThan(100)
  })

  for (const file of SOURCES) {
    it(`${path.basename(file)}: no engineer's word in anything it shows`, () => {
      expect(jargonIn(readableStrings(parse(file)))).toEqual([])
    })
  }

  it('the format and phase names (shared/audio.ts) are plain words too', () => {
    expect(jargonIn(readableStrings(parse(SHARED_AUDIO)))).toEqual([])
  })

  it('the audio tutorial is covered by tutorialCopy.test.ts (LUFS, chain, ffmpeg) — and agrees', () => {
    const tour = readFileSync(path.join(RENDERER_ROOT, 'tutorials', 'audioTutorial.ts'), 'utf8')
    expect(jargonIn([tour])).toEqual([])
  })
})

describe('the scan discriminates — it flags the copy that shipped', () => {
  const bad = ts.createSourceFile(
    'bad.tsx',
    `export const X = () => (<label title="Duck (sidechain compress)">
       <span>Normalize to <input aria-label="Loudness target in LUFS" /> LUFS</span>
       <p>True-peak ceiling is fixed at -1.5 dBTP this round.</p>
       {toast.success('Audio cleaned and muxed back to video')}
     </label>)
     const T = { label: 'De-ess sibilance', hint: 'Highpass 80 Hz' }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )

  it('reads text, attributes, toast arguments and copy-named properties', () => {
    const strings = readableStrings(bad)
    expect(strings).toEqual(
      expect.arrayContaining([
        'Duck (sidechain compress)',
        'Loudness target in LUFS',
        'Audio cleaned and muxed back to video',
        'De-ess sibilance',
        'Highpass 80 Hz'
      ])
    )
  })

  it('names every banned word it finds', () => {
    const found = jargonIn(readableStrings(bad)).join('\n')
    for (const word of ['sidechain', 'normalize', 'LUFS outside', 'dBTP', 'this round', 'mux', 'de-ess', 'highpass']) {
      expect(found.toLowerCase()).toContain(word.toLowerCase())
    }
  })

  it('lets LUFS stand in parentheses beside a number, and nowhere else', () => {
    expect(jargonIn(['Even volume (target', ' LUFS)', 'Loudness target (LUFS)'])).toEqual([])
    expect(jargonIn(['Loudness target in LUFS'])).toHaveLength(1)
  })

  it('does not mistake identifiers for copy: muxBack and a pass id are code', () => {
    const code = ts.createSourceFile(
      'ok.tsx',
      `const [muxBack, setMuxBack] = useState(true); const pass: 'mux' = 'mux'; chain.loudnorm`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    expect(readableStrings(code)).toEqual([])
  })
})
