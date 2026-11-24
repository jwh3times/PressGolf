# Triage labels

The labels and what they mean are in `.agents/skills/open-pr/settings/triage-labels.md`. A skill's role name is the GitHub label to apply.

## Extra labels

- `blocked`: the issue can't progress now, because it waits on another open issue, an outside party
  (a store review, testers' 14 days), an upstream release, or time. It sits beside one of the five,
  usually `ready-for-human` or `ready-for-agent`, and comes off when the wait ends. Record an issue
  blocker as a native dependency too. A decision only the maintainer can make is `ready-for-human`,
  not `blocked`.
- `report`: an issue CI keeps open and rewrites as a status report: the Native nightly report
  (#87), which `native-e2e.yml` updates after each scheduled run. It is not a task and stays off
  the board: triage gives it none of the five state labels, and a scan for what to work on counts it with
  the parked items. If the issue is closed, the workflow opens a new one with the label.
