import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC, DEFAULT_DUCK_PARAMS } from '../../shared/audio'
import type { ChainSpec } from '../../shared/audio'
import { userFacingError } from '../../shared/userFacingError'

/**
 * T-111 — the numbers of a chain that reach the filter graph.
 *
 * `secondaryTrack.gainDb` is printed into `volume=${gainDb}dB` and the ducking
 * numbers into `sidechaincompress=ratio=...:attack=...:release=...`. The IPC gate
 * checked the second track's FILE and nothing else, so a hand-edited project
 * carrying `gainDb: "0dB,ametadata=mode=print:file=x"` put a second filter into
 * the graph — and `ametadata` writes the file it is told to. The real handlers
 * and the real audio runner run here; only the child process and the probe are
 * faked, so the evidence is the command ffmpeg would have been given.
 *
 * (An injection is never run through real ffmpeg: the first block shows the
 * command text and stops there.)
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()

class FakePipe extends EventEmitter {
  setEncoding(): void {
    /* the runner sets utf8 */
  }
}
class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  args: string[] = []
  kill(): boolean {
    return true
  }
}
let children: FakeChild[] = []

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
  spawn: (_command: string, args: string[] = []) => {
    const child = new FakeChild()
    child.args = args
    children.push(child)
    // The fake finishes at once, as a render that succeeded.
    setImmediate(() => child.emit('close', 0, null))
    return child
  }
}))
vi.mock('../audio/probe', () => ({
  probeAudio: async () => ({
    duration: 8,
    sampleRate: 48000,
    channels: 2,
    codec: 'pcm_s16le',
    bitrate: 0,
    format: 'wav',
    sizeBytes: 0
  })
}))

const { registerAudioIpc } = await import('./audio')
const { runAudioExport } = await import('../audio/process')

const INJECTION = '0dB,ametadata=mode=print:file=x'
const SOURCE = path.join(tmpdir(), 'voice.wav')
const BED = path.join(tmpdir(), 'bed.wav')

const track = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  filePath: BED,
  fileName: 'bed.wav',
  role: 'music',
  gainDb: 0,
  duckUnderPrimary: false,
  ...fields
})
const chainWith = (secondary: Record<string, unknown> | null, rest: Record<string, unknown> = {}): ChainSpec =>
  ({ ...DEFAULT_CHAIN_SPEC, secondaryTrack: secondary, ...rest }) as unknown as ChainSpec
const exportSpec = (chain: ChainSpec): Record<string, unknown> => ({
  jobId: 'aud1',
  sourcePath: SOURCE,
  outputPath: path.join(tmpdir(), 'out.wav'),
  chain,
  format: 'wav'
})

// async so a handler that throws synchronously (savePreset) still reaches the test as a
// rejection, the way Electron hands it to the renderer.
async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`${channel} was not registered`)
  return h({ sender: { isDestroyed: () => false, send: vi.fn() } }, ...args)
}
const filterGraphOf = (child: FakeChild | undefined): string => {
  const at = child?.args.indexOf('-filter_complex') ?? -1
  return at >= 0 ? (child?.args[at + 1] ?? '') : ''
}

beforeEach(() => {
  handlers.clear()
  children = []
  registerAudioIpc()
})

describe('the runner trusts what the gate hands it (the reason the gate matters)', () => {
  it('embeds a string-typed gainDb into the filter graph verbatim, as a second filter', async () => {
    // Straight to the runner, past the gate: this is the command the HEAD handler produced.
    await runAudioExport(
      {
        jobId: 'direct',
        sourcePath: SOURCE,
        outputPath: path.join(tmpdir(), 'direct.wav'),
        chain: chainWith(track({ gainDb: INJECTION }) as never),
        format: 'wav'
      },
      () => undefined
    )
    const graph = filterGraphOf(children[0])
    expect(graph).toContain(`volume=${INJECTION}dB`)
    expect(graph).toContain('ametadata=mode=print:file=x')
  })
})

