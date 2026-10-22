import { homedir } from 'node:os'
import { join } from 'node:path'
import { readJsonc } from './jsonc.js'
import type { ZenMuxPluginConfig } from './types.js'

const CONFIG_FILE_NAMES = ['zenmux-plugin.jsonc', 'zenmux-plugin.json']

/** Config/routing search roots, most specific first. */
export function searchDirectories(projectDirectory: string): string[] {
  return [
    projectDirectory,
    join(projectDirectory, '.opencode'),
    join(homedir(), '.config', 'opencode'),
  ]
}

/**
 * Load the unified ZenMux plugin config file.
 *
 * Search order (first match wins):
 * 1. {projectDirectory}/zenmux-plugin.json(c)
 * 2. {projectDirectory}/.opencode/zenmux-plugin.json(c)
 * 3. ~/.config/opencode/zenmux-plugin.json(c)
 *
 * Returns the parsed config, or null if no file is found.
 */
export async function loadZenMuxPluginConfig(
  projectDirectory: string
): Promise<Partial<ZenMuxPluginConfig> | null> {
  for (const directory of searchDirectories(projectDirectory)) {
    for (const name of CONFIG_FILE_NAMES) {
      const parsed = await readJsonc<Partial<ZenMuxPluginConfig>>(join(directory, name))
      if (parsed !== null) return parsed
    }
  }

  return null
}
