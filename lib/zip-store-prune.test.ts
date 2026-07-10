/**
 * Trava as invariantes da FAXINA (LRU por disparo) do darkolab-zip-store.
 * Ver [[project_disco_c_limpeza]] / lib/zip-store-prune.ts.
 *
 * O que isto blinda: o store acumulava montado+takes+partes de TODO disparo e
 * nunca purgava → no Chrome (IDB por-origem, nunca some) virava 1,58 GB e o boot
 * da página levava 70s. A faxina só pode remover disparo VELHO e concluído —
 * NUNCA o ativo, o recente ou os últimos N. Estes testes garantem exatamente isso.
 */
import { zipGroupId, planZipEviction, ZipMeta } from './zip-store-prune';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

const HOUR = 3600_000;
const NOW = 1_000_000_000_000; // relógio fixo pros testes

console.log('\nGARANTIA — faxina do zip-store (nunca apaga disparo ativo/recente):');

// (E) todas as chaves de um mesmo taskId caem no MESMO grupo, em qualquer namespace
{
  const t = '86aj6nfue';
  const keys = [
    `batch:${t}:montado`,
    `batch:${t}:takes`,
    `batch:${t}:camo`,
    `pilot:${t}:decupado:BODY 1@k0.04`,
    `pilot:${t}:g:abc123:part:HOOK 1`,
    `pilot:${t}:leveled:BODY 2`,
    `va:${t}:zip`,
    `va:${t}:part:1`,
    `troca:white:${t}`,
  ];
  const ids = new Set(keys.map(zipGroupId));
  ok(ids.size === 1 && ids.has(t), 'todas as chaves do mesmo taskId → 1 grupo só (batch/pilot/va/troca)');
}

// (E2) taskId do Hey Auto contém ':' e ainda agrupa certo
{
  const t = 'heygenauto:heygen:1783567871328:y2reuz';
  ok(zipGroupId(`batch:${t}:montado`) === t, 'taskId com ":" (Hey Auto) agrupa pelo id inteiro');
  ok(zipGroupId(`batch:${t}:takes`) === t, 'takes do Hey Auto no mesmo grupo do montado');
}

// (E3) disparos diferentes NÃO se misturam
{
  ok(zipGroupId('batch:AAA:montado') !== zipGroupId('batch:BBB:montado'), 'taskIds distintos → grupos distintos');
}

// (E4) Auto B-roll: ZIP do pack + MP4s individuais dos takes = 1 grupo só.
// Sem isto cada take virava grupo "misc" próprio e a faxina (disparada pelo
// boot do Pilot/Hey Auto no MESMO DB) roía os packs antigos take a take —
// preview do histórico ficava cinza. Ver fix 2026-07-10.
{
  const zipKey = 'broll:1751234567890:1751234567999:zip';
  const keys = [
    zipKey,                    // o ZIP pré-salvo do batch (chave = a própria zipKey)
    `brollvid:${zipKey}:0`,    // MP4 individual do take 0
    `brollvid:${zipKey}:17`,
    `brollvid:${zipKey}:299`,  // pack de 300
  ];
  const ids = new Set(keys.map(zipGroupId));
  ok(ids.size === 1 && ids.has(zipKey), 'E4: zip do pack + brollvid dos takes → 1 grupo (a zipKey)');
  ok(zipGroupId(`brollvid:broll:AAA:1:zip:3`) !== zipGroupId(`brollvid:broll:BBB:2:zip:3`), 'E4: packs distintos → grupos distintos');
  ok(!zipGroupId(`brollvid:${zipKey}:12`).startsWith(' misc'), 'E4: brollvid não cai mais no fallback misc');
}

