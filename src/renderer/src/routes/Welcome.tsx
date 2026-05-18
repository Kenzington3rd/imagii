import { Icon } from '../components/Icon'

interface WelcomeProps {
  onContinue: () => void
}

export function Welcome({ onContinue }: WelcomeProps): JSX.Element {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="card max-w-xl w-full p-10 shadow-2xl text-center">
        <div className="flex justify-center mb-4 text-accent">
          <span className="w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center">
            <Icon name="sparkle" size={34} />
          </span>
        </div>
        <h1 className="text-4xl font-semibold mb-3">Hi Mike!</h1>
        <p className="text-ink-base mb-2">
          Welcome to <span className="font-semibold">imagii</span> — your free,
          local-first creative studio for streaming.
        </p>
        <p className="text-ink-muted text-sm mb-8 leading-relaxed">
          Inside you'll find a screen recorder, a video clipper for the social platforms
          you post to, an audio studio that polishes raw recordings to podcast quality, a
          Stream Graphics editor for thumbnails and overlays, and a References tab for
          mood boards and ready-made stream assets. Everything runs locally on your
          computer — no accounts, no subscriptions, no cloud.
        </p>
        <button
          className="btn-primary text-lg px-8 py-3 inline-flex items-center gap-2"
          onClick={onContinue}
        >
          Let&apos;s go <Icon name="arrow-right" size={18} />
        </button>
        <p className="text-xs text-ink-dim mt-6">imagii v0.1</p>
      </div>
    </div>
  )
}
