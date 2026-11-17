import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { loadZenMuxPluginConfig, searchDirectories } from './config.js'

let project: string
let globalConfig: string

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'zenmux-project-'))
  globalConfig = await mkdtemp(join(tmpdir(), 'zenmux-global-'))
  process.env.XDG_CONFIG_HOME = globalConfig
  await mkdir(join(project, '.opencode'))
  await mkdir(join(globalConfig, 'opencode'))
})

afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME
  await rm(project, { recursive: true, force: true })
  await rm(globalConfig, { recursive: true, force: true })
})

describe('loadZenMuxPluginConfig', () => {
  it('uses XDG_CONFIG_HOME for the global directory', () => {
    assert.deepEqual(searchDirectories('/project'), [
      '/project',
      '/project/.opencode',
      join(globalConfig, 'opencode'),
    ])
  })

  it('prefers project over .opencode over global', async () => {
    await writeFile(join(globalConfig, 'opencode', 'zenmux-plugin.json'), '{"baseURL":"global"}')
    await writeFile(join(project, '.opencode', 'zenmux-plugin.json'), '{"baseURL":"nested"}')
    await writeFile(join(project, 'zenmux-plugin.json'), '{"baseURL":"project"}')

    assert.equal(loadZenMuxPluginConfig(project)?.baseURL, 'project')
  })

  it('falls back to the global directory', async () => {
    await writeFile(join(globalConfig, 'opencode', 'zenmux-plugin.jsonc'), '{"baseURL":"global"}')
    assert.equal(loadZenMuxPluginConfig(project)?.baseURL, 'global')
  })

  it('treats an empty file as absent', async () => {
    await writeFile(join(project, 'zenmux-plugin.json'), '  \n')
    await writeFile(join(project, '.opencode', 'zenmux-plugin.json'), '{"baseURL":"nested"}')

    assert.equal(loadZenMuxPluginConfig(project)?.baseURL, 'nested')
  })

  it('returns null when no file exists', () => {
    assert.equal(loadZenMuxPluginConfig(project), null)
  })
})
