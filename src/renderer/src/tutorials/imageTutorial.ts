import type { TutorialDef } from './types'

// Copy rules: see the header of videoTutorial.ts (T-86).
export const imageTutorial: TutorialDef = {
  id: 'image',
  title: 'Stream Graphics',
  intro: 'Design thumbnails, overlays, banners, and emotes on a layered canvas.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Stream Graphics',
      body: 'Design thumbnails, Twitch overlays, banners, and emotes on a layered canvas, then export a PNG or JPG. Press the ? button in the header to replay this tour.',
      placement: 'center'
    },
    {
      id: 'import',
      title: 'Start your canvas',
      body: "Pick a template, or drop in an image, paste one with Ctrl+V, or click 'Import image'. Everything you add becomes a layer.",
      targetSelector: '[data-tutorial="image-import"]',
      placement: 'bottom'
    },
    {
      id: 'templates',
      title: 'Streamer templates',
      body: "Click 'Templates' for ready-made canvases: YouTube thumbnails and Twitch overlay frames with a webcam hole.",
      targetSelector: '[data-tutorial="image-templates"]',
      placement: 'bottom'
    },
    {
      id: 'tools',
      title: 'Tools',
      body: "Pick Select, Rect, or Ellipse here, or press V, R, or O. Click '+ More' for Line (L) and Pencil (P).",
      targetSelector: '[data-tutorial="image-toolbar"]',
      placement: 'bottom'
    },
    {
      id: 'layers',
      title: 'Layers',
      body: 'Reorder, hide, lock, duplicate, or delete layers from this panel. Click a layer to select it.',
      targetSelector: '[data-tutorial="image-layers"]',
      placement: 'left'
    },
    {
      id: 'export',
      title: 'Export',
      body: "Choose PNG or JPG and a Scale (3× is HiDPI), then click 'Export'. Every visible layer is in the picture, except the ones tagged hint or reference.",
      targetSelector: '[data-tutorial="image-export"]',
      placement: 'top'
    },
    {
      id: 'done',
      title: "You're ready",
      body: 'The ? button in the header replays this tour any time. It only points at what is on screen, so it covers more once your canvas has a layer.',
      placement: 'center'
    }
  ]
}
