export interface ZenMuxPricingCondition {
  gte?: number
}

export interface ZenMuxPricing {
  value: number
  conditions?: {
    prompt_tokens?: ZenMuxPricingCondition
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
  /**
   * Minutes to cache the fetched ZenMux catalog (models + frontend enrichment)
   * on disk so startups skip the network calls. 0 disables the cache.
   * Default: 60
   */
  catalogCacheTTL: number
  /**
   * Model ids (substring match) whose responses use `reasoning_content` and must
   * pass it back to the API on subsequent turns. Enables OpenCode's
   * `interleaved: { field: 'reasoning_content' }` capability for these models.
   * The plugin also unions in any models that OpenCode's cached models.dev catalog
   * marks as needing `reasoning_content` passthrough.
   * Default: ['deepseek', 'glm', 'minimax', 'kimi', 'mimo']
   */
  reasoningContentModels: string[]
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
  catalogCacheTTL: 60,
  reasoningContentModels: ['deepseek', 'glm', 'minimax', 'kimi', 'mimo'],
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

/** Documented V2 model shape (@opencode/schema Model.Info), for the provider/model plugin API. */
export interface ModelInfoV2 {
  id: string
  modelID: string
  providerID: string
  family?: string
  name: string
  capabilities: { tools: boolean; input: string[]; output: string[] }
  variants: Array<{ id: string; settings?: Record<string, unknown> }>
  time: { released: number }
  cost: Array<{
    tier?: { type: 'context'; size: number }
    input: number
    output: number
    cache: { read: number; write: number }
  }>
  status: 'alpha' | 'beta' | 'deprecated' | 'active'
  enabled: boolean
  limit: { context: number; input?: number; output: number }
  settings?: Record<string, unknown>
  headers?: Record<string, string>
  compatibility?: {
    reasoningField?: 'reasoning' | 'reasoning_content' | 'reasoning_text' | string
  }
  package?: string
}

/** Documented V2 provider shape (@opencode/schema Provider.Info). */
export interface ProviderInfoV2 {
  id: string
  integrationID?: string
  name: string
  activation: 'auto' | 'enabled' | 'disabled'
  package: string
  settings?: Record<string, unknown>
}

/** Cleanup function optionally returned from a V2 setup() hook. */
export type PluginCleanup = () => Promise<void> | void

/** A registration returned by a V2 domain transform. */
export interface V2Registration {
  dispose(): Promise<void>
}

/** Minimal structural mirror of the 2.x provider editor (we only contribute). */
export interface V2ProviderEditor {
  add(input: { info: ProviderInfoV2; models: ModelInfoV2[] }): void
}

/** Minimal structural mirror of the 2.x integration editor (we only add methods). */
export interface V2IntegrationEditor {
  method: {
    update(input: {
      integrationID: string
      method: { type: 'key'; label?: string } | { type: 'env'; names: string[] }
    }): void
  }
}

/** Minimal structural mirror of the 2.x plugin context. All domains optional so a
 *  runtime that lacks them degrades to a no-op instead of throwing. */
export interface V2PluginContext {
  options?: Record<string, unknown>
  location?: { directory?: string }
  provider?: {
    transform(callback: (editor: V2ProviderEditor) => void): Promise<V2Registration>
    reload(): Promise<void>
  }
  integration?: {
    transform(callback: (editor: V2IntegrationEditor) => void): Promise<V2Registration>
  }
}
