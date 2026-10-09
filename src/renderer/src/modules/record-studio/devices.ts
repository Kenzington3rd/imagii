/**
 * T-88: what the Record studio knows about the microphones and cameras on
 * the machine, as pure functions.
 *
 * The device lists used to come from ONE probe, `getUserMedia({ audio: true,
 * video: true })`. That call is all-or-nothing: with no camera it rejects,
 * and the rejection was swallowed, so a streamer with a perfectly good
 * microphone and no webcam saw "No microphone found". Each kind is probed on
 * its own now, and what the probe said decides what its list may hold:
 * `enumerateDevices()` happily lists a device the app is not allowed to open
 * (blank labels, ids that will not open), so a kind whose probe failed gets
 * an empty list rather than entries the user cannot record from.
 */

export interface DeviceOption {
  deviceId: string
  label: string
}

export interface DeviceLists {
  mics: DeviceOption[]
  cams: DeviceOption[]
}

/** The three fields of a `MediaDeviceInfo` this module reads. */
export interface DeviceInfoLike {
  kind: string
  deviceId: string
  label: string
}

/** Whether the permission probe for each kind of device succeeded. */
export interface ProbeOutcome {
  audio: boolean
  video: boolean
}

export const MIC_LABEL_FALLBACK = 'Microphone'
export const CAM_LABEL_FALLBACK = 'Camera'

function optionsOf(
  all: readonly DeviceInfoLike[],
  kind: 'audioinput' | 'videoinput',
  fallback: string
): DeviceOption[] {
  return all
    .filter((d) => d.kind === kind)
    .map((d) => ({ deviceId: d.deviceId, label: d.label || fallback }))
}

/**
 * The next device lists, from a fresh `enumerateDevices()` and the probe
 * outcomes. A kind is listed only if its own probe succeeded — so one missing
 * (or blocked) device kind can never blank the other, and a kind whose probe
 * failed is empty even if the enumeration still names a device (a refresh
 * means "tell me what is there now", not "keep what was there before").
 */
export function deviceListsFrom(
  all: readonly DeviceInfoLike[],
  probes: ProbeOutcome
): DeviceLists {
  return {
    mics: probes.audio ? optionsOf(all, 'audioinput', MIC_LABEL_FALLBACK) : [],
    cams: probes.video ? optionsOf(all, 'videoinput', CAM_LABEL_FALLBACK) : []
  }
}

/** The two `navigator.mediaDevices` calls a scan makes — injectable, so a test can be the machine. */
export interface MediaDevicesLike {
  getUserMedia(constraints: {
    audio?: boolean
    video?: boolean
  }): Promise<{ getTracks(): Array<{ stop(): void }> }>
  enumerateDevices(): Promise<readonly DeviceInfoLike[]>
}

/** Can the app open this kind of device right now? The probe stream is released at once. */
async function probe(md: MediaDevicesLike, kind: 'audio' | 'video'): Promise<boolean> {
  try {
    const stream = await md.getUserMedia(kind === 'audio' ? { audio: true } : { video: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    // No such device, blocked in Windows privacy settings, or held by another
    // app. All three mean "not available to record from"; the hint under the
    // empty list names the recoveries.
    return false
  }
}

/**
 * Re-scan the machine: probe the microphone and the camera SEPARATELY, then
 * list what the enumeration shows for the kinds that probed clean. Never
 * rejects — a scan that finds nothing is an answer (two empty lists), not an
 * error.
 */
export async function scanDevices(md: MediaDevicesLike): Promise<DeviceLists> {
  const [audio, video] = await Promise.all([probe(md, 'audio'), probe(md, 'video')])
  let all: readonly DeviceInfoLike[] = []
  try {
    all = await md.enumerateDevices()
  } catch {
    /* an enumeration that fails lists nothing */
  }
  return deviceListsFrom(all, { audio, video })
}

/**
 * Keep the user's pick only while the device is still listed (the T-69 rule
 * for screens, applied to devices). `null` means "the first one", which is
 * what the `<select>` shows and what a recording uses — so a pick for a mic
 * that was unplugged falls back to whatever is there instead of staying
 * aimed at an id that `getUserMedia({ deviceId: { exact } })` will refuse.
 */
export function reconcileDeviceId(
  current: string | null,
  list: readonly DeviceOption[]
): string | null {
  return current !== null && list.some((d) => d.deviceId === current) ? current : null
}

/**
 * The hint under an empty device list. It names the two real recoveries —
 * the device is not there, or Windows is not letting imagii use it — and the
 * control that re-checks (T-88: the old hint pointed at a button that only
 * re-listed screens and windows, and said nothing about permission).
 */
export function noDeviceHint(kind: 'microphone' | 'camera'): string {
  return (
    `No ${kind} found. Plug one in, or allow ${kind} access in Windows privacy ` +
    'settings, then click Refresh sources.'
  )
}
