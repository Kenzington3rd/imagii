import { app } from 'electron'
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type { ChainPreset } from '../../shared/workspace'
import type { ChainSpec } from '../../shared/audio'

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
  if (typeof p.id !== 'string' || p.id.length === 0) return null
  if (typeof p.name !== 'string' || p.name.length === 0) return null
  if (typeof p.chain !== 'object' || p.chain === null) return null
  return {
    id: p.id,
    name: p.name,
    chain: p.chain as ChainSpec,
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
    chain,
    createdAt: Date.now()
  }
  await writeFile(
    path.join(presetsDir(), `${preset.id}.json`),
    JSON.stringify(preset, null, 2),
    'utf8'
  )
  return preset
}

export async function deletePreset(id: string): Promise<void> {
  const file = path.join(presetsDir(), `${id}.json`)
  if (existsSync(file)) await unlink(file)
}
