/**
 * REVISOR DE COPY — pega defeito de texto ANTES de virar take pago.
 *
 * Nasceu em 23.08, depois de um AD sair do HeyGen com o avatar dizendo
 * "A mulher que fala que TÁ não importa" — o doc tinha "tamanho" truncado pra
 * "tá", o parser copiou fiel, a auditoria de cena não olhava ortografia e só
 * se viu com o vídeo pronto na mão.
 *
 * O que dá pra provar por regra está aqui. O que é semântico (frase que existe,
 * está escrita certa, mas não quer dizer nada) precisa de leitura — por isso
 * cada achado é um AVISO pro humano, não um bloqueio: o objetivo é que ninguém
 * dispare sem ter olhado, não decidir sozinho o que é erro.
 */

export type AchadoCopy = {
  /** o trecho exato que acendeu o alerta */
  trecho: string;
  /** o que parece estar errado, em uma linha */
  motivo: string;
  /** 'alto' = quase sempre é defeito; 'medio' = vale um olho */
  peso: 'alto' | 'medio';
  /** posição no texto, pra destacar na UI */
  inicio: number;
};

/** Palavras curtas que aparecem NO LUGAR de uma palavra maior e passam batido
 *  porque existem no idioma. A chave é o contexto, não a palavra. */
const TRUNCADAS: Array<{ re: RegExp; motivo: string }> = [
  {
    // "que tá não importa" ← "que TAMANHO não importa"
    re: /\bque\s+t[áa]\s+n[ãa]o\b/gi,
    motivo: 'parece faltar uma palavra: "que tá não…" — o doc pode ter truncado "tamanho"',
  },
  {
    re: /\bde\s+t[áa]\s/gi,
    motivo: '"de tá" não existe — provável palavra truncada',
  },
];

/** Erros MECÂNICOS: dá pra afirmar sem interpretar. */
function mecanicos(t: string): AchadoCopy[] {
  const out: AchadoCopy[] = [];
  const push = (trecho: string, motivo: string, peso: AchadoCopy['peso'], inicio: number) =>
    out.push({ trecho, motivo, peso, inicio });

  // palavra repetida colada ("no no meu perfil")
  const rep = /\b(\p{L}{2,})\s+\1\b/giu;
  for (const m of t.matchAll(rep)) {
    // "que que" e "só só" às vezes são fala de propósito; peso médio.
    push(m[0], 'palavra repetida: "' + m[1] + ' ' + m[1] + '"', 'alto', m.index ?? 0);
  }
  // espaço duplo e espaço antes de pontuação
  for (const m of t.matchAll(/ {2,}/g)) push('␣␣', 'espaço duplo', 'medio', m.index ?? 0);
  for (const m of t.matchAll(/\s+[,.;:!?]/g)) push(m[0].trim(), 'espaço antes da pontuação', 'medio', m.index ?? 0);
  // número grudado em letra ("443%transformando")
  for (const m of t.matchAll(/\d[%]?\p{L}{3,}/gu)) push(m[0], 'número grudado na palavra', 'alto', m.index ?? 0);
  // parêntese/aspas sem par
  const par = (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
  if (par !== 0) push('( )', 'parêntese sem par', 'medio', t.indexOf('('));
  // reticências viradas em ponto solto no fim ("truque." quando era "truque…")
  for (const m of t.matchAll(/\p{L}\.{2}(?!\.)/gu)) push(m[0], 'dois pontos finais seguidos', 'medio', m.index ?? 0);
  return out;
}

/**
 * Revisa a copy de UM take.
 *
 * `marcadores` é a lista de rótulos do doc (falantes, seções) — se um deles
 * sobrou dentro da fala, é vazamento do parser e o avatar diria em voz alta.
 */
export function revisarCopy(texto: string, marcadores: string[] = []): AchadoCopy[] {
  const t = String(texto || '');
  if (!t.trim()) return [{ trecho: '', motivo: 'take VAZIO — não vira vídeo', peso: 'alto', inicio: 0 }];

  const out: AchadoCopy[] = [...mecanicos(t)];

  for (const { re, motivo } of TRUNCADAS) {
    for (const m of t.matchAll(re)) out.push({ trecho: m[0], motivo, peso: 'alto', inicio: m.index ?? 0 });
  }

  // rótulo do doc dentro da fala
  for (const marca of marcadores) {
    const mm = String(marca || '').trim();
    if (mm.length < 3) continue;
    const re = new RegExp('(^|\\n)\\s*' + mm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?', 'gi');
    for (const m of t.matchAll(re)) {
      out.push({ trecho: mm, motivo: 'rótulo do doc ("' + mm + '") sobrou na fala — o avatar diria em voz alta',
                 peso: 'alto', inicio: m.index ?? 0 });
    }
  }

  // nome de arquivo / link que escapou pro texto falado
  for (const m of t.matchAll(/\S+\.(mp4|mov|jpg|png)\b|https?:\/\/\S+/gi)) {
    out.push({ trecho: m[0], motivo: 'arquivo ou link dentro da fala', peso: 'alto', inicio: m.index ?? 0 });
  }

  return out.sort((a, b) => (a.peso === b.peso ? a.inicio - b.inicio : a.peso === 'alto' ? -1 : 1));
}

/** Revisa um lote de takes. Devolve só quem tem achado. */
export function revisarTakes(
  takes: Array<{ label: string; text: string }>,
  marcadores: string[] = [],
): Array<{ label: string; achados: AchadoCopy[] }> {
  return takes
    .map((t) => ({ label: t.label, achados: revisarCopy(t.text, marcadores) }))
    .filter((x) => x.achados.length > 0);
}

/** Resumo curto pra badge: quantos de peso alto. */
export function contarGraves(achados: AchadoCopy[]): number {
  return achados.filter((a) => a.peso === 'alto').length;
}
