import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * T-21 FINDING D — the autosave corruption banner cannot render.
 *
 * `AutosaveRestore.tsx` offers "An autosave was found (…) but failed
 * validation: … You can clear it." with a **Clear** and a **Dismiss** button.
 * Both are dead controls: the branch that renders them is gated on
 * `result.info?.ageMs !== undefined`, and main's reader never reports an
 * ageMs for a file that fails validation — there is no trustworthy `savedAt`
 * to measure, so the invalid path returns `{ exists, filePath, sizeBytes }`
 * only. The same missing field also suppresses the "Last autosave: …" line,
 * so a user whose autosave is corrupt sees nothing at all on Home.
 *
 * This file pins BOTH sides of the mismatch — the shape main returns and the
 * condition the renderer requires — so the day the branch is fixed, this test
 * fails and points at the ledger rows (Home: AutosaveRestore Clear /
 * Dismiss) that then need their disposition changed from "unreachable" to a
 * real end-state test. The reachable half (a corrupt autosave is never
 * applied and is left on disk) is covered end-to-end by
 * `tests/e2e/home-chrome.spec.ts`.
 *
 * Mocking follows `src/main/autosave.test.ts`: electron's `app.getPath` is
 * stubbed to a per-test temp dir via vi.doMock + dynamic import.
 */

let tempDir: string

function buildAutosaveModule(): Promise<typeof import('../../src/main/autosave')> {
  vi.resetModules()
  vi.doMock('electron', () => ({ app: { getPath: () => tempDir } }))
  return import('../../src/main/autosave')
}

const autosaveDir = (): string => path.join(tempDir, 'autosave')
const primary = (): string => path.join(autosaveDir(), 'autosave.json')

// Truncated mid-object: what a crash during a write leaves on disk, and the
// exact bytes the E2E spec seeds.
const TRUNCATED = '{"schemaVersion":2,"savedAt":175534'

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'imagii-autosave-corrupt-'))
  await mkdir(autosaveDir(), { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('corrupt autosave: what main reports', () => {
  it('readAutosave refuses it, says it exists, and reports no ageMs', async () => {
    const { readAutosave } = await buildAutosaveModule()
    await writeFile(primary(), TRUNCATED, 'utf8')

    const result = await readAutosave()

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/^invalid JSON: /)
    expect(result.info?.exists).toBe(true)
    expect(result.info?.sizeBytes).toBe(TRUNCATED.length)
    // The field the renderer's corruption branch requires — absent by
    // construction, because an unparseable file has no savedAt to age.
    expect(result.info?.ageMs).toBeUndefined()
    expect(result.info?.savedAt).toBeUndefined()
  })

  it('getAutosaveInfo reports the same shape, so the status line is empty too', async () => {
    const { getAutosaveInfo } = await buildAutosaveModule()
    await writeFile(primary(), TRUNCATED, 'utf8')

    const info = await getAutosaveInfo()

    expect(info.exists).toBe(true)
    expect(info.sizeBytes).toBe(TRUNCATED.length)
    expect(info.ageMs).toBeUndefined()
  })

  it('a VALID autosave does carry ageMs — the field is missing only when validation fails', async () => {
    const { getAutosaveInfo, readAutosave } = await buildAutosaveModule()
    await writeFile(
      primary(),
      JSON.stringify({
        schemaVersion: 2,
        savedAt: Date.now(),
        appVersion: '1.0.0',
        imageCanvas: { doc: { width: 10, height: 10, background: '#fff', layers: [] } }
      }),
      'utf8'
    )

    const result = await readAutosave()
    const info = await getAutosaveInfo()

    expect(result.ok).toBe(true)
    expect(result.info?.ageMs).toBeGreaterThanOrEqual(0)
    expect(info.ageMs).toBeGreaterThanOrEqual(0)
  })
})

describe('corrupt autosave: what the renderer requires', () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      'src/renderer/src/components/AutosaveRestore.tsx'
    ),
    'utf8'
  )

  it('the corruption branch still demands an ageMs main never sends', () => {
    // The `!result.ok` branch — the only one that can set a snapshot without a
    // project, i.e. the only one that renders Clear / Dismiss.
    const branch = source.slice(source.indexOf('} else if ('), source.indexOf('setSnapshot({ ...result'))
    expect(branch).toContain('!result.ok')
    expect(branch).toContain('result.info?.exists')
    expect(branch).toContain('result.info?.ageMs !== undefined')
  })

  it('Clear and Dismiss exist in the markup that branch gates', () => {
    expect(source).toContain('but failed validation')
    expect(source).toMatch(/>\s*Clear\s*</)
    expect(source).toMatch(/>\s*Dismiss\s*</)
  })
})
