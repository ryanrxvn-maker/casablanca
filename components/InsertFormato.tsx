'use client';

/**
 * FORMATO DO INSERT (07.10) — tela cheia, as telas divididas e o React, cada
 * um com a MINIATURA desenhada do que vai sair na tela. Silas: *"todos os
 * tipos de tela dividida têm preview pro usuário entender que tela dividida é
 * aquela"*.
 *
 * O mesmo seletor serve a janela de Inserts do PC e a integração StockFrame —
 * um só desenho, uma só regra. A miniatura sai do MESMO `palcoDoLayout` que o
 * render usa: o que o editor vê aqui é a geometria real do vídeo.
 *
 * O CSS mora em globals.css (`.fi-*`): a janela de Inserts vive em portal e
 * styled-jsx/CSS module não atravessa.
 */

import { useId } from 'react';
import {
  LINHA_CORES,
  LINHA_COR_PADRAO,
  palcoDoLayout,
  type LayoutInsert,
  type TipoTransicao,
} from '@/lib/pilot-inserts';

export type FormatoId = LayoutInsert['tipo'];

export const FORMATOS: Array<{ id: FormatoId; nome: string; dica: string }> = [
  { id: 'cheia', nome: 'Tela cheia', dica: 'O take cobre a tela inteira; o avatar só se ouve.' },
  { id: 'faixas', nome: 'Dividida', dica: 'Meio a meio, emenda reta: avatar numa metade, take na outra.' },
  { id: 'cards', nome: 'Arredondada', dica: 'Dois cards com cantos arredondados e respiro entre eles.' },
  { id: 'linha', nome: 'Com linha', dica: 'Meio a meio com uma linha colorida marcando a emenda.' },
  { id: 'mescla', nome: 'Mescla', dica: 'O take some em degradê por cima do fundo do avatar e parece um vídeo só.' },
  { id: 'react', nome: 'React', dica: 'Take em tela cheia e o avatar SEM FUNDO pequeno no canto de baixo.' },
];

export const TRANSICOES_INSERT: Array<{ v: TipoTransicao; nome: string; dica: string }> = [
  { v: 'nenhuma', nome: 'Seco', dica: 'Corte seco, sem flash.' },
  { v: 'escurecer', nome: 'Escurecer', dica: 'Mergulho rápido no preto na troca.' },
  { v: 'luz', nome: 'Luz', dica: 'Clarão branco na troca.' },
  { v: 'luz-vermelha', nome: 'Luz vermelha', dica: 'Clarão quente avermelhado na troca.' },
  { v: 'piscar', nome: 'Piscar', dica: 'Um olho piscando: fecha no corte e abre no take novo. Casa com o clique do mouse do Smart SFX.' },
  { v: 'misto', nome: 'Misto', dica: 'Alterna escurecer e luz ao longo do AD.' },
];

const NOME_COR: Record<string, string> = {
  '#22e06b': 'verde',
  '#ffffff': 'branca',
  '#ff2d3d': 'vermelha',
  '#ffd60a': 'amarela',
};

/** Leva o layout atual pra outro formato SEM perder o que já foi escolhido
 *  (avatar em cima/embaixo, lado do React, cor da linha). */
export function layoutNoFormato(atual: LayoutInsert, formato: FormatoId): LayoutInsert {
  const avatar = 'avatar' in atual ? atual.avatar : 'cima';
  switch (formato) {
    case 'cheia': return { tipo: 'cheia' };
    case 'faixas': return { tipo: 'faixas', avatar };
    case 'cards': return { tipo: 'cards', avatar };
    case 'linha': return { tipo: 'linha', avatar, cor: atual.tipo === 'linha' && atual.cor ? atual.cor : LINHA_COR_PADRAO };
    case 'mescla': return { tipo: 'mescla', avatar };
    case 'react': return { tipo: 'react', lado: atual.tipo === 'react' ? atual.lado : 'direita' };
  }
}

/* ═══════════════════════ miniatura de um formato ═════════════════════════ */

