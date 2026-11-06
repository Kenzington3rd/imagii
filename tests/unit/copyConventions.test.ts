import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT } from './routeSources'
import { burnInDoneMessage, captionsReadyMessage, clearedTranscriptsMessage, staleCaptionsMessage } from '../../src/shared/captions'
import { lateScanMessage } from '../../src/shared/highlights'
import { kitFailedMessage } from '../../src/renderer/src/modules/video-studio/clipKit'
import { previewCopySkippedMessage } from '../../src/shared/mediaFormats'
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
  // T-131 (15): the image ExportDialog spelled "1280x720" and "28x28" with the letter x beside the canvas readout's "1920 × 1080".
  { name: 'the letter x as a multiplication sign between numbers — sizes are spelled with ×', test: new RegExp(`[0-9${HOLE}]x[0-9${HOLE}]`) },
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
  // `\b` sits between a non-word and a word character, so `\btick` cannot match inside "untick" (T-116).
  { name: '"tick" a box — check it', test: /\b(un)?tick(ed|ing|s)?\b/i },
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

/**
 * T-116: the same two word rules, over the sentences main and shared hand a person.
 *
 * The scan above reads `src/renderer`, but a good deal of what a streamer reads is written in main and
 * crosses the bridge as a thrown message or a returned reason (`recordingConvertFailureMessage`,
 * `captions:saveSrt`'s refusals, the gate sentences): "untick" sat in one of those for a round because no
 * scan looked there. There is no "rendered string" in main to separate copy from the rest, so this reads
 * EVERY string literal under `src/main`, `src/shared` and `src/preload` for the two rules that are about
 * words alone (US spelling, never "tick" a box). A protocol id is not copy and is not read (`imagii:cancelled`,
 * the cancel sentinel's value, is spelled the way the sentinel is; renaming it would break the match
 * `isCancelledError` makes). The structural rules (labels, toasts, units) are renderer rules and stay there.
 */
const WORD_RULES = RULES.filter((r) => r.name.startsWith('British spelling') || r.name.startsWith('"tick"'))
const MAIN_ROOTS = ['main', 'shared', 'preload'].map((d) => path.resolve(RENDERER_ROOT, '../../', d))

export function mainWordViolations(sf: ts.SourceFile, file: string): Violation[] {
  const hits: Violation[] = []
  for (const r of allLiterals(sf)) {
    if (/^imagii:[a-z-]+$/.test(r.text)) continue
    for (const rule of WORD_RULES) {
      if (rule.test.test(r.text)) hits.push({ file, line: r.line, rule: rule.name, text: r.text })
    }
  }
  return hits
}

describe('the words main and shared hand a person follow the spelling and tick rules (T-116)', () => {
  const MAIN_FILES = MAIN_ROOTS.flatMap((root) => sourceFilesUnder(root))

  it('finds the sources (the scan is not vacuously empty)', () => {
    const rels = MAIN_FILES.map((f) => path.relative(path.resolve(RENDERER_ROOT, '../../'), f).replace(/\\/g, '/'))
    for (const must of ['main/ipc/recording.ts', 'main/ipc/captions.ts', 'shared/userFacingError.ts', 'preload/index.ts']) {
      expect(rels).toContain(must)
    }
    expect(MAIN_FILES.flatMap((f) => allLiterals(parseSource(f))).length).toBeGreaterThan(500)
  })

  it('no string in main, shared or preload says "untick" or spells a word the British way', () => {
    const hits = MAIN_FILES.flatMap((f) => mainWordViolations(parseSource(f), f)).map(
      (v) => `${path.relative(path.resolve(RENDERER_ROOT, '../../'), v.file)}:${v.line} [${v.rule}] "${v.text}"`
    )
    expect(hits).toEqual([])
  })

  it('discriminates: it fires on the convert-failure sentence that shipped, and not on a protocol id or good copy', () => {
    const run = (src: string): string[] => mainWordViolations(parseSource('x.ts', src), 'x.ts').map((v) => v.rule)
    expect(run(`return 'try again, or untick "Convert to MP4 after recording" to keep the WebM.'`)).toEqual([
      '"tick" a box \u2014 check it'
    ])
    expect(run('throw new Error(`Autosave cancelled`)')).toEqual([
      'British spelling (cancelled, colour, centre, behaviour)'
    ])
    expect(run(`const SENTINEL = 'imagii:cancelled'`)).toEqual([])
    expect(run(`return 'try again, or uncheck "Convert to MP4 after recording" to keep the WebM.'`)).toEqual([])
  })
})

