#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📌 Git status:"
git status
echo ""

read -p "Commit message: " msg
echo ""

echo "🔧 Adding changes..."
git add .
echo ""

echo "🧪 Running pre-deploy checks..."

# ----------------------
# Backend syntax checks
# ----------------------
if [ -d "$ROOT_DIR/backend" ]; then
  echo "  • Backend: node --check on key files + controllers/routes..."
  BACKEND_FILES=()

  [ -f "$ROOT_DIR/backend/index.js" ] && BACKEND_FILES+=("$ROOT_DIR/backend/index.js")
  [ -f "$ROOT_DIR/backend/server.js" ] && BACKEND_FILES+=("$ROOT_DIR/backend/server.js")

  if [ -d "$ROOT_DIR/backend/controllers" ]; then
    while IFS= read -r -d '' f; do BACKEND_FILES+=("$f"); done < <(find "$ROOT_DIR/backend/controllers" -name "*.js" -print0)
  fi
  if [ -d "$ROOT_DIR/backend/routes" ]; then
    while IFS= read -r -d '' f; do BACKEND_FILES+=("$f"); done < <(find "$ROOT_DIR/backend/routes" -name "*.js" -print0)
  fi

  for f in "${BACKEND_FILES[@]}"; do
    node --check "$f" >/dev/null
  done
  echo "    ✅ Backend syntax OK"
fi

# ----------------------
# Teacher app build
# ----------------------
if [ "${SKIP_FRONTEND_BUILD:-0}" != "1" ]; then
  if [ -d "$ROOT_DIR/teacher-app" ] && [ -f "$ROOT_DIR/teacher-app/package.json" ]; then
    echo "  • teacher-app: npm run build"
    (cd "$ROOT_DIR/teacher-app" && npm run build)
    echo "    ✅ teacher-app build OK"
  fi

  # ----------------------
  # Student app build
  # ----------------------
  if [ -d "$ROOT_DIR/student-app" ] && [ -f "$ROOT_DIR/student-app/package.json" ]; then
    echo "  • student-app: npm run build"
    (cd "$ROOT_DIR/student-app" && npm run build)
    echo "    ✅ student-app build OK"
  fi
else
  echo "  • SKIP_FRONTEND_BUILD=1 → skipping teacher-app/student-app builds"
fi

echo ""
echo "✅ Checks passed. Committing..."
git commit -m "$msg"
echo ""

echo "🚀 Pushing changes..."
git push origin main
echo ""

echo "🔥 Deploy complete!"
