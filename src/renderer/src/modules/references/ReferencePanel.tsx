import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { SearchResult } from '@shared/search'
import { useReferencesStore } from './state/referencesStore'
import { Icon } from '../../components/Icon'
import { NameDialog } from '../../components/NameDialog'

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
  // T-28: the result waiting on a board to exist. Saving with no board yet
  // asked for a name through window's prompt — which Electron does not
  // implement, so the click threw and the FIRST save a new user tries was
  // impossible. The Save button was disabled into the bargain, which hid it.
  const [pendingResult, setPendingResult] = useState<SearchResult | null>(null)

  useEffect(() => {
    void refreshCollections()
  }, [refreshCollections])

  function submit(): void {
    if (!query.trim()) return
    void search(query)
  }

  /** Naming the board in the toast is the only place the answer to "where did
   *  that go?" appears — the grid the user is looking at is search results,
   *  not the board. */
  async function saveInto(
    collectionId: string,
    boardName: string,
    result: SearchResult
  ): Promise<void> {
    await addToCollection(collectionId, result)
    toast.success(`Saved to "${boardName}"`)
  }

  function saveResult(result: SearchResult): void {
    const board = collections.find((c) => c.id === selectedCollectionId)
    if (!selectedCollectionId || !board) {
      setPendingResult(result)
      return
    }
    void saveInto(board.id, board.name, result)
  }

  /** The first-save continuation: name the board, create it, save into it. */
  async function createBoardAndSave(name: string): Promise<void> {
    const result = pendingResult
    setPendingResult(null)
    if (!result) return
    // The id comes back from the create rather than from a re-read of the
    // directory: `list()[0]` is the newest board by createdAt, which is the
    // right answer only when nothing else has happened.
    const collectionId = await createCollection(name)
    await saveInto(collectionId, name, result)
  }

  return (
    <div className="flex flex-col gap-4">
      <NameDialog
        open={pendingResult !== null}
        title="Name your first mood board"
        label="Board name"
        confirmLabel="Create & save"
        onCancel={() => setPendingResult(null)}
        onConfirm={(name) => void createBoardAndSave(name)}
      />
      <div className="card p-3 flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="flex-1 min-w-0 bg-bg-base rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          placeholder="Search for inspiration… (e.g. minimalist mountain photography)"
        />
        <button className="btn-primary px-4 py-2 disabled:opacity-50" onClick={submit} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      <p className="text-xs text-ink-dim inline-flex items-start gap-1.5">
        <Icon name="shield" size={13} className="mt-0.5 flex-shrink-0" />
        <span>
          SafeSearch is permanently on. All thumbnails are screened locally before
          display. Powered by DuckDuckGo image search.
        </span>
      </p>

      {error ? (
        <div className="card p-3 border-danger-strong/40 text-sm text-danger-soft">{error}</div>
      ) : null}

      {response?.notice ? (
        <div className="card p-3 border-ember/40 text-sm text-warn">
          {response.notice}
        </div>
      ) : null}

      {/* "No results." is the answer to a search that RAN. A response carrying
          a notice is a search that could not run — since T-30 that is the
          common failure view, because a first-hop outage lands here too — and
          printing both said the search worked and found nothing (T-66). */}
      {response && response.results.length === 0 && !response.notice && !loading ? (
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
                {/* T-28: never disabled. "You have no board yet" is a reason
                    to ASK for one, not a reason to refuse the click — the
                    disabled state is what made the first-save prompt
                    unreachable, and hid the fact that it was broken. */}
                <button
                  className="btn-primary px-3 py-1 text-xs inline-flex items-center gap-1.5"
                  onClick={() => saveResult(result)}
                >
                  <Icon name="star" size={13} /> Save
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
