/**
 * The size a picture is kept at on the Stream Graphics canvas (T-137 (6), (10)).
 *
 * A picture dropped on the canvas used to keep its full-size data URL in the document though the layer is first drawn at most 800 px wide, so four
 * 11 MB PNGs put a project over the 50 MiB size limit on their own (autosave stopped, Save wrote a file Open refused). The document now keeps a copy
 * bounded to `storedImageMaxDim` of the document it is placed on (T-138 (2); never under `STORED_IMAGE_MAX_DIM`), and a mood-board reference is
 * embedded at the size it is drawn.
 *
 * T-139: and the first placement fits the DOCUMENT (`placementFor`), and the copy has a budget in bytes (`STORED_IMAGE_MAX_BYTES`, `chooseStoredCopy`).
 */

/** The longest side a picture is DRAWN at when it is first placed on the canvas (px of the document). */
export const LAYER_DRAWN_MAX_DIM = 800

/**
 * The least the copy the document keeps for an imported picture is bounded to: twice the size it is first drawn at, because the Export panel defaults a
 * HiDPI screen to a 2x export (`defaultExportScale`) and a placed picture exported there is exactly 2x its drawn size. It is the bound on a small document
 * (an emote, a card); a larger one has `storedImageMaxDim`.
 */
export const STORED_IMAGE_MAX_DIM = 2 * LAYER_DRAWN_MAX_DIM

/**
 * The longest side of the copy the document keeps for an imported picture, for a `docWidth` x `docHeight` document (T-138 (2)): twice the document's
 * longer side, and never under `STORED_IMAGE_MAX_DIM`. A layer is freely resizable, so the size it is first DRAWN at is not the largest it is shown at: the
 * most a picture is ever exported at is when it fills the document, and a default HiDPI export is 2x that. A 1920x1080 frame on a 1920 px overlay, or a 4K
 * background on a 3840 px one, was exported from a 1600 px copy (1.2x to 2.4x upscaled); anything under this bound is upscaled in the file the person posts,
 * anything over it is bytes in every autosave for pixels nothing shows. A size that is not one (NaN, infinite, zero or negative: a project file the editor
 * never made) leaves the floor.
 */
export function storedImageMaxDim(docWidth: number, docHeight: number): number {
  if (!Number.isFinite(docWidth) || !Number.isFinite(docHeight) || docWidth <= 0 || docHeight <= 0) return STORED_IMAGE_MAX_DIM
  return Math.max(STORED_IMAGE_MAX_DIM, 2 * Math.max(docWidth, docHeight))
}

