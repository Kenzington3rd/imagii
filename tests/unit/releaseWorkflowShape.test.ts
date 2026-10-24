import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * T-93 — the release workflow runs on manual dispatch and on a `v*` tag push,
 * and on nothing else.
 *
 * CLAUDE.md makes a CI trigger a standing financial commitment: a workflow
 * that listens to `push` on branches, to `pull_request`, or to a `schedule`
 * bills for work nobody asked for. The release workflow's trigger is that
 * rule in one place, and a future edit to its body or its steps must not be
 * able to widen it without this file failing.
 *
 * The workflow is plain YAML with a fixed two-space shape, so the `on:` block
 * is read textually. A YAML parser would be a new dependency for one check.
 */

const WORKFLOW = path.resolve(__dirname, '../../.github/workflows/release.yml')

/** The lines under the top-level `on:` key, up to the next top-level key. */
export function onBlock(source: string): string[] {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => /^on:\s*$/.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^\S/.test(line)) break
    out.push(line)
  }
  return out
}

/** The event names directly under `on:` (two-space indent), in file order. */
export function triggerNames(block: string[]): string[] {
  return block.flatMap((line) => {
    const m = /^ {2}([A-Za-z_]+):/.exec(line)
    return m && m[1] ? [m[1]] : []
  })
}

/** The keys nested directly under one event (four-space indent). */
export function childKeys(block: string[], trigger: string): string[] {
  const at = block.findIndex((line) => line === `  ${trigger}:`)
  if (at < 0) return []
  const out: string[] = []
  for (let i = at + 1; i < block.length; i++) {
    const line = block[i] ?? ''
    if (/^ {2}\S/.test(line)) break
    const m = /^ {4}([A-Za-z_]+):/.exec(line)
    if (m && m[1]) out.push(m[1])
  }
  return out
}

/** The values listed under `push: tags:` (six-space dash items). */
export function tagPatterns(block: string[]): string[] {
  const out: string[] = []
  let inTags = false
  for (const line of block) {
    if (/^ {4}tags:\s*$/.test(line)) {
      inTags = true
      continue
    }
    if (inTags && /^ {4}\S/.test(line)) break
    if (inTags) {
      const m = /^ {6}-\s*['"]?([^'"]+?)['"]?\s*$/.exec(line)
      if (m && m[1]) out.push(m[1])
    }
  }
  return out
}

describe('the release workflow fires on dispatch and on a v* tag, and nothing else', () => {
  const block = onBlock(readFileSync(WORKFLOW, 'utf8'))

  it('the on: block names exactly workflow_dispatch and push', () => {
    expect(triggerNames(block).sort()).toEqual(['push', 'workflow_dispatch'])
  })

  it('push carries only tags — no branches filter, so no push-to-main run', () => {
    expect(childKeys(block, 'push')).toEqual(['tags'])
  })

  it('the one tag pattern is v*', () => {
    expect(tagPatterns(block)).toEqual(['v*'])
  })
})

describe('the same check rejects a widened trigger (it can tell the difference)', () => {
  const WIDENED = [
    'name: Release standalone exe',
    '',
    'on:',
    '  workflow_dispatch:',
    '  push:',
    '    branches: [main]',
    '    tags:',
    "      - 'v*'",
    '  pull_request:',
    '  schedule:',
    "    - cron: '0 3 * * *'",
    '',
    'jobs:',
    '  build-and-release:',
    '    runs-on: windows-latest',
    ''
  ].join('\n')
  const block = onBlock(WIDENED)

  it('sees push branches, pull_request and schedule as extra triggers', () => {
    expect(triggerNames(block).sort()).toEqual(['pull_request', 'push', 'schedule', 'workflow_dispatch'])
    expect(childKeys(block, 'push')).toEqual(['branches', 'tags'])
  })
})

/**
 * T-120 (8) - the exe ships the Electron the tests ran.
 *
 * `electron-builder.yml` pinned `electronVersion: 31.3.0` while the lockfile resolved 31.7.7 and every unit,
 * E2E and Layer 5 run used that one: the runtime that shipped never ran under any test. With no pin
 * electron-builder reads the installed `electron` package, which is the lockfile's. The release run on the
 * Windows runner is where the packaged build is checked.
 */
describe('electron-builder.yml does not pin an Electron version (T-120)', () => {
  const builder = readFileSync(path.resolve(__dirname, '../../electron-builder.yml'), 'utf8')

  it('has no electronVersion key, so the packaged runtime is the installed one', () => {
    expect(builder).not.toMatch(/^\s*electronVersion\s*:/m)
  })

  it('the check can tell: the line it removed would have been found', () => {
    expect('appId: x\nelectronVersion: 31.3.0\n').toMatch(/^\s*electronVersion\s*:/m)
    expect('appId: x\n# electronVersion was pinned here\n').not.toMatch(/^\s*electronVersion\s*:/m)
  })
})

/**
 * T-121 (2) - the portable exe ships one ffprobe, and no dependency nothing imports.
 *
 * ffprobe-static carries six platforms' binaries (336 MiB measured in the unpacked tree) and a Windows
 * x64 build loads one of them (`ffprobe-static/index.js` joins `bin/win32/x64/ffprobe.exe`); the other
 * five were unpacked on every launch (T-110 (ai)). Four dependencies (fluent-ffmpeg, pdf-lib,
 * music-metadata, file-type) were imported by no file under `src`. A `electron-builder --dir` probe of the
 * trimmed tree held `bin/win32/x64/ffprobe.exe` and nothing else under `bin`.
 */
