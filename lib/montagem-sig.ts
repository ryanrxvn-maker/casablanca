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
  return parts
    .map((p) => `${p.label}=${p.videoId || (p.videoStatus === 'completed' ? 'ok' : '-')}`)
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
  if (b.montagemSig) {
    const antes = new Map<string, string>();
    for (const item of b.montagemSig.split('|')) {
      const i = item.indexOf('=');
      if (i > 0) antes.set(item.slice(0, i), item.slice(i + 1));
    }
    for (const p of b.parts || []) {
      const agora = p.videoId || (p.videoStatus === 'completed' ? 'ok' : '-');
      const ref = antes.get(p.label);
      if (ref !== undefined && ref !== agora) mudou.add(p.label);
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
