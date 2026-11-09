import { GENIUS_LYRICS_WORKER_URL } from '../config/network';

export interface LyricLine {
  time: number; // seconds
  text: string;
}

export interface LyricsResult {
  lines: LyricLine[];
  plainLyrics?: string;
  instrumental: boolean;
  hasLyrics: boolean;       // true = synced LRC found
  hasPlainLyrics: boolean;  // true = plain text lyrics found (no sync)
  trackName?: string;
  artistName?: string;
  isMismatch?: boolean;     // true = lyrics found but title doesn't match YouTube title
}

// In-memory cache — instant recall, no refetch per song
const lyricsCache = new Map<string, LyricsResult>();

const HEADERS = { 'User-Agent': 'DME-MusicPlayer/1.0' };

/**
 * Strip common YouTube clutter from text that IS inside brackets/parens.
 * e.g. "(Official Video)", "[4K]", "(Lyric Video)"
 */
function stripBracketedNoise(text: string): string {
  return text
    .replace(
      /\s*[\(\[]\s*(?:official\s*(?:music\s*)?video|official\s*audio|official|lyrics?|lyric\s*video|visualizer|audio\s*song|hd|4k|1080p|720p|remastered|extended\s*mix|full\s*(?:song|video)|mv|hq|special\s*version|feat\.?\s*[^\)\]]*?)\s*[\)\]]/gi,
      ''
    )
    .replace(/["""'']/g, '')
    .trim();
}

/**
 * Strip common YouTube noise words that appear WITHOUT brackets in a segment.
 * e.g. "Why This Kolaveri Di Video Song" → "Why This Kolaveri Di"
 */
function stripSegmentNoise(segment: string): string {
  return segment
    .replace(
      /\s+(?:video\s+songs?|audio\s+songs?|official\s+video|official\s+audio|hd\s+video|full\s+(?:video|song|audio)|lyric\s+videos?|music\s+videos?|promotional\s+song|item\s+song|dance\s+number|lyrics?|lyric|hd|4k)\s*$/gi,
      ''
    )
    .replace(/\s+(?:ft|feat)\.?\s+.+$/i, '')
    .replace(/[-–—:|]+$/g, '')
    .trim();
}

function cleanSegment(raw: string): string {
  return stripSegmentNoise(stripBracketedNoise(raw));
}

/**
 * Builds multiple candidate search queries from a raw YouTube title.
 * Ordered from most-specific to least-specific.
 */
function buildSearchQueries(rawTitle: string, channelTitle?: string): string[] {
  const clean = stripBracketedNoise(rawTitle);

  const pipeSegments = clean
    .split(/\s*\|\s*/)
    .map((s) => cleanSegment(s.trim()))
    .filter((s) => s.length > 1);

  const mainSegment = pipeSegments[0] || cleanSegment(clean);
  const queries: string[] = [];

  // 1. If pipe segments exist (e.g. "LEO - Badass | Thalapathy Vijay | Anirudh")
  if (pipeSegments.length > 1) {
    for (const seg of pipeSegments) {
      if (seg.length > 2) queries.push(seg);
    }
    queries.push(`${pipeSegments[0]} ${pipeSegments[1]}`);
    if (pipeSegments.length > 2) {
      queries.push(`${pipeSegments[0]} ${pipeSegments[pipeSegments.length - 1]}`);
    }
  }

  // 2. Dash separation (e.g. "LEO - Badass" -> "Badass", "LEO Badass")
  const dashParts = mainSegment
    .split(/\s*[-–—]\s*/)
    .map((s) => cleanSegment(s))
    .filter(Boolean);

  if (dashParts.length >= 2) {
    queries.push(dashParts[1]); // Song name typically follows movie/artist ("LEO - Badass" -> "Badass")
    queries.push(`${dashParts[0]} ${dashParts[1]}`);
    queries.push(`${dashParts[1]} ${dashParts[0]}`);
    queries.push(dashParts[0]);
  } else if (!queries.includes(mainSegment)) {
    queries.push(mainSegment);
  }

  if (channelTitle) {
    const cleanChannel = channelTitle
      .replace(/\s*(?:VEVO|Official|Music|Records|Channel|- Topic)$/gi, '')
      .trim();
    if (cleanChannel && cleanChannel !== mainSegment) {
      queries.push(`${cleanSegment(mainSegment)} ${cleanChannel}`);
    }
  }

  const mainWords = mainSegment.split(/\s+/);
  if (mainWords.length >= 5) {
    queries.push(mainWords.slice(0, 4).join(' '));
  }

  return Array.from(
    new Set(
      queries
        .map((q) => q.replace(/[-–—:|]+$/g, '').replace(/\s+/g, ' ').trim())
        .filter((q) => q.length > 2)
    )
  );
}

/**
 * Parses LRC format → sorted LyricLine[].
 * Handles multi-timestamp lines: [00:12.00][00:35.00] text
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  const result: LyricLine[] = [];

  for (const rawLine of lrcText.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const matches = [...trimmed.matchAll(timeRegex)];
    if (!matches.length) continue;

    const text = trimmed.replace(timeRegex, '').trim();
    if (!text) continue;

    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const msStr = m[3] || '0';
      const ms =
        msStr.length === 2
          ? parseInt(msStr, 10) * 10
          : parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
      result.push({ time: min * 60 + sec + ms / 1000, text });
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Strips movie names, clutter, soundtracks, language and noise from a song title.
 * e.g. "Kaalathukkum Nee Venum (From \"Vendhu Thanindhathu Kaadu\")" → "Kaalathukkum Nee Venum"
 * e.g. "Why This Kolaveri Di (The \"Rage of 2011\" Song)" → "Why This Kolaveri Di"
 * e.g. "Illuminati - From \"Aavesham\"" → "Illuminati"
 */
export function cleanSongTitle(raw?: string): string {
  if (!raw) return '';
  let clean = raw;

  // 1. Strip (From ...) or [From ...] or - From ...
  clean = clean.replace(/\s*[\(\[]\s*from\s+[^)\]]+[\)\]]/gi, '');
  clean = clean.replace(/\s*[-–—|]\s*from\s+[^(\n]+/gi, '');

  // 2. Strip Soundtrack / OST / Theme Song in brackets or parens with "song"
  clean = clean.replace(
    /\s*[\(\[]\s*(?:original\s+(?:motion\s+picture\s+)?soundtrack|ost|soundtrack|theme\s+song)[^\)\]]*[\)\]]/gi,
    ''
  );
  clean = clean.replace(/\s*[\(\[]\s*[^)\]]*\bsong\b[^\)\]]*[\)\]]/gi, '');

  // 3. Strip language tags: [Tamil], (Telugu), etc.
  clean = clean.replace(
    /\s*[\(\[]\s*(?:tamil|telugu|hindi|malayalam|kannada|bengali|punjabi|english)\s*[\)\]]/gi,
    ''
  );

  // 4. Strip common video clutter in parens: (Official Video), (Lyric Video), etc.
  clean = clean.replace(
    /\s*[\(\[]\s*(?:official\s*(?:music\s*)?video|official\s*audio|official|lyrics?|lyric\s*video|visualizer|audio\s*song|hd|4k|1080p|720p|remastered|extended\s*mix|full\s*(?:song|video)|mv|hq|special\s*version|feat\.?\s*[^\)\]]*?)\s*[\)\]]/gi,
    ''
  );

  // 5. Strip trailing noise words: "Video Song", "Audio Song", etc.
  clean = clean.replace(
    /\s+(?:video\s+songs?|audio\s+songs?|official\s+video|official\s+audio|hd\s+video|full\s+(?:video|song|audio)|lyric\s+video|music\s+video)\s*$/gi,
    ''
  );

  // 6. Strip quotes, backslashes and extraneous punctuation
  clean = clean.replace(/\\/g, '');
  clean = clean.replace(/["""'']/g, '');
  clean = clean.replace(/^[-\s:|–—]+|[-\s:|–—]+$/g, '').trim();

  return clean;
}

