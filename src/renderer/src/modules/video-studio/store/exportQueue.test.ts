import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import toast from 'react-hot-toast'
import type { ExportJobSpec } from '@shared/clip'
import { CANCELLED_MESSAGE } from '@shared/cancel'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactNode } from 'react'
import { useVideoStore } from './videoStore'
import { cancelExportBatch, exportCanceledMessage, remainingExportJobs, requestExportCancel, runExportBatch, useExportQueue, type JobStatus } from './exportQueue'

/**
 * T-135 (1) - the Export queue is a module store and its batch runs outside any component.
 *
 * The rows and the running flag were the panel's `useState`, and the progress / completion listeners were its effect's, so leaving Video
 * Studio mid-batch lost the rows (the panel came back idle, Export enabled, no Cancel) and every event that arrived while it was away. Here
 * the listeners are the batch's own, for exactly as long as it runs, and the rows are the store's: nothing in these cases is a component.
 */

interface Bridge {
  progress: Array<(p: { jobId: string; percent: number }) => void>
  complete: Array<(p: { jobId: string; outputPath: string }) => void>
  exportBatch: (queue: ExportJobSpec[]) => Promise<unknown>
}

function row(jobId: string, over: Partial<JobStatus> = {}): JobStatus {
  return { jobId, clipName: 'Clip 1', presetLabel: 'YouTube', percent: 0, ...over }
}
const spec = (jobId: string): ExportJobSpec => ({ jobId }) as unknown as ExportJobSpec

function install(exportBatch: Bridge['exportBatch']): Bridge {
  const bridge: Bridge = { progress: [], complete: [], exportBatch }
  vi.stubGlobal('window', {
    api: {
      video: {
        onProgress: (cb: Bridge['progress'][number]) => {
          bridge.progress.push(cb)
          return () => void bridge.progress.splice(bridge.progress.indexOf(cb), 1)
        },
        onJobComplete: (cb: Bridge['complete'][number]) => {
          bridge.complete.push(cb)
          return () => void bridge.complete.splice(bridge.complete.indexOf(cb), 1)
        },
        exportBatch: (queue: ExportJobSpec[]) => bridge.exportBatch(queue)
      },
      settings: { set: async () => undefined }
    }
  })
  return bridge
}

