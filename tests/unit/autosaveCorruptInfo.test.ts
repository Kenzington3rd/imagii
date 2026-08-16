import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

/**
 * T-33 — the autosave corruption banner, and the field contract that makes
 * it renderable.
 *
 * Before T-33 this file pinned a MISMATCH: `AutosaveRestore.tsx` gated its
 * corruption branch — "An autosave was found (…) but failed validation: …"
 * with its **Clear** and **Dismiss** buttons — on `result.info.ageMs`, and
 * main's reader returned `{ exists, filePath, sizeBytes }` with no ageMs for
 * exactly the files that fail validation. A user whose autosave was corrupt
 * saw nothing at all on Home: no banner, no Clear, and not even the
 * "Last autosave: …" line.
 *
 * The contract chosen for the fix, pinned in both halves below:
 *
 *   1. `AutosaveInfo.ageMs` is "how long ago this autosave was written" and
 *      is present whenever the file can be stat'd. It comes from the
 *      project's own `savedAt` when the file validates, and from the FILE'S
 *      mtime when it does not — a corrupt file has no trustworthy savedAt,
 *      but the filesystem still knows when it was written, and the age is
 *      what makes the banner copy honest ("found (5 min ago)").
 *   2. `savedAt` stays undefined for a corrupt file. It is the in-file
 *      field, and there is no in-file value to trust.
 *   3. The renderer's corruption branch requires only `info.exists`. Age is
 *      decoration there, never a gate — a corrupt autosave must surface even
 *      if the stat fails, because silence is the worst outcome for a user
 *      whose work did not survive.
 *
 * The end states of Clear and Dismiss are driven in
 * `tests/e2e/home-chrome.spec.ts` ("a corrupt autosave surfaces the
 * corruption banner…").
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

const TEN_MINUTES_MS = 10 * 60 * 1000
/** Slack for the gap between the utimes call and the read under test. */
const AGE_SLACK_MS = 60 * 1000

/** Backdate a file's mtime so an mtime-derived age is distinguishable. */
async function backdate(file: string, ms: number): Promise<void> {
  const when = new Date(Date.now() - ms)
  await utimes(file, when, when)
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'imagii-autosave-corrupt-'))
  await mkdir(autosaveDir(), { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('corrupt autosave: what main reports', () => {
  it('readAutosave refuses it, says it exists, and ages it off the file mtime', async () => {
    const { readAutosave } = await buildAutosaveModule()
    await writeFile(primary(), TRUNCATED, 'utf8')
    await backdate(primary(), TEN_MINUTES_MS)

    const result = await readAutosave()

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/^invalid JSON: /)
    expect(result.info?.exists).toBe(true)
    expect(result.info?.sizeBytes).toBe(TRUNCATED.length)
    // The field the renderer's corruption branch used to require and never
    // got. It is present now, and it is the FILE's age: an unparseable file
    // has no savedAt to trust, but its mtime is a real timestamp.
    expect(result.info?.ageMs).toBeGreaterThanOrEqual(TEN_MINUTES_MS - AGE_SLACK_MS)
    expect(result.info?.ageMs).toBeLessThan(TEN_MINUTES_MS + AGE_SLACK_MS)
    // savedAt is the IN-FILE field and stays absent: there is no trustworthy
    // value for it, and inventing one would make the banner lie.
    expect(result.info?.savedAt).toBeUndefined()
  })

  it('getAutosaveInfo reports the same shape, so the status line renders too', async () => {
    const { getAutosaveInfo } = await buildAutosaveModule()
    await writeFile(primary(), TRUNCATED, 'utf8')
    await backdate(primary(), TEN_MINUTES_MS)

    const info = await getAutosaveInfo()

    expect(info.exists).toBe(true)
    expect(info.sizeBytes).toBe(TRUNCATED.length)
    expect(info.ageMs).toBeGreaterThanOrEqual(TEN_MINUTES_MS - AGE_SLACK_MS)
    expect(info.ageMs).toBeLessThan(TEN_MINUTES_MS + AGE_SLACK_MS)
    expect(info.savedAt).toBeUndefined()
  })

  it('a VALID autosave ages off its own savedAt, not the mtime', async () => {
    const { getAutosaveInfo, readAutosave } = await buildAutosaveModule()
    const savedAt = Date.now() - TEN_MINUTES_MS
    await writeFile(
      primary(),
      JSON.stringify({
        schemaVersion: 2,
        savedAt,
        appVersion: '1.0.0',
        imageCanvas: { doc: { width: 10, height: 10, background: '#fff', layers: [] } }
      }),
      'utf8'
    )
    // The file was written just now, so mtime and savedAt disagree by ten
    // minutes — which half answers is observable.
    const result = await readAutosave()
    const info = await getAutosaveInfo()

    expect(result.ok).toBe(true)
    expect(result.info?.savedAt).toBe(savedAt)
    expect(result.info?.ageMs).toBeGreaterThanOrEqual(TEN_MINUTES_MS - AGE_SLACK_MS)
    expect(info.savedAt).toBe(savedAt)
    expect(info.ageMs).toBeGreaterThanOrEqual(TEN_MINUTES_MS - AGE_SLACK_MS)
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

  /** The `!result.ok` branch — the only one that renders Clear / Dismiss. */
  const branch = source.slice(
    source.indexOf('} else if ('),
    source.indexOf('setSnapshot({ ...result')
  )

  it('the corruption branch asks only whether the file exists', () => {
    expect(branch).toContain('!result.ok')
    expect(branch).toContain('result.info?.exists')
    // The two gates that made the banner dead code. Age is decoration in
    // this branch, not a condition, and a corrupt autosave is never hidden
    // for being old — Clear is the only way to get rid of it.
    expect(branch).not.toContain('ageMs')
    expect(branch).not.toContain('STALE_THRESHOLD_MS')
  })

  it('the fresh-restore branch still gates on age — a stale project is not offered', () => {
    const restoreBranch = source.slice(
      source.indexOf('if (\n        result.ok'),
      source.indexOf('} else if (')
    )
    expect(restoreBranch).toContain('result.info?.ageMs !== undefined')
    expect(restoreBranch).toContain('STALE_THRESHOLD_MS')
  })

  it('Clear and Dismiss exist in the markup that branch gates', () => {
    expect(source).toContain('but failed validation')
    expect(source).toMatch(/>\s*Clear\s*</)
    expect(source).toMatch(/>\s*Dismiss\s*</)
  })

  it('the age is rendered defensively, so a failed stat still shows the banner', () => {
    expect(source).toContain(": 'unknown'")
  })
})
