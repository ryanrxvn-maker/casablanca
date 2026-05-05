'use client';

import { usePathname } from 'next/navigation';
import { SuiteSwitcher, type Suite } from './SuiteSwitcher';
import { ToolRail, type RailItem } from './ToolRail';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconCalculadora,
  IconCamuflagem,
  IconCompressor,
  IconDecupageCopy,
  IconDecupagem,
  IconNormalizador,
  IconRemoverElementos,
  IconTakeSplitter,
  IconTrocaProduto,
} from './ToolIcons';

/**
 * Registro central dos dois suites. Adicionar ferramenta nova =
 * soltar um item aqui + criar a rota correspondente em `app/tools/...`.
 */
export const BASE_SUITE: RailItem[] = [
  {
    href: '/tools/decupagem',
    label: 'Decupagem',
    icon: <IconDecupagem />,
  },
  {
    href: '/tools/camuflagem',
    label: 'Camuflagem',
    icon: <IconCamuflagem />,
  },
  {
    href: '/tools/compressor',
    label: 'Compressor',
    icon: <IconCompressor />,
  },
  {
    href: '/tools/audio-split',
    label: 'Audio Split',
    icon: <IconAudioSplit />,
  },
  {
    href: '/tools/acelerador',
    label: 'Acelerador',
    icon: <IconAcelerador />,
  },
  {
    href: '/tools/normalizador',
    label: 'Normalizador',
    icon: <IconNormalizador />,
  },
  {
    href: '/tools/take-splitter',
    label: 'Separar Takes',
    icon: <IconTakeSplitter />,
  },
  {
    href: '/tools/calculadora',
    label: 'Calculadora',
    icon: <IconCalculadora />,
  },
];

export const AI_SUITE: RailItem[] = [
  {
    href: '/tools/auto-broll',
    label: 'Auto B-Roll',
    icon: <IconAutoBroll />,
  },
  {
    href: '/tools/troca-produto',
    label: 'Troca de Produto',
    icon: <IconTrocaProduto />,
  },
  {
    href: '/tools/remover-elementos',
    label: 'Remover Legenda',
    icon: <IconRemoverElementos />,
  },
  {
    href: '/tools/decupagem-copy',
    label: 'Decupagem por Copy',
    icon: <IconDecupageCopy />,
  },
];

/**
 * ToolsNav — shell de navegacao das ferramentas.
 * Decide o suite ativo pela URL, renderiza SuiteSwitcher no centro
 * e o rail vertical correspondente na esquerda.
 */
export function ToolsNav() {
  const pathname = usePathname();

  const isAi = AI_SUITE.some(
    (it) => pathname === it.href || pathname.startsWith(it.href + '/'),
  );
  const active: Suite = isAi ? 'ai' : 'base';
  const items = active === 'ai' ? AI_SUITE : BASE_SUITE;

  return (
    <>
      <div className="border-b border-line bg-bg/50 backdrop-blur-sm">
        <div className="container-app flex items-center justify-between py-4">
          <span className="hidden text-[11px] uppercase tracking-widest text-text-muted md:inline">
            {active === 'ai' ? 'AI Suite' : 'Base Suite'}
          </span>
          <SuiteSwitcher
            active={active}
            baseHref={BASE_SUITE[0].href}
            aiHref={AI_SUITE[0].href}
          />
          <span className="hidden text-[11px] uppercase tracking-widest text-text-muted md:inline">
            {items.length} {items.length === 1 ? 'ferramenta' : 'ferramentas'}
          </span>
        </div>
      </div>

      <ToolRail items={items} />
    </>
  );
}
