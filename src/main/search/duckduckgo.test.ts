import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateSearchResult } from '../../shared/search'

/**
 * T-26: `searchDuckduckgoImages` on fixture bytes.
 *
 * Live DuckDuckGo is HL-network — the ledger's Reference-Search rows are
 * dispositioned there, and `tests/e2e/references.spec.ts` drives only the
 * failure path. This file covers the half that a fixture CAN reach: the
 * two-step scrape (vqd token out of the search page HTML, then i.js JSON),
 * every branch that turns a bad upstream response into a user-visible
 * notice, and the request shape itself.
 *
 * The only seam is `electron.net.fetch`, mocked per test. Everything else —
 * the vqd regexes, the URL builder, the result mapper, the `source`
 * fallback, the 30-result cap — is the real module.
 *
 * The last block is the composition test the string-shape tests can't be:
 * hostile upstream JSON parses fine here, then meets `validateSearchResult`
 * at the `moodboard:addItem` boundary, and the exact rejection reason is
 * pinned. `shared/searchValidate.test.ts` proves the validator against
 * hand-built objects; this proves it against real parser output.
 */

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: fetchMock } }))

const { searchDuckduckgoImages } = await import('./duckduckgo')

// ── Fixtures ─────────────────────────────────────────────────────────────
// Trimmed but structurally faithful excerpts of what duckduckgo.com serves.

/** The primary pattern: a quoted `vqd=` assignment inside an inline script. */
const HTML_VQD_QUOTED = `<!DOCTYPE html><html><head><title>test at DuckDuckGo</title></head>
<body><script type="text/javascript">
  var vqd="4-123456789012345678901234567890";
  DDG.page = new DDG.Pages.SERP({ ia:"images" });
</script><div id="links"></div></body></html>`
const VQD_QUOTED = '4-123456789012345678901234567890'

/** The fallback case: same token, emitted bare in a query string. */
const HTML_VQD_UNQUOTED = `<!DOCTYPE html><html><head><title>test at DuckDuckGo</title></head>
<body><a href="/i.js?q=test&o=json&vqd=4-98765432109876543210&f=,,,,,">Images</a></body></html>`
const VQD_UNQUOTED = '4-98765432109876543210'

/** A well-formed page that simply carries no token (blocked / consent wall). */
const HTML_NO_VQD = `<!DOCTYPE html><html><head><title>DuckDuckGo</title></head>
<body><div class="msg">Please verify you are a human.</div></body></html>`

/** Truncated mid-script: the shape a proxy or a cut connection produces. */
const HTML_MALFORMED = '<!DOCTYPE html><html><head><scr'

const NOTICE_NO_VQD = 'Could not initialize search session. Try again or switch provider.'

interface DdgItem {
  image: string
  thumbnail: string
  url: string
  title: string
  width?: number
  height?: number
  source?: string
}

function ddgItem(n: number, overrides: Partial<DdgItem> = {}): DdgItem {
  return {
    image: `https://cdn.example.com/full/${n}.jpg`,
    thumbnail: `https://external-content.duckduckgo.com/iu/?u=thumb${n}`,
    url: `https://photos.example.com/gallery/${n}`,
    title: `Mountain photograph ${n}`,
    width: 1920,
    height: 1080,
    source: 'Example Photos',
    ...overrides
  }
}

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

