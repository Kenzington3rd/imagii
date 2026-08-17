import { net } from 'electron'
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises'
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
 * Round 18: serialize every read-modify-write against a board file.
 * ipcMain.handle invocations are NOT serialized per channel, so two quick
 * "Save" clicks fired two concurrent addToCollection calls that both read
 * the same pre-write JSON — the second write clobbered the first and one
 * item silently vanished (its success toast still showed). Chain each
 * mutation on the previous one, keyed by collection id.
 */
const collectionLocks = new Map<string, Promise<unknown>>()

function withCollectionLock<T>(collectionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = collectionLocks.get(collectionId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  collectionLocks.set(collectionId, next)
  // Drop the map entry once the chain drains so the map can't grow forever.
  void next.finally(() => {
    if (collectionLocks.get(collectionId) === next) collectionLocks.delete(collectionId)
  })
  return next
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
  return withCollectionLock(id, async () => {
    const file = path.join(moodboardsDir(), `${id}.json`)
    if (!existsSync(file)) return
    // T-58: the JSON goes, the board's cached thumbnails stay. A delete is
    // undoable for the rest of the session now, and an undone delete has to
    // look like the delete never happened — a board that comes back with
    // dead thumbnail paths does not. Reaping them here made that impossible,
    // so the reap moved to `sweepOrphanThumbs()` at startup, past the point
    // any undo can reach; the LRU in `pruneThumbCache` is the second net.
    // These files live in `cache/thumbs` and re-derive from `item.thumbnail`,
    // which is what makes deferring them safe and deleting them eagerly not.
    await unlink(file)
  })
}

/**
 * T-58 — write these boards to disk and delete every board that is not among
 * them. The single inverse for the whole references history: undo and redo
 * hand over the snapshot they just restored and the directory is made to
 * match, so one path covers create, rename, delete, item add and item remove
 * instead of five hand-written opposites (and a re-created board keeps its
 * own id, items and createdAt rather than becoming a new board that merely
 * looks similar).
 *
 * Untrusted input: each board is normalized through `parseCollection` — the
 * same parser that guards the read side — and each thumbnail path is confined
 * to the cache dir, so what we write is what we would have accepted.
 */
export async function restoreCollections(
  collections: ReadonlyArray<MoodBoardCollection>
): Promise<void> {
  await ensureDirs()
  const dir = moodboardsDir()
  const keep = new Set<string>()

  for (const raw of collections) {
    const normalized = parseCollection(JSON.stringify(raw))
    if (!normalized) continue
    const collection: MoodBoardCollection = {
      ...normalized,
      items: normalized.items.map(confineThumbPath)
    }
    keep.add(collection.id)
    await withCollectionLock(collection.id, () =>
      writeFile(
        path.join(dir, `${collection.id}.json`),
        JSON.stringify(collection, null, 2),
        'utf8'
      )
    )
  }

  for (const f of await readdir(dir)) {
    if (!f.endsWith('.json')) continue
    const id = f.slice(0, -'.json'.length)
    if (keep.has(id)) continue
    await withCollectionLock(id, async () => {
      try {
        await unlink(path.join(dir, f))
      } catch {
        /* already gone */
      }
    })
  }
}

export async function renameCollection(id: string, name: string): Promise<MoodBoardCollection | null> {
  assertSafeId(id, 'renameCollection id')
  return withCollectionLock(id, async () => {
    const file = path.join(moodboardsDir(), `${id}.json`)
    if (!existsSync(file)) return null
    const collection = await readCollection(file)
    if (!collection) return null
    collection.name = name.trim() || collection.name
    await writeFile(file, JSON.stringify(collection, null, 2), 'utf8')
    return collection
  })
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
  return withCollectionLock(collectionId, async () => {
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
  })
}

export async function removeFromCollection(
  collectionId: string,
  itemId: string
): Promise<MoodBoardCollection | null> {
  assertSafeId(collectionId, 'removeFromCollection collectionId')
  assertSafeId(itemId, 'removeFromCollection itemId')
  return withCollectionLock(collectionId, async () => {
    const file = path.join(moodboardsDir(), `${collectionId}.json`)
    if (!existsSync(file)) return null
    const collection = await readCollection(file)
    if (!collection) return null
    // T-58: the item's cached thumbnail is left alone for the same reason a
    // deleted board's are — removing an item is undoable, and an undone
    // remove that comes back without its picture is not an undo.
    // `sweepOrphanThumbs()` reclaims it on the next launch.
    collection.items = collection.items.filter((i) => i.id !== itemId)
    await writeFile(file, JSON.stringify(collection, null, 2), 'utf8')
    return collection
  })
}

/**
 * T-58 — reclaim cached thumbnails no board refers to any more.
 *
 * Deleting a board or an item leaves its thumbnails behind so the undo that
 * may follow can put the board back whole. Nothing in a running session can
 * tell when the last undo step that could resurrect them has fallen off the
 * 50-step cap, so the reap happens once per launch instead, before any window
 * exists: at that moment an orphan is genuinely unreachable.
 *
 * Two deliberate refusals to delete:
 *   - if any board file fails to parse, the sweep does nothing at all. A
 *     directory we cannot read in full is a directory we must not garbage-
 *     collect — one corrupt board would otherwise cost the user every
 *     thumbnail it owned.
 *   - files written after the board list was read are skipped, so a save
 *     racing startup cannot lose its thumbnail between the two writes.
 *
 * Returns the number of files removed.
 */
export async function sweepOrphanThumbs(): Promise<number> {
  const thumbs = thumbsCacheDir()
  const boards = moodboardsDir()
  if (!existsSync(thumbs) || !existsSync(boards)) return 0
  const startedAt = Date.now()

  const referenced = new Set<string>()
  for (const f of await readdir(boards)) {
    if (!f.endsWith('.json')) continue
    const collection = await readCollection(path.join(boards, f))
    if (!collection) return 0
    for (const item of collection.items) {
      if (item.cachedThumbPath) referenced.add(path.resolve(item.cachedThumbPath))
    }
  }

  let removed = 0
  for (const f of await readdir(thumbs)) {
    const file = path.join(thumbs, f)
    if (referenced.has(path.resolve(file))) continue
    try {
      // Floored: `Date.now()` is whole milliseconds while `mtimeMs` carries a
      // fraction, so a file written moments BEFORE the sweep can otherwise
      // read as newer than it and never be collected at all.
      if (Math.floor((await stat(file)).mtimeMs) > startedAt) continue
      await unlink(file)
      removed += 1
    } catch {
      /* gone, or not ours to remove */
    }
  }
  return removed
}

export async function pruneThumbCache(maxBytes = 500 * 1024 * 1024): Promise<void> {
  const dir = thumbsCacheDir()
  if (!existsSync(dir)) return
  const files = await readdir(dir)
  const stats = await Promise.all(
    files.map(async (f) => {
      const info = await stat(path.join(dir, f))
      return { file: f, mtime: info.mtimeMs, size: info.size }
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
