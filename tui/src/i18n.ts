export type Lang = 'pt' | 'en' | 'es' | 'fr';
export const SUPPORTED_LANGS: Lang[] = ['pt', 'en', 'es', 'fr'];

let _lang: Lang = 'pt';
export function setLang(l: string): void {
  _lang = (SUPPORTED_LANGS as string[]).includes(l) ? (l as Lang) : 'pt';
}
export function getLang(): Lang { return _lang; }

type Tr = { pt: string; en: string; es?: string; fr?: string };

const S: Record<string, Tr> = {
  // ── Tabs ─────────────────────────────────────────────────────────────────
  'tab.home':       { pt: 'Início',    en: 'Home',      es: 'Inicio',    fr: 'Accueil'   },
  'tab.search':     { pt: 'Buscar',    en: 'Search',    es: 'Buscar',    fr: 'Recherche' },
  'tab.queue':      { pt: 'Fila',      en: 'Queue',     es: 'Cola',      fr: 'File'      },
  'tab.lyrics':     { pt: 'Letras',    en: 'Lyrics',    es: 'Letra',     fr: 'Paroles'   },
  'tab.playlists':  { pt: 'Playlists', en: 'Playlists', es: 'Playlists', fr: 'Playlists' },
  'tab.settings':   { pt: 'Config',    en: 'Settings',  es: 'Config',    fr: 'Réglages'  },
  'tab.login':      { pt: 'Login',     en: 'Login',     es: 'Login',     fr: 'Connexion' },

  // ── Player bar ────────────────────────────────────────────────────────────
  'player.nothing': { pt: 'Nenhuma música tocando', en: 'Nothing playing',    es: 'Nada reproduciendo',     fr: 'Rien en lecture'        },
  'player.hint1':   { pt: 'Espaço=pause  n=próx',   en: 'Space=pause  n=next', es: 'Espacio=pausa  n=sig',  fr: 'Espace=pause  n=suiv'   },
  'player.hint2':   { pt: 'Ctrl+↑=tela  ←→=seek',  en: 'Ctrl+↑=screen  ←→=seek', es: 'Ctrl+↑=pantalla  ←→=seek', fr: 'Ctrl+↑=écran  ←→=seek' },

  // ── Home ──────────────────────────────────────────────────────────────────
  'home.title':     { pt: 'Para você',                 en: 'For you',              es: 'Para ti',                fr: 'Pour vous'              },
  'home.empty':     { pt: 'Nenhum conteúdo encontrado.', en: 'No content found.',  es: 'Sin contenido.',         fr: 'Aucun contenu.'         },
  'loading':        { pt: 'Carregando…',               en: 'Loading…',             es: 'Cargando…',              fr: 'Chargement…'            },

  // ── Search ────────────────────────────────────────────────────────────────
  'search.title':       { pt: 'Buscar músicas',                       en: 'Search music',                  es: 'Buscar música',                    fr: 'Rechercher de la musique'     },
  'search.placeholder': { pt: 'Nome da música ou artista…',           en: 'Song name or artist…',          es: 'Nombre de la canción o artista…',  fr: 'Titre ou artiste…'            },
  'search.hint':        { pt: '↑↓ navegar   Enter = tocar   Esc = voltar', en: '↑↓ navigate   Enter = play   Esc = back', es: '↑↓ navegar   Enter = reproducir   Esc = atrás', fr: '↑↓ naviguer   Enter = lire   Esc = retour' },
  'search.noauth':      { pt: 'Tocar músicas via busca funciona sem login.', en: 'Playback via search works without login.', es: 'La reproducción vía búsqueda funciona sin login.', fr: 'La lecture via recherche fonctionne sans connexion.' },
  'search.results':     { pt: 'Resultados para: ',    en: 'Results for: ',        es: 'Resultados para: ',      fr: 'Résultats pour : '      },
  'search.artist':      { pt: 'Artista',              en: 'Artist',               es: 'Artista',                fr: 'Artiste'                },
  'search.noresult':    { pt: 'Nenhum resultado encontrado.', en: 'No results found.', es: 'Sin resultados.',   fr: 'Aucun résultat.'        },
  'search.artist.hint': { pt: 'Enter para ver perfil', en: 'Enter to view profile', es: 'Enter para ver perfil', fr: 'Entrée pour voir le profil' },
  'search.loading':     { pt: 'buscando…',            en: 'searching…',           es: 'buscando…',              fr: 'recherche…'             },

  // ── Context menu ──────────────────────────────────────────────────────────
  'ctx.add.pl':     { pt: 'Escolha a playlist:',         en: 'Choose a playlist:',        es: 'Elige una playlist:',          fr: 'Choisir une playlist :'      },
  'ctx.adding':     { pt: 'adicionando a "{name}"…',     en: 'adding to "{name}"…',       es: 'agregando a "{name}"…',        fr: 'ajout à "{name}"…'           },
  'ctx.added':      { pt: 'adicionado a "{name}"!',      en: 'added to "{name}"!',        es: 'agregado a "{name}"!',         fr: 'ajouté à "{name}" !'         },
  'ctx.add.err':    { pt: 'erro: {msg}',                 en: 'error: {msg}',              es: 'error: {msg}',                 fr: 'erreur : {msg}'              },
  'ctx.dl.songs':   { pt: 'download só funciona para músicas', en: 'download only works for songs', es: 'descarga solo funciona para canciones', fr: 'téléchargement uniquement pour les chansons' },
  'ctx.pl.songs':   { pt: 'só é possível adicionar músicas a playlists', en: 'only songs can be added to playlists', es: 'solo canciones se pueden agregar a playlists', fr: 'seules les chansons peuvent être ajoutées aux playlists' },
  'ctx.pl.noapi':   { pt: 'não suportado: requer token de feedback da API', en: 'unsupported: requires API feedback token', es: 'no soportado: requiere token de feedback de API', fr: 'non pris en charge : nécessite un token API' },
  'ctx.pl.loading': { pt: 'carregando…',                en: 'loading…',                  es: 'cargando…',                    fr: 'chargement…'                 },
  'ctx.pl.none':    { pt: 'nenhuma playlist encontrada', en: 'no playlists found',        es: 'no se encontraron playlists',  fr: 'aucune playlist trouvée'     },

  // ── Playlists ─────────────────────────────────────────────────────────────
  'pl.title':       { pt: 'Minhas Playlists',  en: 'My Playlists',    es: 'Mis Playlists',    fr: 'Mes Playlists'     },
  'pl.noauth':      { pt: 'Você não está logado no YouTube Music.', en: 'You are not logged in to YouTube Music.', es: 'No has iniciado sesión en YouTube Music.', fr: 'Vous n\'êtes pas connecté à YouTube Music.' },
  'pl.none':        { pt: 'Nenhuma playlist encontrada na sua conta.', en: 'No playlists found in your account.', es: 'No se encontraron playlists en tu cuenta.', fr: 'Aucune playlist trouvée dans votre compte.' },
  'pl.hint':        { pt: '↑↓ navegar   Enter = abrir   / = buscar',   en: '↑↓ navigate   Enter = open   / = search',  es: '↑↓ navegar   Enter = abrir   / = buscar',   fr: '↑↓ naviguer   Enter = ouvrir   / = chercher' },
  'pl.hint.tracks': { pt: '↑↓ navegar   Enter = tocar a partir daqui   Esc = voltar', en: '↑↓ navigate   Enter = play from here   Esc = back', es: '↑↓ navegar   Enter = reproducir desde aquí   Esc = atrás', fr: '↑↓ naviguer   Enter = lire depuis ici   Esc = retour' },
  'pl.tracks':      { pt: 'músicas',           en: 'songs',           es: 'canciones',        fr: 'morceaux'          },
  'pl.empty':       { pt: 'Playlist vazia ou sem músicas disponíveis.', en: 'Empty playlist or no songs available.', es: 'Playlist vacía o sin canciones disponibles.', fr: 'Playlist vide ou aucun morceau disponible.' },
  'pl.not.found':   { pt: 'nenhuma playlist encontrada', en: 'no playlists found', es: 'no se encontraron playlists', fr: 'aucune playlist trouvée' },

  // ── Queue ─────────────────────────────────────────────────────────────────
  'queue.title':    { pt: 'Fila de reprodução', en: 'Playback queue',  es: 'Cola de reproducción', fr: 'File de lecture'   },
  'queue.songs':    { pt: 'músicas',            en: 'songs',           es: 'canciones',             fr: 'morceaux'          },
  'queue.empty':    { pt: 'Fila vazia — busque uma música para começar.', en: 'Queue is empty — search for a song to get started.', es: 'Cola vacía — busca una canción para empezar.', fr: 'File vide — recherchez une chanson pour commencer.' },
  'queue.hint':     { pt: '↑↓ navegar   Enter = pular para música', en: '↑↓ navigate   Enter = jump to song', es: '↑↓ navegar   Enter = saltar a canción', fr: '↑↓ naviguer   Enter = aller à la chanson' },
  'queue.syllable': { pt: 'sílaba',   en: 'syllable', es: 'sílaba',   fr: 'syllabe'  },
  'queue.word':     { pt: 'palavra',  en: 'word',     es: 'palabra',  fr: 'mot'      },
  'queue.line':     { pt: 'linha',    en: 'line',     es: 'línea',    fr: 'ligne'    },

  // ── Lyrics ────────────────────────────────────────────────────────────────
  'lyrics.loading':    { pt: '♩ Buscando letras…',         en: '♩ Fetching lyrics…',        es: '♩ Buscando letra…',         fr: '♩ Chargement des paroles…'  },
  'lyrics.none':       { pt: 'Sem letras disponíveis',       en: 'No lyrics available',       es: 'Sin letra disponible',      fr: 'Paroles non disponibles'    },
  'lyrics.nothing':    { pt: 'Nenhuma música tocando',       en: 'Nothing playing',           es: 'Nada reproduciendo',        fr: 'Rien en lecture'            },
  'fs.lyrics.loading': { pt: 'carregando letras…',           en: 'loading lyrics…',           es: 'cargando letra…',           fr: 'chargement des paroles…'    },
  'fs.lyrics.none':    { pt: '(sem letras)',                 en: '(no lyrics)',               es: '(sin letra)',               fr: '(sans paroles)'             },

  // ── Artist ────────────────────────────────────────────────────────────────
  'artist.loading':  { pt: '● Carregando artista…',     en: '● Loading artist…',      es: '● Cargando artista…',    fr: '● Chargement de l\'artiste…' },
  'artist.notfound': { pt: 'Artista não encontrado.',   en: 'Artist not found.',      es: 'Artista no encontrado.', fr: 'Artiste introuvable.'         },
  'artist.top':      { pt: 'Top músicas',               en: 'Top songs',              es: 'Top canciones',          fr: 'Meilleures chansons'          },
  'artist.albums':   { pt: 'Álbuns',                    en: 'Albums',                 es: 'Álbumes',                fr: 'Albums'                       },
  'artist.singles':  { pt: 'Singles e EPs',             en: 'Singles & EPs',          es: 'Singles y EPs',          fr: 'Singles et EPs'               },
  'artist.hint':     { pt: '↑↓ navegar   Enter = tocar/abrir   Esc = voltar', en: '↑↓ navigate   Enter = play/open   Esc = back', es: '↑↓ navegar   Enter = reproducir/abrir   Esc = atrás', fr: '↑↓ naviguer   Enter = lire/ouvrir   Esc = retour' },

  // ── Auth ──────────────────────────────────────────────────────────────────
  'auth.title':    { pt: 'Login com conta Google',          en: 'Login with Google account',    es: 'Iniciar sesión con Google',      fr: 'Connexion avec Google'           },
  'auth.starting': { pt: '● Iniciando autenticação…',       en: '● Starting authentication…',   es: '● Iniciando autenticación…',     fr: '● Démarrage de l\'authentification…' },
  'auth.error':    { pt: 'Erro ao iniciar. Tente novamente.', en: 'Failed to start. Try again.', es: 'Error al iniciar. Inténtalo de nuevo.', fr: 'Échec du démarrage. Réessayez.' },
  'auth.done':     { pt: '✓ Autenticado com sucesso!',       en: '✓ Successfully authenticated!', es: '✓ ¡Autenticado con éxito!',     fr: '✓ Authentifié avec succès !'    },
  'auth.step1':    { pt: '1. Acesse:',                       en: '1. Visit:',                    es: '1. Visita:',                     fr: '1. Accédez à :'                  },
  'auth.step2':    { pt: '2. Digite o código:',              en: '2. Enter the code:',           es: '2. Escribe el código:',          fr: '2. Entrez le code :'             },
  'auth.waiting':  { pt: 'Aguardando confirmação…',          en: 'Waiting for confirmation…',    es: 'Esperando confirmación…',        fr: 'En attente de confirmation…'    },

  // ── Settings ──────────────────────────────────────────────────────────────
  'settings.title':         { pt: 'Configurações',              en: 'Settings',                   es: 'Configuración',               fr: 'Paramètres'                  },
  'settings.hint':          { pt: '↑↓ navegar   ←→ / Enter = alterar   h = voltar ao início', en: '↑↓ navigate   ←→ / Enter = change   h = go home', es: '↑↓ navegar   ←→ / Enter = cambiar   h = inicio', fr: '↑↓ naviguer   ←→ / Entrée = modifier   h = accueil' },
  'settings.tab.lyrics':    { pt: 'Letras',                     en: 'Lyrics',                     es: 'Letra',                       fr: 'Paroles'                     },
  'settings.tab.language':  { pt: 'Idioma',                     en: 'Language',                   es: 'Idioma',                      fr: 'Langue'                      },
  'settings.lyrics.ctx':    { pt: 'Linhas de contexto',         en: 'Context lines',              es: 'Líneas de contexto',          fr: 'Lignes de contexte'          },
  'settings.lyrics.big':    { pt: 'Linha atual em destaque',    en: 'Highlight current line',     es: 'Resaltar línea actual',       fr: 'Mettre en évidence la ligne' },
  'settings.lyrics.dim':    { pt: 'Escurecer linhas adjacentes',en: 'Dim adjacent lines',         es: 'Oscurecer líneas adyacentes', fr: 'Atténuer les lignes proches' },
  'settings.lyrics.space':  { pt: 'Espaçamento entre letras',   en: 'Letter spacing',             es: 'Espacio entre letras',        fr: 'Espacement des lettres'      },
  'settings.lyrics.offset': { pt: 'Avanço das letras',          en: 'Lyrics advance',             es: 'Avance de letra',             fr: 'Avance des paroles'          },
  'settings.lang.ui':       { pt: 'Idioma da interface',        en: 'Interface language',         es: 'Idioma de la interfaz',       fr: 'Langue de l\'interface'      },
  'settings.lang.lyrics':   { pt: 'Idioma das letras',          en: 'Lyrics language',            es: 'Idioma de la letra',          fr: 'Langue des paroles'          },

  // ── Lang names (always shown in their own language) ───────────────────────
  'lang.pt': { pt: 'Português', en: 'Português', es: 'Português', fr: 'Português' },
  'lang.en': { pt: 'English',   en: 'English',   es: 'English',   fr: 'English'   },
  'lang.es': { pt: 'Español',   en: 'Español',   es: 'Español',   fr: 'Español'   },
  'lang.fr': { pt: 'Français',  en: 'Français',  es: 'Français',  fr: 'Français'  },

  // ── Bool values ───────────────────────────────────────────────────────────
  'yes': { pt: 'Sim', en: 'Yes', es: 'Sí',  fr: 'Oui' },
  'no':  { pt: 'Não', en: 'No',  es: 'No',  fr: 'Non' },
};

export function t(key: string, vars?: Record<string, string>): string {
  const entry = S[key];
  if (!entry) return key;
  let str = entry[_lang] ?? entry['en'] ?? key;
  if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return str;
}
