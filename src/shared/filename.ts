export interface FilenameContext {
  source: string
  clip?: string
  preset?: string
  handle?: string
  ext: string
}

const DEFAULT_TEMPLATE = '{source}_{clip}_{preset}'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * The date and time in a file or folder name are the ones on the PERSON'S clock (T-117): the
 * export panel's {date} and {time}, the Clip Kit folder (`<name>-kit-<date>`) and Record's
 * default file name all read these. `toISOString()` is UTC, so an evening streamer west of
 * Greenwich got a kit dated tomorrow. Colons are out (Windows file names), so times are
 * `HH-MM`; `d` is for the tests.
 */

/** `YYYY-MM-DD` on the local calendar. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** `HH-MM` on the local clock. */
export function localTime(d: Date = new Date()): string {
  return `${pad2(d.getHours())}-${pad2(d.getMinutes())}`
}

/** `YYYY-MM-DDTHH-MM-SS` on the local clock: a name that sorts, and is one file apart per second. */
export function localStamp(d: Date = new Date()): string {
  return `${localDate(d)}T${localTime(d)}-${pad2(d.getSeconds())}`
}

/**
 * T-184 (2): a name Export builds is at most this many UTF-16 units, so `nextFreePath`'s " (9999)" still fits under the 255 the gate (`assertPlainMp4Name`,
 * `name.length <= 255`) and a Windows file name hold. The Export panel is the only caller and its name goes to that gate, so this fits in the gate's own unit.
 */
const TEMPLATE_NAME_MAX = 255 - ' (9999)'.length

/**
 * T-187 (3): the ONE class of characters a name Export or main builds never keeps: the nine Windows reserves (`\ / : * ? " < > |`), the C0 controls (U+0000-U+001F: a tab
 * pasted from a spreadsheet, a stray NUL) and DEL. Each becomes `_`. `safeNamePart`, the template's own text and main's default Export name (`safeFileBase`) all read it, so
 * what they build is a name the gate (`assertPlainMp4Name`, which refuses a control character) accepts by construction. Used with `replace`, so the global flag's state never shows.
 */
export const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g

/** What a template makes once its parts are in: the forbidden characters out, runs of `_` one, the ends trimmed. */
function templateStem(template: string, values: Record<string, string>): string {
  const replaced = template.replace(/\{(source|clip|preset|date|time|handle)\}/g, (_m, key: string) => values[key] ?? '')
  return replaced.replace(FORBIDDEN_NAME_CHARS, '_').replace(/__+/g, '_').trim() || 'export'
}

/** `value` with at least `over` UTF-16 units taken off its end, at a whole code point. */
function shorten(value: string, over: number): string {
  return fitFileName(value, '', 'utf16', Math.max(0, value.length - over))
}

export function expandFilenameTemplate(
  template: string | null | undefined,
  ctx: FilenameContext
): string {
  const t = (template ?? '').trim() || DEFAULT_TEMPLATE
  // T-122: letters and numbers of any script plus `_` (this was ASCII, so "@토끼" came out empty), dots and
  // every other character still dropped. A combining mark stays only right after one of those, as in
  // `sanitizeFilename`: with `\p{M}` matched anywhere an emoji's variation selector (U+FE0F) rides out as an
  // invisible name.
  const handleClean = ((ctx.handle ?? '').match(/(?:[\p{L}\p{N}_]\p{M}*)+/gu) ?? []).join('')
  const values: Record<string, string> = {
    source: safe(ctx.source),
    clip: safe(ctx.clip ?? 'clip'),
    preset: safe(ctx.preset ?? 'export'),
    date: localDate(),
    time: localTime(),
    handle: handleClean
  }
  const ext = `.${ctx.ext.replace(/^\./, '')}`
  const room = TEMPLATE_NAME_MAX - ext.length
  // T-184 (2): a name over `room` is shortened HERE, where it is built, and what tells the files apart is kept: the video's name ({source}) is cut first, then the
  // clip's ({clip}); the preset, the date, the time, the handle, the template's own text and the extension are never cut. (Left whole, the name was refused at the
  // gate and the person read only "Export failed.") A template whose fixed parts alone are over is left for the gate to refuse in its own sentence.
  for (const key of ['source', 'clip'] as const) {
    const uses = t.split(`{${key}}`).length - 1
    const over = templateStem(t, values).length - room
    if (uses > 0 && over > 0) values[key] = shorten(values[key] ?? '', Math.ceil(over / uses))
  }
  return `${templateStem(t, values)}${ext}`
}

/**
 * T-183 (2): `<base><tail>` for a name main builds from a person's (or a file's) name and a DESCRIPTIVE tail - `_480px_15fps.gif`, `_compilation.mp4`,
 * `_reframe-1080x1920-center.mp4`, `-cleaned.wav`. The BASE is cut, never the tail: the tail is what tells the person which file is which. Room is left
 * for `nextFreePath`'s " (9999)" as well, so a taken name's " (2)" does not cut the tail on the second run either. `unit` is the drive's (`fitFileName`).
 */
