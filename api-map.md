# YouTube Music — Mapeamento da API Innertube (APK 9.26.56)

## Stack do App
- **Linguagem:** Kotlin/Java nativo (Android)
- **Framework:** Nenhum — sem Flutter, React Native, Xamarin
- **Networking:** libcronet (Chromium-based HTTP/2 + QUIC)
- **API:** Innertube v1
- **Ofuscação:** ProGuard/R8 agressivo (campos renomeados para letras)

---

## Base URL
```
POST https://music.youtube.com/youtubei/v1/{endpoint}
```

Headers obrigatórios:
```
X-Goog-Api-Key: {key}
Content-Type: application/json
```

Ou como query param: `?key={key}`

### API Keys por cliente (extraídas do APK):
| Cliente | API Key |
|---------|---------|
| `ANDROID_MUSIC` (Android APK) | `AIzaSyAOghZGza2MQSZkY_zfZ370N-PUdXEo8AI` |
| `WEB_REMIX` (browser/TUI) | `AIzaSyC9XL3ZjWddXya6X74dJoCTL-KVIS-GHjc` |

**Nota:** A key ANDROID_MUSIC está hardcoded em `vpj.java:107`.  
Adicionada via query param `?key=...` por padrão (feature flag pode mudar para header).  
O campo `asig` (query param adicional) vem de `aeza.mo8266e("")` — provavelmente vazio no default.

---

## Client Context (body base de toda request)

### Estrutura JSON mínima (WEB_REMIX)
```json
{
  "context": {
    "client": {
      "clientName": "WEB_REMIX",
      "clientVersion": "1.20240101.01.00",
      "hl": "pt-BR",
      "gl": "BR"
    }
  }
}
```

### Estrutura JSON completa (ANDROID_MUSIC — conforme `vnr.java`)
```json
{
  "context": {
    "client": {
      "clientName": "ANDROID_MUSIC",
      "clientVersion": "9.26.56",
      "clientId": 21,
      "hl": "pt-BR",
      "gl": "BR",
      "osName": "Android",
      "osVersion": "11",
      "androidSdkVersion": 30,
      "platform": "MOBILE",
      "deviceMake": "Google",
      "deviceBrand": "google",
      "deviceModel": "Pixel 6",
      "utcOffsetMinutes": -180,
      "timeZone": "America/Sao_Paulo",
      "userInterfaceTheme": "USER_INTERFACE_THEME_DARK",
      "visitorData": "..."
    }
  }
}
```

### Todos os clients identificados no APK (enum `akhq.java`)
| Client Name | ID |
|-------------|-----|
| `ANDROID_MUSIC` | 21 |
| `ANDROID_MUSIC_AOSP` | 104 |
| `WEB_REMIX` | 67 |
| `IOS_MUSIC` | 26 |
| `WEB` | 1 |
| `ANDROID` | 3 |
| `IOS` | 5 |
| `TVHTML5` | 7 |
| `TVANDROID` | 10 |
| `AGENTIC_INTEGRATIONS` | 109 |
| *(50+ clientes totais — ver akhq.java)* | |

### Assembly do ClientInfo (vnr.java — rastreado no APK)
Campos preenchidos em `vnr.m46079c()`:
- `f80894h` (hl) = `Locale.getDefault().toLanguageTag()` → ex: `"pt-BR"`
- `f80901o` (clientId) = enum int (21 para ANDROID_MUSIC)
- `f80903q` (clientVersion) = string versão (ex: `"9.26.56"`)
- `f80909w` (osVersion) = `Build.VERSION.RELEASE` → ex: `"11"`
- `f80902p` (androidSdkVersion) = `Build.VERSION.SDK_INT` → ex: 30
- `f80908v` (osName) = `"Android"` / `"Android Wear"` / `"Android Automotive"` / `"ChromeOS"`
- `f80869J` (platform enum) = 5 (MOBILE) — mapeado de forma interna
- `f80910x` (deviceFingerprint?) = `sjp.m42547aU()` — string de fingerprint
- `f80904r` (deviceMake) = `Build.MANUFACTURER`
- `f80905s` (deviceBrand) = `Build.BRAND`
- `f80906t` (deviceModel) = `Build.MODEL`
- `f80873N` (utcOffsetMinutes) = `TimeZone.getDefault().getOffset(nowMs) / 60000`
- `f80874O` (timeZone) = `TimeZone.getDefault().getID()` → ex: `"America/Sao_Paulo"`
- `f80876Q` (userInterfaceTheme) = `USER_INTERFACE_THEME_DARK` enum

Campos de `vnr.m46077a()` (decoração music-specific):
- `f80875P` (musicContext / amco) = sub-proto com subscription status, premium flags
- `f80883X` (contentLabelFilter) = aixm proto (label filter configs)

---

## Campos comuns em toda request (via classe base `vni`)
Todo request envia, além dos campos específicos:
- `serviceName` — nome do endpoint
- `clickTrackingParams` — bytes base64 (rastreamento de UI)
- `identity` — identidade do usuário

---

## CPN — clientPlaybackNonce (cadeia completa rastreada)

**CPN** é um nonce de 16 caracteres enviado no request `player` para rastreamento de sessão.

### Cadeia de geração (100% rastreada no APK):
```
wzv.m48164cH(str, ...) ← str = teh.m43569a()
  └─ teh.m43569a()
       └─ vag.m45295k(12)
            ├─ bArr = new byte[12]
            ├─ Random.nextBytes(bArr)     ← java.util.Random (NÃO SecureRandom!)
            └─ Base64.encodeToString(bArr, 10)
                        flag 10 = NO_WRAP(2) | URL_SAFE(8)
```

**Resultado:** 16 caracteres URL-safe base64 sem padding  
**Charset:** `A-Za-z0-9-_` (substituição URL: `+→-`, `/→_`)  
**Por que 16 chars:** 12 bytes × (4/3) = 16 — divisível por 3, sem padding `=`

### Implementação TypeScript equivalente:
```typescript
import crypto from 'crypto';
function generateCPN(): string {
  const bytes = crypto.randomBytes(12);
  return bytes.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
```

### Onde é usado no request:
- Campo `clientPlaybackNonce` do proto `akox` (player request — `aarh.java`)
- Campo `f139526b` de `vrf.java` (mesmo valor)
- Aparece no log: `"cueid.X;lact.Y;luar.Z;cpn.{CPN}"` (string de telemetria)

---

## playbackContext (proto `angc` — campos rastreados via `aarh.java` + `rwy.java`)

O proto `angc` representa o `playbackContext` enviado no request player.  
Populado via `rwy.java` e `rwx.java` usando dados de `rnt.java`:

| Campo obfuscado | Tipo | Nome semântico | Valor |
|-----------------|------|----------------|-------|
| `f46447c` | int | `signatureTimestamp` | `ceil((nowMs - lastAdsMs) / 1000)` — tempo desde último ad em segundos |
| `f46448d` | long | `startTimeSecs` / elapsed | offset de tempo do ad atual |
| `f46449e` | int | adState | estado do ad (`aaopVar.m1502a()`) |
| `f46450f` | int | watchTime | tempo de watch |
| `f46451g` | int | adFrequency | `aanhVar.m1355c().f1630i` |
| `f46452h` | int | field h | |
| `f46453i` | int | field i | |
| `f46454j` | int | field j | sempre enviado (default 0) |
| `f46455k` | bool | field k | bool, default false |
| `f46456l` | bool | lacksFirstAdParams | bool |
| `f46457m` | String | `html5Preference` | `"sdkv=X&output=xml_vast2"` — versão SDK de ads |
| `f46458n` | bool | field n | bool |
| `f46459o` | ange | sub-proto | presente quando `f2006ae != null` |

