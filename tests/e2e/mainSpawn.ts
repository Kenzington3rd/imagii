import type { ElectronApplication } from '@playwright/test'

/**
 * T-98: land a Cancel in a window that is otherwise a few milliseconds wide.
 *
 * Every runner that cuts a clip probes the source with ffprobe before it spawns
 * ffmpeg, and the next job of a batch begins with that same probe. A Cancel
 * pressed there finds no child to kill — that is the bug — but the probe takes
 * ~40 ms, so a test that clicks "somewhere near" it passes or fails with the
 * machine's load. This makes the window as wide as the test needs.
 *
 * It wraps `child_process.spawn` IN THE MAIN PROCESS (the stubDialogs
 * technique: nothing in `src/` changes). A matching spawn is replaced by a tiny
 * Node process that waits `ms` and then runs the very same command with the
 * very same arguments and pipes, so the probe still returns the real answer —
 * late. The app's modules import `spawn` by name (`import { spawn } from
 * 'node:child_process'`), so the patch is published to them with
 * `syncBuiltinESMExports`; `process.getBuiltinModule` is how the evaluate
 * context reaches the module at all (main is ESM, so there is no `require`).
 *
 * `readSpawnLog` is the other half of the evidence: the names of every process
 * the app started since the patch went in, in order. "No ffmpeg was ever
 * spawned for the second job" is a fact of that list — stronger than "no file
 * appeared", which a job that was merely slow also satisfies.
 */
export interface StallRule {
  /** `ffprobe`; `ffmpeg` (an encode); `frame` (a single-frame extract). */
  match: 'ffprobe' | 'ffmpeg' | 'frame'
  /** Hold only the Nth spawn of that kind (1-based) since the patch; omitted = all. */
  nth?: number
  /** How long the wrapper waits before running the real command. */
  ms: number
}

export async function installSpawnStall(
  app: ElectronApplication,
  rules: StallRule[]
): Promise<void> {
  await app.evaluate((_electron, stalls) => {
    const g = globalThis as unknown as {
      __spawnReal?: (...a: unknown[]) => unknown
      __spawnLog?: string[]
      __spawnCounts?: Record<string, number>
    }
    const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown })
      .getBuiltinModule
    const cp = getBuiltin('node:child_process') as { spawn: (...a: unknown[]) => unknown }
    const mod = getBuiltin('node:module') as { syncBuiltinESMExports: () => void }
    g.__spawnReal ??= cp.spawn
    const real = g.__spawnReal
    g.__spawnLog = []
    g.__spawnCounts = {}
    cp.spawn = (cmd: unknown, args: unknown, opts: unknown) => {
      const command = String(cmd)
      const argv = Array.isArray(args) ? (args as string[]) : []
      const kind = /ffprobe/i.test(command)
        ? 'ffprobe'
        : /ffmpeg/i.test(command)
          ? argv.includes('-frames:v')
            ? 'frame'
            : 'ffmpeg'
          : 'other'
      g.__spawnLog?.push(kind)
      const counts = g.__spawnCounts as Record<string, number>
      counts[kind] = (counts[kind] ?? 0) + 1
      const rule = stalls.find((r) => r.match === kind && (r.nth === undefined || r.nth === counts[kind]))
      if (!rule) return real(cmd, args, opts)
      const wait =
        `setTimeout(() => { const r = require('node:child_process').spawnSync(` +
        `process.argv[1], process.argv.slice(2), { stdio: 'inherit' }); ` +
        `process.exit(r.status === null ? 1 : r.status) }, ${rule.ms})`
      return real(process.execPath, ['-e', wait, command, ...argv], {
        ...((opts as object | undefined) ?? {}),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      })
    }
    mod.syncBuiltinESMExports()
  }, rules)
}

/** What the app has spawned since `installSpawnStall`, in order: `ffprobe` / `ffmpeg` / `frame` / `other`. */
export function readSpawnLog(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __spawnLog?: string[] }).__spawnLog ?? [])
}
