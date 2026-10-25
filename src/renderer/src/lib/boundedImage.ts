import { boundedSize } from '@shared/imageBounds'

/**
 * The copy of a picture the Stream Graphics document keeps (T-137 (6), (10)).
 *
 * The document is JSON, so a picture on the canvas is a data URL, and it is written whole by every autosave and every Save. ImportPanel used to keep the
 * file's own full-size data URL (four 11 MB PNGs were a project nobody could open again), and "to Canvas" kept the URL of a cached thumbnail - a file
 * that Clear thumbnail cache, and the launch sweep after a board item was deleted, remove. Both now draw the picture through an offscreen canvas at a bounded
 * size and keep that.
 */

/** JPEG quality of an opaque photo's copy: visually the same picture, a tenth of the PNG's bytes. */
const JPEG_QUALITY = 0.92

/**
 * Decode a picture so it can be drawn. `crossOrigin: 'anonymous'` for a picture that is fetched (a mood-board thumbnail's source), so the canvas it is
 * drawn on is not tainted: a picture whose server does not allow it fails to LOAD here, as it already did for the layer that drew it.
 *
 * T-138: and no referrer, whatever the address. PRODUCT_GUIDE promises a thumbnail is fetched without telling its host where from, and the two `<img>` that
 * draw one (ReferencePanel, MoodBoardPanel) say `referrerPolicy="no-referrer"`; this is the third place an `Image` fetches one (the mood-board tile whose cached
 * file is gone falls back to the address it came from), so it holds the promise by construction. Set before `src`, which is what starts the request.
 */
export function loadImage(src: string, crossOrigin?: 'anonymous'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Decode failed'))
    img.src = src
  })
}

/** True when no pixel of `ctx`'s `width` x `height` canvas is even partly transparent. */
function isOpaque(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = ctx.getImageData(0, 0, width, height).data
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) return false
  return true
}

/**
 * `img` drawn at a size within `maxDim` on its longer side (the aspect kept, never enlarged), as a data URL. PNG, which keeps transparency; JPEG only when
 * `jpegIfOpaque` is set AND every pixel is opaque (a photo: the canvas would paint a transparent one black). Throws when the browser cannot make the canvas.
 */
export function boundedDataUrl(img: HTMLImageElement, maxDim: number, jpegIfOpaque: boolean): string {
  const { width, height } = boundedSize(img.naturalWidth, img.naturalHeight, maxDim)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: jpegIfOpaque })
  if (!ctx) throw new Error('No canvas')
  ctx.drawImage(img, 0, 0, width, height)
  return jpegIfOpaque && isOpaque(ctx, width, height) ? canvas.toDataURL('image/jpeg', JPEG_QUALITY) : canvas.toDataURL('image/png')
}
