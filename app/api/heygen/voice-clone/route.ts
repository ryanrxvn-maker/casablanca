import { NextResponse } from 'next/server';
import { requireTier } from '@/lib/require-tier';
import { bearerDoUsuario } from '@/lib/heygen-oauth-sessao';
import { contaDoToken } from '@/lib/heygen-image-video';

/**
 * CLONE DE VOZ por código — mesmo trilho do modo imagem (OAuth Bearer na API
 * pública, crédito do plano). Nada de aba, clique ou tela do HeyGen.
 *
 *   POST /api/heygen/voice-clone   multipart { audio, name, language? }
 *        → { voiceId, conta }       (voiceId = voice_clone_id, já serve de voice_id)
 *   GET  /api/heygen/voice-clone?id=<voiceId>
 *        → { status: processing|complete|failed, name, erro? }
 *   GET  /api/heygen/voice-clone?conta=1[&contar=1]
 *        → { conta, plano, clones? } (só lê; o client decide se a conta serve)
 *
 * ⚠ O clone nasce na conta do OAuth. Disparo normal do Pilot usa a conta do
 * NAVEGADOR (extensão) — se forem diferentes, a voz não aparece lá. Quem chama
 * confere a conta ANTES (`?conta=1`). Ver [[project_modo_imagem_conta_oauth_voz]].
 *
 * Endpoint medido pelo CLI oficial (`heygen voice clone create --request-schema`):
 * POST /v3/voices/clone { voice_name, audio:{type:'base64',media_type,data},
 * language?, remove_background_noise }.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const API = 'https://api.heygen.com';
/** O Vercel corta o body em ~4,5MB; o client já manda WAV mono 24kHz ≤75s. */
const MAX_BYTES = 4 * 1024 * 1024;
/** ⚠ WAV tem que ir como `audio/x-wav`: o HeyGen detecta o tipo pelo conteúdo e
 *  recusa `audio/wav` com "Content type not match audio/wav != audio/x-wav"
 *  (medido 23.09). */
const MIMES: Record<string, string> = {
  wav: 'audio/x-wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', webm: 'audio/webm',
};

function erro(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function descreve(status: number, body: any): string {
  const e = body?.error;
  const msg = (typeof e === 'string' ? e : e?.message) || body?.message || 'sem detalhe';
  const code = e?.code ? ` [${e.code}]` : '';
  return `${msg}${code} (HTTP ${status})`;
}

/** Conta + plano do token (`/v3/users/me`). Só lê. */
async function infoConta(token: string): Promise<{ conta: string | null; plano: string | null }> {
  try {
    const r = await fetch(`${API}/v3/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => null);
    const d = j?.data || {};
    return { conta: d.email || d.username || null, plano: d.subscription?.plan || null };
  } catch {
    return { conta: null, plano: null };
  }
}

/** Vozes clonadas (privadas) da conta do token — paginado. null = não deu. */
async function contarClones(token: string): Promise<number | null> {
  try {
    let total = 0;
    let cursor: string | null = null;
    for (let p = 0; p < 50; p++) {
      const qs = new URLSearchParams({ type: 'private', limit: '100' });
      if (cursor) qs.set('token', cursor);
      const r = await fetch(`${API}/v3/voices?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      const lista = Array.isArray(j?.data) ? j.data : j?.data?.voices || [];
      total += lista.length;
      cursor = j?.next_token || null;
      if (!j?.has_more || !cursor) return total;
    }
    return total;
  } catch {
    return null;
  }
}

async function gate() {
  return requireTier('admin', { unlockTools: ['/tools/clickup-pilot', '/tools/heygen-auto'] });
}

export async function POST(req: Request) {
  try {
    const g = await gate();
    if (!g.ok) return g.response;
    const b = await bearerDoUsuario();
    if (!b.ok) return b.response;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return erro('Falha ao ler o áudio (limite ~4MB por envio).', 413);
    }
    const audio = form.get('audio');
    const name = String(form.get('name') || '').trim().slice(0, 50);
    const language = String(form.get('language') || '').trim().toLowerCase();
    if (!(audio instanceof File) || audio.size === 0) return erro('Áudio ausente.', 400);
    if (!name) return erro('Falta o nome da voz.', 400);
    if (audio.size > MAX_BYTES) {
      return erro(`Áudio grande demais (${(audio.size / 1048576).toFixed(1)}MB). Máximo 4MB.`, 413);
    }
    const ext = (audio.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    const mime = MIMES[ext] || (/wav/i.test(audio.type) || !audio.type.startsWith('audio/') ? 'audio/x-wav' : audio.type);

    const body: Record<string, unknown> = {
      voice_name: name,
      remove_background_noise: true,
      audio: { type: 'base64', media_type: mime, data: Buffer.from(await audio.arrayBuffer()).toString('base64') },
    };
    if (/^[a-z]{2}$/.test(language)) body.language = language;

    const r = await fetch(`${API}/v3/voices/clone`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${b.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const d = descreve(r.status, j);
      if (/resource_limit|voice clones included/i.test(d)) {
        // Números pra mensagem: limite (vem no texto do HeyGen) e quantas vozes
        // clonadas a conta tem. A janela mostra os dois.
        const [info, clones] = await Promise.all([infoConta(b.accessToken), contarClones(b.accessToken)]);
        const lim = d.match(/reached the (\d+) voice clones/i);
        return NextResponse.json(
          { error: d, limite: lim ? Number(lim[1]) : null, clones, conta: info.conta, plano: info.plano },
          { status: 409 },
        );
      }
      return erro(`O HeyGen recusou o clone: ${d}`, 502);
    }
    const voiceId = j?.data?.voice_clone_id || j?.data?.voice_id;
    if (!voiceId) return erro('O HeyGen respondeu sem voice_clone_id.', 502);
    const conta = await contaDoToken(b.accessToken);
    return NextResponse.json({ voiceId, name, conta, avisoToken: b.avisoToken || undefined });
  } catch (e) {
    return erro((e as Error)?.message || 'Erro inesperado ao clonar voz.');
  }
}

export async function GET(req: Request) {
  try {
    const g = await gate();
    if (!g.ok) return g.response;
    const b = await bearerDoUsuario();
    if (!b.ok) return b.response;
    const u = new URL(req.url);
    if (u.searchParams.get('conta')) {
      const [info, clones] = await Promise.all([
        infoConta(b.accessToken),
        u.searchParams.get('contar') ? contarClones(b.accessToken) : Promise.resolve(null),
      ]);
      return NextResponse.json({ conta: info.conta || (await contaDoToken(b.accessToken)), plano: info.plano, clones });
    }
    const id = (u.searchParams.get('id') || '').trim();
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return erro('id inválido.', 400);
    const r = await fetch(`${API}/v3/voices/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${b.accessToken}` },
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return erro(descreve(r.status, j), r.status === 404 ? 404 : 502);
    const d = j?.data || {};
    return NextResponse.json({
      status: d.status || 'complete',
      name: d.name || null,
      erro: d.failure_message || null,
    });
  } catch (e) {
    return erro((e as Error)?.message || 'Erro inesperado.');
  }
}
