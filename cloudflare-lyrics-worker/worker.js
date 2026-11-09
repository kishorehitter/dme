/**
 * Cloudflare Edge Worker for Lyrics Fallback
 * Provides multi-tier fallback for songs when standard in-app matching misses.
 */

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const rawQuery = url.searchParams.get('q') || url.searchParams.get('title') || '';
    const artist = url.searchParams.get('artist') || '';

    // Clean query
    const cleanQuery = rawQuery
      .replace(/[\(\[].*?[\)\]]/g, '')
      .replace(/\s+(?:official|video|audio|lyrics?|lyric|hd|4k)\s*/gi, ' ')
      .replace(/[-–—:|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanQuery) {
      return new Response(
        JSON.stringify({ found: false, error: 'Query parameter "q" or "title" is required' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const searchQuery = artist ? `${cleanQuery} ${artist}` : cleanQuery;

    try {
      // ── Strategy 1: Edge LRCLIB Relaxed Query (ultra-fast edge lookup) ──
      const lrclibRes = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`,
        {
          headers: {
            'User-Agent': 'DME-Lyrics-Worker/1.0',
            'Accept': 'application/json',
          },
        }
      );

      if (lrclibRes.ok) {
        const items = await lrclibRes.json();
        if (Array.isArray(items) && items.length > 0) {
          // Look for any item that has synced or plain lyrics
          const match = items.find(
            (i) => (i.syncedLyrics || i.plainLyrics) && !i.instrumental
          ) || items[0];

          const rawLyrics = match.plainLyrics || (match.syncedLyrics
            ? match.syncedLyrics.replace(/\[\d{2}:\d{2}\.\d{2,3}\]\s*/g, '').trim()
            : '');

          if (rawLyrics && rawLyrics.trim().length > 30) {
            return new Response(
              JSON.stringify({
                found: true,
                title: match.trackName || cleanQuery,
                artist: match.artistName || artist,
                lyrics: rawLyrics.trim(),
                source: 'lrclib-relaxed',
              }),
              { status: 200, headers: corsHeaders }
            );
          }
        }
      }

      // ── Strategy 2: Search DuckDuckGo Lite for song lyrics ──
      const ddgPost = `q=${encodeURIComponent(`${searchQuery} lyrics`)}`;
      const ddgRes = await fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: ddgPost,
      });

      if (ddgRes.ok) {
        const ddgHtml = await ddgRes.text();
        // Extract lyrics snippet or results if available
        const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
        let snippetMatch;
        let combinedSnippets = '';
        while ((snippetMatch = snippetRegex.exec(ddgHtml)) !== null) {
          const text = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
          if (text.length > 40) {
            combinedSnippets += text + '\n\n';
          }
        }

        if (combinedSnippets.length > 150) {
          return new Response(
            JSON.stringify({
              found: true,
              title: cleanQuery,
              artist: artist || '',
              lyrics: combinedSnippets.trim(),
              source: 'web-search-snippet',
            }),
            { status: 200, headers: corsHeaders }
          );
        }
      }

      return new Response(
        JSON.stringify({
          found: false,
          message: 'No lyrics found across fallback providers',
          query: searchQuery,
        }),
        { status: 404, headers: corsHeaders }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ found: false, error: err.message || 'Worker execution error' }),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
