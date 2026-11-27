# CodeLap V1 Design

Record a coding session from a Git repository, revisit it in a private activity history, and export a PNG to share. The first supported environment is Windows with PowerShell and Git.

## Terminal workflow

| Command | Behavior |
| --- | --- |
| `start` | Capture the repository's starting file state, start the timer, and show the repository name and start time. If the repository already has an open session, show that session and its original start time. |
| `status` | Show the elapsed time for the open session in this repository. |
| `stop` | Mark the stop time, compare the starting and ending file states, and save the recap to local history. |
| `dashboard` | Open the private activity history in a local browser tab. |

Resolve the repository from the terminal's current directory, including subdirectories. An open session survives closing the terminal or restarting the machine. The timer measures elapsed time from start to stop, including breaks while the session is open. To exclude a break, stop before it and start a fresh session afterward.

## What the activity measures

Compare saved file contents at the start and end of the session. Include tracked files and untracked files Git does not ignore. Changes already present at the start form part of the baseline. Additions and removals that were later undone cancel out in the final comparison.

Commits during a session preserve the original baseline. File changes from pulls, branch switches, formatters, or other tools count whenever they are present at stop. The recap describes the change in file contents over that period.

Record the number of changed files and the total lines added and removed. Keep each changed file's repository-relative path and counts for the recap.

## Dashboard and PNG

The history opens to the most recent sessions. Each row shows the local repository folder name, start date and time, recorded time, files changed, and lines added and removed. Opening a row shows the recap and its per-file breakdown. A developer can delete a mistaken session from its recap.

The recap provides a PNG preview and download. The card contains four fields, using the same saved values as the recap.

- Repository name
- Total time
- Lines added
- Lines removed

Use the local root folder name as the repository name. A clone in `checkout-sandbox` appears as `checkout-sandbox` in both the history and the PNG.

## Local data

Store the open session and the temporary comparison data on the recording machine so a later terminal process can finish it. Save the finished session's repository label, start and stop times, totals, and per-file paths and counts. Release the temporary comparison data after saving the recap. Keep the session open if the comparison or save fails so the developer can retry.

The dashboard reads the same local activity history used by the terminal. Exporting the PNG saves an image the developer can share.

## Proposed defaults for review

- Allow one open session per repository. Commands always act on the repository they resolve from the current directory.
- Save sessions with zero changes so reading and debugging can still have an activity record.
- Count changed binary files in the file total and show an unavailable value for their line counts. Count an identifiable pure rename as one changed file with zero lines added or removed.
- Use a square 1,080 × 1,080 PNG. Label each number and give the repository name space to wrap.

## Build order

1. Build the terminal workflow and local session storage. Verify that separate terminal processes and a machine restart can recover an open session.
2. Implement start-to-stop comparison and recap storage. Verify pre-existing edits, new and ignored files, commits, pulls, and edits that are undone. Check that an interrupted stop can be retried.
3. Build the local history and recap views. Verify that opening a session shows its saved file counts and that deleting a recap removes it from the history.
4. Add PNG preview and export. Check that the downloaded image matches the saved stats and stays readable with long repository names.

The end-to-end check is to start in a local repository with existing edits, make and commit a small change, close and reopen PowerShell, check the elapsed time, stop, and open the recap and download its PNG. The recap should count only the difference from the starting file state and the PNG should show the four agreed fields.
