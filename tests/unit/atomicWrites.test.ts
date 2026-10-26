import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { parseSource, sourceFilesUnder } from './renderedStrings'
import { partialPathFor } from '../../src/main/ffmpeg/partialOutput'
import { partialsOnly, withEverything, withoutAtomicTmp } from '../e2e/atomicTmp'

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
 * of `writeFile` from `node:fs` / `node:fs/promises`, aliased or not, and any `.writeFile(...)` property call), and a `spawn` that writes. The last
 * is the second describe below (T-140 (1)): ffmpeg opens, and so truncates, the file it is handed, so a runner that handed it the person's path
 * destroyed the file it was replacing the moment the encode began. Every runner hands it a partial beside the target now and swaps it in when whole
 * (`main/ffmpeg/partialOutput.ts`), and that describe is the scan that keeps it so. The per-handler behavior is the real handlers' tests, in
 * `projectSave.test.ts`, `image.test.ts`, `captionsSaveSrt.test.ts`, `captionsWriteKitSrt.test.ts` and `moodboard.test.ts`; the runners' is
 * `cancelSentinel.test.ts` (every runner, a child that writes where ffmpeg writes), `partialOutput.test.ts`, and Layer 5.
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
    why: 'the take\'s temp .webm stream (a file of imagii\'s own in userData), and saveWebm\'s fallback copyFile, which since T-140 (1) copies to a PARTIAL beside the chosen path and swaps it in with finishPartial (it used to unlink the chosen path first, then copy)'
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
 * T-140 (1) - an ffmpeg that writes a file a person keeps is handed a PARTIAL, and the partial is swapped in only when whole.
 *
 * The scan above sees the writes node makes; ffmpeg's are a `spawn` whose last argument is a path, and ffmpeg truncates what it opens. Executed: a
 * Cancel 1.5 s into a real audio export, and ENOSPC (exit 228), each left NEITHER the 100,000-byte file the Save dialog had been told to replace NOR
 * the new one. A runner now writes `partialPathFor(target)` and calls `finishPartial(work, ...)` once the child has exited (`main/ffmpeg/partialOutput.ts`:
 * a failure, a Cancel or the quit removes the partial and never touches the target; the swap is made only after the runner's own checks and a look at its
 * cancel latch). This scan is the grep that keeps it so: it counts, per file under `src/main`, the `spawn(ffmpegPath, ...)` calls and the `finishPartial(...)`
 * calls, and requires each file's pair to be what its row below allows. A new ffmpeg runner is therefore a row here, with the reason it needs no partial
 * (a pipe, the null muxer, a fresh scratch name in %TEMP%) or the call that gives it one.
 *
 * What it cannot see: a spawn through another name for the binary, and WHETHER the call is made on the path the child was handed (the runners' tests
 * `cancelSentinel.test.ts`, `recordingCancel.test.ts` and Layer 5 hold that: the target is byte for byte what it was after a Cancel).
 */
interface FfmpegRow {
  spawns: number
  finishes: number
  why: string
}

const FFMPEG_RUNNERS: Record<string, FfmpegRow> = {
  'audio/process.ts': { spawns: 1, finishes: 1, why: 'runFfmpegJob is the one spawn; the measure pass (to the null muxer) needs no file, and the render and the mux go through runFfmpegToFile -> finishPartial' },
  'sidecars/whisperManager.ts': { spawns: 1, finishes: 1, why: 'the caption burn-in (the transcription\'s spawn is the whisper program, not ffmpegPath)' },
  'ffmpeg/concat.ts': { spawns: 3, finishes: 2, why: 'the join and the picture-in-picture swap a partial in; the segment is Matroska in %TEMP%/imagii-concat under the job\'s id, removed in the runner\'s finally' },
  'ffmpeg/export.ts': { spawns: 1, finishes: 1, why: 'the platform export' },
  'ffmpeg/gif.ts': { spawns: 1, finishes: 1, why: 'the GIF' },
  'ffmpeg/reframe.ts': { spawns: 1, finishes: 1, why: 'the vertical reframe' },
  'ffmpeg/frame.ts': { spawns: 1, finishes: 1, why: 'the Clip Kit thumbnail' },
  'ipc/recording.ts': { spawns: 0, finishes: 3, why: 'the recording\'s save hands convertToMp4, remuxWebm and the fallback copy a partial beside the chosen path (the spawn is convert.ts\'s, below)' },
  'ffmpeg/convert.ts': { spawns: 1, finishes: 0, why: 'runConvertChild writes the path it is GIVEN: recording.ts hands it a partial and swaps it in (above); convertForImport hands it a fresh nanoid name in %TEMP%/imagii-import that it removes on any failure' },
  'audio/extract.ts': { spawns: 1, finishes: 0, why: 'a fresh nanoid WAV in %TEMP%/imagii-audio, removed by the call that made it on any failure or cancel' },
  'audio/peaks.ts': { spawns: 1, finishes: 0, why: 'writes to a pipe (pipe:1), no file' },
  'ffmpeg/highlights.ts': { spawns: 2, finishes: 0, why: 'both scans write to the null muxer (-f null -), no file' }
}

