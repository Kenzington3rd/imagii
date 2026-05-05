import { NavCard } from '../components/NavCard'

export function Home(): JSX.Element {
  return (
    <div className="h-full overflow-auto px-10 py-12">
      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tight">imagii</h1>
        <p className="text-ink-muted mt-2">
          Your local creative studio. Pick a tool to get started.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
        <NavCard
          to="/video"
          title="Video Studio"
          description="Trim and clip video, then export for TikTok, Reels, YouTube, X, or Facebook."
          icon="🎬"
          accent="rgba(244, 114, 182, 0.18)"
        />
        <NavCard
          to="/audio"
          title="Audio Studio"
          description="Clean noise, level volume, and polish audio to podcast quality."
          icon="🎚"
          accent="rgba(96, 165, 250, 0.18)"
        />
        <NavCard
          to="/image"
          title="Image Canvas"
          description="Manipulate images with rotation, layers, color replace, and CAD-like guides."
          icon="🖼"
          accent="rgba(52, 211, 153, 0.18)"
        />
        <NavCard
          to="/ai-art"
          title="AI Art"
          description="Expand and inpaint images with local Stable Diffusion. Reference search included."
          icon="✨"
          accent="rgba(251, 191, 36, 0.18)"
        />
      </div>

      <footer className="mt-12 text-xs text-ink-dim">
        imagii runs locally on your computer. No accounts. No subscriptions.
      </footer>
    </div>
  )
}
