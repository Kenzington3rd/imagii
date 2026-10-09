import { describe, it, expect } from 'vitest'
import path from 'node:path'
import type { TutorialDef } from '../../src/renderer/src/tutorials/types'
import { videoTutorial } from '../../src/renderer/src/tutorials/videoTutorial'
import { audioTutorial } from '../../src/renderer/src/tutorials/audioTutorial'
import { imageTutorial } from '../../src/renderer/src/tutorials/imageTutorial'
import { aiTutorial } from '../../src/renderer/src/tutorials/aiTutorial'
import { ROUTE_ENTRY, collectRouteSources, readAll } from './routeSources'

/**
 * T-86 — a tutorial describes the app that ships.
 *
 * The tours had drifted into a different product: a "pink line" where the
 * playhead is amber, an "Open Auto-Highlights" control nothing renders,
 * captions burned "into the export" (they make a separate file), "Duck under
 * voice" for a checkbox that says "Duck under primary", a watermark claim
 * that was false for four of the five places a video leaves the app, and a
 * 14-format list summarized as "pretty much anything". Nothing could fail,
 * because a step is just a string.
 *
 * Three rules, each one a way the copy lied:
 *   1. Every control a step names, in 'single quotes', exists in the source of
 *      the studio the step is shown in.
 *   2. None of the words that were wrong, or were jargon, comes back.
 *   3. A step stays two short sentences and carries no number of its own (the
 *      coachmark counts; a step skipped because its target is off the page
 *      would leave a hole in a baked-in "Step 4:").
 *
 * Rule 1 reads source text, so it carries the T-16 lesson: the tutorial files
 * are reachable from every studio and contain the very names under test, so
 * they are EXCLUDED from the text searched — otherwise each name proves
 * itself. The discrimination block at the bottom shows the check fails on a
 * name that is not there.
 */

const TUTORIALS: Array<{ def: TutorialDef; route: string }> = [
  { def: videoTutorial, route: '/video' },
  { def: audioTutorial, route: '/audio' },
  { def: imageTutorial, route: '/image' },
  { def: aiTutorial, route: '/references' }
]

/** The searchable text of a route: every reachable renderer file EXCEPT the tutorial definitions. */
function routeText(route: string): string {
  const entry = ROUTE_ENTRY[route]
  if (entry === undefined) throw new Error(`no entry for ${route}`)
  const files = collectRouteSources(entry).filter(
    (f) => !f.includes(`${path.sep}tutorials${path.sep}`)
  )
  return readAll(files)
}

/**
 * The names a body puts in 'single quotes'. An apostrophe inside a word is
 * not a quote: an opening one is not preceded by a letter or digit, and a
 * closing one is not followed by one.
 */
export function quotedNames(body: string): string[] {
  const out: string[] = []
  const re = /(?<![A-Za-z0-9])'([^']+)'(?![A-Za-z0-9])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== undefined) out.push(m[1])
  }
  return out
}

describe('every control a step names is on the screen it is shown on', () => {
  for (const { def, route } of TUTORIALS) {
    const text = routeText(route)
    for (const step of def.steps) {
      for (const name of quotedNames(step.body)) {
        it(`${def.id}/${step.id}: '${name}' is a real label on ${route}`, () => {
          expect(
            text.includes(name),
            `${def.id}/${step.id} tells the user to use '${name}', which no component reachable from ${route} renders`
          ).toBe(true)
        })
      }
    }
  }

  it('the tours really do name controls (the extraction is not vacuously empty)', () => {
    const all = TUTORIALS.flatMap(({ def }) => def.steps.flatMap((s) => quotedNames(s.body)))
    expect(all.length).toBeGreaterThan(25)
    // Spot-checks on names that were renamed by this ticket.
    expect(all).toContain('Duck under primary')
    expect(all).toContain('Help me fix this')
    expect(all).toContain('Scan VOD')
  })
})

