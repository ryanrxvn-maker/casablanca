/**
 * INDICAÇÕES DO COPY — comentários do Google Docs viram direção de cena no
 * ClickUp Pilot.
 *
 * O export?format=html do Docs traz cada comentário como âncora [a]/[b]
 * inline + corpo no rodapé; a extensão (4.18+) entrega `comments:
 * [{marker, context, body}]` e o marcador [x] fica no texto do doc, na
 * posição exata da âncora. Aqui decidimos DE QUEM é cada comentário.
 *
 * DOIS TIPOS de indicação (revisão do Silas, 29.08):
 *
 *  · INDICAÇÃO DE AVATAR — o comentário fala do AVATAR: ancora na linha que
 *    declara o avatar (linha contém o @username) OU menciona o @username no
 *    contexto/corpo. Vira o botão DOURADO no card do avatar.
 *
 *  · INDICAÇÃO DE COPY — o comentário ancora num trecho do HOOK/BODY (ou em
 *    qualquer outra linha da seção do AD). NÃO é o mesmo indicador: vira o
 *    botão AZUL no topo do card, com o TRECHO comentado + em qual TAKE ele
 *    caiu (casado contra os textos das partes).
 *
 * Escopo por AD: o dono é o heading "AD02G1GL - ..." mais próximo ACIMA do
 * marcador; mesmo NÚMERO de AD que a task = mesmo anúncio (GL/G1GL/G2 são o
 * grupo de hooks do mesmo AD). Comentário de outro AD nunca vaza.
 */

export type ComentarioDoc = {
  marker: string;
  context: string;
  body: string;
  /** hrefs capturados do HTML do comentário (extensão 4.18.1+) — texto
   *  hiperlinkado perde a URL no strip de tags; aqui ela sobrevive. */
  links?: string[];
};

export type SlotPraIndicacao = { role: string; username: string | null };

export type PartePraIndicacao = { label: string; text: string };

/** Um link citado numa indicação, já resolvido pra UI: tipo + thumb + rótulo. */
export type LinkIndicacao = {
  url: string;
  tipo: 'drive' | 'youtube' | 'tiktok' | 'instagram' | 'imagem' | 'docs' | 'link';
  /** 1ª URL de thumbnail exibível. null = sem thumb pública (TikTok/Instagram
   *  /genérico) → a UI mostra o glifo da plataforma. */
  thumb: string | null;
  /** TODOS os candidatos de thumb, em ordem de tentativa: o endpoint de
   *  thumbnail do Drive falha em alguns arquivos e o `lh3` pega — a UI cai
   *  pro próximo quando o <img> dá erro (mesma tática do picker de avatar). */
  thumbs: string[];
  /** Para onde vai o botão BAIXAR:
   *   · 'direto'     → href de download direto (Drive `uc?export=download`,
   *                    imagem) — o navegador baixa.
   *   · 'downloader' → abre o Downloader do AutoEdit já com a URL colada
   *                    (YouTube, TikTok, Instagram: precisam do motor).
   *   · null         → não há como baixar (Docs, link genérico). */
  baixar: { modo: 'direto' | 'downloader'; href: string } | null;
  rotulo: string;
};

export type IndicacaoAvatar = { nota: string; links: LinkIndicacao[] };

export type IndicacaoCopy = {
  /** Label do take onde o trecho comentado caiu (HOOK 1, BODY 2...). null =
   *  a âncora está na seção mas fora dos textos falados (ex: Observações). */
  take: string | null;
  /** O trecho do doc onde o comentário foi ancorado. */
  trecho: string;
  /** O comentário em si. */
  nota: string;
  links: LinkIndicacao[];
};

export type ResultadoIndicacoes = {
  /** Indicações DE AVATAR por slot, alinhado ao array de entrada. */
  porSlot: IndicacaoAvatar[][];
  /** Indicações de avatar sem slot resolvível (raro — username que não casou). */
  daTask: IndicacaoAvatar[];
  /** Indicações DE COPY (hook/body) — o outro botão. */
  copy: IndicacaoCopy[];
};

/* ═══════════════ Links citados nas indicações ═══════════════ */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function idDoDrive(u: string): string | null {
  const m =
    /\/(?:file\/)?d\/([a-zA-Z0-9_-]{15,})/.exec(u) ||
    /[?&]id=([a-zA-Z0-9_-]{15,})/.exec(u);
  return m ? m[1] : null;
}

