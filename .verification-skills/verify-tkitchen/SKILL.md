---
name: verify-tkitchen
description: Drive the tkitchen CLI (round, notices, notices --history, serve, export, board, and the Windows sign-in task scripts) against real git repos in an isolated temp world with a fake gh, and capture transcripts as proof. Use to verify any tkitchen change that a user could observe from the command line.
---

# Verify tkitchen

tkitchen is a Node CLI (`cli/tkitchen.ts`, no build step). A user touches it in four ways: `tkitchen round` and `tkitchen serve` read git remotes and write `~/.tkitchen/kitchen.db`; `tkitchen notices` and `tkitchen export` read that store; `deploy/windows/*.ps1` register the sign-in task. Everything here drives that real CLI against real git. The only stand-in is `gh`. A fake `gh` on `PATH` returns the PR list from a JSON file. That is the production boundary: the kitchen only ever runs `gh pr list --json ...`.

## Launch

From the repo root, once per checkout: `npm ci`. Node >= 22.19 with no flags.

Each drive builds its own world with the helper `node .verification-skills/verify-tkitchen/scripts/vt.mjs`:

```bash
VT=.verification-skills/verify-tkitchen/scripts/vt.mjs
R=.verification-evidence/verify-tkitchen/$(date +%Y%m%d-%H%M%S)-mycheck
node $VT new $R        # bare origin.git with main, clones dev/ and mate/, home/config.json watching repo "x" at dev/
node $VT doctor $R     # must print only "ok" lines
```

The world is ready when `doctor` exits 0. There is no server for `round`, `notices`, or `export`: each `kt` call is one process. `serve` is started with `serve-start` (see Drive).

## Doctor

`node $VT doctor $R` is read-only. It checks the Node floor, git, `node_modules`, that `home/` is not your real `~/.tkitchen`, that the fake `gh` is first on `PATH`, and it prints the current `kitchen.lock`. Run it whenever a result looks off.

## Drive

Helper verbs (all take the run dir `$R` first):

| Verb                                  | Effect                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branch $R <dev\|mate> <name> <from>` | `checkout -b name origin/from`, one commit, push. From `dev`, this is a **named creation** in the round's clone (reflog evidence). From `mate`, the round's clone has no reflog for it. |
| `branch-oid $R dev <name> <from>`     | `git branch name <oid of from>`: a **commit creation** (reflog-tip evidence)                                                                                                            |
| `commit $R <clone> <branch> [n]`      | push n commits on top of `origin/<branch>`                                                                                                                                              |
| `merge $R <clone> <into> <from>`      | `merge --no-ff` and push                                                                                                                                                                |
| `bases $R '<json>'`                   | set config `bases` for repo x, e.g. `'{"B":"C"}'`                                                                                                                                       |
| `prs $R '<json>'`                     | open PRs the fake gh returns: `'[["head","base"],["h2","base","fork"]]'`                                                                                                                |
| `set-url $R <url\|ORIGIN>`            | break or restore dev's origin URL                                                                                                                                                       |
| `kt $R [ENV=V ...] -- <args>`         | run the real `tkitchen <args>` in the world. Example: `kt $R FAKE_GH_FAIL=1 -- round` makes gh fail                                                                                     |
| `serve-start $R [roundMinutes]`       | start `tkitchen serve` detached; prints its pid                                                                                                                                         |
| `board-start $R`                      | start `tkitchen board --port 0` detached, output in `board.log`; prints its pid                                                                                                         |
| `sql $R '<select>'`                   | read-only query on `home/kitchen.db`                                                                                                                                                    |
| `refs $R`                             | all refs of the bare origin                                                                                                                                                             |
| `cleanup $R`                          | kill only the serve and board processes this run started                                                                                                                                |

Ready-made journeys, one per feature, run every check and print `PASS`/`FAIL` lines plus a summary:

```bash
bash .verification-skills/verify-tkitchen/scripts/journeys/<feature>.sh
```

The journeys are `round-and-notices`, `automatic-base`, `pr-base`, `git-failure`, `serve-and-lock`, `export`, `board`, and `sign-in-task` (Windows only). Set `VT_STAMP` to share one timestamp across a batch. See `features/README.md`.

## Evidence

Every run dir keeps three files. `transcript.log` holds every helper action and every `tkitchen` call, with stdout, stderr, and exit code. `checks.log` holds each check with its actual value. The store is `home/kitchen.db`. Proof standards:

- Drive the real CLI. Never call application functions, and never write to `kitchen.db` directly. Read it only with `sql`.
- A notice claim needs both `notices --json` and the `branch_state` / `event` rows behind it.
- "Changes nothing" claims compare a full SQL snapshot before and after, not a count alone.
- "Never writes to the repo" claims compare `refs` of the bare origin before and after.

Evidence lives under `.verification-evidence/verify-tkitchen/`, which is gitignored via `.git/info/exclude`. Copy anything that must survive into `.scratch/<feature>/evidence/`.

## Cleanup

`node $VT cleanup $R` kills the serve and board pids recorded in `$R/state.json` and nothing else. Never kill `node` by name: the user's own kitchen may be running. Cleanup keeps the run dir and its evidence. Delete old run dirs by hand when they are no longer cited.

## Risks

- Never point `TKITCHEN_HOME` at the real `~/.tkitchen`, and never run `install-task.ps1` without `-Export` here: either one touches the user's live kitchen. The sign-in journey uses `-TaskName tkitchen-verify` and `-Export` only.
- A `DEP0190` warning on stderr is a regression (fixed in FB-3): gh must not be spawned with an args array plus `shell: true`.
- Real `gh` against real repos, the real sign-in, and Node 22.22 on the work laptop are not covered here. That is issue 10, the HITL smoke.
