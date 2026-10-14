#!/bin/bash

# start-backend.sh - start the curriculate backend
# Writes logs to backend-server.log and PID to backend-server.pid
#
# MONGO_URI is never stored in this file. It is taken from the environment,
# or else from backend/.env (gitignored; see backend/.env.example).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$MONGO_URI" ] && [ -f "$SCRIPT_DIR/.env" ]; then
  MONGO_URI="$(grep -E '^MONGO_URI=' "$SCRIPT_DIR/.env" | tail -n 1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//")"
fi

if [ -z "$MONGO_URI" ]; then
  echo "ERROR: MONGO_URI is not set." >&2
  echo "Export it in your shell, or add MONGO_URI=... to $SCRIPT_DIR/.env (see .env.example)." >&2
  exit 1
fi
export MONGO_URI

LOG="/Users/richardsommer/Documents/curriculate/backend/backend-server.log"
PIDFILE="/Users/richardsommer/Documents/curriculate/backend/backend-server.pid"

nohup node index.js > "$LOG" 2>&1 &
PID=$!

echo $PID > "$PIDFILE"

# Print PID for immediate feedback
echo "Started node index.js with PID $PID"

echo "Logs: $LOG"

echo "PID file: $PIDFILE"
