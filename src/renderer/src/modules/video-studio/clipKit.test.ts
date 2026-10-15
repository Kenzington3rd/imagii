import { describe, it, expect } from 'vitest'
import type { Clip, WatermarkSpec } from '@shared/clip'
import {
  YOUTUBE_SHORT_LIMIT_SEC,
  buildKitQueue,
  buildKitSrtRequest,
  describeKitLimit,
  formatClipLength,
  kitCanceledMessage,
  kitEffectivePresets,
  kitExportLabel,
  kitLimitTargets,
  kitSrtFilename,
  kitThumbFilename,
  kitThumbLabel,
  platformsOverLimit
} from './clipKit'
import { ALL_PLATFORM_IDS, PLATFORM_INFO, evaluateSuccess } from './presets'
import { sanitizeFilename } from '@shared/filename'
import { isSafeAbsolutePath } from '@shared/pathSafety'

/**
 * T-85. The kit's queue used to be built inline in ClipKitButton with
 * `watermark: null` hard-coded, so the watermark a user had saved never
 * reached a kit file. These pin the jobs the button hands to main.
 */

const CLIP: Clip = {
  id: 'c1',
  name: 'Clip 1',
  startSec: 2,
  endSec: 12,
  cropRect: null,
  textOverlays: [],
  selectedPresets: ['youtube']
}
const LANDSCAPE = { filePath: '/v/stream.mp4', width: 1920, height: 1080 }
const PORTRAIT = { filePath: '/v/phone.mp4', width: 1080, height: 1920 }
const WM: WatermarkSpec = { text: '@imagii', position: 'top-left', opacity: 0.85, fontSizePct: 3.5 }

function queue(source = LANDSCAPE, watermark: WatermarkSpec | null = WM) {
  let n = 0
  return buildKitQueue({
    source,
    clip: CLIP,
    kitDir: '/out/Clip_1-kit',
    safeName: 'Clip_1',
    watermark,
    newJobId: () => `job${++n}`
  })
}

describe('buildKitQueue — the saved watermark rides on every platform file', () => {
  it('puts the watermark on all five jobs, not just the first', () => {
    const jobs = queue()
    expect(jobs).toHaveLength(5)
    for (const job of jobs) {
      expect(job.watermark, `${job.preset} carries the watermark`).toEqual(WM)
    }
  })

  it('no saved watermark is no watermark (the kit stays clean for a user who set none)', () => {
    for (const job of queue(LANDSCAPE, null)) expect(job.watermark).toBeNull()
  })
})

describe('buildKitQueue — one job per platform slot', () => {
  it('queues the five platforms in the order the kit has always run them', () => {
    expect(queue().map((j) => j.preset)).toEqual(['youtube', 'reels', 'tiktok', 'twitter', 'facebook'])
    expect(queue().map((j) => j.outputFilename)).toEqual([
      'Clip_1_youtube.mp4',
      'Clip_1_reels.mp4',
      'Clip_1_tiktok.mp4',
      'Clip_1_twitter.mp4',
      'Clip_1_facebook.mp4'
    ])
  })

  it('each job is for its own platform only, in the kit folder, from the loaded source', () => {
    for (const job of queue()) {
      expect(job.clip.selectedPresets).toEqual([job.preset])
      expect(job.outDir).toBe('/out/Clip_1-kit')
      expect(job.sourcePath).toBe('/v/stream.mp4')
      // The clip's own range and edits are the user's, untouched.
      expect(job.clip.startSec).toBe(2)
      expect(job.clip.endSec).toBe(12)
    }
  })

  it('gives every job its own id', () => {
    const ids = queue().map((j) => j.jobId)
    expect(new Set(ids).size).toBe(5)
  })

  it('a vertical source exports its YouTube slot as a Short: reels geometry, youtube_short filename', () => {
    const jobs = queue(PORTRAIT)
    expect(jobs[0]?.preset).toBe('reels')
    expect(jobs[0]?.clip.selectedPresets).toEqual(['reels'])
    expect(jobs[0]?.outputFilename).toBe('Clip_1_youtube_short.mp4')
    // The real reels slot is still its own file.
    expect(jobs[1]?.outputFilename).toBe('Clip_1_reels.mp4')
  })

  it('kitEffectivePresets mirrors the queue, and duplicates only on a vertical frame', () => {
    expect(kitEffectivePresets(LANDSCAPE, CLIP)).toEqual(queue(LANDSCAPE).map((j) => j.preset))
    expect(kitEffectivePresets(PORTRAIT, CLIP)).toEqual(queue(PORTRAIT).map((j) => j.preset))
    expect(kitEffectivePresets(PORTRAIT, CLIP)).toEqual(['reels', 'reels', 'tiktok', 'twitter', 'facebook'])
  })
})

