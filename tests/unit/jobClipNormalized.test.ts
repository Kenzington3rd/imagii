import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT } from './routeSources'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-113 (12) — every export job carries its clip through `clipForExport`.
 *
 * Compile sent `clipRecipe(c)` since T-112, so a stored speed of 0 (a hand-edited or older
 * project) was 1x there, as it is on the slider and in the grid. The Export panel and Clip
 * Kit built their `ExportJobSpec`s with the STORED clip, and main's batch validator refuses a
 * speed of 0 as out of range: the clip that looked ordinary and compiled fine failed a
 * batch. `clipForExport` (`@shared/clip`) is the one place a stored clip becomes the one a
 * job carries.
 *
 * The rule, mechanically: in a renderer source file, an object literal that is shaped like an
 * export job (it has `jobId`, `sourcePath`, `outDir`, `clip` and `preset`) takes its `clip`
 * from a call to `clipForExport` — directly, or as the first spread of an object literal.
 * A third queue builder that forgot is the failure this exists to catch.
 */

interface Site {
  file: string
  line: number
  normalized: boolean
}

const JOB_KEYS = ['jobId', 'sourcePath', 'outDir', 'clip', 'preset']

/** True when `expr` is `clipForExport(...)` or `{ ...clipForExport(...), ... }`. */
function isNormalized(expr: ts.Expression): boolean {
  if (ts.isCallExpression(expr)) return ts.isIdentifier(expr.expression) && expr.expression.text === 'clipForExport'
  if (ts.isObjectLiteralExpression(expr)) {
    const first = expr.properties[0]
    return first !== undefined && ts.isSpreadAssignment(first) && isNormalized(first.expression)
  }
  return false
}

export function jobSites(sf: ts.SourceFile): Site[] {
  const out: Site[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      const named = new Map<string, ts.Expression>()
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) named.set(p.name.text, p.initializer)
        else if (ts.isShorthandPropertyAssignment(p)) named.set(p.name.text, p.name)
      }
      if (JOB_KEYS.every((k) => named.has(k))) {
        out.push({
          file: sf.fileName,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          normalized: isNormalized(named.get('clip') as ts.Expression)
        })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe('every export job takes its clip through clipForExport (T-113)', () => {
  const sites = sourceFilesUnder(RENDERER_ROOT).flatMap((file) => jobSites(parseSource(file)))

  it('finds the two places a job is built (a scan that finds none proves nothing)', () => {
    const files = sites.map((s) => path.basename(s.file)).sort()
    expect(files).toEqual(['ExportPanel.tsx', 'clipKit.ts'])
  })

  it('none sends the stored clip raw', () => {
    const raw = sites.filter((s) => !s.normalized).map((s) => `${path.relative(RENDERER_ROOT, s.file)}:${s.line}`)
    expect(raw, 'ExportJobSpec literals whose clip is not clipForExport(...)').toEqual([])
  })

  describe('the scan itself discriminates', () => {
    const scan = (code: string): boolean[] => jobSites(parseSource('x.ts', code)).map((s) => s.normalized)
    const job = (clip: string): string =>
      `const q = { jobId: nanoid(), sourcePath: p, outDir: d, clip: ${clip}, preset: 'youtube' }`

    it('flags the raw clip, a spread of the raw clip, and a clip built another way', () => {
      expect(scan(job('clip'))).toEqual([false])
      expect(scan(job('{ ...clip, selectedPresets: [x] }'))).toEqual([false])
      expect(scan(job('clipRecipe(clip)'))).toEqual([false])
    })

    it('accepts the call, and a spread of the call', () => {
      expect(scan(job('clipForExport(clip)'))).toEqual([true])
      expect(scan(job('{ ...clipForExport(clip), selectedPresets: [x] }'))).toEqual([true])
    })

    it('ignores an object that is not shaped like a job (a clip alone is not a job)', () => {
      expect(scan('const a = { clip, preset: 1 }')).toEqual([])
    })
  })
})
