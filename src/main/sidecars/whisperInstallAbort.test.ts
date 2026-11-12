import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CANCELLED_MESSAGE } from '../../shared/cancel'
import { WHISPER_MODEL_FILENAME } from '../../shared/captions'

/**
 * T-191 (6) — a model download that fails stops downloading.
 *
 * `runInstall` settled the three failures that arrive while the transfer is live (a non-2xx answer, the
 * write stream's error, the response's error) without `request.abort()`, and `settle` clears
 * `activeInstall`, so Cancel could no longer reach the request: the panel said "failed" while the rest of
 * the 141 MB kept coming and a retry opened a second connection. This file runs the REAL
 * `installWhisperModel` against a fake `net.request` (and the real filesystem in a private folder), so
 * the claims are about the request: abort is called once, the chunks stop, the partial is gone.
 *
 * It lives beside `whisperManager.test.ts` rather than in it because the fake `electron` and `node:fs`
 * are file-wide mocks, and that file's other describes run against the real modules.
 */
const state = vi.hoisted(() => ({
  userData: '',
  requests: [] as unknown[],
  streams: [] as unknown[]
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, isPackaged: false },
  net: {
    request: () => {
      const r = new FakeRequest()
      state.requests.push(r)
      return r
    }
  }
}))
// The real write stream, recorded so a case can make the disk fail under it.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const createWriteStream = ((...a: Parameters<typeof actual.createWriteStream>) => {
    const s = actual.createWriteStream(...a)
    state.streams.push(s)
    return s
  }) as typeof actual.createWriteStream
  return { ...actual, createWriteStream, default: { ...actual, createWriteStream } }
})

const CHUNKS = 50

class FakeRequest extends EventEmitter {
  aborts = 0
  delivered = 0
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** How the server answers once `end()` is called. */
  static plan: { status: number; chunks: number; errorAfter?: number } = { status: 200, chunks: CHUNKS }

  abort(): void {
    this.aborts++
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    // Electron emits 'abort' on the request; a second abort of a dead request is a no-op there.
    if (this.aborts === 1) queueMicrotask(() => this.emit('abort'))
  }

  end(): void {
    const plan = FakeRequest.plan
    const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
    response.statusCode = plan.status
    response.headers = { 'content-length': String(plan.chunks * 10) }
    setTimeout(() => {
      this.emit('response', response)
      if (plan.status < 200 || plan.status >= 300) return
      const pump = (): void => {
        if (this.stopped) return
        if (plan.errorAfter !== undefined && this.delivered >= plan.errorAfter) {
          response.emit('error', new Error('socket hang up'))
          return
        }
        if (this.delivered >= plan.chunks) {
          response.emit('end')
          return
        }
        this.delivered++
        response.emit('data', Buffer.alloc(10, 1))
        this.timer = setTimeout(pump, 4)
      }
      pump()
    }, 0)
  }
}

let root = ''
let partial = ''
const progress: Array<{ phase: string; message?: string }> = []

async function loadInstall(): Promise<typeof import('./whisperManager')> {
  return import('./whisperManager')
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'imagii-t191-'))
  state.userData = root
  partial = path.join(root, 'models', `${WHISPER_MODEL_FILENAME}.partial`)
  state.requests.length = 0
  state.streams.length = 0
  progress.length = 0
  FakeRequest.plan = { status: 200, chunks: CHUNKS }
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const req = (): FakeRequest => state.requests[0] as FakeRequest
const run = async (): Promise<{ ok: boolean; reason?: string }> => {
  const m = await loadInstall()
  return m.installWhisperModel((p) => progress.push(p))
}
const failedMessages = (): string[] => progress.filter((p) => p.phase === 'failed').map((p) => p.message ?? '')
/** Let any abort handler and the partial's removal finish. */
const settleAll = (): Promise<void> => new Promise((r) => setTimeout(r, 60))

