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

/** Build a pricing array in the live API shape (kTokens thresholds, string values). */
function pricing(values: Array<number | { value: number; gte?: string; gt?: string }>) {
  return values.map((v) =>
    typeof v === 'number'
      ? { value: v }
      : {
          value: v.value,
          unit: 'perMTokens',
          currency: 'USD',
          conditions: {
            prompt_tokens: {
              unit: 'kTokens',
              ...(v.gte !== undefined ? { gte: v.gte } : {}),
              ...(v.gt !== undefined ? { gt: v.gt } : {}),
            },
          },
        }
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

  it('maps kTokens thresholds into V1 cost tiers and V2 tiers', () => {
    const m = model({
      pricings: {
        prompt: pricing([
          { value: 4, gte: '100' },
          { value: 1, gte: '0' },
        ]),
        completion: pricing([
          { value: 8, gte: '100' },
          { value: 2, gte: '0' },
        ]),
        input_cache_read: [{ value: 0.1 }],
        input_cache_write: [{ value: 0.2 }],
      },
    })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.equal(v1.cost.input, 1)
    assert.equal(v1.cost.output, 2)
    assert.deepEqual(v1.cost.tiers, [
      {
        input: 4,
        output: 8,
        cache: { read: 0.1, write: 0.2 },
        tier: { type: 'context', size: 100000 },
      },
    ])

    const v2 = mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts())
    assert.equal(v2.cost.length, 2)
    assert.deepEqual(v2.cost[1], {
      tier: { type: 'context', size: 100000 },
      input: 4,
      output: 8,
      cache: { read: 0.1, write: 0.2 },
    })
  })

  it('keeps a single tiered entry as a tier', () => {
    const m = model({
      pricings: {
        prompt: pricing([{ value: 2, gte: '100' }]),
        completion: [{ value: 6 }],
        input_cache_read: [{ value: 0 }],
      },
    })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.equal(v1.cost.input, 2)
    assert.deepEqual(v1.cost.tiers, [
      {
        input: 2,
        output: 6,
        cache: { read: 0, write: 0 },
        tier: { type: 'context', size: 100000 },
      },
    ])
  })

  it('keeps every tier, including prices below 200K', () => {
    const m = model({
      pricings: {
        prompt: pricing([
          { value: 0.03, gte: '0' },
          { value: 0.06, gte: '32' },
          { value: 0.12, gte: '128' },
        ]),
        completion: [{ value: 1 }],
        input_cache_read: [{ value: 0 }],
      },
    })
    const v1 = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.equal(v1.cost.input, 0.03)
    assert.deepEqual(
      v1.cost.tiers?.map((t) => [t.tier.size, t.input]),
      [
        [32000, 0.06],
        [128000, 0.12],
      ]
    )

    const v2 = mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts())
    assert.deepEqual(
      v2.cost.map((c) => c.tier?.size),
      [undefined, 32000, 128000]
    )
  })

  it('treats gt like gte and reads bare token units', () => {
    const m = model({
      pricings: {
        prompt: [
          { value: 2 },
          { value: 4, conditions: { prompt_tokens: { gt: '100', unit: 'kTokens' } } },
          { value: 9, conditions: { prompt_tokens: { gte: 200000 } } },
        ],
        completion: [{ value: 1 }],
        input_cache_read: [{ value: 0 }],
      },
    })
    const tiers = mapZenMuxModel(m, PROVIDER_ID, {}, opts()).cost.tiers
    assert.deepEqual(
      tiers?.map((t) => t.tier.size),
      [100000, 200000]
    )
  })

  it('resolves duplicate thresholds with the pricingTieBreak policy', () => {
    const m = model({
      pricings: {
        prompt: [
          { value: 0.003, conditions: { prompt_tokens: { unit: 'kTokens', gte: '0' } } },
          { value: 0.006, conditions: { prompt_tokens: { unit: 'kTokens', gte: '0' } } },
          { value: 0.01, conditions: { prompt_tokens: { unit: 'kTokens', gte: '32' } } },
          { value: 0.02, conditions: { prompt_tokens: { unit: 'kTokens', gte: '32' } } },
        ],
        completion: [{ value: 1 }],
        input_cache_read: [{ value: 0 }],
      },
    })

    const lowest = mapZenMuxModel(m, PROVIDER_ID, {}, opts())
    assert.equal(lowest.cost.input, 0.003)
    assert.equal(lowest.cost.tiers?.[0].input, 0.01)

    const highest = mapZenMuxModel(m, PROVIDER_ID, {}, opts({ pricingTieBreak: 'highest' }))
    assert.equal(highest.cost.input, 0.006)
    assert.equal(highest.cost.tiers?.[0].input, 0.02)

    const v2 = mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts())
    assert.equal(v2.cost[0].input, 0.003)
    assert.equal(v2.cost[1].input, 0.01)
  })

  it('uses the lowest price for condition-less duplicate entries by default', () => {
    const m = model({
      pricings: {
        prompt: [{ value: 0.075 }, { value: 0.15 }, { value: 0.075 }],
        completion: [{ value: 1 }],
        input_cache_read: [{ value: 0 }],
      },
    })
    assert.equal(mapZenMuxModel(m, PROVIDER_ID, {}, opts()).cost.input, 0.075)
    assert.equal(
      mapZenMuxModel(m, PROVIDER_ID, {}, opts({ pricingTieBreak: 'highest' })).cost.input,
      0.15
    )
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

describe('tool capability', () => {
  it('does not claim tools when a declared parameter list lacks them', () => {
    const m = model({
      _frontend: {
        slug: 'acme/chat-model',
        max_completion_tokens: null,
        supported_parameters: 'max_tokens,temperature',
      },
    })
    assert.equal(mapZenMuxModel(m, PROVIDER_ID, {}, opts()).capabilities.toolcall, false)
    assert.equal(mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts()).capabilities.tools, false)
  })

  it('claims tools when the declared list includes them', () => {
    const m = model({
      _frontend: {
        slug: 'acme/chat-model',
        max_completion_tokens: null,
        supported_parameters: 'max_tokens,tools',
      },
    })
    assert.equal(mapZenMuxModel(m, PROVIDER_ID, {}, opts()).capabilities.toolcall, true)
    assert.equal(mapZenMuxModelInfo(m, PROVIDER_ID, {}, opts()).capabilities.tools, true)
  })

  it('falls back to text output when the parameter list is empty', () => {
    const m = model({
      _frontend: { slug: 'acme/chat-model', max_completion_tokens: null, supported_parameters: '' },
    })
    assert.equal(mapZenMuxModel(m, PROVIDER_ID, {}, opts()).capabilities.toolcall, true)
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
