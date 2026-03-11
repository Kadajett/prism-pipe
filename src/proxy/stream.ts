import type { Response as ExpressResponse } from 'express';
import type { CanonicalStreamChunk, UsageInfo } from '../core/types';
import type { ProviderTransformer } from './transform-registry';

/**
 * Writes canonical stream chunks as SSE events to an Express response.
 */
export async function writeSSEStream(
  res: ExpressResponse,
  chunks: AsyncIterableIterator<CanonicalStreamChunk>,
  transformer: ProviderTransformer
): Promise<UsageInfo | undefined> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let finalUsage: UsageInfo | undefined;

  for await (const chunk of chunks) {
    if (chunk.type === 'usage' && chunk.usage) {
      finalUsage = chunk.usage;
    }

    if (chunk.type === 'done') {
      if (transformer.provider === 'anthropic') {
        res.write('event: message_stop\ndata: {}\n\n');
      } else {
        res.write('data: [DONE]\n\n');
      }
      break;
    }

    if (chunk.type === 'error') {
      const errorData = JSON.stringify({ error: chunk.error });
      res.write(`event: error\ndata: ${errorData}\n\n`);
      break;
    }

    const serialized = transformer.streamChunkFromCanonical(chunk);
    if (serialized != null) {
      if (typeof serialized === 'string') {
        res.write(`data: ${serialized}\n\n`);
      } else {
        const json = JSON.stringify(serialized);
        if (transformer.provider === 'anthropic') {
          const eventType = (serialized as Record<string, unknown>).type ?? 'content_block_delta';
          res.write(`event: ${eventType}\ndata: ${json}\n\n`);
        } else {
          res.write(`data: ${json}\n\n`);
        }
      }
    }
  }

  res.end();
  return finalUsage;
}

/**
 * Parse raw SSE text into individual events.
 */
export function* parseSSEText(text: string): Generator<{ event?: string; data: string }> {
  const blocks = text.split('\n\n');
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event: string | undefined;
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) data += line.slice(6);
      else if (line.startsWith(':')) continue; // comment
    }
    if (data) yield { event, data };
  }
}
