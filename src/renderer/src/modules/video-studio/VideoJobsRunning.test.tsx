import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CaptionsProgress } from '@shared/captions'
import type { JobStatus } from './store/exportQueue'
import { jobsKeepGoingSentence, videoJobRows, VideoJobsRunning, type VideoRunSnapshot } from './VideoJobsRunning'
import { videoDiscardMessage, type VideoSource } from './store/videoStore'
import type { Clip } from '@shared/clip'

// A server render reads zustand's SERVER snapshot (a store's initial state, whatever a test set), so the stores the card reads are plain objects here, the
// way OutputPreview.test.tsx does it. The row choice and the sentence are pure functions of a snapshot and need none of this.
const held = vi.hoisted(() => ({ video: { source: null, clips: [], selectedClipId: null } as Record<string, unknown>, snap: {} as Record<string, unknown> }))
vi.mock('./store/videoStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store/videoStore')>()),
  useVideoStore: <T,>(selector: (s: Record<string, unknown>) => T): T => selector(held.video)
}))
vi.mock('./store/exportQueue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store/exportQueue')>()),
  useExportQueue: () => held.snap.exportQueue
}))
vi.mock('./store/runs', async (importOriginal) => {
  const real = await importOriginal<typeof import('./store/runs')>()
  const run = (key: string) => <T,>(selector: (s: { run: unknown }) => T): T => selector({ run: held.snap[key] ?? null })
  return {
    ...real,
    useReframeRun: run('reframe'),
    useGifRun: run('gif'),
    useCompileRun: run('compile'),
    usePipRun: run('pip'),
    useScanRun: run('scan'),
    useCaptionsRun: run('captions'),
    useModelInstallRun: run('modelInstall'),
    useKitRun: run('kit'),
    useCaptionsProgress: <T,>(selector: (s: { progress: unknown }) => T): T => selector({ progress: held.snap.captionsProgress ?? null })
  }
})
vi.mock('./ExportPanel', () => ({ ExportCancelConfirm: () => null }))

/**
 * T-144 - the closed video's running jobs. Closing the video took every job's row and Cancel with it (the panels return null with no source) while the
 * runs went on in main; the card draws one row per running job, and the Close question names what keeps going.
 */
const IDLE: VideoRunSnapshot = {
  exportQueue: { running: false, jobs: [], sourcePath: null, sourceName: null },
  reframe: null,
  gif: null,
  compile: null,
  pip: null,
  scan: null,
  captions: null,
  captionsProgress: null,
  modelInstall: null,
  kit: null
}
const snap = (over: Partial<VideoRunSnapshot>): VideoRunSnapshot => ({ ...IDLE, ...over })
const job = (jobId: string, over: Partial<JobStatus> = {}): JobStatus => ({ jobId, clipName: 'Clip 1', presetLabel: 'YouTube', percent: 0, ...over })
const kinds = (s: VideoRunSnapshot): string[] => videoJobRows(s).map((r) => r.kind)

