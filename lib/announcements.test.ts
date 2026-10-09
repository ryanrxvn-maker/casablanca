/**
 * Avisos e propagandas (09.10): quem recebe, quando a janela abre de novo,
 * e o que o servidor aceita gravar. Cada regra aqui é uma frase do pedido do
 * Silas — se uma quebrar, o aviso aparece pra quem não devia, some de quem
 * devia ou reabre sem parar.
 *
 * Roda com: npx tsx lib/announcements.test.ts
 */
import {
  addDismissedKey,
  audienceIsEmpty,
  audienceSummary,
  charCount,
  cleanAudience,
  cleanContent,
  cleanLine,
  cleanText,
  internalPath,
  isLive,
  matchesAudience,
  MAX_DISMISSED_KEYS,
  normalizeImage,
  normalizeLink,
  popupKey,
  readContent,
  seenFromInbox,
  sessionIdFromJwt,
  shouldPopup,
  sortPopups,
  timeLeft,
  type AvisoContent,
  type PromoContent,
  type Viewer,
} from './announcements';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) falhas++;
};

const base: Viewer = { id: 'u1', email: 'cliente@gmail.com', isAdmin: false, isActive: true, plan: 'free', access: 'free', beta: false };
const free = base;
const pago: Viewer = { ...base, id: 'u2', email: 'pago@gmail.com', plan: 'premium', access: 'paid' };
const liberado: Viewer = { ...base, id: 'u3', email: 'lib@gmail.com', plan: 'premium', access: 'granted' };
const pendente: Viewer = { ...base, id: 'u4', email: 'pend@gmail.com', plan: 'free', access: 'pending' };
const beta: Viewer = { ...base, id: 'u5', email: 'beta@gmail.com', beta: true };
const admin: Viewer = { ...base, id: 'a1', email: 'silas@gmail.com', isAdmin: true, plan: 'premium', access: 'granted' };
const inativo: Viewer = { ...pago, id: 'u6', isActive: false };

console.log('audiência');
{
  const todos = cleanAudience({ segments: ['all'] });
  ok([free, pago, liberado, pendente, beta].every((v) => matchesAudience(todos, v)), '"Todos" chega em todo cliente ativo');
  ok(!matchesAudience(todos, admin), '"Todos" não inclui admin (admin não é cliente)');
  ok(!matchesAudience(todos, inativo), 'conta desativada nunca recebe');
  ok(matchesAudience({ ...todos, includeAdmins: true }, admin), 'admin recebe quando marcado "admins também"');

  const soFree = cleanAudience({ segments: ['free'] });
  ok(matchesAudience(soFree, free) && matchesAudience(soFree, pendente) && matchesAudience(soFree, beta), 'Free = plano efetivo free (pendente e Beta Pro free inclusos)');
  ok(!matchesAudience(soFree, pago) && !matchesAudience(soFree, liberado), 'Free não chega em Premium');

  const premium = cleanAudience({ segments: ['premium'] });
  ok(matchesAudience(premium, pago) && matchesAudience(premium, liberado), 'Premium = pagantes + liberados');
  ok(!matchesAudience(premium, free) && !matchesAudience(premium, pendente), 'Premium não chega em Free/pendente');

  const pagantes = cleanAudience({ segments: ['paid'] });
  ok(matchesAudience(pagantes, pago) && !matchesAudience(pagantes, liberado), 'Pagantes = só quem paga no Stripe (liberado fica de fora)');

  const misto = cleanAudience({ segments: ['granted', 'pending'] });
  ok(matchesAudience(misto, liberado) && matchesAudience(misto, pendente) && !matchesAudience(misto, pago), 'vários segmentos somam (OU)');

  const porEmail = cleanAudience({ segments: [], emails: ['  PAGO@gmail.com ', 'lixo', 'silas@gmail.com'] });
  ok(porEmail.emails.length === 2 && porEmail.emails[0] === 'pago@gmail.com', 'emails limpos: minúsculo, sem espaço, inválido descartado');
  ok(matchesAudience(porEmail, pago) && !matchesAudience(porEmail, free), 'conta específica recebe; resto não');
  ok(matchesAudience(porEmail, admin), 'admin pelo email recebe mesmo sem "admins também"');

  const comAll = cleanAudience({ segments: ['free', 'all', 'paid', 'xpto'] });
  ok(comAll.segments.length === 1 && comAll.segments[0] === 'all', '"Todos" engole os outros segmentos e lixo some');
  ok(audienceIsEmpty(cleanAudience({})), 'audiência vazia detectada (servidor recusa publicar pra ninguém)');
  ok(audienceSummary(cleanAudience({ segments: ['free', 'paid'], emails: ['a@b.co'] })) === 'Free e Pagantes · 1 conta', 'resumo legível da audiência');
}