**Nota importante:** `signatureTimestamp` no Android NÃO é o mesmo que o `sts` do JS player web.  
No Android é tempo desde último ad em segundos, calculado por `rnt.m41639a()`.  
Para TUI via WEB_REMIX: usar o `sts` da resposta do player JS ou omitir.

### `html5Preference` gerado por `rna.m41605d()`:
```java
"sdkv=" + sdkVersion + "&output=xml_vast2"
// Exemplo: "sdkv=3&output=xml_vast2"
```

---

## Arquitetura de Streaming (descoberta no APK)

O app Android usa um **proxy HTTP local** (`aatc.java`) para servir streams ao ExoPlayer:
1. URLs de stream da resposta player são assinadas via `aatg.m1862a()` (cipher RSA/AES)
2. ExoPlayer lê de `http://localhost:{port}/path?sig={assinatura}&sparams={params}`
3. O proxy local decodifica e faz o request real ao CDN do YouTube

**Para o TUI (WEB_REMIX):** URLs são retornadas pré-assinadas — não precisa de proxy local!  
Basta fazer GET na `url` do adaptiveFormat escolhido.

**Expiração:** URLs expiram — campo `expiresInSeconds` no streamingData.  
Renovar com `player/refresh` antes da expiração.

---

## Endpoints Completos (115+ identificados)

### Player / Reprodução

| Endpoint | Params identificados |
|----------|---------------------|
| `player` | `videoId`, `contentCheckOk` (bool), `racyCheckOk` (bool), `playlistId`, `playlistIndex` (int), `startTimeSecs` (int), `playerParams` (String base64), `clientPlaybackNonce` (CPN 16 chars), `playerConfig` (akoy), `serviceIntegrityDimensions` (aohg), `streamingContext` (angg) |
| `player/refresh` | `cpn` (String), `videoIds[]` (list), `includeStreamingData` (bool, sempre true), `includeMetadata` (bool) |
| `player/heartbeat` | `videoId` (str), `cpn` (str), `sequenceNumber` (int), `playbackQualityConfig` (sub-proto: apvd com ints) |
| `player/get_drm_license` | — (DRM license request) |
| `player/ad_break` | — |
| `next` | `videoId`, `playlistId`, `params`, `isAudioOnly`, `playlistIndex`, `continuation`, `watchNextType`, `playerTimestamp`, `adParams`, `captionsRequested`, `forceAdGroupId`, `isAdPlayback`, `mdxUseDevServer`, `serializedThirdPartyEmbedConfig`, `lastAudioTurnedOnInlinePlaybackId`, `lastAudioTurnedOffInlinePlaybackId`, `lastScrubbedInlinePlaybackId` |
| `get_watch` | — |

### Browse / Navegação

| Endpoint | Params identificados |
|----------|---------------------|
| `browse` | `browseId`, `params`, `continuation`, `language`, `formData`, `genericFormData`, `filteredBrowseParamsFormData`, `genres`, `moods`, `offline`, `liteClientState`, `rawDeviceId`, `query`, `musicBrowseRequestDeepLinkUrl`, `extendedPermissions`, `browseNotificationsParams`, `producerAssetRequestDataCategory`, `producerAssetRequestDataMusicParams` |
| `browse/edit_playlist` | `browseId`, `playlistId`, `params` (proto pré-buildado) |
| `home` | — (sem params extras) |
| `home_with_thumbnails` | — |
| `navigation/resolve_url` | `uri` |

### Busca

| Endpoint | Params identificados |
|----------|---------------------|
| `search` | `query` (String), `params` (String base64 — tipo de resultado), `continuation` (String — token de paginação), `filterOptions` (akqj proto serializado), `genericFormData` (ajuc proto, opcional), `musicSearchRequestType` (int enum), `conversationId` (null), `pageType` (akqy enum) |
| `search/get_suggestions` | `input`, `params` |
| `music/get_search_suggestions` | `input`, `params` |
| `get_user_mention_suggestions` | — |
| `get_playlist_filter_search_metadata` | `params` (1 string field) |

### Música

| Endpoint | Params identificados |
|----------|---------------------|
| `music/get_queue` | `videoIds[]`, `playlistId`, `params` |
| `music/get_music_commentary` | — |
| `music/delete_privately_owned_entity` | — |
| `music/radio_availability` | — |

### Playlists

| Endpoint | Params identificados |
|----------|---------------------|
| `playlist/create` | `title`, `videoIds[]`, `privacyStatus` (int), `description` (opcional) |
| `playlist/delete` | `playlistId` |
| `playlist/get_add_to_playlist` | `videoIds[]` OU `videoId` (exclusivos), `context` |
| `playlist/get_settings_editor` | — |
| `playlist/get_generated_thumbnails` | — |
| `playlist/get_suggested_playlist_videos` | — |
| `playlist/poll_playlist_freshness` | `playlistId`, `params`, `continuation` |
| `get_playlist_filter_search_metadata` | `params` |

### Interações

| Endpoint | Params identificados |
|----------|---------------------|
| `like/like` | `target` (entity), `clickTrackingParams` |
| `like/dislike` | `target` (entity), `clickTrackingParams` |
| `like/removelike` | `target` (entity), `clickTrackingParams` |
| `subscription/subscribe` | `channelIds[]`, `channelId`, `params` |
| `subscription/unsubscribe` | `channelIds[]`, `channelId`, `params` |
| `flag/flag` | — |
| `flag/get_form` | — |
| `feedback` | — |
| `submit_form` | — |

### Comentários

| Endpoint | Params identificados |
|----------|---------------------|
| `comment/create_comment` | `commentText` (String), `videoId` (String), `isSupportComment` (bool), `timestamp` (long), `stickerId` (int), `parentCommentId` (String), `type` (oneof: text/sticker/emoji) |
| `comment/create_comment_reply` | — |
| `comment/get_comments` | `videoId` (str f), `continuation` (str d), `params` (str e), `commentsToken` (str g) |
| `comment/update_comment` | — |
| `comment/update_comment_reply` | — |
| `comment/perform_comment_action` | `actions[]` (lista de ações) |

### Compartilhar

| Endpoint | Params identificados |
|----------|---------------------|
| `share/get_share_panel` | `serializedSharedEntity`, `serviceName`, `sheetId`, `clientParams`, `installedSharingServiceIds[]`, `androidInstalledSharingServices[]` |
| `share/get_sharing_provider_data` | — |
| `share/send_share` | — |
| `share/submit_share_engagement` | — |

### Notificações

| Endpoint | Params identificados |
|----------|---------------------|
| `notification/opt_out` | — |
| `notification/record_interactions` | — |
| `notification/add_upcoming_event_reminder` | `videoId` (String) |
| `notification/remove_upcoming_event_reminder` | `videoId` (String) |
| `notification_registration/set_registration` | — |

