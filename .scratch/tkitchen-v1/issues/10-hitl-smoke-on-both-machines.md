---
repo: F:/MyWork/tkitchen
status: closed
type: HITL
covers: [RB-008 (Node 22.22), RB-011 (measured workload), US-004 (real sign-in), DEC-007 (real gh), Edges (setup on both machines)]
---

## Parent

`.scratch/tkitchen-v1/PRD.md`

## What to build

Nothing new. A human installs tkitchen on the home machine and on the work laptop and checks what no headless test can: Node 22.22 on the work laptop, real `gh` against real repos, the sign-in task, and the round timings.

## Implementation map

- Install per `README.md` "Install on a machine" (issue 08).
- Config: 2-3 real repos per machine with stacked PRs (work: `github.com/Aspia-MyBusiness/*`).
- Record results in this file under `## Comments`.

## Acceptance criteria

- [ ] Node 22.22 on the work laptop
  - Steps: on the work laptop run `node --version` (expect `v22.22.x`), `npm ci`, `npm run verify`, `tkitchen --help`.
  - Expected: all pass with no flag and no build step.
- [ ] Real gh bases
  - Steps: `gh auth status`; `tkitchen round`; `tkitchen notices`.
  - Expected: a teammate's stacked PR branch shows with `evidence: pr` (or up to date); no `needs_base` for branches that have an open PR.
- [ ] Sign-in launch
  - Steps: `deploy/windows/install-task.ps1`; sign out and in; `Get-Content ~/.tkitchen/kitchen.lock`; wait 16 minutes; `tkitchen notices --json`.
  - Expected: the lock holds a live `node` pid; `rounds[].lastCompleteAt` is within the last 16 minutes.
- [ ] Workload (RB-011, measured, not a gate)
  - Steps: from the serve log, note quiet Round and fetch Round durations per repo on each machine.
  - Expected: numbers recorded; compare with 3-4 s quiet and 6-13 s with fetch (home, 2026-11-22).
- [ ] A real push produces a notice
  - Steps: push a commit to a base branch that has a child PR; wait for the next Round.
  - Expected: `tkitchen notices` lists the child as behind by the pushed count.

## Blocked by

- Local: `05-github-pr-targets-via-gh.md`, `06-round-fault-tolerance-under-dst.md`, `07-serve-loop-and-single-instance-lock.md`, `08-sign-in-launch-task.md`, `09-export-for-ainho.md`.

## Comments

### 2026-11-25 — closed by the user

Closed by the user. Seen on the work laptop: Node v22.22.1, and the sign-in task `tkitchen` is installed and running `tkitchen serve`. The other checks were not recorded here.
