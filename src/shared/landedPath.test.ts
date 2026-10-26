import { describe, it, expect } from 'vitest'
import { landedBesideNote } from './landedPath'

/**
 * T-140 (1) - when the file the person chose could not be replaced (it is open in another app) the render is kept beside it under the next free name,
 * and the panel says so in one sentence. This is that sentence, so the audio export, the re-attach, the burn-in and the recording all say it alike.
 */
describe('landedBesideNote', () => {
  it('names the file that was chosen and the file it was saved as, in one sentence', () => {
    expect(landedBesideNote('C:\\Users\\mak\\Music\\cleaned.mp3', 'C:\\Users\\mak\\Music\\cleaned (2).mp3', 'export')).toBe(
      'cleaned.mp3 is open in another app, so this export was saved as cleaned (2).mp3.'
    )
  })

  it('reads a POSIX path the same way', () => {
    expect(landedBesideNote('/home/mak/Videos/stream-captioned.mp4', '/home/mak/Videos/stream-captioned (3).mp4', 'burn-in')).toBe(
      'stream-captioned.mp4 is open in another app, so this burn-in was saved as stream-captioned (3).mp4.'
    )
  })

  it('says the kind of job it is told to: an export, a burn-in, a recording', () => {
    for (const what of ['export', 'burn-in', 'recording']) {
      expect(landedBesideNote('/a/take.webm', '/a/take (2).webm', what)).toContain(`so this ${what} was saved as take (2).webm.`)
    }
  })

  it('has nothing to say when the file landed where it was chosen', () => {
    expect(landedBesideNote('/a/cleaned.mp3', '/a/cleaned.mp3', 'export')).toBeNull()
    expect(landedBesideNote('C:\\a\\cleaned.mp3', 'C:\\a\\cleaned.mp3', 'export')).toBeNull()
  })

  it('has nothing to say when the chosen path is not known (a recording that was saved where it was asked to be)', () => {
    expect(landedBesideNote(undefined, '/a/take.webm', 'recording')).toBeNull()
  })

  it('is ONE sentence (it ends at its only full stop, so it can follow the completion sentence) and names no folder', () => {
    const note = landedBesideNote('/very/long/folder/cleaned.mp3', '/very/long/folder/cleaned (2).mp3', 'export') ?? ''
    expect(note.endsWith('.')).toBe(true)
    expect(note, 'no full stop followed by a space: nothing inside it starts a second sentence').not.toMatch(/\.\s/)
    expect(note).not.toContain('folder')
  })
})
