/**
 * O SELO DE AUDITORIA da Decupagem — a prova, em número, de que o corte não
 * encostou em palavra.
 *
 * Por que existe: o motor (lib/speech-detect) reexamina as bordas de cada
 * intervalo antes de remover e recua enquanto o frame ainda parecer fala; se
 * não sobrar pedaço seguro, ele RECUSA o corte. `speechRemovedSec` é a medição
 * do resultado — não a intenção — e por isso sai 0,000. O cliente não precisa
 * acreditar: ele vê o número depois de cada arquivo.
 *
 * Se um dia não sair 0, o selo vira aviso âmbar em vez de sumir. Entregar
 * calado um corte que comeu palavra é o defeito que este componente existe pra
 * tornar impossível.
 */
export type DecupAudit = {
  savedSec: number;
  speechRemovedSec: number;
  refusedCuts: number;
  cuts: number;
  ok: boolean;
};


export function DecupAuditBadge({ audit }: { audit: DecupAudit }) {
  const seg = (v: number) => `${v.toFixed(2).replace('.', ',')}s`;
  // 3 casas SÓ no número da prova: "0,000s" diz "medido e deu zero", enquanto
  // "0,00s" ainda pode ser leitura arredondada de um corte que raspou a palavra.
  const prova = `${audit.speechRemovedSec.toFixed(3).replace('.', ',')}s`;

  if (!audit.ok) {
    return (
      <div className="mb-4 rounded-[14px] border border-amber-400/30 bg-amber-400/[0.07] px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <svg viewBox="0 0 20 20" className="mt-px h-4 w-4 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M10 6.5v4.2M10 13.8h.01" strokeLinecap="round" />
            <path d="M8.7 2.9 1.9 15.1a1.5 1.5 0 0 0 1.3 2.2h13.6a1.5 1.5 0 0 0 1.3-2.2L11.3 2.9a1.5 1.5 0 0 0-2.6 0Z" />
          </svg>
          <div className="text-[12.5px] leading-relaxed text-fg/85">
            <span className="font-medium text-amber-200">Confere esse antes de usar.</span>{' '}
            O corte encostou em {seg(audit.speechRemovedSec)} de fala. Aumenta a tolerância
            de silêncio e roda de novo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-[14px] border border-lime/25 bg-lime/[0.055] px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-lime" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="10" cy="10" r="7.6" className="opacity-45" />
          <path d="m6.6 10.2 2.3 2.3 4.6-4.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="text-[13px] font-medium text-lime">Auditoria do corte: nenhuma palavra cortada</div>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2 border-t border-lime/12 pt-2.5 sm:grid-cols-3">
        <div>
          <div className="text-[15px] font-semibold tabular-nums text-fg">{prova}</div>
          <div className="text-[10.5px] leading-tight text-fg/45">de fala dentro do que saiu</div>
        </div>
        <div>
          <div className="text-[15px] font-semibold tabular-nums text-fg">{seg(audit.savedSec)}</div>
          <div className="text-[10.5px] leading-tight text-fg/45">de começo/fim de palavra que o corte devolveu</div>
        </div>
        <div>
          <div className="text-[15px] font-semibold tabular-nums text-fg">{audit.cuts}</div>
          <div className="text-[10.5px] leading-tight text-fg/45">
            {audit.cuts === 1 ? 'pausa encurtada' : 'pausas encurtadas'}
            {audit.refusedCuts > 0 ? ` · ${audit.refusedCuts} mantida${audit.refusedCuts === 1 ? '' : 's'} por segurança` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}

