import { normalizeStockFrameAccount, normalizeStockFramePage, normalizeStockFrameVideo, type StockFrameVideo } from './stockframe';
import { chooseSmartStockAssignments, planSmartStockSegments, rankStockFrameVideos } from './stockframe-smart';

let passed = 0;
let failed = 0;
function ok(condition: unknown, message: string) {
  if (condition) { passed++; console.log(`  ok   ${message}`); }
  else { failed++; console.error(`  FAIL ${message}`); }
}

console.log('STOCKFRAME — contrato tolerante + Smart Stocks sem custo:');

const normalized = normalizeStockFrameVideo({
  uuid: 'dor-joelho-1', nome: 'Idosa com dor no joelho', descricao: 'Desconforto ao caminhar e subir escadas.',
  keywords: 'joelho, dor, idosa, caminhada', preview_url: '/media/preview.mp4', thumbnail_url: '/media/poster.jpg',
  duration_seconds: '8.4', video_width: 576, video_height: 1024, origin: 'Orgânico', downloads_count: 14,
  niche: { id: 'dores', name: 'Dores Articulares' }, subpasta: { id: 'andar', name: 'Dificuldade em andar' },
});
ok(normalized?.id === 'dor-joelho-1', 'aceita uuid/nome/descricao do payload em português');
ok(normalized?.aspectRatio === '9:16', 'infere vertical a partir da resolução real');
ok(normalized?.origin === 'organic', 'normaliza origem orgânica sem perder acento');
ok(normalized?.previewUrl === 'https://biblioteca.stockframe.space/media/preview.mp4', 'URL relativa vira HTTPS da origem oficial');
ok(normalized?.nicheId === 'dores' && normalized.subcategoryId === 'andar', 'preserva nicho e subpasta');
ok(normalizeStockFrameVideo({ title: 'sem id' }) === null, 'take sem id nunca vira download ambíguo');
ok(normalizeStockFrameVideo({ id: 'x', preview_url: 'javascript:alert(1)' })?.previewUrl === undefined, 'URL insegura não entra no player');
const signedMedia = normalizeStockFrameVideo({
  id: 'signed-media', title: 'Take com mídia assinada',
  preview_signed_url: 'https://cdn.example.com/preview.webm?token=preview',
  thumbnail: { signed_url: 'https://cdn.example.com/thumb.jpg?token=thumb' },
});
ok(signedMedia?.previewUrl?.includes('preview.webm') && signedMedia.posterUrl?.includes('thumb.jpg'), 'aceita URLs assinadas e mídia aninhada do catálogo');

const page = normalizeStockFramePage({ data: { videos: [normalized?.raw], pagination: { current_page: 2, per_page: 1, total: 8, last_page: 8 } } });
ok(page.videos.length === 1 && page.page === 2 && page.totalPages === 8, 'normaliza wrapper data + pagination');
ok(page.niches[0]?.name === 'Dores Articulares', 'infere lista de nichos quando a API retorna apenas vídeos');
ok(normalizeStockFramePage([{ id: 'bare', title: 'Take' }]).videos[0]?.id === 'bare', 'aceita um catálogo retornado como array raiz');
const outerMeta = normalizeStockFramePage({ data: { videos: [{ id: 'outer', title: 'Take' }] }, total: 300, page: 2, per_page: 24, niches: [{ id: 'health', name: 'Saúde' }] });
ok(outerMeta.total === 300 && outerMeta.page === 2 && outerMeta.totalPages === 13 && outerMeta.niches[0]?.id === 'health', 'preserva paginação e nichos externos ao wrapper data');

const account = normalizeStockFrameAccount({ data: { username: 'Silas', email: 'silas@example.com', downloads_today: 3, daily_limit: 130, plan: 'PACK' } });
ok(account.downloadsToday === 3 && account.downloadsLimit === 130, 'conta preserva a cota paga da API');
ok(account.plan === 'PACK', 'plano da conta é exibível sem conceder acesso local');
const quotaAccount = normalizeStockFrameAccount({ user_id: 'user-1', quota: { used: 1, limit: 130, remaining: 129 } });
ok(quotaAccount.downloadsToday === 1 && quotaAccount.downloadsLimit === 130, 'normaliza o objeto quota real devolvido por /me');

