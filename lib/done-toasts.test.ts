/**
 * Notificação de "concluído" (09.10): o que vira cartão, com que rótulo e cor,
 * sem repetir, no máximo 3 — e a FIAÇÃO que nenhum teste de função pega:
 * toda ferramenta do histórico tem ícone, só evento NOVO notifica, a captura
 * de download (clique da própria pessoa) não notifica, o host mostra.
 *
 * Roda com: npx tsx lib/done-toasts.test.ts
 */
import { readFileSync } from 'node:fs';
import { DONE_MAX, isDoneToast, pushToast, quandoTerminou, toastFromEvent, type DoneToast } from './done-toasts';
import { HISTORY_TOOLS } from './history-tools';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) falhas++;
};
const ler = (f: string) => readFileSync(f, 'utf8');

console.log('evento → cartão');
{
  const t = toastFromEvent({ id: 'a1', tool: 'normalizador', title: 'AD13.mp4 normalizado', kind: 'done', t: 1000 });
  ok(!!t && t.tone === 'sucesso' && t.status === 'concluído' && t.toolLabel === 'Normalizador de Áudio', 'processo concluído: verde, "concluído", nome da ferramenta');
  ok(toastFromEvent({ id: 'a2', tool: 'fakepass', title: 'Print x exportado', kind: 'export' })?.status === 'exportado', 'export → "exportado"');
  ok(toastFromEvent({ id: 'a3', tool: 'downloader', title: 'video.mp4', kind: 'download' })?.status === 'baixado', 'download → "baixado"');
  ok(toastFromEvent({ id: 'a4', tool: 'famous-hey', title: 'Disparou "Ana"', kind: 'dispatch' })?.status === 'disparado', 'disparo → "disparado"');
  const f = toastFromEvent({ id: 'a5', tool: 'famous-hey', title: 'Geração falhou', kind: 'dispatch' });
  ok(!!f && f.tone === 'falha' && f.status === 'falhou', 'título de falha → vermelho, "falhou"');
  ok(toastFromEvent({ id: 'a6', tool: 'compressor', title: 'erro-final.mp4 comprimido' })?.tone === 'sucesso', 'arquivo chamado "erro-…" que deu certo continua verde');
  ok(toastFromEvent({ id: 'a7', tool: 'caixinha-pergunta', title: 'Caixinha exportada (story)', kind: 'export' })?.toolLabel === 'Caixinha de Pergunta', 'caixinha tem o nome dela (o histórico agrupa em FakePrint)');
  ok(toastFromEvent({ id: 'a8', tool: 'voice-test', title: 'x.mp3 — voz isolada' })?.toolLabel === 'Isolar voz', 'Isolar voz com o nome certo');
  ok(toastFromEvent({ id: 'a9', tool: 'lipsync', title: 'x', kind: 'qualquer' })?.kind === 'done', 'tipo desconhecido vira "done"');
  ok(toastFromEvent(null) === null && toastFromEvent({ id: '', tool: 'x', title: 'y' }) === null && toastFromEvent({ id: 'z', tool: 'x', title: '   ' }) === null, 'lixo (sem id/título) não vira cartão');
  ok((toastFromEvent({ id: 'b', tool: 'x', title: 'y'.repeat(500) })?.title.length ?? 0) === 160, 'título longo é cortado');
}

console.log('pilha');
{
  const mk = (id: string): DoneToast => toastFromEvent({ id, tool: 'compressor', title: `${id}.mp4 comprimido`, t: 1 })!;
  let l: DoneToast[] = [];
  for (const id of ['1', '2', '3', '4']) l = pushToast(l, mk(id));
  ok(l.length === DONE_MAX && l[0].id === '4' && l[l.length - 1].id === '2', 'mais novo em cima, no máximo 3 (o mais velho sai)');
  ok(pushToast(l, mk('4')) === l, 'mesmo evento duas vezes não duplica');
}

console.log('quando');
{
  ok(quandoTerminou(0, 30_000) === 'agora', '< 1 min = agora');
  ok(quandoTerminou(0, 5 * 60_000) === 'há 5 min', 'minutos');
  ok(quandoTerminou(0, 3 * 3_600_000) === 'há 3 h', 'horas');
  ok(quandoTerminou(10_000, 0) === 'agora', 'relógio adiantado não vira número negativo');
}

console.log('mensagem entre abas');
{
  const t = toastFromEvent({ id: 'x', tool: 'lipsync', title: 'ok' })!;
  ok(isDoneToast(t), 'aceita o formato que nós mandamos');
  ok(!isDoneToast({ ...t, tone: 'qualquer' }) && !isDoneToast({ id: 1 }) && !isDoneToast(null), 'recusa formato estranho');
}

console.log('fiação');
{
  const icons = ler('components/history/tool-icons.tsx');
  const keys = new Set(Array.from(icons.slice(icons.indexOf('TOOL_ICONS'), icons.indexOf('};', icons.indexOf('TOOL_ICONS'))).matchAll(/^\s+'?([a-z0-9-]+)'?:/gm), (m) => m[1]));
  const faltando = HISTORY_TOOLS.map((t) => t.id).filter((id) => !keys.has(id));
  ok(faltando.length === 0, `toda ferramenta do histórico tem ícone${faltando.length ? ` (faltam: ${faltando.join(', ')})` : ''}`);

  const hist = ler('lib/history.ts');
  const log = hist.slice(hist.indexOf('export function logHistory('), hist.indexOf('export type DownloaderHistoryJob'));
  ok((log.match(/autoedit:done/g) ?? []).length === 1, 'logHistory avisa "concluído" num lugar só');
  ok(log.indexOf('autoedit:done') > log.indexOf('events.unshift(novo)'), '…e só depois de gravar o evento NOVO (o duplicado volta antes)');
  const dupBlock = log.slice(log.indexOf('if (dup)'), log.indexOf('const novo'));
  ok(!dupBlock.includes('autoedit:done'), 'evento duplicado (StrictMode/duplo disparo) não notifica');
  const attach = hist.slice(hist.indexOf('export function attachRefToRecent('), hist.indexOf('/** Lê o histórico'));
  ok(!attach.includes('autoedit:done'), 'captura automática de download (clique da própria pessoa) não notifica');

  const host = ler('components/notifications/AnnouncementHost.tsx');
  ok(/startDoneToasts\(\)/.test(host) && /<DoneToast /.test(host), 'o host liga a escuta e mostra o cartão');
  ok(/const concluidos = promo \? \[\] : dones/.test(host), 'cartão espera a propaganda grande fechar (não fica atrás do véu)');
  ok(/export \{ toolIcon \}/.test(ler('components/history/HistoryTimeline.tsx')), 'histórico continua exportando toolIcon (quem importava de lá não quebra)');
  ok(!/HistoryTimeline/.test(ler('components/notifications/DoneToast.tsx')), 'cartão não puxa o histórico inteiro pro bundle de toda página');

  const tools = ['app/tools/layout.tsx'];
  for (const f of tools) ok(/<AnnouncementHost \/>/.test(ler(f)), `${f} monta o host (as ferramentas ganham o cartão)`);
}

if (falhas) {
  console.error(`\n${falhas} falha(s) em done-toasts`);
  process.exit(1);
}
console.log('\ndone-toasts: tudo ok');
