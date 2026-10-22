import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Path to OpenCode's cache directory. OpenCode uses xdg-basedir on every
 * platform, so this is `$XDG_CACHE_HOME/opencode` (default `~/.cache/opencode`)
 * on macOS and Windows too.
 */
export function opencodeCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'opencode')
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
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, JSON.stringify({ fetchedAt: Date.now(), value }))
    await rename(tmp, file)
  } catch {
    // Best-effort: cache failures must never break the catalog fetch
  }
}
