/**
 * AWS Lambda adapter for prism-pipe
 *
 * Single-invocation mode: each Lambda invocation handles one request.
 * State stored in DynamoDB/S3. No worker_threads.
 *
 * Usage with SAM/Serverless:
 *   handler: dist/runtime/lambda.handler
 *
 * Environment variables:
 *   PRISM_PIPE_CONFIG: JSON string or S3 URI for config
 *   DYNAMODB_TABLE: DynamoDB table name for state
 *   S3_BUCKET: S3 bucket for large state/logs
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Context,
} from 'aws-lambda';

interface LambdaRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
}

function parseEvent(event: APIGatewayProxyEventV2): LambdaRequest {
  return {
    method: event.requestContext?.http?.method || 'GET',
    path: event.rawPath || '/',
    headers: (event.headers || {}) as Record<string, string>,
    body: event.body || null,
    queryStringParameters: (event.queryStringParameters || null) as Record<string, string> | null,
  };
}

/**
 * Lambda handler entry point
 *
 * Compatible with API Gateway HTTP API (v2) payload format.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context
): Promise<APIGatewayProxyResultV2> {
  const request = parseEvent(event);

  // Health check fast path
  if (request.path === '/health') {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'healthy',
        runtime: 'lambda',
        version: '0.1.0',
      }),
    };
  }

  if (request.path === '/ready') {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'healthy',
        runtime: 'lambda',
        version: '0.1.0',
      }),
    };
  }

  // TODO: Wire to pipeline engine when #10 MVP exports are stable
  // For now, return a placeholder that validates the adapter works
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'prism-pipe lambda adapter',
      path: request.path,
      method: request.method,
    }),
  };
}
