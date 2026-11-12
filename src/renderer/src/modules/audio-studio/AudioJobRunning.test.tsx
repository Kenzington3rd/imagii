import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AudioExportJob } from './state/audioExport'
import { audioJobRow, AudioJobRunning } from './AudioJobRunning'

// A server render reads zustand's SERVER snapshot (a store's initial state, whatever a test set), so the two stores the card reads are plain objects here,
// the way VideoJobsRunning.test.tsx does it. The row choice is a pure function and needs none of this.
const held = vi.hoisted(() => ({
  audio: { source: null } as Record<string, unknown>,
  exp: { running: false, job: null, sourceName: null } as Record<string, unknown>
}))
vi.mock('./state/audioStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./state/audioStore')>()),
  useAudioStore: <T,>(selector: (s: Record<string, unknown>) => T): T => selector(held.audio)
}))
vi.mock('./state/audioExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./state/audioExport')>()),
  useAudioExport: <T,>(selector: (s: Record<string, unknown>) => T): T => selector(held.exp)
}))

/**
 * T-146 - the closed sound's running export. Closing the sound took the Export panel's bar and Cancel with it while main kept rendering; the card draws the
 * export, and the Close question (AudioStudio.test.ts) names what keeps going.
 */
const job = (over: Partial<AudioExportJob> = {}): AudioExportJob => ({ jobId: 'a', pass: 'render', plan: ['render'], percent: 40, ...over })

describe('audioJobRow - which export the card draws (T-146)', () => {
  it('is null with no export running, and for a row left over from a finished one', () => {
    expect(audioJobRow({ running: false, job: null, sourceName: null })).toBeNull()
    expect(audioJobRow({ running: false, job: job({ percent: 100, outputPath: '/o/a.mp3' }), sourceName: 'voice.wav' })).toBeNull()
    expect(audioJobRow({ running: true, job: null, sourceName: 'voice.wav' })).toBeNull()
  })

  it('names the export, the file it is for, its pass and its percent as the panel shows them', () => {
    expect(audioJobRow({ running: true, job: job({ percent: 40.4 }), sourceName: 'voice.wav' })).toEqual({
      label: 'Export — voice.wav',
      pass: 'Rendering…',
      percent: '40%',
      cancelTitle: 'Cancel export'
    })
  })

  it('says which step of a re-attach it is on, and the bare job when the name is empty', () => {
    const row = audioJobRow({ running: true, job: job({ pass: 'mux', plan: ['render', 'mux'], percent: 12 }), sourceName: ' ' })
    expect(row?.pass).toBe('Step 2 of 2 — attaching to video')
    expect(row?.label).toBe('Export')
  })
})

describe('AudioJobRunning - the card (T-146)', () => {
  const html = (): string => renderToStaticMarkup(<AudioJobRunning />)
  beforeEach(() => {
    held.audio = { source: null }
    held.exp = { running: false, job: null, sourceName: null }
  })

  it('is an always-mounted polite region, empty and taking no gap, while nothing runs', () => {
    expect(html()).toBe('<div aria-live="polite" class="-mb-5"></div>')
  })

  it('stays empty while a sound is open, whatever runs: the Export panel draws the job then', () => {
    held.audio = { source: { filePath: '/s/voice.wav' } }
    held.exp = { running: true, job: job(), sourceName: 'voice.wav' }
    expect(html()).toBe('<div aria-live="polite" class="-mb-5"></div>')
  })

  it('draws the export, its Cancel (named for the job) and the one sentence, in the same region, once the sound is closed', () => {
    held.exp = { running: true, job: job({ percent: 40 }), sourceName: 'voice.wav' }
    const out = html()
    expect(out).toMatch(/^<div aria-live="polite">/)
    expect(out).not.toContain('-mb-5')
    expect(out).toContain('Export — voice.wav')
    expect(out).toContain('Rendering…')
    expect(out).toMatch(/<span[^>]*aria-hidden="true"[^>]*>40%<\/span>/)
    expect(out).toMatch(/<button[^>]*title="Cancel export"[^>]*>Cancel<\/button>/)
    expect(out).toContain('The sound is closed; the export keeps going until it finishes or you cancel it.')
  })

  it('draws nothing once the export has ended, though its row stays in the store', () => {
    held.exp = { running: false, job: job({ percent: 100, outputPath: '/o/a.mp3' }), sourceName: 'voice.wav' }
    expect(html()).toBe('<div aria-live="polite" class="-mb-5"></div>')
  })
})
