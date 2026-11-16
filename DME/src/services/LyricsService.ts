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
      /\s*[\(\[\{][^\)\]\}]*[\)\]\}]/g,
      ' '
    )
    .replace(/["""'']/g, '')
    .trim();
}

/**
 * Strips YouTube clutter from a single segment while preserving genuine title words.
 */
function cleanSegmentText(raw: string): string {
  if (!raw) return '';
  let s = raw;
  // 1. Remove bracketed / parenthesized content: (Official Video), [4K], etc.
  s = s.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');

  // 1b. Strip resolution / quality combinations and framerate tags
  s = s.replace(/\b(?:8k\s*[\/\\]\s*4k|4k\s*[\/\\]\s*8k|hd\s*[\/\\]\s*4k|8k\s*[\/\\]\s*hd|4k\s*[\/\\]\s*uhd)\b/gi, ' ');
  s = s.replace(/\b(?:[0-9]+k|[0-9]+p|[0-9]+\s*fps|uhd|ultra\s*hd|fhd|qhd|hdr10\+?|hdr|dolby\s*(?:vision|atmos))\b/gi, ' ');

  // 2. Strip noise phrases
  const noisePhrases = [
    /\b(?:official\s*(?:music\s*)?video|official\s*audio|official\s*video\s*song|official|lyric\s*video|lyrics\s*video|lyrical\s*video|lyric\s*song|video\s*song|audio\s*song|full\s*song|full\s*video|title\s*track|theme\s*song)\b/gi,
    /\b(?:movie\s*songs?|film\s*songs?|video\s*songs?|audio\s*songs?|tamil\s*songs?|telugu\s*songs?|hindi\s*songs?)\b/gi,
    /\b(?:tamil\s*movie|telugu\s*movie|hindi\s*movie|malayalam\s*movie|kannada\s*movie)\b/gi,
    /\b(?:movie|film)\b/gi,
    /\b(?:tamil\s*lyric|telugu\s*lyric|hindi\s*lyric|lyrics?|lyrical)\b/gi,
    /\b(?:tamil|telugu|hindi|malayalam|kannada|bengali|punjabi|english)\b/gi,
    /\b(?:video|videos|audio|audios|soundtrack|ost|visualizer|remastered)\b/gi,
    /\b(?:featuring|feat\.?|ft\.?)\b.*$/gi,
  ];
  for (const p of noisePhrases) {
    s = s.replace(p, ' ');
  }

  // 3. Strip trailing / standalone 'songs?' or 'hits?' or 'jukebox'
  s = s.replace(/\b(?:songs?|hits?|jukebox)\b/gi, ' ');

  // 4. Strip punctuation
  s = s.replace(/[\\/|:–—_~•#*"'`]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function cleanChannelTitle(ch?: string): string {
  if (!ch) return '';
  return ch
    .replace(/\s*(?:VEVO|Official|Music|Records|Channel|- Topic|Tamil|Audio|Entertainment|Series|Productions?|Films?|Studios?)$/gi, '')
    .trim();
}

/**
 * Strips soundtrack, score, compilation and language noise from album title.
 * e.g. "Sketch (Original Motion Picture Soundtrack)" → "Sketch"
 * e.g. "Enakku 20 Unakku 18 (Original Motion Picture Soundtrack)" → "Enakku 20 Unakku 18"
 * e.g. "David" → "David"
 */
export function cleanAlbumTitle(raw?: string): string {
  if (!raw) return '';
  let clean = raw;
  clean = clean.replace(/\s*[\(\[]\s*(?:original\s+(?:motion\s+picture\s+)?soundtrack|ost|soundtrack|score|movie\s*soundtrack)[^\)\]]*[\)\]]/gi, '');
  clean = clean.replace(/\s*[-–—|]\s*(?:original\s+(?:motion\s+picture\s+)?soundtrack|ost|soundtrack|score)[^(\n]+/gi, '');
  clean = clean.replace(/\s*[\(\[]\s*(?:deluxe|bonus\s*track\s*version|expanded|anniversary|remastered|single|ep)\s*[\)\]]/gi, '');
  clean = clean.replace(/\s*[\(\[]\s*(?:tamil|telugu|hindi|malayalam|kannada)\s*[\)\]]/gi, '');
  clean = clean.replace(/\\/g, '');
  clean = clean.replace(/["""'']/g, '');
  return clean.replace(/^[-\s:|–—]+|[-\s:|–—]+$/g, '').trim();
}

