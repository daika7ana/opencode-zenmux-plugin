import { homedir } from 'node:os'
import { join } from 'node:path'
import { readJsonc } from './jsonc.js'
import type { RoutingInfo, ZenMuxPluginOptions, ZenMuxRoutingTable } from './types.js'

const ROUTING_FILE_NAMES = [
  'zenmux-providers.jsonc',
  'zenmux-providers.json',
  'zenmux-routing.jsonc',
  'zenmux-routing.json',
]

/**
 * Load and normalize the ZenMux routing table.
 *
 * Supports both JSON and JSONC (JSON with comments).
 *
 * Search order:
 * 1. opts.routingFile (explicit path, if provided)
 * 2. Inline `routing` from zenmux-plugin.json
 * 3. {projectDirectory}/<name>
 * 4. {projectDirectory}/.opencode/<name>
 * 5. ~/.config/opencode/<name>
 *
 * Returns a Record<modelId, RoutingInfo>; empty when no file is found.
 */
export async function loadRoutingTable(
  opts: ZenMuxPluginOptions,
  projectDirectory: string,
  inlineRouting?: ZenMuxRoutingTable
): Promise<Record<string, RoutingInfo>> {
  // 1. Explicit routingFile option takes precedence
  if (opts.routingFile) {
    const parsed = await readJsonc<ZenMuxRoutingTable>(opts.routingFile)
    return parsed !== null ? normalizeRoutingTable(parsed) : {}
  }

  // 2. Inline routing from zenmux-plugin.json
  if (inlineRouting) {
    return normalizeRoutingTable(inlineRouting)
  }

  // 3. Default routing file search
  const directories = [
    projectDirectory,
    join(projectDirectory, '.opencode'),
    join(homedir(), '.config', 'opencode'),
  ]
  for (const directory of directories) {
    for (const name of ROUTING_FILE_NAMES) {
      const parsed = await readJsonc<ZenMuxRoutingTable>(join(directory, name))
      if (parsed !== null) return normalizeRoutingTable(parsed)
    }
  }

  return {}
}

function normalizeRoutingTable(table: ZenMuxRoutingTable): Record<string, RoutingInfo> {
  if (!Array.isArray(table)) {
    throw new Error(
      'Invalid routing table: expected an array of { "model", "provider"?,"sdk"? } entries. ' +
        'The object form ({ "model-id": "provider-slug" }) is no longer supported.'
    )
  }
  const result: Record<string, RoutingInfo> = {}
  for (const entry of table) {
    if (!entry.model) continue
    const info: RoutingInfo = {}
    if (entry.provider) info.provider = entry.provider
    if (entry.sdk) info.sdk = entry.sdk
    result[entry.model] = info
  }
  return result
}
