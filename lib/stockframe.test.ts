import { mergeStockFrameMediaUrls, mergeStockFrameNiches, normalizeStockFrameAccount, normalizeStockFramePage, normalizeStockFrameSmartResults, normalizeStockFrameVideo, type StockFrameVideo } from './stockframe';
import { absorbUnfilledSmartSegments, balanceMechanismPresence, buildSmartStockTimeline, chooseCampaignRecipeTheme, chooseSmartStockAssignments, explainSmartStockScore, fillSmartStockAlternatives, inferStockFrameNiche, localizeSmartSegments, measureSmartStockCoverage, planSmartStockSegments, rankStockFrameGenericFallback, rankStockFrameVideos, rebalanceSmartPlan, selectedSmartCandidate, smartStockMechanismQueries, stockFrameDistinctSiblings, stockFrameEffectiveOrigin, stockFrameSameVisual, stockFrameSeriesKey, stockFrameUsableSeconds, type SmartStockSegment } from './stockframe-smart';
import { sceneProfileOf, segmentVisualIntent } from './stockframe-director';
import { reconciliarPlanoComMontagem, variarFormatosDoPlano } from './stockframe-formatos';
import { insertPadrao, type Insert } from './pilot-inserts';
import { installStockFrameVisualAuditForTest, stockFrameAuditedSearchSeeds, stockFrameVisualAudit } from './stockframe-visual-audit';
import { installStockFrameFeelingForTest } from './stockframe-feeling';
import { visualAuditEntries } from '../data/stockframe-visual-audit';

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
const longToleranceCase = Array.from({ length: 100 }, (_, index) => index + 60).map((total) => {
  const copy = [{ label: 'BODY 1', text: Array.from({ length: total }, (_, index) => index % 7 === 0 ? 'saúde.' : 'saúde').join(' ') }];
  const selected = planSmartStockSegments(copy, { coverage: 60, pace: 'adaptive' });
  const covered = selected.reduce((sum, segment) => sum + segment.wordTo - segment.wordFrom + 1, 0);
  return { total, selected, covered, target: Math.round(total * .6) };
}).find(({ total, covered, target }) => target - covered > 0 && target - covered <= Math.ceil(total * .03));
ok(!!longToleranceCase && longToleranceCase.selected.every((segment) => segment.wordTo - segment.wordFrom + 1 >= 5),
  '60% de copy longa evita microinsert de 2–4 palavras dentro da tolerância permitida');

const video = (patch: Partial<StockFrameVideo> & Pick<StockFrameVideo, 'id' | 'title'>): StockFrameVideo => {
  const { id, title, ...rest } = patch;
  return {
    id, title, description: '', tags: [], durationSec: 8, width: 576, height: 1024,
    aspectRatio: '9:16', hasAudio: false, origin: 'organic', downloads: 0, favorite: false, recent: false,
    downloadCost: 1, available: true, conflictingConcepts: [], matchedConcepts: [], ...rest,
  };
};
installStockFrameVisualAuditForTest(visualAuditEntries);
const auditedSeeds = stockFrameAuditedSearchSeeds();
ok(auditedSeeds.length > 1400 && auditedSeeds.every((seed) => !seed.previewUrl && !seed.posterUrl),
  'índice visual é recuperado por ID sem expor links de mídia ou usar proxies como takes reais');
const auditedAnatomyId = 'ebc63ee4-93b7-4492-930c-5ed5a1b7ab34';
ok(stockFrameVisualAudit(auditedAnatomyId)?.title.includes('PÊNIS'), 'ficha visual validada é recuperada por ID');
const auditedAnatomySegment = {
  ...p100[0], text: 'A anatomia da ereção mostra o tecido erétil masculino.',
  semanticText: 'A anatomia da ereção mostra o tecido erétil masculino.',
  campaignText: 'Disfunção erétil e circulação no corpo masculino.',
  concepts: ['saude-homem', 'anatomia'], campaignNicheId: undefined,
};
ok(rankStockFrameVideos(auditedAnatomySegment, [video({ id: auditedAnatomyId, title: 'ANIMAÇÃO 3D EREÇÃO E EJACULAÇÃO', nicheName: 'Prostata' })]).length === 1,
  'anatomia educacional conferida não vira sexo explícito só pela nomenclatura da API');
ok(!rankStockFrameVideos(auditedAnatomySegment, [video({ id: 'adult-uncurated', title: 'Casal feliz', nicheName: 'ED +18 - EM BREVE' })]).length,
  'pasta adulta permanece fora da seleção automática mesmo com título inocente');
const intimateEdSegment = {
  ...p100[0], text: 'Sua esposa quer ficar satisfeita no quarto.',
  semanticText: 'Sua esposa quer ficar satisfeita no quarto.',
  campaignText: 'Disfunção erétil e intimidade com a esposa.',
  concepts: ['saude-homem', 'relacionamento'], campaignNicheId: undefined,
};
ok(!rankStockFrameVideos(intimateEdSegment, [video({ id: 'fb821c45-c733-42cb-a248-6e878734607d', title: 'MULHER TRANSANDO', nicheName: 'ED' })]).length,
  'rótulo de ato sexual não entra na escolha automática mesmo quando o quadro isolado parece menos explícito');
const technicalEdSegment = {
  ...p100[0], text: 'Pesquisas mostram válvulas microscópicas que seguram o sangue no pênis durante a ereção.',
  semanticText: 'Pesquisas mostram válvulas microscópicas que seguram o sangue no pênis durante a ereção.',
  campaignText: 'Disfunção erétil, fluxo de sangue e bicarbonato de sódio.',
  concepts: ['saude-homem', 'sangue', 'anatomia'], campaignNicheId: undefined,
};
ok(!rankStockFrameVideos(technicalEdSegment, [video({ id: '16a64fc8-39c3-4875-89a1-8a7295ed553b', title: 'DUPLO SENTIDO FRUTA / SEXO', nicheName: 'ED' })]).length,
  'metáfora sexual não substitui explicação técnica de válvulas sanguíneas');
const bloodMechanismSegment = {
  ...technicalEdSegment, text: 'A mistura dissolve o acúmulo nas válvulas e o sangue fica preso.',
  semanticText: 'A mistura dissolve o acúmulo nas válvulas e o sangue fica preso.',
};
ok(!rankStockFrameVideos(bloodMechanismSegment, [video({ id: '16a64fc8-39c3-4875-89a1-8a7295ed553b', title: 'DUPLO SENTIDO FRUTA / SEXO', nicheName: 'ED' })]).length,
  'metáfora provocativa não substitui a etapa de circulação no mecanismo');
const viralProofSegment = {
  ...intimateEdSegment, text: 'O vídeo explodiu com milhares de likes e comentários.',
  semanticText: 'O vídeo explodiu com milhares de likes e comentários.',
};
ok(!rankStockFrameVideos(viralProofSegment, [video({ id: 'irrelevant-viral', title: 'DUPLO SENTIDO AUMENTO PENIANO', nicheName: 'ED' })]).length,
  'fala de repercussão online não recebe metáfora sexual sem tela ou apresentador');
const physicianVideoSegment = {
  ...technicalEdSegment, text: 'Dr. Peter Attia shows the right way in the video.',
  semanticText: 'Dr. Peter Attia shows the right way in the video.',
};
ok(!rankStockFrameVideos(physicianVideoSegment, [video({ id: 'wrong-physician', title: 'ANATOMIA 3D SISTEMA MASCULINO COM BACTERIA', nicheName: 'ED' })]).length,
  'apresentação do especialista não é ilustrada por bactéria anatômica sem médico ou preparo');
const prostateSegment = {
  ...p100[0], text: 'A próstata inchada dificulta a passagem da urina.',
  semanticText: 'A próstata inchada dificulta a passagem da urina.',
  campaignText: 'Problemas da próstata e dificuldade para urinar.',
  concepts: ['saude-homem', 'urinario', 'anatomia'], campaignNicheId: undefined,
};
ok(!rankStockFrameVideos(prostateSegment, [video({ id: '0d232461-f137-4cb5-b266-c62e3a27f651', title: 'PROSTATA 3D ANATOMIA', nicheName: 'Prostata' })]).length,
  'rótulo próstata não transforma uma ilustração de útero em cena prostática');
ok(!rankStockFrameVideos(prostateSegment, [video({ id: 'c0df323c-db60-445e-b913-aabd4e0aa68c', title: 'PROSTATA DEFORMADA COM TUMOR', nicheName: 'Prostata' })]).length,
  'rótulo próstata não transforma intestinos em cena prostática');
const bananaMetaphorId = '556fb083-ed58-4927-88a8-bf3b75108f96';
const bananaRecipeSegment = {
  ...p100[0], text: 'Misture banana e mel nesta receita caseira.',
  semanticText: 'Misture banana e mel nesta receita caseira.',
  campaignText: 'Receita de banana com mel.', concepts: ['alimentacao'],
  campaignNicheId: undefined, visualBeat: 'demonstration' as const,
};
ok(!rankStockFrameVideos(bananaRecipeSegment, [video({ id: bananaMetaphorId, title: 'BANANA FLACIDA MOLE BROXA' })]).length,
  'banana como metáfora de falha erétil não é tomada por demonstração da receita');
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
// Silas, 03.10: "ta repetindo takes ainda, isso não deve acontecer".
ok(reusedPlan[0].selectedVideoId === 'oleocantal' && !reusedPlan[2].selectedVideoId,
  'take nunca é reutilizado, nem em trecho distante: o segundo trecho fica com o avatar');
