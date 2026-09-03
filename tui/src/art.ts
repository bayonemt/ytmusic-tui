import { execFile } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);
const ART_DIR = '/tmp/ytmusic-art';

// Limita renderizações concorrentes para não travar o event loop com
// subprocessos de chafa/ImageMagick enquanto o usuário navega.
let _semSlots = 3;
const _semQueue: Array<() => void> = [];
function semAcquire(): Promise<void> {
  if (_semSlots > 0) { _semSlots--; return Promise.resolve(); }
  return new Promise(res => _semQueue.push(res));
}
function semRelease() {
  const next = _semQueue.shift();
  if (next) next(); else _semSlots++;
}

function detectFormat(): string {
  const term = process.env.TERM ?? '';
  if (term === 'xterm-kitty') return 'kitty';
  const vte = process.env.VTE_VERSION;
  if (vte && parseInt(vte) >= 6400) return 'sixels';
  if (term.includes('xterm') || term === 'mlterm') return 'sixels';
  return 'symbols';
}

const TERM_FORMAT = detectFormat();
export const supportsNativeImages = TERM_FORMAT !== 'symbols';

type ArtEntry = { lines: string[]; single: string };
const artCache = new Map<string, ArtEntry>();

// Deduplica requests concorrentes para o mesmo id+size: guarda a Promise em andamento.
// Quando termina (sucesso ou erro) a Promise é removida do mapa.
const artInFlight = new Map<string, Promise<ArtEntry>>();

// Callbacks chamados quando uma arte fica pronta (single preenchido).
type ArtReadyFn = (id: string, w: number, h: number) => void;
const artReadyListeners: ArtReadyFn[] = [];

export function onArtReady(fn: ArtReadyFn): () => void {
  artReadyListeners.push(fn);
  return () => {
    const i = artReadyListeners.indexOf(fn);
    if (i >= 0) artReadyListeners.splice(i, 1);
  };
}

