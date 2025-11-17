#!/bin/bash

# start-backend.sh - start the curriculate backend with the provided MONGO_URI
# Writes logs to backend-server.log and PID to backend-server.pid

export MONGO_URI='mongodb+srv://AtlasDB:NpGOIFdzwWLB8w4H@curriculate.7s8bdye.mongodb.net/?appName=curriculate'
LOG="/Users/richardsommer/Documents/curriculate/backend/backend-server.log"
PIDFILE="/Users/richardsommer/Documents/curriculate/backend/backend-server.pid"

nohup node index.js > "$LOG" 2>&1 &
PID=$!

echo $PID > "$PIDFILE"

# Print PID for immediate feedback
echo "Started node index.js with PID $PID"

echo "Logs: $LOG"

echo "PID file: $PIDFILE"
