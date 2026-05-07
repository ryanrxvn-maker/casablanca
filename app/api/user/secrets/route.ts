import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encryptSecret, lastFour } from '@/lib/secrets';

/**
 * GET    /api/user/secrets       → status das chaves do user (NUNCA retorna a chave)
 * PUT    /api/user/secrets       body { service, key } → encripta e salva
 * DELETE /api/user/secrets       body { service }       → limpa a chave
 *
 * Sempre opera no proprio user (auth.uid()). RLS de user_api_keys garante
 * isolamento — usuario nao consegue ler nem escrever em outro user_id.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

type Service = 'anthropic' | 'assemblyai' | 'elevenlabs';
const VALID_SERVICES: Service[] = ['anthropic', 'assemblyai', 'elevenlabs'];

const COL_KEY: Record<Service, string> = {
  anthropic: 'anthropic_key',
  assemblyai: 'assemblyai_key',
  elevenlabs: 'elevenlabs_key',
};
const COL_LAST4: Record<Service, string> = {
  anthropic: 'anthropic_last4',
  assemblyai: 'assemblyai_last4',
  elevenlabs: 'elevenlabs_last4',
};

function jsonError(message: string, status = 500, detail?: string) {
  return NextResponse.json(
    detail ? { error: message, detail: detail.slice(0, 500) } : { error: message },
    { status },
  );
}

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonError('Nao autenticado.', 401);

    const { data, error } = await supabase
      .from('user_api_keys')
      .select(
        'anthropic_last4, assemblyai_last4, elevenlabs_last4, updated_at, anthropic_key, assemblyai_key, elevenlabs_key',
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) return jsonError('Falha ao ler.', 500, error.message);

    return NextResponse.json({
      anthropic: {
        configured: !!data?.anthropic_key,
        last4: data?.anthropic_last4 ?? null,
      },
      assemblyai: {
        configured: !!data?.assemblyai_key,
        last4: data?.assemblyai_last4 ?? null,
      },
      elevenlabs: {
        configured: !!data?.elevenlabs_key,
        last4: data?.elevenlabs_last4 ?? null,
      },
      updatedAt: data?.updated_at ?? null,
    });
  } catch (e) {
    console.error('[user/secrets GET]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}

export async function PUT(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonError('Nao autenticado.', 401);

    let body: { service?: Service; key?: string };
    try {
      body = await req.json();
    } catch {
      return jsonError('JSON invalido.', 400);
    }

    const service = body.service;
    const key = String(body.key ?? '').trim();
    if (!service || !VALID_SERVICES.includes(service)) {
      return jsonError('Service invalido.', 400);
    }
    if (key.length < 10) {
      return jsonError('Chave parece muito curta.', 400);
    }
    if (key.length > 500) {
      return jsonError('Chave parece grande demais.', 400);
    }

    let cipher: string;
    try {
      cipher = encryptSecret(key);
    } catch (e) {
      console.error('[user/secrets PUT encrypt]', e);
      return jsonError(
        'Servidor sem SECRETS_ENCRYPTION_KEY configurada.',
        500,
      );
    }
    const last4 = lastFour(key);

    const colKey = COL_KEY[service];
    const colLast4 = COL_LAST4[service];

    const payload: Record<string, unknown> = {
      user_id: user.id,
      [colKey]: cipher,
      [colLast4]: last4,
    };

    const { error } = await supabase
      .from('user_api_keys')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) return jsonError('Falha ao salvar.', 500, error.message);

    return NextResponse.json({ ok: true, service, last4 });
  } catch (e) {
    console.error('[user/secrets PUT]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonError('Nao autenticado.', 401);

    let body: { service?: Service };
    try {
      body = await req.json();
    } catch {
      return jsonError('JSON invalido.', 400);
    }

    const service = body.service;
    if (!service || !VALID_SERVICES.includes(service)) {
      return jsonError('Service invalido.', 400);
    }

    const colKey = COL_KEY[service];
    const colLast4 = COL_LAST4[service];

    const { error } = await supabase
      .from('user_api_keys')
      .update({ [colKey]: null, [colLast4]: null })
      .eq('user_id', user.id);

    if (error) return jsonError('Falha ao limpar.', 500, error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[user/secrets DELETE]', e);
    return jsonError(
      'Erro inesperado.',
      500,
      e instanceof Error ? e.message : String(e),
    );
  }
}
