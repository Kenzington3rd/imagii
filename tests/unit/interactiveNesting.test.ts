import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * T-17 regression: the round-22 interaction sweep found two components that
 * nested one interactive control inside another — a rename `<input>` inside
 * the row-select `<button>` (ClipList) and a remove `<button>` inside the
 * `<label>` that wrapped the time inputs (TextOverlayEditor). Both produce an
 * ambiguous accessible role, an unpredictable activation target, and a
 * locator that resolves to two overlapping controls in Playwright.
 *
 * The check is exact rather than grep-shaped: every renderer `.tsx` is parsed
 * with the TypeScript compiler's own TSX parser, and each JSX element is
 * tested against the ancestor stack. That means it pins EVERY component, not
 * just the two the sweep happened to find, and it can't be fooled by
 * formatting, arrow functions in props, or apostrophes in JSX text.
 */

const RENDERER_ROOT = path.resolve(__dirname, '../../src/renderer/src')

/** Controls that own their own activation behavior. */
const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'label'])

/** Nothing interactive may live inside these — they activate on any click. */
const ACTIVATING = new Set(['button', 'a'])

/** A label may wrap its own field, but never another activation target. */
const FORBIDDEN_INSIDE_LABEL = new Set(['button', 'a', 'label'])

interface Violation {
  file: string
  line: number
  child: string
  ancestor: string
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) tsxFiles(full, out)
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

function tagNameOf(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText(node.getSourceFile())
}

function findViolations(file: string): Violation[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  )
  const found: Violation[] = []
  const stack: string[] = []

  function enter(node: ts.JsxOpeningLikeElement): string | null {
    const name = tagNameOf(node)
    if (!INTERACTIVE.has(name)) return null
    const activatingAncestor = stack.find((a) => ACTIVATING.has(a))
    if (activatingAncestor) {
      found.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        child: name,
        ancestor: activatingAncestor
      })
    } else if (stack.includes('label') && FORBIDDEN_INSIDE_LABEL.has(name)) {
      found.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        child: name,
        ancestor: 'label'
      })
    }
    return name
  }

  function walk(node: ts.Node): void {
    if (ts.isJsxSelfClosingElement(node)) {
      enter(node)
      ts.forEachChild(node, walk)
      return
    }
    if (ts.isJsxElement(node)) {
      const pushed = enter(node.openingElement)
      if (pushed) stack.push(pushed)
      ts.forEachChild(node, walk)
      if (pushed) stack.pop()
      return
    }
    ts.forEachChild(node, walk)
  }

  walk(source)
  return found
}

describe('interactive elements are never nested inside one another', () => {
  const files = tsxFiles(RENDERER_ROOT)

  it('finds renderer components to check', () => {
    // Floor: if a refactor moves the renderer, this test must not silently
    // pass on an empty file list.
    expect(files.length).toBeGreaterThan(30)
  })

  it.each(files.map((f) => [path.relative(RENDERER_ROOT, f), f] as const))(
    '%s nests no control inside another',
    (_label, file) => {
      const violations = findViolations(file)
      expect(
        violations.map((v) => `<${v.child}> inside <${v.ancestor}> at line ${v.line}`)
      ).toEqual([])
    }
  )
})

describe('the nesting scanner discriminates', () => {
  // Proof that the check above can fail: run the same analysis over sources
  // that DO nest, including the exact two shapes T-17 removed. Without this,
  // a scanner that silently matched nothing would look identical to a clean
  // tree.
  function violationsOf(code: string): Violation[] {
    const file = path.join(RENDERER_ROOT, '__fixture__.tsx')
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
    const found: Violation[] = []
    const stack: string[] = []
    function walk(node: ts.Node): void {
      const opening = ts.isJsxElement(node)
        ? node.openingElement
        : ts.isJsxSelfClosingElement(node)
          ? node
          : null
      let pushed: string | null = null
      if (opening) {
        const name = tagNameOf(opening)
        if (INTERACTIVE.has(name)) {
          const activating = stack.find((a) => ACTIVATING.has(a))
          if (activating) found.push({ file, line: 0, child: name, ancestor: activating })
          else if (stack.includes('label') && FORBIDDEN_INSIDE_LABEL.has(name))
            found.push({ file, line: 0, child: name, ancestor: 'label' })
          if (ts.isJsxElement(node)) pushed = name
        }
      }
      if (pushed) stack.push(pushed)
      ts.forEachChild(node, walk)
      if (pushed) stack.pop()
    }
    walk(source)
    return found
  }

  it('flags the old ClipList shape (input inside the row-select button)', () => {
    const v = violationsOf(
      `export const X = () => (<li><button onClick={() => sel(id)}><input value={n} onChange={(e) => r(e)} /></button></li>)`
    )
    expect(v).toHaveLength(1)
    expect(v[0]?.child).toBe('input')
    expect(v[0]?.ancestor).toBe('button')
  })

  it('flags the old TextOverlayEditor shape (button inside a label)', () => {
    const v = violationsOf(
      `export const X = () => (<label><span>Time</span><input value={s} /><button onClick={rm}>x</button></label>)`
    )
    expect(v).toHaveLength(1)
    expect(v[0]?.child).toBe('button')
    expect(v[0]?.ancestor).toBe('label')
  })

  it('allows a label wrapping its own field', () => {
    expect(
      violationsOf(`export const X = () => (<label><span>Gain</span><input type="range" /></label>)`)
    ).toEqual([])
  })

  it('allows sibling controls in a row', () => {
    expect(
      violationsOf(
        `export const X = () => (<li><input value={n} /><button onClick={s}>pick</button><button onClick={d}>x</button></li>)`
      )
    ).toEqual([])
  })
})
