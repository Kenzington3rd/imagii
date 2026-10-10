import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT } from './routeSources'
import {
  HOLE,
  allLiterals,
  parseSource,
  renderedStrings,
  sourceFilesUnder,
  textOf,
  type Rendered
} from './renderedStrings'
import {
  HASHTAG_PACK_KEYS,
  HASHTAG_PACK_LABELS
} from '../../src/renderer/src/modules/video-studio/PostChecklist'

/**
 * T-92 — one name per concept, and the mechanical half of the copy rules.
 *
 * docs/BRANDING_GUIDE.md ("Copy conventions") says what each thing is called,
 * how a label is written, which destruction verb means what, and how a toast
 * ends. The rules that can be checked by looking at a string are checked here,
 * against every string a person reads in `src/renderer` (what "reads" means is
 * `renderedStrings.ts`: JSX text, copy attributes, copy-named properties,
 * toast and confirm arguments, the strings a JSX expression chooses between —
 * never an identifier, a comment or a comparison).
 *
 * What it cannot see: whether the right verb was chosen. "Delete" versus
 * "Remove" is a judgement the guide makes and a reviewer applies; a test can
 * only fail the shapes that were each wrong once. Every rule below is one of
 * those, and the discrimination block at the bottom runs the scanner over the
 * copy that shipped to show each one fires — a scan that is green on a broken
 * tree is how the tutorials once drifted (tutorialTargets, T-16).
 */

interface Rule {
  name: string
  test: RegExp
  /** Which origins the rule applies to; omitted = every rendered string. */
  only?: Array<Rendered['origin']>
  /** A path fragment that is exempt (one documented exception). */
  exempt?: string
  /** Check every string literal in the file, not only the ones a person reads. */
  anywhere?: boolean
}

const NOT_A_CHOICE: Array<Rendered['origin']> = [
  'jsx-text',
  'attr',
  'prop',
  'toast',
  'toast.success',
  'toast.error',
  'confirm'
]