ok(!reusedPlan[1].selectedVideoId, 'atribuição global mantém vazio o trecho sem correspondência');
const timelineCopy = [{ label: 'BODY 1', text: 'Primeiro mostramos a dor depois a solução e o resultado.' }];
const timelineShot = { ...planSmartStockSegments(timelineCopy, { coverage: 100, pace: 'long' })[0],
  wordFrom: 3, wordTo: 5, selectedVideoId: 'take-1' };
const timelineBlocks = buildSmartStockTimeline(timelineCopy, [timelineShot]);
ok(timelineBlocks.map((block) => block.kind).join(',') === 'avatar,stock,avatar'
  && timelineBlocks.map((block) => block.text).join(' ') === timelineCopy[0].text,
  'timeline revisável mantém toda a copy em ordem, inclusive os trechos sem b-roll');

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
ok(oneSafeTake.filter((segment) => segment.selectedVideoId === 'hortela').length === 1,
  'modo 100% não repete o único take seguro em dois trechos');
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
  ['S potencí, kterou by vám záviděl každý dvacetiletý mladík.', 'ed'],
  ['Um truque que devolve sua potência depois dos cinquenta.', 'ed'],
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

const intimateEd = { ...planSmartStockSegments([{ label: 'BODY 1', text: 'O casal recupera a intimidade e o desejo com confiança.' }], { coverage: 100, pace: 'long' })[0],
  campaignText: `${edCopy[0].text} A disfunção erétil afetou o relacionamento.`, campaignNicheId: 'ed' };
const suggestiveCouple = video({ id: 'ed-sensual', title: 'Casal sensual se abraçando no quarto', nicheId: 'ed', nicheName: 'ED', tags: ['casal', 'intimidade', 'desejo'] });
ok(rankStockFrameVideos(intimateEd, [suggestiveCouple], 10, true).some((candidate) => candidate.video.id === suggestiveCouple.id),
  'momento íntimo da copy ED admite cena sugestiva não explícita e congruente');
ok(!rankStockFrameVideos({ ...intimateEd, campaignText: 'Diabetes tipo 2 altera a glicose.', campaignNicheId: 'diabetes' }, [suggestiveCouple], 10, true).length,
  'cena sugestiva ED não entra em outro nicho');
ok(!rankStockFrameVideos({ ...intimateEd, campaignText: 'A próstata afeta o casal.', campaignNicheId: 'prostata' }, [suggestiveCouple], 10, true).length,
  'saúde masculina genérica não libera cena sugestiva quando a campanha não é ED');
ok(!rankStockFrameVideos({ ...intimateEd, text: 'Clique aqui para saber mais.', semanticText: 'Clique aqui para saber mais.' }, [suggestiveCouple], 10, true).length,
  'CTA não recebe cena íntima apenas pelo contexto da campanha');

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
  'PAU DEFEITUOSO FAZENDO ANAL', 'HOMEM ENFIANDO DEDO EM COCO E SAINDO AGUA DUPLO SENTIDO SEXUAL',
  'DUPLO SENTIDO BROXA', 'MULHER FAZENDO GESTOS SEUXAIS COM A MÃO', 'DUPLO SENTIDO/IREAL',
  'MULHER SAFADA', 'VELHO COM EREÇÃO', 'ANIMAÇÃO 3D EREÇÃO E EJACULAÇÃO',
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
const pharmaMoneyVariant = video({ id: 'pharma-money-2', title: 'MEDICO CONTANDO DINHEIRO NA INDUSTRIA',
  nicheId: 'ed', nicheName: 'ED', tags: ['dinheiro', 'potência'] });
ok(!rankStockFrameVideos(czechMoney, [pharmaMoney, pharmaMoneyVariant], 10, true).length
  && !rankStockFrameGenericFallback(czechMoney, [pharmaMoney, pharmaMoneyVariant], 10).length,
  'dinheiro de indústria farmacêutica não representa mulheres e relacionamento');
const wrongRecipeScene = video({ id: 'romantic-cooking', title: 'CASAL APAIXONADO COZINHANDO',
  nicheId: 'ed', nicheName: 'ED', tags: ['receita', 'preparo'] });
ok(!rankStockFrameVideos({ ...czechMechanism, campaignIngredients: ['bicarbonato'] }, [wrongRecipeScene], 10, true).length,
  'fala que nomeia bicarbonato não recebe cozinha genérica sem o ingrediente');
const wrongConflict = video({ id: 'couple-fighting', title: 'MULHER DISCUTINDO COM MARIDO NA CAMA',
  nicheId: 'ed', nicheName: 'ED', tags: ['casal', 'relacionamento'] });
ok(!rankStockFrameVideos({ ...czechOpening, semanticText: 'A especialista mostra como ter mais potência na cama.' }, [wrongConflict], 10, true).length,
  'prova de desempenho não vira conflito do casal na cama');
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

const ctaOnly = { ...czechOpening, text: 'Clique no botão e assista ao vídeo.',
  semanticText: 'Clique no botão e assista ao vídeo.',
  semanticContextText: 'Clique no botão e assista ao vídeo.', concepts: [], query: '' };
const ctaPhone = video({ id: 'cta-phone', title: 'Pessoa clicando no celular para assistir vídeo',
  nicheId: 'geral', nicheName: 'Geral' });
const ctaOptions = rankStockFrameGenericFallback(ctaOnly, [educationalEdFallback, genericEdScenes[1], ctaPhone], 10);
ok(ctaOptions[0]?.video.id === 'cta-phone',
  'CTA prioriza ação visível de celular sobre anatomia genérica e consulta');
const liveCtaOptions = rankStockFrameGenericFallback(ctaOnly, [
  video({ id: 'toxic-phone', title: 'CASAL TOXICO CELULAR', nicheId: 'ed', nicheName: 'ED' }),
  video({ id: 'crying-phone', title: 'MULHER CHORANDO COM CELULAR NA MAO', nicheId: 'ed', nicheName: 'ED' }),
  video({ id: 'vague-phone', title: 'MULHER COM CELULAR MARIDO', nicheId: 'ed', nicheName: 'ED' }),
  video({ id: 'paying-phone', title: 'PAGAMENTO PELO CELULAR', nicheId: 'ed', nicheName: 'ED' }),
  video({ id: 'older-phone', title: 'CASAL IDOSO USANDO CELULAR', nicheId: 'vsl', nicheName: 'VSL' }),
  video({ id: 'person-phone', title: 'PESSOAS USANDO CELULAR', nicheId: 'vsl', nicheName: 'VSL' }),
], 12);
ok(liveCtaOptions.some(candidate => candidate.video.id === 'older-phone')
  && liveCtaOptions.some(candidate => candidate.video.id === 'person-phone')
  && !liveCtaOptions.some(candidate => ['toxic-phone', 'crying-phone', 'vague-phone', 'paying-phone'].includes(candidate.video.id)),
  'CTA real usa pessoas no celular e rejeita cenas tóxicas, choro, pagamento e título sem ação');
ok(rankStockFrameGenericFallback(ctaOnly, [educationalEdFallback], 10).some(candidate => candidate.video.id === 'ed-anatomy-fallback'),
  'penalidade editorial não quebra cobertura 100% quando anatomia é a única alternativa segura');
const neutralBridge = { ...czechOpening, text: 'Eu sei que muitos vão me perguntar.',
  semanticText: 'Eu sei que muitos vão me perguntar.',
  semanticContextText: 'Eu sei que muitos vão me perguntar.', concepts: [], query: '' };
const bridgeOptions = rankStockFrameGenericFallback(neutralBridge, [educationalEdFallback, genericEdScenes[1]], 10);
ok(bridgeOptions[0]?.video.id === 'generic-doctor',
  'frase de ligação prefere consulta humana a anatomia repetida');

// Regressão do Pilot real: 60% escolhe somente parte da copy tcheca. O nicho
// deve vir da copy completa, onde "potenci" aparece, não só dos recortes que
// podem falar de juventude e cair indevidamente em Rejuvenescimento.
const czechFullNiche = inferStockFrameNiche([{ label: 'BODY 1',
  text: 'Pokud si myslíte, že po padesátce je normální, že už to nestojí, tento trik s jedlou sodou vrací potenci.' }], [
  { id: 'rejuvenescimento', name: 'Rejuvenescimento', count: 100 },
  { id: 'ed', name: 'ED', count: 286 },
]);
ok(czechFullNiche?.id === 'ed', 'copy tcheca completa ancora o catálogo no nicho ED antes dos recortes traduzidos');
const unrelatedActions = [
  video({ id: 'dressing', title: 'MULHER VESTINDO ROUPA', nicheId: 'ed', nicheName: 'ED', tags: ['especialista', 'potência'] }),
  video({ id: 'wakeup', title: 'MULHER TENTANDO ACORDAR MARIDO', nicheId: 'ed', nicheName: 'ED', tags: ['potência'] }),
];
const specialistSegment = { ...czechOpening, semanticText: 'A especialista mostra em vídeo como preparar a receita.',
  semanticContextText: 'A especialista mostra em vídeo como preparar a receita.' };
