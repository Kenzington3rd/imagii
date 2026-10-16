import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { RENDERER_ROOT } from './routeSources'
import { parseSource, sourceFilesUnder } from './renderedStrings'

/**
 * T-113 (16) — the accessibility class sweep, as rules over the syntax tree.
 *
 * Round 62 fixed selection-by-fill on two control groups and a scroller with nothing to focus;
 * the second review pass found the same two shapes on eleven more elements, because each fix
 * had been a point fix. The rules below turn the class into a failing test:
 *
 *   1. A control that shows it is SELECTED by its style - the swapped fill (`bg-accent
 *      text-bg-base`), a border (`border-accent`), a ring (`ring-accent`) or a wash (`bg-accent/15`),
 *      in a conditional class - also says so to assistive tech: `aria-pressed`, `aria-current`,
 *      `aria-selected` or `aria-checked`. A control is a `button` or anything with an `onClick`
 *      (T-114: the rule saw only the fill, so the source cards, the layer rows and the board rows -
 *      selected by border, ring and wash - passed it for a whole round while saying nothing). A
 *      drop zone lit by `dragOver`, and a tile whose checkbox carries the state, have no click of
 *      their own and are not this.
 *   2. A bounded scroller (`max-h-… overflow-y-auto`) with nothing inside it to tab to is itself
 *      focusable (`tabIndex`): this Electron (Chromium 126) does not make a scrollable region
 *      focusable, so a keyboard user could not scroll it. A scroller with a button, link or
 *      field inside is reached through that; one holding another component is given the
 *      benefit of the doubt.
 *   3. A bar that shows a number (`role="progressbar"` / `"meter"`) is named and valued, and
 *      each one the sweep named is wired (`WIRED`, below).
 *   4. A container that is invisible until hovered (`opacity-0 group-hover:opacity-100`) and holds a
 *      button, link or field also shows itself when something inside it has KEYBOARD focus
 *      (`has-[:focus-visible]:opacity-100`; T-115, T-116): the Save and "→ Canvas" buttons on a
 *      reference tile were reachable by Tab and drawn at opacity 0, so a keyboard user pressed
 *      Enter on something they could not see. `focus-within` is not the spelling: a mouse click
 *      focuses the button too, and the scrim stayed lit over the picture after the pointer left.
 *
 *   5. An element that removes the browser's focus outline (`outline-none`) draws its own focus ring
 *      (`focus:ring-…` / `focus-visible:ring-…`; T-119): the clip rename input had `outline-none` and a
 *      background that changes on focus (1.06:1 against its card), the one field in the app with no visible
 *      focus, and nothing in the sweep looked at the combination. The one exemption is the dialog card
 *      (`role="dialog"`), which is only ever focused by script so a screen reader announces its title.
 *
 * The scan reads source text and syntax, not the page: it cannot see conditional rendering, so
 * a green run means "wired", and tests/e2e/* asserts the attributes on the live page.
 */

const STATE_ATTRS = ['aria-pressed', 'aria-current', 'aria-selected', 'aria-checked']
const FOCUSABLE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])

interface Hit {
  file: string
  line: number
}

const attrName = (a: ts.JsxAttributeLike): string | null =>
  ts.isJsxAttribute(a) && ts.isIdentifier(a.name) ? a.name.text : ts.isJsxAttribute(a) ? a.name.getText() : null

function classText(attrs: ts.JsxAttributes): string {
  for (const a of attrs.properties) {
    if (ts.isJsxAttribute(a) && attrName(a) === 'className' && a.initializer) return a.initializer.getText()
  }
  return ''
}

function tagOf(el: ts.JsxOpeningLikeElement): string {
  return el.tagName.getText()
}

