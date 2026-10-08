'use client';

/**
 * PROJETO EDITÁVEL — a janela de escolha (08.10).
 *
 * Silas: *"se clicar abre uma mini janela com design impecável perguntando se
 * é Premiere ou CapCut com a logo de ambos. CapCut: baixa a pasta certinha
 * pra rodar o projeto, com as instruções dentro (um PDF). NÃO perguntar onde
 * baixar ao clicar, apenas baixar. Premiere: vem o arquivo que abre o
 * projeto"*.
 *
 * Esta janela só escolhe e mostra o andamento; quem monta o pacote é o
 * `exportar` (pilot-projeto-run), que entrega um .zip direto pro download.
 * Portal + CSS em globals.css (`.pe-*`, casca `.lz-*`).
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { travarScrollDaPagina } from '@/lib/trava-scroll';

export type AlvoDoProjeto = 'capcut' | 'premiere';

export function LogoCapCut({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="pe-logo">
      <rect width="64" height="64" rx="15" fill="#0a0a0a" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.3" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
      {/* a claquete-tesoura da marca: duas lâminas que se fecham à direita */}
      <path d="M15 22.5 41.5 15.6a3.4 3.4 0 0 1 4.2 2.4l.4 1.5a3.4 3.4 0 0 1-2.4 4.2L22.6 29.4" fill="none" stroke="#fff" strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 22.5v17.4A4.6 4.6 0 0 0 19.6 44.5h26.8" fill="none" stroke="#fff" strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29.5 33.6 46.4 44.5" fill="none" stroke="#fff" strokeWidth="5.4" strokeLinecap="round" />
    </svg>
  );
}

export function LogoPremiere({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="pe-logo">
      <rect width="64" height="64" rx="15" fill="#00005b" />
      <rect x="2.6" y="2.6" width="58.8" height="58.8" rx="12.6" fill="none" stroke="#9999ff" strokeWidth="2.4" />
      <text x="32" y="42.5" textAnchor="middle" fontFamily="'Segoe UI', Arial, sans-serif" fontWeight="700" fontSize="27" fill="#9999ff" letterSpacing="-0.5">Pr</text>
    </svg>
  );
}

type Estado =
  | { fase: 'escolha' }
  | { fase: 'exportando'; alvo: AlvoDoProjeto; etapa: string }
  | { fase: 'pronto'; alvo: AlvoDoProjeto; arquivo: string; avisos: string[] }
  | { fase: 'erro'; alvo: AlvoDoProjeto; msg: string };

const PASSOS: Record<AlvoDoProjeto, string[]> = {
  capcut: [
    'Abra o .zip baixado e extraia (botão direito, Extrair tudo).',
    'Arraste a pasta do projeto pra pasta de rascunhos do CapCut (o PDF dentro mostra onde fica).',
    'Feche e abra o CapCut: o projeto aparece na lista, com tudo em camadas.',
  ],
  premiere: [
    'Abra o .zip baixado e extraia (botão direito, Extrair tudo).',
    'No Premiere: Arquivo, Importar, e escolha o arquivo .xml da pasta.',
    'Se ele pedir a mídia, aponte qualquer arquivo da pasta MIDIA: o resto se acha sozinho.',
  ],
};

