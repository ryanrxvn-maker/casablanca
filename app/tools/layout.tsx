'use client';

import { Heartbeat } from '@/components/Heartbeat';
import { RouteLoader } from '@/components/RouteLoader';
import { Sidebar } from '@/components/Sidebar';
import { SubSidebar, useSubSidebarActive } from '@/components/SubSidebar';
import { TopBar } from '@/components/TopBar';
import { ToolsStateProvider } from '@/components/ToolsStateProvider';

/**
 * Layout das ferramentas v4 — estilo HeyGen com sub-sidebar.
 *
 * Estrutura:
 *  ┌──────┬───────────────┬────────────────────────┐
 *  │  84  │  244 (subnav  │   conteúdo flex        │
 *  │ side │  só em Base/  │                        │
 *  │ bar  │  IA)          │                        │
 *  └──────┴───────────────┴────────────────────────┘
 */
export default function ToolsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolsStateProvider>
      <Heartbeat />
      <Sidebar />
      <SubSidebar />
      <ContentWrap>{children}</ContentWrap>
      <RouteLoader />
    </ToolsStateProvider>
  );
}

/**
 * Conteúdo principal — ajusta padding-left de acordo com sub-sidebar.
 * Cliente porque precisa do hook do pathname.
 */
function ContentWrap({ children }: { children: React.ReactNode }) {
  const subActive = useSubSidebarActive();
  return (
    <div
      className={
        'flex min-h-screen flex-col transition-[padding] duration-300 ' +
        (subActive ? 'md:pl-[328px]' : 'md:pl-[84px]')
      }
    >
      <TopBar />
      <main className="flex-1 pb-16 pt-6 md:pt-8">{children}</main>
    </div>
  );
}
