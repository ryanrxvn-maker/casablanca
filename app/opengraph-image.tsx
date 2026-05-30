import { ImageResponse } from 'next/og';

/**
 * Card social (1200x630) gerado dinamicamente — aparece ao compartilhar o
 * link no WhatsApp, Instagram, X, etc. Next usa automaticamente como
 * og:image e twitter:image.
 */
export const runtime = 'edge';
export const alt = 'Auto Edit — Automação de edição de vídeo com IA';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 90,
          background:
            'linear-gradient(135deg, var(--card-deep) 0%, rgb(var(--bg-softer)) 60%, var(--card-deep) 100%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 30,
            color: '#a78bfa',
            letterSpacing: 10,
            fontWeight: 700,
          }}
        >
          AUTO EDIT
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 82,
            color: '#ffffff',
            fontWeight: 800,
            lineHeight: 1.05,
            marginTop: 26,
            maxWidth: 1000,
          }}
        >
          Edição de vídeo no automático.
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 34,
            color: '#a6a6b2',
            marginTop: 26,
            maxWidth: 940,
          }}
        >
          Decupagem, B-roll, lipsync e legendas — ligue a fila e vá dormir.
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            marginTop: 52,
          }}
        >
          <div
            style={{
              display: 'flex',
              height: 10,
              width: 130,
              background: '#c8ff00',
              borderRadius: 5,
            }}
          />
          <div style={{ display: 'flex', fontSize: 28, color: '#67e8f9' }}>
            darkoautoedit.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
