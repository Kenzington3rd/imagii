import { Toaster } from 'react-hot-toast'
import { BG_ELEVATED, INK_BASE } from '../styles/tokens'

/**
 * The app-wide toast surface. Extracted because all five studios
 * inlined an identical `<Toaster>` with the same 8-line `toastOptions`
 * style block — see docs/STYLE_GUIDE.md "Shared affordances".
 *
 * The inline hex values are unavoidable: react-hot-toast's `style` API
 * takes raw CSS, not Tailwind classes. Keeping them in one component
 * means the toast styling has a single source of truth — they mirror
 * the `bg-elevated` / `ink-base` / `ink-dim` design tokens.
 */
export function AppToaster(): JSX.Element {
  return (
    <Toaster
      position="bottom-center"
      toastOptions={{
        style: {
          background: BG_ELEVATED,
          color: INK_BASE,
          border: '1px solid rgba(156, 143, 139, 0.25)' // ink-dim wash
        }
      }}
    />
  )
}
