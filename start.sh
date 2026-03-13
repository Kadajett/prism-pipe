#!/bin/bash
export INCEPTION_API_KEY=sk_0b907b1752a9f633a99abb960c38730a
export ANTHROPIC_API_KEY=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
cd /home/kadajett/prism-pipe
exec node dist/index.js 2>&1
