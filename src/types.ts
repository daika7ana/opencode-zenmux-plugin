export interface ZenMuxPricingCondition {
  unit: string
  gte?: number
  lt?: number
}

export interface ZenMuxPricing {
  value: number
  unit: string
  currency: string
  conditions?: {
    prompt_tokens?: ZenMuxPricingCondition
    completion_tokens?: ZenMuxPricingCondition
    model?: string
  }
}

export interface ZenMuxPricings {
  prompt: ZenMuxPricing[]
  completion: ZenMuxPricing[]
  input_cache_read: ZenMuxPricing[]
  input_cache_write?: ZenMuxPricing[]
  input_cache_write_1_h?: ZenMuxPricing[]
  web_search?: ZenMuxPricing[]
}

export interface ZenMuxFrontendModel {
  slug: string
  max_completion_tokens: number | null
  context_length?: number
  description?: string
  suitable_api?: string
  supported_parameters?: string
}

export interface ZenMuxModel {
  id: string
  object?: string
  display_name?: string
  created?: number
  owned_by?: string
  input_modalities?: string[]
  output_modalities?: string[]
  capabilities?: { reasoning?: boolean }
  context_length?: number
  pricings?: ZenMuxPricings
  publish_time?: string
  /** Enriched data from the ZenMux frontend API, merged by slug → id. */
  _frontend?: ZenMuxFrontendModel
}

export interface ZenMuxModelsResponse {
  data: ZenMuxModel[]
}

export interface ZenMuxPluginOptions {
  /** Base URL for actual ZenMux API calls. Default: https://zenmux.ai/api/v1 */
  baseURL: string
  /** Base URL for Anthropic Messages API calls. Default: https://zenmux.ai/api/anthropic/v1 */
  anthropicBaseURL: string
  /** URL to fetch the public model catalog. Default: https://zenmux.ai/api/v1/models */
  modelsURL: string
  /** URL to fetch the frontend model catalog (for max_completion_tokens enrichment). Default: https://zenmux.ai/api/frontend/model/listByFilter */
  frontendURL: string
  /** Explicit path to zenmux-providers.json; overrides default search order. Default: null */
  routingFile: string | null
  /** Default limit.output tokens, used as fallback when max_completion_tokens is unavailable. Default: 16384 */
  defaultOutputTokens: number
  /** Exclude models whose output modality is not text. Default: true */
  excludeNonChat: boolean
  /** Include the provider suffix in the model id itself. Default: false */
  routedModelIds: boolean
}

export const DEFAULT_OPTIONS: ZenMuxPluginOptions = {
  baseURL: 'https://zenmux.ai/api/v1',
  anthropicBaseURL: 'https://zenmux.ai/api/anthropic/v1',
  modelsURL: 'https://zenmux.ai/api/v1/models',
  frontendURL: 'https://zenmux.ai/api/frontend/model/listByFilter',
  routingFile: null,
  defaultOutputTokens: 16384,
  excludeNonChat: true,
  routedModelIds: false,
}

export interface ZenMuxPluginConfig extends ZenMuxPluginOptions {
  /** Inline routing table (same format as zenmux-providers.json). */
  routing?: ZenMuxRoutingTable
}

export type ModelSdk = 'openai' | 'anthropic'

export interface RoutingEntry {
  model: string
  provider?: string
  sdk?: ModelSdk
}

export interface RoutingInfo {
  provider?: string
  sdk?: ModelSdk
}

export type ZenMuxRoutingTable = RoutingEntry[]

/**
 * OpenCode runtime ModelV2 shape.
 * Matches @opencode-ai/sdk/v2 ModelV2 interface.
 */
export interface ModelV2 {
  id: string
  providerID: string
  api: { id: string; url: string; npm: string }
  name: string
  family?: string
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
    output: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
    interleaved: boolean | { field: 'reasoning_content' | 'reasoning_details' }
  }
  cost: {
    input: number
    output: number
    cache: { read: number; write: number }
    experimentalOver200K?: { input: number; output: number; cache: { read: number; write: number } }
  }
  limit: { context: number; input?: number; output: number }
  status: 'alpha' | 'beta' | 'deprecated' | 'active'
  options: Record<string, unknown>
  headers: Record<string, string>
  release_date: string
  variants?: Record<string, Record<string, unknown>>
}
