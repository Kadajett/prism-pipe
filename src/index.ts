#!/usr/bin/env node

import { runCli } from "./cli/index.js";

// Re-export all modules for library usage
export * from "./core/index.js";
export * from "./config/index.js";
export * from "./server/index.js";
export * from "./proxy/index.js";
export * from "./rate-limit/index.js";
export * from "./fallback/index.js";
export * from "./logging/index.js";
export * from "./store/index.js";
export * from "./middleware/index.js";

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("/index.ts") || process.argv[1].endsWith("/index.js"));

if (isDirectRun) {
  runCli();
}
