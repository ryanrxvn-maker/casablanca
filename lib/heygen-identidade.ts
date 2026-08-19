/**
 * lib/heygen-identidade.ts — de QUAL CONTA é cada credencial do HeyGen.
 *
 * ───────────────────────── POR QUE ISTO EXISTE ─────────────────────────
 * O app usa DUAS credenciais do HeyGen para coisas diferentes:
 *
 *   `heygen`        (API key)  → lista avatares e vozes (os pickers)
 *   `heygen_oauth`  (refresh)  → GERA no modo imagem
 *
 * Nada garante que as duas sejam da MESMA conta. Quando divergem, o usuário
 * escolhe um avatar que existe na conta A e o disparo tenta gerar na conta B —
 * e o HeyGen responde "Avatar group not accessible", que parece defeito nosso
 * e não é ([[project_heygen_space_mismatch]]).
 *
 * Aconteceu de verdade em 18.08: o Silas trocou o OAuth para a conta B2C e a
 * API key ficou na do DR MILLION. Os pickers mostravam avatares de uma conta e
 * o modo imagem rodava na outra, sem nenhum aviso na tela.
 *
 * Este módulo responde, sem gastar crédito nenhum:
 *   - a API key é válida? de que conta?
 *   - o OAuth é válido? de que conta? vence quando?
 *   - as duas são da MESMA conta?
 *
 * ⚠ SÓ LÊ. Nunca gera vídeo, nunca gasta crédito. As chamadas usadas são de
 * informação de conta (grátis).
 *
 * ⚠ HISTÓRICO — ele DESCARTAVA o refresh rotacionado, e isso matava o login.
 * O refresh do HeyGen é de USO ÚNICO: cada troca emite um sucessor e invalida
 * o anterior. Como o access dura ~1h, bastava abrir a ferramenta depois disso
 * pro diagnóstico trocar o refresh e jogar o sucessor no lixo — o que ficava
 * gravado já estava morto, e o disparo seguinte batia em `invalid_grant`.
 * Resultado: ABRIR A TELA derrubava o login, e o usuário reconectava sem
 * entender por quê. Medido em 19.08.
 *
 * Agora `identidadeOAuth` DEVOLVE o sucessor e quem chama GRAVA. Não há
 * disputa: gravar o sucessor é justamente o que mantém a corrente viva.
 */

import { accessTokenDoRefresh, lerCredencial } from '@/lib/heygen-image-video';

const API_BASE = 'https://api.heygen.com';

/** Caminhos que devolvem dados da conta. Testados em ordem; o 1º que trouxer
 *  e-mail vence. Lista em vez de um caminho fixo porque o HeyGen versiona
 *  esses endpoints sem aviso, e um 404 aqui não pode derrubar o diagnóstico. */
const CAMINHOS_CONTA = ['/v2/user/me', '/v1/user/me', '/v2/user/remaining_quota'];

export type Conta = {
  email: string | null;
  plano: string | null;
  /** Cru do provedor, útil quando o e-mail não vem mas algo identifica a conta. */
  bruto?: unknown;
};

export type LadoDiagnostico = {
  configurada: boolean;
  valida: boolean;
  conta: Conta | null;
  /** Mensagem curta e acionável quando `valida` é false. */
  erro: string | null;
};

export type Diagnostico = {
  apiKey: LadoDiagnostico;
  oauth: LadoDiagnostico & { expiraEm: string | null };
  /** true quando as duas são válidas e de contas DIFERENTES. */
  conflitoDeConta: boolean;
  /** Aviso pronto pra tela. `null` = nada a avisar. */
  aviso: { nivel: 'erro' | 'atencao'; titulo: string; texto: string } | null;
  /**
   * QUAL credencial está com problema. Existe porque a tela precisa oferecer a
   * AÇÃO CERTA: o botão "Conectar HeyGen" resolve OAuth e não resolve API key.
   * Mostrar "falta API key" com um botão de OAuth ao lado foi exatamente o que
   * fez o usuário conectar, recarregar e achar que nada tinha acontecido.
   */
  falta: 'oauth' | 'apikey' | 'ambas' | null;
};

