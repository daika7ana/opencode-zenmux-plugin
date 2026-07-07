import type { ZenMuxModel, ZenMuxModelsResponse, ZenMuxPluginOptions } from './types.js'

/**
 * Fetch the ZenMux model catalog.
 *
 * If opts.excludeNonChat is true, filters out models whose output_modalities
 * does not include "text".
 */
export async function fetchModels(opts: ZenMuxPluginOptions): Promise<ZenMuxModel[]> {
  const response = await globalThis.fetch(opts.modelsURL)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch models from ${opts.modelsURL}: ${response.status} ${response.statusText}`
    )
  }

  const json = (await response.json()) as ZenMuxModelsResponse

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error(`Unexpected response shape from ${opts.modelsURL}: missing "data" array`)
  }

  const models = json.data.filter(hasCriticalFields)

  if (opts.excludeNonChat) {
    return models.filter((m) => m.output_modalities?.includes('text'))
  }

  return models
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
