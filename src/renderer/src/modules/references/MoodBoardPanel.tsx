import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { countOf } from '@shared/plural'
import { MAX_BOARD_NAME } from '@shared/search'
import { useReferencesStore } from './state/referencesStore'
import { useCanvasStore, makeReferenceLayer } from '../image-studio/state/canvasStore'
import { currentRoute } from '../project/ProjectIO'
import { NameDialog } from '../../components/NameDialog'
import { claimFirst } from '../../lib/claimFirst'
import { createRunStore } from '../../lib/runStore'
import { ignoreHeldEnter, isRepeatPress } from '../../lib/repeatPress'
import { PanelHeader } from '../../components/PanelHeader'
import { boundedDataUrl, loadImage } from '../../lib/boundedImage'
import { reportFailure } from '../../lib/reportFailure'
import { ACTION_TOAST_MS } from '../../lib/savedToast'
import { LAYER_DRAWN_MAX_DIM, placementFor } from '@shared/imageBounds'

/**
 * T-155 (1): how long "→ Canvas" waits for a picture. A tile whose cached thumbnail is gone falls back to the address it came from, and a host that accepts
 * and never answers would hold the one send claim for ever (the 10 s is the thumbnail fetch's own figure). The sentence is the finished one `reportFailure` shows as written.
 */
const SEND_LOAD_DEADLINE_MS = 10_000
const SEND_LOAD_FAILED = "That picture didn't load. Try again, or save it to the board again."

/** `loadImage`, given up on after `SEND_LOAD_DEADLINE_MS`; the timer is cleared the moment the load settles. */
function loadWithinDeadline(src: string): Promise<HTMLImageElement> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(SEND_LOAD_FAILED)), SEND_LOAD_DEADLINE_MS)
  })
  // T-156 (5): a picture that fails at once (offline, a 404, a host with no CORS header, a data URL that will not decode) says what a stalled one says: `loadImage`'s bare
  // "Decode failed" is not shown by `userFacingError`, so it read "Couldn't add that image to the canvas." with nothing to do next.
  const load = loadImage(src, 'anonymous').catch(() => {
    throw new Error(SEND_LOAD_FAILED)
  })
  return Promise.race([load, deadline]).finally(() => clearTimeout(timer))
}

/**
 * T-156 (4): the send in flight, at module scope (the T-135 / T-136 pattern). The claim and the busy flag were a `useRef` and a `useState` of the panel, and the studio
 * renders its tabs conditionally, so Mood Boards -> Asset Library -> Mood Boards remounted the panel with the claim given back while the first send was still out
 * (up to the deadline): a second press sent again and every "→ Canvas" had lost its busy state. `begin` is the claim, ahead of the first await; `end` is in a finally.
 */
