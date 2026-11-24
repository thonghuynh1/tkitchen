#!/usr/bin/env bash
# Feature: automatic-base (reflog, reflog-tip, needs_base, history). Issue 04 scenarios.
. "$(dirname "$0")/lib.sh"
start_world automatic-base
vt branch dev C main
vt branch dev B C
vt branch-oid dev E C
vt branch mate G C
kt -- round >/dev/null; check "baseline exits 0" "$?" "0"
vt commit mate C 1
kt -- round >/dev/null; check "round exits 0" "$?" "0"
N=$(kt -- notices --json)
check "B behind C via reflog, E via reflog-tip" "$(jsx "$N" 'j.notices.filter(n=>n.status==="behind").map(n=>n.branch+":"+n.base+":"+n.evidence).sort().join(",")')" "B:C:reflog,E:C:reflog-tip"
check "G from another clone is needs_base" "$(jsx "$N" 'j.notices.filter(n=>n.branch==="G").map(n=>n.status+":"+n.base).join()')" "needs_base:null"
T=$(kt -- notices)
check "needs_base line carries config hint" "$(echo "$T" | grep -c "x G needs_base add \"bases\": { \"G\": \"<base>\" } to .*config.json")" "1"
HJ=$(kt -- notices --json --history)
check "history: one Trigger, dispositions B,E" "$(jsx "$HJ" 'j.history.length+" "+j.history[0].dispositions.map(d=>d.thread).sort().join(",")')" "1 git:x:B,git:x:E"
vt bases '{"G":"C"}'
kt -- round >/dev/null
N=$(kt -- notices --json)
check "config base resolves G" "$(jsx "$N" 'j.notices.filter(n=>n.branch==="G").map(n=>n.status+":"+n.base+":"+n.evidence).join()')" "behind:C:explicit"
finish
