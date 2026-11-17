import { readFileSync } from 'node:fs'
import stripJsonComments from 'strip-json-comments'

/**
 * Read and JSONC-parse a file. Returns null when the file does not exist.
 * Rethrows syntax errors with the offending path attached.
 *
 * Sync: V2 setup must register before its first `await` (see `setup()`).
 */
/** Empty or whitespace-only files count as absent (e.g. a `touch`ed placeholder). */
export function readJsonc<T>(path: string): T | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  if (raw.trim() === '') return null

  try {
    return JSON.parse(stripJsonComments(raw)) as T
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse JSON at ${path}: ${err.message}`, { cause: err })
    }
    throw err
  }
}
