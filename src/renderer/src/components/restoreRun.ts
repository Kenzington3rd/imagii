import { create } from 'zustand'
import { createRunStore } from '../lib/runStore'
import { sessionHoldsWork, subscribeSessionStores } from '../modules/project/ProjectIO'

/**
 * The autosave Restore (T-138 (5)): the apply of the snapshot the person chose, from the press until it is over (a sound or a converted video is made again,
 * and that is minutes for a long recording).
 *
 * It was `AutosaveRestore`'s `useState`, and the banner mounts again on every visit to Home. A person who left Home during a long Restore (USER_GUIDE says they
 * may) came back to a NEW banner whose Restore was enabled - `holdsWork` is read once per mount and is false while the restored sound is still being extracted -
 * and a second press re-applied the project, took down the first restore's progress toast (they share toast ids), could start a second extraction and said a
 * false "Skipped the autosave's audio". The run is a module store (the `createRunStore` pattern of T-135 / T-136 / T-137): `restore()` claims it with `begin()`
 * before its first await and gives it back in a `finally`, a banner that mounts over it says "Restoring…" with its buttons off, and a second press while it is
 * held changes nothing.
 *
 * `applied` is the closure telling every mounted banner that the snapshot is in: the banner that started the restore may be gone by then (the person went
 * elsewhere), and the one that replaced it has to drop its offer when the restore is over. It is raised only when the apply finished - one that threw leaves the
 * run ending with `applied` false, and the banner and its Restore stay, as they always have, so the person can try again.
 */
export const useRestoreRun = createRunStore<{ applied: boolean }>()

/**
 * The autosave offer is withdrawn (T-139 (5)): the person opened a project of their own, from Home, so the banner's "pick up where you left off" is about a session
 * that is not theirs any more.
 *
 * `AutosaveRestore` reads `sessionHoldsWork()` once per mount (T-124 (5)) and Open project applies the project and STAYS on Home, so the same banner went on offering
 * Restore, and pressing it applied the snapshot over the project that had just been opened (executed). Home raises this after the open has applied, and every
 * mounted banner drops its offer, as it does for `applied`. A counter in a store and not a flag, so a second open says it again and a listener hears every one; it
 * is a listener's business (`subscribe`), not a selector's.
 */
export const useAutosaveOffer = create<{ withdrawn: number; withdraw: () => void }>((set) => ({
  withdrawn: 0,
  withdraw: () => set((s) => ({ withdrawn: s.withdrawn + 1 }))
}))

/**
 * The offer is withdrawn when the session GAINS work while a banner is mounted (T-140 (6)): `AutosaveRestore` reads `sessionHoldsWork()` once per mount, and a conversion
 * or an extraction that lands while the person is on Home (the importers' runs are module stores and outlive the route) fills a studio under a banner that mounted over an
 * empty session. Restore then did nothing at the press and said nothing. The banner listens to the stores the work test reads and withdraws, on the signal above, the
 * moment the session holds work - and at once if it already does (a landing between the render that read it and the effect that listens).
 *
 * Not while a RESTORE is running: the work it puts in the stores is its own, the banner has "Restoring…" to say until the closure reports the snapshot applied, and a
 * banner that vanished when the video landed would hide a sound that is still being extracted (T-138 (5)). The guard is the run and not a latch, so a change after the
 * run is over is heard. Returns the way to stop listening.
 */
export function withdrawWhenSessionGainsWork(): () => void {
  const check = (): void => {
    if (useRestoreRun.getState().run !== null) return
    if (sessionHoldsWork()) useAutosaveOffer.getState().withdraw()
  }
  check()
  return subscribeSessionStores(check)
}
