import { mergeStockFrameMediaUrls, mergeStockFrameNiches, normalizeStockFrameAccount, normalizeStockFramePage, normalizeStockFrameSmartResults, normalizeStockFrameVideo, type StockFrameVideo } from './stockframe';
import { balanceMechanismPresence, chooseCampaignRecipeTheme, chooseSmartStockAssignments, inferStockFrameNiche, localizeSmartSegments, measureSmartStockCoverage, planSmartStockSegments, rankStockFrameGenericFallback, rankStockFrameVideos, smartStockMechanismQueries } from './stockframe-smart';

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
const quotaAccount = normalizeStockFrameAccount({
  user_id: 'user-1', quota: { used: 1, limit: 130, remaining: 129 },
  niches: [{ niche_id: 'ed', name: 'ED', videos_count: 286, subfolders: [{ subfolder_id: 'depoimentos', name: 'Depoimentos', videos_count: 41 }] }],
});
ok(quotaAccount.downloadsToday === 1 && quotaAccount.downloadsLimit === 130, 'normaliza o objeto quota real devolvido por /me');
ok(quotaAccount.downloadsRemaining === 129, 'preserva saldo oficial da cota diária');
ok(quotaAccount.niches[0]?.id === 'ed' && quotaAccount.niches[0]?.subcategories?.[0]?.name === 'Depoimentos', 'preserva nichos e pastas devolvidos por /me');
const mergedNiches = mergeStockFrameNiches(quotaAccount.niches, [{ id: 'ed', name: 'ED', count: 12, subcategories: [{ id: 'rotina', name: 'Rotina', count: 4 }] }]);
ok(mergedNiches[0]?.count === 286 && mergedNiches[0]?.subcategories?.length === 2, 'mescla a taxonomia completa da conta sem perder pastas descobertas no catálogo');

const parts = [{ label: 'BODY 1', text: 'A dor no joelho piora ao subir escadas. A cartilagem inflamada dificulta caminhar todos os dias. Depois do tratamento, a idosa volta a se movimentar com confiança.' }];
const p30 = planSmartStockSegments(parts, { coverage: 30, pace: 'fast' });
const p60 = planSmartStockSegments(parts, { coverage: 60, pace: 'fast' });
const p100 = planSmartStockSegments(parts, { coverage: 100, pace: 'fast' });
ok(p30.length > 0 && p30.length <= p60.length && p60.length <= p100.length, 'coberturas 30/60/100 aumentam sem inverter intensidade');
ok(p100[0].wordFrom === 0 && p100.at(-1)?.wordTo === parts[0].text.match(/\S+/g)!.length - 1, '100% cobre a copy inteira sem buracos nas pontas');
ok(p100.every((segment, index) => index === 0 || segment.wordFrom === p100[index - 1].wordTo + 1), 'segmentos full b-roll são contíguos');
const selected100 = p100.map((segment, index) => ({ ...segment, selectedVideoId: `video-${index}` }));
ok(measureSmartStockCoverage(parts, selected100).complete && measureSmartStockCoverage(parts, selected100).percent === 100,
  '100% selecionado mede a copy toda, sem lacunas');
ok(!measureSmartStockCoverage(parts, selected100.map((segment, index) => index === 0 ? { ...segment, wordFrom: 1 } : segment)).complete,
  'editar a primeira palavra não pode continuar certificando 100%');
ok(!measureSmartStockCoverage(parts, selected100.map((segment, index) => index === 1 ? { ...segment, wordFrom: segment.wordFrom - 1 } : segment)).complete,
  'sobreposição editada não pode certificar 100%');
ok(measureSmartStockCoverage(parts, p30.map((segment, index) => ({ ...segment, selectedVideoId: `video-${index}` }))).coveredWords === Math.round(parts[0].text.match(/\S+/g)!.length * .3),
  '30% mede somente as palavras efetivamente cobertas');
ok(measureSmartStockCoverage(parts, p60.map((segment, index) => ({ ...segment, selectedVideoId: index ? undefined : `video-${index}` }))).percent < 60,
  'take sem escolha reduz a cobertura real apresentada');
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
    aspectRatio: '9:16', hasAudio: false, origin: 'organic', downloads: 0, favorite: false, recent: false,
    downloadCost: 1, available: true, conflictingConcepts: [], matchedConcepts: [], ...rest,
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

