import { describe, it, expect, vi, afterEach } from 'vitest'
import { userFacingError } from '../../shared/userFacingError'

/**
 * T-170 (3b) - a transcribe pressed over a missing engine or model is refused with a sentence the person is shown whole.
 *
 * The panel's cached "ready" can be stale over a file the person deleted (the setup card itself tells them to delete the model to replace it). The refusal used to be
 * "Whisper not installed (see Captions setup)" - no closing period, so `isFinishedSentence` dropped it and no known cause matched: the toast read the bare
 * "Transcription failed.". `paths` is stubbed with the model file absent (the engine present, so the missing model is the whole refusal), which is what
 * `getCaptionsStatus` reads; nothing else of the runner is replaced.
 */

let modelExists = false
let engineExists = false

vi.mock('electron', () => ({
  app: { getPath: () => '/x', isPackaged: false },
  net: { request: () => ({}) }
}))
vi.mock('./paths', () => ({
  whisperExePath: () => ({ path: '/x/whisper-cli.exe', exists: engineExists, sizeBytes: 1 }),
  whisperModelPath: () => ({ path: '/x/model.bin', exists: modelExists, sizeBytes: 1 }),
  captionsOutputDir: () => '/x/captions',
  modelsDir: () => '/x/models'
}))

const { runTranscribe, __whisperTranscribeTesting__ } = await import('./whisperManager')

const REFUSAL = 'The captions engine or the English model is missing. Captions setup in the Captions panel says what to add.'

afterEach(() => {
  __whisperTranscribeTesting__.setTranscribeInProgressForTest(false)
})

async function refusal(): Promise<unknown> {
  return runTranscribe({ jobId: 't170', sourcePath: 'C:/test.mp4' }, () => undefined).then(
    () => null,
    (e: unknown) => e
  )
}

describe('runTranscribe - the refusal over a missing engine or model (T-170 (3))', () => {
  it.each([
    ['the model file is gone', true, false],
    ['the engine is gone', false, true],
    ['both are gone', false, false]
  ])('%s: the refusal is a finished sentence that says where the instructions are, shown as it stands', async (_what, engine, model) => {
    engineExists = engine
    modelExists = model
    const err = await refusal()
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(REFUSAL)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(userFacingError(err, 'Transcription failed.').message).toBe(REFUSAL)
    } finally {
      logged.mockRestore()
    }
  })

  it('a refusal does not leave the run claimed', async () => {
    engineExists = true
    modelExists = false
    await refusal()
    expect(__whisperTranscribeTesting__.isTranscribeInProgress()).toBe(false)
  })
})
