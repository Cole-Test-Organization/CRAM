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

# Start API directly. Provisioning jobs are long-running and spawn Terraform;
# nodemon restarts interrupt those jobs even with broad ignore rules.
npx tsx src/index.ts &
API_PID=$!

# Start MCP server (separate process on :3100).
npx tsx src/mcp/server.ts &
MCP_PID=$!

# Start GUI Vite dev server with HMR
cd /app/gui
npx vite --host 0.0.0.0 --port 80 &
GUI_PID=$!

echo "API on :3200 | MCP on :3100 | GUI (Vite HMR) on :80"

# Trap signals and forward to all processes
trap "kill $API_PID $MCP_PID $GUI_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Wait for any process to exit
wait -n $API_PID $MCP_PID $GUI_PID 2>/dev/null || true
kill $API_PID $MCP_PID $GUI_PID 2>/dev/null
exit 0
