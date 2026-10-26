import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { RENDERER_ROOT } from './routeSources'
import ts from 'typescript'
import { parseSource, sourceFilesUnder } from './renderedStrings'
import * as lufsPanel from '../../src/renderer/src/modules/audio-studio/LevelsPanel'

/**
 * T-123 (21)-(34): claims in the docs and the comments that a test can hold, held.
 *
 * Round 73's reviewers found a dozen sentences that were false of the tree they sat in: a banner string that does
 * not exist, a "downsamples to 2048 px" that nothing does, a toast "default" that was right for one of three kinds, a
 * retired control name in the guide that forbids it. A sentence is just a string, so nothing failed. These read the
 * sentence AND the thing it describes, so the next change to either one is a failing test and not a sweep finding.
 * What a test cannot hold (a cite's line number in prose) is re-pointed by hand and stays where a reviewer reads it.
 */
const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8')
const flat = (text: string): string => text.replace(/\s+/g, ' ')

describe('the toast durations the guides state are react-hot-toast 2.6.0\'s (T-123 (34))', () => {
  const lib = path.join(ROOT, 'node_modules', 'react-hot-toast')

  it('reads the installed library: its version and its defaults', () => {
    const pkg = JSON.parse(readFileSync(path.join(lib, 'package.json'), 'utf8')) as { version: string }
    expect(pkg.version).toBe('2.6.0')
    const store = readFileSync(path.join(lib, 'src', 'core', 'store.ts'), 'utf8')
    // A success toast is 2 s; a plain toast (`blank`) and an error are 4 s; a loading toast never leaves.
    expect(store).toMatch(/blank:\s*4000/)
    expect(store).toMatch(/error:\s*4000/)
    expect(store).toMatch(/success:\s*2000/)
  })

  it('AppToaster sets no duration of its own, so the library\'s are the ones a person gets', () => {
    const toaster = read('src/renderer/src/components/AppToaster.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(toaster).not.toMatch(/duration/i)
  })

  it('BRANDING and STYLE_GUIDE say 2 s for a success toast and 4 s for a plain or an error one, never "2 s plain"', () => {
    const branding = flat(read('docs/BRANDING_GUIDE.md'))
    expect(branding).toMatch(/2 s for a success toast and 4 s for a plain or an error one/)
    expect(branding).not.toMatch(/The default 2 s is a notification/)
    const style = flat(read('docs/STYLE_GUIDE.md'))
    expect(style).toMatch(/2 s for a success toast and 4 s for a plain or an error one/)
    expect(style).not.toMatch(/2 s plain/)
  })
})

describe('BRANDING does not quote a name the tutorial test forbids (T-123 (22))', () => {
  it('its tutorial-copy example is the checkbox as the screen says it, and the retired names appear nowhere in it', () => {
    const branding = flat(read('docs/BRANDING_GUIDE.md'))
    expect(branding).toContain('"Duck under your voice"')
    expect(branding).not.toMatch(/Duck under (primary|voice)\b/i)
  })
})

describe('the autosave banner the guides quote is the one the app draws (T-123 (23))', () => {
  const banner = read('src/renderer/src/components/AutosaveRestore.tsx')

  it('the component says "imagii autosaved your work {age}. Want to pick up where you left off?" with Restore, Clear and Later', () => {
    expect(banner).toMatch(/imagii autosaved your work \{ageText\}\. Want to pick up where you left off\?/)
    for (const label of ['Restore', 'Clear', 'Later']) expect(banner, label).toMatch(new RegExp(`>\\s*(?:\\{restoring \\? 'Restoring…' : )?'?${label}'?\\}?\\s*<`))
  })

  it.each(['README.md', 'FOR_MIKE.md'])('%s quotes it, and says it appears after a normal close as well as a crash', (rel) => {
    const text = flat(read(rel))
    expect(text).toContain('imagii autosaved your work N min ago. Want to pick up where you left off?')
    expect(text).not.toMatch(/minutes ago — Restore\?/)
    // The closing snapshot (index.ts) is why: a clean quit leaves an autosave too.
    expect(text).toMatch(/normal close|one last snapshot/)
    expect(text).toMatch(/\*\*Restore\*\*, \*\*Clear\*\* and \*\*Later\*\*/)
    expect(text).not.toMatch(/(?:If|When) imagii (?:previously )?crashed or was force-quit/)
  })

  it('the closing snapshot exists: both quit paths flush through flushAutosaveOnQuit', () => {
    const index = read('src/main/index.ts')
    expect(index.match(/flushAutosaveOnQuit\(/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('the user guide names things the way BRANDING does (T-123 (23))', () => {
  const guide = flat(read('docs/USER_GUIDE.md'))

  it('"saved boards" and "title drafts", not the never-say "collections" and "title ideas"', () => {
    expect(guide).toContain('your saved boards')
    expect(guide).toContain('four title drafts')
    expect(guide).not.toMatch(/saved collections/i)
    expect(guide).not.toMatch(/title ideas/i)
  })

  it('BRANDING lists them as never-say', () => {
    const branding = read('docs/BRANDING_GUIDE.md')
    expect(branding).toMatch(/\| \*\*Mood board\*\* \| Moodboard, collection \|/)
    expect(branding).toMatch(/\| \*\*Title starters\*\* \| title ideas, title generator \|/)
  })
})

describe('Clean audio takes a video\'s audio, not a clip\'s (T-123 (21))', () => {
  it('FOR_MIKE says so, and the code extracts the whole file', () => {
    expect(flat(read('FOR_MIKE.md'))).toContain('pipes a video\'s audio through here')
    expect(flat(read('FOR_MIKE.md'))).not.toContain('pipes a clip through here')
    // `cleanAudioFlow` hands `extractFromVideo` the source file: no range, no clip.
    expect(read('src/renderer/src/modules/video-studio/VideoStudio.tsx')).toMatch(/extractFromVideo\(source\.filePath\)/)
  })
})

describe('the Stream Graphics preview is not "downsampled" (T-123 (28))', () => {
  it('README names the real cap, the 800 px placed size, and the code has it', () => {
    const readme = flat(read('README.md'))
    expect(readme).not.toMatch(/downsamples to 2048/)
    expect(readme).toContain('places an imported image at most 800 px on its long side')
    // T-137 (6): the 800 px is the shared constant now (the stored copy is a second one, twice as big), and ImportPanel places the layer with it.
    // T-139 (2): through `placementFor`, which applies that bound and then the document's (re-pointed from the `scaleToFit` call that moved into it, not loosened).
    expect(read('src/shared/imageBounds.ts')).toMatch(/export const LAYER_DRAWN_MAX_DIM = 800\n/)
    expect(read('src/shared/imageBounds.ts')).toMatch(/const scale = scaleToFit\(picWidth, picHeight, LAYER_DRAWN_MAX_DIM\)/)
    expect(read('src/renderer/src/modules/image-studio/ImportPanel.tsx')).toMatch(/placementFor\(dims\.width, dims\.height, docWidth, docHeight\)/)
  })

  it('and nothing in the renderer resamples to 2048', () => {
    const hits = sourceFilesUnder(RENDERER_ROOT)
      .filter((f) => /\b2048\b/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
      .map((f) => path.relative(RENDERER_ROOT, f))
    expect(hits).toEqual([])
  })
})

describe('every pure-black wash in the renderer is one DESIGN_GUIDE names (T-123 (29))', () => {
  const BLACK = /\bbg-black(?:\/\d+)?\b/

  /** The files that use `bg-black`, by name, that the text does not mention. */
  function undocumented(files: Record<string, string>, section: string): string[] {
    return Object.entries(files)
      .filter(([, text]) => BLACK.test(text))
      .map(([rel]) => rel)
      .filter((rel) => {
        // The file's name as a whole word: "Panel" is not "MoodBoardPanel".
        const name = path.basename(rel).replace(/\.[^.]+$/, '')
        return !new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9])`).test(section)
      })
  }

  const guide = read('docs/DESIGN_GUIDE.md')
  const start = guide.indexOf('**Documented raw-color exceptions.**')
  const end = guide.indexOf('**Text on a wash of its own hue')
  const section = guide.slice(start, end)

  it('finds the exception list it is meant to read', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(section).toMatch(/Pure black: the video matte and the hover scrim/)
  })

  it('every renderer file that draws one is named there (Modal\'s scrim is named in the same entry)', () => {
    const files: Record<string, string> = {}
    for (const f of sourceFilesUnder(RENDERER_ROOT)) files[path.relative(RENDERER_ROOT, f)] = readFileSync(f, 'utf8')
    const users = Object.entries(files).filter(([, t]) => BLACK.test(t)).map(([rel]) => path.basename(rel))
    // The five the round found (the four the ticket named, and the Modal scrim) - and nothing the guide does not name.
    expect(users.sort()).toEqual(['Modal.tsx', 'MoodBoardPanel.tsx', 'Player.tsx', 'RecordStudio.tsx', 'ReferencePanel.tsx'])
    expect(undocumented(files, section)).toEqual([])
  })

  it('the check discriminates: a file the section does not name is reported, one it names is not', () => {
    expect(undocumented({ 'modules/new/Panel.tsx': '<div className="bg-black/40" />' }, section)).toEqual(['modules/new/Panel.tsx'])
    expect(undocumented({ 'modules/video-studio/Player.tsx': '<div className="bg-black" />' }, section)).toEqual([])
    expect(undocumented({ 'modules/new/Panel.tsx': '<div className="bg-blackish" />' }, section)).toEqual([])
  })

  it('CHECKER_A and CHECKER_B are documented as JS-only, with no Tailwind mirror to drift from', () => {
    expect(section).toContain('CHECKER_A')
    expect(section).toContain('CHECKER_B')
    expect(section).toMatch(/JS-only tokens/)
    const tokens = read('src/renderer/src/styles/tokens.ts')
    expect(tokens).toMatch(/export const CHECKER_A = '#221616'/)
    expect(tokens).toMatch(/export const CHECKER_B = '#1c1313'/)
    // No Tailwind twin: the config does not name them, which is what "JS-only" means.
    expect(read('tailwind.config.js')).not.toMatch(/checker/i)
  })
})

describe('the mood board\'s cache button says the verb BRANDING says (T-123 (33))', () => {
  it('its tooltip says Clear, and no tooltip in the app says "Drop the"', () => {
    const panel = read('src/renderer/src/modules/references/MoodBoardPanel.tsx')
    expect(panel).toContain('title="Clear the on-disk thumbnail cache for mood boards"')
    for (const f of sourceFilesUnder(RENDERER_ROOT)) {
      expect(readFileSync(f, 'utf8'), path.relative(RENDERER_ROOT, f)).not.toMatch(/title="Drop the /)
    }
  })
})

describe('the timing claims point at the one table (T-123 (31))', () => {
  it('playwright.config.ts and video-pipelines.spec.ts carry no duration of their own', () => {
    const config = read('playwright.config.ts')
    expect(config).not.toMatch(/~\s*4 min|about 4 min|2\.7/)
    expect(config).toMatch(/How long each layer takes/)
    const spec = read('tests/e2e/video-pipelines.spec.ts')
    expect(spec).not.toMatch(/~\s*70 s/)
  })

  it('TESTING has the table, and it states the counts this round measured', () => {
    const testing = read('docs/TESTING.md')
    expect(testing).toMatch(/## How long each layer takes/)
    expect(existsSync(path.join(ROOT, 'docs', 'TESTING.md'))).toBe(true)
  })
})

describe('the file:line cites in image.spec.ts point at the lines they name (T-123 (32))', () => {
  // The spec cites source lines in its comments; a line that moves makes the comment a small lie. `[cite as written, the file it
  // names, the first line, the last line, what those lines hold]`. ImportPanel.tsx:70 was the one found (the cap is :71), and the
  // others were re-read with it: a cite that moves now fails here instead of waiting for the next sweep.
  const CITES: ReadonlyArray<readonly [string, string, number, number, RegExp]> = [
    ['Canvas.tsx:411', 'src/renderer/src/modules/image-studio/Canvas.tsx', 411, 411, /__imagiiStage/],
    ['Canvas.tsx:170-179', 'src/renderer/src/modules/image-studio/Canvas.tsx', 170, 179, /Fit-to-container scaling[\s\S]*MAX_STAGE_ZOOM/],
    ['Canvas.tsx:253', 'src/renderer/src/modules/image-studio/Canvas.tsx', 253, 253, /absW > MIN_DRAW_PX && absH > MIN_DRAW_PX/],
    ['Canvas.tsx:165-168', 'src/renderer/src/modules/image-studio/Canvas.tsx', 165, 168, /function snap\([\s\S]*gridSize/],
    ['Canvas.tsx:179', 'src/renderer/src/modules/image-studio/Canvas.tsx', 179, 179, /MAX_STAGE_ZOOM = 4/],
    ['canvasStore.ts:325', 'src/renderer/src/modules/image-studio/state/canvasStore.ts', 325, 325, /'Line'/],
    ['canvasStore.ts:148', 'src/renderer/src/modules/image-studio/state/canvasStore.ts', 148, 148, /selectedLayerId: get\(\)\.selectedLayerId === id \? null/],
    ['canvasStore.ts:107', 'src/renderer/src/modules/image-studio/state/canvasStore.ts', 107, 107, /future: \[\]/],
    ['ImageStudio.tsx:67-76', 'src/renderer/src/modules/image-studio/ImageStudio.tsx', 67, 76, /e\.key === 'v'[\s\S]*setTool\('pencil'\)/],
    ['ImageStudio.tsx:61', 'src/renderer/src/modules/image-studio/ImageStudio.tsx', 61, 61, /if \(hasChordModifier\(e\)\) return/],
    ['ImageStudio.tsx:58', 'src/renderer/src/modules/image-studio/ImageStudio.tsx', 58, 58, /focusOwnsKey\(/],
    ['PropertiesPanel.tsx:47', 'src/renderer/src/modules/image-studio/PropertiesPanel.tsx', 47, 47, /<PositionBox value=\{layer\.x\}/],
    ['ImportPanel.tsx:76', 'src/renderer/src/modules/image-studio/ImportPanel.tsx', 76, 76, /placementFor\(dims\.width, dims\.height, docWidth, docHeight\)/],
    ['src/main/index.ts:123-124', 'src/main/index.ts', 123, 124, /minWidth: 1024[\s\S]*minHeight: 640/]
  ]

  const spec = read('tests/e2e/image.spec.ts')

  it.each(CITES)('%s', (cite, file, from, to, anchor) => {
    expect(spec, `image.spec.ts no longer carries "${cite}": update the table with the comment`).toContain(cite)
    const lines = read(file).split('\n').slice(from - 1, to).join('\n')
    expect(lines, `${file}:${from}-${to} is not what image.spec.ts says it is`).toMatch(anchor)
  })

  it('every file:line cite in the spec is in the table (a new cite needs an anchor)', () => {
    const found = [...spec.matchAll(/\b((?:src\/main\/)?[A-Za-z]+\.tsx?:\d+(?:-\d+)?)/g)].map((m) => m[1] as string)
    for (const cite of new Set(found)) expect(CITES.map((c) => c[0]), `${cite} has no anchor`).toContain(cite)
  })
})

// T-123 (14) pinned the 2-hour waveform ceiling as a marked simplification naming its upgrade, T-110 (ao). T-129 IS that upgrade:
// the peaks are computed in main and the ceiling is gone, so the pin is flipped - the simplification, its constant and the sentence
// that named the limit are nowhere in the source the app is built from.
describe('the waveform ceiling\'s simplification is retired by its own upgrade (T-129, flipping T-123 (14))', () => {
  it('shared/audio.ts carries no ceiling and no simplification naming T-110(ao)', () => {
    const audio = read('src/shared/audio.ts')
    expect(audio).not.toMatch(/WAVEFORM_MAX_SEC|waveformCeilingRefusal/)
    expect(audio).not.toMatch(/\/\/ simplification: [^\n]*T-110\(ao\)/)
  })

  it('no source file still refuses, or describes, a 2-hour limit on Audio Studio', () => {
    for (const file of [
      'src/shared/audio.ts',
      'src/main/ipc/audio.ts',
      'src/renderer/src/modules/audio-studio/state/audioStore.ts',
      'src/renderer/src/modules/video-studio/VideoStudio.tsx',
      'src/renderer/src/modules/audio-studio/WaveformView.tsx'
    ]) {
      const code = read(file)
      expect(code, file).not.toMatch(/longer than 2 hours|WAVEFORM_MAX_SEC|waveformCeilingRefusal/)
    }
  })

  // T-132 (2): T-129 retired the sentence in PRODUCT_GUIDE's studio table, and the next checkpoint's merge resolution took the OTHER side of
  // that table (built before T-129) and put "up to 2 hours long" back: the only line of the wave that reverted, and no test read the docs
  // for it (this scan read source files only). The three documents a reader opens first are read now, for the limit stated as any of its
  // shapes and for the sentence that replaced it.
  it.each(['README.md', 'docs/PRODUCT_GUIDE.md', 'docs/USER_GUIDE.md'])('%s states no 2-hour limit on Audio Studio', (file) => {
    const text = flat(read(file))
    expect(text, `${file} states the retired ceiling`).not.toMatch(
      /(?:up to|longer than|over|past|more than|within|at most) (?:2|two) hours?|(?:2|two)[- ]hours? (?:long|limit|ceiling|maximum|max)\b/i
    )
  })

  it('PRODUCT_GUIDE says what Audio Studio opens: sound of any length, its waveform computed in the main process from a stream of it', () => {
    expect(flat(read('docs/PRODUCT_GUIDE.md'))).toContain(
      'Opens sound of any length (the waveform is computed in the main process from a stream of the sound).'
    )
  })
})

describe('"deleting that folder clears everything" is only said of what imagii keeps in that folder (T-124 (27))', () => {
  // Round 73 wrote the sentence in four places. It is false for the %TEMP% working copies (full-length WAVs in imagii-audio,
  // converted videos that carry the person's file name in imagii-import, imagii-concat), which are not in %APPDATA%\imagii at all.
  const SOURCES = ['README.md', 'FOR_MIKE.md', 'docs/USER_GUIDE.md'] as const

  it.each(SOURCES)('%s: every "clears everything" is limited to what imagii keeps in that folder', (file) => {
    const text = flat(read(file))
    const claims = [...text.matchAll(/clears everything(?! imagii keeps there)/g)]
    expect(claims.length, `${file} still says a folder "clears everything" without limiting it`).toBe(0)
    expect(text).toMatch(/clears everything imagii keeps there/)
  })

  it.each(SOURCES)('%s: each limited claim is followed, in the same breath, by the three TEMP folders and the next-launch prune', (file) => {
    const text = flat(read(file))
    const claims = [...text.matchAll(/clears everything imagii keeps there\./g)]
    expect(claims.length, `${file} has no limited claim to check`).toBeGreaterThan(0)
    for (const claim of claims) {
      const after = text.slice((claim.index ?? 0) + claim[0].length, (claim.index ?? 0) + claim[0].length + 420)
      for (const dir of ['imagii-audio', 'imagii-import', 'imagii-concat']) expect(after, `${file}: ${dir} is not named after the claim`).toContain(dir)
      expect(after, `${file}: the next-launch prune is not named after the claim`).toMatch(/older than 6 hours the next time it starts/)
    }
  })

  it('the folders and the 6 hours are the ones the prune reaps (tempCleanup.ts)', () => {
    const prune = read('src/main/tempCleanup.ts')
    expect(prune).toMatch(/TEMP_SUBDIRS = \['imagii-audio', 'imagii-concat', 'imagii-import'\]/)
    expect(prune).toMatch(/STALE_THRESHOLD_MS = 6 \* 60 \* 60 \* 1000/)
  })

  it('USER_GUIDE says it in both places it used to say the unlimited thing (Where your data lives, Mood Boards)', () => {
    const guide = flat(read('docs/USER_GUIDE.md'))
    expect([...guide.matchAll(/clears everything imagii keeps there/g)]).toHaveLength(2)
  })
})

describe('the Levels ceiling is described as what it is: a limiter on a chain with something in it (T-124 (26), (31))', () => {
  // T-123 (10) wrote "Peaks above -1 dBFS are limited when you export" under Manual gain, unconditionally. The export code
  // deliberately leaves a bare pass-through (`anull`) alone - nothing switched on is the file that went in - so the panel's sentence
  // was false for the one export that changes nothing. The README bullet the T-123 Done entry said carried it did not carry it.
  const panel = flat(read('src/renderer/src/modules/audio-studio/LevelsPanel.tsx'))

  it('the code limits a chain with a stage in it, and leaves a bare pass-through and an Even volume chain to their own ends', () => {
    const process = read('src/main/audio/process.ts')
    expect(process).toMatch(/const limited = !spec\.chain\.loudnorm && finalChain\.filterPass2 !== EMPTY_CHAIN/)
    expect(process).toMatch(/limited \? `\$\{finalChain\.filterPass2\},\$\{MIX_LIMITER\}` : finalChain\.filterPass2/)
    expect(read('src/main/audio/chain.ts')).toMatch(/export const EMPTY_CHAIN = 'anull'/)
  })

  it('the panel says "when you boost, switch something on or cut a part out", says what stays as it was, and has no unconditional copy of the sentence (T-125 (15))', () => {
    // T-125 (15): a cut counts. It is no "switch", but a cut makes the chain non-empty, so the limiter runs (executed: a -0.3 dBFS file
    // cut and nothing else exported at -1.2 dBFS), and "With nothing switched on, the export keeps your levels as they are" was false for it.
    expect(panel).toMatch(/When you boost, switch something on or cut a part out, peaks above −1 dBFS are limited in the export, so a boost cannot clip\. Otherwise the export keeps your levels as they are\./)
    expect(panel).not.toMatch(/With nothing switched on, the export keeps your levels as they are/)
    // ...and the claim is the code's: a cut alone IS a stage, so the chain ends in the limiter (singleTrackTail.test.ts: "a cut alone is a stage").
    expect(read('src/main/audio/chain.ts')).toMatch(/return keep\s*\?\s*`asetnsamples=/)
    expect(panel).not.toMatch(/>\s*Peaks above −1 dBFS are limited when you export/)
  })

  it('README and USER_GUIDE carry the same condition: whatever is switched on is limited, nothing switched on keeps the file as it is', () => {
    for (const file of ['README.md', 'docs/USER_GUIDE.md']) {
      const text = flat(read(file))
      expect(text, `${file} says what the limiter does`).toMatch(/Whatever you switch on or cut out, peaks above −1 dBFS are limited when you export, so a boost cannot clip/)
      expect(text, `${file} says what it does not touch`).toMatch(/an export with nothing switched on and nothing cut keeps the file's levels as they are/)
    }
  })

  it('the README bullet is the Levels panel\'s own (item 5 of Audio Studio), not a stray sentence', () => {
    const bullet = /5\. \*\*Levels panel:\*\*[^\n]*/.exec(read('README.md'))?.[0] ?? ''
    expect(bullet).toMatch(/±12 dB manual gain\. Whatever you switch on or cut out, peaks above −1 dBFS are limited when you export/)
  })
})

describe('the layout guide says what tests/e2e/layout.ts measures, and what a select does (T-124 (23)-(25))', () => {
  const layout = read('tests/e2e/layout.ts')
  const design = flat(read('docs/DESIGN_GUIDE.md'))
  const testing = flat(read('docs/TESTING.md'))

  it('layout.ts exports the three measures round 74 added', () => {
    for (const name of ['expectSelectsWhole', 'expectNoOverlap', 'expectOneLine']) {
      expect(layout, `${name} is exported`).toMatch(new RegExp(`export async function ${name}\\(`))
      expect(design, `DESIGN_GUIDE names ${name}`).toContain(name)
      expect(testing, `TESTING names ${name}`).toContain(name)
    }
  })

  it('DESIGN_GUIDE no longer says a min-w-0 select is the fix: it says a select fails both ways and clips its text', () => {
    expect(design).not.toMatch(/A `flex-1` `<select>` or input is `min-w-0`, or it is as wide as its longest option/)
    expect(design).toMatch(/A `<select>` fails BOTH ways/)
    expect(design).toMatch(/CLIPS the selected option's text/)
  })

  it('the select-aware measure reads the selected option, not the control\'s scroll width', () => {
    expect(layout).toMatch(/select\.options\[select\.selectedIndex\]/)
    expect(layout).toMatch(/ctx\.measureText\(text\)\.width/)
  })
})

// T-133 (11): three documentation lines the nineteenth sweep found stale, held so the next change to the thing or the sentence is a failing test.
describe('three claims the guides make that the code can contradict (T-133 (11))', () => {
  it('STYLE_GUIDE\'s reportFailure signature lists every option the function takes', () => {
    const source = read('src/renderer/src/lib/reportFailure.ts')
    const options = /copy: \{ ([^}]*) \}/.exec(source)?.[1] ?? ''
    const names = options.split(';').map((o) => o.trim().replace(/\?.*$/, '').replace(/:.*$/, '')).filter(Boolean)
    expect(names, 'read the option names off the real signature').toEqual(['failed', 'canceled', 'id'])
    const guide = flat(read('docs/STYLE_GUIDE.md'))
    const signature = /`reportFailure\(err, \{ ([^}]*) \}\)`/.exec(guide)?.[1] ?? ''
    expect(signature.split(',').map((o) => o.trim().replace(/\?$/, ''))).toEqual(names)
  })

  it('USER_GUIDE does not promise "a few seconds" for a long recording\'s waveform (T-129 measured up to a few tens of seconds)', () => {
    const guide = flat(read('docs/USER_GUIDE.md'))
    expect(guide).not.toMatch(/A long recording takes a few seconds/)
    expect(guide).toMatch(/A long recording takes from a few seconds up to a few tens of seconds/)
  })

  it('the claim about which runners read the frame count names the runners, in the comment and in STYLE_GUIDE (the burn-in is one of them; a compilation\'s segments are not)', () => {
    const comment = flat(read('src/main/ffmpeg/noPicture.ts').replace(/^\s*\*\s?/gm, ''))
    expect(comment).not.toMatch(/Every runner that writes a video/)
    // T-134 (4): "Export, Reframe, a compilation's segments and the burn-in read both" was an over-claim - the segments read the stderr line alone.
    expect(comment, 'a compilation\'s segments are not among the readers of both facts').not.toMatch(/Export, Reframe, a compilation's segments/)
    expect(comment).toMatch(/Three runners that cut a video out of a RANGE of a source read both, through `wroteNoPicture` - Export, Reframe and \(T-133 \(4\)\) the caption burn-in/)
    expect(comment).toMatch(/A compilation's segments \(`concat\.ts`\) read the stderr line alone, which is sufficient THERE/)
    const guide = flat(read('docs/STYLE_GUIDE.md'))
    expect(guide).not.toMatch(/Every runner that writes a video closes on/)
    expect(guide).not.toMatch(/Export, Reframe, a compilation's segments, and, since T-133/)
    expect(guide).toMatch(/Three runners that cut a video out of a RANGE of a source \(Export, Reframe and, since T-133 \(4\), the caption burn-in/)
    expect(guide).toMatch(/A compilation's segments are the fourth cutter and read the stderr line alone \(`concat\.ts`, T-134 \(4\)\), which is sufficient there/)
  })

  it('the runners that close on wroteNoPicture are exactly the three the comment and STYLE_GUIDE name, and a compilation\'s segments read the stderr line alone (T-134 (4))', () => {
    // The scan: every non-test source under src/main that CALLS wroteNoPicture. A fourth caller (or one fewer) fails here until the two sentences above are re-read.
    const noPicture = path.join(ROOT, 'src', 'main', 'ffmpeg', 'noPicture.ts')
    const callers = sourceFilesUnder(path.join(ROOT, 'src', 'main'))
      .filter((file) => file !== noPicture && /\bwroteNoPicture\(/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
      .sort()
    expect(callers).toEqual(['src/main/ffmpeg/export.ts', 'src/main/ffmpeg/reframe.ts', 'src/main/sidecars/whisperManager.ts'])
    // The fourth writer of a ranged video reads the stderr line and nothing else; Layer 5 holds why that is enough (the 5 s picture / 9 s sound case).
    const concat = read('src/main/ffmpeg/concat.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(concat).toMatch(/wroteNothing \|\|= FFMPEG_EMPTY_OUTPUT\.test\(stderr\)/)
    expect(concat).not.toMatch(/wroteNoPicture|PictureFrames/)
  })
})

// T-134 (6): the native-dialog inventory in INTERACTION_COVERAGE.md is what /guide-sync checks, and it had drifted three ways: a row cited a confirm that
// moved to another file (Record's, T-133 (1)), several line numbers were off, and a confirm T-133 (6) added had no row. A table of file:line cites is a
// claim about the tree, so it is read against the tree: every native confirm / prompt / alert call in the renderer has a row at the line it is on, and
// every cite in the table points at a line that still holds one (or the question's asker / the dialog that replaced it).
describe('the native-dialog inventory lists every native dialog call in the renderer at the line it is on (T-134 (6))', () => {
  const NATIVE = new Set(['confirm', 'alert', 'prompt'])

  /** Every call of the NATIVE confirm / alert / prompt in a source, as 1-based lines. A name the file declares itself (NameDialog's `confirm()`) is not the native one. */
  function nativeDialogCalls(sf: ts.SourceFile): number[] {
    const declared = new Set<string>()
    const declare = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name) declared.add(n.name.text)
      ts.forEachChild(n, declare)
    }
    declare(sf)
    const lines: number[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        const bare = ts.isIdentifier(callee) && NATIVE.has(callee.text) && !declared.has(callee.text)
        const onWindow = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'window' && NATIVE.has(callee.name.text)
        if (bare || onWindow) lines.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1)
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
    return lines
  }

  const guide = read('docs/INTERACTION_COVERAGE.md')
  const section = guide.slice(guide.indexOf('## Native-dialog inventory'), guide.indexOf('## Headless-limited categories'))
  const files = sourceFilesUnder(RENDERER_ROOT)

  it('finds the calls and the table (a scan that matched nothing would look like a clean tree)', () => {
    const total = files.reduce((n, file) => n + nativeDialogCalls(parseSource(file)).length, 0)
    expect(total).toBeGreaterThanOrEqual(10)
    expect(section.length).toBeGreaterThan(500)
  })

  it('every call has a row that cites the file and the line it is on', () => {
    const missing: string[] = []
    for (const file of files) {
      const rel = path.relative(RENDERER_ROOT, file).split(path.sep).join('/')
      for (const line of nativeDialogCalls(parseSource(file))) {
        // The cite is the file's name (or its path from the renderer's lib / components folder) and the line: `VideoStudio.tsx:69`, `lib/liveTake.ts:34`.
        const base = rel.split('/').pop() as string
        const cite = new RegExp(`(?:^|[^\\w])(?:${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${base.replace('.', '\\.')}):${line}(?!\\d)`)
        if (!cite.test(section)) missing.push(`${rel}:${line}`)
      }
    }
    expect(missing, 'native dialog calls with no row at their line').toEqual([])
  })

  it('every file:line the table cites still holds a native dialog call, the live-take asker, or the NameDialog that replaced one', () => {
    const stale: string[] = []
    for (const m of section.matchAll(/(?:[A-Za-z]+\/)?([A-Za-z]+\.tsx?):(\d+)(?!\d)/g)) {
      const [, name, lineText] = m
      const hit = files.find((f) => f.endsWith(`/${name}`))
      if (!hit) {
        stale.push(`${name}:${lineText} (no such file in the renderer)`)
        continue
      }
      const text = (readFileSync(hit, 'utf8').split('\n')[Number(lineText) - 1] ?? '').trim()
      if (!/\b(?:confirm|alert|prompt)\(|<NameDialog|mayLeaveLiveTake/.test(text)) stale.push(`${name}:${lineText} is "${text.slice(0, 60)}"`)
    }
    expect(stale, 'cites that point at something else').toEqual([])
  })

  it('discriminates: a local function named confirm is not the native one; a window.confirm and a bare prompt are', () => {
    const calls = (code: string): number[] => nativeDialogCalls(parseSource('x.tsx', code))
    expect(calls('function confirm() {}\nconfirm()')).toEqual([])
    expect(calls('const a = 1\nif (window.confirm("x")) go()')).toEqual([2])
    expect(calls('prompt("name")\nalert("x")')).toEqual([1, 2])
    expect(calls('const ok = confirm(\n"x")')).toEqual([1])
  })
})

// T-138 (2), (3): the sizes and sentences USER_GUIDE quotes, held to the code that makes them.
describe('the stored copy of an imported picture and the over-limit sentences, as the guide says them (T-138 (2), (3))', () => {
  const guide = flat(read('docs/USER_GUIDE.md'))

  it('USER_GUIDE says the project keeps a copy up to twice the design\'s long side (1600 px at the least), and ImportPanel bounds it with exactly that', () => {
    expect(guide).toContain('keeps a copy of it up to twice the long side of your design')
    expect(guide).toContain('1600 px at the least')
    expect(guide, 'the fixed 1600 px is not the whole rule any more').not.toMatch(/copy of it up to 1600 px on the long side/)
    expect(read('src/shared/imageBounds.ts')).toMatch(/return Math\.max\(STORED_IMAGE_MAX_DIM, 2 \* Math\.max\(docWidth, docHeight\)\)/)
    expect(read('src/renderer/src/modules/image-studio/ImportPanel.tsx')).toMatch(/storedImageMaxDim\(docWidth, docHeight\)/)
    // The two examples the sentence gives are the templates' real sizes.
    const templates = read('src/renderer/src/modules/image-studio/templates.ts')
    expect(templates).toMatch(/id: 'tw-overlay-streamer',[\s\S]*?width: 1920,\s*height: 1080/)
    expect(templates).toMatch(/id: 'yt-thumb-bold',[\s\S]*?width: 1280,\s*height: 720/)
  })

  it('USER_GUIDE and the code both say what frees bytes (remove some, or import smaller copies) and neither says "shrink"', () => {
    const validation = read('src/shared/projectValidation.ts')
    expect(validation).toContain('Remove some of the large images on the canvas, or import smaller copies of them, then save again.')
    expect(validation).toContain('Remove some of the large images on the canvas, or import smaller copies of them, and it will start again.')
    expect(validation).not.toMatch(/shrink/i)
    expect(guide).toContain('to remove some of the large images or import smaller copies of them')
    expect(guide).not.toMatch(/remove or shrink/i)
  })
})

// T-138 (7), (8): two sentences that were false of the tree they sat in.
describe('the RunningCancel placement rule is true of the five it names, and the AutosaveRestore sentence is about AutosaveRestore (T-138 (7), (8))', () => {
  const design = flat(read('docs/DESIGN_GUIDE.md'))
  const placements = design.slice(design.indexOf('**The Cancel of a job that is running is one button'), design.indexOf('**A chip that shows a name the person chose is capped'))

  it('(7) the row under the primary is for a primary at the end of its row or a busy label that is a sentence - not "when the primary is wider than its busy label", which GIF, Picture-in-picture and the Clip Kit are not', () => {
    expect(placements.length, 'the paragraph was found').toBeGreaterThan(1000)
    expect(placements).not.toMatch(/when the primary is wider than its busy label/)
    expect(placements).toMatch(/when the primary is the right-most item of its row or its busy label is a sentence \(GIF, Compile, Picture-in-picture, the Export panel, the Clip Kit button\)/)
    expect(placements).toContain('Whether the busy label is narrower than the idle one is not the test')
    // And the order a new Cancel is decided in, so "the first placement that applies" can be decided.
    // T-139 (7): the order is the one that reproduces the guide's own list (the Clip Kit under the primary, Audio Studio's export beside it, the Export panel under it, the
    // progress rows on theirs) - the first draft sent each of those three to another placement; it is held to the code in the T-139 (7) block below.
    expect(placements).toMatch(/takes the first placement that applies, decided in this order: a progress row if the job has one of its own \(a row with no primary on it that exists only while the job runs and holds its bar; a bar that stays after the job as its result, like Audio Studio's export row or the Export panel's queue, one row per file, is not one\); else the caption row if there is no primary; else the row under the primary if its busy label is a sentence \(the Clip Kit button, whatever dialog it opened first\); else beside the primary if a native dialog is ALWAYS answered between the press and the job \(Audio Studio's export; a chooser that opens only when no folder is remembered yet, as in GIF, Compile, Picture-in-picture and the Export panel, is not that\); else the row under the primary/)
    // The kit's label really is the wider when it runs, and a sentence: the two facts the guide quotes.
    const kit = read('src/renderer/src/modules/video-studio/ClipKitButton.tsx')
    expect(kit).toMatch(/whitespace-nowrap/)
    expect(kit).toMatch(/Clip Kit \(\$\{KIT_PLATFORM_IDS\.length\} \+ thumbs\)/)
    expect(read('src/renderer/src/modules/video-studio/clipKit.ts')).toMatch(/Exporting platform version \$\{/)
  })

  it('(8) the busy-flag sentence names AutosaveRestore and sits with its text, not after the "-> Canvas" sentence about MoodBoardPanel', () => {
    const style = flat(read('docs/STYLE_GUIDE.md'))
    expect(style, 'the sentence that described the wrong component').not.toContain('Its two buttons have a busy flag each')
    const restore = style.indexOf('**The autosave Restore is the case a click-time premise hid (T-134 (1)):**')
    const sentence = style.indexOf("**`AutosaveRestore`'s two buttons have a busy flag each, and Restore's is a run (T-134 (7), T-138 (5)):**")
    const canvas = style.indexOf('**"→ Canvas" was the same premise on References (T-135 (13)):**')
    expect(restore, 'found the AutosaveRestore text').toBeGreaterThan(-1)
    expect(sentence, 'found the sentence').toBeGreaterThan(restore)
    expect(canvas, 'and the "-> Canvas" sentence follows it').toBeGreaterThan(sentence)
    // What it says is what the banner does.
    const banner = read('src/renderer/src/components/AutosaveRestore.tsx')
    expect(banner).toMatch(/const restoring = useRestoreRun\(\(s\) => s\.run !== null\)/)
    expect(banner).toMatch(/const \[clearing, setClearing\] = useState\(false\)/)
  })
})


// T-138 (6): USER_GUIDE and README named two of the picker's three loudness targets ("pick Talking and podcasts (-16) or YouTube, TikTok, Reels (-14)"); the third,
// "Broadcast TV and radio (-23)", had shipped since 2ff0eb1 with no sentence anywhere that said it exists. The list is the picker's own (`LUFS_PRESETS`), so a fourth
// target added there fails here until the guides name it.
describe('the guides name every loudness target the Levels picker offers (T-138 (6))', () => {
  const { LUFS_PRESETS } = lufsPanel

  it('the picker has more than one target, and each has a label that carries its number', () => {
    expect(LUFS_PRESETS.length).toBeGreaterThanOrEqual(3)
    for (const preset of LUFS_PRESETS) expect(preset.label, preset.value).toContain(`−${Math.abs(preset.target)}`)
  })

  it('USER_GUIDE\'s Levels bullet names every target by the label the picker shows', () => {
    const guide = read('docs/USER_GUIDE.md')
    const start = guide.indexOf('- **Levels**')
    expect(start, 'the Levels bullet is in the guide').toBeGreaterThan(-1)
    const rest = guide.slice(start + 1)
    const end = rest.search(/\n {2}- \*\*|\n\S/)
    const bullet = flat(rest.slice(0, end === -1 ? undefined : end))
    expect(bullet, 'the extract is the Levels bullet').toContain('**Even volume**')
    const missing = LUFS_PRESETS.filter((p) => !bullet.includes(p.label)).map((p) => p.label)
    expect(missing, 'targets the Levels bullet does not name').toEqual([])
  })

  it('README\'s Audio Studio Levels line names every target\'s number', () => {
    const line = read('README.md').split('\n').find((l) => l.includes('**Levels panel:**')) ?? ''
    expect(line, 'the line is in the README').toContain('loudness target')
    const missing = LUFS_PRESETS.filter((p) => !line.includes(`−${Math.abs(p.target)}`)).map((p) => p.label)
    expect(missing, 'targets the README line does not name').toEqual([])
  })
})

// T-139 Track B: the guides' sentences about this round's changes, held to the code they describe.
describe('T-139 Track B - the guides say what the code does', () => {
  const strip = (text: string): string => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const src = (rel: string): string => strip(read(`src/renderer/src/modules/${rel}`))

  it('(2) USER_GUIDE says a picture is placed inside the canvas, and placementFor is what a file and "-> Canvas" are placed with', () => {
    const guide = flat(read('docs/USER_GUIDE.md'))
    expect(guide).toContain('A picture you import is placed at most 800 px on its long side, and always inside the canvas')
    expect(guide).toContain('a small canvas such as the 112×112 emote makes it smaller to fit')
    expect(guide, 'the 800 px / twice-the-design sentences it sits beside are still there').toContain('keeps a copy of it up to twice the long side of your design')
    expect(strip(read('src/shared/imageBounds.ts'))).toMatch(/const fit = Math\.min\(scale, docWidth \/ picWidth, docHeight \/ picHeight\)/)
    expect(src('image-studio/ImportPanel.tsx')).toMatch(/makeImageLayer\(stored, place\.width, place\.height, place\.x, place\.y\)/)
    expect(src('references/MoodBoardPanel.tsx')).toMatch(/makeReferenceLayer\(boundedDataUrl\(img, LAYER_DRAWN_MAX_DIM, true\), place\.width, place\.height, title, place\.x, place\.y\)/)
  })

  it('(4) USER_GUIDE names the byte budget, and the budget the spec asserts is the one the code has', () => {
    const guide = flat(read('docs/USER_GUIDE.md'))
    expect(guide).toContain('about 16 MB')
    expect(strip(read('src/shared/imageBounds.ts'))).toMatch(/export const STORED_IMAGE_MAX_BYTES = 16 \* 1024 \* 1024\n/)
    expect(read('tests/e2e/image.spec.ts'), 'the spec cannot import it (it must load on the build it is proven red against)').toMatch(/const STORED_IMAGE_MAX_BYTES = 16 \* 1024 \* 1024\n/)
  })

  it('(7) the decision order classifies each panel the guide lists the way the code draws it', () => {
    // 1. A progress row of the job's own: shown only while it runs, with its bar and its Cancel together, and no primary on it.
    expect(src('video-studio/ReframePanel.tsx')).toMatch(/\{running \? \(\s*<div className="flex items-center gap-2 text-xs text-ink-muted">[\s\S]{0,600}?<ProgressTrack[\s\S]{0,400}?<RunningCancel title="Cancel reframe"/)
    expect(src('video-studio/HighlightPanel.tsx')).toMatch(/\{scanning \? \(\s*<div className="flex items-center gap-2 text-xs text-ink-muted">\s*<ProgressTrack[\s\S]{0,400}?<RunningCancel title="Cancel scan"/)
    const captions = src('video-studio/CaptionsPanel.tsx')
    expect(captions).toMatch(/\{progress \? \(\s*<div className="flex items-center gap-2 text-xs text-ink-muted">[\s\S]{0,600}?<ProgressTrack[\s\S]{0,1200}?<RunningCancel title="Cancel burn-in"/)
    expect(captions).toMatch(/\{installing && installProgress \? \(\s*<div className="flex items-center gap-2 text-xs">\s*<ProgressTrack[\s\S]{0,400}?<RunningCancel title="Cancel download"/)
    // ...and the two bars that are NOT one: Audio Studio's export row stays after the job (it is drawn for `job`, not for `running`) and holds no Cancel; the Export panel's
    // rows are one per file, drawn from `jobs`, and its Cancel is not among them.
    const audio = src('audio-studio/ExportDialog.tsx')
    expect(audio).toMatch(/\{job \? \(\s*<div className="flex items-center gap-3 text-sm">[\s\S]{0,400}?<ProgressTrack/)
    const audioRow = audio.slice(audio.indexOf('{job ? (\n        <div className="flex items-center gap-3 text-sm">'))
    expect(audioRow.slice(0, audioRow.indexOf('<RunningCancel') < 0 ? audioRow.length : audioRow.indexOf('<RunningCancel'))).toContain('<ProgressTrack')
    expect(audio.match(/<RunningCancel/g) ?? []).toHaveLength(1)
    const exportPanel = src('video-studio/ExportPanel.tsx')
    expect(exportPanel).toMatch(/\{jobs\.map\(\(j\) => \([\s\S]{0,1800}?<ProgressTrack/)
    expect(exportPanel.slice(exportPanel.indexOf('{jobs.map((j) => ('))).not.toContain('<RunningCancel')

    // 2. The caption row: no primary (the closed-video card).
    expect(src('video-studio/ClipKitButton.tsx')).toMatch(/<span className="min-w-0 flex-1 truncate"[^>]*>\s*\{kitRunCaption\(kitRun\.clipName\)\}\s*<\/span>\s*<RunningCancel title="Cancel Clip Kit"/)

    // 3. A busy label that is a sentence: the Clip Kit's is the run's phase ("Exporting platform version 2 of 5…"), kept on one line - and its chooser is asked on EVERY press, which the
    //    order puts after this test, so the kit is not sent beside the primary.
    const kit = src('video-studio/ClipKitButton.tsx')
    expect(kit).toMatch(/\{kitRun !== null \? kitRun\.phase \|\| 'Working…' : `Clip Kit/)
    expect(kit).toMatch(/const parentDir = await window\.api\.video\.pickOutputDir\(\s*typeof lastDir === 'string'/)
    expect(kit.slice(kit.indexOf('async function runKit()'), kit.indexOf('const parentDir')), 'asked unconditionally').not.toMatch(/\bif \(!?(dir|parentDir|lastDir)\b/)
    expect(read('src/renderer/src/modules/video-studio/clipKit.ts')).toMatch(/Exporting platform version \$\{/)

    // 4. A dialog ALWAYS answered between the press and the job: Audio Studio's export asks for the file on every press; the Cancel follows the primary on its row.
    expect(audio).toMatch(/outputPath = await window\.api\.audio\.pickOutputFile\(\{ defaultName, format: saveFormat \}\)/)
    expect(audio.slice(audio.indexOf('async function startExport()'), audio.indexOf('pickOutputFile'))).not.toMatch(/\bif \(!?outDir\b/)
    expect(audio).toMatch(/onClick=\{startExport\}\s*>\s*\{running \? 'Exporting…' : 'Export'\}\s*<\/button>\s*\{running && job \? \(\s*<RunningCancel title="Cancel export"/)
    //    ...and the panels that only ask when no folder is chosen or remembered are NOT that: they take the folder from `resolveOutputDir`, which asks last; the Export panel asks only `if (!dir)`.
    const outputDir = strip(read('src/renderer/src/hooks/useVideoOutputDir.ts'))
    expect(outputDir).toMatch(/const chosen = useOutputDirStore\.getState\(\)\.dir\s*if \(chosen\) return chosen\s*const dir = \(await readRemembered\(\)\) \?\? \(await window\.api\.video\.pickOutputDir\(\)\)/)
    for (const f of ['GifPanel', 'CompilationPanel', 'PipPanel']) expect(src(`video-studio/${f}.tsx`), f).toMatch(/const dir = await resolveOutDir\(\)/)
    expect(exportPanel).toMatch(/let dir = outDir\s*if \(!dir\) \{\s*dir = await window\.api\.video\.pickOutputDir\(\)/)

    // 5. The row under the primary: a wrapper that is its own row, in the three panels with no bar of their own and in the Export panel, with the Cancel after the primary's row.
    for (const [f, title] of [['GifPanel', 'Cancel GIF export'], ['CompilationPanel', 'Cancel compilation'], ['PipPanel', 'Cancel picture-in-picture composite']] as const) {
      const code = src(`video-studio/${f}.tsx`)
      expect(code, f).toMatch(new RegExp(`\\{busy \\? \\(\\s*<div className="flex justify-end">\\s*<RunningCancel title="${title}"`))
      expect(code, `${f} has no bar of its own`).not.toContain('<ProgressTrack')
    }
    expect(exportPanel).toMatch(/\{running \? \(\s*<div className="flex justify-end">\s*<RunningCancel\s+title="Cancel export"/)
  })

  it('(8) the busy-label widths the guide quotes are the re-measured ones, and the old figures are nowhere', () => {
    const design = flat(read('docs/DESIGN_GUIDE.md'))
    expect(design).toContain('GIF 102 px idle and 109 busy, Picture-in-picture 86 and 108')
    expect(design).toContain('measured in the built app with Inter loaded')
    expect(design).not.toMatch(/GIF 112 px idle/)
    const lessons = flat(read('docs/LESSONS_LEARNED.md'))
    expect(lessons, 'the entry that repeated them as "re-measured" carries the corrected pair').toContain('GIF 102 px idle and 109 busy, Picture-in-picture 86 and 108')
    expect(lessons).not.toContain('GIF 112 px idle')
  })
})

// T-139 Track C: the README's whisper and Stream Graphics sentences, and the Home inventory's cites, held to the code they name.
// Each Home cite is checked two ways: the inventory row must carry it, and the cited line(s) must hold the element the row names.
describe('T-139 Track C: README and the Home inventory say what the code does', () => {
  const readme = flat(read('README.md'))
  const inventory = read('docs/INTERACTION_COVERAGE.md')
  const homeRows = inventory.slice(inventory.indexOf('### Home (15)'), inventory.indexOf('### Record (17'))
  const welcomeRows = inventory.slice(inventory.indexOf('### Welcome (1)'), inventory.indexOf('### Home (15)'))
  const home = 'src/renderer/src/routes/Home.tsx'
  const autosave = 'src/renderer/src/components/AutosaveRestore.tsx'
  const welcome = 'src/renderer/src/routes/Welcome.tsx'
  /** The lines `from` to `to` (1-based, both included) of a source, joined with newlines. */
  const lines = (rel: string, from: number, to: number = from): string => read(rel).split('\n').slice(from - 1, to).join('\n')

  it('(1)-(3) the README names the whisper.cpp zip and its ggml-org home, and drops the ggerganov link and the full-size sentence', () => {
    expect(readme).toContain('whisper-bin-x64.zip')
    expect(readme).toContain('github.com/ggml-org/whisper.cpp')
    expect(readme).not.toContain('ggerganov')
    expect(readme).not.toContain('the original stays at full size')
  })

  it('(1)-(3) the README says what the captions panel asks now, and what the image copy is', () => {
    expect(readme).toContain('copy `whisper-cli.exe` and the `.dll` files from its `Release` folder into the folder the panel opens')
    expect(readme).toContain('copy `whisper-cli.exe` and the `.dll` files that come with it (from the `Release` folder in `whisper-bin-x64.zip`) into the folder the panel\'s open-folder button opens (the older name, `whisper.exe`, also works)')
    expect(readme).toContain('the document keeps a copy of it bounded to twice the long side of your design (1600 px at the least) and to about 16 MB, so a huge picture is not kept at full size')
    expect(readme).toContain('Captions are English only.')
    expect(readme).toContain('Then click "Refresh status".')
  })

  // The Home table's rows, the cite each must carry, and the lines that cite names: `[the row's label, the cite, the file, the first line, the last line,
  // what those lines hold]`. A row is found by its label, so a stale cite that is another row's cite (Open project was Home.tsx:90, Redo's line) still fails.
  const rowOf = (label: string): string => homeRows.split('\n').find((l) => l.startsWith(`| ${label}`)) ?? ''
  const CITES: ReadonlyArray<readonly [string, string, string, number, number, readonly string[]]> = [
    ['Undo button', 'Home.tsx:82', home, 82, 82, ['onClick={undo.undo}']],
    ['Redo button', 'Home.tsx:90', home, 90, 90, ['onClick={undo.redo}']],
    ['"last:" readout', 'Home.tsx:97', home, 97, 97, ['last:']],
    ['Open project', 'Home.tsx:101', home, 101, 101, ['onClick={handleLoad}']],
    ['Save project', 'Home.tsx:107', home, 107, 107, ['onClick={handleSave}']],
    ['NavCard x5', 'Home.tsx:117-151', home, 117, 151, ['<NavCard']],
    ['AutosaveRestore: Restore / Clear / Later', 'AutosaveRestore.tsx:251-271', autosave, 251, 271, ['onClick={() => void restore()}', 'onClick={() => void clearAutosave()}', 'onClick={() => setDismissed(true)}', 'Later']],
    // The row writes this cite in its shorthand (`:225-238`, the same file as the cite before it). T-140 (6) re-pointed both cites (+9 lines above them: the banner's listener and the backstop's sentence), not loosened.
    ['AutosaveRestore: Restore / Clear / Later', ':225-238', autosave, 225, 238, ['onClick={() => void clearAutosave()}', 'onClick={() => setDismissed(true)}', 'Dismiss']]
  ]

  it('the Home table was found, with its rows (a scan that matched nothing would look like a clean table)', () => {
    expect(homeRows.length).toBeGreaterThan(500)
    expect(homeRows).toContain('Undo button')
  })

  it.each(CITES)('the "%s" row cites %s, and those lines hold the element it names', (label, cite, file, from, to, anchors) => {
    const row = rowOf(label)
    expect(row, `no Home row is labelled "${label}"`).not.toBe('')
    expect(row, `the "${label}" row does not cite ${cite}`).toContain(cite)
    const text = lines(file, from, to)
    for (const anchor of anchors) expect(text, `${file}:${from}-${to} does not hold ${anchor}`).toContain(anchor)
  })

  it('the Home.tsx:117-151 range holds the five NavCards, and its last line closes the fifth', () => {
    expect(lines(home, 117, 151).match(/<NavCard\b/g)).toHaveLength(5)
    expect(lines(home, 151)).toMatch(/^\s*\/>$/)
  })

  it('the Welcome row cites the button where it stands, and no longer says no test clicks it', () => {
    expect(welcomeRows).toContain('Welcome.tsx:44')
    expect(lines(welcome, 44)).toContain('<button')
    expect(lines(welcome, 44, 49)).toContain('Let&apos;s go')
    expect(welcomeRows).not.toContain('never directly clicked in any test')
    expect(welcomeRows).toContain('home-chrome.spec.ts')
    expect(welcomeRows).toContain('T-139 (9)')
    expect(read('tests/e2e/home-chrome.spec.ts')).toContain('getByRole(\'button\', { name: "Let\'s go" }).click()')
  })

  it('the Welcome row\'s Chain says what the handler does: persistSetting (App.tsx:84), then swallowRepeatClicks() (App.tsx:88), and both cited lines hold them', () => {
    const welcomeRow = welcomeRows.split('\n').find((l) => l.startsWith('| Button "Let\'s go"')) ?? ''
    expect(welcomeRow, 'the Let\'s go row was found').not.toBe('')
    // The row is `| element | file:line | chain | end state | flags |`, so the Chain cell is the fourth split part.
    const chain = welcomeRow.split('|')[3] ?? ''
    expect(chain, 'the Chain cell names the persisted write').toContain('persistSetting(\'welcomeSeen\', true)')
    expect(chain).toContain('App.tsx:84')
    expect(chain).toContain('swallowRepeatClicks()')
    expect(chain).toContain('App.tsx:88')
    expect(chain, 'the Chain cell no longer names the bare settings.set').not.toContain('settings.set(\'welcomeSeen\')')
    const app = 'src/renderer/src/App.tsx'
    expect(lines(app, 84), 'App.tsx:84 is the persisted write').toContain('persistSetting(\'welcomeSeen\', true)')
    expect(lines(app, 88), 'App.tsx:88 is the double-press swallow').toContain('swallowRepeatClicks()')
  })
})

// T-140 Track C: the guides' sentences about this round's changes, and the two documents that said what is no longer true, held to the code and the specs they describe.
describe('T-140 Track C - the guides say what the code does', () => {
  const strip = (text: string): string => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('(6) the ledger and the Home spec no longer say that no way in the UI puts work behind a banner that did not hear Home', () => {
    const inventory = flat(read('docs/INTERACTION_COVERAGE.md'))
    expect(inventory, 'the T-139 (5) row said the backstop was unreachable').not.toContain('no way in the UI puts work into the session behind a banner that did not hear Home')
    expect(inventory).toContain('T-140 (6)')
    const spec = flat(read('tests/e2e/home-chrome.spec.ts'))
    expect(spec, 'the spec comment said the same').not.toContain('interactionWiring.test.ts: no way in the UI puts work into the session behind a banner that did not hear Home).')
    // and what it says now is true: a spec case drives a landing on Home, and the banner listens for one
    expect(spec).toContain('T-140 (6): the autosave banner goes when work lands on Home')
    expect(strip(read('src/renderer/src/components/AutosaveRestore.tsx'))).toMatch(/withdrawWhenSessionGainsWork\(\)/)
  })

  it('(10) USER_GUIDE quotes the failure sentence the code says, and names the control it sends the person to', () => {
    const guide = flat(read('docs/USER_GUIDE.md'))
    const errors = strip(read('src/shared/userFacingError.ts'))
    expect(errors).toContain("'The captions engine stopped before it finished. ' +")
    expect(errors).toContain("'Open Captions setup to check its files and the model, then try again.'")
    expect(guide).toContain('"The captions engine stopped before it finished. Open Captions setup to check its files and the model"')
    expect(guide).toContain('**Captions setup** stays under the panel, closed until you open it')
    const panel = strip(read('src/renderer/src/modules/video-studio/CaptionsPanel.tsx'))
    expect(panel).toMatch(/aria-expanded=\{showReadySetup\}[\s\S]{0,200}Captions setup/)
    expect(guide).toContain('the `.dll` files from the zip are not next to `whisper-cli.exe`')
  })

  it('STYLE_GUIDE: the closing section is the last, the "Round 88 additions" block is gone and its four rules sit inside the guide, wording unchanged', () => {
    const style = read('docs/STYLE_GUIDE.md')
    const headings = style.split('\n').filter((l) => l.startsWith('## '))
    expect(headings.at(-1), 'the closing section closes the guide').toBe('## When this guide changes')
    expect(style).not.toContain('Round 88 additions')
    const end = style.indexOf('## Power of Ten')
    expect(end).toBeGreaterThan(0)
    for (const start of [
      '- **A first placement is sized to where it lands (T-139 (2)).** `placementFor(picW, picH, docW, docH)`',
      '- **A stored copy has a byte budget (T-139 (4)).** `storedImageMaxDim` bounds a copy\'s pixels;',
      '- **The autosave offer is withdrawn by a project opened from Home (T-139 (5)).** `AutosaveRestore` reads `sessionHoldsWork()` once per mount',
      '- **A button that makes a record ignores the repeat of its double-click, claims before it writes, and is off while the write is out (T-139 (9)).**'
    ]) {
      const at = style.indexOf(start)
      expect(at, start.slice(0, 60)).toBeGreaterThan(0)
      expect(at, `${start.slice(0, 60)} is inside the conventions, before the Power of Ten`).toBeLessThan(end)
      expect(style.indexOf(start, at + 1), 'once').toBe(-1)
    }
    // the T-140 revisions follow the bullets they revise
    expect(style.indexOf('- **The offer is withdrawn when work lands, too (T-140 (6);')).toBeGreaterThan(style.indexOf('- **The autosave offer is withdrawn by a project opened from Home (T-139 (5)).**'))
    expect(style.indexOf('- **The button the keyboard just pressed stays focusable while it works, and a held Enter is one save (T-140 (7), (8);')).toBeGreaterThan(
      style.indexOf('- **A button that makes a record ignores the repeat of its double-click')
    )
  })

  it('STYLE_GUIDE qualifies the 256-sample agreement as the cuts\' only, as audio/chain.ts does (T-110 (bl))', () => {
    const style = flat(read('docs/STYLE_GUIDE.md'))
    const at = style.indexOf('At each cut picture and sound agree to within one 256-sample block of sound')
    expect(at).toBeGreaterThan(0)
    const sentence = style.slice(at, at + 900)
    expect(sentence).toContain("That agreement is the CUTS' only: it holds for a chain without `afftdn` or the export limiter.")
    expect(sentence).toContain('`afftdn` delays the sound by two hops (about 25 ms at any rate) and `alimiter` (latency off) by 5 ms')
    const chain = flat(read('src/main/audio/chain.ts').replace(/^\s*\* ?/gm, ''))
    expect(chain).toContain("That agreement is the CUTS' only: it holds for a chain without `afftdn` or the export limiter.")
    expect(chain).toContain('`afftdn` delays the sound by two hops (about 25 ms at any rate) and `alimiter` (latency off) by 5 ms')
  })
})
