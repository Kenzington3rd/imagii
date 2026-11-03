import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  cancelCaptionsJob,
  cancelCompile,
  cancelGif,
  cancelModelInstall,
  cancelPip,
  cancelReframe,
  cancelScan,
  useCompileRun,
  useGifRun,
  usePipRun,
  useReframeRun
} from './runs'

/**
 * T-144 - the Cancel of each long job is a function beside its run store, and the panel's button and the closed video's card call the SAME one. Each reads the
 * id off the run when it is pressed (a job that is not running is a no-op) and aims main's cancel at it.
 */
const api = {
  video: { cancelReframe: vi.fn(), cancelGif: vi.fn(), cancelConcat: vi.fn(), cancelPip: vi.fn(), cancelHighlight: vi.fn() },
  captions: { cancelBurnIn: vi.fn(), cancelTranscribe: vi.fn(), cancelInstall: vi.fn() }
}
beforeEach(() => {
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', { api })
  useReframeRun.getState().end()
  useGifRun.getState().end()
  useCompileRun.getState().end()
  usePipRun.getState().end()
})

describe('the job Cancels beside the run stores (T-144)', () => {
  it('each one aims main\'s cancel at the id of the run that is there', async () => {
    useReframeRun.getState().begin({ jobId: 'r1', name: 'c', percent: null, phase: 'starting' })
    useGifRun.getState().begin({ jobId: 'g1', name: 'c' })
    useCompileRun.getState().begin({ jobId: 'c1', name: 'c' })
    usePipRun.getState().begin({ jobId: 'p1', name: 'c' })
    await cancelReframe()
    await cancelGif()
    await cancelCompile()
    await cancelPip()
    expect(api.video.cancelReframe).toHaveBeenCalledWith('r1')
    expect(api.video.cancelGif).toHaveBeenCalledWith('g1')
    expect(api.video.cancelConcat).toHaveBeenCalledWith('c1')
    expect(api.video.cancelPip).toHaveBeenCalledWith('p1')
  })

  it('a job that is not running is nothing to cancel: main is not asked', async () => {
    await cancelReframe()
    await cancelGif()
    await cancelCompile()
    await cancelPip()
    for (const fn of Object.values(api.video)) expect(fn).not.toHaveBeenCalled()
  })

  it('the single-slot ones need no id, and the captions Cancel is the transcription\'s or the burn-in\'s', () => {
    cancelScan()
    expect(api.video.cancelHighlight).toHaveBeenCalledTimes(1)
    cancelCaptionsJob('transcribe')
    expect(api.captions.cancelTranscribe).toHaveBeenCalledTimes(1)
    expect(api.captions.cancelBurnIn).not.toHaveBeenCalled()
    cancelCaptionsJob('burn-in')
    expect(api.captions.cancelBurnIn).toHaveBeenCalledTimes(1)
    cancelModelInstall()
    expect(api.captions.cancelInstall).toHaveBeenCalledTimes(1)
  })
})
