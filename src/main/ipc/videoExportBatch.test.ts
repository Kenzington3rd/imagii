import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CANCELLED_MESSAGE, isCancelledError } from '../../shared/cancel'
import { userFacingError } from '../../shared/userFacingError'

/**
 * T-98 — a Cancel pressed between two jobs of a batch.
 *
 * `video:exportBatch` runs its jobs one after another. The instant between the
 * end of one and the start of the next is the one place a Cancel has nothing to
 * kill: the finished job's child is gone and the next job's is not spawned yet
 * (its probe comes first), so `cancelAllExportJobs` found an empty registry,
 * returned, and the batch carried on — writing every remaining file the user
 * had just refused. A button cannot be timed to that instant, so the test does
 * not try: it makes the Cancel happen INSIDE the handler's own call that marks
 * the first job complete — `e.sender.send('video:jobComplete')`, which runs
 * after job 1 has finished and before job 2 has begun. That is not "somewhere
 * near the gap", it is the gap.
 *
 * The real handler and the real export runner run; only the child process and
 * the probe are faked (the cancelSentinel.test.ts technique).
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runner sets utf8 on both pipes */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  exitCode: number | null = null
  signals: string[] = []
  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    return true
  }
}
let children: FakeChild[] = []
let probes: string[] = []
let scratch = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {},
  BrowserWindow: {},
  shell: {},
  app: { getPath: () => tmpdir() }
}))
vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = new FakeChild()
    children.push(child)
    return child
  }
}))
vi.mock('../ffmpeg/probe', () => ({
  probeVideo: async (file: string) => {
    probes.push(file)
    return {
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
      bitrate: 0,
      sizeBytes: 0
    }
  }
}))

const { registerVideoIpc } = await import('./video')
const { cancelAllExportJobs } = await import('../ffmpeg/export')

const CLIP = {
  id: 'c1',
  name: 'Clip',
  startSec: 0,
  endSec: 5,
  cropRect: null,
  textOverlays: [],
  selectedPresets: ['youtube' as const]
}

const job = (jobId: string, name: string): Record<string, unknown> => ({
  jobId,
  sourcePath: path.join(tmpdir(), 'in.mp4'),
  outDir: scratch,
  clip: { ...CLIP, name },
  preset: 'youtube',
  outputFilename: `${name}.mp4`
})

/** A sender whose `send` runs `onSend` for each channel it is given. */
function sender(onSend: (channel: string) => void): {
  isDestroyed: () => boolean
  send: (channel: string) => void
} {
  return { isDestroyed: () => false, send: (channel) => onSend(channel) }
}

const runBatch = (jobs: unknown[], onSend: (channel: string) => void): Promise<unknown> => {
  const handler = handlers.get('video:exportBatch')
  if (!handler) throw new Error('video:exportBatch was not registered')
  return handler({ sender: sender(onSend) }, jobs).then(
    (value) => ({ resolved: value }),
    (err: unknown) => err
  )
}

/** Let the batch spawn its next child, finish it, and hand the answer back. */
async function finishNextChild(code = 0): Promise<void> {
  const before = children.length
  await vi.waitFor(() => expect(children.length).toBeGreaterThan(before), { timeout: 3000 })
  children[children.length - 1]?.emit('close', code, null)
}

beforeEach(() => {
  handlers.clear()
  children = []
  probes = []
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-batch-'))
  registerVideoIpc()
  return () => rmSync(scratch, { recursive: true, force: true })
})

