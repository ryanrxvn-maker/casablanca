import {
  CAPCUT_PASTA_DO_DRAFT, chavesDoProjeto, geometriaCapCut, geometriaPremiere, intervalosDaLegenda, leiaMeDoProjeto,
  montarDraftCapCut, montarTimeline, montarXmlPremiere, prefixoDoProjeto, srtDaLegenda, raiasDeAudio,
  type ArquivoProjeto, type MidiaDoProjeto, type ProjetoInsert, type RoteiroEdicao,
} from './pilot-projeto';
import { zipGroupId } from './zip-store-prune';

let passed = 0;
let failed = 0;
function ok(condition: unknown, message: string) {
  if (condition) { passed++; console.log(`  ok   ${message}`); }
  else { failed++; console.error(`  FAIL ${message}`); }
}
const perto = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

console.log('PROJETO EDITÁVEL — CapCut + Premiere a partir do roteiro da pós-produção:');

const chaves = chavesDoProjeto('86abc:v2', 'AD47G1VN - PRPB09.mp4');
ok(chaves.base.startsWith(prefixoDoProjeto('86abc:v2')) && chaves.roteiro.endsWith(':roteiro') && !/ /.test(chaves.base),
  'chaves do projeto ficam sob batch:<task>:projeto:, sem espaço');
ok(zipGroupId(chaves.base) === '86abc:v2' && zipGroupId(chaves.roteiro) === '86abc:v2',
  'faxina trata avatar + roteiro do projeto como parte do disparo (sai junto, nunca sozinho)');

const blocks = [
  { id: 'b1', start: 0, end: 1200, words: [{ text: 'Se', start: 0, end: 200 }, { text: 'você', start: 250, end: 600 }, { text: 'levanta', start: 650, end: 1200 }] },
  { id: 'b2', start: 1500, end: 2400, words: [{ text: 'de madrugada', start: 1500, end: 2400 }] },
];
const srt = srtDaLegenda(blocks);
ok(srt.startsWith('1\r\n00:00:00,000 --> 00:00:01,200\r\nSe você levanta') && srt.includes('2\r\n00:00:01,500 --> 00:00:02,400\r\nde madrugada'),
  'SRT com numeração, tempo hh:mm:ss,mmm e o texto do bloco');
const intervalos = intervalosDaLegenda(blocks);
ok(intervalos.length === 4 && intervalos[0].start === 0 && intervalos[0].end === 250 && intervalos[2].end === 1200
  && intervalos.every((i) => i.t > i.start && i.t < i.end), 'legenda vira um intervalo por palavra (karaokê), desenhado depois da entrada');
// bloco 0–1200: entrada assenta em 300ms, fade de saída começa em 700ms
const assentados = intervalosDaLegenda([blocks[0]], () => ({ de: 300, ate: 700 }));
ok(assentados.length === 3 && assentados.map((i) => [i.start, i.end].join('-')).join(',') === intervalos.slice(0, 3).map((i) => [i.start, i.end].join('-')).join(',')
  && assentados[0].t === 249 && assentados[1].t === 470 && assentados[2].t === 699,
  'PNG desenhado com o bloco PARADO: espera a entrada (1ª palavra no fim do intervalo) e nunca dentro do fade de saída — os tempos das trocas não mudam');