describe('audio:export and audio:mux refuse a second track whose numbers are not numbers (T-111)', () => {
  const SENTENCE = "The second track has a setting imagii can't use — check its gain and ducking, then try again."

  const BAD: Array<[string, Record<string, unknown>, RegExp]> = [
    ['a filter-syntax string for the gain', { gainDb: INJECTION }, /gainDb/],
    ['a numeric string for the gain', { gainDb: '3' }, /gainDb/],
    ['NaN for the gain', { gainDb: Number.NaN }, /gainDb/],
    ['Infinity for the gain', { gainDb: Number.POSITIVE_INFINITY }, /gainDb/],
    ['a gain past +12 dB', { gainDb: 13 }, /gainDb/],
    ['a gain below -60 dB', { gainDb: -61 }, /gainDb/],
    ['no gain at all', { gainDb: undefined }, /gainDb/],
    ['a ratio that is a string', { duckParams: { ...DEFAULT_DUCK_PARAMS, ratio: '8:attack=1' } }, /duckParams\.ratio/],
    ['a ratio of 0', { duckParams: { ...DEFAULT_DUCK_PARAMS, ratio: 0 } }, /duckParams\.ratio/],
    ['a ratio past 20', { duckParams: { ...DEFAULT_DUCK_PARAMS, ratio: 21 } }, /duckParams\.ratio/],
    ['an attack of 0 ms', { duckParams: { ...DEFAULT_DUCK_PARAMS, attackMs: 0 } }, /duckParams\.attackMs/],
    ['an attack that is a filter', { duckParams: { ...DEFAULT_DUCK_PARAMS, attackMs: '1[x];movie=y' } }, /duckParams\.attackMs/],
    ['a release past 2000 ms', { duckParams: { ...DEFAULT_DUCK_PARAMS, releaseMs: 2001 } }, /duckParams\.releaseMs/],
    ['a release of NaN', { duckParams: { ...DEFAULT_DUCK_PARAMS, releaseMs: Number.NaN } }, /duckParams\.releaseMs/],
    ['a threshold above 0 dBFS', { duckParams: { ...DEFAULT_DUCK_PARAMS, thresholdDb: 6 } }, /duckParams\.thresholdDb/],
    ['ducking numbers with one missing', { duckParams: { thresholdDb: -26, ratio: 8, attackMs: 20 } }, /duckParams\.releaseMs/],
    ['ducking that is not an object', { duckParams: 'strong' }, /duckParams/]
  ]

  for (const channel of ['audio:export', 'audio:mux'] as const) {
    it.each(BAD)(`${channel} refuses %s in one plain sentence, before anything is spawned`, async (_label, fields, detail) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const spec =
          channel === 'audio:export'
            ? exportSpec(chainWith(track(fields) as never))
            : {
                jobId: 'aud2',
                videoPath: path.join(tmpdir(), 'v.mp4'),
                sourcePath: SOURCE,
                outputPath: path.join(tmpdir(), 'v-out.mp4'),
                chain: chainWith(track(fields) as never)
              }
        const err = await call(channel, spec).then(
          () => null,
          (e: unknown) => e
        )
        expect(err, 'the handler rejected').toBeInstanceOf(Error)
        expect((err as Error).message).toBe(SENTENCE)
        expect(children, 'no ffmpeg was spawned').toHaveLength(0)
        // The path-shaped detail is not lost: it is in main's console.
        expect(String(logged.mock.calls[0]?.[0])).toMatch(detail)
      } finally {
        logged.mockRestore()
      }
    })
  }

  it('reaches the person as that sentence alone, not "Export failed." and not a channel name', () => {
    const wrapped = new Error(`Error invoking remote method 'audio:export': Error: ${SENTENCE}`)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(wrapped, 'Export failed.')).toEqual({ cancelled: false, message: SENTENCE })
    } finally {
      logged.mockRestore()
    }
  })

  it('refuses a saved preset the same way, so a bad chain cannot be stored for later', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(call('audio:savePreset', 'x', chainWith(track({ gainDb: INJECTION }) as never))).rejects.toThrow(SENTENCE)
    } finally {
      logged.mockRestore()
    }
  })

  it('the controls: the slider ends, the defaults, an absent duck and no second track all reach the runner', async () => {
    const good: Array<Record<string, unknown> | null> = [
      track({ gainDb: -24 }),
      track({ gainDb: 12 }),
      track({ gainDb: -60 }),
      track({ duckUnderPrimary: true, duckParams: DEFAULT_DUCK_PARAMS }),
      track({ duckUnderPrimary: true, duckParams: { thresholdDb: -60, ratio: 1, attackMs: 1, releaseMs: 50 } }),
      track({ duckUnderPrimary: true, duckParams: { thresholdDb: 0, ratio: 20, attackMs: 200, releaseMs: 2000 } }),
      track({ duckParams: null }),
      null
    ]
    for (const secondary of good) {
      await expect(call('audio:export', exportSpec(chainWith(secondary as never)))).resolves.toBeDefined()
    }
    expect(children).toHaveLength(good.length)
  })
})

