import { useSyncExternalStore } from 'react'
import { useVideoStore } from '../modules/video-studio/store/videoStore'
import { useAudioStore } from '../modules/audio-studio/state/audioStore'
import { useCanvasStore } from '../modules/image-studio/state/canvasStore'

type StoreId = 'video' | 'audio' | 'image'

const STORE_LABEL: Record<StoreId, string> = {
  video: 'Video Studio',
  audio: 'Audio Studio',
  image: 'Image Canvas'
}

/** The undo-relevant slice all three studio stores share. */
interface HistoryPair {
  past: unknown[]
  future: unknown[]
}

interface StudioActions {
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

function stateOf(id: StoreId): StudioActions {
  if (id === 'image') return useCanvasStore.getState()
  if (id === 'audio') return useAudioStore.getState()
  return useVideoStore.getState()
}

/**
 * The cross-studio order of undoable steps (newest last) and of the steps
 * that have been undone and can be redone (newest last).
 *
 * T-32, finding B: these are MODULE-level on purpose. Home is unmounted for
 * the whole time the user is editing, so a tracker living in Home's own
 * `useState`, with subscriptions created and torn down by its effect, can
 * only ever see changes made while Home is on screen — everything a studio
 * does is invisible to it, which is the one thing a global undo exists for.
 * The subscriptions below are registered once, at import, and never removed;
 * the stores are module-level too, so their lifetime is the app's.
 *
 * Each studio still owns its own undo stack. This is only the ORDER between
 * them, so Home's Undo reverts the last change wherever it happened: edit
 * video, then the canvas, and the first Undo hits the canvas, the second
 * hits video.
 *
 * Invariant, maintained by `reconcile`: the number of entries a store has in
 * `undoOrder` equals its own `history.past.length`, and in `redoOrder` its
 * `history.future.length`. That is what bounds both arrays (each store caps
 * its history at 50 steps) and what keeps enablement honest.
 */
const undoOrder: StoreId[] = []
const redoOrder: StoreId[] = []

let version = 0
const listeners = new Set<() => void>()

function bump(): void {
  version += 1
  for (const listener of listeners) listener()
}

function dropNewest(order: StoreId[], id: StoreId): void {
  const at = order.lastIndexOf(id)
  if (at >= 0) order.splice(at, 1)
}

/** Bring `order` in line with how many steps that store really holds. */
function reconcile(order: StoreId[], id: StoreId, want: number): void {
  let have = 0
  for (const entry of order) if (entry === id) have += 1
  while (have > want) {
    dropNewest(order, id)
    have -= 1
  }
  while (have < want) {
    order.push(id)
    have += 1
  }
}

/**
 * A store that has hit its own 50-step cap records a new step WITHOUT
 * growing `past` — the push and the trim cancel out — so only the identity
 * of the newest snapshot gives it away. Undo and redo change that snapshot
 * too, but they also change the length, so they never reach this test.
 */
function isCappedPush(next: unknown[], prev: unknown[]): boolean {
  return (
    next.length === prev.length &&
    next.length > 0 &&
    next[next.length - 1] !== prev[prev.length - 1]
  )
}

/**
 * Fold one store event into the cross-studio order.
 *
 * Counting rather than classifying is what replaces the old `undoingRef`
 * suppression flag. That flag only knew about undos raised by this hook — a
 * Ctrl+Z inside a studio was recorded as a fresh change — and suppressing the
 * event also suppressed the re-render that would have refreshed the buttons
 * (finding C). Two `history` stacks whose lengths are matched here cover
 * every path into a history, whoever called it: a new change (past grows,
 * future clears), an undo (past -> future), a redo (future -> past), and a
 * reset such as loadSource or resetDocument (both empty, so every entry for
 * that studio goes).
 */
function record(id: StoreId, next: HistoryPair, prev: HistoryPair): void {
  // Zustand's partial set() keeps the reference of every key it does not
  // touch, and all three stores build a fresh history object whenever they
  // do touch it — so identity is an exact "was this a history event" test.
  // It also filters video's coalesced gestures, which write no history at
  // all while a trim drag is in flight.
  if (next === prev) return

  if (isCappedPush(next.past, prev.past)) {
    // Same count, newer step: move this studio to the front of the queue.
    dropNewest(undoOrder, id)
    undoOrder.push(id)
  } else {
    reconcile(undoOrder, id, next.past.length)
  }
  reconcile(redoOrder, id, next.future.length)
  bump()
}

function tracker(
  id: StoreId
): (next: { history: HistoryPair }, prev: { history: HistoryPair }) => void {
  return (next, prev) => record(id, next.history, prev.history)
}

useVideoStore.subscribe(tracker('video'))
useAudioStore.subscribe(tracker('audio'))
useCanvasStore.subscribe(tracker('image'))

/**
 * The newest entry its store can still act on. Enablement and the click both
 * read this, so a lit button always has something to do.
 */
function newestActionable(
  order: StoreId[],
  can: (state: StudioActions) => boolean
): StoreId | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    if (id && can(stateOf(id))) return id
  }
  return null
}

export function globalUndo(): void {
  const id = newestActionable(undoOrder, (s) => s.canUndo())
  if (!id) return
  // No bookkeeping here: the store's own event lands back in record() and
  // moves the entry across to redoOrder, so one code path keeps the order
  // true — the same one a studio's own Ctrl+Z goes through.
  stateOf(id).undo()
}

export function globalRedo(): void {
  const id = newestActionable(redoOrder, (s) => s.canRedo())
  if (!id) return
  stateOf(id).redo()
}

export interface GlobalUndoState {
  canUndo: boolean
  canRedo: boolean
  /** Names the studio whose change the next Undo would revert. */
  lastLabel: string
}

export function globalUndoState(): GlobalUndoState {
  const undoTarget = newestActionable(undoOrder, (s) => s.canUndo())
  const redoTarget = newestActionable(redoOrder, (s) => s.canRedo())
  return {
    canUndo: undoTarget !== null,
    canRedo: redoTarget !== null,
    lastLabel: undoTarget ? STORE_LABEL[undoTarget] : 'no recent change'
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getVersion(): number {
  return version
}

interface UseGlobalUndoResult extends GlobalUndoState {
  undo: () => void
  redo: () => void
}

/**
 * Home's global Undo/Redo. Delegates to whichever studio store holds the
 * newest step; each studio still owns its own history.
 */
export function useGlobalUndo(): UseGlobalUndoResult {
  // Every history event bumps the version, so enablement is re-derived after
  // an undo or a redo lands — including the one this hook just triggered.
  // The pre-T-32 hook read canUndo/canRedo off getState() during render and
  // swallowed its own store event, so nothing re-rendered Home after a click
  // and Redo could never light up (finding C).
  useSyncExternalStore(subscribe, getVersion)
  return { ...globalUndoState(), undo: globalUndo, redo: globalRedo }
}
