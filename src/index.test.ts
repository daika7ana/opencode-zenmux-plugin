import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { Config, PluginInput } from '@opencode-ai/plugin'
import plugin from './index.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zenmux-index-'))
})

afterEach(async () => {
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