describe('the packaged tree carries one ffprobe and no unused dependency (T-121)', () => {
  const builder = readFileSync(path.resolve(__dirname, '../../electron-builder.yml'), 'utf8')
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  const EXCLUDES = [
    '!node_modules/ffprobe-static/bin/darwin/**',
    '!node_modules/ffprobe-static/bin/linux/**',
    '!node_modules/ffprobe-static/bin/win32/ia32/**'
  ]
  const excluded = (yml: string, pattern: string): boolean =>
    new RegExp(`^\\s*-\\s*"${pattern.replace(/[*.]/g, '\\$&')}"\\s*$`, 'm').test(yml)

  it.each(EXCLUDES)('files excludes %s', (pattern) => {
    expect(excluded(builder, pattern)).toBe(true)
  })

  it('and never excludes the one binary a Windows x64 build loads', () => {
    expect(builder).not.toMatch(/ffprobe-static\/bin\/win32\/x64/)
    expect(builder).not.toMatch(/ffprobe-static\/bin\/win32\/\*\*/)
  })

  it.each(['fluent-ffmpeg', 'pdf-lib', 'music-metadata', 'file-type'])(
    '%s is not a dependency: nothing imports it',
    (name) => {
      expect(Object.keys(pkg.dependencies)).not.toContain(name)
    }
  )

  it('the check can tell: a files list without the line, or with it commented out, is not excluded', () => {
    const line = '  - "!node_modules/ffprobe-static/bin/linux/**"\n'
    expect(excluded(`files:\n${line}`, EXCLUDES[1] as string)).toBe(true)
    expect(excluded('files:\n  - "out/**/*"\n', EXCLUDES[1] as string)).toBe(false)
    expect(excluded(`files:\n  # ${line.trim()}\n`, EXCLUDES[1] as string)).toBe(false)
  })
})

/**
 * T-131 (18) - Inter's license travels with the font.
 *
 * T-127 (2) moved `@fontsource/inter` to devDependencies (Vite inlines the woff2 files into the renderer bundle, so the asar stopped carrying
 * 4.38 MB nothing reads at run time). The package's `LICENSE` was the packaged tree's ONLY copy of the SIL Open Font License, and it left the asar
 * with the rest of the package while the font files kept shipping. `extraResources` copies it out of `node_modules` at package time, to
 * `resources/licenses/Inter-OFL.txt` beside `app.asar`. Whether the file lands in the packaged tree is the release run's hand-check
 * (TESTING.md); what a unit test can hold is that the configuration asks for it, that the source it copies exists and is the license, and that the
 * font it belongs to is still the one the page ships.
 */
describe('the packaged tree carries Inter\'s license (T-131 (18))', () => {
  const root = path.resolve(__dirname, '../..')
  const builder = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
  const FROM = 'node_modules/@fontsource/inter/LICENSE'
  const TO = 'licenses/Inter-OFL.txt'

  /** An `extraResources` entry that copies `from` to `to`, as electron-builder reads it (comment lines do not count). */
  const copies = (yml: string, from: string, to: string): boolean => {
    const code = yml.replace(/^\s*#.*$/gm, '')
    const block = /^extraResources:\s*\n((?:[ \t]+.*\n?)+)/m.exec(code)?.[1] ?? ''
    return new RegExp(`^\\s*-\\s*from:\\s*${from.replace(/[*.]/g, '\\$&')}\\s*\\n\\s*to:\\s*${to.replace(/[*.]/g, '\\$&')}\\s*$`, 'm').test(block)
  }

  it('extraResources copies the package LICENSE to resources/licenses/Inter-OFL.txt', () => {
    expect(copies(builder, FROM, TO)).toBe(true)
  })

  it('the file it copies is installed (devDependencies are installed at build time) and is the SIL Open Font License', () => {
    const license = readFileSync(path.join(root, FROM), 'utf8')
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(license).toContain('The Inter Project Authors')
  })

  it('the font it belongs to still ships: the stylesheet names the package\'s woff2 files (T-128 (2)), and the package is pinned in devDependencies', () => {
    const css = readFileSync(path.join(root, 'src/renderer/src/styles/index.css'), 'utf8')
    expect(css).toMatch(/@fontsource\/inter\/files\/inter-latin-\d+-normal\.woff2/)
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> }
    expect(Object.keys(pkg.devDependencies)).toContain('@fontsource/inter')
  })

  it('the check can tell: no entry, a commented-out entry, another destination and another source are each found', () => {
    expect(copies(`appId: x\nextraResources:\n  - from: ${FROM}\n    to: ${TO}\nasar: true\n`, FROM, TO)).toBe(true)
    expect(copies('appId: x\nasar: true\n', FROM, TO)).toBe(false)
    expect(copies(`appId: x\n# extraResources:\n#   - from: ${FROM}\n#     to: ${TO}\nasar: true\n`, FROM, TO)).toBe(false)
    expect(copies(`extraResources:\n  - from: ${FROM}\n    to: licenses/Other.txt\n`, FROM, TO)).toBe(false)
    expect(copies(`extraResources:\n  - from: node_modules/other/LICENSE\n    to: ${TO}\n`, FROM, TO)).toBe(false)
  })
})
