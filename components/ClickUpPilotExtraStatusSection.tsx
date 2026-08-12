'use client';

import { useEffect, useState } from 'react';
import {
  getPilotStatusExtras,
  setPilotStatusExtras,
  defaultExtraStatusesForTeamName,
  shortWorkspaceLabel,
} from '@/lib/clickup-pilot-config';

/**
 * Status EXTRAS por empresa (workspace) — somados ao filtro global.
 *
 * Cada empresa nomeia o fluxo do seu jeito: o DR MILLION tem "refação
 * vídeo", que não existe no B2C. Em vez de misturar tudo num filtro só
 * (o que faria uma empresa herdar o vocabulário da outra), cada workspace
 * guarda os seus. O B2C fica com a lista vazia e continua exatamente como
 * sempre foi.
 */
export function ClickUpPilotExtraStatusSection({
  teamId,
  teamName,
  flash,
}: {
  teamId: string | null;
  teamName: string | undefined | null;
  flash: (kind: 'ok' | 'err', msg: string) => void;
}) {
  const [value, setValue] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !teamId) return;
    const saved = getPilotStatusExtras(teamId);
    setValue((saved ?? defaultExtraStatusesForTeamName(teamName)).join(', '));
    setLoadedFor(teamId);
  }, [teamId, teamName]);

  if (!teamId || loadedFor !== teamId) return null;

  const label = shortWorkspaceLabel(teamName);
  const sugestao = defaultExtraStatusesForTeamName(teamName);

  function parse(v: string): string[] {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return (
    <section className="border-t border-line pt-6">
      <h2 className="label-field !mb-3">
        Status extras — <span className="text-lime">{label}</span>
      </h2>
      <div className="rounded-[12px] border border-line bg-bg-soft/40 p-4">
        <p className="mb-3 text-[12px] text-text-muted">
          Somados ao filtro de status acima <strong>só quando esta empresa
          está selecionada</strong> no Pilot. Serve pros status que só existem
          aqui — no DR MILLION, por exemplo,{' '}
          <code className="mono text-lime">refação vídeo</code>. Deixe vazio
          pra empresa usar apenas o filtro padrão. Lista separada por vírgula;
          a API do ClickUp diferencia acento e maiúscula, então vale repetir as
          grafias.
        </p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ex: refação vídeo, refacao video"
          className="input-field font-mono text-xs"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => {
              setPilotStatusExtras(teamId, parse(value));
              flash('ok', `Status extras de ${label} salvos. Carregue as tasks pra usar.`);
            }}
            className="btn-primary"
          >
            Salvar
          </button>
          {sugestao.length ? (
            <button
              onClick={() => {
                setValue(sugestao.join(', '));
                setPilotStatusExtras(teamId, sugestao);
                flash('ok', `Sugestão do ${label} aplicada.`);
              }}
              className="rounded-[12px] border border-line-strong px-4 py-2 text-sm text-text-muted hover:border-lime hover:text-lime"
            >
              Usar sugestão ({sugestao.length})
            </button>
          ) : null}
          <button
            onClick={() => {
              setValue('');
              setPilotStatusExtras(teamId, []);
              flash('ok', `${label} agora usa só o filtro padrão.`);
            }}
            className="rounded-[12px] border border-line-strong px-4 py-2 text-sm text-text-muted hover:border-red-500/60 hover:text-red-300"
          >
            Limpar
          </button>
        </div>
      </div>
    </section>
  );
}
