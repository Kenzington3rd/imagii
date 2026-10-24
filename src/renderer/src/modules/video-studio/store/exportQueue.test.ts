import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import toast from 'react-hot-toast'
import type { ExportJobSpec } from '@shared/clip'
import { CANCELLED_MESSAGE } from '@shared/cancel'
import { runExportBatch, useExportQueue, type JobStatus } from './exportQueue'

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
