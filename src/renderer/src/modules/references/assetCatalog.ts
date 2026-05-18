import { nanoid } from 'nanoid'
import type { CanvasDocument, CanvasLayer } from '@shared/canvas'
import type { IconName } from '../../components/Icon'

/**
 * Curated catalog of CC0 / public-domain assets shipped with imagii.
 *
 * **All assets in this catalog are imagii-authored** and released into
 * the public domain (CC0). They're stored as Konva canvas documents
 * (the same format as the Image Canvas template engine) so they:
 *   - render to a tiny preview in the asset library tab
 *   - drop directly into the Stream Graphics editor when picked
 *   - cost zero bytes of bundled binary assets (no PNG/MP3 bloat)
 *
 * If we ever ship third-party CC0 assets, EACH ONE must include a
 * verified license citation in the `license` field and a working
 * attribution URL. Untrusted "found on the internet" assets do NOT
 * belong in this catalog.
 */

export type AssetCategory =
  | 'overlay-frame'
  | 'lower-third'
  | 'scene-card'
  | 'social-card'

export interface CatalogAsset {
  id: string
  name: string
  description: string
  category: AssetCategory
  license: 'CC0 (imagii-authored)' | string
  doc: CanvasDocument
}

function rect(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
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
    width: w,
    height: h,
    fill,
    stroke,
    strokeWidth,
    cornerRadius
  }
}

