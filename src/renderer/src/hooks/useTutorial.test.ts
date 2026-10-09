import { describe, it, expect } from 'vitest'
import { gateTutorial, pointsAtSomething, resolvableSteps } from './useTutorial'
import type { TutorialDef, TutorialStep } from '../tutorials/types'
import { videoTutorial } from '../tutorials/videoTutorial'
import { aiTutorial } from '../tutorials/aiTutorial'

/**
 * T-86. A first-visit tour opened over an empty studio and pointed at trim
 * handles that did not exist. The rule that replaced it is two pure
 * functions: keep a step only when its target is on the page, and open an
 * AUTOMATIC tour only when at least one of the steps left is pointed at
 * something. The DOM half ("on the page") is injected, so it is driven here
 * against a fake page; the real one is tests/e2e/home-chrome.spec.ts.
 */

const step = (id: string, selector?: string): TutorialStep => ({
  id,
  title: id,
  body: id,
  targetSelector: selector,
  placement: selector ? 'top' : 'center'
})

const DEF: TutorialDef = {
  id: 'video',
  title: 'Test Studio',
  intro: '',
  steps: [
    step('welcome'),
    step('import', '[data-tutorial="a"]'),
    step('player', '[data-tutorial="b"]'),
    step('done')
  ]
}

const page = (...present: string[]) => (selector: string) => present.includes(selector)

describe('resolvableSteps', () => {
  it('keeps the centered steps and drops the targeted ones that are not on the page', () => {
    const ids = resolvableSteps(DEF.steps, page('[data-tutorial="a"]')).map((s) => s.id)
    expect(ids).toEqual(['welcome', 'import', 'done'])
  })

  it('keeps every step when every target is there, in the original order', () => {
    const all = page('[data-tutorial="a"]', '[data-tutorial="b"]')
    expect(resolvableSteps(DEF.steps, all).map((s) => s.id)).toEqual([
      'welcome',
      'import',
      'player',
      'done'
    ])
  })

  it('an empty page leaves only the framing', () => {
    expect(resolvableSteps(DEF.steps, page()).map((s) => s.id)).toEqual(['welcome', 'done'])
  })

  it('asks about each selector it was given, once, and never invents one', () => {
    const asked: string[] = []
    resolvableSteps(DEF.steps, (selector) => {
      asked.push(selector)
      return true
    })
    expect(asked).toEqual(['[data-tutorial="a"]', '[data-tutorial="b"]'])
  })

  it('does not mutate the definition', () => {
    const before = DEF.steps.map((s) => s.id)
    resolvableSteps(DEF.steps, page())
    expect(DEF.steps.map((s) => s.id)).toEqual(before)
  })
})

describe('pointsAtSomething — what lets an automatic tour open', () => {
  it('framing alone is a coachmark over nothing', () => {
    expect(pointsAtSomething(resolvableSteps(DEF.steps, page()))).toBe(false)
    expect(pointsAtSomething([])).toBe(false)
  })

  it('one pointed-at step is enough', () => {
    expect(pointsAtSomething(resolvableSteps(DEF.steps, page('[data-tutorial="b"]')))).toBe(true)
  })
})

describe('gateTutorial', () => {
  it('returns the same tour with only the steps that resolve, so the counter counts what can be walked', () => {
    const gated = gateTutorial(DEF, page('[data-tutorial="b"]'))
    expect(gated.id).toBe(DEF.id)
    expect(gated.title).toBe(DEF.title)
    expect(gated.steps.map((s) => s.id)).toEqual(['welcome', 'player', 'done'])
    expect(gated.steps).toHaveLength(3)
    // The original is untouched: the next visit gates against a new page.
    expect(DEF.steps).toHaveLength(4)
  })
})

describe('the real tours, against a page that has only each tour\'s importer', () => {
  it('the empty-studio tour is the welcome, the importer, and the sign-off — and cannot open by itself without the import', () => {
    const emptyVideo = page('[data-tutorial="video-import"]')
    const gated = gateTutorial(videoTutorial, emptyVideo)
    expect(gated.steps.map((s) => s.id)).toEqual(['welcome', 'import', 'done'])
    // It DOES point at something (the importer), which is why the first-visit
    // tour is held by the studio's `ready` flag rather than by this predicate
    // alone — see useTutorial.
    expect(pointsAtSomething(gated.steps)).toBe(true)
  })

  it('once a video is loaded the importer is gone, and its step goes with it', () => {
    const loaded = page(
      ...videoTutorial.steps
        .map((s) => s.targetSelector)
        .filter((s): s is string => s !== undefined && !s.includes('video-import'))
    )
    const ids = resolvableSteps(videoTutorial.steps, loaded).map((s) => s.id)
    expect(ids).not.toContain('import')
    expect(ids).toHaveLength(videoTutorial.steps.length - 1)
  })

  it('References has a pointed-at step from the first frame', () => {
    const gated = gateTutorial(aiTutorial, page('[data-tutorial="ai-tabs"]'))
    expect(pointsAtSomething(gated.steps)).toBe(true)
    expect(gated.steps.length).toBe(aiTutorial.steps.length)
  })

  it('a page with none of a tour\'s targets leaves a tour that must not open on its own', () => {
    expect(pointsAtSomething(gateTutorial(videoTutorial, page()).steps)).toBe(false)
  })
})
