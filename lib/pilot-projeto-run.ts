/**
 * EXPORTADOR do projeto editável — SÓ BROWSER (IndexedDB + canvas).
 *
 * Lê o avatar limpo e o roteiro que a pós-produção guardou, as mídias dos
 * b-rolls, desenha a legenda e a headline em PNGs transparentes com o MESMO
 * motor do render (drawCaptions / drawHeadlines) e escreve, por vídeo
 * montado, uma pasta de projeto do CapCut que também traz o XML do Premiere,
 * o .srt e um LEIA-ME. As decisões (tempos, recortes, keyframes, formatos)
 * moram em pilot-projeto.ts, que é puro e testado.
 */

import {
  CAPCUT_RAIZ_PADRAO, CAPCUT_SUBPASTA_MIDIA, chavesDoProjeto, intervalosDaLegenda, leiaMeDoProjeto, montarDraftCapCut,
  montarTimeline, montarXmlPremiere, prefixoDoProjeto, srtDaLegenda,
  type ArquivoProjeto, type MidiaDoProjeto, type RoteiroEdicao,
} from './pilot-projeto';
import { aberturaDoOlho, palcoDoLayout, PISCAR_ANTES_SEC, PISCAR_DEPOIS_SEC } from './pilot-inserts';
import { SFX_CATALOGO, type SfxId } from './pilot-sonoplastia';

/** Pra onde vai o pacote: o CapCut (pasta do rascunho) ou o Premiere (XML + mídia). */
export type AlvoDoPacote = 'capcut' | 'premiere';
/** Onde o Premiere procura a mídia sozinho — a dica do PDF manda extrair aqui. */
export const PREMIERE_RAIZ_SUGERIDA = 'C:/AUTOEDIT';
/** Subpasta da mídia no pacote do Premiere (o XML aponta pra ela). */
export const PREMIERE_SUBPASTA_MIDIA = 'MIDIA';

/** Extensão de um áudio pelos bytes (a biblioteca guarda sem extensão). */
async function extensaoDoAudio(blob: Blob): Promise<string> {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const txt = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (txt(0, 4) === 'RIFF') return 'wav';
  if (txt(0, 4) === 'OggS') return 'ogg';
  if (txt(4, 4) === 'ftyp') return 'm4a';
  if (txt(0, 4) === 'fLaC') return 'flac';
  return 'mp3';
}

/** As pálpebras da piscada quadro a quadro, em PNG transparente: um por
 *  quadro de 30fps, com o intervalo dele relativo à borda (s). */
async function framesDoOlho(W: number, H: number, fps: number): Promise<Array<{ blob: Blob; de: number; ate: number }>> {
  const { desenharPalpebras } = await import('./transicao-olho');
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const out: Array<{ blob: Blob; de: number; ate: number }> = [];
  const meio = 0.5 / fps;
  for (let k = Math.ceil(-PISCAR_ANTES_SEC * fps); k <= Math.floor(PISCAR_DEPOIS_SEC * fps); k++) {
    const d = k / fps;
    const a = aberturaDoOlho(d);
    if (a >= 0.999) continue;
    ctx.clearRect(0, 0, W, H);
    desenharPalpebras(ctx, W, H, a);
    const blob = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));
    if (blob) out.push({ blob, de: d - meio, ate: d + meio });
  }
  return out;
}

export type ProjetoDisponivel = { filename: string; chaveBase: string; chaveRoteiro: string; roteiro: RoteiroEdicao };

/** Os projetos guardados desta task — só os da geração atual quando há. */
export async function projetosDaTask(taskId: string, genId?: string): Promise<ProjetoDisponivel[]> {
  const { listarChavesPorPrefixo, loadBlob } = await import('./zip-store');
  const chaves = (await listarChavesPorPrefixo(prefixoDoProjeto(taskId))).filter((k) => k.endsWith(':roteiro'));
  const out: ProjetoDisponivel[] = [];
  for (const chave of chaves) {
    try {
      const blob = await loadBlob(chave, 'application/json');
      if (!blob) continue;
      const roteiro = JSON.parse(await blob.text()) as RoteiroEdicao;
      if (roteiro?.versao !== 1 || !roteiro.filename) continue;
      const ch = chavesDoProjeto(taskId, roteiro.filename);
      out.push({ filename: roteiro.filename, chaveBase: ch.base, chaveRoteiro: chave, roteiro });
    } catch (e) {
      console.warn('[projeto] roteiro ilegível', chave, e);
    }
  }
  const daGeracao = genId ? out.filter((p) => p.roteiro.genId === genId) : [];
  return (daGeracao.length ? daGeracao : out).sort((a, b) => a.filename.localeCompare(b.filename, 'pt-BR', { numeric: true }));
}

