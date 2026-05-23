#!/bin/bash
# Export Curriculate (student practice / scavenger hunt) feedback from the API.
# Usage: ADMIN_API_TOKEN=your-key ./export-curriculate-feedback.sh
#
# Hits /api/conference/feedback-export and writes the result to
# feedback-curriculate.txt at the curriculate repo root.

set -e

API_BASE="${API_BASE:-https://api.curriculate.net}"
KEY="${ADMIN_API_TOKEN:-${ADMIN_API_KEY:?Set ADMIN_API_TOKEN environment variable}}"
OUT="${OUT:-$(cd "$(dirname "$0")/../.." && pwd)/feedback-curriculate.txt}"

echo "Fetching Curriculate feedback from $API_BASE ..."
# Cache-bust with a timestamp so we never get a stale response from any
# proxy or CDN in front of the API. Also pass explicit no-cache headers
# in case Cloudflare / browser-derived caching is configured.
TS=$(date +%s%N 2>/dev/null || date +%s)
curl -s \
  -H "Cache-Control: no-cache" \
  -H "Pragma: no-cache" \
  "$API_BASE/api/conference/feedback-export?key=$KEY&_t=$TS" \
  -o "$OUT"

if [ $? -eq 0 ] && [ -s "$OUT" ]; then
  echo "Saved to $OUT ($(wc -l < "$OUT") lines)"
  echo ""
  cat "$OUT"
else
  echo "Failed to fetch feedback. Check your API key and network."
  exit 1
fi
