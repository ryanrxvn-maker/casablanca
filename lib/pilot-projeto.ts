/**
 * PROJETO EDITÁVEL do montado do Pilot — CapCut e Premiere (05.10).
 *
 * Silas: *"um botão que ao clicar eu recebo um arquivo que vira um projeto no
 * CapCut e no Premiere: avatar completo, os b-rolls em outra camada batendo
 * com o tempo certinho, legenda do auto edit como imagem (ou .srt)"*.
 *
 * A pós-produção já calcula TUDO o que o render queima no vídeo — janelas e
 * velocidade dos b-rolls, blocos da legenda, zoom, headline. Ela agora guarda
 * esse ROTEIRO junto do avatar limpo (pilot-pos-producao-run); este módulo
 * transforma o roteiro numa linha do tempo neutra e a escreve nos dois
 * formatos. Puro: nada de DOM, IndexedDB ou canvas — testável no harness.
 *
 * Fidelidade ao render (export.ts → desenharInsert):
 *  - b-roll em COVER, centralizado; em tela dividida cada um no seu retângulo
 *    (avatar com foco no rosto), fundo preto;
 *  - b-roll curto desacelera (≥0,75x) e congela o último quadro no resto;
 *  - transição escurecer/luz = V de 0,28s centrado em cada borda da janela;
 *  - zoom do avatar = a mesma curva (escalaNoInstante), amostrada em keyframes.
 */

import { coverComFoco, palcoDoLayout, TRANSICAO_DUR_SEC, type LayoutInsert, type TipoTransicao } from './pilot-inserts';
import { escalaNoInstante, type ZoomSeg } from './pilot-pos-producao';

/* ═══════════════════════════ roteiro (o que a pós guarda) ═══════════════ */

export type ProjetoInsert = {
  id: string;
  nome: string;
  tipo: 'video' | 'imagem';
  midiaKey: string;
  /** janela no vídeo final (s) */
  start: number;
  end: number;
  /** onde o recorte começa dentro do arquivo (s) */
  deSec: number;
  /** duração útil do recorte (s) */
  naturalSec: number;
  /** velocidade do plano (1 = normal; <1 = câmera lenta) */
  velocidade: number;
  /** instante DA JANELA em que o último quadro congela (0 = nunca) */
  congelaApos: number;
  layout: LayoutInsert;
  transicao: TipoTransicao;
  audio: boolean;
  volume: number;
  focoAvatarY: number;
  /** tamanho da mídia como o render a viu (já rotacionada) */
  w: number;
  h: number;
};

/** Bloco/estilo da legenda no formato do engine (opaco aqui). */
export type LegendaDoRoteiro = { blocks: Array<{ id: string; start: number; end: number; words: Array<{ text: string; start: number; end: number }> }>; style: unknown };

export type RoteiroEdicao = {
  versao: 1;
  /** geração do disparo que produziu este montado */
  genId?: string;
  filename: string;
  criadoEm: number;
  durSec: number;
  inserts: ProjetoInsert[];
  legenda: LegendaDoRoteiro | null;
  zoom: ZoomSeg[];
  /** headlines no formato do engine (opaco aqui) */
  headlines: unknown[] | null;
};

const SLUG = /[^A-Za-z0-9_-]+/g;

/** Chaves do IndexedDB do projeto de UM vídeo montado (um por hook). Ficam
 *  sob `batch:<taskId>:` para a faxina tratar o disparo como uma unidade. */
export function chavesDoProjeto(taskId: string, filename: string) {
  const slug = filename.replace(/\.[^.]+$/, '').replace(SLUG, '_').slice(0, 80) || 'video';
  const raiz = `batch:${taskId}:projeto:${slug}`;
  return { raiz, base: `${raiz}:base`, roteiro: `${raiz}:roteiro` };
}

export function prefixoDoProjeto(taskId: string): string {
  return `batch:${taskId}:projeto:`;
}

/* ═══════════════════════════ legenda: SRT e instantes ═══════════════════ */

function srtTempo(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const r = total % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** SRT dos blocos da legenda (tempos do engine em ms). */
export function srtDaLegenda(blocks: LegendaDoRoteiro['blocks']): string {
  const linhas: string[] = [];
  let n = 0;
  for (const b of blocks) {
    const texto = b.words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!texto || !(b.end > b.start)) continue;
    n++;
    linhas.push(String(n), `${srtTempo(b.start)} --> ${srtTempo(b.end)}`, texto, '');
  }
  return linhas.join('\r\n');
}

/**
 * Instantes em que a legenda pode MUDAR de aparência: começo do bloco e o
 * começo de cada palavra (karaokê, palavra a palavra). O exportador desenha
 * cada intervalo uma vez e junta os vizinhos que saíram idênticos — a
 * legenda vira uma sequência de PNGs que troca exatamente quando o render
 * troca. `t` é onde desenhar: depois da animação de entrada assentar.
 */
