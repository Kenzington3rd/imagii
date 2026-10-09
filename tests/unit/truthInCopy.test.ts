import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { SHORTCUTS_BY_ROUTE } from '../../src/renderer/src/components/HotkeyOverlay'

/**
 * T-85 — copy that promised what the code does not do.
 *
 * Six promises reached users that no code kept: thumbnails "screened locally"
 * (the only filter is DuckDuckGo's own SafeSearch parameter), a reframe that
 * would "follow the action" (a fixed strip, picked by Left / Center / Right),
 * a recorder that was "your one-stop alternative to OBS" (no game or desktop
 * audio), a watermark that "stamps your @handle on every export" (Clip Kit,
 * GIF, reframe, compile and PiP took none), "Everything runs locally" (search
 * and the caption-model download go online), and "Save full app state"
 * (mood boards are not in a project file).
 *
 * Each ruling — fix the code to meet the promise, or the promise to meet the
 * code — is in docs/LESSONS_LEARNED.md. This file keeps the copy from drifting
 * back: it reads the source, because a rendered panel is the E2E's business
 * and these strings must also stay out of the places no test renders.
 *
 * Comments are stripped before the "this phrase is gone" scans, so a comment
 * that explains what a line used to say does not fail the build.
 */

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8')

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 8) return
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      if (statSync(full).isDirectory()) walk(full, depth + 1)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full)
    }
  }
  walk(path.join(ROOT, dir), 0)
  return out
}

const ALL_SRC = [...sourceFiles('src/renderer/src'), ...sourceFiles('src/shared'), ...sourceFiles('src/main')]
const ALL_CODE = ALL_SRC.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')

describe('Reference Search says who does the filtering', () => {
  const panel = read('src/renderer/src/modules/references/ReferencePanel.tsx')

  it('names DuckDuckGo as the filter, and says imagii does not scan images', () => {
    expect(panel).toMatch(/SafeSearch is always on \(strict\) — DuckDuckGo does the filtering/)
    expect(panel).toMatch(/scan images itself/)
    // T-89: not "the one feature that goes online" — the caption-model download
    // is online too (the two exceptions are named in the next describe).
    expect(panel).toMatch(
      /Reference Search goes\s+online; your saved boards\s+stay on your computer\./
    )
  })

  it('"the one feature that goes online" is gone everywhere it was said — panel, tutorial, source', () => {
    expect(stripComments(panel)).not.toMatch(/one feature that goes/i)
    expect(ALL_CODE).not.toMatch(/one feature that goes/i)
  })

  it('no longer claims thumbnails are screened locally — there is no screening code', () => {
    expect(stripComments(panel)).not.toMatch(/screened/i)
    expect(read('docs/USER_GUIDE.md')).not.toMatch(/screened locally/i)
  })
})

