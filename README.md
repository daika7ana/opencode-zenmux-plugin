# @daika7ana/opencode-zenmux-plugin

[![npm version](https://img.shields.io/npm/v/@daika7ana/opencode-zenmux-plugin)](https://www.npmjs.com/package/@daika7ana/opencode-zenmux-plugin)
[![CI](https://github.com/daika7ana/opencode-zenmux-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/daika7ana/opencode-zenmux-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [OpenCode](https://opencode.ai) plugin that keeps the ZenMux model catalog up to date by fetching it live from `https://zenmux.ai/api/v1/models` on every `opencode models --refresh`.

It also provides a non-duplicative way to force ZenMux provider routing via the `model:provider` syntax using a user-controlled routing table.

## Prerequisites

- [OpenCode](https://opencode.ai) CLI installed and working
- A ZenMux API key (get one at https://zenmux.ai)

## Quick Start

1. **Install:**
   ```bash
   opencode plugin --global @daika7ana/opencode-zenmux-plugin@latest
   ```
2. **Authenticate:**
   ```bash
   export ZENMUX_API_KEY="your-key"
   ```
   Or run `/connect zenmux` inside OpenCode to store the key in its auth system.
3. **Refresh:**
   ```bash
   opencode models --refresh
   ```

## Features

- **Live model refresh** — fetches the public ZenMux catalog on startup and on `opencode models --refresh`.
- **Provider routing** — rewrite `api.id` to `modelId:providerSlug` for any model without cluttering the model list.
- **Auth hook** — adds `/connect zenmux` for storing an API key in OpenCode's auth system.
- **JSONC support** — both the plugin config file and routing files can include comments.
- **Configurable** — override base URL, models URL, output token limit, non-chat filtering, and more.

## Installation

### From npm

This plugin is meant to be installed **globally**, not per-project. Use the `--global` flag and the `@latest` tag so OpenCode always resolves the newest published version:

```bash
opencode plugin --global @daika7ana/opencode-zenmux-plugin@latest
```

> The command above uses the current OpenCode CLI syntax. If your version of OpenCode uses a different plugin command, adjust accordingly.

This adds the plugin to your global OpenCode config (`~/.config/opencode/opencode.json`) and installs it into the OpenCode plugin cache.

After installing, refresh the model catalog so OpenCode picks up the ZenMux models:

```bash
opencode models --refresh
```

#### Force an update

Use the `--force` flag to replace the existing cached version:

```bash
opencode plugin --global --force @daika7ana/opencode-zenmux-plugin@latest
```

If a stale cache still prevents the update from being applied, delete the cached package and reinstall:

```bash
rm -rf ~/.cache/opencode/packages/@daika7ana/opencode-zenmux-plugin@latest
opencode plugin --global @daika7ana/opencode-zenmux-plugin@latest
```

**Next:** [Configure authentication](#authentication) and optionally set up [provider routing](#provider-routing).

### From source

<details>
<summary>Build and install from source</summary>

Build the plugin locally:

```bash
pnpm install
pnpm build
```

Then add it to your global OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["file:///path/to/opencode-zenmux-plugin/dist/index.js"]
}
```

After installing from source, refresh the model catalog so OpenCode picks up the ZenMux models:

```bash
opencode models --refresh
```

**Next:** [Configure authentication](#authentication) and optionally set up [provider routing](#provider-routing).

</details>

## Configuration

The plugin uses two types of files:

- **`zenmux-plugin.json`** — plugin settings (base URL, token limits, etc.) with an optional inline `routing` field.
- **`zenmux-providers.json`** — standalone routing table only (no settings). See [Provider routing](#provider-routing).

### Config file

Create a `zenmux-plugin.json` file in your project root, `.opencode/`, or `~/.config/opencode/`. Both `.json` and `.jsonc` (JSON with comments) extensions are accepted; the plugin looks for the first existing file in this order:

1. `{projectRoot}/zenmux-plugin.json`
2. `{projectRoot}/.opencode/zenmux-plugin.json`
3. `~/.config/opencode/zenmux-plugin.json`

Example:

```jsonc
{
  // Base URL for actual ZenMux API calls
  "baseURL": "https://zenmux.ai/api/v1",

  // URL to fetch the public model catalog
  "modelsURL": "https://zenmux.ai/api/v1/models",

  // Optional: explicit path to a routing file
  "routingFile": null,

  // Default output token limit (ZenMux does not expose this)
  "defaultOutputTokens": 16384,

  // Hide models that cannot produce text
  "excludeNonChat": true,

  // Include :providerSlug in the model id itself
  "routedModelIds": false,

  // Inline routing table (same format as a routing file)
  "routing": [{ "model": "z-ai/glm-5.2", "provider": "streamlake" }],
}
```

### Plugin tuple override

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

### Configuration options

All options can be set in `zenmux-plugin.json` (or `zenmux-plugin.jsonc`). All options except `routing` can also be passed directly in the plugin tuple in `opencode.json`. The `routing` option can only be set in the config file because it belongs in a dedicated routing table. Plugin tuple options override the config file.

| Option                | Type                              | Default                           | Description                                                                             |
| --------------------- | --------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `baseURL`             | `string`                          | `https://zenmux.ai/api/v1`        | Base URL for actual ZenMux API calls.                                                   |
| `modelsURL`           | `string`                          | `https://zenmux.ai/api/v1/models` | URL to fetch the public model catalog.                                                  |
| `routingFile`         | `string \| null`                  | `null`                            | Explicit path to the routing file; overrides the default search order.                  |
| `routing`             | `array \| Record<string, string>` | —                                 | In-file routing table; array or object form. See [Provider routing](#provider-routing). |
| `defaultOutputTokens` | `number`                          | `16384`                           | Default `limit.output` because ZenMux does not expose max output tokens.                |
| `excludeNonChat`      | `boolean`                         | `true`                            | Exclude models whose output modality is not `text`.                                     |
| `routedModelIds`      | `boolean`                         | `false`                           | Put the provider suffix into the model `id` itself (see [below](#routed-model-ids)).    |

### Option precedence

Options are merged in this order (later wins):

1. Plugin defaults
2. `zenmux-plugin.json` / `zenmux-plugin.jsonc`
3. Options passed directly in the plugin tuple in `opencode.json` (does not include `routing`)

That means plugin tuple options always override the config file, and the config file overrides the built-in defaults. The `routing` field can only be set in the config file.

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

ZenMux supports forced routing by sending `modelId:providerSlug` as the model id. The plugin applies this via a routing table, which can live in `zenmux-plugin.json` under the `routing` field or in a separate routing file. You do not need both.

When a routing entry exists, the plugin sets `api.id = "modelId:providerSlug"` for that model. The OpenCode model list still shows the model once.

### Routing precedence

If multiple routing sources are present, they are checked in this order and the first match wins:

1. **`routingFile`** in plugin options — explicit path to a routing file.
2. **`routing` field** in `zenmux-plugin.json` / `zenmux-plugin.jsonc`.
3. **Default routing file search** (see below).

If `routingFile` is set but the file does not exist, routing is disabled for that refresh; the plugin does **not** fall back to the inline `routing` field or the default file search.

### Routing file names

If you prefer to keep routing in its own file, the plugin looks for the first existing file in this order. Both `.json` and `.jsonc` (JSON with comments) extensions are accepted; `.jsonc` takes precedence when both exist in the same directory.

1. `{projectRoot}/zenmux-providers.json`
2. `{projectRoot}/zenmux-routing.json`
3. `{projectRoot}/.opencode/zenmux-providers.json`
4. `{projectRoot}/.opencode/zenmux-routing.json`
5. `~/.config/opencode/zenmux-providers.json`
6. `~/.config/opencode/zenmux-routing.json`

Use `routingFile` in plugin options to override this search and point to a custom file.

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
