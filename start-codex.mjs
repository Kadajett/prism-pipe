/**
 * Prism Pipe + Codex CLI Bridge — Compose Chains + PTY Streaming
 * 
 * Uses node-pty to run codex in a pseudo-terminal, capturing real-time
 * terminal output as thinking steps. When stream=true, these are forwarded
 * as SSE delta chunks to the caller.
 * 
 * COMPOSE CHAINS:
 * Every agent request spawns 2 competing codex calls in parallel.
 * A reviewer step synthesizes their outputs into a final response.
 */

import { PrismPipe } from './dist/lib.js';
import { spawn as spawnChild } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PORT = parseInt(process.env.PORT || '3100', 10);
const CODEX_PATH = process.env.CODEX_PATH || 'codex';
const DEFAULT_MODEL = process.env.CODEX_MODEL || 'gpt-5.4';

// ─── Codex PTY bridge ───────────────────────────────────────────────────────

/**
 * Run codex exec in a PTY. Captures terminal output line-by-line.
 * onData(text) fires for every chunk of terminal output — real-time.
 * Returns the full output text when done.
 */
/**
 * Run codex exec with --json via pipes (handles long prompts reliably),
 * then call onData with the final text split line-by-line.
 * Also emits status updates by parsing JSON events in real-time.
 */
function codexExecStreaming(prompt, model, label = '', onData = () => {}) {
  return new Promise((resolve, reject) => {
    const startMs = Date.now();
    const args = ['exec', '--ephemeral', '--json', '-m', model, '--skip-git-repo-check', '-'];
    const proc = spawnChild(CODEX_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 300_000,
    });

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';

    proc.stdout.on('data', (chunk) => {
      const str = chunk.toString();
      stdout += str;
      lineBuffer += str;

      // Parse JSON events in real-time for status updates
      let nlIdx;
      while ((nlIdx = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, nlIdx).trim();
        lineBuffer = lineBuffer.slice(nlIdx + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          // Emit reasoning summaries as they arrive
          if (ev.type === 'item.completed' && ev.item?.type === 'reasoning_summary') {
            const text = ev.item.text || ev.item.summary || '';
            if (text) onData(`💭 ${text}\n`);
          }
          // Emit tool calls (web searches, file reads, etc)
          if (ev.type === 'item.completed' && ev.item?.type === 'tool_call') {
            const name = ev.item.name || ev.item.tool || '';
            const args = ev.item.arguments ? JSON.stringify(ev.item.arguments).slice(0, 100) : '';
            if (name) onData(`🔧 ${name} ${args}\n`);
          }
          // Emit function call outputs
          if (ev.type === 'item.completed' && ev.item?.type === 'function_call_output') {
            // Skip — too verbose
          }
        } catch { /* not JSON */ }
      }
    });

    proc.stderr.on('data', (c) => { stderr += c; });

    proc.on('close', (code) => {
      const elapsed = Date.now() - startMs;
      if (code !== 0 && !stdout) {
        console.error(`[codex:${label}] ✗ failed after ${elapsed}ms: ${stderr.slice(0, 200)}`);
        reject(new Error(`codex exec failed (${code}): ${stderr.slice(0, 500)}`));
        return;
      }

      let text = '';
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      for (const line of stdout.split('\n').filter(Boolean)) {
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
            text = ev.item.text || '';
          }
          if (ev.type === 'turn.completed' && ev.usage) {
            usage = {
              prompt_tokens: ev.usage.input_tokens || 0,
              completion_tokens: ev.usage.output_tokens || 0,
              total_tokens: (ev.usage.input_tokens || 0) + (ev.usage.output_tokens || 0),
            };
          }
        } catch { /* skip */ }
      }

      // Emit the final response line-by-line for streaming UX
      if (text) {
        for (const line of text.split('\n')) {
          if (line.trim()) onData(line + '\n');
        }
      }

      console.log(`[codex:${label}] ✓ ${usage.total_tokens} tokens in ${elapsed}ms (${text.length} chars)`);
      resolve({ text, usage, elapsed, label });
    });

    proc.on('error', reject);
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function messagesToPrompt(messages) {
  const sys = [];
  const conv = [];
  for (const m of messages) {
    if (m.role === 'system') sys.push(m.content);
    else if (m.role === 'user') conv.push(m.content);
    else if (m.role === 'assistant') conv.push(`[Assistant: ${m.content}]`);
  }
  let prompt = '';
  if (sys.length) prompt = `[System: ${sys.join('\n')}]\n\n`;
  prompt += conv.join('\n');
  return prompt;
}

