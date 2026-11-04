/**
 * @jest-environment node
 */
import worker, { type Env } from '../worker';

/**
 * The site's Worker with the network replaced: the reset and confirmation pages'
 * branches, checked through the Worker's own fetch handler. The real exchange
 * with Supabase is in link-pages.integration.test.ts.
 */

const SUPABASE = 'https://auth.test';
const ASSET = new Response('static page');

const assets = { fetch: jest.fn(async (_request: Request) => ASSET) };
const env: Env = { ASSETS: assets, SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: 'anon-key' };

type Reply = { status: number; body?: unknown };
let replies: Record<string, Reply[]>;
let calls: { method: string; path: string; auth: string | null; body: unknown }[];

/** The path a request to Supabase went to, with its query. */
function route(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

beforeEach(() => {
  assets.fetch.mockClear();
  replies = {};
  calls = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = route(url);
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? 'GET',
      path,
      auth: headers.get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    // Every call carries the project's key; one without it gets the refusal Supabase would give.
    if (headers.get('apikey') !== 'anon-key') return new Response('{"msg":"no apikey"}', { status: 401 });
    const answer = replies[path]?.shift() ?? { status: 500, body: { msg: `unexpected ${path}` } };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status });
  });
});

afterEach(() => jest.restoreAllMocks());

function reply(path: string, ...answers: Reply[]) {
  replies[path] = [...(replies[path] ?? []), ...answers];
}

const VERIFIED = { status: 200, body: { access_token: 'recovery-session', refresh_token: 'r', user: { id: 'u' } } };

async function get(path: string, target: Env = env): Promise<Response> {
  return worker.fetch(new Request(`https://pressgolf.cc${path}`), target);
}

