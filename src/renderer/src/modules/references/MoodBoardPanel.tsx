import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { useReferencesStore } from './state/referencesStore'
import { useCanvasStore, makeImageLayer } from '../image-studio/state/canvasStore'

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
      const layer = {
        ...makeImageLayer(src, dims.width * scale, dims.height * scale),
        name: title.slice(0, 40),
        opacity: 0.4
      }
      addCanvasLayer(layer)
      toast.success('Added to canvas as overlay')
      navigate('/image')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add to canvas')
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

  async function onCreate(): Promise<void> {
    const name = newName.trim()
    if (!name) return
    await createCollection(name)
    setNewName('')
  }

  async function onRename(): Promise<void> {
    if (!collection) return
    const next = prompt('Rename mood board', collection.name)
    if (!next) return
    await renameCollection(collection.id, next.trim() || collection.name)
  }

  async function onDelete(): Promise<void> {
    if (!collection) return
    const ok = confirm(`Delete "${collection.name}" and all ${collection.items.length} item(s)?`)
    if (!ok) return
    await deleteCollection(collection.id)
    toast.success('Deleted')
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
      <div className="card p-3 flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Boards ({collections.length})
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
            placeholder="New board name…"
            className="flex-1 bg-bg-base rounded px-2 py-1 text-sm"
          />
          <button className="btn-ghost px-3 py-1 text-sm" onClick={onCreate}>
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
      </div>

      <div className="card p-4 flex flex-col gap-3 min-w-0">
        {collection ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold truncate">{collection.name}</h3>
              <div className="flex gap-2 text-sm">
                <button className="btn-ghost px-3 py-1" onClick={onRename}>
                  Rename
                </button>
                <button
                  className="btn-ghost px-3 py-1 text-rose-300 hover:text-rose-200"
                  onClick={onDelete}
                >
                  Delete
                </button>
              </div>
            </div>
            {collection.items.length === 0 ? (
              <p className="text-sm text-ink-dim">
                Empty. Switch to Reference Search and click ★ to add inspiration here.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {collection.items.map((item) => {
                  const src = item.cachedThumbPath
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
                        className="absolute top-1 right-1 bg-bg-base/80 hover:bg-rose-500 text-xs rounded-full w-6 h-6 flex items-center justify-center"
                        onClick={() => removeFromCollection(collection.id, item.id)}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-ink-dim mt-2">
              Hover an item and click → Canvas to drop it as a 40%-opacity reference layer.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-dim">
            Create a mood board on the left to get started.
          </p>
        )}
      </div>
    </div>
  )
}
