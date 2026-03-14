/**
 * Programmatic API for Prism Pipe.
 *
 * Stable public API:
 * ```typescript
 * import { PrismPipe } from 'prism-pipe';
 *
 * const prism = new PrismPipe();
 * const proxy = prism.createProxy({
 *   id: 'claude-code',
 *   port: 3100,
 *   providers: { ... },
 *   routes: { ... },
 * });
 *
 * await prism.start();
 * ```
 */

export { loadConfig } from './config/loader';
export type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamChunk,
  ComposeConfig,
  ComposeStepConfig,
  CostSummary,
  ExtendedComposeConfig,
  HotReloadConfig,
  ModelDefinition,
  ModelUsage,
  PortConfig,
  PrismStatus,
  ProviderConfig,
  ProxyDefinition,
  ProxyErrorEvent,
  ProxyStatus,
  ResolvedConfig,
  RetryConfig,
  RouteConfig,
  RouteConfigObject,
  RouteHandler,
  RouteResult,
  RouteValue,
  UsageQuery,
  UsageSummary,
} from './core/types';
export type { PrismConfig } from './prism-pipe';
export { PrismPipe } from './prism-pipe';
export type { ProxyHealthInfo } from './proxy-instance';
export { ProxyInstance } from './proxy-instance';
export type { LogQuery, RequestLogEntry, UsageLogEntry, UsageLogQuery } from './store/interface';
