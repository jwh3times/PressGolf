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

The web preview is not the accessibility authority for this native app:
React Native Testing Library mounts the components that ship on iOS and
Android. The web suite (`tests/web`, see
[testing-and-ci.md](testing-and-ci.md#ui-regression-and-accessibility-web))
complements it on every pull request. axe checks each main screen against WCAG
2.1 A and AA, and the screen's accessibility tree (roles, names, states) is
committed as a text snapshot, so a renamed or unnamed control shows up as a
diff.

When it was introduced (October 2026), the web suite found:

- **Text fields had no accessible name.** `Field` showed its label as visible
  text only, so VoiceOver and TalkBack announced "text field" with no name.
  The label is now the input's accessible name, on native as well as web.
- **The tab bar wasn't a tab list,** so screen readers couldn't say "tab 2 of
  4". The bar is now `tablist`, and the current tab is marked selected.
- **Switches and disabled buttons had no state on web.** react-native-web
  ignores `accessibilityState`. Switches now use `aria-checked`, and disabled
  buttons use `Pressable`'s `disabled` prop. Both work on native too.
- **The Round live card overflowed at 320 px.** Its row now wraps, so the
  Enter scores button drops inside the card
  ([issue #72](https://github.com/jwh3times/PressGolf/issues/72); checked on an
  iPhone at a narrow display setting, October 2026).

Selected state on chips and option buttons is still exposed through
`accessibilityState` only. Native screen readers announce it, but web doesn't,
because ARIA doesn't allow `aria-selected` on a button and React Native has no
`aria-pressed`.

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

Later features had the same iOS pass at maximum text size and with VoiceOver:

- Handicaps ([issue #57](https://github.com/jwh3times/PressGolf/issues/57),
  October 2026): iPhone 16 Pro, iOS 27.0. The Format tab's Handicaps card and
  pops rows, recalculating after a tee change, the roster's index field, and
  the outing's field pots. The Android half moved to issue #22.
- Card entry of presses and Wolf picks
  ([issue #39](https://github.com/jwh3times/PressGolf/issues/39), October 2026):
  the card grid's Wolf row and picker, including RESET, and adding and removing
  a press. Also switching Wolf on for a card from the Format tab.

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
3. Check Home, Format, Score (both Hole by hole and Whole card), Settle,
   Settings, and Outing in portrait.
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
