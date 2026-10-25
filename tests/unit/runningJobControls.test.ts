import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-136 (7) - a running job's Cancel and its progress track are one component each.
 *
 * Eleven places hand-wrote the Cancel of a job that is running (GIF, Compile, Picture-in-picture, Reframe, the highlight scan, both Captions jobs and
 * the model download, the Export batch, the audio export, the Clip Kit) and two had drifted off the pattern: the audio export's was not a `btn-ghost`,
 * had no danger ink and no title, and the Clip Kit's was a hand-rolled bordered box; the model download's was a bare cross. Six panels drew the same
 * progress track by hand. `components/RunningCancel.tsx` and `components/ProgressTrack.tsx` are the markup now (STYLE_GUIDE, "Shared affordances"), and
 * this scan is what keeps the next panel from writing a twelfth copy: a `<button>` that reads as a Cancel, outside a dialog, fails with its file and
 * line, and so does a `role="progressbar"` outside the track.
 *
 * What is NOT a running-job Cancel: a dialog's answer ("Cancel" in a `<Modal>`, `NameDialog`, `SafeZoneWarningModal`), which is a question's
 * reply, not a job's stop. The scan skips a button with a `<Modal>` above it.
 */
const RENDERER_ROOT = path.resolve(__dirname, '../../src/renderer/src')

/** The one file allowed to hold the markup. */
const CANCEL_HOME = 'components/RunningCancel.tsx'
const TRACK_HOME = 'components/ProgressTrack.tsx'

/**
 * Files with a `role="progressbar"` that is deliberately not the shared track, each with its reason. A new entry is a decision, made here and in
 * review: the track's fill is a measurement drawn in a bar, and these two are something else.
 */
const OTHER_PROGRESSBARS: Readonly<Record<string, string>> = {
  'modules/audio-studio/WaveformView.tsx': 'a text box ("Drawing the waveform... N%") that the waveform will fill, not a track',
  'modules/record-studio/RecordStudio.tsx': 'the recording convert\'s bar: a fixed 16 rem width with a 2% floor so a started convert is visible (T-136 left Record alone; upgrade: a `floor` prop)'
}

interface Finding {
  where: string
  why: string
}

function attrText(attrs: ts.JsxAttributes, name: string, sf: ts.SourceFile): string | null {
  const attr = attrs.properties.filter(ts.isJsxAttribute).find((a) => a.name.getText(sf) === name)
  if (!attr?.initializer) return null
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
    const e = attr.initializer.expression
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
    return e.getText(sf)
  }
  return null
}

