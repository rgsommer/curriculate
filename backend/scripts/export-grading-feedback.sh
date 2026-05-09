#!/bin/bash
# Export Pulse Grading feedback (bug reports + suggestions) from the API.
# Usage: ADMIN_API_TOKEN=your-key ./export-grading-feedback.sh
#
# Optional filters via env:
#   STATUS=open  STATUS=in_progress  STATUS=fixed  STATUS=wontfix
#   SINCE=2026-05-01   (ISO date — only feedback at or after this date)
#
# Saves the result to feedback-grading.txt at the curriculate repo root,
# alongside feedback-curriculate.txt and feedback-fieldday.txt.

set -e

API_BASE="${API_BASE:-https://api.curriculate.net}"
KEY="${ADMIN_API_TOKEN:-${ADMIN_API_KEY:?Set ADMIN_API_TOKEN environment variable}}"
OUT="${OUT:-$(cd "$(dirname "$0")/../.." && pwd)/feedback-grading.txt}"

QS="key=${KEY}"
[ -n "$STATUS" ] && QS="${QS}&status=${STATUS}"
[ -n "$SINCE" ]  && QS="${QS}&since=${SINCE}"

echo "Fetching Pulse Grading feedback from ${API_BASE} ..."
curl -s "${API_BASE}/api/grading/feedback-export?${QS}" -o "$OUT"

if [ $? -eq 0 ] && [ -s "$OUT" ]; then
  LINES=$(wc -l < "$OUT")
  echo "Saved to $OUT ($LINES lines)"
  echo ""
  head -8 "$OUT"
  echo "..."
  echo "(see $OUT for full report)"
else
  echo "Failed to fetch feedback. Check ADMIN_API_TOKEN, network, and that the backend has the /api/grading/feedback-export route deployed."
  exit 1
fi
