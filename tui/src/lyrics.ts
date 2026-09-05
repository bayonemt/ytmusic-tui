export interface LyricSyllable {
  startMs: number;
  endMs: number;
  text: string;
}

export interface LyricWord {
  startMs: number;
  endMs: number;
  text: string;
  syllables?: LyricSyllable[]; // presente quando TTML tem spans consecutivos (sílabas)
}

export interface LyricLine {
  timeMs: number;
  endMs: number;
  text: string;
  words: LyricWord[];
}

function parseTtmlTime(t: string): number {
  t = t.trim();
  if (t.endsWith('s')) return Math.round(parseFloat(t) * 1000);
  const parts = t.split(':');
  if (parts.length === 2) return Math.round((parseInt(parts[0], 10) * 60 + parseFloat(parts[1])) * 1000);
  if (parts.length === 3) return Math.round((parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2])) * 1000);
  return Math.round(parseFloat(t) * 1000);
}

// Tokeniza o body de um <p> em spans temporais e espaços entre eles.
// Spans consecutivos SEM espaço entre si são sílabas da mesma palavra.
function parseTtmlBody(body: string): LyricWord[] {
  // Token: span com timing, ou texto entre spans
  const tokRe = /(<span\b[^>]*\bbegin="([^"]+)"[^>]*\bend="([^"]+)"[^>]*>)([\s\S]*?)<\/span>|([^<]+)/g;
  type RawSpan = { startMs: number; endMs: number; text: string };
  type Token = { kind: 'span'; span: RawSpan; rawEnd: number } | { kind: 'gap' };

  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  tokRe.lastIndex = 0;
  while ((m = tokRe.exec(body)) !== null) {
    if (m[1]) {
      const text = m[4].replace(/<[^>]+>/g, '').trim();
      if (text) tokens.push({ kind: 'span', span: { startMs: parseTtmlTime(m[2]), endMs: parseTtmlTime(m[3]), text }, rawEnd: m.index + m[0].length });
    } else if (m[5] && /\S/.test(m[5])) {
      // texto com conteúdo real entre spans = separador de palavra
      tokens.push({ kind: 'gap' });
    }
  }

  // Agrupa spans consecutivos (sem gap entre si) em palavras com sílabas
  const words: LyricWord[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.kind === 'gap') { i++; continue; }

    const sylTokens: RawSpan[] = [tok.span];
    let j = i + 1;
    // Inclui spans seguintes que NÃO foram separados por gap
    while (j < tokens.length && tokens[j].kind === 'span') {
      sylTokens.push((tokens[j] as { kind: 'span'; span: RawSpan; rawEnd: number }).span);
      j++;
    }
    i = j;

    if (sylTokens.length === 1) {
      words.push({ startMs: sylTokens[0].startMs, endMs: sylTokens[0].endMs, text: sylTokens[0].text });
    } else {
      // múltiplos spans consecutivos = sílabas de uma palavra
      const text = sylTokens.map(s => s.text).join('');
      const syllables: LyricSyllable[] = sylTokens.map((s, idx) => ({
        startMs: s.startMs,
        endMs: idx < sylTokens.length - 1 ? sylTokens[idx + 1].startMs : s.endMs,
        text: s.text,
      }));
      words.push({ startMs: sylTokens[0].startMs, endMs: sylTokens[sylTokens.length - 1].endMs, text, syllables });
    }
  }
  return words;
}

