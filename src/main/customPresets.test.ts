import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Round 17 phase-6: cover the video custom-export-presets store. Mocks
// app.getPath('userData') to a per-test tempdir so file IO is real but
// isolated.
let TMP = ''
vi.mock('electron', () => ({
  app: {
    getPath: () => TMP
  }
}))

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-custom-presets-'))
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

async function load(): Promise<typeof import('./customPresets')> {
  return import('./customPresets')
}

describe('customPresets store (round 17 phase-6 coverage)', () => {
  it('listCustomPresets returns [] when the dir is empty', async () => {
    const m = await load()
    expect(await m.listCustomPresets()).toEqual([])
  })

  it('saveCustomPreset round-trips through listCustomPresets', async () => {
    const m = await load()
    const saved = await m.saveCustomPreset({
      name: '4K square',
      width: 2160,
      height: 2160,
      fps: 60,
      videoBitrate: '20M',
      audioBitrate: '192k',
      basePlatformId: 'youtube'
    })
    expect(saved.id).toMatch(/^[A-Za-z0-9_-]+$/)
    const list = await m.listCustomPresets()
    expect(list.length).toBe(1)
    expect(list[0]?.name).toBe('4K square')
    expect(list[0]?.fps).toBe(60)
  })

  it('list is sorted by name ascending', async () => {
    const m = await load()
    await m.saveCustomPreset({ name: 'Zeta', width: 1920, height: 1080, fps: 30, videoBitrate: '8M', audioBitrate: '192k', basePlatformId: 'youtube' })
    await m.saveCustomPreset({ name: 'Alpha', width: 1920, height: 1080, fps: 30, videoBitrate: '8M', audioBitrate: '192k', basePlatformId: 'youtube' })
    const list = await m.listCustomPresets()
    expect(list.map((p) => p.name)).toEqual(['Alpha', 'Zeta'])
  })

  it('deleteCustomPreset removes the matching file', async () => {
    const m = await load()
    const p = await m.saveCustomPreset({ name: 'tmp', width: 1280, height: 720, fps: 30, videoBitrate: '8M', audioBitrate: '192k', basePlatformId: 'youtube' })
    await m.deleteCustomPreset(p.id)
    const list = await m.listCustomPresets()
    expect(list.length).toBe(0)
  })

  // INIT-C (round 15) gate the validation rejects:
  it('deleteCustomPreset rejects ids that escape the nanoid alphabet', async () => {
    const m = await load()
    await expect(m.deleteCustomPreset('../../etc/passwd')).rejects.toThrow(
      /nanoid alphabet/
    )
    await expect(m.deleteCustomPreset('has spaces')).rejects.toThrow()
    await expect(m.deleteCustomPreset('')).rejects.toThrow()
  })

  it('deleteCustomPreset is a no-op for an unknown but valid id', async () => {
    const m = await load()
    await expect(m.deleteCustomPreset('abc123')).resolves.toBeUndefined()
  })
})
