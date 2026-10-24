import { create, type StoreApi, type UseBoundStore } from 'zustand'

/**
 * One long job a panel runs, held where a screen change cannot reach it (T-135 (1)).
 *
 * A panel's busy flag and its job's handle (the id its Cancel is aimed at, the percent its bar draws) were `useState` / `useRef`, so a route
 * change unmounted them: the panel came back idle with its primary button enabled, over a job main was still running, with no Cancel anywhere
 * (and a retry hit main's "An export is already running"). The run is a module store - the videoStore pattern - so the screen that comes back
 * draws what is true. The job's own closure keeps running after its panel unmounts (it holds no component state any more: it writes here), and
 * a remounted panel re-attaches by reading `run`.
 *
 * `run` is null when nothing is running, and the job's fields while it does. `begin` is the claim: a second job in the same slot is refused.
 * The component-level claim-first ref (`startingRef`) still covers the moments BEFORE a run begins (a chooser is open); this covers the run.
 */
export interface RunStore<T extends object> {
  run: T | null
  /** Claim the slot with the run's first state. False, and nothing changes, if a run is already there. */
  begin: (run: T) => boolean
  /** Update the running job's fields. A no-op once it ended, so a late event (progress arrives after the final line) revives nothing. */
  patch: (patch: Partial<T>) => void
  /** Give the slot back. Harmless when idle. */
  end: () => void
}

export function createRunStore<T extends object>(): UseBoundStore<StoreApi<RunStore<T>>> {
  return create<RunStore<T>>((set, get) => ({
    run: null,
    begin: (run) => {
      if (get().run !== null) return false
      set({ run })
      return true
    },
    patch: (patch) => {
      const current = get().run
      if (current !== null) set({ run: { ...current, ...patch } })
    },
    end: () => {
      if (get().run !== null) set({ run: null })
    }
  }))
}