export function parseTtml(ttml: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const pRe = /<p\b[^>]*\bbegin="([^"]+)"[^>]*\bend="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g;

  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(ttml)) !== null) {
    const lineStart = parseTtmlTime(pm[1]);
    const lineEnd   = parseTtmlTime(pm[2]);
    const body      = pm[3];

    const words = parseTtmlBody(body);
    const plainText = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!plainText) continue;
    lines.push({ timeMs: lineStart, endMs: lineEnd, text: plainText, words });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function parseLrcTime(mm: string, ss: string): number {
  return Math.round((parseInt(mm, 10) * 60 + parseFloat(ss)) * 1000);
}

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const lineRe = /^\[(\d+):(\d+\.\d+)\]\s*(.*)$/;
  const wordRe = /<(\d+):(\d+\.\d+)>([^<]*)/g;

  for (const raw of lrc.split('\n')) {
    const m = lineRe.exec(raw.trim());
    if (!m) continue;
    const timeMs = parseLrcTime(m[1], m[2]);
    const content = m[3];

    const words: LyricWord[] = [];
    wordRe.lastIndex = 0;
    let wm: RegExpExecArray | null;
    while ((wm = wordRe.exec(content)) !== null) {
      const text = wm[3].trim();
      if (text) words.push({ startMs: parseLrcTime(wm[1], wm[2]), endMs: 0, text });
    }
    for (let i = 0; i < words.length - 1; i++) words[i].endMs = words[i + 1].startMs;

    const plainText = content.replace(/<[^>]+>/g, '').trim();
    if (!plainText && words.length === 0) continue;
    lines.push({ timeMs, endMs: 0, text: plainText || words.map(w => w.text).join(' '), words });
  }

  for (let i = 0; i < lines.length - 1; i++) lines[i].endMs = lines[i + 1].timeMs;
  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    last.endMs = last.timeMs + 8000;
    if (last.words.length > 0) last.words[last.words.length - 1].endMs = last.endMs;
  }

  return lines;
}

async function safeFetch(url: string, opts?: RequestInit & { signal?: AbortSignal }): Promise<Response | null> {
  try {
    return await fetch(url, opts);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    return null;
  }
}

// ── Beautiful Lyrics Reborn (yeahnangua) ─────────────────────────
// Backend: https://lyrics.txw.qzz.io (Cloudflare Worker)
// Syllable-level: QQ Music QRC + Apple Music via Paxsenix + Kugou + Deezer
// Line-level: múltiplos providers (Apple, Deezer, LRCLIB, YouTube…)
// Não exige auth real — token dummy funciona quando title+artist são passados.

const BLR_BASE = 'https://lyrics.txw.qzz.io';
const BLR_DUMMY_ID = '0000000000000000000000';

function parseBLRSyllable(content: any[]): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const entry of content) {
    if (entry.Type !== 'Vocal') continue;
    const lead = entry.Lead;
    if (!Array.isArray(lead?.Syllables) || lead.Syllables.length === 0) continue;

    const words: LyricWord[] = [];
    let group: any[] = [];

    const flushGroup = () => {
      if (group.length === 0) return;
      const text = group.map((s: any) => s.Text).join('');
      const startMs = Math.round(group[0].StartTime * 1000);
      const endMs   = Math.round(group[group.length - 1].EndTime * 1000);
      if (group.length === 1) {
        words.push({ startMs, endMs, text });
      } else {
        const syls: LyricSyllable[] = group.map((s: any, i: number) => ({
          startMs: Math.round(s.StartTime * 1000),
          endMs: i < group.length - 1 ? Math.round(group[i + 1].StartTime * 1000) : Math.round(s.EndTime * 1000),
          text: s.Text,
        }));
        words.push({ startMs, endMs, text, syllables: syls });
      }
      group = [];
    };

    for (const syl of lead.Syllables) {
      group.push(syl);
      if (!syl.IsPartOfWord) flushGroup(); // false = última sílaba da palavra
    }
    flushGroup(); // trailing syllables (raro)

    if (words.length === 0) continue;
    lines.push({
      timeMs: Math.round(lead.StartTime * 1000),
      endMs:  Math.round(lead.EndTime * 1000),
      text: words.map(w => w.text).join(' '),
      words,
    });
  }
  return lines;
}

