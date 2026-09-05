import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  search, getStreamUrl, clearStreamCache, getNextQueue, getFeed, getPlaylistTracks,
  getUserPlaylists, likeVideo, addVideoToPlaylist, startDeviceFlow, pollDeviceFlow, isAuthenticated,
  getArtistPage,
  type SearchResult, type SongSearchResult, type ArtistSearchResult, type ArtistPage,
  type HomePlaylist, type PlaylistTrack, type FeedItem, type FeedSection,
} from './innertube.js';
import { AudioPlayer, type PlayerStatus } from './player.js';
import { findBestStream, type HifiResult } from './hifi.js';
import { fetchLyrics, type LyricLine, type LyricWord } from './lyrics.js';
import { renderArt, prefetchArt, supportsNativeImages, injectKittyId } from './art.js';

type NavTab = 'home' | 'search' | 'playlists' | 'queue' | 'lyrics' | 'settings' | 'auth';

// ── Configuração persistente ────────────────────────────────────────
interface LyricsConfig {
  contextLines:     number;  // linhas acima e abaixo da atual (1–10)
  bigCurrentLine:   boolean; // adiciona margem ao redor da linha ativa
  dimAdjacentLines: boolean; // escurece também as linhas ±1 (não só ±2)
  letterSpacing:    boolean; // espaço entre letras na linha ativa (visual maior)
  lyricsLang:       string;  // idioma preferido: 'auto'|'en'|'pt'|'es'|'ja'|'ko'|'zh'
}
interface AppConfig { lyrics: LyricsConfig; }

const CONFIG_PATH = path.join(os.homedir(), '.yt-music-config.json');
const DEFAULT_CONFIG: AppConfig = {
  lyrics: { contextLines: 3, bigCurrentLine: false, dimAdjacentLines: false, letterSpacing: false, lyricsLang: 'auto' },
};

const LANG_OPTIONS = ['auto', 'en', 'pt', 'es', 'ja', 'ko', 'zh'];

function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      lyrics: {
        contextLines:     Math.max(1, Math.min(10, raw?.lyrics?.contextLines ?? 3)),
        bigCurrentLine:   raw?.lyrics?.bigCurrentLine   ?? false,
        dimAdjacentLines: raw?.lyrics?.dimAdjacentLines ?? false,
        letterSpacing:    raw?.lyrics?.letterSpacing    ?? false,
        lyricsLang:       LANG_OPTIONS.includes(raw?.lyrics?.lyricsLang) ? raw.lyrics.lyricsLang : 'auto',
      },
    };
  } catch { return DEFAULT_CONFIG; }
}
function saveConfig(cfg: AppConfig) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch { /* ok */ }
}

interface QueueItem {
  videoId: string;
  title: string;
  artist: string;
  durationMs?: number;
}

const player = new AudioPlayer();

// ── Kitty stdout interceptor ────────────────────────────────────
// Ink's \x1b[J erases the kitty graphics plane on every redraw.
// We patch process.stdout.write once: after any write containing an erase
// sequence, we immediately write the kitty image back — same synchronous
// block, zero visible gap, zero flicker.
type KittyRestoreState = {
  imageData: string;
  directRowFromBottom?: number;
  directRow?: number;
  directColFromRight?: number;
  directCol?: number;
};
let _kittyState: KittyRestoreState | null = null;
let _inKittyRestore = false;

if (!(process.stdout as any).__origWrite) {
  (process.stdout as any).__origWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = function (chunk: any, ...args: any[]): boolean {
    const result = (process.stdout as any).__origWrite(chunk, ...args);
    if (!_inKittyRestore && _kittyState && typeof chunk === 'string' && /\x1b\[\d*J/.test(chunk)) {
      const s = _kittyState;
      const row = s.directRowFromBottom != null
        ? process.stdout.rows - s.directRowFromBottom
        : s.directRow;
      const col = s.directColFromRight != null
        ? process.stdout.columns - s.directColFromRight
        : s.directCol;
      if (row != null && col != null) {
        _inKittyRestore = true;
        (process.stdout as any).__origWrite(`\x1b7\x1b[${row};${col}H${s.imageData}\x1b8`);
        _inKittyRestore = false;
      }
    }
    return result;
  };
}

function origWrite(data: string): void {
  ((process.stdout as any).__origWrite ?? process.stdout.write.bind(process.stdout))(data);
}

// ── Lyrics Quality Cache (contexto global) ──────────────────────

type LyricsQuality = 'syllable' | 'word' | 'line' | 'none';

const _lqCache = new Map<string, LyricsQuality>();
const _lqFetching = new Set<string>();
let _lqVersion = 0;
const _lqListeners = new Set<() => void>();

function _lqNotify() { _lqVersion++; _lqListeners.forEach(fn => fn()); }

function useLyricsQuality(videoId: string | undefined): LyricsQuality | undefined {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick(n => n + 1);
    _lqListeners.add(fn);
    return () => { _lqListeners.delete(fn); };
  }, []);
  return videoId ? _lqCache.get(videoId) : undefined;
}

async function prefetchLyricsQuality(
  items: Array<{ videoId: string; title: string; artist: string; durationSec?: number }>
): Promise<void> {
  const todo = items.filter(it => it.videoId && !_lqCache.has(it.videoId) && !_lqFetching.has(it.videoId));
  if (todo.length === 0) return;
  await Promise.all(todo.map(async it => {
    _lqFetching.add(it.videoId);
    try {
      const l = await fetchLyrics(it.title, it.artist, it.durationSec ?? 0);
      const q: LyricsQuality = l === null ? 'none'
        : l.some(ln => ln.words.some(w => w.syllables && w.syllables.length > 1)) ? 'syllable'
        : l.some(ln => ln.words.length > 0) ? 'word'
        : 'line';
      _lqCache.set(it.videoId, q);
    } catch { /* ok */ }
    _lqFetching.delete(it.videoId);
    _lqNotify();
  }));
}

function LyricsTag({ videoId }: { videoId: string | undefined }) {
  const q = useLyricsQuality(videoId);
  if (q === 'syllable') return <Text color="cyan"> ≋</Text>;
  if (q === 'word')     return <Text color="blue"> ≈</Text>;
  if (q === 'line')     return <Text color="white" dimColor> ♩</Text>;
  return null;
}

// ── Downloads ──────────────────────────────────────────────────

type DownloadPhase = 'searching' | 'downloading' | 'embedding' | 'done' | 'error';
type DownloadInfo = {
  title: string;
  phase: DownloadPhase;
  quality?: string;
  filename?: string;
  doneAt?: number; // timestamp para auto-remover após 5s
};

function dlIcon(phase: DownloadPhase): string {
  if (phase === 'done')  return '✓';
  if (phase === 'error') return '✗';
  return '↓';
}

function dlLabel(phase: DownloadPhase): string {
  if (phase === 'searching')  return 'buscando qualidade...';
  if (phase === 'downloading') return 'baixando...';
  if (phase === 'embedding')  return 'adicionando capa...';
  if (phase === 'done')       return 'concluído';
  return 'erro';
}

function dlColor(phase: DownloadPhase): string {
  if (phase === 'done')  return 'green';
  if (phase === 'error') return 'red';
  return 'cyan';
}

