# tkitchen

The kitchen takes orders from many producers, routes each to the stations that handle it, and records what each station did. One kitchen runs per machine. v1 watches git only. See `CONTEXT.md` for the language and `.scratch/tkitchen-v1/plan.md` for what the kitchen owns.

## Install on a machine

You need Node 22.19 or newer, git, and the GitHub CLI (`gh`) on the machine.

1. Get the code and link the `tkitchen` command. Clone this repo, then from the repo root run `npm link`. A plain clone also works. Every command below names the script and its path, so pick the path that matches how you got the code.
2. Create `~/.tkitchen/config.json`. List each repo the kitchen watches on this machine.

```json
{ "repos": [{ "name": "x", "path": "F:/r/x", "remote": "origin", "forge": "github", "bases": { "B": "C" } }], "roundMinutes": 15 }
```

   `remote` defaults to `origin` and `forge` defaults to `github`. Set `"forge": "none"` for a repo that `gh` cannot read (for example a private repo reached only over SSH): the kitchen then never runs `gh` for it and takes bases from `bases` and your reflog only, so a teammate branch you never checked out needs an entry in `bases`. `roundMinutes` defaults to 15. The kitchen reads the file at every Round, so an edit takes effect without a restart of the task itself.
3. Check that git and `gh` act as you on this machine. Run `gh auth status` and fix any sign-in problem it reports. The scheduled task runs as you at sign-in, so it uses your git and `gh` credentials.
4. Register the sign-in task. From the repo root, run `powershell -NoProfile -File deploy/windows/install-task.ps1`. The task is named `tkitchen`. It starts `tkitchen serve` when you sign in. The 15-minute rhythm lives inside `serve`.
5. To restart the kitchen, end the running task and start it again. Run `schtasks /End /TN tkitchen`, then run `schtasks /Run /TN tkitchen`.
6. To remove the task, run `powershell -NoProfile -File deploy/windows/uninstall-task.ps1`. The script succeeds when no task is registered, so you can run it twice.

To inspect the task definition without registering it, run `powershell -NoProfile -File deploy/windows/install-task.ps1 -Export <path>`. The command writes the task XML to `<path>` and registers nothing.