/* ─────────────────────────── mídia no navegador ─────────────────────────── */

async function medirVideo(blob: Blob): Promise<{ w: number; h: number; dur: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    const ok = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 15_000);
      v.onloadedmetadata = () => { clearTimeout(t); res(true); };
      v.onerror = () => { clearTimeout(t); res(false); };
      v.src = url;
    });
    let dur = ok && Number.isFinite(v.duration) ? v.duration : 0;
    try {
      const { duracaoDeVideo } = await import('./video-duracao');
      const doCabecalho = await duracaoDeVideo(blob, 0);
      if (doCabecalho > 0) dur = doCabecalho;
    } catch { /* fica a do player */ }
    const w = ok ? v.videoWidth : 0;
    const h = ok ? v.videoHeight : 0;
    v.removeAttribute('src');
    v.load();
    return { w, h, dur };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function medirImagem(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const r = { w: bmp.width, h: bmp.height };
    bmp.close();
    return r;
  } catch {
    return { w: 0, h: 0 };
  }
}

/** O último quadro do recorte, em PNG — é o que o render segura parado. */
async function ultimoQuadro(blob: Blob, emSec: number): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    const pronto = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 15_000);
      v.onloadeddata = () => { clearTimeout(t); res(true); };
      v.onerror = () => { clearTimeout(t); res(false); };
      v.src = url;
    });
    if (!pronto) return null;
    await new Promise<void>((res) => {
      const t = setTimeout(res, 3000);
      v.onseeked = () => { clearTimeout(t); res(); };
      v.currentTime = Math.max(0, emSec);
    });
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    v.removeAttribute('src');
    v.load();
    return await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pngSolido(W: number, H: number, cor: string): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = cor;
  ctx.fillRect(0, 0, W, H);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

/** O clarão da LUZ VERMELHA — o mesmo degradê radial do render (export.ts). */
function pngClaraoVermelho(W: number, H: number): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.hypot(W, H) * 0.62);
  g.addColorStop(0, 'rgb(255, 222, 200)');
  g.addColorStop(0.38, 'rgb(255, 92, 54)');
  g.addColorStop(0.72, 'rgb(214, 18, 34)');
  g.addColorStop(1, 'rgb(120, 0, 14)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

/** A LINHA da divisão num PNG transparente do quadro inteiro (a camada de
 *  cima põe ela na emenda, como o render). */
function pngLinha(W: number, H: number, r: { x: number; y: number; w: number; h: number }, cor: string): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.shadowColor = cor;
  ctx.shadowBlur = Math.max(4, (10 * W) / 1080);
  ctx.fillStyle = cor;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

/** Assinatura barata de um quadro: amostra reduzida dos pixels. Quadros
 *  idênticos (palavra que não muda nada na tela) viram UM PNG só. */
function assinatura(c: HTMLCanvasElement): string {
  const p = document.createElement('canvas');
  p.width = 96;
  p.height = Math.max(1, Math.round((96 * c.height) / c.width));
  const ctx = p.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, p.width, p.height);
  const d = ctx.getImageData(0, 0, p.width, p.height).data;
  let h1 = 2166136261;
  let h2 = 0;
  for (let i = 0; i < d.length; i++) {
    h1 = Math.imul(h1 ^ d[i], 16777619);
    h2 = (h2 + d[i] * (i + 1)) >>> 0;
  }
  return `${(h1 >>> 0).toString(16)}:${h2.toString(16)}`;
}

type Arquivo = { caminho: string; blob: Blob };

