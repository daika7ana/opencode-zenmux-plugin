import type {
  ModelInfoV2,
  ModelV2,
  RoutingInfo,
  ZenMuxModel,
  ZenMuxPluginOptions,
  ZenMuxPricing,
} from './types.js'

type TieredPrice = { base: number; extended?: number }

interface ModalityFlags {
  text: boolean
  audio: boolean
  image: boolean
  video: boolean
  pdf: boolean
}

/** Module-local intermediate shared by the V1 and V2 mappers. */
interface ResolvedModel {
  apiId: string
  modelId: string
  isAnthropic: boolean
  sdkPackage: string
  apiUrl: string
  needsReasoningContent: boolean
  reasoning: boolean
  input: ModalityFlags
  output: ModalityFlags
  promptPricing: TieredPrice
  completionPricing: TieredPrice
  cacheReadPricing: TieredPrice
  cacheWritePricing: TieredPrice
  cost: ModelV2['cost']
  contextLength: number
  outputLimit: number
  inputLimit?: number
  variants: Record<string, Record<string, unknown>>
}

// ZenMux prices are already USD per 1M tokens, which matches the unit
// OpenCode expects for ModelV2 cost fields.
//
// Some models have tiered pricing via conditions.prompt_tokens (gte/lt).
// We surface the lowest tier as the base cost and the highest tier as
// experimentalOver200K when there are 2+ tiers.
function extractPricing(arr: ZenMuxPricing[] | undefined): TieredPrice {
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

/**
 * Compute the shared intermediate for a single ZenMux model record.
 *
 * @param model - The raw ZenMux model from the API.
 * @param providerID - The OpenCode provider id ("zenmux").
 * @param routing - The loaded routing table (modelId → RoutingInfo).
 * @param opts - Plugin options.
 * @param reasoningContentSlugs - Model ids (lowercased) that models.dev marks as
 *   requiring `reasoning_content` passthrough; unioned with
 *   `opts.reasoningContentModels`. Optional.
 */
function resolveZenMuxModel(
  model: ZenMuxModel,
  providerID: string,
  routing: Record<string, RoutingInfo>,
  opts: ZenMuxPluginOptions,
  reasoningContentSlugs?: Set<string>
): ResolvedModel {
  const routingEntry = routing[model.id]
  const apiId = routingEntry?.provider ? `${model.id}:${routingEntry.provider}` : model.id
  const modelId = opts.routedModelIds ? apiId : model.id

  const isAnthropic = routingEntry?.sdk === 'anthropic'
  const sdkPackage = isAnthropic ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible'
  const apiUrl = isAnthropic ? opts.anthropicBaseURL : opts.baseURL

  // A model needs reasoning_content passthrough when it matches the static list
  // (substring) or models.dev marks it as interleaved with reasoning_content.
  const needsReasoningContent =
    !isAnthropic &&
    (opts.reasoningContentModels.some((id) => apiId.toLowerCase().includes(id.toLowerCase())) ||
      reasoningContentSlugs?.has(apiId.toLowerCase()) === true ||
      reasoningContentSlugs?.has(model.id.toLowerCase()) === true)

  const reasoning = model.capabilities?.reasoning ?? false

  const inputMods = model.input_modalities ?? []
  const outputMods = model.output_modalities ?? []

  const input: ModalityFlags = {
    text: inputMods.includes('text'),
    audio: inputMods.includes('audio'),
    image: inputMods.includes('image'),
    video: inputMods.includes('video'),
    pdf: inputMods.includes('file'),
  }
  const output: ModalityFlags = {
    text: outputMods.includes('text'),
    audio: outputMods.includes('audio'),
    image: outputMods.includes('image'),
    video: outputMods.includes('video'),
    pdf: outputMods.includes('file'),
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

  const variants: Record<string, Record<string, unknown>> = reasoning
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
    : {}

  return {
    apiId,
    modelId,
    isAnthropic,
    sdkPackage,
    apiUrl,
    needsReasoningContent,
    reasoning,
    input,
    output,
    promptPricing,
    completionPricing,
    cacheReadPricing,
    cacheWritePricing,
    cost,
    contextLength,
    outputLimit,
    inputLimit,
    variants,
  }
}

/**
 * Map a single ZenMux model record to the OpenCode ModelV2 shape.
 *
 * @param model - The raw ZenMux model from the API.
 * @param providerID - The OpenCode provider id ("zenmux").
 * @param routing - The loaded routing table (modelId → RoutingInfo).
 * @param opts - Plugin options.
 * @param reasoningContentSlugs - Model ids (lowercased) that models.dev marks as
 *   requiring `reasoning_content` passthrough; unioned with
 *   `opts.reasoningContentModels`. Optional.
 */
export function mapZenMuxModel(
  model: ZenMuxModel,
  providerID: string,
  routing: Record<string, RoutingInfo>,
  opts: ZenMuxPluginOptions,
  reasoningContentSlugs?: Set<string>
): ModelV2 {
  const r = resolveZenMuxModel(model, providerID, routing, opts, reasoningContentSlugs)

  return {
    id: r.modelId,
    providerID,
    api: {
      id: r.apiId,
      url: r.apiUrl,
      npm: r.sdkPackage,
    },
    name: model.display_name ?? model.id,
    family: model.owned_by,
    capabilities: {
      temperature: true,
      reasoning: r.reasoning,
      attachment: r.input.image || r.input.pdf,
      toolcall: model._frontend?.supported_parameters?.includes('tools') ? true : r.output.text,
      input: {
        text: r.input.text,
        audio: r.input.audio,
        image: r.input.image,
        video: r.input.video,
        pdf: r.input.pdf,
      },
      output: {
        text: r.output.text,
        audio: r.output.audio,
        image: r.output.image,
        video: r.output.video,
        pdf: r.output.pdf,
      },
      interleaved: r.needsReasoningContent ? { field: 'reasoning_content' as const } : false,
    },
    cost: r.cost,
    limit: {
      context: r.contextLength,
      ...(r.inputLimit != null ? { input: r.inputLimit } : {}),
      output: r.outputLimit,
    },
    status: 'active' as const,
    options: {},
    headers: {},
    release_date: model.publish_time ?? '',
    variants: r.variants,
  }
}

const V2_PACKAGE_OPENAI = '@opencode/ai/providers/openai-compatible'
const V2_PACKAGE_ANTHROPIC = '@opencode/ai/providers/anthropic'

const MODALITY_ORDER = ['text', 'audio', 'image', 'video', 'pdf'] as const

function modalityArray(flags: ModalityFlags): string[] {
  return MODALITY_ORDER.filter((m) => flags[m])
}

/**
 * Map a single ZenMux model record to the documented V2 Model.Info shape.
 *
 * @param model - The raw ZenMux model from the API.
 * @param providerID - The OpenCode provider id ("zenmux").
 * @param routing - The loaded routing table (modelId → RoutingInfo).
 * @param opts - Plugin options.
 * @param reasoningContentSlugs - Model ids (lowercased) that models.dev marks as
 *   requiring `reasoning_content` passthrough; unioned with
 *   `opts.reasoningContentModels`. Optional.
 */
export function mapZenMuxModelInfo(
  model: ZenMuxModel,
  providerID: string,
  routing: Record<string, RoutingInfo>,
  opts: ZenMuxPluginOptions,
  reasoningContentSlugs?: Set<string>
): ModelInfoV2 {
  const r = resolveZenMuxModel(model, providerID, routing, opts, reasoningContentSlugs)

  const cost: ModelInfoV2['cost'] = [
    {
      input: r.cost.input,
      output: r.cost.output,
      cache: { read: r.cost.cache.read, write: r.cost.cache.write },
    },
  ]
  if (r.cost.experimentalOver200K) {
    const ext = r.cost.experimentalOver200K
    cost.push({
      tier: { type: 'context', size: 200000 },
      input: ext.input,
      output: ext.output,
      cache: { read: ext.cache.read, write: ext.cache.write },
    })
  }

  const parsed = model.publish_time ? Date.parse(model.publish_time) : NaN
  const released = Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000)

  return {
    id: r.modelId,
    modelID: r.apiId,
    providerID,
    family: model.owned_by,
    name: model.display_name ?? model.id,
    capabilities: {
      tools: model._frontend?.supported_parameters?.includes('tools') ? true : r.output.text,
      input: modalityArray(r.input),
      output: modalityArray(r.output),
    },
    variants: r.reasoning
      ? Object.entries(r.variants).map(([id, settings]) => ({ id, settings }))
      : [],
    time: { released },
    cost,
    status: 'active',
    enabled: true,
    limit: {
      context: r.contextLength,
      ...(r.inputLimit != null ? { input: r.inputLimit } : {}),
      output: r.outputLimit,
    },
    ...(r.isAnthropic ? { settings: { baseURL: r.apiUrl } } : {}),
    ...(r.needsReasoningContent
      ? { compatibility: { reasoningField: 'reasoning_content' as const } }
      : {}),
    package: r.isAnthropic ? V2_PACKAGE_ANTHROPIC : V2_PACKAGE_OPENAI,
    headers: {},
  }
}
