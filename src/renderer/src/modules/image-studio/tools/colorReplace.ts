interface RGB {
  r: number
  g: number
  b: number
}

function parseColor(input: string): RGB {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.fillStyle = input
  const computed = ctx.fillStyle as string
  if (computed.startsWith('#')) {
    const hex = computed.slice(1)
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    }
  }
  const m = computed.match(/rgba?\(([^)]+)\)/i)
  if (!m) return { r: 0, g: 0, b: 0 }
  const parts = m[1].split(',').map((s) => parseFloat(s))
  return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0 }
}

function rgbDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image failed to load'))
    img.src = src
  })
}

export async function replaceColor(
  src: string,
  pickX: number,
  pickY: number,
  replacementColor: string,
  tolerance0to100: number
): Promise<string> {
  const img = await loadImage(src)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create 2D context')
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, w, h)
  const px = Math.max(0, Math.min(w - 1, Math.round(pickX)))
  const py = Math.max(0, Math.min(h - 1, Math.round(pickY)))
  const i = (py * w + px) * 4
  const target: RGB = {
    r: imageData.data[i],
    g: imageData.data[i + 1],
    b: imageData.data[i + 2]
  }
  const replacement = parseColor(replacementColor)
  const maxDistance = (tolerance0to100 / 100) * 441

  for (let p = 0; p < imageData.data.length; p += 4) {
    const c: RGB = {
      r: imageData.data[p],
      g: imageData.data[p + 1],
      b: imageData.data[p + 2]
    }
    if (rgbDistance(c, target) <= maxDistance) {
      imageData.data[p] = replacement.r
      imageData.data[p + 1] = replacement.g
      imageData.data[p + 2] = replacement.b
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export interface PickedColor {
  hex: string
  rgb: RGB
}

export async function pickColorAt(src: string, x: number, y: number): Promise<PickedColor | null> {
  try {
    const img = await loadImage(src)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    const px = Math.max(0, Math.min(img.naturalWidth - 1, Math.round(x)))
    const py = Math.max(0, Math.min(img.naturalHeight - 1, Math.round(y)))
    const data = ctx.getImageData(px, py, 1, 1).data
    const rgb = { r: data[0], g: data[1], b: data[2] }
    const hex = `#${[rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
    return { hex, rgb }
  } catch {
    return null
  }
}
