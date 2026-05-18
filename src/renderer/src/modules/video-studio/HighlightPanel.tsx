import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { parseChatLog } from '@shared/chatLog'
import {
  scoreHighlights,
  type AudioCandidate,
  type ScoredHighlight
} from '@shared/highlights'
import { useVideoStore } from './store/videoStore'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Tiny inline 0..1 mini-bar for per-signal display. */
interface SignalBarProps {
  label: string
  value: number
  color: string
}

function SignalBar(props: SignalBarProps): JSX.Element {
  const { label, value, color } = props
  return (
    <div
      className="flex items-center gap-1 text-xs"
      title={`${label}: ${(value * 100).toFixed(0)}%`}
    >
      <span className="text-ink-dim w-12">{label}</span>
      <div className="flex-1 h-1 bg-bg-base rounded">
        <div
          className="h-full rounded"
          style={{ width: `${Math.round(value * 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

const CHAT_DEBOUNCE_MS = 300

export function HighlightPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const addClipFromRange = useVideoStore((s) => s.addClipFromRange)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [audioCandidates, setAudioCandidates] = useState<AudioCandidate[] | null>(null)
  const [chatText, setChatText] = useState('')
  // Bug fix: parseChatLog + scoreHighlights are O(n) and can run hundreds
  // of times per second on a fast typist with a 50KB chat log pasted in.
  // Debounce the value used for scoring so each keystroke only triggers
  // one rerun after the user stops typing.
  const [debouncedChat, setDebouncedChat] = useState('')
  const [showChatInput, setShowChatInput] = useState(false)

  useEffect(() => {
    const off = window.api.video.onHighlightProgress((p) => {
      setProgress(p.percent)
    })
    return off
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedChat(chatText), CHAT_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [chatText])

  // Phase 4B: combine audio candidates with chat data into a unified
  // ranked list. Chat input is optional — when empty, scoring degrades to
  // audio-only and behaves identically to the previous panel.
  const scored: ScoredHighlight[] = useMemo(() => {
    if (!audioCandidates || audioCandidates.length === 0) return []
    const chatMessages =
      debouncedChat.trim().length > 0 ? parseChatLog(debouncedChat) : []
    return scoreHighlights(audioCandidates, chatMessages)
  }, [audioCandidates, debouncedChat])

  if (!source) return null

  async function scan(): Promise<void> {
    if (!source) return
    setScanning(true)
    setProgress(0)
    try {
      const candidates = await window.api.video.findHighlights(source.filePath)
      // The IPC layer's signature returns reason as `string` but in
      // practice it's our union type — narrow defensively.
      const narrowed: AudioCandidate[] = candidates.map((c) => ({
        startSec: c.startSec,
        endSec: c.endSec,
        peakDb: c.peakDb,
        reason: c.reason === 'sustained-loud' ? 'sustained-loud' : 'loud'
      }))
      setAudioCandidates(narrowed)
      if (narrowed.length === 0) {
        toast('No standout moments detected.', { icon: <Icon name="search" size={18} /> })
      }
      else toast.success(`Found ${narrowed.length} candidates`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  function addAsClip(h: ScoredHighlight, index: number): void {
    addClipFromRange(`Highlight ${index + 1}`, h.startSec, h.endSec)
    toast.success('Clip added — see the Clips list')
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-highlights">
      <PanelHeader
        icon="bolt"
        actions={
          <button
            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={scan}
            disabled={scanning}
          >
            {scanning ? 'Scanning…' : audioCandidates ? 'Re-scan' : 'Scan VOD'}
          </button>
        }
      >
        Smart highlight finder
      </PanelHeader>
      <p className="text-xs text-ink-dim">
        Combines audio-loudness peaks with optional chat density and hype-keyword
        detection. Each candidate shows you <em>why</em> it scored — paste a chat log
        below to enrich the ranking.
      </p>

      {/* Phase 4B: optional chat log input. Collapsed by default. */}
      <div className="border-t border-ink-dim/20 pt-2">
        <button
          className="text-xs text-accent hover:underline inline-flex items-center gap-1"
          onClick={() => setShowChatInput((v) => !v)}
        >
          <Icon name={showChatInput ? 'chevron-down' : 'chevron-right'} size={12} />
          Add chat log (optional)
        </button>
        {showChatInput ? (
          <textarea
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            rows={3}
            placeholder="[0:42] viewer1: POG&#10;[0:43] viewer2: NO WAY&#10;[0:43] viewer3: KEKW"
            className="bg-bg-base rounded px-2 py-1 text-xs font-mono resize-y w-full mt-1.5"
          />
        ) : null}
      </div>

      {scanning ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${Math.round(progress)}%` }} />
          </div>
          <span className="font-mono w-10 text-right">{Math.round(progress)}%</span>
        </div>
      ) : null}

      {scored.length > 0 ? (
        <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
          {scored.map((h, i) => (
            <li key={i} className="flex flex-col gap-1 px-2 py-1.5 bg-bg-hover rounded text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {formatTime(h.startSec)} → {formatTime(h.endSec)}
                </span>
                <span
                  className="font-mono px-1.5 py-0.5 rounded bg-accent/20 text-accent"
                  title="Combined score (0–100)"
                >
                  {Math.round(h.combinedScore * 100)}
                </span>
                <span className="text-ink-dim flex-1 truncate">
                  {h.reasons.join(' · ')}
                </span>
                <button
                  className="text-accent hover:underline"
                  onClick={() => addAsClip(h, i)}
                >
                  + Clip
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-0.5">
                <SignalBar label="Audio" value={h.signals.audioScore} color="#a78bfa" />
                <SignalBar label="Chat" value={h.signals.chatDensityScore} color="#f472b6" />
                <SignalBar label="Hype" value={h.signals.hypeWordScore} color="#fbbf24" />
              </div>
              {h.topChatMessages.length > 0 ? (
                <div className="text-ink-dim italic truncate">
                  {h.topChatMessages.join(' · ')}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
