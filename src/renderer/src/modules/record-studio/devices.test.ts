import { describe, it, expect } from 'vitest'
import {
  deviceListsFrom,
  noDeviceHint,
  reconcileDeviceId,
  scanDevices,
  type DeviceInfoLike,
  type MediaDevicesLike
} from './devices'

/**
 * T-88 — the Record studio's device lists.
 *
 * The bug: ONE `getUserMedia({ audio: true, video: true })` probe fed both
 * lists, so a machine with a microphone and no camera (most streamers who
 * only capture the screen) rejected the probe and showed "No microphone
 * found". The cases here use a fake `mediaDevices` that behaves like the real
 * one in the way that matters — a request for a kind of device that is not
 * there rejects, and a request for several kinds rejects if ANY is missing —
 * so the test is the machine, and a combined probe fails it.
 */

const MIC: DeviceInfoLike = { kind: 'audioinput', deviceId: 'mic-1', label: 'Blue Yeti' }
const MIC_2: DeviceInfoLike = { kind: 'audioinput', deviceId: 'mic-2', label: 'Headset' }
const CAM: DeviceInfoLike = { kind: 'videoinput', deviceId: 'cam-1', label: 'Logitech C920' }

interface FakeMachine {
  md: MediaDevicesLike
  /** Every constraints object getUserMedia was asked for, in order. */
  asked: Array<{ audio?: boolean; video?: boolean }>
  /** Tracks stopped, so a probe that leaves the device open is visible. */
  stopped: () => number
  enumerations: () => number
}

/**
 * A machine with `devices` plugged in. `blocked` kinds exist but Windows will
 * not let the app open them (the privacy-settings case): enumeration lists
 * them, getUserMedia rejects.
 */
function machine(devices: DeviceInfoLike[], blocked: Array<'audio' | 'video'> = []): FakeMachine {
  const asked: Array<{ audio?: boolean; video?: boolean }> = []
  let stopped = 0
  let enumerations = 0
  const has = (kind: 'audio' | 'video'): boolean =>
    !blocked.includes(kind) && devices.some((d) => d.kind === `${kind}input`)
  const md: MediaDevicesLike = {
    async getUserMedia(constraints) {
      asked.push(constraints)
      // All-or-nothing, like the real call: every requested kind must open.
      if (constraints.audio && !has('audio')) throw new DOMException('no mic', 'NotFoundError')
      if (constraints.video && !has('video')) throw new DOMException('no cam', 'NotFoundError')
      return { getTracks: () => [{ stop: () => void (stopped += 1) }] }
    },
    async enumerateDevices() {
      enumerations += 1
      return devices
    }
  }
  return { md, asked, stopped: () => stopped, enumerations: () => enumerations }
}

