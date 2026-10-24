import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discardPartialOutput, wroteOutput } from './partialOutput'

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

// T-133 (5): `wroteOutput` carried the discard path's 2 s mtime slack onto the SUCCESS path. A Clip Kit thumbnail written onto a share whose
// clock runs more than 2 s behind this machine's looked older than the spawn and was refused as "no picture", aborting the kit over a GOOD file
// (the cost T-110 (p) documents - "a leftover file, never a lost one" - held only for the discard). `extractFrame` writes into a folder
// `makeKitDir` has just made and refuses a target that already exists, so what is at the path afterwards is this run's: the file is judged by
// what it is, not by when it says it was written.
describe('wroteOutput - a real, non-empty file is the run\'s output, whatever its clock says (T-133 (5))', () => {
  it('a non-empty file is written output, however old its timestamp reads (a clock running behind)', async () => {
    expect(await wroteOutput(fileWithAge('behind.jpg', 0))).toBe(true)
    expect(await wroteOutput(fileWithAge('ten-seconds-behind.jpg', 10_000))).toBe(true)
    expect(await wroteOutput(fileWithAge('an-hour-behind.jpg', 60 * 60 * 1000))).toBe(true)
  })

  it('nothing, an empty file, and a folder are not', async () => {
    expect(await wroteOutput(path.join(dir, 'never-created.jpg'))).toBe(false)
    const empty = path.join(dir, 'empty.jpg')
    writeFileSync(empty, '')
    expect(await wroteOutput(empty)).toBe(false)
    const folder = path.join(dir, 'looks-like-a-file.jpg')
    mkdirSync(folder)
    expect(await wroteOutput(folder)).toBe(false)
  })
})
