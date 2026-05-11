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
 *   3. Wait for both videos to report `playing` so width/height are real.
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
  // Screen as base, stretched to canvas dimensions. Canvas was sized to
  // match the screen's natural width/height at start, so this is 1:1.
  if (screen.readyState >= 2) {
    ctx.drawImage(screen, 0, 0, canvasW, canvasH)
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
  const marginPx = opts.marginPx ?? 32

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
    await Promise.all([screenVid.play(), camVid.play()])
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

  const cornerRect = computeCornerRect(canvasW, canvasH, opts.webcamCorner, scalePct, marginPx)

  let rafHandle: number | null = null
  let running = true
  function frame(): void {
    if (!running) return
    drawFrame(ctx, screenVid, camVid, cornerRect, canvasW, canvasH)
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

/**
 * Resolves once the video element has reported `loadedmetadata` so
 * videoWidth/videoHeight are real numbers, not zero.
 */
function waitForMetadata(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (v.readyState >= 1 && v.videoWidth > 0) {
      resolve()
      return
    }
    const onReady = (): void => {
      v.removeEventListener('loadedmetadata', onReady)
      resolve()
    }
    v.addEventListener('loadedmetadata', onReady)
  })
}

/**
 * Test-only export of internal helpers. Pulled out from `startCompositor`
 * specifically so the partial-init cleanup logic can be unit-tested
 * without spinning up a real MediaStream pipeline.
 */
export const __testing__ = { teardownOffscreen }
