# Human follow-up

Every required human action left by agent-completed work gets a follow-up issue, by the procedure
in the installed skills' `human-follow-up` settings definition (for example
`.agents/skills/end-session/settings/human-follow-up.md`). Most are device checks, such as #120: a
behavior built and checked in Jest and the web build that still needs a phone, or a course. The
issue body holds the numbered steps and its `## Done when`; there is no wiki.

The destination is public on purpose: there is no private repository. Keep secrets, resolved
1Password values, the Supabase project ref and unpatched-security detail out of it; a security
remediation follows the default `Security findings` route, a draft repository advisory.

## Follow-up label

`ready-for-human` (plus an area label such as `accessibility` where one fits)
