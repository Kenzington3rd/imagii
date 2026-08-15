import { describe, it, expect } from 'vitest'
import type { TutorialDef } from '../../src/renderer/src/tutorials/types'
import { videoTutorial } from '../../src/renderer/src/tutorials/videoTutorial'
import { audioTutorial } from '../../src/renderer/src/tutorials/audioTutorial'
import { imageTutorial } from '../../src/renderer/src/tutorials/imageTutorial'
import { aiTutorial } from '../../src/renderer/src/tutorials/aiTutorial'
import { ROUTE_ENTRY, collectRouteSources, collectTutorialTargets } from './routeSources'

/**
 * T-16 regression, generalized. Two coachmark steps —
 * `[data-tutorial="video-crop"]` and `[data-tutorial="audio-multitrack"]` —
 * pointed at selectors no component declared, so those steps rendered no
 * cutout and the tour silently highlighted nothing. Nothing failed: a
 * tutorial step is just data, and a missing target is indistinguishable from
 * a deliberate full-screen step.
 *
 * This walks EVERY step of ALL FOUR tutorials, so the next coachmark added
 * without its host attribute fails here rather than in a user's tour. See
 * routeSources.ts for what static reachability does and does not prove.
 */
const TUTORIALS: Array<{ def: TutorialDef; route: string }> = [
  { def: videoTutorial, route: '/video' },
  { def: audioTutorial, route: '/audio' },
  { def: imageTutorial, route: '/image' },
  { def: aiTutorial, route: '/references' }
]

const targetsByRoute = new Map<string, Set<string>>(
  Object.entries(ROUTE_ENTRY).map(([route, entry]) => [
    route,
    collectTutorialTargets(collectRouteSources(entry))
  ])
)

describe('every tutorial step resolves against its own route', () => {
  it('covers all four shipped tutorials', () => {
    expect(TUTORIALS.map((t) => t.def.id).sort()).toEqual(['ai', 'audio', 'image', 'video'])
  })

  for (const { def, route } of TUTORIALS) {
    const declared = targetsByRoute.get(route)

    it(`${def.id}: the route declares coachmark targets at all`, () => {
      expect(declared?.size ?? 0).toBeGreaterThan(0)
    })

    for (const step of def.steps) {
      it(`${def.id}/${step.id}: target resolves on ${route}`, () => {
        if (step.targetSelector === undefined) {
          // A step with no target must be a deliberate full-screen step, not
          // an accidentally dropped selector.
          expect(step.placement, `${def.id}/${step.id} has no target`).toBe('center')
          return
        }
        const match = /^\[data-tutorial="([^"]+)"\]$/.exec(step.targetSelector)
        expect(
          match,
          `${def.id}/${step.id} uses ${step.targetSelector}; only [data-tutorial="…"] selectors ` +
            'are checkable here — extend this test if the convention changes'
        ).not.toBeNull()
        const name = match?.[1] ?? ''
        expect(
          [...(declared ?? [])].includes(name),
          `no component reachable from ${route} declares data-tutorial="${name}"`
        ).toBe(true)
      })
    }
  }
})

describe('the target scan discriminates', () => {
  it('does not find a made-up target on any route', () => {
    // Proof the assertions above can fail: an invented name matches nothing,
    // so a green suite means the real names were actually found.
    for (const declared of targetsByRoute.values()) {
      expect(declared.has('video-does-not-exist')).toBe(false)
    }
  })

  it('does not leak targets across routes', () => {
    // The video tutorial's crop target must come from the video tree, not
    // from an unrelated studio that happens to declare it.
    expect(targetsByRoute.get('/video')?.has('video-crop')).toBe(true)
    expect(targetsByRoute.get('/audio')?.has('video-crop')).toBe(false)
    expect(targetsByRoute.get('/audio')?.has('audio-multitrack')).toBe(true)
    expect(targetsByRoute.get('/image')?.has('audio-multitrack')).toBe(false)
  })
})
