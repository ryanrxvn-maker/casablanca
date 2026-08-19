'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToolShell } from '@/components/ToolShell';
import { IconFamousHey } from '@/components/ToolIcons';
import { Btn3D } from '@/components/BatchJobCard3D';
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
  { id: '9:16', label: '9:16' },
  { id: '16:9', label: '16:9' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
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


/* ────────────────────────── ícones ──────────────────────────────────────── */
/* Inline e sem dependência, no mesmo traço dos ícones do BatchJobCard3D. */

const svg = (size: number, d: React.ReactNode, strokeWidth = 2) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {d}
  </svg>
);

const IconBaixar = ({ size = 16 }: { size?: number }) =>
  svg(size, <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>, 2.2);
const IconPlay = ({ size = 15 }: { size?: number }) =>
  svg(size, <path d="M7 4.5v15l12-7.5-12-7.5z" fill="currentColor" stroke="none" />);
const IconRefazer = ({ size = 15 }: { size?: number }) =>
  svg(size, <><path d="M21 12a9 9 0 1 1-3.2-6.9" /><path d="M21 3v6h-6" /></>, 2.2);
const IconLixo = ({ size = 15 }: { size?: number }) =>
  svg(size, <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M7 7v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" /></>, 2.2);
const IconLupa = ({ size = 14 }: { size?: number }) =>
  svg(size, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 2.2);
const IconFoto = ({ size = 22 }: { size?: number }) =>
  svg(size, <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-4 4 3 3-2 4 3" /></>, 1.8);
const IconOnda = ({ size = 15 }: { size?: number }) =>
  svg(size, <><path d="M4 12h1.5" /><path d="M8 8v8" /><path d="M12 5v14" /><path d="M16 8.5v7" /><path d="M20 11h.5" /></>, 2.2);
const IconTexto = ({ size = 15 }: { size?: number }) =>
  svg(size, <><path d="M5 6h14" /><path d="M5 12h14" /><path d="M5 18h9" /></>, 2.2);
const IconRaio = ({ size = 16 }: { size?: number }) =>
  svg(size, <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" fill="currentColor" stroke="none" />);

/* ────────────────────────── peças de layout ─────────────────────────────── */

/** Bloco de etapa: painel de vidro + selo numerado. O número dá ORDEM de
 *  leitura — sem ele a tela vira uma pilha de campos sem hierarquia. */
function Etapa({
  n,
  titulo,
  aparte,
  children,
}: {
  n: string;
  titulo: string;
  aparte?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel mb-4 rounded-[18px] p-4 md:p-5">
      <header className="mb-3.5 flex items-center gap-2.5">
        <span
          className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[11px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_12px_-4px_rgba(167,139,250,0.7)]"
          style={{ background: 'linear-gradient(140deg,#a78bfa,#6366f1 60%,#2563eb)' }}
        >
          {n}
        </span>
        <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-text">{titulo}</h2>
        {aparte ? (
          <span className="ml-auto hidden text-[11px] text-text-muted sm:block">{aparte}</span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Grupo de opções em pílulas. Substitui `<select>` onde há poucas escolhas:
 *  tudo visível de uma vez, um clique em vez de dois, e dá pra estilizar —
 *  `<select>` nativo ignora quase todo CSS e destoava do resto. */
function Segmentos<T extends string>({
  valor,
  onChange,
  opcoes,
  rotulo,
}: {
  valor: T;
  onChange: (v: T) => void;
  opcoes: ReadonlyArray<{ id: T; label: string }>;
  rotulo: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
        {rotulo}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {opcoes.map((o) => {
          const ativo = o.id === valor;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={ativo}
              className={[
                'rounded-[10px] border px-3 py-1.5 text-[12.5px] font-semibold transition-all duration-200',
                'active:scale-[0.96]',
                ativo
                  ? 'border-violet/60 bg-violet/15 text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_6px_16px_-8px_rgba(167,139,250,0.8)]'
                  : 'border-line bg-bg-soft/50 text-text-muted hover:-translate-y-[1px] hover:border-line-strong hover:text-text',
              ].join(' ')}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────── seletor de voz ──────────────────────────────── */

function SeletorDeVoz({
  selecionada,
  onSelecionar,
}: {
  selecionada: Voz | null;
  onSelecionar: (v: Voz | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const [vozes, setVozes] = useState<Voz[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tocando, setTocando] = useState<string | null>(null);
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

  useEffect(() => () => audioRef.current?.pause(), []);

  const ouvir = (v: Voz) => {
    audioRef.current?.pause();
    if (!v.previewAudio) return;
    if (tocando === v.id) {
      setTocando(null);
      return;
    }
    const a = new Audio(v.previewAudio);
    audioRef.current = a;
    a.onended = () => setTocando(null);
    setTocando(v.id);
    void a.play().catch(() => setTocando(null));
  };

  return (
    <div>
      {selecionada ? (
        /* SELECIONADA — barra de acento + texto no token do tema.
         * Antes era emerald-100 sobre emerald/10: no modo claro dava verde
         * clarinho sobre fundo claro e não se lia nada. Agora o contraste vem
         * do token `text`, que inverte junto com o tema. */
        <div className="mb-2.5 flex items-center gap-3 overflow-hidden rounded-[12px] border border-lime/50 bg-lime/[0.08] pl-0 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
          <span className="h-full w-[3px] self-stretch bg-lime" aria-hidden />
          <button
            type="button"
            onClick={() => ouvir(selecionada)}
            disabled={!selecionada.previewAudio}
            title={selecionada.previewAudio ? 'Ouvir' : 'Sem prévia'}
            aria-label="Ouvir a voz escolhida"
            className="my-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-lime/50 bg-lime/15 text-text transition-transform hover:scale-110 active:scale-95 disabled:opacity-35"
          >
            {tocando === selecionada.id ? <IconOnda size={14} /> : <IconPlay size={12} />}
          </button>
          <div className="min-w-0 flex-1 py-2">
            <div className="truncate text-[13.5px] font-bold text-text">{selecionada.name.trim()}</div>
            <div className="mono truncate text-[10.5px] text-text-muted">
              {selecionada.language || 'idioma não informado'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelecionar(null)}
            className="chip-3d shrink-0"
          >
            trocar
          </button>
        </div>
      ) : null}

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
          <IconLupa />
        </span>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar voz pelo nome…"
          className="w-full rounded-[11px] border border-line bg-bg/60 py-2 pl-9 pr-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-dim focus:border-violet/55"
        />
      </div>

      {erro ? (
        <p className="mt-2 text-[12px] text-red-400">{erro}</p>
      ) : (
        <div className="mt-2 max-h-[210px] space-y-0.5 overflow-y-auto pr-0.5">
          {carregando && vozes.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-text-muted">carregando vozes…</p>
          ) : vozes.length === 0 ? (
            <p className="px-1 py-2 text-[12px] text-text-muted">
              Nenhuma voz encontrada. Se a busca estiver vazia e mesmo assim não vier
              nada, é sinal de que o HeyGen ainda não está conectado.
            </p>
          ) : (
            vozes.map((v) => {
              const ativa = selecionada?.id === v.id;
              return (
                <div
                  key={v.id}
                  className={[
                    'flex items-center gap-2 rounded-[10px] border px-2 py-1.5 transition-all duration-150',
                    ativa
                      ? 'border-lime/45 bg-lime/[0.07]'
                      : 'border-transparent hover:border-line hover:bg-bg-soft/60',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => onSelecionar(v)}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    <span className="text-[12.5px] font-semibold text-text">{v.name.trim()}</span>
                    {v.isClone ? (
                      <span className="mono ml-1.5 rounded bg-amber/20 px-1 text-[9.5px] font-bold uppercase tracking-wider text-amber">
                        clone
                      </span>
                    ) : null}
                    <span className="ml-1.5 text-[11px] text-text-muted">{v.language || ''}</span>
                  </button>
                  {v.previewAudio ? (
                    <button
                      type="button"
                      onClick={() => ouvir(v)}
                      aria-label={`Ouvir ${v.name.trim()}`}
                      title="Ouvir"
                      className="shrink-0 rounded-full p-1.5 text-text-muted transition-all hover:scale-110 hover:text-text active:scale-95"
                    >
                      {tocando === v.id ? <IconOnda size={13} /> : <IconPlay size={11} />}
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── área de soltar arquivo ──────────────────────── */

/** Dropzone própria em vez do FileUpload da casa: aqui ela precisa mostrar
 *  miniatura, peso e um estado de "arrastando" com moldura viva. O `<input>`
 *  continua no DOM (escondido) — é ele que abre o seletor e o que automação e
 *  leitor de tela enxergam. */
function Solta({
  accept,
  titulo,
  dica,
  arquivo,
  onChange,
  icone,
}: {
  accept: string;
  titulo: string;
  dica: string;
  arquivo: File | null;
  onChange: (f: File | null) => void;
  icone: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [arrastando, setArrastando] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onChange(f);
      }}
      onClick={() => ref.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') ref.current?.click();
      }}
      className={[
        'group relative cursor-pointer overflow-hidden rounded-[14px] border border-dashed px-4 py-6 text-center transition-all duration-300',
        arrastando
          ? 'border-violet/70 bg-violet/10 scale-[1.01]'
          : arquivo
            ? 'border-lime/45 bg-lime/[0.05]'
            : 'border-line-strong bg-bg/40 hover:-translate-y-[2px] hover:border-violet/45 hover:bg-bg-soft/40',
      ].join(' ')}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <div className="pointer-events-none flex flex-col items-center gap-1.5">
        <span
          className={[
            'flex h-11 w-11 items-center justify-center rounded-[13px] border transition-transform duration-300 group-hover:scale-110',
            arquivo ? 'border-lime/45 bg-lime/12 text-lime' : 'border-line bg-bg-soft/70 text-text-muted',
          ].join(' ')}
        >
          {icone}
        </span>
        {arquivo ? (
          <>
            <span className="max-w-full truncate px-2 text-[13px] font-semibold text-text">
              {arquivo.name}
            </span>
            <span className="mono text-[10.5px] text-text-muted">
              {(arquivo.size / 1024).toFixed(0)} KB · clique pra trocar
            </span>
          </>
        ) : (
          <>
            <span className="text-[13px] font-semibold text-text">{titulo}</span>
            <span className="text-[11px] text-text-muted">{dica}</span>
          </>
        )}
      </div>
      {arquivo ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
          }}
          title="Remover"
          aria-label="Remover arquivo"
          className="absolute right-2 top-2 rounded-full border border-line bg-bg/80 p-1.5 text-text-muted transition-all hover:scale-110 hover:text-red-400 active:scale-95"
        >
          <IconLixo size={13} />
        </button>
      ) : null}
    </div>
  );
}

/* ────────────────────────── botão principal (3D) ────────────────────────── */

function BotaoGerar({
  onClick,
  desabilitado,
  rotulo,
}: {
  onClick: () => void;
  desabilitado: boolean;
  rotulo: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      className={[
        'group relative inline-flex items-center gap-2 overflow-hidden rounded-[14px] px-7 py-3',
        'text-[14px] font-bold text-white transition-all duration-300',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
        'enabled:hover:-translate-y-[2px] enabled:active:translate-y-0 enabled:active:scale-[0.98]',
      ].join(' ')}
      style={{
        background: 'linear-gradient(140deg,#a78bfa 0%,#6366f1 55%,#2563eb 100%)',
        boxShadow: desabilitado
          ? 'none'
          : 'inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -2px 0 rgba(0,0,0,0.22), 0 12px 30px -10px rgba(99,102,241,0.75)',
      }}
    >
      {/* brilho que atravessa no hover — o "3D" vem daqui + do inset acima */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-[130%] bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 ease-out group-enabled:group-hover:translate-x-[130%]"
      />
      <span className="relative flex items-center gap-2">
        <IconRaio />
        {rotulo}
      </span>
    </button>
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
          logHistory({ tool: 'Famous Hey', title: 'Geração falhou', kind: 'dispatch' });
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
            tool: 'Famous Hey',
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
    const nome = titulo.trim() || imagem.name.replace(/\.[a-z0-9]+$/i, '') || 'Famous Hey';

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
      logHistory({ tool: 'Famous Hey', title: `Disparou "${nome}"`, kind: 'dispatch' });
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
      title="Famous Hey"
      eyebrow="HEYGEN · MODO IMAGEM"
      description="Anima uma foto direto no HeyGen, sem cadastrar avatar na biblioteca. Um take, uma fala — sai o vídeo cru pra você levar pra edição."
      hue="rgba(251, 191, 36, 0.42)"
      icon={<IconFamousHey size={30} />}
    >
      {/* apiKeyOpcional: aqui o seletor de voz cai pro OAuth quando não há
          key, então cobrar a key seria pedir o que não desbloqueia nada. */}
      <HeyGenContaAviso apiKeyOpcional />

      <Etapa n="01" titulo="A imagem" aparte="JPEG, PNG ou WebP · até 4MB">
        <div className="grid gap-3 md:grid-cols-[1fr_150px]">
          <div className="space-y-2">
            <Solta
              accept="image/jpeg,image/png,image/webp"
              titulo="Solte a imagem aqui"
              dica="rosto de frente e bem iluminado funciona melhor"
              arquivo={imagem}
              icone={<IconFoto />}
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
              className="w-full rounded-[11px] border border-line bg-bg/60 px-3 py-2 text-[13px] text-text outline-none transition-colors placeholder:text-text-dim focus:border-violet/55"
            />
          </div>
          <div className="relative flex aspect-[9/16] items-center justify-center overflow-hidden rounded-[14px] border border-line bg-bg/50">
            {previewImg ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={previewImg} alt="Imagem escolhida" className="h-full w-full object-cover" />
            ) : (
              <span className="px-3 text-center text-[11px] leading-relaxed text-text-dim">
                a prévia
                <br />
                aparece aqui
              </span>
            )}
          </div>
        </div>
      </Etapa>

      <Etapa n="02" titulo="A fala">
        {/* Segmentado com pílula deslizante — o trilho mostra que são DOIS
            caminhos exclusivos, coisa que dois botões soltos não diziam. */}
        <div className="relative mb-3 inline-flex rounded-[12px] border border-line bg-bg/50 p-1">
          <span
            aria-hidden
            className="absolute inset-y-1 w-[calc(50%-4px)] rounded-[9px] transition-transform duration-300 ease-out"
            style={{
              background: 'linear-gradient(140deg,#a78bfa,#6366f1)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), 0 6px 16px -8px rgba(99,102,241,0.9)',
              transform: modo === 'texto' ? 'translateX(0)' : 'translateX(100%)',
            }}
          />
          {(
            [
              { id: 'texto' as ModoFala, label: 'Escrever o texto', icone: <IconTexto /> },
              { id: 'audio' as ModoFala, label: 'Usar um áudio', icone: <IconOnda /> },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setModo(m.id);
                setErro(null);
              }}
              aria-pressed={modo === m.id}
              className={[
                'relative z-10 flex w-[190px] items-center justify-center gap-1.5 rounded-[9px] px-3 py-1.5',
                'text-[12.5px] font-bold transition-colors duration-200',
                modo === m.id ? 'text-white' : 'text-text-muted hover:text-text',
              ].join(' ')}
            >
              {m.icone}
              {m.label}
            </button>
          ))}
        </div>

        {modo === 'texto' ? (
          <div className="space-y-3">
            <div className="relative">
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={4}
                placeholder="O que a pessoa da imagem vai falar…"
                className="w-full resize-y rounded-[12px] border border-line bg-bg/60 px-3 py-2.5 text-[13.5px] leading-relaxed text-text outline-none transition-colors placeholder:text-text-dim focus:border-violet/55"
              />
              <span className="mono pointer-events-none absolute bottom-2.5 right-3 text-[10.5px] text-text-dim">
                {script.trim().length}
              </span>
            </div>
            <SeletorDeVoz selecionada={voz} onSelecionar={setVoz} />
          </div>
        ) : (
          <div className="space-y-3">
            <Solta
              accept="audio/*"
              titulo="Solte o áudio da fala aqui"
              dica="MP3, WAV, M4A ou OGG · até 4MB"
              arquivo={audio}
              icone={<IconOnda size={20} />}
              onChange={(f) => {
                const grande = f ? grandeDemais(f, 'O áudio') : null;
                setErro(grande);
                setAudio(grande ? null : f);
                setTranscricao('');
              }}
            />

            <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line bg-bg/45 p-3 transition-colors hover:border-line-strong">
              <input
                type="checkbox"
                checked={espelharVoz}
                onChange={(e) => setEspelharVoz(e.target.checked)}
                className="mt-[3px] accent-violet"
              />
              <span className="text-[13px]">
                <span className="font-bold text-text">Espelhar voz</span>
                <span className="text-text-muted"> — trocar a voz do áudio por outra da conta.</span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-amber">
                  Como funciona de verdade: eu transcrevo o áudio, <b>você revisa o texto</b> e a
                  voz escolhida fala. As palavras são as mesmas; a cadência passa a ser a da voz
                  nova. O espelhamento speech-to-speech do HeyGen exige avatar cadastrado, e aqui
                  não existe avatar.
                </span>
              </span>
            </label>

            {espelharVoz ? (
              <div className="space-y-3 rounded-[12px] border border-amber/35 bg-amber/[0.06] p-3">
                <button
                  type="button"
                  onClick={transcrever}
                  disabled={!audio || transcrevendo}
                  className="chip-3d disabled:opacity-40"
                >
                  {transcrevendo ? 'transcrevendo…' : 'Transcrever o áudio'}
                </button>
                <textarea
                  value={transcricao}
                  onChange={(e) => setTranscricao(e.target.value)}
                  rows={4}
                  placeholder="A transcrição aparece aqui pra você revisar antes de gerar."
                  className="w-full resize-y rounded-[12px] border border-line bg-bg/60 px-3 py-2.5 text-[13.5px] leading-relaxed text-text outline-none transition-colors placeholder:text-text-dim focus:border-violet/55"
                />
                <p className="text-[11.5px] text-text-muted">
                  Confira nomes próprios e números — é este texto que vai ser falado, não o áudio.
                </p>
                <SeletorDeVoz selecionada={voz} onSelecionar={setVoz} />
              </div>
            ) : (
              <p className="text-[12px] text-text-muted">
                A voz do arquivo entra como está — a boca da imagem sincroniza com ela.
              </p>
            )}
          </div>
        )}
      </Etapa>

      <Etapa n="03" titulo="Ajustes">
        <div className="grid gap-4 sm:grid-cols-3">
          <Segmentos rotulo="Proporção" valor={aspectRatio} onChange={setAspectRatio} opcoes={PROPORCOES} />
          <Segmentos rotulo="Resolução" valor={resolution} onChange={setResolution} opcoes={RESOLUCOES} />
          <Segmentos
            rotulo="Expressividade"
            valor={expressiveness}
            onChange={setExpressiveness}
            opcoes={EXPRESSIVIDADES}
          />
        </div>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
            Movimento (opcional)
          </span>
          <input
            value={motionPrompt}
            onChange={(e) => setMotionPrompt(e.target.value)}
            placeholder="ex.: slight push-in, natural hand gestures, soft daylight"
            className="w-full rounded-[11px] border border-line bg-bg/60 px-3 py-2 text-[13px] text-text outline-none transition-colors placeholder:text-text-dim focus:border-violet/55"
          />
        </label>
      </Etapa>

      <div className="flex flex-wrap items-center gap-3">
        <BotaoGerar
          onClick={disparar}
          desabilitado={!!impedimento || disparando}
          rotulo={disparando ? fase || 'enviando…' : 'Gerar vídeo'}
        />
        {impedimento && !disparando ? (
          <span className="text-[12.5px] text-text-muted">{impedimento}</span>
        ) : null}
      </div>

      {erro ? (
        <p className="mt-3 rounded-[11px] border border-red-500/45 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">
          {erro}
        </p>
      ) : null}

      {emAndamento ? <CardProgresso job={emAndamento} /> : null}

      <section className="mt-8 border-t border-line pt-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-text">Histórico</h2>
          <span className="text-[11px] text-text-muted">
            fica neste navegador · os 30 mais recentes
          </span>
        </div>
        {jobs.length === 0 ? (
          <p className="text-[13px] text-text-muted">
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

/* ────────────────────────── cards ──────────────────────────────────────── */

function CardProgresso({ job }: { job: FamousHeyJob }) {
  const [, forcarRender] = useState(0);
  // O tempo decorrido é o único sinal honesto: o HeyGen não expõe porcentagem
  // no modo imagem, e uma barra que "enche" mentiria sobre o quanto falta.
  useEffect(() => {
    const t = setInterval(() => forcarRender((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="glass-panel relative mt-5 overflow-hidden rounded-[16px] border-amber/45">
      <div className="flex items-center gap-4 p-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[12px] border border-amber/40">
          {job.thumb ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={job.thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-bg-soft" />
          )}
          <span className="absolute inset-0 animate-pulse bg-amber/15" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber" />
            </span>
            <span className="truncate text-[14px] font-bold text-text">{job.titulo}</span>
          </div>
          <p className="mono mt-0.5 text-[12px] text-text-muted">
            gerando no HeyGen · {tempoDecorrido(job.criadoEm)}
          </p>
          <p className="mt-1 text-[11px] text-text-dim">
            Pode trocar de aba — o relógio do acompanhamento roda em Worker e não é estrangulado.
          </p>
        </div>
      </div>
      {/* Trilho indeterminado: anda sempre, sem fingir que sabe a porcentagem. */}
      <div className="relative h-[3px] w-full overflow-hidden bg-amber/15">
        <div className="absolute inset-y-0 w-1/3 animate-[fh-desliza_1.6s_ease-in-out_infinite] bg-amber" />
      </div>
      <style jsx>{`
        @keyframes fh-desliza {
          0% {
            left: -34%;
          }
          100% {
            left: 100%;
          }
        }
      `}</style>
    </div>
  );
}

/** Chip de metadado. Vira linha só de dados sem virar parágrafo. */
function Meta({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono rounded-[6px] border border-line bg-bg-soft/60 px-1.5 py-0.5 text-[10px] text-text-muted">
      {children}
    </span>
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
    if (previewUrl) {
      if (criadaAqui.current) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      return;
    }
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

  const borda =
    job.status === 'pronto'
      ? 'border-lime/40'
      : job.status === 'falhou'
        ? 'border-red-500/40'
        : 'border-amber/40';

  return (
    <div
      className={`glass-panel rounded-[14px] ${borda} p-3 transition-transform duration-300 hover:-translate-y-[2px]`}
    >
      <div className="flex items-start gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[10px] border border-line">
          {job.thumb ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={job.thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-bg-soft" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold text-text">{job.titulo}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Meta>{new Date(job.criadoEm).toLocaleString('pt-BR')}</Meta>
            <Meta>{job.aspectRatio}</Meta>
            <Meta>{job.resolution}</Meta>
            {job.duracao ? <Meta>{job.duracao.toFixed(1)}s</Meta> : null}
            {job.bytes ? <Meta>{(job.bytes / 1e6).toFixed(1)}MB</Meta> : null}
          </div>
          {job.voiceNome || job.audioNome ? (
            <div className="mt-1 truncate text-[11px] text-text-muted">
              {job.voiceNome ? `voz: ${job.voiceNome}` : `áudio: ${job.audioNome}`}
            </div>
          ) : null}
          {job.status === 'falhou' && job.erro ? (
            <p className="mt-1 text-[12px] text-red-400">{job.erro}</p>
          ) : null}
          {job.status === 'pronto' && !job.temVideo ? (
            <p className="mt-1 text-[11px] text-amber">
              Sem cópia local — o download depende da URL do HeyGen, que expira.
            </p>
          ) : null}
        </div>

        {/* Só ícone: o que cada botão faz aparece no title/aria-label. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {job.status === 'pronto' ? (
            <>
              <Btn3D
                icon={<IconBaixar size={15} />}
                color="lime"
                title="Baixar o vídeo"
                onClick={onBaixar}
              />
              <Btn3D
                icon={<IconPlay size={13} />}
                color="cyan"
                title={previewUrl ? 'Fechar a prévia' : 'Ver o vídeo'}
                onClick={() => void verPreview()}
                disabled={abrindo}
              />
            </>
          ) : null}
          <Btn3D
            icon={<IconRefazer size={14} />}
            color="fuchsia"
            title="Refazer — carrega esta ficha no formulário"
            onClick={onReabrir}
          />
          <Btn3D icon={<IconLixo size={14} />} color="neutral" title="Apagar" onClick={onApagar} />
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
