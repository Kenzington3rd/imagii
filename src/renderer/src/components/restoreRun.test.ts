import { describe, it, expect, afterEach } from 'vitest'
import type { CanvasDocument } from '@shared/canvas'
import { useAutosaveOffer, useRestoreRun, withdrawWhenSessionGainsWork } from './restoreRun'
import { useCanvasStore } from '../modules/image-studio/state/canvasStore'

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

/**
 * T-140 (6) - the offer is withdrawn when the session GAINS work while the banner is mounted.
 *
 * `holdsWork` is read once per mount, and a conversion or an extraction that lands while the person is on Home (the importers' runs outlive the route) fills a studio
 * under a banner that mounted over an empty session: Restore then vanished at the press with nothing restored and no word. The banner listens to the stores the
 * work test reads (`subscribeSessionStores`) and withdraws on a session that holds work, except while a RESTORE is applying it (that is the restore's own doing, and the
 * banner has "Restoring…" to say until the closure tells it the snapshot is in). The canvas store is the one that needs no bridge to fill; the video and audio stores
 * are held by `ProjectIO.test.ts` (`subscribeSessionStores` hears all three).
 */
describe('withdrawWhenSessionGainsWork - a banner over an empty session drops its offer when work lands', () => {
  const layer = {
    id: 'l1', type: 'rect', name: 'A layer', visible: true, locked: false, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
    width: 10, height: 10, fill: '#ffffff', stroke: '#000000', strokeWidth: 0, cornerRadius: 0
  } as const
  const withLayers = (n: number): CanvasDocument => ({
    width: 400,
    height: 300,
    background: '#101014',
    layers: Array.from({ length: n }, (_, i) => ({ ...layer, id: `l${i}` }))
  })

  afterEach(() => {
    useCanvasStore.getState().resetDocument()
    if (useRestoreRun.getState().run !== null) useRestoreRun.getState().end()
  })

  it('work that lands afterwards withdraws the offer, once per landing, and every listener hears it', () => {
    const withdrawnBefore = useAutosaveOffer.getState().withdrawn
    let heard = 0
    const offListener = useAutosaveOffer.subscribe(() => (heard += 1))
    const off = withdrawWhenSessionGainsWork()
    expect(heard, 'nothing yet: the session holds nothing').toBe(0)
    useCanvasStore.getState().setDocument(withLayers(1))
    expect(heard).toBe(1)
    expect(useAutosaveOffer.getState().withdrawn).toBe(withdrawnBefore + 1)
    off()
    offListener()
  })

  it('a session that already holds work when the banner starts listening withdraws at once (the gap between the render that read it and the effect)', () => {
    useCanvasStore.getState().setDocument(withLayers(1))
    let heard = 0
    const offListener = useAutosaveOffer.subscribe(() => (heard += 1))
    const off = withdrawWhenSessionGainsWork()
    expect(heard).toBe(1)
    off()
    offListener()
  })

  it('a change that is not work (a canvas with no layers) withdraws nothing', () => {
    let heard = 0
    const offListener = useAutosaveOffer.subscribe(() => (heard += 1))
    const off = withdrawWhenSessionGainsWork()
    useCanvasStore.getState().setDocument(withLayers(0))
    expect(heard).toBe(0)
    off()
    offListener()
  })

  it('stops listening when told to: work that lands after the banner is gone withdraws nothing', () => {
    let heard = 0
    const offListener = useAutosaveOffer.subscribe(() => (heard += 1))
    const off = withdrawWhenSessionGainsWork()
    off()
    useCanvasStore.getState().setDocument(withLayers(1))
    expect(heard).toBe(0)
    offListener()
  })

  it('while a Restore is applying, the work it puts in the stores is not a reason: the banner keeps saying "Restoring…" until the restore says it is applied', () => {
    let heard = 0
    const offListener = useAutosaveOffer.subscribe(() => (heard += 1))
    const off = withdrawWhenSessionGainsWork()
    expect(useRestoreRun.getState().begin({ applied: false })).toBe(true)
    useCanvasStore.getState().setDocument(withLayers(1))
    useCanvasStore.getState().setDocument(withLayers(2))
    expect(heard, 'the restore\'s own landings').toBe(0)
    // The guard is the RUN, not a latch: once the run is over, the next change to a session that holds work is heard.
    useRestoreRun.getState().end()
    useCanvasStore.getState().setDocument(withLayers(3))
    expect(heard).toBe(1)
    off()
    offListener()
  })
})
