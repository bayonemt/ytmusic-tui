import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_AUTH_FILE = path.join(__dirname, '..', '.browser-auth.json');

const YTM_ORIGIN = 'https://music.youtube.com';

export interface BrowserAuthData {
  cookieHeader: string;
  sapisid: string;
  savedAt: number;
}

export function loadBrowserAuth(): BrowserAuthData | null {
  try {
    return JSON.parse(fs.readFileSync(BROWSER_AUTH_FILE, 'utf-8'));
  } catch { return null; }
}

export function saveBrowserAuth(data: BrowserAuthData): void {
  fs.writeFileSync(BROWSER_AUTH_FILE, JSON.stringify(data, null, 2));
}

export function hasBrowserAuth(): boolean {
  return loadBrowserAuth() !== null;
}

export function computeSAPISIDHASH(sapisid: string): string {
  const now = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1')
    .update(`${now} ${sapisid} ${YTM_ORIGIN}`)
    .digest('hex');
  return `SAPISIDHASH ${now}_${hash}_u`;
}

export function getAuthHeaders(): Record<string, string> | null {
  const auth = loadBrowserAuth();
  if (!auth) return null;
  return {
    'Cookie': auth.cookieHeader,
    'Authorization': computeSAPISIDHASH(auth.sapisid),
    'X-Origin': YTM_ORIGIN,
    'Origin': YTM_ORIGIN,
  };
}

// Abre o YouTube Music com camoufox (Firefox anti-detecção), aguarda o login
// e salva os cookies. Retorna true em caso de sucesso.
export async function launchBrowserLogin(
  onStatus?: (msg: string) => void,
): Promise<boolean> {
  const tmpFile = path.join(__dirname, '..', '.browser-auth-tmp.json');
  const helperScript = path.join(__dirname, 'browser-auth-helper.py');

  onStatus?.('Abrindo navegador...');

  return new Promise((resolve) => {
    const proc = spawn('python3', [helperScript, tmpFile], {
      stdio: 'ignore',
      detached: false,
    });

    onStatus?.('Aguardando login no navegador...');

    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(tmpFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
          saveBrowserAuth(data);
          fs.unlinkSync(tmpFile);
          onStatus?.('Login realizado com sucesso!');
          resolve(true);
        } catch {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  });
}
