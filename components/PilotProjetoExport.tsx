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
 * ABRIR DIRETO (08.10): com o app Auto Edit Abrir instalado, o mesmo clique
 * também chama o app (lib/abrir-projeto) — ele pega o .zip baixado, põe o
 * projeto no lugar e abre o editor JÁ no projeto.
 *  - app instalado → só um LIGA/DESLIGA: ligado abre no editor, desligado só
 *    baixa a pasta;
 *  - sem o app → o convite pra baixar (e o .zip baixa igual).
 * A janela percebe SOZINHA quando o instalador termina: a página que ele abre
 * (/abrir-projeto?instalado=1) grava a marca e o evento `storage` chega aqui.
 *
 * Esta janela só escolhe e mostra o andamento; quem monta o pacote é o
 * `exportar` (pilot-projeto-run), que entrega um .zip direto pro download.
 * Portal + CSS em globals.css (`.pe-*`, casca `.lz-*`).
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { travarScrollDaPagina } from '@/lib/trava-scroll';
import {
  abrirDiretoLigado, baixarInstalador, CHAVE_DA_MARCA, chamarApp, lerMarca, ligarAbrirDireto, linkDoPedido, marcarInstalado,
  nomeDoZip, novoJob, type MarcaDoApp,
} from '@/lib/abrir-projeto';

export type AlvoDoProjeto = 'capcut' | 'premiere';

/**
 * O ícone do CapCut, FIEL ao oficial: o símbolo foi medido no logo que vem
 * dentro do próprio CapCut (Resources/logo_cc.png, 240 px) — duas barras de
 * cantos arredondados cruzadas por um X que passa da borda direita, cortado
 * na vertical. Conferido pixel a pixel: 98,5% de sobreposição com o original.
 */
