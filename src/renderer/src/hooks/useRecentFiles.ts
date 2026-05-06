import { useEffect, useState, useCallback } from 'react'
import type { SettingsKey } from '@shared/api'

export type RecentFileBucket = 'video' | 'audio' | 'image'

const KEY: Record<RecentFileBucket, SettingsKey> = {
  video: 'recentFiles.video',
  audio: 'recentFiles.audio',
  image: 'recentFiles.image'
}

const MAX_RECENT = 10

export interface UseRecentFilesResult {
  recent: string[]
  push: (filePath: string) => Promise<void>
  clear: () => Promise<void>
  refresh: () => Promise<void>
}

export function useRecentFiles(bucket: RecentFileBucket): UseRecentFilesResult {
  const [recent, setRecent] = useState<string[]>([])

  const refresh = useCallback(async (): Promise<void> => {
    const stored = await window.api.settings.get<string[]>(KEY[bucket])
    setRecent(stored ?? [])
  }, [bucket])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const push = useCallback(
    async (filePath: string): Promise<void> => {
      if (!filePath) return
      const existing = (await window.api.settings.get<string[]>(KEY[bucket])) ?? []
      const next = [filePath, ...existing.filter((p) => p !== filePath)].slice(0, MAX_RECENT)
      await window.api.settings.set(KEY[bucket], next)
      setRecent(next)
    },
    [bucket]
  )

  const clear = useCallback(async (): Promise<void> => {
    await window.api.settings.set(KEY[bucket], [])
    setRecent([])
  }, [bucket])

  return { recent, push, clear, refresh }
}
