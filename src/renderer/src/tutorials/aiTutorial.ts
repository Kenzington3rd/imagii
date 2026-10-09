import type { TutorialDef } from './types'

// Copy rules: see the header of videoTutorial.ts (T-86).
export const aiTutorial: TutorialDef = {
  id: 'ai',
  title: 'References',
  intro: 'Search for inspiration, save mood boards, and drop in ready-made stream assets.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to References',
      body: 'Three tabs: Reference Search to find inspiration, Mood Boards to save what you like, and Asset Library for free stream assets. Press the ? button in the header to replay this tour.',
      placement: 'center'
    },
    {
      id: 'tabs',
      title: 'The three tabs',
      body: 'Reference Search uses DuckDuckGo with strict SafeSearch and goes online. Your mood boards are saved on your computer, no account needed.',
      targetSelector: '[data-tutorial="ai-tabs"]',
      placement: 'bottom'
    },
    {
      id: 'canvas',
      title: 'Drop into Stream Graphics',
      body: "Hover a saved mood-board item and click '→ Canvas' to add it to Stream Graphics as a 40%-opacity reference layer — handy for tracing or composition.",
      placement: 'center'
    },
    {
      id: 'done',
      title: 'All set',
      body: 'The ? button in the header replays this tour any time.',
      placement: 'center'
    }
  ]
}