export function LogoCapCut({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" aria-hidden className="pe-logo">
      <rect width="240" height="240" rx="54" fill="#000" />
      <rect x="1.5" y="1.5" width="237" height="237" rx="52.5" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="3" />
      <g fill="#fff">
        <rect x="43" y="57" width="129" height="23.5" rx="12" />
        <rect x="43" y="159.5" width="129" height="23.5" rx="12" />
        <path d="M43 73.25 202.5 156.05V181.15L43 98.35Z" />
        <path d="M43 166.75 202.5 83.95V58.85L43 141.65Z" />
      </g>
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

/** O ícone do app Auto Edit Abrir (o mesmo do .exe). */
function LogoApp({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="pe-app-logo">
      <defs>
        <linearGradient id="peAppGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#peAppGrad)" />
      <path d="M26.6 19.2v25.6L46.2 32z" fill="#fff" />
    </svg>
  );
}

type Estado =
  | { fase: 'escolha' }
  | { fase: 'exportando'; alvo: AlvoDoProjeto; etapa: string; direto: boolean }
  | { fase: 'pronto'; alvo: AlvoDoProjeto; arquivo: string; avisos: string[]; direto: boolean }
  | { fase: 'erro'; alvo: AlvoDoProjeto; msg: string };

const PASSOS: Record<AlvoDoProjeto, string[]> = {
  capcut: [
    'Abra o .zip baixado e extraia (botão direito, Extrair tudo).',
    'Arraste a pasta do projeto pra pasta de rascunhos do CapCut (o PDF dentro mostra onde fica).',
    'Feche e abra o CapCut: o projeto aparece na lista, com tudo em camadas e pastas.',
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
  exportar: (alvo: AlvoDoProjeto, onEtapa: (msg: string) => void, opts?: { job?: string }) => Promise<{ arquivo: string; avisos: string[] }>;
}) {
  const [montado, setMontado] = useState(false);
  const [estado, setEstado] = useState<Estado>({ fase: 'escolha' });
  const [app, setApp] = useState<MarcaDoApp | null>(null);
  const [baixouApp, setBaixouApp] = useState(false);
  const ocupado = estado.fase === 'exportando';

  useEffect(() => {
    setMontado(true);
    setApp(lerMarca());
    // DETECÇÃO AUTOMÁTICA: o instalador abre /abrir-projeto?instalado=1, que
    // grava a marca — o `storage` chega nesta aba na hora; e ao voltar pra
    // aba (foco) relê, pro caso de a marca ter vindo de outra janela.
    const reler = () => setApp(lerMarca());
    const aoMudar = (e: StorageEvent) => { if (e.key === null || e.key === CHAVE_DA_MARCA) reler(); };
    window.addEventListener('storage', aoMudar);
    window.addEventListener('focus', reler);
    return () => {
      window.removeEventListener('storage', aoMudar);
      window.removeEventListener('focus', reler);
    };
  }, []);
  useEffect(() => travarScrollDaPagina(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar, ocupado]);

  if (!montado) return null;

  const direto = abrirDiretoLigado(app);

  const ir = async (alvo: AlvoDoProjeto) => {
    // ABRIR DIRETO: o link do app sai AQUI, ainda dentro do clique — o Chrome
    // só abre app do PC com gesto do usuário. O app espera o .zip chegar.
    let job: string | undefined;
    if (direto) {
      job = novoJob();
      chamarApp(linkDoPedido({ alvo, job, zip: nomeDoZip(nomeAd, alvo), t: Date.now() }));
    }
    const comApp = !!job;
    setEstado({ fase: 'exportando', alvo, etapa: 'preparando o pacote', direto: comApp });
    try {
      const r = await exportar(alvo, (etapa) => setEstado((e) => (e.fase === 'exportando' ? { ...e, etapa } : e)), { job });
      setEstado({ fase: 'pronto', alvo, arquivo: r.arquivo, avisos: r.avisos, direto: comApp });
    } catch (e) {
      setEstado({ fase: 'erro', alvo, msg: (e as Error)?.message || 'Não consegui montar o projeto.' });
    }
  };

  const alternar = () => {
    ligarAbrirDireto(!direto);
    setApp(lerMarca());
  };
  const jaTenho = () => { marcarInstalado(); setApp(lerMarca()); };

  const nomeDoAlvo = (a: AlvoDoProjeto) => (a === 'capcut' ? 'CapCut' : 'Premiere Pro');
  const nomeCurto = (a: AlvoDoProjeto) => (a === 'capcut' ? 'CapCut' : 'Premiere');
  const Logo = ({ a, size }: { a: AlvoDoProjeto; size?: number }) => (a === 'capcut' ? <LogoCapCut size={size} /> : <LogoPremiere size={size} />);

  return createPortal(
    <div className="lz-camada" role="dialog" aria-modal="true" aria-label="Projeto editável">
      <div className="lz-veu" onClick={() => { if (!ocupado) onFechar(); }} aria-hidden />
      <div className="lz-janela pe-janela">
        <div className="lz-cab">
          <span className="lz-cab-textos">
            <span className="lz-titulo">Projeto editável</span>
            <span className="lz-sub">{nomeAd}: avatar, b-rolls, transições, legenda, SFX e trilha, cada um na sua camada e em pastas.</span>
          </span>
          <button type="button" className="lz-x" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        {estado.fase === 'escolha' ? (
          <>
            <div className="pe-escolhas">
              {(['capcut', 'premiere'] as const).map((a) => (
                <button key={a} type="button" className={`pe-op is-${a}`} onClick={() => void ir(a)}>
                  <span className="pe-op-nucleo">
                    <Logo a={a} />
                    <span className="pe-op-nome">{nomeDoAlvo(a)}</span>
                    <span className="pe-op-dica">
                      {direto
                        ? (a === 'capcut'
                          ? 'Põe o projeto na pasta do CapCut e abre ele direto no editor.'
                          : 'Põe a mídia no lugar e abre o projeto direto no Premiere.')
                        : (a === 'capcut'
                          ? 'A pasta do projeto pronta pra rodar, com um PDF de como abrir.'
                          : 'O arquivo do projeto (XML) com a mídia junto e um PDF de como abrir.')}
                    </span>
                    <span className="pe-op-cta">
                      {direto ? `Abrir no ${nomeCurto(a)}` : 'Baixar'}
                      <span className="pe-op-seta" aria-hidden>
                        {direto ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
                        )}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {app?.instalado ? (
              <div className={`pe-app is-instalado${direto ? ' is-on' : ''}`}>
                <LogoApp />
                <span className="pe-app-txt">
                  <b>Abrir direto no editor</b>
                  <small>{direto ? 'Ligado: o projeto entra sozinho no CapCut ou no Premiere.' : 'Desligado: só baixa a pasta do projeto, com o PDF.'}</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={direto}
                  aria-label="Abrir direto no editor"
                  className={`pe-chave${direto ? ' is-on' : ''}`}
                  onClick={alternar}
                >
                  <i aria-hidden />
                </button>
              </div>
            ) : (
              <div className="pe-app is-baixar">
                <LogoApp />
                <span className="pe-app-txt">
                  <b>Abra direto no editor, sem extrair nada</b>
                  <small>{baixouApp ? 'Abra o .zip baixado e instale: esta janela liga sozinha quando terminar.' : 'Instale o Auto Edit Abrir: 1 minuto, sem administrador.'}</small>
                </span>
                <span className="pe-app-acoes">
                  <button type="button" className="pe-app-btn" onClick={() => { baixarInstalador(); setBaixouApp(true); }}>
                    {baixouApp ? 'Baixar de novo' : 'Baixar o app'}
                  </button>
                  <button type="button" className="pe-app-link" onClick={jaTenho}>já tenho o app</button>
                </span>
              </div>
            )}
          </>
        ) : estado.fase === 'exportando' ? (
          <div className="pe-status">
            <span className="pe-status-logo"><Logo a={estado.alvo} size={44} /></span>
            <span className="pe-status-txt">
              <b>Montando o projeto do {nomeDoAlvo(estado.alvo)}</b>
              <small>{estado.etapa}{estado.direto ? ' · o Auto Edit Abrir já está esperando o pacote' : ''}</small>
            </span>
            <span className="pe-barra" aria-hidden><i /></span>
          </div>
        ) : estado.fase === 'pronto' ? (
          <div className="pe-pronto">
            <div className="pe-status is-pronto">
              <span className="pe-status-logo"><Logo a={estado.alvo} size={44} /></span>
              <span className="pe-status-txt">
                <b>{estado.direto ? `Abrindo no ${nomeDoAlvo(estado.alvo)}` : 'Baixado'}</b>
                <small>{estado.direto ? 'O Auto Edit Abrir copia o projeto, abre o editor e entra nele. Acompanhe no canto da tela.' : estado.arquivo}</small>
              </span>
              <span className="pe-check" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 12.8 5 5L19.5 6.5" /></svg>
              </span>
            </div>
            {estado.direto ? (
              <>
                <p className="pe-dica">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.01" /></svg>
                  <span>Na 1ª vez, o Chrome pergunta: marque <b>Sempre permitir</b> e clique em <b>Abrir</b>.</span>
                </p>
                <details className="pe-avisos pe-plano-b">
                  <summary>Não abriu sozinho?</summary>
                  <ol className="pe-passos">
                    {PASSOS[estado.alvo].map((p, i) => (
                      <li key={i}><span className="pe-passo-n">{i + 1}</span>{p}</li>
                    ))}
                  </ol>
                  <p className="pe-nota">
                    O .zip ({estado.arquivo}) está nos seus downloads. Se o app foi desinstalado,{' '}
                    <button type="button" className="pe-app-link" onClick={() => baixarInstalador()}>baixe de novo</button>.
                  </p>
                </details>
              </>
            ) : (
              <ol className="pe-passos">
                {PASSOS[estado.alvo].map((p, i) => (
                  <li key={i}><span className="pe-passo-n">{i + 1}</span>{p}</li>
                ))}
              </ol>
            )}
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
              {estado.fase === 'pronto' && estado.direto ? 'abrir no outro editor' : 'baixar o outro'}
            </button>
          ) : <span />}
          {estado.fase === 'pronto' ? (
            <button type="button" className="lz-ok" onClick={onFechar}>Fechar</button>
          ) : (
            <button type="button" className="lz-padrao" onClick={onFechar} disabled={ocupado}>
              {estado.fase === 'erro' ? 'fechar' : 'cancelar'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