/**
 * T-112 — the YouTube slot follows the CROP, not the source.
 *
 * The Short swap read `source.height > source.width`. A streamer's recording is
 * 16:9; the 9:16 they drew on it is the vertical clip they want, and the kit
 * gave them a landscape YouTube file (the whole 16:9 frame's center, then cut
 * to 16:9 again) and a Reels file, never the Short. The same read went wrong the
 * other way for a portrait source cropped to landscape. `cropFrameSize` is the
 * frame every other verdict of the grid is about (T-83, T-97); the kit now asks
 * the same question of the same function.
 */
describe('the YouTube slot is a Short when the CROP is vertical (T-112)', () => {
  /** A centered crop of `source` with the given aspect, as the store keeps it (fractions of the source). */
  function cropOf(source: { width: number; height: number }, aspect: number): Clip['cropRect'] {
    const frameAspect = source.width / source.height
    return aspect < frameAspect
      ? { x: (1 - aspect / frameAspect) / 2, y: 0, w: aspect / frameAspect, h: 1 }
      : { x: 0, y: (1 - frameAspect / aspect) / 2, w: 1, h: frameAspect / aspect }
  }
  const withCrop = (cropRect: Clip['cropRect']): Clip => ({ ...CLIP, cropRect })
  const build = (source: typeof LANDSCAPE, clip: Clip) => {
    let n = 0
    return buildKitQueue({
      source,
      clip,
      kitDir: '/out/Clip_1-kit',
      safeName: 'Clip_1',
      watermark: null,
      newJobId: () => `job${++n}`
    })
  }

  it('a 16:9 recording cropped to 9:16 gets a Short in the YouTube slot', () => {
    const clip = withCrop(cropOf(LANDSCAPE, 9 / 16))
    const jobs = build(LANDSCAPE, clip)
    expect(jobs[0]?.preset).toBe('reels')
    expect(jobs[0]?.clip.selectedPresets).toEqual(['reels'])
    expect(jobs[0]?.outputFilename).toBe('Clip_1_youtube_short.mp4')
    expect(kitEffectivePresets(LANDSCAPE, clip)).toEqual(['reels', 'reels', 'tiktok', 'twitter', 'facebook'])
  })

  it('a portrait recording cropped to landscape keeps the landscape YouTube file', () => {
    const clip = withCrop(cropOf(PORTRAIT, 16 / 9))
    const jobs = build(PORTRAIT, clip)
    expect(jobs[0]?.preset).toBe('youtube')
    expect(jobs[0]?.outputFilename).toBe('Clip_1_youtube.mp4')
    expect(kitEffectivePresets(PORTRAIT, clip)).toEqual(['youtube', 'reels', 'tiktok', 'twitter', 'facebook'])
  })

  it('a square crop is not vertical, whichever way the source is', () => {
    for (const source of [LANDSCAPE, PORTRAIT]) {
      const jobs = build(source, withCrop(cropOf(source, 1)))
      expect(jobs[0]?.preset, `${source.width}x${source.height}`).toBe('youtube')
    }
  })

  it('with no crop the source decides, exactly as before', () => {
    expect(build(LANDSCAPE, CLIP)[0]?.preset).toBe('youtube')
    expect(build(PORTRAIT, CLIP)[0]?.preset).toBe('reels')
  })

  it('a source the probe could not size is never a Short (no division, no throw)', () => {
    const unsized = { filePath: '/v/odd.mp4', width: 0, height: 0 }
    expect(build(unsized, CLIP)[0]?.preset).toBe('youtube')
    expect(kitEffectivePresets(unsized, withCrop({ x: 0, y: 0, w: 0.3, h: 1 }))[0]).toBe('youtube')
  })

  it('the question about long clips is asked of the slots that will be written', () => {
    const vertical = withCrop(cropOf(LANDSCAPE, 9 / 16))
    const over = platformsOverLimit(
      { startSec: 0, endSec: 3 * 3600, speedMultiplier: 1 },
      kitEffectivePresets(LANDSCAPE, vertical)
    )
    // The YouTube slot is Reels here: a 3-hour clip is over TikTok's hour and Reels' limit, not YouTube's 12.
    expect(over.map((p) => p.id)).toEqual(['reels', 'tiktok'])
  })
})

