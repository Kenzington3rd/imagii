import { describe, it, expect } from 'vitest'
import { SUBJECTS, TITLE_PATTERNS, VERBS, article, fillTitle } from './PostChecklist'

/**
 * T-87 — "Title starters" wrote broken English.
 *
 * The old generator appended letters to a past-tense verb ("clutched" + "d"
 * -> "clutchedd"; "reacted to" + "ing" -> "reacted toing"), put an article
 * in front of a subject it had not chosen ("a achievement"), and dropped a
 * bare noun into a sentence that needs one. The fix is structural: each
 * pattern names the verb FORM it needs, the verb comes from a table, and the
 * article is built from the subject. This file generates the whole
 * cross-product, so a pattern, verb or subject added later is checked on the
 * day it lands.
 */

// Every {n} is a day of the year. One value covers the template's shape.
const DAY = 41

function everyTitle(): string[] {
  const out: string[] = []
  for (const pattern of TITLE_PATTERNS) {
    for (const verb of VERBS) {
      for (const subject of SUBJECTS) out.push(fillTitle(pattern, verb, subject, DAY))
    }
  }
  return out
}

const titles = everyTitle()

describe('Title starters — the cross-product', () => {
  it('covers every pattern x verb x subject', () => {
    expect(titles).toHaveLength(TITLE_PATTERNS.length * VERBS.length * SUBJECTS.length)
  })

  it('no doubled suffix ("clutchedd", "beatd")', () => {
    expect(titles.filter((t) => /dd /.test(t))).toEqual([])
  })

  it('no gerund built by appending to a past form ("reacted toing")', () => {
    expect(titles.filter((t) => /toing/.test(t))).toEqual([])
  })

  it('no doubled article ("a a")', () => {
    expect(titles.filter((t) => /\ba a\b/.test(t))).toEqual([])
  })

  it('no "a achievement" or "an achievement" — the subject that broke the article is gone', () => {
    expect(titles.filter((t) => /\ban? achievement/i.test(t))).toEqual([])
  })

  it('every "a" is followed by a consonant and every "an" by a vowel', () => {
    expect(titles.filter((t) => /\ba [aeiou]/i.test(t))).toEqual([])
    expect(titles.filter((t) => /\ban [^aeiou]/i.test(t))).toEqual([])
  })

  it('no double spaces', () => {
    expect(titles.filter((t) => / {2}/.test(t))).toEqual([])
  })

  it('no placeholder survives', () => {
    expect(titles.filter((t) => /[{}]/.test(t))).toEqual([])
  })

  it('no exclamation marks in any starter', () => {
    expect(titles.filter((t) => /!/.test(t))).toEqual([])
  })

  it('no pattern names a game — the game comes from the user or is omitted', () => {
    expect(TITLE_PATTERNS.filter((p) => /game/i.test(p))).toEqual([])
  })

  it('no letter is glued onto a verb slot — each verb form is a whole table value', () => {
    // "{base}d" or "{gerund}s" would type a form the table never holds; the
    // output checks above cannot see it ("clutchd" has no doubled letter).
    expect(
      TITLE_PATTERNS.filter((p) => /\w\{(base|past|gerund)\}|\{(base|past|gerund)\}\w/.test(p))
    ).toEqual([])
  })
})

describe('article()', () => {
  it.each([
    ['boss fight', 'a'],
    ['speedrun', 'a'],
    ['PvP match', 'a'],
    ['glitch', 'a'],
    ['achievement', 'an'],
    ['Achievement', 'an'],
    ['outage', 'an'],
    ['Umbrella', 'an']
  ])('article(%j) is %j', (word, expected) => {
    expect(article(word)).toBe(expected)
  })
})

describe('fillTitle() substitutes table values only', () => {
  it('uses the form each pattern names', () => {
    const reactTo = VERBS.find((v) => v.base === 'react to')
    expect(reactTo).toBeDefined()
    if (!reactTo) return
    expect(fillTitle('Day {n} of {gerund} {a_subject}', reactTo, 'glitch', DAY)).toBe(
      'Day 41 of reacting to a glitch'
    )
    expect(fillTitle('I {past} {a_subject} so you don\'t have to', reactTo, 'glitch', DAY)).toBe(
      'I reacted to a glitch so you don\'t have to'
    )
    expect(fillTitle('When you {base} {a_subject}...', reactTo, 'glitch', DAY)).toBe(
      'When you react to a glitch...'
    )
  })
})
