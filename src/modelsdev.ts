import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { opencodeCacheDir } from './cache.js'

/**
 * Load model ids that require `reasoning_content` passthrough from OpenCode's
 * cached models.dev catalog. Returns an empty set if the cache is missing or
 * unreadable so the static `reasoningContentModels` list remains the fallback.
 */
export async function loadReasoningContentSlugs(): Promise<Set<string>> {
  try {
    const raw = await readFile(join(opencodeCacheDir(), 'models.json'), 'utf-8')
    const data = JSON.parse(raw) as Record<
      string,
      { models?: Record<string, { interleaved?: { field?: string } }> }
    >

    const slugs = new Set<string>()
    for (const provider of Object.values(data)) {
      for (const [modelId, model] of Object.entries(provider.models ?? {})) {
        if (model.interleaved?.field === 'reasoning_content') {
          slugs.add(modelId.toLowerCase())
          slugs.add(modelId.split('/').pop()?.toLowerCase() ?? '')
        }
      }
    }

    return slugs
  } catch {
    return new Set()
  }
}
