/**
 * Credential checks and error copy.
 *
 * Kept free of React and of Supabase so the rules can be tested directly. The
 * checks run before a request leaves the phone — not to replace the server's
 * validation, but so that a typo costs nothing on a tee box with one bar of
 * signal.
 */

/** Supabase's own floor is 6; 8 is the app's, and the server never sees less. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Deliberately loose. Anything stricter starts rejecting addresses that are
 * perfectly valid, and the server is the real authority.
 */
export function emailProblem(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Enter your email address.';
  if (/\s/.test(trimmed)) return 'An email address cannot contain spaces.';
  const at = trimmed.indexOf('@');
  if (at < 1 || at !== trimmed.lastIndexOf('@')) return 'That does not look like an email address.';
  const domain = trimmed.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return 'That does not look like an email address.';
  }
  return null;
}

export function passwordProblem(password: string): string | null {
  if (!password) return 'Enter a password.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Normalised before it is sent, so casing never splits one person in two. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Turns what the server says into something worth reading on a phone.
 *
 * Supabase's messages are written for developers. Anything not recognised is
 * passed through rather than swallowed — an unknown failure the user can quote
 * back is more useful than "Something went wrong".
 */
export function authErrorMessage(raw: string): string {
  const message = raw.trim();
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) {
    return 'That email and password do not match an account.';
  }
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'There is already an account with that email. Sign in instead.';
  }
  if (lower.includes('email not confirmed')) {
    return 'That account still needs its email confirmed.';
  }
  if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
    return 'This server is not accepting new accounts.';
  }
  if (lower.includes('password should be at least')) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  // The built-in mail service sends two messages an hour for the whole project,
  // so this is not an edge case when a group signs up together — say what is
  // actually happening rather than blaming the person tapping the button.
  if (lower.includes('email rate limit exceeded') || lower.includes('over_email_send_rate_limit')) {
    return 'The server has hit its limit for confirmation emails this hour. Yours will send shortly — try again in a little while.';
  }
  if (lower.includes('for security purposes') || lower.includes('after 60 seconds')) {
    return 'Just a moment — another email was sent seconds ago.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  // Fetch failures surface as a TypeError from the runtime, not as anything
  // Supabase wrote, and they are by far the likeliest thing out on a course.
  if (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed')
  ) {
    return 'Could not reach the server. Check your signal and try again.';
  }
  return message || 'Something went wrong. Try again.';
}
