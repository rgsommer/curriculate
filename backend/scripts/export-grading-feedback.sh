#!/bin/bash
# Export Pulse Grading feedback from the Curriculate API.
# Usage: ADMIN_API_TOKEN=your-key ./export-grading-feedback.sh
#
# PLACEHOLDER: this hits /api/grading/feedback-export, which doesn't exist yet.
# Mirror the pattern in routes/demo.js (/feedback-export) once Pulse Grading
# has a feedback collection schema. The script writes to feedback-grading.txt
# at the curriculate repo root, beside feedback-curriculate.txt and
# feedback-fieldday.txt.

set -e

API_BASE="${API_BASE:-https://api.curriculate.net}"
KEY="${ADMIN_API_TOKEN:-${ADMIN_API_KEY:?Set ADMIN_API_TOKEN environment variable}}"
OUT="${OUT:-$(cd "$(dirname "$0")/../.." && pwd)/feedback-grading.txt}"

echo "Fetching Grading feedback from $API_BASE ..."
HTTP_CODE=$(curl -s -o "$OUT" -w "%{http_code}" "$API_BASE/api/grading/feedback-export?key=$KEY")

if [ "$HTTP_CODE" = "404" ]; then
  echo "/api/grading/feedback-export route not built yet — see TODO at top of this script."
  rm -f "$OUT"
  exit 2
fi

if [ "$HTTP_CODE" = "200" ] && [ -s "$OUT" ]; then
  echo "Saved to $OUT ($(wc -l < "$OUT") lines)"
  echo ""
  head -8 "$OUT"
  echo "..."
  echo "(see $OUT for full report)"
else
  echo "Failed (HTTP $HTTP_CODE). Check ADMIN_API_TOKEN and network."
  exit 1
fi
