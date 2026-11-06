import { assert } from '@shared/assert'

/**
 * Composites screen + webcam streams into a single MediaStream the
 * MediaRecorder can consume. Without this, the "show webcam" toggle was
 * preview-only — the recorded file contained the screen without the
 * webcam, which surprised every user who tried it.
 *
 * Architecture:
 *   1. Mount two offscreen <video> elements for the input streams. We
 *      need actual HTMLVideoElement instances because canvas.drawImage()
 *      accepts those but not MediaStreams directly.
 *   2. Create a hidden canvas at the screen's natural resolution.
 *   3. Start both videos and wait for each to show its first picture (`play()` on a stream stays pending until the first frame) and
 *      report its metadata, so width/height are real. Each wait ends at the same 10 s limit: a source that sends no picture rejects
 *      with a `NoPictureError` naming it, instead of leaving the setup pending.
 *   4. Start a requestAnimationFrame loop drawing screen-full + webcam-corner.
 *   5. canvas.captureStream(fps) returns a MediaStream the recorder uses.
 *
 * Returns a handle with stop() that tears everything down — cancels rAF,
 * stops the offscreen videos, and ends the canvas tracks. Callers MUST
 * call stop() when recording ends; otherwise the canvas keeps drawing
 * and the input streams stay open.
 *
 * Audio mixing is the caller's concern — this module is video-only.
 */

/**
 * A source that opened but sent no picture within START_TIMEOUT_MS. The message is a finished sentence (userFacingError keeps one
 * whole), so a toast can show it as it is. `source` lets the caller tell a camera (the take can go on without it) from the screen
 * (it cannot).
 */
export class NoPictureError extends Error {
  constructor(readonly source: 'camera' | 'screen') {
    super(
      source === 'camera'
        ? 'The camera sent no picture for 10 seconds.'
        : 'The screen capture sent no picture for 10 seconds. Pick another screen or window, then press Start again.'
    )
    this.name = 'NoPictureError'
  }
}

export type WebcamCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface CompositorOptions {
  screenStream: MediaStream
  webcamStream: MediaStream
  webcamCorner: WebcamCorner
  /** Webcam width as a fraction of canvas width (0..1). Default 0.2. */
  webcamScalePct?: number
  /** Frame rate of the composited output. Default 30. */
  fps?: number
  /** Margin in pixels between the webcam and the nearest edges. Default 32. */
  marginPx?: number
}

export interface CompositorHandle {
  /** Video-only MediaStream — combine with audio at the call site. */
  outputStream: MediaStream
  stop: () => void
}

interface CornerRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Pure geometry. Returns the rectangle the webcam should be drawn into,
 * given the canvas size and the user's corner preference. Exported so it
 * can be unit-tested without a DOM.
 */
export function computeCornerRect(
  canvasW: number,
  canvasH: number,
  corner: WebcamCorner,
  scalePct: number,
  marginPx: number
): CornerRect {
  assert(canvasW > 0 && canvasH > 0, 'canvas dimensions must be positive')
  assert(scalePct > 0 && scalePct <= 1, 'scalePct must be in (0, 1]')

  // Webcam stream aspect varies; assume 16:9 for layout math. The actual
  // drawImage call below uses the cam video's intrinsic ratio so faces
  // aren't stretched — this rect is just the bounding box.
  const camW = Math.max(64, Math.round(canvasW * scalePct))
  const camH = Math.round(camW * (9 / 16))
  const safeMargin = Math.max(0, marginPx)
  const x =
    corner === 'top-right' || corner === 'bottom-right'
      ? canvasW - camW - safeMargin
      : safeMargin
  const y =
    corner === 'bottom-left' || corner === 'bottom-right'
      ? canvasH - camH - safeMargin
      : safeMargin
  return { x, y, w: camW, h: camH }
}

/**
 * Pure geometry (T-153 (10)). The rectangle a `srcW` x `srcH` picture fills when it is fitted INSIDE a `canvasW` x `canvasH` canvas
 * without distortion (contain): scaled to the smaller of the two ratios, centred, the rest left for black bars. The same aspect is
 * the full canvas, a wider picture has bars above and below, a taller one beside. A picture with no size yet (a video element
 * that has not reported one) falls back to the full canvas, which is what the compositor drew before.
 */
export function computeContainRect(srcW: number, srcH: number, canvasW: number, canvasH: number): CornerRect {
  assert(canvasW > 0 && canvasH > 0, 'canvas dimensions must be positive')
  if (!(srcW > 0 && srcH > 0)) return { x: 0, y: 0, w: canvasW, h: canvasH }
  const scale = Math.min(canvasW / srcW, canvasH / srcH)
  const w = Math.min(canvasW, Math.round(srcW * scale))
  const h = Math.min(canvasH, Math.round(srcH * scale))
  return { x: Math.round((canvasW - w) / 2), y: Math.round((canvasH - h) / 2), w, h }
}

