/**
 * The pages behind the links in Press's emails: /reset/ sets a new password and
 * /confirm/ confirms a new account's address.
 *
 * Opening a link only shows a form. The link's token is used when the form is
 * sent, by the button, so a mail scanner that opens the link first spends
 * nothing. The Worker talks to Supabase itself, and the pages run no script.
 *
 * After either page nobody is signed in anywhere the page ran: the person signs
 * in to Press. A reset also signs out every phone signed in to the account.
 */

export interface LinkPageEnv {
  /** The Supabase project's URL and anon key, set as Worker secrets in Cloudflare. */
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

/** The app's own floor (MIN_PASSWORD_LENGTH in the app); the server never sees less. */
const MIN_PASSWORD_LENGTH = 8;

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // The token is in the address; it must not leak to another site or a cache.
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
};

type Page = 'reset' | 'confirm';

/** Answers /reset/ and /confirm/, or returns null for any other path. */
export async function linkPage(request: Request, env: LinkPageEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const page = pageFor(url.pathname);
  if (!page) return null;
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { ...HEADERS, Allow: 'GET, POST' } });
  }
  const server = serverFrom(env);
  // A form that can only fail when sent is worse than saying so now.
  if (!server) return html(notSetUp(), 503);
  if (request.method === 'GET') {
    const token = url.searchParams.get('token_hash') ?? '';
    if (!token) return html(page === 'reset' ? noResetLink() : noConfirmLink());
    return html(page === 'reset' ? resetForm({ token }) : confirmForm(token));
  }
  // The forms post url-encoded, as browsers do by default; anything else reads
  // as a form with nothing in it.
  const form = (request.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')
    ? new URLSearchParams(await request.text())
    : new URLSearchParams();
  const field = (name: string) => form.get(name) ?? '';
  return page === 'reset'
    ? reset(server, { token: field('token_hash'), session: field('session'), password: field('password'), confirm: field('confirm') })
    : confirmAddress(server, field('token_hash'));
}

function pageFor(path: string): Page | null {
  if (path === '/reset/' || path === '/reset') return 'reset';
  if (path === '/confirm/' || path === '/confirm') return 'confirm';
  return null;
}

// ---------------------------------------------------------------------------
// Supabase Auth

interface Server {
  url: string;
  key: string;
}

function serverFrom(env: LinkPageEnv): Server | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  return { url: env.SUPABASE_URL.replace(/\/+$/, ''), key: env.SUPABASE_ANON_KEY };
}

interface AuthReply {
  ok: boolean;
  status: number;
  body: { access_token?: string; error_code?: string; weak_password?: { reasons?: string[] } };
}

