/**
 * Fontes display da Tipografia Automática — self-hosted em /public/fonts
 * (woff2, subset latin, licença OFL). Carregadas via FontFace API porque o
 * canvas 2D precisa da fonte JÁ ativa no document.fonts na hora do fillText;
 * next/font não serve aqui (nome com hash + carregamento por CSS não garante
 * disponibilidade síncrona pro rasterizador do canvas).
 *
 * Catálogo estilo CapCut: 48 fontes em grupos (impacto, cartoon, script,
 * condensada, tech, serifada) — cada preset vem com a fonte curada dele, e o
 * user pode trocar pelo seletor do editor (style.fontOverride).
 */

export type FontKey =
  | 'anton'
  | 'archivo'
  | 'bebas'
  | 'montserrat800'
  | 'montserrat900'
  | 'poppins800'
  | 'inter800'
  | 'playfair900'
  | 'playfair900i'
  | 'marker'
  | 'jetbrains700'
  | 'nunito900'
  | 'oswald600'
  | 'caveat700'
  | 'luckiest'
  | 'bangers'
  | 'bungee'
  | 'titan'
  | 'alfaslab'
  | 'passion700'
  | 'lilita'
  | 'fredoka600'
  | 'righteous'
  | 'russo'
  | 'blackops'
  | 'shrikhand'
  | 'abril'
  | 'lobster'
  | 'pacifico'
  | 'dancing700'
  | 'greatvibes'
  | 'yellowtail'
  | 'kaushan'
  | 'barlow800'
  | 'staatliches'
  | 'squada'
  | 'teko700'
  | 'saira800'
  | 'orbitron800'
  | 'audiowide'
  | 'monoton'
  | 'pressstart'
  | 'vt323'
  | 'changa'
  | 'cinzel800'
  | 'dmserif'
  | 'ultra'
  | 'yeseva'
  | 'bevan'
  | 'bowlbysc'
  | 'sigmar'
  | 'modak'
  | 'paytone'
  | 'baloo800'
  | 'concert'
  | 'fjalla'
  | 'leaguegothic'
  | 'bigshoulders800'
  | 'khand700'
  | 'pathway'
  | 'michroma'
  | 'syncopate700'
  | 'fasterone'
  | 'zendots'
  | 'creepster'
  | 'chewy'
  | 'ranchers'
  | 'prata'
  | 'cormorant700'
  | 'bodoni800'
  | 'bodoni800i'
  | 'fraunces900'
  | 'fraunces900i'
  | 'italiana'
  | 'marcellus'
  | 'rozha'
  | 'mrdafoe'
  | 'allura'
  | 'parisienne'
  | 'sacramento'
  | 'alexbrush'
  | 'cookie'
  | 'berkshire'
  | 'norican';

export type TypoFont = {
  family: string; // nome único registrado no document.fonts
  file: string;
  weight: number;
  italic?: boolean;
  label: string;
  /** grupo no seletor de fontes */
  group: 'Impacto' | 'Cartoon' | 'Script' | 'Condensada' | 'Tech' | 'Serifada' | 'Clean';
};

