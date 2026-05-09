import type { ImagiiProject } from '@shared/workspace'
import { useVideoStore } from '../video-studio/store/videoStore'
import { useAudioStore } from '../audio-studio/state/audioStore'
import { useCanvasStore } from '../image-studio/state/canvasStore'

export function captureProject(): ImagiiProject {
  const video = useVideoStore.getState()
  const audio = useAudioStore.getState()
  const canvas = useCanvasStore.getState()

  return {
    // Always emit MAX_SCHEMA_VERSION on save; older versions are only
    // accepted on load (with automatic migration).
    schemaVersion: 2,
    savedAt: Date.now(),
    appVersion: '1.0.0',
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

export async function applyProject(project: ImagiiProject): Promise<void> {
  if (project.imageCanvas) {
    useCanvasStore.getState().setDocument(project.imageCanvas.doc)
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
}
