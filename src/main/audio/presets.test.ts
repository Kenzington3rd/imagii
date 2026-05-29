import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_CHAIN_SPEC } from '../../shared/audio'

// Round 17 phase-6: cover the audio-presets store-backed CRUD by mocking
// app.getPath('userData') to a per-test tempdir. The real handler IPC body
// imports electron at module load — mock before dynamic import.
let TMP = ''
vi.mock('electron', () => ({
  app: {
    getPath: (k: string) => {
      if (k === 'userData') return TMP
      return TMP
    }
  }
}))

beforeEach(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'imagii-presets-'))
})
afterEach(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true })
})

async function loadModule(): Promise<typeof import('./presets')> {
  // The presets module captures app.getPath('userData') lazily inside
  // presetsDir(), so a per-test re-import isn't needed — just await the
  // initial import.
  return import('./presets')
}

describe('audio presets store (round 17 phase-6 coverage)', () => {
  it('listPresets returns an empty list when the dir does not exist', async () => {
    const m = await loadModule()
    const list = await m.listPresets()
    expect(list).toEqual([])
  })

  it('savePreset writes a JSON file and returns the preset', async () => {
    const m = await loadModule()
    const preset = await m.savePreset('My chain', DEFAULT_CHAIN_SPEC)
    expect(preset.id).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(preset.name).toBe('My chain')
    expect(preset.createdAt).toBeGreaterThan(0)
    const list = await m.listPresets()
    expect(list.length).toBe(1)
    expect(list[0]?.name).toBe('My chain')
  })

  it('savePreset falls back to "Preset" when the name is blank', async () => {
    const m = await loadModule()
    const p = await m.savePreset('   ', DEFAULT_CHAIN_SPEC)
    expect(p.name).toBe('Preset')
  })

  it('deletePreset removes the file', async () => {
    const m = await loadModule()
    const p = await m.savePreset('temp', DEFAULT_CHAIN_SPEC)
    await m.deletePreset(p.id)
    const list = await m.listPresets()
    expect(list.length).toBe(0)
  })

  it('deletePreset is a no-op for an unknown id', async () => {
    const m = await loadModule()
    await expect(m.deletePreset('does-not-exist')).resolves.toBeUndefined()
  })

  it('listPresets sorts by name', async () => {
    const m = await loadModule()
    await m.savePreset('Zeta', DEFAULT_CHAIN_SPEC)
    await m.savePreset('Alpha', DEFAULT_CHAIN_SPEC)
    const list = await m.listPresets()
    expect(list.map((p) => p.name)).toEqual(['Alpha', 'Zeta'])
  })
})
