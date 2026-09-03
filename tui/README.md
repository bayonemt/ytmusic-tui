# ytmusic-tui

A terminal-based YouTube Music player with automatic hi-fi audio upgrade.

Plays music from YouTube Music via the Innertube API, then silently finds a higher-quality stream (Qobuz FLAC 24-bit → Tidal FLAC → JioSaavn 320kbps → SoundCloud) and switches mid-playback — no interruptions.

## Features

- **YouTube Music integration** — home feed, search, playlists, queue, liked songs
- **Auto hi-fi upgrade** — starts playing from YouTube, upgrades to the best available lossless source in the background
- **Hi-res cascade**: Qobuz (FLAC 24-bit) → Tidal (FLAC 44.1kHz) → JioSaavn (MP3 320kbps) → SoundCloud (256kbps)
- **Download** — saves in the best available quality (FLAC when possible), with square-cropped cover art embedded
- **Like / add to playlist** via Innertube API
- **mpv** as the audio backend with IPC volume/seek control

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [mpv](https://mpv.io/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (fallback stream & SoundCloud search)
- [ffmpeg](https://ffmpeg.org/) (download + thumbnail embed)
- [ImageMagick](https://imagemagick.org/) (`convert`, `identify`) — optional, for square thumbnail crop

## Setup

```bash
git clone https://github.com/bayonemt/ytmusic-tui
cd ytmusic-tui
npm install
```

### Authentication

```bash
npm run auth
```

Follow the on-screen instructions to link your Google account via OAuth2. Credentials are stored locally in `.auth.json` (never committed).

### Run

```bash
npm start
```

## Keybindings

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate list |
| `←` / `→` | Navigate feed sections |
| `Enter` | Play / select |
| `Space` | Pause / resume |
| `n` | Next track |
| `Ctrl+←` | Previous track |
| `+` / `-` | Volume up / down |
| `/` | Search |
| `h` | Home tab |
| `p` | Playlists tab |
| `l` | Queue tab |
| `Ctrl+O` | Track options (download, like, add to playlist) |
| `q` | Quit |

## How the hi-fi upgrade works

1. Track starts playing immediately from YouTube (via Innertube API, no yt-dlp delay)
2. In the background, the app searches for a better-quality stream on Qobuz, Tidal, JioSaavn, and SoundCloud
3. When a match is found, mpv is seamlessly restarted at the same position with the higher-quality URL
4. The quality badge in the player bar updates (e.g. `FLAC 24-bit`)

Matching uses title + artist + duration verification to avoid switching to the wrong song.

## License

MIT