export function PilotProjetoExportModal({
  nomeAd,
  onFechar,
  exportar,
}: {
  nomeAd: string;
  onFechar: () => void;
  exportar: (alvo: AlvoDoProjeto, onEtapa: (msg: string) => void) => Promise<{ arquivo: string; avisos: string[] }>;
}) {
  const [montado, setMontado] = useState(false);
  const [estado, setEstado] = useState<Estado>({ fase: 'escolha' });
  const ocupado = estado.fase === 'exportando';

  useEffect(() => setMontado(true), []);
  useEffect(() => travarScrollDaPagina(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar, ocupado]);

  if (!montado) return null;

  const ir = async (alvo: AlvoDoProjeto) => {
    setEstado({ fase: 'exportando', alvo, etapa: 'preparando o pacote' });
    try {
      const r = await exportar(alvo, (etapa) => setEstado((e) => (e.fase === 'exportando' ? { ...e, etapa } : e)));
      setEstado({ fase: 'pronto', alvo, arquivo: r.arquivo, avisos: r.avisos });
    } catch (e) {
      setEstado({ fase: 'erro', alvo, msg: (e as Error)?.message || 'Não consegui montar o projeto.' });
    }
  };

  const nomeDoAlvo = (a: AlvoDoProjeto) => (a === 'capcut' ? 'CapCut' : 'Premiere Pro');
  const Logo = ({ a, size }: { a: AlvoDoProjeto; size?: number }) => (a === 'capcut' ? <LogoCapCut size={size} /> : <LogoPremiere size={size} />);

  return createPortal(
    <div className="lz-camada" role="dialog" aria-modal="true" aria-label="Projeto editável">
      <div className="lz-veu" onClick={() => { if (!ocupado) onFechar(); }} aria-hidden />
      <div className="lz-janela pe-janela">
        <div className="lz-cab">
          <span className="lz-cab-textos">
            <span className="lz-titulo">Projeto editável</span>
            <span className="lz-sub">{nomeAd}: avatar, b-rolls, transições, legenda, SFX e trilha, cada um na sua camada.</span>
          </span>
          <button type="button" className="lz-x" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        {estado.fase === 'escolha' ? (
          <div className="pe-escolhas">
            {(['capcut', 'premiere'] as const).map((a) => (
              <button key={a} type="button" className={`pe-op is-${a}`} onClick={() => void ir(a)}>
                <span className="pe-op-nucleo">
                  <Logo a={a} />
                  <span className="pe-op-nome">{nomeDoAlvo(a)}</span>
                  <span className="pe-op-dica">
                    {a === 'capcut'
                      ? 'A pasta do projeto pronta pra rodar, com um PDF de como abrir.'
                      : 'O arquivo do projeto (XML) com a mídia junto e um PDF de como abrir.'}
                  </span>
                  <span className="pe-op-cta">
                    Baixar
                    <span className="pe-op-seta" aria-hidden>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : estado.fase === 'exportando' ? (
          <div className="pe-status">
            <span className="pe-status-logo"><Logo a={estado.alvo} size={44} /></span>
            <span className="pe-status-txt">
              <b>Montando o projeto do {nomeDoAlvo(estado.alvo)}</b>
              <small>{estado.etapa}</small>
            </span>
            <span className="pe-barra" aria-hidden><i /></span>
          </div>
        ) : estado.fase === 'pronto' ? (
          <div className="pe-pronto">
            <div className="pe-status is-pronto">
              <span className="pe-status-logo"><Logo a={estado.alvo} size={44} /></span>
              <span className="pe-status-txt">
                <b>Baixado</b>
                <small>{estado.arquivo}</small>
              </span>
              <span className="pe-check" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 12.8 5 5L19.5 6.5" /></svg>
              </span>
            </div>
            <ol className="pe-passos">
              {PASSOS[estado.alvo].map((p, i) => (
                <li key={i}><span className="pe-passo-n">{i + 1}</span>{p}</li>
              ))}
            </ol>
            {estado.avisos.length ? (
              <details className="pe-avisos">
                <summary>{estado.avisos.length} {estado.avisos.length === 1 ? 'observação' : 'observações'} sobre este projeto</summary>
                <ul>{estado.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </details>
            ) : null}
          </div>
        ) : (
          <div className="pe-pronto">
            <div className="pe-status is-erro">
              <span className="pe-status-logo"><Logo a={estado.alvo} size={44} /></span>
              <span className="pe-status-txt">
                <b>Não deu pra montar o projeto</b>
                <small>{estado.msg}</small>
              </span>
            </div>
          </div>
        )}

        <div className="lz-rodape">
          {estado.fase === 'pronto' || estado.fase === 'erro' ? (
            <button type="button" className="lz-padrao" onClick={() => setEstado({ fase: 'escolha' })}>
              baixar o outro
            </button>
          ) : <span />}
          <button type="button" className="lz-ok" onClick={onFechar} disabled={ocupado}>
            {estado.fase === 'pronto' ? 'Fechar' : 'Cancelar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