function txt(
  name: string,
  x: number,
  y: number,
  text: string,
  fontSize: number,
  fill = '#ffffff',
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

export const ASSET_CATALOG: CatalogAsset[] = [
  // ---- Overlay frames (transparent 1920x1080) ----
  {
    id: 'frame-clean-corner',
    name: 'Clean corner frame',
    description: 'Subtle 8px gradient bar across top + bottom-left handle slot.',
    category: 'overlay-frame',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 1920,
      height: 1080,
      background: 'transparent',
      layers: [
        rect('Top bar', 0, 0, 1920, 8, '#a78bfa'),
        rect('Bottom bar', 0, 1072, 1920, 8, '#a78bfa'),
        rect('Handle slot', 48, 980, 320, 72, 'rgba(11,11,15,0.78)', '#a78bfa', 2, 10),
        txt('Handle', 64, 1000, '@yourhandle', 32, '#ffffff')
      ]
    }
  },
  {
    id: 'frame-just-chatting',
    name: 'Just-chatting frame',
    description: 'Big webcam window with a chat-overlay strip on the right.',
    category: 'overlay-frame',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 1920,
      height: 1080,
      background: 'transparent',
      layers: [
        rect('Webcam frame', 60, 60, 1180, 960, 'transparent', '#a78bfa', 6, 24),
        rect('Chat strip', 1280, 60, 580, 960, 'rgba(11,11,15,0.55)', '#a78bfa', 2, 16),
        txt('Chat hint', 1310, 100, 'CHAT', 36, '#a78bfa')
      ]
    }
  },

  // ---- Lower thirds ----
  {
    id: 'lower-third-clean',
    name: 'Clean lower-third',
    description: 'Single-line name plate with role subtitle. Drop into recordings.',
    category: 'lower-third',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 1920,
      height: 1080,
      background: 'transparent',
      layers: [
        rect('Plate', 80, 900, 720, 100, 'rgba(11,11,15,0.85)', '#a78bfa', 2, 14),
        txt('Name', 108, 920, 'Your Name', 38, '#ffffff'),
        txt('Role', 108, 968, 'Your role · @handle', 18, '#a78bfa')
      ]
    }
  },

  // ---- Scene cards (Be Right Back / Starting Soon / Ending) ----
  {
    id: 'scene-brb',
    name: 'BRB screen',
    description: '1920×1080 full-screen "be right back" with handle.',
    category: 'scene-card',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 1920,
      height: 1080,
      background: '#0b0b0f',
      layers: [
        rect('Accent', 0, 0, 12, 1080, '#a78bfa'),
        txt('Brb', 200, 380, 'BE RIGHT BACK', 140, '#ffffff', 'Impact, Inter, sans-serif'),
        txt('Sub', 200, 560, "Grabbing a coffee — back in a few.", 36, '#9595a5'),
        txt('Handle', 200, 980, '@yourhandle', 28, '#a78bfa')
      ]
    }
  },
  {
    id: 'scene-starting-soon',
    name: 'Starting soon',
    description: 'Pre-stream waiting screen with a countdown placeholder.',
    category: 'scene-card',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 1920,
      height: 1080,
      background: '#1f1d2e',
      layers: [
        txt('Title', 200, 380, 'STARTING SOON', 130, '#ffffff', 'Impact, Inter, sans-serif'),
        txt('Sub', 200, 540, 'Stretch, grab water, settle in.', 36, '#a78bfa'),
        rect('CountdownBg', 200, 660, 360, 120, 'rgba(167,139,250,0.18)', '#a78bfa', 2, 14),
        txt('Countdown', 240, 690, '0:00', 80, '#a78bfa', 'Impact, Inter, sans-serif')
      ]
    }
  },
  {
    id: 'scene-ending',
    name: 'Stream ending',
    description: 'Goodbye screen with thank-you + socials placeholder.',
    category: 'scene-card',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 1920,
      height: 1080,
      background: '#0b0b0f',
      layers: [
        txt('Thanks', 200, 360, 'THANKS FOR HANGING OUT', 100, '#ffffff', 'Impact, Inter, sans-serif'),
        txt('Sub', 200, 500, 'See you next stream.', 36, '#9595a5'),
        rect('Socials', 200, 720, 800, 120, 'rgba(167,139,250,0.12)', '#a78bfa', 2, 14),
        txt('SocialsText', 232, 752, 'Twitch · YouTube · X · TikTok — @yourhandle', 28, '#a78bfa')
      ]
    }
  },

  // ---- HiDPI overlay variants (2K + 4K for high-res streams) ----
  {
    id: 'frame-clean-corner-2k',
    name: 'Clean corner frame (2K)',
    description: '2560×1440 transparent — same as the 1080p version, sharper for 1440p streams.',
    category: 'overlay-frame',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 2560,
      height: 1440,
      background: 'transparent',
      layers: [
        rect('Top bar', 0, 0, 2560, 11, '#a78bfa'),
        rect('Bottom bar', 0, 1429, 2560, 11, '#a78bfa'),
        rect('Handle slot', 64, 1307, 427, 96, 'rgba(11,11,15,0.78)', '#a78bfa', 3, 14),
        txt('Handle', 85, 1333, '@yourhandle', 42, '#ffffff')
      ]
    }
  },
  {
    id: 'frame-clean-corner-4k',
    name: 'Clean corner frame (4K)',
    description: '3840×2160 transparent — for 4K capture pipelines / YouTube re-uploads.',
    category: 'overlay-frame',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 3840,
      height: 2160,
      background: 'transparent',
      layers: [
        rect('Top bar', 0, 0, 3840, 16, '#a78bfa'),
        rect('Bottom bar', 0, 2144, 3840, 16, '#a78bfa'),
        rect('Handle slot', 96, 1960, 640, 144, 'rgba(11,11,15,0.78)', '#a78bfa', 4, 20),
        txt('Handle', 128, 2000, '@yourhandle', 64, '#ffffff')
      ]
    }
  },

  // ---- Social cards (1080×1080 square for IG/Twitter previews) ----
  {
    id: 'social-square-clip',
    name: 'Square clip card',
    description: '1080×1080 — title bar + 9:16 video well placeholder.',
    category: 'social-card',
    license: 'CC0 (imagii-authored)',
    doc: {
      width: 1080,
      height: 1080,
      background: '#16161e',
      layers: [
        rect('Title bar', 0, 0, 1080, 140, '#a78bfa'),
        txt('Title', 60, 40, 'CLIP TITLE HERE', 60, '#0b0b0f', 'Impact, Inter, sans-serif'),
        rect('Video well', 280, 200, 520, 800, 'rgba(167,139,250,0.10)', '#a78bfa', 4, 16),
        txt('Hint', 350, 580, 'Drop clip here', 32, '#a78bfa')
      ]
    }
  }
]

export function getAssetsByCategory(): Record<AssetCategory, CatalogAsset[]> {
  const grouped: Record<AssetCategory, CatalogAsset[]> = {
    'overlay-frame': [],
    'lower-third': [],
    'scene-card': [],
    'social-card': []
  }
  for (const a of ASSET_CATALOG) grouped[a.category].push(a)
  return grouped
}

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  'overlay-frame': 'Overlay frames',
  'lower-third': 'Lower thirds',
  'scene-card': 'Scene cards',
  'social-card': 'Social cards'
}

/**
 * Icon name per asset category. Kept parallel to ASSET_CATEGORY_LABELS
 * so the Asset Library can render `<Icon> + label` instead of an emoji
 * baked into the label string. See docs/STYLE_GUIDE.md (no emoji rule).
 * The values are `IconName`s from components/Icon.tsx.
 */
export const ASSET_CATEGORY_ICONS: Record<AssetCategory, IconName> = {
  'overlay-frame': 'overlay-frame',
  'lower-third': 'lower-third',
  'scene-card': 'scene-card',
  'social-card': 'social-card'
}
