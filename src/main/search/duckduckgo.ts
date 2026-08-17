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

/**
 * T-30 — the search never reached DuckDuckGo.
 *
 * Raised at the point of origin (T-44's rule) so the `search:images` channel
 * can branch on the error's IDENTITY. Before it, the first hop's failures
 * simply propagated: the invoke rejected and the renderer showed Electron's
 * "Error invoking remote method 'search:images': …" preamble, while the very
 * same outage one request later produced friendly copy. Nothing downstream
 * string-matches this — the class IS the signal.
 */
export class SearchUnavailableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'SearchUnavailableError'
  }
}

/**
 * The one place the "we tried and it did not work" copy is written, so both
 * hops say the same thing. `notice` (not a rejection) is what makes the
 * renderer draw its amber card instead of an error card.
 */
export function searchFailureNotice(query: string, err: unknown): SearchResponse {
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

/**
 * Hop 1: the search page, for the per-session `vqd` token hop 2 needs.
 *
 * The guard covers the WHOLE hop, not just the fetch — building the URL runs
 * `encodeURIComponent`, which throws a URIError on a lone surrogate before any
 * request goes out. A missing token is not a failure and still returns null:
 * the caller has its own copy for a page that loaded but carried no token.
 */
async function getVqd(query: string): Promise<string | null> {
  let html: string
  try {
    html = await fetchText(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`)
  } catch (err) {
    throw new SearchUnavailableError(err)
  }
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
    return searchFailureNotice(query, err)
  }
}
