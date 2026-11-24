#!/usr/bin/env bash
# FB-3 probe: a real `tkitchen round` (fake gh on PATH) prints no DEP0190 warning and exits 0.
. .verification-skills/verify-tkitchen/scripts/journeys/lib.sh
start_world fb3-dep0190
vt branch dev feat main
kt -- round >/dev/null; check "round exits 0" "$?" "0"
check "no DEP0190 on stderr" "$(grep -c DEP0190 "$R/last-stderr.txt")" "0"
finish
