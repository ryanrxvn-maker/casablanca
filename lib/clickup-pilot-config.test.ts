import {
  ALL_EDITORS_ID,
  getPilotEditor,
  getPilotEditorForTeamStrict,
  pilotMayAutoLoadEditor,
  pilotPrimaryEditorId,
  setPilotEditorForTeam,
} from './clickup-pilot-config';

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

const values = new Map<string, string>([
  ['darkolab:clickup-pilot:editorId', ALL_EDITORS_ID],
  ['darkolab:clickup-pilot:editorId:b2c', ALL_EDITORS_ID],
  ['darkolab:clickup-pilot:drafts', 'rascunho preservado'],
]);
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > ALL_EDITORS_ID.length) throw new DOMException('Storage full', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
  },
  configurable: true,
});
setPilotEditorForTeam('b2c', 'silas');
check(getPilotEditorForTeamStrict('b2c') === null, 'quota cheia remove apenas o filtro amplo desse workspace');
check(getPilotEditor() === null, 'quota cheia remove apenas o filtro amplo global');
check(values.get('darkolab:clickup-pilot:drafts') === 'rascunho preservado', 'rascunhos não podem ser apagados');

console.log('ClickUp Pilot editor scope: primary=own, all=explicit, saved-all=no-autoload, full-storage safe OK.');
