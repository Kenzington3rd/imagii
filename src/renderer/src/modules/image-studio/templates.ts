import { nanoid } from 'nanoid'
import type { CanvasDocument, CanvasLayer } from '@shared/canvas'

export type TemplateCategory = 'thumbnail' | 'overlay' | 'banner' | 'emote'

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
    id: 'tw-banner-channel',
    name: 'Twitch · Channel banner',
    description: '1920×480 channel-page banner.',
    category: 'banner',
    doc: {
      width: 1920,
      height: 480,
      background: '#1f1d2e',
      layers: [
        rectLayer('Bg accent', 0, 0, 1920, 480, '#a78bfa', 'transparent', 0, 0),
        rectLayer('Bg dark', 0, 60, 1920, 360, '#0b0b0f', 'transparent', 0, 0),
        textLayer('Handle', 80, 140, '@yourhandle', 96, '#ffffff', 'Impact, Inter, sans-serif'),
        textLayer('Schedule', 80, 280, 'Streams: Mon · Wed · Fri · 7pm ET', 32, '#a78bfa')
      ]
    }
  },
  {
    id: 'yt-banner-channel',
    name: 'YouTube · Channel banner',
    description: '2560×1440 with safe area for all device sizes.',
    category: 'banner',
    doc: {
      width: 2560,
      height: 1440,
      background: '#0b0b0f',
      layers: [
        rectLayer('Safe area marker', 727, 545, 1106, 350, 'transparent', '#a78bfa', 2, 12),
        textLayer('Safe area hint', 760, 580, 'TV-safe area — keep text inside', 24, '#a78bfa'),
        textLayer('Channel name', 800, 700, 'YOUR\nCHANNEL', 140, '#ffffff', 'Impact, Inter, sans-serif')
      ]
    }
  },
  {
    id: 'emote-blank-112',
    name: 'Emote · 112×112 blank',
    description: 'Blank emote canvas. Export as Twitch emote pack for all 3 sizes.',
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
