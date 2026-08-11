#!/usr/bin/env sh
# Browser fallback for macOS / Linux: starts the server and opens the widget in
# the default browser. No transparency and no always-on-top -- for the real
# floating widget use:  npm run widget
set -e
cd "$(dirname "$0")"

PORT="${PUNISHER_PORT:-47600}"
URL="http://127.0.0.1:${PORT}"

if command -v curl >/dev/null 2>&1 && curl -fsS "${URL}/estado" >/dev/null 2>&1; then
  echo "[punisher] server already running on ${PORT}"
else
  node server.js &
  echo "[punisher] server started (pid $!)"
  sleep 2
fi

if command -v open >/dev/null 2>&1; then
  open "$URL"            # macOS
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"        # Linux
else
  echo "[punisher] open this in your browser: $URL"
fi
