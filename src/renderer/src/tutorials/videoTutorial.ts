import type { TutorialDef } from './types'

export const videoTutorial: TutorialDef = {
  id: 'video',
  title: 'Video Studio',
  intro: 'Trim a video and export sized for every social platform.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Video Studio',
      body: "Trim video, crop for vertical platforms, add text, and export to YouTube / Reels / TikTok / X / Facebook in one click. You can replay this anytime with the ? button in the header.",
      placement: 'center'
    },
    {
      id: 'import',
      title: 'Step 1: Drop a video in',
      body: "Drag a video file onto this zone, or click 'Choose file…'. Supports MP4, MOV, AVI, MKV, WEBM, M4V — pretty much anything.",
      targetSelector: '[data-tutorial="video-import"]',
      placement: 'right'
    },
    {
      id: 'player',
      title: 'Step 2: Preview',
      body: "Once loaded, scrub or use Space to play/pause, ←/→ to nudge by 0.1s, and , / . for frame-by-frame. Press I and O to set the in/out points at the playhead.",
      targetSelector: '[data-tutorial="video-player"]',
      placement: 'top'
    },
    {
      id: 'trim',
      title: 'Step 3: Trim',
      body: "Drag the purple handles on the timeline to trim the clip. The pink line is your playback position.",
      targetSelector: '[data-tutorial="video-timeline"]',
      placement: 'top'
    },
    {
      id: 'highlight',
      title: 'New: Auto-highlight finder',
      body: "Open Auto-Highlights to scan a long VOD for loud moments (yelling, laughter, hype) and turn them into ready-to-export clips.",
      targetSelector: '[data-tutorial="video-highlights"]',
      placement: 'top'
    },
    {
      id: 'reframe',
      title: 'New: Auto-reframe to 9:16',
      body: "If you imported a horizontal gameplay clip, click 'Auto-reframe' to follow the action and produce a vertical version for TikTok / Reels.",
      targetSelector: '[data-tutorial="video-reframe"]',
      placement: 'top'
    },
    {
      id: 'crop',
      title: 'Step 4: Crop (optional)',
      body: "Tick 'Crop' above the player to draw a region. Pick a preset aspect ratio (16:9, 9:16, 1:1, 4:5) for snap-locking.",
      targetSelector: '[data-tutorial="video-crop"]',
      placement: 'top'
    },
    {
      id: 'platforms',
      title: 'Step 5: Pick platforms + watermark',
      body: "Tick the platforms you want. Each shows a green/yellow/red indicator predicting how well your clip works there. The watermark field stamps your @handle on every export.",
      targetSelector: '[data-tutorial="video-export"]',
      placement: 'top'
    },
    {
      id: 'captions',
      title: 'New: Auto-captions',
      body: "Open Captions to transcribe speech and burn captions into the export. Needs whisper.cpp installed (it'll show a setup card if not).",
      targetSelector: '[data-tutorial="video-captions"]',
      placement: 'top'
    },
    {
      id: 'export',
      title: 'Step 6: Export',
      body: "Choose an output folder and click Export. Multiple platforms encode sequentially with a progress bar; click 'Show' on each finished file to reveal it in Explorer.",
      targetSelector: '[data-tutorial="video-export"]',
      placement: 'top'
    },
    {
      id: 'done',
      title: "You're all set",
      body: "The ? button in the header always reopens this tutorial. Have fun.",
      placement: 'center'
    }
  ]
}
