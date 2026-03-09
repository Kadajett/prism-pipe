import express, { type Application } from "express"
import type { Store } from "../store/interface.js"
import type { Config } from "../config/schema.js"
import { errorHandler } from "./middleware/error-handler.js"
import { requestIdMiddleware } from "./middleware/request-id.js"
import { responseHeadersMiddleware } from "./middleware/response-headers.js"
import { createAuthMiddleware } from "./middleware/auth.js"
import { createRateLimitMiddleware } from "./middleware/rate-limit.js"
import { router } from "./router.js"

/**
 * Express app factory — thin HTTP shell
 */

export interface ExpressAppOptions {
  config: Config
  store: Store
}

export function createExpressApp(options: ExpressAppOptions): Application {
  const { config, store } = options
  const app = express()

  // Body parsing
  app.use(express.json({ limit: "10mb" }))
  app.use(express.urlencoded({ limit: "10mb", extended: true }))

  // Request middleware
  app.use(requestIdMiddleware)
  app.use(responseHeadersMiddleware)

  // Gateway middleware (auth + rate limit)
  app.use(createAuthMiddleware({ config: config.auth }))
  app.use(createRateLimitMiddleware({ config: config.rateLimit, store }))

  // Routes
  app.use("/v1", router)

  // Error handling (must be last)
  app.use(errorHandler)

  return app
}
