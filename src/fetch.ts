import { createHash } from 'node:crypto'
import type {
  ZenMuxFrontendModel,
  ZenMuxModel,
  ZenMuxModelsResponse,
  ZenMuxPluginOptions,
} from './types.js'
import { readCache, writeCache } from './cache.js'

/**
 * Fetch the ZenMux model catalog, enriched with data from the frontend API
 * (max_completion_tokens, suitable_api) cross-referenced by slug ↔ id.
 *
 * Results are cached on disk (keyed by modelsURL + frontendURL) for
 * `opts.catalogCacheTTL` minutes so startups skip the network calls.
 *
 * When opts.excludeNonChat is true, models are filtered using suitable_api
 * (preferring "chat.completions" presence) with a fallback to
 * output_modalities.includes("text") when frontend data is unavailable.
 */
export async function fetchModels(opts: ZenMuxPluginOptions): Promise<ZenMuxModel[]> {
  const ttlMs = opts.catalogCacheTTL * 60_000
  const cacheName = cacheFileName(opts)
  const forceRefresh = isRefreshInvocation()

  if (!forceRefresh && ttlMs > 0) {
    const cached = await readCache<ZenMuxModel[]>(cacheName, ttlMs)
    if (cached) {
      return opts.excludeNonChat ? cached.filter(isChatModel) : cached
    }
  }

  const enriched = await fetchAndEnrich(opts)

  if (ttlMs > 0) {
    await writeCache(cacheName, enriched)
  }

  return opts.excludeNonChat ? enriched.filter(isChatModel) : enriched
}

/**
 * Read the cached catalog without touching the network, ignoring TTL freshness.
 *
 * The V2 `setup()` hook must finish inside the host's short await window, so it
 * cannot afford the network round-trip. A stale catalog is better than no
 * catalog: the caller refreshes in the background and replays its transform.
 * Returns null when nothing is cached yet.
 */
export async function readCachedModels(opts: ZenMuxPluginOptions): Promise<ZenMuxModel[] | null> {
  const cached = await readCache<ZenMuxModel[]>(cacheFileName(opts), Number.POSITIVE_INFINITY)
  if (!cached) return null
  return opts.excludeNonChat ? cached.filter(isChatModel) : cached
}

/**
 * True when this process is an `opencode models --refresh` invocation, which
 * bypasses the disk cache and refetches (then rewrites the cache). Plugins run
 * in-process, so OpenCode's CLI args are visible here.
 */
function isRefreshInvocation(): boolean {
  const args = process.argv.slice(2)
  return args.includes('models') && (args.includes('--refresh') || args.includes('-r'))
}

function cacheFileName(opts: ZenMuxPluginOptions): string {
  const hash = createHash('sha1')
    .update(`${opts.modelsURL}\n${opts.frontendURL}`)
    .digest('hex')
    .slice(0, 16)
  return `zenmux-models-${hash}.json`
}

async function fetchAndEnrich(opts: ZenMuxPluginOptions): Promise<ZenMuxModel[]> {
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
      const frontendJson = (await frontendResponse.value.json()) as
        ZenMuxFrontendModel[] | { success?: boolean; data?: ZenMuxFrontendModel[] }
      // The API returns { success, data: [...] }; accept a bare array too for robustness.
      const frontendModels = Array.isArray(frontendJson)
        ? frontendJson
        : Array.isArray(frontendJson.data)
          ? frontendJson.data
          : null
      if (frontendModels) {
        for (const fe of frontendModels) {
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
