import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { fetchModels } from './fetch.js'
import { DEFAULT_OPTIONS, type ZenMuxModel, type ZenMuxPluginOptions } from './types.js'

const originalFetch = globalThis.fetch
let dir: string

function opts(overrides: Partial<ZenMuxPluginOptions> = {}): ZenMuxPluginOptions {
  return { ...DEFAULT_OPTIONS, ...overrides }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function catalog(): ZenMuxModel[] {
  return [
    { id: 'acme/chat', display_name: 'Acme Chat', output_modalities: ['text'] },
    { id: 'acme/image', display_name: 'Acme Image', output_modalities: ['text'] },
  ]
}

function useFetch(frontend: unknown[] = []) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url === DEFAULT_OPTIONS.modelsURL) return json({ data: catalog() })
    if (url === DEFAULT_OPTIONS.frontendURL) return json({ success: true, data: frontend })
    throw new Error(`unexpected URL ${url}`)
  }) as typeof fetch
}

function offline() {
  globalThis.fetch = (async () => {
    throw new Error('offline')
  }) as typeof fetch
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zenmux-fetch-'))
  process.env.XDG_CACHE_HOME = dir
  globalThis.fetch = originalFetch
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  delete process.env.XDG_CACHE_HOME
  await rm(dir, { recursive: true, force: true })
})

describe('fetchModels', () => {
  it('fetches, caches and then serves the catalog without the network', async () => {
    useFetch()
    const first = await fetchModels(opts())
    assert.deepEqual(
      first.map((m) => m.id),
      ['acme/chat', 'acme/image']
    )

    offline()
    const second = await fetchModels(opts())
    assert.deepEqual(
      second.map((m) => m.id),
      ['acme/chat', 'acme/image']
    )
  })

  it('falls back to the cached catalog when the network fails', async () => {
    useFetch()
    await fetchModels(opts())

    offline()
    const stale = await fetchModels(opts({ catalogCacheTTL: 0 }))
    assert.deepEqual(
      stale.map((m) => m.id),
      ['acme/chat', 'acme/image']
    )
  })

  it('rethrows when the network fails and nothing is cached', async () => {
    offline()
    await assert.rejects(() => fetchModels(opts()), /Failed to fetch models/)
  })

  it('treats a non-numeric TTL as cache-disabled', async () => {
    useFetch()
    const result = await fetchModels(opts({ catalogCacheTTL: Number.NaN }))
    assert.equal(result.length, 2)
  })

  it('filters non-chat models when excludeNonChat is set', async () => {
    useFetch([{ slug: 'acme/image', max_completion_tokens: null, suitable_api: 'images' }])
    const chat = await fetchModels(opts())
    assert.deepEqual(
      chat.map((m) => m.id),
      ['acme/chat']
    )

    const all = await fetchModels(opts({ excludeNonChat: false }))
    assert.deepEqual(
      all.map((m) => m.id),
      ['acme/chat', 'acme/image']
    )
  })
})