const extensao = (blob: Blob, nome: string, tipo: 'video' | 'imagem') => {
  const doNome = /\.([a-z0-9]{2,4})$/i.exec(nome)?.[1]?.toLowerCase();
  if (doNome) return doNome;
  if (/png/.test(blob.type)) return 'png';
  if (/jpe?g/.test(blob.type)) return 'jpg';
  if (/webp/.test(blob.type)) return 'webp';
  if (/quicktime/.test(blob.type)) return 'mov';
  if (/webm/.test(blob.type)) return 'webm';
  return tipo === 'imagem' ? 'png' : 'mp4';
};
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'midia';

/** Nome de pasta aceito pelo Windows e pelo CapCut. */
export function nomeDePasta(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'PROJETO PILOT';
}

/** Monta os arquivos de UM vídeo montado (caminhos relativos à pasta dele). */
async function arquivosDoProjeto(
  p: ProjetoDisponivel,
  pasta: string,
  raizCapCut: string,
  onEtapa?: (msg: string) => void,
  alvo: AlvoDoPacote = 'capcut',
  lerTrilha?: (id: string) => Promise<Blob | null>,
): Promise<{ arquivos: Arquivo[]; avisos: string[]; camadas: string[] }> {
  const { loadBlob } = await import('./zip-store');
  const roteiro = p.roteiro;
  const avisos: string[] = [];
  const arquivos: Arquivo[] = [];
  const midiaDir = alvo === 'premiere' ? PREMIERE_SUBPASTA_MIDIA : CAPCUT_SUBPASTA_MIDIA;
  const add = (nome: string, blob: Blob) => arquivos.push({ caminho: `${midiaDir}/${nome}`, blob });

  onEtapa?.(`${p.filename}: lendo o avatar`);
  const base = await loadBlob(p.chaveBase);
  if (!base || base.size === 0) throw new Error(`o avatar de ${p.filename} não está mais salvo neste navegador — clique "Atualizar montagem" e exporte de novo.`);
  const med = await medirVideo(base);
  if (!(med.w > 0 && med.h > 0)) throw new Error(`não consegui abrir o avatar de ${p.filename} neste navegador.`);
  const W = med.w;
  const H = med.h;
  const avatar: ArquivoProjeto = { nome: 'avatar.mp4', tipo: 'video', w: W, h: H, durSec: med.dur || roteiro.durSec, temAudio: true };
  add(avatar.nome, base);

  // B-ROLLS
  const inserts: MidiaDoProjeto['inserts'] = new Map();
  /** a mesma mídia em dois trechos vira UM arquivo no projeto */
  const porMidia = new Map<string, { arquivo: ArquivoProjeto; blob: Blob }>();
  let n = 0;
  for (const ins of roteiro.inserts) {
    onEtapa?.(`${p.filename}: b-roll ${n + 1}/${roteiro.inserts.length}`);
    let ja = porMidia.get(ins.midiaKey);
    if (!ja) {
      const blob = await loadBlob(ins.midiaKey, ins.tipo === 'imagem' ? 'image/png' : 'video/mp4');
      if (!blob || blob.size === 0) continue; // a timeline avisa o editor
      n++;
      const nome = `broll_${String(n).padStart(2, '0')}_${slug(ins.nome)}.${extensao(blob, ins.nome, ins.tipo)}`;
      let novo: ArquivoProjeto;
      if (ins.tipo === 'imagem') {
        const m = await medirImagem(blob);
        novo = { nome, tipo: 'imagem', w: m.w || ins.w, h: m.h || ins.h, durSec: 0, temAudio: false };
      } else {
        const m = await medirVideo(blob);
        novo = { nome, tipo: 'video', w: ins.w || m.w, h: ins.h || m.h, durSec: m.dur || ins.deSec + ins.naturalSec, temAudio: false };
      }
      add(nome, blob);
      ja = { arquivo: novo, blob };
      porMidia.set(ins.midiaKey, ja);
    }
    // som ligado em qualquer trecho = o arquivo tem áudio pro Premiere
    if (ins.audio && ja.arquivo.tipo === 'video') ja.arquivo.temAudio = true;
    const { arquivo, blob } = ja;
    const nome = arquivo.nome;
    let congelado: ArquivoProjeto | undefined;
    if (ins.tipo === 'video' && ins.congelaApos > 0.02 && ins.congelaApos < ins.end - ins.start - 0.02) {
      const png = await ultimoQuadro(blob, ins.deSec + Math.max(0, ins.naturalSec - 0.05));
      if (png) {
        // um PNG por TRECHO: a mesma mídia pode congelar em pontos diferentes
        congelado = { nome: nome.replace(/\.[^.]+$/, `_ultimo_quadro_${String(inserts.size + 1).padStart(2, '0')}.png`), tipo: 'imagem', w: arquivo.w, h: arquivo.h, durSec: 0, temAudio: false };
        add(congelado.nome, png);
      }
    }
    inserts.set(ins.id, { arquivo, congelado });
  }

  // LEGENDA + HEADLINE em PNG — o mesmo desenho do render
  const legendas: MidiaDoProjeto['legendas'] = [];
  const headlines: MidiaDoProjeto['headlines'] = [];
  let srt = '';
  if (roteiro.legenda?.blocks.length || roteiro.headlines?.length) {
    const [{ ensureTypoFonts }, engine, presets] = await Promise.all([
      import('./typography/fonts'), import('./typography/engine'), import('./typography/presets'),
    ]);
    await ensureTypoFonts();
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    if (roteiro.legenda?.blocks.length) {
      const blocks = roteiro.legenda.blocks as import('./typography/engine').Block[];
      const style = roteiro.legenda.style as import('./typography/engine').StyleState;
      const preset = presets.getPreset(style.presetId);
      srt = srtDaLegenda(roteiro.legenda.blocks, roteiro.durSec > 0 ? roteiro.durSec * 1000 : Infinity);
      // Quando cada bloco está PARADO na tela — a mesma conta do drawCaptions
      // (modelo do bloco + animação escolhida no editor + escalonamento).
      const assentada = (b: (typeof blocks)[number]) => {
        const ov = style.perBlock?.[b.id];
        const st = ov ? { ...style, ...ov } : style;
        const pr = st.presetId && st.presetId !== preset.id ? presets.getPreset(st.presetId) : preset;
        const entrada = st.animIn != null && st.animIn !== pr.in.kind ? engine.IN_SPEC_BY_KIND[st.animIn] : pr.in;
        const saida = st.animOut != null && st.animOut !== pr.out.kind ? engine.OUT_SPEC_BY_KIND[st.animOut] : pr.out;
        const unidades = pr.unit === 'char' ? b.words.reduce((n, w) => n + w.text.length, 0) : pr.unit === 'word' ? b.words.length : 1;
        const de = b.start + Math.max(0, entrada.dur) + Math.max(0, unidades - 1) * (entrada.stagger || 0);
        const oDur = saida.kind !== 'none' && saida.dur > 0 ? Math.min(saida.dur, (b.end - b.start) * 0.45) : 0;
        return { de, ate: b.end - oDur };
      };
      const intervalos = intervalosDaLegenda(roteiro.legenda.blocks, (b) => assentada(b as (typeof blocks)[number]));
      let anterior: { assinatura: string; item: (typeof legendas)[number] } | null = null;
      let k = 0;
      for (let i = 0; i < intervalos.length; i++) {
        const it = intervalos[i];
        if (i % 20 === 0) onEtapa?.(`${p.filename}: legenda ${i + 1}/${intervalos.length}`);
        ctx.clearRect(0, 0, W, H);
        engine.drawCaptions(ctx, blocks, preset, style, it.t, W, H);
        const sig = assinatura(c);
        // Mesmo desenho colado no anterior = o mesmo PNG continua na tela.
        if (anterior && anterior.assinatura === sig && Math.abs(anterior.item.end - it.start / 1000) < 1e-6) {
          anterior.item.end = it.end / 1000;
          continue;
        }
        const png = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));
        if (!png) continue;
        k++;
        const arquivo: ArquivoProjeto = { nome: `legenda_${String(k).padStart(4, '0')}.png`, tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false };
        add(arquivo.nome, png);
        const item = { arquivo, start: it.start / 1000, end: it.end / 1000 };
        legendas.push(item);
        anterior = { assinatura: sig, item };
      }
    }
    if (roteiro.headlines?.length) {
      const { drawHeadlines } = await import('./typography/headline');
      const lista = roteiro.headlines as import('./typography/headline').Headline[];
      for (let i = 0; i < lista.length; i++) {
        const h = lista[i];
        ctx.clearRect(0, 0, W, H);
        drawHeadlines(ctx, [h], h.start + Math.min(400, (h.end - h.start) * 0.5), W, H);
        const png = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));
        if (!png) continue;
        const arquivo: ArquivoProjeto = { nome: `headline_${i + 1}.png`, tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false };
        add(arquivo.nome, png);
        headlines.push({ arquivo, start: h.start / 1000, end: h.end / 1000 });
      }
    }
  }

  // TRANSIÇÃO: telas sólidas que a opacidade anima
  const precisaPreto = roteiro.inserts.some((i) => i.transicao === 'escurecer' || i.transicao === 'misto');
  const precisaBranco = roteiro.inserts.some((i) => i.transicao === 'luz' || i.transicao === 'misto');
  let preto: ArquivoProjeto | undefined;
  let branco: ArquivoProjeto | undefined;
  if (precisaPreto) {
    const b = await pngSolido(W, H, '#000');
    if (b) { preto = { nome: 'transicao_preto.png', tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false }; add(preto.nome, b); }
  }
  if (precisaBranco) {
    const b = await pngSolido(W, H, '#fff');
    if (b) { branco = { nome: 'transicao_branco.png', tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false }; add(branco.nome, b); }
  }
  let vermelho: ArquivoProjeto | undefined;
  if (roteiro.inserts.some((i) => i.transicao === 'luz-vermelha')) {
    const b = await pngClaraoVermelho(W, H);
    if (b) { vermelho = { nome: 'transicao_vermelho.png', tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false }; add(vermelho.nome, b); }
  }
  // LINHA da tela dividida: um PNG por cor usada
  const linhas = new Map<string, ArquivoProjeto>();
  for (const ins of roteiro.inserts) {
    const linha = palcoDoLayout(ins.layout, W, H).linha;
    if (!linha) continue;
    const cor = linha.cor.toLowerCase();
    if (linhas.has(cor)) continue;
    const b = await pngLinha(W, H, linha, cor);
    if (!b) continue;
    const arquivo: ArquivoProjeto = { nome: `linha_${cor.replace('#', '')}.png`, tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false };
    add(arquivo.nome, b);
    linhas.set(cor, arquivo);
  }

  // PISCAR (08.10): as pálpebras quadro a quadro — o mesmo desenho do render
  let olho: MidiaDoProjeto['olho'];
  if (roteiro.inserts.some((i) => i.transicao === 'piscar')) {
    onEtapa?.(`${p.filename}: desenhando a piscada`);
    const frames = await framesDoOlho(W, H, 30);
    olho = frames.map((f, i) => {
      const arquivo: ArquivoProjeto = { nome: `transicao_piscar_${String(i + 1).padStart(2, '0')}.png`, tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false };
      add(arquivo.nome, f.blob);
      return { arquivo, de: f.de, ate: f.ate };
    });
  }

  // SMART SFX (08.10): cada som usado, em WAV — os MESMOS samples da mixagem
  const sfx = new Map<string, ArquivoProjeto>();
  const idsSfx = [...new Set((roteiro.sfx || []).map((x) => x.sfx))] as SfxId[];
  if (idsSfx.length) {
    onEtapa?.(`${p.filename}: SFX`);
    const { carregarSfx, wavDoSfx } = await import('./pilot-sonoplastia-run');
    for (const id of idsSfx) {
      const buf = await carregarSfx(id);
      const wav = buf ? await wavDoSfx(id) : null;
      if (!buf || !wav) { avisos.push(`não consegui baixar o SFX "${SFX_CATALOGO[id]?.nome || id}" pro projeto — confira a internet e exporte de novo.`); continue; }
      const arquivo: ArquivoProjeto = { nome: SFX_CATALOGO[id].arquivoProjeto, tipo: 'audio', w: 0, h: 0, durSec: buf.duration, temAudio: true, taxa: buf.sampleRate };
      add(arquivo.nome, wav);
      sfx.set(id, arquivo);
    }
  }

  // TRILHA (08.10): o arquivo original da biblioteca
  let trilha: ArquivoProjeto | undefined;
  if (roteiro.trilha?.trilhaId && lerTrilha) {
    onEtapa?.(`${p.filename}: trilha`);
    const blob = await lerTrilha(roteiro.trilha.trilhaId).catch(() => null);
    if (blob && blob.size > 0) {
      const ext = await extensaoDoAudio(blob);
      trilha = { nome: `TRILHA - ${slug(roteiro.trilha.nome)}.${ext}`, tipo: 'audio', w: 0, h: 0, durSec: roteiro.trilha.durTrilha, temAudio: true };
      add(trilha.nome, blob);
    }
  }

  const nome = p.filename.replace(/\.[^.]+$/, '');
  const tl = montarTimeline(nome, roteiro, { avatar, inserts, legendas, headlines, preto, branco, vermelho, linhas, olho, sfx, trilha }, W, H);
  avisos.push(...tl.avisos);
  // só vai pro pacote a mídia que a timeline usa (PNG idêntico já foi fundido)
  const usados = new Set(tl.arquivos.map((a) => a.nome));
  const finais = arquivos.filter((a) => usados.has(a.caminho.slice(midiaDir.length + 1)));

  const enc = (s: string, tipo: string) => new Blob([s], { type: tipo });
  if (alvo === 'capcut') {
    const cc = montarDraftCapCut(tl, { raiz: raizCapCut, pasta });
    finais.push({ caminho: 'draft_content.json', blob: enc(cc.conteudo, 'application/json') });
    finais.push({ caminho: 'draft_meta_info.json', blob: enc(cc.meta, 'application/json') });
  } else {
    // o XML aponta pra raiz sugerida: extraiu lá, o Premiere acha tudo sozinho;
    // extraiu em outro lugar, ele pede UM arquivo e acha o resto
    finais.push({ caminho: `PREMIERE - ${nomeDePasta(nome)}.xml`, blob: enc(montarXmlPremiere(tl, { pastaMidia: `${PREMIERE_RAIZ_SUGERIDA}/${pasta}/${midiaDir}` }), 'application/xml') });
  }
  if (srt) finais.push({ caminho: `LEGENDA - ${nomeDePasta(nome)}.srt`, blob: enc(srt, 'application/x-subrip') });
  // o LEIA-ME fala da pasta do CapCut: no pacote do Premiere quem explica é o PDF
  if (alvo === 'capcut') finais.push({ caminho: 'LEIA-ME.txt', blob: enc(leiaMeDoProjeto(tl, { pasta, temSrt: !!srt }), 'text/plain') });
  return { arquivos: finais, avisos, camadas: camadasDoProjeto(tl, !!srt) };
}

