import type {
  CanonicalRequest,
  ProviderCapabilities,
  ContentBlock,
  ScopedLogger,
} from '../core/types.js';
import type { ProviderTransformer } from './transform-registry.js';

/**
 * Feature degradation wrapper for transformers.
 * When falling back to a provider that lacks features the request uses,
 * this wrapper gracefully degrades unsupported features.
 */
export class FeatureDegradationWrapper implements ProviderTransformer {
  constructor(
    private readonly wrapped: ProviderTransformer,
    private readonly logger: ScopedLogger
  ) {}

  get provider(): string {
    return this.wrapped.provider;
  }

  get capabilities(): ProviderCapabilities {
    return this.wrapped.capabilities;
  }

  toCanonical(raw: unknown): CanonicalRequest {
    return this.wrapped.toCanonical(raw);
  }

  responseToCanonical(raw: unknown) {
    return this.wrapped.responseToCanonical(raw);
  }

  responseFromCanonical(res: unknown) {
    return this.wrapped.responseFromCanonical(res);
  }

  streamChunkToCanonical(chunk: unknown) {
    return this.wrapped.streamChunkToCanonical(chunk);
  }

  streamChunkFromCanonical(chunk: unknown) {
    return this.wrapped.streamChunkFromCanonical(chunk);
  }

  /**
   * Transform canonical request to provider format with feature degradation.
   */
  fromCanonical(req: CanonicalRequest): unknown {
    const degradedRequest = this.degradeFeatures(req);
    return this.wrapped.fromCanonical(degradedRequest);
  }

  /**
   * Degrade unsupported features in a canonical request.
   */
  private degradeFeatures(req: CanonicalRequest): CanonicalRequest {
    const degraded = { ...req };
    const caps = this.capabilities;

    // Degrade tools → system prompt instructions
    if (req.tools && !caps.supportsTools) {
      this.logger.warn('Provider does not support tools, converting to system prompt', {
        provider: this.provider,
        toolCount: req.tools.length,
      });

      const toolInstructions = this.toolsToSystemPrompt(req.tools);
      degraded.systemPrompt = degraded.systemPrompt
        ? `${degraded.systemPrompt}\n\n${toolInstructions}`
        : toolInstructions;
      delete degraded.tools;
    }

    // Degrade vision → strip images and log warning
    if (!caps.supportsVision) {
      const strippedMessages = degraded.messages.map((msg) => {
        if (typeof msg.content === 'string') return msg;

        const content = msg.content as ContentBlock[];
        const hasImages = content.some((b) => b.type === 'image');
        if (!hasImages) return msg;

        this.logger.warn('Provider does not support vision, stripping images', {
          provider: this.provider,
          role: msg.role,
        });

        return {
          ...msg,
          content: content.filter((b) => b.type !== 'image'),
        };
      });
      degraded.messages = strippedMessages;
    }

    // Degrade thinking → add "think step by step" system prompt wrapper
    if (!caps.supportsThinking) {
      const hasThinking = req.messages.some(
        (msg) =>
          Array.isArray(msg.content) && msg.content.some((b: ContentBlock) => b.type === 'thinking')
      );

      if (hasThinking) {
        this.logger.warn(
          'Provider does not support thinking blocks, adding step-by-step instruction',
          { provider: this.provider }
        );

        const thinkingInstruction =
          'Think step by step and show your reasoning in your response.';
        degraded.systemPrompt = degraded.systemPrompt
          ? `${degraded.systemPrompt}\n\n${thinkingInstruction}`
          : thinkingInstruction;

        // Strip thinking blocks from messages
        degraded.messages = degraded.messages.map((msg) => {
          if (typeof msg.content === 'string') return msg;

          return {
            ...msg,
            content: (msg.content as ContentBlock[]).filter((b) => b.type !== 'thinking'),
          };
        });
      }
    }

    // Degrade system prompt → inject as first user message
    if (req.systemPrompt && !caps.supportsSystemPrompt) {
      this.logger.warn('Provider does not support system prompts, converting to user message', {
        provider: this.provider,
      });

      degraded.messages = [
        { role: 'user', content: `System instructions: ${req.systemPrompt}` },
        ...degraded.messages,
      ];
      delete degraded.systemPrompt;
    }

    return degraded;
  }

  /**
   * Convert tool definitions to system prompt instructions.
   */
  private toolsToSystemPrompt(tools: CanonicalRequest['tools']): string {
    if (!tools || tools.length === 0) return '';

    const toolDescriptions = tools
      .map((t) => {
        const schema = JSON.stringify(t.inputSchema, null, 2);
        return `**${t.name}**: ${t.description}\nInput schema:\n\`\`\`json\n${schema}\n\`\`\``;
      })
      .join('\n\n');

    return `# Available Tools

You have access to the following tools. To use a tool, respond with a JSON object containing "tool_use" field:

${toolDescriptions}

Example tool use:
\`\`\`json
{
  "tool_use": {
    "name": "tool_name",
    "input": { "param": "value" }
  }
}
\`\`\``;
  }
}

/**
 * Wrap a transformer with feature degradation support.
 */
export function withFeatureDegradation(
  transformer: ProviderTransformer,
  logger: ScopedLogger
): ProviderTransformer {
  return new FeatureDegradationWrapper(transformer, logger);
}
