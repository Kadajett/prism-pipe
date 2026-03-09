import type { PipelineContext } from "../core/context.js";

/** Log a completed request to the store (SQLite). */
export async function logRequest(_ctx: PipelineContext): Promise<void> {
  // TODO: implement request logging to SQLite
  throw new Error("Not implemented");
}
