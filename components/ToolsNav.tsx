'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SuiteSwitcher, type Suite } from './SuiteSwitcher';
import { ToolRail, type RailItem } from './ToolRail';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconCalculadora,
  IconCamuflagem,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconHeyGenAuto,
  IconLtxVideo,
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
    href: '/tools/downloader',
    label: 'Downloader',
    icon: <IconDownloader />,
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
    adminOnly: true,
  },
  {
    href: '/tools/decupagem-copy',
    label: 'Decupagem por Copy',
    icon: <IconDecupageCopy />,
  },
  {
    href: '/tools/copy-srt',
    label: 'Copy → SRT',
    icon: <IconCopySRT />,
  },
  {
    href: '/tools/heygen-auto',
    label: 'HeyGen Auto',
    icon: <IconHeyGenAuto />,
  },
  {
    href: '/tools/ltx-video',
    label: 'LTX-Video 2.3',
    icon: <IconLtxVideo />,
    adminOnly: true,
  },
  // ClickUp Pilot fica no botao especial 3D do top-bar (ClickUpPilotButton).
  // Nao duplicar aqui no rail pra evitar dois botoes pra mesma coisa.
];

/**
 * ToolsNav — shell de navegacao das ferramentas.
 * Decide o suite ativo pela URL, renderiza SuiteSwitcher no centro
 * e o rail vertical correspondente na esquerda.
 */
export function ToolsNav() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', uid)
          .maybeSingle();
        if (!cancelled) setIsAdmin(!!data?.is_admin);
      } catch {
        /* silencioso — sem admin = sem itens admin */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = (list: RailItem[]) =>
    list.filter((it) => !it.adminOnly || isAdmin);

  const isAi = AI_SUITE.some(
    (it) => pathname === it.href || pathname.startsWith(it.href + '/'),
  );
  const isBase = BASE_SUITE.some(
    (it) => pathname === it.href || pathname.startsWith(it.href + '/'),
  );
  // active=null quando pathname nao pertence a nenhum suite — ex: ClickUp Pilot
  // (ferramenta especial acessada pelo top-bar, fora de Base/AI)
  const active: Suite | null = isAi ? 'ai' : isBase ? 'base' : null;
  const items =
    active === 'ai'
      ? visible(AI_SUITE)
      : active === 'base'
        ? visible(BASE_SUITE)
        : null;

  return (
    <>
      <div className="border-b border-line bg-bg/50 backdrop-blur-sm">
        <div className="container-app flex items-center justify-between py-4">
          <span className="hidden text-[11px] uppercase tracking-widest text-text-muted md:inline">
            {active === 'ai' ? 'AI Suite' : active === 'base' ? 'Base Suite' : ''}
          </span>
          <SuiteSwitcher
            active={active}
            baseHref={BASE_SUITE[0].href}
            aiHref={AI_SUITE[0].href}
          />
          <span className="hidden text-[11px] uppercase tracking-widest text-text-muted md:inline">
            {items ? `${items.length} ${items.length === 1 ? 'ferramenta' : 'ferramentas'}` : ''}
          </span>
        </div>
      </div>

      {/* Rail so aparece quando esta numa pagina de suite. ClickUp Pilot (que
       *  nao pertence a Base nem AI) renderiza sem rail — UI fica limpa. */}
      {items ? <ToolRail items={items} /> : null}
    </>
  );
}