/** As camadas do projeto em linguagem de editor (o PDF lista). */
function camadasDoProjeto(tl: ReturnType<typeof montarTimeline>, temSrt: boolean): string[] {
  const tem = (t: string) => tl.itens.some((i) => i.trilha === t);
  const out = ['AVATAR: o avatar completo, com a fala (e o zoom como keyframes de escala)'];
  if (tem('broll')) out.push('B-ROLL: os b-rolls no tempo exato do Pilot, com recorte, velocidade e tela dividida');
  if (tem('topo')) out.push('AVATAR REACT / LINHA: o avatar do React (num quadro no canto) e a linha da tela dividida');
  if (tem('transicao')) out.push('TRANSIÇÃO: escurecer, luz, luz vermelha e piscar nas bordas dos b-rolls');
  if (tem('legenda')) out.push(`LEGENDA: a legenda do Auto Edit em imagens PNG${temSrt ? ' (e o .srt com o texto editável)' : ''}`);
  if (tem('headline')) out.push('HEADLINE: o texto fixo por cima, em PNG');
  if (tem('sfx')) out.push('SFX: cada som no tempo certo da transição, em faixas de áudio (sem nada sobreposto na mesma faixa)');
  if (tem('musica')) out.push('TRILHA: a música no tamanho do vídeo, já no volume e com fade');
  return out;
}

