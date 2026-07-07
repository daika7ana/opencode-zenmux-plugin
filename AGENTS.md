# Agent Notes: opencode-zenmux-plugin

## Package & Toolchain

- Use `pnpm`. A `pnpm-workspace.yaml` exists only to block `msgpackr-extract` native builds (`allowBuilds: false`); this is a single package, not a monorepo.
- ESM-only: `"type": "module"`, `module: NodeNext`, `moduleResolution: NodeNext`. Always import local files with the `.js` extension even though sources are `.ts`.
- `tsconfig.json` builds from `src/` to `dist/` with declarations. Published files are limited to `dist/` via `"files": ["dist"]`.

## Verification Commands

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint src
pnpm build       # tsc (emits to dist/)
pnpm format:check
```

- There is **no test runner** configured yet. Do not run `pnpm test`.
- Lint is scoped to `src/`; formatting checks the whole repo.

## Architecture

- `src/index.ts` is the plugin entry. It exports a default async function returning OpenCode `Hooks`:
  - `config` hook registers the `zenmux` provider with `@ai-sdk/openai-compatible` and `baseURL: https://zenmux.ai/api/v1`.
  - `auth` hook wires `ZENMUX_API_KEY` as an API-key auth method.
  - `provider.models` hook fetches the live catalog and returns `Record<string, ModelV2>`.
- `src/fetch.ts` calls `https://zenmux.ai/api/v1/models` (unauthenticated public endpoint) and, by default, drops models whose `output_modalities` does not include `text`.
- `src/map.ts` maps ZenMux model records to OpenCode's `ModelV2` shape.
- `src/routing.ts` loads `zenmux-providers.json` and applies the `:provider_slug` suffix to `api.id` without duplicating the model in the list.

## Routing File

- Search order (first match wins):
  1. `routingFile` option if provided in `opencode.json`
  2. `{projectDirectory}/zenmux-providers.json`
  3. `{projectDirectory}/.opencode/zenmux-providers.json`
  4. `~/.config/opencode/zenmux-providers.json`
- Accepted formats: array of `{ "model": "...", "provider": "..." }` or `Record<modelId, providerSlug>`.
- Routing rewrites `api.id` to `"modelId:providerSlug"`; actual chat calls still use `ZENMUX_API_KEY`.

## Style

- Prettier config: no semicolons, single quotes, `trailingComma: "es5"`, `printWidth: 100`, `tabWidth: 2`.
- ESLint config (`eslint.config.js`) uses `typescript-eslint/recommended` + `eslint-config-prettier` and only lints `src/**/*.ts`.

## Reference Docs

- Detailed design and mapping rules are in `PLAN.md`.
