import type {
  CanonicalRequest,
  CanonicalResponse,
  ContentBlock,
  ToolDefinition,
  ScopedLogger,
} from '../core/types.js';
import { PipelineError } from '../core/types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Tool handler configuration: either a provider call or a local function.
 */
export interface ToolHandler {
  /** Provider string (e.g., "perplexity/sonar") for routing to another model */
  provider?: string;
  /** Local handler function path (e.g., "./tools/sandbox.ts") */
  handler?: string;
}

/**
 * Tool router composer configuration.
 */
export interface ToolRouterConfig {
  /** Primary model that handles conversation and initiates tool calls */
  primary: string;
  /** Maximum tool call rounds before stopping (prevents infinite loops) */
  maxRounds?: number;
  /** Map of tool names to their handlers */
  tools: Record<string, ToolHandler>;
}

/**
 * Tool router composer: Primary model handles conversation, but tool calls route
 * to specialized backends. Results are fed back to primary model for final response.
 * Supports multi-turn tool use with configurable max rounds.
 */
export class ToolRouterComposer {
  private readonly config: Required<ToolRouterConfig>;

  constructor(
    config: ToolRouterConfig,
    private readonly logger: ScopedLogger
  ) {
    this.config = {
      ...config,
      maxRounds: config.maxRounds ?? 5,
    };
  }

  /**
   * Execute the tool routing composition.
   * @param request Original canonical request
   * @param providerCall Function to call a provider with a request
   * @returns Final canonical response after all tool rounds
   */
  async execute(
    request: CanonicalRequest,
    providerCall: (provider: string, req: CanonicalRequest) => Promise<CanonicalResponse>
  ): Promise<CanonicalResponse> {
    let currentRequest = { ...request };
    let round = 0;

    this.logger.info('Tool router starting', {
      primary: this.config.primary,
      maxRounds: this.config.maxRounds,
      toolsConfigured: Object.keys(this.config.tools).length,
    });

    while (round < this.config.maxRounds) {
      round++;
      this.logger.debug(`Tool router round ${round}/${this.config.maxRounds}`);

      // Call primary model
      const response = await providerCall(this.config.primary, currentRequest);

      // Check if there are tool calls in the response
      const toolCalls = response.content.filter((b) => b.type === 'tool_use');

      if (toolCalls.length === 0) {
        // No more tool calls, return final response
        this.logger.info('Tool router completed', {
          rounds: round,
          stopReason: response.stopReason,
        });
        return response;
      }

      this.logger.debug('Processing tool calls', { count: toolCalls.length });

      // Execute tool calls
      const toolResults: ContentBlock[] = [];
      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'tool_use') continue;

        const handler = this.config.tools[toolCall.name];
        if (!handler) {
          this.logger.warn('No handler configured for tool', { tool: toolCall.name });
          toolResults.push({
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: JSON.stringify({ error: `No handler configured for tool: ${toolCall.name}` }),
            isError: true,
          });
          continue;
        }

        try {
          const result = await this.executeToolCall(toolCall, handler, providerCall);
          toolResults.push({
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        } catch (error) {
          this.logger.error('Tool execution failed', {
            tool: toolCall.name,
            error: error instanceof Error ? error.message : String(error),
          });
          toolResults.push({
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
            isError: true,
          });
        }
      }

      // Add assistant message with tool calls and tool results to messages
      currentRequest = {
        ...currentRequest,
        messages: [
          ...currentRequest.messages,
          { role: 'assistant', content: response.content },
          { role: 'tool', content: toolResults },
        ],
      };
    }

    throw new PipelineError(
      `Tool router exceeded max rounds: ${this.config.maxRounds}`,
      'invalid_request',
      'tool-router',
      400,
      false
    );
  }

  /**
   * Validate that a handler path is safe to import.
   * Restricts to relative paths starting with ./ or ../ to prevent arbitrary code execution.
   * @param handlerPath The handler path from configuration
   * @throws {PipelineError} If the path is invalid or unsafe
   */
  private validateHandlerPath(handlerPath: string): void {
    // Must be a relative path starting with ./ or ../
    if (!handlerPath.startsWith('./') && !handlerPath.startsWith('../')) {
      throw new PipelineError(
        `Handler path must be a relative path starting with ./ or ../: ${handlerPath}`,
        'invalid_request',
        'tool-router',
        500,
        false
      );
    }

    // Prevent path traversal attacks - resolve and check it stays within workspace
    const resolvedPath = path.resolve(process.cwd(), handlerPath);
    const workspaceRoot = process.cwd();

    if (!resolvedPath.startsWith(workspaceRoot)) {
      throw new PipelineError(
        `Handler path escapes workspace directory: ${handlerPath}`,
        'invalid_request',
        'tool-router',
        500,
        false
      );
    }

    this.logger.debug('Handler path validated', {
      handlerPath,
      resolvedPath,
    });
  }

  /**
   * Execute a single tool call.
   */
  private async executeToolCall(
    toolCall: ContentBlock & { type: 'tool_use' },
    handler: ToolHandler,
    providerCall: (provider: string, req: CanonicalRequest) => Promise<CanonicalResponse>
  ): Promise<unknown> {
    if (handler.provider) {
      // Route to another provider
      this.logger.debug('Routing tool call to provider', {
        tool: toolCall.name,
        provider: handler.provider,
      });

      // Create a request for the provider with the tool input as context
      const toolRequest: CanonicalRequest = {
        model: handler.provider,
        messages: [
          {
            role: 'user',
            content: `Execute ${toolCall.name} with input: ${JSON.stringify(toolCall.input)}`,
          },
        ],
      };

      const response = await providerCall(handler.provider, toolRequest);
      const textContent = response.content.filter((b) => b.type === 'text');
      return textContent.map((b) => (b as { text: string }).text).join('\n');
    }

    if (handler.handler) {
      // Validate handler path before importing
      this.validateHandlerPath(handler.handler);

      // Load and execute local handler
      this.logger.debug('Executing local handler', {
        tool: toolCall.name,
        handler: handler.handler,
      });

      // Dynamic import of the handler (path validated above)
      const handlerModule = await import(handler.handler);
      const handlerFn = handlerModule.default || handlerModule[toolCall.name];

      if (typeof handlerFn !== 'function') {
        throw new PipelineError(
          `Handler module does not export a function: ${handler.handler}`,
          'invalid_request',
          'tool-router',
          500,
          false
        );
      }

      return await handlerFn(toolCall.input);
    }

    throw new PipelineError(
      'Tool handler must specify either provider or handler',
      'invalid_request',
      'tool-router',
      500,
      false
    );
  }

  /**
   * Get tool definitions for the configured tools.
   * This should be added to the initial request to the primary model.
   */
  getToolDefinitions(): ToolDefinition[] {
    return Object.keys(this.config.tools).map((name) => ({
      name,
      description: `Tool: ${name}`,
      inputSchema: {
        type: 'object',
        properties: {},
      },
    }));
  }
}