/** Serve the vqd page, then the i.js payload — the module's two calls. */
function serve(html: string, json: unknown): void {
  fetchMock.mockResolvedValueOnce(textResponse(html)).mockResolvedValueOnce(jsonResponse(json))
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('searchDuckduckgoImages — happy parse', () => {
  it('extracts every result from the i.js payload', async () => {
    serve(HTML_VQD_QUOTED, { results: [ddgItem(1), ddgItem(2), ddgItem(3)] })

    const response = await searchDuckduckgoImages('mountain photography')

    expect(response.provider).toBe('duckduckgo')
    expect(response.query).toBe('mountain photography')
    expect(response.notice).toBeUndefined()
    expect(response.results).toHaveLength(3)
    expect(response.results[0]).toMatchObject({
      thumbnail: 'https://external-content.duckduckgo.com/iu/?u=thumb1',
      fullUrl: 'https://cdn.example.com/full/1.jpg',
      source: 'Example Photos',
      title: 'Mountain photograph 1',
      width: 1920,
      height: 1080
    })
    // Ids are minted locally (nanoid(8)); upstream never supplies one.
    const ids = response.results.map((r) => r.id)
    expect(ids.every((id) => id.length === 8)).toBe(true)
    expect(new Set(ids).size).toBe(3)
  })

  it('requests the search page then i.js, carrying the token and the query', async () => {
    serve(HTML_VQD_QUOTED, { results: [ddgItem(1)] })

    await searchDuckduckgoImages('minimalist mountains')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [htmlUrl, htmlInit] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    const [jsonUrl, jsonInit] = fetchMock.mock.calls[1] as [string, { headers: Record<string, string> }]
    expect(htmlUrl).toBe('https://duckduckgo.com/?q=minimalist%20mountains')
    expect(htmlInit.headers.Accept).toBe('text/html,application/xhtml+xml')
    expect(jsonUrl).toBe(
      `https://duckduckgo.com/i.js?q=minimalist%20mountains&vqd=${VQD_QUOTED}` +
        '&p=1&l=us-en&o=json&f=,,,,,&s=0'
    )
    expect(jsonInit.headers.Accept).toBe('application/json')
    // SafeSearch: `f=,,,,,` is the default-filters marker DDG expects; the
    // panel's "SafeSearch is permanently on" copy rests on this string.
    expect(jsonUrl).toContain('&f=,,,,,')
  })

  it('extracts an unquoted vqd token via the fallback pattern', async () => {
    serve(HTML_VQD_UNQUOTED, { results: [ddgItem(1)] })

    const response = await searchDuckduckgoImages('test')

    expect(response.results).toHaveLength(1)
    expect(fetchMock.mock.calls[1]?.[0]).toContain(`&vqd=${VQD_UNQUOTED}&`)
  })

  it('falls back to the page hostname when the item carries no source', async () => {
    serve(HTML_VQD_QUOTED, {
      results: [ddgItem(1, { source: undefined, url: 'https://photos.example.com/gallery/1' })]
    })

    const response = await searchDuckduckgoImages('test')

    expect(response.results[0]?.source).toBe('photos.example.com')
  })

  it('caps the result set at 30 even when DuckDuckGo returns more', async () => {
    serve(HTML_VQD_QUOTED, {
      results: Array.from({ length: 47 }, (_, i) => ddgItem(i + 1))
    })

    const response = await searchDuckduckgoImages('test')

    expect(response.results).toHaveLength(30)
    expect(response.results[29]?.title).toBe('Mountain photograph 30')
    expect(response.notice).toBeUndefined()
  })

  it('keeps width/height undefined rather than inventing dimensions', async () => {
    serve(HTML_VQD_QUOTED, {
      results: [ddgItem(1, { width: undefined, height: undefined })]
    })

    const response = await searchDuckduckgoImages('test')

    expect(response.results[0]?.width).toBeUndefined()
    expect(response.results[0]?.height).toBeUndefined()
  })
})

describe('searchDuckduckgoImages — vqd token missing', () => {
  it('returns the session notice and never requests i.js', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(HTML_NO_VQD))

    const response = await searchDuckduckgoImages('mountains')

    expect(response.results).toEqual([])
    expect(response.notice).toBe(NOTICE_NO_VQD)
    expect(response.query).toBe('mountains')
    expect(response.provider).toBe('duckduckgo')
    // The second fetch is the expensive one — it must not fire without a token.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns the session notice on malformed HTML instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(HTML_MALFORMED))

    const response = await searchDuckduckgoImages('mountains')

    expect(response.results).toEqual([])
    expect(response.notice).toBe(NOTICE_NO_VQD)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns the session notice on an empty body', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(''))

    const response = await searchDuckduckgoImages('mountains')

    expect(response.notice).toBe(NOTICE_NO_VQD)
  })
})

