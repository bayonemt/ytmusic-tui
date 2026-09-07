# ytmusic-tui — CLAUDE.md

Referência completa da arquitetura para o assistente. Leia antes de qualquer tarefa.

---

## Visão geral

TUI de YouTube Music escrito em **Node.js + TypeScript** com **Ink** (React para terminal).
Roda com `npm start` a partir de `tui/`. Repositório: `github.com/bayonemt/ytmusic-tui`.

**Stack**:
- Ink 6 + React 19 (render no terminal)
- tsx (executa TypeScript diretamente, sem build step)
- mpv (player de áudio, controlado via socket IPC)
- yt-dlp (extrai URLs de stream do YouTube)
- Python 3 + camoufox (browser auth via cookies)

---

## Estrutura de arquivos

```
tui/
  src/
    index.tsx           — App principal (2550 linhas): UI, state, keybindings
    player.ts           — Classe AudioPlayer (mpv via IPC socket)
    innertube.ts        — API YouTube Music (search, queue, playlists, like, history)
    browser-auth.ts     — Auth via cookies do browser (SAPISIDHASH, load/save)
    browser-auth-helper.py — Helper Python que abre camoufox e captura cookies
    hifi.ts             — Cascata de fontes HiFi (Qobuz→Arcod→Tidal→JioSaavn→SoundCloud)
    lyrics.ts           — Letras sincronizadas (7 providers em cascata)
    discord.ts          — Discord Rich Presence via IPC socket local
    download-worker.ts  — Worker de download (processo filho, HiFi → yt-dlp fallback)
    art.ts              — Arte do álbum (chafa: kitty/sixels/symbols, cache, semáforo)
    i18n.ts             — Internacionalização (pt/en/es/fr, interpolação, fallback)
    auth.ts             — Device flow OAuth (script separado: npm run auth)
  package.json
  .auth.json            — Tokens OAuth (device flow) — gitignored
  .browser-auth.json    — Cookies do browser (camoufox) — gitignored
  .browser-auth-tmp.json — Arquivo temporário durante login — deletado após uso
```

---

## Autenticação (dois sistemas)

### 1. Device Flow OAuth (`npm run auth`)
- Usado para: playlists do usuário, feed personalizado, `getLastPlayedItems`
- Salvo em: `tui/.auth.json` (`access_token`, `refresh_token`, `expires_at`)
- Refresh automático quando expirado
- Cliente: `861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com`
- **Limitação**: não funciona para like/unlike nem histórico real do YTM

### 2. Browser Auth via Camoufox (cookies)
- Usado para: curtir/descurtir, histórico de músicas
- Fluxo: TUI abre modal → `python3 browser-auth-helper.py <tmpfile>` → camoufox abre `music.youtube.com` → usuário loga → cookies capturados com `page.context.cookies()` → salvos em `.browser-auth.json`
- Salvo em: `tui/.browser-auth.json` (`cookieHeader`, `sapisid`, `savedAt`)
- **Por que camoufox**: Firefox padrão e Chromium são bloqueados pelo Google como automação; camoufox remove todos os marcadores de automação
- Cookies duram ~2 anos; SAPISID é de domínio `.youtube.com`

### SAPISIDHASH
```
SHA1("<timestamp> <SAPISID> https://music.youtube.com") → "SAPISIDHASH <timestamp>_<hash>"
```
**Sem sufixo `_u`** — com `_u` o Google rejeita com "Faça login para acessar seu histórico".

---

## Player (`player.ts`)

`AudioPlayer` estende `EventEmitter`. Controla o mpv via socket IPC Unix.

- **Socket**: `/tmp/ytmusic-mpv-<pid>.sock`
- **Posição**: estimada por `Date.now() - startTime`; calibrada 2x via `queryPosition()` (IPC real) em 1.5s e 4s após play
- **`switchUrl(url)`**: mata o mpv atual, sobe novo com `--start=<savedPos>` — necessário porque `loadfile` + seek tem problemas com streams MPD/DASH
- **Eventos emitidos**: `status` (a cada 1s ou em mudança de estado), `end` (quando mpv sai com código 0)

---

## Innertube (`innertube.ts`)

