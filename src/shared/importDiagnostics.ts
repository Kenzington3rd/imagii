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

/**
 * Format a thrown error from probe / loadSource into a user-facing message that
 * preserves the actual underlying detail (instead of swallowing it as "Failed
 * to load video"). Keeps the message bounded and adds an OS-specific hint when
 * the error pattern matches a known cause.
 */
export function describeImportError(err: unknown, filePath?: string | null): string {
  const baseMsg = err instanceof Error ? err.message : 'Import failed'
  const truncated = baseMsg.length > 240 ? `${baseMsg.slice(0, 240)}…` : baseMsg

  const lowered = baseMsg.toLowerCase()
  const inCloud = pathLooksLikeCloudSync(filePath ?? '')

  if (lowered.includes('enoent') || lowered.includes('cannot find') || lowered.includes('no such file')) {
    return `${truncated}\n\nThe file isn't where the app expected it. ${
      inCloud
        ? 'It looks like a cloud-sync placeholder — right-click → Always keep on this device, then retry.'
        : 'Try the file picker instead, or check that the file still exists at that path.'
    }`
  }
  if (lowered.includes('access') && lowered.includes('denied')) {
    return `${truncated}\n\nWindows denied read access to that file. Common causes: antivirus quarantined ffprobe.exe (add a folder exception for imagii's install location), or the file is locked by another program (close any app that has it open).`
  }
  if (lowered.includes('no video stream')) {
    return 'This file has no video stream. If it\'s an audio file (.mp3, .wav, etc.), try the Audio Studio instead.'
  }
  if (lowered.includes('codec') || lowered.includes('decoder')) {
    return `${truncated}\n\nThe video uses a codec FFmpeg can't decode. H.264, H.265, VP9, ProRes, and AV1 should all work — older AVI files sometimes use codecs we don't support.`
  }
  return truncated
}