/** Dias inteiros até a data (negativo = já passou). `null` quando não se sabe. */
function diasAte(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - Date.now()) / 86400_000);
}

function extrairConta(j: unknown): Conta | null {
  if (!j || typeof j !== 'object') return null;
  const raiz = j as Record<string, unknown>;
  const d = (raiz.data && typeof raiz.data === 'object' ? raiz.data : raiz) as Record<
    string,
    unknown
  >;
  const email = typeof d.email === 'string' && d.email ? d.email : null;
  const sub = d.subscription as Record<string, unknown> | undefined;
  const plano =
    sub && typeof sub.plan === 'string'
      ? sub.plan
      : typeof d.plan === 'string'
        ? d.plan
        : null;
  if (!email && !plano) return null;
  return { email, plano, bruto: undefined };
}

async function contaPorHeaders(headers: Record<string, string>): Promise<Conta | null> {
  for (const caminho of CAMINHOS_CONTA) {
    try {
      const r = await fetch(API_BASE + caminho, { headers });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const c = extrairConta(j);
      if (c) return c;
    } catch {
      /* tenta o próximo caminho */
    }
  }
  return null;
}

/** Identidade da API key. Erro aqui = key inválida/revogada, não falta de saldo. */
export async function identidadeApiKey(apiKey: string | null): Promise<LadoDiagnostico> {
  if (!apiKey) {
    return {
      configurada: false,
      valida: false,
      conta: null,
      erro: 'API key do HeyGen não configurada — os pickers de avatar e voz não vão carregar.',
    };
  }
  const conta = await contaPorHeaders({ 'X-Api-Key': apiKey });
  if (!conta) {
    return {
      configurada: true,
      valida: false,
      conta: null,
      erro: 'A API key do HeyGen não foi aceita. Gere outra e cole em /configuracoes/api.',
    };
  }
  return { configurada: true, valida: true, conta, erro: null };
}

/** Identidade do OAuth do modo imagem. */
export async function identidadeOAuth(
  guardado: string | null,
): Promise<LadoDiagnostico & { expiraEm: string | null; novoRefresh?: string | null }> {
  if (!guardado) {
    return {
      configurada: false,
      valida: false,
      conta: null,
      expiraEm: null,
      erro:
        'OAuth do HeyGen não configurado — o modo imagem não vai disparar. ' +
        'Clique em "Conectar HeyGen agora" pra resolver em dois cliques.',
    };
  }
  let access: string;
  let novoRefresh: string | null = null;
  try {
    const r = await accessTokenDoRefresh(guardado);
    access = r.access;
    // O SUCESSOR SOBE JUNTO. Descartar aqui era matar a corrente.
    novoRefresh = r.novoRefresh;
  } catch (e) {
    return {
      configurada: true,
      valida: false,
      conta: null,
      expiraEm: null,
      // ⚠ NÃO mandar pro CLI aqui. Colar o token do CLI é justamente o que cria
      // a disputa pela mesma corrente de refresh (uso único + rotação): quem
      // renovar primeiro derruba o outro. O botão "Conectar HeyGen agora" tira
      // um login PRÓPRIO do app, que o CLI não encosta.
      erro:
        'Clique em "Conectar HeyGen agora" aqui embaixo: abre o HeyGen, você aprova ' +
        'com um código e pronto. ' +
        (e instanceof Error ? e.message.slice(0, 160) : ''),
    };
  }
  // Até quando o REFRESH vale. Vem do login/rotação quando o provedor informa;
  // `null` significa "não sei", nunca "não expira".
  const venc = lerCredencial(guardado).refreshExp;
  const expiraEm = venc ? new Date(venc).toISOString() : null;

  const conta = await contaPorHeaders({ Authorization: `Bearer ${access}` });
  if (!conta) {
    return {
      configurada: true,
      valida: false,
      conta: null,
      expiraEm,
      erro: 'O OAuth renovou mas a conta não respondeu. Tente de novo em instantes.',
    };
  }
  return { configurada: true, valida: true, conta, expiraEm, erro: null, novoRefresh };
}

