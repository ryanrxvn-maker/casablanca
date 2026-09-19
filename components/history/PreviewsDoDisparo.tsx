'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { LipsyncPreviewCard } from '@/components/LipsyncPreviewCard';
import { readDurableRecords } from '@/lib/durable-records';
import { pedirAcaoEEsperar } from '@/lib/history-acoes';
import { travarScrollDaPagina } from '@/lib/trava-scroll';

/**
 * JANELA DE PREVIEWS DO DISPARO.
 *
 * Pedido do Silas: "o olhinho tem que mostrar os cards de preview de cada parte
 * gerada no HeyGen, janela abre, não precisa abrir outra sessão, dá pra ver e
 * assistir". Então a janela monta aqui mesmo, por cima do histórico, com os
 * MESMOS cards que o Pilot usa nos takes.
 *
 * De onde vem cada take, nesta ordem:
 *  1. o MP4 guardado neste navegador (`pilot:<taskId>:…part:<label>`) — é o que
 *     sobrevive ao fim do disparo e não depende de rede;
 *  2. a URL que o disparo guardou (expira em horas no HeyGen);
 *  3. o resgate pelo videoId, que pede a URL nova ao HeyGen pela extensão.
 *
 * Nada é carregado antes da hora: a lista lê só o ÍNDICE das chaves, e o vídeo
 * de um take só sai do disco quando o card manda tocar.
 */

type ParteDoRegistro = {
  label?: string;
  videoId?: string | null;
  videoStatus?: string | null;
  videoUrl?: string | null;
  error?: string | null;
  renamedTo?: string | null;
};

type RegistroDoDisparo = {
  taskName?: string;
  phase?: string;
  parts?: ParteDoRegistro[];
  taskUrl?: string;
};

type TakeNaTela = {
  label: string;
  status: string;
  videoUrl: string | null;
  error?: string | null;
  /** Chave local do MP4, quando este navegador guardou o take. */
  chave?: string;
  videoId?: string | null;
};

