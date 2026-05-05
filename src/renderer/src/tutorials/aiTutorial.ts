import type { TutorialDef } from './types'

export const aiTutorial: TutorialDef = {
  id: 'ai',
  title: 'References',
  intro: 'Reference search + mood boards, both fully local-first.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome',
      body: "Two tabs: Reference Search for finding inspiration, and Mood Boards for saving the things you like for later.",
      placement: 'center'
    },
    {
      id: 'tabs',
      title: 'The two tabs',
      body: "Reference Search hits DuckDuckGo with strict SafeSearch on. Mood Boards stores your saved references locally — no account needed.",
      targetSelector: '[data-tutorial="ai-tabs"]',
      placement: 'bottom'
    },
    {
      id: 'canvas',
      title: 'Drop into the canvas',
      body: "On any saved mood-board item, hover and click '→ Canvas' to drop it as a 40%-opacity reference layer in the Image Canvas — perfect for tracing or composition.",
      placement: 'center'
    },
    {
      id: 'done',
      title: 'All set',
      body: "Replay this tour anytime via the ? button in the header.",
      placement: 'center'
    }
  ]
}
