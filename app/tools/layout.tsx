import { Header } from '@/components/Header';
import { Heartbeat } from '@/components/Heartbeat';
import { MindAdsButton } from '@/components/MindAdsButton';
import { ToolsNav } from '@/components/ToolsNav';
import { ToolsStateProvider } from '@/components/ToolsStateProvider';

/**
 * Layout das ferramentas — shell persistente com:
 * 1. Header global (brand + dropdown de conta)
 * 2. SuiteSwitcher (Base Suite <-> AI Suite, pill animado)
 * 3. ToolRail (sidebar vertical flutuante a esquerda com icones)
 * 4. Conteudo da ferramenta no centro, com padding a esquerda pra nao
 *    colidir com o rail em telas >= md.
 */
export default function ToolsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToolsStateProvider>
      <div className="flex min-h-screen flex-col">
        <Heartbeat />
        <Header />
        <ToolsNav />
        <main className="container-app flex-1 py-10 md:pl-[76px]">
          {children}
        </main>
        <MindAdsButton />
      </div>
    </ToolsStateProvider>
  );
}
