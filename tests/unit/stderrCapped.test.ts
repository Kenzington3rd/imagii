import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-136 (13) - every `stderr` accumulator in main is capped at 16 KB, the tail kept.
 *
 * LESSONS_LEARNED ("runBurnIn stderr accumulator was uncapped") made it a rule in round 18: an ffmpeg that runs for hours at a verbose log level can
 * write tens of MB to stderr, and a handler that does `stderr += chunk` holds all of it for the sake of the last few hundred characters the failure
 * message uses. The rule was applied spawn by spawn, from memory, and the audio extraction (`audio/extract.ts`) was missed: T-129 made multi-hour
 * extractions reachable, which is exactly the run it grows in. This scan is that grep, kept: it finds every `<x>.stderr.on('data', handler)` under
 * `src/main`, decides from the syntax tree whether the handler ACCUMULATES (an `x += ...`, an `x = x + ...`, or a `.push(...)`), and requires
 * each accumulated variable to be assigned a tail somewhere in the same handler: `x = x.slice(-N)` or `x = (x + chunk).slice(-N)`, N at most 16384.
 * (A tail of something else in the handler does not count: the slice has to be what is assigned to the accumulator.)
 *
 * What the scan cannot see: a handler passed by name (it is reported, so the handler is written inline where the cap can be read), a cap that
 * sits in another function, and a `slice` whose operand is not a literal. A rule that cannot be read is reported, not assumed.
 */
const MAIN_ROOT = path.resolve(__dirname, '../../src/main')
/** The tail the idiom keeps. A bigger literal is not the idiom (the point is a bound the rest of the file can rely on). */
const CAP_BYTES = 16384

interface Accumulator {
  name: string
  capped: boolean
}
export interface StderrHandler {
  line: number
  /** `null` when the handler is not written inline (a name, a call): nothing to read. */
  accumulators: Accumulator[] | null
}

/** `.slice(-N)` (or `.slice(-N, ...)`) with N a literal in 1..CAP_BYTES. */
function isTailCap(n: ts.Node): boolean {
  if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== 'slice') return false
  const first = n.arguments[0]
  if (!first || !ts.isPrefixUnaryExpression(first) || first.operator !== ts.SyntaxKind.MinusToken) return false
  if (!ts.isNumericLiteral(first.operand)) return false
  const size = Number(first.operand.text)
  return size >= 1 && size <= CAP_BYTES
}

function containsTailCap(n: ts.Node): boolean {
  let found = false
  const visit = (c: ts.Node): void => {
    if (found) return
    if (isTailCap(c)) found = true
    else ts.forEachChild(c, visit)
  }
  visit(n)
  return found
}

function accumulatorsOf(handler: ts.Node, sf: ts.SourceFile): Accumulator[] {
  const accumulated = new Set<string>()
  const capped = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken || n.operatorToken.kind === ts.SyntaxKind.EqualsToken)) {
      const name = n.left.getText(sf)
      const accumulates = n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken || n.right.getText(sf).includes(name)
      if (accumulates) accumulated.add(name)
      if (containsTailCap(n.right)) capped.add(name)
    }
    // A list that grows has no tail to slice: it is reported (and the exceptions table is where it would be defended).
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'push') {
      accumulated.add(`${n.expression.expression.getText(sf)}.push`)
    }
    ts.forEachChild(n, visit)
  }
  visit(handler)
  return [...accumulated].map((name) => ({ name, capped: capped.has(name) }))
}

/** Every `<expr>.stderr.on('data', handler)` in `sf`. */
export function stderrDataHandlers(sf: ts.SourceFile): StderrHandler[] {
  const out: StderrHandler[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['on', 'addListener'].includes(n.expression.name.text)) {
      let receiver: ts.Expression = n.expression.expression
      while (ts.isNonNullExpression(receiver) || ts.isParenthesizedExpression(receiver)) receiver = receiver.expression
      const event = n.arguments[0]
      if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'stderr' && event && ts.isStringLiteralLike(event) && event.text === 'data') {
        const handler = n.arguments[1]
        const inline = handler !== undefined && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
        out.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          accumulators: inline ? accumulatorsOf(handler, sf) : null
        })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** The handlers a reader cannot call safe: written by name, or accumulating without a tail cap. */