describe('videoJobRows - one row per running job (T-144)', () => {
  it('nothing running is no row, and an export queue that only holds the last batch\'s rows is not running', () => {
    expect(videoJobRows(IDLE)).toEqual([])
    expect(videoJobRows(snap({ exportQueue: { running: false, jobs: [job('a', { percent: 100 })], sourcePath: '/v/stream.mp4', sourceName: 'stream.mp4' } }))).toEqual([])
  })

  it('an export batch reads which file of how many, for which video, with the running file\'s percent', () => {
    const rows = videoJobRows(
      snap({ exportQueue: { running: true, jobs: [job('a', { percent: 100 }), job('b', { percent: 42.4 }), job('c')], sourcePath: '/v/My Stream.mp4', sourceName: 'My Stream.mp4' } })
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'export', label: 'Export — My Stream.mp4: file 2 of 3', progress: '42%', cancelTitle: 'Cancel export' })
  })

  it('a batch whose every row is finished or failed (the moment before it ends) still reads a file number inside the total and no percent', () => {
    const rows = videoJobRows(snap({ exportQueue: { running: true, jobs: [job('a', { percent: 100 }), job('b', { error: 'x' })], sourcePath: null, sourceName: null } }))
    expect(rows[0]).toMatchObject({ label: 'Export: file 2 of 2', progress: null })
  })

  it('Reframe names its clip and the phase it is in, with its figure only when main has one', () => {
    expect(videoJobRows(snap({ reframe: { jobId: 'r', name: 'Clip 3', percent: null, phase: 'analyzing' } }))[0]).toMatchObject({
      kind: 'reframe',
      label: 'Reframe — Clip 3',
      progress: 'Checking the video…',
      cancelTitle: 'Cancel reframe'
    })
    expect(videoJobRows(snap({ reframe: { jobId: 'r', name: 'Clip 3', percent: 61.6, phase: 'rendering' } }))[0]?.progress).toBe('Rendering… 62%')
  })

  it('GIF, Compile and Picture-in-picture name what they are for and invent no progress', () => {
    const rows = videoJobRows(
      snap({ gif: { jobId: 'g', name: 'Clip 1' }, compile: { jobId: 'c', name: 'stream.mp4' }, pip: { jobId: 'p', name: 'cam.mp4' } })
    )
    expect(rows.map((r) => [r.kind, r.label, r.progress, r.cancelTitle])).toEqual([
      ['gif', 'GIF — Clip 1', null, 'Cancel GIF export'],
      ['compile', 'Compile — stream.mp4', null, 'Cancel compilation'],
      ['pip', 'Picture-in-picture — cam.mp4', null, 'Cancel picture-in-picture composite']
    ])
  })

  it('Scan VOD shows its percent', () => {
    expect(videoJobRows(snap({ scan: { name: 'stream.mp4', percent: 41.6 } }))[0]).toMatchObject({ kind: 'scan', label: 'Scan VOD — stream.mp4', progress: '42%', cancelTitle: 'Cancel scan' })
  })

  it('a transcription and a burn-in are told apart, with the phase main last reported (a figure only where it sent one)', () => {
    const transcribing: CaptionsProgress = { jobId: 'j', phase: 'transcribing' }
    const burning: CaptionsProgress = { jobId: 'j', phase: 'burning-in', percent: 30 }
    expect(videoJobRows(snap({ captions: { job: 'transcribe', name: 'stream.mp4' }, captionsProgress: transcribing }))[0]).toMatchObject({
      kind: 'transcribe',
      label: 'Transcribing — stream.mp4',
      progress: 'Transcribing…',
      cancelTitle: 'Cancel transcription'
    })
    expect(videoJobRows(snap({ captions: { job: 'burn-in', name: 'stream.mp4' }, captionsProgress: burning }))[0]).toMatchObject({
      kind: 'burn-in',
      label: 'Burning in captions — stream.mp4',
      progress: 'Burning in… 30%',
      cancelTitle: 'Cancel burn-in'
    })
    expect(videoJobRows(snap({ captions: { job: 'burn-in', name: 'stream.mp4' } }))[0]?.progress, 'no report yet, no words').toBeNull()
  })

  it('the caption model\'s download is a row too (its Cancel is a panel\'s that is gone with the video)', () => {
    expect(videoJobRows(snap({ modelInstall: { progress: { phase: 'downloading', percent: 12.2 } } }))[0]).toMatchObject({
      kind: 'model',
      label: 'Downloading the caption model',
      progress: '12%',
      cancelTitle: 'Cancel download'
    })
  })

  it('a name that was emptied is the bare job, and the Clip Kit is not a row (its own card draws it)', () => {
    expect(videoJobRows(snap({ gif: { jobId: 'g', name: '   ' } }))[0]?.label).toBe('GIF')
    expect(videoJobRows(snap({ kit: { clipId: 'c', clipName: 'Clip 1', phase: 'x', canceled: false } }))).toEqual([])
  })

  it('several at once come in the order the panels stand', () => {
    expect(
      kinds(
        snap({
          exportQueue: { running: true, jobs: [job('a')], sourcePath: '/v/a.mp4', sourceName: 'a.mp4' },
          scan: { name: 'a.mp4', percent: 1 },
          reframe: { jobId: 'r', name: 'c', percent: null, phase: 'starting' },
          pip: { jobId: 'p', name: 'x' }
        })
      )
    ).toEqual(['export', 'reframe', 'pip', 'scan'])
  })
})

