'use client';

/**
 * SFX E TRILHA do Pilot (08.10) — a janela do botão da nota musical.
 *
 * Duas coisas num botão só, como o Silas pediu:
 *  - SMART SFX: cada transição recebe o som dela (luz vermelha = riser que
 *    TERMINA no pico, luz = camera flash, escurecer = plim alternado, piscar =
 *    clique do mouse) e a virada do gancho ganha um boom de suspense. Os
 *    tempos vêm calibrados pelo pico de cada arquivo (pilot-sonoplastia.ts).
 *    É automático, mas editável: o som de cada tipo, a densidade, o volume e,
 *    depois da primeira montagem, cada ponto do AD.
 *  - TRILHA: uma janela DENTRO desta. Sobe do PC, escolhe o volume relativo à
 *    voz e ouve antes (com a voz do próprio AD quando ele já foi montado).
 *
 * Portal + CSS em globals.css (`.sn-*`, casca `.lz-*` das janelas irmãs).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import {
  ESCOLHAS_DE_SOM,
  SFX_CATALOGO,
  SFX_IDS,
  SFX_VOLUME_MAX,
  TRILHA_VOLUME_MAX,
  dbDoVolume,
  ganhoDaTrilha,
  nomeDaEscolha,
  normalizarSfxCfg,
  normalizarTrilhaCfg,
  planejarSfx,
  type DensidadeSfx,
  type SfxCfg,
  type SfxId,
  type SomEscolha,
  type TrilhaCfg,
} from '@/lib/pilot-sonoplastia';
import type { TransicaoEfetiva, TransicaoNoVideo } from '@/lib/pilot-inserts';
import type { TrilhaSalva } from '@/lib/pilot-trilhas-store';

/* ═══════════════════════════ som de prévia ═══════════════════════════════ */

let ctxGlobal: AudioContext | null = null;
function ctxDeAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = (window as { AudioContext?: typeof AudioContext }).AudioContext
    || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!ctxGlobal || ctxGlobal.state === 'closed') ctxGlobal = new Ctx();
  return ctxGlobal;
}

/** Toca um SFX do catálogo num nível de ESCUTA (pico em -6 dB) — é pra
 *  conhecer o som; o nível dentro do AD é o calibrado. */
async function ouvirSfx(id: SfxId, onFim?: () => void): Promise<() => void> {
  const ctx = ctxDeAudio();
  if (!ctx) return () => {};
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const { carregarSfx } = await import('@/lib/pilot-sonoplastia-run');
  const buf = await carregarSfx(id);
  if (!buf) { onFim?.(); return () => {}; }
  let pico = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i += 4) { const a = Math.abs(d[i]); if (a > pico) pico = a; }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = pico > 0 ? 0.5 / pico : 1;
  src.connect(g).connect(ctx.destination);
  const def = SFX_CATALOGO[id];
  src.start(0, 0, def.usoSec);
  src.onended = () => onFim?.();
  return () => { try { src.stop(); } catch { /* já parou */ } };
}

/* ═══════════════════════════ pedaços visuais ═════════════════════════════ */

const TRANSICOES: Array<{ v: TransicaoEfetiva; nome: string; dica: string }> = [
  { v: 'luz-vermelha', nome: 'Luz vermelha', dica: 'O riser sobe e termina no pico do clarão.' },
  { v: 'luz', nome: 'Luz', dica: 'O disparo do flash bate no clarão branco.' },
  { v: 'escurecer', nome: 'Escurecer', dica: 'Plim no fundo do preto, alternando 1 e 15.' },
  { v: 'piscar', nome: 'Piscar', dica: 'O clique cai com o olho fechado.' },
];

const DENSIDADES: Array<{ v: DensidadeSfx; nome: string; dica: string }> = [
  { v: 'pontual', nome: 'Pontual', dica: 'Um som a cada ~5s no máximo. Só pontua.' },
  { v: 'equilibrado', nome: 'Equilibrado', dica: 'O feeling do estúdio: um a cada ~2,5s, nunca embolado.' },
  { v: 'todas', nome: 'Toda transição', dica: 'Cada troca ganha o som dela.' },
];