export function ytThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function ensureDir() {
  if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR, { recursive: true });
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadFile(res.headers.location!, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { file.close(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => file.close(resolve as () => void));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

// Center-crop thumbnail to square using ImageMagick, removing letterboxing.
// Returns the cropped path, or the original path if ImageMagick unavailable.
async function cropToSquare(imgPath: string): Promise<string> {
  const croppedPath = imgPath.replace(/\.jpg$/, '_sq.jpg');
  if (fs.existsSync(croppedPath)) return croppedPath;
  try {
    const { stdout } = await execFileAsync('identify', ['-format', '%w %h', imgPath], { timeout: 3000 });
    const [w, h] = stdout.trim().split(' ').map(Number);
    if (w === h) return imgPath;
    const side = Math.min(w, h);
    const x = Math.floor((w - side) / 2);
    const y = Math.floor((h - side) / 2);
    await execFileAsync('convert', [
      imgPath,
      '-crop', `${side}x${side}+${x}+${y}`,
      '+repage',
      croppedPath,
    ], { timeout: 5000 });
    return croppedPath;
  } catch {
    return imgPath;
  }
}

async function runChafa(imgPath: string, w: number, h: number, fmt: string): Promise<string> {
  const args: string[] = ['--size', `${w}x${h}`, '--stretch', '--format', fmt];

  if (fmt === 'symbols') {
    args.push('--symbols', 'half', '--colors', 'full', '--font-ratio', '1/2');
  }

  args.push(imgPath);
  const { stdout } = await execFileAsync('chafa', args, { timeout: 8000 });
  return stdout.replace(/\x1b\[\?25[lh]/g, '');
}

async function loadArt(id: string, w: number, h: number, url?: string): Promise<ArtEntry> {
  const key = `${id}:${w}x${h}:${TERM_FORMAT}`;

  await semAcquire();
  try {
    // Re-checar cache dentro do semaphore: outro caller pode ter preenchido.
    const cached = artCache.get(key);
    if (cached?.single || (TERM_FORMAT === 'symbols' && cached?.lines?.length)) {
      return cached;
    }

    ensureDir();
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const imgPath = path.join(ART_DIR, `${safeId}.jpg`);
    const thumbnailUrl = url ?? ytThumbnail(id);

    if (!fs.existsSync(imgPath)) {
      await downloadFile(thumbnailUrl, imgPath);
    }

    // Remove letterboxing: center-crop to square before passing to chafa
    const src = await cropToSquare(imgPath);

    let entry: ArtEntry;
    if (TERM_FORMAT === 'kitty' || TERM_FORMAT === 'sixels') {
      const nativeRaw = await runChafa(src, w, h, TERM_FORMAT);
      entry = { lines: [], single: nativeRaw.trim() };
    } else {
      const raw = await runChafa(src, w, h, 'symbols');
      const lines = raw.split('\n').filter(l => l.length > 0).slice(0, h);
      entry = { lines, single: '' };
    }

    artCache.set(key, entry);
    if (entry.single || entry.lines.length > 0) {
      artReadyListeners.forEach(fn => fn(id, w, h));
    }
    return entry;
  } catch {
    // Em caso de erro não guardar nada no cache para permitir retry.
    return { lines: [], single: '' };
  } finally {
    semRelease();
    artInFlight.delete(key);
  }
}

export async function renderArt(id: string, w: number, h: number, url?: string): Promise<ArtEntry> {
  const key = `${id}:${w}x${h}:${TERM_FORMAT}`;

  // Cache hit: retorna imediatamente se arte já carregada com conteúdo real.
  const cached = artCache.get(key);
  if (cached?.single || (TERM_FORMAT === 'symbols' && cached?.lines?.length)) {
    return cached;
  }

  // Deduplicar: se já há um request em andamento, aguardar ele.
  const inFlight = artInFlight.get(key);
  if (inFlight) return inFlight;

  // Iniciar carregamento e registrar a Promise para deduplicação.
  const promise = loadArt(id, w, h, url);
  artInFlight.set(key, promise);
  return promise;
}

// Synchronous cache lookup — returns the entry only if it has real content.
export function getCachedArt(id: string, w: number, h: number): ArtEntry | undefined {
  const key = `${id}:${w}x${h}:${TERM_FORMAT}`;
  const entry = artCache.get(key);
  if (!entry) return undefined;
  if (TERM_FORMAT === 'symbols') return entry.lines.length > 0 ? entry : undefined;
  return entry.single ? entry : undefined;
}

export function prefetchArt(id: string, w: number, h: number, url?: string): void {
  renderArt(id, w, h, url).catch(() => {});
}

// Chafa emits the first APC as a parameter-only header with NO semicolon:
//   ESC_Ga=T,f=32,s=W,v=H,c=C,r=R,m=1,q=2ESC\   ← no ';', no data
// followed by data chunks:
//   ESC_Gm=1;<base64>ESC\   ESC_Gm=0;<base64>ESC\
// The regex must match APCs ending in either ESC\ (no data) or ; (with data).
// We only patch the first non-continuation APC (not m=N data chunks).

// Inject a kitty image ID so the image is stored in terminal memory and can be
// re-placed cheaply with a=p,i=<id> instead of re-transmitting full base64.
export function injectKittyId(kittyStr: string, id: number): string {
  let injected = false;
  return kittyStr.replace(/\x1b_G([^;\x1b]*)(\x1b\\|;)/g, (match, params, term) => {
    if (!injected && !params.startsWith('m=')) {
      injected = true;
      return `\x1b_G${params},i=${id}${term}`;
    }
    return match;
  });
}

// Convert chafa's a=T (transmit+display) to a=t (transmit-only) with image ID.
// After this, use a=p,i=<id> to display without re-uploading.
export function toTransmitOnly(kittyStr: string, id: number): string {
  let first = true;
  return kittyStr.replace(/\x1b_G([^;\x1b]*)(\x1b\\|;)/g, (match, params, term) => {
    if (first && !params.startsWith('m=')) {
      first = false;
      const p = params
        .replace(/\ba=T\b/, 'a=t')
        .replace(/(?:,i=\d+|^i=\d+,?)/g, '');
      return `\x1b_G${p},i=${id}${term}`;
    }
    return match;
  });
}