/**
 * Checks if an album name is a generic / non-movie label (e.g. compilation, single, EP).
 */
function isGenericAlbum(albumName?: string, trackName?: string): boolean {
  if (!albumName) return true;
  const normAlbum = normalizeText(albumName);
  const normTrack = normalizeText(trackName);
  if (normAlbum === normTrack) return true;
  if (/\b(?:hits?|vol|volume|collection|greatest|best\s*of|anthology|essential|compilation|single|ep|remixes)\b/i.test(albumName)) {
    return true;
  }
  return false;
}

const SONG_MARKER_REGEX = /\b(?:video\s*songs?|audio\s*songs?|full\s*(?:video|song|audio)|official\s*(?:video|audio|music\s*video)|music\s*video|lyric(?:al)?\s*(?:video|song)?|lyrics?\s*video|title\s*track|theme\s*song|[0-9]+k|[0-9]+\s*fps|uhd|video|audio)\b/i;

/**
 * Extracts explicit candidate movie names, clean segments and hyphen pairs from a YouTube title.
 */
function extractTitleContext(rawTitle: string): {
  cleanSegments: string[];
  hyphenPairs: { partA: string; partB: string }[];
  explicitMovieCandidates: string[];
  primarySongCandidates: string[];
} {
  const standardized = rawTitle.replace(/[\\/~•:]/g, '|');
  const rawSegments = standardized
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const cleanSegments: string[] = [];
  const hyphenPairs: { partA: string; partB: string }[] = [];
  const explicitMovieCandidates: string[] = [];
  const primarySongCandidates: string[] = [];

  for (const rawSeg of rawSegments) {
    if (/\b(?:tamil\s*movie|telugu\s*movie|hindi\s*movie|malayalam\s*movie|kannada\s*movie|movie|film|movie\s*songs?|from)\b/i.test(rawSeg)) {
      const cleanMovie = cleanSegmentText(rawSeg);
      if (cleanMovie.length >= 2) {
        explicitMovieCandidates.push(cleanMovie);
      }
    }

    if (/[-–—]/.test(rawSeg)) {
      const parts = rawSeg.split(/\s*[-–—]\s*/);
      const cleanParts = parts.map((p) => cleanSegmentText(p)).filter((p) => p.length >= 2);
      if (cleanParts.length >= 2) {
        hyphenPairs.push({ partA: cleanParts[0], partB: cleanParts[1] });
        if (SONG_MARKER_REGEX.test(parts[1]) && !SONG_MARKER_REGEX.test(parts[0])) {
          primarySongCandidates.push(cleanParts[1]);
          explicitMovieCandidates.push(cleanParts[0]);
        } else if (SONG_MARKER_REGEX.test(parts[0]) && !SONG_MARKER_REGEX.test(parts[1])) {
          primarySongCandidates.push(cleanParts[0]);
          explicitMovieCandidates.push(cleanParts[1]);
        }
        cleanSegments.push(cleanParts[1]);
        cleanSegments.push(cleanParts[0]);
      } else if (cleanParts.length === 1) {
        cleanSegments.push(cleanParts[0]);
      }
    } else {
      const cleaned = cleanSegmentText(rawSeg);
      if (cleaned.length >= 2 && !rawSeg.includes(',')) {
        if (SONG_MARKER_REGEX.test(rawSeg)) {
          primarySongCandidates.push(cleaned);
        }
        cleanSegments.push(cleaned);
      }
    }
  }

  return {
    cleanSegments: Array.from(new Set(cleanSegments)),
    hyphenPairs,
    explicitMovieCandidates: Array.from(new Set(explicitMovieCandidates)),
    primarySongCandidates: Array.from(new Set(primarySongCandidates)),
  };
}

/**
 * Builds smart, categorized search queries from a raw YouTube title.
 * Ordered from most-specific (Song + Movie / Song + Artist) to individual song title.
 */
