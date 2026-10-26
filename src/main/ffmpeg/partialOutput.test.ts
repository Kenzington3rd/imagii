import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CancelledError, isCancelledError } from '../../shared/cancel'

/**
 * `fs.promises.rename` is real unless a test sets `renameHook`: the retry rows need a rename that is refused the way Windows refuses one while a scanner holds the
 * new file (EBUSY / EPERM / EACCES), and Linux cannot be made to do that for real. Every other row here runs on real files in a real folder.
 */
let renameHook: ((real: typeof import('node:fs/promises').rename, from: string, to: string) => Promise<void>) | null = null
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: (from: string, to: string) => (renameHook ? renameHook(actual.rename, from, to) : actual.rename(from, to))
  }
})

const {
  COMMIT_RETRY_DELAYS_MS,
  PARTIAL_OUTPUT,
  commitPartial,
  discardPartial,
  finishPartial,
  partialPathFor,
  wroteOutput
} = await import('./partialOutput')

/**
 * T-140 (1) - a render is written to a PARTIAL beside its target and renamed over it only when whole.
 *
 * ffmpeg truncates the file it opens, so a runner that opened the target and was stopped (a Cancel, the quit, a full disk) left neither the
 * old file nor the new one: executed, a 100,000-byte file was gone after `cancelAudioJob` and after ENOSPC (exit 228). The runners now hand
 * ffmpeg `partialPathFor(target)` and call `finishPartial`, which swaps the partial in only after the run's own checks passed and the run's
 * cancel latch says go. These are the helper's rules, on real files: the runners' use of it is `cancelSentinel.test.ts` (every runner, a fake
 * child), `partialRunners.test.ts` (the compilation's join), and Layer 5 (the real binary on both majors).
 */