describe('the loudness target is loudnorm\'s own range, -70 to -5 (T-111)', () => {
  const SENTENCE = 'The loudness target has to be between -70 and -5 LUFS. Change it and try again.'

  it.each([-3, -4.9, 0, 6, -70.5, -71, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s in one plain sentence, before anything is spawned',
    async (target) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const err = await call('audio:export', exportSpec(chainWith(null, { loudnorm: true, loudnormTargetLufs: target }))).then(
          () => null,
          (e: unknown) => e
        )
        expect((err as Error | null)?.message).toBe(SENTENCE)
        expect(children).toHaveLength(0)
      } finally {
        logged.mockRestore()
      }
    }
  )

  it.each(['-16', null, undefined])('refuses a target that is not a number (%j)', async (target) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(
        call('audio:export', exportSpec(chainWith(null, { loudnormTargetLufs: target })))
      ).rejects.toThrow(SENTENCE)
    } finally {
      logged.mockRestore()
    }
  })

  it.each([-70, -23, -16, -14, -9, -5])('accepts %s, the edges and the presets', async (target) => {
    await expect(
      call('audio:export', exportSpec(chainWith(null, { loudnormTargetLufs: target })))
    ).resolves.toBeDefined()
  })
})

// T-113 (3): the gate is the validators', and the validators throw in every environment.
// `chain.gainDb` is printed into `volume=${gainDb}dB`; under NODE_ENV=production the old
// `assertRange` logged and returned, so the same string that is refused in dev reached the
// filter graph. A path with `..` was the same story through `assertSafeAbsolutePath`.
describe('the chain gate refuses under NODE_ENV=production too (T-113)', () => {
  const prevEnv = process.env.NODE_ENV
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })
  afterEach(() => {
    process.env.NODE_ENV = prevEnv
  })

  it('a string gainDb is refused, and nothing is spawned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(call('audio:export', exportSpec(chainWith(null, { gainDb: INJECTION })))).rejects.toThrow(/chain\.gainDb/)
      expect(children, 'no ffmpeg was spawned').toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('a gainDb out of range is refused', async () => {
    await expect(call('audio:export', exportSpec(chainWith(null, { gainDb: 99 })))).rejects.toThrow(/chain\.gainDb/)
    expect(children).toHaveLength(0)
  })

  it('a second track whose file path climbs out of its folder is refused', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(
        call('audio:export', exportSpec(chainWith(track({ filePath: '/home/user/../../etc/passwd' }) as never)))
      ).rejects.toThrow(/secondaryTrack\.filePath/)
      expect(children).toHaveLength(0)
    } finally {
      logged.mockRestore()
    }
  })

  it('a good chain still goes through', async () => {
    await expect(call('audio:export', exportSpec(chainWith(null, { gainDb: 3 })))).resolves.toBeDefined()
    expect(children).toHaveLength(1)
  })
})

