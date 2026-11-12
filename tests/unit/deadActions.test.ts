import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT } from './routeSources'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-101 — no exported store action without a caller survives.
 *
 * `videoStore.addClipFromRange` had unit tests and no caller: a manual
 * "add a clip from a range" that no control ever called, kept alive by the tests
 * that proved it worked. Looking for it found four more of the same in the other
 * stores (`setSelectedPresets`, the audio store's `resetChain` and
 * `updateCutRegion`, the canvas store's `setBackground` and `setCanvasSize`),
 * and the preload bridge carried a buffered `recording.save` nothing called.
 * Dead code like this is not harmless: every one is a surface a reader has to
 * wonder about, a test that guards nothing a user can reach, and — for an IPC —
 * a door left open for no one.
 *
 * The rule, mechanically: every function in a store's state interface is named
 * somewhere in the renderer OUTSIDE that store's own file and outside tests. A
 * name counts only as an identifier in the syntax tree, so a comment that
 * mentions an action does not keep it alive. The fix for a failure is deletion
 * (the ladder: does this need to exist?), or a control that calls it — with
 * its own coverage (CLAUDE.md, full interaction coverage).
 */

const STORES: Array<{ file: string; iface: string }> = [
  { file: 'modules/video-studio/store/videoStore.ts', iface: 'VideoStudioState' },
  { file: 'modules/audio-studio/state/audioStore.ts', iface: 'AudioStudioState' },
  { file: 'modules/image-studio/state/canvasStore.ts', iface: 'CanvasState' },
  { file: 'modules/references/state/referencesStore.ts', iface: 'ReferencesStudioState' }
]

/** The names of the function-typed members of interface `iface` in `sf`. */
export function actionNames(sf: ts.SourceFile, iface: string): string[] {
  const names: string[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === iface) {
      for (const m of n.members) {
        if (!m.name || !ts.isIdentifier(m.name)) continue
        const isMethod = ts.isMethodSignature(m)
        const isFunctionProp =
          ts.isPropertySignature(m) && m.type !== undefined && ts.isFunctionTypeNode(m.type)
        if (isMethod || isFunctionProp) names.push(m.name.text)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return names
}

/** Every identifier in `sf` (a property access, a destructured name, a call). */
export function identifiersIn(sf: ts.SourceFile): Set<string> {
  const ids = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) ids.add(n.text)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return ids
}

/** Actions of `iface` that no identifier in `others` names. */
export function deadActions(storeSource: ts.SourceFile, iface: string, others: Set<string>): string[] {
  return actionNames(storeSource, iface).filter((name) => !others.has(name))
}

const SOURCES = sourceFilesUnder(RENDERER_ROOT)

describe('every store action has a caller outside its own store (T-101)', () => {
  for (const store of STORES) {
    it(`${store.file}: ${store.iface}`, () => {
      const storePath = path.join(RENDERER_ROOT, store.file)
      const sf = parseSource(storePath)
      const actions = actionNames(sf, store.iface)
      // Not vacuous: the interface was found and has real members in it.
      expect(actions.length, `${store.iface} has actions`).toBeGreaterThan(8)

      const used = new Set<string>()
      for (const file of SOURCES) {
        if (file === storePath) continue
        for (const id of identifiersIn(parseSource(file))) used.add(id)
      }
      expect(deadActions(sf, store.iface, used)).toEqual([])
    })
  }
})

describe('the scan discriminates — it fires on the actions that shipped dead', () => {
  const STORE = `
    interface DemoState {
      source: string | null
      addClip: () => void
      addClipFromRange: (name: string, a: number, b: number) => boolean
      setBackground(color: string): void
      historyKey: string | null
    }
  `

  it('reads the function-typed members and leaves plain state alone', () => {
    expect(actionNames(parseSource('demo.ts', STORE), 'DemoState')).toEqual([
      'addClip',
      'addClipFromRange',
      'setBackground'
    ])
  })

  it('names the ones nothing outside the store uses', () => {
    const caller = parseSource(
      'Panel.tsx',
      `const add = useDemo((s) => s.addClip)\nconst bg = useDemo.getState().setBackground`
    )
    expect(
      deadActions(parseSource('demo.ts', STORE), 'DemoState', identifiersIn(caller))
    ).toEqual(['addClipFromRange'])
  })

  it('a comment that mentions an action does not keep it alive', () => {
    const caller = parseSource(
      'Panel.tsx',
      `// addClipFromRange was removed\nconst add = useDemo((s) => s.addClip)\nconst bg = useDemo.getState().setBackground`
    )
    expect(
      deadActions(parseSource('demo.ts', STORE), 'DemoState', identifiersIn(caller))
    ).toEqual(['addClipFromRange'])
  })

  it('a test-only caller does not count: tests are not scanned', () => {
    const hereOnlyInTests = new Set<string>()
    expect(deadActions(parseSource('demo.ts', STORE), 'DemoState', hereOnlyInTests)).toEqual([
      'addClip',
      'addClipFromRange',
      'setBackground'
    ])
  })
})