// ─── Compose chain ─────────────────────────────────────────────────────────

async function composeChain(messages, model, onData = null) {
  const chainId = randomUUID().slice(0, 8);
  const prompt = messagesToPrompt(messages);
  const systemPrompt = messages.find(m => m.role === 'system')?.content || '';

  console.log(`\n[chain:${chainId}] ═══ COMPOSE START ═══`);
  console.log(`[chain:${chainId}] Model: ${model} | Prompt: ${prompt.slice(0, 100)}...`);
  console.log(`[chain:${chainId}] Step 1: Spawning Analyst-A and Analyst-B in parallel...`);

  if (onData) onData(`⚡ Analyst-A and Analyst-B working in parallel...\n`);

  // Split PTY output into individual lines for granular streaming
  const lineEmitter = (text) => {
    if (!onData) return;
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim()) onData(line + '\n');
    }
  };

  // Step 1: Two analysts — A streams via PTY, B runs quiet
  const [resultA, resultB] = await Promise.allSettled([
    codexExecStreaming(prompt, model, `${chainId}:analyst-A`, lineEmitter),
    codexExecStreaming(prompt, model, `${chainId}:analyst-B`),
  ]);

  const analystA = resultA.status === 'fulfilled' ? resultA.value : null;
  const analystB = resultB.status === 'fulfilled' ? resultB.value : null;

  if (!analystA && !analystB) throw new Error('Both analysts failed');

  if (!analystA || !analystB) {
    const survivor = analystA || analystB;
    console.log(`[chain:${chainId}] ⚠ One analyst failed, using survivor`);
    console.log(`[chain:${chainId}] ═══ COMPOSE END (degraded) ═══\n`);
    return { text: survivor.text, usage: survivor.usage };
  }

  console.log(`[chain:${chainId}] Analyst-A: ${analystA.text.length} chars in ${analystA.elapsed}ms`);
  console.log(`[chain:${chainId}] Analyst-B: ${analystB.text.length} chars in ${analystB.elapsed}ms`);

  // Step 2: Reviewer
  console.log(`[chain:${chainId}] Step 2: Reviewer synthesizing...`);
  if (onData) onData(`\n⚡ Reviewer synthesizing both analyses...\n`);

  const reviewerPrompt = `You are a senior reviewer synthesizing two independent analyses of the same security question.

Your job:
1. Compare both analyses for completeness, accuracy, and insight
2. Identify findings that appear in BOTH (high confidence — corroborated)
3. Identify unique findings from each (flag as single-source, needs verification)
4. Resolve any contradictions
5. Produce a SINGLE comprehensive response

Mark corroborated findings with [CORROBORATED] and single-source with [SINGLE-SOURCE].

${systemPrompt ? `\nOriginal system context:\n${systemPrompt}\n` : ''}
═══ ANALYST A OUTPUT ═══
${analystA.text}

═══ ANALYST B OUTPUT ═══
${analystB.text}

═══ YOUR SYNTHESIZED RESPONSE ═══`;

  const reviewerLineEmitter = (text) => {
    if (!onData) return;
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim()) onData(line + '\n');
    }
  };

  const reviewerResult = await codexExecStreaming(reviewerPrompt, model, `${chainId}:reviewer`, reviewerLineEmitter);

  const totalUsage = mergeUsage(analystA.usage, analystB.usage, reviewerResult.usage);

  console.log(`[chain:${chainId}] Reviewer: ${reviewerResult.text.length} chars in ${reviewerResult.elapsed}ms`);
  console.log(`[chain:${chainId}] Total: ${totalUsage.total_tokens} tokens`);
  console.log(`[chain:${chainId}] ═══ COMPOSE END ═══\n`);

  return { text: reviewerResult.text, usage: totalUsage };
}

