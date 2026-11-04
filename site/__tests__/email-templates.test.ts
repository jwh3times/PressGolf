/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The email texts link to the pages this site serves. Whether the token those
 * pages are handed really works is proven against the real server, in
 * link-pages.integration.test.ts; this checks the emails ask for the right page.
 */

const root = join(__dirname, '..', '..');
// Windows checkouts have CRLF line endings.
const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8').replace(/\r\n/g, '\n');

function template(name: string): string {
  return readFileSync(join(root, 'supabase', 'templates', name), 'utf8');
}

it.each([
  ['recovery', 'recovery.html', '/reset/'],
  ['confirmation', 'confirmation.html', '/confirm/'],
])('the %s email (%s) links to %s with its token', (kind, file, path) => {
  expect(template(file)).toContain(`href="{{ .SiteURL }}${path}?token_hash={{ .TokenHash }}"`);
  // Never the token itself, or a confirmation URL that acts the moment it is opened.
  expect(template(file)).not.toMatch(/\{\{ \.(Token|ConfirmationURL) \}\}/);
  expect(config).toContain(`[auth.email.template.${kind}]\nsubject = `);
  expect(config).toContain(`content_path = "./supabase/templates/${file}"`);
});

it('sends a password-changed email that links nowhere', () => {
  expect(config).toMatch(/\[auth\.email\.notification\.password_changed\]\nenabled = true\n/);
  expect(config).toContain('content_path = "./supabase/templates/password_changed.html"');
  expect(template('password_changed.html')).not.toContain('{{ .TokenHash }}');
});
