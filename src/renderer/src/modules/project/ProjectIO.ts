import type { ImagiiProject, PlaceRecord } from '@shared/workspace'
import { KNOWN_ROUTES, MAX_SCHEMA_VERSION } from '@shared/projectValidation'
import { useVideoStore } from '../video-studio/store/videoStore'
import { useAudioStore } from '../audio-studio/state/audioStore'
import { useCanvasStore } from '../image-studio/state/canvasStore'
import { useReferencesStore } from '../references/state/referencesStore'

/**
 * T-47 — the route the user is on, read off the HashRouter's own hash so a
 * plain function can capture it without being a component. Anything that is
 * not one of the app's routes is dropped rather than stored, the same rule
 * the validator applies when the snapshot comes back off disk.
 */
function currentRoute(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined
  const hash = window.location.hash
  const route = hash.startsWith('#') ? hash.slice(1) : hash
  return (KNOWN_ROUTES as readonly string[]).includes(route) ? route : undefined
}

/**
 * Where the user is: route, selections, playhead. Kept separate from the
 * studio state above it because the two degrade differently on the way back
 * in — see `sanitizePlace` in shared/projectValidation.ts.
 */
function capturePlace(): PlaceRecord | undefined {
  const video = useVideoStore.getState()
  const canvas = useCanvasStore.getState()
  const place: PlaceRecord = {
    route: currentRoute(),
    videoClipId: video.selectedClipId ?? undefined,
    canvasLayerId: canvas.selectedLayerId ?? undefined,
    referencesTab: useReferencesStore.getState().tab,
    // A playhead at 0 is the default the studio opens at anyway, so it is
    // not worth a field — and omitting it keeps a fresh snapshot small.
    videoTimeSec: video.currentTime > 0 ? video.currentTime : undefined
  }
  return Object.values(place).some((v) => v !== undefined) ? place : undefined
}

export function captureProject(): ImagiiProject {
  const video = useVideoStore.getState()
  const audio = useAudioStore.getState()
  const canvas = useCanvasStore.getState()

  return {
    // Always emit MAX_SCHEMA_VERSION on save; older versions are only
    // accepted on load (with automatic migration).
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: Date.now(),
    appVersion: '1.0.0',
    place: capturePlace(),
    videoStudio: video.source
      ? {
          sourcePath: video.source.filePath,
          clips: video.clips,
          selectedClipId: video.selectedClipId,
          watermark: null,
          srtPath: video.srtPath
        }
      : undefined,
    audioStudio: audio.source
      ? {
          sourcePath: audio.source.filePath,
          fromVideoPath: audio.source.fromVideo?.videoPath ?? null,
          chain: audio.chain
        }
      : undefined,
    imageCanvas: canvas.doc.layers.length > 0 ? { doc: canvas.doc } : undefined
  }
}

/**
 * T-47 — put the user back where they were, in the stores. Everything here
 * is applied only if it still refers to something that exists: a clip id
 * from a snapshot whose clips were themselves refused would otherwise
 * select nothing and leave the studio looking broken.
 *
 * The ROUTE is deliberately not applied here — navigation belongs to the
 * component that owns the router (`AutosaveRestore`), and "Open project"
 * has no business teleporting the user to another studio.
 */
export function applyPlace(place: PlaceRecord | undefined): void {
  if (!place) return
  const video = useVideoStore.getState()
  if (place.videoClipId && video.clips.some((c) => c.id === place.videoClipId)) {
    video.selectClip(place.videoClipId)
  }
  const canvas = useCanvasStore.getState()
  if (place.canvasLayerId && canvas.doc.layers.some((l) => l.id === place.canvasLayerId)) {
    canvas.selectLayer(place.canvasLayerId)
  }
  if (place.referencesTab) useReferencesStore.getState().setTab(place.referencesTab)
  // Park the playhead through the same channel the Timeline scrubs with.
  // The Player applies it — including a Player that has not mounted yet,
  // which is the case during a restore that then navigates to /video.
  if (place.videoTimeSec !== undefined && useVideoStore.getState().source) {
    useVideoStore.getState().requestSeek(place.videoTimeSec)
  }
}

export async function applyProject(project: ImagiiProject): Promise<void> {
  // T-58 + T-47: mood boards are not carried in a project file — they are
  // their own files on disk — so there is nothing to put back here. What the
  // contract does require is that no studio comes out of a restore offering
  // to undo something: a board edit from the session being replaced is not
  // work the user did in the session they now have.
  useReferencesStore.getState().resetHistory()
  if (project.imageCanvas) {
    // resetDocument, not setDocument: restoring a snapshot is not an edit.
    // Through setDocument the restore pushed an undo step, so the app came
    // back offering to undo work the user never did — and Home's global
    // Undo would have thrown the restored canvas away in one click.
    useCanvasStore.getState().resetDocument(project.imageCanvas.doc)
  }
  if (project.videoStudio?.sourcePath) {
    await useVideoStore.getState().loadSource(project.videoStudio.sourcePath)
    if (project.videoStudio.clips.length > 0) {
      useVideoStore.setState({
        clips: project.videoStudio.clips,
        selectedClipId:
          project.videoStudio.selectedClipId ?? project.videoStudio.clips[0]?.id ?? null
      })
    }
    // Restore srtPath after loadSource (which clears it). Ignore on
    // older v1 projects where the field was absent — they get null.
    if (project.videoStudio.srtPath) {
      useVideoStore.getState().setSrtPath(project.videoStudio.srtPath)
    }
  }
  if (project.audioStudio?.sourcePath) {
    await useAudioStore
      .getState()
      .loadSource(
        project.audioStudio.sourcePath,
        project.audioStudio.fromVideoPath ?? undefined
      )
    useAudioStore.setState({ chain: project.audioStudio.chain })
  }
  // Last: the selections and the playhead only mean anything once the
  // clips and layers they point at are in place.
  applyPlace(project.place)
}
