Closes #

<!-- Keep this line first. `Closes #N` when this PR finishes the issue, `Part of #N` when it is one slice of a spec that stays open. An exempt change with no issue deletes the line. A change the user waived the flow for adds `Flow waived by the user: <reason>`. See docs/agents/dev-flow.md. -->

## Summary

<!-- What user or contributor outcome does this change produce? -->

## Verification

<!-- List commands, devices, simulators, and manual flows actually run. -->

- [ ] `npm run test:coverage`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npx expo-doctor` when dependencies or app configuration changed

## Impact review

- [ ] Tests cover changed behavior, or this is documentation/configuration only
- [ ] Accessibility and maximum text size were considered for UI changes
- [ ] iOS and Android/native-build impact was considered
- [ ] Database and RLS impact was considered
- [ ] Documentation and known limitations are current
- [ ] No secret or resolved credential is included
