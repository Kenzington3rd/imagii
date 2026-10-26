import type { ElectronApplication } from '@playwright/test'
import { ATOMIC_TMP } from '../../src/main/fsAtomic'
import { PARTIAL_OUTPUT } from '../../src/main/ffmpeg/partialOutput'

/**
 * T-139 (1): the tmp main's `writeFileAtomic` keeps in a folder for the length of a write. T-140 (1): and the partial an ffmpeg runner writes beside its target.
 *
 * Every save of a file the person chose (the image exports, the project, the .srt copy, a mood board) writes `<target>.<8 hex>.tmp` BESIDE the target and
 * renames it over, so a test that LISTS the folder a save goes to can see the tmp: a poll on a COUNT (`waitForDownloads`, the Reference Export's wait) answers
 * "1 file" while that one is the tmp, then reads every name, and the tmp is partial or gone by the rename (the T-139 Track A full run: image.spec.ts "the
 * document background lands in the bytes" read a name that was not there any more). A listing of finished files goes through here.
 *
 * T-140 (1) is the same shape for every render: ffmpeg writes `<stem>.<8 hex>.partial<ext>` beside the name a finished export will have (`partialOutput.ts`),
 * for as long as the encode runs - minutes, for an export. The extension is LAST on purpose (so ffmpeg picks the muxer), which means a listing filtered by
 * `endsWith('.mp4')` or `endsWith('.gif')` counts the partial as an export, and a poll on that count reads a render that is not there yet. `withoutAtomicTmp` drops
 * both names. A listing that asserts NOTHING IS LEFT (after a Cancel, a failure or a quit) is the other kind: it wants the partial in view, so it stays a raw
 * `readdirSync` and says so; it runs after the UI has reported the end of the job, which main sends only after it has removed the partial.
 *
 * The patterns are `ATOMIC_TMP` and `PARTIAL_OUTPUT`, exported by the writers themselves (`src/main/fsAtomic.ts`, `src/main/ffmpeg/partialOutput.ts`), and each
 * writer's unit test pins its pattern to the name the real code makes; `tests/unit/atomicWrites.test.ts` pins that the specs that list such folders do it through
 * `withoutAtomicTmp`.
 */
export { ATOMIC_TMP, PARTIAL_OUTPUT }

/** `names` without the atomic writer's tmp files and without a render's partial: the files a save or a render has FINISHED. */
export function withoutAtomicTmp(names: string[]): string[] {
  return names.filter((name) => !ATOMIC_TMP.test(name) && !PARTIAL_OUTPUT.test(name))
}

/** The renders in `names` that are not finished yet: what ffmpeg is writing right now. */
export function partialsOnly(names: string[]): string[] {
  return names.filter((name) => PARTIAL_OUTPUT.test(name))
}

/**
 * `names` as they are, tmp files and partials in view. A listing says which it wants (`tests/unit/atomicWrites.test.ts` fails a bare `readdirSync` of an output folder):
 * this one asserts what is LEFT - after a Cancel, a failure or a quit, or the exact contents of a folder once the UI has reported a job's end - and a partial that
 * is still there is precisely the failure it exists to find.
 */
export function withEverything(names: string[]): string[] {
  return names
}

/**
 * T-140 (1), sent back: make `target` behave as a file that is OPEN IN ANOTHER APP, from the test and in main.
 *
 * On Windows a file held by a player or an editor without FILE_SHARE_DELETE refuses `MoveFileEx(REPLACE_EXISTING)` onto it for as long as it is open (libuv
 * reports EPERM / EACCES), and Linux, where the e2e suite runs, has no such file. The render is swapped in with `fs/promises`' `rename` (`partialOutput.ts`), so
 * this wraps THAT in the main process the way `slowWrites.ts` wraps `writeFile` and `mainSpawn.ts` wraps `spawn` (nothing in `src/` changes): a rename whose
 * DESTINATION is exactly `target` throws EPERM, and every other rename goes straight through. `process.getBuiltinModule` reaches the module from the evaluate
 * context and `syncBuiltinESMExports` publishes the patch to the modules that import `rename` by name. `refusedRenameCount` says how many were refused (the proof
 * the window was really held: a patch that never took would let the old behavior pass for the new).
 */
export async function refuseRenamesOnto(app: ElectronApplication, target: string): Promise<void> {
  await app.evaluate((_electron, held) => {
    const g = globalThis as unknown as {
      __renameHeldReal?: (from: string, to: string) => Promise<void>
      __renameHeldRefused?: number
    }
    const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule
    const fsp = getBuiltin('node:fs/promises') as { rename: (from: string, to: string) => Promise<void> }
    const mod = getBuiltin('node:module') as { syncBuiltinESMExports: () => void }
    g.__renameHeldReal ??= fsp.rename
    g.__renameHeldRefused = 0
    const real = g.__renameHeldReal
    fsp.rename = async (from: string, to: string): Promise<void> => {
      if (String(to) === held) {
        g.__renameHeldRefused = (g.__renameHeldRefused ?? 0) + 1
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), {
          code: 'EPERM',
          errno: -1,
          syscall: 'rename',
          path: from,
          dest: to
        })
      }
      return real(from, to)
    }
    mod.syncBuiltinESMExports()
  }, target)
}

/** How many renames onto the held target `refuseRenamesOnto` has refused. */
export async function refusedRenameCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as { __renameHeldRefused?: number }).__renameHeldRefused ?? 0)
}