/** Silhueta do avatar (cabeça + ombros) com o rosto em (cx, cy). */
function Silhueta({ cx, cy, r, classe }: { cx: number; cy: number; r: number; classe: string }) {
  return (
    <g className={classe}>
      <circle cx={cx} cy={cy} r={r} />
      <path d={`M${cx - r * 2.3} ${cy + r * 4.2} C${cx - r * 2.3} ${cy + r * 1.6} ${cx + r * 2.3} ${cy + r * 1.6} ${cx + r * 2.3} ${cy + r * 4.2} Z`} />
    </g>
  );
}

/** Um "take" de mentira: céu, morro e sol — lê como imagem, não como bloco. */
function TakeFake({ x, y, w, h, raio, clipId }: { x: number; y: number; w: number; h: number; raio: number; clipId: string }) {
  return (
    <g clipPath={`url(#${clipId})`}>
      <rect x={x} y={y} width={w} height={h} className="fi-mq-take" />
      <circle cx={x + w * 0.72} cy={y + h * 0.3} r={Math.min(w, h) * 0.1} className="fi-mq-sol" />
      <path d={`M${x} ${y + h} L${x + w * 0.34} ${y + h * 0.55} L${x + w * 0.58} ${y + h * 0.8} L${x + w * 0.78} ${y + h * 0.62} L${x + w} ${y + h * 0.9} L${x + w} ${y + h} Z`} className="fi-mq-morro" />
      <rect x={x} y={y} width={w} height={h} rx={raio} className="fi-mq-take-borda" />
    </g>
  );
}

export function MaqueteFormato({ layout, ativo, tamanho = 'normal' }: { layout: LayoutInsert; ativo?: boolean; tamanho?: 'normal' | 'mini' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const W = 54;
  const H = 96;
  const p = palcoDoLayout(layout, W, H);
  const r = p.raio > 0 ? 4 : 0;
  const clipTake = `fi-take-${uid}`;
  const degrade = `fi-deg-${uid}`;
  const mascara = `fi-msk-${uid}`;
  const ri = p.insert;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={'fi-maquete' + (ativo ? ' is-on' : '') + (tamanho === 'mini' ? ' is-mini' : '')}
      aria-hidden
    >
      <defs>
        <clipPath id={clipTake}>
          <rect x={ri.x} y={ri.y} width={ri.w} height={ri.h} rx={r} />
        </clipPath>
        {p.degrade ? (
          <>
            <linearGradient id={degrade} gradientUnits="userSpaceOnUse" x1="0" y1={p.degrade.opaco} x2="0" y2={p.degrade.some}>
              <stop offset="0" stopColor="#fff" stopOpacity="1" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id={mascara} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
              <rect x="0" y="0" width={W} height={H} fill={`url(#${degrade})`} />
            </mask>
          </>
        ) : null}
      </defs>
      <rect x="0" y="0" width={W} height={H} rx="5" className="fi-mq-fundo" />

      {/* avatar no retângulo dele (divididas e mescla) */}
      {p.avatar && !p.react ? (
        <>
          <rect x={p.avatar.x} y={p.avatar.y} width={p.avatar.w} height={p.avatar.h} rx={r} className="fi-mq-avatar" />
          <Silhueta
            cx={p.avatar.x + p.avatar.w * p.rostoAlvo.x}
            cy={p.avatar.y + p.avatar.h * p.rostoAlvo.y}
            r={p.degrade ? 6.5 : 5.2}
            classe="fi-mq-pessoa"
          />
        </>
      ) : null}

      {/* o take */}
      {p.degrade ? (
        <g mask={`url(#${mascara})`}>
          <TakeFake x={ri.x} y={ri.y} w={ri.w} h={ri.h} raio={0} clipId={clipTake} />
        </g>
      ) : (
        <TakeFake x={ri.x} y={ri.y} w={ri.w} h={ri.h} raio={r} clipId={clipTake} />
      )}

      {/* linha colorida da emenda */}
      {p.linha ? <rect x={p.linha.x} y={p.linha.y - 0.4} width={p.linha.w} height={Math.max(1.8, p.linha.h + 0.8)} fill={p.linha.cor} /> : null}

      {/* React: o avatar sem fundo, no canto de baixo */}
      {p.react ? (
        <Silhueta cx={p.react.rosto.x} cy={p.react.rosto.y} r={6.2} classe="fi-mq-pessoa is-react" />
      ) : null}
    </svg>
  );
}