const W = 1080;
const H = 1920;
const avatar: ArquivoProjeto = { nome: 'avatar.mp4', tipo: 'video', w: W, h: H, durSec: 20, temAudio: true };
const broll169: ArquivoProjeto = { nome: 'broll_01.mp4', tipo: 'video', w: 1920, h: 1080, durSec: 3, temAudio: false };
const broll916: ArquivoProjeto = { nome: 'broll_02.mp4', tipo: 'video', w: 1080, h: 1920, durSec: 8, temAudio: true };
const congelado: ArquivoProjeto = { nome: 'broll_01_ultimo_quadro.png', tipo: 'imagem', w: 1920, h: 1080, durSec: 0, temAudio: false };
const preto: ArquivoProjeto = { nome: 'transicao_preto.png', tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false };
const branco: ArquivoProjeto = { nome: 'transicao_branco.png', tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false };
const base: Omit<ProjetoInsert, 'id' | 'nome' | 'midiaKey' | 'start' | 'end'> = {
  tipo: 'video', deSec: 0, naturalSec: 3, velocidade: 1, congelaApos: 0, layout: { tipo: 'cheia' }, transicao: 'escurecer',
  audio: false, volume: 0.5, focoAvatarY: 0.34, w: 1920, h: 1080,
};
const roteiro: RoteiroEdicao = {
  versao: 1, filename: 'AD47G1VN.mp4', criadoEm: 0, durSec: 20,
  inserts: [
    // 3s de mídia numa janela de 5s: desacelera a 0,75x e congela no resto
    { ...base, id: 'i1', nome: 'PRÓSTATA 3D', midiaKey: 'k1', start: 2, end: 7, velocidade: 0.75, congelaApos: 4 },
    // split: avatar em cima, b-roll embaixo, com som ligado
    { ...base, id: 'i2', nome: 'MANGUEIRA', midiaKey: 'k2', start: 10, end: 13, deSec: 1.5, naturalSec: 6.5, w: 1080, h: 1920,
      layout: { tipo: 'faixas', avatar: 'cima' }, transicao: 'misto', audio: true, volume: 0.4 },
  ],
  legenda: { blocks, style: {} },
  zoom: [{ start: 0, end: 2, from: 1, to: 1.12 }, { start: 13, end: 20, from: 1.08, to: 1, rampaAte: 15 }],
  headlines: null,
};
const midia: MidiaDoProjeto = {
  avatar,
  inserts: new Map([['i1', { arquivo: broll169, congelado }], ['i2', { arquivo: broll916 }]]),
  legendas: [{ arquivo: { nome: 'legenda_0001.png', tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false }, start: 0, end: 1.2 }],
  headlines: [],
  preto, branco,
};
const tl = montarTimeline('AD47G1VN', roteiro, midia, W, H);
const av = tl.itens.filter((i) => i.trilha === 'avatar');
ok(av.length === 3 && perto(av[0].start, 0) && perto(av[0].end, 10) && perto(av[1].start, 10) && perto(av[1].end, 13) && perto(av[2].end, 20)
  && av.every((i) => perto(i.fonteDe, i.start)), 'avatar contínuo, partido só na tela dividida (fonte = tempo do vídeo)');
ok(av[1].destino.h === 960 && av[1].destino.y === 0 && perto(av[1].recorte.y0, 0.32 * 0 + av[1].recorte.y0) && !av[1].escala,
  'no split o avatar vai pro retângulo de cima, sem zoom (igual ao render)');
ok(!!av[0].escala && perto(av[0].escala![0].v, 1) && av[0].escala!.some((k) => perto(k.v, 1.12, 0.002)),
  'zoom do avatar vira keyframes da mesma curva do render (1 → 1,12)');
ok(!!av[2].escala && perto(av[2].escala!.at(-1)!.v, 1, 0.002) && av[2].escala!.some((k) => k.t > 1.9 && k.t < 2.1 && perto(k.v, 1, 0.002)),
  'zoom com respiro: a rampa termina em rampaAte e a escala fica parada até o corte');

const br = tl.itens.filter((i) => i.trilha === 'broll');
ok(br.length === 3 && perto(br[0].end, 6) && br[0].velocidade === 0.75 && br[1].arquivo === congelado.nome && perto(br[1].start, 6) && perto(br[1].end, 7),
  'b-roll curto: anda a 0,75x e o último quadro fica parado até o fim da janela');
ok(perto(br[0].recorte.x0, (1920 - 1080 * 1080 / 1920) / 2 / 1920, 1e-4) && perto(br[0].recorte.y0, 0) && perto(br[0].recorte.y1, 1),
  'b-roll 16:9 em tela 9:16 entra em COVER centralizado (como o render)');
ok(br[2].destino.y === 960 && br[2].destino.h === 960 && br[2].volume === 0.4 && perto(br[2].fonteDe, 1.5),
  'split: b-roll no retângulo de baixo, recorte da mídia e som ligado no volume do editor');
ok(br[0].volume === 0, 'b-roll sem som ligado entra mudo');

const tr = tl.itens.filter((i) => i.trilha === 'transicao');
ok(tr.length === 4 && tr[0].arquivo === preto.nome && perto(tr[0].start, 1.86) && perto(tr[0].end, 2.14)
  && tr[0].opacidade!.map((k) => k.v).join(',') === '0,1,0', 'escurecer = V de 0,28s centrado na borda (0 → 1 → 0)');
