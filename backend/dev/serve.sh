#!/bin/bash
# Restart the local backend in the background (PID in var/server.pid, log in var/server.log).
cd "$(dirname "$0")/.."
mkdir -p var
if [ -f var/server.pid ] && kill -0 "$(cat var/server.pid)" 2>/dev/null; then
  kill "$(cat var/server.pid)"
  for i in $(seq 1 50); do kill -0 "$(cat var/server.pid)" 2>/dev/null || break; sleep 0.1; done  # graceful exit
fi
MSGPACK_PUREPYTHON=1 nohup python3 manage.py serve --port "${PORT:-8000}" > var/server.log 2>&1 &
echo $! > var/server.pid
for i in $(seq 1 30); do curl -s -o /dev/null "localhost:${PORT:-8000}/health" && break; sleep 0.3; done
echo "backend on :${PORT:-8000} (pid $(cat var/server.pid))"
