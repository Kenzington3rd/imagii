import type { ReactNode } from 'react'
import type { CanvasDocument } from '@shared/canvas'
import { CHECKER_A, CHECKER_B } from '../styles/tokens'

interface SpecCardProps {
  name: string
  description: string
  /** Only its size and background are read: the thumbnail is the background at the document's aspect ratio (a checkerboard for a transparent one). */
  doc: Pick<CanvasDocument, 'width' | 'height' | 'background'>
  onClick: () => void
  /** One more line under the size, e.g. the Asset Library's license. */
  extra?: ReactNode
}

/**
 * T-172 (6): the card for a ready-made canvas (a template or a library asset): a button with the document's thumbnail, its name, what it
 * is, and "W × H". The Import panel's template grid, the Streamer templates dialog and the Asset Library all draw it, so the three cannot
 * drift (the transparency checkerboard is DESIGN_GUIDE's, from `tokens.ts`).
 */
export function SpecCard({ name, description, doc, onClick, extra }: SpecCardProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="card p-3 flex flex-col justify-start items-stretch text-left hover:border-accent transition-colors"
    >
      <div
        className="w-full rounded mb-2 overflow-hidden border border-ink-dim/30"
        style={{
          aspectRatio: `${doc.width} / ${doc.height}`,
          background:
            doc.background === 'transparent'
              ? `repeating-conic-gradient(${CHECKER_A} 0% 25%, ${CHECKER_B} 0% 50%) 0 0 / 16px 16px`
              : doc.background
        }}
      />
      <div className="text-sm font-medium">{name}</div>
      <div className="text-xs text-ink-muted mt-1">{description}</div>
      <div className="text-xs text-ink-dim mt-1 font-mono">
        {doc.width} × {doc.height}
      </div>
      {extra !== undefined && <div className="text-xs text-ink-dim mt-1 italic">{extra}</div>}
    </button>
  )
}
