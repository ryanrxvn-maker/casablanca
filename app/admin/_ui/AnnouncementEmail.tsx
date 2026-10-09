'use client';

/**
 * Peças de E-MAIL da Central de avisos (09.10):
 *   • EmailMiniature   — desenho do modelo "E-mail" no passo 1;
 *   • TemplatePicker   — os 3 templates (Comunicado · Oferta · Lançamento) com desenho;
 *   • EmailPreview     — o e-mail DE VERDADE (mesmo HTML que sai), com a linha
 *                        da caixa de entrada (remetente, assunto, pré-texto);
 *   • EmailToggle      — botão-envelope "também por e-mail" (só ícone, liga/desliga);
 *   • MailStatusTag    — como foi o envio da ativação atual, na lista de enviados;
 *   • EmailPreviewModal— prévia do e-mail a partir da lista.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { emailFromAnnouncement } from '@/lib/announcement-email';
import { EMAIL_TEMPLATE_META, EMAIL_TEMPLATES, renderEmail, type EmailTemplate } from '@/lib/email-templates';
import type { AdminAnnouncement, AnnContent, AnnKind, EmailMode, MailLog } from '@/lib/announcements';
import { I, Segmented, SPRING, Tag } from './kit';
import { accent, fmtDateTime } from './model';

/* ───────────────────────── Miniatura do modelo ───────────────────────── */

