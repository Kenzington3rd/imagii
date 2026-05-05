declare module 'ffprobe-static' {
  interface FfprobeStatic {
    path: string
  }
  const ffprobeStatic: FfprobeStatic
  export default ffprobeStatic
  export const path: string
}
