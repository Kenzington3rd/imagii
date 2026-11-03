import { useEffect } from 'react'
import { useCaptionsProgress, useReframeRun, useScanRun } from './runs'

/**
 * The three progress channels that feed the run stores, each with ONE subscriber that lasts as long as the studio does (T-145).
 *
 * They were effects inside ReframePanel, HighlightPanel and CaptionsPanel, which VideoStudio mounts only while a video is open: Close removed the
 * listeners and the closed video's card (`VideoJobsRunning`) kept showing the last figure of a job that went on, frozen. The studio is mounted
 * whether or not a video is open, so it calls this once, ahead of the open-or-closed conditional; no panel subscribes. Each event is written to its
 * store whether or not a run is held (T-89: the captions line is its own store; `patch` of an empty slot is a no-op).
 */
export function useVideoProgressFeeds(): void {
  useEffect(() => {
    const offReframe = window.api.video.onReframeProgress((p) => {
      useReframeRun.getState().patch({ percent: p.percent ?? null, phase: p.phase })
    })
    const offScan = window.api.video.onHighlightProgress((p) => {
      useScanRun.getState().patch({ percent: p.percent })
    })
    const offCaptions = window.api.captions.onProgress((p) => useCaptionsProgress.setState({ progress: p }))
    return () => {
      offReframe()
      offScan()
      offCaptions()
    }
  }, [])
}