function gate<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  useExportQueue.setState({ jobs: [], running: false, sourcePath: null })
  vi.spyOn(toast, 'success').mockImplementation(() => 'id')
  vi.spyOn(toast, 'error').mockImplementation(() => 'id')
  vi.spyOn(toast, 'custom').mockImplementation(() => 'id')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('runExportBatch - a batch the panel does not have to be mounted for (T-135 (1))', () => {
  it('shows the rows as running from the first moment, and keeps drawing the events that arrive with no panel anywhere', async () => {
    const held = gate<unknown[]>()
    const bridge = install(() => held.promise)
    const done = runExportBatch({ queue: [spec('a'), spec('b')], statuses: [row('a'), row('b')], dir: '/out', sourcePath: '/v/a.mp4' })
    expect(useExportQueue.getState().running).toBe(true)
    expect(useExportQueue.getState().jobs.map((j) => j.percent)).toEqual([0, 0])

    bridge.progress[0]?.({ jobId: 'a', percent: 40 })
    bridge.complete[0]?.({ jobId: 'a', outputPath: '/out/a.mp4' })
    bridge.progress[0]?.({ jobId: 'b', percent: 10 })
    expect(useExportQueue.getState().jobs).toEqual([row('a', { percent: 100, outputPath: '/out/a.mp4' }), row('b', { percent: 10 })])

    held.resolve([])
    await done
    expect(useExportQueue.getState().running).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Exported 2 files')
    // The finished rows stay (they carry "Show in folder"), and the listeners are gone with the batch.
    expect(useExportQueue.getState().jobs).toHaveLength(2)
    expect(bridge.progress).toHaveLength(0)
    expect(bridge.complete).toHaveLength(0)
  })

  it('is single-flight in the store: a second batch while one runs is not started and does not touch the rows', async () => {
    const held = gate<unknown[]>()
    const calls: string[][] = []
    install((queue) => {
      calls.push(queue.map((q) => q.jobId))
      return held.promise
    })
    const first = runExportBatch({ queue: [spec('a')], statuses: [row('a')], dir: '/out', sourcePath: '/v/a.mp4' })
    await runExportBatch({ queue: [spec('z')], statuses: [row('z')], dir: '/out', sourcePath: '/v/a.mp4' })
    expect(calls).toEqual([['a']])
    expect(useExportQueue.getState().jobs.map((j) => j.jobId)).toEqual(['a'])
    held.resolve([])
    await first
  })

  it('a failure marks the first unfinished row Failed with the sentence and the ones behind it Not run, and frees the queue', async () => {
    const bridge = install(() => Promise.reject(new Error('FFmpeg exit 1: Conversion failed!')))
    await runExportBatch({ queue: [spec('a'), spec('b')], statuses: [row('a'), row('b')], dir: '/out', sourcePath: '/v/a.mp4' })
    const [a, b] = useExportQueue.getState().jobs
    expect(a?.error).toMatch(/Export failed\./)
    expect(a?.canceled).toBeUndefined()
    expect(b?.notRun).toBe(true)
    expect(useExportQueue.getState().running).toBe(false)
    expect(bridge.progress).toHaveLength(0)
    expect(toast.error).toHaveBeenCalled()
  })

  it('a cancel marks every unfinished row Canceled, in the batch\'s own words, and finished rows keep their file', async () => {
    const held = gate()
    const bridge = install(() => held.promise)
    const done = runExportBatch({ queue: [spec('a'), spec('b')], statuses: [row('a'), row('b')], dir: '/out', sourcePath: '/v/a.mp4' })
    bridge.complete[0]?.({ jobId: 'a', outputPath: '/out/a.mp4' })
    held.reject(new Error(CANCELLED_MESSAGE))
    await done
    const [a, b] = useExportQueue.getState().jobs
    expect(a).toEqual(row('a', { percent: 100, outputPath: '/out/a.mp4' }))
    expect(b?.canceled).toBe(true)
    expect(b?.error).toBe('Export canceled. Files already finished are in your folder.')
    expect(useExportQueue.getState().running).toBe(false)
  })

  // The call can answer before its last job-complete event is dispatched, and this batch's listeners are gone by then: the rows would stay at
  // 100% with no file and no "Show in folder" (the panel's old always-on listener caught the late event). The call's own results are the record.
  it('takes each row\'s file from the batch\'s own results, so an event that lands after the call resolved is not needed', async () => {
    install(() => Promise.resolve([{ jobId: 'a', outputPath: '/out/a (2).mp4', durationMs: 5 }]))
    await runExportBatch({ queue: [spec('a')], statuses: [row('a')], dir: '/out', sourcePath: '/v/a.mp4' })
    expect(useExportQueue.getState().jobs).toEqual([row('a', { percent: 100, outputPath: '/out/a (2).mp4' })])
  })

  it('the next batch replaces the rows of the last one', async () => {
    install(() => Promise.resolve([]))
    await runExportBatch({ queue: [spec('a')], statuses: [row('a')], dir: '/out', sourcePath: '/v/a.mp4' })
    await runExportBatch({ queue: [spec('c')], statuses: [row('c')], dir: '/out', sourcePath: '/v/a.mp4' })
    expect(useExportQueue.getState().jobs.map((j) => j.jobId)).toEqual(['c'])
  })

  it('remembers the video the batch was made from, so a panel can show its rows for that video and no other', async () => {
    install(() => Promise.resolve([]))
    await runExportBatch({ queue: [spec('a')], statuses: [row('a')], dir: '/out', sourcePath: '/v/a.mp4' })
    expect(useExportQueue.getState().sourcePath).toBe('/v/a.mp4')
  })
})

describe('the Export Cancel - one path for the panel and the closed video\'s card (T-144)', () => {
  const cancelAll = vi.fn()
  beforeEach(() => {
    cancelAll.mockReset()
    vi.stubGlobal('window', { api: { video: { cancelAll } } })
  })

  it('counts the jobs still to finish: not a finished one, not a failed or canceled one', () => {
    expect(remainingExportJobs([])).toBe(0)
    expect(remainingExportJobs([row('a', { percent: 100 }), row('b'), row('c', { percent: 40 }), row('d', { error: 'x' }), row('e', { error: 'y', canceled: true })])).toBe(2)
  })

  it('one job left stops the batch at once, with no question', () => {
    useExportQueue.setState({ jobs: [row('a', { percent: 100 }), row('b', { percent: 30 })], running: true, sourcePath: '/v/a.mp4' })
    const ask = vi.fn()
    requestExportCancel(ask)
    expect(cancelAll).toHaveBeenCalledTimes(1)
    expect(ask).not.toHaveBeenCalled()
  })

  it('two or more left ask first and stop nothing until the question is answered', () => {
    useExportQueue.setState({ jobs: [row('a'), row('b')], running: true, sourcePath: '/v/a.mp4' })
    const ask = vi.fn()
    requestExportCancel(ask)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(cancelAll).not.toHaveBeenCalled()
    cancelExportBatch()
    expect(cancelAll).toHaveBeenCalledTimes(1)
  })
})