### Conta

| Endpoint | Params identificados |
|----------|---------------------|
| `account/accounts_list` | — |
| `account/get_setting` | `settingKey` (String), `networkInfo`, `deviceInfo` |
| `account/set_setting` | — |
| `get_survey` | — |
| `oauth/consent` | — |

### MDX (Media Remote Control / Cast)

| Endpoint | Params identificados |
|----------|---------------------|
| `mdx/get_active_devices` | — (sem params, proto externo) |
| `mdx/get_streaming_active_devices` | — |
| `mdx/handoff` | — (proto externo) |
| `mdx/remote_control` | `mdx_command`, `start_channel_type`, `end_channel_type`, `method_start`, `method_received` |
| `mdx_cast` | — |
| `mdx_command` | — |

### Live Chat

| Endpoint | Params identificados |
|----------|---------------------|
| `live_chat/get_live_chat` | `videoId` (str), `isMuted` (bool), `isLiveInteractivity` (bool), `isSubscribed` (bool) |
| `live_chat/get_live_interactivity` | (mesmo arquivo que get_live_chat) |
| `live_chat/get_live_chat_replay` | `videoId` (str), `continuation` (proto algx) |
| `live_chat/get_item_context_menu` | `params` (ahbo), `context` |
| `live_chat/get_live_chat_message_buy_flow` | — |
| `live_chat/moderate` | — |
| `live_chat/send_message` | `richMessage` (oneof: text/sticker), `clientMessageId` (long), `params` (ahbo) |

### Offline

| Endpoint | Params identificados |
|----------|---------------------|
| `offline` | — |
| `offline/auto_offline` | — |
| `offline/get_playback_data_entity` | — |
| `offline/get_video_entity` | — |
| `offline/offline_video_playback_position_sync` | — |
| `offline/playlist_sync_check` | — |

### Shorts

| Endpoint | Params identificados |
|----------|---------------------|
| `shorts/get_shorts_source_video` | `videoId` (str d), `params` (str e), `format` (int g), `assets` (list h) |
| `shorts/get_shorts_creation` | `currentlyPlayingVideoId`, `availableAssets`, `packages[]` |

### Canais

| Endpoint | Params identificados |
|----------|---------------------|
| `channel/create_channel` | — |
| `channel/get_channel_creation_form` | — |
| `channel_edit/update_channel_page_settings` | — |
| `channel_edit/validate_channel_handle` | — |

### Media Browser (Android Auto / Wear OS)

| Endpoint | Params identificados |
|----------|---------------------|
| `ytm_media_browser/get_media_item_children` | — |
| `ytm_media_browser/get_root_media_items` | — |
| `ytm_media_browser/search_media_items` | — |

### YPC (Compras / Premium)

| Endpoint | Params identificados |
|----------|---------------------|
| `ypc/get_cart` | — |
| `ypc/complete_transaction` | — |
| `ypc/get_payment_instruments_params` | — |
| `ypc/get_fix_instrument_params` | — |
| `ypc/get_offline_upsell` | — |
| `ypc/commerce_action` | — |
| `ypc/handle_transaction` | — |
| `ypc/pause_subscription` | — |
| `ypc/resume_subscription` | — |
| `ypc/cancel_recurrence` | — |

### Geo / Localização

| Endpoint | Params identificados |
|----------|---------------------|
| `geo/place_autocomplete` | `input` (str, obrigatório — validado no código) |

### Upload / Criação

| Endpoint | Params identificados |
|----------|---------------------|
| `upload/create_user_media` | — |
| `video_effects/get_dynamic_creation_asset` | — |
| `video_effects/get_multi_page_sticker_catalog` | — |
| `video_effects/swazzle_assets` | — |

### Assets / Recursos

| Endpoint | Params identificados |
|----------|---------------------|
| `asset/get_asset` | — |

### Busca por Voz

| Endpoint | Params identificados |
|----------|---------------------|
| `assistant` | `query` (String), `isVideoCurrentlyPlaying` (bool — se videoId atual), `isAdPlaying` (bool, sempre false), `f139535d` (ahbo — áudio bytes), `f139536e` (ahbo — bytes) |

### DRM

| Endpoint | Params identificados |
|----------|---------------------|
| `player/get_drm_license` | — (DRM license request) |
| `associated_videos` | — (DRM: resposta `drmAssociatedVideos`) |
| `drm_gk_f`, `drm_gk_s` | Google Key DRM fetch/save |
| `drm_kr_f`, `drm_kr_s` | Key Renewal DRM |
| `drm_net_r`, `drm_net_s` | Network DRM |
| `drm_os_f`, `drm_os_s` | OS DRM |

### Telemetria

| Endpoint | Params identificados |
|----------|---------------------|
| `log_event` | str (URL?), bool — endpoint de telemetria/analytics |
| `att/log` | — (attestation log) |

### Outros

| Endpoint | Params identificados |
|----------|---------------------|
| `sideloaded/play` | — (playback de conteúdo externo) |
| `setup/send_log_report` | — |
| `updated_metadata` | `videoId` (str e), `playlistId` (str d), `contextParams` (bytes g), `sub-proto f` |
| `visitor_id` | — (retorna um novo visitor_id; proto `akss`) |
| `att/get` | z (auth bool), str (deviceId?), bool — attestation device |
| `reel/reel_item_watch` | — |
| `reel/reel_watch_sequence` | — |
| `config` | — |

---

## BrowseIds conhecidos (para o endpoint `browse`)

```
FEmusic_home                            → Home
FEmusic_liked_videos                    → Músicas curtidas
FEmusic_library_privately_owned_playlists → Playlists da biblioteca
FEmusic_history                         → Histórico
FEmusic_charts                          → Charts
FEmusic_moods_and_genres               → Mood/Gênero
UC...                                   → Canal/Artista
PL...                                   → Playlist pública
VL...                                   → Playlist da biblioteca
MPRE...                                 → Album/Single
```

---

## Params Base64 conhecidos (para `search`)

Cada tipo de busca usa um `params` base64 diferente:
```
songs     → Eg-KAQQIARAAGAAgASgAMABqChAEEAMQCRAFEBU%3D
videos    → Eg-KAQQIARABGAAgASgAMABqChAEEAMQCRAFEBU%3D
albums    → Eg-KAQQIAhABGAAgASgAMABqChAEEAMQCRAFEBU%3D
artists   → Eg-KAQQIAxABGAAgASgAMABqChAEEAMQCRAFEBU%3D
playlists → Eg-KAQQIBBABGAAgASgAMABqChAEEAMQCRAFEBU%3D
```

---

## Resposta do `player` — StreamingData (rastreado via `StreamingDataOuterClass$StreamingData.java` + `ajui.java`)

