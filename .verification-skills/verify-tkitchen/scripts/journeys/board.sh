#!/usr/bin/env bash
# Feature: board. tkitchen board serves the page and /v1/health on one port.
. "$(dirname "$0")/lib.sh"
start_world board
[ -f dist/web/index.html ] || npm run build:web >/dev/null 2>&1
check "board page is built" "$([ -f dist/web/index.html ] && echo yes || echo no)" "yes"
PID=$(vt board-start)
URL=""
for i in $(seq 1 60); do URL=$(sed -n 's/^board at //p' "$R/board.log" 2>/dev/null | tr -d '\r' | head -1); [ -n "$URL" ] && break; sleep 0.5; done
check "board prints its URL" "$([ -n "$URL" ] && echo yes || echo no)" "yes"
check "GET /v1/health answers ok true" "$(curl -s "$URL/v1/health")" '{"ok":true}'
PAGE=$(curl -s "$URL/")
check "GET / serves the board page" "$(echo "$PAGE" | grep -c '<title>Waiter Board</title>')" "1"
ASSET=$(echo "$PAGE" | sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' | head -1)
check "the page's script asset loads" "$(curl -s -o /dev/null -w '%{http_code}' "$URL$ASSET")" "200"
node "$VT" cleanup "$R" >/dev/null; sleep 1
check "after cleanup the port is closed" "$(curl -s --max-time 3 "$URL/v1/health" || echo closed)" "closed"
finish
