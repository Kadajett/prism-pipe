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
		(req as Record<string, unknown>).requestId = reqId;
		next();
	});

	// Health endpoint
	app.get('/health', (_req: Request, res: Response) => {
		res.json({ status: 'ok', timestamp: new Date().toISOString() });
	});

	return app;
}

/**
 * Error handler middleware — must be added after all routes.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
	if (err instanceof PipelineError) {
		res.status(err.statusCode).json({
			error: {
				message: err.message,
				code: err.code,
				step: err.step,
			},
		});
		return;
	}

	console.error('Unhandled error:', err);
	res.status(500).json({
		error: {
			message: 'Internal server error',
			code: 'unknown',
		},
	});
}
