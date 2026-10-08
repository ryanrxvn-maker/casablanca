'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ABRIR_VERSAO, baixarInstalador, lerMarca, marcarInstalado } from '@/lib/abrir-projeto';

const PASSOS = [
  ['Baixe e extraia', 'Botão direito no .zip baixado, "Extrair tudo".'],
  ['Abra o instalador', 'Dois cliques em "Instalar Auto Edit Abrir.exe" e clique em Instalar.'],
  ['Pronto', 'No Pilot, "Projeto editável" agora abre direto no CapCut ou no Premiere.'],
] as const;

export function AbrirProjetoCliente() {
  const [instalado, setInstalado] = useState<string | null>(null);
  const [vindoDoApp, setVindoDoApp] = useState(false);
  const [baixou, setBaixou] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('instalado') === '1') {
      // o instalador terminou e abriu esta página: liga o abrir direto neste navegador
      marcarInstalado((q.get('v') || ABRIR_VERSAO).replace(/[^0-9.]/g, '').slice(0, 20) || ABRIR_VERSAO);
      setVindoDoApp(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
    setInstalado(lerMarca()?.versao ?? null);
  }, []);

  return (
    <article className="mx-auto max-w-[820px] px-5 py-12 md:py-16">
      <div className="flex items-center gap-4">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden className="shrink-0 drop-shadow-[0_14px_24px_rgba(124,58,237,0.45)]">
          <defs>
            <linearGradient id="abrirGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#d946ef" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="15" fill="url(#abrirGrad)" />
          <path d="M26.6 19.2v25.6L46.2 32z" fill="#fff" />
        </svg>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet" style={{ fontFamily: 'var(--font-tech)' }}>
            App para Windows
          </p>
          <h1 className="text-[30px] font-extrabold tracking-tight text-white md:text-[38px]">Auto Edit Abrir</h1>
        </div>
      </div>

      <p className="mt-5 max-w-[640px] text-[16px] leading-relaxed text-text-muted">
        Com ele instalado, o botão <b className="text-white">Projeto editável</b> do Pilot abre o projeto direto no CapCut ou no
        Premiere, já dentro dele e com tudo organizado em pastas: sem extrair zip e sem procurar pasta.
      </p>

      {vindoDoApp || instalado ? (
        <div className="mt-8 flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-5">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400 text-[#052e12]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 12.8 5 5L19.5 6.5" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-white">{vindoDoApp ? 'Instalado. Abrir direto ligado neste navegador.' : `Abrir direto ligado neste navegador (versão ${instalado}).`}</p>
            <p className="text-[13px] text-text-muted">
              No Pilot, clique em Projeto editável e escolha o editor. Na 1ª vez o Chrome pergunta “Abrir Auto Edit Abrir?”: marque “Sempre permitir” e clique em Abrir.
            </p>
          </div>
          <Link href="/tools/clickup-pilot" className="btn-primary">Voltar pro Pilot</Link>
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => { baixarInstalador(); setBaixou(true); }}
          className="rounded-full px-6 py-3 text-[15px] font-extrabold text-white shadow-[0_16px_34px_-16px_rgba(217,70,239,0.9)] transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #a78bfa, #d946ef)' }}
        >
          {baixou ? 'Baixando…' : 'Baixar o Auto Edit Abrir'}
        </button>
        <span className="text-[13px] text-text-muted">Windows 10 e 11 · versão {ABRIR_VERSAO} · menos de 100 KB · grátis</span>
      </div>

      <ol className="mt-10 grid gap-3 md:grid-cols-3">
        {PASSOS.map(([titulo, texto], i) => (
          <li key={titulo} className="rounded-2xl border border-line/60 bg-white/5 p-5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet/20 text-[13px] font-extrabold text-violet">{i + 1}</span>
            <p className="mt-3 text-[15px] font-bold text-white">{titulo}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-text-muted">{texto}</p>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="text-[17px] font-bold text-white">O aviso azul do Windows</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
            Na primeira vez, o Windows pode mostrar “O Windows protegeu o computador”. Isso aparece com todo programa novo que ainda
            não tem certificado de editor; clique em <b className="text-white">Mais informações</b> e depois em{' '}
            <b className="text-white">Executar assim mesmo</b>. Só acontece na instalação.
          </p>
        </section>
        <section>
          <h2 className="text-[17px] font-bold text-white">O que ele faz (e o que não faz)</h2>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-text-muted">
            <li>Só roda quando você clica no Pilot: não fica ligado nem inicia com o Windows.</li>
            <li>Instala só no seu usuário, sem pedir administrador.</li>
            <li>Copia o projeto pra pasta de rascunhos do CapCut (ou C:\AUTOEDIT, no Premiere) e abre o editor.</li>
            <li>Desinstalar: Configurações do Windows, Apps, Auto Edit Abrir.</li>
          </ul>
        </section>
      </div>
    </article>
  );
}
