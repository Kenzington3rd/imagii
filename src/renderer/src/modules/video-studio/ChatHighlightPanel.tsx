import { useState } from 'react'
import toast from 'react-hot-toast'
import { parseChatLog } from '@shared/chatLog'
import { MAX_CHAT_PAD_SEC, NO_CHAT_SPIKES_MESSAGE, findChatPeaks, type ChatPeak } from '@shared/chatPeaks'
import { countOf } from '@shared/plural'
import { WHOLE_VIDEO_DROPPED_MESSAGE, useVideoStore } from './store/videoStore'
import { Icon } from '../../components/Icon'
import { PanelHeader } from '../../components/PanelHeader'
import { DraftField } from '../../components/DraftField'
import { clampTyped, isTypedInRange } from '@shared/draftNumber'
import { formatClock } from '@shared/clockTime'

/** The spike window the box takes (s): the 3 to 60 its attributes say, enforced when typing ends. */
const SPIKE_WINDOW_MIN = 3
const SPIKE_WINDOW_MAX = 60

export function ChatHighlightPanel(): JSX.Element | null {
  const source = useVideoStore((s) => s.source)
  const addScannedClip = useVideoStore((s) => s.addScannedClip)
  // T-135 (4): the pasted log and the spikes found in it are the open video's own results in the video store (they were this panel's state, lost
  // with every visit). T-131 (3)'s reason holds as before: they are for the video they were pasted against, and `loadSource` / `clearSource` empty
  // them, so a replaced video (Reframe's "Edit in Video Studio") never shows the old one's "+ Clip" rows. The spike window and the extra seconds are
  // settings, not results, and stay with the panel.
  const chatText = useVideoStore((s) => s.derived.spikeChat)
  const peaks = useVideoStore((s) => s.derived.spikes)
  const setDerived = useVideoStore((s) => s.setDerived)
  const [bucketSec, setBucketSec] = useState(10)
  const [padSec, setPadSec] = useState(15)

  if (!source) return null

  function analyze(): void {
    const msgs = parseChatLog(chatText)
    if (msgs.length === 0) {
      toast.error(
        'No timestamped messages found. Each line should start like [12:34] username: message'
      )
      return
    }
    const found: ChatPeak[] = findChatPeaks(msgs, bucketSec, padSec)
    setDerived({ spikes: found })
    if (found.length === 0) {
      toast('No chat spikes detected', { icon: <Icon name="search" size={18} /> })
    } else {
      toast.success(`Found ${countOf(found.length, 'chat spike')}`)
    }
  }

  function addPeak(p: ChatPeak, i: number): void {
    if (!source) return
    const duration = source.probe.duration
    // T-48: BOTH ends are clamped to the source. A chat log routinely runs
    // past the video it is pasted against (a trimmed VOD, a clip of one
    // segment, the wrong file), and clamping only the end turned those
    // peaks into a reversed range — which the store refuses in silence
    // while the toast below claimed a clip that never existed.
    // T-135 (3): the window is the spike's own (first bucket less the padding .. last bucket's end plus the padding), so a spike of several buckets
    // is clipped whole; this used to rebuild it from the padded start plus ONE bucket and two pads.
    const start = Math.min(Math.max(0, p.startSec), duration)
    const end = Math.min(duration, p.endSec)
    // Success is reported from what the store actually did, never assumed.
    // T-94: the scanner's add also retires the untouched whole-video clip
    // (one undo step with the add), and the user is told.
    const added = addScannedClip(`Chat spike ${i + 1}`, start, end)
    if (added === 'refused') {
      toast.error(
        'That spike is past the end of this video — check the log matches this source.'
      )
      return
    }
    toast.success('Clip added')
    if (added === 'added-dropped-whole-video') {
      toast(WHOLE_VIDEO_DROPPED_MESSAGE, { icon: <Icon name="undo" size={18} />, duration: 8000 })
    }
  }

  return (
    <div className="card p-3 flex flex-col gap-3 text-sm">
      <PanelHeader icon="chat">Chat spike finder</PanelHeader>
      <p className="text-xs text-ink-dim">
        Paste a Twitch chat log (format: <code>[mm:ss] user: message</code>) — finds bursts in
        message density.
      </p>
      <textarea
        value={chatText}
        onChange={(e) => setDerived({ spikeChat: e.target.value })}
        rows={4}
        placeholder="[0:42] viewer1: POG&#10;[0:42] viewer2: NO WAY&#10;[0:43] viewer3: WHAT"
        className="bg-bg-base rounded px-2 py-1 text-xs font-mono resize-y"
      />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Spike window (s)</span>
          {/* T-123 (4): kept until typing ends; `Number(typed) || 10` appended "45" to an emptied box as 1045. */}
          <DraftField
            type="number"
            min={SPIKE_WINDOW_MIN}
            max={SPIKE_WINDOW_MAX}
            value={String(bucketSec)}
            live={(typed) => isTypedInRange(typed, SPIKE_WINDOW_MIN, SPIKE_WINDOW_MAX)}
            commit={(typed) => {
              const n = clampTyped(typed, SPIKE_WINDOW_MIN, SPIKE_WINDOW_MAX)
              if (n !== null) setBucketSec(n)
              return null
            }}
            className="bg-bg-base rounded px-2 py-1 mt-auto"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Extra seconds around each clip</span>
          {/* T-136 (9): the same box as the spike window. `Number(v) || 0` took a negative number as typed (a window of zero length) and the "min" was
              advice; 0 to 60 is enforced when typing ends, and a fraction of a second is kept. `mt-auto` on both boxes: this label wraps in the narrow
              column and the other does not, and the boxes sat 16 px apart; they share the bottom of the row now whatever the labels do. */}
          <DraftField
            type="number"
            min={0}
            max={MAX_CHAT_PAD_SEC}
            value={String(padSec)}
            live={(typed) => isTypedInRange(typed, 0, MAX_CHAT_PAD_SEC, false)}
            commit={(typed) => {
              const n = clampTyped(typed, 0, MAX_CHAT_PAD_SEC, false)
              if (n !== null) setPadSec(n)
              return null
            }}
            className="bg-bg-base rounded px-2 py-1 mt-auto"
          />
        </label>
      </div>
      <button className="btn-primary px-3 py-1.5 text-xs self-start" onClick={analyze}>
        Find chat spikes
      </button>
      {/* T-136 (9): analyzed and nothing found is a state of its own (`[]`; `null` is "not analyzed"). The 4 s toast is gone by the time anyone looks at the panel. */}
      {peaks && peaks.length === 0 ? <p className="text-xs text-ink-dim">{NO_CHAT_SPIKES_MESSAGE}</p> : null}
      {peaks && peaks.length > 0 ? (
        <ul className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
          {peaks.map((p, i) => (
            <li key={i} className="flex flex-col gap-1 px-2 py-1.5 bg-bg-hover rounded text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {/* T-136 (9): where the clip runs, not just where it starts (a merged spike can be minutes long); the Smart highlight rows say the same.
                    The range is wider than the start was, so the preview moved to a line of its own: squeezed beside it, it left a few letters.
                    The row is 258 px at every window the app opens at, and a ten-hour stream's range (17 characters) and a four-digit count leave "+ Clip"
                    no room (it wrapped onto two lines and ended past the row): `flex-wrap` drops it under the range instead, `ml-auto` keeps it at the
                    right edge there, and the count's `whitespace-nowrap` makes the row wrap by item (without it the count itself breaks onto two lines). */}
                <span className="font-mono">
                  {formatClock(p.startSec)} → {formatClock(p.endSec)}
                </span>
                <span className="flex-1 text-ink-dim whitespace-nowrap">{countOf(p.count, 'message')}</span>
                <button
                  className="text-accent hover:underline ml-auto"
                  onClick={() => addPeak(p, i)}
                >
                  + Clip
                </button>
              </div>
              <div className="truncate text-ink-muted" title={p.topMessages.join(' · ')}>{p.topMessages.join(' · ')}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