export const TYPO_FONTS: Record<FontKey, TypoFont> = {
  // ── Impacto ──
  anton: { family: 'TipoAnton', file: 'anton.woff2', weight: 400, label: 'Anton', group: 'Impacto' },
  archivo: { family: 'TipoArchivoBlack', file: 'archivo-black.woff2', weight: 400, label: 'Archivo Black', group: 'Impacto' },
  montserrat900: { family: 'TipoMontserrat', file: 'montserrat-900.woff2', weight: 900, label: 'Montserrat Black', group: 'Impacto' },
  passion700: { family: 'TipoPassion', file: 'passion-one-700.woff2', weight: 700, label: 'Passion One', group: 'Impacto' },
  changa: { family: 'TipoChanga', file: 'changa-one.woff2', weight: 400, label: 'Changa One', group: 'Impacto' },
  ultra: { family: 'TipoUltra', file: 'ultra.woff2', weight: 400, label: 'Ultra Slab', group: 'Impacto' },
  alfaslab: { family: 'TipoAlfaSlab', file: 'alfa-slab.woff2', weight: 400, label: 'Alfa Slab', group: 'Impacto' },
  // ── Cartoon ──
  luckiest: { family: 'TipoLuckiest', file: 'luckiest-guy.woff2', weight: 400, label: 'Luckiest Guy', group: 'Cartoon' },
  bangers: { family: 'TipoBangers', file: 'bangers.woff2', weight: 400, label: 'Bangers', group: 'Cartoon' },
  titan: { family: 'TipoTitan', file: 'titan-one.woff2', weight: 400, label: 'Titan One', group: 'Cartoon' },
  lilita: { family: 'TipoLilita', file: 'lilita-one.woff2', weight: 400, label: 'Lilita One', group: 'Cartoon' },
  fredoka600: { family: 'TipoFredoka', file: 'fredoka-600.woff2', weight: 600, label: 'Fredoka', group: 'Cartoon' },
  nunito900: { family: 'TipoNunito', file: 'nunito-900.woff2', weight: 900, label: 'Nunito Black', group: 'Cartoon' },
  shrikhand: { family: 'TipoShrikhand', file: 'shrikhand.woff2', weight: 400, label: 'Shrikhand', group: 'Cartoon' },
  marker: { family: 'TipoMarker', file: 'permanent-marker.woff2', weight: 400, label: 'Permanent Marker', group: 'Cartoon' },
  // ── Script ──
  caveat700: { family: 'TipoCaveat', file: 'caveat-700.woff2', weight: 700, label: 'Caveat', group: 'Script' },
  lobster: { family: 'TipoLobster', file: 'lobster.woff2', weight: 400, label: 'Lobster', group: 'Script' },
  pacifico: { family: 'TipoPacifico', file: 'pacifico.woff2', weight: 400, label: 'Pacifico', group: 'Script' },
  dancing700: { family: 'TipoDancing', file: 'dancing-700.woff2', weight: 700, label: 'Dancing Script', group: 'Script' },
  greatvibes: { family: 'TipoGreatVibes', file: 'great-vibes.woff2', weight: 400, label: 'Great Vibes', group: 'Script' },
  yellowtail: { family: 'TipoYellowtail', file: 'yellowtail.woff2', weight: 400, label: 'Yellowtail', group: 'Script' },
  kaushan: { family: 'TipoKaushan', file: 'kaushan.woff2', weight: 400, label: 'Kaushan Script', group: 'Script' },
  // ── Condensada ──
  bebas: { family: 'TipoBebas', file: 'bebas-neue.woff2', weight: 400, label: 'Bebas Neue', group: 'Condensada' },
  oswald600: { family: 'TipoOswald', file: 'oswald-600.woff2', weight: 600, label: 'Oswald', group: 'Condensada' },
  barlow800: { family: 'TipoBarlowCond', file: 'barlow-cond-800.woff2', weight: 800, label: 'Barlow Condensed', group: 'Condensada' },
  staatliches: { family: 'TipoStaatliches', file: 'staatliches.woff2', weight: 400, label: 'Staatliches', group: 'Condensada' },
  squada: { family: 'TipoSquada', file: 'squada-one.woff2', weight: 400, label: 'Squada One', group: 'Condensada' },
  teko700: { family: 'TipoTeko', file: 'teko-700.woff2', weight: 700, label: 'Teko', group: 'Condensada' },
  saira800: { family: 'TipoSairaCond', file: 'saira-cond-800.woff2', weight: 800, label: 'Saira Condensed', group: 'Condensada' },
  // ── Tech / FX ──
  russo: { family: 'TipoRusso', file: 'russo-one.woff2', weight: 400, label: 'Russo One', group: 'Tech' },
  blackops: { family: 'TipoBlackOps', file: 'black-ops.woff2', weight: 400, label: 'Black Ops', group: 'Tech' },
  orbitron800: { family: 'TipoOrbitron', file: 'orbitron-800.woff2', weight: 800, label: 'Orbitron', group: 'Tech' },
  audiowide: { family: 'TipoAudiowide', file: 'audiowide.woff2', weight: 400, label: 'Audiowide', group: 'Tech' },
  monoton: { family: 'TipoMonoton', file: 'monoton.woff2', weight: 400, label: 'Monoton', group: 'Tech' },
  pressstart: { family: 'TipoPressStart', file: 'press-start.woff2', weight: 400, label: 'Press Start (pixel)', group: 'Tech' },
  vt323: { family: 'TipoVT323', file: 'vt323.woff2', weight: 400, label: 'VT323 (pixel)', group: 'Tech' },
  righteous: { family: 'TipoRighteous', file: 'righteous.woff2', weight: 400, label: 'Righteous', group: 'Tech' },
  bungee: { family: 'TipoBungee', file: 'bungee.woff2', weight: 400, label: 'Bungee', group: 'Tech' },
  jetbrains700: { family: 'TipoJetBrains', file: 'jetbrains-700.woff2', weight: 700, label: 'JetBrains Mono', group: 'Tech' },
  // ── Serifada ──
  playfair900: { family: 'TipoPlayfair', file: 'playfair-900.woff2', weight: 900, label: 'Playfair Black', group: 'Serifada' },
  playfair900i: { family: 'TipoPlayfair', file: 'playfair-900-italic.woff2', weight: 900, italic: true, label: 'Playfair Itálico', group: 'Serifada' },
  abril: { family: 'TipoAbril', file: 'abril-fatface.woff2', weight: 400, label: 'Abril Fatface', group: 'Serifada' },
  dmserif: { family: 'TipoDMSerif', file: 'dm-serif.woff2', weight: 400, label: 'DM Serif', group: 'Serifada' },
  cinzel800: { family: 'TipoCinzel', file: 'cinzel-800.woff2', weight: 800, label: 'Cinzel', group: 'Serifada' },
  yeseva: { family: 'TipoYeseva', file: 'yeseva-one.woff2', weight: 400, label: 'Yeseva One', group: 'Serifada' },
  // ── Clean ──
  montserrat800: { family: 'TipoMontserrat', file: 'montserrat-800.woff2', weight: 800, label: 'Montserrat Bold', group: 'Clean' },
  poppins800: { family: 'TipoPoppins', file: 'poppins-800.woff2', weight: 800, label: 'Poppins Bold', group: 'Clean' },
  inter800: { family: 'TipoInter', file: 'inter-800.woff2', weight: 800, label: 'Inter Bold', group: 'Clean' },
  // ── Leva premium 2 ──
  bevan: { family: 'TipoBevan', file: 'bevan.woff2', weight: 400, label: 'Bevan', group: 'Impacto' },
  bowlbysc: { family: 'TipoBowlby', file: 'bowlby-sc.woff2', weight: 400, label: 'Bowlby One', group: 'Impacto' },
  sigmar: { family: 'TipoSigmar', file: 'sigmar.woff2', weight: 400, label: 'Sigmar One', group: 'Impacto' },
  paytone: { family: 'TipoPaytone', file: 'paytone.woff2', weight: 400, label: 'Paytone One', group: 'Impacto' },
  concert: { family: 'TipoConcert', file: 'concert-one.woff2', weight: 400, label: 'Concert One', group: 'Impacto' },
  modak: { family: 'TipoModak', file: 'modak.woff2', weight: 400, label: 'Modak (gorda)', group: 'Cartoon' },
  baloo800: { family: 'TipoBaloo', file: 'baloo-800.woff2', weight: 800, label: 'Baloo', group: 'Cartoon' },
  chewy: { family: 'TipoChewy', file: 'chewy.woff2', weight: 400, label: 'Chewy', group: 'Cartoon' },
  ranchers: { family: 'TipoRanchers', file: 'ranchers.woff2', weight: 400, label: 'Ranchers', group: 'Cartoon' },
  creepster: { family: 'TipoCreepster', file: 'creepster.woff2', weight: 400, label: 'Creepster (terror)', group: 'Cartoon' },
  fjalla: { family: 'TipoFjalla', file: 'fjalla.woff2', weight: 400, label: 'Fjalla One', group: 'Condensada' },
  leaguegothic: { family: 'TipoLeague', file: 'league-gothic.woff2', weight: 400, label: 'League Gothic', group: 'Condensada' },
  bigshoulders800: { family: 'TipoBigShoulders', file: 'big-shoulders-800.woff2', weight: 800, label: 'Big Shoulders', group: 'Condensada' },
  khand700: { family: 'TipoKhand', file: 'khand-700.woff2', weight: 700, label: 'Khand', group: 'Condensada' },
  pathway: { family: 'TipoPathway', file: 'pathway.woff2', weight: 400, label: 'Pathway Gothic', group: 'Condensada' },
  michroma: { family: 'TipoMichroma', file: 'michroma.woff2', weight: 400, label: 'Michroma', group: 'Tech' },
  syncopate700: { family: 'TipoSyncopate', file: 'syncopate-700.woff2', weight: 700, label: 'Syncopate', group: 'Tech' },
  fasterone: { family: 'TipoFaster', file: 'faster-one.woff2', weight: 400, label: 'Faster One (speed)', group: 'Tech' },
  zendots: { family: 'TipoZenDots', file: 'zen-dots.woff2', weight: 400, label: 'Zen Dots', group: 'Tech' },
  prata: { family: 'TipoPrata', file: 'prata.woff2', weight: 400, label: 'Prata', group: 'Serifada' },
  cormorant700: { family: 'TipoCormorant', file: 'cormorant-700.woff2', weight: 700, label: 'Cormorant', group: 'Serifada' },
  bodoni800: { family: 'TipoBodoni', file: 'bodoni-800.woff2', weight: 800, label: 'Bodoni Moda', group: 'Serifada' },
  bodoni800i: { family: 'TipoBodoni', file: 'bodoni-800i.woff2', weight: 800, italic: true, label: 'Bodoni Itálico', group: 'Serifada' },
  fraunces900: { family: 'TipoFraunces', file: 'fraunces-900.woff2', weight: 900, label: 'Fraunces Black', group: 'Serifada' },
  fraunces900i: { family: 'TipoFraunces', file: 'fraunces-900i.woff2', weight: 900, italic: true, label: 'Fraunces Itálico', group: 'Serifada' },
  italiana: { family: 'TipoItaliana', file: 'italiana.woff2', weight: 400, label: 'Italiana', group: 'Serifada' },
  marcellus: { family: 'TipoMarcellus', file: 'marcellus.woff2', weight: 400, label: 'Marcellus', group: 'Serifada' },
  rozha: { family: 'TipoRozha', file: 'rozha.woff2', weight: 400, label: 'Rozha One', group: 'Serifada' },
  mrdafoe: { family: 'TipoMrDafoe', file: 'mr-dafoe.woff2', weight: 400, label: 'Mr Dafoe (neon)', group: 'Script' },
  allura: { family: 'TipoAllura', file: 'allura.woff2', weight: 400, label: 'Allura', group: 'Script' },
  parisienne: { family: 'TipoParisienne', file: 'parisienne.woff2', weight: 400, label: 'Parisienne', group: 'Script' },
  sacramento: { family: 'TipoSacramento', file: 'sacramento.woff2', weight: 400, label: 'Sacramento', group: 'Script' },
  alexbrush: { family: 'TipoAlexBrush', file: 'alex-brush.woff2', weight: 400, label: 'Alex Brush', group: 'Script' },
  cookie: { family: 'TipoCookie', file: 'cookie.woff2', weight: 400, label: 'Cookie', group: 'Script' },
  berkshire: { family: 'TipoBerkshire', file: 'berkshire.woff2', weight: 400, label: 'Berkshire Swash', group: 'Script' },
  norican: { family: 'TipoNorican', file: 'norican.woff2', weight: 400, label: 'Norican', group: 'Script' },
};

