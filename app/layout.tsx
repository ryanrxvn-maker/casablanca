import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CASABLANCA — Ferramentas para editores',
  description:
    'Plataforma de ferramentas para editores de vídeo e criadores: decupagem, camuflagem, compressão e portfolio profissional.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
