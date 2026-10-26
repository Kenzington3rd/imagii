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
    // T-124 (21): the one folder the GIF, Compile, Reframe and picture-in-picture panels remember. Missing, every read and write
    // of it throws at the IPC boundary and the four ask for a folder on every visit, as before.
    expect(KNOWN_SETTINGS_KEYS).toContain('video.lastOutputDir')
    // T-20: the posting diary moved out of localStorage into settings. A
    // missing entry here would make every diary read and write throw at the
    // IPC boundary instead of persisting.
    expect(KNOWN_SETTINGS_KEYS).toContain('postingDiary')
    // T-49 / T-43: two preferences that used to be forgotten between
    // launches — the watermark's corner and the Record MP4 choice. A key
    // missing here throws at the IPC boundary on both the read and the
    // write, which reads to the user as "it just doesn't remember".
    expect(KNOWN_SETTINGS_KEYS).toContain('watermarkPosition')
    expect(KNOWN_SETTINGS_KEYS).toContain('record.convertToMp4')
    expect(KNOWN_SETTINGS_KEYS.length).toBeGreaterThanOrEqual(18)
  })

  it('carries no key nothing reads (T-57)', () => {
    // `lastRoute` was declared in three places — the union, this allowlist,
    // and the store schema — and written or read by none. T-47 restores the
    // route from the autosave snapshot's `place` record instead, so the key
    // was a settings field the app could only ever accumulate. Deleted; this
    // pins it deleted, because a dead allowlist entry is a door left open on
    // a room nobody uses.
    expect(KNOWN_SETTINGS_KEYS).not.toContain('lastRoute')
  })

  it('has no duplicate keys', () => {
    expect(new Set(KNOWN_SETTINGS_KEYS).size).toBe(KNOWN_SETTINGS_KEYS.length)
  })

  // T-120: the store's schema is NESTED, one object per dotted group, because Conf nests a dotted key (the
  // `record.convertToMp4` setting is `{ record: { convertToMp4 } }` on disk). Flat property names with dots in
  // them match nothing in that layout, which is how eleven keys went unvalidated for rounds while this test
  // compared the TOP-LEVEL names to the allowlist and passed. So: the schema is flattened back into dotted
  // paths and compared to the allowlist, and no property name may itself contain a dot.
  type SchemaNode = { type?: string; properties?: Record<string, SchemaNode> }

  /** Dotted paths of a nested schema. A node that IS an allowlisted key is a leaf even if it has properties (`windowBounds`). */
  function flattenSchema(
    nodes: Record<string, SchemaNode>,
    allowed: ReadonlySet<string>,
    prefix = ''
  ): string[] {
    const paths: string[] = []
    for (const [name, node] of Object.entries(nodes)) {
      const at = prefix === '' ? name : `${prefix}.${name}`
      if (node.properties && !allowed.has(at)) paths.push(...flattenSchema(node.properties, allowed, at))
      else paths.push(at)
    }
    return paths
  }

  /** Every property name anywhere in the schema, however deep. */
  function allPropertyNames(nodes: Record<string, SchemaNode>): string[] {
    return Object.entries(nodes).flatMap(([name, node]) => [name, ...(node.properties ? allPropertyNames(node.properties) : [])])
  }

  it('validates the store schema and the allowlist against each other', async () => {
    // The gate and the on-disk schema are two lists that must not drift: a
    // key the gate accepts but the schema omits would round-trip unvalidated.
    const { __storeTesting__ } = await import('../store')
    const schema = __storeTesting__.schema as unknown as Record<string, SchemaNode>
    const flat = flattenSchema(schema, new Set(KNOWN_SETTINGS_KEYS))
    expect(flat.sort()).toEqual([...KNOWN_SETTINGS_KEYS].sort())
  })

  it('has no schema property with a dot in its name: Conf nests dotted keys, so such a property matches nothing (T-120)', async () => {
    const { __storeTesting__ } = await import('../store')
    const schema = __storeTesting__.schema as unknown as Record<string, SchemaNode>
    expect(allPropertyNames(schema).filter((n) => n.includes('.'))).toEqual([])
  })

  it('the flattening itself discriminates: the dead flat layout, a missing leaf and an extra one all differ from the allowlist', () => {
    const allowed = new Set(['theme', 'record.convertToMp4', 'windowBounds'])
    const nested = { theme: {}, record: { properties: { convertToMp4: {} } }, windowBounds: { properties: { x: {} } } }
    expect(flattenSchema(nested, allowed).sort()).toEqual(['record.convertToMp4', 'theme', 'windowBounds'])
    // The dead layout flattens to the same paths - which is exactly why the dot rule above exists.
    const dead = { theme: {}, 'record.convertToMp4': {}, windowBounds: { properties: { x: {} } } }
    expect(flattenSchema(dead, allowed).sort()).toEqual(['record.convertToMp4', 'theme', 'windowBounds'])
    expect(allPropertyNames(dead).filter((n) => n.includes('.'))).toEqual(['record.convertToMp4'])
    expect(allPropertyNames(nested).filter((n) => n.includes('.'))).toEqual([])
    // A group with a child the allowlist does not know, and a group that lost one.
    expect(flattenSchema({ theme: {}, record: { properties: { convertToMp4: {}, extra: {} } } }, allowed).sort()).not.toEqual(
      ['record.convertToMp4', 'theme']
    )
    expect(flattenSchema({ theme: {}, record: { properties: {} } }, allowed)).not.toContain('record.convertToMp4')
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