export function uncappedHandlers(sf: ts.SourceFile): StderrHandler[] {
  return stderrDataHandlers(sf).filter((h) => h.accumulators === null || h.accumulators.some((a) => !a.capped))
}

/** The uncapped handlers a scan found, by file (relative path, forward slashes), as the lines that read them. */
type Found = Record<string, string[]>

/**
 * What is wrong with a scan, given the audited exceptions: a file with uncapped handlers that is not in the table, or has another number of them than its
 * row allows (a new one, or one capped since); and a row whose file has none any more (stale: delete it). Pure, so it can be shown to discriminate.
 */
export function accountFor(found: Found, table: Record<string, { handlers: number }>): { unexpected: string[]; stale: string[] } {
  return {
    unexpected: Object.entries(found)
      .filter(([file, lines]) => lines.length !== table[file]?.handlers)
      .map(([file, lines]) => `${file}: ${lines.join('; ')}`),
    stale: Object.keys(table).filter((file) => !(file in found))
  }
}

/**
 * The audited exceptions, by file: how many uncapped handlers the file is allowed, and why. A row is added only after reading the handler; a
 * row whose file no longer has that many is stale and fails too (delete it).
 */
const AUDITED_UNCAPPED: Record<string, { handlers: number; why: string }> = {
  'ffmpeg/highlights.ts': {
    handlers: 2,
    why: 'the stderr IS the measurement: the loudness scan and the hook score parse every ebur128 line (parseEbur128), so a tail would be a wrong answer'
  },
  'ffmpeg/smoke.ts': { handlers: 1, why: '`ffmpeg -version`: a screenful, and the command ends by itself' },
  'audio/probe.ts': {
    handlers: 1,
    why: 'ffprobe -v error reading a header (bounded by probesize and analyzeduration, no decode); found-not-fixed by T-136 (13): one `.slice(-16384)` closes it'
  },
  'ffmpeg/probe.ts': {
    handlers: 1,
    why: 'ffprobe -v error reading a header (bounded by probesize and analyzeduration, no decode); found-not-fixed by T-136 (13): one `.slice(-16384)` closes it'
  }
}

