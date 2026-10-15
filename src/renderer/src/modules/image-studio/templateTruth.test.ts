import { describe, it, expect } from 'vitest'
import type { CanvasDocument, CanvasLayer } from '@shared/canvas'
import { CANVAS_TEMPLATES } from './templates'
import { ASSET_CATALOG } from '../references/assetCatalog'

/**
 * T-91 — what a template or an asset says about itself is true of its data,
 * and the layers that are only guidance are marked as such.
 *
 * Every card in the Templates dialog and the Asset Library is a sentence about
 * a `CanvasDocument` that sits next to it in the same file, and nothing held
 * the two together: the Twitch "video-player banner" was Twitch's PROFILE
 * banner size, the 4K thumbnail was sold for "crisp shorts" (it is 16:9, a
 * Short is vertical), the square clip card promised a 9:16 well and drew a
 * 13:20 one, and the lower-third said "drop into recordings" of a PNG imagii
 * cannot lay over a video. These are the checks that would have caught each of
 * them, run over EVERY entry rather than the ones the ticket happened to name.
 */

interface Entry {
  id: string
  name: string
  description: string
  doc: CanvasDocument
}

const ENTRIES: Entry[] = [...CANVAS_TEMPLATES, ...ASSET_CATALOG]
const SIZE = /(\d+)×(\d+)/g

function sizesIn(text: string): Array<[number, number]> {
  return [...text.matchAll(SIZE)].map((m) => [Number(m[1]), Number(m[2])])
}