console.log('janela: login, fechar, reativar');
{
  const t0 = '2026-10-09T03:00:00.000Z';
  const ann = { popup: true, active: true, ends_at: null, activated_at: t0 };
  ok(shouldPopup(ann, null, 'S1'), 'ativo e nunca visto → abre (inclusive pra quem já estava logado)');
  const fechadoS1 = { dismissed_keys: addDismissedKey([], popupKey('S1', t0)) };
  ok(!shouldPopup(ann, fechadoS1, 'S1'), 'fechou → não abre de novo na MESMA sessão');
  ok(shouldPopup(ann, fechadoS1, 'S2'), 'saiu e entrou (sessão nova) → abre de novo');
  const reativado = { ...ann, activated_at: '2026-10-09T05:00:00.000Z' };
  ok(shouldPopup(reativado, fechadoS1, 'S1'), 'admin reativou → abre de novo até pra quem já tinha fechado');
  ok(!shouldPopup({ ...ann, active: false }, null, 'S1'), 'pausado → não abre');
  ok(!shouldPopup({ ...ann, popup: false }, null, 'S1'), '"só notificação" → nunca abre janela');
  ok(!shouldPopup({ ...ann, ends_at: '2026-10-09T02:00:00.000Z' }, null, 'S1', Date.parse('2026-10-09T04:00:00Z')), 'prazo vencido → não abre');

  // Dois aparelhos logados ao mesmo tempo não podem reabrir a janela um do outro.
  let keys = addDismissedKey([], popupKey('S1', t0));
  keys = addDismissedKey(keys, popupKey('S2', t0));
  ok(!shouldPopup(ann, { dismissed_keys: keys }, 'S1') && !shouldPopup(ann, { dismissed_keys: keys }, 'S2'), 'fechou nos dois aparelhos → nenhum reabre (sem pingue-pongue)');
  ok(addDismissedKey(keys, popupKey('S1', t0)).length === 2, 'fechar de novo não duplica a chave');
  let muitas: string[] = [];
  for (let i = 0; i < 40; i++) muitas = addDismissedKey(muitas, `S${i}:1`);
  ok(muitas.length === MAX_DISMISSED_KEYS && muitas[muitas.length - 1] === 'S39:1', 'lista de chaves tem teto (banco aceita até 24)');

  // 09.10: a chave grava a HORA do fechamento (pro "Quem viu" do painel).
  const h1 = Date.parse('2026-10-09T15:20:00Z');
  const comHora = addDismissedKey([], popupKey('S1', t0), h1);
  ok(comHora[0] === `${popupKey('S1', t0)}@${h1}`, 'fechar grava sessão:ativação@hora');
  ok(!shouldPopup(ann, { dismissed_keys: comHora }, 'S1'), 'chave com hora segura a janela na mesma sessão');
  ok(shouldPopup(ann, { dismissed_keys: comHora }, 'S2'), 'e reabre em login novo, igual antes');
  ok(!shouldPopup(ann, { dismissed_keys: [popupKey('S1', t0)] }, 'S1'), 'chave ANTIGA sem hora continua valendo (ninguém vê a janela de novo por causa do deploy)');
  const deNovo = addDismissedKey(comHora, popupKey('S1', t0), h1 + 60_000);
  ok(deNovo.length === 1 && deNovo[0] === comHora[0], 'fechar de novo no MESMO login não duplica e guarda a hora do primeiro');
  const mistura = addDismissedKey([popupKey('S1', t0)], popupKey('S1', t0), h1);
  ok(mistura.length === 1 && mistura[0] === popupKey('S1', t0), 'chave antiga do mesmo login não vira duas');
}

