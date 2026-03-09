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
  providers: [],
  rateLimit: {
    enabled: false,
    requestsPerMinute: 100,
    tokensPerMinute: 10000,
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