ok(!rankStockFrameVideos(specialistSegment, [unrelatedActions[0]], 10, true).length
  && !rankStockFrameGenericFallback(specialistSegment, [unrelatedActions[0]], 10).length,
  'especialista ensinando preparo não vira mulher vestindo roupa');
const durationSegment = { ...czechOpening, semanticText: 'Este truque ajuda o homem a durar pelo menos 20 minutos mais.',
  semanticContextText: 'Este truque ajuda o homem a durar pelo menos 20 minutos mais.' };
const symptomDoctor = video({ id: 'doctor-broxa', title: 'MÉDICO APONTANDO PARA BROXA', nicheId: 'ed', nicheName: 'ED' });
ok(!rankStockFrameVideos(durationSegment, [unrelatedActions[1], symptomDoctor], 10, true).length
  && !rankStockFrameGenericFallback(durationSegment, [unrelatedActions[1], symptomDoctor], 10).length,
  'benefício de duração não recebe marido sendo acordado nem imagem do sintoma oposto');
const unrelatedBedActions = [
  video({ id: 'sleeping-couple', title: 'HOMEM E MULHER DORMINDO JUNTOS', nicheId: 'ed', nicheName: 'ED' }),
  video({ id: 'gym-woman', title: 'MULHER TREINANDO COM PRAZER', nicheId: 'ed', nicheName: 'ED' }),
];
ok(!rankStockFrameVideos(durationSegment, unrelatedBedActions, 10, true).length
  && !rankStockFrameGenericFallback(durationSegment, unrelatedBedActions, 10).length,
  'fala de desempenho não vira casal dormindo ou treino de academia só por estar no pack ED');
const sleepSegment = { ...durationSegment, semanticText: 'O casal dorme junto depois de um longo dia.',
  semanticContextText: 'O casal dorme junto depois de um longo dia.' };
ok(rankStockFrameVideos(sleepSegment, [unrelatedBedActions[0]], 10, true).length > 0,
  'cena de sono continua permitida quando a copy realmente fala de dormir');
const energyReturn = { ...czechOpening, semanticText: 'Este método recupera a energia que o homem tinha quando era jovem.',
  semanticContextText: 'Este método recupera a energia que o homem tinha quando era jovem.',
  narrativeDirection: 'recovery' as const, visualBeat: 'relief' as const };
const happyMan = video({ id: 'happy-man', title: 'HOMEM SORRINDO FELIZ', nicheId: 'relacionamento', nicheName: 'Relacionamento' });
const wrongPain = video({ id: 'wrong-pain', title: 'HOMEM COM DOR NO JOELHO', nicheId: 'dores', nicheName: 'Dores Articulares' });
const smilingPhone = video({ id: 'smiling-phone', title: 'MULHER SORRINDO COM CELULAR', nicheId: 'vsl', nicheName: 'VSL' });
ok(rankStockFrameGenericFallback(energyReturn, [happyMan, educationalEdFallback, wrongPain, smilingPhone], 10)[0]?.video.id === 'happy-man',
  'retorno da energia pode preferir homem feliz de pack geral a anatomia genérica, sem aceitar outra patologia');
ok(rankStockFrameGenericFallback(energyReturn, [educationalEdFallback, smilingPhone], 10)[0]?.video.id === 'ed-anatomy-fallback',
  'celular sorridente não domina uma fala de recuperação sem ação digital');
const socialProof = { ...czechOpening, text: 'O vídeo viralizou com milhares de comentários na plataforma.',
  semanticText: 'O vídeo viralizou com milhares de comentários na plataforma.',
  semanticContextText: 'O vídeo viralizou com milhares de comentários na plataforma.', concepts: [], query: '' };
const socialPhone = video({ id: 'social-phone', title: 'PESSOAS USANDO CELULAR', nicheId: 'vsl', nicheName: 'VSL' });
ok(rankStockFrameGenericFallback(socialProof, [socialPhone], 10).some(candidate => candidate.video.id === 'social-phone'),
  'repercussão online aceita celular neutro de outro pack quando o título prova a ação e o catálogo não traz metadado visual');
const microplasticBlood = video({ id: 'microplastic-blood', title: 'MICROPLASTICOS RETIRADOS DO ORGANISMO HUMANO, FLUXO SANGUINEO',
  nicheId: 'ed', nicheName: 'ED' });
const erectionPressure = { ...czechOpening, text: 'O pênis incha com a pressão do sangue na ereção.',
  semanticText: 'O pênis incha com a pressão do sangue na ereção.',
  semanticContextText: 'O pênis incha com a pressão do sangue na ereção.' };
ok(!rankStockFrameVideos(erectionPressure, [microplasticBlood], 10, true).length
  && !rankStockFrameGenericFallback(erectionPressure, [microplasticBlood], 10).length,
  'fluxo sanguíneo não autoriza microplásticos que a copy não menciona');
const teaser = { ...czechOpening, text: 'Preste atenção, esta pode ser a última vez que mostro isto.',
  semanticText: 'Preste atenção, esta pode ser a última vez que mostro isto.',
  semanticContextText: 'Preste atenção, esta pode ser a última vez que mostro isto.' };
const exhibition = video({ id: 'exhibition', title: 'MULHER SE EXIBINDO', nicheId: 'ed', nicheName: 'ED' });
ok(!rankStockFrameVideos(teaser, [exhibition], 10, true).length
  && !rankStockFrameGenericFallback(teaser, [exhibition], 10).length,
  'frase de atenção não vira mulher se exibindo só por estar no pack ED');
const homemadePrice = { ...czechOpening, text: 'É natural, caseiro e custa menos de cinco dólares.',
  semanticText: 'É natural, caseiro e custa menos de cinco dólares.',
  semanticContextText: 'É natural, caseiro e custa menos de cinco dólares.', visualBeat: 'demonstration' as const };
ok(!rankStockFrameVideos(homemadePrice, [video({ id: '14ea38fc-1649-4550-a38f-ff2a2f87cfba',
  title: 'BANANA MURCHANDO DUPLO SENTIDO BROXA', nicheId: 'ed', nicheName: 'ED' })], 10, true).length,
  'preço e preparo caseiro não recebe a metáfora visual de broxa');

const prostateCopy = 'A próstata inflamada causa dificuldade para urinar. Um ritual com Vick ajuda a rotina, mas o corpo não elimina microplásticos e o homem acorda para ir ao banheiro.';
ok(inferStockFrameNiche([{ label: 'BODY 1', text: 'A prósta inchada me fazia mijar toda noite.' }], [
  { id: 'ed', name: 'ED', count: 100 }, { id: 'prostata', name: 'Próstata', count: 100 },
])?.id === 'prostata', 'copy coloquial prósta ancora a busca no pack Próstata, sem cair em ED');
ok(planSmartStockSegments([{ label: 'BODY 1', text: 'Voltei a mijar normalmente.' }], { coverage: 100, pace: 'long' })[0].concepts.includes('urinario'),
  'mijar é interpretado como cena urinária, não como sintoma sexual');
const prostateBase = { ...czechOpening, campaignText: prostateCopy, campaignNicheId: 'prostata',
  concepts: ['urinario'], contextConcepts: ['urinario'] };
const prostateMechanism = { ...prostateBase, text: 'O corpo não consegue quebrar nem eliminar as partículas.',
  semanticText: 'O corpo não consegue quebrar nem eliminar as partículas.',
  semanticContextText: 'O corpo não consegue quebrar nem eliminar as partículas.' };
const prostateBathroom = { ...prostateBase, text: 'Voltar a mijar normalmente e esvaziar a bexiga.',
  semanticText: 'Voltar a mijar normalmente e esvaziar a bexiga.',
  semanticContextText: 'Voltar a mijar normalmente e esvaziar a bexiga.' };
const prostateResearch = { ...prostateBase, text: 'Saíram pesquisas recentes que mostraram os resultados.',
  semanticText: 'Saíram pesquisas recentes que mostraram os resultados.',
  semanticContextText: 'Saíram pesquisas recentes que mostraram os resultados.' };
const prostatePrice = { ...prostateBase, text: 'Ele queria que eu gastasse trinta mil.',
  semanticText: 'Ele queria que eu gastasse trinta mil.',
  semanticContextText: 'Ele queria que eu gastasse trinta mil.' };
const misleadingProstateScenes = [
  video({ id: 'prostate-betrayal', title: 'HOMEM TRAINDO A SUA NAMORADA', nicheId: 'prostata', nicheName: 'Próstata', tags: ['homem', 'problema'] }),
  video({ id: 'prostate-broxa', title: 'DUPLO SENTIDO/BROXA', nicheId: 'prostata', nicheName: 'Próstata', tags: ['homem', 'problema'] }),
  video({ id: 'prostate-barn', title: 'CASAL SAINDO DO ESTÁBULO', nicheId: 'prostata', nicheName: 'Próstata', tags: ['casal'] }),
  video({ id: 'prostate-celebrity', title: 'VINI JR PASSANDO VICK NO PEITO', nicheId: 'prostata', nicheName: 'Próstata', tags: ['vick'] }),
  video({ id: 'prostate-package', title: 'MOSTRANDO PACOTE', nicheId: 'prostata', nicheName: 'Próstata', tags: ['pesquisa'] }),
  video({ id: 'prostate-refusal', title: 'HOMEM NAO QUERENDO MULHER', nicheId: 'prostata', nicheName: 'Próstata', tags: ['homem'] }),
];
ok(!rankStockFrameVideos(prostateMechanism, misleadingProstateScenes.slice(0, 4), 10, true).length
  && !rankStockFrameGenericFallback(prostateMechanism, misleadingProstateScenes.slice(0, 4), 10).length,
  'próstata e microplásticos não viram traição, broxa, celebridade ou estábulo nem com 100%');
