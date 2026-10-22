# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-10-22

### Added

- `pricingTieBreak` option (`"lowest"` by default, or `"highest"`) controls which price is used when ZenMux returns several prices for the same token threshold. `"lowest"` matches the models.dev catalog.

### Fixed

- `/connect zenmux` no longer asks for the API key twice; OpenCode's built-in prompt is used.
- Pricing tiers use the real `kTokens` thresholds (including `gt`) and report every tier instead of assuming a 200K boundary.
- When ZenMux returns several prices for the same threshold (time-of-day, cache-type or output-length variants OpenCode cannot represent), the default `"lowest"` matches models.dev and `"highest"` reports the list/peak price.
- Models whose catalog entry lists supported parameters without `tools` no longer advertise tool calling.
- The shared cache directory follows OpenCode's XDG layout on macOS and Windows, so models.dev auto-detection works there.
- Failed catalog fetches fall back to the last cached catalog instead of dropping all models.
- Cache writes create the cache directory and use a unique temp file.
- A non-numeric `catalogCacheTTL` no longer turns the background refresh into a tight request loop.
- A user-defined `provider.zenmux` entry keeps its extra options when the plugin registers the provider.

## [0.4.1] - 2026-09-27

### Changed

- Internal refactor only: deduplicated JSONC config/routing loading into a shared helper and removed dead code and unused type fields. No behavior change.
- Added a focused unit-test suite (mappers, pricing, routing), wired into CI. No behavior change.

## [0.4.0] - 2026-09-27

### Added

- OpenCode 2.x support: a `setup()` entrypoint registers the provider and models through the V2 provider/integration API, seeds them from the disk cache, then refreshes in the background. One install now works on both OpenCode 1.18.x and 2.x.
- V2 `Model.Info` / `Provider.Info` types and mapping.

## [0.3.0] - 2026-08-03

### Added

- `reasoning_content` passthrough for thinking models (DeepSeek, GLM, MiniMax, Kimi, MiMo), configurable via `reasoningContentModels`; additional models are auto-detected from OpenCode's cached models.dev catalog.
- On-disk catalog cache (`catalogCacheTTL`, default 60 min) so startups skip the network; `opencode models --refresh` forces a refetch.

### Fixed

- Frontend API response parsing (`{ success, data }`) so `max_completion_tokens` enrichment actually applies.

## [0.2.0] - 2026-07-19

### Added

- Catalog enrichment from the ZenMux frontend API (output token limits, capabilities, descriptions), fetched in parallel and cross-referenced by slug ↔ id.

### Changed

- Routing `provider` is now optional, so a model can be switched to the Anthropic SDK without rewriting its id.

## [0.1.2] - 2026-07-09

### Fixed

- Correct cost unit (USD per 1M tokens), fixing spend tracking stuck at `$0.00`.

## [0.1.1] - 2026-07-07

### Fixed

- README installation command.

## [0.1.0] - 2026-07-07

### Added

- Initial release: live ZenMux model catalog, provider routing, Anthropic Messages API routing, `/connect zenmux` auth, and JSONC config support.