/** How many `spawn(ffmpegPath, ...)` calls `sf` makes. */
export function ffmpegSpawns(sf: ts.SourceFile): number {
  let n = 0
  const visit = (c: ts.Node): void => {
    if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'spawn') {
      const first = c.arguments[0]
      if (first && ts.isIdentifier(first) && first.text === 'ffmpegPath') n += 1
    }
    ts.forEachChild(c, visit)
  }
  visit(sf)
  return n
}

/** How many calls to `finishPartial` `sf` makes. */
export function finishPartialCalls(sf: ts.SourceFile): number {
  let n = 0
  const visit = (c: ts.Node): void => {
    if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'finishPartial') n += 1
    ts.forEachChild(c, visit)
  }
  visit(sf)
  return n
}

/** What is wrong with the scan, given the rows: a file whose spawns or finishes differ from its row (no row: none allowed), and a row for a file with neither. */
export function accountForRunners(
  found: Record<string, { spawns: number; finishes: number }>,
  table: Record<string, { spawns: number; finishes: number }>
): { unexpected: string[]; stale: string[] } {
  const files = new Set([...Object.keys(found), ...Object.keys(table)])
  const unexpected: string[] = []
  const stale: string[] = []
  for (const file of files) {
    const got = found[file] ?? { spawns: 0, finishes: 0 }
    const row = table[file] ?? { spawns: 0, finishes: 0 }
    if (got.spawns === row.spawns && got.finishes === row.finishes) {
      if (got.spawns === 0 && got.finishes === 0 && table[file]) stale.push(file)
      continue
    }
    unexpected.push(`${file}: ${got.spawns} ffmpeg spawn(s) and ${got.finishes} finishPartial call(s), the table allows ${row.spawns} and ${row.finishes}`)
  }
  return { unexpected, stale }
}

