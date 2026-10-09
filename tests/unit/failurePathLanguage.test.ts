import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT } from './routeSources'

/**
 * T-84 — the failure path speaks English.
 *
 * The unit layer has no DOM, so a catch block cannot be driven here. What can
 * be pinned is the SHAPE that caused the bug: ~22 catch sites each toasted
 * `err.message`, and every one was the same two lines. Pinned statically,
 * three ways:
 *
 *   1. No `catch (v)` body in the renderer reads `v.message` (outside a
 *      console call), and no `toast.error(...)` is handed a `.message` — the
 *      raw text goes through `userFacingError` / `reportFailure`, which map it,
 *      and log the original. A new site written the old way fails HERE rather
 *      than in front of a user.
 *   2. Every site the ticket named still routes through the helper (a table,
 *      so reverting ONE of them is a named failure, not a silent regression).
 *   3. The crash screen and the user-visible strings do not ask the user to
 *      report anything, name a "provider", or spell Cancel the British way.
 *
 * Same caveat as the other structural tests: this reads source, so it says
 * "the call is there", not "it ran" — the E2E specs (video-pipelines, home-
 * chrome, references, record) drive the visible copy for each class.
 */

function listSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) listSources(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const FILES = listSources(RENDERER_ROOT).map((file) => ({
  file,
  rel: path.relative(RENDERER_ROOT, file).replace(/\\/g, '/'),
  text: readFileSync(file, 'utf8'),
  ast: ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}))

function isConsoleCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'console'
  )
}

