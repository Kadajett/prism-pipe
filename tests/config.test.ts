import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config/loader.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';

function makeTmpDir(): string {
	const dir = join(tmpdir(), `prism-pipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe('Config defaults', () => {
	it('returns sensible defaults', () => {
		expect(DEFAULT_CONFIG.port).toBe(3000);
		expect(DEFAULT_CONFIG.logLevel).toBe('info');
		expect(DEFAULT_CONFIG.requestTimeout).toBe(120_000);
		expect(DEFAULT_CONFIG.routes.length).toBeGreaterThan(0);
	});
});

describe('Config loader', () => {
	let tmpDir: string;
	let origCwd: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		origCwd = process.cwd();
		process.chdir(tmpDir);
	});

	afterEach(() => {
		process.chdir(origCwd);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('loads defaults when no config file exists', () => {
		const config = loadConfig();
		expect(config.port).toBe(3000);
		expect(config.logLevel).toBe('info');
	});

	it('loads from YAML config file', () => {
		writeFileSync(join(tmpDir, 'prism-pipe.yaml'), 'port: 4567\nlogLevel: debug\n');
		const config = loadConfig();
		expect(config.port).toBe(4567);
		expect(config.logLevel).toBe('debug');
	});

	it('interpolates ENV vars in YAML', () => {
		process.env.TEST_YAML_KEY = 'sk-from-env';
		writeFileSync(
			join(tmpDir, 'prism-pipe.yaml'),
			`providers:\n  test:\n    baseUrl: https://api.test.com\n    apiKey: \${TEST_YAML_KEY}\n`,
		);
		const config = loadConfig();
		expect(config.providers.test.apiKey).toBe('sk-from-env');
		delete process.env.TEST_YAML_KEY;
	});

	it('auto-configures OpenAI when OPENAI_API_KEY is set', () => {
		process.env.OPENAI_API_KEY = 'sk-auto-test';
		const config = loadConfig();
		expect(config.providers.openai).toBeDefined();
		expect(config.providers.openai.apiKey).toBe('sk-auto-test');
		delete process.env.OPENAI_API_KEY;
	});

	it('parses route configuration', () => {
		writeFileSync(
			join(tmpDir, 'prism-pipe.yaml'),
			`routes:\n  - path: /v1/test\n    providers:\n      - openai\n    pipeline:\n      - log-request\n`,
		);
		const config = loadConfig();
		expect(config.routes[0].path).toBe('/v1/test');
		expect(config.routes[0].providers).toEqual(['openai']);
	});
});
