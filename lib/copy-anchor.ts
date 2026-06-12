/**
 * Atribuição de locutor ANCORADA NA COPY (ground truth).
 *
 * POR QUE (2026-06-11): nem diarização (AssemblyAI) nem pitch (F0) deram
 * 100% de acerto nos ADs reais. Mas o doc tem a "Link da Copy" — o ROTEIRO
 * EXATO que o avatar PRINCIPAL (Doutor) lê. O depoimento (Mulher) é uma
 * fala DIFERENTE, que NÃO está na copy. Logo:
 *   - trecho transcrito que CASA com a copy  → principal (Doutor)
 *   - trecho que NÃO casa                    → depoimento (Mulher)
 *
 * Isso é determinístico e usa a verdade do roteiro, não um chute acústico.
 * Robusto a erros de ASR e à improvisação da voz AI via overlap de
 * n-gramas (não exige match exato).
 *
 * Quando a copy não separa (todas as falas casam, ou nenhuma) devolve
 * confident=false e o caller cai pro pitch/AssemblyAI.
 */

/** Normaliza pra matching: minúsculas, sem acento, só palavras. */
function tokens(s: string): string[] {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Conjunto de n-gramas (default trigramas) de uma lista de tokens. */
function ngrams(toks: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= toks.length; i++) {
    out.add(toks.slice(i, i + n).join(' '));
  }
  return out;
}

export type CopyAnchorResult = {
  confident: boolean;
  /** por utterance: 0 = principal (casa copy), 1 = depoimento (não casa) */
  ranks: number[] | null;
  /** cobertura [0..1] de cada utterance contra a copy (debug/UI) */
  coverage: number[] | null;
  reason: string;
};

/**
 * @param utts  utterances transcritas (texto), em ordem
 * @param copyText  texto do doc da copy (roteiro do principal)
 */
export function attributeByCopy(
  utts: Array<{ text: string }>,
  copyText: string,
): CopyAnchorResult {
  if (!utts.length) return { confident: false, ranks: null, coverage: null, reason: 'sem utterances' };
  const copyToks = tokens(copyText);
  if (copyToks.length < 20) {
    return { confident: false, ranks: null, coverage: null, reason: `copy curta demais (${copyToks.length} palavras)` };
  }
  // Conjuntos de bi e trigramas da copy — bigrama dá robustez a trechos
  // curtos e a erros de ASR; trigrama dá precisão.
  const copyTri = ngrams(copyToks, 3);
  const copyBi = ngrams(copyToks, 2);

  // Cobertura por utterance: fração dos n-gramas da utterance presentes na
  // copy. Usa trigrama; se a utterance é curta (<3 tokens p/ trigrama),
  // cai pra bigrama; <2 tokens, unigrama-no-set.
  const copyUni = new Set(copyToks);
  const coverage = utts.map((u) => {
    const ut = tokens(u.text);
    if (ut.length === 0) return -1; // sem texto — neutro
    if (ut.length >= 3) {
      const g = ngrams(ut, 3);
      let hit = 0;
      for (const x of g) if (copyTri.has(x)) hit++;
      return g.size ? hit / g.size : 0;
    }
    if (ut.length === 2) {
      return copyBi.has(ut.join(' ')) ? 1 : 0;
    }
    return copyUni.has(ut[0]) ? 1 : 0;
  });

  // Decisão: principal = cobertura ALTA. Threshold 0.5 separa bem (doutor
  // lê verbatim → 0.7-1.0; depoimento improvisado → 0.0-0.2). Utterances
  // sem texto (-1) herdam o vizinho anterior.
  const HI = 0.5;
  let nPrincipal = 0;
  let nDepo = 0;
  const ranks = coverage.map((c) => {
    if (c < 0) return -2; // marcador "herdar"
    if (c >= HI) { nPrincipal++; return 0; }
    nDepo++;
    return 1;
  });
  // herda vizinho pros sem-texto
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] === -2) ranks[i] = i > 0 && ranks[i - 1] >= 0 ? ranks[i - 1] : 0;
  }

  // confiança: precisa ter AMBOS os grupos com tamanho mínimo. Se tudo
  // casou (sem depoimento detectável) OU nada casou (copy errada/ASR ruim)
  // → não separou.
  if (nPrincipal === 0) {
    return { confident: false, ranks: null, coverage, reason: 'nenhum trecho casou com a copy (copy errada ou ASR ruim)' };
  }
  if (nDepo === 0) {
    return { confident: false, ranks: null, coverage, reason: 'TODOS os trechos casaram com a copy — sem depoimento separável por texto' };
  }
  // tempo/qtd mínima do depoimento pra não classificar 1 frase solta como locutor
  if (nDepo < 1) {
    return { confident: false, ranks: null, coverage, reason: 'depoimento muito pequeno' };
  }
  return {
    confident: true,
    ranks,
    coverage,
    reason: `copy separou ${nPrincipal} trecho(s) do roteiro (principal) e ${nDepo} fora dele (depoimento)`,
  };
}