function parseBLRLine(content: any[]): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const entry of content) {
    if (entry.Type !== 'Vocal') continue;
    const text = (entry.Text ?? '').trim();
    if (!text) continue;
    lines.push({
      timeMs: Math.round(entry.StartTime * 1000),
      endMs:  Math.round(entry.EndTime * 1000),
      text,
      words: [],
    });
  }
  return lines;
}

async function fetchBeautifulLyrics(
  title: string, artist: string, durationSec: number, signal?: AbortSignal,
): Promise<LyricLine[] | null> {
  try {
    const url = new URL(`${BLR_BASE}/lyrics/${BLR_DUMMY_ID}`);
    url.searchParams.set('track_name', title);
    url.searchParams.append('artist_name', artist);
    if (durationSec > 0) url.searchParams.set('duration', String(durationSec));

    const r = await safeFetch(url.toString(), {
      signal,
      headers: { Authorization: 'Bearer x' },
    });
    if (!r?.ok) return null;
    const text = await r.text();
    if (!text.trim()) return null;

    const data = JSON.parse(text) as any;
    if (data.Type === 'Syllable') {
      const lines = parseBLRSyllable(data.Content ?? []);
      if (lines.length > 0) return lines;
    }
    if (data.Type === 'Line') {
      const lines = parseBLRLine(data.Content ?? []);
      if (lines.length > 0) return lines;
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
  }
  return null;
}

// ── Paxsenix / Lyrically API ─────────────────────────────────────
// Proxy Apple Music via lyrics.paxsenix.org (formato v=2, word-level).
// Fluxo: iTunes Search API (gratuita) → Apple Music track ID → Paxsenix v=2.
// part:true = continuação fonética da palavra anterior (forma sílabas).
const PAXSENIX_BASE = 'https://lyrics.paxsenix.org';

function parsePaxsenixV2(data: any): LyricLine[] {
  const raw: any[] = data.lyrics ?? [];
  return raw
    .filter(entry => !entry.background && Array.isArray(entry.text) && entry.text.length > 0)
    .map(entry => {
      // Agrupa tokens: part=true é sílaba da palavra anterior
      const words: LyricWord[] = [];
      let group: any[] = [];

      const flushGroup = () => {
        if (group.length === 0) return;
        const startMs = group[0].timestamp as number;
        const endMs   = group[group.length - 1].endtime as number;
        const text    = group.map((w: any) => w.text).join('');
        if (!text.trim()) { group = []; return; }
        if (group.length === 1) {
          words.push({ startMs, endMs, text });
        } else {
          const syllables: LyricSyllable[] = group.map((w: any, i: number) => ({
            startMs: w.timestamp as number,
            endMs: i < group.length - 1 ? (group[i + 1].timestamp as number) : (w.endtime as number),
            text: w.text,
          }));
          words.push({ startMs, endMs, text, syllables });
        }
        group = [];
      };

      for (const w of entry.text as any[]) {
        if (w.part && group.length > 0) {
          group.push(w);
        } else {
          flushGroup();
          group = [w];
        }
      }
      flushGroup();

      const lineText = (entry.text as any[]).map((w: any) => w.text).join(' ').trim();
      return { timeMs: entry.timestamp as number, endMs: entry.endtime as number, text: lineText, words };
    })
    .filter(l => l.text);
}

async function fetchPaxsenix(
  title: string, artist: string, durationSec: number, signal?: AbortSignal,
): Promise<LyricLine[] | null> {
  try {
    // 1. Descobre Apple Music ID via iTunes Search (gratuita, sem auth)
    const q = encodeURIComponent(`${title} ${artist}`);
    const sr = await safeFetch(
      `https://itunes.apple.com/search?term=${q}&entity=song&limit=8&media=music`,
      { signal },
    );
    if (!sr?.ok) return null;
    const sd = await sr.json() as { results?: any[] };
    const results = sd.results ?? [];

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const nt = norm(title);
    const na = norm(artist);
    let bestId: number | null = null;
    let bestScore = -1;

    for (const r of results) {
      const rt = norm(r.trackName ?? '');
      const ra = norm(r.artistName ?? '');
      let score = 0;
      if (rt === nt) score += 4;
      else if (rt.includes(nt) || nt.includes(rt)) score += 2;
      if (ra === na) score += 3;
      else if (ra.includes(na) || na.includes(ra)) score += 1;
      if (durationSec > 0 && r.trackTimeMillis) {
        const diff = Math.abs(r.trackTimeMillis / 1000 - durationSec);
        if (diff < 5) score += 2;
        else if (diff < 15) score += 1;
      }
      if (score > bestScore) { bestScore = score; bestId = r.trackId; }
    }
    if (!bestId || bestScore < 2) return null;

    // 2. Busca lyrics no Paxsenix com formato v=2 (word-level JSON)
    const lr = await safeFetch(
      `${PAXSENIX_BASE}/apple-music/lyrics?id=${bestId}&v=2`,
      { signal },
    );
    if (!lr?.ok) return null;
    const data = await lr.json() as any;
    if (!data.lyrics) return null;
    const lines = parsePaxsenixV2(data);
    return lines.length > 0 ? lines : null;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    return null;
  }
}

// ── LyricsPlus API (ibratabian17) ────────────────────────────────
// Agrega Apple Music (syllable), Musixmatch-word e lyricsplus community.
// Mirrors testados em cascata: prjktla.my.id → binimum.org → atomix.one
const LP_MIRRORS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.atomix.one',
];
const LP_SOURCES = 'apple,lyricsplus,musixmatch,musixmatch-word';

