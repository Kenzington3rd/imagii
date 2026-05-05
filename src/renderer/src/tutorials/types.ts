export interface TutorialStep {
  id: string
  title: string
  body: string
  targetSelector?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
}

export type TutorialId = 'video' | 'audio' | 'image' | 'ai'

export interface TutorialDef {
  id: TutorialId
  title: string
  intro: string
  steps: TutorialStep[]
}
