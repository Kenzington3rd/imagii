import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { parseChatLog } from '@shared/chatLog'
import { countOf } from '@shared/plural'
import {
  scoreHighlights,
  type AudioCandidate,
  type ScoredHighlight
} from '@shared/highlights'
import {
  NO_SOUND_MESSAGE,
  WHOLE_VIDEO_DROPPED_MESSAGE,
  useVideoStore,
  videoHasNoSound
} from './store/videoStore'
import { useScanRun } from './store/runs'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'
import { ProgressTrack } from '../../components/ProgressTrack'
import { RunningCancel } from '../../components/RunningCancel'
import { reportFailure } from '../../lib/reportFailure'
import { ACCENT, EMBER, SIGNAL_PINK } from '../../styles/tokens'
import { formatClock } from '@shared/clockTime'

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
      {/* T-113: a meter, named and valued — it was a colored width and nothing else. */}
      <div
        className="flex-1 h-1 bg-bg-base rounded"
        role="meter"
        aria-label={`${label} signal`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
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
  const addScannedClip = useVideoStore((s) => s.addScannedClip)
  // T-135 (1), (4): the scan (its progress, and whether one is running) is a module store, and its candidates and the pasted chat log are the open
  // video's own results in the video store. Leaving the studio unmounted all of it when it was this panel's state: the panel came back with "Scan
  // VOD" enabled over a scan main was still running (a second press overwrote main's single scan slot, orphaning the first from Cancel and from the
  // quit sweep), and a scan that took minutes was forgotten. `loadSource` and `clearSource` empty the results, so a different video starts clean.
  const scanRun = useScanRun((s) => s.run)
  const scanning = scanRun !== null
  const progress = scanRun?.percent ?? 0
  const audioCandidates = useVideoStore((s) => s.derived.scanCandidates)
  const chatText = useVideoStore((s) => s.derived.highlightChat)
  const setDerived = useVideoStore((s) => s.setDerived)
  // Bug fix: parseChatLog + scoreHighlights are O(n) and can run hundreds
  // of times per second on a fast typist with a 50KB chat log pasted in.
  // Debounce the value used for scoring so each keystroke only triggers
  // one rerun after the user stops typing. (Seeded from the store: a returning panel scores what is already pasted at once.)
  const [debouncedChat, setDebouncedChat] = useState(chatText)
  const [showChatInput, setShowChatInput] = useState(chatText.length > 0)

  useEffect(() => {
    const off = window.api.video.onHighlightProgress((p) => {
      useScanRun.getState().patch({ percent: p.percent })
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
  // T-112: the scan listens for loud moments; a video with no sound track has none to find.
  const noSound = videoHasNoSound(source)

  async function scan(): Promise<void> {
    if (!source || noSound) return
    const startedFor = source.filePath
    // The claim is the store's: one scan at a time however many times this panel has been mounted (main has ONE scan slot).
    if (!useScanRun.getState().begin({ percent: 0 })) return
    try {
      const candidates = await window.api.video.findHighlights(startedFor)
      // The result is for the video the scan started on (T-131 (3)): if it was replaced or closed while the scan ran, its candidates are for
      // one that is gone. Stored in the video store, so they are there when the person comes back, and no toast is raised to a panel that is not.
      const stored = (found: AudioCandidate[]): boolean => useVideoStore.getState().setDerivedFor(startedFor, { scanCandidates: found })
      // The IPC layer's signature returns reason as `string` but in
      // practice it's our union type — narrow defensively.
      const narrowed: AudioCandidate[] = candidates.map((c) => ({
        startSec: c.startSec,
        endSec: c.endSec,
        peakDb: c.peakDb,
        reason: c.reason === 'sustained-loud' ? 'sustained-loud' : 'loud'
      }))
      if (!stored(narrowed)) return
      if (narrowed.length === 0) {
        toast('No standout moments detected', { icon: <Icon name="search" size={18} /> })
      } else {
        toast.success(`Found ${countOf(narrowed.length, 'highlight')}`)
      }
    } catch (err) {
      reportFailure(err, { failed: 'Scan failed.', canceled: 'Scan canceled.' })
    } finally {
      useScanRun.getState().end()
    }
  }

  function addAsClip(h: ScoredHighlight, index: number): void {
    // T-59 rider: success is reported from what the store actually did,
    // never assumed. The store refuses a range it cannot honour (no source
    // loaded, a range past the end) and refuses in silence — the same shape
    // ChatHighlightPanel's Add fixed in T-48.
    //
    // T-94: this is the scanner's add, so the first highlight also retires
    // the untouched whole-video clip (one undo step with the add) and the
    // user is told, with the way back.
    const added = addScannedClip(`Highlight ${index + 1}`, h.startSec, h.endSec)
    if (added === 'refused') {
      toast.error("Couldn't add that clip — the highlight is outside this video.")
      return
    }
    toast.success('Clip added — see the Clips list')
    if (added === 'added-dropped-whole-video') {
      toast(WHOLE_VIDEO_DROPPED_MESSAGE, { icon: <Icon name="undo" size={18} />, duration: 8000 })
    }
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm" data-tutorial="video-highlights">
      <PanelHeader
        icon="bolt"
        actions={
          <button
            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={scan}
            disabled={scanning || noSound}
            title={noSound ? NO_SOUND_MESSAGE : undefined}
          >
            {scanning ? 'Scanning…' : audioCandidates ? 'Re-scan' : 'Scan VOD'}
          </button>
        }
      >
        Smart highlight finder
      </PanelHeader>
      {noSound ? <p className="text-xs text-warn">{NO_SOUND_MESSAGE}</p> : null}
      <p className="text-xs text-ink-dim">
        Combines audio-loudness peaks with optional chat density and hype-keyword
        detection. Each highlight shows you <em>why</em> it scored — paste a chat log
        below to enrich the ranking.
      </p>

      {/* Phase 4B: optional chat log input. Collapsed by default. */}
      <div className="border-t border-ink-dim/20 pt-2">
        <button
          className="text-xs text-accent hover:underline inline-flex items-center gap-1"
          onClick={() => setShowChatInput((v) => !v)}
          aria-expanded={showChatInput}
        >
          <Icon name={showChatInput ? 'chevron-down' : 'chevron-right'} size={12} />
          Add chat log (optional)
        </button>
        {showChatInput ? (
          <textarea
            value={chatText}
            onChange={(e) => setDerived({ highlightChat: e.target.value })}
            rows={3}
            placeholder="[0:42] viewer1: POG&#10;[0:43] viewer2: NO WAY&#10;[0:43] viewer3: KEKW"
            className="bg-bg-base rounded px-2 py-1 text-xs font-mono resize-y w-full mt-1.5"
          />
        ) : null}
      </div>

      {scanning ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <ProgressTrack label="Scanning the video for highlights" percent={progress} />
          <span className="font-mono w-10 shrink-0 whitespace-nowrap text-right">{Math.round(progress)}%</span>
          {/* Round 17 B3: single-slot cancel, no jobId needed. */}
          <RunningCancel title="Cancel scan" onClick={() => void window.api.video.cancelHighlight()} />
        </div>
      ) : null}

      {scored.length > 0 ? (
        <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
          {scored.map((h, i) => (
            <li key={i} className="flex flex-col gap-1 px-2 py-1.5 bg-bg-hover rounded text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {formatClock(h.startSec)} → {formatClock(h.endSec)}
                </span>
                {/* T-112: ink on the wash, accent border for the identity. accent text on a
                    bg-accent/20 wash over this row's bg-hover measured 3.60:1 (AA is 4.5). */}
                <span
                  className="font-mono px-1.5 py-0.5 rounded border border-accent/40 bg-accent/20 text-ink-base"
                  title="Combined score (0–100)"
                >
                  {Math.round(h.combinedScore * 100)}
                </span>
                <span className="text-ink-dim flex-1 truncate" title={h.reasons.join(' · ')}>
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
                <SignalBar label="Audio" value={h.signals.audioScore} color={ACCENT} />
                <SignalBar label="Chat" value={h.signals.chatDensityScore} color={SIGNAL_PINK} />
                <SignalBar label="Hype" value={h.signals.hypeWordScore} color={EMBER} />
              </div>
              {h.topChatMessages.length > 0 ? (
                <div className="text-ink-dim italic truncate" title={h.topChatMessages.join(' · ')}>
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
