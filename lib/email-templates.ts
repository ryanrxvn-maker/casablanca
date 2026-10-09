/**
 * E-MAIL DOS AVISOS (09.10) — os 3 templates, parte PURA (sem rede).
 *
 *   • comunicado → recado direto (aviso): selo do tom, título, texto, botão.
 *   • oferta     → propaganda: imagem, selo, título, texto, destaques, preço
 *                  "de/por", prazo e botão grande.
 *   • lancamento → novidade grande: cena cinematográfica em cima, título
 *                  enorme, destaques em blocos numerados e botão.
 *
 * Por que assim: e-mail não é página. Gmail/Outlook ignoram <style> externo,
 * flex e grid; só tabela + estilo inline funciona em todo lugar. O Gmail do
 * celular no modo escuro inverte cores — as classes gm-* (truque do mix-blend)
 * seguram o texto branco. Todo texto do admin passa por esc(): nada de HTML
 * injetado. Testado em lib/email-templates.test.ts.
 */

export const EMAIL_TEMPLATES = ['comunicado', 'oferta', 'lancamento'] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export const EMAIL_TEMPLATE_META: Record<EmailTemplate, { label: string; hint: string }> = {
  comunicado: { label: 'Comunicado', hint: 'Recado direto: título, texto e botão.' },
  oferta: { label: 'Oferta', hint: 'Imagem, destaques, preço e botão grande.' },
  lancamento: { label: 'Lançamento', hint: 'Cena de cinema, título enorme e blocos.' },
};

export type EmailMessage = {
  template: EmailTemplate;
  subject: string;
  /** texto cinza que aparece ao lado do assunto na caixa de entrada */
  preheader: string;
  /** cor de destaque (hex #rrggbb) */
  accent: string;
  /** nome do tom/selo do comunicado ("Novidade", "Atenção"...) */
  toneLabel?: string;
  badge?: string;
  title: string;
  body: string;
  bullets?: string[];
  priceOld?: string;
  priceNew?: string;
  priceNote?: string;
  ctaLabel?: string;
  /** link ABSOLUTO (https://...) */
  ctaUrl?: string;
  /** imagem ABSOLUTA (https://...) */
  imageUrl?: string;
  /** "Termina em 2 d 04 h" já formatado */
  deadline?: string;
};

export type EmailRenderOpts = {
  /** https://www.darkoautoedit.com */
  siteUrl: string;
  /** link assinado de descadastro (vai no rodapé e no cabeçalho List-Unsubscribe) */
  unsubscribeUrl: string;
  /** primeiro nome de quem recebe (opcional) */
  firstName?: string | null;
};

/* ───────────────────────── Paleta e tipografia ───────────────────────── */

const C = {
  page: '#09090b',
  card: '#121217',
  cardLine: '#24242c',
  soft: '#18181f',
  text: '#ffffff',
  body: '#b8b8c6',
  muted: '#7d7d8c',
  dim: '#55555f',
};
const FONT = "'Inter','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";