/* ═══════════════════════ seletor de formato ══════════════════════════════ */

export function SeletorDeFormato({
  layout,
  onMudar,
  compacto,
}: {
  layout: LayoutInsert;
  onMudar: (l: LayoutInsert) => void;
  /** grade menor (StockFrame) */
  compacto?: boolean;
}) {
  const atual = FORMATOS.find((f) => f.id === layout.tipo) || FORMATOS[0];
  return (
    <div className={'fi-seletor' + (compacto ? ' is-compacto' : '')}>
      <div className="fi-grade" role="radiogroup" aria-label="Formato da tela">
        {FORMATOS.map((f) => {
          const alvo = layoutNoFormato(layout, f.id);
          const on = layout.tipo === f.id;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={'fi-op' + (on ? ' is-on' : '')}
              onClick={() => { if (!on) onMudar(alvo); }}
              title={f.dica}
              data-formato={f.id}
            >
              <MaqueteFormato layout={on ? layout : alvo} ativo={on} />
              <span className="fi-op-nome">{f.nome}</span>
            </button>
          );
        })}
      </div>
      <p className="fi-dica">{atual.dica}</p>

      {/* opções do formato escolhido */}
      {'avatar' in layout ? (
        <div className="fi-linha-op">
          <span className="fi-rot">Avatar</span>
          <div className="fi-seg">
            {(['cima', 'baixo'] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                className={'fi-seg-item' + (layout.avatar === pos ? ' is-on' : '')}
                onClick={() => onMudar({ ...layout, avatar: pos } as LayoutInsert)}
              >
                {pos === 'cima' ? 'Em cima' : 'Embaixo'}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {layout.tipo === 'react' ? (
        <div className="fi-linha-op">
          <span className="fi-rot">Avatar no canto</span>
          <div className="fi-seg">
            {(['esquerda', 'direita'] as const).map((lado) => (
              <button
                key={lado}
                type="button"
                className={'fi-seg-item' + (layout.lado === lado ? ' is-on' : '')}
                onClick={() => onMudar({ tipo: 'react', lado })}
              >
                {lado === 'esquerda' ? 'Esquerdo' : 'Direito'}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {layout.tipo === 'linha' ? (
        <div className="fi-linha-op">
          <span className="fi-rot">Cor da linha</span>
          <div className="fi-cores">
            {LINHA_CORES.map((cor) => (
              <button
                key={cor}
                type="button"
                className={'fi-cor' + ((layout.cor || LINHA_COR_PADRAO).toLowerCase() === cor ? ' is-on' : '')}
                style={{ background: cor }}
                onClick={() => onMudar({ ...layout, cor })}
                aria-label={`Linha ${NOME_COR[cor] || cor}`}
                title={`Linha ${NOME_COR[cor] || cor}`}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════ seletor de transição ════════════════════════════ */

export function SeletorDeTransicao({ valor, onMudar }: { valor: TipoTransicao; onMudar: (t: TipoTransicao) => void }) {
  return (
    <div className="fi-seg fi-seg-trans" role="radiogroup" aria-label="Transição">
      {TRANSICOES_INSERT.map((t) => (
        <button
          key={t.v}
          type="button"
          role="radio"
          aria-checked={valor === t.v}
          className={'fi-seg-item' + (valor === t.v ? ' is-on' : '')}
          onClick={() => onMudar(t.v)}
          title={t.dica}
        >
          <span className={`fi-amostra is-${t.v}`} aria-hidden />
          {t.nome}
        </button>
      ))}
    </div>
  );
}
