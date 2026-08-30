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

export type ComentarioDoc = { marker: string; context: string; body: string };

export type SlotPraIndicacao = { role: string; username: string | null };

export type PartePraIndicacao = { label: string; text: string };

export type IndicacaoCopy = {
  /** Label do take onde o trecho comentado caiu (HOOK 1, BODY 2...). null =
   *  a âncora está na seção mas fora dos textos falados (ex: Observações). */
  take: string | null;
  /** O trecho do doc onde o comentário foi ancorado. */
  trecho: string;
  /** O comentário em si. */
  nota: string;
};

export type ResultadoIndicacoes = {
  /** Indicações DE AVATAR por slot, alinhado ao array de entrada. */
  porSlot: string[][];
  /** Indicações de avatar sem slot resolvível (raro — username que não casou). */
  daTask: string[];
  /** Indicações DE COPY (hook/body) — o outro botão. */
  copy: IndicacaoCopy[];
};

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
  const porSlot: string[][] = slots.map(() => []);
  const daTask: string[] = [];
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
      if (!porSlot[slotIdx].includes(nota)) porSlot[slotIdx].push(nota);
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
      copy.push({ take, trecho, nota });
    }
  }
  return { porSlot, daTask, copy };
}
