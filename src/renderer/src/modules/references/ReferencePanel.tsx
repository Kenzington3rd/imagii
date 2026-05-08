import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { SearchResult } from '@shared/search'
import { useReferencesStore } from './state/referencesStore'

export function ReferencePanel(): JSX.Element {
  const search = useReferencesStore((s) => s.search)
  const response = useReferencesStore((s) => s.searchResponse)
  const loading = useReferencesStore((s) => s.searchLoading)
  const error = useReferencesStore((s) => s.searchError)
  const collections = useReferencesStore((s) => s.collections)
  const selectedCollectionId = useReferencesStore((s) => s.selectedCollectionId)
  const addToCollection = useReferencesStore((s) => s.addToCollection)
  const refreshCollections = useReferencesStore((s) => s.refreshCollections)
  const createCollection = useReferencesStore((s) => s.createCollection)

  const [query, setQuery] = useState('')

  useEffect(() => {
    void refreshCollections()
  }, [refreshCollections])

  function submit(): void {
    if (!query.trim()) return
    void search(query)
  }

  async function ensureCollection(): Promise<string | null> {
    if (selectedCollectionId) return selectedCollectionId
    const name = prompt('Name your first mood board:')
    if (!name) return null
    await createCollection(name.trim() || 'Inspiration')
    const cs = await window.api.moodboard.list()
    return cs[0]?.id ?? null
  }

  async function saveResult(result: SearchResult): Promise<void> {
    const collectionId = await ensureCollection()
    if (!collectionId) return
    await addToCollection(collectionId, result)
    toast.success('Saved to mood board')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-3 flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="flex-1 bg-bg-base rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          placeholder="Search for inspiration… (e.g. minimalist mountain photography)"
        />
        <button className="btn-primary px-4 py-2 disabled:opacity-50" onClick={submit} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      <p className="text-xs text-ink-dim">
        🛡 SafeSearch is permanently on. All thumbnails are screened locally before display.
        Powered by DuckDuckGo image search.
      </p>

      {error ? (
        <div className="card p-3 border-rose-400/40 text-sm text-rose-200">{error}</div>
      ) : null}

      {response?.notice ? (
        <div className="card p-3 border-amber-400/40 text-sm text-amber-200">
          {response.notice}
        </div>
      ) : null}

      {response && response.results.length === 0 && !loading ? (
        <p className="text-sm text-ink-dim">No results.</p>
      ) : null}

      {response && response.results.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {response.results.map((result) => (
            <div
              key={result.id}
              className="group relative aspect-square bg-bg-hover rounded-md overflow-hidden"
            >
              <img
                src={result.thumbnail}
                alt={result.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 flex flex-col items-center justify-center gap-2 p-2 text-center">
                <span className="text-xs text-ink-base line-clamp-2">{result.title}</span>
                <span className="text-xs text-ink-dim">{result.source}</span>
                <button
                  className="btn-primary px-3 py-1 text-xs disabled:opacity-50"
                  onClick={() => saveResult(result)}
                  disabled={collections.length === 0 && !selectedCollectionId}
                >
                  ★ Save
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
