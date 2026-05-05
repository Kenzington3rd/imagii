import blocklistJson from './blocklist.json' with { type: 'json' }
import type { SafetyResult } from '../../shared/safety'

interface BlocklistDoc {
  categories: Record<string, string[]>
  version: number
  updated: string
}

const blocklist = blocklistJson as BlocklistDoc

const FRIENDLY: Record<string, string> = {
  explicit: 'imagii blocks explicit content. Try a different prompt.',
  minors:
    'imagii cannot generate images involving minors. Please rephrase your prompt with adult subjects.',
  violence: 'imagii blocks graphic violence in generated content.',
  harm: 'imagii blocks prompts that could facilitate physical harm.',
  real_people_explicit:
    'imagii does not generate explicit imagery of real or named public figures.'
}

export function checkPrompt(prompt: string): SafetyResult {
  const normalized = ` ${prompt.toLowerCase()} `
  for (const [category, terms] of Object.entries(blocklist.categories)) {
    for (const term of terms) {
      const t = term.toLowerCase()
      if (t.includes(' ')) {
        if (normalized.includes(` ${t} `) || normalized.includes(t)) {
          return {
            allowed: false,
            category,
            friendlyMessage: FRIENDLY[category] ?? 'That term is not allowed.'
          }
        }
      } else {
        const wb = new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i')
        if (wb.test(prompt)) {
          return {
            allowed: false,
            category,
            friendlyMessage: FRIENDLY[category] ?? 'That term is not allowed.'
          }
        }
      }
    }
  }
  return { allowed: true }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
