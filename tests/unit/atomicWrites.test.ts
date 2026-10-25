import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-139 (1) - a file the person chose or owns is written with `writeFileAtomic`, and every other raw write in main is audited.
 *
 * `writeFile(chosen, bytes)` truncates the file before the first new byte is written, so a failure part-way (a full or removed drive, a crash) leaves
 * neither the old file nor the new one. The fix is one helper (`main/fsAtomic.ts`: a unique tmp beside the target, then a rename over it) used at every
 * write of a file the person chose or owns. This scan is the grep that keeps it so: it finds every call to `writeFile` / `copyFile` / `appendFile`
 * (and their Sync forms) and every `createWriteStream` under `src/main`, from the syntax tree (a comment or a string that says "writeFile(" is not a
 * call), and requires each file's count to be exactly what its row in the audited table below allows. A file with no row is allowed none: a new raw write
 * is either `writeFileAtomic` or a row here, with the reason it does not need one.
 *
 * What the scan cannot see: a write made through a function it was handed, `fs.promises` reached by a name other than the ones it follows (an import
 * of `writeFile` from `node:fs` / `node:fs/promises`, aliased or not, and any `.writeFile(...)` property call), and a `spawn` that writes (ffmpeg
 * writes its own outputs; each export runs `discardPartialOutput` when it fails). The per-handler behavior is the real handlers' tests, in
 * `projectSave.test.ts`, `image.test.ts`, `captionsSaveSrt.test.ts`, `captionsWriteKitSrt.test.ts` and `moodboard.test.ts`.
 */
const MAIN_ROOT = path.resolve(__dirname, '../../src/main')

/** The calls that put bytes in a file. */
const WRITERS = new Set(['writeFile', 'writeFileSync', 'copyFile', 'copyFileSync', 'appendFile', 'appendFileSync', 'createWriteStream'])
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises'])

/** The line of every raw write in `sf`: a call to a writer imported from node's fs (under any local name), or `<anything>.<writer>(...)`. */
export function rawWrites(sf: ts.SourceFile): number[] {
  const local = new Set<string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !FS_MODULES.has(stmt.moduleSpecifier.text)) continue
    const bindings = stmt.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) if (WRITERS.has((el.propertyName ?? el.name).text)) local.add(el.name.text)
    }
  }
  const lines: number[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression
      const hit =
        (ts.isIdentifier(callee) && local.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && WRITERS.has(callee.name.text))
      if (hit) lines.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return lines
}

/** How many calls to `writeFileAtomic` `sf` makes. */
export function atomicWrites(sf: ts.SourceFile): number {
  let n = 0
  const visit = (c: ts.Node): void => {
    if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'writeFileAtomic') n += 1
    ts.forEachChild(c, visit)
  }
  visit(sf)
  return n
}

type Found = Record<string, number[]>

/**
 * What is wrong with a scan, given the audited rows: a file whose raw writes are more or fewer than its row allows (no row: none), and a row for a
 * file with none (stale: delete it). Pure, so it can be shown to discriminate.
 */
export function accountFor(found: Found, table: Record<string, { writes: number }>): { unexpected: string[]; stale: string[] } {
  const files = new Set([...Object.keys(found), ...Object.keys(table)])
  const unexpected: string[] = []
  const stale: string[] = []
  for (const file of files) {
    const lines = found[file] ?? []
    const allowed = table[file]?.writes ?? 0
    if (lines.length === allowed) continue
    if (lines.length === 0) stale.push(file)
    else unexpected.push(`${file}: ${lines.length} raw write(s) at line ${lines.join(', ')}, the table allows ${allowed}`)
  }
  return { unexpected, stale }
}

/**
 * The audited raw writes, by file: how many the file may hold, and why none of them needs the helper. A row is added only after reading the call.
 * The ones marked NOT CONVERTED are real gaps of the same family that were outside the files T-139 Track A owned (listed as found-not-fixed).
 */
const AUDITED_RAW_WRITES: Record<string, { writes: number; why: string }> = {
  'fsAtomic.ts': { writes: 1, why: 'the helper itself: the write of the tmp beside the target' },
  'autosave.ts': {
    writes: 2,
    why: 'its own atomic write (T-07): a unique tmp written and fsynced, then renamed over autosave.json; and the copyFile of the current autosave to autosave.prev.json (a backup slot, not a file the person chose)'
  },
  'search/moodboard.ts': {
    writes: 1,
    why: 'cacheThumb: a regenerable cache file under cache/thumbs. The board that refers to it is written (atomically) only after this write succeeded, and a torn one is swept at the next launch'
  },
  'sidecars/whisperManager.ts': {
    writes: 3,
    why: 'three that are not a chosen file: the burn-in\'s shifted .srt copy in the captions folder (deleted in a finally), `exportSrt` (dead: no caller), and the model download\'s createWriteStream to a .partial file that is size- and hash-checked and then renamed'
  },
  'ffmpeg/concat.ts': { writes: 1, why: 'the concat list file in %TEMP%/imagii-concat, deleted by the runner\'s finally' },
  'ipc/recording.ts': {
    writes: 2,
    why: 'NOT CONVERTED (outside Track A\'s files): the take\'s temp .webm stream, and saveWebm\'s fallback copyFile to the chosen path, which runs after the same function unlinked that path (nothing old to protect on that branch)'
  },
  'customPresets.ts': {
    writes: 1,
    why: 'NOT CONVERTED (outside Track A\'s files): a NEW preset file under a fresh id (no old file to destroy); the reader skips a file that does not parse'
  },
  'audio/presets.ts': {
    writes: 1,
    why: 'NOT CONVERTED (outside Track A\'s files): a NEW preset file under a fresh id (no old file to destroy); the reader skips a file that does not parse'
  }
}

