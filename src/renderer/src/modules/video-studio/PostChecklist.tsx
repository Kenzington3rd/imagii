import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { DiaryEntry } from '@shared/postingDiary'
import { DIARY_LEGACY_KEY, DIARY_MAX_ENTRIES, migrateDiary } from '@shared/postingDiary'
import { PanelHeader } from '../../components/PanelHeader'

const HASHTAG_TEMPLATES: Record<string, string[]> = {
  twitch_clip: ['#Twitch', '#TwitchClip', '#StreamHighlight', '#GamingClip'],
  gaming_short: ['#Shorts', '#Gaming', '#Gameplay', '#FYP', '#StreamerLife'],
  reaction: ['#Reaction', '#Funny', '#Streamer', '#FYP'],
  ig_reels_general: ['#Reels', '#ReelsViral', '#ContentCreator'],
  tiktok_general: ['#FYP', '#ForYou', '#Viral'],
  yt_long: ['#YouTube', '#Gaming', '#FullStream', '#Vlog']
}

/**
 * What the pack picker shows for each key (T-92). The keys are ids the code
 * and the tests use; "ig reels general" and "yt long" are what the picker
 * printed when it spelled them by replacing underscores. Every key needs a row
 * here — the copyConventions test lists the keys against this table.
 */
export const HASHTAG_PACK_LABELS: Readonly<Record<keyof typeof HASHTAG_TEMPLATES, string>> = {
  twitch_clip: 'Twitch clip',
  gaming_short: 'Gaming short',
  reaction: 'Reaction',
  ig_reels_general: 'Instagram Reels, general',
  tiktok_general: 'TikTok, general',
  yt_long: 'YouTube, long video'
}
export const HASHTAG_PACK_KEYS: readonly string[] = Object.keys(HASHTAG_TEMPLATES)

/**
 * A title starter is a pattern with slots. Each slot names the FORM it needs:
 * `{base}` the bare verb, `{past}` the simple past, `{gerund}` the -ing form,
 * `{a_subject}` the subject with its article, `{n}` a day of the year. Every
 * verb form comes from the VERBS table; nothing is built by appending letters
 * to a string (T-87). The game is not in any pattern: it is the user's to name.
 */
export interface TitleVerb {
  base: string
  past: string
  gerund: string
}

export const VERBS: readonly TitleVerb[] = [
  { base: 'clutch', past: 'clutched', gerund: 'clutching' },
  { base: 'beat', past: 'beat', gerund: 'beating' },
  { base: 'react to', past: 'reacted to', gerund: 'reacting to' },
  { base: 'discover', past: 'discovered', gerund: 'discovering' },
  { base: 'fail', past: 'failed', gerund: 'failing' },
  { base: 'try', past: 'tried', gerund: 'trying' }
]

export const SUBJECTS: readonly string[] = ['boss fight', 'speedrun', 'PvP match', 'glitch']

export const TITLE_PATTERNS: readonly string[] = [
  'Still thinking about the way I {past} {a_subject}',
  'When you {base} {a_subject}...',
  'POV: {a_subject} happens',
  'I {past} {a_subject} so you don\'t have to',
  'Honestly, {a_subject} is the hardest thing I {past} this week',
  'Why {a_subject} broke me',
  'Day {n} of {gerund} {a_subject}',
  'Nobody told me {a_subject} would do this'
]

/** 'a' or 'an', by the first letter of the word that follows it. */
export function article(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

/** Fills one pattern. Every slot takes a table value, its article, or the day number. */
export function fillTitle(pattern: string, verb: TitleVerb, subject: string, n: number): string {
  return pattern
    .replaceAll('{base}', verb.base)
    .replaceAll('{past}', verb.past)
    .replaceAll('{gerund}', verb.gerund)
    .replaceAll('{a_subject}', `${article(subject)} ${subject}`)
    .replaceAll('{n}', String(n))
}

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

  /**
   * T-20: the diary reads from the settings store, with a one-time carry-over
   * of the pre-round-23 localStorage blob. The legacy key is cleared as soon
   * as its contents are safe in settings — including when it was unparseable,
   * so a corrupt value can't make every mount retry the same failure.
   */
  async function load(): Promise<void> {
    let legacyRaw: string | null = null
    try {
      legacyRaw = localStorage.getItem(DIARY_LEGACY_KEY)
    } catch {
      /* localStorage can be unavailable; migration is then simply skipped */
    }
    try {
      const stored = await window.api.settings.get<unknown>('postingDiary')
      const result = migrateDiary({ stored, legacyRaw })
      setDiary(result.entries)
      if (!result.migrated) return
      await window.api.settings.set('postingDiary', result.entries)
      try {
        localStorage.removeItem(DIARY_LEGACY_KEY)
      } catch {
        /* ignore */
      }
    } catch {
      toast.error("Couldn't load your posting log.")
    }
  }

  function save(next: DiaryEntry[]): void {
    setDiary(next)
    void window.api.settings.set('postingDiary', next).catch(() => {
      toast.error("Couldn't save your posting log.")
    })
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
    save([entry, ...diary].slice(0, DIARY_MAX_ENTRIES))
    setOutputName('')
    setPlatforms([])
    setNotes('')
    toast.success('Added to your posting log')
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
      const pattern = pick(TITLE_PATTERNS, TITLE_PATTERNS[0] ?? '')
      const verb = pick(VERBS, VERBS[0] ?? { base: '', past: '', gerund: '' })
      const subject = pick(SUBJECTS, '')
      out.push(fillTitle(pattern, verb, subject, Math.floor(Math.random() * 365) + 1))
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

  function deleteEntry(entry: DiaryEntry): void {
    // Delete = gone for good, so it asks first (docs/BRANDING_GUIDE.md): the
    // log keeps a person's own view counts, which nothing else has.
    if (!confirm(`Delete "${entry.outputName}" from your posting log?`)) return
    save(diary.filter((e) => e.id !== entry.id))
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="clipboard">Posting helpers</PanelHeader>

      <div className="border-b border-ink-dim/30 pb-3 flex flex-col gap-2">
        <PanelHeader icon="text">Title starters</PanelHeader>
        <div className="flex items-center gap-2">
          <button className="btn-ghost px-3 py-1 text-xs" onClick={generateTitles}>
            Title starters
          </button>
        </div>
        {titles.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs">
            {titles.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex-1">{t}</span>
                <button className="text-accent hover:underline" onClick={() => copy(t)}>
                  Copy
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="border-b border-ink-dim/30 pb-3 flex flex-col gap-2">
        <PanelHeader icon="text">Hashtag pack</PanelHeader>
        <select
          className="bg-bg-base rounded px-2 py-1 text-xs"
          value={hashtagPick}
          onChange={(e) => setHashtagPick(e.target.value as keyof typeof HASHTAG_TEMPLATES)}
          aria-label="Hashtag pack"
        >
          {HASHTAG_PACK_KEYS.map((k) => (
            <option key={k} value={k}>
              {HASHTAG_PACK_LABELS[k] ?? k}
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
            Copy
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <PanelHeader icon="clipboard">Posting log</PanelHeader>
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
          <PanelHeader icon="clipboard">Logged posts ({diary.length})</PanelHeader>
          {diary.map((e) => (
            <div
              key={e.id}
              className="bg-bg-hover rounded px-2 py-1.5 text-xs flex flex-col gap-1"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium flex-1 truncate">{e.outputName}</span>
                <span className="text-ink-dim">{e.platforms.join(' · ')}</span>
                <button
                  onClick={() => deleteEntry(e)}
                  className="text-ink-dim hover:text-danger"
                  title="Delete entry"
                  aria-label="Delete entry"
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
