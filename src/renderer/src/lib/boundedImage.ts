import { STORED_IMAGE_MAX_BYTES, boundedSize, chooseStoredCopy } from '@shared/imageBounds'

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
 * draw one (ReferencePanel, MoodBoardPanel) say `referrerPolicy="no-referrer"`; this is one more place an `Image` fetches one (the mood-board tile whose cached
 * file is gone falls back to the address it came from), so it holds the promise by construction. Set before `src`, which is what starts the request. (The
 * fourth is Canvas.tsx's `useImage`, which draws a layer's `src` - ledger (g): only a project file from elsewhere makes that remote.)
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

/** `img` drawn on a canvas at a size within `maxDim` on its longer side (the aspect kept, never enlarged). Throws when the browser cannot make the canvas. */
function drawBounded(img: HTMLImageElement, maxDim: number, willReadFrequently: boolean): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } {
  const { width, height } = boundedSize(img.naturalWidth, img.naturalHeight, maxDim)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently })
  if (!ctx) throw new Error('No canvas')
  ctx.drawImage(img, 0, 0, width, height)
  return { canvas, ctx, width, height }
}

/**
 * `img` drawn at a size within `maxDim` on its longer side (the aspect kept, never enlarged), as a data URL. PNG, which keeps transparency; JPEG only when
 * `jpegIfOpaque` is set AND every pixel is opaque (a photo: the canvas would paint a transparent one black). Throws when the browser cannot make the canvas.
 */
export function boundedDataUrl(img: HTMLImageElement, maxDim: number, jpegIfOpaque: boolean): string {
  const { canvas, ctx, width, height } = drawBounded(img, maxDim, jpegIfOpaque)
  return jpegIfOpaque && isOpaque(ctx, width, height) ? canvas.toDataURL('image/jpeg', JPEG_QUALITY) : canvas.toDataURL('image/png')
}

/**
 * The copy an imported file is kept as in the document, within a byte budget (T-139 (4)): `asCame` (the file's data URL) when it is within the pixel bound
 * `startDim` and the budget, else a copy drawn at the bound (T-138 (2)) and, while that is over `maxBytes`, a JPEG of it (an opaque picture) and then the bound
 * stepped down until it fits. The order is `chooseStoredCopy`'s; this is the canvas under it. Whether the picture is opaque is read from its pixels ONCE,
 * and only when a copy is over the budget (or a JPEG source has to be made). Throws when the browser cannot make the canvas.
 */
export function storedDataUrl(img: HTMLImageElement, asCame: string, startDim: number, cameAsJpeg: boolean, maxBytes: number = STORED_IMAGE_MAX_BYTES): string {
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  return chooseStoredCopy({
    longest,
    startDim,
    asCame,
    cameAsJpeg,
    maxBytes,
    // At the size the first copy is made at (`boundedSize` never enlarges, so a picture under the bound is read at its own size): the same canvas the old single check read.
    opaque: () => {
      const { ctx, width, height } = drawBounded(img, startDim, true)
      return isOpaque(ctx, width, height)
    },
    encode: (maxDim, jpeg) => {
      const { canvas } = drawBounded(img, maxDim, false)
      return jpeg ? canvas.toDataURL('image/jpeg', JPEG_QUALITY) : canvas.toDataURL('image/png')
    }
  })
}
