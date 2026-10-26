import { useEffect, useRef } from 'react'
import type { ImagiiProject } from '@shared/workspace'
import { projectSizeProblem, serializeProject } from '@shared/projectValidation'
import { reportFailure } from '../lib/reportFailure'
import { useVideoStore } from '../modules/video-studio/store/videoStore'
import { useAudioStore } from '../modules/audio-studio/state/audioStore'
import { useCanvasStore } from '../modules/image-studio/state/canvasStore'
import { applyProject, captureProject, type ApplyOutcome } from '../modules/project/ProjectIO'

const AUTOSAVE_DEBOUNCE_MS = 5000
const AUTOSAVE_MIN_INTERVAL_MS = 5000
/** A pending change is written no later than this long after it was first scheduled, however many changes keep re-arming the debounce (T-136 (3)). */
export const AUTOSAVE_MAX_WAIT_MS = 30_000

/** The toast id of "autosave is paused" (T-137 (6)): one card, whatever raises it. */
export const AUTOSAVE_TOO_LARGE_TOAST_ID = 'autosave-too-large'

/**
 * The stamp a capture is compared under (T-137 (7)): a fixed 13-digit number, the length of a real `Date.now()` until the year 2286, so the compared text is
 * exactly as long as the text main measures and writes.
 */
const UNSTAMPED = 1_000_000_000_000

/**
 * The fields of the video store that are the PLAYHEAD, not the work (T-136 (3)): the position the Player writes on every `timeupdate` (about four
 * times a second while a video plays), the Player's registered transport (a new object on every mount), and a seek request (set together with the
 * position by every click on the timeline, and emptied by the Player). A change to nothing but these is not an edit, and re-arming the debounce on
 * each one meant autosave never fired while a video played: clips marked during a long review were not on disk until the playback stopped for 5 s.
 * The playhead is saved with the next real change and by the quit flush.
 */
export const VIDEO_PLAYHEAD_KEYS: readonly string[] = ['currentTime', 'transport', 'seekRequest']
/** Audio Studio's playhead: the waveform writes the position on every `audioprocess`. */
export const AUDIO_PLAYHEAD_KEYS: readonly string[] = ['currentTime']

/** True when `state` differs from `prev` in nothing but `playheadKeys` (a change that touched no field at all is "only the playhead" too: nothing to save). */
export function playheadOnlyChange(state: object, prev: object, playheadKeys: readonly string[]): boolean {
  const now = state as Record<string, unknown>
  const before = prev as Record<string, unknown>
  return Object.keys(now).every((key) => playheadKeys.includes(key) || Object.is(now[key], before[key]))
}

/**
 * A debounce with a ceiling (T-136 (3)). `schedule()` (re)starts the quiet period, so a burst of changes is one write after the burst; but the first
 * change of a burst also starts a clock, and the write is never later than `maxWaitMs` after it however long the burst goes on. The debounce alone
 * was starvable by ANY field that changes faster than its period - the playhead was the one that did (see `VIDEO_PLAYHEAD_KEYS`), and the next
 * high-frequency field would be too. `cancel()` drops what is pending. Ceiling: a write the caller defers by re-arming (the min-interval rule)
 * starts a fresh window, so such a write can be a debounce later than `maxWaitMs`.
 */
export interface SaveScheduler {
  schedule: () => void
  cancel: () => void
}

export function createSaveScheduler(run: () => void, debounceMs = AUTOSAVE_DEBOUNCE_MS, maxWaitMs = AUTOSAVE_MAX_WAIT_MS): SaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  // When the pending burst's first change was scheduled; null when nothing is pending.
  let firstAt: number | null = null
  return {
    schedule() {
      const now = Date.now()
      if (firstAt === null) firstAt = now
      if (timer !== null) clearTimeout(timer)
      const wait = Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - now))
      timer = setTimeout(() => {
        timer = null
        firstAt = null
        run()
      }, wait)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      firstAt = null
    }
  }
}

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

/** What autosave remembers across an enable and a disable: when it last wrote, and what (the hook keeps it in a ref). */
export interface AutosaveMemory {
  lastWriteTime: number
  /** The content last written: the project with its stamp neutralised (T-137 (7)). */
  lastHash: string
  /** True while the person has been told the project is over the size limit and it still is (T-137 (6)): one toast per episode, not one per attempt. */
  toldTooLarge?: boolean
}