ok(!rankStockFrameVideos(prostateResearch, [misleadingProstateScenes[4]], 10, true).length,
  'pesquisa que mostrou resultado não vira pacote mostrado por semelhança de verbo');
ok(!rankStockFrameVideos(prostatePrice, [misleadingProstateScenes[5]], 10, true).length,
  'preço não vira homem rejeitando mulher por semelhança de verbo');
ok(!rankStockFrameVideos(prostateBathroom, [misleadingProstateScenes[1]], 10, true).length,
  'sintoma urinário não recebe metáfora de falha erétil');
ok(rankStockFrameVideos(prostateBathroom,
  [video({ id: 'prostate-urinary', title: 'HOMEM INDO AO BANHEIRO COM URGÊNCIA', nicheId: 'prostata', nicheName: 'Próstata', tags: ['urinar', 'bexiga'] })], 10, true).length > 0,
  'cena urinária congruente continua disponível para a copy de próstata');

const prostateUnsafeCuts = [
  video({ id: 'blood-urine', title: 'HOMEM MIJANDO SANGUEEE', nicheId: 'prostata', nicheName: 'Próstata' }),
  video({ id: 'rectal-exam', title: 'EXAME DE TOQUE DE PROSTATA', nicheId: 'prostata', nicheName: 'Próstata' }),
  video({ id: 'urine-animation', title: 'URINA PASSANDO PELA PROSTATA', nicheId: 'prostata', nicheName: 'Próstata' }),
  video({ id: 'radiograph', title: 'RADIOGRAFIA', nicheId: 'prostata', nicheName: 'Próstata' }),
  video({ id: 'sleeping-man', title: 'IDOSO DORMINDO', nicheId: 'prostata', nicheName: 'Próstata' }),
  video({ id: 'hose', title: 'MANGUEIRA JATO FORTEE', nicheId: 'prostata', nicheName: 'Próstata' }),
];
const rejectsBoth = (segment: Parameters<typeof rankStockFrameVideos>[0], clip: StockFrameVideo) =>
  !rankStockFrameVideos(segment, [clip], 10, true).length && !rankStockFrameGenericFallback(segment, [clip], 10).length;
ok(rejectsBoth(prostateBathroom, prostateUnsafeCuts[0]),
  'urgência urinária não inventa sangue na urina, inclusive no fallback 100%');
ok(rejectsBoth(prostateResearch, prostateUnsafeCuts[1]),
  'pesquisa clínica não vira exame de toque retal não citado');
ok(rejectsBoth(prostatePrice, prostateUnsafeCuts[2]),
  'preço de tratamento não vira animação de urina só por ser do nicho');
ok(rejectsBoth(homemadePrice, prostateUnsafeCuts[3]),
  'preparo caseiro não vira radiografia por proximidade médica');
ok(rejectsBoth(prostateBathroom, prostateUnsafeCuts[4]),
  'urgência noturna para banheiro não vira idoso dormindo');
ok(rejectsBoth(prostateResearch, prostateUnsafeCuts[5]),
  'resultados da pesquisa não viram metáfora de mangueira');
const bleedingCopy = { ...prostateBathroom, text: 'Ao urinar havia sangue na urina.',
  semanticText: 'Ao urinar havia sangue na urina.', semanticContextText: 'Ao urinar havia sangue na urina.' };
ok(rankStockFrameVideos(bleedingCopy, [prostateUnsafeCuts[0]], 10, true).length > 0,
  'sangue na urina permanece elegível quando a copy realmente diz isso');
const rectalCopy = { ...prostateResearch, text: 'O médico recomendou exame de toque retal.',
  semanticText: 'O médico recomendou exame de toque retal.', semanticContextText: 'O médico recomendou exame de toque retal.' };
ok(rankStockFrameVideos(rectalCopy, [prostateUnsafeCuts[1]], 10, true).length > 0,
  'exame de toque continua elegível quando narrado');
const liveBleeding = video({ id: 'blood-urine-variant', title: 'VELHO MIJANDO MUITOO SANGUE', nicheId: 'prostata', nicheName: 'Próstata' });
const liveTouchA = video({ id: 'touch-variant-a', title: 'EXAME DE PROSTATA TOQUE', nicheId: 'prostata', nicheName: 'Próstata' });
const liveTouchB = video({ id: 'touch-variant-b', title: 'PROSTATA TOQUE EXAME', nicheId: 'prostata', nicheName: 'Próstata' });
const liveProstateExam = video({ id: 'exam-variant', title: 'EXAME DE PROSTA 3', nicheId: 'prostata', nicheName: 'Próstata' });
const pureCta = { ...prostateBase, text: 'É só clicar nesse botão aqui embaixo para assistir.',
  semanticText: 'É só clicar nesse botão aqui embaixo para assistir.',
  semanticContextText: 'É só clicar nesse botão aqui embaixo para assistir.' };
const recipeCta = { ...prostateBase, text: 'Clique nesse botão para começar a fazer a receita.',
  semanticText: 'Clique nesse botão para começar a fazer a receita.',
  semanticContextText: 'Clique nesse botão para começar a fazer a receita.' };
ok(rejectsBoth(prostateBathroom, liveBleeding),
  'variação real mijando muitoo sangue também não representa urgência urinária');
ok(rejectsBoth(prostateResearch, liveTouchA) && rejectsBoth(prostateResearch, liveTouchB),
  'variações reais de exame de toque não representam pesquisa sem procedimento');
ok(rejectsBoth(pureCta, liveProstateExam) && rejectsBoth(recipeCta, liveProstateExam),
  'exame de próstata não ocupa CTA mesmo quando ele menciona receita');
const liveErection = video({ id: 'erection-animation', title: 'ANIMAÇÃO 3D EREÇÃO E EJACULAÇÃO', nicheId: 'prostata', nicheName: 'Próstata' });
const pastProblem = { ...prostateBase, text: 'Mas hoje tudo isso é coisa do passado.',
  semanticText: 'Mas hoje tudo isso é coisa do passado.', semanticContextText: 'Mas hoje tudo isso é coisa do passado.' };
ok(rejectsBoth(pastProblem, liveErection),
  'alívio inespecífico não vira anatomia de ereção/ejaculação em copy de próstata');
const appropriateExam = { ...prostateResearch, text: 'Refiz meus exames de próstata e o resultado melhorou.',
  semanticText: 'Refiz meus exames de próstata e o resultado melhorou.',
  semanticContextText: 'Refiz meus exames de próstata e o resultado melhorou.' };
ok(rankStockFrameVideos(appropriateExam, [liveProstateExam], 10, true).length > 0,
  'exame de próstata ainda é elegível quando o trecho realmente cita exames');

const lipedemaCopy = 'A paciente tem lipedema: pernas inchadas, dor e celulite. Treinar pernas não resolve a inflamação. Ela começou um protocolo natural e voltou a subir escadas sem dor.';
const weightLossNiche = { id: 'emagrecimento', name: 'Emagrecimento', count: 500 };
ok(inferStockFrameNiche([{ label: 'BODY', text: lipedemaCopy }], [weightLossNiche])?.id === 'emagrecimento',
  'copy de lipedema usa a pasta Emagrecimento onde o StockFrame cataloga esses takes');
ok(inferStockFrameNiche([{ label: 'BODY', text: lipedemaCopy }], [weightLossNiche,
  { id: 'lipedema', name: 'Lipedema', count: 18 }])?.id === 'lipedema',
  'pasta dedicada Lipedema vence o fallback Emagrecimento quando aparecer');
const lipedemaBase = { ...prostateBase, campaignText: lipedemaCopy, campaignNicheId: 'emagrecimento',
  concepts: ['lipedema'], contextConcepts: ['lipedema'] };
ok(smartStockMechanismQueries([lipedemaBase]).includes('lipedema'),
  'busca global encontra takes de lipedema mesmo sem pasta dedicada');
const swollenLegs = { ...lipedemaBase, text: 'As pernas dela estavam inchadas e doloridas.',
  semanticText: 'As pernas dela estavam inchadas e doloridas.',
  semanticContextText: 'As pernas dela estavam inchadas e doloridas.' };
const lipedemaLegs = video({ id: 'lipedema-legs', title: 'PERNAS IINFLAMADAS LIPEDEMA',
  nicheId: 'emagrecimento', nicheName: 'Emagrecimento', description: 'Pernas inflamadas com lipedema.' });
const maleDriving = video({ id: 'male-driving', title: 'HOMEM ROMANTICO DIRIGINDO',
  nicheId: 'emagrecimento', nicheName: 'Emagrecimento' });
const genericPills = video({ id: 'generic-pills', title: 'VELHO/A TOMANDO REMÉDIO',
  nicheId: 'emagrecimento', nicheName: 'Emagrecimento' });
const pointlessPhone = video({ id: 'cellphone', title: 'IDOSAS COMPARTILHANDO CELULARES',
  nicheId: 'emagrecimento', nicheName: 'Emagrecimento' });
