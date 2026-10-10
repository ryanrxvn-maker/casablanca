/**
 * E-mail dos avisos (09.10): templates, aviso → e-mail, quem recebe, link de
 * sair da lista e a regra "1 vez por ativação".
 *
 * Roda com: npx tsx lib/email.test.ts
 */
import { readFileSync } from 'node:fs';
import { renderEmail, EMAIL_TEMPLATES, type EmailMessage } from './email-templates';
import {
  absoluteUrl,
  afterCursor,
  autoTemplate,
  batchKey,
  emailFromAnnouncement,
  firstName,
  FREE_DAILY,
  FREE_RESERVE,
  nextBatchSize,
  orderKey,
  pickRecipients,
  roomToday,
  type Person,
} from './announcement-email';
import { optoutToken, optoutUrl, verifyOptout } from './email-optout';
import { cleanAudience, cleanContent, emptyContent, mailDoneFor, readMailLog, readMailQuota, type PromoContent, type Viewer } from './announcements';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) falhas++;
};
const ler = (f: string) => readFileSync(f, 'utf8');
const SITE = 'https://www.darkoautoedit.com';
const opts = { siteUrl: SITE, unsubscribeUrl: `${SITE}/api/email/sair?u=u1&t=abc`, firstName: 'Ana' };

console.log('templates');
{
  const base: EmailMessage = {
    template: 'oferta',
    subject: 'Assunto',
    preheader: 'Pré-texto aqui',
    accent: '#A291E0',
    badge: 'Selo',
    title: 'Título <script>alert(1)</script>',
    body: 'Linha 1\nLinha 2\n\nParágrafo 2 & "aspas"',
    bullets: ['Um', 'Dois'],
    priceOld: 'R$ 97',
    priceNew: 'R$ 57',
    priceNote: '/mês',
    ctaLabel: 'Quero',
    ctaUrl: `${SITE}/planos`,
    imageUrl: `${SITE}/email/arte-violeta.jpg`,
  };
  for (const t of EMAIL_TEMPLATES) {
    const { html, text } = renderEmail({ ...base, template: t }, opts);
    ok(!/<script/i.test(html) && html.includes('&lt;script&gt;'), `${t}: texto do admin escapado (nada de HTML injetado)`);
    ok(html.includes(opts.unsubscribeUrl.replace(/&/g, '&amp;')) && text.includes(opts.unsubscribeUrl), `${t}: link de sair no HTML e no texto puro`);
    ok(html.includes('Pré-texto aqui') && html.includes('display:none'), `${t}: pré-texto escondido no topo`);
    ok(html.includes('Oi, Ana') && text.startsWith('Oi, Ana'), `${t}: saudação com o primeiro nome`);
    ok(/<meta name="color-scheme" content="dark">/.test(html) && /@media \(max-width:620px\)/.test(html), `${t}: modo escuro declarado + ajuste de celular`);
  }
  const of = renderEmail(base, opts).html;
  ok(of.includes(base.imageUrl!) && of.includes('R$ 57') && of.includes('de R$ 97'), 'oferta: imagem, preço "por" e "de"');
  ok(of.includes('Linha 1<br>Linha 2') && of.includes('&amp; &quot;aspas&quot;'), 'texto: quebra vira <br>, parágrafos separados, & e aspas escapados');
  const semLink = renderEmail({ ...base, template: 'comunicado', ctaUrl: undefined }, opts).html;
  ok(!semLink.includes('&#8599;'), 'botão só aparece com link');
  const http = renderEmail({ ...base, imageUrl: 'http://inseguro.com/a.jpg' }, opts).html;
  ok(!http.includes('inseguro.com'), 'imagem sem https não entra');
  ok(renderEmail({ ...base, imageUrl: 'http://localhost:3000/email/arte-lima.jpg' }, opts).html.includes('localhost:3000/email/arte-lima.jpg'), 'http só pra localhost (prévia no servidor local)');
  const semNome = renderEmail(base, { ...opts, firstName: null });
  ok(!semNome.html.includes('Oi,') && !semNome.text.includes('Oi,'), 'sem nome = sem saudação (nada de "Oi, ")');
}

