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

  // Round 18: valid-JSON-wrong-shape preset files used to reach `.sort()`
  // and throw (`a.name.localeCompare` on undefined) — the round-14
  // customPresets lesson, finally mirrored here.
  it('listPresets skips structurally-invalid preset files instead of crashing', async () => {
    const m = await loadModule()
    await m.savePreset('Zeta', DEFAULT_CHAIN_SPEC)
    const { writeFile, mkdir } = await import('node:fs/promises')
    const dir = path.join(TMP, 'audio-presets')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'corrupt-1.json'), '{}', 'utf8')
    await writeFile(path.join(dir, 'corrupt-2.json'), '{"name":123}', 'utf8')
    await writeFile(path.join(dir, 'corrupt-3.json'), '[1,2,3]', 'utf8')
    await writeFile(path.join(dir, 'corrupt-4.json'), 'not json at all', 'utf8')
    const list = await m.listPresets()
    expect(list.map((p) => p.name)).toEqual(['Zeta'])
  })

  it('parseChainPreset normalizes a well-formed preset and rejects bad shapes', async () => {
    const m = await loadModule()
    const good = m.parseChainPreset(
      JSON.stringify({ id: 'abc', name: 'Mine', chain: DEFAULT_CHAIN_SPEC, createdAt: 5 })
    )
    expect(good?.name).toBe('Mine')
    expect(good?.createdAt).toBe(5)
    expect(m.parseChainPreset(JSON.stringify({ id: 'abc', chain: DEFAULT_CHAIN_SPEC }))).toBeNull()
    expect(m.parseChainPreset(JSON.stringify({ id: '', name: 'x', chain: {} }))).toBeNull()
    expect(m.parseChainPreset('null')).toBeNull()
  })
})
