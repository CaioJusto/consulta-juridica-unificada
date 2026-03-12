#!/bin/bash
set -e

# Start Python API in background
python3 api_server.py &
PYTHON_PID=$!

# Wait for Python to be ready
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "Python API ready"
    break
  fi
  sleep 1
done

# Start Node.js (uses PORT env var from Railway)
PORT=${PORT:-5000} NODE_ENV=production node dist/index.cjs
