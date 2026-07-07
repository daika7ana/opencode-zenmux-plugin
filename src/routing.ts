import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import stripJsonComments from 'strip-json-comments'
import type { ZenMuxPluginOptions, ZenMuxRoutingTable } from './types.js'

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
 * Recognized file names: zenmux-providers.json(c) and zenmux-routing.json(c).
 *
 * Search order:
 * 1. opts.routingFile (explicit path, if provided)
 * 2. {projectDirectory}/zenmux-providers.jsonc
 * 3. {projectDirectory}/zenmux-providers.json
 * 4. {projectDirectory}/zenmux-routing.jsonc
 * 5. {projectDirectory}/zenmux-routing.json
 * 6. {projectDirectory}/.opencode/zenmux-providers.jsonc
 * 7. {projectDirectory}/.opencode/zenmux-providers.json
 * 8. {projectDirectory}/.opencode/zenmux-routing.jsonc
 * 9. {projectDirectory}/.opencode/zenmux-routing.json
 * 10. ~/.config/opencode/zenmux-providers.jsonc
 * 11. ~/.config/opencode/zenmux-providers.json
 * 12. ~/.config/opencode/zenmux-routing.jsonc
 * 13. ~/.config/opencode/zenmux-routing.json
 *
 * Returns a Record<modelId, providerSlug>.
 * If no file is found, returns an empty record.
 */
export async function loadRoutingTable(
  opts: ZenMuxPluginOptions,
  projectDirectory: string,
  inlineRouting?: ZenMuxRoutingTable
): Promise<Record<string, string>> {
  // 1. Explicit routingFile option takes precedence
  if (opts.routingFile) {
    const parsed = await tryReadRoutingFile(opts.routingFile)
    if (parsed !== null) return normalizeRoutingTable(parsed)
    return {}
  }

  // 2. Inline routing from zenmux-plugin.json
  if (inlineRouting) {
    return normalizeRoutingTable(inlineRouting)
  }

  // 3. Default routing file search
  const paths = [
    ...pathsInDirectory(projectDirectory),
    ...pathsInDirectory(join(projectDirectory, '.opencode')),
    ...pathsInDirectory(join(homedir(), '.config', 'opencode')),
  ]

  for (const path of paths) {
    const parsed = await tryReadRoutingFile(path)
    if (parsed !== null) return normalizeRoutingTable(parsed)
  }

  return {}
}

function pathsInDirectory(directory: string): string[] {
  return ROUTING_FILE_NAMES.map((name) => join(directory, name))
}

async function tryReadRoutingFile(path: string): Promise<ZenMuxRoutingTable | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(stripJsonComments(raw)) as ZenMuxRoutingTable
  } catch (err: unknown) {
    // File not found → skip
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    // JSON parse error → rethrow with clear message
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse routing file at ${path}: ${err.message}`, { cause: err })
    }
    throw err
  }
}

function normalizeRoutingTable(table: ZenMuxRoutingTable): Record<string, string> {
  if (Array.isArray(table)) {
    const result: Record<string, string> = {}
    for (const entry of table) {
      if (entry.model && entry.provider) {
        result[entry.model] = entry.provider
      }
    }
    return result
  }
  return table
}