/** The factor that brings the longer side of a `width` x `height` picture down to `maxDim`; 1 when it already fits, and 1 for a size that is not one. */
export function scaleToFit(width: number, height: number, maxDim: number): number {
  const longest = Math.max(width, height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1
  return Math.min(1, maxDim / longest)
}

/** `width` x `height` brought within `maxDim` in whole pixels (a canvas size), the aspect kept, never enlarged and never under one pixel a side. */
export function boundedSize(width: number, height: number, maxDim: number): { width: number; height: number } {
  const scale = scaleToFit(width, height, maxDim)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** How far in from the document's corner a picture is first placed (px of the document), when the document has the room. */
export const PLACEMENT_MARGIN = 60

/**
 * Where, and how big, a `picWidth` x `picHeight` picture is FIRST placed on a `docWidth` x `docHeight` document (T-139 (2)).
 *
 * It was placed at `LAYER_DRAWN_MAX_DIM` at (60, 60) whatever the document, so a 512x512 file on the 112x112 emote showed a 52 px corner of itself with every
 * other handle off the stage, and the Properties panel has no size field to bring it back. The drawn size is also bounded by the document (the aspect kept,
 * never enlarged) and the position stays inside it: 60 px in when the document has the room, less (down to the edge) when it does not. A size that is not one
 * (a project file the editor never made, an image that decoded with no size) leaves the old placement: the 800 px bound alone, at (60, 60).
 */
export function placementFor(picWidth: number, picHeight: number, docWidth: number, docHeight: number): { x: number; y: number; width: number; height: number } {
  const isSize = (w: number, h: number): boolean => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  const scale = scaleToFit(picWidth, picHeight, LAYER_DRAWN_MAX_DIM)
  if (!isSize(picWidth, picHeight) || !isSize(docWidth, docHeight)) {
    return { x: PLACEMENT_MARGIN, y: PLACEMENT_MARGIN, width: picWidth * scale, height: picHeight * scale }
  }
  const fit = Math.min(scale, docWidth / picWidth, docHeight / picHeight)
  // (the Math.min against the document: width * (docWidth / width) is not always exactly docWidth in floating point)
  const width = Math.min(picWidth * fit, docWidth)
  const height = Math.min(picHeight * fit, docHeight)
  return {
    x: Math.max(0, Math.min(PLACEMENT_MARGIN, docWidth - width)),
    y: Math.max(0, Math.min(PLACEMENT_MARGIN, docHeight - height)),
    width,
    height
  }
}

/**
 * The most data URL characters the copy of ONE imported picture may be (T-139 (4)): 16 MiB, a third of the project's 50 MiB limit.
 *
 * `storedImageMaxDim` bounds the copy's PIXELS, not its bytes, and only a JPEG source was re-encoded as one: a 9000x6000 PNG on the 4K overlay became a 54 MB data
 * URL (incompressible pixels are 4 bytes of PNG each, then 4/3 in base64) and paused autosave at once, with a project of one picture. Three such pictures are
 * still a project that saves.
 */
export const STORED_IMAGE_MAX_BYTES = 16 * 1024 * 1024

/** What a bound is multiplied by when the copy it made is still over the budget: a quarter off the side, a little under half the pixels. */
const STORED_IMAGE_STEP = 0.75

/**
 * The bound to try after a copy bounded to `maxDim` came out over the budget: three quarters of it in whole pixels, always smaller, never under 1 px. `null`
 * at 1 px (nothing smaller is a picture) and for a bound that is not one.
 */
export function nextStoredDim(maxDim: number): number | null {
  if (!Number.isFinite(maxDim) || maxDim <= 1) return null
  return Math.max(1, Math.floor(maxDim * STORED_IMAGE_STEP))
}

/** What `chooseStoredCopy` needs of a picture: its size, its file, and the two things that can be done with its pixels. */
export interface StoredCopySource {
  /** The picture's longer side, in pixels. */
  longest: number
  /** `storedImageMaxDim` of the document it lands on: where the first copy is bounded (T-138 (2)). */
  startDim: number
  /** The file as it came, as a data URL. */
  asCame: string
  /** The file is a JPEG: when it is also opaque, its copy stays one. */
  cameAsJpeg: boolean
  /** Is every pixel opaque? Asked at most once, and only when a copy is over the budget or a JPEG source's has to be made. */
  opaque: () => boolean
  /** The picture drawn within `maxDim` on its longer side and encoded as a JPEG (`jpeg`) or a PNG, as a data URL. */
  encode: (maxDim: number, jpeg: boolean) => string
  /** The budget, in data URL characters; `STORED_IMAGE_MAX_BYTES` unless a test says otherwise. */
  maxBytes?: number
}

/**
 * The copy of an imported picture the document keeps: the first of these that fits the byte budget (T-139 (4)).
 *
 *   1. T-138 (2)'s copy - the file as it came when it is within the bound, else a copy bounded to it (a PNG, or a JPEG when the file is one and is opaque).
 *   2. An opaque picture, if that was not already a JPEG: a JPEG at the SAME bound (a photo's JPEG is a tenth of its PNG).
 *   3. The bound steps down (`nextStoredDim`) as a JPEG if the picture is opaque and a PNG if it is not, so transparency is never lost, until a copy fits.
 *
 * A picture within the pixel bound is re-encoded, not kept as it came, when its file is over the budget. Ends at one pixel with the last copy it made, which fits
 * any budget a picture can have; a budget under the size of a 1 px picture gets that picture.
 */
export function chooseStoredCopy(source: StoredCopySource): string {
  const budget = source.maxBytes ?? STORED_IMAGE_MAX_BYTES
  let asked: boolean | undefined
  const opaque = (): boolean => (asked ??= source.opaque())
  const within = !(source.longest > source.startDim)
  const firstIsJpeg = !within && source.cameAsJpeg && opaque()
  let copy = within ? source.asCame : source.encode(source.startDim, firstIsJpeg)
  if (copy.length <= budget) return copy
  // Over the budget. The bound it was made at is the picture's own size when that is smaller than the document's.
  const bound = Math.min(source.startDim, source.longest)
  const jpeg = opaque()
  if (jpeg && !firstIsJpeg) {
    copy = source.encode(bound, true)
    if (copy.length <= budget) return copy
  }
  for (let dim = nextStoredDim(bound); dim !== null; dim = nextStoredDim(dim)) {
    copy = source.encode(dim, jpeg)
    if (copy.length <= budget) return copy
  }
  return copy
}
