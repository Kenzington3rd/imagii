import { describe, it, expect, vi, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expandFilenameTemplate, sanitizeFilename, localDate, localTime, localStamp } from './filename'

describe('sanitizeFilename', () => {
  it('passes through alphanumeric, dash, underscore unchanged', () => {
    expect(sanitizeFilename('clip-1')).toBe('clip-1')
    expect(sanitizeFilename('My_Clip-2')).toBe('My_Clip-2')
    expect(sanitizeFilename('abc123')).toBe('abc123')
  })

  it('replaces forbidden characters with underscore', () => {
    expect(sanitizeFilename('Big W!! 🎉')).toBe('Big_W')
    expect(sanitizeFilename('clip/with\\slashes')).toBe('clip_with_slashes')
    expect(sanitizeFilename('hello:world?')).toBe('hello_world')
  })

  it('collapses runs of forbidden chars and trims edges', () => {
    expect(sanitizeFilename('  spaces  ')).toBe('spaces')
    expect(sanitizeFilename('!!!boom!!!')).toBe('boom')
    expect(sanitizeFilename('a!!!b!!!c')).toBe('a_b_c')
  })

  it('returns "clip" fallback for inputs that sanitize to empty', () => {
    expect(sanitizeFilename('')).toBe('clip')
    expect(sanitizeFilename('!!!')).toBe('clip')
    expect(sanitizeFilename('🎉🎉🎉')).toBe('clip')
  })

  // T-121: the class was ASCII `\w`. "Épico clutch" came out `pico_clutch` and a Korean clip name came out as
  // the fallback `clip`, so two clips named in Hangul shared one name and the kit's files collided.
  describe('letters and numbers of any script survive', () => {
    it('keeps an accented capital: "Épico clutch" is Épico_clutch, not pico_clutch', () => {
      expect(sanitizeFilename('Épico clutch')).toBe('Épico_clutch')
      expect(sanitizeFilename('ñandú-fast_run')).toBe('ñandú-fast_run')
      expect(sanitizeFilename('Straße 2')).toBe('Straße_2')
    })

    it('keeps a Korean name, not the fallback', () => {
      expect(sanitizeFilename('클립 이름')).toBe('클립_이름')
      expect(sanitizeFilename('한국어')).toBe('한국어')
    })

    it('keeps Japanese, Chinese, Cyrillic, Arabic and Hebrew names', () => {
      expect(sanitizeFilename('クリップ名')).toBe('クリップ名')
      expect(sanitizeFilename('精彩时刻 第2集')).toBe('精彩时刻_第2集')
      expect(sanitizeFilename('Клип дня')).toBe('Клип_дня')
      expect(sanitizeFilename('نادي الفيديو')).toBe('نادي_الفيديو')
      expect(sanitizeFilename('שלום עולם')).toBe('שלום_עולם')
    })

    it('two different Hangul names are two different file names (they used to collide on "clip")', () => {
      expect(sanitizeFilename('첫 번째')).not.toBe(sanitizeFilename('두 번째'))
    })

    it('a combining mark stays on the letter it modifies: a decomposed é, a Thai or Hindi word', () => {
      expect(sanitizeFilename('E\u0301pico clutch')).toBe('E\u0301pico_clutch')
      expect(sanitizeFilename('สวัสดี ชาวโลก')).toBe('สวัสดี_ชาวโลก')
      expect(sanitizeFilename('हिन्दी क्लिप')).toBe('हिन्दी_क्लिप')
    })

    it('an emoji still goes, and its variation selector does not survive as an invisible name', () => {
      expect(sanitizeFilename('\u2764\uFE0F')).toBe('clip')
      expect(sanitizeFilename('\u2764\uFE0F love')).toBe('love')
      expect(sanitizeFilename('Big W!! 🎉')).toBe('Big_W')
    })

    it('a mark follows a letter, a number, an underscore or a dash - the docstring says so (T-122), because that is what the class does', () => {
      // `a_️b` keeps its U+FE0F: the mark rides on the `_` (and on a `-`). Harmless, so the class is not tightened;
      // the sentence that claimed a mark stays "only on the letter or number it modifies" overclaimed.
      expect(sanitizeFilename('a_️b')).toBe('a_️b')
      expect(sanitizeFilename('a-️b')).toBe('a-️b')
      // ...and it still does not ride on the thing an emoji IS: that goes, and so does the selector after it.
      expect(sanitizeFilename('a❤️b')).toBe('a_b')
    })

    it('path separators, dots and reserved characters are still never kept, in any script', () => {
      expect(sanitizeFilename('한국어/..\\x')).toBe('한국어_x')
      expect(sanitizeFilename('..\\..\\Épico')).toBe('Épico')
      expect(sanitizeFilename('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h')
      expect(sanitizeFilename('clip.mp4')).toBe('clip_mp4')
    })
  })

  it('handles non-string input defensively', () => {
    // @ts-expect-error — tests defensive runtime behavior on bad input
    expect(sanitizeFilename(null)).toBe('clip')
    // @ts-expect-error — tests defensive runtime behavior on bad input
    expect(sanitizeFilename(undefined)).toBe('clip')
    // @ts-expect-error — tests defensive runtime behavior on bad input
    expect(sanitizeFilename(42)).toBe('clip')
  })
})

describe('expandFilenameTemplate', () => {
  it('expands tokens against context', () => {
    const out = expandFilenameTemplate('{source}_{clip}_{preset}', {
      source: 'vod123',
      clip: 'highlight',
      preset: 'tiktok',
      ext: 'mp4'
    })
    expect(out).toBe('vod123_highlight_tiktok.mp4')
  })

  it('falls back to default template on empty input', () => {
    const out = expandFilenameTemplate('', {
      source: 'vod',
      clip: 'c',
      preset: 'p',
      ext: 'mp4'
    })
    expect(out).toBe('vod_c_p.mp4')
  })

  it('strips invalid filesystem chars from substituted values', () => {
    const out = expandFilenameTemplate('{source}', {
      source: 'bad/name:here',
      ext: 'mp4'
    })
    expect(out).toMatch(/^bad_name_here\.mp4$/)
  })
})

// T-122 (2): `{handle}` was the last ASCII sanitizer. `[^A-Za-z0-9_]` emptied a handle written in any other script
// ("@토끼" -> ""), the exact class T-121 (7) closed for clip names, and there was no `{handle}` case at all.
describe('the {handle} token keeps a handle written in any script (T-122)', () => {
  const handleName = (handle: string | undefined): string =>
    expandFilenameTemplate('{handle}', { source: 'vod', handle, ext: 'mp4' })

  it('ASCII behaves as before: the @ and everything else outside letters, numbers and _ goes', () => {
    expect(handleName('@MyHandle_9')).toBe('MyHandle_9.mp4')
    expect(handleName('my.handle')).toBe('myhandle.mp4')
    expect(handleName('my-handle x')).toBe('myhandlex.mp4')
  })

  it('keeps a Korean handle: "@토끼" is 토끼, not the empty string (and so not the "export" fallback)', () => {
    expect(handleName('@토끼')).toBe('토끼.mp4')
    expect(expandFilenameTemplate('{source}_{handle}', { source: 'vod', handle: '@토끼', ext: 'mp4' })).toBe('vod_토끼.mp4')
  })

  it('keeps Japanese, Chinese, Cyrillic, Arabic, Hebrew and accented Latin handles', () => {
    expect(handleName('@うさぎ')).toBe('うさぎ.mp4')
    expect(handleName('@兔子')).toBe('兔子.mp4')
    expect(handleName('@Кролик')).toBe('Кролик.mp4')
    expect(handleName('@أرنب')).toBe('أرنب.mp4')
    expect(handleName('@ארנב')).toBe('ארנב.mp4')
    expect(handleName('@Épico_9')).toBe('Épico_9.mp4')
  })

  it('a combining mark stays on its letter: a decomposed accent, a Thai or Hindi handle', () => {
    expect(handleName('@Épico')).toBe('Épico.mp4')
    expect(handleName('@สวัสดี')).toBe('สวัสดี.mp4')
    expect(handleName('@हिन्दी')).toBe('हिन्दी.mp4')
  })

  it('an emoji goes, and its variation selector does not survive as an invisible name (the T-121 (7) case)', () => {
    expect(handleName('@Streamer❤️')).toBe('Streamer.mp4')
    // nothing but an emoji is nothing: the template falls back as it does for any empty result.
    expect(handleName('❤️')).toBe('export.mp4')
  })

  it('path separators, dots and reserved characters are never kept, in any script', () => {
    expect(handleName('../토끼/x:y')).toBe('토끼xy.mp4')
    expect(handleName('a\\b*c?d"e<f>g|h')).toBe('abcdefgh.mp4')
    expect(handleName('..')).toBe('export.mp4')
  })

  it('no handle is still no handle', () => {
    expect(handleName(undefined)).toBe('export.mp4')
    expect(handleName('')).toBe('export.mp4')
    expect(expandFilenameTemplate('{source}_{handle}', { source: 'vod', ext: 'mp4' })).toBe('vod_.mp4')
  })
})

// ── T-117 (3): a date in a file or folder name is the date ON THE PERSON'S CLOCK ────────────────────
// The export panel's {date} and {time} were local; the Clip Kit folder (`<name>-kit-<date>`, main) and
// Record's default file name (`recording-<stamp>`, renderer) came from `toISOString()`, which is UTC.
// An evening streamer in Pacific time (UTC-7) got a kit dated tomorrow, and a take named for the day
// after it was made. All three now read the same three helpers.

/** Run `fn` with the process clock set to `tz` (Node re-reads TZ on assignment), then put it back. */
function inTimeZone<T>(tz: string, fn: () => T): T {
  const was = process.env.TZ
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
}

/** A Date whose LOCAL fields say one thing and whose UTC fields say another, in any process time zone. */
function dateWithOffset(local: [number, number, number, number, number, number], utcIso: string): Date {
  const d = new Date(utcIso)
  const [y, mo, day, h, mi, s] = local
  Object.assign(d, {
    getFullYear: () => y,
    getMonth: () => mo - 1,
    getDate: () => day,
    getHours: () => h,
    getMinutes: () => mi,
    getSeconds: () => s
  })
  return d
}

describe('local date and time stamps (T-117)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('read the local fields, not the UTC ones (a Date that says 21:23 on the 10th here and the 11th in UTC)', () => {
    const evening = dateWithOffset([2026, 10, 10, 21, 23, 2], '2026-10-11T04:23:02.000Z')
    expect(evening.toISOString().slice(0, 10), 'the fixture really is "tomorrow" in UTC').toBe('2026-10-11')
    expect(localDate(evening)).toBe('2026-10-10')
    expect(localTime(evening)).toBe('21-23')
    expect(localStamp(evening)).toBe('2026-10-10T21-23-02')
  })

  it('and the other way round: a clock east of UTC is ahead of the ISO string', () => {
    const morning = dateWithOffset([2026, 10, 11, 9, 30, 5], '2026-10-10T20:30:05.000Z')
    expect(localDate(morning)).toBe('2026-10-11')
    expect(localStamp(morning)).toBe('2026-10-11T09-30-05')
  })

  it.each([
    ['America/Los_Angeles', '2026-10-11T04:23:02Z', '2026-10-10', '21-23', '2026-10-10T21-23-02'],
    ['Pacific/Auckland', '2026-10-10T20:30:05Z', '2026-10-11', '09-30', '2026-10-11T09-30-05'],
    ['UTC', '2026-10-11T04:23:02Z', '2026-10-11', '04-23', '2026-10-11T04-23-02']
  ])('in %s, the real clock at %s is %s %s', (tz, iso, date, time, stamp) => {
    inTimeZone(tz, () => {
      const at = new Date(iso)
      expect(localDate(at)).toBe(date)
      expect(localTime(at)).toBe(time)
      expect(localStamp(at)).toBe(stamp)
    })
  })

  it('with no argument they read now, through the fake clock (what makeKitDir and Record call)', () => {
    inTimeZone('America/Los_Angeles', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-11T04:23:02Z'))
      expect(localDate()).toBe('2026-10-10')
      expect(localStamp()).toBe('2026-10-10T21-23-02')
    })
  })

  it('pad single digits, and a stamp is safe in a Windows file name (no colon, no dot, no space)', () => {
    const early = dateWithOffset([2026, 1, 2, 3, 4, 5], '2026-01-02T03:04:05.000Z')
    expect(localDate(early)).toBe('2026-01-02')
    expect(localTime(early)).toBe('03-04')
    expect(localStamp(early)).toBe('2026-01-02T03-04-05')
    for (const v of [localDate(early), localTime(early), localStamp(early), localStamp()]) {
      expect(v).toMatch(/^[0-9T-]+$/)
    }
  })

  it('the export panel\'s {date} and {time} are the same two helpers - one convention, not three', () => {
    inTimeZone('America/Los_Angeles', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-11T04:23:02Z'))
      expect(expandFilenameTemplate('{date}_{time}', { source: 's', ext: 'mp4' })).toBe('2026-10-10_21-23.mp4')
    })
  })
})

describe('nothing under src names a file or folder from the UTC ISO string (T-117)', () => {
  // The two places that did were the kit folder and the recording's name. A third is how it comes back.
  const SRC = path.resolve(__dirname, '..')
  const UTC_STAMP = /\.toISOString\(\)/

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return sources(full)
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
    })
  }

  it('no non-test source calls toISOString()', () => {
    const files = sources(SRC)
    expect(files.length, 'the scan found the sources').toBeGreaterThan(100)
    const offenders = files
      .filter((f) => UTC_STAMP.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
      .map((f) => path.relative(SRC, f))
    expect(offenders, 'a name or folder stamped from toISOString() is UTC - use localDate / localStamp (shared/filename.ts)').toEqual([])
  })

  it('the scan discriminates', () => {
    expect(UTC_STAMP.test('new Date().toISOString().slice(0, 10)')).toBe(true)
    expect(UTC_STAMP.test('localDate()')).toBe(false)
  })
})
