import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import worker, { type Env } from '../worker';

/**
 * The reset and confirmation pages against a real local Supabase stack.
 *
 * The admin API makes the same token an email would carry, so no mail service
 * is needed. Everything asserted is what the person or the server sees
 * afterwards: which password signs in, which sessions still refresh, whether
 * the address is confirmed.
 */

const SERVER = process.env.SUPABASE_TEST_URL!;
const ANON = process.env.SUPABASE_TEST_ANON_KEY!;
const RUN = `l${Date.now().toString(36)}`;
const OLD_PASSWORD = 'old-password-for-tests';
const NEW_PASSWORD = 'new-password-for-tests';

const env: Env = {
  ASSETS: { fetch: async () => new Response('static page') },
  SUPABASE_URL: SERVER,
  SUPABASE_ANON_KEY: ANON,
};

const admin = createClient(SERVER, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A phone of its own: its own session, nothing saved anywhere. */
function phone(): SupabaseClient {
  return createClient(SERVER, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

let accounts = 0;
function address(name: string): string {
  return `${name}-${RUN}-${++accounts}@example.com`;
}

async function confirmedAccount(name: string): Promise<{ email: string; id: string }> {
  const email = address(name);
  const { data, error } = await admin.auth.admin.createUser({ email, password: OLD_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return { email, id: data.user.id };
}

/** The token_hash a reset or confirmation email would link to. */
async function linkToken(type: 'recovery' | 'signup', email: string, password?: string): Promise<{ token: string; id: string }> {
  const { data, error } =
    type === 'signup'
      ? await admin.auth.admin.generateLink({ type, email, password: password! })
      : await admin.auth.admin.generateLink({ type, email });
  if (error || !data.properties) throw new Error(`generateLink: ${error?.message}`);
  return { token: data.properties.hashed_token, id: data.user.id };
}

function open(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://pressgolf.cc${path}`), env);
}

function send(path: string, fields: Record<string, string>): Promise<Response> {
  return worker.fetch(
    new Request(`https://pressgolf.cc${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  );
}

async function signsIn(email: string, password: string): Promise<boolean> {
  const { data } = await phone().auth.signInWithPassword({ email, password });
  return data.session != null;
}

describe('resetting a password from the email link', () => {
  it('opening the link spends nothing, and Set password changes the password', async () => {
    const account = await confirmedAccount('reset');
    const { token } = await linkToken('recovery', account.email);

    // A mail scanner opening the link first, twice.
    expect(await (await open(`/reset/?token_hash=${token}`)).text()).toContain('Set password');
    expect(await (await open(`/reset/?token_hash=${token}`)).text()).toContain('Set password');

    const done = await send('/reset/', { token_hash: token, password: NEW_PASSWORD, confirm: NEW_PASSWORD });
    expect(await done.text()).toContain('Your password is set');
    expect(await signsIn(account.email, NEW_PASSWORD)).toBe(true);
    expect(await signsIn(account.email, OLD_PASSWORD)).toBe(false);
  });

  it('signs out every phone that was signed in', async () => {
    const account = await confirmedAccount('phones');
    const other = phone();
    const { data: before } = await other.auth.signInWithPassword({ email: account.email, password: OLD_PASSWORD });
    expect(before.session).not.toBeNull();

    const { token } = await linkToken('recovery', account.email);
    await send('/reset/', { token_hash: token, password: NEW_PASSWORD, confirm: NEW_PASSWORD });

    // The other phone's next refresh is refused, which the app reads as signed out.
    const { error } = await other.auth.refreshSession();
    expect(error).not.toBeNull();
  });

  it('refuses a link that has been used', async () => {
    const account = await confirmedAccount('used');
    const { token } = await linkToken('recovery', account.email);
    await send('/reset/', { token_hash: token, password: NEW_PASSWORD, confirm: NEW_PASSWORD });

    const again = await send('/reset/', { token_hash: token, password: 'a-third-password', confirm: 'a-third-password' });
    expect(await again.text()).toContain('This link has expired or has already been used');
    expect(await signsIn(account.email, NEW_PASSWORD)).toBe(true);
  });

  it('keeps the link when the two passwords differ', async () => {
    const account = await confirmedAccount('typo');
    const { token } = await linkToken('recovery', account.email);
    const typo = await send('/reset/', { token_hash: token, password: NEW_PASSWORD, confirm: `${NEW_PASSWORD}x` });
    expect(await typo.text()).toContain("The two passwords don't match.");

    await send('/reset/', { token_hash: token, password: NEW_PASSWORD, confirm: NEW_PASSWORD });
    expect(await signsIn(account.email, NEW_PASSWORD)).toBe(true);
  });

  it('lets the person try again when the server refuses the new password', async () => {
    const account = await confirmedAccount('same');
    const { token } = await linkToken('recovery', account.email);
    // The server refuses the current password as the new one; locally that's
    // the refusal it is sure to make, as the leaked-password check is hosted only.
    const refused = await (await send('/reset/', { token_hash: token, password: OLD_PASSWORD, confirm: OLD_PASSWORD })).text();
    expect(refused).toContain('That is your current password. Choose a new one.');
    const session = /name="session" value="([^"]+)"/.exec(refused)?.[1];
    expect(session).toBeTruthy();

    const done = await send('/reset/', { session: session!, password: NEW_PASSWORD, confirm: NEW_PASSWORD });
    expect(await done.text()).toContain('Your password is set');
    expect(await signsIn(account.email, NEW_PASSWORD)).toBe(true);

    // The session the page used is over too: nobody is left signed in where the link was opened.
    const after = await fetch(`${SERVER}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${session}` } });
    expect(after.ok).toBe(false);
  });
});

describe('confirming an address from the email link', () => {
  it('opening the link spends nothing, and Confirm my email confirms it', async () => {
    const email = address('confirm');
    const { token, id } = await linkToken('signup', email, OLD_PASSWORD);
    const confirmedAt = async () => (await admin.auth.admin.getUserById(id)).data.user?.email_confirmed_at ?? null;
    expect(await confirmedAt()).toBeNull();

    expect(await (await open(`/confirm/?token_hash=${token}`)).text()).toContain('Confirm my email');
    expect(await confirmedAt()).toBeNull();

    expect(await (await send('/confirm/', { token_hash: token })).text()).toContain('Your email is confirmed');
    expect(await confirmedAt()).not.toBeNull();
    expect(await signsIn(email, OLD_PASSWORD)).toBe(true);
  });

  it('refuses a link that has been used', async () => {
    const email = address('confirm-used');
    const { token } = await linkToken('signup', email, OLD_PASSWORD);
    await send('/confirm/', { token_hash: token });
    const again = await send('/confirm/', { token_hash: token });
    expect(await again.text()).toContain('This link has expired or has already been used');
  });
});