### StreamingData (`StreamingDataOuterClass$StreamingData`) — proto completo:
| Campo obfuscado | Proto Field | Tipo | Nome semântico |
|-----------------|-------------|------|----------------|
| `f81059d` | 1 | long | **expiresInSeconds** — expiração das URLs |
| `f81060e` | 2 | List\<ajui\> | **formats** (progressive: áudio+vídeo juntos) |
| `f81061f` | 3 | List\<ajui\> | **adaptiveFormats** (separados: áudio OU vídeo) |
| `f81062g` | 16 | List | drmFormats |
| `f81063h` | 4 | String | **dashManifestUrl** |
| `f81064i` | 5 | String | **hlsManifestUrl** |
| `f81065j` | 7 | String | outro manifest URL |
| `f81066k` | 14 | String | outro URL |
| `f81067l` | 15 | String | **serverAbrStreamingUrl** |
| `f81068m` | 17 | List\<int\> | lista de IDs |

### Formato individual (`ajui` — cada adaptiveFormat) — campos completos:
| Campo obfuscado | Tipo | Nome semântico | Notas |
|-----------------|------|----------------|-------|
| `f29375c` | int | formatFlags | bitmask interno (NOT itag) |
| `f29377e` | int | **itag** | ex: 140, 251 |
| `f29378f` | String | **url** | URL direta do stream (CDN Google) |
| `f29379g` | String | **mimeType** | ex: `"audio/webm; codecs=\"opus\""` |
| `f29380h` | int | **maxBitrate** | bps máximo |
| `f29381i` | int | **averageBitrate** | bps médio |
| `f29382k` | int | **width** | pixels (0 para áudio-only) |
| `f29383l` | int | **height** | pixels (0 para áudio-only) |
| `f29384m` | int | **fps** | frames/seg (0 para áudio-only) |
| `f29385n` | ajuj | **initRange** | {start, end} bytes |
| `f29386o` | ajuj | **indexRange** | {start, end} bytes |
| `f29387p` | long | **contentLength** | bytes totais |
| `f29388q` | long | **approxDurationMs** | duração em ms |
| `f29389r` | String | **qualityLabel** | ex: `"tiny"`, `"medium"`, `"hd720"` |
| `f29367I` | int | **audioQuality** | enum de qualidade (AUDIO_QUALITY_LOW/MEDIUM/HIGH) |
| `f29392u` | int | audioSampleRate | taxa de amostragem (via C0000a.m78az) |
| `f29394w` | int | audioChannels | número de canais (via C0000a.m68ap: 0→1, 1→2, 2→3) |
| `f29360B` | double | loudnessDb | loudness em dB |

### Filtragem de streams de áudio para TUI:
```typescript
// Filtrar apenas streams de áudio da resposta player:
const audioFormats = adaptiveFormats.filter(f =>
  f.mimeType.startsWith('audio/')
);

// Itags de áudio comuns:
// 140 = audio/mp4 AAC  ~128kbps
// 141 = audio/mp4 AAC  ~256kbps
// 251 = audio/webm Opus ~160kbps (melhor qualidade)
// 250 = audio/webm Opus ~70kbps
// 249 = audio/webm Opus ~48kbps
// 774 = audio/webm Opus ~256kbps (alta qualidade)
```

---

## Autenticação

O app usa **SAPISIDHASH** (cookie-based) e **OAuth2** para requests autenticados.  
O header de auth é: `Authorization: SAPISIDHASH {timestamp}_{hash}`

Para requests de leitura pública: sem auth.  
Para interações (like, subscribe, playlist): auth obrigatória.

---

## Headers HTTP completos (rastreados em `ply.java` + `pfq.java`)

```
X-Goog-Visitor-Id: {visitorId}
X-Goog-PageId: {pageId}
X-Goog-Fitbit-Oauth-Token: {token}     ← Google Fit integration
X-Goog-Api-Key: AIzaSyC9XL3ZjWddXya6X74dJoCTL-KVIS-GHjc
X-Goog-Spatula: {spatula}              ← device attestation
X-Android-Cert: {sha1_cert}           ← APK signing cert hash
X-Android-Package: com.google.android.apps.youtube.music
Authorization: Bearer {oauth_token}   ← OAuth2 (yxy.java)
Content-Type: application/json
User-Agent: com.google.android.apps.youtube.music/{version}
```

### OAuth Bearer Token (via `yxy.java`):
```java
// yxy.java — returna Optional<Pair<"Authorization", "Bearer " + token>>
return Optional.of(Pair.create("Authorization", "Bearer " + f149728c));
```

---

## Estrutura do `player` request (completa — proto `akox` + `angg`)

### Request body mínimo para WEB_REMIX:
```json
{
  "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.20240101.01.00" } },
  "videoId": "dQw4w9WgXcQ",
  "contentCheckOk": true,
  "racyCheckOk": true
}
```

### Proto `akox` — campos do request player (rastreados em `aarh.java`):
| Campo (obfuscado) | Tipo | Nome semântico |
|-------------------|------|----------------|
| `f35002d` | String | `videoId` |
| `f35003e` | bool | `contentCheckOk` |
| `f35004f` | bool | `racyCheckOk` |
| `f35005g` | angg | `streamingContext` (container) |
| `f35006h` | bool | `forceSSL` |
| `f35007i` | String | `playlistId` |
| `f35008j` | int | `playlistIndex` (quando playlistId presente) |
| `f35009k` | int | `startTimeSecs` (em segundos, de Duration) |
| `f35010l` | String | `playerParams` (base64) |
| `f35011m` | List | `adSignalsInfo` list |
| `f35012n` | String | `clientPlaybackNonce` (CPN — 16 chars) |
| `f35013o` | akoy | `playerConfig` |
| `f35014p` | aohg | `serviceIntegrityDimensions` |

### Proto `angg` — streamingContext (container do playbackContext):
| Sub-proto | Campo | Tipo |
|-----------|-------|------|
| `angc` | `f46473c` | playbackContext (adSignals + timestamps) |
| `ahph` | `f46474d` | adBreakHeartbeat context |
| `angh` | `f46475e` | sub-proto |
| `angj` | `f46476f` | contentPlaybackNonce? |
| `angf` | `f46477g` | clientPlaybackContext (watchType + adSignal) |
| `angi` | `f46478h` | sub-proto |
| `angd` | `f46479i` | adFormats |

### Proto `angf` — clientPlaybackContext:
- `f46468c` = watchType (int enum, -1 offset, obrigatório)
- `f46469d` = adSignal (int)
- `f46470e` = String (opcional)

---

## Sessão 2: Descobertas Adicionais em Profundidade

### watchNextType enum (`aktj`) — tipos de operação no endpoint `next`:
| Valor | Constante | Descrição |
|-------|-----------|-----------|
| 2 | `WATCH_NEXT_TYPE_MUSIC_QUEUE_ADD_OPERATION` | Adicionar à fila |
| 3 | `WATCH_NEXT_TYPE_SKIP_VIDEO` | Pular vídeo |
| 4 | `WATCH_NEXT_TYPE_GET_QUEUE` | Obter fila |
| 5 | `WATCH_NEXT_TYPE_MUSIC_SHUFFLE` | Embaralhar |
| 6 | `WATCH_NEXT_TYPE_MUSIC_UNSHUFFLE` | Desembaralhar |
| 7 | `WATCH_NEXT_TYPE_QUEUE_ONLY` | Somente fila |

