/**
 * Runtime assertion helpers for Power-of-Ten rule 5 (≥2 assertions per function).
 *
 * Throws an Error in dev so the failure surfaces immediately; warns and
 * continues in prod so a stray assertion never crashes a user's session.
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
 */
export function assertDefined<T>(value: T | null | undefined, name: string): T {
  if (typeof name !== 'string' || name.length === 0) {
    throw new AssertionError('assertDefined() called without a name')
  }
  if (value !== null && value !== undefined) return value
  if (isProd()) {
    console.warn(`[assertDefined] ${name} was ${value === null ? 'null' : 'undefined'}`)
    return value as T
  }
  throw new AssertionError(`${name} was ${value === null ? 'null' : 'undefined'}`)
}
