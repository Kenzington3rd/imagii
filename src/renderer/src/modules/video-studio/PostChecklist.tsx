import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { SettingsKey } from '@shared/api'

interface DiaryEntry {
  id: string
  outputName: string
  platforms: string[]
  notes: string
  performance?: { views?: number; likes?: number; comments?: number }
  postedAt?: number
  createdAt: number
}

const STORAGE: SettingsKey = 'streamerHandle' // reused only for handle
const DIARY_KEY = 'imagii.postingDiary'

const HASHTAG_TEMPLATES: Record<string, string[]> = {
  twitch_clip: ['#Twitch', '#TwitchClip', '#StreamHighlight', '#GamingClip'],
  gaming_short: ['#Shorts', '#Gaming', '#Gameplay', '#FYP', '#StreamerLife'],
  reaction: ['#Reaction', '#Funny', '#Streamer', '#FYP'],
  ig_reels_general: ['#Reels', '#ReelsViral', '#ContentCreator'],
  tiktok_general: ['#FYP', '#ForYou', '#Viral'],
  yt_long: ['#YouTube', '#Gaming', '#FullStream', '#Vlog']
}

const TITLE_PATTERNS = [
  '{verb} {subject} on {game}!',
  'When you {verb} {subject} 😱',
  'POV: {subject} happens',
  'I {verb}d a {subject} so you don\'t have to',
  '{subject} is the hardest thing in {game}',
  'Why {subject} broke me',
  'Day {n} of {verb}ing {subject}',
  'Nobody told me {subject} would do this'
]

const VERB_BANK = ['clutched', 'beat', 'reacted to', 'discovered', 'failed', 'tried']
const SUBJECT_BANK = ['boss fight', 'speedrun', 'PvP match', 'achievement', 'glitch']
const GAME_BANK = ['Elden Ring', 'Valorant', 'Fortnite', 'Minecraft', 'Apex']

interface PostChecklistProps {}

