# Accessibility

Accessibility is tested at the component, screen, theme, layout, and physical
device levels. Automated checks prevent known regressions, but they do not
substitute for assistive-technology use on both platforms.

## Automated guarantees

- Every rendered button in the mounted screen suite has an accessible name.
  Primitive tests also verify button, switch, selection, disabled, and state
  semantics.
- All static source font sizes are at least `MIN_FONT_SIZE` (10). The test scans
  direct `fontSize` declarations, conditional literal sizes, and the shared
  display/mono primitives.
- Theme ink tokens meet WCAG AA contrast on every supported surface. The test
  measures alpha compositing and relative luminance rather than comparing
  hard-coded color strings.
- Dense screens switch to large-text layouts at a font scale of 1.8. Fixed
  controls can grow up to the shared 2.25 control scale while surrounding
  layouts reflow.
- Shared text primitives control both font size and line height to prevent
  custom-font clipping at accessibility sizes.

Relevant tests and helpers:

- `src/app/__tests__/accessible-controls.test.tsx`
- `src/components/__tests__/primitives.test.tsx`
- `src/components/__tests__/TabBar.test.tsx`
- `src/theme/__tests__/contrast.test.ts`
- `src/theme/__tests__/type-scale.test.ts`
- `src/hooks/__tests__/useLargeText.test.ts`

The web preview is not the accessibility authority for this native app.
React Native Testing Library mounts the components that ship on iOS and
Android; Playwright and axe are therefore not part of the current gate.

## Completed iOS validation

In September 2026, the app was tested in Expo Go on iOS with Larger
Accessibility Sizes enabled and the slider at maximum. Home, Format, Score,
Settle, Settings, and Outing were checked after fixing clipped labels, values,
ranks, buttons, status text, and undersized fixed controls.

A full VoiceOver flow was then completed on iOS hardware using swipe navigation:

1. Sign in.
2. Start a round.
3. Enter scores for several holes.
4. Read and complete settlement.
5. Post the result to the season ledger.

No blocking iOS screen-reader issue remained at the close of
[issue #10](https://github.com/jwh3times/PressGolf/issues/10).

## Required Android follow-up

Physical Android validation remains open in
[issue #22](https://github.com/jwh3times/PressGolf/issues/22). The acceptance
criteria are:

- At maximum Android font size, Home, Format, Score, Settle, Settings, and
  Outing remain usable without clipped or missing names, ranks, values, or
  money figures.
- With TalkBack and swipe navigation, a user can sign in, start a round, enter
  scores, settle, and post to the ledger without an unnamed control,
  double-announcement, skipped content, or navigation trap.
- Any Android-specific defects are fixed or split into focused issues.

The passing Android emulator/Maestro run proves the native round flow, not
TalkBack semantics or physical-device rendering.

## Regression checklist

For a control, typography, or layout change:

1. Run `npm run test:coverage`.
2. Set the platform text size to its maximum accessibility setting.
3. Check Home, Format, Score, Settle, Settings, and Outing in portrait.
4. Confirm important text reflows rather than truncates, score entry remains
   possible, settlement amounts remain readable, and the tab bar does not cover
   content.
5. Navigate the changed flow with VoiceOver or TalkBack using swipe navigation,
   not direct taps.
6. Record the platform, OS version, device, build type, and result in the pull
   request or issue.

Use font-growth caps only for genuinely fixed controls or dense score-grid
elements. Prefer reflowing or stacking content so body copy can honor the
user's chosen text size.
