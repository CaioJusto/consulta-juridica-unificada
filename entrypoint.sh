#!/bin/bash
set -euo pipefail

if [ "${PLAYWRIGHT_USE_XVFB:-1}" = "1" ]; then
  PYTHON_API_CMD=(xvfb-run -a -s "-screen 0 1280x1024x24" python3 api_server.py)
else
  PYTHON_API_CMD=(python3 api_server.py)
fi

# Start Python API in background with automatic restart loop
(
  while true; do
    echo "[entrypoint] Starting Python API..."
    "${PYTHON_API_CMD[@]}" || true
    echo "[entrypoint] Python API exited, restarting in 2s..."
    sleep 2
  done
) &

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
