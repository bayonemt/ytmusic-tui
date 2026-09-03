import { execFile } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';

const LOG = '/tmp/hifi-debug.log';
function log(...args: unknown[]) {
  const line = new Date().toISOString() + ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n';
  fs.appendFileSync(LOG, line);
}

export interface HifiResult {
  url: string;
  source: 'qobuz' | 'arcod' | 'tidal' | 'jiosaavn' | 'soundcloud';
  quality: string;
}

// ── Helpers de matching ────────────────────────────────────────────

function norm(s: string) {
  return s.toLowerCase()
    .replace(/[''`´]/g, "'")
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesMatch(found: string, expected: string): boolean {
  const nf = norm(found), ne = norm(expected);
  if (nf === ne) return true;
  // Títulos curtos (≤6 chars): exige match exato (evita "Giz" matchando "Organized")
  if (ne.length <= 6) return nf === ne;
  // Títulos longos: maioria das palavras significativas bate
  const words = ne.split(' ').filter(w => w.length > 2);
  if (words.length === 0) return nf === ne;
  const hits = words.filter(w => nf.split(' ').includes(w)).length;
  return hits / words.length >= 0.7;
}

function artistsMatch(foundArtists: string[], expected: string): boolean {
  if (!expected || foundArtists.length === 0) return true;
  const ne = norm(expected);
  return foundArtists.some(a => {
    const na = norm(a);
    return na === ne || na.includes(ne) || ne.includes(na);
  });
}

// ±5s quando artista desconhecido (evita falsos positivos com título curto), ±20s quando artista confirmado
function durationsMatch(foundSec: number, expectedMs: number, strict = false): boolean {
  if (!expectedMs || !foundSec) return true;
  return Math.abs(foundSec - expectedMs / 1000) <= (strict ? 5 : 20);
}

// ── Qobuz via kanjijewels proxy (reverse-engineered do APK LastWave) ─
// Backend URL + API key extraídos via deobfuscação XOR do APK v3.4.1
// Override: QOBUZ_BACKEND_URL / QOBUZ_API_KEY no ambiente
const KJ_BASE = (process.env.QOBUZ_BACKEND_URL ?? 'https://qobuz.kanjijewels.com').replace(/\/$/, '');
const KJ_KEY  = process.env.QOBUZ_API_KEY ?? 'lw_sec_e83b4c91a02d7e5f39641b8a5d2c70e9f1a34b82650d9c1e';
const KJ_HDR  = { 'X-API-Key': KJ_KEY };

async function qobuzStream(
  title: string, artist: string, durationMs: number, signal: AbortSignal,
): Promise<HifiResult | null> {
  const q = encodeURIComponent(`${title} ${artist}`);
  const r1 = await fetch(`${KJ_BASE}/api/search?q=${q}&type=track&limit=15`, { signal, headers: KJ_HDR });
  if (!r1.ok) return null;
  const data = await r1.json() as any;
  const items: any[] = data?.results?.tracks?.items ?? [];
  if (!items.length) return null;

  const strict = !artist;
  const match = items.find(t => {
    const perf: string = t.performer?.name ?? t.performers?.split(',')?.[0] ?? '';
    return titlesMatch(t.title ?? '', title)
      && artistsMatch([perf], artist)
      && durationsMatch(t.duration ?? 0, durationMs, strict);
  });
  if (!match) return null;

  // Seleciona melhor qualidade disponível: 192kHz → 96kHz → CD
  let quality: number;
  if (match.hires_streamable && match.maximum_bit_depth >= 24) {
    quality = match.maximum_sampling_rate >= 192 ? 27 : 7;
  } else {
    quality = 6;
  }

  const r2 = await fetch(`${KJ_BASE}/api/stream/${match.id}?quality=${quality}`,
    { signal, headers: KJ_HDR, redirect: 'manual' });
  const url = r2.headers.get('location') ?? (r2.ok ? `${KJ_BASE}/api/stream/${match.id}?quality=${quality}` : null);
  if (!url) return null;

  const labels: Record<number, string> = { 27: 'FLAC 24-bit 192kHz', 7: 'FLAC 24-bit 96kHz', 6: 'FLAC 16-bit 44.1kHz' };
  return { url, source: 'qobuz', quality: labels[quality] ?? 'FLAC' };
}

// ── Qobuz via arcod.xyz (sem auth, 24-bit FLAC) ───────────────────
async function arcodStream(
  title: string, artist: string, durationMs: number, signal: AbortSignal,
): Promise<HifiResult | null> {
  const q = encodeURIComponent(`${title} ${artist}`);
  const r1 = await fetch(`https://arcod.xyz/api/search?q=${q}&type=tracks`, { signal });
  if (!r1.ok) return null;
  const data = await r1.json() as any;
  const items: any[] = data?.data?.tracks?.items ?? [];
  if (!items.length) return null;

  const strict = !artist;
  const match = items.find(t => {
    const perf: string = t.performer?.name ?? '';
    return titlesMatch(t.title ?? '', title)
      && artistsMatch([perf], artist)
      && durationsMatch(t.duration ?? 0, durationMs, strict);
  });

  if (!match) return null;

  const quality = (match.hires_streamable && match.maximum_bit_depth >= 24) ? 7 : 6;
  const r2 = await fetch(
    `https://arcod.xyz/api/player/stream/${match.id}?quality=${quality}&country=BR`,
    { signal },
  );
  if (!r2.ok) return null;
  const relayData = await r2.json() as any;
  const url = relayData?.url;
  if (!url) return null;

  const label = quality === 7
    ? `FLAC ${match.maximum_bit_depth}-bit ${match.maximum_sampling_rate}kHz`
    : 'FLAC 16-bit 44.1kHz';
  return { url, source: 'arcod', quality: label };
}

// ── Tidal via rhythmax worker ──────────────────────────────────────
const RHYTHMAX_BASE = 'https://hifi.rhythmax.workers.dev';

async function tidalStream(
  title: string, artist: string, durationMs: number, signal: AbortSignal,
): Promise<HifiResult | null> {
  const q = encodeURIComponent(`${title} ${artist}`);
  const r1 = await fetch(`${RHYTHMAX_BASE}/tracks?q=${q}`, { signal });
  if (!r1.ok) return null;
  const tracks = await r1.json() as any;
  const items: any[] = tracks?.items ?? [];

  const strict = !artist;
  log(`tidal search "${title}" "${artist}" dur=${durationMs}ms, got ${items.length} results (strict=${strict})`);
  items.slice(0, 5).forEach(t => {
    const foundArtists: string[] = (t.artists ?? [t.artist]).map((a: any) => a?.name ?? '').filter(Boolean);
    log(` candidate: "${t.title}" by [${foundArtists}] dur=${t.duration}s titleOk=${titlesMatch(t.title ?? '', title)} artistOk=${artistsMatch(foundArtists, artist)} durOk=${durationsMatch(t.duration ?? 0, durationMs, strict)}`);
  });

  const match = items.find(t => {
    const foundArtists: string[] = (t.artists ?? [t.artist]).map((a: any) => a?.name ?? '').filter(Boolean);
    return titlesMatch(t.title ?? '', title)
      && artistsMatch(foundArtists, artist)
      && durationsMatch(t.duration ?? 0, durationMs, strict);
  });

  if (!match) { log('tidal: no match found'); return null; }
  log(`tidal: matched "${match.title}" id=${match.id}`);

  // Tenta Hi-Res primeiro, cai em Lossless se não tiver
  const tags: string[] = match.mediaMetadata?.tags ?? [];
  const qualities = tags.includes('HIRES_LOSSLESS')
    ? ['HI_RES_LOSSLESS', 'LOSSLESS']
    : ['LOSSLESS'];

  for (const quality of qualities) {
    if (signal.aborted) return null;
    const r2 = await fetch(
      `${RHYTHMAX_BASE}/manifests?id=${match.id}&quality=${quality}`,
      { signal },
    );
    if (!r2.ok) continue;
    const manifest = await r2.json() as any;
    // Verificar que é FULL (não preview)
    const presentation: string = manifest?.data?.attributes?.trackPresentation ?? '';
    if (presentation && presentation !== 'FULL') {
      log(`tidal: manifest trackPresentation=${presentation}, skipping`);
      continue;
    }
    const url = manifest?.data?.attributes?.uri;
    if (!url) continue;
    const label = quality === 'HI_RES_LOSSLESS' ? 'FLAC Hi-Res 24-bit' : 'FLAC 44.1kHz';
    log(`tidal: returning ${label} url=${url.slice(0, 60)}`);
    return { url, source: 'tidal', quality: label };
  }
  return null;
}

// ── JioSaavn (API pública + DES-ECB local) ─────────────────────────
function decryptJioSaavnUrl(enc: string): string {
  try {
    const key = Buffer.from('38346591');
    const d = crypto.createDecipheriv('des-ecb', key, Buffer.alloc(0));
    d.setAutoPadding(true);
    const raw = Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf-8');
    return raw.replace(/_\d+\.mp4/, '_320.mp4');
  } catch { return ''; }
}

async function jiosaavnStream(
  title: string, artist: string, durationMs: number, signal: AbortSignal,
): Promise<HifiResult | null> {
  const q = encodeURIComponent(`${title} ${artist}`);
  const res = await fetch(
    `https://www.jiosaavn.com/api.php?__call=search.getResults&q=${q}&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=10`,
    { signal, headers: { 'User-Agent': 'Mozilla/5.0' } },
  );
  if (!res.ok) return null;
  const data = await res.json() as any;
  const results: any[] = data?.results ?? [];

  const strict = !artist;
  const match = results.find(t => {
    const tDurSec = parseInt(t.more_info?.duration ?? '0', 10);
    const singers: string = t.more_info?.singers ?? t.more_info?.artistMap?.primary_artists?.[0]?.name ?? '';
    return titlesMatch(t.title ?? '', title)
      && artistsMatch([singers], artist)
      && durationsMatch(tDurSec, durationMs, strict);
  });

  if (!match) return null;
  const enc = match?.more_info?.encrypted_media_url;
  if (!enc) return null;
  const url = decryptJioSaavnUrl(enc);
  if (!url) return null;
  return { url, source: 'jiosaavn', quality: 'MP3 320kbps' };
}

// ── SoundCloud via yt-dlp (com verificação de duração) ─────────────
async function soundcloudStream(
  title: string, artist: string, durationMs: number, signal: AbortSignal,
): Promise<HifiResult | null> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    // --dump-json para verificar duração antes de aceitar
    const proc = execFile('yt-dlp', [
      '--dump-json', '-f', 'bestaudio',
      `scsearch3:${title} ${artist}`,
    ], { timeout: 25000 }, (err, stdout) => {
      if (err || !stdout.trim()) { resolve(null); return; }
      // yt-dlp pode retornar múltiplas linhas (uma por resultado)
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        try {
          const info = JSON.parse(line);
          if (!durationsMatch(info.duration ?? 0, durationMs, !artist)) continue;
          if (!titlesMatch(info.title ?? '', title)) continue;
          const url = info.url ?? info.requested_formats?.[0]?.url;
          if (url) { resolve({ url, source: 'soundcloud', quality: '256kbps' }); return; }
        } catch { /* linha inválida */ }
      }
      resolve(null);
    });
    signal.addEventListener('abort', () => { try { proc.kill(); } catch { /* ok */ } resolve(null); });
  });
}

// ── Cascata principal ──────────────────────────────────────────────
export async function findBestStream(
  title: string,
  artist: string,
  durationMs: number,
  signal: AbortSignal,
  onFound: (r: HifiResult) => void,
): Promise<void> {
  const sources: Array<() => Promise<HifiResult | null>> = [
    () => qobuzStream(title, artist, durationMs, signal),
    () => arcodStream(title, artist, durationMs, signal),
    () => tidalStream(title, artist, durationMs, signal),
    () => jiosaavnStream(title, artist, durationMs, signal),
    () => soundcloudStream(title, artist, durationMs, signal),
  ];
  for (const src of sources) {
    if (signal.aborted) return;
    try {
      const result = await src();
      if (result) { onFound(result); return; }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }
}
