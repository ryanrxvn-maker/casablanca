'use client';

/**
 * JANELA DOS INSERTS do ClickUp Pilot (31.08).
 *
 * O editor lê a COPY — a mesma que foi disparada, já dividida em HOOK e BODYs —
 * e põe o b-roll onde quiser: clicando na PALAVRA em que ele entra. Isso é o
 * coração da tela: mapear por texto, não por timeline.
 *
 * O que cada parte resolve:
 *   • lista de partes à esquerda, com o texto clicável palavra a palavra;
 *   • card do insert com PREVIEW REAL da mídia (thumb do vídeo/imagem);
 *   • escolha de layout com MAQUETE desenhada (não texto): tela cheia, faixas
 *     e cards, com o avatar em cima ou embaixo;
 *   • o foco do rosto do avatar num slider com prévia — é o que impede o split
 *     de decapitar o avatar.
 *
 * Vive em portal (o card do Pilot tem transform 3D) e o CSS mora em
 * globals.css (`.pi-*`) — styled-jsx não atravessa portal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import {
  insertPadrao,
  palcoDoLayout,
  coverComFoco,
  planoDeVelocidade,
  normalizarInsert,
  recorteDaMidia,
  INSERT_FOCO_PADRAO,
  INSERT_RECORTE_MIN_SEC,
  INSERT_VOLUME_PADRAO,
  type Insert,
  type LayoutInsert,
  type TipoTransicao,
} from '@/lib/pilot-inserts';

/* ═══════════════════ RECORTE: que pedaço do arquivo entra ═══════════════
 *
 * Silas, 02.09: *"se eu tiver um vídeo longo de sei lá 3 min e tem um insert
 * lá no meio do vídeo, tem que ter como eu selecionar qual parte do vídeo vai
 * virar insert"*.
 *
 * A interação é a do estúdio: arrasta a agulha pra ver o quadro, arrasta as
 * pontas pra marcar. Os botões "início/fim aqui" existem porque mira de 1
 * pixel numa barra de 300px é 0,6s num arquivo de 3min — a agulha dá a
 * precisão que a ponta não dá.
 */

