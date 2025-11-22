#!/bin/bash
git status
read -p "Commit message: " msg

echo "🔧 Adding changes..."
git add .


echo "🔧 Adding changes..."


git commit -m "$msg"


git push origin main


echo "🔥 Deploy complete!"
