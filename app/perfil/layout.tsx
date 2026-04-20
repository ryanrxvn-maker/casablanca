import { Header } from '@/components/Header';

export default function PerfilLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="container-app flex-1 py-10">{children}</main>
    </div>
  );
}