### Continuation Token
- Interface `abit.mo3377c()` retorna o token string
- `vni.f139059i` = o campo `continuation` enviado nos requests
- Enum `aopz` (tipos de continuation p/ biblioteca local):
  - `SIDELOADED_LIBRARY_RELOAD_CONTINUATION_TOKEN_TRACKS` (1)
  - `SIDELOADED_LIBRARY_RELOAD_CONTINUATION_TOKEN_PLAYLISTS` (2)
  - `SIDELOADED_LIBRARY_RELOAD_CONTINUATION_TOKEN_ALBUMS` (3)
  - `SIDELOADED_LIBRARY_RELOAD_CONTINUATION_TOKEN_ARTISTS` (4)
- Para browse/search normal: token é opaque string retornada pela API em `continuationItemRenderer.continuationEndpoint.continuationCommand.token`

### Base URLs do Innertube (enum `vbn`):
| Ambiente | URL Base |
|----------|----------|
| **PRODUCTION** | `https://youtubei.googleapis.com` |
| AUTOPUSH | `https://green-youtubei.sandbox.googleapis.com` |
| STAGING | `https://release-youtubei.sandbox.googleapis.com` |
| TEST | `https://test-youtubei.sandbox.googleapis.com` |

**Nota**: Para WEB_REMIX TUI, usar `https://music.youtube.com/youtubei/v1/{endpoint}`  
Para ANDROID_MUSIC, usar `https://youtubei.googleapis.com/youtubei/v1/{endpoint}`

### OAuth2 / Autenticação
- **Scopes Android** (classe `rbf`):
  ```
  Set 1 (normal): "https://www.googleapis.com/auth/youtube"
                  "https://www.googleapis.com/auth/youtube.force-ssl"
  Set 2 (com identity): + "https://www.googleapis.com/auth/identity.lateimpersonation"
  ```
- **Format do token scope**: `"oauth2:" + scopes.join(" ")`
- **Bearer token**: `"Authorization: Bearer <access_token>"` (classe `yxy`)
  - Domínios permitidos: `*.google.com`, `*.googleapis.com`, `*.youtube.com`, `*.googleusercontent.com`
- **Android usa AccountManager/GMS** para obter o token (não serve para TUI desktop)
- **Para TUI Node.js**: usar OAuth2 Device Flow com os scopes acima

### Todos os browseIds do YouTube Music
| browseId | Descrição |
|----------|-----------|
| `FEmusic_home` | Feed principal (Home) |
| `FEmusic_explore` | Explorar |
| `FEmusic_new_releases` | Novos lançamentos |
| `FEmusic_new_releases_albums` | Novos álbuns |
| `FEmusic_new_releases_videos` | Novos vídeos musicais |
| `FEmusic_moods_and_genres` | Humor e gêneros |
| `FEmusic_moods_and_genres_category` | Categoria específica de humor/gênero |
| `FEmusic_charts` | Paradas musicais |
| `FEmusic_non_music_audio` | Podcasts/áudio não-musical |
| `FEmusic_top_non_music_audio_episodes` | Top episódios |
| `FEmusic_top_non_music_audio_shows` | Top shows |
| `FEmusic_hashtag` | Hashtag |
| `FEmusic_hashtag_playlists` | Playlists por hashtag |
| `FEmusic_hashtag_videos` | Vídeos por hashtag |
| `FEmusic_library_landing` | Biblioteca principal |
| `FEmusic_library_corpus_artists` | Artistas na biblioteca |
| `FEmusic_library_non_music_audio_list` | Podcasts na biblioteca |
| `FEmusic_library_privately_owned_landing` | Landing de uploads próprios |
| `FEmusic_library_privately_owned_artists` | Artistas próprios |
| `FEmusic_library_privately_owned_releases` | Lançamentos próprios |
| `FEmusic_library_privately_owned_tracks` | Tracks próprias |
| `FEmusic_library_sideloaded_artists` | Artistas locais |
| `FEmusic_library_sideloaded_playlists` | Playlists locais |
| `FEmusic_library_sideloaded_releases` | Álbuns locais |
| `FEmusic_library_sideloaded_tracks` | Músicas locais |
| `FEmusic_history` | Histórico de reprodução |
| `FEmusic_trending` | Em alta |
| `FEmusic_offline` | Músicas offline |
| `FEmusic_radio_builder` | Construtor de rádio |
| `FEmusic_search` | Página de busca |
| `FEmusic_immersive` | Modo imersivo (Now Playing) |
| `FEmusic_tastebuilder` | Seletor de gostos (onboarding) |
| `FEmusic_genre_selection` | Seleção de gêneros |
| `FEmusic_listening_review` | Retrospectiva de escuta |
| `SPunlimited` | YouTube Music Premium |

### Radio Playlist ID Patterns
| ID | Descrição |
|----|-----------|
| `RDMM` | My Mix (rádio personalizado) |
| `RDID{videoId}` | Rádio baseado em vídeo específico |
| `RDTS{playlistId}` | Rádio baseado em playlist |
| `RD{videoId}` | Rádio de vídeo (prefixo genérico) |

### Endpoints Adicionais Descobertos

#### `music/get_queue` — Obter fila de reprodução (`vwf.java`)
Proto `aklx`:
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `f34508d` | String | videoId (alternativa a lista) |
| `f34509e` | List<String> | videoIds (lista, alternativa a videoId único) |
| `f34510f` | String | playlistId (fonte da fila) |
| `f34507c` | akht | context |
| `f34511g` | ahbo | sub-proto |
| `f34512h` | ahbo | sub-proto |
| `f34513i` | int | queueAddMode (`antv` enum) |
| `f34514j` | alqu | sub-proto |

Queue Add Mode (`antv`):
- `MODE_UNSPECIFIED` (0)
- `INSERT_AFTER_CURRENT_VIDEO` (1)
- `INSERT_AT_END` (2)
- `INSERT_AFTER_SET_VIDEO_ID` (3)

#### `like/like`, `like/dislike`, `like/removelike` (`vts.java`, `vtr.java`, `vtt.java`)
Classes base: `vto extends vox`
Proto `akkq`:
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `f34332d` | aleh | target (videoId ou playlistId) |
| `f34333e` | String | unknown |
| `f34334f` | aobp | optional sub-proto |

Proto `aleh` — target:
- `f37999c` = videoId (String)
- `f38000d` = playlistId (String)
- **Regra**: exatamente um deve ser preenchido (videoId XOR playlistId)

#### `music/get_search_suggestions` — Sugestões de busca
Também usa: `search/get_suggestions`
Criado como `aezf` no DI container.

#### `music/delete_privately_owned_entity` — Deletar upload

#### `music/get_music_commentary` — Detalhes/comentários da música

#### `browse/edit_playlist` — Editar playlist

#### `subscription/subscribe` e `subscription/unsubscribe` (`vxh.java`, `vxi.java`)
Proto `akrq`:
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `f35555d` | List<String> | channelIds (obrigatório, mínimo 1) |
| `f35556e` | String | unknown |
| `f35557f` | String | unknown |
| `f35558g` | amuk | sub-proto |