describe('the data set is the one the Templates dialog and Asset Library show', () => {
  it('covers every template and every asset, with unique ids', () => {
    expect(CANVAS_TEMPLATES.length).toBeGreaterThan(10)
    expect(ASSET_CATALOG.length).toBeGreaterThan(8)
    const ids = ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('size claims', () => {
  it.each(ENTRIES.map((e) => [e.id, e] as const))('%s: every W×H it states is its own, or YouTube\'s thumbnail size', (_id, e) => {
    for (const [w, h] of sizesIn(e.description)) {
      const own = w === e.doc.width && h === e.doc.height
      const youtubeThumb = w === 1280 && h === 720 && /YouTube/.test(e.description)
      expect(own || youtubeThumb, `${e.id} says ${w}×${h}; its document is ${e.doc.width}×${e.doc.height}`).toBe(true)
    }
  })

  it.each(ENTRIES.filter((e) => /\d+×\d+/.test(e.description)).map((e) => [e.id, e] as const))(
    '%s: leads with its own size',
    (_id, e) => {
      // The first size a card names is the size of the thing it describes.
      const first = sizesIn(e.description)[0]
      expect(first).toEqual([e.doc.width, e.doc.height])
    }
  )

  it('the Twitch banner is the 1200×480 PROFILE banner, and does not claim to be the offline screen', () => {
    const t = CANVAS_TEMPLATES.find((x) => x.id === 'tw-banner-videoplayer')
    expect([t?.doc.width, t?.doc.height]).toEqual([1200, 480])
    expect(t?.name).toBe('Twitch · Profile banner')
    expect(`${t?.name} ${t?.description}`).not.toMatch(/video-player banner|\(shown when stream is offline\)/i)
    // Twitch's offline / video-player screen is 16:9; 1200×480 is 5:2.
    expect(1200 / 480).not.toBeCloseTo(16 / 9, 1)
    expect(t?.description).toMatch(/channel page/)
  })
})

describe('destination claims', () => {
  it('nothing sells a 16:9 asset for vertical video', () => {
    for (const e of ENTRIES) {
      if (/shorts?\b/i.test(e.description)) {
        expect(e.description, e.id).toMatch(/not for[^.]*shorts/i)
      }
      expect(e.description, e.id).not.toMatch(/\bcrisp\b/i)
    }
  })

  it('the 4K thumbnail is 16:9 and says so', () => {
    const t = CANVAS_TEMPLATES.find((x) => x.id === 'yt-thumb-bold-4k')
    expect((t?.doc.width ?? 0) / (t?.doc.height ?? 1)).toBeCloseTo(16 / 9, 5)
    expect(t?.description).toMatch(/16:9/)
  })

  it('every transparent document is described as a transparent PNG for OBS, not as a video overlay', () => {
    for (const e of ENTRIES.filter((x) => x.doc.background === 'transparent' && x.doc.width >= 1920)) {
      expect(e.description, e.id).toMatch(/transparent/i)
      expect(e.description, e.id).not.toMatch(/drop into recordings|overlay (on|onto) (your )?(video|recordings)/i)
    }
  })

  it('the lower-third points at OBS or an editor and does not imply imagii overlays video', () => {
    const a = ASSET_CATALOG.find((x) => x.id === 'lower-third-clean')
    expect(a?.description).toMatch(/for OBS or your editor/)
    expect(a?.description).toMatch(/does not add it to a video/)
    expect(a?.description).not.toMatch(/drop into recordings/i)
  })
})

describe('ratio claims', () => {
  it('a card that says 9:16 has a 9:16 shape to put the clip in', () => {
    const asset = ASSET_CATALOG.find((x) => x.id === 'social-square-clip')
    expect(asset?.description).toMatch(/9:16/)
    const well = asset?.doc.layers.find((l) => l.name === 'Video well')
    expect(well?.type).toBe('rect')
    if (well?.type === 'rect') {
      expect(well.width / well.height).toBeCloseTo(9 / 16, 3)
      // …inside the card, and centered in it.
      expect(well.x).toBeGreaterThanOrEqual(0)
      expect(well.x + well.width).toBeLessThanOrEqual(asset?.doc.width ?? 0)
      expect(well.y + well.height).toBeLessThanOrEqual(asset?.doc.height ?? 0)
      expect(well.x + well.width / 2).toBe((asset?.doc.width ?? 0) / 2)
    }
  })

  it('every ratio any card states is matched by a rect on it', () => {
    for (const e of ENTRIES) {
      // (A clock like "0:00" is not a ratio: both sides must be non-zero.)
      // A ratio the card says it is NOT ("Not the 16:9 offline screen") is no claim.
      const claimed = e.description.replace(/\bnot (the |a )?\d+:\d+/gi, '')
      for (const m of claimed.matchAll(/\b([1-9]\d*):([1-9]\d*)\b/g)) {
        const target = Number(m[1]) / Number(m[2])
        const docRatio = e.doc.width / e.doc.height
        const hasRect = e.doc.layers.some(
          (l) => l.type === 'rect' && Math.abs(l.width / l.height - target) < 0.002
        )
        // "16:9" may describe the document itself; any other ratio must be a shape.
        expect(hasRect || Math.abs(docRatio - target) < 0.01, `${e.id} says ${m[0]}`).toBe(true)
      }
    }
  })
})

// ── hint layers ──────────────────────────────────────────────────────────

const GUIDE_NAME = /hole|hint|placeholder|safe area|video well/i

function isGuide(l: CanvasLayer): boolean {
  return GUIDE_NAME.test(l.name)
}

/**
 * T-103 — for every template and asset, EXACTLY which text layers are hints and which are the
 * card's own content. There is no blanket rule: the question per layer is "would a user plausibly
 * ship this text verbatim ON PURPOSE?" — no means a hint (a stand-in title, a name, a handle, a game,
 * a schedule line: text they MUST replace for the export to be theirs), yes means content (the
 * words ARE the card's deliverable). A table, so every choice is deliberate and a text layer added
 * to a card — or a new card — fails here until someone decides which side it is on.
 *
 * Hints: the file a person posts never says "YOUR TITLE HERE"; retyping one clears the flag, so what
 * they type always exports. Content: exporting the BRB card gives a BRB screen with its words.
 */
const TEXT_LAYERS: Record<string, { hints: string[]; content: string[] }> = {
  // ── templates ──
  'yt-thumb-bold': { hints: ['Title', 'Face hint'], content: [] },
  // "TUTORIAL" is the card's sample category label, not words anyone ships beside "How to do the thing".
  'yt-thumb-clean': { hints: ['Eyebrow', 'Title', 'Subtitle'], content: [] },
  'tw-overlay-streamer': { hints: ['Facecam hint', 'Handle', 'Now playing'], content: [] },
  'tw-overlay-minimal': { hints: ['Handle corner'], content: [] },
  'tw-banner-videoplayer': { hints: ['Handle', 'Schedule'], content: [] },
  'yt-banner-channel': { hints: ['Safe area hint', 'Channel name'], content: [] },
  'yt-thumb-bold-2k': { hints: ['Title', 'Face hint'], content: [] },
  'yt-thumb-bold-4k': { hints: ['Title', 'Face hint'], content: [] },
  'tw-overlay-streamer-2k': { hints: ['Facecam hint', 'Handle', 'Now playing'], content: [] },
  'tw-overlay-streamer-4k': { hints: ['Facecam hint', 'Handle', 'Now playing'], content: [] },
  'emote-blank-112': { hints: [], content: [] },
  // The emote IS "POG": a text emote that exported blank would be a yellow circle.
  'emote-text': { hints: [], content: ['Text'] },
  // ── assets ──
  'frame-clean-corner': { hints: ['Handle'], content: [] },
  'frame-just-chatting': { hints: ['Chat hint'], content: [] },
  'lower-third-clean': { hints: ['Name', 'Role'], content: [] },
  // The scene cards: their words are what the scene says. Only the handle is the person's own.
  'scene-brb': { hints: ['Handle'], content: ['Brb', 'Sub'] },
  'scene-starting-soon': { hints: ['Countdown'], content: ['Title', 'Sub'] },
  'scene-ending': { hints: ['SocialsText'], content: ['Thanks', 'Sub'] },
  'frame-clean-corner-2k': { hints: ['Handle'], content: [] },
  'frame-clean-corner-4k': { hints: ['Handle'], content: [] },
  'social-square-clip': { hints: ['Title', 'Hint'], content: [] }
}

/** Words that only a stand-in carries — a content layer must never read like one. */
const PLACEHOLDER_WORDS = /@yourhandle|@handle|Game name|goes here|Drop (face|clip) here|YOUR (TITLE|CHANNEL|NAME)|\bHERE\b|Your (Name|role)/i

function textLayers(e: Entry): Extract<CanvasLayer, { type: 'text' }>[] {
  return e.doc.layers.filter((l): l is Extract<CanvasLayer, { type: 'text' }> => l.type === 'text')
}

describe('hint layers: guidance and sample words that never ship in an export', () => {
  const hinted = ENTRIES.filter((e) => e.doc.layers.some((l) => l.hint === true))

  it('flags layers in more than a handful of entries (the rule is not vacuous)', () => {
    expect(hinted.length).toBeGreaterThan(10)
  })

  it('the table names every template and asset, and nothing else', () => {
    expect(Object.keys(TEXT_LAYERS).sort()).toEqual(ENTRIES.map((e) => e.id).sort())
  })

  it.each(ENTRIES.map((e) => [e.id, e] as const))(
    '%s: its text layers are exactly the table\'s, hints are hints and content exports',
    (id, e) => {
      const row = TEXT_LAYERS[id]
      expect(row, `${id} has a row in TEXT_LAYERS — decide which side each of its text layers is on`).toBeDefined()
      if (!row) return
      // A text layer added to (or removed from) a card fails here until the table says what it is.
      expect(textLayers(e).map((l) => l.name).sort(), `${id}: the card's text layers`).toEqual(
        [...row.hints, ...row.content].sort()
      )
      for (const l of textLayers(e)) {
        const mustBeHint = row.hints.includes(l.name)
        expect(
          l.hint === true,
          `${id} / "${l.name}" ("${l.text}") must ${mustBeHint ? 'be a hint' : 'export as the card\'s own content'}`
        ).toBe(mustBeHint)
      }
      // Everything else on the card: a guide is a hint, a plate/bar/border/shape is not.
      for (const l of e.doc.layers.filter((x) => x.type !== 'text')) {
        expect(l.hint === true, `${id} / "${l.name}"`).toBe(isGuide(l))
      }
    }
  )

  it('the rule has text to bite on: dozens of text layers across the cards, hints and content both', () => {
    const texts = ENTRIES.flatMap((e) => textLayers(e))
    expect(texts.length).toBeGreaterThan(30)
    expect(texts.filter((l) => l.hint === true).length).toBeGreaterThan(20)
    expect(texts.filter((l) => l.hint !== true).length).toBeGreaterThan(5)
  })

  // The inverse of YOUR TITLE HERE (T-103): the scene cards and the text emote export their words.
  it('text that IS the deliverable exports: the scene cards and the text emote are not left wordless', () => {
    const word = (id: string, name: string) =>
      textLayers(ENTRIES.find((e) => e.id === id) as Entry).find((l) => l.name === name)
    for (const [id, name, text] of [
      ['scene-brb', 'Brb', 'BE RIGHT BACK'],
      ['scene-starting-soon', 'Title', 'STARTING SOON'],
      ['scene-ending', 'Thanks', 'THANKS FOR HANGING OUT'],
      ['emote-text', 'Text', 'POG']
    ] as const) {
      const l = word(id, name)
      expect(l?.text, `${id} / ${name}`).toBe(text)
      expect(l?.hint, `${id} / ${name} exports`).not.toBe(true)
    }
  })

  it('no content layer reads like a stand-in, and no hint reads like the card\'s own words', () => {
    for (const e of ENTRIES) {
      const row = TEXT_LAYERS[e.id]
      for (const l of textLayers(e)) {
        if (row?.content.includes(l.name)) {
          expect(PLACEHOLDER_WORDS.test(l.text), `${e.id} / "${l.name}" ("${l.text}") is exported as content`).toBe(false)
        }
      }
    }
  })

  it('only shapes and text are hints — a picture is a hint only as a mood-board reference', () => {
    for (const e of ENTRIES) {
      for (const l of e.doc.layers) if (l.hint) expect(['rect', 'text']).toContain(l.type)
    }
  })

  // T-112. The card says what is NOT in the file; for a sample WORD that is the thing a
  // streamer asks ("will 'YOUR TITLE HERE' be on my thumbnail?"). Five descriptions named
  // the guide and said nothing of the sample text — the canvas shows it (dimmed, since T-112)
  // and the description is where a person reads what it does. A template whose sample text
  // is a hint says so in a sentence that names it a sample or a placeholder.
  it('a template with sample words says the sample words do not export', () => {
    const withSampleText = CANVAS_TEMPLATES.filter((t) =>
      textLayers(t).some((l) => l.hint === true)
    )
    expect(withSampleText.length).toBeGreaterThanOrEqual(8)
    for (const t of withSampleText) {
      expect(t.description, `${t.id} names its sample text`).toMatch(
        /(?:sample|placeholder)[^.]*do(?:es)? not export/i
      )
    }
  })

  // T-113. The same question, asked of the Asset Library: the six cards the review named were
  // templates; the assets carry the same sample words ("@yourhandle", "Your Name", "CLIP TITLE
  // HERE", "0:00") and their descriptions said nothing of it (one said "a title bar"; the
  // starting-soon card said "a static 0:00 countdown to replace" and never that it does not
  // export). A card whose text hint is a SAMPLE says so in a sentence that names it one.
  it('an asset with sample words says the sample words do not export — the rule is the templates\'', () => {
    const withSampleText = ASSET_CATALOG.filter((a) => textLayers(a).some((l) => l.hint === true))
    // Nine assets carry a text hint today: the four overlay frames (the clean corner at 1080p, 1440p and
    // 4K, and the just-chatting frame), the lower-third, the three scene cards and the square clip card.
    expect(withSampleText.length).toBeGreaterThanOrEqual(9)
    for (const a of withSampleText) {
      expect(a.description, `${a.id} names its sample text`).toMatch(
        /(?:sample|placeholder)[^.]*do(?:es)? not export/i
      )
    }
  })

  it('and says what typing does to it, for the sample words that are the person\'s own to fill in', () => {
    // Not for a guide label ("CHAT"): nothing a person types over a label is their deliverable.
    for (const a of ASSET_CATALOG) {
      const own = textLayers(a).filter((l) => l.hint === true && !isGuide(l))
      if (own.length > 0) {
        expect(a.description, `${a.id} says what typing does`).toMatch(/\btype\b/i)
      }
    }
  })

  // T-114. The square clip card said "The well, its label and the sample title do not export until you
  // type your own title" - which made the well and its label sound like they come back when you type.
  // They are guides, not retyped; only the sample title is something a person retypes. The card
  // says the two things apart, in the channel banner's pattern ("The sample handle and schedule do not
  // export until you type your own."). T-115: "never export" became "do not export" - a hint's TEXT
  // exports once it is retyped (the label is a text layer), so "never" was a promise the layer's own
  // rule breaks; "do not" is the verb the other twenty cards use.
  it('the square clip card says the well and its label do not export, and only the sample title is retyped', () => {
    const card = ASSET_CATALOG.find((x) => x.id === 'social-square-clip')?.description ?? ''
    expect(card).toMatch(/The well and its label do not export\./)
    expect(card).not.toMatch(/\bnever\b/i)
    expect(card).toMatch(/The sample title does not export until you type your own\./)
    // The sentence that blurred them is gone: no "until you type" after the well or its label.
    expect(card).not.toMatch(/well[^.]*until you type/i)
    expect(card).not.toMatch(/label and the sample title/i)
    // It stays true: the well, its label and the title are all hints (left out of every export).
    const hint = (name: string): boolean | undefined => ASSET_CATALOG.find((x) => x.id === 'social-square-clip')?.doc.layers.find((l) => l.name === name)?.hint
    expect(hint('Video well')).toBe(true)
    expect(hint('Hint')).toBe(true)
    expect(hint('Title')).toBe(true)
  })

  it('the cards the second pass named each say it in their own words', () => {
    const says: Record<string, RegExp> = {
      'lower-third-clean': /sample name and role/i,
      'social-square-clip': /sample title/i,
      'scene-brb': /sample handle/i,
      'scene-starting-soon': /sample "0:00"/i,
      'scene-ending': /sample socials line/i,
      'frame-clean-corner': /sample handle/i,
      'frame-clean-corner-2k': /sample handle/i,
      'frame-clean-corner-4k': /sample handle/i,
      'frame-just-chatting': /sample "CHAT" label/i
    }
    for (const [id, pattern] of Object.entries(says)) {
      expect(ASSET_CATALOG.find((x) => x.id === id)?.description, id).toMatch(pattern)
    }
  })

  it('the five cards the review named each say it in their own words', () => {
    const says: Record<string, RegExp> = {
      'yt-thumb-bold': /sample title/i,
      'yt-thumb-clean': /sample words/i,
      'tw-overlay-minimal': /sample handle/i,
      'tw-banner-videoplayer': /sample handle and schedule/i,
      'yt-banner-channel': /sample channel name/i
    }
    for (const [id, pattern] of Object.entries(says)) {
      const t = CANVAS_TEMPLATES.find((x) => x.id === id)
      expect(t?.description, id).toMatch(pattern)
      // ...and what happens to it: the words a person types over a sample DO export.
      expect(t?.description, `${id} says what typing does`).toMatch(/\btype\b/i)
    }
  })

  it('the Twitch profile banner does not point at an offline screen no card provides', () => {
    const t = CANVAS_TEMPLATES.find((x) => x.id === 'tw-banner-videoplayer')
    expect(t?.description).not.toMatch(/offline/i)
    // It points at cards that exist: the scene cards of the Asset Library.
    expect(t?.description).toMatch(/scene cards in the Asset Library/)
    expect(ASSET_CATALOG.some((a) => a.category === 'scene-card')).toBe(true)
  })

  it('a card with a guide layer says the guide does not export', () => {
    for (const e of ENTRIES) {
      if (e.doc.layers.some((l) => l.hint === true && isGuide(l))) {
        expect(e.description, e.id).toMatch(/do(es)? not export/)
      }
    }
  })

  it('the design stays: a facecam FRAME (a border the streamer keeps) is not a hint', () => {
    const minimal = CANVAS_TEMPLATES.find((t) => t.id === 'tw-overlay-minimal')
    const frame = minimal?.doc.layers.find((l) => l.name === 'Facecam border')
    expect(frame).toBeDefined()
    expect(frame?.hint).toBeUndefined()
    const lower = CANVAS_TEMPLATES.find((t) => t.id === 'tw-overlay-streamer')?.doc.layers.find(
      (l) => l.name === 'Lower third'
    )
    expect(lower?.hint).toBeUndefined()
  })

  it('every non-text design element keeps exporting: plates, bars, borders and shapes are never hints (T-103)', () => {
    const design = ENTRIES.flatMap((e) =>
      e.doc.layers.filter((l) => l.type !== 'text' && !isGuide(l)).map((l) => [e.id, l] as const)
    )
    expect(design.length).toBeGreaterThan(20)
    for (const [id, l] of design) expect(l.hint === true, `${id} / "${l.name}"`).toBe(false)
  })
})
