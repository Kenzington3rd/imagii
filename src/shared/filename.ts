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

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function timeString(): string {
  const d = new Date()
  return `${pad2(d.getHours())}-${pad2(d.getMinutes())}`
}

export function expandFilenameTemplate(
  template: string | null | undefined,
  ctx: FilenameContext
): string {
  const t = (template ?? '').trim() || DEFAULT_TEMPLATE
  const handleClean = (ctx.handle ?? '').replace(/[^A-Za-z0-9_]/g, '')
  const replaced = t.replace(/\{(source|clip|preset|date|time|handle)\}/g, (_m, key) => {
    switch (key) {
      case 'source':
        return safe(ctx.source)
      case 'clip':
        return safe(ctx.clip ?? 'clip')
      case 'preset':
        return safe(ctx.preset ?? 'export')
      case 'date':
        return todayString()
      case 'time':
        return timeString()
      case 'handle':
        return handleClean
      default:
        return ''
    }
  })
  const cleaned = replaced.replace(/[\\/:*?"<>|]/g, '_').replace(/__+/g, '_').trim() || 'export'
  return `${cleaned}.${ctx.ext.replace(/^\./, '')}`
}

function safe(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
}

/**
 * Aggressive filename sanitizer used for Clip Kit subfolder + per-file
 * names. Distinct from `safe` above: this strips ALL non-alphanumeric
 * characters (preserving only word chars, dash, underscore) so the
 * result is portable across filesystems and pleasant in shell paths.
 *
 * Returns the literal 'clip' as a fallback so we never produce an empty
 * filename.
 */
export function sanitizeFilename(name: string): string {
  if (typeof name !== 'string') return 'clip'
  const cleaned = name.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : 'clip'
}
