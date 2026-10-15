import { useEffect, useRef } from 'react'
import type { ImagiiProject } from '@shared/workspace'
import { useVideoStore } from '../modules/video-studio/store/videoStore'
import { useAudioStore } from '../modules/audio-studio/state/audioStore'
import { useCanvasStore } from '../modules/image-studio/state/canvasStore'
import { applyProject, captureProject, type ApplyOutcome } from '../modules/project/ProjectIO'

const AUTOSAVE_DEBOUNCE_MS = 5000
const AUTOSAVE_MIN_INTERVAL_MS = 5000

/**
 * How many things are holding autosave off right now (T-113: a count, not a flag, so one
 * hold letting go cannot lift another's), and whether anything changed while they did.
 */
let holds = 0
let changedWhileHeld = false
const resumeHandlers = new Set<() => void>()

/** True while a project is being put back, when the stores hold half of it. */
export function autosaveSuppressed(): boolean {
  return holds > 0
}

/**
 * Suspend autosave writes until the returned release is called. Used while a project is
 * applied so a snapshot is never taken of half of it. Release is idempotent; the last one
 * lets go, and if the stores changed meanwhile it asks the hook to save again — a change
 * made during a hold has no later event of its own to trigger a write.
 */
export function suppressAutosave(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    if (holds === 0 && changedWhileHeld) {
      changedWhileHeld = false
      for (const resume of resumeHandlers) resume()
    }
  }
}

/** A store changed while autosave was held: remember it, so letting go saves it. */
export function noteSuppressedChange(): void {
  changedWhileHeld = true
}

/** The autosave hook's way of being told to save once a hold with changes in it is over. */
export function onAutosaveResume(handler: () => void): () => void {
  resumeHandlers.add(handler)
  return () => {
    resumeHandlers.delete(handler)
  }
}

/**
 * What the quit flush answers main with: the whole session, or null while a project is
 * being applied (a half-applied snapshot written over the one being restored would lose
 * the only copy of the rest) or when capture fails.
 */
export function captureForQuit(): ImagiiProject | null {
  if (autosaveSuppressed()) return null
  try {
    return captureProject()
  } catch (err) {
    console.warn('[autosave] quit capture failed', err)
    return null
  }
}

/**
 * Put a project back with autosave held for exactly the apply (T-113). Open project and the
 * autosave Restore used to hold it from before the file dialog until 1.5 s AFTER the apply, and
 * the apply can wait for minutes (a converted import converts again, a video's sound is extracted
 * again) while the person works in another studio: a quit in that window — or in the 1.5 s after
 * it — saved nothing of what they did. The hold covers the apply and releases the moment it is
 * over, in a `finally`, so a throw cannot leave autosave off either.
 */
export async function applyProjectHeld(project: ImagiiProject): Promise<ApplyOutcome> {
  const release = suppressAutosave()
  try {
    return await applyProject(project)
  } finally {
    release()
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
 *   - global hold (active while a project is being applied; see `applyProjectHeld`)
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
    // A restore is mid-flight: capturing now would write half an applied
    // project over the good snapshot the user is in the middle of using.
    return window.api.autosave.onQuitFlush(captureForQuit)
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || !window.api?.autosave) return

    function scheduleSave(): void {
      if (autosaveSuppressed()) {
        noteSuppressedChange()
        return
      }
      if (debounceTimer.current !== null) {
        window.clearTimeout(debounceTimer.current)
      }
      debounceTimer.current = window.setTimeout(() => {
        void doSave()
      }, AUTOSAVE_DEBOUNCE_MS)
    }

    async function doSave(): Promise<void> {
      if (autosaveSuppressed()) {
        // The hold began after this write was scheduled; the release saves it.
        noteSuppressedChange()
        return
      }
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
    // T-113: a hold with changes in it ends with a save, not with silence until the next edit.
    const offResume = onAutosaveResume(scheduleSave)

    return () => {
      offResume()
      unsubVideo()
      unsubAudio()
      unsubCanvas()
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
    }
  }, [enabled])
}
