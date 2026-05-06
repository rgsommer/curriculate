#!/bin/bash
# Export student practice feedback from the Curriculate API
# Usage: ADMIN_API_KEY=your-key ./export-feedback.sh
#
# This hits the /api/conference/feedback-export endpoint and saves the result.

API_BASE="${API_BASE:-https://api.curriculate.net}"
KEY="${ADMIN_API_TOKEN:-${ADMIN_API_KEY:?Set ADMIN_API_TOKEN environment variable}}"

echo "Fetching feedback from $API_BASE ..."
curl -s "$API_BASE/api/conference/feedback-export?key=$KEY" -o feedback-report.txt

if [ $? -eq 0 ] && [ -s feedback-report.txt ]; then
  echo "Saved to feedback-report.txt ($(wc -l < feedback-report.txt) lines)"
  echo ""
  cat feedback-report.txt
else
  echo "Failed to fetch feedback. Check your API key and network."
fi
