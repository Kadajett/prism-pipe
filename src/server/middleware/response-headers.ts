/**
 * Response headers middleware
 * Adds X-Prism-* headers for observability
 */
import type { Request, Response, NextFunction } from 'express';
import type { PrismConfig } from '../../types/index.js';

// Read version from package.json at build time
const VERSION = '0.1.0';

export function createResponseHeadersMiddleware(
  verbosity: PrismConfig['responseHeaders']['verbosity']
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    // Capture original res.end to calculate latency
    const originalEnd = res.end.bind(res);
    res.end = function (
      chunk?: unknown,
      encoding?: BufferEncoding | (() => void),
      cb?: () => void
    ): ReturnType<typeof res.end> {
      const latency = Date.now() - startTime;

      // Always add version header
      res.setHeader('X-Prism-Version', VERSION);

      if (verbosity === 'standard' || verbosity === 'verbose') {
        res.setHeader('X-Prism-Latency', `${latency}ms`);
      }

      if (verbosity === 'verbose') {
        // Add provider header if available in request metadata
        const provider = (req as Request & { provider?: string }).provider;
        if (provider) {
          res.setHeader('X-Prism-Provider', provider);
        }
      }

      // Call original with proper arguments
      if (typeof encoding === 'function') {
        return originalEnd(chunk, encoding);
      }
      if (encoding !== undefined) {
        return originalEnd(chunk, encoding, cb);
      }
      return originalEnd(chunk);
    };

    next();
  };
}
