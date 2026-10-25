import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { tsToSeconds } from '../../shared/captions'

/**
 * T-113 (9) — the Clip Kit's SRT is on the clip's clock.
 *
 * The kit bundled a plain `copyFile` of the whole video's SRT (the channel was
 * `captions:copySrtTo` then; it is `captions:writeKitSrt` now that it writes):
 * cues on the SOURCE clock beside a clip that starts at 0:00 — a clip cut from minute
 * 40 got captions that began at minute 40 (and none that ever matched what was said).
 * The handler now takes the clip's range and speed, writes the cues re-expressed on
 * the clock of the kit's video (shifted by -startSec, cut to the range, divided by the
 * speed), and writes nothing when no cue falls inside the clip.
 *
 * This runs the REAL handler on REAL files; only electron and the captions folder's
 * location are stood in for. The end-to-end version (a kit built from a project with a
 * transcript) is the Clip Kit E2E in video-pipelines.spec.ts.
 */
const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
let scratch = ''
let captionsDir = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, req: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: {},
  BrowserWindow: {},
  shell: {},
  app: { getPath: () => tmpdir() }
}))
vi.mock('../sidecars/whisperManager', () => ({
  cancelBurnIn: vi.fn(),
  cancelTranscribe: vi.fn(),
  cancelWhisperModelInstall: vi.fn(),
  getCaptionsStatus: vi.fn(),
  installWhisperModel: vi.fn(),
  runBurnIn: vi.fn(),
  runTranscribe: vi.fn()
}))
vi.mock('../sidecars/paths', () => ({
  captionsOutputDir: () => captionsDir
}))

// T-139 (1): a disk that fills part-way, injected into the real `node:fs/promises` (everything else in it stays real). Off unless a test turns it on.
const faults = vi.hoisted(() => ({ writeThenFail: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    writeFile: async (file: string, data: string | Buffer, ...rest: unknown[]) => {
      if (faults.writeThenFail) {
        const bytes = Buffer.from(data)
        await real.writeFile(file, bytes.subarray(0, Math.ceil(bytes.length / 2)))
        throw Object.assign(new Error('ENOSPC: simulated, write'), { code: 'ENOSPC' })
      }
      return (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest)
    }
  }
})

const { registerCaptionsIpc } = await import('./captions')

/** A transcript of a 60-minute stream: one cue a minute for the first ten, at 0:30 of each. */
function transcript(): string {
  const stamp = (sec: number): string => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0')
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
    const s = String(Math.floor(sec % 60)).padStart(2, '0')
    return `${h}:${m}:${s},000`
  }
  const cues: string[] = []
  for (let minute = 0; minute < 10; minute += 1) {
    const start = minute * 60 + 30
    cues.push(`${minute + 1}\n${stamp(start)} --> ${stamp(start + 3)}\nminute ${minute} line\n`)
  }
  return cues.join('\n')
}

const copy = (params: Record<string, unknown>): Promise<unknown> => {
  const handler = handlers.get('captions:writeKitSrt')
  if (!handler) throw new Error('captions:writeKitSrt was not registered')
  return handler({}, params)
}

let srt = ''
let dest = ''

