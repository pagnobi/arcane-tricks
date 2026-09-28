import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/src/index.js';
import { getIceServers, relaySource, resetIceCache } from '../src/net/iceServers.js';

const env = { TURN_KEY_ID: 'key123', TURN_KEY_API_TOKEN: 'secret-token', ALLOWED_ORIGINS: 'https://pagnobi.github.io, http://localhost:5173' };
const ask = (init = {}) =>
  worker.fetch(new Request('https://arcane-tricks-ice.example.workers.dev/ice', { headers: { Origin: 'https://pagnobi.github.io' }, ...init }), env);

describe('relay credential Worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks Cloudflare for short-lived credentials and drops browser-blocked port 53', async () => {
    const cloudflare = vi.fn(async () =>
      Response.json({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          {
            urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
            username: 'u',
            credential: 'c',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', cloudflare);
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://pagnobi.github.io');
    const body = await res.json();
    expect(body.iceServers[1]).toEqual({
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
      username: 'u',
      credential: 'c',
    });
    expect(JSON.stringify(body)).not.toContain(':53');
    // The secret token goes to Cloudflare only — never back to the browser.
    const [url, init] = cloudflare.mock.calls[0];
    expect(url).toContain('/turn/keys/key123/');
    expect(init.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.stringify(body)).not.toContain('secret-token');
  });

  it('refuses other websites, other paths, and reports a missing setup', async () => {
    const other = await worker.fetch(new Request('https://x.workers.dev/ice', { headers: { Origin: 'https://evil.example' } }), env);
    expect(other.status).toBe(403);
    expect((await ask({ method: 'POST' })).status).toBe(404);
    const unset = await worker.fetch(new Request('https://x.workers.dev/ice', { headers: { Origin: 'https://pagnobi.github.io' } }), { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS });
    expect(unset.status).toBe(500);
  });

  it('answers the browser’s CORS preflight', async () => {
    const res = await ask({ method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET');
  });

  it('passes Cloudflare failures on as 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    expect((await ask()).status).toBe(502);
  });
});

describe('game ICE server selection', () => {
  afterEach(() => resetIceCache());

  it('without a Worker, uses STUN plus the PeerJS community relay', async () => {
    const servers = await getIceServers({ endpoint: '' });
    expect(servers.some((s) => String(s.urls).includes('stun:'))).toBe(true);
    expect(servers.at(-1).urls[0]).toContain('peerjs.com');
  });

  it('puts the Cloudflare relay ahead of the community relay', async () => {
    const fetchImpl = async () => Response.json({ iceServers: [{ urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }] });
    const servers = await getIceServers({ endpoint: 'https://w/ice', fetchImpl });
    const cf = servers.findIndex((s) => String(s.urls).includes('cloudflare.com:443'));
    const community = servers.findIndex((s) => String(s.urls).includes('peerjs.com'));
    expect(cf).toBeGreaterThan(-1);
    expect(cf).toBeLessThan(community);
    expect(relaySource).toBe('cloudflare');
  });

  it('never blocks joining: a broken Worker falls back to the built-in list', async () => {
    const servers = await getIceServers({ endpoint: 'https://w/ice', fetchImpl: async () => new Response('', { status: 500 }) });
    expect(servers.at(-1).urls[0]).toContain('peerjs.com');
    expect(relaySource).toContain('unavailable');
  });
});