#### `playlist/create` (`vve.java`)
Proto `akpn`:
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `f35154d` | String | title (obrigatório) |
| `f35155e` | List<String> | videoIds |
| `f35156f` | String | sourcePlaylistId (alternativa a videoIds) |
| `f35158h` | String | description |
| `f35157g` | int | privacy (PUBLIC=2, UNLISTED=1, PRIVATE=3?) |
| `f35159i` | String | unknown |

**Regra**: videoIds XOR sourcePlaylistId

#### `playlist/delete` (`vvf.java`)
#### `playlist/get_add_to_playlist` (`vvg.java`)
#### `playlist/get_settings_editor`
#### `playlist/get_generated_thumbnails`
#### `playlist/get_suggested_playlist_videos` (`vvi.java`)

### Itags de Áudio (enum `vjp` em `vlq.java`)
Para TUI: filtrar `adaptiveFormats` onde `mimeType.startsWith("audio")`

| itag | mimeType | Qualidade | Notas |
|------|----------|-----------|-------|
| 140 | `audio/mp4; codecs="mp4a.40.5"` | AAC 128kbps | Mais comum |
| 141 | `audio/mp4; codecs="mp4a.40.5"` | AAC 256kbps | Alta qualidade AAC |
| 249 | `audio/webm; codecs="opus"` | Opus ~50kbps | Baixa qualidade |
| 250 | `audio/webm; codecs="opus"` | Opus ~70kbps | Média qualidade |
| 251 | `audio/webm; codecs="opus"` | Opus ~160kbps | **Melhor para TUI** |
| 256 | `audio/mp4; codecs="mp4a.40.5"` | AAC 5.1 baixo | Surround |
| 258 | `audio/mp4; codecs="mp4a.40.5"` | AAC 5.1 alto | Surround |
| 600 | `audio/webm; codecs="opus"` | Opus ultra-low | |
| 774 | `audio/webm; codecs="opus"` | Opus ultra-high | |

**Estratégia para TUI**:
1. Preferir itag 251 (Opus 160k, melhor suporte em sox/mpv/ffmpeg)
2. Fallback: itag 140 (AAC 128k, universal)
3. Para alta qualidade: itag 141 (AAC 256k)

### Browse Request Fields (vrt.java)
Campos completos do JSON de browse:
```json
{
  "browseId": "FEmusic_home",
  "language": "pt",
  "continuation": "<token>",
  "params": "<base64>",
  "query": "",
  "offline": false,
  "filteredBrowseParamsFormData": "",
  "formData": null,
  "genericFormData": null,
  "liteClientState": 0,
  "extendedPermissions": false
}
```

---

## Sessão 3: Headers HTTP, Auth Completo e Endpoints Finais

### Headers HTTP para ANDROID_MUSIC Client
Baseado em `vpj.java`:
```
Content-Type: application/x-protobuf
X-GOOG-API-FORMAT-VERSION: 2
Authorization: Bearer <oauth2_access_token>
X-Goog-Visitor-Id: <visitor_id>   (opcional)
X-Android-Package: com.google.android.apps.youtube.music
X-Android-Cert: <sha1_apk_cert>   (opcional)
```

**Para TUI TypeScript** (usando WEB_REMIX):
```
Content-Type: application/json
Authorization: Bearer <oauth2_access_token>  
X-Goog-Visitor-Id: <visitor_id>
```

### Headers HTTP para WEB_REMIX Client
```
Content-Type: application/json
Authorization: Bearer <oauth2_access_token>
X-Goog-Visitor-Id: <visitor_id>
X-Origin: https://music.youtube.com
Referer: https://music.youtube.com/
```

### Visitor ID
- Chave: `X-Goog-Visitor-Id` header (classe `ply.java`)
- Storage key Android: `"visitor_id"` em SharedPreferences
- Endpoint para obter: `visitor_id` (`vtn.java extends vox`)
- Para TUI: pode ser omitido inicialmente ou obtido fazendo um GET para `https://music.youtube.com`

### Versão do Cliente
- APK version: **9.32.51** (AndroidManifest.xml)
- ANDROID_MUSIC clientVersion: `"9.32.51"`
- WEB_REMIX clientVersion: `"1.20241118.01.00"` (muda frequentemente)

### Lista Completa de Todos os Endpoints Innertube (scan final)
Todos os endpoints de Innertube API encontrados via `super("endpoint", ...)`:

**Principais para TUI:**
| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `browse` | POST | Home, explore, album, artista, playlist, podcast |
| `browse/edit_playlist` | POST | Editar playlist |
| `search` | POST | Busca |
| `next` | POST | Próximo da fila/rádio |
| `player` | POST | Player/streaming |
| `player/heartbeat` | POST | Manter sessão de reprodução |
| `player/refresh` | POST | Refresh de streams |
| `player/ad_break` | POST | Intervalo de ad |
| `player/get_drm_license` | POST | Licença DRM |
| `music/get_queue` | POST | Obter fila |
| `music/get_search_suggestions` | POST | Sugestões de busca |
| `music/get_music_commentary` | POST | Detalhes/comentários |
| `music/delete_privately_owned_entity` | POST | Deletar upload próprio |
| `like/like` | POST | Curtir |
| `like/dislike` | POST | Não curtir |
| `like/removelike` | POST | Remover avaliação |
| `account/get_setting` | POST | Obter configuração |
| `account/set_setting` | POST | Definir configuração |
| `subscription/subscribe` | POST | Seguir artista |
| `subscription/unsubscribe` | POST | Deixar de seguir |
| `playlist/create` | POST | Criar playlist |
| `playlist/delete` | POST | Deletar playlist |
| `playlist/get_add_to_playlist` | POST | Opções p/ adicionar à playlist |
| `playlist/get_settings_editor` | POST | Editar settings da playlist |
| `playlist/get_suggested_playlist_videos` | POST | Vídeos sugeridos p/ playlist |
| `playlist/get_generated_thumbnails` | POST | Thumbnails geradas |
| `visitor_id` | POST | Obter visitor ID |
| `navigation/resolve_url` | POST | Resolver URL do YTMusic |
| `get_survey` | POST | Obter enquete |
| `submit_form` | POST | Enviar formulário |
| `share/get_share_panel` | POST | Painel de compartilhamento |
| `comment/get_comments` | POST | Obter comentários |
| `comment/create_comment` | POST | Criar comentário |

**Android Auto:**
| Endpoint | Descrição |
|----------|-----------|
| `ytm_media_browser/get_root_media_items` | Itens raiz |
| `ytm_media_browser/get_media_item_children` | Filhos de um item |
| `ytm_media_browser/search_media_items` | Busca de itens |

**YouTube Premium (ypc):**
| Endpoint | Descrição |
|----------|-----------|
| `ypc/get_cart` | Carrinho de compras |
| `ypc/handle_transaction` | Transação |
| `ypc/cancel_recurrence` | Cancelar assinatura |
| `ypc/pause_subscription` | Pausar assinatura |
| `ypc/resume_subscription` | Retomar assinatura |
| `ypc/get_offline_upsell` | Upsell offline |

**Logging/Telemetria (ignorar em TUI):**
`log`, `log_event`, `gel`, `feedback`, `get_survey`, `flag/flag`, vários `or*`, `pl*`, `pls*`, etc.

