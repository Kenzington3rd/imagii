import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cancelAudioExport, useAudioExport } from './audioExport'

/**
 * T-135 (1) - the audio export's row and its running flag are a module store.
 *
 * They were the dialog's `useState` and its progress listener was its effect's, so leaving Audio Studio mid-export lost the row, the bar and the
 * Cancel (the dialog came back idle with Export enabled while main kept rendering), and the events that arrived meanwhile.
 */
describe('useAudioExport - an export the dialog does not have to be mounted for (T-135 (1))', () => {
  beforeEach(() => {
    useAudioExport.setState({ job: null, running: false, sourceKey: null, sourceName: null })
  })

  const start = (jobId = 'a'): boolean =>
    useAudioExport.getState().begin({ jobId, pass: 'render', plan: ['render'], percent: 0 }, '/s/voice.wav', 'voice.wav')

  it('begin shows the row as running and remembers the file it was made for', () => {
    expect(start()).toBe(true)
    expect(useAudioExport.getState().running).toBe(true)
    expect(useAudioExport.getState().job).toEqual({ jobId: 'a', pass: 'render', plan: ['render'], percent: 0 })
    expect(useAudioExport.getState().sourceKey).toBe('/s/voice.wav')
    expect(useAudioExport.getState().sourceName, 'and the name the person knows it by, for the closed-sound card').toBe('voice.wav')
  })

  it('is single-flight: a second export while one runs is refused and does not touch the row', () => {
    start('a')
    expect(start('b')).toBe(false)
    expect(useAudioExport.getState().job?.jobId).toBe('a')
  })

  it('progress merges into the row of the running job - and only that job\'s events', () => {
    start('a')
    useAudioExport.getState().progress({ jobId: 'a', pass: 'measure', percent: 30, timemark: '00:00:03.00' })
    expect(useAudioExport.getState().job).toMatchObject({ jobId: 'a', pass: 'measure', percent: 30 })
    useAudioExport.getState().progress({ jobId: 'someone-else', pass: 'render', percent: 90 })
    expect(useAudioExport.getState().job).toMatchObject({ pass: 'measure', percent: 30 })
  })

  it('done fills the row to 100% with the file; the row stays after the export ends (it carries "Show in folder")', () => {
    start('a')
    useAudioExport.getState().done('/out/voice-cleaned.mp3')
    useAudioExport.getState().finish()
    expect(useAudioExport.getState().running).toBe(false)
    expect(useAudioExport.getState().job).toMatchObject({ percent: 100, outputPath: '/out/voice-cleaned.mp3' })
  })

  it('fail keeps the sentence and whether it was the person\'s own Cancel (a Failed row is red, a Canceled one is not)', () => {
    start('a')
    useAudioExport.getState().fail({ error: 'Audio export canceled.', canceled: true })
    useAudioExport.getState().finish()
    expect(useAudioExport.getState().job).toMatchObject({ error: 'Audio export canceled.', canceled: true })
    expect(useAudioExport.getState().running).toBe(false)
  })

  it('the next export replaces the last one\'s row', () => {
    start('a')
    useAudioExport.getState().done('/out/a.mp3')
    useAudioExport.getState().finish()
    expect(start('b')).toBe(true)
    expect(useAudioExport.getState().job).toEqual({ jobId: 'b', pass: 'render', plan: ['render'], percent: 0 })
  })

  it('events with no export running change nothing (a late progress line)', () => {
    useAudioExport.getState().progress({ jobId: 'a', pass: 'render', percent: 50 })
    useAudioExport.getState().done('/out/x.mp3')
    useAudioExport.getState().fail({ error: 'x', canceled: false })
    expect(useAudioExport.getState().job).toBeNull()
  })

  it('a row that is left over from a finished export is not rewritten by a line that arrives after it (progress, done, fail)', () => {
    start('a')
    useAudioExport.getState().progress({ jobId: 'a', pass: 'render', percent: 80 })
    useAudioExport.getState().fail({ error: 'Export canceled.', canceled: true })
    useAudioExport.getState().finish()
    const left = useAudioExport.getState().job
    useAudioExport.getState().progress({ jobId: 'a', pass: 'render', percent: 99 })
    useAudioExport.getState().done('/out/late.mp3')
    useAudioExport.getState().fail({ error: 'a different sentence', canceled: false })
    expect(useAudioExport.getState().job, 'the Canceled row is as the export left it').toBe(left)
    expect(useAudioExport.getState().job?.outputPath).toBeUndefined()
  })
})

