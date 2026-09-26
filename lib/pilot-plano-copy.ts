/**
 * PLANO DE CENAS COM COPY (14.09) — o plano traz o TEXTO de cada cena.
 *
 * Antes o "Carregar plano de cenas" só REPARTIA os takes que a análise do doc
 * já tinha criado. No modo CREATOR não existe doc, então o plano chegava sem
 * nada pra repartir e a copy tinha de ser digitada à mão, cena por cena. Com o
 * `texto` na cena, o plano vira a fonte da copy: cada cena gera os próprios
 * takes, no idioma que está escrito (o disparo fala exatamente o que veio).
 *
 * Regras (as mesmas do CREATOR e do buildPlan):
 *  - Avatar III: o texto é cortado em takes de ~20s sem quebrar frase;
 *  - take único (IV/V, gesto, modo imagem): o texto inteiro num take só;
 *  - numeração BODY global na task (sem hook = um vídeo "full body");
 *  - cada take pertence à cena (matchByRole = role da cena, minúsculo) e
 *    carrega o falante declarado, pra o preview e a legenda saberem quem fala;
 *  - cena com `hook: n` (25.09) vira UM take "HOOK n", nunca cortado e fora da
 *    numeração do BODY: sem isso um AD de 2 hooks saía com os dois ganchos
 *    colados no mesmo vídeo, em vez de G1 e G2 com o mesmo body.
 *
 * Puro: o corte entra por parâmetro, então roda em teste sem navegador.
 */

export type CenaComCopy = {
  texto?: string | null;
  falante?: string | null;
  /** Número do hook (1 = G1, 2 = G2...). Ausente = cena de body. */
  hook?: number | null;
};

export type ParteDoPlanoComCopy = {
  label: string;
  text: string;
  matchByRole: string;
  speaker: string | null;
};

/** Normaliza pra comparar cobertura: espaços colapsados, sem bordas. */
export function normalizarCopy(texto: string): string {
  return (texto || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

/** O plano quer ditar a copy quando ALGUMA cena traz texto. */
export function planoTemCopy(cenas: CenaComCopy[]): boolean {
  return cenas.some((c) => normalizarCopy(c.texto || '').length > 0);
}

/**
 * Cenas (já na ordem do vídeo) → takes. `roles[i]` é o role do slot da cena i;
 * `takeUnico(i)` diz se a cena i vai inteira num take; `cortar` é a divisão do
 * Avatar III. Cena sem texto não gera take (o chamador avisa "sem fala").
 */
export function partesDoPlanoComCopy(
  cenas: CenaComCopy[],
  roles: string[],
  takeUnico: (i: number) => boolean,
  cortar: (texto: string) => string[],
): ParteDoPlanoComCopy[] {
  const out: ParteDoPlanoComCopy[] = [];
  let n = 0;
  cenas.forEach((c, i) => {
    const texto = (c.texto || '').replace(/\r\n/g, '\n').trim();
    if (!texto) return;
    const hook = Number(c.hook);
    if (Number.isInteger(hook) && hook > 0) {
      out.push({
        label: `HOOK ${hook}`,
        text: texto,
        matchByRole: (roles[i] || '').toLowerCase(),
        speaker: c.falante || null,
      });
      return;
    }
    const pedacos = takeUnico(i) ? [texto] : cortar(texto);
    for (const p of pedacos) {
      const t = p.trim();
      if (!t) continue;
      n += 1;
      out.push({
        label: `BODY ${n}`,
        text: t,
        matchByRole: (roles[i] || '').toLowerCase(),
        speaker: c.falante || null,
      });
    }
  });
  return out;
}

/**
 * Prova de que nada da copy foi comido no corte: compara o texto das cenas com
 * o texto dos takes, ignorando só espaços. Devolve a diferença de caracteres
 * (0 = cobertura perfeita).
 */
export function diferencaDeCobertura(cenas: CenaComCopy[], partes: Array<{ text: string }>): number {
  const semEspaco = (s: string) => normalizarCopy(s).replace(/\s/g, '');
  const doPlano = cenas.map((c) => semEspaco(c.texto || '')).join('');
  const dosTakes = partes.map((p) => semEspaco(p.text)).join('');
  return dosTakes.length - doPlano.length;
}