### Formato de Resposta do Player (WEB_REMIX JSON)
A resposta do endpoint `player` contém:
```json
{
  "videoDetails": {
    "videoId": "...",
    "title": "...",
    "author": "...",
    "channelId": "...",
    "lengthSeconds": "...",
    "thumbnail": { "thumbnails": [{"url": "...", "width": N, "height": N}] }
  },
  "streamingData": {
    "expiresInSeconds": "21540",
    "formats": [...],
    "adaptiveFormats": [
      {
        "itag": 251,
        "url": "https://...",
        "mimeType": "audio/webm; codecs=\"opus\"",
        "bitrate": 160000,
        "contentLength": "...",
        "quality": "tiny",
        "audioQuality": "AUDIO_QUALITY_MEDIUM"
      }
    ]
  }
}
```

### Estratégia de Autenticação para TUI
1. **OAuth2 Device Flow** (recomendado para CLI):
   - Scopes: `https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl`
   - Device auth URL: `https://accounts.google.com/o/oauth2/device/usercode`
   - Token URL: `https://accounts.google.com/o/oauth2/token`
   - Grant type: `urn:ietf:params:oauth:grant-type:device_code`

2. **Bearer Token** no header `Authorization: Bearer <token>`

3. **Client para TUI**: ANDROID_MUSIC (id=21, não precisa de cookies) OU WEB_REMIX (id=67)

---

## Sessão 4: Campos JSON confirmados, proto `aktk`, proto `akro` (get_watch), Clients completos

### Todos os Client Types (enum `akhq.java` — completo)
| Client Name | ID | Plataforma |
|-------------|-----|------------|
| `WEB` | 1 | Web |
| `ANDROID` | 3 | Android |
| `IOS` | 5 | iOS |
| `TVHTML5` | 7 | TV HTML5 |
| `TVLITE` | 8 | TV Lite |
| `TVANDROID` | 10 | TV Android |
| `ANDROID_MUSIC` | 21 | **Android Music (APK principal)** |
| `ANDROID_TV` | 23 | Android TV |
| `IOS_MUSIC` | 26 | iOS Music |
| `ANDROID_UNPLUGGED` | 29 | YouTube TV Android |
| `WEB_UNPLUGGED` | 41 | YouTube TV Web |
| `WEB_REMIX` | **67** | **Web Music (TUI usa este)** |
| `ANDROID_MUSIC_AOSP` | 104 | Android Music AOSP |
| `IOS_MUSIC` | 26 | iOS Music |
| `AGENTIC_INTEGRATIONS` | 109 | Agentes de IA |
| *(95 clientes no total no enum)* | | |

### Campos JSON confirmados para endpoint `next` (via `vxu.mo1715P()`)
Todos os campos abaixo são os nomes exatos de chave JSON no corpo do request:

```json
{
  "videoId": "dQw4w9WgXcQ",
  "playlistId": "PLxxx",
  "playlistIndex": 0,
  "params": "<base64>",
  "adParams": null,
  "continuation": "<token>",
  "isAdPlayback": false,
  "mdxUseDevServer": false,
  "watchNextType": 4,
  "forceAdUrls": "null",
  "forceAdGroupId": null,
  "forceBibliotecaAdId": null,
  "forceViralAdResponseUrl": null,
  "forcePresetAd": null,
  "isAudioOnly": true,
  "serializedThirdPartyEmbedConfig": null,
  "playerTimestamp": -1,
  "lastScrubbedInlinePlaybackId": null,
  "lastAudioTurnedOnInlinePlaybackId": null,
  "lastAudioTurnedOffInlinePlaybackId": null,
  "captionsRequested": false,
  "allowAdultContent": false,
  "allowControversialContent": false
}
```

**Mínimo para TUI** (iniciar rádio baseado em música):
```json
{
  "videoId": "<videoId>",
  "isAudioOnly": true,
  "watchNextType": 4
}
```

**watchNextType** valores (enum `aktj`):
- 2 = `MUSIC_QUEUE_ADD_OPERATION` (adicionar à fila)
- 3 = `SKIP_VIDEO` (pular)
- 4 = `GET_QUEUE` (obter fila — **usar no início**)
- 5 = `MUSIC_SHUFFLE` (embaralhar)
- 6 = `MUSIC_UNSHUFFLE` (desembaralhar)
- 7 = `QUEUE_ONLY` (somente fila)

### Campos JSON confirmados para endpoint `browse` (via `vrt.mo1715P()`)
```json
{
  "browseId": "FEmusic_home",
  "language": "pt",
  "continuation": "<token>",
  "formData": null,
  "genericFormData": null,
  "filteredBrowseParamsFormData": "",
  "params": "<base64>",
  "query": "",
  "offline": false,
  "extendedPermissions": false,
  "liteClientState": 0
}
```

**Mínimo para TUI** (browsear home):
```json
{ "browseId": "FEmusic_home" }
```

### Proto `akro` — get_watch combinado (player + next)
- `f35538e` = akht (InnertubeContext)
- `f35539f` = akox (player request proto)
- `f35537d` = oneof: aktk (next params) OU akjj (sub-proto alternativo)
- `f35536c` = índice do oneof (0 = aktk, 1 = akjj)

**Uso para TUI**: `get_watch` faz player + next em 1 chamada — mais eficiente que 2 calls separadas.

### Proto `aktk` — campos do next request (rastreados via `vxu.mo1683a()`)
| Campo obfuscado | Tipo | Nome semântico |
|-----------------|------|----------------|
| `f35797e` | String | `videoId` |
| `f35798f` | String | `playlistId` |
| `f35799g` | String | `params` |
| `f35800h` | String | `continuation` |
| `f35801i` | int | `playlistIndex` |
| `f35802j` | String | click tracking params |
| `f35803k` | bool | `isAdPlayback` |
| `f35804l` | String | `adParams` |
| `f35805m` | bool | `allowControversialContent` |
| `f35806n` | bool | `allowAdultContent` |
| `f35807o` | bool | (sempre false — `mdxUseDevServer`) |
| `f35808p` | int | `watchNextType` (default 1) |
| `f35809q` | List\<int\> | |
| `f35810r` | bool | `isAudioOnly` |
| `f35812t` | aktf | playerTimestamp (sub-proto com `f35771c`) |
| `f35813u` | bool | (sempre false) |
| `f35814v` | alqu | sub-proto |
| `f35815w` | aock | sub-proto |
| `f35816x` | ahbo | sub-proto |
| `f35817y` | aigz | sub-proto |

### Proto `akjj` — alternativa para get_watch (campo f35537d quando c=1)
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `f34086c` | akht | InnertubeContext |
| `f34087d` | int | |
| `f34088e` | akox | player request proto |
| `f34089f` | String | |
| `f34090g` | bool | |
| `f34091h` | bool | |
| `f34092i` | String | |
| `f34093j` | akjo | sub-proto |

### vag(short[] null) — esclarecimento importante
O método `m46057F()` na classe base `vni` retorna um objeto `vag(short[] null)` que, ao ser
analisado, é um **builder de cache key** (formato `key:value/key:value`), NÃO o corpo JSON real.

O corpo JSON real do HTTP request é construído **serializando o proto** retornado por `mo1683a()`.
Para clientes WEB_REMIX, os mesmos campos são enviados como JSON com as mesmas chaves.

