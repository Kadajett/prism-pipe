# Prompt Guard Middleware

Heuristic-based prompt injection detection for PrismPipe. Scans incoming messages for known injection patterns, computes a threat score (0–1), and takes a configurable action.

## Quick Start

Add `promptGuard` to any route config in `prism-pipe.yaml`:

```yaml
routes:
  /v1/chat/completions:
    providers: [openai]
    promptGuard:
      action: block       # block | flag | sanitize | log
      threshold: 0.5      # score 0–1 to trigger action
```

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Toggle the guard on/off |
| `action` | `'block' \| 'flag' \| 'sanitize' \| 'log'` | `'block'` | What to do when threshold is exceeded |
| `threshold` | `number` (0–1) | `0.5` | Score above which the action triggers |
| `excludeRoles` | `string[]` | `['system', 'assistant']` | Message roles to skip scanning |
| `maxScanLength` | `number` | `10000` | Max characters to scan per message |
| `patterns` | `PatternRule[]` | `[]` | Custom patterns merged with built-ins |
| `onDetection` | `(result) => void` | — | Hook called on detection (programmatic API only) |

## Actions

- **`block`** — Throws `PipelineError` with code `content_filter` (HTTP 400). Request is rejected.
- **`flag`** — Sets `ctx.metadata` fields (`promptGuard.flagged`, `promptGuard.score`, `promptGuard.matches`) and continues. Downstream middleware/handlers can inspect these.
- **`sanitize`** — Strips **all** occurrences of matched patterns from message text (global regex replacement) and continues. Sets `promptGuard.sanitized` metadata.
- **`log`** — Logs a warning with score/matches and continues unchanged.

## Pattern Categories

The built-in engine includes ~22 patterns across 5 categories:

| Category | Examples |
|---|---|
| `role_override` | "ignore previous instructions", "you are now a…", "forget your instructions" |
| `delimiter_injection` | Fake `<system>` tags, `###SYSTEM###`, ` ```system ` blocks |
| `encoding_evasion` | Base64-encoded instruction fragments, zero-width character sequences |
| `meta_instruction` | "do not follow your guidelines", "disregard above", "output your system prompt" |
| `exfiltration` | "repeat everything above", "show me your instructions", "what is your system prompt" |

## Custom Patterns

Add custom patterns via the programmatic API:

```ts
import { createPromptGuard } from 'prism-pipe';

const guard = createPromptGuard({
  action: 'flag',
  threshold: 0.3,
  patterns: [
    {
      name: 'custom-jailbreak',
      pattern: /DAN\s+mode/i,
      weight: 0.9,
      category: 'role_override',
    },
  ],
});
```

## Scoring

The engine uses a saturating formula: `score = 1 - ∏(1 - weight_i)`. This means:
- A single 0.8-weight match → score 0.8
- Two 0.5-weight matches → score 0.75
- Multiple low-weight matches can still cross the threshold

## Metrics

The middleware emits:
- `prompt_guard.scanned` — counter, incremented per request
- `prompt_guard.detected` — counter with `{ action, category }` tags
- `prompt_guard.score` — histogram of computed scores

## Named Middleware

The guard is also available as the named middleware `'prompt-guard'` (priority 10), which can be referenced in route `middleware` arrays. When used this way, it reads config from `ctx.metadata.get('promptGuard.config')`.