Três funções de request:
- `webRequest(endpoint, body, token?)` — WEB_REMIX sem auth ou com Bearer
- `androidRequest(endpoint, body)` — ANDROID_MUSIC com Bearer (yt-dlp para streams)
- `webRequestBrowser(endpoint, body, videoId?)` — WEB_REMIX com Cookie + SAPISIDHASH

**Headers do webRequestBrowser** (confirmados funcionando):
```
X-Youtube-Client-Name: 67
X-Youtube-Client-Version: 1.20260901.12.00
X-Goog-AuthUser: 0
Referer: https://music.youtube.com/watch?v=<videoId>  (para like/unlike)
Authorization: SAPISIDHASH <timestamp>_<hash>
Cookie: <cookies do .browser-auth.json>
```

**Endpoints usados**:
- `search` — busca músicas e artistas
- `browse` — feed home, playlists, artista, histórico (`FEmusic_history`)
- `next` — fila/rádio a partir de uma música
- `like/like` e `like/removelike` — curtir/descurtir
- `browse/edit_playlist` — adicionar à playlist

**Stream de áudio**: via `yt-dlp` com `android_vr` (rápido, falha em conteúdo exclusivo) → fallback `mediaconnect`. URLs expiram em ~6h; cache de 5h em `streamCache`.

---

## HiFi (`hifi.ts`)

Cascata em ordem de qualidade, cada fonte tenta match por título + artista + duração:

| Fonte | Qualidade | Método |
|-------|-----------|--------|
| Qobuz (kanjijewels proxy) | FLAC 24-bit até 192kHz | API key extraída do APK LastWave |
| Arcod (arcod.xyz) | FLAC 24-bit | API pública |
| Tidal (rhythmax worker) | FLAC Hi-Res / Lossless | Cloudflare Worker |
| JioSaavn | MP3 320kbps | API pública + DES-ECB local |
| SoundCloud | 256kbps | yt-dlp scsearch |

`findBestStream(title, artist, durationMs, signal, onFound)` — chama `onFound` com o primeiro resultado e retorna. Abortável via `AbortSignal`.

`titlesMatch` / `artistsMatch` / `durationsMatch` — matching fuzzy que evita falsos positivos. Títulos curtos (≤6 chars) exigem match exato.

---

## Letras (`lyrics.ts`)

Cascata de 7 providers (syllable → word → line-level):

1. **BetterLyrics** (`lyrics-api.boidu.dev`) — TTML Apple Music syllable
2. **Paxsenix** (`lyrics.paxsenix.org`) — word-level Apple Music via iTunes Search
3. **Beautiful Lyrics Reborn** (`lyrics.txw.qzz.io`) — syllable (QQ/Apple/Deezer) + line
4. **LyricsPlus** (3 mirrors) — syllable Apple + word Musixmatch
5. **Musixmatch** — richsync word-level (trial token auto-gerenciado) → subtitle LRC
6. **LRCLib `/api/get`** — match exato por título + artista + duração
7. **LRCLib `/api/search`** — busca com scoring por artista e duração

Formatos parseados: TTML (`parseTtml`), LRC word-level/line-level (`parseLrc`), JSON proprietário de cada provider.

---

## UI (`index.tsx`)

### Abas (NavTab)
`home | search | playlists | queue | lyrics | settings | auth | history`

Teclas globais:
- `h` home, `/` search, `p` playlists, `l` queue, `L` lyrics, `s` settings, `a` auth, `H` history
- `Space` pause/play, `n` próxima, `k` curtir/descurtir, `q` toggle HiFi
- `+`/`-` volume, `←`/`→` seek ±10s (fora da home e settings)
- `Ctrl+O` menu de contexto, `Ctrl+↑` / `Esc` sai do fullscreen

### Componentes principais
- `PlayerBar` — barra inferior sempre visível; mostra ♥/♡ (like), qualidade HiFi, volume, progress
- `HomeScreen` — feed por seções (Ouvir de novo, playlists, home YTM)
- `SearchScreen` — busca com resultado de músicas e artistas
- `ArtistScreen` — top songs + albums + singles do artista
- `FullscreenLyrics` — letras em fullscreen com arte do álbum (Kitty/sixels/symbols)
- `ContextMenu` — menu Ctrl+O: Curtir, Baixar, Adicionar a playlist, Não tenho interesse
- `SettingsScreen` — abas Letras / Idioma / Player
- `BrowserLoginModal` — modal para iniciar login via camoufox
- `HistoryScreen` — histórico de músicas (requer browser auth)

