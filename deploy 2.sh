#!/bin/bash
git status
echo ""
read -p "Commit message: " msg
echo ""
echo "🔧 Adding changes..."
git add .
echo ""
echo "🔧 Adding changes..."
git commit -m "$msg"
echo ""
echo "Pushing changes..."
git push origin main
echo ""
echo "🔥 Deploy complete!"
