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
