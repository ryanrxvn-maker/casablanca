'use client';

import { useEffect, useState } from 'react';
import { HeyGenConectar } from '@/components/HeyGenConectar';

/**
 * Banner que avisa ANTES do disparo quando a credencial do HeyGen vai falhar.
 *
 * Dois estados que só apareciam depois de gastar tempo (ou crédito):
 *
 *  1. OAuth do modo imagem EXPIRADO — o disparo de modo imagem simplesmente
 *     não sai, e a mensagem crua do HeyGen não diz o que fazer.
 *  2. API key e OAuth em CONTAS DIFERENTES — os pickers listam avatares da
 *     conta da API key, mas o modo imagem gera na conta do OAuth. Escolher
 *     avatar de uma e disparar na outra devolve "Avatar group not accessible",
 *     que parece bug nosso ([[project_heygen_space_mismatch]]).
 *
 * Aconteceu em 18.08: o OAuth foi trocado pra conta B2C e a API key ficou na do
 * DR MILLION, sem nenhum sinal na tela.
 *
 * Silencioso quando está tudo certo — banner que aparece sempre vira paisagem.
 */

type Aviso = { nivel: 'erro' | 'atencao'; titulo: string; texto: string } | null;

type Diagnostico = {
  aviso: Aviso;
  /** qual credencial está com problema — decide QUAL botão aparece */
  falta?: 'oauth' | 'apikey' | 'ambas' | null;
  apiKey?: { conta?: { email?: string | null } | null };
  oauth?: { conta?: { email?: string | null } | null; expiraEm?: string | null };
};

export function HeyGenContaAviso({
  /**
   * `true` nas telas que não precisam da API key (Famous Hey: o seletor de voz
   * cai pro OAuth). Sem isto, a tela cobrava uma credencial que não desbloqueia
   * nada ali — o usuário conectava, recarregava e continuava vendo aviso.
   */
  apiKeyOpcional,
}: { apiKeyOpcional?: boolean } = {}) {
  const [diag, setDiag] = useState<Diagnostico | null>(null);
  const [fechado, setFechado] = useState(false);

  useEffect(() => {
    let vivo = true;
    // Falha silenciosa de propósito: se o diagnóstico não responder, a
    // ferramenta segue normal — o banner é proteção, não dependência.
    fetch(`/api/heygen/identidade${apiKeyOpcional ? '?apiKeyOpcional=1' : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (vivo && j) setDiag(j as Diagnostico);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [apiKeyOpcional]);

  const aviso = diag?.aviso ?? null;
  const falta = diag?.falta ?? null;
  if (!aviso || fechado) return null;

  const erro = aviso.nivel === 'erro';
  const emailKey = diag?.apiKey?.conta?.email ?? null;
  const emailOauth = diag?.oauth?.conta?.email ?? null;

  return (
    <div
      role="alert"
      className={[
        'mb-4 rounded-[12px] border px-4 py-3 text-[13px] leading-relaxed',
        erro
          ? 'border-red-500/45 bg-red-500/10 text-red-100'
          : 'border-amber-400/45 bg-amber-400/10 text-amber-100',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-[1px] shrink-0 text-[15px]">
          {erro ? '⛔' : '⚠️'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">{aviso.titulo}</div>
          <p className="mt-1 opacity-95">{aviso.texto.replace('[RECONECTAR]', '').trim()}</p>

          {diag?.oauth?.expiraEm ? (
            <p className="mt-1.5 text-[11.5px] opacity-80">
              O login do modo imagem vale até{' '}
              {new Date(diag.oauth.expiraEm).toLocaleDateString('pt-BR')} — a renovação
              automática empurra essa data todo dia.
            </p>
          ) : null}

          {emailKey && emailOauth && emailKey !== emailOauth ? (
            <div className="mono mt-2 space-y-0.5 text-[11.5px] opacity-80">
              <div>avatares e vozes (API key): {emailKey}</div>
              <div>modo imagem (OAuth): {emailOauth}</div>
            </div>
          ) : null}

          {/* O BOTÃO TEM QUE RESOLVER O QUE O TÍTULO DIZ. Antes aparecia
              "falta API key" com um botão de OAuth do lado: o usuário conectava,
              recarregava e via a mesma tela, sem entender que eram credenciais
              diferentes. */}
          {falta === 'oauth' || falta === 'ambas' ? <HeyGenConectar /> : null}

          {falta === 'apikey' || falta === 'ambas' ? (
            <a
              href="/configuracoes/api"
              className="mt-2 inline-flex items-center gap-1.5 rounded-[10px] border border-current/40 px-3.5 py-2 text-[13px] font-bold transition-opacity hover:opacity-80"
            >
              Colar minha API key →
            </a>
          ) : null}

          {!falta ? (
            <a
              href="/configuracoes/api"
              className="mt-2 inline-block font-semibold underline underline-offset-2"
            >
              Abrir configurações de API →
            </a>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setFechado(true)}
          aria-label="Fechar aviso"
          className="shrink-0 rounded px-1.5 text-[15px] leading-none opacity-60 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