/** `v.message` reads of the catch variable, outside any console call. */
function catchMessageReads(sf: ts.SourceFile): string[] {
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      const v = node.variableDeclaration.name.text
      const walk = (n: ts.Node, inConsole: boolean): void => {
        const nowInConsole = inConsole || isConsoleCall(n)
        if (
          !nowInConsole &&
          ts.isPropertyAccessExpression(n) &&
          n.name.text === 'message' &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === v
        ) {
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
          hits.push(`line ${line + 1}: ${n.getText(sf)}`)
        }
        ts.forEachChild(n, (c) => walk(c, nowInConsole))
      }
      walk(node.block, false)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** `toast.error(<anything containing .message>)`, wherever it is written. */
function toastErrorMessageArgs(sf: ts.SourceFile): string[] {
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'error' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'toast'
    ) {
      let found = false
      const scan = (n: ts.Node): void => {
        if (ts.isPropertyAccessExpression(n) && n.name.text === 'message') found = true
        ts.forEachChild(n, scan)
      }
      node.arguments.forEach(scan)
      if (found) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        hits.push(`line ${line + 1}: ${node.getText(sf).slice(0, 80)}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

describe('no renderer catch hands the user a raw error message', () => {
  it('finds the renderer sources it is meant to read', () => {
    // A directory move that left this scanning nothing would pass everything below.
    expect(FILES.length).toBeGreaterThan(80)
    expect(FILES.some((f) => f.rel === 'modules/video-studio/ExportPanel.tsx')).toBe(true)
  })

  it('no catch body reads its own variable\'s .message outside a console call', () => {
    const offenders = FILES.flatMap((f) => catchMessageReads(f.ast).map((hit) => `${f.rel} ${hit}`))
    expect(offenders).toEqual([])
  })

  it('no toast.error is handed a .message', () => {
    const offenders = FILES.flatMap((f) =>
      toastErrorMessageArgs(f.ast).map((hit) => `${f.rel} ${hit}`)
    )
    expect(offenders).toEqual([])
  })

  it('the scanner itself discriminates — it flags the shape that shipped', () => {
    // Without this, a scanner broken into always-empty passes both tests above.
    const bad = ts.createSourceFile(
      'bad.tsx',
      `async function f() { try { await g() } catch (err) { toast.error(err instanceof Error ? err.message : 'x') } }`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    expect(catchMessageReads(bad)).toHaveLength(1)
    expect(toastErrorMessageArgs(bad)).toHaveLength(1)
    const ok = ts.createSourceFile(
      'ok.tsx',
      `async function f() { try { await g() } catch (err) { console.error(err.message); reportFailure(err, { failed: 'x' }) } }`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    expect(catchMessageReads(ok)).toEqual([])
    expect(toastErrorMessageArgs(ok)).toEqual([])
  })
})

describe('every site the ticket named routes through the helper', () => {
  // file -> how many catch/result sites in it must call the helper.
  const SITES: Array<[string, string, number]> = [
    ['routes/Home.tsx', 'reportFailure(', 3],
    ['components/AutosaveRestore.tsx', 'reportFailure(', 1],
    ['modules/video-studio/ExportPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/ClipKitButton.tsx', 'reportFailure(', 1],
    ['modules/video-studio/GifPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/CompilationPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/ReframePanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/PipPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/CaptionsPanel.tsx', 'reportFailure(', 4],
    ['modules/video-studio/HighlightPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/VideoStudio.tsx', 'reportFailure(', 1],
    ['modules/audio-studio/ExportDialog.tsx', 'reportFailure(', 2],
    ['modules/audio-studio/PresetPanel.tsx', 'reportFailure(', 2],
    ['modules/image-studio/ExportDialog.tsx', 'reportFailure(', 1],
    ['modules/image-studio/ImportPanel.tsx', 'reportFailure(', 1],
    ['modules/image-studio/ThumbnailVariants.tsx', 'reportFailure(', 3],
    ['modules/references/MoodBoardPanel.tsx', 'reportFailure(', 1],
    ['modules/record-studio/RecordStudio.tsx', 'reportFailure(', 2],
    ['modules/record-studio/RecordStudio.tsx', 'userFacingError(', 1],
    ['modules/references/state/referencesStore.ts', 'userFacingError(', 1]
  ]

  it.each(SITES)('%s calls %s at least %i time(s)', (rel, needle, min) => {
    const f = FILES.find((x) => x.rel === rel)
    expect(f, `${rel} exists`).toBeDefined()
    const count = (f?.text.split(needle).length ?? 1) - 1
    expect(count).toBeGreaterThanOrEqual(min)
  })

  it('the importers pass their kind, so an mp3 never reads video wording', () => {
    const audio = FILES.find((x) => x.rel === 'modules/audio-studio/AudioImporter.tsx')
    expect(audio?.text).toMatch(/describeImportError\(err, filePath, 'audio'\)/)
  })
})

describe('the words on the failure path', () => {
  /** Every string a user could read in a file: JSX text, and string literals. */
  function userStrings(sf: ts.SourceFile): string[] {
    const out: string[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isJsxText(n)) out.push(n.text)
      else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text)
      else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text)
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return out
  }

  it('the crash screen does not ask the user to report anything, or say "render error" to them', () => {
    const boundary = FILES.find((f) => f.rel === 'components/ErrorBoundary.tsx')
    expect(boundary).toBeDefined()
    // JSX text only: the console.error label may still say what React calls it.
    const jsx: string[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isJsxText(n)) jsx.push(n.text)
      ts.forEachChild(n, visit)
    }
    if (boundary) visit(boundary.ast)
    const shown = jsx.join(' ').replace(/\s+/g, ' ')
    expect(shown).not.toMatch(/render error|\breport\b/i)
    expect(shown).toContain('Something went wrong in this studio')
    expect(shown).toContain('Details')
  })

  it('no string in the renderer tells the user to "switch provider"', () => {
    const offenders = FILES.filter((f) => userStrings(f.ast).some((s) => /switch provider/i.test(s)))
    expect(offenders.map((f) => f.rel)).toEqual([])
  })

  it('no string in the renderer spells Cancel the other way — one house spelling', () => {
    // The sentinel is `imagii:cancelled` and never shown; every sentence a user
    // reads says "canceled" (T-84's copy), so a stray "cancelled" is drift.
    const offenders = FILES.flatMap((f) =>
      userStrings(f.ast)
        .filter((s) => /cancelled/i.test(s))
        .map((s) => `${f.rel}: ${s.trim().slice(0, 60)}`)
    )
    expect(offenders).toEqual([])
  })
})
