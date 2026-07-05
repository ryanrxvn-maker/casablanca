'use client';

/**
 * FakePass — REGISTRO central de modelos.
 *
 * Cada família de modelo vive num arquivo próprio (model-*.tsx) com
 * `export default <FakeModel[]>`. Aqui a gente só junta tudo em MODELS, na
 * ordem em que aparecem no seletor. Adicionar um modelo = criar o arquivo +
 * importar + espalhar no array.
 */

import type { FakeModel } from './shared';
import { STORY_MODELS } from './model-story';
import STORY_EXTRA from './model-story-extra';
import IGDM from './model-igdm';
import WHATSAPP from './model-whatsapp';
import IGPOST from './model-igpost';
import TWEET from './model-tweet';
import COMMENTS from './model-comments';
import NOTIF from './model-notif';
import NEWS_CNN from './model-news-cnn';
import NEWS_CNNBR from './model-news-cnnbr';
import NEWS_BBC from './model-news-bbc';
import NEWS_FOX from './model-news-fox';
import NEWS_MSNBC from './model-news-msnbc';
import NEWS_CNBC from './model-news-cnbc';
import NEWS_GLOBAL from './model-news-global';
import NEWS_NNN from './model-news-nnn';
import NEWS_GLOBONEWS from './model-news-globonews';
import NEWS_BANDNEWS from './model-news-bandnews';
import NEWS_RECORD from './model-news-record';
import NEWS_TIMES from './model-news-times';
import SITE_BBC from './model-site-bbc';

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'story', label: 'Stickers de Story' },
  { id: 'chat', label: 'Conversas' },
  { id: 'post', label: 'Posts' },
  { id: 'notif', label: 'Notificações' },
  { id: 'news', label: 'Notícias' },
  { id: 'sites', label: 'Sites de Notícia' },
];

export const MODELS: FakeModel[] = [
  // Stickers de Story
  ...STORY_MODELS,
  ...STORY_EXTRA,
  // Conversas
  ...IGDM,
  ...WHATSAPP,
  // Posts
  ...IGPOST,
  ...TWEET,
  ...COMMENTS,
  // Notificações
  ...NOTIF,
  // Notícias (telejornais) — agrupados por emissora
  // Internacionais
  ...NEWS_CNN,
  ...NEWS_BBC,
  ...NEWS_FOX,
  ...NEWS_MSNBC,
  ...NEWS_CNBC,
  ...NEWS_GLOBAL,
  ...NEWS_NNN,
  // Brasil
  ...NEWS_CNNBR,
  ...NEWS_GLOBONEWS,
  ...NEWS_BANDNEWS,
  ...NEWS_RECORD,
  ...NEWS_TIMES,
  // Sites de Notícia (páginas de portal)
  ...SITE_BBC,
];
