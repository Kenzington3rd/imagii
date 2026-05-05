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
