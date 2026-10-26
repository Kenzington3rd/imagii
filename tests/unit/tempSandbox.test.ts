import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * T-113 (10) — the three test files that share a temp-folder family each have a private one.
 *
 * `tempCleanup.test.ts` recursively removes `tmpdir()/imagii-audio`, `imagii-concat` and
 * `imagii-import` and asserts exact counts; `extract.test.ts` and `transcribeCancel.test.ts`
 * run the real extractor, which writes `tmpdir()/imagii-audio`. vitest runs files in parallel,
 * so with one real `tmpdir()` between them a WAV could vanish mid-test or a count could be off
 * by another file's file. Each of the three now mocks `node:os` so that `tmpdir()` — for the
 * module under test AND the test — is a folder made for that file alone.
 *
 * The rule, mechanically: these files contain a `vi.mock('node:os', …)` that replaces `tmpdir`,
 * and clean it up afterwards. It reads source text, so it cannot see that the mock WORKS —
 * `tempCleanup.test.ts` asserting exact counts with the other two running beside it, 40 times in
 * a row, is what showed that. A new test that writes into one of the three families and rm's it
 * adds its file to this list.
 */
const ROOT = path.resolve(__dirname, '../..')
const SANDBOXED = [
  'src/main/tempCleanup.test.ts',
  'src/main/audio/extract.test.ts',
  'src/main/sidecars/transcribeCancel.test.ts'
]

/** True when `source` replaces `node:os`'s tmpdir with a private folder and removes it afterwards. */
export function sandboxesTmpdir(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  return (
    /vi\.mock\(\s*'node:os'/.test(code) &&
    /mkdtempSync\(/.test(code) &&
    /tmpdir\s*[,=:]/.test(code) &&
    /afterAll\(\s*\(\)\s*=>\s*\{[\s\S]*?rmSync\(\s*tmpdir\(\)/.test(code)
  )
}

describe('each test file that fills or empties a shared temp family has its own tmpdir (T-113)', () => {
  it.each(SANDBOXED)('%s mocks node:os tmpdir to a private folder and removes it', (file) => {
    expect(sandboxesTmpdir(readFileSync(path.join(ROOT, file), 'utf8')), file).toBe(true)
  })

  describe('the check itself discriminates', () => {
    const GOOD = `
      vi.mock('node:os', async (importOriginal) => {
        const actual = await importOriginal()
        const sandbox = mkdtempSync(join(actual.tmpdir(), 'x-'))
        const tmpdir = () => sandbox
        return { ...actual, tmpdir, default: { ...actual, tmpdir } }
      })
      afterAll(() => {
        rmSync(tmpdir(), { recursive: true, force: true })
      })`

    it('accepts a sandbox with its cleanup', () => {
      expect(sandboxesTmpdir(GOOD)).toBe(true)
    })

    it('rejects no mock, a mock that is only in a comment, and a sandbox that is never removed', () => {
      expect(sandboxesTmpdir("import { tmpdir } from 'node:os'")).toBe(false)
      expect(sandboxesTmpdir(`// vi.mock('node:os', async () => {})\n/* mkdtempSync( tmpdir = rmSync(tmpdir() */`)).toBe(false)
      expect(sandboxesTmpdir(GOOD.replace(/afterAll[\s\S]*$/, ''))).toBe(false)
    })
  })

  it('no other test file empties the real temp families', () => {
    // `tempCleanup.test.ts` is the one that does; the rest of the suite must not remove
    // `imagii-audio` / `imagii-concat` / `imagii-import` under a real tmpdir.
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.test\.tsx?$/.test(name)) {
          const rel = path.relative(ROOT, full).split(path.sep).join('/')
          if (SANDBOXED.includes(rel)) continue
          const text = readFileSync(full, 'utf8')
          if (/(rmSync|rm)\([^)]*imagii-(audio|concat|import)\b/.test(text)) offenders.push(rel)
        }
      }
    }
    walk(path.join(ROOT, 'src'))
    expect(offenders, 'test files that remove a shared temp family without a sandbox').toEqual([])
  })
})
