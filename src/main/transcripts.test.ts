import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { countTranscripts, clearTranscripts } from './transcripts'

/**
 * T-128 (3), T-110 (s) - "Clear saved transcripts" empties the captions folder of the transcripts and of nothing else.
 *
 * Every transcription keeps its `.srt` in `<userData>/captions` for good. The folder also holds the ranged burn-in's temp copy
 * (`<name>.srt.clip-<uuid>.srt`, T-81), which belongs to a job that may be running, and it sits beside folders (`models`, `bin`) that
 * must never be reached from here. These run the real functions on real folders.
 */
let scratch = ''
let dir = ''
const UUID = '0b6f3a52-1c3e-4f0e-9d77-2f7a9c1d8e44'

function put(name: string, text = '1\n00:00:00,000 --> 00:00:01,000\nhello\n'): void {
  writeFileSync(path.join(dir, name), text, 'utf8')
}
const names = (): string[] => readdirSync(dir).sort()

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-transcripts-'))
  dir = path.join(scratch, 'captions')
  mkdirSync(dir)
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('countTranscripts', () => {
  it('counts the .srt files directly in the folder, whatever the case of the extension', async () => {
    put('stream-1700000000000.srt')
    put('Podcast-1700000000001.SRT')
    put('notes.txt')
    expect(await countTranscripts(dir)).toBe(2)
  })

  it('does not count a ranged burn-in\'s temp copy: it belongs to a job that may be running', async () => {
    put('stream-1700000000000.srt')
    put(`stream-1700000000000.srt.clip-${UUID}.srt`)
    expect(await countTranscripts(dir)).toBe(1)
  })

  it('does not count a folder named like a transcript, or anything inside a sub-folder', async () => {
    mkdirSync(path.join(dir, 'looks-like.srt'))
    writeFileSync(path.join(dir, 'looks-like.srt', 'inner.srt'), 'x', 'utf8')
    expect(await countTranscripts(dir)).toBe(0)
  })

  it('is zero for an empty folder and for a folder that is not there (a profile that never transcribed)', async () => {
    expect(await countTranscripts(dir)).toBe(0)
    expect(await countTranscripts(path.join(scratch, 'never-made'))).toBe(0)
    expect(existsSync(path.join(scratch, 'never-made')), 'counting makes no folder').toBe(false)
  })
})

describe('clearTranscripts', () => {
  it('removes every transcript and reports how many, leaving the folder in place', async () => {
    put('a-1.srt')
    put('b-2.srt')
    put('c-3.SRT')
    expect(await clearTranscripts(dir)).toEqual({ removed: 3, failed: 0 })
    expect(names()).toEqual([])
    expect(existsSync(dir), 'the folder stays: Clear empties, it does not delete').toBe(true)
    expect(await countTranscripts(dir)).toBe(0)
  })

  it('leaves everything that is not a transcript exactly where it was: other files, a temp copy, a sub-folder and its contents', async () => {
    put('a-1.srt')
    put('keep.txt', 'mine')
    put(`a-1.srt.clip-${UUID}.srt`, 'a running burn-in is reading this')
    mkdirSync(path.join(dir, 'sub'))
    writeFileSync(path.join(dir, 'sub', 'inner.srt'), 'inner', 'utf8')
    mkdirSync(path.join(dir, 'folder.srt'))
    expect(await clearTranscripts(dir)).toEqual({ removed: 1, failed: 0 })
    expect(names()).toEqual(['a-1.srt.clip-' + UUID + '.srt', 'folder.srt', 'keep.txt', 'sub'])
    expect(existsSync(path.join(dir, 'sub', 'inner.srt'))).toBe(true)
  })

  it('has nothing to do when there is nothing: zero removed, no folder made', async () => {
    expect(await clearTranscripts(dir)).toEqual({ removed: 0, failed: 0 })
    const missing = path.join(scratch, 'never-made')
    expect(await clearTranscripts(missing)).toEqual({ removed: 0, failed: 0 })
    expect(existsSync(missing)).toBe(false)
  })

  it('a transcript that will not go is counted as failed, and the rest still go', async () => {
    put('a-1.srt')
    put('b-2.srt')
    put('c-3.srt')
    const { unlink } = await import('node:fs/promises')
    const note = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await clearTranscripts(dir, async (p) => {
      if (path.basename(p) === 'b-2.srt') throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      await unlink(p)
    })
    expect(result).toEqual({ removed: 2, failed: 1 })
    expect(names()).toEqual(['b-2.srt'])
    expect(note, 'the refusal is logged for the bug report, not thrown').toHaveBeenCalledTimes(1)
    note.mockRestore()
  })

  it('does not follow a link: the captions folder itself being a link to somewhere else clears nothing there', async () => {
    const elsewhere = path.join(scratch, 'elsewhere')
    mkdirSync(elsewhere)
    writeFileSync(path.join(elsewhere, 'precious.srt'), 'not ours', 'utf8')
    const link = path.join(scratch, 'captions-link')
    symlinkSync(elsewhere, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await countTranscripts(link)).toBe(0)
    expect(await clearTranscripts(link)).toEqual({ removed: 0, failed: 0 })
    expect(existsSync(path.join(elsewhere, 'precious.srt'))).toBe(true)
  })

  it('does not follow a link inside the folder: a .srt link to a file elsewhere is neither counted nor removed, and its target survives', async () => {
    const outside = path.join(scratch, 'outside.srt')
    writeFileSync(outside, 'not ours', 'utf8')
    try {
      symlinkSync(outside, path.join(dir, 'linked.srt'), 'file')
    } catch {
      return // a machine that refuses file links without a privilege (Windows without developer mode) has nothing to prove here
    }
    put('real-1.srt')
    expect(await countTranscripts(dir)).toBe(1)
    expect(await clearTranscripts(dir)).toEqual({ removed: 1, failed: 0 })
    expect(existsSync(outside), 'the file the link pointed at is not ours and is untouched').toBe(true)
    expect(names()).toEqual(['linked.srt'])
  })
})