describe('video:exportBatch — Cancel between jobs', () => {
  it('the control: with no Cancel, both jobs run and the batch resolves', async () => {
    const outcome = runBatch([job('a', 'one'), job('b', 'two')], () => undefined)
    await finishNextChild()
    await finishNextChild()
    const done = (await outcome) as { resolved: unknown[] }
    expect(done.resolved).toHaveLength(2)
    expect(children).toHaveLength(2)
  })

  it('cancelAll in the instant after job 1 completes: job 2 never starts', async () => {
    const outcome = runBatch([job('a', 'one'), job('b', 'two')], (channel) => {
      // After job 1 has finished, before job 2 has begun: nothing is alive to kill.
      if (channel === 'video:jobComplete') cancelAllExportJobs()
    })
    await finishNextChild()
    const err = await outcome
    expect(isCancelledError(err)).toBe(true)
    expect((err as Error).message).toBe(CANCELLED_MESSAGE)
    await new Promise((resolve) => setTimeout(resolve, 30))
    // One child (job 1's), and job 2 was not even probed.
    expect(children).toHaveLength(1)
    expect(probes).toHaveLength(1)
  })

  it('cancelAll in that instant stops a batch of FIVE at the first, not at the last', async () => {
    const jobs = ['a', 'b', 'c', 'd', 'e'].map((id) => job(id, `clip-${id}`))
    const outcome = runBatch(jobs, (channel) => {
      if (channel === 'video:jobComplete') cancelAllExportJobs()
    })
    await finishNextChild()
    expect(isCancelledError(await outcome)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(children).toHaveLength(1)
  })

  it('a stale Cancel — pressed with nothing running — does not reach the batch that starts after it', async () => {
    // (T-108: this was a by-name cancel aimed at job 2 before it began; that cancel had no caller
    // and is gone. The property it pinned — a click spent on nothing marks nothing — is the
    // batch's Cancel's too: runs end with their jobs, so a latch cannot outlive its run.)
    cancelAllExportJobs()
    const outcome = runBatch([job('a', 'one'), job('b', 'two')], () => undefined)
    await finishNextChild()
    await finishNextChild()
    const done = (await outcome) as { resolved: unknown[] }
    expect(done.resolved).toHaveLength(2)
  })

  it('the next batch is not killed by the Cancel that stopped this one', async () => {
    const first = runBatch([job('a', 'one'), job('b', 'two')], (channel) => {
      if (channel === 'video:jobComplete') cancelAllExportJobs()
    })
    await finishNextChild()
    expect(isCancelledError(await first)).toBe(true)

    const second = runBatch([job('c', 'three')], () => undefined)
    await finishNextChild()
    const done = (await second) as { resolved: unknown[] }
    expect(done.resolved).toHaveLength(1)
    expect(children).toHaveLength(2)
  })

  it('cancelAll during job 2\'s probe: the probe ends at once and no child is spawned', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    // Hold the SECOND probe only (the first job runs normally).
    const probeModule = await import('../ffmpeg/probe')
    const real = probeModule.probeVideo
    let calls = 0
    vi.spyOn(probeModule, 'probeVideo').mockImplementation(async (file: string) => {
      calls += 1
      if (calls === 2) await held
      return real(file)
    })
    try {
      const outcome = runBatch([job('a', 'one'), job('b', 'two')], () => undefined)
      await finishNextChild()
      await vi.waitFor(() => expect(calls).toBe(2), { timeout: 3000 })
      cancelAllExportJobs()
      const err = await outcome
      expect(isCancelledError(err)).toBe(true)
      release()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(children).toHaveLength(1)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

/**
 * T-106 — `video:exportBatch` never validated a clip's `cropRect`, the one field
 * of a clip that Compile and the GIF already gated: it becomes `crop=` arguments
 * in the filter graph, and a project file is a file a person can edit. A damaged
 * crop is refused for the WHOLE batch before the first job's probe, in a sentence
 * `userFacingError` stands behind (the validator's own message is a path into the
 * payload, which it refuses to show).
 */
describe('video:exportBatch — a damaged clip crop (T-106)', () => {
  const SENTENCE = "One of this project's clips has a damaged crop — redraw it and try again."
  const GOOD_CROP = { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }
  const withCrop = (jobId: string, name: string, cropRect: unknown): Record<string, unknown> => {
    const base = job(jobId, name)
    return { ...base, clip: { ...(base.clip as object), cropRect } }
  }

  const BAD_CROPS: Array<[string, unknown]> = [
    ['a string', '0,0,1,1'],
    ['an array', [0, 0, 1, 1]],
    ['a missing field', { x: 0, y: 0, w: 0.5 }],
    ['a numeric string', { ...GOOD_CROP, x: '0.25' }],
    ['NaN', { ...GOOD_CROP, w: Number.NaN }],
    ['no area', { ...GOOD_CROP, h: 0 }],
    ['a negative origin', { ...GOOD_CROP, y: -0.2 }],
    ['a thousand-times-the-frame width', { ...GOOD_CROP, w: 1000 }],
    ['a rectangle past the right edge', { x: 0.6, y: 0, w: 0.6, h: 1 }]
  ]

  it.each(BAD_CROPS)('refuses %s with one plain sentence, before any job starts', async (_label, crop) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const err = await runBatch([withCrop('a', 'one', crop)], () => undefined)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe(SENTENCE)
      expect(probes).toEqual([])
      expect(children).toHaveLength(0)
      // The path-shaped detail is not lost: it is in main's console.
      expect(String(logged.mock.calls[0]?.[1])).toMatch(/jobs\[0\]\.clip\.cropRect/)
    } finally {
      logged.mockRestore()
    }
  })

  it('refuses the whole batch for a bad crop on a later job, so an earlier good job never starts', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const err = await runBatch(
        [withCrop('a', 'one', GOOD_CROP), withCrop('b', 'two', { ...GOOD_CROP, w: Number.NaN })],
        () => undefined
      )
      expect((err as Error).message).toBe(SENTENCE)
      expect(probes).toEqual([])
      expect(children).toHaveLength(0)
      expect(String(logged.mock.calls[0]?.[1])).toMatch(/jobs\[1\]\.clip\.cropRect/)
    } finally {
      logged.mockRestore()
    }
  })

  it('reaches the person as that sentence alone — not "Export failed." with a cause, and not a channel name', () => {
    // Electron wraps whatever a handler throws before the renderer sees it.
    const wrapped = new Error(`Error invoking remote method 'video:exportBatch': Error: ${SENTENCE}`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(wrapped, 'Export failed.')).toEqual({ cancelled: false, message: SENTENCE })
    } finally {
      logged.mockRestore()
    }
  })

  it('the control: a good crop, no crop and an absent crop all reach the runner', async () => {
    const outcome = runBatch(
      [withCrop('a', 'one', GOOD_CROP), withCrop('b', 'two', null), job('c', 'three')],
      () => undefined
    )
    await finishNextChild()
    await finishNextChild()
    await finishNextChild()
    const done = (await outcome) as { resolved: unknown[] }
    expect(done.resolved).toHaveLength(3)
    expect(children).toHaveLength(3)
  })
})

