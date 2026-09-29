import { ALL_EDITORS_ID, pilotMayAutoLoadEditor, pilotPrimaryEditorId } from './clickup-pilot-config';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

check(pilotPrimaryEditorId(ALL_EDITORS_ID, 'silas') === 'silas', 'botão principal deve buscar apenas as tasks do próprio usuário');
check(pilotPrimaryEditorId(ALL_EDITORS_ID, null) === null, 'sem usuário autenticado não pode buscar tasks de todos por engano');
check(pilotPrimaryEditorId('editor-youtube', 'silas') === 'editor-youtube', 'escolha explícita de outro editor continua disponível');
check(pilotPrimaryEditorId('silas', 'silas') === 'silas', 'editor próprio permanece inalterado');
check(!pilotMayAutoLoadEditor(ALL_EDITORS_ID), 'filtro amplo salvo não pode carregar automaticamente');
check(!pilotMayAutoLoadEditor(null), 'sem editor não há carga automática');
check(pilotMayAutoLoadEditor('silas'), 'carga automática do próprio editor continua funcionando');

console.log('ClickUp Pilot editor scope: primary=own, all=explicit, saved-all=no-autoload OK.');
