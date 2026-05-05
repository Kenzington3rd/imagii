interface TutorialButtonProps {
  onClick: () => void
}

export function TutorialButton({ onClick }: TutorialButtonProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 rounded-full border border-ink-dim/50 hover:border-accent hover:bg-bg-hover text-sm flex items-center justify-center transition-colors"
      title="Show tutorial"
      aria-label="Show tutorial"
    >
      ?
    </button>
  )
}
