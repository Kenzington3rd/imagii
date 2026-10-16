import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT } from './routeSources'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-108 (d) — no function exposed through the preload bridge without a caller survives.
 *
 * `deadActions.test.ts` (T-101) holds the stores to "every action is named somewhere in
 * the renderer". The bridge had the same hole: `video.cancel(jobId)` and `app.quit()` were
 * exposed to the renderer (and handled in main) for no caller at all, found only because
 * a worker happened to be reading `recording.save` next door. An exposure is a door left
 * open: a surface a reader has to wonder about and a channel main answers for no one.
 *
 * The rule, mechanically: every function in a namespace of `ImagiiApi` (`src/shared/api.ts`,
 * the type the preload object is checked against, so a member added to one is a type error
 * without the other) is reached from some renderer file as `<anything>.<namespace>.<member>`
 * — `window.api.video.cancelAll(...)`. Comments do not count (the scan reads the syntax tree)
 * and neither do tests (they are not scanned). The fix for a failure is deletion (the
 * ladder: does this need to exist?) — the exposure, its type and the main handler — or a
 * control that calls it, with its own coverage.
 */

const API_FILE = path.resolve(__dirname, '../../src/shared/api.ts')

/** `namespace.member` for every function-typed member of every namespace of `iface`. */
export function exposures(sf: ts.SourceFile, iface = 'ImagiiApi'): string[] {
  const out: string[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === iface) {
      for (const ns of n.members) {
        if (!ns.name || !ts.isIdentifier(ns.name)) continue
        if (!ts.isPropertySignature(ns) || !ns.type || !ts.isTypeLiteralNode(ns.type)) continue
        for (const m of ns.type.members) {
          if (!m.name || !ts.isIdentifier(m.name)) continue
          const isMethod = ts.isMethodSignature(m)
          const isFunctionProp =
            ts.isPropertySignature(m) && m.type !== undefined && ts.isFunctionTypeNode(m.type)
          if (isMethod || isFunctionProp) out.push(`${ns.name.text}.${m.name.text}`)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Every `namespace.member` the source reaches: a property access whose object is itself `….namespace`. */
export function reached(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      out.add(`${n.expression.name.text}.${n.name.text}`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Exposures of `iface` that nothing in `used` reaches. */
export function deadExposures(api: ts.SourceFile, used: Set<string>, iface = 'ImagiiApi'): string[] {
  return exposures(api, iface).filter((name) => !used.has(name))
}

const SOURCES = sourceFilesUnder(RENDERER_ROOT)

describe('every function the preload exposes has a caller in the renderer (T-108)', () => {
  const api = parseSource(API_FILE)
  const names = exposures(api)

  it('the interface was found and has real members in it (the scan is not vacuous)', () => {
    expect(names.length).toBeGreaterThan(60)
    expect(names).toContain('video.cancelAll')
    expect(names).toContain('captions.cancelTranscribe')
  })

  it('no exposure is dead', () => {
    const used = new Set<string>()
    for (const file of SOURCES) for (const name of reached(parseSource(file))) used.add(name)
    expect(deadExposures(api, used)).toEqual([])
  })

  it('the two that shipped dead are gone', () => {
    expect(names).not.toContain('video.cancel')
    expect(names).not.toContain('app.quit')
  })
})

describe('the scan discriminates — it fires on the exposures that shipped dead', () => {
  const API = `
    export interface DemoApi {
      app: {
        quit(): void
        getVersion(): Promise<string>
      }
      video: {
        cancel(jobId: string): Promise<boolean>
        cancelAll(): Promise<void>
        onProgress(handler: () => void): () => void
        fileUrl: (p: string) => string
        label: string
      }
    }
  `

  it('reads the function-typed members of each namespace and leaves plain fields alone', () => {
    expect(exposures(parseSource('api.ts', API), 'DemoApi')).toEqual([
      'app.quit',
      'app.getVersion',
      'video.cancel',
      'video.cancelAll',
      'video.onProgress',
      'video.fileUrl'
    ])
  })

  it('names the ones nothing in the renderer reaches', () => {
    const caller = parseSource(
      'Panel.tsx',
      `const v = await window.api.app.getVersion()
       await window.api.video.cancelAll()
       const off = window.api?.video.onProgress(() => {})
       const u = window.api.video.fileUrl('x')`
    )
    expect(deadExposures(parseSource('api.ts', API), reached(caller), 'DemoApi')).toEqual([
      'app.quit',
      'video.cancel'
    ])
  })

  it('a comment or a string that mentions an exposure does not keep it alive', () => {
    const caller = parseSource(
      'Panel.tsx',
      `// window.api.video.cancel(jobId) was removed
       const note = 'window.api.app.quit()'
       await window.api.app.getVersion()
       await window.api.video.cancelAll()
       window.api.video.onProgress(() => {})
       window.api.video.fileUrl('x')`
    )
    expect(deadExposures(parseSource('api.ts', API), reached(caller), 'DemoApi')).toEqual([
      'app.quit',
      'video.cancel'
    ])
  })

  it('a member with the same name in ANOTHER namespace does not keep it alive', () => {
    // `audio.cancel` is called; `video.cancel` is not.
    const caller = parseSource('Panel.tsx', `window.api.audio.cancel(id); window.api.video.cancelAll()`)
    expect(
      deadExposures(parseSource('api.ts', API), reached(caller), 'DemoApi').includes('video.cancel')
    ).toBe(true)
  })
})
