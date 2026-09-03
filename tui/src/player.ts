import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import net from 'net';
import fs from 'fs';

export type PlayerState = 'idle' | 'playing' | 'paused' | 'loading' | 'error';

export interface PlayerStatus {
  state: PlayerState;
  position: number;
  duration: number;
  volume: number;
  title: string;
  artist: string;
  videoId: string;
}

export class AudioPlayer extends EventEmitter {
  private process: ChildProcess | null = null;
  private socketPath: string;
  private _state: PlayerState = 'idle';
  private _position = 0;
  private _duration = 0;
  private _volume = 80;
  private _title = '';
  private _artist = '';
  private _videoId = '';
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private pausedAt = 0;

  constructor() {
    super();
    this.socketPath = `/tmp/ytmusic-mpv-${process.pid}.sock`;
  }

  get status(): PlayerStatus {
    return {
      state: this._state,
      position: this._position,
      duration: this._duration,
      volume: this._volume,
      title: this._title,
      artist: this._artist,
      videoId: this._videoId,
    };
  }

  // Envia comando JSON para o socket IPC do mpv
  private sendMpvCommand(command: unknown[]) {
    try {
      if (!fs.existsSync(this.socketPath)) return;
      const client = net.createConnection(this.socketPath, () => {
        client.write(JSON.stringify({ command }) + '\n');
        client.end();
      });
      client.on('error', () => {}); // ignora erros de socket
    } catch { /* ignora */ }
  }

  async play(url: string, title: string, artist: string, durationMs: number, videoId = '') {
    this.stop();
    this._title = title;
    this._artist = artist;
    this._videoId = videoId;
    this._duration = Math.floor(durationMs / 1000);
    this._position = 0;
    this._state = 'loading';
    this.emit('status', this.status);

    // Remove socket anterior se existir
    try { fs.unlinkSync(this.socketPath); } catch { /* ok */ }

    const mpvArgs = [
      '--no-video',
      '--no-terminal',
      `--volume=${this._volume}`,
      `--input-ipc-server=${this.socketPath}`,
      url,
    ];

    this.process = spawn('mpv', mpvArgs, { stdio: 'ignore' });
    this.startTime = Date.now();
    this._state = 'playing';
    this.emit('status', this.status);

    this.startPositionTimer();

    // Calibra startTime usando time-pos real do mpv após ele começar a decodificar.
    // O mpv leva ~0.5-1s para abrir o stream, então Date.now() - startTime fica
    // adiantado por esse lag. Fazemos duas calibrações: em 1s e em 3s.
    const calibrate = async () => {
      const timePos = await this.queryPosition();
      if (timePos !== null && this._state === 'playing') {
        this.startTime = Date.now() - timePos * 1000;
      }
    };
    setTimeout(calibrate, 1500);
    setTimeout(calibrate, 4000);

    this.process.on('exit', (code) => {
      this.clearPositionTimer();
      try { fs.unlinkSync(this.socketPath); } catch { /* ok */ }
      if (code === 0) {
        this._state = 'idle';
        this._position = 0;
      } else if (this._state !== 'idle') {
        this._state = 'error';
      }
      this.emit('status', this.status);
      this.emit('end');
    });

    this.process.on('error', () => {
      this._state = 'error';
      this.emit('status', this.status);
    });
  }

  private startPositionTimer() {
    this.clearPositionTimer();
    this.positionTimer = setInterval(() => {
      if (this._state === 'playing') {
        this._position = Math.floor((Date.now() - this.startTime) / 1000);
        if (this._duration > 0 && this._position >= this._duration) {
          this._position = this._duration;
        }
        this.emit('status', this.status);
      }
    }, 1000);
  }

  private clearPositionTimer() {
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
  }

  pause() {
    if (this.process && this._state === 'playing') {
      this.sendMpvCommand(['set_property', 'pause', true]);
      this.pausedAt = Date.now();
      this._state = 'paused';
      this.clearPositionTimer();
      this.emit('status', this.status);
    }
  }

  resume() {
    if (this.process && this._state === 'paused') {
      this.sendMpvCommand(['set_property', 'pause', false]);
      // Corrige startTime para compensar o tempo pausado
      this.startTime += Date.now() - this.pausedAt;
      this._state = 'playing';
      this.startPositionTimer();
      this.emit('status', this.status);
    }
  }

  togglePause() {
    if (this._state === 'playing') this.pause();
    else if (this._state === 'paused') this.resume();
  }

