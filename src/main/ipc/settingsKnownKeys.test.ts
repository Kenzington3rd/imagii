import { describe, it, expect, vi } from 'vitest'

// Round 17 phase-4 regression: the renderer-supplied `key` for settings:get
// and settings:set must come from the SettingsKey union. A regression that
// loosens this gate would let a hostile renderer pollute electron-store
// with arbitrary keys (or shadow future legitimate ones).
//
// The settings IPC module imports `electron` at module load, so mock it
// before the dynamic import below.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getVersion: () => 'test', quit: vi.fn() }
}))

const { __settingsTesting__ } = await import('./settings')
const { KNOWN_SETTINGS_KEYS, assertKnownKey } = __settingsTesting__

describe('settings known-keys validator', () => {
  it('contains every shipped SettingsKey', () => {
    // Sanity floor — if the union grows, the list above must follow. A
    // single missing key would silently lose validation for that field.
    expect(KNOWN_SETTINGS_KEYS).toContain('theme')
    expect(KNOWN_SETTINGS_KEYS).toContain('welcomeSeen')
    expect(KNOWN_SETTINGS_KEYS).toContain('export.lastOutputDir')
    expect(KNOWN_SETTINGS_KEYS).toContain('clipKit.lastOutputDir')
    expect(KNOWN_SETTINGS_KEYS.length).toBeGreaterThanOrEqual(15)
  })

  it('accepts every known key', () => {
    for (const k of KNOWN_SETTINGS_KEYS) {
      expect(() => assertKnownKey(k)).not.toThrow()
    }
  })

  it.each(['hacker.injected', 'theme.dark', '', '__proto__', '../etc/passwd'])(
    'rejects unknown key %p',
    (k) => {
      expect(() => assertKnownKey(k)).toThrow(/not recognized/)
    }
  )

  it.each([null, undefined, 42, {}, [], true])(
    'rejects non-string key %p',
    (k) => {
      expect(() => assertKnownKey(k)).toThrow(/not recognized/)
    }
  )
})