export function intervalosDaLegenda(blocks: LegendaDoRoteiro['blocks']): Array<{ start: number; end: number; t: number }> {
  const out: Array<{ start: number; end: number; t: number }> = [];
  for (const b of blocks) {
    if (!(b.end > b.start) || !b.words.length) continue;
    const marcas = [b.start, ...b.words.slice(1).map((w) => w.start), b.end]
      .map((ms) => Math.min(b.end, Math.max(b.start, ms)));
    for (let i = 0; i < marcas.length - 1; i++) {
      const a = marcas[i];
      const z = marcas[i + 1];
      if (!(z - a >= 1)) continue;
      out.push({ start: a, end: z, t: a + Math.min(220, (z - a) * 0.6) });
    }
  }
  return out;
}

/* ═══════════════════════════ linha do tempo neutra ══════════════════════ */

export type ArquivoProjeto = {
  /** nome do arquivo dentro da pasta de mídia do projeto */
  nome: string;
  tipo: 'video' | 'imagem';
  w: number;
  h: number;
  /** duração do arquivo (s); imagem = 0 */
  durSec: number;
  temAudio: boolean;
};

export type Retangulo = { x: number; y: number; w: number; h: number };

export type ItemTimeline = {
  trilha: 'avatar' | 'broll' | 'transicao' | 'legenda' | 'headline';
  arquivo: string;
  /** no vídeo final (s) */
  start: number;
  end: number;
  /** onde começa dentro do arquivo (s) */
  fonteDe: number;
  velocidade: number;
  /** 0..1 — 0 = mudo */
  volume: number;
  /** onde o item aparece no canvas (px) */
  destino: Retangulo;
  /** pedaço da fonte que aparece (0..1) — o COVER do render */
  recorte: { x0: number; y0: number; x1: number; y1: number };
  /** multiplicador de escala em instantes RELATIVOS ao início do item (s) */
  escala?: Array<{ t: number; v: number }>;
  /** opacidade 0..1 em instantes relativos ao início do item (s) */
  opacidade?: Array<{ t: number; v: number }>;
};

export type ProjetoTimeline = {
  nome: string;
  W: number;
  H: number;
  fps: number;
  durSec: number;
  arquivos: ArquivoProjeto[];
  itens: ItemTimeline[];
  avisos: string[];
};

export type MidiaDoProjeto = {
  avatar: ArquivoProjeto;
  /** por id de insert: o arquivo e, quando o plano congela, o PNG do último quadro */
  inserts: Map<string, { arquivo: ArquivoProjeto; congelado?: ArquivoProjeto }>;
  legendas: Array<{ arquivo: ArquivoProjeto; start: number; end: number }>;
  headlines: Array<{ arquivo: ArquivoProjeto; start: number; end: number }>;
  preto?: ArquivoProjeto;
  branco?: ArquivoProjeto;
};

const RECORTE_INTEIRO = { x0: 0, y0: 0, x1: 1, y1: 1 };
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

function recorteCover(srcW: number, srcH: number, ret: Retangulo, focoY = 0.5) {
  if (!(srcW > 0) || !(srcH > 0)) return RECORTE_INTEIRO;
  const c = coverComFoco(srcW, srcH, ret.w, ret.h, focoY);
  return { x0: r6(c.sx / srcW), y0: r6(c.sy / srcH), x1: r6((c.sx + c.sw) / srcW), y1: r6((c.sy + c.sh) / srcH) };
}

/** A curva do zoom do render (easeInOutSine) em keyframes: as bordas de cada
 *  segmento + amostras na rampa. Cortes secos viram dois keyframes colados. */
function keyframesDeZoom(zoom: ZoomSeg[], de: number, ate: number, fps: number): Array<{ t: number; v: number }> {
  if (!zoom.length) return [];
  const quadro = 1 / fps;
  const instantes = new Set<number>([de, Math.max(de, ate - quadro)]);
  for (const seg of zoom) {
    if (seg.end <= de || seg.start >= ate) continue;
    const fimRampa = seg.rampaAte != null && seg.rampaAte > seg.start ? Math.min(seg.rampaAte, seg.end) : seg.end;
    for (let k = 0; k <= 6; k++) instantes.add(seg.start + ((fimRampa - seg.start) * k) / 6);
    instantes.add(seg.end - quadro);
  }
  const lista = [...instantes].filter((t) => t >= de - 1e-6 && t <= ate + 1e-6).sort((a, b) => a - b);
  const keys: Array<{ t: number; v: number }> = [];
  for (const t of lista) {
    const v = Math.round(escalaNoInstante(zoom, Math.min(t, ate - 1e-4)) * 10000) / 10000;
    const rel = Math.round((t - de) * 1e6) / 1e6;
    if (keys.length && rel - keys[keys.length - 1].t < 1e-3) { keys[keys.length - 1] = { t: rel, v }; continue; }
    keys.push({ t: rel, v });
  }
  // escala parada o item inteiro = nada a animar
  return keys.every((k) => Math.abs(k.v - 1) < 1e-4) ? [] : keys;
}