/** Every `<button>` in `code` that reads as a running job's Cancel, outside a dialog: its label is "Cancel", or its title / aria-label starts with it. */
function handWrittenCancels(code: string, file: string): Finding[] {
  const sf = parseSource(file, code)
  const found: Finding[] = []
  const dialogTags = new Set(['Modal', 'NameDialog'])
  function visit(node: ts.Node, inDialog: boolean): void {
    let nowInDialog = inDialog
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null
    if (opening && dialogTags.has(opening.tagName.getText(sf))) nowInDialog = true
    if (opening && !nowInDialog && opening.tagName.getText(sf) === 'button') {
      const label = ts.isJsxElement(node)
        ? node.children
            .filter(ts.isJsxText)
            .map((t) => t.text.replace(/\s+/g, ' ').trim())
            .join(' ')
            .trim()
        : ''
      const title = attrText(opening.attributes, 'title', sf) ?? ''
      const aria = attrText(opening.attributes, 'aria-label', sf) ?? ''
      const className = attrText(opening.attributes, 'className', sf) ?? ''
      const where = `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
      if (label === 'Cancel') found.push({ where, why: 'a button labeled Cancel' })
      else if (/^Cancel\b/.test(title) || /^Cancel\b/.test(aria)) found.push({ where, why: `a button titled "${title || aria}"` })
      // The class string every hand-written copy shared (a Delete button has the same ink at another size, and is not a Cancel).
      else if (/px-2 py-1\.5 text-xs/.test(className) && /text-danger/.test(className)) found.push({ where, why: 'the danger-ink Cancel class combination' })
    }
    ts.forEachChild(node, (child) => visit(child, nowInDialog))
  }
  visit(sf, false)
  return found
}

/** Every element carrying `role="progressbar"`. */
function progressbars(code: string, file: string): Finding[] {
  const sf = parseSource(file, code)
  const found: Finding[] = []
  function visit(node: ts.Node): void {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && attrText(node.attributes, 'role', sf) === 'progressbar') {
      found.push({ where: `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`, why: 'a hand-written progressbar' })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const FILES = sourceFilesUnder(RENDERER_ROOT)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .map((f) => ({ rel: path.relative(RENDERER_ROOT, f).split(path.sep).join('/'), text: readFileSync(f, 'utf8') }))

describe('a running job\'s Cancel is RunningCancel, everywhere (T-136 (7))', () => {
  it('finds the files to scan (a scan that matched nothing would look like a clean tree)', () => {
    expect(FILES.length).toBeGreaterThan(60)
    expect(FILES.some((f) => f.rel === CANCEL_HOME)).toBe(true)
  })

  it('no hand-written running-job Cancel exists outside the component', () => {
    const found = FILES.filter((f) => f.rel !== CANCEL_HOME).flatMap((f) => handWrittenCancels(f.text, f.rel))
    expect(found.map((x) => `${x.where} (${x.why})`)).toEqual([])
  })

  it('the component IS the markup the scan looks for (so the scan is aimed at the right thing)', () => {
    const home = FILES.find((f) => f.rel === CANCEL_HOME)
    expect(home && handWrittenCancels(home.text, CANCEL_HOME).length).toBeGreaterThan(0)
  })

  it('discriminates: a bare Cancel, a titled cross, and the old class combination are caught; a dialog\'s answer and the component are not', () => {
    const caught = (code: string): string[] => handWrittenCancels(code, 'x.tsx').map((f) => f.why)
    expect(caught('const a = <button onClick={go}>Cancel</button>')).toEqual(['a button labeled Cancel'])
    expect(caught('const a = <button onClick={go} title="Cancel download" aria-label="Cancel download">✕</button>')).toEqual(['a button titled "Cancel download"'])
    expect(caught('const a = <button aria-label="Cancel scan" onClick={go}>x</button>')).toEqual(['a button titled "Cancel scan"'])
    expect(caught('const a = <button className="btn-ghost px-2 py-1.5 text-xs text-danger hover:text-danger-soft" onClick={go}>Stop</button>')).toEqual(['the danger-ink Cancel class combination'])
    expect(caught('const a = <button className="btn-ghost px-3 py-1 text-danger hover:text-danger-soft" onClick={go}>Delete</button>'), 'a Delete is not a Cancel').toEqual([])
    // The shared component is what a site writes instead.
    expect(caught('const a = <RunningCancel title="Cancel scan" onClick={go} />')).toEqual([])
    // A dialog's Cancel is an answer: skipped when a Modal (or NameDialog) is above it, caught when it is not.
    expect(caught('const a = <Modal open onClose={x}><button className="btn-ghost" onClick={x}>Cancel</button></Modal>')).toEqual([])
    expect(caught('const a = <NameDialog><div><button onClick={x}>Cancel</button></div></NameDialog>')).toEqual([])
    expect(caught('const a = <div><button onClick={x}>Cancel</button></div>')).toEqual(['a button labeled Cancel'])
    // Other buttons are not judged.
    expect(caught('const a = <button onClick={go}>Cancel jobs</button>')).toEqual([])
    expect(caught('const a = <button onClick={go} title="Pause">x</button>')).toEqual([])
  })

  it('every site passes the title of the job it stops', () => {
    // file -> the titles its RunningCancel calls carry (the job each one stops). "Cancel picture-in-picture composite" is T-136 (8): the panel's
    // heading and its toast say "Picture-in-picture"; the only "PiP" a person read was this title.
    const SITES: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['modules/video-studio/GifPanel.tsx', ['Cancel GIF export']],
      ['modules/video-studio/CompilationPanel.tsx', ['Cancel compilation']],
      ['modules/video-studio/PipPanel.tsx', ['Cancel picture-in-picture composite']],
      ['modules/video-studio/ReframePanel.tsx', ['Cancel reframe']],
      ['modules/video-studio/HighlightPanel.tsx', ['Cancel scan']],
      ['modules/video-studio/CaptionsPanel.tsx', ['Cancel burn-in', 'Cancel transcription', 'Cancel download']],
      ['modules/video-studio/ExportPanel.tsx', ['Cancel export']],
      ['modules/audio-studio/ExportDialog.tsx', ['Cancel export']],
      ['modules/video-studio/ClipKitButton.tsx', ['Cancel Clip Kit']]
    ]
    for (const [rel, titles] of SITES) {
      const text = FILES.find((f) => f.rel === rel)?.text ?? ''
      const used = [...text.matchAll(/<RunningCancel\s+title="([^"]+)"/g)].map((m) => m[1])
      expect(used.sort(), rel).toEqual([...titles].sort())
    }
  })

  it('the only user-facing "PiP" is gone (the heading and the toast say Picture-in-picture)', () => {
    const pip = FILES.find((f) => f.rel === 'modules/video-studio/PipPanel.tsx')?.text ?? ''
    expect(pip).not.toMatch(/title="[^"]*PiP/)
    expect(pip).toMatch(/<RunningCancel title="Cancel picture-in-picture composite"/)
  })
})

describe('a job\'s progress bar is ProgressTrack, except where it is a different thing (T-136 (7))', () => {
  it('no hand-written progressbar exists outside the track and the decided exceptions', () => {
    const found = FILES.filter((f) => f.rel !== TRACK_HOME && !(f.rel in OTHER_PROGRESSBARS)).flatMap((f) => progressbars(f.text, f.rel))
    expect(found.map((x) => x.where)).toEqual([])
  })

  it('every exception still holds a progressbar (a stale entry would excuse a future copy)', () => {
    for (const rel of Object.keys(OTHER_PROGRESSBARS)) {
      const text = FILES.find((f) => f.rel === rel)?.text ?? ''
      expect(progressbars(text, rel).length, `${rel}: ${OTHER_PROGRESSBARS[rel]}`).toBeGreaterThan(0)
    }
  })

  it('the six panels that drew the track by hand use it', () => {
    for (const rel of [
      'modules/video-studio/HighlightPanel.tsx',
      'modules/video-studio/ReframePanel.tsx',
      'modules/video-studio/CaptionsPanel.tsx',
      'modules/video-studio/ExportPanel.tsx',
      'modules/audio-studio/ExportDialog.tsx'
    ]) {
      expect(FILES.find((f) => f.rel === rel)?.text, rel).toMatch(/<ProgressTrack\b/)
    }
  })

  it('discriminates: a progressbar div is caught, the component\'s own use is not a progressbar attribute', () => {
    expect(progressbars('const a = <div role="progressbar" aria-valuenow={3} />', 'x.tsx')).toHaveLength(1)
    expect(progressbars('const a = <div className="h-1.5" role={"progressbar"}>x</div>', 'x.tsx')).toHaveLength(1)
    expect(progressbars('const a = <ProgressTrack label="x" percent={3} />', 'x.tsx')).toEqual([])
    expect(progressbars('const a = <div role="status" />', 'x.tsx')).toEqual([])
  })
})

describe('the guides say it (T-136 (7))', () => {
  it('STYLE_GUIDE lists both components under "Shared affordances", with the rule that fails the build', () => {
    const guide = readFileSync(path.resolve(__dirname, '../../docs/STYLE_GUIDE.md'), 'utf8')
    const shared = guide.slice(guide.indexOf('## Shared affordances'), guide.indexOf('## TypeScript conventions'))
    expect(shared).toMatch(/\*\*`RunningCancel` and `ProgressTrack`\*\*/)
    expect(shared).toMatch(/runningJobControls\.test\.ts/)
  })
})
