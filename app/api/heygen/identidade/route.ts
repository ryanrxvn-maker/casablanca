import { famousHeyGratis } from '@/lib/famous-hey-trial';
import { NextResponse } from 'next/server';
import { getUserKey } from '@/lib/user-keys';
import { requireTier } from '@/lib/require-tier';
import {
  identidadeApiKey,
  identidadeOAuth,
  montarDiagnostico,
} from '@/lib/heygen-identidade';

/**
 * GET /api/heygen/identidade
 *
 * Diz de QUAL CONTA do HeyGen é cada credencial, e avisa quando algo vai
 * quebrar o disparo ANTES de o usuário disparar:
 *
 *   - OAuth do modo imagem expirado  → o disparo de modo imagem não sai
 *   - API key e OAuth em contas DIFERENTES → o usuário escolhe avatar numa
 *     conta e gera na outra, e o HeyGen devolve "Avatar group not accessible"
 *
 * Consumido pelo banner do /tools/clickup-pilot, do /tools/heygen-auto e da
 * /tools/famous-hey (que depende SO do OAuth — pra ela o aviso é o mais crítico).
 *
 * ⚠ Não gasta crédito: só chama endpoints de informação de conta.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    const gate = await requireTier(famousHeyGratis() ? 'free' : 'admin', {
      unlockTools: ['/tools/famous-hey', '/tools/heygen-auto', '/tools/clickup-pilot'],
    });
    if (!gate.ok) return gate.response;

    // getUserKey devolve `{response}` quando não há chave gravada. Aqui isso
    // NÃO é erro de request: é justamente um dos estados que queremos relatar.
    const rKey = await getUserKey('heygen');
    const apiKey = 'key' in rKey ? rKey.key : null;
    const rOauth = await getUserKey('heygen_oauth');
    const oauthGuardado = 'key' in rOauth ? rOauth.key : null;

    // em paralelo: são duas idas independentes ao HeyGen
    const [ladoKey, ladoOauth] = await Promise.all([
      identidadeApiKey(apiKey),
      identidadeOAuth(oauthGuardado),
    ]);

    // A Famous Hey manda ?apiKeyOpcional=1: lá o seletor de voz cai pro OAuth
    // quando não há key, então cobrar a key seria pedir o que não desbloqueia.
    const opcional = new URL(req.url).searchParams.get('apiKeyOpcional') === '1';
    return NextResponse.json(montarDiagnostico(ladoKey, ladoOauth, opcional));
  } catch (e) {
    // Falha de diagnóstico NÃO pode travar a ferramenta: o banner simplesmente
    // não aparece. Por isso 200 com aviso nulo em vez de 500.
    return NextResponse.json({
      apiKey: { configurada: false, valida: false, conta: null, erro: null },
      oauth: { configurada: false, valida: false, conta: null, expiraEm: null, erro: null },
      conflitoDeConta: false,
      aviso: null,
      falta: null,
      falhaDiagnostico: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    });
  }
}