console.log('aviso → e-mail');
{
  const aviso = { ...emptyContent('aviso'), tone: 'atencao' as const, title: 'Manutenção', body: 'Às 23h', ctaLabel: 'Ver', ctaUrl: '/tools/notificacoes' };
  const ma = emailFromAnnouncement({ kind: 'aviso', content: aviso }, SITE);
  ok(ma.template === 'comunicado' && ma.accent === '#EBC860' && ma.toneLabel === 'Atenção', 'aviso → Comunicado com a cor e o nome do tom');
  ok(ma.ctaUrl === `${SITE}/tools/notificacoes`, 'link do site vira endereço completo');
  const promo: PromoContent = { ...emptyContent('propaganda'), title: 'Pilot', body: 'x', art: 'pilot', imageUrl: 'https://cdn.x.com/a.jpg' };
  const mp = emailFromAnnouncement({ kind: 'propaganda', content: promo }, SITE);
  ok(mp.template === 'lancamento' && mp.imageUrl === `${SITE}/email/pilot-hero.jpg`, 'propaganda com a cena do Pilot → Lançamento com o quadro do herói');
  const mo = emailFromAnnouncement({ kind: 'propaganda', content: { ...promo, art: 'tema', theme: 'lima' } }, SITE);
  ok(mo.template === 'oferta' && mo.imageUrl === 'https://cdn.x.com/a.jpg' && mo.accent === '#C8D684', 'propaganda com imagem → Oferta com a imagem enviada e a cor do tema');
  const mt = emailFromAnnouncement({ kind: 'propaganda', content: { ...promo, art: 'tema', imageUrl: '', theme: 'rosa' } }, SITE);
  ok(mt.imageUrl === `${SITE}/email/arte-rosa.jpg`, 'sem imagem → arte do tema na cor');
  const mm = emailFromAnnouncement({ kind: 'propaganda', content: { ...promo, mail: { template: 'comunicado', subject: 'Assunto X', preheader: 'Pre Y' } } }, SITE);
  ok(mm.template === 'comunicado' && mm.subject === 'Assunto X' && mm.preheader === 'Pre Y' && !mm.imageUrl, 'modelo E-mail: template, assunto e pré-texto escolhidos; Comunicado sem imagem');
  const ends = new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString();
  ok(/^Termina em 2 d/.test(emailFromAnnouncement({ kind: 'propaganda', content: promo, endsAt: ends }, SITE).deadline ?? ''), 'prazo vira "Termina em …"');
  ok(autoTemplate('aviso', aviso) === 'comunicado' && autoTemplate('propaganda', { ...promo, art: 'tema' }) === 'oferta', 'template automático do envelope');
  ok(absoluteUrl('javascript:alert(1)', SITE) === '' && absoluteUrl('//evil.com', SITE) === '' && absoluteUrl('http://x.com', SITE) === '', 'link perigoso some');
}

console.log('quem recebe');
{
  const v = (id: string, email: string | null, extra: Partial<Viewer> = {}): Viewer => ({ id, email, isAdmin: false, isActive: true, plan: 'free', access: 'free', beta: false, ...extra });
  const people: Person[] = [
    { viewer: v('c', 'c@x.com'), name: 'Carla', createdAt: '2026-03-01T00:00:00Z' },
    { viewer: v('a', 'a@x.com'), name: 'Ana Maria', createdAt: '2026-01-01T00:00:00Z' },
    { viewer: v('b', 'B@X.COM'), name: null, createdAt: '2026-02-01T00:00:00Z' },
    { viewer: v('d', 'd@x.com', { isActive: false }), name: 'Desativado', createdAt: '2026-01-05T00:00:00Z' },
    { viewer: v('e', 'e@x.com', { plan: 'premium', access: 'paid' }), name: 'Pago', createdAt: '2026-01-06T00:00:00Z' },
    { viewer: v('f', 'a@x.com'), name: 'Mesmo email', createdAt: '2026-04-01T00:00:00Z' },
    { viewer: v('g', null), name: 'Sem email', createdAt: '2026-01-02T00:00:00Z' },
    { viewer: v('h', 'h@x.com', { isAdmin: true }), name: 'Admin', createdAt: '2026-01-03T00:00:00Z' },
  ];
  const free = pickRecipients(people, cleanAudience({ segments: ['free'] }), new Set(['c']));
  ok(free.list.map((r) => r.id).join() === 'a,b', 'público Free: em ordem de cadastro, sem inativo, sem quem saiu, sem pago, sem admin, sem e-mail repetido nem vazio');
  ok(free.optOut === 1, 'conta quem ficou de fora por ter saído da lista');
  ok(free.list[1].email === 'b@x.com', 'e-mail normalizado (minúsculo)');
  const comAdmin = pickRecipients(people, cleanAudience({ segments: ['all'], includeAdmins: true }), new Set());
  ok(comAdmin.list.some((r) => r.id === 'h') && comAdmin.list.some((r) => r.id === 'e'), '"todos + admins" inclui pago e admin');
  ok(firstName('Ana Maria Souza') === 'Ana' && firstName('JOÃO') === 'João' && firstName('x@y.com') === null && firstName('') === null, 'primeiro nome pra saudação (e-mail no campo de nome não vira "Oi, x@y.com")');
  const lote = [{ id: 'a' }, { id: 'x' }, { id: 'b' }];
  ok(batchKey('id1', '2026-10-09T15:13:49.870Z', lote) === `ann-id1-${Date.parse('2026-10-09T15:13:49.870Z')}-a-b-3`, 'chave do lote = aviso + ativação + quem está nele (repetir o mesmo lote não duplica)');
  ok(batchKey('id1', '2026-10-09T15:13:49.87+00:00', lote) === batchKey('id1', '2026-10-09T15:13:49.870Z', lote), 'mesma ativação em formatos de data diferentes = mesma chave');
  ok(batchKey('id1', '2026-10-09T15:13:49.870Z', lote).length <= 256, 'chave cabe no limite do Resend (256)');
  ok(free.list[0].key < free.list[1].key && free.list[0].key === orderKey('2026-01-01T00:00:00Z', 'a'), 'cada destinatário tem chave de ordem crescente (cadastro + id)');
  ok(afterCursor(comAdmin.list, comAdmin.list[2].key).map((r) => r.id).join() === comAdmin.list.slice(3).map((r) => r.id).join(), 'retomada = só quem vem DEPOIS do marcador');
  ok(afterCursor(comAdmin.list, null).length === comAdmin.list.length, 'sem marcador = todo mundo');
  ok(orderKey('2026-01-01T00:00:00Z', 'z') < orderKey('2026-01-01T00:00:00.001Z', 'a'), 'ordem pela data primeiro, id desempata');
}

