/**
 * O SELO DE AUDITORIA da Remover Silêncios — a prova, em número, de que o corte não
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

  const stats: Array<{ v: string; label: string }> = [
    { v: prova, label: 'de fala dentro do que saiu' },
    { v: seg(audit.savedSec), label: 'de começo/fim de palavra que o corte devolveu' },
    {
      v: String(audit.cuts),
      label:
        (audit.cuts === 1 ? 'pausa encurtada' : 'pausas encurtadas') +
        (audit.refusedCuts > 0 ? ` · ${audit.refusedCuts} mantida${audit.refusedCuts === 1 ? '' : 's'} por segurança` : ''),
    },
  ];

  return (
    <div className="mb-4 overflow-hidden rounded-[16px] border border-lime/25 bg-lime/[0.05]">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-lime/15 text-lime ring-1 ring-lime/30">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l7 3v5.5c0 4.4-3 8.1-7 9.5-4-1.4-7-5.1-7-9.5V6l7-3z" />
            <path d="m8.8 12.2 2.2 2.2 4.3-4.6" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-lime">Nenhuma palavra cortada</div>
          <div className="mono text-[9.5px] uppercase tracking-[0.16em] text-text-muted">Auditoria do corte</div>
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-lime/10 border-t border-lime/15 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {stats.map((st) => (
          <div key={st.label} className="px-4 py-2.5">
            <div className="text-[15px] font-bold tabular-nums text-text">{st.v}</div>
            <div className="text-[10.5px] leading-tight text-text-muted">{st.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

