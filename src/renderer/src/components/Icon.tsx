import type { JSX } from 'react'

/**
 * imagii icon system.
 *
 * A single, self-contained inline-SVG icon set. Replaces emoji pictographs
 * throughout the UI so the app renders identically on every OS (emoji
 * glyphs differ between Windows / macOS / Linux and between Windows
 * versions) and so every icon shares one visual language: 24×24 viewBox,
 * 2px strokes, round caps/joins, `currentColor` fill/stroke so an icon
 * inherits the text color of its context.
 *
 * Usage:
 *   <Icon name="record" />                 // 1em, inherits color
 *   <Icon name="save" size={16} />         // explicit pixel size
 *   <Icon name="warning" className="text-rose-300" />
 *
 * Adding an icon: add a key to ICON_PATHS with the raw inner SVG markup
 * (paths drawn in a 24×24 coordinate space). Keep strokes at 2px and use
 * `currentColor`. Never add an emoji to the UI — see docs/STYLE_GUIDE.md.
 */

export type IconName =
  | 'record'
  | 'video'
  | 'audio'
  | 'image'
  | 'sparkle'
  | 'save'
  | 'folder-open'
  | 'trash'
  | 'undo'
  | 'redo'
  | 'overlay-frame'
  | 'lower-third'
  | 'scene-card'
  | 'social-card'
  | 'thumbnail'
  | 'banner'
  | 'emote'
  | 'palette'
  | 'bolt'
  | 'warning'
  | 'check'
  | 'heart'
  | 'star'
  | 'home'
  | 'arrow-left'
  | 'arrow-right'
  | 'cursor'
  | 'square'
  | 'circle'
  | 'line'
  | 'pencil'
  | 'folder'
  | 'microphone'
  | 'download'
  | 'chat'
  | 'search'
  | 'film'
  | 'gear'
  | 'shield'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'clipboard'
  | 'phone'
  | 'package'
  | 'close'
  | 'play'
  | 'pause'
  | 'step-back'
  | 'step-forward'
  | 'copy'
  | 'unlock'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'refresh'
  | 'spinner'
  | 'layers'
  | 'text'
  | 'sliders'

/**
 * Raw inner SVG markup per icon, drawn in a 24×24 coordinate space.
 * Stroke-based, 2px, `currentColor`. No fills unless the shape needs to
 * read as solid (record dot, social-card).
 */