/** Monta a linha do tempo neutra a partir do roteiro e das mídias exportadas. */
export function montarTimeline(nome: string, roteiro: RoteiroEdicao, midia: MidiaDoProjeto, W: number, H: number, fps = 30): ProjetoTimeline {
  const dur = Math.max(0.1, roteiro.durSec || midia.avatar.durSec);
  const avisos: string[] = [];
  const itens: ItemTimeline[] = [];
  const canvas: Retangulo = { x: 0, y: 0, w: W, h: H };
  const inserts = [...roteiro.inserts].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);

  // AVATAR: contínuo; só sai do lugar (vai pro card) nas janelas de tela
  // dividida. Na tela cheia ele segue por baixo — o b-roll cobre, e o áudio e
  // o corte do editor continuam inteiros.
  const divisoes = inserts.filter((i) => i.layout.tipo !== 'cheia').map((i) => ({ start: i.start, end: i.end, ins: i }));
  let cursor = 0;
  const pedacoAvatar = (de: number, ate: number, ins?: ProjetoInsert) => {
    if (!(ate - de > 1e-3)) return;
    const palco = ins ? palcoDoLayout(ins.layout, W, H) : null;
    const destino = palco?.avatar || canvas;
    itens.push({
      trilha: 'avatar', arquivo: midia.avatar.nome, start: de, end: ate, fonteDe: de, velocidade: 1, volume: 1,
      destino,
      recorte: palco?.avatar ? recorteCover(midia.avatar.w, midia.avatar.h, destino, ins!.focoAvatarY) : RECORTE_INTEIRO,
      // No split o render redesenha o avatar sem zoom (a escala é do quadro cheio).
      escala: palco?.avatar ? undefined : keyframesDeZoom(roteiro.zoom, de, ate, fps),
    });
  };
  for (const d of divisoes) {
    pedacoAvatar(cursor, Math.min(d.start, dur));
    pedacoAvatar(Math.max(cursor, d.start), Math.min(d.end, dur), d.ins);
    cursor = Math.max(cursor, Math.min(d.end, dur));
  }
  pedacoAvatar(cursor, dur);
  for (const it of itens) if (it.escala && !it.escala.length) delete it.escala;

  // B-ROLL: a parte que anda (na velocidade do plano) e, se o plano congela,
  // o último quadro parado até o fim da janela.
  for (const ins of inserts) {
    const m = midia.inserts.get(ins.id);
    if (!m) { avisos.push(`o b-roll "${ins.nome}" não está mais salvo no navegador — ficou fora do projeto.`); continue; }
    const palco = palcoDoLayout(ins.layout, W, H);
    const destino = palco.insert;
    const recorte = recorteCover(m.arquivo.w || ins.w, m.arquivo.h || ins.h, destino, 0.5);
    const volume = ins.audio && ins.tipo === 'video' ? Math.min(1, Math.max(0, ins.volume)) : 0;
    if (ins.tipo === 'imagem') {
      itens.push({ trilha: 'broll', arquivo: m.arquivo.nome, start: ins.start, end: ins.end, fonteDe: 0, velocidade: 1, volume: 0, destino, recorte });
      continue;
    }
    const congela = ins.congelaApos > 0.02 && ins.congelaApos < ins.end - ins.start - 0.02;
    const fimAnda = congela ? ins.start + ins.congelaApos : ins.end;
    itens.push({ trilha: 'broll', arquivo: m.arquivo.nome, start: ins.start, end: fimAnda, fonteDe: ins.deSec, velocidade: ins.velocidade || 1, volume, destino, recorte });
    if (congela) {
      if (m.congelado) {
        itens.push({ trilha: 'broll', arquivo: m.congelado.nome, start: fimAnda, end: ins.end, fonteDe: 0, velocidade: 1, volume: 0, destino, recorte });
      } else {
        avisos.push(`o b-roll "${ins.nome}" é mais curto que o trecho: no Pilot o último quadro fica parado; aqui ele termina antes.`);
      }
    }
    if (ins.layout.tipo === 'cards') avisos.push(`o b-roll "${ins.nome}" usa cards com cantos arredondados — no editor os cantos ficam retos.`);
  }

  // TRANSIÇÃO: a mesma ordem de ocorrências do coberturaNoInstante (cada
  // borda conta, o `misto` alterna). Bordas coladas: vale a primeira, como no
  // render.
  const meia = TRANSICAO_DUR_SEC / 2;
  let n = 0;
  let ultimaBorda = -Infinity;
  for (const ins of inserts) {
    for (const borda of [ins.start, ins.end]) {
      const ocorrencia = n++;
      if (ins.transicao === 'nenhuma') continue;
      if (borda - ultimaBorda < TRANSICAO_DUR_SEC - 1e-6) continue;
      const cor = ins.transicao === 'escurecer' ? 'preto' : ins.transicao === 'luz' ? 'branco' : ocorrencia % 2 === 0 ? 'preto' : 'branco';
      const arquivo = cor === 'preto' ? midia.preto : midia.branco;
      if (!arquivo) continue;
      const de = Math.max(0, borda - meia);
      const ate = Math.min(dur, borda + meia);
      if (!(ate - de > 0.02)) continue;
      ultimaBorda = borda;
      const alfa = (t: number) => Math.round(Math.max(0, 1 - Math.abs(t - borda) / meia) * 1000) / 1000;
      const pontos = [de, borda, ate].filter((t, i, a) => i === 0 || t - a[i - 1] > 1e-3);
      itens.push({
        trilha: 'transicao', arquivo: arquivo.nome, start: de, end: ate, fonteDe: 0, velocidade: 1, volume: 0,
        destino: canvas, recorte: RECORTE_INTEIRO,
        opacidade: pontos.map((t) => ({ t: Math.round((t - de) * 1e6) / 1e6, v: alfa(t) })),
      });
    }
  }

  for (const l of midia.legendas) {
    itens.push({ trilha: 'legenda', arquivo: l.arquivo.nome, start: l.start, end: l.end, fonteDe: 0, velocidade: 1, volume: 0, destino: canvas, recorte: RECORTE_INTEIRO });
  }
  for (const h of midia.headlines) {
    itens.push({ trilha: 'headline', arquivo: h.arquivo.nome, start: h.start, end: h.end, fonteDe: 0, velocidade: 1, volume: 0, destino: canvas, recorte: RECORTE_INTEIRO });
  }

  const arquivos = [midia.avatar, ...[...midia.inserts.values()].flatMap((m) => [m.arquivo, ...(m.congelado ? [m.congelado] : [])]),
    ...midia.legendas.map((l) => l.arquivo), ...midia.headlines.map((h) => h.arquivo),
    ...(itens.some((i) => i.arquivo === midia.preto?.nome) ? [midia.preto!] : []),
    ...(itens.some((i) => i.arquivo === midia.branco?.nome) ? [midia.branco!] : [])];
  const unicos = [...new Map(arquivos.map((a) => [a.nome, a])).values()];
  return { nome, W, H, fps, durSec: dur, arquivos: unicos, itens, avisos };
}

