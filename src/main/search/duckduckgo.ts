import { net } from 'electron'
import { nanoid } from 'nanoid'
import type { SearchResponse, SearchResult } from '../../shared/search'

interface DdgImageItem {
  image: string
  thumbnail: string
  url: string
  title: string
  width?: number
  height?: number
  source?: string
}

interface DdgResponse {
  results: DdgImageItem[]
  next?: string
}

async function getVqd(query: string): Promise<string | null> {
  const html = await fetchText(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`)
  const m = html.match(/vqd=['"]([^'"]+)['"]/) ?? html.match(/vqd=([\d-]+)/)
  if (!m) return null
  const captured = m[1]
  return captured ?? null
}

async function fetchText(url: string): Promise<string> {
  const res = await net.fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml'
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await net.fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'application/json'
    }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export async function searchDuckduckgoImages(query: string): Promise<SearchResponse> {
  const vqd = await getVqd(query)
  if (!vqd) {
    return {
      query,
      provider: 'duckduckgo',
      results: [],
      notice: 'Could not initialize search session. Try again or switch provider.'
    }
  }
  const url =
    `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}` +
    `&vqd=${vqd}&p=1&l=us-en&o=json&f=,,,,,&s=0`
  try {
    const json = await fetchJson<DdgResponse>(url)
    const results: SearchResult[] = (json.results ?? []).slice(0, 30).map((item) => ({
      id: nanoid(8),
      thumbnail: item.thumbnail,
      fullUrl: item.image,
      source: item.source ?? new URL(item.url).hostname,
      title: item.title,
      width: item.width,
      height: item.height
    }))
    return { query, provider: 'duckduckgo', results }
  } catch (err) {
    return {
      query,
      provider: 'duckduckgo',
      results: [],
      notice:
        err instanceof Error
          ? `DuckDuckGo search failed: ${err.message}`
          : 'DuckDuckGo search failed'
    }
  }
}
