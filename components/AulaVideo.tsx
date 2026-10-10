'use client';

import { useState } from 'react';

import { aulaDaRota } from '@/lib/aulas-video';
import { tierAllowsTool, useTier } from '@/lib/use-tier';

/**
 * Aula em vídeo da ferramenta, tocando DENTRO do app (YouTube não listado).
 *
 * Começa como capa (public/aulas) com o botão "Assistir à aula" — o player do
 * YouTube só carrega no clique, então a página não fica mais pesada por causa
 * da aula. No clique troca pelo player embutido, já tocando.
 *
 * Aula de ferramenta paga só aparece pra quem tem acesso a ela: é isso que
 * mantém o link longe de quem não assinou.
 *
 * ⚠ `credentialless` no iframe: o app manda COEP (o ffmpeg.wasm precisa de
 * isolamento) e o YouTube não manda COEP de volta — sem esse atributo o Chrome
 * recusa o iframe quando a página está isolada.
 */
export function AulaVideo({ path, className = '' }: { path: string; className?: string }) {
  const aula = aulaDaRota(path);
  const tier = useTier();
  const [tocando, setTocando] = useState(false);

  if (!aula) return null;
  if (path.startsWith('/tools/') && !tierAllowsTool(tier, path)) return null;

  const src =
    `https://www.youtube-nocookie.com/embed/${aula.id}` +
    // sem cc_load_policy: qualquer valor (até 0) liga a legenda automática; sem ele vale a preferência do usuário
    '?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&hl=pt-BR';

  return (
    <div className={className}>
      <div
        className="relative aspect-video w-full overflow-hidden rounded-[16px] border border-line-strong bg-black"
        style={{ boxShadow: '0 18px 40px -24px rgba(0,0,0,0.75)' }}
      >
        {tocando ? (
          <iframe
            src={src}
            title={aula.titulo}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            {...{ credentialless: '' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setTocando(true)}
            aria-label={`Assistir à aula: ${aula.titulo} (${aula.duracao})`}
            className="group absolute inset-0 block h-full w-full text-left"
          >
            {/* a capa é a cartela da própria aula (já traz o nome da ferramenta) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={aula.capa}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              loading="lazy"
              decoding="async"
            />
            <span
              aria-hidden
              className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/10"
            />
            {/* botão: canto de baixo, onde nenhuma capa tem título */}
            <span
              className="absolute bottom-2.5 right-2.5 flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-transform sm:bottom-3.5 sm:right-3.5 sm:gap-2.5 sm:py-1.5 sm:pl-1.5 sm:pr-4 duration-300 group-hover:scale-[1.04] group-active:scale-[0.98]"
              style={{
                // cor no style, sem text-white: no claro o globals.css troca todo text-white por tinta
                // escura, e aqui a pílula continua escura (fica sobre a capa, que é o próprio vídeo)
                color: '#fff',
                background: 'rgba(12,10,18,0.78)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                boxShadow: '0 10px 26px -10px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.10)',
              }}
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9"
                style={{
                  background: 'linear-gradient(160deg, #a78bfa, #7c3aed)',
                  boxShadow: '0 6px 16px -6px rgba(124,58,237,0.8), inset 0 1px 0 rgba(255,255,255,0.25)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="#fff" />
                </svg>
              </span>
              <span className="text-[12px] font-semibold leading-none sm:text-[13.5px]">Assistir à aula</span>
              <span className="mono text-[11px] font-semibold leading-none sm:text-[12px]" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {aula.duracao}
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
