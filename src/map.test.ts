import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapZenMuxModel, mapZenMuxModelInfo } from './map.js'
import {
  DEFAULT_OPTIONS,
  type RoutingInfo,
  type ZenMuxModel,
  type ZenMuxPluginOptions,
} from './types.js'

const PROVIDER_ID = 'zenmux'

function opts(overrides: Partial<ZenMuxPluginOptions> = {}): ZenMuxPluginOptions {
  return { ...DEFAULT_OPTIONS, ...overrides }
}

function model(overrides: Partial<ZenMuxModel> = {}): ZenMuxModel {
  return {
    id: 'acme/chat-model',
    display_name: 'Acme Chat',
    input_modalities: ['text'],
    output_modalities: ['text'],
    context_length: 128000,
    ...overrides,
  }
}

/** Build a pricing array from plain numbers or `{ value, gte }` tiers. */
function pricing(values: Array<number | { value: number; gte: number }>) {
  return values.map((v) =>
    typeof v === 'number'
      ? { value: v }
      : { value: v.value, conditions: { prompt_tokens: { gte: v.gte } } }
  )
}

describe('pricing', () => {
  it('maps flat pricing into V1 cost and a single V2 tier', () => {
    const m = model({
      pricings: {
        prompt: [{ value: 3 }],
        completion: [{ value: 15 }],
        input_cache_read: [{ value: 0.3 }],
        input_cache_write: [{ value: 1.5 }],
      },
    })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.deepEqual(v1.cost, { input: 3, output: 15, cache: { read: 0.3, write: 1.5 } })

    const v2 = mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts())
    assert.equal(v2.cost.length, 1)
    assert.deepEqual(v2.cost[0], { input: 3, output: 15, cache: { read: 0.3, write: 1.5 } })
  })

  it('sorts tiers and surfaces the highest as experimentalOver200K', () => {
    const m = model({
      pricings: {
        prompt: pricing([
          { value: 4, gte: 200000 },
          { value: 1, gte: 0 },
        ]),
        completion: pricing([
          { value: 8, gte: 200000 },
          { value: 2, gte: 0 },
        ]),
        input_cache_read: [{ value: 0.1 }],
        input_cache_write: [{ value: 0.2 }],
      },
    })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.equal(v1.cost.input, 1)
    assert.equal(v1.cost.output, 2)
    assert.deepEqual(v1.cost.experimentalOver200K, {
      input: 4,
      output: 8,
      cache: { read: 0.1, write: 0.2 },
    })

    const v2 = mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts())
    assert.equal(v2.cost.length, 2)
    assert.deepEqual(v2.cost[1], {
      tier: { type: 'context', size: 200000 },
      input: 4,
      output: 8,
      cache: { read: 0.1, write: 0.2 },
    })
  })

  it('does not create an extended tier from a single tiered entry', () => {
    const m = model({
      pricings: {
        prompt: pricing([{ value: 2, gte: 100000 }]),
        completion: [{ value: 6 }],
        input_cache_read: [{ value: 0 }],
      },
    })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.equal(v1.cost.input, 2)
    assert.equal(v1.cost.experimentalOver200K, undefined)
  })

  it('treats missing pricings as zero cost without an extended tier', () => {
    const v1 = mapZenMuxModel(model(), PROVIDER_ID, {}, opts())
    assert.deepEqual(v1.cost, { input: 0, output: 0, cache: { read: 0, write: 0 } })
  })

  it('falls back to input_cache_write_1_h for the cache-write price', () => {
    const m = model({
      pricings: {
        prompt: [{ value: 1 }],
        completion: [{ value: 1 }],
        input_cache_read: [{ value: 0 }],
        input_cache_write_1_h: [{ value: 2.5 }],
      },
    })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.equal(v1.cost.cache.write, 2.5)
  })
})

describe('routing and sdk', () => {
  it('rewrites api.id when a provider is routed, leaving id alone', () => {
    const routing: Record<string, RoutingInfo> = { 'acme/chat-model': { provider: 'upstream' } }
    const v1 = mapZenMuxModel(model(), PROVIDER_ID, routing, opts())
    assert.equal(v1.id, 'acme/chat-model')
    assert.equal(v1.api.id, 'acme/chat-model:upstream')

    const v2 = mapZenMuxModelInfo(model(), PROVIDER_ID, routing, opts())
    assert.equal(v2.id, 'acme/chat-model')
    assert.equal(v2.modelID, 'acme/chat-model:upstream')
  })

  it('moves the provider suffix into id when routedModelIds is set', () => {
    const routing: Record<string, RoutingInfo> = { 'acme/chat-model': { provider: 'upstream' } }
    const v1 = mapZenMuxModel(model(), PROVIDER_ID, routing, opts({ routedModelIds: true }))
    assert.equal(v1.id, 'acme/chat-model:upstream')
    assert.equal(v1.api.id, 'acme/chat-model:upstream')
  })

  it('swaps to the Anthropic SDK and base URL for sdk: anthropic', () => {
    const routing: Record<string, RoutingInfo> = { 'acme/chat-model': { sdk: 'anthropic' } }
    const v1 = mapZenMuxModel(model(), PROVIDER_ID, routing, opts())
    assert.equal(v1.api.npm, '@ai-sdk/anthropic')
    assert.equal(v1.api.url, DEFAULT_OPTIONS.anthropicBaseURL)
    assert.equal(v1.api.id, 'acme/chat-model')

    const v2 = mapZenMuxModelInfo(model(), PROVIDER_ID, routing, opts())
    assert.equal(v2.package, '@opencode/ai/providers/anthropic')
    assert.deepEqual(v2.settings, { baseURL: DEFAULT_OPTIONS.anthropicBaseURL })
  })

  it('defaults to the OpenAI-compatible SDK and base URL', () => {
    const v1 = mapZenMuxModel(model(), PROVIDER_ID, {}, opts())
    assert.equal(v1.api.npm, '@ai-sdk/openai-compatible')
    assert.equal(v1.api.url, DEFAULT_OPTIONS.baseURL)

    const v2 = mapZenMuxModelInfo(model(), PROVIDER_ID, {}, opts())
    assert.equal(v2.package, '@opencode/ai/providers/openai-compatible')
  })
})