export const FONT_GROUPS = ['Impacto', 'Cartoon', 'Script', 'Condensada', 'Tech', 'Serifada', 'Clean'] as const;

const loaded = new Map<FontKey, Promise<void>>();

/** Garante que as fontes estão ativas no document.fonts (idempotente). */
export function ensureTypoFonts(keys?: FontKey[]): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const wanted = keys ?? (Object.keys(TYPO_FONTS) as FontKey[]);
  const jobs = wanted.map((key) => {
    const cached = loaded.get(key);
    if (cached) return cached;
    const f = TYPO_FONTS[key];
    const job = (async () => {
      const face = new FontFace(f.family, `url(/fonts/${f.file})`, {
        weight: String(f.weight),
        style: f.italic ? 'italic' : 'normal',
        display: 'swap',
      });
      await face.load();
      document.fonts.add(face);
    })().catch((e) => {
      // Fonte que falhou não pode ficar cacheada como "carregada" — remove
      // a promise pra próxima chamada tentar de novo; o canvas cai no
      // fallback sans-serif enquanto isso (feio mas não quebra).
      loaded.delete(key);
      console.warn(`[tipografia] fonte ${key} falhou:`, e);
    });
    loaded.set(key, job);
    return job;
  });
  return Promise.all(jobs).then(() => undefined);
}

/** String CSS pro ctx.font do canvas. */
export function fontCss(key: FontKey, px: number): string {
  const f = TYPO_FONTS[key];
  return `${f.italic ? 'italic ' : ''}${f.weight} ${px}px ${f.family}, sans-serif`;
}
