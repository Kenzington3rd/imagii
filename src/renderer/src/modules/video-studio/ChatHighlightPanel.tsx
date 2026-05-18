import { useState } from 'react'
import toast from 'react-hot-toast'
import { parseChatLog, type ChatMessage } from '@shared/chatLog'
import { useVideoStore } from './store/videoStore'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'

interface ChatPeak {
  bucketStart: number
  count: number
  topMessages: string[]
}

function findPeaks(msgs: ChatMessage[], bucketSec: number, padSec: number): ChatPeak[] {
  if (msgs.length === 0) return []
  const buckets = new Map<number, ChatMessage[]>()
  for (const m of msgs) {
    const key = Math.floor(m.tSec / bucketSec) * bucketSec
    const arr = buckets.get(key) ?? []
    arr.push(m)
    buckets.set(key, arr)
  }
  const counts = [...buckets.entries()].map(([k, arr]) => ({ k, n: arr.length }))
  if (counts.length < 3) return []
  counts.sort((a, b) => a.n - b.n)
  const medianEntry = counts[Math.floor(counts.length / 2)]
  const median = medianEntry?.n ?? 0
  const threshold = Math.max(median * 2, 5)

  const peakBuckets = [...buckets.entries()]
    .filter(([, arr]) => arr.length >= threshold)
    .sort((a, b) => a[0] - b[0])

  const merged: ChatPeak[] = []
  for (const [k, arr] of peakBuckets) {
    const last = merged[merged.length - 1]
    if (last && k - last.bucketStart < bucketSec * 2) {
      last.count += arr.length
      last.topMessages.push(...arr.slice(0, 2).map((m) => m.text))
    } else {
      merged.push({
        bucketStart: Math.max(0, k - padSec),
        count: arr.length,
        topMessages: arr.slice(0, 3).map((m) => m.text)
      })
    }
  }
  return merged.sort((a, b) => b.count - a.count).slice(0, 12).sort((a, b) => a.bucketStart - b.bucketStart)
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ChatHighlightPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const addClipFromRange = useVideoStore((s) => s.addClipFromRange)
  const [chatText, setChatText] = useState('')
  const [bucketSec, setBucketSec] = useState(10)
  const [padSec, setPadSec] = useState(15)
  const [peaks, setPeaks] = useState<ChatPeak[] | null>(null)

  if (!source) return null

  function analyze(): void {
    const msgs = parseChatLog(chatText)
    if (msgs.length === 0) {
      toast.error(
        'No timestamped messages found. Each line should start like [12:34] username: msg'
      )
      return
    }
    const found = findPeaks(msgs, bucketSec, padSec)
    setPeaks(found)
    if (found.length === 0) {
      toast('No chat spikes detected.', { icon: <Icon name="search" size={18} /> })
    }
    else toast.success(`Found ${found.length} hype moments`)
  }

  function addPeak(p: ChatPeak, i: number): void {
    if (!source) return
    const start = Math.max(0, p.bucketStart)
    const end = Math.min(source.probe.duration, p.bucketStart + bucketSec + padSec * 2)
    addClipFromRange(`Chat hype ${i + 1}`, start, end)
    toast.success('Clip added')
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="chat">Chat highlight reel</PanelHeader>
      <p className="text-xs text-ink-dim">
        Paste a Twitch chat log (format: <code>[mm:ss] user: message</code>) — finds bursts in
        message density.
      </p>
      <textarea
        value={chatText}
        onChange={(e) => setChatText(e.target.value)}
        rows={4}
        placeholder="[0:42] viewer1: POG&#10;[0:42] viewer2: NO WAY&#10;[0:43] viewer3: WHAT"
        className="bg-bg-base rounded px-2 py-1 text-xs font-mono resize-y"
      />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-ink-muted">Bucket sec</span>
          <input
            type="number"
            min={3}
            max={60}
            value={bucketSec}
            onChange={(e) => setBucketSec(Number(e.target.value) || 10)}
            className="bg-bg-base rounded px-2 py-1 flex-1"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-ink-muted">Pad sec</span>
          <input
            type="number"
            min={0}
            max={60}
            value={padSec}
            onChange={(e) => setPadSec(Number(e.target.value) || 0)}
            className="bg-bg-base rounded px-2 py-1 flex-1"
          />
        </label>
      </div>
      <button className="btn-primary px-3 py-1.5 text-xs self-start" onClick={analyze}>
        Find chat spikes
      </button>
      {peaks && peaks.length > 0 ? (
        <ul className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {peaks.map((p, i) => (
            <li
              key={i}
              className="flex items-start gap-2 px-2 py-1.5 bg-bg-hover rounded text-xs"
            >
              <span className="font-mono">{formatTime(p.bucketStart)}</span>
              <span className="text-ink-dim">{p.count} msgs</span>
              <span className="flex-1 truncate text-ink-muted">{p.topMessages.join(' · ')}</span>
              <button
                className="text-accent hover:underline"
                onClick={() => addPeak(p, i)}
              >
                + clip
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
