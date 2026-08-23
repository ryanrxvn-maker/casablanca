/**
 * pilot.mjs — comandos do ClickUp Pilot para o CLI do AutoEdit.
 *
 * O Pilot é uma página: a orquestração (selecionar task, montar slot, disparar)
 * roda no navegador. Mas TUDO que ele LÊ vem de rotas autenticadas — e é isso
 * que dá pra controlar daqui, sem abrir aba:
 *
 *   - as tasks do workspace          -> /api/clickup/proxy
 *   - o doc de cada task             -> /api/clickup/proxy
 *   - os avatares e looks do HeyGen  -> /api/heygen/avatars
 *   - as vozes                       -> /api/heygen/voices
 *   - qual conta HeyGen está ligada  -> /api/heygen/identidade
 *
 * Com isso o plano de cenas é montado e CONFERIDO por fora; o navegador só
 * recebe o resultado pronto. Foi o que faltou em 23.08, quando a seleção
 * automática do Pilot escolheu look errado ("Cocinero de Salchichas" no lugar
 * do consultório) e voz errada ("aaliiceoff" no lugar da MARTINA) — e só se
 * viu isso olhando a tela.
 *
 * ⚠ O proxy do ClickUp é GET-only por desenho. Nada aqui escreve no ClickUp.
 */

import { api } from './core.mjs';

/** Tasks do workspace, já filtradas pelo editor quando `--editor` vem. */
export async function tasks({ editor, status } = {}) {
  const r = await api('GET', '/api/clickup/proxy', {
    query: { path: `/team/90132634310/task`, include_closed: 'false' },
  });
  let lista = r?.tasks || r?.data?.tasks || [];
  if (editor) {
    const alvo = String(editor).toLowerCase();
    lista = lista.filter((t) =>
      (t.custom_fields || []).some((f) =>
        JSON.stringify(f.value || '').toLowerCase().includes(alvo)));
  }
  if (status) {
    const s = String(status).toLowerCase();
    lista = lista.filter((t) => String(t.status?.status || '').toLowerCase().includes(s));
  }
  return lista.map((t) => ({
    id: t.id, nome: t.name, status: t.status?.status,
    url: t.url, criada: t.date_created,
  }));
}

/** Avatares do HeyGen com TODOS os looks — é o que o plano precisa casar. */
export async function avatares({ busca } = {}) {
  const r = await api('GET', '/api/heygen/avatars');
  let g = r?.grupos || r?.data || r?.avatars || [];
  if (busca) {
    const b = String(busca).toLowerCase();
    g = g.filter((x) => String(x.name || x.nome || '').toLowerCase().includes(b));
  }
  return g;
}

/** Vozes da conta ATIVA. ⚠ o default do HeyGen é 'public' — aqui vem privada. */
export async function vozes({ busca } = {}) {
  const r = await api('GET', '/api/heygen/voices', { query: { tipo: 'private' } });
  let v = r?.vozes || r?.data || r?.voices || [];
  if (busca) {
    const b = String(busca).toLowerCase();
    v = v.filter((x) => String(x.name || x.nome || '').toLowerCase().includes(b));
  }
  return v;
}

/** Qual conta HeyGen o app está usando agora — o gate de "conta errada". */
export async function identidade() {
  return api('GET', '/api/heygen/identidade');
}

/**
 * Confere um `cenas.json` contra o que existe de verdade no HeyGen.
 * Devolve a lista de problemas — vazia quer dizer que pode colar no Pilot.
 */
export async function conferirPlano(cenas) {
  const problemas = [];
  const [av, vz] = await Promise.all([avatares(), vozes()]);
  const looks = new Set();
  for (const g of av) for (const l of (g.looks || g.avatares || [])) looks.add(l.id || l.avatar_id);
  const ids = new Set(vz.map((v) => v.voice_id || v.id));

  const porAd = {};
  for (const c of cenas) (porAd[c.ad] = porAd[c.ad] || []).push(c);

  for (const [ad, lista] of Object.entries(porAd)) {
    lista.sort((a, b) => a.n - b.n);
    const vistos = new Set();
    lista.forEach((c, i) => {
      if (c.n !== i + 1) problemas.push(`${ad}: ordem furada no slot ${c.n}`);
      if (!c.texto || !c.texto.trim()) problemas.push(`${ad} slot ${c.n}: SEM texto`);
      if (!c.avatarId && !c.modoImagem) problemas.push(`${ad} slot ${c.n}: sem avatarId`);
      if (c.avatarId && looks.size && !looks.has(c.avatarId))
        problemas.push(`${ad} slot ${c.n}: look ${c.avatarId} nao existe no HeyGen`);
      if (c.voiceId && ids.size && !ids.has(c.voiceId))
        problemas.push(`${ad} slot ${c.n}: voz ${c.voiceId} nao existe na conta`);
      // ⛔ dois slots seguidos no MESMO look = troca de angulo que nao acontece
      if (c.avatarId && vistos.has(c.avatarId))
        problemas.push(`${ad} slot ${c.n}: look repetido (${c.avatarId})`);
      if (c.avatarId) vistos.add(c.avatarId);
    });
  }
  return problemas;
}
