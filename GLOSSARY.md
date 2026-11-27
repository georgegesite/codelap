# CodeLap

This context describes how developers record coding sessions and review their activity over time.

## Language

**Coding Session**:
A period of work in one Git repository that the developer explicitly starts and stops recording.

**Session Repository**:
The local Git repository whose changes are included in a coding session.

**Repository Name**:
The name of the session repository's local root folder, used in activity history and on the stats PNG.

**Recorded Time**:
The elapsed time from the start of a coding session to its end. An open session reports the elapsed time so far.

**Session Recap**:
The summary of a finished coding session, including its recorded time and a per-file breakdown of the changes.

**Session Changes**:
The differences between saved file contents at the start and end of a coding session, summarized as files changed, lines added, and lines removed. The scope covers tracked files and untracked files Git does not ignore.

**Activity History**:
The developer's private record of finished coding sessions on the machine where they were recorded. It identifies sessions by repository name and start date and time.

**Stats PNG**:
A downloadable image from a finished coding session showing the repository name, recorded time, lines added, and lines removed.
