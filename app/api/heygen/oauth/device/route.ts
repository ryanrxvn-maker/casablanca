import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireTier } from '@/lib/require-tier';
import { encryptSecret, decryptSecret, lastFour } from '@/lib/secrets';
import { empacotarCredencial, lerValidadeDoRefresh } from '@/lib/heygen-image-video';

/**
 * LOGIN DO HEYGEN DENTRO DO APP — device flow, sem CLI e sem copiar arquivo.
 *
 * ─────────────────────────── POR QUE EXISTE ───────────────────────────
 * Até aqui, reconectar o modo imagem era: abrir terminal → `heygen auth login
 * --oauth` → achar ~/.heygen/credentials → copiar o refresh_token na mão →
 * colar em /configuracoes/api. Cinco passos fora do produto, refeitos toda vez
 * que a corrente do token quebrava.
 *
 * E ela quebra fácil por um motivo ESTRUTURAL: o refresh do HeyGen é de USO
 * ÚNICO e rotaciona. Se o CLI e o app seguram a MESMA corrente, quem renovar
 * primeiro mata a cópia do outro — e colar o token do CLI no app cria
 * exatamente essa disputa. Aqui o app tira a PRÓPRIA credencial, em corrente
 * só dele: o CLI segue a vida dele sem derrubar o disparo.
 *
 * ─────────────────────────── COMO FUNCIONA ────────────────────────────
 *   POST (sem body)  → começa: devolve o código de 8 dígitos e a URL
 *   POST { handle }  → pergunta se já aprovou; quando aprovar, GRAVA
 *
 * ⚠ O `device_code` NUNCA vai pro browser em claro: sai cifrado como `handle`
 * e só o servidor abre. Ele é a metade secreta do par — quem tiver o
 * device_code e pegar a aprovação do usuário leva o token junto.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const OAUTH_BASE = 'https://api2.heygen.com/v1/oauth';
/** Mesmo client PÚBLICO (PKCE) do refresh. Tem que ser o MESMO que emitiu o
 *  token, senão a renovação depois responde `invalid_client`. */
const CLIENT_ID = 'q2A2QRSke2LrFTPJhoDbHtXh';

function erro(mensagem: string, status = 500) {
  return NextResponse.json({ error: mensagem }, { status });
}

async function form(url: string, campos: Record<string, string>) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos).toString(),
  });
  const texto = await r.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(texto);
  } catch {
    /* resposta não-JSON vira erro legível lá embaixo */
  }
  return { ok: r.ok, json, texto };
}

export async function POST(req: Request) {
  try {
    const gate = await requireTier('admin', {
      unlockTools: ['/tools/famous-hey', '/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;

    const body = (await req.json().catch(() => ({}))) as { handle?: string };
    const handle = (body?.handle || '').trim();

    // ── 1ª chamada: pede o código ───────────────────────────────────────
    if (!handle) {
      const r = await form(`${OAUTH_BASE}/device_authorization`, {
        client_id: CLIENT_ID,
        scope: 'openid profile email',
      });
      const deviceCode = r.json?.device_code as string | undefined;
      const userCode = r.json?.user_code as string | undefined;
      if (!r.ok || !deviceCode || !userCode) {
        return erro(`O HeyGen não abriu o login: ${r.texto.slice(0, 200)}`, 502);
      }
      return NextResponse.json({
        estado: 'aguardando',
        handle: encryptSecret(deviceCode),
        codigo: userCode,
        url: (r.json?.verification_uri as string) || 'https://app.heygen.com/oauth/device',
        expiraEm: Number(r.json?.expires_in) || 600,
        intervalo: Number(r.json?.interval) || 5,
      });
    }

    // ── chamadas seguintes: já aprovou? ─────────────────────────────────
    let deviceCode = '';
    try {
      deviceCode = decryptSecret(handle);
    } catch {
      /* handle adulterado cai no guard abaixo */
    }
    if (!deviceCode) return erro('Sessão de login inválida. Comece de novo.', 400);

    const r = await form(`${OAUTH_BASE}/token`, {
      client_id: CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
    });

    // Estes NÃO são falha: é o usuário ainda não tendo aprovado. Tratar como
    // erro faria a tela desistir no primeiro segundo.
    const codigoErro = String(r.json?.error || '');
    if (codigoErro === 'authorization_pending') return NextResponse.json({ estado: 'aguardando' });
    if (codigoErro === 'slow_down') return NextResponse.json({ estado: 'aguardando', devagar: true });
    if (codigoErro === 'expired_token') return NextResponse.json({ estado: 'expirou' });
    if (codigoErro === 'access_denied') return NextResponse.json({ estado: 'negado' });

    const refresh = r.json?.refresh_token as string | undefined;
    const access = r.json?.access_token as string | undefined;
    if (!r.ok || !refresh) {
      return erro(`O HeyGen recusou o login: ${r.texto.slice(0, 200)}`, 502);
    }

    // Guarda o PACOTE (refresh + access + validade), não o refresh puro: assim
    // a primeira geração não precisa queimar uma renovação só pra ter access —
    // e é justamente a renovação que rotaciona e pode quebrar a corrente.
    const validade = Number(r.json?.expires_in);
    const pacote = empacotarCredencial({
      refresh,
      access,
      exp: access && validade > 0 ? Date.now() + validade * 1000 : undefined,
      // Prazo do REFRESH (~10 dias no login). É daqui que a tela vai dizer até
      // quando o login vale, em vez de o usuário descobrir quando trava.
      refreshExp: lerValidadeDoRefresh(r.json),
    });

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return erro('Sem sessão de usuário — entre no app e tente de novo.', 401);

    // ⚠ supabase-js NÃO lança em erro de banco: devolve { error }. Sem checar,
    // o login "dava certo" na tela e o token não chegava a lugar nenhum.
    const { error: errGrava } = await supabase.from('user_api_keys').upsert(
      {
        user_id: user.id,
        heygen_oauth_refresh: encryptSecret(pacote),
        heygen_oauth_last4: lastFour(refresh),
      },
      { onConflict: 'user_id' },
    );
    if (errGrava) return erro(`Conectou mas não consegui gravar: ${errGrava.message}`, 500);

    // Confirma LENDO: gravar sem erro e não persistir é o pior dos mundos.
    const { data: conf } = await supabase
      .from('user_api_keys')
      .select('heygen_oauth_last4')
      .eq('user_id', user.id)
      .maybeSingle();
    if (conf?.heygen_oauth_last4 !== lastFour(refresh)) {
      return erro('Conectou mas a releitura não confirmou a gravação. Tente de novo.', 500);
    }

    // Qual conta conectou: trocar de conta sem perceber é o segundo jeito mais
    // comum de quebrar o disparo ([[project_heygen_space_mismatch]]).
    let conta: string | null = null;
    if (access) {
      try {
        const me = await fetch('https://api.heygen.com/v2/user/me', {
          headers: { Authorization: `Bearer ${access}` },
        });
        const j = await me.json().catch(() => null);
        conta = j?.data?.email || j?.email || null;
      } catch {
        /* o nome é enfeite: o login já está gravado */
      }
    }

    return NextResponse.json({ estado: 'conectado', conta });
  } catch (e) {
    return erro(e instanceof Error ? e.message : 'Erro inesperado no login do HeyGen.');
  }
}