function mmss(s: number): string {
  if (!(s >= 0) || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function RecortadorDeMidia({
  url,
  recorteDe,
  recorteAte,
  onMudar,
}: {
  url: string | null;
  recorteDe?: number;
  recorteAte?: number;
  onMudar: (de: number, ate: number) => void;
}) {
  const vid = useRef<HTMLVideoElement | null>(null);
  const barra = useRef<HTMLDivElement | null>(null);
  const trilho = useRef<HTMLDivElement | null>(null);
  const [dur, setDur] = useState(0);
  const [agulha, setAgulha] = useState(0);
  const [pegando, setPegando] = useState<'de' | 'ate' | 'agulha' | null>(null);
  const [pegandoPlayer, setPegandoPlayer] = useState(false);
  /** tocando = a SELEÇÃO em loop; assistindo = play LIVRE (player) */
  const [tocando, setTocando] = useState(false);
  const [assistindo, setAssistindo] = useState(false);

  /* SEEK SEM FILA (03.09): setar currentTime a cada pointermove enfileira
   * seeks que o Chrome resolve em série — o preview ficava SEGUNDOS atrás da
   * ponta ("muito delay"). Aqui um seek só entra quando o anterior terminou;
   * no meio do arrasto os alvos velhos são DESCARTADOS e só o último vale —
   * é o que dá o sincronismo de CapCut. */
  const seekando = useRef(false);
  const seekPendente = useRef<number | null>(null);

  /* FILMSTRIP (03.09): seek em H.264 re-decodifica desde o keyframe — nunca
   * acompanha a mão. O truque do estúdio: extrair MINIATURAS do arquivo
   * inteiro assim que ele abre (num <video> clone, sem roubar o preview) e,
   * durante o arrasto, pintar a miniatura mais próxima num canvas POR CIMA do
   * vídeo — resposta de 0ms. O seek real continua por baixo e assume o quadro
   * exato quando chega. */
  const tirasRef = useRef<{ bitmaps: (ImageBitmap | null)[]; passo: number; prontas: number }>({ bitmaps: [], passo: 0, prontas: 0 });
  const scrubRef = useRef<HTMLCanvasElement | null>(null);
  const [esfregando, setEsfregando] = useState(false);
  /* ⚠ A extração do filmstrip DISPUTA o decodificador com o preview: 120 seeks
   * num 1080p travam a reprodução ("parece frame a frame" — Silas, 03.09, e
   * ele achou que a importação tinha danificado o arquivo; não tinha, o
   * arquivo é salvo byte a byte). Enquanto o vídeo TOCA a extração dorme; ela
   * retoma sozinha na pausa. */
  const tocandoRef = useRef(false);
  /* ⚠ A agulha NÃO passa pelo React durante o play (03.09): `setAgulha` a cada
   * quadro re-renderizava a janela INTEIRA 60x/s — com centenas de palavras da
   * copy na tela, isso engasga a reprodução e faz o preview parecer "frame a
   * frame". Durante o play os elementos são movidos direto pelo DOM; o estado
   * só é sincronizado ao pausar. */
  const agulhaBarraRef = useRef<HTMLSpanElement | null>(null);
  const agulhaPlayerRef = useRef<HTMLSpanElement | null>(null);
  const feitoPlayerRef = useRef<HTMLSpanElement | null>(null);
  const tempoPlayerRef = useRef<HTMLSpanElement | null>(null);
  const durRef = useRef(0);
  const pintarAgulha = useCallback((t: number) => {
    const d = durRef.current;
    if (!(d > 0)) return;
    const pctS = `${(t / d) * 100}%`;
    if (agulhaBarraRef.current) agulhaBarraRef.current.style.left = pctS;
    if (agulhaPlayerRef.current) agulhaPlayerRef.current.style.left = pctS;
    if (feitoPlayerRef.current) feitoPlayerRef.current.style.width = pctS;
    if (tempoPlayerRef.current) tempoPlayerRef.current.textContent = `${mmss(t)} / ${mmss(d)}`;
  }, []);

  useEffect(() => {
    if (!url) return;
    let vivo = true;
    const clone = document.createElement('video');
    clone.muted = true;
    clone.preload = 'auto';
    clone.playsInline = true;
    (async () => {
      const abriu = await new Promise<boolean>((res) => {
        const tm = setTimeout(() => res(false), 12_000);
        clone.onloadeddata = () => { clearTimeout(tm); res(true); };
        clone.onerror = () => { clearTimeout(tm); res(false); };
        clone.src = url;
      });
      if (!vivo || !abriu) return;
      const total = clone.duration;
      if (!(total > 0) || !isFinite(total)) return;
      // ~4 quadros/s de granularidade, teto de 120 (3min+ = 1 a cada 1,5s —
      // o seek real refina depois; memória ~25MB no pior caso, fechada no unmount)
      const n = Math.min(120, Math.max(36, Math.round(total * 4)));
      const passo = total / n;
      tirasRef.current = { bitmaps: new Array(n).fill(null), passo, prontas: 0 };
      for (let i = 0; i < n; i++) {
        if (!vivo) return;
        // dá passagem ao preview: enquanto ele toca, a extração espera
        while (vivo && tocandoRef.current) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (!vivo) return;
        const alvo = Math.min(total - 0.05, i * passo + passo / 2);
        const ok = await new Promise<boolean>((res) => {
          const tm = setTimeout(() => res(false), 900);
          const fim = () => { clearTimeout(tm); clone.removeEventListener('seeked', fim); res(true); };
          clone.addEventListener('seeked', fim);
          clone.currentTime = alvo;
        });
        if (!vivo) return;
        if (ok) {
          try {
            const alturaMax = 240;
            const escala = Math.min(1, alturaMax / (clone.videoHeight || alturaMax));
            tirasRef.current.bitmaps[i] = await createImageBitmap(clone, {
              resizeWidth: Math.max(2, Math.round((clone.videoWidth || 2) * escala)),
              resizeHeight: Math.max(2, Math.round((clone.videoHeight || 2) * escala)),
            });
            tirasRef.current.prontas++;
          } catch { /* frame indisponível: o vizinho cobre */ }
        }
        // respiro: a extração é trabalho de FUNDO, nunca dona da thread
        await new Promise((r) => setTimeout(r, 16));
      }
    })();
    return () => {
      vivo = false;
      try { clone.removeAttribute('src'); clone.load(); } catch { /* solta o decoder */ }
      for (const b of tirasRef.current.bitmaps) b?.close();
      tirasRef.current = { bitmaps: [], passo: 0, prontas: 0 };
    };
  }, [url]);

  /** Pinta a miniatura mais próxima de `t` no canvas de scrub — 0ms. */
  const mostrarScrub = useCallback((t: number) => {
    const { bitmaps, passo } = tirasRef.current;
    const c = scrubRef.current;
    if (!c || !passo || bitmaps.length === 0) return false;
    let idx = Math.min(bitmaps.length - 1, Math.max(0, Math.round(t / passo - 0.5)));
    // sem a miniatura exata ainda? usa a vizinha mais próxima já extraída
    if (!bitmaps[idx]) {
      let d = 1;
      while (d < bitmaps.length && !bitmaps[idx - d] && !bitmaps[idx + d]) d++;
      idx = bitmaps[idx - d] ? idx - d : idx + d;
    }
    const bm = bitmaps[idx];
    if (!bm) return false;
    const caixa = c.parentElement?.getBoundingClientRect();
    if (!caixa || caixa.width < 4) return false;
    if (c.width !== Math.round(caixa.width)) {
      c.width = Math.round(caixa.width);
      c.height = Math.round(caixa.height);
    }
    const g = c.getContext('2d');
    if (!g) return false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    const esc = Math.min(c.width / bm.width, c.height / bm.height);
    const w = bm.width * esc;
    const h = bm.height * esc;
    g.drawImage(bm, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return true;
  }, []);
  const seekSuave = useCallback((t: number) => {
    const v = vid.current;
    if (!v) return;
    if (seekando.current) {
      seekPendente.current = t;
      return;
    }
    seekando.current = true;
    let ok = false;
    const fim = () => {
      if (ok) return;
      ok = true;
      v.removeEventListener('seeked', fim);
      clearTimeout(tm);
      seekando.current = false;
      if (seekPendente.current != null) {
        const prox = seekPendente.current;
        seekPendente.current = null;
        seekSuave(prox);
      }
    };
    const tm = setTimeout(fim, 600); // seek que engasgar não trava o arrasto
    v.addEventListener('seeked', fim);
    v.currentTime = t;
  }, []);

  const de = Math.max(0, Number(recorteDe) || 0);
  const ate = Number.isFinite(recorteAte as number) && (recorteAte as number) > de ? (recorteAte as number) : dur;

  // A agulha começa no início do recorte — o 1º quadro do insert é o que
  // interessa ver.
  useEffect(() => {
    if (dur > 0) setAgulha(de);
  }, [dur, de]);

  // Toca SÓ a seleção, em loop: é assim que se confere um recorte.
  // o ref é o que a extração do filmstrip consulta (ela não re-renderiza)
  useEffect(() => {
    tocandoRef.current = tocando || assistindo;
  }, [tocando, assistindo]);
  useEffect(() => {
    durRef.current = dur;
  }, [dur]);

  useEffect(() => {
    const v = vid.current;
    if (!v || !tocando) return;
    let vivo = true;
    setAssistindo(false); // um play de cada vez
    // O rAF aqui é SÓ pra agulha correr lisa. O loop de verdade mora no
    // `onTimeUpdate` do <video>: requestAnimationFrame congela com o painel
    // oculto e o vídeo estourava a seleção e tocava até o fim do arquivo.
    const tick = () => {
      if (!vivo || !vid.current) return;
      pintarAgulha(vid.current.currentTime); // DOM direto — sem re-render
      requestAnimationFrame(tick);
    };
    // agulha parada no fim (acabou de marcar o "até")? parte do começo — dar
    // play e ver 0,05s antes do loop não conta como conferir a seleção.
    const partida = agulha >= ate - 0.15 ? de : Math.max(de, Math.min(agulha, ate - 0.05));
    v.currentTime = partida;
    void v.play().catch(() => setTocando(false));
    const raf = requestAnimationFrame(tick);
    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      v.pause();
      setAgulha(v.currentTime); // sincroniza o estado UMA vez, ao parar
    };
    // `agulha` de propósito fora: ela muda a cada quadro e reiniciaria o play
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tocando, de, ate]);

  // PLAY LIVRE (o player): toca de onde a agulha está até o FIM DO ARQUIVO —
  // é como se assiste "exatamente tal parte" sem cortar nada.
  useEffect(() => {
    const v = vid.current;
    if (!v || !assistindo) return;
    setTocando(false);
    let vivo = true;
    const tick = () => {
      if (!vivo || !vid.current) return;
      pintarAgulha(vid.current.currentTime); // DOM direto — sem re-render
      requestAnimationFrame(tick);
    };
    void v.play().catch(() => setAssistindo(false));
    const raf = requestAnimationFrame(tick);
    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      v.pause();
      setAgulha(v.currentTime);
    };
  }, [assistindo, pintarAgulha]);

  const fracao = useCallback((e: { clientX: number }) => {
    const el = barra.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }, []);

  const mover = useCallback(
    (e: { clientX: number }, alvo: 'de' | 'ate' | 'agulha') => {
      if (!(dur > 0)) return;
      setTocando(false); // scrub manda: arrastar qualquer coisa pausa o play
      setAssistindo(false);
      const t = fracao(e) * dur;
      if (alvo === 'agulha') {
        const preso = Math.min(Math.max(t, 0), dur);
        setAgulha(preso);
        setEsfregando(mostrarScrub(preso)); // miniatura: 0ms
        seekSuave(preso);                   // quadro exato: assume quando chega
        return;
      }
      // Arrastando uma PONTA, o vídeo mostra o quadro dela AO VIVO: na
      // esquerda se vê exatamente onde começa, na direita onde termina.
      const seek = (alvoT: number) => {
        setAgulha(alvoT);
        setEsfregando(mostrarScrub(alvoT));
        seekSuave(alvoT);
      };
      if (alvo === 'de') {
        const novoDe = Math.min(t, ate - INSERT_RECORTE_MIN_SEC);
        seek(novoDe);
        onMudar(novoDe, ate);
      } else {
        const novoAte = Math.max(t, de + INSERT_RECORTE_MIN_SEC);
        seek(novoAte);
        onMudar(de, novoAte);
      }
    },
    [dur, de, ate, fracao, onMudar, seekSuave, mostrarScrub],
  );

  if (!url) {
    return <div className="pi-recorte-vazio">Abrindo o arquivo…</div>;
  }

  const pct = (t: number) => `${dur > 0 ? (t / dur) * 100 : 0}%`;
  const selDur = Math.max(0, ate - de);

  return (
    <div className="pi-recorte">
      {/* CLICAR NO VÍDEO dá play/pausa na SELEÇÃO (03.09) — como no CapCut.
        * O overlay de ▶ some enquanto toca; o pill "tocar seleção" continua
        * embaixo pra quem procura por texto. */}
      <div
        className="pi-recorte-palco"
        onClick={() => {
          if (!(dur > 0)) return;
          if (assistindo) {
            setAssistindo(false);
            return;
          }
          setTocando((x) => !x);
        }}
        title={tocando || assistindo ? 'Pausar' : 'Tocar a seleção (em loop)'}
      >
      <video
        ref={vid}
        src={url}
        className="pi-recorte-video"
        muted
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => {
          // prende o play DENTRO da seleção — dispara mesmo em aba oculta
          if (!tocando) return;
          const el = e.target as HTMLVideoElement;
          if (el.currentTime >= ate - 0.05 || el.ended) {
            el.currentTime = de;
            if (el.paused) void el.play().catch(() => setTocando(false));
          }
        }}
        onEnded={(e) => {
          if (assistindo) {
            setAssistindo(false);
            return;
          }
          if (!tocando) return;
          const el = e.target as HTMLVideoElement;
          el.currentTime = de;
          void el.play().catch(() => setTocando(false));
        }}
        onLoadedMetadata={(e) => {
          const d = (e.target as HTMLVideoElement).duration;
          if (isFinite(d) && d > 0) {
            setDur(d);
            (e.target as HTMLVideoElement).currentTime = Math.max(0, Number(recorteDe) || 0);
          }
        }}
      />
      <canvas ref={scrubRef} className={'pi-recorte-scrub' + (esfregando ? ' is-on' : '')} aria-hidden />
      {!tocando && !assistindo ? (
        <span className="pi-recorte-play" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.5v13l11-6.5-11-6.5z" />
          </svg>
        </span>
      ) : (
        <span className="pi-recorte-pausa" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
          </svg>
        </span>
      )}
      </div>

      {/* PLAYER (03.09): assistir QUALQUER parte do arquivo sem mexer no
        * corte. O trilho mostra o arquivo inteiro com a SELEÇÃO acesa; clicar
        * ou arrastar leva a agulha (seek sem fila) e o ▶ toca dali até o fim. */}
      <div className="pi-player">
        <button
          type="button"
          className={'pi-player-btn' + (assistindo || tocando ? ' is-on' : '')}
          onClick={() => {
            if (!(dur > 0)) return;
            if (assistindo || tocando) {
              setAssistindo(false);
              setTocando(false);
            } else {
              setAssistindo(true);
            }
          }}
          title={assistindo || tocando ? 'Pausar' : 'Assistir daqui (play livre — não corta nada)'}
          aria-label="Play/Pausa"
        >
          {assistindo || tocando ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
          )}
        </button>
        <div
          ref={trilho}
          className="pi-player-trilho"
          onPointerDown={(e) => {
            if (!(dur > 0)) return;
            try {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            } catch { /* segue pelos moves */ }
            setPegandoPlayer(true);
            setTocando(false);
            setAssistindo(false);
            const r = trilho.current!.getBoundingClientRect();
            const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur;
            setAgulha(t);
            setEsfregando(mostrarScrub(t));
            seekSuave(t);
          }}
          onPointerMove={(e) => {
            if (!pegandoPlayer || !(dur > 0)) return;
            const r = trilho.current!.getBoundingClientRect();
            const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur;
            setAgulha(t);
            setEsfregando(mostrarScrub(t));
            seekSuave(t);
          }}
          onPointerUp={() => { setPegandoPlayer(false); setEsfregando(false); }}
          onPointerCancel={() => { setPegandoPlayer(false); setEsfregando(false); }}
          title="Clica ou arrasta pra ir pra qualquer ponto do arquivo"
        >
          <span className="pi-player-sel" style={{ left: pct(de), width: pct(selDur) }} aria-hidden />
          <span ref={feitoPlayerRef} className="pi-player-feito" style={{ width: pct(agulha) }} aria-hidden />
          <span ref={agulhaPlayerRef} className="pi-player-agulha" style={{ left: pct(agulha) }} aria-hidden />
        </div>
        <span ref={tempoPlayerRef} className="pi-player-tempo mono">{mmss(agulha)} / {mmss(dur)}</span>
      </div>

      <div
        ref={barra}
        className="pi-recorte-barra"
        onPointerDown={(e) => {
          if (!(dur > 0)) return;
          try {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          } catch {
            /* ponteiro já solto: o arrasto segue pelos onPointerMove mesmo */
          }
          const t = fracao(e) * dur;
          // pega a ponta mais próxima quando o clique cai perto dela; senão é
          // a agulha (ver o quadro é a ação mais comum)
          const perto = dur * 0.04;
          const alvo: 'de' | 'ate' | 'agulha' =
            Math.abs(t - de) < perto ? 'de' : Math.abs(t - ate) < perto ? 'ate' : 'agulha';
          setPegando(alvo);
          mover(e, alvo);
        }}
        onPointerMove={(e) => {
          if (pegando) mover(e, pegando);
        }}
        onPointerUp={() => { setPegando(null); setEsfregando(false); }}
        onPointerCancel={() => { setPegando(null); setEsfregando(false); }}
      >
        <span className="pi-recorte-fora" style={{ left: 0, width: pct(de) }} aria-hidden />
        <span className="pi-recorte-fora" style={{ left: pct(ate), right: 0 }} aria-hidden />
        <span className="pi-recorte-sel" style={{ left: pct(de), width: pct(selDur) }} aria-hidden />
        <span className="pi-recorte-ponta is-de" style={{ left: pct(de) }} aria-hidden />
        <span className="pi-recorte-ponta is-ate" style={{ left: pct(ate) }} aria-hidden />
        <span ref={agulhaBarraRef} className="pi-recorte-agulha" style={{ left: pct(agulha) }} aria-hidden />
      </div>

      <div className="pi-recorte-linha">
        <button
          type="button"
          className="pi-mini"
          onClick={() => setTocando((v) => !v)}
          title="Toca só o pedaço marcado, em loop"
        >
          {tocando ? '❚❚ parar' : '▶ tocar seleção'}
        </button>
        <button
          type="button"
          className="pi-mini"
          onClick={() => {
            // ⚠ A AGULHA DE ESTADO FICA PARADA DURANTE O PLAY (04.09): ela é
            // pintada direto no DOM pra não re-renderizar 60x/s. Quem lê
            // `agulha` aqui marca o corte onde o play COMEÇOU, não onde o
            // editor parou de assistir. O tempo verdadeiro está no <video>.
            const t = vid.current?.currentTime ?? agulha;
            onMudar(Math.min(t, ate - INSERT_RECORTE_MIN_SEC), ate);
          }}
          title="O insert começa no quadro que está na tela"
        >
          início aqui
        </button>
        <button
          type="button"
          className="pi-mini"
          onClick={() => {
            const t = vid.current?.currentTime ?? agulha; // ver a nota do "início aqui"
            onMudar(de, Math.max(t, de + INSERT_RECORTE_MIN_SEC));
          }}
          title="O insert termina no quadro que está na tela"
        >
          fim aqui
        </button>
        <span className="pi-recorte-tempo">
          {mmss(de)} → {mmss(ate)} · <b>{selDur.toFixed(1)}s</b>
        </span>
        {de > 0.01 || ate < dur - 0.01 ? (
          <button type="button" className="pi-mini" onClick={() => onMudar(0, dur)} title="Volta pro arquivo inteiro">
            usar tudo
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ═════════════════════ maquete de um layout (SVG) ═══════════════════════ */

/** Desenho do palco — é o que substitui a explicação por texto. */
function Maquete({ layout, ativo }: { layout: LayoutInsert; ativo: boolean }) {
  const W = 54;
  const H = 96;
  const p = palcoDoLayout(layout, W, H);
  const r = layout.tipo === 'cards' ? 4 : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={'pi-maquete' + (ativo ? ' is-on' : '')} aria-hidden>
      <rect x="0" y="0" width={W} height={H} rx="5" className="pi-mq-fundo" />
      {p.avatar ? (
        <>
          <rect x={p.avatar.x} y={p.avatar.y} width={p.avatar.w} height={p.avatar.h} rx={r} className="pi-mq-avatar" />
          {/* cabecinha: deixa claro QUAL metade é o avatar */}
          <circle cx={p.avatar.x + p.avatar.w / 2} cy={p.avatar.y + p.avatar.h * 0.36} r="5.5" className="pi-mq-cabeca" />
          <path
            d={`M${p.avatar.x + p.avatar.w / 2 - 9} ${p.avatar.y + p.avatar.h * 0.95}
                a9 9 0 0 1 18 0 z`}
            className="pi-mq-cabeca"
          />
        </>
      ) : null}
      <rect x={p.insert.x} y={p.insert.y} width={p.insert.w} height={p.insert.h} rx={r} className="pi-mq-insert" />
      {/* iconezinho de play no lado do insert */}
      <path
        d={`M${p.insert.x + p.insert.w / 2 - 4} ${p.insert.y + p.insert.h / 2 - 5}
            l9 5 l-9 5 z`}
        className="pi-mq-play"
      />
    </svg>
  );
}

const LAYOUTS: Array<{ v: LayoutInsert; nome: string }> = [
  { v: { tipo: 'cheia' }, nome: 'Tela cheia' },
  { v: { tipo: 'faixas', avatar: 'cima' }, nome: 'Faixas' },
  { v: { tipo: 'cards', avatar: 'cima' }, nome: 'Cards' },
];

const TRANSICOES: Array<{ v: TipoTransicao; nome: string }> = [
  { v: 'nenhuma', nome: 'Seco' },
  { v: 'escurecer', nome: 'Escurecer' },
  { v: 'luz', nome: 'Luz' },
  { v: 'misto', nome: 'Misto' },
];

/* ══════════════════ prévia do enquadramento do avatar ═══════════════════ */

/**
 * Mostra o que o split faz com o avatar no foco escolhido. É a diferença entre
 * "avatar no card" e "avatar sem cabeça" — e o único jeito de o editor ver
 * isso sem renderizar o vídeo inteiro.
 */
function PreviaDoFoco({ foco, thumb }: { foco: number; thumb: string | null }) {
  const dst = { w: 92, h: 82 }; // proporção de meia tela 9:16
  const rec = coverComFoco(1080, 1920, dst.w, dst.h, foco);
  const escala = dst.w / rec.sw;
  return (
    <div className="pi-foco-previa" style={{ width: dst.w, height: dst.h }}>
      {thumb ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumb}
          alt=""
          style={{
            position: 'absolute',
            width: 1080 * escala,
            height: 1920 * escala,
            left: -rec.sx * escala,
            top: -rec.sy * escala,
            maxWidth: 'none',
          }}
        />
      ) : (
        <div
          className="pi-foco-fake"
          style={{ height: 1920 * escala, top: -rec.sy * escala }}
          aria-hidden
        >
          <span className="pi-foco-cabeca" />
          <span className="pi-foco-tronco" />
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════ a janela ═════════════════════════════════ */

export type ParteDaCopy = { label: string; text: string };

export function PilotInsertsModal({
  partes,
  inserts,
  onFechar,
  onMudar,
  onSubirMidia,
  thumbDaMidia,
  duracaoDaMidia,
  lerMidia,
  thumbAvatar,
}: {
  /** a copy JÁ dividida — exatamente o que foi pro HeyGen */
  partes: ParteDaCopy[];
  inserts: Insert[];
  onFechar: () => void;
  onMudar: (proximos: Insert[]) => void;
  /** sobe o arquivo e devolve os metadados pra montar o insert */
  onSubirMidia: (f: File, ancora: string) => Promise<{
    key: string;
    nome: string;
    tipo: 'video' | 'imagem';
    w: number;
    h: number;
    durSec?: number;
  } | null>;
  /** thumb (dataURL) de uma mídia já subida */
  thumbDaMidia: (key: string) => string | null;
  /** duração (s) de uma mídia já subida — pro diagnóstico de encaixe */
  duracaoDaMidia?: (key: string) => number | null;
  /** bytes de uma mídia já subida — o recortador precisa TOCAR o arquivo */
  lerMidia?: (key: string) => Promise<Blob | null>;
  /** thumb do avatar, pra prévia do foco */
  thumbAvatar?: string | null;
}) {
  const [montado, setMontado] = useState(false);
  const [parteAtiva, setParteAtiva] = useState<string>(partes[0]?.label || '');
  // A roda do mouse sobre a janela rolava a PÁGINA por trás (Silas, 02.09).
  // Com o body travado, o scroll só existe dentro da janela.
  useEffect(() => travarScrollDaPagina(), []);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [subindo, setSubindo] = useState(false);
  /** Primeira ponta de um trecho em construção (clique 1 de 2). */
  const [ancorando, setAncorando] = useState<{ id: string; de: number } | null>(null);
  const [urlsDeMidia, setUrlsDeMidia] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setMontado(true), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const comTexto = useMemo(() => partes.filter((p) => (p.text || '').trim()), [partes]);
  const insertsDaParte = useCallback(
    (label: string) => inserts.filter((i) => i.ancora === label),
    [inserts],
  );

  /* ── URLs pro recortador ──────────────────────────────────────────────
   * O recorte precisa TOCAR o arquivo, não só ver a thumb. Os bytes vivem no
   * IndexedDB; aqui eles viram Object URL uma vez por mídia e são revogados
   * ao fechar a janela — Object URL esquecido segura o blob na memória pelo
   * resto da sessão. */
  const urlsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!lerMidia) return;
    let vivo = true;
    (async () => {
      for (const ins of inserts) {
        if (ins.midiaTipo !== 'video' || urlsRef.current[ins.midiaKey]) continue;
        const b = await lerMidia(ins.midiaKey).catch(() => null);
        if (!vivo || !b) continue;
        const u = URL.createObjectURL(b);
        urlsRef.current = { ...urlsRef.current, [ins.midiaKey]: u };
        setUrlsDeMidia(urlsRef.current);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [inserts, lerMidia]);
  useEffect(
    () => () => {
      for (const u of Object.values(urlsRef.current)) URL.revokeObjectURL(u);
      urlsRef.current = {};
    },
    [],
  );

  const atualizar = (id: string, mudanca: Partial<Insert>) =>
    onMudar(inserts.map((i) => (i.id === id ? { ...i, ...mudanca } : i)));
  const remover = (id: string) => onMudar(inserts.filter((i) => i.id !== id));

  async function subir(f: File) {
    setSubindo(true);
    try {
      const meta = await onSubirMidia(f, parteAtiva);
      if (!meta) return;
      const id = `ins${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
      const novo = insertPadrao(id, parteAtiva, meta);
      onMudar([...inserts, novo]);
      setSelecionado(id);
    } finally {
      setSubindo(false);
    }
  }

  if (!montado) return null;
  const parte = comTexto.find((p) => p.label === parteAtiva) || comTexto[0];
  const palavras = (parte?.text || '').split(/\s+/).filter(Boolean);

  return createPortal(
    <div className="pi-camada" role="dialog" aria-modal="true" aria-label="Inserts">
      <div className="pi-veu" onClick={onFechar} aria-hidden />
      <div className="pi-janela">
        {/* ── cabeçalho ── */}
        <div className="pi-cab">
          <span className="pi-cab-tile" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="14" height="12" rx="2" />
              <path d="M22 8v10a2 2 0 0 1-2 2H8" opacity="0.55" />
              <path d="m7 10 4 2-4 2z" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="pi-cab-textos">
            <span className="pi-titulo">Inserts</span>
            <span className="pi-sub">
              O b-roll entra na montagem, no ponto da copy que você escolher — sem mexer no que já foi pro HeyGen.
            </span>
          </span>
          <span className="pi-conta">{inserts.length}</span>
          <button type="button" className="pi-x" onClick={onFechar} aria-label="Fechar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="pi-corpo">
          {/* ── ESQUERDA: as partes da copy ── */}
          <aside className="pi-partes">
            <div className="pi-rotulo">Onde entra</div>
            {comTexto.map((p) => {
              const n = insertsDaParte(p.label).length;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setParteAtiva(p.label)}
                  className={'pi-parte' + (p.label === parteAtiva ? ' is-on' : '')}
                >
                  <span className="pi-parte-nome">{p.label}</span>
                  <span className="pi-parte-txt">{p.text.slice(0, 64)}…</span>
                  {n > 0 ? <span className="pi-parte-n">{n}</span> : null}
                </button>
              );
            })}
          </aside>

          {/* ── DIREITA: a copy da parte + os inserts dela ── */}
          <section className="pi-palco">
            {/* COPY STICKY (02.09): a coluna INTEIRA rola — é o que garante que
              * recorte, encaixe e foco sejam alcançáveis em qualquer altura de
              * tela — e a copy gruda no topo com fundo sólido, então marcar o
              * trecho continua possível com o card aberto. */}
            <div className="pi-copy-fixa">
            <div className="pi-rotulo">
              Clique na palavra em que o insert entra
              <span className="pi-rotulo-nota">o texto do HeyGen não muda — isto é só a montagem</span>
            </div>

            <div className="pi-copy">
              {palavras.map((w, i) => {
                // De quem é esta palavra? (o trecho, não uma marca solta)
                const dono = insertsDaParte(parteAtiva)
                  .map(normalizarInsert)
                  .find((x) => i >= x.palavraDe && i <= x.palavraAte);
                const emConstrucao =
                  ancorando && insertsDaParte(parteAtiva).some((x) => x.id === ancorando.id)
                    ? i >= Math.min(ancorando.de, i) && i === ancorando.de
                    : false;
                const alvo =
                  (selecionado && inserts.find((x) => x.id === selecionado && x.ancora === parteAtiva)) ||
                  insertsDaParte(parteAtiva)[0];
                const cls =
                  'pi-palavra' +
                  (dono ? ' is-dentro' : '') +
                  (dono && i === dono.palavraDe ? ' is-inicio' : '') +
                  (dono && i === dono.palavraAte ? ' is-fim' : '') +
                  (emConstrucao ? ' is-ancora' : '');
                return (
                  <button
                    key={i}
                    type="button"
                    className={cls}
                    onClick={() => {
                      if (!alvo) {
                        fileRef.current?.click();
                        return;
                      }
                      // DOIS CLIQUES definem o trecho: o 1º fixa a ponta, o 2º
                      // fecha. Marcar palavra a palavra seria insuportável num
                      // parágrafo de 40 palavras.
                      if (ancorando && ancorando.id === alvo.id) {
                        const de = Math.min(ancorando.de, i);
                        const ate = Math.max(ancorando.de, i);
                        atualizar(alvo.id, { palavraDe: de, palavraAte: ate });
                        setAncorando(null);
                      } else {
                        setAncorando({ id: alvo.id, de: i });
                        setSelecionado(alvo.id);
                      }
                    }}
                    title={
                      ancorando && alvo && ancorando.id === alvo.id
                        ? 'Clique aqui pra FECHAR o trecho'
                        : 'Clique pra começar o trecho do insert'
                    }
                  >
                    {w}
                  </button>
                );
              })}
            </div>
            <div className="pi-copy-dica">
              {ancorando ? (
                <span className="pi-copy-dica-on">
                  Trecho aberto — clique na <b>última</b> palavra pra fechar.
                  <button type="button" className="pi-mini ml-2" onClick={() => setAncorando(null)}>
                    cancelar
                  </button>
                </span>
              ) : (
                <>Clique na primeira palavra do trecho e depois na última. O insert cobre exatamente essa fala.</>
              )}
            </div>
            </div>

            {/* ── os inserts desta parte ── */}
            <div className="pi-lista">
              {insertsDaParte(parteAtiva).map((ins) => {
                const thumb = thumbDaMidia(ins.midiaKey);
                const aberto = selecionado === ins.id;
                return (
                  <div key={ins.id} className={'pi-card' + (aberto ? ' is-aberto' : '')}>
                    <button
                      type="button"
                      className="pi-card-topo"
                      onClick={() => setSelecionado(aberto ? null : ins.id)}
                    >
                      <span className="pi-card-thumb">
                        {thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={thumb} alt="" />
                        ) : (
                          <span className="pi-card-thumb-vazia" aria-hidden>▶</span>
                        )}
                      </span>
                      <span className="pi-card-info">
                        <span className="pi-card-nome">{ins.midiaNome}</span>
                        <span className="pi-card-meta">
                          {ins.layout.tipo === 'cheia'
                            ? 'tela cheia'
                            : `${ins.layout.tipo === 'faixas' ? 'faixas' : 'cards'} · avatar ${ins.layout.avatar}`}
                          {' · '}
                          {(() => {
                            const n = normalizarInsert(ins as never);
                            const q = n.palavraAte - n.palavraDe + 1;
                            return `${q} palavra${q === 1 ? '' : 's'} do texto`;
                          })()}
                        </span>
                      </span>
                      <span className="pi-card-chev" aria-hidden>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </span>
                    </button>

                    {aberto ? (
                      <div className="pi-card-corpo">
                        {/* LAYOUT com maquete */}
                        <div className="pi-rotulo">Layout</div>
                        <div className="pi-layouts">
                          {LAYOUTS.map((L) => {
                            const mesmo = L.v.tipo === ins.layout.tipo;
                            const alvo: LayoutInsert =
                              L.v.tipo === 'cheia'
                                ? { tipo: 'cheia' }
                                : { tipo: L.v.tipo, avatar: ins.layout.tipo !== 'cheia' ? ins.layout.avatar : 'cima' };
                            return (
                              <button
                                key={L.nome}
                                type="button"
                                className={'pi-layout' + (mesmo ? ' is-on' : '')}
                                onClick={() => atualizar(ins.id, { layout: alvo })}
                              >
                                <Maquete layout={alvo} ativo={mesmo} />
                                <span className="pi-layout-nome">{L.nome}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* POSIÇÃO DO AVATAR + FOCO (só no split) */}
                        {ins.layout.tipo !== 'cheia' ? (
                          <>
                            <div className="pi-rotulo mt">Avatar</div>
                            <div className="pi-avatar-linha">
                              <div className="pi-seg">
                                {(['cima', 'baixo'] as const).map((pos) => (
                                  <button
                                    key={pos}
                                    type="button"
                                    className={'pi-seg-item' + (ins.layout.tipo !== 'cheia' && ins.layout.avatar === pos ? ' is-on' : '')}
                                    onClick={() =>
                                      atualizar(ins.id, {
                                        layout: { tipo: ins.layout.tipo as 'faixas' | 'cards', avatar: pos },
                                      })
                                    }
                                  >
                                    {pos === 'cima' ? 'Em cima' : 'Embaixo'}
                                  </button>
                                ))}
                              </div>
                              <div className="pi-foco">
                                <PreviaDoFoco foco={ins.focoAvatarY} thumb={thumbAvatar || null} />
                                <div className="pi-foco-ctrl">
                                  <span className="pi-foco-rot">Enquadramento do rosto</span>
                                  <input
                                    type="range"
                                    min={0.1}
                                    max={0.7}
                                    step={0.02}
                                    value={ins.focoAvatarY}
                                    onChange={(e) => atualizar(ins.id, { focoAvatarY: parseFloat(e.target.value) })}
                                    className="pi-slider"
                                  />
                                  <button
                                    type="button"
                                    className="pi-mini"
                                    onClick={() => atualizar(ins.id, { focoAvatarY: INSERT_FOCO_PADRAO })}
                                  >
                                    padrão
                                  </button>
                                </div>
                              </div>
                            </div>
                          </>
                        ) : null}

                        {/* TRANSIÇÃO */}
                        <div className="pi-rotulo mt">Transição</div>
                        <div className="pi-seg">
                          {TRANSICOES.map((t) => (
                            <button
                              key={t.v}
                              type="button"
                              className={'pi-seg-item' + (ins.transicao === t.v ? ' is-on' : '')}
                              onClick={() => atualizar(ins.id, { transicao: t.v })}
                            >
                              {t.nome}
                            </button>
                          ))}
                        </div>

                        {/* RECORTE — QUE PEDAÇO do arquivo vira o insert.
                          * Sem isto, importar um vídeo de 3 min pra usar 6s do
                          * meio era impossível: entrava o arquivo do começo. */}
                        {ins.midiaTipo === 'video' ? (
                          <>
                            <div className="pi-rotulo mt">
                              Recorte do arquivo
                              <span className="pi-rotulo-nota">arrasta as pontas, ou marca com a agulha</span>
                            </div>
                            <RecortadorDeMidia
                              url={urlsDeMidia[ins.midiaKey] ?? null}
                              recorteDe={ins.recorteDe}
                              recorteAte={ins.recorteAte}
                              onMudar={(de, ate) => atualizar(ins.id, { recorteDe: de, recorteAte: ate })}
                            />
                          </>
                        ) : null}

                        {/* SOM DO INSERT (03.09): b-roll entra MUDO por padrão
                          * (a fala do avatar é que manda), mas tem insert que só
                          * funciona com o som dele. */}
                        {ins.midiaTipo === 'video' ? (
                          <>
                            <div className="pi-rotulo mt">
                              Som do insert
                              <span className="pi-rotulo-nota">
                                {ins.audio ? 'entra junto com a fala do avatar' : 'mudo — só a fala do avatar'}
                              </span>
                            </div>
                            <div className="pi-som">
                              <button
                                type="button"
                                className={'pi-som-btn' + (ins.audio ? ' is-on' : '')}
                                onClick={() => atualizar(ins.id, { audio: !ins.audio })}
                                title={ins.audio ? 'Desligar o som deste insert' : 'Ligar o som deste insert'}
                                aria-label="Som do insert"
                              >
                                {ins.audio ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M11 5 6 9H2v6h4l5 4V5z" />
                                    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                                  </svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M11 5 6 9H2v6h4l5 4V5z" />
                                    <path d="m17 9 4 6M21 9l-4 6" />
                                  </svg>
                                )}
                              </button>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={typeof ins.volume === 'number' ? ins.volume : INSERT_VOLUME_PADRAO}
                                onChange={(e) => atualizar(ins.id, { audio: true, volume: parseFloat(e.target.value) })}
                                className={'pi-slider pi-som-vol' + (ins.audio ? '' : ' is-off')}
                                title="Volume do som do insert"
                              />
                              <span className="pi-som-num mono">
                                {Math.round((typeof ins.volume === 'number' ? ins.volume : INSERT_VOLUME_PADRAO) * 100)}%
                              </span>
                            </div>
                          </>
                        ) : null}

                        {/* ENCAIXE — não é controle, é DIAGNÓSTICO.
                          * A duração vem do trecho marcado; o que resta é a
                          * mídia se ajustar. Aqui o editor vê o que o sistema
                          * vai fazer, em vez de ter que decidir. */}
                        <div className="pi-rotulo mt">Encaixe automático</div>
                        {(() => {
                          const n = normalizarInsert(ins as never);
                          const palavrasDaParte = (partes.find((p) => p.label === ins.ancora)?.text || '')
                            .split(/\s+/)
                            .filter(Boolean).length || 1;
                          // estimativa honesta: a parte inteira ≈ nº de palavras × ~0,42s
                          const janela = Math.max(0.5, (n.palavraAte - n.palavraDe + 1) * 0.42);
                          // o que conta é a duração do RECORTE, não a do arquivo
                          const arquivo = duracaoDaMidia?.(ins.midiaKey) ?? 0;
                          const natural = arquivo > 0 ? recorteDaMidia(ins, arquivo).dur : 0;
                          const pv = planoDeVelocidade(natural, janela);
                          const rotulo =
                            ins.midiaTipo === 'imagem'
                              ? 'Imagem — fica parada o trecho inteiro.'
                              : pv.motivo === 'cortou'
                                ? `Arquivo de ${natural.toFixed(1)}s num trecho de ~${janela.toFixed(1)}s: CORTA no fim da fala.`
                                : pv.motivo === 'desacelerou'
                                  ? `Arquivo de ${natural.toFixed(1)}s num trecho de ~${janela.toFixed(1)}s: DESACELERA pra ${pv.velocidade.toFixed(2)}x.`
                                  : pv.motivo === 'desacelerou-e-congelou'
                                    ? `Curto demais: vai a ${pv.velocidade.toFixed(2)}x e o resto segura no último frame.`
                                    : natural > 0
                                      ? 'Cabe exato — sem ajuste.'
                                      : 'A duração do arquivo é medida na montagem.';
                          return (
                            <div className={'pi-encaixe' + (pv.motivo === 'desacelerou-e-congelou' ? ' is-alerta' : '')}>
                              <span className="pi-encaixe-icone" aria-hidden>
                                {pv.motivo === 'cortou' ? '✂' : pv.velocidade < 1 ? '◐' : '='}
                              </span>
                              <span>
                                {rotulo}
                                {pv.blur > 0 ? ' Com borrão leve pra o lento não parecer travado.' : ''}
                              </span>
                            </div>
                          );
                        })()}

                        <button type="button" className="pi-remover" onClick={() => remover(ins.id)}>
                          remover insert
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {/* ADICIONAR */}
              <label className={'pi-add' + (subindo ? ' is-subindo' : '')}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void subir(f);
                    e.target.value = '';
                  }}
                />
                <span className="pi-add-mais" aria-hidden>+</span>
                {subindo ? 'lendo o arquivo…' : `insert em ${parteAtiva}`}
              </label>
            </div>
          </section>
        </div>

        <div className="pi-rodape">
          <span className="pi-rodape-txt">
            {inserts.length === 0
              ? 'Nenhum insert — o AD sai só com o avatar.'
              : `${inserts.length} insert${inserts.length === 1 ? '' : 's'} · entram na montagem, depois da decupagem.`}
          </span>
          <button type="button" className="pi-ok" onClick={onFechar}>
            Pronto
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
