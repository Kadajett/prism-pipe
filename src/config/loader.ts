import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import parseArgs from "minimist";
import { parse as parseYaml } from "yaml";
import { getDefaults } from "./defaults.js";
import { type ResolvedConfig, validateConfig } from "./schema.js";

// ── File discovery ──

const CONFIG_NAMES = ["prism-pipe.yaml", "prism-pipe.yml", "prism-pipe.json", "prism-pipe.toml"];

/**
 * Find the first config file in CWD, then fall back to ~/.prism-pipe/.
 */
export function findConfigFile(cwd = process.cwd()): string | null {
  for (const name of CONFIG_NAMES) {
    const local = resolve(cwd, name);
    if (existsSync(local)) return local;
  }
  const homeDir = join(homedir(), ".prism-pipe");
  for (const name of CONFIG_NAMES) {
    const global = join(homeDir, name);
    if (existsSync(global)) return global;
  }
  return null;
}

// ── ENV interpolation in YAML values ──

/**
 * Recursively resolve `${VAR_NAME}` placeholders in string values.
 */
export function interpolateEnv(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      const val = process.env[key.trim()];
      if (val === undefined) {
        throw new Error(`Environment variable "${key.trim()}" referenced in config but not set`);
      }
      return val;
    });
  }
  if (Array.isArray(obj)) return obj.map(interpolateEnv);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = interpolateEnv(v);
    }
    return out;
  }
  return obj;
}

// ── ENV overrides (PRISM_ prefix) ──

/**
 * Flatten PRISM_ env vars into a nested object.
 * PRISM_SERVER_PORT=4000 → { server: { port: 4000 } }
 */
export function envOverrides(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const prefix = "PRISM_";

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;
    const path = key.slice(prefix.length).toLowerCase().split("_");

    let current = result;
    for (let i = 0; i < path.length - 1; i++) {
      current[path[i]] = current[path[i]] ?? {};
      current = current[path[i]] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = coerce(value);
  }

  return result;
}

function coerce(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  const n = Number(val);
  if (!Number.isNaN(n) && val.trim() !== "") return n;
  return val;
}

// ── CLI flag overrides ──

/**
 * Parse CLI argv into a nested config object.
 * --server.port 4000 → { server: { port: 4000 } }
 * --port 4000 → { port: 4000 } (flat alias)
 */
export function cliOverrides(argv: string[] = process.argv.slice(2)): Record<string, unknown> {
  const args = parseArgs(argv, { string: ["_"] });
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (key === "_") continue;
    const path = key.split(".");
    let current = result;
    for (let i = 0; i < path.length - 1; i++) {
      current[path[i]] = current[path[i]] ?? {};
      current = current[path[i]] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = value;
  }

  return result;
}

// ── Deep merge ──

export function deepMerge(
  target: Record<string, unknown>,
  ...sources: Record<string, unknown>[]
): Record<string, unknown> {
  for (const source of sources) {
    for (const [key, val] of Object.entries(source)) {
      if (
        val !== null &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        typeof target[key] === "object" &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        target[key] = deepMerge(
          { ...(target[key] as Record<string, unknown>) },
          val as Record<string, unknown>,
        );
      } else {
        target[key] = val;
      }
    }
  }
  return target;
}

// ── File loading ──

function loadFile(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, "utf-8");
  if (filePath.endsWith(".json")) {
    return JSON.parse(content) as Record<string, unknown>;
  }
  // YAML handles .yaml/.yml
  return (parseYaml(content) ?? {}) as Record<string, unknown>;
}

// ── Main resolver ──

export interface LoadOptions {
  /** Override CWD for config file search */
  cwd?: string;
  /** Explicit config file path (skips discovery) */
  configFile?: string;
  /** CLI argv (defaults to process.argv) */
  argv?: string[];
}

/**
 * Load, merge, validate, and freeze configuration.
 * Priority: defaults → YAML file → ENV vars → CLI flags
 */
export function resolveConfig(options: LoadOptions = {}): ResolvedConfig {
  // 1. Defaults
  const defaults = getDefaults() as Record<string, unknown>;

  // 2. YAML file
  const file = options.configFile ?? findConfigFile(options.cwd);
  let fileConfig: Record<string, unknown> = {};
  if (file) {
    fileConfig = loadFile(file);
    fileConfig = interpolateEnv(fileConfig) as Record<string, unknown>;
  }

  // 3. ENV overrides (PRISM_ prefix)
  const envConfig = envOverrides();

  // 4. CLI overrides
  const cliConfig = cliOverrides(options.argv ?? []);

  // Merge: defaults < file < env < cli
  const merged = deepMerge({}, defaults, fileConfig, envConfig, cliConfig);

  // Validate + freeze
  return validateConfig(merged);
}