// T-120 (13): `validateProject` says "main checks every value it prints into a filter graph at export", and
// two kinds of number were not checked. Each cut's two times are printed into `between(t,start,end)` (a
// string reaches `toFixed` and throws), and the custom noise reduction's two numbers into
// `afftdn=nf=...:nr=...`: a hand-edited `denoise: 'parametric', denoiseParams: {}` made `nf=NaN`, which
// ffmpeg refuses mid-export, after the person had waited through the first pass.
describe('the chain gate refuses the numbers a cut and the custom noise reduction print (T-120)', () => {
  const CUT_SENTENCE =
    "One of the cuts has a start or end imagii can't use. Click its mark to put it back, then cut that part again."
  const DENOISE_SENTENCE =
    "The custom noise reduction has a setting imagii can't use — move its Noise floor and Reduction sliders, then try again."

  it('the runner would have printed NaN into the graph (the reason the gate matters)', async () => {
    await runAudioExport(
      {
        jobId: 'direct2',
        sourcePath: SOURCE,
        outputPath: path.join(tmpdir(), 'direct2.wav'),
        chain: chainWith(null, { denoise: 'parametric', denoiseParams: {} }),
        format: 'wav'
      },
      () => undefined
    )
    const args = children[0]?.args ?? []
    expect(args.join(' ')).toContain('afftdn=nf=NaN')
  })

  const BAD_CUTS: Array<[string, unknown]> = [
    ['a start that is a string', { startSec: '1', endSec: 2 }],
    ['an end that is a string', { startSec: 1, endSec: '2' }],
    ['a start of NaN', { startSec: Number.NaN, endSec: 2 }],
    ['an end of Infinity', { startSec: 1, endSec: Number.POSITIVE_INFINITY }],
    ['no end', { startSec: 1 }],
    ['no times at all', {}],
    ['a cut that is null', null],
    ['a cut that is a number', 5],
    ['a cut that is a list', [1, 2]]
  ]
  const BAD_DENOISE: Array<[string, unknown]> = [
    ['an empty object', {}],
    ['a noise floor that is a string', { noiseFloorDb: '-25', reductionDb: 12 }],
    ['a noise floor of NaN', { noiseFloorDb: Number.NaN, reductionDb: 12 }],
    ['a reduction of Infinity', { noiseFloorDb: -25, reductionDb: Number.POSITIVE_INFINITY }],
    ['no reduction', { noiseFloorDb: -25 }],
    ['a string instead of an object', 'strong'],
    ['a list', [-25, 12]]
  ]

  for (const channel of ['audio:export', 'audio:mux'] as const) {
    const specFor = (chain: ChainSpec): Record<string, unknown> =>
      channel === 'audio:export'
        ? exportSpec(chain)
        : {
            jobId: 'aud3',
            videoPath: path.join(tmpdir(), 'v.mp4'),
            sourcePath: SOURCE,
            outputPath: path.join(tmpdir(), 'v-out.mp4'),
            chain
          }

    it.each(BAD_CUTS)(`${channel} refuses a cut with %s in one plain sentence, before anything is spawned`, async (_l, cut) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const err = await call(channel, specFor(chainWith(null, { cutRegions: [{ startSec: 0, endSec: 0.5 }, cut] }))).then(
          () => null,
          (e: unknown) => e
        )
        expect((err as Error | null)?.message).toBe(CUT_SENTENCE)
        expect(children, 'no ffmpeg was spawned').toHaveLength(0)
        // The detail names which cut, for the bug report.
        expect(String(logged.mock.calls[0]?.[0])).toMatch(/cutRegions\[1\]/)
      } finally {
        logged.mockRestore()
      }
    })

    it.each(BAD_DENOISE)(`${channel} refuses custom noise reduction with %s in one plain sentence, before anything is spawned`, async (_l, params) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const err = await call(channel, specFor(chainWith(null, { denoise: 'parametric', denoiseParams: params }))).then(
          () => null,
          (e: unknown) => e
        )
        expect((err as Error | null)?.message).toBe(DENOISE_SENTENCE)
        expect(children, 'no ffmpeg was spawned').toHaveLength(0)
        expect(String(logged.mock.calls[0]?.[0])).toMatch(/denoiseParams/)
      } finally {
        logged.mockRestore()
      }
    })
  }

  it('a saved preset is held to the same gate, so a bad chain cannot be stored for later', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(
        call('audio:savePreset', 'x', chainWith(null, { denoise: 'parametric', denoiseParams: {} }))
      ).rejects.toThrow(DENOISE_SENTENCE)
      await expect(
        call('audio:savePreset', 'x', chainWith(null, { cutRegions: [{ startSec: '1', endSec: 2 }] }))
      ).rejects.toThrow(CUT_SENTENCE)
    } finally {
      logged.mockRestore()
    }
  })

  it('each reaches the person as that sentence alone, not "Export failed." and not a channel name', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      for (const sentence of [CUT_SENTENCE, DENOISE_SENTENCE]) {
        const wrapped = new Error(`Error invoking remote method 'audio:export': Error: ${sentence}`)
        expect(userFacingError(wrapped, 'Export failed.')).toEqual({ cancelled: false, message: sentence })
      }
    } finally {
      logged.mockRestore()
    }
  })

  it('the controls: what the app writes reaches the runner - no cuts, real cuts, custom values, the default, and a strength that never reads them', async () => {
    const good: Array<Record<string, unknown>> = [
      { cutRegions: [] },
      { cutRegions: [{ startSec: 0, endSec: 0.5 }, { startSec: 3.25, endSec: 4 }] },
      { denoise: 'parametric', denoiseParams: { noiseFloorDb: -25, reductionDb: 12 } },
      { denoise: 'parametric', denoiseParams: { noiseFloorDb: -80, reductionDb: 0.01, sensitivity: 0 } },
      // Absent (or null) is the default, as `denoiseFilter` reads it.
      { denoise: 'parametric' },
      { denoise: 'parametric', denoiseParams: null },
      // A strength that does not read the numbers is not held to them.
      { denoise: 'medium', denoiseParams: {} },
      { denoise: 'off', denoiseParams: 'garbage' }
    ]
    for (const fields of good) {
      await expect(call('audio:export', exportSpec(chainWith(null, fields)))).resolves.toBeDefined()
    }
    expect(children).toHaveLength(good.length)
  })

  it('and it holds under NODE_ENV=production, where a soft assert would have let it through', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(
        call('audio:export', exportSpec(chainWith(null, { denoise: 'parametric', denoiseParams: {} })))
      ).rejects.toThrow(DENOISE_SENTENCE)
      await expect(
        call('audio:export', exportSpec(chainWith(null, { cutRegions: [{ startSec: '1', endSec: 2 }] })))
      ).rejects.toThrow(CUT_SENTENCE)
      expect(children).toHaveLength(0)
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
      logged.mockRestore()
    }
  })
})
