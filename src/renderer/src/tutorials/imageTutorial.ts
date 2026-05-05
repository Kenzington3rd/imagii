import type { TutorialDef } from './types'

export const imageTutorial: TutorialDef = {
  id: 'image',
  title: 'Image Canvas',
  intro: 'Manipulate images with layers and drawing tools.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to the Image Canvas',
      body: "A layered canvas for editing images, designing thumbnails and overlays, and exporting to PNG / JPG. Replay anytime with the ? button.",
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
      title: 'Streamer templates',
      body: "Open Templates for ready-made canvases: YouTube thumbnails and Twitch overlay frames with a webcam hole.",
      targetSelector: '[data-tutorial="image-templates"]',
      placement: 'bottom'
    },
    {
      id: 'tools',
      title: 'Step 2: Tools',
      body: "Switch tools with V (select), R (rect), O (ellipse), L (line), P (pencil). The toolbar always shows the active tool.",
      targetSelector: '[data-tutorial="image-toolbar"]',
      placement: 'bottom'
    },
    {
      id: 'layers',
      title: 'Step 3: Layers',
      body: "Reorder, hide, lock, duplicate, or delete layers from this panel. Click a layer to select it.",
      targetSelector: '[data-tutorial="image-layers"]',
      placement: 'left'
    },
    {
      id: 'export',
      title: 'Step 4: Export',
      body: "PNG or JPG with HiDPI scale. The watermark and text editing live on layers — export bakes it all together.",
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
