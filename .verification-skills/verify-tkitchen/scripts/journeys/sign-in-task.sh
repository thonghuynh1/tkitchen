#!/usr/bin/env bash
# Feature: sign-in-task (Windows only). Exports XML without registering; uninstall idempotent. Issue 08.
. "$(dirname "$0")/lib.sh"
start_world sign-in-task
X="$(cygpath -w "$R")\\task.xml"
powershell -NoProfile -File deploy/windows/install-task.ps1 -Export "$X" -TaskName tkitchen-verify > "$R/install.log" 2>&1; check "install -Export exits 0" "$?" "0"
check "XML written" "$([ -f "$R/task.xml" ] && echo yes)" "yes"
XML=$(powershell -NoProfile -Command "Get-Content -Raw '$X'")
echo "$XML" > "$R/task-utf8.xml"
check "one LogonTrigger, no BootTrigger" "$(echo "$XML" | grep -c '<LogonTrigger')/$(echo "$XML" | grep -c '<BootTrigger')" "1/0"
check "runs node.exe with tkitchen.ts serve" "$(echo "$XML" | grep -c 'node.exe</Command>')/$(echo "$XML" | grep -cE 'tkitchen.ts(&quot;|\")? serve</Arguments>')" "1/1"
check "MultipleInstancesPolicy IgnoreNew" "$(echo "$XML" | grep -c '<MultipleInstancesPolicy>IgnoreNew')" "1"
schtasks /Query /TN tkitchen-verify >/dev/null 2>&1; check "task not registered by -Export" "$?" "1"
powershell -NoProfile -File deploy/windows/uninstall-task.ps1 -TaskName tkitchen-verify > "$R/uninstall.log" 2>&1; check "uninstall with no task exits 0" "$?" "0"
finish