describe('the words that were wrong, or were jargon, stay out of the tours', () => {
  const BANNED: Array<[RegExp, string]> = [
    [/\bNew:/, '"New:" tags on features that shipped long ago'],
    [/\bStep \d+/i, 'a baked-in step number (the coachmark counts)'],
    [/LUFS/i, 'LUFS is jargon — say loudness'],
    [/whisper/i, 'whisper.cpp is the engine, not something a streamer picks'],
    [/ffmpeg/i, 'FFmpeg is plumbing'],
    [/\bchain\b/i, 'the audio "chain" is an implementation word'],
    [/\bpink\b/i, 'the playhead is amber'],
    [/Image Canvas/i, 'the studio is Stream Graphics'],
    [/Auto-Highlights?/i, 'there is no such control: it is "Smart highlight finder"'],
    [/Quick fix wizard/i, 'the control is "Help me fix this"'],
    [/Duck under voice/i, 'the checkbox is "Duck under primary"'],
    [/pretty much anything/i, 'the importer lists the formats it takes'],
    [/follows? the action/i, 'Reframe cuts a fixed strip; it tracks nothing'],
    [/\btwo tabs?\b/i, 'References has three tabs'],
    [/on every export/i, 'the watermark is not on every export (GIF, reframe, compile, PiP take none)'],
    [/into the export/i, 'burned captions are a separate file, not part of the export'],
    [/multi-?track/i, 'the panel adds ONE second track']
  ]

  for (const { def } of TUTORIALS) {
    const text = [def.title, def.intro, ...def.steps.flatMap((s) => [s.title, s.body])].join('\n')
    for (const [pattern, why] of BANNED) {
      it(`${def.id}: nothing matches ${pattern} (${why})`, () => {
        expect(text).not.toMatch(pattern)
      })
    }
  }
})

describe('the shape of a step', () => {
  /**
   * Sentences: a . ! or ? followed by space and then a capital, digit or quote.
   * The ? button's name ("The ? button") and a '.' inside '.srt' are not boundaries.
   */
  function sentences(body: string): string[] {
    return body.split(/(?<=[.!?])\s+(?=[A-Z0-9'"])/).filter((s) => s.trim().length > 0)
  }

  for (const { def } of TUTORIALS) {
    it(`${def.id}: ids and titles are unique, so a gated tour can be addressed by either`, () => {
      expect(new Set(def.steps.map((s) => s.id)).size).toBe(def.steps.length)
      expect(new Set(def.steps.map((s) => s.title)).size).toBe(def.steps.length)
    })

    for (const step of def.steps) {
      it(`${def.id}/${step.id}: at most two sentences, and it ends like a sentence`, () => {
        expect(sentences(step.body).length, step.body).toBeLessThanOrEqual(2)
        expect(step.body.trim()).toMatch(/[.!?]$/)
        expect(step.title.trim().length).toBeGreaterThan(0)
      })
    }

    it(`${def.id}: opens and closes on a centered card, with a pointed-at step between`, () => {
      expect(def.steps[0]?.placement).toBe('center')
      expect(def.steps[0]?.targetSelector).toBeUndefined()
      const last = def.steps[def.steps.length - 1]
      expect(last?.placement).toBe('center')
      expect(last?.targetSelector).toBeUndefined()
      // Without one, the gate in useTutorial could never open this tour.
      expect(def.steps.some((s) => s.targetSelector !== undefined)).toBe(true)
    })
  }

  it('the three studios with an importer keep its step at index 1 (the E2E clamp test drives step 2)', () => {
    for (const def of [videoTutorial, audioTutorial, imageTutorial]) {
      expect(def.steps[1]?.id).toBe('import')
    }
  })
})

describe('the control-name check discriminates', () => {
  it('finds a quoted name and ignores an apostrophe inside a word', () => {
    expect(quotedNames("Click 'Duck under voice' — it isn't there, and neither is Bob's.")).toEqual([
      'Duck under voice'
    ])
    expect(quotedNames('Tick \'Crop\' then \'+ Clip\'.')).toEqual(['Crop', '+ Clip'])
    expect(quotedNames('no names here')).toEqual([])
  })

  it('a made-up name is NOT found in the studio source (so a green run is a real find)', () => {
    expect(routeText('/audio').includes('Duck under voice')).toBe(false)
    expect(routeText('/audio').includes('Duck under primary')).toBe(true)
    // The tutorial files themselves are not searched: they hold every name.
    expect(routeText('/video').includes('Open Auto-Highlights')).toBe(false)
  })

  it('does not leak across studios: the video tour\'s names are not on the audio route', () => {
    expect(routeText('/audio').includes('Scan VOD')).toBe(false)
    expect(routeText('/video').includes('Scan VOD')).toBe(true)
  })
})
