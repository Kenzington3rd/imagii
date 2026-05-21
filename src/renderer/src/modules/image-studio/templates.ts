import { nanoid } from 'nanoid'
import type { CanvasDocument, CanvasLayer } from '@shared/canvas'
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
  fill = '#0b0b0f',
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
    description: '1280×720 with reaction face zone and shouty title.',
    category: 'thumbnail',
    doc: {
      width: 1280,
      height: 720,
      background: '#1f1d2e',
      layers: [
        rectLayer('Accent bar', 0, 540, 1280, 180, '#a78bfa'),
        textLayer('Title', 60, 60, 'YOUR TITLE\nHERE', 130, '#ffffff', 'Impact, Inter, sans-serif'),
        rectLayer('Face placeholder', 760, 110, 460, 460, 'rgba(167,139,250,0.18)', '#a78bfa', 4, 24),
        textLayer('Face hint', 880, 320, 'Drop face here', 36, '#a78bfa')
      ]
    }
  },
  {
    id: 'yt-thumb-clean',
    name: 'YouTube · Clean thumbnail',
    description: '1280×720, minimal layout for tutorials and explainers.',
    category: 'thumbnail',
    doc: {
      width: 1280,
      height: 720,
      background: '#0b0b0f',
      layers: [
        rectLayer('Accent stripe', 0, 0, 12, 720, '#a78bfa'),
        textLayer('Eyebrow', 80, 80, 'TUTORIAL', 36, '#a78bfa'),
        textLayer('Title', 80, 160, 'How to do\nthe thing', 110, '#ffffff'),
        textLayer('Subtitle', 80, 580, 'in 3 minutes', 48, '#9595a5')
      ]
    }
  },
  {
    id: 'tw-overlay-streamer',
    name: 'Twitch · Stream overlay',
    description: '1920×1080 transparent — webcam hole + lower-third for OBS.',
    category: 'overlay',
    doc: {
      width: 1920,
      height: 1080,
      background: 'transparent',
      layers: [
        rectLayer(
          'Facecam hole',
          1500,
          800,
          400,
          240,
          'rgba(167,139,250,0.10)',
          '#a78bfa',
          4,
          16
        ),
        textLayer('Facecam hint', 1560, 900, 'Facecam goes here', 22, '#a78bfa'),
        rectLayer('Lower third', 60, 980, 700, 80, 'rgba(11,11,15,0.85)', '#a78bfa', 2, 12),
        textLayer('Handle', 84, 1000, '@yourhandle', 36, '#ffffff'),
        textLayer('Now playing', 84, 1044, 'NOW PLAYING · Game name', 18, '#a78bfa')
      ]
    }
  },
  {
    id: 'tw-overlay-minimal',
    name: 'Twitch · Minimal overlay',
    description: '1920×1080 transparent with just a corner facecam frame.',
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
          '#a78bfa',
          5,
          12
        ),
        textLayer('Handle corner', 60, 256, '@yourhandle', 24, '#a78bfa')
      ]
    }
  },
  {
    // B8 fix (round 16): the prior 1920×480 size did not match any real
    // Twitch surface. Use 1200×480 — Twitch's "video-player banner" /
    // offline-screen surface, which is the most useful target for a
    // template featuring the wordmark + schedule. Layer coordinates
    // scaled proportionally from the prior 1920-wide layout
    // (width × 0.625) so the design still reads correctly.
    id: 'tw-banner-videoplayer',
    name: 'Twitch · Offline / video-player banner',
    description: '1200×480 video-player banner (shown when stream is offline).',
    category: 'banner',
    doc: {
      width: 1200,
      height: 480,
      background: '#1f1d2e',
      layers: [
        rectLayer('Bg accent', 0, 0, 1200, 480, '#a78bfa', 'transparent', 0, 0),
        rectLayer('Bg dark', 0, 60, 1200, 360, '#0b0b0f', 'transparent', 0, 0),
        textLayer('Handle', 50, 140, '@yourhandle', 96, '#ffffff', 'Impact, Inter, sans-serif'),
        textLayer('Schedule', 50, 280, 'Streams: Mon · Wed · Fri · 7pm ET', 32, '#a78bfa')
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
    description: '2560×1440 with both safe-area frames (all-device + TV-safe).',
    category: 'banner',
    doc: {
      width: 2560,
      height: 1440,
      background: '#0b0b0f',
      layers: [
        // All-device safe area: 1546×423 centered on 2560×1440 → offset
        // ((2560-1546)/2, (1440-423)/2) = (507, 508).
        rectLayer('All-device safe area', 507, 508, 1546, 423, 'transparent', '#a78bfa', 2, 12),
        // TV-safe minimum: 1235×338 centered → offset (662, 551).
        rectLayer('TV-safe area', 662, 551, 1235, 338, 'transparent', '#fbbf24', 2, 8),
        textLayer('Safe area hint', 695, 580, 'TV-safe — keep load-bearing text inside', 22, '#fbbf24'),
        textLayer('Channel name', 800, 700, 'YOUR\nCHANNEL', 140, '#ffffff', 'Impact, Inter, sans-serif')
      ]
    }
  },
  {
    id: 'yt-thumb-bold-2k',
    name: 'YouTube · Bold thumbnail (2K)',
    description: '2560×1440 reaction-style — same layout as the 720p variant, sharper output.',
    category: 'thumbnail',
    doc: {
      width: 2560,
      height: 1440,
      background: '#1f1d2e',
      layers: [
        rectLayer('Accent bar', 0, 1080, 2560, 360, '#a78bfa'),
        textLayer('Title', 120, 120, 'YOUR TITLE\nHERE', 260, '#ffffff', 'Impact, Inter, sans-serif'),
        rectLayer('Face placeholder', 1520, 220, 920, 920, 'rgba(167,139,250,0.18)', '#a78bfa', 6, 36),
        textLayer('Face hint', 1760, 640, 'Drop face here', 56, '#a78bfa')
      ]
    }
  },
  {
    id: 'yt-thumb-bold-4k',
    name: 'YouTube · Bold thumbnail (4K)',
    description: '3840×2160 reaction-style — same layout at 4K resolution for crisp shorts/clips.',
    category: 'thumbnail',
    doc: {
      width: 3840,
      height: 2160,
      background: '#1f1d2e',
      layers: [
        rectLayer('Accent bar', 0, 1620, 3840, 540, '#a78bfa'),
        textLayer('Title', 180, 180, 'YOUR TITLE\nHERE', 390, '#ffffff', 'Impact, Inter, sans-serif'),
        rectLayer('Face placeholder', 2280, 330, 1380, 1380, 'rgba(167,139,250,0.18)', '#a78bfa', 8, 54),
        textLayer('Face hint', 2640, 960, 'Drop face here', 84, '#a78bfa')
      ]
    }
  },
  {
    id: 'tw-overlay-streamer-2k',
    name: 'Twitch · Stream overlay (2K)',
    description: '2560×1440 transparent — facecam + lower-third, output-ready for 1440p streams.',
    category: 'overlay',
    doc: {
      width: 2560,
      height: 1440,
      background: 'transparent',
      layers: [
        rectLayer('Facecam hole', 2000, 1067, 533, 320, 'rgba(167,139,250,0.10)', '#a78bfa', 5, 21),
        textLayer('Facecam hint', 2080, 1200, 'Facecam goes here', 29, '#a78bfa'),
        rectLayer('Lower third', 80, 1307, 933, 107, 'rgba(11,11,15,0.85)', '#a78bfa', 3, 16),
        textLayer('Handle', 112, 1333, '@yourhandle', 48, '#ffffff'),
        textLayer('Now playing', 112, 1392, 'NOW PLAYING · Game name', 24, '#a78bfa')
      ]
    }
  },
  {
    id: 'tw-overlay-streamer-4k',
    name: 'Twitch · Stream overlay (4K)',
    description: '3840×2160 transparent — facecam + lower-third, for 4K capture pipelines.',
    category: 'overlay',
    doc: {
      width: 3840,
      height: 2160,
      background: 'transparent',
      layers: [
        rectLayer('Facecam hole', 3000, 1600, 800, 480, 'rgba(167,139,250,0.10)', '#a78bfa', 8, 32),
        textLayer('Facecam hint', 3120, 1800, 'Facecam goes here', 44, '#a78bfa'),
        rectLayer('Lower third', 120, 1960, 1400, 160, 'rgba(11,11,15,0.85)', '#a78bfa', 4, 24),
        textLayer('Handle', 168, 2000, '@yourhandle', 72, '#ffffff'),
        textLayer('Now playing', 168, 2088, 'NOW PLAYING · Game name', 36, '#a78bfa')
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
        ellipseLayer('Base circle', 56, 56, 50, 50, '#a78bfa', '#7c5cf0', 2)
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
        ellipseLayer('Bg', 56, 56, 50, 50, '#fbbf24', '#0b0b0f', 3),
        textLayer('Text', 22, 30, 'POG', 48, '#0b0b0f', 'Impact, Inter, sans-serif')
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