/**
 * T-111 — the batch checked a clip's crop and its overlays and nothing else, so
 * the rest of the recipe went into the filter graph as whatever the project file
 * said. A speed of 1e-6 (`setpts=PTS/0.0000`, an `atempo` chain ending at the
 * end of time) wrote a 261-byte file and reported success; a temperature of 5 is
 * outside what `colorbalance` takes. The whole recipe is refused for the whole
 * batch, before the first probe, in a sentence `userFacingError` stands behind.
 * (T-110(d) decided: validate.)
 */
describe('video:exportBatch — a damaged clip recipe (T-111)', () => {
  const SENTENCE =
    "One of this project's clips has a setting imagii can't use — check its speed, color and text, then try again."
  const GRADE = { brightness: 0.1, contrast: 1.2, saturation: 0.8, temperature: 0.5 }
  const OVERLAY = {
    id: 'o1',
    text: "Let's go: 50% off",
    font: 'Arial',
    sizePx: 48,
    colorHex: '#ff3b30',
    x: 0.1,
    y: 0.8,
    startSec: 1,
    endSec: 2
  }
  const withClip = (jobId: string, name: string, fields: Record<string, unknown>): Record<string, unknown> => {
    const base = job(jobId, name)
    return { ...base, clip: { ...(base.clip as object), ...fields } }
  }

  const BAD: Array<[string, Record<string, unknown>, RegExp]> = [
    ['a speed of 1e-6 (the 261-byte "success")', { speedMultiplier: 1e-6 }, /jobs\[0\]\.clip\.speedMultiplier/],
    ['a speed of zero', { speedMultiplier: 0 }, /speedMultiplier/],
    ['a negative speed', { speedMultiplier: -2 }, /speedMultiplier/],
    ['a speed past what the graph can chain', { speedMultiplier: 1000 }, /speedMultiplier/],
    ['a speed as a string', { speedMultiplier: '2' }, /speedMultiplier/],
    ['a temperature of 5', { colorGrade: { ...GRADE, temperature: 5 } }, /colorGrade\.temperature/],
    ['a grade with NaN in it', { colorGrade: { ...GRADE, contrast: Number.NaN } }, /colorGrade\.contrast/],
    ['a brightness past what eq takes', { colorGrade: { ...GRADE, brightness: 3 } }, /colorGrade\.brightness/],
    ['an effect flag that is not a boolean', { autoZoom: 'on' }, /autoZoom/],
    ['an overlay with a filter injection in its color', { textOverlays: [{ ...OVERLAY, colorHex: 'red,movie=x' }] }, /textOverlays\[0\] malformed/],
    ['overlays that are not a list', { textOverlays: { text: 'GG' } }, /textOverlays must be an array/]
  ]

  it.each(BAD)('refuses %s with one plain sentence, before any job starts', async (_label, fields, detail) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const err = await runBatch([withClip('a', 'one', fields)], () => undefined)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toBe(SENTENCE)
      expect(probes).toEqual([])
      expect(children).toHaveLength(0)
      // The path-shaped detail is not lost: it is in main's console.
      expect(String(logged.mock.calls[0]?.[1])).toMatch(detail)
    } finally {
      logged.mockRestore()
    }
  })

  it('refuses the whole batch for a bad recipe on a later job, so an earlier good job never starts', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const err = await runBatch(
        [withClip('a', 'one', { speedMultiplier: 2 }), withClip('b', 'two', { speedMultiplier: 1e-6 })],
        () => undefined
      )
      expect((err as Error).message).toBe(SENTENCE)
      expect(probes).toEqual([])
      expect(children).toHaveLength(0)
      expect(String(logged.mock.calls[0]?.[1])).toMatch(/jobs\[1\]\.clip\.speedMultiplier/)
    } finally {
      logged.mockRestore()
    }
  })

  it('a damaged crop still speaks its own sentence, not this one', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const err = await runBatch([withClip('a', 'one', { cropRect: { x: 0, y: 0, w: 1000, h: 1 } })], () => undefined)
      expect((err as Error).message).toBe(
        "One of this project's clips has a damaged crop — redraw it and try again."
      )
    } finally {
      logged.mockRestore()
    }
  })

  it('reaches the person as that sentence alone — not "Export failed." with a cause, and not a channel name', () => {
    const wrapped = new Error(`Error invoking remote method 'video:exportBatch': Error: ${SENTENCE}`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(wrapped, 'Export failed.')).toEqual({ cancelled: false, message: SENTENCE })
    } finally {
      logged.mockRestore()
    }
  })

  it('the control: a whole good recipe, an absent recipe and the slider\'s ends all reach the runner', async () => {
    const outcome = runBatch(
      [
        withClip('a', 'one', {
          speedMultiplier: 2,
          colorGrade: GRADE,
          autoZoom: true,
          hypeShake: false,
          textOverlays: [OVERLAY]
        }),
        job('b', 'two'),
        withClip('c', 'three', { speedMultiplier: 0.25 }),
        withClip('d', 'four', { speedMultiplier: 4, colorGrade: { brightness: -0.5, contrast: 0.5, saturation: 0, temperature: -1 } })
      ],
      () => undefined
    )
    for (let i = 0; i < 4; i++) await finishNextChild()
    const done = (await outcome) as { resolved: unknown[] }
    expect(done.resolved).toHaveLength(4)
    expect(children).toHaveLength(4)
  })
})

