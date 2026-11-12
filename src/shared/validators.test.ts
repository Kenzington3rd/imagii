import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { assertSafeAbsolutePath } from './pathSafety'
import {
  assertNonEmptyString,
  assertFiniteNonNeg,
  assertRange,
  assertEnum,
  assertPlainObject,
  assertArray,
  assertOptionalTimeRange,
  assertOptionalCropRect,
  assertOptionalClipRecipe
} from './validators'

describe('assertNonEmptyString', () => {
  it('accepts non-empty strings', () => {
    expect(() => assertNonEmptyString('hi', 'name')).not.toThrow()
  })
  it('rejects empty, null, undefined, non-strings', () => {
    expect(() => assertNonEmptyString('', 'name')).toThrow(/non-empty string/)
    expect(() => assertNonEmptyString(null, 'name')).toThrow(/non-empty string/)
    expect(() => assertNonEmptyString(undefined, 'name')).toThrow(/non-empty string/)
    expect(() => assertNonEmptyString(42, 'name')).toThrow(/non-empty string/)
  })
})

describe('assertFiniteNonNeg', () => {
  it('accepts 0 and positive finite numbers', () => {
    expect(() => assertFiniteNonNeg(0, 'x')).not.toThrow()
    expect(() => assertFiniteNonNeg(1.5, 'x')).not.toThrow()
  })
  it('rejects negative, NaN, Infinity, non-numbers', () => {
    expect(() => assertFiniteNonNeg(-1, 'x')).toThrow()
    expect(() => assertFiniteNonNeg(NaN, 'x')).toThrow()
    expect(() => assertFiniteNonNeg(Infinity, 'x')).toThrow()
    expect(() => assertFiniteNonNeg('5', 'x')).toThrow()
  })
})

describe('assertRange', () => {
  it('accepts values inside [lo, hi] inclusive', () => {
    expect(() => assertRange(0, 0, 10, 'x')).not.toThrow()
    expect(() => assertRange(10, 0, 10, 'x')).not.toThrow()
    expect(() => assertRange(5, 0, 10, 'x')).not.toThrow()
  })
  it('rejects values outside the range', () => {
    expect(() => assertRange(-1, 0, 10, 'x')).toThrow(/in \[0, 10\]/)
    expect(() => assertRange(11, 0, 10, 'x')).toThrow(/in \[0, 10\]/)
  })
})

describe('assertEnum', () => {
  const allowed = ['a', 'b', 'c'] as const
  it('accepts members', () => {
    expect(() => assertEnum('a', allowed, 'kind')).not.toThrow()
    expect(() => assertEnum('c', allowed, 'kind')).not.toThrow()
  })
  it('rejects non-members', () => {
    expect(() => assertEnum('z', allowed, 'kind')).toThrow(/one of a, b, c/)
    expect(() => assertEnum(undefined, allowed, 'kind')).toThrow()
  })
})

describe('assertPlainObject', () => {
  it('accepts plain objects', () => {
    expect(() => assertPlainObject({}, 'o')).not.toThrow()
    expect(() => assertPlainObject({ a: 1 }, 'o')).not.toThrow()
  })
  it('rejects arrays, null, primitives', () => {
    expect(() => assertPlainObject([], 'o')).toThrow(/plain object/)
    expect(() => assertPlainObject(null, 'o')).toThrow(/plain object/)
    expect(() => assertPlainObject('x', 'o')).toThrow(/plain object/)
  })
})

describe('assertArray', () => {
  it('accepts arrays under the cap', () => {
    expect(() => assertArray([], 'a')).not.toThrow()
    expect(() => assertArray([1, 2, 3], 'a', 5)).not.toThrow()
  })
  it('rejects non-arrays and over-cap arrays', () => {
    expect(() => assertArray({}, 'a')).toThrow(/must be an array/)
    expect(() => assertArray([1, 2, 3, 4, 5, 6], 'a', 5)).toThrow(/exceeds max length/)
  })
})

