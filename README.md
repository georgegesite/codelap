# Coding Activity

Record coding sessions from PowerShell, revisit them in a local dashboard, and download a PNG with the repository name, total time, and lines added and removed.

## Set up

Install Git for Windows and Node.js 24.12 or newer. From this project's checkout, run these commands to build the CLI and make it available on your PATH.

```powershell
npm ci
npm link
```

## Record a session

From the Git repository where you're working, run each command when you need it.

```powershell
coding-activity start
coding-activity status
coding-activity stop
```

Open the browser dashboard from any directory with `coding-activity dashboard`. Keep that terminal open while you use the dashboard. Each session has a per-file recap, a **Download PNG** button, and a delete action.

The timer runs from `start` to `stop` and survives closing PowerShell or restarting Windows. Stop before a break and start again afterward to exclude that time. The recap compares the saved files at both ends, so it includes changes from commits, pulls, and branch switches that are present when you stop.

Session history is stored on the recording machine in `%LOCALAPPDATA%\CodingActivity`. To use a different local directory, set the `CODING_ACTIVITY_DATA_DIR` environment variable before recording or opening the dashboard.

## Development

Run `npm run typecheck` and `npm test` to verify the project. Run `npm run build` to refresh the installed command after editing the source. [V1 product design](docs/product-design.md)