const vagueLipedema = { ...lipedemaBase, text: 'Mas não é isso. Precisamos mudar o protocolo.',
  semanticText: 'Mas não é isso. Precisamos mudar o protocolo.',
  semanticContextText: 'Mas não é isso. Precisamos mudar o protocolo.' };
ok(rankStockFrameVideos(swollenLegs, [lipedemaLegs, maleDriving, genericPills], 10, true)[0]?.video.id === 'lipedema-legs',
  'pernas inchadas recebem take da condição, não homem dirigindo nem remédio');
ok(!rankStockFrameVideos(vagueLipedema, [maleDriving, genericPills, pointlessPhone], 10, true).length
  && !rankStockFrameGenericFallback(vagueLipedema, [maleDriving, genericPills, pointlessPhone], 10).length,
  'fallback do lipedema não usa homem, remédio nem celular sem ação narrada');
ok(rankStockFrameGenericFallback(vagueLipedema, [lipedemaLegs], 10)[0]?.video.id === 'lipedema-legs',
  'último recurso ainda pode manter 100% com take neutro da condição da campanha');

console.log('\nSMART STOCKS — feeling do Silas (03.10): sem repetição, contexto e alternativas:');
const quiaboCopy = 'Por que acha que mesmo tomando por tanto tempo a próstata não para de crescer? Esse composto está na baba do quiabo. '
  + 'Muitos relataram a próstata reduzir de tamanho em cerca de 14 dias, voltar a mijar forte e dormir a noite inteira. '
  + 'A parte boa, o quiabo custa quase nada e se faz tudo na sua cozinha. A parte que ninguém te conta, existe um detalhe no preparo. '
  + 'Aí o médico passa a finasterida e diz que é pra vida toda. Vou te mostrar o que a indústria farmacêutica não quer.';
const quiaboSegment = (text: string) => ({ ...planSmartStockSegments([{ label: 'BODY 1', text }], { coverage: 100, pace: 'long' })[0],
  campaignText: quiaboCopy, campaignNicheId: 'prostata' });
const prostateVideo = (id: string, title: string, patch: Partial<StockFrameVideo> = {}) =>
  video({ id, title, nicheId: 'prostata', nicheName: 'Prostata', ...patch });

ok(stockFrameSeriesKey({ title: 'MANGUEIRA JATO FORTEE' }) === stockFrameSeriesKey({ title: 'MANGUEIRA JATO FORTE (2)' })
  && stockFrameSeriesKey({ title: 'PROSTATA INFALAMADA 3D(3)' }) === stockFrameSeriesKey({ title: 'PROSTATA INFALAMADA 3D(8)' })
  && stockFrameSeriesKey({ title: 'HOMEM MIJANDO SANGUEEE' }) === stockFrameSeriesKey({ title: 'HOMEM MIJANDO SANGUE' }),
  'série visual ignora numeração e letra repetida de digitação');
ok(stockFrameSeriesKey({ title: 'ANIMAÇÃO 3D PROSTATA E RINS' }) !== stockFrameSeriesKey({ title: 'ANIMAÇÃO DE PROSTATA 3D(3)' }),
  'cenas diferentes do mesmo pack continuam séries diferentes');

const growth = quiaboSegment('Por que a próstata não para de crescer?');
const series3 = prostateVideo('serie-3', 'PROSTATA INFALAMADA 3D(3)');
const series8 = prostateVideo('serie-8', 'PROSTATA INFALAMADA 3D(8)');
const urgency = prostateVideo('urgencia', 'URGENCIA DE URINAR');
const seriesPlan = chooseSmartStockAssignments([
  { ...growth, id: 'growth-1', candidates: [{ video: series3, score: 40, reasons: [] }] },
  { ...growth, id: 'growth-2', candidates: [{ video: series8, score: 39, reasons: [] }, { video: urgency, score: 20, reasons: [] }] },
], true);
ok(seriesPlan[0].selectedVideoId === 'serie-3' && seriesPlan[1].selectedVideoId === 'urgencia',
  'duas variações da mesma série nunca entram no mesmo plano');
const twinA = prostateVideo('twin-a', 'VELHO ACORDANDO DE MADRUGADA');
const twinB = prostateVideo('twin-b', 'VELHO ACORDANDO DE MADRUGADA');
const twinPlan = chooseSmartStockAssignments([
  { ...growth, id: 'twin-1', candidates: [{ video: twinA, score: 30, reasons: [] }] },
  { ...growth, id: 'twin-2', candidates: [{ video: twinB, score: 30, reasons: [] }] },
], true);
ok(twinPlan.filter((segment) => segment.selectedVideoId).length === 1, 'o mesmo take subido duas vezes (ids diferentes) não repete');
const dupPlan = chooseSmartStockAssignments([
  { ...growth, id: 'dup-1', candidates: [{ video: prostateVideo('dup-a', 'CENA A', { duplicateGroupId: 'g1' }), score: 30, reasons: [] }] },
  { ...growth, id: 'dup-2', candidates: [{ video: prostateVideo('dup-b', 'CENA B', { duplicateGroupId: 'g1' }), score: 30, reasons: [] }] },
], true);
ok(dupPlan.filter((segment) => segment.selectedVideoId).length === 1, 'grupo de duplicata do StockFrame conta como o mesmo take');

const kitchen = quiaboSegment('A parte boa, o quiabo custa quase nada e se faz tudo na sua cozinha.');
const coffeeForGirlfriend = video({ id: 'cafe-namorada', title: 'HOMEM PREPARANDO CAFE PARA NAMORADA', nicheId: 'relacionamento', nicheName: 'Relacionamento' });
ok(explainSmartStockScore(kitchen, coffeeForGirlfriend, 'generic').score < 0
  && explainSmartStockScore(kitchen, coffeeForGirlfriend, 'pack').score < 0,
  'AD de próstata: "faz tudo na sua cozinha" nunca vira café do namorado pra namorada');
ok(explainSmartStockScore(kitchen, video({ id: 'loira-colher', title: 'LOIRA FAZENDO TRUQUE DA COLHER', nicheId: 'rejuv', nicheName: 'Rejuvenescimento' }), 'generic').score < 0,
  'truque de outro nicho de saúde não ilustra a cozinha do quiabo');
ok(explainSmartStockScore(kitchen, video({ id: 'monges', title: 'MONGES PREPARANDO BOLO', nicheId: 'prosp', nicheName: 'Prosperidade / Religioso' }), 'generic').score < 0
  && explainSmartStockScore(kitchen, video({ id: 'ostentando', title: 'OSTENTANDO DINHEIRO', nicheId: 'prosp', nicheName: 'Prosperidade / Religioso' }), 'generic').score < 0,
  '"custa quase nada" não puxa monge, anjo nem ostentação');
ok(explainSmartStockScore(kitchen, video({ id: 'avatar-cozinha', title: 'HOMEM 70 | GRISALHO | COZINHA', nicheId: 'avatares', nicheName: 'Avatares Realistas I.A' }), 'generic').score < 0
  && explainSmartStockScore(kitchen, video({ id: 'seta', title: 'SETA NEON', nicheId: 'edicao', nicheName: 'Edição' }), 'generic').score < 0,
  'packs de avatar falante e de efeitos de edição não entram como b-roll');
const toldSecret = quiaboSegment('A parte que ninguém te conta, existe um detalhe no preparo.');
ok(explainSmartStockScore(toldSecret, video({ id: 'conta-banco', title: 'DINHEIRO NA CONTA DO BANCO', nicheId: 'renda', nicheName: 'Renda Extra' }), 'generic').score < 0,
  '"ninguém te conta" não casa com "conta do banco"');

const recovered = quiaboSegment('voltar a mijar forte e dormir a noite inteira.');
const recoveredRank = rankStockFrameVideos(recovered, [
  prostateVideo('acordando', 'HOMEM ACORDANDO A NOITE'), prostateVideo('dormindo', 'VELHO DORMINDO'),
], 10, true);
ok(recoveredRank.some((candidate) => candidate.video.id === 'dormindo') && !recoveredRank.some((candidate) => candidate.video.id === 'acordando'),
  '"dormir a noite inteira" é melhora: acordar de madrugada (o sintoma) fica de fora');

const prescribed = quiaboSegment('Aí o médico passa a finasterida e diz que é pra vida toda.');
ok(explainSmartStockScore(prescribed, video({ id: 'tomando-remedio', title: 'VELHO TOMANDO REMEDIO', nicheId: 'mecanismos', nicheName: 'Mecanismos Gerais' })).score > 0,
  'finasterida é fala de remédio: cena de remédio passa');
const pharma = quiaboSegment('Vou te mostrar o que a indústria farmacêutica não quer.');
ok(explainSmartStockScore(pharma, video({ id: 'pharma', title: 'INDUSTRIA FARMACEUTICA CONTANDO DINHEIRO', nicheId: 'mecanismos', nicheName: 'Mecanismos Gerais' })).score > 0,
  'pack neutro atravessa nicho quando o título diz o que a fala diz');

const shortClip = explainSmartStockScore({ ...growth, targetSeconds: 8 }, prostateVideo('curto', 'PROSTATA 3D CURTA', { durationSec: 3 }));
ok(shortClip.reasons.includes('take mais curto que o trecho: o fim congelaria'), 'take curto demais para o trecho é penalizado (congelaria)');
ok(stockFrameUsableSeconds({ durationSec: 20, recommendedStartSec: 2, recommendedEndSec: 6.5 }) === 4.5
  && stockFrameUsableSeconds({ durationSec: 7 }) === 7, 'duração útil segue o mesmo recorte do insert');