console.log('cota do Resend');
{
  ok(roomToday(null) === Infinity && roomToday({ daily: null }) === Infinity, 'plano pago (sem cabeçalho diário) = sem limite do dia');
  ok(roomToday({ daily: 7 }) === FREE_DAILY - FREE_RESERVE - 7 && roomToday({ daily: 95 }) === 0, `plano grátis: folga = ${FREE_DAILY} − reserva de ${FREE_RESERVE} − usados`);
  ok(nextBatchSize(false, Infinity) === 1 && nextBatchSize(true, Infinity) === 100 && nextBatchSize(true, 37) === 37 && nextBatchSize(true, 0) === 0, 'sonda de 1, depois até 100 sem passar da folga');
  const l = readMailLog({ for: 'x', total: 1, sent: 1, cursor: '000001|a', quota: { daily: 3, monthly: 9, at: 'y' } });
  ok(l?.cursor === '000001|a' && l?.quota?.daily === 3 && l?.quota?.monthly === 9, 'registro guarda marcador e cota');
  const antigo = readMailLog({ for: 'x', total: 1, sent: 1 });
  ok(antigo?.cursor === null && antigo?.quota === null, 'registro antigo (sem os campos) lê como vazio');
  ok(readMailQuota({ daily: -1, monthly: 'x' }) === null && readMailQuota({ daily: null, monthly: 4 })?.daily === null, 'cota inválida não vira número');
  ok(readMailLog({ cursor: 'x'.repeat(200) })?.cursor === null, 'marcador absurdo é descartado');
}

console.log('sair da lista');
{
  const k = 'segredo-de-teste';
  const t = optoutToken('user-1', k)!;
  ok(t.length === 32 && verifyOptout('user-1', t, k), 'link assinado confere');
  ok(!verifyOptout('user-2', t, k), 'assinatura de uma conta não serve pra outra');
  ok(!verifyOptout('user-1', t.slice(0, 31) + (t.endsWith('a') ? 'b' : 'a'), k), 'assinatura adulterada não passa');
  ok(!verifyOptout('user-1', t, null) && optoutToken('user-1', null) === null, 'sem segredo no servidor, nada passa');
  ok(optoutUrl(SITE, 'user-1', k) === `${SITE}/api/email/sair?u=user-1&t=${t}`, 'URL do rodapé');
}

console.log('1 e-mail por ativação');
{
  const act = '2026-10-09T15:13:49.870Z';
  const feito = readMailLog({ for: '2026-10-09T15:13:49.87+00:00', total: 10, sent: 10, failed: 0, optOut: 1, reason: null, at: act, done: true });
  ok(mailDoneFor(feito, act), 'mesma ativação (formatos de data diferentes) já teve e-mail → não manda de novo');
  ok(!mailDoneFor(feito, '2026-10-10T10:00:00.000Z'), 'desativou e ativou (ativação nova) → manda de novo');
  ok(!mailDoneFor(readMailLog({ ...feito, reason: 'quota' }), act), 'parou por cota → ainda dá pra continuar ("Tentar o resto")');
  ok(!mailDoneFor(null, act) && !mailDoneFor(feito, null), 'sem registro / sem ativação → não conta como enviado');
  ok(cleanAudience({ segments: ['all'], email: 'also' }).email === 'also' && cleanAudience({ email: 'lixo' }).email === 'off' && cleanAudience({}).email === 'off', 'modo de e-mail do público: só off/also/only');
  ok(!('mailLog' in cleanAudience({ segments: ['all'], mailLog: { sent: 99 } })), 'o painel não consegue forjar o registro de envio');
  const c = cleanContent('propaganda', { title: 'T', mail: { template: 'nada', subject: '', preheader: ' P ' } });
  ok(c.ok && (c.value as PromoContent).mail?.template === 'oferta' && (c.value as PromoContent).mail?.subject === 'T' && (c.value as PromoContent).mail?.preheader === 'P', 'ajustes do e-mail: template conhecido, assunto vazio = título, pré-texto limpo');
  const sem = cleanContent('propaganda', { title: 'T' });
  ok(sem.ok && !('mail' in sem.value), 'propaganda sem e-mail não ganha ajustes de e-mail');
}

