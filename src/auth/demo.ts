/**
 * What the sign-in screen says when someone trying the demo (#275) reaches for
 * something that needs an account. Each action that needs one stops the demo
 * with its line, and the sign-in screen shows it.
 */
export const NEEDS_AN_ACCOUNT = {
  ownData:
    'Your own groups and rounds need an account. Sign in or create one; the demo stays here for later.',
  share: 'Sharing an outing needs an account, so the other phones know whose card is whose.',
  join: 'Joining an outing needs an account.',
} as const;

/** Which thing needed an account. The sign-in screen words it from NEEDS_AN_ACCOUNT. */
export type NeedsAnAccount = keyof typeof NEEDS_AN_ACCOUNT;
