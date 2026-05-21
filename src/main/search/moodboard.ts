import { net } from 'electron'
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { moodboardsDir, thumbsCacheDir } from '../sidecars/paths'
import type { MoodBoardCollection, MoodBoardItem, SearchResult } from '../../shared/search'
import { parseCollection } from '../../shared/moodboardParse'

async function ensureDirs(): Promise<void> {
  await mkdir(moodboardsDir(), { recursive: true })
  await mkdir(thumbsCacheDir(), { recursive: true })
}

/**
 * INIT-C (round 15): renderer-supplied `id` strings reach path.join() —
 * gate with the nanoid alphabet so `../` can't escape the moodboards dir.
 */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/
function assertSafeId(id: unknown, name: string): asserts id is string {
  if (typeof id !== 'string' || !SAFE_ID_RE.test(id)) {
    throw new Error(`${name} must match nanoid alphabet`)
  }
}

/**
 * Confine cachedThumbPath strings to thumbsCacheDir. The shared parser
 * already gates on isSafeAbsolutePath, but the protocol handler would
 * still happily serve any absolute path that survives that gate (e.g.
 * a path under userData/recordings). M2 fix (round 15): unset the field
 * whenever the path escapes thumbsCacheDir so the UI shows a placeholder
 * rather than serving the wrong file. Same shape as captions:copySrtTo.
 */
function confineThumbPath(item: MoodBoardItem): MoodBoardItem {
  if (!item.cachedThumbPath) return item
  const rel = path.relative(thumbsCacheDir(), item.cachedThumbPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ...item, cachedThumbPath: undefined }
  }
  return item
}

/**
 * Read + parse a board JSON file into a fully-normalized collection, or
 * `null` if the file is missing, unreadable, not JSON, or structurally
 * wrong. Single choke point so every caller is guarded the same way —
 * `parseCollection` guarantees `items` is always an array, so callers
 * can touch `collection.items` without a TypeError.
 */
async function readCollection(file: string): Promise<MoodBoardCollection | null> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = parseCollection(raw)
    if (!parsed) return null
    return {
      ...parsed,
      items: parsed.items.map(confineThumbPath)
    }
  } catch {
    return null
  }
}

export async function listCollections(): Promise<MoodBoardCollection[]> {
  await ensureDirs()
  const dir = moodboardsDir()
  if (!existsSync(dir)) return []
  const files = await readdir(dir)
  const collections: MoodBoardCollection[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const collection = await readCollection(path.join(dir, f))
    if (collection) collections.push(collection)
  }
  collections.sort((a, b) => b.createdAt - a.createdAt)
  return collections
}

export async function createCollection(name: string): Promise<MoodBoardCollection> {
  await ensureDirs()
  const collection: MoodBoardCollection = {
    id: nanoid(10),
    name: name.trim() || 'Untitled board',
    items: [],
    createdAt: Date.now()
  }
  await writeFile(
    path.join(moodboardsDir(), `${collection.id}.json`),
    JSON.stringify(collection, null, 2),
    'utf8'
  )
  return collection
}

export async function deleteCollection(id: string): Promise<void> {
  assertSafeId(id, 'deleteCollection id')
  const file = path.join(moodboardsDir(), `${id}.json`)
  if (!existsSync(file)) return
  // Best-effort: clean up every cached thumbnail this board owns before
  // unlinking the JSON, mirroring removeFromCollection's per-item cleanup.
  // A corrupt/missing JSON yields a null collection — the JSON unlink
  // still proceeds.
  const collection = await readCollection(file)
  if (collection) {
    for (const item of collection.items) {
      if (item.cachedThumbPath && existsSync(item.cachedThumbPath)) {
        try {
          await unlink(item.cachedThumbPath)
        } catch {
          /* ignore */
        }
      }
    }
  }
  await unlink(file)
}

export async function renameCollection(id: string, name: string): Promise<MoodBoardCollection | null> {
  assertSafeId(id, 'renameCollection id')
  const file = path.join(moodboardsDir(), `${id}.json`)
  if (!existsSync(file)) return null
  const collection = await readCollection(file)
  if (!collection) return null
  collection.name = name.trim() || collection.name
  await writeFile(file, JSON.stringify(collection, null, 2), 'utf8')
  return collection
}

async function cacheThumb(thumbnailUrl: string): Promise<string | undefined> {
  try {
    const res = await net.fetch(thumbnailUrl)
    if (!res.ok) return undefined
    const buffer = Buffer.from(await res.arrayBuffer())
    const filename = `${nanoid(12)}.jpg`
    const filePath = path.join(thumbsCacheDir(), filename)
    await writeFile(filePath, buffer)
    return filePath
  } catch {
    return undefined
  }
}

export async function addToCollection(
  collectionId: string,
  result: SearchResult
): Promise<MoodBoardCollection | null> {
  assertSafeId(collectionId, 'addToCollection collectionId')
  const file = path.join(moodboardsDir(), `${collectionId}.json`)
  if (!existsSync(file)) return null
  const collection = await readCollection(file)
  if (!collection) return null
  if (collection.items.some((i) => i.fullUrl === result.fullUrl)) return collection
  const cachedThumbPath = await cacheThumb(result.thumbnail)
  const item: MoodBoardItem = {
    id: nanoid(10),
    collectionId,
    thumbnail: result.thumbnail,
    fullUrl: result.fullUrl,
    source: result.source,
    title: result.title,
    cachedThumbPath,
    addedAt: Date.now()
  }
  collection.items.push(item)
  await writeFile(file, JSON.stringify(collection, null, 2), 'utf8')
  return collection
}

export async function removeFromCollection(
  collectionId: string,
  itemId: string
): Promise<MoodBoardCollection | null> {
  assertSafeId(collectionId, 'removeFromCollection collectionId')
  assertSafeId(itemId, 'removeFromCollection itemId')
  const file = path.join(moodboardsDir(), `${collectionId}.json`)
  if (!existsSync(file)) return null
  const collection = await readCollection(file)
  if (!collection) return null
  const removed = collection.items.find((i) => i.id === itemId)
  collection.items = collection.items.filter((i) => i.id !== itemId)
  if (removed?.cachedThumbPath && existsSync(removed.cachedThumbPath)) {
    try {
      await unlink(removed.cachedThumbPath)
    } catch {
      /* ignore */
    }
  }
  await writeFile(file, JSON.stringify(collection, null, 2), 'utf8')
  return collection
}

export async function pruneThumbCache(maxBytes = 500 * 1024 * 1024): Promise<void> {
  const dir = thumbsCacheDir()
  if (!existsSync(dir)) return
  const files = await readdir(dir)
  const stats = await Promise.all(
    files.map(async (f) => {
      const fs = await import('node:fs/promises')
      const stat = await fs.stat(path.join(dir, f))
      return { file: f, mtime: stat.mtimeMs, size: stat.size }
    })
  )
  let total = stats.reduce((acc, s) => acc + s.size, 0)
  if (total <= maxBytes) return
  stats.sort((a, b) => a.mtime - b.mtime)
  for (const s of stats) {
    if (total <= maxBytes) break
    try {
      await unlink(path.join(dir, s.file))
      total -= s.size
    } catch {
      /* ignore */
    }
  }
}
