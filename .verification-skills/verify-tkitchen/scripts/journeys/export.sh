#!/usr/bin/env bash
# Feature: export (tkitchen.export/1). Issue 09 scenarios.
. "$(dirname "$0")/lib.sh"
start_world export
P='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=s.trim().split(/\r?\n/).map(JSON.parse);console.log(eval(process.argv[1]))})'
E=$(kt -- export --json)
check "empty store: header + end events:0" "$(echo "$E" | node -e "$P" 'l.map(x=>x.type).join(",")+" "+l.at(-1).events')" "header,end 0"
vt branch dev C main; vt branch dev B C; vt bases '{"C":"main","B":"C"}'
kt -- round >/dev/null
for i in 1 2 3; do vt commit mate C 1; kt -- round >/dev/null; done
E=$(kt -- export --json); echo "$E" > "$R/export-full.ndjson"
check "full export: header, 3 events seq 1-3, end" "$(echo "$E" | node -e "$P" 'l.map(x=>x.type==="event"?x.seq:x.type).join(",")+" reset="+l[0].reset+" schema="+l[0].schema+" n="+l.at(-1).events')" "header,1,2,3,end reset=false schema=tkitchen.export/1 n=3"
check "no per-machine keys exported" "$(echo "$E" | grep -cE '"(outcome|status|behind_by|oid|consumer)"')" "0"
CUR=$(echo "$E" | node -e "$P" 'l.at(-1).cursor')
vt commit mate C 1; kt -- round >/dev/null
E2=$(kt -- export --json --after "$CUR")
check "resume after cursor: only seq 4" "$(echo "$E2" | node -e "$P" 'l.filter(x=>x.type==="event").map(x=>x.seq).join()+" reset="+l[0].reset')" "4 reset=false"
BAD=$(node -e 'console.log(Buffer.from(JSON.stringify({s:1,id:"other"})).toString("base64url"))')
E3=$(kt -- export --json --after "$BAD")
check "changed id cursor is a reset from seq 1" "$(echo "$E3" | node -e "$P" 'l[0].reset+" first="+l[1].seq')" "true first=1"
OUT=$(kt -- export --json --after 'not-base64!'); RC=$?
check "bad cursor exits 2 with empty stdout" "$RC:$OUT" "2:"
finish