function Equalizador({ ativo }: { ativo: boolean }) {
  return (
    <span className={'sn-eq' + (ativo ? ' is-on' : '')} aria-hidden>
      <i /><i /><i />
    </span>
  );
}

function IconePlay({ tocando }: { tocando: boolean }) {
  return tocando ? (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13l11-6.5z" /></svg>
  );
}

const mmss = (s: number) => {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const r = t - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`.replace('.', ',');
};

/** Lista de escolhas de som com ▶ em cada uma (abre embaixo da linha). */
function EscolhaDeSom({
  valor,
  onEscolher,
  tocando,
  onOuvir,
}: {
  valor: SomEscolha;
  onEscolher: (v: SomEscolha) => void;
  tocando: SfxId | null;
  onOuvir: (id: SfxId) => void;
}) {
  return (
    <div className="sn-escolhas" role="radiogroup">
      {ESCOLHAS_DE_SOM.map((e) => {
        const id: SfxId | null = e === 'plim-alternado' ? 'plim-1' : e === 'nenhum' ? null : e;
        return (
          <span key={e} className={'sn-escolha' + (valor === e ? ' is-on' : '')}>
            <button type="button" role="radio" aria-checked={valor === e} className="sn-escolha-nome" onClick={() => onEscolher(e)}>
              {nomeDaEscolha(e)}
            </button>
            {id ? (
              <button type="button" className={'sn-mini-play' + (tocando === id ? ' is-tocando' : '')} onClick={() => onOuvir(id)} aria-label={`Ouvir ${nomeDaEscolha(e)}`}>
                <IconePlay tocando={tocando === id} />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════ a janela ════════════════════════════════ */

export type RoteiroDeSom = {
  /** as transições do último AD montado (o que o render desenhou) */
  transicoes: TransicaoNoVideo[];
  durSec: number;
  fimDoGancho: number | null;
  /** nome do vídeo (G1/G2…) pra o editor saber de qual AD é */
  filename: string;
};

export function PilotSonoplastiaModal({
  sfx: sfxBruto,
  trilha: trilhaBruta,
  onSfx,
  onTrilha,
  onFechar,
  roteiro,
  vozDeReferencia,
}: {
  sfx: SfxCfg;
  trilha: TrilhaCfg;
  onSfx: (cfg: SfxCfg, virarPadrao?: boolean) => void;
  onTrilha: (cfg: TrilhaCfg, virarPadrao?: boolean) => void;
  onFechar: () => void;
  /** o último AD montado desta task (pra editar ponto a ponto) */
  roteiro?: () => Promise<RoteiroDeSom | null>;
  /** a voz do AD já montado, pra ouvir a trilha por baixo dela */
  vozDeReferencia?: () => Promise<Blob | null>;
}) {
  const sfx = normalizarSfxCfg(sfxBruto);
  const trilha = normalizarTrilhaCfg(trilhaBruta);
  const [montado, setMontado] = useState(false);
  const [abertaTrilha, setAbertaTrilha] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [tocando, setTocando] = useState<SfxId | null>(null);
  const pararRef = useRef<(() => void) | null>(null);
  const [rot, setRot] = useState<RoteiroDeSom | null>(null);

  useEffect(() => setMontado(true), []);
  useEffect(() => travarScrollDaPagina(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (abertaTrilha) setAbertaTrilha(false);
      else onFechar();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar, abertaTrilha]);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = roteiro ? await roteiro().catch(() => null) : null;
      if (vivo) setRot(r);
    })();
    return () => { vivo = false; };
  }, [roteiro]);
  useEffect(() => () => pararRef.current?.(), []);

  const ouvir = useCallback(async (id: SfxId) => {
    pararRef.current?.();
    pararRef.current = null;
    if (tocando === id) { setTocando(null); return; }
    setTocando(id);
    pararRef.current = await ouvirSfx(id, () => setTocando((t) => (t === id ? null : t)));
  }, [tocando]);

  // o plano AO VIVO do último AD montado: cada edição reflete na hora
  const plano = useMemo(() => {
    if (!rot) return [];
    return planejarSfx({ ...sfx, on: true }, { transicoes: rot.transicoes, durSec: rot.durSec, fimDoGancho: rot.fimDoGancho });
  }, [rot, sfx]);
  const pontos = useMemo(() => {
    if (!rot) return [];
    const lista: Array<{ chave: string; t: number; tipo: TransicaoEfetiva | 'gancho'; som: SfxId | null }> = rot.transicoes.map((tr) => {
      const p = plano.find((x) => x.chave === tr.chave);
      return { chave: tr.chave, t: tr.t, tipo: tr.tipo, som: p ? p.sfx : null };
    });
    const g = plano.find((x) => x.chave === 'gancho');
    if (g) {
      const i = lista.findIndex((x) => Math.abs(x.t - g.t) < 1e-3);
      if (i >= 0) lista[i] = { chave: 'gancho', t: g.t, tipo: 'gancho', som: g.sfx };
      else lista.push({ chave: 'gancho', t: g.t, tipo: 'gancho', som: g.sfx });
    }
    return lista.sort((a, b) => a.t - b.t);
  }, [rot, plano]);

  if (!montado) return null;

  const mudarSfx = (c: Partial<SfxCfg>) => onSfx({ ...sfx, ...c });
  const editarPonto = (chave: string, v: SomEscolha) => {
    const pontosNovos = { ...(sfx.pontos || {}), [chave]: v };
    mudarSfx({ on: true, pontos: pontosNovos });
  };
  const editados = Object.keys(sfx.pontos || {}).length;

  return createPortal(
    <div className="lz-camada" role="dialog" aria-modal="true" aria-label="SFX e trilha">
      <div className="lz-veu" onClick={onFechar} aria-hidden />
      <div className={'lz-janela sn-janela' + (abertaTrilha ? ' is-trilha' : '')}>
        <div className="lz-cab">
          <span className="lz-cab-tile sn-tile" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 17.5V5.5l8-2v11.2" />
              <circle cx="6.6" cy="17.6" r="2.4" fill="currentColor" stroke="none" />
              <circle cx="14.6" cy="15.4" r="2.4" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="lz-cab-textos">
            <span className="lz-titulo">SFX e trilha</span>
            <span className="lz-sub">Os SFX entram sozinhos nas transições, cada um batendo no pico dela. A trilha você sobe do PC e regula ouvindo.</span>
          </span>
          <button type="button" className="lz-x" onClick={onFechar} aria-label="Fechar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        {/* os dois interruptores: SFX e trilha */}
        <div className="sn-duo">
          <button type="button" className={'sn-card' + (sfx.on ? ' is-on' : '')} onClick={() => mudarSfx({ on: !sfx.on })} aria-pressed={sfx.on}>
            <span className="sn-card-nucleo">
              <span className="sn-card-topo">
                <span className="sn-card-icone" aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h3l3-7 4 14 3-7h5" /></svg>
                </span>
                <span className="sn-pill">{sfx.on ? 'ON' : 'OFF'}</span>
              </span>
              <span className="sn-card-nome">Smart SFX</span>
              <span className="sn-card-dica">{sfx.on ? 'Som em cada transição, no tempo certo' : 'Clica pra ligar'}</span>
            </span>
          </button>
          <button type="button" className={'sn-card is-trilha' + (trilha.on ? ' is-on' : '')} onClick={() => setAbertaTrilha(true)}>
            <span className="sn-card-nucleo">
              <span className="sn-card-topo">
                <span className="sn-card-icone" aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>
                </span>
                <span className="sn-pill">{trilha.on ? `${Math.round(trilha.volume * 100)}%` : 'OFF'}</span>
              </span>
              <span className="sn-card-nome">Trilha sonora</span>
              <span className="sn-card-dica">{trilha.on && trilha.nome ? trilha.nome : 'Subir do PC e regular o volume'}</span>
              <span className="sn-card-abrir" aria-hidden>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
              </span>
            </span>
          </button>
        </div>

        <div className="lz-corpo">
          <div className={'sn-secao' + (sfx.on ? '' : ' is-off')}>
            <div className="sn-rotulo">Som de cada transição</div>
            <div className="sn-lista">
              {TRANSICOES.map((tr) => {
                const escolha = sfx.porTransicao[tr.v];
                const k = `tipo:${tr.v}`;
                const somDeOuvir: SfxId | null = escolha === 'plim-alternado' ? 'plim-1' : escolha === 'nenhum' ? null : escolha;
                return (
                  <div key={tr.v} className={'sn-linha' + (aberto === k ? ' is-aberta' : '')}>
                    <div className="sn-linha-topo">
                      <span className={`fi-amostra is-${tr.v} sn-amostra`} aria-hidden />
                      <span className="sn-linha-textos">
                        <span className="sn-linha-nome">{tr.nome}</span>
                        <span className="sn-linha-dica">{tr.dica}</span>
                      </span>
                      <button type="button" className="sn-som" onClick={() => setAberto(aberto === k ? null : k)} aria-expanded={aberto === k}>
                        {nomeDaEscolha(escolha)}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
                      </button>
                      {somDeOuvir ? (
                        <button type="button" className={'sn-play' + (tocando === somDeOuvir ? ' is-tocando' : '')} onClick={() => void ouvir(somDeOuvir)} aria-label={`Ouvir ${nomeDaEscolha(escolha)}`}>
                          <IconePlay tocando={tocando === somDeOuvir} />
                        </button>
                      ) : <span className="sn-play is-vazio" aria-hidden />}
                    </div>
                    {aberto === k ? (
                      <EscolhaDeSom
                        valor={escolha}
                        tocando={tocando}
                        onOuvir={(id) => void ouvir(id)}
                        onEscolher={(v) => { mudarSfx({ on: true, porTransicao: { ...sfx.porTransicao, [tr.v]: v } }); setAberto(null); }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            <button type="button" className={'sn-gancho' + (sfx.boomNoGancho ? ' is-on' : '')} onClick={() => mudarSfx({ boomNoGancho: !sfx.boomNoGancho })} aria-pressed={sfx.boomNoGancho}>
              <span className="sn-gancho-onda" aria-hidden>
                <svg width="30" height="18" viewBox="0 0 30 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M1 9h6l2-6 3 12 3-14 3 16 2-8h9" /></svg>
              </span>
              <span className="sn-gancho-txt">
                <b>Boom de suspense na virada do gancho</b>
                <small>Um impacto grave no corte do hook pro corpo. Nunca rouba o riser nem o clique.</small>
              </span>
              <span className="sn-pill">{sfx.boomNoGancho ? 'ON' : 'OFF'}</span>
            </button>

            <div className="sn-rotulo mt">Quantos SFX</div>
            <div className="sn-seg" role="radiogroup" aria-label="Densidade dos SFX">
              {DENSIDADES.map((d) => (
                <button key={d.v} type="button" role="radio" aria-checked={sfx.densidade === d.v} className={'sn-seg-item' + (sfx.densidade === d.v ? ' is-on' : '')} onClick={() => mudarSfx({ densidade: d.v })}>
                  {d.nome}
                </button>
              ))}
            </div>
            <p className="sn-dica">{DENSIDADES.find((d) => d.v === sfx.densidade)?.dica} Riser, clique e boom sempre entram: o som deles vem casado com a imagem.</p>

            <div className="sn-rotulo mt">Volume dos SFX</div>
            <div className="sn-volume">
              <input
                type="range"
                className="sn-range"
                min={0}
                max={SFX_VOLUME_MAX}
                step={0.05}
                value={sfx.volume}
                onChange={(e) => mudarSfx({ volume: parseFloat(e.target.value) })}
                style={{ ['--p' as string]: `${(sfx.volume / SFX_VOLUME_MAX) * 100}%` }}
                aria-label="Volume dos SFX"
              />
              <span className="sn-volume-num">{Math.round(sfx.volume * 100)}%</span>
            </div>
            <p className="sn-dica">100% é o nível calibrado: cada som uns 15 dB abaixo da voz, pontuando o corte sem disputar com a fala.</p>

            <div className="sn-rotulo mt">Os sons</div>
            <div className="sn-sons">
              {SFX_IDS.map((id) => (
                <button key={id} type="button" className={'sn-som-chip' + (tocando === id ? ' is-tocando' : '')} onClick={() => void ouvir(id)} title={SFX_CATALOGO[id].descricao}>
                  <span className="sn-som-chip-play" aria-hidden><IconePlay tocando={tocando === id} /></span>
                  {SFX_CATALOGO[id].nome}
                  <Equalizador ativo={tocando === id} />
                </button>
              ))}
            </div>

            {/* ponto a ponto, do último AD montado */}
            <div className="sn-rotulo mt">
              Ponto a ponto
              {editados ? (
                <button type="button" className="sn-reset" onClick={() => mudarSfx({ pontos: undefined })}>voltar tudo pro Smart</button>
              ) : null}
            </div>
            {rot && pontos.length ? (
              <>
                <p className="sn-dica">Do último AD montado ({rot.filename.replace(/\.[^.]+$/, '')}). Mudou aqui, vale no próximo &quot;Atualizar montagem&quot;.</p>
                <div className="sn-pontos">
                  {pontos.map((p) => {
                    const k = `ponto:${p.chave}`;
                    const escolhido = sfx.pontos?.[p.chave];
                    const valor: SomEscolha = escolhido ?? (p.som ?? 'nenhum');
                    return (
                      <div key={p.chave} className={'sn-ponto' + (aberto === k ? ' is-aberta' : '') + (escolhido ? ' is-editado' : '')}>
                        <div className="sn-ponto-topo">
                          <span className="sn-ponto-t">{mmss(p.t)}</span>
                          {p.tipo === 'gancho'
                            ? <span className="sn-ponto-tipo is-gancho">Gancho</span>
                            : <span className="sn-ponto-tipo"><span className={`fi-amostra is-${p.tipo}`} aria-hidden />{TRANSICOES.find((x) => x.v === p.tipo)?.nome}</span>}
                          <button type="button" className={'sn-som' + (p.som ? '' : ' is-mudo')} onClick={() => setAberto(aberto === k ? null : k)} aria-expanded={aberto === k}>
                            {p.som ? SFX_CATALOGO[p.som].nome : 'Sem som'}
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
                          </button>
                        </div>
                        {aberto === k ? (
                          <EscolhaDeSom
                            valor={valor}
                            tocando={tocando}
                            onOuvir={(id) => void ouvir(id)}
                            onEscolher={(v) => { editarPonto(p.chave, v); setAberto(null); }}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="sn-dica">Depois da primeira montagem, cada transição do AD aparece aqui com o som que recebeu, pra trocar ou tirar um por um.</p>
            )}
          </div>
        </div>

        <div className="lz-rodape">
          <button type="button" className="lz-padrao" onClick={() => { onSfx(sfx, true); onTrilha(trilha, true); }} title="Grava como padrão da conta: as próximas tasks já vêm assim">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
            usar sempre
          </button>
          <button type="button" className="lz-ok" onClick={onFechar}>Pronto</button>
        </div>

        {abertaTrilha ? (
          <JanelaDaTrilha trilha={trilha} onTrilha={onTrilha} onVoltar={() => setAbertaTrilha(false)} vozDeReferencia={vozDeReferencia} />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ═════════════════════ a janela da trilha (dentro da outra) ══════════════════ */

const PRESETS_TRILHA = [
  { v: 0.08, nome: 'Baixinha' },
  { v: 0.12, nome: 'Padrão' },
  { v: 0.2, nome: 'Presente' },
];

function JanelaDaTrilha({
  trilha,
  onTrilha,
  onVoltar,
  vozDeReferencia,
}: {
  trilha: TrilhaCfg;
  onTrilha: (cfg: TrilhaCfg, virarPadrao?: boolean) => void;
  onVoltar: () => void;
  vozDeReferencia?: () => Promise<Blob | null>;
}) {
  const [lista, setLista] = useState<TrilhaSalva[]>([]);
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tocando, setTocando] = useState(false);
  const [comVoz, setComVoz] = useState(true);
  const [temVoz, setTemVoz] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tocaRef = useRef<{ parar: () => void; ganho: GainNode; inicio: number; dur: number } | null>(null);
  const progRef = useRef<HTMLSpanElement | null>(null);
  const bufsRef = useRef<{ trilha?: { id: string; buf: AudioBuffer }; voz?: AudioBuffer | null }>({});
  const vozLufsRef = useRef<number | null>(null);

  const recarregar = useCallback(async () => {
    const { listarTrilhas } = await import('@/lib/pilot-trilhas-store');
    setLista(listarTrilhas());
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);

  // a voz de referência: só pra saber se existe (decodifica no play)
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const b = vozDeReferencia ? await vozDeReferencia().catch(() => null) : null;
      if (!vivo) return;
      setTemVoz(!!b);
      if (b) {
        const { decodificarAudio, canaisDe } = await import('@/lib/pilot-trilhas-store');
        const { lufsIntegrado } = await import('@/lib/pilot-sonoplastia');
        const buf = await decodificarAudio(b);
        if (!vivo) return;
        bufsRef.current.voz = buf;
        vozLufsRef.current = buf ? lufsIntegrado(canaisDe(buf), buf.sampleRate) : null;
      }
    })();
    return () => { vivo = false; };
  }, [vozDeReferencia]);

  const parar = useCallback(() => {
    tocaRef.current?.parar();
    tocaRef.current = null;
    setTocando(false);
  }, []);
  useEffect(() => () => parar(), [parar]);

  const sel = lista.find((t) => t.id === trilha.trilhaId) || null;
  const ganhoAtual = useCallback(
    (volume: number) => ganhoDaTrilha(volume, vozLufsRef.current ?? -16, sel?.lufs ?? null),
    [sel],
  );

  // volume AO VIVO enquanto toca
  useEffect(() => {
    const t = tocaRef.current;
    const ctx = ctxDeAudio();
    if (t && ctx) t.ganho.gain.setTargetAtTime(ganhoAtual(trilha.volume), ctx.currentTime, 0.03);
  }, [trilha.volume, ganhoAtual]);

  // barra de progresso por rAF direto no DOM (sem re-render da janela)
  useEffect(() => {
    if (!tocando) return;
    let raf = 0;
    const passo = () => {
      const t = tocaRef.current;
      const ctx = ctxDeAudio();
      if (t && ctx && progRef.current) {
        const p = Math.min(1, (ctx.currentTime - t.inicio) / t.dur);
        progRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      }
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [tocando]);

  const tocar = async () => {
    if (tocando) { parar(); return; }
    if (!sel) return;
    const ctx = ctxDeAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const { lerTrilha, decodificarAudio } = await import('@/lib/pilot-trilhas-store');
    let tb = bufsRef.current.trilha?.id === sel.id ? bufsRef.current.trilha.buf : null;
    if (!tb) {
      const blob = await lerTrilha(sel.id);
      tb = blob ? await decodificarAudio(blob) : null;
      if (!tb) { setErro('Essa trilha não abriu mais neste navegador. Suba ela de novo.'); return; }
      bufsRef.current.trilha = { id: sel.id, buf: tb };
    }
    const voz = comVoz ? bufsRef.current.voz : null;
    const dur = Math.min(tb.duration, voz ? voz.duration : 20, 30);
    const g = ctx.createGain();
    g.gain.value = ganhoAtual(trilha.volume);
    g.connect(ctx.destination);
    const st = ctx.createBufferSource();
    st.buffer = tb;
    st.connect(g);
    const inicio = ctx.currentTime + 0.05;
    st.start(inicio, 0, dur);
    let sv: AudioBufferSourceNode | null = null;
    if (voz) {
      sv = ctx.createBufferSource();
      sv.buffer = voz;
      sv.connect(ctx.destination);
      sv.start(inicio, 0, dur);
    }
    st.onended = () => { if (tocaRef.current?.ganho === g) { tocaRef.current = null; setTocando(false); } };
    tocaRef.current = {
      ganho: g, inicio, dur,
      parar: () => { try { st.stop(); } catch { /* */ } try { sv?.stop(); } catch { /* */ } g.disconnect(); },
    };
    setTocando(true);
  };

  const subir = async (f: File | null | undefined) => {
    if (!f) return;
    setErro(null);
    setSubindo(true);
    parar();
    try {
      const { salvarTrilha } = await import('@/lib/pilot-trilhas-store');
      const nova = await salvarTrilha(f);
      await recarregar();
      onTrilha({ ...trilha, on: true, trilhaId: nova.id, nome: nova.nome });
    } catch (e) {
      setErro((e as Error)?.message || 'Não consegui subir essa trilha.');
    } finally {
      setSubindo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const escolher = (t: TrilhaSalva) => {
    parar();
    onTrilha({ ...trilha, on: true, trilhaId: t.id, nome: t.nome });
  };
  const remover = async (t: TrilhaSalva) => {
    parar();
    const { removerTrilha } = await import('@/lib/pilot-trilhas-store');
    await removerTrilha(t.id);
    await recarregar();
    if (trilha.trilhaId === t.id) onTrilha({ ...trilha, on: false, trilhaId: null, nome: '' });
  };
  const db = dbDoVolume(trilha.volume);
  const pctVol = (trilha.volume / TRILHA_VOLUME_MAX) * 100;

  return (
    <div className="sn-trilha" role="dialog" aria-label="Trilha sonora">
      <div className="sn-trilha-cab">
        <button type="button" className="sn-voltar" onClick={() => { parar(); onVoltar(); }} aria-label="Voltar pros SFX">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <span className="sn-trilha-titulos">
          <span className="lz-titulo">Trilha sonora</span>
          <span className="lz-sub">Sobe do PC, regula ouvindo. Ela é cortada no tamanho do vídeo e termina com fade; se for mais curta, repete com emenda suave.</span>
        </span>
      </div>

      <button type="button" onClick={() => onTrilha({ ...trilha, on: !trilha.on && !!trilha.trilhaId })} className={'lz-switch' + (trilha.on ? ' is-on' : '')} aria-pressed={trilha.on} disabled={!trilha.trilhaId}>
        <span className="lz-switch-trilho" aria-hidden><span className="lz-switch-bola" /></span>
        <span className="lz-switch-txt">{trilha.on ? `Ligada: ${trilha.nome}` : trilha.trilhaId ? 'Desligada: o AD sai sem trilha' : 'Suba uma trilha pra ligar'}</span>
      </button>

      <div className="sn-trilha-corpo">
        <label
          className={'sn-drop' + (subindo ? ' is-subindo' : '')}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); void subir(e.dataTransfer.files?.[0]); }}
        >
          <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,video/mp4" onChange={(e) => void subir(e.target.files?.[0])} hidden disabled={subindo} />
          <span className="sn-drop-nucleo">
            <span className="sn-drop-icone" aria-hidden>
              {subindo ? (
                <span className="sn-gira" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
              )}
            </span>
            <span className="sn-drop-txt">
              <b>{subindo ? 'Medindo o volume da trilha' : 'Subir trilha do PC'}</b>
              <small>{subindo ? 'Ela é nivelada na voz antes de entrar' : 'Arraste aqui ou clique. MP3, WAV ou M4A'}</small>
            </span>
          </span>
        </label>
        {erro ? <p className="sn-erro" role="alert">{erro}</p> : null}

        {lista.length ? (
          <>
            <div className="sn-rotulo mt">Suas trilhas</div>
            <div className="sn-trilhas" role="radiogroup">
              {lista.map((t) => (
                <div key={t.id} className={'sn-trilha-item' + (t.id === trilha.trilhaId ? ' is-on' : '')}>
                  <button type="button" role="radio" aria-checked={t.id === trilha.trilhaId} className="sn-trilha-escolher" onClick={() => escolher(t)}>
                    <span className="sn-radio" aria-hidden />
                    <span className="sn-trilha-nome">{t.nome}</span>
                    <span className="sn-trilha-dur">{mmss(t.durSec).replace(/,\d$/, '')}</span>
                  </button>
                  <button type="button" className="sn-lixo" onClick={() => void remover(t)} aria-label={`Remover ${t.nome}`} title="Remover da biblioteca">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div className={'sn-trilha-ajuste' + (sel ? '' : ' is-off')}>
          <div className="sn-rotulo mt">Volume da trilha</div>
          <div className="sn-volume">
            <input
              type="range"
              className="sn-range is-trilha"
              min={0}
              max={TRILHA_VOLUME_MAX}
              step={0.01}
              value={trilha.volume}
              onChange={(e) => onTrilha({ ...trilha, volume: parseFloat(e.target.value) })}
              style={{ ['--p' as string]: `${pctVol}%` }}
              aria-label="Volume da trilha"
            />
            <span className="sn-volume-num">{Math.round(trilha.volume * 100)}%</span>
          </div>
          <div className="sn-trilha-linha">
            <div className="sn-seg is-mini" role="radiogroup" aria-label="Volumes prontos">
              {PRESETS_TRILHA.map((p) => (
                <button key={p.v} type="button" role="radio" aria-checked={Math.abs(trilha.volume - p.v) < 0.005} className={'sn-seg-item' + (Math.abs(trilha.volume - p.v) < 0.005 ? ' is-on' : '')} onClick={() => onTrilha({ ...trilha, volume: p.v })}>
                  {p.nome}
                </button>
              ))}
            </div>
            <span className="sn-db">{Number.isFinite(db) ? `${Math.abs(db).toFixed(0)} dB abaixo da voz` : 'muda'}</span>
          </div>

          <div className="sn-player">
            <button type="button" className={'sn-player-play' + (tocando ? ' is-tocando' : '')} onClick={() => void tocar()} disabled={!sel} aria-label={tocando ? 'Parar' : 'Ouvir com esse volume'}>
              <IconePlay tocando={tocando} />
            </button>
            <span className="sn-player-meio">
              <span className="sn-player-txt">
                <b>{tocando ? 'Tocando no volume do AD' : 'Ouvir com esse volume'}</b>
                <small>{comVoz && temVoz ? 'Por baixo da voz do próprio AD' : temVoz === false ? 'Sem voz ainda: monte o AD uma vez pra ouvir com ela' : 'Só a trilha, no nível que ela entra'}</small>
              </span>
              <span className="sn-player-barra" aria-hidden><span ref={progRef} className="sn-player-prog" /></span>
            </span>
            {temVoz ? (
              <button type="button" className={'sn-voz' + (comVoz ? ' is-on' : '')} onClick={() => { parar(); setComVoz(!comVoz); }} aria-pressed={comVoz} title="Ouvir a trilha por baixo da voz do AD">
                com a voz
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="lz-rodape">
        <button type="button" className="lz-padrao" onClick={() => onTrilha(trilha, true)} title="Esta trilha e este volume viram o padrão das próximas tasks">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
          usar sempre
        </button>
        <button type="button" className="lz-ok" onClick={() => { parar(); onVoltar(); }}>Pronto</button>
      </div>
    </div>
  );
}