/* ═══════════════════════════ CapCut (draft da versão 9.x) ═══════════════ */

/** O CapCut troca este marcador pela pasta do próprio projeto — é o que ele
 *  mesmo grava em Resources/. Mídia dentro da pasta do draft fica portátil:
 *  basta colocar a pasta na raiz de projetos do CapCut. */
export const CAPCUT_PASTA_DO_DRAFT = '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##';
export const CAPCUT_SUBPASTA_MIDIA = 'Resources/pilot';
export const CAPCUT_RAIZ_PADRAO = 'D:/capcut2/drafts/CapCut Drafts';

const US = 1_000_000;
const us = (s: number) => Math.max(0, Math.round(s * US));

type Gerador = () => string;
function geradorPadrao(): Gerador {
  return () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, '');
}

const PLATAFORMA = { app_id: 359289, app_source: 'cc', app_version: '6.5.0', device_id: 'c4ca4238a0b923820dcc509a6f75849b', hard_disk_id: '307563e0192a94465c0e927fbc482942', mac_address: 'c3371f2d4fb02791c067ce44d8fb4ed5', os: 'windows', os_version: '10.0' };

/** Geometria do item no modelo do CapCut: a mídia (já recortada) entra
 *  ENCAIXADA no canvas em escala 1; `scale` e `transform` (unidade = meio
 *  canvas, y pra cima) levam ela ao retângulo de destino. */
export function geometriaCapCut(item: ItemTimeline, arquivo: ArquivoProjeto, W: number, H: number) {
  const cw = Math.max(1, (arquivo.w || W) * (item.recorte.x1 - item.recorte.x0));
  const ch = Math.max(1, (arquivo.h || H) * (item.recorte.y1 - item.recorte.y0));
  const encaixe = Math.min(W / cw, H / ch);
  const escala = item.destino.w / (cw * encaixe);
  const cx = item.destino.x + item.destino.w / 2;
  const cy = item.destino.y + item.destino.h / 2;
  return { escala: r6(escala), x: r6((cx - W / 2) / (W / 2)), y: r6(-(cy - H / 2) / (H / 2)) };
}

