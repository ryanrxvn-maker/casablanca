import { Heartbeat } from '@/components/Heartbeat';
import { RouteLoader } from '@/components/RouteLoader';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Heartbeat />
      <Sidebar />
      <div className="flex min-h-screen flex-col md:pl-[84px]">
        <TopBar />
        <main className="flex-1 pb-16 pt-6 md:pt-8">{children}</main>
      </div>
      <RouteLoader />
    </>
  );
}
