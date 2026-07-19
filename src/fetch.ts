import type {
  ZenMuxFrontendModel,
  ZenMuxModel,
  ZenMuxModelsResponse,
  ZenMuxPluginOptions,
} from './types.js'

/**
 * Fetch the ZenMux model catalog, enriched with data from the frontend API
 * (max_completion_tokens, suitable_api) cross-referenced by slug ↔ id.
 *
 * When opts.excludeNonChat is true, models are filtered using suitable_api
 * (preferring "chat.completions" presence) with a fallback to
 * output_modalities.includes("text") when frontend data is unavailable.
 */
export async function fetchModels(opts: ZenMuxPluginOptions): Promise<ZenMuxModel[]> {
  const [modelsResponse, frontendResponse] = await Promise.allSettled([
    globalThis.fetch(opts.modelsURL),
    globalThis.fetch(opts.frontendURL),
  ])

  if (modelsResponse.status === 'rejected') {
    throw new Error(`Failed to fetch models from ${opts.modelsURL}: ${modelsResponse.reason}`)
  }
  if (!modelsResponse.value.ok) {
    throw new Error(
      `Failed to fetch models from ${opts.modelsURL}: ${modelsResponse.value.status} ${modelsResponse.value.statusText}`
    )
  }

  const json = (await modelsResponse.value.json()) as ZenMuxModelsResponse

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error(`Unexpected response shape from ${opts.modelsURL}: missing "data" array`)
  }

  const models = json.data.filter(hasCriticalFields)

  // Enrich with frontend data (best-effort — fails gracefully)
  type FrontendData = Pick<
    ZenMuxFrontendModel,
    'max_completion_tokens' | 'description' | 'suitable_api' | 'supported_parameters'
  >
  const frontendBySlug = new Map<string, FrontendData>()

  if (frontendResponse.status === 'fulfilled' && frontendResponse.value.ok) {
    try {
      const frontendJson = (await frontendResponse.value.json()) as ZenMuxFrontendModel[]
      if (Array.isArray(frontendJson)) {
        for (const fe of frontendJson) {
          if (typeof fe.slug === 'string') {
            frontendBySlug.set(fe.slug, {
              max_completion_tokens: fe.max_completion_tokens,
              description: fe.description,
              suitable_api: fe.suitable_api,
              supported_parameters: fe.supported_parameters,
            })
          }
        }
      }
    } catch {
      // Frontend API parse failure → continue without enrichment
    }
  }

  const enriched =
    frontendBySlug.size > 0 ? applyFrontendEnrichment(models, frontendBySlug) : models

  if (opts.excludeNonChat) {
    return enriched.filter(isChatModel)
  }

  return enriched
}

function applyFrontendEnrichment(
  models: ZenMuxModel[],
  frontendBySlug: Map<
    string,
    {
      max_completion_tokens: number | null
      description?: string
      suitable_api?: string
      supported_parameters?: string
    }
  >
): ZenMuxModel[] {
  return models.map((m) => {
    const fe = frontendBySlug.get(m.id)
    if (!fe) return m
    return {
      ...m,
      _frontend: {
        slug: m.id,
        max_completion_tokens: fe.max_completion_tokens,
        description: fe.description,
        suitable_api: fe.suitable_api,
        supported_parameters: fe.supported_parameters,
      },
    }
  })
}

/**
 * Chat model classifier. Prefers suitable_api ("chat.completions" presence)
 * when frontend data is available, falling back to output_modalities check.
 */
function isChatModel(m: ZenMuxModel): boolean {
  if (m._frontend?.suitable_api) {
    return m._frontend.suitable_api.includes('chat.completions')
  }
  return m.output_modalities?.includes('text') ?? false
}

function hasCriticalFields(m: ZenMuxModel): boolean {
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    typeof m.display_name === 'string' &&
    m.display_name.length > 0 &&
    Array.isArray(m.output_modalities)
  )
}