const packVideos = ['ANIMAÇÃO DE PROSTATA 3D', 'ANIMAÇÃO 3D PROSTATA E RINS', 'MÉDICO ANALISANDO PROSTATA INCHADA (1)',
  'MÉDICO ANALISANDO PROSTATA INCHADA (2)', 'SISTEMA REPRODUTOR MASCULINO 3D', 'URINA PASSANDO PELA PROSTATA',
  'CORPO HUMANO 3D SISTEMA MASCULINO', 'MÉDICO EXPLICANDO SOBRE PROSTATA', 'PROSTATA COM INFLAMAÇÃO ANIMAÇÃO 3D']
  .map((title, index) => prostateVideo(`pack-${index}`, title));
const filled = fillSmartStockAlternatives([{ ...quiaboSegment('Esse composto está na baba do quiabo.'), candidates: [] as ReturnType<typeof rankStockFrameVideos> }],
  { pool: packVideos, pack: packVideos, minimum: 6 })[0];
ok(filled.candidates.length >= 6, 'trecho sem cena específica recebe alternativas do pack do nicho');
ok(new Set(filled.candidates.map((candidate) => stockFrameSeriesKey(candidate.video))).size === filled.candidates.length,
  'alternativas não repetem a mesma série');
ok(filled.candidates.every((candidate) => candidate.reasons.some((reason) => reason.includes('pack') || reason.includes('genérica'))),
  'alternativa do pack é rotulada como tal na revisão');
const excluded = fillSmartStockAlternatives([{ ...quiaboSegment('Esse composto está na baba do quiabo.'), candidates: [] as ReturnType<typeof rankStockFrameVideos> }],
  { pool: packVideos, pack: packVideos, minimum: 6, exclude: [prostateVideo('manual', 'MÉDICO ANALISANDO PROSTATA INCHADA (7)')] })[0];
ok(!excluded.candidates.some((candidate) => stockFrameSeriesKey(candidate.video) === stockFrameSeriesKey({ title: 'MÉDICO ANALISANDO PROSTATA INCHADA' })),
  'série já inserida à mão na montagem não volta como alternativa');

const burstCopy = [{ label: 'BODY 8', text: 'Muitos relataram a próstata reduzir de tamanho em cerca de 14 dias, voltar a mijar forte e dormir a noite inteira sem levantar.' }];
const bursts = planSmartStockSegments(burstCopy, { coverage: 100, pace: 'adaptive' });
const longTakes = planSmartStockSegments(burstCopy, { coverage: 100, pace: 'long' });
ok(bursts.length >= 2 && bursts.every((segment) => segment.wordTo - segment.wordFrom + 1 >= 5 && segment.wordTo - segment.wordFrom + 1 <= 14),
  'divisão inteligente quebra o trecho longo em rajada de takes curtos (ritmo do Silas)');
ok(bursts.some((segment) => segment.text.startsWith('voltar')), 'a rajada corta onde a fala respira (vírgula)');
ok(measureSmartStockCoverage(burstCopy, bursts.map((segment) => ({ ...segment, selectedVideoId: 'x' }))).complete,
  'rajada cobre exatamente as mesmas palavras, sem buraco nem sobreposição');
ok(longTakes.length === 1, 'ritmo "takes mais longos" continua sem dividir');

const absorbCopy = [{ label: 'BODY 1', text: 'um dois três quatro cinco seis sete oito nove dez' }];
const absorbed = absorbUnfilledSmartSegments(absorbCopy, [
  { ...growth, id: 'a', anchor: 'BODY 1', wordFrom: 0, wordTo: 4, targetSeconds: 2.5, selectedVideoId: 'long', candidates: [{ video: prostateVideo('long', 'TAKE LONGO', { durationSec: 12 }), score: 20, reasons: [] }] },
  { ...growth, id: 'b', anchor: 'BODY 1', wordFrom: 5, wordTo: 9, targetSeconds: 2.5, candidates: [] as ReturnType<typeof rankStockFrameVideos> },
]);
ok(absorbed.length === 1 && absorbed[0].wordFrom === 0 && absorbed[0].wordTo === 9 && absorbed[0].selectedVideoId === 'long',
  '100%: trecho sem take único é absorvido pelo vizinho em vez de repetir take');

const wakeAtNight = quiaboSegment('Se você tem mais de 50 anos e levanta de madrugada pra urinar,');
ok(explainSmartStockScore(wakeAtNight, prostateVideo('acorda-noite', 'HOMEM ACORDANDO A NOITE')).score > 0,
  '"levanta de madrugada pra urinar" aceita a cena de acordar à noite');
const healing = quiaboSegment('Ele limpa as toxinas e desincha a glândula de dentro pra fora.');
ok(explainSmartStockScore(healing, prostateVideo('inchada', 'SEGURANDO PROSTATA INCHADA'), 'generic').score < 0,
  'fala de melhora ("desincha") não recebe próstata inchada');
const finasterideSegment = quiaboSegment('Aí o médico passa a finasterida e diz que é pra vida toda.');
const pillsScene = video({ id: 'velho-remedio', title: 'VELHO TOMANDO REMEDIO', nicheId: 'mecanismos', nicheName: 'Mecanismos Gerais' });
const withoutFeeling = explainSmartStockScore(finasterideSegment, pillsScene).score;
installStockFrameFeelingForTest({ prostata: { scenes: ['remedios pilulas'], keys: { finasterida: [[0, 2.5]] } } });
const withFeeling = explainSmartStockScore(finasterideSegment, pillsScene);
ok(withFeeling.score > withoutFeeling && withFeeling.reasons.some((reason) => reason.startsWith('feeling Silas')),
  'feeling do Silas puxa a cena que ele usa nessa fala e explica o porquê');
ok(explainSmartStockScore(kitchen, coffeeForGirlfriend, 'generic').score < 0, 'feeling nunca passa por cima das travas de contexto');
installStockFrameFeelingForTest({});

// ── Editor sênior (07.10): situação da fala, orgânico, variedade, favoritos ──
installStockFrameVisualAuditForTest({});
ok(normalizeStockFrameVideo({ id: 'org', name: 'Idoso', source_tags: ['Orgânico'] })?.origin === 'organic'
  && normalizeStockFrameVideo({ id: 'ia', name: 'Idoso', source_tags: ['I.A'] })?.origin === 'ai'
  && normalizeStockFrameVideo({ id: 'nada', name: 'Idoso', source_tags: [] })?.origin === 'unknown',
  'origem vem de source_tags ("Orgânico"/"I.A"), o mesmo campo do selo no site do StockFrame');
ok(normalizeStockFrameVideo({ id: 'var', name: 'Idoso', search_variations: 'avô esquecido, idoso confuso' })?.searchVariations === 'avô esquecido, idoso confuso',
  'sinônimos de busca do StockFrame (search_variations) entram no take');

const memoryCopy = 'Durante a conversa, ele mencionou que mais de 75% das pessoas com mais de 60 anos já têm perda de memória avançada. '
  + 'Segundo ele, isso são toxinas são microplásticos invisíveis que devoram os neurônios. '
  + 'Eu voltei a lembrar onde tinha deixado minhas chaves, meus óculos, meu celular. E você não perde apenas nomes e lembranças.';
const memorySegment = (text: string) => ({ ...planSmartStockSegments([{ label: 'BODY 3', text }], { coverage: 100, pace: 'long' })[0],
  campaignText: memoryCopy, campaignNicheId: 'memoria' });
const memoryVideo = (id: string, title: string, patch: Partial<StockFrameVideo> = {}) =>
  video({ id, title, nicheId: 'memoria', nicheName: 'Memória', origin: 'unknown', ...patch });
const brain3d = memoryVideo('cerebro-3d', 'CEREBRO 3D DANIFICADO');
const alzheimerPerson = memoryVideo('velha-alzheimer', 'VELHA COM ALZHEIMER');
const symptom = memorySegment('pessoas com mais de 60 anos já têm perda de memória avançada,');
const symptomRank = rankStockFrameVideos(symptom, [brain3d, alzheimerPerson], 10, true);
ok(symptomRank[0]?.video.id === 'velha-alzheimer',
  'sintoma de memória pede GENTE com o problema antes de cérebro 3D (Silas: "só vejo take 3D de cérebro")');
const mechanism = memorySegment('Segundo ele, isso são toxinas são microplásticos invisíveis que devoram os neurônios.');
const microplastic = memoryVideo('microplastico', 'CEREBRO COM MICROPLASTICOS');
ok(rankStockFrameVideos(mechanism, [alzheimerPerson, microplastic], 10, true)[0]?.video.id === 'microplastico',
  'explicação do mecanismo continua pedindo o órgão');
ok(segmentVisualIntent({ spoken: 'e um amigo meu que é neurologista.', context: 'jantar com minha esposa e um amigo meu que é neurologista.', direction: 'neutral', callToAction: false, localIngredients: 0 }).weights.medico === 1,
  'autoridade ("neurologista") pede cena de médico');

