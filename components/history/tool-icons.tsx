'use client';

/**
 * Ícone de cada ferramenta — módulo LEVE (só os ícones), usado pelo histórico
 * e pela notificação de "concluído" que aparece em toda tela. Antes o mapa
 * morava dentro do HistoryTimeline: importar dele numa notificação global
 * puxaria o histórico inteiro pra toda página.
 */

import type { ReactNode } from 'react';
import {
  IconAcelerador,
  IconAudioSplit,
  IconAutoBroll,
  IconAutoCortes,
  IconCaixinhaPergunta,
  IconCamuflagem,
  IconClickUpPilot,
  IconCompressor,
  IconCopySRT,
  IconDecupageCopy,
  IconDecupagem,
  IconDownloader,
  IconFakePass,
  IconFamousHey,
  IconHeyGenAuto,
  IconLipsync,
  IconLtxVideo,
  IconNormalizador,
  IconRemoverElementos,
  IconSeparadorAudio,
  IconStepMic,
  IconTipografia,
} from '@/components/ToolIcons';
import { canonicalTool } from '@/lib/history-tools';

type Icon = (p: { size?: number }) => ReactNode;

/** Toda ferramenta do HISTORY_TOOLS tem que estar aqui (lib/done-toasts.test.ts confere). */
export const TOOL_ICONS: Record<string, Icon> = {
  'clickup-pilot': IconClickUpPilot,
  'heygen-auto': IconHeyGenAuto,
  'auto-broll': IconAutoBroll,
  'auto-cortes': IconAutoCortes,
  lipsync: IconLipsync,
  decupagem: IconDecupagem,
  'decupagem-copy': IconDecupageCopy,
  'copy-srt': IconCopySRT,
  tipografia: IconTipografia,
  camuflagem: IconCamuflagem,
  compressor: IconCompressor,
  acelerador: IconAcelerador,
  'audio-split': IconAudioSplit,
  downloader: IconDownloader,
  fakepass: IconFakePass,
  'caixinha-pergunta': IconCaixinhaPergunta,
  'famous-hey': IconFamousHey,
  'ltx-video': IconLtxVideo,
  normalizador: IconNormalizador,
  'remover-elementos': IconRemoverElementos,
  'separador-audio': IconSeparadorAudio,
  'voice-test': IconStepMic,
};

/** Histórico: agrupa pelo id canônico (caixinha → FakePrint), como sempre foi. */
export function toolIcon(tool: string, size = 18): ReactNode {
  const C = TOOL_ICONS[canonicalTool(tool)] ?? IconClickUpPilot;
  return <C size={size} />;
}

/** Notificação: o ícone da ferramenta EXATA que terminou (caixinha tem o dela). */
export function toolIconExact(tool: string, size = 18): ReactNode {
  const C = TOOL_ICONS[tool] ?? TOOL_ICONS[canonicalTool(tool)] ?? IconClickUpPilot;
  return <C size={size} />;
}