/* ─────────────────────────── entrega ─────────────────────────── */

export type ResultadoExport = { pastas: string[]; avisos: string[]; zip?: { blob: Blob; nome: string } };

/**
 * Exporta todos os vídeos montados da task. Com `destino` (pasta escolhida
 * pelo usuário — de preferência a pasta de projetos do CapCut) grava direto
 * lá, uma pasta por vídeo; sem, devolve um .zip com as mesmas pastas.
 */
export async function exportarProjetosEditaveis(opts: {
  projetos: ProjetoDisponivel[];
  nomeBase: string;
  destino?: FileSystemDirectoryHandle | null;
  raizCapCut?: string;
  onEtapa?: (msg: string) => void;
  /** CapCut (pasta do rascunho) ou Premiere (XML + mídia). Ausente = CapCut. */
  alvo?: AlvoDoPacote;
  /** lê a trilha da biblioteca (bytes) pro projeto levar o arquivo */
  lerTrilha?: (id: string) => Promise<Blob | null>;
}): Promise<ResultadoExport> {
  const alvo: AlvoDoPacote = opts.alvo || 'capcut';
  const raiz = (opts.raizCapCut || CAPCUT_RAIZ_PADRAO).replace(/\\/g, '/').replace(/\/+$/, '');
  const pastas: string[] = [];
  const avisos: string[] = [];
  const JSZip = opts.destino ? null : (await import('jszip')).default;
  const zip = JSZip ? new JSZip() : null;
  const usados = new Set<string>();
  let camadas: string[] = [];
  for (const p of opts.projetos) {
    const base = nomeDePasta(`${p.filename.replace(/\.[^.]+$/, '')} - PILOT`);
    let pasta = base;
    for (let i = 2; usados.has(pasta.toLowerCase()) || (opts.destino && await existePasta(opts.destino, pasta)); i++) pasta = `${base} (${i})`;
    usados.add(pasta.toLowerCase());
    const r = await arquivosDoProjeto(p, pasta, raiz, opts.onEtapa, alvo, opts.lerTrilha);
    avisos.push(...r.avisos.map((a) => `${p.filename}: ${a}`));
    camadas = camadas.length >= r.camadas.length ? camadas : r.camadas;
    if (opts.destino) {
      opts.onEtapa?.(`${p.filename}: gravando na pasta`);
      const dir = await opts.destino.getDirectoryHandle(pasta, { create: true });
      for (const arq of r.arquivos) await gravar(dir, arq.caminho, arq.blob);
    } else {
      for (const arq of r.arquivos) zip!.file(`${pasta}/${arq.caminho}`, arq.blob);
    }
    pastas.push(pasta);
  }
  if (zip) {
    const nomeZip = `${nomeDePasta(opts.nomeBase)} - ${alvo === 'premiere' ? 'PREMIERE' : 'CAPCUT'}.zip`;
    // o PDF de COMO ABRIR vai na raiz do .zip, do lado das pastas
    opts.onEtapa?.('escrevendo o PDF de como abrir');
    try {
      const { pdfDeComoAbrir } = await import('./pilot-projeto-pdf');
      const pdf = await pdfDeComoAbrir({
        alvo, nomeAd: opts.nomeBase, pastas, zip: nomeZip, camadas, avisos,
        pastaPremiere: alvo === 'premiere' ? PREMIERE_RAIZ_SUGERIDA : undefined,
      });
      zip.file(alvo === 'premiere' ? 'COMO ABRIR NO PREMIERE.pdf' : 'COMO ABRIR NO CAPCUT.pdf', pdf);
    } catch (e) {
      console.warn('[projeto] PDF de instruções falhou (o LEIA-ME.txt continua na pasta):', e);
    }
    opts.onEtapa?.('compactando o pacote');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    return { pastas, avisos, zip: { blob, nome: nomeZip } };
  }
  return { pastas, avisos };
}

async function existePasta(dir: FileSystemDirectoryHandle, nome: string): Promise<boolean> {
  try {
    await dir.getDirectoryHandle(nome, { create: false });
    return true;
  } catch {
    return false;
  }
}

async function gravar(dir: FileSystemDirectoryHandle, caminho: string, blob: Blob): Promise<void> {
  const partes = caminho.split('/');
  let atual = dir;
  for (const parte of partes.slice(0, -1)) atual = await atual.getDirectoryHandle(parte, { create: true });
  const arq = await atual.getFileHandle(partes[partes.length - 1], { create: true });
  const w = await arq.createWritable();
  try {
    await w.write(blob);
  } finally {
    await w.close();
  }
}