const useSendRun = createRunStore<{ title: string }>()

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

  // T-154 (1): and one send at a time. The picture's load below is an await (a network fetch for a tile that fell back to its source URL), so a second
  // press during it - a double-click's, or a Tab-Enter - found nothing done yet and added the reference again; T-153's route-change swallow cannot reach a
  // press that lands BEFORE the route changes. Claimed ahead of the first await and given back in a finally; the button also drops the double-click's repeat.
  // T-155 (1): and the same fact, for the screen: while a send is out every "→ Canvas" says so, and a press says why nothing happened instead of returning in silence.
  // T-156 (4): both are `useSendRun` above, which a tab change cannot reach.
  const sending = useSendRun((s) => s.run !== null)
  // T-154 (2): and one removal at a time, for the same reason: the grid reflows when the first tile goes and the next tile's ✕ sits under the pointer.
  const removingRef = useRef(false)

  async function sendToCanvas(src: string, title: string): Promise<void> {
    if (!useSendRun.getState().begin({ title })) return
    try {
      await sendToCanvasNow(src, title)
    } finally {
      useSendRun.getState().end()
    }
  }

  async function sendToCanvasNow(src: string, title: string): Promise<void> {
    try {
      const img = await loadWithinDeadline(src)
      // T-139 (2): placed wholly on the canvas that is open when the picture lands (a small one - the 112 px emote - shrinks it to fit), like an imported file.
      const { width: docWidth, height: docHeight } = useCanvasStore.getState().doc
      const place = placementFor(img.naturalWidth, img.naturalHeight, docWidth, docHeight)
      // T-137 (10): the layer carries the picture itself (a copy drawn at the size the layer is drawn, a few tens of KB), not the address of the tile it
      // came from. `src` is the cached thumbnail's file, which Clear thumbnail cache and the launch sweep after a board item is deleted remove (the tile
      // then falls back to its source URL, but a layer has no fallback): the layer drew nothing, with no marker, and saved projects carried the dead address.
      // JPEG when the thumbnail is opaque (a photo), PNG when it is not, so a logo keeps its transparency.
      addCanvasLayer(makeReferenceLayer(boundedDataUrl(img, LAYER_DRAWN_MAX_DIM, true), place.width, place.height, title, place.x, place.y))
      // T-125 (19): "it won't be in your export" is the fact the person needs before they build on it, and the studio changes
      // under the toast as it appears (`navigate`), so it is held as long as an action toast.
      toast.success("Added to canvas as a reference — it won't be in your export", { duration: ACTION_TOAST_MS })
      // T-135 (13): the picture's load above is a wait (a network fetch when the tile fell back to the URL it came from), and `navigate` still works
      // from a screen that was left. The person is taken to the canvas only if they are still on References; the layer is added and the toast says so
      // either way (the T-134 (1) rule, which this site's "the person is on References" premise had been blessed under).
      if (currentRoute() === '/references') navigate('/image')
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

  // T-135 (8): the board writes are IPC calls main can refuse (a name past the cap, a full disk, a locked folder), and none of the three had a catch: the
  // press looked as if it had worked. Each reports in a sentence (`reportFailure`) and leaves what the person typed where it was.
  const renamingRef = useRef(false)

  // T-144: and one create at a time. The name was cleared only AFTER the awaited write, so the second press of a double-click (or a second Enter) found the same name still in the box
  // and made a second board of it, and a held Enter made one per repeat. Claimed before the first await and given back in a finally, as the first-save create in
  // ReferencePanel is (T-135 (8)); a press while the create is out is the same create.
  const creatingRef = useRef(false)

  async function onCreate(): Promise<void> {
    await claimFirst(creatingRef, async () => {
      const name = newName.trim()
      if (!name) return
      try {
        await createCollection(name)
      } catch (err) {
        reportFailure(err, { failed: "Couldn't create that board." })
        return
      }
      setNewName('')
    })
  }

  async function onRename(next: string): Promise<void> {
    // The dialog stays up until the rename has landed (a refusal keeps the name that was typed for the retry), so a second press while it is out
    // is the same rename: claimed first, given back in a finally.
    await claimFirst(renamingRef, async () => {
      if (!collection) {
        setRenaming(false)
        return
      }
      try {
        // Through the store, which is what makes a rename undoable like every
        // other board edit (T-58's history subscribes here, not to the IPC).
        await renameCollection(collection.id, next)
      } catch (err) {
        reportFailure(err, { failed: "Couldn't rename that board." })
        return
      }
      setRenaming(false)
    })
  }

  // T-161 (8): "and all 0 items" / "and all 1 item" read wrong - an empty board has nothing to name, one item is "the 1 item in it".
  function deleteQuestion(name: string, count: number): string {
    const what = count === 0 ? '' : count === 1 ? ' and the 1 item in it' : ` and all ${countOf(count, 'item')}`
    return `Delete "${name}"${what}? Ctrl+Z brings it back.`
  }

  async function onDelete(): Promise<void> {
    if (!collection) return
    const ok = confirm(deleteQuestion(collection.name, collection.items.length))
    if (!ok) return
    try {
      await deleteCollection(collection.id)
    } catch (err) {
      reportFailure(err, { failed: "Couldn't delete that board." })
      return
    }
    // T-66: reversible since T-58, and the toast is the only place the user is
    // looking when it happens. The header's Undo button says the same thing,
    // but a board that just vanished is exactly when nobody is reading a
    // toolbar. T-141 (9): and it carries the one fact that brings the board back, so it lasts as long as an action toast
    // (BRANDING_GUIDE: react-hot-toast's 2 s default is gone before a person who looked away reads it).
    toast.success('Deleted — press Ctrl+Z to undo', { duration: ACTION_TOAST_MS })
  }

  // T-136 (12): the two writes beside them that had no catch. A refused clear used to be an unhandled rejection with a button that did nothing, and the
  // success toast sits after the await so it is never said over a refusal; a refused remove leaves the tile where it is (the store changes only after
  // main has answered) and says so.
  async function onClearThumbs(): Promise<void> {
    try {
      await window.api.moodboard.clearThumbs()
      // T-191 (3): the clear deleted every cached file, and a tile already drawn never fires `onError` for a file it decoded before; "→ Canvas" then loaded the deleted
      // file. Every item of every board uses the address it came from at once (a refused clear throws above and marks nothing).
      setUncachedItemIds(new Set(useReferencesStore.getState().collections.flatMap((c) => c.items.map((i) => i.id))))
      toast.success('Thumbnail cache cleared')
    } catch (err) {
      reportFailure(err, { failed: "Couldn't clear the thumbnail cache." })
    }
  }

  async function onRemoveItem(itemId: string): Promise<void> {
    if (!collection) return
    await claimFirst(removingRef, async () => {
      try {
        await removeFromCollection(collection.id, itemId)
      } catch (err) {
        reportFailure(err, { failed: "Couldn't remove that picture." })
      }
    })
  }

  return (
    <>
    <NameDialog
      open={renaming && collection !== null}
      title="Rename mood board"
      label="Board name"
      initialValue={collection?.name ?? ''}
      confirmLabel="Rename"
      maxLength={MAX_BOARD_NAME}
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
            // A held Enter is one press (T-144): its auto-repeats are not a decision to make more boards.
            onKeyDown={(e) => e.key === 'Enter' && !e.repeat && onCreate()}
            placeholder="New board name…"
            maxLength={MAX_BOARD_NAME}
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
              // T-114: a clickable <li> with a border for a state, like the layer rows: the select control
              // is a real button now (the whole row), and the state is `aria-current` (on the button as
              // well - that is where keyboard focus lands). Named with its count, which is otherwise a
              // bare number.
              <li
                key={c.id}
                aria-current={isSelected ? 'true' : undefined}
                className={`rounded text-sm ${
                  isSelected
                    ? 'bg-accent/15 border border-accent'
                    : 'hover:bg-bg-hover border border-transparent'
                }`}
              >
                <button
                  onClick={() => selectCollection(c.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  aria-label={`${c.name}, ${countOf(c.items.length, 'item')}`}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="truncate flex-1" title={c.name}>{c.name}</span>
                  <span className="text-xs text-ink-dim ml-2">{c.items.length}</span>
                </button>
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
          onClick={() => void onClearThumbs()}
          title="Clear the on-disk thumbnail cache for mood boards"
        >
          Clear thumbnail cache
        </button>
      </div>

      <div className="card p-4 flex flex-col gap-3 min-w-0">
        {collection ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold truncate" title={collection.name}>{collection.name}</h3>
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
                      {/* T-115/T-116: shown on keyboard focus as well as hover (see ReferencePanel). */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 has-[:focus-visible]:opacity-100 transition-opacity bg-black/60 flex flex-col items-center justify-center gap-2 p-2 text-center">
                        <span className="text-xs text-ink-base line-clamp-2" title={item.title}>{item.title}</span>
                        <button
                          className="btn-primary px-3 py-1 text-xs aria-disabled:opacity-50"
                          // T-155 (1): `aria-disabled`, not `disabled`, so a keyboard press keeps its focus (T-140 (8)); the press says why it did nothing.
                          aria-disabled={sending || undefined}
                          title={sending ? 'Adding the last picture…' : undefined}
                          onKeyDown={ignoreHeldEnter}
                          onClick={(e) => {
                            // T-154 (1): the second press of a double-click is the first one's decision, not a new one.
                            if (isRepeatPress(e)) return
                            if (sending) {
                              toast('Still adding the last picture', { id: 'tocanvas-busy' })
                              return
                            }
                            void sendToCanvas(src, item.title)
                          }}
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
                        onClick={(e) => {
                          // T-154 (2): the grid reflows under the pointer when the tile goes; the second press would remove its neighbour.
                          if (isRepeatPress(e)) return
                          void onRemoveItem(item.id)
                        }}
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
