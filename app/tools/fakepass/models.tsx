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

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'story', label: 'Stickers de Story' },
  { id: 'chat', label: 'Conversas' },
  { id: 'post', label: 'Posts' },
  { id: 'notif', label: 'Notificações' },
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
];