### Configuração (`~/.yt-music-config.json`)
```typescript
interface AppConfig {
  lyrics:   { contextLines, bigCurrentLine, dimAdjacentLines, letterSpacing, syncOffsetMs }
  language: { uiLang: 'pt'|'en'|'es'|'fr', lyricsLang: 'auto'|'en'|'pt'|... }
  player:   { hifiEnabled: boolean }
}
```

### HiFi toggle on-the-fly
- `ytdlpUrl` ref salva a URL original do yt-dlp antes do HiFi substituir
- Tecla `q`: se HiFi ativo → `player.switchUrl(ytdlpUrl.current)` + `setHifiQuality(null)`; se inativo → chama `findBestStream` novamente
- Settings Player → `hifiEnabled: false` desativa a busca HiFi no início de cada música

---

## Arte do álbum (`art.ts`)

- Detecta formato do terminal: `kitty` (TERM=xterm-kitty), `sixels` (VTE≥6400 / xterm), `symbols` (fallback)
- Usa `chafa` para converter JPG → escape codes
- Center-crop para quadrado com ImageMagick (`identify` + `convert`) antes do chafa
- Cache em memória + semáforo (3 slots concorrentes) para não travar o event loop
- Kitty: injeta `i=<id>` no APC para reusar imagem na memória do terminal (`a=p,i=<id>`)
- Thumbnail: `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg` (Discord usa `hqdefault`, download usa `mqdefault`)

---

## Discord Rich Presence (`discord.ts`)

Implementação nativa do protocolo IPC (sem lib externa).
- Socket: `$XDG_RUNTIME_DIR/discord-ipc-N` (também testa Flatpak/Snap/`/tmp`)
- Reconecta a cada 30s se desconectado
- Activity: `details` = título, `state` = artista, `large_image` = URL do thumbnail hqdefault, `large_text` = "Título · Artista"
- Client ID: `1546318252966420480`

---

## Download (`download-worker.ts`)

Processo filho spawned pelo ContextMenu. Fluxo:
1. `findBestStream` com timeout 20s
2. Se HiFi encontrado: `ffmpeg -i <url> -c:a copy` → `.flac`/`.m4a`/`.mp3`
3. Fallback: `yt-dlp -x --audio-format mp3`
4. Embed thumbnail: `metaflac` (FLAC) ou `ffmpeg` com `-map 1:v -c:v mjpeg` (MP3/M4A)
5. Status comunicado via `/tmp/ytmusic-dl-<videoId>.status` (JSON lido pelo TUI a cada 500ms)

---

## i18n (`i18n.ts`)

- Tipo: `Lang = 'pt' | 'en' | 'es' | 'fr'`
- Cada chave: `{ pt: string; en: string; es?: string; fr?: string }`
- `t(key, vars?)` — interpola `{placeholder}` com `vars`, fallback `en`, fallback `key`
- `setLang(lang)` — muda o idioma global

---

## Pontos importantes / armadilhas

- **Commits**: nunca adicionar `Co-Authored-By` nem atribuição do Claude. Só `bayonemt`.
- **SAPISIDHASH**: sem `_u` no final. Com `_u` retorna "Faça login" mesmo com cookies válidos.
- **Camoufox**: usar `page.context.cookies()`, não `browser.cookies()` (não existe). SAPISID está em `.youtube.com`, não `.google.com`.
- **Firefox/Chromium bloqueados**: o Google bloqueia automação. Só o camoufox passa.
- **`switchUrl`**: necessário matar e reusar mpv com `--start=N`; `loadfile` + seek não funciona com streams DASH.
- **`/guest` no edusp**: retorna 200 mas body vazio — nunca usar como vetor de teste.
- **CPU do Pedro**: i5-6600, sem SHA-NI/AVX-512. Binários com SHA de hardware crasham com SIGILL.
