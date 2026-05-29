export interface SearchResult {
  id: string
  thumbnail: string
  fullUrl: string
  source: string
  title: string
  width?: number
  height?: number
}

export interface SearchResponse {
  query: string
  provider: string
  results: SearchResult[]
  notice?: string
}

export interface MoodBoardItem {
  id: string
  collectionId: string
  thumbnail: string
  fullUrl: string
  source: string
  title: string
  cachedThumbPath?: string
  addedAt: number
}

export interface MoodBoardCollection {
  id: string
  name: string
  items: MoodBoardItem[]
  createdAt: number
}

// Round 17 B-moodboard: validate a renderer-supplied SearchResult before it
// reaches the moodboard JSON store. The store concatenates `fullUrl` into a
// cache write and serializes the whole object; an unchecked input could
// stash hostile fields the parser later trusts. Throws on the first failure
// with a message identifying the offending field. Mirrors the validator
// pattern in src/shared/validators.ts (no external deps so it stays usable
// from both main and renderer).
export function validateSearchResult(value: unknown): asserts value is SearchResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('searchResult must be a plain object')
  }
  const v = value as Record<string, unknown>
  // id is allowed to be absent (some scrapers omit it); the store re-mints
  // a nanoid for the moodboard item anyway.
  if (typeof v.fullUrl !== 'string' || v.fullUrl.length === 0) {
    throw new Error('searchResult.fullUrl must be a non-empty string')
  }
  if (typeof v.thumbnail !== 'string' || v.thumbnail.length === 0) {
    throw new Error('searchResult.thumbnail must be a non-empty string')
  }
  if (typeof v.source !== 'string' || v.source.length === 0) {
    throw new Error('searchResult.source must be a non-empty string')
  }
  // title is allowed to be empty (some image results have no title) but
  // must still be a string so toString-style serialization is safe.
  if (typeof v.title !== 'string') {
    throw new Error('searchResult.title must be a string')
  }
  // Defensive ceilings so a hostile renderer can't push megabytes per call.
  const MAX_URL = 4096
  const MAX_TITLE = 2048
  if (v.fullUrl.length > MAX_URL) throw new Error('searchResult.fullUrl too long')
  if (v.thumbnail.length > MAX_URL) throw new Error('searchResult.thumbnail too long')
  if (v.source.length > 200) throw new Error('searchResult.source too long')
  if (v.title.length > MAX_TITLE) throw new Error('searchResult.title too long')
}