/** Junta os dois lados e monta o aviso de tela. */
export function montarDiagnostico(
  apiKey: LadoDiagnostico,
  oauth: LadoDiagnostico & { expiraEm: string | null },
  /**
   * `true` quando a tela chamadora NÃO precisa da API key. É o caso da Famous
   * Hey: o seletor de voz cai pro OAuth quando não há key, então cobrar a key
   * ali é pedir uma coisa que não desbloqueia nada.
   */
  apiKeyOpcional = false,
): Diagnostico {
  const emailKey = apiKey.conta?.email ?? null;
  const emailOAuth = oauth.conta?.email ?? null;
  const conflito =
    apiKey.valida && oauth.valida && !!emailKey && !!emailOAuth && emailKey !== emailOAuth;

  let aviso: Diagnostico['aviso'] = null;

  // ORDEM IMPORTA: token morto impede o disparo por completo, então vem antes
  // do conflito de conta, que só estraga o resultado.
  if (oauth.configurada && !oauth.valida) {
    aviso = {
      nivel: 'erro',
      titulo: 'O login do modo imagem expirou',
      texto:
        oauth.erro ??
        'Clique em "Conectar HeyGen agora" aqui embaixo — abre o HeyGen e você aprova com um código.',
    };
  } else if (diasAte(oauth.expiraEm) !== null && (diasAte(oauth.expiraEm) as number) <= 3) {
    // Avisar ANTES de quebrar. Descobrir que o login venceu no meio de um lote
    // é o pior momento possível — e é exatamente quando isso acontecia.
    const dias = diasAte(oauth.expiraEm) as number;
    aviso = {
      nivel: 'atencao',
      titulo:
        dias <= 0
          ? 'O login do modo imagem vence hoje'
          : `O login do modo imagem vence em ${dias} dia${dias > 1 ? 's' : ''}`,
      texto:
        'A renovação automática roda todo dia e costuma resolver sozinha. Se este ' +
        'aviso não sumir amanhã, clique em "Conectar HeyGen agora" — leva dois cliques.',
    };
  } else if (conflito) {
    aviso = {
      nivel: 'erro',
      titulo: 'Avatar e disparo estão em contas diferentes do HeyGen',
      texto:
        `Os avatares e vozes vêm de ${emailKey} (API key), mas o modo imagem gera em ` +
        `${emailOAuth} (OAuth). Escolher um avatar de uma conta e disparar na outra ` +
        `devolve "Avatar group not accessible". Deixe as duas na mesma conta em ` +
        `/configuracoes/api antes de disparar.`,
    };
  } else if (!oauth.configurada) {
    aviso = {
      nivel: 'atencao',
      titulo: 'Falta conectar o HeyGen',
      texto:
        'Um clique: abre o HeyGen, você aprova com um código e volta. Sem terminal e sem colar nada.',
    };
  } else if (!apiKey.configurada && !apiKeyOpcional) {
    aviso = {
      nivel: 'atencao',
      titulo: 'Falta a API key do HeyGen',
      texto:
        'O login já está conectado — isto aqui é OUTRA credencial, usada só pra listar seus ' +
        'avatares e vozes. Ela se cola à mão em /configuracoes/api.',
    };
  } else if (apiKey.configurada && !apiKey.valida && !apiKeyOpcional) {
    aviso = {
      nivel: 'atencao',
      titulo: 'A API key do HeyGen não foi aceita',
      texto: apiKey.erro ?? 'Gere outra key e cole em /configuracoes/api.',
    };
  }

  const faltaOauth = !oauth.configurada || !oauth.valida;
  const faltaKey = !apiKeyOpcional && (!apiKey.configurada || !apiKey.valida);
  const falta: Diagnostico['falta'] =
    faltaOauth && faltaKey ? 'ambas' : faltaOauth ? 'oauth' : faltaKey ? 'apikey' : null;

  return { apiKey, oauth, conflitoDeConta: conflito, aviso, falta };
}
