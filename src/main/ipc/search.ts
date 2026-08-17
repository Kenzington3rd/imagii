import { ipcMain } from 'electron'
import {
  SearchUnavailableError,
  searchDuckduckgoImages,
  searchFailureNotice
} from '../search/duckduckgo'
import {
  addToCollection,
  createCollection,
  deleteCollection,
  listCollections,
  removeFromCollection,
  renameCollection,
  restoreCollections,
  pruneThumbCache
} from '../search/moodboard'
import type { MoodBoardCollection, SearchResponse, SearchResult } from '../../shared/search'
import { validateSearchResult } from '../../shared/search'
import { assertNonEmptyString } from '../../shared/validators'
import { assert } from '../../shared/assert'

// Round 17 phase-2: every moodboard handler now passes its renderer-supplied
// inputs through the same gates the rest of the IPC surface uses. The
// underlying store already gates ids with SAFE_ID_RE (round 15), but the
// IPC boundary is where untrusted input first arrives so a hostile/buggy
// renderer can't trigger an internal assertion message; it gets a clean
// validation error instead.
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/
const MAX_BOARD_NAME = 200
function assertSafeId(value: unknown, name: string): asserts value is string {
  assertNonEmptyString(value, name)
  assert(SAFE_ID_RE.test(value), `${name} must match nanoid alphabet`)
  assert(value.length <= 64, `${name} too long`)
}
function assertBoardName(value: unknown, name: string): asserts value is string {
  assertNonEmptyString(value, name)
  assert(value.length <= MAX_BOARD_NAME, `${name} exceeds ${MAX_BOARD_NAME} chars`)
}

/**
 * Normalize an untrusted `search:images` IPC argument.
 *
 * A non-string arg would make `query.trim()` throw a TypeError across the
 * IPC boundary; a non-string or blank string is treated as an empty
 * search. Returns `{ query }` to run a real search, or `{ empty }` — the
 * clean empty-result shape — to short-circuit.
 */
export function normalizeImageQuery(
  raw: unknown
): { query: string } | { empty: SearchResponse } {
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) {
    return { empty: { query: text, provider: 'duckduckgo', results: [] } }
  }
  return { query: text }
}

/**
 * The whole body of the `search:images` channel, lifted out of the handler so
 * it can be driven without an Electron main process.
 *
 * T-30: an outage on the first hop is the same event, for the user, as an
 * outage on the second — the search did not happen. Branching on the typed
 * sentinel here (T-44's rule) is what makes the channel promise a RESPONSE
 * rather than sometimes a rejection whose text the renderer would have to
 * recognize. Anything that is not that sentinel is a bug, not a failed
 * search, and still travels as one.
 */
export async function runImageSearch(query: unknown): Promise<SearchResponse> {
  const normalized = normalizeImageQuery(query)
  if ('empty' in normalized) return normalized.empty
  try {
    return await searchDuckduckgoImages(normalized.query)
  } catch (err) {
    if (err instanceof SearchUnavailableError) {
      return searchFailureNotice(normalized.query, err)
    }
    throw err
  }
}

export function registerSearchIpc(): void {
  ipcMain.handle('search:images', (_e, query: unknown) => runImageSearch(query))

  ipcMain.handle('moodboard:list', () => listCollections())
  ipcMain.handle('moodboard:create', (_e, name: unknown) => {
    assertBoardName(name, 'moodboard.name')
    return createCollection(name)
  })
  ipcMain.handle('moodboard:delete', (_e, id: unknown) => {
    assertSafeId(id, 'moodboard.id')
    return deleteCollection(id)
  })
  ipcMain.handle('moodboard:rename', (_e, id: unknown, name: unknown) => {
    assertSafeId(id, 'moodboard.id')
    assertBoardName(name, 'moodboard.name')
    return renameCollection(id, name)
  })
  ipcMain.handle(
    'moodboard:addItem',
    (_e, collectionId: unknown, result: unknown) => {
      assertSafeId(collectionId, 'moodboard.collectionId')
      validateSearchResult(result)
      // Strip any renderer-supplied cachedThumbPath — the store rebuilds it
      // via its own cacheThumb(). Trusting the inbound field would let a
      // hostile renderer point the cache slot at an arbitrary file path.
      const safe: SearchResult = {
        id: typeof (result as { id?: unknown }).id === 'string'
          ? (result as { id: string }).id
          : '',
        thumbnail: result.thumbnail,
        fullUrl: result.fullUrl,
        source: result.source,
        title: result.title
      }
      return addToCollection(collectionId, safe)
    }
  )
  ipcMain.handle(
    'moodboard:removeItem',
    (_e, collectionId: unknown, itemId: unknown) => {
      assertSafeId(collectionId, 'moodboard.collectionId')
      assertSafeId(itemId, 'moodboard.itemId')
      return removeFromCollection(collectionId, itemId)
    }
  )
  // T-58: the whole board list the references history just stepped back (or
  // forward) to. Ids and names are gated here like every other moodboard
  // argument; the items themselves are normalized by the store's own parser
  // before anything is written.
  ipcMain.handle('moodboard:restore', (_e, collections: unknown) => {
    assert(Array.isArray(collections), 'moodboard.collections must be an array')
    for (const entry of collections) {
      assert(
        typeof entry === 'object' && entry !== null,
        'moodboard.collections entry must be an object'
      )
      const board = entry as { id?: unknown; name?: unknown }
      assertSafeId(board.id, 'moodboard.id')
      assertBoardName(board.name, 'moodboard.name')
    }
    return restoreCollections(collections as MoodBoardCollection[])
  })
  ipcMain.handle('moodboard:prune', () => pruneThumbCache())
}