describe('the finished toast of a batch always carries the way to its first file (T-145, T-146)', () => {
  const results = [
    { jobId: 'a', outputPath: '/out/a.mp4', durationMs: 5 },
    { jobId: 'b', outputPath: '/out/b.mp4', durationMs: 5 }
  ]
  const run = async (): Promise<void> => {
    install(() => Promise.resolve(results))
    await runExportBatch({ queue: [spec('a'), spec('b')], statuses: [row('a'), row('b')], dir: '/out', sourcePath: '/v/a.mp4' })
  }
  /** Every <button> in the element the toast carries, with its onClick. */
  const buttons = (node: ReactNode, found: Array<{ text: string; onClick: () => void }> = []): Array<{ text: string; onClick: () => void }> => {
    if (Array.isArray(node)) node.forEach((n) => buttons(n, found))
    else if (isValidElement(node)) {
      const props = node.props as { children?: ReactNode; onClick?: () => void }
      if (node.type === 'button' && props.onClick) found.push({ text: renderToStaticMarkup(node).replace(/<[^>]+>/g, ''), onClick: props.onClick })
      else buttons(props.children, found)
    }
    return found
  }

  it('says how many files and carries Show in folder for the FIRST file written, which reveals it', async () => {
    const reveal = vi.fn()
    useVideoStore.setState({ source: null })
    await run()
    const reveal1 = (window as unknown as { api: { video: Record<string, unknown> } }).api.video
    reveal1.revealInFolder = reveal
    const [message, options] = vi.mocked(toast.success).mock.calls[0] as [ReactNode, { duration?: number }]
    expect(renderToStaticMarkup(message as never)).toContain('Exported 2 files')
    expect(options.duration, 'a toast with a button lasts long enough to use it').toBeGreaterThan(2000)
    const found = buttons(message)
    expect(found.map((b) => b.text)).toEqual(['Show in folder'])
    found[0]?.onClick()
    expect(reveal).toHaveBeenCalledWith('/out/a.mp4')
  })

  it('carries it with a video open too: a batch also ends on another route or beside another video, where the panel\'s rows are not for it (T-146)', async () => {
    useVideoStore.setState({ source: { filePath: '/v/other.mp4' } as never })
    try {
      await run()
    } finally {
      useVideoStore.setState({ source: null })
    }
    const [message] = vi.mocked(toast.success).mock.calls[0] as [ReactNode]
    expect(renderToStaticMarkup(message as never)).toContain('Exported 2 files')
    expect(buttons(message).map((b) => b.text)).toEqual(['Show in folder'])
  })

  it('reveals the first file that WAS written, skipping a result with no path', async () => {
    const reveal = vi.fn()
    install(() => Promise.resolve([{ jobId: 'a', outputPath: '', durationMs: 1 }, { jobId: 'b', outputPath: '/out/b.mp4', durationMs: 1 }]))
    ;(window as unknown as { api: { video: Record<string, unknown> } }).api.video.revealInFolder = reveal
    await runExportBatch({ queue: [spec('a'), spec('b')], statuses: [row('a'), row('b')], dir: '/out', sourcePath: '/v/a.mp4' })
    const [message] = vi.mocked(toast.success).mock.calls[0] as [ReactNode]
    buttons(message)[0]?.onClick()
    expect(reveal).toHaveBeenCalledWith('/out/b.mp4')
  })

  it('a batch that wrote no file says the plain sentence and offers nothing to reveal', async () => {
    install(() => Promise.resolve([]))
    await runExportBatch({ queue: [spec('a'), spec('b')], statuses: [row('a'), row('b')], dir: '/out', sourcePath: '/v/a.mp4' })
    expect(toast.success).toHaveBeenCalledWith('Exported 2 files')
  })
})

describe('exportCanceledMessage - what a canceled batch says depends on what survived (T-162 (3))', () => {
  it('says only that it was canceled when no file had finished, and never points at a folder', () => {
    expect(exportCanceledMessage(0)).toBe('Export canceled.')
    expect(exportCanceledMessage(0)).not.toMatch(/folder/)
  })

  it('names the folder once any file had finished', () => {
    for (const finished of [1, 2, 20]) {
      expect(exportCanceledMessage(finished)).toBe('Export canceled. Files already finished are in your folder.')
    }
  })

  it('a cancel during the FIRST job leaves its row saying only that it was canceled', async () => {
    const held = gate()
    install(() => held.promise)
    const done = runExportBatch({ queue: [spec('a'), spec('b')], statuses: [row('a'), row('b')], dir: '/out', sourcePath: '/v/a.mp4' })
    held.reject(new Error(CANCELLED_MESSAGE))
    await done
    const [a, b] = useExportQueue.getState().jobs
    expect(a?.error).toBe('Export canceled.')
    expect(b?.error).toBe('Export canceled.')
    expect(a?.canceled && b?.canceled).toBe(true)
  })

  it('a cancel after the first file finished keeps the folder sentence on the rows left', async () => {
    const held = gate()
    const bridge = install(() => held.promise)
    const done = runExportBatch({ queue: [spec('a'), spec('b')], statuses: [row('a'), row('b')], dir: '/out', sourcePath: '/v/a.mp4' })
    bridge.complete[0]?.({ jobId: 'a', outputPath: '/out/a.mp4' })
    held.reject(new Error(CANCELLED_MESSAGE))
    await done
    expect(useExportQueue.getState().jobs[1]?.error).toBe('Export canceled. Files already finished are in your folder.')
  })
})
