import net from 'net';
import fs from 'fs';

// ── Discord Rich Presence via IPC local ──────────────────────────────────────
// Implementa o protocolo IPC do Discord sem dependências externas.
// O Discord expõe um socket Unix em $XDG_RUNTIME_DIR/discord-ipc-N.
// Mensagens têm header de 8 bytes [opcode LE4][length LE4] + JSON.
// Opcodes: 0 = HANDSHAKE, 1 = FRAME, 2 = PING, 3 = PONG, 4 = CLOSE.

export interface DiscordActivity {
  details?: string;       // linha 1 — título da música
  state?: string;         // linha 2 — artista
  timestamps?: { start?: number; end?: number };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
}

function findSocketPath(): string | null {
  const candidates: string[] = [];

  // XDG_RUNTIME_DIR (padrão no Linux com systemd)
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg) {
    for (let i = 0; i < 10; i++) candidates.push(`${xdg}/discord-ipc-${i}`);
    // Discord via Flatpak
    for (let i = 0; i < 10; i++)
      candidates.push(`${xdg}/app/com.discordapp.Discord/discord-ipc-${i}`);
    // Discord via Snap
    for (let i = 0; i < 10; i++)
      candidates.push(`${xdg}/snap.discord/discord-ipc-${i}`);
  }

  // Fallback /tmp
  for (let i = 0; i < 10; i++) candidates.push(`/tmp/discord-ipc-${i}`);

  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ok */ }
  }
  return null;
}

export class DiscordRPC {
  private clientId: string;
  private socket: net.Socket | null = null;
  private nonce = 0;
  private ready = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  connect(): void {
    if (this.destroyed) return;
    const path = findSocketPath();
    if (!path) { this._scheduleReconnect(); return; }

    const sock = net.createConnection(path);
    sock.on('connect', () => {
      this.socket = sock;
      this._send(0, { v: 1, client_id: this.clientId });
    });

    // Lê frames de resposta do Discord
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const len = buf.readUInt32LE(4);
        if (buf.length < 8 + len) break;
        const payload = buf.slice(8, 8 + len).toString('utf8');
        buf = buf.slice(8 + len);
        try {
          const msg = JSON.parse(payload);
          if (msg?.evt === 'READY') this.ready = true;
        } catch { /* ok */ }
      }
    });

    sock.on('error', () => this._reset());
    sock.on('close', () => this._reset());
  }

  setActivity(activity: DiscordActivity): void {
    if (!this.ready) return;
    this._send(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: String(++this.nonce),
    });
  }

  clearActivity(): void {
    if (!this.ready) return;
    this._send(1, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: null },
      nonce: String(++this.nonce),
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
    this.socket = null;
    this.ready = false;
  }

  private _send(opcode: number, data: unknown): void {
    if (!this.socket) return;
    const json = JSON.stringify(data);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(opcode, 0);
    header.writeUInt32LE(json.length, 4);
    try { this.socket.write(Buffer.concat([header, Buffer.from(json)])); } catch { /* ok */ }
  }

  private _reset(): void {
    this.socket = null;
    this.ready = false;
    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 30_000);
  }
}
