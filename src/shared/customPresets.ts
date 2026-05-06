import type { PlatformId } from './clip'

export interface CustomPreset {
  id: string
  name: string
  width: number
  height: number
  fps: number
  videoBitrate: string
  audioBitrate: string
  basePlatformId: PlatformId
}
