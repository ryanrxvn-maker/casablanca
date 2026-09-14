import { strict as assert } from 'node:assert';
import {
  diferencaDeCobertura,
  normalizarCopy,
  partesDoPlanoComCopy,
  planoTemCopy,
} from './pilot-plano-copy';

let ok = 0;
function t(nome: string, fn: () => void) {
  fn();
  ok += 1;
  console.log('  ok', nome);
}

// corte de mentira: uma frase por take
const porFrase = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

t('plano sem texto nao dita copy', () => {
  assert.equal(planoTemCopy([{}, { texto: '  ' }]), false);
  assert.equal(planoTemCopy([{}, { texto: 'Ahoj.' }]), true);
});

t('III corta por frase, take unico nao corta, numeracao global', () => {
  const partes = partesDoPlanoComCopy(
    [
      { texto: 'Jedna. Dvě.', falante: 'Jacek' },
      { texto: 'Tři. Čtyři.', falante: 'Entrevistador' },
    ],
    ['Cena 1', 'Cena 2'],
    (i) => i === 1,
    porFrase,
  );
  assert.deepEqual(
    partes.map((p) => [p.label, p.text, p.matchByRole, p.speaker]),
    [
      ['BODY 1', 'Jedna.', 'cena 1', 'Jacek'],
      ['BODY 2', 'Dvě.', 'cena 1', 'Jacek'],
      ['BODY 3', 'Tři. Čtyři.', 'cena 2', 'Entrevistador'],
    ],
  );
});

t('cena sem texto nao gera take e nao quebra a numeracao', () => {
  const partes = partesDoPlanoComCopy(
    [{ texto: 'A.' }, { texto: '' }, { texto: 'B.' }],
    ['Cena 1', 'Cena 2', 'Cena 3'],
    () => false,
    porFrase,
  );
  assert.deepEqual(partes.map((p) => [p.label, p.matchByRole]), [
    ['BODY 1', 'cena 1'],
    ['BODY 2', 'cena 3'],
  ]);
});

t('cobertura: zero quando nada foi comido, negativo quando falta', () => {
  const cenas = [{ texto: 'Tohle zabíjí vaše oči.\n\nOd dětství jsem sledoval…' }];
  const partes = partesDoPlanoComCopy(cenas, ['Cena 1'], () => false, porFrase);
  assert.equal(diferencaDeCobertura(cenas, partes), 0);
  assert.ok(diferencaDeCobertura(cenas, partes.slice(1)) < 0);
});

t('normalizarCopy colapsa espacos e CRLF', () => {
  assert.equal(normalizarCopy('  Ahoj\r\n\r\n  světe  '), 'Ahoj světe');
});

console.log(`pilot-plano-copy: ${ok} testes ok`);
