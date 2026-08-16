import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Welcome } from './routes/Welcome'
import { Home } from './routes/Home'
import { Video } from './routes/Video'
import { Audio } from './routes/Audio'
import { Image } from './routes/Image'
import { Record } from './routes/Record'
import { References } from './routes/References'
import { AppToaster } from './components/AppToaster'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HotkeyOverlay } from './components/HotkeyOverlay'
import { Icon } from './components/Icon'
import { useAutosave } from './hooks/useAutosave'

type Status = { phase: 'loading' } | { phase: 'welcome' } | { phase: 'ready' }

/**
 * T-35 — the render-error harness the ErrorBoundary's coverage needs.
 *
 * A boundary can only be proven by an error thrown from inside a real render,
 * and the recovery it offers ("Reload to Home") is a navigation, so the proof
 * has to run in the built app rather than in a component harness.
 *
 * TWO independent conditions gate it and both must hold:
 *
 *   1. the `#/__crash` hash, which nothing in the UI links to. imagii has no
 *      address bar, and an unrecognized hash already lands on Home via the
 *      catch-all route below.
 *   2. `window.__imagiiCrashTest`, a flag no product code ever sets — only
 *      tests/e2e/home-chrome.spec.ts does, through `page.evaluate`.
 *
 * With the flag unset — that is, always, in a shipped app — this route
 * behaves exactly like any other unknown hash: it redirects to Home. The
 * spec asserts that unarmed behavior first, so the guard is covered too.
 * Same family as the `window.__imagiiStage` / `__imagiiVideoEl` test hooks
 * the interaction ledger already records.
 */
function CrashTest(): JSX.Element {
  const armed = (window as unknown as { __imagiiCrashTest?: boolean }).__imagiiCrashTest === true
  if (!armed) return <Navigate to="/home" replace />
  throw new Error('Forced render error (T-35 ErrorBoundary harness)')
}

export function App(): JSX.Element {
  const [status, setStatus] = useState<Status>({ phase: 'loading' })
  // B1 fix: actually wire the autosave hook. Round-3 introduced the hook but
  // no component called it, so AutosaveRestore had nothing to read on launch.
  // Gating on `ready` keeps the welcome screen out of the autosave stream.
  // The empty-project skip is handled main-side via isSafeToAutosave.
  useAutosave({ enabled: status.phase === 'ready' })

  useEffect(() => {
    let cancelled = false
    window.api.settings.get<boolean>('welcomeSeen').then((welcomeSeen) => {
      if (cancelled) return
      setStatus({ phase: welcomeSeen ? 'ready' : 'welcome' })
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (status.phase === 'loading') {
    // M7 fix: bare "Loading…" looked like the app hung. Pair the text with a
    // small spinning sparkle so the user knows something is happening.
    return (
      <div className="h-full flex items-center justify-center gap-2 text-ink-muted text-sm">
        <span className="inline-block" style={{ animation: 'imagii-spin 1.2s linear infinite' }}>
          <Icon name="sparkle" size={16} />
        </span>
        Loading…
      </div>
    )
  }

  if (status.phase === 'welcome') {
    return (
      <Welcome
        onContinue={async () => {
          await window.api.settings.set('welcomeSeen', true)
          setStatus({ phase: 'ready' })
        }}
      />
    )
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/video" element={<Video />} />
        <Route path="/audio" element={<Audio />} />
        <Route path="/image" element={<Image />} />
        <Route path="/record" element={<Record />} />
        <Route path="/references" element={<References />} />
        {/* Back-compat: the References studio was originally routed at
            /ai-art before the module was repurposed. Redirect so any old
            deep link still resolves. */}
        <Route path="/ai-art" element={<Navigate to="/references" replace />} />
        {/* T-35: the ErrorBoundary below can only be proven by a render that
            actually throws, in the built app, on a route the user could be
            on. This is that lever. */}
        <Route path="/__crash" element={<CrashTest />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
      {/* T-13: the overlay owns the app-wide `?` binding and is the only
          shortcut documentation we ship — Player's hint copy has advertised
          it since round 15. Mounted outside <Routes> so one instance serves
          every route and reads the current one via useLocation. */}
      <HotkeyOverlay />
      {/* T-31: one toast surface for the whole app, mounted beside the
          overlay for the same reason — every route raises toasts, and the
          five studios that each mounted their own left Home (and any future
          route) silently swallowing "Project saved", "Restored from
          autosave" and every error path. react-hot-toast keeps one global
          toast store per `toasterId`, so two <Toaster>s without one both
          draw every toast: an app-level mount and a per-studio mount cannot
          coexist. */}
      <AppToaster />
    </ErrorBoundary>
  )
}