describe('assertOptionalTimeRange (captions:burnIn range, T-81)', () => {
  it('accepts an unranged request: both absent', () => {
    expect(() => assertOptionalTimeRange(undefined, undefined, 'req')).not.toThrow()
  })
  it('accepts a real range, including one starting at 0', () => {
    expect(() => assertOptionalTimeRange(0, 3, 'req')).not.toThrow()
    expect(() => assertOptionalTimeRange(2400.5, 2460.25, 'req')).not.toThrow()
  })
  it('refuses a half-given range, naming why', () => {
    expect(() => assertOptionalTimeRange(5, undefined, 'req')).toThrow(/given together/)
    expect(() => assertOptionalTimeRange(undefined, 5, 'req')).toThrow(/given together/)
  })
  it('refuses an empty or inverted range', () => {
    expect(() => assertOptionalTimeRange(5, 5, 'req')).toThrow(/greater than startSec/)
    expect(() => assertOptionalTimeRange(9, 2, 'req')).toThrow(/greater than startSec/)
  })
  it('refuses negative, non-finite and non-number values', () => {
    expect(() => assertOptionalTimeRange(-1, 5, 'req')).toThrow(/req\.startSec/)
    expect(() => assertOptionalTimeRange(NaN, 5, 'req')).toThrow(/req\.startSec/)
    expect(() => assertOptionalTimeRange(0, Infinity, 'req')).toThrow(/req\.endSec/)
    expect(() => assertOptionalTimeRange(0, NaN, 'req')).toThrow(/req\.endSec/)
    expect(() => assertOptionalTimeRange('2', 5, 'req')).toThrow(/req\.startSec/)
    expect(() => assertOptionalTimeRange(2, '5', 'req')).toThrow(/req\.endSec/)
    // null is not "absent": IPC sends undefined for a missing field.
    expect(() => assertOptionalTimeRange(null, null, 'req')).toThrow(/given together|startSec/)
    expect(() => assertOptionalTimeRange(null, 5, 'req')).toThrow(/req\.startSec/)
  })
  it('requires a validator name', () => {
    expect(() => assertOptionalTimeRange(0, 1, '')).toThrow(/name required/)
  })
})

