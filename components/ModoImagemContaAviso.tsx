'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HeyGenConectar } from '@/components/HeyGenConectar';
import { getLibrarySnapshot } from '@/lib/heygen-library-cache';

/**
 * Aviso de CONTA na hora de ligar o MODO IMAGEM de uma cena.
 *
 * O Pilot usa duas contas do HeyGen sem o usuário perceber:
 *   - o disparo normal vai pela EXTENSÃO → conta logada NO NAVEGADOR
 *     (avatares, vozes, geração e crédito, tudo dela);
 *   - o modo imagem vai pelo SERVIDOR → conta conectada por OAuth.
 *
 * Trocar a conta só no navegador sempre bastou pro disparo normal — é o
 * desenho, não defeito. Só o modo imagem escapa: em 23.09 o AD02 WL REP
 * escolheu um clone de voz da drmillion01 (navegador) e o modo imagem gerou
 * na b2caffiliates (OAuth) → "Voice not found", sem ninguém entender.
 *
 * Por isso o aviso mora AQUI, no clique do modo imagem, e só aparece quando as
 * duas contas são DIFERENTES. Conta desconhecida (biblioteca ainda não
 * carregou, diagnóstico fora) = não incomoda: o servidor ainda barra a voz
 * errada antes de gastar crédito (vozVisivel em lib/heygen-image-video.ts).
 */

type Contas = { navegador: string; modoImagem: string };

let cacheOauth: { email: string | null; em: number } | null = null;
const CACHE_MS = 3 * 60 * 1000;

async function emailDoModoImagem(forcar = false): Promise<string | null> {
  if (!forcar && cacheOauth && Date.now() - cacheOauth.em < CACHE_MS) return cacheOauth.email;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    const r = await fetch('/api/heygen/identidade?apiKeyOpcional=1', { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    const j = r.ok ? await r.json() : null;
    const email: string | null = j?.oauth?.valida ? j?.oauth?.conta?.email ?? null : null;
    cacheOauth = { email, em: Date.now() };
    return email;
  } catch {
    return null;
  }
}

function norm(e: string | null | undefined): string {
  return (e || '').trim().toLowerCase();
}

/**
 * `pedir(onOk)`: chame no clique que LIGA o modo imagem. Contas iguais ou
 * desconhecidas → `onOk()` na hora. Diferentes → abre a janela; `onOk` só roda
 * se o usuário escolher seguir.
 */
export function useAvisoContaModoImagem() {
  const [contas, setContas] = useState<Contas | null>(null);
  const [checando, setChecando] = useState(false);
  const pendente = useRef<(() => void) | null>(null);

  const pedir = useCallback(async (onOk: () => void) => {
    const navegador = getLibrarySnapshot().conta?.email ?? null;
    if (!navegador) return onOk();
    const modoImagem = await emailDoModoImagem();
    if (!modoImagem || norm(modoImagem) === norm(navegador)) return onOk();
    pendente.current = onOk;
    setContas({ navegador, modoImagem });
  }, []);

  const fechar = useCallback(() => {
    pendente.current = null;
    setContas(null);
  }, []);

  const seguir = useCallback(() => {
    const f = pendente.current;
    pendente.current = null;
    setContas(null);
    f?.();
  }, []);

  /** Depois de reconectar: se agora bate, segue sozinho. */
  const conferirDeNovo = useCallback(async () => {
    if (!contas) return;
    setChecando(true);
    const modoImagem = await emailDoModoImagem(true);
    setChecando(false);
    if (modoImagem && norm(modoImagem) === norm(contas.navegador)) return seguir();
    if (modoImagem) setContas({ ...contas, modoImagem });
  }, [contas, seguir]);

  const janela = contas ? (
    <JanelaContaModoImagem
      contas={contas}
      checando={checando}
      onFechar={fechar}
      onSeguir={seguir}
      onConferir={conferirDeNovo}
    />
  ) : null;

  return { pedir, janela };
}

function JanelaContaModoImagem({
  contas,
  checando,
  onFechar,
  onSeguir,
  onConferir,
}: {
  contas: Contas;
  checando: boolean;
  onFechar: () => void;
  onSeguir: () => void;
  onConferir: () => void;
}) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  if (!montado) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mi-conta-titulo"
    >
      <div className="plano-shell w-full max-w-[460px] rounded-[22px] p-[5px]" style={{ animation: 'plano-abre 0.28s cubic-bezier(0.32,0.72,0,1) both' }}>
        <div className="plano-core rounded-[17px] p-5">
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-black"
              style={{
                background: 'linear-gradient(155deg,#fde68a 0%,#fbbf24 55%,#f59e0b 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.45), 0 8px 18px -10px rgba(245,158,11,.9)',
              }}
              aria-hidden
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-4.5-4.5L7 20" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id="mi-conta-titulo"
                className="text-[15.5px] font-semibold leading-snug text-text"
                style={{ fontFamily: 'var(--font-tech)', letterSpacing: '-0.015em' }}
              >
                O modo imagem está em outra conta do HeyGen
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
                Esta cena vai ser gerada numa conta diferente da que está logada no navegador.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <LinhaConta rotulo="Navegador (avatares e vozes)" email={contas.navegador} ok />
            <LinhaConta rotulo="Modo imagem gera em" email={contas.modoImagem} />
          </div>

          <ul className="mt-4 grid gap-1.5 text-[12px] leading-relaxed text-text-muted">
            <li className="flex gap-2">
              <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span>Voz da <b className="text-text">biblioteca</b> do HeyGen funciona normal nas duas.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <span>
                <b className="text-text">Clone de voz</b> desta conta não existe na outra: o take é recusado.
              </span>
            </li>
          </ul>

          <div className="mt-4 rounded-[14px] p-3" style={{ background: 'rgba(255,255,255,.035)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)' }}>
            <div className="text-[12px] font-semibold text-text">Deixar tudo em {contas.navegador}</div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-muted">
              Conecte com essa conta logada no HeyGen e depois toque em conferir.
            </p>
            <div className="mt-2">
              <HeyGenConectar compacto />
            </div>
            <button
              type="button"
              onClick={onConferir}
              disabled={checando}
              className="mt-2 text-[11.5px] font-semibold text-cyan-300 underline-offset-2 hover:underline disabled:opacity-50"
            >
              {checando ? 'Conferindo…' : 'Já conectei — conferir de novo'}
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onFechar}
              className="rounded-full px-4 py-2 text-[12px] font-semibold text-text-muted transition-colors hover:text-text"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSeguir}
              className="plano-cta dark-island inline-flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 text-[12px] font-semibold text-white"
            >
              Ligar mesmo assim
              <span className="plano-cta-icone flex h-7 w-7 items-center justify-center rounded-full">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                </svg>
              </span>
            </button>
          </div>
          <p className="mt-2 text-right text-[10.5px] text-text-dim">Use voz da biblioteca se seguir assim.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function LinhaConta({ rotulo, email, ok }: { rotulo: string; email: string; ok?: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-[12px] px-3 py-2"
      style={{ background: 'rgba(255,255,255,.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)' }}
    >
      <span className="text-[11px] text-text-muted">{rotulo}</span>
      <span className={'mono truncate text-[12px] font-medium ' + (ok ? 'text-emerald-300' : 'text-amber-300')} title={email}>
        {email}
      </span>
    </div>
  );
}