function jsxElements(sf: ts.SourceFile): ts.JsxOpeningLikeElement[] {
  const out: ts.JsxOpeningLikeElement[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/**
 * The ways the app marks a selected thing, as they appear in a conditional className: the fill, a plain
 * `border-accent`, a `ring-accent` and an accent wash (`bg-accent/15`). A variant (`hover:border-accent`)
 * is a hover, and `border-accent/40` is an emphasis border: neither is "selected".
 */
const SELECTED_STYLE = /bg-accent text-bg-base|(?<![:\w-])border-accent(?![\w/-])|(?<![:\w-])ring-accent|(?<![:\w-])bg-accent\/\d+/

/** Rule 1: a clickable control whose style swaps when selected, with no selected-state attribute. */
export function selectedByStyleAlone(sf: ts.SourceFile): Hit[] {
  const hits: Hit[] = []
  for (const el of jsxElements(sf)) {
    const names = el.attributes.properties.map(attrName)
    // A control: a native button, or anything the user can click.
    if (tagOf(el) !== 'button' && !names.includes('onClick')) continue
    const cls = classText(el.attributes)
    // The selected style, inside a conditional (a ternary), not a fixed style.
    if (!/\?/.test(cls) || !SELECTED_STYLE.test(cls)) continue
    if (STATE_ATTRS.some((s) => names.includes(s))) continue
    hits.push({ file: sf.fileName, line: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1 })
  }
  return hits
}

/** True when anything inside `node` can take focus by itself, or may (another component). */
function hasFocusableInside(node: ts.Node): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = tagOf(n)
      const names = n.attributes.properties.map(attrName)
      if (FOCUSABLE_TAGS.has(tag) || /^[A-Z]/.test(tag) || names.includes('tabIndex')) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(node, visit)
  return found
}

/** Rule 2: a bounded scroller with nothing to tab to and no tabIndex of its own. */
export function deafScrollers(sf: ts.SourceFile): Hit[] {
  const hits: Hit[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isJsxElement(n)) {
      const cls = classText(n.openingElement.attributes)
      const bounded = /max-h-/.test(cls) && /overflow-(y-)?auto/.test(cls)
      const names = n.openingElement.attributes.properties.map(attrName)
      if (bounded && !names.includes('tabIndex') && !hasFocusableInside(n)) {
        hits.push({ file: sf.fileName, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

/** True when a button, link, field or tab stop sits inside `node` (a component does not count: it is not known). */
function hasNativeFocusableInside(node: ts.Node): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const names = n.attributes.properties.map(attrName)
      if (FOCUSABLE_TAGS.has(tagOf(n)) || names.includes('tabIndex')) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(node, visit)
  return found
}

/** Rule 4: shown on hover alone, with something inside it that a keyboard can reach. */
export function hoverOnlyControls(sf: ts.SourceFile): Hit[] {
  const hits: Hit[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isJsxElement(n)) {
      const cls = classText(n.openingElement.attributes)
      const hidden = /(?<![:\w-])opacity-0(?![\w-])/.test(cls) && /group-hover:opacity-100/.test(cls)
      // Keyboard focus only (T-116): `focus-within` also matches the focus a mouse click leaves behind.
      const shownOnFocus = /(?<![\w-])(group-)?has-\[:focus-visible\]:opacity-100/.test(cls)
      if (hidden && !shownOnFocus && hasNativeFocusableInside(n)) {
        hits.push({ file: sf.fileName, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

/** Rule 5: `outline-none` with no ring of its own to show focus (a dialog card, focused by script, is exempt). */
export function outlineWithoutRing(sf: ts.SourceFile): Hit[] {
  const hits: Hit[] = []
  for (const el of jsxElements(sf)) {
    const cls = classText(el.attributes)
    if (!/(?<![\w-])(?:[\w-]+:)*outline-none(?![\w-])/.test(cls)) continue
    if (/(?<![\w-])(?:focus|focus-visible):ring-/.test(cls)) continue
    const isDialog = el.attributes.properties.some(
      (a) => attrName(a) === 'role' && ts.isJsxAttribute(a) && a.initializer?.getText() === '"dialog"'
    )
    if (isDialog) continue
    hits.push({ file: sf.fileName, line: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1 })
  }
  return hits
}

const files = sourceFilesUnder(RENDERER_ROOT).filter((f) => f.endsWith('.tsx'))
const rel = (h: Hit): string => `${path.relative(RENDERER_ROOT, h.file)}:${h.line}`

describe('the accessibility class sweep (T-113)', () => {
  it('no control shows it is selected by its style alone', () => {
    const hits = files.flatMap((f) => selectedByStyleAlone(parseSource(f)))
    expect(hits.map(rel)).toEqual([])
  })

  it('no bounded scroller is keyboard-dead', () => {
    const hits = files.flatMap((f) => deafScrollers(parseSource(f)))
    expect(hits.map(rel)).toEqual([])
  })

  it('nothing that removes the browser focus outline is left without a ring of its own', () => {
    const hits = files.flatMap((f) => outlineWithoutRing(parseSource(f)))
    expect(hits.map(rel)).toEqual([])
  })

  it('nothing reachable by keyboard is shown on hover alone', () => {
    const hits = files.flatMap((f) => hoverOnlyControls(parseSource(f)))
    expect(hits.map(rel)).toEqual([])
  })

  describe('the rules discriminate', () => {
    const scan = (fn: (sf: ts.SourceFile) => Hit[], code: string): number => fn(parseSource('x.tsx', code)).length

    it('rule 1 flags a swapped fill without a state, and accepts each state attribute', () => {
      const tag = (extra: string): string =>
        "const a = <button className={`px-2 ${on ? 'bg-accent text-bg-base' : 'bg-bg-hover'}`} " + extra + ' />'
      expect(scan(selectedByStyleAlone, tag(''))).toBe(1)
      for (const attr of STATE_ATTRS) expect(scan(selectedByStyleAlone, tag(`${attr}={on}`)), attr).toBe(0)
    })

    it('rule 1 flags a border, a ring and a wash too - on a button and on any element with an onClick (T-114)', () => {
      const button = (cls: string, extra = ''): string =>
        "const a = <button className={`card ${on ? '" + cls + "' : ''}`} " + extra + ' />'
      const row = (cls: string, extra = ''): string =>
        "const a = <li onClick={pick} className={`row ${on ? '" + cls + "' : 'hover:bg-bg-hover'}`} " + extra + ' />'
      // The three shapes the unfixed sites had: Record's source card, the layer row, the board row.
      expect(scan(selectedByStyleAlone, button('border-accent ring-2 ring-accent/50'))).toBe(1)
      expect(scan(selectedByStyleAlone, button('ring-2 ring-accent'))).toBe(1)
      expect(scan(selectedByStyleAlone, row('bg-accent/15 border border-accent'))).toBe(1)
      expect(scan(selectedByStyleAlone, row('bg-accent/10'))).toBe(1)
      expect(scan(selectedByStyleAlone, row('border-accent'))).toBe(1)
      for (const attr of STATE_ATTRS) {
        expect(scan(selectedByStyleAlone, button('border-accent', `${attr}={on}`)), attr).toBe(0)
        expect(scan(selectedByStyleAlone, row('bg-accent/15 border border-accent', `${attr}={on}`)), attr).toBe(0)
      }
    })

    it('rule 1 leaves a fixed style, a ternary that is not about selection, a drop zone and a hover alone', () => {
      expect(scan(selectedByStyleAlone, "const a = <button className='btn-primary px-3' />")).toBe(0)
      expect(scan(selectedByStyleAlone, "const a = <button className={busy ? 'opacity-50' : ''} />")).toBe(0)
      // A drop zone lit while a file is over it: no click of its own, not a selection.
      expect(scan(selectedByStyleAlone, "const a = <div className={`card ${dragOver ? 'border-accent bg-bg-hover' : ''}`} />")).toBe(0)
      // A hover or focus variant, and an emphasis border with its own alpha, are not "selected".
      expect(scan(selectedByStyleAlone, "const a = <button className={`x ${on ? 'hover:border-accent hover:bg-accent/10 border-accent/40' : ''}`} />")).toBe(0)
      // A fixed accent border, not conditional on anything.
      expect(scan(selectedByStyleAlone, "const a = <button className='border border-accent px-2' />")).toBe(0)
    })

    it('rule 2 flags a list of plain rows, and accepts tabIndex, a button inside, or another component', () => {
      const list = (attrs: string, inner: string): string =>
        `const a = <ul className="max-h-40 overflow-y-auto" ${attrs}><li>${inner}</li></ul>`
      expect(scan(deafScrollers, list('', 'row'))).toBe(1)
      expect(scan(deafScrollers, list('tabIndex={0}', 'row'))).toBe(0)
      expect(scan(deafScrollers, list('', '<button>x</button>'))).toBe(0)
      expect(scan(deafScrollers, list('', '<Thing />'))).toBe(0)
    })

    it('rule 4 flags a hover-only overlay holding a button, and accepts a keyboard-focus reveal (either spelling) or nothing to focus', () => {
      const overlay = (cls: string, inner: string): string => `const a = <div className="${cls}">${inner}</div>`
      const hoverOnly = 'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity'
      expect(scan(hoverOnlyControls, overlay(hoverOnly, '<button>Save</button>'))).toBe(1)
      expect(scan(hoverOnlyControls, overlay(hoverOnly, '<a href="#">x</a>'))).toBe(1)
      expect(scan(hoverOnlyControls, overlay(hoverOnly, '<span><input /></span>'))).toBe(1)
      expect(scan(hoverOnlyControls, overlay(`${hoverOnly} has-[:focus-visible]:opacity-100`, '<button>Save</button>'))).toBe(0)
      expect(scan(hoverOnlyControls, overlay(`${hoverOnly} group-has-[:focus-visible]:opacity-100`, '<button>Save</button>'))).toBe(0)
      // T-116: focus-within is the spelling that stuck - a click's focus kept the scrim lit - so it is not accepted.
      expect(scan(hoverOnlyControls, overlay(`${hoverOnly} focus-within:opacity-100`, '<button>Save</button>'))).toBe(1)
      expect(scan(hoverOnlyControls, overlay(`${hoverOnly} group-focus-within:opacity-100`, '<button>Save</button>'))).toBe(1)
      // Text only: a keyboard has nothing to reach, so hover-only is a visual choice, not a trap.
      expect(scan(hoverOnlyControls, overlay(hoverOnly, '<span>title</span>'))).toBe(0)
      // Not hover-only: opacity-0 alone (an animation start) or a plain hover variant.
      expect(scan(hoverOnlyControls, overlay('opacity-0 transition-opacity', '<button>x</button>'))).toBe(0)
      expect(scan(hoverOnlyControls, overlay('hover:opacity-100', '<button>x</button>'))).toBe(0)
      // A focus variant that is not the reveal (a ring) does not count as one.
      expect(scan(hoverOnlyControls, overlay(`${hoverOnly} focus-within:ring-2`, '<button>x</button>'))).toBe(1)
      expect(scan(hoverOnlyControls, overlay(`${hoverOnly} has-[:focus-visible]:ring-2`, '<button>x</button>'))).toBe(1)
    })

    it('rule 5 flags outline-none with no ring (the clip rename input), and accepts either ring spelling, a dialog card, and an element that keeps its outline', () => {
      const field = (cls: string, extra = ''): string => `const a = <input className="${cls}" ${extra} />`
      // The unfixed shape: a background change on focus is not a ring.
      expect(scan(outlineWithoutRing, field('bg-transparent flex-1 min-w-0 outline-none focus:bg-bg-base px-1 rounded text-sm'))).toBe(1)
      expect(scan(outlineWithoutRing, field('focus:outline-none focus:bg-bg-base'))).toBe(1)
      expect(scan(outlineWithoutRing, field('focus-visible:outline-none'))).toBe(1)
      // A ring that is not a FOCUS ring (always on, or on hover) does not count.
      expect(scan(outlineWithoutRing, field('outline-none ring-1 ring-accent'))).toBe(1)
      expect(scan(outlineWithoutRing, field('outline-none hover:ring-2'))).toBe(1)
      // The fixed shape, in both spellings the app uses.
      expect(scan(outlineWithoutRing, field('outline-none focus:bg-bg-base focus:ring-1 focus:ring-accent'))).toBe(0)
      expect(scan(outlineWithoutRing, field('outline-none focus-visible:ring-2 focus-visible:ring-accent'))).toBe(0)
      // The dialog card is focused by script only; an element that never removed its outline is not this.
      expect(scan(outlineWithoutRing, 'const a = <div role="dialog" className={`rounded outline-none ${x}`} />')).toBe(0)
      expect(scan(outlineWithoutRing, field('bg-bg-base rounded px-2'))).toBe(0)
      // A class that merely CONTAINS the letters is not the utility.
      expect(scan(outlineWithoutRing, field('no-outline-nonexistent'))).toBe(0)
    })

    it('rule 2 ignores a scroller with no height bound (a page area, not a box)', () => {
      expect(scan(deafScrollers, 'const a = <div className="h-full overflow-auto"><p>text</p></div>')).toBe(0)
    })
  })
})

/** The elements the sweep named, each wired: file, then the pattern that must be in it. */
const WIRED: ReadonlyArray<readonly [string, string, RegExp]> = [
  ['modules/video-studio/CropOverlay.tsx', 'crop shapes', /aria-pressed=\{aspect === m\}/],
  ['modules/audio-studio/LevelsPanel.tsx', 'compressor presets', /aria-pressed=\{chain\.compressor === opt\.value\}/],
  ['modules/audio-studio/CleanupPanel.tsx', 'noise strengths', /aria-pressed=\{chain\.denoise === opt\.value\}/],
  ['modules/video-studio/PostChecklist.tsx', 'posting-log platforms', /aria-pressed=\{platforms\.includes\(p\)\}/],
  ['modules/image-studio/Toolbar.tsx', 'drawing tools', /aria-pressed=\{tool === t\.id\}/],
  ['modules/references/ReferencesStudio.tsx', 'studio tabs', /aria-current=\{active \? 'true' : undefined\}/],
  ['modules/video-studio/HighlightPanel.tsx', 'chat-log disclosure', /aria-expanded=\{showChatInput\}/],
  ['modules/video-studio/HighlightPanel.tsx', 'scan bar', /role="progressbar"[\s\S]{0,160}aria-label="Scanning the video for highlights"[\s\S]{0,120}aria-valuenow=\{Math\.round\(progress\)\}/],
  ['modules/video-studio/HighlightPanel.tsx', 'signal bars', /role="meter"[\s\S]{0,80}aria-label=\{`\$\{label\} signal`\}[\s\S]{0,120}aria-valuenow=\{Math\.round\(value \* 100\)\}/],
  ['modules/video-studio/CaptionsPanel.tsx', 'model download bar', /role="progressbar"[\s\S]{0,160}aria-label="Downloading the caption model"[\s\S]{0,120}aria-valuenow=\{Math\.round\(installProgress\.percent \?\? 0\)\}/],
  ['modules/video-studio/CaptionsPanel.tsx', 'transcript preview', /role="region"\s+tabIndex=\{0\}\s+aria-label="Transcript preview"/],
  ['modules/record-studio/RecordStudio.tsx', 'convert bar', /role="progressbar"[\s\S]{0,160}aria-label="Converting the recording to MP4"[\s\S]{0,120}aria-valuenow=\{savePercent === null \? undefined : Math\.round\(savePercent\)\}[\s\S]{0,160}progress-indeterminate/],
  ['modules/video-studio/SafeZoneWarningModal.tsx', 'cropped-clips list', /tabIndex=\{0\}\s+aria-label="Clips that will be cropped"/],
  ['modules/video-studio/ClipKitButton.tsx', 'busy button', /aria-live="polite"/],
  // T-114: the range hint sits BESIDE the checkbox's label (not in it), in parentheses, with the true minus.
  ['modules/audio-studio/LevelsPanel.tsx', 'loudness range hint', /<\/label>\s*<span className="text-xs text-ink-dim">\(\u2212\{Math\.abs\(LOUDNESS_TARGET_LUFS\.min\)\} to \u2212\{Math\.abs\(LOUDNESS_TARGET_LUFS\.max\)\}\)<\/span>/],
  ['modules/record-studio/RecordStudio.tsx', 'source cards', /aria-pressed=\{selectedSourceId === s\.id\}/],
  ['modules/image-studio/LayerPanel.tsx', 'layer rows', /<li\s+key=\{layer\.id\}\s+onClick=\{\(\) => selectLayer\(layer\.id\)\}\s+aria-current=\{isSelected \? 'true' : undefined\}/],
  ['modules/image-studio/LayerPanel.tsx', 'layer select button', /<button\s+onClick=\{\(\) => selectLayer\(layer\.id\)\}\s+aria-current=\{isSelected \? 'true' : undefined\}/],
  ['modules/image-studio/LayerPanel.tsx', 'layer visibility toggle', /aria-pressed=\{layer\.visible\}[\s\S]{0,120}aria-label="Layer visible"/],
  ['modules/references/MoodBoardPanel.tsx', 'board rows', /<li\s+key=\{c\.id\}\s+aria-current=\{isSelected \? 'true' : undefined\}/],
  ['modules/references/MoodBoardPanel.tsx', 'board select button', /<button\s+onClick=\{\(\) => selectCollection\(c\.id\)\}\s+aria-current=\{isSelected \? 'true' : undefined\}/],
  ['modules/video-studio/SafeZoneWarningModal.tsx', 'opens on Cancel', /data-initial-focus[\s\S]{0,120}onClick=\{onCancel\}/],
  ['hooks/useFocusTrap.ts', 'initial focus honored', /\[data-initial-focus\]/],
  ['modules/video-studio/ExportPanel.tsx', 'queue bar', /role="progressbar"[\s\S]{0,160}aria-label=\{`\$\{j\.clipName\} \u00b7 \$\{j\.presetLabel\}`\}[\s\S]{0,160}aria-valuenow=\{Math\.round\(j\.percent\)\}/],
  ['modules/video-studio/TextOverlayEditor.tsx', 'x and y names', /aria-label="x \/ y, horizontal position \(0 to 1\)"[\s\S]{0,700}aria-label="x \/ y, vertical position \(0 to 1\)"/],
  ['modules/image-studio/ExportDialog.tsx', 'format select name', /aria-label="Export format"[\s\S]{0,120}setFormat\(/],
  // T-123 (4): `DraftField` moved out of TextOverlayEditor into components/ (nine boxes use it now), so the T-114 claim
  // "the color box points at its sentence" is two facts: the shared box wires its description to the sentence it draws,
  // and the Color box is that box.
  ['components/DraftField.tsx', 'a refused box points at its sentence', /aria-describedby=\{problem \? alertId : undefined\}[\s\S]{0,1200}id=\{alertId\}/],
  ['modules/video-studio/TextOverlayEditor.tsx', 'the color box is a DraftField', /<DraftField\s+label="Color"\s+type="text"/],
  ['modules/video-studio/GifPanel.tsx', 'live region keeps no gap', /role="status"[\s\S]{0,40}-mb-3/]
]

describe('each element the sweep named is wired (T-113)', () => {
  it.each(WIRED)('%s: %s', (file, _what, pattern) => {
    expect(readFileSync(path.join(RENDERER_ROOT, file), 'utf8')).toMatch(pattern)
  })

  it('DESIGN_GUIDE says it: a scroller without focusable children is made focusable', () => {
    const guide = readFileSync(path.resolve(__dirname, '../../docs/DESIGN_GUIDE.md'), 'utf8')
    expect(guide).toMatch(/Scrollable regions without focusable children are made focusable/)
    expect(guide).toMatch(/Chromium 126 has\s+no focusable scrollers/)
  })
})
