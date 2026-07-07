import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import stripJsonComments from 'strip-json-comments'
import type { ZenMuxPluginConfig } from './types.js'

const CONFIG_FILE_NAMES = ['zenmux-plugin.jsonc', 'zenmux-plugin.json']

/**
 * Load the unified ZenMux plugin config file.
 *
 * Search order:
 * 1. {projectDirectory}/zenmux-plugin.jsonc
 * 2. {projectDirectory}/zenmux-plugin.json
 * 3. {projectDirectory}/.opencode/zenmux-plugin.jsonc
 * 4. {projectDirectory}/.opencode/zenmux-plugin.json
 * 5. ~/.config/opencode/zenmux-plugin.jsonc
 * 6. ~/.config/opencode/zenmux-plugin.json
 *
 * Returns the parsed config, or null if no file is found.
 */
export async function loadZenMuxPluginConfig(
  projectDirectory: string
): Promise<Partial<ZenMuxPluginConfig> | null> {
  const paths = [
    ...pathsInDirectory(projectDirectory),
    ...pathsInDirectory(join(projectDirectory, '.opencode')),
    ...pathsInDirectory(join(homedir(), '.config', 'opencode')),
  ]

  for (const path of paths) {
    const parsed = await tryReadConfigFile(path)
    if (parsed !== null) return parsed
  }

  return null
}

function pathsInDirectory(directory: string): string[] {
  return CONFIG_FILE_NAMES.map((name) => join(directory, name))
}

async function tryReadConfigFile(path: string): Promise<Partial<ZenMuxPluginConfig> | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(stripJsonComments(raw)) as Partial<ZenMuxPluginConfig>
  } catch (err: unknown) {
    // File not found → skip
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    // JSON parse error → rethrow with clear message
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse config file at ${path}: ${err.message}`, { cause: err })
    }
    throw err
  }
}