/**
 * T-111 — one batch at a time. Two surfaces start `video:exportBatch` (the Export
 * panel and Clip Kit) and nothing between them stopped a second from starting under
 * the first: the two batches ran together — two encodes fighting for the CPU, their
 * progress events interleaved on one channel — and a Cancel of either stopped both.
 * The second is now refused in a sentence the person can act on, and the first is
 * not disturbed by the attempt.
 */
describe('video:exportBatch — a second batch while one runs (T-111)', () => {
  const SENTENCE = 'An export is already running. Wait for it to finish, or cancel it, then try again.'

  it('refuses the second batch with one plain sentence: no probe, no child, and the first is untouched', async () => {
    const first = runBatch([job('a', 'one')], () => undefined)
    await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 3000 })

    const second = await runBatch([job('b', 'two')], () => undefined)
    expect(second).toBeInstanceOf(Error)
    expect((second as Error).message).toBe(SENTENCE)
    // The second never reached a probe or a child; the first is still the only one alive.
    expect(probes).toEqual([path.join(tmpdir(), 'in.mp4')])
    expect(children).toHaveLength(1)

    // And the refusal did not cancel the first: it finishes as a success.
    children[0]?.emit('close', 0, null)
    const done = (await first) as { resolved: unknown[] }
    expect(done.resolved).toHaveLength(1)
  })

  it('does not interleave two batches\' progress: the refused batch sends nothing', async () => {
    const sent: string[] = []
    const first = runBatch([job('a', 'one')], (channel) => sent.push(`first:${channel}`))
    await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 3000 })
    await runBatch([job('b', 'two')], (channel) => sent.push(`second:${channel}`))
    children[0]?.emit('close', 0, null)
    await first
    expect(sent.filter((s) => s.startsWith('second:'))).toEqual([])
    expect(sent).toContain('first:video:jobComplete')
  })

  it('refuses a malformed second batch the same way (the gate is the first thing asked)', async () => {
    const first = runBatch([job('a', 'one')], () => undefined)
    await vi.waitFor(() => expect(children).toHaveLength(1), { timeout: 3000 })
    const err = await runBatch([], () => undefined)
    expect((err as Error).message).toBe(SENTENCE)
    children[0]?.emit('close', 0, null)
    await first
  })

  it('reaches the person as that sentence alone, not "Export failed." and not a channel name', () => {
    const wrapped = new Error(`Error invoking remote method 'video:exportBatch': Error: ${SENTENCE}`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(wrapped, 'Export failed.')).toEqual({ cancelled: false, message: SENTENCE })
    } finally {
      logged.mockRestore()
    }
  })

  it('the gate opens when the batch finishes: the next one runs', async () => {
    const first = runBatch([job('a', 'one')], () => undefined)
    await finishNextChild()
    await first
    const second = runBatch([job('b', 'two')], () => undefined)
    await finishNextChild()
    const done = (await second) as { resolved: unknown[] }
    expect(done.resolved).toHaveLength(1)
  })

  it('the gate opens when the batch is canceled: the next one runs', async () => {
    const first = runBatch([job('a', 'one'), job('b', 'two')], (channel) => {
      if (channel === 'video:jobComplete') cancelAllExportJobs()
    })
    await finishNextChild()
    expect(isCancelledError(await first)).toBe(true)
    const second = runBatch([job('c', 'three')], () => undefined)
    await finishNextChild()
    expect(((await second) as { resolved: unknown[] }).resolved).toHaveLength(1)
  })

  it('the gate opens when a job FAILS: a failed batch does not wedge the next', async () => {
    const first = runBatch([job('a', 'one')], () => undefined)
    await finishNextChild(1)
    expect((await first) as Error).toBeInstanceOf(Error)
    const second = runBatch([job('b', 'two')], () => undefined)
    await finishNextChild()
    expect(((await second) as { resolved: unknown[] }).resolved).toHaveLength(1)
  })

  it('a batch refused for a damaged clip does not hold the gate', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const base = job('a', 'one')
      const bad = { ...base, clip: { ...(base.clip as object), speedMultiplier: 1e-6 } }
      expect(((await runBatch([bad], () => undefined)) as Error).message).toMatch(/damaged|can't use/)
    } finally {
      logged.mockRestore()
    }
    const next = runBatch([job('b', 'two')], () => undefined)
    await finishNextChild()
    expect(((await next) as { resolved: unknown[] }).resolved).toHaveLength(1)
  })
})
