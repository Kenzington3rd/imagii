import { ipcErrorMessage } from './ipcError'
import { userFacingError } from './userFacingError'

export interface DropDiagnostic {
  hadFile: boolean
  hadPath: boolean
  fileName?: string
  fileSize?: number
  fileType?: string
  reason?: 'no-file' | 'no-path' | 'cloud-placeholder' | 'ok'
  hint?: string
}

const CLOUD_PLACEHOLDER_HINTS = [
  /[\\/]OneDrive[\\/]/i,
  /[\\/]Google Drive[\\/]/i,
  /[\\/]Dropbox[\\/]/i,
  /[\\/]iCloudDrive[\\/]/i,
  /[\\/]Box[\\/]/i
]

export function pathLooksLikeCloudSync(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  return CLOUD_PLACEHOLDER_HINTS.some((re) => re.test(filePath))
}

/**
 * Examines a drop event's first file and produces a diagnostic record. Renderer
 * code uses this to show specific, actionable error messages instead of "Failed
 * to load video."
 */
export function examineDroppedFile(file: File | undefined): DropDiagnostic {
  if (!file) {
    return {
      hadFile: false,
      hadPath: false,
      reason: 'no-file',
      hint: 'No file was dropped. Try the file picker instead.'
    }
  }
  const filePath = (file as File & { path?: string }).path
  if (!filePath) {
    return {
      hadFile: true,
      hadPath: false,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      reason: 'no-path',
      hint:
        'This file has no local path. Most common causes: dragged from a browser tab, dragged from a cloud-only file (OneDrive / Google Drive placeholder), or the source app is sandboxed. Click "Choose file…" to use the file picker, or right-click the file in Explorer → "Always keep on this device" to materialize a OneDrive placeholder.'
    }
  }
  if (pathLooksLikeCloudSync(filePath)) {
    return {
      hadFile: true,
      hadPath: true,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      reason: 'cloud-placeholder',
      hint: `${filePath} is inside a cloud-sync folder. If the file isn't fully downloaded locally (placeholder only), the import may fail with an obscure error. If you hit a problem, right-click the file in Explorer → "Always keep on this device" and try again.`
    }
  }
  return {
    hadFile: true,
    hadPath: true,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    reason: 'ok'
  }
}

/** Which studio's importer is asking — the same failure reads differently to
 *  someone who dropped a video and someone who dropped a sound. */
export type ImportKind = 'video' | 'audio'

/**
 * Turn a thrown error from probe / loadSource / extraction into what the user
 * should read when a file will not open.
 *
 * T-84: this used to print the raw message first ("ffprobe exit 1:
 * /path/to/clip.mp4: No such file or directory") and the explanation after
 * it, and an error that crossed the IPC bridge arrived with Electron's
 * "Error invoking remote method 'video:probe':" in front of THAT. Now the
 * user reads one sentence about their file, and the raw message goes to the
 * console where a bug report can find it. The audio importer used the same
 * function and so showed video wording ("The video uses a codec…") to
 * someone who had dropped an mp3 — `kind` is the fix.
 *
 * Anything not recognised falls through to `userFacingError`: a sentence main
 * wrote for the user (the text-file refusal) passes through whole, and the
 * rest becomes "imagii couldn't open that file."
 */
export function describeImportError(
  err: unknown,
  filePath?: string | null,
  kind: ImportKind = 'video'
): string {
  const lowered = ipcErrorMessage(err, '').toLowerCase()
  const inCloud = pathLooksLikeCloudSync(filePath ?? '')
  const known = (sentence: string): string => {
    console.error('[imagii] could not open', filePath ?? '(no path)', err)
    return sentence
  }

  if (
    lowered.includes('enoent') ||
    lowered.includes('cannot find') ||
    lowered.includes('no such file') ||
    lowered.includes('system cannot find')
  ) {
    return known(
      inCloud
        ? "imagii can't find that file. It looks like a cloud-sync placeholder — right-click it in Explorer, choose Always keep on this device, then try again."
        : "imagii can't find that file. It may have been moved or deleted — pick it again with Choose file…."
    )
  }
  if (
    (lowered.includes('access') && lowered.includes('denied')) ||
    /\b(?:ebusy|eperm|eacces)\b|resource busy|operation not permitted/.test(lowered)
  ) {
    return known('Windows blocked access. Close any app using the file, or check your antivirus.')
  }
  if (kind === 'video' && lowered.includes('no video stream')) {
    return known('This file has no picture, only sound. Open it in Audio Studio instead.')
  }
  if (kind === 'audio' && lowered.includes('no audio stream')) {
    return known("This file has no sound, so there's nothing to clean. Pick a file with audio.")
  }
  if (
    lowered.includes('codec') ||
    lowered.includes('decoder') ||
    lowered.includes('invalid data found') ||
    lowered.includes('moov atom') ||
    lowered.includes('no usable duration')
  ) {
    return known(
      kind === 'video'
        ? "imagii can't read this video format. Re-export it as MP4 from your recorder."
        : "imagii can't read this audio format. Re-export it as WAV or MP3 and try again."
    )
  }
  return userFacingError(err, "imagii couldn't open that file.").message
}