describe('a failed model download aborts its request (T-191 (6))', () => {
  it('a write-stream error settles as failed, aborts once, stops the chunks, reports one failure and removes the partial', async () => {
    const m = await loadInstall()
    const done = m.installWhisperModel((p) => progress.push(p))
    // Let the first chunks land on the real partial, then make the disk fail under the stream.
    await new Promise((r) => setTimeout(r, 40))
    expect(existsSync(partial)).toBe(true)
    ;(state.streams[0] as WriteStream).destroy(new Error('ENOSPC: no space left on device'))
    const result = await done
    await settleAll()
    expect(result).toEqual({ ok: false, reason: 'ENOSPC: no space left on device' })
    expect(req().aborts).toBe(1)
    expect(req().delivered).toBeLessThan(CHUNKS)
    expect(failedMessages()).toEqual(['ENOSPC: no space left on device'])
    expect(existsSync(partial)).toBe(false)
  })

  it('the QA reproduction: a directory at the partial forces EISDIR and the rest of the file is not pulled', async () => {
    mkdirSync(partial, { recursive: true })
    const result = await run()
    await settleAll()
    expect(result.ok).toBe(false)
    expect(req().aborts).toBe(1)
    expect(req().delivered).toBeLessThan(CHUNKS)
    expect(failedMessages()).toHaveLength(1)
  })

  it('a non-2xx answer settles as failed and aborts once', async () => {
    FakeRequest.plan = { status: 503, chunks: 0 }
    const result = await run()
    await settleAll()
    expect(result).toEqual({ ok: false, reason: 'HTTP 503' })
    expect(req().aborts).toBe(1)
    expect(failedMessages()).toEqual(['Server returned HTTP 503'])
    expect(existsSync(partial)).toBe(false)
  })

  it('a response error settles as failed, aborts once, stops the chunks and removes the partial', async () => {
    FakeRequest.plan = { status: 200, chunks: CHUNKS, errorAfter: 5 }
    const result = await run()
    await settleAll()
    expect(result).toEqual({ ok: false, reason: 'socket hang up' })
    expect(req().aborts).toBe(1)
    expect(req().delivered).toBe(5)
    expect(failedMessages()).toEqual(['socket hang up'])
    expect(existsSync(partial)).toBe(false)
  })

  it('control: a request error is the request already over, so nothing is aborted', async () => {
    const m = await loadInstall()
    const done = m.installWhisperModel((p) => progress.push(p))
    await new Promise((r) => setTimeout(r, 0))
    req().emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    const result = await done
    await settleAll()
    expect(result).toEqual({ ok: false, reason: 'net::ERR_INTERNET_DISCONNECTED' })
    expect(req().aborts).toBe(0)
    expect(failedMessages()).toEqual(['net::ERR_INTERNET_DISCONNECTED'])
  })

  it('control: Cancel aborts once through the cancel handle, reports the cancel once and removes the partial', async () => {
    const m = await loadInstall()
    const done = m.installWhisperModel((p) => progress.push(p))
    await new Promise((r) => setTimeout(r, 40))
    expect(m.cancelWhisperModelInstall()).toBe(true)
    const result = await done
    await settleAll()
    expect(result).toEqual({ ok: false, reason: CANCELLED_MESSAGE })
    expect(req().aborts).toBe(1)
    expect(req().delivered).toBeLessThan(CHUNKS)
    expect(failedMessages()).toEqual(['Download canceled'])
    expect(existsSync(partial)).toBe(false)
  })

  it('control: a download that ends whole but fails verification does not abort (the transfer is over)', async () => {
    // 50 chunks of 10 bytes: far under the model's size floor, so the size check refuses it.
    const result = await run()
    await settleAll()
    expect(result.ok).toBe(false)
    expect(req().delivered).toBe(CHUNKS)
    expect(req().aborts).toBe(0)
    expect(existsSync(partial)).toBe(false)
  })
})
