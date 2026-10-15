import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discardPartialOutput } from './partialOutput'

/**
 * T-100 — what a failed or canceled job is allowed to delete: the file it was
 * writing, and nothing it did not write. Real files in a real folder (the
 * helper is two fs calls; a mock would test the mock).
 */
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imagii-partial-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fileWithAge(name: string, ageMs: number): string {
  const file = path.join(dir, name)
  writeFileSync(file, 'moov-less wreckage')
  const when = new Date(Date.now() - ageMs)
  utimesSync(file, when, when)
  return file
}

describe('discardPartialOutput', () => {
  it('removes the file a spawned job was writing', async () => {
    const spawnedAt = Date.now() - 1000
    const file = fileWithAge('out.mp4', 0)
    await discardPartialOutput(file, spawnedAt)
    expect(existsSync(file)).toBe(false)
  })

  it('does nothing for a job that never spawned a child', async () => {
    // A job canceled in its probe never touched the path — it may be last
    // week's export of the same name.
    const file = fileWithAge('out.mp4', 0)
    await discardPartialOutput(file, null)
    expect(existsSync(file)).toBe(true)
  })

  it('leaves a file that predates the spawn: ffmpeg had not opened its output yet', async () => {
    const spawnedAt = Date.now()
    const file = fileWithAge('last-weeks.mp4', 60 * 60 * 1000)
    await discardPartialOutput(file, spawnedAt)
    expect(existsSync(file)).toBe(true)
  })

  it('tolerates the coarsest timestamp a drive keeps (FAT rounds to 2 s)', async () => {
    const spawnedAt = Date.now()
    const file = fileWithAge('fat.mp4', 1900)
    await discardPartialOutput(file, spawnedAt)
    expect(existsSync(file)).toBe(false)
  })

  it('is quiet when there is nothing there', async () => {
    await expect(
      discardPartialOutput(path.join(dir, 'never-created.mp4'), Date.now())
    ).resolves.toBeUndefined()
  })

  it('never removes a folder that sits at the path', async () => {
    const folder = path.join(dir, 'looks-like-a-file.mp4')
    mkdirSync(folder)
    await discardPartialOutput(folder, Date.now() - 1000)
    expect(existsSync(folder)).toBe(true)
  })

  it('removes only its own path — earlier jobs\' finished files stay', async () => {
    const spawnedAt = Date.now() - 1000
    const finished = fileWithAge('job-1.mp4', 0)
    const partial = fileWithAge('job-2.mp4', 0)
    await discardPartialOutput(partial, spawnedAt)
    expect(existsSync(partial)).toBe(false)
    expect(existsSync(finished)).toBe(true)
  })
})
