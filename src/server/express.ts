<<<<<<< HEAD
import express, { type Application } from "express"
import type { Store } from "../store/interface.js"
import type { Config } from "../config/schema.js"
import { errorHandler } from "./middleware/error-handler.js"
import { requestIdMiddleware } from "./middleware/request-id.js"
import { responseHeadersMiddleware } from "./middleware/response-headers.js"
import { createAuthMiddleware } from "./middleware/auth.js"
import { createRateLimitMiddleware } from "./middleware/rate-limit.js"
import { router } from "./router.js"
=======
import express, { type Request, type Response, type NextFunction } from 'express';
import { ulid } from 'ulid';
import { PipelineError } from '../core/types.js';

export function createApp() {
	const app = express();

	// Body parser
	app.use(express.json({ limit: '10mb' }));

	// CORS
	app.use((_req: Request, res: Response, next: NextFunction) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
		if (_req.method === 'OPTIONS') {
			res.status(204).end();
			return;
		}
		next();
	});

	// Request ID
	app.use((req: Request, res: Response, next: NextFunction) => {
		const reqId = (req.headers['x-request-id'] as string) ?? ulid();
		res.setHeader('X-Request-ID', reqId);
		(req as unknown as Record<string, unknown>).requestId = reqId;
		next();
	});

	// Health endpoint
	app.get('/health', (_req: Request, res: Response) => {
		res.json({ status: 'ok', timestamp: new Date().toISOString() });
	});

	return app;
}
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))

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
