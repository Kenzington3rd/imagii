import type { TutorialDef } from './types'

export const aiTutorial: TutorialDef = {
  id: 'ai',
  title: 'AI Art',
  intro: 'AI image generation, reference search, and mood boards.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to AI Art',
      body: "Five tabs: Generate, Expand, Inpaint, Reference Search, and Mood Boards. Reference search and mood boards work right away. The three AI generation tabs need two extra files installed (we'll show you).",
      placement: 'center'
    },
    {
      id: 'setup',
      title: 'Setup card',
      body: "If this yellow card is showing, AI generation isn't ready yet. The card has download links and 'Open this folder' buttons. Once you place sd.exe + the model in the right spots and restart, generation tabs come online.",
      targetSelector: '[data-tutorial="ai-setup"]',
      placement: 'bottom'
    },
    {
      id: 'tabs',
      title: 'The five tabs',
      body: "Generate = text-to-image. Expand = outpaint, fill in around an existing image. Inpaint = paint a mask, describe what should replace the masked area. Reference Search = inspiration. Mood Boards = save references locally.",
      targetSelector: '[data-tutorial="ai-tabs"]',
      placement: 'bottom'
    },
    {
      id: 'reference',
      title: 'Reference Search (works without setup)',
      body: "Search for inspiration. SafeSearch is permanently on and every thumbnail is screened locally before display. Click ★ on any result to save to a mood board.",
      targetSelector: '[data-tutorial="ai-tabs"]',
      placement: 'bottom'
    },
    {
      id: 'moodboard',
      title: 'Mood Boards (works without setup)',
      body: "Boards persist locally — no account needed. Hover an item and click '→ Canvas' to add it to the Image Canvas as a 40%-opacity reference layer for tracing or composition.",
      targetSelector: '[data-tutorial="ai-tabs"]',
      placement: 'bottom'
    },
    {
      id: 'safety',
      title: 'Safety',
      body: "All AI outputs pass through NudeNet (when installed) before being shown to you. Filtered images appear as a 🛡 placeholder. The prompt blocklist filters explicit and harmful prompts before they reach the model.",
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
