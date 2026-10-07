#!/usr/bin/env node
/**
 * FIDELIDADE do download do FakePass: prévia × PNG, modelo a modelo (06.10.2026).
 *
 * Pra cada caso, o PRÓPRIO Chrome fotografa a prévia na resolução do PNG
 * (deviceScaleFactor = exportW/stageW) e o motor real de export gera o
 * download; o compare marca em vermelho onde os dois divergem e dá uma nota.
 * Foi assim que apareceram o "emoji subido", o tom de pele partido, a conversa
 * longa vazando, o logo do BandNews sumindo e a raiz do "texto baixo".
 *
 * Uso (dev server rodando; a rota /dev/* só existe em development):
 *   node scripts/fakepass-fidelity.mjs <pasta-saida> [regex-dos-casos]
 *   python scripts/fakepass-fidelity-compare.py <pasta-saida>
 *     → <pasta>/<caso>/cmp.png (prévia | download | divergência) e scores.json
 *
 * Env: FP_URL (default http://localhost:3000/dev/fakepass-fidelity),
 *      FP_CHROME (default: Chrome instalado no Windows).
 * Nota ~0 = idêntico. Live é animada (reações/comentários andam): divergência ali
 * é o momento da foto, não defeito.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
if (!OUT) {
  console.error('uso: node scripts/fakepass-fidelity.mjs <pasta-saida> [regex]');
  process.exit(2);
}
const ONLY = process.argv[3] ? new RegExp(process.argv[3]) : null;
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.FP_URL || 'http://localhost:3000/dev/fakepass-fidelity';
const CHROME = process.env.FP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SP = '\u0020';

const STRESS_SUFIXO = SP + 'aumentando bastante esse texto com emoji 🔥😱💯 pra estressar o layout e conferir que nada quebra nem desalinha no download';
const STRESS_LINHA = SP + '— e uma resposta beeem mais looonga 😂🙏 pra testar a quebra';
const TONS = SP + '🙏🏻👍🏽 1️⃣ 🇧🇷 👩🏾‍💻 🫶🏻';
const textual = (v) => {
  if (typeof v !== 'string') return false;
  if (/^#|^https?:|^data:|gradient\(/.test(v) || /^[\d.,:%\sh°+\-]+$/i.test(v)) return false;
  return (/\s/.test(v) && v.length >= 4) || v.length >= 12;
};
function sufixar(s, suf, multi) {
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (!textual(v)) { out[k] = v; continue; }
    out[k] = v.includes('\n') ? v.split('\n').map((l) => (l.trim() ? l + multi : l)).join('\n') : v + suf;
  }
  return out;
}

// conversa da reclamação (06.10) + emoji no começo/meio/fim, só emoji, tom de pele
const POOL = [
  [false, 'Nu'],
  [false, 'confesso q pensava q isso tudo fosse papinho de coach 😅'],
  [false, 'Nu 😂 confesso q pensava q isso tudo fosse papinho de coach mesmo'],
  [false, '🙏🏻 Deus abençoe muito vocês, de verdade, mudou minha vida inteira 🙌🏽'],
  [false, '😂😂😂'],
  [true, 'kkkk 👍🏽'],
  [true, 'Obrigada ❤️❤️ vcs são demais 🥹✨ 1️⃣ 🇧🇷 👩🏾‍💻 🫶🏻'],
  [true, 'É uma alegria enorme ler mensagens como essa 🙏'],
  [true, 'pra ser sincera nunca tinha sobrado dinheiro p mim no final do mês'],
  [false, 'Gratidão Roberta ❤️'],
];
const conversa = (extra = []) => [
  ...POOL.map(([me, text], i) => ({ id: 'c' + i, kind: 'text', me, text, dur: '0:12', src: '' })),
  ...extra,
];

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const pages = new Map();
  async function pageFor(dpr) {
    const key = dpr.toFixed(4);
    if (pages.has(key)) return pages.get(key);
    const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.goto(URL, { waitUntil: 'load', timeout: 240000 });
    await page.waitForFunction(() => Array.isArray(window.__fpModels), null, { timeout: 240000 });
    pages.set(key, page);
    return page;
  }
  const p0 = await pageFor(1);
  const models = await p0.evaluate(() => window.__fpModels);
  const byId = Object.fromEntries(models.map((m) => [m.id, m]));

  const cases = [];
  for (const m of models) {
    cases.push({ name: `default__${m.id}`, id: m.id, s: {} });
    cases.push({ name: `stress__${m.id}`, id: m.id, s: sufixar(m.defaultState, STRESS_SUFIXO, STRESS_LINHA) });
    cases.push({ name: `tons__${m.id}`, id: m.id, s: sufixar(m.defaultState, TONS, TONS) });
  }
  for (const dark of [false, true]) {
    cases.push({ name: `chat__ig-dm__${dark ? 'escuro' : 'claro'}`, id: 'ig-dm', s: { dark, conversa: conversa(), visto: true } });
    cases.push({ name: `chat__whatsapp__${dark ? 'escuro' : 'claro'}`, id: 'whatsapp', s: { dark, conversa: conversa() } });
  }
  // celular Android = emoji do Android (o seletor troca o estilo pro print todo)
  cases.push({ name: 'chat__whatsapp__android', id: 'whatsapp', s: { dark: false, conversa: conversa() }, status: { os: 'android' }, emoji: 'google' });
  cases.push({ name: 'chat__ig-dm__android', id: 'ig-dm', s: { dark: true, conversa: conversa() }, status: { os: 'android' }, emoji: 'google' });
  for (const id of ['ig-question', 'tweet', 'comments', 'notif']) cases.push({ name: `android__${id}`, id, s: sufixar(byId[id].defaultState, TONS, TONS), emoji: 'google' });
  const midia = [
    { id: 'm1', kind: 'image', me: false, text: 'olha o resultado 😍 depois de 30 dias seguindo o método direitinho 🙏🏻', dur: '', src: '' },
    { id: 'm2', kind: 'video', me: true, text: 'vídeo do depoimento 👇🏽', dur: '0:31', src: '' },
    { id: 'm3', kind: 'audio', me: false, text: '', dur: '0:16', src: '' },
  ];
  // áudio de voz recebido + enviado (alinhamento do ▶ com as ondas, foto, microfone)
  const audios = [
    { id: 'a0', kind: 'text', me: false, text: 'oi! te mandei um áudio explicando', dur: '', src: '' },
    { id: 'a1', kind: 'audio', me: false, text: '', dur: '0:07', src: '' },
    { id: 'a2', kind: 'audio', me: true, text: '', dur: '1:24', src: '' },
    { id: 'a3', kind: 'text', me: true, text: 'ouvi tudo, obrigada 🙏🏻', dur: '', src: '' },
  ];
  for (const dark of [false, true]) {
    cases.push({ name: `audio__whatsapp__${dark ? 'escuro' : 'claro'}`, id: 'whatsapp', s: { dark, conversa: audios } });
    cases.push({ name: `audio__ig-dm__${dark ? 'escuro' : 'claro'}`, id: 'ig-dm', s: { dark, conversa: audios, visto: false } });
  }
  cases.push({ name: 'chat__whatsapp__midia', id: 'whatsapp', s: { conversa: conversa(midia).slice(5) } });
  cases.push({ name: 'chat__ig-dm__midia', id: 'ig-dm', s: { conversa: conversa(midia).slice(5) } });
  cases.push({ name: 'notif__android', id: 'notif', s: { os: 'android', texto: '🙏🏻 Filho, chegou aquele dinheiro que te falei? Me avisa quando puder 🙏', titulo: 'Mãe ❤️' } });
  cases.push({ name: 'notif__ios_tons', id: 'notif', s: { texto: 'Filho, chegou aquele dinheiro que te falei? Me avisa quando puder 🙏🏻👍🏽', titulo: 'Mãe ❤️' } });
  cases.push({ name: 'post__tweet__escuro', id: 'tweet', s: { dark: true, texto: 'Comprei o curso ontem 😅 e já apliquei o primeiro módulo hoje 🙏🏻 Melhor decisão do ano 🇧🇷' } });
  cases.push({ name: 'post__ig-post__escuro', id: 'ig-post', s: { dark: true, legenda: 'Esse foi o gráfico que mudou tudo 📈🙏🏻 quem aí já começou? 👇🏽 #investimentos #renda' } });
  cases.push({ name: 'post__comments__escuro', id: 'comments', s: { dark: true } });
  for (const m of models.filter((x) => x.category === 'sites')) {
    for (const format of ['portrait', 'landscape', 'feed45']) cases.push({ name: `fmt__${m.id}__${format}`, id: m.id, s: { format } });
  }
  for (const m of models.filter((x) => x.category === 'news' && 'orient' in x.defaultState)) {
    for (const orient of ['portrait', 'feed45']) cases.push({ name: `fmt__${m.id}__${orient}`, id: m.id, s: { orient } });
  }
  cases.push({ name: 'fmt__zoom-meeting__43', id: 'zoom-meeting', s: { orient: '43' } });
  cases.push({ name: 'fmt__zoom-meeting__share', id: 'zoom-meeting', s: { mode: 'share' } });

  const todo = ONLY ? cases.filter((c) => ONLY.test(c.name)) : cases;
  console.log('CASOS', todo.length);
  const summary = [];
  let n = 0;
  for (const c of todo) {
    n++;
    const t0 = Date.now();
    const rec = { name: c.name, id: c.id };
    try {
      // dims do caso (o modelo pode mudar o palco pelo estado)
      await p0.evaluate((v) => window.__fpEmojiSet(v), c.emoji || 'apple');
      await p0.evaluate(({ id, s, st }) => window.__fpSet(id, s, st), { id: c.id, s: c.s, st: c.status || null });
      const d = await p0.evaluate(() => window.__fpDims());
      const dpr = d.exportW / d.stageW;
      const page = await pageFor(dpr);
      await page.evaluate((v) => window.__fpEmojiSet(v), c.emoji || 'apple');
      await page.evaluate(({ id, s, st }) => window.__fpSet(id, s, st), { id: c.id, s: c.s, st: c.status || null });
      const dir = path.join(OUT, c.name);
      fs.mkdirSync(dir, { recursive: true });
      await page.locator('[data-fp-stage]').screenshot({ path: path.join(dir, 'previa.png'), omitBackground: true, animations: 'disabled' });
      const url = await page.evaluate(() =>
        Promise.race([
          window.__fpExport(),
          new Promise((_r, rej) => setTimeout(() => rej(new Error('download travou (60s)')), 60000)),
        ]),
      );
      fs.writeFileSync(path.join(dir, 'download.png'), Buffer.from(url.split(',')[1], 'base64'));
      rec.dpr = +dpr.toFixed(4);
      rec.ms = Date.now() - t0;
    } catch (e) {
      rec.error = String((e && e.message) || e).slice(0, 300);
    }
    summary.push(rec);
    console.log(`[${n}/${todo.length}] ${c.name} ${rec.error ? 'ERRO ' + rec.error : rec.ms + 'ms'}`);
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  await browser.close();
  if (summary.some((r) => r.error)) process.exit(1);
}
main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
