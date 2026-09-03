#!/usr/bin/env node
// Chamado como processo filho:
// npx tsx src/download-worker.ts <videoId> <title> <artist> <durationMs> <outDir>
import { findBestStream, type HifiResult } from './hifi.js';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

const [,, videoId, title, artist, durMsStr, outDir] = process.argv;
const durationMs = parseInt(durMsStr ?? '0', 10);
const downloadDir = outDir ?? path.join(os.homedir(), 'Downloads');

const STATUS_FILE = `/tmp/ytmusic-dl-${videoId}.status`;
function reportStatus(phase: string, extra?: Record<string, string>) {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify({ phase, ...extra })); } catch { /* ok */ }
}

function safeName(s: string) {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'track';
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, res => {
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
    await execFileAsync('convert', [imgPath, '-crop', `${side}x${side}+${x}+${y}`, '+repage', croppedPath], { timeout: 5000 });
    return croppedPath;
  } catch { return imgPath; }
}

async function embedThumbnail(audioPath: string, videoId: string): Promise<void> {
  const thumbRaw = `/tmp/dl_thumb_${videoId}.jpg`;
  const thumbSq  = `/tmp/dl_thumb_${videoId}_sq.jpg`;
  try {
    await downloadFile(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, thumbRaw);
    const thumbFinal = await cropToSquare(thumbRaw);
    const ext = path.extname(audioPath).toLowerCase();

    if (ext === '.flac') {
      // FLAC: usa metaflac se disponível, senão ffmpeg com mapeamento correto
      try {
        await execFileAsync('metaflac', [
          `--import-picture-from=3||||${thumbFinal}`,
          audioPath,
        ], { timeout: 15000 });
      } catch {
        // fallback ffmpeg para FLAC
        const tmpPath = audioPath + '.tmp.flac';
        await execFileAsync('ffmpeg', [
          '-i', audioPath, '-i', thumbFinal,
          '-map', '0', '-map', '1',
          '-c:a', 'copy', '-c:v', 'copy',
          '-metadata:s:v', 'title=Cover (front)',
          '-metadata:s:v', 'comment=Cover (front)',
          '-y', tmpPath,
        ], { timeout: 30000 });
        if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, audioPath);
      }
    } else {
      // MP3 / M4A / outros: ffmpeg com ID3
      const tmpPath = audioPath + '.tmp' + ext;
      await execFileAsync('ffmpeg', [
        '-i', audioPath, '-i', thumbFinal,
        '-map', '0:a', '-map', '1:v',
        '-c:a', 'copy', '-c:v', 'mjpeg',
        '-id3v2_version', '3',
        '-metadata:s:v', 'title=Album cover',
        '-y', tmpPath,
      ], { timeout: 30000 });
      if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, audioPath);
    }
  } catch { /* thumbnail opcional */ }
  for (const f of [thumbRaw, thumbSq]) try { fs.unlinkSync(f); } catch { /* ok */ }
}

async function downloadWithFfmpeg(url: string, outputPath: string): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', [
      '-i', url, '-c:a', 'copy', '-y', outputPath,
    ], { timeout: 180000 });
    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000;
  } catch { return false; }
}

async function fallbackYtdlp(): Promise<void> {
  await new Promise<void>((resolve) => {
    const proc = spawn('yt-dlp', [
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '--print', 'after_move:filepath',
      '-o', path.join(downloadDir, '%(title)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    proc.on('close', async () => {
      const audioPath = output.trim().split('\n').pop() ?? '';
      if (audioPath && fs.existsSync(audioPath)) {
        reportStatus('embedding', { quality: 'MP3' });
        await embedThumbnail(audioPath, videoId);
        reportStatus('done', { quality: 'MP3', filename: path.basename(audioPath) });
      }
      resolve();
    });
  });
}

async function main() {
  if (!videoId || !title) { process.exit(1); }

  reportStatus('searching');

  let hifiResult: HifiResult | null = null as HifiResult | null;
  const ctrl = new AbortController();

  const timeout = setTimeout(() => ctrl.abort(), 20000);
  await findBestStream(title, artist, durationMs, ctrl.signal, (r) => { hifiResult = r; });
  clearTimeout(timeout);

  if (hifiResult !== null) {
    const r = hifiResult as HifiResult;
    const ext = (r.source === 'tidal' || r.source === 'arcod') ? 'flac' : r.source === 'jiosaavn' ? 'm4a' : 'mp3';
    const quality = ext === 'flac' ? 'FLAC' : ext === 'm4a' ? '320kbps' : 'MP3';
    const outputPath = path.join(downloadDir, `${safeName(title)}.${ext}`);
    reportStatus('downloading', { quality });
    const ok = await downloadWithFfmpeg(r.url, outputPath);
    if (ok) {
      reportStatus('embedding', { quality });
      await embedThumbnail(outputPath, videoId);
      reportStatus('done', { quality, filename: path.basename(outputPath) });
      process.exit(0);
    }
  }

  reportStatus('downloading', { quality: 'MP3' });
  await fallbackYtdlp();
  reportStatus('done', { quality: 'MP3' });
  process.exit(0);
}

main().catch(() => {
  reportStatus('error');
  fallbackYtdlp().finally(() => process.exit(0));
});