const parts = [{ label: 'BODY 1', text: 'A dor no joelho piora ao subir escadas. A cartilagem inflamada dificulta caminhar todos os dias. Depois do tratamento, a idosa volta a se movimentar com confiança.' }];
const p30 = planSmartStockSegments(parts, { coverage: 30, pace: 'fast' });
const p60 = planSmartStockSegments(parts, { coverage: 60, pace: 'fast' });
const p100 = planSmartStockSegments(parts, { coverage: 100, pace: 'fast' });
ok(p30.length > 0 && p30.length <= p60.length && p60.length <= p100.length, 'coberturas 30/60/100 aumentam sem inverter intensidade');
ok(p100[0].wordFrom === 0 && p100.at(-1)?.wordTo === parts[0].text.match(/\S+/g)!.length - 1, '100% cobre a copy inteira sem buracos nas pontas');
ok(p100.every((segment, index) => index === 0 || segment.wordFrom === p100[index - 1].wordTo + 1), 'segmentos full b-roll são contíguos');
const shortParts = [{ label: 'BODY 1', text: 'Agora não sinto mais dor no joelho e consigo subir escadas com alegria.' }];
for (const pace of ['fast', 'long', 'adaptive'] as const) {
  for (const coverage of [30, 60] as const) {
    const limited = planSmartStockSegments(shortParts, { coverage, pace });
    const covered = limited.reduce((sum, segment) => sum + segment.wordTo - segment.wordFrom + 1, 0);
    const total = shortParts[0].text.match(/\S+/g)!.length;
    ok(covered === Math.round(total * coverage / 100), `${pace} ${coverage}% respeita o orçamento de palavras mesmo numa copy curta`);
    ok(limited.every((segment) => segment.text === shortParts[0].text.match(/\S+/g)!.slice(segment.wordFrom, segment.wordTo + 1).join(' ')), `${pace} ${coverage}% mantém texto e índices do trecho alinhados`);
  }
}

