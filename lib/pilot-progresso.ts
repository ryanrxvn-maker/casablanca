/**
 * A MATEMÁTICA DA BARRA DE PROGRESSO do MODO ECONOMIA.
 *
 * ⚠ POR QUE ISTO EXISTE, e por que mora numa lib com teste.
 *
 * A barra do card do Pilot é calculada por CONTAGEM DE PARTES
 * (`partsDispatched` / `partsRendered`, em BatchJobCard3D). No modo economia
 * nenhuma parte ganha `videoId` enquanto o job roda — o resultado só volta no
 * fim, inteiro. Resultado medido: a barra ficava **cravada no mínimo (3%)** do
 * começo ao fim de um disparo de vários minutos e só pulava pra 100%. O texto
 * mudava, a barra não. Foi exatamente a reclamação do Silas: "a barra fica
 * travada".
 *
 * Agora a extensão informa por onde anda, e estas funções definem o formato
 * dessa caminhada. As mesmas fórmulas estão espelhadas em
 * `extension/heygen-content.js` (`ecoFaixaDaCena` / `ecoPctDaEspera`), e
 * `pilot-progresso.test.ts` LÊ O ARQUIVO DA EXTENSÃO pra provar que as duas
 * cópias não divergiram — sem isso, mexer num lado e esquecer o outro voltaria
 * a travar a barra, e só o usuário descobriria.
 *
 * As três propriedades que a barra precisa ter, e que o teste garante:
 *   1. NUNCA anda pra trás (o usuário lê recuo como "deu errado");
 *   2. NUNCA fica parada muito tempo — durante a espera do render, que é a
 *      etapa mais longa, ela tem que se mexer a cada volta do laço;
 *   3. NUNCA invade a faixa da cena seguinte (senão passaria de 100% ou
 *      voltaria atrás quando a próxima cena começasse).
 */

/** Quanto da barra é reservado ao preparo (voz, bancada, leitura do draft). */
export const PCT_PREPARO = 6;
/** Quanto da barra as cenas dividem entre si. O resto (94→100) é o fecho. */
export const PCT_UTIL = 88;
/** Constante de tempo da curva de espera, em ms. Escolhida pra que um render
 *  típico (~30s) já tenha subido a maior parte da faixa, sem estourar num
 *  render lento. */
export const ESPERA_TAU_MS = 25000;
/** Onde a espera COMEÇA dentro da faixa da cena (o render foi aceito). */
export const ESPERA_PISO = 0.35;
/** Quanto da faixa a espera pode percorrer. PISO+ALCANCE < 1 de propósito: a
 *  curva nunca alcança o fim da faixa, então nunca invade a cena seguinte. */
export const ESPERA_ALCANCE = 0.58;

export type Faixa = { inicio: number; largura: number };

/** A fatia da barra que pertence à cena `i` de `total`. */
export function faixaDaCena(i: number, total: number): Faixa {
  const n = Math.max(1, total);
  const idx = Math.max(0, Math.min(n - 1, i));
  return { inicio: PCT_PREPARO + (idx / n) * PCT_UTIL, largura: PCT_UTIL / n };
}

/** Onde a barra fica com `decorridoMs` de espera pelo render.
 *  Sobe rápido no começo e vai freando — sempre andando, nunca chegando. */
export function pctDaEspera(inicio: number, largura: number, decorridoMs: number): number {
  const k = 1 - Math.exp(-Math.max(0, decorridoMs) / ESPERA_TAU_MS);
  return inicio + largura * (ESPERA_PISO + ESPERA_ALCANCE * k);
}

/** Os marcos fixos dentro da faixa de uma cena, em fração da largura. */
export const MARCOS = {
  montando: 0.05,
  gerandoFala: 0.1,
  falaPronta: 0.28,
  renderizando: 0.32,
  renderAceito: 0.36,
  pronta: 0.99,
} as const;

export type Evento = { t: number; pct: number; msg: string };

/**
 * A linha do tempo COMPLETA de um disparo, do jeito que a extensão emite.
 * Serve pro preview (`/dev/pilot-preview`) mostrar a barra andando de verdade
 * e pro teste medir as três propriedades sem precisar de HeyGen nenhum.
 *
 * `duracoes` = quanto cada cena leva no render, em segundos.
 */
export function linhaDoTempoEconomia(duracoesSeg: number[]): Evento[] {
  const total = Math.max(1, duracoesSeg.length);
  const ev: Evento[] = [];
  let t = 0;
  const põe = (pct: number, msg: string) => {
    const anterior = ev.length ? ev[ev.length - 1].pct : 0;
    ev.push({ t, pct: Math.max(anterior, Math.min(99, pct)), msg });
  };

  põe(2, 'Economia: voz encontrada');
  t += 1;
  põe(4, 'Economia: bancada reaproveitada');
  t += 1;
  põe(5, 'Economia: lendo o projeto...');

  for (let i = 0; i < total; i++) {
    const { inicio, largura } = faixaDaCena(i, total);
    const rot = `cena ${i + 1}/${total}`;
    t += 1;
    põe(inicio + largura * MARCOS.montando, `${rot}: montando a cena...`);
    põe(inicio + largura * MARCOS.gerandoFala, `${rot}: gerando a fala...`);
    t += 5;
    põe(inicio + largura * MARCOS.falaPronta, `${rot}: fala pronta`);
    põe(inicio + largura * MARCOS.renderizando, `${rot}: renderizando (Avatar III, 0 credito)...`);
    t += 1;
    põe(inicio + largura * MARCOS.renderAceito, `${rot}: render aceito`);

    // A espera: uma volta a cada 4s, que é o passo real do laço.
    const espera = Math.max(0, duracoesSeg[i] ?? 30);
    for (let s = 4; s <= espera; s += 4) {
      t += 4;
      põe(pctDaEspera(inicio, largura, s * 1000), `${rot}: renderizando ha ${s}s...`);
    }
    t += 1;
    põe(inicio + largura * MARCOS.pronta, `${rot}: pronta`);
  }

  t += 1;
  põe(97, `Economia: ${total} cena(s) renderizada(s)`);
  return ev;
}