// (E5) Fila do Hey Auto: áudios persistidos de um item (hgaq:<itemId>:audio:<n>)
// agrupam pelo itemId — protegíveis via `protect` enquanto o item não foi
// entregue (fila de madrugada >12h não pode perder o áudio pra faxina).
{
  const item = 'manual:meu_ad:1783567871328:ab12'; // itemId contém ':' e agrupa certo
  ok(zipGroupId(`hgaq:${item}:audio:0`) === item, 'E5: áudio da fila agrupa pelo itemId inteiro');
  ok(zipGroupId(`hgaq:${item}:audio:0`) === zipGroupId(`hgaq:${item}:audio:3`), 'E5: todos os áudios do item no MESMO grupo');
  ok(!zipGroupId(`hgaq:${item}:audio:1`).startsWith(' misc'), 'E5: não cai no fallback misc');
  ok(zipGroupId(`hgaq:AAA:audio:0`) !== zipGroupId(`hgaq:BBB:audio:0`), 'E5: itens distintos → grupos distintos');

  // Funcional: velho + fora da janela, MAS protegido → nunca evictado.
  const metas: ZipMeta[] = [{ key: `hgaq:${item}:audio:0`, size: 5 * 1024 * 1024, createdAt: NOW - 100 * HOUR }];
  const kept = planZipEviction(metas, { protect: [item], keepGroups: 0, minAgeMs: HOUR, now: NOW });
  ok(kept.evictKeys.length === 0, 'E5: áudio de item PROTEGIDO nunca é evictado, mesmo velho');
  const evicted = planZipEviction(metas, { keepGroups: 0, minAgeMs: HOUR, now: NOW });
  ok(evicted.evictKeys.length === 1, 'E5: sem protect (item entregue), áudio velho segue o LRU normal');
}

// helper: monta metas de N disparos, cada um com montado+takes, idade crescente
function mkStore(specs: Array<{ id: string; ageH: number; sizeMB?: number }>): ZipMeta[] {
  const out: ZipMeta[] = [];
  for (const s of specs) {
    const createdAt = NOW - s.ageH * HOUR;
    const sz = (s.sizeMB ?? 10) * 1024 * 1024;
    out.push({ key: `batch:${s.id}:montado`, size: sz, createdAt });
    out.push({ key: `batch:${s.id}:takes`, size: sz, createdAt });
    out.push({ key: `pilot:${s.id}:part:HOOK 1`, size: sz, createdAt });
  }
  return out;
}

// (A) disparo protegido NUNCA é removido — nem sendo o mais velho do store
{
  const store = mkStore([
    { id: 'ACTIVE', ageH: 500 }, // velhíssimo, mas ATIVO
    ...Array.from({ length: 20 }, (_, i) => ({ id: `old${i}`, ageH: 100 + i })),
  ]);
  const plan = planZipEviction(store, { protect: ['ACTIVE'], keepGroups: 5, minAgeMs: 12 * HOUR, now: NOW });
  const evicted = new Set(plan.evictKeys);
  ok(![...evicted].some((k) => zipGroupId(k) === 'ACTIVE'), 'A: disparo em protect nunca entra em evictKeys (mesmo velho)');
}

// (B) disparo recente (< minAgeMs) NUNCA é removido — mesmo além do keepGroups
{
  // 30 disparos, TODOS recentes (1h): keepGroups=5 mas a janela protege todos
  const store = mkStore(Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, ageH: 1 })));
  const plan = planZipEviction(store, { keepGroups: 5, minAgeMs: 12 * HOUR, now: NOW, maxBytes: Infinity });
  ok(plan.evictKeys.length === 0, 'B: nada tocado dentro da janela de 12h, mesmo passando do keepGroups');
}

// (C) os keepGroups mais recentes são preservados inteiros
{
  const store = mkStore(Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, ageH: 100 + i }))); // todos velhos
  const plan = planZipEviction(store, { keepGroups: 6, minAgeMs: 12 * HOUR, now: NOW, maxBytes: Infinity });
  // d0..d5 são os 6 mais recentes → preservados; d6..d19 removidos
  const evicted = new Set(plan.evictKeys.map(zipGroupId));
  const kept = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5'];
  ok(kept.every((id) => !evicted.has(id)), 'C: os 6 disparos mais recentes ficam');
  ok(plan.stats.evictedGroups === 14, 'C: os 14 disparos velhos além do keepGroups saem');
}