describe('cancelAudioExport - the one Cancel the dialog and the closed-sound card share (T-146)', () => {
  const cancel = vi.fn()
  beforeEach(() => {
    useAudioExport.setState({ job: null, running: false, sourceKey: null, sourceName: null })
    cancel.mockReset()
    cancel.mockResolvedValue(undefined)
    vi.stubGlobal('window', { api: { audio: { cancel } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('asks main to stop the job that is running, by the id the store holds when it is pressed', async () => {
    useAudioExport.getState().begin({ jobId: 'a', pass: 'render', plan: ['render'], percent: 0 }, '/s/voice.wav', 'voice.wav')
    await cancelAudioExport()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('a')
  })

  it('reads the id at press time: the next export is the one it stops', async () => {
    useAudioExport.getState().begin({ jobId: 'a', pass: 'render', plan: ['render'], percent: 0 }, '/s/voice.wav', 'voice.wav')
    useAudioExport.getState().finish()
    useAudioExport.getState().begin({ jobId: 'b', pass: 'render', plan: ['render'], percent: 0 }, '/s/voice.wav', 'voice.wav')
    await cancelAudioExport()
    expect(cancel).toHaveBeenCalledWith('b')
  })

  it('does nothing with no export running, and a row left over from a finished one is not a job to stop', async () => {
    await cancelAudioExport()
    useAudioExport.getState().begin({ jobId: 'a', pass: 'render', plan: ['render'], percent: 0 }, '/s/voice.wav', 'voice.wav')
    useAudioExport.getState().finish()
    await cancelAudioExport()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('a refusal from main is swallowed: the export call rejecting on the kill is the signal', async () => {
    cancel.mockRejectedValue(new Error('no such job'))
    useAudioExport.getState().begin({ jobId: 'a', pass: 'render', plan: ['render'], percent: 0 }, '/s/voice.wav', 'voice.wav')
    await expect(cancelAudioExport()).resolves.toBeUndefined()
  })
})

describe('useAudioExport - the export remembers the sound\'s identity, not the scratch file it read (T-172 Track C)', () => {
  beforeEach(() => {
    useAudioExport.setState({ job: null, running: false, sourceKey: null, sourceName: null })
  })

  it('begin keeps the key it is given (the file the person opened), and a later begin replaces it', () => {
    useAudioExport.getState().begin({ jobId: 'a', pass: 'render', plan: ['render'], percent: 0 }, '/v/stream.mp4', 'stream.mp4')
    expect(useAudioExport.getState().sourceKey).toBe('/v/stream.mp4')
    useAudioExport.getState().finish()
    useAudioExport.getState().begin({ jobId: 'b', pass: 'render', plan: ['render'], percent: 0 }, '/m/take.wma', 'take.wma')
    expect(useAudioExport.getState().sourceKey).toBe('/m/take.wma')
    expect(useAudioExport.getState().sourceName).toBe('take.wma')
  })

  it('a refused begin (one is running) leaves the first export\'s key alone', () => {
    useAudioExport.getState().begin({ jobId: 'a', pass: 'render', plan: ['render'], percent: 0 }, '/v/stream.mp4', 'stream.mp4')
    expect(useAudioExport.getState().begin({ jobId: 'b', pass: 'render', plan: ['render'], percent: 0 }, '/v/other.mp4', 'other.mp4')).toBe(false)
    expect(useAudioExport.getState().sourceKey).toBe('/v/stream.mp4')
  })
})
