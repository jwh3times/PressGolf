# Triage labels

The labels and what they mean are in `.agents/skills/ship/settings/triage-labels.md`. A skill's role name is the GitHub label to apply.

## Extra labels

- `blocked`: the issue can't progress now, because it waits on another open issue, an outside party
  (a store review, testers' 14 days), an upstream release, or time. It sits beside one of the five,
  usually `ready-for-human` or `ready-for-agent`, and comes off when the wait ends. Record an issue
  blocker as a native dependency too. A decision only the maintainer can make is `ready-for-human`,
  not `blocked`.
