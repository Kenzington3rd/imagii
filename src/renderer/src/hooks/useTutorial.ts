import { useEffect, useState } from 'react'
import type { TutorialDef, TutorialId } from '../tutorials/types'

const settingsKey = (id: TutorialId): string => `tutorialSeen.${id}`

export interface UseTutorialResult {
  active: boolean
  start: () => void
  stop: (didFinish: boolean) => void
}

export function useTutorial(def: TutorialDef, autoStart = true): UseTutorialResult {
  const [active, setActive] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!autoStart) {
      setChecked(true)
      return
    }
    let cancelled = false
    window.api.settings
      .get<boolean>(settingsKey(def.id) as never)
      .then((seen) => {
        if (cancelled) return
        if (!seen) setActive(true)
        setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [def.id, autoStart])

  function start(): void {
    setActive(true)
  }

  function stop(didFinish: boolean): void {
    setActive(false)
    if (didFinish) {
      window.api.settings.set(settingsKey(def.id) as never, true)
    }
  }

  return { active: active && checked, start, stop }
}
