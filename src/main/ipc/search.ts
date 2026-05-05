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
import { screenImage } from '../sidecars/nsfwManager'
import { thumbsCacheDir } from '../sidecars/paths'
import path from 'node:path'
import { net } from 'electron'
import { writeFile, mkdir } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import type { SearchResult } from '../../shared/search'

async function safeScreenSearchResults(
  results: SearchResult[]
): Promise<SearchResult[]> {
  await mkdir(thumbsCacheDir(), { recursive: true })
  const screened: SearchResult[] = []
  for (const r of results) {
    try {
      const tempThumbPath = path.join(thumbsCacheDir(), `screen-${nanoid(8)}.jpg`)
      const res = await net.fetch(r.thumbnail)
      if (!res.ok) {
        screened.push(r)
        continue
      }
      await writeFile(tempThumbPath, Buffer.from(await res.arrayBuffer()))
      const screen = await screenImage(tempThumbPath)
      try {
        const fs = await import('node:fs/promises')
        await fs.unlink(tempThumbPath)
      } catch {
        /* ignore */
      }
      if (!screen.blocked) screened.push(r)
    } catch {
      screened.push(r)
    }
  }
  return screened
}

export function registerSearchIpc(): void {
  ipcMain.handle('search:images', async (_e, query: string) => {
    if (!query.trim()) return { query, provider: 'duckduckgo', results: [] }
    const response = await searchDuckduckgoImages(query)
    response.results = await safeScreenSearchResults(response.results)
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
