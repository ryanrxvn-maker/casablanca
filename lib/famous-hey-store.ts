'use client';

import { saveBlob, loadBlob, deletePrefix } from '@/lib/zip-store';

/**
 * FAMOUS HEY — histórico local dos vídeos gerados.
 *
 * ───────────────── POR QUE NÃO É TABELA NO SUPABASE ─────────────────
 * O padrão que já vale no app pro mesmo problema (o /tools/lipsync-history)
 * é METADADO no localStorage + BLOB no IndexedDB. Copiando ele, três coisas
 * saem de graça:
 *
 *  - "Baixar de novo" funciona PRA SEMPRE. A URL que o HeyGen devolve expira
 *    em horas; o mp4 guardado aqui não. Sem isto o histórico viraria uma lista
 *    de links mortos — que é pior que não ter histórico, porque parece que
 *    funciona até a hora que você precisa.
 *  - Nada de migração de banco nem de rota nova pra ler/escrever.
 *  - Funciona offline e não vaza vídeo do cliente pro nosso storage.
 *
 * Custo aceito: o histórico é POR NAVEGADOR. Trocou de máquina, não vê.
 * Está escrito na tela pro usuário não descobrir isso do jeito ruim.
 *
 * ⚠ O que mora em cada lugar:
 *    localStorage  → a ficha do job (texto, voz, status, miniatura)
 *    IndexedDB     → o mp4 pronto e a imagem de origem (pesados demais pro LS)
 */

const CHAVE_JOBS = 'famousHey:jobs:v1';
/** Prefixo dos blobs no IndexedDB. O `pruneZipStore` do boot varre por LRU e
 *  não conhece este prefixo — por isso a poda daqui é explícita (`podar`). */
export const PREFIXO_BLOB = 'famousHey:';

/** Teto de fichas guardadas. Passou disto, as mais antigas saem junto com os
 *  blobs delas. 30 × (mp4 de ~3MB + imagem) ≈ 120MB — dentro do que o
 *  navegador dá sem pedir permissão. */
const MAX_JOBS = 30;

export type ModoFala = 'texto' | 'audio';

export type FamousHeyJob = {
  id: string;
  /** id do vídeo no HeyGen — é por ele que o status é consultado. */
  videoId: string;
  titulo: string;
  criadoEm: number;
  status: 'processando' | 'pronto' | 'falhou';
  erro: string | null;

  modo: ModoFala;
  /** Texto falado. No modo áudio com voz espelhada, é a transcrição que o
   *  usuário revisou — guardar permite editar e regerar sem transcrever de novo. */
  script: string;
  voiceId: string | null;
  voiceNome: string | null;
  audioNome: string | null;
  motionPrompt: string;
  aspectRatio: string;
  resolution: string;
  expressiveness: string;

  /** JPEG pequeno pro card. Vive no localStorage porque a lista precisa dele
   *  para pintar; ler 30 blobs do IndexedDB a cada render seria pior. */
  thumb: string | null;
  /** true quando a imagem de origem está no IndexedDB (permite regerar). */
  temImagem: boolean;

  duracao: number | null;
  /** URL do HeyGen. EXPIRA — serve só pro preview logo depois de gerar. */
  videoUrl: string | null;
  /** true quando o mp4 já foi baixado pro IndexedDB (download permanente). */
  temVideo: boolean;
  bytes: number | null;
};

function chaveVideo(id: string) {
  return `${PREFIXO_BLOB}${id}:mp4`;
}
function chaveImagem(id: string) {
  return `${PREFIXO_BLOB}${id}:img`;
}

export function lerJobs(): FamousHeyJob[] {
  if (typeof window === 'undefined') return [];
  try {
    const cru = localStorage.getItem(CHAVE_JOBS);
    if (!cru) return [];
    const v = JSON.parse(cru);
    return Array.isArray(v) ? (v as FamousHeyJob[]) : [];
  } catch {
    // JSON corrompido não pode derrubar a ferramenta inteira — a lista some,
    // os blobs continuam lá.
    return [];
  }
}

function gravar(jobs: FamousHeyJob[]): FamousHeyJob[] {
  const cortados = jobs.slice(0, MAX_JOBS);
  try {
    localStorage.setItem(CHAVE_JOBS, JSON.stringify(cortados));
  } catch {
    // Quota estourada: derruba as miniaturas (o que mais pesa) e tenta de novo.
    // Perder a miniatura é aceitável; perder a ficha inteira não é.
    try {
      localStorage.setItem(
        CHAVE_JOBS,
        JSON.stringify(cortados.map((j) => ({ ...j, thumb: null }))),
      );
    } catch {
      /* desiste em silêncio — a sessão atual continua funcionando na memória */
    }
  }
  // Blobs das fichas que saíram da lista vão junto, senão o IndexedDB só cresce.
  for (const velho of jobs.slice(MAX_JOBS)) {
    void deletePrefix(`${PREFIXO_BLOB}${velho.id}:`).catch(() => {});
  }
  return cortados;
}

export function salvarJob(job: FamousHeyJob): FamousHeyJob[] {
  const jobs = lerJobs();
  const i = jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) jobs[i] = job;
  else jobs.unshift(job);
  return gravar(jobs);
}

export function atualizarJob(
  id: string,
  mudanca: Partial<FamousHeyJob>,
): FamousHeyJob[] {
  const jobs = lerJobs();
  const i = jobs.findIndex((j) => j.id === id);
  if (i < 0) return jobs;
  jobs[i] = { ...jobs[i], ...mudanca };
  return gravar(jobs);
}

export function apagarJob(id: string): FamousHeyJob[] {
  const jobs = lerJobs().filter((j) => j.id !== id);
  void deletePrefix(`${PREFIXO_BLOB}${id}:`).catch(() => {});
  return gravar(jobs);
}

export async function guardarImagem(id: string, img: Blob): Promise<boolean> {
  try {
    await saveBlob(chaveImagem(id), img, img.type || 'image/jpeg');
    return true;
  } catch {
    // Sem a imagem guardada o job ainda gera — só perde o botão de regerar.
    return false;
  }
}

export async function pegarImagem(id: string): Promise<Blob | null> {
  try {
    return await loadBlob(chaveImagem(id), 'image/jpeg');
  } catch {
    return null;
  }
}

export async function guardarVideo(id: string, mp4: Blob): Promise<boolean> {
  try {
    await saveBlob(chaveVideo(id), mp4, 'video/mp4');
    return true;
  } catch {
    return false;
  }
}

export async function pegarVideo(id: string): Promise<Blob | null> {
  try {
    return await loadBlob(chaveVideo(id), 'video/mp4');
  } catch {
    return null;
  }
}

/**
 * Miniatura pro card: JPEG de 200px de largura.
 *
 * Vai pro localStorage, então TEM que ser pequena — uma dataURL da imagem
 * original (vários MB) estoura a quota e leva a lista inteira junto.
 */
export function fazerThumb(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const L = 200;
        const escala = Math.min(1, L / (img.naturalWidth || L));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || L) * escala));
        c.height = Math.max(1, Math.round((img.naturalHeight || L) * escala));
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.6));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export function novoId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
