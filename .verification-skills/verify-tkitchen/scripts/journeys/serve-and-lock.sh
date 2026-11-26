#!/usr/bin/env bash
# Feature: serve-and-lock. Issue 07 scenarios at CLI level.
. "$(dirname "$0")/lib.sh"
start_world serve-lock
vt branch dev C main; vt branch dev B C; vt bases '{"C":"main","B":"C"}'
PID=$(vt serve-start 0.05)
for i in $(seq 1 60); do [ -s "$R/home/kitchen.lock" ] && break; sleep 0.5; done
check "serve writes kitchen.lock with its pid" "$(grep -c "$PID" "$R/home/kitchen.lock")" "1"
kt -- serve >/dev/null; check "second serve exits 1" "$?" "1"
check "second serve names first pid" "$(tr -d '\r' < "$R/last-stderr.txt" | grep -v Warning | grep -v trace-deprecation | grep -v trace-warnings)" "already running (pid $PID)"
kt -- round >/dev/null; check "round refuses while serve runs" "$?" "1"
kt -- round --force >/dev/null; check "round --force is unknown (exit 2)" "$?" "2"
for i in $(seq 1 60); do N=$(kt -- notices --json); [ "$(jsx "$N" 'j.rounds.length')" = "1" ] && break; sleep 0.5; done
T1=$(jsx "$N" 'j.rounds[0].lastCompleteAt')
vt commit mate C 1
for i in $(seq 1 60); do N=$(kt -- notices --json); [ "$(jsx "$N" 'j.notices.length')" = "1" ] && break; sleep 0.5; done
check "serve loop picks up a push on its own" "$(jsx "$N" 'j.notices.map(n=>n.branch+":"+n.behindBy).join()')" "B:1"
check "lastCompleteAt advanced" "$(jsx "$N" "j.rounds[0].lastCompleteAt > '$T1'")" "true"
node "$VT" cleanup "$R" >/dev/null; sleep 1
cp "$R/home/kitchen.lock" "$R/lock-left-by-killed-serve.txt" 2>/dev/null || echo absent > "$R/lock-left-by-killed-serve.txt"
check "killed serve leaves a lock naming the dead pid" "$(grep -c "$PID" "$R/lock-left-by-killed-serve.txt")" "1"
PID2=$(vt serve-start)
for i in $(seq 1 60); do grep -q "$PID2" "$R/home/kitchen.lock" 2>/dev/null && break; sleep 0.5; done
check "dead-pid lock taken over by new serve" "$(grep -c "$PID2" "$R/home/kitchen.lock")" "1"
finish
