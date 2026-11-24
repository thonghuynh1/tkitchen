---
repo: F:/MyWork/tkitchen
status: closed
type: AFK
covers: [US-004 (launch side), DEC-001 (launch-only sign-in task)]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

Windows scripts that register and remove a per-user scheduled task which starts `tkitchen serve` at sign-in. The task only launches the process; the 15-minute rhythm lives inside `serve` (issue 07). Plus a README section on installing on each machine.

## Implementation map

**Precedent**: `F:/MyWork/aiLau/deploy/windows/install-task.ps1` (GROUND-006) builds task XML with a `<BootTrigger>` and registers it; `-Export <path>` writes the XML without registering; README restarts with `schtasks /End|/Run /TN aiLau`. Copy its shape with these differences:
- Trigger: `<LogonTrigger>` with `<UserId>` = the current user (`$env:USERDOMAIN\$env:USERNAME`), **not** `BootTrigger` (git and `gh` need the user's credentials).
- Principal: `<LogonType>InteractiveToken</LogonType>`, `<RunLevel>LeastPrivilege</RunLevel>`.
- Action: `node.exe` resolved from `Get-Command node` with arguments `"<repo>\src\cli\tkitchen.ts" serve`, working directory the repo root.
- Settings: `<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`, no execution time limit (`PT0S`), restart on failure 3 times every 1 minute.
- Task name `tkitchen`. Parameters: `-Export <path>`, `-TaskName` (default `tkitchen`).

**Files**: `deploy/windows/install-task.ps1`, `deploy/windows/uninstall-task.ps1` (`Unregister-ScheduledTask -TaskName tkitchen -Confirm:$false`, no error if missing), `README.md` section "Install on a machine": `npm link` or clone path, create `~/.tkitchen/config.json` (example from issue 01), `gh auth status`, run `install-task.ps1`, restart with `schtasks /End /TN tkitchen` and `schtasks /Run /TN tkitchen`.

**Mechanics left to the implementer**: PowerShell style.

## Acceptance criteria

- [x] Export writes the task XML without registering
  - Run: `npm test -- tests/deploy/install-task.test.ts`
  - Test: runs `powershell -NoProfile -File deploy/windows/install-task.ps1 -Export <temp>/task.xml -TaskName tkitchen-test`, parses the XML (skipped with a visible `skip` reason when not on Windows).
  - Expected: the file exists; it has exactly one `LogonTrigger` with the current user's `UserId`, no `BootTrigger`; the `Exec` command ends with `node.exe` and arguments end with `src\cli\tkitchen.ts" serve`; `MultipleInstancesPolicy` is `IgnoreNew`; `schtasks /Query /TN tkitchen-test` exits non-zero (not registered).
  - Fails when: the script registers on `-Export`, uses a boot trigger, or targets another command.
- [x] Uninstall is idempotent
  - Run: same file → `uninstall without a task succeeds`
  - Expected: `uninstall-task.ps1 -TaskName tkitchen-test` exits 0 when no such task exists.
  - Fails when: it throws on a missing task.

## Blocked by

- Local: `07-serve-loop-and-single-instance-lock.md` — provides `tkitchen serve`, the command the task launches. Proof: the XML criterion asserts the action runs `src\cli\tkitchen.ts serve`; real launch at sign-in is checked in issue 10.

## Implementation (eng-08, 2026-11-24)

Built deploy/windows/install-task.ps1, deploy/windows/uninstall-task.ps1, tests/deploy/install-task.test.ts, and the README "Install on a machine" section. One deviation from the aiLau precedent, proven on this machine: the precedent's encoding="UTF-8" XML declaration makes Task Scheduler reject the XML ("unable to switch the encoding"), so the script writes no encoding attribute and registers with Register-ScheduledTask -Xml. A real probe registered tkitchen-test, queried it, uninstalled it, and uninstalled it again with exit 0. Full gate: npm run verify exit 0 (99/99 tests, sim 21/21, 200 round seeds 0 violations). Evidence: F:/MyWork/tkitchen/.verification-evidence/eng-08/report.md. Ready for qa-08 review.

## Repair (eng-08, 2026-11-24, after qa-08 fail)

Fixed the qa-08 P1. Both scripts now use terminating errors, so a failed Register-ScheduledTask or export prints no success message and exits non-zero. uninstall-task.ps1 keeps exit 0 only for the not-found lookup; other lookup failures rethrow and a failed Unregister-ScheduledTask is terminating. Regression tests landed before the fix as commit 1a64af2 (the two failure-path tests failed on the shipped scripts) and the fix as 3fa0c38. The export test also uses a unique task name with finally cleanup and now asserts both UserId elements, RestartOnFailure, and WorkingDirectory. Full gate: npm run verify exit 0 (101/101 tests, sim 21/21, 200 round seeds 0 violations). Evidence: F:/MyWork/tkitchen/.verification-evidence/eng-08-repair/report.md. Ready for qa-08 re-review.
