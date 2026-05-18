import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { nanoid } from 'nanoid'
import {
  ASSET_CATALOG,
  ASSET_CATEGORY_LABELS,
  ASSET_CATEGORY_ICONS,
  getAssetsByCategory,
  type AssetCategory,
  type CatalogAsset
} from './assetCatalog'
import { PanelHeader } from '../../components/PanelHeader'
import { useCanvasStore } from '../image-studio/state/canvasStore'

/**
 * Asset Library tab. Curated CC0 / imagii-authored assets that the user
 * can drop directly into the Stream Graphics editor with one click.
 *
 * Why this tab exists (vs. the existing template browser inside the
 * Stream Graphics studio): two intents, two surfaces.
 *   - Templates (in Stream Graphics): editable starting points the user
 *     customizes — bring-your-own headline, your own thumbnail face,
 *     your own brand color.
 *   - Asset library (here): finished overlays / scene cards / lower
 *     thirds the user drops in mostly as-is. Smaller, more reusable,
 *     more streamer-utility shaped.
 *
 * Loading an asset replaces the current canvas — same as a template.
 * The asset's `doc.layers` get fresh ids on load so re-drops produce
 * independent layer sets.
 */

function cloneAssetDoc<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

export function AssetLibraryPanel(): JSX.Element {
  const setDocument = useCanvasStore((s) => s.setDocument)
  const navigate = useNavigate()

  function dropToCanvas(asset: CatalogAsset): void {
    const doc = cloneAssetDoc(asset.doc)
    doc.layers = doc.layers.map((l) => ({ ...l, id: nanoid(8) }))
    setDocument(doc)
    toast.success(`Dropped "${asset.name}" into the editor`)
    navigate('/image')
  }

  const grouped = getAssetsByCategory()

  return (
    <div className="flex flex-col gap-5 overflow-y-auto">
      <div className="card p-3 text-xs text-ink-muted">
        Curated assets shipped with imagii — every item is either CC0 or
        imagii-authored and released into the public domain. Click an asset to
        drop it directly into the Stream Graphics editor.
      </div>

      {(Object.keys(grouped) as AssetCategory[]).map((category) => {
        const items = grouped[category]
        if (items.length === 0) return null
        return (
          <section key={category} className="flex flex-col gap-2">
            <PanelHeader icon={ASSET_CATEGORY_ICONS[category]}>
              {ASSET_CATEGORY_LABELS[category]}
            </PanelHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {items.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => dropToCanvas(asset)}
                  className="card p-3 text-left hover:border-accent transition-colors"
                >
                  <div
                    className="w-full rounded mb-2 overflow-hidden border border-ink-dim/30"
                    style={{
                      aspectRatio: `${asset.doc.width} / ${asset.doc.height}`,
                      background:
                        asset.doc.background === 'transparent'
                          ? 'repeating-conic-gradient(#1a1825 0% 25%, #16161e 0% 50%) 0 0 / 16px 16px'
                          : asset.doc.background
                    }}
                  />
                  <div className="text-sm font-medium">{asset.name}</div>
                  <div className="text-xs text-ink-muted mt-1">{asset.description}</div>
                  <div className="text-xs text-ink-dim mt-1 font-mono">
                    {asset.doc.width} × {asset.doc.height}
                  </div>
                  <div className="text-[10px] text-ink-dim mt-1 italic">{asset.license}</div>
                </button>
              ))}
            </div>
          </section>
        )
      })}

      <p className="text-xs text-ink-dim">
        {ASSET_CATALOG.length} assets · drops replace the current Stream Graphics canvas.
      </p>
    </div>
  )
}
