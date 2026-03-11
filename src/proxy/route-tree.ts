import type { Express, Request, Response } from 'express';
import type {
  ComposeConfig,
  PortConfig,
  RouteConfig,
  RouteConfigObject,
  RouteHandler,
} from '../core/types';

export function resolveRoutes(portConfig: PortConfig): RouteConfig[] {
  const routes: RouteConfig[] = [];

  const visitRoute = (
    basePath: string,
    path: string,
    value: RouteConfigObject | RouteHandler
  ): void => {
    const fullPath = joinRoutePath(basePath, path);
    if (typeof value === 'function') {
      return;
    }

    if (isRouteLeaf(value)) {
      const route: RouteConfig = {
        path: fullPath,
        providers: value.providers ?? [],
        systemPrompt: value.systemPrompt,
      };

      if (value.compose) {
        route.compose = value.compose as ComposeConfig;
      }

      routes.push(route);
    }

    if (!value.routes) {
      return;
    }

    for (const [nestedPath, nestedValue] of Object.entries(value.routes)) {
      visitRoute(fullPath, nestedPath, nestedValue);
    }
  };

  for (const [path, value] of Object.entries(portConfig.routes)) {
    visitRoute('', path, value);
  }

  if (routes.length === 0 && portConfig.providers) {
    routes.push({
      path: '/v1/chat/completions',
      providers: Object.keys(portConfig.providers),
      pipeline: ['log-request', 'transform-format'],
    });
  }

  return routes;
}

export function registerFunctionRoutes(opts: {
  app: Express;
  basePath?: string;
  executeRoute: (
    req: Request,
    res: Response,
    routePath: string,
    handler: RouteHandler
  ) => Promise<void>;
  routes: Record<string, RouteHandler | RouteConfigObject>;
}): void {
  const { app, executeRoute, routes } = opts;
  const basePath = opts.basePath ?? '';

  for (const [path, value] of Object.entries(routes)) {
    const fullPath = joinRoutePath(basePath, path);
    if (typeof value === 'function') {
      app.all(fullPath, async (req, res) => {
        await executeRoute(req, res, fullPath, value);
      });
      continue;
    }

    if (!value.routes) {
      continue;
    }

    registerFunctionRoutes({
      app,
      basePath: fullPath,
      executeRoute,
      routes: value.routes,
    });
  }
}

function isRouteLeaf(value: RouteConfigObject): boolean {
  return (
    value.providers !== undefined ||
    value.compose !== undefined ||
    value.systemPrompt !== undefined ||
    value.middleware !== undefined ||
    value.circuitBreaker !== undefined ||
    value.retry !== undefined ||
    value.degradation !== undefined ||
    !value.routes
  );
}

function joinRoutePath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!basePath) {
    return normalizedPath;
  }

  return `${basePath.replace(/\/$/, '')}${normalizedPath}`;
}
