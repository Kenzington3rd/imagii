import { useEffect, useRef } from 'react'
import { useVideoStore } from '../modules/video-studio/store/videoStore'
import { useAudioStore } from '../modules/audio-studio/state/audioStore'
import { useCanvasStore } from '../modules/image-studio/state/canvasStore'
import { captureProject } from '../modules/project/ProjectIO'

const AUTOSAVE_DEBOUNCE_MS = 5000
const AUTOSAVE_MIN_INTERVAL_MS = 5000

interface SuppressHandle {
  current: boolean
}

const suppressRef: SuppressHandle = { current: false }

/**
 * Suspend autosave writes for the lifetime of the returned token. Used during
 * project load/restore so we don't autosave the half-loaded state.
 */
export function suppressAutosave(): () => void {
  suppressRef.current = true
  return () => {
    suppressRef.current = false
  }
}

interface AutosaveOptions {
  enabled?: boolean
}

/**
 * Subscribes to all three studio stores. When any store changes, schedules a
 * debounced autosave. Each save is gated by:
 *   - serialization round-trip (skip if state is identical to last save)
 *   - main-process safety guards (size cap, schema validation, "no studio" check)
 *   - debounce (5 s) and minimum interval between writes (5 s)
 *   - global suppress flag (active during project restore)
 *
 * Failures are silent — they're surfaced to the console but never thrown.
 */
export function useAutosave(options: AutosaveOptions = {}): void {
  const enabled = options.enabled ?? true
  const debounceTimer = useRef<number | null>(null)
  const lastWriteTime = useRef<number>(0)
  const lastHash = useRef<string>('')

  // T-47: the quit flush. Registered independently of `enabled` so a quit
  // from the welcome screen still gets an immediate answer — main is
  // waiting on this reply, and silence costs the user the whole timeout.
  // The empty project it captures there is refused by the autosave guards,
  // which is the correct outcome and a fast one.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.autosave) return
    return window.api.autosave.onQuitFlush(() => {
      // A restore is mid-flight: capturing now would write half an applied
      // project over the good snapshot the user is in the middle of using.
      if (suppressRef.current) return null
      try {
        return captureProject()
      } catch (err) {
        console.warn('[autosave] quit capture failed', err)
        return null
      }
    })
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || !window.api?.autosave) return

    function scheduleSave(): void {
      if (suppressRef.current) return
      if (debounceTimer.current !== null) {
        window.clearTimeout(debounceTimer.current)
      }
      debounceTimer.current = window.setTimeout(() => {
        void doSave()
      }, AUTOSAVE_DEBOUNCE_MS)
    }

    async function doSave(): Promise<void> {
      if (suppressRef.current) return
      const now = Date.now()
      if (now - lastWriteTime.current < AUTOSAVE_MIN_INTERVAL_MS) {
        // Re-arm in case more changes are coming
        scheduleSave()
        return
      }
      let project
      try {
        project = captureProject()
      } catch (err) {
        console.warn('[autosave] capture failed', err)
        return
      }
      let serialized: string
      try {
        serialized = JSON.stringify(project)
      } catch (err) {
        console.warn('[autosave] serialize failed', err)
        return
      }
      if (serialized === lastHash.current) return
      try {
        const result = await window.api.autosave.write(project)
        if (result.ok) {
          lastHash.current = serialized
          lastWriteTime.current = now
        } else {
          // "no studio state" is an expected condition early in the session — don't spam console
          if (!/no studio state/.test(result.reason)) {
            console.warn('[autosave] write rejected:', result.reason)
          }
        }
      } catch (err) {
        console.warn('[autosave] write threw', err)
      }
    }

    const unsubVideo = useVideoStore.subscribe(scheduleSave)
    const unsubAudio = useAudioStore.subscribe(scheduleSave)
    const unsubCanvas = useCanvasStore.subscribe(scheduleSave)

    return () => {
      unsubVideo()
      unsubAudio()
      unsubCanvas()
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
    }
  }, [enabled])
}
