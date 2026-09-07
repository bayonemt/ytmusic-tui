import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_AUTH_FILE = path.join(__dirname, '..', '.browser-auth.json');

const CHROMIUM_PATH = '/usr/bin/chromium-browser';
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
  return `SAPISIDHASH ${now}_${hash}`;
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

// Abre o browser, aguarda o usuário logar e captura os cookies.
// Retorna true em caso de sucesso, false se o usuário fechar o browser.
export async function launchBrowserLogin(
  onStatus?: (msg: string) => void,
): Promise<boolean> {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(YTM_ORIGIN);

  onStatus?.('Aguardando login no navegador...');

  // Verifica a cada segundo se o SAPISID já apareceu (= usuário logou)
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
  const start = Date.now();

  while (Date.now() - start < TIMEOUT_MS) {
    if (!browser.isConnected()) return false; // usuário fechou o browser

    const cookies = await context.cookies(YTM_ORIGIN);
    const sapisid = cookies.find(c => c.name === 'SAPISID' || c.name === '__Secure-3PAPISID');
    if (sapisid) {
      // Monta o header Cookie completo com todos os cookies relevantes
      const relevant = ['SAPISID', '__Secure-3PAPISID', 'SID', 'HSID', 'SSID',
                        '__Secure-1PSID', '__Secure-3PSID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE'];
      const cookieHeader = cookies
        .filter(c => relevant.includes(c.name))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      saveBrowserAuth({
        cookieHeader,
        sapisid: sapisid.value,
        savedAt: Date.now(),
      });

      onStatus?.('Login realizado com sucesso!');
      await browser.close();
      return true;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();
  return false;
}
