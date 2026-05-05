import type { TutorialDef } from './types'

export const audioTutorial: TutorialDef = {
  id: 'audio',
  title: 'Audio Studio',
  intro: 'Make raw recordings sound podcast-clean.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Audio Studio',
      body: "This studio cleans up audio: removes background noise, evens out levels, polishes voice for streaming and podcasts. Replay this anytime with the ? button.",
      placement: 'center'
    },
    {
      id: 'import',
      title: 'Step 1: Import audio (or extract from video)',
      body: "Drop an audio file (MP3, WAV, FLAC, AAC, M4A, OGG, OPUS) or any video file (we'll extract its audio automatically).",
      targetSelector: '[data-tutorial="audio-importer"]',
      placement: 'right'
    },
    {
      id: 'waveform',
      title: 'Step 2: The waveform',
      body: "Click and drag on the waveform to mark regions you want to cut out. Click any cut tag to undo it.",
      targetSelector: '[data-tutorial="audio-waveform"]',
      placement: 'bottom'
    },
    {
      id: 'fix-wizard',
      title: 'New: Quick fix wizard',
      body: "If you're not sure what to enable, click 'Help me fix this' for a 3-question walkthrough that auto-configures the chain. Three clicks to podcast-grade.",
      targetSelector: '[data-tutorial="audio-fixwizard"]',
      placement: 'left'
    },
    {
      id: 'cleanup',
      title: 'Step 3: Cleanup panel',
      body: "Pick a denoise strength (light / medium / aggressive), and toggle the targeted filters: low rumble, 60 Hz hum, de-essing. Each toggle independently adds to the FFmpeg chain.",
      targetSelector: '[data-tutorial="audio-cleanup"]',
      placement: 'left'
    },
    {
      id: 'levels',
      title: 'Step 4: Levels',
      body: "Pick a compressor preset (voice for streaming, music for songs), set Normalize to LUFS to −16 (podcast standard). The two-pass loudnorm makes everything sound consistent.",
      targetSelector: '[data-tutorial="audio-levels"]',
      placement: 'left'
    },
    {
      id: 'music',
      title: 'New: Background music + ducking',
      body: "Add a music track to play under your voice. The 'Duck under voice' option side-chains the music down when you talk, so you cut through.",
      targetSelector: '[data-tutorial="audio-music"]',
      placement: 'left'
    },
    {
      id: 'multitrack',
      title: 'New: Multi-track import',
      body: "If you record mic and game on separate tracks (OBS does this), you can load both, level them independently, then mix down.",
      targetSelector: '[data-tutorial="audio-multitrack"]',
      placement: 'left'
    },
    {
      id: 'export',
      title: 'Step 5: Export',
      body: "Pick a format (MP3 / WAV / FLAC / AAC) and bitrate, then click Export. If you imported audio from a video, you can re-attach the cleaned audio to the original.",
      targetSelector: '[data-tutorial="audio-export"]',
      placement: 'top'
    },
    {
      id: 'done',
      title: 'All set',
      body: "Use the ? button in the header to revisit this tour anytime.",
      placement: 'center'
    }
  ]
}