describe('platformsOverLimit — the kit asks once, and only about a platform that is over', () => {
  const kit = kitEffectivePresets(LANDSCAPE, CLIP)
  /** A clip whose range is `sec` source seconds, at `speed`. */
  const range = (sec: number, speed?: number) => ({
    startSec: 5,
    endSec: 5 + sec,
    speedMultiplier: speed
  })

  it('a short clip is inside every typical limit', () => {
    expect(platformsOverLimit(range(30), kit)).toEqual([])
    expect(platformsOverLimit(range(PLATFORM_INFO.reels.durationHardLimit), kit)).toEqual([])
  })

  // T-112: 3 minutes is where Instagram stops RECOMMENDING a Reel, not where it
  // stops taking one (Reels upload up to about 20 minutes), so the kit's "this is
  // long for some platforms" question waits for the real limit.
  it('a clip past Reels\' old 3 minutes is not a question; one second past 20 minutes names Reels alone', () => {
    expect(platformsOverLimit(range(181), kit)).toEqual([])
    expect(platformsOverLimit(range(1200), kit)).toEqual([])
    expect(platformsOverLimit(range(1201), kit).map((p) => p.id)).toEqual(['reels'])
  })

  it('past 20 minutes it is still only Reels; an hour-plus adds TikTok', () => {
    expect(platformsOverLimit(range(1800), kit).map((p) => p.id)).toEqual(['reels'])
    expect(platformsOverLimit(range(3601), kit).map((p) => p.id)).toEqual(['reels', 'tiktok'])
  })

  it('a long enough clip names all five, in the kit order', () => {
    const over = platformsOverLimit(range(13 * 3600), kit)
    expect(over.map((p) => p.id)).toEqual(ALL_PLATFORM_IDS.slice().sort((a, b) => kit.indexOf(a) - kit.indexOf(b)))
    expect(over).toHaveLength(5)
  })

  it('a vertical source lists Reels once, not once per slot that uses it', () => {
    const over = platformsOverLimit(range(1500), kitEffectivePresets(PORTRAIT, CLIP))
    expect(over.map((p) => p.id)).toEqual(['reels'])
  })

  it('uses the same limits as the export grid\'s "Too long"', () => {
    // Exactly at the cap is not over; the grid says "Longer than" for more.
    for (const p of Object.values(PLATFORM_INFO)) {
      expect(platformsOverLimit(range(p.durationHardLimit), [p.id])).toEqual([])
      expect(platformsOverLimit(range(p.durationHardLimit + 1), [p.id])).toEqual([p])
    }
  })

  // T-97: the limit is about the file, and the file runs at the clip's speed.
  it('a 2x clip is judged at half its range: 40 minutes at 2x is 20 minutes, not over Reels', () => {
    expect(platformsOverLimit(range(2400, 1), kit).map((p) => p.id)).toEqual(['reels'])
    expect(platformsOverLimit(range(2400, 2), kit)).toEqual([])
    // A second of output past the boundary is over again.
    expect(platformsOverLimit(range(2402, 2), kit).map((p) => p.id)).toEqual(['reels'])
  })

  it('a 0.5x clip is judged at double its range: 700 s at 0.5x is 1400 s, over Reels', () => {
    expect(platformsOverLimit(range(700, 1), kit)).toEqual([])
    expect(platformsOverLimit(range(700, 0.5), kit).map((p) => p.id)).toEqual(['reels'])
    expect(platformsOverLimit(range(600, 0.5), kit)).toEqual([])
  })

  it('agrees with the grid at every speed and every platform, at the boundary and a second past', () => {
    // The kit's question and the grid's red "Too long" are one fact. Walk each
    // platform's cap at 0.5x / 1x / 2x and ask both.
    for (const speed of [0.5, 1, 2]) {
      for (const p of Object.values(PLATFORM_INFO)) {
        for (const outputSec of [p.durationHardLimit, p.durationHardLimit + 1]) {
          const c = { ...range(outputSec * speed, speed), cropRect: null }
          const kitSaysOver = platformsOverLimit(c, [p.id]).length === 1
          const gridSaysOver = evaluateSuccess(p, c, 3840, 2160).label.includes('Too long')
          expect(kitSaysOver, `${p.id} at ${speed}x, ${outputSec} s out`).toBe(gridSaysOver)
          expect(kitSaysOver).toBe(outputSec > p.durationHardLimit)
        }
      }
    }
  })
})

