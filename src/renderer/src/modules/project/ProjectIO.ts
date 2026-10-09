import type { ImagiiProject, PlaceRecord } from '@shared/workspace'
import { KNOWN_ROUTES, MAX_SCHEMA_VERSION } from '@shared/projectValidation'
import { useVideoStore } from '../video-studio/store/videoStore'
import { useAudioStore } from '../audio-studio/state/audioStore'
import { useCanvasStore } from '../image-studio/state/canvasStore'
import { useReferencesStore } from '../references/state/referencesStore'
import { basename } from '../../components/OutputDirLabel'

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

/**
 * T-84 — a media file a project points at that could not be opened (moved,
 * deleted, an unplugged drive). One per studio that lost its file.
 */
export interface UnavailableSource {
  studio: 'video' | 'audio'
  path: string
  fileName: string
}

export interface ApplyOutcome {
  /** In apply order: video, then audio. Empty when every file was found. */
  unavailable: UnavailableSource[]
}

/**
 * The ONE sentence for the files a project could not find, or null when
 * nothing is missing. It names the file, says the rest is open, and says
 * where to load it again — the three things a bare probe error ("ffprobe
 * exit 1: …") never told the user.
 */
export function describeUnavailableSources(
  items: ReadonlyArray<UnavailableSource>
): string | null {
  if (items.length === 0) return null
  const names = [...new Set(items.map((i) => i.fileName))]
  const reload = items.map((i) =>
    i.studio === 'video' ? 'the video again in Video Studio' : 'the audio again in Audio Studio'
  )
  return (
    `Couldn't find ${names.join(' and ')}. ` +
    `${names.length === 1 ? 'It may' : 'They may'} have been moved or deleted. ` +
    `The rest of your project is open — load ${reload.join(' and ')}.`
  )
}

/**
 * Open one studio's media file; a file that cannot be read is REPORTED, not
 * thrown. This is the single point where a missing file is allowed to stop
 * being an exception, so everything after it in `applyProject` still runs.
 * The raw error goes to the console — it is ffprobe's stderr, not for the
 * user.
 */
async function loadReporting(
  studio: UnavailableSource['studio'],
  filePath: string,
  load: () => Promise<void>,
  unavailable: UnavailableSource[]
): Promise<boolean> {
  try {
    await load()
    return true
  } catch (err) {
    console.error(`[imagii] project ${studio} file could not be opened:`, filePath, err)
    unavailable.push({ studio, path: filePath, fileName: basename(filePath) })
    return false
  }
}

/**
 * Put a project's studios back, each independently.
 *
 * T-84: this used to be one straight line of awaits, so the first
 * `loadSource` to throw (the recording had been moved) rejected the whole
 * call and left the project half-restored. The order is still canvas, video,
 * audio, place — but a studio whose file is gone is left exactly as it was
 * and reported in the outcome, and every other studio is applied regardless.
 * Nothing from a studio that lost its file is applied over the hole (no clips
 * or caption path for a video that is not there).
 */
export async function applyProject(project: ImagiiProject): Promise<ApplyOutcome> {
  const unavailable: UnavailableSource[] = []
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
  const video = project.videoStudio
  if (video?.sourcePath) {
    const sourcePath = video.sourcePath
    const loaded = await loadReporting(
      'video',
      sourcePath,
      () => useVideoStore.getState().loadSource(sourcePath),
      unavailable
    )
    if (loaded) {
      if (video.clips.length > 0) {
        useVideoStore.setState({
          clips: video.clips,
          selectedClipId: video.selectedClipId ?? video.clips[0]?.id ?? null
        })
      }
      // Restore srtPath after loadSource (which clears it). Ignore on
      // older v1 projects where the field was absent — they get null.
      if (video.srtPath) {
        useVideoStore.getState().setSrtPath(video.srtPath)
      }
    }
  }
  const audio = project.audioStudio
  if (audio?.sourcePath) {
    const sourcePath = audio.sourcePath
    const loaded = await loadReporting(
      'audio',
      sourcePath,
      () => useAudioStore.getState().loadSource(sourcePath, audio.fromVideoPath ?? undefined),
      unavailable
    )
    if (loaded) useAudioStore.setState({ chain: audio.chain })
  }
  // Last: the selections and the playhead only mean anything once the
  // clips and layers they point at are in place.
  applyPlace(project.place)
  return { unavailable }
}
