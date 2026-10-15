import { Icon } from './Icon'

/**
 * Renders the label content for an "output directory" picker button —
 * a folder icon plus the directory's basename, or a "Choose folder…"
 * prompt when none is set.
 *
 * Extracted because five panels (GIF export, batch export, compilation,
 * picture-in-picture, auto-reframe) each inlined the same
 * folder-icon-plus-basename expression. One component = one place to
 * change the icon, the empty-state copy, and the path-splitting logic. The
 * button's accessible name is "Output folder: <name>" (a screen-reader-only
 * prefix, T-123 (8)); the empty state is its own sentence.
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
    // T-125 (11): a remembered folder's name is whatever the person called it, and the chip used to be as wide as the name, so a long
    // one pushed the primary button out of every card that holds it (+55 px measured). The chip is capped (9 rem keeps every card's
    // primary button inside it at the default window and at the 1024 px minimum: the long-name layout case measures both), the name
    // ends in an ellipsis, and the full path is the tooltip. T-126 (13): and `w-full`: a card too narrow for the chip AND its primary
    // button makes the button (`min-w-0`) give, and an inline-flex label keeps its min-content width (the whole nowrap name) inside a
    // button that has shrunk, so a bare 9 rem poked out of it and the ellipsis never fired. A percentage width is "auto" while the
    // button is being sized (the 9 rem cap still decides how wide the chip WANTS to be: `max-w(min(9rem, 100%))` lost the cap there and
    // pushed the Export card's button out by 240 px) and the button's own width once it has been (the label shrinks with it).
    <span className="inline-flex items-center gap-1.5 w-full max-w-[9rem]" title={outDir}>
      <Icon name="folder" size={13} className="shrink-0" />
      {/* T-123 (8): the chip drew an icon and the folder's name, so the button's accessible name was just "Videos": a
          button called Videos, with nothing to say it picks where the file goes. The prefix is for assistive technology. */}
      <span className="sr-only">Output folder: </span>
      <span className="min-w-0 truncate">{basename(outDir)}</span>
    </span>
  )
}
