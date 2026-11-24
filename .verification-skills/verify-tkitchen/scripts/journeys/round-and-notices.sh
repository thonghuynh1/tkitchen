#!/usr/bin/env bash
# Feature: round-and-notices (config bases). Issue 01 scenarios.
. "$(dirname "$0")/lib.sh"
start_world round-notices
vt branch dev A main; vt branch dev F A; vt branch dev C main; vt branch dev B C; vt branch dev D C
vt bases '{"A":"main","F":"A","C":"main","B":"C","D":"C"}'
vt commit mate C 1
kt -- round >/dev/null; check "baseline round exits 0" "$?" "0"
N=$(kt -- notices --json)
check "baseline: B and D behind 1 (explicit), nothing for A/F" "$(jsx "$N" 'j.notices.map(n=>n.branch+":"+n.status+":"+n.behindBy+":"+n.evidence).sort().join(",")')" "B:behind:1:explicit,D:behind:1:explicit"
check "baseline writes no Trigger" "$(sql 'select count(*) c from event')" '[{"c":0}]'
vt commit mate C 1
BEFORE=$(vt refs)
kt -- round >/dev/null; check "round after push exits 0" "$?" "0"
check "round leaves origin refs unchanged" "$(vt refs)" "$BEFORE"
N=$(kt -- notices --json)
check "push to C: B and D behind 2" "$(jsx "$N" 'j.notices.map(n=>n.branch+":"+n.status+":"+n.behindBy).sort().join(",")')" "B:behind:2,D:behind:2"
EV=$(sql 'select id, threads from event')
check "one Base moved Trigger with threads B,D" "$(jsx "$EV" 'j.length+" "+j[0].threads')" '1 ["git:x:B","git:x:D"]'
check "notice lastEventId is that Trigger" "$(jsx "$N" 'j.notices[0].lastEventId')" "$(jsx "$EV" 'j[0].id')"
check "two Dispositions" "$(sql 'select count(*) c from disposition')" '[{"c":2}]'
kt -- round >/dev/null
check "quiet rerun adds no rows" "$(sql 'select (select count(*) from event) e, (select count(*) from disposition) d')" '[{"e":1,"d":2}]'
vt merge dev B C
kt -- round >/dev/null
N=$(kt -- notices --json)
check "B catches up: notice closed" "$(jsx "$N" 'j.notices.map(n=>n.branch).sort().join(",")')" "D"
check "B branch_state up_to_date" "$(sql "select status from branch_state where branch='B'")" '[{"status":"up_to_date"}]'
T=$(kt -- notices)
check "human notices line" "$T" "x D behind base=C behindBy=2"
check "rounds[].lastError null" "$(jsx "$N" 'j.rounds[0].lastError')" "null"
H=$(kt -- --help); check "--help lists commands" "$(echo "$H" | grep -cE '^  (serve|round|notices|export) ')" "4"
echo '{"repos":[{"name":"x","path":"F:/no/such/dir"}]}' > "$R/home/config.json"
kt -- round >/dev/null; check "bad config path exits 2" "$?" "2"
check "bad config names repos[0].path" "$(grep -c 'repos\[0\].path' "$R/last-stderr.txt")" "1"
finish
