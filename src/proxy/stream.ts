import type { Response } from "express";
import type { StreamChunk } from "../core/types.js";

/** Write an SSE event to the response stream. */
export function writeSSE(_res: Response, _chunk: StreamChunk): void {
  // TODO: implement SSE streaming
  throw new Error("Not implemented");
}

/** End an SSE stream with the [DONE] sentinel. */
export function endSSE(_res: Response): void {
  // TODO: implement SSE stream termination
  throw new Error("Not implemented");
}

/** Set up response headers for SSE streaming. */
export function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}
