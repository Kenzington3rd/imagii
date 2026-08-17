import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The `search:images` channel, argument normalization and failure shape.
 *
 * T-30 added the second half: `runImageSearch` is the channel's whole body,
 * lifted out of `ipcMain.handle` so the sentinel branch can be driven without
 * an Electron main process. `electron` is mocked for the module graph
 * (`search.ts` pulls in `moodboard.ts` -> `sidecars/paths.ts`); only
 * `net.fetch` is actually exercised.
 */
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: { handle: () => {} },
  app: { getPath: () => '/tmp/imagii-search-test' },
  net: { fetch: fetchMock }
}))

const { normalizeImageQuery, runImageSearch } = await import('./search')

const HTML_WITH_VQD = '<script>var vqd="4-123456789012345678901234567890";</script>'

function textResponse(body: string, status = 200): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body))
  }
}

function jsonResponse(payload: unknown, status = 200): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
    json: () => Promise.resolve(payload)
  }
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('normalizeImageQuery', () => {
  it('returns a query for a non-blank string', () => {
    const result = normalizeImageQuery('  cozy stream overlay  ')
    expect(result).toEqual({ query: '  cozy stream overlay  ' })
  })

  it('returns the empty-result shape for a blank string', () => {
    const result = normalizeImageQuery('   ')
    expect(result).toEqual({
      empty: { query: '   ', provider: 'duckduckgo', results: [] }
    })
  })

  it('returns the empty-result shape for an empty string', () => {
    expect(normalizeImageQuery('')).toEqual({
      empty: { query: '', provider: 'duckduckgo', results: [] }
    })
  })

  // Regression (bug round 10): a non-string IPC arg made `query.trim()`
  // throw a TypeError across the IPC boundary instead of returning a
  // clean empty result.
  it.each([undefined, null, 42, {}, [], true])(
    'returns the empty-result shape for non-string arg %p without throwing',
    (arg) => {
      const result = normalizeImageQuery(arg)
      expect(result).toEqual({
        empty: { query: '', provider: 'duckduckgo', results: [] }
      })
    }
  )
})

/**
 * T-30 — the two hops fail identically now.
 *
 * The renderer stores whatever comes back: a resolved response's `notice`
 * renders as the amber card, a REJECTED invoke renders as the rose error card
 * carrying Electron's "Error invoking remote method 'search:images': …"
 * preamble. Hop 1 used to take the second path for the same event that hop 2
 * reported through the first, so which sentence a user got depended on which
 * request the outage happened to kill.
 */
describe('runImageSearch — a failed search is a notice, whichever hop failed', () => {
  it('turns a first-hop network failure into the friendly notice', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net::ERR_PROXY_CONNECTION_FAILED'))

    await expect(runImageSearch('mountains')).resolves.toEqual({
      query: 'mountains',
      provider: 'duckduckgo',
      results: [],
      notice: 'DuckDuckGo search failed: net::ERR_PROXY_CONNECTION_FAILED'
    })
  })

  it('turns a first-hop HTTP error into the friendly notice', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('', 503))

    await expect(runImageSearch('mountains')).resolves.toEqual({
      query: 'mountains',
      provider: 'duckduckgo',
      results: [],
      notice: 'DuckDuckGo search failed: HTTP 503'
    })
  })

  it('gives a second-hop HTTP error the identical shape', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse(HTML_WITH_VQD))
      .mockResolvedValueOnce(jsonResponse({}, 429))

    await expect(runImageSearch('mountains')).resolves.toEqual({
      query: 'mountains',
      provider: 'duckduckgo',
      results: [],
      notice: 'DuckDuckGo search failed: HTTP 429'
    })
  })

  it('never rejects on a query that cannot be URL-encoded', async () => {
    // A lone surrogate: `encodeURIComponent` throws before any request goes
    // out, which used to reach the user as raw IPC text like every other
    // hop-1 failure.
    await expect(runImageSearch('\uD800')).resolves.toMatchObject({
      results: [],
      notice: expect.stringMatching(/^DuckDuckGo search failed: /) as unknown as string
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still short-circuits a blank query without touching the network', async () => {
    await expect(runImageSearch('   ')).resolves.toEqual({
      query: '   ',
      provider: 'duckduckgo',
      results: []
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes a successful search straight through', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(HTML_WITH_VQD)).mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            image: 'https://cdn.example.com/full/1.jpg',
            thumbnail: 'https://external-content.duckduckgo.com/iu/?u=thumb1',
            url: 'https://photos.example.com/gallery/1',
            title: 'Mountain photograph 1',
            source: 'Example Photos'
          }
        ]
      })
    )

    const response = await runImageSearch('mountains')

    expect(response.notice).toBeUndefined()
    expect(response.results).toHaveLength(1)
  })
})