export function nameWithTail(base: string, tail: string, unit: NameUnit): string {
  return `${fitFileName(base, `${tail} (9999)`, unit)}${tail}`
}

/**
 * The part of a name a person supplied, made safe to put in a file name: the characters Windows reserves and the control characters (T-187 (3)) become `_`, the ends are
 * trimmed, and an empty result is "untitled". It is what Export's `{source}`, `{clip}` and `{preset}` tokens go through, and (T-124
 * (17)) what Reframe and the GIF name their output from, so a source called "My Stream.flv" is "My Stream_reframe-..." in all three.
 */
export function safeNamePart(s: string): string {
  return s.replace(FORBIDDEN_NAME_CHARS, '_').trim() || 'untitled'
}

function safe(s: string): string {
  return safeNamePart(s)
}

/**
 * T-184 (2): what a file name's 255 is counted in. NTFS (the shipped Windows build) holds 255 UTF-16 code units, so a Hangul, kana or kanji character is ONE and an
 * astral glyph two; ext4 (the dev and CI hosts) holds 255 UTF-8 BYTES, where those characters are three and four. `'utf8'` was the only count in T-183 and
 * charged a Japanese title three times what Windows does, so a name Windows would have written whole was cut.
 */
export type NameUnit = 'utf8' | 'utf16'

/** What one code point costs in `unit` (a lone surrogate is one UTF-16 unit, and the 3 bytes TextEncoder writes for it in UTF-8). */
function unitLength(codePoint: number, unit: NameUnit): number {
  if (unit === 'utf16') return codePoint > 0xffff ? 2 : 1
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
}

function unitsOf(s: string, unit: NameUnit): number {
  let n = 0
  for (const ch of s) n += unitLength(ch.codePointAt(0) ?? 0, unit)
  return n
}

/**
 * T-183 (2): the stem of a name that must still be a legal file name once `suffix` is added to it. A person's name (a VOD title, a pasted clip name)
 * plus what imagii adds - ` (2)`, `.<hex>.partial.mp4`, `-<id>.mp4`, `.srt.clip-<uuid>.srt` - can pass every gate and still be longer than the 255 a
 * file-system component holds, and the write then fails with "File name too long". The stem is cut at a WHOLE code point (never half a surrogate pair or
 * a multi-byte character) so that the length of stem + suffix in `unit` is at most `max` (T-184 (2): main passes the drive's unit, `NAME_UNIT`; the renderer
 * passes `'utf16'`, the gate's own). A stem that already fits comes back unchanged; a CUT stem loses its trailing spaces and dots, which Windows drops from
 * a name (the file would land under a different name than the one asked for).
 */
export function fitFileName(stem: string, suffix: string, unit: NameUnit, max = 255): string {
  const room = max - unitsOf(suffix, unit)
  if (unitsOf(stem, unit) <= room) return stem
  let cut = ''
  let used = 0
  for (const ch of stem) {
    used += unitLength(ch.codePointAt(0) ?? 0, unit)
    if (used > room) break
    cut += ch
  }
  return cut.replace(/[ .]+$/, '')
}

/**
 * Aggressive filename sanitizer used for Clip Kit subfolder + per-file
 * names. Distinct from `safe` above: this keeps only letters and numbers
 * of any script (Unicode `\p{L}` and `\p{N}`, so "Épico clutch" keeps its
 * É and a Korean, Cyrillic or Arabic name survives), the underscore and
 * the dash, and turns every other run of characters into one underscore,
 * so the result is portable across filesystems and pleasant in shell
 * paths. A combining mark (`\p{M}`: a Thai or Hindi vowel sign, the accent
 * of a decomposed "e" + U+0301) stays only when it directly follows a
 * letter, a number, `_` or `-`; one that follows anything else (the
 * variation selector an emoji carries follows the emoji, which goes) goes
 * with the rest. A mark right after an underscore or a dash is kept too -
 * harmless, and tightening the class risks names already shipped for no
 * gain to the person. The path separators, dots, colons and
 * wildcards are not in the set, so a name can never leave its folder or
 * reach a Windows reserved character.
 *
 * T-121: this was ASCII `\w`, so "Épico clutch" became `pico_clutch` and a
 * Korean clip name became the fallback.
 *
 * Returns the literal 'clip' as a fallback so we never produce an empty
 * filename.
 */
export function sanitizeFilename(name: string): string {
  if (typeof name !== 'string') return 'clip'
  const runs = name.match(/(?:[\p{L}\p{N}_-]\p{M}*)+/gu) ?? []
  const cleaned = runs.join('_').replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : 'clip'
}
