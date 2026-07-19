import type {
  ModelV2,
  RoutingInfo,
  ZenMuxModel,
  ZenMuxPluginOptions,
  ZenMuxPricing,
} from './types.js'

/**
 * Map a single ZenMux model record to the OpenCode ModelV2 shape.
 *
 * @param model - The raw ZenMux model from the API.
 * @param providerID - The OpenCode provider id ("zenmux").
 * @param routing - The loaded routing table (modelId → RoutingInfo).
 * @param opts - Plugin options.
 */
export function mapZenMuxModel(
  model: ZenMuxModel,
  providerID: string,
  routing: Record<string, RoutingInfo>,
  opts: ZenMuxPluginOptions
): ModelV2 {
  const routingEntry = routing[model.id]
  const apiId = routingEntry?.provider ? `${model.id}:${routingEntry.provider}` : model.id
  const modelId = opts.routedModelIds ? apiId : model.id

  const isAnthropic = routingEntry?.sdk === 'anthropic'
  const sdkPackage = isAnthropic ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible'
  const apiUrl = isAnthropic ? opts.anthropicBaseURL : opts.baseURL

  const inputMods = model.input_modalities ?? []
  const outputMods = model.output_modalities ?? []

  // ZenMux prices are already USD per 1M tokens, which matches the unit
  // OpenCode expects for ModelV2 cost fields.
  //
  // Some models have tiered pricing via conditions.prompt_tokens (gte/lt).
  // We surface the lowest tier as the base cost and the highest tier as
  // experimentalOver200K when there are 2+ tiers.
  type TieredPrice = { base: number; extended?: number }

  const extractPricing = (arr: ZenMuxPricing[] | undefined): TieredPrice => {
    if (!arr || arr.length === 0) return { base: 0 }

    const hasTiers = arr.some((p) => p.conditions?.prompt_tokens)
    if (!hasTiers) {
      return { base: arr[0].value }
    }

    const sorted = [...arr].sort((a, b) => {
      const aGte = a.conditions?.prompt_tokens?.gte ?? 0
      const bGte = b.conditions?.prompt_tokens?.gte ?? 0
      return aGte - bGte
    })

    if (sorted.length === 1) return { base: sorted[0].value }

    return {
      base: sorted[0].value,
      extended: sorted[sorted.length - 1].value,
    }
  }

  const promptPricing = extractPricing(model.pricings?.prompt)
  const completionPricing = extractPricing(model.pricings?.completion)
  const cacheReadPricing = extractPricing(model.pricings?.input_cache_read)
  const cacheWritePricing = extractPricing(
    model.pricings?.input_cache_write && model.pricings.input_cache_write.length > 0
      ? model.pricings.input_cache_write
      : model.pricings?.input_cache_write_1_h
  )

  const cost: ModelV2['cost'] = {
    input: promptPricing.base,
    output: completionPricing.base,
    cache: {
      read: cacheReadPricing.base,
      write: cacheWritePricing.base,
    },
  }

  const hasExtendedTier = [
    promptPricing,
    completionPricing,
    cacheReadPricing,
    cacheWritePricing,
  ].some((p) => p.extended !== undefined)
  if (hasExtendedTier) {
    cost.experimentalOver200K = {
      input: promptPricing.extended ?? promptPricing.base,
      output: completionPricing.extended ?? completionPricing.base,
      cache: {
        read: cacheReadPricing.extended ?? cacheReadPricing.base,
        write: cacheWritePricing.extended ?? cacheWritePricing.base,
      },
    }
  }

  // Limits: prefer max_completion_tokens from the frontend API enrichment.
  // input = context_length - max_completion_tokens (clamped to ≥ 0).
  const maxOutputTokens = model._frontend?.max_completion_tokens
  const outputLimit = maxOutputTokens != null ? maxOutputTokens : opts.defaultOutputTokens
  const contextLength = model.context_length ?? 64000
  const inputLimit =
    maxOutputTokens != null && model.context_length != null
      ? Math.max(0, model.context_length - maxOutputTokens)
      : undefined

  return {
    id: modelId,
    providerID,
    api: {
      id: apiId,
      url: apiUrl,
      npm: sdkPackage,
    },
    name: model.display_name ?? model.id,
    family: model.owned_by,
    capabilities: {
      temperature: true,
      reasoning: model.capabilities?.reasoning ?? false,
      attachment: inputMods.includes('image') || inputMods.includes('file'),
      toolcall: model._frontend?.supported_parameters?.includes('tools')
        ? true
        : outputMods.includes('text'),
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
    cost,
    limit: {
      context: contextLength,
      ...(inputLimit != null ? { input: inputLimit } : {}),
      output: outputLimit,
    },
    status: 'active' as const,
    options: {},
    headers: {},
    release_date: model.publish_time ?? '',
    variants: model.capabilities?.reasoning
      ? isAnthropic
        ? {
            low: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'low' },
            medium: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'medium' },
            high: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high' },
            max: { thinking: { type: 'adaptive', display: 'summarized' }, effort: 'max' },
          }
        : {
            low: { reasoningEffort: 'low' },
            medium: { reasoningEffort: 'medium' },
            high: { reasoningEffort: 'high' },
            max: { reasoningEffort: 'max' },
          }
      : {},
  }
}
