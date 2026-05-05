interface WelcomeProps {
  onContinue: () => void
}

export function Welcome({ onContinue }: WelcomeProps): JSX.Element {
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="card max-w-xl w-full p-10 shadow-2xl text-center">
        <div className="text-6xl mb-4">🎁</div>
        <h1 className="text-4xl font-semibold mb-3">Hi Mike!</h1>
        <p className="text-ink-base mb-2">
          Welcome to <span className="font-semibold">imagii</span> — a creative studio
          built just for you.
        </p>
        <p className="text-ink-muted text-sm mb-8 leading-relaxed">
          Inside you'll find a video clipper for the social platforms you post to, an audio
          studio that polishes raw recordings to podcast quality, an image canvas for
          manipulating artwork, and an AI art tab for expanding and inpainting images.
          Everything runs locally on your computer — no accounts, no subscriptions, no cloud.
          Have fun with it. ❤️
        </p>
        <button className="btn-primary text-lg px-8 py-3" onClick={onContinue}>
          Let's go →
        </button>
        <p className="text-xs text-ink-dim mt-6">
          Made with care · imagii v0.1
        </p>
      </div>
    </div>
  )
}
