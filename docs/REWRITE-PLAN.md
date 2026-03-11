# Rewrite Plan

This rewrite follows [`docs/PUBLIC-API.md`](./PUBLIC-API.md) as the north star.

The main rule is:

- keep useful internals
- replace the current public API shell
- rewire features behind the new `PrismPipe -> Proxy -> Route` model

## V1 Scope Note

For v1, `PrismPipe` remains the root container for many proxies, and multiple proxies remain a first-class use case. The intended public model is still one proxy per external listening port, because that keeps lifecycle, status, logs, usage, and OS-level routing understandable.

Shared setup across many proxies is still desirable, but it is explicitly out of scope for the v1 rewrite. If we need to share providers, models, logging behavior, or common routes across several port-bound proxies, that should land later as a deliberate composition feature such as templates, defaults, or proxy extension, rather than by restoring the old public multi-port proxy shape.

## Semfora-Friendly Slices

### Slice 1: Public contract

Files:

- `src/core/types.ts`
- `src/prism-pipe.ts`
- `src/proxy-instance.ts`
- `src/lib.ts`

Goal:

- expose the intended public classes and lifecycle
- add model/accounting types
- support direct `prism.createProxy({...})`

Semfora checkpoints:

- `semfora-engine query overview`
- `semfora-engine validate --file-path src/prism-pipe.ts`
- `semfora-engine validate --file-path src/proxy-instance.ts`

### Slice 2: Route execution contract

Files:

- `src/server/router.ts`
- `src/core/types.ts`
- `src/core/context.ts`

Goal:

- route handlers return `{ data, usage }`
- usage is nested by model key
- function routes become the primary authoring model
- config-object routes become adapters to the same execution contract

Semfora checkpoints:

- `semfora-engine validate --file-path src/server/router.ts`
- `semfora-engine search 'RouteResult' --raw`
- `semfora-engine search 'usage:' --raw`

### Slice 3: Accounting and model registry

Files:

- `src/store/interface.ts`
- `src/store/memory.ts`
- `src/store/sqlite.ts`
- `src/prism-pipe.ts`
- `src/proxy-instance.ts`

Goal:

- root model registry with proxy overrides
- per-request usage ledger
- aggregate getters on Prism and Proxy
- cost computation from registered model pricing

Semfora checkpoints:

- `semfora-engine search 'proxy_id' --raw`
- `semfora-engine search 'aggregateUsage' --raw`
- `semfora-engine validate --file-path src/store/sqlite.ts`

### Slice 4: Internal rewiring

Files:

- `src/proxy/provider.ts`
- `src/fallback/*`
- `src/compose/*`
- `src/admin/*`
- `src/network/*`
- `src/middleware/*`

Goal:

- preserve provider/fallback/compose internals
- rewire them behind the new route contract
- make usage accounting trustworthy for multi-model routes

Semfora checkpoints:

- `semfora-engine trace --direction incoming`
- `semfora-engine search 'callProvider' --raw`
- `semfora-engine search 'executeFallbackChain' --raw`

## Immediate Priorities

1. Replace the legacy public class shell with the new root lifecycle.
2. Make `createProxy({...})` the preferred API surface.
3. Add model registration primitives now so usage/cost wiring has a stable home.
4. Defer the full route-return rewrite until the new shell is in place.

## Current Chunk Todo

- Unify route execution so function routes and provider-backed routes both normalize through the same `RouteResult` path.
- Make `RouteResult` the single response contract for status codes, headers, payloads, and usage recording.
- Remove remaining legacy response/accounting branches in `src/server/router.ts` that bypass the canonical route path.
- Ensure every non-stream provider-backed request records usage through the model-keyed usage ledger.
- Add a consistent streaming accounting path so streamed responses can still produce final usage entries.
- Validate streaming endpoints end-to-end against the rewritten route contract, including provider-backed streaming behavior.
- Validate thinking-style routes and middleware end-to-end so multi-step/model orchestration still returns the expected payload plus usage map.
- Confirm route-level logs, proxy-level logs, and usage/cost getters still agree after the canonical route path is in place.
- Keep semfora self-review on `src/server/router.ts` and `src/proxy-instance.ts` after each slice, since those remain the highest-risk files.