console.log('fiação');
{
  const r = ler('app/api/admin/announcements/route.ts');
  const patch = r.slice(r.indexOf('export async function PATCH('), r.indexOf('export async function DELETE('));
  const pause = patch.slice(patch.indexOf("action === 'pause'"), patch.indexOf("action === 'republish'"));
  ok(!/mailAfter/.test(pause), 'pausar não manda e-mail');
  for (const a of ["action === 'activate'", "action === 'republish'", "action === 'send'"]) {
    const blk = patch.slice(patch.indexOf(a), patch.indexOf('} else if', patch.indexOf(a) + 5));
    ok(/mailAfter = 'due'/.test(blk), `${a.replace("action === ", '')} manda o e-mail da ativação (se ainda não saiu)`);
  }
  ok(/mailAfter = 'force'/.test(patch.slice(patch.indexOf("action === 'resume'"))), 'resume continua (não duplica: marcador + idempotência por lote)');
  ok(/if \(mode === 'only'\) return jsonError\('E-mail não fica no ar no site/.test(patch), 'modelo E-mail nunca vira janela no site');
  ok(/const prev = rawMailLog\(row\.audience\);\s*if \(!force && mailDoneFor\(prev, row\.activated_at\)\)/.test(r), 'regra "1 vez por ativação" na rota');
  ok(/deliverMail\(svc, \{ id: row\.id,[^)]*\}, \{ prev \}\)/.test(r), 'retomada passa o registro anterior (continua depois do marcador)');
  ok(/return NextResponse\.json\(\{ ok: true, to: me\.email, quota: log\.quota \}\)/.test(r), 'teste devolve a cota lida (plano do Resend antes do disparo)');
  ok(/audienceForDb\(audience, rawMailLog\(cur\.row\.audience\)\)/.test(r), 'editar o público não apaga o registro do envio');
  const post = r.slice(r.indexOf('export async function POST('), r.indexOf('export async function PATCH('));
  ok(/body\.test === true[\s\S]*?\{ test: me \}/.test(post) && !/writeMailLog/.test(post.slice(post.indexOf('body.test === true'), post.indexOf('// Modelo "E-mail"'))), 'teste vai só pro admin e não grava nada');

  const mail = ler('lib/announcements-mail.ts');
  ok(/'List-Unsubscribe': `<\$\{unsubscribe\}>`/.test(mail) && /'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'/.test(mail), 'cabeçalho de "cancelar inscrição" de 1 clique (Gmail/Apple)');
  ok(/'Idempotency-Key': idem/.test(mail) && /batchKey\(job\.id, job\.activatedAt, slice\)/.test(mail), 'lotes com chave de idempotência por ativação + quem está no lote');
  ok(/afterCursor\(r\.list, base\.cursor\)/.test(mail) && /base\.cursor = slice\[slice\.length - 1\]\.key/.test(mail), 'marcador: continua depois de quem já foi e avança só com lote aceito');

  const sair = ler('app/api/email/sair/route.ts');
  const get = sair.slice(sair.indexOf('export async function GET('), sair.indexOf('export async function POST('));
  ok(!/updateUserById/.test(get), 'abrir o link (GET) nunca descadastra — antivírus de e-mail abre link sozinho');
  ok(/verifyOptout\(u, t\)/.test(sair.slice(sair.indexOf('export async function POST('))), 'descadastrar exige a assinatura');
  const mw = ler('lib/supabase/middleware.ts');
  ok(/pathname\.startsWith\('\/api\/'\) && pathname !== '\/api\/email\/sair'/.test(mw), 'middleware só abre exceção de Origin pro caminho exato do descadastro');

  const notif = ler('app/api/user/notifications/route.ts');
  ok(/viewerFromProfile\(/.test(notif), 'sino e e-mail usam a MESMA regra de público (viewerFromProfile)');
}

if (falhas) {
  console.error(`\n${falhas} falha(s) em email`);
  process.exit(1);
}
console.log('\nemail: tudo ok');