async function post(path: string, fields: Record<string, string>, target: Env = env): Promise<Response> {
  return worker.fetch(
    new Request(`https://pressgolf.cc${path}`, {
      method: 'POST',
      // As a browser sends a form.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
    target,
  );
}

/** The value of a hidden field in a rendered form, or null. */
function hidden(html: string, name: string): string | null {
  return new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? null;
}

describe('the rest of the site', () => {
  it('still serves the static pages', async () => {
    expect(await (await get('/privacy/')).text()).toBe('static page');
    expect(assets.fetch).toHaveBeenCalled();
  });

  it('still sends www to the bare domain', async () => {
    const response = await worker.fetch(new Request('https://www.pressgolf.cc/terms/'), env);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://pressgolf.cc/terms/');
  });
});

describe('the reset page', () => {
  it('shows the form on opening the link, and spends nothing', async () => {
    const response = await get('/reset/?token_hash=abc123');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Set password');
    expect(hidden(html, 'token_hash')).toBe('abc123');
    expect(calls).toEqual([]);
  });

  it('answers without the trailing slash too', async () => {
    expect(await (await get('/reset?token_hash=abc123')).text()).toContain('Set password');
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it('explains how to start a reset when the link has no code', async () => {
    const html = await (await get('/reset/')).text();
    expect(html).toContain('Forgot password?');
    expect(html).not.toContain('Set password');
  });

  it('never echoes markup from the link back into the page', async () => {
    const html = await (await get('/reset/?token_hash=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E')).text();
    expect(html).not.toContain('<script>');
    expect(hidden(html, 'token_hash')).toBe('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it.each([
    [{ password: 'long-enough-1', confirm: 'long-enough-2' }, "The two passwords don't match."],
    [{ password: 'short', confirm: 'short' }, 'Use at least 8 characters.'],
    [{ password: '', confirm: '' }, 'Enter a new password.'],
  ])('checks the passwords before spending the link', async (fields, message) => {
    const response = await post('/reset/', { token_hash: 'abc123', ...fields });
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(html).toContain(message);
    expect(hidden(html, 'token_hash')).toBe('abc123');
    expect(calls).toEqual([]);
  });

  it('sets the password, signs out everywhere, and sends the person to Press', async () => {
    reply('/auth/v1/verify', VERIFIED);
    reply('/auth/v1/user', { status: 200, body: { id: 'u' } });
    reply('/auth/v1/logout?scope=global', { status: 204 });
    const response = await post('/reset/', { token_hash: 'abc123', password: 'new-password-1', confirm: 'new-password-1' });
    const html = await response.text();
    expect(html).toContain('Your password is set');
    expect(html).toContain('open Press and sign in');
    expect(calls).toEqual([
      { method: 'POST', path: '/auth/v1/verify', auth: null, body: { type: 'recovery', token_hash: 'abc123' } },
      { method: 'PUT', path: '/auth/v1/user', auth: 'Bearer recovery-session', body: { password: 'new-password-1' } },
      { method: 'POST', path: '/auth/v1/logout?scope=global', auth: 'Bearer recovery-session', body: undefined },
    ]);
  });

  it('says a used or expired link is no good, and how to get a new one', async () => {
    reply('/auth/v1/verify', { status: 403, body: { error_code: 'otp_expired', msg: 'Email link is invalid or has expired' } });
    const html = await (await post('/reset/', { token_hash: 'old', password: 'new-password-1', confirm: 'new-password-1' })).text();
    expect(html).toContain('This link has expired or has already been used');
    expect(html).toContain('Forgot password?');
    expect(calls).toHaveLength(1);
  });

  it.each([
    [{ reasons: ['pwned'] }, 'That password has appeared in a known data breach. Choose a different one.'],
    [{ reasons: ['length'] }, 'Use at least 8 characters.'],
    [{ reasons: ['characters'] }, 'That password is too easy to guess. Choose a different one.'],
  ])('keeps the reset going when the server refuses the password', async (weak, message) => {
    reply('/auth/v1/verify', VERIFIED);
    reply('/auth/v1/user', { status: 422, body: { error_code: 'weak_password', msg: 'weak', weak_password: weak } });
    const response = await post('/reset/', { token_hash: 'abc123', password: 'password123', confirm: 'password123' });
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(html).toContain(message);
    // The link is spent now, so the retry carries the session it bought instead.
    expect(hidden(html, 'token_hash')).toBeNull();
    expect(hidden(html, 'session')).toBe('recovery-session');

    reply('/auth/v1/user', { status: 200, body: { id: 'u' } });
    reply('/auth/v1/logout?scope=global', { status: 204 });
    calls = [];
    const retry = await (await post('/reset/', { session: 'recovery-session', password: 'a-better-one-9', confirm: 'a-better-one-9' })).text();
    expect(retry).toContain('Your password is set');
    expect(calls.map((call) => call.path)).toEqual(['/auth/v1/user', '/auth/v1/logout?scope=global']);
  });

  it('asks for a different password when the new one is the old one', async () => {
    reply('/auth/v1/verify', VERIFIED);
    reply('/auth/v1/user', { status: 422, body: { error_code: 'same_password', msg: 'same' } });
    const html = await (await post('/reset/', { token_hash: 'abc123', password: 'old-password-1', confirm: 'old-password-1' })).text();
    expect(html).toContain('That is your current password. Choose a new one.');
    expect(hidden(html, 'session')).toBe('recovery-session');
  });

  it('says the session ran out when a retry comes too late', async () => {
    reply('/auth/v1/user', { status: 401, body: { error_code: 'bad_jwt', msg: 'expired' } });
    const html = await (await post('/reset/', { session: 'stale', password: 'new-password-1', confirm: 'new-password-1' })).text();
    expect(html).toContain('This link has expired or has already been used');
  });

  it('offers a retry with the same link when the server cannot be reached', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const response = await post('/reset/', { token_hash: 'abc123', password: 'new-password-1', confirm: 'new-password-1' });
    const html = await response.text();
    expect(response.status).toBe(502);
    expect(html).toContain('Press could not reach its server. Try again in a moment.');
    expect(hidden(html, 'token_hash')).toBe('abc123');
  });

  it('says to wait when the server is turning away too many tries', async () => {
    reply('/auth/v1/verify', { status: 429, body: { error_code: 'over_request_rate_limit', msg: 'slow down' } });
    const html = await (await post('/reset/', { token_hash: 'abc123', password: 'new-password-1', confirm: 'new-password-1' })).text();
    expect(html).toContain('Too many tries just now. Wait a few minutes and try again.');
    expect(hidden(html, 'token_hash')).toBe('abc123');
  });

  it('tries signing out everywhere a second time', async () => {
    reply('/auth/v1/verify', VERIFIED);
    reply('/auth/v1/user', { status: 200, body: { id: 'u' } });
    reply('/auth/v1/logout?scope=global', { status: 500 }, { status: 204 });
    const html = await (await post('/reset/', { token_hash: 'abc123', password: 'new-password-1', confirm: 'new-password-1' })).text();
    expect(html).toContain('Your password is set');
    expect(html).toContain('has been signed out');
    expect(calls.filter((call) => call.path === '/auth/v1/logout?scope=global')).toHaveLength(2);
  });

  it('says the password is set but the other phones are not signed out, when signing out fails twice', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    reply('/auth/v1/verify', VERIFIED);
    reply('/auth/v1/user', { status: 200, body: { id: 'u' } });
    reply('/auth/v1/logout?scope=global', { status: 500 }, { status: 500 });
    const html = await (await post('/reset/', { token_hash: 'abc123', password: 'new-password-1', confirm: 'new-password-1' })).text();
    expect(html).toContain('Your password is set');
    expect(html).toContain('Press could not sign out the other phones');
    expect(html).not.toContain('has been signed out');
  });

  it('reads a refusal that is not about the password as a server failure', async () => {
    reply('/auth/v1/verify', VERIFIED);
    reply('/auth/v1/user', { status: 422, body: { error_code: 'validation_failed', msg: 'odd' } });
    const response = await post('/reset/', { token_hash: 'abc123', password: 'new-password-1', confirm: 'new-password-1' });
    const html = await response.text();
    expect(response.status).toBe(502);
    expect(html).toContain('Press could not reach its server. Try again in a moment.');
    expect(hidden(html, 'session')).toBe('recovery-session');
  });
});

describe('the confirmation page', () => {
  it('shows the button on opening the link, and spends nothing', async () => {
    const html = await (await get('/confirm/?token_hash=conf1')).text();
    expect(html).toContain('Confirm my email');
    expect(hidden(html, 'token_hash')).toBe('conf1');
    expect(calls).toEqual([]);
  });

  it('explains how to get a confirmation email when the link has no code', async () => {
    const html = await (await get('/confirm/')).text();
    expect(html).toContain('Send the confirmation email again');
    expect(html).not.toContain('<form');
  });

  it('confirms, leaves nobody signed in here, and sends the person to Press', async () => {
    reply('/auth/v1/verify', { status: 200, body: { access_token: 'confirm-session', user: { id: 'u' } } });
    reply('/auth/v1/logout?scope=local', { status: 204 });
    const html = await (await post('/confirm/', { token_hash: 'conf1' })).text();
    expect(html).toContain('Your email is confirmed');
    expect(html).toContain('open Press and sign in');
    expect(calls).toEqual([
      { method: 'POST', path: '/auth/v1/verify', auth: null, body: { type: 'email', token_hash: 'conf1' } },
      { method: 'POST', path: '/auth/v1/logout?scope=local', auth: 'Bearer confirm-session', body: undefined },
    ]);
  });

  it('says a used or expired link is no good, and points at Resend', async () => {
    reply('/auth/v1/verify', { status: 403, body: { error_code: 'otp_expired', msg: 'expired' } });
    const html = await (await post('/confirm/', { token_hash: 'old' })).text();
    expect(html).toContain('This link has expired or has already been used');
    expect(html).toContain('Send the confirmation email again');
  });
});

describe('every link page', () => {
  it.each([
    ['opening the reset link', () => get('/reset/?token_hash=abc123')],
    ['a refused reset', () => post('/reset/', { token_hash: 'abc123', password: 'x', confirm: 'y' })],
    ['opening the confirmation link', () => get('/confirm/?token_hash=conf1')],
    ['an unconfigured site', () => get('/reset/?token_hash=abc123', { ASSETS: assets })],
  ])('keeps the token out of referrers and caches, and runs no script: %s', async (_label, open) => {
    const response = await open();
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('says to try later, rather than failing, when the site has no server settings', async () => {
    const response = await post('/reset/', { token_hash: 'abc123', password: 'new-password-1', confirm: 'new-password-1' }, { ASSETS: assets });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('Try again later');
    expect(calls).toEqual([]);
  });

  it('treats a post that is not a form as a link with no code', async () => {
    const request = new Request('https://pressgolf.cc/reset/', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Forgot password?');
    expect(calls).toEqual([]);
  });

  it('refuses any other method', async () => {
    const response = await worker.fetch(new Request('https://pressgolf.cc/reset/', { method: 'PUT' }), env);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
  });
});