export function montarDraftCapCut(tl: ProjetoTimeline, opts: { raiz?: string; pasta: string; agoraUs?: number; novoId?: Gerador }) {
  const novoId = opts.novoId || geradorPadrao();
  const porNome = new Map(tl.arquivos.map((a) => [a.nome, a]));
  const caminho = (nome: string) => `${CAPCUT_PASTA_DO_DRAFT}/${CAPCUT_SUBPASTA_MIDIA}/${nome}`;
  const videos: Record<string, unknown>[] = [];
  const speeds: Record<string, unknown>[] = [];
  const ordem: ItemTimeline['trilha'][] = ['avatar', 'broll', 'transicao', 'legenda', 'headline'];
  const nomesTrilha: Record<ItemTimeline['trilha'], string> = { avatar: 'AVATAR', broll: 'B-ROLL', transicao: 'TRANSICAO', legenda: 'LEGENDA', headline: 'HEADLINE' };
  const tracks: Record<string, unknown>[] = [];
  let duracao = 0;
  ordem.forEach((trilha, indice) => {
    const itens = tl.itens.filter((i) => i.trilha === trilha).sort((a, b) => a.start - b.start);
    if (!itens.length) return;
    const segments = itens.map((item) => {
      const arquivo = porNome.get(item.arquivo)!;
      const foto = arquivo.tipo === 'imagem';
      // Cada item tem o SEU material: o recorte (crop) mora no material, e o
      // mesmo arquivo pode aparecer com recortes diferentes (split x cheia).
      const materialId = novoId();
      videos.push({
        audio_fade: null, category_id: '', category_name: 'local', check_flag: 63487,
        crop: { upper_left_x: item.recorte.x0, upper_left_y: item.recorte.y0, upper_right_x: item.recorte.x1, upper_right_y: item.recorte.y0,
          lower_left_x: item.recorte.x0, lower_left_y: item.recorte.y1, lower_right_x: item.recorte.x1, lower_right_y: item.recorte.y1 },
        crop_ratio: 'free', crop_scale: 1.0,
        duration: foto ? 10_800_000_000 : us(arquivo.durSec),
        height: foto ? 0 : arquivo.h, id: materialId, local_material_id: '', material_id: materialId,
        material_name: arquivo.nome, media_path: '', path: caminho(arquivo.nome), remote_url: null,
        type: foto ? 'photo' : 'video', width: foto ? 0 : arquivo.w,
      });
      const speedId = novoId();
      speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: foto ? null : item.velocidade, type: 'speed' });
      const alvo = { start: us(item.start), duration: Math.max(1, us(item.end) - us(item.start)) };
      // Fonte = alvo × velocidade, sem passar do arquivo (o plano já garante).
      const fonteDur = foto ? alvo.duration : Math.min(Math.round(alvo.duration * item.velocidade), Math.max(1, us(arquivo.durSec) - us(item.fonteDe)));
      duracao = Math.max(duracao, alvo.start + alvo.duration);
      const g = geometriaCapCut(item, arquivo, tl.W, tl.H);
      const keyframes: Record<string, unknown>[] = [];
      if (item.escala?.length) {
        keyframes.push({ id: novoId(), material_id: '', property_type: 'KFTypeScaleX',
          keyframe_list: item.escala.map((k) => ({ curveType: 'Line', graphID: '', left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 }, id: novoId(), time_offset: us(k.t), values: [r6(k.v * g.escala)] })) });
      }
      if (item.opacidade?.length) {
        keyframes.push({ id: novoId(), material_id: '', property_type: 'KFTypeAlpha',
          keyframe_list: item.opacidade.map((k) => ({ curveType: 'Line', graphID: '', left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 }, id: novoId(), time_offset: us(k.t), values: [k.v] })) });
      }
      return {
        enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true, enable_color_match_adjust: false,
        enable_color_wheels: true, enable_lut: true, enable_smart_color_adjust: false, last_nonzero_volume: 1.0, reverse: false,
        track_attribute: 0, track_render_index: 0, visible: true, id: novoId(), material_id: materialId,
        target_timerange: alvo, common_keyframes: keyframes, keyframe_refs: [],
        source_timerange: { start: foto ? 0 : us(item.fonteDe), duration: Math.max(1, fonteDur) },
        speed: foto ? null : item.velocidade, volume: item.volume, extra_material_refs: [speedId],
        clip: { alpha: item.opacidade?.length ? item.opacidade[0].v : 1.0, flip: { horizontal: false, vertical: false }, rotation: 0.0,
          scale: { x: g.escala, y: g.escala }, transform: { x: g.x, y: g.y } },
        uniform_scale: { on: true, value: 1.0 }, hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 }, render_index: indice,
      };
    });
    tracks.push({ attribute: 0, flag: 0, id: novoId(), is_default_name: false, name: nomesTrilha[trilha], segments, type: 'video' });
  });

  const materiaisVazios = ['ai_translates', 'audio_balances', 'audio_effects', 'audio_fades', 'audio_track_indexes', 'audios', 'beats', 'canvases', 'chromas', 'color_curves',
    'digital_humans', 'drafts', 'effects', 'flowers', 'green_screens', 'handwrites', 'hsl', 'images', 'log_color_wheels', 'loudnesses', 'manual_deformations', 'masks',
    'material_animations', 'material_colors', 'multi_language_refs', 'placeholders', 'plugin_effects', 'primary_color_wheels', 'realtime_denoises', 'shapes', 'smart_crops',
    'smart_relights', 'sound_channel_mappings', 'stickers', 'tail_leaders', 'text_templates', 'texts', 'time_marks', 'transitions', 'video_effects', 'video_trackings',
    'vocal_beautifys', 'vocal_separations'];
  const materials: Record<string, unknown[]> = Object.fromEntries(materiaisVazios.map((k) => [k, []]));
  materials.videos = videos;
  materials.speeds = speeds;

  const conteudo = {
    canvas_config: { width: tl.W, height: tl.H, ratio: 'original' }, color_space: 0,
    config: { adjust_max_index: 1, attachment_info: [], combination_max_index: 1, export_range: null, extract_audio_last_index: 1, lyrics_recognition_id: '',
      lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: true, material_save_mode: 0, multi_language_current: 'none', multi_language_list: [],
      multi_language_main: 'none', multi_language_mode: 'none', original_sound_last_index: 1, record_audio_last_index: 1, sticker_max_index: 1,
      subtitle_keywords_config: null, subtitle_recognition_id: '', subtitle_sync: true, subtitle_taskinfo: [], system_font_list: [], video_mute: false, zoom_info_params: null },
    cover: null, create_time: 0, duration: duracao, extra_info: null, fps: tl.fps, free_render_index_mode_on: false, group_container: null,
    id: novoId().toUpperCase(), keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: PLATAFORMA, materials, mutable_config: null, name: '', new_version: '110.0.0', relationships: [],
    render_index_track_mode_on: true, retouch_cover: null, source: 'default', static_cover_image_path: '', time_marks: null, tracks,
    update_time: 0, version: 360000, platform: PLATAFORMA,
  };

  const raiz = (opts.raiz || CAPCUT_RAIZ_PADRAO).replace(/\\/g, '/').replace(/\/+$/, '');
  const agora = opts.agoraUs ?? Date.now() * 1000;
  const itensImportados = tl.arquivos.map((a) => ({
    ai_group_type: '', create_time: 0, duration: a.tipo === 'imagem' ? 5_000_000 : us(a.durSec), enter_from: 0, extra_info: a.nome,
    file_Path: `${raiz}/${opts.pasta}/${CAPCUT_SUBPASTA_MIDIA}/${a.nome}`, height: a.h, id: novoId(), import_time: 0, import_time_ms: 0,
    item_source: 1, md5: '', metetype: a.tipo === 'imagem' ? 'photo' : 'video', roughcut_time_range: { duration: a.tipo === 'imagem' ? 5_000_000 : us(a.durSec), start: 0 },
    sub_time_range: { duration: -1, start: -1 }, type: 0, width: a.w,
  }));
  const meta = {
    cloud_draft_cover: false, cloud_draft_sync: false, cloud_package_completed_time: '', draft_cloud_capcut_purchase_info: '', draft_cloud_last_action_download: false,
    draft_cloud_package_type: '', draft_cloud_purchase_info: '', draft_cloud_template_id: '', draft_cloud_tutorial_info: '', draft_cloud_videocut_purchase_info: '',
    draft_cover: '', draft_deeplink_url: '', draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] },
    draft_fold_path: `${raiz}/${opts.pasta}`, draft_id: novoId().toUpperCase(), draft_is_ae_produce: false, draft_is_ai_packaging_used: false, draft_is_ai_shorts: false,
    draft_is_ai_translate: false, draft_is_article_video_draft: false, draft_is_cloud_temp_draft: false, draft_is_from_deeplink: 'false', draft_is_invisible: false,
    draft_is_pippit_draft: false, draft_is_web_article_video: false,
    draft_materials: [0, 1, 2, 3, 6, 7, 8].map((type) => ({ type, value: type === 0 ? itensImportados : [] })),
    draft_materials_copied_info: [], draft_name: opts.pasta, draft_need_rename_folder: false, draft_new_version: '164.0.0', draft_removable: true,
    draft_removable_storage_device: '', draft_root_path: raiz, draft_segment_extra_info: [], draft_timeline_materials_size_: 0, draft_type: '',
    draft_web_article_video_enter_from: '', tm_draft_cloud_completed: '', tm_draft_cloud_entry_id: -1, tm_draft_cloud_modified: agora,
    tm_draft_cloud_parent_entry_id: -1, tm_draft_cloud_space_id: -1, tm_draft_cloud_user_id: -1, tm_draft_create: agora, tm_draft_modified: agora,
    tm_draft_removed: 0, tm_duration: duracao, draft_cover_hd: '',
  };
  // UTF-8 SEM BOM: o CapCut recusa o projeto inteiro com BOM ("caminho desconhecido").
  return { conteudo: JSON.stringify(conteudo), meta: JSON.stringify(meta) };
}

