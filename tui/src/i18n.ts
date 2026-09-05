export type Lang = 'pt' | 'en';

let _lang: Lang = 'pt';
export function setLang(l: string): void { _lang = l === 'en' ? 'en' : 'pt'; }
export function getLang(): Lang { return _lang; }

const S: Record<string, [string, string]> = {
  // [pt, en]
  // ── Tabs ─────────────────────────────────────────────────────────
  'tab.home':       ['Início',   'Home'],
  'tab.search':     ['Buscar',   'Search'],
  'tab.queue':      ['Fila',     'Queue'],
  'tab.lyrics':     ['Letras',   'Lyrics'],
  'tab.playlists':  ['Playlists','Playlists'],
  'tab.settings':   ['Config',   'Settings'],
  'tab.login':      ['Login',    'Login'],

  // ── Player bar ───────────────────────────────────────────────────
  'player.nothing': ['Nenhuma música tocando', 'Nothing playing'],

  // ── Search ───────────────────────────────────────────────────────
  'search.title':   ['Buscar músicas',              'Search music'],
  'search.placeholder': ['Nome da música ou artista…', 'Song name or artist…'],
  'search.hint':    ['↑↓ navegar   Enter = tocar   Esc = voltar', '↑↓ navigate   Enter = play   Esc = back'],
  'search.noauth':  ['Tocar músicas via busca funciona sem login.', 'Playback via search works without login.'],

  // ── Playlists ────────────────────────────────────────────────────
  'pl.none':        ['Nenhuma playlist encontrada na sua conta.', 'No playlists found in your account.'],
  'pl.hint':        ['↑↓ navegar   Enter = abrir   / = buscar', '↑↓ navigate   Enter = open   / = search'],
  'pl.hint.tracks': ['↑↓ navegar   Enter = tocar a partir daqui   Esc = voltar', '↑↓ navigate   Enter = play from here   Esc = back'],
  'pl.tracks':      ['músicas', 'songs'],
  'pl.empty':       ['Playlist vazia ou sem músicas disponíveis.', 'Empty playlist or no songs available.'],
  'pl.not.found':   ['nenhuma playlist encontrada', 'no playlists found'],

  // ── Queue ────────────────────────────────────────────────────────
  'queue.title':    ['Fila de reprodução', 'Playback queue'],
  'queue.songs':    ['músicas',            'songs'],
  'queue.empty':    ['Fila vazia — busque uma música para começar.', 'Queue is empty — search for a song to get started.'],
  'queue.hint':     ['↑↓ navegar   Enter = pular para música', '↑↓ navigate   Enter = jump to song'],
  'queue.syllable': ['sílaba', 'syllable'],
  'queue.word':     ['palavra', 'word'],
  'queue.line':     ['linha',  'line'],

  // ── Lyrics ───────────────────────────────────────────────────────
  'lyrics.loading': ['♩ Buscando letras…', '♩ Fetching lyrics…'],
  'lyrics.none':    ['Sem letras disponíveis', 'No lyrics available'],
  'lyrics.nothing': ['Nenhuma música tocando', 'Nothing playing'],

  // ── Artist ───────────────────────────────────────────────────────
  'artist.loading': ['● Carregando artista…', '● Loading artist…'],
  'artist.top':     ['Top músicas',   'Top songs'],
  'artist.albums':  ['Álbuns',        'Albums'],
  'artist.singles': ['Singles e EPs', 'Singles & EPs'],
  'artist.hint':    ['↑↓ navegar   Enter = tocar/abrir   Esc = voltar', '↑↓ navigate   Enter = play/open   Esc = back'],

  // ── Home / loading ───────────────────────────────────────────────
  'loading':        ['Carregando…', 'Loading…'],

  // ── Auth ─────────────────────────────────────────────────────────
  'auth.title':     ['Login com conta Google',  'Login with Google account'],
  'auth.starting':  ['● Iniciando autenticação…', '● Starting authentication…'],
  'auth.error':     ['Erro ao iniciar. Tente novamente.', 'Failed to start. Try again.'],
  'auth.done':      ['✓ Autenticado com sucesso!', '✓ Successfully authenticated!'],
  'auth.step1':     ['1. Acesse:', '1. Visit:'],
  'auth.step2':     ['2. Digite o código:', '2. Enter the code:'],
  'auth.waiting':   ['Aguardando confirmação…', 'Waiting for confirmation…'],

  // ── Settings: general ────────────────────────────────────────────
  'settings.title': ['Configurações',       'Settings'],
  'settings.hint':  ['↑↓ navegar   ←→ / Enter = alterar   h = voltar ao início',
                     '↑↓ navigate   ←→ / Enter = change   h = go home'],

  // ── Settings: Letras tab ─────────────────────────────────────────
  'settings.tab.lyrics':    ['Letras',   'Lyrics'],
  'settings.tab.language':  ['Idioma',   'Language'],
  'settings.lyrics.ctx':    ['Linhas de contexto',         'Context lines'],
  'settings.lyrics.big':    ['Linha atual em destaque',    'Highlight current line'],
  'settings.lyrics.dim':    ['Escurecer linhas adjacentes','Dim adjacent lines'],
  'settings.lyrics.space':  ['Espaçamento entre letras',   'Letter spacing'],

  // ── Settings: Idioma tab ─────────────────────────────────────────
  'settings.lang.ui':       ['Idioma da interface', 'Interface language'],
  'settings.lang.lyrics':   ['Idioma das letras',   'Lyrics language'],
  'lang.pt': ['Português', 'Portuguese'],
  'lang.en': ['English',   'English'],

  // ── Bool values ──────────────────────────────────────────────────
  'yes': ['Sim', 'Yes'],
  'no':  ['Não', 'No'],
};

export function t(key: string): string {
  const entry = S[key];
  if (!entry) return key;
  return entry[_lang === 'en' ? 1 : 0];
}
