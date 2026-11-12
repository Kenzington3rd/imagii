import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
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
  streams: [] as unknown[],
  /** T-192 (6): when set, the product's unlink of the .partial waits for it (one case's gate; null everywhere else). */
  unlinkGate: null as Promise<void> | null,
  /** T-192 (6): when set, the next write stream's open() waits for it (one case's gate; null everywhere else). */
  openGate: null as Promise<void> | null
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
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const unlink = (async (p: Parameters<typeof actual.unlink>[0]) => {
    if (state.unlinkGate && String(p).endsWith('.partial')) await state.unlinkGate
    return actual.unlink(p)
  }) as typeof actual.unlink
  return { ...actual, unlink, default: { ...actual, unlink } }
})
// The real write stream, recorded so a case can make the disk fail under it.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const createWriteStream = ((...a: Parameters<typeof actual.createWriteStream>) => {
    const gate = state.openGate
    const opts = typeof a[1] === 'object' && a[1] !== null ? a[1] : {}
    const s = gate
      ? actual.createWriteStream(a[0], {
          ...opts,
          fs: {
            open: (p: string, flags: string, mode: number, cb: (e: NodeJS.ErrnoException | null, fd: number) => void) =>
              void gate.then(() => actual.open(p, flags, mode, cb)),
            close: actual.close,
            write: actual.write,
            writev: actual.writev
          }
        })
      : actual.createWriteStream(...a)
    state.streams.push(s)
    return s
  }) as typeof actual.createWriteStream
  return { ...actual, createWriteStream, default: { ...actual, createWriteStream } }
})

const CHUNKS = 50

class FakeRequest extends EventEmitter {
  aborts = 0
  delivered = 0
  response: (EventEmitter & { statusCode: number; headers: Record<string, string> }) | null = null
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private responseTimer: ReturnType<typeof setTimeout> | null = null
  /** How the server answers once `end()` is called. */
  static plan: { status: number; chunks: number; errorAfter?: number } = { status: 200, chunks: CHUNKS }

  constructor() {
    super()
    // T-192 (6), the expediter at merge: a request that has emitted 'error' is over in Electron too - no response or data follows it.
    // Without this a response still pending when a case emits the error arrived late under load, opened a write stream after the
    // cleanup and left a partial behind (one run in thirty under four CPU burners).
    this.on('error', () => {
      this.stopped = true
      if (this.timer) clearTimeout(this.timer)
      if (this.responseTimer) clearTimeout(this.responseTimer)
    })
  }

  abort(): void {
    this.aborts++
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    // T-192 (6): Electron's ClientRequest emits nothing after abort() but 'abort' (probed on a loopback server in sweep 79), so a response
    // still pending when the abort lands is never delivered. Without this the fake emitted it late under load, the product opened a write
    // stream for it, and its failure reported a second message after "Download canceled".
    if (this.responseTimer) clearTimeout(this.responseTimer)
    // Electron emits 'abort' on the request; a second abort of a dead request is a no-op there.
    if (this.aborts === 1) queueMicrotask(() => this.emit('abort'))
  }

