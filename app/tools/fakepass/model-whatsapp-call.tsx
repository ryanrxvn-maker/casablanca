'use client';

/**
 * FakePass — WhatsApp CHAMADA DE VÍDEO (tela cheia) com CHROMA KEY.
 *
 * Réplica da tela de chamada de vídeo 1:1 do WhatsApp (design atual):
 *  • o vídeo remoto preenche a TELA INTEIRA — aqui a "cena" é TELA VERDE
 *    (chroma key), imagem enviada ou cor sólida. Em tela verde NÃO desenhamos
 *    scrim/sombra nenhuma sobre o fundo: o verde sai CHAPADO, keying limpo;
 *  • topo: voltar (chevron), NOME + DURAÇÃO centralizados, trocar câmera à
 *    direita; selo opcional "Criptografia de ponta a ponta" (com cadeado);
 *  • base: pílula escura flutuante com alto-falante / câmera / mudo /
 *    DESLIGAR (vermelho #ea0038) — botão ativo fica BRANCO (ícone escuro),
 *    como no WhatsApp real (vídeo liga o viva-voz por padrão);
 *  • PiP (sua câmera) acima da pílula, canto direito — verde, imagem ou oculto.
 *
 * A duração tem data-fp-anim="calltimer": no EXPORT DE VÍDEO ela CONTA a cada
 * segundo (0:42 → 0:43 → …), motor em video-export.ts. Formato 9:19,5 (tela do
 * celular) ou 9:16 (encaixa direto em vídeo vertical 1080×1920).
 */

import {
  StatusBar,
  Field,
  TextField,
  Toggle,
  ImageUpload,
  Segmented,
  Swatches,
  FONT_STACK,
  type FakeModel,
  type StatusCfg,
  type StageDims,
} from './shared';
import { NEWS_GREEN } from './news-kit';

type S = {
  nome: string;
  duracao: string;
  bgMode: 'green' | 'image' | 'solid';
  green: string;
  bgImage: string;
  bgColor: string;
  pipMode: 'green' | 'image' | 'off';
  pipImage: string;
  formato: 'full' | '916';
  altoFalante: boolean;
  mudo: boolean;
  cripto: boolean;
};

const W = 320;

function dimsFor(s: S): StageDims {
  // 9:19,5 = proporção da tela do celular (chamada real); 9:16 = quadro de
  // vídeo vertical (1080×1920), pra sobrepor direto no editor.
  const ratio = s.formato === '916' ? 16 / 9 : 19.5 / 9;
  return { stageW: W, ratio, exportW: 1080 };
}

/* ─────────────────────────── Ícones ─────────────────────────── */

function ChevronBack({ color }: { color: string }) {
  return (
    <svg width="12" height="20" viewBox="0 0 12 20" fill="none" aria-hidden>
      <path d="M10 2L2 10l8 8" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Trocar câmera (frontal/traseira): câmera com setas circulares dentro. */
function FlipCamIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8.2A2.2 2.2 0 0 1 6.2 6h1.6l.9-1.5c.2-.35.6-.55 1-.55h4.6c.4 0 .8.2 1 .55l.9 1.5h1.6A2.2 2.2 0 0 1 20 8.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.8V8.2Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9.3 11.7a2.85 2.85 0 0 1 5-1.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14.7 13.1a2.85 2.85 0 0 1-5 1.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14.6 8.6v1.9h-1.9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 16.2v-1.9h1.9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpeakerIcon({ color }: { color: string }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3.5 9.6h2.9L11 6v12l-4.6-3.6H3.5a1 1 0 0 1-1-1V10.6a1 1 0 0 1 1-1Z" fill={color} />
      <path d="M14.3 9.2a4.2 4.2 0 0 1 0 5.6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16.9 6.9a7.5 7.5 0 0 1 0 10.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function VideoCamIcon({ color }: { color: string }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h6A2.5 2.5 0 0 1 15 6.5v11A2.5 2.5 0 0 1 12.5 20h-6A2.5 2.5 0 0 1 4 17.5v-11Zm13 3.1 3.4-2.3c.5-.35 1.2 0 1.2.62v10.16c0 .62-.7.97-1.2.62L17 16.4V9.6Z" />
    </svg>
  );
}

function MicCallIcon({ color, slashed }: { color: string; slashed: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={color} aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6" stroke={color} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      {slashed ? <path d="M4.5 3.5 19.5 20" stroke={color} strokeWidth="2" strokeLinecap="round" /> : null}
    </svg>
  );
}

/** Desligar: fone na horizontal (call end clássico). */
function EndCallIcon({ color }: { color: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill={color} aria-hidden>
      <path d="M12 9.3c-3.4 0-6.6.9-9.2 2.4-.5.3-.8.85-.8 1.45v2.1c0 .8.7 1.4 1.5 1.28l3.7-.56c.6-.1 1.05-.58 1.1-1.18l.14-1.5c1.1-.34 2.3-.52 3.56-.52s2.46.18 3.56.52l.14 1.5c.05.6.5 1.08 1.1 1.18l3.7.56c.8.12 1.5-.48 1.5-1.28v-2.1c0-.6-.3-1.15-.8-1.45C18.6 10.2 15.4 9.3 12 9.3Z" />
    </svg>
  );
}

function LockIcon({ color }: { color: string }) {
  return (
    <svg width="10" height="11" viewBox="0 0 24 26" fill="none" aria-hidden>
      <rect x="4" y="11" width="16" height="12" rx="3" fill={color} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={color} strokeWidth="2.4" fill="none" />
    </svg>
  );
}

/** Câmera "desligada" (placeholder do PiP sem imagem). */
function PipPlaceholderIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden style={{ opacity: 0.55 }}>
      <path
        d="M4 8.2A2.2 2.2 0 0 1 6.2 6h1.6l.9-1.5c.2-.35.6-.55 1-.55h4.6c.4 0 .8.2 1 .55l.9 1.5h1.6A2.2 2.2 0 0 1 20 8.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.8V8.2Z"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.4" r="3.2" stroke="#ffffff" strokeWidth="1.6" />
    </svg>
  );
}

