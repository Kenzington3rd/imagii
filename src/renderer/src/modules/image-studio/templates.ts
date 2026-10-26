import { nanoid } from 'nanoid'
import { asHint, type CanvasDocument, type CanvasLayer } from '@shared/canvas'
import type { IconName } from '../../components/Icon'

export type TemplateCategory = 'thumbnail' | 'overlay' | 'banner' | 'emote'

/**
 * Display label + icon per template category. Single source of truth —
 * both ImportPanel (empty-state grid) and TemplatesDialog (modal) import
 * these instead of each maintaining its own emoji-prefixed copy. See
 * docs/STYLE_GUIDE.md: no emoji in the UI; categories carry an Icon.
 */
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  thumbnail: 'Thumbnails',
  overlay: 'Stream overlays',
  banner: 'Banners',
  emote: 'Emotes'
}

export const TEMPLATE_CATEGORY_ICONS: Record<TemplateCategory, IconName> = {
  thumbnail: 'thumbnail',
  overlay: 'overlay-frame',
  banner: 'banner',
  emote: 'emote'
}

/**
 * T-91 + T-103 — which template layers are `asHint(...)`, and why.
 *
 * A hint layer is there to guide the person editing and is left out of every
 * export (`captureDocument`), so the file they post never says "Facecam goes
 * here" or "YOUR TITLE HERE". The rule, which `templateTruth.test.ts` holds
 * every template and asset to with a per-card table:
 *   - TEXT THE PERSON MUST REPLACE for the export to be theirs is a hint: a
 *     stand-in title, a name, a handle, a game, a schedule line. The question
 *     is "would a user plausibly ship this text verbatim ON PURPOSE?" — no
 *     means hint. Retyping a hint text layer clears the flag (`canvasStore`),
 *     so what a user types always exports;
 *   - text that IS the card's deliverable is not a hint: "BE RIGHT BACK",
 *     "STARTING SOON", "THANKS FOR HANGING OUT" and the lines under them, the
 *     emote's "POG". Exporting the BRB card should give a BRB screen, not a
 *     plate with no words on it. (The countdown's "0:00" is a HINT — no stream
 *     starts at 0:00, so the user must set a real time, the definition of a
 *     placeholder.);
 *   - guidance with a name that says so ("... hole", "... hint", "... placeholder",
 *     the safe-area frames of the channel banner) is a hint whatever it is.
 * Design that is not words — plates, borders, bars, shapes — is not a hint and
 * exports as drawn.
 */
export interface CanvasTemplate {
  id: string
  name: string
  description: string
  category: TemplateCategory
  doc: CanvasDocument
}

function rectLayer(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke = 'transparent',
  strokeWidth = 0,
  cornerRadius = 0
): CanvasLayer {
  return {
    id: nanoid(8),
    type: 'rect',
    name,
    visible: true,
    locked: false,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    width,
    height,
    fill,
    stroke,
    strokeWidth,
    cornerRadius
  }
}

function ellipseLayer(
  name: string,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  stroke = 'transparent',
  strokeWidth = 0
): CanvasLayer {
  return {
    id: nanoid(8),
    type: 'ellipse',
    name,
    visible: true,
    locked: false,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    radiusX: rx,
    radiusY: ry,
    fill,
    stroke,
    strokeWidth
  }
}

