import type { ElectronApplication } from '@playwright/test'
import { ATOMIC_TMP } from '../../src/main/fsAtomic'

/**
 * T-139 (9): hold every file main writes into a presets folder (`export-presets`, `audio-presets`) for `ms`.
 *
 * A double-click's second press lands within a few milliseconds of the first, and a preset's write takes about as long as that, so on a fast disk the second
 * press sees either a write still out (a duplicate preset) or one already done (a cleared name box). To see the first, the write is made slow, from the test
 * and in main, the way `mainSpawn.ts` slows a spawn (nothing in `src/` changes): `process.getBuiltinModule` reaches `node:fs/promises`, whose `writeFile` is
 * replaced by one that waits first when the target is in a presets folder, and `syncBuiltinESMExports` publishes it to the modules that import it by name.
 * Every other write is untouched.
 */
export async function slowPresetWrites(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate((_electron, delay) => {
    const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule
    const fsp = getBuiltin('node:fs/promises') as { writeFile: (...a: unknown[]) => Promise<unknown> }
    const mod = getBuiltin('node:module') as { syncBuiltinESMExports: () => void }
    const g = globalThis as unknown as { __writeFileReal?: (...a: unknown[]) => Promise<unknown> }
    g.__writeFileReal ??= fsp.writeFile
    const real = g.__writeFileReal
    fsp.writeFile = async (...a: unknown[]) => {
      if (/-presets/.test(String(a[0]))) await new Promise((resolve) => setTimeout(resolve, delay))
      return real(...a)
    }
    mod.syncBuiltinESMExports()
  }, ms)
}

/**
 * T-139 (1): hold the atomic writer's rename, so its tmp is GUARANTEED to be in the folder.
 *
 * `writeFileAtomic` writes `<target>.<8 hex>.tmp` and renames it over the target: on a quiet machine the tmp lives for a millisecond, which is how a test that
 * lists the folder passed for rounds and then failed once under load (a poll on a count read the tmp as a saved file). A test of THAT race cannot wait for
 * the load, so this makes the window as wide as the test needs, the way `mainSpawn.ts` widens the probe window: it wraps `fs/promises`'s `rename` IN THE MAIN
 * PROCESS (nothing in `src/` changes), and a rename whose source is an atomic tmp waits at a gate until the test opens it. The app's modules import `rename`
 * by name, so the patch is published to them with `syncBuiltinESMExports`; `process.getBuiltinModule` is how the evaluate context reaches the module.
 * Every other rename (a different file, anything not named like the writer's tmp) goes straight through, and `releaseAtomicRenames` opens the gate for good.
 */
export async function holdAtomicRenames(app: ElectronApplication): Promise<void> {
  await app.evaluate((_electron, pattern) => {
    const g = globalThis as unknown as {
      __renameReal?: (from: string, to: string) => Promise<void>
      __renameGate?: { open: () => void; opened: boolean; held: number }
    }
    const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule
    const fsp = getBuiltin('node:fs/promises') as { rename: (from: string, to: string) => Promise<void> }
    const mod = getBuiltin('node:module') as { syncBuiltinESMExports: () => void }
    g.__renameReal ??= fsp.rename
    const real = g.__renameReal
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const state = { open: () => release(), opened: false, held: 0 }
    state.open = () => {
      state.opened = true
      release()
    }
    g.__renameGate = state
    const tmp = new RegExp(pattern)
    fsp.rename = async (from: string, to: string): Promise<void> => {
      if (tmp.test(String(from))) {
        state.held += 1
        await gate
      }
      return real(from, to)
    }
    mod.syncBuiltinESMExports()
  }, ATOMIC_TMP.source)
}

/** Open the gate: every held rename completes, and later ones are not held. */
export async function releaseAtomicRenames(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as unknown as { __renameGate?: { open: () => void } }
    g.__renameGate?.open()
  })
}

/** How many renames have been held at the gate since `holdAtomicRenames` (the proof the window was really open). */
export async function heldRenameCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __renameGate?: { held: number } }
    return g.__renameGate?.held ?? 0
  })
}
