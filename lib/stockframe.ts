/**
 * Contrato tolerante da API do StockFrame.
 *
 * A API e' nova e o payload exibido pelo site pode evoluir sem aviso. O Pilot
 * normaliza nomes snake_case/camelCase e wrappers comuns, mas nunca inventa
 * URLs nem ids: um take incompleto nao pode virar download do arquivo errado.
 */

export type StockFrameOrigin = 'organic' | 'ai' | 'unknown';

export type StockFrameVideo = {
  id: string;
  code?: string;
  title: string;
  description: string;
  tags: string[];
  previewUrl?: string;
  posterUrl?: string;
  durationSec: number;
  width: number;
  height: number;
  aspectRatio: '9:16' | '16:9' | 'other' | 'unknown';
  hasAudio: boolean | null;
  origin: StockFrameOrigin;
  downloads: number;
  favorite: boolean;
  recent: boolean;
  nicheId?: string;
  nicheName?: string;
  subcategoryId?: string;
  subcategoryName?: string;
  createdAt?: string;
  mediaExpiresAt?: string;
  downloadCost: number;
  available: boolean;
  duplicateGroupId?: string;
  finalScore?: number;
  conflictingConcepts: string[];
  matchedConcepts: string[];
  matchReason?: string;
  recommendedStartSec?: number;
  recommendedEndSec?: number;
  smartMetadata?: StockFrameSmartMetadata;
  raw?: Record<string, unknown>;
};

export type StockFrameSmartMetadata = {
  summary: string;
  concepts: string[];
  subjects: string[];
  actions: string[];
  objects: string[];
  bodyParts: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  duplicateGroupId?: string;
  adSuitabilityScore?: number;
  containsText: boolean;
  containsWatermark: boolean;
  graphicContent: boolean;
};

export type StockFrameSmartQuery = {
  id: string;
  text: string;
  context_before?: string;
  context_after?: string;
  full_copy_summary?: string;
  desired_duration?: number;
  niche_id?: string | null;
  subcategory_id?: string | null;
  aspect_ratio?: '9:16' | '16:9';
  origin?: 'organic' | 'ai';
  exclude_video_ids?: string[];
  exclude_duplicate_groups?: string[];
};

export type StockFrameNiche = {
  id: string;
  name: string;
  count?: number;
  subcategories?: { id: string; name: string; count?: number }[];
};

export type StockFrameAccount = {
  name: string;
  email: string;
  downloadsToday: number | null;
  downloadsLimit: number | null;
  downloadsRemaining: number | null;
  capabilities: { mediaUrls: boolean; taxonomy: boolean; smartSearch: boolean };
  plan?: string;
  niches: StockFrameNiche[];
};

