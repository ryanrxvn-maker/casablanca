import { notFound } from 'next/navigation';
import { PreviewWorkspace } from '@/components/redesign/PreviewWorkspace';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Prévia do redesign', robots: { index: false, follow: false } };
export default async function DesignView({params}:{params:{view:string}}) {
  if (process.env.NODE_ENV !== 'development') notFound();
  if (params.view === 'nao-encontrada') {
    const NotFoundPreview = (await import('@/app/not-found')).default;
    return <NotFoundPreview />;
  }
  const views = {
    controles: async () => (await import('@/components/redesign/ControlsPreview')).ControlsPreview,
    historico: async () => (await import('@/app/tools/historico/page')).default,
    calculadora: async () => (await import('@/app/tools/calculadora/page')).default,
    'famous-hey': async () => (await import('@/app/tools/famous-hey/page')).default,
    hub: async () => (await import('@/components/ToolsHub')).ToolsHub,
    pilot: async () => (await import('@/app/tools/clickup-pilot/page')).default,
    decupagem: async () => (await import('@/app/tools/decupagem/page')).default,
    fakepass: async () => (await import('@/app/tools/fakepass/page')).default,
    tipografia: async () => (await import('@/app/tools/tipografia/page')).default,
    camuflagem: async () => (await import('@/app/tools/camuflagem/page')).default,
    compressor: async () => (await import('@/app/tools/compressor/page')).default,
    downloader: async () => (await import('@/app/tools/downloader/page')).default,
    normalizador: async () => (await import('@/app/tools/normalizador/page')).default,
    acelerador: async () => (await import('@/app/tools/acelerador/page')).default,
    'audio-split': async () => (await import('@/app/tools/audio-split/page')).default,
    'copy-srt': async () => (await import('@/app/tools/copy-srt/page')).default,
    lipsync: async () => (await import('@/components/tools/LipSyncTool')).default,
    chaves: async () => (await import('@/app/configuracoes/api/page')).default,
    'heygen-auto': async () => (await import('@/app/tools/heygen-auto/page')).default,
    'auto-broll': async () => (await import('@/app/tools/auto-broll/page')).default,
    'auto-cortes': async () => (await import('@/app/tools/auto-cortes/page')).default,
    'separador-audio': async () => (await import('@/app/tools/separador-audio/page')).default,
    'decupagem-copy': async () => (await import('@/app/tools/decupagem-copy/page')).default,
    'remover-elementos': async () => (await import('@/components/tools/RemoverLegendaTool')).default,
    'voice-test': async () => (await import('@/app/tools/voice-test/page')).default,
    background: async () => (await import('@/app/tools/background/page')).default,
    points: async () => (await import('@/app/tools/points/page')).default,
    'caixinha-pergunta': async () => (await import('@/app/tools/caixinha-pergunta/page')).default,
  };
  if (!Object.hasOwn(views, params.view)) notFound();
  const Component = await views[params.view as keyof typeof views]();
  return <PreviewWorkspace><Component /></PreviewWorkspace>;
}
