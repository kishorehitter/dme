# DME Genius Lyrics Fallback Worker (Cloudflare)

This Cloudflare Worker provides a fast, edge-cached, 100% free fallback for Indian/Tamil songs that do not have lyrics in LRCLIB.

## Features
- **100% Free**: Operates within Cloudflare's free 100,000 requests/day tier (3M/month).
- **Fast**: Responds in ~200-300ms; cached repeats respond in <20ms.
- **Zero App Overhead**: The mobile app downloads only ~3KB clean JSON, with 0MB RAM impact.
- **24-Hour Edge Caching**: Avoids hitting Genius multiple times for the same song.

## 60-Second Deployment

1. If you don't have Wrangler installed:
   ```bash
   npm install -g wrangler
   ```
2. Login to your free Cloudflare account:
   ```bash
   wrangler login
   ```
3. Deploy the worker:
   ```bash
   cd cloudflare-lyrics-worker
   wrangler deploy
   ```
4. Copy your worker URL (e.g. `https://dme-genius-lyrics-worker.<your-subdomain>.workers.dev`).
5. Add the URL to your app configuration in `DME/src/config/network.ts` under `GENIUS_LYRICS_WORKER_URL`.