const video = (patch: Partial<StockFrameVideo> & Pick<StockFrameVideo, 'id' | 'title'>): StockFrameVideo => {
  const { id, title, ...rest } = patch;
  return {
    id, title, description: '', tags: [], durationSec: 8, width: 576, height: 1024,
    aspectRatio: '9:16', hasAudio: false, origin: 'organic', downloads: 0, favorite: false, recent: false, ...rest,
  };
};
const catalog: StockFrameVideo[] = [
  video({ id: 'knee', title: 'Idosa com dor no joelho subindo escada', description: 'Dificuldade para andar por inflamação articular', tags: ['joelho', 'dor', 'escada'], downloads: 90 }),
  video({ id: 'money', title: 'Homem contando dinheiro no celular', tags: ['dinheiro', 'aplicativo', 'pagamento'], downloads: 400 }),
  video({ id: 'smile', title: 'Idosa caminhando feliz no parque', tags: ['idosa', 'caminhar', 'alívio'], downloads: 30 }),
];
const painSegment = p100[0];
const ranking = rankStockFrameVideos(painSegment, catalog);
ok(ranking[0]?.video.id === 'knee', 'contexto de joelho vence um take popular por significado, não por downloads');
ok(!ranking.some((candidate) => candidate.video.id === 'money'), 'take lexicalmente/contextualmente irrelevante fica abaixo do limiar');
const recovering = planSmartStockSegments(shortParts, { coverage: 100, pace: 'long' })[0];
const recoveryCatalog = [
  video({ id: 'pain-action', title: 'Pessoa com dor no joelho subindo escadas', tags: ['dor', 'joelho', 'sofrimento', 'desconforto'] }),
  video({ id: 'healthy-action', title: 'Pessoa feliz e saudável caminhando no parque', tags: ['alegria', 'alívio', 'feliz'] }),
];
const recoveryRanking = rankStockFrameVideos(recovering, recoveryCatalog);
ok(recoveryRanking[0]?.video.id === 'healthy-action' && !recoveryRanking.some((item) => item.video.id === 'pain-action'), 'não sinto mais dor escolhe recuperação e rejeita a ação dolorosa');
ok(!recovering.query.includes('dificuldade para andar') && !recovering.query.includes('dor no joelho'), 'busca de recuperação não injeta a ação oposta por sinônimo do nicho');
const unresolved = planSmartStockSegments([{ label: 'BODY 1', text: 'A dor continua no joelho e ainda sinto desconforto para subir escadas.' }], { coverage: 100, pace: 'long' })[0];
const unresolvedRanking = rankStockFrameVideos(unresolved, recoveryCatalog);
ok(unresolvedRanking[0]?.video.id === 'pain-action' && !unresolvedRanking.some((item) => item.video.id === 'healthy-action'), 'dor continua preserva o contexto negativo e rejeita recuperação');
const splitRecovery = planSmartStockSegments([{ label: 'BODY 1', text: 'Depois de todo esse tempo finalmente posso contar para você que não sinto mais dor no joelho e consigo caminhar feliz todos os dias.' }], { coverage: 100, pace: 'fast' });
ok(splitRecovery.every((segment) => segment.narrativeDirection === 'recovery'), 'negação sobrevive quando uma frase de recuperação é dividida em cortes rápidos');
const shoulder = planSmartStockSegments([{ label: 'BODY 1', text: 'A dor no ombro dificulta levantar o braço e continua piorando.' }], { coverage: 100, pace: 'long' })[0];
ok(!shoulder.query.includes('joelho'), 'grupo de articulações não injeta joelho quando a copy fala de ombro');
const shoulderRanking = rankStockFrameVideos(shoulder, [
  video({ id: 'shoulder', title: 'Pessoa com dor no ombro', tags: ['dor', 'ombro'] }),
  video({ id: 'knee-wrong', title: 'Pessoa com dor no joelho', tags: ['dor', 'joelho'], downloads: 10000 }),
]);
ok(shoulderRanking[0]?.video.id === 'shoulder' && !shoulderRanking.some((candidate) => candidate.video.id === 'knee-wrong'), 'dor em articulação não admite outra parte do corpo como equivalente');
const prostateFixtureParts = [{ label: 'HOOK 1', text: 'Como transformar um azeite de R$10 no seu próprio remédio de próstata em poucos minutos na sua cozinha.' }];
const prostateFixtureSegments = planSmartStockSegments(prostateFixtureParts, { coverage: 100, pace: 'fast' });
const prostateFixtureSegment = prostateFixtureSegments.find((segment) => segment.text.includes('próstata'))!;
const kneeFixture = normalizeStockFrameVideo({
  id: 'dev-joelho-05', code: 'DOR-JO05', title: 'HOMEM MAIS VELHO COM DOR NO JOELHO',
  description: 'Homem demonstra desconforto no joelho ao levantar, com foco na articulação.',
  tags: ['dor', 'joelho', 'idoso', 'articulacao', 'desconforto'],
  duration: 8, width: 1080, height: 1920, origin: 'organic', downloads: 88,
  niche_id: 'dores', niche_name: 'Dores Articulares', subcategory_id: 'joelho', subcategory_name: 'Joelho',
})!;
const prostateFixture = normalizeStockFrameVideo({
  id: 'dev-prostata-02', code: 'SAU-PR02', title: 'MÉDICO EXPLICANDO SAÚDE DA PRÓSTATA',
  description: 'Especialista explica como hábitos e compostos naturais afetam a próstata.',
  tags: ['medico', 'prostata', 'saude masculina', 'explicacao', 'doutor'],
  duration: 9, width: 1080, height: 1920, origin: 'organic', downloads: 74,
  niche_id: 'saude', niche_name: 'Saúde', subcategory_id: 'prostata', subcategory_name: 'Próstata',
})!;
const prostateRanking = rankStockFrameVideos(prostateFixtureSegment, [kneeFixture, prostateFixture]);
ok(prostateRanking[0]?.video.id === 'dev-prostata-02' && !prostateRanking.some((candidate) => candidate.video.id === 'dev-joelho-05'), 'fixture real: remédio de próstata nunca recebe homem com dor no joelho');
const mislabeledKnee = { ...kneeFixture, nicheName: 'Próstata', subcategoryName: 'Saúde masculina', tags: ['prostata', 'remedio', 'cozinha', 'homem'], description: 'Homem com desconforto na articulação, conteúdo de saúde da próstata.' };
ok(!rankStockFrameVideos(prostateFixtureSegment, [mislabeledKnee]).length, 'título de joelho prevalece sobre tags e nicho de próstata incompatíveis');
ok(prostateFixtureSegments.every((segment) => !rankStockFrameVideos(segment, [kneeFixture]).length), 'sujeito anatômico da frase atravessa cortes e impede joelho em todo o hook sobre próstata');

