/**
 * AgentFactory: create http.Agent / https.Agent bound to specific local addresses
 * for multi-IP egress. Supports SOCKS5 and HTTP CONNECT proxies.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import type { IpPool } from './ip-pool.js';

export interface AgentFactoryOptions {
  ipPool: IpPool;
  /** Keep-alive for outbound connections. Default: true */
  keepAlive?: boolean;
  /** Max sockets per host. Default: 10 */
  maxSockets?: number;
}

/**
 * Creates HTTP(S) agents bound to specific local addresses from the IP pool.
 * Falls back to a default agent when no IP is selected.
 */
export class AgentFactory {
  private readonly ipPool: IpPool;
  private readonly keepAlive: boolean;
  private readonly maxSockets: number;
  private readonly agentCache = new Map<string, http.Agent | https.Agent>();

  constructor(opts: AgentFactoryOptions) {
    this.ipPool = opts.ipPool;
    this.keepAlive = opts.keepAlive ?? true;
    this.maxSockets = opts.maxSockets ?? 10;
  }

  /**
   * Get an HTTP agent for the given provider, optionally bound to a local address.
   * Returns undefined if no special agent is needed (no IPs configured).
   */
  getAgent(provider?: string, secure = true): http.Agent | https.Agent | undefined {
    const ip = this.ipPool.selectIp(provider);
    if (!ip) return undefined;

    const cacheKey = `${ip.address}:${secure ? 'https' : 'http'}`;
    const cached = this.agentCache.get(cacheKey);
    if (cached) return cached;

    const opts = {
      localAddress: ip.address,
      keepAlive: this.keepAlive,
      maxSockets: this.maxSockets,
    };

    const agent = secure ? new https.Agent(opts) : new http.Agent(opts);
    this.agentCache.set(cacheKey, agent);
    return agent;
  }

  /**
   * Get the proxy URL for a provider, if configured.
   */
  getProxyUrl(provider?: string): string | undefined {
    return this.ipPool.selectProxy(provider);
  }

  /**
   * Destroy all cached agents (for cleanup/shutdown).
   */
  destroy(): void {
    for (const agent of this.agentCache.values()) {
      agent.destroy();
    }
    this.agentCache.clear();
  }
}
