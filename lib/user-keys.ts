import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret } from '@/lib/secrets';
import { cliMachineIdentity } from '@/lib/cli-auth';

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

type Service =
  | 'anthropic'
  | 'assemblyai'
  | 'elevenlabs'
  | 'heygen'
  | 'replicate'
  | 'groq';

const COLUMN_BY_SERVICE: Record<Service, string> = {
  anthropic: 'anthropic_key',
  assemblyai: 'assemblyai_key',
  elevenlabs: 'elevenlabs_key',
  heygen: 'heygen_key',
  replicate: 'replicate_key',
  groq: 'groq_key',
};

const LABEL_BY_SERVICE: Record<Service, string> = {
  anthropic: 'Anthropic (Claude)',
  assemblyai: 'AssemblyAI',
  elevenlabs: 'ElevenLabs',
  heygen: 'HeyGen',
  replicate: 'Replicate',
  groq: 'Groq (Whisper)',
};

/**
 * Client service-role (bypassa RLS) pra ler a chave de um user_id específico
 * quando o caller é a MÁQUINA (CLI/MCP) — que não tem cookie de sessão.
 */
function serviceDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente.');
  return createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getUserKey(
  service: Service,
): Promise<{ key: string } | { response: NextResponse }> {
  try {
    // Identidade: a MÁQUINA (CLI/MCP via AUTOEDIT_CLI_KEY → AUTOEDIT_CLI_USER_ID)
    // lê a chave do user configurado via service-role; o BROWSER usa o cookie.
    // Inerte pra browser: cliMachineIdentity() só resolve com o header secreto.
    const machine = cliMachineIdentity();
    let userId: string;
    let db: SupabaseClient;
    if (machine) {
      userId = machine.userId;
      try {
        db = serviceDb();
      } catch (e) {
        return {
          response: NextResponse.json(
            { error: 'Storage não configurado (SUPABASE_SERVICE_ROLE_KEY).', detail: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          ),
        };
      }
    } else {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return {
          response: NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 }),
        };
      }
      userId = user.id;
      db = supabase as unknown as SupabaseClient;
    }

    const col = COLUMN_BY_SERVICE[service];
    const { data, error } = await db
      .from('user_api_keys')
      .select(col)
      .eq('user_id', userId)
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
