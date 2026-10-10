import type { TutorialDef } from './types'

/**
 * T-86 copy rules, held by tests/unit/tutorialCopy.test.ts:
 *  - A control is named the way the screen names it, in 'single quotes'.
 *    The test looks every quoted name up in the studio's own source.
 *  - Two short sentences a step, plain words — no jargon, no "New:", no
 *    "Step N:" (the counter numbers the steps; a step that is not on screen
 *    is skipped, so a baked-in number would skip with it).
 *  - A step claims only what the code does.
 */
export const videoTutorial: TutorialDef = {
  id: 'video',
  title: 'Video Studio',
  intro: 'Trim a video and export it sized for every social platform.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Video Studio',
      body: 'Trim a video, crop it, add text, and export it for YouTube, Reels, TikTok, X, or Facebook. Press the ? button in the header to replay this tour.',
      placement: 'center'
    },
    {
      id: 'import',
      title: 'Drop a video in',
      body: "Drag a video onto this card, or click 'Choose file…'. Most common video formats work, and the card lists them.",
      targetSelector: '[data-tutorial="video-import"]',
      placement: 'right'
    },
    {
      id: 'player',
      title: 'Preview',
      body: 'Click the player, then press Space to play or pause and the arrow keys to nudge 0.1 seconds. Press I and O to set the in and out points at the playhead.',
      targetSelector: '[data-tutorial="video-player"]',
      placement: 'top'
    },
    {
      id: 'trim',
      title: 'Trim',
      body: 'Drag the red handles at either end of the highlighted range to trim the clip. The amber line is the playhead — click or drag the track to move it.',
      targetSelector: '[data-tutorial="video-timeline"]',
      placement: 'top'
    },
    {
      id: 'crop',
      title: 'Crop (optional)',
      body: "Check 'Crop' above the player, then drag the box or pick a shape: free, 16:9, 9:16, 1:1, or 4:5. Each platform takes a centered cut of your crop.",
      targetSelector: '[data-tutorial="video-crop"]',
      placement: 'top'
    },
    {
      id: 'highlight',
      title: 'Smart highlight finder',
      body: "Click 'Scan VOD' to find the loud moments in a long recording — yelling, laughter, hype. Click '+ Clip' on a result to add it to your clips.",
      targetSelector: '[data-tutorial="video-highlights"]',
      placement: 'top'
    },
    {
      id: 'reframe',
      title: 'Reframe to 9:16',
      body: "For a horizontal video, 'Reframe to 9:16' cuts a vertical strip for TikTok, Reels, and Shorts: pick Left, Center, or Right. It does not follow faces or action.",
      targetSelector: '[data-tutorial="video-reframe"]',
      placement: 'top'
    },
    {
      id: 'captions',
      title: 'Auto-captions',
      body: "Click 'Transcribe' to turn speech into captions — the first time, a card walks you through a one-time setup. Then 'Save .srt' keeps the text, or 'Burn into video' makes a separate captioned MP4.",
      targetSelector: '[data-tutorial="video-captions"]',
      placement: 'top'
    },
    {
      id: 'platforms',
      title: 'Pick your platforms',
      body: 'Check the platforms you post to. Each shows Great, OK, or what is wrong, like Too long or Wrong shape.',
      targetSelector: '[data-tutorial="video-export"]',
      placement: 'top'
    },
    {
      id: 'watermark',
      title: 'Add a watermark',
      body: "Fill in 'Watermark' to stamp your handle on exports. After you have exported with one, Clip Kit stamps it too.",
      targetSelector: '[data-tutorial="video-export"]',
      placement: 'top'
    },
    {
      id: 'export',
      title: 'Export',
      body: "Click 'Choose folder…', then click the Export button — it says how many files it will write. 'Show in folder' beside a finished file reveals it in Explorer.",
      targetSelector: '[data-tutorial="video-export"]',
      placement: 'top'
    },
    {
      id: 'done',
      title: "You're all set",
      body: 'The ? button in the header replays this tour any time. It only points at what is on screen, so it covers more once a video is loaded.',
      placement: 'center'
    }
  ]
}
