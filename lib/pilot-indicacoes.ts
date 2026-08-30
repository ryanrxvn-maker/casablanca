/**
 * INDICAÇÕES DO COPY — comentários do Google Docs viram direção de cena no
 * ClickUp Pilot.
 *
 * O export?format=html do Docs traz cada comentário como âncora [a]/[b]
 * inline + corpo no rodapé; a extensão (4.18+) entrega `comments:
 * [{marker, context, body}]` e o marcador [x] fica no texto do doc, na
 * posição exata da âncora. Aqui decidimos DE QUEM é cada comentário:
 *
 *  1. SEÇÃO DO AD: o dono é o heading "AD02G1GL - ..." mais próximo ACIMA do
 *     marcador. Mesmo NÚMERO de AD que a task = mesmo anúncio (cobre
 *     GL/G1GL/G2 — grupo de hooks do mesmo AD).
 *  2. AVATAR DONO, em ordem: quem o contexto/corpo menciona (@username); o
 *     papel da linha "Role:" mais próxima ACIMA do marcador (comentário na
 *     fala do Doutor → slot do Doutor); AD de 1 avatar → ele.
 *  3. Sem dono claro num AD multi-avatar → indicação DA TASK.
 *
 * Validado ao vivo (29.08) no doc ADGL-PRPB12: comentário ancorado no hook
 * sob "AD02G1GL - PRPB12", com "Doutor:" na linha acima → slot do Doutor.
 */

export type ComentarioDoc = { marker: string; context: string; body: string };

export type SlotPraIndicacao = { role: string; username: string | null };

export type ResultadoIndicacoes = {
  /** Indicações por slot, alinhado ao array de entrada. */
  porSlot: string[][];
  /** Indicações do AD sem avatar dono claro. */
  daTask: string[];
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

export function associarIndicacoes(opts: {
  docText: string;
  baseAdId: string;
  comments: ComentarioDoc[];
  slots: SlotPraIndicacao[];
}): ResultadoIndicacoes {
  const { docText, baseAdId, comments, slots } = opts;
  const porSlot: string[][] = slots.map(() => []);
  const daTask: string[] = [];
  const numTask = numeroDoAd(baseAdId);
  if (!numTask || !comments?.length) return { porSlot, daTask };

  const linhas = String(docText || '').split(/\r?\n/);

  for (const c of comments) {
    const body = (c?.body || '').trim();
    const marker = (c?.marker || '').trim();
    if (!body || !marker) continue;
    const tag = `[${marker}]`;
    const idxMarcador = linhas.findIndex((l) => l.includes(tag));
    if (idxMarcador < 0) continue;

    // (1) AD dono = heading mais próximo acima do marcador.
    let adDono: string | null = null;
    for (let k = idxMarcador; k >= 0; k--) {
      const hm = HEADING_RE.exec(linhas[k]);
      if (hm) { adDono = hm[1].toUpperCase(); break; }
    }
    if (numeroDoAd(adDono) !== numTask) continue; // é de outro AD

    // (2) avatar dono
    let donoIdx = -1;
    const ctxNorm = norm(c.context || '');
    const bodyNorm = norm(body);
    for (let si = 0; si < slots.length; si++) {
      const uNorm = norm(slots[si].username || '');
      if (uNorm && uNorm.length >= 4 && (ctxNorm.includes(uNorm) || bodyNorm.includes(uNorm))) {
        donoIdx = si;
        break;
      }
    }
    if (donoIdx < 0) {
      // papel da linha "Role:" mais próxima acima (parando noutro heading)
      for (let k = idxMarcador; k >= 0 && k > idxMarcador - 25; k--) {
        if (k < idxMarcador && HEADING_RE.test(linhas[k])) break;
        const rm = /^\s*([\p{L}\s]{2,30}?)\s*:/u.exec(linhas[k]);
        if (!rm) continue;
        const rNorm = norm(rm[1]);
        const achado = slots.findIndex((s) => {
          const sNorm = norm(s.role || '');
          return !!sNorm && !!rNorm && (sNorm === rNorm || sNorm.includes(rNorm) || rNorm.includes(sNorm));
        });
        if (achado >= 0) { donoIdx = achado; break; }
      }
    }
    if (donoIdx < 0 && slots.length === 1) donoIdx = 0;

    if (donoIdx >= 0) {
      if (!porSlot[donoIdx].includes(body)) porSlot[donoIdx].push(body);
    } else if (!daTask.includes(body)) {
      daTask.push(body);
    }
  }
  return { porSlot, daTask };
}
