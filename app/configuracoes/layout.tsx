import { Heartbeat } from '@/components/Heartbeat';
import { RouteLoader } from '@/components/RouteLoader';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';

/**
 * Layout das configurações — mesma shell estrutural das ferramentas:
 * sidebar lateral + topbar + conteúdo central.
 */
export default function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:pl-[84px]">
      <Heartbeat />
      <Sidebar />
      <TopBar />
      <main className="flex-1 pb-16 pt-6 md:pt-8">{children}</main>
      <RouteLoader />
    </div>
  );
}
