# Agent Notes: opencode-zenmux-plugin

An OpenCode plugin (single package, not a monorepo) that registers the `zenmux` provider
and serves the live ZenMux model catalog.

## Commands

CI (`.github/workflows/ci.yml`) runs these in this order — run the same set before saying done:

```bash
pnpm install
pnpm format:check   # prettier --check . (whole repo)
pnpm lint           # eslint src
pnpm typecheck      # tsc --noEmit
pnpm test           # node:test + tsx loader over src/**/*.test.ts (no watch/coverage)
pnpm build          # tsc -p tsconfig.build.json -> dist/
```

- Tests live in `src/*.test.ts` and run through Node's built-in test runner via the `tsx` loader
  (`tsconfig.build.json` excludes them, so they never land in the published `dist/`).
- `dist/` is gitignored but is what gets published (`"files": ["dist"]`). Always `pnpm build`
  before a release; never hand-edit `dist/`.

## Toolchain

- `pnpm` only. `pnpm-workspace.yaml` exists solely to block `msgpackr-extract` native builds
  (`allowBuilds: false`) — it does **not** make this a monorepo.
- ESM-only (`"type": "module"`, NodeNext). Import local files with a `.js` extension even though
  the source is `.ts`.
- Runtime dependency is only `strip-json-comments`. Both `@opencode-ai/plugin` (V1) and
  `@opencode/plugin` (V2) are devDependencies and type-only (erased from `dist`) — don't promote
  them to `dependencies` without reason.
  `@opencode-ai/plugin` is the V1 package; its `dist/v2` types are stale, so never import V2 shapes
  from it. V2 types come from `@opencode/plugin`, pinned to the OpenCode 2.x version you test
  against (installed: 2.3.0) — bump it with the host, not on its own.
  Branded ids/prices (`Model.ID`, `Money.USDPerMillionTokens`) are plain strings/numbers at runtime;
  use `branded<T>()` from `src/types.ts` at the mapper boundary instead of hand-written mirrors.

## Architecture

- **Dual V1/V2 plugin.** `src/index.ts` default-exports `{ id, setup, server }`. OpenCode 1.18.x
  calls `server()` (V1 `Hooks`: `config`, `auth`, `provider.models`); OpenCode 2.x calls
  `setup(ctx)` (provider/integration transform API). Keep both entrypoints.
- **V2 `setup()` must call `ctx.provider.transform(...)` before its first `await`**: a Location's first
  catalog read returns only registrations that already exist, so anything awaited before it silently
  yields an empty catalog. That is why `readJsonc`, `loadZenMuxPluginConfig`, `loadRoutingTable`,
  `readCacheSync` / `readCachedModels` and `loadReasoningContentSlugs` are synchronous — do not make
  them async again. After registering the cached catalog it fetches live in the background and replays
  via `provider.reload()`, repeating every `catalogCacheTTL`. The transform callbacks themselves are
  synchronous — do not `await` inside them.
- Module map (change shared logic once, not in both mappers):
  - `config.ts` / `routing.ts` — resolve `zenmux-plugin.json(c)` and the routing table; both use
    `jsonc.ts`.
  - `fetch.ts` — public models catalog + frontend enrichment, disk caching, non-chat filtering.
    `readCachedModels` skips both TTL and network (used by V2's first pass).
  - `cache.ts` — shared on-disk cache dir/read/write (also used by `modelsdev.ts`).
  - `map.ts` — `resolveZenMuxModel` computes the shared intermediate; `mapZenMuxModel` → V1
    `ModelV2`, `mapZenMuxModelInfo` → V2 `Model.Info`.
  - `modelsdev.ts` — reads OpenCode's cached models.dev catalog to detect `reasoning_content`
    passthrough models. Best-effort: returns an empty set on failure.
- **Cost unit:** ZenMux prices are already USD per 1M tokens, matching OpenCode's `ModelV2.cost`
  — do not rescale them (a `/1_000_000` here previously broke spend tracking).

## Config & routing lookup

- Config: first existing `zenmux-plugin.json(c)` in `{projectRoot}`, `{projectRoot}/.opencode`,
  then `~/.config/opencode`. Routing: the `routingFile` option → inline `routing` field → first
  existing routing file in those same dirs. Within a directory the order is
  `zenmux-providers.jsonc`, `zenmux-providers.json`, `zenmux-routing.jsonc`, `zenmux-routing.json`.
- **Gotcha:** if `routingFile` is set but the file is missing, routing is _disabled_ — it does not
  fall back to the inline `routing` field or the default search. Preserve this behavior.
- Routing entry `{ model, provider?, sdk? }`: `provider` rewrites the upstream id — V1 `ModelV2.api.id`,
  V2 `Model.Info.modelID` — to `modelId:providerSlug`. `sdk: "anthropic"` switches to `@ai-sdk/anthropic`
  with `anthropicBaseURL` on V1, and to `@opencode/ai/providers/anthropic` with a per-model
  `settings.baseURL` on V2 (id stays plain when `provider` is absent). `routedModelIds: true` moves the
  suffix into `id` too.

## Style & release

- Prettier (`.prettierrc.json`): no semicolons, single quotes, `trailingComma: "es5"`,
  `printWidth: 100`, `tabWidth: 2`. ESLint lints `src/**/*.ts` only and includes Prettier (so
  `pnpm lint` won't catch formatting — run `format:check` too).
- Release: bump `version` in `package.json` and add a terse, user-facing entry to `CHANGELOG.md`.
  There are no git tags or release automation.
