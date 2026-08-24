/**
 * Teste do revisor de copy. Roda com:
 *   npx tsx lib/revisar-copy.test.ts
 *
 * O primeiro caso e o defeito real de 23.08: o doc trazia "que ta nao importa"
 * no lugar de "que TAMANHO nao importa", e o avatar falou isso no video pronto.
 */
import { revisarCopy, contarGraves } from './revisar-copy';
let f = 0;
const t = (nome: string, cond: boolean) => { console.log((cond ? '  ok  ' : '  FAIL ') + nome); if (!cond) f++; };

const a = revisarCopy('A mulher que fala que tá não importa é porque nunca encarou um de 20 cm.');
t('pega o "que tá não" (o caso do tamanho)', a.some(x => /truncado/.test(x.motivo)));

const b = revisarCopy('um video curto que eu postei semana passada no no meu perfil');
t('pega palavra repetida "no no"', b.some(x => /repetida/.test(x.motivo)));

const c = revisarCopy('aumenta o fluxo em ate 443%transformando qualquer brinquedinho');
t('pega numero grudado', c.some(x => /grudado/.test(x.motivo)));

const d = revisarCopy('Mulher\nNenhum dos dois. Eles tomam o viagra indigena.', ['Mulher', 'Homem', 'Doutor']);
t('pega rotulo do doc na fala', d.some(x => /r[oó]tulo do doc/.test(x.motivo)));

const e = revisarCopy('Fala normal, sem defeito nenhum, escrita direito e com pontuacao correta.');
t('copy limpa nao acende nada', e.length === 0);

const g = revisarCopy('assiste o video @redheadedgurl.mp4 agora');
t('pega arquivo dentro da fala', g.some(x => /arquivo ou link/.test(x.motivo)));

const h = revisarCopy('');
t('take vazio e grave', contarGraves(h) === 1);

console.log(f ? '\nX ' + f + ' falharam' : '\nok todos passaram');
process.exit(f ? 1 : 0);
