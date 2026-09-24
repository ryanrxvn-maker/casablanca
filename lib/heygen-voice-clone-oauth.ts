/**
 * Clone de voz POR CÓDIGO (servidor + OAuth, trilho do modo imagem) — client.
 * Ver app/api/heygen/voice-clone/route.ts.
 *
 * O áudio sai daqui já enxuto: WAV mono 24kHz com no máximo 75s (~3,6MB), pra
 * caber no teto de ~4,5MB do Vercel. 24kHz sobra pra clone (voz vai até ~8kHz)
 * e 75s está dentro dos 30–90s que o HeyGen pede.
 */

const SR = 24000;
const MAX_SEG = 75;

export type ClonarVozOAuthResult =
  | { ok: true; voiceId: string; voiceName: string; conta: string | null }
  | { ok: false; error: string; limite?: boolean; clones?: number | null; plano?: string | null };

function wavMono16(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  let p = 0;
  const s = (t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(p++, t.charCodeAt(i)); };
  s('RIFF'); v.setUint32(p, 36 + samples.length * 2, true); p += 4; s('WAVE');
  s('fmt '); v.setUint32(p, 16, true); p += 4; v.setUint16(p, 1, true); p += 2; v.setUint16(p, 1, true); p += 2;
  v.setUint32(p, sampleRate, true); p += 4; v.setUint32(p, sampleRate * 2, true); p += 4;
  v.setUint16(p, 2, true); p += 2; v.setUint16(p, 16, true); p += 2;
  s('data'); v.setUint32(p, samples.length * 2, true); p += 4;
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(p, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    p += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function decodificar(blob: Blob): Promise<AudioBuffer> {
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ac: AudioContext = new Ctx();
  try {
    return await ac.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ac.close().catch(() => {});
  }
}

/** Áudio OU vídeo → WAV mono 24kHz ≤75s. Lança com mensagem legível. */
export async function prepararAudioPraClone(file: File): Promise<{ blob: Blob; segundos: number }> {
  let decoded: AudioBuffer;
  try {
    decoded = await decodificar(file);
  } catch {
    // Contêiner que o decodeAudioData não abre (alguns .mov/.webm): extrai antes.
    try {
      const { extractAudio } = await import('./ffmpeg-worker');
      decoded = await decodificar(await extractAudio(file));
    } catch (e) {
      throw new Error(`Não consegui ler o áudio desse arquivo (${(e as Error)?.message || 'formato'}).`);
    }
  }
  const segundos = Math.min(decoded.duration, MAX_SEG);
  if (segundos < 8) throw new Error(`Áudio curto demais (${decoded.duration.toFixed(1)}s). Mande pelo menos 10s de fala.`);
  const off = new OfflineAudioContext(1, Math.ceil(segundos * SR), SR);
  const src = off.createBufferSource();
  src.buffer = decoded; // multicanal → mono: o destino de 1 canal faz o downmix
  src.connect(off.destination);
  src.start(0, 0, segundos);
  const out = await off.startRendering();
  const pcm = out.getChannelData(0);
  let pico = 0;
  for (let i = 0; i < pcm.length; i += 64) pico = Math.max(pico, Math.abs(pcm[i]));
  if (pico < 0.01) throw new Error('O áudio está mudo (ou quase). Confira o arquivo.');
  return { blob: wavMono16(pcm, SR), segundos };
}

async function lerErro(r: Response): Promise<string> {
  const j = await r.json().catch(() => null);
  return (j && (j.error || j.message)) || `HTTP ${r.status}`;
}

/** Conta HeyGen do OAuth do site (onde o clone por código vai nascer), com o
 *  plano e — se `contar` — quantas vozes clonadas ela tem. null = sem OAuth. */
export async function infoContaOAuth(
  contar = false,
): Promise<{ conta: string; plano: string | null; clones: number | null } | null> {
  try {
    const r = await fetch(`/api/heygen/voice-clone?conta=1${contar ? '&contar=1' : ''}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.conta ? { conta: String(j.conta), plano: j.plano || null, clones: typeof j.clones === 'number' ? j.clones : null } : null;
  } catch {
    return null;
  }
}

export async function contaDoCloneOAuth(): Promise<string | null> {
  return (await infoContaOAuth())?.conta || null;
}

export async function clonarVozPorOAuth(
  file: File,
  opts: {
    nome: string;
    language?: string | null;
    onProgress?: (stage: string, percent: number, message: string) => void;
  },
): Promise<ClonarVozOAuthResult> {
  const prog = opts.onProgress || (() => {});
  try {
    prog('preparar', 5, 'Preparando o áudio...');
    const { blob, segundos } = await prepararAudioPraClone(file);
    prog('enviar', 20, `Enviando ${Math.round(segundos)}s de áudio...`);
    const fd = new FormData();
    fd.append('audio', new File([blob], 'voz.wav', { type: 'audio/wav' }));
    fd.append('name', opts.nome.slice(0, 50));
    if (opts.language) fd.append('language', opts.language);
    const r = await fetch('/api/heygen/voice-clone', { method: 'POST', body: fd });
    if (!r.ok) {
      if (r.status === 409) {
        const j = await r.json().catch(() => null);
        return { ok: false, error: (j && j.error) || 'limite de clones', limite: true, clones: j?.clones ?? null, plano: j?.plano ?? null };
      }
      return { ok: false, error: await lerErro(r) };
    }
    const j = await r.json();
    const voiceId = String(j.voiceId || '');
    if (!voiceId) return { ok: false, error: 'Servidor não devolveu o id da voz.' };
    console.info('[clone voz] criado', { voiceId, conta: j.conta });

    // Poll até complete (normalmente 10–60s). 3 min de teto.
    const inicio = Date.now();
    for (let i = 0; Date.now() - inicio < 180_000; i++) {
      await new Promise((res) => setTimeout(res, i === 0 ? 2500 : 4000));
      const pct = Math.min(95, 35 + i * 4);
      const s = await fetch(`/api/heygen/voice-clone?id=${encodeURIComponent(voiceId)}`, { cache: 'no-store' });
      if (!s.ok) {
        if (s.status >= 500) { prog('processando', pct, 'Processando no HeyGen...'); continue; }
        return { ok: false, error: await lerErro(s) };
      }
      const st = await s.json();
      if (st.status === 'complete') {
        prog('done', 100, 'Pronto');
        return { ok: true, voiceId, voiceName: st.name || opts.nome, conta: j.conta || null };
      }
      if (st.status === 'failed') return { ok: false, error: `O HeyGen reprovou o clone: ${st.erro || 'sem detalhe'}` };
      prog('processando', pct, 'Processando no HeyGen...');
    }
    return { ok: false, error: `O clone (${voiceId}) passou de 3 min processando. Confira de novo em instantes.` };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) };
  }
}
