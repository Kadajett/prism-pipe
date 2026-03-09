import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../../../src/proxy/provider-registry.js';
import type { ProviderConfig } from '../../../src/core/types.js';

describe('ProviderRegistry', () => {
	let registry: ProviderRegistry;

	const openai: ProviderConfig = {
		name: 'openai',
		baseUrl: 'https://api.openai.com',
		apiKey: 'sk-test',
		timeout: 30000,
	};

	const anthropic: ProviderConfig = {
		name: 'anthropic',
		baseUrl: 'https://api.anthropic.com',
		apiKey: 'sk-ant-test',
		timeout: 45000,
	};

	beforeEach(() => {
		registry = new ProviderRegistry();
	});

	it('registers and retrieves a provider', () => {
		registry.register(openai);
		expect(registry.get('openai')).toEqual(openai);
	});

	it('throws on unknown provider', () => {
		expect(() => registry.get('nope')).toThrow('Provider not found: "nope"');
	});

	it('throws on missing name', () => {
		expect(() => registry.register({ ...openai, name: '' })).toThrow('must have a name');
	});

	it('throws on missing baseUrl', () => {
		expect(() => registry.register({ ...openai, baseUrl: '' })).toThrow('must have a baseUrl');
	});

	it('lists registered providers', () => {
		registry.register(openai);
		registry.register(anthropic);
		expect(registry.list()).toEqual(['openai', 'anthropic']);
	});

	it('resolves ordered list by names', () => {
		registry.register(openai);
		registry.register(anthropic);
		const resolved = registry.resolve(['anthropic', 'openai']);
		expect(resolved[0].name).toBe('anthropic');
		expect(resolved[1].name).toBe('openai');
	});

	it('registerAll from config record', () => {
		registry.registerAll({
			openai,
			anthropic,
		});
		expect(registry.size).toBe(2);
		expect(registry.has('openai')).toBe(true);
		expect(registry.has('anthropic')).toBe(true);
	});

	it('has() returns false for unregistered', () => {
		expect(registry.has('openai')).toBe(false);
	});

	it('clear removes all providers', () => {
		registry.register(openai);
		registry.clear();
		expect(registry.size).toBe(0);
	});
});