describe('assertOptionalCropRect (compile + GIF crop payload, T-96)', () => {
  const rect = { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }

  it('accepts no crop: null (the clip has none) or undefined (an older caller)', () => {
    expect(() => assertOptionalCropRect(null, 'crop')).not.toThrow()
    expect(() => assertOptionalCropRect(undefined, 'crop')).not.toThrow()
  })

  it('accepts a crop the editor can draw, including the whole frame and one at an edge', () => {
    expect(() => assertOptionalCropRect(rect, 'crop')).not.toThrow()
    expect(() => assertOptionalCropRect({ x: 0, y: 0, w: 1, h: 1 }, 'crop')).not.toThrow()
    expect(() => assertOptionalCropRect({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 'crop')).not.toThrow()
    // The 9:16 preset button's rect for a 16:9 source (CropOverlay).
    expect(() =>
      assertOptionalCropRect({ x: 0.3575, y: 0.05, w: 0.285, h: 0.9 }, 'crop')
    ).not.toThrow()
  })

  it('allows the rounding hair a browser puts on a crop dragged to the edge, and no more', () => {
    expect(() => assertOptionalCropRect({ x: 0.2, y: 0, w: 0.8004, h: 1.0004 }, 'crop')).not.toThrow()
    expect(() => assertOptionalCropRect({ x: 0, y: 0, w: 1.02, h: 1 }, 'crop')).toThrow(/crop\.w/)
    expect(() => assertOptionalCropRect({ x: 0.5, y: 0, w: 0.7, h: 1 }, 'crop')).toThrow(/right edge/)
    expect(() => assertOptionalCropRect({ x: 0, y: 0.6, w: 1, h: 0.6 }, 'crop')).toThrow(/bottom edge/)
  })

  it('refuses a rectangle with no area, or an origin outside the frame', () => {
    expect(() => assertOptionalCropRect({ ...rect, w: 0 }, 'crop')).toThrow(/crop\.w/)
    expect(() => assertOptionalCropRect({ ...rect, h: -0.1 }, 'crop')).toThrow(/crop\.h/)
    expect(() => assertOptionalCropRect({ ...rect, x: -0.01 }, 'crop')).toThrow(/crop\.x/)
    expect(() => assertOptionalCropRect({ ...rect, y: 1.5 }, 'crop')).toThrow(/crop\.y/)
  })

  it('refuses what is not a number: strings, NaN, Infinity, a missing field', () => {
    expect(() => assertOptionalCropRect({ ...rect, x: '0.25' }, 'crop')).toThrow(/crop\.x/)
    expect(() => assertOptionalCropRect({ ...rect, w: NaN }, 'crop')).toThrow(/crop\.w/)
    expect(() => assertOptionalCropRect({ ...rect, h: Infinity }, 'crop')).toThrow(/crop\.h/)
    expect(() => assertOptionalCropRect({ x: 0, y: 0, w: 0.5 }, 'crop')).toThrow(/crop\.h/)
  })

  it('refuses a crop that is not a plain object, naming it', () => {
    expect(() => assertOptionalCropRect('0,0,1,1', 'segments[2].cropRect')).toThrow(
      /segments\[2\]\.cropRect must be a plain object/
    )
    expect(() => assertOptionalCropRect([0, 0, 1, 1], 'crop')).toThrow(/plain object/)
    expect(() => assertOptionalCropRect(7, 'crop')).toThrow(/plain object/)
  })

  it('requires a validator name', () => {
    expect(() => assertOptionalCropRect(rect, '')).toThrow(/name required/)
  })
})

describe('assertOptionalClipRecipe (compile segment recipe, T-105)', () => {
  const GRADE = { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.5 }
  const OVERLAY = {
    id: 'o1',
    text: 'GG',
    font: 'Arial',
    sizePx: 48,
    colorHex: '#ff3b30',
    x: 0.1,
    y: 0.8,
    startSec: 1,
    endSec: 3
  }
  const check = (seg: Record<string, unknown>): void => assertOptionalClipRecipe(seg, 'segments[0]')

  it('accepts a segment with no recipe at all, and one with every field set', () => {
    expect(() => check({})).not.toThrow()
    expect(() =>
      check({
        cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
        speedMultiplier: 2,
        colorGrade: GRADE,
        autoZoom: true,
        hypeShake: false,
        textOverlays: [OVERLAY]
      })
    ).not.toThrow()
  })

  it('accepts null and undefined for every field — "not set", as the builder reads them', () => {
    expect(() =>
      check({
        cropRect: null,
        speedMultiplier: undefined,
        colorGrade: null,
        autoZoom: undefined,
        hypeShake: null,
        textOverlays: null
      })
    ).not.toThrow()
  })

  it('accepts everything the editor can produce', () => {
    for (const speedMultiplier of [0.25, 1, 4]) expect(() => check({ speedMultiplier })).not.toThrow()
    for (const colorGrade of [
      { brightness: -0.5, contrast: 0.5, saturation: 0, temperature: -1 },
      { brightness: 0.5, contrast: 1.5, saturation: 2, temperature: 1 }
    ]) {
      expect(() => check({ colorGrade })).not.toThrow()
    }
  })

  const BAD: Array<[string, Record<string, unknown>, RegExp]> = [
    ['a speed of zero', { speedMultiplier: 0 }, /segments\[0\]\.speedMultiplier/],
    ['a negative speed', { speedMultiplier: -2 }, /speedMultiplier/],
    ['a speed past the gate', { speedMultiplier: 11 }, /speedMultiplier/],
    ['a speed as a string', { speedMultiplier: '2' }, /speedMultiplier/],
    ['NaN for a speed', { speedMultiplier: Number.NaN }, /speedMultiplier/],
    ['a grade that is not an object', { colorGrade: 'warm' }, /colorGrade must be a plain object/],
    ['a grade missing a field', { colorGrade: { brightness: 0, contrast: 1, saturation: 1 } }, /colorGrade\.temperature/],
    ['a brightness past what eq takes', { colorGrade: { ...GRADE, brightness: 2 } }, /colorGrade\.brightness/],
    ['a negative contrast', { colorGrade: { ...GRADE, contrast: -1 } }, /colorGrade\.contrast/],
    ['a saturation past the gate', { colorGrade: { ...GRADE, saturation: 5 } }, /colorGrade\.saturation/],
    ['a temperature colorbalance would refuse', { colorGrade: { ...GRADE, temperature: 5 } }, /colorGrade\.temperature/],
    ['a grade value as a string', { colorGrade: { ...GRADE, temperature: '0.5' } }, /colorGrade\.temperature/],
    ['NaN in a grade', { colorGrade: { ...GRADE, contrast: Number.NaN } }, /colorGrade\.contrast/],
    ['a flag as a string', { autoZoom: 'yes' }, /autoZoom must be true or false/],
    ['a flag as a number', { hypeShake: 1 }, /hypeShake must be true or false/],
    ['overlays that are not a list', { textOverlays: 'GG' }, /textOverlays must be an array/],
    ['a thousand and one overlays', { textOverlays: Array.from({ length: 1001 }, () => OVERLAY) }, /textOverlays exceeds/],
    ['an overlay carrying a filter injection in its color', { textOverlays: [{ ...OVERLAY, colorHex: 'white,movie=/etc/passwd' }] }, /textOverlays\[0\] malformed/],
    ['an overlay with a size that is not a number', { textOverlays: [OVERLAY, { ...OVERLAY, sizePx: 'big' }] }, /textOverlays\[1\] malformed/],
    ['a damaged crop', { cropRect: { x: 0, y: 0, w: 0, h: 1 } }, /segments\[0\]\.cropRect\.w/]
  ]

  it.each(BAD)('refuses %s, naming the field', (_label, segment, message) => {
    expect(() => check(segment)).toThrow(message)
  })

  it('names the segment it was given', () => {
    expect(() => assertOptionalClipRecipe({ speedMultiplier: 0 }, 'segments[7]')).toThrow(/segments\[7\]\.speedMultiplier/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T-113 (3) — validators throw; assert() warns. A split, on purpose.
//
// The validators delegated to `assert()`, which under NODE_ENV=production logs and
// RETURNS — so every trust-boundary check (a chain's gain, a path with `..`, a clip
// recipe's speed) failed open for exactly the person who has that variable set. A
// validator's job is to refuse; `assert()` stays the soft invariant it was written
// as. These run each validator on input it must refuse, with production forced on.
// ───────────────────────────────────────────────────────────────────────────
/**
 * Every call of the soft `assert(...)` in `source`: its 1-based line and its message (the last argument,
 * as written). Read from the syntax tree, so a call split over lines, a comment that says "assert(" and a
 * method call (`thing.assert(ok)`) are all handled.
 */
function softAssertCalls(source: string): Array<{ line: number; message: string }> {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true)
  const out: Array<{ line: number; message: string }> = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'assert') {
      const last = n.arguments[n.arguments.length - 1]
      const message =
        last === undefined ? '' : ts.isStringLiteralLike(last) ? last.text : last.getText(sf)
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, message })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Every non-test `.ts` file under `dir`, as a path relative to it with `/` separators. */
function sourceFilesBelow(dir: string, depth = 0): string[] {
  if (depth > 6) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFilesBelow(full, depth + 1).map((f) => `${name}/${f}`)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [name] : []
  })
}

/**
 * The soft `assert()` calls under src/main that were AUDITED and are staying (T-114): each guards an
 * argument that only another function of ours supplies - the IPC handler or a caller in main has already
 * refused anything a renderer could send - so a failure is a bug in our own code, to be seen in dev and
 * logged in production, never a way past a gate. Keyed by file and message, not line, so an edit above
 * one does not break the list; an entry the code no longer has fails the scan too. A new soft assert
 * anywhere in src/main fails until it is converted to `assertAlways` or audited into this table.
 *
 *  - tempCleanup.ts: `now` is `Date.now()` unless a test passes one.
 *  - quitFlush.ts: the timeout and the write function are the app's own wiring (index.ts).
 *  - protocol.ts: the four helpers sit behind the handler, which has already answered 403 for a path
 *    that is not safe (`isSafeAbsolutePath`) - `serveFile`'s check repeats it.
 *  - audio/extract.ts: `format` is `STUDIO_AUDIO` or `TRANSCRIPTION_AUDIO`; no renderer supplies it.
 *  - ffmpeg/highlights.ts: `video:analyzeClipHook` asserts the path (non-empty, safe), the start and the
 *    duration's range before calling `analyzeClipHook`.
 *  - ffmpeg/frame.ts: `video:extractFrame`, `video:makeKitDir` and `video:removeKitDir` assert every
 *    argument (non-empty, safe absolute path) before calling the three functions.
 */
const AUDITED_PURE_INVARIANTS: Readonly<Record<string, readonly string[]>> = {
  'tempCleanup.ts': ['pruneStaleTempFiles: `now` must be a finite non-negative ms timestamp'],
  'quitFlush.ts': ['quit flush timeout must be positive', 'quit flush needs a write function'],
  'protocol.ts': [
    'mimeTypeFor needs a path',
    'parseByteRange needs a real byte size',
    'bodyStream needs an inclusive forward range',
    'serveFile got an unvalidated path'
  ],
  'audio/extract.ts': ['extract format must be a whole sample rate and channel count'],
  'ffmpeg/highlights.ts': ['sourcePath required', 'startSec must be finite >= 0', 'durationSec must be in (0, 30]'],
  'ffmpeg/frame.ts': [
    'sourcePath required',
    'timeSec must be finite >= 0',
    'outputPath required',
    'parentDir required',
    'clipName required',
    'kitDir required'
  ]
}

describe('every validator throws under NODE_ENV=production (T-113)', () => {
  const prevEnv = process.env.NODE_ENV
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })
  afterEach(() => {
    process.env.NODE_ENV = prevEnv
  })

  const REFUSALS: Array<[string, () => void]> = [
    ['assertNonEmptyString', () => assertNonEmptyString('', 'name')],
    ['assertFiniteNonNeg', () => assertFiniteNonNeg(-1, 'x')],
    ['assertRange (a chain gain that is a filter string)', () => assertRange('0dB,ametadata=mode=print:file=x', -60, 60, 'chain.gainDb')],
    ['assertRange (out of range)', () => assertRange(99, -60, 60, 'chain.gainDb')],
    ['assertOptionalTimeRange (half a range)', () => assertOptionalTimeRange(1, undefined, 'range')],
    ['assertOptionalTimeRange (inverted)', () => assertOptionalTimeRange(5, 2, 'range')],
    ['assertEnum', () => assertEnum('z', ['a', 'b'] as const, 'kind')],
    ['assertPlainObject', () => assertPlainObject([], 'obj')],
    ['assertArray (not an array)', () => assertArray('nope', 'list')],
    ['assertArray (too long)', () => assertArray([1, 2, 3], 'list', 2)],
    ['assertOptionalCropRect', () => assertOptionalCropRect({ x: 0, y: 0, w: 0, h: 1 }, 'crop')],
    ['assertOptionalClipRecipe (a speed of zero)', () => assertOptionalClipRecipe({ speedMultiplier: 0 }, 'clip')],
    ['assertOptionalClipRecipe (an overlay color that is a filter)', () => assertOptionalClipRecipe({ textOverlays: [{ colorHex: 'white,movie=x' }] }, 'clip')],
    ['assertSafeAbsolutePath (traversal)', () => assertSafeAbsolutePath('/home/user/../etc/passwd', 'path')],
    ['assertSafeAbsolutePath (relative)', () => assertSafeAbsolutePath('video.mp4', 'path')],
    ['assertSafeAbsolutePath (a device name)', () => assertSafeAbsolutePath('C:/Users/x/con.mp4', 'path')]
  ]

  it.each(REFUSALS)('%s still refuses', (_name, refuse) => {
    expect(refuse).toThrow()
  })

  it('and a refusal does not log-and-continue: nothing is warned in place of the throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(() => assertRange(NaN, 0, 1, 'x')).toThrow(/must be in \[0, 1\]/)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('no validator is built on the soft assert(): a new one that is cannot slip in', () => {
    // The behavioral cases above cover the validators that exist; this covers the next
    // one, which would pass every test it was written with and fail open in production.
    for (const file of ['validators.ts', 'pathSafety.ts']) {
      const source = readFileSync(path.join(__dirname, file), 'utf8')
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, `${file} calls the soft assert()`).not.toMatch(/(^|[^\w.])assert\(/)
      expect(code, `${file} imports the soft assert`).not.toMatch(/import\s*\{[^}]*\bassert\b[^}]*\}\s*from\s*'\.\/assert'/)
    }
  })

  // T-113 delta: the gates in the IPC handlers are refusals too. Thirty-six plain `assert(` calls checked
  // a jobId, a range, a session id, a project about to be written - and logged and continued under
  // NODE_ENV=production. They are `assertAlways` now, and this fails on the next one that is not.
  // T-114: the scan covers ALL of src/main, not only src/main/ipc. Two refusals lived outside it: the re-attach
  // runner's guard before an unconditional delete (it deleted the user's source under NODE_ENV=production) and
  // the caption-color check that was the only thing between a style and `force_style`. What stays soft is the
  // audited table above - pure invariants behind a gate that already refused.
  it('no refusal under src/main uses the soft assert(): everything is assertAlways except the audited pure invariants', () => {
    const mainDir = path.resolve(__dirname, '../main')
    const files = sourceFilesBelow(mainDir)
    expect(files.length, 'the scan found the main-process sources').toBeGreaterThanOrEqual(40)
    expect(files, 'and the IPC handlers among them').toContain('ipc/video.ts')
    const found = files.flatMap((file) =>
      softAssertCalls(readFileSync(path.join(mainDir, file), 'utf8')).map((c) => `${file}: ${c.message}`)
    )
    const audited = Object.entries(AUDITED_PURE_INVARIANTS).flatMap(([file, messages]) =>
      messages.map((m) => `${file}: ${m}`)
    )
    expect(
      found.filter((f) => !audited.includes(f)),
      'plain assert( in main - use assertAlways (a refusal must not depend on NODE_ENV), or audit it into AUDITED_PURE_INVARIANTS'
    ).toEqual([])
    expect(
      audited.filter((a) => !found.includes(a)),
      'AUDITED_PURE_INVARIANTS names an assert that is no longer there - delete the entry'
    ).toEqual([])
  })

  describe('the scan itself discriminates', () => {
    it('flags a call, on the line it is on, with the message it was given', () => {
      expect(softAssertCalls("import { assert } from '../../shared/assert'\n\nassert(ok, 'x')\n")).toEqual([{ line: 3, message: 'x' }])
      expect(softAssertCalls("  const a = 1\n  assert(\n    cond,\n    'long message'\n  )")).toEqual([
        { line: 2, message: 'long message' }
      ])
      expect(softAssertCalls('assert(ok, `a ${b} c`)')[0]?.message).toBe('`a ${b} c`')
    })

    it('leaves assertAlways, assertDefined, the other validators, method calls and comments alone', () => {
      expect(softAssertCalls("assertAlways(ok, 'x')\nassertRange(1, 0, 2, 'n')\nthing.assert(ok)\nassertDefined(x, 'x')")).toEqual([])
      expect(softAssertCalls("// assert(ok, 'x') only warns\n/* assert(ok) */\nconst s = 1")).toEqual([])
      expect(softAssertCalls("import { assertAlways, assertDefined } from '../../shared/assert'")).toEqual([])
    })
  })

  it('the audited table is for pure invariants: no IPC handler and no refusal-bearing file is in it', () => {
    for (const file of Object.keys(AUDITED_PURE_INVARIANTS)) {
      expect(file.startsWith('ipc/'), `${file} is an IPC handler: its refusals are gates`).toBe(false)
    }
    expect(Object.keys(AUDITED_PURE_INVARIANTS)).not.toContain('audio/process.ts')
    expect(Object.keys(AUDITED_PURE_INVARIANTS)).not.toContain('sidecars/whisperManager.ts')
  })

  it('what is valid is still accepted in production', () => {
    expect(() => assertRange(5, 0, 10, 'x')).not.toThrow()
    expect(() => assertSafeAbsolutePath('/home/user/video.mp4', 'path')).not.toThrow()
    expect(() => assertOptionalClipRecipe({ speedMultiplier: 2 }, 'clip')).not.toThrow()
  })
})
