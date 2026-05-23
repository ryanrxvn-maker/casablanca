import { Heartbeat } from '@/components/Heartbeat';
import { MindAdsButton } from '@/components/MindAdsButton';
import { RouteLoader } from '@/components/RouteLoader';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { ToolsStateProvider } from '@/components/ToolsStateProvider';

/**
 * Layout das ferramentas v3 — estilo HeyGen.
 *
 * - Sidebar lateral fixa (84px) com navegação principal vertical
 * - TopBar fina à direita com search/atalhos e ações secundárias
 * - Conteúdo central com padding adaptado
 * - RouteLoader: splash entre transições
 */
export default function ToolsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolsStateProvider>
      <div className="flex min-h-screen flex-col md:pl-[84px]">
        <Heartbeat />
        <Sidebar />
        <TopBar />
        <main className="flex-1 pb-16 pt-6 md:pt-8">
          {children}
        </main>
        <MindAdsButton />
        <RouteLoader />
      </div>
    </ToolsStateProvider>
  );
}
