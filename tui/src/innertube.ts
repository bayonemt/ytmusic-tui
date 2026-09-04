import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '..', '.auth.json');

// Constantes confirmadas do APK (vpj.java e análise APK)
const WEB_REMIX_API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-KVIS-GHjc';
const ANDROID_MUSIC_API_KEY = 'AIzaSyAOghZGza2MQSZkY_zfZ370N-PUdXEo8AI';
const INNERTUBE_WEB_BASE = 'https://music.youtube.com/youtubei/v1';
const INNERTUBE_ANDROID_BASE = 'https://youtubei.googleapis.com/youtubei/v1';

// OAuth2 para TUI (device flow)
const OAUTH_CLIENT_ID = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = 'SboVhoG9s0rNafixCSGGKXAT';
const OAUTH_DEVICE_URL = 'https://oauth2.googleapis.com/device/code';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function buildWebContext(hl = 'pt-BR', gl = 'BR') {
  return {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20240101.01.00',
      hl,
      gl,
      platform: 'DESKTOP',
      utcOffsetMinutes: -180,
    },
  };
}

function buildAndroidContext(hl = 'pt-BR', gl = 'BR') {
  return {
    client: {
      clientName: 'ANDROID_MUSIC',
      clientVersion: '9.32.51',
      androidSdkVersion: 30,
      hl,
      gl,
      platform: 'MOBILE',
      osName: 'Android',
      osVersion: '10',
    },
  };
}

