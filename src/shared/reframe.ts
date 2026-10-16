import { cropFrameSize } from './safeZone'

/**
 * The phases a Reframe job reports (T-100). Main emits the first three on the
 * `video:reframeProgress` channel; `starting` is the panel's own word for the
 * moment between the click and main's first event.
 *
 * The panel used to print the id, upper-cased, as the row's label —
 * "ANALYZING", "RENDERING", and "STARTING" for the half-second before main
 * answered. Phase ids are never shown (the round-54 rule, and the captions
 * panel's `captionPhaseLabel` before this): a table gives each a plain label,
 * keyed by the union so a phase added in main without a label fails the
 * typecheck rather than reaching the screen as an id.
 */
export type ReframePhase = 'starting' | 'analyzing' | 'rendering' | 'done'

const PHASE_LABELS: Record<ReframePhase, string> = {
  starting: 'Starting…',
  analyzing: 'Checking the video…',
  rendering: 'Rendering…',
  done: 'Done'
}

export function reframePhaseLabel(phase: ReframePhase): string {
  return PHASE_LABELS[phase]
}

/** The size a Reframe writes: a vertical 9:16 file (the panel, the IPC call and the readout all read it from here). */
export const REFRAME_TARGET = { width: 1080, height: 1920 } as const

/**
 * The header's readout of the transform (T-125 (9)): the picture the strip is cut FROM, then what comes out. The picture is the
 * clip's crop when it has one (`cropFrameSize`, the same reading the export grid and Clip Kit judge a clip by), because the strip is
 * cut from the crop and not from the whole source - the readout used to say the source's size whatever was drawn in the player.
 * Whole pixels; a crop that is not a usable size reads as no crop.
 */
export function reframeReadout(
  sourceW: number,
  sourceH: number,
  crop: { w: number; h: number } | null | undefined
): string {
  const frame = cropFrameSize(sourceW, sourceH, crop)
  return `${Math.round(frame.w)}×${Math.round(frame.h)} → ${REFRAME_TARGET.width}×${REFRAME_TARGET.height}`
}
