import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveConfig, validateConfig, interpolateEnv } from '../src/config/index.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `prism-pipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Config Schema Validation', () => {
  it('returns defaults for empty input', () => {
    const config = validateConfig({});
    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.cors).toBe(true);
    expect(config.logging.level).toBe('info');
    expect(config.store.type).toBe('memory');
  });

  it('throws on invalid port', () => {
    expect(() => validateConfig({ server: { port: -1 } })).toThrow('Invalid configuration');
    expect(() => validateConfig({ server: { port: 99999 } })).toThrow('Invalid configuration');
  });

  it('throws on invalid provider (missing required fields)', () => {
    expect(() =>
      validateConfig({ providers: { bad: { baseUrl: 'not-a-url' } } })
    ).toThrow('Invalid configuration');
  });

  it('accepts valid provider config', () => {
    const config = validateConfig({
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test123',
          models: ['gpt-4o'],
        },
      },
    });
    expect(config.providers.openai.apiKey).toBe('sk-test123');
  });

  it('validates logging level enum', () => {
    expect(() =>
      validateConfig({ logging: { level: 'verbose' } })
    ).toThrow('Invalid configuration');
  });

  it('returns frozen config', () => {
    const config = validateConfig({});
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('ENV interpolation', () => {
  beforeEach(() => {
    process.env.TEST_API_KEY = 'sk-interpolated';
  });
  afterEach(() => {
    delete process.env.TEST_API_KEY;
  });

  it('resolves ${VAR} in strings', () => {
    const result = interpolateEnv({ apiKey: '${TEST_API_KEY}' });
    expect(result).toEqual({ apiKey: 'sk-interpolated' });
  });

  it('resolves nested objects', () => {
    const result = interpolateEnv({ a: { b: '${TEST_API_KEY}' } });
    expect(result).toEqual({ a: { b: 'sk-interpolated' } });
  });

  it('throws on missing env var', () => {
    expect(() => interpolateEnv({ key: '${NONEXISTENT_VAR_XYZ}' })).toThrow(
      'Environment variable "NONEXISTENT_VAR_XYZ" referenced in config but not set'
    );
  });
});

describe('YAML loading', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads YAML config from CWD', () => {
    writeFileSync(
      join(tmpDir, 'prism-pipe.yaml'),
      `server:\n  port: 4567\nlogging:\n  level: debug\n`
    );
    const config = resolveConfig({ cwd: tmpDir, argv: [] });
    expect(config.server.port).toBe(4567);
    expect(config.logging.level).toBe('debug');
  });

  it('interpolates ENV vars in YAML', () => {
    process.env.TEST_YAML_KEY = 'sk-from-env';
    writeFileSync(
      join(tmpDir, 'prism-pipe.yaml'),
      `providers:\n  test:\n    baseUrl: https://api.test.com\n    apiKey: \${TEST_YAML_KEY}\n`
    );
    const config = resolveConfig({ cwd: tmpDir, argv: [] });
    expect(config.providers.test.apiKey).toBe('sk-from-env');
    delete process.env.TEST_YAML_KEY;
  });
});

describe('Override priority: defaults < YAML < ENV < CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.PRISM_SERVER_PORT;
  });

  it('ENV overrides YAML', () => {
    writeFileSync(join(tmpDir, 'prism-pipe.yaml'), `server:\n  port: 5000\n`);
    process.env.PRISM_SERVER_PORT = '6000';
    const config = resolveConfig({ cwd: tmpDir, argv: [] });
    expect(config.server.port).toBe(6000);
  });

  it('CLI overrides ENV', () => {
    process.env.PRISM_SERVER_PORT = '6000';
    const config = resolveConfig({
      cwd: tmpDir,
      argv: ['--server.port', '7000'],
    });
    expect(config.server.port).toBe(7000);
  });

  it('full priority chain: defaults < YAML < ENV < CLI', () => {
    writeFileSync(join(tmpDir, 'prism-pipe.yaml'), `server:\n  port: 5000\n  host: yaml-host\n`);
    process.env.PRISM_SERVER_PORT = '6000';
    const config = resolveConfig({
      cwd: tmpDir,
      argv: ['--server.port', '7000'],
    });
    // CLI wins for port
    expect(config.server.port).toBe(7000);
    // YAML wins for host (no ENV or CLI override)
    expect(config.server.host).toBe('yaml-host');
  });
});

describe('Zero-config mode', () => {
  it('works with no config file and no ENV vars', () => {
    const tmpDir = makeTmpDir();
    const config = resolveConfig({ cwd: tmpDir, argv: [] });
    expect(config.server.port).toBe(3000);
    expect(config.logging.level).toBe('info');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-configures OpenAI when OPENAI_API_KEY is set', () => {
    const tmpDir = makeTmpDir();
    process.env.OPENAI_API_KEY = 'sk-auto-test';
    const config = resolveConfig({ cwd: tmpDir, argv: [] });
    expect(config.providers.openai).toBeDefined();
    expect(config.providers.openai.apiKey).toBe('sk-auto-test');
    delete process.env.OPENAI_API_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
