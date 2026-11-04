// pressgolf.cc: sends www to the bare domain, answers the reset and confirmation
// links from Press's emails (link-pages.ts), and serves everything else from
// ./public unchanged.
import { linkPage, type LinkPageEnv } from './link-pages';

export interface Env extends LinkPageEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'www.pressgolf.cc') {
      url.hostname = 'pressgolf.cc';
      return Response.redirect(url.toString(), 301);
    }
    return (await linkPage(request, env)) ?? env.ASSETS.fetch(request);
  },
};
