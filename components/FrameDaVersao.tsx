'use client';

/**
 * FRAME DE UMA VERSAO (modo imagem) — 30.08.
 *
 * No modo imagem o AD nao tem avatar de biblioteca: o que identifica a pessoa
 * e' a FOTO. Entao "+ versoes" aqui troca o FRAME, nao o avatar — e a regra de
 * custo continua a mesma das versoes com avatar: campo vazio = usa o frame da
 * versao 1 e nao gasta geracao; frame proprio = aquela versao gera de novo.
 *
 * Um so' lugar pro desenho, usado pela versao 2 (YouTube) e pelas 3..10.
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
  /** nome editavel da versao — so' as extras (3..10) tem */
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
            className="mono w-[120px] rounded border border-line bg-bg/60 px-1.5 py-[1px] text-[10px] normal-case tracking-normal text-text focus:border-red-400/60 focus:outline-none"
            title="Nome desta versão"
          />
        ) : null}
        <span className="font-normal normal-case tracking-normal text-text-muted">
          {temFrame ? '— gera de novo' : avisoEscolha || '— vazio: usa o frame da versão 1 (sem custo)'}
        </span>
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
      <div
        className={
          'flex max-w-[420px] items-center gap-2.5 rounded-[12px] border p-2 transition-colors ' +
          (temFrame
            ? 'border-red-400/45 bg-red-500/[0.07]'
            : 'border-line bg-bg-soft/40')
        }
      >
        {temFrame ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageDataUrl || ''}
            alt={imageName || 'frame'}
            className="h-[58px] w-[33px] shrink-0 rounded-[6px] border border-white/15 object-cover"
          />
        ) : (
          <div className="flex h-[58px] w-[33px] shrink-0 items-center justify-center rounded-[6px] border border-dashed border-line text-[14px] text-text-muted/50">
            ▣
          </div>
        )}
        <div className="min-w-0 flex-1">
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
            {temFrame ? 'trocar frame' : 'escolher frame'}
          </label>
          <div className="mt-1 truncate text-[9.5px] leading-tight text-text-muted" title={imageName || ''}>
            {imageName || 'JPEG, PNG ou WebP · até 8MB · 9:16'}
          </div>
        </div>
        {temFrame ? (
          <button
            type="button"
            onClick={onLimpar}
            className="shrink-0 rounded-full border border-line px-2 py-1 text-[11px] leading-none text-text-muted transition-colors hover:border-red-500/60 hover:text-red-500"
            title="Tirar o frame — esta versão volta a usar o da versão 1"
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
