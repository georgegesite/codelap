# CodeLap

Record coding sessions from PowerShell, revisit them in a local dashboard, and download a PNG with the repository name, total time, and lines added and removed.

## Set up

Install Git for Windows and Node.js 24.12 or newer. From this project's checkout, run these commands to build the CLI and make it available on your PATH.

```powershell
npm ci
npm link
```

If you linked the project as `coding-activity`, run `npm unlink --global coding-activity` before updating your checkout. Then run the setup commands above to install `codelap`.

## Record a session

From the Git repository where you're working, run each command when you need it.

```powershell
codelap start
codelap status
codelap stop
```

Open the browser dashboard from any directory with `codelap dashboard`. Keep that terminal open while you use the dashboard. Each session has a per-file recap, a **Download PNG** button, and a delete action.

The timer runs from `start` to `stop` and survives closing PowerShell or restarting Windows. Stop before a break and start again afterward to exclude that time. The recap compares the saved files at both ends, so it includes changes from commits, pulls, and branch switches that are present when you stop.

CodeLap stores its database in `%LOCALAPPDATA%\CodeLap` by default, or in `~/.codelap` when `LOCALAPPDATA` is unset or empty. To use a different directory, set `CODELAP_DATA_DIR` before recording or opening the dashboard.

Existing sessions stay in their original database. If the new default has no database, CodeLap looks for one in `%LOCALAPPDATA%\CodingActivity` or `~/.coding-activity`. The old `CODING_ACTIVITY_DATA_DIR` setting still works when `CODELAP_DATA_DIR` is unset or empty.

## Development

Run `npm run typecheck` and `npm test` to verify the project. Run `npm run build` to refresh the installed command after editing the source. [V1 product design](docs/product-design.md)
