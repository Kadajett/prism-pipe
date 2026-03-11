import type { Server } from 'node:http';
import type { Express } from 'express';
import express from 'express';
import { ulid } from 'ulid';
import type { AdminRouteOptions, StatsTracker } from '../admin/routes';
import { setupAdminRoutes } from '../admin/routes';
import { TenantManager } from '../auth/tenant';
import { PipelineEngine } from '../core/pipeline';
import type {
  ModelDefinition,
  PortConfig,
  ProviderConfig,
  ProxyDefinition,
  ResolvedConfig,
  ScopedLogger,
} from '../core/types';
import type { CircuitBreakerRegistry } from '../fallback/circuit-breaker';
import { createLogMiddleware } from '../middleware/log-request';
import { createTransformMiddleware } from '../middleware/transform-format';
import { AgentFactory } from '../network/agent-factory';
import { IpPool } from '../network/ip-pool';
import type { PluginRegistry } from '../plugin/registry';
import type { TransformRegistry } from '../proxy/transform-registry';
import { TokenBucket } from '../rate-limit/token-bucket';
import { createAuthMiddleware } from '../server/auth';
import { errorHandler } from '../server/express';
import { createRateLimitMiddleware } from '../server/rate-limit';
import { setupRoutes } from '../server/router';
import type { Store } from '../store/interface';
import { executeFunctionRoute } from './function-route-runtime';
import { registerFunctionRoutes, resolveRoutes } from './route-tree';

export interface PortInfo {
  port: string;
  server: Server;
  app: Express;
  pipeline: PipelineEngine;
  agentFactory?: AgentFactory;
  tenantManager?: TenantManager;
}

export function buildPortConfig(definition: ProxyDefinition): PortConfig {
  const {
    port: _port,
    models: _models,
    id: _id,
    hotReload: _hotReload,
    ...portConfig
  } = definition;
  return portConfig;
}

export function getPrimaryPort(portInfo: PortInfo | undefined, fallbackPort: number): number {
  const address = portInfo?.server.address();
  if (address && typeof address === 'object' && typeof address.port === 'number') {
    return address.port;
  }

  return fallbackPort;
}

export async function startProxyListener(opts: {
  circuitBreakers: CircuitBreakerRegistry;
  definition: ProxyDefinition;
  logger: ScopedLogger;
  plugins: PluginRegistry;
  proxyId: string;
  resolveModel: (name: string) => ModelDefinition | undefined;
  stats: StatsTracker;
  store: Store;
  transformRegistry: TransformRegistry;
}): Promise<PortInfo> {
  const {
    circuitBreakers,
    definition,
    logger,
    plugins,
    proxyId,
    resolveModel,
    stats,
    store,
    transformRegistry,
  } = opts;
  const portStr = String(definition.port);
  const portConfig = buildPortConfig(definition);
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  app.use((req, res, next) => {
    const reqId = (req.headers['x-request-id'] as string) ?? ulid();
    (req as unknown as Record<string, unknown>).requestId = reqId;
    (req as unknown as Record<string, unknown>).port = portStr;
    (req as unknown as Record<string, unknown>).proxyId = proxyId;
    res.setHeader('X-Request-ID', reqId);
    res.setHeader('X-Prism-Version', '0.2.0');
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      port: portStr,
      proxyId,
      timestamp: new Date().toISOString(),
    });
  });

  if (portConfig.apiKeys && portConfig.apiKeys.length > 0) {
    app.use(createAuthMiddleware(portConfig.apiKeys));
  }

  let tenantManager: TenantManager | undefined;
  if (portConfig.tenants || portConfig.jwt || portConfig.oauth2) {
    tenantManager = new TenantManager({
      tenants: portConfig.tenants,
      jwt: portConfig.jwt,
      oauth2: portConfig.oauth2,
    });
  }

  const rpm = portConfig.rateLimitRpm ?? 60;
  const bucket = new TokenBucket({ capacity: rpm, refillRate: rpm / 60, store });
  app.use(createRateLimitMiddleware(bucket));

  let agentFactory: AgentFactory | undefined;
  if (portConfig.ipPool) {
    const ipPool = new IpPool(portConfig.ipPool);
    agentFactory = new AgentFactory({
      ipPool,
      keepAlive: true,
      maxSockets: 10,
    });
  }

  const pipeline = new PipelineEngine();
  pipeline.use(createLogMiddleware());
  pipeline.use(createTransformMiddleware(transformRegistry));

  for (const mw of plugins.allMiddleware()) {
    pipeline.use(mw.middleware);
  }

  const resolvedProviders: Record<string, ProviderConfig> = portConfig.providers ?? {};
  const resolvedRoutes = resolveRoutes(portConfig);
  const resolvedConfig: ResolvedConfig = {
    port: parseInt(portStr, 10),
    logLevel: 'info',
    requestTimeout: 120_000,
    providers: resolvedProviders,
    routes: resolvedRoutes,
  };

  app.get('/v1/models', (_req, res) => {
    const models = Object.entries(resolvedProviders).flatMap(([providerName, provider]) => {
      const providerModels = provider.models
        ? Object.keys(provider.models)
        : [provider.defaultModel ?? `${providerName}/default`];
      return providerModels.map((model) => ({
        id: model,
        object: 'model' as const,
        created: Math.floor(Date.now() / 1000),
        owned_by: providerName,
      }));
    });
    res.json({ object: 'list', data: models });
  });

  if (portConfig.admin) {
    const adminOpts: AdminRouteOptions =
      typeof portConfig.admin === 'object'
        ? portConfig.admin
        : {
            config: resolvedConfig,
            stats,
            tenantManager,
            circuitBreakers,
            pluginRegistry: plugins,
            getConfig: () => resolvedConfig,
          };

    if (portConfig.admin === true) {
      setupAdminRoutes(app, {
        config: resolvedConfig,
        stats,
        tenantManager,
        circuitBreakers,
        pluginRegistry: plugins,
        getConfig: () => resolvedConfig,
      });
    } else {
      setupAdminRoutes(app, adminOpts);
    }
  }

  registerFunctionRoutes({
    app,
    executeRoute: async (req, res, routePath, handler) => {
      await executeFunctionRoute({
        config: resolvedConfig,
        handler,
        port: portStr,
        req,
        res,
        routePath,
        runtime: {
          logger,
          proxyId,
          resolveModel,
          stats,
          store,
        },
      });
    },
    routes: portConfig.routes,
  });

  setupRoutes(app, {
    agentFactory,
    config: resolvedConfig,
    pipeline,
    port: portStr,
    proxyId,
    stats,
    store,
    transformRegistry,
  });

  app.use(errorHandler);

  const server = await new Promise<Server>((resolve, reject) => {
    try {
      const portNum = parseInt(portStr, 10);
      const srv = app.listen(portNum, () => {
        logger.info(`Proxy port ${portStr} listening`);
        resolve(srv);
      });
      srv.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });

  return {
    port: portStr,
    server,
    app,
    pipeline,
    agentFactory,
    tenantManager,
  };
}