export function PostChecklist(_p: PostChecklistProps = {}): JSX.Element {
  const [diary, setDiary] = useState<DiaryEntry[]>([])
  const [outputName, setOutputName] = useState('')
  const [platforms, setPlatforms] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [titles, setTitles] = useState<string[]>([])
  const [hashtagPick, setHashtagPick] =
    useState<keyof typeof HASHTAG_TEMPLATES>('twitch_clip')

  useEffect(() => {
    void load()
  }, [])

  async function load(): Promise<void> {
    try {
      const raw = localStorage.getItem(DIARY_KEY)
      if (raw) setDiary(JSON.parse(raw) as DiaryEntry[])
    } catch {
      /* ignore */
    }
    void STORAGE
  }

  function save(next: DiaryEntry[]): void {
    setDiary(next)
    try {
      localStorage.setItem(DIARY_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  function add(): void {
    if (!outputName.trim()) {
      toast.error('Add a clip name first')
      return
    }
    const entry: DiaryEntry = {
      id: `${Date.now()}`,
      outputName: outputName.trim(),
      platforms,
      notes: notes.trim(),
      createdAt: Date.now()
    }
    save([entry, ...diary].slice(0, 100))
    setOutputName('')
    setPlatforms([])
    setNotes('')
    toast.success('Logged to diary')
  }

  function togglePlatform(p: string): void {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  function generateTitles(): void {
    const out: string[] = []
    // Helper inside the function so Power-of-Ten rule 6 keeps it scoped.
    function pick<T>(bank: readonly T[], fallback: T): T {
      const i = Math.floor(Math.random() * bank.length)
      return bank[i] ?? fallback
    }
    for (let i = 0; i < 4; i++) {
      const pattern = pick(TITLE_PATTERNS, TITLE_PATTERNS[0] ?? '{verb} {subject}')
      const t = pattern
        .replace('{verb}', pick(VERB_BANK, ''))
        .replace('{subject}', pick(SUBJECT_BANK, ''))
        .replace('{game}', pick(GAME_BANK, ''))
        .replace('{n}', String(Math.floor(Math.random() * 365) + 1))
      out.push(t)
    }
    setTitles(out)
  }

  function copy(s: string): void {
    void navigator.clipboard.writeText(s)
    toast.success('Copied')
  }

  function updatePerf(id: string, field: 'views' | 'likes' | 'comments', value: number): void {
    const next = diary.map((e) =>
      e.id === id ? { ...e, performance: { ...(e.performance ?? {}), [field]: value } } : e
    )
    save(next)
  }

  function deleteEntry(id: string): void {
    save(diary.filter((e) => e.id !== id))
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        📋 Posting helpers
      </h3>

      <div className="border-b border-ink-dim/30 pb-3 flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wide text-ink-muted">Title ideas</div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost px-3 py-1 text-xs" onClick={generateTitles}>
            Suggest 4 titles
          </button>
        </div>
        {titles.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs">
            {titles.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex-1">{t}</span>
                <button className="text-accent hover:underline" onClick={() => copy(t)}>
                  copy
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="border-b border-ink-dim/30 pb-3 flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wide text-ink-muted">Hashtag pack</div>
        <select
          className="bg-bg-base rounded px-2 py-1 text-xs"
          value={hashtagPick}
          onChange={(e) => setHashtagPick(e.target.value as keyof typeof HASHTAG_TEMPLATES)}
        >
          {Object.keys(HASHTAG_TEMPLATES).map((k) => (
            <option key={k} value={k}>
              {k.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2 text-xs">
          <code className="bg-bg-hover rounded px-2 py-1 flex-1 truncate font-mono">
            {(HASHTAG_TEMPLATES[hashtagPick] ?? []).join(' ')}
          </code>
          <button
            className="text-accent hover:underline"
            onClick={() => copy((HASHTAG_TEMPLATES[hashtagPick] ?? []).join(' '))}
          >
            copy
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wide text-ink-muted">Posting log</div>
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            placeholder="Clip name"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            className="bg-bg-base rounded px-2 py-1 text-xs"
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            {['YouTube', 'Reels', 'TikTok', 'X', 'Twitch', 'Discord'].map((p) => (
              <button
                key={p}
                onClick={() => togglePlatform(p)}
                className={`px-2 py-0.5 rounded border text-xs ${
                  platforms.includes(p)
                    ? 'bg-accent text-bg-base border-accent'
                    : 'bg-bg-hover border-ink-dim/30'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <textarea
            placeholder="Notes (caption, time, etc.)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="bg-bg-base rounded px-2 py-1 text-xs resize-y"
          />
          <button className="btn-primary px-3 py-1 text-xs self-start" onClick={add}>
            + Log post
          </button>
        </div>
      </div>

      {diary.length > 0 ? (
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          <div className="text-xs uppercase tracking-wide text-ink-muted">
            Diary ({diary.length})
          </div>
          {diary.map((e) => (
            <div
              key={e.id}
              className="bg-bg-hover rounded px-2 py-1.5 text-xs flex flex-col gap-1"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium flex-1 truncate">{e.outputName}</span>
                <span className="text-ink-dim">{e.platforms.join(' · ')}</span>
                <button
                  onClick={() => deleteEntry(e.id)}
                  className="text-ink-dim hover:text-rose-300"
                >
                  ✕
                </button>
              </div>
              {e.notes ? <div className="text-ink-muted">{e.notes}</div> : null}
              <div className="flex items-center gap-1 text-xs">
                {(['views', 'likes', 'comments'] as const).map((f) => (
                  <label key={f} className="flex items-center gap-1">
                    <span className="text-ink-dim">{f}</span>
                    <input
                      type="number"
                      value={e.performance?.[f] ?? 0}
                      onChange={(ev) => updatePerf(e.id, f, Number(ev.target.value) || 0)}
                      className="bg-bg-base rounded px-1 py-0.5 w-16"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