### Resumo: Request mínimo completo para o TUI (WEB_REMIX)

#### Reproduzir uma música:
```json
POST https://music.youtube.com/youtubei/v1/player?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-KVIS-GHjc
Content-Type: application/json

{
  "context": {
    "client": {
      "clientName": "WEB_REMIX",
      "clientVersion": "1.20241118.01.00",
      "hl": "pt-BR",
      "gl": "BR"
    }
  },
  "videoId": "dQw4w9WgXcQ",
  "contentCheckOk": true,
  "racyCheckOk": true,
  "clientPlaybackNonce": "<16-char-base64url>"
}
```

#### Buscar músicas:
```json
POST https://music.youtube.com/youtubei/v1/search?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-KVIS-GHjc

{
  "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.20241118.01.00" } },
  "query": "Nome da música",
  "params": "Eg-KAQQIARAAGAAgASgAMABqChAEEAMQCRAFEBU%3D"
}
```

#### Obter fila/rádio:
```json
POST https://music.youtube.com/youtubei/v1/next?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-KVIS-GHjc

{
  "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.20241118.01.00" } },
  "videoId": "dQw4w9WgXcQ",
  "isAudioOnly": true,
  "watchNextType": 4
}
```

#### Home (browse):
```json
POST https://music.youtube.com/youtubei/v1/browse?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-KVIS-GHjc

{
  "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.20241118.01.00" } },
  "browseId": "FEmusic_home"
}
```

### musicSearchRequestType (enum `akqx`) — tipos de busca por fonte
| Valor | Constante | Descrição |
|-------|-----------|-----------|
| 0 | `MUSIC_SEARCH_REQUEST_TYPE_UNSPECIFIED` | Catálogo principal (padrão) |
| 1 | `MUSIC_SEARCH_REQUEST_TYPE_CATALOG` | Catálogo |
| 2 | `MUSIC_SEARCH_REQUEST_TYPE_LIBRARY` | Biblioteca |
| 3 | `MUSIC_SEARCH_REQUEST_TYPE_DOWNLOADS` | Downloads |
| 4 | `MUSIC_SEARCH_REQUEST_TYPE_SIDELOADED` | Sideloaded (local) |
| 5 | `MUSIC_SEARCH_REQUEST_TYPE_UPLOADED` | Uploads do usuário |

### searchPageType (enum `akqy`) — tipo de página de busca
| Valor | Constante | Descrição |
|-------|-----------|-----------|
| 0 | `SEARCH_PAGE_TYPE_UNKNOWN` | Desconhecido |
| 1 | `SEARCH_PAGE_TYPE_MAIN_RESULTS` | Resultados principais |
| 2 | `SEARCH_PAGE_TYPE_LANDING` | Página inicial de busca |
| 5 | `SEARCH_PAGE_TYPE_AI_SEARCH` | Busca com IA |

### search Chips / Filter Types (`hjx` enum)
| Valor | Nome | Descrição |
|-------|------|-----------|
| 0 | `TOP_RESULT` | Melhor resultado |
| 1 | `SONGS_AND_VIDEOS` | Músicas e vídeos |
| 2 | `PLAYLISTS` | Playlists |
| 3 | `ALBUMS` | Álbuns |

### Confirmação: URLs de stream NÃO precisam de decifração
Confirmado via busca por `signatureCipher`, `jsUrl`, `jsplayer`, `html5player` no APK:
apenas 0-1 ocorrências não relacionadas ao player. O Android/ANDROID_MUSIC recebe **URLs
pré-assinadas diretamente** na resposta do `player` — sem precisar processar JS player.
Mesmo vale para WEB_REMIX via TUI.

A URL em `ajui.f29378f` é a URL final `https://rr*.googlevideo.com/videoplayback?...`
pronta para download com `curl` / `mpv` / `ffmpeg`.

### Campos confirmados do endpoint `search` (via `vwp.mo1715P()`)
```json
{
  "query": "nome da música",
  "params": "<base64-proto-akrb>",
  "conversationId": null,
  "continuation": "<token>",
  "filterOptions": "<base64-vazio>",
  "genericFormData": "<base64-ajuc>",
  "musicSearchRequestType": 0
}
```

### Resposta de `next` — estrutura da fila (proto rastreado)
Cadeia de protobufs na resposta do `next`:
```
aktl (resposta next)
  └─ f35843k: aiwt (fila de reprodução)
       └─ f25528c: ajlc (lista de itens + continuation)
            ├─ f27810c: ajld (um item da fila)
            │    ├─ f27816d: String (videoId)
            │    ├─ f27817e: String (setVideoId/playlistId)
            │    ├─ f27821i: String (params)
            │    ├─ f27819g: ajlg (metadados: b=String, c=int)
            │    └─ f27822k: ajry (thumbnail: b=ajrp, c=String)
            └─ f27811d: ahbo (continuation token da fila)
  └─ f35857y: ahbo (continuation token geral, se bit 2 de f35836c ativo)
```

**Para o TUI, a resposta JSON do `next` (WEB_REMIX) retorna:**
```json
{
  "contents": {
    "singleColumnMusicWatchNextResultsRenderer": {
      "tabbedRenderer": {
        "watchNextTabbedResultsRenderer": {
          "tabs": [{
            "tabRenderer": {
              "content": {
                "musicQueueRenderer": {
                  "content": {
                    "playlistPanelRenderer": {
                      "contents": [{
                        "playlistPanelVideoRenderer": {
                          "videoId": "...",
                          "title": { "runs": [{"text": "Nome da Música"}] },
                          "longBylineText": { "runs": [{"text": "Artista"}] },
                          "thumbnail": { "thumbnails": [{"url": "..."}] },
                          "lengthText": { "runs": [{"text": "3:45"}] },
                          "selected": true,
                          "navigationEndpoint": {
                            "watchEndpoint": {
                              "videoId": "...",
                              "playlistId": "RDAMVM...",
                              "index": 0,
                              "params": "..."
                            }
                          }
                        }
                      }],
                      "continuations": [{
                        "nextRadioContinuationData": { "continuation": "..." }
                      }]
                    }
                  }
                }
              }
            }
          }]
        }
      }
    }
  }
}
```

### akrb proto — campos de search params
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `f35455b` | int | bitmask de campos presentes |
| `f35456c` | int | tipo de conteúdo (sempre 4 em buscas normais) |
| `f35457d` | int | flag (sempre 1) |
| `f35458e` | String | query (text de busca) |
| `f35459f` | int | método de entrada (0-indexed) |
| `f35460g` | List\<int\> | input methods (akqz.f35419l) |
| `f35461h` | String | originalQuery |
| `f35462i` | akra | sugestão assistida selecionada |
| `f35463j` | List\<akra\> | todas sugestões vistas |
| `f35464k` | bool | zeroPrefixSuggestionsEnabled |
| `f35465l` | int | sempre 0 |
| `f35466m` | long | sessionDurationMillis |
| `f35467n` | long | firstEditTimeMillis |
| `f35468o` | long | lastEditTimeMillis |
| `f35469p` | int | sempre 0 |
| `f35470q` | int | sempre 0 |

