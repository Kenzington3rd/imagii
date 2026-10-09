import { describe, it, expect } from 'vitest'
import {
  AUDIO_FORMAT_LABELS,
  AUDIO_PASS_LABELS,
  AUDIO_SAVE_FORMATS,
  audioFileExtension,
  type AudioOutputFormat
} from './audio'

const EXPORT_FORMATS: AudioOutputFormat[] = ['mp3', 'wav', 'flac', 'aac']

describe('audioFileExtension (T-90)', () => {
  it('saves AAC as .m4a — a bare .aac is a raw stream most players refuse', () => {
    expect(audioFileExtension('aac')).toBe('m4a')
  })

  it('leaves every other format under its own name', () => {
    for (const f of ['mp3', 'wav', 'flac', 'mp4'] as const) expect(audioFileExtension(f)).toBe(f)
  })

  it('has a save format for every export format, plus the re-attach mp4', () => {
    for (const f of EXPORT_FORMATS) expect(AUDIO_SAVE_FORMATS).toContain(f)
    expect(AUDIO_SAVE_FORMATS).toContain('mp4')
    expect(AUDIO_SAVE_FORMATS).toHaveLength(EXPORT_FORMATS.length + 1)
  })
})

describe('the Export panel\'s names', () => {
  it('labels every format, and AAC says what the file will be called', () => {
    for (const f of EXPORT_FORMATS) expect(AUDIO_FORMAT_LABELS[f].length).toBeGreaterThan(0)
    expect(AUDIO_FORMAT_LABELS.aac).toBe('AAC (.m4a)')
    expect(AUDIO_FORMAT_LABELS.mp3).toBe('MP3')
  })

  it('names each phase in plain words, never the pass id', () => {
    expect(AUDIO_PASS_LABELS).toEqual({
      measure: 'Measuring loudness…',
      render: 'Rendering…',
      mux: 'Attaching to video…'
    })
  })
})
