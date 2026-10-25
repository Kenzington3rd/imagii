import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { MAX_PROJECT_BYTES, MAX_SCHEMA_VERSION, serializeProject, validateProjectJsonString } from '../../shared/projectValidation'
import { userFacingError } from '../../shared/userFacingError'
import type { ImagiiProject } from '../../shared/workspace'

/**
 * T-137 (6) - `project:save` holds the SAME size rule Open and autosave hold, on the same serialization, and refuses BEFORE it asks where to save.
 *
 * It wrote `JSON.stringify(project, null, 2)` with no size gate: four 11 MB pictures autosaved nothing (autosave refused), Save wrote 56.9 MiB and
 * the toast said "Project saved", and Open refused the file with the damaged-file sentence. Now the handler serializes once (compact, the form autosave
 * measures), measures that string, throws a finished sentence over the limit (no dialog, no file) and writes exactly the string it measured, so a file
 * it writes is always one Open accepts.
 *
 * This runs the REAL handler with real files; only electron is stood in for. The end-to-end version (the Save button and the toast the person reads) is in
 * continuity.spec.ts.
 */
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const showSaveDialog = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args), showOpenDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => ({}), getAllWindows: () => [{}] },
  app: { getVersion: () => '1.2.3', getPath: () => tmpdir() }
}))
vi.mock('../autosave', () => ({
  writeAutosave: vi.fn(),
  readAutosave: vi.fn(),
  clearAutosave: vi.fn(),
  getAutosaveInfo: vi.fn()
}))

const { registerProjectIpc } = await import('./project')

const NOW = 1_700_000_000_000

/** A valid project (as the handler enriches it: this savedAt and this appVersion) whose compact JSON is exactly `size` characters. */
function projectOfSize(size: number): ImagiiProject {
  const withSrc = (src: string): ImagiiProject => ({
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: NOW,
    appVersion: '1.2.3',
    imageCanvas: {
      doc: {
        width: 1280,
        height: 720,
        background: '#ffffff',
        layers: [
          { id: 'img1', type: 'image', name: 'big.png', visible: true, locked: false, x: 60, y: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, src, width: 100, height: 100 }
        ]
      }
    }
  })
  return withSrc('A'.repeat(size - serializeProject(withSrc('')).length))
}

const save = (project: unknown): Promise<unknown> => {
  const handler = handlers.get('project:save')
  if (!handler) throw new Error('project:save was not registered')
  return handler({}, project, 'project.imagii.json')
}

let scratch = ''
let picked = ''
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  scratch = mkdtempSync(path.join(tmpdir(), 'imagii-projsave-'))
  picked = path.join(scratch, 'out.imagii.json')
  showSaveDialog.mockReset()
  showSaveDialog.mockResolvedValue({ canceled: false, filePath: picked })
  handlers.clear()
  registerProjectIpc()
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(scratch, { recursive: true, force: true })
})

describe('project:save - the size rule (T-137 (6))', () => {
  it('a project over the limit is refused in a finished sentence, BEFORE the dialog, and no file is written', async () => {
    const err = await save(projectOfSize(MAX_PROJECT_BYTES + 1)).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message).toBe(
      'This project is too large to save (50.1 MB; the limit is 50 MB). Remove or shrink large images on the canvas, then save again.'
    )
    expect(showSaveDialog, 'the person is not asked where to save a file that will not be written').not.toHaveBeenCalled()
    expect(existsSync(picked)).toBe(false)
    // Through the bridge's envelope it reaches the toast as written, not as the generic fallback.
    const wrapped = new Error(`Error invoking remote method 'project:save': Error: ${message}`)
    expect(userFacingError(wrapped, "Couldn't save the project.").message).toBe(message)
  })

  it('a project exactly at the limit is written, and the file it wrote is one Open accepts', async () => {
    const result = await save(projectOfSize(MAX_PROJECT_BYTES))
    expect(result).toBe(picked)
    expect(statSync(picked).size, 'every character is ASCII: bytes on disk are the characters measured').toBe(MAX_PROJECT_BYTES)
    const opened = validateProjectJsonString(readFileSync(picked, 'utf8'))
    expect(opened.ok, opened.ok ? '' : opened.reason).toBe(true)
  })

  it('the file is the compact serialization the size was measured on (not a pretty-printed one that is bigger than the figure)', async () => {
    const project = projectOfSize(2000)
    await save(project)
    expect(readFileSync(picked, 'utf8')).toBe(serializeProject(project))
  })

  it('a canceled dialog writes nothing and says nothing (the size check does not turn a cancel into an error)', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await save(projectOfSize(2000))).toBeNull()
    expect(existsSync(picked)).toBe(false)
  })

  it('a project the validator refuses still stops at the validator, not at the size rule', async () => {
    const bad = { ...projectOfSize(2000), schemaVersion: 99 }
    const err = await save(bad).then(() => null, (e: unknown) => e)
    expect((err as Error).message).toMatch(/unsupported schemaVersion/)
    expect(showSaveDialog).not.toHaveBeenCalled()
  })
})
