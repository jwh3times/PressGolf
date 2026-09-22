import {
  MIN_PASSWORD_LENGTH,
  authErrorMessage,
  emailProblem,
  normaliseEmail,
  passwordProblem,
} from '../validate';

describe('emailProblem', () => {
  it('accepts an ordinary address', () => {
    expect(emailProblem('jerry@example.com')).toBeNull();
  });

  it('accepts the awkward but legal ones', () => {
    expect(emailProblem('first.last+tag@sub.example.co.uk')).toBeNull();
    expect(emailProblem("o'brien@example.com")).toBeNull();
  });

  it('asks for something rather than nothing', () => {
    expect(emailProblem('')).toBe('Enter your email address.');
    expect(emailProblem('   ')).toBe('Enter your email address.');
  });

  it('rejects what is plainly not an address', () => {
    expect(emailProblem('jerry')).not.toBeNull();
    expect(emailProblem('jerry@')).not.toBeNull();
    expect(emailProblem('@example.com')).not.toBeNull();
    expect(emailProblem('jerry@example')).not.toBeNull();
    expect(emailProblem('jerry@@example.com')).not.toBeNull();
    expect(emailProblem('jerry@.com')).not.toBeNull();
    expect(emailProblem('jerry@example.')).not.toBeNull();
  });

  it('calls out a space, which is what a phone keyboard adds', () => {
    expect(emailProblem('jerry @example.com')).toBe('An email address cannot contain spaces.');
  });

  it('ignores surrounding whitespace', () => {
    expect(emailProblem('  jerry@example.com  ')).toBeNull();
  });
});

describe('passwordProblem', () => {
  it('accepts one at the floor', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it('rejects one below it', () => {
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(
      `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  });

  it('asks for one when empty', () => {
    expect(passwordProblem('')).toBe('Enter a password.');
  });

  it('never trims — a space is a character like any other', () => {
    expect(passwordProblem(`   ${'a'.repeat(MIN_PASSWORD_LENGTH - 2)}`)).toBeNull();
  });
});

describe('normaliseEmail', () => {
  it('lowercases and trims, so one person stays one account', () => {
    expect(normaliseEmail('  Jerry@Example.COM ')).toBe('jerry@example.com');
  });
});

describe('authErrorMessage', () => {
  it('rewrites the ones people actually hit', () => {
    expect(authErrorMessage('Invalid login credentials')).toBe(
      'That email and password do not match an account.',
    );
    expect(authErrorMessage('User already registered')).toMatch(/already an account/);
    expect(authErrorMessage('Email not confirmed')).toMatch(/needs its email confirmed/);
    expect(authErrorMessage('Signups not allowed for this instance')).toMatch(/not accepting/);
  });

  it('explains the two-an-hour mail cap rather than blaming the person', () => {
    const message = authErrorMessage('email rate limit exceeded');
    expect(message).toMatch(/limit for confirmation emails/);
    expect(authErrorMessage('over_email_send_rate_limit')).toBe(message);
  });

  it('recognises the sixty-second gap between sends', () => {
    expect(authErrorMessage('For security purposes, you can only request this after 60 seconds.')).toMatch(
      /another email was sent/,
    );
  });

  it('keeps the mail cap distinct from a generic rate limit', () => {
    expect(authErrorMessage('Request rate limit reached')).toBe(
      'Too many attempts. Wait a minute and try again.',
    );
  });

  it('treats a failed fetch as the signal problem it almost always is', () => {
    expect(authErrorMessage('Network request failed')).toMatch(/Check your signal/);
    expect(authErrorMessage('TypeError: Failed to fetch')).toMatch(/Check your signal/);
  });

  it('matches regardless of case', () => {
    expect(authErrorMessage('INVALID LOGIN CREDENTIALS')).toBe(
      'That email and password do not match an account.',
    );
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(authErrorMessage('Postgres is on fire')).toBe('Postgres is on fire');
  });

  it('still says something when handed nothing', () => {
    expect(authErrorMessage('   ')).toBe('Something went wrong. Try again.');
  });
});
