#!/usr/bin/env bash
# Live end-to-end verification of the Tax / Loans / Audit verticals against a
# REAL `next dev` server backed by a REAL local mongod on a throwaway db.
# Never touches the production cluster: it spins up its own mongod on :27018
# and points the app at db "teebee_demo_test".
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=3100
MONGO_PORT=27018
SECRET="test-secret-e2e-$$"
TMP="$(mktemp -d -t teebee-e2e)"
DBPATH="$TMP/mongo"
mkdir -p "$DBPATH"

MONGO_PID=""
DEV_PID=""
cleanup() {
  echo "── teardown ──"
  [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null
  # next dev spawns children; kill the process group of the dev server too.
  pkill -P "${DEV_PID:-0}" 2>/dev/null
  if [ -n "$MONGO_PID" ]; then
    kill -TERM "$MONGO_PID" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$MONGO_PID" 2>/dev/null || break; sleep 0.5; done
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

echo "── mongod on :$MONGO_PORT (dbpath $DBPATH) ──"
# --fork is unsupported on macOS in mongod 8; run it as a background job instead.
mongod --dbpath "$DBPATH" --port "$MONGO_PORT" --bind_ip 127.0.0.1 \
  --logpath "$TMP/mongod.log" >/dev/null 2>&1 &
MONGO_PID=$!
# Wait for mongod to accept connections.
MONGO_READY=""
for _ in $(seq 1 40); do
  if ! kill -0 "$MONGO_PID" 2>/dev/null; then break; fi
  if mongosh --quiet --port "$MONGO_PORT" --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; then MONGO_READY=1; break; fi
  sleep 0.5
done
if [ -z "$MONGO_READY" ]; then
  echo "!! mongod never accepted connections — log:"; tail -10 "$TMP/mongod.log" 2>/dev/null; exit 1
fi
echo "mongod pid $MONGO_PID"

export MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT"
export MONGODB_URI="mongodb://127.0.0.1:$MONGO_PORT"
export MONGO_DB="teebee_demo_test"
export TEEBEEPAY_SECRET="$SECRET"
export E2E_BASE="http://127.0.0.1:$PORT"

echo "── next dev on :$PORT ──"
npx next dev -p "$PORT" >"$TMP/next.log" 2>&1 &
DEV_PID=$!
echo "next dev pid $DEV_PID"

# Wait for the dev server to compile + answer.
READY=""
for _ in $(seq 1 120); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/tax/me"; then READY=1; break; fi
  # /tax/me returns 401 without a token — that still proves the server is up.
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/tax/me" 2>/dev/null)"
  if [ "$code" = "401" ] || [ "$code" = "200" ]; then READY=1; break; fi
  sleep 1
done
if [ -z "$READY" ]; then
  echo "!! dev server never came up — last 40 lines of next.log:"
  tail -40 "$TMP/next.log"
  exit 1
fi
echo "dev server ready"

echo "── running e2e suite ──"
node --import ./scripts/ts-resolve.mjs scripts/e2e-verticals.ts
RESULT=$?

echo "── next dev log tail (for context) ──"
tail -15 "$TMP/next.log"

exit $RESULT
