import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

function unpackedPath(p: string | null | undefined): string {
  if (!p) throw new Error('FFmpeg binary path missing')
  return p.replace('app.asar', 'app.asar.unpacked')
}

export const ffmpegPath = unpackedPath(ffmpegStatic as unknown as string)
export const ffprobePath = unpackedPath(ffprobeStatic.path)
