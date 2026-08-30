'use client';

/**
 * PREVIEW DEV-ONLY dos modelos novos do FakePrint (30.08) — Zoom (reunião +
 * apresentando), CBS News (nacional + New York) e o balão de resposta de
 * comentário do TikTok. Existe pra ENXERGAR os palcos sem passar pelo login;
 * fora do dev responde 404. Não é linkada de lugar nenhum.
 */

import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import ZOOM from '@/app/tools/fakepass/model-zoom';
import NEWS_CBS from '@/app/tools/fakepass/model-news-cbs';
import TIKTOK_REPLY from '@/app/tools/fakepass/model-tiktok-reply';
import { defaultStatus, type FakeModel } from '@/app/tools/fakepass/shared';

const [zoom] = ZOOM;
// o array mistura dois estados diferentes → afrouxa pro preview de olho humano
const [cbsNat, cbsNy] = NEWS_CBS as Array<FakeModel<any>>;
const [ttReply] = TIKTOK_REPLY;

function Bloco({ id, only, titulo, children }: { id: string; only: string; titulo: string; children: React.ReactNode }) {
  if (only && only !== id) return null;
  return (
    <div style={{ marginBottom: 40 }}>
      <h2 style={{ color: '#fff', fontSize: 14, fontWeight: 700, margin: '0 0 10px' }}>{titulo}</h2>
      <div style={{ display: 'inline-block', outline: '1px solid #333' }}>{children}</div>
    </div>
  );
}

export default function FakepassPreviewDev() {
  // ?only=<id> mostra UMA seção (facilita screenshot sem scroll)
  const [only, setOnly] = useState('');
  useEffect(() => {
    setOnly(new URLSearchParams(window.location.search).get('only') || '');
  }, []);
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <div style={{ background: '#0a0a0c', minHeight: '100vh', padding: 24 }}>
      <Bloco id="zoom-dark" only={only} titulo="Zoom — reunião (grade, tiles escuros com inicial)">
        {zoom.Preview({ s: { ...zoom.defaultState, vazioVerde: false }, status: defaultStatus })}
      </Bloco>
      <Bloco id="zoom-verde" only={only} titulo="Zoom — reunião (grade, tela verde)">
        {zoom.Preview({ s: zoom.defaultState, status: defaultStatus })}
      </Bloco>
      <Bloco id="zoom-share" only={only} titulo="Zoom — apresentando (EN)">
        {zoom.Preview({ s: { ...zoom.defaultState, mode: 'share', idioma: 'en', vazioVerde: false }, status: defaultStatus })}
      </Bloco>
      <Bloco id="cbs-nat" only={only} titulo="CBS News — nacional (sem manchete, igual à referência)">
        {cbsNat.Preview({ s: { ...cbsNat.defaultState, bgMode: 'solid' }, status: defaultStatus })}
      </Bloco>
      <Bloco id="cbs-manchete" only={only} titulo="CBS News — nacional (com kicker + manchete)">
        {cbsNat.Preview({
          s: { ...cbsNat.defaultState, bgMode: 'solid', kicker: 'EYE ON AMERICA', headline: 'Desperation in Mariupol as officials respond to the crisis' },
          status: defaultStatus,
        })}
      </Bloco>
      <Bloco id="cbs-ny" only={only} titulo="CBS News — New York (local)">
        {cbsNy.Preview({ s: { ...cbsNy.defaultState, bgMode: 'solid' }, status: defaultStatus })}
      </Bloco>
      <Bloco id="tt-claro" only={only} titulo="TikTok — balão de resposta (claro)">
        {ttReply.Preview({ s: ttReply.defaultState, status: defaultStatus })}
      </Bloco>
      <Bloco id="tt-escuro" only={only} titulo="TikTok — balão de resposta (escuro)">
        {ttReply.Preview({ s: { ...ttReply.defaultState, dark: true, bg: '#4aa0e6' }, status: defaultStatus })}
      </Bloco>
    </div>
  );
}
