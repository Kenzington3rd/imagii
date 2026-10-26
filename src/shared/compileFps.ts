/**
 * The rate a compilation falls back to (T-105): what it is written at when no clip's source states one. The probe reads 0 for a file that
 * does not say (a Record WebM's clock is 1000/1, which `probedFps` refuses), and a rate of 0 is not one to write a file at.
 */
export const COMPILE_FPS = 30

/**
 * The ceiling of the compilation's rate (T-130 (q)): 60. The output follows the source up to here - a 24 fps film stays 24, an OBS 60
 * stays 60 - and a faster recording (120 and 144 are real) is brought down to what YouTube and the platforms play.
 */
export const MAX_COMPILE_FPS = 60

/**
 * The frame rate a compilation is written at (T-130 (q)): the fastest of its clips' source rates, capped at `MAX_COMPILE_FPS`.
 *
 * It was `COMPILE_FPS` for everything, so a 60 fps recording lost half its frames in a montage while a platform export of the same
 * recording did not, and a 24 fps one gained duplicated frames. Every segment is written at this one rate, so the stream-copy join
 * sees one.
 *
 * The rates are numbers, not whole frames per second: an NTSC 59.94 (60000/1001) stays 59.94 - it is not rounded to 60, and the cap
 * is a numeric `min`, so 59.99 is kept and 60.01 becomes 60. A rate that is not a positive finite number says nothing (0 is the
 * probe's "the file does not state one", NaN and a negative are damage) and does not pull the others down; when NO clip says one,
 * the answer is `COMPILE_FPS`.
 */
export function compileFps(sourceRates: readonly number[]): number {
  let fastest = 0
  for (const rate of sourceRates) {
    if (Number.isFinite(rate) && rate > fastest) fastest = rate
  }
  return fastest > 0 ? Math.min(fastest, MAX_COMPILE_FPS) : COMPILE_FPS
}