describe('the sites that once hard-coded a plural all go through countOf', () => {
  // The six the review listed, plus the ones the sweep found beside them. A
  // pin of the call, not of the output: the output is the helper's own test.
  const read = (rel: string): string => parseSource(path.join(RENDERER_ROOT, rel)).text
  const SITES: Array<[string, RegExp]> = [
    ['modules/video-studio/HighlightPanel.tsx', /Found \$\{countOf\(narrowed\.length, 'highlight'\)\}/],
    ['modules/video-studio/ChatHighlightPanel.tsx', /Found \$\{countOf\(found\.length, 'chat spike'\)\}/],
    ['modules/video-studio/ChatHighlightPanel.tsx', /countOf\(p\.count, 'message'\)/],
    // T-119 moved the Close question into `videoDiscardMessage`, so Record's "Edit in Video Studio" asks the same one.
    ['modules/video-studio/store/videoStore.ts', /countOf\(clipCount, 'clip'\)/],
    // T-112 moved the close message out of the component so Video Studio's Clean audio can ask it.
    ['modules/audio-studio/audioClose.ts', /countOf\(cuts, 'cut'\)/],
    ['modules/references/MoodBoardPanel.tsx', /countOf\(count, 'item'\)/],
    ['components/AutosaveRestore.tsx', /countOf\(Math\.floor\(ms \/ 86400000\), 'day'\)/],
    ['modules/video-studio/CompilationPanel.tsx', /countOf\(clips\.length, 'clip'\)/],
    ['modules/video-studio/ExportPanel.tsx', /countOf\(totalQueued, 'file'\)/],
    ['modules/video-studio/ExportPanel.tsx', /countOf\(remaining, 'running job'\)/]
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
        <span>{a} msgs</span><span>First 3 sec</span><span title="Output: 1280x720" />
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
    const size = { hint: \`Output: \${out.width}x\${out.height}\` }
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
      'the letter x as a multiplication sign',
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

  it('"tick" is caught with its un- prefix too (T-116: \\btick cannot match inside "untick")', () => {
    for (const word of ['Tick', 'tick', 'ticked', 'ticking', 'ticks', 'Untick', 'untick', 'unticked', 'unticking', 'unticks']) {
      expect(run(`const a = <p>${word} the box</p>`), word).toEqual(['"tick" a box \u2014 check it'])
    }
    // The right words, and words that merely contain the letters.
    for (const fine of ['Check the box', 'Uncheck it', 'a ticket', 'the ticker', 'a stick', 'quick tip']) {
      expect(run(`const a = <p>${fine}</p>`), fine).toEqual([])
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

/**
 * T-157 Track B. The crop aspect buttons, the source tile captions and the webcam
 * Corner picker each render through a label map (`PRESET_LABELS`,
 * `SOURCE_TYPE_LABELS`, `WEBCAM_CORNER_LABELS`) — the value reaches the DOM through
 * a variable, which the string rules above cannot see. This pins each map's
 * values and that the render site reads the map, not the internal id.
 */
describe('T-157 Track B: the labels a person reads are spelled out and capitalized', () => {
  const CROP = path.join(RENDERER_ROOT, 'modules', 'video-studio', 'CropOverlay.tsx')
  const RECORD = path.join(RENDERER_ROOT, 'modules', 'record-studio', 'RecordStudio.tsx')

  /** The string values of `const NAME ... = { key: 'value', ... }` in a file; undefined when it is not declared there. */
  function labelMap(file: string, name: string): Record<string, string> | undefined {
    const sf = parseSource(file)
    let found: Record<string, string> | undefined
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
        if (ts.isObjectLiteralExpression(n.initializer)) {
          found = {}
          for (const p of n.initializer.properties) {
            if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) {
              found[p.name.getText(sf).replace(/^['"]|['"]$/g, '')] = p.initializer.text
            }
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return found
  }

  it('the crop aspect buttons read their PRESET_LABELS, and "free" reads Free', () => {
    expect(labelMap(CROP, 'PRESET_LABELS')).toEqual({
      free: 'Free',
      '16:9': '16:9',
      '9:16': '9:16',
      '1:1': '1:1',
      '4:5': '4:5'
    })
    expect(parseSource(CROP).text).toMatch(/\{PRESET_LABELS\[m\]\}/)
    expect(parseSource(CROP).text).not.toMatch(/^\s*\{m\}\s*$/m)
  })

  it('the source tile captions read SOURCE_TYPE_LABELS: Screen and Window, not the type', () => {
    expect(labelMap(RECORD, 'SOURCE_TYPE_LABELS')).toEqual({ screen: 'Screen', window: 'Window' })
    expect(parseSource(RECORD).text).toMatch(/\{SOURCE_TYPE_LABELS\[s\.type\]\}/)
    expect(parseSource(RECORD).text).not.toMatch(/^\s*\{s\.type\}\s*$/m)
  })

  it('the webcam Corner picker spells its corners out, with no hyphen', () => {
    const corners = labelMap(RECORD, 'WEBCAM_CORNER_LABELS')
    expect(corners).toEqual({
      'top-left': 'Top left',
      'top-right': 'Top right',
      'bottom-left': 'Bottom left',
      'bottom-right': 'Bottom right'
    })
    expect(Object.values(corners ?? {}).filter((v) => v.includes('-'))).toEqual([])
  })

  it('every one of those label values starts with a capital letter or a digit', () => {
    for (const [file, name] of [
      [CROP, 'PRESET_LABELS'],
      [RECORD, 'SOURCE_TYPE_LABELS'],
      [RECORD, 'WEBCAM_CORNER_LABELS']
    ] as const) {
      const map = labelMap(file, name)
      expect(map, `${name} is declared in ${path.basename(file)}`).toBeDefined()
      for (const [key, value] of Object.entries(map ?? {})) {
        expect(value, `${name}.${key}`).toMatch(/^[A-Z0-9]/)
      }
    }
  })
})

// T-159 (1): "clip" is a Video Studio unit (BRANDING_GUIDE "One name per concept"); Audio Studio's person has a sound, with cuts.
describe('T-159 (1): nothing Audio Studio shows its person calls their sound a "clip"', () => {
  const AUDIO_DIR = path.join(RENDERER_ROOT, 'modules', 'audio-studio')
  const TOUR = path.join(RENDERER_ROOT, 'tutorials', 'audioTutorial.ts')
  const UNIT = /\bclips?\b/i
  // simplification: the one verb use ("a boost cannot clip", the limiter sentence in LevelsPanel) is the audio sense of the word, not the
  // unit; it is let through by its exact lead-in. Upgrade: a second verb in a person-visible string needs its own entry here.
  const VERB = /\bcannot clip\b/gi

  /** The person-visible strings in `files` (JSX text, copy attributes and properties, toasts) that name the unit. */
  const unitNames = (files: string[], read = (f: string) => parseSource(f)): string[] =>
    files.flatMap((f) =>
      renderedStrings(read(f))
        .filter((s) => UNIT.test(s.text.replace(VERB, '')))
        .map((s) => `${path.relative(RENDERER_ROOT, f)}:${s.line} "${s.text}"`)
    )

  const FILES = [...sourceFilesUnder(AUDIO_DIR), TOUR]

  it('finds the sources (the scan is not vacuously empty)', () => {
    const names = FILES.map((f) => path.basename(f))
    for (const must of ['FixWizard.tsx', 'LevelsPanel.tsx', 'audioTutorial.ts']) expect(names).toContain(must)
    expect(FILES.flatMap((f) => renderedStrings(parseSource(f))).length).toBeGreaterThan(100)
  })

  it('no string in Audio Studio or its tour says "clip" for the person\'s sound', () => {
    expect(unitNames(FILES)).toEqual([])
  })

  it('discriminates: it fires on the wizard question that shipped, in a toast and in tour copy, and not on clipping or the limiter\'s verb', () => {
    const run = (src: string): string[] => unitNames(['x.tsx'], () => parseSource('x.tsx', src))
    expect(run(`const q = { question: 'What is this clip mostly?' }`)).toHaveLength(1)
    expect(run(`toast.success('Saved the clip')`)).toHaveLength(1)
    expect(run(`const s = { body: 'Pick a part of the Clip.' }`)).toHaveLength(1)
    expect(run(`const x = () => <p>Two clips</p>`)).toHaveLength(1)
    expect(run(`const x = () => <p>so a boost cannot clip.</p>`)).toEqual([])
    expect(run(`const x = () => <p>Peaks are clipping. Unclipped is fine.</p>`)).toEqual([])
    expect(run(`// a clip\nconst clip = 1; const clipSeconds = 2; const q = { id: 'clip', question: 'What is this sound mostly?' }`)).toEqual([])
  })
})

