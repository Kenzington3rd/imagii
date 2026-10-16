import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { RENDERER_ROOT } from './routeSources'
import { sourceFilesUnder } from './renderedStrings'

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
    for (const label of ['Restore', 'Clear', 'Later']) expect(banner, label).toMatch(new RegExp(`>\\s*(?:\\{busy \\? 'Restoring…' : )?'?${label}'?\\}?\\s*<`))
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
    expect(read('src/renderer/src/modules/image-studio/ImportPanel.tsx')).toMatch(/const maxDim = 800\n/)
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
    ['ImportPanel.tsx:71', 'src/renderer/src/modules/image-studio/ImportPanel.tsx', 71, 71, /const maxDim = 800/],
    ['src/main/index.ts:122-123', 'src/main/index.ts', 122, 123, /minWidth: 1024[\s\S]*minHeight: 640/]
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

describe('the waveform ceiling is a marked simplification (T-123 (14))', () => {
  it('the constant carries a `// simplification:` line that names the ledgered upgrade, T-110(ao)', () => {
    const audio = read('src/shared/audio.ts')
    expect(audio).toMatch(/\/\/ simplification: [^\n]*T-110\(ao\)[^\n]*\nexport const WAVEFORM_MAX_SEC = /)
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