ok(tr[2].arquivo === preto.nome && tr[3].arquivo === branco.nome, 'misto alterna preto/branco pela ordem das bordas, como no render');

// CapCut
const ids = (() => { let n = 0; return () => `id${(++n).toString(16).padStart(8, '0')}`; })();
const capcut = montarDraftCapCut(tl, { pasta: 'AD47G1VN - PILOT', raiz: 'D:/capcut2/drafts/CapCut Drafts', agoraUs: 1, novoId: ids });
ok(!capcut.conteudo.startsWith('\uFEFF') && !capcut.meta.startsWith('\uFEFF'), 'draft sem BOM (o CapCut recusa BOM)');
const conteudo = JSON.parse(capcut.conteudo);
const meta = JSON.parse(capcut.meta);
ok(conteudo.tracks.map((t: { name: string }) => t.name).join(',') === 'AVATAR,B-ROLL,TRANSICAO,LEGENDA',
  'CapCut: trilhas em camadas — avatar embaixo, b-roll, transição e legenda por cima');
ok(conteudo.materials.videos.every((v: { path: string }) => v.path.startsWith(`${CAPCUT_PASTA_DO_DRAFT}/Resources/pilot/`)),
  'CapCut: mídia referenciada pela pasta do próprio projeto (portátil)');
const segLento = conteudo.tracks[1].segments[0];
ok(segLento.speed === 0.75 && segLento.target_timerange.duration === 4_000_000 && segLento.source_timerange.duration === 3_000_000,
  'CapCut: velocidade 0,75x — 3s de mídia preenchem 4s da janela');
ok(perto(segLento.clip.scale.x, 1) && perto(segLento.clip.transform.x, 0) && perto(segLento.clip.transform.y, 0)
  && perto(conteudo.materials.videos[3].crop.upper_left_x, (1920 - 607.5) / 2 / 1920, 1e-4),
  'CapCut: cover = recorte no material + escala 1 centralizada');
const g = geometriaCapCut(br[2], broll916, W, H);
ok(perto(g.escala, 1) && perto(g.x, 0) && perto(g.y, -0.5), 'CapCut: split — metade de baixo (y = -0,5 meio-canvas)');
const avSplit = conteudo.tracks[0].segments[1];
ok(perto(avSplit.clip.transform.y, 0.5) && avSplit.common_keyframes.length === 0, 'CapCut: avatar do split na metade de cima, sem zoom');
const zoomKf = conteudo.tracks[0].segments[0].common_keyframes[0];
ok(zoomKf.property_type === 'KFTypeScaleX' && zoomKf.keyframe_list.length >= 3, 'CapCut: zoom como keyframes de escala do avatar');
const alfa = conteudo.tracks[2].segments[0].common_keyframes[0];
ok(alfa.property_type === 'KFTypeAlpha' && alfa.keyframe_list.map((k: { values: number[] }) => k.values[0]).join(',') === '0,1,0',
  'CapCut: transição como keyframes de opacidade');
ok(meta.draft_name === 'AD47G1VN - PILOT' && meta.draft_fold_path === 'D:/capcut2/drafts/CapCut Drafts/AD47G1VN - PILOT'
  && meta.draft_materials[0].value.length === tl.arquivos.length, 'CapCut: meta com nome, pasta e mídias no painel Importados');
ok(conteudo.duration === 20_000_000 && conteudo.canvas_config.width === W && conteudo.fps === 30, 'CapCut: duração, canvas 9:16 e 30fps');

// Premiere
const xml = montarXmlPremiere(tl, { pastaMidia: 'D:/capcut2/drafts/CapCut Drafts/AD47G1VN - PILOT/Resources/pilot' });
const abre = (xml.match(/<clipitem /g) || []).length;
const fecha = (xml.match(/<\/clipitem>/g) || []).length;
ok(xml.startsWith('<?xml') && xml.includes('<xmeml version="4">') && abre === fecha && abre > 0, 'Premiere: xmeml v4 bem formado');
ok(xml.includes('file://localhost/D%3a/capcut2/drafts/CapCut%20Drafts/AD47G1VN%20-%20PILOT/Resources/pilot/avatar.mp4'),
  'Premiere: caminho Windows no formato que o próprio Premiere grava');
