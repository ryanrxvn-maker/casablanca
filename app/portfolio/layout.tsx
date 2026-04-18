import { Header } from '@/components/Header';
import { TabNav } from '@/components/TabNav';

const portfolioTabs = [
  { label: 'Vídeos', href: '/portfolio' },
  { label: 'Provas sociais', href: '/portfolio/provas-sociais' },
];

export default function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <TabNav tabs={portfolioTabs} />
      <main className="container-app flex-1 py-10">{children}</main>
    </div>
  );
}
