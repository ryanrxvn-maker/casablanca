'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Store global compartilhado entre as ferramentas.
 *
 * Cada ferramenta escreve seu estado (arquivo escolhido, output, status,
 * processing) via useToolState. Trocar de tab não desmonta o provider (ele
 * vive em app/tools/layout.tsx), então o estado sobrevive a navegação.
 *
 * Tambem permite executar uma ferramenta em background enquanto o usuario usa
 * outra: a promise de processamento captura os setters (que referenciam
 * ctx.set — estavel), então mesmo quando a page da ferramenta desmonta,
 * a promise continua escrevendo no store. Ao voltar pra ferramenta, a page
 * reflete o status atual.
 */

type Store = Record<string, unknown>;

type ToolsStateCtx = {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, val: T) => void;
  version: number;
};

const ToolsStateContext = createContext<ToolsStateCtx | null>(null);

export function ToolsStateProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<Store>({});
  const [version, setVersion] = useState(0);

  const get = useCallback(<T,>(key: string): T | undefined => {
    return storeRef.current[key] as T | undefined;
  }, []);

  const set = useCallback(<T,>(key: string, val: T) => {
    storeRef.current[key] = val;
    setVersion((v) => v + 1);
  }, []);

  return (
    <ToolsStateContext.Provider value={{ get, set, version }}>
      {children}
    </ToolsStateContext.Provider>
  );
}

/**
 * useToolState — drop-in replacement pra useState que persiste via context.
 *
 * - `initial` so e usado como fallback no primeiro read (nao sobrescreve
 *   valor ja no store). Isso garante que se voce volta pra uma tab com
 *   processamento em andamento, voce ve o status corrente, nao o initial.
 * - O setter e estavel entre renders e sobrevive desmontagem da page.
 */
export function useToolState<T>(
  key: string,
  initial: T,
): [T, (val: T | ((prev: T) => T)) => void] {
  const ctx = useContext(ToolsStateContext);
  if (!ctx) {
    throw new Error('useToolState precisa estar dentro de ToolsStateProvider');
  }

  const stored = ctx.get<T>(key);
  const current = stored !== undefined ? stored : initial;

  const setter = useCallback(
    (val: T | ((prev: T) => T)) => {
      const prev = ctx.get<T>(key);
      const basePrev = prev !== undefined ? prev : initial;
      const next =
        typeof val === 'function'
          ? (val as (p: T) => T)(basePrev as T)
          : val;
      ctx.set(key, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, key],
  );

  // NOTE: Re-render trigger — o version no ctx muda a cada set() e por isso
  // a Context API propaga update pros componentes que consomem o ctx. Referenciar
  // ctx.version aqui garante que o hook "se inscreva" em qualquer update.
  void ctx.version;

  return [current, setter];
}
