# ADR 0004: the CLI is a module

Status: accepted, 2026-11-26. Amends the layout in ADR 0001 and ADR 0003.

ADR 0003 left the composition root as one file beside the modules, at `cli/tkitchen.ts`. That file mixed three jobs. It read the words on the command line. It wired every module's adapters to its contracts. It owned the process. The first job is pure and had no unit tests of its own. The file also needed its own slot in every path-keyed check, where no other module needed one.

ts-template puts the command-line reading in a module at `app/modules/cli/` and keeps the program entry thin. tkitchen now follows that shape, translated to its own rules. `modules/cli/lib/contract.ts` names the commands as one union. `modules/cli/lib/parse.ts` turns words into a command or a refusal, and its tests run without a process. `modules/cli/lib/adapters/run.ts` wires the adapters and runs a command. `modules/cli/lib/adapters/main.ts` is the executable, twelve lines that hand `process.argv` to the wiring and set the exit code. It sits in `lib/adapters/` because the module rules put process access there, and the existing seam rules already fence that folder. `modules/cli/index.ts` and `adapters.ts` are the entries, like every other module.

The move changes no behavior. The `tests/cli/` suite drives the same commands through a real process before and after. Every hard-coded path moved in the same commit, as in phase 8: the `bin` entry, the Windows installer, verify-tkitchen, and the path lists in `tsconfig.json` and the seams script. The checkers themselves are untouched. The new files fall under the `modules/**` patterns that already govern lint, seams, and structure.

Rejected: a thin entry at the repository root, beside `index.ts`. It would match ts-template's `app/main.ts` by appearance. But no existing check pattern covers a second root file, so it would escape the magic-number override, the structure check, and the seam scan until each was repointed at it. Inside `lib/adapters/` the entry is covered on day one.