/**
 * Drawing helper used inside the rAF loop. Pulled out for clarity + tests.
 * The aspect-preserve logic keeps the webcam from being stretched even
 * when the source camera's native aspect differs from 16:9.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  screen: HTMLVideoElement,
  webcam: HTMLVideoElement | null,
  cornerRect: CornerRect,
  canvasW: number,
  canvasH: number
): void {
  // Screen as base, fitted into the fixed canvas by its size RIGHT NOW (T-153 (10)). The canvas is pinned at the size the screen
  // had at start; a window source resized mid-take reports a new videoWidth/videoHeight, and a stretch to the canvas recorded the
  // rest of the take distorted. At the start size this is the full canvas (1:1); otherwise it is centred with black bars.
  if (screen.readyState >= 2) {
    const fit = computeContainRect(screen.videoWidth, screen.videoHeight, canvasW, canvasH)
    if (fit.w < canvasW || fit.h < canvasH) {
      // Bars: clear what an earlier, larger frame left under them. (A full-canvas draw covers everything, so it needs no clear.)
      ctx.fillStyle = 'black' // the bars of a video's letterbox, not a palette color
      ctx.fillRect(0, 0, canvasW, canvasH)
    }
    ctx.drawImage(screen, fit.x, fit.y, fit.w, fit.h)
  }
  if (!webcam || webcam.readyState < 2) return

  // Preserve aspect inside the cornerRect bounding box.
  const camNatW = webcam.videoWidth || 16
  const camNatH = webcam.videoHeight || 9
  const camRatio = camNatW / camNatH
  const boxRatio = cornerRect.w / cornerRect.h
  let drawW = cornerRect.w
  let drawH = cornerRect.h
  if (camRatio > boxRatio) {
    // Cam is wider than box → fit by width
    drawH = Math.round(cornerRect.w / camRatio)
  } else {
    drawW = Math.round(cornerRect.h * camRatio)
  }
  const dx = cornerRect.x + Math.round((cornerRect.w - drawW) / 2)
  const dy = cornerRect.y + Math.round((cornerRect.h - drawH) / 2)
  ctx.drawImage(webcam, dx, dy, drawW, drawH)
}

/**
 * Tear down the offscreen video elements created during setup. Used both
 * by the normal stop() path and by the partial-init catch in
 * startCompositor — if any step between `appendChild` and the final
 * `return` throws, we still want the offscreen videos removed from the
 * DOM. Without this, a setup failure leaves zombie elements consuming
 * the input MediaStream tracks until the page unloads.
 */
function teardownOffscreen(elements: HTMLVideoElement[]): void {
  for (const v of elements) {
    try {
      v.pause()
      v.srcObject = null
    } catch {
      /* element already detached */
    }
    if (v.parentNode) v.parentNode.removeChild(v)
  }
}

/**
 * Spin up the compositor. Resolves once both videos are playing and the
 * canvas dimensions are pinned to the screen's natural size. Callers must
 * invoke handle.stop() on recording stop.
 *
 * On partial-init failure (any throw between appendChild and the final
 * return) we tear down the offscreen videos before propagating the
 * error — see teardownOffscreen above. Callers still own the input
 * MediaStream tracks; this function does NOT stop them, since the caller
 * may want to fall back to a screen-only path with the same screenStream.
 */