/* ═══════════════════════════ Premiere (Final Cut Pro 7 XML) ══════════════ */

const DURACAO_IMAGEM_QUADROS = 108_000;
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Geometria do item no Premiere: a mídia entra no tamanho NATIVO (100%) com
 *  o centro no centro da sequência; Crop corta em % das bordas, Scale e
 *  Center (fração da sequência, 0 = centro) levam o recorte ao destino. */
export function geometriaPremiere(item: ItemTimeline, arquivo: ArquivoProjeto, W: number, H: number) {
  const mw = arquivo.w || W;
  const mh = arquivo.h || H;
  const cw = mw * (item.recorte.x1 - item.recorte.x0);
  const escala = item.destino.w / Math.max(1, cw);
  const offX = ((item.recorte.x0 + item.recorte.x1) / 2 - 0.5) * mw * escala;
  const offY = ((item.recorte.y0 + item.recorte.y1) / 2 - 0.5) * mh * escala;
  const cx = item.destino.x + item.destino.w / 2 - offX;
  const cy = item.destino.y + item.destino.h / 2 - offY;
  return {
    escalaPct: Math.round(escala * 100 * 1000) / 1000,
    centroX: r6((cx - W / 2) / W),
    centroY: r6((cy - H / 2) / H),
    crop: { esquerda: r6(item.recorte.x0 * 100), direita: r6((1 - item.recorte.x1) * 100), topo: r6(item.recorte.y0 * 100), base: r6((1 - item.recorte.y1) * 100) },
  };
}

