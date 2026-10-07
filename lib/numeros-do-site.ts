/**
 * NÚMEROS QUE O SITE ANUNCIA — fonte única.
 *
 * Landing, hub, cadastro e metadados mostram contagens de catálogo. Número
 * escrito à mão em cada página envelhece calado: em 07.10 a landing ainda
 * dizia 41 prints e 491 legendas quando o catálogo já tinha 46 e 501. Aqui
 * fica UM valor por número, e lib/numeros-do-site.test.ts conta o catálogo
 * real (app/tools/fakepass + lib/typography/presets) e reprova se divergir.
 *
 * Sem import nenhum de propósito: a landing importa isto, e puxar o registro
 * de modelos pra contar no navegador colocaria o FakePrint inteiro no bundle
 * da página pública.
 */

/** Modelos na galeria das Legendas Automáticas (TYPO_PRESETS). */
export const LEGENDAS_MODELOS = 501;

/** Modelos do FakePrint, todas as categorias (MODELS em fakepass/models.tsx). */
export const FAKEPRINT_MODELOS = 46;

/** Modelos de telejornal do FakePrint (categoria 'news'). */
export const FAKEPRINT_TELEJORNAIS = 17;
