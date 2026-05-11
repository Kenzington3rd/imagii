/**
 * Runtime assertion helpers for Power-of-Ten rule 5 (≥2 assertions per function).
 *
 * `assert(cond, msg)` — dev throws on falsy; prod warns and continues. Safe
 * because the return type is void; downstream code that only relies on the
 * `asserts cond` narrowing degrades gracefully (TS still narrows; runtime
 * may misbehave but doesn't crash).
 *
 * `assertDefined(value, name)` — throws in BOTH dev and prod when value is
 * null/undefined. Earlier we tried "warn + return value as T" in prod to
 * mirror `assert()`, but that defeats its own purpose: the next line that
 * does `result.foo` or `result.length` crashes with a less helpful
 * `TypeError: Cannot read properties of null` instead of the named
 * assertion message. Crashing early with the right error beats crashing
 * later with the wrong one.
 *
 * Importable from main, preload, and renderer — uses `globalThis.process`
 * (electron-vite injects this in the renderer).
 */

function isProd(): boolean {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process
  return proc?.env?.NODE_ENV === 'production'
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(`Assertion failed: ${message}`)
    this.name = 'AssertionError'
  }
}

/**
 * Assert a condition. Narrows the type of `cond` to truthy on the success path.
 */
export function assert(cond: unknown, msg: string): asserts cond {
  if (typeof msg !== 'string' || msg.length === 0) {
    throw new AssertionError('assert() called without a non-empty message')
  }
  if (cond) return
  if (isProd()) {
    console.warn(`[assert] ${msg}`)
    return
  }
  throw new AssertionError(msg)
}

/**
 * Assert a value is not null/undefined and return it as the narrowed type.
 * Use instead of the `!` non-null assertion operator.
 *
 * Throws in BOTH dev and prod — see the module docstring for rationale.
 */
export function assertDefined<T>(value: T | null | undefined, name: string): T {
  if (typeof name !== 'string' || name.length === 0) {
    throw new AssertionError('assertDefined() called without a name')
  }
  if (value !== null && value !== undefined) return value
  // Also log in prod for telemetry, then throw so callers fail fast with a
  // named message instead of a downstream `TypeError: Cannot read
  // properties of null`. The named throw is strictly more useful than the
  // anonymous TypeError it would otherwise become.
  if (isProd()) {
    console.warn(`[assertDefined] ${name} was ${value === null ? 'null' : 'undefined'}`)
  }
  throw new AssertionError(`${name} was ${value === null ? 'null' : 'undefined'}`)
}
