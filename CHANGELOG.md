# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
