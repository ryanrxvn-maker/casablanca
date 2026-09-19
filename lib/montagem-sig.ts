/** ═══ A PROVA DE QUE O MONTADO E' O DE AGORA ═══
 *
 *  23.08: cinco ADs corrigidos take a take. Um deles (AD06) seguiu mostrando
 *  selo verde "Pronto" com o download liberado — e o arquivo montado era o de
 *  ANTES da correcao. O video baixado parecia certo; so' comparando o frame
 *  inicial com o do avatar corrigido deu pra ver que era o velho.
 *
 *  A raiz: `dirtyParts` e' um flag de INTENCAO — quem regenera precisa lembrar
 *  de marcar. Basta um caminho novo esquecer, ou um Retomar limpar o flag, e o
 *  card volta a mentir com o download aberto.
 *
 *  Aqui o estado e' DERIVADO do conteudo: a montagem carimba QUAIS takes
 *  entraram nela; se o videoId de qualquer um mudou desde entao, a assinatura
 *  muda junto — tenha ou nao alguem lembrado de marcar nada.
 */

export type ParteAssinavel = {
  label: string;
  videoId?: string | null;
  videoStatus?: string;
  /** O que REALMENTE gerou este take — nao o que o plano pede hoje. */
  usouAvatarId?: string | null;
  usouVoiceId?: string | null;
  usouEngine?: string | null;
};

export type PartePlanejada = {
  label: string;
  avatarId?: string | null;
  voiceId?: string | null;
  engine?: string | null;
};

/** Assina os takes que entraram numa montagem.
 *
 *  ⚠ Assina por `videoId`, NUNCA por `videoUrl`: a URL do HeyGen expira e volta
 *  com token novo apontando pro MESMO video — assinar a URL acusaria uma
 *  mudanca que nao houve, e o card viveria em falso alarme.
 *
 *  Parte sem videoId mas ja' completa (caminho de audio proprio, upload) entra
 *  como 'ok': o que importa e' distinguir "mudou" de "nao mudou".
 */
export function assinaturaMontagem(parts?: ParteAssinavel[]): string {
  if (!parts?.length) return '';
  // PREFIXO DE POSICAO (18.09). O label NAO e' chave unica: AD com 2+ hooks tem
  // duas partes chamadas "HOOK 1". Sem a posicao, a leitura da assinatura
  // sobrescrevia a 1a pelo videoId da 2a e o card acusava "1 take mudou" em
  // TODO AD multi-hook — falso alarme eterno, com o Baixar travado e pedindo
  // "Atualizar montagem" de uma montagem que estava certa (AD41VN - PRWA10).
  return parts
    .map((p, i) => `${i}:${p.label}=${p.videoId || (p.videoStatus === 'completed' ? 'ok' : '-')}`)
    .join('|');
}

/** Labels cujo take mudou DEPOIS da montagem — uniao do flag com a assinatura.
 *
 *  Label que NAO existia na assinatura nao conta: e' conservador de proposito
 *  (take novo entra pelo caminho normal, sem virar alarme). Sem `montagemSig`
 *  (batch montado antes de 23.08) o resultado e' exatamente o `dirtyParts`
 *  antigo — legado nao acende alarme falso.
 */