function textLayer(
  name: string,
  x: number,
  y: number,
  text: string,
  fontSize: number,
  fill = '#120c0c',
  fontFamily = 'Inter, sans-serif'
): CanvasLayer {
  return {
    id: nanoid(8),
    type: 'text',
    name,
    visible: true,
    locked: false,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    text,
    fontSize,
    fontFamily,
    fill
  }
}

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: 'yt-thumb-bold',
    name: 'YouTube · Bold thumbnail',
    description:
      '1280×720 with a reaction-face zone and a shouty title. The face guide and the sample title do not export; the title does once you type your own.',
    category: 'thumbnail',
    doc: {
      width: 1280,
      height: 720,
      background: '#241614',
      layers: [
        rectLayer('Accent bar', 0, 540, 1280, 180, '#ff3131'),
        asHint(textLayer('Title', 60, 60, 'YOUR TITLE\nHERE', 130, '#ffffff', 'Impact, Inter, sans-serif')),
        asHint(rectLayer('Face placeholder', 760, 110, 460, 460, 'rgba(255,49,49,0.18)', '#ff3131', 4, 24)),
        asHint(textLayer('Face hint', 880, 320, 'Drop face here', 36, '#ff3131'))
      ]
    }
  },
  {
    id: 'yt-thumb-clean',
    name: 'YouTube · Clean thumbnail',
    description:
      '1280×720, minimal layout for tutorials and explainers. The sample words (eyebrow, title, subtitle) do not export; whatever you type in their place does.',
    category: 'thumbnail',
    doc: {
      width: 1280,
      height: 720,
      background: '#120c0c',
      layers: [
        rectLayer('Accent stripe', 0, 0, 12, 720, '#ff3131'),
        asHint(textLayer('Eyebrow', 80, 80, 'TUTORIAL', 36, '#ff3131')),
        asHint(textLayer('Title', 80, 160, 'How to do\nthe thing', 110, '#ffffff')),
        asHint(textLayer('Subtitle', 80, 580, 'in 3 minutes', 48, '#a59a97'))
      ]
    }
  },
  {
    id: 'tw-overlay-streamer',
    name: 'Twitch · Stream overlay',
    description:
      '1920×1080 transparent PNG for OBS — facecam hole + lower-third. The guides and placeholders do not export.',
    category: 'overlay',
    doc: {
      width: 1920,
      height: 1080,
      background: 'transparent',
      layers: [
        asHint(
          rectLayer('Facecam hole', 1500, 800, 400, 240, 'rgba(255,49,49,0.10)', '#ff3131', 4, 16)
        ),
        asHint(textLayer('Facecam hint', 1560, 900, 'Facecam goes here', 22, '#ff3131')),
        rectLayer('Lower third', 60, 980, 700, 80, 'rgba(18,12,12,0.85)', '#ff3131', 2, 12),
        asHint(textLayer('Handle', 84, 1000, '@yourhandle', 36, '#ffffff')),
        asHint(textLayer('Now playing', 84, 1044, 'NOW PLAYING · Game name', 18, '#ff3131'))
      ]
    }
  },
  {
    id: 'tw-overlay-minimal',
    name: 'Twitch · Minimal overlay',
    description:
      '1920×1080 transparent PNG for OBS with just a corner facecam frame. The frame exports; the sample handle does not export until you type your own.',
    category: 'overlay',
    doc: {
      width: 1920,
      height: 1080,
      background: 'transparent',
      layers: [
        rectLayer(
          'Facecam border',
          40,
          40,
          360,
          200,
          'transparent',
          '#ff3131',
          5,
          12
        ),
        asHint(textLayer('Handle corner', 60, 256, '@yourhandle', 24, '#ff3131'))
      ]
    }
  },
  {
    // B8 fix (round 16): the prior 1920×480 size did not match any real
    // Twitch surface, so this was cut to 1200×480 and called the "video-player
    // banner / offline screen". T-91: 1200×480 is Twitch's PROFILE banner (the
    // header on the channel page); the offline / video-player screen is 16:9
    // (1920×1080 recommended), which this is not. The id is kept — saved
    // projects and the tests address templates by it — but the name and the
    // description now say what the pixels fit. Layer coordinates were scaled
    // proportionally from the prior 1920-wide layout (width × 0.625).
    // T-112: the description used to end "Not the 16:9 offline screen." — naming a screen no
    // card in the app provides. It now points at the scene cards that do exist.
    id: 'tw-banner-videoplayer',
    name: 'Twitch · Profile banner',
    description:
      '1200×480 — the size of the banner on your Twitch channel page. The sample handle and schedule do not export until you type your own. For a full-screen scene, use the scene cards in the Asset Library.',
    category: 'banner',
    doc: {
      width: 1200,
      height: 480,
      background: '#241614',
      layers: [
        rectLayer('Bg accent', 0, 0, 1200, 480, '#ff3131', 'transparent', 0, 0),
        rectLayer('Bg dark', 0, 60, 1200, 360, '#120c0c', 'transparent', 0, 0),
        asHint(textLayer('Handle', 50, 140, '@yourhandle', 96, '#ffffff', 'Impact, Inter, sans-serif')),
        asHint(textLayer('Schedule', 50, 280, 'Streams: Mon · Wed · Fri · 7pm ET', 32, '#ff3131'))
      ]
    }
  },
  {
    id: 'yt-banner-channel',
    // B9 fix (round 16): the prior 1106×350 marker matched neither YouTube's
    // documented all-device safe area (1546×423 centered) nor its TV-safe
    // minimum (1235×338 centered). Render BOTH: outer all-device frame so
    // the designer sees what definitely renders on every surface, and an
    // inner TV-safe frame so they know where to keep load-bearing text.
    name: 'YouTube · Channel banner',
    description:
      '2560×1440 YouTube channel art with both safe-area frames (all-device + TV-safe). The frames, their label and the sample channel name do not export; type your own name and it does.',
    category: 'banner',
    doc: {
      width: 2560,
      height: 1440,
      background: '#120c0c',
      layers: [
        // All-device safe area: 1546×423 centered on 2560×1440 → offset
        // ((2560-1546)/2, (1440-423)/2) = (507, 508).
        asHint(rectLayer('All-device safe area', 507, 508, 1546, 423, 'transparent', '#ff3131', 2, 12)),
        // TV-safe minimum: 1235×338 centered → offset (662, 551).
        asHint(rectLayer('TV-safe area', 662, 551, 1235, 338, 'transparent', '#fbbf24', 2, 8)),
        asHint(
          textLayer('Safe area hint', 695, 580, 'TV-safe — keep load-bearing text inside', 22, '#fbbf24')
        ),
        asHint(textLayer('Channel name', 800, 700, 'YOUR\nCHANNEL', 140, '#ffffff', 'Impact, Inter, sans-serif'))
      ]
    }
  },
  {
    id: 'yt-thumb-bold-2k',
    name: 'YouTube · Bold thumbnail (2K)',
    description:
      '2560×1440 reaction-style — the 720p layout at twice the pixels. YouTube thumbnails are 1280×720; export at 0.5× to match. The face guide and the sample title do not export; the title does once you type your own.',
    category: 'thumbnail',
    doc: {
      width: 2560,
      height: 1440,
      background: '#241614',
      layers: [
        rectLayer('Accent bar', 0, 1080, 2560, 360, '#ff3131'),
        asHint(textLayer('Title', 120, 120, 'YOUR TITLE\nHERE', 260, '#ffffff', 'Impact, Inter, sans-serif')),
        asHint(rectLayer('Face placeholder', 1520, 220, 920, 920, 'rgba(255,49,49,0.18)', '#ff3131', 6, 36)),
        asHint(textLayer('Face hint', 1760, 640, 'Drop face here', 56, '#ff3131'))
      ]
    }
  },
  {
    id: 'yt-thumb-bold-4k',
    name: 'YouTube · Bold thumbnail (4K)',
    description:
      '3840×2160 reaction-style — the 720p layout at 4K. It is 16:9, so not for vertical Shorts; YouTube thumbnails are 1280×720. The face guide and the sample title do not export; the title does once you type your own.',
    category: 'thumbnail',
    doc: {
      width: 3840,
      height: 2160,
      background: '#241614',
      layers: [
        rectLayer('Accent bar', 0, 1620, 3840, 540, '#ff3131'),
        asHint(textLayer('Title', 180, 180, 'YOUR TITLE\nHERE', 390, '#ffffff', 'Impact, Inter, sans-serif')),
        asHint(rectLayer('Face placeholder', 2280, 330, 1380, 1380, 'rgba(255,49,49,0.18)', '#ff3131', 8, 54)),
        asHint(textLayer('Face hint', 2640, 960, 'Drop face here', 84, '#ff3131'))
      ]
    }
  },
  {
    id: 'tw-overlay-streamer-2k',
    name: 'Twitch · Stream overlay (2K)',
    description:
      '2560×1440 transparent PNG for OBS — facecam hole + lower-third for 1440p streams. The guides and placeholders do not export.',
    category: 'overlay',
    doc: {
      width: 2560,
      height: 1440,
      background: 'transparent',
      layers: [
        asHint(rectLayer('Facecam hole', 2000, 1067, 533, 320, 'rgba(255,49,49,0.10)', '#ff3131', 5, 21)),
        asHint(textLayer('Facecam hint', 2080, 1200, 'Facecam goes here', 29, '#ff3131')),
        rectLayer('Lower third', 80, 1307, 933, 107, 'rgba(18,12,12,0.85)', '#ff3131', 3, 16),
        asHint(textLayer('Handle', 112, 1333, '@yourhandle', 48, '#ffffff')),
        asHint(textLayer('Now playing', 112, 1392, 'NOW PLAYING · Game name', 24, '#ff3131'))
      ]
    }
  },
  {
    id: 'tw-overlay-streamer-4k',
    name: 'Twitch · Stream overlay (4K)',
    description:
      '3840×2160 transparent PNG for OBS — facecam hole + lower-third for 4K capture. The guides and placeholders do not export.',
    category: 'overlay',
    doc: {
      width: 3840,
      height: 2160,
      background: 'transparent',
      layers: [
        asHint(rectLayer('Facecam hole', 3000, 1600, 800, 480, 'rgba(255,49,49,0.10)', '#ff3131', 8, 32)),
        asHint(textLayer('Facecam hint', 3120, 1800, 'Facecam goes here', 44, '#ff3131')),
        rectLayer('Lower third', 120, 1960, 1400, 160, 'rgba(18,12,12,0.85)', '#ff3131', 4, 24),
        asHint(textLayer('Handle', 168, 2000, '@yourhandle', 72, '#ffffff')),
        asHint(textLayer('Now playing', 168, 2088, 'NOW PLAYING · Game name', 36, '#ff3131'))
      ]
    }
  },
  {
    id: 'emote-blank-112',
    // INIT-B (round 15): explicit name so the user knows exporting this
    // template produces the full Twitch trio (28/56/112), not just the
    // one 112×112 PNG.
    name: 'Emote · auto-exports 28/56/112 trio',
    description:
      'Blank 112×112 emote canvas. Export emits a 3-PNG Twitch pack at 28, 56, and 112 px.',
    category: 'emote',
    doc: {
      width: 112,
      height: 112,
      background: 'transparent',
      layers: [
        ellipseLayer('Base circle', 56, 56, 50, 50, '#ff3131', '#f52e2e', 2)
      ]
    }
  },
  {
    id: 'emote-text',
    name: 'Emote · Text "POG"',
    description: 'Text emote starting point.',
    category: 'emote',
    doc: {
      width: 112,
      height: 112,
      background: 'transparent',
      layers: [
        ellipseLayer('Bg', 56, 56, 50, 50, '#fbbf24', '#120c0c', 3),
        textLayer('Text', 22, 30, 'POG', 48, '#120c0c', 'Impact, Inter, sans-serif')
      ]
    }
  }
]

export function getTemplatesByCategory(): Record<TemplateCategory, CanvasTemplate[]> {
  const grouped: Record<TemplateCategory, CanvasTemplate[]> = {
    thumbnail: [],
    overlay: [],
    banner: [],
    emote: []
  }
  for (const t of CANVAS_TEMPLATES) {
    grouped[t.category].push(t)
  }
  return grouped
}
