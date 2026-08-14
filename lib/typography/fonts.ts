/**
 * Fontes display da Tipografia Automática — self-hosted em /public/fonts
 * (woff2, subset latin, licença OFL). Carregadas via FontFace API porque o
 * canvas 2D precisa da fonte JÁ ativa no document.fonts na hora do fillText;
 * next/font não serve aqui (nome com hash + carregamento por CSS não garante
 * disponibilidade síncrona pro rasterizador do canvas).
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
  | 'oswald600';

export type TypoFont = {
  family: string; // nome único registrado no document.fonts
  file: string;
  weight: number;
  italic?: boolean;
  label: string;
};

export const TYPO_FONTS: Record<FontKey, TypoFont> = {
  anton: { family: 'TipoAnton', file: 'anton.woff2', weight: 400, label: 'Anton' },
  archivo: { family: 'TipoArchivoBlack', file: 'archivo-black.woff2', weight: 400, label: 'Archivo Black' },
  bebas: { family: 'TipoBebas', file: 'bebas-neue.woff2', weight: 400, label: 'Bebas Neue' },
  montserrat800: { family: 'TipoMontserrat', file: 'montserrat-800.woff2', weight: 800, label: 'Montserrat Bold' },
  montserrat900: { family: 'TipoMontserrat', file: 'montserrat-900.woff2', weight: 900, label: 'Montserrat Black' },
  poppins800: { family: 'TipoPoppins', file: 'poppins-800.woff2', weight: 800, label: 'Poppins Bold' },
  inter800: { family: 'TipoInter', file: 'inter-800.woff2', weight: 800, label: 'Inter Bold' },
  playfair900: { family: 'TipoPlayfair', file: 'playfair-900.woff2', weight: 900, label: 'Playfair Black' },
  playfair900i: { family: 'TipoPlayfair', file: 'playfair-900-italic.woff2', weight: 900, italic: true, label: 'Playfair Itálico' },
  marker: { family: 'TipoMarker', file: 'permanent-marker.woff2', weight: 400, label: 'Permanent Marker' },
  jetbrains700: { family: 'TipoJetBrains', file: 'jetbrains-700.woff2', weight: 700, label: 'JetBrains Mono' },
  nunito900: { family: 'TipoNunito', file: 'nunito-900.woff2', weight: 900, label: 'Nunito Black' },
  oswald600: { family: 'TipoOswald', file: 'oswald-600.woff2', weight: 600, label: 'Oswald' },
};

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
