#!/bin/bash
# Start Prism Pipe using Codex CLI's OAuth tokens (Max plan, $0/token)
# Refreshes the token via codex CLI if needed, then exports as OPENAI_API_KEY

set -euo pipefail

AUTH_FILE="$HOME/.codex/auth.json"

if [ ! -f "$AUTH_FILE" ]; then
  echo "Error: No Codex auth found. Run 'codex login' first."
  exit 1
fi

# Extract access_token from codex auth
ACCESS_TOKEN=$(python3 -c "import json; print(json.load(open('$AUTH_FILE'))['tokens']['access_token'])")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Error: No access_token in $AUTH_FILE. Run 'codex login' first."
  exit 1
fi

# Check token age — refresh if older than 1 hour
LAST_REFRESH=$(python3 -c "import json; print(json.load(open('$AUTH_FILE')).get('last_refresh',''))")
TOKEN_AGE_HOURS=$(python3 -c "
from datetime import datetime, timezone
lr = '$LAST_REFRESH'
if lr:
    dt = datetime.fromisoformat(lr.replace('Z','+00:00'))
    age = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
    print(f'{age:.1f}')
else:
    print('999')
")

echo "Token age: ${TOKEN_AGE_HOURS}h since last refresh"

if (( $(echo "$TOKEN_AGE_HOURS > 1" | bc -l) )); then
  echo "Token may be stale, attempting refresh via codex..."
  # codex exec with a trivial prompt triggers token refresh
  codex exec --ephemeral "echo ok" 2>/dev/null || true
  ACCESS_TOKEN=$(python3 -c "import json; print(json.load(open('$AUTH_FILE'))['tokens']['access_token'])")
  echo "Token refreshed."
fi

export OPENAI_API_KEY="$ACCESS_TOKEN"

echo "Starting Prism Pipe with Codex OAuth (Max plan)..."
cd "$(dirname "$0")"
exec node dist/index.js "$@"
