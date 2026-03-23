/**
 * Codex CLI Bridge for Prism Pipe
 * 
 * Wraps `codex exec` as an OpenAI-compatible chat completions endpoint.
 * Uses the Codex CLI's OAuth auth (Max plan = $0/token).
 * 
 * Usage: Import and register as a function route in Prism Pipe.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CODEX_PATH = process.env.CODEX_PATH || 'codex';
const DEFAULT_MODEL = process.env.CODEX_MODEL || 'gpt-5.4';

/**
 * Run a prompt through `codex exec --ephemeral --json` and return
 * an OpenAI chat completions-shaped response.
 */
export async function codexComplete(messages, { model, temperature, max_tokens } = {}) {
  const effectiveModel = model || DEFAULT_MODEL;

  // Build the prompt from messages array (chat completions format)
  let prompt = '';
  const systemParts = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else if (msg.role === 'user') {
      prompt += `${msg.content}\n`;
    } else if (msg.role === 'assistant') {
      prompt += `[Previous assistant response: ${msg.content}]\n`;
    }
  }

  // Prepend system prompt if any
  if (systemParts.length) {
    prompt = `[System instructions: ${systemParts.join('\n')}]\n\n${prompt}`;
  }

  const args = [
    'exec',
    '--ephemeral',
    '--json',
    '-m', effectiveModel,
    '--skip-git-repo-check',
    '-',  // read from stdin
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(CODEX_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 120_000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`codex exec failed (code ${code}): ${stderr}`));
        return;
      }

      // Parse JSONL output — find the last agent_message
      let responseText = '';
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      for (const line of stdout.split('\n').filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            responseText = event.item.text || '';
          }
          if (event.type === 'turn.completed' && event.usage) {
            usage = {
              prompt_tokens: event.usage.input_tokens || 0,
              completion_tokens: event.usage.output_tokens || 0,
              total_tokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
            };
          }
        } catch { /* skip non-JSON lines */ }
      }

      // Return OpenAI chat completions format
      resolve({
        id: `chatcmpl-codex-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: effectiveModel,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: responseText },
          finish_reason: 'stop',
        }],
        usage,
      });
    });

    proc.on('error', reject);

    // Write prompt to stdin
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Express/Fastify-compatible route handler for Prism Pipe function routes.
 */
export async function codexRouteHandler(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { messages, model, temperature, max_tokens } = body;

    if (!messages || !Array.isArray(messages)) {
      res.statusCode = 400;
      res.json({ error: { message: 'messages array required', code: 'invalid_request' } });
      return;
    }

    const result = await codexComplete(messages, { model, temperature, max_tokens });
    res.json(result);
  } catch (err) {
    console.error('Codex bridge error:', err.message);
    res.statusCode = 502;
    res.json({ error: { message: err.message, code: 'codex_error' } });
  }
}
