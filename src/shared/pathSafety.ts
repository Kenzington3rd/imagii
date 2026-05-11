import { assert } from './assert'

/**
 * Defense-in-depth path validation for paths that originate from
 * persisted state (project files, etc.) or get passed through the custom
 * imagii-file:// protocol handler.
 *
 * Threat model: a malicious .imagii.json carries `sourcePath: "../../etc/passwd"`
 * or an absolute path to a sensitive file. When opened, the renderer
 * happily passes that path to `pathToImagiiFileUrl`; the protocol handler
 * reads whatever was requested. Arbitrary file read on import.
 *
 * Mitigation: reject paths that contain unresolved `..` segments, that
 * aren't absolute (relative paths resolve against CWD — surprise reads),
 * or that target Windows reserved device names. Used both in
 * projectValidation (so malicious paths can't load) and in the file
 * protocol handler (so malicious paths can't fetch even if they get past
 * validation).
 *
 * This is NOT a sandbox — a path resolving to ANY absolute disk location
 * still passes. The full sandbox would require an allowlist of roots the
 * user has explicitly opened, which is out of scope here.
 */

/** Windows-reserved device basenames; opening these as files is unsafe. */
const RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

/**
 * Returns true iff the given path is safe to pass to a file-read API:
 * absolute, no unresolved `..` segments, not a Windows reserved name.
 * Returns false (never throws) on any rejection so callers can fall
 * back cleanly.
 */
export function isSafeAbsolutePath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0) return false

  // Normalize separator handling: treat both Windows and POSIX-style.
  const normalized = p.replace(/\\/g, '/')

  // Must be absolute. Accept Windows drive letters (C:/...) or POSIX (/...).
  const isWinAbs = /^[A-Za-z]:\//.test(normalized)
  const isPosixAbs = normalized.startsWith('/')
  if (!isWinAbs && !isPosixAbs) return false

  // Reject any `..` segment. Splitting on `/` catches `..` as a whole
  // segment without false-positives on filenames like `foo..bar`.
  const segments = normalized.split('/')
  if (segments.some((s) => s === '..')) return false

  // Reject Windows reserved device basenames. The check is case-insensitive
  // and ignores any trailing extension.
  const last = segments[segments.length - 1] ?? ''
  const baseStem = last.split('.')[0]?.toLowerCase() ?? ''
  if (RESERVED_BASENAMES.has(baseStem)) return false

  return true
}

/**
 * Throwing variant for places where rejection is unrecoverable.
 */
export function assertSafeAbsolutePath(p: unknown, name: string): asserts p is string {
  assert(
    isSafeAbsolutePath(p),
    `${name} must be an absolute path without traversal or reserved device names`
  )
}