/** One call to Supabase Auth. Throws only when the server can't be reached. */
async function authRequest(server: Server, method: string, path: string, options: { session?: string; body?: unknown } = {}): Promise<AuthReply> {
  const headers: Record<string, string> = { apikey: server.key };
  if (options.session) headers.Authorization = `Bearer ${options.session}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${server.url}/auth/v1${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: AuthReply['body'] = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  return { ok: response.ok, status: response.status, body };
}

/** Why a request bought nothing: the server is turning away tries, or can't be reached. */
type Hitch = 'busy' | 'unreachable';

/** Uses up a link's token. Returns the session it buys, or why it bought none. */
async function verify(server: Server, type: 'recovery' | 'email', token: string): Promise<{ session: string } | { failure: 'used' | Hitch }> {
  let reply: AuthReply;
  try {
    reply = await authRequest(server, 'POST', '/verify', { body: { type, token_hash: token } });
  } catch {
    return { failure: 'unreachable' };
  }
  if (reply.ok && reply.body.access_token) return { session: reply.body.access_token };
  if (reply.status === 429) return { failure: 'busy' };
  if (reply.status >= 500 || reply.ok) return { failure: 'unreachable' };
  return { failure: 'used' };
}

/**
 * Ends sessions, and says whether it did. Tried twice: a reset that left the old
 * phones signed in would be worse than a slow page.
 */
async function signOut(server: Server, session: string, scope: 'global' | 'local'): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await authRequest(server, 'POST', `/logout?scope=${scope}`, { session });
      if (reply.ok || reply.status === 401 || reply.status === 404) return true;
    } catch {
      // Try once more.
    }
  }
  console.error(`pressgolf-site: signing out (${scope}) failed twice`);
  return false;
}

/** The page for a link whose token bought nothing. */
function verifyFailed(page: Page, failure: 'used' | Hitch, form: (error: string) => string): Response {
  if (failure === 'used') return html(expired(page), 400);
  return html(form(tryAgain(failure)), failure === 'busy' ? 429 : 502);
}

// ---------------------------------------------------------------------------
// The reset

interface ResetFields {
  token: string;
  /** Carried instead of the token once the token is spent and the server refused the password. */
  session: string;
  password: string;
  confirm: string;
}

async function reset(server: Server, fields: ResetFields): Promise<Response> {
  // What the form carries if it has to be shown again: the session once there
  // is one, since the token it came from is spent.
  const carried = { token: fields.session ? '' : fields.token, session: fields.session };
  if (!carried.token && !carried.session) return html(noResetLink(), 400);
  const problem = newPasswordProblem(fields.password, fields.confirm);
  if (problem) return html(resetForm({ ...carried, error: problem }), 400);

  let session = fields.session;
  if (!session) {
    const verified = await verify(server, 'recovery', fields.token);
    if ('failure' in verified) return verifyFailed('reset', verified.failure, (error) => resetForm({ ...carried, error }));
    session = verified.session;
  }

  let updated: AuthReply;
  try {
    updated = await authRequest(server, 'PUT', '/user', { session, body: { password: fields.password } });
  } catch {
    return html(resetForm({ session, error: tryAgain('unreachable') }), 502);
  }
  if (updated.status === 401 || updated.status === 403) return html(expired('reset'), 400);
  if (!updated.ok) {
    const refused = refusal(updated);
    return html(resetForm({ session, error: refused ?? tryAgain('unreachable') }), refused ? 400 : 502);
  }

  // Every session, this one included: the other phones are signed out, and
  // nobody is left signed in on the device that opened the link.
  return html(resetDone(await signOut(server, session, 'global')));
}

/** The site's own check of a new password typed twice; the app checks one typed once. */
function newPasswordProblem(password: string, confirm: string): string | null {
  if (!password) return 'Enter a new password.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

/** Why the server refused a new password, in words for the person typing it, or null if it wasn't a refusal. */
function refusal(reply: AuthReply): string | null {
  if (reply.body.error_code === 'same_password') return 'That is your current password. Choose a new one.';
  if (reply.body.error_code !== 'weak_password') return null;
  const reasons = reply.body.weak_password?.reasons ?? [];
  if (reasons.includes('pwned')) return 'That password has appeared in a known data breach. Choose a different one.';
  if (reasons.includes('length')) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  return 'That password is too easy to guess. Choose a different one.';
}

function tryAgain(failure: Hitch): string {
  return failure === 'busy'
    ? 'Too many tries just now. Wait a few minutes and try again.'
    : 'Press could not reach its server. Try again in a moment.';
}

// ---------------------------------------------------------------------------
// The confirmation

async function confirmAddress(server: Server, token: string): Promise<Response> {
  if (!token) return html(noConfirmLink(), 400);
  const verified = await verify(server, 'email', token);
  if ('failure' in verified) return verifyFailed('confirm', verified.failure, (error) => confirmForm(token, error));
  // Confirming signs the address in; this page has no use for that session.
  await signOut(server, verified.session, 'local');
  return html(confirmDone());
}

// ---------------------------------------------------------------------------
// Pages

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: HEADERS });
}

// Every attribute here is double-quoted, so an apostrophe needs no escaping.
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escape(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ENTITIES[c]);
}

function hiddenField(name: string, value: string): string {
  return value ? `<input type="hidden" name="${name}" value="${escape(value)}">` : '';
}

function errorLine(error?: string): string {
  return error ? `<p class="error" id="problem" role="alert">${escape(error)}</p>` : '';
}

function layout(title: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Press · ${escape(title)}</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.png">
</head>
<body>
<header>
  <a class="home" href="/">Press</a>
  <nav><a href="/">Support</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/delete-account/">Delete account</a></nav>
</header>
<main>
${main}
</main>
<footer>Press · <a href="mailto:support@pressgolf.cc">support@pressgolf.cc</a> · <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></footer>
</body>
</html>
`;
}