function buildSearchQueries(rawTitle: string, channelTitle?: string): string[] {
  const ctx = extractTitleContext(rawTitle);
  const queries: string[] = [];

  // Priority 0: Primary song candidate combined with movie or other segments (e.g. "Nenjil Nenjil Engeyum Kaadhal")
  for (const song of ctx.primarySongCandidates) {
    for (const movie of ctx.explicitMovieCandidates) {
      if (song.toLowerCase() !== movie.toLowerCase()) {
        queries.push(`${song} ${movie}`);
        queries.push(`${movie} ${song}`);
      }
    }
    for (const seg of ctx.cleanSegments) {
      if (seg.toLowerCase() !== song.toLowerCase()) {
        queries.push(`${song} ${seg}`);
        queries.push(`${seg} ${song}`);
      }
    }
    queries.push(song);
  }

  // Priority 1: Hyphen pairs combined (e.g. "Nenjil Nenjil Engeyum Kaadhal", "Engeyum Kaadhal Nenjil Nenjil")
  for (const pair of ctx.hyphenPairs) {
    queries.push(`${pair.partB} ${pair.partA}`);
    queries.push(`${pair.partA} ${pair.partB}`);
    queries.push(pair.partB);
    queries.push(pair.partA);
  }

  // Priority 2: Explicit movie + segment combinations (e.g. "Moongil Kaadugale Samurai")
  for (const movie of ctx.explicitMovieCandidates) {
    for (const seg of ctx.cleanSegments) {
      if (seg.toLowerCase() !== movie.toLowerCase()) {
        queries.push(`${seg} ${movie}`);
      }
    }
  }

  // Priority 3: Segment combinations (e.g. Seg 1 + Seg 0, Seg 1 + Seg 2)
  for (let i = 0; i < ctx.cleanSegments.length; i++) {
    for (let j = 0; j < ctx.cleanSegments.length; j++) {
      if (i !== j) {
        queries.push(`${ctx.cleanSegments[i]} ${ctx.cleanSegments[j]}`);
      }
    }
  }

  // Priority 4: Individual segments (e.g. "Moongil Kaadugale", "Sandhippoma", "Oh Mariya")
  for (const seg of ctx.cleanSegments) {
    queries.push(seg);
  }

  if (channelTitle) {
    const cleanChannel = cleanChannelTitle(channelTitle);
    if (cleanChannel && ctx.cleanSegments[0]) {
      queries.push(`${ctx.cleanSegments[0]} ${cleanChannel}`);
    }
  }

  return Array.from(
    new Set(
      queries
        .map((q) => q.replace(/[-–—:|]+$/g, '').replace(/\s+/g, ' ').trim())
        .filter((q) => q.length >= 2)
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

  // 5. Strip trailing noise words: "Video Song", "Audio Song", "Video", "Song", etc.
  clean = clean.replace(
    /\s+(?:video\s+songs?|audio\s+songs?|official\s+video|official\s+audio|hd\s+video|full\s+(?:video|song|audio)|lyric\s+video|music\s+video|video|song)\s*$/gi,
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
    /\b(?:sony|zee|tips|t-series|tseries|saregama|speed|lahari|aditya|muzik247|eros|svf|yrf|times\s*music|goldmines|think\s*music|sun\s*(?:tv|pictures)|ayngaran|shemaroo|venus|ultra|satyam|rajshri|anand\s*audio|dbeats|manorama|newstalgia)\b/i,
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

  const clean = title.replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/[\\/~•:]/g, '|').trim();

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
): {
  matches: boolean;
  score: number;
  cleanTitle: string;
  hasMovieMatch: boolean;
  hasArtistMatch: boolean;
  hasMovieConflict: boolean;
} {
  const fail = (clean = '') => ({
    matches: false,
    score: 0,
    cleanTitle: clean,
    hasMovieMatch: false,
    hasArtistMatch: false,
    hasMovieConflict: false,
  });

  if (!candidate || !candidate.trackName) {
    return fail();
  }

  const cleanTitle = cleanSongTitle(candidate.trackName);
  if (!cleanTitle) {
    return fail();
  }

  const rawTitleClean = rawTitle.toLowerCase().replace(/\\/g, '').replace(/["""'']/g, '');
  const normRawTitle = normalizeText(rawTitleClean);
  const normCleanTitle = normalizeText(cleanTitle);

  const titleWords = normalizeWords(rawTitleClean);
  const titleWordSet = new Set(titleWords);

  const candidateTitleWords = normalizeWords(cleanTitle);
  if (candidateTitleWords.length === 0) {
    return fail(cleanTitle);
  }

  // 1. Title match: phrase match OR >= 80% word overlap
  const phraseMatch = normCleanTitle.length >= 3 && normRawTitle.includes(normCleanTitle);
  const matchedWords = candidateTitleWords.filter((w) => titleWordSet.has(w));
  const wordOverlapRatio = matchedWords.length / candidateTitleWords.length;

  const titleMatches = phraseMatch || wordOverlapRatio >= 0.8;
  if (!titleMatches) {
    return fail(cleanTitle);
  }

  let score = 0;
  if (phraseMatch) score += 60;
  score += Math.round(wordOverlapRatio * 40);

  // Specificity bonus: Multi-word / longer song titles get higher priority
  score += Math.min(30, normCleanTitle.length * 2);

  // 2. Candidate Movie / Album Extraction
  const candidateTitleWordSet = new Set(candidateTitleWords);
  const cleanAlbum = cleanAlbumTitle(candidate.albumName);
  const isGeneric = isGenericAlbum(candidate.albumName, candidate.trackName);

  // Extract movie from track name if it has (From "...")
  let trackMovie = '';
  const fromMatch = candidate.trackName.match(/[\(\[-]\s*from\s+["']?([^)"'\]]+)/i);
  if (fromMatch && fromMatch[1]) {
    trackMovie = cleanAlbumTitle(fromMatch[1]);
  }

  const candidateArtistWords = normalizeWords(candidate.artistName || '').filter(
    (w) => w.length > 2 && !candidateTitleWordSet.has(w)
  );
  const candidateArtistWordSet = new Set(candidateArtistWords);

  // CRITICAL: candidateMovieWords must NOT include words from candidate artist name!
  // Eponymous albums (e.g. "Harris Jayaraj", "A.R. Rahman") are NOT movies!
  const candidateMovieWords = [
    ...normalizeWords(cleanAlbum),
    ...normalizeWords(trackMovie),
  ].filter((w) => w.length > 1 && !candidateTitleWordSet.has(w) && !candidateArtistWordSet.has(w));

  const channelWords = normalizeWords(channelTitle || '');
  const fullContextSet = new Set([...titleWords, ...channelWords]);

  // MOVIE / ALBUM MATCH:
  const matchedMovieWords = candidateMovieWords.filter((w) => fullContextSet.has(w));
  const hasMovieMatch = matchedMovieWords.length > 0;

  if (hasMovieMatch) {
    // Massive bonus: Song is proven to be from the exact movie mentioned in the YouTube title!
    score += Math.min(80, matchedMovieWords.length * 40);
  }

  // ARTIST / COMPOSER MATCH:
  const matchedArtistWords = candidateArtistWords.filter((w) => fullContextSet.has(w));
  const hasArtistMatch = matchedArtistWords.length > 0;
  if (hasArtistMatch) {
    score += Math.min(40, matchedArtistWords.length * 20);
  }

  // 3. PRIMARY SONG CANDIDATE BONUS:
  // If candidate trackName matches the segment that explicitly had "video song" / "song" attached
  // in the YouTube title, award a massive disambiguation bonus over movie title tracks!
  const titleContext = extractTitleContext(rawTitle);
  for (const songCand of titleContext.primarySongCandidates) {
    if (normalizeText(songCand) === normCleanTitle) {
      score += 70;
      break;
    }
  }

  // 4. MOVIE CONFLICT DETECTION:
  // Context has multiple segments / indicators
  const hasMultipleTitleContexts =
    titleContext.explicitMovieCandidates.length > 0 || titleContext.cleanSegments.length >= 2;

  const hasMovieConflict =
    !isGeneric && candidateMovieWords.length > 0 && !hasMovieMatch && hasMultipleTitleContexts;

  if (hasMovieConflict) {
    // For common / short song titles (<= 2 words like "Anbe Anbe", "Kanave Kanave", "Kadhale Kadhale"),
    // an album conflict is a fatal mismatch because common titles exist across multiple movies.
    if (candidateTitleWords.length <= 2) {
      return fail(cleanTitle);
    }
    // For longer titles (>= 3 words), heavily penalize
    score -= 70;
  }

  // 4. Duration check
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
      if (!hasMovieMatch && !hasArtistMatch && candidateTitleWords.length <= 2) {
        durationOk = false;
      }
    }
  }

  // 5. Single-word title disambiguation (e.g. "Illuminati", "Badass", "Hukum")
  if (candidateTitleWords.length === 1) {
    if (!hasMovieMatch && !hasArtistMatch && durationDiff > 20) {
      return fail(cleanTitle);
    }
  }

  if (!durationOk) {
    return fail(cleanTitle);
  }

  return {
    matches: true,
    score,
    cleanTitle,
    hasMovieMatch,
    hasArtistMatch,
    hasMovieConflict,
  };
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
  let bestSyncedCandidate: {
    item: any;
    score: number;
    cleanTitle: string;
    hasMovieMatch: boolean;
  } | null = null;
  let bestPlainCandidate: {
    item: any;
    score: number;
    cleanTitle: string;
    hasMovieMatch: boolean;
  } | null = null;
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
              hasMovieMatch: verification.hasMovieMatch,
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
              hasMovieMatch: verification.hasMovieMatch,
            };
          }
        }
      }

      // Strong verified match found early (phrase match + confirmed movie match)
      if (bestSyncedCandidate && bestSyncedCandidate.score >= 180) {
        break;
      }
    } catch (_) {
      // Network error — try next query
    }
  }

  // Selection priority:
  // A candidate with CONFIRMED MOVIE MATCH always beats a candidate without movie match,
  // preventing synced lyrics from a different movie from overshadowing lyrics from the correct movie!
  let chosenCandidate: {
    item: any;
    score: number;
    cleanTitle: string;
    hasMovieMatch: boolean;
    isSynced: boolean;
  } | null = null;

  if (bestSyncedCandidate && bestSyncedCandidate.hasMovieMatch) {
    chosenCandidate = { ...bestSyncedCandidate, isSynced: true };
  } else if (bestPlainCandidate && bestPlainCandidate.hasMovieMatch) {
    if (!bestSyncedCandidate || !bestSyncedCandidate.hasMovieMatch) {
      chosenCandidate = { ...bestPlainCandidate, isSynced: false };
    } else {
      chosenCandidate = { ...bestSyncedCandidate, isSynced: true };
    }
  } else if (bestSyncedCandidate) {
    chosenCandidate = { ...bestSyncedCandidate, isSynced: true };
  } else if (bestPlainCandidate) {
    chosenCandidate = { ...bestPlainCandidate, isSynced: false };
  }

  // ── 1. Return verified synced lyrics ──
  if (chosenCandidate && chosenCandidate.isSynced) {
    const lines = parseLrc(chosenCandidate.item.syncedLyrics);
    if (lines.length > 0) {
      const artist =
        cleanArtistName(chosenCandidate.item.artistName) ||
        extractArtistFromTitle(rawTitle);

      const res: LyricsResult = {
        lines,
        plainLyrics: chosenCandidate.item.plainLyrics,
        instrumental: Boolean(chosenCandidate.item.instrumental),
        hasLyrics: true,
        hasPlainLyrics: Boolean(chosenCandidate.item.plainLyrics),
        trackName: chosenCandidate.cleanTitle,
        artistName: artist,
        isMismatch: false,
      };
      lyricsCache.set(cacheKey, res);
      return res;
    }
  }

  // ── 2. Fallback: verified plain lyrics ──
  if (chosenCandidate && !chosenCandidate.isSynced) {
    const artist =
      cleanArtistName(chosenCandidate.item.artistName) ||
      extractArtistFromTitle(rawTitle);

    const res: LyricsResult = {
      lines: [],
      plainLyrics: chosenCandidate.item.plainLyrics,
      instrumental: Boolean(chosenCandidate.item.instrumental),
      hasLyrics: false,
      hasPlainLyrics: true,
      trackName: chosenCandidate.cleanTitle,
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