export function PreviewsDoDisparo({
  taskId,
  titulo,
  onClose,
}: {
  taskId: string;
  titulo: string;
  onClose: () => void;
}) {
  const [registro, setRegistro] = useState<RegistroDoDisparo | null>(null);
  const [chaves, setChaves] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [resgatando, setResgatando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [urlsFrescas, setUrlsFrescas] = useState<Record<string, string>>({});
  /** URL pronta de cada take guardado aqui (chave do zip-store -> object URL). */
  const [urlsLocais, setUrlsLocais] = useState<Record<string, string>>({});
  const fecharRef = useRef<HTMLButtonElement>(null);
  const abertoEm = useRef(Date.now());
  /** Object URLs criadas aqui: morrem junto com a janela. */
  const criadasRef = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const u of criadasRef.current) {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      }
      criadasRef.current = [];
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const destravar = travarScrollDaPagina();
    fecharRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      destravar();
    };
  }, [onClose]);

  // Índice: o registro do disparo + as chaves dos MP4 guardados. Sem bytes.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      let rec: RegistroDoDisparo | null = null;
      try {
        rec = (readDurableRecords<RegistroDoDisparo>('background')[taskId] as RegistroDoDisparo) ?? null;
      } catch {}
      let ks: string[] = [];
      try {
        const { listarChavesPorPrefixo } = await import('@/lib/zip-store');
        ks = (await listarChavesPorPrefixo(`pilot:${taskId}:`)).filter((k) => /:part:/.test(k));
      } catch {}
      if (!vivo) return;
      setRegistro(rec);
      setChaves(ks);
      setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [taskId]);

  const takes: TakeNaTela[] = useMemo(() => {
    const partes = registro?.parts ?? [];
    const porLabel = new Map<string, string>();
    for (const k of chaves) {
      const label = k.split(':part:')[1];
      if (label) porLabel.set(label, k);
    }
    if (partes.length > 0) {
      return partes.map((p) => {
        const label = String(p.label ?? '');
        const chave = porLabel.get(label);
        const fresca = p.videoId ? urlsFrescas[p.videoId] : undefined;
        const local = chave ? urlsLocais[chave] : undefined;
        return {
          label: p.renamedTo || label || 'take',
          // Guardado aqui = pronto, mesmo que o registro não tenha status.
          status: chave ? 'completed' : p.videoStatus || (p.videoId ? 'processing' : 'pending'),
          // Local primeiro: não depende de rede nem de URL que expira.
          videoUrl: local || fresca || p.videoUrl || null,
          error: p.error ?? null,
          chave,
          videoId: p.videoId ?? null,
        };
      });
    }
    // Disparo sem registro de partes (saiu da fila): o que houver no disco
    // ainda serve de prévia.
    return [...porLabel.entries()].map(([label, chave]) => ({
      label,
      status: 'completed',
      videoUrl: urlsLocais[chave] || null,
      chave,
    }));
  }, [registro, chaves, urlsFrescas, urlsLocais]);

  const prontos = takes.filter((t) => t.status === 'completed').length;
  const abrindoTakes = chaves.length > Object.keys(urlsLocais).length;

  /**
   * Traz os MP4 guardados UM DE CADA VEZ.
   *
   * Ler dez takes de uma vez joga centenas de MB na memória de um golpe (e o
   * navegador engasga na hora em que o usuário só queria ver o primeiro). Em
   * fila, cada card sai do estado "recuperando" assim que chega a vez dele.
   */
  useEffect(() => {
    const pendentes = chaves.filter((k) => !urlsLocais[k]);
    if (pendentes.length === 0) return;
    let vivo = true;
    void (async () => {
      const { loadBlob } = await import('@/lib/zip-store').catch(() => ({ loadBlob: null } as never));
      if (!loadBlob) return;
      for (const chave of pendentes) {
        if (!vivo) return;
        try {
          const blob = await loadBlob(chave, 'video/mp4');
          if (!vivo) return;
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          criadasRef.current.push(url);
          setUrlsLocais((prev) => ({ ...prev, [chave]: url }));
        } catch {
          /* um take ilegível não pode derrubar a janela inteira */
        }
      }
    })();
    return () => {
      vivo = false;
    };
    // urlsLocais entra de propósito: cada chegada reavalia o que falta.
  }, [chaves, urlsLocais]);

  /** O card pede uma URL nova quando a dele morre (object URL revogada). */
  const recuperar = useCallback(async (chave?: string) => {
    if (!chave) return null;
    try {
      const { loadBlob } = await import('@/lib/zip-store');
      const blob = await loadBlob(chave, 'video/mp4');
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      criadasRef.current.push(url);
      return url;
    } catch {
      return null;
    }
  }, []);

  /** Pede ao HeyGen as URLs novas dos takes que não estão guardados aqui. */
  async function resgatarDoHeyGen() {
    const ids = takes.filter((t) => !t.chave && t.videoId).map((t) => t.videoId!) as string[];
    if (ids.length === 0 || resgatando) return;
    setResgatando(true);
    setRecado('Pedindo os vídeos ao HeyGen…');
    try {
      const { getVideosStatus } = await import('@/lib/heygen-api-direct');
      const status = await getVideosStatus(ids);
      const novas: Record<string, string> = {};
      let faltou = 0;
      for (const id of ids) {
        const u = status[id]?.videoUrl;
        if (u) novas[id] = u;
        else faltou += 1;
      }
      setUrlsFrescas((p) => ({ ...p, ...novas }));
      setRecado(
        faltou === 0
          ? null
          : `${faltou} take${faltou === 1 ? '' : 's'} o HeyGen não devolveu (podem ter sido apagados lá).`,
      );
    } catch (e) {
      setRecado(
        `Não consegui falar com o HeyGen (${(e as Error)?.message || 'sem detalhe'}). Confere a extensão e uma aba logada em app.heygen.com.`,
      );
    } finally {
      setResgatando(false);
    }
  }

  const semLocal = takes.filter((t) => !t.chave && t.videoId).length;

  return createPortal(
    <div
      className="hist-overlay hist-overlay--previews"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && Date.now() - abertoEm.current > 250) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Previews do disparo ${titulo}`}
        className="hist-previews"
      >
        <header className="hist-previews__topo">
          <div className="min-w-0 flex-1">
            <h2 className="hist-previews__titulo">{titulo}</h2>
            <p className="hist-previews__linha">
              <span>
                {carregando
                  ? 'Abrindo'
                  : abrindoTakes
                    ? `${Object.keys(urlsLocais).length} de ${chaves.length} takes carregados`
                    : `${prontos} de ${takes.length} takes`}
              </span>
              {registro?.phase ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{registro.phase === 'done' ? 'disparo concluído' : 'disparo em andamento'}</span>
                </>
              ) : null}
            </p>
          </div>
          {semLocal > 0 ? (
            <button
              type="button"
              className="hist-previews__acao"
              onClick={() => void resgatarDoHeyGen()}
              disabled={resgatando}
            >
              {resgatando ? 'Buscando…' : `Buscar ${semLocal} no HeyGen`}
            </button>
          ) : null}
          <button
            ref={fecharRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar previews"
            title="Fechar"
            className="hist-fechar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        {recado ? <p className="hist-previews__recado">{recado}</p> : null}

        <div className="hist-previews__corpo">
          {carregando ? (
            <p className="hist-previews__vazio">Abrindo os takes…</p>
          ) : takes.length === 0 ? (
            <p className="hist-previews__vazio">
              Esse disparo não tem take guardado neste navegador. Se ele ainda estiver no HeyGen,
              o botão Remontar no histórico traz os vídeos de volta.
            </p>
          ) : (
            <div className="hist-previews__grade">
              {takes.map((t, i) => (
                <LipsyncPreviewCard
                  key={`${t.label}-${i}`}
                  take={{
                    status: t.status,
                    label: t.label,
                    videoUrl: t.videoUrl,
                    error: t.error,
                  }}
                  position={i + 1}
                  total={takes.length}
                  fileBase={titulo.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'take'}
                  recuperarVideo={t.chave ? () => recuperar(t.chave) : undefined}
                />
              ))}
            </div>
          )}
        </div>

        <footer className="hist-previews__rodape">
          <button
            type="button"
            className="hist-previews__link"
            onClick={() => void pedirAcaoEEsperar('abrir', taskId)}
            title="Leva ao card desta task na fila do Pilot"
          >
            Ver o card no Pilot
          </button>
          {registro?.taskUrl ? (
            <a
              href={registro.taskUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hist-previews__link"
            >
              Abrir no ClickUp
            </a>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
