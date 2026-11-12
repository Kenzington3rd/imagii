import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WHISPER_MODEL_FILENAME } from '../../shared/captions'

/**
 * T-198 (1) - the model install's last step, `rename(<model>.partial, <model>)`, waits out a scanner's moment.
 *
 * A scanner (Defender, the indexer) can hold the 141 MB file just written for a moment and the rename is refused (EBUSY / EPERM / EACCES); the install then ended
 * with the raw reason after a download the person must repeat. This runs the REAL `installWhisperModel` against a fake `net.request` and a real folder, with the
 * model's size window and digest pointed at a 500-byte body (the 141 MB / pinned-digest check is the product's, unchanged) and `rename` made to refuse. It lives in
 * its own file, like `whisperInstallAbort.test.ts`, because the `electron`, `node:fs/promises` and `shared/captions` mocks are file-wide.
 */
const BODY = Buffer.alloc(500, 7)
const state = vi.hoisted(() => ({
  userData: '',
  /** The next `times` renames fail with `code`; then the real rename runs. */
  refuse: null as { code: string; times: number } | null,
  renames: 0
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, isPackaged: false },
  net: { request: () => new FakeRequest() }
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const rename = (async (from: string, to: string) => {
    state.renames += 1
    if (state.refuse && state.refuse.times > 0) {
      state.refuse.times -= 1
      throw Object.assign(new Error(`${state.refuse.code}: simulated, rename`), { code: state.refuse.code })
    }
    return actual.rename(from, to)
  }) as typeof actual.rename
  return { ...actual, rename, default: { ...actual, rename } }
})
vi.mock('../../shared/captions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/captions')>()
  return {
    ...actual,
    WHISPER_MODEL_MIN_BYTES: 100,
    WHISPER_MODEL_MAX_BYTES: 1000,
    WHISPER_MODEL_SHA256: createHash('sha256').update(Buffer.alloc(500, 7)).digest('hex')
  }
})

class FakeRequest extends EventEmitter {
  abort(): void {}
  end(): void {
    const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
    response.statusCode = 200
    response.headers = { 'content-length': String(BODY.length) }
    setTimeout(() => {
      this.emit('response', response)
      response.emit('data', BODY)
      response.emit('end')
    }, 0)
  }
}

let root = ''
let finalPath = ''
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'imagii-t198-'))
  state.userData = root
  state.refuse = null
  state.renames = 0
  finalPath = path.join(root, 'models', WHISPER_MODEL_FILENAME)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const install = async (): Promise<{ ok: boolean; reason?: string; path?: string }> => {
  const m = await import('./whisperManager')
  return m.installWhisperModel(() => undefined)
}

describe('the model install waits out a refused final rename (T-198 (1))', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])('%s once, then through: the install is ok, the model is in place and no partial is left', async (code) => {
    state.refuse = { code, times: 1 }
    const result = await install()
    expect(result).toEqual({ ok: true, path: finalPath })
    expect(state.renames, 'refused once, then through').toBe(2)
    expect(readFileSync(finalPath).equals(BODY)).toBe(true)
    expect(readdirSync(path.dirname(finalPath))).toEqual([WHISPER_MODEL_FILENAME])
  })

  it('a refusal that outlasts the waits ends the install { ok: false } with the disk\'s own reason, and no model is installed (budget pin)', async () => {
    state.refuse = { code: 'EPERM', times: 99 }
    const result = await install()
    expect(result).toEqual({ ok: false, reason: 'EPERM: simulated, rename' })
    expect(state.renames, 'the first try and one per delay').toBe(6)
    expect(existsSync(finalPath)).toBe(false)
  })

  it('a refusal that is not a lock (ENOSPC) is not retried (guard)', async () => {
    state.refuse = { code: 'ENOSPC', times: 1 }
    const result = await install()
    expect(result).toEqual({ ok: false, reason: 'ENOSPC: simulated, rename' })
    expect(state.renames).toBe(1)
  })

  it('control: no refusal, one rename, installed', async () => {
    expect(await install()).toEqual({ ok: true, path: finalPath })
    expect(state.renames).toBe(1)
  })
})