/* ─────────────────────────── Botão redondo da pílula ─────────────────────────── */

function RoundBtn({
  bg,
  children,
}: {
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: 46,
        height: 46,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────── Tela ─────────────────────────── */

function Screen({ s, status }: { s: S; status: StatusCfg }) {
  const { ratio } = dimsFor(s);
  const H = Math.round(W * ratio);
  const green = s.bgMode === 'green';

  // Fundo da "cena" (o vídeo remoto): verde chapado, cor, ou imagem cover.
  const sceneFill = s.bgMode === 'solid' ? s.bgColor : green ? s.green : '#101d25';

  // Em CHROMA (verde) nada de sombra/scrim sobre o fundo — o verde precisa
  // sair uniforme pro keying. Com imagem/cor, scrims e text-shadow entram
  // (igual ao overlay real do WhatsApp sobre o vídeo).
  const txShadow = green ? 'none' : '0 1px 3px rgba(0,0,0,0.45)';
  // A pílula real é translúcida sobre o vídeo; sobre o verde usamos a cor
  // OPACA equivalente (não deixa o verde vazar por baixo da UI).
  const barBg = green ? '#15212b' : 'rgba(17,27,33,0.65)';
  const btnBg = green ? '#2b3942' : 'rgba(255,255,255,0.14)';

  return (
    <div
      style={{
        width: W,
        height: H,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: FONT_STACK,
        WebkitFontSmoothing: 'antialiased',
        background: sceneFill,
      }}
    >
      {/* CENA: imagem enviada (cover) — atrás de tudo */}
      {s.bgMode === 'image' && s.bgImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={s.bgImage}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : null}

      {/* SCRIMS de legibilidade (só fora do modo chroma) */}
      {!green ? (
        <>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: Math.round(H * 0.2),
              background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: Math.round(H * 0.22),
              background: 'linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)',
            }}
          />
        </>
      ) : null}

      {/* CONTEÚDO (UI da chamada) */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <StatusBar cfg={status} tone="light" />

        {/* TOPO: voltar | nome + duração centralizados | trocar câmera */}
        <div style={{ position: 'relative', flexShrink: 0, padding: '6px 48px 0', textAlign: 'center' }}>
          <div style={{ position: 'absolute', left: 14, top: 12 }}>
            <ChevronBack color="#ffffff" />
          </div>
          <div style={{ position: 'absolute', right: 12, top: 10 }}>
            <FlipCamIcon color="#ffffff" />
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: '#ffffff',
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textShadow: txShadow,
            }}
          >
            {s.nome}
          </div>
          <div
            data-fp-anim="calltimer"
            style={{
              marginTop: 3,
              fontSize: 13.5,
              color: 'rgba(255,255,255,0.92)',
              lineHeight: 1.3,
              fontVariantNumeric: 'tabular-nums',
              textShadow: txShadow,
            }}
          >
            {s.duracao}
          </div>
          {s.cripto ? (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <LockIcon color="rgba(255,255,255,0.85)" />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.2, textShadow: txShadow }}>
                Criptografia de ponta a ponta
              </span>
            </div>
          ) : null}
        </div>

        <div style={{ flex: 1 }} />

        {/* PÍLULA de controles: alto-falante / câmera / mudo / desligar */}
        <div
          style={{
            margin: '0 10px 10px',
            height: 62,
            borderRadius: 31,
            background: barBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            flexShrink: 0,
          }}
        >
          <RoundBtn bg={s.altoFalante ? '#ffffff' : btnBg}>
            <SpeakerIcon color={s.altoFalante ? '#0b141a' : '#ffffff'} />
          </RoundBtn>
          <RoundBtn bg={btnBg}>
            <VideoCamIcon color="#ffffff" />
          </RoundBtn>
          <RoundBtn bg={s.mudo ? '#ffffff' : btnBg}>
            <MicCallIcon color={s.mudo ? '#0b141a' : '#ffffff'} slashed={s.mudo} />
          </RoundBtn>
          <RoundBtn bg="#ea0038">
            <EndCallIcon color="#ffffff" />
          </RoundBtn>
        </div>
      </div>

      {/* PiP — sua câmera, acima da pílula */}
      {s.pipMode !== 'off' ? (
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 84,
            width: 94,
            height: 132,
            borderRadius: 14,
            overflow: 'hidden',
            zIndex: 3,
            background: s.pipMode === 'green' ? s.green : '#1f2c34',
            boxShadow: green ? 'none' : '0 6px 18px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {s.pipMode === 'image' ? (
            s.pipImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.pipImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <PipPlaceholderIcon />
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── Modelo ─────────────────────────── */

const MODEL: FakeModel<S> = {
  id: 'whatsapp-call',
  label: 'Chamada de vídeo',
  category: 'chat',
  group: 'WhatsApp',
  hue: 'rgba(37,211,102,0.4)',
  stageW: W,
  ratio: 19.5 / 9,
  exportW: 1080,
  usesPhone: true,
  anim: true,
  vidHint:
    'O vídeo sai com a duração da chamada CONTANDO em tempo real — com o fundo em tela verde, é só sobrepor a pessoa no editor.',
  dims: dimsFor,
  defaultState: {
    nome: 'Ana',
    duracao: '0:42',
    bgMode: 'green',
    green: NEWS_GREEN,
    bgImage: '',
    bgColor: '#101d25',
    pipMode: 'green',
    pipImage: '',
    formato: 'full',
    altoFalante: true,
    mudo: false,
    cripto: false,
  },
  Controls: ({ s, set }) => (
    <div className="flex flex-col gap-4">
      <Field label="Nome do contato">
        <TextField value={s.nome} onChange={(v) => set({ nome: v })} placeholder="Nome" maxLength={40} />
      </Field>
      <Field label="Duração da chamada" hint="No vídeo exportado ela CONTA sozinha (0:42 → 0:43…). Pode ser texto: Chamando…">
        <TextField value={s.duracao} onChange={(v) => set({ duracao: v })} placeholder="0:42" maxLength={16} />
      </Field>
      <Field label="Fundo (a pessoa da chamada)" hint="Tela verde = chroma key: o verde sai CHAPADO, sem sombras.">
        <Segmented
          value={s.bgMode}
          options={[
            { value: 'green', label: 'Tela verde' },
            { value: 'image', label: 'Imagem' },
            { value: 'solid', label: 'Cor' },
          ]}
          onChange={(v) => set({ bgMode: v })}
        />
      </Field>
      {s.bgMode === 'green' ? (
        <Field label="Tom do verde" hint="Padrão de chroma key broadcast.">
          <Swatches value={s.green} colors={[NEWS_GREEN, '#00ff00', '#009e3a', '#3cb043']} onChange={(v) => set({ green: v })} />
        </Field>
      ) : null}
      {s.bgMode === 'image' ? (
        <Field label="Imagem do fundo">
          <ImageUpload value={s.bgImage} onChange={(v) => set({ bgImage: v })} label="imagem" />
        </Field>
      ) : null}
      {s.bgMode === 'solid' ? (
        <Field label="Cor do fundo">
          <Swatches value={s.bgColor} colors={['#101d25', '#111827', '#1a1a1a', '#0a3d62', '#202c33']} onChange={(v) => set({ bgColor: v })} />
        </Field>
      ) : null}
      <Field label="Sua câmera (janelinha)" hint="Verde = chroma; imagem = sua selfie; ou oculta.">
        <Segmented
          value={s.pipMode}
          options={[
            { value: 'green', label: 'Tela verde' },
            { value: 'image', label: 'Imagem' },
            { value: 'off', label: 'Oculta' },
          ]}
          onChange={(v) => set({ pipMode: v })}
        />
      </Field>
      {s.pipMode === 'image' ? (
        <Field label="Imagem da janelinha">
          <ImageUpload value={s.pipImage} onChange={(v) => set({ pipImage: v })} label="selfie" />
        </Field>
      ) : null}
      <Field label="Formato" hint="9:16 encaixa direto em vídeo vertical 1080×1920.">
        <Segmented
          value={s.formato}
          options={[
            { value: 'full', label: 'Celular (9:19,5)' },
            { value: '916', label: '9:16' },
          ]}
          onChange={(v) => set({ formato: v })}
        />
      </Field>
      <Toggle on={s.altoFalante} onChange={(v) => set({ altoFalante: v })} label="Alto-falante ativo" />
      <Toggle on={s.mudo} onChange={(v) => set({ mudo: v })} label="Microfone mudo" />
      <Toggle on={s.cripto} onChange={(v) => set({ cripto: v })} label='Selo "Criptografia de ponta a ponta"' />
    </div>
  ),
  Preview: ({ s, status }) => <Screen s={s} status={status} />,
};

export default [MODEL];
