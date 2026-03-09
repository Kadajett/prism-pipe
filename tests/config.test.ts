import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config/index.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `prism-pipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Config Defaults', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_CONFIG.port).toBe(3000);
    expect(DEFAULT_CONFIG.logLevel).toBe('info');
    expect(DEFAULT_CONFIG.requestTimeout).toBe(120_000);
    expect(Object.keys(DEFAULT_CONFIG.providers)).toHaveLength(0);
  });
});

describe('Config Loading', () => {
  let tmpDir: string;
  let origCwd: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Save env vars we might modify
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PORT', 'LOG_LEVEL']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
    expect(Object.keys(config.providers)).toHaveLength(0);
  });

  it('loads YAML config from CWD', () => {
    writeFileSync(join(tmpDir, 'prism-pipe.yaml'), `port: 4567\nlogLevel: debug\n`);
    const config = loadConfig();
    expect(config.port).toBe(4567);
    expect(config.logLevel).toBe('debug');
  });

  it('parses providers from YAML', () => {
    writeFileSync(
      join(tmpDir, 'prism-pipe.yaml'),
      `providers:\n  openai:\n    baseUrl: https://api.openai.com\n    apiKey: sk-test123\n`
    );
    const config = loadConfig();
    expect(config.providers.openai).toBeDefined();
    expect(config.providers.openai.apiKey).toBe('sk-test123');
    expect(config.providers.openai.name).toBe('openai');
  });

  it('interpolates ${VAR} env vars in YAML values', () => {
    process.env.TEST_YAML_KEY = 'sk-from-env';
    writeFileSync(
      join(tmpDir, 'prism-pipe.yaml'),
      `providers:\n  test:\n    baseUrl: https://api.test.com\n    apiKey: \${TEST_YAML_KEY}\n`
    );
    const config = loadConfig();
    expect(config.providers.test.apiKey).toBe('sk-from-env');
    delete process.env.TEST_YAML_KEY;
  });

  it('auto-configures OpenAI when OPENAI_API_KEY is set and no providers in config', () => {
    process.env.OPENAI_API_KEY = 'sk-auto-test';
    const config = loadConfig();
    expect(config.providers.openai).toBeDefined();
    expect(config.providers.openai.apiKey).toBe('sk-auto-test');
  });

  it('auto-configures Anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const config = loadConfig();
    expect(config.providers.anthropic).toBeDefined();
    expect(config.providers.anthropic.apiKey).toBe('sk-ant-test');
  });

  it('respects PORT env var', () => {
    process.env.PORT = '8080';
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it('respects LOG_LEVEL env var', () => {
    process.env.LOG_LEVEL = 'debug';
    const config = loadConfig();
    expect(config.logLevel).toBe('debug');
  });

  it('loads from explicit config path', () => {
    const customPath = join(tmpDir, 'custom.yaml');
    writeFileSync(customPath, `port: 9999\n`);
    const config = loadConfig(customPath);
    expect(config.port).toBe(9999);
  });

  it('parses routes from YAML', () => {
    writeFileSync(
      join(tmpDir, 'prism-pipe.yaml'),
      `routes:\n  - path: /v1/chat/completions\n    providers:\n      - openai\n      - anthropic\n`
    );
    const config = loadConfig();
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0].providers).toEqual(['openai', 'anthropic']);
  });
});
