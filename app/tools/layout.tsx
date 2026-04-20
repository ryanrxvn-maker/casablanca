import { Header } from '@/components/Header';
import { TabNav } from '@/components/TabNav';

const toolTabs = [
  { label: 'Agenda', href: '/tools/agenda' },
  { label: 'Audio Split', href: '/tools/audio-split' },
  { label: 'Decupagem', href: '/tools/decupagem' },
  { label: 'Camuflagem', href: '/tools/camuflagem' },
  { label: 'Acelerador', href: '/tools/acelerador' },
  { label: 'Compressor', href: '/tools/compressor' },
  { label: 'Calculadora', href: '/tools/calculadora' },
];

export default function ToolsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <TabNav tabs={toolTabs} />
      <main className="container-app flex-1 py-10">{children}</main>
    </div>
  );
}