export async function startCompositor(opts: CompositorOptions): Promise<CompositorHandle> {
  assert(opts.screenStream !== null && opts.screenStream !== undefined, 'screenStream required')
  assert(opts.webcamStream !== null && opts.webcamStream !== undefined, 'webcamStream required')
  const fps = opts.fps ?? 30
  const scalePct = opts.webcamScalePct ?? 0.2
  // marginPx is computed AFTER we know canvasW (see below). The override
  // path (caller passed an explicit marginPx) skips the computation.
  const explicitMargin = opts.marginPx

  // Offscreen video elements as the bridge from MediaStream to drawImage.
  // We append them to body with display:none so they actually decode —
  // some browsers won't decode a fully-detached element.
  const screenVid = document.createElement('video')
  screenVid.srcObject = opts.screenStream
  screenVid.muted = true
  screenVid.playsInline = true
  screenVid.style.display = 'none'
  document.body.appendChild(screenVid)

  const camVid = document.createElement('video')
  camVid.srcObject = opts.webcamStream
  camVid.muted = true
  camVid.playsInline = true
  camVid.style.display = 'none'
  document.body.appendChild(camVid)

  // Setup phase: anything that can throw goes inside this try so the
  // offscreen <video> elements are torn down on failure. Without this,
  // a thrown play()/waitForMetadata/getContext leaves them attached to
  // document.body, still consuming the input MediaStreams indefinitely.
  let canvasW: number
  let canvasH: number
  let ctx: CanvasRenderingContext2D
  let canvas: HTMLCanvasElement
  try {
    await Promise.all([playWithin(screenVid, 'screen'), playWithin(camVid, 'camera')])
    await waitForMetadata(screenVid)
    await waitForMetadata(camVid)

    canvasW = screenVid.videoWidth
    canvasH = screenVid.videoHeight
    assert(canvasW > 0 && canvasH > 0, 'screen video reported zero dimensions')

    canvas = document.createElement('canvas')
    canvas.width = canvasW
    canvas.height = canvasH
    const ctxMaybe = canvas.getContext('2d')
    assert(ctxMaybe !== null, 'canvas 2d context unavailable')
    ctx = ctxMaybe
  } catch (err) {
    teardownOffscreen([screenVid, camVid])
    throw err
  }

  // Resolution-adaptive margin: 1% of canvas width (≥16 px floor) means
  // ~13 px on 720p, ~19 px on 1080p, ~26 px on 1440p, ~38 px on 4K.
  // Without this, a fixed 32 px sat too close to the edge on 4K but
  // too far on 720p. Caller can still override via opts.marginPx.
  const marginPx = explicitMargin ?? Math.max(16, Math.round(canvasW * 0.01))
  const cornerRect = computeCornerRect(canvasW, canvasH, opts.webcamCorner, scalePct, marginPx)

  let rafHandle: number | null = null
  let running = true
  // T-155 (bt) / T-156 (1): `captureStream(fps)` keeps at most `fps` frames a second, but rAF ticks at the display's rate (144 Hz drew four
  // frames for every one kept). A tick that is not yet due draws nothing and still re-arms. The schedule keeps its PHASE (`nextDueMs` steps
  // by one interval, it is not re-anchored to the draw), so the average is `fps` on any display at or above it: re-anchoring on the draw
  // floored the rate to the first refresh tick past the interval (25 fps on 75 or 100 Hz). The 2 ms is the tick's jitter, so a display that
  // is an exact multiple of `fps` is not read as "too early" every other tick. A tick more than one interval late (a stall, a hidden tab)
  // resyncs to `now` instead of bursting to catch up.
  const intervalMs = 1000 / fps
  let nextDueMs = -Infinity
  function frame(now: DOMHighResTimeStamp): void {
    if (!running) return
    if (now >= nextDueMs - 2) {
      drawFrame(ctx, screenVid, camVid, cornerRect, canvasW, canvasH)
      nextDueMs = now - nextDueMs > intervalMs ? now + intervalMs : nextDueMs + intervalMs
    }
    rafHandle = requestAnimationFrame(frame)
  }
  rafHandle = requestAnimationFrame(frame)

  const outputStream = canvas.captureStream(fps)

  function stop(): void {
    if (!running) return
    running = false
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
    teardownOffscreen([screenVid, camVid])
    outputStream.getTracks().forEach((t) => t.stop())
  }

  return { outputStream, stop }
}

/** Max wait for a source's first picture (`play()`) or its metadata before we give up. */
const START_TIMEOUT_MS = 10000

/**
 * `v.play()` on a MediaStream-backed video stays pending until the first frame arrives, so a source that opens and sends nothing
 * would leave `startCompositor` pending for good. Races it against START_TIMEOUT_MS; on the limit it rejects with a NoPictureError
 * naming `who`. The timer is cleared on either outcome.
 */
function playWithin(v: HTMLVideoElement, who: 'camera' | 'screen'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new NoPictureError(who)), START_TIMEOUT_MS)
    v.play().then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * Resolves once the video element has reported `loadedmetadata` so
 * videoWidth/videoHeight are real numbers, not zero. Rejects after
 * START_TIMEOUT_MS so a stream that produces a track but never emits
 * `loadedmetadata` cannot leave `startCompositor` pending forever — the
 * setup-phase try/catch then runs `teardownOffscreen` and propagates.
 * (A source that never sends a picture is caught earlier, by `playWithin`.)
 */
function waitForMetadata(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 1 && v.videoWidth > 0) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = (): void => {
      v.removeEventListener('loadedmetadata', onReady)
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const onReady = (): void => {
      cleanup()
      resolve()
    }
    timer = setTimeout(() => {
      cleanup()
      reject(new Error(`video metadata did not arrive within ${START_TIMEOUT_MS} ms`))
    }, START_TIMEOUT_MS)
    v.addEventListener('loadedmetadata', onReady)
  })
}

/**
 * Test-only export of internal helpers. Pulled out from `startCompositor`
 * specifically so the partial-init cleanup logic can be unit-tested
 * without spinning up a real MediaStream pipeline.
 */
export const __testing__ = { teardownOffscreen }
