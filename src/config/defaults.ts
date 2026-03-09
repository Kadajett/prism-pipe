/**
 * Default config values
 */

import type { Config } from "./schema"

export const defaultConfig: Config = {
  server: {
    port: 3000,
    host: "localhost",
    timeout: 30000,
  },
  auth: {
    enabled: false,
    apiKey: undefined,
  },
  providers: [],
  rateLimit: {
    enabled: false,
    requestsPerMinute: 100,
    tokensPerMinute: 10000,
    capacity: 60,
    refillRate: 1, // 1 token per second = 60 req/min
  },
  logging: {
    level: "info",
    format: "json",
    database: {
      enabled: false,
      path: "./data/requests.db",
    },
  },
}
