import { readFile } from 'node:fs/promises'
import stripJsonComments from 'strip-json-comments'

/**
 * Read and JSONC-parse a file. Returns null when the file does not exist.
 * Rethrows syntax errors with the offending path attached.
 */
export async function readJsonc<T>(path: string): Promise<T | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }

  try {
    return JSON.parse(stripJsonComments(raw)) as T
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse JSON at ${path}: ${err.message}`, { cause: err })
    }
    throw err
  }
}