ok(xml.includes('<effectid>timeremap</effectid>') && xml.includes('<value>75</value>'), 'Premiere: câmera lenta como Time Remap 75%');
ok(xml.includes('<effectid>crop</effectid>'), 'Premiere: recorte do cover/split como Crop');
ok((xml.match(/<file id="file-1">/g) || []).length === 1 && xml.includes('<file id="file-1"/>'), 'Premiere: arquivo declarado uma vez e reaproveitado');
const secaoAudio = xml.split('</video><audio><numOutputChannels>')[1] || '';
const nomesNoAudio = [...secaoAudio.matchAll(/<clipitem id="[^"]+"><name>([^<]+)<\/name>/g)].map((m) => m[1]);
ok(nomesNoAudio.includes('avatar.mp4') && nomesNoAudio.includes('broll_02.mp4') && !nomesNoAudio.includes('broll_01.mp4'),
  'Premiere: áudio do avatar + só o b-roll com som ligado');
const gp = geometriaPremiere(br[0], broll169, W, H);
ok(perto(gp.escalaPct, 177.778, 0.01) && perto(gp.centroX, 0) && perto(gp.crop.esquerda, 34.18, 0.01),
  'Premiere: cover de 16:9 = 177,8% com crop lateral, centralizado');
// Center do Basic Motion = deslocamento em frações da MÍDIA (como o Premiere
// exporta), não da sequência: b-roll 720x1280 na metade de baixo desce 480px
// = 480/1280 da fonte, não 480/1920 da sequência.
const broll720: ArquivoProjeto = { nome: 'broll_720.mp4', tipo: 'video', w: 720, h: 1280, durSec: 8, temAudio: false };
const gp720 = geometriaPremiere(br[2], broll720, W, H);
ok(perto(gp720.escalaPct, 150, 0.01) && perto(gp720.centroX, 0) && perto(gp720.centroY, 480 / 1280) && perto(gp720.crop.topo, 25, 0.01),
  'Premiere: center do split medido na mídia (720x1280 → vert 0,375), escala 150%');
const gpAv = geometriaPremiere(av[1], avatar, W, H);
// o Center é onde cai o centro da FONTE; o centro do recorte (rosto) tem que cair no meio da metade de cima
const centroRecorteY = gpAv.centroY * H + H / 2 + ((av[1].recorte.y0 + av[1].recorte.y1) / 2 - 0.5) * H * (gpAv.escalaPct / 100);
ok(perto(gpAv.escalaPct, 100, 0.01) && perto(centroRecorteY, 480, 0.5) && gpAv.crop.topo > 0,
  'Premiere: recorte do avatar (foco no rosto) centrado na metade de cima');
type ClipXml = { nome: string; dur: number; ini: number; fim: number; dentro: number; fora: number; corpo: string };
const clipsXml = (trecho: string): ClipXml[] => [...trecho.matchAll(/<clipitem id="[^"]+"><name>([^<]+)<\/name><enabled>TRUE<\/enabled><duration>(\d+)<\/duration>.*?<start>(\d+)<\/start><end>(\d+)<\/end><in>(\d+)<\/in><out>(\d+)<\/out>(.*?)<\/clipitem>/g)]
  .map((m) => ({ nome: m[1], dur: +m[2], ini: +m[3], fim: +m[4], dentro: +m[5], fora: +m[6], corpo: m[7] }));
const secaoVideo = xml.split('</video><audio><numOutputChannels>')[0];
const cv = clipsXml(secaoVideo);
ok(cv.length === tl.itens.length && cv.every((c) => c.fora - c.dentro === c.fim - c.ini),
  'Premiere: todo clipe com out − in = end − start (a regra do xmeml)');
const lento = cv.find((c) => c.nome === 'broll_01.mp4')!;
ok(lento.dur === 120 && lento.dentro === 0 && lento.fora === 120
  && /<parameterid>graphdict<\/parameterid>.*<when>0<\/when><value>0<\/value>.*<speedkfin>TRUE.*<when>120<\/when><value>90<\/value>.*<speedkfout>TRUE/.test(lento.corpo),
  'Premiere: 0,75x em quadros "retimed" (3s de mídia = 120 quadros) + graphdict como o Premiere grava');
const leg = cv.find((c) => c.nome === 'legenda_0001.png')!;
ok(leg.dentro === 30 * 3600 && leg.dur === 30 * 3600 * 12 && leg.corpo.startsWith('<alphatype>straight</alphatype>'),
  'Premiere: imagem parada com in em 1h e mídia de 12h (como o Premiere exporta) e alpha straight');
const trXml = cv.find((c) => c.nome === 'transicao_preto.png')!;
const whens = [...trXml.corpo.matchAll(/<when>(\d+)<\/when>/g)].map((m) => +m[1]);
ok(whens.length === 3 && whens[0] === trXml.dentro && whens[2] <= trXml.fora, 'Premiere: keyframes da transição no espaço in/out do clipe');
const zoomXml = cv.find((c) => c.nome === 'avatar.mp4')!;
const whensZoom = [...zoomXml.corpo.matchAll(/<when>(\d+)<\/when>/g)].map((m) => +m[1]);
ok(whensZoom[0] === zoomXml.dentro && whensZoom.at(-1)! <= zoomXml.fora, 'Premiere: keyframes do zoom dentro do in/out do avatar');

// FIM DO VÍDEO: a legenda que segura a última palavra e a headline "até o fim"
// passavam do avatar — no CapCut a timeline ficava mais comprida, com rabo preto.
const png = (nome: string): ArquivoProjeto => ({ nome, tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false });
const tlFim = montarTimeline('AD47G1VN', roteiro, {
  ...midia,
  legendas: [{ arquivo: png('legenda_0001.png'), start: 19.5, end: 20.7 }, { arquivo: png('legenda_0002.png'), start: 20.2, end: 21 }],
  headlines: [{ arquivo: png('headline_1.png'), start: 0, end: 25 }],
}, W, H);
const legFim = tlFim.itens.filter((i) => i.trilha === 'legenda');
ok(legFim.length === 1 && perto(legFim[0].end, 20) && perto(tlFim.itens.find((i) => i.trilha === 'headline')!.end, 20)
  && !tlFim.arquivos.some((a) => a.nome === 'legenda_0002.png') && tlFim.itens.every((i) => i.end <= 20 + 1e-9),
  'nada passa do fim do vídeo: legenda/headline cortadas no fim, item todo depois do fim sai (e o PNG dele também)');
const ccFim = JSON.parse(montarDraftCapCut(tlFim, { pasta: 'X', agoraUs: 1, novoId: ids }).conteudo);
ok(ccFim.duration === 20_000_000, 'CapCut: duração do projeto = duração do vídeo (sem rabo preto)');
ok(srtDaLegenda([{ id: 'z', start: 19500, end: 20700, words: [{ text: 'fim', start: 19500, end: 20700 }] }], 20000).includes('00:00:20,000'),
  'SRT: último bloco termina no fim do vídeo');

const leia = leiaMeDoProjeto(tl, { pasta: 'AD47G1VN - PILOT', temSrt: true });
ok(leia.includes('CAPCUT') && leia.includes('PREMIERE') && leia.includes('.srt'), 'LEIA-ME explica CapCut, Premiere e o SRT');

// ── FORMATOS 07.10: React sobe pra camada de cima; linha vira PNG; luz vermelha; avatar pelo rosto
{
  const vermelho: ArquivoProjeto = { nome: 'transicao_vermelho.png', tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false };
  const linhaVerde: ArquivoProjeto = { nome: 'linha_22e06b.png', tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false };
  const rf: RoteiroEdicao = {
    ...roteiro,
    inserts: [
      { ...base, id: 'r1', nome: 'DINHEIRO', midiaKey: 'k1', start: 2, end: 5, layout: { tipo: 'react', lado: 'direita' }, transicao: 'luz-vermelha',
        rosto: { x: 0.5, y: 0.3, h: 0.15 } },
      { ...base, id: 'l1', nome: 'CEREBRO', midiaKey: 'k2', start: 8, end: 11, layout: { tipo: 'linha', avatar: 'cima', cor: '#22e06b' }, transicao: 'escurecer',
        rosto: { x: 0.6, y: 0.5, h: 0.15 } },
      { ...base, id: 'm1', nome: 'NEURONIO', midiaKey: 'k3', start: 14, end: 16, layout: { tipo: 'mescla', avatar: 'cima' }, transicao: 'nenhuma' },
    ],
  };
  const mf: MidiaDoProjeto = {
    avatar,
    inserts: new Map([['r1', { arquivo: broll916 }], ['l1', { arquivo: broll916 }], ['m1', { arquivo: broll916 }]]),
    legendas: [], headlines: [], preto, branco, vermelho, linhas: new Map([['#22e06b', linhaVerde]]),
  };
  const t2 = montarTimeline('FORMATOS', rf, mf, W, H);
  const topo = t2.itens.filter((i) => i.trilha === 'topo');
  const avatarBase = t2.itens.filter((i) => i.trilha === 'avatar');
  const reactAv = topo.find((i) => i.arquivo === avatar.nome);
  ok(!!reactAv && perto(reactAv.start, 2) && perto(reactAv.end, 5) && reactAv.volume === 1 && reactAv.destino.x + reactAv.destino.w <= W && reactAv.destino.y + reactAv.destino.h <= H
    && reactAv.destino.x > W / 2, 'React: avatar sobe pra camada de CIMA do b-roll, no canto direito de baixo, com a fala');
  ok(!avatarBase.some((i) => i.start < 5 - 1e-6 && i.end > 2 + 1e-6), 'React: a camada de baixo não repete o avatar (sem fala dobrada)');
  const cobertura = [...avatarBase, ...topo.filter((i) => i.arquivo === avatar.nome)].sort((a, b) => a.start - b.start);
  ok(perto(cobertura[0].start, 0) && cobertura.every((it, k) => k === 0 || perto(it.start, cobertura[k - 1].end)) && perto(cobertura.at(-1)!.end, 20),
    'a fala do avatar continua inteira de 0 a 20s, sem buraco, somando as duas camadas');
  const linhaItem = topo.find((i) => i.arquivo === linhaVerde.nome);
  ok(!!linhaItem && perto(linhaItem.start, 8) && perto(linhaItem.end, 11), 'linha: o PNG da cor certa entra na camada de cima durante a divisão');
  const tr2 = t2.itens.filter((i) => i.trilha === 'transicao');
  ok(tr2.some((i) => i.arquivo === vermelho.nome && perto(i.start, 2 - 0.14)), 'luz vermelha: clarão vermelho nas bordas do b-roll');
  const avLinha = avatarBase.find((i) => perto(i.start, 8))!;
  const rostoNoCard = (0.5 * H - avLinha.recorte.y0 * H) / ((avLinha.recorte.y1 - avLinha.recorte.y0) * H);
  ok(perto(rostoNoCard, 0.42, 0.01), 'dividida no projeto: avatar enquadrado pelo ROSTO medido (igual ao render)');
  ok(t2.avisos.some((a) => /REACT/.test(a) && /Remover fundo/.test(a)) && t2.avisos.some((a) => /MESCLA/.test(a)),
    'avisos dizem o que o editor externo não faz sozinho (fundo do React, degradê da mescla)');
  ok(!t2.avisos.some((a) => /linha colorida/.test(a)), 'linha com PNG pronto não gera aviso');
  ok(t2.arquivos.some((a) => a.nome === vermelho.nome) && t2.arquivos.some((a) => a.nome === linhaVerde.nome), 'PNGs da luz vermelha e da linha vão pro pacote');
  const cc2 = JSON.parse(montarDraftCapCut(t2, { pasta: 'X', agoraUs: 1, novoId: ids }).conteudo);
  ok(cc2.tracks.map((t: { name: string }) => t.name).join(',') === 'AVATAR,B-ROLL,AVATAR REACT / LINHA,TRANSICAO',
    'CapCut: camada do React/linha entre o b-roll e a transição');
  const xml2 = montarXmlPremiere(t2);
  const audioAvatar = ((xml2.split('<audio><numOutputChannels>')[1] || '').split('<track>')[1] || '').split('</track>')[0];
  ok((audioAvatar.match(/<clipitem/g) || []).length === cobertura.length && cobertura.length === avatarBase.length + 1, 'Premiere: a fala do avatar soma as duas camadas (pedaços de baixo + o React)');
  ok(leiaMeDoProjeto(t2, { pasta: 'X', temSrt: false }).includes('AVATAR REACT / LINHA'), 'LEIA-ME explica a camada nova');
  // sem PNG da linha: aviso honesto
  const semPng = montarTimeline('FORMATOS', rf, { ...mf, linhas: undefined }, W, H);
  ok(semPng.avisos.some((a) => /linha colorida/.test(a) && a.includes('#22e06b')), 'linha sem PNG: aviso com a cor pra pôr à mão');
}


console.log('\nSONOPLASTIA E PISCAR NO PROJETO (08.10):');
{
  const sfxArq = (nome: string, dur: number): ArquivoProjeto => ({ nome, tipo: 'audio', w: 0, h: 0, durSec: dur, temAudio: true, taxa: 48000 });
  const olhoArq = (i: number): ArquivoProjeto => ({ nome: `transicao_piscar_${i}.png`, tipo: 'imagem', w: W, h: H, durSec: 0, temAudio: false });
  const rs: RoteiroEdicao = {
    versao: 1, filename: 'AD50.mp4', criadoEm: 0, durSec: 20, legenda: null, zoom: [], headlines: null,
    inserts: [{ ...base, id: 'p1', nome: 'OLHO', midiaKey: 'k1', start: 5, end: 8, transicao: 'piscar' }],
    sfx: [
      { chave: 'p1@entrada', sfx: 'mouse-click', t: 5, inicio: 3.953, deSec: 0, dur: 1.4, ganho: 0.35, fadeOutSec: 0.08, motivo: 'piscar' },
      { chave: 'gancho', sfx: 'boom', t: 4, inicio: 3.98, deSec: 0, dur: 4.5, ganho: 0.07, fadeOutSec: 2, motivo: 'gancho' },
      { chave: 'p1@saida', sfx: 'mouse-click', t: 8, inicio: 6.953, deSec: 0, dur: 1.4, ganho: 0.35, fadeOutSec: 0.08, motivo: 'piscar' },
      // o último som passa do fim do vídeo: tem que ser cortado (e o fade junto)
      { chave: 'x', sfx: 'camera-flash', t: 19.5, inicio: 19.195, deSec: 0, dur: 2.6, ganho: 0.12, fadeOutSec: 0.6, motivo: 'luz' },
    ],
    trilha: { trilhaId: 't', nome: 'Lo-Fi', ganho: 0.1, durTrilha: 8, pedacos: [
      { inicio: 0, deSec: 0, dur: 8, fadeIn: 0.04, fadeOut: 1.2 },
      { inicio: 6.8, deSec: 0, dur: 8, fadeIn: 1.2, fadeOut: 1.2 },
      { inicio: 13.6, deSec: 0, dur: 6.4, fadeIn: 1.2, fadeOut: 1.4 },
    ] },
  };
  const ms: MidiaDoProjeto = {
    avatar, inserts: new Map([['p1', { arquivo: broll169 }]]), legendas: [], headlines: [],
    olho: [-0.1, -0.05, 0, 0.05, 0.1].map((d, i) => ({ arquivo: olhoArq(i), de: d - 1 / 60, ate: d + 1 / 60 })),
    sfx: new Map([['mouse-click', sfxArq('SFX - Click do Mouse.wav', 3.06)], ['boom', sfxArq('SFX - Boom.wav', 5)], ['camera-flash', sfxArq('SFX - Camera Flash.wav', 6.48)]]),
    trilha: sfxArq('TRILHA - Lo-Fi.mp3', 8),
  };
  const ts = montarTimeline('AD50', rs, ms, W, H);
  const olhos = ts.itens.filter((i) => i.trilha === 'transicao');
  ok(olhos.length === 10 && olhos.some((i) => Math.abs(i.start - (5 - 0.1 - 1 / 60)) < 1e-6) && olhos.some((i) => Math.abs(i.start - (8 - 1 / 60)) < 1e-6),
    'piscar vira as pálpebras quadro a quadro nas DUAS bordas, no mesmo lugar do render');
  const sfxIt = ts.itens.filter((i) => i.trilha === 'sfx');
  ok(sfxIt.length === 4 && sfxIt.every((i) => i.end <= 20 + 1e-9), 'SFX no projeto, nenhum passando do fim do vídeo');
  const flash = sfxIt.find((i) => i.arquivo.includes('Flash'))!;
  ok(Math.abs(flash.end - 20) < 1e-6 && (flash.fadeOut ?? 0) <= (flash.end - flash.start) / 2 + 1e-9, 'som cortado no fim leva o fade junto, encurtado');
  ok(ts.itens.filter((i) => i.trilha === 'musica').length === 3, 'trilha repetida = 3 pedaços (com crossfade)');
  const raias = raiasDeAudio(sfxIt);
  ok(raias.length === 2 && raias.every((r) => r.every((x, k) => k === 0 || r[k - 1].end <= x.start + 1e-9)), 'SFX em raias: nada se sobrepõe na mesma faixa (boom longo vai pra outra)');

  const cc = montarDraftCapCut(ts, { pasta: 'AD50 - PILOT', agoraUs: 1, novoId: (() => { let n = 0; return () => `id${++n}`; })() });
  const conteudo = JSON.parse(cc.conteudo);
  const faixas = conteudo.tracks.filter((t: { type: string }) => t.type === 'audio');
  ok(faixas.map((t: { name: string }) => t.name).join(',') === 'SFX,SFX 2,TRILHA,TRILHA 2', `faixas de áudio no CapCut: ${faixas.map((t: { name: string }) => t.name).join(',')}`);
  const semSobrepor = faixas.every((t: { segments: Array<{ target_timerange: { start: number; duration: number } }> }) =>
    t.segments.every((sg, k) => k === 0 || t.segments[k - 1].target_timerange.start + t.segments[k - 1].target_timerange.duration <= sg.target_timerange.start));
  ok(semSobrepor, 'nenhum segmento de áudio se sobrepõe na mesma faixa do CapCut');
  const audios = conteudo.materials.audios as Array<{ type: string; path: string; name: string }>;
  ok(audios.length === 4 && audios.every((a) => a.type === 'extract_music' && a.path.includes('##_draftpath_placeholder')), 'material de áudio no formato do CapCut, com o caminho portátil da pasta do rascunho');
  const fades = conteudo.materials.audio_fades as Array<{ fade_in_duration: number; fade_out_duration: number }>;
  ok(fades.length > 0 && fades.every((f) => f.fade_out_duration >= 0), 'fades de áudio viram audio_fade do CapCut');
  const clique = faixas[0].segments.find((sg: { volume: number }) => Math.abs(sg.volume - 0.35) < 1e-9);
  ok(clique && clique.target_timerange.start === 3953000 && clique.source_timerange.start === 0, 'clique do mouse no instante exato do plano (µs)');
  const meta = JSON.parse(cc.meta);
  const importados = meta.draft_materials[0].value as Array<{ metetype: string; extra_info: string; file_Path: string }>;
  ok(importados.some((x) => x.metetype === 'music' && x.extra_info.startsWith('SFX - ')), 'SFX e trilha entram no painel de mídia como áudio');
  ok(importados.every((x) => x.file_Path.startsWith('##_draftpath_placeholder')),
    'painel de mídia com caminho PORTÁTIL (abre em qualquer máquina sem "Vincular mídia" — testado no CapCut 9.5)');
  const comExtras = montarTimeline('AD50', rs, { ...ms, extrasDoPainel: [sfxArq('SFX - Plim 1.wav', 4.6)] }, W, H);
  ok(comExtras.arquivos.some((a) => a.nome === 'SFX - Plim 1.wav') && !comExtras.itens.some((i) => i.arquivo === 'SFX - Plim 1.wav'),
    'SFX não usado vai pro painel (pra trocar de som no editor), sem entrar na timeline');

  const xml = montarXmlPremiere(ts, { pastaMidia: 'C:/AUTOEDIT/AD50 - PILOT/MIDIA' });
  const faixasXml = xml.split('<audio><numOutputChannels>')[1] || '';
  ok((faixasXml.match(/SFX - Click do Mouse\.wav<\/name>/g) || []).length >= 2 && faixasXml.includes('TRILHA - Lo-Fi.mp3'), 'Premiere: SFX e trilha nas faixas de áudio');
  ok(/<file id="file-\d+"><name>SFX - Boom\.wav<\/name>[^]*?<media><audio>/.test(xml), 'arquivo de SFX no XML é só áudio (sem <video>, o Premiere não procura imagem nele)');
  ok(/<parameterid>level<\/parameterid>[^]*?<keyframe><when>\d+<\/when><value>0<\/value><\/keyframe>/.test(xml), 'fades viram keyframes de nível no Premiere');
}
console.log(`\n${passed} passaram, ${failed} falharam.`);
if (failed > 0) process.exit(1);
