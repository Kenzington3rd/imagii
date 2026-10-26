import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-113 (4) — every child process main starts passes `windowsHide: true`.
 *
 * Without it Windows draws a console window for each `ffmpeg.exe` / `ffprobe.exe` the
 * packaged app starts: a black box that flashes on every import (the probe), every audio
 * probe and the startup smoke test. Fourteen spawn sites had the option and three did not
 * (`ffmpeg/probe.ts`, `audio/probe.ts`, `ffmpeg/smoke.ts`) - seventeen in all, which is the floor
 * below - found by reading, because nothing on Linux, where the tests run, ever draws a window.
 *
 * The rule, mechanically: every call to `spawn(...)` in a non-test file under `src/main`
 * has an options argument that is an object literal with `windowsHide: true`. The scan
 * reads the syntax tree, so a multi-line call (the arguments on their own lines) and a
 * comment that says "spawn(" are both handled.
 */

const MAIN_ROOT = path.resolve(__dirname, '../../src/main')

interface Site {
  file: string
  line: number
  hidden: boolean
}

/** Every `spawn(...)` call in `sf`, and whether its last argument is `{ ..., windowsHide: true }`. */
export function spawnSites(sf: ts.SourceFile): Site[] {
  const out: Site[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'spawn') {
      const last = n.arguments[n.arguments.length - 1]
      const hidden =
        last !== undefined &&
        ts.isObjectLiteralExpression(last) &&
        last.properties.some(
          (p) =>
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === 'windowsHide' &&
            p.initializer.kind === ts.SyntaxKind.TrueKeyword
        )
      out.push({
        file: sf.fileName,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        hidden
      })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe('every spawn( under src/main passes windowsHide: true (T-113)', () => {
  const sites = sourceFilesUnder(MAIN_ROOT).flatMap((file) => spawnSites(parseSource(file)))

  it('finds the spawn sites it is meant to police (a scan that finds none proves nothing)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(17)
    const files = new Set(sites.map((s) => path.relative(MAIN_ROOT, s.file)))
    for (const expected of ['ffmpeg/probe.ts', 'audio/probe.ts', 'ffmpeg/smoke.ts', 'ffmpeg/export.ts', 'audio/extract.ts']) {
      expect(files, expected).toContain(expected.replace(/\//g, path.sep))
    }
  })

  it('none is bare', () => {
    const bare = sites
      .filter((s) => !s.hidden)
      .map((s) => `${path.relative(MAIN_ROOT, s.file)}:${s.line}`)
    expect(bare, 'spawn( sites without windowsHide: true').toEqual([])
  })

  describe('the scan itself discriminates', () => {
    const scan = (code: string): Site[] => spawnSites(parseSource('x.ts', code))

    it('flags a bare call, an options object without the flag, and windowsHide: false', () => {
      expect(scan("spawn(bin, ['-version'])").map((s) => s.hidden)).toEqual([false])
      expect(scan("spawn(bin, args, { cwd: '/x' })").map((s) => s.hidden)).toEqual([false])
      expect(scan('spawn(bin, args, { windowsHide: false })').map((s) => s.hidden)).toEqual([false])
    })

    it('accepts the flag wherever it sits in the options, and across lines', () => {
      expect(scan('spawn(bin, args, { windowsHide: true })').map((s) => s.hidden)).toEqual([true])
      expect(scan("spawn(\n  bin,\n  ['a',\n 'b'],\n  { stdio: 'pipe', windowsHide: true }\n)").map((s) => s.hidden)).toEqual([true])
    })

    it('ignores a comment that mentions spawn(', () => {
      expect(scan('// spawn(bin)\nconst x = 1')).toEqual([])
    })
  })
})