interface LPSyl { time: number; duration: number; text: string; }
interface LPLine { time: number; duration: number; text: string; syllabus?: LPSyl[]; isBackground?: boolean; }

function parseLyricsPlus(data: any): LyricLine[] {
  const raw: LPLine[] = data?.lyrics;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  return raw
    .filter(entry => entry.text?.trim() && !entry.isBackground)
    .map(entry => {
      const lineStartMs = entry.time;
      const lineEndMs   = entry.time + entry.duration;
      const syllabi     = entry.syllabus ?? [];
      const words: LyricWord[] = [];

      let i = 0;
      while (i < syllabi.length) {
        const group: LPSyl[] = [];
        // Agrupa sílabas até encontrar uma que termina com espaço (fim da palavra)
        while (i < syllabi.length) {
          group.push(syllabi[i]);
          const isWordEnd = syllabi[i].text.endsWith(' ') || i === syllabi.length - 1;
          i++;
          if (isWordEnd) break;
        }
        if (group.length === 0) continue;

        const wordStart  = group[0].time;
        const lastSyl    = group[group.length - 1];
        const wordEnd    = lastSyl.time + lastSyl.duration;
        const wordText   = group.map(s => s.text).join('').trimEnd();
        if (!wordText) continue;

        if (group.length === 1) {
          words.push({ startMs: wordStart, endMs: wordEnd, text: wordText });
        } else {
          const syllables: LyricSyllable[] = group.map((s, idx) => ({
            startMs: s.time,
            endMs:   idx < group.length - 1 ? group[idx + 1].time : s.time + s.duration,
            text:    s.text,
          }));
          words.push({ startMs: wordStart, endMs: wordEnd, text: wordText, syllables });
        }
      }

      return { timeMs: lineStartMs, endMs: lineEndMs, text: entry.text.trim(), words };
    });
}

async function fetchLyricsPlus(
  title: string, artist: string, durationSec: number, signal?: AbortSignal,
): Promise<LyricLine[] | null> {
  const params = new URLSearchParams({
    title, artist, source: LP_SOURCES,
    ...(durationSec > 0 ? { duration: String(Math.round(durationSec)) } : {}),
  });
  for (const base of LP_MIRRORS) {
    try {
      const r = await safeFetch(`${base}/v2/lyrics/get?${params}`, { signal });
      if (!r?.ok) continue;
      const data = await r.json() as any;
      const lines = parseLyricsPlus(data);
      if (lines.length > 0) return lines;
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
    }
  }
  return null;
}