describe('Reframe is a fixed strip, and says so', () => {
  const panel = read('src/renderer/src/modules/video-studio/ReframePanel.tsx')

  it('offers Left, Center and Right — no duplicate Center, no value that implies tracking', () => {
    expect(panel).toMatch(/type ReframePosition = 'left' \| 'center' \| 'right'\n/)
    expect(panel).toMatch(/label: 'Left'/)
    expect(panel).toMatch(/label: 'Center'/)
    expect(panel).toMatch(/label: 'Right'/)
    expect(panel.match(/label: '/g)).toHaveLength(3)
  })

  it('is titled for what it does, and states plainly that it does not track', () => {
    expect(panel).toMatch(/Reframe to 9:16 \(center crop\)/)
    expect(panel).toMatch(/it does not track faces or action/)
    expect(panel).toMatch(/TikTok, Reels, and Shorts/)
  })

  it("the 'smart' position is gone from the type, the validator and the crop maths", () => {
    expect(read('src/shared/api.ts')).toMatch(/position: 'left' \| 'center' \| 'right'\n/)
    expect(read('src/main/ffmpeg/reframe.ts')).toMatch(
      /export type ReframePosition = 'left' \| 'center' \| 'right'\n/
    )
    expect(read('src/main/ipc/video.ts')).toMatch(
      /const REFRAME_POSITIONS = \['left', 'center', 'right'\] as const/
    )
    expect(ALL_CODE).not.toMatch(/'smart'/)
  })

  it('no code anywhere promises tracking, saliency, or an "Auto (centered)" button', () => {
    expect(ALL_CODE).not.toMatch(/Auto \(centered\)/)
    expect(ALL_CODE).not.toMatch(/saliency/i)
    expect(ALL_CODE).not.toMatch(/follows? the action/i)
    expect(ALL_CODE).not.toMatch(/Auto-reframe/)
  })
})

describe('Record says what it captures, and what it does not', () => {
  const home = read('src/renderer/src/routes/Home.tsx')
  const record = read('src/renderer/src/modules/record-studio/RecordStudio.tsx')

  it('the Home card is not "your one-stop alternative to OBS"', () => {
    expect(home).toMatch(
      /description="Record your screen or a window, with your webcam and mic, to one video file\. Game and desktop sound are not captured\."/
    )
    expect(stripComments(home)).not.toMatch(/one-stop|alternative to OBS/i)
  })

  it('the Record header matches the card: a screen or window, with OPTIONAL webcam and mic', () => {
    expect(record).toMatch(/Capture a screen or window, with optional webcam and mic/)
    // A webcam on its own is not a source (the picker lists screens and windows).
    expect(stripComments(record)).not.toMatch(/screen, window, or webcam/)
  })

  it('the guides say the same: no webcam-only recording, no game audio', () => {
    expect(read('docs/USER_GUIDE.md')).not.toMatch(/a window, or your webcam/)
    expect(read('docs/USER_GUIDE.md')).toMatch(/Game and desktop sound are not captured/)
    expect(read('docs/PRODUCT_GUIDE.md')).toMatch(/Game and desktop sound are not captured/)
    expect(read('README.md')).not.toMatch(/replaces OBS/i)
  })
})

describe('local-first names its two online exceptions', () => {
  const EXCEPTIONS = /Reference Search and the one-time caption model download/

  it('Welcome and Home carry the clause beside "locally"', () => {
    expect(read('src/renderer/src/routes/Welcome.tsx').replace(/\s+/g, ' ')).toMatch(EXCEPTIONS)
    expect(read('src/renderer/src/routes/Home.tsx').replace(/\s+/g, ' ')).toMatch(EXCEPTIONS)
  })

  it('the BRANDING guide — the source of the promise — states it, and so do the product and user guides', () => {
    const branding = read('docs/BRANDING_GUIDE.md').replace(/\s+/g, ' ')
    expect(branding).toMatch(EXCEPTIONS)
    expect(branding).toMatch(/Everything runs on the user's computer, except/)
    expect(read('docs/USER_GUIDE.md').replace(/\s+/g, ' ')).toMatch(/caption model download/)
    expect(read('docs/PRODUCT_GUIDE.md').replace(/\s+/g, ' ')).toMatch(/Reference Search|References\s+searches/)
  })
})

describe('the shortcuts overlay says what a project holds', () => {
  it('Save project is the studios and layout, and mood boards live outside it', () => {
    const row = SHORTCUTS_BY_ROUTE['/home']?.find((r) => r.keys === 'Save project')
    expect(row?.description).toBe(
      'Save your project (studios and layout; mood boards live outside projects)'
    )
    expect(ALL_CODE).not.toMatch(/full app state/i)
  })
})

describe('the watermark claim matches what carries one', () => {
  const guide = read('docs/USER_GUIDE.md').replace(/\s+/g, ' ')

  it('the user guide no longer says every export is stamped', () => {
    expect(guide).not.toMatch(/stamp your handle on every export/i)
    expect(guide).toMatch(/Clip Kit/)
    expect(guide).toMatch(/GIF, reframe, compilation and picture-in-picture don.t take one/)
  })
})

describe('Captions say what they do (T-89)', () => {
  const panelSource = read('src/renderer/src/modules/video-studio/CaptionsPanel.tsx')
  const panel = stripComments(panelSource).replace(/\s+/g, ' ')
  const whisper = stripComments(read('src/main/sidecars/whisperManager.ts'))

  it('the setup card asks for the binary current whisper.cpp builds ship, never the old name', () => {
    expect(panel).toMatch(/<code>whisper-cli\.exe<\/code>/)
    expect(panel).not.toMatch(/whisper\.exe/)
    // Main accepts both names, so a user who already set up under the old one is not stranded.
    expect(stripComments(read('src/main/sidecars/paths.ts'))).toMatch(
      /WHISPER_EXE_NAMES = \['whisper-cli\.exe', 'whisper\.exe'\]/
    )
  })

  it('says in one line what is manual, what is automatic, and that the download goes online', () => {
    expect(panel).toMatch(
      /You download the captions engine once \(<code>whisper-cli\.exe<\/code>\); imagii downloads the English model \(~141 MB\) for you — that download goes online, once\./
    )
  })

  it('states plainly that captions are English only, and no longer says the model decides', () => {
    expect(panel).toMatch(/Captions are English only\./)
    expect(panel).not.toMatch(/determines languages|English only by default/)
  })

  it('says captions burn into the original video, not the platform exports', () => {
    expect(panel).toMatch(/Captions burn into the original video, not the platform exports\./)
  })

  it('the size control is "Size" with the real height beside it — not "Font px", not "pixels"', () => {
    expect(panel).not.toMatch(/Font px|size in pixels|\d+ pixels/)
    expect(panel).toMatch(/>Size</)
    expect(panel).toMatch(/captionSizeReadout\(style\.fontSize\)/)
  })

  it('progress prints a plain label, never the phase id, and has an indeterminate branch', () => {
    expect(panel).toMatch(/captionPhaseLabel\(progress\.phase\)/)
    expect(panel).not.toMatch(/\{progress\.phase\}/)
    expect(panel).toMatch(/progress-indeterminate/)
  })

  it('main sends no invented progress number', () => {
    expect(whisper).not.toMatch(/Math\.random/)
  })

  it('the toasts say what happened: lines of captions, and whether the burn had any', () => {
    expect(panel).toMatch(/captionsReadyMessage\(result\.segments\.length\)/)
    expect(panel).not.toMatch(/Captioned \$\{|segments`/)
    expect(panel).toMatch(/if \(result\.captioned\)/)
    expect(panel).toMatch(/'Caption model downloaded'/)
    expect(panel).not.toMatch(/Whisper model installed/)
  })
})
