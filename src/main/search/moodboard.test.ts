import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SearchResult } from '../../shared/search'

// Round 18: cover the per-collection write lock. Two concurrent
// addToCollection calls used to read the same pre-write JSON and the second
// write clobbered the first — one saved item silently vanished.
let TMP = ''
vi.mock('electron', () => ({
  app: {
    getPath: () => TMP
  },
  net: {
    // cacheThumb must fail gracefully in tests — no network.
    fetch: async () => {
      throw new Error('no network in tests')
    }
  }
}))

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-moodboard-'))
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

function makeResult(n: number): SearchResult {
  return {
    id: `result-${n}`,
    title: `Result ${n}`,
    thumbnail: `https://example.invalid/thumb-${n}.jpg`,
    fullUrl: `https://example.invalid/full-${n}.jpg`,
    source: 'example.invalid',
    width: 100,
    height: 100
  }
}

describe('moodboard concurrent mutation safety (round 18)', () => {
  it('two concurrent saves both land in the collection', async () => {
    const m = await import('./moodboard')
    const board = await m.createCollection('Board')
    const [a, b] = await Promise.all([
      m.addToCollection(board.id, makeResult(1)),
      m.addToCollection(board.id, makeResult(2))
    ])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    const collections = await m.listCollections()
    const saved = collections.find((c) => c.id === board.id)
    expect(saved?.items.length).toBe(2)
  })

  it('a burst of concurrent saves loses nothing', async () => {
    const m = await import('./moodboard')
    const board = await m.createCollection('Burst')
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => m.addToCollection(board.id, makeResult(i)))
    )
    const collections = await m.listCollections()
    const saved = collections.find((c) => c.id === board.id)
    expect(saved?.items.length).toBe(8)
  })

  it('concurrent add + remove serialize without dropping the surviving item', async () => {
    const m = await import('./moodboard')
    const board = await m.createCollection('Mixed')
    const withOne = await m.addToCollection(board.id, makeResult(1))
    const firstId = withOne?.items[0]?.id
    expect(firstId).toBeTruthy()
    await Promise.all([
      m.addToCollection(board.id, makeResult(2)),
      m.removeFromCollection(board.id, firstId as string)
    ])
    const collections = await m.listCollections()
    const saved = collections.find((c) => c.id === board.id)
    expect(saved?.items.length).toBe(1)
    expect(saved?.items[0]?.fullUrl).toBe(makeResult(2).fullUrl)
  })
})
