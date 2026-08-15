import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Static reachability for a route: follow the relative imports out of a
 * route module and collect every renderer source it can render.
 *
 * Why static rather than a rendered DOM: the unit layer runs in node with no
 * DOM (docs/TESTING.md Layer 1), so "does this selector match something on
 * the route" is answered by asking which components the route can mount and
 * what attributes those components declare. It cannot see a conditional
 * branch — an attribute inside `{loaded ? … : null}` counts as present — so
 * a green run means "the target exists in this route's tree", not "it is on
 * screen right now". The end-state clicks live in the E2E fleet (T-21..T-27).
 */

export const RENDERER_ROOT = path.resolve(__dirname, '../../src/renderer/src')

const MAX_FILES = 400
const IMPORT_RE = /from\s+'([^']+)'/g

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else if (spec.startsWith('@/')) base = path.join(RENDERER_ROOT, spec.slice(2))
  else return null // node_modules or @shared — no JSX of ours in either
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, 'index.tsx'),
    path.join(base, 'index.ts')
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Every renderer file reachable from `entry` (absolute paths, entry included). */
export function collectRouteSources(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  // Bounded: a cycle can't spin because `seen` gates the push, and MAX_FILES
  // caps a pathological tree.
  while (queue.length > 0 && seen.size < MAX_FILES) {
    const file = queue.shift()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    IMPORT_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = IMPORT_RE.exec(source)) !== null) {
      const spec = match[1]
      if (spec === undefined) continue
      const resolved = resolveImport(file, spec)
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return [...seen]
}

/** Concatenated text of every file in the list — for "is this wired" greps. */
export function readAll(files: string[]): string {
  return files.map((f) => readFileSync(f, 'utf8')).join('\n')
}

/**
 * Every `data-tutorial="…"` value DECLARED as a JSX attribute in the given
 * files.
 *
 * Two exclusions, both learned the hard way while writing this: the tutorial
 * definition modules are reachable from every studio (the studio imports its
 * own tour) and they contain the string `[data-tutorial="video-crop"]` as a
 * selector — so without the `tutorials/` filter and the "not preceded by `[`"
 * rule, every step's selector proved its own existence and the test passed
 * with both T-16 attributes deleted.
 */
export function collectTutorialTargets(files: string[]): Set<string> {
  const found = new Set<string>()
  const re = /(^|[^[])data-tutorial="([^"]+)"/g
  for (const file of files) {
    if (file.includes(`${path.sep}tutorials${path.sep}`)) continue
    const source = readFileSync(file, 'utf8')
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      if (match[2] !== undefined) found.add(match[2])
    }
  }
  return found
}

export const ROUTE_ENTRY: Record<string, string> = {
  '/home': path.join(RENDERER_ROOT, 'routes/Home.tsx'),
  '/video': path.join(RENDERER_ROOT, 'routes/Video.tsx'),
  '/audio': path.join(RENDERER_ROOT, 'routes/Audio.tsx'),
  '/image': path.join(RENDERER_ROOT, 'routes/Image.tsx'),
  '/record': path.join(RENDERER_ROOT, 'routes/Record.tsx'),
  '/references': path.join(RENDERER_ROOT, 'routes/References.tsx')
}
