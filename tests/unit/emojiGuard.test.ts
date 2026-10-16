import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * T-123 (30), after T-122 (6) - the no-emoji guard watches every directory of `src/` AND every type of file in it.
 *
 * T-122's claim was "every directory is covered", and it was true of directories only: the script read `.ts` and `.tsx`
 * and nothing else, so an emoji written into `src/renderer/index.html` (the page every window loads, its `<title>` shown
 * by the OS) or into the stylesheet passed with the hook, `npm run check:emoji` and `npm run verify` all silent
 * (executed). It reads `.html` and `.css` too now, and the third check below fails when a file of any other type
 * appears under `src/` (an `.svg`, a `.json`, an `.mjs`) until it is either listed or this test is told why not.
 *
 * T-122 (6) - the no-emoji guard watches every directory of `src/`.
 *
 * `scripts/check-emoji.mjs` scans a fixed list of roots (`ROOTS`), and `src/preload` was not on it: the
 * one directory that sits between the renderer and main (the toast icon, a label, a thrown message can
 * all be written there) was the only part of `src/` an emoji could be added to with the hook, `npm run
 * check:emoji` and `npm run verify` all silent. Two checks, so the list cannot fall behind again:
 *  - the list is read out of the script and every directory directly under `src/` must be in it (a new
 *    top-level source directory is a failing test until it is scanned);
 *  - the script is RUN, from a scratch tree, on one emoji in each root: it must exit 1 and name the file.
 *    A guard that was never seen to fail is a guard that might not.
 */
const ROOT = path.resolve(__dirname, '../..')
const SCRIPT = path.join(ROOT, 'scripts', 'check-emoji.mjs')

/** The `ROOTS` array of the script, as written. */
function guardRoots(): string[] {
  const m = readFileSync(SCRIPT, 'utf8').match(/^const ROOTS = \[([^\]]*)\]/m)
  if (!m) throw new Error('scripts/check-emoji.mjs has no `const ROOTS = [...]` line')
  return [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] as string)
}

/** The `EXTENSIONS` array of the script, as written. */
function guardExtensions(): string[] {
  const m = readFileSync(SCRIPT, 'utf8').match(/^const EXTENSIONS = \[([^\]]*)\]/m)
  if (!m) throw new Error('scripts/check-emoji.mjs has no `const EXTENSIONS = [...]` line')
  return [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] as string)
}

/** The extension of every file under `src/`, without the dot ("ts", "tsx", "css", "html"). */
function sourceExtensions(dir = path.join(ROOT, 'src')): Set<string> {
  const found = new Set<string>()
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      for (const ext of sourceExtensions(full)) found.add(ext)
    } else {
      found.add(path.extname(name).slice(1))
    }
  }
  return found
}

/** Every directory directly under `src/`. */
function sourceDirs(): string[] {
  const src = path.join(ROOT, 'src')
  return readdirSync(src)
    .filter((name) => statSync(path.join(src, name)).isDirectory())
    .map((name) => `src/${name}`)
}

/** Run the guard with `files` (relative path -> text) laid out under a scratch working directory. */
function runGuard(files: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'imagii-emoji-guard-'))
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true })
      writeFileSync(path.join(cwd, rel), text)
    }
    const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' })
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

// Built from code points, so this file itself carries no pictograph.
const PARTY = String.fromCodePoint(0x1f389)

describe('the emoji guard covers all of src (T-122)', () => {
  it('every directory under src/ is one of the guard\'s roots, and every root exists', () => {
    const roots = guardRoots()
    for (const dir of sourceDirs()) expect(roots, `${dir} is not scanned by scripts/check-emoji.mjs`).toContain(dir)
    for (const root of roots) expect(sourceDirs(), `${root} is scanned but is not a directory of src/`).toContain(root)
  })

  it.each(['src/main', 'src/preload', 'src/renderer', 'src/shared'])(
    'an emoji in %s fails the guard and names the file',
    (dir) => {
      const r = runGuard({ [`${dir}/deep/oops.ts`]: `export const label = 'done ${PARTY}'\n` })
      expect(r.status, r.stderr).toBe(1)
      expect(r.stderr).toContain(`${path.join(dir, 'deep', 'oops.ts')}:1`)
    }
  )

  // T-123 (30): the file types. The two that were not read are the page the window loads and the stylesheet.
  it.each([
    ['src/renderer/index.html', `<title>imagii ${PARTY}</title>\n`],
    ['src/renderer/src/styles/index.css', `.chip::before { content: '${PARTY}'; }\n`]
  ])('an emoji in %s fails the guard and names the file', (rel, text) => {
    const r = runGuard({ [rel]: text })
    expect(r.status, r.stderr).toBe(1)
    expect(r.stderr).toContain(`${rel.split('/').join(path.sep)}:1`)
  })

  it('every type of file under src/ is one the guard reads (a new type is a failing test until it is listed)', () => {
    const read = guardExtensions()
    expect(read.sort()).toEqual(['css', 'html', 'ts', 'tsx'])
    for (const ext of sourceExtensions()) expect(read, `a .${ext} file under src/ is not read by scripts/check-emoji.mjs`).toContain(ext)
  })

  it('the control: the same file without the emoji passes, and a test file may carry one', () => {
    const clean = runGuard({ 'src/preload/index.ts': "export const label = 'done'\n" })
    expect(clean.status, clean.stderr).toBe(0)
    expect(clean.stdout).toMatch(/check-emoji: clean \(1 files scanned\)/)
    const page = runGuard({ 'src/renderer/index.html': '<title>imagii</title>\n', 'src/renderer/src/styles/index.css': 'a { color: red; }\n' })
    expect(page.status, page.stderr).toBe(0)
    expect(page.stdout).toMatch(/check-emoji: clean \(2 files scanned\)/)
    const fixture = runGuard({ 'src/preload/index.test.ts': `expect(strip('${PARTY}')).toBe('')\n` })
    expect(fixture.status, fixture.stderr).toBe(0)
  })
})