describe('the Close question while a job runs (T-144)', () => {
  const one = snap({ exportQueue: { running: true, jobs: [job('a')], sourcePath: '/v/a.mp4', sourceName: 'a.mp4' } })

  it('names the one job, and that its Cancel stays on screen; nothing running adds nothing', () => {
    expect(jobsKeepGoingSentence(IDLE)).toBeNull()
    expect(jobsKeepGoingSentence(one)).toBe('The export that is running keeps going; its Cancel stays on screen.')
    expect(jobsKeepGoingSentence(snap({ scan: { name: 'a', percent: 0 } }))).toBe('The scan that is running keeps going; its Cancel stays on screen.')
  })

  it('counts a Clip Kit with the rest, and says "jobs" for two or more', () => {
    expect(jobsKeepGoingSentence(snap({ kit: { clipId: 'c', clipName: 'n', phase: '', canceled: false } }))).toBe(
      'The Clip Kit that is running keeps going; its Cancel stays on screen.'
    )
    expect(jobsKeepGoingSentence(snap({ gif: { jobId: 'g', name: 'a' }, kit: { clipId: 'c', clipName: 'n', phase: '', canceled: false } }))).toBe(
      'The 2 jobs that are running keep going; their Cancel buttons stay on screen.'
    )
  })

  it('is the second sentence of the discard question, after the clips it already names; a video with no clips still asks nothing', () => {
    const note = jobsKeepGoingSentence(one)
    // Two clips: there is something to lose, so the clips are named and the job's sentence follows.
    const twoClips = {
      source: { probe: { duration: 60 } } as VideoSource,
      clips: [
        { id: 'a', name: 'Clip 1', startSec: 0, endSec: 20, cropRect: null, textOverlays: [], selectedPresets: ['youtube'] },
        { id: 'b', name: 'Clip 2', startSec: 20, endSec: 40, cropRect: null, textOverlays: [], selectedPresets: ['youtube'] }
      ] as Clip[],
      history: { past: [], future: [] },
      derived: { scanCandidates: null, highlightChat: '', spikeChat: '', spikes: null, transcript: null }
    }
    expect(videoDiscardMessage(twoClips, 'close', note)).toBe(
      'Close this video? 2 clips and their edits will be discarded. The export that is running keeps going; its Cancel stays on screen.'
    )
    expect(videoDiscardMessage(twoClips, 'close', null)).toBe('Close this video? 2 clips and their edits will be discarded.')
    expect(videoDiscardMessage(twoClips)).toBe('Close this video? 2 clips and their edits will be discarded.')
    expect(videoDiscardMessage({ ...twoClips, clips: [] }, 'close', note)).toBeNull()
    // T-147 (3): an untouched video asks only about the job (the T-146 audio shape).
    expect(videoDiscardMessage({ ...twoClips, clips: [twoClips.clips[0]!], source: { probe: { duration: 20 } } as VideoSource }, 'close', note)).toBe(
      'Close this video? The export that is running keeps going; its Cancel stays on screen.'
    )
  })
})

describe('VideoJobsRunning - the card (T-144)', () => {
  const html = (): string => renderToStaticMarkup(<VideoJobsRunning />)
  beforeEach(() => {
    held.video = { source: null, clips: [], selectedClipId: null }
    held.snap = { ...IDLE }
  })

  it('is an always-mounted polite region, empty and taking no gap, while nothing runs', () => {
    expect(html()).toBe('<div aria-live="polite" class="-mb-5"></div>')
  })

  it('stays empty while a video is open, whatever runs: the panels draw the job then', () => {
    held.video = { source: { filePath: '/v/a.mp4', probe: { width: 1920, height: 1080 } }, clips: [{ id: 'c1' }], selectedClipId: 'c1' }
    held.snap = { ...IDLE, gif: { jobId: 'g', name: 'Clip 1' } }
    expect(html()).toBe('<div aria-live="polite" class="-mb-5"></div>')
  })

  it('draws a card with the job, its Cancel (named for the job) and the one sentence, in the same region, once the video is closed', () => {
    held.snap = { ...IDLE, reframe: { jobId: 'r', name: 'Clip 1', percent: 40, phase: 'rendering' } }
    const out = html()
    expect(out).toMatch(/^<div aria-live="polite">/)
    expect(out).not.toContain('-mb-5')
    expect(out).toContain('Reframe — Clip 1')
    expect(out).toContain('Rendering… 40%')
    expect(out).toMatch(/<button[^>]*title="Cancel reframe"[^>]*>Cancel<\/button>/)
    expect(out).toContain('The video is closed; the job keeps going until it finishes or you cancel it.')
  })

  it('says "these jobs" when more than one runs, and has one Cancel each', () => {
    held.snap = { ...IDLE, gif: { jobId: 'g', name: 'Clip 1' }, scan: { name: 'a.mp4', percent: 3 } }
    const out = html()
    expect(out.match(/>Cancel<\/button>/g)).toHaveLength(2)
    expect(out).toContain('The video is closed; these jobs keep going until they finish or you cancel them.')
  })
})

