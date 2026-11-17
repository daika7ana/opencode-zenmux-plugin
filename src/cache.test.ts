import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { opencodeCacheDir, readCacheSync, writeCache } from './cache.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zenmux-cache-'))
  process.env.XDG_CACHE_HOME = dir
})

afterEach(async () => {
  delete process.env.XDG_CACHE_HOME
  await rm(dir, { recursive: true, force: true })
})

describe('cache', () => {
  it('derives the cache directory from XDG_CACHE_HOME', () => {
    assert.equal(opencodeCacheDir(), join(dir, 'opencode'))
  })

  it('creates the cache directory and round-trips a value', async () => {
    await writeCache('value.json', { a: 1 })
    assert.deepEqual(readCacheSync('value.json', 60_000), { a: 1 })
  })

  it('returns null for stale and corrupt entries', async () => {
    await writeCache('stale.json', 1)
    assert.equal(readCacheSync('stale.json', -1), null)

    await writeFile(join(opencodeCacheDir(), 'bad.json'), 'not json')
    assert.equal(readCacheSync('bad.json', 60_000), null)
  })

  it('returns null when the entry is missing', async () => {
    assert.equal(readCacheSync('missing.json', 60_000), null)
  })
})