const ICON_PATHS: Record<IconName, JSX.Element> = {
  // A solid record dot inside a thin ring.
  record: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  // Clapperboard.
  video: (
    <>
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M3 8l3-4h3l-3 4M10 8l3-4h3l-3 4M17 8l3-4" />
    </>
  ),
  // Level sliders.
  audio: (
    <>
      <path d="M6 21V14M6 10V3M12 21V12M12 8V3M18 21V16M18 12V3" />
      <path d="M3 14h6M9 8h6M15 16h6" />
    </>
  ),
  // Picture frame with a hill + sun.
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.8" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  // Four-point sparkle.
  sparkle: (
    <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" />
  ),
  // Floppy disk.
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h7V3M8 21v-7h8v7" />
    </>
  ),
  // Open folder.
  'folder-open': (
    <>
      <path d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1" />
      <path d="M3 9h17l-2 9a1 1 0 01-1 1H5a1 1 0 01-1-1z" />
    </>
  ),
  // Trash can.
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  // Counter-clockwise undo arrow.
  undo: (
    <path d="M9 14L4 9l5-5M4 9h10a6 6 0 016 6v0a6 6 0 01-6 6H7" />
  ),
  // Clockwise redo arrow.
  redo: (
    <path d="M15 14l5-5-5-5M20 9H10a6 6 0 00-6 6v0a6 6 0 006 6h7" />
  ),
  // Bracket frame — an overlay border.
  'overlay-frame': (
    <>
      <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  // A name plate / lower-third bar.
  'lower-third': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M6 15h9M6 18h5" />
    </>
  ),
  // Megaphone — scene card / announcement.
  'scene-card': (
    <>
      <path d="M4 10v4l10 5V5L4 10z" />
      <path d="M4 10H3v4h1M14 8a4 4 0 010 8" />
    </>
  ),
  // Square social card.
  'social-card': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
  // Thumbnail — image with play marker.
  thumbnail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
    </>
  ),
  // Channel banner — wide rectangle.
  banner: (
    <>
      <rect x="2" y="7" width="20" height="10" rx="2" />
      <path d="M6 11h8" />
    </>
  ),
  // Emote — smiley.
  emote: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14a4 4 0 007 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  // Artist palette.
  palette: (
    <>
      <path d="M12 3a9 9 0 000 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5S14.5 14 16 14h2a3 3 0 003-3c0-4.5-4-8-9-8z" />
      <path d="M8 9.5h.01M12 7.5h.01M16 9.5h.01" />
    </>
  ),
  // Lightning bolt.
  bolt: (
    <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />
  ),
  // Warning triangle.
  warning: (
    <>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  // Checkmark.
  check: (
    <path d="M5 13l4 4 10-10" />
  ),
  // Heart.
  heart: (
    <path d="M12 20s-7-4.5-9.5-9A5 5 0 0112 6a5 5 0 019.5 5C19 15.5 12 20 12 20z" />
  ),
  // Five-point star — "save to mood board" affordance.
  star: (
    <path d="M12 3l2.7 5.5 6 .9-4.4 4.2 1.1 6L12 17.8 6.6 19.6l1-6L3.3 9.4l6-.9L12 3z" />
  ),
  // House.
  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v10h12V10" />
    </>
  ),
  'arrow-left': (
    <path d="M19 12H5M11 18l-6-6 6-6" />
  ),
  'arrow-right': (
    <path d="M5 12h14M13 6l6 6-6 6" />
  ),
  // Mouse cursor — the Select tool.
  cursor: (
    <path d="M5 3l15 9-7 1.5L9 21 5 3z" />
  ),
  // Square — the Rectangle tool.
  square: (
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
  ),
  // Circle — the Ellipse tool.
  circle: (
    <circle cx="12" cy="12" r="8.5" />
  ),
  // Diagonal stroke — the Line tool.
  line: (
    <path d="M5 19L19 5" />
  ),
  // Pencil — the freehand Pencil tool.
  pencil: (
    <>
      <path d="M4 20l4-1L19 8a2 2 0 00-3-3L5 16l-1 4z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  // Closed folder — output-directory chips.
  folder: (
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
  ),
  // Microphone — auto-captions / transcription.
  microphone: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6" />
    </>
  ),
  // Download tray.
  download: (
    <path d="M12 4v11M8 11l4 4 4-4M5 19h14" />
  ),
  // Speech bubble — chat highlight reel.
  chat: (
    <path d="M4 5h16v11H8l-4 4V5z" />
  ),
  // Magnifier — search / output preview.
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  // Film strip — clip compilation.
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  // Gear — settings / presets.
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2l1.2 2.6 2.8-.6.5 2.8 2.6 1.2-1.4 2.5 1.4 2.5-2.6 1.2-.5 2.8-2.8-.6L12 22l-1.2-2.6-2.8.6-.5-2.8-2.6-1.2 1.4-2.5L4.3 11l2.6-1.2.5-2.8 2.8.6L12 2z" />
    </>
  ),
  // Shield — SafeSearch.
  shield: (
    <>
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  // Open eye — layer visible.
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // Crossed-out eye — layer hidden.
  'eye-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.5 9.5A3 3 0 0014.5 14.5M6.7 6.7C3.9 8.2 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.4M17.3 17.3C20.1 15.8 22 12 22 12s-3.5-7-10-7c-1 0-2 .2-2.9.5" />
    </>
  ),
  // Padlock — layer locked.
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  // Clipboard — posting helpers / checklist.
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 11h6M9 15h4" />
    </>
  ),
  // Phone — vertical / auto-reframe to 9:16.
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  // Package box — Clip Kit batch export.
  package: (
    <>
      <path d="M3 8l9-5 9 5v8l-9 5-9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  // X — close / dismiss.
  close: (
    <path d="M6 6l12 12M18 6L6 18" />
  ),
  // Play triangle.
  play: (
    <path d="M7 4l13 8-13 8V4z" fill="currentColor" stroke="none" />
  ),
  // Pause bars.
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  // Step to previous frame / start.
  'step-back': (
    <>
      <path d="M18 5L8 12l10 7V5z" fill="currentColor" stroke="none" />
      <path d="M6 4v16" />
    </>
  ),
  // Step to next frame / end.
  'step-forward': (
    <>
      <path d="M6 5l10 7-10 7V5z" fill="currentColor" stroke="none" />
      <path d="M18 4v16" />
    </>
  ),
  // Duplicate — overlapping pages.
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h8" />
    </>
  ),
  // Open padlock — layer unlocked.
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 017.9-1" />
    </>
  ),
  // Disclosure caret — collapsed (points down = expandable).
  'chevron-down': (
    <path d="M6 9l6 6 6-6" />
  ),
  // Disclosure caret — expandable (points right).
  'chevron-right': (
    <path d="M9 6l6 6-6 6" />
  ),
  // Disclosure caret — expanded (points up).
  'chevron-up': (
    <path d="M6 15l6-6 6 6" />
  ),
  // Circular refresh / reset arrow.
  refresh: (
    <path d="M20 11a8 8 0 10-2.3 6.3M20 4v7h-7" />
  ),
  // Loading spinner — an open ring (animate with `animate-spin`).
  spinner: (
    <path d="M12 3a9 9 0 109 9" />
  ),
  // Stacked layers — the layer panel.
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  // Text — text overlays.
  text: (
    <>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </>
  ),
  // Mixer sliders — levels / parameter panels.
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" />
      <circle cx="16" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="13" cy="18" r="2" fill="currentColor" stroke="none" />
    </>
  )
}

export interface IconProps {
  name: IconName
  /** Pixel size. Defaults to '1em' so the icon scales with surrounding text. */
  size?: number
  /** Extra classes — typically a text-color utility. */
  className?: string
  /** Accessible label. Omit for purely decorative icons. */
  title?: string
}

export function Icon({ name, size, className, title }: IconProps): JSX.Element {
  const dim = size ?? '1em'
  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable={false}
    >
      {title ? <title>{title}</title> : null}
      {ICON_PATHS[name]}
    </svg>
  )
}
