import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * The standard panel section header used across every studio.
 *
 * Before this component, ~25 panels each inlined their own `<h3>` with
 * the header classes — and the markup had drifted: some used `text-sm`
 * instead of `text-xs`, some dropped the icon slot, some hand-rolled the
 * `flex items-center justify-between` row for a right-side control. One
 * component = one source of truth. See docs/STYLE_GUIDE.md.
 *
 * Usage:
 *   <PanelHeader icon="palette">Color & motion</PanelHeader>
 *   <PanelHeader>Properties</PanelHeader>                  // icon optional
 *   <PanelHeader icon="bolt" actions={<button>Scan</button>}>
 *     Smart highlight finder
 *   </PanelHeader>
 *
 * When `actions` is provided, the header renders as a
 * `flex items-center justify-between` row with the heading on the left
 * and the actions on the right — the pattern panels used to hand-roll.
 */
export interface PanelHeaderProps {
  /** Leading icon. Omit for headers that intentionally have none. */
  icon?: IconName
  /** The heading label. */
  children: ReactNode
  /** Optional right-aligned content (a button, a select, a status span). */
  actions?: ReactNode
  /** Extra classes for the outer element (e.g. a one-off bottom margin). */
  className?: string
}

const HEADING_CLASS =
  'text-xs font-semibold uppercase tracking-wide text-ink-muted inline-flex items-center gap-1.5'

export function PanelHeader({
  icon,
  children,
  actions,
  className
}: PanelHeaderProps): JSX.Element {
  const heading = (
    <h3 className={HEADING_CLASS}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </h3>
  )
  if (actions === undefined) {
    return className ? <div className={className}>{heading}</div> : heading
  }
  return (
    <div className={`flex items-center justify-between${className ? ` ${className}` : ''}`}>
      {heading}
      {actions}
    </div>
  )
}
