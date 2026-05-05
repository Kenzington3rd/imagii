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
      presets.push(JSON.parse(raw) as ChainPreset)
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
