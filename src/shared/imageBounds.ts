/**
 * The size a picture is kept at on the Stream Graphics canvas (T-137 (6), (10)).
 *
 * A picture dropped on the canvas used to keep its full-size data URL in the document though the layer is first drawn at most 800 px wide, so four
 * 11 MB PNGs put a project over the 50 MiB size limit on their own (autosave stopped, Save wrote a file Open refused). The document now keeps a copy
 * bounded to `storedImageMaxDim` of the document it is placed on (T-138 (2); never under `STORED_IMAGE_MAX_DIM`), and a mood-board reference is
 * embedded at the size it is drawn.
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
