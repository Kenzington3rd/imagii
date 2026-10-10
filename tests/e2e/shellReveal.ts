import type { ElectronApplication } from '@playwright/test'

/**
 * Record every `shell.showItemInFolder` call in main.
 *
 * The OS file manager is genuinely untestable, but "the Show in folder button
 * reached the shell with the right path" is not — that is the deepest layer
 * every reveal control has. Install it BEFORE the click (`stubShellReveal`),
 * read it after (`readRevealCalls`). Shared by record.spec.ts (the saved-take
 * toast) and video-pipelines.spec.ts (the GIF / PiP / reframe / compile toasts,
 * T-92), so the two cannot drift into asserting different things.
 */
export async function stubShellReveal(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ shell }) => {
    const g = globalThis as unknown as { __revealCalls: string[] }
    g.__revealCalls = []
    const target = shell as unknown as { showItemInFolder: unknown }
    target.showItemInFolder = (p: string) => {
      g.__revealCalls.push(p)
    }
  })
}

export function readRevealCalls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    async () => (globalThis as unknown as { __revealCalls?: string[] }).__revealCalls ?? []
  )
}