describe('the question\'s words', () => {
  it('a row reads as a typical limit, never a fact', () => {
    expect(describeKitLimit(PLATFORM_INFO.reels)).toBe('Reels — the typical 20-minute limit')
    expect(describeKitLimit(PLATFORM_INFO.tiktok)).toBe('TikTok — the typical 60-minute limit')
    expect(describeKitLimit(PLATFORM_INFO.youtube)).toBe('YouTube — the typical 12-hour limit')
    // The vertical clip's YouTube slot is asked about as a Short (T-113): the row `describeKitLimit`'s docstring
    // quotes. (It quoted "Reels — the typical 3-minute limit" for rounds; Reels is 20 minutes, above.)
    const shortRow = kitLimitTargets(PORTRAIT, CLIP).find((info) => info.label === 'YouTube Short')
    expect(shortRow, 'the Short row exists for a vertical clip').toBeDefined()
    if (shortRow) expect(describeKitLimit(shortRow)).toBe('YouTube Short — the typical 3-minute limit')
    for (const info of Object.values(PLATFORM_INFO)) {
      expect(describeKitLimit(info)).not.toMatch(/reject|refuse|not allowed|fail/i)
    }
  })

  it('formats a clip\'s length as m:ss, with hours when it has them', () => {
    expect(formatClipLength(9)).toBe('0:09')
    expect(formatClipLength(250)).toBe('4:10')
    expect(formatClipLength(1200)).toBe('20:00')
    expect(formatClipLength(3725)).toBe('1:02:05')
    expect(formatClipLength(-5)).toBe('0:00')
  })
})

/**
 * T-112 — the label counts. "Exporting 5 platform versions…" sat on the button for
 * as long as the five encodes took (minutes for a long clip) and said nothing about
 * how far along they were; the progress events that exist per job (`video:jobComplete`)
 * now move it.
 */
describe('the kit button\'s label counts its work (T-112)', () => {
  it('names the version in progress out of the whole set, starting at 1', () => {
    expect(kitExportLabel(0, 5)).toBe('Exporting platform version 1 of 5…')
    expect(kitExportLabel(1, 5)).toBe('Exporting platform version 2 of 5…')
    expect(kitExportLabel(4, 5)).toBe('Exporting platform version 5 of 5…')
  })

  it('never reads "6 of 5" if an event arrives after the last job', () => {
    expect(kitExportLabel(5, 5)).toBe('Exporting platform version 5 of 5…')
    expect(kitExportLabel(9, 5)).toBe('Exporting platform version 5 of 5…')
  })

  it('counts the thumbnails the same way', () => {
    expect(kitThumbLabel(0, 3)).toBe('Extracting thumbnail 1 of 3…')
    expect(kitThumbLabel(2, 3)).toBe('Extracting thumbnail 3 of 3…')
  })

  it('is the kit\'s own size: the number is the length of the queue, not a literal', () => {
    expect(kitExportLabel(0, ALL_PLATFORM_IDS.length)).toContain(`of ${ALL_PLATFORM_IDS.length}`)
  })
})


