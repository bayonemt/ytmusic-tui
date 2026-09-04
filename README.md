# ytmusic-tui

A terminal-based YouTube Music player with automatic hi-fi audio upgrade and synchronized karaoke lyrics.

Plays music from YouTube Music via the Innertube API, then silently finds a higher-quality stream (Qobuz FLAC 24-bit → Tidal FLAC → JioSaavn 320kbps → SoundCloud) and switches mid-playback — no interruptions.

## Features

- **YouTube Music integration** — home feed, search, playlists, queue, liked songs
- **Auto hi-fi upgrade** — starts playing from YouTube, upgrades to the best available lossless source in the background
- **Hi-res cascade**: Qobuz FLAC 24-bit 192kHz → Qobuz FLAC 24-bit 96kHz → Tidal FLAC → JioSaavn MP3 320kbps → SoundCloud 256kbps
- **Karaoke lyrics** — syllable-by-syllable (Apple Music TTML · QQ Music · Kugou · Deezer), word-by-word, or line-by-line sync
- **Lyrics quality tags** — `≋` syllable · `≈` word · `♩` line — visible before playing, in all list views
- **Album art** — rendered in the terminal via Kitty Graphics Protocol
- **Download** — saves in the best available quality (FLAC when possible), with square-cropped cover art embedded
- **Like / add to playlist** via Innertube API
- **Configurable** — lyrics context lines and line emphasis via settings screen (`s`)
- **mpv** as the audio backend with IPC volume/seek control

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [mpv](https://mpv.io/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org/) (download + thumbnail embed)
- [ImageMagick](https://imagemagick.org/) (`convert`, `identify`) — optional, for square thumbnail crop

## Setup

```bash
git clone https://github.com/bayonemt/ytmusic-tui
cd ytmusic-tui/tui
npm install
```

### Authentication (optional)

```bash
npm run auth
```

Links your Google account via OAuth2 for personalized feed and playlists. Credentials stored locally in `.auth.json`. Search and playback work without login.

### Run

```bash
npm start
```

## Keybindings

| Key | Action |
|---|---|
| `↑` / `↓` | Navigate list |
| `←` / `→` | Navigate feed / seek ±10s |
| `Enter` | Play / select |
| `Space` | Pause / resume |
| `n` | Next track |
| `Ctrl+←` / `Ctrl+→` | Previous / next track |
| `+` / `-` | Volume up / down |
| `h` | Home |
| `/` | Search |
| `p` | Playlists |
| `l` | Queue |
| `L` | Lyrics (karaoke) |
| `s` | Settings |
| `a` | Login |
| `Ctrl+O` | Track options (download, like, add to playlist) |
| `q` | Quit |

## How the hi-fi upgrade works

1. Track starts playing immediately from YouTube (Innertube API, no yt-dlp delay)
2. In the background, the app searches for a better-quality stream on Qobuz, Tidal, JioSaavn, and SoundCloud
3. When a match is found, mpv is seamlessly restarted at the same position with the higher-quality URL
4. The quality badge in the player bar updates (e.g. `FLAC 24-bit 192kHz`)

## License

MIT
