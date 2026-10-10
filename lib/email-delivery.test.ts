/**
 * Envio de VERDADE do e-mail dos avisos (deliverMail) contra um Resend FALSO
 * que imita o de produção: cota diária do plano grátis (100/dia, cabeçalho
 * x-resend-daily-quota só no grátis), cota do mês, chave de idempotência que
 * VENCE em 24 h e erro de lote.
 *
 * O que não pode acontecer nunca: alguém receber o mesmo e-mail duas vezes,
 * alguém ficar sem receber calado, ou o disparo comer a cota dos códigos de
 * cadastro do dia.
 *
 * Roda com: npx tsx lib/email-delivery.test.ts
 */
import { deliverMail, type MailJob } from './announcements-mail';
import { FREE_DAILY, FREE_RESERVE } from './announcement-email';
import { cleanAudience, emptyContent, type MailLog, type PromoContent } from './announcements';

process.env.RESEND_API_KEY = 're_teste';
process.env.NEXT_PUBLIC_SITE_URL = 'https://www.darkoautoedit.com';
process.env.EMAIL_OPTOUT_SECRET = 'segredo-de-teste';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) falhas++;
};

/* ─── banco falso: N contas Free ativas, em ordem de cadastro ─── */
type Row = { id: string; email: string; name: string; created_at: string; is_admin: boolean; is_active: boolean; tier: string };
function contas(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `u${String(i).padStart(4, '0')}`,
    email: `pessoa${i}@exemplo.com`,
    name: `Pessoa ${i}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    is_admin: false,
    is_active: true,
    tier: 'free',
  }));
}
function svcFalso(rows: Row[], sairam: string[] = []) {
  return {
    from: () => ({ select: () => ({ order: () => ({ range: async (a: number, b: number) => ({ data: rows.slice(a, b + 1), error: null }) }) }) }),
    auth: { admin: { listUsers: async () => ({ data: { users: rows.map((r) => ({ id: r.id, app_metadata: sairam.includes(r.id) ? { email_optout: true } : {} })) }, error: null }) } },
  } as never;
}

/* ─── Resend falso ─── */
const resend = {
  plano: 'gratis' as 'gratis' | 'pago',
  hoje: 0,
  mes: 0,
  chaves: new Map<string, string>(),
  recebidos: new Map<string, number>(),
  lotes: [] as number[],
  falharProximo: null as null | { status: number; name: string; message: string },
  reset(plano: 'gratis' | 'pago', hoje = 0) {
    this.plano = plano;
    this.hoje = hoje;
    this.mes = 0;
    this.chaves.clear();
    this.recebidos.clear();
    this.lotes = [];
    this.falharProximo = null;
  },
  /** virou o dia (meia-noite UTC) e passaram 24 h: cota zera e as chaves vencem */
  novoDia() {
    this.hoje = 0;
    this.chaves.clear();
  },
};
const cab = () => ({ 'x-resend-monthly-quota': String(resend.mes), ...(resend.plano === 'gratis' ? { 'x-resend-daily-quota': String(resend.hoje) } : {}) });
globalThis.fetch = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
  const corpo = init.body;
  const lote = JSON.parse(corpo) as Array<{ to: string[]; headers: Record<string, string>; subject: string }>;
  const chave = init.headers['Idempotency-Key'] ?? null;
  const resp = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: cab() });
  if (resend.falharProximo) {
    const f = resend.falharProximo;
    resend.falharProximo = null;
    return resp(f.status, { name: f.name, message: f.message });
  }
  if (chave && resend.chaves.has(chave)) {
    return resend.chaves.get(chave) === corpo ? resp(200, { data: [] }) : resp(409, { name: 'invalid_idempotent_request', message: 'mesma chave, corpo diferente' });
  }
  if (resend.plano === 'gratis' && resend.hoje + lote.length > FREE_DAILY) return resp(429, { name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.' });
  for (const e of lote) resend.recebidos.set(e.to[0], (resend.recebidos.get(e.to[0]) ?? 0) + 1);
  resend.hoje += lote.length;
  resend.mes += lote.length;
  resend.lotes.push(lote.length);
  if (chave) resend.chaves.set(chave, corpo);
  return resp(200, { data: lote.map((_, i) => ({ id: `e${i}` })) });
}) as unknown as typeof fetch;

const job = (id = 'pilot'): MailJob => ({
  id,
  kind: 'propaganda',
  content: { ...emptyContent('propaganda'), title: 'Você está preparado pro lançamento do Pilot?', body: 'x', art: 'pilot' } as PromoContent,
  endsAt: null,
  activatedAt: '2026-10-10T12:00:00.000Z',
  audience: cleanAudience({ segments: ['all'], email: 'only' }),
});
const repetidos = () => [...resend.recebidos.values()].filter((n) => n > 1).length;

async function main() {
  console.log('plano pago: 460 contas numa rodada');
  {
    resend.reset('pago');
    const rows = contas(460);
    const log = await deliverMail(svcFalso(rows, ['u0003']), job());
    ok(resend.lotes[0] === 1, '1º lote leva 1 pessoa (lê a cota antes de mandar em massa)');
    ok(log.sent === 459 && log.total === 459 && log.optOut === 1 && log.done && !log.reason, `todo mundo recebeu menos quem saiu da lista (${log.sent}/${log.total}, fora ${log.optOut})`);
    ok(resend.recebidos.size === 459 && repetidos() === 0 && !resend.recebidos.has('pessoa3@exemplo.com'), 'ninguém repetido, quem saiu não recebe');
    ok(Math.max(...resend.lotes) <= 100, 'lotes de no máximo 100');
    ok(log.quota?.daily === null && log.quota?.monthly === 459, 'cota lida: sem limite diário (pago), uso do mês');
    const de_novo = await deliverMail(svcFalso(rows, ['u0003']), job(), { prev: log });
    ok(de_novo.sent === 459 && !de_novo.reason && repetidos() === 0 && resend.recebidos.size === 459, '"Tentar o resto" depois de tudo enviado não manda nada de novo');
    const dobro = await Promise.all([deliverMail(svcFalso(rows), job('outro')), deliverMail(svcFalso(rows), job('outro'))]);
    ok(dobro.every((l) => !l.reason) && [...resend.recebidos.values()].every((n) => n <= 2) && resend.recebidos.get('pessoa3@exemplo.com') === 1, 'clique duplo (2 rodadas juntas do mesmo aviso) não duplica: mesma chave de lote');
  }

  console.log('plano grátis: guarda a reserva dos códigos de cadastro e continua nos dias seguintes sem repetir');
  {
    resend.reset('gratis', 7); // 7 códigos de cadastro já saíram hoje
    const rows = contas(230);
    let log: MailLog = await deliverMail(svcFalso(rows), job());
    ok(log.reason === 'quota' && /Plano grátis do Resend/.test(log.message ?? ''), 'para por cota com a frase do plano grátis');
    ok(resend.hoje === FREE_DAILY - FREE_RESERVE, `parou com ${resend.hoje} usados hoje: sobram ${FREE_DAILY - resend.hoje} pros códigos de cadastro`);
    ok(log.sent === FREE_DAILY - FREE_RESERVE - 7 && log.failed === 230 - log.sent && !!log.cursor, `mandou ${log.sent}, registrou ${log.failed} faltando e o marcador`);
    const cadastroAinda = resend.hoje + 1 <= FREE_DAILY;
    ok(cadastroAinda, 'código de cadastro de quem entrar depois ainda sai hoje');
    let dias = 1;
    while (log.reason === 'quota' && dias < 10) {
      resend.novoDia(); // chaves de idempotência venceram: só o marcador protege
      log = await deliverMail(svcFalso(rows), job(), { prev: log });
      dias++;
    }
    ok(!log.reason && log.done && log.sent === 230 && log.total === 230, `terminou em ${dias} dias: ${log.sent}/${log.total}`);
    ok(resend.recebidos.size === 230 && repetidos() === 0, 'cada pessoa recebeu EXATAMENTE 1 vez, mesmo com as chaves vencidas');
  }

  console.log('cota já no limite da reserva: nem começa em massa');
  {
    resend.reset('gratis', FREE_DAILY - FREE_RESERVE);
    const log = await deliverMail(svcFalso(contas(50)), job());
    ok(log.reason === 'quota' && log.sent === 1 && resend.hoje === FREE_DAILY - FREE_RESERVE + 1, 'só a sonda de 1 saiu; o resto espera o dia virar');
  }

  console.log('erro num lote: para sem avançar o marcador e a retomada pega dali');
  {
    resend.reset('pago');
    const rows = contas(260);
    const job1 = job('erro');
    let chamadas = 0;
    const fetchOrig = globalThis.fetch;
    globalThis.fetch = (async (u: string, i: { body: string; headers: Record<string, string> }) => {
      chamadas++;
      if (chamadas === 3) resend.falharProximo = { status: 422, name: 'validation_error', message: 'Invalid `to` field.' };
      return (fetchOrig as unknown as (u: string, i: unknown) => Promise<Response>)(u, i);
    }) as unknown as typeof fetch;
    const log = await deliverMail(svcFalso(rows), job1);
    globalThis.fetch = fetchOrig;
    ok(log.reason === 'erro' && log.sent === 101 && log.failed === 159 && /Invalid/.test(log.message ?? ''), `parou no lote com erro (${log.sent} enviados, ${log.failed} faltando) com a mensagem do Resend`);
    resend.novoDia();
    const resto = await deliverMail(svcFalso(rows), job1, { prev: log });
    ok(!resto.reason && resto.sent === 260 && resend.recebidos.size === 260 && repetidos() === 0, '"Tentar o resto" completou sem repetir ninguém');
  }

  console.log('nova ativação manda de novo; registro de outra ativação não vira marcador');
  {
    resend.reset('pago');
    const rows = contas(30);
    const a = await deliverMail(svcFalso(rows), job());
    const b = await deliverMail(svcFalso(rows), { ...job(), activatedAt: '2026-10-11T09:00:00.000Z' }, { prev: a });
    ok(a.sent === 30 && b.sent === 30 && [...resend.recebidos.values()].every((n) => n === 2), 'desativar e ativar = todo mundo recebe de novo (1 vez por ativação)');
  }

  console.log('teste pra mim');
  {
    resend.reset('gratis', 12);
    const t = await deliverMail(svcFalso(contas(5)), job(), { test: { email: 'admin@exemplo.com', name: 'Silas' } });
    ok(t.sent === 1 && resend.recebidos.get('admin@exemplo.com') === 1 && resend.recebidos.size === 1, 'só o admin recebe');
    ok(t.quota?.daily === 13 && t.quota?.monthly === 1, 'devolve a cota lida (o painel mostra o plano antes do disparo)');
  }

  if (falhas) {
    console.error(`\n${falhas} falha(s)`);
    process.exit(1);
  }
  console.log('\nOK envio: tudo passou');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
