// Deletes the signed-in account: the app's only way in to deleting one.
//
// The account comes from the verified token and never from the request, whose
// body carries only the password. The password is checked here rather than in the
// app, so a stolen token isn't enough to delete anyone.
//
// Safe to call again. If deleting the auth user fails after the clean-up has
// committed, the next call finds nothing to clean and retries it. If the reply
// was lost and the account is already gone, the next call says so, so the phone
// can finish erasing.
//
// The version is pinned because every merge to main deploys this function, and a
// floating one would change what handles passwords without a review.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2.118.0/cors';

type Outcome = 'deleted' | 'not-signed-in' | 'wrong-password' | 'shares-data' | 'failed';

/** Raised by delete_account_data for an account that shares rows with another. */
const SHARES_DATA = 'PR001';

function reply(outcome: Outcome, status: number): Response {
  return Response.json({ outcome }, { status, headers: corsHeaders });
}

function serverClient(key: string) {
  return createClient(Deno.env.get('SUPABASE_URL')!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply('failed', 405);

  const token = request.headers.get('Authorization')?.replace(/^Bearer /i, '');
  if (!token) return reply('not-signed-in', 401);

  const admin = serverClient(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: verified, error: tokenError } = await admin.auth.getUser(token);
  if (tokenError) {
    if (tokenError.code === 'user_not_found') return reply('deleted', 200);
    if (tokenError.status === 401 || tokenError.status === 403) return reply('not-signed-in', 401);
    console.error('delete-account: reading the token failed', tokenError.code, tokenError.status);
    return reply('failed', 500);
  }
  const { id, email } = verified.user;
  if (!email) return reply('failed', 500);

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password) return reply('wrong-password', 403);

  // A client of its own: signing in on the service-role client would replace the
  // key it sends with this user's token.
  const verifier = serverClient(Deno.env.get('SUPABASE_ANON_KEY')!);
  const { error: passwordError } = await verifier.auth.signInWithPassword({ email, password });
  if (passwordError) {
    if (passwordError.code === 'invalid_credentials') return reply('wrong-password', 403);
    console.error('delete-account: checking the password failed', passwordError.code, passwordError.status);
    return reply('failed', 500);
  }

  const { error: cleanUpError } = await admin.rpc('delete_account_data', { target: id });
  if (cleanUpError) {
    if (cleanUpError.code === SHARES_DATA) return reply('shares-data', 409);
    console.error('delete-account: the clean-up failed', cleanUpError.code);
    return reply('failed', 500);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(id);
  if (deleteError) {
    console.error('delete-account: deleting the auth user failed', deleteError.code, deleteError.status);
    return reply('failed', 500);
  }

  return reply('deleted', 200);
});
