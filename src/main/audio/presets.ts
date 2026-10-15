import { app } from 'electron'
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type { ChainPreset } from '../../shared/workspace'
import type { ChainSpec } from '../../shared/audio'
import { cleanupSettings } from '../../shared/audioPreset'
import { assertSafeId, isSafeId } from '../../shared/pathSafety'

function presetsDir(): string {
  return path.join(app.getPath('userData'), 'audio-presets')
}

async function ensureDir(): Promise<void> {
  await mkdir(presetsDir(), { recursive: true })
}

/**
 * Round 18: structural gate for a preset file read back off disk. Round 14
 * fixed this exact crash shape in customPresets.ts ("any
 * read-directory-of-user-JSON path needs a parse-and-normalize choke
 * point") but the audio twin never got the same treatment — a valid-JSON
 * file missing `name` reached `.sort()` and threw, permanently breaking
 * the Cleanup presets panel until the file was hand-deleted.
 */
export function parseChainPreset(raw: string): ChainPreset | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const p = data as Record<string, unknown>
  // T-117: the id comes back to main as the argument of deletePreset and is joined into a path,
  // so a file that carries an id outside the alphabet nanoid mints is not a preset the list shows.
  if (!isSafeId(p.id)) return null
  if (typeof p.name !== 'string' || p.name.length === 0) return null
  if (typeof p.chain !== 'object' || p.chain === null || Array.isArray(p.chain)) return null
  return {
    id: p.id,
    name: p.name,
    // T-90: presets written before this ticket saved the whole chain, cut
    // times and second track included. Reading one back drops both, so the
    // panel — and anything else that lists presets — can never hand a stale
    // cut list to a new recording.
    chain: cleanupSettings(p.chain as ChainSpec),
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0
  }
}

export async function listPresets(): Promise<ChainPreset[]> {
  await ensureDir()
  const dir = presetsDir()
  if (!existsSync(dir)) return []
  const files = await readdir(dir)
  const presets: ChainPreset[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const raw = await readFile(path.join(dir, f), 'utf8')
      const parsed = parseChainPreset(raw)
      if (parsed) presets.push(parsed)
    } catch {
      continue
    }
  }
  presets.sort((a, b) => a.name.localeCompare(b.name))
  return presets
}

export async function savePreset(name: string, chain: ChainSpec): Promise<ChainPreset> {
  await ensureDir()
  const trimmed = name.trim() || 'Preset'
  const preset: ChainPreset = {
    id: nanoid(10),
    name: trimmed,
    // T-90: a preset is the cleanup settings for a microphone, not a copy of
    // one recording's edit. The caller hands over the live chain; the cut
    // times and the second track's file path stop here and never reach disk.
    chain: cleanupSettings(chain),
    createdAt: Date.now()
  }
  await writeFile(
    path.join(presetsDir(), `${preset.id}.json`),
    JSON.stringify(preset, null, 2),
    'utf8'
  )
  return preset
}

/**
 * T-117: `id` is the renderer's, and it is a path segment (`<id>.json` under userData), so it is
 * held to the alphabet nanoid mints - `../config` used to reach `unlink`. The same gate
 * `deleteCustomPreset` has. `savePreset` mints its own id and `listPresets` reads by directory
 * entry, so this is the one place an outside id becomes a path.
 */
export async function deletePreset(id: string): Promise<void> {
  assertSafeId(id, 'deletePreset: id')
  const file = path.join(presetsDir(), `${id}.json`)
  if (existsSync(file)) await unlink(file)
}
