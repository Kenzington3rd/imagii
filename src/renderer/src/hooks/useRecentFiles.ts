import { useEffect, useState, useCallback } from 'react'
import type { SettingsKey } from '@shared/api'
import { persistSetting } from '../lib/persistSetting'

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
  /** T-150: drop one path (a Recent entry whose file is gone would fail again on every pick); true when it was in the list. */
  remove: (filePath: string) => Promise<boolean>
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
      await persistSetting(KEY[bucket], next)
      setRecent(next)
    },
    [bucket]
  )

  const remove = useCallback(
    async (filePath: string): Promise<boolean> => {
      // T-151: a refused settings read must not skip the caller's toast (it is awaited inside the importer's catch).
      try {
        const existing = (await window.api.settings.get<string[]>(KEY[bucket])) ?? []
        const next = existing.filter((p) => p !== filePath)
        if (next.length === existing.length) return false
        await persistSetting(KEY[bucket], next)
        setRecent(next)
        return true
      } catch {
        return false
      }
    },
    [bucket]
  )

  const clear = useCallback(async (): Promise<void> => {
    await persistSetting(KEY[bucket], [])
    setRecent([])
  }, [bucket])

  return { recent, push, remove, clear, refresh }
}