function DownloadsBar({ downloads }: { downloads: Map<string, DownloadInfo> }) {
  if (downloads.size === 0) return null;
  const entries = [...downloads.entries()];
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {entries.map(([videoId, dl]) => (
        <Box key={videoId} flexDirection="row" gap={1}>
          <Text color={dlColor(dl.phase)}>{dlIcon(dl.phase)}</Text>
          <Text color="white" bold>{dl.title.slice(0, 40)}</Text>
          {dl.quality && <Text color="cyan"> [{dl.quality}]</Text>}
          <Text color="gray" dimColor> {dlLabel(dl.phase)}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Utilitários ────────────────────────────────────────────────

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function progressBar(pos: number, dur: number, w: number): string {
  const pct = dur > 0 ? Math.min(pos / dur, 1) : 0;
  const filled = Math.round(pct * w);
  return '─'.repeat(Math.max(0, filled - 1)) + (filled > 0 ? '●' : '') + '─'.repeat(w - filled);
}

function volBar(vol: number): string {
  const filled = Math.round(vol / 100 * 8);
  return '█'.repeat(filled) + '░'.repeat(8 - filled);
}

// ── Capa do Álbum (chafa) ───────────────────────────────────────

// directRow/directCol: when set, write the kitty/sixel sequence directly to
// stdout (bypassing Ink's text layout, which truncates escape sequences).
// Ink still reserves the Box space in layout; the image overwrites those cells.
// When not set (search screen), fall back to symbol art via Ink Text nodes.
function AlbumArt({
  videoId, width, height, directRow, directRowFromBottom, directCol, directColFromRight, thumbnailUrl, kittyId,
}: {
  videoId: string; width: number; height: number;
  directRow?: number;
  directRowFromBottom?: number; // computed as stdout.rows - N at write-time
  directCol?: number;
  directColFromRight?: number;  // computed as stdout.columns - N at write-time
  thumbnailUrl?: string;
  kittyId?: number; // when set, selective per-image deletion instead of delete-all
}) {
  const [entry, setEntry] = useState<{ lines: string[]; single: string } | null>(null);
  const [, forceRedraw] = useState(0);
  const lastKey = useRef('');

  // Load art on video change
  useEffect(() => {
    const key = `${videoId}:${width}x${height}`;
    if (!videoId || key === lastKey.current) return;
    lastKey.current = key;
    setEntry(null);
    renderArt(videoId, width, height, thumbnailUrl).then(e => {
      if (e.lines.length > 0 || e.single) setEntry(e);
    }).catch(() => {});
  }, [videoId, width, height]);

  // Resize: force re-render so Ink writes new layout, triggering the interceptor.
  useEffect(() => {
    const onResize = () => forceRedraw(n => n + 1);
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);

  // Register with the stdout interceptor and do initial image display.
  // useEffect runs AFTER Ink writes to stdout, so the initial write here
  // appears after Ink's erase — correct timing for the first frame.
  // All subsequent Ink writes (1s status updates, etc.) are handled by the
  // interceptor with zero gap: image is appended in the same write call.
  useEffect(() => {
    const hasDirectRow = directRow != null || directRowFromBottom != null;
    if (!entry?.single || !supportsNativeImages || !hasDirectRow) {
      _kittyState = null;
      return;
    }

    const imageData = kittyId != null ? injectKittyId(entry.single, kittyId) : entry.single;
    _kittyState = { imageData, directRowFromBottom, directRow, directColFromRight, directCol };

    // Initial write: display image right now (runs after Ink's commit for this render)
    const row = directRowFromBottom != null
      ? process.stdout.rows - directRowFromBottom
      : directRow!;
    const col = directColFromRight != null
      ? process.stdout.columns - directColFromRight
      : directCol;
    if (col != null) {
      _inKittyRestore = true;
      origWrite(`\x1b7\x1b[${row};${col}H${imageData}\x1b8`);
      _inKittyRestore = false;
    }

    return () => {
      _kittyState = null;
      if (!supportsNativeImages) return;
      if (kittyId != null) origWrite(`\x1b_Ga=d,i=${kittyId}\x1b\\`);
      else origWrite('\x1b_Ga=d\x1b\\');
    };
  }, [entry, kittyId, directRow, directRowFromBottom, directCol, directColFromRight]);

  if (!entry) return null;

  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0}>
      {(!supportsNativeImages || (directRow == null && directRowFromBottom == null && directColFromRight == null)) &&
        entry.lines.map((line, i) => <Text key={i}>{line}</Text>)
      }
    </Box>
  );
}

// ── Barra de Navegação (Topo) ───────────────────────────────────

function TopBar({ tab }: { tab: NavTab }) {
  return (
    <Box borderStyle="single" paddingX={1} borderColor="red">
      <Text color="red" bold>▶</Text>
      <Text bold color="white"> YouTube Music  </Text>
      <Text color={tab === 'home'      ? 'red' : 'white'} bold={tab === 'home'}      dimColor={tab !== 'home'}>  Início[h]  </Text>
      <Text color={tab === 'search'    ? 'red' : 'white'} bold={tab === 'search'}    dimColor={tab !== 'search'}>  Buscar[/]  </Text>
      <Text color={tab === 'playlists' ? 'red' : 'white'} bold={tab === 'playlists'} dimColor={tab !== 'playlists'}>  Playlists[p]  </Text>
      <Text color={tab === 'queue'     ? 'red' : 'white'} bold={tab === 'queue'}     dimColor={tab !== 'queue'}>  Fila[l]  </Text>
      <Text color={tab === 'lyrics'    ? 'red' : 'white'} bold={tab === 'lyrics'}    dimColor={tab !== 'lyrics'}>  Letras[L]  </Text>
      <Text color={tab === 'settings'  ? 'red' : 'white'} bold={tab === 'settings'}  dimColor={tab !== 'settings'}>  Config[s]  </Text>
      <Text color={tab === 'auth'      ? 'red' : 'white'} bold={tab === 'auth'}      dimColor={tab !== 'auth'}>  Login[a]  </Text>
      <Text color="white" dimColor>   q=sair</Text>
    </Box>
  );
}

// ── Player Bar (Rodapé) ─────────────────────────────────────────

function PlayerBar({ status, hifiQuality }: { status: PlayerStatus; hifiQuality?: string | null }) {
  const icon = status.state === 'playing' ? '▶' : status.state === 'paused' ? '⏸' : '♫';
  const barW = 24;
  const isActive = status.state !== 'idle';

  // Art row computed fresh at write-time: process.stdout.rows - 7.
  // Requires the root App Box to have minHeight=process.stdout.rows so the
  // layout fills the terminal and PlayerBar is truly at the bottom.

  return (
    <Box borderStyle="single" borderColor="white" paddingX={1} flexDirection="row" gap={1}>
      {isActive && (
        <AlbumArt videoId={status.videoId} width={14} height={7}
                  directRowFromBottom={7} directCol={3} kittyId={1} />
      )}

      {/* Esquerda: info da música */}
      <Box width={28} flexDirection="column" justifyContent="center">
        <Box>
          <Text color="red" bold>{icon} </Text>
          {isActive
            ? <Text bold wrap="truncate">{status.title}</Text>
            : <Text color="white">Nenhuma música tocando</Text>
          }
        </Box>
        {isActive && <Text color="white"> {status.artist}</Text>}
        {isActive && (
          <Box flexDirection="row" gap={1}>
            {hifiQuality && <Text color="cyan">{hifiQuality}</Text>}
            <LyricsTag videoId={status.videoId} />
            {!hifiQuality && <Text color="white">←→=seek</Text>}
          </Box>
        )}
      </Box>

      {/* Centro: controles + barra de progresso */}
      <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
        <Box>
          <Text color="white"> ◀  </Text>
          <Text color="red" bold>{icon} </Text>
          <Text color="white"> ▶ </Text>
        </Box>
        <Box>
          <Text color="white">{fmtTime(status.position)} </Text>
          <Text color="red">{progressBar(status.position, status.duration, barW)}</Text>
          <Text color="white"> {fmtTime(status.duration)}</Text>
        </Box>
      </Box>

      {/* Direita: volume */}
      <Box width={20} flexDirection="column" alignItems="flex-end" justifyContent="center">
        <Text color="white">Espaço=pause  n=próx</Text>
        <Text color="white">Ctrl+←→=pular faixa</Text>
        <Box>
          <Text color="white">🔊 </Text>
          <Text color="red">{volBar(status.volume)}</Text>
          <Text color="white"> {status.volume}%</Text>
        </Box>
      </Box>
    </Box>
  );
}

// ── Tela: Home ──────────────────────────────────────────────────

const FEED_VISIBLE_ITEMS = 5;

type MenuPhase = 'main' | 'playlists';
const MENU_OPTIONS = [
  { id: 'like',     label: '[*] Curtir' },
  { id: 'download', label: '[v] Baixar  (~Downloads)' },
  { id: 'playlist', label: '[+] Adicionar a playlist' },
  { id: 'nointerest', label: '[x] Nao tenho interesse' },
];

function ContextMenu({
  item,
  onClose,
  onDownload,
}: {
  item: FeedItem;
  onClose: () => void;
  onDownload: (videoId: string, title: string) => void;
}) {
  const [phase, setPhase] = useState<MenuPhase>('main');
  const [cursor, setCursor] = useState(0);
  const [playlists, setPlaylists] = useState<HomePlaylist[] | null>(null);
  const [plCursor, setPlCursor] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Carrega playlists quando entra na fase de escolha
  useEffect(() => {
    if (phase !== 'playlists' || playlists !== null) return;
    getUserPlaylists().then(p => setPlaylists(p)).catch(() => setPlaylists([]));
  }, [phase, playlists]);

  useInput((input, key) => {
    const isCtrlO = (key.ctrl && input === 'o') || input === '\x0f';
    // Esc e Ctrl+O sempre fecham, mesmo durante operação em andamento
    if (key.escape || isCtrlO) { onClose(); return; }
    if (busy) return;

    if (phase === 'main') {
      if (key.upArrow) { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor(c => Math.min(MENU_OPTIONS.length - 1, c + 1)); return; }
      if (key.return) {
        const opt = MENU_OPTIONS[cursor];
        if (opt.id === 'like') {
          if (!item.videoId) { setStatus('sem videoId para curtir'); return; }
          setBusy(true);
          setStatus('curtindo...');
          likeVideo(item.videoId)
            .then(() => setStatus('curtido!'))
            .catch(e => setStatus('erro: ' + String(e).slice(0, 60)))
            .finally(() => setBusy(false));
        } else if (opt.id === 'download') {
          if (!item.videoId) { setStatus('download so funciona para musicas'); return; }
          const outDir = path.join(os.homedir(), 'Downloads');
          const workerPath = new URL('./download-worker.ts', import.meta.url).pathname;
          const durMs = String(player.status.duration * 1000 || 0);
          // Usa artist do subtitle quando disponível; caso contrário, usa o artist do player
          // (comum ao baixar a música atualmente em reprodução a partir do feed)
          const artist = item.subtitle
            || (player.status.videoId === item.videoId ? player.status.artist : '')
            || '';
          // Tenta hifi (Tidal FLAC → JioSaavn 320 → SoundCloud) e cai no yt-dlp se falhar
          spawn('npx', [
            'tsx', workerPath,
            item.videoId, item.title, artist,
            durMs, outDir,
          ], { detached: true, stdio: 'ignore' }).unref();
          onDownload(item.videoId, item.title);
          setStatus('');
        } else if (opt.id === 'playlist') {
          if (!item.videoId) { setStatus('so e possivel adicionar musicas a playlists'); return; }
          setPhase('playlists');
          setStatus('');
        } else if (opt.id === 'nointerest') {
          setStatus('nao suportado: requer token de feedback da API');
        }
        return;
      }
    }

    if (phase === 'playlists') {
      if (key.escape) { setPhase('main'); setStatus(''); return; }
      if (playlists === null) return; // ainda carregando
      if (key.upArrow) { setPlCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setPlCursor(c => Math.min((playlists.length || 1) - 1, c + 1)); return; }
      if (key.return) {
        const pl = playlists[plCursor];
        if (!pl || !item.videoId) return;
        setBusy(true);
        setStatus(`adicionando a "${pl.title}"...`);
        addVideoToPlaylist(item.videoId, pl.browseId)
          .then(() => { setStatus(`adicionado a "${pl.title}"!`); setPhase('main'); })
          .catch(e => { setStatus('erro: ' + String(e).slice(0, 60)); setPhase('main'); })
          .finally(() => setBusy(false));
      }
    }
  });

  const typeIcon = item.type === 'song' ? '[m]' : item.type === 'album' ? '[a]' : '[p]';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold color="cyan">{typeIcon} {item.title}</Text>
      {item.subtitle ? <Text color="gray" dimColor>{item.subtitle}</Text> : null}

      {phase === 'main' && (
        <Box flexDirection="column" marginTop={1}>
          {MENU_OPTIONS.map((opt, i) => (
            <Text key={opt.id} color={i === cursor ? 'cyan' : 'white'}>
              {i === cursor ? '> ' : '  '}{opt.label}
            </Text>
          ))}
        </Box>
      )}

      {phase === 'playlists' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">Escolha a playlist:</Text>
          {playlists === null && <Text color="gray">carregando...</Text>}
          {playlists !== null && playlists.length === 0 && <Text color="gray">nenhuma playlist encontrada</Text>}
          {playlists !== null && playlists.map((pl, i) => (
            <Text key={pl.browseId} color={i === plCursor ? 'cyan' : 'white'}>
              {i === plCursor ? '> ' : '  '}{pl.title}
            </Text>
          ))}
        </Box>
      )}

      {status ? <Text color={status.startsWith('erro') ? 'red' : 'green'} bold>{status}</Text> : null}

      <Text color="gray" dimColor>
        {phase === 'main'
          ? '  Esc = fechar   Ctrl+O = fechar   Enter = selecionar'
          : '  Esc = voltar   Enter = adicionar'}
      </Text>
    </Box>
  );
}

function HomeScreen({
  sections, sectionIdx, itemIdx, loading, onSectionChange, onItemChange, onDownload,
}: {
  sections: FeedSection[];
  sectionIdx: number;
  itemIdx: number;
  loading: boolean;
  onSectionChange: (s: number) => void;
  onItemChange: (i: number) => void;
  onDownload: (videoId: string, title: string) => void;
}) {
  const [menuItem, setMenuItem] = useState<FeedItem | null>(null);

  // Pre-fetch lyrics quality para itens visíveis do feed
  useEffect(() => {
    const activeSection = sections[sectionIdx];
    if (!activeSection) return;
    const songItems = activeSection.items
      .filter(it => it.type === 'song' && it.videoId)
      .map(it => ({ videoId: it.videoId!, title: it.title, artist: it.subtitle }));
    if (songItems.length > 0) prefetchLyricsQuality(songItems);
  }, [sectionIdx, sections]);

  useInput((input, key) => {
    const isCtrlO = (key.ctrl && input === 'o') || input === '\x0f';
    // Ctrl+O abre/fecha o menu de contexto
    if (isCtrlO) {
      if (menuItem) { setMenuItem(null); return; }
      const sec = sections[sectionIdx];
      const item = sec?.items[itemIdx];
      if (item) setMenuItem(item);
      return;
    }
    if (menuItem) return; // menu aberto: input vai para ContextMenu

    if (sections.length === 0) return;
    const section = sections[sectionIdx];
    if (key.upArrow) {
      if (sectionIdx > 0) { onSectionChange(sectionIdx - 1); onItemChange(0); }
    }
    if (key.downArrow) {
      if (sectionIdx < sections.length - 1) { onSectionChange(sectionIdx + 1); onItemChange(0); }
    }
    if (key.leftArrow && section && itemIdx > 0) onItemChange(itemIdx - 1);
    if (key.rightArrow && section && itemIdx < section.items.length - 1) onItemChange(itemIdx + 1);
  });

  const VISIBLE = 5;
  const scrollStart = Math.max(0, Math.min(sectionIdx - Math.floor(VISIBLE / 2), Math.max(0, sections.length - VISIBLE)));
  const activeSection = sections[sectionIdx];
  const winStart = activeSection
    ? Math.max(0, Math.min(itemIdx - Math.floor(FEED_VISIBLE_ITEMS / 2), Math.max(0, activeSection.items.length - FEED_VISIBLE_ITEMS)))
    : 0;
  const visItems = activeSection ? activeSection.items.slice(winStart, winStart + FEED_VISIBLE_ITEMS) : [];

  const visible = sections.slice(scrollStart, scrollStart + VISIBLE);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Para você</Text>
        {loading && <Text color="red"> ● carregando...</Text>}
      </Box>

      {sections.length === 0 && !loading && (
        <Text color="gray" dimColor>Nenhum conteúdo encontrado.</Text>
      )}

      {visible.map((section, vi) => {
        const si = vi + scrollStart;
        const isActive = si === sectionIdx;

        return (
          <Box key={si} flexDirection="column" marginBottom={isActive ? 1 : 0}>
            <Text bold={isActive} color={isActive ? 'white' : 'gray'} wrap="truncate">
              {isActive ? '> ' : '  '}{section.title}
              {isActive && section.items.length > 1 && (
                <Text color="gray" dimColor>{'  '}{itemIdx + 1}/{section.items.length}</Text>
              )}
            </Text>

            {isActive ? (
              <>
                <Box flexDirection="column" paddingLeft={2}>
                  {visItems.map((item, ai) => {
                    const realIdx = winStart + ai;
                    const isSelected = realIdx === itemIdx;
                    const typeIcon = item.type === 'song' ? '♪' : item.type === 'album' ? '◉' : '≡';
                    return (
                      <Box key={`item-${ai}`} flexDirection="column">
                        <Box flexDirection="row">
                          <Text bold={isSelected} color={isSelected ? 'white' : 'gray'} wrap="truncate">
                            {isSelected ? '> ' : '  '}{typeIcon} {item.title}
                          </Text>
                          {item.type === 'song' && <LyricsTag videoId={item.videoId} />}
                        </Box>
                        {item.subtitle && isSelected ? (
                          <Text color="gray" dimColor wrap="truncate">{'    '}{item.subtitle}</Text>
                        ) : null}
                      </Box>
                    );
                  })}
                </Box>
                {(winStart > 0 || winStart + FEED_VISIBLE_ITEMS < section.items.length) && (
                  <Box paddingLeft={2}>
                    <Text color="gray" dimColor>
                      {winStart > 0 ? '< ' : '  '}
                      {winStart + FEED_VISIBLE_ITEMS < section.items.length ? ' >' : ''}
                    </Text>
                  </Box>
                )}
              </>
            ) : (
              <Box paddingLeft={3}>
                <Text color="gray" dimColor wrap="truncate">
                  {section.items.slice(0, 4).map(i => i.title).join('  .  ')}
                  {section.items.length > 4 ? ' ...' : ''}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}

      {menuItem && (
        <ContextMenu
          item={menuItem}
          onClose={() => setMenuItem(null)}
          onDownload={onDownload}
        />
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {menuItem
            ? '  Ctrl+O ou Esc = fechar menu'
            : '  arrows = navegar   Enter = tocar   Ctrl+O = opcoes   / = buscar'}
        </Text>
      </Box>
    </Box>
  );
}

// ── Tela: Buscar ────────────────────────────────────────────────

function SearchScreen({
  onSelect, onBack,
}: {
  onSelect: (item: SearchResult) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setResults([]);
    setCursor(0);
    try {
      const r = await search(q);
      setResults(r);
    } catch { setResults([]); }
    setLoading(false);
  }, []);

  // Handlers: Escape sempre volta, demais só após submissão (TextInput desmontado)
  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (!submitted) return;
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(results.length - 1, c + 1));
    if (key.return && results[cursor]) onSelect(results[cursor]);
  });

  // Pré-carrega arte e qualidade de letras das músicas visíveis
  useEffect(() => {
    if (!submitted) return;
    const visible = results.slice(Math.max(0, cursor - 2), cursor + 5);
    visible.forEach(r => { if (r.type === 'song') prefetchArt(r.videoId, 30, 14); });
    prefetchLyricsQuality(visible.filter((r): r is SongSearchResult => r.type === 'song').map(r => ({
      videoId: r.videoId, title: r.title, artist: r.artist,
    })));
  }, [cursor, results, submitted]);

  const selected = results[cursor];

  // Art position: TopBar(3) + "Buscar músicas"(1) + marginBottom(1) = row 6 (1-indexed ANSI).
  // directColFromRight=24 lets AlbumArt compute stdout.columns - 24 at write-time,
  // avoiding stale writes if stdout.columns wasn't ready on the first render.
  const artRow = 6;

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Buscar músicas</Text>
      </Box>

      {!submitted ? (
        <Box>
          <Text color="red" bold>🔍 </Text>
          <TextInput
            value={query}
            onChange={setQuery}
            onSubmit={(q) => { setSubmitted(true); doSearch(q); }}
            placeholder="Nome da música ou artista..."
          />
        </Box>
      ) : (
        <Box flexDirection="row" flexGrow={1} gap={2}>
          {/* Lista de resultados */}
          <Box flexDirection="column" flexGrow={1}>
            <Box marginBottom={1}>
              <Text color="gray" dimColor>Resultados para: </Text>
              <Text color="red" bold>"{query}"</Text>
              {loading && <Text color="red"> ● buscando...</Text>}
            </Box>

            {results.slice(0, 14).map((r, i) => {
              const isSel = i === cursor;
              if (r.type === 'artist') {
                return (
                  <Box key={`sr-${i}`}>
                    <Text color={isSel ? 'red' : 'white'} dimColor={!isSel}>{isSel ? '❯ ' : '  '}</Text>
                    <Text bold color={isSel ? 'magenta' : 'white'} dimColor={!isSel} wrap="truncate">{r.name}</Text>
                    <Text color="magenta" dimColor>  Artista</Text>
                  </Box>
                );
              }
              return (
                <Box key={`sr-${i}`}>
                  <Text color={isSel ? 'red' : 'white'} dimColor={!isSel}>{isSel ? '❯ ' : '  '}</Text>
                  <Text bold={isSel} color="white" wrap="truncate">{r.title}</Text>
                  <Text color="white" dimColor>  {r.artist}</Text>
                  {r.duration && <Text color="white" dimColor>  [{r.duration}]</Text>}
                  <LyricsTag videoId={r.videoId} />
                </Box>
              );
            })}

            {!loading && results.length === 0 && (
              <Text color="gray" dimColor>Nenhum resultado encontrado.</Text>
            )}

            <Box marginTop={1}>
              <Text color="gray" dimColor>↑↓ navegar   Enter = tocar   Esc = voltar</Text>
            </Box>
          </Box>

          {/* Painel direito: capa/thumbnail em destaque */}
          {selected && (
            <Box flexDirection="column" width={30} flexShrink={0}>
              {selected.type === 'song'
                ? <AlbumArt videoId={selected.videoId} width={30} height={14}
                             directRow={artRow} directColFromRight={30} />
                : null}
              <Box marginTop={1} flexDirection="column">
                {selected.type === 'song' ? (
                  <>
                    <Text bold color="white" wrap="truncate">{selected.title}</Text>
                    <Text color="white" dimColor wrap="truncate">{selected.artist}</Text>
                    {selected.duration && <Text color="red">{selected.duration}</Text>}
                  </>
                ) : (
                  <>
                    <Text bold color="magenta" wrap="truncate">{selected.name}</Text>
                    <Text color="white" dimColor>Artista</Text>
                    <Text color="gray" dimColor wrap="truncate">Enter para ver perfil</Text>
                  </>
                )}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Tela: Playlists ─────────────────────────────────────────────

function PlaylistsScreen({
  playlists, cursor, loading, authenticated, onCursorChange, onOpen,
}: {
  playlists: HomePlaylist[];
  cursor: number;
  loading: boolean;
  authenticated: boolean;
  onCursorChange: (c: number) => void;
  onOpen: (p: HomePlaylist) => void;
}) {
  useInput((_, key) => {
    if (key.upArrow) onCursorChange(Math.max(0, cursor - 1));
    if (key.downArrow) onCursorChange(Math.min(playlists.length - 1, cursor + 1));
    if (key.return && playlists[cursor]) onOpen(playlists[cursor]);
  }, { isActive: playlists.length > 0 || loading });

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Minhas Playlists</Text>
        {loading && <Text color="red"> ● carregando...</Text>}
      </Box>

      {!loading && !authenticated && (
        <Box flexDirection="column">
          <Text color="white" dimColor>Você não está logado no YouTube Music.</Text>
          <Text color="white" dimColor>Pressione <Text color="red" bold>[a]</Text><Text color="white" dimColor> para fazer login e ver suas playlists.</Text></Text>
          <Text color="white" dimColor>(Tocar músicas via busca funciona sem login.)</Text>
        </Box>
      )}

      {!loading && authenticated && playlists.length === 0 && (
        <Text color="white" dimColor>Nenhuma playlist encontrada na sua conta.</Text>
      )}

      {playlists.slice(0, 18).map((p, i) => {
        const selected = i === cursor;
        return (
          <Box key={`pl-${i}`}>
            <Text color={selected ? 'red' : 'white'} dimColor={!selected}>{selected ? '❯ ' : '  '}</Text>
            <Text bold={selected} color="white">{'♪ '}{p.title}</Text>
            {p.subtitle && <Text color="white" dimColor>{'  —  '}{p.subtitle}</Text>}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="white" dimColor>↑↓ navegar   Enter = abrir   / = buscar</Text>
      </Box>
    </Box>
  );
}

// ── Tela: Faixas da Playlist ────────────────────────────────────

function PlaylistTracksScreen({
  name, tracks, cursor, loading, onCursorChange, onSelect, onBack,
}: {
  name: string;
  tracks: PlaylistTrack[];
  cursor: number;
  loading: boolean;
  onCursorChange: (c: number) => void;
  onSelect: (idx: number) => void;
  onBack: () => void;
}) {
  useInput((input, key) => {
    if (key.escape || input === 'p') { onBack(); return; }
    if (key.upArrow) onCursorChange(Math.max(0, cursor - 1));
    if (key.downArrow) onCursorChange(Math.min(tracks.length - 1, cursor + 1));
    if (key.return && tracks[cursor]) onSelect(cursor);
  });

  // Pré-carrega tags de letras das faixas visíveis
  useEffect(() => {
    const visible = tracks.slice(Math.max(0, cursor - 2), cursor + 10);
    prefetchLyricsQuality(visible.map(t => ({
      videoId: t.videoId, title: t.title, artist: t.artist,
      durationSec: t.durationMs ? t.durationMs / 1000 : undefined,
    })));
  }, [cursor, tracks]);

  const pageSize = 18;
  const pageStart = Math.max(0, cursor - Math.floor(pageSize / 2));
  const visible = tracks.slice(pageStart, pageStart + pageSize);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text color="white" dimColor>← </Text>
        <Text bold color="white">{name}</Text>
        {loading && <Text color="red"> ● carregando...</Text>}
        {!loading && tracks.length > 0 && (
          <Text color="white" dimColor>  ({tracks.length} músicas)</Text>
        )}
      </Box>

      {!loading && tracks.length === 0 && (
        <Text color="white" dimColor>Playlist vazia ou sem músicas disponíveis.</Text>
      )}

      {visible.map((t, i) => {
        const absIdx = pageStart + i;
        const isSel = absIdx === cursor;
        return (
          <Box key={`tr-${absIdx}`} flexDirection="row">
            <Text color={isSel ? 'red' : 'white'} dimColor={!isSel}>{isSel ? '❯ ' : '  '}</Text>
            <Text bold={isSel} color="white" wrap="truncate">{t.title}</Text>
            {t.artist && <Text color="white" dimColor>{'  '}{t.artist}</Text>}
            <LyricsTag videoId={t.videoId} />
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="white" dimColor>↑↓ navegar   Enter = tocar a partir daqui   Esc = voltar</Text>
      </Box>
    </Box>
  );
}

// ── Tela: Artista ────────────────────────────────────────────────

type ArtistItem =
  | { kind: 'song'; videoId: string; title: string; artist: string; thumbnail: string }
  | { kind: 'release'; browseId: string; title: string; year?: string; section: 'album' | 'single' };

function ArtistScreen({
  page, loading, onSelectSong, onSelectRelease, onBack,
}: {
  page: ArtistPage | null;
  loading: boolean;
  onSelectSong: (videoId: string, title: string, artist: string) => void;
  onSelectRelease: (browseId: string) => void;
  onBack: () => void;
}) {
  const [cursor, setCursor] = useState(0);

  // Flat list of selectable items (songs + releases)
  const items: ArtistItem[] = useMemo(() => {
    if (!page) return [];
    const list: ArtistItem[] = [];
    for (const s of page.topSongs)
      list.push({ kind: 'song', videoId: s.videoId, title: s.title, artist: s.artist, thumbnail: s.thumbnail });
    for (const a of page.albums)
      list.push({ kind: 'release', browseId: a.browseId, title: a.title, year: a.year, section: 'album' });
    for (const s of page.singles)
      list.push({ kind: 'release', browseId: s.browseId, title: s.title, year: s.year, section: 'single' });
    return list;
  }, [page]);

  // Pré-busca qualidade de letras das top songs
  useEffect(() => {
    if (!page?.topSongs.length) return;
    prefetchLyricsQuality(page.topSongs.map(s => ({
      videoId: s.videoId, title: s.title, artist: s.artist,
    })));
  }, [page]);

  useInput((input, key) => {
    if (key.escape || input === 'h' || input === '/') { onBack(); return; }
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1));
    if (key.return) {
      const it = items[cursor];
      if (!it) return;
      if (it.kind === 'song') onSelectSong(it.videoId, it.title, it.artist);
      else onSelectRelease(it.browseId);
    }
  });

  if (loading) return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="red">● Carregando artista...</Text>
    </Box>
  );

  if (!page) return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="red">Artista não encontrado.</Text>
    </Box>
  );

  // Compute section boundaries for rendering headers
  const songCount = page.topSongs.length;
  const albumCount = page.albums.length;

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* Artist name */}
      <Box marginBottom={1}>
        <Text bold color="magenta">{page.name}</Text>
        {page.description && (
          <Text color="white" dimColor>  {page.description.slice(0, 60)}</Text>
        )}
      </Box>

      {/* Top songs */}
      {page.topSongs.length > 0 && (
        <Box marginBottom={1}>
          <Text bold color="white" dimColor>Top músicas</Text>
        </Box>
      )}
      {page.topSongs.map((s, i) => {
        const idx = i;
        const isSel = idx === cursor;
        return (
          <Box key={`song-${s.videoId}`}>
            <Text color={isSel ? 'red' : 'white'} dimColor={!isSel}>{isSel ? '❯ ' : '  '}</Text>
            <Text color="white" dimColor={!isSel} bold={isSel} wrap="truncate">{s.title}</Text>
            <Text color="white" dimColor>  {s.artist}</Text>
            <LyricsTag videoId={s.videoId} />
          </Box>
        );
      })}

      {/* Albums */}
      {page.albums.length > 0 && (
        <Box marginY={1}>
          <Text bold color="white" dimColor>Álbuns</Text>
        </Box>
      )}
      {page.albums.map((a, i) => {
        const idx = songCount + i;
        const isSel = idx === cursor;
        return (
          <Box key={`album-${a.browseId}`}>
            <Text color={isSel ? 'red' : 'white'} dimColor={!isSel}>{isSel ? '❯ ' : '  '}</Text>
            <Text color="white" dimColor={!isSel} bold={isSel} wrap="truncate">{a.title}</Text>
            {a.year && <Text color="white" dimColor>  {a.year}</Text>}
          </Box>
        );
      })}

      {/* Singles */}
      {page.singles.length > 0 && (
        <Box marginY={1}>
          <Text bold color="white" dimColor>Singles e EPs</Text>
        </Box>
      )}
      {page.singles.map((s, i) => {
        const idx = songCount + albumCount + i;
        const isSel = idx === cursor;
        return (
          <Box key={`single-${s.browseId}`}>
            <Text color={isSel ? 'red' : 'white'} dimColor={!isSel}>{isSel ? '❯ ' : '  '}</Text>
            <Text color="white" dimColor={!isSel} bold={isSel} wrap="truncate">{s.title}</Text>
            {s.year && <Text color="white" dimColor>  {s.year}</Text>}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="gray" dimColor>↑↓ navegar   Enter = tocar/abrir   Esc = voltar</Text>
      </Box>
    </Box>
  );
}

// ── Tela: Fila ──────────────────────────────────────────────────

function QueueScreen({
  queue, currentIdx, onSelect,
}: {
  queue: QueueItem[];
  currentIdx: number;
  onSelect: (idx: number) => void;
}) {
  const [cursor, setCursor] = useState(currentIdx);

  useInput((_, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(queue.length - 1, c + 1));
    if (key.return) onSelect(cursor);
  });

  // Pre-fetch lyrics quality para músicas visíveis ao redor do cursor
  useEffect(() => {
    const visible = queue.slice(Math.max(0, cursor - 2), cursor + 8);
    prefetchLyricsQuality(visible.map(it => ({
      videoId: it.videoId, title: it.title, artist: it.artist,
      durationSec: it.durationMs ? it.durationMs / 1000 : undefined,
    })));
  }, [cursor, queue]);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Fila de reprodução  </Text>
        <Text color="gray" dimColor>({queue.length} músicas)  </Text>
        <Text color="cyan" dimColor>≋ sílaba  </Text>
        <Text color="blue" dimColor>≈ palavra  </Text>
        <Text color="white" dimColor>♩ linha</Text>
      </Box>

      {queue.length === 0 && (
        <Text color="gray" dimColor>Fila vazia — busque uma música para começar.</Text>
      )}

      {queue.slice(0, 18).map((item, i) => {
        const isCurrent = i === currentIdx;
        const isHovered = i === cursor;
        return (
          <Box key={`qi-${i}`}>
            <Text color={isCurrent ? 'red' : isHovered ? 'white' : 'gray'}>
              {isCurrent ? '▶ ' : isHovered ? '❯ ' : '  '}
            </Text>
            <Text bold={isCurrent} color="white">{item.title}</Text>
            <Text color="gray" dimColor>  —  {item.artist}</Text>
            <LyricsTag videoId={item.videoId} />
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="gray" dimColor>↑↓ navegar   Enter = pular para música</Text>
      </Box>
    </Box>
  );
}

// ── Letras: helpers ─────────────────────────────────────────────

// Karaoke word-level fill: cada palavra tem seu estado calculado na hora.
// Sung: branco bold. Palavra atual: preenchimento char a char (branco→cinza).
// Upcoming: cinza dim.
function WordLine({ words, posMs, letterSpacing }: { words: LyricWord[]; posMs: number; letterSpacing?: boolean }) {
  const lastWord = words[words.length - 1];
  const allSung = lastWord != null && posMs >= lastWord.endMs;

  // Com letterSpacing: insere espaços entre cada caractere
  const spread = (s: string) => letterSpacing ? s.split('').join(' ') : s;

  return (
    <Box flexDirection="row" flexWrap="wrap">
      {words.map((word) => {
        const isSung    = allSung || posMs >= word.endMs;
        const isCurrent = !isSung && posMs >= word.startMs;

        if (isSung) {
          return <Text key={word.startMs} bold color="white">{spread(word.text)} </Text>;
        }

        if (isCurrent && word.syllables && word.syllables.length > 1) {
          // Fill char-a-char por sílaba
          return (
            <Box key={word.startMs} flexDirection="row">
              {word.syllables.map((syl) => {
                const sylSung    = posMs >= syl.endMs;
                const sylCurrent = !sylSung && posMs >= syl.startMs;
                if (sylSung) return <Text key={syl.startMs} bold color="white">{spread(syl.text)}</Text>;
                if (sylCurrent) {
                  const p      = Math.min(1, (posMs - syl.startMs) / Math.max(1, syl.endMs - syl.startMs));
                  const filled = Math.floor(p * syl.text.length);
                  return (
                    <Box key={syl.startMs} flexDirection="row">
                      {syl.text.slice(0, filled) && <Text bold color="white">{spread(syl.text.slice(0, filled))}</Text>}
                      {syl.text.slice(filled)    && <Text bold color="gray">{spread(syl.text.slice(filled))}</Text>}
                    </Box>
                  );
                }
                return <Text key={syl.startMs} bold color="gray">{spread(syl.text)}</Text>;
              })}
              <Text bold color="gray"> </Text>
            </Box>
          );
        }

        if (isCurrent) {
          // Sem sílabas: fill char-a-char interpolado
          const p      = Math.min(1, (posMs - word.startMs) / Math.max(1, word.endMs - word.startMs));
          const filled = Math.floor(p * word.text.length);
          return (
            <Box key={word.startMs} flexDirection="row">
              {word.text.slice(0, filled) && <Text bold color="white">{spread(word.text.slice(0, filled))}</Text>}
              {word.text.slice(filled)    && <Text bold color="gray">{spread(word.text.slice(filled))}</Text>}
              <Text bold color="gray"> </Text>
            </Box>
          );
        }

        return <Text key={word.startMs} color="white" dimColor>{spread(word.text)} </Text>;
      })}
    </Box>
  );
}

function LyricsScreen({ status, lines, loading, config }: { status: PlayerStatus; lines: LyricLine[] | null; loading: boolean; config: LyricsConfig }) {
  // posMs NÃO é state — é lido direto de player.positionMs no momento do render.
  // Re-renders são agendados via setTimeout exatamente quando a linha/palavra vai mudar,
  // eliminando qualquer intervalo periódico que causaria re-renders extras e piscadas na capa.
  const [, forceUpdate] = useState(0);
  const linesRef = useRef<LyricLine[] | null>(null);
  linesRef.current = lines;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
    const scheduleNext = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const posMs = player.positionMs;
      const ls = linesRef.current;

      if (!ls || ls.length === 0) {
        timerRef.current = setTimeout(scheduleNext, 1000);
        return;
      }

      let lineIdx = -1;
      for (let i = ls.length - 1; i >= 0; i--) {
        if (posMs >= ls[i].timeMs) { lineIdx = i; break; }
      }

      let nextBoundary = Infinity;

      if (lineIdx < 0) {
        nextBoundary = ls[0].timeMs;
      } else {
        const line = ls[lineIdx];
        for (const word of line.words) {
          if (word.startMs > posMs) { nextBoundary = Math.min(nextBoundary, word.startMs); break; }
          if (word.endMs > posMs) {
            if (word.syllables && word.syllables.length > 1) {
              // Sílabas: char-level dentro da sílaba atual + fronteira da próxima
              const curSyl = word.syllables.find(s => s.startMs <= posMs && posMs < s.endMs);
              const nextSyl = word.syllables.find(s => s.startMs > posMs);
              if (curSyl) {
                const nChars = curSyl.text.length;
                if (nChars > 1) {
                  const charDur   = (curSyl.endMs - curSyl.startMs) / nChars;
                  const elapsed   = posMs - curSyl.startMs;
                  const nextCharMs = curSyl.startMs + (Math.floor(elapsed / charDur) + 1) * charDur;
                  nextBoundary = Math.min(nextBoundary, nextCharMs);
                } else {
                  nextBoundary = Math.min(nextBoundary, curSyl.endMs);
                }
              }
              if (nextSyl) nextBoundary = Math.min(nextBoundary, nextSyl.startMs);
            } else {
              // Sem sílabas: fill char-a-char interpolado
              const nChars = word.text.length;
              if (nChars > 1) {
                const charDur   = (word.endMs - word.startMs) / nChars;
                const elapsed   = posMs - word.startMs;
                const nextCharMs = word.startMs + (Math.floor(elapsed / charDur) + 1) * charDur;
                nextBoundary = Math.min(nextBoundary, nextCharMs);
              } else {
                nextBoundary = Math.min(nextBoundary, word.endMs);
              }
            }
            break;
          }
        }
        const nextLine = ls[lineIdx + 1];
        if (nextLine) nextBoundary = Math.min(nextBoundary, nextLine.timeMs);
      }

      // Cap de 2s: se posMs estiver errado, o scheduler se auto-corrige em no máximo 2s
      const raw = nextBoundary === Infinity ? 2000 : nextBoundary - posMs;
      const delay = Math.max(16, Math.min(raw, 2000));
      timerRef.current = setTimeout(() => { forceUpdate(n => n + 1); scheduleNext(); }, delay);
    };

    scheduleRef.current = scheduleNext;
    scheduleNext();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [lines]);

  // Ressincronização via mpv IPC a cada 2s:
  // calibra startTime do player (corrige positionMs) e reagenda o scheduler
  useEffect(() => {
    const id = setInterval(async () => {
      const exact = await player.queryPosition();
      if (exact !== null) {
        player.calibrateFrom(exact);       // corrige player.positionMs
        forceUpdate(n => n + 1);           // re-render com posição correta
        scheduleRef.current();             // reagenda para próximo boundary correto
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // posMs computado inline — sem state, sem re-renders extras
  const posMs = player.positionMs;

  let activeIdx = -1;
  if (lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (posMs >= lines[i].timeMs) { activeIdx = i; break; }
    }
  }

  const ABOVE = config.contextLines;
  const BELOW = config.contextLines;
  const center = activeIdx >= 0 ? activeIdx : 0;
  const start = lines ? Math.max(0, center - ABOVE) : 0;
  const end   = lines ? Math.min(lines.length, center + BELOW + 1) : 0;
  const visibleLines = lines
    ? lines.slice(start, end).map((l, i) => ({ line: l, rel: start + i - center }))
    : [];

  if (status.state === 'idle' || !status.videoId) {
    return (
      <Box flexGrow={1} alignItems="center" justifyContent="center">
        <Text color="gray" dimColor>Nenhuma música tocando</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text bold color="white">{status.title ?? ''}</Text>
        {status.artist && <Text color="gray" dimColor>{status.artist}</Text>}
      </Box>

      {loading && (
        <Box justifyContent="center">
          <Text color="gray" dimColor>♩ Buscando letras...</Text>
        </Box>
      )}

      {!loading && lines === null && (
        <Box justifyContent="center">
          <Text color="gray" dimColor>Sem letras disponíveis</Text>
        </Box>
      )}

      {!loading && lines !== null && (
        <Box flexDirection="column" alignItems="center">
          {visibleLines.map(({ line, rel }) => {
            const isCurrent = rel === 0 && activeIdx >= 0;
            const dist = Math.abs(rel);
            const dimThreshold = config.dimAdjacentLines ? 1 : 2;
            const dimmed  = dist >= dimThreshold;

            if (isCurrent && line.words.length > 0) {
              return (
                <Box key={line.timeMs} marginY={config.bigCurrentLine ? 1 : 0}>
                  <WordLine words={line.words} posMs={posMs} letterSpacing={config.letterSpacing} />
                </Box>
              );
            }
            return (
              <Box key={line.timeMs} marginY={isCurrent && config.bigCurrentLine ? 1 : 0}>
                <Text bold={isCurrent} color="white" dimColor={dimmed}>
                  {config.letterSpacing && isCurrent ? line.text.split('').join(' ') : line.text}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

// ── Tela: Auth ──────────────────────────────────────────────────

function AuthScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'loading' | 'code' | 'done' | 'error'>('loading');
  const [userCode, setUserCode] = useState('');
  const [verifyUrl, setVerifyUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flow = await startDeviceFlow();
        if (cancelled) return;
        setUserCode(flow.user_code);
        setVerifyUrl(flow.verification_url);
        setStep('code');
        const poll = async () => {
          while (!cancelled) {
            const done = await pollDeviceFlow(flow.device_code, flow.interval);
            if (done) { setStep('done'); setTimeout(onDone, 1500); return; }
          }
        };
        poll();
      } catch { if (!cancelled) setStep('error'); }
    })();
    return () => { cancelled = true; };
  }, [onDone]);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Login com conta Google</Text>
      </Box>
      {step === 'loading' && <Text color="red">● Iniciando autenticação...</Text>}
      {step === 'error'   && <Text color="red">Erro ao iniciar. Tente novamente.</Text>}
      {step === 'done'    && <Text color="red" bold>✓ Autenticado com sucesso!</Text>}
      {step === 'code' && (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
          <Text>1. Acesse: <Text color="red" bold>{verifyUrl}</Text></Text>
          <Text>2. Digite o código: <Text color="red" bold>{userCode}</Text></Text>
          <Box marginTop={1}>
            <Text color="gray" dimColor>Aguardando confirmação...</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Tela: Configurações ─────────────────────────────────────────

const LANG_LABELS: Record<string, string> = {
  auto: 'Automático', en: 'English', pt: 'Português', es: 'Español',
  ja: '日本語', ko: '한국어', zh: '中文',
};

function SettingsScreen({ config, onChange }: { config: AppConfig; onChange: (c: AppConfig) => void }) {
  const [cursor, setCursor] = useState(0);

  type Item =
    | { kind: 'number'; label: string; field: keyof LyricsConfig; min: number; max: number }
    | { kind: 'bool';   label: string; field: keyof LyricsConfig }
    | { kind: 'cycle';  label: string; field: keyof LyricsConfig; options: string[] };

  const items: Item[] = [
    { kind: 'number', label: 'Linhas de contexto',         field: 'contextLines',     min: 1, max: 10 },
    { kind: 'bool',   label: 'Linha atual em destaque',    field: 'bigCurrentLine' },
    { kind: 'bool',   label: 'Escurecer linhas adjacentes',field: 'dimAdjacentLines' },
    { kind: 'bool',   label: 'Espaçamento entre letras',   field: 'letterSpacing' },
    { kind: 'cycle',  label: 'Idioma das letras',          field: 'lyricsLang', options: LANG_OPTIONS },
  ];

  const patchLyrics = (patch: Partial<LyricsConfig>) => {
    const next = { ...config, lyrics: { ...config.lyrics, ...patch } };
    onChange(next);
    saveConfig(next);
  };

  useInput((input, key) => {
    if (key.upArrow)   setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(items.length - 1, c + 1));

    const item = items[cursor];
    const goLeft = key.leftArrow || input === '-';
    const goRight = key.rightArrow || input === '+' || input === '=';

    if (item.kind === 'number') {
      if (goLeft)  patchLyrics({ [item.field]: Math.max(item.min, (config.lyrics[item.field] as number) - 1) });
      if (goRight) patchLyrics({ [item.field]: Math.min(item.max, (config.lyrics[item.field] as number) + 1) });
    }
    if (item.kind === 'bool') {
      if (goLeft)  patchLyrics({ [item.field]: false });
      if (goRight) patchLyrics({ [item.field]: true });
      if (key.return) patchLyrics({ [item.field]: !(config.lyrics[item.field]) });
    }
    if (item.kind === 'cycle') {
      const opts = item.options;
      const cur = opts.indexOf(config.lyrics[item.field] as string);
      if (goLeft || key.return)  patchLyrics({ [item.field]: opts[(cur - 1 + opts.length) % opts.length] });
      if (goRight) patchLyrics({ [item.field]: opts[(cur + 1) % opts.length] });
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Configurações</Text>
      </Box>

      <Box marginBottom={1} marginLeft={1}>
        <Text bold color="red">Letras</Text>
      </Box>

      {items.map((item, i) => {
        const isSel = i === cursor;
        const val = config.lyrics[item.field];
        return (
          <Box key={item.field} flexDirection="row" marginLeft={2} marginBottom={0}>
            <Text color={isSel ? 'red' : 'white'} dimColor={!isSel}>{isSel ? '❯ ' : '  '}</Text>
            <Text color="white">{item.label}{'  '}</Text>
            {item.kind === 'number' && (
              <>
                <Text color={isSel ? 'red' : 'gray'} dimColor>{'← '}</Text>
                <Text bold color="white">{String(val)}</Text>
                <Text color={isSel ? 'red' : 'gray'} dimColor>{' →'}</Text>
              </>
            )}
            {item.kind === 'bool' && (
              <Text bold color={val ? 'green' : 'gray'}>{val ? 'Sim' : 'Não'}</Text>
            )}
            {item.kind === 'cycle' && (
              <>
                <Text color={isSel ? 'red' : 'gray'} dimColor>{'← '}</Text>
                <Text bold color="white">{LANG_LABELS[val as string] ?? String(val)}</Text>
                <Text color={isSel ? 'red' : 'gray'} dimColor>{' →'}</Text>
              </>
            )}
          </Box>
        );
      })}

      <Box marginTop={2} marginLeft={2}>
        <Text color="gray" dimColor>↑↓ navegar   ←→ / Enter = alterar   h = voltar ao início</Text>
      </Box>
    </Box>
  );
}

// ── App Principal ───────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const [tab, setTab] = useState<NavTab>('home');
  const [appConfig, setAppConfig] = useState<AppConfig>(loadConfig);
  const [status, setStatus] = useState<PlayerStatus>(player.status);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);
  const [feedSections, setFeedSections] = useState<FeedSection[]>([]);
  const [homeSectionIdx, setHomeSectionIdx] = useState(0);
  const [homeItemIdx, setHomeItemIdx] = useState(0);
  const [homeLoading, setHomeLoading] = useState(true);
  const [userPlaylists, setUserPlaylists] = useState<HomePlaylist[]>([]);
  const [playlistsCursor, setPlaylistsCursor] = useState(0);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const playlistsLoaded = useRef(false);
  const [authenticated, setAuthenticated] = useState(isAuthenticated);
  // Sub-view: open playlist tracks (null = showing playlist list)
  const [openPlaylistTracks, setOpenPlaylistTracks] = useState<PlaylistTrack[] | null>(null);
  const [openPlaylistName, setOpenPlaylistName] = useState('');
  const [openPlaylistTracksLoading, setOpenPlaylistTracksLoading] = useState(false);
  const [openPlaylistTrackCursor, setOpenPlaylistTrackCursor] = useState(0);
  const [openArtistPage, setOpenArtistPage] = useState<ArtistPage | null>(null);
  const [openArtistLoading, setOpenArtistLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const loadingNext = useRef(false);
  const isLoadingTrack = useRef(false);
  const retriedVideoIds = useRef(new Set<string>());
  const hifiAbort = useRef<AbortController | null>(null);
  const [hifiQuality, setHifiQuality] = useState<string | null>(null);

  // Downloads em andamento
  const [downloads, setDownloads] = useState<Map<string, DownloadInfo>>(new Map());

  // Polling do status dos downloads a cada 500ms
  useEffect(() => {
    const id = setInterval(() => {
      setDownloads(prev => {
        let changed = false;
        const next = new Map(prev);
        const now = Date.now();
        for (const [videoId, dl] of next) {
          // Auto-remove 5s após done/error
          if ((dl.phase === 'done' || dl.phase === 'error') && dl.doneAt && now - dl.doneAt > 5000) {
            next.delete(videoId);
            try { fs.unlinkSync(`/tmp/ytmusic-dl-${videoId}.status`); } catch { /* ok */ }
            changed = true;
            continue;
          }
          if (dl.phase === 'done' || dl.phase === 'error') continue;
          try {
            const raw = fs.readFileSync(`/tmp/ytmusic-dl-${videoId}.status`, 'utf8');
            const parsed = JSON.parse(raw) as { phase: DownloadPhase; quality?: string; filename?: string };
            if (parsed.phase !== dl.phase || parsed.quality !== dl.quality) {
              const doneAt = (parsed.phase === 'done' || parsed.phase === 'error') ? now : undefined;
              next.set(videoId, { ...dl, ...parsed, doneAt });
              changed = true;
            }
          } catch { /* arquivo ainda não existe ou parse error — ok */ }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Letras — buscadas em background assim que o videoId muda
  const [lyricsLines, setLyricsLines] = useState<LyricLine[] | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const lyricsCtrl = useRef<AbortController | null>(null);


  useEffect(() => {
    if (!status.videoId || status.state === 'idle') { setLyricsLines(null); return; }
    lyricsCtrl.current?.abort();
    const ctrl = new AbortController();
    lyricsCtrl.current = ctrl;
    setLyricsLines(null);
    setLyricsLoading(true);
    fetchLyrics(status.title ?? '', status.artist ?? '', status.duration, ctrl.signal, appConfig.lyrics.lyricsLang)
      .then(l => {
        if (ctrl.signal.aborted) return;
        setLyricsLines(l);
        setLyricsLoading(false);
        const q: LyricsQuality = l === null ? 'none'
          : l.some(ln => ln.words.some(w => w.syllables && w.syllables.length > 1)) ? 'syllable'
          : l.some(ln => ln.words.length > 0) ? 'word'
          : 'line';
        if (!_lqCache.has(status.videoId)) { _lqCache.set(status.videoId, q); _lqNotify(); }
      })
      .catch(() => { if (!ctrl.signal.aborted) setLyricsLoading(false); });
    return () => ctrl.abort();
  }, [status.videoId, appConfig.lyrics.lyricsLang]);

  // Background fetch de qualidade para músicas na fila (via cache global)
  useEffect(() => {
    prefetchLyricsQuality(queue.map(it => ({
      videoId: it.videoId, title: it.title, artist: it.artist,
      durationSec: it.durationMs ? it.durationMs / 1000 : undefined,
    })));
  }, [queue]);

  // Carrega feed personalizado
  useEffect(() => {
    setHomeLoading(true);
    getFeed().then(s => { setFeedSections(s); setHomeLoading(false); }).catch(() => setHomeLoading(false));
  }, []);

  // Carrega playlists do usuário ao entrar na aba (lazy, uma vez, apenas se autenticado)
  useEffect(() => {
    if (tab !== 'playlists' || playlistsLoaded.current) return;
    const auth = isAuthenticated();
    setAuthenticated(auth);
    if (!auth) { playlistsLoaded.current = true; return; }
    playlistsLoaded.current = true;
    setPlaylistsLoading(true);
    getUserPlaylists()
      .then(p => { setUserPlaylists(p); setPlaylistsLoading(false); })
      .catch(() => setPlaylistsLoading(false));
  }, [tab]);

  // Teclas globais — desativadas quando TextInput está ativo (tab search sem resultados)
  // Ink dispara useInput em TODOS os componentes montados; sem esta guarda,
  // digitar 'a' na busca redirecionaria para auth e 'q' fecharia o app.
  const isTyping = tab === 'search';
  useInput((input, key) => {
    // Ctrl+C sempre funciona
    if (key.ctrl && input === 'c') { player.stop(); exit(); return; }

    // Bloqueado enquanto o usuário está digitando
    if (isTyping) return;

    if (input === 'q') { player.stop(); exit(); }
    if (input === 'h') setTab('home');
    if (input === '/') setTab('search');
    if (input === 'p') setTab('playlists');
    if (input === 'l') setTab('queue');
    if (input === 'L') setTab('lyrics');
    if (input === 's') setTab('settings');
    if (input === 'a') setTab('auth');
    if (input === ' ') player.togglePause();
    if (input === 'n') playNext();
    // Volume: bloqueado na tela de config (←→ lá controlam seleção)
    if (tab !== 'settings') {
      if (input === '+' || input === '=') player.volumeUp();
      if (input === '-') player.volumeDown();
    }

    // Setas laterais: seek ±10s (não na home — lá controlam navegação do feed)
    if (key.leftArrow && !key.ctrl && tab !== 'home') player.seek(-10);
    if (key.rightArrow && !key.ctrl && tab !== 'home') player.seek(10);
    if (key.ctrl && key.leftArrow) playPrev();
    if (key.ctrl && key.rightArrow) playNext();

    // Enter na home — seleciona item do feed
    if (key.return && tab === 'home') {
      const section = feedSections[homeSectionIdx];
      const item = section?.items[homeItemIdx];
      if (item) handleFeedItemSelect(item);
    }
    // Enter na aba de playlists — tratado em PlaylistsScreen via useInput
  });

  // Returns true if the track started playing, false if unavailable (null stream).
  const playTrack = useCallback(async (videoId: string, title: string, artist: string, idx: number): Promise<boolean> => {
    if (isLoadingTrack.current) return false;
    isLoadingTrack.current = true;
    setContentLoading(true);

    // Cancela qualquer busca hi-fi em andamento da música anterior
    hifiAbort.current?.abort();
    hifiAbort.current = null;
    setHifiQuality(null);

    let played = false;
    try {
      const stream = await getStreamUrl(videoId, title, artist);
      if (stream) {
        await player.play(stream.url, title, artist, stream.durationMs, videoId);
        setQueueIdx(idx);
        played = true;

        // Busca versão de maior qualidade em background
        const ctrl = new AbortController();
        hifiAbort.current = ctrl;
        findBestStream(title, artist, stream.durationMs, ctrl.signal, (result: HifiResult) => {
          // Só troca se ainda estamos tocando a mesma música
          if (player.status.videoId === videoId && !ctrl.signal.aborted) {
            player.switchUrl(result.url);
            setHifiQuality(result.quality);
          }
        }).catch(() => {});
      }
    } catch { /* stream fetch failed */ }
    setContentLoading(false);
    isLoadingTrack.current = false;
    return played;
  }, []);

  // Advances through queue skipping unavailable tracks.
  const playNext = useCallback(async () => {
    loadingNext.current = true;
    let nextIdx = queueIdx + 1;
    while (nextIdx < queue.length) {
      const next = queue[nextIdx];
      const played = await playTrack(next.videoId, next.title, next.artist, nextIdx);
      if (played) break;
      nextIdx++;
    }
    loadingNext.current = false;
  }, [queue, queueIdx, playTrack]);

  // Eventos do player — defined here so playTrack and playNext are in scope
  useEffect(() => {
    const onStatus = (s: PlayerStatus) => setStatus({ ...s });
    const onEnd = () => {
      if (loadingNext.current) return;
      const { state, position, videoId, title, artist } = player.status;
      // If mpv failed very quickly (< 3s) and this videoId hasn't been retried
      // yet, clear the cached URL and try again with a fresh one. This handles
      // transient CDN 403s where yt-dlp got a URL but mpv couldn't stream it.
      if (state === 'error' && position < 3 && videoId && !retriedVideoIds.current.has(videoId)) {
        retriedVideoIds.current.add(videoId);
        clearStreamCache(videoId);
        playTrack(videoId, title, artist, queueIdx);
        return;
      }
      retriedVideoIds.current.delete(videoId ?? '');
      playNext();
    };
    player.on('status', onStatus);
    player.on('end', onEnd);
    return () => { player.off('status', onStatus); player.off('end', onEnd); };
  }, [queue, queueIdx, playTrack, playNext]);

  const playPrev = useCallback(async () => {
    // Se estiver nos primeiros 3s, vai para a faixa anterior; senão reinicia
    if (status.position <= 3 && queueIdx > 0) {
      const prevIdx = queueIdx - 1;
      const prev = queue[prevIdx];
      if (prev) await playTrack(prev.videoId, prev.title, prev.artist, prevIdx);
    } else {
      player.seek(-status.position - 1); // volta ao início
    }
  }, [queue, queueIdx, status.position, playTrack]);

  // Used by home screen: auto-plays first track immediately
  const handlePlaylistSelect = useCallback(async (playlist: HomePlaylist) => {
    if (isLoadingTrack.current) return;
    setContentLoading(true);
    try {
      const tracks: PlaylistTrack[] = await getPlaylistTracks(playlist.browseId, playlist.params || undefined);
      if (tracks.length > 0) {
        const newQueue: QueueItem[] = tracks.map(t => ({ videoId: t.videoId, title: t.title, artist: t.artist }));
        setQueue(newQueue);
        await playTrack(tracks[0].videoId, tracks[0].title, tracks[0].artist, 0);
      }
    } catch { /* silently fail */ }
    setContentLoading(false);
  }, [playTrack]);

  // Used by playlists tab and home feed: loads tracks and shows them for browsing
  const handleOpenPlaylist = useCallback(async (playlist: HomePlaylist) => {
    setOpenPlaylistName(playlist.title);
    setOpenPlaylistTracks([]);
    setOpenPlaylistTrackCursor(0);
    setOpenPlaylistTracksLoading(true);
    try {
      const tracks = await getPlaylistTracks(playlist.browseId, playlist.params || undefined);
      setOpenPlaylistTracks(tracks);
    } catch { setOpenPlaylistTracks([]); }
    setOpenPlaylistTracksLoading(false);
  }, []);

  const handleFeedItemSelect = useCallback(async (item: FeedItem) => {
    if (item.type === 'song' && item.videoId) {
      const newQueue: QueueItem[] = [{ videoId: item.videoId, title: item.title, artist: item.subtitle }];
      setQueue(newQueue);
      const played = await playTrack(item.videoId, item.title, item.subtitle, 0);
      if (played) {
        getNextQueue(item.videoId, item.playlistId).then(next => {
          setQueue(q => [...q.slice(0, 1), ...next.map(n => ({ videoId: n.videoId, title: n.title, artist: n.artist }))]);
        }).catch(() => {});
      }
    } else if (item.browseId) {
      // Abre a playlist/álbum no browser de faixas (aba P) para o usuário escolher
      setTab('playlists');
      handleOpenPlaylist({ browseId: item.browseId, params: item.browseParams ?? '', title: item.title, subtitle: item.subtitle });
    }
  }, [playTrack, handleOpenPlaylist]);

  // Used by playlist track list: plays queue starting at the selected track.
  // Stays on the playlists tab so the user can keep browsing.
  const handlePlayFromTrack = useCallback(async (tracks: PlaylistTrack[], fromIdx: number) => {
    const newQueue: QueueItem[] = tracks.map(t => ({ videoId: t.videoId, title: t.title, artist: t.artist }));
    setQueue(newQueue);
    // Loop through tracks starting at fromIdx, skipping unavailable ones.
    let idx = fromIdx;
    while (idx < tracks.length) {
      const t = tracks[idx];
      const played = await playTrack(t.videoId, t.title, t.artist, idx);
      if (played) break;
      idx++;
    }
  }, [playTrack]);

  const handleSearchSelect = useCallback(async (item: SearchResult) => {
    if (item.type === 'artist') {
      // Carrega a página do artista
      setOpenArtistPage(null);
      setOpenArtistLoading(true);
      setTab('search');
      const page = await getArtistPage(item.browseId);
      setOpenArtistLoading(false);
      setOpenArtistPage(page);
      return;
    }
    // Música — toca imediatamente
    setContentLoading(true);
    const newQueue: QueueItem[] = [{ videoId: item.videoId, title: item.title, artist: item.artist }];
    setQueue(newQueue);
    setTab('home');
    await playTrack(item.videoId, item.title, item.artist, 0);
    getNextQueue(item.videoId).then(next => {
      setQueue(q => [...q.slice(0, 1), ...next.map(n => ({ videoId: n.videoId, title: n.title, artist: n.artist }))]);
    }).catch(() => {});
  }, [playTrack]);

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={process.stdout.rows ?? 24}>
      {/* Header */}
      <TopBar tab={tab} />

      {/* Loading overlay */}
      {contentLoading && (
        <Box paddingX={2}>
          <Text color="red">● </Text>
          <Text color="white">Carregando...</Text>
        </Box>
      )}

      {/* Content area */}
      <Box flexGrow={1}>
        {tab === 'home' && (
          <HomeScreen
            sections={feedSections}
            sectionIdx={homeSectionIdx}
            itemIdx={homeItemIdx}
            loading={homeLoading}
            onSectionChange={setHomeSectionIdx}
            onItemChange={setHomeItemIdx}
            onDownload={(videoId, title) =>
              setDownloads(prev => new Map(prev).set(videoId, { title, phase: 'searching' }))
            }
          />
        )}
        {tab === 'search' && (openArtistPage !== null || openArtistLoading) && (
          <ArtistScreen
            page={openArtistPage}
            loading={openArtistLoading}
            onSelectSong={(videoId, title, artist) => {
              setOpenArtistPage(null);
              handleSearchSelect({ type: 'song', videoId, title, artist, duration: '', thumbnail: '' });
            }}
            onSelectRelease={(browseId) => {
              setOpenArtistPage(null);
              setTab('playlists');
              handleOpenPlaylist({ browseId, title: '', subtitle: '', thumbnail: '', params: '' });
            }}
            onBack={() => { setOpenArtistPage(null); setOpenArtistLoading(false); }}
          />
        )}
        {tab === 'search' && openArtistPage === null && !openArtistLoading && (
          <SearchScreen onSelect={handleSearchSelect} onBack={() => setTab('home')} />
        )}
        {tab === 'playlists' && openPlaylistTracks === null && (
          <PlaylistsScreen
            playlists={userPlaylists}
            cursor={playlistsCursor}
            loading={playlistsLoading}
            authenticated={authenticated}
            onCursorChange={setPlaylistsCursor}
            onOpen={handleOpenPlaylist}
          />
        )}
        {tab === 'playlists' && openPlaylistTracks !== null && (
          <PlaylistTracksScreen
            name={openPlaylistName}
            tracks={openPlaylistTracks}
            cursor={openPlaylistTrackCursor}
            loading={openPlaylistTracksLoading}
            onCursorChange={setOpenPlaylistTrackCursor}
            onSelect={(idx) => handlePlayFromTrack(openPlaylistTracks, idx)}
            onBack={() => { setOpenPlaylistTracks(null); }}
          />
        )}
        {tab === 'queue' && (
          <QueueScreen
            queue={queue}
            currentIdx={queueIdx}
            onSelect={(idx) => {
              const item = queue[idx];
              if (item) playTrack(item.videoId, item.title, item.artist, idx);
            }}
          />
        )}
        {tab === 'lyrics' && (
          <LyricsScreen status={status} lines={lyricsLines} loading={lyricsLoading} config={appConfig.lyrics} />
        )}
        {tab === 'settings' && (
          <SettingsScreen config={appConfig} onChange={setAppConfig} />
        )}
        {tab === 'auth' && (
          <AuthScreen onDone={() => {
            setAuthenticated(true);
            // Permite recarregar playlists após login
            playlistsLoaded.current = false;
            setTab('playlists');
          }} />
        )}
      </Box>

      {/* Downloads */}
      <DownloadsBar downloads={downloads} />

      {/* Player bar */}
      <PlayerBar status={status} hifiQuality={hifiQuality} />
    </Box>
  );
}

// Alternate screen buffer: TUI always starts at terminal row 1 (row-absolute
// kitty writes are correct), and previous terminal content is preserved on exit.
process.stdout.write('\x1b[?1049h\x1b[H');
process.on('exit', () => { process.stdout.write('\x1b[?1049l'); });

render(<App />);