const siblingA = memoryVideo('vd-15', 'VELHO DEBILITADO (15)', { durationSec: 179.6 });
const siblingB = memoryVideo('vd-28', 'VELHO DEBILITADO (28)', { durationSec: 10.96 });
const siblingTwin = memoryVideo('vd-04', 'VELHO DEBILITADO (4)', { durationSec: 179.62 });
ok(stockFrameDistinctSiblings(siblingA, siblingB) && !stockFrameSameVisual(siblingA, siblingB),
  'filmagem real numerada com durações diferentes são cenas diferentes (43 velhinhos, não um)');
ok(stockFrameSameVisual(siblingA, siblingTwin), 'mesma série com a mesma duração continua sendo o mesmo take subido de novo');
ok(stockFrameSameVisual(memoryVideo('3d-a', 'CEREBRO 3D (3)', { durationSec: 8 }), memoryVideo('3d-b', 'CEREBRO 3D (9)', { durationSec: 12 })),
  'animação 3D da mesma série continua uma cena só por AD, mesmo com durações diferentes');
installStockFrameVisualAuditForTest({
  'dup-alz': { title: 'IDOSA CONFUSA NA CAMA COM A MÃO NA CABEÇA', beats: ['idoso', 'confusao'], appeal: 0, flags: [], stockTitle: 'VELHA COM ALZHEIMER (2)', niche: 'Memória' },
  'dup-deb': { title: 'IDOSA CONFUSA NA CAMA COM A MÃO NA CABEÇA', beats: ['idoso', 'confusao'], appeal: 0, flags: [], stockTitle: 'VELHA DEBILITADA', niche: 'Memória' },
  'ia-ficha': { title: 'IDOSO COCHILANDO NA POLTRONA', beats: ['idoso', 'sono'], appeal: 0, flags: ['IA'], stockTitle: 'IDOSO DORMINDO', niche: 'Memória' },
  'feliz-ficha': { title: 'IDOSA BEM VELHINHA RINDO FELIZ PARA A CÂMERA', beats: ['idoso', 'alegria'], appeal: 0, flags: [], stockTitle: 'VELHO DEBILITADO (10)', niche: 'Memória' },
});
ok(stockFrameSameVisual(memoryVideo('dup-alz', 'VELHA COM ALZHEIMER (2)', { durationSec: 28.6 }), memoryVideo('dup-deb', 'VELHA DEBILITADA', { durationSec: 28.61 })),
  'o mesmo vídeo subido com títulos diferentes é pego pela ficha visual + duração');
ok(stockFrameEffectiveOrigin(memoryVideo('ia-ficha', 'IDOSO DORMINDO')) === 'ai',
  'sem source_tags, a flag IA da ficha conferida vale como origem I.A');
const happyByFicha = memoryVideo('feliz-ficha', 'VELHO DEBILITADO (10)');
ok(sceneProfileOf(happyByFicha, stockFrameVisualAudit('feliz-ficha')).family === 'pessoa-bem',
  'com ficha, a situação vem da cena ("rindo feliz"), não do título do catálogo ("debilitado")');
installStockFrameVisualAuditForTest({});

const organicTake = memoryVideo('org-velha', 'VELHA COM ALZHEIMER CONFUSA', { origin: 'organic' });
const aiTake = memoryVideo('ia-velha', 'VELHA COM ALZHEIMER CONFUSA IA', { origin: 'ai' });
ok(rankStockFrameVideos(symptom, [aiTake, organicTake], 10, true)[0]?.video.id === 'org-velha',
  'com sentido equivalente, o orgânico vem antes do gerado por I.A');
ok(rankStockFrameVideos(symptom, [memoryVideo('org-generico', 'IDOSO NA PRAÇA', { origin: 'organic' }), memoryVideo('ia-exato', 'VELHA COM ALZHEIMER', { origin: 'ai' })], 10, true)[0]?.video.id === 'ia-exato',
  'mas o sentido manda: a cena exata de I.A vence a orgânica genérica');

const phoneRelief = memorySegment('Eu voltei a lembrar onde tinha deixado minhas chaves, meus óculos, meu celular.');
const neuronTaggedCellular = memoryVideo('neuronio', 'CONEXÃO DE NEURONIOS 3D', { tags: ['neurônios', 'sinapse', 'celular'] });
ok(!rankStockFrameVideos(phoneRelief, [neuronTaggedCellular], 10, true).some((candidate) => candidate.score > 20),
  '"meu celular" (telefone) não casa com a tag "celular" (célula) de um neurônio 3D');
const loss = memorySegment('E você não perde apenas nomes e lembranças.');
const dancing = memoryVideo('dancando', 'IDOSOS FELIZES E DANCANDO');
ok(explainSmartStockScore(loss, dancing, 'generic').reasons.includes('clima oposto ao da fala') || explainSmartStockScore(loss, dancing, 'generic').score < 0,
  '"não perde apenas nomes e lembranças" não recebe idosos dançando felizes');

const edAge = { ...planSmartStockSegments([{ label: 'BODY 1', text: 'Se você tem mais de 50 anos e anda triste,' }], { coverage: 100, pace: 'long' })[0],
  campaignText: 'Se você tem mais de 50 anos e está falhando na cama com sua mulher. Eu brochava e voltei a ter ereções firmes.', campaignNicheId: 'ed' };
const youngWoman = video({ id: 'mulher-triste', title: 'MULHER TRISTE NO SOFA', nicheId: 'ed', nicheName: 'ED' });
const olderMan = video({ id: 'homem-preocupado', title: 'IDOSO TRISTE', nicheId: 'ed', nicheName: 'ED' });
ok(rankStockFrameVideos(edAge, [youngWoman, olderMan], 10, true)[0]?.video.id === 'homem-preocupado',
  'persona: "mais de 50 anos" num AD de ED é o homem 50+, não uma moça na academia');

const variedSegments = [0, 1, 2, 3].map((index) => ({ ...memorySegment(`trecho ${index} sobre perda de memória`), id: `var-${index}`,
  anchor: 'BODY 9', wordFrom: index * 6, wordTo: index * 6 + 5, candidates: [
    { video: memoryVideo(`brain-${index}`, `CEREBRO ${['PODRE', 'RAIO X', 'NEVOA', 'FERRUGEM'][index]} 3D`), score: 40, reasons: [] },
    { video: memoryVideo(`person-${index}`, `${['IDOSA CONFUSA', 'IDOSO SOZINHO TRISTE', 'IDOSA NA CAMA DEBILITADA', 'IDOSO PERDIDO NA SALA'][index]}`), score: 33, reasons: [] },
  ] }));
const variedPlan = chooseSmartStockAssignments(variedSegments, true);
const variedVideos = variedPlan.map((segment) => selectedSmartCandidate(segment)!.video);
const variedFamilies = variedVideos.map((item) => sceneProfileOf(item).family);
ok(variedFamilies.filter((family) => family === 'anatomia').length <= 2 && variedFamilies.some((family) => family !== 'anatomia'),
  'dinamismo visual: o plano não vira cérebro atrás de cérebro quando há gente quase tão boa');
ok(new Set(variedVideos.map((item) => item.id)).size === variedVideos.length, 'variedade nunca repete take');

const rebalanceParts = [{ label: 'BODY 1', text: 'Tudo por causa dessa simples receita com quiabo. Os médicos consultam os idosos no hospital. Depois eles voltam pra casa e descansam bem tranquilos o dia todo.' }];
const weakPlan = [{ ...planSmartStockSegments(rebalanceParts, { coverage: 100, pace: 'long' })[0], wordFrom: 0, wordTo: 7,
  text: 'Tudo por causa dessa simples receita com quiabo.', campaignText: rebalanceParts[0].text, campaignNicheId: 'memoria',
  selectedVideoId: 'generico', candidates: [{ video: memoryVideo('generico', 'CEREBRO 3D'), score: 15, reasons: [], genericFallback: true }] }];
const rebalancedPlan = rebalanceSmartPlan(rebalanceParts, weakPlan, {
  coverage: 30, pace: 'fast', pool: [memoryVideo('medico-idoso', 'MÉDICO ATENDENDO IDOSO NO HOSPITAL', { nicheId: 'vsl', nicheName: 'VSL' })],
  campaign: { campaignText: rebalanceParts[0].text, campaignNicheId: 'memoria' },
});
const rebalanceTotal = rebalanceParts[0].text.split(/\s+/).length;
ok(rebalancedPlan !== weakPlan && !rebalancedPlan.some((segment) => segment.wordFrom === 0)
  && Math.abs(measureSmartStockCoverage(rebalanceParts, rebalancedPlan.map((segment) => ({ ...segment, selectedVideoId: 'x' }))).coveredWords - Math.round(rebalanceTotal * .3)) <= Math.max(1, Math.ceil(rebalanceTotal * .03)),
  'editor não força b-roll: trecho que só achou reserva cede a vez a um trecho com cena forte');

