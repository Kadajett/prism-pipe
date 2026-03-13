#!/bin/bash
# Start all Prism Pipe instances
export INCEPTION_API_KEY=sk_0b907b1752a9f633a99abb960c38730a
export ANTHROPIC_API_KEY=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

cd /home/kadajett/prism-pipe

# Kill any existing instances
pkill -f "node dist/index.js" 2>/dev/null
sleep 1

echo "Starting Prism Pipe instances..."

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
  status=$(curl -s http://localhost:$port/health | jq -r .status 2>/dev/null || echo "down")
  echo "  Port $port: $status"
done