function mergeUsage(...usages) {
  return usages.filter(Boolean).reduce((acc, u) => ({
    prompt_tokens: acc.prompt_tokens + (u.prompt_tokens || 0),
    completion_tokens: acc.completion_tokens + (u.completion_tokens || 0),
    total_tokens: acc.total_tokens + (u.total_tokens || 0),
  }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

// ─── SSE helpers ────────────────────────────────────────────────────────────

function sseChunk(content, model, id) {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

function sseDone(model, id, usage) {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage,
  })}\n\ndata: [DONE]\n\n`;
}

// ─── Route handler ──────────────────────────────────────────────────────────

async function codexHandler(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { messages, model, stream } = body;

  if (!messages || !Array.isArray(messages)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'messages array required' } }));
    return;
  }

  const effectiveModel = model || DEFAULT_MODEL;
  const preview = messages[messages.length - 1]?.content?.slice(0, 80) || '';
  const completionId = `chatcmpl-codex-${randomUUID()}`;

  console.log(`[prism] ${effectiveModel} | ${messages.length} msgs | stream=${!!stream} | ${preview}...`);

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Initial role chunk
    res.write(`data: ${JSON.stringify({
      id: completionId, object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000), model: effectiveModel,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    })}\n\n`);

    try {
      // Queue chunks and drip them out with small delays for streaming UX
      let dripping = false;
      const chunkQueue = [];

      const drip = () => {
        if (dripping) return;
        dripping = true;
        const flush = () => {
          if (chunkQueue.length === 0) { dripping = false; return; }
          const c = chunkQueue.shift();
          try { res.write(sseChunk(c, effectiveModel, completionId)); } catch {}
          setTimeout(flush, 30);  // 30ms per line — feels like typing
        };
        flush();
      };

      const { text, usage } = await composeChain(messages, effectiveModel, (chunk) => {
        if (chunk) {
          chunkQueue.push(chunk);
          drip();
        }
      });

      // Wait for queue to drain before closing
      await new Promise((resolve) => {
        const waitDrain = () => {
          if (chunkQueue.length === 0) { resolve(); return; }
          setTimeout(waitDrain, 50);
        };
        waitDrain();
      });

      res.write(sseDone(effectiveModel, completionId, usage));
      res.end();
    } catch (err) {
      console.error(`[prism] ✗ ${err.message}`);
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.end();
    }
  } else {
    try {
      const { text, usage } = await composeChain(messages, effectiveModel);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: completionId, object: 'chat.completion',
        created: Math.floor(Date.now() / 1000), model: effectiveModel,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage,
      }));
    } catch (err) {
      console.error(`[prism] ✗ ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message, code: 'codex_error' } }));
    }
  }
}

// ─── Start ──────────────────────────────────────────────────────────────────

const prism = new PrismPipe({ logLevel: 'info', storeType: 'sqlite' });

prism.createProxy({
  id: 'codex-bridge',
  port: PORT,
  providers: {},
  routes: { '/v1/chat/completions': codexHandler },
});

prism.onError((event) => {
  console.error(`[prism] ${event.errorClass}: ${event.error.message}`);
});

await prism.start();

console.log(`\n  🔷 Prism Pipe (Codex CLI Bridge + PTY Streaming)`);
console.log(`  ├─ Port:     ${PORT}`);
console.log(`  ├─ Backend:  codex exec via node-pty (real terminal output)`);
console.log(`  ├─ Model:    ${DEFAULT_MODEL}`);
console.log(`  ├─ Chain:    Analyst-A (PTY) ∥ Analyst-B (quiet) → Reviewer (PTY)`);
console.log(`  ├─ Stream:   SSE with live PTY output`);
console.log(`  ├─ Store:    SQLite (request logging)`);
console.log(`  └─ Auth:     ~/.codex/auth.json (OAuth)\n`);
