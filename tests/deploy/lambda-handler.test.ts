import { describe, it, expect } from 'vitest';
import { handler } from '../../src/runtime/lambda.js';

function makeEvent(path: string, method = 'GET') {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: {},
    body: null,
    queryStringParameters: null,
    isBase64Encoded: false,
    routeKey: '',
    rawQueryString: '',
    version: '2.0',
  } as any;
}

const ctx = {} as any;

describe('Lambda Handler', () => {
  it('responds to /health', async () => {
    const result = await handler(makeEvent('/health'), ctx);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.status).toBe('healthy');
    expect(body.runtime).toBe('lambda');
  });

  it('responds to /ready', async () => {
    const result = await handler(makeEvent('/ready'), ctx);
    expect(result.statusCode).toBe(200);
  });

  it('responds to arbitrary paths', async () => {
    const result = await handler(makeEvent('/v1/chat/completions', 'POST'), ctx);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.path).toBe('/v1/chat/completions');
    expect(body.method).toBe('POST');
  });
});
