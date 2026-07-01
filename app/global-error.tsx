'use client';

// GLOBAL ERROR BOUNDARY — rede de segurança FINAL do SaaS inteiro. Só dispara quando um
// erro escapa de todos os boundaries de segmento (ex: erro no layout raiz). Substitui o
// layout raiz, então precisa renderizar o próprio <html>/<body>. Converte a tela branca
// genérica ("Application error: a client-side exception") num aviso recuperável.
// Ver [[feedback_blindagem_fluxos]] — nenhum dead-end, sempre um caminho de volta.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error] erro capturado pelo boundary raiz:', error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0b10',
          color: '#fff',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
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
            boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
            padding: 24,
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(244,63,94,0.85)' }}>
            Erro inesperado
          </div>
          <h2 style={{ margin: '6px 0 10px', fontSize: 18, fontWeight: 700 }}>O app encontrou um erro</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.75)' }}>
            Seu trabalho fica salvo no navegador. Clique em <strong>Tentar de novo</strong> ou{' '}
            <strong>Recarregar</strong> — nada foi perdido.
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
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {(error?.message || 'Erro desconhecido')}{error?.digest ? `\n(ref: ${error.digest})` : ''}
          </pre>
          <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { try { window.location.reload(); } catch {} }}
              style={{
                padding: '8px 16px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)',
                background: 'transparent', color: 'rgba(255,255,255,0.75)', fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer',
              }}
            >
              Recarregar
            </button>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '8px 18px', borderRadius: 999, border: '1px solid rgba(34,211,238,0.55)',
                background: 'linear-gradient(180deg, rgba(34,211,238,0.25), rgba(34,211,238,0.05))',
                color: '#cffafe', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.12em', cursor: 'pointer',
              }}
            >
              Tentar de novo
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
