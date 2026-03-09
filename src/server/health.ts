/**
 * Health check endpoints
 */
import type { Request, Response } from 'express';
import type { PrismConfig, HealthResponse, ReadyResponse } from '../types/index.js';

const VERSION = '0.1.0';
const START_TIME = Date.now();

/**
 * GET /health - Kubernetes liveness probe
 * Always returns 200 if the process is running
 */
export function healthCheck(req: Request, res: Response): void {
  const response: HealthResponse = {
    status: 'healthy',
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    version: VERSION,
  };
  res.json(response);
}

/**
 * GET /ready - Kubernetes readiness probe
 * Returns 200 when providers are validated
 */
export function readinessCheck(config: PrismConfig) {
  return (req: Request, res: Response): void => {
    const providersReady = config.providers.filter((p) => p.enabled);

    const response: ReadyResponse = {
      status: providersReady.length > 0 ? 'healthy' : 'degraded',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: VERSION,
      providers: config.providers.map((p) => ({
        name: p.name,
        status: p.enabled ? 'ready' : 'unavailable',
      })),
    };

    const statusCode = providersReady.length > 0 ? 200 : 503;
    res.status(statusCode).json(response);
  };
}
