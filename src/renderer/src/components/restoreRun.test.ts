import { describe, it, expect } from 'vitest'
import { useAutosaveOffer, useRestoreRun } from './restoreRun'

/**
 * T-139 (5) - the autosave offer is withdrawn when the person opens a project from Home.
 *
 * The banner mounts over an empty session and reads "does the session hold work" once; Open project applies a project and stays on Home, so the banner went on
 * offering Restore over what had just been opened. Home raises `withdraw()` after the apply and every mounted banner (a `subscribe` listener, as for the restore
 * run's `applied`) drops its offer. The banner is a component and this unit runs in node: what is held here is the signal itself.
 */
describe('useAutosaveOffer - the withdrawal every mounted banner hears', () => {
  it('a listener hears each withdrawal, one call per withdrawal', () => {
    let heard = 0
    const off = useAutosaveOffer.subscribe(() => {
      heard += 1
    })
    useAutosaveOffer.getState().withdraw()
    expect(heard).toBe(1)
    useAutosaveOffer.getState().withdraw()
    expect(heard, 'a second open says it again').toBe(2)
    off()
  })

  it('several banners hear one withdrawal, and one that was unmounted (its listener removed) hears nothing', () => {
    const heard = { a: 0, b: 0, gone: 0 }
    const offA = useAutosaveOffer.subscribe(() => (heard.a += 1))
    const offB = useAutosaveOffer.subscribe(() => (heard.b += 1))
    const offGone = useAutosaveOffer.subscribe(() => (heard.gone += 1))
    offGone()
    useAutosaveOffer.getState().withdraw()
    expect(heard).toEqual({ a: 1, b: 1, gone: 0 })
    offA()
    offB()
  })

  it('the count only goes up, so a banner that mounts later can tell a withdrawal happened without hearing it', () => {
    const before = useAutosaveOffer.getState().withdrawn
    useAutosaveOffer.getState().withdraw()
    expect(useAutosaveOffer.getState().withdrawn).toBe(before + 1)
  })

  it('is its own signal: it does not touch the restore run, and a run in flight does not stop it', () => {
    expect(useRestoreRun.getState().begin({ applied: false })).toBe(true)
    let heard = 0
    const off = useAutosaveOffer.subscribe(() => (heard += 1))
    useAutosaveOffer.getState().withdraw()
    expect(heard).toBe(1)
    expect(useRestoreRun.getState().run, 'the run is untouched').toEqual({ applied: false })
    off()
    useRestoreRun.getState().end()
  })
})
