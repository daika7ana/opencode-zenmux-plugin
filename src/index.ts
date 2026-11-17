import type { PluginInput, Config, Hooks, AuthHook } from '@opencode-ai/plugin'
import type { Plugin, Provider } from '@opencode/plugin'
import type {
  ModelV2,
  RoutingInfo,
  ZenMuxModel,
  ZenMuxPluginOptions,
  ZenMuxRoutingTable,
} from './types.js'
import { branded, DEFAULT_OPTIONS } from './types.js'
import { loadZenMuxPluginConfig } from './config.js'
import { loadRoutingTable } from './routing.js'
import { fetchModels, readCachedModels } from './fetch.js'
import { loadReasoningContentSlugs } from './modelsdev.js'
import { mapZenMuxModel, mapZenMuxModelInfo, V2_PACKAGE_OPENAI } from './map.js'

const PROVIDER_ID = 'zenmux'

/** Shared option resolution: defaults < config file < explicit plugin options. */
function resolveOptions(
  projectDirectory: string,
  rawOpts?: Partial<ZenMuxPluginOptions>
): { opts: ZenMuxPluginOptions; inlineRouting?: ZenMuxRoutingTable } {
  let configFile: ReturnType<typeof loadZenMuxPluginConfig> = null
  try {
    configFile = loadZenMuxPluginConfig(projectDirectory)
  } catch (err) {
    // A broken config file must not take the whole provider down.
    console.warn('[zenmux] ignoring config file:', err)
  }
  const opts: ZenMuxPluginOptions = { ...DEFAULT_OPTIONS, ...configFile, ...rawOpts }
  return { opts, inlineRouting: configFile?.routing }
}

/** Routing is best-effort too: a broken table must not take the provider down. */
function resolveRouting(
  opts: ZenMuxPluginOptions,
  projectDirectory: string,
  inlineRouting?: ZenMuxRoutingTable
): Record<string, RoutingInfo> {
  try {
    return loadRoutingTable(opts, projectDirectory, inlineRouting)
  } catch (err) {
    console.warn('[zenmux] ignoring routing table:', err)
    return {}
  }
}

/** V1 entrypoint: OpenCode 1.18.x (`plugin` key and `.opencode/plugin(s)/`). */
async function server(input: PluginInput, rawOpts?: Partial<ZenMuxPluginOptions>): Promise<Hooks> {
  const projectDirectory = input.directory
  const { opts, inlineRouting } = resolveOptions(projectDirectory, rawOpts)

  return {
    async config(config: Config) {
      config.provider = config.provider ?? {}
      const existing = config.provider[PROVIDER_ID]
      config.provider[PROVIDER_ID] = {
        ...existing,
        name: 'ZenMux',
        npm: '@ai-sdk/openai-compatible',
        options: { ...existing?.options, baseURL: opts.baseURL },
        env: ['ZENMUX_API_KEY'],
        models: {},
      }
    },

    // No prompts/authorize: OpenCode's built-in API-key flow prompts and saves
    // the key. Supplying our own prompts makes the CLI ask twice.
    auth: {
      provider: PROVIDER_ID,
      methods: [{ type: 'api', label: 'API Key' }],
    } satisfies AuthHook,

    provider: {
      id: PROVIDER_ID,
      models: async () => {
        const routing = resolveRouting(opts, projectDirectory, inlineRouting)
        const reasoningContentSlugs = loadReasoningContentSlugs()
        const models = await fetchModels(opts)

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
 *  the network in the background and replays the transform via provider.reload().
 *
 *  Registration must precede any `await`: a Location's first catalog read returns
 *  only what is registered at that moment. Hence the sync loaders below. */
async function setup(ctx: Plugin.Context): Promise<Plugin.Cleanup> {
  const projectDirectory = ctx.location?.directory ?? process.cwd()
  const rawOpts = ctx.options as Partial<ZenMuxPluginOptions> | undefined
  const { opts, inlineRouting } = resolveOptions(projectDirectory, rawOpts)

  const routing = resolveRouting(opts, projectDirectory, inlineRouting)
  const reasoningContentSlugs = loadReasoningContentSlugs()
  const toModels = (models: ZenMuxModel[] | null) =>
    (models ?? []).map((model) =>
      mapZenMuxModelInfo(model, PROVIDER_ID, routing, opts, reasoningContentSlugs)
    )

  // Cache-only first pass: never block registration on the network round-trip.
  let models = toModels(readCachedModels(opts))
  const provider = ctx.provider

  if (provider) {
    await provider.transform((editor) => {
      editor.add({
        info: {
          id: branded<Provider.Info['id']>(PROVIDER_ID),
          name: 'ZenMux',
          activation: 'enabled',
          package: V2_PACKAGE_OPENAI,
          settings: { baseURL: opts.baseURL },
          integrationID: branded<NonNullable<Provider.Info['integrationID']>>(PROVIDER_ID),
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
    models = toModels(await fetchModels(opts))
    await provider.reload()
  }
  const kick = () => {
    void refresh().catch((err) => console.warn('[zenmux] catalog refresh failed:', err))
  }

  kick()
  const intervalMs = Number(opts.catalogCacheTTL) * 60_000
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {}

  const timer = setInterval(kick, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

export default {
  id: PROVIDER_ID,
  setup,
  server,
}
