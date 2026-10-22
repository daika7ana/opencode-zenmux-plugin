import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { opencodeCacheDir } from './cache.js'
import { loadReasoningContentSlugs } from './modelsdev.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zenmux-modelsdev-'))
  process.env.XDG_CACHE_HOME = dir
})

afterEach(async () => {
  delete process.env.XDG_CACHE_HOME
  await rm(dir, { recursive: true, force: true })
})

describe('loadReasoningContentSlugs', () => {
  it('reads interleaved reasoning_content models from the cached catalog', async () => {
    const cacheDir = opencodeCacheDir()
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      join(cacheDir, 'models.json'),
      JSON.stringify({
        provider: {
          models: {
            'vendor/deepseek-x': { interleaved: { field: 'reasoning_content' } },
            'vendor/other': { interleaved: { field: 'reasoning_details' } },
          },
        },
      })
    )

    const slugs = await loadReasoningContentSlugs()
    assert.ok(slugs.has('vendor/deepseek-x'))
    assert.ok(slugs.has('deepseek-x'))
    assert.ok(!slugs.has('vendor/other'))
  })

  it('returns an empty set when the catalog is missing', async () => {
    assert.equal((await loadReasoningContentSlugs()).size, 0)
  })
})
