import { describe, it, expect } from 'vitest'
import { CRASH_RELOAD_COOLDOWN_MS, rendererGoneAction } from './rendererRecovery'

/**
 * T-123 (15): what main does when the window's renderer process goes away. Before this nothing
 * listened, so a crashed renderer (out of memory on a huge file, a GPU-process fault) left a
 * live-looking window that painted nothing and answered nothing. `reload()` recovers it to Home,
 * which is where the autosave banner lives. The E2E crashes a real renderer; this is the decision.
 */
describe('rendererGoneAction (T-123 (15))', () => {
  const NOW = 1_000_000

  it.each(['crashed', 'oom', 'launch-failed', 'integrity-failure', 'abnormal-exit', 'killed'])(
    'reloads the window after a %s',
    (reason) => {
      expect(rendererGoneAction(reason, NOW, null, false)).toBe('reload')
    }
  )

  it('leaves a clean exit alone: that is a renderer finishing, not dying', () => {
    expect(rendererGoneAction('clean-exit', NOW, null, false)).toBe('ignore')
  })

  it('leaves everything alone while the app is leaving (a quit kills the renderer on purpose)', () => {
    expect(rendererGoneAction('killed', NOW, null, true)).toBe('ignore')
    expect(rendererGoneAction('crashed', NOW, null, true)).toBe('ignore')
  })

  it('does not reload a second time inside the cooldown: a renderer that dies on load would loop forever', () => {
    expect(rendererGoneAction('crashed', NOW, NOW - 1000, false)).toBe('leave')
    expect(rendererGoneAction('crashed', NOW, NOW - (CRASH_RELOAD_COOLDOWN_MS - 1), false)).toBe('leave')
  })

  it('reloads again once the cooldown has passed (a crash an hour later is a new crash)', () => {
    expect(rendererGoneAction('crashed', NOW, NOW - CRASH_RELOAD_COOLDOWN_MS, false)).toBe('reload')
    expect(rendererGoneAction('crashed', NOW, NOW - 3_600_000, false)).toBe('reload')
  })

  it('a clean exit inside the cooldown is still just ignored, not "leave"', () => {
    expect(rendererGoneAction('clean-exit', NOW, NOW - 1000, false)).toBe('ignore')
  })
})
