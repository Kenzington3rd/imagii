import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1825"/>
      <stop offset="100%" stop-color="#0b0b0f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#f472b6"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="256" height="256" rx="56" fill="url(#bg)"/>
  <circle cx="180" cy="76" r="14" fill="#fbbf24"/>
  <path d="M 38 198 L 90 130 L 130 168 L 168 122 L 218 198 Z" fill="url(#accent)" opacity="0.95"/>
  <rect x="48" y="60" width="14" height="120" rx="6" fill="#a78bfa" opacity="0.9"/>
  <rect x="32" y="160" width="14" height="20" rx="3" fill="#a78bfa" opacity="0.5"/>
</svg>`

const sizes = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  const resourcesDir = path.resolve('resources')
  await mkdir(resourcesDir, { recursive: true })

  const svgBuffer = Buffer.from(ICON_SVG)

  const png256Path = path.join(resourcesDir, 'icon.png')
  await sharp(svgBuffer).resize(256, 256).png().toFile(png256Path)

  const pngBuffers = await Promise.all(
    sizes.map((s) => sharp(svgBuffer).resize(s, s).png().toBuffer())
  )

  const ico = await pngToIco(pngBuffers)
  const icoPath = path.join(resourcesDir, 'icon.ico')
  await writeFile(icoPath, ico)

  console.log(`✓ ${png256Path}`)
  console.log(`✓ ${icoPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