describe('searchDuckduckgoImages — empty and hostile payloads', () => {
  it('returns an empty result set with no notice when DuckDuckGo has no hits', async () => {
    serve(HTML_VQD_QUOTED, { results: [] })

    const response = await searchDuckduckgoImages('asdkjhasdkjh')

    expect(response.results).toEqual([])
    // No notice: the panel renders its own "No results." copy for this,
    // and an amber notice card on top of it would be wrong.
    expect(response.notice).toBeUndefined()
  })

  it('treats a payload with no results key as empty', async () => {
    serve(HTML_VQD_QUOTED, { next: '/i.js?s=100' })

    const response = await searchDuckduckgoImages('test')

    expect(response.results).toEqual([])
    expect(response.notice).toBeUndefined()
  })

  it('reports a failure notice when the JSON body cannot be parsed', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(HTML_VQD_QUOTED)).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0'))
    })

    const response = await searchDuckduckgoImages('test')

    expect(response.results).toEqual([])
    expect(response.notice).toBe(
      'DuckDuckGo search failed: Unexpected token < in JSON at position 0'
    )
  })

  it('reports a failure notice when i.js answers with an HTTP error', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse(HTML_VQD_QUOTED))
      .mockResolvedValueOnce(jsonResponse({}, 429))

    const response = await searchDuckduckgoImages('test')

    expect(response.results).toEqual([])
    expect(response.notice).toBe('DuckDuckGo search failed: HTTP 429')
  })

  it('reports a failure notice when results is not an array', async () => {
    serve(HTML_VQD_QUOTED, { results: 'not-an-array' })

    const response = await searchDuckduckgoImages('test')

    expect(response.results).toEqual([])
    expect(response.notice).toMatch(/^DuckDuckGo search failed: /)
  })

  it('reports a failure notice when an item has an unparseable url and no source', async () => {
    serve(HTML_VQD_QUOTED, {
      results: [ddgItem(1, { source: undefined, url: 'not a url' })]
    })

    const response = await searchDuckduckgoImages('test')

    expect(response.results).toEqual([])
    expect(response.notice).toMatch(/^DuckDuckGo search failed: /)
  })

  it('rejects — it does not notice — when the vqd page itself fails', async () => {
    // Asymmetry worth pinning: `getVqd` is called OUTSIDE the try/catch, so a
    // failure on the FIRST hop propagates out of the IPC handler and reaches
    // the user as Electron's raw "Error invoking remote method 'search:images'"
    // string (see the error-card assertion in tests/e2e/references.spec.ts),
    // while the identical failure on the second hop becomes friendly copy.
    fetchMock.mockResolvedValueOnce(textResponse('', 503))

    await expect(searchDuckduckgoImages('test')).rejects.toThrow('HTTP 503')
  })

  it('rejects when the network call itself throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net::ERR_PROXY_CONNECTION_FAILED'))

    await expect(searchDuckduckgoImages('test')).rejects.toThrow(
      'net::ERR_PROXY_CONNECTION_FAILED'
    )
  })
})

describe('parser output meets the moodboard:addItem validator', () => {
  const MAX_URL = 4096

  async function firstResult(item: Partial<DdgItem>): Promise<unknown> {
    serve(HTML_VQD_QUOTED, { results: [ddgItem(1, item)] })
    const response = await searchDuckduckgoImages('test')
    return response.results[0]
  }

  it('accepts an ordinary parsed result', async () => {
    const result = await firstResult({})
    expect(() => validateSearchResult(result)).not.toThrow()
  })

  it('accepts a parsed result whose title is empty', async () => {
    const result = await firstResult({ title: '' })
    expect(() => validateSearchResult(result)).not.toThrow()
  })

  it.each([
    ['image', 'searchResult.fullUrl must be a non-empty string'],
    ['thumbnail', 'searchResult.thumbnail must be a non-empty string'],
    ['source', 'searchResult.source must be a non-empty string']
  ])('rejects an empty %s with its exact reason', async (field, reason) => {
    // `item.source ?? hostname` only falls back on null/undefined, so an
    // empty-string source survives the parser and reaches the validator.
    const result = await firstResult({ [field]: '' })
    expect(() => validateSearchResult(result)).toThrow(reason)
  })

  it('rejects a megabyte-sized fullUrl with its exact reason', async () => {
    const result = await firstResult({ image: `https://x.example/${'a'.repeat(MAX_URL)}` })
    expect(() => validateSearchResult(result)).toThrow('searchResult.fullUrl too long')
  })

  it('rejects a megabyte-sized thumbnail with its exact reason', async () => {
    const result = await firstResult({ thumbnail: `https://x.example/${'a'.repeat(MAX_URL)}` })
    expect(() => validateSearchResult(result)).toThrow('searchResult.thumbnail too long')
  })

  it('rejects an oversized source with its exact reason', async () => {
    const result = await firstResult({ source: 'S'.repeat(201) })
    expect(() => validateSearchResult(result)).toThrow('searchResult.source too long')
  })

  it('rejects an oversized title with its exact reason', async () => {
    const result = await firstResult({ title: 'T'.repeat(2049) })
    expect(() => validateSearchResult(result)).toThrow('searchResult.title too long')
  })

  it('rejects a non-string title with its exact reason', async () => {
    const result = await firstResult({ title: 42 as unknown as string })
    expect(() => validateSearchResult(result)).toThrow('searchResult.title must be a string')
  })
})
