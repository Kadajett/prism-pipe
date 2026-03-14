#!/bin/bash
# Start all Prism Pipe instances
#
# Modes:
#   ./start-all.sh              — Programmatic mode (single process, recommended)
#   ./start-all.sh --yaml       — Legacy YAML mode (3 separate processes)
#
# Required env vars:
#   INCEPTION_API_KEY
#   ANTHROPIC_API_KEY

set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${INCEPTION_API_KEY:-}" ] || [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "❌ Required env vars: INCEPTION_API_KEY, ANTHROPIC_API_KEY"
  echo "   Export them or create a .env file."
  exit 1
fi

# ── Programmatic mode (default) ─────────────────────────────────────────────
if [ "${1:-}" != "--yaml" ]; then
  echo "Starting Prism Pipe (programmatic — single process)..."
  exec npx tsx examples/programmatic.ts
fi

# ── Legacy YAML mode ────────────────────────────────────────────────────────
echo "Starting Prism Pipe (YAML — 3 separate processes)..."

# Kill any existing instances
pkill -f "node dist/index.js" 2>/dev/null || true
sleep 1

# Mercury Direct — port 3100
PRISM_CONFIG=configs/mercury-direct.yaml nohup node dist/index.js > /tmp/prism-pipe-3100.log 2>&1 &
echo "  ✅ Mercury Direct    → :3100 (PID $!)"

# Opus→Mercury→Opus — port 3101
PRISM_CONFIG=configs/opus-mercury-opus.yaml nohup node dist/index.js > /tmp/prism-pipe-3101.log 2>&1 &
echo "  ✅ Opus→Mercury→Opus → :3101 (PID $!)"

# Fast Think — port 3102
PRISM_CONFIG=configs/fast-think.yaml nohup node dist/index.js > /tmp/prism-pipe-3102.log 2>&1 &
echo "  ✅ Fast Think         → :3102 (PID $!)"

sleep 2

# Health checks
for port in 3100 3101 3102; do
  status=$(curl -s "http://localhost:$port/health" | jq -r .status 2>/dev/null || echo "down")
  echo "  Port $port: $status"
done