// T-163 (3): the scan above reads literal toast ARGUMENTS, so a sentence a shared helper BUILDS escaped it ("No speech found, so there are no captions." and both uncaptioned burn-in sentences
// shipped with a period that BRANDING_GUIDE "Toasts" forbids on a one-sentence result). These are the helpers' outputs, as an explicit list of calls (not a reflective walk of the module).
// simplification: the list is hand-kept; a new `*Message` helper that the renderer toasts as a result must be added here. Upgrade: none needed while there are five.
// Covered: captionsReadyMessage (0, 1, 3), burnInDoneMessage (all four argument pairs), clearedTranscriptsMessage (its two single-sentence successes) and previewCopySkippedMessage (a
// single-sentence warning toast). Left out, each with its reason: staleCaptionsMessage and clearedTranscriptsMessage's partial branch are TWO sentences (both keep their periods,
// asserted below, with lateScanMessage (T-167 (3)) and kitFailedMessage's two-sentence branch (T-167 (4), a failure: a full sentence with its period); clearedTranscriptsMessage's refusal and `ipcErrorMessage` are failures (a full sentence with its period); `overlayOutsideClipMessage` is an inline note in the editor, not a toast;
// `clearTranscriptsQuestion` is a confirm's question, not a result.
describe('T-163 (3): a helper-built single-sentence result toast has no trailing period', () => {
  const ONE_SENTENCE: Array<[string, string]> = [
    ['captionsReadyMessage(0)', captionsReadyMessage(0)],
    ['captionsReadyMessage(1)', captionsReadyMessage(1)],
    ['captionsReadyMessage(3)', captionsReadyMessage(3)],
    ['burnInDoneMessage(true, true)', burnInDoneMessage(true, true)],
    ['burnInDoneMessage(true, false)', burnInDoneMessage(true, false)],
    ['burnInDoneMessage(false, true)', burnInDoneMessage(false, true)],
    ['burnInDoneMessage(false, false)', burnInDoneMessage(false, false)],
    ['clearedTranscriptsMessage(nothing to clear)', clearedTranscriptsMessage({ removed: 0, failed: 0 }).text],
    ['clearedTranscriptsMessage(cleared 3)', clearedTranscriptsMessage({ removed: 3, failed: 0 }).text],
    ['previewCopySkippedMessage', previewCopySkippedMessage('a.mkv')]
  ]

  it.each(ONE_SENTENCE)('%s is one sentence and does not end in a period', (_call, text) => {
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toMatch(/\.\s*$/)
    expect(text, 'one sentence: no ". " inside').not.toMatch(/\. /)
  })

  it('the two-sentence toasts keep both periods', () => {
    expect(staleCaptionsMessage('a.mp4')).toMatch(/\. .*\.$/)
    // T-167 (3): the late scan's toast is two sentences, like the captions one it follows.
    expect(lateScanMessage('a.mp4')).toMatch(/\. .*\.$/)
    // T-167 (4): kitFailedMessage is a FAILURE (reportFailure's `failed`, a full sentence with its period, followed by the cause): two sentences when files survived, one when none did.
    expect(kitFailedMessage(2)).toMatch(/\. .*\.$/)
    expect(kitFailedMessage(0)).toMatch(/^[^.]*\.$/)
    expect(clearedTranscriptsMessage({ removed: 1, failed: 2 }).text).toMatch(/\. .*\.$/)
  })
})