export type StockFramePage = {
  videos: StockFrameVideo[];
  niches: StockFrameNiche[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

export type StockFrameFilters = {
  page?: number;
  perPage?: number;
  search?: string;
  nicheId?: string;
  subcategoryId?: string;
  aspectRatio?: '9:16' | '16:9';
  audio?: boolean;
  origin?: 'organic' | 'ai';
  favorites?: boolean;
  sort?: 'downloads' | 'recent' | 'relevance';
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function first(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function firstAcross(sources: Record<string, unknown>[], keys: string[]): unknown {
  for (const source of sources) {
    const value = first(source, keys);
    if (value !== undefined) return value;
  }
  return undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function finite(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function safeMediaUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw, 'https://biblioteca.stockframe.space');
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function tagsOf(value: unknown): string[] {
  const input = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;|]/)
      : [];
  return [...new Set(input.map((item) => {
    if (typeof item === 'string') return item.trim();
    const itemRecord = record(item);
    return text(first(itemRecord, ['name', 'label', 'title', 'tag']));
  }).filter(Boolean))].slice(0, 80);
}

function nestedLabel(value: unknown): { id?: string; name?: string } {
  if (typeof value === 'string' || typeof value === 'number') return { name: text(value) };
  const source = record(value);
  return {
    id: text(first(source, ['id', 'uuid', 'slug'])) || undefined,
    name: text(first(source, ['name', 'title', 'label'])) || undefined,
  };
}

function inferAspect(width: number, height: number, value: unknown): StockFrameVideo['aspectRatio'] {
  const explicit = text(value).replace(/\s/g, '');
  if (explicit.includes('9:16') || explicit === 'vertical' || explicit === 'portrait') return '9:16';
  if (explicit.includes('16:9') || explicit === 'horizontal' || explicit === 'landscape') return '16:9';
  if (!(width > 0 && height > 0)) return 'unknown';
  const ratio = width / height;
  if (ratio < 0.75) return '9:16';
  if (ratio > 1.35) return '16:9';
  return 'other';
}

function inferOrigin(source: Record<string, unknown>): StockFrameOrigin {
  const explicit = text(first(source, ['origin', 'source_type', 'sourceType', 'production_type', 'productionType'])).toLowerCase();
  const ai = bool(first(source, ['is_ai', 'isAi', 'ai_generated', 'aiGenerated']));
  if (ai === true || /\b(?:i\.?a\.?|ia|ai|artificial|generated)\b/i.test(explicit)) return 'ai';
  if (/organic|organico|orgânico|real|ugc|camera/.test(explicit) || ai === false) return 'organic';
  return 'unknown';
}

export function normalizeStockFrameVideo(value: unknown): StockFrameVideo | null {
  const source = record(value);
  const id = text(first(source, ['id', 'uuid', 'video_id', 'videoId', 'stock_id', 'stockId']));
  if (!id || id.length > 180) return null;

  const width = Math.max(0, Math.round(finite(first(source, ['width', 'video_width', 'videoWidth']))));
  const height = Math.max(0, Math.round(finite(first(source, ['height', 'video_height', 'videoHeight']))));
  const niche = nestedLabel(first(source, ['niche', 'nicho', 'category', 'categoria']));
  const subcategory = nestedLabel(first(source, ['subcategory', 'sub_category', 'subCategory', 'subpasta', 'folder']));
  const nicheId = text(first(source, ['niche_id', 'nicheId', 'category_id', 'categoryId'])) || niche.id;
  const nicheName = text(first(source, ['niche_name', 'nicheName', 'category_name', 'categoryName'])) || niche.name;
  const subcategoryId = text(first(source, ['subcategory_id', 'subCategoryId', 'sub_category_id', 'folder_id'])) || subcategory.id;
  const subcategoryName = text(first(source, ['subcategory_name', 'subCategoryName', 'sub_category_name', 'folder_name'])) || subcategory.name;
  const title = text(first(source, ['title', 'name', 'nome', 'headline'])) || `Stock ${id.slice(0, 8)}`;
  const description = text(first(source, ['description', 'descricao', 'caption', 'summary', 'prompt']));
  const tags = tagsOf(first(source, ['tags', 'keywords', 'palavras_chave', 'palavrasChave']));
  const media = record(first(source, ['media', 'assets', 'files', 'urls']));
  const preview = record(first(source, ['preview', 'video_preview', 'videoPreview']));
  const thumbnail = record(first(source, ['thumbnail', 'poster', 'cover']));
  const previewUrl = safeMediaUrl(firstAcross([source, preview, media], [
    'preview_url', 'previewUrl',
    'preview_signed_url', 'previewSignedUrl', 'signed_preview_url', 'signedPreviewUrl',
    'preview_webm_url', 'previewWebmUrl', 'webm_url', 'webmUrl',
    'watermarked_url', 'watermarkedUrl',
  ]) ?? first(preview, ['src', 'url']));
  const posterUrl = safeMediaUrl(firstAcross([source, thumbnail, media], [
    'poster_url', 'posterUrl', 'thumbnail_url', 'thumbnailUrl', 'thumb_url', 'thumbUrl',
    'thumbnail_signed_url', 'thumbnailSignedUrl', 'signed_thumbnail_url', 'signedThumbnailUrl',
    'cover_url', 'coverUrl', 'image_url', 'imageUrl', 'signed_url', 'signedUrl',
  ]) ?? first(thumbnail, ['src', 'url']));
  const metadata = record(first(source, ['smart_metadata', 'smartMetadata']));
  const score = first(source, ['final_score', 'finalScore']);
  const recommendedStart = first(source, ['recommended_start_sec', 'recommendedStartSec']);
  const recommendedEnd = first(source, ['recommended_end_sec', 'recommendedEndSec']);

  return {
    id,
    code: text(first(source, ['code', 'codigo', 'stock_code', 'stockCode'])) || undefined,
    title,
    description,
    tags,
    previewUrl,
    posterUrl,
    durationSec: Math.max(0, finite(first(source, ['duration', 'duration_sec', 'duration_seconds', 'durationSec', 'seconds']))),
    width,
    height,
    aspectRatio: inferAspect(width, height, first(source, ['aspect_ratio', 'aspectRatio', 'format', 'orientation'])),
    hasAudio: bool(first(source, ['has_audio', 'hasAudio', 'audio', 'with_audio', 'withAudio'])),
    origin: inferOrigin(source),
    downloads: Math.max(0, Math.round(finite(first(source, ['downloads', 'downloads_count', 'downloadCount', 'download_count'])))),
    favorite: bool(first(source, ['favorite', 'is_favorite', 'isFavorite', 'favorited'])) === true,
    recent: bool(first(source, ['recent', 'is_recent', 'isRecent', 'new'])) === true,
    nicheId: nicheId || undefined,
    nicheName: nicheName || undefined,
    subcategoryId: subcategoryId || undefined,
    subcategoryName: subcategoryName || undefined,
    createdAt: text(first(source, ['created_at', 'createdAt', 'published_at', 'publishedAt'])) || undefined,
    mediaExpiresAt: text(first(source, ['media_expires_at', 'mediaExpiresAt'])) || undefined,
    downloadCost: Math.max(0, finite(first(source, ['download_cost', 'downloadCost']), 1)),
    available: bool(first(source, ['available', 'access_allowed', 'accessAllowed'])) !== false,
    duplicateGroupId: text(first(source, ['duplicate_group_id', 'duplicateGroupId'])) || text(first(metadata, ['duplicate_group_id', 'duplicateGroupId'])) || undefined,
    finalScore: score === undefined ? undefined : finite(score),
    conflictingConcepts: tagsOf(first(source, ['conflicting_concepts', 'conflictingConcepts'])),
    matchedConcepts: tagsOf(first(source, ['matched_concepts', 'matchedConcepts'])),
    matchReason: text(first(source, ['match_reason', 'matchReason'])) || undefined,
    recommendedStartSec: recommendedStart === undefined ? undefined : finite(recommendedStart),
    recommendedEndSec: recommendedEnd === undefined ? undefined : finite(recommendedEnd),
    smartMetadata: Object.keys(metadata).length ? {
      summary: text(first(metadata, ['summary'])),
      concepts: tagsOf(first(metadata, ['concepts'])),
      subjects: tagsOf(first(metadata, ['subjects'])),
      actions: tagsOf(first(metadata, ['actions'])),
      objects: tagsOf(first(metadata, ['objects'])),
      bodyParts: tagsOf(first(metadata, ['body_parts', 'bodyParts'])),
      positiveKeywords: tagsOf(first(metadata, ['positive_keywords', 'positiveKeywords'])),
      negativeKeywords: tagsOf(first(metadata, ['negative_keywords', 'negativeKeywords'])),
      duplicateGroupId: text(first(metadata, ['duplicate_group_id', 'duplicateGroupId'])) || undefined,
      adSuitabilityScore: first(metadata, ['ad_suitability_score', 'adSuitabilityScore']) === undefined ? undefined : finite(first(metadata, ['ad_suitability_score', 'adSuitabilityScore'])),
      containsText: bool(first(metadata, ['contains_text', 'containsText'])) === true,
      containsWatermark: bool(first(metadata, ['contains_watermark', 'containsWatermark'])) === true,
      graphicContent: bool(first(metadata, ['graphic_content', 'graphicContent'])) === true,
    } : undefined,
    raw: source,
  };
}

function arrayAt(source: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(source[key])) return source[key] as unknown[];
  return [];
}

function collectionAt(source: Record<string, unknown>, keys: string[]): unknown[] {
  const array = arrayAt(source, keys);
  if (array.length) return array;
  for (const key of keys) {
    const value = record(source[key]);
    if (Object.keys(value).length) {
      return Object.entries(value).map(([entryKey, item]) => {
        const entry = record(item);
        return Object.keys(entry).length && !first(entry, ['id', 'uuid', 'slug', 'niche_id', 'nicheId', 'subcategory_id', 'subcategoryId', 'subfolder_id', 'subfolderId', 'folder_id', 'folderId'])
          ? { id: entryKey, ...entry }
          : item;
      });
    }
  }
  return [];
}

function normalizeNiche(value: unknown): StockFrameNiche | null {
  const source = record(value);
  const id = text(first(source, ['id', 'uuid', 'slug', 'niche_id', 'nicheId']));
  const name = text(first(source, ['name', 'title', 'label', 'nome']));
  if (!id || !name) return null;
  const subcategories = collectionAt(source, ['subcategories', 'sub_folders', 'subfolders', 'subpastas', 'folders']).map((item) => {
    const child = record(item);
    const childId = text(first(child, ['id', 'uuid', 'slug', 'subcategory_id', 'subcategoryId', 'subfolder_id', 'subfolderId', 'folder_id', 'folderId']));
    const childName = text(first(child, ['name', 'title', 'label', 'nome', 'subcategory_name', 'subcategoryName', 'subfolder_name', 'subfolderName', 'folder_name', 'folderName']));
    return childId && childName ? { id: childId, name: childName, count: finite(first(child, ['count', 'videos_count', 'videoCount'])) || undefined } : null;
  }).filter((item): item is NonNullable<typeof item> => !!item);
  return {
    id,
    name,
    count: finite(first(source, ['count', 'videos_count', 'videoCount', 'total'])) || undefined,
    subcategories: subcategories.length ? subcategories : undefined,
  };
}

export function mergeStockFrameNiches(...groups: StockFrameNiche[][]): StockFrameNiche[] {
  const merged = new Map<string, StockFrameNiche>();
  for (const group of groups) {
    for (const incoming of group) {
      if (!incoming?.id || !incoming.name) continue;
      const current = merged.get(incoming.id);
      const children = new Map<string, NonNullable<StockFrameNiche['subcategories']>[number]>();
      for (const child of current?.subcategories || []) children.set(child.id, { ...child });
      for (const child of incoming.subcategories || []) {
        const previous = children.get(child.id);
        children.set(child.id, {
          id: child.id,
          name: child.name || previous?.name || child.id,
          count: previous?.count === undefined && child.count === undefined
            ? undefined
            : Math.max(previous?.count || 0, child.count || 0),
        });
      }
      merged.set(incoming.id, {
        id: incoming.id,
        name: incoming.name || current?.name || incoming.id,
        count: current?.count === undefined && incoming.count === undefined
          ? undefined
          : Math.max(current?.count || 0, incoming.count || 0),
        subcategories: children.size
          ? [...children.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          : undefined,
      });
    }
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function normalizeStockFramePage(value: unknown, requested: { page?: number; perPage?: number } = {}): StockFramePage {
  const root = record(value);
  const data = record(root.data);
  const payload = Object.keys(data).length ? data : root;
  const videoValues = Array.isArray(value) ? value : arrayAt(payload, ['videos', 'items', 'results', 'stocks', 'data']);
  const videos = videoValues.map(normalizeStockFrameVideo).filter((item): item is StockFrameVideo => !!item);
  // Some responses wrap only the videos in `data`, leaving pagination and
  // taxonomy beside it. Preserve those outer fields before inner overrides.
  const meta = { ...root, ...record(root.meta), ...record(root.pagination), ...payload, ...record(payload.meta), ...record(payload.pagination) };
  const page = Math.max(1, Math.round(finite(first(meta, ['page', 'current_page', 'currentPage']), finite(first(payload, ['page', 'current_page', 'currentPage']), requested.page || 1))));
  const perPage = Math.max(1, Math.round(finite(first(meta, ['per_page', 'perPage', 'limit']), finite(first(payload, ['per_page', 'perPage', 'limit']), requested.perPage || Math.max(1, videos.length)))));
  const total = Math.max(videos.length, Math.round(finite(first(meta, ['total', 'total_count', 'totalCount']), finite(first(payload, ['total', 'total_count', 'totalCount']), videos.length))));
  const totalPages = Math.max(1, Math.round(finite(first(meta, ['total_pages', 'totalPages', 'last_page', 'lastPage']), Math.ceil(total / perPage))));
  const nicheValues = arrayAt(payload, ['niches', 'categories']);
  const explicitNiches = (nicheValues.length ? nicheValues : arrayAt(root, ['niches', 'categories'])).map(normalizeNiche).filter((item): item is StockFrameNiche => !!item);
  const inferred = new Map<string, StockFrameNiche>();
  for (const video of videos) {
    if (!video.nicheId || !video.nicheName) continue;
    const niche = inferred.get(video.nicheId) || { id: video.nicheId, name: video.nicheName, count: 0, subcategories: [] };
    niche.count = (niche.count || 0) + 1;
    if (video.subcategoryId && video.subcategoryName && !niche.subcategories?.some((item) => item.id === video.subcategoryId)) {
      niche.subcategories?.push({ id: video.subcategoryId, name: video.subcategoryName });
    }
    inferred.set(niche.id, niche);
  }
  return { videos, niches: explicitNiches.length ? explicitNiches : [...inferred.values()], page, perPage, total, totalPages };
}

export function normalizeStockFrameAccount(value: unknown): StockFrameAccount {
  const root = record(value);
  const source = Object.keys(record(root.data)).length ? record(root.data) : root;
  const downloads = record(first(source, ['quota', 'downloads', 'download_usage', 'downloadUsage']));
  const used = first(source, ['downloads_today', 'downloadsToday', 'daily_downloads', 'dailyDownloads']) ?? first(downloads, ['used', 'today', 'count']);
  const limit = first(source, ['downloads_limit', 'downloadsLimit', 'daily_limit', 'dailyLimit']) ?? first(downloads, ['limit', 'daily_limit', 'dailyLimit']);
  const niches = collectionAt(source, ['niches', 'categories', 'libraries'])
    .map(normalizeNiche).filter((item): item is StockFrameNiche => !!item);
  const remaining = first(downloads, ['remaining']);
  const capabilities = record(source.capabilities);
  return {
    name: text(first(source, ['name', 'username', 'display_name', 'displayName'])) || 'Conta StockFrame',
    email: text(first(source, ['email', 'user_email', 'userEmail'])),
    downloadsToday: used === undefined ? null : Math.max(0, Math.round(finite(used))),
    downloadsLimit: limit === undefined ? null : Math.max(0, Math.round(finite(limit))),
    downloadsRemaining: remaining === undefined ? null : Math.max(0, Math.round(finite(remaining))),
    capabilities: {
      mediaUrls: bool(first(capabilities, ['media_urls', 'mediaUrls'])) === true,
      taxonomy: bool(first(capabilities, ['taxonomy'])) === true,
      smartSearch: bool(first(capabilities, ['smart_search', 'smartSearch'])) === true,
    },
    plan: text(first(source, ['plan', 'pack', 'subscription', 'tier'])) || undefined,
    niches: mergeStockFrameNiches(niches),
  };
}

export function stockFrameSearchText(video: StockFrameVideo): string {
  const smart = video.smartMetadata;
  return [video.title, video.description, video.tags.join(' '), video.nicheName, video.subcategoryName,
    smart?.summary, smart?.concepts.join(' '), smart?.subjects.join(' '), smart?.actions.join(' '), smart?.objects.join(' '), smart?.bodyParts.join(' '), smart?.positiveKeywords.join(' ')]
    .filter(Boolean).join(' ');
}

export function normalizeStockFrameSmartResults(value: unknown): Map<string, StockFrameVideo[]> {
  const root = record(value);
  const payload = record(root.data);
  const rows = arrayAt(Object.keys(payload).length ? payload : root, ['results']);
  return new Map(rows.map((row) => {
    const item = record(row);
    return [text(first(item, ['query_id', 'queryId', 'id'])), arrayAt(item, ['videos', 'results', 'items'])
      .map(normalizeStockFrameVideo).filter((video): video is StockFrameVideo => !!video)];
  }).filter(([id]) => !!id) as [string, StockFrameVideo[]][]);
}

export function mergeStockFrameMediaUrls(videos: StockFrameVideo[], value: unknown): StockFrameVideo[] {
  const root = record(value);
  const payload = record(root.data);
  const updates = new Map(arrayAt(Object.keys(payload).length ? payload : root, ['videos', 'items'])
    .map(normalizeStockFrameVideo).filter((video): video is StockFrameVideo => !!video).map((video) => [video.id, video]));
  return videos.map((video) => {
    const update = updates.get(video.id);
    return update ? { ...video, posterUrl: update.posterUrl || video.posterUrl,
      previewUrl: update.previewUrl || video.previewUrl, mediaExpiresAt: update.mediaExpiresAt || video.mediaExpiresAt } : video;
  });
}