const NEW_RESET =
  'To get a new link, open Press, type your email on the sign-in screen and tap <strong>Forgot password?</strong>';
const NEW_CONFIRM =
  'To get a new link, open Press, sign in with your email and password, and tap <strong>Send the confirmation email again</strong>.';

function resetForm({ token = '', session = '', error }: { token?: string; session?: string; error?: string }): string {
  const described = error ? ' aria-describedby="problem"' : '';
  return layout(
    'Choose a new password',
    `<h1>Choose a new password</h1>
<p class="meta">For your Press account. Use at least ${MIN_PASSWORD_LENGTH} characters.</p>
${errorLine(error)}
<form method="post" action="/reset/" class="link-form">
${hiddenField('token_hash', token)}${hiddenField('session', session)}
<label for="password">New password</label>
<input id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required${described}>
<label for="confirm">Type it again</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
<button type="submit">Set password</button>
</form>
<p class="meta">Setting it signs out every phone signed in to your account. Your scores on each phone stay where they are.</p>`,
  );
}

function resetDone(signedOut: boolean): string {
  const phones = signedOut
    ? '<p>Every phone that was signed in to your account has been signed out. Their scores are still on them, and they sync again once you sign in.</p>'
    : '<p>Press could not sign out the other phones signed in to your account. If you think someone else knows your old password, email <a href="mailto:support@pressgolf.cc">support@pressgolf.cc</a>.</p>';
  return layout(
    'Password set',
    `<h1>Your password is set</h1>
<p>Now open Press and sign in with your new password.</p>
${phones}`,
  );
}

function noResetLink(): string {
  return layout(
    'Reset your password',
    `<h1>Reset your password</h1>
<p>This page needs the link from a reset email. ${NEW_RESET}</p>`,
  );
}

function confirmForm(token: string, error?: string): string {
  return layout(
    'Confirm your email',
    `<h1>Confirm your email</h1>
<p class="meta">One step left before you can sign in to Press.</p>
${errorLine(error)}
<form method="post" action="/confirm/" class="link-form">
${hiddenField('token_hash', token)}
<button type="submit">Confirm my email</button>
</form>`,
  );
}

function confirmDone(): string {
  return layout(
    'Email confirmed',
    `<h1>Your email is confirmed</h1>
<p>Now open Press and sign in with your email and password.</p>`,
  );
}

function noConfirmLink(): string {
  return layout(
    'Confirm your email',
    `<h1>Confirm your email</h1>
<p>This page needs the link from a confirmation email. ${NEW_CONFIRM}</p>`,
  );
}

function expired(page: Page): string {
  return layout(
    'Link expired',
    `<h1>This link has expired or has already been used</h1>
<p>Links in Press's emails work for one hour, and only once. ${page === 'reset' ? NEW_RESET : NEW_CONFIRM}</p>`,
  );
}

function notSetUp(): string {
  return layout(
    'Try again later',
    `<h1>Try again later</h1>
<p>This page can't reach Press's server right now. Your link is still good for an hour from when it was sent. If it keeps happening, email <a href="mailto:support@pressgolf.cc">support@pressgolf.cc</a>.</p>`,
  );
}
