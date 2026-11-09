/**
 * DriveStreamService.ts
 *
 * Resolves Google Drive file IDs into direct streaming CDN URLs for native ExoPlayer.
 * Handles:
 *  1. Direct streams (< 100 MB)
 *  2. Files > 100 MB (large movies) with Google's virus scan confirmation form & tokens
 *  3. HTTP Range headers and cookie extraction for instant playback in ExoPlayer
 */

export interface DriveStreamResult {
  url: string;
  headers?: Record<string, string>;
}

class DriveStreamService {
  private cache = new Map<string, { result: DriveStreamResult; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
  private readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  public async resolveDriveStreamUrl(fileId: string): Promise<DriveStreamResult | null> {
    if (!fileId) return null;

    // Check memory cache
    const cached = this.cache.get(fileId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }

    try {
      console.log(`🎬 [DriveStreamService] Resolving stream for fileId: ${fileId}`);
      const initialUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

      const res = await fetch(initialUrl, {
        method: 'GET',
        headers: {
          'User-Agent': this.USER_AGENT,
          'Range': 'bytes=0-1024',
        },
      });

      // Capture set-cookie headers
      const rawCookies = res.headers.get('set-cookie') || '';
      const cookieHeader = rawCookies ? rawCookies.split(',').map(c => c.split(';')[0].trim()).join('; ') : undefined;

      const finalUrl = res.url || initialUrl;

      // If user requires login (private file)
      if (finalUrl.includes('accounts.google.com') || finalUrl.includes('ServiceLogin')) {
        console.warn('⚠️ [DriveStreamService] File requires Google authentication');
        return null;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();

      // If direct video / binary stream (< 100 MB)
      if (contentType.startsWith('video/') || contentType.includes('octet-stream')) {
        console.log(`✅ [DriveStreamService] Direct stream detected (< 100MB): ${finalUrl.substring(0, 60)}...`);
        const result: DriveStreamResult = {
          url: finalUrl,
          headers: {
            'User-Agent': this.USER_AGENT,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
        };
        this.cache.set(fileId, { result, expiresAt: Date.now() + this.CACHE_TTL_MS });
        return result;
      }

      // Large file (> 100 MB, e.g. movie) - Google returned confirmation HTML page
      const html = await res.text();

      // Strategy 1: Parse <form id="download-form" action="..." method="get">
      const formMatch = html.match(/<form[^>]+action="([^"]+)"[^>]*>/i);
      if (formMatch && formMatch[1]) {
        let action = formMatch[1].replace(/&amp;/g, '&');
        if (!action.startsWith('http')) {
          action = 'https://drive.usercontent.google.com' + (action.startsWith('/') ? action : '/' + action);
        }

        const urlObj = new URL(action);
        const inputRegex = /<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"[^>]*>/gi;
        const inputRegexRev = /<input[^>]+value="([^"]*)"[^>]+name="([^"]+)"[^>]*>/gi;
        let m: RegExpExecArray | null;

        while ((m = inputRegex.exec(html)) !== null) {
          urlObj.searchParams.set(m[1], m[2]);
        }
        while ((m = inputRegexRev.exec(html)) !== null) {
          urlObj.searchParams.set(m[2], m[1]);
        }

        // Ensure fileId and export are present
        if (!urlObj.searchParams.has('id')) urlObj.searchParams.set('id', fileId);
        if (!urlObj.searchParams.has('export')) urlObj.searchParams.set('export', 'download');

        const resolvedUrl = urlObj.toString();
        console.log(`✅ [DriveStreamService] Extracted 2024 download form URL: ${resolvedUrl.substring(0, 80)}...`);

        const result: DriveStreamResult = {
          url: resolvedUrl,
          headers: {
            'User-Agent': this.USER_AGENT,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
        };
        this.cache.set(fileId, { result, expiresAt: Date.now() + this.CACHE_TTL_MS });
        return result;
      }

      // Strategy 2: Check for direct download link element <a id="uc-download-link" href="...">
      const linkMatch =
        html.match(/id="uc-download-link"[^>]+href="([^"]+)"/i) ||
        html.match(/href="([^"]+)"[^>]+id="uc-download-link"/i) ||
        html.match(/href="(\/uc\?export=download[^"]+confirm=[^"]*)"/i) ||
        html.match(/href="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/i);

      if (linkMatch && linkMatch[1]) {
        let downloadLink = linkMatch[1].replace(/&amp;/g, '&');
        if (!downloadLink.startsWith('http')) {
          downloadLink = 'https://drive.google.com' + (downloadLink.startsWith('/') ? downloadLink : '/' + downloadLink);
        }
        console.log(`✅ [DriveStreamService] Extracted link match URL: ${downloadLink.substring(0, 80)}...`);

        const result: DriveStreamResult = {
          url: downloadLink,
          headers: {
            'User-Agent': this.USER_AGENT,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
        };
        this.cache.set(fileId, { result, expiresAt: Date.now() + this.CACHE_TTL_MS });
        return result;
      }

      // Strategy 3: Regex token extraction (confirm and uuid)
      const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
      const uuidMatch = html.match(/uuid=([0-9A-Za-z_-]+)/);
      if (confirmMatch && confirmMatch[1]) {
        const confirmToken = confirmMatch[1];
        const uuidToken = uuidMatch ? uuidMatch[1] : '';
        const streamUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmToken}${uuidToken ? '&uuid=' + uuidToken : ''}`;
        console.log(`✅ [DriveStreamService] Constructed token stream URL: ${streamUrl.substring(0, 80)}...`);

        const result: DriveStreamResult = {
          url: streamUrl,
          headers: {
            'User-Agent': this.USER_AGENT,
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
        };
        this.cache.set(fileId, { result, expiresAt: Date.now() + this.CACHE_TTL_MS });
        return result;
      }

      console.warn('⚠️ [DriveStreamService] Could not parse download form or confirm token from response');
      return null;
    } catch (error) {
      console.error('❌ [DriveStreamService] Failed to resolve stream URL:', error);
      return null;
    }
  }

  public clearCache(fileId?: string) {
    if (fileId) {
      this.cache.delete(fileId);
    } else {
      this.cache.clear();
    }
  }
}

export default new DriveStreamService();