let dir = ''
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const names = (): string[] => readdirSync(dir).sort()
const live = { check: (): void => undefined }
const cancelled = {
  check: (): void => {
    throw new CancelledError()
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imagii-partial-'))
  renameHook = null
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(name: string, text = 'bytes'): string {
  const file = path.join(dir, name)
  writeFileSync(file, text)
  return file
}

describe('partialPathFor - the name ffmpeg is handed', () => {
  it('is <stem>.<8 hex>.partial<ext> in the target\'s own folder', () => {
    const target = path.join(dir, 'My Clip.mp4')
    const partial = partialPathFor(target)
    expect(path.dirname(partial), 'the same folder: a rename across volumes is not atomic').toBe(dir)
    expect(path.basename(partial)).toMatch(/^My Clip\.[0-9a-f]{8}\.partial\.mp4$/)
  })

  // ffmpeg picks the muxer from the extension of the path it is given. Layer 5 proves, per format, on both majors, that the partial's muxer is the
  // target's (T-140 (1): "a partial of every format a runner writes is read as that format"); here is the rule that makes it true.
  it.each(['mp4', 'gif', 'mp3', 'wav', 'm4a', 'flac', 'ogg', 'mkv', 'webm', 'MP4', 'cleaned.wav'])('keeps the extension LAST: .%s', (ext) => {
    const target = path.join(dir, `name.${ext}`)
    const partial = partialPathFor(target)
    expect(path.extname(partial)).toBe(path.extname(target))
    expect(partial.endsWith(`.partial.${ext.split('.').pop()}`)).toBe(true)
  })

  it('is new on every call, so two jobs aimed at one target do not share a partial', () => {
    const target = path.join(dir, 'a.mp4')
    expect(new Set(Array.from({ length: 50 }, () => partialPathFor(target))).size).toBe(50)
  })

  it('a target with no extension gets a partial with none (the same refusal ffmpeg would have given the target)', () => {
    const partial = partialPathFor(path.join(dir, 'noext'))
    expect(path.basename(partial)).toMatch(/^noext\.[0-9a-f]{8}\.partial$/)
  })

  it('is matched by PARTIAL_OUTPUT, which the e2e listing helpers filter on, and the target is not', () => {
    for (const name of ['a.mp4', 'a b.gif', 'x.cleaned.wav', 'noext']) {
      const target = path.join(dir, name)
      expect(PARTIAL_OUTPUT.test(partialPathFor(target)), name).toBe(true)
      expect(PARTIAL_OUTPUT.test(target), `${name} is a finished file`).toBe(false)
    }
    // The other things imagii names `.partial` or `.tmp` are not a render's partial.
    expect(PARTIAL_OUTPUT.test('ggml-base.bin.partial')).toBe(false)
    expect(PARTIAL_OUTPUT.test('project.imagii.json.1a2b3c4d.tmp')).toBe(false)
    expect(PARTIAL_OUTPUT.test('holiday.partial.mp4')).toBe(false)
  })
})

describe('discardPartial - a failed run removes its partial and nothing else', () => {
  it('removes the partial', async () => {
    const partial = write(path.basename(partialPathFor(path.join(dir, 'out.mp4'))), 'moov-less wreckage')
    await discardPartial(partial)
    expect(existsSync(partial)).toBe(false)
  })

  it('will not remove a file that does not carry the partial name: the target is never the failure path\'s to delete', async () => {
    const target = write('out.mp4', 'the earlier export')
    await discardPartial(target)
    expect(existsSync(target)).toBe(true)
    // …nor one that only looks a little like a partial.
    const lookalike = write('out.partial.mp4', 'somebody\'s')
    await discardPartial(lookalike)
    expect(existsSync(lookalike)).toBe(true)
  })

  it('is quiet when there is nothing there (a run that failed before ffmpeg opened anything)', async () => {
    await expect(discardPartial(partialPathFor(path.join(dir, 'never.mp4')))).resolves.toBeUndefined()
  })

  it('never removes a folder that sits at the path', async () => {
    const folder = path.join(dir, path.basename(partialPathFor(path.join(dir, 'looks-like-a-file.mp4'))))
    mkdirSync(folder)
    await discardPartial(folder)
    expect(existsSync(folder)).toBe(true)
  })

  it('removes only its own path - another job\'s partial and the finished files stay', async () => {
    const finished = write('job-1.mp4')
    const other = write(path.basename(partialPathFor(path.join(dir, 'job-3.mp4'))))
    const mine = write(path.basename(partialPathFor(path.join(dir, 'job-2.mp4'))))
    await discardPartial(mine)
    expect(existsSync(mine)).toBe(false)
    expect(existsSync(finished)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })
})

describe('commitPartial - the swap', () => {
  it('replace: the target holds the partial\'s bytes, the old bytes are gone, and no partial is left', async () => {
    const target = write('out.mp4', 'the old export')
    const partial = write(path.basename(partialPathFor(target)), 'the whole new render')
    expect(await commitPartial(live, partial, target, 'replace')).toBe(target)
    expect(readFileSync(target, 'utf8')).toBe('the whole new render')
    expect(names()).toEqual(['out.mp4'])
  })

  it('replace onto a name nothing is at', async () => {
    const target = path.join(dir, 'fresh.mp3')
    const partial = write(path.basename(partialPathFor(target)), 'new')
    expect(await commitPartial(live, partial, target, 'replace')).toBe(target)
    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(names()).toEqual(['fresh.mp3'])
  })

  it('beside: a free name is taken as asked', async () => {
    const target = path.join(dir, 'free.gif')
    const partial = write(path.basename(partialPathFor(target)), 'new')
    expect(await commitPartial(live, partial, target, 'beside')).toBe(target)
    expect(names()).toEqual(['free.gif'])
  })

  // The name was free when the job chose it and is taken when the render is whole (a long encode: minutes). The partial held the name's place for
  // nobody, so the swap asks again, and the person's file is not replaced.
  it('beside: a name that has been taken since is not replaced - the render lands at the next free one', async () => {
    const target = write('taken.mp4', 'arrived while the render ran')
    const before = sha(target)
    const partial = write(path.basename(partialPathFor(target)), 'the render')
    const landed = await commitPartial(live, partial, target, 'beside')
    expect(landed).toBe(path.join(dir, 'taken (2).mp4'))
    expect(sha(target)).toBe(before)
    expect(readFileSync(landed, 'utf8')).toBe('the render')
    expect(names()).toEqual(['taken (2).mp4', 'taken.mp4'])
  })

  it('a run that was cancelled after ffmpeg exited does not swap: CancelledError, the target byte for byte, the partial gone', async () => {
    const target = write('out.mp4', 'the old export')
    const before = sha(target)
    const partial = write(path.basename(partialPathFor(target)), 'a whole render nobody wants now')
    const err = await commitPartial(cancelled, partial, target, 'replace').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CancelledError)
    expect(isCancelledError(err)).toBe(true)
    expect(sha(target)).toBe(before)
    expect(names()).toEqual(['out.mp4'])
  })

  it('beside asks the run too: a cancelled run does not take the next free name either', async () => {
    const target = write('out.mp4', 'old')
    const partial = write(path.basename(partialPathFor(target)), 'new')
    await expect(commitPartial(cancelled, partial, target, 'beside')).rejects.toBeInstanceOf(CancelledError)
    expect(readFileSync(target, 'utf8')).toBe('old')
    expect(names(), 'no "out (2).mp4" and no partial').toEqual(['out.mp4'])
  })

  it('a rename that fails (a folder at the target) throws the disk\'s error, removes the partial, and touches nothing else', async () => {
    const target = path.join(dir, 'is-a-folder.mp4')
    mkdirSync(target)
    write(path.join('is-a-folder.mp4', 'inside.txt'), 'somebody\'s')
    const partial = write(path.basename(partialPathFor(target)), 'new')
    const err = await commitPartial(live, partial, target, 'replace').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as NodeJS.ErrnoException).code, 'the disk\'s own error, for userFacingError to word').toMatch(/^(EISDIR|ENOTEMPTY|EPERM|EEXIST)$/)
    expect(existsSync(partial)).toBe(false)
    expect(readFileSync(path.join(target, 'inside.txt'), 'utf8')).toBe('somebody\'s')
  })

  // On Windows a scanner (Defender, the indexer) can hold a file ffmpeg has just closed for a moment, and a rename of it is refused with EBUSY /
  // EPERM / EACCES; the render took minutes and is whole, so it is tried again for about a second and a half before it is given up. (Before this
  // change ffmpeg wrote the target itself and there was no rename to be refused.)
  describe('a rename Windows refuses while something holds the new file (EBUSY, EPERM, EACCES)', () => {
    const busy = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: resource busy or locked, rename`), { code })

    it.each(['EBUSY', 'EPERM', 'EACCES'])('%s for a moment: the swap is tried again and succeeds', async (code) => {
      const target = write('out.mp4', 'old')
      const partial = write(path.basename(partialPathFor(target)), 'new')
      let calls = 0
      renameHook = async (real, from, to) => {
        calls += 1
        if (calls <= 2) throw busy(code)
        await real(from, to)
      }
      expect(await commitPartial(live, partial, target, 'replace')).toBe(target)
      expect(calls, 'refused twice, then through').toBe(3)
      expect(readFileSync(target, 'utf8')).toBe('new')
      expect(names()).toEqual(['out.mp4'])
    })

    // The case the retry cannot help: on Windows a file open in a player or editor without FILE_SHARE_DELETE refuses MoveFileEx REPLACE_EXISTING for as long as
    // it is open (libuv: EPERM / EACCES). Before T-140 ffmpeg's `-y` failed within a second of the press; now the person has waited through the whole render, and
    // throwing it away would be a worse answer than the one it replaced. So the render is kept BESIDE the file that cannot be replaced, which stays as it was.
    describe('held for good by the TARGET (the file is open in another app)', () => {
      /** The disk refuses every rename onto `target` (what a held file does) and lets any other through. */
      const holdsTarget = (target: string, code = 'EPERM'): { calls: () => number } => {
        let n = 0
        renameHook = async (real, from, to) => {
          if (to !== target) return real(from, to)
          n += 1
          throw busy(code)
        }
        return { calls: () => n }
      }

      it.each(['EBUSY', 'EPERM', 'EACCES'])('%s: the render lands at the next free name, the old file is byte for byte what it was, and no partial is left', async (code) => {
        const target = write('out.mp4', 'old')
        const before = sha(target)
        const partial = write(path.basename(partialPathFor(target)), 'the whole new render')
        const held = holdsTarget(target, code)
        const started = Date.now()
        const landed = await commitPartial(live, partial, target, 'replace')
        const spent = Date.now() - started
        expect(landed, 'the path it landed at is the answer').toBe(path.join(dir, 'out (2).mp4'))
        expect(held.calls(), 'the first try and one per delay were made before it gave up on the name').toBe(COMMIT_RETRY_DELAYS_MS.length + 1)
        expect(spent, 'the quit waits 1.5 s for a run to end; a hung scanner must not be able to hold it much longer').toBeLessThan(
          COMMIT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + 1000
        )
        expect(sha(target), 'the file that could not be replaced').toBe(before)
        expect(readFileSync(landed, 'utf8')).toBe('the whole new render')
        expect(names(), 'the partial is gone').toEqual(['out (2).mp4', 'out.mp4'])
      })

      it('takes the first free number: out (2) is somebody\'s, so it is out (3)', async () => {
        const target = write('out.mp4', 'old')
        write('out (2).mp4', 'an earlier copy')
        const partial = write(path.basename(partialPathFor(target)), 'new')
        holdsTarget(target)
        expect(await commitPartial(live, partial, target, 'replace')).toBe(path.join(dir, 'out (3).mp4'))
        expect(readFileSync(path.join(dir, 'out (2).mp4'), 'utf8'), 'the earlier copy is not replaced either').toBe('an earlier copy')
        expect(names()).toEqual(['out (2).mp4', 'out (3).mp4', 'out.mp4'])
      })

      it('finishPartial answers the landed path too, which is what every runner hands its caller', async () => {
        const target = write('out.mp4', 'old')
        const partial = write(path.basename(partialPathFor(target)), 'new')
        holdsTarget(target)
        const done = await finishPartial(Promise.resolve('value'), { run: live, partial, target, mode: 'replace' })
        expect(done).toEqual({ value: 'value', outputPath: path.join(dir, 'out (2).mp4') })
      })

      it('the folder refuses everything (a drive that went read-only): the ORIGINAL error goes up, the old file is kept, and no partial is left', async () => {
        const target = write('out.mp4', 'old')
        const partial = write(path.basename(partialPathFor(target)), 'new')
        let calls = 0
        renameHook = async (_real, _from, to) => {
          calls += 1
          // The target is refused with EPERM, anything else with EACCES: the error that goes up must be the first one (the file that is held), not the last.
          throw busy(to === target ? 'EPERM' : 'EACCES')
        }
        const err = await commitPartial(live, partial, target, 'replace').catch((e: unknown) => e)
        expect((err as NodeJS.ErrnoException).code, 'the disk\'s own error about the file the person named, for userFacingError to word').toBe('EPERM')
        expect(calls, 'the budget, then ONE try at the next name').toBe(COMMIT_RETRY_DELAYS_MS.length + 2)
        expect(readFileSync(target, 'utf8')).toBe('old')
        expect(names(), 'no out (2), and no partial').toEqual(['out.mp4'])
      })

      it('a name nothing is at is not "open in another app": the refusal is the disk\'s, it throws as it always did (and a new name would have worked)', async () => {
        const target = path.join(dir, 'new-name.mp4')
        const partial = write(path.basename(partialPathFor(target)), 'new')
        let calls = 0
        // Refused for exactly the budget, then let through: a redirect (or a seventh try at the same name) would LAND the render, and this row would see it.
        renameHook = async (real, from, to) => {
          calls += 1
          if (calls > COMMIT_RETRY_DELAYS_MS.length + 1) return real(from, to)
          throw busy('EPERM')
        }
        await expect(commitPartial(live, partial, target, 'replace')).rejects.toMatchObject({ code: 'EPERM' })
        expect(calls).toBe(COMMIT_RETRY_DELAYS_MS.length + 1)
        expect(names(), 'nothing was saved at another name, and no partial').toEqual([])
      })

      it('a Cancel recorded while the last try was refused wins over the new name', async () => {
        const target = write('out.mp4', 'old')
        const partial = write(path.basename(partialPathFor(target)), 'new')
        let n = 0
        let cancelNow = false
        const run = {
          check: (): void => {
            if (cancelNow) throw new CancelledError()
          }
        }
        renameHook = async (real, from, to) => {
          if (to !== target) return real(from, to)
          n += 1
          // The LAST try: the loop makes no check after it, so only the check before the new name can see this.
          if (n === COMMIT_RETRY_DELAYS_MS.length + 1) cancelNow = true
          throw busy('EPERM')
        }
        await expect(commitPartial(run, partial, target, 'replace')).rejects.toBeInstanceOf(CancelledError)
        expect(readFileSync(target, 'utf8')).toBe('old')
        expect(names(), 'the finished render is dropped, as for any Cancel after the exit').toEqual(['out.mp4'])
      })

      it('beside mode is not redirected: its name was free a moment ago, so a refusal there is not an open file', async () => {
        const target = write('out.mp4', 'somebody\'s')
        const partial = write(path.basename(partialPathFor(target)), 'new')
        let calls = 0
        // The name it chose is "out (2).mp4". Refused for exactly the budget, then let through: a redirect would land the render and this row would see it.
        renameHook = async (real, from, to) => {
          calls += 1
          if (calls > COMMIT_RETRY_DELAYS_MS.length + 1) return real(from, to)
          throw busy('EPERM')
        }
        await expect(commitPartial(live, partial, target, 'beside')).rejects.toMatchObject({ code: 'EPERM' })
        expect(calls).toBe(COMMIT_RETRY_DELAYS_MS.length + 1)
        expect(readFileSync(target, 'utf8')).toBe('somebody\'s')
        expect(names()).toEqual(['out.mp4'])
      })

      it('a refusal that is not a lock (ENOSPC) never moves the render to another name', async () => {
        const target = write('out.mp4', 'old')
        const partial = write(path.basename(partialPathFor(target)), 'new')
        let calls = 0
        // Refused once, then let through: a redirect on any error would land the render, and this row would see it.
        renameHook = async (real, from, to) => {
          calls += 1
          if (calls > 1) return real(from, to)
          throw Object.assign(new Error('ENOSPC: no space left on device, rename'), { code: 'ENOSPC' })
        }
        await expect(commitPartial(live, partial, target, 'replace')).rejects.toMatchObject({ code: 'ENOSPC' })
        expect(calls).toBe(1)
        expect(names()).toEqual(['out.mp4'])
      })
    })

    it('a refusal that is not a lock (ENOSPC, EXDEV) is not retried', async () => {
      const target = write('out.mp4', 'old')
      const partial = write(path.basename(partialPathFor(target)), 'new')
      let calls = 0
      renameHook = async () => {
        calls += 1
        throw Object.assign(new Error('ENOSPC: no space left on device, rename'), { code: 'ENOSPC' })
      }
      await expect(commitPartial(live, partial, target, 'replace')).rejects.toMatchObject({ code: 'ENOSPC' })
      expect(calls).toBe(1)
      expect(names()).toEqual(['out.mp4'])
    })

    it('a Cancel that lands while a locked swap waits to be tried again wins', async () => {
      const target = write('out.mp4', 'old')
      const partial = write(path.basename(partialPathFor(target)), 'new')
      let cancelNow = false
      const run = {
        check: (): void => {
          if (cancelNow) throw new CancelledError()
        }
      }
      renameHook = async () => {
        cancelNow = true
        throw busy('EBUSY')
      }
      await expect(commitPartial(run, partial, target, 'replace')).rejects.toBeInstanceOf(CancelledError)
      expect(readFileSync(target, 'utf8')).toBe('old')
      expect(names()).toEqual(['out.mp4'])
    })
  })
})

describe('finishPartial - what every runner calls once ffmpeg has exited', () => {
  it('work that succeeded: the partial is swapped in, and the work\'s value and the final path come back', async () => {
    const target = write('out.mp4', 'old')
    const partial = write(path.basename(partialPathFor(target)), 'new render')
    const done = await finishPartial(Promise.resolve({ stderr: 'tail' }), { run: live, partial, target, mode: 'replace' })
    expect(done).toEqual({ value: { stderr: 'tail' }, outputPath: target })
    expect(readFileSync(target, 'utf8')).toBe('new render')
    expect(names()).toEqual(['out.mp4'])
  })

  it('work that failed: the SAME error comes back, the partial is gone, and the old file is byte for byte what it was', async () => {
    const target = write('out.mp4', 'the old export')
    const before = sha(target)
    const partial = write(path.basename(partialPathFor(target)), 'half a render')
    const boom = new Error('FFmpeg exit 228: No space left on device')
    await expect(finishPartial(Promise.reject(boom), { run: live, partial, target, mode: 'replace' })).rejects.toBe(boom)
    expect(sha(target)).toBe(before)
    expect(names()).toEqual(['out.mp4'])
  })

  it('work that succeeded for a run that was cancelled: CancelledError, the old file kept, the whole render dropped', async () => {
    const target = write('out.mp4', 'the old export')
    const before = sha(target)
    const partial = write(path.basename(partialPathFor(target)), 'a whole render')
    await expect(finishPartial(Promise.resolve(), { run: cancelled, partial, target, mode: 'replace' })).rejects.toBeInstanceOf(CancelledError)
    expect(sha(target)).toBe(before)
    expect(names()).toEqual(['out.mp4'])
  })

  it('work that failed for a name that was free: nothing is at the target afterwards, and no partial', async () => {
    const target = path.join(dir, 'fresh.mp4')
    const partial = write(path.basename(partialPathFor(target)), 'half')
    await finishPartial(Promise.reject(new Error('x')), { run: live, partial, target, mode: 'beside' }).catch(() => undefined)
    expect(existsSync(target)).toBe(false)
    expect(names()).toEqual([])
  })
})

// T-133 (5): `wroteOutput` is judged by what is at the path, never its clock (a share running slow refused a GOOD thumbnail as "no picture"). T-140 (1): the
// frame extract asks it of its PARTIAL, a name that cannot have been there before, which is why a clock was never needed.
describe('wroteOutput - a real, non-empty file is the run\'s output, whatever its clock says (T-133 (5))', () => {
  it('a non-empty file is written output, however old its timestamp reads (a clock running behind)', async () => {
    expect(await wroteOutput(write('behind.jpg', 'x'))).toBe(true)
  })

  it('nothing, an empty file, and a folder are not', async () => {
    expect(await wroteOutput(path.join(dir, 'never-created.jpg'))).toBe(false)
    expect(await wroteOutput(write('empty.jpg', ''))).toBe(false)
    const folder = path.join(dir, 'looks-like-a-file.jpg')
    mkdirSync(folder)
    expect(await wroteOutput(folder)).toBe(false)
  })
})