export function partesDesatualizadas(b: {
  parts?: ParteAssinavel[];
  dirtyParts?: string[];
  montagemSig?: string;
}): string[] {
  const mudou = new Set(b.dirtyParts || []);
  const sig = b.montagemSig;
  if (sig) {
    const valorAgora = (p: ParteAssinavel) =>
      p.videoId || (p.videoStatus === 'completed' ? 'ok' : '-');
    // Assinatura NOVA: "<i>:<label>=<valor>" — compara por POSICAO, entao label
    // repetido (AD com 2 hooks) nao se atropela. So acusa se o label daquela
    // posicao continuar o mesmo; se a lista de takes foi remontada, fica calado
    // (conservador de proposito — alarme falso e' pior que silencio).
    const posicional = /^\d+:/.test(sig.split('|')[0] || '');
    if (posicional) {
      const antes = sig.split('|').map((item) => {
        const c = item.indexOf(':');
        const e = item.indexOf('=');
        if (c < 0 || e < c) return null;
        return { label: item.slice(c + 1, e), valor: item.slice(e + 1) };
      });
      (b.parts || []).forEach((p, i) => {
        const ref = antes[i];
        if (!ref || ref.label !== p.label) return;
        if (ref.valor !== valorAgora(p)) mudou.add(p.label);
      });
    } else {
      // LEGADO (montagem anterior a 18.09): mapa por label. Label REPETIDO nao
      // da' pra desambiguar — ficaria sempre sujo, que e' exatamente o bug.
      const antes = new Map<string, string>();
      const vistos = new Map<string, number>();
      for (const item of sig.split('|')) {
        const i = item.indexOf('=');
        if (i > 0) {
          const lab = item.slice(0, i);
          antes.set(lab, item.slice(i + 1));
          vistos.set(lab, (vistos.get(lab) || 0) + 1);
        }
      }
      for (const p of b.parts || []) {
        if ((vistos.get(p.label) || 0) > 1) continue; // ambiguo: nao acusa
        const ref = antes.get(p.label);
        if (ref !== undefined && ref !== valorAgora(p)) mudou.add(p.label);
      }
    }
  }
  return Array.from(mudou);
}

/** Takes que ainda NAO renderizaram.
 *
 *  Silas, 23.08: *"nao deveria jamais mostrar pronto se tem algo carregando
 *  ainda"*. Acontece quando um take e' re-gerado depois do fim do run — o batch
 *  ja' esta' 'done' e o take volta pra fila.
 */
export function takesPendentesDe(b: { parts?: ParteAssinavel[] }): number {
  return (b.parts || []).filter(
    (p) => p.videoStatus === 'pending' || p.videoStatus === 'processing',
  ).length;
}


/** ═══ TAKE QUE FICOU PRA TRAS DO PLANO ═══
 *
 *  Caso real (AD06, 23.08): o avatar da Catia foi refeito, o photo avatar novo
 *  foi criado e o plano do AD passou a apontar pro look corrigido — mas os
 *  SETE takes nunca foram re-gerados. Nada no card acusou: selo verde, download
 *  aberto, e o video entregue trazia o avatar velho. O Silas viu na tela:
 *  *"esse e' o disparo sem o frame novo mesmo e sem o avatar iv que voce usou.
 *  NAO PODE ACONTECER ISSO E VOLTAR PRO ANTIGO"*.
 *
 *  Trocar o look no plano NAO re-gera nada — e' so' intencao. Aqui se compara a
 *  intencao com o que de fato gerou cada take.
 *
 *  ⚠ So' acusa quando o take TEM carimbo (`usouAvatarId`). Take de disparo
 *  antigo nao tem, e inventar divergencia ali seria alarme falso em todo batch
 *  velho — pior que o silencio que se esta' consertando.
 */
export function partesForaDoPlano(
  parts?: ParteAssinavel[],
  planejadas?: PartePlanejada[],
): string[] {
  if (!parts?.length || !planejadas?.length) return [];
  const plano = new Map(planejadas.map((x) => [x.label, x]));
  const fora: string[] = [];
  for (const p of parts) {
    if (!p.usouAvatarId) continue;              // sem carimbo = legado, nao acusa
    const q = plano.get(p.label);
    if (!q) continue;
    const mudouAvatar = !!q.avatarId && q.avatarId !== p.usouAvatarId;
    const mudouVoz = !!q.voiceId && !!p.usouVoiceId && q.voiceId !== p.usouVoiceId;
    const mudouMotor = !!q.engine && !!p.usouEngine
      && String(q.engine).toUpperCase() !== String(p.usouEngine).toUpperCase();
    if (mudouAvatar || mudouVoz || mudouMotor) fora.push(p.label);
  }
  return fora;
}
