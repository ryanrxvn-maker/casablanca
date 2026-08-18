'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Botão "Conectar HeyGen" — login pelo device flow, dentro do app.
 *
 * Substitui o ritual antigo: abrir terminal → `heygen auth login --oauth` →
 * achar ~/.heygen/credentials → copiar o refresh_token na mão → colar em
 * /configuracoes/api. Aqui é: clicar, ler 8 caracteres, aprovar no HeyGen.
 *
 * ⚠ E ataca a causa RAIZ de o login viver quebrando: o refresh do HeyGen é de
 * uso único e rotaciona, então CLI e app segurando a MESMA corrente se matam —
 * quem renova primeiro invalida a cópia do outro. Este botão dá ao app uma
 * corrente PRÓPRIA, que o CLI não toca.
 *
 * O relógio do poll roda em Worker: a aprovação acontece em OUTRA aba (o caso
 * normal), esta fica oculta, e o Chrome estrangularia o setTimeout pra ~1x/min
 * — o login já estaria aprovado e a tela levaria um minuto pra perceber.
 */

type Estado =
  | { fase: 'parado' }
  | { fase: 'aguardando'; codigo: string; url: string }
  | { fase: 'conectado'; conta: string | null }
  | { fase: 'erro'; mensagem: string };

function criarRelogio(): { esperar: (ms: number) => Promise<void>; fechar: () => void } {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return { esperar: (ms) => new Promise((r) => setTimeout(r, ms)), fechar: () => {} };
  }
  let w: Worker | null = null;
  try {
    const url = URL.createObjectURL(
      new Blob(['onmessage=e=>setTimeout(()=>postMessage(1),e.data)'], { type: 'text/javascript' }),
    );
    w = new Worker(url);
    URL.revokeObjectURL(url);
  } catch {
    w = null;
  }
  const worker = w;
  return {
    esperar: (ms) =>
      worker
        ? new Promise<void>((resolve) => {
            const fim = () => {
              worker.removeEventListener('message', fim);
              resolve();
            };
            worker.addEventListener('message', fim);
            worker.postMessage(ms);
          })
        : new Promise((r) => setTimeout(r, ms)),
    fechar: () => worker?.terminate(),
  };
}

export function HeyGenConectar({ compacto }: { compacto?: boolean }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'parado' });
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const cancelado = useRef(false);

  useEffect(
    () => () => {
      cancelado.current = true;
    },
    [],
  );

  const acompanhar = useCallback(async (handle: string, intervaloSeg: number) => {
    const relogio = criarRelogio();
    let intervalo = Math.max(3, intervaloSeg) * 1000;
    // O código do HeyGen vale 10min; paramos junto com ele em vez de bater no
    // servidor pra sempre depois de o usuário desistir.
    const limite = Date.now() + 10 * 60 * 1000;
    try {
      while (!cancelado.current && Date.now() < limite) {
        await relogio.esperar(intervalo);
        if (cancelado.current) return;
        let j: { estado?: string; conta?: string | null; devagar?: boolean; error?: string } | null = null;
        try {
          const r = await fetch('/api/heygen/oauth/device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ handle }),
          });
          j = await r.json().catch(() => null);
          if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        } catch (e) {
          // Falha de rede não cancela o login: o código continua valendo lá.
          if (Date.now() >= limite) {
            setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Falhou.' });
            return;
          }
          continue;
        }
        // `slow_down` é o servidor pedindo pra afrouxar. Ignorar isso faz ele
        // começar a recusar as consultas.
        if (j?.devagar) intervalo += 2000;
        if (j?.estado === 'conectado') {
          setEstado({ fase: 'conectado', conta: j.conta ?? null });
          return;
        }
        if (j?.estado === 'expirou') {
          setEstado({ fase: 'erro', mensagem: 'O código expirou. Clique de novo pra gerar outro.' });
          return;
        }
        if (j?.estado === 'negado') {
          setEstado({ fase: 'erro', mensagem: 'O acesso foi recusado no HeyGen.' });
          return;
        }
      }
      if (!cancelado.current) {
        setEstado({ fase: 'erro', mensagem: 'O código expirou. Clique de novo pra gerar outro.' });
      }
    } finally {
      relogio.fechar();
    }
  }, []);

  const comecar = async () => {
    setOcupado(true);
    setCopiado(false);
    try {
      const r = await fetch('/api/heygen/oauth/device', { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.codigo) throw new Error(j?.error || `HTTP ${r.status}`);
      setEstado({ fase: 'aguardando', codigo: j.codigo, url: j.url });
      // Abre a página de aprovação junto: um clique a menos e ninguém precisa
      // decorar a URL. Se o browser bloquear o popup, o link fica na tela.
      window.open(j.url, '_blank', 'noopener');
      void acompanhar(j.handle, j.intervalo);
    } catch (e) {
      setEstado({
        fase: 'erro',
        mensagem: e instanceof Error ? e.message : 'Não consegui abrir o login.',
      });
    } finally {
      setOcupado(false);
    }
  };

  if (estado.fase === 'conectado') {
    return (
      <div className="mt-2 rounded-[10px] border border-emerald-400/45 bg-emerald-400/10 px-3 py-2 text-[12.5px] text-emerald-100">
        <b>HeyGen conectado{estado.conta ? ` como ${estado.conta}` : ''}.</b>{' '}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="underline underline-offset-2"
        >
          Recarregar a página
        </button>{' '}
        pra usar agora.
      </div>
    );
  }

  if (estado.fase === 'aguardando') {
    return (
      <div className="mt-2 rounded-[10px] border border-line/60 bg-bg/50 px-3 py-2.5">
        <p className="text-[12.5px]">
          Abra{' '}
          <a
            href={estado.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            {estado.url.replace(/^https?:\/\//, '')}
          </a>{' '}
          e digite este código:
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="mono rounded-[8px] border border-line px-3 py-1.5 text-[18px] font-bold tracking-[0.18em]">
            {estado.codigo}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(estado.codigo).then(() => setCopiado(true));
            }}
            className="rounded-[8px] border border-line/60 px-2.5 py-1.5 text-[12px] hover:border-line"
          >
            {copiado ? 'copiado' : 'copiar'}
          </button>
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" />
          <span className="text-[12px] text-text-dim">esperando você aprovar…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={comecar}
        disabled={ocupado}
        className="rounded-[10px] bg-text px-3.5 py-2 text-[13px] font-bold text-bg transition hover:opacity-90 disabled:opacity-40"
      >
        {ocupado ? 'abrindo…' : 'Conectar HeyGen agora'}
      </button>
      {!compacto ? (
        <p className="mt-1.5 text-[11.5px] text-text-dim">
          Abre o HeyGen, você aprova com um código e pronto — sem terminal e sem copiar
          arquivo. O app passa a ter o login dele, que o CLI não derruba.
        </p>
      ) : null}
      {estado.fase === 'erro' ? (
        <p className="mt-1.5 text-[12px] text-red-300">{estado.mensagem}</p>
      ) : null}
    </div>
  );
}
