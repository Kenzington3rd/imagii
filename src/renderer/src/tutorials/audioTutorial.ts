import type { TutorialDef } from './types'

// Copy rules: see the header of videoTutorial.ts (T-86).
export const audioTutorial: TutorialDef = {
  id: 'audio',
  title: 'Audio Studio',
  intro: 'Make raw recordings sound podcast-clean.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Audio Studio',
      body: 'Audio Studio cleans up a recording: it removes background noise, evens out loudness, and polishes a voice for streaming or podcasts. Press the ? button in the header to replay this tour.',
      placement: 'center'
    },
    {
      id: 'import',
      title: 'Drop audio in',
      body: "Drop in an audio file — or a video, and imagii pulls out its audio. Or click 'Choose file…'.",
      targetSelector: '[data-tutorial="audio-importer"]',
      placement: 'right'
    },
    {
      id: 'waveform',
      title: 'The waveform',
      body: 'Drag across the waveform to mark a part to remove. It comes out when you export; click a mark to put it back.',
      targetSelector: '[data-tutorial="audio-waveform"]',
      placement: 'bottom'
    },
    {
      id: 'fix-wizard',
      title: 'Not sure where to start?',
      body: "Click 'Help me fix this' and answer three quick questions. imagii picks the cleanup settings for you.",
      targetSelector: '[data-tutorial="audio-fixwizard"]',
      placement: 'left'
    },
    {
      id: 'cleanup',
      title: 'Cleanup',
      body: "Pick how much to quiet the background: Light, Medium, Aggressive, or Custom. Then tick 'Remove low rumble', 'Hum removal', or 'Softer harsh' sounds as needed.",
      targetSelector: '[data-tutorial="audio-cleanup"]',
      placement: 'left'
    },
    {
      id: 'levels',
      title: 'Levels',
      body: "Pick a Compressor preset: Voice for streaming, Music for songs. Tick 'Even volume' and choose a Platform so every export lands at the same loudness.",
      targetSelector: '[data-tutorial="audio-levels"]',
      placement: 'left'
    },
    {
      id: 'second-track',
      title: 'Add a second track',
      body: "Layer in 'Background music', a 'Second mic', or 'Game audio' alongside your voice. Tick 'Duck under your voice' to turn it down whenever you talk.",
      targetSelector: '[data-tutorial="audio-music"]',
      placement: 'left'
    },
    {
      id: 'export',
      title: 'Export',
      body: "Pick a Format, and a Bitrate for MP3 or AAC, then click 'Export'. For audio taken from a video, 'Re-attach to video' puts the cleaned sound back on the original.",
      targetSelector: '[data-tutorial="audio-export"]',
      placement: 'top'
    },
    {
      id: 'done',
      title: 'All set',
      body: 'The ? button in the header replays this tour any time. It only points at what is on screen, so it covers more once audio is loaded.',
      placement: 'center'
    }
  ]
}
