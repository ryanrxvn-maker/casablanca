'use client';

import { useEffect, useState } from 'react';

/**
 * Section em /configuracoes pra editar quais status do ClickUp o Pilot
 * deve filtrar quando carrega tasks. Default fica como esta — esse painel
 * existe so pra workflow custom (cliente diferente, status diferentes).
 *
 * Persiste em localStorage com a mesma key do useToolState do clickup-pilot
 * page: 'tools-state:clickup:statuses'.
 */

const TOOL_STATE_KEY = 'darkolab:clickup-pilot:statuses';
const DEFAULT_STATUSES = 'editar video,editar vídeo,editando video,editando vídeo';

export function ClickUpPilotStatusSection({
  flash,
}: {
  flash: (kind: 'ok' | 'err', msg: string) => void;
}) {
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setValue(localStorage.getItem(TOOL_STATE_KEY) || DEFAULT_STATUSES);
    setLoaded(true);
  }, []);

  function save() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOOL_STATE_KEY, value);
    flash('ok', 'Filtro de status atualizado. Recarrega o ClickUp Pilot pra usar.');
  }

  function reset() {
    setValue(DEFAULT_STATUSES);
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOOL_STATE_KEY, DEFAULT_STATUSES);
    }
    flash('ok', 'Filtro restaurado pro default.');
  }

  if (!loaded) return null;

  return (
    <section className="border-t border-line pt-6">
      <h2 className="label-field !mb-3">ClickUp Pilot — status que aparecem</h2>
      <div className="rounded-[12px] border border-line bg-bg-soft/40 p-4">
        <p className="mb-3 text-[12px] text-text-muted">
          Quando o Pilot carrega suas tasks, ele filtra por esses status. Default mostra
          so as tasks pra editar/editando (nao mostra revisao, implementar, etc).
          Edita aqui se seu time usa nomes diferentes (lista CSV, lowercase, com
          acento). API do ClickUp e case-sensitive.
        </p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={DEFAULT_STATUSES}
          className="input-field font-mono text-xs"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={save} className="btn-primary">
            Salvar
          </button>
          <button
            onClick={reset}
            className="rounded-[12px] border border-line-strong px-4 py-2 text-sm text-text-muted hover:border-lime hover:text-lime"
          >
            Restaurar default
          </button>
        </div>
      </div>
    </section>
  );
}