// ── FORMATOS AUTOMÁTICOS (07.10): maioria tela cheia, variação no hook, React/divididas pelo take, luz vermelha às vezes
{
  const familias: Record<string, ReturnType<typeof sceneProfileOf>['family']> = {};
  const seg = (id: string, anchor: string, wordFrom: number, text: string, familia: ReturnType<typeof sceneProfileOf>['family'], extra: Partial<SmartStockSegment> = {}): SmartStockSegment => {
    familias[`v-${id}`] = familia;
    return {
      id, anchor, wordFrom, wordTo: wordFrom + 6, text, query: text, concepts: [], visualScore: 1, targetSeconds: 3,
      candidates: [{ video: video({ id: `v-${id}`, title: id }), score: 20, reasons: [] }], selectedVideoId: `v-${id}`, ...extra,
    };
  };
  const formatParts = [
    { label: 'HOOK 1', text: 'a b c d e f g h i j k l m n o p q r s t u v w x y z' },
    { label: 'BODY 1', text: 'a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j k l m n o p' },
    { label: 'BODY 2', text: 'a b c d e f g h i j k l m n o p q r s t u v w x y z' },
  ];
  const plan: SmartStockSegment[] = [
    seg('h1', 'HOOK 1', 0, 'o perigo que ninguém conta sobre a memória', 'pessoa-problema', { narrativeDirection: 'distress' }),
    seg('h2', 'HOOK 1', 8, 'o médico explicou o que acontece no cérebro', 'medico'),
    seg('h3', 'HOOK 1', 16, 'e o dinheiro que a indústria ganha com isso', 'dinheiro'),
    seg('b1', 'BODY 1', 0, 'os neurônios se apagam um por um', 'anatomia'),
    seg('b2', 'BODY 1', 8, 'ela esquecia o nome dos netos', 'pessoa-problema', { narrativeDirection: 'distress' }),
    seg('b3', 'BODY 1', 16, 'em poucas semanas voltou a sorrir', 'pessoa-bem', { narrativeDirection: 'recovery' }),
    seg('b4', 'BODY 1', 24, 'a receita leva um ingrediente azul', 'receita'),
    seg('b5', 'BODY 1', 32, 'o laboratório confirmou o resultado', 'ciencia', { visualBeat: 'proof' }),
    seg('c1', 'BODY 2', 0, 'toque no botão abaixo e assista', 'tela'),
    { ...seg('x1', 'BODY 2', 8, 'trecho sem take', 'outro'), selectedVideoId: undefined },
  ];
  const familiaDe = (v: StockFrameVideo) => familias[v.id] || 'outro';
  const varied = variarFormatosDoPlano(plan, formatParts, { coverage: 60, familiaDe });
  const chosen = varied.filter((segment) => segment.selectedVideoId);
  const nonFull = chosen.filter((segment) => segment.formato && segment.formato.tipo !== 'cheia');
  ok(chosen.every((segment) => !!segment.formato && !!segment.transicao), 'formatos: todo take escolhido sai com formato e transição');
  ok(!varied.find((segment) => segment.id === 'x1')!.formato, 'formatos: trecho sem take não ganha formato');
  ok(nonFull.length >= 2 && nonFull.length <= Math.ceil(chosen.length * 0.4), `formatos: maioria em tela cheia, algumas variações (${nonFull.length}/${chosen.length})`);
  ok(varied[0].formato?.tipo !== 'cheia', 'formatos: o HOOK abre com variação');
  ok(nonFull.some((segment) => segment.formato!.tipo === 'react') && nonFull.some((segment) => ['faixas', 'cards', 'linha', 'mescla'].includes(segment.formato!.tipo)),
    'formatos: o plano mistura React e tela dividida');
  const cta = varied.find((segment) => segment.id === 'c1')!;
  ok(cta.formato?.tipo !== 'cheia' ? cta.formato?.tipo === 'react' : true, 'formatos: CTA que varia vira React (o avatar aponta pra tela)');
  const ordered = chosen;
  let run = 0; let maxRun = 0; let sameAdjacent = false;
  ordered.forEach((segment, index) => {
    const isVaried = segment.formato!.tipo !== 'cheia';
    run = isVaried ? run + 1 : 0; maxRun = Math.max(maxRun, run);
    const previous = ordered[index - 1]?.formato;
    if (isVaried && previous && previous.tipo === segment.formato!.tipo) sameAdjacent = true;
  });
  ok(maxRun <= 2 && !sameAdjacent, 'formatos: nunca 3 variações seguidas nem o mesmo formato colado');
  const reds = chosen.filter((segment) => segment.transicao === 'luz-vermelha');
  ok(reds.length >= 1 && reds.length <= Math.ceil(chosen.length * 0.25), `transição: luz vermelha às vezes (${reds.length}/${chosen.length})`);
  ok(!chosen.some((segment, index) => segment.transicao === 'luz-vermelha' && chosen[index + 1]?.transicao === 'luz-vermelha'), 'transição: nunca duas vermelhas seguidas');
  ok(reds.some((segment) => /perigo/.test(segment.text)), 'transição: a vermelha vai primeiro na fala de impacto');
  ok(varied.find((segment) => segment.id === 'b3')!.transicao !== 'escurecer', 'transição: melhora não escurece');
  // 100%: só React varia (as divididas mostrariam o avatar)
  const full = variarFormatosDoPlano(plan, formatParts, { coverage: 100, familiaDe });
  ok(full.filter((segment) => segment.selectedVideoId).every((segment) => segment.formato!.tipo === 'cheia' || segment.formato!.tipo === 'react')
    && full.some((segment) => segment.formato?.tipo === 'react'), 'formatos 100%: só React como variação');
  const reactSides = full.filter((segment) => segment.formato?.tipo === 'react').map((segment) => (segment.formato as { lado: string }).lado);
  ok(reactSides.length < 2 || reactSides[0] !== reactSides[1], 'formatos: React alterna o lado');
  // a escolha do editor nunca é sobrescrita
  const manual = variarFormatosDoPlano(plan.map((segment) => segment.id === 'h1' ? { ...segment, formato: { tipo: 'cheia' as const }, transicao: 'nenhuma' as const, formatoManual: true } : segment), formatParts, { coverage: 60, familiaDe });
  const keptManual = manual.find((segment) => segment.id === 'h1')!;
  ok(keptManual.formato?.tipo === 'cheia' && keptManual.transicao === 'nenhuma', 'formatos: o que o editor escolheu à mão fica');
  // take curtinho não vira tela dividida (nem assenta)
  const shortPlan = plan.map((segment) => ({ ...segment, targetSeconds: 1.2 }));
  ok(variarFormatosDoPlano(shortPlan, formatParts, { coverage: 60, familiaDe }).every((segment) => !segment.formato || segment.formato.tipo === 'cheia'),
    'formatos: flash curto (<1,6s) fica em tela cheia');
  ok(variarFormatosDoPlano([plan[0]], formatParts, { coverage: 60, familiaDe })[0].formato?.tipo === 'cheia', 'formatos: plano de um take só fica em tela cheia');
  ok(variarFormatosDoPlano(plan, formatParts, { coverage: 60, familiaDe }).map((s) => JSON.stringify([s.formato, s.transicao])).join()
    === varied.map((s) => JSON.stringify([s.formato, s.transicao])).join(), 'formatos: determinístico (mesma copy, mesmo plano)');
}

// ── RASCUNHO × MONTAGEM (07.10): o que mudou por fora vale sobre o rascunho
{
  const rParts = [{ label: 'BODY 1', text: 'um dois tres quatro cinco seis sete oito nove dez' }];
  const seg = (id: string, from: number, to: number, videoId: string, extra: Partial<SmartStockSegment> = {}): SmartStockSegment => ({
    id, anchor: 'BODY 1', wordFrom: from, wordTo: to, text: '', query: '', concepts: [], visualScore: 1, targetSeconds: 2,
    candidates: [], selectedVideoId: videoId, formato: { tipo: 'cheia' }, transicao: 'escurecer', ...extra,
  });
  const ins = (videoId: string, from: number, to: number, extra: Partial<Insert> = {}): Insert => ({
    ...insertPadrao(`sf:${videoId}`, 'BODY 1', { key: `k-${videoId}`, nome: videoId, tipo: 'video', w: 1080, h: 1920 }),
    source: 'stockframe', stockFrame: { videoId, title: videoId, smart: true }, palavraDe: from, palavraAte: to, ...extra,
  });
  const draft = [seg('a', 0, 2, 'va'), seg('b', 4, 6, 'vb'), seg('c', 8, 9, 'vc')];
  const iguais = reconciliarPlanoComMontagem(draft, [ins('va', 0, 2), ins('vb', 4, 6), ins('vc', 8, 9)], ['a', 'b', 'c'], rParts);
  ok(iguais === draft, 'rascunho igual à montagem: nada muda (mesma referência)');
  const mudou = reconciliarPlanoComMontagem(draft, [
    ins('va', 0, 2, { layout: { tipo: 'react', lado: 'esquerda' }, transicao: 'luz-vermelha' }),
    ins('vb', 3, 6),
  ], ['a', 'b', 'c'], rParts);
  ok(mudou[0].formato?.tipo === 'react' && mudou[0].transicao === 'luz-vermelha' && mudou[0].formatoManual === true,
    'formato trocado na janela de Inserts do PC vale no rascunho (e não é re-sorteado)');
  ok(mudou[1].wordFrom === 3 && mudou[1].text === 'quatro cinco seis sete', 'trecho ajustado no editor de takes vale no rascunho');
  ok(mudou[2].selectedVideoId === undefined, 'take tirado por fora volta pro avatar (não é re-baixado no Concluir)');
  const pendente = reconciliarPlanoComMontagem(draft, [], [], rParts);
  ok(pendente === draft, 'plano nunca aplicado continua como escolha pendente');
}

console.log(`\n${passed} passaram, ${failed} falharam.`);
if (failed > 0) process.exit(1);
