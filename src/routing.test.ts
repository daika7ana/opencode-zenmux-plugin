import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { loadRoutingTable } from './routing.js'
import { DEFAULT_OPTIONS, type ZenMuxPluginOptions, type ZenMuxRoutingTable } from './types.js'

function opts(overrides: Partial<ZenMuxPluginOptions> = {}): ZenMuxPluginOptions {
  return { ...DEFAULT_OPTIONS, ...overrides }
}

describe('loadRoutingTable', () => {
  it('normalizes an inline table into a record with optional fields', async () => {
    const inline: ZenMuxRoutingTable = [
      { model: 'acme/a', provider: 'upstream' },
      { model: 'acme/b', sdk: 'anthropic' },
      { model: 'acme/c' },
    ]
    const table = await loadRoutingTable(opts(), process.cwd(), inline)
    assert.deepEqual(table, {
      'acme/a': { provider: 'upstream' },
      'acme/b': { sdk: 'anthropic' },
      'acme/c': {},
    })
  })

  it('skips entries without a model id', async () => {
    const inline = [{ model: 'acme/a' }, { provider: 'x' }] as unknown as ZenMuxRoutingTable
    const table = await loadRoutingTable(opts(), process.cwd(), inline)
    assert.deepEqual(Object.keys(table), ['acme/a'])
  })

  it('rejects the legacy object form', async () => {
    const legacy = { 'acme/a': 'upstream' } as unknown as ZenMuxRoutingTable
    await assert.rejects(() => loadRoutingTable(opts(), process.cwd(), legacy), /expected an array/)
  })

  it('disables routing when routingFile is set but missing (no inline fallback)', async () => {
    const missing = join(tmpdir(), 'zenmux-definitely-missing', 'zenmux-providers.json')
    const inline: ZenMuxRoutingTable = [{ model: 'acme/a', provider: 'upstream' }]
    const table = await loadRoutingTable(opts({ routingFile: missing }), process.cwd(), inline)
    assert.deepEqual(table, {})
  })
})
