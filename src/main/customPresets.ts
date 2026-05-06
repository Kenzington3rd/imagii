import { app } from 'electron'
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type { CustomPreset } from '../shared/customPresets'

function dir(): string {
  return path.join(app.getPath('userData'), 'export-presets')
}

async function ensureDir(): Promise<void> {
  await mkdir(dir(), { recursive: true })
}

export async function listCustomPresets(): Promise<CustomPreset[]> {
  await ensureDir()
  if (!existsSync(dir())) return []
  const files = await readdir(dir())
  const presets: CustomPreset[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const raw = await readFile(path.join(dir(), f), 'utf8')
      presets.push(JSON.parse(raw) as CustomPreset)
    } catch {
      continue
    }
  }
  presets.sort((a, b) => a.name.localeCompare(b.name))
  return presets
}

export async function saveCustomPreset(p: Omit<CustomPreset, 'id'>): Promise<CustomPreset> {
  await ensureDir()
  const preset: CustomPreset = { ...p, id: nanoid(10) }
  await writeFile(path.join(dir(), `${preset.id}.json`), JSON.stringify(preset, null, 2), 'utf8')
  return preset
}

export async function deleteCustomPreset(id: string): Promise<void> {
  const file = path.join(dir(), `${id}.json`)
  if (existsSync(file)) await unlink(file)
}
