/**
 * The size a picture is kept at on the Stream Graphics canvas (T-137 (6), (10)).
 *
 * A picture dropped on the canvas used to keep its full-size data URL in the document though the layer is first drawn at most 800 px wide, so four
 * 11 MB PNGs put a project over the 50 MiB size limit on their own (autosave stopped, Save wrote a file Open refused). The document now keeps a copy
 * bounded to `STORED_IMAGE_MAX_DIM` on its longer side, and a mood-board reference is embedded at the size it is drawn.
 */

/** The longest side a picture is DRAWN at when it is first placed on the canvas (px of the document). */
export const LAYER_DRAWN_MAX_DIM = 800

/**
 * The longest side of the copy the document keeps for an imported picture: twice the size it is drawn at, because the Export panel defaults a HiDPI
 * screen to a 2x export (`defaultExportScale`) and a placed picture exported there is exactly 2x its drawn size. Anything smaller is upscaled in the
 * file the person posts; anything larger is bytes in every autosave for pixels nothing shows.
 */
export const STORED_IMAGE_MAX_DIM = 2 * LAYER_DRAWN_MAX_DIM

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
