import { useAiStore } from './state/aiStore'

function formatBytes(n: number): string {
  if (!n) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  return `${(n / 1024).toFixed(0)} KB`
}

export function SetupCard(): JSX.Element | null {
  const status = useAiStore((s) => s.status)
  if (!status) return null
  if (status.ready && status.nsfwModelInstalled) return null

  return (
    <div className="card p-4 flex flex-col gap-3 border-amber-400/40 bg-amber-400/5">
      <div className="flex items-center gap-2">
        <span className="text-amber-300 text-sm font-semibold uppercase tracking-wide">
          Setup
        </span>
        <span className="text-xs text-ink-muted">
          imagii ships without AI models — install them once to enable generation.
        </span>
      </div>

      <ul className="text-sm flex flex-col gap-2">
        <SetupRow
          label="stable-diffusion.cpp executable"
          ok={status.sdExeInstalled}
          detail={status.sdExePath}
        />
        <SetupRow
          label="Stable Diffusion 1.5 model"
          ok={status.modelInstalled}
          detail={
            status.modelInstalled
              ? `${status.modelPath} (${formatBytes(status.modelSizeBytes)})`
              : status.modelPath
          }
        />
        <SetupRow
          label="NudeNet ONNX (NSFW screen)"
          ok={status.nsfwModelInstalled}
          detail={status.nsfwModelPath}
          warningIfMissing="Recommended — without this, AI outputs are not safety-screened."
        />
      </ul>

      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer text-ink-base font-medium">
          How do I install these?
        </summary>
        <ol className="list-decimal pl-5 mt-2 flex flex-col gap-1.5">
          <li>
            Download <code>sd.exe</code> from the{' '}
            <a
              href="https://github.com/leejet/stable-diffusion.cpp/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              stable-diffusion.cpp releases page
            </a>{' '}
            (pick the CUDA build for NVIDIA GPUs).
          </li>
          <li>
            Place it at <code className="break-all">{status.sdExePath}</code>.{' '}
            <button
              className="text-accent hover:underline"
              onClick={() => window.api.ai.openBinFolder()}
            >
              Open this folder
            </button>
          </li>
          <li>
            Download <code>v1-5-pruned-emaonly.safetensors</code> from{' '}
            <a
              href="https://huggingface.co/runwayml/stable-diffusion-v1-5"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Hugging Face
            </a>
            , place it at <code className="break-all">{status.modelPath}</code>.{' '}
            <button
              className="text-accent hover:underline"
              onClick={() => window.api.ai.openModelsFolder()}
            >
              Open models folder
            </button>
          </li>
          <li>
            (Optional but recommended) download a NudeNet ONNX from{' '}
            <a
              href="https://github.com/notAI-tech/NudeNet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              NudeNet releases
            </a>
            , place at <code className="break-all">{status.nsfwModelPath}</code>.
          </li>
          <li>
            Restart imagii. Reference search and mood boards work without any of these.
          </li>
        </ol>
      </details>
    </div>
  )
}

function SetupRow({
  label,
  ok,
  detail,
  warningIfMissing
}: {
  label: string
  ok: boolean
  detail: string
  warningIfMissing?: string
}): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-0.5 inline-block w-2.5 h-2.5 rounded-full ${
          ok ? 'bg-emerald-400' : 'bg-amber-400'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium">
          {label}{' '}
          <span className={ok ? 'text-emerald-300 text-xs' : 'text-amber-300 text-xs'}>
            {ok ? 'installed' : 'missing'}
          </span>
        </div>
        <div className="text-xs text-ink-dim font-mono break-all">{detail}</div>
        {!ok && warningIfMissing ? (
          <div className="text-xs text-amber-300/80 mt-1">{warningIfMissing}</div>
        ) : null}
      </div>
    </li>
  )
}
