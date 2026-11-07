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
  const replaced = t.replace(/\{(source|clip|preset|date|time|handle)\}/g, (_m, key) => {
    switch (key) {
      case 'source':
        return safe(ctx.source)
      case 'clip':
        return safe(ctx.clip ?? 'clip')
      case 'preset':
        return safe(ctx.preset ?? 'export')
      case 'date':
        return localDate()
      case 'time':
        return localTime()
      case 'handle':
        return handleClean
      default:
        return ''
    }
  })
  const cleaned = replaced.replace(/[\\/:*?"<>|]/g, '_').replace(/__+/g, '_').trim() || 'export'
  return `${cleaned}.${ctx.ext.replace(/^\./, '')}`
}

/**
 * The part of a name a person supplied, made safe to put in a file name: the characters Windows reserves become `_`, the ends are
 * trimmed, and an empty result is "untitled". It is what Export's `{source}`, `{clip}` and `{preset}` tokens go through, and (T-124
 * (17)) what Reframe and the GIF name their output from, so a source called "My Stream.flv" is "My Stream_reframe-..." in all three.
 */
export function safeNamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
}

function safe(s: string): string {
  return safeNamePart(s)
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