const pregnancy = planSmartStockSegments([{ label: 'HOOK', text: 'A gestante acompanha o bebê no ultrassom durante a gravidez.' }], { coverage: 100, pace: 'long' })[0];
const genderRanking = rankStockFrameVideos(pregnancy, [
  video({ id: 'pregnant', title: 'Mulher grávida em ultrassom', tags: ['gestante', 'bebê', 'gravidez'] }),
  video({ id: 'prostate', title: 'Homem em consulta de próstata', tags: ['homem', 'masculino', 'próstata'] }),
]);
ok(genderRanking[0]?.video.id === 'pregnant' && !genderRanking.some((candidate) => candidate.video.id === 'prostate'), 'incompatibilidade gravidez × saúde masculina bloqueia falso positivo');

const assigned = chooseSmartStockAssignments([
  { ...painSegment, candidates: rankStockFrameVideos(painSegment, catalog) },
  { ...p100[Math.min(1, p100.length - 1)], id: 'next', candidates: rankStockFrameVideos(painSegment, catalog) },
]);
ok(assigned[0].selectedVideoId !== assigned[1].selectedVideoId, 'plano penaliza repetição do mesmo take em trechos seguidos');
const exactCompound = video({ id: 'oleocantal', title: 'Composto oleocantal' });
const oliveOil = video({ id: 'olive-oil', title: 'Pessoa usando azeite na cozinha' });
const globalPlan = chooseSmartStockAssignments([
  { ...painSegment, id: 'generic', text: 'A maioria das pessoas usa azeite do jeito errado.', candidates: [
    { video: exactCompound, score: 12, reasons: ['contexto de azeite'] },
    { video: oliveOil, score: 11, reasons: ['ação de usar azeite'] },
  ] },
  { ...painSegment, id: 'specific', text: 'Esse composto se chama oleocantal.', candidates: [
    { video: exactCompound, score: 35, reasons: ['composto específico'] },
  ] },
]);
ok(globalPlan[0].selectedVideoId === 'olive-oil' && globalPlan[1].selectedVideoId === 'oleocantal', 'atribuição global reserva o take exato para o trecho específico e dá alternativa ao genérico');
ok(globalPlan[0].candidates[0].score === 12 && globalPlan[1].candidates[0].score === 35, 'atribuição não altera os scores de evidência');
const scarcePlan = chooseSmartStockAssignments([
  { ...painSegment, id: 'weak-first', candidates: [{ video: exactCompound, score: 7, reasons: [] }] },
  { ...painSegment, id: 'strong-later', candidates: [{ video: exactCompound, score: 35, reasons: [] }] },
]);
ok(!scarcePlan[0].selectedVideoId && scarcePlan[1].selectedVideoId === 'oleocantal', 'sem alternativa, correspondência forte posterior tem prioridade sobre fraca anterior');
const reusedPlan = chooseSmartStockAssignments([
  { ...painSegment, id: 'reuse-first', candidates: [{ video: exactCompound, score: 35, reasons: [] }] },
  { ...painSegment, id: 'unrelated', candidates: [] },
  { ...painSegment, id: 'reuse-later', candidates: [{ video: exactCompound, score: 30, reasons: [] }] },
]);
ok(reusedPlan[0].selectedVideoId === 'oleocantal' && reusedPlan[2].selectedVideoId === 'oleocantal'
  && reusedPlan[2].candidates[0].reasons.includes('take reutilizado em trecho distante'), 'reuso distante confiável é permitido e explicado');
ok(!reusedPlan[1].selectedVideoId, 'atribuição global e reuso mantêm vazio o trecho sem correspondência');

console.log(`\n${passed} passaram, ${failed} falharam.`);
if (failed > 0) process.exit(1);
