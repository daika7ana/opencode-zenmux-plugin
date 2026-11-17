import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { Config, PluginInput } from '@opencode-ai/plugin'
import type { Model, Plugin, Provider } from '@opencode/plugin'
import plugin from './index.js'
import { fetchModels } from './fetch.js'
import { DEFAULT_OPTIONS, type ZenMuxModel } from './types.js'

let dir: string
const realFetch = globalThis.fetch

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zenmux-index-'))
  process.env.XDG_CACHE_HOME = dir
})

afterEach(async () => {
  globalThis.fetch = realFetch
  delete process.env.XDG_CACHE_HOME
  await rm(dir, { recursive: true, force: true })
})

describe('server config hook', () => {
  it('keeps a user-defined zenmux provider and merges options', async () => {
    const hooks = await plugin.server({ directory: dir } as PluginInput, {
      baseURL: 'https://example.test/v1',
    })
    const config = {
      provider: { zenmux: { options: { timeout: 5000 } } },
    } as unknown as Config

    await hooks.config!(config)

    const provider = (
      config.provider as Record<string, { name: string; options: Record<string, unknown> }>
    ).zenmux
    assert.equal(provider.options.timeout, 5000)
    assert.equal(provider.options.baseURL, 'https://example.test/v1')
    assert.equal(provider.name, 'ZenMux')
  })
})

describe('V2 setup', () => {
  it('registers the cached catalog without waiting for the network', async () => {
    const model: ZenMuxModel = {
      id: 'acme/chat-model',
      display_name: 'Acme Chat',
      input_modalities: ['text'],
      output_modalities: ['text'],
      context_length: 128000,
    }
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: [model] }),
    })) as unknown as typeof fetch
    await fetchModels(DEFAULT_OPTIONS)

    // Later fetches hang: only the disk cache can feed registration.
    globalThis.fetch = (async () => new Promise<Response>(() => {})) as typeof fetch

    const added: Array<{ info: Provider.Info; models: readonly Model.Info[] }> = []
    type Editor = { add(input: { info: Provider.Info; models: readonly Model.Info[] }): void }
    let reloaded = false
    const pending = plugin.setup({
      location: { directory: dir },
      provider: {
        async transform(callback: (editor: Editor) => void) {
          callback({ add: (input) => added.push(input) })
          return { dispose: async () => {} }
        },
        async reload() {
          reloaded = true
        },
      },
    } as unknown as Plugin.Context)

    // Registration must land before setup's first suspension, with no reload.
    assert.equal(added.length, 1)
    assert.equal(reloaded, false)
    const cleanup = await pending

    // Warm cache, so the background refresh finishes without the network.
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(reloaded, true)

    assert.equal(added[0].info.id, 'zenmux')
    assert.equal(added[0].info.activation, 'enabled')
    assert.deepEqual(
      added[0].models.map((entry) => entry.id),
      ['acme/chat-model']
    )

    await cleanup()
  })
})