// (D) remoção é sempre do GRUPO INTEIRO — nunca meia parte
{
  const store = mkStore(Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, ageH: 100 + i })));
  const plan = planZipEviction(store, { keepGroups: 3, minAgeMs: 12 * HOUR, now: NOW, maxBytes: Infinity });
  // pra cada grupo removido, as 3 chaves (montado/takes/part) têm que sair juntas
  const byGroup = new Map<string, number>();
  for (const k of plan.evictKeys) byGroup.set(zipGroupId(k), (byGroup.get(zipGroupId(k)) || 0) + 1);
  ok([...byGroup.values()].every((n) => n === 3), 'D: todo grupo removido sai com TODAS as suas chaves (nunca parcial)');
}

// (Fase 2) válvula de tamanho: passa do teto → remove os mais velhos não-protegidos
{
  // 10 disparos velhos de 100MB cada = 1000MB de "kept" se keepGroups fosse alto.
  // keepGroups=10 (mantém todos por contagem), mas maxBytes=300MB força cortar os velhos.
  const store = mkStore(Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, ageH: 50 + i, sizeMB: 100 / 3 })));
  // cada disparo = 3 chaves × 33.3MB ≈ 100MB. teto 300MB ⇒ mantém ~3 disparos.
  const plan = planZipEviction(store, { keepGroups: 10, minAgeMs: 12 * HOUR, now: NOW, maxBytes: 300 * 1024 * 1024 });
  ok(plan.evictKeys.length > 0, 'Fase2: teto de bytes estourado dispara remoção mesmo dentro do keepGroups');
  const keptBytes = plan.stats.totalBytes - plan.stats.freedBytes;
  ok(keptBytes <= 300 * 1024 * 1024, 'Fase2: sobra fica <= maxBytes');
  // o mais NOVO (s0) sempre sobrevive
  ok(!new Set(plan.evictKeys.map(zipGroupId)).has('s0'), 'Fase2: corta do mais velho pro mais novo (s0 sobrevive)');
}

// (Fase 2 + segurança) teto estourado NÃO pode sacrificar recente/protegido
{
  const store = mkStore([
    { id: 'recent', ageH: 1, sizeMB: 500 },   // recente e gordo
    { id: 'prot', ageH: 200, sizeMB: 500 },    // velho, gordo, mas protegido
  ]);
  const plan = planZipEviction(store, { protect: ['prot'], keepGroups: 0, minAgeMs: 12 * HOUR, now: NOW, maxBytes: 1 });
  const evicted = new Set(plan.evictKeys.map(zipGroupId));
  ok(!evicted.has('recent') && !evicted.has('prot'), 'Fase2: nem teto absurdo remove recente ou protegido (segurança vence)');
}

// (cenário real) 14 disparos concluídos acumulados como no store medido (1,58GB)
{
  const store = mkStore(Array.from({ length: 14 }, (_, i) => ({ id: `batch${i}`, ageH: 24 + i * 6, sizeMB: 40 })));
  // maxBytes alto pra isolar a regra de CONTAGEM (keepGroups); a válvula de tamanho
  // tem teste próprio acima. No store real (1,58GB) o teto cortaria ainda mais.
  const plan = planZipEviction(store, { keepGroups: 12, minAgeMs: 12 * HOUR, now: NOW, maxBytes: Infinity });
  ok(plan.stats.evictedGroups === 2, 'real: dos 14 velhos, mantém os 12 mais novos e remove os 2 mais antigos');
  ok(plan.evictKeys.length === 6, 'real: 2 disparos × 3 chaves = 6 chaves removidas');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} zip-store-prune: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