function idDoYouTube(u: string): string | null {
  const m =
    /youtu\.be\/([a-zA-Z0-9_-]{6,})/.exec(u) ||
    /[?&]v=([a-zA-Z0-9_-]{6,})/.exec(u) ||
    /\/shorts\/([a-zA-Z0-9_-]{6,})/.exec(u) ||
    /\/embed\/([a-zA-Z0-9_-]{6,})/.exec(u);
  return m ? m[1] : null;
}

/** Resolve UMA url pra {tipo, thumb, rotulo}. Exportada pro teste/reuso. */
export function resolverLinkIndicacao(urlBruta: string): LinkIndicacao {
  let url = String(urlBruta || '').trim().replace(/[.,;)\]]+$/, '');
  // Redirect do Google (links de comentário vêm embrulhados em /url?q=)
  const q = /[?&]q=([^&]+)/.exec(url);
  if (q && /google\.com\/url/i.test(url)) {
    try { url = decodeURIComponent(q[1]); } catch { /* usa como veio */ }
  }
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* rótulo genérico */ }

  const comThumbs = (base: Omit<LinkIndicacao, 'thumb' | 'thumbs'> & { thumbs: string[] }): LinkIndicacao => ({
    ...base,
    thumb: base.thumbs[0] || null,
  });
  /** O Downloader do AutoEdit já com a URL colada (YouTube/TikTok/Instagram). */
  const viaDownloader = (u: string) => ({ modo: 'downloader' as const, href: `/tools/downloader?url=${encodeURIComponent(u)}` });

  if (/drive\.google\.com|docs\.google\.com\/file/i.test(url)) {
    const id = idDoDrive(url);
    return comThumbs({
      url,
      tipo: 'drive',
      // dois endpoints: o `thumbnail` cobre a maioria; o `lh3` pega os que
      // ele recusa (arquivo grande / tipo sem preview gerado ainda).
      thumbs: id
        ? [`https://drive.google.com/thumbnail?id=${id}&sz=w400`, `https://lh3.googleusercontent.com/d/${id}=w400`]
        : [],
      baixar: id ? { modo: 'direto', href: `https://drive.google.com/uc?export=download&id=${id}` } : null,
      rotulo: 'Drive',
    });
  }
  if (/docs\.google\.com\/(document|spreadsheets|presentation)/i.test(url)) {
    return comThumbs({ url, tipo: 'docs', thumbs: [], baixar: null, rotulo: 'Google Docs' });
  }
  if (/youtube\.com|youtu\.be/i.test(url)) {
    const id = idDoYouTube(url);
    return comThumbs({
      url,
      tipo: 'youtube',
      thumbs: id ? [`https://img.youtube.com/vi/${id}/hqdefault.jpg`, `https://img.youtube.com/vi/${id}/mqdefault.jpg`] : [],
      baixar: viaDownloader(url),
      rotulo: 'YouTube',
    });
  }
  if (/tiktok\.com/i.test(url)) {
    return comThumbs({ url, tipo: 'tiktok', thumbs: [], baixar: viaDownloader(url), rotulo: 'TikTok' });
  }
  if (/instagram\.com/i.test(url)) {
    return comThumbs({ url, tipo: 'instagram', thumbs: [], baixar: viaDownloader(url), rotulo: 'Instagram' });
  }
  if (/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(url) || /googleusercontent\.com/i.test(url)) {
    return comThumbs({ url, tipo: 'imagem', thumbs: [url], baixar: { modo: 'direto', href: url }, rotulo: 'Imagem' });
  }
  return comThumbs({ url, tipo: 'link', thumbs: [], baixar: null, rotulo: host || 'Link' });
}

/** Junta os hrefs do HTML do comentário com URLs coladas no texto e resolve
 *  cada uma (dedupe por URL final). */
export function linksDaIndicacao(texto: string, hrefs?: string[] | null): LinkIndicacao[] {
  const brutos: string[] = [];
  for (const h of hrefs || []) { if (h) brutos.push(h); }
  const doTexto = String(texto || '').match(URL_RE) || [];
  brutos.push(...doTexto);
  const out: LinkIndicacao[] = [];
  const vistos = new Set<string>();
  for (const b of brutos) {
    const r = resolverLinkIndicacao(b);
    if (!r.url || vistos.has(r.url)) continue;
    vistos.add(r.url);
    out.push(r);
  }
  return out;
}

/** Mesma normalização do matcher do Pilot: sem acento, sem pontuação, minúsculas. */
function norm(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(mp4|mov)$/i, '')
    .replace(/[^\w]/g, '');
}

