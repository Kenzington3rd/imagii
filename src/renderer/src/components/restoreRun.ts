import { createRunStore } from '../lib/runStore'

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
