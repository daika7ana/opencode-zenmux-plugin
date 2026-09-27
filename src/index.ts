import type { PluginInput, Config, Hooks, AuthHook } from '@opencode-ai/plugin'
import type {
  ModelV2,
  PluginCleanup,
  V2PluginContext,
  ZenMuxModel,
  ZenMuxPluginConfig,
  ZenMuxPluginOptions,
} from './types.js'
import { DEFAULT_OPTIONS } from './types.js'
import { loadZenMuxPluginConfig } from './config.js'
import { loadRoutingTable } from './routing.js'
import { fetchModels, readCachedModels } from './fetch.js'
import { loadReasoningContentSlugs } from './modelsdev.js'
import { mapZenMuxModel, mapZenMuxModelInfo } from './map.js'

const PROVIDER_ID = 'zenmux'

/** Shared option resolution: defaults < config file < explicit plugin options. */
async function resolveOptions(
  projectDirectory: string,
  rawOpts?: Partial<ZenMuxPluginOptions>
): Promise<{ opts: ZenMuxPluginOptions; configFile: Partial<ZenMuxPluginConfig> | null }> {
  const configFile = await loadZenMuxPluginConfig(projectDirectory)
  const opts: ZenMuxPluginOptions = { ...DEFAULT_OPTIONS, ...configFile, ...rawOpts }
  return { opts, configFile }
}

/** V1 entrypoint: OpenCode 1.18.x (`plugin` key and `.opencode/plugin(s)/`). */
async function server(input: PluginInput, rawOpts?: Partial<ZenMuxPluginOptions>): Promise<Hooks> {
  const projectDirectory = input.directory
  const { opts, configFile } = await resolveOptions(projectDirectory, rawOpts)

  return {
    async config(config: Config) {
      config.provider = config.provider ?? {}
      config.provider[PROVIDER_ID] = {
        name: 'ZenMux',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: opts.baseURL },
        env: ['ZENMUX_API_KEY'],
        models: {},
      }
    },

    auth: {
      provider: PROVIDER_ID,
      methods: [
        {
          type: 'api',
          label: 'API Key',
          prompts: [
            {
              type: 'text',
              key: 'api_key',
              message: 'Enter your ZenMux API key:',
              placeholder: 'zm-...',
            },
          ],
          async authorize(inputs) {
            const key = inputs?.api_key
            if (!key) return { type: 'failed' }
            return { type: 'success', key }
          },
        },
      ],
    } satisfies AuthHook,

    provider: {
      id: PROVIDER_ID,
      models: async () => {
        const [routing, models, reasoningContentSlugs] = await Promise.all([
          loadRoutingTable(opts, projectDirectory, configFile?.routing),
          fetchModels(opts),
          loadReasoningContentSlugs(),
        ])

        const catalog: Record<string, ModelV2> = {}
        for (const rawModel of models) {
          const mappedModel = mapZenMuxModel(
            rawModel,
            PROVIDER_ID,
            routing,
            opts,
            reasoningContentSlugs
          )
          catalog[mappedModel.id] = mappedModel
        }

        return catalog
      },
    },
  }
}

/** V2 entrypoint: OpenCode 2.x (`plugins` key). Registers from the on-disk cache
 *  so it lands inside the host's short setup() await window, then refreshes from
 *  the network in the background and replays the transform via provider.reload(). */
async function setup(ctx: V2PluginContext): Promise<PluginCleanup> {
  const projectDirectory = ctx.location?.directory ?? process.cwd()
  const rawOpts = ctx.options as Partial<ZenMuxPluginOptions> | undefined
  const { opts, configFile } = await resolveOptions(projectDirectory, rawOpts)

  const build = async (
    loadModels: () => Promise<ZenMuxModel[] | null>
  ): Promise<ReturnType<typeof mapZenMuxModelInfo>[]> => {
    const [routing, models, reasoningContentSlugs] = await Promise.all([
      loadRoutingTable(opts, projectDirectory, configFile?.routing),
      loadModels(),
      loadReasoningContentSlugs(),
    ])
    return (models ?? []).map((model) =>
      mapZenMuxModelInfo(model, PROVIDER_ID, routing, opts, reasoningContentSlugs)
    )
  }

  // Cache-only first pass: never block registration on the network round-trip.
  let models = await build(() => readCachedModels(opts))
  const provider = ctx.provider

  if (provider) {
    await provider.transform((editor) => {
      editor.add({
        info: {
          id: PROVIDER_ID,
          name: 'ZenMux',
          activation: 'enabled',
          package: '@opencode/ai/providers/openai-compatible',
          settings: { baseURL: opts.baseURL },
          integrationID: PROVIDER_ID,
        },
        models,
      })
    })
  }

  if (ctx.integration) {
    await ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: PROVIDER_ID,
        method: { type: 'env', names: ['ZENMUX_API_KEY'] },
      })
      editor.method.update({
        integrationID: PROVIDER_ID,
        method: { type: 'key', label: 'ZenMux API Key' },
      })
    })
  }

  if (!provider) return () => {}

  // The catalog network fetch is the slow part, so it runs after registration;
  // later refreshes ride the disk cache TTL.
  const refresh = async () => {
    models = await build(() => fetchModels(opts))
    await provider.reload()
  }
  const kick = () => {
    void refresh().catch(() => {})
  }

  kick()
  const intervalMs = opts.catalogCacheTTL * 60_000
  if (intervalMs <= 0) return () => {}

  const timer = setInterval(kick, intervalMs)
  return () => clearInterval(timer)
}

export default {
  id: PROVIDER_ID,
  setup,
  server,
}
