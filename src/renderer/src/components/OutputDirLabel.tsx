import { Icon } from './Icon'

/**
 * Renders the label content for an "output directory" picker button —
 * a folder icon plus the directory's basename, or a "Choose folder…"
 * prompt when none is set.
 *
 * Extracted because five panels (GIF export, batch export, compilation,
 * picture-in-picture, auto-reframe) each inlined the same
 * folder-icon-plus-basename expression. One component = one place to
 * change the icon, the empty-state copy, and the path-splitting logic.
 * See docs/STYLE_GUIDE.md (shared affordances).
 */
export interface OutputDirLabelProps {
  /** Absolute output directory, or null/undefined when unset. */
  outDir: string | null | undefined
  /** Prompt shown when no directory is set. */
  emptyLabel?: string
}

/** Last path segment of a Windows or POSIX path. Pure, exported for tests. */
export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter((s) => s.length > 0)
  return parts.length > 0 ? (parts[parts.length - 1] as string) : p
}

export function OutputDirLabel({
  outDir,
  emptyLabel = 'Choose folder…'
}: OutputDirLabelProps): JSX.Element {
  if (!outDir) return <span>{emptyLabel}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name="folder" size={13} />
      {basename(outDir)}
    </span>
  )
}
