import { describe, it, expect, beforeEach } from 'vitest'
import { globalUndo, globalRedo, globalUndoState } from './useGlobalUndo'
import { useVideoStore } from '../modules/video-studio/store/videoStore'
import { useAudioStore } from '../modules/audio-studio/state/audioStore'
import { useCanvasStore, makeRectLayer } from '../modules/image-studio/state/canvasStore'

/**
 * T-32: the cross-studio order Home's global Undo walks. The hook's React
 * half needs a DOM, but everything this ticket was about is in the
 * module-level tracker — which is exactly the point: it records studio work
 * with no component mounted at all, which is what "survives route changes"
 * means (finding B). The E2E pins the buttons in the real app
 * (tests/e2e/home-chrome.spec.ts).
 */

const PROBE = {
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  bitrate: 1_000_000,
  sizeBytes: 10_000
}

/** A loaded video, without going near window.api.video.probe. */
function giveVideoASource(): void {
  useVideoStore.setState({
    source: {
      filePath: '/tmp/global-undo.mp4',
      fileName: 'global-undo.mp4',
      url: 'file:///tmp/global-undo.mp4',
      probe: PROBE
    },
    clips: [],
    selectedClipId: null
  })
}

function editVideo(): void {
  useVideoStore.getState().addClip()
}

function editCanvas(x = 40): void {
  useCanvasStore.getState().addLayer(makeRectLayer(x, x))
}

function editAudio(gainDb: number): void {
  useAudioStore.getState().patchChain({ gainDb })
}

const layerCount = (): number => useCanvasStore.getState().doc.layers.length
const clipCount = (): number => useVideoStore.getState().clips.length

beforeEach(() => {
  // Each store's own reset empties its history, which the tracker reads as
  // "nothing in that studio is undoable any more" and clears its entries.
  useCanvasStore.getState().resetDocument()
  useAudioStore.getState().clearSource()
  useVideoStore.getState().clearSource()
  expect(globalUndoState()).toEqual({
    canUndo: false,
    canRedo: false,
    lastLabel: 'no recent change'
  })
})

describe('the tracker arms without Home being mounted', () => {
  it('records a canvas edit made while the user is in a studio', () => {
    editCanvas()
    expect(globalUndoState()).toEqual({
      canUndo: true,
      canRedo: false,
      lastLabel: 'Image Canvas'
    })
  })

  it('names each studio it tracks', () => {
    giveVideoASource()
    editVideo()
    expect(globalUndoState().lastLabel).toBe('Video Studio')
    editAudio(3)
    expect(globalUndoState().lastLabel).toBe('Audio Studio')
    editCanvas()
    expect(globalUndoState().lastLabel).toBe('Image Canvas')
  })

  it('ignores mutations that record no undo step', () => {
    giveVideoASource()
    useVideoStore.getState().setCurrentTime(4)
    useVideoStore.getState().requestSeek(2)
    useCanvasStore.getState().setTool('rect')
    useCanvasStore.getState().selectLayer(null)
    expect(globalUndoState()).toEqual({
      canUndo: false,
      canRedo: false,
      lastLabel: 'no recent change'
    })
  })

  it('forgets a studio whose history was reset under it', () => {
    editCanvas()
    expect(globalUndoState().canUndo).toBe(true)
    // A fresh document (or a new source in video/audio) invalidates every
    // step recorded against the old one.
    useCanvasStore.getState().resetDocument()
    expect(globalUndoState()).toEqual({
      canUndo: false,
      canRedo: false,
      lastLabel: 'no recent change'
    })
  })
})

describe('cross-studio ordering', () => {
  it('undoes the newest change first, whichever studio it happened in', () => {
    giveVideoASource()
    editVideo()
    editCanvas()
    expect(clipCount()).toBe(1)
    expect(layerCount()).toBe(1)

    // Newest change was the canvas one, so that is what goes first…
    expect(globalUndoState().lastLabel).toBe('Image Canvas')
    globalUndo()
    expect(layerCount()).toBe(0)
    expect(clipCount()).toBe(1)

    // …and the readout now names what the next Undo would revert.
    expect(globalUndoState()).toEqual({
      canUndo: true,
      canRedo: true,
      lastLabel: 'Video Studio'
    })
    globalUndo()
    expect(clipCount()).toBe(0)
    expect(globalUndoState().canUndo).toBe(false)
  })

  it('redoes in the mirror order', () => {
    giveVideoASource()
    editVideo()
    editCanvas()
    globalUndo()
    globalUndo()
    expect(clipCount()).toBe(0)
    expect(layerCount()).toBe(0)

    // Last undone is first redone: video, then the canvas.
    globalRedo()
    expect(clipCount()).toBe(1)
    expect(layerCount()).toBe(0)
    globalRedo()
    expect(layerCount()).toBe(1)
    expect(globalUndoState()).toEqual({
      canUndo: true,
      canRedo: false,
      lastLabel: 'Image Canvas'
    })
  })

  it('follows a studio undoing on its own (Ctrl+Z inside the studio)', () => {
    giveVideoASource()
    editVideo()
    editCanvas()
    // The studio's own button/hotkey — the tracker never hears about it
    // except through the store.
    useCanvasStore.getState().undo()
    expect(layerCount()).toBe(0)

    expect(globalUndoState().lastLabel).toBe('Video Studio')
    globalUndo()
    expect(clipCount()).toBe(0)
    // The canvas step is still redoable, and it is the older of the two.
    expect(globalUndoState().canRedo).toBe(true)
    globalRedo()
    expect(clipCount()).toBe(1)
    globalRedo()
    expect(layerCount()).toBe(1)
  })

  it('retires a studio redo when that studio records a new change', () => {
    giveVideoASource()
    editVideo()
    editCanvas()
    globalUndo()
    expect(globalUndoState().canRedo).toBe(true)

    // A new canvas step clears the canvas future, so the canvas redo is gone.
    editCanvas(90)
    expect(globalUndoState()).toEqual({
      canUndo: true,
      canRedo: false,
      lastLabel: 'Image Canvas'
    })
  })

  it('keeps the order right when a studio is at its 50-step cap', () => {
    // canvasStore keeps 50 steps: the 51st push trims the oldest, so `past`
    // stops growing and only the newest snapshot's identity says a step
    // happened at all.
    for (let i = 0; i < 50; i++) editCanvas(i)
    giveVideoASource()
    editVideo()
    expect(globalUndoState().lastLabel).toBe('Video Studio')

    editCanvas(200)
    expect(globalUndoState().lastLabel).toBe('Image Canvas')
    const layers = layerCount()
    globalUndo()
    expect(layerCount()).toBe(layers - 1)
    expect(clipCount()).toBe(1)
  })
})

describe('enablement tracks the stores', () => {
  it('turns Redo on after an undo and off once it is re-applied', () => {
    editAudio(6)
    expect(globalUndoState()).toEqual({
      canUndo: true,
      canRedo: false,
      lastLabel: 'Audio Studio'
    })
    globalUndo()
    expect(useAudioStore.getState().chain.gainDb).toBe(0)
    expect(globalUndoState().canRedo).toBe(true)
    globalRedo()
    expect(useAudioStore.getState().chain.gainDb).toBe(6)
    expect(globalUndoState()).toEqual({
      canUndo: true,
      canRedo: false,
      lastLabel: 'Audio Studio'
    })
  })

  it('does nothing when there is nothing to do', () => {
    globalUndo()
    globalRedo()
    expect(globalUndoState()).toEqual({
      canUndo: false,
      canRedo: false,
      lastLabel: 'no recent change'
    })
  })
})
