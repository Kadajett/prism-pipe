import type { ResolvedConfig } from '../core/types.js';

export const DEFAULT_CONFIG: ResolvedConfig = {
  port: 3000,
  logLevel: 'info',
  requestTimeout: 120_000, // 120s
  providers: {},
  routes: [
    {
      path: '/v1/chat/completions',
      providers: [], // Must be configured
      pipeline: ['log-request', 'transform-format'],
    },
  ],
};
