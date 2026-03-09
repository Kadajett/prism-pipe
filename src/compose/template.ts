/**
 * Template resolution for composition step inputs.
 *
 * Supports:
 *   {{steps.<name>.content}}    — content from a named step
 *   {{original.lastUserMessage}} — last user message from original request
 *   {{original.systemPrompt}}   — system prompt from original request
 *   {{previous.content}}        — content from the immediately previous step
 */

import type { CanonicalRequest, ContentBlock } from '../core/types';
import type { StepResult } from '../core/composer';

export interface TemplateContext {
  original: CanonicalRequest;
  steps: Map<string, StepResult>;
  previous?: StepResult;
}

/** Extract text content from content blocks */
function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Get the last user message text from a canonical request */
function getLastUserMessage(req: CanonicalRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === 'user') {
      return extractText(req.messages[i].content);
    }
  }
  return '';
}

/** Resolve a dot-path reference against the template context */
function resolveRef(path: string, tplCtx: TemplateContext): string {
  const parts = path.split('.');

  if (parts[0] === 'steps' && parts.length >= 3) {
    const stepName = parts[1];
    const field = parts.slice(2).join('.');
    const step = tplCtx.steps.get(stepName);
    if (!step) return `{{steps.${stepName}.${field}}}`;
    if (field === 'content') return step.content;
    if (field === 'provider') return step.provider;
    if (field === 'name') return step.name;
    if (field === 'status') return step.status;
    return '';
  }

  if (parts[0] === 'original') {
    const field = parts.slice(1).join('.');
    if (field === 'lastUserMessage') return getLastUserMessage(tplCtx.original);
    if (field === 'systemPrompt') return tplCtx.original.systemPrompt ?? '';
    if (field === 'model') return tplCtx.original.model;
    return '';
  }

  if (parts[0] === 'previous') {
    if (!tplCtx.previous) return '';
    const field = parts.slice(1).join('.');
    if (field === 'content') return tplCtx.previous.content;
    if (field === 'provider') return tplCtx.previous.provider;
    if (field === 'name') return tplCtx.previous.name;
    return '';
  }

  return `{{${path}}}`;
}

const TEMPLATE_RE = /\{\{([^}]+)\}\}/g;

/**
 * Resolve all {{...}} references in a template string.
 */
export function resolveTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(TEMPLATE_RE, (_, ref: string) => resolveRef(ref.trim(), ctx));
}