/** The files whose writes T-139 (1) moved onto the helper, and how many calls each makes. */
const CONVERTED: Record<string, number> = {
  'ipc/project.ts': 1,
  'ipc/image.ts': 2,
  'ipc/captions.ts': 2,
  'search/moodboard.ts': 5
}

describe('every write to a file the person chose or owns is atomic (T-139 (1))', () => {
  const files = sourceFilesUnder(MAIN_ROOT)
  const rel = (f: string): string => path.relative(MAIN_ROOT, f).split(path.sep).join('/')

  it('reads the files it is meant to police (a scan over nothing proves nothing)', () => {
    const names = files.map(rel)
    for (const expected of [...Object.keys(CONVERTED), 'fsAtomic.ts', 'autosave.ts', 'ipc/recording.ts', 'sidecars/whisperManager.ts']) {
      expect(names, `${expected} is under src/main`).toContain(expected)
    }
    expect(files.length).toBeGreaterThanOrEqual(45)
  })

  it('no raw write outside the audited table: every other file writes through writeFileAtomic or holds none', () => {
    const found: Found = {}
    for (const f of files) {
      const lines = rawWrites(parseSource(f))
      if (lines.length > 0) found[rel(f)] = lines
    }
    const { unexpected, stale } = accountFor(found, AUDITED_RAW_WRITES)
    expect(unexpected, 'use writeFileAtomic (main/fsAtomic.ts) for a file the person chose or owns, or add a row with the reason it needs none').toEqual([])
    expect(stale, 'a row whose file holds no raw write any more: delete it').toEqual([])
  })

  it.each(Object.entries(CONVERTED))('%s writes through writeFileAtomic, %i call(s), and imports it from main/fsAtomic', (file, calls) => {
    const sf = parseSource(path.join(MAIN_ROOT, file))
    expect(atomicWrites(sf)).toBe(calls)
    const imported = sf.statements.some(
      (s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && /(?:^|\/)fsAtomic$/.test(s.moduleSpecifier.text)
    )
    expect(imported, `${file} imports writeFileAtomic from fsAtomic`).toBe(true)
  })

  it('the three files that took the helper hold no raw write of their own', () => {
    for (const file of ['ipc/project.ts', 'ipc/image.ts', 'ipc/captions.ts']) {
      expect(rawWrites(parseSource(path.join(MAIN_ROOT, file))), `${file} writes only through the helper`).toEqual([])
    }
  })
})

describe('the scan discriminates', () => {
  const lines = (text: string): number[] => rawWrites(parseSource('probe.ts', text))
  const IMPORT = "import { writeFile, copyFile } from 'node:fs/promises'\n"

  it('finds a call to an imported writer, an aliased one, a namespace one and a stream', () => {
    expect(lines(`${IMPORT}await writeFile(p, d)`)).toEqual([2])
    expect(lines(`${IMPORT}await copyFile(a, b)`)).toEqual([2])
    expect(lines("import { writeFile as put } from 'node:fs/promises'\nawait put(p, d)")).toEqual([2])
    expect(lines("import * as fs from 'node:fs'\nfs.writeFileSync(p, d)")).toEqual([2])
    expect(lines("import { createWriteStream } from 'node:fs'\nconst s = createWriteStream(p)")).toEqual([2])
    expect(lines("import fsp from 'node:fs/promises'\nawait fsp.appendFile(p, d)")).toEqual([2])
  })

  it('does not count the helper, a comment, a string, or an import with no call', () => {
    expect(lines("import { writeFileAtomic } from '../fsAtomic'\nawait writeFileAtomic(p, d)")).toEqual([])
    expect(lines(`${IMPORT}// await writeFile(p, d)\nconst s = 'writeFile(p, d)'`)).toEqual([])
    expect(lines(IMPORT)).toEqual([])
    expect(lines('function writeFile(): void {}\nwriteFile()')).toEqual([])
  })

  it('accountFor: a new raw write, a changed count and a stale row are each reported', () => {
    const table = { 'a.ts': { writes: 1 } }
    expect(accountFor({ 'a.ts': [3] }, table)).toEqual({ unexpected: [], stale: [] })
    expect(accountFor({ 'a.ts': [3], 'b.ts': [9] }, table).unexpected).toEqual(['b.ts: 1 raw write(s) at line 9, the table allows 0'])
    expect(accountFor({ 'a.ts': [3, 4] }, table).unexpected).toEqual(['a.ts: 2 raw write(s) at line 3, 4, the table allows 1'])
    expect(accountFor({}, table).stale).toEqual(['a.ts'])
  })

  it('counts the helper\'s calls', () => {
    expect(atomicWrites(parseSource('p.ts', "await writeFileAtomic(a, b)\nawait writeFileAtomic(c, d)\nawait other(writeFileAtomic)"))).toBe(2)
  })
})

/**
 * T-139 (1), round 88b - the specs that LIST a folder a converted site writes into must not read the writer's tmp as a saved file.
 *
 * The first landing's full Playwright run failed once on exactly this: `image.spec.ts`'s `savedNames` was a bare `readdirSync(downloadDir)` and
 * `waitForDownloads` polls its COUNT then reads every name, so a poll that landed while the one file was still `imagii-1.png.<8 hex>.tmp` counted it and read a
 * name the rename had taken. The folders are the ones the specs call `downloadDir` (Stream Graphics exports) and `exportsDir` (the Reference Export). This scan
 * requires every `readdirSync(...)` over one of them, in any spec, to sit inside `withoutAtomicTmp(...)` (`tests/e2e/atomicTmp.ts`, which filters on the writer's
 * own `ATOMIC_TMP`), or in the one function that exists to show the tmp (`rawNames`, used by the cases about the tmp). `fsAtomic.test.ts` pins `ATOMIC_TMP` to the
 * name the real writer makes; `image.spec.ts` "a save in flight leaves a tmp" holds the rename so the tmp is in the folder and asks the helpers the racing question.
 *
 * What it cannot see: a listing of one of those folders through another variable name, or a new folder a converted site starts writing into. A rule that cannot
 * be read is reported by the guard test below (a scan over nothing proves nothing), not assumed.
 */
const E2E_ROOT = path.resolve(__dirname, '../e2e')
const LISTED_FOLDERS = /\b(?:downloadDir|exportsDir)\b/
/** The only function allowed to list one raw: its name says so. */
const RAW_LISTING_FUNCTIONS = new Set(['rawNames'])

/** Every `readdirSync(<a save folder>)` in `sf` (`listings`), and those neither inside `withoutAtomicTmp(...)` nor in a raw-listing function (`unfiltered`). */
export function saveFolderListings(sf: ts.SourceFile): { listings: number; unfiltered: { line: number; text: string }[] } {
  const found: { line: number; text: string }[] = []
  let listings = 0
  const wrapped = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'withoutAtomicTmp') return true
    }
    return false
  }
  const inRawFunction = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name && RAW_LISTING_FUNCTIONS.has(p.name.text)) return true
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && RAW_LISTING_FUNCTIONS.has(p.name.text)) return true
    }
    return false
  }
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'readdirSync') {
      const arg = n.arguments[0]
      if (arg && LISTED_FOLDERS.test(arg.getText(sf))) {
        listings += 1
        if (!wrapped(n) && !inRawFunction(n)) found.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.getText(sf) })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { listings, unfiltered: found }
}