// ── Musixmatch RichSync ──────────────────────────────────────────
const MXM_BASE = 'https://apic-desktop.musixmatch.com/ws/1.1';
const MXM_APP  = 'web-desktop-app-v1.0';

// Token auto-gerenciado: busca um novo token se não houver um válido.
// Override via MUSIXMATCH_TOKEN no env (para token com richsync/word-level).
// Trial tokens (auto-fetch) têm subtitle (line-level) mas NÃO richsync (word-level).
let _mxmToken: string | null = process.env.MUSIXMATCH_TOKEN ?? null;
let _mxmTokenFetching: Promise<string | null> | null = null;

async function getMxmToken(): Promise<string | null> {
  if (_mxmToken) return _mxmToken;
  if (_mxmTokenFetching) return _mxmTokenFetching;
  _mxmTokenFetching = (async () => {
    try {
      const r = await fetch('https://apic.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!r.ok) return null;
      const d = await r.json() as any;
      const tok: string | undefined = d?.message?.body?.user_token;
      if (tok) { _mxmToken = tok; }
      return _mxmToken;
    } catch { return null; }
    finally { _mxmTokenFetching = null; }
  })();
  return _mxmTokenFetching;
}

interface MxmWord { c: string; o: number; }
interface MxmLine { ts: number; te: number; x: string; l: MxmWord[]; }

function parseMxmRichSync(body: string): LyricLine[] {
  let raw: MxmLine[];
  try { raw = JSON.parse(body); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.map(entry => {
    const lineStartMs = Math.round(entry.ts * 1000);
    const lineEndMs   = Math.round(entry.te * 1000);
    const words: LyricWord[] = (entry.l ?? []).map((w, i, arr) => {
      const startMs = Math.round((entry.ts + w.o) * 1000);
      const endMs   = i < arr.length - 1
        ? Math.round((entry.ts + arr[i + 1].o) * 1000)
        : lineEndMs;
      return { startMs, endMs, text: w.c };
    }).filter(w => w.text.trim());
    return { timeMs: lineStartMs, endMs: lineEndMs, text: entry.x ?? '', words };
  }).filter(l => l.text.trim());
}

async function fetchMusixmatch(title: string, artist: string, signal?: AbortSignal): Promise<LyricLine[] | null> {
  try {
    const token = await getMxmToken();
    if (!token) return null;

    // macro.subtitles.get: uma única requisição retorna richsync (word) + subtitle (line) como fallback
    const url = `${MXM_BASE}/macro.subtitles.get?` + new URLSearchParams({
      format: 'json', namespace: 'lyrics_richsynched', subtitle_format: 'mxm',
      app_id: MXM_APP, q_track: title, q_artist: artist, usertoken: token,
    });
    const r = await safeFetch(url, { signal });
    // Token expirado: descarta para forçar refresh na próxima chamada
    if (r?.status === 401) { _mxmToken = null; return null; }
    if (!r?.ok) return null;
    const data = await r.json() as any;
    const macro = data?.message?.body?.macro_calls;
    if (!macro) return null;

    // Tenta richsync (word-level) primeiro
    const richBody: string | undefined =
      macro['track.richsync.get']?.message?.body?.richsync?.richsync_body;
    if (richBody) {
      const lines = parseMxmRichSync(richBody);
      if (lines.length > 0) return lines;
    }

    // Fallback: subtitle (line-level) em formato LRC
    const subList: any[] =
      macro['track.subtitles.get']?.message?.body?.subtitle_list ?? [];
    const subBody: string | undefined = subList[0]?.subtitle?.subtitle_body;
    if (subBody) {
      const lines = parseLrc(subBody);
      if (lines.length > 0) return lines;
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
  }
  return null;
}

export async function fetchLyrics(
  title: string,
  artist: string,
  durationSec: number,
  signal?: AbortSignal,
): Promise<LyricLine[] | null> {
  // 1. BetterLyrics — syllable-level Apple Music TTML (cache-only, sem auth)
  const betterUrl = `https://lyrics-api.boidu.dev/getLyrics?s=${encodeURIComponent(title)}&a=${encodeURIComponent(artist)}`
    + (durationSec > 0 ? `&d=${Math.round(durationSec)}` : '');
  const r1 = await safeFetch(betterUrl, { signal });
  if (r1?.ok) {
    const data = await r1.json() as { ttml?: string };
    if (data?.ttml) {
      const lines = parseTtml(data.ttml);
      if (lines.length > 0) return lines;
    }
  }

  // 2. Paxsenix — word-level Apple Music via iTunes Search + cache Paxsenix
  const pax = await fetchPaxsenix(title, artist, durationSec, signal);
  if (pax && pax.length > 0) return pax;

  // 3. Beautiful Lyrics Reborn — syllable (QQ Music, Apple, Deezer) + line
  const blr = await fetchBeautifulLyrics(title, artist, durationSec, signal);
  if (blr && blr.length > 0) return blr;

  // 4. LyricsPlus — syllable (Apple Music) + word (Musixmatch), ampla cobertura
  const lp = await fetchLyricsPlus(title, artist, durationSec, signal);
  if (lp && lp.length > 0) return lp;

  // 5. Musixmatch — subtitle line-level via trial token
  const mxm = await fetchMusixmatch(title, artist, signal);
  if (mxm && mxm.length > 0) return mxm;

  // 6. LRCLib /api/get (match exato por título + artista + duração)
  if (artist && durationSec > 0) {
    const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}&duration=${Math.round(durationSec)}`;
    const r2 = await safeFetch(getUrl, { signal });
    if (r2?.ok) {
      const data = await r2.json() as { syncedLyrics?: string };
      if (data?.syncedLyrics) {
        const lines = parseLrc(data.syncedLyrics);
        if (lines.length > 0) return lines;
      }
    }
  }

  // 7. LRCLib /api/search — ordena por correspondência de artista para evitar
  //    pegar uma música homônima em outra língua
  const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}${artist ? `&artist_name=${encodeURIComponent(artist)}` : ''}`;
  const r3 = await safeFetch(searchUrl, { signal });
  if (r3?.ok) {
    const raw = await r3.json() as Array<{ syncedLyrics?: string; duration?: number; artistName?: string }>;
    const results = Array.isArray(raw) ? raw : [];

    // Pontua cada resultado: artista bate (+2), duração bate (+1)
    const artistNorm = (s: string) => s.toLowerCase().replace(/[^\w]/g, ' ').trim();
    const scored = results.map(item => {
      let score = 0;
      if (artist && item.artistName) {
        const ra = artistNorm(item.artistName);
        const ea = artistNorm(artist);
        if (ra.includes(ea) || ea.includes(ra)) score += 2;
        else {
          const wa = ea.split(' ').filter(w => w.length > 2);
          const wb = ra.split(' ').filter(w => w.length > 2);
          score += wa.filter(w => wb.includes(w)).length;
        }
      }
      if (durationSec > 0 && item.duration && Math.abs(item.duration - durationSec) <= 10) score += 1;
      return { item, score };
    });
    scored.sort((a, b) => b.score - a.score);

    for (const { item } of scored.slice(0, 6)) {
      if (!item?.syncedLyrics) continue;
      if (durationSec > 0 && item.duration && Math.abs(item.duration - durationSec) > 20) continue;
      const lines = parseLrc(item.syncedLyrics);
      if (lines.length > 0) return lines;
    }
  }

  return null;
}