/* ───────────────────────── Texto seguro ───────────────────────── */

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Parágrafos do texto (linha em branco separa; quebra simples vira <br>). */
function paragraphs(s: string, style: string): string {
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${style}">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Só https vira link/imagem; o resto some (defesa extra: o servidor já limpa).
 * http só pra localhost: a prévia do painel no servidor local (e-mail de
 * verdade sai com o endereço https do site, nunca localhost).
 */
export function safeHttps(u: string | undefined | null): string {
  if (!u) return '';
  try {
    const url = new URL(u);
    if (url.protocol === 'https:') return url.toString();
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1') ? url.toString() : '';
  } catch {
    return '';
  }
}

/** #rrggbb → "r,g,b" pra rgba() */
function rgb(hex: string): string {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? 'a291e0';
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}

/** texto branco protegido da inversão do Gmail escuro */
const gm = (inner: string) => `<span class="gm-screen"><span class="gm-diff">${inner}</span></span>`;

/* ───────────────────────── Peças ───────────────────────── */

function button(label: string, url: string, accent: string, full = false): string {
  if (!label || !url) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${full ? 'width="100%"' : ''} style="border-collapse:separate;${full ? 'width:100%;' : ''}">
  <tr><td align="center" bgcolor="${accent}" style="border-radius:14px;background:${accent};box-shadow:0 14px 30px -12px rgba(${rgb(accent)},.75);">
    <a href="${esc(url)}" target="_blank" style="display:block;padding:16px 28px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:#0a0a0c;text-decoration:none;border-radius:14px;letter-spacing:-0.005em;">${esc(label)}&nbsp;&nbsp;&#8599;</a>
  </td></tr>
</table>`;
}

function pill(label: string, accent: string): string {
  if (!label) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
  <tr><td style="padding:6px 12px 6px 10px;border-radius:999px;background:rgba(${rgb(accent)},.12);border:1px solid rgba(${rgb(accent)},.35);font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;color:${accent};letter-spacing:.01em;">
    <span style="display:inline-block;width:6px;height:6px;border-radius:6px;background:${accent};vertical-align:middle;margin-right:7px;"></span><span style="vertical-align:middle;">${esc(label)}</span>
  </td></tr>
</table>`;
}

function bulletsList(items: string[], accent: string): string {
  if (!items.length) return '';
  const rows = items
    .map(
      (b) => `<tr>
  <td width="30" valign="top" style="padding:0 0 12px 0;">
    <div style="width:22px;height:22px;line-height:22px;border-radius:22px;text-align:center;background:rgba(${rgb(accent)},.14);border:1px solid rgba(${rgb(accent)},.4);color:${accent};font-family:${FONT};font-size:12px;font-weight:800;">&#10003;</div>
  </td>
  <td valign="top" style="padding:1px 0 12px 8px;font-family:${FONT};font-size:15px;line-height:22px;color:#e9e9f1;font-weight:500;">${gm(esc(b))}</td>
</tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:22px;">${rows}</table>`;
}

function priceBox(m: EmailMessage): string {
  if (!m.priceNew) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:22px;border-collapse:separate;">
  <tr><td style="padding:18px 20px;border-radius:16px;background:${C.soft};border:1px solid ${C.cardLine};">
    ${m.priceOld ? `<span style="font-family:${FONT};font-size:14px;color:${C.muted};text-decoration:line-through;">de ${esc(m.priceOld)}</span><br>` : ''}
    <span style="font-family:${FONT};font-size:34px;line-height:40px;font-weight:800;color:${m.accent};letter-spacing:-0.03em;">${esc(m.priceNew)}</span>
    ${m.priceNote ? `<span style="font-family:${FONT};font-size:14px;color:${C.body};">&nbsp;${esc(m.priceNote)}</span>` : ''}
  </td></tr>
</table>`;
}

function header(opts: EmailRenderOpts): string {
  const logo = `${opts.siteUrl}/auto-edit-logo@128.png`;
  return `<tr><td align="center" style="padding:6px 0 26px 0;">
  <a href="${esc(opts.siteUrl)}" target="_blank" style="text-decoration:none;">
    <img src="${esc(logo)}" width="36" height="36" alt="Auto Edit" style="display:inline-block;vertical-align:middle;border:0;width:36px;height:36px;">
    <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:.02em;color:#ffffff;">${gm('Auto Edit')}</span>
  </a>
</td></tr>`;
}

function footer(opts: EmailRenderOpts): string {
  return `<tr><td align="center" style="padding:28px 24px 8px 24px;font-family:${FONT};font-size:12px;line-height:19px;color:${C.dim};">
  Você recebeu porque tem conta no <a href="${esc(opts.siteUrl)}" target="_blank" style="color:${C.muted};text-decoration:underline;">Auto Edit</a>.<br>
  <a href="${esc(opts.unsubscribeUrl)}" target="_blank" style="color:${C.muted};text-decoration:underline;">Não quero mais receber estes e-mails</a>
</td></tr>`;
}

function hello(opts: EmailRenderOpts): string {
  const n = (opts.firstName ?? '').trim();
  return n ? `<p style="margin:0 0 10px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">Oi, ${esc(n)}</p>` : '';
}

/* ───────────────────────── Templates ───────────────────────── */

const titleStyle = (size: number, line: number) =>
  `margin:0;font-family:${FONT};font-size:${size}px;line-height:${line}px;font-weight:800;letter-spacing:-0.025em;color:#ffffff;`;
const bodyStyle = `margin:14px 0 0 0;font-family:${FONT};font-size:15px;line-height:25px;color:${C.body};`;

function comunicado(m: EmailMessage, o: EmailRenderOpts): string {
  return `<tr><td class="px" style="padding:34px 36px 36px 36px;border-radius:24px;background:${C.card};border:1px solid ${C.cardLine};border-top:1px solid rgba(${rgb(m.accent)},.55);">
  ${hello(o)}
  ${pill(m.toneLabel || m.badge || '', m.accent)}
  <h1 class="h1" style="${titleStyle(26, 33)}margin-top:${m.toneLabel || m.badge ? 18 : 0}px;">${gm(esc(m.title))}</h1>
  ${paragraphs(m.body, bodyStyle)}
  ${m.ctaLabel && m.ctaUrl ? `<div style="margin-top:28px;">${button(m.ctaLabel, m.ctaUrl, m.accent)}</div>` : ''}
</td></tr>`;
}

function oferta(m: EmailMessage, o: EmailRenderOpts): string {
  const img = safeHttps(m.imageUrl);
  return `<tr><td style="border-radius:24px;background:${C.card};border:1px solid ${C.cardLine};overflow:hidden;">
  ${img ? `<img src="${esc(img)}" width="598" alt="" style="display:block;width:100%;max-width:598px;height:auto;border:0;border-radius:23px 23px 0 0;">` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td class="px" style="padding:30px 36px 36px 36px;">
    ${hello(o)}
    ${m.badge || m.deadline ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${m.badge ? `<td style="padding-right:10px;">${pill(m.badge, m.accent)}</td>` : ''}${m.deadline ? `<td style="font-family:${FONT};font-size:12px;font-weight:600;color:${C.body};">&#9201; ${esc(m.deadline)}</td>` : ''}</tr></table>` : ''}
    <h1 class="h1" style="${titleStyle(30, 36)}margin-top:${m.badge || m.deadline ? 18 : 0}px;">${gm(esc(m.title))}</h1>
    ${paragraphs(m.body, bodyStyle)}
    ${bulletsList(m.bullets ?? [], m.accent)}
    ${priceBox(m)}
    ${m.ctaLabel && m.ctaUrl ? `<div style="margin-top:28px;">${button(m.ctaLabel, m.ctaUrl, m.accent, true)}</div>` : ''}
  </td></tr></table>
</td></tr>`;
}

function lancamento(m: EmailMessage, o: EmailRenderOpts): string {
  const img = safeHttps(m.imageUrl);
  const items = (m.bullets ?? []).filter(Boolean);
  const tiles = items.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:26px;border-collapse:separate;border-spacing:0 10px;">${items
        .map(
          (b, i) => `<tr><td style="padding:16px 18px;border-radius:16px;background:${C.soft};border:1px solid ${C.cardLine};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
    <td width="44" valign="middle" style="font-family:${FONT};font-size:13px;font-weight:800;letter-spacing:.06em;color:${m.accent};">0${i + 1}</td>
    <td valign="middle" style="font-family:${FONT};font-size:15px;line-height:22px;font-weight:600;color:#ececf3;">${gm(esc(b))}</td>
  </tr></table>
</td></tr>`,
        )
        .join('')}</table>`
    : '';
  return `<tr><td style="border-radius:26px;background:${C.card};border:1px solid ${C.cardLine};overflow:hidden;">
  ${img ? `<img src="${esc(img)}" width="598" alt="" style="display:block;width:100%;max-width:598px;height:auto;border:0;border-radius:25px 25px 0 0;">` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td class="px" align="center" style="padding:34px 40px 40px 40px;text-align:center;">
    ${hello(o)}
    ${m.badge ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td>${pill(m.badge, m.accent)}</td></tr></table>` : ''}
    <h1 class="h1" style="${titleStyle(34, 40)}margin-top:${m.badge ? 20 : 0}px;text-align:center;">${gm(esc(m.title))}</h1>
    <div style="text-align:center;">${paragraphs(m.body, bodyStyle + 'text-align:center;')}</div>
    <div style="text-align:left;">${tiles}</div>
    ${m.ctaLabel && m.ctaUrl ? `<div style="margin-top:28px;">${button(m.ctaLabel, m.ctaUrl, m.accent, true)}</div>` : ''}
  </td></tr></table>
</td></tr>`;
}

/* ───────────────────────── Documento ───────────────────────── */

export function renderEmail(m: EmailMessage, o: EmailRenderOpts): { html: string; text: string } {
  const body = m.template === 'oferta' ? oferta(m, o) : m.template === 'lancamento' ? lancamento(m, o) : comunicado(m, o);
  // pré-cabeçalho + "respiro" invisível pra o cliente não puxar o resto do texto pro lado do assunto
  const pad = '&#847;&zwnj;&nbsp;'.repeat(60);
  const html = `<!doctype html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(m.subject)}</title>
<style>
:root{color-scheme:dark;supported-color-schemes:dark}
body{margin:0!important;padding:0!important;background:${C.page}}
a{text-decoration:none}
img{-ms-interpolation-mode:bicubic}
@media (max-width:620px){
  .wrap{padding:20px 10px!important}
  .px{padding-left:22px!important;padding-right:22px!important}
  .h1{font-size:26px!important;line-height:32px!important}
}
u + .body .gm-screen{background:#000;mix-blend-mode:screen}
u + .body .gm-diff{background:#000;mix-blend-mode:difference}
</style>
</head>
<body class="body" style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${esc(m.preheader)}${pad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
  <tr><td align="center" class="wrap" style="padding:36px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      ${header(o)}
      ${body}
      ${footer(o)}
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const lines = [
    o.firstName ? `Oi, ${o.firstName}` : '',
    m.badge || m.toneLabel || '',
    m.title,
    '',
    m.body,
    ...(m.bullets ?? []).map((b) => `• ${b}`),
    m.priceNew ? `${m.priceOld ? `de ${m.priceOld} ` : ''}por ${m.priceNew}${m.priceNote ? ` ${m.priceNote}` : ''}` : '',
    m.deadline ?? '',
    m.ctaLabel && m.ctaUrl ? `${m.ctaLabel}: ${m.ctaUrl}` : '',
    '',
    '—',
    'Auto Edit',
    `Não quero mais receber: ${o.unsubscribeUrl}`,
  ];
  const text = lines
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n')
    .replace(/^\n+/, '')
    .trim();
  return { html, text };
}
