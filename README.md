# @daika7ana/opencode-zenmux-plugin

[![npm version](https://img.shields.io/npm/v/@daika7ana/opencode-zenmux-plugin)](https://www.npmjs.com/package/@daika7ana/opencode-zenmux-plugin)
[![CI](https://github.com/daika7ana/opencode-zenmux-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/daika7ana/opencode-zenmux-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [OpenCode](https://opencode.ai) plugin that keeps the ZenMux model catalog up to date by fetching it live from `https://zenmux.ai/api/v1/models` on every `opencode models --refresh`.

It also provides a non-duplicative way to force ZenMux provider routing via the `model:provider` syntax using a user-controlled routing table.

## Features

- **Live model refresh** — fetches the public ZenMux catalog on startup and on `opencode models --refresh`.
- **Provider routing** — rewrite `api.id` to `modelId:providerSlug` for any model without cluttering the model list.
- **Auth hook** — adds `/connect zenmux` for storing an API key in OpenCode's auth system.
- **JSONC support** — routing files can include comments.
- **Configurable** — override base URL, models URL, output token limit, non-chat filtering, and more.

## Installation

### From npm

Install the plugin using the OpenCode CLI:

```bash
opencode plugin @daika7ana/opencode-zenmux-plugin
```

Or add it to your OpenCode config (`opencode.json` or `.opencode/opencode.json`):

```json
{
  "plugin": ["@daika7ana/opencode-zenmux-plugin"]
}
```

OpenCode installs npm plugins automatically on startup using Bun.

### From source

Build the plugin locally:

```bash
pnpm install
pnpm build
```

Then add it to your OpenCode config (`opencode.json`):

```json
{
  "plugin": ["file:///path/to/opencode-zenmux-plugin/dist/index.js"]
}
```

Then create a `zenmux-plugin.json` file in your project root, `.opencode/`, or `~/.config/opencode/`:

```json
{
  "baseURL": "https://zenmux.ai/api/v1",
  "modelsURL": "https://zenmux.ai/api/v1/models",
  "routingFile": null,
  "defaultOutputTokens": 16384,
  "excludeNonChat": true,
  "routedModelIds": false,
  "routing": [{ "model": "z-ai/glm-5.2", "provider": "streamlake" }]
}
```

You can also pass options directly in the plugin tuple in `opencode.json`. Those override the config file:

```json
{
  "plugin": [
    [
      "@daika7ana/opencode-zenmux-plugin",
      {
        "baseURL": "https://zenmux.ai/api/v1"
      }
    ]
  ]
}
```

## Configuration options

All options can be set in `zenmux-plugin.json` (or `zenmux-plugin.jsonc`) or passed directly in the plugin tuple in `opencode.json`. Plugin tuple options override the config file.

| Option                | Type             | Default                           | Description                                                                          |
| --------------------- | ---------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `baseURL`             | `string`         | `https://zenmux.ai/api/v1`        | Base URL for actual ZenMux API calls.                                                |
| `modelsURL`           | `string`         | `https://zenmux.ai/api/v1/models` | URL to fetch the public model catalog.                                               |
| `routingFile`         | `string \| null` | `null`                            | Explicit path to the routing file; overrides the default search order.               |
| `defaultOutputTokens` | `number`         | `16384`                           | Default `limit.output` because ZenMux does not expose max output tokens.             |
| `excludeNonChat`      | `boolean`        | `true`                            | Exclude models whose output modality is not `text`.                                  |
| `routedModelIds`      | `boolean`        | `false`                           | Put the provider suffix into the model `id` itself (see [below](#routed-model-ids)). |

## Authentication

The plugin registers ZenMux as a provider that accepts an API key. You can authenticate in two ways:

### Environment variable

```bash
export ZENMUX_API_KEY="your-key"
```

### OpenCode auth system

Run inside OpenCode:

```text
/connect zenmux
```

Then enter your API key. It will be stored in OpenCode's auth system and used automatically.

## Provider routing

ZenMux supports forced routing by sending `modelId:providerSlug` as the model id. The plugin applies this via a routing table, which can live in `zenmux-plugin.json` under the `routing` field or in a separate routing file.

### Routing file names

If you prefer to keep routing in its own file, the plugin looks for the first existing file in this order:

1. `{projectRoot}/zenmux-providers.jsonc`
2. `{projectRoot}/zenmux-providers.json`
3. `{projectRoot}/zenmux-routing.jsonc`
4. `{projectRoot}/zenmux-routing.json`
5. `{projectRoot}/.opencode/zenmux-providers.jsonc`
6. `{projectRoot}/.opencode/zenmux-providers.json`
7. `{projectRoot}/.opencode/zenmux-routing.jsonc`
8. `{projectRoot}/.opencode/zenmux-routing.json`
9. `~/.config/opencode/zenmux-providers.jsonc`
10. `~/.config/opencode/zenmux-providers.json`
11. `~/.config/opencode/zenmux-routing.jsonc`
12. `~/.config/opencode/zenmux-routing.json`

Use `routingFile` in plugin options to override this search.

### Format

Array form:

```jsonc
[
  // Route Claude through Amazon Bedrock
  { "model": "anthropic/claude-sonnet-5", "provider": "amazon-bedrock" },

  // Route GLM through StreamLake
  { "model": "z-ai/glm-5.2", "provider": "streamlake" },
]
```

Object form:

```jsonc
{
  "anthropic/claude-sonnet-5": "amazon-bedrock",
  "z-ai/glm-5.2": "streamlake",
}
```

When a routing entry exists, the plugin sets `api.id = "modelId:providerSlug"` for that model. The OpenCode model list still shows the model once.

### Routed model ids

By default, routing only affects `api.id`. OpenCode's manual model selection uses `api.id`, so routing works there. Some tools (e.g., oh-my-opencode-slim) resolve models from their own JSON config and use the raw model `id` instead of `api.id`.

Set `routedModelIds: true` in `zenmux-plugin.json` to include the provider suffix in the model `id` itself:

```jsonc
{
  "routedModelIds": true,
  "routing": [{ "model": "z-ai/glm-5.2", "provider": "streamlake" }],
}
```

With this enabled, a routed model appears in OpenCode as `z-ai/glm-5.2:streamlake`. Your oh-my-opencode-slim config would then use:

```json
{ "orchestrator": { "model": "zenmux/z-ai/glm-5.2:streamlake" } }
```

## Development

```bash
# Install dependencies
pnpm install

# Type-check
pnpm typecheck

# Build
pnpm build

# Lint
pnpm lint

# Auto-fix lint issues
pnpm lint:fix

# Format
pnpm format

# Check formatting
pnpm format:check
```

## How it works

The plugin exports a default OpenCode plugin function that registers three hooks:

1. **`config`** — registers the `zenmux` provider with `@ai-sdk/openai-compatible` and the configured `baseURL`.
2. **`auth`** — adds an API key auth method for `/connect zenmux`.
3. **`provider.models`** — fetches the live ZenMux catalog, loads the routing table, maps records to OpenCode's `ModelV2` shape, and applies routing.

The public models endpoint does not require authentication. The API key is only used by the actual provider for chat/completion requests.

## License

MIT
