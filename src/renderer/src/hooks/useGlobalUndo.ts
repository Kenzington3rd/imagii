import { useEffect, useState, useCallback, useRef } from 'react'
import { useVideoStore } from '../modules/video-studio/store/videoStore'
import { useAudioStore } from '../modules/audio-studio/state/audioStore'
import { useCanvasStore } from '../modules/image-studio/state/canvasStore'

type StoreId = 'video' | 'audio' | 'image'

const STORE_LABEL: Record<StoreId, string> = {
  video: 'Video Studio',
  audio: 'Audio Studio',
  image: 'Image Canvas'
}

interface LastAction {
  store: StoreId
  at: number
}

interface UseGlobalUndoResult {
  canUndo: boolean
  canRedo: boolean
  lastLabel: string
  undo: () => void
  redo: () => void
}

/**
 * Tracks the most-recently-touched studio store and exposes a global undo
 * that delegates to that store's local undo. Each studio still owns its own
 * undo stack — this hook is a thin coordinator. State changes triggered by
 * undo/redo themselves are filtered out so they don't pollute the "last
 * action" tracker.
 */
export function useGlobalUndo(): UseGlobalUndoResult {
  const [last, setLast] = useState<LastAction | null>(null)
  const undoingRef = useRef<boolean>(false)
  const initialDoneRef = useRef<boolean>(false)

  useEffect(() => {
    function handle(store: StoreId): () => void {
      return () => {
        // Suppress events fired by our own undo/redo or by the initial mount.
        if (undoingRef.current) return
        if (!initialDoneRef.current) return
        setLast({ store, at: Date.now() })
      }
    }
    const offV = useVideoStore.subscribe(handle('video'))
    const offA = useAudioStore.subscribe(handle('audio'))
    const offI = useCanvasStore.subscribe(handle('image'))
    // Allow first-render store synchronization to settle before tracking.
    const t = setTimeout(() => {
      initialDoneRef.current = true
    }, 250)
    return () => {
      offV()
      offA()
      offI()
      clearTimeout(t)
    }
  }, [])

  const canUndo = (() => {
    if (!last) return false
    if (last.store === 'image') return useCanvasStore.getState().canUndo()
    if (last.store === 'audio') return useAudioStore.getState().canUndo()
    // Video store has its own multi-faceted state but no global undo;
    // treat the most recent change as undoable only if it was canvas or audio.
    return false
  })()

  const canRedo = (() => {
    if (!last) return false
    if (last.store === 'image') return useCanvasStore.getState().canRedo()
    if (last.store === 'audio') return useAudioStore.getState().canRedo()
    return false
  })()

  const lastLabel = last ? STORE_LABEL[last.store] : 'no recent change'

  const undo = useCallback(() => {
    if (!last) return
    // Bug-fix (audit round 5): Zustand fires subscribers synchronously
    // inside the setState() call from undo()/redo(). The prior 50ms
    // setTimeout left a window where a user mutation arriving between
    // undoingRef=true and the timeout could be misclassified as
    // "from undo" and dropped from the tracker. Use a synchronous
    // try/finally instead — the flag is true only for the exact
    // span of the store call.
    undoingRef.current = true
    try {
      if (last.store === 'image') useCanvasStore.getState().undo()
      else if (last.store === 'audio') useAudioStore.getState().undo()
    } finally {
      undoingRef.current = false
    }
  }, [last])

  const redo = useCallback(() => {
    if (!last) return
    undoingRef.current = true
    try {
      if (last.store === 'image') useCanvasStore.getState().redo()
      else if (last.store === 'audio') useAudioStore.getState().redo()
    } finally {
      undoingRef.current = false
    }
  }, [last])

  return { canUndo, canRedo, lastLabel, undo, redo }
}
