'use client';
import { Suspense, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { SubSidebar, useSubSidebarActive } from '@/components/SubSidebar';
import { TopBar } from '@/components/TopBar';
import { ToolsStateProvider } from '@/components/ToolsStateProvider';
/** Development-only presentation host. It provides local UI state, never a session or tier override. */
export function PreviewWorkspace({ children }: { children: ReactNode }) {
  return <ToolsStateProvider><Suspense><PreviewContent>{children}</PreviewContent></Suspense></ToolsStateProvider>;
}
function PreviewContent({ children }: { children: ReactNode }) {
  const path = usePathname();
  const currentPath = path.endsWith('/hub') ? '/tools' : path.replace('/dev/redesign/','/tools/');
  const subActive = useSubSidebarActive(currentPath);
  return <><Sidebar currentPath={currentPath} /><SubSidebar currentPath={currentPath} /><div className={'flex min-h-screen flex-col '+(subActive?'md:pl-[328px]':'md:pl-[84px]')}><TopBar /><main className="flex-1 pb-16 pt-8">{children}</main></div></>;
}
