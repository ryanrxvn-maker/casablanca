'use client';

// ERROR BOUNDARY do ClickUp Pilot — rede de segurança pra que um erro de render de
// QUALQUER componente NÃO derrube a ferramenta inteira numa tela branca genérica
// ("Application error: a client-side exception has occurred"). Em vez disso, mostra um
// card recuperável com a mensagem real do erro + botões de recuperação. Os disparos
// ficam salvos (localStorage/IndexedDB), então recarregar reidrata tudo — nada é perdido.
// Ver [[feedback_blindagem_fluxos]] (nenhum dead-end; sempre um caminho de recuperação).

import { useEffect } from 'react';

export default function ClickupPilotError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log completo pro console (diagnóstico). Em produção a stack vem minificada, mas
    // o `digest` correlaciona com os logs do servidor da Vercel.
    console.error('[clickup-pilot] erro de render capturado pelo boundary:', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '70vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          borderRadius: 18,
          border: '1px solid rgba(244,63,94,0.35)',
          background: 'linear-gradient(135deg, rgba(30,30,40,0.95), rgba(20,20,28,0.95))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 80px rgba(0,0,0,0.6)',
          padding: 24,
          color: '#fff',
          fontFamily: 'var(--font-tech, ui-sans-serif, system-ui, sans-serif)',
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(244,63,94,0.85)' }}>
          Erro na ferramenta
        </div>
        <h2 style={{ margin: '6px 0 10px', fontSize: 18, fontWeight: 700 }}>Algo quebrou nessa tela</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.75)' }}>
          A ferramenta encontrou um erro inesperado — mas <strong>seus disparos estão salvos</strong>{' '}
          (fila, planos e vídeos ficam no seu navegador). Clique em <strong>Tentar de novo</strong>; se
          persistir, <strong>Recarregar a página</strong> reidrata tudo do ponto certo. Nada foi perdido.
        </p>

        <pre
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: 11,
            color: 'rgba(255,180,180,0.9)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          }}
        >
          {(error?.message || 'Erro desconhecido')}{error?.digest ? `\n(ref: ${error.digest})` : ''}
        </pre>

        <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => { try { window.location.reload(); } catch {} }}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'transparent',
              color: 'rgba(255,255,255,0.75)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              cursor: 'pointer',
            }}
          >
            Recarregar a página
          </button>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              border: '1px solid rgba(34,211,238,0.55)',
              background: 'linear-gradient(180deg, rgba(34,211,238,0.25), rgba(34,211,238,0.05))',
              color: '#cffafe',
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              cursor: 'pointer',
            }}
          >
            Tentar de novo
          </button>
        </div>
      </div>
    </div>
  );
}
