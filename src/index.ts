import type { PluginInput, Config, Hooks, AuthHook } from '@opencode-ai/plugin'
import type { ModelV2, ZenMuxPluginOptions } from './types.js'
import { DEFAULT_OPTIONS } from './types.js'
import { loadZenMuxPluginConfig } from './config.js'
import { loadRoutingTable } from './routing.js'
import { fetchModels } from './fetch.js'
import { loadReasoningContentSlugs } from './modelsdev.js'
import { mapZenMuxModel } from './map.js'

const PROVIDER_ID = 'zenmux'

export default async function zenmuxPlugin(
  input: PluginInput,
  rawOpts?: Partial<ZenMuxPluginOptions>
): Promise<Hooks> {
  const projectDirectory = input.directory
  const configFile = await loadZenMuxPluginConfig(projectDirectory)
  const opts: ZenMuxPluginOptions = { ...DEFAULT_OPTIONS, ...configFile, ...rawOpts }

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
