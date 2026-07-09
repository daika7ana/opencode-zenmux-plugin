import type { ModelV2, ZenMuxModel, ZenMuxPluginOptions } from './types.js'

/**
 * Map a single ZenMux model record to the OpenCode ModelV2 shape.
 *
 * @param model - The raw ZenMux model from the API.
 * @param providerID - The OpenCode provider id ("zenmux").
 * @param routing - The loaded routing table (modelId → providerSlug).
 * @param opts - Plugin options.
 */
export function mapZenMuxModel(
  model: ZenMuxModel,
  providerID: string,
  routing: Record<string, string>,
  opts: ZenMuxPluginOptions
): ModelV2 {
  const routedProvider = routing[model.id]
  const apiId = routedProvider ? `${model.id}:${routedProvider}` : model.id
  const modelId = opts.routedModelIds ? apiId : model.id

  const inputMods = model.input_modalities ?? []
  const outputMods = model.output_modalities ?? []

  // ZenMux prices are already USD per 1M tokens, which matches the unit
  // OpenCode expects for ModelV2 cost fields.
  const getPricing = (arr: { value: number }[] | undefined): number => {
    if (!arr || arr.length === 0) return 0
    return arr[0].value
  }

  const cacheWrite =
    model.pricings?.input_cache_write && model.pricings.input_cache_write.length > 0
      ? getPricing(model.pricings.input_cache_write)
      : getPricing(model.pricings?.input_cache_write_1_h)

  return {
    id: modelId,
    providerID,
    api: {
      id: apiId,
      url: opts.baseURL,
      npm: '@ai-sdk/openai-compatible',
    },
    name: model.display_name ?? model.id,
    family: model.owned_by,
    capabilities: {
      temperature: true,
      reasoning: model.capabilities?.reasoning ?? false,
      attachment: inputMods.includes('image') || inputMods.includes('file'),
      toolcall: outputMods.includes('text'),
      input: {
        text: inputMods.includes('text'),
        audio: inputMods.includes('audio'),
        image: inputMods.includes('image'),
        video: inputMods.includes('video'),
        pdf: inputMods.includes('file'),
      },
      output: {
        text: outputMods.includes('text'),
        audio: outputMods.includes('audio'),
        image: outputMods.includes('image'),
        video: outputMods.includes('video'),
        pdf: outputMods.includes('file'),
      },
      interleaved: false,
    },
    cost: {
      input: getPricing(model.pricings?.prompt),
      output: getPricing(model.pricings?.completion),
      cache: {
        read: getPricing(model.pricings?.input_cache_read),
        write: cacheWrite,
      },
    },
    limit: {
      context: model.context_length ?? 0,
      output: opts.defaultOutputTokens,
    },
    status: 'active' as const,
    options: {},
    headers: {},
    release_date: model.publish_time ?? '',
    variants: {},
  }
}
