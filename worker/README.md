# Relay credentials Worker

When two players' networks block direct connections, the game routes their traffic through
Cloudflare's TURN relay. The relay's API token must stay secret, so this tiny Cloudflare Worker keeps it
and hands the game short-lived credentials at `GET /ice`.

## One-time setup

1. **Create a TURN key.** In the [Cloudflare dashboard](https://dash.cloudflare.com), open
   **Realtime → TURN Server → Create**. Copy the **Turn Token ID** and the **API Token**; the token is
   shown only once.
2. **Deploy the Worker** from this folder:

   ```bash
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_API_TOKEN
   ```

   Paste the values when asked. `deploy` prints the Worker's address, like
   `https://arcane-tricks-ice.<your-account>.workers.dev`.
3. **Point the game at it:** in the GitHub repo, add a variable (**Settings → Secrets and variables →
   Actions → Variables**) named `ICE_ENDPOINT`, with the Worker address plus `/ice`. Then re-run the deploy
   workflow. For local development, put `VITE_ICE_ENDPOINT=<same URL>` in a `.env.local` file at the
   project root.

## Checking it

```bash
curl -H "Origin: https://pagnobi.github.io" https://arcane-tricks-ice.<your-account>.workers.dev/ice
```

This should return `{"iceServers":[...]}`. In the game, a failed join now names the relay source in its details.

## Notes

- Only the sites in `ALLOWED_ORIGINS` (`wrangler.toml`) get credentials. If you add a custom domain,
  add it there and redeploy.
- Credentials expire after 6 hours. The game fetches fresh ones each hour.
- Cloudflare's TURN service includes a large free monthly allowance; check their current pricing.
  Card games send very little data, so a friends-sized game uses a tiny fraction of it.
- If the Worker is ever down, the game falls back to PeerJS's community relay, so joining still works
  wherever it did before.
