#!/usr/bin/env bash
# Feature: round fault tolerance (git remote failure leaves the store untouched). Issue 06 scenario at CLI level.
. "$(dirname "$0")/lib.sh"
start_world git-failure
vt branch dev C main; vt branch dev B C; vt bases '{"C":"main","B":"C"}'
kt -- round >/dev/null
vt commit mate C 1
SNAP="select (select count(*) from event) e,(select group_concat(branch||'='||oid) from repo_heads) h,(select group_concat(branch||'='||status) from branch_state) s"
B4=$(sql "$SNAP")
vt set-url "$R/no-such-origin.git"
kt -- round >/dev/null; check "unreachable remote: round exits 1" "$?" "1"
check "unreachable remote: store unchanged" "$(sql "$SNAP")" "$B4"
N=$(kt -- notices --json); check "unreachable remote: lastError set" "$(jsx "$N" 'j.rounds[0].lastError!==null')" "true"
vt set-url ORIGIN
kt -- round >/dev/null; check "restored remote: round exits 0" "$?" "0"
N=$(kt -- notices --json)
check "restored remote: move recorded, error cleared" "$(jsx "$N" 'j.notices.map(n=>n.branch+":"+n.behindBy).join()+" err="+j.rounds[0].lastError')" "B:1 err=null"
finish
