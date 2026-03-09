/**
 * YAML + ENV config loading
 */

import { defaultConfig } from "./defaults"
import type { Config } from "./schema"

export async function loadConfig(_configPath?: string): Promise<Config> {
  // TODO: Implement YAML loading from file
  // TODO: Implement ENV variable overrides
  throw new Error("Not implemented")
}

export function getDefaultConfig(): Config {
  return JSON.parse(JSON.stringify(defaultConfig))
}
