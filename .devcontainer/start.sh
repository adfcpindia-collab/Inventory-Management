#!/usr/bin/env bash
# Starts the dev servers in the background unless they are already up.
cd "$(dirname "$0")/.."
if ! curl -s -o /dev/null localhost:5173; then
  nohup npm run dev > /tmp/inventory-dev.log 2>&1 &
  echo "Dev servers starting (log: /tmp/inventory-dev.log)"
fi
