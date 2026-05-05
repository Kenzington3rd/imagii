export type SafetyResult =
  | { allowed: true }
  | {
      allowed: false
      category: string
      friendlyMessage: string
    }

export interface NsfwScore {
  label: string
  score: number
}

export interface NsfwResult {
  blocked: boolean
  scores: NsfwScore[]
  reason?: string
}