describe('VideoJobsRunning - a running Reframe always has a row (T-164 (4))', () => {
  const html = (): string => renderToStaticMarkup(<VideoJobsRunning />)
  const reframe = { jobId: 'r', name: 'Clip 1', percent: 40, phase: 'rendering' as const }
  const open = (width: number, height: number, selected = true): Record<string, unknown> => ({
    source: { filePath: '/v/a.mp4', probe: { width, height } },
    clips: [{ id: 'c1' }],
    selectedClipId: selected ? 'c1' : null
  })
  beforeEach(() => {
    held.video = { source: null, clips: [], selectedClipId: null }
    held.snap = { ...IDLE }
  })

  it('a vertical video is open: the Reframe row and its Cancel stand on the card, with no "video is closed" sentence', () => {
    held.video = open(1080, 1920)
    held.snap = { ...IDLE, reframe }
    const out = html()
    expect(out).toMatch(/^<div aria-live="polite">/)
    expect(out).not.toContain('-mb-5')
    expect(out).toContain('Reframe — Clip 1')
    expect(out).toContain('Rendering… 40%')
    expect(out).toMatch(/<button[^>]*title="Cancel reframe"[^>]*>Cancel<\/button>/)
    expect(out).not.toContain('The video is closed')
    expect(out).toContain('The reframe keeps going until it finishes or you cancel it.')
  })

  it('a square video and a horizontal one with no clip selected have no Reframe panel either, so the row stands', () => {
    held.snap = { ...IDLE, reframe }
    held.video = open(1080, 1080)
    expect(html()).toContain('title="Cancel reframe"')
    held.video = open(1920, 1080, false)
    expect(html()).toContain('title="Cancel reframe"')
  })

  it('a horizontal video with a clip selected: the panel draws the run, so the card stays empty', () => {
    held.video = open(1920, 1080)
    held.snap = { ...IDLE, reframe }
    expect(html()).toBe('<div aria-live="polite" class="-mb-5"></div>')
  })

  it('every other job keeps its rule: with a vertical video open, only the Reframe row is drawn', () => {
    held.video = open(1080, 1920)
    held.snap = { ...IDLE, reframe, gif: { jobId: 'g', name: 'Clip 1' }, scan: { name: 'a.mp4', percent: 3 } }
    const out = html()
    expect(out.match(/>Cancel<\/button>/g)).toHaveLength(1)
    expect(out).toContain('title="Cancel reframe"')
    expect(out).not.toContain('GIF')
    expect(out).not.toContain('Scan VOD')
  })

  it('a vertical video is open and no Reframe runs: still empty', () => {
    held.video = open(1080, 1920)
    held.snap = { ...IDLE, gif: { jobId: 'g', name: 'Clip 1' } }
    expect(html()).toBe('<div aria-live="polite" class="-mb-5"></div>')
  })

  it('with no video open the card is what it was: every row, and the closed-video sentence', () => {
    held.snap = { ...IDLE, reframe, gif: { jobId: 'g', name: 'Clip 1' } }
    const out = html()
    expect(out).toContain('Reframe — Clip 1')
    expect(out).toContain('GIF — Clip 1')
    expect(out).toContain('The video is closed; these jobs keep going until they finish or you cancel them.')
  })
})

describe('videoJobRows - the Export row names the person\'s file (T-164 (5))', () => {
  const batch = (sourcePath: string | null, sourceName: string | null): VideoRunSnapshot =>
    snap({ exportQueue: { running: true, jobs: [job('a')], sourcePath, sourceName } })

  it('reads sourceName, not the working copy a converted import is played from', () => {
    expect(videoJobRows(batch('/tmp/imports/stream-aB3dE5fG.mp4', 'stream.flv'))[0]?.label).toBe('Export — stream.flv: file 1 of 1')
  })

  it('falls back to the path\'s basename only when the batch carries no name', () => {
    expect(videoJobRows(batch('/v/My Stream.mp4', null))[0]?.label).toBe('Export — My Stream.mp4: file 1 of 1')
    expect(videoJobRows(batch(null, null))[0]?.label).toBe('Export: file 1 of 1')
  })
})

