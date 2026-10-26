// Sends www.pressgolf.cc to pressgolf.cc, and serves everything else from
// ./public unchanged.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.pressgolf.cc') {
      url.hostname = 'pressgolf.cc';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