console.log('quem viu (painel)');
{
  const act = '2026-10-09T15:13:49.870Z';
  const actMs = Date.parse(act);
  const t = (h: string) => `2026-10-09T${h}:00.000Z`;
  const k = (s: string, iso: string, a = actMs) => `${s}:${a}@${Date.parse(iso)}`;
  const base = { delivered_at: t('15:14'), read_at: t('15:15'), dismissed_at: t('21:40'), clicked_at: null, deleted_at: null };

  const tres = seenFromInbox('u1', { ...base, dismissed_keys: [k('S1', t('15:15')), k('S2', t('18:02')), k('S3', t('21:40'))] }, act);
  ok(tres.views.length === 3 && tres.views.every((v) => v.via === 'janela'), 'viu em 3 logins = 3 vezes, todas na janela');
  ok(tres.firstAt === t('15:15') && tres.lastAt === t('21:40'), 'primeira e última vez saem das horas gravadas');
  ok(tres.views.map((v) => v.at).join() === [t('15:15'), t('18:02'), t('21:40')].join(), 'cada vez com a sua hora, da mais antiga pra mais nova');

  const antiga = seenFromInbox('u2', { ...base, dismissed_keys: [`S1:${actMs}`, `S2:${actMs}`, `S3:${actMs}`] }, act);
  ok(antiga.views.length === 3, 'chaves antigas (sem hora) ainda contam as vezes');
  ok(antiga.firstAt === base.read_at && antiga.lastAt === base.dismissed_at, 'sem hora: 1ª = primeira leitura, última = último fechamento');
  ok(antiga.views.filter((v) => v.at === null).length === 1, 'a do meio fica "hora não registrada" (não inventa)');

  const reexibido = seenFromInbox('u3', { ...base, dismissed_keys: [k('S1', t('15:15'), actMs - 3_600_000), k('S1', t('16:00'))] }, act);
  ok(reexibido.views[0].earlier && !reexibido.views[1].earlier, 'visto antes do "mostrar de novo pra todos" fica marcado');

  const sino = seenFromInbox('u4', { ...base, dismissed_at: null, dismissed_keys: [] }, act);
  ok(sino.views.length === 1 && sino.views[0].via === 'sino' && sino.firstAt === base.read_at, 'sem janela fechada e com leitura = leu no sino');

  const apagou = seenFromInbox('u5', { ...base, read_at: t('16:30'), deleted_at: t('16:30'), dismissed_at: null, dismissed_keys: [] }, act);
  ok(apagou.views.length === 0, 'apagou do sino sem ler NÃO conta como visto');

  const so = seenFromInbox('u6', { ...base, read_at: null, dismissed_at: null, dismissed_keys: [] }, act);
  ok(so.views.length === 0 && so.firstAt === null && so.deliveredAt === base.delivered_at, 'recebeu e ainda não fechou: 0 vezes, só a hora que chegou');

  const cheia = seenFromInbox('u7', { ...base, dismissed_keys: Array.from({ length: MAX_DISMISSED_KEYS }, (_, i) => k(`S${i}`, t('15:20'))) }, act);
  ok(cheia.capped && cheia.views.length === MAX_DISMISSED_KEYS, 'bateu no teto de logins guardados: avisa que pode ter mais');
}

console.log('no ar e prazo');
{
  const now = Date.parse('2026-10-09T12:00:00Z');
  ok(isLive({ active: true, ends_at: null }, now), 'ativo sem prazo = no ar');
  ok(!isLive({ active: true, ends_at: '2026-10-09T11:59:00Z' }, now), 'prazo passou = fora do ar sozinho');
  ok(timeLeft('2026-10-11T16:30:00Z', now) === '2 d 04 h', 'contagem em dias');
  ok(timeLeft('2026-10-09T15:05:00Z', now) === '3 h 05 min', 'contagem em horas');
  ok(timeLeft('2026-10-09T11:00:00Z', now) === null, 'acabou = sem contagem');
  const ordem = sortPopups([
    { kind: 'aviso' as const, activatedAt: '2026-10-09T10:00:00Z', id: 'a' },
    { kind: 'propaganda' as const, activatedAt: '2026-10-08T10:00:00Z', id: 'p' },
    { kind: 'aviso' as const, activatedAt: '2026-10-09T11:00:00Z', id: 'b' },
  ]).map((x) => x.id).join('');
  ok(ordem === 'pba', 'propaganda primeiro, depois avisos do mais novo pro mais velho');
}

console.log('links e imagem');
{
  ok(normalizeLink('/planos') === '/planos', 'página do site');
  ok(normalizeLink('https://wa.me/5511999999999') === 'https://wa.me/5511999999999', 'https externo');
  ok(normalizeLink('darkoautoedit.com/planos') === 'https://darkoautoedit.com/planos', 'sem protocolo vira https');
  ok(normalizeLink('javascript:alert(1)') === null, 'javascript: recusado');
  ok(normalizeLink('JaVaScRiPt:alert(1)') === null, 'javascript: em caixa mista recusado');
  ok(normalizeLink('//evil.com') === null, '"//host" disfarçado de caminho recusado');
  ok(normalizeLink('/\\evil.com') === null, '"/\\host" recusado');
  ok(normalizeLink('http://site.com') === null, 'http sem s recusado');
  ok(normalizeLink('data:text/html,oi') === null, 'data: recusado');
  ok(normalizeLink('https://user:pw@site.com') === null, 'credencial na URL recusada');
  ok(normalizeLink('') === '', 'vazio é vazio (botão opcional)');
  ok(normalizeImage('https://x.supabase.co/storage/v1/object/public/announcements/a.webp') !== null, 'imagem do Storage aceita');
  ok(normalizeImage('http://x.com/a.png') === null, 'imagem http recusada');
  ok(internalPath('https://www.darkoautoedit.com/planos?x=1', 'https://darkoautoedit.com') === '/planos?x=1', 'URL do próprio site vira navegação interna');
  ok(internalPath('https://wa.me/55', 'https://darkoautoedit.com') === null, 'site de fora abre em nova aba');
}