const HEADING_RE = /^\s*(AD\d+[A-Z0-9]*)\s*[-–—]/i;

function numeroDoAd(ad: string | null | undefined): string | null {
  const m = /^AD0*(\d+)/i.exec(String(ad || '').trim());
  return m ? m[1] : null;
}

/** Tira todos os marcadores de comentário ([a], [ab]) de uma linha. */
function limparMarcadores(s: string): string {
  return String(s || '').replace(/\s*\[[a-z]{1,3}\]/gi, '').trim();
}

export function associarIndicacoes(opts: {
  docText: string;
  baseAdId: string;
  comments: ComentarioDoc[];
  slots: SlotPraIndicacao[];
  /** Textos dos takes (partTemplates) — é contra eles que a indicação de
   *  copy descobre EM QUAL take o trecho comentado caiu. Opcional: sem eles,
   *  a indicação sai com take null (só o trecho). */
  partes?: PartePraIndicacao[];
}): ResultadoIndicacoes {
  const { docText, baseAdId, comments, slots } = opts;
  const partes = opts.partes || [];
  const porSlot: IndicacaoAvatar[][] = slots.map(() => []);
  const daTask: IndicacaoAvatar[] = [];
  const copy: IndicacaoCopy[] = [];
  const numTask = numeroDoAd(baseAdId);
  if (!numTask || !comments?.length) return { porSlot, daTask, copy };

  const linhas = String(docText || '').split(/\r?\n/);
  // Partes normalizadas UMA vez (o include roda por comentário).
  const partesNorm = partes.map((p) => ({ label: p.label, texto: norm(p.text) }));

  for (const c of comments) {
    const nota = (c?.body || '').trim();
    const marker = (c?.marker || '').trim();
    if (!nota || !marker) continue;
    const tag = `[${marker}]`;
    const idxMarcador = linhas.findIndex((l) => l.includes(tag));
    if (idxMarcador < 0) continue;

    // Escopo: AD dono = heading mais próximo acima do marcador.
    let adDono: string | null = null;
    for (let k = idxMarcador; k >= 0; k--) {
      const hm = HEADING_RE.exec(linhas[k]);
      if (hm) { adDono = hm[1].toUpperCase(); break; }
    }
    if (numeroDoAd(adDono) !== numTask) continue; // é de outro AD

    const linhaDaAncora = limparMarcadores(linhas[idxMarcador]);
    const linhaNorm = norm(linhaDaAncora);
    const ctxNorm = norm(c.context || '');
    const notaNorm = norm(nota);

    // ══ INDICAÇÃO DE AVATAR? ══ Só quando o comentário fala do avatar:
    // ancora na linha que DECLARA o avatar (linha contém o @username) ou
    // menciona o @username no contexto/corpo.
    let slotIdx = -1;
    for (let si = 0; si < slots.length; si++) {
      const uNorm = norm(slots[si].username || '');
      if (!uNorm || uNorm.length < 4) continue;
      if (linhaNorm.includes(uNorm) || ctxNorm.includes(uNorm) || notaNorm.includes(uNorm)) {
        slotIdx = si;
        break;
      }
    }
    if (slotIdx >= 0) {
      if (!porSlot[slotIdx].some((x) => x.nota === nota)) {
        porSlot[slotIdx].push({ nota, links: linksDaIndicacao(nota, c.links) });
      }
      continue;
    }

    // ══ INDICAÇÃO DE COPY ══ ancorou num trecho da seção (hook/body/etc).
    // Em qual take o trecho caiu? Casa a linha da âncora contra os textos
    // das partes (substring normalizada; linha curta demais não decide).
    let take: string | null = null;
    if (linhaNorm.length >= 12) {
      const hit = partesNorm.find((p) => p.texto.includes(linhaNorm));
      if (hit) take = hit.label;
    }
    if (!take && linhaNorm.length >= 4) {
      // Linha parcial (âncora numa frase que o split partiu): tenta pelo
      // começo da linha (primeiros ~24 chars normalizados).
      const inicio = linhaNorm.slice(0, 24);
      if (inicio.length >= 12) {
        const hit = partesNorm.find((p) => p.texto.includes(inicio));
        if (hit) take = hit.label;
      }
    }
    const trecho = linhaDaAncora || (c.context || '').trim().slice(-120);
    if (!copy.some((x) => x.nota === nota && x.trecho === trecho)) {
      copy.push({ take, trecho, nota, links: linksDaIndicacao(nota, c.links) });
    }
  }
  return { porSlot, daTask, copy };
}