beforeEach(() => {
  faults.writeThenFail = false
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-copysrt-'))
  captionsDir = path.join(scratch, 'captions')
  mkdirSync(captionsDir, { recursive: true })
  srt = path.join(captionsDir, 'stream.srt')
  writeFileSync(srt, transcript(), 'utf8')
  dest = path.join(scratch, 'kit', 'Clip.srt')
  mkdirSync(path.dirname(dest), { recursive: true })
  handlers.clear()
  registerCaptionsIpc()
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

interface Cue {
  startSec: number
  endSec: number
  text: string
}

/** The cues of an SRT, read independently of the code under test. */
function parseSrt(text: string): Cue[] {
  const out: Cue[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at === -1) continue
    const [from, to] = (lines[at] as string).split('-->').map((t) => t.trim())
    out.push({ startSec: tsToSeconds(from as string), endSec: tsToSeconds(to as string), text: lines.slice(at + 1).join('\n') })
  }
  return out
}

const written = (): Cue[] => parseSrt(readFileSync(dest, 'utf8'))

describe('captions:writeKitSrt writes the clip\'s captions on the clip\'s clock (T-113)', () => {
  it('a clip from the middle of the stream: the first cue sits near 0, not at the clip\'s source time', async () => {
    // Minute 3 to minute 5 of the stream: cues at 3:30 (-> 0:30 into the clip) and 4:30 (-> 1:30).
    await expect(copy({ srtPath: srt, dest, startSec: 180, endSec: 300, speed: 1 })).resolves.toEqual({
      ok: true,
      written: true
    })
    const cues = written()
    expect(cues.map((c) => c.text)).toEqual(['minute 3 line', 'minute 4 line'])
    // On the source clock the first cue is at 210 s; the file must put it at 30 s.
    expect(cues[0]?.startSec).toBeCloseTo(30, 3)
    expect(cues[0]?.startSec).toBeLessThan(120)
    expect(cues[1]?.startSec).toBeCloseTo(90, 3)
    // Every cue lies inside the clip's own length.
    for (const c of cues) expect(c.endSec).toBeLessThanOrEqual(120)
  })

  it('at 2x the times are halved: the file the cues sit beside is half as long', async () => {
    await copy({ srtPath: srt, dest, startSec: 180, endSec: 300, speed: 2 })
    const cues = written()
    expect(cues[0]?.startSec).toBeCloseTo(15, 3)
    expect(cues[0]?.endSec).toBeCloseTo(16.5, 3)
    expect(cues[1]?.startSec).toBeCloseTo(45, 3)
    for (const c of cues) expect(c.endSec).toBeLessThanOrEqual(60)
  })

  it('at 0.5x they are doubled', async () => {
    await copy({ srtPath: srt, dest, startSec: 180, endSec: 300, speed: 0.5 })
    const cues = written()
    expect(cues[0]?.startSec).toBeCloseTo(60, 3)
    expect(cues[0]?.endSec).toBeCloseTo(66, 3)
  })

  it('a whole-file clip at 1x gets every cue at the time it always had', async () => {
    await copy({ srtPath: srt, dest, startSec: 0, endSec: 3600, speed: 1 })
    const original = parseSrt(readFileSync(srt, 'utf8'))
    const cues = written()
    expect(cues).toHaveLength(original.length)
    expect(cues.map((c) => [c.startSec, c.endSec, c.text])).toEqual(original.map((c) => [c.startSec, c.endSec, c.text]))
  })

  it('a cue half inside the clip is cut at the edge, not dropped', async () => {
    // Starts 2 s before minute 4's cue ends: the 4:30-4:33 cue, clip opens at 4:31.
    await copy({ srtPath: srt, dest, startSec: 271, endSec: 400, speed: 1 })
    const cues = written()
    expect(cues[0]?.text).toBe('minute 4 line')
    expect(cues[0]?.startSec).toBeCloseTo(0, 3)
    expect(cues[0]?.endSec).toBeCloseTo(2, 3)
  })

  it('a clip with nobody speaking in it writes no file, and says so', async () => {
    await expect(copy({ srtPath: srt, dest, startSec: 3000, endSec: 3100, speed: 1 })).resolves.toEqual({
      ok: true,
      written: false
    })
    expect(existsSync(dest), 'an SRT with no cue in it is not written').toBe(false)
    expect(readdirSync(path.dirname(dest))).toEqual([])
  })

  it('the transcript itself is untouched', async () => {
    const before = readFileSync(srt, 'utf8')
    await copy({ srtPath: srt, dest, startSec: 180, endSec: 300, speed: 2 })
    expect(readFileSync(srt, 'utf8')).toBe(before)
  })
})

// T-117 (2): the folder gate refused any transcript whose own NAME starts with two dots, as if it had
// climbed out of the folder. Transcripts are named from the video (`..intro.mp4` is legal), and the kit
// answered `ok: false` for the app's own file - so the kit's captions silently dropped out of the set.
describe('captions:writeKitSrt: a name that starts with two dots is still in the folder (T-117)', () => {
  it.each(['...and then-123.srt', '..intro.srt', '.. .srt'])('a transcript called %s, in the captions folder, makes the kit\'s captions', async (name) => {
    const inFolder = path.join(captionsDir, name)
    writeFileSync(inFolder, transcript(), 'utf8')
    await expect(copy({ srtPath: inFolder, dest, startSec: 180, endSec: 300, speed: 1 })).resolves.toEqual({
      ok: true,
      written: true
    })
    expect(written().map((c) => c.text)).toEqual(['minute 3 line', 'minute 4 line'])
  })

  it('a transcript in a sub-folder whose name starts with two dots makes them too', async () => {
    const sub = path.join(captionsDir, '..old stream')
    mkdirSync(sub, { recursive: true })
    const inSub = path.join(sub, 'clip.srt')
    writeFileSync(inSub, transcript(), 'utf8')
    await expect(copy({ srtPath: inSub, dest, startSec: 0, endSec: 3600, speed: 1 })).resolves.toEqual({ ok: true, written: true })
  })

  it('a ..-named transcript that is gone is "not found", not "outside"', async () => {
    await expect(
      copy({ srtPath: path.join(captionsDir, '...and then-123.srt'), dest, startSec: 0, endSec: 60, speed: 1 })
    ).resolves.toEqual({ ok: false, reason: 'source SRT not found' })
  })

  it.each([
    ['the folder\'s parent', () => scratch],
    ['a file one level up', () => path.join(scratch, 'elsewhere.srt')],
    ['a sibling whose name starts with the folder\'s', () => path.join(scratch, 'captions-evil', 'x.srt')],
    ['a climb that comes back down into a ..-named file', () => path.join(captionsDir, '..', '..intro.srt')],
    ['a climb written with the separator', () => `${captionsDir}${path.sep}..${path.sep}stream.srt`]
  ])('a real traversal is still refused: %s', async (_label, target) => {
    const t = target()
    mkdirSync(path.dirname(t), { recursive: true })
    if (t !== scratch) writeFileSync(t, transcript(), 'utf8')
    await expect(copy({ srtPath: t, dest, startSec: 0, endSec: 60, speed: 1 })).resolves.toEqual({
      ok: false,
      reason: 'source SRT is outside the captions directory'
    })
    expect(existsSync(dest)).toBe(false)
  })
})

describe('captions:writeKitSrt keeps its gates (T-113)', () => {
  it('still refuses a transcript outside the captions folder, writing nothing', async () => {
    const outside = path.join(scratch, 'elsewhere.srt')
    writeFileSync(outside, transcript(), 'utf8')
    await expect(copy({ srtPath: outside, dest, startSec: 0, endSec: 60, speed: 1 })).resolves.toEqual({
      ok: false,
      reason: 'source SRT is outside the captions directory'
    })
    expect(existsSync(dest)).toBe(false)
  })

  it('still says when the transcript is gone', async () => {
    await expect(
      copy({ srtPath: path.join(captionsDir, 'gone.srt'), dest, startSec: 0, endSec: 60, speed: 1 })
    ).resolves.toEqual({ ok: false, reason: 'source SRT not found' })
  })

  it('refuses a destination that climbs out of its folder', async () => {
    await expect(
      copy({ srtPath: srt, dest: `${scratch}/kit/../../escape.srt`, startSec: 0, endSec: 60, speed: 1 })
    ).rejects.toThrow(/dest/)
  })

  it.each([
    ['no range at all', { startSec: undefined, endSec: undefined }],
    ['half a range', { startSec: 10, endSec: undefined }],
    ['an inverted range', { startSec: 60, endSec: 10 }],
    ['a range as strings', { startSec: '10', endSec: '60' }],
    ['a NaN start', { startSec: Number.NaN, endSec: 60 }],
    ['an empty range', { startSec: 10, endSec: 10 }]
  ])('refuses %s, before anything is read', async (_label, range) => {
    await expect(copy({ srtPath: srt, dest, speed: 1, ...range })).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
  })

  it.each([
    ['0', 0],
    ['negative', -2],
    ['past 10', 11],
    ['a string', '2'],
    ['NaN', Number.NaN],
    ['missing', undefined]
  ])('refuses a speed that is %s', async (_label, speed) => {
    await expect(copy({ srtPath: srt, dest, startSec: 0, endSec: 60, speed })).rejects.toThrow(/speed/)
    expect(existsSync(dest)).toBe(false)
  })
})

/**
 * T-139 (1) - the kit's subtitle file is written the way every file the person owns is: whole, or not at all.
 *
 * The kit writes into a fresh folder each run, so there is normally no earlier `.srt` to lose; what a `writeFile` that failed part-way left there was a
 * truncated one, which looks like captions and is not (and the kit's toast said only that captions were not included). Through `writeFileAtomic` the folder
 * holds the whole file or none, and a file that WAS at that path (a destination reused) is as it was.
 */
describe('captions:writeKitSrt writes the whole file or none (T-139 (1))', () => {
  const range = { startSec: 30, endSec: 200, speed: 1 }

  it('a disk that fills part-way answers ok:false, leaves no stub .srt in the kit folder, and names the cause in the reason', async () => {
    faults.writeThenFail = true
    const answer = (await copy({ srtPath: srt, dest, ...range })) as { ok: boolean; reason?: string }
    expect(answer.ok).toBe(false)
    expect(answer.reason).toContain('ENOSPC')
    expect(readdirSync(path.dirname(dest)), 'no half-written captions file, and no tmp').toEqual([])
  })

  it('a file already at that path is left as it was when the write fails', async () => {
    writeFileSync(dest, 'the earlier file, whole', 'utf8')
    faults.writeThenFail = true
    expect(((await copy({ srtPath: srt, dest, ...range })) as { ok: boolean }).ok).toBe(false)
    expect(readFileSync(dest, 'utf8')).toBe('the earlier file, whole')
    expect(readdirSync(path.dirname(dest))).toEqual([path.basename(dest)])
  })

  it('a write that succeeds is the shifted cues and leaves no tmp', async () => {
    expect(await copy({ srtPath: srt, dest, ...range })).toEqual({ ok: true, written: true })
    expect(readFileSync(dest, 'utf8')).toContain('minute 1 line')
    expect(readdirSync(path.dirname(dest))).toEqual([path.basename(dest)])
  })
})