describe('every stderr accumulator in main keeps a 16 KB tail (T-136 (13))', () => {
  const files = sourceFilesUnder(MAIN_ROOT)
  const rel = (f: string): string => path.relative(MAIN_ROOT, f).split(path.sep).join('/')

  it('reads the handlers it is meant to police (a scan over nothing proves nothing)', () => {
    const byFile = new Map(files.map((f) => [rel(f), stderrDataHandlers(parseSource(f))]))
    for (const expected of ['audio/extract.ts', 'audio/peaks.ts', 'audio/process.ts', 'ffmpeg/concat.ts', 'ffmpeg/export.ts', 'ffmpeg/gif.ts', 'ffmpeg/reframe.ts', 'ffmpeg/convert.ts', 'ffmpeg/frame.ts', 'sidecars/whisperManager.ts']) {
      expect(byFile.get(expected)?.length ?? 0, `${expected} has a stderr handler the scan reads`).toBeGreaterThan(0)
    }
    expect(byFile.get('ffmpeg/concat.ts')?.length, 'concat.ts has three: the segments, the join and the picture-in-picture composite').toBe(3)
    expect([...byFile.values()].flat().length).toBeGreaterThanOrEqual(18)
  })

  it('no handler accumulates without a tail cap, outside the audited exceptions', () => {
    const found: Found = {}
    for (const f of files) {
      const bad = uncappedHandlers(parseSource(f))
      if (bad.length > 0) found[rel(f)] = bad.map((h) => `line ${h.line}${h.accumulators === null ? ' (handler not written inline)' : ` (${h.accumulators.filter((a) => !a.capped).map((a) => a.name).join(', ')})`}`)
    }
    const { unexpected, stale } = accountFor(found, AUDITED_UNCAPPED)
    expect(unexpected, 'cap it the way every other spawn does: `if (stderr.length > 16384) stderr = stderr.slice(-16384)`').toEqual([])
    expect(stale, 'an exception whose file is capped now: delete its row').toEqual([])
  })

  describe('the accounting against the exceptions discriminates', () => {
    const table = { 'a.ts': { handlers: 2 } }
    it('an uncapped handler in a file the table does not list is unexpected', () => {
      expect(accountFor({ 'b.ts': ['line 3'] }, {}).unexpected).toEqual(['b.ts: line 3'])
    })
    it('a file with MORE or FEWER uncapped handlers than its row allows is unexpected', () => {
      expect(accountFor({ 'a.ts': ['line 1', 'line 2', 'line 3'] }, table).unexpected).toHaveLength(1)
      expect(accountFor({ 'a.ts': ['line 1'] }, table).unexpected).toHaveLength(1)
    })
    it('a file with exactly the allowed number is accounted for', () => {
      expect(accountFor({ 'a.ts': ['line 1', 'line 2'] }, table)).toEqual({ unexpected: [], stale: [] })
    })
    it('a row whose file has no uncapped handler any more is stale', () => {
      expect(accountFor({}, table)).toEqual({ unexpected: [], stale: ['a.ts'] })
    })
  })

  describe('the scan itself discriminates', () => {
    const scan = (code: string): StderrHandler[] => uncappedHandlers(parseSource('x.ts', code))

    it('flags the shapes that shipped: a bare accumulator, in a block and as an expression body', () => {
      expect(scan("child.stderr.on('data', (c: string) => { stderr += c })")).toHaveLength(1)
      expect(scan("p.stderr.on('data', (b) => (stderr += String(b)))")).toHaveLength(1)
      expect(scan("p.stderr.on('data', function (b) { err = err + b })")).toHaveLength(1)
      expect(scan("p.stderr.on('data', (b) => { chunks.push(b) })")).toHaveLength(1)
      expect(scan("p.stderr!.addListener('data', (b) => { stderr += b })")).toHaveLength(1)
    })

    it('passes the idioms in the tree: a tail after the append, and a tail on the append itself', () => {
      expect(scan("child.stderr.on('data', (c) => {\n stderr += c\n if (stderr.length > 16384) stderr = stderr.slice(-16384)\n})")).toEqual([])
      expect(scan("child.stderr.on('data', (text) => {\n stderr = (stderr + text).slice(-16384)\n})")).toEqual([])
      expect(scan("child.stderr.on('data', (c) => {\n stderr += c\n sawEmpty ||= RE.test(stderr)\n if (stderr.length > 16384) stderr = stderr.slice(-16384)\n})")).toEqual([])
    })

    it('a tail of something else, a head slice, a name for the number and a bigger cap are not the idiom', () => {
      expect(scan("child.stderr.on('data', (c) => { stderr += c; shown = c.slice(-5) })")).toHaveLength(1)
      expect(scan("child.stderr.on('data', (c) => { stderr += c; if (stderr.length > 16384) stderr = stderr.slice(0, 16384) })")).toHaveLength(1)
      expect(scan("child.stderr.on('data', (c) => { stderr += c; stderr = stderr.slice(-CAP) })")).toHaveLength(1)
      expect(scan("child.stderr.on('data', (c) => { stderr += c; stderr = stderr.slice(-1000000) })")).toHaveLength(1)
      expect(scan("child.stderr.on('data', (c) => { stderr += c; stderr = stderr.slice(-0) })")).toHaveLength(1)
    })

    it('every accumulator of a handler needs its own tail', () => {
      expect(scan("child.stderr.on('data', (c) => { a += c; b += c; a = a.slice(-16384) })")).toHaveLength(1)
      expect(scan("child.stderr.on('data', (c) => { a += c; b += c; a = a.slice(-16384); b = b.slice(-16384) })")).toEqual([])
    })

    it('a handler written by name cannot be read, so it is reported', () => {
      expect(scan("child.stderr.on('data', onStderr)")).toHaveLength(1)
    })

    it('does not mistake other streams or other events for stderr data', () => {
      expect(scan("child.stdout.on('data', (b) => { out += b })")).toEqual([])
      expect(scan("child.stderr.on('end', () => { done += 1 })")).toEqual([])
      expect(scan("child.on('data', (b) => { out += b })")).toEqual([])
    })

    it('a handler that only reads the chunk (progress parsing) accumulates nothing', () => {
      expect(scan("child.stderr.on('data', (chunk) => { const m = chunk.match(/t:\\s*(\\d+)/); if (m) onProgress(Number(m[1])) })")).toEqual([])
    })
  })
})
