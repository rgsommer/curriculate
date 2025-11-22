#!/bin/bash
git status
read -p "Commit message: " msg

git add .
git commit -m "$msg"
git push origin main

echo "🔥 Deploy complete!"
