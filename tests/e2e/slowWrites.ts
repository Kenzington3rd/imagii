import type { ElectronApplication } from '@playwright/test'

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