  end(): void {
    const plan = FakeRequest.plan
    const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
    response.statusCode = plan.status
    this.response = response
    response.headers = { 'content-length': String(plan.chunks * 10) }
    this.responseTimer = setTimeout(() => {
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
  state.unlinkGate = null
  state.openGate = null
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
/**
 * T-192 (6): wait on the condition a case means, never on a clock. A fixed sleep standing in for "the request is live" or "the handlers have
 * finished" is a race under load. The ceiling is generous so a real hang still fails, with the named condition.
 */
async function until(what: string, cond: () => boolean, ceilingMs = 5000): Promise<void> {
  const end = Date.now() + ceilingMs
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out after ${ceilingMs} ms waiting for: ${what}`)
    await new Promise((r) => setTimeout(r, 2))
  }
}
const partialIsFile = (): boolean => statSync(partial, { throwIfNoEntry: false })?.isFile() === true
/** The failure has been reported and the partial file is gone (a directory standing at the partial is not a file), then one turn for the abort. */
async function settleAll(): Promise<void> {
  await until('a failure reported and the partial file removed', () => progress.some((p) => p.phase === 'failed') && !partialIsFile())
  await new Promise((r) => setTimeout(r, 0))
}

describe('a failed model download aborts its request (T-191 (6))', () => {
  it('a write-stream error settles as failed, aborts once, stops the chunks, reports one failure and removes the partial', async () => {
    const m = await loadInstall()
    const done = m.installWhisperModel((p) => progress.push(p))
    // Let the first chunks land on the real partial, then make the disk fail under the stream.
    await until('chunks on the real partial', () => ((state.requests[0] as FakeRequest | undefined)?.delivered ?? 0) >= 3 && existsSync(partial))
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
    await until('the request is made', () => state.requests.length > 0)
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
    await until('the transfer is live (a chunk delivered)', () => ((state.requests[0] as FakeRequest | undefined)?.delivered ?? 0) > 0)
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

/**
 * T-192 (6): the REAL race behind the flake. Node emits 'error' (ERR_STREAM_DESTROYED) on a write stream when destroy() lands while a write is in
 * flight; the install destroys its own stream on every failure path, so the stream's listener reported that as a second failure (or settled a Cancel
 * with the raw Node text). Deterministic: wait for the real fd to open, queue a 1 MiB write on the install's own stream, and end the transfer in the
 * same turn, so a write is in flight at the destroy.
 */
describe('ending a transfer with a write in flight reports only the end that was meant (T-192 (6))', () => {
  async function startWithWriteInFlight(): Promise<{ m: typeof import('./whisperManager'); done: Promise<{ ok: true; path: string } | { ok: false; reason: string }>; stream: WriteStream }> {
    const m = await loadInstall()
    const done = m.installWhisperModel((p) => progress.push(p))
    await until(
      'the install\'s stream has opened its fd and a chunk is delivered',
      () => ((state.requests[0] as FakeRequest | undefined)?.delivered ?? 0) >= 1 && (state.streams[0] as WriteStream | undefined)?.pending === false
    )
    const stream = state.streams[0] as WriteStream
    stream.write(Buffer.alloc(1 << 20, 1))
    return { m, done, stream }
  }
  const closed = (s: WriteStream): Promise<void> => until('the write stream closed', () => s.closed)

  it('Cancel with a write in flight is exactly "Download canceled", once', async () => {
    const { m, done, stream } = await startWithWriteInFlight()
    expect(m.cancelWhisperModelInstall()).toBe(true)
    const result = await done
    await settleAll()
    await closed(stream)
    expect(result).toEqual({ ok: false, reason: CANCELLED_MESSAGE })
    expect(failedMessages()).toEqual(['Download canceled'])
    expect(req().aborts).toBe(1)
    expect(existsSync(partial)).toBe(false)
  })

  it('a response error with a write in flight reports exactly the response\'s error, once', async () => {
    const { done, stream } = await startWithWriteInFlight()
    req().response?.emit('error', new Error('socket hang up'))
    const result = await done
    await settleAll()
    await closed(stream)
    expect(result).toEqual({ ok: false, reason: 'socket hang up' })
    expect(failedMessages()).toEqual(['socket hang up'])
    expect(req().aborts).toBe(1)
  })

  it('control: a genuine write failure with a write in flight still reports once, with its own text', async () => {
    const { done, stream } = await startWithWriteInFlight()
    stream.destroy(new Error('ENOSPC: no space left on device'))
    const result = await done
    await settleAll()
    await closed(stream)
    expect(result).toEqual({ ok: false, reason: 'ENOSPC: no space left on device' })
    expect(failedMessages()).toEqual(['ENOSPC: no space left on device'])
    expect(req().aborts).toBe(1)
  })
  it('Cancel whose cleanup is still running when the stream\'s own error arrives is still exactly "Download canceled", once', async () => {
    // The other order: the destroy's ERR_STREAM_DESTROYED lands while the cancel's partial removal is still pending, before its settle.
    // Only `me.cancelled` covers it (`settled` is false then): hold the unlink until the stream's error has fired.
    let release: () => void = () => {}
    state.unlinkGate = new Promise<void>((r) => (release = r))
    try {
      const { m, done, stream } = await startWithWriteInFlight()
      let errored = false
      stream.once('error', () => (errored = true))
      expect(m.cancelWhisperModelInstall()).toBe(true)
      await until('the stream\'s own error fired while the partial removal is held', () => errored)
      release()
      const result = await done
      await settleAll()
      await closed(stream)
      expect(result).toEqual({ ok: false, reason: CANCELLED_MESSAGE })
      expect(failedMessages()).toEqual(['Download canceled'])
    } finally {
      release()
    }
  })
  it('a Cancel while the stream\'s open() is still pending leaves no partial behind', async () => {
    // The race the cleanup had: destroy before the fd opens, existsSync finds nothing, and the open then creates the file. Held open, no clock.
    let release: () => void = () => {}
    state.openGate = new Promise<void>((r) => (release = r))
    try {
      const m = await loadInstall()
      const done = m.installWhisperModel((p) => progress.push(p))
      await until('a chunk delivered and the stream created with its open held', () => ((state.requests[0] as FakeRequest | undefined)?.delivered ?? 0) >= 1 && state.streams.length > 0)
      const stream = state.streams[0] as WriteStream
      expect(m.cancelWhisperModelInstall()).toBe(true)
      await until('the request aborted', () => req().aborts === 1)
      await new Promise((r) => setTimeout(r, 0))
      release()
      const result = await done
      await closed(stream)
      expect(result).toEqual({ ok: false, reason: CANCELLED_MESSAGE })
      expect(failedMessages()).toEqual(['Download canceled'])
      expect(existsSync(partial)).toBe(false)
    } finally {
      release()
    }
  })
})
