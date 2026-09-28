// Cloudflare Worker: hands the game short-lived TURN relay credentials.
//
// The relay lets two players connect even when their networks block direct connections. Its API
// token must stay secret, so the browser can't call Cloudflare's TURN API itself — it asks this
// Worker instead, which returns ICE servers valid for a few hours.
//
//   GET /ice  →  { iceServers: [...] }
//
// Settings (see worker/README.md):
//   TURN_KEY_ID, TURN_KEY_API_TOKEN   secrets, from Cloudflare dashboard → Realtime → TURN
//   ALLOWED_ORIGINS                   comma-separated sites allowed to ask (wrangler.toml)

const CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    // Only the game's own site may ask (browsers enforce this; it stops other sites using our relay).
    if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET' || new URL(request.url).pathname !== '/ice') return json({ error: 'not-found' }, 404, cors);
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'not-configured' }, 500, cors);

    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
    });
    if (!res.ok) return json({ error: 'turn-unavailable', status: res.status }, 502, cors);

    const data = await res.json();
    const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers].filter(Boolean);
    // Browsers block port 53, so those addresses would only slow connecting down.
    const iceServers = list
      .map((s) => ({ ...s, urls: [].concat(s.urls ?? []).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    return json({ iceServers, ttl: CREDENTIAL_TTL_SECONDS }, 200, cors);
  },
};
