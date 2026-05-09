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
curl -s "$API_BASE/api/conference/feedback-export?key=$KEY" -o "$OUT"

if [ $? -eq 0 ] && [ -s "$OUT" ]; then
  echo "Saved to $OUT ($(wc -l < "$OUT") lines)"
  echo ""
  cat "$OUT"
else
  echo "Failed to fetch feedback. Check your API key and network."
  exit 1
fi
