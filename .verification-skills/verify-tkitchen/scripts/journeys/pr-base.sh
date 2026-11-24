#!/usr/bin/env bash
# Feature: pr-base (gh PR targets, retarget, gh failure, fork, ambiguity). Issue 05 scenarios.
. "$(dirname "$0")/lib.sh"
start_world pr-base
vt branch dev feature-1 main
vt branch mate feature-2 feature-1
vt prs '[["feature-2","feature-1"]]'
kt -- round >/dev/null; check "baseline exits 0" "$?" "0"
vt commit dev feature-1 1
kt -- round >/dev/null
N=$(kt -- notices --json)
check "teammate branch behind via pr" "$(jsx "$N" 'j.notices.map(n=>n.branch+":"+n.base+":"+n.evidence+":"+n.behindBy).join()')" "feature-2:feature-1:pr:1"
vt prs '[["feature-2","main"]]'
kt -- round >/dev/null
check "retarget without push updates base" "$(sql "select base from branch_state where branch='feature-2'")" '[{"base":"main"}]'
vt prs '[["feature-2","feature-1"]]'; kt -- round >/dev/null
SNAP="select (select group_concat(id) from event) e,(select count(*) from disposition) d,(select group_concat(branch||'='||oid) from repo_heads) h,(select group_concat(branch||'='||status||'='||ifnull(behind_by,'-')) from branch_state) s"
vt commit dev feature-1 1
B4=$(sql "$SNAP")
kt FAKE_GH_FAIL=1 -- round >/dev/null; check "gh failure: round exits 1" "$?" "1"
check "gh failure: store unchanged" "$(sql "$SNAP")" "$B4"
N=$(kt -- notices --json)
check "gh failure: lastError recorded" "$(jsx "$N" 'j.rounds[0].lastError!==null')" "true"
kt -- round >/dev/null; check "next round succeeds" "$?" "0"
N=$(kt -- notices --json)
check "next round records the move (2 pushes on feature-1 since branching)" "$(jsx "$N" 'j.notices.map(n=>n.branch+":"+n.behindBy).join()+" err="+j.rounds[0].lastError')" "feature-2:2 err=null"
vt branch mate fork-b main
vt prs '[["feature-2","feature-1"],["fork-b","feature-1","fork"]]'; kt -- round >/dev/null
N=$(kt -- notices --json)
check "fork PR adds no base" "$(jsx "$N" 'j.notices.filter(n=>n.branch==="fork-b").map(n=>n.status).join()')" "needs_base"
vt branch mate h main
vt bases '{"h":"main"}'; vt prs '[["h","feature-1"]]'; kt -- round >/dev/null
N=$(kt -- notices --json)
check "config vs PR mismatch is ambiguous" "$(jsx "$N" 'j.notices.filter(n=>n.branch==="h").map(n=>n.status+":"+n.evidence).join()')" "ambiguous:explicit_pr_mismatch"
vt bases '{}'; vt prs '[["h","feature-1"],["h","main"]]'; kt -- round >/dev/null
N=$(kt -- notices --json)
check "two PRs from one head is ambiguous" "$(jsx "$N" 'j.notices.filter(n=>n.branch==="h").map(n=>n.status+":"+n.evidence).join()')" "ambiguous:multiple_prs"
finish
