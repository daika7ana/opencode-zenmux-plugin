import type {
  ModelInfoV2,
  ModelV2,
  RoutingInfo,
  ZenMuxModel,
  ZenMuxPluginOptions,
  ZenMuxPricing,
} from './types.js'

type PriceEntry = { size: number; value: number }

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
  tools: boolean
  input: ModalityFlags
  output: ModalityFlags
  cost: ModelV2['cost']
  contextLength: number
  outputLimit: number
  inputLimit?: number
  variants: Record<string, Record<string, unknown>>
}

// ZenMux prices are already USD per 1M tokens, which matches the unit
// OpenCode expects. Tier thresholds arrive as `{ unit: 'kTokens', gte|gt }`
// and are converted to tokens; an entry without a condition is the base price.
//
// The models API flattens time-of-day, cache-type and output-length pricing into
// duplicate thresholds. OpenCode has no dimension for those, so `pricingTieBreak`
// decides: `lowest` (the models.dev catalog) or `highest` (list/peak price).
type TieBreak = ZenMuxPluginOptions['pricingTieBreak']

function priceEntries(arr: ZenMuxPricing[] | undefined): PriceEntry[] {
  return (arr ?? []).map((p) => {
    const condition = p.conditions?.prompt_tokens
    const raw = condition?.gte ?? condition?.gt
    const threshold = Number(raw)
    const size =
      raw === undefined || !Number.isFinite(threshold)
        ? 0
        : condition?.unit === 'kTokens'
          ? threshold * 1000
          : threshold
    return { size, value: p.value }
  })
}

function priceAtThreshold(
  entries: PriceEntry[],
  size: number,
  tieBreak: TieBreak
): number | undefined {
  let best: PriceEntry | undefined
  for (const entry of entries) {
    if (entry.size > size) continue
    if (
      !best ||
      entry.size > best.size ||
      (entry.size === best.size &&
        (tieBreak === 'highest' ? entry.value > best.value : entry.value < best.value))
    )
      best = entry
  }
  return best?.value
}

function basePrice(entries: PriceEntry[], tieBreak: TieBreak): number {
  if (entries.length === 0) return 0
  const minSize = Math.min(...entries.map((e) => e.size))
  return priceAtThreshold(entries, minSize, tieBreak) ?? 0
}

function priceAt(entries: PriceEntry[], size: number, tieBreak: TieBreak): number {
  return priceAtThreshold(entries, size, tieBreak) ?? basePrice(entries, tieBreak)
}

/**
 * Compute the shared intermediate for a single ZenMux model record.
 *
 * @param model - The raw ZenMux model from the API.
 * @param routing - The loaded routing table (modelId → RoutingInfo).
 * @param opts - Plugin options.
 * @param reasoningContentSlugs - Model ids (lowercased) that models.dev marks as
 *   requiring `reasoning_content` passthrough; unioned with
 *   `opts.reasoningContentModels`. Optional.
 */
function resolveZenMuxModel(
  model: ZenMuxModel,
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

  const tieBreak: TieBreak = opts.pricingTieBreak === 'highest' ? 'highest' : 'lowest'
  const promptPricing = priceEntries(model.pricings?.prompt)
  const completionPricing = priceEntries(model.pricings?.completion)
  const cacheReadPricing = priceEntries(model.pricings?.input_cache_read)
  const cacheWritePricing = priceEntries(
    model.pricings?.input_cache_write && model.pricings.input_cache_write.length > 0
      ? model.pricings.input_cache_write
      : model.pricings?.input_cache_write_1_h
  )

  const cost: ModelV2['cost'] = {
    input: basePrice(promptPricing, tieBreak),
    output: basePrice(completionPricing, tieBreak),
    cache: {
      read: basePrice(cacheReadPricing, tieBreak),
      write: basePrice(cacheWritePricing, tieBreak),
    },
  }

  // One tier per threshold, with every price field resolved at that size.
  const thresholds = [
    ...new Set(
      [promptPricing, completionPricing, cacheReadPricing, cacheWritePricing]
        .flat()
        .map((e) => e.size)
        .filter((size) => size > 0)
    ),
  ].sort((a, b) => a - b)
  if (thresholds.length > 0) {
    cost.tiers = thresholds.map((size) => ({
      input: priceAt(promptPricing, size, tieBreak),
      output: priceAt(completionPricing, size, tieBreak),
      cache: {
        read: priceAt(cacheReadPricing, size, tieBreak),
        write: priceAt(cacheWritePricing, size, tieBreak),
      },
      tier: { type: 'context' as const, size },
    }))
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

  // Trust a declared parameter list; models with an empty one fall back to text output.
  const supportedParameters = model._frontend?.supported_parameters
  const tools = supportedParameters ? supportedParameters.includes('tools') : output.text

  return {
    apiId,
    modelId,
    isAnthropic,
    sdkPackage,
    apiUrl,
    needsReasoningContent,
    reasoning,
    tools,
    input,
    output,
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
  const r = resolveZenMuxModel(model, routing, opts, reasoningContentSlugs)

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
      toolcall: r.tools,
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
  const r = resolveZenMuxModel(model, routing, opts, reasoningContentSlugs)

  const cost: ModelInfoV2['cost'] = [
    {
      input: r.cost.input,
      output: r.cost.output,
      cache: { read: r.cost.cache.read, write: r.cost.cache.write },
    },
    ...(r.cost.tiers ?? []),
  ]

  const parsed = model.publish_time ? Date.parse(model.publish_time) : NaN
  const released = Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000)

  return {
    id: r.modelId,
    modelID: r.apiId,
    providerID,
    family: model.owned_by,
    name: model.display_name ?? model.id,
    capabilities: {
      tools: r.tools,
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
