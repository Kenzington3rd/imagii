import { describe, it, expect } from 'vitest'
import { clipForExport, clipRecipe, clipSpeed, type Clip } from './clip'

/**
 * T-105 — the two helpers that make "what a clip IS" one thing in every place
 * that exports it.
 */
describe('clipSpeed — the one reading of a clip\'s speed', () => {
  it('a speed that is set is itself', () => {
    for (const speedMultiplier of [0.25, 0.5, 1, 1.5, 2, 4, 10]) {
      expect(clipSpeed({ speedMultiplier })).toBe(speedMultiplier)
    }
  })

  it('a missing speed is 1x', () => {
    expect(clipSpeed({})).toBe(1)
    expect(clipSpeed({ speedMultiplier: undefined })).toBe(1)
  })

  it('zero, a negative speed and a non-finite one are 1x — the encoder cannot divide by them', () => {
    for (const speedMultiplier of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clipSpeed({ speedMultiplier }), String(speedMultiplier)).toBe(1)
    }
  })

  it('a speed that is not a number (a hand-edited project) is 1x, not "2" divided into anything', () => {
    for (const bad of ['2', null, {}, [], true]) {
      expect(clipSpeed({ speedMultiplier: bad as unknown as number }), JSON.stringify(bad)).toBe(1)
    }
  })

  it('reads a whole clip as well as a bare field', () => {
    const clip = { id: 'c', name: 'c', startSec: 0, endSec: 4, speedMultiplier: 2 } as Clip
    expect(clipSpeed(clip)).toBe(2)
  })
})

describe('clipRecipe — what Compile sends main for each clip', () => {
  // `Required<Clip>` means a field added to Clip fails THIS FILE's typecheck until
  // it is listed here, and the test below then asks whether the new field is part
  // of the recipe (carry it) or not (list it as not).
  const clip: Required<Clip> = {
    id: 'c1',
    name: 'Boss fight',
    startSec: 12,
    endSec: 20,
    cropRect: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
    textOverlays: [
      {
        id: 'o1',
        text: 'GG',
        font: 'Arial',
        sizePx: 48,
        colorHex: '#ff3b30',
        x: 0.1,
        y: 0.8,
        startSec: 13,
        endSec: 15
      }
    ],
    selectedPresets: ['youtube', 'reels'],
    customPresetIds: ['cp-1'],
    speedMultiplier: 2,
    colorGrade: { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.5 },
    autoZoom: true,
    hypeShake: true
  }

  /** Fields of a Clip that are NOT part of how its picture and sound come out. */
  const NOT_RECIPE = ['id', 'name', 'startSec', 'endSec', 'selectedPresets', 'customPresetIds']

  it('carries every field that decides how the clip looks and sounds, and no other', () => {
    const recipe = clipRecipe(clip)
    expect(Object.keys(recipe).sort()).toEqual(
      Object.keys(clip)
        .filter((key) => !NOT_RECIPE.includes(key))
        .sort()
    )
  })

  it('carries each field\'s value untouched', () => {
    const recipe = clipRecipe(clip)
    expect(recipe.cropRect).toEqual(clip.cropRect)
    expect(recipe.textOverlays).toEqual(clip.textOverlays)
    expect(recipe.speedMultiplier).toBe(2)
    expect(recipe.colorGrade).toEqual(clip.colorGrade)
    expect(recipe.autoZoom).toBe(true)
    expect(recipe.hypeShake).toBe(true)
  })

  it('a clip with nothing set sends nothing set — and its speed as 1x, which is what it plays at', () => {
    const plain = { cropRect: null, textOverlays: [] }
    expect(clipRecipe(plain)).toEqual({
      cropRect: null,
      textOverlays: [],
      speedMultiplier: 1,
      colorGrade: undefined,
      autoZoom: undefined,
      hypeShake: undefined
    })
  })

  // T-112. Round 61 made main refuse a segment whose speed is outside the slider's
  // range, and a project saved by an older build (or edited by hand) can hold 0:
  // the slider and the grid read it as 1x (`clipSpeed`), so the clip looks normal
  // and Compile used to answer it with a failure. Over the wire a clip's speed is
  // the speed it PLAYS at.
  it('sends the speed the clip plays at: a legacy 0, a negative or a non-finite speed goes over as 1x', () => {
    for (const speedMultiplier of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const recipe = clipRecipe({ cropRect: null, textOverlays: [], speedMultiplier })
      expect(recipe.speedMultiplier, String(speedMultiplier)).toBe(1)
    }
  })

  it('a real speed goes over as itself', () => {
    for (const speedMultiplier of [0.25, 1, 1.5, 4]) {
      expect(clipRecipe({ cropRect: null, textOverlays: [], speedMultiplier }).speedMultiplier).toBe(
        speedMultiplier
      )
    }
  })

  it('does not send which platforms the clip is ticked for, its name, or its range', () => {
    const recipe = clipRecipe(clip) as unknown as Record<string, unknown>
    for (const key of NOT_RECIPE) expect(recipe[key], key).toBeUndefined()
  })
})

describe('clipForExport — the clip an export job carries (T-113)', () => {
  const stored: Clip = {
    id: 'c1',
    name: 'Cold open',
    startSec: 4,
    endSec: 19,
    cropRect: { x: 0.1, y: 0, w: 0.5, h: 1 },
    textOverlays: [],
    selectedPresets: ['youtube', 'reels'],
    customPresetIds: ['p1'],
    speedMultiplier: 0,
    colorGrade: { brightness: 0.1, contrast: 1, saturation: 1, temperature: 0 },
    autoZoom: true,
    hypeShake: false
  }

  it('plays a stored speed of 0 at 1x, like the slider, the grid and Compile', () => {
    expect(clipForExport(stored).speedMultiplier).toBe(1)
    expect(clipForExport({ ...stored, speedMultiplier: undefined }).speedMultiplier).toBe(1)
    expect(clipForExport({ ...stored, speedMultiplier: -2 }).speedMultiplier).toBe(1)
  })

  it('keeps a real speed and every other field of the clip, recipe or not', () => {
    const out = clipForExport({ ...stored, speedMultiplier: 2 })
    expect(out).toEqual({ ...stored, speedMultiplier: 2 })
    expect(out.customPresetIds).toEqual(['p1'])
    expect(out.selectedPresets).toEqual(['youtube', 'reels'])
  })

  it('agrees with clipRecipe on every field of the recipe', () => {
    expect(clipForExport(stored)).toMatchObject(clipRecipe(stored))
  })

  it('does not change the stored clip', () => {
    const before = JSON.stringify(stored)
    clipForExport(stored)
    expect(JSON.stringify(stored)).toBe(before)
  })
})
