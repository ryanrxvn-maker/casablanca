import { NextResponse } from 'next/server';
import { serviceClient } from '@/app/api/admin/_helpers';
import { decryptSecret, encryptSecret, lastFour } from '@/lib/secrets';
import {
  accessTokenDoRefresh,
  lerCredencial,
  empacotarCredencial,
} from '@/lib/heygen-image-video';

/**
 * GET /api/cron/heygen-oauth  (Vercel Cron, diário)
 *
 * MANTÉM O LOGIN DO MODO IMAGEM VIVO SOZINHO.
 *
 * O HeyGen usa rotação com uso ÚNICO: cada renovação emite um refresh novo e
 * mata o anterior. Enquanto alguém renova de tempos em tempos, a corrente segue
 * viva pra sempre — o que quebra a corrente é ficar dias sem usar (o refresh
 * caduca) ou uma renovação que não persiste o sucessor. O disparo já cobre o
 * segundo caso; este cron cobre o primeiro.
 *
 * Roda todo dia, renova uma vez e grava. Custo: uma chamada de token por dia,
 * zero crédito de vídeo. Em troca, o usuário não refaz `heygen auth login`
 * nunca mais — que era a dor real: "toda vez ficar trocando isso é foda".
 *
 * Proteção igual à do reconcile-billing: exige Bearer CRON_SECRET e FALHA
 * FECHADO em produção sem o secret.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 401 });
  }

  const svc = serviceClient();
  // Só quem tem OAuth do modo imagem configurado. São poucos (admin), então
  // varrer é barato — e assim o cron não precisa saber de user_id fixo.
  const { data, error } = await svc
    .from('user_api_keys')
    .select('user_id, heygen_oauth_refresh')
    .not('heygen_oauth_refresh', 'is', null);

  if (error) {
    return NextResponse.json({ error: `leitura falhou: ${error.message}` }, { status: 500 });
  }

  const relatorio: Array<{ user: string; resultado: string }> = [];
  for (const linha of data || []) {
    const user = String(linha.user_id).slice(0, 8);
    try {
      const guardado = decryptSecret(String(linha.heygen_oauth_refresh));
      if (!guardado) { relatorio.push({ user, resultado: 'sem credencial legível' }); continue; }

      // Releitura do banco: se outra instância renovar no mesmo instante, o
      // retry interno aproveita o access dela em vez de matar a corrente.
      const rele = async () => {
        const { data: fresco } = await svc
          .from('user_api_keys')
          .select('heygen_oauth_refresh')
          .eq('user_id', linha.user_id)
          .maybeSingle();
        const v = fresco?.heygen_oauth_refresh;
        return v ? decryptSecret(String(v)) : null;
      };

      const { novoRefresh, origem } = await accessTokenDoRefresh(guardado, rele);
      if (!novoRefresh) { relatorio.push({ user, resultado: `nada a gravar (${origem})` }); continue; }

      const refreshPuro = lerCredencial(novoRefresh).refresh;
      const { error: errGrava } = await svc
        .from('user_api_keys')
        .update({
          heygen_oauth_refresh: encryptSecret(novoRefresh),
          heygen_oauth_last4: lastFour(refreshPuro),
        })
        .eq('user_id', linha.user_id);

      relatorio.push({
        user,
        resultado: errGrava ? `RENOVOU MAS NÃO GRAVOU: ${errGrava.message}` : 'renovado e gravado',
      });
    } catch (e) {
      // Um usuário com token morto não pode derrubar a varredura dos outros.
      relatorio.push({ user, resultado: `falhou: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  return NextResponse.json({ ok: true, verificados: relatorio.length, relatorio });
}