const RULES: Rule[] = [
  // ── one name per concept ─────────────────────────────────────────────
  { name: '"Image Canvas" — the studio is Stream Graphics', test: /Image Canvas/i, anywhere: true },
  { name: '"Image Studio" — the studio is Stream Graphics', test: /Image Studio/i, anywhere: true },
  { name: 'diary — it is the Posting log', test: /\bdiary\b/i },
  { name: '"hype moment" — a found moment is a highlight / chat spike', test: /hype moments?\b/i, anywhere: true },
  { name: '"candidate" — a found moment is a highlight', test: /\bcandidates?\b/i },
  { name: '"Chat highlight reel" — the panel is the Chat spike finder', test: /chat highlight reel/i, anywhere: true },
  { name: 'raw id "sustained-loud" shown to a person', test: /sustained-loud/ },
  { name: '"Safe zones" — the Player\'s overlay is Crop guides', test: /\bsafe zones?\b/i },
  { name: '"Moodboard" — Mood board is two words', test: /\bmoodboards?\b/i },
  { name: '"clip kit" — Clip Kit keeps its capitals', test: /\bclip kit\b/ },
  // ── plurals and units ────────────────────────────────────────────────
  { name: 'a "(s)" / "(es)" plural — use countOf', test: /\w\((s|es)\)/ },
  { name: 'a unit glued to its number ("30fps", "480px") — units are spaced', test: new RegExp(`[0-9${HOLE}](fps|px|kbps|Mbps|ms|ch)\\b`) },
  { name: '"sec" as a unit — seconds are "s" after a number', test: /\d\s?sec\b/ },
  // ── cut-short words ──────────────────────────────────────────────────
  { name: '"Rect" — spell it Rectangle', test: /\bRect\b/ },
  { name: '"Top L" / "Bot R" — spell the corner out', test: /\b(Top|Bot|Bottom) [LR]\b|\bBot\b/ },
  { name: '"Bucket sec" / "Pad sec" — plain words', test: /\b(Bucket|Pad) sec\b/ },
  { name: '"V bitrate" / "A bitrate" — Video / Audio bitrate', test: /\b[VA] bitrate\b/ },
  { name: '"msgs" — spell it message(s) via countOf', test: /\bmsgs?\b/ },
  // ── completion and voice ─────────────────────────────────────────────
  {
    name: '"done" as a completion word — say Saved / Exported',
    test: /\bdone\b/i,
    only: ['toast', 'toast.success']
  },
  { name: 'British spelling (cancelled, colour, centre, behaviour)', test: /\b(cancelled|cancelling|colour(s|ed)?|centre|behaviour|favourite|grey)\b/i },
  { name: '"tick" a box — check it', test: /\btick(ed|ing|s)?\b/i },
  { name: 'the first person ("I\'ll", "I will") — imagii speaks as imagii', test: /\bI(['’](ll|m|ve|d)| will| can)\b/ },
  {
    name: 'an exclamation mark',
    test: /!/,
    // The welcome screen's "Hi Mike!" is the one documented personalization.
    exempt: `${path.sep}routes${path.sep}Welcome.tsx`
  },
  // ── engineer's words in the video studio ─────────────────────────────
  {
    name: '"LUFS" in a Video Studio string — say how loud',
    test: /\bLUFS\b/,
    exempt: `${path.sep}audio-studio${path.sep}`
  }
]

export interface Violation {
  file: string
  line: number
  rule: string
  text: string
}

/** Run the string rules over one parsed file. */
export function stringViolations(sf: ts.SourceFile, file: string): Violation[] {
  const hits: Violation[] = []
  const rendered = renderedStrings(sf)
  const literals = allLiterals(sf)
  for (const rule of RULES) {
    if (rule.exempt && file.includes(rule.exempt)) continue
    for (const r of rule.anywhere ? [...rendered, ...literals] : rendered) {
      if (rule.only && !rule.only.includes(r.origin)) continue
      if (rule.test.test(r.text)) {
        hits.push({ file, line: r.line, rule: rule.name, text: r.text })
      }
    }
  }
  return hits
}

// ── the structural rules: buttons, headers and toasts ───────────────────

const ICON_TAGS = new Set(['Icon'])

function tagOf(n: ts.JsxElement | ts.JsxSelfClosingElement, sf: ts.SourceFile): string {
  return (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText(sf)
}

/**
 * What a button or header SAYS first: its first piece of text, skipping an
 * icon and whitespace. `{count} clips` says nothing first (it starts with a
 * value), so the tail ("clips") is not held to a capital — a sentence-case rule
 * has nothing to say about the middle of a label.
 */
function firstLabel(el: ts.JsxElement, sf: ts.SourceFile): string | null {
  for (const child of el.children) {
    if (ts.isJsxText(child)) {
      const t = child.text.replace(/\s+/g, ' ').trim()
      if (t) return t
    } else if (ts.isJsxSelfClosingElement(child) && ICON_TAGS.has(tagOf(child, sf))) {
      continue
    } else if (ts.isJsxExpression(child)) {
      const picked = child.expression ? textOfChoices(child.expression) : []
      return picked[0] ?? null
    } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      return null
    }
  }
  return null
}

function textOfChoices(expr: ts.Expression): string[] {
  let n: ts.Expression = expr
  while (ts.isParenthesizedExpression(n)) n = n.expression
  const direct = textOf(n)
  if (direct !== null) return [direct]
  if (ts.isConditionalExpression(n)) return [...textOfChoices(n.whenTrue), ...textOfChoices(n.whenFalse)]
  return []
}

/** The whole text of an element that holds nothing but text, else null. */
function onlyText(el: ts.JsxElement): string | null {
  let out = ''
  for (const child of el.children) {
    if (!ts.isJsxText(child)) return null
    out += child.text
  }
  return out.replace(/\s+/g, ' ').trim()
}

export function structureViolations(sf: ts.SourceFile, file: string): Violation[] {
  const hits: Violation[] = []
  const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const add = (n: ts.Node, rule: string, text: string): void => {
    hits.push({ file, line: at(n), rule, text })
  }
  const inTutorial = file.includes(`${path.sep}components${path.sep}Tutorial.tsx`)

  const visit = (n: ts.Node): void => {
    if (ts.isJsxElement(n)) {
      const tag = tagOf(n, sf)
      if (tag === 'button' || tag === 'PanelHeader') {
        const first = firstLabel(n, sf)
        if (first !== null && /^[a-z]/.test(first)) {
          add(n, `a lowercase ${tag} label — sentence case starts with a capital`, first)
        }
      }
      if (tag === 'button') {
        const whole = onlyText(n)
        if (whole === 'Show') {
          add(n, 'a bare "Show" button — say "Show in folder"', whole)
        }
        if ((whole === 'Esc' || whole === 'Done') && !inTutorial) {
          add(n, `a "${whole}" dismiss button — a dialog's dismiss control says Close`, whole)
        }
      }
      // A figure glued to a unit across a JSX expression: `{fps}fps`.
      for (let i = 1; i < n.children.length; i++) {
        const prev = n.children[i - 1]
        const cur = n.children[i]
        if (
          prev &&
          cur &&
          ts.isJsxExpression(prev) &&
          ts.isJsxText(cur) &&
          /^(fps|px|kbps|Mbps|ms|ch)\b/.test(cur.text)
        ) {
          add(cur, 'a unit glued to its number — units are spaced', cur.text.trim())
        }
      }
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf)
      const arg = n.arguments[0]
      // A result toast is one sentence with no trailing period. Failures
      // (toast.error) keep theirs: reportFailure's `failed` is a full sentence.
      if ((callee === 'toast' || callee === 'toast.success') && arg) {
        const t = textOf(arg)
        if (t !== null) {
          const s = t.trim()
          const oneSentence = !/[.!?]\s+\S/.test(s)
          if (oneSentence && /\.$/.test(s) && !/\.\.\.$/.test(s)) {
            add(n, 'a result toast with a trailing period — one sentence ends without one', s)
          }
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

export function allViolations(sf: ts.SourceFile, file: string): Violation[] {
  const seen = new Set<string>()
  const out: Violation[] = []
  for (const v of [...stringViolations(sf, file), ...structureViolations(sf, file)]) {
    const key = `${v.line}|${v.rule}|${v.text}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function describeAll(vs: Violation[]): string[] {
  return vs.map((v) => `${path.relative(RENDERER_ROOT, v.file)}:${v.line} [${v.rule}] "${v.text}"`)
}

const FILES = sourceFilesUnder(RENDERER_ROOT)

describe('the words a person reads in the renderer follow the copy conventions', () => {
  it('finds the sources (the scan is not vacuously empty)', () => {
    const rels = FILES.map((f) => path.relative(RENDERER_ROOT, f))
    for (const must of [
      path.join('modules', 'video-studio', 'ExportPanel.tsx'),
      path.join('modules', 'image-studio', 'Toolbar.tsx'),
      path.join('components', 'AutosaveRestore.tsx'),
      path.join('tutorials', 'videoTutorial.ts'),
      path.join('hooks', 'useGlobalUndo.ts')
    ]) {
      expect(rels).toContain(must)
    }
    const all = FILES.flatMap((f) => renderedStrings(parseSource(f)))
    expect(all.length).toBeGreaterThan(800)
  })

  for (const file of FILES) {
    it(`${path.relative(RENDERER_ROOT, file)}: no convention broken in anything it shows`, () => {
      expect(describeAll(allViolations(parseSource(file), file))).toEqual([])
    })
  }
})

describe('the sites that once hard-coded a plural all go through countOf', () => {
  // The six the review listed, plus the ones the sweep found beside them. A
  // pin of the call, not of the output: the output is the helper's own test.
  const read = (rel: string): string => parseSource(path.join(RENDERER_ROOT, rel)).text
  const SITES: Array<[string, RegExp]> = [
    ['modules/video-studio/HighlightPanel.tsx', /Found \$\{countOf\(narrowed\.length, 'highlight'\)\}/],
    ['modules/video-studio/ChatHighlightPanel.tsx', /Found \$\{countOf\(found\.length, 'chat spike'\)\}/],
    ['modules/video-studio/ChatHighlightPanel.tsx', /countOf\(p\.count, 'message'\)/],
    ['modules/video-studio/VideoStudio.tsx', /countOf\(clipCount, 'clip'\)/],
    ['modules/audio-studio/AudioStudio.tsx', /countOf\(cuts, 'cut'\)/],
    ['modules/references/MoodBoardPanel.tsx', /countOf\(collection\.items\.length, 'item'\)/],
    ['components/AutosaveRestore.tsx', /countOf\(Math\.floor\(ms \/ 86400000\), 'day'\)/],
    ['modules/video-studio/CompilationPanel.tsx', /countOf\(clips\.length, 'clip'\)/],
    ['modules/video-studio/ExportPanel.tsx', /countOf\(totalQueued, 'file'\)/],
    ['modules/video-studio/ExportPanel.tsx', /countOf\(remainingJobCount, 'running job'\)/]
  ]
  it.each(SITES)('%s', (rel, pattern) => {
    expect(read(rel)).toMatch(pattern)
  })
})

describe('the toast helper is the one place a reveal button is built', () => {
  const SAVED = path.join('lib', 'savedToast.tsx')
  it('every panel that reveals a file goes through toastSaved', () => {
    const panels = [
      'modules/video-studio/GifPanel.tsx',
      'modules/video-studio/PipPanel.tsx',
      'modules/video-studio/ReframePanel.tsx',
      'modules/video-studio/CompilationPanel.tsx',
      'modules/record-studio/RecordStudio.tsx'
    ]
    for (const rel of panels) {
      const text = parseSource(path.join(RENDERER_ROOT, rel)).text
      expect(text, rel).toMatch(/toastSaved\(/)
      // No panel builds its own reveal button inside a toast any more.
      expect(text, rel).not.toMatch(/revealInFolder/)
    }
    expect(parseSource(path.join(RENDERER_ROOT, SAVED)).text).toMatch(/revealInFolder/)
  })
})

describe('the hashtag packs are named for people, not by their ids', () => {
  it('every pack has a label that starts with a capital and has no underscore', () => {
    expect(HASHTAG_PACK_KEYS.length).toBeGreaterThan(3)
    for (const key of HASHTAG_PACK_KEYS) {
      const label = HASHTAG_PACK_LABELS[key]
      expect(label, key).toBeDefined()
      expect(label, key).not.toMatch(/_/)
      expect(label?.[0], key).toBe(label?.[0]?.toUpperCase())
    }
    // ...and no label is left over for a pack that is gone.
    expect(Object.keys(HASHTAG_PACK_LABELS).sort()).toEqual([...HASHTAG_PACK_KEYS].sort())
  })
})

describe('the scan discriminates — it fires on the copy that shipped', () => {
  const run = (src: string, file = 'bad.tsx'): string[] =>
    allViolations(parseSource(file, src), file).map((v) => v.rule)

  const BAD = `
    export const X = () => (
      <div title="Safe zones">
        <button>copy</button>
        <button>Show</button>
        <button>Esc</button>
        <button onClick={f}><Icon name="x" /> frame</button>
        <button>✕ delete</button>
        <PanelHeader icon="x">diary ({n})</PanelHeader>
        <span>{fps}fps and {w}px</span>
        <p>Tick the box. I'll set it. Great!</p>
        <label>Bucket sec</label><label>V bitrate</label>
        <option>Top L</option><option>Bot R</option><option>Rect</option>
        <span>{a} msgs</span><span>First 3 sec</span>
        <span>{busy ? 'Image Canvas' : 'Found 3 hype moments'}</span>
        <i title="30 clip(s)" aria-label="Safe zones" />
      </div>
    )
    toast.success('PiP done.')
    toast.success('Saved 3 files.')
    toast('Autosave cancelled')
    toast.success(<span>GIF saved. <button>Show</button></span>)
    confirm('Delete "x" and all 3 item(s)?')
    const p = { label: 'sustained-loud', hint: 'Found 1 candidates', description: 'A colour grade' }
    const t = { fps: \`\${p.fps}fps · \${p.w}px\` }
  `

  it('names every rule it was given a violation of', () => {
    const rules = run(BAD).join('\n')
    for (const needle of [
      'Image Canvas',
      'diary',
      'hype moment',
      'candidate',
      'sustained-loud',
      'Safe zones',
      '(s)',
      'glued to its number',
      '"sec" as a unit',
      '"Rect"',
      '"Top L"',
      '"Bucket sec"',
      '"V bitrate"',
      '"msgs"',
      '"done"',
      'British spelling',
      '"tick"',
      'first person',
      'exclamation',
      'lowercase button',
      'lowercase PanelHeader',
      'bare "Show"',
      'dismiss button',
      'trailing period'
    ]) {
      expect(rules, needle).toContain(needle)
    }
  })

  it('flags a lowercase button after an icon, and a lowercase header', () => {
    expect(run(`const a = <button><Icon name="x" /> frame</button>`)).toEqual([
      'a lowercase button label — sentence case starts with a capital'
    ])
    expect(run(`const a = <PanelHeader icon="x">diary</PanelHeader>`)).toContain(
      'a lowercase PanelHeader label — sentence case starts with a capital'
    )
  })

  it('flags a bare Show only when it is the whole button', () => {
    expect(run(`const a = <button>Show</button>`)).toEqual([
      'a bare "Show" button — say "Show in folder"'
    ])
    expect(run(`const a = <button>Show in folder</button>`)).toEqual([])
    // CaptionsPanel's `{open ? 'Hide' : 'Show'} setup instructions` is a toggle, not a bare Show.
    expect(run(`const a = <button>{open ? 'Hide' : 'Show'} setup instructions</button>`)).toEqual([])
  })

  it('flags a trailing period on a one-sentence result toast, but not on a failure or two sentences', () => {
    expect(run(`toast.success('Saved the GIF.')`)).toEqual([
      'a result toast with a trailing period — one sentence ends without one'
    ])
    expect(run(`toast('Autosave cleared.')`)).toHaveLength(1)
    expect(run(`toast.success('Saved the GIF')`)).toEqual([])
    expect(run(`toast.error('GIF export failed.')`)).toEqual([])
    expect(run(`toast.success('Cleanup configured. Tweak from the side panels.')`)).toEqual([])
  })

  it('sees the strings a template and a ternary hold, and a number glued to a unit in a template', () => {
    expect(run('const a = { label: `${n}fps` }')).toContain(
      'a unit glued to its number ("30fps", "480px") — units are spaced'
    )
    expect(run(`const a = <b>{busy ? 'Exporting…' : 'Image Canvas'}</b>`)).toEqual([
      '"Image Canvas" — the studio is Stream Graphics'
    ])
  })

  it('finds a retired name in a map of display names, where the key is not copy by name', () => {
    // The site that started T-92: Home's last-undo label came from
    // `STORE_LABEL = { image: 'Image Canvas' }`, which no "rendered string"
    // rule reaches, so the name rules read every literal.
    expect(run(`const STORE_LABEL = { video: 'Video Studio', image: 'Image Canvas' }`)).toEqual([
      '"Image Canvas" — the studio is Stream Graphics'
    ])
    expect(run(`const STORE_LABEL = { image: 'Stream Graphics' }`)).toEqual([])
  })

  it('leaves alone what is code, not copy: identifiers, comparisons, comments, class names', () => {
    const code = `
      // The old name was "Image Canvas" and a cancelled flag was called tick.
      const cancelled = reason === 'sustained-loud'
      const showSafeZones = true
      const el = <div className="tick cancelled" data-x="Rect">{cancelled ? null : x}</div>
    `
    expect(run(code)).toEqual([])
  })

  it('lets good copy through', () => {
    const good = `
      export const Y = () => (
        <div title="Crop guides">
          <button>Copy</button>
          <button>Show in folder</button>
          <button>Close</button>
          <button><Icon name="x" /> Frame</button>
          <button>+ Clip</button>
          <PanelHeader icon="x">Posting log ({n})</PanelHeader>
          <span>{fps} fps and {w} px</span>
          <p>Check the box. imagii will set it.</p>
          <label>Spike window (s)</label><label>Video bitrate (e.g. 8M)</label>
          <option>Top left</option><option>Bottom right</option><option>Rectangle</option>
        </div>
      )
      toast.success('Saved the GIF')
      toast.success('Exported 4 files')
      toast.error('GIF export failed.')
      confirm('Delete "x" and all 3 items?')
    `
    expect(run(good)).toEqual([])
  })

  it('exempts the welcome screen\'s one greeting, and only there', () => {
    const src = `const a = <h1>Hi Mike!</h1>`
    expect(run(src, `${path.sep}routes${path.sep}Welcome.tsx`)).toEqual([])
    expect(run(src, `${path.sep}routes${path.sep}Home.tsx`)).toEqual(['an exclamation mark'])
  })

  it('exempts the tour\'s Done button, and only there', () => {
    const src = `const a = <button>Done</button>`
    expect(run(src, `${path.sep}components${path.sep}Tutorial.tsx`)).toEqual([])
    expect(run(src, `${path.sep}components${path.sep}Modal.tsx`)).toHaveLength(1)
  })
})
