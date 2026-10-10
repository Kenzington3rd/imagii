import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { countOf } from '@shared/plural'
import { useReferencesStore } from './state/referencesStore'
import { useCanvasStore, makeReferenceLayer } from '../image-studio/state/canvasStore'
import { NameDialog } from '../../components/NameDialog'
import { PanelHeader } from '../../components/PanelHeader'
import { reportFailure } from '../../lib/reportFailure'

export function MoodBoardPanel(): JSX.Element {
  const collections = useReferencesStore((s) => s.collections)
  const selectedCollectionId = useReferencesStore((s) => s.selectedCollectionId)
  const refreshCollections = useReferencesStore((s) => s.refreshCollections)
  const createCollection = useReferencesStore((s) => s.createCollection)
  const renameCollection = useReferencesStore((s) => s.renameCollection)
  const deleteCollection = useReferencesStore((s) => s.deleteCollection)
  const selectCollection = useReferencesStore((s) => s.selectCollection)
  const removeFromCollection = useReferencesStore((s) => s.removeFromCollection)
  const addCanvasLayer = useCanvasStore((s) => s.addLayer)
  const navigate = useNavigate()

  function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('Could not decode reference image'))
      img.src = src
    })
  }

  async function sendToCanvas(src: string, title: string): Promise<void> {
    try {
      const dims = await loadImageDimensions(src)
      const maxDim = 800
      const scale = Math.min(1, maxDim / Math.max(dims.width, dims.height))
      addCanvasLayer(makeReferenceLayer(src, dims.width * scale, dims.height * scale, title))
      toast.success("Added to canvas as a reference — it won't be in your export")
      navigate('/image')
    } catch (err) {
      reportFailure(err, { failed: "Couldn't add that image to the canvas." })
    }
  }

  useEffect(() => {
    void refreshCollections()
  }, [refreshCollections])

  const collection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId]
  )

  const [newName, setNewName] = useState('')
  // T-79: item ids whose cached thumbnail would not load. The cache is
  // disposable by design — "Clear thumbnail cache" empties it and the board
  // files keep their `cachedThumbPath` — so a tile pointed at a file that is
  // no longer there must fall back to the URL the picture came from rather
  // than stay broken for good. One way per item: if the source fails too,
  // the id is already in the set, nothing re-renders, and there is no loop.
  const [uncachedItemIds, setUncachedItemIds] = useState<ReadonlySet<string>>(new Set())
  // T-28: Rename used window's prompt, which Electron does not implement, so
  // the click threw in the renderer and nothing happened at all. The same
  // question, asked with the app's own dialog.
  const [renaming, setRenaming] = useState(false)

  async function onCreate(): Promise<void> {
    const name = newName.trim()
    if (!name) return
    await createCollection(name)
    setNewName('')
  }

  async function onRename(next: string): Promise<void> {
    setRenaming(false)
    if (!collection) return
    // Through the store, which is what makes a rename undoable like every
    // other board edit (T-58's history subscribes here, not to the IPC).
    await renameCollection(collection.id, next)
  }

  async function onDelete(): Promise<void> {
    if (!collection) return
    const ok = confirm(
      `Delete "${collection.name}" and all ${countOf(collection.items.length, 'item')}?`
    )
    if (!ok) return
    await deleteCollection(collection.id)
    // T-66: reversible since T-58, and the toast is the only place the user is
    // looking when it happens. The header's Undo button says the same thing,
    // but a board that just vanished is exactly when nobody is reading a
    // toolbar.
    toast.success('Deleted — press Ctrl+Z to undo')
  }

  return (
    <>
    <NameDialog
      open={renaming && collection !== null}
      title="Rename mood board"
      label="Board name"
      initialValue={collection?.name ?? ''}
      confirmLabel="Rename"
      onCancel={() => setRenaming(false)}
      onConfirm={(next) => void onRename(next)}
    />
    <div className="grid grid-cols-1 lg:grid-cols-[clamp(220px,16%,320px)_1fr] gap-4">
      <div className="card p-3 flex flex-col gap-3">
        <PanelHeader icon="star">Boards ({collections.length})</PanelHeader>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
            placeholder="New board name…"
            className="flex-1 min-w-0 bg-bg-base rounded px-2 py-1 text-sm"
          />
          <button
            className="btn-ghost px-3 py-1 text-sm"
            onClick={onCreate}
            title="Create board"
            aria-label="Create board"
          >
            +
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {collections.map((c) => {
            const isSelected = c.id === selectedCollectionId
            return (
              <li
                key={c.id}
                onClick={() => selectCollection(c.id)}
                className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm ${
                  isSelected
                    ? 'bg-accent/15 border border-accent'
                    : 'hover:bg-bg-hover border border-transparent'
                }`}
              >
                <span className="truncate flex-1">{c.name}</span>
                <span className="text-xs text-ink-dim ml-2">{c.items.length}</span>
              </li>
            )
          })}
        </ul>
        {collections.length === 0 ? (
          <p className="text-xs text-ink-dim">
            Create a board, then save references from the Reference Search tab.
          </p>
        ) : null}
        {/* Round 17 B8: wire the previously-dead prune handler so users can
            reclaim disk after binging on references. T-29: it called the
            500 MB LRU trim, so under the budget the toast was a lie — the
            channel is `clearThumbs` now and empties the directory. T-79:
            that clear is the only thing that empties this cache on purpose,
            and the tiles it empties out from under fall back to the source
            image above, so pressing it costs a re-download, never a board. */}
        <button
          className="btn-ghost px-2 py-1 text-xs text-ink-dim hover:text-ink-base self-start mt-auto"
          onClick={async () => {
            await window.api.moodboard.clearThumbs()
            toast.success('Thumbnail cache cleared')
          }}
          title="Drop the on-disk thumbnail cache for mood boards"
        >
          Clear thumbnail cache
        </button>
      </div>

      <div className="card p-4 flex flex-col gap-3 min-w-0">
        {collection ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold truncate">{collection.name}</h3>
              <div className="flex gap-2 text-sm">
                <button className="btn-ghost px-3 py-1" onClick={() => setRenaming(true)}>
                  Rename
                </button>
                <button
                  className="btn-ghost px-3 py-1 text-danger hover:text-danger-soft"
                  onClick={onDelete}
                >
                  Delete
                </button>
              </div>
            </div>
            {collection.items.length === 0 ? (
              <p className="text-sm text-ink-dim">
                Empty. Switch to Reference Search and click Save to add inspiration here.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {collection.items.map((item) => {
                  const src =
                    item.cachedThumbPath && !uncachedItemIds.has(item.id)
                      ? window.api.video.fileUrl(item.cachedThumbPath)
                      : item.thumbnail
                  return (
                    <div
                      key={item.id}
                      className="group relative aspect-square bg-bg-hover rounded-md overflow-hidden"
                    >
                      <img
                        src={src}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setUncachedItemIds((prev) => {
                            if (prev.has(item.id)) return prev
                            const next = new Set(prev)
                            next.add(item.id)
                            return next
                          })
                        }
                      />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 flex flex-col items-center justify-center gap-2 p-2 text-center">
                        <span className="text-xs text-ink-base line-clamp-2">{item.title}</span>
                        <button
                          className="btn-primary px-3 py-1 text-xs"
                          onClick={() => sendToCanvas(src, item.title)}
                        >
                          → Canvas
                        </button>
                      </div>
                      <button
                        // T-71: the fill was a raw `rose-500` with the glyph
                        // left at inherited ink — 2.93:1, under AA, on the
                        // only hover state in the app that turns a token into
                        // a background under text. Dark-on-fill is how
                        // `.btn-primary` already answers this against accent;
                        // here it reads 7.20:1.
                        className="absolute top-1 right-1 bg-bg-base/80 hover:bg-danger-strong hover:text-bg-base text-xs rounded-full w-6 h-6 flex items-center justify-center"
                        onClick={() => removeFromCollection(collection.id, item.id)}
                        title="Remove"
                        aria-label="Remove item"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-ink-dim mt-2">
              Hover an item and click → Canvas to drop it as a 40%-opacity reference layer. It is a guide only: exports leave it out.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-dim">
            Create a mood board on the left to get started.
          </p>
        )}
      </div>
    </div>
    </>
  )
}