export function EmailMiniature() {
  const v = (a: number) => `rgb(162 145 224 / ${a})`;
  return (
    <div className="dark-island relative h-[92px] w-full overflow-hidden" style={{ background: '#0b0b0e' }}>
      {/* caixa de entrada à esquerda */}
      <div className="absolute inset-y-0 left-0 w-[36%] px-[6%] pt-[10%]" style={{ background: 'rgb(255 255 255 / 0.025)', boxShadow: 'inset -1px 0 0 rgb(255 255 255 / 0.05)' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-[9px] flex items-center gap-[4px]">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: i === 0 ? v(0.95) : 'rgb(255 255 255 / 0.12)' }} />
            <span className="h-[3px] flex-1 rounded-full" style={{ background: i === 0 ? 'rgb(255 255 255 / 0.7)' : 'rgb(255 255 255 / 0.12)' }} />
          </div>
        ))}
      </div>
      {/* e-mail aberto */}
      <div
        className="absolute bottom-[8%] left-[42%] right-[6%] top-[10%] overflow-hidden rounded-[7px]"
        style={{ background: '#121217', boxShadow: `0 0 0 1px rgb(255 255 255 / 0.1), 0 10px 22px -8px rgb(0 0 0 / 0.9), 0 8px 24px -10px ${v(0.7)}` }}
      >
        <div className="h-[34%]" style={{ background: `radial-gradient(80% 90% at 50% 120%, ${v(0.75)}, transparent 70%), #08080b` }}>
          <span className="absolute left-1/2 top-[17%] h-[20%] -translate-x-1/2 rounded-full" style={{ aspectRatio: '1', boxShadow: `inset 0 0 0 1.5px ${v(0.9)}, 0 0 8px ${v(0.6)}` }} />
        </div>
        <div className="px-[9%] pt-[7%]">
          <div className="h-[4px] w-[70%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.85)' }} />
          <div className="mt-[4px] h-[3px] w-[90%] rounded-full" style={{ background: 'rgb(255 255 255 / 0.25)' }} />
          <div className="mt-[6px] h-[8px] w-full rounded-[3px]" style={{ background: v(0.9) }} />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 3 templates ───────────────────────── */

function TemplateDrawing({ t, color }: { t: EmailTemplate; color: string }) {
  const c = (a: number) => `rgb(${color} / ${a})`;
  const line = (w: string, a = 0.22, h = 3) => <span className="block rounded-full" style={{ width: w, height: h, background: `rgb(255 255 255 / ${a})` }} />;
  return (
    <div className="dark-island relative h-[86px] w-full overflow-hidden px-[12%] pt-[9%]" style={{ background: '#0b0b0e' }}>
      <div className="relative h-full overflow-hidden rounded-t-[7px]" style={{ background: '#131318', boxShadow: '0 0 0 1px rgb(255 255 255 / 0.08)' }}>
        {t === 'comunicado' ? (
          <div className="flex flex-col gap-[5px] p-[10%]">
            <span className="block h-[6px] w-[34%] rounded-full" style={{ background: c(0.35), boxShadow: `inset 0 0 0 1px ${c(0.6)}` }} />
            {line('82%', 0.85, 4)}
            {line('92%')}
            {line('64%')}
            <span className="mt-[2px] block h-[8px] w-[40%] rounded-[3px]" style={{ background: c(0.95) }} />
          </div>
        ) : t === 'oferta' ? (
          <>
            <div className="h-[34%]" style={{ background: `radial-gradient(70% 100% at 50% 120%, ${c(0.75)}, transparent 70%), #08080b` }} />
            <div className="flex flex-col gap-[4px] px-[10%] pt-[7%]">
              {line('76%', 0.85, 4)}
              {[0, 1].map((i) => (
                <span key={i} className="flex items-center gap-[4px]">
                  <span className="h-[5px] w-[5px] rounded-full" style={{ background: c(0.9) }} />
                  {line('58%')}
                </span>
              ))}
              <span className="block h-[7px] w-full rounded-[3px]" style={{ background: c(0.95) }} />
            </div>
          </>
        ) : (
          <>
            <div className="relative h-[38%]" style={{ background: '#06060a' }}>
              <span className="absolute left-[10%] top-1/2 h-[4px] w-[24%] -translate-y-1/2 rounded-full" style={{ background: 'rgb(255 255 255 / 0.75)' }} />
              <span className="absolute left-[42%] top-1/2 h-[54%] -translate-y-1/2 rounded-full" style={{ aspectRatio: '1.3', background: `radial-gradient(closest-side, ${c(0.5)}, transparent)`, boxShadow: `inset 0 0 0 1px ${c(0.7)}` }} />
              <span className="absolute right-[10%] top-[20%] h-[50%] rounded-[40%]" style={{ aspectRatio: '0.8', background: 'rgb(126 213 226 / 0.45)' }} />
            </div>
            <div className="flex flex-col items-center gap-[4px] px-[10%] pt-[6%]">
              {line('80%', 0.85, 4)}
              {[0, 1].map((i) => (
                <span key={i} className="block h-[6px] w-full rounded-[2px]" style={{ background: 'rgb(255 255 255 / 0.07)', boxShadow: `inset 3px 0 0 ${c(0.8)}` }} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function TemplatePicker({ value, onChange, color }: { value: EmailTemplate; onChange: (t: EmailTemplate) => void; color: string }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {EMAIL_TEMPLATES.map((t) => {
        const on = value === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            aria-pressed={on}
            className="rounded-[16px] p-[4px] text-left transition-[box-shadow,transform] duration-300 active:scale-[0.985]"
            style={{
              background: on ? accent('violet', 0.1) : 'rgb(var(--text) / 0.03)',
              boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? accent('violet', 0.55) : 'rgb(var(--text) / 0.08)'}`,
              transitionTimingFunction: SPRING,
            }}
          >
            <div className="overflow-hidden rounded-[12px]" style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.06)' }}>
              <TemplateDrawing t={t} color={color} />
            </div>
            <div className="px-1.5 pb-1 pt-2">
              <p className="font-tech text-[13px] font-semibold text-text">{EMAIL_TEMPLATE_META[t].label}</p>
              <p className="field-label mt-0.5 text-[11.5px] leading-snug text-text-muted">{EMAIL_TEMPLATE_META[t].hint}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Prévia do e-mail ───────────────────────── */

function useSite(): string {
  const [site, setSite] = useState('https://www.darkoautoedit.com');
  useEffect(() => setSite(window.location.origin), []);
  return site;
}

/** O MESMO HTML que vai pro Resend (saudação de exemplo, link de saída inerte). */
export function EmailPreview({
  kind,
  content,
  endsAt,
  device,
}: {
  kind: AnnKind;
  content: AnnContent;
  endsAt: string | null;
  device: 'desktop' | 'mobile';
}) {
  const site = useSite();
  const msg = useMemo(() => emailFromAnnouncement({ kind, content, endsAt }, site), [kind, content, endsAt, site]);
  const html = useMemo(() => renderEmail(msg, { siteUrl: site, unsubscribeUrl: '#', firstName: 'Maria' }).html, [msg, site]);
  const width = device === 'mobile' ? 390 : 660;

  const outer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [box, setBox] = useState({ w: 0, h: 900 });
  useEffect(() => {
    const o = outer.current;
    if (!o) return;
    const ro = new ResizeObserver(() => setBox((b) => ({ ...b, w: o.clientWidth })));
    ro.observe(o);
    setBox((b) => ({ ...b, w: o.clientWidth }));
    return () => ro.disconnect();
  }, []);
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    if (h) setBox((b) => ({ ...b, h }));
    // as imagens chegam depois do load do HTML: mede de novo quando cada uma carrega
    doc.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });
  };
  const scale = box.w ? Math.min(1, box.w / width) : 1;

  return (
    <div>
      {/* linha da caixa de entrada */}
      <div className="mb-3 flex items-center gap-3 rounded-[14px] px-3.5 py-3" style={{ background: 'rgb(var(--text) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/auto-edit-logo@64.png" alt="" className="h-8 w-8 shrink-0 rounded-full" style={{ background: '#121217', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1)' }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="field-label truncate text-[13px] font-semibold text-text">Auto Edit</p>
            <span className="field-label shrink-0 text-[11.5px] text-text-muted">agora</span>
          </div>
          <p className="field-label truncate text-[13px] text-text">
            <b className="font-semibold">{msg.subject || 'Assunto do e-mail'}</b>
            <span className="text-text-muted"> — {msg.preheader || 'pré-texto que aparece ao lado do assunto'}</span>
          </p>
        </div>
      </div>
      <div ref={outer} className="relative w-full overflow-hidden rounded-[16px]" style={{ height: box.h * scale, boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.07)' }}>
        <iframe
          ref={frame}
          title="Prévia do e-mail"
          srcDoc={html}
          sandbox="allow-same-origin"
          onLoad={measure}
          className="absolute top-0 border-0"
          style={{ width, height: box.h, left: Math.max(0, (box.w - width * scale) / 2), transform: `scale(${scale})`, transformOrigin: 'top left', background: '#09090b' }}
        />
      </div>
      <p className="field-label mt-3 text-center text-[12px] text-text-muted">
        É o e-mail de verdade. A saudação usa o primeiro nome de cada pessoa; cada uma recebe o próprio link de sair da lista.
      </p>
    </div>
  );
}

/* ───────────────────────── Botão-envelope ───────────────────────── */

export function EmailToggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Também por e-mail"
      title={on ? 'E-mail ligado: sai 1 vez por ativação (a janela continua a cada login)' : 'Também mandar por e-mail'}
      onClick={() => onChange(!on)}
      disabled={disabled}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow,color,transform] duration-300 active:scale-[0.94] disabled:opacity-40"
      style={{
        color: on ? accent('violet') : 'rgb(var(--text-muted))',
        background: on ? accent('violet', 0.14) : 'rgb(var(--text) / 0.03)',
        boxShadow: on ? `inset 0 0 0 1.5px ${accent('violet', 0.6)}, 0 8px 22px -10px ${accent('violet', 0.8)}` : 'inset 0 0 0 1px rgb(var(--text) / 0.12)',
        transitionTimingFunction: SPRING,
      }}
    >
      <I.mail size={17} />
      <span
        className="absolute -right-0.5 -top-0.5 flex h-[15px] w-[15px] items-center justify-center rounded-full transition-[transform,opacity] duration-300"
        style={{ background: accent('violet'), color: '#0a0a0c', boxShadow: '0 0 0 2px rgb(var(--bg-elev))', transform: on ? 'scale(1)' : 'scale(0.4)', opacity: on ? 1 : 0, transitionTimingFunction: SPRING }}
        aria-hidden
      >
        <I.check size={9} />
      </span>
    </button>
  );
}

/* ───────────────────────── Status do envio ───────────────────────── */

export function mailMode(a: AdminAnnouncement): EmailMode {
  return a.audience.email ?? 'off';
}

/** Frase do resultado pro aviso verde/vermelho do painel. */
export function mailSentence(m: MailLog | null): { ok: boolean; text: string } | null {
  if (!m) return null;
  if (m.reason === 'sem_chave') return { ok: false, text: 'E-mail não saiu: falta a chave do Resend no servidor.' };
  if (m.reason === 'sem_destinatario') return { ok: false, text: 'E-mail não saiu: ninguém do público tem e-mail pra receber.' };
  const fora = m.optOut ? ` (${m.optOut} ${m.optOut === 1 ? 'pediu' : 'pediram'} pra não receber)` : '';
  if (m.reason === 'quota') return { ok: false, text: `E-mail parou em ${m.sent} de ${m.total}: acabou a cota do plano do Resend. Use "Tentar o resto do e-mail" depois — não duplica.` };
  if (m.reason === 'erro') return { ok: false, text: `E-mail: ${m.sent} de ${m.total} enviados. Falha: ${m.message ?? 'erro no envio'}.` };
  if (!m.done) return { ok: false, text: `E-mail: ${m.sent} de ${m.total} até agora. Use "Tentar o resto do e-mail" pra continuar.` };
  return { ok: true, text: `E-mail enviado pra ${m.sent} ${m.sent === 1 ? 'conta' : 'contas'}${fora}.` };
}

export function MailStatusTag({ a }: { a: AdminAnnouncement }) {
  const mode = mailMode(a);
  if (mode === 'off') return null;
  const m = a.mail;
  const current = !!m && !!a.activatedAt && !!m.for && Date.parse(m.for) === Date.parse(a.activatedAt);
  const title = m
    ? `${fmtDateTime(m.at)} · ${m.sent} de ${m.total} enviados${m.optOut ? ` · ${m.optOut} fora da lista` : ''}${m.message ? ` · ${m.message}` : ''}`
    : mode === 'also'
      ? 'E-mail ligado: sai na próxima ativação'
      : 'Ainda não enviado';
  let tone: 'violet' | 'amber' | 'danger' | 'neutral' = 'neutral';
  let label = mode === 'also' ? 'E-mail ligado' : 'E-mail';
  if (m && current) {
    if (m.reason === 'quota' || !m.done) {
      tone = 'amber';
      label = `E-mail ${m.sent}/${m.total}`;
    } else if (m.reason) {
      tone = 'danger';
      label = 'E-mail com falha';
    } else {
      tone = 'violet';
      label = `E-mail ${m.sent}/${m.total}`;
    }
  }
  return (
    <Tag a={tone} title={title}>
      <I.mail size={11} />
      {label}
    </Tag>
  );
}

/** Dá pra continuar o envio desta ativação? (cota acabou, erro ou parou no meio) */
export function canResume(a: AdminAnnouncement): boolean {
  const m = a.mail;
  if (mailMode(a) === 'off' || !m || !a.activatedAt || !m.for) return false;
  if (Date.parse(m.for) !== Date.parse(a.activatedAt)) return false;
  return m.reason === 'quota' || m.reason === 'erro' || !m.done;
}

/* ───────────────────────── Prévia a partir da lista ───────────────────────── */

export function EmailPreviewModal({ a, onClose }: { a: AdminAnnouncement; onClose: () => void }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[96] flex items-start justify-center overflow-y-auto p-4 md:p-8" role="dialog" aria-modal="true" aria-label="Prévia do e-mail" data-ann-preview>
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-[720px] rounded-[24px] p-5" style={{ background: 'rgb(var(--bg-soft))', boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.08), 0 40px 90px -40px rgb(0 0 0 / 0.9)' }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="font-tech text-[15px] font-semibold text-text">Prévia do e-mail</p>
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              value={device}
              onChange={setDevice}
              options={[
                { value: 'desktop', label: 'Computador' },
                { value: 'mobile', label: 'Celular' },
              ]}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar prévia"
              title="Fechar (Esc)"
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-[rgb(var(--text)/0.07)] hover:text-text"
              style={{ boxShadow: 'inset 0 0 0 1px rgb(var(--text) / 0.1)' }}
            >
              <I.close size={15} />
            </button>
          </div>
        </div>
        <EmailPreview kind={a.kind} content={a.content} endsAt={a.endsAt} device={device} />
      </div>
    </div>,
    document.body,
  );
}
