import { describe, it, expect, vi } from 'vitest';
import { PipelineEngine, type Middleware } from '../src/core/pipeline.js';
import { PipelineContext } from '../src/core/context.js';
import { PipelineError } from '../src/core/types.js';
import { createTimeoutBudget } from '../src/core/timeout.js';

function createCtx(overrides?: Partial<Parameters<typeof PipelineContext.prototype.constructor>[0]>) {
	return new PipelineContext({
		request: {
			model: 'test-model',
			messages: [{ role: 'user', content: 'hello' }],
		},
		config: {
			port: 3000,
			logLevel: 'info',
			requestTimeout: 120_000,
			providers: {},
			routes: [],
		},
		...overrides,
	});
}

describe('PipelineEngine', () => {
	it('executes middleware in order', async () => {
		const engine = new PipelineEngine();
		const order: number[] = [];

		engine.use(async (_ctx, next) => { order.push(1); await next(); order.push(4); });
		engine.use(async (_ctx, next) => { order.push(2); await next(); order.push(3); });

		await engine.execute(createCtx());
		expect(order).toEqual([1, 2, 3, 4]); // onion model
	});

	it('allows middleware to short-circuit by not calling next()', async () => {
		const engine = new PipelineEngine();
		const reached = vi.fn();

		engine.use(async (ctx) => {
			ctx.response = {
				id: 'cached',
				model: 'test',
				content: [{ type: 'text', text: 'cached' }],
				stopReason: 'end',
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			};
			// Don't call next()
		});
		engine.use(async (_ctx, next) => { reached(); await next(); });

		const ctx = createCtx();
		await engine.execute(ctx);
		expect(ctx.response?.id).toBe('cached');
		expect(reached).not.toHaveBeenCalled();
	});

	it('propagates errors from middleware', async () => {
		const engine = new PipelineEngine();
		engine.use(async () => {
			throw new PipelineError('test error', 'server_error', 'test', 500, true);
		});

		await expect(engine.execute(createCtx())).rejects.toThrow(PipelineError);
	});

	it('wraps non-PipelineError errors', async () => {
		const engine = new PipelineEngine();
		engine.use(async () => {
			throw new Error('raw error');
		});

		try {
			await engine.execute(createCtx());
			expect.fail('should throw');
		} catch (err) {
			expect(err).toBeInstanceOf(PipelineError);
			expect((err as PipelineError).code).toBe('unknown');
		}
	});

	it('throws on timeout expiry', async () => {
		const engine = new PipelineEngine();
		engine.use(async (_ctx, next) => {
			await new Promise((r) => setTimeout(r, 100));
			await next();
		});

		const ctx = createCtx({ timeout: createTimeoutBudget(10) });
		// Wait for timeout to expire
		await new Promise((r) => setTimeout(r, 20));

		await expect(engine.execute(ctx)).rejects.toThrow('Pipeline timeout expired');
	});

	it('prevents calling next() multiple times', async () => {
		const engine = new PipelineEngine();
		engine.use(async (_ctx, next) => {
			await next();
			await next(); // second call should throw
		});

		await expect(engine.execute(createCtx())).rejects.toThrow('next() called multiple times');
	});

	it('records metrics for pipeline execution', async () => {
		const engine = new PipelineEngine();
		const histograms: Array<{ name: string; value: number }> = [];

		engine.use(async (_ctx, next) => { await next(); });

		const ctx = createCtx();
		ctx.metrics.histogram = (name, value) => histograms.push({ name, value });

		await engine.execute(ctx);
		expect(histograms.some((h) => h.name === 'pipeline.total_ms')).toBe(true);
		expect(histograms.some((h) => h.name === 'pipeline.middleware_ms')).toBe(true);
	});
});