console.log('conteúdo');
{
  const a = cleanContent('aviso', { tone: 'xpto', title: '  Manutenção   hoje\n às 22h ', body: 'Linha 1\n\n\n\nLinha 2' + String.fromCharCode(0x202e), ctaLabel: '', ctaUrl: '' });
  ok(a.ok && (a.value as AvisoContent).tone === 'info', 'tom desconhecido cai pra Informação');
  ok(a.ok && (a.value as AvisoContent).title === 'Manutenção hoje às 22h', 'título em linha única, espaços colapsados');
  ok(a.ok && (a.value as AvisoContent).body === 'Linha 1\n\nLinha 2', 'corpo mantém parágrafo e tira caractere invisível de direção');
  ok(!cleanContent('aviso', { title: '' }).ok, 'aviso sem título recusado');
  ok(!cleanContent('aviso', { title: 'x', ctaLabel: 'Ver', ctaUrl: 'javascript:1' }).ok, 'botão com link perigoso recusado');
  ok(!cleanContent('aviso', { title: 'x', ctaLabel: 'Ver', ctaUrl: '' }).ok, 'botão sem link recusado');
  ok(!cleanContent('aviso', { title: 'x', ctaLabel: '', ctaUrl: '/planos' }).ok, 'link sem texto do botão recusado');
  const p = cleanContent('propaganda', {
    theme: 'lima', title: 'Premium com 40% off', bullets: ['  Legendas  ', '', 'Lipsync', 'FakePrint', 'Quarto'], priceOld: 'R$ 97', priceNew: 'R$ 57', priceNote: '/mês', ctaLabel: 'Quero', ctaUrl: '/planos', imageUrl: '',
  });
  ok(p.ok && (p.value as PromoContent).bullets.join('|') === 'Legendas|Lipsync|FakePrint', 'destaques: vazios somem, no máximo 3');
  ok(!cleanContent('propaganda', { title: 'x', priceOld: 'R$ 97' }).ok, 'preço "de" sem o "por" recusado');
  ok(!cleanContent('propaganda', { title: 'x', imageUrl: 'javascript:1' }).ok, 'imagem perigosa recusada');
  ok(p.ok && (p.value as PromoContent).art === 'tema', 'propaganda sem arte escolhida = arte do tema');
  const pp = cleanContent('propaganda', { title: 'Pilot', art: 'pilot', imageUrl: 'https://cdn.site.com/a.webp' });
  ok(pp.ok && (pp.value as PromoContent).art === 'pilot' && (pp.value as PromoContent).imageUrl === '', 'cena do Pilot: guarda a arte e descarta a imagem');
  ok(cleanContent('propaganda', { title: 'Pilot', art: 'pilot', imageUrl: 'javascript:1' }).ok, 'cena do Pilot não barra por link velho de imagem');
  const pe = cleanContent('propaganda', { title: 'x', art: 'webgl-qualquer' });
  ok(pe.ok && (pe.value as PromoContent).art === 'tema', 'arte desconhecida vira tema');
  ok((readContent('propaganda', { title: 'Antigo' }) as PromoContent).art === 'tema', 'propaganda antiga do banco (sem o campo) abre com a arte do tema');
  const longo = cleanLine('😀'.repeat(200), 70);
  ok(charCount(longo) === 70 && !longo.includes('�'), 'corte por caractere visível (emoji inteiro)');
  ok(cleanText('a\r\nb', 10) === 'a\nb', 'quebra do Windows normalizada');
  ok(readContent('aviso', { title: 'Velho', ctaUrl: 'javascript:1', ctaLabel: 'x' }).title === 'Velho', 'conteúdo inválido do banco ainda mostra o título (sem o botão perigoso)');
  ok((readContent('aviso', { title: 'Velho', ctaUrl: 'javascript:1', ctaLabel: 'x' }) as AvisoContent).ctaUrl === '', 'e o link perigoso some');
}

console.log('sessão do login');
{
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', session_id: '7c1f-ação' })).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  ok(sessionIdFromJwt(`h.${payload}.s`) === '7c1f-ação', 'session_id lido do token (base64url + utf-8)');
  ok(sessionIdFromJwt('lixo') === null && sessionIdFromJwt(null) === null, 'token ruim = sem sessão (sem exceção)');
}

if (falhas) {
  console.error(`\n${falhas} falha(s) em announcements`);
  process.exit(1);
}
console.log('\nannouncements: tudo ok');
