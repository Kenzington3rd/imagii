import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-123 (1) - no bare `.send(...)` in main.
 *
 * `sendIfAlive` (`src/main/sendIfAlive.ts`) is the one way main reports to a window: a destroyed
 * WebContents throws on `send`, and a progress callback has nothing above it to catch the throw
 * (the "JavaScript error in the main process" dialog, 3 of 40 real closes mid-export). The ticket
 * said eleven sites; the count in the tree was TEN call sites of `sendIfAlive` over EIGHT channels
 * (recording:progress, captions:progress, captions:modelProgress, video:progress,
 * video:jobComplete, video:reframeProgress, video:highlightProgress, audio:progress; T-129 added
 * the eleventh, audio:peaksProgress, the waveform's), and the
 * ticket said to grep for siblings. This scan IS that grep, kept: every call
 * whose callee is `<anything>.send(...)` in a non-test file under `src/main` is in the helper
 * itself or in the one place that wraps its own call in a `try` (`quitFlush.ts`, whose `catch`
 * settles the flush as 'failed' at once instead of waiting out its timeout).
 */
const MAIN_ROOT = path.resolve(__dirname, '../../src/main')
const ALLOWED = new Set(['sendIfAlive.ts', 'quitFlush.ts'])

export function bareSendCalls(sf: ts.SourceFile): number[] {
  const lines: number[] = []
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'send'
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return lines
}

describe('every report main sends to a window goes through sendIfAlive (T-123 (1))', () => {
  const files = sourceFilesUnder(MAIN_ROOT)

  it('reads the files it is meant to police (a scan over nothing proves nothing)', () => {
    const rel = files.map((f) => path.relative(MAIN_ROOT, f))
    for (const expected of ['ipc/video.ts', 'ipc/captions.ts', 'ipc/audio.ts', 'ipc/recording.ts']) {
      expect(rel, expected).toContain(expected.replace(/\//g, path.sep))
    }
  })

  it('no file outside the allowance calls .send( directly', () => {
    const bare = files
      .filter((f) => !ALLOWED.has(path.relative(MAIN_ROOT, f)))
      .flatMap((f) => bareSendCalls(parseSource(f)).map((line) => `${path.relative(MAIN_ROOT, f)}:${line}`))
    expect(bare, 'a bare .send( in main: use sendIfAlive(sender, channel, payload)').toEqual([])
  })

  it('every handler module that reports progress imports the helper', () => {
    for (const rel of ['ipc/video.ts', 'ipc/captions.ts', 'ipc/audio.ts', 'ipc/recording.ts']) {
      const code = parseSource(path.join(MAIN_ROOT, rel)).text
      expect(code, rel).toMatch(/from '\.\.\/sendIfAlive'/)
      expect(code, rel).toMatch(/sendIfAlive\(/)
    }
  })

  describe('the scan itself discriminates', () => {
    const scan = (code: string): number[] => bareSendCalls(parseSource('x.ts', code))

    it('flags e.sender.send and win.webContents.send, however the call is laid out', () => {
      expect(scan("e.sender.send('a', p)")).toEqual([1])
      expect(scan("const f = (p) =>\n  win.webContents.send('a', p)")).toEqual([2])
      expect(scan("x?.send('a')")).toEqual([1])
    })

    it('passes the helper, a comment, and a name that merely contains send', () => {
      expect(scan("sendIfAlive(e.sender, 'a', p)")).toEqual([])
      expect(scan("// e.sender.send('a')\nconst x = 1")).toEqual([])
      expect(scan("sender.sendFile('a')")).toEqual([])
    })
  })
})
