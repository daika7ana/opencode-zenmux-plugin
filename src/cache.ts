import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Best-effort cross-platform path to OpenCode's cache directory.
 *
 * OpenCode stores its caches at `<Global.Path.cache>`. The standard platform
 * mappings are:
 *   - Linux:   $XDG_CACHE_HOME/opencode  (~/.cache/opencode)
 *   - macOS:   ~/Library/Caches/opencode
 *   - Windows: %LOCALAPPDATA%/opencode/Cache
 */
export function opencodeCacheDir(): string {
  const home = homedir()

  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Caches', 'opencode')
    case 'win32':
      return join(process.env.LOCALAPPDATA || home, 'opencode', 'Cache')
    default:
      return join(process.env.XDG_CACHE_HOME || join(home, '.cache'), 'opencode')
  }
}

interface CacheFile<T> {
  fetchedAt: number
  value: T
}

/**
 * Read a cached JSON value if it exists and is newer than `ttlMs`.
 * Returns null on any error (missing file, stale, corrupt, unreadable).
 */
export async function readCache<T>(name: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await readFile(join(opencodeCacheDir(), name), 'utf-8')
    const data = JSON.parse(raw) as CacheFile<T>
    if (typeof data.fetchedAt !== 'number' || Date.now() - data.fetchedAt > ttlMs) return null
    return data.value
  } catch {
    return null
  }
}

/**
 * Write a JSON value to the cache. Best-effort: a failed write must never
 * break the caller, so errors are swallowed. Uses a temp file + rename to
 * avoid leaving a corrupt cache behind a crash.
 */
export async function writeCache(name: string, value: unknown): Promise<void> {
  try {
    const dir = opencodeCacheDir()
    const file = join(dir, name)
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ fetchedAt: Date.now(), value }))
    await rename(tmp, file)
  } catch {
    // Best-effort: cache failures must never break the catalog fetch
  }
}