describe('reasoning_content', () => {
  it('marks models matching reasoningContentModels as interleaved', () => {
    const m = model({ id: 'deepseek/deepseek-chat', display_name: 'DeepSeek Chat' })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.deepEqual(v1.capabilities.interleaved, { field: 'reasoning_content' })

    const v2 = mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts())
    assert.deepEqual(v2.compatibility, { reasoningField: 'reasoning_content' })
  })

  it('unions in slugs discovered from the models.dev cache', () => {
    const m = model({ id: 'other/model', display_name: 'Other' })
    const slugs = new Set(['other/model'])
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts(), slugs)
    assert.deepEqual(v1.capabilities.interleaved, { field: 'reasoning_content' })
  })

  it('never marks Anthropic-routed models as interleaved', () => {
    const routing: Record<string, RoutingInfo> = { 'deepseek/deepseek-chat': { sdk: 'anthropic' } }
    const v1 = mapZenMuxModel(model({ id: 'deepseek/deepseek-chat' }), PROVIDER_ID, routing, opts())
    assert.equal(v1.capabilities.interleaved, false)
  })
})

describe('modalities, limits, variants and release date', () => {
  it('maps modalities including file -> pdf', () => {
    const m = model({ input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.equal(v1.capabilities.input.pdf, true)
    assert.equal(v1.capabilities.input.image, true)
    assert.equal(v1.capabilities.attachment, true)

    const v2 = mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts())
    assert.deepEqual(v2.capabilities.input, ['text', 'image', 'pdf'])
    assert.deepEqual(v2.capabilities.output, ['text'])
  })

  it('prefers frontend max_completion_tokens and derives limit.input', () => {
    const m = model({ _frontend: { slug: 'acme/chat-model', max_completion_tokens: 8192 } })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.deepEqual(v1.limit, { context: 128000, input: 119808, output: 8192 })
  })

  it('falls back to defaultOutputTokens and omits limit.input without frontend data', () => {
    const v1 = mapZenMuxModel(model(), PROVIDER_ID, {}, opts({ defaultOutputTokens: 4096 }))
    assert.deepEqual(v1.limit, { context: 128000, output: 4096 })
  })

  it('emits reasoning variants keyed by effort', () => {
    const m = model({ capabilities: { reasoning: true } })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.deepEqual(Object.keys(v1.variants ?? {}), ['low', 'medium', 'high', 'max'])
    assert.deepEqual(v1.variants?.low, { reasoningEffort: 'low' })

    const v2 = mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts())
    assert.deepEqual(
      v2.variants.map((v) => v.id),
      ['low', 'medium', 'high', 'max']
    )
  })

  it('uses Anthropic thinking variants for reasoning models on the Anthropic SDK', () => {
    const routing: Record<string, RoutingInfo> = { 'acme/chat-model': { sdk: 'anthropic' } }
    const m = model({ capabilities: { reasoning: true } })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, routing, opts())
    assert.deepEqual(v1.variants?.high, {
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'high',
    })
  })

  it('has no variants for non-reasoning models', () => {
    assert.deepEqual(mapZenMuxModel(model(), PROVIDER_ID, {}, opts()).variants, {})
    assert.deepEqual(mapZenMuxModelInfo(model(), PROVIDER_ID, {}, opts()).variants, [])
  })

  it('converts publish_time to epoch seconds and 0 when invalid', () => {
    const v2 = mapZenMuxModelInfo(
      model({ publish_time: '2025-01-02T03:04:05.000Z' }),
      PROVIDER_ID,
      {},
      opts()
    )
    assert.equal(v2.time.released, Math.floor(Date.parse('2025-01-02T03:04:05.000Z') / 1000))

    const bad = mapZenMuxModelInfo(model({ publish_time: 'not-a-date' }), PROVIDER_ID, {}, opts())
    assert.equal(bad.time.released, 0)
  })
})
