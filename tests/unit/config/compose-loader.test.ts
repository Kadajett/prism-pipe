import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { loadConfig } from '../../../src/config/loader';

const TEST_CONFIG = 'test-compose-config.yaml';

function cleanup() {
  if (existsSync(TEST_CONFIG)) unlinkSync(TEST_CONFIG);
}

describe('Config loader: compose routes', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('parses a compose route with chain steps', () => {
    writeFileSync(
      TEST_CONFIG,
      `
providers:
  opus:
    baseUrl: https://api.anthropic.com
    apiKey: test-key
  mercury:
    baseUrl: https://api.openai.com
    apiKey: test-key-2
routes:
  - path: /v1/chain/test
    compose:
      type: chain
      steps:
        - name: planner
          provider: opus
          model: claude-opus-4-6-20250624
          systemPrompt: "You are a planner"
          inputTransform: "{{original.lastUserMessage}}"
          timeout: 60000
        - name: executor
          provider: mercury
          model: mercury-2
          inputTransform: "{{steps.planner.content}}"
          timeout: 30000
`,
    );

    const config = loadConfig(TEST_CONFIG);
    expect(config.routes).toHaveLength(1);

    const route = config.routes[0];
    expect(route.path).toBe('/v1/chain/test');
    expect(route.compose).toBeDefined();
    expect(route.compose!.type).toBe('chain');
    expect(route.compose!.steps).toHaveLength(2);

    const [step1, step2] = route.compose!.steps;
    expect(step1.name).toBe('planner');
    expect(step1.provider).toBe('opus');
    expect(step1.model).toBe('claude-opus-4-6-20250624');
    expect(step1.systemPrompt).toBe('You are a planner');
    expect(step1.inputTransform).toBe('{{original.lastUserMessage}}');
    expect(step1.timeout).toBe(60000);

    expect(step2.name).toBe('executor');
    expect(step2.provider).toBe('mercury');
    expect(step2.inputTransform).toBe('{{steps.planner.content}}');
  });

  it('leaves compose undefined for non-compose routes', () => {
    writeFileSync(
      TEST_CONFIG,
      `
providers:
  openai:
    baseUrl: https://api.openai.com
    apiKey: test-key
routes:
  - path: /v1/chat/completions
    providers: [openai]
`,
    );

    const config = loadConfig(TEST_CONFIG);
    expect(config.routes[0].compose).toBeUndefined();
  });

  it('throws on unsupported compose type', () => {
    writeFileSync(
      TEST_CONFIG,
      `
routes:
  - path: /test
    compose:
      type: parallel
      steps:
        - name: a
          provider: x
`,
    );

    expect(() => loadConfig(TEST_CONFIG)).toThrow('Unsupported compose type');
  });

  it('throws when compose steps are empty', () => {
    writeFileSync(
      TEST_CONFIG,
      `
routes:
  - path: /test
    compose:
      type: chain
      steps: []
`,
    );

    expect(() => loadConfig(TEST_CONFIG)).toThrow('requires at least one step');
  });

  it('throws when step is missing name or provider', () => {
    writeFileSync(
      TEST_CONFIG,
      `
routes:
  - path: /test
    compose:
      type: chain
      steps:
        - name: step1
`,
    );

    expect(() => loadConfig(TEST_CONFIG)).toThrow('require "name" and "provider"');
  });
});