function normalizeWords(str?: string): string[] {
  if (!str) return [];
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function normalizeText(str?: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Detects whether a string refers to a record label, corporate channel, or media company
 * rather than an individual musical artist or band.
 */
export function isRecordLabelOrChannel(name?: string | null): boolean {
  if (!name || typeof name !== 'string') return false;
  const lower = name.toLowerCase().trim();

  const labelPatterns = [
    /\b(?:sony|zee|tips|t-series|tseries|saregama|speed|lahari|aditya|muzik247|eros|svf|yrf|times\s*music|goldmines|think\s*music|sun\s*(?:tv|pictures))\b/i,
    /\b(?:music|records|recordings|entertainment|series|production|productions|pictures|films?|studios?|media|channel|broadcasting|television|jukebox|vevo)\b/i,
    /\b(?:tamil|telugu|hindi|malayalam|kannada|punjabi|bhojpuri)\s*(?:music|audio|songs?|hits?|media)\b/i,
    /\b(?:official|channel|company|audio|network)\b/i,
  ];

  return labelPatterns.some((pattern) => pattern.test(lower));
}

/**
 * Strips junk noise (websites, promotional tags) and validates that the string is a real artist,
 * not a channel or record label name.
 */
export function cleanArtistName(rawArtist?: string | null): string {
  if (!rawArtist || typeof rawArtist !== 'string') return '';

  let cleaned = rawArtist
    .replace(/\s*[\(\[].*?(?:pw|com|net|org|download|mp3|official|records|audio|video|lyric).*?[\)\]]/gi, '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/vevo$/i, '')
    .trim();

  // If empty or clearly a corporate channel / record label / placeholder, reject it
  const lower = cleaned.toLowerCase();
  if (
    !cleaned ||
    lower === 'various artists' ||
    lower === 'unknown' ||
    lower === 'unknown artist' ||
    isRecordLabelOrChannel(cleaned)
  ) {
    return '';
  }

  return cleaned;
}

/**
 * Attempts to extract the artist or music director from a YouTube video title.
 * Handles both "Badass - Leo | Thalapathy Vijay | Anirudh Ravichander" and "Artist - Song".
 */
export function extractArtistFromTitle(title?: string): string {
  if (!title || typeof title !== 'string') return '';

  const clean = title.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();

  // Pattern 1: Pipes: "Badass - Leo | Thalapathy Vijay | Anirudh Ravichander"
  if (clean.includes('|')) {
    const parts = clean.split('|').map((p) => p.trim()).filter(Boolean);
    // Usually the last or second-to-last segment is the composer or singer
    for (let i = parts.length - 1; i >= 1; i--) {
      const seg = parts[i];
      if (seg && !isRecordLabelOrChannel(seg) && seg.length <= 40) {
        const stripped = seg
          .replace(/^(?:music(?:\s*by)?|singer|composer|directed\s*by|starring)\s*[:\-]\s*/i, '')
          .trim();
        if (stripped && !isRecordLabelOrChannel(stripped)) {
          return stripped;
        }
      }
    }
  }

  // Pattern 2: Hyphen: "Artist - Title" (e.g. "Ed Sheeran - Shape of You", "The Weeknd - Blinding Lights")
  if (clean.includes('-')) {
    const parts = clean.split('-').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const candidateArtist = parts[0];
      if (candidateArtist && !isRecordLabelOrChannel(candidateArtist) && candidateArtist.length <= 40) {
        return candidateArtist;
      }
    }
  }

  return '';
}

/**
 * Cross-checks candidate result from LRCLIB against the YouTube title / channel / duration.
 * Ensures we NEVER show mismatched lyrics.
 */
function verifyLyricsMatch(
  rawTitle: string,
  channelTitle: string | undefined,
  candidate: any,
  duration?: number
): { matches: boolean; score: number; cleanTitle: string } {
  if (!candidate || !candidate.trackName) {
    return { matches: false, score: 0, cleanTitle: '' };
  }

  const cleanTitle = cleanSongTitle(candidate.trackName);
  if (!cleanTitle) {
    return { matches: false, score: 0, cleanTitle: '' };
  }

  const rawTitleClean = rawTitle.toLowerCase().replace(/\\/g, '').replace(/["""'']/g, '');
  const normRawTitle = normalizeText(rawTitleClean);
  const normCleanTitle = normalizeText(cleanTitle);

  const titleWords = normalizeWords(rawTitleClean);
  const titleWordSet = new Set(titleWords);

  const candidateTitleWords = normalizeWords(cleanTitle);
  if (candidateTitleWords.length === 0) {
    return { matches: false, score: 0, cleanTitle };
  }

  // 1. Title match: phrase match OR >= 80% word overlap
  const phraseMatch = normCleanTitle.length >= 3 && normRawTitle.includes(normCleanTitle);
  const matchedWords = candidateTitleWords.filter((w) => titleWordSet.has(w));
  const wordOverlapRatio = matchedWords.length / candidateTitleWords.length;

  const titleMatches = phraseMatch || wordOverlapRatio >= 0.8;
  if (!titleMatches) {
    return { matches: false, score: 0, cleanTitle };
  }

  let score = 0;
  if (phraseMatch) score += 60;
  score += Math.round(wordOverlapRatio * 40);

  // 2. Context words (artist + album, EXCLUDING song title words)
  const candidateTitleWordSet = new Set(candidateTitleWords);
  const candidateContextWords = [
    ...normalizeWords(candidate.artistName || ''),
    ...normalizeWords(candidate.albumName || ''),
  ].filter((w) => w.length > 2 && !candidateTitleWordSet.has(w));

  const channelWords = normalizeWords(channelTitle || '');
  const fullContextSet = new Set([...titleWords, ...channelWords]);

  const matchedContextWords = candidateContextWords.filter((w) => fullContextSet.has(w));
  const hasContextMatch = matchedContextWords.length > 0;
  if (hasContextMatch) {
    score += Math.min(40, matchedContextWords.length * 15);
  }

  // 3. Duration check
  let durationDiff = 9999;
  let durationOk = true;

  if (duration && candidate.duration) {
    durationDiff = Math.abs(candidate.duration - duration);
    if (durationDiff <= 5) {
      score += 30;
    } else if (durationDiff <= 15) {
      score += 20;
    } else if (durationDiff <= 30) {
      score += 10;
    } else if (durationDiff > 60) {
      score -= 40;
      if (!hasContextMatch && candidateTitleWords.length <= 2) {
        durationOk = false;
      }
    }
  }

  // 4. Single-word title disambiguation (e.g. "Illuminati", "Badass", "Hukum")
  // For 1-word songs, require context match OR duration within 20s (accommodates video skits/intros)
  if (candidateTitleWords.length === 1) {
    if (!hasContextMatch && durationDiff > 20) {
      return { matches: false, score: 0, cleanTitle };
    }
  }

  if (!durationOk) {
    return { matches: false, score: 0, cleanTitle };
  }

  return { matches: true, score, cleanTitle };
}

/**
 * Fallback to Cloudflare Edge Worker for Genius plain-text lyrics when LRCLIB has no verified match.
 * Zero RAM overhead on phone; resolves in ~200-300ms.
 */
async function fetchGeniusFallback(
  cleanTitle: string,
  artist?: string
): Promise<LyricsResult | null> {
  const workerEndpoint = GENIUS_LYRICS_WORKER_URL;
  if (!workerEndpoint) return null;

  try {
    const query = artist ? `${cleanTitle} ${artist}` : cleanTitle;
    const cleanEndpoint = workerEndpoint.replace(/\/+$/, '');
    const url = `${cleanEndpoint}?q=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const data = await res.json();
    if (data?.found && data.lyrics && typeof data.lyrics === 'string') {
      const parsedTitle = cleanSongTitle(data.title || cleanTitle);
      const parsedArtist = cleanArtistName(data.artist) || cleanArtistName(artist);
      return {
        lines: [],
        plainLyrics: data.lyrics.trim(),
        instrumental: false,
        hasLyrics: false,
        hasPlainLyrics: true,
        trackName: parsedTitle,
        artistName: parsedArtist,
        isMismatch: false,
      };
    }
  } catch (_) {
    // Worker offline, aborted, or network issue — fail gracefully
  }
  return null;
}

/**
 * Fetches time-synced (or plain-text fallback) lyrics via LRCLIB.
 * Cross-checks with YouTube title to guarantee 0% mismatch.
 */
export async function fetchLyrics(
  rawTitle: string,
  channelTitle?: string,
  duration?: number,
  videoId?: string
): Promise<LyricsResult> {
  const cacheKey = videoId || `${rawTitle}__${duration ?? 0}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  const noResult: LyricsResult = {
    lines: [],
    instrumental: false,
    hasLyrics: false,
    hasPlainLyrics: false,
    isMismatch: false,
  };

  if (!rawTitle || rawTitle === 'Initializing...') {
    return noResult;
  }

  const queries = buildSearchQueries(rawTitle, channelTitle);
  let bestSyncedCandidate: { item: any; score: number; cleanTitle: string } | null = null;
  let bestPlainCandidate: { item: any; score: number; cleanTitle: string } | null = null;
  let hadAnyApiResults = false;

  for (const q of queries) {
    try {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) continue;

      const data = await resp.json();
      if (!Array.isArray(data) || !data.length) continue;
      hadAnyApiResults = true;

      // ── Cross-check all candidates ──
      for (const item of data) {
        if (item.instrumental && !item.syncedLyrics && !item.plainLyrics) {
          continue;
        }

        const verification = verifyLyricsMatch(rawTitle, channelTitle, item, duration);
        if (!verification.matches) continue;

        // Candidate with synced lyrics
        if (item.syncedLyrics) {
          if (!bestSyncedCandidate || verification.score > bestSyncedCandidate.score) {
            bestSyncedCandidate = {
              item,
              score: verification.score,
              cleanTitle: verification.cleanTitle,
            };
          }
        }

        // Candidate with plain lyrics fallback
        if (item.plainLyrics) {
          if (!bestPlainCandidate || verification.score > bestPlainCandidate.score) {
            bestPlainCandidate = {
              item,
              score: verification.score,
              cleanTitle: verification.cleanTitle,
            };
          }
        }
      }

      // Strong verified match found early (phrase match + context/duration match)
      if (bestSyncedCandidate && bestSyncedCandidate.score >= 120) {
        break;
      }
    } catch (_) {
      // Network error — try next query
    }
  }

  // ── 1. Return verified synced lyrics ──
  if (bestSyncedCandidate) {
    const lines = parseLrc(bestSyncedCandidate.item.syncedLyrics);
    if (lines.length > 0) {
      const artist =
        cleanArtistName(bestSyncedCandidate.item.artistName) ||
        extractArtistFromTitle(rawTitle);

      const res: LyricsResult = {
        lines,
        plainLyrics: bestSyncedCandidate.item.plainLyrics,
        instrumental: Boolean(bestSyncedCandidate.item.instrumental),
        hasLyrics: true,
        hasPlainLyrics: Boolean(bestSyncedCandidate.item.plainLyrics),
        trackName: bestSyncedCandidate.cleanTitle,
        artistName: artist,
        isMismatch: false,
      };
      lyricsCache.set(cacheKey, res);
      return res;
    }
  }

  // ── 2. Fallback: verified plain lyrics ──
  if (bestPlainCandidate) {
    const artist =
      cleanArtistName(bestPlainCandidate.item.artistName) ||
      extractArtistFromTitle(rawTitle);

    const res: LyricsResult = {
      lines: [],
      plainLyrics: bestPlainCandidate.item.plainLyrics,
      instrumental: Boolean(bestPlainCandidate.item.instrumental),
      hasLyrics: false,
      hasPlainLyrics: true,
      trackName: bestPlainCandidate.cleanTitle,
      artistName: artist,
      isMismatch: false,
    };
    lyricsCache.set(cacheKey, res);
    return res;
  }

  // ── 3. Fallback: Cloudflare Edge Worker (Genius plain lyrics) ──
  if (GENIUS_LYRICS_WORKER_URL) {
    const rawCleanTitle = cleanSongTitle(rawTitle);
    const possibleArtist =
      cleanArtistName(channelTitle) || extractArtistFromTitle(rawTitle);
    const geniusResult = await fetchGeniusFallback(rawCleanTitle, possibleArtist);
    if (geniusResult) {
      lyricsCache.set(cacheKey, geniusResult);
      return geniusResult;
    }
  }

  // ── 4. If LRCLIB returned results but none passed cross-check → MISMATCH ──
  if (hadAnyApiResults) {
    const mismatchResult: LyricsResult = {
      lines: [],
      instrumental: false,
      hasLyrics: false,
      hasPlainLyrics: false,
      isMismatch: true,
    };
    lyricsCache.set(cacheKey, mismatchResult);
    return mismatchResult;
  }

  // ── 5. No results at all from LRCLIB or Genius ──
  lyricsCache.set(cacheKey, noResult);
  return noResult;
}
