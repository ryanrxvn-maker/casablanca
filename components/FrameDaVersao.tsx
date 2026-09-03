'use client';

/**
 * FRAME DE UMA VERSAO (modo imagem) — 30.08 · redesenho 03.09.
 *
 * No modo imagem o AD nao tem avatar de biblioteca: o que identifica a pessoa
 * e' a FOTO. Entao "+ versoes" aqui troca o FRAME, nao o avatar — e a regra de
 * custo continua a mesma das versoes com avatar: campo vazio = usa o frame da
 * versao 1 e nao gasta geracao; frame proprio = aquela versao gera de novo.
 *
 * Redesenho 03.09 (Silas: "esse design do trocar frame nao ta legal"): thumb
 * maior, estado por PONTO colorido (sem os textos "— gera de novo"), botao de
 * troca com icone e lixeira de verdade no lugar do "×" solto.
 *
 * Um so' lugar pro desenho, usado pela versao 2 e pelas 3..10.
 */
export function FrameDaVersao({
  titulo,
  nome,
  onRenomear,
  imageDataUrl,
  imageName,
  onArquivo,
  onLimpar,
  onTrocarModo,
  avisoEscolha,
}: {
  titulo: string;
  /** nome editavel da versao */
  nome?: string | null;
  onRenomear?: (v: string) => void;
  imageDataUrl?: string | null;
  imageName?: string | null;
  onArquivo: (f: File) => void;
  onLimpar: () => void;
  /** troca ESTA versao pra escolher AVATAR em vez de frame (icone-only) */
  onTrocarModo?: () => void;
  /** aviso quando a escolha atual e de OUTRO modo (ex.: avatar ja escolhido) */
  avisoEscolha?: string | null;
}) {
  const temFrame = !!imageDataUrl;
  return (
    <div>
      <div className="label-tech mb-1 flex flex-wrap items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] label-versao">
        <span className="text-[11px] leading-none">+</span>
        {titulo}
        {onRenomear ? (
          <input
            type="text"
            value={nome || ''}
            onChange={(e) => onRenomear(e.target.value)}
            placeholder="nome da versão"
            className="mono w-[120px] rounded border border-line bg-bg/60 px-1.5 py-[1px] text-[10px] normal-case tracking-normal text-text focus:border-red-400/60 focus:outline-none"
            title="Nome desta versão"
          />
        ) : null}
        <span
          className={'ver-estado ' + (temFrame ? 'is-gera' : avisoEscolha ? 'is-frame' : 'is-herda')}
          title={temFrame
            ? 'Frame próprio — esta versão gera de novo no HeyGen'
            : avisoEscolha || 'Vazia — usa o frame da versão 1, sem custo'}
          aria-hidden
        />
        {onTrocarModo ? (
          <button
            type="button"
            onClick={onTrocarModo}
            className="ver-modo-btn ml-auto"
            title="Trocar: esta versão escolhe um AVATAR da biblioteca em vez de frame"
            aria-label="Trocar pra avatar"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
            </svg>
          </button>
        ) : null}
      </div>
      <div className={'frame-ver' + (temFrame ? ' is-com-frame' : '')}>
        <label className="frame-ver-thumb" title={temFrame ? 'Clica pra trocar o frame' : 'Clica pra escolher o frame'}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onArquivo(f);
              e.target.value = '';
            }}
            className="hidden"
          />
          {temFrame ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={imageDataUrl || ''} alt={imageName || 'frame'} className="frame-ver-img" />
          ) : (
            <span className="frame-ver-vazio" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-4.5-4.5L7 20" />
              </svg>
            </span>
          )}
          <span className="frame-ver-troca" aria-hidden>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
          </span>
        </label>
        <div className="min-w-0 flex-1">
          <div className="frame-ver-nome" title={imageName || ''}>
            {temFrame ? imageName || 'frame escolhido' : 'Nenhum frame ainda'}
          </div>
          <div className="frame-ver-dica">
            {temFrame ? 'clica na imagem pra trocar' : 'JPEG, PNG ou WebP · até 8MB · 9:16'}
          </div>
        </div>
        {!temFrame ? (
          <label className="frame-ver-btn">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onArquivo(f);
                e.target.value = '';
              }}
              className="hidden"
            />
            escolher
          </label>
        ) : (
          <button
            type="button"
            onClick={onLimpar}
            className="frame-ver-tirar"
            title="Tirar o frame — esta versão volta a usar o da versão 1"
            aria-label="Tirar o frame"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
