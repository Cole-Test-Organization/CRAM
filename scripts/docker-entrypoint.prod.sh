#!/bin/bash
set -e

echo "Starting prod mode..."

cd /app/api

# Apply any pending Postgres migrations. Idempotent.
echo "Running Postgres migrations..."
npm run db:migrate

# Start the API (Fastify on :3200)
node src/index.js &
API_PID=$!

# Start the MCP server (separate process on :3100)
node src/mcp/server.js &
MCP_PID=$!

echo "API on :3200 | MCP on :3100"

trap "kill $API_PID $MCP_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait -n $API_PID $MCP_PID 2>/dev/null || true
kill $API_PID $MCP_PID 2>/dev/null
exit 0
