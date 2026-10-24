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
 *
 * Scanner limitation (T-115): everything above reads `catch` clauses and the
 * arguments of `toast.error`, so it cannot see the OTHER way to fail badly: an
 * awaited `window.api.*` call with no `try` at all. A rejection there is an
 * unhandled rejection and the control does nothing, visibly. A scan found about
 * 47 such awaits in the renderer, nearly all of them native pickers and settings
 * writes that do not reject in practice, so a blanket rule would need a 47-row
 * allow-list and would be mostly noise. The one that could and did reject, `CaptionsPanel.saveSrt`
 * (`captions:saveSrt` throws for a transcript outside the captions folder, and a
 * project file may name one), is pinned BY NAME in the `Save .srt` block of this file. T-128 (4), T-110 (x): the
 * family that needed no allow-list is scanned in the last block - a settings write
 * (`window.api.settings.set`) is never a bare promise: the writes that are not worth a
 * user's interaction go through `persistSetting`, the ones the next line depends on sit
 * in a `try` with a `catch`. The pickers, cancels and reads of the old count are not scanned
 * (T-128's ledger lists what was audited).
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
    ['components/AutosaveRestore.tsx', 'reportFailure(', 2],
    ['modules/video-studio/ExportPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/ClipKitButton.tsx', 'reportFailure(', 1],
    ['modules/video-studio/GifPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/CompilationPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/ReframePanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/PipPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/CaptionsPanel.tsx', 'reportFailure(', 5],
    ['modules/video-studio/HighlightPanel.tsx', 'reportFailure(', 1],
    ['modules/video-studio/VideoStudio.tsx', 'reportFailure(', 1],
    ['modules/audio-studio/ExportDialog.tsx', 'reportFailure(', 2],
    ['modules/audio-studio/PresetPanel.tsx', 'reportFailure(', 2],
    ['modules/image-studio/ExportDialog.tsx', 'reportFailure(', 1],
    ['modules/image-studio/ImportPanel.tsx', 'reportFailure(', 1],
    ['modules/image-studio/ThumbnailVariants.tsx', 'reportFailure(', 3],
    ['modules/references/MoodBoardPanel.tsx', 'reportFailure(', 1],
    // T-123 (18): the "Edit in Video Studio" failure sentence moved out of RecordStudio into the hook Record and Reframe share.
    ['lib/editInVideoStudio.ts', 'reportFailure(', 1],
    ['modules/record-studio/RecordStudio.tsx', 'reportFailure(', 4],
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

// T-117: `ipcErrorMessage` strips Electron's envelope and nothing else, so a site that toasts its result shows
// main's string as written: an errno, both paths of a failed copy, a channel name. Record's save, its source
// list and the Autosave banner's Clear were the last three; they go through `reportFailure`. What is left in
// `src/shared` is the first step inside `userFacingError` and the classifier in `importDiagnostics`, neither of
// which shows its input.
describe('no renderer site shows main\'s string as written (T-117)', () => {
  const callsIpcErrorMessage = (sf: ts.SourceFile): number => {
    let n = 0
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ipcErrorMessage') n++
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return n
  }

  it('no renderer source calls ipcErrorMessage', () => {
    const offenders = FILES.filter((f) => callsIpcErrorMessage(f.ast) > 0).map((f) => f.rel)
    expect(offenders, 'use reportFailure(err, { failed }) - it maps the known causes and hides the rest').toEqual([])
  })

  it('the finder discriminates: it sees a call, and not a mention or another function', () => {
    const parse = (code: string): ts.SourceFile =>
      ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    expect(callsIpcErrorMessage(parse("toast.error(ipcErrorMessage(err, 'x'))"))).toBe(1)
    expect(callsIpcErrorMessage(parse("import { ipcErrorMessage } from '@shared/ipcError'"))).toBe(0)
    expect(callsIpcErrorMessage(parse("reportFailure(err, { failed: 'x' })"))).toBe(0)
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

describe('Save .srt reports its own failure (T-115)', () => {
  /**
   * What `fn` does with the `window.api.*` call it awaits: whether the await sits inside a `try`
   * whose `catch` calls `reportFailure(…, { failed: <string> })`, and that sentence.
   */
  function guardedAwait(sf: ts.SourceFile, fn: string, needle: string): { awaited: boolean; guarded: boolean; failed: string | null } {
    const out = { awaited: false, guarded: false, failed: null as string | null }
    const inspect = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === fn && node.body) walkFn(node.body)
      ts.forEachChild(node, inspect)
    }
    const walkFn = (body: ts.Node): void => {
      const visit = (n: ts.Node, tryCatch: ts.CatchClause | null): void => {
        if (ts.isTryStatement(n) && n.catchClause) {
          visit(n.tryBlock, n.catchClause)
          visit(n.catchClause, tryCatch)
          if (n.finallyBlock) visit(n.finallyBlock, tryCatch)
          return
        }
        if (ts.isAwaitExpression(n) && n.expression.getText(sf).includes(needle)) {
          out.awaited = true
          if (tryCatch) {
            let failed: string | null = null
            const find = (c: ts.Node): void => {
              if (ts.isCallExpression(c) && c.expression.getText(sf) === 'reportFailure') {
                const copy = c.arguments[1]
                if (copy && ts.isObjectLiteralExpression(copy)) {
                  for (const p of copy.properties) {
                    if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'failed' && ts.isStringLiteralLike(p.initializer)) {
                      failed = p.initializer.text
                    }
                  }
                }
              }
              ts.forEachChild(c, find)
            }
            find(tryCatch)
            if (failed !== null) {
              out.guarded = true
              out.failed = failed
            }
          }
        }
        ts.forEachChild(n, (c) => visit(c, tryCatch))
      }
      visit(body, null)
    }
    inspect(sf)
    return out
  }

  const panel = FILES.find((f) => f.rel === 'modules/video-studio/CaptionsPanel.tsx')

  it('CaptionsPanel awaits captions.saveSrt inside a try whose catch is reportFailure with a plain sentence', () => {
    expect(panel).toBeDefined()
    const found = guardedAwait((panel as (typeof FILES)[number]).ast, 'saveSrt', 'captions.saveSrt')
    expect(found.awaited, 'saveSrt still awaits captions.saveSrt').toBe(true)
    expect(found.guarded, 'the await has a catch that reports').toBe(true)
    expect(found.failed).toBe("Couldn't save the captions file.")
  })

  it('the finder discriminates: no try, a try that swallows, and the real shape', () => {
    const parse = (code: string): ts.SourceFile =>
      ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const bare = 'async function saveSrt() { const saved = await window.api.captions.saveSrt(a, b); if (saved) toast.success("x") }'
    const swallowed = 'async function saveSrt() { try { await window.api.captions.saveSrt(a, b) } catch { /* nothing */ } }'
    const real =
      'async function saveSrt() { try { await window.api.captions.saveSrt(a, b) } catch (err) { reportFailure(err, { failed: "Nope." }) } }'
    expect(guardedAwait(parse(bare), 'saveSrt', 'captions.saveSrt')).toEqual({ awaited: true, guarded: false, failed: null })
    expect(guardedAwait(parse(swallowed), 'saveSrt', 'captions.saveSrt')).toEqual({ awaited: true, guarded: false, failed: null })
    expect(guardedAwait(parse(real), 'saveSrt', 'captions.saveSrt')).toEqual({ awaited: true, guarded: true, failed: 'Nope.' })
  })
})

describe('a settings write is never a bare promise (T-128 (4), T-110 (x))', () => {
  /**
   * Every `window.api.settings.set(...)` call that is neither AWAITED inside the `try` of a try-with-catch (in its own function) nor the
   * receiver of a `.catch(...)`. Such a call rejects into nothing: awaited, it ends the click handler that awaited it (the Welcome screen's
   * "Let's go" stayed on the Welcome screen; Export did nothing); not awaited, it is an unhandled rejection - and a `void` call inside a
   * `try` is not caught by it, because the rejection arrives after the `try` has been left.
   */
  function bareSettingsWrites(sf: ts.SourceFile): string[] {
    const hits: string[] = []
    const isWrite = (n: ts.Node): n is ts.CallExpression =>
      ts.isCallExpression(n) && /(^|\.)settings\.set$/.test(n.expression.getText(sf))
    const isCaughtHere = (n: ts.CallExpression): boolean =>
      ts.isPropertyAccessExpression(n.parent) &&
      n.parent.name.text === 'catch' &&
      ts.isCallExpression(n.parent.parent) &&
      n.parent.parent.expression === n.parent
    const visit = (n: ts.Node, guarded: boolean): void => {
      if (ts.isFunctionLike(n)) guarded = false
      if (ts.isTryStatement(n) && n.catchClause) {
        visit(n.tryBlock, true)
        visit(n.catchClause, guarded)
        if (n.finallyBlock) visit(n.finallyBlock, guarded)
        return
      }
      const awaitedHere = isWrite(n) && ts.isAwaitExpression(n.parent)
      if (isWrite(n) && !(guarded && awaitedHere) && !isCaughtHere(n)) {
        hits.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${n.getText(sf).slice(0, 70)}`)
      }
      ts.forEachChild(n, (c) => visit(c, guarded))
    }
    visit(sf, false)
    return hits
  }

  it('no renderer source writes a setting with a promise nothing handles', () => {
    const offenders = FILES.flatMap((f) => bareSettingsWrites(f.ast).map((h) => `${f.rel} ${h}`))
    expect(offenders, 'route it through persistSetting (lib/persistSetting.ts), or put the await in a try with a catch').toEqual([])
  })

  it('the one helper that writes a setting for the rest is one of the files scanned, and its write sits in a try with a catch', () => {
    const helper = FILES.find((f) => f.rel === 'lib/persistSetting.ts')
    expect(helper, 'lib/persistSetting.ts exists').toBeDefined()
    expect(helper?.text).toMatch(/window\.api\.settings\.set\(/)
    // T-132 (13): with the one fixed toast id, so the writes one gesture makes show one card.
    expect(helper?.text).toMatch(/reportFailure\(err, \{ failed: "Couldn't save your settings\.", id: SETTINGS_FAILED_TOAST_ID \}\)/)
    expect(bareSettingsWrites((helper as (typeof FILES)[number]).ast)).toEqual([])
  })

  it('the finder discriminates: an awaited write, a void write, a write in a try WITHOUT a catch, and one in a nested function are found; the guarded shapes are not', () => {
    const parse = (code: string): ts.SourceFile =>
      ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const hits = (code: string): number => bareSettingsWrites(parse(code)).length
    expect(hits("async function f() { await window.api.settings.set('a', 1) }")).toBe(1)
    expect(hits("function f() { void window.api.settings.set('a', 1) }")).toBe(1)
    expect(hits("function f() { window.api.settings.set('a', 1).then(() => x()) }")).toBe(1)
    expect(hits("async function f() { try { await window.api.settings.set('a', 1) } finally { y() } }")).toBe(1)
    expect(hits("async function f() { try { y() } catch { await window.api.settings.set('a', 1) } }")).toBe(1)
    expect(hits("async function f() { try { y() } catch { y() } finally { await window.api.settings.set('a', 1) } }")).toBe(1)
    expect(hits("async function f() { try { go(() => { window.api.settings.set('a', 1) }) } catch { y() } }")).toBe(1)
    expect(hits("async function f() { await api.settings.set('a', 1); await window.api.settings.set('b', 2) }")).toBe(2)
    // A `try` catches what is awaited inside it, not a promise left running: the rejection arrives after the `try` is over.
    expect(hits("function f() { try { void window.api.settings.set('a', 1) } catch { y() } }")).toBe(1)
    expect(hits("function f() { try { window.api.settings.set('a', 1) } catch { y() } }")).toBe(1)
    expect(hits("async function f() { try { return window.api.settings.set('a', 1) } catch { y() } }")).toBe(1)
    expect(hits("async function f() { try { return await window.api.settings.set('a', 1) } catch { y() } }")).toBe(0)
    expect(hits("async function f() { try { await window.api.settings.set('a', 1) } catch (err) { z(err) } }")).toBe(0)
    expect(hits("function f() { void window.api.settings.set('a', 1).catch(() => toast.error('x')) }")).toBe(0)
    expect(hits("async function f() { try { y(); await window.api.settings.set('a', 1); y() } catch { z() } }")).toBe(0)
    // Reading is another question (a `get` that rejects is a different ticket); another object's `set` is not a setting.
    expect(hits("async function f() { await window.api.settings.get('a'); map.set('a', 1); store.settings.size }")).toBe(0)
  })
})