describe('a spec that lists a save folder ignores the atomic writer\'s tmp (T-139 (1))', () => {
  const specs = ['image.spec.ts', 'references.spec.ts', 'home-chrome.spec.ts', 'continuity.spec.ts', 'video-pipelines.spec.ts', 'record.spec.ts', 'audio.spec.ts', 'export.spec.ts', 'smoke.spec.ts', 'video-core.spec.ts']
  const read = (name: string): ts.SourceFile => parseSource(path.join(E2E_ROOT, name))

  it('reads the listings it is meant to police (a scan over nothing proves nothing)', () => {
    const count = (name: string): number => saveFolderListings(read(name)).listings
    expect(count('image.spec.ts'), 'savedNames, clearDownloads and the raw listing').toBeGreaterThanOrEqual(3)
    expect(count('references.spec.ts'), 'the Reference Export poll and its read').toBeGreaterThanOrEqual(2)
  })

  it.each(specs)('%s: every listing of a save folder is filtered, or is the raw one', (name) => {
    expect(saveFolderListings(read(name)).unfiltered, `${name}: wrap it in withoutAtomicTmp(...) (tests/e2e/atomicTmp.ts)`).toEqual([])
  })

  it('discriminates: a bare listing is reported, a wrapped one and the raw function are not', () => {
    const lines = (text: string): number[] => saveFolderListings(parseSource('probe.ts', text)).unfiltered.map((f) => f.line)
    expect(lines('const a = readdirSync(studio.downloadDir).sort()')).toEqual([1])
    expect(lines('const a = readdirSync(exportsDir).length')).toEqual([1])
    expect(lines('const a = withoutAtomicTmp(readdirSync(studio.downloadDir)).sort()')).toEqual([])
    expect(lines('function rawNames(s: S) { return readdirSync(s.downloadDir) }')).toEqual([])
    expect(lines('function other(s: S) { return readdirSync(s.downloadDir) }')).toEqual([1])
    // A folder the converted sites do not write into is none of this scan's business.
    expect(lines('const a = readdirSync(outDir)')).toEqual([])
  })
})

