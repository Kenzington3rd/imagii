import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/**
 * Standard "back to Home" link shown in every studio header.
 *
 * Extracted so the five studios (Record, Video, Audio, Stream Graphics,
 * References) share one implementation — same icon, same spacing, same
 * hover treatment. Before this component each studio inlined its own
 * `← Home` link with a literal arrow character; see docs/STYLE_GUIDE.md
 * for why shared affordances beat copy-pasted markup.
 */
export function HomeLink(): JSX.Element {
  return (
    <Link
      to="/home"
      className="text-sm text-ink-muted hover:text-ink-base inline-flex items-center gap-1"
    >
      <Icon name="arrow-left" size={14} />
      Home
    </Link>
  )
}