const edNiches = [{ id: 'ed', name: 'ED' }, { id: 'dores', name: 'Dores Articulares' }];
const edCopy = [{ label: 'BODY 1', text: 'Eu tinha problemas com ereção. Descobri um truque de bicarbonato com mel e limão. Agora me sinto confiante.' }];
ok(inferStockFrameNiche(edCopy, edNiches)?.id === 'ed', 'copy de ereção escolhe o pack ED mesmo sem filtro manual');
const edSegments = planSmartStockSegments(edCopy, { coverage: 100, pace: 'fast' }).map((segment) => ({ ...segment, campaignText: edCopy[0].text, campaignNicheId: 'ed' }));
const recipeSegment = edSegments.find((segment) => segment.text.toLowerCase().includes('bicarbonato'))!;
const recipes = [
  video({ id: 'bicarb-mel', title: 'Bicarbonato com mel', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas' }),
  video({ id: 'mel', title: 'Close de mel', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas' }),
  video({ id: 'limao', title: 'Cortando limão', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas' }),
  video({ id: 'bicarb-vick', title: 'Bicarbonato com Vick', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas', finalScore: 0.99 }),
  video({ id: 'bicarb-babosa', title: 'Bicarbonato com babosa', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas', finalScore: 0.99 }),
  video({ id: 'banana-mel-limao', title: 'RECEITA DE BANANA COM MEL E LIMAO', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas' }),
  video({ id: 'cebola-laranja-mel', title: 'CEBOLA COM LARANJA MEL E LIMAO', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas' }),
  video({ id: 'limao-vaselina', title: 'JOGANDO LIMAO NA VASELINA', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas' }),
  video({ id: 'limao-abobora', title: 'JOGANDO LIMAO NA SEMENTE DE ABOBORA', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Receitas' }),
  video({ id: 'dores-recipe', title: 'Bicarbonato com mel', nicheId: 'dores', nicheName: 'Dores Articulares', finalScore: 0.99 }),
];
const recipeRanking = rankStockFrameVideos(recipeSegment, recipes, 20, true);
ok(['bicarb-mel', 'mel', 'limao'].every((id) => recipeRanking.some((candidate) => candidate.video.id === id)), 'combinação da copy admite qualquer subconjunto de ingredientes');
ok(!recipeRanking.some((candidate) => ['bicarb-vick', 'bicarb-babosa', 'banana-mel-limao', 'cebola-laranja-mel', 'limao-vaselina', 'limao-abobora', 'dores-recipe'].includes(candidate.video.id)), 'combinação da copy rejeita ingredientes extras reais do catálogo e nicho estranho mesmo com score remoto alto');
const edNonRecipe = video({ id: 'ed-casal', title: 'Casal mais velho conversando com intimidade', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Relacionamento', smartMetadata: { summary: 'Casal conversa com intimidade', concepts: ['ereção', 'confiança'], subjects: ['casal'], actions: ['conversar'], objects: [], bodyParts: [], positiveKeywords: ['saúde masculina'], negativeKeywords: [], containsText: false, containsWatermark: false, graphicContent: false } });
const edCoverage = edSegments.map((segment) => ({ ...segment, candidates: rankStockFrameVideos(segment, [edNonRecipe, ...recipes], 20, true) }));
ok(edCoverage.some((segment) => segment.candidates.some((candidate) => candidate.video.id === 'ed-casal')), 'Smart Stocks considera cenas humanas do pack ED além de receitas');

const herbalCopy = 'Este truque caseiro usa ervas e plantas para a saúde masculina.';
const herbalSegment = { ...planSmartStockSegments([{ label: 'BODY 1', text: herbalCopy }], { coverage: 100, pace: 'long' })[0], campaignText: herbalCopy, campaignNicheId: 'ed' };
const herbalVideo = video({ id: 'hortela', title: 'Preparando folhas de hortelã', nicheId: 'ed', nicheName: 'ED' });
const unrelatedFormula = video({ id: 'vick', title: 'Mistura de Vick e bicarbonato', nicheId: 'ed', nicheName: 'ED', finalScore: .99 });
ok(rankStockFrameVideos(herbalSegment, [herbalVideo, unrelatedFormula], 10, true).some((candidate) => candidate.video.id === 'hortela'), 'mecanismo genérico de ervas admite cena botânica');
ok(!rankStockFrameVideos(herbalSegment, [herbalVideo, unrelatedFormula], 10, true).some((candidate) => candidate.video.id === 'vick'), 'mecanismo de ervas não vira receita química diferente');
const genericCopy = 'Existe um truque caseiro que pode ajudar homens com ereção.';
const genericSegment = { ...herbalSegment, campaignText: genericCopy, candidates: [
  { video: recipes[0], score: 34, reasons: [] }, { video: recipes[3], score: 20, reasons: [] },
] };
const chosenTheme = chooseCampaignRecipeTheme([genericSegment]);
ok(chosenTheme.includes('bicarbonato') && chosenTheme.includes('mel'), 'copy de truque genérico escolhe uma fórmula visual coerente');
ok(!rankStockFrameVideos({ ...genericSegment, campaignIngredients: chosenTheme }, [recipes[3]], 10, true).length, 'fórmula escolhida permanece consistente em todo o anúncio');

const remote = normalizeStockFrameSmartResults({ results: [{ query_id: 'seg-1', videos: [{ id: 'ed-remote', name: 'Casal', thumbnail_url: 'https://cdn.example/thumb.jpg', preview_url: 'https://cdn.example/preview.webm', final_score: .9, recommended_start_sec: 1.2, recommended_end_sec: 6.8 }] }] });
ok(remote.get('seg-1')?.[0]?.finalScore === .9 && remote.get('seg-1')?.[0]?.recommendedStartSec === 1.2, 'Smart Search em lote preserva score e melhor trecho do take');
const renewed = mergeStockFrameMediaUrls([remote.get('seg-1')![0]], { videos: [{ id: 'ed-remote', thumbnail_url: 'https://cdn.example/new-thumb.jpg', preview_url: 'https://cdn.example/new-preview.webm' }] });
ok(renewed[0].posterUrl?.includes('new-thumb') && renewed[0].previewUrl?.includes('new-preview'), 'renovação em lote atualiza thumbnail e preview sem baixar original');
const oneSafeTake = chooseSmartStockAssignments([
  { ...herbalSegment, candidates: [{ video: herbalVideo, score: 12, reasons: [] }] },
  { ...herbalSegment, id: 'herbal-next', candidates: [{ video: herbalVideo, score: 10, reasons: [] }] },
], true);
ok(oneSafeTake.every((segment) => segment.selectedVideoId === 'hortela'), 'modo 100% cobre dois trechos com único take seguro quando não há alternativa');
const reliefCopy = [{ label: 'BODY 1', text: 'Antes eu sofria com o problema de ereção. Agora sinto alívio e voltei a ter confiança com minha parceira.' }];
const reliefSegment = planSmartStockSegments(reliefCopy, { coverage: 100, pace: 'fast' }).at(-1)!;
const reliefRanked = rankStockFrameVideos({ ...reliefSegment, campaignNicheId: 'ed' }, [
  video({ id: 'alivio-casal', title: 'Casal sorrindo e feliz com alívio', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Relacionamento' }),
  video({ id: 'sofrendo', title: 'Homem frustrado e sofrendo com impotência', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Problema' }),
], 10, true);
ok(reliefRanked[0]?.video.id === 'alivio-casal' && !reliefRanked.some((candidate) => candidate.video.id === 'sofrendo'), 'gatilho de alívio seleciona reação positiva, não sofrimento em sentido oposto');
const recipeVariants = ['r1', 'r2', 'r3'].map((id) => video({ id, title: 'Preparando receita', nicheId: 'ed', subcategoryName: 'Receitas' }));
const humanAlternative = video({ id: 'human', title: 'Casal conversando', nicheId: 'ed', subcategoryName: 'Relacionamento' });
const varied = chooseSmartStockAssignments([0, 1, 2].map((index) => ({ ...herbalSegment, id: `varied-${index}`, candidates: [
  { video: recipeVariants[index], score: 20, reasons: [] },
  ...(index === 2 ? [{ video: humanAlternative, score: 17, reasons: [] }] : []),
] })));
ok(varied[2].selectedVideoId === 'human', 'plano quebra três takes seguidos da mesma pasta com alternativa contextual próxima');
const exampleNiches = [
  { id: 'memory', name: 'Memória' }, { id: 'prostate', name: 'Próstata' }, { id: 'vision', name: 'Visão' },
  { id: 'diabetes', name: 'Diabetes Tipo 2' }, { id: 'menopause', name: 'Menopausa' }, { id: 'lipedema', name: 'Lipedema' },
  { id: 'cellulite', name: 'Celulite' }, { id: 'skin', name: 'Skin Care' }, { id: 'weight', name: 'Emagrecimento' },
  ...edNiches,
];
for (const [copy, id] of [
  ['How to improve memory with Alzheimer symptoms', 'memory'],
  ['Prostate health and frequent urination', 'prostate'],
  ['Mi vista empeoró y mis ojos cansados', 'vision'],
  ['Zaburzenia erekcji i moja partnerka', 'ed'],
  ['Cukrzyca typu 2 i poziom glukozy', 'diabetes'],
  ['Menopause symptoms and hot flashes', 'menopause'],
  ['Lipoedema affects my legs', 'lipedema'],
  ['Cellulite visible on the thighs', 'cellulite'],
  ['Skincare for sensitive skin', 'skin'],
  ['How to lose weight without starving', 'weight'],
] as [string, string][]) {
  ok(inferStockFrameNiche([{ label: 'BODY', text: copy }], exampleNiches)?.id === id, `nicho ${id} reconhecido em copy multilíngue`);
}
const spanishRecipe = { ...recipeSegment, campaignText: 'Bicarbonato con miel y limón para este truco.' };
ok(!rankStockFrameVideos(spanishRecipe, [recipes[3]], 10, true).length && rankStockFrameVideos(spanishRecipe, [recipes[0]], 10, true).length > 0, 'combinação de ingredientes em espanhol conserva o mesmo bloqueio de extras');
const mechanismSegments = [
  { ...painSegment, id: 'mechanism-before', visualBeat: 'context' as const },
  { ...painSegment, id: 'mechanism-core', visualBeat: 'demonstration' as const },
  { ...painSegment, id: 'mechanism-after', visualBeat: 'context' as const },
  { ...painSegment, id: 'relief', visualBeat: 'relief' as const },
];
const balanced = balanceMechanismPresence(mechanismSegments);
ok(balanced[0].visualBeat === 'context' && balanced[1].visualBeat === 'demonstration'
  && balanced[2].visualBeat === 'context' && balanced[3].visualBeat === 'relief',
  'mecanismo não contamina frases vizinhas de sintomas ou alívio');

// Real ED catalog titles seen in the live full-coverage plan. Automatic ad
// selection must not depend on the optional graphic_content API flag.
const explicitEdTitles = [
  'VELHO TRANSANDO COM MULHER (4)',
  'MULHER FAZENDO ORAL EM VELHO',
  'HOMEM EJACULANDO NO ROSTO DE MULHER DUPLO SENTIDO',
  'CASAL EM MOMENTO LIBIDINOSO',
  'RELAÇÃO SEXUAL/SEXO',
];
const explicitEd = explicitEdTitles.map((title, index) => video({ id: `explicit-${index}`, title,
  nicheId: 'ed', nicheName: 'ED', finalScore: .99, downloads: 10000,
  tags: ['ereção', 'saúde masculina', 'confiança', 'bicarbonato', 'mel'],
}));
ok(edSegments.every((segment) => !rankStockFrameVideos(segment, explicitEd, 20, true).length),
  'títulos explícitos reais do catálogo ED não entram em full100 mesmo sem flags e com score remoto alto');
const educationalEd = [
  video({ id: 'ed-doctor', title: 'Médico explicando disfunção erétil e problemas com ereção', nicheId: 'ed', nicheName: 'ED' }),
  video({ id: 'ed-anatomy', title: 'Anatomia 3D do pênis: circulação durante a ereção', nicheId: 'ed', nicheName: 'ED' }),
];
const edProblem = edSegments[0];
ok(rankStockFrameVideos(edProblem, educationalEd, 10, true).length === 2,
  'educação médica e anatomia reprodutiva continuam permitidas: ereção/pênis não são bloqueios');
const surgeryEd = video({ id: 'ed-surgery', title: 'BROXA/CIRURGIA NO PENIS', nicheId: 'ed', nicheName: 'ED', tags: ['ereção'] });
ok(!rankStockFrameVideos(edProblem, [surgeryEd], 10, true).length,
  'cirurgia não é selecionada automaticamente quando a copy fala só da dificuldade de ereção');
const surgeryCopy = { ...edProblem, text: 'O médico explica como funciona a cirurgia no pênis.', semanticText: 'O médico explica como funciona a cirurgia no pênis.',
  contextText: 'O médico explica como funciona a cirurgia no pênis.', semanticContextText: 'O médico explica como funciona a cirurgia no pênis.' };
ok(rankStockFrameVideos(surgeryCopy, [surgeryEd], 10, true).length > 0,
  'cirurgia permanece disponível quando o procedimento é o assunto explícito da fala');
const coupleConversation = { ...planSmartStockSegments([{ label: 'BODY 1', text: 'Depois, o casal conversa com confiança.' }], { coverage: 100, pace: 'long' })[0],
  campaignText: edCopy[0].text, campaignNicheId: 'ed' };
const actualConversation = video({ id: 'couple-conversation', title: 'Casal conversando em casa', nicheId: 'relacionamento', nicheName: 'Relacionamento' });
const neutralConversation = video({ id: 'couple-neutral', title: 'Casal sorrindo sentado no sofá', nicheId: 'relacionamento', nicheName: 'Relacionamento' });
const wrongCoupleAction = video({ id: 'couple-massage', title: 'Mulher massageando namorado', nicheId: 'ed', nicheName: 'ED', tags: ['casal', 'confiança'] });
ok(rankStockFrameVideos(coupleConversation, [actualConversation], 10, true).some((candidate) => candidate.video.id === 'couple-conversation'),
  'uma cena real de conversa pode vir de um pack geral compatível com a campanha ED');
ok(rankStockFrameVideos(coupleConversation, [neutralConversation], 10, true).some((candidate) => candidate.video.id === 'couple-neutral'),
  'casal neutro permanece como alternativa visual para a fala de conversa');
ok(!rankStockFrameVideos(coupleConversation, [wrongCoupleAction], 10, true).length,
  'falar de conversa não seleciona massagem íntima apenas por coincidir com casal e confiança');
const afterSex = video({ id: 'after-sex', title: 'HOMEM SUADO E CANSADO APÓS RELAÇÃO', nicheId: 'ed', nicheName: 'ED', tags: ['ereção', 'frustração', 'casal'] });
const afterSexVariant = video({ id: 'after-sex-7', title: 'HOMEM SUADO E CANSADO APÓS RELAÇÃO7', nicheId: 'ed', nicheName: 'ED', tags: ['ereção', 'frustração', 'casal'] });
ok(!rankStockFrameVideos(edProblem, [afterSex, afterSexVariant], 10, true).length,
  'dificuldade de ereção não vira cena pós-relação, incluindo títulos com número colado');
const explicitDescription = video({ id: 'explicit-description', title: 'Cena de confiança masculina', nicheId: 'ed',
  description: 'Homem ejaculando no rosto de mulher', tags: ['ereção'] });
ok(!rankStockFrameVideos(edProblem, [explicitDescription], 10, true).length,
  'descrição explícita também prevalece sobre um título genérico e metadados de saúde');

const neutralCta = { ...planSmartStockSegments([{ label: 'BODY 1', text: 'Clique abaixo agora para saber todos os detalhes.' }], { coverage: 100, pace: 'long' })[0],
  campaignNicheId: 'ed', campaignText: edCopy[0].text };
const formatOnly = video({ id: 'format-only', title: 'Porta de madeira', nicheId: 'ed', nicheName: 'ED',
  downloads: 999999, durationSec: neutralCta.targetSeconds, finalScore: 1, matchedConcepts: ['ereção'] });
ok(!rankStockFrameVideos(neutralCta, [formatOnly, ...explicitEd], 20, true).length,
  'full100 não admite cena por nicho, vertical, duração, popularidade ou score remoto sem evidência local');
const taxonomyOnly = video({ id: 'taxonomy-only', title: 'Paisagem sem pessoas', nicheId: 'ed', nicheName: 'ED', subcategoryName: 'Problemas de ereção' });
ok(!rankStockFrameVideos(edProblem, [taxonomyOnly], 10, true).length,
  'nome da pasta não inventa ação visual ausente no título, descrição e metadados do take');

const recipePack = [
  video({ id: 'pack-honey-soda', title: 'Misturando bicarbonato e mel', nicheId: 'receitas', nicheName: 'Receitas caseiras', subcategoryName: 'Ingredientes' }),
  video({ id: 'pack-lemon', title: 'Limão sendo espremido', nicheId: 'receitas', nicheName: 'Receitas caseiras' }),
  video({ id: 'pack-vick', title: 'Bicarbonato com Vick', nicheId: 'receitas', nicheName: 'Receitas caseiras' }),
  video({ id: 'other-pathology', title: 'Preparando bicarbonato e mel', nicheId: 'diabetes', nicheName: 'Diabetes Tipo 2' }),
];
const crossPack = rankStockFrameVideos(recipeSegment, recipePack, 20, true);
ok(crossPack.some((candidate) => candidate.video.id === 'pack-honey-soda') && crossPack.some((candidate) => candidate.video.id === 'pack-lemon'),
  'campanha ED usa ingredientes congruentes do pack de receitas e seus subconjuntos');
ok(!crossPack.some((candidate) => ['pack-vick', 'other-pathology'].includes(candidate.video.id)),
  'abertura de pack para mecanismos não libera fórmula extra nem outro nicho patológico');
const isolatedEdProblem = { ...planSmartStockSegments([{ label: 'BODY 1', text: 'Eu tinha problemas com ereção e me sentia frustrado.' }], { coverage: 100, pace: 'long' })[0],
  campaignText: edCopy[0].text, campaignNicheId: 'ed' };
ok(!rankStockFrameVideos(isolatedEdProblem, recipePack, 20, true).length,
  'mecanismo de outro pack não ocupa trecho exclusivamente sobre problemas de ereção');

const czechSource = planSmartStockSegments([{ label: 'BODY 1', text: 'Smíchejte jedlou sodu s medem a citronem.' }], { coverage: 100, pace: 'long' });
const translatedRecipe = { ...localizeSmartSegments(czechSource, ['Misture bicarbonato com mel e limão.'], ['Misture bicarbonato com mel e limão.'])[0],
  campaignNicheId: 'ed' };
const translatedRanking = rankStockFrameVideos(translatedRecipe, [...recipePack, ...explicitEd, formatOnly], 20, true);
ok(translatedRanking.some((candidate) => candidate.video.id === 'pack-honey-soda')
  && !translatedRanking.some((candidate) => candidate.video.id.startsWith('explicit') || ['pack-vick', 'format-only', 'other-pathology'].includes(candidate.video.id)),
  'copy tcheca traduzida para PT usa evidência semântica e bloqueia todos os falsos positivos do catálogo vivo');
ok(translatedRecipe.text === czechSource[0].text && translatedRecipe.wordFrom === czechSource[0].wordFrom && translatedRecipe.wordTo === czechSource[0].wordTo,
  'ranking traduzido conserva texto e âncoras originais da copy');
const englishFallback = { ...planSmartStockSegments([{ label: 'BODY 1', text: 'Mix baking soda with honey and lemon.' }], { coverage: 100, pace: 'long' })[0],
  campaignText: 'Mix baking soda with honey and lemon.', campaignNicheId: 'ed' };
const fallbackRanking = rankStockFrameVideos(englishFallback, [...recipePack, ...explicitEd], 20, true);
ok(fallbackRanking.some((candidate) => candidate.video.id === 'pack-honey-soda')
  && !fallbackRanking.some((candidate) => candidate.video.id === 'pack-vick' || candidate.video.id.startsWith('explicit')),
  'fallback sem tradução reconhece ingredientes multilíngues e mantém a combinação congruente');
ok(!rankStockFrameVideos({ ...czechSource[0], campaignNicheId: 'ed' }, [formatOnly, ...explicitEd], 20, true).length,
  'idioma sem interpretação não vira correspondência falsa apenas por estar no pack ED');

const splitRecipe = { ...recipeSegment, text: 'Misture com cuidado.', semanticText: undefined,
  concepts: [], query: '', contextText: 'Misture com cuidado o bicarbonato com mel e limão.',
  campaignText: edCopy[0].text };
ok(rankStockFrameVideos(splitRecipe, recipePack, 20, true).some((candidate) => candidate.video.id === 'pack-honey-soda'),
  'trecho dividido usa a evidência da própria frase e preserva a receita certa');

const genericEdScenes = [
  video({ id: 'generic-couple', title: 'Casal conversando sentado no sofá', nicheId: 'ed', nicheName: 'ED' }),
  video({ id: 'generic-doctor', title: 'Médico em consulta no consultório', nicheId: 'ed', nicheName: 'ED' }),
  video({ id: 'generic-knee', title: 'Anatomia 3D do joelho', nicheId: 'ed', nicheName: 'ED' }),
  formatOnly, ...explicitEd, ...recipePack,
];
ok(!rankStockFrameVideos(neutralCta, genericEdScenes, 20, true).length,
  'ranking full100 normal continua estrito: fallback genérico só existe por chamada explícita');
const genericFallback = rankStockFrameGenericFallback(neutralCta, genericEdScenes, 20);
ok(['generic-couple', 'generic-doctor'].every((id) => genericFallback.some((candidate) => candidate.video.id === id)),
  'fase final admite casal neutro e consulta com vínculo real ao tema de saúde masculina');
ok(genericFallback.every((candidate) => candidate.genericFallback === true && candidate.reasons.some((reason) => reason.startsWith('alternativa genérica'))),
  'alternativa genérica é marcada e explicada sem se passar por correspondência específica');
ok(!genericFallback.some((candidate) => candidate.video.id === 'format-only' || candidate.video.id === 'generic-knee'
  || candidate.video.id.startsWith('explicit') || candidate.video.id.startsWith('pack-') || candidate.video.id === 'other-pathology'),
  'fallback final não abre cenas explícitas, receita fora da fala, anatomia sem vínculo ou nicho patológico alheio');
ok(!rankStockFrameGenericFallback(recipeSegment, [recipes[3], recipes[4], recipePack[3]], 20).length,
  'fallback final preserva bloqueio de ingredientes extras e outros nichos patológicos');
ok(!rankStockFrameGenericFallback(recovering, [recoveryCatalog[0]], 20).length,
  'fallback final preserva a rejeição de ação dolorosa quando a copy fala de alívio');
const prostateCta = { ...neutralCta, campaignText: 'Saúde da próstata para homens maduros.', campaignNicheId: 'prostata' };
ok(!rankStockFrameGenericFallback(prostateCta, [{ ...genericEdScenes[2], nicheId: 'prostata' }], 20).length,
  'fallback genérico usa anatomia da campanha para impedir joelho no CTA de próstata');
ok(!rankStockFrameGenericFallback(neutralCta, [video({ id: 'neutral-wrong-anatomy', title: 'Homem sentado olhando radiografia do joelho', nicheId: 'ed', nicheName: 'ED' })], 20).length,
  'cena humana neutra não introduz anatomia específica que a campanha não menciona');

const mechanismQueries = smartStockMechanismQueries(edSegments);
ok(['bicarbonato', 'mel', 'limao'].every((query) => mechanismQueries.includes(query)) && mechanismQueries.includes('bicarbonato mel limao'),
  'buscas globais do mecanismo incluem a fórmula e ingredientes individuais para achar outros packs');
ok(mechanismQueries.length <= 8 && new Set(mechanismQueries).size === mechanismQueries.length
  && smartStockMechanismQueries([...edSegments, ...edSegments]).join('|') === mechanismQueries.join('|'),
  'buscas de mecanismo são limitadas, deduplicadas e estáveis com segmentos repetidos');
ok(smartStockMechanismQueries([herbalSegment]).includes('ervas plantas'),
  'mecanismo botânico genérico emite busca global por ervas e plantas');
const genericOnlyRecipe = { ...neutralCta, campaignText: genericCopy, text: genericCopy };
ok(smartStockMechanismQueries([genericOnlyRecipe]).includes('receita caseira')
  && smartStockMechanismQueries([{ ...neutralCta, campaignText: 'Saúde masculina.', text: 'Saúde masculina.' }]).length === 0,
  'busca de receita genérica exige um mecanismo na copy, não apenas nicho de saúde');
const explicitCzechSoda = { ...translatedRecipe, text: 'Smíchejte med s jedlou sodou.', campaignText: 'Trik s medem a jedlou sodou.',
  semanticText: 'Misture mel com refrigerante.', semanticContextText: 'Misture mel com refrigerante.', contextText: 'Smíchejte med s jedlou sodou.' };
ok(smartStockMechanismQueries([explicitCzechSoda]).includes('bicarbonato'),
  'expressão alimentar explícita jedlou sodou no original resgata a busca por bicarbonato mesmo com tradução ruim');
ok(!smartStockMechanismQueries([{ ...neutralCta, campaignText: 'Sklenice sody.', text: 'Sklenice sody.' }]).includes('bicarbonato'),
  'soda/sody isolada não é convertida arbitrariamente em bicarbonato');
const unambiguousCzechRecipe = { ...explicitCzechSoda, campaignText: 'Misture mel. Trik s jedlou sodou.' };
ok(rankStockFrameVideos(unambiguousCzechRecipe, recipePack, 20, true).some((candidate) => candidate.video.id === 'pack-honey-soda'),
  'ranking conserva ingrediente inequívoco do original quando a tradução local o perdeu');

// Regressão observada no Pilot publicado: a receita no fim da frase tcheca
// contaminava o primeiro corte (que só fala da dificuldade após os 50 anos).
const czechOpeningSource = planSmartStockSegments([{ label: 'BODY 1', text: 'Pokud si myslíte, že po padesátce je normální, že už' }], { coverage: 100, pace: 'long' });
const czechOpening = { ...localizeSmartSegments(czechOpeningSource,
  ['Se você acha que depois dos cinquenta é normal não conseguir mais'],
  ['Se você acha que depois dos cinquenta é normal não conseguir mais porque não tentou o truque com bicarbonato.'])[0],
  campaignText: 'Disfunção erétil. Truque com bicarbonato.', campaignNicheId: 'ed' };
ok(!rankStockFrameVideos(czechOpening, [video({ id: 'woman-soda', title: 'MULHER 25 | COZINHA | BICARBONATO', nicheId: 'ed', nicheName: 'ED' })], 10, true).length,
  'ingrediente na frase de contexto não ocupa trecho local sobre sintoma');
const czechMechanism = { ...czechOpening, semanticText: 'Conheça este truque com bicarbonato.',
  semanticContextText: 'Conheça este truque com bicarbonato.' };
ok(rankStockFrameVideos(czechMechanism, [video({ id: 'woman-soda', title: 'MULHER 25 | COZINHA | BICARBONATO', nicheId: 'ed', nicheName: 'ED' })], 10, true).length > 0,
  'ingrediente continua elegível quando o próprio corte menciona o mecanismo');
const misleadingEdTitles = [
  'MULHER TIRANDO CALCINHA', 'MULHER NO ATO', 'MULHER FAZENDO GESTOS SEXUAIS COM A MÃO',
  'MULHER NA ACADEMIA COM SEGUNDAS INTENÇÕES', 'CASAL DORMINDO JUNTOS HOT', 'MULHER BISCOITANDO',
  'PAU DEFEITUOSO FAZENDO ANAL',
];
const misleadingEd = misleadingEdTitles.map((title, index) => video({ id: `misleading-${index}`, title,
  nicheId: 'ed', nicheName: 'ED', tags: ['potência', 'bicarbonato', 'especialista', 'casal'] }));
const czechCta = { ...czechOpening, semanticText: 'Há um vídeo gratuito da especialista que mostra como preparar.',
  semanticContextText: 'Há um vídeo gratuito da especialista que mostra como preparar.',
  campaignText: 'Disfunção erétil. Truque com bicarbonato.' };
ok(!rankStockFrameVideos(czechCta, misleadingEd, 20, true).length
  && !rankStockFrameGenericFallback(czechCta, misleadingEd, 20).length,
  'cenas sexualizadas e caça-cliques não entram no Smart nem no fallback do CTA');
const czechMoney = { ...czechOpening, semanticText: 'Algumas mulheres querem apenas dinheiro, diz a desculpa.',
  semanticContextText: 'Algumas mulheres querem apenas dinheiro, diz a desculpa.',
  campaignText: 'Disfunção erétil. Truque com bicarbonato.' };
ok(!rankStockFrameVideos(czechMoney, [video({ id: 'woman-only', title: 'Mulher na cozinha com bicarbonato', nicheId: 'ed', nicheName: 'ED' })], 10, true).length,
  'mulher e nicho ED não são evidência suficiente para uma frase sobre dinheiro');
const pharmaMoney = video({ id: 'pharma-money', title: 'MÉDICO COM DINHEIRO NA INDUSTRIA FARMACEUTICA',
  nicheId: 'ed', nicheName: 'ED', tags: ['dinheiro', 'potência'] });
ok(!rankStockFrameVideos(czechMoney, [pharmaMoney], 10, true).length
  && !rankStockFrameGenericFallback(czechMoney, [pharmaMoney], 10).length,
  'dinheiro de indústria farmacêutica não representa mulheres e relacionamento');
const educationalEdFallback = video({ id: 'ed-anatomy-fallback', title: 'ANIMAÇÃO 3D EREÇÃO SANGUE',
  description: 'Anatomia do sistema reprodutor masculino e fluxo sanguíneo', nicheId: 'ed', nicheName: 'ED' });
ok(rankStockFrameGenericFallback(czechOpening, [educationalEdFallback], 10).some(candidate => candidate.video.id === 'ed-anatomy-fallback'),
  'anatomia educativa do mesmo nicho pode preencher último recurso quando a fala não tem cena específica');
const crossPackFallback = rankStockFrameGenericFallback({ ...czechOpening,
  campaignText: 'A potência masculina diminui; há um truque com bicarbonato.', campaignNicheId: 'ed' }, [
  video({ id: 'general-couple', title: 'Casal conversando sentado no sofá', nicheId: 'relacionamento', nicheName: 'Relacionamento' }),
  video({ id: 'other-illness', title: 'Mulher diabética preparando insulina', nicheId: 'diabetes', nicheName: 'Diabetes' }),
], 10);
ok(crossPackFallback.some(candidate => candidate.video.id === 'general-couple')
  && !crossPackFallback.some(candidate => candidate.video.id === 'other-illness'),
  'fallback médico admite casal neutro de pack geral, mas não patologias de outro nicho');

console.log(`\n${passed} passaram, ${failed} falharam.`);
if (failed > 0) process.exit(1);