export function montarXmlPremiere(tl: ProjetoTimeline, opts: { pastaMidia?: string } = {}): string {
  const fps = tl.fps;
  const f = (s: number) => Math.round(s * fps);
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const porNome = new Map(tl.arquivos.map((a) => [a.nome, a]));
  const base = (opts.pastaMidia || `PILOT/${CAPCUT_SUBPASTA_MIDIA}`).replace(/\\/g, '/').replace(/\/+$/, '');
  // Formato que o próprio Premiere grava no Windows: file://localhost/D%3a/...
  // Sem pasta conhecida, o caminho não existe e o Premiere abre o "Link Media".
  const url = (nome: string) => `file://localhost/${encodeURI(`${base}/${nome}`).replace(/#/g, '%23').replace(/^([A-Za-z]):/, '$1%3a')}`;
  const fileIds = new Map<string, string>();
  let fileSeq = 0;
  let clipSeq = 0;
  const arquivoXml = (a: ArquivoProjeto) => {
    const existente = fileIds.get(a.nome);
    if (existente) return `<file id="${existente}"/>`;
    const id = `file-${++fileSeq}`;
    fileIds.set(a.nome, id);
    // Imagem parada não tem fim: a duração "longa" deixa o clipe durar o que precisar.
    const dur = a.tipo === 'imagem' ? DURACAO_IMAGEM_QUADROS : f(a.durSec);
    const audio = a.temAudio ? `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>` : '';
    return `<file id="${id}"><name>${xmlEsc(a.nome)}</name><pathurl>${xmlEsc(url(a.nome))}</pathurl>${rate}<duration>${dur}</duration>`
      + `<media><video><samplecharacteristics>${rate}<width>${a.w}</width><height>${a.h}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>${audio}</media></file>`;
  };
  const param = (id: string, nome: string, valor: string, keys?: Array<{ quadro: number; valor: string }>) =>
    `<parameter authoringApp="PremierePro"><parameterid>${id}</parameterid><name>${nome}</name>`
    + (keys?.length ? keys.map((k) => `<keyframe><when>${k.quadro}</when><value>${k.valor}</value></keyframe>`).join('') : `<value>${valor}</value>`)
    + `</parameter>`;
  const efeito = (nome: string, id: string, categoria: string, tipo: string, params: string) =>
    `<filter><effect><name>${nome}</name><effectid>${id}</effectid><effectcategory>${categoria}</effectcategory><effecttype>${tipo}</effecttype><mediatype>video</mediatype>${params}</effect></filter>`;

  const trilhaVideo = (trilha: ItemTimeline['trilha']) => {
    const itens = tl.itens.filter((i) => i.trilha === trilha).sort((a, b) => a.start - b.start);
    if (!itens.length) return '';
    const clips = itens.map((item) => {
      const a = porNome.get(item.arquivo)!;
      const foto = a.tipo === 'imagem';
      const ini = f(item.start);
      const fim = Math.max(ini + 1, f(item.end));
      const dentro = foto ? 0 : f(item.fonteDe);
      const fora = foto ? fim - ini : dentro + Math.max(1, Math.round((fim - ini) * item.velocidade));
      const g = geometriaPremiere(item, a, tl.W, tl.H);
      const escalaKeys = item.escala?.map((k) => ({ quadro: dentro + Math.round(k.t * fps * item.velocidade), valor: String(Math.round(g.escalaPct * k.v * 1000) / 1000) }));
      let filtros = efeito('Basic Motion', 'basic', 'motion', 'motion',
        param('scale', 'Scale', String(g.escalaPct), escalaKeys)
        + `<parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>${g.centroX}</horiz><vert>${g.centroY}</vert></value></parameter>`);
      if (g.crop.esquerda + g.crop.direita + g.crop.topo + g.crop.base > 0.01) {
        filtros += efeito('Crop', 'crop', 'motion', 'motion',
          param('left', 'left', String(g.crop.esquerda)) + param('right', 'right', String(g.crop.direita))
          + param('top', 'top', String(g.crop.topo)) + param('bottom', 'bottom', String(g.crop.base)));
      }
      if (!foto && Math.abs(item.velocidade - 1) > 1e-3) {
        filtros += efeito('Time Remap', 'timeremap', 'motion', 'motion',
          param('variablespeed', 'variablespeed', '0') + param('speed', 'speed', String(Math.round(item.velocidade * 100 * 100) / 100))
          + param('reverse', 'reverse', 'FALSE') + param('frameblending', 'frameblending', 'FALSE'));
      }
      if (item.opacidade?.length) {
        filtros += efeito('Opacity', 'opacity', 'motion', 'motion',
          param('opacity', 'opacity', '100', item.opacidade.map((k) => ({ quadro: dentro + Math.round(k.t * fps), valor: String(Math.round(k.v * 100)) }))));
      }
      const id = `clipitem-${++clipSeq}`;
      return `<clipitem id="${id}"><name>${xmlEsc(a.nome)}</name><enabled>TRUE</enabled><duration>${foto ? DURACAO_IMAGEM_QUADROS : f(a.durSec)}</duration>${rate}`
        + `<start>${ini}</start><end>${fim}</end><in>${dentro}</in><out>${fora}</out>${arquivoXml(a)}${filtros}</clipitem>`;
    });
    return `<track>${clips.join('')}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
  };

  // ÁUDIO: a fala do avatar e só o som dos b-rolls que o editor ligou.
  const trilhaAudio = (filtro: (i: ItemTimeline) => boolean) => {
    const itens = tl.itens.filter(filtro).sort((a, b) => a.start - b.start);
    if (!itens.length) return '';
    return `<track>${itens.map((item) => {
      const a = porNome.get(item.arquivo)!;
      const ini = f(item.start);
      const fim = Math.max(ini + 1, f(item.end));
      const dentro = f(item.fonteDe);
      const fora = dentro + Math.max(1, Math.round((fim - ini) * item.velocidade));
      const nivel = `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>`
        + `<parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${Math.round(item.volume * 1000) / 1000}</value></parameter></effect></filter>`;
      return `<clipitem id="clipitem-${++clipSeq}"><name>${xmlEsc(a.nome)}</name><enabled>TRUE</enabled><duration>${f(a.durSec)}</duration>${rate}`
        + `<start>${ini}</start><end>${fim}</end><in>${dentro}</in><out>${fora}</out>${arquivoXml(a)}<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>${nivel}</clipitem>`;
    }).join('')}<enabled>TRUE</enabled><locked>FALSE</locked></track>`;
  };

  const duracao = f(tl.durSec);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n'
    + `<xmeml version="4"><sequence id="sequence-1"><name>${xmlEsc(tl.nome)}</name><duration>${duracao}</duration>${rate}`
    + `<media><video><format><samplecharacteristics>${rate}<width>${tl.W}</width><height>${tl.H}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>`
    + (['avatar', 'broll', 'transicao', 'legenda', 'headline'] as const).map(trilhaVideo).join('')
    + `</video><audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>`
    + trilhaAudio((i) => i.trilha === 'avatar' && !!porNome.get(i.arquivo)?.temAudio)
    + trilhaAudio((i) => i.trilha === 'broll' && i.volume > 0 && !!porNome.get(i.arquivo)?.temAudio)
    + `</audio></media></sequence></xmeml>\n`;
}

/* ═══════════════════════════ LEIA-ME ════════════════════════════════════ */

export function leiaMeDoProjeto(tl: ProjetoTimeline, opts: { pasta: string; temSrt: boolean }): string {
  const linhas = [
    `PROJETO EDITÁVEL — ${tl.nome}`,
    `Gerado pelo ClickUp Pilot (Auto Edit) · ${tl.W}x${tl.H} · ${tl.fps}fps · ${tl.durSec.toFixed(1)}s`,
    '',
    'CAMADAS',
    '  1. AVATAR    — o avatar completo, com a fala (e o zoom, como keyframes de escala)',
    '  2. B-ROLL    — os b-rolls no tempo exato do Pilot (recorte, velocidade e tela dividida)',
    '  3. TRANSICAO — escurecer/luz nas bordas dos b-rolls (opacidade animada)',
    '  4. LEGENDA   — a legenda do Auto Edit em imagens PNG transparentes, uma por mudança',
    ...(tl.itens.some((i) => i.trilha === 'headline') ? ['  5. HEADLINE  — o texto fixo por cima, em PNG'] : []),
    '',
    'CAPCUT',
    `  Copie a pasta "${opts.pasta}" inteira para a pasta de projetos do CapCut`,
    '  (CapCut > Configurações > Projetos > Local dos rascunhos — ex.: D:\\capcut2\\drafts\\CapCut Drafts).',
    '  Feche e abra o CapCut: o projeto aparece na lista com o mesmo nome.',
    '',
    'PREMIERE PRO',
    `  Arquivo > Importar > "${opts.pasta}\\PREMIERE - ${tl.nome}.xml".`,
    '  Se ele pedir para localizar a mídia, aponte UM arquivo dentro de',
    `  "${opts.pasta}\\${CAPCUT_SUBPASTA_MIDIA.replace('/', '\\')}" e deixe "Relink others automatically" marcado: o resto se acha sozinho.`,
    '',
    ...(opts.temSrt ? ['LEGENDA EM TEXTO', `  "LEGENDA - ${tl.nome}.srt" tem a mesma legenda como texto editável (CapCut: Legendas > Importar; Premiere: Arquivo > Importar).`, ''] : []),
    ...(tl.avisos.length ? ['ATENÇÃO', ...tl.avisos.map((a) => `  • ${a}`), ''] : []),
  ];
  return linhas.join('\r\n');
}
