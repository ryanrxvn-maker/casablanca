import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/secrets';

/**
 * Resolve a chave de IA do usuario CHAMADOR pra um servico especifico.
 * Pra ser usado dentro de route handlers.
 *
 * Se o user nao configurou a key correspondente, retorna NextResponse 400
 * pronta com mensagem amigavel direcionando pra /configuracoes.
 *
 * Uso tipico:
 *   const result = await getUserKey('anthropic');
 *   if ('response' in result) return result.response;
 *   const apiKey = result.key; // plaintext, descartar apos uso
 */

type Service = 'anthropic' | 'assemblyai' | 'elevenlabs';

const COLUMN_BY_SERVICE: Record<Service, string> = {
  anthropic: 'anthropic_key',
  assemblyai: 'assemblyai_key',
  elevenlabs: 'elevenlabs_key',
};

const LABEL_BY_SERVICE: Record<Service, string> = {
  anthropic: 'Anthropic (Claude)',
  assemblyai: 'AssemblyAI',
  elevenlabs: 'ElevenLabs',
};

export async function getUserKey(
  service: Service,
): Promise<{ key: string } | { response: NextResponse }> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        response: NextResponse.json(
          { error: 'Nao autenticado.' },
          { status: 401 },
        ),
      };
    }

    const col = COLUMN_BY_SERVICE[service];
    const { data, error } = await supabase
      .from('user_api_keys')
      .select(col)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      return {
        response: NextResponse.json(
          { error: 'Falha ao ler suas chaves.', detail: error.message },
          { status: 500 },
        ),
      };
    }

    const ciphertext = (data as Record<string, string | null> | null)?.[col];
    if (!ciphertext) {
      return {
        response: NextResponse.json(
          {
            error: `Configure sua chave ${LABEL_BY_SERVICE[service]} em /configuracoes/api antes de usar essa ferramenta.`,
            missingKey: service,
          },
          { status: 400 },
        ),
      };
    }

    let plaintext: string;
    try {
      plaintext = decryptSecret(ciphertext);
    } catch (e) {
      console.error('[getUserKey decrypt]', e);
      return {
        response: NextResponse.json(
          {
            error:
              'Sua chave esta corrompida ou foi cifrada com outra senha. Reconfigure em /configuracoes/api.',
          },
          { status: 500 },
        ),
      };
    }

    return { key: plaintext };
  } catch (e) {
    console.error('[getUserKey]', e);
    return {
      response: NextResponse.json(
        {
          error: 'Erro inesperado ao recuperar sua chave.',
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 500 },
      ),
    };
  }
}
