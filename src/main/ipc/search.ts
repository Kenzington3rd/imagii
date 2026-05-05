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
import type { SearchResult } from '../../shared/search'

export function registerSearchIpc(): void {
  ipcMain.handle('search:images', async (_e, query: string) => {
    if (!query.trim()) return { query, provider: 'duckduckgo', results: [] }
    const response = await searchDuckduckgoImages(query)
    return response
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