describe('every ffmpeg output a person keeps goes through a partial (T-140 (1))', () => {
  const files = sourceFilesUnder(MAIN_ROOT)
  const rel = (f: string): string => path.relative(MAIN_ROOT, f).split(path.sep).join('/')
  const scan = (): Record<string, { spawns: number; finishes: number }> => {
    const found: Record<string, { spawns: number; finishes: number }> = {}
    for (const f of files) {
      const sf = parseSource(f)
      const spawns = ffmpegSpawns(sf)
      const finishes = finishPartialCalls(sf)
      if (spawns > 0 || finishes > 0) found[rel(f)] = { spawns, finishes }
    }
    return found
  }

  it('reads the runners it is meant to police (a scan over nothing proves nothing)', () => {
    const found = scan()
    for (const expected of ['audio/process.ts', 'sidecars/whisperManager.ts', 'ffmpeg/concat.ts', 'ffmpeg/export.ts', 'ffmpeg/gif.ts', 'ffmpeg/reframe.ts', 'ffmpeg/frame.ts', 'ffmpeg/convert.ts', 'ipc/recording.ts']) {
      expect(Object.keys(found), `${expected} spawns ffmpeg or finishes a partial`).toContain(expected)
    }
  })

  it('no ffmpeg spawn and no finishPartial outside the audited table: a new runner is a row, with its reason or its partial', () => {
    const { unexpected, stale } = accountForRunners(scan(), FFMPEG_RUNNERS)
    expect(unexpected, 'hand ffmpeg `partialPathFor(target)` and call `finishPartial` (main/ffmpeg/partialOutput.ts), or add a row with the reason the output is no person\'s file').toEqual([])
    expect(stale, 'a row whose file spawns no ffmpeg and finishes no partial any more: delete it').toEqual([])
  })

  it('a spawn that is not ffmpeg\'s (the whisper program, ffprobe) is not counted', () => {
    const count = (text: string): number => ffmpegSpawns(parseSource('probe.ts', text))
    expect(count("spawn(ffmpegPath, args, { windowsHide: true })\nspawn(ffmpegPath, ['-i'])")).toBe(2)
    expect(count('spawn(status.exePath, args)\nspawn(ffprobePath, args)\nspawn(bin, [])')).toBe(0)
    expect(count("// spawn(ffmpegPath, args)\nconst s = 'spawn(ffmpegPath, a)'")).toBe(0)
    expect(finishPartialCalls(parseSource('p.ts', 'await finishPartial(a, b)\nawait finishPartial(c, d)\nawait other(finishPartial)'))).toBe(2)
  })

  it('accountForRunners: a new spawn, a dropped finish and a stale row are each reported', () => {
    const table = { 'a.ts': { spawns: 1, finishes: 1 }, 'b.ts': { spawns: 1, finishes: 0 } }
    expect(accountForRunners({ 'a.ts': { spawns: 1, finishes: 1 }, 'b.ts': { spawns: 1, finishes: 0 } }, table)).toEqual({ unexpected: [], stale: [] })
    expect(accountForRunners({ 'a.ts': { spawns: 1, finishes: 1 }, 'b.ts': { spawns: 1, finishes: 0 }, 'c.ts': { spawns: 1, finishes: 0 } }, table).unexpected).toEqual([
      'c.ts: 1 ffmpeg spawn(s) and 0 finishPartial call(s), the table allows 0 and 0'
    ])
    expect(accountForRunners({ 'a.ts': { spawns: 1, finishes: 0 }, 'b.ts': { spawns: 1, finishes: 0 } }, table).unexpected).toEqual([
      'a.ts: 1 ffmpeg spawn(s) and 0 finishPartial call(s), the table allows 1 and 1'
    ])
    expect(accountForRunners({ 'b.ts': { spawns: 1, finishes: 0 } }, table).unexpected).toEqual([
      'a.ts: 0 ffmpeg spawn(s) and 0 finishPartial call(s), the table allows 1 and 1'
    ])
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
// T-140 (1): and the folders the renders go to - `outDir` (the export folder every video spec owns), a Clip Kit's `kitDir` and its parent, the folder a test
// seeded as the remembered one, the Audio Studio test root. ffmpeg writes `<stem>.<8 hex>.partial<ext>` there for as long as an encode runs.
const LISTED_FOLDERS = /\b(?:downloadDir|exportsDir|outDir|kitDir|kitParent|seeded)\b|\bstudio\.root\b/
/** The ways a listing says what it wants: the finished files (`withoutAtomicTmp`), what is left, tmp files and partials in view (`withEverything`), or the partials alone (`partialsOnly`). */
const LISTING_WRAPPERS = new Set(['withoutAtomicTmp', 'withEverything', 'partialsOnly'])
/** The only function allowed to list one raw: its name says so. */
const RAW_LISTING_FUNCTIONS = new Set(['rawNames'])

/** Every `readdirSync(<a save folder>)` in `sf` (`listings`), and those neither inside `withoutAtomicTmp(...)` nor in a raw-listing function (`unfiltered`). */
export function saveFolderListings(sf: ts.SourceFile): { listings: number; unfiltered: { line: number; text: string }[] } {
  const found: { line: number; text: string }[] = []
  let listings = 0
  const wrapped = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && LISTING_WRAPPERS.has(p.expression.text)) return true
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

describe('the e2e listing helpers drop exactly the names the two writers make (T-139 (1), T-140 (1))', () => {
  const PARTIAL = path.basename(partialPathFor('/x/My Clip_youtube.mp4'))

  it('withoutAtomicTmp drops a save\'s tmp AND a render\'s partial, and keeps every finished name', () => {
    const finished = ['My Clip_youtube.mp4', 'My Clip_youtube (2).mp4', 'clip.gif', 'notes.partial.txt', 'holiday.partial.mp4', 'ggml-base.bin.partial']
    const listing = [...finished, 'project.imagii.json.1a2b3c4d.tmp', PARTIAL, path.basename(partialPathFor('/x/a.cleaned.wav')), path.basename(partialPathFor('/x/g.gif'))]
    expect(withoutAtomicTmp(listing)).toEqual(finished)
  })

  it('partialsOnly keeps exactly the renders still being written; withEverything keeps all', () => {
    const wav = path.basename(partialPathFor('/x/a.cleaned.wav'))
    const listing = ['done.mp4', PARTIAL, 'project.imagii.json.1a2b3c4d.tmp', wav]
    expect(partialsOnly(listing)).toEqual([PARTIAL, wav])
    expect(withEverything(listing)).toEqual(listing)
  })
})

describe('a spec that lists a save folder ignores the atomic writer\'s tmp and a render\'s partial, or says it wants them (T-139 (1), T-140 (1))', () => {
  const specs = ['image.spec.ts', 'references.spec.ts', 'home-chrome.spec.ts', 'continuity.spec.ts', 'video-pipelines.spec.ts', 'record.spec.ts', 'audio.spec.ts', 'export.spec.ts', 'smoke.spec.ts', 'video-core.spec.ts']
  const read = (name: string): ts.SourceFile => parseSource(path.join(E2E_ROOT, name))

  it('reads the listings it is meant to police (a scan over nothing proves nothing)', () => {
    const count = (name: string): number => saveFolderListings(read(name)).listings
    expect(count('image.spec.ts'), 'savedNames, clearDownloads and the raw listing').toBeGreaterThanOrEqual(3)
    expect(count('references.spec.ts'), 'the Reference Export poll and its read').toBeGreaterThanOrEqual(2)
    expect(count('video-pipelines.spec.ts'), 'the export folders, the kit folders and the seeded folders of the video specs').toBeGreaterThanOrEqual(40)
    expect(count('audio.spec.ts'), 'the export test\'s one file').toBeGreaterThanOrEqual(2)
    expect(count('export.spec.ts'), 'the smoke export\'s one artifact').toBeGreaterThanOrEqual(1)
  })

  it.each(specs)('%s: every listing of a save folder is filtered, or is the raw one', (name) => {
    expect(
      saveFolderListings(read(name)).unfiltered,
      `${name}: wrap it in withoutAtomicTmp(...) for the finished files, or withEverything(...) for what is left (tests/e2e/atomicTmp.ts)`
    ).toEqual([])
  })

  it('discriminates: a bare listing is reported, a wrapped one and the raw function are not', () => {
    const lines = (text: string): number[] => saveFolderListings(parseSource('probe.ts', text)).unfiltered.map((f) => f.line)
    expect(lines('const a = readdirSync(studio.downloadDir).sort()')).toEqual([1])
    expect(lines('const a = readdirSync(exportsDir).length')).toEqual([1])
    expect(lines('const a = withoutAtomicTmp(readdirSync(studio.downloadDir)).sort()')).toEqual([])
    // T-140 (1): the video specs' folders, bare, are reported; either wrapper (the finished files, or what is left) is not.
    expect(lines('const a = readdirSync(outDir).filter((f) => f.endsWith(".mp4"))')).toEqual([1])
    expect(lines('const a = readdirSync(kitDir)')).toEqual([1])
    expect(lines('const a = readdirSync(seeded).sort()')).toEqual([1])
    expect(lines('const a = readdirSync(studio.root)')).toEqual([1])
    expect(lines('const a = withEverything(readdirSync(outDir))')).toEqual([])
    expect(lines('const a = partialsOnly(readdirSync(studio.root))')).toEqual([])
    expect(lines('const a = withoutAtomicTmp(readdirSync(kitDir)).filter((f) => f.endsWith(".mp4"))')).toEqual([])
    expect(lines('const a = notAWrapper(readdirSync(outDir))')).toEqual([1])
    expect(lines('function rawNames(s: S) { return readdirSync(s.downloadDir) }')).toEqual([])
    expect(lines('function other(s: S) { return readdirSync(s.downloadDir) }')).toEqual([1])
    // A folder the converted sites do not write into is none of this scan's business.
    expect(lines('const a = readdirSync(presetsDir)')).toEqual([])
  })
})


/**
 * T-140 (1), sent back - a runner that swaps a render in over a file the person named must hand its caller the path the render LANDED at.
 *
 * When that file is open in another app the disk refuses the swap onto it for good, and `commitPartial` keeps the render beside it under the next free name
 * (`partialOutput.ts`). The only way the person ever learns where it is, and the only way "Show in folder" or "Edit in Video Studio" opens the right file, is
 * that the runner returns `finishPartial`'s answer. A call written as a bare statement, `await finishPartial(...)`, throws that answer away and reports the
 * chosen name over a file that was not replaced: so every such call is listed here, with the reason its caller can do without. A new one is a row, or it keeps
 * the answer (`const { outputPath } = await finishPartial(...)`).
 */
const DROPPED_LANDINGS: Record<string, { calls: number; why: string }> = {
  'ffmpeg/frame.ts': {
    calls: 1,
    why: 'a Clip Kit thumbnail goes into a folder made a moment ago, and the runner refuses the name if anything is there: nothing at the target can be open in another app, so the swap is never redirected'
  }
}

/** How many calls to `finishPartial` in `sf` stand alone as a statement (`await finishPartial(...)`), so their answer is thrown away. */
export function droppedLandings(sf: ts.SourceFile): number {
  let n = 0
  const visit = (c: ts.Node): void => {
    if (
      ts.isExpressionStatement(c) &&
      ts.isAwaitExpression(c.expression) &&
      ts.isCallExpression(c.expression.expression) &&
      ts.isIdentifier(c.expression.expression.expression) &&
      c.expression.expression.expression.text === 'finishPartial'
    ) {
      n += 1
    }
    ts.forEachChild(c, visit)
  }
  visit(sf)
  return n
}

describe('a runner that swaps a render over a named file keeps the path it landed at (T-140 (1))', () => {
  const files = sourceFilesUnder(MAIN_ROOT)
  const rel = (f: string): string => path.relative(MAIN_ROOT, f).split(path.sep).join('/')
  const scan = (): Record<string, number> => {
    const found: Record<string, number> = {}
    for (const f of files) {
      const n = droppedLandings(parseSource(f))
      if (n > 0) found[rel(f)] = n
    }
    return found
  }

  it('no finishPartial call throws its answer away outside the audited table', () => {
    const found = scan()
    const unexpected = Object.entries(found)
      .filter(([file, n]) => n !== (DROPPED_LANDINGS[file]?.calls ?? 0))
      .map(([file, n]) => `${file}: ${n} call(s) drop the landed path, the table allows ${DROPPED_LANDINGS[file]?.calls ?? 0}`)
    expect(unexpected, 'keep the answer: `const { outputPath } = await finishPartial(...)`, and return it to the caller').toEqual([])
    const stale = Object.keys(DROPPED_LANDINGS).filter((file) => !(file in found))
    expect(stale, 'a row whose file no longer drops the answer: delete it').toEqual([])
  })

  it('reads the runners it is meant to police (a scan over nothing proves nothing)', () => {
    const keepers = ['audio/process.ts', 'sidecars/whisperManager.ts', 'ipc/recording.ts', 'ffmpeg/export.ts', 'ffmpeg/gif.ts', 'ffmpeg/reframe.ts', 'ffmpeg/concat.ts']
    for (const file of keepers) {
      const sf = parseSource(path.join(MAIN_ROOT, file))
      expect(finishPartialCalls(sf), `${file} calls finishPartial`).toBeGreaterThan(0)
      expect(droppedLandings(sf), `${file} keeps every answer`).toBe(0)
    }
  })

  it('discriminates: a bare await is reported; a kept answer, a returned one and a mention are not', () => {
    const count = (text: string): number => droppedLandings(parseSource('probe.ts', text))
    expect(count('await finishPartial(work, o)')).toBe(1)
    expect(count('async function f() {\n  await finishPartial(a, b)\n  await finishPartial(c, d)\n}')).toBe(2)
    expect(count('const { outputPath } = await finishPartial(work, o)')).toBe(0)
    expect(count('const done = await finishPartial(work, o)')).toBe(0)
    expect(count('return await finishPartial(work, o)')).toBe(0)
    expect(count('landed = (await finishPartial(work, o)).outputPath')).toBe(0)
    expect(count('// await finishPartial(work, o)\nconst s = "await finishPartial(work, o)"')).toBe(0)
  })
})
