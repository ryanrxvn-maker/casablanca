/**
 * Manutenção pelo painel "Ferramentas" do /admin (10.10). Cada caso é uma
 * promessa do painel: ligar barra cliente, desligar libera, previsão de volta
 * libera sozinha, lista de liberados fura, admin nunca é barrado, Storage fora
 * do ar não derruba o site nem apaga o estado.
 *
 * Roda com: npx tsx lib/maintenance.test.ts
 */
import {
  activeMaintenance,
  applyToolChange,
  canBypassMaintenance,
  cleanToolsConfig,
  cleanUntil,
  defaultToolsConfig,
  isToolInMaintenance,
  maintenanceOf,
  toSnapshot,
  whenLabel,
  type ToolsConfig,
} from './maintenance';
import { __resetToolsCache, loadToolsConfig, saveToolsConfig, TOOLS_CACHE_MS } from './maintenance-store';
import { ACCOUNT_PAGES, TOOL_CATALOG, toolName } from './tool-catalog';

let falhas = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) falhas++;
};

const T0 = Date.parse('2026-10-10T15:00:00Z');
const H = 3_600_000;

async function main() {
  console.log('estado padrão (antes da 1ª gravação = o que era fixo no código)');
  {
    ok(isToolInMaintenance('/tools/separador-audio'), 'separador em manutenção sem arquivo salvo');
    ok(isToolInMaintenance('/tools/remover-elementos/algo'), 'sub-rota também');
    ok(!isToolInMaintenance('/tools/lipsync'), 'lipsync no ar');
    ok(!isToolInMaintenance('/tools/separador-audio-2'), 'prefixo parecido não conta');
    ok(defaultToolsConfig().rev === 0, 'padrão começa na versão 0');
  }

  console.log('ligar, editar, desligar');
  let cfg: ToolsConfig = defaultToolsConfig();
  {
    const r = applyToolChange(cfg, { kind: 'set', path: '/tools/lipsync', maintenance: true, message: '  Voltamos   em 1 hora  ' }, 'Silas', toolName, T0);
    ok(r.ok && r.changed, 'pôr em manutenção grava');
    if (r.ok) cfg = r.cfg;
    ok(isToolInMaintenance('/tools/lipsync', cfg, T0), 'lipsync agora em manutenção');
    ok(maintenanceOf('/tools/lipsync', cfg, T0)?.message === 'Voltamos em 1 hora', 'recado limpo (espaços colapsados)');
    ok(cfg.tools['/tools/lipsync'].since === new Date(T0).toISOString() && cfg.tools['/tools/lipsync'].by === 'Silas', 'guarda desde quando e quem');
    ok(cfg.rev === 1 && cfg.log[0].action === 'on' && cfg.log[0].path === '/tools/lipsync', 'versão sobe e histórico registra');
    ok(r.ok && r.summary === 'Lipsync Video to Video em manutenção.', 'resumo com o nome da ferramenta');

    const e = applyToolChange(cfg, { kind: 'set', path: '/tools/lipsync', maintenance: true, message: 'Volta às 18h' }, 'Outro', toolName, T0 + H);
    ok(e.ok && e.changed && e.cfg.log[0].action === 'edit', 'trocar o recado = edição');
    ok(e.ok && e.cfg.tools['/tools/lipsync'].since === new Date(T0).toISOString() && e.cfg.tools['/tools/lipsync'].by === 'Silas', 'edição mantém o "desde" e quem pôs');
    if (e.ok) cfg = e.cfg;
    const same = applyToolChange(cfg, { kind: 'set', path: '/tools/lipsync', maintenance: true, message: 'Volta às 18h' }, 'Silas', toolName, T0 + H);
    ok(same.ok && !same.changed, 'salvar igual não grava nada');

    const off = applyToolChange(cfg, { kind: 'set', path: '/tools/lipsync', maintenance: false }, 'Silas', toolName, T0 + 2 * H);
    ok(off.ok && off.changed && !isToolInMaintenance('/tools/lipsync', off.cfg, T0 + 2 * H), 'voltar ao ar libera');
    ok(off.ok && off.cfg.log[0].action === 'off', 'histórico registra a volta');
    if (off.ok) cfg = off.cfg;
    const off2 = applyToolChange(cfg, { kind: 'set', path: '/tools/lipsync', maintenance: false }, 'Silas', toolName, T0 + 2 * H);
    ok(off2.ok && !off2.changed, 'desligar o que já está no ar não grava');

    const offDefault = applyToolChange(defaultToolsConfig(), { kind: 'set', path: '/tools/separador-audio', maintenance: false }, 'Silas', toolName, T0);
    ok(offDefault.ok && !isToolInMaintenance('/tools/separador-audio', offDefault.cfg), 'dá pra tirar do ar uma que era fixa no código');
    ok(!applyToolChange(cfg, { kind: 'set', path: '/admin', maintenance: true }, 'Silas').ok, 'só rota de /tools/ (o painel admin nunca entra em manutenção)');
    ok(!applyToolChange(cfg, { kind: 'set', path: '/tools/../admin', maintenance: true }, 'Silas').ok, 'caminho torto recusado');
  }

  console.log('previsão de volta');
  {
    const r = applyToolChange(defaultToolsConfig(), { kind: 'set', path: '/tools/tipografia', maintenance: true, until: new Date(T0 + 2 * H).toISOString() }, 'Silas', toolName, T0);
    ok(r.ok && isToolInMaintenance('/tools/tipografia', r.ok ? r.cfg : null, T0 + H), 'antes da previsão: em manutenção');
    ok(r.ok && !isToolInMaintenance('/tools/tipografia', r.ok ? r.cfg : null, T0 + 3 * H), 'passou da previsão: volta ao ar sozinha');
    const snap = r.ok ? toSnapshot(r.cfg, false, T0 + H) : null;
    ok(!!snap && isToolInMaintenance('/tools/tipografia', snap, T0 + H) && !isToolInMaintenance('/tools/tipografia', snap, T0 + 3 * H), 'no navegador o prazo também vence sozinho');
    ok(cleanUntil(new Date(T0 - 1000).toISOString(), T0) === undefined, 'previsão no passado recusada');
    ok(cleanUntil(new Date(T0 + 31 * 24 * H).toISOString(), T0) === undefined, 'previsão de mais de 30 dias recusada');
    ok(cleanUntil('', T0) === null, 'vazio = sem previsão');
    ok(!applyToolChange(defaultToolsConfig(), { kind: 'set', path: '/tools/lipsync', maintenance: true, until: 'ontem' }, 'Silas').ok, 'previsão ilegível recusada');
    // relançar depois do prazo vencido = ligar de novo (não "edição")
    if (r.ok) {
      const again = applyToolChange(r.cfg, { kind: 'set', path: '/tools/tipografia', maintenance: true }, 'Silas', toolName, T0 + 3 * H);
      ok(again.ok && again.cfg.log[0].action === 'on' && again.cfg.tools['/tools/tipografia'].since === new Date(T0 + 3 * H).toISOString(), 'religar depois de vencer conta como novo "desde"');
    }
    ok(whenLabel(new Date(T0 + H).toISOString(), T0) === 'hoje às 13:00', 'rótulo "hoje às" no fuso de SP');
    ok(whenLabel(new Date(T0 + 20 * H).toISOString(), T0) === 'amanhã às 08:00', 'rótulo "amanhã às"');
  }

  console.log('todas de uma vez');
  {
    const paths = TOOL_CATALOG.filter((t) => t.plan !== 'admin').map((t) => t.path);
    const r = applyToolChange(defaultToolsConfig(), { kind: 'all', paths, maintenance: true, message: 'Atualização geral' }, 'Silas', toolName, T0);
    ok(r.ok && r.changed && paths.every((p) => isToolInMaintenance(p, r.ok ? r.cfg : null, T0)), 'todas as dos clientes em manutenção');
    ok(r.ok && r.cfg.log[0].action === 'all_on' && r.cfg.log.length === 1, 'uma linha só no histórico');
    if (r.ok) {
      const back = applyToolChange(r.cfg, { kind: 'all', paths, maintenance: false }, 'Silas', toolName, T0 + H);
      ok(back.ok && paths.every((p) => !isToolInMaintenance(p, back.ok ? back.cfg : null, T0 + H)), 'todas de volta ao ar');
      ok(back.ok && isToolInMaintenance('/tools/separador-audio', back.ok ? back.cfg : null, T0 + H), 'as internas que já estavam continuam como estavam');
    }
    ok(!applyToolChange(defaultToolsConfig(), { kind: 'all', paths: ['lixo'], maintenance: true }, 'Silas').ok, 'lista sem ferramenta válida recusada');
  }

  console.log('quem fura a manutenção');
  {
    ok(canBypassMaintenance('ElderEmanoel.13@gmail.com '), 'Elder (fixo no código), sem diferenciar maiúscula/espaço');
    ok(!canBypassMaintenance('cliente@gmail.com', defaultToolsConfig()), 'cliente comum não fura');
    const r = applyToolChange(defaultToolsConfig(), { kind: 'bypass', emails: [' Ana@Gmail.com', 'lixo', 'ana@gmail.com', 'bia@x.co'] }, 'Silas', toolName, T0);
    ok(r.ok && r.cfg.bypass.join(',') === 'ana@gmail.com,bia@x.co', 'lista limpa: minúscula, sem repetido, inválido fora');
    ok(r.ok && canBypassMaintenance('ana@gmail.com', r.cfg), 'conta liberada pelo painel fura');
    ok(r.ok && r.cfg.log[0].detail === 'liberou ana@gmail.com, bia@x.co', 'histórico diz quem foi liberado');
    if (r.ok) {
      const rm = applyToolChange(r.cfg, { kind: 'bypass', emails: ['bia@x.co'] }, 'Silas', toolName, T0);
      ok(rm.ok && !canBypassMaintenance('ana@gmail.com', rm.cfg) && rm.cfg.log[0].detail === 'tirou ana@gmail.com', 'tirar da lista corta o acesso');
    }
    const muitos = Array.from({ length: 61 }, (_, i) => `c${i}@x.co`);
    ok(!applyToolChange(defaultToolsConfig(), { kind: 'bypass', emails: muitos }, 'Silas').ok, 'teto de 60 contas');
  }

  console.log('arquivo salvo lido sem confiar');
  {
    ok(cleanToolsConfig(null).rev === 0 && isToolInMaintenance('/tools/separador-audio', cleanToolsConfig('lixo')), 'lixo vira o padrão');
    const rlo = String.fromCharCode(0x202e);
    const c = cleanToolsConfig({
      rev: 7,
      tools: { '/tools/lipsync': { maintenance: true, message: `oi${rlo} tudo`, until: 'x' }, '/admin': { maintenance: true }, 'tools/x': { maintenance: true } },
      bypass: ['A@B.co', 'nada'],
      log: [{ at: 'x', action: 'hack', by: '' }],
    });
    ok(c.rev === 7 && Object.keys(c.tools).join() === '/tools/lipsync', 'só rotas /tools/ válidas sobrevivem');
    ok(c.tools['/tools/lipsync'].message === 'oi tudo' && c.tools['/tools/lipsync'].until === null, 'texto sem caractere invisível; data ruim vira null');
    ok(c.bypass.join() === 'a@b.co' && c.log[0].action === 'edit' && c.log[0].by === 'admin', 'emails e histórico normalizados');
    ok(Object.keys(activeMaintenance(c, T0)).join() === '/tools/lipsync', 'retrato do que vale agora');
  }

  console.log('catálogo');
  {
    const paths = TOOL_CATALOG.map((t) => t.path);
    ok(new Set(paths).size === paths.length, 'sem ferramenta repetida');
    ok(paths.every((p) => /^\/tools\/[a-z0-9-]+$/.test(p)) && !paths.some((p) => ACCOUNT_PAGES.includes(p)), 'só ferramentas (histórico e notificações ficam fora)');
    ok(toolName('/tools/xpto') === 'xpto', 'rota fora do catálogo mostra o slug');
  }

  console.log('armazém (Storage simulado)');
  {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    const calls: Array<{ url: string; method: string }> = [];
    let mode: 'ok' | 'missing' | 'down' | 'nobucket' = 'missing';
    let stored: string | null = null;
    (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url: String(url), method });
      const h = new Headers(init?.headers);
      if (h.get('authorization') !== 'Bearer service-key') return new Response('{"error":"unauthorized"}', { status: 401 });
      if (String(url).endsWith('/storage/v1/bucket')) {
        mode = 'ok';
        return new Response('{"name":"app-config"}', { status: 200 });
      }
      if (method === 'POST') {
        if (mode === 'nobucket') return new Response('{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}', { status: 400 });
        stored = String(init?.body);
        mode = 'ok';
        return new Response('{"Key":"app-config/tools-status.json"}', { status: 200 });
      }
      if (mode === 'down') return new Response('gateway', { status: 502 });
      if (mode === 'missing' || mode === 'nobucket' || !stored) return new Response('{"statusCode":"404","error":"not_found","message":"Object not found"}', { status: 400 });
      return new Response(stored, { status: 200 });
    };

    __resetToolsCache();
    let l = await loadToolsConfig();
    ok(l.source === 'default' && isToolInMaintenance('/tools/separador-audio', l.cfg), 'sem arquivo ainda = estado padrão');
    ok(calls[0].url.includes('/storage/v1/object/app-config/tools-status.json?v='), 'lê o arquivo privado furando cache de CDN');

    mode = 'nobucket';
    const on = applyToolChange(l.cfg, { kind: 'set', path: '/tools/lipsync', maintenance: true }, 'Silas', toolName);
    if (on.ok) await saveToolsConfig(on.cfg);
    ok(calls.some((c) => c.url.endsWith('/storage/v1/bucket')), '1ª gravação cria o bucket privado sozinha');
    ok(!!stored && JSON.parse(stored as string).tools['/tools/lipsync'].maintenance === true, 'arquivo gravado');

    const before = calls.length;
    l = await loadToolsConfig();
    ok(calls.length === before && isToolInMaintenance('/tools/lipsync', l.cfg), 'logo depois de gravar, a própria instância já vê (sem ir no Storage)');

    __resetToolsCache();
    l = await loadToolsConfig();
    ok(l.source === 'storage' && isToolInMaintenance('/tools/lipsync', l.cfg), 'outra instância lê do Storage');
    const n1 = calls.length;
    await loadToolsConfig();
    ok(calls.length === n1, `dentro de ${TOOLS_CACHE_MS / 1000} s não volta no Storage (middleware barato)`);
    const fresh = await loadToolsConfig({ fresh: true });
    ok(calls.length === n1 + 1 && fresh.source === 'storage', 'leitura "fresh" (antes de gravar) sempre vai no Storage');

    mode = 'down';
    const stale = await loadToolsConfig({ fresh: true });
    ok(stale.source === 'stale' && isToolInMaintenance('/tools/lipsync', stale.cfg), 'Storage fora do ar: segue o último estado bom (não libera nem trava errado)');

    __resetToolsCache();
    const cold = await loadToolsConfig();
    ok(cold.source === 'default' && !!cold.error, 'fora do ar sem estado anterior: padrão do código, com o erro anotado');

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    __resetToolsCache();
    ok((await loadToolsConfig()).source === 'unconfigured', 'sem chave no servidor: padrão, sem quebrar');
  }

  if (falhas) {
    console.error(`\n${falhas} falha(s) em maintenance`);
    process.exit(1);
  }
  console.log('\nmaintenance: tudo ok');
}

void main();