function loadTokens(): AuthTokens | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens: AuthTokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function httpPost(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function httpPostForm(url: string, params: Record<string, string>): Promise<any> {
  const payload = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function refreshAccessToken(refresh_token: string): Promise<AuthTokens> {
  const res = await httpPostForm(OAUTH_TOKEN_URL, {
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    refresh_token,
    grant_type: 'refresh_token',
  });
  return {
    access_token: res.access_token,
    refresh_token,
    expires_at: Date.now() + res.expires_in * 1000 - 60_000,
  };
}

async function getValidToken(): Promise<string | null> {
  let tokens = loadTokens();
  if (!tokens) return null;
  if (Date.now() >= tokens.expires_at) {
    tokens = await refreshAccessToken(tokens.refresh_token);
    saveTokens(tokens);
  }
  return tokens.access_token;
}

export async function startDeviceFlow() {
  const res = await httpPostForm(OAUTH_DEVICE_URL, {
    client_id: OAUTH_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/youtube',
  });
  return res as { user_code: string; verification_url: string; device_code: string; interval: number };
}

export async function pollDeviceFlow(device_code: string, interval: number): Promise<boolean> {
  await new Promise(r => setTimeout(r, interval * 1000));
  try {
    const res = await httpPostForm(OAUTH_TOKEN_URL, {
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (res.access_token && res.refresh_token) {
      saveTokens({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
        expires_at: Date.now() + (res.expires_in ?? 3600) * 1000 - 60_000,
      });
      return true;
    }
  } catch { /* authorization_pending */ }
  return false;
}

export function isAuthenticated(): boolean {
  return loadTokens() !== null;
}

async function webRequest(endpoint: string, body: Record<string, unknown>, token?: string | null) {
  const headers: Record<string, string> = {
    'X-YouTube-Client-Name': '67',
    'X-YouTube-Client-Version': '1.20250101.01.00',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://music.youtube.com/',
    'Origin': 'https://music.youtube.com',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Goog-AuthUser'] = '0';
  }
  const url = `${INNERTUBE_WEB_BASE}/${endpoint}?key=${WEB_REMIX_API_KEY}&prettyPrint=false`;
  return httpPost(url, { context: buildWebContext(), ...body }, headers);
}

async function androidRequest(endpoint: string, body: Record<string, unknown>) {
  const token = await getValidToken();
  const headers: Record<string, string> = {
    'User-Agent': 'com.google.android.apps.youtube.music/9.32.51 (Linux; U; Android 10; GB) gzip',
    'X-Goog-Api-Format-Version': '2',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${INNERTUBE_ANDROID_BASE}/${endpoint}?key=${ANDROID_MUSIC_API_KEY}&alt=json&prettyPrint=false`;
  return httpPost(url, { context: buildAndroidContext(), ...body }, headers);
}

// === Tipos de resultado ===

export interface SongSearchResult {
  type: 'song';
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string;
}

export interface ArtistSearchResult {
  type: 'artist';
  browseId: string;
  name: string;
  thumbnail: string;
  subtitle: string;
}

export type SearchResult = SongSearchResult | ArtistSearchResult;

// ── Artist page ────────────────────────────────────────────────────
export interface ArtistTopSong {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  durationMs?: number;
}

export interface ArtistRelease {
  browseId: string;
  title: string;
  thumbnail: string;
  year?: string;
}

export interface ArtistPage {
  browseId: string;
  name: string;
  thumbnail: string;
  description?: string;
  topSongs: ArtistTopSong[];
  albums: ArtistRelease[];
  singles: ArtistRelease[];
}

export async function getArtistPage(browseId: string): Promise<ArtistPage | null> {
  try {
    const res: any = await webRequest('browse', { browseId });
    const immersive: any = res?.header?.musicImmersiveHeaderRenderer
      ?? res?.header?.musicVisualHeaderRenderer ?? {};
    const name: string = immersive?.title?.runs?.[0]?.text ?? '';
    const thumbnail: string =
      (immersive?.thumbnail ?? immersive?.foregroundThumbnail)
        ?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at?.(-1)?.url ?? '';
    const description: string | undefined = immersive?.description?.runs?.[0]?.text;

    const tabs: any[] =
      res?.contents?.singleColumnBrowseResultsRenderer?.tabs ?? [];
    const sections: any[] =
      tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

    // Top songs
    const topSongs: ArtistTopSong[] = [];
    const topShelf: any = sections[0]?.musicShelfRenderer;
    for (const item of topShelf?.contents ?? []) {
      const r: any = item?.musicResponsiveListItemRenderer;
      if (!r) continue;
      const videoId: string = r.flexColumns?.[0]
        ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
        ?.navigationEndpoint?.watchEndpoint?.videoId ?? '';
      const title: string = r.flexColumns?.[0]
        ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
      const artistStr: string = r.flexColumns?.[1]
        ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? name;
      const thumb: string = r.thumbnail
        ?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at?.(-1)?.url ?? '';
      if (videoId && title) topSongs.push({ videoId, title, artist: artistStr, thumbnail: thumb });
    }

    // Albums and singles from carousels
    const albums: ArtistRelease[] = [];
    const singles: ArtistRelease[] = [];

    for (let i = 1; i < sections.length; i++) {
      const carousel: any = sections[i]?.musicCarouselShelfRenderer;
      if (!carousel) continue;
      const carouselTitle: string =
        (carousel?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text ?? '').toLowerCase();
      const isSingles = /single|ep/.test(carouselTitle);
      const isAlbums = !isSingles && /álbuns?|albums?/.test(carouselTitle);
      if (!isSingles && !isAlbums) continue;

      const target = isSingles ? singles : albums;
      for (const item of carousel?.contents ?? []) {
        const two: any = item?.musicTwoRowItemRenderer;
        if (!two) continue;
        const releaseTitle: string = two?.title?.runs?.[0]?.text ?? '';
        const releaseBrowseId: string =
          two?.navigationEndpoint?.browseEndpoint?.browseId ?? '';
        const releaseThumbnail: string =
          two?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at?.(-1)?.url
          ?? two?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at?.(-1)?.url ?? '';
        const year: string | undefined = two?.subtitle?.runs?.find(
          (r: any) => /^\d{4}$/.test(r.text ?? '')
        )?.text;
        if (releaseTitle && releaseBrowseId) {
          target.push({ browseId: releaseBrowseId, title: releaseTitle, thumbnail: releaseThumbnail, year });
        }
      }
    }

    return { browseId, name, thumbnail, description, topSongs, albums, singles };
  } catch {
    return null;
  }
}

export async function search(query: string): Promise<SearchResult[]> {
  // Sem params = resultados mistos: artistas + músicas + álbuns
  const res = await webRequest('search', { query });

  const results: SearchResult[] = [];
  const seenBrowseIds = new Set<string>();
  const seenVideoIds = new Set<string>();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sections: any[] = res?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

    for (const section of sections) {
      // Artista em destaque (musicCardShelfRenderer) — aparece quando a query é um nome de artista
      const card: any = section?.musicCardShelfRenderer;
      if (card) {
        const ep: any = card?.onTap?.browseEndpoint;
        const cardBrowseId: string = ep?.browseId ?? '';
        const cardPageType: string =
          ep?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
        if (cardBrowseId && cardPageType === 'MUSIC_PAGE_TYPE_ARTIST' && !seenBrowseIds.has(cardBrowseId)) {
          seenBrowseIds.add(cardBrowseId);
          results.push({
            type: 'artist',
            browseId: cardBrowseId,
            name: card?.title?.runs?.[0]?.text ?? '',
            thumbnail: card?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at?.(-1)?.url ?? '',
            subtitle: card?.subtitle?.runs?.[0]?.text ?? '',
          });
        }
        continue; // músicas dentro do card são do artista, não acrescentamos aqui
      }

      // Seções normais (itemSectionRenderer)
      const sectionContents: any[] = section?.itemSectionRenderer?.contents
        ?? section?.musicShelfRenderer?.contents ?? [];

      for (const item of sectionContents) {
        const r: any = item?.musicResponsiveListItemRenderer;
        if (!r) continue;

        // Artista via navigationEndpoint direto no renderer
        const navEp: any = r?.navigationEndpoint;
        const navBrowseEp: any = navEp?.browseEndpoint;
        const navPageType: string =
          navBrowseEp?.browseEndpointContextSupportedConfigs
            ?.browseEndpointContextMusicConfig?.pageType ?? '';

        if (navPageType === 'MUSIC_PAGE_TYPE_ARTIST') {
          const artistBrowseId: string = navBrowseEp?.browseId ?? '';
          if (artistBrowseId && !seenBrowseIds.has(artistBrowseId)) {
            seenBrowseIds.add(artistBrowseId);
            const artistName: string = r.flexColumns?.[0]
              ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
            const artistThumb: string = r.thumbnail
              ?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at?.(-1)?.url ?? '';
            results.push({ type: 'artist', browseId: artistBrowseId, name: artistName, thumbnail: artistThumb, subtitle: '' });
          }
          continue;
        }

        // Música (watchEndpoint em flexColumns[0])
        const videoId: string = r.flexColumns?.[0]
          ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.watchEndpoint?.videoId ?? '';
        if (!videoId || seenVideoIds.has(videoId)) continue;
        seenVideoIds.add(videoId);

        const title: string = r.flexColumns?.[0]
          ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
        const artist: string = r.flexColumns?.[1]
          ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
        const duration: string = r.flexColumns?.[1]
          ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.at?.(-1)?.text ?? '';
        const thumbnail: string = r.thumbnail
          ?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at?.(-1)?.url ?? '';

        if (title) results.push({ type: 'song', videoId, title, artist, duration, thumbnail });
      }
    }
  } catch { /* parse error */ }
  return results;
}

export interface StreamInfo {
  url: string;
  mimeType: string;
  itag: number;
  bitrate: number;
  durationMs: number;
}

// Cache de URLs de stream. YouTube stream URLs expiram em ~6h; mantemos por 5h.
const streamCache = new Map<string, { result: StreamInfo; expiresAt: number }>();
const STREAM_TTL_MS = 5 * 60 * 60 * 1000;

// Coalesces concurrent requests for the same videoId.
const streamInflight = new Map<string, Promise<StreamInfo | null>>();

// android_vr bypasses bot-detection for most tracks but returns 403 URLs for some
// YouTube Music-exclusive content. mediaconnect is the reliable fallback for those.
async function tryDlpClient(videoId: string, client: string): Promise<StreamInfo | null> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--extractor-args', `youtube:player_client=${client}`,
      '--get-url', '--get-duration',
      '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
      '--no-playlist', '--no-warnings',
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 30_000 });
    const lines = stdout.trim().split('\n');
    const url = lines[0];
    const durationStr = lines[1] ?? '0:00';
    if (!url?.startsWith('http')) return null;
    const parts = durationStr.split(':').map(Number);
    let durationMs = 0;
    if (parts.length === 3) durationMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    else if (parts.length === 2) durationMs = (parts[0] * 60 + parts[1]) * 1000;
    else durationMs = parts[0] * 1000;
    const mimeType = url.includes('mime=audio%2Fwebm') || url.includes('mime=audio/webm')
      ? 'audio/webm; codecs="opus"' : 'audio/mp4';
    return { url, mimeType, itag: 251, bitrate: 160000, durationMs };
  } catch { return null; }
}

// YouTube CDN rejects HEAD requests (403) but accepts Range GET (206).
// We request 1 byte to confirm the URL is actually streamable before giving it to mpv.
function checkUrlAccessible(url: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' }, res => {
        res.destroy(); // don't read the body, just check the status
        resolve(res.statusCode === 200 || res.statusCode === 206);
      });
      req.setHeader('Range', 'bytes=0-0');
      req.on('error', () => resolve(false));
      req.setTimeout(5000, () => { req.destroy(); resolve(false); });
      req.end();
    } catch { resolve(false); }
  });
}

async function getStreamViaDlp(videoId: string): Promise<StreamInfo | null> {
  // Try android_vr first: fast and works for most tracks
  const info = await tryDlpClient(videoId, 'android_vr');
  if (info) {
    if (await checkUrlAccessible(info.url)) return info;
    // URL returned 403 — android_vr can't access this track (Music Premium content).
    // Fall through to mediaconnect which bypasses this restriction.
  }
  // mediaconnect handles tracks that android_vr returns 403 for
  return tryDlpClient(videoId, 'mediaconnect');
}

// When a videoId is unavailable (deleted/private), search YouTube by title+artist
// and return the first playable result. This mirrors what YouTube Music web does.
async function trySearchFallback(title: string, artist: string): Promise<StreamInfo | null> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const query = artist ? `${title} ${artist}` : title;
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--extractor-args', 'youtube:player_client=android_vr',
      '--get-url', '--get-duration',
      '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
      '--no-playlist', '--no-warnings',
      '--match-filter', '!is_live',
      `ytsearch1:${query}`,
    ], { timeout: 40_000 });
    const lines = stdout.trim().split('\n');
    const url = lines[0];
    const durationStr = lines[1] ?? '0:00';
    if (!url?.startsWith('http')) return null;
    const parts = durationStr.split(':').map(Number);
    let durationMs = 0;
    if (parts.length === 3) durationMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    else if (parts.length === 2) durationMs = (parts[0] * 60 + parts[1]) * 1000;
    else durationMs = parts[0] * 1000;
    const mimeType = url.includes('mime=audio%2Fwebm') || url.includes('mime=audio/webm')
      ? 'audio/webm; codecs="opus"' : 'audio/mp4';
    if (await checkUrlAccessible(url)) return { url, mimeType, itag: 251, bitrate: 160000, durationMs };
    return null;
  } catch { return null; }
}

export function clearStreamCache(videoId: string): void {
  streamCache.delete(videoId);
  streamInflight.delete(videoId);
}

export async function getStreamUrl(videoId: string, title?: string, artist?: string): Promise<StreamInfo | null> {
  const cached = streamCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const existing = streamInflight.get(videoId);
  if (existing) return existing;

  const promise = (async (): Promise<StreamInfo | null> => {
    try {
      let result = await getStreamViaDlp(videoId);
      // If direct fetch fails and we have metadata, try a YouTube search fallback
      if (!result && title) result = await trySearchFallback(title, artist ?? '');
      if (result) streamCache.set(videoId, { result, expiresAt: Date.now() + STREAM_TTL_MS });
      return result;
    } catch {
      return null;
    } finally {
      streamInflight.delete(videoId);
    }
  })();

  streamInflight.set(videoId, promise);
  return promise;
}

export interface QueueTrack {
  videoId: string;
  title: string;
  artist: string;
}

export async function getNextQueue(videoId: string, playlistId?: string): Promise<QueueTrack[]> {
  const body: Record<string, unknown> = { videoId, isAudioOnly: true };
  if (playlistId) body.playlistId = playlistId;

  const res = await webRequest('next', body);
  const items: QueueTrack[] = [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: any[] = res?.contents?.singleColumnMusicWatchNextResultsRenderer
      ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.musicQueueRenderer?.content
      ?.playlistPanelRenderer?.contents ?? [];

    for (const item of contents) {
      const r = item?.playlistPanelVideoRenderer;
      if (!r?.videoId) continue;
      items.push({
        videoId: r.videoId,
        title: r.title?.runs?.[0]?.text ?? '',
        artist: r.longBylineText?.runs?.[0]?.text ?? '',
      });
    }
  } catch { /* parse error */ }
  return items;
}

export interface HomePlaylist {
  browseId: string;
  params: string;
  title: string;
  subtitle: string;
  thumbnail?: string;
}

export interface FeedItem {
  type: 'song' | 'playlist' | 'album';
  title: string;
  subtitle: string;
  thumbnail?: string;
  videoId?: string;
  playlistId?: string;
  browseId?: string;
  browseParams?: string;
}

export interface FeedSection {
  title: string;
  items: FeedItem[];
}

async function getLastPlayedItems(): Promise<FeedItem[]> {
  const token = await getValidToken();
  if (!token) return [];
  const headers = { Authorization: `Bearer ${token}`, 'X-Goog-AuthUser': '0', 'Content-Type': 'application/json' };
  const items: FeedItem[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await httpPost(TV_URL, { context: TV_CONTEXT, browseId: 'FEmusic_last_played' }, headers);
    const tabs = res?.contents?.tvBrowseRenderer?.content
      ?.tvSecondaryNavRenderer?.sections?.[0]
      ?.tvSecondaryNavSectionRenderer?.tabs ?? [];
    const grid = tabs[0]?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items ?? [];
    for (const item of grid) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tile = (item as any)?.tileRenderer;
      if (!tile) continue;
      const contentType: string = tile.contentType ?? '';
      if (contentType === 'TILE_CONTENT_TYPE_CHANNEL') continue;
      const title: string = tile?.metadata?.tileMetadataRenderer?.title?.runs?.[0]?.text ?? '';
      if (!title) continue;
      const cmd = tile.onSelectCommand ?? {};
      const videoId: string = cmd.watchEndpoint?.videoId ?? '';
      const playlistId: string = cmd.watchEndpoint?.playlistId ?? '';
      const browseId: string = cmd.browseEndpoint?.browseId ?? '';
      const browseParams: string = cmd.browseEndpoint?.params ?? '';
      // Thumbnail: for songs use ytimg, for playlists use API URL from tile header
      const thumbs = tile?.header?.tileHeaderRenderer?.thumbnail?.thumbnails ?? [];
      const thumbnail: string = (thumbs[0]?.url ?? '').split('?')[0]; // strip query params
      if (contentType === 'TILE_CONTENT_TYPE_VIDEO' && videoId) {
        items.push({ type: 'song', title, subtitle: '', thumbnail: thumbnail || undefined, videoId, playlistId });
      } else if (browseId) {
        items.push({ type: 'playlist', title, subtitle: '', thumbnail: thumbnail || undefined, browseId, browseParams });
      }
    }
  } catch { /* parse error */ }
  return items;
}

async function getHomeFeedSections(): Promise<FeedSection[]> {
  const res = await webRequest('browse', { browseId: 'FEmusic_home' });
  const sections: FeedSection[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawSections: any[] = res?.contents?.singleColumnBrowseResultsRenderer
      ?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
    for (const section of rawSections) {
      const shelf = section?.musicCarouselShelfRenderer ?? section?.musicImmersiveCarouselShelfRenderer;
      if (!shelf?.contents) continue;
      const header = shelf.header?.musicCarouselShelfBasicHeaderRenderer ?? shelf.header?.musicCarouselShelfHeaderRenderer;
      const sectionTitle: string = header?.title?.runs?.[0]?.text ?? '';
      const feedItems: FeedItem[] = [];
      for (const item of shelf.contents) {
        const r = item?.musicTwoRowItemRenderer ?? item?.musicResponsiveListItemRenderer;
        if (!r) continue;
        const title: string = r.title?.runs?.[0]?.text ?? '';
        if (!title) continue;
        const subtitleRuns = r.subtitle?.runs ?? [];
        const subtitle: string = subtitleRuns.map((x: { text?: string }) => x.text ?? '').join('');
        const ep = r.navigationEndpoint;
        const browseId: string = ep?.browseEndpoint?.browseId ?? '';
        const browseParams: string = ep?.browseEndpoint?.params ?? '';
        const videoId: string = ep?.watchEndpoint?.videoId ?? '';
        const playlistId: string = ep?.watchPlaylistEndpoint?.playlistId ?? ep?.watchEndpoint?.playlistId ?? '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const thumbList = (r as any)?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? (r as any)?.thumbnail?.musicThumbnail?.thumbnail?.thumbnails ?? [];
        const thumbnail: string | undefined = thumbList[0]?.url?.split('?')[0] || undefined;
        if (videoId) {
          feedItems.push({ type: 'song', title, subtitle, thumbnail, videoId, playlistId });
        } else if (browseId) {
          feedItems.push({ type: 'playlist', title, subtitle, thumbnail, browseId, browseParams });
        }
      }
      if (feedItems.length) sections.push({ title: sectionTitle, items: feedItems });
    }
  } catch { /* parse error */ }
  return sections;
}

export async function getFeed(): Promise<FeedSection[]> {
  const [lastPlayed, userPlaylists, homeSections] = await Promise.all([
    getLastPlayedItems(),
    getUserPlaylists(),
    getHomeFeedSections(),
  ]);
  const sections: FeedSection[] = [];
  if (lastPlayed.length) {
    sections.push({ title: 'Ouvir de novo', items: lastPlayed });
  }
  if (userPlaylists.length) {
    sections.push({
      title: 'Suas playlists',
      items: userPlaylists.map(p => ({ type: 'playlist' as const, title: p.title, subtitle: p.subtitle, thumbnail: p.thumbnail, browseId: p.browseId, browseParams: p.params })),
    });
  }
  sections.push(...homeSections);
  return sections;
}

// Retorna as playlists/álbuns da home anônima
export async function getHomeFeed(): Promise<HomePlaylist[]> {
  const res = await webRequest('browse', { browseId: 'FEmusic_home' });

  const playlists: HomePlaylist[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sections: any[] = res?.contents?.singleColumnBrowseResultsRenderer
      ?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

    for (const section of sections) {
      const shelf = section?.musicCarouselShelfRenderer;
      if (!shelf?.contents) continue;
      for (const item of shelf.contents) {
        const r = item?.musicTwoRowItemRenderer;
        if (!r) continue;
        const ep = r.navigationEndpoint?.browseEndpoint;
        if (ep?.browseId) {
          playlists.push({
            browseId: ep.browseId,
            params: ep.params ?? '',
            title: r.title?.runs?.[0]?.text ?? '',
            subtitle: r.subtitle?.runs?.[0]?.text ?? '',
          });
        }
      }
    }
  } catch { /* parse error */ }
  return playlists;
}

export interface PlaylistTrack {
  videoId: string;
  title: string;
  artist: string;
  durationMs?: number;
}

// "3:45" ou "1:03:45" → ms
function parseDurationText(text: string): number {
  const parts = text.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return 0;
}

// Carrega as músicas de uma playlist pelo browseId
// Retorna as playlists do usuário via Innertube (cliente TVHTML5 + Bearer token).
// O browseId "FEmusic_liked_playlists" retorna um gridRenderer com tileRenderer
// items, cada um com title em metadata.tileMetadataRenderer e browseId em
// onSelectCommand.browseEndpoint. Os browseIds (VLxxx) funcionam com getPlaylistTracks().
export async function getUserPlaylists(): Promise<HomePlaylist[]> {
  const token = await getValidToken();
  if (!token) return [];

  const body = {
    context: {
      client: {
        clientName: 'TVHTML5',
        clientVersion: '7.20240101.18.00',
        hl: 'pt-BR',
        gl: 'BR',
        utcOffsetMinutes: -180,
      },
    },
    browseId: 'FEmusic_liked_playlists',
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Goog-AuthUser': '0',
    'Content-Type': 'application/json',
  };

  const playlists: HomePlaylist[] = [];
  try {
    const url = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await httpPost(url, body, headers);

    // Navigate: contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections[0]
    //   .tvSecondaryNavSectionRenderer.tabs[1 = "Playlists"]
    //   .tabRenderer.content.tvSurfaceContentRenderer.content.gridRenderer.items[]
    //   .tileRenderer
    const tabs = res?.contents?.tvBrowseRenderer?.content
      ?.tvSecondaryNavRenderer?.sections?.[0]
      ?.tvSecondaryNavSectionRenderer?.tabs ?? [];

    // Find the "Playlists" tab (has browseId FEmusic_liked_playlists)
    let gridItems: unknown[] = [];
    for (const tab of tabs) {
      const tr = tab?.tabRenderer;
      const bid = tr?.endpoint?.browseEndpoint?.browseId ?? '';
      if (bid === 'FEmusic_liked_playlists') {
        gridItems = tr?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items ?? [];
        break;
      }
    }

    for (const item of gridItems) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tile = (item as any)?.tileRenderer;
      if (!tile) continue;
      const title: string =
        tile?.metadata?.tileMetadataRenderer?.title?.runs?.[0]?.text ?? '';
      const browseId: string =
        tile?.onSelectCommand?.browseEndpoint?.browseId ?? '';
      const subtitle: string =
        tile?.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.[0]
          ?.lineItemRenderer?.text?.runs?.[0]?.text ?? '';
      const thumbs = tile?.header?.tileHeaderRenderer?.thumbnail?.thumbnails ?? [];
      const thumbnail: string | undefined = thumbs[0]?.url?.split('?')[0] || undefined;
      if (browseId && title) {
        playlists.push({ browseId, params: '', title, subtitle, thumbnail });
      }
    }
  } catch { /* parse error */ }

  return playlists;
}

const TV_CONTEXT = { client: { clientName: 'TVHTML5', clientVersion: '7.20240101.18.00', hl: 'pt-BR', gl: 'BR', utcOffsetMinutes: -180 } };
const TV_URL = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTVTiles(items: any[]): PlaylistTrack[] {
  const tracks: PlaylistTrack[] = [];
  for (const item of items) {
    const tile = item?.tileRenderer;
    if (!tile) continue;
    const meta = tile?.metadata?.tileMetadataRenderer;
    const title: string = meta?.title?.simpleText ?? meta?.title?.runs?.[0]?.text ?? '';
    const videoId: string = tile?.onSelectCommand?.watchEndpoint?.videoId ?? '';
    const artist: string =
      meta?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text?.runs?.[0]?.text ?? '';
    // Duração: segundo item na linha 0 ou linha 1
    const durText: string =
      meta?.lines?.[0]?.lineRenderer?.items?.[1]?.lineItemRenderer?.text?.runs?.[0]?.text
      ?? meta?.lines?.[1]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text?.runs?.[0]?.text
      ?? '';
    const durationMs = parseDurationText(durText);
    if (videoId && title) tracks.push({ videoId, title, artist, durationMs: durationMs || undefined });
  }
  return tracks;
}

// Loads tracks for user playlists (VLxxx browseIds) via TVHTML5 + Bearer auth,
// following continuation tokens to fetch all pages (API returns 15 per page).
async function getUserPlaylistTracksTV(browseId: string): Promise<PlaylistTrack[]> {
  const token = await getValidToken();
  if (!token) return [];
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'X-Goog-AuthUser': '0' };
  const tracks: PlaylistTrack[] = [];

  try {
    // First page
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await httpPost(TV_URL, { context: TV_CONTEXT, browseId }, headers);
    const pvl = res?.contents?.tvBrowseRenderer?.content
      ?.tvSurfaceContentRenderer?.content
      ?.twoColumnRenderer?.rightColumn?.playlistVideoListRenderer;
    if (!pvl) return tracks;

    tracks.push(...parseTVTiles(pvl.contents ?? []));

    // Follow continuation pages
    let contToken: string | undefined =
      pvl.continuations?.[0]?.nextContinuationData?.continuation;

    while (contToken) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page: any = await httpPost(TV_URL, { context: TV_CONTEXT, continuation: contToken }, headers);
      const pvlCont = page?.continuationContents?.playlistVideoListContinuation;
      if (!pvlCont) break;
      tracks.push(...parseTVTiles(pvlCont.contents ?? []));
      contToken = pvlCont.continuations?.[0]?.nextContinuationData?.continuation;
    }
  } catch { /* parse error */ }

  return tracks;
}

export async function getPlaylistTracks(browseId: string, params?: string): Promise<PlaylistTrack[]> {
  // User playlists (VL prefix) use TVHTML5 + Bearer auth — WEB_REMIX rejects the token.
  if (browseId.startsWith('VL')) return getUserPlaylistTracksTV(browseId);

  const body: Record<string, unknown> = { browseId };
  if (params) body.params = params;
  const res = await webRequest('browse', body);

  const tracks: PlaylistTrack[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondary: any[] = res?.contents?.twoColumnBrowseResultsRenderer
      ?.secondaryContents?.sectionListRenderer?.contents ?? [];

    for (const section of secondary) {
      const shelf = section?.musicPlaylistShelfRenderer ?? section?.musicShelfRenderer;
      if (!shelf?.contents) continue;
      for (const item of shelf.contents) {
        const r = item?.musicResponsiveListItemRenderer;
        if (!r) continue;
        const videoId: string | undefined = r.flexColumns?.[0]
          ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
          ?.navigationEndpoint?.watchEndpoint?.videoId;
        const title: string = r.flexColumns?.[0]
          ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
        const artist: string = r.flexColumns?.[1]
          ?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
        const durText: string = r.fixedColumns?.[0]
          ?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text ?? '';
        const durationMs = parseDurationText(durText);
        if (videoId) tracks.push({ videoId, title, artist, durationMs: durationMs || undefined });
      }
    }
  } catch { /* parse error */ }
  return tracks;
}

// ── Ações do usuário ──────────────────────────────────────────────

export async function likeVideo(videoId: string): Promise<void> {
  const token = await getValidToken();
  await webRequest('like/like', { target: { videoId } }, token);
}

export async function unlikeVideo(videoId: string): Promise<void> {
  const token = await getValidToken();
  await webRequest('like/removelike', { target: { videoId } }, token);
}

export async function addVideoToPlaylist(videoId: string, playlistBrowseId: string): Promise<void> {
  const token = await getValidToken();
  // browseId pode vir como "VLPLxxx" (TV) ou "PLxxx" (web); o endpoint precisa do "PLxxx"
  const playlistId = playlistBrowseId.startsWith('VL') ? playlistBrowseId.slice(2) : playlistBrowseId;
  await webRequest('browse/edit_playlist', {
    playlistId,
    actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }],
  }, token);
}
