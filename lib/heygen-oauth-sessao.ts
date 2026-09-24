import { createClient } from '@/lib/supabase/server';
import { encryptSecret, lastFour } from '@/lib/secrets';
import { getUserKey } from '@/lib/user-keys';
import { accessTokenDoRefresh, lerCredencial } from '@/lib/heygen-image-video';

/**
 * Bearer do OAuth do HeyGen pra rotas de servidor (clone de voz; mesmo trilho
 * do modo imagem). Renova o access e GRAVA o refresh rotacionado — o HeyGen
 * invalida o anterior a cada renovação, então quem renova e não grava derruba
 * o modo imagem na próxima instância fria. Ver [[project_heygen_oauth_no_app]].
 */

async function relerRefreshDoBanco(): Promise<string | null> {
  const r = await getUserKey('heygen_oauth');
  return 'response' in r ? null : r.key;
}

/** `null` = gravou e a releitura confirmou; string = motivo da falha. */
async function guardarRefreshRotacionado(novo: string): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'sem sessão de usuário na rota — não deu pra gravar o token novo';
    const last4 = lastFour(lerCredencial(novo).refresh);
    const { error } = await supabase.from('user_api_keys').upsert(
      { user_id: user.id, heygen_oauth_refresh: encryptSecret(novo), heygen_oauth_last4: last4 },
      { onConflict: 'user_id' },
    );
    if (error) return `não consegui gravar o token novo (${error.message})`;
    const { data: conf } = await supabase
      .from('user_api_keys')
      .select('heygen_oauth_last4')
      .eq('user_id', user.id)
      .maybeSingle();
    if (conf?.heygen_oauth_last4 !== last4) {
      return 'gravei o token novo mas a releitura não confirmou — a próxima renovação vai falhar';
    }
    return null;
  } catch (e) {
    return `erro ao gravar o token novo: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export type BearerResult =
  | { ok: true; accessToken: string; avisoToken: string | null }
  | { ok: false; response: Response };

export async function bearerDoUsuario(): Promise<BearerResult> {
  const keyResult = await getUserKey('heygen_oauth');
  if ('response' in keyResult) return { ok: false, response: keyResult.response };
  const { access, novoRefresh } = await accessTokenDoRefresh(keyResult.key, relerRefreshDoBanco);
  const avisoToken = novoRefresh ? await guardarRefreshRotacionado(novoRefresh) : null;
  if (avisoToken) console.error('[heygen oauth]', avisoToken);
  return { ok: true, accessToken: access, avisoToken };
}
