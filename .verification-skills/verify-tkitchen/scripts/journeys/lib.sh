# Sourced by every journey. Usage inside a journey: start_world <name>; ...; finish.
# Run from the repo root. Evidence lands in .verification-evidence/verify-tkitchen/<stamp>-<name>/.
set -u
VT=".verification-skills/verify-tkitchen/scripts/vt.mjs"
PASS=0; FAIL=0

start_world() {
  STAMP="${VT_STAMP:-$(date +%Y%m%d-%H%M%S)}"
  R=".verification-evidence/verify-tkitchen/${STAMP}-$1"
  node "$VT" new "$R" >/dev/null 2>&1 || { echo "FAIL world: could not create $R"; exit 2; }
  node "$VT" doctor "$R" >/dev/null || { echo "FAIL doctor: see $R/transcript.log"; exit 2; }
  echo "world: $R"
}
vt() { node "$VT" "$1" "$R" "${@:2}" 2>/dev/null; }
kt() { node "$VT" kt "$R" "$@" 2>"$R/last-stderr.txt"; }
# jsx '<json>' '<js expression over j>' -> prints the expression's value as JSON
jsx() { node -e 'const j=JSON.parse(process.argv[1]);const v=(new Function("j","return ("+process.argv[2]+")"))(j);console.log(typeof v==="string"?v:JSON.stringify(v))' "$1" "$2"; }
sql() { vt sql "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s))))'; }
check() {
  local name="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then PASS=$((PASS+1)); echo "PASS $name"; echo "PASS $name :: $actual" >> "$R/checks.log"
  else FAIL=$((FAIL+1)); echo "FAIL $name :: expected [$expected] got [$actual]"; echo "FAIL $name :: expected [$expected] got [$actual]" >> "$R/checks.log"; fi
}
finish() {
  node "$VT" cleanup "$R" >/dev/null
  echo "summary $(basename "$R"): pass=$PASS fail=$FAIL evidence=$R"
  [ "$FAIL" -eq 0 ]
}