describe('scanDevices — one missing device never blanks the other (T-88)', () => {
  it('a microphone and NO camera: the mic is listed, the camera list is empty', async () => {
    const m = machine([MIC])
    const lists = await scanDevices(m.md)
    expect(lists.mics).toEqual([{ deviceId: 'mic-1', label: 'Blue Yeti' }])
    expect(lists.cams).toEqual([])
  })

  it('a camera and NO microphone: the camera is listed, the mic list is empty', async () => {
    const m = machine([CAM])
    const lists = await scanDevices(m.md)
    expect(lists.cams).toEqual([{ deviceId: 'cam-1', label: 'Logitech C920' }])
    expect(lists.mics).toEqual([])
  })

  it('both present: both listed', async () => {
    const lists = await scanDevices(machine([MIC, MIC_2, CAM]).md)
    expect(lists.mics.map((d) => d.deviceId)).toEqual(['mic-1', 'mic-2'])
    expect(lists.cams.map((d) => d.deviceId)).toEqual(['cam-1'])
  })

  it('neither present: two empty lists, and no rejection', async () => {
    await expect(scanDevices(machine([]).md)).resolves.toEqual({ mics: [], cams: [] })
  })

  it('asks for each kind on its own — never one call that needs both', async () => {
    const m = machine([MIC, CAM])
    await scanDevices(m.md)
    expect(m.asked).toHaveLength(2)
    expect(m.asked).toContainEqual({ audio: true })
    expect(m.asked).toContainEqual({ video: true })
    expect(m.asked.some((c) => c.audio && c.video)).toBe(false)
  })

  it('a kind Windows will not let the app open is empty even though the enumeration names it', async () => {
    // The privacy-settings case: the mic is plugged in and listed, but the
    // permission probe fails. Offering it would be offering a recording that
    // cannot start.
    const m = machine([MIC, CAM], ['audio'])
    const lists = await scanDevices(m.md)
    expect(lists.mics).toEqual([])
    expect(lists.cams).toHaveLength(1)
  })

  it('releases every probe stream at once', async () => {
    const m = machine([MIC, CAM])
    await scanDevices(m.md)
    expect(m.stopped()).toBe(2)
  })

  it('re-enumerates on every scan (what Refresh sources relies on)', async () => {
    const m = machine([MIC])
    await scanDevices(m.md)
    await scanDevices(m.md)
    expect(m.enumerations()).toBe(2)
    expect(m.asked).toHaveLength(4)
  })

  it('an enumeration that throws lists nothing instead of rejecting', async () => {
    const m = machine([MIC, CAM])
    m.md.enumerateDevices = async () => {
      throw new Error('boom')
    }
    await expect(scanDevices(m.md)).resolves.toEqual({ mics: [], cams: [] })
  })
})

describe('deviceListsFrom', () => {
  it('falls back to a plain label for a device the OS did not name', () => {
    const lists = deviceListsFrom(
      [
        { kind: 'audioinput', deviceId: 'a', label: '' },
        { kind: 'videoinput', deviceId: 'v', label: '' }
      ],
      { audio: true, video: true }
    )
    expect(lists.mics[0]?.label).toBe('Microphone')
    expect(lists.cams[0]?.label).toBe('Camera')
  })

  it('ignores outputs and anything that is not an input', () => {
    const lists = deviceListsFrom(
      [
        { kind: 'audiooutput', deviceId: 'spk', label: 'Speakers' },
        MIC
      ],
      { audio: true, video: true }
    )
    expect(lists.mics.map((d) => d.deviceId)).toEqual(['mic-1'])
    expect(lists.cams).toEqual([])
  })
})

describe('reconcileDeviceId — a pick survives only while the device does', () => {
  const list = [
    { deviceId: 'mic-1', label: 'Blue Yeti' },
    { deviceId: 'mic-2', label: 'Headset' }
  ]

  it('keeps a pick that is still listed', () => {
    expect(reconcileDeviceId('mic-2', list)).toBe('mic-2')
  })

  it('drops a pick that was unplugged, so the first device is used', () => {
    expect(reconcileDeviceId('mic-9', list)).toBeNull()
  })

  it('drops every pick when the list is empty', () => {
    expect(reconcileDeviceId('mic-1', [])).toBeNull()
  })

  it('no pick stays no pick', () => {
    expect(reconcileDeviceId(null, list)).toBeNull()
  })
})

describe('noDeviceHint — names the real recovery', () => {
  it('microphone: plug in or allow access in Windows privacy settings, then Refresh sources', () => {
    expect(noDeviceHint('microphone')).toBe(
      'No microphone found. Plug one in, or allow microphone access in Windows privacy settings, then click Refresh sources.'
    )
  })

  it('camera: the same sentence for a camera', () => {
    expect(noDeviceHint('camera')).toBe(
      'No camera found. Plug one in, or allow camera access in Windows privacy settings, then click Refresh sources.'
    )
  })

  it('does not send the user to "grant permission" without saying where', () => {
    for (const kind of ['microphone', 'camera'] as const) {
      expect(noDeviceHint(kind)).toMatch(/Windows privacy settings/)
      expect(noDeviceHint(kind)).not.toMatch(/after granting permission/)
    }
  })
})
