#!/bin/bash
set -e

echo "Starting dev mode..."

# Apply any pending Postgres migrations. node-pg-migrate is idempotent — it
# skips migrations already recorded in the pgmigrations table. The db service
# is guaranteed healthy before this container starts (compose depends_on:
# condition: service_healthy).
cd /app/api
echo "Running Postgres migrations..."
npm run db:migrate

# Start API with nodemon (hot-reload on file changes)
npx nodemon --watch src --ext ts,js,json,sql --signal SIGTERM --exec tsx src/index.js &
API_PID=$!

# Start MCP server (separate process on :3100) under nodemon so edits to
# src/mcp/, src/services/, instructions.js, etc. hot-reload like the API.
npx nodemon --watch src --ext ts,js,json,sql --signal SIGTERM --exec tsx src/mcp/server.js &
MCP_PID=$!

# Start GUI Vite dev server with HMR
cd /app/gui
npx vite --host 0.0.0.0 --port 80 &
GUI_PID=$!

echo "API (nodemon) on :3200 | MCP on :3100 | GUI (Vite HMR) on :80"

# Trap signals and forward to all processes
trap "kill $API_PID $MCP_PID $GUI_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Wait for any process to exit
wait -n $API_PID $MCP_PID $GUI_PID 2>/dev/null || true
kill $API_PID $MCP_PID $GUI_PID 2>/dev/null
exit 0
