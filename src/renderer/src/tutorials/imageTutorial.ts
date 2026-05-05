import type { TutorialDef } from './types'

export const imageTutorial: TutorialDef = {
  id: 'image',
  title: 'Image Canvas',
  intro: 'Manipulate images with layers, drawing, and a color replacer.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to the Image Canvas',
      body: "A layered canvas for editing images, designing thumbnails and overlays, and exporting to PNG / JPG / SVG / PDF. Replay anytime with the ? button.",
      placement: 'center'
    },
    {
      id: 'import',
      title: 'Step 1: Get an image in',
      body: "Drag an image into this zone, paste from clipboard with Ctrl+V, or click 'Choose file…'. Each thing you import becomes a layer.",
      targetSelector: '[data-tutorial="image-import"]',
      placement: 'bottom'
    },
    {
      id: 'templates',
      title: 'New: Streamer templates',
      body: "Open Templates for ready-made canvases: YouTube thumbnails, Twitch overlay frames with a webcam hole, Twitter banners, etc.",
      targetSelector: '[data-tutorial="image-templates"]',
      placement: 'bottom'
    },
    {
      id: 'tools',
      title: 'Step 2: Tools',
      body: "Switch tools with V (select), R (rect), O (ellipse), L (line), P (pencil), C (color replace). The toolbar always shows the active tool.",
      targetSelector: '[data-tutorial="image-toolbar"]',
      placement: 'bottom'
    },
    {
      id: 'colorreplace',
      title: 'Step 3: Color replace',
      body: "Pick the Color tool, click on an image layer to grab a color, choose a replacement and tolerance, then 'Replace color'. Great for swapping a sky color or recoloring logos.",
      targetSelector: '[data-tutorial="image-colorreplace"]',
      placement: 'left'
    },
    {
      id: 'layers',
      title: 'Step 4: Layers',
      body: "Reorder, hide, lock, duplicate, or delete layers from this panel. Click a layer to select it.",
      targetSelector: '[data-tutorial="image-layers"]',
      placement: 'left'
    },
    {
      id: 'guides',
      title: 'Step 5: Grid + guides',
      body: "Toggle the grid, snap-to-grid, and add draggable horizontal/vertical rulers. Snapping pulls layers to grid lines, guides, and other edges.",
      targetSelector: '[data-tutorial="image-toolbar"]',
      placement: 'bottom'
    },
    {
      id: 'export',
      title: 'Step 6: Export',
      body: "PNG / JPG with HiDPI scale, vector SVG, or PDF at 72/150/300/600 DPI. Need Twitch emote sizes? Pick 'Emote pack' to get 28×28, 56×56, and 112×112 PNGs in one click.",
      targetSelector: '[data-tutorial="image-export"]',
      placement: 'top'
    },
    {
      id: 'done',
      title: "You're ready",
      body: "The ? button in the header reopens this tour.",
      placement: 'center'
    }
  ]
}
