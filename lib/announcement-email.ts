/**
 * Aviso/propaganda → e-mail (parte PURA). Decide o template, as cores, as
 * imagens e os links absolutos a partir do mesmo conteúdo da janela.
 *
 * "Também por e-mail" (botão do envelope): template automático —
 *   aviso → Comunicado · propaganda com a cena do Pilot → Lançamento (com o
 *   quadro do herói) · propaganda → Oferta (imagem enviada ou arte do tema).
 * Modelo "E-mail" da central: o admin escolhe o template (content.mail).
 */

import {
  matchesAudience,
  normalizeEmail,
  TONE_META,
  timeLeft,
  type AnnKind,
  type AnnContent,
  type Audience,
  type AvisoContent,
  type AvisoTone,
  type PromoContent,
  type PromoTheme,
  type Viewer,
} from './announcements';
import type { EmailMessage, EmailTemplate } from './email-templates';

export const THEME_HEX: Record<PromoTheme, string> = {
  violeta: '#A291E0',
  lima: '#C8D684',
  ciano: '#7ED5E2',
  ambar: '#EBC860',
  rosa: '#E084B0',
};

export const TONE_HEX: Record<AvisoTone, string> = {
  info: '#7ED5E2',
  novidade: '#A291E0',
  sucesso: '#C8D684',
  atencao: '#EBC860',
  urgente: '#E85C68',
};

/** Arte do tema e quadro do Pilot (public/email/*, mesmas peças da janela). */
export function emailArtUrl(site: string, theme: PromoTheme): string {
  return `${site}/email/arte-${theme}.jpg`;
}
export function pilotHeroUrl(site: string): string {
  return `${site}/email/pilot-hero.jpg`;
}

/** "/planos" → "https://site/planos"; https fica; qualquer outra coisa some. */
export function absoluteUrl(u: string | undefined | null, site: string): string {
  const s = (u ?? '').trim();
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return `${site}${s}`;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/** Template automático do "também por e-mail". */
export function autoTemplate(kind: AnnKind, content: AnnContent): EmailTemplate {
  if (kind === 'aviso') return 'comunicado';
  return (content as PromoContent).art === 'pilot' ? 'lancamento' : 'oferta';
}

/* ───────────────────────── Quem recebe ───────────────────────── */

export type Recipient = { id: string; email: string; name: string | null };
export type Person = { viewer: Viewer; name: string | null; createdAt: string };

/**
 * Mesma regra de público da janela (matchesAudience: conta ativa, plano,
 * e-mails avulsos, admins se pedido) + e-mail válido, sem repetir e-mail e
 * sem quem pediu pra sair. Ordem de CADASTRO: quem entra depois vai pro fim,
 * então os lotes já enviados não mudam numa retomada.
 */
export function pickRecipients(people: Person[], audience: Audience, optOut: Set<string>): { list: Recipient[]; optOut: number } {
  const sorted = [...people].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.viewer.id.localeCompare(b.viewer.id));
  const seen = new Set<string>();
  const list: Recipient[] = [];
  let out = 0;
  for (const p of sorted) {
    const email = normalizeEmail(p.viewer.email);
    if (!email || !matchesAudience(audience, p.viewer)) continue;
    if (optOut.has(p.viewer.id)) {
      out++;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    list.push({ id: p.viewer.id, email, name: p.name });
  }
  return { list, optOut: out };
}

/** "Maria Clara Souza" → "Maria" (saudação do e-mail); vazio/esquisito → null. */
export function firstName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim().split(/\s+/)[0] ?? '';
  if (!n || n.length > 24 || /[@\d]/.test(n)) return null;
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

/** Chave de idempotência de um lote: repetir o envio da MESMA ativação não duplica e-mail. */
export function batchKey(annId: string, activatedAt: string, index: number): string {
  return `ann-${annId}-${Date.parse(activatedAt) || 0}-${index}`;
}

function excerpt(s: string, max = 140): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

export function emailFromAnnouncement(
  a: { kind: AnnKind; content: AnnContent; endsAt?: string | null },
  site: string,
  now = Date.now(),
): EmailMessage {
  const left = a.endsAt ? timeLeft(a.endsAt, now) : null;
  const deadline = left ? `Termina em ${left}` : undefined;

  if (a.kind === 'aviso') {
    const c = a.content as AvisoContent;
    return {
      template: 'comunicado',
      subject: c.title,
      preheader: excerpt(c.body || c.title),
      accent: TONE_HEX[c.tone] ?? TONE_HEX.novidade,
      toneLabel: TONE_META[c.tone]?.label,
      title: c.title,
      body: c.body,
      ctaLabel: c.ctaLabel || undefined,
      ctaUrl: absoluteUrl(c.ctaUrl, site) || undefined,
      deadline,
    };
  }

  const c = a.content as PromoContent;
  const template = c.mail?.template ?? autoTemplate(a.kind, c);
  const image =
    template === 'comunicado'
      ? ''
      : c.art === 'pilot'
        ? pilotHeroUrl(site)
        : absoluteUrl(c.imageUrl, site) || emailArtUrl(site, c.theme);
  return {
    template,
    subject: c.mail?.subject || c.title,
    preheader: c.mail?.preheader || excerpt(c.body || c.title),
    accent: THEME_HEX[c.theme] ?? THEME_HEX.violeta,
    toneLabel: template === 'comunicado' ? c.badge || undefined : undefined,
    badge: template === 'comunicado' ? undefined : c.badge || undefined,
    title: c.title,
    body: c.body,
    bullets: c.bullets.filter(Boolean),
    priceOld: c.priceOld || undefined,
    priceNew: c.priceNew || undefined,
    priceNote: c.priceNote || undefined,
    ctaLabel: c.ctaLabel || undefined,
    ctaUrl: absoluteUrl(c.ctaUrl, site) || undefined,
    imageUrl: image || undefined,
    deadline,
  };
}