// T-168 (fold): the Asset Library's footer wrote `${ASSET_CATALOG.length} assets` by hand. A pin of the call, as the sites above (the output is the helper's own test).
describe('the Asset Library footer count goes through countOf (T-168 fold)', () => {
  it('AssetLibraryPanel.tsx counts the catalog with countOf and does not hand-write the plural', () => {
    const text = parseSource(path.join(RENDERER_ROOT, 'modules/references/AssetLibraryPanel.tsx')).text
    expect(text).toMatch(/countOf\(ASSET_CATALOG\.length, 'asset'\)/)
    expect(text).not.toMatch(/\{ASSET_CATALOG\.length\} assets/)
  })
})

/**
 * T-172 (4): the word rules over EVERY string literal under src/renderer, as T-116 does for main, shared and preload.
 *
 * The renderer scan above reads what `renderedStrings.ts` calls rendered (JSX text, copy attributes, copy-named properties, toast arguments): a
 * sentence a helper RETURNS (`noDeviceHint`) or a constant a toast interpolates (`MIC_START_REMEDY`) is not one of those, so "untick" shipped in both
 * (T-171) with this scan green. The two word rules (US spelling, never "tick" a box) read words alone, so they can read every literal.
 */
describe('the word rules read every string literal in the renderer (T-172 (4))', () => {
  /** The ONE scan of a renderer file's literals: the per-file cases and the discrimination cases both go through it, so narrowing it fails the second. */
  const literalHits = (file: string, text?: string): string[] => describeAll(mainWordViolations(parseSource(file, text), file))
  const TICK = '"tick" a box \u2014 check it'

  it('finds the sources (the scan is not vacuously empty) and reads the two files that shipped "untick"', () => {
    const rels = FILES.map((f) => path.relative(RENDERER_ROOT, f).replace(/\\/g, '/'))
    expect(rels).toContain('modules/record-studio/devices.ts')
    expect(rels).toContain('modules/record-studio/RecordStudio.tsx')
    expect(FILES.flatMap((f) => allLiterals(parseSource(f))).length).toBeGreaterThan(3000)
  })

  for (const file of FILES) {
    it(`${path.relative(RENDERER_ROOT, file)}: no literal says "untick" or spells a word the British way`, () => {
      expect(literalHits(file)).toEqual([])
    })
  }

  it('discriminates: "untick" in a helper\'s returned string and in a const a toast interpolates both fail; the fixed words do not', () => {
    const rules = (src: string): string[] => literalHits('x.ts', src).map((h) => h.match(/\[(.*?)\]/)?.[1] ?? h)
    expect(rules(`export function hint(k: string): string { return 'No mic.' + (k === 'microphone' ? ' To record without one, untick Record microphone.' : '') }`)).toEqual([TICK])
    expect(rules(`const REMEDY = 'To record without it, untick Record microphone.'\ntoast.error(\`\${message} \${REMEDY}\`)`)).toEqual([TICK])
    expect(rules(`const REMEDY = 'To record without it, uncheck Record microphone.'`)).toEqual([])
  })

  it('discriminates on the real files: "untick" put back into devices.ts and into RecordStudio.tsx is found by the same scan that reads them', () => {
    for (const [rel, uncheck] of [
      ['modules/record-studio/devices.ts', 'uncheck Record microphone'],
      ['modules/record-studio/RecordStudio.tsx', 'uncheck Record microphone']
    ] as const) {
      const file = FILES.find((f) => f.replace(/\\/g, '/').endsWith(rel))!
      const text = readFileSync(file, 'utf8')
      expect(text, `${rel} says "${uncheck}" now`).toContain(uncheck)
      expect(literalHits(file, text.replace(uncheck, 'untick Record microphone')), rel).toHaveLength(1)
    }
  })
})
