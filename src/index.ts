import { createApp, errorHandler } from './server/express.js';
import { setupRoutes } from './server/router.js';
import { PipelineEngine } from './core/pipeline.js';
import { TransformRegistry } from './proxy/transform-registry.js';
import { OpenAITransformer } from './proxy/transforms/openai.js';
import { AnthropicTransformer } from './proxy/transforms/anthropic.js';
import { createLogMiddleware } from './middleware/log-request.js';
import { createTransformMiddleware } from './middleware/transform-format.js';
import { loadConfig } from './config/loader.js';

// Load config
const config = loadConfig();

// Set up transform registry
const transformRegistry = new TransformRegistry();
transformRegistry.register(new OpenAITransformer());
transformRegistry.register(new AnthropicTransformer());

// Build pipeline
const pipeline = new PipelineEngine();
pipeline.use(createLogMiddleware());
pipeline.use(createTransformMiddleware(transformRegistry));

// Create Express app
const app = createApp();

// Set up routes
setupRoutes(app, { config, pipeline, transformRegistry });

// Error handler (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(config.port, () => {
	console.log(JSON.stringify({
		level: 'info',
		msg: 'Prism Pipe started',
		port: config.port,
		providers: Object.keys(config.providers),
		routes: config.routes.map((r) => r.path),
	}));
});

// Graceful shutdown
function shutdown(signal: string) {
	console.log(JSON.stringify({ level: 'info', msg: `Received ${signal}, shutting down...` }));
	server.close(() => {
		console.log(JSON.stringify({ level: 'info', msg: 'Server closed' }));
		process.exit(0);
	});
	// Force exit after 10s
	setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
