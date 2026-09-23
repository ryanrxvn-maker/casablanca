import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enrichStockFrameVideos, normalizeStockFrameAccount, normalizeStockFramePage, normalizeStockFrameVideo, type StockFrameNiche } from './stockframe';

// Shape observado na API real. IDs/mídia são fixtures, sem conta ou token real.
const payload = {
  id: 'take-1', niche_id: 'ed', subfolder_id: 'relacionamento',
  name: 'Casal conversando', description: 'Casal em conversa.', tags: ['casal', 'conversa'],
  duration: 8, width: 576, height: 1024, format: 'vertical', size_bytes: 123456,
  code: 'ED-TEST', created_at: '2026-09-22T12:00:00Z',
  thumbnail_url: 'https://cdn.example.com/thumb.jpg', preview_url: 'https://cdn.example.com/preview.mp4',
};
const taxonomy: StockFrameNiche[] = [
  { id: 'ed', name: 'ED', subcategories: [{ id: 'relacionamento', name: 'Relacionamento' }] },
  { id: 'dores', name: 'Dores Articulares', subcategories: [{ id: 'relacionamento', name: 'Outra pasta' }] },
];

test('contrato real preserva subfolder_id, mídia preview e metadados existentes', () => {
  const video = normalizeStockFrameVideo(payload)!;
  assert.equal(video.title, payload.name);
  assert.equal(video.nicheId, 'ed');
  assert.equal(video.subcategoryId, 'relacionamento');
  assert.equal(video.subcategoryName, undefined, 'ID sozinho não vira nome inventado');
  assert.equal(video.durationSec, 8);
  assert.equal(video.aspectRatio, '9:16');
  assert.equal(video.posterUrl, payload.thumbnail_url);
  assert.equal(video.previewUrl, payload.preview_url);
  assert.equal(video.code, payload.code);
  assert.equal(video.createdAt, payload.created_at);
  assert.equal(video.raw?.size_bytes, 123456);
});

for (const [id, name] of [
  ['subfolder_id', 'subfolder_name'], ['subfolderId', 'subfolderName'], ['subFolderId', 'subFolderName'],
  ['subcategoryId', 'subcategoryName'], ['subCategoryId', 'subCategoryName'], ['folderId', 'folderName'],
]) {
  test(`aliases ${id}/${name} preservam a pasta oficial`, () => {
    const video = normalizeStockFrameVideo({ id: 'alias', [id]: 'folder-1', [name]: 'Mecanismo' })!;
    assert.equal(video.subcategoryId, 'folder-1');
    assert.equal(video.subcategoryName, 'Mecanismo');
  });
}

for (const key of ['subfolder', 'subFolder', 'sub_folder']) {
  test(`pasta aninhada ${key} aceita id/name`, () => {
    const video = normalizeStockFrameVideo({ id: 'nested', [key]: { id: 'folder-1', name: 'Mecanismo' } })!;
    assert.equal(video.subcategoryId, 'folder-1');
    assert.equal(video.subcategoryName, 'Mecanismo');
  });
}

test('format vertical/horizontal é case-insensitive e não inventa formato de áudio', () => {
  assert.equal(normalizeStockFrameVideo({ id: 'a', format: ' VERTICAL ' })?.aspectRatio, '9:16');
  assert.equal(normalizeStockFrameVideo({ id: 'b', format: 'Horizontal' })?.aspectRatio, '16:9');
  assert.equal(normalizeStockFrameVideo({ id: 'c', format: 'Áudio' })?.aspectRatio, 'unknown');
});

test('enriquecimento liga IDs à taxonomia oficial sem misturar pastas entre nichos', () => {
  const video = normalizeStockFrameVideo(payload)!;
  const enriched = enrichStockFrameVideos([video], taxonomy)[0];
  assert.equal(enriched.nicheName, 'ED');
  assert.equal(enriched.subcategoryName, 'Relacionamento');
  assert.equal(enriched.raw, video.raw);
  assert.equal(video.nicheName, undefined, 'não modifica o take original');
  assert.equal(video.subcategoryName, undefined);
});

test('nomes já conhecidos vencem e takes inalterados mantêm identidade/cache', () => {
  const video = normalizeStockFrameVideo({ ...payload, niche_name: 'Nome do take', subfolder_name: 'Pasta do take' })!;
  const videos = [video];
  const enriched = enrichStockFrameVideos(videos, taxonomy);
  assert.equal(enriched, videos);
  assert.equal(enriched[0], video);
  assert.equal(enriched[0].nicheName, 'Nome do take');
  assert.equal(enriched[0].subcategoryName, 'Pasta do take');
});

test('IDs desconhecidos, ausentes ou pasta em outro nicho não geram taxonomia', () => {
  const missing = normalizeStockFrameVideo({ id: 'missing', subfolder_id: 'relacionamento' })!;
  const unknown = normalizeStockFrameVideo({ ...payload, niche_id: 'unknown' })!;
  const noFolder = normalizeStockFrameVideo({ ...payload, subfolder_id: 'not-in-ed' })!;
  const result = enrichStockFrameVideos([missing, unknown, noFolder], taxonomy);
  assert.equal(result[0], missing);
  assert.equal(result[1], unknown);
  assert.equal(result[2].nicheName, 'ED');
  assert.equal(result[2].subcategoryName, undefined);
});

test('/me sem pastas enriquece só nicho e mantém capacidades ausentes desligadas', () => {
  const account = normalizeStockFrameAccount({ niches: [{ id: 'ed', name: 'ED' }] });
  const enriched = enrichStockFrameVideos([normalizeStockFrameVideo(payload)!], account.niches)[0];
  assert.equal(enriched.nicheName, 'ED');
  assert.equal(enriched.subcategoryName, undefined);
  assert.deepEqual(account.capabilities, { mediaUrls: false, taxonomy: false, smartSearch: false });
});

test('taxonomia parcial repetida complementa os filhos sem apagar os conhecidos', () => {
  const enriched = enrichStockFrameVideos([normalizeStockFrameVideo(payload)!], [
    { id: 'ed', name: 'ED' },
    { id: 'ed', name: 'ED', subcategories: [{ id: 'relacionamento', name: 'Relacionamento' }] },
  ])[0];
  assert.equal(enriched.subcategoryName, 'Relacionamento');
});

test('página enriquece usando sua própria taxonomia oficial, inclusive wrapper externo', () => {
  const page = normalizeStockFramePage({ data: [payload], niches: taxonomy });
  assert.equal(page.videos[0].nicheName, 'ED');
  assert.equal(page.videos[0].subcategoryName, 'Relacionamento');
});

test('enriquecimento não muda cotas, originais ou permissões de mídia', () => {
  const video = normalizeStockFrameVideo({ ...payload, preview_url: undefined, file_url: 'https://cdn.example.com/original.mp4', download_cost: 1, available: false })!;
  const enriched = enrichStockFrameVideos([video], taxonomy)[0];
  assert.equal(enriched.previewUrl, undefined, 'original não vira preview');
  assert.equal(enriched.downloadCost, 1);
  assert.equal(enriched.available, false);
});
