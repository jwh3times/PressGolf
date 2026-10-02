// Serves the web export in dist/ for the Playwright suite.
//
// No dependencies, so it runs the same on the host and in the Playwright
// container. Unknown paths fall back to index.html, as a single-page app needs.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve('dist');
const port = Number(process.env.PORT ?? 8099);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

if (!existsSync(path.join(root, 'index.html'))) {
  console.error('dist/index.html is missing. Run `npx expo export --platform web` first.');
  process.exit(1);
}

createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let file = path.join(root, url);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(root, 'index.html');
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving dist/ on http://localhost:${port}`));
