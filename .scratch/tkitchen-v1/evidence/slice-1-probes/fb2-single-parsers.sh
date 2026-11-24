#!/usr/bin/env bash
# FB-2 probe: lock-file.ts has one JSON pid parser and one snapshot/identity reader.
F=src/infrastructure/lock-file.ts
h=$(grep -c 'createHash("sha256").update(raw)' $F); p=$(grep -c 'parsed\["pid"\]' $F)
echo "identity-hash-sites=$h json-pid-sites=$p"
[ "$h" = 1 ] && [ "$p" = 1 ] && echo PASS || { echo FAIL; exit 1; }
