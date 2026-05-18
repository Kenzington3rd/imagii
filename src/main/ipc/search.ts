import { ipcMain } from 'electron'
import { searchDuckduckgoImages } from '../search/duckduckgo'
import {
  addToCollection,
  createCollection,
  deleteCollection,
  listCollections,
  removeFromCollection,
  renameCollection,
  pruneThumbCache
} from '../search/moodboard'
import type { SearchResponse, SearchResult } from '../../shared/search'

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

export function registerSearchIpc(): void {
  ipcMain.handle('search:images', async (_e, query: unknown) => {
    const normalized = normalizeImageQuery(query)
    if ('empty' in normalized) return normalized.empty
    return searchDuckduckgoImages(normalized.query)
  })

  ipcMain.handle('moodboard:list', () => listCollections())
  ipcMain.handle('moodboard:create', (_e, name: string) => createCollection(name))
  ipcMain.handle('moodboard:delete', (_e, id: string) => deleteCollection(id))
  ipcMain.handle('moodboard:rename', (_e, id: string, name: string) =>
    renameCollection(id, name)
  )
  ipcMain.handle(
    'moodboard:addItem',
    (_e, collectionId: string, result: SearchResult) =>
      addToCollection(collectionId, result)
  )
  ipcMain.handle(
    'moodboard:removeItem',
    (_e, collectionId: string, itemId: string) =>
      removeFromCollection(collectionId, itemId)
  )
  ipcMain.handle('moodboard:prune', () => pruneThumbCache())
}
