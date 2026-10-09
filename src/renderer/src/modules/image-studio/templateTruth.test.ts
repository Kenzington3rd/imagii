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

const PLACEHOLDER_TEXT = /@yourhandle|Game name|goes here|Drop (face|clip) here/
const GUIDE_NAME = /hole|hint|placeholder|safe area|video well/i

function isGuide(l: CanvasLayer): boolean {
  return GUIDE_NAME.test(l.name)
}

describe('hint layers: guidance that never ships in an export', () => {
  const hinted = ENTRIES.filter((e) => e.doc.layers.some((l) => l.hint === true))

  it('flags layers in more than a handful of entries (the rule is not vacuous)', () => {
    expect(hinted.length).toBeGreaterThan(10)
  })

  it.each(ENTRIES.map((e) => [e.id, e] as const))('%s: every guide and placeholder is a hint, and nothing else is', (_id, e) => {
    for (const l of e.doc.layers) {
      const placeholderText = l.type === 'text' && PLACEHOLDER_TEXT.test(l.text)
      const mustBeHint = isGuide(l) || placeholderText
      expect(l.hint === true, `${e.id} / "${l.name}"${placeholderText ? ` ("${(l as { text: string }).text}")` : ''}`).toBe(mustBeHint)
    }
  })

  it('only shapes and text are hints — a picture is a hint only as a mood-board reference', () => {
    for (const e of ENTRIES) {
      for (const l of e.doc.layers) if (l.hint) expect(['rect', 'text']).toContain(l.type)
    }
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
})
