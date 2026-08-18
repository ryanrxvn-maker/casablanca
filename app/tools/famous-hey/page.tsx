'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { FileUpload } from '@/components/FileUpload';
import { IconFamousHey } from '@/components/ToolIcons';
import { HeyGenContaAviso } from '@/components/HeyGenContaAviso';
import { logHistory } from '@/lib/history';
import { downloadBlob } from '@/lib/audio-engine';
import {
  type FamousHeyJob,
  type ModoFala,
  lerJobs,
  salvarJob,
  atualizarJob,
  apagarJob,
  guardarImagem,
  pegarImagem,
  guardarVideo,
  pegarVideo,
  fazerThumb,
  novoId,
} from '@/lib/famous-hey-store';

/**
 * FAMOUS HEY — uma IMAGEM fala, sem criar avatar na biblioteca do HeyGen.
 *
 * ───────────────────────── PRA QUE SERVE ─────────────────────────
 * O caminho normal (Pilot / Hey Auto) exige um avatar cadastrado. Quando a
 * moderação de likeness reprova o rosto, não existe avatar — e o disparo morre
 * com "missing image dimensions" / 0x0, que parece defeito nosso e não é
 * ([[project_heygen_moderacao_avatar_vs_imagem]]). A variante `image` do
 * /v3/videos anima a imagem SEM objeto de avatar: sem identidade pra processar,
 * não há o que a moderação reprovar.
 *
 * Esta ferramenta é só isso: um take, uma imagem, uma fala. NÃO monta nada —
 * montagem é do Pilot. Aqui sai o vídeo cru pra você levar pra edição.
 *
 * ───────────────────────── AS TRÊS FALAS ─────────────────────────
 *  TEXTO   → você escreve, escolhe a voz da conta, o HeyGen sintetiza.
 *  ÁUDIO   → seu arquivo entra como está; a boca sincroniza com ele.
 *  ÁUDIO + ESPELHAR VOZ → transcreve o áudio, VOCÊ REVISA o texto, e a voz
 *            escolhida fala.
 *
 * ⚠ Sobre "espelhar voz": o Mirror Voice de verdade (`audio_type:'sts_pending'`)
 * é speech-to-speech e EXIGE `avatar_id` — ele existe só no caminho que passa
 * pela extensão. No modo imagem não há avatar, então ele não é alcançável;
 * confirmado duas vezes (schema do /v3/videos e o CLI oficial, que só tem TTS).
 * O que esta opção faz é reproduzir o RESULTADO pelo caminho que existe:
 * transcreve e re-fala. As palavras são as mesmas; a cadência é a da voz nova,
 * não a do áudio original. Está escrito na tela — o usuário decide sabendo.
 *
 * O histórico é local (localStorage + IndexedDB), igual ao /tools/lipsync-history:
 * a URL do HeyGen expira em horas, o mp4 guardado aqui não.
 */

const PROPORCOES = [
  { id: '9:16', label: '9:16 · Reels' },
  { id: '16:9', label: '16:9 · YouTube' },
  { id: '1:1', label: '1:1 · Feed' },
  { id: '4:5', label: '4:5 · Feed alto' },
] as const;

const RESOLUCOES = [
  { id: '720p', label: '720p' },
  { id: '1080p', label: '1080p' },
] as const;

const EXPRESSIVIDADES = [
  { id: 'low', label: 'Contida' },
  { id: 'medium', label: 'Média' },
  { id: 'high', label: 'Alta' },
] as const;

/** Intervalo do poll. O HeyGen leva minutos; abaixo disto é só barulho. */
const POLL_MS = 8000;

/** Teto do upload. O Vercel corta o request em ~4,5MB ANTES de a rota rodar, e
 *  o que volta é "Falha ao ler o upload" — que não diz o tamanho nem o culpado.
 *  Barrando aqui, o usuário lê o número real do arquivo dele. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function grandeDemais(f: File, oQue: string): string | null {
  return f.size > MAX_UPLOAD_BYTES
    ? `${oQue} tem ${(f.size / 1e6).toFixed(1)}MB e o limite é 4MB. ` +
        (oQue === 'A imagem'
          ? 'Reduza a resolução ou salve em JPEG de qualidade 85.'
          : 'Exporte em MP3 128kbps — cobre uns 4 minutos de fala.')
    : null;
}

type Voz = {
  id: string;
  name: string;
  gender: string | null;
  language: string | null;
  previewAudio: string | null;
  isClone?: boolean;
};

/* ────────────────────────── relógio à prova de aba de fundo ──────────────── */
/**
 * O Chrome estrangula `setTimeout` pra ~1x por minuto quando a aba está oculta.
 * Com o poll no timer normal, um vídeo pronto em 2 min só aparecia quando o
 * usuário voltava pra aba — e parecia travado. O Worker tem timer próprio, que
 * o navegador não estrangula ([[project_heygen_poll_background_throttle]]).
 */