// ───────────────────────────────────────────────────────────────────────────
// T-113 (13) — the swapped YouTube slot is a YouTube Short, with a Short's limit.
//
// A vertical clip's YouTube slot is written with Reels' geometry (INIT-B), and it was
// asked about as Reels. When Reels' limit became its real 20 minutes (T-112) the Short
// lost every length check: a 4-minute 9:16 clip kitted with no question, and YouTube
// takes a Short of up to 3 minutes. The slot now carries its own limit and name.
// ───────────────────────────────────────────────────────────────────────────
describe('the kit asks about the YouTube Short with the Short\'s own limit (T-113)', () => {
  // A 16:9 recording with a 9:16 strip drawn on it: the usual way a streamer makes a vertical clip.
  const w = 9 / 16 / (16 / 9)
  const vertical: Clip = { ...CLIP, cropRect: { x: (1 - w) / 2, y: 0, w, h: 1 } }
  const range = (sec: number, speed?: number) => ({ startSec: 5, endSec: 5 + sec, speedMultiplier: speed })
  const labels = (over: Array<{ label: string }>): string[] => over.map((p) => p.label)

  it('a 4-minute 9:16 clip is over the Short\'s 3 minutes, and only the Short is named', () => {
    const over = platformsOverLimit(range(240), kitLimitTargets(LANDSCAPE, vertical))
    expect(labels(over)).toEqual(['YouTube Short'])
  })

  it('the Short is a limit of its own, 180 s: at the limit is fine, a second past asks', () => {
    expect(YOUTUBE_SHORT_LIMIT_SEC).toBe(180)
    expect(platformsOverLimit(range(180), kitLimitTargets(PORTRAIT, CLIP))).toEqual([])
    expect(labels(platformsOverLimit(range(181), kitLimitTargets(PORTRAIT, CLIP)))).toEqual(['YouTube Short'])
  })

  it('Reels itself stays 20 minutes: a 19-minute clip names the Short and not Reels, a 21-minute one names both', () => {
    expect(labels(platformsOverLimit(range(1140), kitLimitTargets(PORTRAIT, CLIP)))).toEqual(['YouTube Short'])
    expect(labels(platformsOverLimit(range(1260), kitLimitTargets(PORTRAIT, CLIP)))).toEqual(['YouTube Short', 'Reels'])
  })

  it('the Short is judged on the file, at the clip\'s speed: 6 minutes at 2x is 3 minutes', () => {
    expect(platformsOverLimit(range(360, 2), kitLimitTargets(PORTRAIT, CLIP))).toEqual([])
    expect(labels(platformsOverLimit(range(362, 2), kitLimitTargets(PORTRAIT, CLIP)))).toEqual(['YouTube Short'])
  })

  it('a landscape kit has no Short, so a 4-minute clip is no question at all', () => {
    expect(platformsOverLimit(range(240), kitLimitTargets(LANDSCAPE, CLIP))).toEqual([])
  })

  it('the targets are the slots the queue writes, in its order: the swapped one first', () => {
    const slots = kitLimitTargets(PORTRAIT, CLIP)
    expect(slots.map((t) => t.label)).toEqual(['YouTube Short', 'Reels', 'TikTok', 'X / Twitter', 'Facebook'])
    expect(slots.map((t) => t.id)).toEqual(queue(PORTRAIT).map((j) => j.preset))
    expect(kitLimitTargets(LANDSCAPE, CLIP).map((t) => t.label)).toEqual(['YouTube', 'Reels', 'TikTok', 'X / Twitter', 'Facebook'])
    // A source the probe could not size is never a Short.
    expect(kitLimitTargets({ filePath: '/v/odd.mp4', width: 0, height: 0 }, CLIP)[0]?.label).toBe('YouTube')
  })

  it('the question names it in the same words as every other row', () => {
    const [short] = platformsOverLimit(range(240), kitLimitTargets(PORTRAIT, CLIP))
    expect(short ? describeKitLimit(short) : '').toBe('YouTube Short — the typical 3-minute limit')
  })

  it('Reels in the table is untouched by the Short (the Short is a copy, not an edit)', () => {
    expect(PLATFORM_INFO.reels.durationHardLimit).toBe(1200)
    expect(PLATFORM_INFO.reels.label).toBe('Reels')
  })

  it('an id list still means what it always did (no Short in it, one Reels for the two slots)', () => {
    expect(platformsOverLimit(range(240), kitEffectivePresets(PORTRAIT, CLIP))).toEqual([])
    expect(labels(platformsOverLimit(range(1500), kitEffectivePresets(PORTRAIT, CLIP)))).toEqual(['Reels'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T-113 (12) — the kit sends the clip as it PLAYS (clipRecipe), as Compile does.
// ───────────────────────────────────────────────────────────────────────────
describe('the kit hands main the clip as it plays, not as it is stored (T-113)', () => {
  it('a stored speed of 0 is 1x in every job (it was a batch refusal)', () => {
    let n = 0
    const jobs = buildKitQueue({
      source: LANDSCAPE,
      clip: { ...CLIP, speedMultiplier: 0 },
      kitDir: '/out/k',
      safeName: 'Clip_1',
      watermark: null,
      newJobId: () => `j${++n}`
    })
    for (const job of jobs) expect(job.clip.speedMultiplier, job.preset).toBe(1)
  })

  it('a real speed is kept, and so is everything else about the clip', () => {
    const edited: Clip = {
      ...CLIP,
      speedMultiplier: 2,
      autoZoom: true,
      colorGrade: { brightness: 0.1, contrast: 1, saturation: 1, temperature: 0 },
      customPresetIds: ['p1']
    }
    let n = 0
    const jobs = buildKitQueue({ source: LANDSCAPE, clip: edited, kitDir: '/o', safeName: 'c', watermark: null, newJobId: () => `j${++n}` })
    for (const job of jobs) {
      expect(job.clip).toMatchObject({ id: 'c1', name: 'Clip 1', startSec: 2, endSec: 12, speedMultiplier: 2, autoZoom: true })
      expect(job.clip.colorGrade).toEqual(edited.colorGrade)
      expect(job.clip.customPresetIds).toEqual(['p1'])
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T-113 (9) — the captions request is the clip.
// ───────────────────────────────────────────────────────────────────────────
describe('buildKitSrtRequest — the kit\'s captions are for THIS clip (T-113)', () => {
  it('carries the clip\'s range and the speed it plays at', () => {
    expect(buildKitSrtRequest('/u/captions/a.srt', '/out/kit/Clip_1.srt', { ...CLIP, startSec: 2400, endSec: 2460, speedMultiplier: 2 })).toEqual({
      srtPath: '/u/captions/a.srt',
      dest: '/out/kit/Clip_1.srt',
      startSec: 2400,
      endSec: 2460,
      speed: 2
    })
  })

  it('a missing, zero or negative speed is 1x', () => {
    for (const speedMultiplier of [undefined, 0, -3, Number.NaN]) {
      expect(buildKitSrtRequest('/s.srt', '/d.srt', { ...CLIP, speedMultiplier }).speed, String(speedMultiplier)).toBe(1)
    }
  })
})

describe('kitCanceledMessage — what a canceled kit says depends on what survived (T-113)', () => {
  it('with nothing finished the folder was removed, so it does not point at one', () => {
    expect(kitCanceledMessage(0)).toBe('Clip Kit canceled.')
    expect(kitCanceledMessage(0)).not.toMatch(/folder/)
  })

  it('with files finished it says where they are', () => {
    for (const landed of [1, 5, 8]) {
      expect(kitCanceledMessage(landed)).toBe('Clip Kit canceled. Files already finished are in your folder.')
    }
  })
})

describe('every file a kit writes passes the path gate, whatever the clip is called (T-114)', () => {
  // The kit's SRT was the one file named by the BARE clip name (`<name>.srt`); its siblings all carry a
  // suffix (`_youtube.mp4`, `_thumb_1.jpg`). A clip named like a Windows device (Aux, Con, COM1, lpt9, Nul,
  // Prn) made `Aux.srt` a reserved name: the five videos and three thumbnails were written, then the SRT hit
  // the path gate and the whole kit reported "Clip Kit failed." with eight good files in the folder.
  const KIT_DIR = 'C:/Users/mike/Videos/clip-kit-20261010'
  const DEVICE_NAMES = ['Aux', 'con', 'COM1', 'lpt9', 'NUL', 'Prn', 'com5.', ' LPT1 ']
  // T-121: names in other scripts keep their letters now (`sanitizeFilename` was ASCII), so the path gate is asked about them too.
  const NON_ASCII_NAMES = ['Épico clutch', '클립 이름', 'クリップ名', 'Клип дня', 'สวัสดี ชาวโลก', 'E\u0301pico']

  /** Every name the kit writes for `safeName`, as the button builds them. */
  const kitFileNames = (safeName: string): string[] => [
    ...queue(LANDSCAPE, null).map((j) => j.outputFilename as string),
    ...[0, 1, 2].map((i) => kitThumbFilename(safeName, i)),
    kitSrtFilename(safeName)
  ]

  it.each(DEVICE_NAMES)('a clip named %j: all nine files are writable paths', (name) => {
    const safeName = sanitizeFilename(name)
    const q = buildKitQueue({
      source: LANDSCAPE,
      clip: CLIP,
      kitDir: KIT_DIR,
      safeName,
      watermark: null,
      newJobId: () => 'j'
    })
    const names = [
      ...q.map((j) => j.outputFilename as string),
      ...[0, 1, 2].map((i) => kitThumbFilename(safeName, i)),
      kitSrtFilename(safeName)
    ]
    expect(names).toHaveLength(ALL_PLATFORM_IDS.length + 3 + 1)
    for (const file of names) {
      expect(isSafeAbsolutePath(`${KIT_DIR}/${file}`), `${file} in ${safeName}`).toBe(true)
    }
  })

  it.each(NON_ASCII_NAMES)('a clip named %j (T-121): the name keeps its letters and all nine files are writable paths', (name) => {
    const safeName = sanitizeFilename(name)
    expect(safeName).not.toBe('clip')
    const q = buildKitQueue({
      source: LANDSCAPE,
      clip: CLIP,
      kitDir: KIT_DIR,
      safeName,
      watermark: null,
      newJobId: () => 'j'
    })
    const names = [
      ...q.map((j) => j.outputFilename as string),
      ...[0, 1, 2].map((i) => kitThumbFilename(safeName, i)),
      kitSrtFilename(safeName)
    ]
    expect(names).toHaveLength(ALL_PLATFORM_IDS.length + 3 + 1)
    for (const file of names) {
      expect(file.startsWith(safeName), file).toBe(true)
      expect(isSafeAbsolutePath(`${KIT_DIR}/${file}`), `${file} in ${safeName}`).toBe(true)
    }
  })

  it('the control: the bare name the SRT used to have IS a refused path for those names (the test discriminates)', () => {
    for (const name of ['Aux', 'con', 'COM1', 'lpt9', 'NUL', 'Prn']) {
      expect(isSafeAbsolutePath(`${KIT_DIR}/${sanitizeFilename(name)}.srt`), `${name}.srt`).toBe(false)
    }
  })

  it('names the SRT like its siblings: <name>_captions.srt, and the thumbnails <name>_thumb_<n>.jpg', () => {
    expect(kitSrtFilename('Clip_1')).toBe('Clip_1_captions.srt')
    expect([0, 1, 2].map((i) => kitThumbFilename('Clip_1', i))).toEqual([
      'Clip_1_thumb_1.jpg',
      'Clip_1_thumb_2.jpg',
      'Clip_1_thumb_3.jpg'
    ])
    expect(kitFileNames('Clip_1')).toContain('Clip_1_captions.srt')
  })
})
