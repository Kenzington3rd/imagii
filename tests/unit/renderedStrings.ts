import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * Which strings in a renderer source file does a person READ?
 *
 * The same question `audioStudioCopy.test.ts` asks of Audio Studio, widened to
 * the whole renderer for `copyConventions.test.ts` (T-92). The answer comes
 * from the syntax tree, not from grepping the file: the code legitimately says
 * `'sustained-loud'`, `'Image Canvas'` in a comment and `cancelled` in a local
 * variable, and none of those is on a screen.
 *
 * A string is READ when it is
 *   - JSX text,
 *   - the value of a copy attribute (title, aria-label, placeholder, alt,
 *     aria-valuetext),
 *   - the value of a property that is copy by name (label, hint, description,
 *     body, question, failed, canceled, title),
 *   - an argument of toast(...), toast.success(...), toast.error(...) or
 *     confirm(...),
 *   - a string a JSX expression CHOOSES between: the branches of a ternary and
 *     the right-hand side of `&&`, `||` and `??` (`{busy ? 'Exporting…' : 'Export'}`).
 *
 * A template literal keeps the position of each `${...}` as a `§`, so a rule
 * can tell "30 fps" from "30fps" even though the 30 is a variable.
 */

/** Marks an interpolated value inside a template literal's text. */
export const HOLE = '§'

export type Origin =
  | 'literal'
  | 'jsx-text'
  | 'jsx-choice'
  | 'attr'
  | 'prop'
  | 'toast'
  | 'toast.success'
  | 'toast.error'
  | 'confirm'

export interface Rendered {
  text: string
  origin: Origin
  line: number
}

const COPY_PROPS = new Set([
  'label',
  'hint',
  'description',
  'body',
  'question',
  'failed',
  'canceled',
  'title'
])
const COPY_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'aria-valuetext', 'alt'])

export function parseSource(file: string, text?: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text ?? readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}

/** Text of a string-ish node, or null. A template keeps its holes as `§`. */
export function textOf(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  if (ts.isTemplateExpression(n)) {
    return n.head.text + n.templateSpans.map((s) => HOLE + s.literal.text).join('')
  }
  return null
}

/** Every string a JSX expression picks between (never a comparison operand). */
function choices(expr: ts.Expression | undefined): string[] {
  if (!expr) return []
  let n: ts.Expression = expr
  while (ts.isParenthesizedExpression(n)) n = n.expression
  const direct = textOf(n)
  if (direct !== null) return [direct]
  if (ts.isConditionalExpression(n)) return [...choices(n.whenTrue), ...choices(n.whenFalse)]
  if (ts.isBinaryExpression(n)) {
    const op = n.operatorToken.kind
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...choices(n.right)]
    }
  }
  return []
}

function lineOf(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
}

/** Strings of a JSX tree handed to toast(...): its text and its choices. */
function jsxStrings(sf: ts.SourceFile, root: ts.Node, origin: Origin, out: Rendered[]): void {
  const walk = (n: ts.Node): void => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, ' ').trim()
      if (t) out.push({ text: t, origin, line: lineOf(sf, n) })
    } else if (ts.isJsxExpression(n)) {
      for (const c of choices(n.expression)) out.push({ text: c, origin, line: lineOf(sf, n) })
    }
    ts.forEachChild(n, walk)
  }
  walk(root)
}

/** Every string in `sf` a person reads. */
export function renderedStrings(sf: ts.SourceFile): Rendered[] {
  const out: Rendered[] = []
  const add = (n: ts.Node | undefined, origin: Origin): void => {
    if (!n) return
    const t = textOf(n)
    if (t !== null) out.push({ text: t, origin, line: lineOf(sf, n) })
  }
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, ' ').trim()
      if (t) out.push({ text: t, origin: 'jsx-text', line: lineOf(sf, n) })
    } else if (ts.isJsxExpression(n) && n.parent && !ts.isJsxAttribute(n.parent)) {
      for (const c of choices(n.expression)) {
        out.push({ text: c, origin: 'jsx-choice', line: lineOf(sf, n) })
      }
    } else if (ts.isJsxAttribute(n) && COPY_ATTRS.has(n.name.getText(sf))) {
      const init = n.initializer
      if (init && ts.isStringLiteral(init)) {
        out.push({ text: init.text, origin: 'attr', line: lineOf(sf, init) })
      } else if (init && ts.isJsxExpression(init)) {
        for (const c of choices(init.expression)) {
          out.push({ text: c, origin: 'attr', line: lineOf(sf, init) })
        }
      }
    } else if (ts.isPropertyAssignment(n) && COPY_PROPS.has(n.name.getText(sf))) {
      for (const c of choices(n.initializer)) {
        out.push({ text: c, origin: 'prop', line: lineOf(sf, n) })
      }
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf)
      const arg = n.arguments[0]
      if (callee === 'toast' || callee === 'toast.success' || callee === 'toast.error') {
        const origin: Origin = callee as Origin
        if (arg && (ts.isJsxElement(arg) || ts.isJsxFragment(arg))) jsxStrings(sf, arg, origin, out)
        else add(arg, origin)
      } else if (callee === 'confirm') {
        add(arg, 'confirm')
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Every `.ts` / `.tsx` under `dir` that is not a test, as absolute paths. */
export function sourceFilesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 8) return
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      if (statSync(full).isDirectory()) walk(full, depth + 1)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
    }
  }
  walk(dir, 0)
  return out
}

/**
 * EVERY string literal and template in `sf`, wherever it sits (a `Record` of
 * display names, a constant, a default argument) — the view `renderedStrings`
 * deliberately does not take. Used only for the retired-NAME rules: a name like
 * "Image Canvas" is specific enough that finding it between quotes anywhere in
 * the renderer is a mistake, and the site that started T-92 was exactly such a
 * map (`STORE_LABEL = { image: 'Image Canvas' }`, whose key is not copy by name).
 */
export function allLiterals(sf: ts.SourceFile): Rendered[] {
  const out: Rendered[] = []
  const visit = (n: ts.Node): void => {
    const t = textOf(n)
    if (t !== null) {
      out.push({
        text: t,
        origin: 'literal',
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
      })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}