/**
 * Subscribes to all three studio stores. When any store changes (other than
 * by its playhead alone, T-136 (3)), schedules a debounced autosave. Each save
 * is gated by:
 *   - content dedupe (skip if the captured project, its `savedAt` stamp set
 *     aside, is the one last written: a store change that is not in the project
 *     - a grid toggle, a scan's results - writes nothing, T-137 (7))
 *   - the size rule (T-137 (6)): a project over the limit is not sent, and the
 *     person is told once that autosave is paused
 *   - main-process safety guards (size cap, schema validation, "no studio" check)
 *   - debounce (5 s, and never more than 30 s after the first change of a
 *     burst) and minimum interval between writes (5 s)
 *   - global hold (active while a project is being applied; see `applyProjectHeld`)
 *
 * Failures are silent — they're surfaced to the console but never thrown.
 *
 * This is the hook's whole effect as a plain function (T-136 (3)), returning the unsubscribe: the schedule and the playhead rule are
 * behavior that needs a clock and the real stores, and the vitest environment has no DOM to mount a hook in.
 */
export function startAutosave(memory: AutosaveMemory): () => void {
  const scheduler = createSaveScheduler(() => {
    void doSave()
  })

  function scheduleSave(): void {
    if (autosaveSuppressed()) {
      noteSuppressedChange()
      return
    }
    scheduler.schedule()
  }

  async function doSave(): Promise<void> {
    if (autosaveSuppressed()) {
      // The hold began after this write was scheduled; the release saves it.
      noteSuppressedChange()
      return
    }
    const now = Date.now()
    if (now - memory.lastWriteTime < AUTOSAVE_MIN_INTERVAL_MS) {
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
      // T-137 (7): the key is the project's CONTENT. `savedAt` is `Date.now()` at the capture, so two captures of the same work never matched and
      // any store change that is not in the project (Find chat spikes, Scan VOD, a grid toggle) re-wrote an identical autosave.json and rotated
      // autosave.prev (executed: 28.4 MiB for a ticked Grid). It is the same text the size rule below measures, and that main writes.
      serialized = serializeProject({ ...project, savedAt: UNSTAMPED })
    } catch (err) {
      console.warn('[autosave] serialize failed', err)
      return
    }
    if (serialized === memory.lastHash) return
    // T-137 (6): over the size limit, the project is not sent (a 50 MiB structured clone every few seconds to be refused) and the person is told, once.
    // The refusal used to be a console line, so autosave stopped for good with nothing on screen. It starts again by itself when the project fits.
    const tooLarge = projectSizeProblem(serialized.length, 'autosave')
    if (tooLarge !== null) {
      if (!memory.toldTooLarge) {
        memory.toldTooLarge = true
        reportFailure(tooLarge, { failed: 'Autosave is paused.', id: AUTOSAVE_TOO_LARGE_TOAST_ID })
      }
      return
    }
    memory.toldTooLarge = false
    try {
      const result = await window.api.autosave.write(project)
      if (result.ok) {
        memory.lastHash = serialized
        memory.lastWriteTime = now
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

  // T-136 (3): a change to nothing but the playhead is not an edit (the Player writes it ~4 times a second while a video plays).
  const unsubVideo = useVideoStore.subscribe((state, prev) => {
    if (!playheadOnlyChange(state, prev, VIDEO_PLAYHEAD_KEYS)) scheduleSave()
  })
  const unsubAudio = useAudioStore.subscribe((state, prev) => {
    if (!playheadOnlyChange(state, prev, AUDIO_PLAYHEAD_KEYS)) scheduleSave()
  })
  const unsubCanvas = useCanvasStore.subscribe(scheduleSave)
  // T-113: a hold with changes in it ends with a save, not with silence until the next edit.
  const offResume = onAutosaveResume(scheduleSave)

  return () => {
    offResume()
    unsubVideo()
    unsubAudio()
    unsubCanvas()
    scheduler.cancel()
  }
}

export function useAutosave(options: AutosaveOptions = {}): void {
  const enabled = options.enabled ?? true
  const memory = useRef<AutosaveMemory>({ lastWriteTime: 0, lastHash: '' })

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
    return startAutosave(memory.current)
  }, [enabled])
}
