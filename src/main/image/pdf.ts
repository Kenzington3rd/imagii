import { PDFDocument } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

export interface PdfPageSpec {
  pngBase64: string
  widthPx: number
  heightPx: number
}

export interface PdfBuildSpec {
  outputPath: string
  dpi: number
  pages: PdfPageSpec[]
  title?: string
  author?: string
}

export async function buildPdf(spec: PdfBuildSpec): Promise<{ outputPath: string; sizeBytes: number }> {
  const pdf = await PDFDocument.create()
  if (spec.title) pdf.setTitle(spec.title)
  if (spec.author) pdf.setAuthor(spec.author)
  pdf.setCreator('imagii')
  pdf.setProducer('imagii')

  for (const page of spec.pages) {
    const pngBytes = base64ToBytes(page.pngBase64)
    const image = await pdf.embedPng(pngBytes)
    const pageWidthPt = (page.widthPx / spec.dpi) * 72
    const pageHeightPt = (page.heightPx / spec.dpi) * 72
    const pdfPage = pdf.addPage([pageWidthPt, pageHeightPt])
    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidthPt,
      height: pageHeightPt
    })
  }

  const bytes = await pdf.save()
  await writeFile(spec.outputPath, bytes)
  return { outputPath: spec.outputPath, sizeBytes: bytes.length }
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:image\/png;base64,/, '')
  return Buffer.from(clean, 'base64')
}
