/**
 * heygen-vozes.mjs — enxuga as vozes clonadas de uma conta HeyGen.
 *
 * Existe porque o HeyGen passou a limitar a conta a 40 slots de voz. Mantém as
 * N vozes mais usadas (padrão 30) e apaga o resto, em DOIS passos: primeiro
 * `listar` grava um plano que você confere; só `apagar` exclui, e só o que
 * estiver em `apagar` no plano. Excluir voz no HeyGen NÃO tem volta.
 *
 *   HEYGEN_API_KEY=<chave da conta> node cli/heygen-vozes.mjs listar [--manter 30]
 *   HEYGEN_API_KEY=<chave da conta> node cli/heygen-vozes.mjs apagar [--sim]
 *
 * `--sim` pula a confirmação digitada (para rodar listar + apagar de uma vez).
 *
 * Como mede "mais usada" (a API pública não diz qual voz cada vídeo usou):
 *   • usos   — quantos títulos de vídeo da conta citam o nome da voz ou o nome
 *              de um avatar que usa essa voz como voz padrão;
 *   • avatar — quantos avatares/looks da conta têm essa voz como voz padrão.
 * Ordena por usos, depois avatar. Voz sem nenhum dos dois vai pro fim da fila.
 *
 * O plano fica em `heygen-vozes-plano.json` (pasta atual). Para salvar uma voz
 * que o ranking mandou apagar, mova o item de `apagar` para `manter` antes.
 *
 * Endpoints oficiais (developers.heygen.com): GET /v3/voices?type=private,
 * GET /v3/avatars, GET /v3/avatars/looks, GET /v3/videos,
 * DELETE /v3/voices/{voice_id}. Node 18+, zero dependência.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const BASE = process.env.HEYGEN_BASE_URL || 'https://api.heygen.com';
const PLANO = 'heygen-vozes-plano.json';
const MAX_PAGINAS_VIDEO = 30; // 30 × 100 = últimos 3000 vídeos

function arg(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const KEY = arg('key', process.env.HEYGEN_API_KEY);
if (!KEY) {
  console.error('Falta a chave: HEYGEN_API_KEY=<chave> node cli/heygen-vozes.mjs listar');
  console.error('(HeyGen → Settings → API, logado na conta que vai ser enxugada)');
  process.exit(1);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(metodo, caminho) {
  for (let tentativa = 1; ; tentativa++) {
    const res = await fetch(BASE + caminho, {
      method: metodo,
      headers: { 'x-api-key': KEY, accept: 'application/json' },
    });
    if (res.status === 429 && tentativa <= 5) {
      await dormir((Number(res.headers.get('retry-after')) || 2 ** tentativa) * 1000);
      continue;
    }
    const corpo = await res.json().catch(() => ({}));
    return { status: res.status, corpo };
  }
}

/** Percorre uma listagem paginada por cursor (`next_token` → `token`). */
async function todos(caminho, maxPaginas = 100) {
  const itens = [];
  let token = null;
  for (let p = 0; p < maxPaginas; p++) {
    const sep = caminho.includes('?') ? '&' : '?';
    const url = `${caminho}${sep}limit=${caminho.includes('/avatars') ? 50 : 100}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    const { status, corpo } = await api('GET', url);
    if (status !== 200) {
      const msg = corpo?.error?.message || JSON.stringify(corpo).slice(0, 200);
      throw new Error(`GET ${caminho} → ${status}: ${msg}`);
    }
    const lista = Array.isArray(corpo.data) ? corpo.data : corpo.data?.data || [];
    itens.push(...lista);
    token = corpo.next_token ?? corpo.data?.next_token;
    if (!(corpo.has_more ?? corpo.data?.has_more) || !token) break;
  }
  return itens;
}

const norm = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function listar() {
  const manterN = Number(arg('manter', 30));
  process.stdout.write('Buscando vozes clonadas… ');
  // Só clonadas: `type=private`. Voz pública da biblioteca nunca entra no plano.
  const vozes = (await todos('/v3/voices?type=private')).filter((v) => v.voice_id && (!v.type || v.type === 'private'));
  console.log(vozes.length);

  process.stdout.write('Buscando avatares e looks… ');
  const [grupos, looks] = await Promise.all([
    todos('/v3/avatars?ownership=private'),
    todos('/v3/avatars/looks?ownership=private'),
  ]);
  console.log(`${grupos.length} avatares, ${looks.length} looks`);

  process.stdout.write('Buscando títulos dos vídeos… ');
  const videos = await todos('/v3/videos', MAX_PAGINAS_VIDEO).catch(() => []);
  const titulos = videos.map((v) => norm(v.title)).filter(Boolean);
  console.log(titulos.length);

  // voice_id → nomes dos avatares que a usam como voz padrão
  const avataresDaVoz = new Map();
  for (const a of [...grupos, ...looks]) {
    if (!a.default_voice_id || !a.name) continue;
    if (!avataresDaVoz.has(a.default_voice_id)) avataresDaVoz.set(a.default_voice_id, new Set());
    avataresDaVoz.get(a.default_voice_id).add(a.name);
  }

  const citados = (nome) => {
    const n = norm(nome);
    return n.length >= 3 ? titulos.filter((t) => t.includes(n)).length : 0;
  };

  const ranking = vozes.map((v) => {
    const avatares = [...(avataresDaVoz.get(v.voice_id) || [])];
    const usos = Math.max(citados(v.name), ...avatares.map(citados), 0);
    return { voice_id: v.voice_id, nome: v.name, idioma: v.language || '', genero: v.gender || '', usos, avatar: avatares.length, avatares };
  });
  ranking.sort((a, b) => b.usos - a.usos || b.avatar - a.avatar || norm(a.nome).localeCompare(norm(b.nome)));

  const manter = ranking.slice(0, manterN);
  const apagar = ranking.slice(manterN);

  console.log(`\n  #  ${'VOZ'.padEnd(34)} USOS  AVATAR  DECISÃO`);
  ranking.forEach((r, i) => {
    const dec = i < manterN ? 'mantém' : 'APAGA';
    console.log(`${String(i + 1).padStart(3)}  ${(r.nome || r.voice_id).slice(0, 34).padEnd(34)} ${String(r.usos).padStart(4)}  ${String(r.avatar).padStart(6)}  ${dec}`);
  });

  writeFileSync(PLANO, JSON.stringify({ gerado_em: new Date().toISOString(), manter, apagar }, null, 2));
  console.log(`\n${vozes.length} vozes → mantém ${manter.length}, apaga ${apagar.length}.`);
  console.log(`Plano salvo em ${PLANO}. Confira (mova de "apagar" pra "manter" o que quiser salvar)`);
  console.log('e rode:  node cli/heygen-vozes.mjs apagar');
}

async function apagar() {
  if (!existsSync(PLANO)) {
    console.error(`Não achei ${PLANO}. Rode primeiro: node cli/heygen-vozes.mjs listar`);
    process.exit(1);
  }
  const plano = JSON.parse(readFileSync(PLANO, 'utf8'));
  const protegidas = new Set((plano.manter || []).map((v) => v.voice_id));
  const alvo = (plano.apagar || []).filter((v) => v.voice_id && !protegidas.has(v.voice_id));
  if (!alvo.length) return console.log('Nada para apagar no plano.');

  console.log(`Vai APAGAR ${alvo.length} vozes (não tem volta):`);
  alvo.forEach((v) => console.log(`  - ${v.nome || v.voice_id}`));
  if (!process.argv.includes('--sim')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const resp = await rl.question(`\nDigite APAGAR ${alvo.length} para confirmar: `);
    rl.close();
    if (resp.trim() !== `APAGAR ${alvo.length}`) return console.log('Cancelado. Nada foi apagado.');
  }

  let ok = 0;
  const falhas = [];
  for (const v of alvo) {
    const { status, corpo } = await api('DELETE', `/v3/voices/${encodeURIComponent(v.voice_id)}`);
    if (status === 200 || status === 404) {
      ok++;
      console.log(`  ✓ ${v.nome}`);
    } else {
      const msg = corpo?.error?.message || `HTTP ${status}`;
      falhas.push({ ...v, erro: msg });
      console.log(`  ✗ ${v.nome} — ${msg}`);
    }
  }
  console.log(`\nApagadas: ${ok}. Falharam: ${falhas.length}.`);
  if (falhas.length) console.log('Voz presa a um template (403) só sai depois de trocar a voz nesse template.');
}

const cmd = process.argv[2];
const acoes = { listar, apagar };
if (!acoes[cmd]) {
  console.log('Uso: node cli/heygen-vozes.mjs listar [--manter 30]  |  apagar');
  process.exit(1);
}
acoes[cmd]().catch((e) => {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
});