  seek(seconds: number) {
    if (this._state !== 'playing' && this._state !== 'paused') return;
    this.sendMpvCommand(['seek', seconds, 'relative']);
    this._position = Math.max(0, Math.min(this._duration, this._position + seconds));
    this.startTime = Date.now() - this._position * 1000;
    this.emit('status', this.status);
  }

  stop() {
    this.clearPositionTimer();
    if (this.process) {
      this.process.removeAllListeners();
      this.process.kill('SIGKILL');
      this.process = null;
    }
    try { fs.unlinkSync(this.socketPath); } catch { /* ok */ }
    this._state = 'idle';
    this._position = 0;
    this._title = '';
    this._artist = '';
    this._videoId = '';
  }

  // Troca o stream mantendo a posição atual.
  // Mata o mpv atual e sobe um novo com --start=N para evitar
  // problemas com loadfile + seek em streams MPD/DASH.
  switchUrl(url: string) {
    if (this._state !== 'playing' && this._state !== 'paused') return;
    const savedPos = this._position;
    const wasPaused = this._state === 'paused';

    // Para o processo atual sem emitir 'end' (para não disparar playNext)
    this.clearPositionTimer();
    if (this.process) {
      this.process.removeAllListeners();
      this.process.kill('SIGKILL');
      this.process = null;
    }
    try { fs.unlinkSync(this.socketPath); } catch { /* ok */ }

    const mpvArgs = [
      '--no-video', '--no-terminal',
      `--volume=${this._volume}`,
      `--input-ipc-server=${this.socketPath}`,
      `--start=${savedPos}`,
      url,
    ];

    this.process = spawn('mpv', mpvArgs, { stdio: 'ignore' });
    this.startTime = Date.now() - savedPos * 1000;
    this._state = wasPaused ? 'paused' : 'playing';
    if (wasPaused) setTimeout(() => this.sendMpvCommand(['set_property', 'pause', true]), 500);
    this.startPositionTimer();
    this.emit('status', this.status);
    // Recalibra após o mpv reabrir com --start=N
    setTimeout(async () => {
      const timePos = await this.queryPosition();
      if (timePos !== null && this._state === 'playing') {
        this.startTime = Date.now() - timePos * 1000;
      }
    }, 1500);

    this.process.on('exit', (code) => {
      this.clearPositionTimer();
      try { fs.unlinkSync(this.socketPath); } catch { /* ok */ }
      if (code === 0) { this._state = 'idle'; this._position = 0; }
      else if (this._state !== 'idle') { this._state = 'error'; }
      this.emit('status', this.status);
      this.emit('end');
    });
    this.process.on('error', () => { this._state = 'error'; this.emit('status', this.status); });
  }

  setVolume(vol: number) {
    this._volume = Math.max(0, Math.min(100, vol));
    // Aplica no processo já rodando via IPC
    this.sendMpvCommand(['set_property', 'volume', this._volume]);
    this.emit('status', this.status);
  }

  volumeUp() { this.setVolume(this._volume + 5); }
  volumeDown() { this.setVolume(this._volume - 5); }

  calibrateFrom(timePosSec: number) {
    if (this._state === 'playing') {
      this.startTime = Date.now() - timePosSec * 1000;
    }
  }

  // Posição estimada em ms baseada em startTime (precisa entre emits de 1s)
  get positionMs(): number {
    if (this._state === 'playing') return Date.now() - this.startTime;
    return this._position * 1000;
  }

  // Consulta o mpv via IPC para obter a posição exata (time-pos em segundos)
  queryPosition(): Promise<number | null> {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.socketPath)) { resolve(null); return; }
      const REQ_ID = 42;
      const client = net.createConnection(this.socketPath, () => {
        client.write(JSON.stringify({ command: ['get_property', 'time-pos'], request_id: REQ_ID }) + '\n');
      });
      let buf = '';
      const done = (val: number | null) => { try { client.destroy(); } catch { /* ok */ } resolve(val); };
      const timer = setTimeout(() => done(null), 500);
      client.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        for (const line of buf.split('\n')) {
          try {
            const obj = JSON.parse(line.trim());
            if (obj.request_id === REQ_ID && obj.error === 'success' && typeof obj.data === 'number') {
              clearTimeout(timer);
              done(obj.data);
              return;
            }
          } catch { /* linha incompleta */ }
        }
      });
      client.on('error', () => { clearTimeout(timer); done(null); });
    });
  }
}
