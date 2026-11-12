import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-105 — a clip's speed is read ONE way: `clipSpeed(clip)` (`@shared/clip`).
 *
 * "Missing, zero or negative is 1x" had been written out four times —
 * `runExportJob` twice, `buildVideoFilter` and the renderer's `outputDurationSec`
 * — and each copy was a place a fifth reader (a compilation, the GIF panel's
 * warning, the slider's readout) could have guessed differently. Left alone, the
 * copies drift: one of them treated a non-finite multiplier as itself, so a
 * hand-edited `Infinity` became `setpts=PTS/Infinity`.
 *
 * The rule, mechanically: outside the file that defines `clipSpeed`, a property
 * read of `.speedMultiplier` is allowed ONLY as the whole value of an object
 * property of the same name — a hand-over (`{ speedMultiplier: seg.speedMultiplier }`
 * hands the field on without interpreting it) — and a destructuring of it is not
 * allowed at all. Anything else is somebody deciding what the field means.
 * `shared/validators.ts` is the one other exemption: it range-checks the raw
 * payload before anything may interpret it.
 */
const SRC_ROOT = path.resolve(__dirname, '../../src')
const EXEMPT = new Set([
  path.join('shared', 'clip.ts'),
  path.join('shared', 'validators.ts')
])

export interface SpeedRead {
  line: number
  text: string
}

/** Every read of `.speedMultiplier` in `sf` that is not a plain hand-over. */
export function speedReads(sf: ts.SourceFile): SpeedRead[] {
  const hits: SpeedRead[] = []
  const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'speedMultiplier') {
      const parent = n.parent
      const handOver =
        ts.isPropertyAssignment(parent) &&
        parent.initializer === n &&
        ts.isIdentifier(parent.name) &&
        parent.name.text === 'speedMultiplier'
      if (!handOver) hits.push({ line: at(n), text: n.getText(sf) })
    }
    if (ts.isBindingElement(n)) {
      const name = n.propertyName ?? n.name
      if (ts.isIdentifier(name) && name.text === 'speedMultiplier' && ts.isObjectBindingPattern(n.parent)) {
        hits.push({ line: at(n), text: n.getText(sf) })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

describe('a clip\'s speed is read through clipSpeed and nowhere else (T-105)', () => {
  it('no source file normalizes speedMultiplier by hand', () => {
    const offenders: string[] = []
    for (const file of sourceFilesUnder(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file)
      if (EXEMPT.has(rel)) continue
      for (const hit of speedReads(parseSource(file))) offenders.push(`${rel}:${hit.line}  ${hit.text}`)
    }
    expect(offenders, 'read it with clipSpeed(clip)').toEqual([])
  })

  it('actually scans the tree: the files that used to hold a copy are among those read', () => {
    const scanned = sourceFilesUnder(SRC_ROOT).map((f) => path.relative(SRC_ROOT, f))
    for (const file of [
      path.join('main', 'ffmpeg', 'export.ts'),
      path.join('main', 'ffmpeg', 'filters.ts'),
      path.join('main', 'ffmpeg', 'concat.ts'),
      path.join('renderer', 'src', 'modules', 'video-studio', 'presets.ts'),
      path.join('renderer', 'src', 'modules', 'video-studio', 'ClipList.tsx')
    ]) {
      expect(scanned, file).toContain(file)
    }
  })
})

// The scanner discriminates (round-21 protocol): it fails on the shapes the four
// copies took, and passes on the call and the hand-over it allows.
describe('speedReads — the scanner itself', () => {
  const reads = (code: string): string[] =>
    speedReads(parseSource('probe.ts', code)).map((h) => h.text)

  it('flags the shapes the old copies took', () => {
    expect(
      reads('const s = job.clip.speedMultiplier && job.clip.speedMultiplier > 0 ? job.clip.speedMultiplier : 1')
    ).toHaveLength(3)
    expect(reads('const s = selected?.speedMultiplier ?? 1')).toHaveLength(1)
    expect(
      reads('const same = clip.speedMultiplier === undefined || clip.speedMultiplier === 1')
    ).toHaveLength(2)
    expect(
      reads(
        "const speed = typeof clip.speedMultiplier === 'number' && Number.isFinite(clip.speedMultiplier) ? clip.speedMultiplier : 1"
      )
    ).toHaveLength(3)
  })

  it('flags a destructuring, plain or renamed', () => {
    expect(reads('const { speedMultiplier } = clip')).toHaveLength(1)
    expect(reads('const { speedMultiplier: s } = clip')).toHaveLength(1)
  })

  it('passes the call, and a field handed on as it was', () => {
    expect(reads('const s = clipSpeed(clip)')).toEqual([])
    expect(reads('const out = { speedMultiplier: seg.speedMultiplier, name: seg.name }')).toEqual([])
    expect(reads('const out = { speedMultiplier: speed }')).toEqual([])
  })

  it('a hand-over under another name is still an interpretation', () => {
    expect(reads('const out = { speed: clip.speedMultiplier }')).toHaveLength(1)
  })
})