function criarRelogio(): { esperar: (ms: number) => Promise<void>; fechar: () => void } {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return { esperar: (ms) => new Promise((r) => setTimeout(r, ms)), fechar: () => {} };
  }
  let worker: Worker | null = null;
  try {
    const src = 'onmessage=e=>setTimeout(()=>postMessage(1),e.data)';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch {
    worker = null;
  }
  const w = worker;
  return {
    esperar: (ms) =>
      w
        ? new Promise<void>((resolve) => {
            const fim = (): void => {
              w.removeEventListener('message', fim);
              resolve();
            };
            w.addEventListener('message', fim);
            w.postMessage(ms);
          })
        : new Promise((r) => setTimeout(r, ms)),
    fechar: () => w?.terminate(),
  };
}

function tempoDecorrido(desde: number): string {
  const s = Math.max(0, Math.round((Date.now() - desde) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}min ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function nomeDeArquivo(titulo: string): string {
  const base = titulo.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'famous-hey';
  return `${base.slice(0, 60)}.mp4`;
}

/* ────────────────────────── seletor de voz ───────────────────────────────── */

function SeletorDeVoz({
  selecionada,
  onSelecionar,
  desabilitado,
}: {
  selecionada: Voz | null;
  onSelecionar: (v: Voz | null) => void;
  desabilitado?: boolean;
}) {
  const [busca, setBusca] = useState('');
  const [vozes, setVozes] = useState<Voz[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      setCarregando(true);
      setErro(null);
      try {
        const r = await fetch(`/api/heygen/voices?q=${encodeURIComponent(busca)}&lang=all`);
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok) throw new Error(j?.error || `Falha ao listar vozes (HTTP ${r.status}).`);
        setVozes((j?.voices ?? []) as Voz[]);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : 'Falha ao listar vozes.');
      } finally {
        if (vivo) setCarregando(false);
      }
    }, 320);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [busca]);

  const ouvir = (v: Voz) => {
    if (!v.previewAudio) return;
    audioRef.current?.pause();
    const a = new Audio(v.previewAudio);
    audioRef.current = a;
    void a.play().catch(() => {});
  };

  return (
    <div className="rounded-[14px] border border-line/60 bg-bg/40 p-3">
      {selecionada ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-[10px] border border-emerald-400/40 bg-emerald-400/10 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-emerald-100">
              {selecionada.name}
            </div>
            <div className="mono truncate text-[11px] text-emerald-200/70">
              {selecionada.language || 'idioma não informado'} · {selecionada.id}
            </div>
          </div>
          <button
            type="button"
            disabled={desabilitado}
            onClick={() => onSelecionar(null)}
            className="shrink-0 rounded-[8px] border border-line/60 px-2.5 py-1 text-[12px] text-text-dim hover:text-text disabled:opacity-40"
          >
            trocar
          </button>
        </div>
      ) : null}

      <input
        value={busca}
        disabled={desabilitado}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar voz pelo nome…"
        className="w-full rounded-[10px] border border-line/60 bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-text-dim/60 focus:border-line disabled:opacity-40"
      />

      {erro ? (
        <p className="mt-2 text-[12px] text-red-300">{erro}</p>
      ) : (
        <div className="mt-2 max-h-[210px] space-y-1 overflow-y-auto">
          {carregando && vozes.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-text-dim">carregando vozes…</p>
          ) : vozes.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-text-dim">
              Nenhuma voz encontrada. As vozes vêm da conta da API key configurada em
              /configuracoes/api.
            </p>
          ) : (
            vozes.map((v) => (
              <div
                key={v.id}
                className={[
                  'flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-[12.5px]',
                  selecionada?.id === v.id ? 'bg-emerald-400/10' : 'hover:bg-bg-soft/60',
                ].join(' ')}
              >
                <button
                  type="button"
                  disabled={desabilitado}
                  onClick={() => onSelecionar(v)}
                  className="min-w-0 flex-1 truncate text-left disabled:opacity-40"
                >
                  <span className="font-medium">{v.name}</span>
                  {v.isClone ? (
                    <span className="ml-1.5 rounded bg-amber-400/20 px-1 text-[10px] font-bold text-amber-200">
                      CLONE
                    </span>
                  ) : null}
                  <span className="ml-1.5 text-text-dim">{v.language || ''}</span>
                </button>
                {v.previewAudio ? (
                  <button
                    type="button"
                    onClick={() => ouvir(v)}
                    aria-label={`Ouvir ${v.name}`}
                    className="shrink-0 rounded px-1.5 text-[13px] opacity-60 hover:opacity-100"
                  >
                    ▶
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── página ───────────────────────────────────────── */

export default function FamousHeyPage() {
  const [imagem, setImagem] = useState<File | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  const [modo, setModo] = useState<ModoFala>('texto');
  const [script, setScript] = useState('');
  const [voz, setVoz] = useState<Voz | null>(null);

  const [audio, setAudio] = useState<File | null>(null);
  const [espelharVoz, setEspelharVoz] = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [transcricao, setTranscricao] = useState('');

  const [titulo, setTitulo] = useState('');
  const [motionPrompt, setMotionPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('9:16');
  const [resolution, setResolution] = useState<string>('1080p');
  const [expressiveness, setExpressiveness] = useState<string>('medium');

  const [jobs, setJobs] = useState<FamousHeyJob[]>([]);
  const [fase, setFase] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState(false);

  // Jobs já acompanhados nesta aba — evita dois loops de poll no mesmo vídeo
  // depois de um F5 ou de um "refazer".
  const acompanhando = useRef<Set<string>>(new Set());

  useEffect(() => setJobs(lerJobs()), []);

  useEffect(() => {
    if (!imagem) {
      setPreviewImg(null);
      return;
    }
    const url = URL.createObjectURL(imagem);
    setPreviewImg(url);
    return () => URL.revokeObjectURL(url);
  }, [imagem]);

  const emAndamento = useMemo(
    () => jobs.find((j) => j.status === 'processando') ?? null,
    [jobs],
  );

  /* ── acompanhar um vídeo até ficar pronto ─────────────────────────────── */
  const acompanhar = useCallback(async (jobId: string, videoId: string) => {
    if (acompanhando.current.has(jobId)) return;
    acompanhando.current.add(jobId);
    const relogio = criarRelogio();
    try {
      // Teto de 40min. O modo imagem entrega em minutos; passar disto significa
      // que travou do lado do HeyGen, e um poll eterno esconderia isso.
      const limite = Date.now() + 40 * 60 * 1000;
      for (;;) {
        await relogio.esperar(POLL_MS);
        let st: {
          status?: string;
          videoUrl?: string | null;
          duration?: number | null;
          error?: string | null;
        } | null = null;
        try {
          const r = await fetch(`/api/heygen/image-video?videoId=${encodeURIComponent(videoId)}`);
          st = await r.json().catch(() => null);
          if (!r.ok) throw new Error(st?.error || `HTTP ${r.status}`);
        } catch {
          // Falha de rede não mata o job: o vídeo continua sendo gerado lá.
          // Tenta de novo no próximo ciclo até estourar o teto.
          if (Date.now() > limite) {
            setJobs(
              atualizarJob(jobId, {
                status: 'falhou',
                erro: 'Perdi contato com o HeyGen. O vídeo pode ter saído — confira na conta.',
              }),
            );
            return;
          }
          continue;
        }

        if (st?.status === 'failed') {
          setJobs(
            atualizarJob(jobId, {
              status: 'falhou',
              erro: st.error || 'O HeyGen recusou a geração.',
            }),
          );
          logHistory({ tool: 'FAMOUS HEY', title: 'Geração falhou', kind: 'dispatch' });
          return;
        }

        if (st?.status === 'completed' && st.videoUrl) {
          setJobs(atualizarJob(jobId, { videoUrl: st.videoUrl, duracao: st.duration ?? null }));
          // Baixa AGORA pro IndexedDB: a URL do HeyGen expira em horas e o
          // histórico promete "baixar de novo" pra sempre.
          let temVideo = false;
          let bytes: number | null = null;
          try {
            const r = await fetch(
              `/api/heygen/image-video/arquivo?videoId=${encodeURIComponent(videoId)}`,
            );
            if (r.ok) {
              const blob = await r.blob();
              if (blob.size > 0) {
                temVideo = await guardarVideo(jobId, blob);
                bytes = blob.size;
              }
            }
          } catch {
            // Sem cópia local o vídeo ainda aparece — só o "baixar" passa a
            // depender da URL do HeyGen. O card avisa quando é esse o caso.
          }
          setJobs(atualizarJob(jobId, { status: 'pronto', erro: null, temVideo, bytes }));
          logHistory({
            tool: 'FAMOUS HEY',
            title: 'Vídeo pronto',
            kind: 'done',
            meta: st.duration ? `${st.duration.toFixed(1)}s` : undefined,
          });
          return;
        }

        if (Date.now() > limite) {
          setJobs(
            atualizarJob(jobId, {
              status: 'falhou',
              erro: 'Passou de 40 minutos sem terminar. Confira o vídeo direto na conta do HeyGen.',
            }),
          );
          return;
        }
      }
    } finally {
      relogio.fechar();
      acompanhando.current.delete(jobId);
    }
  }, []);

  // F5 no meio da geração não pode perder o vídeo: retoma o poll do que ficou.
  useEffect(() => {
    for (const j of jobs) {
      if (j.status === 'processando' && !acompanhando.current.has(j.id)) {
        void acompanhar(j.id, j.videoId);
      }
    }
  }, [jobs, acompanhar]);

  /* ── transcrever o áudio (para "espelhar voz") ────────────────────────── */
  const transcrever = async () => {
    if (!audio) return;
    setTranscrevendo(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append('audio', audio);
      fd.append('language', 'auto');
      const r = await fetch('/api/tipografia/transcribe', { method: 'POST', body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `Falha ao transcrever (HTTP ${r.status}).`);
      const palavras = (j?.words ?? []) as Array<{ text: string }>;
      const texto = palavras
        .map((w) => w.text)
        .join(' ')
        .replace(/\s+([,.!?;:])/g, '$1')
        .trim();
      if (!texto) throw new Error('A transcrição voltou vazia. O áudio tem fala audível?');
      setTranscricao(texto);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao transcrever.');
    } finally {
      setTranscrevendo(false);
    }
  };

  /* ── disparar ─────────────────────────────────────────────────────────── */
  const podeDisparar = (): string | null => {
    if (!imagem) return 'Suba a imagem que vai falar.';
    if (emAndamento) return 'Já tem um vídeo sendo gerado. Um de cada vez.';
    if (modo === 'texto') {
      if (!script.trim()) return 'Escreva o texto da fala.';
      if (!voz) return 'Escolha a voz.';
      return null;
    }
    if (!audio) return 'Suba o áudio da fala.';
    if (espelharVoz) {
      if (!voz) return 'Escolha a voz que vai substituir a original.';
      if (!transcricao.trim()) return 'Transcreva o áudio (e revise o texto) antes de gerar.';
    }
    return null;
  };

  const disparar = async () => {
    const impedimento = podeDisparar();
    if (impedimento) {
      setErro(impedimento);
      return;
    }
    if (!imagem) return;

    setDisparando(true);
    setErro(null);
    const id = novoId();
    const nome = titulo.trim() || imagem.name.replace(/\.[a-z0-9]+$/i, '') || 'FAMOUS HEY';

    try {
      // Com "espelhar voz" o disparo é de TEXTO: a fala vira o texto revisado
      // dito pela voz escolhida. É o caminho já provado, sem endpoint novo.
      const vaiDeAudio = modo === 'audio' && !espelharVoz;
      const textoFinal = modo === 'texto' ? script.trim() : transcricao.trim();

      let audioUrl = '';
      let audioAssetId = '';
      if (vaiDeAudio && audio) {
        setFase('subindo o áudio…');
        const fdA = new FormData();
        fdA.append('audio', audio);
        const rA = await fetch('/api/heygen/audio-asset', { method: 'POST', body: fdA });
        const jA = await rA.json().catch(() => null);
        if (!rA.ok) throw new Error(jA?.error || `Falha ao subir o áudio (HTTP ${rA.status}).`);
        audioUrl = jA?.url || '';
        audioAssetId = jA?.assetId || '';
        if (!audioUrl && !audioAssetId) {
          throw new Error('O upload do áudio não devolveu referência.');
        }
      }

      setFase('enviando pro HeyGen…');
      const fd = new FormData();
      fd.append('image', imagem, imagem.name || 'imagem.jpg');
      if (vaiDeAudio) {
        if (audioAssetId) fd.append('audioAssetId', audioAssetId);
        if (audioUrl) fd.append('audioUrl', audioUrl);
      } else {
        fd.append('script', textoFinal);
        fd.append('voiceId', voz?.id || '');
      }
      if (motionPrompt.trim()) fd.append('motionPrompt', motionPrompt.trim());
      fd.append('title', nome);
      fd.append('aspectRatio', aspectRatio);
      fd.append('resolution', resolution);
      fd.append('expressiveness', expressiveness);

      const r = await fetch('/api/heygen/image-video', { method: 'POST', body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.videoId) {
        throw new Error(j?.error || `O HeyGen recusou o disparo (HTTP ${r.status}).`);
      }
      if (j.avisoToken) {
        // O vídeo saiu, mas o refresh novo não foi gravado: é a PRÓXIMA geração
        // que morre. Aparece agora, enquanto dá pra consertar.
        console.error('[FAMOUS HEY] OAuth:', j.avisoToken);
        setErro(`⚠ O vídeo saiu, mas o login do HeyGen não foi renovado: ${j.avisoToken}`);
      }

      setFase('guardando…');
      const thumb = await fazerThumb(imagem);
      const temImagem = await guardarImagem(id, imagem);

      const job: FamousHeyJob = {
        id,
        videoId: j.videoId,
        titulo: nome,
        criadoEm: Date.now(),
        status: 'processando',
        erro: null,
        modo,
        script: vaiDeAudio ? '' : textoFinal,
        voiceId: vaiDeAudio ? null : voz?.id ?? null,
        voiceNome: vaiDeAudio ? null : voz?.name ?? null,
        audioNome: vaiDeAudio ? audio?.name ?? null : null,
        motionPrompt: motionPrompt.trim(),
        aspectRatio,
        resolution,
        expressiveness,
        thumb,
        temImagem,
        duracao: null,
        videoUrl: null,
        temVideo: false,
        bytes: null,
      };
      setJobs(salvarJob(job));
      logHistory({ tool: 'FAMOUS HEY', title: `Disparou "${nome}"`, kind: 'dispatch' });
      void acompanhar(id, j.videoId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado no disparo.');
    } finally {
      setFase('');
      setDisparando(false);
    }
  };

  /* ── ações do histórico ───────────────────────────────────────────────── */

  const baixar = async (job: FamousHeyJob) => {
    setErro(null);
    const local = await pegarVideo(job.id);
    if (local && local.size > 0) {
      await downloadBlob(local, nomeDeArquivo(job.titulo));
      return;
    }
    // Sem cópia local (falhou na hora, ou o navegador limpou): tenta o proxy,
    // que resolve a URL fresca a partir do videoId.
    try {
      const r = await fetch(
        `/api/heygen/image-video/arquivo?videoId=${encodeURIComponent(job.videoId)}`,
      );
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const guardou = await guardarVideo(job.id, blob);
      setJobs(atualizarJob(job.id, { temVideo: guardou, bytes: blob.size }));
      await downloadBlob(blob, nomeDeArquivo(job.titulo));
    } catch (e) {
      setErro(
        `Não consegui recuperar esse vídeo (${e instanceof Error ? e.message : 'erro'}). ` +
          'Vídeos do HeyGen saem do ar depois de um tempo.',
      );
    }
  };

  /** Recarrega a ficha no formulário — pra editar o texto, trocar o áudio ou só
   *  regerar com outro ajuste. A imagem volta do IndexedDB. */
  const reabrir = async (job: FamousHeyJob) => {
    // Recados acumulam em vez de um sobrescrever o outro: quando falta a imagem
    // E o áudio, o usuário precisa saber das duas coisas, não da última.
    const recados: string[] = [];
    const img = await pegarImagem(job.id);
    if (img) {
      setImagem(new File([img], `${job.titulo}.jpg`, { type: img.type || 'image/jpeg' }));
    } else {
      recados.push('A imagem original não está mais guardada — suba ela de novo.');
    }
    setTitulo(job.titulo);
    setMotionPrompt(job.motionPrompt);
    setAspectRatio(job.aspectRatio);
    setResolution(job.resolution);
    setExpressiveness(job.expressiveness);
    if (job.script) {
      setModo('texto');
      setScript(job.script);
      setEspelharVoz(false);
      if (job.voiceId) {
        setVoz({
          id: job.voiceId,
          name: job.voiceNome || job.voiceId,
          gender: null,
          language: null,
          previewAudio: null,
        });
      }
    } else {
      // Job de áudio: o arquivo NÃO é guardado (só o vídeo e a imagem cabem no
      // orçamento do IndexedDB). Sem este recado o campo volta vazio e parece
      // bug — o usuário fica procurando o áudio que ele "já tinha subido".
      setModo('audio');
      setEspelharVoz(false);
      setAudio(null);
      recados.push(
        `O áudio não fica guardado no navegador — suba de novo${
          job.audioNome ? ` (era "${job.audioNome}")` : ''
        }.`,
      );
    }
    setErro(recados.length ? recados.join(' ') : null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const impedimento = podeDisparar();

  return (
    <ToolShell
      title="FAMOUS HEY"
      eyebrow="HEYGEN · MODO IMAGEM"
      description="Uma foto fala. Sem criar avatar na biblioteca — por isso passa onde a moderação de rosto barra."
      hue="rgba(251, 191, 36, 0.42)"
      icon={<IconFamousHey size={30} />}
    >
      <HeyGenContaAviso />

      <section className="mb-6">
        <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-text-dim">
          1 · A imagem que vai falar
        </h2>
        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
          <div>
            <FileUpload
              accept="image/jpeg,image/png,image/webp"
              label="Selecione ou arraste a imagem"
              hint="JPEG, PNG ou WebP · até 4MB · rosto de frente e bem iluminado funciona melhor"
              value={imagem}
              onChange={(f) => {
                const grande = f ? grandeDemais(f, 'A imagem') : null;
                setErro(grande);
                setImagem(grande ? null : f);
              }}
            />
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Nome do vídeo (opcional)"
              className="mt-2 w-full rounded-[10px] border border-line/60 bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-text-dim/60 focus:border-line"
            />
          </div>
          <div className="flex items-center justify-center rounded-[14px] border border-line/60 bg-bg/40 p-2">
            {previewImg ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewImg}
                alt="Imagem escolhida"
                className="max-h-[220px] w-auto rounded-[10px] object-contain"
              />
            ) : (
              <span className="px-2 text-center text-[12px] text-text-dim">
                a imagem aparece aqui
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-text-dim">
          2 · A fala
        </h2>
        <div className="mb-3 inline-flex rounded-[12px] border border-line/60 bg-bg/40 p-1">
          {(['texto', 'audio'] as ModoFala[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setModo(m);
                setErro(null);
              }}
              className={[
                'rounded-[9px] px-4 py-1.5 text-[13px] font-semibold transition',
                modo === m ? 'bg-text text-bg' : 'text-text-dim hover:text-text',
              ].join(' ')}
            >
              {m === 'texto' ? 'Escrever o texto' : 'Usar um áudio'}
            </button>
          ))}
        </div>

        {modo === 'texto' ? (
          <div className="space-y-3">
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={5}
              placeholder="O que a pessoa da imagem vai falar…"
              className="w-full rounded-[12px] border border-line/60 bg-bg px-3 py-2.5 text-[13.5px] leading-relaxed outline-none placeholder:text-text-dim/60 focus:border-line"
            />
            <div className="text-[11.5px] text-text-dim">{script.trim().length} caracteres</div>
            <SeletorDeVoz selecionada={voz} onSelecionar={setVoz} />
          </div>
        ) : (
          <div className="space-y-3">
            <FileUpload
              accept="audio/*"
              label="Selecione ou arraste o áudio da fala"
              hint="MP3, WAV, M4A ou OGG · até 4MB (MP3 128kbps cobre ~4 minutos)"
              value={audio}
              onChange={(f) => {
                const grande = f ? grandeDemais(f, 'O áudio') : null;
                setErro(grande);
                setAudio(grande ? null : f);
                setTranscricao('');
              }}
            />

            <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line/60 bg-bg/40 p-3">
              <input
                type="checkbox"
                checked={espelharVoz}
                onChange={(e) => setEspelharVoz(e.target.checked)}
                className="mt-[3px]"
              />
              <span className="text-[13px]">
                <span className="font-semibold">Espelhar voz</span>
                <span className="text-text-dim">
                  {' '}
                  — trocar a voz do áudio por outra da sua conta.
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-amber-200/80">
                  Como funciona de verdade: eu transcrevo o áudio, <b>você revisa o texto</b> e a
                  voz escolhida fala. As palavras são as mesmas; a cadência passa a ser a da voz
                  nova. O espelhamento speech-to-speech do HeyGen exige um avatar cadastrado, e
                  aqui não existe avatar — é justamente o que faz esta ferramenta passar pela
                  moderação.
                </span>
              </span>
            </label>

            {espelharVoz ? (
              <div className="space-y-3 rounded-[12px] border border-amber-400/30 bg-amber-400/[0.06] p-3">
                <button
                  type="button"
                  onClick={transcrever}
                  disabled={!audio || transcrevendo}
                  className="rounded-[10px] border border-line/60 bg-bg px-3.5 py-2 text-[13px] font-semibold hover:border-line disabled:opacity-40"
                >
                  {transcrevendo ? 'transcrevendo…' : 'Transcrever o áudio'}
                </button>
                <textarea
                  value={transcricao}
                  onChange={(e) => setTranscricao(e.target.value)}
                  rows={5}
                  placeholder="A transcrição aparece aqui pra você revisar antes de gerar."
                  className="w-full rounded-[12px] border border-line/60 bg-bg px-3 py-2.5 text-[13.5px] leading-relaxed outline-none placeholder:text-text-dim/60 focus:border-line"
                />
                <p className="text-[11.5px] text-text-dim">
                  Confira nomes próprios e números — é este texto que vai ser falado, não o áudio.
                </p>
                <SeletorDeVoz selecionada={voz} onSelecionar={setVoz} />
              </div>
            ) : (
              <p className="text-[12px] text-text-dim">
                A voz do arquivo entra como está — a boca da imagem sincroniza com ela.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-text-dim">
          3 · Ajustes
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-text-dim">Proporção</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full rounded-[10px] border border-line/60 bg-bg px-3 py-2 text-[13px] outline-none focus:border-line"
            >
              {PROPORCOES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-text-dim">Resolução</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="w-full rounded-[10px] border border-line/60 bg-bg px-3 py-2 text-[13px] outline-none focus:border-line"
            >
              {RESOLUCOES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-text-dim">Expressividade</span>
            <select
              value={expressiveness}
              onChange={(e) => setExpressiveness(e.target.value)}
              className="w-full rounded-[10px] border border-line/60 bg-bg px-3 py-2 text-[13px] outline-none focus:border-line"
            >
              {EXPRESSIVIDADES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-[12px] text-text-dim">
            Movimento (opcional) — descreva a cena; em inglês funciona melhor
          </span>
          <input
            value={motionPrompt}
            onChange={(e) => setMotionPrompt(e.target.value)}
            placeholder="ex.: slight push-in, natural hand gestures, soft daylight"
            className="w-full rounded-[10px] border border-line/60 bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-text-dim/60 focus:border-line"
          />
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={disparar}
          disabled={!!impedimento || disparando}
          className="rounded-[12px] bg-text px-6 py-2.5 text-[14px] font-bold text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {disparando ? fase || 'enviando…' : 'Gerar vídeo'}
        </button>
        {impedimento && !disparando ? (
          <span className="text-[12.5px] text-text-dim">{impedimento}</span>
        ) : null}
      </div>

      {erro ? (
        <p className="mt-3 rounded-[10px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-100">
          {erro}
        </p>
      ) : null}

      {emAndamento ? <CardProgresso job={emAndamento} /> : null}

      <section className="mt-8 border-t border-line/50 pt-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-text-dim">Histórico</h2>
          <span className="text-[11.5px] text-text-dim">
            fica neste navegador · os 30 mais recentes
          </span>
        </div>
        {jobs.length === 0 ? (
          <p className="text-[13px] text-text-dim">
            Nada gerado ainda. O que sair daqui fica guardado pra baixar de novo quando quiser.
          </p>
        ) : (
          <div className="space-y-2.5">
            {jobs.map((job) => (
              <CardJob
                key={job.id}
                job={job}
                onBaixar={() => void baixar(job)}
                onReabrir={() => void reabrir(job)}
                onApagar={() => setJobs(apagarJob(job.id))}
              />
            ))}
          </div>
        )}
      </section>
    </ToolShell>
  );
}

/* ────────────────────────── cards ────────────────────────────────────────── */

function CardProgresso({ job }: { job: FamousHeyJob }) {
  const [, forcarRender] = useState(0);
  // O tempo decorrido é o único sinal honesto que temos: o HeyGen não expõe
  // porcentagem no modo imagem, e uma barra de progresso falsa mentiria sobre
  // o quanto falta.
  useEffect(() => {
    const t = setInterval(() => forcarRender((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mt-5 overflow-hidden rounded-[16px] border border-amber-400/40 bg-amber-400/[0.07]">
      <div className="flex items-center gap-4 p-4">
        {job.thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={job.thumb} alt="" className="h-16 w-16 shrink-0 rounded-[10px] object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" />
            <span className="truncate text-[14px] font-bold text-amber-100">{job.titulo}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-amber-200/85">
            gerando no HeyGen · {tempoDecorrido(job.criadoEm)}
          </p>
          <p className="mt-1 text-[11.5px] text-amber-200/60">
            Pode trocar de aba — o relógio do poll roda em Worker e não é estrangulado.
          </p>
        </div>
      </div>
      <div className="h-[3px] w-full overflow-hidden bg-amber-400/15">
        <div className="h-full w-1/3 animate-pulse bg-amber-300/70" />
      </div>
    </div>
  );
}

function CardJob({
  job,
  onBaixar,
  onReabrir,
  onApagar,
}: {
  job: FamousHeyJob;
  onBaixar: () => void;
  onReabrir: () => void;
  onApagar: () => void;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Só a URL que ESTE componente criou pode ser revogada — a do HeyGen não é
  // object URL, e revogar a errada deixaria o player em branco.
  const criadaAqui = useRef(false);

  useEffect(
    () => () => {
      if (previewUrl && criadaAqui.current) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const verPreview = async () => {
    setAbrindo(true);
    try {
      const local = await pegarVideo(job.id);
      if (local && local.size > 0) {
        criadaAqui.current = true;
        setPreviewUrl(URL.createObjectURL(local));
      } else if (job.videoUrl) {
        criadaAqui.current = false;
        setPreviewUrl(job.videoUrl);
      }
    } finally {
      setAbrindo(false);
    }
  };

  const cor =
    job.status === 'pronto'
      ? 'border-emerald-400/35'
      : job.status === 'falhou'
        ? 'border-red-500/35'
        : 'border-amber-400/35';

  return (
    <div className={`rounded-[14px] border ${cor} bg-bg/35 p-3`}>
      <div className="flex items-start gap-3">
        {job.thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={job.thumb} alt="" className="h-14 w-14 shrink-0 rounded-[9px] object-cover" />
        ) : (
          <div className="h-14 w-14 shrink-0 rounded-[9px] bg-bg-soft/60" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{job.titulo}</div>
          <div className="mono mt-0.5 truncate text-[11px] text-text-dim">
            {new Date(job.criadoEm).toLocaleString('pt-BR')} · {job.aspectRatio} · {job.resolution}
            {job.duracao ? ` · ${job.duracao.toFixed(1)}s` : ''}
            {job.bytes ? ` · ${(job.bytes / 1e6).toFixed(1)}MB` : ''}
          </div>
          <div className="mt-1 text-[11.5px] text-text-dim">
            {job.voiceNome
              ? `voz: ${job.voiceNome}`
              : job.audioNome
                ? `áudio: ${job.audioNome}`
                : ''}
          </div>
          {job.status === 'falhou' && job.erro ? (
            <p className="mt-1 text-[12px] text-red-300">{job.erro}</p>
          ) : null}
          {job.status === 'pronto' && !job.temVideo ? (
            <p className="mt-1 text-[11.5px] text-amber-200/80">
              Sem cópia local — o download depende da URL do HeyGen, que expira.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {job.status === 'pronto' ? (
            <>
              <button
                type="button"
                onClick={onBaixar}
                className="rounded-[9px] bg-text px-3 py-1.5 text-[12px] font-bold text-bg hover:opacity-90"
              >
                Baixar
              </button>
              <button
                type="button"
                onClick={() => void verPreview()}
                disabled={abrindo}
                className="rounded-[9px] border border-line/60 px-3 py-1.5 text-[12px] hover:border-line disabled:opacity-40"
              >
                {abrindo ? '…' : 'Ver'}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={onReabrir}
            className="rounded-[9px] border border-line/60 px-3 py-1.5 text-[12px] hover:border-line"
            title="Carrega esta ficha no formulário pra editar o texto, trocar o áudio ou regerar"
          >
            Refazer
          </button>
          <button
            type="button"
            onClick={onApagar}
            className="rounded-[9px] px-3 py-1 text-[11.5px] text-text-dim hover:text-red-300"
          >
            apagar
          </button>
        </div>
      </div>
      {previewUrl ? (
        <video
          src={previewUrl}
          controls
          playsInline
          className="mt-3 max-h-[420px] w-full rounded-[10px] bg-black"
        />
      ) : null}
    </div>
  );
}
